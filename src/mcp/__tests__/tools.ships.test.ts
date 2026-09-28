import { describe, it, expect } from 'vitest';
import { McpToolError } from '../types';
import { getShip, searchShips } from '../tools/ships';
import { call, ctxOver, templateRow } from './fixtures';

const templates = [
    templateRow({ id: 't1', name: 'Atlas' }),
    templateRow({ id: 't2', name: 'Atlantis', type: 'DEFENDER', rarity: 'EPIC' }),
    templateRow({ id: 't3', name: 'Zeta', faction: 'BINDERBURG' }),
];

describe('search_ships', () => {
    it('matches part of the name in any case, sorted by name', async () => {
        const { ctx } = ctxOver({ ship_templates: templates });

        const result = await call(searchShips, { query: 'ATL' }, ctx);

        expect(result).toMatchObject({
            total: 2,
            ships: [{ name: 'Atlantis' }, { name: 'Atlas' }],
        });
    });

    it('filters by type, rarity and faction', async () => {
        const { ctx } = ctxOver({ ship_templates: templates });

        expect(await call(searchShips, { type: 'DEFENDER' }, ctx)).toMatchObject({
            total: 1,
            ships: [{ name: 'Atlantis' }],
        });
        expect(await call(searchShips, { rarity: 'epic' }, ctx)).toMatchObject({ total: 1 });
        expect(await call(searchShips, { faction: 'binder' }, ctx)).toMatchObject({
            ships: [{ name: 'Zeta' }],
        });
    });

    it('caps the list at limit and reports the full total', async () => {
        const { ctx } = ctxOver({ ship_templates: templates });

        const result = (await call(searchShips, { limit: 1 }, ctx)) as {
            total: number;
            ships: unknown[];
        };

        expect(result.total).toBe(3);
        expect(result.ships).toHaveLength(1);
    });

    it('rejects a limit above 50 and an unknown type', () => {
        expect(searchShips.input.safeParse({ limit: 51 }).success).toBe(false);
        expect(searchShips.input.safeParse({ type: 'PILOT' }).success).toBe(false);
    });

    it('throws the Supabase error for the registry to map', async () => {
        const { ctx } = ctxOver(
            {},
            { errors: { ship_templates: { message: 'boom', code: '500' } } }
        );

        await expect(call(searchShips, {}, ctx)).rejects.toEqual({ message: 'boom', code: '500' });
    });
});

describe('get_ship', () => {
    it('returns the template by name, any case, without the planner-internal hpRegen', async () => {
        const { ctx } = ctxOver({ ship_templates: templates });

        const ship = (await call(getShip, { name: 'atlas' }, ctx)) as {
            baseStats: Record<string, number>;
        };

        expect(ship).toMatchObject({
            name: 'Atlas',
            type: 'ATTACKER',
            rarity: 'legendary',
            faction: 'ATLAS_SYNDICATE',
            affinity: 'thermal',
            baseStats: { hp: 10000, attack: 3000, crit: 10, critDamage: 50 },
        });
        expect(ship.baseStats).not.toHaveProperty('hpRegen');
    });

    it('names search_ships when the ship does not exist', async () => {
        const { ctx } = ctxOver({ ship_templates: templates });

        await expect(call(getShip, { name: 'Nope' }, ctx)).rejects.toBeInstanceOf(McpToolError);
    });
});
