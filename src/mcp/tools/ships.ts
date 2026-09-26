import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { factionMatchesSearch } from '../../constants/factions';
import { RARITIES, type RarityName } from '../../constants/rarities';
import { SHIP_TYPE_NAMES, type ShipTypeName } from '../../constants/shipTypes';
import type { Ship } from '../../types/ship';
import { transformShipTemplate, type ShipTemplate } from '../../utils/ship/shipTemplate';
import { playerStats } from '../playerStats';
import { McpToolError, type McpTool } from '../types';

const RARITY_NAMES = Object.keys(RARITIES) as [RarityName, ...RarityName[]];
const TYPE_NAMES = SHIP_TYPE_NAMES as [ShipTypeName, ...ShipTypeName[]];

/** Every ship template, as the website's ship database builds them. */
async function fetchShipTemplates(db: SupabaseClient): Promise<Ship[]> {
    const { data, error } = await db.from('ship_templates').select('*');
    if (error) throw error;
    return (data as ShipTemplate[])
        .map(transformShipTemplate)
        .filter((ship): ship is Ship => ship !== null);
}

/** The one template named `name`, case-insensitively. */
export async function findShipTemplate(db: SupabaseClient, name: string): Promise<Ship> {
    const wanted = name.toLowerCase();
    const ship = (await fetchShipTemplates(db)).find((t) => t.name.toLowerCase() === wanted);
    if (!ship) {
        throw new McpToolError(`No ship named "${name}". Use search_ships to find the exact name.`);
    }
    return ship;
}

const shipSummary = (ship: Ship) => ({
    name: ship.name,
    type: ship.type,
    rarity: ship.rarity,
    faction: ship.faction,
    affinity: ship.affinity ?? null,
    baseStats: playerStats(ship.baseStats),
});

const searchShipsInput = z.object({
    query: z.string().trim().min(1).optional().describe('Part of the ship name, any case.'),
    type: z.enum(TYPE_NAMES).optional(),
    rarity: z.enum(RARITY_NAMES).optional(),
    faction: z.string().trim().min(1).optional().describe('Faction name or part of it.'),
    limit: z.number().int().min(1).max(50).default(20),
});

export const searchShips: McpTool<z.output<typeof searchShipsInput>> = {
    name: 'search_ships',
    description:
        'Search the Starborne Frontiers ship database by name, role, rarity and faction. Returns level-60 base stats; `total` counts every match before `limit`.',
    input: searchShipsInput,
    run: async ({ query, type, rarity, faction, limit }, { db }) => {
        const q = query?.toLowerCase();
        const matches = (await fetchShipTemplates(db))
            .filter((ship) => !q || ship.name.toLowerCase().includes(q))
            .filter((ship) => !type || ship.type === type)
            .filter((ship) => !rarity || ship.rarity === rarity)
            .filter((ship) => !faction || factionMatchesSearch(ship.faction, faction))
            .sort((a, b) => a.name.localeCompare(b.name));
        return { total: matches.length, ships: matches.slice(0, limit).map(shipSummary) };
    },
};

const getShipInput = z.object({
    name: z.string().trim().min(1).describe('The exact ship name, any case.'),
});

export const getShip: McpTool<z.output<typeof getShipInput>> = {
    name: 'get_ship',
    description:
        'One ship from the Starborne Frontiers ship database: role, rarity, faction, affinity and level-60 base stats.',
    input: getShipInput,
    run: async ({ name }, { db }) => shipSummary(await findShipTemplate(db, name)),
};
