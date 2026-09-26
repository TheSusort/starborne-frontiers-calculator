import { describe, it, expect } from 'vitest';
import { getShipSkills } from '../tools/skills';
import { call, ctxOver, templateRow } from './fixtures';

describe('get_ship_skills', () => {
    const { ctx } = ctxOver({ ship_templates: [templateRow()] });

    it('shows the base passive at refits 0 (the default)', async () => {
        const result = (await call(getShipSkills, { name: 'Atlas' }, ctx)) as {
            refits: number;
            skills: { label: string }[];
        };

        expect(result.refits).toBe(0);
        expect(result.skills.map((row) => row.label)).toEqual(['Active', 'Charge', 'Passive R0']);
    });

    it('shows only the refit-active passive', async () => {
        const r2 = (await call(getShipSkills, { name: 'Atlas', refits: 2 }, ctx)) as {
            skills: { label: string }[];
        };
        const r4 = (await call(getShipSkills, { name: 'Atlas', refits: 4 }, ctx)) as {
            skills: { label: string }[];
        };

        expect(r2.skills.map((row) => row.label)).toEqual(['Active', 'Charge', 'Passive R2']);
        expect(r4.skills.map((row) => row.label)).toEqual(['Active', 'Charge', 'Passive R4']);
    });

    it('carries the charge count and the parsed effects of the active rows', async () => {
        const result = (await call(getShipSkills, { name: 'Atlas', refits: 4 }, ctx)) as {
            skills: { label: string; charge?: number }[];
            effects: { buffName: string }[];
        };

        expect(result.skills.find((row) => row.label === 'Charge')?.charge).toBe(3);
        expect(result.effects).toEqual([
            {
                buffName: 'Defense Down II',
                target: 'enemy',
                duration: 2,
                source: 'charge',
                application: 'inflict',
            },
            { buffName: 'Attack Up III', target: 'self', duration: 1, source: 'passive3' },
        ]);
    });

    it('accepts only 0, 2 or 4 refits', () => {
        expect(getShipSkills.input.safeParse({ name: 'Atlas', refits: 3 }).success).toBe(false);
    });
});
