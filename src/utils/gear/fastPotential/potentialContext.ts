import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';
import type { BaseStats, EngineeringStat, StatName } from '../../../types/stats';
import type { ShipTypeName, GearSlotName } from '../../../constants';
import {
    createStatVector,
    baseStatsToStatVector,
    type StatVector,
} from '../../fastScoring/statVector';
import { calculateTotalStats, type StatBreakdown } from '../../ship/statsCalculator';
import { baselineBreakdownCache } from '../potentialCalculator';

/**
 * Per-slot baseline vectors. All three fields are driven by the slow path's
 * cached StatBreakdown; see spec §Design.2 and Invariants 1/4.
 */
export interface SlotBaseline {
    /**
     * afterGear vector — base + refits + engineering + all gear EXCEPT this
     * slot's. Starting vector for the upgrade-scoring path.
     * With-ship: Float64Array of baselineBreakdown.afterGear.
     * Dummy: Float64Array of ROLE_BASE_STATS[baseRole].
     */
    readonly afterGearVector: Float64Array;

    /**
     * final vector — baselineBreakdown.final (ship state WITHOUT this slot's
     * gear). With-ship mode only; used for scoreCurrentWithShip.
     * Dummy mode: null (dummy uses scorePieceApplied for the current path).
     */
    readonly finalVector: Float64Array | null;

    /**
     * Set counts of equipment-minus-this-slot, keyed by ctx.setNameToId ids.
     * With-ship: actual counts from ship equipment minus this slot.
     * Dummy: all zeros (no other equipment).
     * Length = ctx.setNameToId.size + 1 (index 0 reserved for "no set").
     */
    readonly setCount: Uint8Array;
}

export interface PotentialContext {
    readonly withShip: boolean;
    readonly ship: Ship | undefined; // present iff withShip
    readonly percentRef: BaseStats; // afterEngineering | roleBaseStats
    readonly shipRole: ShipTypeName;
    readonly selectedStats: readonly StatName[];

    /** Baseline per slot. Populated for every slot that has eligible pieces
     * in the current analyze call. Lookup by piece.slot. */
    readonly baselinesBySlot: Map<GearSlotName, SlotBaseline>;

    /** When analyzePotentialUpgrades was called with an explicit `slot` arg,
     * this is the baseline for that slot (shortcut, avoids repeated Map.get).
     * Null when called with `slot === undefined` (=> 'all' mode). */
    readonly fixedSlotBaseline: SlotBaseline | null;

    /** Scratch buffers reused across every scorePieceApplied call. */
    readonly workspace: {
        stats: Float64Array; // len = STAT_COUNT
        setCount: Uint8Array; // len = setNameToId.size + 1
    };

    /** Integer-ID table for set bonuses. 0 is reserved for "no set". */
    readonly setNameToId: Map<string, number>;
    readonly setIdToName: readonly string[];
}

export interface BuildPotentialContextInput {
    readonly inventory: readonly GearPiece[]; // already filtered to eligible pieces
    readonly shipRole: ShipTypeName;
    readonly slot: GearSlotName | undefined;
    readonly selectedStats: readonly StatName[];
    readonly ship: Ship | undefined;
    readonly getGearPiece: ((id: string) => GearPiece | undefined) | undefined;
    readonly getEngineeringStatsForShipType:
        | ((shipType: ShipTypeName) => EngineeringStat | undefined)
        | undefined;
}

// Module-local: the slow path's ROLE_BASE_STATS is not exported; the spec
// (Invariants) says the fast path reuses the same values. Duplicating them
// here is preferable to exporting from potentialCalculator (which would
// couple the module ordering and also mean every fast-path change must go
// through a barrel). If ROLE_BASE_STATS in potentialCalculator.ts ever
// changes, this table MUST be updated in lockstep — equivalence tests will
// catch any drift immediately.
const ROLE_BASE_STATS_FAST = {
    ATTACKER: {
        hp: 22000,
        attack: 6250,
        defence: 5000,
        hacking: 0,
        security: 0,
        speed: 130,
        crit: 20,
        critDamage: 80,
        healModifier: 0,
        defensePenetration: 0,
    },
    DEFENDER: {
        hp: 25000,
        attack: 3000,
        defence: 5000,
        hacking: 0,
        security: 90,
        speed: 110,
        crit: 10,
        critDamage: 20,
        healModifier: 0,
        defensePenetration: 0,
    },
    DEBUFFER: {
        hp: 16500,
        attack: 4400,
        defence: 2500,
        hacking: 200,
        security: 33,
        speed: 125,
        crit: 12,
        critDamage: 20,
        healModifier: 0,
        defensePenetration: 0,
    },
    SUPPORTER: {
        hp: 20000,
        attack: 3000,
        defence: 3250,
        hacking: 0,
        security: 0,
        speed: 99,
        crit: 12,
        critDamage: 22,
        healModifier: 0,
        defensePenetration: 0,
    },
} as const satisfies Record<string, BaseStats>;

function getBaseRoleStats(role: ShipTypeName): BaseStats {
    if (role.startsWith('DEFENDER')) return ROLE_BASE_STATS_FAST.DEFENDER;
    if (role.startsWith('DEBUFFER')) return ROLE_BASE_STATS_FAST.DEBUFFER;
    if (role.startsWith('SUPPORTER')) return ROLE_BASE_STATS_FAST.SUPPORTER;
    return ROLE_BASE_STATS_FAST.ATTACKER;
}

