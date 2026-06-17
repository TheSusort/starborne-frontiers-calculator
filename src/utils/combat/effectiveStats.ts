import { Ability } from '../../types/abilities';
import { SelectedGameBuff } from '../../types/calculator';
import { modifierTotalsFromAbilities } from '../abilities/applyAbilities';
import type { ConditionContext } from '../abilities/evaluateConditions';
import { toSimBuffs, toDotAndPenModifiers } from '../calculators/dpsBuffHelpers';
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
    /** Base only — defensePenetration BUFFS fold via toDotAndPenModifiers, NOT through
     *  foldActorBuffTotals, so a consumer must add the pen-buff term separately. */
    defensePenetration: number;
    /** Base max HP. hpBuff IS summed in foldActorBuffTotals but deliberately dropped here —
     *  in-fight HP changes track via currentHp, not the base stat. */
    hp: number;
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
    // Field-by-field sum is intentional: explicit enumeration preserves type-safety over a generic key reduce.
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

export interface EffectiveDamageStats {
    attack: number;
    defence: number;
    /** crit + critBuffTotal, UNCAPPED. The consumer applies the affinity cap (cappedCrit). */
    crit: number;
    critDamage: number;
    /** hp * (1 + hpBuff/100). Folded here (damage mode) — distinct from status-mode hp pass-through. */
    hp: number;
    /** base + base pen-buff + modifier pen + ability-DoT pen (the 4-source pipeline). */
    effectivePen: number;
    /** toDotAndPenModifiers(abilitySelfEffects, []).dotDamageModifier — self Out. DoT, for dotMult. */
    selfDotDamageModifier: number;
    /** Full summed buff totals (layers 1+2+3+4) — exposes outgoingDamage/heal channels for the turn loop. */
    totals: ReturnType<typeof calculateBuffTotals>;
}

/**
 * Damage-mode effective stats: folds the four layers the damage path uses, given resolved
 * ingredients (the turn loop owns gating/application and side effects — see the A1b plan).
 *   layer 1 = scheduledTotals (resolveSelfBuffTotals output)
 *   layers 2+3 = abilitySelfEffects (timed + gated active ability statuses, as SelectedGameBuff[])
 *   layer 4 = modifierAbilities gated by modifierCtx
 * Reproduces the inline fold in playerTurn.ts (runPlayerTurn) exactly.
 */
export function effectiveDamageStatsOf(args: {
    base: {
        attack: number;
        defence: number;
        crit: number;
        critDamage: number;
        hp: number;
        defensePenetration: number;
        defensePenetrationBuff: number;
    };
    scheduledTotals: ReturnType<typeof calculateBuffTotals>;
    abilitySelfEffects: SelectedGameBuff[];
    modifierAbilities: Ability[];
    modifierCtx: ConditionContext;
}): EffectiveDamageStats {
    const { base, scheduledTotals, abilitySelfEffects, modifierAbilities, modifierCtx } = args;
    const ability = calculateBuffTotals(toSimBuffs(abilitySelfEffects));
    const mod = modifierTotalsFromAbilities(modifierAbilities, modifierCtx);
    const dotPen = toDotAndPenModifiers(abilitySelfEffects, []);

    const totals: ReturnType<typeof calculateBuffTotals> = {
        attackBuff: scheduledTotals.attackBuff + ability.attackBuff + mod.attack,
        critBuff: scheduledTotals.critBuff + ability.critBuff + mod.crit,
        critDamageBuff: scheduledTotals.critDamageBuff + ability.critDamageBuff + mod.critDamage,
        outgoingDamageBuff:
            scheduledTotals.outgoingDamageBuff + ability.outgoingDamageBuff + mod.outgoingDamage,
        defenceBuff: scheduledTotals.defenceBuff + ability.defenceBuff + mod.defence,
        hpBuff: scheduledTotals.hpBuff + ability.hpBuff + mod.hp,
        outgoingHealBuff: scheduledTotals.outgoingHealBuff + ability.outgoingHealBuff,
        incomingHealBuff: scheduledTotals.incomingHealBuff + ability.incomingHealBuff,
        speedBuff: scheduledTotals.speedBuff + ability.speedBuff,
    };

    return {
        attack: base.attack * (1 + totals.attackBuff / 100),
        defence: base.defence * (1 + totals.defenceBuff / 100),
        crit: base.crit + totals.critBuff,
        critDamage: base.critDamage + totals.critDamageBuff,
        hp: base.hp * (1 + totals.hpBuff / 100),
        effectivePen:
            base.defensePenetration +
            base.defensePenetrationBuff +
            mod.defensePenetration +
            dotPen.defensePenetrationBuff,
        selfDotDamageModifier: dotPen.dotDamageModifier,
        totals,
    };
}
