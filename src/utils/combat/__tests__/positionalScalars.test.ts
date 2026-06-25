/**
 * Task 7 — integration-boundary parity guard for PlayerTurnResult.positionalScalars.
 *
 * The positional apply path (Task 8) feeds the per-cast attacker-side scalars exposed on
 * PlayerTurnResult.positionalScalars (+ hitCrits) through victimHitDamage for EACH bound
 * victim. This test pins that, for the SINGLE bound enemy the engine already damages, the
 * per-hit sum reproduces the turn's aggregate directDamage EXACTLY.
 *
 * Setup uses a multi-hit damage skill with NO passive payload, so directDamage is purely the
 * firing hit (preCritDamage * postDefenseFactor) with no separate passive bucket — making the
 * per-hit victimHitDamage sum a clean equality target.
 *
 * The affinity field is the crux: the runtime carries the PRE-RESOLVED affinityDamageModifier
 * (+25 advantage), and positionalScalars.attackerAffinity must be the raw affinity that, fed
 * with the victim's affinity through computeAffinityModifiers, reproduces that same modifier.
 */
import { describe, expect, it } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { victimHitDamage, VictimDefenseProfile } from '../victimDamage';
import { AffinityName } from '../../../types/ship';

// thermal > chemical → +25% advantage. The runtime's pre-resolved modifier must match.
const ATTACKER_AFFINITY: AffinityName = 'thermal';
const VICTIM_AFFINITY: AffinityName = 'chemical';
const AFFINITY_DAMAGE_MODIFIER = 25;

const ENEMY_DEFENCE = 850;
// enemyDefenseModifier is engine-derived from enemy debuffs; none applied here → 0.
const ENEMY_DEFENCE_MODIFIER_PCT = 0;

function makeRuntime(skills: ShipSkills): PlayerActorRuntime {
    // Crit gate that crits on every other hit (deterministic, mixed crit pattern).
    let n = 0;
    const everyOther: PlayerActorRuntime['activeCritGate'] = () => {
        n += 1;
        return n % 2 === 0;
    };
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 12000,
            crit: 50,
            critDamage: 65,
            defensePenetration: 20,
            shieldPenetration: 0,
            defence: 0,
            hp: 20000,
            speed: 100,
        },
        chargeCount: 0,
        startCharged: false,
    });

    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: false,
        attack: 12000,
        crit: 50,
        critDamage: 65,
        defensePenetration: 20,
        defence: 0,
        hp: 20000,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: AFFINITY_DAMAGE_MODIFIER,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        attackerAffinity: ATTACKER_AFFINITY,
        activeCritGate: everyOther,
        chargedCritGate: everyOther,
        activeHealCritGate: () => false,
        chargedHealCritGate: () => false,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

function makeArgs(runtime: PlayerActorRuntime): PlayerTurnArgs {
    const enemy = createActor({
        id: 'enemy',
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: ENEMY_DEFENCE,
            hp: 10_000_000,
            speed: 50,
        },
    });

    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);

    return {
        runtime,
        enemy,
        statusEngine,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        enemyDefense: ENEMY_DEFENCE,
        enemyHp: 10_000_000,
        enemyType: undefined,
        bus: createEventBus(),
        round: 1,
    } as PlayerTurnArgs;
}

describe('PlayerTurnResult.positionalScalars — integration-boundary parity', () => {
    it('per-hit victimHitDamage sum over the bound enemy equals the turn directDamage', () => {
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'multi-hit',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 80, hits: 4 },
                        } as Ability,
                    ],
                },
            ],
        };

        const runtime = makeRuntime(skills);
        const result = runPlayerTurn(makeArgs(runtime));

        // positionalScalars must be populated for a damage cast.
        expect(result.positionalScalars).toBeDefined();
        const s = result.positionalScalars!;

        // The per-hit crit array matches the firing ability's hit count.
        expect(result.hitCrits).toHaveLength(4);

        // The bound enemy's defensive profile (mirrors the aggregate the engine used).
        const victim: VictimDefenseProfile = {
            defence: ENEMY_DEFENCE,
            defenceModifierPct: ENEMY_DEFENCE_MODIFIER_PCT,
            affinity: VICTIM_AFFINITY,
        };

        const sum = result.hitCrits.reduce(
            (acc, didCrit) => acc + victimHitDamage(s, victim, didCrit, 1),
            0
        );

        // No passive payload → directDamage is exactly the firing hit's aggregate.
        expect(sum).toBeCloseTo(result.directDamage, 8);
        expect(result.directDamage).toBeGreaterThan(0);
    });
});
