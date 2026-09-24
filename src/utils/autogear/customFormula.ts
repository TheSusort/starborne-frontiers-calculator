import type { BaseStats, DerivedStatName, LimitableStat } from '../../types/stats';
import type {
    BasisTerm,
    CoreImportance,
    CustomFormula,
    CustomFormulaRow,
    RoleBasis,
} from '../../types/autogear';
import type { ShipTypeName } from '../../constants/shipTypes';
import {
    MULTIPLIER_NORMALIZERS,
    calculateCritMultiplier,
    calculateDirectDamage,
    calculateEffectiveHP,
    resolveBasisValue,
} from './statResolution';

/**
 * A row's basis, filtered to entries the scorer can honour. A stored row is untyped JSON and
 * reaches the scorer without passing through any form, so each entry is checked rather than
 * trusted — an unrecognised stat would resolve to 0 and silently delete a term, and a negative
 * weight would subtract one. Returns undefined when nothing survives, so the row falls back to
 * its own stat rather than scoring 0 for every candidate and tying the search.
 *
 * A basis TERM must name a raw `BaseStats` key. "Has a MULTIPLIER_NORMALIZERS entry" is the
 * WRONG predicate: that table also keys `directDamage` and `effectiveHp`, which `resolveBasisValue`
 * would read off the stat block as `undefined` and contribute as 0 — a term that silently
 * disappears. See `reference_total_record_is_compile_time_only`.
 */
const DERIVED_STATS: Record<DerivedStatName, true> = {
    // Total on purpose: a new derived stat must fail the build here rather than slip into a
    // basis and score as 0.
    effectiveHp: true,
    directDamage: true,
    critMultiplier: true,
};

/** Whether `stat` is a term the scorer can read a value for. Exported so the formula editor can
 *  offer only these stats in its basis-term picker, rather than letting a term be authored on
 *  `directDamage`/`effectiveHp` and silently dropped here at score time.
 *
 * `shield` is excluded too: it is a pool the kit generates (`deriveBasis`'s `STAT_ORDER` never
 * emits it), not a stat this scorer can read as a basis term — a `shield` term would score the
 * raw `shield` stat instead of the pool it names.
 *
 * Both lookups are own-property checks. A basis is untyped JSON reaching the scorer from a
 * shared or saved config (Security rule 5): `MULTIPLIER_NORMALIZERS['constructor']` and
 * `'constructor' in DERIVED_STATS` both resolve through the prototype chain rather than
 * `undefined`/`false`, so a `stat` named after an `Object.prototype` member must be rejected
 * explicitly rather than by accident. */
export const isBasisStat = (stat: LimitableStat): boolean =>
    Object.hasOwn(MULTIPLIER_NORMALIZERS, stat) &&
    !Object.hasOwn(DERIVED_STATS, stat) &&
    stat !== 'shield';

/**
 * A basis's terms, filtered to entries a scorer can honour. Shared by every basis-bearing path
 * (a formula row's `basis` here, a role's `roleBasis` in `priorityScore.ts`) so neither can drift
 * from the other's validation.
 *
 * An all-zero surviving set is rejected too, not only an empty one: `resolveBasisValue` sums
 * `stat * weight` over the terms, so a basis where every term weighs 0 resolves to 0 for every
 * candidate regardless of the candidate's own stats — the exact "scores 0 for everything and ties
 * the search" failure this validator exists to prevent, just reached through a weight of 0
 * instead of an absent term. A zero-weight term alongside a positive one is harmless (it
 * contributes nothing, the way an absent term would) and stays.
 */
export function usableBasisTerms(basis: BasisTerm[] | undefined): BasisTerm[] | undefined {
    if (!Array.isArray(basis)) return undefined;
    const kept = basis.filter(
        (t) => t && isBasisStat(t.stat) && Number.isFinite(t.weight) && t.weight >= 0
    );
    if (kept.length === 0) return undefined;
    return kept.some((t) => t.weight > 0) ? kept : undefined;
}

