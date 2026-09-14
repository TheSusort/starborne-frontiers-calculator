import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../config/supabase';
import { StorageKey, inventoryCacheKey } from '../constants/storage';
import { getFromIndexedDB } from '../hooks/useStorage';
import { Ship } from '../types/ship';
import { GearPiece } from '../types/gear';
import { LocalEncounterNote } from '../types/encounters';
import { Loadout, TeamLoadout } from '../types/loadout';
import { EngineeringStat, EngineeringStats } from '../types/stats';
import { SavedAutogearConfig } from '../types/autogear';
import { AutogearTeam } from '../types/autogearTeam';
import { tryEncodeGearStats } from '../utils/gear/statsCodec';

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
            const ids = await readAllIds('team_loadouts', (query) => query.eq('user_id', userId));
            if (!ids.length) return;
            await deleteWhereIn('team_loadout_equipment', 'team_loadout_id', ids);
            await deleteWhereIn('team_loadout_ships', 'team_loadout_id', ids);
        },
        async () => {
            const { error } = await supabase.from('team_loadouts').delete().eq('user_id', userId);
            if (error) throw error;
        },
        // loadout_equipment → loadouts → user_id
        async () => {
            const ids = await readAllIds('loadouts', (query) => query.eq('user_id', userId));
            if (!ids.length) return;
            await deleteWhereIn('loadout_equipment', 'loadout_id', ids);
        },
        async () => {
            const { error } = await supabase.from('loadouts').delete().eq('user_id', userId);
            if (error) throw error;
        },
        // encounter_votes (FK child of encounter_notes) → encounter_formations → encounter_notes
        async () => {
            const ids = await readAllIds('encounter_notes', (query) => query.eq('user_id', userId));
            if (!ids.length) return;
            await deleteWhereIn('encounter_votes', 'encounter_id', ids);
        },
        // encounter_formations → encounter_notes → user_id
        async () => {
            const ids = await readAllIds('encounter_notes', (query) => query.eq('user_id', userId));
            if (!ids.length) return;
            await deleteWhereIn('encounter_formations', 'note_id', ids);
        },
        // ship child tables — scope via ships → user_id
        async () => {
            const shipIds = await readAllIds('ships', (query) => query.eq('user_id', userId));
            if (!shipIds.length) return;
            await deleteWhereIn('ship_equipment', 'ship_id', shipIds);

            const implantIds = await childIds('ship_implants', 'ship_id', shipIds);
            await deleteWhereIn('ship_implant_stats', 'implant_id', implantIds);
            await deleteWhereIn('ship_implants', 'ship_id', shipIds);

            const refitIds = await childIds('ship_refits', 'ship_id', shipIds);
            await deleteWhereIn('ship_refit_stats', 'refit_id', refitIds);
            await deleteWhereIn('ship_refits', 'ship_id', shipIds);

            await deleteWhereIn('ship_base_stats', 'ship_id', shipIds);
        },
        async () => {
            const { error } = await supabase.from('encounter_notes').delete().eq('user_id', userId);
            if (error) throw error;
        },
        // inventory_items must go before ships (calibration_ship_id FK)
        async () => {
            const ids = await readAllIds('inventory_items', (query) => query.eq('user_id', userId));
            await deleteWhereIn('inventory_items', 'id', ids);
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
        // gear_wishlists → user_id (no child tables)
        async () => {
            const { error } = await supabase.from('gear_wishlists').delete().eq('user_id', userId);
            if (error) throw error;
        },
        // autogear_teams → user_id (no child tables)
        async () => {
            const { error } = await supabase.from('autogear_teams').delete().eq('user_id', userId);
            if (error) throw error;
        },
    ];

    for (const step of steps) {
        await step();
    }
}

/**
 * A local read carries two facts, and the prune needs both: the value, and
 * whether the section is actually THERE. A missing key and an unreadable one
 * both yield the same empty default, which reads identically to "the user owns
 * none of these" — and pruning on that deletes the cloud copy. `present` is
 * false unless the key exists, parses, and has the shape its consumers walk.
 *
 * Read `pruneSupabaseDataNotInLocal`'s doc for why absent means leave alone.
 */
interface LocalSection<T> {
    value: T;
    present: boolean;
}

