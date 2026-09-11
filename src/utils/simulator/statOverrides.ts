import type { combatStatsFromShip } from '../ship/combatStats';

/** The stat block the simulator page resolves per placement (gear + refits + implants +
 *  engineering) and hands the engine as `BattlePlacement.statOverrides`. */
export type ResolvedCombatStats = ReturnType<typeof combatStatsFromShip>;

/** The stats a user may temporarily override in the simulator. Must stay identical to the keys
 *  `combatStatsFromShip` emits — `OverridableCoversResolved` fails the type check if it drifts. */
export const OVERRIDABLE_STATS = [
    'attack',
    'crit',
    'critDamage',
    'defensePenetration',
    'shieldPenetration',
    'hacking',
    'security',
    'defence',
    'hp',
    'healModifier',
    'speed',
] as const;

export type OverridableStat = (typeof OVERRIDABLE_STATS)[number];

/** Sparse by design: a stat absent here carries no override and resolves from gear. */
export type StatOverrides = Partial<Record<OverridableStat, number>>;

/** Compile-time drift tripwire. Assigning `true` to this type fails `tsc --noEmit` the moment
 *  `OVERRIDABLE_STATS` and `ResolvedCombatStats` stop covering each other, in either direction.
 *  Asserted in `statOverrides.test.ts`. */
export type OverridableCoversResolved = [
    Exclude<keyof ResolvedCombatStats, OverridableStat>,
    Exclude<OverridableStat, keyof ResolvedCombatStats>,
] extends [never, never]
    ? true
    : never;

/** Per-stat lower bound. Defaults to 0; `hp` is 1 because an actor built at 0 HP starts the
 *  fight on the engine's corpse path. */
export const OVERRIDE_MIN: Partial<Record<OverridableStat, number>> = { hp: 1 };

/**
 * Turn a typed value into a stored override, or `undefined` meaning "no override for this stat".
 *
 * A value equal to the resolved base is not an override — storing it would make the
 * override badge and the configuration diff report a change that does not exist.
 *
 * A non-finite or below-floor value is refused rather than clamped: `statOverrides` flows
 * straight into the engine, where a NaN produces NaN damage with no error.
 */
export function normalizeOverride(
    stat: OverridableStat,
    value: number | undefined,
    base: number
): number | undefined {
    if (value === undefined || !Number.isFinite(value)) return undefined;
    const rounded = Math.round(value);
    if (rounded < (OVERRIDE_MIN[stat] ?? 0)) return undefined;
    return rounded === base ? undefined : rounded;
}

/** Compose overrides onto a resolved block. Overrides win field-by-field and sit AFTER gear,
 *  refits, implants and engineering, so they cannot express a set bonus or anything conditional. */
export function applyStatOverrides(
    base: ResolvedCombatStats,
    overrides?: StatOverrides
): ResolvedCombatStats {
    return overrides ? { ...base, ...overrides } : base;
}

export function hasAnyOverride(overrides?: StatOverrides): boolean {
    return !!overrides && Object.keys(overrides).length > 0;
}
