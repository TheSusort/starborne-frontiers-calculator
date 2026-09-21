import { describe, it, expect } from 'vitest';
import { roleAxis, rolePrimaryStat, roleHostsBasis } from '../roleBasisHost';
import { SHIP_TYPES } from '../../../../constants';
import type { ShipTypeName } from '../../../../constants/shipTypes';
import type { OffFormulaStat } from '../offFormulaStats';

/**
 * Expected role -> hosting axis/primary-stat table, typed as a total `Record<ShipTypeName, ...>`.
 * `tsc` gates authoring: a `ShipTypeName` added without a matching entry here fails type
 * checking. `vitest` does not type-check (esbuild strips types), so the 'key set equals the full
 * ShipTypeName union' test below is a separate RUNTIME gate against the same gap — it fails a
 * `vitest`-only run even when nobody has run `tsc`.
 */
const EXPECTED: Record<
    ShipTypeName,
    { axis: 'damage' | 'repair' | 'shield' | null; primaryStat: OffFormulaStat | null }
> = {
    ATTACKER: { axis: 'damage', primaryStat: 'attack' },
    DEBUFFER: { axis: 'damage', primaryStat: 'attack' },
    DEBUFFER_BOMBER: { axis: 'damage', primaryStat: 'attack' },
    SUPPORTER: { axis: 'repair', primaryStat: 'hp' },
    SUPPORTER_SHIELD: { axis: 'shield', primaryStat: 'hp' },
    DEFENDER: { axis: null, primaryStat: null },
    DEFENDER_SECURITY: { axis: null, primaryStat: null },
    DEBUFFER_DEFENSIVE: { axis: null, primaryStat: null },
    DEBUFFER_DEFENSIVE_SECURITY: { axis: null, primaryStat: null },
    DEBUFFER_CORROSION: { axis: null, primaryStat: null },
    SUPPORTER_BUFFER: { axis: null, primaryStat: null },
    SUPPORTER_OFFENSIVE: { axis: null, primaryStat: null },
};

const ALL_ROLES = Object.keys(SHIP_TYPES);
const ALL_PRODUCES = ['damage', 'repair', 'shield'] as const;

describe('roleAxis / rolePrimaryStat', () => {
    for (const role of ALL_ROLES) {
        it(`${role} matches the spec's role->axis table`, () => {
            expect(roleAxis(role)).toBe(EXPECTED[role].axis);
            expect(rolePrimaryStat(role)).toBe(EXPECTED[role].primaryStat);
        });
    }
});

describe('roles that host nothing', () => {
    const nonHosting: ShipTypeName[] = [
        'DEFENDER',
        'DEFENDER_SECURITY',
        'DEBUFFER_DEFENSIVE',
        'DEBUFFER_DEFENSIVE_SECURITY',
        'DEBUFFER_CORROSION',
        'SUPPORTER_BUFFER',
        'SUPPORTER_OFFENSIVE',
    ];

    for (const role of nonHosting) {
        it(`${role} hosts no basis for any axis`, () => {
            expect(roleAxis(role)).toBeNull();
            for (const produces of ALL_PRODUCES) {
                expect(roleHostsBasis(role, produces)).toBe(false);
            }
        });
    }
});

describe('the hosting set is exactly the five roles the spec names', () => {
    it('ATTACKER, DEBUFFER, DEBUFFER_BOMBER, SUPPORTER, SUPPORTER_SHIELD', () => {
        const hosting = ALL_ROLES.filter((role) =>
            ALL_PRODUCES.some((produces) => roleHostsBasis(role, produces))
        );
        expect(new Set(hosting)).toEqual(
            new Set(['ATTACKER', 'DEBUFFER', 'DEBUFFER_BOMBER', 'SUPPORTER', 'SUPPORTER_SHIELD'])
        );
    });
});

describe('roleHostsBasis is true exactly when produces matches roleAxis', () => {
    for (const role of ALL_ROLES) {
        for (const produces of ALL_PRODUCES) {
            it(`${role} x ${produces}`, () => {
                expect(roleHostsBasis(role, produces)).toBe(roleAxis(role) === produces);
            });
        }
    }
});

describe('totality tripwire', () => {
    it("EXPECTED's key set equals the full ShipTypeName union", () => {
        expect(new Set(Object.keys(EXPECTED))).toEqual(new Set(ALL_ROLES));
    });
});
