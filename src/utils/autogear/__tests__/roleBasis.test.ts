import { describe, it, expect } from 'vitest';
import { calculateRoleScore, calculatePriorityScore } from '../priorityScore';
import { BaseStats } from '../../../types/stats';
import { RoleBasis } from '../../../types/autogear';
import { SHIP_TYPES, ShipTypeName } from '../../../constants';
import { roleAxis, rolePrimaryStat } from '../simRerank/roleBasisHost';

// Fixtures captured at aa42f528 by calling the REAL calculateRoleScore, before any basis code
// existed (.superpowers/sdd/task-1-fixtures.md). Pinned literally — do not round, do not
// recompute from a formula copy.

describe('calculateRoleScore — regression pin (absent basis changes nothing)', () => {
    const stats: BaseStats = {
        hp: 50000,
        attack: 4000,
        defence: 3000,
        speed: 120,
        crit: 40,
        critDamage: 120,
        hacking: 2500,
        security: 2000,
        healModifier: 20,
        damageReduction: 0,
        defensePenetration: 0,
        hpRegen: 0,
        shield: 0,
    };

    const pinned: Record<ShipTypeName, number> = {
        ATTACKER: 1098.16,
        DEFENDER: 1152.3459004705014,
        DEFENDER_SECURITY: 2304691.800941003,
        DEBUFFER: 2745400,
        DEBUFFER_DEFENSIVE: 230469180.0941003,
        DEBUFFER_DEFENSIVE_SECURITY: 5092187.672037641,
        DEBUFFER_BOMBER: 10000000,
        DEBUFFER_CORROSION: 2500,
        SUPPORTER: 13320,
        SUPPORTER_BUFFER: 1807.2484566884964,
        SUPPORTER_OFFENSIVE: 1326.491106406735,
        SUPPORTER_SHIELD: 50000,
    };

    for (const role of Object.keys(pinned)) {
        it(`${role} matches its pre-basis score to full precision`, () => {
            expect(calculateRoleScore(role, stats)).toBe(pinned[role]);
        });
    }

    it('the pin table covers exactly the roles SHIP_TYPES defines — a 13th role cannot go unpinned silently', () => {
        expect(new Set(Object.keys(pinned))).toEqual(new Set(Object.keys(SHIP_TYPES)));
    });
});

describe('calculateRoleScore — a SUPPORTER basis leaves every non-primary ratio unchanged', () => {
    // defence is nonzero (unlike the fixture's own stat block) so the basis below sums two
    // real terms — a basis that is a scalar on hp alone cannot tell a broken multi-term
    // summation from a correct one.
    const base: BaseStats = {
        hp: 50000,
        attack: 0,
        defence: 3000,
        speed: 0,
        crit: 40,
        critDamage: 120,
        hacking: 0,
        security: 0,
        healModifier: 20,
        damageReduction: 0,
        defensePenetration: 0,
        hpRegen: 0,
        shield: 0,
    };

    // The measured mixed-stat basis from `.superpowers/sdd/task-1-fixtures.md`, also used by
    // "a basis moves the primary quantity" below: a foreign stat (defence), not a scalar on
    // hp, the role's own primary stat — a scalar-only basis is linear in hp and so preserves
    // every non-primary ratio automatically, discriminating nothing.
    const basis: RoleBasis = {
        produces: 'repair',
        terms: [
            { stat: 'hp', weight: 0.057 },
            { stat: 'defence', weight: 1.067 },
        ],
    };

    const baseScoreNoBasis = calculateRoleScore('SUPPORTER', base);
    const baseScoreWithBasis = calculateRoleScore('SUPPORTER', base, undefined, basis);

    it('the basis actually changes the score — proves it is applied, not silently ignored', () => {
        expect(baseScoreNoBasis).toBe(13320);
        expect(baseScoreWithBasis).not.toBe(baseScoreNoBasis);
    });

    function ratio(delta: Partial<BaseStats>): number {
        return (
            calculateRoleScore('SUPPORTER', { ...base, ...delta }, undefined, basis) /
            baseScoreWithBasis
        );
    }

    // No HP-ratio assertion here: hp is the primary quantity this basis replaces, and once
    // defence enters the basis too, +10,000 HP no longer scales the score by a fixed x1.2 —
    // see "a basis moves the primary quantity" below, where that same movement is the point.

    it("+30 crit reads the real formula's x1.2432, not the seeded copy's x1.0788", () => {
        expect(ratio({ crit: 70 })).toBeCloseTo(1.2432, 4);
    });

    it("+60 crit power reads the real formula's x1.1622, not the seeded copy's x1.0970", () => {
        expect(ratio({ critDamage: 180 })).toBeCloseTo(1.1622, 4);
    });

    it("both crit stats read the real formula's x1.5270, not the seeded copy's x1.1759", () => {
        expect(ratio({ crit: 70, critDamage: 180 })).toBeCloseTo(1.527, 4);
    });

    it("+20 heal modifier reads the real formula's x1.1667, not the seeded copy's x1.2803", () => {
        expect(ratio({ healModifier: 40 })).toBeCloseTo(1.1667, 4);
    });
});

