import type { SupabaseClient } from '@supabase/supabase-js';
import type { GearSlotName, ImplantSlotName } from '../constants/gearTypes';
import type { GearPiece } from '../types/gear';
import type { Ship } from '../types/ship';
import type { FlexibleStats, Stat, StatName, StatType } from '../types/stats';
import { decodeGearStats } from '../utils/gear/statsCodec';
import { normaliseGearFields } from '../utils/gear/normaliseGearFields';
import { normaliseShipIdentity } from '../utils/ship/normaliseShipFields';

/**
 * The signed-in fleet read path: one profile's fleet data as the domain objects the app works
 * with. Every function takes the Supabase client it reads through, so the website passes its
 * global client and the MCP function passes a per-request client built from the caller's OAuth
 * token.
 *
 * Nothing here may import `src/config/supabase.ts` or anything else that reads `import.meta.env`:
 * this module runs inside a Netlify Function. `src/mcp/__tests__/nodeLoad.test.ts` is the
 * tripwire.
 */

interface RawShipStat {
    name: StatName;
    value: number;
    type: StatType;
    id: string;
}

interface RawShipEquipment {
    slot: GearSlotName;
    gear_id: string;
}

interface RawShipRefit {
    id: string;
    ship_refit_stats: RawShipStat[];
}

interface RawShipImplant {
    id: string;
    slot: ImplantSlotName;
    description?: string;
}

interface RawShipBaseStats {
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
}

interface RawShipData {
    id: string;
    name: string;
    // Raw Supabase columns, typed as what the database actually holds and narrowed by
    // `transformShipData` via the shared `normaliseShipIdentity`. `faction` stays `string` — the
    // honest type of `Ship.faction` — and is narrowed through `asFactionName` / `getFaction` at
    // read time rather than here, so an unrecognised faction is never dropped.
    rarity: string;
    faction: string;
    type: string;
    affinity: string | null;
    copies: number;
    rank: number;
    level: number;
    ship_base_stats: RawShipBaseStats;
    ship_equipment: RawShipEquipment[];
    equipment_locked: boolean;
    starred: boolean;
    ship_refits: RawShipRefit[];
    ship_implants: RawShipImplant[];
    ship_templates: {
        image_key: string;
        active_skill_text: string | null;
        charge_skill_text: string | null;
        charge_skill_charge: number | null;
        first_passive_skill_text: string | null;
        second_passive_skill_text: string | null;
        third_passive_skill_text: string | null;
        active_target: string | null;
        active_pattern: string | null;
        charged_target: string | null;
        charged_pattern: string | null;
    };
}

/** The nested select `fetchShips` reads: the ship row, its child tables, and the template's
 *  skill columns (inner join, so a ship whose template row is missing is not returned). */
const SHIPS_SELECT = `
    *,
    ship_base_stats (*),
    ship_equipment (*),
    ship_refits (
        *,
        ship_refit_stats (*)
    ),
    ship_implants (*),
    ship_templates!inner (
        image_key,
        active_skill_text,
        charge_skill_text,
        charge_skill_charge,
        first_passive_skill_text,
        second_passive_skill_text,
        third_passive_skill_text,
        active_target,
        active_pattern,
        charged_target,
        charged_pattern
    )
`;

// Type guard for valid ship data
const isValidShip = (ship: unknown): ship is Ship => {
    if (!ship || typeof ship !== 'object') {
        console.error('Invalid ship: Not an object or is null/undefined');
        return false;
    }

    const shipData = ship as Partial<Ship>;

    // Check required string properties
    const requiredStringProps = ['id', 'name', 'type', 'faction', 'rarity'] as const;
    const missingStringProps = requiredStringProps.filter(
        (prop) => typeof shipData[prop] !== 'string'
    );
    if (missingStringProps.length > 0) {
        console.error('Invalid ship: Missing or invalid string properties:', missingStringProps);
        return false;
    }

    // Check equipment object
    if (!shipData.equipment || typeof shipData.equipment !== 'object') {
        console.error('Invalid ship: Missing or invalid equipment object');
        return false;
    }

    // Check baseStats object
    const requiredBaseStats = [
        'hp',
        'attack',
        'defence',
        'speed',
        'hacking',
        'security',
        'crit',
        'critDamage',
        'healModifier',
    ] as const;
    if (!shipData.baseStats || typeof shipData.baseStats !== 'object') {
        console.error('Invalid ship: Missing or invalid baseStats object');
        return false;
    }

    const missingBaseStats = requiredBaseStats.filter(
        (stat) => typeof shipData.baseStats?.[stat] !== 'number'
    );
    if (missingBaseStats.length > 0) {
        console.error('Invalid ship: Missing or invalid base stats:', missingBaseStats);
        return false;
    }

    // Check arrays
    if (!Array.isArray(shipData.refits)) {
        console.error('Invalid ship: refits is not an array');
        return false;
    }

    // Check equipmentLocked boolean
    if (shipData.equipmentLocked !== undefined && typeof shipData.equipmentLocked !== 'boolean') {
        console.error('Invalid ship: equipmentLocked is not a boolean');
        return false;
    }

    // Check optional properties
    if (shipData.affinity !== undefined && typeof shipData.affinity !== 'string') {
        console.error('Invalid ship: affinity is not a string');
        return false;
    }

    return true;
};

