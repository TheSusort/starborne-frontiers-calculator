import { calculateDamageReduction } from '../autogear/priorityScore';
import { ShipSkills } from '../../types/abilities';
import { selectFiringSkill, damageInputsFromSkill } from '../abilities/applyAbilities';
import { CombatActor } from './state';
import { RateGate } from './playerTurn';

/** Everything one enemy attacker's turns need. Built once at engine setup. */
export interface EnemyAttackerRuntime {
    actor: CombatActor;
    /** Damage-abilities-only walk (basics walk, spec decision 9). Absent → one basic
     *  attack per turn (manual flat card). */
    castSkills?: ShipSkills;
    hasChargedSkill: boolean;
    activeCritGate: RateGate;
    chargedCritGate: RateGate;
}

export interface EnemyAttackResult {
    /** Damage thrown at the target this turn (pre-shield). 0 when the target is dead. */
    damage: number;
    action: 'active' | 'charged';
}

/**
 * One enemy attacker turn: charge cadence mirroring the team-actor block
 * (+1/turn, fire-and-reset at chargeCount; no bonus/ally charges reach enemies —
 * spec decision 9), then damage vs the target's current effective defence:
 *   manual: one hit at multiplier 100%.
 *   walk: the firing slot's damage ability (multiplier × hits, per-hit crit draws,
 *         noCrit respected). Non-damage abilities are SKIPPED (Phase 4).
 * Blended per-hit crit multiplier mirrors the player pipeline:
 *   1 + (critHits/hits) × (critDamage/100).
 * No enemy buffs/affinity/outgoing modifiers — enemies are bare-stat actors.
 *
 * The cadence runs EVEN vs a dead target (charges keep banking — a re-spawned/revived
 * target would face a correctly-charged attacker), but a dead target takes 0 damage.
 */
export function runEnemyAttackerTurn(args: {
    runtime: EnemyAttackerRuntime;
    targetDefence: number; // target's current effective defence (ctx or base fallback)
    targetDead: boolean;
}): EnemyAttackResult {
    const { runtime, targetDefence, targetDead } = args;
    const { actor, castSkills, hasChargedSkill } = runtime;

    // Charge cadence — mirrors the team-actor block in engine.ts. Bank +1 per turn; once
    // banked charges reach chargeCount the charged skill fires and resets. No bonus/ally
    // charges reach enemies (spec decision 9). A manual flat card (no skill) has no charge
    // skill — hasChargedSkill is false there, so it always fires 'active'.
    let action: 'active' | 'charged';
    if (hasChargedSkill && actor.chargeCount > 0 && actor.charges >= actor.chargeCount) {
        action = 'charged';
        actor.charges = 0;
    } else {
        action = 'active';
        if (hasChargedSkill && actor.chargeCount > 0) actor.charges += 1;
    }

    // Dead target → no damage, but the cadence above already advanced.
    if (targetDead) {
        return { damage: 0, action };
    }

    // Resolve this turn's damage inputs. Manual: a single basic attack at 100% multiplier,
    // one hit, crit-eligible. Walk: the firing slot's first damage ability (multiplier × hits,
    // noCrit honoured) — a slot with no damage ability contributes multiplier 0 → 0 damage.
    let multiplier: number;
    let hits: number;
    let noCrit: boolean;
    if (castSkills) {
        const skill = selectFiringSkill(castSkills, action);
        const inputs = damageInputsFromSkill(skill);
        multiplier = inputs.multiplier;
        hits = inputs.hits;
        noCrit = inputs.noCrit;
    } else {
        multiplier = 100;
        hits = 1;
        noCrit = false;
    }

    if (multiplier <= 0) {
        return { damage: 0, action };
    }

    // Per-hit crit draws (mirrors the player pipeline): draw the crit gate once per hit at
    // crit/100; the blended multiplier is 1 + (critHits/hits) × (critDamage/100). noCrit → no
    // draws (critMult 1). Use the action's gate so the charged stream is isolated from active.
    const gate = action === 'charged' ? runtime.chargedCritGate : runtime.activeCritGate;
    const drawHits = noCrit ? 0 : hits;
    let critHits = 0;
    for (let i = 0; i < drawHits; i++) {
        if (gate(actor.stats.crit / 100)) critHits += 1;
    }
    const critMult = drawHits > 0 ? 1 + (critHits / drawHits) * (actor.stats.critDamage / 100) : 1;

    const reduction = targetDefence > 0 ? calculateDamageReduction(targetDefence) : 0;
    const damage =
        actor.stats.attack * ((multiplier * hits) / 100) * critMult * (1 - reduction / 100);

    return { damage, action };
}