describe('calculateRoleScore — a basis moves the primary quantity', () => {
    const baseline: BaseStats = {
        hp: 50000,
        attack: 0,
        defence: 3000,
        speed: 0,
        crit: 40,
        critDamage: 120,
        hacking: 0,
        security: 0,
        healModifier: 20,
        damageReduction: 0,
        defensePenetration: 0,
        hpRegen: 0,
        shield: 0,
    };
    const hpPiece: BaseStats = { ...baseline, hp: 60000 }; // +10,000 HP
    const defPiece: BaseStats = { ...baseline, defence: 6000 }; // +3,000 Defence
    const basis: RoleBasis = {
        produces: 'repair',
        terms: [
            { stat: 'hp', weight: 0.057 },
            { stat: 'defence', weight: 1.067 },
        ],
    };

    it('with the basis, +3,000 Defence outscores +10,000 HP', () => {
        const hpScore = calculateRoleScore('SUPPORTER', hpPiece, undefined, basis);
        const defScore = calculateRoleScore('SUPPORTER', defPiece, undefined, basis);
        expect(defScore).toBeGreaterThan(hpScore);
    });

    it('without the basis, +10,000 HP outscores +3,000 Defence (the reverse)', () => {
        const hpScore = calculateRoleScore('SUPPORTER', hpPiece);
        const defScore = calculateRoleScore('SUPPORTER', defPiece);
        expect(hpScore).toBeGreaterThan(defScore);
    });
});

describe('calculateRoleScore — hosting is gated by roleHostsBasis, not by presence alone', () => {
    const stats: BaseStats = {
        hp: 50000,
        attack: 4000,
        defence: 3000,
        speed: 120,
        crit: 40,
        critDamage: 120,
        hacking: 2500,
        security: 2000,
        healModifier: 20,
        damageReduction: 0,
        defensePenetration: 0,
        hpRegen: 0,
        shield: 0,
    };

    it('DEFENDER hosts nothing — a damage basis is ignored entirely', () => {
        const basis: RoleBasis = { produces: 'damage', terms: [{ stat: 'attack', weight: 5 }] };
        expect(calculateRoleScore('DEFENDER', stats, undefined, basis)).toBe(
            calculateRoleScore('DEFENDER', stats)
        );
    });

    it('ATTACKER hosts damage — a repair basis (produces mismatch) is ignored', () => {
        const basis: RoleBasis = { produces: 'repair', terms: [{ stat: 'hp', weight: 5 }] };
        expect(calculateRoleScore('ATTACKER', stats, undefined, basis)).toBe(
            calculateRoleScore('ATTACKER', stats)
        );
    });

    it('ATTACKER hosts a matching damage basis — the score changes', () => {
        const basis: RoleBasis = { produces: 'damage', terms: [{ stat: 'attack', weight: 5 }] };
        expect(calculateRoleScore('ATTACKER', stats, undefined, basis)).not.toBe(
            calculateRoleScore('ATTACKER', stats)
        );
    });
});

describe('calculateRoleScore — binds every hosting role to roleBasisHost.ts, not just the ones with a dedicated test above', () => {
    const stats: BaseStats = {
        hp: 50000,
        attack: 4000,
        defence: 3000,
        speed: 120,
        crit: 40,
        critDamage: 120,
        hacking: 2500,
        security: 2000,
        healModifier: 20,
        damageReduction: 0,
        defensePenetration: 0,
        hpRegen: 0,
        shield: 0,
    };

    // Derived from `roleAxis`/`SHIP_TYPES`, not hand-listed: a role `roleBasisHost.ts` stops
    // hosting drops out of this loop instead of leaving a stale case behind, and a role it
    // starts hosting is picked up automatically.
    const hostingRoles = Object.keys(SHIP_TYPES).filter((role) => roleAxis(role) !== null);

    it('the hosting set used by this loop is non-empty', () => {
        expect(hostingRoles.length).toBeGreaterThan(0);
    });

    for (const role of hostingRoles) {
        const axis = roleAxis(role)!;
        const primary = rolePrimaryStat(role)!;

        it(`${role}: an identity-weight basis on its own primary stat (${primary}) reproduces the no-basis score exactly`, () => {
            const identityBasis: RoleBasis = {
                produces: axis,
                terms: [{ stat: primary, weight: 1 }],
            };
            expect(calculateRoleScore(role, stats, undefined, identityBasis)).toBe(
                calculateRoleScore(role, stats)
            );
        });

        it(`${role}: a non-identity weight on its own primary stat (${primary}) changes the score`, () => {
            const scaledBasis: RoleBasis = {
                produces: axis,
                terms: [{ stat: primary, weight: 2 }],
            };
            expect(calculateRoleScore(role, stats, undefined, scaledBasis)).not.toBe(
                calculateRoleScore(role, stats)
            );
        });
    }
});