export function usableBasis(row: CustomFormulaRow): BasisTerm[] | undefined {
    if (row.kind !== 'core' || row.direction !== 'max') return undefined;
    return usableBasisTerms(row.basis);
}

// Total on purpose, mirroring `DERIVED_STATS` above: a `RoleBasis['produces']` member added
// without a matching entry here fails `tsc --noEmit` instead of a new axis silently passing
// sanitization as if it were a recognised one. Mirrors the compile-time tie
// `sharedAutogearBuild.ts` keeps against the same union for the share-schema path.
const ROLE_BASIS_PRODUCES: Record<RoleBasis['produces'], true> = {
    damage: true,
    repair: true,
    shield: true,
};

/**
 * A stored `roleBasis` sanitised at the trust boundary. Unlike a shared community build (Zod,
 * `sharedAutogearBuild.ts`), a `roleBasis` saved to localStorage or Supabase JSONB reaches its
 * readers as untyped JSON with no schema validation (Security rule 5) — a hand-edited or
 * corrupted record can carry a missing/non-array `terms`, a non-finite or negative `weight`, or
 * a `produces` that names no real axis.
 *
 * Returns undefined unless `produces` is a real `RoleBasis['produces']` member (`Object.hasOwn`
 * against `ROLE_BASIS_PRODUCES`, an own-property check for the same prototype-chain reason
 * `isBasisStat` gives) and at least one term survives `usableBasisTerms` — the same predicate a
 * formula row's `basis` is filtered through, so a `roleBasis` this function admits can never be
 * one the scorer would treat differently. Every reader of a possibly-stored `roleBasis`
 * (`roleBasisKeyPart`, `OffFormulaNotice`'s applied-terms render) calls this once rather than
 * re-deriving its own shape check, so "no usable roleBasis" has one definition.
 */
export function sanitizeRoleBasis(value: unknown): RoleBasis | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const { produces, terms } = value as { produces?: unknown; terms?: unknown };
    if (typeof produces !== 'string' || !Object.hasOwn(ROLE_BASIS_PRODUCES, produces)) {
        return undefined;
    }
    const usableTerms = usableBasisTerms(terms as BasisTerm[] | undefined);
    if (!usableTerms) return undefined;
    return { produces: produces as RoleBasis['produces'], terms: usableTerms };
}

/** Whether a basis on this row's own stat is a tilt rather than a transcription. `effectiveHp`
 *  is the one case: `calculateEffectiveHP` already runs Defence through the mitigation curve on
 *  its own real value, so a Defence term in that basis is a deliberate skew on top of that, not
 *  a number copied from the ship's kit. Every other row (including `directDamage` and a plain
 *  stat like `hp`) reads its basis as the kit's own equation. */
export const isBasisTilt = (stat: LimitableStat): boolean => stat === 'effectiveHp';

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
    const basis = usableBasis(row);
    // A basis is honoured on ANY max core row, not only a derived one. SUPPORTER's core is
    // `core('hp')` — a plain stat — and Howler's and Makoli's whole fix is a basis on that row,
    // so routing only the two derived stats would make Apply a silent no-op for them.
    //
    // `critMultiplier` is the exception: it has no primary factor for a basis to blend (it is
    // `1 + min(crit,100)/100 x critDamage/100`, not a weighted sum of one dominant stat), so a
    // basis on this row is ignored rather than given a made-up meaning.
    const raw =
        row.stat === 'directDamage'
            ? calculateDirectDamage(stats, basis)
            : row.stat === 'effectiveHp'
              ? calculateEffectiveHP(
                    stats.hp,
                    stats.defence,
                    stats.damageReduction ?? 0,
                    basis,
                    stats
                )
              : row.stat === 'critMultiplier'
                ? calculateCritMultiplier(stats)
                : resolveBasisValue(stats, basis, row.stat);
    const n = raw / normalizer;
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
    'critMultiplier',
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
