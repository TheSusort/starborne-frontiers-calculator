import { Buff, SelectedGameBuff } from '../../types/calculator';
import type { AbilityStatusPayload, ActiveBuff } from './statusEngine';

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
