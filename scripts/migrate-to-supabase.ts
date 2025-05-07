import { adminDb } from '../src/config/firebase-admin';
import { supabase } from '../src/config/supabase-admin';

interface MigrationStats {
    users: number;
    ships: number;
    inventory: number;
    encounterNotes: number;
    loadouts: number;
    teamLoadouts: number;
    errors: number;
}

// Fetch mapping from Firebase UID to Supabase UUID
async function getUidMap() {
    // Use the admin client for Supabase
    const { data: users, error } = await supabase.auth.admin.listUsers();

    if (error) {
        console.error('Error fetching users:', error);
        throw error;
    }

    const uidMap: Record<string, string> = {};
    for (const user of users.users) {
        const fbUid = user.user_metadata?.fbuser?.uid;
        if (fbUid) {
            uidMap[fbUid] = user.id;
        }
    }
    return uidMap;
}

async function prepareMigration() {
    console.log('Preparing migration...');
    const { error: createError } = await supabase.rpc('create_id_mappings_table');
    if (createError) {
        console.error('Error creating ID mappings table:', createError);
        throw createError;
    }
    const { error: dropError } = await supabase.rpc('drop_foreign_key_constraints');
    if (dropError) {
        console.error('Error dropping foreign key constraints:', dropError);
        throw dropError;
    }
    const { error: textError } = await supabase.rpc('foreign_keys_uuid_to_text');
    if (textError) {
        console.error('Error converting UUID to text:', textError);
        throw textError;
    }
    const { error: addError } = await supabase.rpc('add_firebase_foreign_key_constraints');
    if (addError) {
        console.error('Error adding foreign key constraints:', addError);
        throw addError;
    }
}

