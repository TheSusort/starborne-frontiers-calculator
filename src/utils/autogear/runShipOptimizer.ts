import { useState } from 'react';
import type { Ship } from '../../types/ship';
import type { GearPiece } from '../../types/gear';
import type {
    StatPriority,
    SetPriority,
    StatBonus,
    FleetBuff,
    CustomFormula,
    RoleBasis,
} from '../../types/autogear';
import type { ShipTypeName } from '../../constants/shipTypes';
import type { EngineeringStat, LimitableStat } from '../../types/stats';
import type { ArenaSeason } from '../../types/arena';
import { shipFinalStats } from '../ship/combatStats';
import { AutogearAlgorithm, type AutogearProgress, type AutogearResult } from './AutogearStrategy';
import { getAutogearStrategy } from './getStrategy';
import { buildGearScoringInputs } from './gearScoringInputs';
import { filterTopImplantsPerSlot } from './implantFilter';
import { getMatchingModifiers } from './arenaModifiers';
import { clearScoreCache } from './scoring';
import { resolveLimitStatValue } from './priorityScore';
import { applySuggestionsToShip } from './simRerank/candidateShip';
import { statBoundsFromInventory, type StatBounds } from './simRerank/statBounds';

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
    /** A transcription of the ship's own kit, carried to every scored role regardless of whose
     *  row this is — see `buildSimRerankShipConfig`'s doc comment for why it is not blanked the
     *  way `statPriorities`/`customFormula` are. */
    roleBasis?: RoleBasis;
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
    /** A transcription of the ship's own kit (`deriveBasis`), not a player preference — see
     *  `buildSimRerankShipConfig`'s doc comment for how this differs from every other field here. */
    roleBasis?: RoleBasis;
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
        roleBasis: undefined,
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
 *
 * `roleBasis` is carried to EVERY row unblanked, own or compared: it transcribes what the
 * ship's kit actually does (`deriveBasis`), not a player preference the way `statPriorities` or
 * `customFormula` is, so there is no "this role's own choice" to withhold from a compared role.
 * The scorer itself decides where it lands — `roleHostsBasis` applies it only when the compared
 * role's axis matches `roleBasis.produces`, so an ATTACKER's damage basis reaches a compared
 * DEBUFFER row (both damage) and is silently ignored by a compared SUPPORTER row (repair).
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
        roleBasis: shipConfig.roleBasis,
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
 * The pieces one ship's optimizer pass may draw from: the shared inventory narrowed by every
 * eligibility rule `config` expresses — implant handling, gear already claimed by an earlier
 * ship in the batch, excluded sets, calibration, equipped-elsewhere and unleveled gear.
 *
 * Exported because anything reasoning about what a run CAN reach — the off-formula tuning run's
 * stat bounds, for one — has to ask the same question of the same pool. A caller filtering the
 * raw inventory itself would bound the search over gear the run cannot use.
 */
export function availableInventoryForShip(
    ship: Ship,
    config: ShipOptimizerConfig,
    deps: Pick<ShipOptimizerDeps, 'inventory' | 'usedGearIds' | 'gearToShipMap' | 'getShipById'>
): GearPiece[] {
    const { inventory, usedGearIds, gearToShipMap, getShipById } = deps;

    return inventory
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
}

/**
 * Runs one ship through its configured autogear strategy: narrows the shared inventory through
 * {@link availableInventoryForShip}, builds the fast/slow scoring views from that one filtered
 * list (see `gearScoringInputs.ts` for why both views must come from the same source), and calls
 * the strategy's `findOptimalGear`.
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
    const { getGearPiece, upgradedGearGetter, getEngineeringStatsForShipType, onProgress } = deps;

    const availableInventory = availableInventoryForShip(ship, config, deps);

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

/**
 * The optimizer config for one off-formula-tuning pass over `stat`: the ship's own
 * configured-role formula (via `buildSimRerankShipConfig`'s own-role branch — this tuning run
 * never compares roles, only bands one stat inside the role the ship already scores under),
 * plus `statConstraint` (a band's soft preference on `stat` — see `bandPriorities`), with the
 * algorithm forced to Genetic regardless of what the player has selected: Genetic is the
 * strategy that produces meaningful results, and a measurement run must not report numbers that
 * depend on which algorithm the player happens to have chosen elsewhere.
 *
 * Drops any of the ship's own priorities on `stat` before appending `statConstraint`: two
 * priorities on the same stat would fight each other, and the tuning run's whole premise is
 * that THIS pass's bound on `stat` is authoritative.
 */
