import { describe, it, expect } from 'vitest';
import { extractLevel60Ships, compareShipsAgainstTemplates } from '../shipTemplateComparison';
import { getHpRegen } from '../ship/perShipRules';
import { Ship } from '../../types/ship';
import { baseAttributes, makeUnit, makeExportData } from './importPlayerData.fixtures';

/** A template whose base stats equal what `makeUnit()`'s default attributes convert to. */
const makeTemplate = (overrides: Partial<Ship['baseStats']> = {}, name = 'Vanguard'): Ship => ({
    id: 'template-vanguard',
    name,
    rarity: 'epic',
    faction: 'TERRAN_COMBINE',
    type: 'ATTACKER',
    affinity: 'thermal',
    baseStats: {
        hp: 50000,
        attack: 10000,
        defence: 8000,
        hacking: 5000,
        security: 3000,
        crit: 50,
        critDamage: 150,
        speed: 300,
        healModifier: 0,
        hpRegen: 0,
        shield: 0,
        shieldPenetration: 0,
        defensePenetration: 0,
        ...overrides,
    },
    equipment: {},
    refits: [],
    implants: {},
});

describe('extractLevel60Ships', () => {
    it('keeps only level 60 units', () => {
        const data = makeExportData({
            Units: [
                makeUnit({ Id: 'a', Level: 59 }),
                makeUnit({ Id: 'b', Level: 60 }),
                makeUnit({ Id: 'c', Level: 61 }),
                makeUnit({ Id: 'd', Level: 1 }),
            ],
        });
        expect(extractLevel60Ships(data).map((u) => u.Id)).toEqual(['b']);
    });
});

describe('compareShipsAgainstTemplates', () => {
    it('proposes a new template for a ship with no template, converting game stats', () => {
        const unit = makeUnit({
            Name: 'New Ship Mk II',
            Attributes: {
                ...makeUnit().Attributes,
                BaseWithLevelAndRank: baseAttributes({
                    CritChance: 0.35,
                    CritBoost: 0.9,
                    ShieldPenetration: 0.12,
                    DefensePenetration: 0.2,
                }),
            },
        });

        const proposals = compareShipsAgainstTemplates([unit], []);

        expect(proposals).toHaveLength(1);
        expect(proposals[0].shipName).toBe('New Ship Mk II');
        expect(proposals[0].shipId).toBe('NEW_SHIP_MK_II');
        expect(proposals[0].currentStats).toBeUndefined();
        expect(proposals[0].statDifferences).toEqual([]);
        expect(proposals[0].proposedStats).toEqual({
            hp: 50000,
            attack: 10000,
            defence: 8000,
            hacking: 5000,
            security: 3000,
            crit_rate: 35,
            crit_damage: 90,
            speed: 300,
            shield_penetration: 12,
            defense_penetration: 20,
            hp_regen: 0,
        });
    });

    it('never carries the shield stat into proposed stats', () => {
        const unit = makeUnit({
            Attributes: {
                ...makeUnit().Attributes,
                BaseWithLevelAndRank: baseAttributes({ ShieldPoints: 7000 }),
            },
        });
        const [proposal] = compareShipsAgainstTemplates([unit], []);
        expect(proposal.proposedStats).not.toHaveProperty('shield');
    });

    it('proposes nothing when the template already matches', () => {
        expect(compareShipsAgainstTemplates([makeUnit()], [makeTemplate()])).toEqual([]);
    });

    it('proposes nothing when the template differs only in shield', () => {
        const unit = makeUnit({
            Attributes: {
                ...makeUnit().Attributes,
                BaseWithLevelAndRank: baseAttributes({ ShieldPoints: 7000 }),
            },
        });
        expect(compareShipsAgainstTemplates([unit], [makeTemplate({ shield: 123 })])).toEqual([]);
    });

    it('reports each differing stat under its template name against the matched template', () => {
        const unit = makeUnit({
            Attributes: {
                ...makeUnit().Attributes,
                BaseWithLevelAndRank: baseAttributes({ Power: 10500, CritChance: 0.55 }),
            },
        });

        const proposals = compareShipsAgainstTemplates([unit], [makeTemplate()]);

        expect(proposals).toHaveLength(1);
        expect(proposals[0].shipId).toBe('template-vanguard');
        expect(proposals[0].statDifferences).toEqual([
            { stat: 'attack', currentValue: 10000, proposedValue: 10500, difference: 500 },
            { stat: 'crit_rate', currentValue: 50, proposedValue: 55, difference: 5 },
        ]);
        expect(proposals[0].currentStats).toMatchObject({ attack: 10000, crit_rate: 50 });
    });

    it('reports a one-point difference even though it is under 1% of the stat', () => {
        const unit = makeUnit({
            Attributes: {
                ...makeUnit().Attributes,
                BaseWithLevelAndRank: baseAttributes({ HullPoints: 50001 }),
            },
        });
        const [proposal] = compareShipsAgainstTemplates([unit], [makeTemplate()]);
        expect(proposal.statDifferences).toEqual([
            { stat: 'hp', currentValue: 50000, proposedValue: 50001, difference: 1 },
        ]);
    });

    it('ignores a sub-point difference that is also under 1% of the stat', () => {
        const unit = makeUnit({
            Attributes: {
                ...makeUnit().Attributes,
                BaseWithLevelAndRank: baseAttributes({ HullPoints: 50000.5 }),
            },
        });
        expect(compareShipsAgainstTemplates([unit], [makeTemplate()])).toEqual([]);
    });

    it('treats a template stat that is missing as 0 when computing the difference', () => {
        const unit = makeUnit({
            Attributes: {
                ...makeUnit().Attributes,
                BaseWithLevelAndRank: baseAttributes({ DefensePenetration: 0.1 }),
            },
        });
        const [proposal] = compareShipsAgainstTemplates(
            [unit],
            [makeTemplate({ defensePenetration: undefined })]
        );
        expect(proposal.statDifferences).toEqual([
            {
                stat: 'defense_penetration',
                currentValue: undefined,
                proposedValue: 10,
                difference: 10,
            },
        ]);
        expect(proposal.currentStats!.defense_penetration).toBe(0);
    });

    it('matches templates by ship name', () => {
        const proposals = compareShipsAgainstTemplates(
            [makeUnit({ Name: 'Vanguard' })],
            [makeTemplate({ attack: 1 }, 'Other Ship'), makeTemplate({}, 'Vanguard')]
        );
        expect(proposals).toEqual([]);
    });

    it.each(['Isha', 'Heliodor', 'Vanguard'])(
        'proposes the same hp regen for %s as the importer assigns',
        (name) => {
            const [proposal] = compareShipsAgainstTemplates([makeUnit({ Name: name })], []);
            expect(proposal.proposedStats.hp_regen).toBe(getHpRegen(name));
        }
    );

    it('proposes nothing for Isha when the template already carries her hp regen', () => {
        expect(
            compareShipsAgainstTemplates(
                [makeUnit({ Name: 'Isha' })],
                [makeTemplate({ hpRegen: 5 }, 'Isha')]
            )
        ).toEqual([]);
    });
});
