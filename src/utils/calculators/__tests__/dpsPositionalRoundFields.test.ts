/**
 * The DPS display fields on a REAL-ENEMY (positional) run. Every one of these was silently zeroed
 * or de-integered by the positional path while the suite stayed green — the defect class #324's
 * `teamDamage` regression belongs to. Each assertion here drives a real `simulateDPS` run: a
 * hand-built `RoundData` literal stays green through the whole class.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { setupKeyedTestRng } from '../rateAccumulator';
import { baseInput, dotKit, realEnemyInput } from '../__testutils__/dpsRealEnemyFixture';

describe('re-derived round totals keep the integer contract', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
    });

    it('writes integer totalRoundDamage / cumulativeDamage on a real-enemy run', () => {
        const { rounds } = simulateDPS(realEnemyInput({ shipSkills: dotKit() }));

        expect(rounds.length).toBeGreaterThan(0);
        for (const r of rounds) {
            expect(Number.isInteger(r.totalRoundDamage)).toBe(true);
            expect(Number.isInteger(r.cumulativeDamage)).toBe(true);
            // PRESENCE, not just shape: a zeroed field is an integer too.
            expect(r.totalRoundDamage).toBeGreaterThan(0);
        }
    });

    it('ends the last round on exactly the summary total', () => {
        const { rounds, summary } = simulateDPS(realEnemyInput({ shipSkills: dotKit() }));
        expect(rounds[rounds.length - 1].cumulativeDamage).toBe(summary.totalDamage);
    });
});

describe('the Direct damage row on a positional run', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
    });

    it('reports the focus firing damage, not 0', () => {
        const { rounds, summary } = simulateDPS(realEnemyInput());

        for (const r of rounds) {
            expect(r.directDamage).toBeGreaterThan(0);
            expect(Number.isInteger(r.directDamage)).toBe(true);
        }
        expect(summary.totalDirectDamage).toBeGreaterThan(0);
    });

    it('excludes the DoT component instead of double-counting it', () => {
        // dotKit lands corrosion, so `perTargetDealt` carries direct + ticks. Direct must be the
        // REMAINDER — reading `dealt` straight would report the ticks twice (once as Direct, once
        // as Corr) and the four tooltip rows would no longer sum to the round total.
        const { rounds } = simulateDPS(realEnemyInput({ shipSkills: dotKit() }));

        const withDot = rounds.filter((r) => r.corrosionDamage > 0);
        expect(withDot.length).toBeGreaterThan(0); // the fixture is not vacuous

        for (const r of rounds) {
            const parts =
                r.directDamage +
                r.corrosionDamage +
                r.infernoDamage +
                (r.genericDamage ?? 0) +
                r.detonationDamage;
            // Each part is rounded independently, so allow the accumulated half-unit drift only.
            expect(Math.abs(parts - r.totalRoundDamage)).toBeLessThanOrEqual(2);
            expect(r.directDamage).toBeLessThan(r.totalRoundDamage);
            expect(r.directDamage).toBeGreaterThan(0);
        }
    });

    it('also reports Direct on a caller that supplies no enemyAttackers', () => {
        // SP-4b-2a: there is no scalar path any more — `simulateDPS` synthesizes a real, positioned
        // enemy for a caller that omits `enemyAttackers`, so this run is positional too and
        // `directDamage` comes from the same by-subtraction re-derivation as the explicit-roster
        // case above, not from the engine's (now-dead) scalar credit.
        const { rounds } = simulateDPS(baseInput());
        for (const r of rounds) expect(r.directDamage).toBeGreaterThan(0);
    });
});
