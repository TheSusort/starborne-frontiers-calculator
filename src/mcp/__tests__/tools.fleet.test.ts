import { describe, it, expect } from 'vitest';
import { encodeGearStats } from '../../utils/gear/statsCodec';
import { getMyFleet } from '../tools/fleet';
import { McpToolError } from '../types';
import { ALT_PROFILE, AUTH_USER, STRANGER, call, ctxOver } from './fixtures';

const users = [
    { id: AUTH_USER, username: 'main', in_game_id: '1', owner_auth_user_id: null },
    { id: ALT_PROFILE, username: 'alt', in_game_id: '2', owner_auth_user_id: AUTH_USER },
];

const shipRow = (id: string, name: string, userId: string, overrides = {}) => ({
    id,
    name,
    user_id: userId,
    rarity: 'legendary',
    faction: 'ATLAS_SYNDICATE',
    type: 'SUPPORTER_BUFFER',
    affinity: 'thermal',
    level: 60,
    rank: 6,
    ship_base_stats: { hp: 1000, attack: 100, crit: 10, crit_damage: 50, hp_regen: 5 },
    ship_equipment: [{ slot: 'weapon', gear_id: 'gear-1' }],
    ship_implants: [],
    ship_refits: [{ id: 'r1', ship_refit_stats: [] }],
    ship_templates: { image_key: '', active_skill_text: 'x' },
    ...overrides,
});

const tables = () => ({
    users,
    ships: [
        shipRow('s1', 'Zeta', AUTH_USER),
        shipRow('s2', 'Alpha', AUTH_USER),
        shipRow('s3', 'Altfleet', ALT_PROFILE),
    ],
    inventory_items: [
        {
            id: 'gear-1',
            user_id: AUTH_USER,
            slot: 'weapon',
            level: 16,
            stars: 6,
            rarity: 'legendary',
            set_bonus: null,
            calibration_ship_id: null,
            stats: encodeGearStats({
                mainStat: { name: 'attack', value: 50, type: 'flat' },
                subStats: [],
            }),
        },
    ],
    engineering_stats: [
        {
            user_id: AUTH_USER,
            ship_type: 'SUPPORTER',
            stat_name: 'hp',
            value: 10,
            type: 'percentage',
        },
    ],
});

interface FleetResult {
    total: number;
    ships: { id: string; name: string; refits: number; stats: Record<string, number> }[];
}

describe('get_my_fleet', () => {
    it("defaults to the main account's ships, sorted by name", async () => {
        const { ctx } = ctxOver(tables());

        const result = (await call(getMyFleet, {}, ctx)) as FleetResult;

        expect(result.total).toBe(2);
        expect(result.ships.map((ship) => ship.name)).toEqual(['Alpha', 'Zeta']);
    });

    it('returns final stats: gear, refits and the SUPPORTER engineering tree applied', async () => {
        const { ctx } = ctxOver(tables());

        const [ship] = ((await call(getMyFleet, { name: 'alpha' }, ctx)) as FleetResult).ships;

        expect(ship).toMatchObject({ id: 's2', refits: 1 });
        // 1000 hp +10% engineering; 100 attack +50 flat from the weapon.
        expect(ship.stats).toMatchObject({ hp: 1100, attack: 150, crit: 10, critDamage: 50 });
        expect(ship.stats).not.toHaveProperty('hpRegen');
    });

    it('reads an alt profile when asked', async () => {
        const { ctx } = ctxOver(tables());

        const result = (await call(getMyFleet, { profile_id: ALT_PROFILE }, ctx)) as FleetResult;

        expect(result.ships.map((ship) => ship.name)).toEqual(['Altfleet']);
    });

    it('refuses a profile that is not one of yours', async () => {
        const { ctx } = ctxOver(tables());

        await expect(call(getMyFleet, { profile_id: STRANGER }, ctx)).rejects.toEqual(
            new McpToolError('not one of your profiles')
        );
    });

    it('caps at limit and keeps the full total', async () => {
        const { ctx } = ctxOver(tables());

        const result = (await call(getMyFleet, { limit: 1 }, ctx)) as FleetResult;

        expect(result.total).toBe(2);
        expect(result.ships).toHaveLength(1);
    });

    it('rejects a limit above 100', () => {
        expect(getMyFleet.input.safeParse({ limit: 101 }).success).toBe(false);
    });
});
