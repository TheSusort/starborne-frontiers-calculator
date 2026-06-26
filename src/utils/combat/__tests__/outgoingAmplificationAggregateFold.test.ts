/**
 * D-PR4 Task 6 — aggregate-path in-flight outgoing amplification fold (firing hit only).
 *
 * Pins the new `targetEffectiveAttack` / `rollOutgoingProc` inputs to `runPlayerTurn`
 * at the unit level (mirrors incomingReductionAggregateFold.test.ts harness).
 *
 * Baseline math (attack=10000, multiplier=100, hits=3, 0 defence/buffs):
 *   effectiveMultiplier = 300 → preCritDamage = 10000 × 3.0 = 30000.
 *   critDamage = 100 → at 100% crit damageCritMultiplier = 1 + 1×(100/100) = 2.0
 *   → baseline directDamage (100% crit) = 60000.
 *
 * Outgoing amplification (Menace/Giant Slayer) applies to the FIRING hit only and only
 * when an amplification ability is present AND rollOutgoingProc is supplied. With every
 * drawn hit critting and the proc always firing, every hit is amplified by ampPct →
 * directDamage = baseline × (1 + ampPct/100).
 */
import { describe, expect, it } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';

function makeRuntime(
    critAlwaysFires: boolean,
    passiveAbilities: Ability[] = []
): PlayerActorRuntime {
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 10000,
            crit: critAlwaysFires ? 100 : 0,
            critDamage: 100,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 20000,
            speed: 100,
        },
        chargeCount: 0,
        startCharged: false,
    });
    const alwaysFire: PlayerActorRuntime['activeCritGate'] = () => true;
    const neverFire: PlayerActorRuntime['activeCritGate'] = () => false;
    const gate = critAlwaysFires ? alwaysFire : neverFire;
    const slots: ShipSkills['slots'] = [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'dmg-agg1',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100, hits: 3 },
                },
            ],
        },
    ];
    if (passiveAbilities.length > 0) {
        slots.push({ slot: 'passive', abilities: passiveAbilities });
    }
    const skills: ShipSkills = { slots };
    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: false,
        attack: 10000,
        crit: critAlwaysFires ? 100 : 0,
        critDamage: 100,
        defensePenetration: 0,
        defence: 0,
        hp: 20000,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        activeCritGate: gate,
        chargedCritGate: gate,
        activeHealCritGate: neverFire,
        chargedHealCritGate: neverFire,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

function makeArgs(runtime: PlayerActorRuntime, extra?: Partial<PlayerTurnArgs>): PlayerTurnArgs {
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
            defence: 0,
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
        enemyDefense: 0,
        enemyHp: 10_000_000,
        enemyType: undefined,
        bus: createEventBus(),
        round: 1,
        ...extra,
    };
}

function menaceAbility(ampPct: number, procChance: number): Ability {
    return {
        id: 'menace-1',
        type: 'outgoing-amplification',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'outgoing-amplification',
            condition: 'amplify-on-crit',
            ampPct,
            procChance,
        },
    };
}

function giantSlayerAbility(ampPct: number, procChance: number): Ability {
    return {
        id: 'giant-slayer-1',
        type: 'outgoing-amplification',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'outgoing-amplification',
            condition: 'amplify-vs-higher-attack',
            ampPct,
            procChance,
        },
    };
}

describe('aggregate-path outgoing amplification fold (firing hit only)', () => {
    it('Menace (amplify-on-crit) on a 100% crit, proc always fires → baseline × 1.30', () => {
        const baseline = runPlayerTurn(makeArgs(makeRuntime(true, [menaceAbility(30, 0.5)])));
        // No rollOutgoingProc supplied → byte-identical baseline.
        expect(baseline.directDamage).toBe(60000);
        const amplified = runPlayerTurn(
            makeArgs(makeRuntime(true, [menaceAbility(30, 0.5)]), {
                rollOutgoingProc: () => true,
            })
        );
        expect(amplified.directDamage).toBe(60000 * 1.3);
    });

    it('Menace present but rollOutgoingProc ABSENT → byte-identical baseline', () => {
        const out = runPlayerTurn(makeArgs(makeRuntime(true, [menaceAbility(30, 0.5)])));
        expect(out.directDamage).toBe(60000);
    });

    it('Giant Slayer (amplify-vs-higher-attack) with target attack ABOVE → baseline × 1.5', () => {
        const baseline = runPlayerTurn(makeArgs(makeRuntime(true, [giantSlayerAbility(50, 0.5)])));
        expect(baseline.directDamage).toBe(60000);
        const amplified = runPlayerTurn(
            makeArgs(makeRuntime(true, [giantSlayerAbility(50, 0.5)]), {
                rollOutgoingProc: () => true,
                targetEffectiveAttack: 99999, // above attacker's 10000
            })
        );
        expect(amplified.directDamage).toBe(60000 * 1.5);
    });

    it('Giant Slayer with target attack BELOW (or absent) → baseline (inert)', () => {
        const below = runPlayerTurn(
            makeArgs(makeRuntime(true, [giantSlayerAbility(50, 0.5)]), {
                rollOutgoingProc: () => true,
                targetEffectiveAttack: 1, // below attacker's 10000
            })
        );
        expect(below.directDamage).toBe(60000);
        const absent = runPlayerTurn(
            makeArgs(makeRuntime(true, [giantSlayerAbility(50, 0.5)]), {
                rollOutgoingProc: () => true,
            })
        );
        expect(absent.directDamage).toBe(60000);
    });
});
