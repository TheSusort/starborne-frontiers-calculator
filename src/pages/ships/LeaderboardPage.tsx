/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthProvider';
import { PageLayout } from '../../components/ui';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { supabase } from '../../config/supabase';
import { Ship } from '../../types/ship';
import { calculateTotalScore } from '../../utils/autogear/scoring';
import { GEAR_SLOT_ORDER, GearSlotName } from '../../constants/gearTypes';
import { ShipTypeName, SHIP_TYPES } from '../../constants/shipTypes';
import { TrophyIcon } from '../../components/ui/icons';
import Seo from '../../components/seo/Seo';
import { Select } from '../../components/ui/Select';
import { GEAR_SETS } from '../../constants/gearSets';

interface LeaderboardEntry {
    ship: Ship & { _gearMap?: Map<string, any>; _implantMap?: Map<string, any> };
    score: number;
    rank: number;
    isCurrentUser: boolean;
    userId: string;
}

export const LeaderboardPage: React.FC = () => {
    const { shipName } = useParams<{ shipName: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();

    const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedRole, setSelectedRole] = useState<ShipTypeName | null>(null);

    // Create a custom getGearPiece function that uses the fetched data
    const createCustomGetGearPiece = (
        ship: Ship & { _gearMap?: Map<string, any>; _implantMap?: Map<string, any> }
    ) => {
        return (gearId: string) => {
            // First try to get from the ship's gear map
            if (ship._gearMap && ship._gearMap.has(gearId)) {
                const gear = ship._gearMap.get(gearId);
                return gear;
            }
        };
    };

    useEffect(() => {
        const fetchLeaderboardData = async () => {
            if (!shipName) return;

            try {
                setLoading(true);
                setError(null);

                // Fetch all ships with the same name across all users
                const { data: shipsData, error: fetchError } = await supabase
                    .from('ships')
                    .select(
                        `
                        *,
                        ship_base_stats (*),
                        ship_equipment (*, inventory_items (*, gear_stats (*)) ),
                        ship_refits (
                            *,
                            ship_refit_stats (*)
                        ),
                        ship_implants (*, inventory_items (*, gear_stats (*)) )
                    `
                    )
                    .ilike('name', `%${decodeURIComponent(shipName)}%`);

                if (fetchError) throw fetchError;

                if (!shipsData || shipsData.length === 0) {
                    setError('No ships found with this name');
                    setLoading(false);
                    return;
                }

                // Transform the data to Ship format
                const transformedShips: Ship[] = shipsData.map((data: any) => {
                    const createStat = (stat: any) => ({
                        name: stat.name,
                        value: stat.value,
                        type: stat.type === 'percentage' ? 'percentage' : 'flat',
                        id: stat.id,
                    });

                    // Create a map of gear pieces for this ship
                    const shipGearMap = new Map<string, any>();
                    data.ship_equipment.forEach((eq: any) => {
                        if (eq.inventory_items) {
                            // Handle gear stats more robustly
                            const gearStats = eq.inventory_items.gear_stats || [];
                            const mainStat = gearStats.find((stat: any) => stat.is_main);
                            const subStats = gearStats.filter((stat: any) => !stat.is_main);

                            const gearPiece = {
                                id: eq.inventory_items.id,
                                slot: eq.inventory_items.slot,
                                level: eq.inventory_items.level,
                                stars: eq.inventory_items.stars,
                                rarity: eq.inventory_items.rarity,
                                setBonus: eq.inventory_items.set_bonus,
                                mainStat: mainStat
                                    ? {
                                          name: mainStat.name,
                                          value: mainStat.value,
                                          type:
                                              mainStat.type === 'percentage'
                                                  ? 'percentage'
                                                  : 'flat',
                                          id: mainStat.id,
                                      }
                                    : undefined,
                                subStats: subStats.map(createStat),
                            };
                            shipGearMap.set(eq.gear_id, gearPiece);
                        }
                    });

                    // Create a map of implant pieces for this ship
                    const shipImplantMap = new Map<string, any>();
                    data.ship_implants.forEach((implant: any) => {
                        if (implant.inventory_items) {
                            // Handle implant stats more robustly (similar to gear)
                            const implantStats = implant.inventory_items.gear_stats || [];
                            const mainStat = implantStats.find((stat: any) => stat.is_main);
                            const subStats = implantStats.filter((stat: any) => !stat.is_main);

                            const implantPiece = {
                                id: implant.inventory_items.id,
                                slot: implant.slot,
                                description: implant.description,
                                level: implant.inventory_items.level,
                                stars: implant.inventory_items.stars,
                                rarity: implant.inventory_items.rarity,
                                setBonus: implant.inventory_items.set_bonus,
                                mainStat: mainStat
                                    ? {
                                          name: mainStat.name,
                                          value: mainStat.value,
                                          type:
                                              mainStat.type === 'percentage'
                                                  ? 'percentage'
                                                  : 'flat',
                                          id: mainStat.id,
                                      }
                                    : undefined,
                                subStats: subStats.map(createStat),
                            };
                            shipImplantMap.set(implant.slot, implantPiece);
                        }
                    });

                    return {
                        id: data.id,
                        name: data.name,
                        rarity: data.rarity,
                        faction: data.faction,
                        type: data.type,
                        affinity: data.affinity,
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
                        equipment: data.ship_equipment.reduce(
                            (acc: Record<GearSlotName, string>, eq: any) => {
                                acc[eq.slot] = eq.gear_id;
                                return acc;
                            },
                            {} as Record<GearSlotName, string>
                        ),
                        refits: data.ship_refits.map((refit: any) => ({
                            id: refit.id,
                            stats: refit.ship_refit_stats.map(createStat),
                        })),
                        implants: data.ship_implants.reduce(
                            (acc: Record<string, any>, implant: any) => {
                                if (implant.inventory_items) {
                                    const implantStats = implant.inventory_items.gear_stats || [];
                                    if (implantStats.length > 0) {
                                        acc[implant.slot] = {
                                            id: implant.inventory_items.id,
                                            description: implant.description,
                                            level: implant.inventory_items.level,
                                            stars: implant.inventory_items.stars,
                                            rarity: implant.inventory_items.rarity,
                                            setBonus: implant.inventory_items.set_bonus,
                                            stats: implantStats.map(createStat),
                                        };
                                    }
                                }
                                return acc;
                            },
                            {}
                        ),
                        // Store the gear and implant maps for scoring
                        _gearMap: shipGearMap,
                        _implantMap: shipImplantMap,
                    };
                });

                // Calculate scores for each ship
                const entries: LeaderboardEntry[] = transformedShips.map((ship, index) => {
                    const customGetGearPiece = createCustomGetGearPiece(ship);

                    const score = calculateTotalScore(
                        ship,
                        ship.equipment,
                        [],
                        customGetGearPiece,
                        () => ({ shipType: ship.type as ShipTypeName, stats: [] }),
                        selectedRole || ship.type // Use the selected role or the ship's actual type
                    );

                    return {
                        ship,
                        score,
                        rank: 0, // Will be set after sorting
                        isCurrentUser: user?.id === shipsData[index].user_id, // Use the user_id from the original data
                        userId: shipsData[index].user_id, // Store the user_id from the original data
                    };
                });

                // Sort by score (highest first) and assign ranks
                entries.sort((a, b) => b.score - a.score);
                entries.forEach((entry, index) => {
                    entry.rank = index + 1;
                });

                setLeaderboardData(entries);
            } catch (err) {
                console.error('Error fetching leaderboard data:', err);
                setError(err instanceof Error ? err.message : 'Failed to fetch leaderboard data');
            } finally {
                setLoading(false);
            }
        };

        fetchLeaderboardData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shipName, user?.id]);

    // Recalculate scores when selected role changes
    useEffect(() => {
        if (leaderboardData.length > 0) {
            recalculateScores();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedRole]);

    const recalculateScores = () => {
        if (!leaderboardData.length) return;

        // Use setTimeout to allow the UI to update before heavy calculation
        setTimeout(() => {
            const updatedEntries = leaderboardData.map((entry) => {
                const customGetGearPiece = createCustomGetGearPiece(entry.ship);

                const score = calculateTotalScore(
                    entry.ship,
                    entry.ship.equipment,
                    [],
                    customGetGearPiece,
                    () => ({ shipType: entry.ship.type as ShipTypeName, stats: [] }),
                    selectedRole || entry.ship.type
                );

                return {
                    ...entry,
                    score,
                };
            });

            // Sort by new scores and reassign ranks
            updatedEntries.sort((a, b) => b.score - a.score);
            updatedEntries.forEach((entry, index) => {
                entry.rank = index + 1;
            });

            setLeaderboardData(updatedEntries);
        }, 100);
    };

    const handleBackClick = () => {
        navigate('/ships/index');
    };

    if (loading) {
        return <Loader />;
    }

    if (error) {
        return (
            <PageLayout title="Leaderboard Error" description="Error loading leaderboard">
                <div className="text-center text-red-500">
                    <p>{error}</p>
                    <Button onClick={handleBackClick} className="mt-4">
                        Back to Ship Database
                    </Button>
                </div>
            </PageLayout>
        );
    }

    const decodedShipName = shipName ? decodeURIComponent(shipName) : '';

    // Get the top score for relative comparison
    const topScore = leaderboardData.length > 0 ? leaderboardData[0].score : 0;

    return (
        <>
            <Seo
                title={`${decodedShipName} Leaderboard`}
                description={`Compare ${decodedShipName} ships across all users. Ships are scored using their intended roles by default, or select a specific role to see different rankings.`}
            />
            <PageLayout
                title={`${decodedShipName} Leaderboard`}
                description={`Compare ${decodedShipName} ships across all users. Ships are scored using their intended roles by default, or change the role above to see how ships rank differently.`}
            >
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center flex-col md:flex-row gap-2">
                            <Button onClick={handleBackClick} variant="secondary">
                                Back to Ship Database
                            </Button>

                            <div className="flex md:items-center md:space-x-2 flex-col md:flex-row">
                                <label
                                    htmlFor="role-selector"
                                    className="text-sm font-medium text-gray-300"
                                >
                                    Score as:
                                </label>
                                <Select
                                    options={[
                                        {
                                            value: '',
                                            label:
                                                leaderboardData.length > 0
                                                    ? `Default (${SHIP_TYPES[leaderboardData[0].ship.type]?.name || 'Ship Role'})`
                                                    : "Default (Ship's Role)",
                                        },
                                        ...Object.entries(SHIP_TYPES).map(([key, type]) => ({
                                            value: key,
                                            label: `${type.name}`,
                                        })),
                                    ]}
                                    value={selectedRole || ''}
                                    onChange={(value) =>
                                        setSelectedRole(
                                            value === '' ? null : (value as ShipTypeName)
                                        )
                                    }
                                    className="min-w-48"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="bg-dark-lighter p-6">
                        <div className="space-y-4">
                            {leaderboardData.map((entry) => (
                                <div
                                    key={entry.ship.id}
                                    className={`flex items-center justify-between p-4 border-2 gap-4 relative ${
                                        entry.isCurrentUser
                                            ? 'border-primary bg-primary/10'
                                            : 'border-dark-border bg-dark'
                                    }`}
                                >
                                    <div className="flex items-center space-x-4">
                                        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gray-700 text-white font-bold text-lg">
                                            {entry.rank === 1 && (
                                                <TrophyIcon className="w-6 h-6 text-yellow-400" />
                                            )}
                                            {entry.rank === 2 && (
                                                <TrophyIcon className="w-6 h-6 text-gray-300" />
                                            )}
                                            {entry.rank === 3 && (
                                                <TrophyIcon className="w-6 h-6 text-amber-600" />
                                            )}
                                            {entry.rank > 3 && entry.rank}
                                        </div>
                                        <div>
                                            <div className="flex items-center space-x-2">
                                                <h3 className="text-lg font-semibold text-white">
                                                    {entry.ship.name}
                                                </h3>
                                            </div>

                                            <div className="flex items-center gap-1">
                                                {Array.from({ length: 6 }, (_, index) => (
                                                    <span
                                                        key={index}
                                                        className={`text-xs tracking-tightest ${index < entry.ship.refits?.length ? 'text-yellow-400' : entry.ship.rank && index < entry.ship.rank ? 'text-gray-300' : 'text-gray-500'}`}
                                                    >
                                                        ★
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Set Bonus Icons */}
                                    <div className="grid grid-cols-3 gap-1 mt-1 me-auto">
                                        {GEAR_SLOT_ORDER.map((slot) => {
                                            const gearId = entry.ship.equipment[slot];
                                            const gear = entry.ship._gearMap?.get(gearId as string);
                                            if (
                                                !gear ||
                                                !gear.setBonus ||
                                                !GEAR_SETS[gear.setBonus]
                                            )
                                                return (
                                                    <div
                                                        key={`${slot}-empty`}
                                                        className="w-6 bg-dark-lighter"
                                                    />
                                                );
                                            const gearSet = GEAR_SETS[gear.setBonus];
                                            return (
                                                <img
                                                    key={`${gearSet.name}-${slot}`}
                                                    src={gearSet.iconUrl}
                                                    alt={gearSet.name}
                                                    className="w-6"
                                                    title={`${gearSet.name} Set`}
                                                />
                                            );
                                        })}
                                    </div>
                                    <div className="flex flex-col items-end gap-2 min-w-48">
                                        <div className="text-right">
                                            <div className="text-md lg:text-2xl font-bold text-white">
                                                {topScore > 0
                                                    ? `${((entry.score / topScore) * 100).toFixed(1)}%`
                                                    : '0%'}
                                            </div>
                                            <div className="text-sm text-gray-400">
                                                {entry.rank === 1 ? 'Top Score' : 'vs Top'}
                                            </div>
                                        </div>
                                        <div className="w-full bg-gray-700 h-2 relative overflow-hidden">
                                            <div
                                                className={`h-full transition-all duration-300 ${
                                                    entry.rank === 1
                                                        ? 'bg-yellow-400'
                                                        : entry.rank === 2
                                                          ? 'bg-gray-300'
                                                          : entry.rank === 3
                                                            ? 'bg-amber-600'
                                                            : 'bg-primary'
                                                }`}
                                                style={{
                                                    width: `${topScore > 0 ? (entry.score / topScore) * 100 : 0}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default LeaderboardPage;
/* eslint-enable @typescript-eslint/no-explicit-any */
