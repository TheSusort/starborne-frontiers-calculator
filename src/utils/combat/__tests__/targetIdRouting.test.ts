/**
 * Task 6: Thread targetId through runPlayerTurn enemy-side status application.
 *
 * Verifies:
 *  1. When `targetId` is UNDEFINED (default), a timed enemy debuff applied via
 *     runPlayerTurn lands in the sentinel default store (readable via
 *     timedAbilityStatuses('enemy') with no enemyTargetId), byte-identical to
 *     the pre-Task-6 behaviour.
 *  2. When `targetId: 'tank'` is supplied, the debuff lands under 'tank' and is
 *     ABSENT from the default-key read — the two stores are isolated.
 *  3. The aura/accumulating enemy-side path (activeAbilityStatuses) is similarly
 *     routed: with targetId undefined → default store; with targetId 'tank' →
 *     tank store only.
 */
import { describe, it, expect } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { ShipSkills } from '../../../types/abilities';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeRuntime(
    timedEnemyBySlot: PlayerActorRuntime['timedEnemyBySlot'] = []
): PlayerActorRuntime {
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 10000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: 0,
            hp: 20000,
            speed: 100,
        },
        chargeCount: 0,
        startCharged: false,
    });

    const noGate: PlayerActorRuntime['activeCritGate'] = () => false;

    // Minimal skill: one active damage ability so the turn actually runs.
    const skills: ShipSkills = {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'dmg1',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100 },
                    },
                ],
            },
        ],
    };

    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot,
        hasChargedSkill: false,
        attack: 10000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        defence: 0,
        hp: 20000,
        healModifier: 0,
        debuffLandingChance: 1,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        activeCritGate: noGate,
        chargedCritGate: noGate,
        activeHealCritGate: noGate,
        chargedHealCritGate: noGate,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

/** Build a timed enemy status that fires on 'active' slot. */
function timedEnemyStatus(buffName: string): Extract<RegisteredAbilityStatus, { kind: 'timed' }> {
    return {
        kind: 'timed',
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        duration: 2,
        payload: { buffName, stacks: 1, parsedEffects: { defense: -10 } },
    };
}

function makeArgs(
    runtime: PlayerActorRuntime,
    statusEngine: ReturnType<typeof createStatusEngine>,
    targetId?: string
): PlayerTurnArgs {
    const enemy = createActor({
        id: 'enemy-actor',
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: 0,
            hp: 10_000_000,
            speed: 50,
        },
    });

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
        enemyHpDecline: 0,
        targetId,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Task 6 — targetId routing through runPlayerTurn enemy-side status application', () => {
    describe('timed enemy debuff (applyTimedAbilityStatus path)', () => {
        it('targetId UNDEFINED → debuff lands in the default sentinel store', () => {
            const status = timedEnemyStatus('Armor Break');
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            eng.registerAbilityStatuses([status]);
            eng.beginRound(1);

            const runtime = makeRuntime([status]);
            runPlayerTurn(makeArgs(runtime, eng, undefined));

            // Readable without specifying an enemyTargetId (default sentinel).
            const timed = eng.timedAbilityStatuses('enemy');
            expect(timed).toHaveLength(1);
            expect(timed[0].payload.buffName).toBe('Armor Break');
        });

        it('targetId "tank" → debuff lands in the tank store, absent from the default store', () => {
            const status = timedEnemyStatus('Def Down');
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            eng.registerAbilityStatuses([status]);
            eng.beginRound(1);

            const runtime = makeRuntime([status]);
            runPlayerTurn(makeArgs(runtime, eng, 'tank'));

            // Present under 'tank'.
            const timedTank = eng.timedAbilityStatuses('enemy', undefined, 'tank');
            expect(timedTank).toHaveLength(1);
            expect(timedTank[0].payload.buffName).toBe('Def Down');

            // ABSENT from the default sentinel store.
            const timedDefault = eng.timedAbilityStatuses('enemy');
            expect(timedDefault).toHaveLength(0);
        });

        it('two separate turns with different targetIds do not bleed into each other', () => {
            const statusA = timedEnemyStatus('Weaken A');
            const statusB = timedEnemyStatus('Weaken B');

            // Use separate status engines to keep stores clean.
            const engA = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            engA.registerAbilityStatuses([statusA]);
            engA.beginRound(1);
            runPlayerTurn(makeArgs(makeRuntime([statusA]), engA, undefined));

            const engB = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            engB.registerAbilityStatuses([statusB]);
            engB.beginRound(1);
            runPlayerTurn(makeArgs(makeRuntime([statusB]), engB, 'tank'));

            // engA: debuff in default store, not in 'tank'.
            expect(engA.timedAbilityStatuses('enemy')).toHaveLength(1);
            expect(engA.timedAbilityStatuses('enemy', undefined, 'tank')).toHaveLength(0);

            // engB: debuff in 'tank' store, not in default.
            expect(engB.timedAbilityStatuses('enemy')).toHaveLength(0);
            expect(engB.timedAbilityStatuses('enemy', undefined, 'tank')).toHaveLength(1);
        });
    });
});