export function buildOffFormulaTuningConfig(
    ship: Ship,
    shipConfig: AutogearShipConfig,
    activeSeason: ArenaSeason | null,
    stat: LimitableStat,
    statConstraint: StatPriority[]
): ShipOptimizerConfig {
    const configuredRole = shipConfig.shipRole ?? ship.type;
    const base = buildSimRerankShipConfig(ship, configuredRole, shipConfig, activeSeason);
    return {
        ...base,
        selectedAlgorithm: AutogearAlgorithm.Genetic,
        statPriorities: [
            ...base.statPriorities.filter((priority) => priority.stat !== stat),
            ...statConstraint,
        ],
    };
}

export interface OffFormulaTuningPassResult {
    suggestions: AutogearResult['suggestions'];
    /** The value `stat` actually resolves to on the ship wearing `suggestions`, read through
     *  this run's own `getGearForShip` (not the raw `getGearPiece`) — the same rule
     *  `ShipOptimizerRun.getGearForShip` documents for any post-run stat read. */
    landed: number;
}

/**
 * Run one off-formula-tuning optimizer pass and report the tuned stat's landed value.
 *
 * Clears the shared score cache first: `calculateTotalScore`'s cache key does not include
 * `statPriorities` (only equipment/role/bonuses/arena/fleet/formula), so back-to-back passes
 * for the same ship under the same role but a DIFFERENT `stat` constraint — exactly what a
 * tuning run's probes and bands are — would otherwise read stale scores left by the previous
 * pass's constraint. `runAutogearFor` in `AutogearPage.tsx` clears the same cache for the same
 * reason.
 */
export async function runOffFormulaTuningPass(
    ship: Ship,
    config: ShipOptimizerConfig,
    deps: ShipOptimizerDeps,
    stat: LimitableStat
): Promise<OffFormulaTuningPassResult> {
    clearScoreCache();
    const run = await findOptimalGearForShip(ship, config, deps);
    const built = applySuggestionsToShip(ship, run.result.suggestions);
    const finalStats = shipFinalStats(built, {
        getGearPiece: run.getGearForShip,
        getEngineeringStatsForShipType: deps.getEngineeringStatsForShipType,
    });
    return { suggestions: run.result.suggestions, landed: resolveLimitStatValue(finalStats, stat) };
}

/**
 * The achievable range of `stat` for one off-formula-tuning run.
 *
 * Reads the bound off the pool `config` makes this ship eligible for, through the SAME gear
 * getter the run will score with — a bound computed from the raw inventory, or from unwrapped
 * pieces, would describe gear the run cannot equip or stats it will not see. See
 * `statBoundsFromInventory` for what the bound does and does not account for.
 */
export function offFormulaStatBounds(
    ship: Ship,
    config: ShipOptimizerConfig,
    deps: ShipOptimizerDeps,
    stat: LimitableStat
): StatBounds {
    const availableInventory = availableInventoryForShip(ship, config, deps);
    const { getGearForShip } = buildGearScoringInputs({
        availableInventory,
        getGearPiece: deps.getGearPiece,
        upgradedGearGetter: deps.upgradedGearGetter,
        useUpgradedStats: config.useUpgradedStats,
        assumeCalibrated: config.assumeCalibrated,
    });
    return statBoundsFromInventory({
        ship,
        availableInventory,
        stat,
        deps: {
            getGearPiece: getGearForShip,
            getEngineeringStatsForShipType: deps.getEngineeringStatsForShipType,
        },
    });
}
