import { describe, it, expect } from 'vitest';
import { LIVE_TRIGGERS } from '../../../types/abilities';
import type { Ability, ShipSkills } from '../../../types/abilities';
import {
    registerReactiveListeners,
    partitionReactiveAbilities,
    executeIntent,
    Intent,
    IntentExecContext,
} from '../triggers';
import { createEventBus } from '../events';
import { createStatusEngine } from '../statusEngine';
import type { PlayerActorRuntime, PlayerRoundCtx } from '../playerTurn';
import type { CombatActor } from '../state';

describe('Phase 4c PR 4 — enemy-action triggers', () => {
    it('registers on-enemy-repaired and on-enemy-cleansed as live triggers', () => {
        expect(LIVE_TRIGGERS.has('on-enemy-repaired')).toBe(true);
        expect(LIVE_TRIGGERS.has('on-enemy-cleansed')).toBe(true);
    });

    function reactiveAbility(trigger: Ability['trigger']): Ability {
        return {
            id: `${trigger}-ab`,
            type: 'charge',
            target: 'self',
            trigger,
            conditions: [],
            config: { type: 'charge', amount: 1 },
        };
    }

    it('on-enemy-repaired enqueues only for enemy-side heal-performed', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: 'zosimos',
                    reactiveAbilities: [
                        { ability: reactiveAbility('on-enemy-repaired'), sourceSlot: 'passive' },
                    ],
                },
            ],
            enqueue: (i) => enqueued.push(i),
            isEnemySide: (id) => id === 'enemy',
        });
        bus.emit({
            type: 'heal-performed',
            casterId: 'enemy',
            targets: ['enemy'],
            round: 1,
            amount: 0,
        });
        bus.emit({
            type: 'heal-performed',
            casterId: 'ally',
            targets: ['tank'],
            round: 1,
            amount: 100,
        });
        expect(enqueued).toHaveLength(1);
    });

    it('on-enemy-cleansed enqueues only for enemy-side cleanse-performed', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: 'grif',
                    reactiveAbilities: [
                        { ability: reactiveAbility('on-enemy-cleansed'), sourceSlot: 'passive' },
                    ],
                },
            ],
            enqueue: (i) => enqueued.push(i),
            isEnemySide: (id) => id === 'enemy',
        });
        bus.emit({ type: 'cleanse-performed', casterId: 'enemy', count: 1, round: 1 });
        bus.emit({ type: 'cleanse-performed', casterId: 'ally', count: 1, round: 1 });
        expect(enqueued).toHaveLength(1);
    });

    it('routes a damage ability with a live trigger to the reactive path', () => {
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'passive',
                    abilities: [
                        {
                            id: 'grif-dmg',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-enemy-cleansed',
                            conditions: [],
                            config: { type: 'damage', multiplier: 0.75, noCrit: true },
                        },
                        {
                            id: 'normal-dmg',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 1 },
                        },
                    ],
                },
            ],
        };
        const { reactiveAbilities, castSkills } = partitionReactiveAbilities(shipSkills);
        expect(reactiveAbilities.map((r) => r.ability.id)).toEqual(['grif-dmg']);
        expect(castSkills.slots[0].abilities.map((a) => a.id)).toEqual(['normal-dmg']);
    });
});

// ----------------------------------------------------------------------
// Phase 4c PR 4 Task 4: reactive direct-damage executor branch (Grif).
//
// A `damage` intent folds the owner's last-turn ctx bomb-style
// (effectiveAttack × multiplier × affinityMult — NO defense, NO crit) and
// credits it via creditReactiveDamage. Before the owner's first turn (no
// lastTurnCtx entry) it skips, exactly like a bomb follow-up.
// ----------------------------------------------------------------------
describe('Phase 4c PR 4 Task 4: damage reactive executor branch', () => {
    const makeRuntime = (id: string): PlayerActorRuntime =>
        ({
            actor: { id } as CombatActor,
            landsTimedEnemyApplication: () => true,
            debuffLandingGate: (_rate: number) => true,
            debuffLandingChance: 1,
        }) as unknown as PlayerActorRuntime;

    const makePlayerRoundCtx = (effectiveAttack: number, affinityMult: number): PlayerRoundCtx => ({
        effectiveAttack,
        dotMult: 1,
        affinityMult,
        effectiveDefence: 0,
        effectiveMaxHp: 0,
        outgoingHealPct: 0,
        incomingHealPct: 0,
    });

    const makeExecCtx = (
        overrides: Partial<IntentExecContext> & Pick<IntentExecContext, 'creditReactiveDamage'>
    ): IntentExecContext => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        return {
            round: 1,
            enemy: { id: 'enemy-default' } as CombatActor,
            enemyId: 'enemy-default',
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([
                ['grif', makeRuntime('grif')],
                ['grif-noctx', makeRuntime('grif-noctx')],
            ]),
            grantAllyCharges: () => {},
            grantExtraAction: () => {},
            playerIds: ['grif'],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
            ...overrides,
        };
    };

    const makeDamageIntent = (ownerId: string): Intent => ({
        ownerId,
        sourceSlot: 'passive',
        ability: {
            id: 'grif-dmg',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-enemy-cleansed',
            conditions: [],
            config: { type: 'damage', multiplier: 0.75, noCrit: true },
        },
    });

    it('credits owner pool with bomb-style fold, skips without ctx', () => {
        const credited: { ownerId: string; amount: number }[] = [];
        const ctx = makeExecCtx({
            creditReactiveDamage: (ownerId, amount) => credited.push({ ownerId, amount }),
            lastTurnCtxByActor: new Map([['grif', makePlayerRoundCtx(1000, 1.5)]]),
        });

        executeIntent(makeDamageIntent('grif'), ctx);
        expect(credited).toEqual([{ ownerId: 'grif', amount: 1000 * 0.75 * 1.5 }]);

        credited.length = 0;
        executeIntent(makeDamageIntent('grif-noctx'), ctx);
        expect(credited).toHaveLength(0);
    });
});
