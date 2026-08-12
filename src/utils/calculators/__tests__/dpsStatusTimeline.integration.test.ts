/**
 * SP-2 Task 1: simulateDPS collects the engine's LOG-ONLY snapshot events onto RoundData.
 *
 * Non-vacuity anchors:
 *  - `enemy-1` carrying its own `Attack Down` proves the SP-1 premise (a real enemy keys its
 *    debuffs under its OWN id; the pre-SP-1 dummy keyed them under the `__enemy__` sentinel and
 *    this assertion would come back empty).
 *  - The extra-action case proves the per-TURN (not per-round) granularity the weighting rule needs.
 *  - The with-bus/without-bus equality proves the collector is a pure tap (Phase 3 emit-only
 *    contract): the sim's own numbers must not move because someone is watching.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../dpsSimulator';
import { setupKeyedTestRng, resetRateGateRng } from '../rateAccumulator';
import { DEFAULT_ATTACKER_SLOT, DEFAULT_ENEMY_SLOT } from '../dpsEnemyPlacement';
import type { ShipSkills } from '../../../types/abilities';

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
            security: 0,
        },
        chargeCount: 0,
        startCharged: false,
        position: DEFAULT_ENEMY_SLOT,
    },
];

/** Active slot: damage + a self buff + an enemy debuff, all on-cast. */
const kit = (): ShipSkills => ({
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
                {
                    id: 'a2',
                    type: 'debuff',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'debuff',
                        buffName: 'Attack Down',
                        parsedEffects: { attack: -30 },
                        stacks: 1,
                        isStackable: false,
                        duration: 3,
                        // 'apply' is the guaranteed verb — an 'inflict' debuff can be RESISTED,
                        // which would make this fixture flaky against the landing-chance roll.
                        application: 'apply',
                    },
                },
                {
                    id: 'a3',
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Attack Up',
                        parsedEffects: { attack: 30 },
                        stacks: 1,
                        isStackable: false,
                        duration: 3,
                    },
                },
            ],
        },
    ],
});

/** Same kit plus a once-per-round extra action, so the focus takes TWO turns per round. */
const kitWithExtraAction = (): ShipSkills => ({
    slots: [
        ...kit().slots,
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'p1',
                    type: 'extra-action',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'extra-action', oncePerRound: true },
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
    hacking: 500,
    shipSkills: kit(),
    position: DEFAULT_ATTACKER_SLOT,
    enemyAttackers: realEnemy(),
});

describe('SP-2 status timeline collection', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        resetRateGateRng();
    });

    it('attaches one focus stats snapshot per focus turn when the flag is set', () => {
        const result = simulateDPS({ ...baseInput(), collectStatusTimeline: true });

        expect(result.rounds).toHaveLength(3);
        for (const round of result.rounds) {
            expect(round.focusStatsSnapshots).toHaveLength(1);
        }
        // Turn-START semantics: round 1's snapshot predates the cast that grants Attack Up, so it
        // reads the raw base attack; rounds 2+ read it buffed (+30%).
        expect(result.rounds[0].focusStatsSnapshots![0].attack).toBe(20000);
        expect(result.rounds[1].focusStatsSnapshots![0].attack).toBe(26000);
    });

    it('records TWO focus snapshots in a round where an extra action grants a second turn', () => {
        const result = simulateDPS({
            ...baseInput(),
            shipSkills: kitWithExtraAction(),
            collectStatusTimeline: true,
        });

        expect(result.rounds[0].focusStatsSnapshots).toHaveLength(2);
    });

    it('records the real enemy debuff names under the enemy actor id, not the dummy', () => {
        const result = simulateDPS({ ...baseInput(), collectStatusTimeline: true });

        // SP-1 is what makes this non-empty. Keyed by actor id — the dummy ('enemy') must not
        // appear at all, since it is not in the real roster.
        expect(result.rounds[0].enemyStatuses).toBeDefined();
        expect(Object.keys(result.rounds[0].enemyStatuses!)).toEqual(['enemy-1']);
        expect(result.rounds[0].enemyStatuses!['enemy-1'].debuffNames).toContain('Attack Down');
        expect(result.rounds[0].enemyStatuses).not.toHaveProperty('enemy');
    });

    it('records the focus actor round-tail buff names', () => {
        const result = simulateDPS({ ...baseInput(), collectStatusTimeline: true });

        expect(result.rounds[0].focusStatuses?.buffNames).toContain('Attack Up');
    });

    it('attaches nothing when the flag is absent (goldens stay byte-identical)', () => {
        const result = simulateDPS(baseInput());

        for (const round of result.rounds) {
            expect(round.focusStatsSnapshots).toBeUndefined();
            expect(round.focusStatuses).toBeUndefined();
            expect(round.enemyStatuses).toBeUndefined();
        }
    });

    it('does not change any damage number when collecting', () => {
        setupKeyedTestRng(12345);
        resetRateGateRng();
        const off = simulateDPS(baseInput());
        setupKeyedTestRng(12345);
        resetRateGateRng();
        const on = simulateDPS({ ...baseInput(), collectStatusTimeline: true });

        expect(on.summary).toEqual(off.summary);
        expect(on.rounds.map((r) => r.totalRoundDamage)).toEqual(
            off.rounds.map((r) => r.totalRoundDamage)
        );
        expect(on.rounds.map((r) => r.cumulativeDamage)).toEqual(
            off.rounds.map((r) => r.cumulativeDamage)
        );
    });
});
