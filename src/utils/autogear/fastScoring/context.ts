import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { EngineeringStat, BaseStats } from '../../../types/stats';
import type { StatPriority, SetPriority, StatBonus } from '../../../types/autogear';
import type { GearSlotName, ShipTypeName } from '../../../constants';
import { buildGearRegistry, type GearRegistry } from './gearRegistry';
import { computeShipPrefix } from './shipPrefix';
import { createWorkspace, type FastCalcWorkspace } from './fastCalculateStats';
import { FastCache } from './fastCache';
import { statVectorToBaseStats, type StatVector } from './statVector';

export interface FastScoringContext {
    readonly ship: Ship;
    readonly priorities: readonly StatPriority[];
    readonly setPriorities: readonly SetPriority[] | undefined;
    readonly statBonuses: readonly StatBonus[] | undefined;
    readonly shipRole: ShipTypeName | undefined;
    readonly tryToCompleteSets: boolean | undefined;
    readonly arenaModifiers: Record<string, number> | null | undefined;

    readonly gearRegistry: GearRegistry;
    readonly implantRegistry: GearRegistry;
    readonly shipPrefix: StatVector;
    /** statVectorToBaseStats(shipPrefix). Percentage reference for gear/set/implant. */
    readonly percentRef: BaseStats;
    readonly cache: FastCache<number>;
    readonly workspace: FastCalcWorkspace;
    /** Ordered list of gear-only slots (no implants). */
    readonly gearSlotOrder: readonly GearSlotName[];
    /** Ordered list of implant-only slots. */
    readonly implantSlotOrder: readonly GearSlotName[];

    /** True iff the GA is optimizing implants (inventory contains implant pieces). */
    readonly optimizingImplants: boolean;
    /**
     * When optimizingImplants === false, these are the ids of ship.implants pieces
     * in implantRegistry. Used as a constant "implantIds" array for every fastScore
     * call. Empty array when optimizingImplants === true. See Invariant 2.
     */
    readonly fixedImplantIds: readonly number[];

    readonly hasHardRequirements: boolean;
}

export interface BuildContextInput {
    ship: Ship;
    availableInventory: readonly GearPiece[];
    priorities: readonly StatPriority[];
    setPriorities?: readonly SetPriority[];
    statBonuses?: readonly StatBonus[];
    shipRole?: ShipTypeName;
    tryToCompleteSets?: boolean;
    arenaModifiers?: Record<string, number> | null;
    engineeringStats: EngineeringStat | undefined;
    /**
     * Used only when the GA is NOT optimizing implants — so the context can
     * materialize ship.implants into the implant registry (Invariant 2).
     * Typically this is GeneticStrategy's cachedGetGearPiece.
     */
    resolveGearPiece?: (id: string) => GearPiece | undefined;
}

const CACHE_LIMIT = 50000;

/**
 * IMPORTANT build order (see Invariant 1 in plan preamble):
 *   1. Compute shipPrefix = base + refits + engineering (uses ship.baseStats as percent ref).
 *   2. Convert shipPrefix to BaseStats → percentRef.
 *   3. Build gearRegistry against percentRef (NOT baseStats).
 *   4. Build implantRegistry:
 *        - If optimizing implants: from the inventory's implant pieces, against percentRef.
 *        - Else: from the ship's currently-equipped implants, against percentRef. Also
 *          capture their ids in fixedImplantIds for use on every fastScore call.
 */
export function buildFastScoringContext(input: BuildContextInput): FastScoringContext {
    const gearOnly = input.availableInventory.filter((p) => !p.slot.startsWith('implant_'));
    const inventoryImplants = input.availableInventory.filter((p) => p.slot.startsWith('implant_'));
    const optimizingImplants = inventoryImplants.length > 0;

    // 1–2. Prefix + percentRef
    const shipPrefix = computeShipPrefix(input.ship, input.engineeringStats);
    const percentRef = statVectorToBaseStats(shipPrefix);

    // 3. Gear registry — pass shipId so calibration bonuses are applied
    const gearRegistry = buildGearRegistry(gearOnly, percentRef, input.ship.id);

    // 4. Implant registry — depends on whether GA is optimizing implants.
    // Implants are never calibration-eligible (isCalibrationEligible returns false
    // for implant slots), so shipId has no effect here — passing it is harmless.
    let implantRegistry: GearRegistry;
    let fixedImplantIds: number[];
    if (optimizingImplants) {
        implantRegistry = buildGearRegistry(inventoryImplants, percentRef, input.ship.id);
        fixedImplantIds = [];
    } else {
        // Collect ship.implants piece objects via the getter. Callers (GeneticStrategy)
        // must ensure these are available in the gear cache — normally ship.implants
        // ids are resolvable via getGearPiece at this point.
        const shipImplantPieces: GearPiece[] = [];
        for (const id of Object.values(input.ship.implants ?? {})) {
            if (!id) continue;
            const piece = input.resolveGearPiece?.(id);
            if (piece) shipImplantPieces.push(piece);
        }
        implantRegistry = buildGearRegistry(shipImplantPieces, percentRef, input.ship.id);
        fixedImplantIds = shipImplantPieces.map((p) => implantRegistry.idOf.get(p.id)!);
    }

    const totalSets = Math.max(gearRegistry.setIdToName.length, implantRegistry.setIdToName.length);
    const workspace = createWorkspace(totalSets);

    const gearSlotOrder = gearRegistry.slotIdToName;
    const implantSlotOrder = implantRegistry.slotIdToName;

    return {
        ship: input.ship,
        priorities: input.priorities,
        setPriorities: input.setPriorities,
        statBonuses: input.statBonuses,
        shipRole: input.shipRole,
        tryToCompleteSets: input.tryToCompleteSets,
        arenaModifiers: input.arenaModifiers,
        gearRegistry,
        implantRegistry,
        shipPrefix,
        percentRef,
        cache: new FastCache<number>(CACHE_LIMIT),
        workspace,
        gearSlotOrder,
        implantSlotOrder,
        optimizingImplants,
        fixedImplantIds,
        hasHardRequirements: input.priorities.some((p) => p.hardRequirement),
    };
}