const readLocalSection = <T>(key: string, isArray: boolean = true): LocalSection<T> => {
    const empty = { value: (isArray ? [] : {}) as unknown as T, present: false };
    try {
        const data = localStorage.getItem(key);
        if (!data) return empty;
        const parsed = JSON.parse(data) as T;
        // `null` and every scalar parse cleanly and are neither. Checking only
        // `Array.isArray` lets them through as a present object section, and a present
        // section is one this app then REPLACES the cloud copy from.
        const shapeMatches = isArray
            ? Array.isArray(parsed)
            : typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
        if (!shapeMatches) {
            console.error(`Local section ${key} has the wrong shape for its consumers`);
            return empty;
        }
        return { value: parsed, present: true };
    } catch (error) {
        console.error(`Error loading data from localStorage for ${key}:`, error);
        return empty;
    }
};

const loadLocalData = <T>(key: string, isArray: boolean = true): T =>
    readLocalSection<T>(key, isArray).value;

/**
 * The bar every identity column is held to, local or cloud: a non-empty string. It is
 * deliberately the minimum consumers need, because an over-strict check is itself a way to
 * lose data — an unreadable section is never pruned, but it is also never reconciled.
 */
const usableIdentity = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0;

/**
 * A prunable section is compared ROW BY ROW against the cloud, so the shape check has to
 * reach the rows: a list of objects with no `id` reads as a perfectly good empty id set, and
 * every cloud row then counts as stale. One unusable row makes the whole section unreadable
 * — a partial id set is a wrong answer, not a smaller one.
 */
const hasUsableId = (row: unknown): row is { id: string } =>
    typeof row === 'object' && row !== null && usableIdentity((row as { id?: unknown }).id);

const asPrunableSection = <T extends { id: string }>(
    label: string,
    section: LocalSection<T[]>
): LocalSection<T[]> => {
    if (!section.present) return section;
    if (!section.value.every(hasUsableId)) {
        console.error(`Local section ${label} holds rows with no usable id`);
        return { value: [], present: false };
    }
    return section;
};

const readPrunableSection = <T extends { id: string }>(key: string): LocalSection<T[]> =>
    asPrunableSection(key, readLocalSection<T[]>(key));

/**
 * Reads current local state (localStorage + IndexedDB) and upserts everything
 * to Supabase for the given user. This is idempotent — safe to call multiple times.
 *
 * Unlike syncMigratedDataToSupabase, this function does NOT remap UUIDs. It
 * assumes IDs are already valid UUIDs (as they are for existing authenticated users).
 *
 * Returns the sections that did NOT fully land. Every step but the last throws on failure;
 * the autogear-team step swallows a per-team error by design (see its catch), so it reports
 * the section here instead. A caller about to prune must exclude what it is told, or it
 * removes cloud rows against a local picture the upload never finished writing.
 */
/** One `engineering_stats` row as the table stores it. */
export interface EngineeringRecord {
    user_id: string;
    ship_type: string;
    stat_name: string;
    value: number;
    type: string;
}

/**
 * The cloud rows an engineering section describes. Entries that carry no ship type, no stat
 * name or an unparseable value are dropped rather than written: the column is `NOT NULL`
 * numeric, and one bad entry would reject the whole batch it lands in.
 */
export const engineeringRecords = (
    userId: string,
    section: EngineeringStats | undefined
): EngineeringRecord[] =>
    (section?.stats ?? [])
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

/**
 * Writes engineering rows on their composite identity. Removing a row the section no longer
 * names is a separate step at every call site, so a rejected write here leaves the user's
 * cloud stats standing rather than emptied.
 */
export async function upsertEngineeringStats(
    userId: string,
    records: EngineeringRecord[],
    client: SupabaseClient = supabase
): Promise<void> {
    for (let i = 0; i < records.length; i += CHILD_BATCH_SIZE) {
        const { error } = await client
            .from('engineering_stats')
            .upsert(records.slice(i, i + CHILD_BATCH_SIZE), {
                onConflict: 'user_id,ship_type,stat_name',
            });
        if (error) throw error;
    }
}

/**
 * Removes every cloud engineering row the section does not name, for a caller that holds the
 * user's COMPLETE local picture and runs no `pruneSupabaseDataNotInLocal` afterwards.
 *
 * Runs only after `upsertEngineeringStats` has resolved, so a failure leaves extra rows
 * rather than missing ones. Two statements are needed because a ship type absent from the
 * section entirely is named by no per-type delete: PostgREST has no empty `in` list, so a
 * section with no usable rows at all is left alone rather than sent `not in ()`.
 */
