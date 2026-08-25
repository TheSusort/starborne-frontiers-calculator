import { Buff, SelectedGameBuff } from '../../types/calculator';
import type { AbilityStatusPayload, ActiveBuff } from './statusEngine';
import { deriveFamilyKey } from './statusEngine';

// ---------------------------------------------------------------------------
// Leaf helpers shared by the player turn (playerTurn.ts) and the effective-stat
// fold (effectiveStats.ts). Kept in this dependency-free module so neither caller
// has to import the other — breaking the playerTurn ⇄ effectiveStats import cycle.
// ---------------------------------------------------------------------------

/**
 * Fold a flat Buff[] into the additive-percentage totals the damage/heal and
 * effective-stat (effectiveStats.ts) pipelines consume. Pure: each channel sums
 * the matching-stat buff values.
 * NOTE: hotPct is intentionally NOT summed here — HoTs need per-status applier
 * identity, so those statuses are read directly downstream.
 */
export function calculateBuffTotals(buffs: Buff[]) {
    const attackBuff = buffs
        .filter((b) => b.stat === 'attack')
        .reduce((sum, b) => sum + b.value, 0);
    const critBuff = buffs.filter((b) => b.stat === 'crit').reduce((sum, b) => sum + b.value, 0);
    const critDamageBuff = buffs
        .filter((b) => b.stat === 'critDamage')
        .reduce((sum, b) => sum + b.value, 0);
    const outgoingDamageBuff = buffs
        .filter((b) => b.stat === 'outgoingDamage')
        .reduce((sum, b) => sum + b.value, 0);
    const defenceBuff = buffs
        .filter((b) => b.stat === 'defence')
        .reduce((sum, b) => sum + b.value, 0);
    const hpBuff = buffs.filter((b) => b.stat === 'hp').reduce((sum, b) => sum + b.value, 0);
    const outgoingHealBuff = buffs
        .filter((b) => b.stat === 'outgoingHeal')
        .reduce((sum, b) => sum + b.value, 0);
    const incomingHealBuff = buffs
        .filter((b) => b.stat === 'incomingHeal')
        .reduce((sum, b) => sum + b.value, 0);
    const speedBuff = buffs.filter((b) => b.stat === 'speed').reduce((sum, b) => sum + b.value, 0);
    const hackingBuff = buffs
        .filter((b) => b.stat === 'hacking')
        .reduce((sum, b) => sum + b.value, 0);
    const securityBuff = buffs
        .filter((b) => b.stat === 'security')
        .reduce((sum, b) => sum + b.value, 0);
    const attackFlatBuff = buffs
        .filter((b) => b.stat === 'attackFlat')
        .reduce((sum, b) => sum + b.value, 0);
    return {
        attackBuff,
        critBuff,
        critDamageBuff,
        outgoingDamageBuff,
        defenceBuff,
        hpBuff,
        outgoingHealBuff,
        incomingHealBuff,
        speedBuff,
        hackingBuff,
        securityBuff,
        attackFlatBuff,
    };
}

// Expand an active buff/debuff into its underlying SelectedGameBuff effects.
// Accumulating buffs override their static stacks with the per-round count and
// drop out entirely when at zero stacks; non-accumulating ones pass through.
export function expandBuffEntry(ab: ActiveBuff, bufs: SelectedGameBuff[]): SelectedGameBuff[] {
    if (ab.stacks !== undefined) {
        return ab.stacks > 0 ? bufs.map((b) => ({ ...b, stacks: ab.stacks! })) : [];
    }
    return bufs;
}

/** Expand a victim's active enemy-debuff snapshot into SelectedGameBuff effects via the
 *  enemy-debuff lookup (applies the per-round stack override; drops zero-stack and unknown
 *  names). Shared by the engine's per-victim defense/incoming-damage sourcing (B1) and
 *  victimEnemyBuffs (triggers.ts). */
export function expandEnemyDebuffs(
    activeEnemyDebuffs: ActiveBuff[],
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>
): SelectedGameBuff[] {
    return activeEnemyDebuffs.flatMap((ab) =>
        expandBuffEntry(ab, enemyDebuffLookup.get(ab.buffName) ?? [])
    );
}

// Mirror toSimBuffs/toEnemyModifiers semantics for an ability-status payload: wrap it as
// a SelectedGameBuff so the existing buff-fold helpers apply (effect × stacks). The payload's
// own stacks (current count for accumulating; configured stacks otherwise) become the buff stacks.
export function payloadToSelectedBuff(payload: AbilityStatusPayload): SelectedGameBuff {
    // NOTE: the derived id `ability-${buffName}` is non-unique by design for duplicate buffNames
    // (only summed by stat downstream, never deduped by id).
    return {
        id: `ability-${payload.buffName}`,
        buffName: payload.buffName,
        stacks: payload.stacks,
        parsedEffects: payload.parsedEffects,
        isStackable: false,
        ...(payload.application ? { application: payload.application } : {}),
    };
}

