import { supabase } from '../config/supabase';
import type { GearSlotName } from '../constants/gearTypes';
import type { ShipTypeName } from '../constants/shipTypes';
import type { RarityName } from '../constants/rarities';
import type { GearSetName } from '../constants/gearSets';
import type { FactionName } from '../constants/factions';
import type { AffinityName } from '../types/ship';
import type { Ship } from '../types/ship';
import type {
    Stat,
    StatName,
    StatType,
    FlexibleStats,
    PercentageStat,
    FlatStat,
} from '../types/stats';
import type { GearPiece as ActualGearPiece } from '../types/gear';

export interface UserProfile {
    id: string;
    username: string | null;
    is_public: boolean;
    in_game_id: string | null;
    email: string | null;
    created_at: string;
    updated_at: string;
}

export interface UserStats {
    shipCount: number;
    gearCount: number;
    implantCount: number;
    engineeringPoints: number;
    engineeringTokens: number;
}

export interface TopShipRanking {
    shipName: string;
    shipType: string;
    rank: number;
    totalEntries: number;
    score: number;
}

export interface UserUsageStats {
    total_autogear_runs: number;
    total_data_imports: number;
    total_activity: number;
}

/**
 * Get user profile data
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await supabase
        .from('users')
        .select('id, username, is_public, in_game_id, email, created_at, updated_at')
        .eq('id', userId)
        .single();

    if (error) {
        console.error('Error fetching user profile:', error);
        throw error;
    }

    return data;
}

/**
 * Update user profile
 */