describe('calculateRoleScore — basis terms are validated through the same predicate as a custom-formula row', () => {
    const stats: BaseStats = {
        hp: 50000,
        attack: 4000,
        defence: 3000,
        speed: 120,
        crit: 40,
        critDamage: 120,
        hacking: 2500,
        security: 2000,
        healModifier: 20,
        damageReduction: 0,
        defensePenetration: 0,
        hpRegen: 0,
        shield: 0,
    };

    it('a basis whose only term has a non-finite weight falls back to the plain primary stat, never to 0', () => {
        const invalidBasis: RoleBasis = {
            produces: 'repair',
            terms: [{ stat: 'hp', weight: NaN }],
        };
        const score = calculateRoleScore('SUPPORTER', stats, undefined, invalidBasis);
        expect(score).toBe(calculateRoleScore('SUPPORTER', stats));
        expect(score).not.toBe(0);
    });

    it('a basis whose only term has a negative weight falls back to the plain primary stat', () => {
        const invalidBasis: RoleBasis = { produces: 'repair', terms: [{ stat: 'hp', weight: -1 }] };
        const score = calculateRoleScore('SUPPORTER', stats, undefined, invalidBasis);
        expect(score).toBe(calculateRoleScore('SUPPORTER', stats));
    });

    it('a basis term naming a derived stat (not a raw BaseStats key) is dropped, not read as 0', () => {
        const invalidBasis: RoleBasis = {
            produces: 'repair',
            terms: [{ stat: 'effectiveHp', weight: 2 }],
        };
        const score = calculateRoleScore('SUPPORTER', stats, undefined, invalidBasis);
        expect(score).toBe(calculateRoleScore('SUPPORTER', stats));
    });

    it('a mix of one invalid and one valid term keeps only the valid one', () => {
        const mixedBasis: RoleBasis = {
            produces: 'repair',
            terms: [
                { stat: 'hp', weight: NaN },
                { stat: 'defence', weight: 2 },
            ],
        };
        const validOnly: RoleBasis = {
            produces: 'repair',
            terms: [{ stat: 'defence', weight: 2 }],
        };
        expect(calculateRoleScore('SUPPORTER', stats, undefined, mixedBasis)).toBe(
            calculateRoleScore('SUPPORTER', stats, undefined, validOnly)
        );
    });

    it('an ALL-ZERO basis falls back to the plain primary stat, never scores 0', () => {
        // Every term individually passes the >= 0 check, so a naive filter would keep it and
        // resolveBasisValue would then read 0 for every candidate — the same "ties the whole
        // search" failure an empty basis is already guarded against, reached through a weight
        // of 0 instead of an absent term.
        const allZeroBasis: RoleBasis = {
            produces: 'damage',
            terms: [{ stat: 'attack', weight: 0 }],
        };
        const score = calculateRoleScore('ATTACKER', stats, undefined, allZeroBasis);
        expect(score).toBe(calculateRoleScore('ATTACKER', stats));
        expect(score).not.toBe(0);
    });
});

