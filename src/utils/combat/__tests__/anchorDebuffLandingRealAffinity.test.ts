/**
 * SP2a: positional on-turn debuff landing uses anchor affinity, not representative.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate, setRateGateRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { ShipSkills } from '../../../types/abilities';
import { computeAffinityModifiers } from '../../calculators/affinityUtils';
import { liveDebuffLandingChance } from '../effectiveStats';

const applyDebuffSkill: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'apply-down',
                    type: 'debuff',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'debuff',
                        buffName: 'Defense Down',
                        parsedEffects: { defense: -50 },
                        stacks: 1,
                        isStackable: false,
                        application: 'apply',
                        duration: 3,
                    },
                },
            ],
        },
    ],
};

const inflictDebuffSkill: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'inflict-down',
                    type: 'debuff',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'debuff',
                        buffName: 'Disable',
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        application: 'inflict',
                        duration: 2,
                    },
                },
            ],
        },
    ],
};

function timedEnemySlot(
    buffName: string,
    application: 'apply' | 'inflict'
): PlayerActorRuntime['timedEnemyBySlot'] {
    return [
        {
            kind: 'timed',
            duration: application === 'apply' ? 3 : 2,
            side: 'enemy',
            sourceSlot: 'active',
            conditions: [],
            payload: {
                buffName,
                parsedEffects: application === 'apply' ? { defense: -50 } : {},
                application,
                stacks: 1,
            },
        },
    ];
}

function makeRuntime(
    skills: ShipSkills,
    timedEnemyBySlot: PlayerActorRuntime['timedEnemyBySlot']
): PlayerActorRuntime {
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 20000,
            speed: 100,
            hacking: 200,
        },
        chargeCount: 0,
        startCharged: false,
        affinity: 'chemical',
    });
    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot,
        hasChargedSkill: false,
        attack: 1000,
        crit: 0,
        critDamage: 0,
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
        attackerAffinity: 'chemical',
        activeCritGate: makeRateGate(),
        chargedCritGate: makeRateGate(),
        activeHealCritGate: makeRateGate(),
        chargedHealCritGate: makeRateGate(),
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

function makeArgs(
    runtime: PlayerActorRuntime,
    defer: boolean,
    enemySecurity = 100
): { args: PlayerTurnArgs; outcomes: string[] } {
    const enemy = createActor({
        id: 'anchor',
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 1e9,
            speed: 50,
            security: enemySecurity,
        },
        affinity: 'thermal',
    });
    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);
    const bus = createEventBus();
    const outcomes: string[] = [];
    bus.on('debuff-applied', () => outcomes.push('applied'));
    bus.on('debuff-resisted', () => outcomes.push('resisted'));
    return {
        args: {
            runtime,
            enemy,
            statusEngine,
            corrosionEntries: [],
            infernoEntries: [],
            genericDoTEntries: [],
            pendingBombs: [],
            pendingAccumulators: [],
            enemyDefense: 0,
            enemyHp: 1e9,
            enemyType: undefined,
            bus,
            round: 1,
            targetId: 'anchor',
            deferAbilityPerformedToEngine: defer,
        },
        outcomes,
    };
}

describe('anchor debuff landing at real affinity (SP2a)', () => {
    afterEach(() => resetRateGateRng());

    it("'apply' debuff resists on positional path when anchor is disadvantage; lands on non-positional", () => {
        const runtime = makeRuntime(applyDebuffSkill, timedEnemySlot('Defense Down', 'apply'));

        const { args: posArgs, outcomes: posOutcomes } = makeArgs(runtime, true);
        runPlayerTurn(posArgs);
        expect(posOutcomes).toEqual(['resisted']);

        const { args: npArgs, outcomes: npOutcomes } = makeArgs(
            makeRuntime(applyDebuffSkill, timedEnemySlot('Defense Down', 'apply')),
            false
        );
        runPlayerTurn(npArgs);
        expect(npOutcomes).toEqual(['applied']);
    });

    it("'inflict' debuff lands at representative rate but resists at anchor disadvantage rate", () => {
        const security = 150;
        const landingAttacker = createActor({
            id: 'attacker',
            side: 'player',
            kind: 'attacker',
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                shieldPenetration: 0,
                defence: 0,
                hp: 20000,
                speed: 100,
                hacking: 200,
            },
            affinity: 'chemical',
        });
        const landingDefender = createActor({
            id: 'anchor',
            side: 'enemy',
            kind: 'enemy',
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                shieldPenetration: 0,
                defence: 0,
                hp: 1e9,
                speed: 50,
                security,
            },
            affinity: 'thermal',
        });
        const landingEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        landingEngine.beginRound(1);
        const repRate = liveDebuffLandingChance(
            landingEngine,
            new Map(),
            landingAttacker,
            landingDefender,
            0
        );
        const anchorMod = computeAffinityModifiers('chemical', 'thermal').damageModifier;
        const anchorRate = liveDebuffLandingChance(
            landingEngine,
            new Map(),
            landingAttacker,
            landingDefender,
            anchorMod
        );
        expect(repRate).toBeGreaterThan(anchorRate);
        const draw = (repRate + anchorRate) / 2;
        expect(draw).toBeLessThan(repRate);
        expect(draw).toBeGreaterThanOrEqual(anchorRate);

        setRateGateRng(() => draw);

        const runtime = makeRuntime(inflictDebuffSkill, timedEnemySlot('Disable', 'inflict'));
        const { args: posArgs, outcomes: posOutcomes } = makeArgs(runtime, true, security);
        runPlayerTurn(posArgs);
        expect(posOutcomes).toEqual(['resisted']);

        setRateGateRng(() => draw);

        const { args: npArgs, outcomes: npOutcomes } = makeArgs(
            makeRuntime(inflictDebuffSkill, timedEnemySlot('Disable', 'inflict')),
            false,
            security
        );
        runPlayerTurn(npArgs);
        expect(npOutcomes).toEqual(['applied']);
    });
});
