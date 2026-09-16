import type { Ship } from '../../types/ship';
import type { GearPiece } from '../../types/gear';
import type {
    StatPriority,
    SetPriority,
    StatBonus,
    FleetBuff,
    CustomFormula,
} from '../../types/autogear';
import type { ShipTypeName } from '../../constants/shipTypes';
import type { EngineeringStat } from '../../types/stats';
import type { AutogearAlgorithm, AutogearProgress, AutogearResult } from './AutogearStrategy';
import { getAutogearStrategy } from './getStrategy';
import { buildGearScoringInputs } from './gearScoringInputs';
import { filterTopImplantsPerSlot } from './implantFilter';

/** Every field a single ship's optimizer pass needs to decide WHAT gear counts and HOW it is
 *  scored. Deliberately excludes anything about other ships in a batch — `usedGearIds` on
 *  {@link ShipOptimizerDeps} carries that instead, so a config value never has to mean "the
 *  rest of the team" for one caller and "nothing" for another. */
export interface ShipOptimizerConfig {
    shipRole: ShipTypeName | null;
    statPriorities: StatPriority[];
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    ignoreEquipped: boolean;
    ignoreUnleveled: boolean;
    useUpgradedStats: boolean;
    tryToCompleteSets: boolean;
    selectedAlgorithm: AutogearAlgorithm;
    optimizeImplants: boolean;
    includeCalibratedGear: boolean;
    assumeCalibrated: boolean;
    excludedImplantTypes: string[];
    fleetBuffs: FleetBuff[];
    customFormula: CustomFormula | undefined;
    arenaModifiers: Record<string, number> | null;
}

export interface ShipOptimizerDeps {
    /** The full inventory pool a run may draw from, before this ship's own filtering. */
    inventory: GearPiece[];
    /** Gear already claimed by another ship earlier in the same batch. Empty for a standalone
     *  single-ship run — there is no "rest of the batch" to protect gear from. */
    usedGearIds: Set<string>;
    getGearPiece: (id: string) => GearPiece | undefined;
    /** Resolves a gear id to its simulated level-16 piece; only consulted when
     *  `config.useUpgradedStats` is set. */
    upgradedGearGetter: (id: string) => GearPiece | undefined;
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined;
    gearToShipMap: Map<string, string>;
    getShipById: (id: string) => Ship | undefined;
    /** Strategies are shared singletons (see `getStrategy.ts`), so a caller that cares about
     *  progress must supply its own callback every call — otherwise a stale one from an
     *  unrelated earlier run stays attached and fires here instead. Omit it to explicitly want
     *  no progress reporting for this call. */
    onProgress?: (progress: AutogearProgress) => void;
}

export interface ShipOptimizerRun {
    result: AutogearResult;
    /** The slow-path gear getter the run scored through — already wrapped for
     *  `config.useUpgradedStats` / `config.assumeCalibrated`. A caller computing display stats
     *  or a post-run simulation for the SAME ship must read gear through this, not the raw
     *  `getGearPiece`, or it shows numbers the optimizer never actually scored. */
    getGearForShip: (id: string) => GearPiece | undefined;
}

/**
 * Runs one ship through its configured autogear strategy: filters the shared inventory down to
 * what this ship may equip, builds the fast/slow scoring views from that one filtered list (see
 * `gearScoringInputs.ts` for why both views must come from the same source), and calls the
 * strategy's `findOptimalGear`.
 *
 * Shared by the team autogear run and the sim-rerank candidate comparison so the two cannot
 * silently drift on inventory eligibility rules or which arguments reach the strategy.
 */
