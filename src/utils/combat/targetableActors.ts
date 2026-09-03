import type { CombatActor } from './state';

/**
 * THE one answer to "can a targeting clause name this actor?" for the SELECTOR layer — the three
 * global enemy selectors ('enemy-most-buffs' / 'enemy-highest-attack' / 'enemy-highest-speed') and
 * the living-opposing-roster scans that feed reactive 'all-enemies' procs.
 *
 * WHY THIS EXISTS (#407, owner ruling R1). Liveness is asked HERE and nowhere else at the selector
 * layer, so the three selectors and the reactive roster scans cannot disagree about who is alive.
 * A selector that skips the check lets a buffed CORPSE win the "most buffs" selection and lands the
 * status on its store. In-fight: the enemy Curator gets a Barrier in round 2 and dies in round 3;
 * in round 4 Rhodium's end-of-round purge strips the corpse and leaves the living,
 * Barrier-carrying enemy in front of it untouched.
 *
 * ⚠️ THE GOLDEN SUITE DOES NOT OBSERVE THIS GATE. The corpus barely reaches the on-cast purge
 * loop's `enemy-most-buffs` arm, so no golden fingerprint moves when the gate changes an answer —
 * which is a statement about the suite's coverage, not about the gate being inert.
 * `aliveSelectorTarget.integration.test.ts` is the only test that observes it, which is why that
 * file leads with its own instrument-validation arm.
 *
 * BOTH CONJUNCTS ARE LOAD-BEARING (ruling R2). `currentHp <= 0` is NOT the same question as
 * `destroyedRound !== undefined`: a NEVER-ALIVE actor (max hp 0, never killed) has no
 * `destroyedRound`, and a KILLED one has both. The positional path already refuses to target both
 * shapes — `resolvePositionalTarget`'s `byCell` indexes only `position !== undefined &&
 * currentHp > 0` cells — so this is the selector layer's equivalent, not a new rule. Do not
 * collapse the two into one.
 *
 * The `currentHp` conjunct is not decoration: it catches actors with `stats.hp === 0` that the
 * death filter alone lets through, turning a corpse-landing into a fizzle. That shape does not
 * exist for a real ship — it is the synthetic placeholder some fixtures build (see
 * `perVictimDotTick.integration.test.ts`'s player-side GATE RETENTION case) — which is exactly why
 * `isTargetableRosterMember` calls it "a SOURCE of pressure, never a sink for damage".
 *
 * STEALTH IS DELIBERATELY NOT HERE (ruling R3). A stealthed enemy IS hit by a selector-targeted
 * clause: Stealth hides you from being picked as an ATTACK target (the positional path's own
 * stealth filter, `resolvePositionalTarget`), but a global "highest attack" effect finds you
 * anyway. In-fight: the enemy's 9,000-attack Bizon has Stealth up, and Selenite's passive still
 * lands Hacking Down on it at the start of the round. That is decided game behaviour, not a gap —
 * do not add a stealth conjunct here and do not file a follow-up for it.
 *
 * WHAT THIS IS NOT FOR. `soleSurvivorOf` / `lastStandingId` answers "how many of my team are still
 * standing", which is a survivor COUNT, not a targeting question — it keeps its own
 * `destroyedRound`-only filter, because folding `currentHp > 0` in would silently re-rule the Last
 * Stand gate for a never-alive actor. The positional path keeps its own gate too; see
 * `isTargetableRosterMember`'s doc comment in `positionalBinding.ts` for why its keying on MAX hp
 * rather than current hp is load-bearing in two directions.
 */
export function isAliveTarget(a: CombatActor): boolean {
    return a.destroyedRound === undefined && a.currentHp > 0;
}

declare const aliveGated: unique symbol;

/**
 * A roster already narrowed to targetable actors. Only {@link aliveTargetsOf} can produce one.
 *
 * TSC, NOT A TEST, IS THE TRIPWIRE. The three selector resolvers in `engine.ts` take `AliveRoster`
 * rather than `CombatActor[]`, so a seam that hands one of them a raw roster FAILS TO COMPILE.
 * That is the same instrument as the two total `Record`s in `abilityTargetSide.ts`: a convention
 * policed only by a coverage test is exactly how the four hand-written `||` chains #399 replaced
 * went stale. An `AliveRoster` is assignable wherever a `CombatActor[]` is expected, so no
 * downstream consumer needs to know the brand exists.
 *
 * SCOPE OF THE GUARANTEE, stated honestly: a compile-time brand gates AUTHORING, not INPUT. It is
 * adequate here because every roster reaching these seams is built inside the engine from
 * `enemyAttackerActors` / `allPlayerActors` — none of it is user-persisted data that could arrive
 * unbranded at runtime. It would NOT be adequate for an ability config, which IS persisted and
 * unvalidated on read (see `enemySelectorKind`'s `?? null` comment for that case).
 */
export type AliveRoster = CombatActor[] & { readonly [aliveGated]: true };

/**
 * Narrow a roster to its targetable members. Order is preserved, so every selector's documented
 * "ties resolve to roster order" tiebreak is unchanged for the living.
 *
 * CALL THIS AT USE TIME, NEVER HOIST THE RESULT INTO A `const` ARRAY. Rosters are mutated in place
 * as actors die during a round, so an array captured at turn start goes stale mid-round and would
 * re-admit an actor that died after the snapshot. Every seam wraps it in a thunk.
 */
export function aliveTargetsOf(roster: CombatActor[]): AliveRoster {
    return roster.filter(isAliveTarget) as AliveRoster;
}
