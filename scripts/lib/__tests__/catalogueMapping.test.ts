import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { catalogueUnitPayloadSchema } from '../catalogueSchema';
import { renderSkillText, toCatalogueTemplate } from '../catalogueMapping';

const load = (slug: string) =>
    catalogueUnitPayloadSchema.parse(
        JSON.parse(readFileSync(join(__dirname, 'fixtures/catalogue', `${slug}.json`), 'utf8'))
    ).unit;

describe('renderSkillText', () => {
    it('tags effects, damage and aid spans', () => {
        expect(
            renderSkillText([
                { text: 'This Unit grants a ' },
                { text: 'shield equal to 15%', color: '#EE6F1A' },
                { text: ' and ' },
                { text: 'cleanses 2', color: '#FFE172' },
                { text: ' and ' },
                { text: 'Hacking Up II', effectId: 'Buff_Stat_DEBUFF_CHANCE' },
                { text: '.' },
            ])
        ).toBe(
            'This Unit grants a <unit-damage>shield equal to 15%</unit-damage> and <unit-aid>cleanses 2</unit-aid> and <unit-skill>Hacking Up II</unit-skill>.'
        );
    });

    it('leaves whitespace-only segments untagged, even with an effectId', () => {
        expect(
            renderSkillText([
                { text: 'detonates', effectId: 'Detonation' },
                { text: ' ', effectId: 'X' },
                { text: 'Corrosion', effectId: 'Corrosion' },
            ])
        ).toBe('<unit-skill>detonates</unit-skill> <unit-skill>Corrosion</unit-skill>');
    });

    it('turns each newline into <br />', () => {
        expect(renderSkillText([{ text: 'A.\n\nB.' }])).toBe('A.<br /><br />B.');
    });

    it('matches colors case-insensitively', () => {
        expect(renderSkillText([{ text: '5%', color: '#ee6f1a' }])).toBe('<unit-damage>5%</unit-damage>');
    });
});

describe('toCatalogueTemplate', () => {
    it('maps AEGIS stats, enums and image key', () => {
        const t = toCatalogueTemplate(load('aegis'));
        expect(t.definitionId).toBe('Atlas_Supporter_Legendary_1');
        expect(t.baseStats).toEqual({
            hp: 17873, attack: 2356, defence: 2381, hacking: 87, security: 37,
            crit_rate: 0, crit_damage: 4, speed: 98,
        });
        expect(t.faction).toBe('ATLAS_SYNDICATE');
        expect(t.type).toBe('SUPPORTER');
        expect(t.rarity).toBe('legendary');
        expect(t.affinity).toBe('antimatter');
        expect(t.imageKey).toBe('Atlas_11');
        expect(t.mappingErrors).toEqual([]);
    });

    it('uses the max level of active and charged, and the charge cost', () => {
        const t = toCatalogueTemplate(load('aegis'));
        expect(t.skills.active_skill_text).toContain('21%');
        expect(t.skills.active_skill_text).toContain('<unit-skill>Hacking Up III</unit-skill>');
        expect(t.chargeSkillCharge).toBe(4);
        expect(t.skills.charge_skill_text).not.toBeNull();
    });

    it('maps passive levels 1..3 to the three passive columns', () => {
        const t = toCatalogueTemplate(load('amartya'));
        expect(t.skills.first_passive_skill_text).toContain('1 stack');
        expect(t.skills.second_passive_skill_text).toContain('<br /><br />');
        expect(t.skills.third_passive_skill_text).toContain('2 stacks');
    });

    it('leaves charged and passives null for a unit without them', () => {
        const t = toCatalogueTemplate(load('bedrock'));
        expect(t.skills.charge_skill_text).toBeNull();
        expect(t.chargeSkillCharge).toBeNull();
        expect(t.skills.first_passive_skill_text).toBeNull();
    });

    it('reports an unknown enum instead of guessing', () => {
        const unit = { ...load('aegis'), faction: 'Brand New Faction' };
        const t = toCatalogueTemplate(unit);
        expect(t.faction).toBeNull();
        expect(t.mappingErrors).toEqual(['unknown faction "Brand New Faction"']);
    });

    it('accepts a whitespace-only separator between two named effects', () => {
        const t = toCatalogueTemplate(load('crocus'));
        expect(t.skills.charge_skill_text).toContain(
            '<unit-skill>detonates</unit-skill> <unit-skill>Corrosion</unit-skill>'
        );
        expect(t.mappingErrors).toEqual([]);
    });

    it('reports a named effect with empty text', () => {
        const unit = load('aegis');
        const active = unit.skills.find((s) => s.levels[0].kind === 'Active')!;
        const top = active.levels.reduce((a, b) => (b.level > a.level ? b : a));
        top.descriptionSegments.push({ text: '', effectId: 'Buff_Ghost' });
        expect(toCatalogueTemplate(unit).mappingErrors).toEqual(['empty named effect "Buff_Ghost"']);
    });

    it('reports a charged skill whose max level has no charge cost', () => {
        const unit = load('crocus');
        const charged = unit.skills.find((s) => s.levels[0].kind === 'Charged')!;
        const top = charged.levels.reduce((a, b) => (b.level > a.level ? b : a));
        delete top.chargesRequired;
        const t = toCatalogueTemplate(unit);
        expect(t.chargeSkillCharge).toBeNull();
        expect(t.mappingErrors).toEqual(['charged skill without chargesRequired']);
    });

    it('reports more than one passive skill track', () => {
        const unit = load('amartya');
        unit.ascensionSkills.push(unit.ascensionSkills[0]);
        expect(toCatalogueTemplate(unit).mappingErrors).toEqual(['more than one passive skill track']);
    });

    it('reports more passive levels than there are passive columns', () => {
        const unit = load('amartya');
        const track = unit.ascensionSkills[0];
        track.levels.push({ ...track.levels[0], level: 4 });
        expect(toCatalogueTemplate(unit).mappingErrors).toEqual(['4 passive levels; only 3 columns']);
    });

    it('keeps ascension stats, or null when the unit has none', () => {
        expect(toCatalogueTemplate(load('aegis')).ascensionStats?.length).toBeGreaterThan(0);
        expect(toCatalogueTemplate({ ...load('aegis'), ascensionStats: [] }).ascensionStats).toBeNull();
    });
});

describe('catalogueUnitPayloadSchema', () => {
    it('rejects a payload whose stats block lost a field', () => {
        const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures/catalogue/aegis.json'), 'utf8'));
        delete raw.unit.stats.HullPoints;
        expect(catalogueUnitPayloadSchema.safeParse(raw).success).toBe(false);
    });
});
