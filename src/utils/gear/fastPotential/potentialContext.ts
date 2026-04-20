import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';
import type { BaseStats, EngineeringStat, StatName } from '../../../types/stats';
import type { ShipTypeName, GearSlotName } from '../../../constants';

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

export function buildPotentialContext(_input: BuildPotentialContextInput): PotentialContext {
    throw new Error('not yet implemented — see Task 7');
}