export async function pruneEngineeringStatsNotNamed(
    userId: string,
    records: EngineeringRecord[],
    client: SupabaseClient = supabase
): Promise<void> {
    const byShipType = new Map<string, string[]>();
    for (const record of records) {
        byShipType.set(record.ship_type, [
            ...(byShipType.get(record.ship_type) ?? []),
            record.stat_name,
        ]);
    }
    if (byShipType.size === 0) return;

    const list = (values: string[]) => `(${values.map((value) => `"${value}"`).join(',')})`;

    for (const [shipType, names] of byShipType) {
        const { error } = await client
            .from('engineering_stats')
            .delete()
            .eq('user_id', userId)
            .eq('ship_type', shipType)
            .not('stat_name', 'in', list(names));
        if (error) throw error;
    }

    const { error } = await client
        .from('engineering_stats')
        .delete()
        .eq('user_id', userId)
        .not('ship_type', 'in', list([...byShipType.keys()]));
    if (error) throw error;
}

export async function reuploadLocalDataToSupabase(userId: string): Promise<string[]> {
    const ships = loadLocalData<Ship[]>(StorageKey.SHIPS);
    const encounters = loadLocalData<LocalEncounterNote[]>(StorageKey.ENCOUNTERS);
    const loadouts = loadLocalData<Loadout[]>(StorageKey.LOADOUTS);
    const teamLoadouts = loadLocalData<TeamLoadout[]>(StorageKey.TEAM_LOADOUTS);
    const engineeringStats = loadLocalData<EngineeringStats>(StorageKey.ENGINEERING_STATS, false);
    const autogearConfigs = loadLocalData<Record<string, SavedAutogearConfig>>(
        StorageKey.AUTOGEAR_CONFIGS,
        false
    );
    const autogearTeams = loadLocalData<AutogearTeam[]>(StorageKey.AUTOGEAR_TEAMS);

    // Inventory is profile-scoped in IndexedDB
    const inventory: GearPiece[] = (await getFromIndexedDB(inventoryCacheKey(userId))) ?? [];

    // Step 1: Upsert inventory items (without calibration_ship_id to avoid FK issues)
    const validInventory = inventory.filter((item) => !!item.id);

    // Encoded BEFORE the calibration clear below, which is destructive: a piece
    // whose stats cannot be encoded should be known while nothing has changed
    // remotely yet.
    const inventoryRecords = validInventory.flatMap((item) => {
        const stats = tryEncodeGearStats({
            mainStat: item.mainStat,
            subStats: item.subStats || [],
        });
        if (!stats) return [];
        return [
            {
                id: item.id,
                user_id: userId,
                slot: item.slot,
                level: item.level,
                stars: item.stars,
                rarity: item.rarity,
                set_bonus: item.setBonus,
                stats,
            },
        ];
    });

    // ship_equipment, ship_implants, loadout_equipment and team_loadout_equipment
    // all FK to inventory_items(id). A piece dropped above has no row, so its
    // dependent records must be dropped too or their insert violates the
    // constraint and aborts everything after it. Only the pieces actually
    // skipped are filtered — an id absent from local inventory entirely may
    // still exist remotely, and excluding those would break valid references.
    const keptGearIds = new Set(inventoryRecords.map((record) => record.id));
    const skippedGearIds = new Set(
        validInventory.map((item) => item.id).filter((id) => !keptGearIds.has(id))
    );
    const gearIdIsUsable = (gearId: string): boolean => !skippedGearIds.has(gearId);

    if (validInventory.length > 0) {
        // Clear calibration to avoid FK issues before upserting
        await supabase
            .from('inventory_items')
            .update({ calibration_ship_id: null })
            .eq('user_id', userId)
            .not('calibration_ship_id', 'is', null);

        for (let i = 0; i < inventoryRecords.length; i += BATCH_SIZE) {
            const batch = inventoryRecords.slice(i, i + BATCH_SIZE);
            const { error } = await supabase
                .from('inventory_items')
                .upsert(batch, { onConflict: 'id' });
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
                .filter(([, gearId]) => !!gearId && gearIdIsUsable(gearId))
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
                .filter(([, gearId]) => !!gearId && gearIdIsUsable(gearId))
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
        const validShipIds = new Set(
            await readAllIds('ships', (query) => query.eq('user_id', userId))
        );

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
                .filter(([, gearId]) => !!gearId && gearIdIsUsable(gearId))
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
                        .filter(([, gearId]) => !!gearId && gearIdIsUsable(gearId))
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

    // Step 6: Upsert engineering stats.
    //
    // Nothing here removes a row: a stat the local section no longer names is
    // `pruneSupabaseDataNotInLocal`'s to delete, so a rejected write leaves the user's cloud
    // stats standing rather than emptied.
    await upsertEngineeringStats(userId, engineeringRecords(userId, engineeringStats));

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

    // Step 8: Upsert saved autogear teams
    const incomplete: string[] = [];
    try {
        if (autogearTeams.length > 0) {
            const teamRecords = autogearTeams.map((team) => ({
                id: team.id,
                user_id: userId,
                name: team.name,
                ship_ids: team.shipIds,
                created_at: new Date(team.createdAt).toISOString(),
            }));

            // Upsert one team at a time (no BATCH_SIZE chunking here): a single
            // name collision would otherwise fail the whole batch statement and
            // take every other team in it down too.
            for (const team of teamRecords) {
                const { error } = await supabase
                    .from('autogear_teams')
                    .upsert(team, { onConflict: 'id' });
                if (error) {
                    console.error(
                        'Error upserting individual autogear team during re-upload:',
                        error,
                        team.id
                    );
                    incomplete.push(StorageKey.AUTOGEAR_TEAMS);
                }
            }
        }
    } catch (error) {
        // Non-fatal, unlike every other step above: `(user_id, name)` is a unique
        // constraint upsert can't resolve via onConflict: 'id', so a name
        // collision with an existing remote team must not abort steps 1-7,
        // which already succeeded.
        console.error('Error re-uploading autogear teams:', error);
        incomplete.push(StorageKey.AUTOGEAR_TEAMS);
    }

    return [...new Set(incomplete)];
}

/**
 * PostgREST caps one response at the project's `db-max-rows`, so a plain
 * `select(...)` silently returns a PREFIX for any table a real account fills —
 * an inventory runs to tens of thousands of rows. A truncated read makes every
 * caller act on a partial picture: rows meant to go survive, and a truncated
 * CHILD read deletes some of a parent's children and then fails the parent
 * delete on the FK, aborting the sequence partway. Every row enumeration in
 * this file goes through `readAllRows`, ordered so pages cannot overlap or
 * skip; `idReadsArePaged.test.ts` fails if a select is added that does not.
 *
 * The order must be TOTAL over the rows the filter admits, or a page boundary
 * can drop or repeat a row. `id` is that column for every table that has one,
 * which is why it is the default. `engineering_stats` has no `id`: it is keyed
 * `(user_id, ship_type, stat_name)`, and since every read here filters to one
 * `user_id`, the remaining two columns are total over what the read returns.
 */
const ID_PAGE_SIZE = 1000;

async function readAllRows<T>(
    table: string,
    columns: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filter: (query: any) => any,
    orderBy: readonly string[] = ['id']
): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += ID_PAGE_SIZE) {
        const ordered = orderBy.reduce(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (query: any, column) => query.order(column),
            filter(supabase.from(table).select(columns))
        );
        const { data, error } = await ordered.range(from, from + ID_PAGE_SIZE - 1);
        if (error) throw error;
        const page = (data ?? []) as T[];
        rows.push(...page);
        if (page.length < ID_PAGE_SIZE) return rows;
    }
}

