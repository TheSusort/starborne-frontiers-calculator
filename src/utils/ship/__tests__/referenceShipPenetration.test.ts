import { describe, it, expect } from 'vitest';
import type { Ship } from '../../../types/ship';
import type { BaseStats } from '../../../types/stats';
import { calculateTotalStats } from '../statsCalculator';
import { referenceShip, type AscensionStat, type ReferenceVariant } from '../referenceShip';
import { transformShipTemplate, type ShipTemplate } from '../shipTemplate';

/**
 * Fixture rows are real `ship_templates` rows (base_stats from the 2026-10-01 backup) with the
 * official catalogue's `ascensionStats` for that unit, trimmed to the rows these tests read.
 * Real rows omit base_stats keys freely — Liberator has no `defense_penetration`, Judge no
 * penetration at all — so the fixture type allows that rather than padding them with zeros.
 */
type TemplateRow = Omit<ShipTemplate, 'base_stats' | 'ascension_stats'> & {
    base_stats: Partial<ShipTemplate['base_stats']> & Record<string, number>;
    ascension_stats: AscensionStat[];
};

const row = (
    fields: Pick<TemplateRow, 'id' | 'name' | 'base_stats' | 'ascension_stats'>
): TemplateRow => ({
    rarity: 'legendary',
    faction: 'FRONTIER_LEGION',
    type: 'ATTACKER',
    affinity: 'thermal',
    image_key: fields.id,
    ...fields,
});

const LIBERATOR = row({
    id: 'LIBERATOR',
    name: 'Liberator',
    base_stats: {
        hp: 12860,
        speed: 87,
        attack: 4489,
        defence: 1984,
        hacking: 70,
        security: 9,
        crit_rate: 23,
        crit_damage: 50,
        shield_penetration: 40,
    },
    ascension_stats: [{ level: 0, attribute: 'ShieldPenetration', type: 'Flat', value: 0.4 }],
});

// The template's 45 is the fully refitted TOTAL (innate 15 + the R4 grant of 30).
const PROPHET = row({
    id: 'PROPHET',
    name: 'Prophet',
    base_stats: {
        hp: 17797,
        speed: 74,
        attack: 3472,
        shield: 0,
        defence: 1885,
        hacking: 65,
        hp_regen: 0,
        security: 72,
        crit_rate: 12,
        crit_damage: 46,
        shield_penetration: 45,
        defense_penetration: 0,
    },
    ascension_stats: [
        { level: 0, attribute: 'ShieldPenetration', type: 'Flat', value: 0.15 },
        { level: 4, attribute: 'ShieldPenetration', type: 'Flat', value: 0.3 },
    ],
});

const CRUCIALIS = row({
    id: 'CRUCIALIS',
    name: 'Crucialis',
    base_stats: {
        hp: 11138,
        speed: 79,
        attack: 3546,
        shield: 20,
        defence: 1270,
        hacking: 74,
        security: 17,
        crit_rate: 17,
        crit_damage: 42,
        shield_penetration: 20,
    },
    ascension_stats: [{ level: 0, attribute: 'ShieldPenetration', type: 'Flat', value: 0.2 }],
});

const MEDVED = row({
    id: 'MEDVED',
    name: 'Medved',
    base_stats: {
        hp: 9415,
        speed: 75,
        attack: 4489,
        defence: 1924,
        hacking: 83,
        hp_regen: 0,
        security: 2,
        crit_rate: 11,
        crit_damage: 64,
        shield_penetration: 0,
        defense_penetration: 0,
    },
    ascension_stats: [{ level: 0, attribute: 'ShieldPenetration', type: 'Flat', value: 0.2 }],
});

const JUDGE = row({
    id: 'JUDGE',
    name: 'Judge',
    base_stats: {
        hp: 10793,
        speed: 87,
        attack: 4935,
        defence: 1627,
        hacking: 82,
        security: 9,
        crit_rate: 19,
        crit_damage: 50,
    },
    ascension_stats: [{ level: 0, attribute: 'DefensePenetration', type: 'Flat', value: 0.2 }],
});

const SNAPDRAGON = row({
    id: 'SNAPDRAGON',
    name: 'Snapdragon',
    base_stats: {
        hp: 9989,
        speed: 83,
        attack: 3968,
        defence: 1786,
        hacking: 103,
        hp_regen: 0,
        security: 7,
        crit_rate: 1,
        crit_damage: 38,
        shield_penetration: 0,
        defense_penetration: 0,
    },
    ascension_stats: [{ level: 0, attribute: 'CritChance', type: 'Flat', value: 0.2 }],
});

const toShip = (template: TemplateRow): Ship => {
    const ship = transformShipTemplate(template as ShipTemplate);
    if (!ship) throw new Error(`fixture ${template.id} did not transform`);
    return ship;
};

/** The stats the reference ship fights with before gear: base stats plus its refits. */
const statsOf = (
    template: TemplateRow,
    variant: ReferenceVariant,
    ascension: AscensionStat[] | null = template.ascension_stats
): BaseStats => {
    const ship = referenceShip(toShip(template), variant, ascension);
    return calculateTotalStats(ship.baseStats, {}, () => undefined, ship.refits, {}, undefined)
        .final;
};

describe('reference ship penetration', () => {
    it('gives Liberator its 40% shield penetration once', () => {
        expect(statsOf(LIBERATOR, 'r0').shieldPenetration).toBe(40);
        expect(statsOf(LIBERATOR, 'refitted').shieldPenetration).toBe(40);
    });

    it('gives Prophet 15% at R0 and 45% once its fourth refit lands', () => {
        expect(statsOf(PROPHET, 'r0').shieldPenetration).toBe(15);
        expect(statsOf(PROPHET, 'refitted').shieldPenetration).toBe(45);
    });

    it('gives a 20% ship its 20% once', () => {
        expect(statsOf(CRUCIALIS, 'r0').shieldPenetration).toBe(20);
        expect(statsOf(CRUCIALIS, 'refitted').shieldPenetration).toBe(20);
    });

    it('gives Medved, whose template holds 0, its innate 20%', () => {
        expect(statsOf(MEDVED, 'r0').shieldPenetration).toBe(20);
    });

    it('gives Judge his 20% defense penetration once, whatever the template holds', () => {
        expect(statsOf(JUDGE, 'r0').defensePenetration).toBe(20);
        const handEntered = row({
            ...JUDGE,
            base_stats: { ...JUDGE.base_stats, defense_penetration: 20 },
        });
        expect(statsOf(handEntered, 'r0').defensePenetration).toBe(20);
        expect(statsOf(handEntered, 'refitted').defensePenetration).toBe(20);
    });

    // Tripwire for the scope of the rule: only penetration is absent from the catalogue's base
    // block. Every other innate grant ADDS to a base_stats value that mirrors that block.
    it("still adds Snapdragon's innate crit to its 1% base crit", () => {
        expect(statsOf(SNAPDRAGON, 'r0').crit).toBe(21);
    });

    it('keeps the template value when the unit has no ascension data', () => {
        expect(statsOf(LIBERATOR, 'r0', null).shieldPenetration).toBe(40);
    });
});
