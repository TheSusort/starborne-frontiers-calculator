import { describe, it, expect } from 'vitest';
import { planSync, templateIdFor } from '../catalogueSyncPlan';
import type { CatalogueDiff, Change, TemplateRow, UnitDiff } from '../catalogueDiff';
import type { CatalogueTemplate } from '../catalogueMapping';
import type { SkillGate } from '../skillTextGate';

const pass: SkillGate = () => ({ pass: true, newFindings: [] });
const fail: SkillGate = () => ({ pass: false, newFindings: ['charged · detonation: x'] });

const unit = (over: Partial<CatalogueTemplate> = {}): CatalogueTemplate => ({
    definitionId: 'D1', slug: 's', name: 'Ship One', rarity: 'rare', faction: 'XAOC', type: 'ATTACKER',
    affinity: 'thermal', imageKey: 'XAOC_1', images: { avatar: 'a', bigPortrait: 'b' },
    baseStats: { hp: 1, attack: 1, defence: 1, hacking: 1, security: 1, crit_rate: 1, crit_damage: 1, speed: 1 },
    ascensionStats: null,
    skills: { active_skill_text: 'A2', charge_skill_text: null, first_passive_skill_text: null, second_passive_skill_text: null, third_passive_skill_text: null },
    chargeSkillCharge: null, mappingErrors: [], ...over,
});
const row = (id: string, over: Partial<TemplateRow> = {}): TemplateRow => ({
    id, name: id, rarity: 'rare', faction: 'XAOC', type: 'ATTACKER', affinity: 'thermal', image_key: 'k',
    definition_id: id, base_stats: { hp: 1, shield: 5 }, ascension_stats: null, charge_skill_charge: null,
    active_skill_text: 'A', charge_skill_text: null, first_passive_skill_text: null,
    second_passive_skill_text: null, third_passive_skill_text: null, ...over,
});
const matched = (id: string, changes: Change[]): UnitDiff => ({ template: row(id), unit: unit(), changes });
const diff = (over: Partial<CatalogueDiff> = {}): CatalogueDiff => ({
    matched: [], newShips: [], idMismatches: [], missingFromCatalogue: [], ...over,
});
const on = { textWrites: true };
const hp: Change = { kind: 'stats', field: 'hp', before: 1, after: 2 };
const text: Change = { kind: 'skill-text', column: 'active_skill_text', before: 'A', after: 'A2' };

describe('planSync', () => {
    it('halts when nothing matched', () => {
        expect(planSync(diff(), [], pass, on).halted).toMatch(/matched/);
    });

    it('halts when more than a quarter of matched ships change stats', () => {
        const rows = ['A', 'B', 'C'].map((id) => matched(id, id === 'C' ? [] : [hp]));
        expect(planSync(diff({ matched: rows }), [], pass, on).halted).toMatch(/stats/);
    });

    it('merges stat changes into the existing base_stats', () => {
        const rows = ['A', 'B', 'C', 'D', 'E'].map((id) => matched(id, id === 'A' ? [hp] : []));
        const plan = planSync(diff({ matched: rows }), [], pass, on);
        expect(plan.halted).toBeNull();
        expect(plan.patches).toHaveLength(1);
        expect(plan.patches[0].patch).toEqual({ base_stats: { hp: 2, shield: 5 } });
    });

    it('writes skill text when the gate passes', () => {
        const plan = planSync(diff({ matched: [matched('A', [text])] }), [], pass, on);
        expect(plan.patches[0].patch).toEqual({ active_skill_text: 'A2' });
        expect(plan.patches[0].heldText).toEqual([]);
    });

    it('holds ALL of a ship\'s text when the gate fails, but still writes its stats', () => {
        const rows = ['A', 'B', 'C', 'D', 'E'].map((id) => matched(id, id === 'A' ? [hp, text] : []));
        const plan = planSync(diff({ matched: rows }), [], fail, on);
        expect(plan.patches[0].patch).toEqual({ base_stats: { hp: 2, shield: 5 } });
        expect(plan.patches[0].heldText).toEqual([text]);
        expect(plan.patches[0].gate?.pass).toBe(false);
    });

    it('holds all text and refuses inserts when text writes are off, without calling the gate', () => {
        let called = false;
        const spy: SkillGate = () => ((called = true), { pass: true, newFindings: [] });
        const plan = planSync(
            diff({ matched: [matched('A', [text])], newShips: [unit({ name: 'Brand New', definitionId: 'D7' })] }),
            [row('A')],
            spy,
            { textWrites: false }
        );
        expect(called).toBe(false);
        expect(plan.patches[0]).toMatchObject({ patch: {}, heldText: [text], gate: null });
        expect(plan.inserts).toEqual([]);
        expect(plan.refusedInserts[0].reason).toMatch(/stats-only/);
    });

    it('never patches metadata; lists it instead', () => {
        const meta: Change = { kind: 'metadata', field: 'type', before: 'SUPPORTER', after: 'DEFENDER' };
        const plan = planSync(diff({ matched: [matched('A', [meta])] }), [], pass, on);
        expect(plan.patches).toEqual([]);
        expect(plan.metadata).toHaveLength(1);
    });

    it('builds an insert for a new ship with its audit findings', () => {
        const plan = planSync(diff({ matched: [matched('A', [])], newShips: [unit()] }), [row('A')], fail, on);
        expect(plan.inserts).toHaveLength(1);
        expect(plan.inserts[0].row).toMatchObject({
            id: 'SHIP_ONE', name: 'Ship One', definition_id: 'D1', image_key: 'XAOC_1',
            active_skill_text: 'A2', active_target: null, bio: null,
        });
        expect(plan.inserts[0].findings).toEqual(['charged · detonation: x']);
    });

    it('refuses an insert with mapping errors or a colliding id', () => {
        const plan = planSync(
            diff({
                matched: [matched('A', [])],
                newShips: [unit({ mappingErrors: ['unknown faction "Q"'] }), unit({ name: 'a', definitionId: 'D9' })],
            }),
            [row('A')],
            pass,
            on
        );
        expect(plan.inserts).toEqual([]);
        expect(plan.refusedInserts.map((r) => r.reason)).toEqual(['unknown faction "Q"', 'id A already exists']);
    });
});

describe('templateIdFor', () => {
    it('follows the Admin form rule', () => {
        expect(templateIdFor('Ion Scorp')).toBe('ION_SCORP');
    });
});
