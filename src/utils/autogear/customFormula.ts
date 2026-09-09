import type { BaseStats } from '../../types/stats';
import type { CustomFormula, CustomFormulaRow } from '../../types/autogear';
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

/** The two config fields that decide whether a ship can be scored at all. */
export interface ScorabilityConfig {
    shipRole: ShipTypeName | null;
    customFormula?: CustomFormula;
}

/**
 * Splits ships into those a run can score and those it cannot. A ship is unscoreable
 * only in Custom mode (`shipRole` null) with an empty formula — every gear combination
 * would score 0 and tie, so the optimizer would return arbitrary gear (`isFormulaEmpty`).
 */
export function partitionScoreableShips<T extends { id: string }>(
    ships: T[],
    getConfig: (shipId: string) => ScorabilityConfig
): { scoreable: T[]; unscoreable: T[] } {
    const scoreable: T[] = [];
    const unscoreable: T[] = [];

    for (const ship of ships) {
        const config = getConfig(ship.id);
        if (!config.shipRole && isFormulaEmpty(config.customFormula)) {
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
        const term = formulaRowTerm(stats, row);
        if (row.kind === 'core') {
            const importance = row.importance ?? 1;
            product *= importance === 1 ? term : Math.pow(term, importance);
        } else {
            bonusSum += ((row.percentage ?? 100) / 100) * term;
        }
    }

    return product * (1 + bonusSum);
}