export async function findOptimalGearForShip(
    ship: Ship,
    config: ShipOptimizerConfig,
    deps: ShipOptimizerDeps
): Promise<ShipOptimizerRun> {
    const {
        inventory,
        usedGearIds,
        getGearPiece,
        upgradedGearGetter,
        getEngineeringStatsForShipType,
        gearToShipMap,
        getShipById,
        onProgress,
    } = deps;

    const availableInventory = inventory
        .filter((gear) => {
            const isImplant = gear.slot.startsWith('implant_');

            // Always exclude ultimate implants from optimization
            if (gear.slot === 'implant_ultimate') {
                return false;
            }

            // If optimizeImplants is false, exclude all implants
            if (isImplant && !config.optimizeImplants) {
                return false;
            }

            // Exclude implant types the user has blacklisted for this ship
            if (isImplant && config.excludedImplantTypes?.includes(gear.setBonus ?? '')) {
                return false;
            }

            // Exclude already used gear
            if (usedGearIds.has(gear.id)) {
                return false;
            }

            // Exclude gear with set bonuses that have count set to 0
            const excludedBySetPriority = config.setPriorities.some(
                (priority) => priority.setName === gear.setBonus && priority.count === 0
            );
            if (excludedBySetPriority) {
                return false;
            }

            // Exclude calibrated gear for other ships (unless override enabled)
            if (gear.calibration?.shipId && gear.calibration.shipId !== ship.id) {
                if (!config.includeCalibratedGear) {
                    return false;
                }
            }

            // If gear is equipped on a ship
            const shipId = gearToShipMap.get(gear.id);
            const equippedShip = shipId ? getShipById(shipId) : undefined;

            // IMPLANTS: Always exclude if equipped on another ship
            if (isImplant) {
                return !equippedShip || equippedShip.id === ship.id;
            }

            // GEAR: Follow ignoreEquipped setting
            // If ignoreEquipped is true, only include:
            // 1. Not equipped on any ship, OR
            // 2. Equipped on selected ship
            if (config.ignoreEquipped) {
                return !equippedShip || equippedShip.id === ship.id;
            }

            // Otherwise, include:
            // 1. Not equipped on any ship, OR
            // 2. Equipped on selected ship, OR
            // 3. Equipped on an unlocked ship
            return !equippedShip || equippedShip.id === ship.id || !equippedShip.equipmentLocked;
        })
        .filter((gear) => {
            const isImplant = gear.slot.startsWith('implant_');
            // Don't apply ignoreUnleveled to implants (they don't have levels)
            if (isImplant) return true;
            // When useUpgradedStats is on, unleveled gear is evaluated via its simulated
            // level-16 stats, so the level filter would defeat the purpose of the setting.
            if (config.useUpgradedStats) return true;
            // For gear, apply the ignoreUnleveled filter
            return !config.ignoreUnleveled || gear.level > 0;
        });

    // The array feeds the fast path's gear registry, the getter feeds the slow path, and both
    // are built from one source so the two paths cannot score the same piece differently.
    const { scoredInventory, getGearForShip } = buildGearScoringInputs({
        availableInventory,
        getGearPiece,
        upgradedGearGetter,
        useUpgradedStats: config.useUpgradedStats,
        assumeCalibrated: config.assumeCalibrated,
    });

    // Pre-filter implants to keep only top candidates per slot. Always include currently
    // equipped implants so the strategy can decide to keep or swap them.
    const equippedImplantIds = new Set(
        Object.values(ship.implants || {}).filter((id): id is string => !!id)
    );
    const filteredInventory = config.optimizeImplants
        ? filterTopImplantsPerSlot(
              scoredInventory,
              config.statPriorities,
              equippedImplantIds,
              config.statBonuses
          )
        : scoredInventory;

    const strategy = getAutogearStrategy(config.selectedAlgorithm);
    strategy.setProgressCallback(onProgress ?? (() => {}));

    const result = await Promise.resolve(
        strategy.findOptimalGear(
            ship,
            config.statPriorities,
            filteredInventory,
            getGearForShip,
            getEngineeringStatsForShipType,
            config.shipRole || undefined,
            config.setPriorities,
            config.statBonuses,
            config.tryToCompleteSets,
            config.arenaModifiers,
            config.fleetBuffs,
            config.customFormula
        )
    );

    return { result, getGearForShip };
}