// Helper function to transform Supabase data into Ship format
const transformShipData = (data: RawShipData): Ship | null => {
    try {
        const createStat = (stat: RawShipStat): Stat => {
            if (stat.type === 'percentage') {
                return {
                    name: stat.name,
                    value: stat.value,
                    type: 'percentage',
                    id: stat.id,
                };
            } else {
                return {
                    name: stat.name as FlexibleStats,
                    value: stat.value,
                    type: 'flat',
                    id: stat.id,
                };
            }
        };

        // See `normaliseShipIdentity` — the one place rarity/type/affinity get coerced (#568).
        const normalised = normaliseShipIdentity(data);

        const ship: Ship = {
            id: data.id,
            name: data.name,
            rarity: normalised.rarity,
            faction: data.faction,
            type: normalised.type,
            affinity: normalised.affinity,
            copies: data.copies || 1,
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
                // Iridium's 35% damage reduction passive requires refit 2+
                damageReduction: data.name === 'Iridium' && data.ship_refits.length >= 2 ? 35 : 0,
            },
            equipment: data.ship_equipment.reduce(
                (acc: Partial<Record<GearSlotName, string>>, eq) => {
                    acc[eq.slot] = eq.gear_id;
                    return acc;
                },
                {} as Partial<Record<GearSlotName, string>>
            ),
            equipmentLocked: data.equipment_locked || false,
            starred: data.starred || false,
            refits: data.ship_refits.map((refit) => ({
                id: refit.id,
                stats: refit.ship_refit_stats.map(createStat),
            })),
            implants: data.ship_implants.reduce(
                (acc: Partial<Record<ImplantSlotName, string>>, implant) => {
                    acc[implant.slot] = implant.description || implant.id;
                    return acc;
                },
                {} as Partial<Record<ImplantSlotName, string>>
            ),
            imageKey: data.ship_templates.image_key,
            activeSkillText: data.ship_templates.active_skill_text ?? undefined,
            chargeSkillText: data.ship_templates.charge_skill_text ?? undefined,
            chargeSkillCharge: data.ship_templates.charge_skill_charge ?? undefined,
            firstPassiveSkillText: data.ship_templates.first_passive_skill_text ?? undefined,
            secondPassiveSkillText: data.ship_templates.second_passive_skill_text ?? undefined,
            thirdPassiveSkillText: data.ship_templates.third_passive_skill_text ?? undefined,
            activeTarget: data.ship_templates.active_target ?? undefined,
            activePattern: data.ship_templates.active_pattern ?? undefined,
            chargedTarget: data.ship_templates.charged_target ?? undefined,
            chargedPattern: data.ship_templates.charged_pattern ?? undefined,
        };
        return isValidShip(ship) ? ship : null;
    } catch (error) {
        console.error('Error transforming ship data:', error);
        return null;
    }
};

/** Every ship of `profileId`, transformed and guarded. A row that fails the guard is dropped
 *  (logged); a Supabase error is thrown for the caller to report. */
export async function fetchShips(db: SupabaseClient, profileId: string): Promise<Ship[]> {
    const { data, error } = await db.from('ships').select(SHIPS_SELECT).eq('user_id', profileId);

    if (error) throw error;

    return (data as RawShipData[])
        .map(transformShipData)
        .filter((ship): ship is Ship => ship !== null)
        .map((ship) => ({
            ...ship,
            equipment: ship.equipment || {},
        }));
}

/** The raw `inventory_items` row. Exported for `InventoryProvider.addGear`, which transforms the
 *  row its insert returns. */
export interface RawGearData {
    id: string;
    // Raw Supabase columns; see `normaliseGearFields` for what each may carry.
    slot: string;
    level: number;
    stars: number;
    rarity: string;
    set_bonus: string | null;
    calibration_ship_id?: string | null;
    stats: unknown;
}

