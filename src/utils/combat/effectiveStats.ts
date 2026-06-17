import { SelectedGameBuff } from '../../types/calculator';
import { toSimBuffs } from '../calculators/dpsBuffHelpers';
import { StatusEngine } from './statusEngine';
import { CombatActor } from './state';
import { calculateBuffTotals, payloadToSelectedBuff } from './playerTurn';

export interface EffectiveStats {
    attack: number;
    defence: number;
    /** crit + critBuff, BEFORE the affinity cap (cappedCrit stays at the consumer — it needs
     *  affinity context the snapshot doesn't carry). */
    crit: number;
    critDamage: number;
    defensePenetration: number;
    hp: number; // pure pass-through (no in-fight HP buffs); never folded
    speed: number;
    hacking: number; // base pass-through in A1a; buff-fold wired in A2
    security: number; // base pass-through in A1a; A2
}

/**
 * Sum an actor's live self-buff totals from the same two sources foldSpeedBuffPct uses
 * (scheduled self-buffs + timed ability statuses). Generalizes foldSpeedBuffPct to the full
 * calculateBuffTotals shape.
 */
export function foldActorBuffTotals(
    statusEngine: StatusEngine,
    selfBuffLookup: Map<string, SelectedGameBuff[]>,
    actorId: string
): ReturnType<typeof calculateBuffTotals> {
    const scheduledSelfBuffs = statusEngine.snapshot(actorId).activeSelfBuffs.flatMap((ab) => {
        const bufs = selfBuffLookup.get(ab.buffName) ?? [];
        return ab.stacks !== undefined
            ? ab.stacks > 0
                ? bufs.map((b) => ({ ...b, stacks: ab.stacks! }))
                : []
            : bufs;
    });
    const timedEffects = statusEngine
        .timedAbilityStatuses('self', actorId)
        .map((s) => payloadToSelectedBuff(s.payload));
    const scheduled = calculateBuffTotals(toSimBuffs(scheduledSelfBuffs));
    const timed = calculateBuffTotals(toSimBuffs(timedEffects));
    return {
        attackBuff: scheduled.attackBuff + timed.attackBuff,
        critBuff: scheduled.critBuff + timed.critBuff,
        critDamageBuff: scheduled.critDamageBuff + timed.critDamageBuff,
        outgoingDamageBuff: scheduled.outgoingDamageBuff + timed.outgoingDamageBuff,
        defenceBuff: scheduled.defenceBuff + timed.defenceBuff,
        hpBuff: scheduled.hpBuff + timed.hpBuff,
        outgoingHealBuff: scheduled.outgoingHealBuff + timed.outgoingHealBuff,
        incomingHealBuff: scheduled.incomingHealBuff + timed.incomingHealBuff,
        speedBuff: scheduled.speedBuff + timed.speedBuff,
    };
}

export function effectiveStatsOf(
    statusEngine: StatusEngine,
    selfBuffLookup: Map<string, SelectedGameBuff[]>,
    actor: CombatActor
): EffectiveStats {
    const t = foldActorBuffTotals(statusEngine, selfBuffLookup, actor.id);
    const s = actor.stats;
    return {
        attack: s.attack * (1 + t.attackBuff / 100),
        defence: s.defence * (1 + t.defenceBuff / 100),
        crit: s.crit + t.critBuff,
        critDamage: s.critDamage + t.critDamageBuff,
        defensePenetration: s.defensePenetration,
        hp: s.hp,
        speed: s.speed * (1 + t.speedBuff / 100),
        hacking: s.hacking ?? 0,
        security: s.security ?? 0,
    };
}
