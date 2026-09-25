import { z } from 'zod';
import { SHIP_TYPE_NAMES, type ShipTypeName } from '../../constants/shipTypes';
import {
    engineeringStatForShipType,
    fetchEngineeringStats,
    fetchInventory,
    fetchShips,
} from '../../services/fleetReads';
import { calculateTotalStats, clearGearStatsCache } from '../../utils/ship/statsCalculator';
import { playerStats } from '../playerStats';
import { McpToolError, type McpTool } from '../types';
import { fetchProfiles } from './profiles';

const TYPE_NAMES = SHIP_TYPE_NAMES as [ShipTypeName, ...ShipTypeName[]];

const getMyFleetInput = z.object({
    profile_id: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('A profile id from list_profiles. Defaults to your main account.'),
    name: z.string().trim().min(1).optional().describe('Part of the ship name, any case.'),
    type: z.enum(TYPE_NAMES).optional(),
    limit: z.number().int().min(1).max(100).default(50),
});

export const getMyFleet: McpTool<z.output<typeof getMyFleetInput>> = {
    name: 'get_my_fleet',
    description:
        'Your ships with their final stats — gear, implants, refits and engineering applied, as the planner shows them. `total` counts every match before `limit`.',
    input: getMyFleetInput,
    run: async ({ profile_id, name, type, limit }, ctx) => {
        const profileId = profile_id ?? ctx.authUserId;
        const profiles = await fetchProfiles(ctx);
        if (!profiles.some((profile) => profile.id === profileId)) {
            throw new McpToolError('not one of your profiles');
        }

        const [ships, inventory, engineering] = await Promise.all([
            fetchShips(ctx.db, profileId),
            fetchInventory(ctx.db, profileId),
            fetchEngineeringStats(ctx.db, profileId),
        ]);
        const gearById = new Map((inventory ?? []).map((piece) => [piece.id, piece]));
        const engineeringStats = engineering ?? { stats: [] };
        // `calculateTotalStats` caches gear stats by gear id in module scope; a warm function
        // instance serves many requests, so the cache must not outlive this one.
        clearGearStatsCache();

        const q = name?.toLowerCase();
        const matches = ships
            .filter((ship) => !q || ship.name.toLowerCase().includes(q))
            .filter((ship) => !type || ship.type === type)
            .sort((a, b) => a.name.localeCompare(b.name));

        return {
            total: matches.length,
            ships: matches.slice(0, limit).map((ship) => ({
                id: ship.id,
                name: ship.name,
                type: ship.type,
                rarity: ship.rarity,
                level: ship.level ?? null,
                refits: ship.refits.length,
                stats: playerStats(
                    calculateTotalStats(
                        ship.baseStats,
                        ship.equipment,
                        (id) => gearById.get(id),
                        ship.refits,
                        ship.implants,
                        engineeringStatForShipType(engineeringStats, ship.type),
                        ship.id
                    ).final
                ),
            })),
        };
    },
};
