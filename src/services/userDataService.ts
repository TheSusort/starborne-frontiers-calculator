import { supabase } from '../config/supabase';
import { StorageKey } from '../constants/storage';
import { getFromIndexedDB } from '../hooks/useStorage';
import { Ship } from '../types/ship';
import { GearPiece } from '../types/gear';
import { LocalEncounterNote } from '../types/encounters';
import { Loadout, TeamLoadout } from '../types/loadout';
import { EngineeringStats } from '../types/stats';
import { SavedAutogearConfig } from '../types/autogear';

const BATCH_SIZE = 500;
const CHILD_BATCH_SIZE = 50;

/**
 * Deletes all Supabase data for a given user.
 * Tables are removed in child-before-parent order to avoid FK violations
 * (no CASCADE constraints exist in the schema).
 */
export async function deleteUserSupabaseData(userId: string): Promise<void> {
    // Delete in child-before-parent order. Tables without user_id use subqueries.
    const steps: Array<() => Promise<void>> = [
        // team_loadout_equipment / team_loadout_ships → team_loadouts → user_id
        async () => {
            const { data: tl, error: selError } = await supabase
                .from('team_loadouts')
                .select('id')
                .eq('user_id', userId);
            if (selError) throw selError;
            if (!tl?.length) return;
            const ids = tl.map((r) => r.id);
            const { error: eqError } = await supabase
                .from('team_loadout_equipment')
                .delete()
                .in('team_loadout_id', ids);
            if (eqError) throw eqError;
            const { error: shError } = await supabase
                .from('team_loadout_ships')
                .delete()
                .in('team_loadout_id', ids);
            if (shError) throw shError;
        },
        async () => {
            const { error } = await supabase.from('team_loadouts').delete().eq('user_id', userId);
            if (error) throw error;
        },
        // loadout_equipment → loadouts → user_id
        async () => {
            const { data: lo, error: selError } = await supabase
                .from('loadouts')
                .select('id')
                .eq('user_id', userId);
            if (selError) throw selError;
            if (!lo?.length) return;
            const { error } = await supabase
                .from('loadout_equipment')
                .delete()
                .in(
                    'loadout_id',
                    lo.map((r) => r.id)
                );
            if (error) throw error;
        },
        async () => {
            const { error } = await supabase.from('loadouts').delete().eq('user_id', userId);
            if (error) throw error;
        },
        // encounter_votes (FK child of encounter_notes) → encounter_formations → encounter_notes
        async () => {
            const { data: en, error: selError } = await supabase
                .from('encounter_notes')
                .select('id')
                .eq('user_id', userId);
            if (selError) throw selError;
            if (!en?.length) return;
            const { error } = await supabase
                .from('encounter_votes')
                .delete()
                .in(
                    'encounter_id',
                    en.map((r) => r.id)
                );
            if (error) throw error;
        },
        // encounter_formations → encounter_notes → user_id
        async () => {
            const { data: en, error: selError } = await supabase
                .from('encounter_notes')
                .select('id')
                .eq('user_id', userId);
            if (selError) throw selError;
            if (!en?.length) return;
            const { error } = await supabase
                .from('encounter_formations')
                .delete()
                .in(
                    'note_id',
                    en.map((r) => r.id)
                );
            if (error) throw error;
        },
        // ship child tables — scope via ships → user_id
        async () => {
            const { data: sh, error: selShError } = await supabase
                .from('ships')
                .select('id')
                .eq('user_id', userId);
            if (selShError) throw selShError;
            if (!sh?.length) return;
            const shipIds = sh.map((r) => r.id);
            const { error: seqError } = await supabase
                .from('ship_equipment')
                .delete()
                .in('ship_id', shipIds);
            if (seqError) throw seqError;
            const { data: imp, error: selImpError } = await supabase
                .from('ship_implants')
                .select('id')
                .in('ship_id', shipIds);
            if (selImpError) throw selImpError;
            if (imp?.length) {
                const { error: impStatsError } = await supabase
                    .from('ship_implant_stats')
                    .delete()
                    .in(
                        'implant_id',
                        imp.map((r) => r.id)
                    );
                if (impStatsError) throw impStatsError;
            }
            const { error: impError } = await supabase
                .from('ship_implants')
                .delete()
                .in('ship_id', shipIds);
            if (impError) throw impError;
            const { data: ref, error: selRefError } = await supabase
                .from('ship_refits')
                .select('id')
                .in('ship_id', shipIds);
            if (selRefError) throw selRefError;
            if (ref?.length) {
                const { error: refStatsError } = await supabase
                    .from('ship_refit_stats')
                    .delete()
                    .in(
                        'refit_id',
                        ref.map((r) => r.id)
                    );
                if (refStatsError) throw refStatsError;
            }
            const { error: refError } = await supabase
                .from('ship_refits')
                .delete()
                .in('ship_id', shipIds);
            if (refError) throw refError;
            const { error: bsError } = await supabase
                .from('ship_base_stats')
                .delete()
                .in('ship_id', shipIds);
            if (bsError) throw bsError;
        },
        async () => {
            const { error } = await supabase.from('encounter_notes').delete().eq('user_id', userId);
            if (error) throw error;
        },
        // inventory_items must go before ships (calibration_ship_id FK)
        async () => {
            const { error } = await supabase.from('inventory_items').delete().eq('user_id', userId);
            if (error) throw error;
        },
        async () => {
            const { error } = await supabase.from('ships').delete().eq('user_id', userId);
            if (error) throw error;
        },
        async () => {
            const { error } = await supabase
                .from('engineering_stats')
                .delete()
                .eq('user_id', userId);
            if (error) throw error;
        },
        async () => {
            const { error } = await supabase
                .from('autogear_configs')
                .delete()
                .eq('user_id', userId);
            if (error) throw error;
        },
    ];

    for (const step of steps) {
        await step();
    }
}

