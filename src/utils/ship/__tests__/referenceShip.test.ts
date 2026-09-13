import { describe, it, expect } from 'vitest';
import { Ship } from '../../../types/ship';
import { BaseStats } from '../../../types/stats';
import {
    AscensionStat,
    canBeFullyRefitted,
    MAX_REFITS,
    parseAscensionStats,
    referenceShip,
} from '../referenceShip';
import { getShipSkillRows } from '../skillRows';

const baseStats: BaseStats = {
    hp: 10000,
    attack: 3000,
    defence: 2000,
    hacking: 80,
    security: 20,
    crit: 10,
    critDamage: 50,
    speed: 100,
    healModifier: 0,
    hpRegen: 0,
    shield: 0,
    shieldPenetration: 0,
    defensePenetration: 0,
    damageReduction: 0,
};

const template = (overrides: Partial<Ship> = {}): Ship => ({
    id: 'TEMPLATE_1',
    name: 'Testship',
    rarity: 'legendary',
    faction: 'ATLAS',
    type: 'ATTACKER',
    baseStats: { ...baseStats },
    equipment: {},
    implants: {},
    refits: [],
    firstPassiveSkillText: 'R0 passive',
    secondPassiveSkillText: 'R2 passive',
    thirdPassiveSkillText: 'R4 passive',
    activeSkillText: 'Active',
    ...overrides,
});

/** Levels 1-6 with level 2 absent, the common shape: that level grants a skill, not stats. */
const ascension: AscensionStat[] = [
    { level: 1, attribute: 'HullPoints', type: 'Percentage', value: 0.15 },
    { level: 3, attribute: 'Defense', type: 'Percentage', value: 0.15 },
    { level: 4, attribute: 'Initiative', type: 'Flat', value: 10 },
    { level: 5, attribute: 'Power', type: 'Percentage', value: 0.05 },
    { level: 6, attribute: 'HullPoints', type: 'Percentage', value: 0.15 },
];

