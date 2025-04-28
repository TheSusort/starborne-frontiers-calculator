import { adminDb } from '../src/config/firebase-admin';
import { supabase } from '../src/config/supabase';

interface MigrationStats {
    users: number;
    ships: number;
    inventory: number;
    encounterNotes: number;
    loadouts: number;
    teamLoadouts: number;
    errors: number;
}

async function migrateUserData(userId: string, stats: MigrationStats) {
    try {
        // Fetch user data from Firebase
        const userDoc = await adminDb.collection('users').doc(userId).get();
        const userData = userDoc.data();

        if (!userData) return;

        // Migrate ships
        for (const ship of userData.ships) {
            const { data: newShip, error } = await supabase
                .from('ships')
                .insert({
                    user_id: userId,
                    name: ship.name,
                    rarity: ship.rarity,
                    faction: ship.faction,
                    type: ship.type,
                    affinity: ship.affinity,
                    equipment_locked: ship.equipmentLocked,
                })
                .select()
                .single();

            if (error) {
                console.error('Error migrating ship:', error);
                stats.errors++;
                continue;
            }

            // Migrate ship base stats
            await supabase.from('ship_base_stats').insert({
                ship_id: newShip.id,
                ...ship.baseStats,
            });

            // Migrate ship equipment
            for (const [slot, gearId] of Object.entries(ship.equipment)) {
                await supabase.from('ship_equipment').insert({
                    ship_id: newShip.id,
                    slot,
                    gear_id: gearId,
                });
            }

            stats.ships++;
        }

        // Migrate inventory items
        for (const item of userData.inventory) {
            try {
                const { data: newItem, error: itemError } = await supabase
                    .from('inventory_items')
                    .insert({
                        user_id: userId,
                        slot: item.slot,
                        level: item.level,
                        stars: item.stars,
                        rarity: item.rarity,
                        set_bonus: item.setBonus,
                        ship_id: item.shipId,
                    })
                    .select()
                    .single();

                if (itemError) throw itemError;

                // Migrate gear main stat
                await supabase.from('gear_stats').insert({
                    gear_id: newItem.id,
                    name: item.mainStat.name,
                    value: item.mainStat.value,
                    type: item.mainStat.type,
                    is_main: true,
                });
                // Migrate gear stats
                for (const stat of item.subStats) {
                    const { error: statsError } = await supabase.from('gear_stats').insert({
                        gear_id: newItem.id,
                        name: stat.name,
                        value: stat.value,
                        type: stat.type,
                        is_main: false,
                    });

                    if (statsError) throw statsError;
                }

                stats.inventory++;
            } catch (error) {
                console.error(`Error migrating inventory item ${item.id}:`, error);
                stats.errors++;
            }
        }

        // Migrate encounter notes
        for (const note of userData.encounterNotes) {
            try {
                const { data: newNote, error: noteError } = await supabase
                    .from('encounter_notes')
                    .insert({
                        user_id: userId,
                        name: note.name,
                        description: note.description,
                        is_public: note.isPublic,
                    })
                    .select()
                    .single();

                if (noteError) throw noteError;

                // Migrate encounter formations
                for (const formation of note.formations) {
                    const { error: formationError } = await supabase
                        .from('encounter_formations')
                        .insert({
                            note_id: newNote.id,
                            ship_id: formation.shipId,
                            position: formation.position,
                        });

                    if (formationError) throw formationError;
                }

                stats.encounterNotes++;
            } catch (error) {
                console.error(`Error migrating encounter note ${note.id}:`, error);
                stats.errors++;
            }
        }

        // Migrate loadouts
        for (const loadout of userData.loadouts) {
            try {
                const { data: newLoadout, error: loadoutError } = await supabase
                    .from('loadouts')
                    .insert({
                        user_id: userId,
                        name: loadout.name,
                        ship_id: loadout.shipId,
                    })
                    .select()
                    .single();

                if (loadoutError) throw loadoutError;

                // Migrate loadout equipment
                for (const [slot, gearId] of Object.entries(loadout.equipment)) {
                    const { error: equipmentError } = await supabase
                        .from('loadout_equipment')
                        .insert({
                            loadout_id: newLoadout.id,
                            slot,
                            gear_id: gearId,
                        });

                    if (equipmentError) throw equipmentError;
                }

                stats.loadouts++;
            } catch (error) {
                console.error(`Error migrating loadout ${loadout.id}:`, error);
                stats.errors++;
            }
        }

        // Migrate team loadouts
        for (const teamLoadout of userData.teamLoadouts) {
            try {
                const { data: newTeamLoadout, error: teamLoadoutError } = await supabase
                    .from('team_loadouts')
                    .insert({
                        user_id: userId,
                        name: teamLoadout.name,
                    })
                    .select()
                    .single();

                if (teamLoadoutError) throw teamLoadoutError;

                // Migrate team loadout ships
                for (const ship of teamLoadout.ships) {
                    const { error: shipError } = await supabase.from('team_loadout_ships').insert({
                        team_loadout_id: newTeamLoadout.id,
                        position: ship.position,
                        ship_id: ship.shipId,
                    });

                    if (shipError) throw shipError;
                }

                // Migrate team loadout equipment
                for (const equipment of teamLoadout.equipment) {
                    const { error: equipmentError } = await supabase
                        .from('team_loadout_equipment')
                        .insert({
                            team_loadout_id: newTeamLoadout.id,
                            position: equipment.position,
                            slot: equipment.slot,
                            gear_id: equipment.gearId,
                        });

                    if (equipmentError) throw equipmentError;
                }

                stats.teamLoadouts++;
            } catch (error) {
                console.error(`Error migrating team loadout ${teamLoadout.id}:`, error);
                stats.errors++;
            }
        }

        // Migrate engineering stats
        if (userData.engineeringStats?.stats) {
            for (const stat of userData.engineeringStats.stats) {
                try {
                    for (const statDetail of stat.stats) {
                        const { error: statsError } = await supabase
                            .from('engineering_stats')
                            .insert({
                                user_id: userId,
                                ship_type: stat.shipType,
                                stat_name: statDetail.name,
                                value: statDetail.value,
                                type: statDetail.type,
                            });

                        if (statsError) throw statsError;
                    }
                } catch (error) {
                    console.error(`Error migrating engineering stats for ${stat.shipType}:`, error);
                    stats.errors++;
                }
            }
        }

        console.log(`Completed migration for user ${userId}`);
    } catch (error) {
        console.error(`Error migrating user ${userId}:`, error);
        stats.errors++;
    }
}

// Main migration function
async function migrateAllUsers() {
    const stats: MigrationStats = {
        users: 0,
        ships: 0,
        inventory: 0,
        encounterNotes: 0,
        loadouts: 0,
        teamLoadouts: 0,
        errors: 0,
    };

    try {
        const usersSnapshot = await adminDb.collection('users').get();

        for (const doc of usersSnapshot.docs) {
            await migrateUserData(doc.id, stats);
            stats.users++;
        }

        console.log('Migration completed. Statistics:', stats);
    } catch (error) {
        console.error('Migration failed:', error);
    }
}

// Run migration
migrateAllUsers().catch(console.error);