export function buildPotentialContext(input: BuildPotentialContextInput): PotentialContext {
    const { inventory, shipRole, slot, selectedStats, ship } = input;
    const withShip =
        ship !== undefined &&
        input.getGearPiece !== undefined &&
        input.getEngineeringStatsForShipType !== undefined;

    // ---------- Set name -> integer id table ----------
    // 0 reserved for "no set". Names come from both (a) the inventory being
    // analyzed and (b) the ship's currently-equipped pieces (with-ship mode),
    // since the slow path counts both when computing setCountsBefore.
    const setNameToId = new Map<string, number>();
    const setIdToName: string[] = [''];
    const registerSet = (name: string | null | undefined): void => {
        if (!name) return;
        if (setNameToId.has(name)) return;
        const id = setIdToName.length;
        setNameToId.set(name, id);
        setIdToName.push(name);
    };
    for (const p of inventory) registerSet(p.setBonus);
    if (withShip && ship && input.getGearPiece) {
        for (const gearId of Object.values(ship.equipment ?? {})) {
            if (!gearId) continue;
            const g = input.getGearPiece(gearId);
            if (g?.setBonus) registerSet(g.setBonus);
        }
    }

    // ---------- Determine slots that need baselines ----------
    // For 'all' mode, every piece's .slot contributes. For fixed-slot mode,
    // only the given slot is needed.
    const slotsNeeded = new Set<GearSlotName>();
    if (slot) slotsNeeded.add(slot);
    else for (const p of inventory) if (!p.slot.includes('implant')) slotsNeeded.add(p.slot);

    // ---------- percentRef ----------
    let percentRef: BaseStats;
    if (withShip && ship && input.getGearPiece && input.getEngineeringStatsForShipType) {
        // afterEngineering is slot-independent — compute (or reuse cached)
        // baselineBreakdown for any slot we need, and read afterEngineering
        // off it. Pick an arbitrary slot deterministically.
        const firstSlot = [...slotsNeeded][0];
        const breakdown = getOrCreateBreakdown(
            ship,
            firstSlot,
            input.getGearPiece,
            input.getEngineeringStatsForShipType
        );
        percentRef = breakdown.afterEngineering;
    } else {
        percentRef = getBaseRoleStats(shipRole);
    }

    // ---------- Per-slot baselines ----------
    const baselinesBySlot = new Map<GearSlotName, SlotBaseline>();
    for (const slotName of slotsNeeded) {
        if (withShip && ship && input.getGearPiece && input.getEngineeringStatsForShipType) {
            const breakdown = getOrCreateBreakdown(
                ship,
                slotName,
                input.getGearPiece,
                input.getEngineeringStatsForShipType
            );
            const afterGearVector = baseStatsToStatVector(breakdown.afterGear);
            const finalVector = baseStatsToStatVector(breakdown.final);

            // setCount of equipment-minus-this-slot
            const setCount = new Uint8Array(setIdToName.length);
            for (const [eqSlot, gearId] of Object.entries(ship.equipment ?? {})) {
                if (!gearId) continue;
                if (eqSlot === slotName) continue;
                const g = input.getGearPiece(gearId);
                if (!g?.setBonus) continue;
                const setId = setNameToId.get(g.setBonus);
                if (setId !== undefined) setCount[setId]++;
            }
            baselinesBySlot.set(slotName, { afterGearVector, finalVector, setCount });
        } else {
            // Dummy mode
            const afterGearVector = baseStatsToStatVector(getBaseRoleStats(shipRole));
            baselinesBySlot.set(slotName, {
                afterGearVector,
                finalVector: null,
                setCount: new Uint8Array(setIdToName.length),
            });
        }
    }

    const workspace = {
        stats: createStatVector(),
        setCount: new Uint8Array(setIdToName.length),
    };

    const fixedSlotBaseline = slot ? (baselinesBySlot.get(slot) ?? null) : null;

    return {
        withShip,
        ship: withShip ? ship : undefined,
        percentRef,
        shipRole,
        selectedStats,
        baselinesBySlot,
        fixedSlotBaseline,
        workspace,
        setNameToId,
        setIdToName,
    };
}

/**
 * Read-or-compute a baselineBreakdown for (ship, slot). Populates the module-
 * level baselineBreakdownCache (exported from potentialCalculator) so the slow
 * path reads the same value if VERIFY_FAST_POTENTIAL runs both. Matches the
 * slow path's cache key format exactly.
 */
function getOrCreateBreakdown(
    ship: Ship,
    slotName: GearSlotName,
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
): StatBreakdown {
    const key = `${ship.id}_${slotName}_breakdown`;
    const cached = baselineBreakdownCache.get(key);
    if (cached) return cached;

    const equipmentWithoutSlot: Partial<Record<GearSlotName, string>> = { ...ship.equipment };
    if (equipmentWithoutSlot[slotName]) delete equipmentWithoutSlot[slotName];

    const breakdown = calculateTotalStats(
        ship.baseStats,
        equipmentWithoutSlot,
        getGearPiece,
        ship.refits || [],
        ship.implants || {},
        getEngineeringStatsForShipType(ship.type),
        ship.id
    );
    baselineBreakdownCache.set(key, breakdown);
    return breakdown;
}
