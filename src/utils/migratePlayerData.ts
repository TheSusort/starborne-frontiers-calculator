import { v4 as uuidv4 } from 'uuid';
import { StorageKey } from '../constants/storage';
import { Ship } from '../types/ship';
import { GearPiece } from '../types/gear';
import { LocalEncounterNote } from '../types/encounters';
import { Loadout, TeamLoadout } from '../types/loadout';
import { EngineeringStats } from '../types/stats';

interface MigrationResult {
    ships: Ship[];
    inventory: GearPiece[];
    encounters: LocalEncounterNote[];
    loadouts: Loadout[];
    teamLoadouts: TeamLoadout[];
    engineeringStats: EngineeringStats;
}

/**
 * Checks if a string is a valid UUID
 */
const isUuid = (id: string): boolean => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
};

/**
 * Ensures a string is a valid UUID by either validating it or creating a replacement
 */
const ensureValidUuid = (id: string | undefined): string => {
    if (!id) return uuidv4();

    // Validate that it matches the UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id) ? id : uuidv4();
};

/**
 * Migrates all local data from string IDs to UUIDs while preserving relationships
 * This function is called when a user signs up for the first time
 */
export const migratePlayerData = (): MigrationResult => {
    // ID mapping from old ID to new UUID
    const shipIdMap = new Map<string, string>();
    const gearIdMap = new Map<string, string>();

    // Load data from localStorage
    const loadLocalData = <T>(key: string, isArray: boolean = true): T => {
        try {
            const data = localStorage.getItem(key);
            if (data) {
                return JSON.parse(data) as T;
            }
            // Return appropriate default type
            return (isArray ? [] : {}) as unknown as T;
        } catch (error) {
            console.error(`Error loading data from localStorage for ${key}:`, error);
            return (isArray ? [] : {}) as unknown as T;
        }
    };

    // Load all relevant data
    const ships = loadLocalData<Ship[]>(StorageKey.SHIPS);
    const inventory = loadLocalData<GearPiece[]>(StorageKey.INVENTORY);
    const encounters = loadLocalData<LocalEncounterNote[]>(StorageKey.ENCOUNTERS);
    const loadouts = loadLocalData<Loadout[]>(StorageKey.LOADOUTS);
    const teamLoadouts = loadLocalData<TeamLoadout[]>(StorageKey.TEAM_LOADOUTS);
    const engineeringStats = loadLocalData<EngineeringStats>(StorageKey.ENGINEERING_STATS, false);

    // Step 1: Create ID mappings for ships and gear
    // Migrate ships IDs and build mapping
    const migratedShips = ships.map((ship) => {
        // Only migrate non-UUID IDs
        if (!isUuid(ship.id)) {
            const newId = uuidv4();
            shipIdMap.set(ship.id, newId);
            return { ...ship, id: newId };
        }
        return ship;
    });

    // Migrate inventory IDs and build mapping
    const migratedInventory = inventory.map((item) => {
        // Only migrate non-UUID IDs
        if (!isUuid(item.id)) {
            const newId = uuidv4();
            gearIdMap.set(item.id, newId);
            return { ...item, id: newId };
        }
        return item;
    });

    // Step 2: Update equipment references in ships
    const updatedShips = migratedShips.map((ship) => {
        const updatedEquipment = { ...ship.equipment };

        // Replace gear IDs in equipment
        for (const slot of Object.keys(updatedEquipment)) {
            const gearId = updatedEquipment[slot];
            if (gearId && gearIdMap.has(gearId)) {
                updatedEquipment[slot] = gearIdMap.get(gearId) as string;
            }
        }

        const updatedRefits =
            ship.refits?.map((refit) => {
                return {
                    ...refit,
                    id: ensureValidUuid(refit.id),
                    stats: (refit.stats || []).map((stat) => ({
                        ...stat,
                        id: stat.id ? ensureValidUuid(stat.id) : uuidv4(),
                    })),
                };
            }) || [];

        const updatedImplants =
            ship.implants?.map((implant) => {
                return {
                    ...implant,
                    id: ensureValidUuid(implant.id),
                    stats: (implant.stats || []).map((stat) => ({
                        ...stat,
                        id: stat.id ? ensureValidUuid(stat.id) : uuidv4(),
                    })),
                };
            }) || [];

        return {
            ...ship,
            equipment: updatedEquipment,
            refits: updatedRefits,
            implants: updatedImplants,
        };
    });

    // Step 3: Update ship references in encounter notes
    const updatedEncounters = encounters.map((encounter) => {
        const updatedFormation = encounter.formation.map((position) => ({
            ...position,
            shipId: shipIdMap.has(position.shipId)
                ? (shipIdMap.get(position.shipId) as string)
                : position.shipId,
        }));

        return {
            ...encounter,
            formation: updatedFormation,
            id: isUuid(encounter.id) ? encounter.id : uuidv4(),
        };
    });

    // Step 4: Update loadouts
    const updatedLoadouts = loadouts.map((loadout) => {
        // Update shipId reference
        let updatedShipId = loadout.shipId;
        if (shipIdMap.has(loadout.shipId)) {
            updatedShipId = shipIdMap.get(loadout.shipId) as string;
        }

        // Update equipment references
        const updatedEquipment = { ...loadout.equipment };
        for (const slot of Object.keys(updatedEquipment)) {
            const gearId = updatedEquipment[slot];
            if (gearId && gearIdMap.has(gearId)) {
                updatedEquipment[slot] = gearIdMap.get(gearId) as string;
            }
        }

        return {
            ...loadout,
            id: isUuid(loadout.id) ? loadout.id : uuidv4(),
            shipId: updatedShipId,
            equipment: updatedEquipment,
        };
    });

    // Step 5: Update team loadouts
    const updatedTeamLoadouts = teamLoadouts.map((teamLoadout) => {
        const updatedShipLoadouts = teamLoadout.shipLoadouts.map((shipLoadout) => {
            // Update shipId reference
            let updatedShipId = shipLoadout.shipId;
            if (shipIdMap.has(shipLoadout.shipId)) {
                updatedShipId = shipIdMap.get(shipLoadout.shipId) as string;
            }

            // Update equipment references
            const updatedEquipment = { ...shipLoadout.equipment };
            for (const slot of Object.keys(updatedEquipment)) {
                const gearId = updatedEquipment[slot];
                if (gearId && gearIdMap.has(gearId)) {
                    updatedEquipment[slot] = gearIdMap.get(gearId) as string;
                }
            }

            return {
                ...shipLoadout,
                shipId: updatedShipId,
                equipment: updatedEquipment,
            };
        });

        return {
            ...teamLoadout,
            id: isUuid(teamLoadout.id) ? teamLoadout.id : uuidv4(),
            shipLoadouts: updatedShipLoadouts,
        };
    });

    // Step 6: Save all updated data back to localStorage
    localStorage.setItem(StorageKey.SHIPS, JSON.stringify(updatedShips));
    localStorage.setItem(StorageKey.INVENTORY, JSON.stringify(migratedInventory));
    localStorage.setItem(StorageKey.ENCOUNTERS, JSON.stringify(updatedEncounters));
    localStorage.setItem(StorageKey.LOADOUTS, JSON.stringify(updatedLoadouts));
    localStorage.setItem(StorageKey.TEAM_LOADOUTS, JSON.stringify(updatedTeamLoadouts));
    localStorage.setItem(StorageKey.ENGINEERING_STATS, JSON.stringify(engineeringStats));

    // Return the migrated data for further processing
    return {
        ships: updatedShips,
        inventory: migratedInventory,
        encounters: updatedEncounters,
        loadouts: updatedLoadouts,
        teamLoadouts: updatedTeamLoadouts,
        engineeringStats,
    };
};