/** Rows per keyset page of `inventory_items`. */
export const INVENTORY_BATCH_SIZE = 5000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Type guard for valid gear piece
const isValidGearPiece = (gear: unknown): gear is GearPiece => {
    if (!gear || typeof gear !== 'object') return false;

    const gearData = gear as Partial<GearPiece>;

    // Check required string properties
    const requiredStringProps = ['id', 'slot', 'rarity'] as const;
    if (!requiredStringProps.every((prop) => typeof gearData[prop] === 'string')) return false;
    if (gearData.setBonus !== null && typeof gearData.setBonus !== 'string') return false;

    // Check required number properties
    const requiredNumberProps = ['level', 'stars'] as const;
    if (!requiredNumberProps.every((prop) => typeof gearData[prop] === 'number')) return false;

    // Check mainStat object
    if (!gearData.mainStat || typeof gearData.mainStat !== 'object') return false;
    if (typeof gearData.mainStat.name !== 'string' || typeof gearData.mainStat.value !== 'number') {
        return false;
    }

    // Check subStats array
    if (!Array.isArray(gearData.subStats)) return false;
    if (
        !gearData.subStats.every(
            (stat) => typeof stat.name === 'string' && typeof stat.value === 'number'
        )
    ) {
        return false;
    }

    return true;
};

// Helper function to transform Supabase data into GearPiece format
export const transformGearData = (data: RawGearData): GearPiece | null => {
    try {
        const { mainStat, subStats } = decodeGearStats(data.stats);

        const gear: GearPiece = normaliseGearFields({
            id: data.id,
            slot: data.slot,
            level: data.level,
            stars: data.stars,
            rarity: data.rarity,
            setBonus: data.set_bonus,
            // A piece with no main stat reads as hp 0 here, unlike the other
            // decode sites which keep it null. `isValidGearPiece` below rejects
            // a null mainStat, so the fallback is what keeps such rows loadable.
            mainStat: mainStat ?? { name: 'hp', value: 0, type: 'flat' },
            subStats,
            // Include calibration if calibration_ship_id exists
            ...(data.calibration_ship_id && {
                calibration: {
                    shipId: data.calibration_ship_id,
                },
            }),
        });

        return isValidGearPiece(gear) ? gear : null;
    } catch (error) {
        console.error('Error transforming gear data:', error);
        return null;
    }
};

/** One keyset page: the pieces with `id` after `lastId`, in `id` order. A failed page is retried
 *  `MAX_RETRIES` times, `retryDelayMs` apart, before its error is thrown. */
async function fetchInventoryBatch(
    db: SupabaseClient,
    profileId: string,
    lastId: string | null,
    retryDelayMs: number,
    retryCount = 0
): Promise<{ items: GearPiece[]; lastId: string | null }> {
    try {
        let query = db
            .from('inventory_items')
            .select('*')
            .eq('user_id', profileId)
            .order('id')
            .limit(INVENTORY_BATCH_SIZE);

        // Only add gt condition if we have a lastId
        if (lastId) {
            query = query.gt('id', lastId);
        }

        const { data, error } = await query;

        if (error) throw error;

        const rows = data as RawGearData[];
        const transformedGear = rows
            .map(transformGearData)
            .filter((gear): gear is GearPiece => gear !== null)
            .map((gear) => ({
                ...gear,
                subStats: gear.subStats || [],
            }));

        return {
            items: transformedGear,
            lastId: rows[rows.length - 1]?.id || null,
        };
    } catch (error) {
        if (retryCount < MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            return fetchInventoryBatch(db, profileId, lastId, retryDelayMs, retryCount + 1);
        }
        throw error;
    }
}

export interface FetchInventoryOptions {
    /** Called after each page with every piece read so far. */
    onBatch?: (itemsSoFar: GearPiece[]) => void;
    /** Checked before each page; returning true stops the walk and makes `fetchInventory`
     *  resolve to `null`. */
    isCancelled?: () => boolean;
    /** Wait between retries of a failed page. */
    retryDelayMs?: number;
}

/** Every gear piece and implant of `profileId`, walked page by page. Resolves to `null` when
 *  `isCancelled` stopped the walk. The walk ends at the first page holding fewer than
 *  `INVENTORY_BATCH_SIZE` valid pieces. */
export async function fetchInventory(
    db: SupabaseClient,
    profileId: string,
    options: FetchInventoryOptions = {}
): Promise<GearPiece[] | null> {
    const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
    let allItems: GearPiece[] = [];
    let lastId: string | null = null;

    while (true) {
        if (options.isCancelled?.()) return null;
        const batch = await fetchInventoryBatch(db, profileId, lastId, retryDelayMs);

        if (batch.items.length === 0) break;

        allItems = [...allItems, ...batch.items];
        lastId = batch.lastId;
        options.onBatch?.(allItems);

        if (batch.items.length < INVENTORY_BATCH_SIZE) break;
    }

    return allItems;
}