/**
 * The INCOMING-REPAIR multiplier for a summed incoming-heal percentage, floored at 0 (#367 §3.4).
 *
 * WHY IT IS FLOORED. The summed percentage fed in is unclamped by construction. Under the locked
 * tier rule (R1: same-family statuses overwrite by highest tier, survivors add) only ONE
 * `Inc. Repair Down` can stand today, so the worst reachable value is −75% and the floor is a
 * no-op — this is a TRIPWIRE for the next incoming-repair reducer, not a fix for a live bug.
 * Nothing upstream stops a future second reducer from pushing the sum past −100%, and a factor
 * below 0 would flip the repair's SIGN.
 *
 * HP itself is safe either way: `applyHealToTarget` floors both of its paths (`Math.max(0,
 * Math.min(raw, deficit))` normally, `Math.max(0, raw)` under a #362 reversal), so a negative raw
 * can never move HP the wrong way. What an unfloored factor silently corrupts is the ACCOUNTING
 * built from that raw — `healing.credit(...)`, `healRawSum`, `heal-performed.amount` /
 * `perTarget[].amount`, the battle report's healing done/received, and a negative reported
 * `overheal` (`raw − 0` once the deficit clamp zeroes `consumed`). The guard is for the numbers a
 * reader would report, not for the bar.
 *
 * A fully-suppressed repair floors to 0, never damage: Reversed Repairs (#362) is the only
 * sanctioned repair-to-damage channel, and it is an explicit status, not a sign accident reached by
 * folding percentages past −100%.
 *
 * WHY IT LIVES IN THIS LEAF MODULE. It has SIX consumption sites across three files that import
 * each other in one direction only — `runPlayerTurn`'s player and `healEventOnly` cast arms and its
 * HoT tick (`playerTurn.ts`), the reactive-heal executor (`triggers.ts`), and the two per-victim
 * leech procs `procStandingLeechesPerVictim` / `procTakenLeechesPerVictim` (`engine.ts`, added by
 * #367 task 7 when the owner ruled a leech self-repair is a repair like any other). It was
 * originally a closure inside `runPlayerTurn` whose doc was honestly scoped to "this file's three
 * sites", which made it an INCOMPLETE tripwire: #367 routed `triggers.ts`'s `incomingPctFor`
 * through `liveHealChannelPct`, so for the first time that site could see an enemy-applied
 * reduction while being the only one not clamped. `buffTotals` is the leaf all three files already
 * import — the "import-cycle safe: … come from ./buffTotals (leaf module), not from ./playerTurn
 * (which imports triggers.ts)" note on `triggers.ts`'s `victimEnemyBuffs` is the same argument — so
 * a single definition serves all six without a cycle. A value import of `playerTurn` from
 * `triggers` would be one, which is why this did not simply get exported where it stood.
 *
 * HISTORICAL: two leech heal-apply sites in `engine.ts` were deliberately left unfolded here — the
 * aggregate `procStandingLeeches` and the non-positional heal-target taken-leech block — because
 * both were corpus-DEAD (measured with ungated probes across the whole suite; neither fired), so a
 * fold there would have been an unverifiable change to unexercised code. #374 DELETED both, so
 * there is no longer an unfolded site to account for.
 *
 * ⚠️ NO OUTGOING TWIN, DELIBERATELY. The outgoing channel (`Out. Repair Down`) is unfloored at
 * every one of its sites — `(1 + outgoingHealBuff / 100)` in both `playerTurn` cast arms and
 * `(1 + ownerOutgoing / 100)` in the reactive executor — so it is at least CONSISTENT today.
 * Flooring it in one of the three would rebuild exactly the partial tripwire this function exists
 * to remove. Its own reachability argument is the same shape (one tier-shadowed family,
 * `Out. Repair Down II` at −50%, so −100% is unreachable today). If a second outgoing reducer ever
 * ships, add the twin at ALL THREE sites in one change, not here first.
 */
export function incomingHealFactor(pct: number): number {
    return Math.max(0, 1 + pct / 100);
}

// ---------------------------------------------------------------------------
// #389 — cross-store tier shadowing for the two OUTGOING-damage channels.
//
// OWNER RULING (spec §5): the strongest single instance of a named family applies, and weaker
// instances are shadowed, REGARDLESS OF WHICH SIDE APPLIED IT. An enemy carrying a self-inflicted
// `Attack Down I` (-15%) that your Curator hits with `Attack Down III` (-45%) throws at -45%:
// not -15%, and NOT the -60% sum.
//
// WHY THIS NEEDED WRITING. Tier shadowing (`familyApplicationWins` in statusEngine.ts) is
// PER-STORE: it keys a family map inside one side's store, so it cannot see across the self/enemy
// boundary. Simply switching on the dead enemy-side `attack`/`outgoingDamage` channels would make
// the two instances ADD — which the ruling explicitly rules out, both because it makes two
// instances of one debuff worth more than one (contradicting the family's behaviour inside a
// single store) and because it puts -100% within accidental reach.
//
// SCOPE — PER NAMED FAMILY, and no wider (spec §5.2). `Attack Down` and `Out. Damage Down` are
// DIFFERENT families and still combine exactly as they always have; only same-family instances
// shadow. Collapsing across families would be a new defect, which is why the fold below is keyed
// by `deriveFamilyKey` and the two channels are carried independently inside each entry.
// ---------------------------------------------------------------------------