/**
 * Creates Supabase records from migrated local data when a user signs up
 * Should be called after successful authentication for a new user
 * @param userId - The Supabase user ID
 * @param migrationResult - The result from migratePlayerData
 * @param isRetry - Whether this is a retry attempt
 */
export const syncMigratedDataToSupabase = async (
    userId: string,
    migrationResult: MigrationResult
) => {
    // Import supabase here to avoid circular dependencies
    const { supabase } = await import('../config/supabase');
    const { ships, inventory, encounters, loadouts, teamLoadouts, engineeringStats } =
        migrationResult;

    try {
        // First, ensure we have a user record
        const { data: existingUser } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (!existingUser) {
            // Get user details from auth to create the user record
            const { data: authUser } = await supabase.auth.getUser();

            // Create the user record
            const { error: userError } = await supabase.from('users').insert({
                id: userId,
                email: authUser.user?.email,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            });

            if (userError) {
                console.error('Error creating user record:', userError);
                throw userError;
            }
        }

        // Step 1: Upload inventory items
        if (inventory.length > 0) {
            // Filter invalid inventory items first
            const validInventory = inventory.filter((item) => !!item.id);

            if (validInventory.length > 0) {
                // Process inventory in batches to avoid timeouts
                const BATCH_SIZE = 500;
                for (let i = 0; i < validInventory.length; i += BATCH_SIZE) {
                    const batch = validInventory.slice(i, i + BATCH_SIZE);

                    // Prepare batch of inventory items
                    const inventoryItems = batch.map((item) => ({
                        id: item.id,
                        user_id: userId,
                        slot: item.slot,
                        level: item.level,
                        stars: item.stars,
                        rarity: item.rarity,
                        set_bonus: item.setBonus,
                    }));

                    // Upsert inventory items
                    const { error: inventoryError } = await supabase
                        .from('inventory_items')
                        .upsert(inventoryItems, { onConflict: 'id' });

                    if (inventoryError) throw inventoryError;

                    // Prepare batch for main stats and sub stats
                    const allGearStats = batch.flatMap((item) => {
                        const stats = [];

                        // Add main stat
                        if (item.mainStat) {
                            stats.push({
                                gear_id: item.id,
                                name: item.mainStat.name,
                                value: item.mainStat.value,
                                type: item.mainStat.type || 'flat',
                                is_main: true,
                            });
                        }

                        // Add sub stats
                        if (item.subStats && item.subStats.length > 0) {
                            stats.push(
                                ...item.subStats.map((stat) => ({
                                    gear_id: item.id,
                                    name: stat.name,
                                    value: stat.value,
                                    type: stat.type || 'flat',
                                    is_main: false,
                                }))
                            );
                        }

                        return stats;
                    });

                    // Delete existing stats for this batch of items
                    if (allGearStats.length > 0) {
                        const { error: deleteStatsError } = await supabase
                            .from('gear_stats')
                            .delete()
                            .in(
                                'gear_id',
                                batch.map((item) => item.id)
                            );

                        if (deleteStatsError) throw deleteStatsError;

                        // Insert new stats
                        const { error: gearStatsError } = await supabase
                            .from('gear_stats')
                            .insert(allGearStats);

                        if (gearStatsError) throw gearStatsError;
                    }
                }
            }
        }

        // Step 2: Upload ships
        if (ships.length > 0) {
            // Filter out invalid ships
            const validShips = ships.filter((ship) => !!ship.id);

            if (validShips.length > 0) {
                // First, get existing ships to preserve equipment_locked state
                const { data: existingShips } = await supabase
                    .from('ships')
                    .select('id, equipment_locked')
                    .eq('user_id', userId);

                const existingShipsMap = new Map(
                    existingShips?.map((ship) => [ship.id, ship.equipment_locked]) || []
                );

                // Prepare batch of ship records with preserved equipment_locked state
                const shipRecords = validShips.map((ship) => ({
                    id: ship.id,
                    user_id: userId,
                    name: ship.name,
                    rarity: ship.rarity,
                    faction: ship.faction,
                    type: ship.type,
                    affinity: ship.affinity,
                    equipment_locked: existingShipsMap.get(ship.id) ?? ship.equipmentLocked,
                    copies: ship.copies,
                    rank: ship.rank,
                    level: ship.level,
                }));

                // Upsert ships
                const { error: shipsError } = await supabase
                    .from('ships')
                    .upsert(shipRecords, { onConflict: 'id' });

                if (shipsError) throw shipsError;

                // Prepare batch of ship base stats
                const baseStatsRecords = validShips.map((ship) => ({
                    ship_id: ship.id,
                    hp: ship.baseStats.hp,
                    attack: ship.baseStats.attack,
                    defence: ship.baseStats.defence,
                    hacking: ship.baseStats.hacking,
                    security: ship.baseStats.security,
                    crit: ship.baseStats.crit,
                    crit_damage: ship.baseStats.critDamage,
                    speed: ship.baseStats.speed,
                    heal_modifier: ship.baseStats.healModifier,
                    hp_regen: ship.baseStats.hpRegen || 0,
                    shield: ship.baseStats.shield || 0,
                    defense_penetration: ship.baseStats.defensePenetration || 0,
                }));

                // Upsert base stats
                const { error: baseStatsError } = await supabase
                    .from('ship_base_stats')
                    .upsert(baseStatsRecords, { onConflict: 'ship_id' });

                if (baseStatsError) throw baseStatsError;

                // Delete existing refits and their stats before inserting new ones
                const shipIds = validShips.map((ship) => ship.id);
                // Delete in batches to avoid issues with large arrays
                const BATCH_SIZE = 100;
                for (let i = 0; i < shipIds.length; i += BATCH_SIZE) {
                    const batchIds = shipIds.slice(i, i + BATCH_SIZE);
                    const { error: deleteRefitsError } = await supabase
                        .from('ship_refits')
                        .delete()
                        .in('ship_id', batchIds);

                    if (deleteRefitsError) throw deleteRefitsError;
                }

                // Collect all refits with valid IDs
                const refitRecords = validShips.flatMap((ship) =>
                    (ship.refits || [])
                        .filter((refit) => !!refit.id)
                        .map((refit) => ({
                            id: refit.id,
                            ship_id: ship.id,
                        }))
                );

                // Insert refits in batches
                for (let i = 0; i < refitRecords.length; i += BATCH_SIZE) {
                    const batch = refitRecords.slice(i, i + BATCH_SIZE);
                    if (batch.length > 0) {
                        const { error: refitsError } = await supabase
                            .from('ship_refits')
                            .insert(batch);

                        if (refitsError) throw refitsError;
                    }
                }

                // Collect all refit stats
                const refitStatsRecords = validShips.flatMap((ship) =>
                    (ship.refits || [])
                        .filter((refit) => !!refit.id)
                        .flatMap((refit) =>
                            (refit.stats || []).map((stat) => ({
                                refit_id: refit.id,
                                name: stat.name,
                                value: stat.value,
                                type: stat.type,
                            }))
                        )
                );

                // Insert refit stats in batches
                for (let i = 0; i < refitStatsRecords.length; i += BATCH_SIZE) {
                    const batch = refitStatsRecords.slice(i, i + BATCH_SIZE);
                    if (batch.length > 0) {
                        const { error: refitStatsError } = await supabase
                            .from('ship_refit_stats')
                            .insert(batch);

                        if (refitStatsError) throw refitStatsError;
                    }
                }

                // Collect all implants with valid IDs
                const implantRecords = validShips.flatMap((ship) =>
                    (ship.implants || [])
                        .filter((implant) => !!implant.id)
                        .map((implant) => ({
                            id: implant.id,
                            ship_id: ship.id,
                        }))
                );

                // Collect all implant stats
                const implantStatsRecords = validShips.flatMap((ship) =>
                    (ship.implants || [])
                        .filter((implant) => !!implant.id)
                        .flatMap((implant) =>
                            (implant.stats || []).map((stat) => ({
                                implant_id: implant.id,
                                name: stat.name,
                                value: stat.value,
                                type: stat.type,
                            }))
                        )
                );

                // Equipment records - filter out undefined gear IDs
                const equipmentRecords = validShips.flatMap((ship) =>
                    Object.entries(ship.equipment || {})
                        .filter(([, gearId]) => !!gearId)
                        .map(([slot, gearId]) => ({
                            ship_id: ship.id,
                            slot,
                            gear_id: gearId as string,
                        }))
                );

                // Delete existing equipment in batches
                for (let i = 0; i < shipIds.length; i += BATCH_SIZE) {
                    const batchIds = shipIds.slice(i, i + BATCH_SIZE);
                    const { error: deleteEquipmentError } = await supabase
                        .from('ship_equipment')
                        .delete()
                        .in('ship_id', batchIds);

                    if (deleteEquipmentError) throw deleteEquipmentError;
                }

                // Insert equipment in batches
                for (let i = 0; i < equipmentRecords.length; i += BATCH_SIZE) {
                    const batch = equipmentRecords.slice(i, i + BATCH_SIZE);
                    if (batch.length > 0) {
                        const { error: equipmentError } = await supabase
                            .from('ship_equipment')
                            .insert(batch);

                        if (equipmentError) throw equipmentError;
                    }
                }
            }
        }

        // Step 3: Upload encounter notes
        if (encounters.length > 0) {
            // Filter valid encounters
            const validEncounters = encounters.filter((note) => !!note.id);

            if (validEncounters.length > 0) {
                try {
                    // Prepare encounter notes batch
                    const encounterRecords = validEncounters.map((note) => ({
                        id: note.id,
                        user_id: userId,
                        name: note.name,
                        description: note.description,
                        is_public: note.isPublic,
                    }));

                    // Batch insert encounter notes
                    const { error: notesError } = await supabase
                        .from('encounter_notes')
                        .insert(encounterRecords);

                    if (notesError) {
                        console.error('Error inserting encounter notes:', notesError);
                        throw notesError;
                    }

                    // Wait a short delay to ensure notes are inserted properly
                    await new Promise((resolve) => setTimeout(resolve, 500));

                    // First, verify which ship IDs actually exist in the database
                    const { data: existingShips } = await supabase
                        .from('ships')
                        .select('id')
                        .eq('user_id', userId);

                    // Create a set of valid ship IDs for fast lookup
                    const validShipIds = new Set(existingShips?.map((ship) => ship.id) || []);

                    // Prepare formations batch, filtering out invalid shipIds
                    const formationRecords = validEncounters.flatMap((note) =>
                        (note.formation || [])
                            .filter((pos) => !!pos.shipId && validShipIds.has(pos.shipId))
                            .map((pos) => ({
                                note_id: note.id,
                                position: pos.position,
                                ship_id: pos.shipId,
                            }))
                    );

                    // Batch insert formations
                    if (formationRecords.length > 0) {
                        // Insert formations one by one to handle potential errors more gracefully
                        for (const formation of formationRecords) {
                            try {
                                const { error: formationError } = await supabase
                                    .from('encounter_formations')
                                    .insert(formation);

                                if (formationError) {
                                    console.error(
                                        'Error inserting individual encounter formation:',
                                        formationError,
                                        formation
                                    );
                                    // Continue with the next formation instead of failing completely
                                }
                            } catch (formationError) {
                                console.error(
                                    'Exception inserting individual encounter formation:',
                                    formationError
                                );
                                // Continue with the next formation
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error migrating encounters:', error);
                    // Continue with other migrations instead of halting completely
                }
            }
        }

        // Step 4: Upload loadouts
        if (loadouts.length > 0) {
            // Filter valid loadouts
            const validLoadouts = loadouts.filter((loadout) => !!loadout.id && !!loadout.shipId);

            if (validLoadouts.length > 0) {
                try {
                    // Prepare loadouts batch
                    const loadoutRecords = validLoadouts.map((loadout) => ({
                        id: loadout.id,
                        user_id: userId,
                        name: loadout.name,
                        ship_id: loadout.shipId,
                        created_at: new Date(loadout.createdAt).toISOString(),
                    }));

                    // Batch insert loadouts
                    const { error: loadoutsError } = await supabase
                        .from('loadouts')
                        .insert(loadoutRecords);

                    if (loadoutsError) {
                        console.error('Error inserting loadouts:', loadoutsError);
                        throw loadoutsError;
                    }

                    // Wait a short delay to ensure loadouts are inserted properly
                    await new Promise((resolve) => setTimeout(resolve, 500));

                    // Prepare loadout equipment batch
                    const loadoutEquipmentRecords = validLoadouts.flatMap((loadout) =>
                        Object.entries(loadout.equipment || {})
                            .filter(([, gearId]) => !!gearId)
                            .map(([slot, gearId]) => ({
                                loadout_id: loadout.id,
                                slot,
                                gear_id: gearId as string,
                            }))
                    );

                    // Batch insert loadout equipment
                    if (loadoutEquipmentRecords.length > 0) {
                        // Insert in smaller batches to prevent errors
                        const batchSize = 50;
                        for (let i = 0; i < loadoutEquipmentRecords.length; i += batchSize) {
                            const batch = loadoutEquipmentRecords.slice(i, i + batchSize);
                            const { error: loadoutEquipmentError } = await supabase
                                .from('loadout_equipment')
                                .insert(batch);

                            if (loadoutEquipmentError) {
                                console.error(
                                    'Error inserting loadout equipment batch:',
                                    loadoutEquipmentError,
                                    batch
                                );
                                throw loadoutEquipmentError;
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error migrating loadouts:', error);
                    // Continue with other migrations instead of halting completely
                }
            }
        }

        // Step 5: Upload team loadouts
        if (teamLoadouts.length > 0) {
            // Filter valid team loadouts
            const validTeamLoadouts = teamLoadouts.filter((loadout) => !!loadout.id);

            if (validTeamLoadouts.length > 0) {
                try {
                    // Prepare team loadouts batch
                    const teamLoadoutRecords = validTeamLoadouts.map((teamLoadout) => ({
                        id: teamLoadout.id,
                        user_id: userId,
                        name: teamLoadout.name,
                        created_at: new Date(teamLoadout.createdAt).toISOString(),
                    }));

                    // Batch insert team loadouts
                    const { error: teamLoadoutsError } = await supabase
                        .from('team_loadouts')
                        .insert(teamLoadoutRecords);

                    if (teamLoadoutsError) {
                        console.error('Error inserting team loadouts:', teamLoadoutsError);
                        throw teamLoadoutsError;
                    }

                    // Wait a short delay to ensure team loadouts are inserted properly
                    await new Promise((resolve) => setTimeout(resolve, 500));

                    // Prepare team loadout ships batch - filter valid shipIds
                    const teamShipRecords = validTeamLoadouts.flatMap((teamLoadout) =>
                        (teamLoadout.shipLoadouts || [])
                            .filter((ship) => !!ship.shipId)
                            .map((ship, index) => ({
                                team_loadout_id: teamLoadout.id,
                                position: index,
                                ship_id: ship.shipId,
                            }))
                    );

                    // Batch insert team loadout ships
                    if (teamShipRecords.length > 0) {
                        // Insert in smaller batches to prevent errors
                        const batchSize = 50;
                        for (let i = 0; i < teamShipRecords.length; i += batchSize) {
                            const batch = teamShipRecords.slice(i, i + batchSize);
                            const { error: teamShipsError } = await supabase
                                .from('team_loadout_ships')
                                .insert(batch);

                            if (teamShipsError) {
                                console.error(
                                    'Error inserting team loadout ships batch:',
                                    teamShipsError,
                                    batch
                                );
                                throw teamShipsError;
                            }
                        }
                    }

                    // Wait another short delay
                    await new Promise((resolve) => setTimeout(resolve, 500));

                    // Prepare team loadout equipment batch - filter valid shipIds and gearIds
                    const teamEquipmentRecords = validTeamLoadouts.flatMap((teamLoadout) =>
                        (teamLoadout.shipLoadouts || [])
                            .filter((ship) => !!ship.shipId)
                            .flatMap((ship) =>
                                Object.entries(ship.equipment || {})
                                    .filter(([, gearId]) => !!gearId)
                                    .map(([slot, gearId]) => ({
                                        team_loadout_id: teamLoadout.id,
                                        ship_id: ship.shipId,
                                        slot,
                                        gear_id: gearId as string,
                                    }))
                            )
                    );

                    // Batch insert team loadout equipment
                    if (teamEquipmentRecords.length > 0) {
                        // Insert in smaller batches to prevent errors
                        const batchSize = 50;
                        for (let i = 0; i < teamEquipmentRecords.length; i += batchSize) {
                            const batch = teamEquipmentRecords.slice(i, i + batchSize);
                            const { error: teamEquipmentError } = await supabase
                                .from('team_loadout_equipment')
                                .insert(batch);

                            if (teamEquipmentError) {
                                console.error(
                                    'Error inserting team loadout equipment batch:',
                                    teamEquipmentError,
                                    batch
                                );
                                throw teamEquipmentError;
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error migrating team loadouts:', error);
                    // Continue with other migrations instead of halting completely
                }
            }
        }

        // Step 6: Upload engineering stats
        if (engineeringStats?.stats && engineeringStats.stats.length > 0) {
            try {
                // Format and validate engineering stats more carefully
                const statsRecords = engineeringStats.stats
                    .filter((stat) => stat && stat.shipType && Array.isArray(stat.stats))
                    .flatMap((stat) =>
                        (stat.stats || [])
                            .filter((s) => s && s.name && s.value !== undefined)
                            .map((s) => ({
                                user_id: userId,
                                ship_type: stat.shipType,
                                stat_name: s.name,
                                value: typeof s.value === 'number' ? s.value : parseFloat(s.value),
                                type: s.type || 'flat',
                            }))
                    )
                    .filter(
                        (record) => record.ship_type && record.stat_name && !isNaN(record.value)
                    );

                // delete all engineering stats for the user
                const { error: deleteError } = await supabase
                    .from('engineering_stats')
                    .delete()
                    .eq('user_id', userId);

                if (deleteError) throw deleteError;

                if (statsRecords.length > 0) {
                    // Insert in smaller batches to prevent errors
                    const batchSize = 50;
                    for (let i = 0; i < statsRecords.length; i += batchSize) {
                        const batch = statsRecords.slice(i, i + batchSize);
                        const { error: statsError } = await supabase
                            .from('engineering_stats')
                            .insert(batch);

                        if (statsError) {
                            console.error(
                                'Error inserting engineering stats batch:',
                                statsError,
                                batch
                            );
                            throw statsError;
                        }
                    }
                }
            } catch (error) {
                console.error('Error migrating engineering stats:', error);
                // Continue instead of halting completely
            }
        }

        return { success: true };
    } catch (error) {
        console.error('Error syncing migrated data to Supabase:', error);
        return { success: false, error };
    }
};
