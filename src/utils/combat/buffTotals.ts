import { Buff, SelectedGameBuff } from '../../types/calculator';
import type { AbilityStatusPayload } from './statusEngine';

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
    };
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
