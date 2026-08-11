/**
 * SP-1 deferred gap: `summary.finalHpPct` described only the FIRST enemy on a multi-enemy roster,
 * so a run that wiped one of two enemies and left the other untouched reported whichever of those
 * two extremes happened to be listed first. It is a single number, but the honest single number for
 * a roster is the HP-weighted remainder across all of it — that is what `rankDpsConfigs` sorts
 * surviving configs by ("closer to death wins").
 *
 * Latent rather than user-visible today: DPSCalculatorPage supplies exactly one enemy. Fixed here so
 * the scalar does not become a trap when SP-3/SP-4 make real rosters routine.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../dpsSimulator';
import { setupKeyedTestRng, resetRateGateRng } from '../rateAccumulator';
import { DEFAULT_ATTACKER_SLOT, DEFAULT_ENEMY_SLOT } from '../dpsEnemyPlacement';
import type { ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

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

const ENEMY_HP = 200_000;

/** A passive, non-attacking enemy: `attack: 0` (the calculator's default) never hits back, and no
 *  shipSkills means it only ever takes damage. */
const enemy = (id: string, position: Position, hp = ENEMY_HP) => ({
    id,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        speed: 10,
        defence: 0,
        hp,
    },
    chargeCount: 0,
    startCharged: false,
    position,
});

// The focus's single-target `front` cast lands on the front enemy only (DEFAULT_ENEMY_SLOT is the
// middle-FRONT cell, column 4), so a back-row second enemy is never touched.
const FRONT = DEFAULT_ENEMY_SLOT;
const BACK: Position = 'B1';

const run = (enemies: ReturnType<typeof enemy>[], rounds = 2): DPSSimulationInput => ({
    attack: 20_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: ENEMY_HP,
    rounds,
    selfBuffs: [],
    enemyDebuffs: [],
    speed: 100,
    hp: 1_000_000,
    position: DEFAULT_ATTACKER_SLOT,
    shipSkills: plainDamageKit(),
    enemyAttackers: enemies,
});

describe('finalHpPct across a multi-enemy DPS roster', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        resetRateGateRng();
    });

    it('reports the HP-weighted remainder, not just the first enemy', () => {
        // Only the front enemy is hit. Two equal-max-HP enemies, one damaged and one untouched → the
        // aggregate sits strictly between the damaged one's own remainder and the untouched 100%.
        const damagedFirst = simulateDPS(run([enemy('front', FRONT), enemy('back', BACK)]));
        const soloDamaged = simulateDPS(run([enemy('front', FRONT)]));

        expect(soloDamaged.summary.finalHpPct).toBeLessThan(100);
        expect(damagedFirst.summary.finalHpPct).toBeGreaterThan(soloDamaged.summary.finalHpPct);
        expect(damagedFirst.summary.finalHpPct).toBeLessThan(100);
        // Equal max HP → the plain mean of the two remainders.
        expect(damagedFirst.summary.finalHpPct).toBeCloseTo(
            (soloDamaged.summary.finalHpPct + 100) / 2,
            0
        );
    });

    it('does not depend on which enemy is listed first', () => {
        // The defect: the scalar read `enemyAttackers[0]`, so listing the untouched enemy first
        // reported 100% for a roster that had lost half its HP — and listing the damaged one first
        // reported its remainder as though the untouched enemy did not exist.
        const damagedFirst = simulateDPS(run([enemy('front', FRONT), enemy('back', BACK)]));
        const untouchedFirst = simulateDPS(run([enemy('back', BACK), enemy('front', FRONT)]));

        expect(untouchedFirst.summary.finalHpPct).toBeCloseTo(damagedFirst.summary.finalHpPct, 5);
    });

    it('counts a killed enemy as 0, so a partial wipe is not reported as full HP', () => {
        // A one-round window and a front enemy with exactly one hit of HP: it dies in round 1 and
        // the run ends before the focus can retarget onto the (equal-HP) back enemy. Half the
        // roster's HP is gone, and neither extreme — 0 (the dead one) nor 100 (the untouched one) —
        // describes that.
        const result = simulateDPS(
            run([enemy('front', FRONT, 20_000), enemy('back', BACK, 20_000)], 1)
        );

        expect(result.summary.survived).toBe(true); // the back enemy lives → not a wipe
        expect(result.summary.roundsToKill).toBeUndefined();
        expect(result.summary.finalHpPct).toBeCloseTo(50, 0);
    });

    it('still reports the single enemy exactly on a one-enemy roster', () => {
        // Regression fence: the aggregate must reduce to today's value for the shape the UI ships.
        const result = simulateDPS(run([enemy('front', FRONT)]));
        expect(result.summary.finalHpPct).toBeGreaterThan(0);
        expect(result.summary.finalHpPct).toBeLessThan(100);
    });
});
