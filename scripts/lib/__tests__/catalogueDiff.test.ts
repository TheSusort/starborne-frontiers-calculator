import { describe, it, expect } from 'vitest';
import { diffCatalogue, stableStringify, type TemplateRow } from '../catalogueDiff';
import type { CatalogueTemplate } from '../catalogueMapping';

const unit = (over: Partial<CatalogueTemplate> = {}): CatalogueTemplate => ({
    definitionId: 'Atlas_Supporter_Legendary_1',
    slug: 'aegis',
    name: 'AEGIS',
    rarity: 'legendary',
    faction: 'ATLAS_SYNDICATE',
    type: 'SUPPORTER',
    affinity: 'antimatter',
    imageKey: 'Atlas_11',
    images: { avatar: 'https://x/Atlas_11_Loot.png', bigPortrait: null },
    baseStats: { hp: 100, attack: 10, defence: 10, hacking: 1, security: 1, crit_rate: 0, crit_damage: 4, speed: 98 },
    ascensionStats: [{ level: 1, attribute: 'Power', type: 'Flat', value: 5 }],
    skills: {
        active_skill_text: 'A',
        charge_skill_text: 'C',
        first_passive_skill_text: 'P1',
        second_passive_skill_text: 'P2',
        third_passive_skill_text: null,
    },
    chargeSkillCharge: 4,
    mappingErrors: [],
    ...over,
});

const row = (over: Partial<TemplateRow> = {}): TemplateRow => ({
    id: 'AEGIS',
    name: 'AEGIS',
    rarity: 'legendary',
    faction: 'ATLAS_SYNDICATE',
    type: 'SUPPORTER',
    affinity: 'antimatter',
    image_key: 'Atlas_11',
    definition_id: 'Atlas_Supporter_Legendary_1',
    base_stats: { hp: 100, attack: 10, defence: 10, hacking: 1, security: 1, crit_rate: 0, crit_damage: 4, speed: 98 },
    ascension_stats: [{ level: 1, attribute: 'Power', type: 'Flat', value: 5 }],
    charge_skill_charge: 4,
    active_skill_text: 'A',
    charge_skill_text: 'C',
    first_passive_skill_text: 'P1',
    second_passive_skill_text: 'P2',
    third_passive_skill_text: null,
    ...over,
});

describe('diffCatalogue', () => {
    it('reports no changes for an identical row', () => {
        const d = diffCatalogue([unit()], [row()]);
        expect(d.matched).toHaveLength(1);
        expect(d.matched[0].changes).toEqual([]);
    });

    it('reports each changed stat, ignoring keys outside the base set', () => {
        const d = diffCatalogue(
            [unit({ baseStats: { ...unit().baseStats, hp: 120 } })],
            [row({ base_stats: { ...row().base_stats, shield: 9 } })]
        );
        expect(d.matched[0].changes).toEqual([{ kind: 'stats', field: 'hp', before: 100, after: 120 }]);
    });

    it('reports charge cost, ascension and per-column skill text changes', () => {
        const d = diffCatalogue(
            [unit({ chargeSkillCharge: 3, skills: { ...unit().skills, charge_skill_text: 'C2' } })],
            [row({ ascension_stats: null })]
        );
        const kinds = d.matched[0].changes.map((c) => c.kind).sort();
        expect(kinds).toEqual(['ascension', 'charge-cost', 'skill-text']);
        expect(d.matched[0].changes.find((c) => c.kind === 'skill-text')).toMatchObject({
            column: 'charge_skill_text', before: 'C', after: 'C2',
        });
    });

    it('never clears ascension stats the catalogue does not carry', () => {
        const d = diffCatalogue([unit({ ascensionStats: null })], [row()]);
        expect(d.matched[0].changes).toEqual([]);
    });

    it('compares ascension stats regardless of row order', () => {
        const a = [
            { level: 1, attribute: 'Power', type: 'Flat', value: 5 },
            { level: 0, attribute: 'CritChance', type: 'Percentage', value: 0.2 },
        ];
        const d = diffCatalogue([unit({ ascensionStats: a })], [row({ ascension_stats: [...a].reverse() })]);
        expect(d.matched[0].changes).toEqual([]);
    });

    it('reports metadata drift, skipping fields the mapping could not resolve', () => {
        const d = diffCatalogue([unit({ type: 'DEFENDER', faction: null })], [row()]);
        expect(d.matched[0].changes).toEqual([
            { kind: 'metadata', field: 'type', before: 'SUPPORTER', after: 'DEFENDER' },
        ]);
    });

    it('treats a name match with a different definition_id as an id mismatch, not a new ship', () => {
        const d = diffCatalogue(
            [unit({ definitionId: 'Legion_Debuffer_Epic_1', name: 'Enforcer' })],
            [row({ id: 'ENFORCER', name: 'Enforcer', definition_id: 'Legion_Debuffer_Epic_1 ' })]
        );
        expect(d.newShips).toEqual([]);
        expect(d.idMismatches).toHaveLength(1);
        expect(d.missingFromCatalogue).toEqual([]);
    });

    it('classifies unmatched units as new ships and unmatched rows as missing', () => {
        const d = diffCatalogue(
            [unit({ definitionId: 'New_1', name: 'Newship' })],
            [row()]
        );
        expect(d.newShips.map((u) => u.name)).toEqual(['Newship']);
        expect(d.missingFromCatalogue.map((r) => r.id)).toEqual(['AEGIS']);
    });
});

describe('stableStringify', () => {
    it('is independent of key order', () => {
        expect(stableStringify({ a: 1, b: [{ y: 2, x: 1 }] })).toBe(stableStringify({ b: [{ x: 1, y: 2 }], a: 1 }));
    });
});