/** One named family's contribution to the two outgoing channels, in additive percentage points. */
export interface OutgoingFamilyEntry {
    /** `Attack Down`/`Up` — `parsedEffects.attack`, folded into `attackBuff`. */
    attackPct: number;
    /** `Out. Damage Down`/`Up` — `parsedEffects.outgoingDamage`, folded into `outgoingDamageBuff`. */
    outgoingDamagePct: number;
}

/** familyKey (`deriveFamilyKey`) → the strongest instance of that family on each channel. */
export type OutgoingFamilyMap = Map<string, OutgoingFamilyEntry>;

/** The STRONGER of two same-family same-channel contributions: larger magnitude wins.
 *
 *  Magnitude rather than a signed min/max because the ruling is about tier strength, and a family
 *  is sign-homogeneous by construction — `Attack Up` and `Attack Down` derive DIFFERENT family
 *  keys, so a single family never mixes a buff and a debuff whose signs would fight. Ties keep the
 *  incumbent, which makes the fold order-independent for equal magnitudes. */
function strongerPct(incumbent: number, challenger: number): number {
    return Math.abs(challenger) > Math.abs(incumbent) ? challenger : incumbent;
}

/**
 * Reduce a buff list to the STRONGEST instance per named family on the two outgoing channels.
 *
 * Effects are taken post-stacks (`value * stacks`), the same basis every other fold in this file
 * uses — so a stacking debuff's strength is its accumulated magnitude, not its per-stack value.
 * Entries touching neither channel are skipped entirely, which is what keeps the returned map
 * empty (and therefore the whole #389 delta a no-op) for the overwhelming majority of actors.
 */
export function outgoingFamiliesOf(buffs: SelectedGameBuff[]): OutgoingFamilyMap {
    const out: OutgoingFamilyMap = new Map();
    for (const b of buffs) {
        const attackPct = (b.parsedEffects.attack ?? 0) * b.stacks;
        const outgoingDamagePct = (b.parsedEffects.outgoingDamage ?? 0) * b.stacks;
        if (attackPct === 0 && outgoingDamagePct === 0) continue;
        const { familyKey } = deriveFamilyKey(b.buffName);
        const prev = out.get(familyKey);
        out.set(
            familyKey,
            prev === undefined
                ? { attackPct, outgoingDamagePct }
                : {
                      attackPct: strongerPct(prev.attackPct, attackPct),
                      outgoingDamagePct: strongerPct(prev.outgoingDamagePct, outgoingDamagePct),
                  }
        );
    }
    return out;
}

/**
 * The DELTA to add to an actor's already-folded self-sourced `attackBuff` / `outgoingDamageBuff`
 * so that the result is `Σ over families of the strongest instance, either side`.
 *
 * THE ARITHMETIC, and why it is a delta rather than a recomputation. The caller's totals already
 * contain the full self-sourced sum, and this function is deliberately not allowed to rebuild that
 * (it would have to re-derive layers it cannot see — the un-named `modifierAbilities` channel and
 * the squad-leader `preFight` baseline, neither of which is a named family and neither of which may
 * participate in shadowing). So for each family the ENEMY side contributes, it adds
 *
 *     strongest(selfValue, enemyValue) - selfValue
 *
 * which is `enemyValue - selfValue` when the applied instance wins (raising the total to exactly
 * the winner) and `0` when the self instance wins (leaving the total untouched). Families present
 * only on the self side are never visited, so they pass through unchanged. Both directions of the
 * ruling therefore fall out of one expression, and the no-enemy-debuff case returns `{0, 0}`
 * without even reading the self side.
 *
 * `selfBuffs` MUST be the same named-status lists the caller's own fold consumed, or the
 * subtraction removes something the total never contained. See the call site in playerTurn.ts.
 */
export function shadowedOutgoingDelta(
    enemyFamilies: OutgoingFamilyMap,
    selfBuffs: SelectedGameBuff[]
): OutgoingFamilyEntry {
    if (enemyFamilies.size === 0) return { attackPct: 0, outgoingDamagePct: 0 };
    const selfFamilies = outgoingFamiliesOf(selfBuffs);
    let attackPct = 0;
    let outgoingDamagePct = 0;
    for (const [familyKey, applied] of enemyFamilies) {
        const own = selfFamilies.get(familyKey);
        const ownAttack = own?.attackPct ?? 0;
        const ownOutgoing = own?.outgoingDamagePct ?? 0;
        attackPct += strongerPct(ownAttack, applied.attackPct) - ownAttack;
        outgoingDamagePct += strongerPct(ownOutgoing, applied.outgoingDamagePct) - ownOutgoing;
    }
    return { attackPct, outgoingDamagePct };
}
