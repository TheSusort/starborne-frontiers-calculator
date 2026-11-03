import { describe, it, expect } from 'vitest';
import {
    makeEngineeringStat,
    makeExportData,
    makeGearItem,
    makeImplantItem,
    makeUnit,
} from '../utils/__tests__/importPlayerData.fixtures';
import { IMPORT_LIMITS, validateExportedPlayData } from './exportedPlayData';

describe('validateExportedPlayData', () => {
    it('rejects empty object', () => {
        const r = validateExportedPlayData({});
        expect(r.success).toBe(false);
        expect((r as { success: false; error: string }).error).toMatch(/invalid/i);
    });
    it('rejects null', () => {
        expect(validateExportedPlayData(null).success).toBe(false);
    });
    it('rejects missing Equipment', () => {
        const r = validateExportedPlayData({ Units: [], Engineering: [] });
        expect(r.success).toBe(false);
    });
    it('accepts valid minimal structure', () => {
        const r = validateExportedPlayData({ Units: [], Equipment: [], Engineering: [] });
        expect(r.success).toBe(true);
    });
    it('accepts equipment with null calibration fields (uncalibrated gear)', () => {
        const r = validateExportedPlayData({
            Units: [],
            Equipment: [
                {
                    Id: 'gear-1',
                    EquippedOnUnit: null,
                    Slot: 'Weapon',
                    Level: 1,
                    Rank: 1,
                    Set: 'Resilience',
                    Rarity: 'Common',
                    Locked: false,
                    CalibratedForUnitId: null,
                    CalibrationLevel: null,
                    MainStats: [],
                    SubStats: [],
                },
            ],
            Engineering: [],
        });
        expect(r.success).toBe(true);
    });
    it('accepts equipment with populated calibration fields', () => {
        const r = validateExportedPlayData({
            Units: [],
            Equipment: [
                {
                    Id: 'gear-1',
                    EquippedOnUnit: null,
                    Slot: 'Weapon',
                    Level: 1,
                    Rank: 1,
                    Set: 'Resilience',
                    Rarity: 'Common',
                    Locked: false,
                    CalibratedForUnitId: '11111111-1111-1111-1111-111111111111',
                    CalibrationLevel: 3,
                    MainStats: [],
                    SubStats: [],
                },
            ],
            Engineering: [],
        });
        expect(r.success).toBe(true);
    });

    describe('size bounds', () => {
        const over = <T>(limit: number, make: () => T): T[] =>
            Array.from({ length: limit + 1 }, make);
        const errorOf = (r: ReturnType<typeof validateExportedPlayData>) =>
            r.success ? '' : r.error;
        const refit = { Attribute: 'Power', Type: 'Percentage' as const, Value: 0.05 };
        const stat = {
            Level: 1,
            Attribute: { Attribute: 'Power', Type: 'Flat' as const, Value: 1 },
        };

        it('accepts a whale-sized export', () => {
            const r = validateExportedPlayData(
                makeExportData({
                    Units: Array.from({ length: 3000 }, (_, i) =>
                        makeUnit({
                            Id: `unit-${i}`,
                            Skills: Array.from({ length: 21 }, (_, j) => `SKILL_${j}`),
                            Attributes: {
                                ...makeUnit().Attributes,
                                Refit: Array.from({ length: 16 }, () => refit),
                            },
                        })
                    ),
                    Equipment: [
                        ...Array.from({ length: 12_000 }, (_, i) =>
                            makeGearItem({ Id: `gear-${i}` })
                        ),
                        makeImplantItem({
                            Set: 'IMPLANT_MAJOR_ENDOF_ROUND_FIRST_TO_ACT_CONCENTRATE_FIRE_PASSIVE_CHANCE_BOOST_LVL_5',
                        }),
                    ],
                    Engineering: Array.from({ length: 16 }, () => makeEngineeringStat()),
                })
            );
            expect(r.success).toBe(true);
        });

        it.each<[string, number, () => unknown]>([
            ['Units', IMPORT_LIMITS.units, () => makeUnit()],
            ['Equipment', IMPORT_LIMITS.equipment, () => makeGearItem()],
            ['Engineering', IMPORT_LIMITS.engineering, () => makeEngineeringStat()],
        ])('rejects more %s than the bound', (key, limit, make) => {
            const r = validateExportedPlayData({ ...makeExportData(), [key]: over(limit, make) });
            expect(r.success).toBe(false);
            expect(errorOf(r)).toContain(`${key} — `);
        });

        it('rejects a unit with too many refit attributes', () => {
            const unit = makeUnit();
            unit.Attributes.Refit = over(IMPORT_LIMITS.refitAttributes, () => refit);
            const r = validateExportedPlayData(makeExportData({ Units: [unit] }));
            expect(errorOf(r)).toContain('Units.0.Attributes.Refit — ');
        });

        it('rejects a unit with too many skills', () => {
            const unit = makeUnit({ Skills: over(IMPORT_LIMITS.skills, () => 'SKILL') });
            const r = validateExportedPlayData(makeExportData({ Units: [unit] }));
            expect(errorOf(r)).toContain('Units.0.Skills — ');
        });

        it.each(['MainStats', 'SubStats'] as const)('rejects gear with too many %s', (key) => {
            const gear = makeGearItem({ [key]: over(IMPORT_LIMITS.statsPerGear, () => stat) });
            const r = validateExportedPlayData(makeExportData({ Equipment: [gear] }));
            expect(errorOf(r)).toContain(`Equipment.0.${key} — `);
        });

        it('rejects an over-long string', () => {
            const gear = makeGearItem({ Id: 'x'.repeat(IMPORT_LIMITS.stringLength + 1) });
            const r = validateExportedPlayData(makeExportData({ Equipment: [gear] }));
            expect(errorOf(r)).toContain('Equipment.0.Id — ');
        });

        it('accepts a string exactly at the bound', () => {
            const gear = makeGearItem({ Id: 'x'.repeat(IMPORT_LIMITS.stringLength) });
            const r = validateExportedPlayData(makeExportData({ Equipment: [gear] }));
            expect(r.success).toBe(true);
        });
    });
});
