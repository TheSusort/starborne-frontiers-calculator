import { GEAR_SETS, type GearSetName } from '../../constants/gearSets';
import { GEAR_SLOTS, type GearSlotName } from '../../constants/gearTypes';
import { isShipTypeName, type ShipTypeName } from '../../constants/shipTypes';
import { ALL_STAT_NAMES, STATS } from '../../constants/stats';
import { SUBSTAT_RANGES } from '../../constants/statValues';
import type { SavedAutogearConfig, BasisTerm } from '../../types/autogear';
import type { Ship } from '../../types/ship';
import type { LimitableStat, StatName, StatType } from '../../types/stats';
import type { WishlistEntry } from '../../types/wishlist';
import { CUSTOM_FORMULA_SEEDS } from '../autogear/customFormulaSeeds';
import { usableBasisTerms } from '../autogear/customFormula';
import { deriveBasis } from '../autogear/offFormula/basisDerivation';
import { detectOffFormulaStats } from '../autogear/offFormula/offFormulaStats';
import { hostedBasisTerms, roleAxis, rolePrimaryStat } from '../autogear/offFormula/roleBasisHost';
import { WISHLIST_NAME_MAX_LENGTH } from './describeWishlistEntry';
import { MAX_GEAR_SUBSTATS } from './matchWishlistEntry';

export type WishlistDraft = Omit<WishlistEntry, 'id'>;

export const TOP_ROW_SLOTS: readonly GearSlotName[] = ['weapon', 'hull', 'generator'];
export const BOTTOM_ROW_SLOTS: readonly GearSlotName[] = ['sensor', 'software', 'thrusters'];

/** The real stats a derived autogear stat is built from. */
const DERIVED_EXPANSION: Partial<Record<LimitableStat, StatName[]>> = {
    directDamage: ['attack', 'crit', 'critDamage', 'defensePenetration'],
    effectiveHp: ['hp', 'defence'],
    critMultiplier: ['crit', 'critDamage'],
};

const expand = (stat: LimitableStat): StatName[] =>
    DERIVED_EXPANSION[stat] ?? (Object.hasOwn(STATS, stat) ? [stat as StatName] : []);

/** Stats gear can roll as a substat: the stats `SUBSTAT_RANGES` has value ranges for. */
const isRollableSubstat = (name: StatName): boolean => Object.hasOwn(SUBSTAT_RANGES, name);

/** hp, attack and defence are hunted as percentages; every other stat has one rollable type. */
function wishlistStatType(name: StatName): StatType {
    if (name === 'hp' || name === 'attack' || name === 'defence') return 'percentage';
    return STATS[name].allowedTypes.find((type) => STATS[name].maxValue[type] > 0) ?? 'percentage';
}

const inStatOrder = (names: Set<StatName>): StatName[] =>
    ALL_STAT_NAMES.filter((name) => names.has(name));

function formulaRole(ship: Ship, config: SavedAutogearConfig | null): ShipTypeName | null {
    const role = config?.shipRole ?? ship.type;
    return role && isShipTypeName(role) ? role : null;
}

/**
 * The kit equation `OffFormulaNotice` offers for `role` (its "Use this equation" terms): the
 * ship's derived basis on the axis `role` hosts, when the detector flags an effect on that axis.
 */
function detectedBasisTerms(ship: Ship, role: ShipTypeName): BasisTerm[] | undefined {
    const axis = roleAxis(role);
    if (!axis) return undefined;
    if (!detectOffFormulaStats(ship, role).some((f) => f.produces === axis)) return undefined;
    return usableBasisTerms(deriveBasis(ship, axis).terms);
}

/**
 * The stats the ship's scoring formula maximises, derived stats expanded, chosen the way
 * `calculatePriorityScore` picks its formula: a config in Custom mode (`shipRole: null`) scores on
 * its custom formula's `direction: 'max'` rows plus their basis-term stats; otherwise the role
 * scores on its own formula (the role seed's rows here), with a kit basis replacing the role's
 * primary stat by the basis-term stats: the applied one (`hostedBasisTerms`), else the one the
 * autogear page offers but the player has not applied (`detectedBasisTerms`), since the kit wants
 * those stats either way. Includes stats
 * gear cannot roll as substats (they still pick sets).
 */
export function formulaStats(ship: Ship, config: SavedAutogearConfig | null): StatName[] {
    const stats = new Set<StatName>();
    if (config && config.shipRole === null) {
        for (const row of config.customFormula?.rows ?? []) {
            if (row.direction !== 'max') continue;
            expand(row.stat).forEach((s) => stats.add(s));
            row.basis?.forEach((term) => expand(term.stat).forEach((s) => stats.add(s)));
        }
        return inStatOrder(stats);
    }
    const role = formulaRole(ship, config);
    if (!role) return [];
    for (const row of CUSTOM_FORMULA_SEEDS[role].rows) {
        if (row.direction === 'max') expand(row.stat).forEach((s) => stats.add(s));
    }
    const basis = hostedBasisTerms(role, config?.roleBasis) ?? detectedBasisTerms(ship, role);
    const primary = rolePrimaryStat(role);
    if (basis && primary) {
        stats.delete(primary);
        basis.forEach((term) => expand(term.stat).forEach((s) => stats.add(s)));
    }
    return inStatOrder(stats);
}