async function readAllIds(
    table: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filter: (query: any) => any
): Promise<string[]> {
    const rows = await readAllRows<{ id: string }>(table, 'id', filter);
    return rows.map((row) => row.id);
}

/** Cloud ids for a user-owned table that are absent from the local snapshot. */
async function staleIds(table: string, userId: string, localIds: Set<string>): Promise<string[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = await readAllIds(table, (query: any) => query.eq('user_id', userId));
    return ids.filter((id) => !localIds.has(id));
}

/**
 * Row ids of the user's autogear configs whose ship the local section does not
 * name. Matched on `ship_id` while the delete still goes by `id`: the local
 * section is keyed by ship id and carries no row id at all.
 *
 * A row missing any of the three columns makes the WHOLE prune return nothing,
 * the cloud-side mirror of `asPrunableSection`'s rule: a row with no `ship_id`
 * is in no local key set, so it and every row read beside it count as stale and
 * the user's entire config table goes. A partial answer here is a wrong answer,
 * not a smaller one. The bar is a non-empty string, not a uuid: an over-strict
 * check leaves stale rows behind forever, which is the safe failure but still
 * one.
 *
 * `watermark` is the newest `updated_at` the read itself saw, and the caller
 * bounds its delete by it so that a config written between the read and the
 * delete survives. Max-of-read rather than a clock reading: there is no server
 * `now()` to select without an RPC, and the browser's clock skews against
 * Postgres in both directions. Any write whose transaction starts after this
 * read completes carries a later `updated_at` than every row the read returned.
 *
 * It does NOT close the window between the LOCAL read and this cloud read; no
 * section's prune does.
 */
