import { describe, it, expect } from 'vitest';
import type { Ability } from '../../../src/types/abilities';
import type { ShipSkillRecord } from '../shipSkillCsv';
import { abilitySignature, diffCorpora, summarizeDiff, type SlotParser } from '../skillParseDiff';

const rec = (name: string, active: string, p: [string, string, string] = ['', '', '']): ShipSkillRecord => ({
    name, active, charge: '', chargeCharge: 4, passives: p,
});
const ab = (type: string, trigger: string, buffName?: string): Ability =>
    ({ id: 'x', type, target: 'self', trigger, conditions: [], config: buffName ? { type, buffName } : { type } }) as unknown as Ability;

// A fake parser keyed on text, so the diff logic is tested without the real parser.
const table: Record<string, Ability[]> = {
    'gains <unit-skill>A</unit-skill> on kill': [ab('buff', 'on-enemy-destroyed', 'A')],
    'gains <unit-skill>A</unit-skill> when it destroys an enemy': [ab('buff', 'on-cast', 'A')],
    'deals 100% damage': [ab('damage', 'on-cast')],
    'deals 120% damage': [ab('damage', 'on-cast')],
};
const parser: SlotParser = (r) => ({
    active: table[r.active] ?? [],
    charged: [],
    passive: table[r.passives[0]] ?? [],
});

describe('diffCorpora', () => {
    it('classifies a wording change that demotes a trigger as structural', () => {
        const rows = diffCorpora(
            [rec('S', 'deals 100% damage', ['gains <unit-skill>A</unit-skill> on kill', '', ''])],
            [rec('S', 'deals 100% damage', ['gains <unit-skill>A</unit-skill> when it destroys an enemy', '', ''])],
            parser
        );
        const passive = rows.find((r) => r.slot === 'passive')!;
        expect(passive.kind).toBe('wording');
        expect(passive.structural).toBe(true);
        expect(passive.lost).toEqual(['buff|self|on-enemy-destroyed|A']);
        expect(passive.gained).toEqual(['buff|self|on-cast|A']);
        expect(rows.find((r) => r.slot === 'active')!.kind).toBe('identical');
    });

    it('a number-only change with the same signatures is not structural', () => {
        const [row] = diffCorpora([rec('S', 'deals 100% damage')], [rec('S', 'deals 120% damage')], parser)
            .filter((r) => r.slot === 'active');
        expect(row.kind).toBe('number');
        expect(row.structural).toBe(false);
    });

    it('a ship missing from the candidate is reported, not skipped', () => {
        const rows = diffCorpora([rec('S', 'deals 100% damage')], [], parser);
        expect(rows).toEqual([expect.objectContaining({ name: 'S', kind: 'missing' })]);
    });

    it('summarizeDiff counts structural rows per kind', () => {
        const rows = diffCorpora(
            [rec('S', 'deals 100% damage', ['gains <unit-skill>A</unit-skill> on kill', '', ''])],
            [rec('S', 'deals 120% damage', ['gains <unit-skill>A</unit-skill> when it destroys an enemy', '', ''])],
            parser
        );
        expect(summarizeDiff(rows)).toMatchObject({ structural: { wording: 1 }, rows: 3 });
    });
});

describe('abilitySignature', () => {
    it('names the buff when there is one, else the config type', () => {
        expect(abilitySignature(ab('buff', 'on-cast', 'Attack Up II'))).toBe('buff|self|on-cast|Attack Up II');
        expect(abilitySignature(ab('damage', 'on-cast'))).toBe('damage|self|on-cast|damage');
    });
});