/** Formula stats plus the stats the config's stat priorities and stat bonuses name, expanded. */
function focusStats(ship: Ship, config: SavedAutogearConfig | null): StatName[] {
    const stats = new Set<StatName>(formulaStats(ship, config));
    config?.statPriorities.forEach((p) => expand(p.stat).forEach((s) => stats.add(s)));
    config?.statBonuses.forEach((b) => expand(b.stat).forEach((s) => stats.add(s)));
    return inStatOrder(stats);
}

/**
 * The substats a generated entry hunts: `focusStats`, keeping only stats gear can roll as
 * substats (`hpRegen` and `shieldPenetration` never are).
 */
export function wantedStats(ship: Ship, config: SavedAutogearConfig | null): StatName[] {
    return focusStats(ship, config).filter(isRollableSubstat);
}

const GEAR_SET_KEYS = Object.keys(GEAR_SETS) as (keyof typeof GEAR_SETS)[];

/**
 * The gear sets a generated entry accepts: the config's gear set priorities (implant priorities
 * and unknown names dropped), then every gear set with a stat bonus on one of `focusStats` (the
 * formula, stat priorities and stat bonuses). An effect-only set comes only from a set priority.
 * A set priority with `count: 0` excludes that set, as it does in autogear (`runShipOptimizer`),
 * so neither path adds it.
 */
export function wantedSets(ship: Ship, config: SavedAutogearConfig | null): GearSetName[] {
    const gearPriorities = (config?.setPriorities ?? []).filter((p) => p.kind !== 'implant');
    const excluded = new Set(gearPriorities.filter((p) => p.count === 0).map((p) => p.setName));
    const sets = new Set<GearSetName>();
    for (const priority of gearPriorities) {
        if (excluded.has(priority.setName)) continue;
        if (Object.hasOwn(GEAR_SETS, priority.setName)) {
            sets.add(priority.setName as GearSetName);
        }
    }
    const focus = new Set(focusStats(ship, config));
    for (const key of GEAR_SET_KEYS) {
        const bonusStats = GEAR_SETS[key].stats as readonly { name: StatName }[];
        if (!excluded.has(key) && bonusStats.some((s) => focus.has(s.name))) sets.add(key);
    }
    return [...sets];
}

export interface BuildEntriesOptions {
    /** How many of the wanted substats a piece needs. Clamped to 1..min(count,
     *  `MAX_GEAR_SUBSTATS`); that upper bound when omitted. */
    subStatsMin?: number;
    /** The sets to accept; `wantedSets` when omitted. No set filter when empty. */
    sets?: readonly GearSetName[];
}

/**
 * Two wishlist entries for a ship from its saved autogear config (`null`: the ship's role
 * defaults): the top row (weapon, hull, generator) with no main-stat filter, and the bottom row
 * (sensor, software, thrusters) whose main stat must be a wanted stat one of those slots rolls.
 * Both target the ship, sit in a group named after it and are marked `source: 'autogear'`.
 */
export function buildEntriesFromAutogearConfig(
    ship: Ship,
    config: SavedAutogearConfig | null,
    options: BuildEntriesOptions = {}
): { top: WishlistDraft; bottom: WishlistDraft } {
    const stats = wantedStats(ship, config);
    const sets = options.sets ?? wantedSets(ship, config);
    const most = Math.min(stats.length, MAX_GEAR_SUBSTATS);
    const min = Math.max(1, Math.min(most, options.subStatsMin ?? most));

    const shared: WishlistEntry['filters'] = {
        ...(sets.length > 0 ? { setBonus: [...sets] } : {}),
        ...(stats.length > 0
            ? {
                  subStats: stats.map((name) => ({ name, type: wishlistStatType(name) })),
                  ...(min < stats.length ? { subStatsMin: min } : {}),
              }
            : {}),
    };

    const bottomMainStats = stats.filter((name) =>
        BOTTOM_ROW_SLOTS.some((slot) =>
            (GEAR_SLOTS[slot].availableMainStats as readonly StatName[]).includes(name)
        )
    );

    const base = {
        target: { kind: 'ship', shipId: ship.id } as const,
        group: ship.name.slice(0, WISHLIST_NAME_MAX_LENGTH),
        source: 'autogear' as const,
    };
    const name = (row: string) => `${ship.name}: ${row}`.slice(0, WISHLIST_NAME_MAX_LENGTH);

    return {
        top: {
            ...base,
            name: name('Weapon, Hull, Generator'),
            filters: { slot: [...TOP_ROW_SLOTS], ...shared },
        },
        bottom: {
            ...base,
            name: name('Sensor, Software, Thrusters'),
            filters: {
                slot: [...BOTTOM_ROW_SLOTS],
                ...(bottomMainStats.length > 0
                    ? {
                          mainStat: bottomMainStats.map((n) => ({
                              name: n,
                              type: wishlistStatType(n),
                          })),
                      }
                    : {}),
                ...shared,
            },
        },
    };
}
