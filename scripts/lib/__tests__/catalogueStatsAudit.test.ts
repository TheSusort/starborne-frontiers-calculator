import { describe, expect, it } from 'vitest';
import type { CatalogueUnit } from '../catalogueSchema';
import { auditUnits, expectedStats, injectionCaused } from '../catalogueStatsAudit';

const unit = (overrides: Partial<CatalogueUnit> = {}): CatalogueUnit =>
    ({
        id: 'Test_Attacker_Legendary_1',
        slug: 'test',
        name: 'Test',
        rarity: 'Legendary',
        faction: 'MPL',
        affinity: 'Red',
        role: 'Attacker',
        images: { avatar: 'https://x/MPL_1_Loot.png' },
        stats: {
            HullPoints: 10000,
            Power: 2000,
            Defense: 1000,
            Manipulation: 100,
            Security: 50,
            Initiative: 90,
            CritChance: 0.01,
            CritBoost: 0.5,
        },
        ascensionStats: [
            { level: 0, attribute: 'CritChance', type: 'Flat', value: 0.2 },
            { level: 1, attribute: 'HullPoints', type: 'Percentage', value: 0.1 },
            { level: 2, attribute: 'Initiative', type: 'Flat', value: 10 },
            { level: 3, attribute: 'ShieldPenetration', type: 'Flat', value: 0.2 },
        ],
        skills: [],
        ascensionSkills: [],
        ...overrides,
    }) as unknown as CatalogueUnit;

describe('expectedStats', () => {
    it('applies innate rows at refit 0 and earned rows after', () => {
        expect(expectedStats(unit(), 0)).toMatchObject({ crit: 21, hp: 10000, speed: 90 });
        expect(expectedStats(unit(), 2)).toMatchObject({ hp: 11000, speed: 100 });
        expect(expectedStats(unit(), 3).shieldPenetration).toBe(20);
    });
});

describe('auditUnits', () => {
    it('reports no mismatch for a well-formed unit', () => {
        const result = auditUnits([unit()]);
        expect(result.mismatches).toEqual([]);
        expect(result.compared).toBe(7);
    });

    it.each(['drop-innate', 'swap-hp-attack', 'drop-refit-5', 'swap-affinity'] as const)(
        'reports an injected %s fault where it applies',
        (injection) => {
            const withRefit5 = unit({
                ascensionStats: [
                    ...unit().ascensionStats,
                    { level: 5, attribute: 'Power', type: 'Percentage', value: 0.1 },
                ],
            });
            expect(
                injectionCaused(auditUnits([withRefit5]), auditUnits([withRefit5], injection))
                    .length
            ).toBeGreaterThan(0);
        }
    );
});
