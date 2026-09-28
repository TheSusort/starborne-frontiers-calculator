import { describe, it, expect } from 'vitest';
import { GEAR_SETS } from '../../constants/gearSets';
import { listGearSets, listImplants } from '../tools/gear';
import { call, ctxOver } from './fixtures';

const { ctx } = ctxOver({});

describe('list_gear_sets', () => {
    it('lists every set under its gear id', async () => {
        const result = (await call(listGearSets, {}, ctx)) as { gearSets: { id: string }[] };

        expect(result.gearSets.map((set) => set.id)).toEqual(Object.keys(GEAR_SETS));
        expect(result.gearSets.find((set) => set.id === 'ATTACK')).toEqual({
            id: 'ATTACK',
            name: 'Attack',
            stats: [{ name: 'attack', value: 15, type: 'percentage' }],
        });
    });
});

describe('list_implants', () => {
    it('filters by part of the name, any case', async () => {
        const result = (await call(listImplants, { query: 'martyr' }, ctx)) as {
            implants: { id: string; type: string; variants: unknown[] }[];
        };

        expect(result.implants).toHaveLength(1);
        expect(result.implants[0]).toMatchObject({ id: 'MARTYRDOM', type: 'ultimate' });
        expect(result.implants[0].variants).toContainEqual({
            rarity: 'legendary',
            stats: [],
            description: 'Applies Disable for 2 turns on the enemy that killed this Unit.',
        });
    });

    it('lists every implant with no query', async () => {
        const result = (await call(listImplants, {}, ctx)) as { implants: unknown[] };

        expect(result.implants.length).toBeGreaterThan(10);
    });
});
