import { describe, it, expect } from 'vitest';
import {
    ROLE_BASE_STATS,
    getBaseRoleStats,
    getScoringBaselineStats,
    GEARED_CRIT_TARGETS,
} from '../roleBaseStats';
import { SHIP_TYPES, type ShipTypeName } from '../shipTypes';
import { GEAR_SLOTS } from '../gearTypes';

describe('getBaseRoleStats', () => {
    it('maps each base role to its own table', () => {
        expect(getBaseRoleStats('ATTACKER')).toBe(ROLE_BASE_STATS.ATTACKER);
        expect(getBaseRoleStats('DEFENDER')).toBe(ROLE_BASE_STATS.DEFENDER);
        expect(getBaseRoleStats('DEBUFFER')).toBe(ROLE_BASE_STATS.DEBUFFER);
        expect(getBaseRoleStats('SUPPORTER')).toBe(ROLE_BASE_STATS.SUPPORTER);
    });

    it('maps variant roles to their base role', () => {
        expect(getBaseRoleStats('DEFENDER_SECURITY')).toBe(ROLE_BASE_STATS.DEFENDER);
        expect(getBaseRoleStats('DEBUFFER_BOMBER')).toBe(ROLE_BASE_STATS.DEBUFFER);
        expect(getBaseRoleStats('DEBUFFER_CORROSION')).toBe(ROLE_BASE_STATS.DEBUFFER);
        expect(getBaseRoleStats('SUPPORTER_SHIELD')).toBe(ROLE_BASE_STATS.SUPPORTER);
        expect(getBaseRoleStats('SUPPORTER_OFFENSIVE')).toBe(ROLE_BASE_STATS.SUPPORTER);
    });

    it('keeps the attacker table as the fallback', () => {
        expect(getBaseRoleStats('ATTACKER').attack).toBe(6250);
    });
});

describe('GEARED_CRIT_TARGETS', () => {
    it('authors every ShipTypeName explicitly (totality gate)', () => {
        for (const role of Object.keys(SHIP_TYPES)) {
            expect(GEARED_CRIT_TARGETS).toHaveProperty(role);
        }
    });
});

describe('getScoringBaselineStats', () => {
    const GEAR_SLOT_COUNT = Object.keys(GEAR_SLOTS).length;
    // Mirrors the accessor's own formula, so it only checks the formula is
    // applied per role -- it cannot catch a wrong formula. The pinned
    // numbers below are the tripwire for that.
    const SHARE = 1 - 0.5 / GEAR_SLOT_COUNT;

    it('lands ATTACKER at base + (gearedTarget - base) * (1 - headroom/slotCount)', () => {
        const stats = getScoringBaselineStats('ATTACKER');
        expect(stats.crit).toBeCloseTo(20 + (100 - 20) * SHARE, 10);
        expect(stats.critDamage).toBeCloseTo(80 + (200 - 80) * SHARE, 10);
        // Pin the actual numbers so a change to GEAR_SLOT_COUNT or the
        // targets is visible here, not just in the formula's own algebra.
        expect(stats.crit).toBeCloseTo(93.33333333333333, 10);
        expect(stats.critDamage).toBeCloseTo(190, 10);
    });

    it("lands DEBUFFER and SUPPORTER at their own geared targets, not ATTACKER's", () => {
        const debuffer = getScoringBaselineStats('DEBUFFER');
        expect(debuffer.crit).toBeCloseTo(12 + (100 - 12) * SHARE, 10);
        expect(debuffer.critDamage).toBeCloseTo(20 + (150 - 20) * SHARE, 10);

        const supporter = getScoringBaselineStats('SUPPORTER');
        expect(supporter.crit).toBeCloseTo(12 + (100 - 12) * SHARE, 10);
        expect(supporter.critDamage).toBeCloseTo(22 + (150 - 22) * SHARE, 10);
    });

    it('leaves every non-attacker/debuffer/supporter role at the bare table — byte-identical, not approximately', () => {
        // These roles' score formulas either never read crit/critDamage
        // (DEBUFFER_BOMBER, DEBUFFER_CORROSION, SUPPORTER_OFFENSIVE) or gate
        // the crit path on hpRegen, which the bare table leaves at 0
        // (DEFENDER and its variants) — see calculateRoleScore's per-role
        // formulas in priorityScore.ts. A geared reference would be inert
        // for them, so `target === base` exactly for these keys and the
        // formula's own arithmetic (base + 0 * share) reduces to `base`
        // bit-for-bit — `toBe`, not `toBeCloseTo`, is the right assertion.
        for (const role of [
            'DEFENDER',
            'DEFENDER_SECURITY',
            'DEBUFFER_DEFENSIVE',
            'DEBUFFER_DEFENSIVE_SECURITY',
            'DEBUFFER_BOMBER',
            'DEBUFFER_CORROSION',
            'SUPPORTER_BUFFER',
            'SUPPORTER_OFFENSIVE',
            'SUPPORTER_SHIELD',
        ] as ShipTypeName[]) {
            const scoring = getScoringBaselineStats(role);
            const bare = getBaseRoleStats(role);
            expect(scoring.crit).toBe(bare.crit);
            expect(scoring.critDamage).toBe(bare.critDamage);
            expect(scoring).toEqual(bare);
        }
    });

    it('falls back through the same prefix mapping as getBaseRoleStats for a role string outside the authored union', () => {
        // ship.type is persisted user data and can hold a string the
        // ShipTypeName union does not cover — GEARED_CRIT_TARGETS indexed
        // with such a key reads undefined, so the accessor must fall back
        // rather than propagate NaN/undefined into the returned stats.
        const outOfUnionDebuffer = 'DEBUFFER_ULTRA' as ShipTypeName;
        const outOfUnionUnknown = 'TOTALLY_UNKNOWN_ROLE' as ShipTypeName;

        // A DEBUFFER-prefixed unknown variant must land at the DEBUFFER
        // geared target, not silently default to ATTACKER's
        // — this is what actually exercises fallbackGearedTarget's prefix
        // branches rather than just its final ATTACKER catch-all.
        expect(getScoringBaselineStats(outOfUnionDebuffer)).toEqual(
            getScoringBaselineStats('DEBUFFER')
        );

        // A completely unrecognised role matches no prefix and falls all
        // the way through to the ATTACKER catch-all, on both the base table
        // and the geared target — never undefined/NaN.
        const unknown = getScoringBaselineStats(outOfUnionUnknown);
        expect(unknown).toEqual(getScoringBaselineStats('ATTACKER'));
        expect(unknown.crit).not.toBeNaN();
        expect(unknown.critDamage).not.toBeNaN();

        // An INHERITED key is the dangerous kind of unknown role, and the
        // plain unknown above does not cover it: indexing the table with one
        // yields a non-nullish prototype value whose crit is undefined, so a
        // nullish-coalescing fallback would accept it and emit NaN.
        for (const inherited of ['__proto__', 'constructor', 'toString']) {
            const stats = getScoringBaselineStats(inherited);
            expect(stats.crit).not.toBeNaN();
            expect(stats.critDamage).not.toBeNaN();
            expect(stats).toEqual(getScoringBaselineStats('ATTACKER'));
        }
    });
});
