import { describe, it, expect } from 'vitest';
import { averageFocusStats, averageEffectiveCrit } from '../roundStatsAverage';
import type { RoundData, RoundStatsSnapshot } from '../dpsSimulator';

const snapshot = (over: Partial<RoundStatsSnapshot> = {}): RoundStatsSnapshot => ({
    attack: 10000,
    defence: 1000,
    crit: 50,
    critDamage: 150,
    defensePenetration: 0,
    speed: 100,
    hacking: 200,
    security: 100,
    currentHp: 300000,
    maxHp: 300000,
    shieldPool: 0,
    ...over,
});

/** Minimal RoundData row — only the fields the average reads matter. */
const row = (snapshots?: RoundStatsSnapshot[]): RoundData =>
    ({
        round: 1,
        action: 'active',
        charges: 0,
        chargeCount: 0,
        didCrit: false,
        enemyHpPct: 100,
        directDamage: 0,
        corrosionDamage: 0,
        infernoDamage: 0,
        detonationDamage: 0,
        totalRoundDamage: 0,
        cumulativeDamage: 0,
        activeCorrosionStacks: 0,
        activeInfernoStacks: 0,
        activeBombCount: 0,
        activeSelfBuffs: [],
        activeEnemyDebuffs: [],
        resistedEnemyDebuffs: [],
        appliedDoTs: [],
        dotsLanded: true,
        activeDoTStates: [],
        ...(snapshots ? { focusStatsSnapshots: snapshots } : {}),
    }) satisfies RoundData;

describe('averageFocusStats', () => {
    it('returns undefined when no round carries a snapshot', () => {
        expect(averageFocusStats([row(), row()])).toBeUndefined();
    });

    it('returns undefined for an empty run', () => {
        expect(averageFocusStats([])).toBeUndefined();
    });

    it('averages a buff that lands mid-run to strictly between the two values', () => {
        const avg = averageFocusStats([
            row([snapshot({ attack: 10000 })]),
            row([snapshot({ attack: 13000 })]),
            row([snapshot({ attack: 13000 })]),
        ]);

        expect(avg!.attack).toBeCloseTo(12000, 6);
        expect(avg!.attack).toBeGreaterThan(10000);
        expect(avg!.attack).toBeLessThan(13000);
    });

    it('weights each TURN equally, so an extra action counts twice', () => {
        // Round 1: one turn at 10000. Round 2: two turns at 13000 (extra action).
        // Turn-weighted = (10000 + 13000 + 13000) / 3 = 12000.
        // Round-weighted would have been (10000 + 13000) / 2 = 11500 — the number this must NOT be.
        const avg = averageFocusStats([
            row([snapshot({ attack: 10000 })]),
            row([snapshot({ attack: 13000 }), snapshot({ attack: 13000 })]),
        ]);

        expect(avg!.attack).toBeCloseTo(12000, 6);
        expect(avg!.attack).not.toBeCloseTo(11500, 6);
    });

    it('averages every stat on the snapshot, not just attack', () => {
        const avg = averageFocusStats([
            row([snapshot({ crit: 0, critDamage: 100, defence: 0, shieldPool: 0 })]),
            row([snapshot({ crit: 100, critDamage: 200, defence: 2000, shieldPool: 5000 })]),
        ]);

        expect(avg!.crit).toBe(50);
        expect(avg!.critDamage).toBe(150);
        expect(avg!.defence).toBe(1000);
        expect(avg!.shieldPool).toBe(2500);
    });

    it('ignores rounds with no snapshot rather than counting them as zero', () => {
        const avg = averageFocusStats([row([snapshot({ attack: 10000 })]), row(), row()]);

        expect(avg!.attack).toBe(10000);
    });
});

describe('averageEffectiveCrit', () => {
    it('clamps each turn to 100 BEFORE averaging, not the average after the fact', () => {
        // Turns at 70, 120, 120, 120, 120. Clamp-per-turn (correct): (70+100+100+100+100)/5 = 94.
        // Clamp-after-average (the old, wrong behaviour): (70+120+120+120+120)/5 = 110 → clamp 100.
        const avg = averageEffectiveCrit([
            row([snapshot({ crit: 70 })]),
            row([snapshot({ crit: 120 })]),
            row([snapshot({ crit: 120 })]),
            row([snapshot({ crit: 120 })]),
            row([snapshot({ crit: 120 })]),
        ]);

        expect(avg).toBeCloseTo(94, 6);
        expect(avg).not.toBeCloseTo(100, 6);
    });

    it('returns undefined when no round carries a snapshot', () => {
        expect(averageEffectiveCrit([row(), row()])).toBeUndefined();
    });

    it('leaves already-under-cap values unaffected', () => {
        const avg = averageEffectiveCrit([
            row([snapshot({ crit: 40 })]),
            row([snapshot({ crit: 60 })]),
        ]);

        expect(avg).toBe(50);
    });

    it('honours a disadvantaged-matchup cap/penalty, resolved per turn before averaging', () => {
        // Disadvantage modifiers (computeAffinityModifiers): critCap 75, critPenalty 25.
        // Each turn: min(75, max(0, 100 - 25)) = min(75, 75) = 75. Both turns agree, so the
        // average is just 75 — proving the penalty (not just the cap) is applied per turn.
        const avg = averageEffectiveCrit(
            [row([snapshot({ crit: 100 })]), row([snapshot({ crit: 100 })])],
            { critCap: 75, critPenalty: 25 }
        );

        expect(avg).toBe(75);
    });

    it('applies the penalty per turn BEFORE the cap and before averaging', () => {
        // Disadvantage modifiers: critCap 75, critPenalty 25.
        // Turn 1: min(75, max(0, 60 - 25)) = min(75, 35) = 35.
        // Turn 2: min(75, max(0, 100 - 25)) = min(75, 75) = 75.
        // Turn-weighted average: (35 + 75) / 2 = 55.
        // A cap-only (no-penalty) implementation would instead read min(75,60)=60 and
        // min(75,100)=75 → (60+75)/2 = 67.5, so this discriminates the penalty specifically.
        const avg = averageEffectiveCrit(
            [row([snapshot({ crit: 60 })]), row([snapshot({ crit: 100 })])],
            { critCap: 75, critPenalty: 25 }
        );

        expect(avg).toBe(55);
    });

    it('omitting the affinity argument behaves exactly as the plain 100/no-penalty default', () => {
        // Same fixture as the "clamps each turn to 100" test above, called with no second
        // argument at all — the default parameter must reproduce today's behaviour byte-for-byte.
        const avg = averageEffectiveCrit([
            row([snapshot({ crit: 70 })]),
            row([snapshot({ crit: 120 })]),
            row([snapshot({ crit: 120 })]),
            row([snapshot({ crit: 120 })]),
            row([snapshot({ crit: 120 })]),
        ]);

        expect(avg).toBeCloseTo(94, 6);
    });
});