describe('referenceShip', () => {
    it('carries no gear or implants', () => {
        const ship = referenceShip(template(), 'refitted', ascension);
        expect(ship.equipment).toEqual({});
        expect(ship.implants).toEqual({});
    });

    it('gives an r0 reference no refits', () => {
        expect(referenceShip(template(), 'r0', ascension).refits).toEqual([]);
    });

    it('gives a refitted reference one refit per level, including the skill-only levels', () => {
        const ship = referenceShip(template(), 'refitted', ascension);
        expect(ship.refits).toHaveLength(MAX_REFITS);
    });

    it('puts each level its own granted stats', () => {
        const ship = referenceShip(template(), 'refitted', ascension);
        expect(ship.refits[0].stats).toEqual([{ name: 'hp', value: 15, type: 'percentage' }]);
        expect(ship.refits[3].stats).toEqual([{ name: 'speed', value: 10, type: 'flat' }]);
    });

    // The refit COUNT decides which passive applies, so a level granting no stats still has to
    // occupy a slot. Six refits is what makes a fully refitted reference use its R4 passive.
    it('selects the R4 passive for a fully refitted reference', () => {
        const rows = getShipSkillRows(referenceShip(template(), 'refitted', ascension));
        expect(rows.map((row) => row.label)).toContain('Passive R4');
    });

    it('selects the R0 passive for an r0 reference', () => {
        const rows = getShipSkillRows(referenceShip(template(), 'r0', ascension));
        expect(rows.map((row) => row.label)).toContain('Passive R0');
    });

    // A level-0 grant is innate: an unrefitted Snapdragon reads ~21% crit in game while its
    // catalogue stat block says 1%. So it belongs in baseStats, for BOTH variants, and never
    // in a refit.
    describe('innate level-0 grants', () => {
        const innate: AscensionStat[] = [
            { level: 0, attribute: 'CritChance', type: 'Flat', value: 0.2 },
            ...ascension,
        ];

        it('folds into the base stats of an r0 reference', () => {
            expect(referenceShip(template(), 'r0', innate).baseStats.crit).toBe(30);
        });

        it('folds into the base stats of a refitted reference', () => {
            expect(referenceShip(template(), 'refitted', innate).baseStats.crit).toBe(30);
        });

        it('never becomes a refit', () => {
            const ship = referenceShip(template(), 'refitted', innate);
            const refitStats = ship.refits.flatMap((refit) => refit.stats);
            expect(refitStats.filter((stat) => stat.name === 'crit')).toEqual([]);
        });
    });

    // No data source carries these, so they are the rules the reference builder would silently
    // drop — a fully refitted Asphodel without them is missing its defining property.
    describe('rules no data source carries', () => {
        it('tops a refitted Asphodel up to a guaranteed crit', () => {
            const ship = referenceShip(template({ name: 'Asphodel' }), 'refitted', ascension);
            const crit = ship.refits.flatMap((r) => r.stats).find((s) => s.name === 'crit');
            expect(crit).toEqual({ name: 'crit', value: 90, type: 'percentage' });
        });

        it('leaves an r0 Asphodel alone, since its second refit is what grants it', () => {
            const ship = referenceShip(template({ name: 'Asphodel' }), 'r0', ascension);
            expect(ship.refits).toEqual([]);
        });

        it('gives a refitted Iridium its damage reduction', () => {
            const ship = referenceShip(template({ name: 'Iridium' }), 'refitted', ascension);
            expect(ship.baseStats.damageReduction).toBe(35);
        });

        it('withholds it from an r0 Iridium', () => {
            const ship = referenceShip(template({ name: 'Iridium' }), 'r0', ascension);
            expect(ship.baseStats.damageReduction).toBe(0);
        });

        it('gives Isha its hp regen, which no export carries', () => {
            expect(
                referenceShip(template({ name: 'Isha' }), 'r0', ascension).baseStats.hpRegen
            ).toBe(5);
        });
    });

    it('drops an attribute this app does not model rather than coercing it', () => {
        const ship = referenceShip(template(), 'refitted', [
            { level: 1, attribute: 'CritResistance', type: 'Flat', value: 0.1 },
        ]);
        expect(ship.refits[0].stats).toEqual([{ name: 'attack', value: 0, type: 'flat' }]);
    });

    it('is distinguishable from an owned ship by its id', () => {
        expect(referenceShip(template(), 'r0', ascension).id).toBe('template:TEMPLATE_1:r0');
        expect(referenceShip(template(), 'refitted', ascension).id).toBe(
            'template:TEMPLATE_1:refitted'
        );
    });
});

describe('parseAscensionStats', () => {
    it('reads a well-formed column', () => {
        expect(parseAscensionStats(ascension)).toEqual(ascension);
    });

    it.each([[null], [undefined], [{}], ['[]'], [[]], [[{ level: 1 }]]])(
        'returns null for %s rather than a half-applied list',
        (value) => {
            expect(parseAscensionStats(value)).toBeNull();
        }
    );

    // One bad row rejects the whole column: a partial list still satisfies
    // `canBeFullyRefitted`, so the picker would offer a refitted version missing grants.
    it('rejects the whole column when one row is malformed', () => {
        expect(parseAscensionStats([ascension[0], { level: 2 }])).toBeNull();
    });

    it.each([
        ['a level past the last refit', { ...ascension[0], level: 7 }],
        ['a fractional level', { ...ascension[0], level: 1.5 }],
        ['a negative level', { ...ascension[0], level: -1 }],
        ['a non-finite value', { ...ascension[0], value: Number.POSITIVE_INFINITY }],
        ['a NaN value', { ...ascension[0], value: Number.NaN }],
    ])('rejects a column carrying %s', (_label, row) => {
        expect(parseAscensionStats([row])).toBeNull();
    });

    it('accepts level 0, which is an innate grant rather than a refit', () => {
        const innate = { level: 0, attribute: 'CritChance', type: 'Flat', value: 0.2 };
        expect(parseAscensionStats([innate])).toEqual([innate]);
    });
});

describe('canBeFullyRefitted', () => {
    it('is false without ascension data, so the option is hidden rather than wrong', () => {
        expect(canBeFullyRefitted(null)).toBe(false);
    });

    it('is true with it', () => {
        expect(canBeFullyRefitted(ascension)).toBe(true);
    });
});
