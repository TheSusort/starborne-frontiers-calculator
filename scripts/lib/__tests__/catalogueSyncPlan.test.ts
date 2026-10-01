import { describe, it, expect } from 'vitest';
import { isDroppedField, planSync, templateIdFor } from '../catalogueSyncPlan';
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

/** One changed ship among four unchanged ones: under every whole-run ratio threshold. */
const amongQuiet = (first: UnitDiff): UnitDiff[] => [first, ...['Q1', 'Q2', 'Q3', 'Q4'].map((id) => matched(id, []))];
const spyGate = () => {
    const calls: string[] = [];
    const gate: SkillGate = (name) => (calls.push(name), { pass: true, newFindings: [] });
    return { gate, calls };
};

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
        const plan = planSync(diff({ matched: amongQuiet(matched('A', [text])) }), [], pass, on);
        expect(plan.patches[0].patch).toEqual({ active_skill_text: 'A2' });
        expect(plan.patches[0].heldText).toEqual([]);
    });

    it('holds ALL of a ship\'s text when the gate fails, but still writes its stats', () => {
        const rows = ['A', 'B', 'C', 'D', 'E'].map((id) => matched(id, id === 'A' ? [hp, text] : []));
        const plan = planSync(diff({ matched: rows }), [], fail, on);
        expect(plan.patches[0].patch).toEqual({ base_stats: { hp: 2, shield: 5 } });
        expect(plan.patches[0].heldText).toEqual([text]);
        expect(plan.patches[0].gate?.pass).toBe(false);
        expect(plan.patches[0].textHold).toBe('gate');
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
        expect(plan.patches[0]).toMatchObject({ patch: {}, heldText: [text], textHold: 'text-writes-off', gate: null });
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

describe('planSync — mapping errors', () => {
    it('writes nothing for a matched unit with mapping errors and records why', () => {
        const { gate, calls } = spyGate();
        const charge: Change = { kind: 'charge-cost', before: 3, after: 4 };
        const broken: UnitDiff = {
            template: row('A'),
            unit: unit({ mappingErrors: ['empty named effect "X"'] }),
            changes: [hp, charge, text],
        };
        const plan = planSync(diff({ matched: amongQuiet(broken) }), [], gate, on);
        expect(plan.halted).toBeNull();
        expect(plan.patches).toEqual([]);
        expect(calls).toEqual([]);
        expect(plan.mappingHeld).toEqual([
            { template: broken.template, unit: broken.unit, reasons: ['empty named effect "X"'] },
        ]);
    });
});

describe('planSync — a change that would erase a value', () => {
    it('holds a charge cost the catalogue dropped, still writing the ship\'s stats', () => {
        const drop: Change = { kind: 'charge-cost', before: 4, after: null };
        const plan = planSync(diff({ matched: amongQuiet(matched('A', [hp, drop])) }), [], pass, on);
        expect(plan.patches[0].patch).toEqual({ base_stats: { hp: 2, shield: 5 } });
        expect(plan.patches[0].applied).toEqual([hp]);
        expect(plan.patches[0].heldDrops).toEqual([drop]);
    });

    it('still writes a charge cost that goes from null to a number', () => {
        const add: Change = { kind: 'charge-cost', before: null, after: 4 };
        const plan = planSync(diff({ matched: amongQuiet(matched('A', [add])) }), [], pass, on);
        expect(plan.patches[0].patch).toEqual({ charge_skill_charge: 4 });
        expect(plan.patches[0].heldDrops).toEqual([]);
    });

    it.each([null, '', '   '])('holds ALL of a ship\'s text when one column drops to %j, without calling the gate', (after) => {
        const { gate, calls } = spyGate();
        const drop: Change = { kind: 'skill-text', column: 'charge_skill_text', before: 'C', after };
        const plan = planSync(diff({ matched: amongQuiet(matched('A', [hp, text, drop])) }), [], gate, on);
        expect(calls).toEqual([]);
        expect(plan.patches[0].patch).toEqual({ base_stats: { hp: 2, shield: 5 } });
        expect(plan.patches[0]).toMatchObject({ heldText: [text, drop], textHold: 'dropped-field', gate: null });
    });

    it('does not treat filling an empty column as a drop', () => {
        const fill: Change = { kind: 'skill-text', column: 'charge_skill_text', before: null, after: '' };
        const plan = planSync(diff({ matched: amongQuiet(matched('A', [fill])) }), [], pass, on);
        expect(plan.patches[0]).toMatchObject({ patch: { charge_skill_text: '' }, heldText: [], textHold: null });
    });
});

describe('planSync — bulk text hold', () => {
    const textAndHp = (id: string) => matched(id, [hp, text]);

    it('holds all text, without calling the gate, when over a quarter of matched ships change text', () => {
        const { gate, calls } = spyGate();
        const rows = [textAndHp('A'), matched('B', [text]), ...['C', 'D', 'E', 'F', 'G'].map((id) => matched(id, []))];
        const plan = planSync(diff({ matched: rows }), [], gate, on);
        expect(calls).toEqual([]);
        expect(plan.halted).toBeNull();
        expect(plan.bulkTextHold).toEqual({ changed: 2, matched: 7 });
        expect(plan.patches[0]).toMatchObject({
            patch: { base_stats: { hp: 2, shield: 5 } },
            heldText: [text],
            textHold: 'bulk-text',
            gate: null,
        });
        expect(plan.patches[1]).toMatchObject({ patch: {}, heldText: [text], textHold: 'bulk-text' });
    });

    it('refuses new ships during a bulk text hold, without calling the gate', () => {
        const { gate, calls } = spyGate();
        const plan = planSync(
            diff({ matched: [matched('A', [text]), matched('B', [])], newShips: [unit({ name: 'Brand New', definitionId: 'D7' })] }),
            [row('A'), row('B')],
            gate,
            on
        );
        expect(calls).toEqual([]);
        expect(plan.inserts).toEqual([]);
        expect(plan.refusedInserts[0].reason).toMatch(/bulk-text hold/);
    });

    it('does not hold at exactly a quarter', () => {
        const plan = planSync(diff({ matched: [matched('A', [text]), ...['B', 'C', 'D'].map((id) => matched(id, []))] }), [], pass, on);
        expect(plan.bulkTextHold).toBeNull();
        expect(plan.patches[0]).toMatchObject({ patch: { active_skill_text: 'A2' }, textHold: null });
    });

    it('writes bulk text through the gate with allowBulkText', () => {
        const { gate, calls } = spyGate();
        const plan = planSync(diff({ matched: [matched('A', [text]), matched('B', [text])] }), [], gate, { textWrites: true, allowBulkText: true });
        expect(calls).toEqual(['A', 'B']);
        expect(plan.bulkTextHold).toBeNull();
        expect(plan.patches.map((p) => p.patch)).toEqual([{ active_skill_text: 'A2' }, { active_skill_text: 'A2' }]);
    });

    it('reports no bulk hold on a stats-only run', () => {
        const plan = planSync(diff({ matched: [matched('A', [text])] }), [], pass, { textWrites: false });
        expect(plan.bulkTextHold).toBeNull();
        expect(plan.patches[0].textHold).toBe('text-writes-off');
    });
});

describe('isDroppedField', () => {
    it('flags a non-empty value going null or blank, and nothing else', () => {
        expect(isDroppedField({ kind: 'charge-cost', before: 4, after: null })).toBe(true);
        expect(isDroppedField({ kind: 'charge-cost', before: null, after: null })).toBe(false);
        expect(isDroppedField({ kind: 'skill-text', column: 'active_skill_text', before: 'A', after: ' ' })).toBe(true);
        expect(isDroppedField({ kind: 'skill-text', column: 'active_skill_text', before: ' ', after: null })).toBe(false);
        expect(isDroppedField(text)).toBe(false);
        expect(isDroppedField(hp)).toBe(false);
    });
});

describe('templateIdFor', () => {
    it('follows the Admin form rule', () => {
        expect(templateIdFor('Ion Scorp')).toBe('ION_SCORP');
    });
});