interface StaleConfigs {
    ids: string[];
    watermark: string | null;
}

async function staleConfigRows(userId: string, localShipIds: Set<string>): Promise<StaleConfigs> {
    const rows = await readAllRows<Record<string, unknown>>(
        'autogear_configs',
        'id, ship_id, updated_at',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (query: any) => query.eq('user_id', userId)
    );
    if (
        !rows.every((row) =>
            ['id', 'ship_id', 'updated_at'].every((key) => usableIdentity(row[key]))
        )
    ) {
        console.error('A cloud autogear config is missing a column; leaving the section alone');
        return { ids: [], watermark: null };
    }
    const typed = rows as unknown as Array<{ id: string; ship_id: string; updated_at: string }>;
    // Compared as raw strings, never through `Date`: PostgREST returns
    // microsecond precision and `Date.parse` truncates to milliseconds, which
    // would pick an arbitrary row among any that share a millisecond.
    const watermark = typed.reduce<string | null>(
        (newest, row) => (newest === null || row.updated_at > newest ? row.updated_at : newest),
        null
    );
    return {
        ids: typed.filter((row) => !localShipIds.has(row.ship_id)).map((row) => row.id),
        watermark,
    };
}

/**
 * An `engineering_stats` row is identified by `(ship_type, stat_name)` — the table has no
 * `id` — and both sides of the comparison key on this string. The separator is safe because
 * the columns hold `ShipTypeName` and `StatName`, closed unions of bare identifiers.
 */
const engineeringKey = (shipType: string, statName: string) => `${shipType}\u0000${statName}`;

/**
 * The pairs the local engineering section names, or null when any entry is unusable. One
 * unusable entry makes the whole section unreadable, for the reason `asPrunableSection`
 * refuses a row with no id: the pairs it fails to contribute read as stale, and the cloud
 * rows holding them would be deleted from a local value that describes nothing.
 */
const engineeringPairs = (entries: EngineeringStat[]): Set<string> | null => {
    const pairs = new Set<string>();
    for (const entry of entries) {
        if (!entry || !usableIdentity(entry.shipType) || !Array.isArray(entry.stats)) {
            console.error(
                'Local section engineering stats holds an entry with no ship type or stats'
            );
            return null;
        }
        for (const stat of entry.stats) {
            if (!stat || !usableIdentity(stat.name)) {
                console.error('Local section engineering stats holds a stat with no name');
                return null;
            }
            pairs.add(engineeringKey(entry.shipType, stat.name));
        }
    }
    return pairs;
};

/**
 * The user's cloud engineering stats that the local section does not name, grouped by ship
 * type because the delete is keyed on the composite identity.
 *
 * A row missing either identity column makes the WHOLE prune return nothing, the cloud-side
 * mirror of `engineeringPairs`' rule.
 *
 * `watermark` is the newest `updated_at` the read itself saw, and the caller bounds its
 * delete by it; read `staleConfigRows`' doc for why that bound is the newest row read rather
 * than a clock. Both writers of this table upsert on `(user_id, ship_type, stat_name)`, and
 * a natural-key upsert can UPDATE a row the local section does not name — which is exactly a
 * row already counted as stale — so the window is reachable from ordinary use.
 */
interface StaleEngineering {
    byShipType: Map<string, string[]>;
    watermark: string | null;
}

async function staleEngineeringRows(
    userId: string,
    localPairs: Set<string>
): Promise<StaleEngineering> {
    const rows = await readAllRows<Record<string, unknown>>(
        'engineering_stats',
        'ship_type, stat_name, updated_at',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (query: any) => query.eq('user_id', userId),
        ['ship_type', 'stat_name']
    );
    if (
        !rows.every((row) =>
            ['ship_type', 'stat_name', 'updated_at'].every((key) => usableIdentity(row[key]))
        )
    ) {
        console.error('A cloud engineering stat is missing a column; leaving the section alone');
        return { byShipType: new Map(), watermark: null };
    }
    const typed = rows as unknown as Array<{
        ship_type: string;
        stat_name: string;
        updated_at: string;
    }>;
    const watermark = typed.reduce<string | null>(
        (newest, row) => (newest === null || row.updated_at > newest ? row.updated_at : newest),
        null
    );
    const byShipType = new Map<string, string[]>();
    for (const row of typed) {
        if (localPairs.has(engineeringKey(row.ship_type, row.stat_name))) continue;
        byShipType.set(row.ship_type, [...(byShipType.get(row.ship_type) ?? []), row.stat_name]);
    }
    return { byShipType, watermark };
}

