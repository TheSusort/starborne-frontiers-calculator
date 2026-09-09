import { describe, it, expect } from 'vitest';
import { CUSTOM_FORMULA_SEEDS, EXACT_SEED_ROLES, seedFormulaFromRole } from '../customFormulaSeeds';
import { customFormulaScore } from '../customFormula';
import { calculateRoleScore, resolveLimitStatValue } from '../priorityScore';
import { SHIP_TYPES } from '../../../constants';
import { getBaseRoleStats } from '../../../constants/roleBaseStats';
import type { BaseStats } from '../../../types/stats';

const ALL_ROLES = Object.keys(SHIP_TYPES);

// A spread of builds wide enough that a wrong seed reorders at least one pair.
const builds: BaseStats[] = [
    {
        hp: 40000,
        attack: 8000,
        defence: 5000,
        speed: 110,
        hacking: 150,
        security: 50,
        crit: 30,
        critDamage: 90,
        healModifier: 0,
        hpRegen: 0,
        shield: 0,
        damageReduction: 0,
        defensePenetration: 0,
    },
    {
        hp: 60000,
        attack: 6000,
        defence: 9000,
        speed: 140,
        hacking: 260,
        security: 90,
        crit: 60,
        critDamage: 160,
        healModifier: 30,
        hpRegen: 0,
        shield: 0,
        damageReduction: 0,
        defensePenetration: 0,
    },
    {
        hp: 30000,
        attack: 14000,
        defence: 3000,
        speed: 95,
        hacking: 320,
        security: 20,
        crit: 80,
        critDamage: 200,
        healModifier: 10,
        hpRegen: 0,
        shield: 0,
        damageReduction: 0,
        defensePenetration: 0,
    },
    {
        hp: 52000,
        attack: 11000,
        defence: 7000,
        speed: 165,
        hacking: 200,
        security: 75,
        crit: 45,
        critDamage: 120,
        healModifier: 50,
        hpRegen: 0,
        shield: 0,
        damageReduction: 0,
        defensePenetration: 0,
    },
    {
        hp: 22000,
        attack: 9500,
        defence: 4200,
        speed: 125,
        hacking: 210,
        security: 60,
        crit: 20,
        critDamage: 70,
        healModifier: 5,
        hpRegen: 0,
        shield: 0,
        damageReduction: 0,
        defensePenetration: 0,
    },
];

const rank = (scoreOf: (b: BaseStats) => number) =>
    builds
        .map((b, i) => ({ i, score: scoreOf(b) }))
        .sort((a, b) => b.score - a.score)
        .map((e) => e.i);

describe('seed coverage', () => {
    it('has a seed for every role', () => {
        for (const role of ALL_ROLES) {
            expect(CUSTOM_FORMULA_SEEDS[role]).toBeDefined();
            expect(CUSTOM_FORMULA_SEEDS[role].rows.length).toBeGreaterThan(0);
            expect(CUSTOM_FORMULA_SEEDS[role].fidelity).not.toBe('');
        }
    });

    it('records the seeded role on the produced formula', () => {
        expect(seedFormulaFromRole('ATTACKER').seededFrom).toBe('ATTACKER');
    });
});

describe('exact seeds rank identically to their role formula', () => {
    for (const role of EXACT_SEED_ROLES) {
        it(`${role}`, () => {
            const viaRole = rank((b) => calculateRoleScore(role, b));
            const viaFormula = rank((b) => customFormulaScore(b, seedFormulaFromRole(role)));
            expect(viaFormula).toEqual(viaRole);
        });
    }

    it('is a discriminating comparison, not a tie of everything', () => {
        // Non-vacuity: if every build scored the same, the rank equality above would
        // hold no matter what the seeds said.
        const scores = builds.map((b) => calculateRoleScore('ATTACKER', b));
        expect(new Set(scores).size).toBe(builds.length);
    });

    it('catches a deliberately wrong seed', () => {
        // Mutation probe: prove the instrument can report the opposite.
        const wrong = { rows: [{ stat: 'speed', kind: 'core', direction: 'max' } as const] };
        const viaRole = rank((b) => calculateRoleScore('ATTACKER', b));
        const viaWrong = rank((b) => customFormulaScore(b, wrong));
        expect(viaWrong).not.toEqual(viaRole);
    });
});

describe('no seed puts a core row on a stat its role has none of', () => {
    // A maximized core term is 0 when the stat is 0, which zeroes the product and ties
    // every candidate. Fails if someone adds a seed, or edits ROLE_BASE_STATS, without
    // rechecking.
    for (const role of ALL_ROLES) {
        it(`${role}`, () => {
            const bare = getBaseRoleStats(role);
            for (const row of CUSTOM_FORMULA_SEEDS[role].rows) {
                if (row.kind !== 'core' || row.direction !== 'max') continue;
                expect(resolveLimitStatValue(bare, row.stat)).toBeGreaterThan(0);
            }
        });
    }
});
