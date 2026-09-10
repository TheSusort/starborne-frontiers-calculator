import type { BaseStats, LimitableStat } from '../../types/stats';
import type { CoreImportance, CustomFormula, CustomFormulaRow } from '../../types/autogear';
import type { ShipTypeName } from '../../constants/shipTypes';
import { MULTIPLIER_NORMALIZERS, resolveLimitStatValue } from './statResolution';

/**
 * One row's contribution, normalized so rows on different stats are comparable.
 *
 * A maximized term is `value / normalizer` and is 0 when the stat is 0 — which zeroes
 * the whole core product. That is the product semantics on purpose (a lopsided build
 * must lose), and it is why a stat that can be 0 at base belongs in a bonus row.
 *
 * A minimized term is `1 / (1 + value / normalizer)`: bounded to (0, 1], falling as the
 * stat rises, and never 0. The normalizer is the half-point — at `value === normalizer`
 * the term is exactly 0.5 — so for this direction the constant is a real parameter, not
 * the cosmetic scale factor it is for a maximized term.
 */
export function formulaRowTerm(stats: BaseStats, row: CustomFormulaRow): number {
    const normalizer = MULTIPLIER_NORMALIZERS[row.stat] || 1;
    const n = resolveLimitStatValue(stats, row.stat) / normalizer;
    return row.direction === 'min' ? 1 / (1 + n) : n;
}

export function isFormulaEmpty(formula: CustomFormula | undefined): boolean {
    return !formula || formula.rows.length === 0;
}

/**
 * The stats a formula row may name, in picker order. Owned here rather than by the form
 * because the constraint is the scorer's: every entry needs a `MULTIPLIER_NORMALIZERS`
 * value, or its term reads as the raw stat value and one row decides the ranking.
 * `customFormulaStats.test.ts` holds that. `hpRegen` is absent deliberately — it is
 * planner-internal and never shown to players.
 */
export const FORMULA_STATS: readonly LimitableStat[] = [
    'attack',
    'defence',
    'hp',
    'effectiveHp',
    'directDamage',
    'speed',
    'crit',
    'critDamage',
    'hacking',
    'security',
    'healModifier',
    'shield',
];

/** The exponents a core row may carry, in the order the picker offers them. */
export const CORE_IMPORTANCES: readonly CoreImportance[] = [0.5, 1, 2];

/** The weight a bonus row carries when it does not name one. */
export const DEFAULT_BONUS_WEIGHT = 100;

/*
 * A row's own types gate authoring, not input. A stored config is untyped JSON, and a row
 * read back from one reaches the scorer without passing through any form — so every field
 * below is normalized here rather than trusted. Each bad value would corrupt the score
 * silently instead of failing, which is worse than a wrong answer that announces itself.
 */

/**
 * A core row's exponent. `0` would collapse every core term to 1 so the core rows stop
 * counting, a negative inverts the row's direction, and a non-finite drives the product to
 * 0 or Infinity. Anything unrecognised reads as Normal.
 */
export function coreImportanceOf(row: CustomFormulaRow): CoreImportance {
    const declared = row.importance;
    return declared !== undefined && CORE_IMPORTANCES.includes(declared) ? declared : 1;
}

/**
 * A bonus row's weight. An absent weight takes the default, because the author never named
 * one. A present but negative or non-finite weight is corrupt for that row, so the row
 * contributes nothing — matching the form, which refuses to save such a row at all, and
 * unlike a default of 100 it cannot turn a stored negative into full positive weight.
 */
export function bonusWeightOf(row: CustomFormulaRow): number {
    const declared = row.percentage;
    if (declared === undefined) return DEFAULT_BONUS_WEIGHT;
    return Number.isFinite(declared) && declared >= 0 ? declared : 0;
}

/**
 * Whether the scorer can honour this row as written. Every field is checked, because a
 * stored row that fails one of them would otherwise be scored under a meaning its author
 * never expressed: an unrecognised `kind` reads as a bonus row and an unrecognised
 * `direction` as maximize, both by falling through their comparisons, and a stat with no
 * normalizer falls back to 1 so its term reads as the raw value — orders of magnitude off
 * every other row. An unusable row is skipped instead.
 *
 * `customFormulaStats.test.ts` keeps every stat the picker offers out of this branch, so
 * no formula built through the UI has a row that fails here.
 */
function isUsableRow(row: CustomFormulaRow): boolean {
    if (MULTIPLIER_NORMALIZERS[row.stat] === undefined) return false;
    if (row.kind !== 'core' && row.kind !== 'bonus') return false;
    return row.direction === 'max' || row.direction === 'min';
}

/** Whether any row of this formula is one the scorer can honour. */
export function formulaHasUsableRow(formula: CustomFormula | undefined): boolean {
    return !!formula && formula.rows.some(isUsableRow);
}

/** The two config fields that decide whether a ship can be scored at all. */
export interface ScorabilityConfig {
    shipRole: ShipTypeName | null;
    customFormula?: CustomFormula;
}

/**
 * Splits ships into those a run can score and those it cannot. A ship is unscoreable in
 * Custom mode (`shipRole` null) when no row of its formula is one the scorer can honour —
 * whether the formula is empty or every row fails `isUsableRow`. Either way each gear
 * combination scores the same constant and they all tie, so the optimizer would hand back
 * arbitrary gear as a result.
 */
export function partitionScoreableShips<T extends { id: string }>(
    ships: T[],
    getConfig: (shipId: string) => ScorabilityConfig
): { scoreable: T[]; unscoreable: T[] } {
    const scoreable: T[] = [];
    const unscoreable: T[] = [];

    for (const ship of ships) {
        const config = getConfig(ship.id);
        if (!config.shipRole && !formulaHasUsableRow(config.customFormula)) {
            unscoreable.push(ship);
        } else {
            scoreable.push(ship);
        }
    }

    return { scoreable, unscoreable };
}

/**
 * Base score for a Custom role: core rows multiply, bonus rows add.
 *
 *   score = Π core term^importance × (1 + Σ bonus (percentage/100) × term)
 *
 * The empty core product is 1, so a bonus-only formula still scores. An empty formula
 * scores 0 — the caller is expected to have blocked the run before that (`isFormulaEmpty`),
 * because a 0 for every candidate ties the whole search.
 */
export function customFormulaScore(stats: BaseStats, formula: CustomFormula | undefined): number {
    if (isFormulaEmpty(formula)) return 0;

    let product = 1;
    let bonusSum = 0;

    for (const row of formula!.rows) {
        if (!isUsableRow(row)) continue;
        const term = formulaRowTerm(stats, row);
        if (row.kind === 'core') {
            const importance = coreImportanceOf(row);
            product *= importance === 1 ? term : Math.pow(term, importance);
        } else {
            bonusSum += (bonusWeightOf(row) / 100) * term;
        }
    }

    return product * (1 + bonusSum);
}