/**
 * Deletes the named stats of each ship type, bounded by the read's watermark. The
 * `ship_type` predicate is half the row's identity: without it the statement takes those
 * stat names out of every ship type the user has.
 */
async function deleteEngineeringStats(
    userId: string,
    stale: Map<string, string[]>,
    bound: string
): Promise<void> {
    for (const [shipType, names] of stale) {
        for (let i = 0; i < names.length; i += BATCH_SIZE) {
            const { error } = await supabase
                .from('engineering_stats')
                .delete()
                .eq('user_id', userId)
                .eq('ship_type', shipType)
                .in('stat_name', names.slice(i, i + BATCH_SIZE))
                .lte('updated_at', bound);
            if (error) throw error;
        }
    }
}

/**
 * Deletes rows from `table` where `column` matches one of `ids`, in batches: a
 * single statement carrying every id of a real account's inventory times out.
 */
async function deleteWhereIn(table: string, column: string, ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const { error } = await supabase
            .from(table)
            .delete()
            .in(column, ids.slice(i, i + BATCH_SIZE));
        if (error) throw error;
    }
}

/**
 * `deleteWhereIn`, with an upper bound on a second column: a row whose
 * `boundColumn` moved past `bound` since the ids were read is left alone.
 */
async function deleteWhereInBounded(
    table: string,
    column: string,
    ids: string[],
    boundColumn: string,
    bound: string
): Promise<void> {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const { error } = await supabase
            .from(table)
            .delete()
            .in(column, ids.slice(i, i + BATCH_SIZE))
            .lte(boundColumn, bound);
        if (error) throw error;
    }
}

/** Ids of rows in a child table whose parent is being removed. */
async function childIds(
    table: string,
    parentColumn: string,
    parentIds: string[]
): Promise<string[]> {
    const found: string[] = [];
    for (let i = 0; i < parentIds.length; i += BATCH_SIZE) {
        const batch = parentIds.slice(i, i + BATCH_SIZE);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        found.push(...(await readAllIds(table, (query: any) => query.in(parentColumn, batch))));
    }
    return found;
}

/**
 * Every section `pruneSupabaseDataNotInLocal` knows how to compare. A caller
 * replacing the whole cloud copy with local state — the sync toggle and
 * clear-and-resync — passes all of them; a restore passes only the sections
 * its backup file carried.
 */
export const PRUNABLE_SECTIONS: readonly string[] = [
    StorageKey.SHIPS,
    StorageKey.INVENTORY,
    StorageKey.ENCOUNTERS,
    StorageKey.LOADOUTS,
    StorageKey.TEAM_LOADOUTS,
    StorageKey.AUTOGEAR_TEAMS,
    StorageKey.AUTOGEAR_CONFIGS,
    StorageKey.ENGINEERING_STATS,
];

/**
 * Removes what a user has in Supabase but not in their current local snapshot,
 * across the sections `PRUNABLE_SECTIONS` names, so a restore lands the backup
 * as a snapshot rather than merging it into whatever was already in the cloud.
 *
 * Runs only AFTER `reuploadLocalDataToSupabase` has resolved: every row the
 * local snapshot describes already exists remotely by then, so a failure here
 * leaves extra rows behind and never missing ones. Nothing here may be
 * reordered ahead of that call.
 *
 * Deletes are child-before-parent; the schema has no CASCADE constraints.
 */