describe('calculatePriorityScore — threads roleBasis the same way calculateRoleScore does', () => {
    const stats: BaseStats = {
        hp: 50000,
        attack: 4000,
        defence: 3000,
        speed: 120,
        crit: 40,
        critDamage: 120,
        hacking: 2500,
        security: 2000,
        healModifier: 20,
        damageReduction: 0,
        defensePenetration: 0,
        hpRegen: 0,
        shield: 0,
    };

    it('an absent roleBasis changes nothing relative to the pre-basis signature', () => {
        const withoutParam = calculatePriorityScore(stats, [], 'SUPPORTER');
        const withUndefinedBasis = calculatePriorityScore(
            stats,
            [],
            'SUPPORTER',
            undefined,
            undefined,
            undefined,
            undefined,
            0,
            undefined,
            undefined,
            undefined
        );
        expect(withUndefinedBasis).toBe(withoutParam);
        expect(withoutParam).toBe(13320);
    });

    it('a hosted roleBasis changes the score; a non-hosted one does not', () => {
        const basis: RoleBasis = { produces: 'repair', terms: [{ stat: 'hp', weight: 0.6 }] };
        const supporterScore = calculatePriorityScore(
            stats,
            [],
            'SUPPORTER',
            undefined,
            undefined,
            undefined,
            undefined,
            0,
            undefined,
            undefined,
            basis
        );
        expect(supporterScore).not.toBe(13320);

        const damageBasis: RoleBasis = {
            produces: 'damage',
            terms: [{ stat: 'attack', weight: 5 }],
        };
        const defenderScore = calculatePriorityScore(
            stats,
            [],
            'DEFENDER',
            undefined,
            undefined,
            undefined,
            undefined,
            0,
            undefined,
            undefined,
            damageBasis
        );
        expect(defenderScore).toBe(calculatePriorityScore(stats, [], 'DEFENDER'));
    });

    it('a HOSTING role (ATTACKER) with a produces-mismatched basis (repair) is unaffected — the axis gate, not just "has no basis param"', () => {
        const repairBasis: RoleBasis = { produces: 'repair', terms: [{ stat: 'hp', weight: 5 }] };
        const withMismatch = calculatePriorityScore(
            stats,
            [],
            'ATTACKER',
            undefined,
            undefined,
            undefined,
            undefined,
            0,
            undefined,
            undefined,
            repairBasis
        );
        expect(withMismatch).toBe(calculatePriorityScore(stats, [], 'ATTACKER'));
    });

    it('a HOSTING role (ATTACKER) with a produces-matched basis (damage) changes the score', () => {
        const damageBasis: RoleBasis = {
            produces: 'damage',
            terms: [{ stat: 'attack', weight: 5 }],
        };
        const withMatch = calculatePriorityScore(
            stats,
            [],
            'ATTACKER',
            undefined,
            undefined,
            undefined,
            undefined,
            0,
            undefined,
            undefined,
            damageBasis
        );
        expect(withMatch).not.toBe(calculatePriorityScore(stats, [], 'ATTACKER'));
    });
});

describe('calculatePriorityScore — the losslessness fixture, through the path the optimizer actually scores with', () => {
    // `calculateRoleScore` (tested above) is a display/preview helper; `calculatePriorityScore`
    // is what every autogear strategy calls per candidate (`scoring.ts`'s `calculateTotalScore`).
    // Pinning the losslessness ratios only through the first path would leave the second
    // unproven — the two are separate functions with separate switches over the same roles.
    // defence is nonzero (unlike the fixture's own stat block) so the basis below sums two
    // real terms — a basis that is a scalar on hp alone cannot tell a broken multi-term
    // summation from a correct one.
    const base: BaseStats = {
        hp: 50000,
        attack: 0,
        defence: 3000,
        speed: 0,
        crit: 40,
        critDamage: 120,
        hacking: 0,
        security: 0,
        healModifier: 20,
        damageReduction: 0,
        defensePenetration: 0,
        hpRegen: 0,
        shield: 0,
    };
    // The measured mixed-stat basis from `.superpowers/sdd/task-1-fixtures.md`: a foreign stat
    // (defence), not a scalar on hp, the role's own primary stat — a scalar-only basis is
    // linear in hp and so preserves every non-primary ratio automatically, discriminating
    // nothing.
    const basis: RoleBasis = {
        produces: 'repair',
        terms: [
            { stat: 'hp', weight: 0.057 },
            { stat: 'defence', weight: 1.067 },
        ],
    };

    function scoreSupporter(stats: BaseStats, roleBasis?: RoleBasis): number {
        return calculatePriorityScore(
            stats,
            [],
            'SUPPORTER',
            undefined,
            undefined,
            undefined,
            undefined,
            0,
            undefined,
            undefined,
            roleBasis
        );
    }

    const baseScoreNoBasis = scoreSupporter(base);
    const baseScoreWithBasis = scoreSupporter(base, basis);

    it('the basis actually changes calculatePriorityScore too', () => {
        expect(baseScoreNoBasis).toBe(13320);
        expect(baseScoreWithBasis).not.toBe(baseScoreNoBasis);
    });

    function ratio(delta: Partial<BaseStats>): number {
        return scoreSupporter({ ...base, ...delta }, basis) / baseScoreWithBasis;
    }

    // No HP-ratio assertion here: hp is the primary quantity this basis replaces, and once
    // defence enters the basis too, +10,000 HP no longer scales the score by a fixed x1.2.

    it("+30 crit reads the real formula's x1.2432", () => {
        expect(ratio({ crit: 70 })).toBeCloseTo(1.2432, 4);
    });

    it("+60 crit power reads the real formula's x1.1622", () => {
        expect(ratio({ critDamage: 180 })).toBeCloseTo(1.1622, 4);
    });

    it("both crit stats read the real formula's x1.5270", () => {
        expect(ratio({ crit: 70, critDamage: 180 })).toBeCloseTo(1.527, 4);
    });

    it("+20 heal modifier reads the real formula's x1.1667", () => {
        expect(ratio({ healModifier: 40 })).toBeCloseTo(1.1667, 4);
    });
});
