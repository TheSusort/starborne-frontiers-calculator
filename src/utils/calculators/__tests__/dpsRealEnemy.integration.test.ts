import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../dpsSimulator';
import { setupKeyedTestRng, resetRateGateRng } from '../rateAccumulator';
import { DEFAULT_ATTACKER_SLOT, DEFAULT_ENEMY_SLOT } from '../dpsEnemyPlacement';
import type { ShipSkills } from '../../../types/abilities';

/**
 * A real enemy with no kit still ACTS — the engine synthesizes one basic attack per turn when
 * `shipSkills` is absent. Positions on BOTH sides are what make `isPositional` resolve a real
 * target instead of falling back to the vestigial dummy.
 */
const realEnemy = () => [
    {
        id: 'enemy-1',
        stats: {
            attack: 5000,
            crit: 0,
            critDamage: 150,
            speed: 40,
            defence: 1000,
            hp: 400000,
        },
        chargeCount: 0,
        startCharged: false,
        position: DEFAULT_ENEMY_SLOT,
    },
];

const plainDamageKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'a1',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
            ],
        },
    ],
});

const baseInput = (): DPSSimulationInput => ({
    attack: 20000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 10000,
    enemyHp: 500000,
    rounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    speed: 100,
    hp: 300000,
    shipSkills: plainDamageKit(),
});

describe('DPS calculator with a real positioned enemy', () => {
    beforeEach(() => {
        // `src/setupTests.ts` already seeds globally; re-seed explicitly so this file is
        // deterministic in isolation too. The rate gate keys on ownerId.
        setupKeyedTestRng(12345);
        resetRateGateRng();
    });

    it('routes the focus attacker damage to the REAL enemy, not the dummy', () => {
        const result = simulateDPS({
            ...baseInput(),
            position: DEFAULT_ATTACKER_SLOT,
            enemyAttackers: realEnemy(),
        });

        // perTargetDealt is attackerId -> victimId -> dealt. The focus actor id is 'attacker'.
        // Before positions were threaded, selectTurnTarget fell back to the dummy and this key
        // was absent entirely.
        const dealtToRealEnemy = result.rounds.reduce(
            (sum, r) => sum + (r.perTargetDealt?.['attacker']?.['enemy-1'] ?? 0),
            0
        );
        expect(dealtToRealEnemy).toBeGreaterThan(0);
    });

    it('drops the vestigial dummy from the turn order', () => {
        const actors: string[] = [];
        simulateDPS({
            ...baseInput(),
            position: DEFAULT_ATTACKER_SLOT,
            enemyAttackers: realEnemy(),
            bus: {
                on: () => {},
                emit: (e) => {
                    if (e.type === 'turn-started') actors.push(e.actorId);
                },
            },
        });

        // `dummyEnemyIsVestigial` requires every player actor to have a position AND an
        // enemy-side parsed target; satisfied, the dummy 'enemy' leaves the turn order.
        expect(new Set(actors)).toEqual(new Set(['attacker', 'enemy-1']));
        expect(actors).not.toContain('enemy');
    });

    it('honours an explicitly supplied target instead of the default', () => {
        const result = simulateDPS({
            ...baseInput(),
            position: DEFAULT_ATTACKER_SLOT,
            target: { raw: 'back enemy', side: 'enemy', selection: 'back' },
            enemyAttackers: realEnemy(),
        });

        const dealt = result.rounds.reduce(
            (sum, r) => sum + (r.perTargetDealt?.['attacker']?.['enemy-1'] ?? 0),
            0
        );
        // Only one enemy exists, so front and back resolve to it either way — this asserts the
        // explicit target is threaded and does not break resolution, not that it changes victim.
        expect(dealt).toBeGreaterThan(0);
    });
});