export async function pruneSupabaseDataNotInLocal(
    userId: string,
    restoredSections: readonly string[]
): Promise<void> {
    // A section the caller did not name was not rewritten locally, so the local
    // state it would be compared against is whatever happened to be cached —
    // for gear on a fresh device, plausibly nothing. Pruning that would delete
    // cloud rows the user never asked to drop, which is the failure this whole
    // path exists to prevent. Absent means "leave alone", not "empty".
    const restored = new Set(restoredSections);

    const localShips = readPrunableSection<Ship>(StorageKey.SHIPS);
    const localEncounters = readPrunableSection<LocalEncounterNote>(StorageKey.ENCOUNTERS);
    const localLoadouts = readPrunableSection<Loadout>(StorageKey.LOADOUTS);
    const localTeamLoadouts = readPrunableSection<TeamLoadout>(StorageKey.TEAM_LOADOUTS);
    const localAutogearTeams = readPrunableSection<AutogearTeam>(StorageKey.AUTOGEAR_TEAMS);
    // An OBJECT section keyed by ship id, not a list of rows carrying their own
    // `id`, so `asPrunableSection`'s row check has no analogue: `Object.keys`
    // cannot yield a non-string, which is the hazard that check exists for.
    const localAutogearConfigs = readLocalSection<Record<string, unknown>>(
        StorageKey.AUTOGEAR_CONFIGS,
        false
    );
    // An OBJECT section whose rows live under `stats`: `present` admits any object, and one
    // carrying no `stats` array names no pair at all, which would read as every cloud row
    // stale. Null when the section is unusable in any of those ways.
    const localEngineering = readLocalSection<EngineeringStats>(
        StorageKey.ENGINEERING_STATS,
        false
    );
    const localEngineeringPairs =
        localEngineering.present && Array.isArray(localEngineering.value?.stats)
            ? engineeringPairs(localEngineering.value.stats)
            : null;

    // IndexedDB resolves `undefined` for a key it has no record for, which is a
    // different fact from a record holding an empty array: the first is a
    // cache that was never populated, the second is a user who owns no gear.
    // A read that fails outright rejects, and aborts the prune rather than
    // reaching here with an empty list.
    const inventoryRecord = await getFromIndexedDB(inventoryCacheKey(userId));
    // Labelled, not keyed: `StorageKey.INVENTORY` names an IndexedDB entry and may only be
    // handed to the key resolver or an IndexedDB helper (see inventoryStorageKey.test.ts).
    const localInventory = asPrunableSection<GearPiece>(
        'the gear cache',
        Array.isArray(inventoryRecord)
            ? { value: inventoryRecord, present: true }
            : { value: [], present: false }
    );

    const idSet = <T extends { id: string }>(rows: T[]) => new Set(rows.map((row) => row.id));

    // Both halves of each gate are load-bearing. The caller names the sections
    // it wrote; `present` says the section is locally READABLE, without which
    // the comparison runs against an empty default that means nothing. Either
    // one missing leaves that section's cloud rows alone.
    const staleShipIds =
        restored.has(StorageKey.SHIPS) && localShips.present
            ? await staleIds('ships', userId, idSet(localShips.value))
            : [];
    const staleGearIds =
        restored.has(StorageKey.INVENTORY) && localInventory.present
            ? await staleIds('inventory_items', userId, idSet(localInventory.value))
            : [];
    const staleNoteIds =
        restored.has(StorageKey.ENCOUNTERS) && localEncounters.present
            ? await staleIds('encounter_notes', userId, idSet(localEncounters.value))
            : [];
    const staleLoadoutIds =
        restored.has(StorageKey.LOADOUTS) && localLoadouts.present
            ? await staleIds('loadouts', userId, idSet(localLoadouts.value))
            : [];
    const staleTeamIds =
        restored.has(StorageKey.TEAM_LOADOUTS) && localTeamLoadouts.present
            ? await staleIds('team_loadouts', userId, idSet(localTeamLoadouts.value))
            : [];
    const staleAutogearTeamIds =
        restored.has(StorageKey.AUTOGEAR_TEAMS) && localAutogearTeams.present
            ? await staleIds('autogear_teams', userId, idSet(localAutogearTeams.value))
            : [];
    // The local autogear-config section is keyed by ship id, so the comparison
    // is ship id against ship id while the delete still goes by `id`. Comparing instead
    // against the ships being pruned would miss a config removed for a ship the
    // snapshot KEEPS (#521). The `(user_id, ship_id)` conflict target the
    // upsert above uses is a PRODUCTION constraint that
    // `supabase/current-schema.sql` does not carry; do not read it here.
    const staleConfigs =
        restored.has(StorageKey.AUTOGEAR_CONFIGS) && localAutogearConfigs.present
            ? await staleConfigRows(userId, new Set(Object.keys(localAutogearConfigs.value)))
            : { ids: [], watermark: null };
    const staleEngineering =
        restored.has(StorageKey.ENGINEERING_STATS) && localEngineeringPairs !== null
            ? await staleEngineeringRows(userId, localEngineeringPairs)
            : { byShipType: new Map<string, string[]>(), watermark: null };

    // Encounter notes: votes and formations both FK to the note.
    if (staleNoteIds.length > 0) {
        await deleteWhereIn('encounter_votes', 'encounter_id', staleNoteIds);
        await deleteWhereIn('encounter_formations', 'note_id', staleNoteIds);
        await deleteWhereIn('encounter_notes', 'id', staleNoteIds);
    }

    if (staleLoadoutIds.length > 0) {
        await deleteWhereIn('loadout_equipment', 'loadout_id', staleLoadoutIds);
        await deleteWhereIn('loadouts', 'id', staleLoadoutIds);
    }

    if (staleTeamIds.length > 0) {
        await deleteWhereIn('team_loadout_equipment', 'team_loadout_id', staleTeamIds);
        await deleteWhereIn('team_loadout_ships', 'team_loadout_id', staleTeamIds);
        await deleteWhereIn('team_loadouts', 'id', staleTeamIds);
    }

    // autogear_teams holds ship ids in a plain array column, not an FK.
    if (staleAutogearTeamIds.length > 0) {
        await deleteWhereIn('autogear_teams', 'id', staleAutogearTeamIds);
    }

    // autogear_configs.ship_id is a plain text column, not an FK, and no table
    // references a config, so this is independent of the ship prune below.
    //
    // Bounded by the read's watermark so a config saved between the read and
    // this delete is not removed; read `staleConfigRows`' doc for why that bound
    // is the newest row read rather than a clock. `saveConfig` is fired without
    // being awaited, so the window is reachable from ordinary use.
    if (staleConfigs.ids.length > 0 && staleConfigs.watermark !== null) {
        await deleteWhereInBounded(
            'autogear_configs',
            'id',
            staleConfigs.ids,
            'updated_at',
            staleConfigs.watermark
        );
    }

    // No table references engineering_stats, and its rows carry their own composite
    // identity, so this is independent of every delete around it.
    if (staleEngineering.byShipType.size > 0 && staleEngineering.watermark !== null) {
        await deleteEngineeringStats(
            userId,
            staleEngineering.byShipType,
            staleEngineering.watermark
        );
    }

    // Ships are deleted last of the parents: five tables reference a ship, and
    // three of them (loadouts, team_loadout_ships, team_loadout_equipment) can
    // be rows the local snapshot KEEPS while pointing at a ship it drops, so
    // they are cleared by ship_id here rather than by their own stale set.
    if (staleShipIds.length > 0) {
        await deleteWhereIn('encounter_formations', 'ship_id', staleShipIds);
        await deleteWhereIn('team_loadout_equipment', 'ship_id', staleShipIds);
        await deleteWhereIn('team_loadout_ships', 'ship_id', staleShipIds);

        const orphanedLoadoutIds = await childIds('loadouts', 'ship_id', staleShipIds);
        await deleteWhereIn('loadout_equipment', 'loadout_id', orphanedLoadoutIds);
        await deleteWhereIn('loadouts', 'ship_id', staleShipIds);

        // calibration_ship_id is nullable and the piece itself survives.
        for (let i = 0; i < staleShipIds.length; i += BATCH_SIZE) {
            const { error } = await supabase
                .from('inventory_items')
                .update({ calibration_ship_id: null })
                .in('calibration_ship_id', staleShipIds.slice(i, i + BATCH_SIZE));
            if (error) throw error;
        }

        await deleteWhereIn('ship_equipment', 'ship_id', staleShipIds);

        const implantIds = await childIds('ship_implants', 'ship_id', staleShipIds);
        await deleteWhereIn('ship_implant_stats', 'implant_id', implantIds);
        await deleteWhereIn('ship_implants', 'ship_id', staleShipIds);

        const refitIds = await childIds('ship_refits', 'ship_id', staleShipIds);
        await deleteWhereIn('ship_refit_stats', 'refit_id', refitIds);
        await deleteWhereIn('ship_refits', 'ship_id', staleShipIds);

        await deleteWhereIn('ship_base_stats', 'ship_id', staleShipIds);
        await deleteWhereIn('ships', 'id', staleShipIds);
    }

    // Gear. `ship_implants.id` IS the inventory item's id, so a stale piece that
    // is an equipped implant also drags ship_implant_stats with it.
    if (staleGearIds.length > 0) {
        await deleteWhereIn('ship_equipment', 'gear_id', staleGearIds);
        await deleteWhereIn('loadout_equipment', 'gear_id', staleGearIds);
        await deleteWhereIn('team_loadout_equipment', 'gear_id', staleGearIds);
        await deleteWhereIn('ship_implant_stats', 'implant_id', staleGearIds);
        await deleteWhereIn('ship_implants', 'id', staleGearIds);
        await deleteWhereIn('inventory_items', 'id', staleGearIds);
    }
}
