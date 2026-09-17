import { useState } from 'react';
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
import type { ArenaSeason } from '../../types/arena';
import { AutogearAlgorithm, type AutogearProgress, type AutogearResult } from './AutogearStrategy';
import { getAutogearStrategy } from './getStrategy';
import { buildGearScoringInputs } from './gearScoringInputs';
import { filterTopImplantsPerSlot } from './implantFilter';
import { getMatchingModifiers } from './arenaModifiers';

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

/** Every per-ship control the manual autogear/sim-rerank UI tracks — role, priorities, and every
 *  toggle that changes what a run hands to {@link ShipOptimizerConfig}. */
export interface AutogearShipConfig {
    shipRole: ShipTypeName | null;
    statPriorities: StatPriority[];
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    ignoreEquipped: boolean;
    ignoreUnleveled: boolean;
    useUpgradedStats: boolean;
    tryToCompleteSets: boolean;
    selectedAlgorithm: AutogearAlgorithm;
    showSecondaryRequirements: boolean;
    optimizeImplants: boolean;
    includeCalibratedGear: boolean;
    assumeCalibrated: boolean;
    useArenaModifiers: boolean;
    excludedImplantTypes: string[];
    fleetBuffs: FleetBuff[];
    customFormula: CustomFormula | undefined;
}

export function defaultAutogearShipConfig(defaultRole: ShipTypeName): AutogearShipConfig {
    return {
        shipRole: defaultRole,
        statPriorities: [],
        setPriorities: [],
        statBonuses: [],
        ignoreEquipped: false,
        ignoreUnleveled: true,
        useUpgradedStats: false,
        tryToCompleteSets: false,
        selectedAlgorithm: AutogearAlgorithm.Genetic,
        showSecondaryRequirements: false,
        optimizeImplants: false,
        includeCalibratedGear: false,
        assumeCalibrated: false,
        useArenaModifiers: false,
        excludedImplantTypes: [],
        fleetBuffs: [],
        customFormula: undefined,
    };
}

/**
 * The optimizer inputs for one role's sim-rerank candidate.
 *
 * The own row is `role` equal to this ship's CONFIGURED role (`shipConfig.shipRole`, falling
 * back to the ship's type when that is null, i.e. Custom mode): it scores with whatever this
 * ship is actually configured to use today — identical to what "Find optimal gear" would run
 * for it right now.
 *
 * Any other role is a COMPARED role: it scores under THAT role's own built-in formula, not this
 * ship's configured priorities/set priorities/stat bonuses/custom formula — carrying those over
 * would score every compared role with the same formula, making the comparison pure optimizer
 * noise (#498). Inventory-eligibility and environment settings (algorithm,
 * ignoreEquipped/ignoreUnleveled, upgraded-stats, calibration handling, fleet buffs, arena
 * modifiers) still match the ship's own configuration, so the formula is the only axis that
 * differs between rows.
 */
export function buildSimRerankShipConfig(
    ship: Ship,
    role: ShipTypeName,
    shipConfig: AutogearShipConfig,
    activeSeason: ArenaSeason | null
): ShipOptimizerConfig {
    const configuredRole = shipConfig.shipRole ?? ship.type;
    const isOwnRole = role === configuredRole;
    const arenaModifiers =
        shipConfig.useArenaModifiers && activeSeason?.rules
            ? getMatchingModifiers(activeSeason.rules, ship.faction || '', ship.rarity || '', role)
            : null;

    return {
        shipRole: isOwnRole ? shipConfig.shipRole : role,
        statPriorities: isOwnRole ? shipConfig.statPriorities : [],
        setPriorities: isOwnRole ? shipConfig.setPriorities : [],
        statBonuses: isOwnRole ? shipConfig.statBonuses : [],
        tryToCompleteSets: isOwnRole ? shipConfig.tryToCompleteSets : false,
        customFormula: isOwnRole ? shipConfig.customFormula : undefined,
        ignoreEquipped: shipConfig.ignoreEquipped,
        ignoreUnleveled: shipConfig.ignoreUnleveled,
        useUpgradedStats: shipConfig.useUpgradedStats,
        selectedAlgorithm: shipConfig.selectedAlgorithm,
        optimizeImplants: shipConfig.optimizeImplants,
        includeCalibratedGear: shipConfig.includeCalibratedGear,
        assumeCalibrated: shipConfig.assumeCalibrated,
        excludedImplantTypes: shipConfig.excludedImplantTypes ?? [],
        fleetBuffs: shipConfig.fleetBuffs,
        arenaModifiers,
    };
}

/**
 * Owns the per-ship autogear/sim-rerank config map, the `getShipConfig`/`updateShipConfig`
 * accessors every caller reads and writes it through, and `buildSimRerankConfig`.
 *
 * `buildSimRerankConfig` is a plain function, not a memoised one: it must read `getShipConfig`'s
 * CURRENT closure over `shipConfigs` on every call. A `useCallback` version whose dependency list
 * omits `getShipConfig` (or any other value `getShipConfig` itself closes over) keeps returning
 * the function built at whichever render created the memo — silently scoring with whatever
 * `shipConfigs` held at that render, forever, regardless of what the user configures afterwards.
 * Pinned by `__tests__/useAutogearShipConfigs.test.ts`.
 */
export function useAutogearShipConfigs(
    getShipById: (id: string) => Ship | undefined,
    activeSeason: ArenaSeason | null
) {
    const [shipConfigs, setShipConfigs] = useState<Record<string, AutogearShipConfig>>({});

    const getShipConfig = (shipId: string): AutogearShipConfig => {
        const ship = getShipById(shipId);
        const defaultRole = ship?.type || 'ATTACKER';
        return shipConfigs[shipId] || defaultAutogearShipConfig(defaultRole);
    };

    const updateShipConfig = (shipId: string, updates: Partial<AutogearShipConfig>) => {
        setShipConfigs((prev) => ({
            ...prev,
            [shipId]: {
                ...getShipConfig(shipId),
                ...updates,
            },
        }));
    };

    const buildSimRerankConfig = (ship: Ship, role: ShipTypeName): ShipOptimizerConfig =>
        buildSimRerankShipConfig(ship, role, getShipConfig(ship.id), activeSeason);

    return { shipConfigs, getShipConfig, updateShipConfig, buildSimRerankConfig };
}

/**
 * Runs one ship through its configured autogear strategy: filters the shared inventory down to
 * what this ship may equip, builds the fast/slow scoring views from that one filtered list (see
 * `gearScoringInputs.ts` for why both views must come from the same source), and calls the
 * strategy's `findOptimalGear`.
 *
 * Every caller gets the same inventory-eligibility rules applied in the same order and the same
 * argument order forwarded to the strategy — a caller cannot special-case either without going
 * through `config`.
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