const loadLocalData = <T>(key: string, isArray: boolean = true): T => {
    try {
        const data = localStorage.getItem(key);
        if (data) {
            return JSON.parse(data) as T;
        }
        return (isArray ? [] : {}) as unknown as T;
    } catch (error) {
        console.error(`Error loading data from localStorage for ${key}:`, error);
        return (isArray ? [] : {}) as unknown as T;
    }
};

/**
 * Reads current local state (localStorage + IndexedDB) and upserts everything
 * to Supabase for the given user. This is idempotent — safe to call multiple times.
 *
 * Unlike syncMigratedDataToSupabase, this function does NOT remap UUIDs. It
 * assumes IDs are already valid UUIDs (as they are for existing authenticated users).
 */
export async function reuploadLocalDataToSupabase(userId: string): Promise<void> {
    const ships = loadLocalData<Ship[]>(StorageKey.SHIPS);
    const encounters = loadLocalData<LocalEncounterNote[]>(StorageKey.ENCOUNTERS);
    const loadouts = loadLocalData<Loadout[]>(StorageKey.LOADOUTS);
    const teamLoadouts = loadLocalData<TeamLoadout[]>(StorageKey.TEAM_LOADOUTS);
    const engineeringStats = loadLocalData<EngineeringStats>(StorageKey.ENGINEERING_STATS, false);
    const autogearConfigs = loadLocalData<Record<string, SavedAutogearConfig>>(
        StorageKey.AUTOGEAR_CONFIGS,
        false
    );

    // Inventory is profile-scoped in IndexedDB
    const inventory: GearPiece[] =
        (await getFromIndexedDB(`${StorageKey.INVENTORY}:${userId}`)) ?? [];

    // Step 1: Upsert inventory items (without calibration_ship_id to avoid FK issues)
    const validInventory = inventory.filter((item) => !!item.id);
    if (validInventory.length > 0) {
        // Clear calibration to avoid FK issues before upserting
        await supabase
            .from('inventory_items')
            .update({ calibration_ship_id: null })
            .eq('user_id', userId)
            .not('calibration_ship_id', 'is', null);

        for (let i = 0; i < validInventory.length; i += BATCH_SIZE) {
            const batch = validInventory.slice(i, i + BATCH_SIZE);
            const inventoryItems = batch.map((item) => ({
                id: item.id,
                user_id: userId,
                slot: item.slot,
                level: item.level,
                stars: item.stars,
                rarity: item.rarity,
                set_bonus: item.setBonus,
                stats: {
                    mainStat: item.mainStat
                        ? {
                              name: item.mainStat.name,
                              value: item.mainStat.value,
                              type: item.mainStat.type || 'flat',
                          }
                        : null,
                    subStats: (item.subStats || []).map((stat) => ({
                        name: stat.name,
                        value: stat.value,
                        type: stat.type || 'flat',
                    })),
                },
            }));

            const { error } = await supabase
                .from('inventory_items')
                .upsert(inventoryItems, { onConflict: 'id' });
            if (error) throw error;
        }
    }

    // Step 2: Upsert ships and their child tables
    const validShips = ships.filter((ship) => !!ship.id);
    if (validShips.length > 0) {
        const shipRecords = validShips.map((ship) => ({
            id: ship.id,
            user_id: userId,
            name: ship.name,
            rarity: ship.rarity,
            faction: ship.faction,
            type: ship.type,
            affinity: ship.affinity,
            equipment_locked: ship.equipmentLocked,
            starred: ship.starred,
            copies: ship.copies,
            rank: ship.rank,
            level: ship.level,
        }));

        const { error: shipsError } = await supabase
            .from('ships')
            .upsert(shipRecords, { onConflict: 'id' });
        if (shipsError) throw shipsError;

        // Upsert ship base stats
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
            shield_penetration: ship.baseStats.shieldPenetration || 0,
        }));

        const { error: baseStatsError } = await supabase
            .from('ship_base_stats')
            .upsert(baseStatsRecords, { onConflict: 'ship_id' });
        if (baseStatsError) throw baseStatsError;

        const shipIds = validShips.map((ship) => ship.id);

        // Delete and re-insert refits (no stable PK to upsert on for refit_stats)
        for (let i = 0; i < shipIds.length; i += BATCH_SIZE) {
            const batchIds = shipIds.slice(i, i + BATCH_SIZE);
            const { error } = await supabase.from('ship_refits').delete().in('ship_id', batchIds);
            if (error) throw error;
        }

        const refitRecords = validShips.flatMap((ship) =>
            (ship.refits || [])
                .filter((refit) => !!refit.id)
                .map((refit) => ({
                    id: refit.id,
                    ship_id: ship.id,
                }))
        );

        for (let i = 0; i < refitRecords.length; i += BATCH_SIZE) {
            const batch = refitRecords.slice(i, i + BATCH_SIZE);
            if (batch.length > 0) {
                const { error } = await supabase.from('ship_refits').insert(batch);
                if (error) throw error;
            }
        }

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

        for (let i = 0; i < refitStatsRecords.length; i += BATCH_SIZE) {
            const batch = refitStatsRecords.slice(i, i + BATCH_SIZE);
            if (batch.length > 0) {
                const { error } = await supabase.from('ship_refit_stats').insert(batch);
                if (error) throw error;
            }
        }

        // Delete and re-insert implants
        for (let i = 0; i < shipIds.length; i += BATCH_SIZE) {
            const batchIds = shipIds.slice(i, i + BATCH_SIZE);
            const { error } = await supabase.from('ship_implants').delete().in('ship_id', batchIds);
            if (error) throw error;
        }

        const implantRecords = validShips.flatMap((ship) =>
            Object.entries(ship.implants || {})
                .filter(([, gearId]) => !!gearId)
                .map(([slot, gearId]) => ({
                    ship_id: ship.id,
                    slot,
                    id: gearId as string,
                }))
        );

        for (let i = 0; i < implantRecords.length; i += BATCH_SIZE) {
            const batch = implantRecords.slice(i, i + BATCH_SIZE);
            if (batch.length > 0) {
                const { error } = await supabase.from('ship_implants').insert(batch);
                if (error) throw error;
            }
        }

        // Delete and re-insert ship equipment
        for (let i = 0; i < shipIds.length; i += BATCH_SIZE) {
            const batchIds = shipIds.slice(i, i + BATCH_SIZE);
            const { error } = await supabase
                .from('ship_equipment')
                .delete()
                .in('ship_id', batchIds);
            if (error) throw error;
        }

        const equipmentRecords = validShips.flatMap((ship) =>
            Object.entries(ship.equipment || {})
                .filter(([, gearId]) => !!gearId)
                .map(([slot, gearId]) => ({
                    ship_id: ship.id,
                    slot,
                    gear_id: gearId as string,
                }))
        );

        for (let i = 0; i < equipmentRecords.length; i += BATCH_SIZE) {
            const batch = equipmentRecords.slice(i, i + BATCH_SIZE);
            if (batch.length > 0) {
                const { error } = await supabase.from('ship_equipment').insert(batch);
                if (error) throw error;
            }
        }
    }

    // Step 2b: Update calibration_ship_id on inventory items (deferred from Step 1 due to FK dependency on ships)
    if (validInventory.length > 0) {
        const validShipIds = new Set(validShips.map((s) => s.id));
        const calibratedItems = validInventory.filter(
            (item) =>
                !!item.id && !!item.calibration?.shipId && validShipIds.has(item.calibration.shipId)
        );
        for (let i = 0; i < calibratedItems.length; i += BATCH_SIZE) {
            const batch = calibratedItems.slice(i, i + BATCH_SIZE);
            for (const item of batch) {
                const { error } = await supabase
                    .from('inventory_items')
                    .update({ calibration_ship_id: item.calibration!.shipId })
                    .eq('id', item.id);
                if (error) {
                    console.error('Error updating calibration_ship_id:', error, item.id);
                }
            }
        }
    }

    // Step 3: Upsert encounter notes and formations
    const validEncounters = encounters.filter((note) => !!note.id);
    if (validEncounters.length > 0) {
        const encounterRecords = validEncounters.map((note) => ({
            id: note.id,
            user_id: userId,
            name: note.name,
            description: note.description,
            is_public: note.isPublic,
        }));

        const { error: notesError } = await supabase
            .from('encounter_notes')
            .upsert(encounterRecords, { onConflict: 'id' });
        if (notesError) throw notesError;

        // Verify which ship IDs exist in the database to avoid FK violations
        const { data: existingShips } = await supabase
            .from('ships')
            .select('id')
            .eq('user_id', userId);
        const validShipIds = new Set(existingShips?.map((ship) => ship.id) || []);

        const formationRecords = validEncounters.flatMap((note) =>
            (note.formation || [])
                .filter((pos) => !!pos.shipId && validShipIds.has(pos.shipId))
                .map((pos) => ({
                    note_id: note.id,
                    position: pos.position,
                    ship_id: pos.shipId,
                }))
        );

        for (const formation of formationRecords) {
            try {
                const { error } = await supabase
                    .from('encounter_formations')
                    .upsert(formation, { onConflict: 'note_id, position' });
                if (error) {
                    console.error('Error upserting encounter formation:', error, formation);
                }
            } catch (err) {
                console.error('Exception upserting encounter formation:', err);
            }
        }
    }

    // Step 4: Upsert loadouts and loadout equipment
    const validLoadouts = loadouts.filter((loadout) => !!loadout.id && !!loadout.shipId);
    if (validLoadouts.length > 0) {
        const loadoutRecords = validLoadouts.map((loadout) => ({
            id: loadout.id,
            user_id: userId,
            name: loadout.name,
            ship_id: loadout.shipId,
            created_at: new Date(loadout.createdAt).toISOString(),
        }));

        const { error: loadoutsError } = await supabase
            .from('loadouts')
            .upsert(loadoutRecords, { onConflict: 'id' });
        if (loadoutsError) throw loadoutsError;

        const loadoutEquipmentRecords = validLoadouts.flatMap((loadout) =>
            Object.entries(loadout.equipment || {})
                .filter(([, gearId]) => !!gearId)
                .map(([slot, gearId]) => ({
                    loadout_id: loadout.id,
                    slot,
                    gear_id: gearId,
                }))
        );

        // Delete and re-insert loadout equipment (no stable composite PK to upsert on)
        if (validLoadouts.length > 0) {
            const loadoutIds = validLoadouts.map((l) => l.id);
            for (let i = 0; i < loadoutIds.length; i += BATCH_SIZE) {
                const batchIds = loadoutIds.slice(i, i + BATCH_SIZE);
                await supabase.from('loadout_equipment').delete().in('loadout_id', batchIds);
            }
        }

        for (let i = 0; i < loadoutEquipmentRecords.length; i += CHILD_BATCH_SIZE) {
            const batch = loadoutEquipmentRecords.slice(i, i + CHILD_BATCH_SIZE);
            const { error } = await supabase.from('loadout_equipment').insert(batch);
            if (error) throw error;
        }
    }

    // Step 5: Upsert team loadouts, team loadout ships, and team loadout equipment
    const validTeamLoadouts = teamLoadouts.filter((loadout) => !!loadout.id);
    if (validTeamLoadouts.length > 0) {
        const teamLoadoutRecords = validTeamLoadouts.map((teamLoadout) => ({
            id: teamLoadout.id,
            user_id: userId,
            name: teamLoadout.name,
            created_at: new Date(teamLoadout.createdAt).toISOString(),
        }));

        const { error: teamLoadoutsError } = await supabase
            .from('team_loadouts')
            .upsert(teamLoadoutRecords, { onConflict: 'id' });
        if (teamLoadoutsError) throw teamLoadoutsError;

        // Delete and re-insert team loadout ships and equipment
        const teamLoadoutIds = validTeamLoadouts.map((tl) => tl.id);
        for (let i = 0; i < teamLoadoutIds.length; i += BATCH_SIZE) {
            const batchIds = teamLoadoutIds.slice(i, i + BATCH_SIZE);
            await supabase.from('team_loadout_equipment').delete().in('team_loadout_id', batchIds);
            await supabase.from('team_loadout_ships').delete().in('team_loadout_id', batchIds);
        }

        const teamShipRecords = validTeamLoadouts.flatMap((teamLoadout) =>
            (teamLoadout.shipLoadouts || [])
                .filter((ship) => !!ship.shipId)
                .map((ship, index) => ({
                    team_loadout_id: teamLoadout.id,
                    position: index,
                    ship_id: ship.shipId,
                }))
        );

        for (let i = 0; i < teamShipRecords.length; i += CHILD_BATCH_SIZE) {
            const batch = teamShipRecords.slice(i, i + CHILD_BATCH_SIZE);
            const { error } = await supabase.from('team_loadout_ships').insert(batch);
            if (error) throw error;
        }

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
                            gear_id: gearId,
                        }))
                )
        );

        for (let i = 0; i < teamEquipmentRecords.length; i += CHILD_BATCH_SIZE) {
            const batch = teamEquipmentRecords.slice(i, i + CHILD_BATCH_SIZE);
            const { error } = await supabase.from('team_loadout_equipment').insert(batch);
            if (error) throw error;
        }
    }

    // Step 6: Upsert engineering stats
    if (engineeringStats?.stats && engineeringStats.stats.length > 0) {
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
            .filter((record) => record.ship_type && record.stat_name && !isNaN(record.value));

        // Delete and re-insert (no stable composite PK for engineering_stats)
        const { error: deleteError } = await supabase
            .from('engineering_stats')
            .delete()
            .eq('user_id', userId);
        if (deleteError) throw deleteError;

        for (let i = 0; i < statsRecords.length; i += CHILD_BATCH_SIZE) {
            const batch = statsRecords.slice(i, i + CHILD_BATCH_SIZE);
            const { error } = await supabase.from('engineering_stats').insert(batch);
            if (error) throw error;
        }
    }

    // Step 7: Upsert autogear configs
    // autogear_configs is written directly by AutogearConfigContext (not by syncMigratedDataToSupabase)
    const configEntries = Object.entries(autogearConfigs);
    if (configEntries.length > 0) {
        const configRecords = configEntries.map(([shipId, config]) => ({
            user_id: userId,
            ship_id: shipId,
            config,
        }));

        for (let i = 0; i < configRecords.length; i += BATCH_SIZE) {
            const batch = configRecords.slice(i, i + BATCH_SIZE);
            const { error } = await supabase
                .from('autogear_configs')
                .upsert(batch, { onConflict: 'user_id, ship_id' });
            if (error) throw error;
        }
    }
}