async function migrateUserData(firebaseUid: string, supabaseUserId: string, stats: MigrationStats) {
    try {
        // Fetch user data from Firebase
        const userDoc = await adminDb.collection('users').doc(firebaseUid).get();
        const userData = userDoc.data();

        if (!userData) return;

        // Create user record first
        const { error: userError } = await supabase
            .from('users')
            .insert({
                id: supabaseUserId,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select()
            .single();

        if (userError && userError.code !== '23505') {
            // Ignore duplicate key error
            console.error('Error creating user record:', userError);
            stats.errors++;
            return;
        }

        // Migrate inventory items
        console.log('Migrating inventory items...');
        if (Array.isArray(userData['gear-inventory'])) {
            for (const item of userData['gear-inventory']) {
                try {
                    const { data: newItem, error: itemError } = await supabase
                        .from('inventory_items')
                        .insert({
                            user_id: supabaseUserId,
                            firebase_id: item.id,
                            slot: item.slot,
                            level: item.level,
                            stars: item.stars,
                            rarity: item.rarity,
                            set_bonus: item.setBonus,
                        })
                        .select()
                        .single();

                    if (itemError) throw itemError;

                    // Migrate gear main stat
                    if (item.mainStat) {
                        await supabase.from('gear_stats').insert({
                            gear_id: newItem.id,
                            name: item.mainStat.name,
                            value: item.mainStat.value,
                            type: item.mainStat.type,
                            is_main: true,
                        });
                    }

                    // Migrate gear stats
                    if (Array.isArray(item.subStats)) {
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
                    }

                    stats.inventory++;
                } catch (error) {
                    console.error(`Error migrating inventory item:`, error);
                    stats.errors++;
                }
            }
        }

        // Migrate ships
        console.log('Migrating ships...');
        if (Array.isArray(userData.ships)) {
            for (const ship of userData.ships) {
                try {
                    const { data: newShip, error } = await supabase
                        .from('ships')
                        .insert({
                            user_id: supabaseUserId,
                            name: ship.name,
                            rarity: ship.rarity,
                            faction: ship.faction,
                            type: ship.type,
                            affinity: ship.affinity,
                            equipment_locked: ship.equipmentLocked,
                            firebase_id: ship.id,
                        })
                        .select()
                        .single();

                    if (error) {
                        console.error('Error migrating ship:', error);
                        stats.errors++;
                        continue;
                    }

                    // Migrate ship base stats
                    if (ship.baseStats) {
                        const { error: baseStatsError } = await supabase
                            .from('ship_base_stats')
                            .insert({
                                ship_id: newShip.id,
                                hp: ship.baseStats.hp || 0,
                                attack: ship.baseStats.attack || 0,
                                defence: ship.baseStats.defence || 0,
                                hacking: ship.baseStats.hacking || 0,
                                security: ship.baseStats.security || 0,
                                crit: ship.baseStats.crit || 0,
                                crit_damage: ship.baseStats.critDamage || 0,
                                speed: ship.baseStats.speed || 0,
                                heal_modifier: ship.baseStats.healModifier || 0,
                                hp_regen: ship.baseStats.hpRegen || 0,
                                shield: ship.baseStats.shield || 0,
                            });

                        if (baseStatsError) {
                            console.error('Error migrating ship base stats:', {
                                error: baseStatsError,
                                shipId: newShip.id,
                                baseStats: ship.baseStats,
                            });
                            stats.errors++;
                        }
                    }

                    // Migrate ship refits
                    if (Array.isArray(ship.refits)) {
                        for (const refit of ship.refits) {
                            try {
                                const { data: newRefit, error: refitError } = await supabase
                                    .from('ship_refits')
                                    .insert({
                                        ship_id: newShip.id,
                                    })
                                    .select()
                                    .single();

                                if (refitError) throw refitError;

                                // Migrate refit stats
                                if (Array.isArray(refit.stats)) {
                                    const refitStats = refit.stats.map((stat) => ({
                                        refit_id: newRefit.id,
                                        name: stat.name,
                                        value: stat.value,
                                        type: stat.type,
                                    }));

                                    const { error: statsError } = await supabase
                                        .from('ship_refit_stats')
                                        .insert(refitStats);

                                    if (statsError) throw statsError;
                                }
                            } catch (error) {
                                console.error('Error migrating ship refit:', {
                                    error,
                                    shipId: newShip.id,
                                    refit,
                                });
                                stats.errors++;
                            }
                        }
                    }

                    // Migrate ship implants
                    if (Array.isArray(ship.implants)) {
                        for (const implant of ship.implants) {
                            try {
                                const { data: newImplant, error: implantError } = await supabase
                                    .from('ship_implants')
                                    .insert({
                                        ship_id: newShip.id,
                                        description: implant.description,
                                    })
                                    .select()
                                    .single();

                                if (implantError) throw implantError;

                                // Migrate implant stats
                                if (Array.isArray(implant.stats)) {
                                    const implantStats = implant.stats.map((stat) => ({
                                        implant_id: newImplant.id,
                                        name: stat.name,
                                        value: stat.value,
                                        type: stat.type,
                                    }));

                                    const { error: statsError } = await supabase
                                        .from('ship_implant_stats')
                                        .insert(implantStats);

                                    if (statsError) throw statsError;
                                }
                            } catch (error) {
                                console.error('Error migrating ship implant:', {
                                    error,
                                    shipId: newShip.id,
                                    implant,
                                });
                                stats.errors++;
                            }
                        }
                    }

                    // Migrate ship equipment
                    if (ship.equipment) {
                        for (const [slot, gearId] of Object.entries(ship.equipment)) {
                            // Convert gearId to string if it's a number
                            const gearIdStr =
                                typeof gearId === 'number' ? gearId.toString() : gearId;
                            const { error: equipmentError } = await supabase
                                .from('ship_equipment')
                                .insert({
                                    ship_id: newShip.id,
                                    slot: slot,
                                    gear_id: gearIdStr,
                                });

                            if (equipmentError) {
                                console.error('Error migrating ship equipment:', {
                                    error: equipmentError,
                                    shipId: newShip.id,
                                    slot: slot,
                                    gearId: gearIdStr,
                                });
                                stats.errors++;
                            }
                        }
                    }

                    stats.ships++;
                } catch (error) {
                    console.error('Error migrating ship:', error);
                    stats.errors++;
                }
            }
        }
        // Migrate encounter notes
        console.log('Migrating encounter notes...');
        if (Array.isArray(userData.encounterNotes)) {
            for (const note of userData.encounterNotes) {
                try {
                    const { data: newNote, error: noteError } = await supabase
                        .from('encounter_notes')
                        .insert({
                            user_id: supabaseUserId,
                            name: note.name,
                            description: note.description,
                            is_public: note.isPublic,
                        })
                        .select()
                        .single();

                    if (noteError) throw noteError;

                    // Migrate encounter formations
                    if (Array.isArray(note.formation)) {
                        for (const formation of note.formation) {
                            const { error: formationError } = await supabase
                                .from('encounter_formations')
                                .insert({
                                    note_id: newNote.id,
                                    ship_id: formation.shipId,
                                    position: formation.position,
                                });

                            if (formationError) throw formationError;
                        }
                    }

                    stats.encounterNotes++;
                } catch (error) {
                    console.error(`Error migrating encounter note:`, error);
                    stats.errors++;
                }
            }
        }

        // Migrate loadouts
        console.log('Migrating loadouts...');
        if (Array.isArray(userData.shipLoadouts)) {
            for (const loadout of userData.shipLoadouts) {
                try {
                    const { data: newLoadout, error: loadoutError } = await supabase
                        .from('loadouts')
                        .insert({
                            user_id: supabaseUserId,
                            name: loadout.name,
                            ship_id: loadout.shipId,
                        })
                        .select()
                        .single();

                    if (loadoutError) throw loadoutError;

                    // Migrate loadout equipment
                    if (loadout.equipment) {
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
                    }

                    stats.loadouts++;
                } catch (error) {
                    console.error(`Error migrating loadout:`, error);
                    stats.errors++;
                }
            }
        }

        // Migrate team loadouts
        console.log('Migrating team loadouts...');
        if (Array.isArray(userData.teamLoadouts)) {
            for (const teamLoadout of userData.teamLoadouts) {
                try {
                    const { data: newTeamLoadout, error: teamLoadoutError } = await supabase
                        .from('team_loadouts')
                        .insert({
                            user_id: supabaseUserId,
                            name: teamLoadout.name,
                        })
                        .select()
                        .single();

                    if (teamLoadoutError) throw teamLoadoutError;

                    // Migrate team loadout ships
                    if (Array.isArray(teamLoadout.shipLoadouts)) {
                        for (const ship of teamLoadout.shipLoadouts) {
                            const { error: shipError } = await supabase
                                .from('team_loadout_ships')
                                .insert({
                                    team_loadout_id: newTeamLoadout.id,
                                    position: ship.position,
                                    ship_id: ship.shipId,
                                });

                            if (shipError) throw shipError;

                            // Migrate team loadout equipment
                            if (ship.equipment) {
                                for (const [slot, gearId] of Object.entries(ship.equipment)) {
                                    const { error: equipmentError } = await supabase
                                        .from('team_loadout_equipment')
                                        .insert({
                                            team_loadout_id: newTeamLoadout.id,
                                            slot,
                                            ship_id: ship.shipId,
                                            gear_id: gearId,
                                        });

                                    if (equipmentError) throw equipmentError;
                                }
                            }
                        }
                    }

                    stats.teamLoadouts++;
                } catch (error) {
                    console.error(`Error migrating team loadout:`, error);
                    stats.errors++;
                }
            }
        }

        // Migrate engineering stats
        console.log('Migrating engineering stats...');
        if (userData.engineeringStats?.stats) {
            for (const stat of userData.engineeringStats.stats) {
                try {
                    if (Array.isArray(stat.stats)) {
                        for (const statDetail of stat.stats) {
                            const { error: statsError } = await supabase
                                .from('engineering_stats')
                                .insert({
                                    user_id: supabaseUserId,
                                    ship_type: stat.shipType,
                                    stat_name: statDetail.name,
                                    value: statDetail.value,
                                    type: statDetail.type,
                                });

                            if (statsError) throw statsError;
                        }
                    }
                } catch (error) {
                    console.error(`Error migrating engineering stats for ${stat.shipType}:`, error);
                    stats.errors++;
                }
            }
        }

        console.log(`Completed migration for user ${firebaseUid}`);
        stats.users++;
    } catch (error) {
        console.error(`Error migrating user ${firebaseUid}:`, error);
        stats.errors++;
    }
}

async function replaceFirebaseIds(supabaseUserId: string, stats: MigrationStats) {
    try {
        // Step 2: Populate mapping tables
        console.log('Populating ID mappings...');

        // Populate ship mappings
        const { error: shipMappingsError } = await supabase.rpc('populate_ship_mappings', {
            user_id: supabaseUserId,
        });
        if (shipMappingsError) {
            console.error('Error populating ship mappings:', shipMappingsError);
            stats.errors++;
            return;
        }

        // Populate inventory mappings
        const { error: inventoryMappingsError } = await supabase.rpc(
            'populate_inventory_mappings',
            {
                user_id: supabaseUserId,
            }
        );
        if (inventoryMappingsError) {
            console.error('Error populating inventory mappings:', inventoryMappingsError);
            stats.errors++;
            return;
        }
    } catch (error) {
        console.error(`Error updating foreign key references:`, error);
        stats.errors++;
    }
}

async function updateForeignKeys(stats: MigrationStats) {
    try {
        // Step 3: Update references using mapping table
        console.log('Updating foreign key references...');

        // Update ship_equipment references
        const { error: equipmentError } = await supabase.rpc('update_ship_equipment_references');
        if (equipmentError) {
            console.error('Error updating ship equipment references:', equipmentError);
            stats.errors++;
        }

        // Update encounter formations references
        const { error: formationsError } = await supabase.rpc(
            'update_encounter_formations_references'
        );
        if (formationsError) {
            console.error('Error updating encounter formations references:', formationsError);
            stats.errors++;
        }

        // Update loadouts references
        const { error: loadoutsError } = await supabase.rpc('update_loadouts_references');
        if (loadoutsError) {
            console.error('Error updating loadouts references:', loadoutsError);
            stats.errors++;
        }

        // Update loadouts equipment references
        const { error: loadoutEquipmentError } = await supabase.rpc(
            'update_loadout_equipment_references'
        );
        if (loadoutEquipmentError) {
            console.error('Error updating loadout equipment references:', loadoutEquipmentError);
            stats.errors++;
        }

        // Update team loadout ships references
        const { error: teamShipsError } = await supabase.rpc(
            'update_team_loadout_ships_references'
        );
        if (teamShipsError) {
            console.error('Error updating team loadout ships references:', teamShipsError);
            stats.errors++;
        }

        // Update team loadout equipment references
        const { error: teamEquipmentError } = await supabase.rpc(
            'update_team_loadout_equipment_references'
        );
        if (teamEquipmentError) {
            console.error('Error updating team loadout equipment references:', teamEquipmentError);
            stats.errors++;
        }

        // Step 4: Verify data integrity
        console.log('Verifying data integrity...');
        /*
        const { data: integrityCheck, error: integrityError } =
            await supabase.rpc('verify_data_integrity');
        if (integrityError) {
            console.error('Error verifying data integrity:', integrityError);
            stats.errors++;
        } else {
            console.log('Data integrity check results:', integrityCheck);
        }
*/
    } catch (error) {
        console.error(`Error updating foreign key references:`, error);
        stats.errors++;
    }
}

async function cleanupMigration(stats: MigrationStats) {
    try {
        await supabase.rpc('cleanup_mapping_table');
    } catch (error) {
        console.error(`Error cleaning up migration:`, error);
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
        // 1. Build the UID map
        const uidMap = await getUidMap();

        // 2. Pass the Supabase UUID to your migration function
        await prepareMigration();

        // 3. loop through all users and migrate them
        //for (const [firebaseUid, supabaseUserId] of Object.entries(uidMap)) {
        const firebaseUid = '9P9g2CnrsIT7ZB1qQpVJlWEWmwA3';
        const supabaseUserId = uidMap[firebaseUid];
        console.log(`Migrating user ${firebaseUid} to Supabase user ${supabaseUserId}`);
        await migrateUserData(firebaseUid, supabaseUserId, stats);
        await replaceFirebaseIds(supabaseUserId, stats);
        //}

        await updateForeignKeys(stats);
        await cleanupMigration(stats);

        console.log('Migration completed. Statistics:', stats);
    } catch (error) {
        console.error('Migration failed:', error);
    }
}

// Run migration
migrateAllUsers().catch(console.error);
