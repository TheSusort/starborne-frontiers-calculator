import type { StatusEngine } from './statusEngine';

/**
 * `Reversed Repairs` — "Incoming repairs damage this unit instead" (constants/buffs.ts).
 *
 * NAME-KEYED, like Exposed / Stealth / Barrier, rather than a `parsedEffects` entry. There is no
 * standing percentage to fold: the status does not scale a channel, it inverts one. Folding it
 * into `incomingHeal` is the trap the spec calls out — that fold is unclamped, so a negative
 * multiplier produces `consumed: 0` plus a NEGATIVE overheal: no damage, no healing, garbage
 * statistics, and green tests throughout.
 *
 * Applier in the corpus: Zosimos's charged skill ("inflicts Reversed Repairs for 1 turn").
 *
 * Read at the single heal-apply site (`engine.ts` `applyHealToTarget`), which is the ONLY line in
 * the combat engine where HP goes up — so every repair channel is covered by one branch.
 */
export const REVERSED_REPAIRS = 'Reversed Repairs';

/**
 * The carrier state read off a victim, or `undefined` when its repairs are not reversed.
 *
 * NOT a magnitude: reversal is not a scaling factor and stacks mean nothing here. What the state
 * carries instead is `applierId` — the actor that inflicted the status — because R7′ books the
 * burn's damage AND its kill on the APPLIER, the way a DoT's damage and kills belong to whoever
 * applied the DoT. (The retracted R7 booked them on the healer whose repair was reversed; see the
 * reversal branch in `engine.ts` for why that is wrong and must not be restored.)
 *
 * `applierId: undefined` is a LEGITIMATE state, not an error: a hand-selected debuff in the
 * calculator's enemy-debuff picker (the scheduled arm below) was never cast by anyone, so there is
 * nobody to credit. Callers must skip the credit rather than fall back to the healer — that
 * fallback is precisely the attribution R7′ rejects.
 */
export type ReversedRepairsState = { applierId: string | undefined } | undefined;

/**
 * Whether this victim's incoming repairs are reversed, and by whom.
 *
 * Reads BOTH enemy-side channels, but only the TIMED arm is unconditionally per-victim, and only
 * that arm is safe on both teams:
 *
 *  - TIMED arm — ungated on side, deliberately. `timedAbilityStatuses('enemy', undefined,
 *    victimId)` is correctly keyed to `victimId` (it reads the per-target enemy map, see
 *    `statusEngine.ts`'s `timedEnemy` upsert), and it is the channel the real corpus applier
 *    (Zosimos's charged skill, "inflicts Reversed Repairs for 1 turn") lands on. Team symmetry is
 *    mandatory in this engine — an enemy Zosimos debuffing a PLAYER ship must reverse that ship's
 *    repairs, so this arm must fire for player-side victims too. Do not add a side gate here.
 *
 *  - SCHEDULED arm — gated on `victim.side === 'enemy'`, and this gate is load-bearing, not
 *    cosmetic. `enemyAlwaysSnap` (`statusEngine.ts`, inside `snapshot`) builds from a single
 *    global `alwaysEnemy` list with NO per-victim keying whatsoever — unlike the accum, persistent
 *    and timed enemy arms right next to it, which all key off `enemyTargetId`/`enemyTargetId`-like
 *    maps. Passing a `victimId` into `snapshot(undefined, victimId)` does nothing for this arm: it
 *    ignores the id entirely and returns the same global list for ANY id, including a player-side
 *    actor's. Before this gate existed, this read (then a boolean-returning `hasReversedRepairs`)
 *    answered `true` for literally every id probed — `attacker`, `foe`, `player-3`, `enemy-7`,
 *    `literally-anything` — because the scheduled arm has nothing else to filter on. Today's
 *    `reversedRepairsOn` would answer `{ applierId: undefined }` (carrying) for every one of those
 *    same ids without the gate — same leak, new shape. The calculator's `enemyDebuffs` picker means
 *    "debuffs the OPPOSING team carries", so without this gate a user ticking Reversed Repairs in
 *    the enemy-debuff picker would reverse their OWN team's repairs into damage. `side` is the
 *    only signal available to stop that leak, since the underlying store carries none.
 *
 * This is exactly why `exposedStatus.ts`'s `exposedIncomingPct` reads ONLY the timed channel and
 * drops the scheduled one outright rather than gating it: Exposed's "next direct hit" has no
 * standing value to model, so making the scheduled arm inert is the faithful rendering there. A
 * 1-turn Reversed Repairs DOES have a standing value, so it can't be dropped the same way — it has
 * to be gated instead. If a future reader sees this asymmetric gate (timed ungated, scheduled
 * gated) and is tempted to "simplify" it to one rule for both arms: don't — the two arms have
 * fundamentally different keying, and collapsing them either breaks Zosimos's cross-team debuff or
 * reopens the enemy-picker leak.
 */
export function reversedRepairsOn(
    statusEngine: StatusEngine,
    victim: { id: string; side: 'player' | 'enemy' }
): ReversedRepairsState {
    // TIMED arm — `casterId` is "the actor that CAST this ability" (statusEngine.ts), stamped at
    // application. That is the Zosimos R7′ wants. It can still be absent on a timed entry whose
    // registered status omitted it (fixtures), which the `string | undefined` state models
    // honestly rather than papering over with a sentinel.
    //
    // ⚠️ TIE-BREAK, undecided: `.find()` returns the FIRST matching entry. If two DISTINCT Zosimos
    // ever inflicted Reversed Repairs on the same victim (re-applying it does not currently
    // overwrite the existing entry's caster), the second applier's damage/kill credit is silently
    // dropped — the first applier wins every burn until its entry expires. Not fixed here: no
    // corpus ship currently re-applies this status onto an already-carrying victim, so there is
    // nothing to pin a fixture against; flagged so a future reader does not assume `.find()` here
    // was an oversight.
    const timed = statusEngine
        .timedAbilityStatuses('enemy', undefined, victim.id)
        .find((s) => s.active.buffName === REVERSED_REPAIRS);
    if (timed) return { applierId: timed.casterId };
    if (victim.side !== 'enemy') return undefined;
    const scheduled = statusEngine
        .snapshot(undefined, victim.id)
        .activeEnemyDebuffs.some((b) => b.buffName === REVERSED_REPAIRS);
    // SCHEDULED arm — no caster, ever. `SelectedGameBuff` carries no applier identity, and there
    // genuinely is none: the user ticked a box. `applierId: undefined` → no damage credit and no
    // killer on the death event (`recordDestroyed` already tolerates an undefined `killerId`).
    return scheduled ? { applierId: undefined } : undefined;
}