export async function updateUserProfile(
    userId: string,
    updates: Partial<Pick<UserProfile, 'username' | 'is_public' | 'in_game_id'>>
): Promise<UserProfile> {
    const { data, error } = await supabase
        .from('users')
        .update({
            ...updates,
            updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select('id, username, is_public, in_game_id, email, created_at, updated_at')
        .single();

    if (error) {
        console.error('Error updating user profile:', error);
        throw error;
    }

    return data;
}

/**
 * Check if username is available
 */
export async function checkUsernameAvailability(username: string): Promise<boolean> {
    // Validate format first
    const usernameRegex = /^[a-zA-Z0-9]{3,20}$/;
    if (!usernameRegex.test(username)) {
        return false;
    }

    const { data, error } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .maybeSingle();

    if (error) {
        console.error('Error checking username availability:', error);
        throw error;
    }

    // Username is available if no user found
    return !data;
}

/**
 * Get user statistics (ships, gear, etc.)
 */
export async function getUserStats(userId: string): Promise<UserStats> {
    // Get ship count
    const { count: shipCount, error: shipsError } = await supabase
        .from('ships')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

    if (shipsError) {
        console.error('Error fetching ship count:', shipsError);
        throw shipsError;
    }

    // Get gear count (excluding implants)
    // Implants are identified by slots starting with 'implant_'
    const { count: gearCount, error: gearError } = await supabase
        .from('inventory_items')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .not('slot', 'ilike', 'implant_%');

    if (gearError) {
        console.error('Error fetching gear count:', gearError);
        throw gearError;
    }

    // Get implant count
    // Implants have slots that start with 'implant_'
    const { count: implantCount, error: implantError } = await supabase
        .from('inventory_items')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .ilike('slot', 'implant_%');

    if (implantError) {
        console.error('Error fetching implant count:', implantError);
        throw implantError;
    }

    // Get engineering stats
    const { data: engineeringData, error: engineeringError } = await supabase
        .from('engineering_stats')
        .select('type, value')
        .eq('user_id', userId);

    if (engineeringError) {
        console.error('Error fetching engineering stats:', engineeringError);
        throw engineeringError;
    }

    // Calculate engineering points and tokens
    let engineeringPoints = 0;
    let engineeringTokens = 0;

    // Token cost lookup (same as in create-engineering-leaderboard-rpc.sql)
    const tokenCosts = [
        0, 100, 250, 450, 700, 1050, 1500, 2100, 3000, 4200, 5900, 8400, 11600, 16000, 22000, 30200,
        42200, 57200, 77200, 107200, 147200,
    ];

    engineeringData?.forEach((stat) => {
        const level = stat.type === 'flat' ? stat.value / 2 : stat.value;
        const points = stat.type === 'flat' ? stat.value / 2.0 : stat.value;
        engineeringPoints += points;

        const levelInt = Math.floor(level);
        if (levelInt >= 0 && levelInt <= 20) {
            engineeringTokens += tokenCosts[levelInt];
        }
    });

    return {
        shipCount: shipCount || 0,
        gearCount: gearCount || 0,
        implantCount: implantCount || 0,
        engineeringPoints: Math.round(engineeringPoints * 100) / 100,
        engineeringTokens,
    };
}

/**
 * Get user usage statistics (autogear runs, data imports, total activity)
 */
export async function getUserUsageStats(userId: string): Promise<UserUsageStats> {
    const { data, error } = await supabase
        .from('users')
        .select('autogear_run_count, data_import_count')
        .eq('id', userId)
        .single();

    if (error) {
        console.error('Error fetching user usage stats:', error);
        throw error;
    }

    const autogearRuns = data?.autogear_run_count || 0;
    const dataImports = data?.data_import_count || 0;
    const totalActivity = autogearRuns + dataImports;

    return {
        total_autogear_runs: autogearRuns,
        total_data_imports: dataImports,
        total_activity: totalActivity,
    };
}

/**
 * Get top 10 ships where user ranks highest
 * Returns ships with their rank and total entries in that ship's leaderboard
 *
 * Uses the same scoring logic as LeaderboardPage for accurate rankings.
 * Calculates scores based on gear, implants, refits, and engineering stats.
 */
export async function getTopShipRankings(userId: string): Promise<TopShipRanking[]> {
    // Always use the accurate scoring method (same as LeaderboardPage)
    return await getTopShipRankingsWithScoring(userId);
}

/**
 * Uses the same scoring logic as LeaderboardPage
 * Fetches all ship data, calculates scores, and ranks them properly
 * This provides accurate rankings based on the full scoring system
 */
async function getTopShipRankingsWithScoring(userId: string): Promise<TopShipRanking[]> {
    // Import calculateTotalScore
    const { calculateTotalScore } = await import('../utils/autogear/scoring');

    // Get user's engineering stats for scoring
    const { data: engineeringData, error: engError } = await supabase
        .from('engineering_stats')
        .select('ship_type, stat_name, value, type')
        .eq('user_id', userId);

    if (engError) {
        console.error('Error fetching engineering stats:', engError);
    }

    // Transform engineering stats to match the format expected by calculateTotalScore
    const engineeringStatsMap = new Map<ShipTypeName, { shipType: ShipTypeName; stats: Stat[] }>();
    engineeringData?.forEach((stat) => {
        const shipType = stat.ship_type as ShipTypeName;
        if (!engineeringStatsMap.has(shipType)) {
            engineeringStatsMap.set(shipType, { shipType, stats: [] });
        }
        engineeringStatsMap.get(shipType)!.stats.push({
            name: stat.stat_name,
            value: stat.value,
            type: stat.type,
        });
    });

    const getEngineeringStatsForShipType = (shipType: ShipTypeName) => {
        return engineeringStatsMap.get(shipType);
    };

    // Get user's ships with full data
    const { data: userShipsData, error: userShipsError } = await supabase
        .from('ships')
        .select(
            `
            *,
            ship_base_stats (*),
            ship_equipment (*, inventory_items (*) ),
            ship_refits (
                *,
                ship_refit_stats (*)
            ),
            ship_implants (*, inventory_items (*) )
        `
        )
        .eq('user_id', userId);

    if (userShipsError) {
        console.error('Error fetching user ships:', userShipsError);
        throw userShipsError;
    }

    if (!userShipsData || userShipsData.length === 0) {
        return [];
    }

    // Get unique ship names
    const uniqueShipNames = Array.from(new Set(userShipsData.map((s: { name: string }) => s.name)));

    if (uniqueShipNames.length === 0) {
        return [];
    }

    const rankings: TopShipRanking[] = [];

    // Process each unique ship name
    for (const shipName of uniqueShipNames) {
        // Fetch ALL ships with this name (with full data)
        const { data: allShipsData, error: allShipsError } = await supabase
            .from('ships')
            .select(
                `
                *,
                ship_base_stats (*),
                ship_equipment (*, inventory_items (*) ),
                ship_refits (
                    *,
                    ship_refit_stats (*)
                ),
                ship_implants (*, inventory_items (*) )
            `
            )
            .eq('name', shipName);

        if (allShipsError) {
            console.error(`Error fetching ships for ${shipName}:`, allShipsError);
            continue;
        }

        if (!allShipsData || allShipsData.length === 0) {
            continue;
        }

        // Transform ships (same logic as LeaderboardPage)
        interface RawStat {
            name: string;
            value: number;
            type: string;
            id: string;
            is_main?: boolean;
        }

        const createStat = (stat: RawStat): Stat => {
            const statType: StatType = stat.type === 'percentage' ? 'percentage' : 'flat';
            if (statType === 'percentage') {
                return {
                    name: stat.name as StatName,
                    value: stat.value,
                    type: 'percentage',
                    id: stat.id,
                } as PercentageStat;
            } else {
                return {
                    name: stat.name as FlexibleStats,
                    value: stat.value,
                    type: 'flat',
                    id: stat.id,
                } as FlatStat;
            }
        };

        interface RawStatsJsonb {
            mainStat: RawStat | null;
            subStats: RawStat[];
        }

        interface RawShipData {
            id: string;
            name: string;
            rarity: string;
            faction: string;
            type: string;
            affinity: string;
            rank: number;
            level: number;
            user_id: string;
            ship_base_stats?: {
                hp: number;
                attack: number;
                defence: number;
                hacking: number;
                security: number;
                crit: number;
                crit_damage: number;
                speed: number;
                heal_modifier: number;
                hp_regen: number;
                shield: number;
                defense_penetration: number;
            };
            ship_equipment?: Array<{
                slot: string;
                gear_id: string;
                inventory_items?: {
                    id: string;
                    slot: string;
                    level: number;
                    stars: number;
                    rarity: string;
                    set_bonus: string;
                    stats?: RawStatsJsonb | null;
                };
            }>;
            ship_refits?: Array<{
                id: string;
                ship_refit_stats?: RawStat[];
            }>;
            ship_implants?: Array<{
                slot: string;
                description?: string;
                inventory_items?: {
                    id: string;
                    level: number;
                    stars: number;
                    rarity: string;
                    set_bonus: string;
                    stats?: RawStatsJsonb | null;
                };
            }>;
        }

        // Internal gear piece type for maps (matches LeaderboardPage structure)
        interface InternalGearPiece {
            id: string;
            slot: string;
            level: number;
            stars: number;
            rarity: string;
            setBonus: string;
            mainStat?: {
                name: string;
                value: number;
                type: 'percentage' | 'flat';
                id: string;
            };
            subStats: Stat[];
        }

        // Internal implant piece type for maps
        interface InternalImplantPiece {
            id: string;
            slot: string;
            description?: string;
            level: number;
            stars: number;
            rarity: string;
            setBonus: string;
            mainStat?: {
                name: string;
                value: number;
                type: 'percentage' | 'flat';
                id: string;
            };
            subStats: Stat[];
        }

        const transformedShips: (Ship & {
            _gearMap?: Map<string, InternalGearPiece>;
            _implantMap?: Map<string, InternalImplantPiece>;
            userId?: string;
        })[] = allShipsData.map((data: RawShipData) => {
            const shipGearMap = new Map<string, InternalGearPiece>();
            data.ship_equipment?.forEach((eq) => {
                if (eq.inventory_items) {
                    const statsData = eq.inventory_items.stats || {
                        mainStat: null,
                        subStats: [],
                    };

                    const gearPiece = {
                        id: eq.inventory_items.id,
                        slot: eq.inventory_items.slot,
                        level: eq.inventory_items.level,
                        stars: eq.inventory_items.stars,
                        rarity: eq.inventory_items.rarity,
                        setBonus: eq.inventory_items.set_bonus,
                        mainStat: statsData.mainStat
                            ? {
                                  name: statsData.mainStat.name,
                                  value: statsData.mainStat.value,
                                  type: (statsData.mainStat.type === 'percentage'
                                      ? 'percentage'
                                      : 'flat') as 'flat' | 'percentage',
                                  id: statsData.mainStat.id || '',
                              }
                            : undefined,
                        subStats: (statsData.subStats || []).map(createStat),
                    };
                    shipGearMap.set(eq.gear_id, gearPiece);
                }
            });

            const shipImplantMap = new Map<string, InternalImplantPiece>();
            data.ship_implants?.forEach((implant) => {
                if (implant.inventory_items) {
                    const statsData = implant.inventory_items.stats || {
                        mainStat: null,
                        subStats: [],
                    };

                    const implantPiece = {
                        id: implant.inventory_items.id,
                        slot: implant.slot,
                        description: implant.description,
                        level: implant.inventory_items.level,
                        stars: implant.inventory_items.stars,
                        rarity: implant.inventory_items.rarity,
                        setBonus: implant.inventory_items.set_bonus,
                        mainStat: statsData.mainStat
                            ? {
                                  name: statsData.mainStat.name,
                                  value: statsData.mainStat.value,
                                  type: (statsData.mainStat.type === 'percentage'
                                      ? 'percentage'
                                      : 'flat') as 'flat' | 'percentage',
                                  id: statsData.mainStat.id || '',
                              }
                            : undefined,
                        subStats: (statsData.subStats || []).map(createStat),
                    };
                    shipImplantMap.set(implant.slot, implantPiece);
                }
            });

            return {
                id: data.id,
                name: data.name,
                rarity: data.rarity as RarityName,
                faction: data.faction as FactionName,
                type: data.type as ShipTypeName,
                affinity: data.affinity as AffinityName,
                rank: data.rank,
                level: data.level,
                baseStats: {
                    hp: data.ship_base_stats?.hp || 0,
                    attack: data.ship_base_stats?.attack || 0,
                    defence: data.ship_base_stats?.defence || 0,
                    hacking: data.ship_base_stats?.hacking || 0,
                    security: data.ship_base_stats?.security || 0,
                    crit: data.ship_base_stats?.crit || 0,
                    critDamage: data.ship_base_stats?.crit_damage || 0,
                    speed: data.ship_base_stats?.speed || 0,
                    healModifier: data.ship_base_stats?.heal_modifier || 0,
                    hpRegen: data.ship_base_stats?.hp_regen || 0,
                    shield: data.ship_base_stats?.shield || 0,
                    defensePenetration: data.ship_base_stats?.defense_penetration || 0,
                },
                equipment:
                    data.ship_equipment?.reduce(
                        (acc: Record<GearSlotName, string>, eq) => {
                            acc[eq.slot as GearSlotName] = eq.gear_id;
                            return acc;
                        },
                        {} as Record<GearSlotName, string>
                    ) || {},
                refits:
                    data.ship_refits?.map((refit) => ({
                        id: refit.id,
                        stats: refit.ship_refit_stats?.map(createStat) || [],
                    })) || [],
                implants:
                    data.ship_implants?.reduce((acc: Partial<Record<string, string>>, implant) => {
                        if (implant.inventory_items) {
                            const statsData = implant.inventory_items.stats;
                            if (
                                statsData &&
                                (statsData.mainStat || (statsData.subStats?.length ?? 0) > 0)
                            ) {
                                // Store implant ID as string (matches Ship type)
                                acc[implant.slot] = implant.inventory_items.id;
                            }
                        }
                        return acc;
                    }, {}) || {},
                _gearMap: shipGearMap,
                _implantMap: shipImplantMap,
                userId: data.user_id,
            };
        });

        // Calculate scores for all ships
        const entries = transformedShips.map((ship) => {
            const customGetGearPiece = (gearId: string): ActualGearPiece | undefined => {
                if (ship._gearMap && ship._gearMap.has(gearId)) {
                    const internalGear = ship._gearMap.get(gearId);
                    if (!internalGear) return undefined;
                    // Convert internal gear piece to actual GearPiece type
                    return {
                        id: internalGear.id,
                        slot: internalGear.slot as GearSlotName,
                        level: internalGear.level,
                        stars: internalGear.stars,
                        rarity: internalGear.rarity as RarityName,
                        setBonus: internalGear.setBonus as GearSetName | null,
                        mainStat: internalGear.mainStat
                            ? internalGear.mainStat.type === 'percentage'
                                ? ({
                                      name: internalGear.mainStat.name as StatName,
                                      value: internalGear.mainStat.value,
                                      type: 'percentage' as const,
                                      id: internalGear.mainStat.id,
                                  } as PercentageStat)
                                : ({
                                      name: internalGear.mainStat.name as FlexibleStats,
                                      value: internalGear.mainStat.value,
                                      type: 'flat' as const,
                                      id: internalGear.mainStat.id,
                                  } as FlatStat)
                            : null,
                        subStats: internalGear.subStats,
                    };
                }
                return undefined;
            };

            const score = calculateTotalScore(
                ship,
                ship.equipment,
                [],
                customGetGearPiece,
                getEngineeringStatsForShipType,
                ship.type as ShipTypeName
            );

            return {
                ship,
                score,
                userId: ship.userId || '',
            };
        });

        // Sort by score (highest first) and assign ranks
        interface EntryWithRank {
            ship: Ship & {
                _gearMap?: Map<string, InternalGearPiece>;
                _implantMap?: Map<string, InternalImplantPiece>;
                userId?: string;
            };
            score: number;
            userId: string;
            rank: number;
        }

        const entriesWithRank: EntryWithRank[] = entries.map((entry, index) => ({
            ...entry,
            rank: index + 1,
        }));

        entriesWithRank.sort((a, b) => b.score - a.score);
        entriesWithRank.forEach((entry, index) => {
            entry.rank = index + 1;
        });

        // Find user's best rank for this ship name
        const userEntries = entriesWithRank.filter((entry) => entry.userId === userId);
        if (userEntries.length === 0) continue;

        // Get the best rank (lowest rank number = highest position)
        const bestRank = Math.min(...userEntries.map((e) => e.rank));
        const bestEntry = userEntries.find((e) => e.rank === bestRank);

        if (bestEntry) {
            rankings.push({
                shipName,
                shipType: bestEntry.ship.type || 'unknown',
                rank: bestRank,
                totalEntries: entriesWithRank.length,
                score: bestEntry.score,
            });
        }
    }

    // Sort by rank (best rank first) and take top 10
    rankings.sort((a, b) => a.rank - b.rank);
    return rankings.slice(0, 10);
}
