import type { LimitableStat } from '../../types/stats';
import type { BasisTerm } from '../../types/autogear';
import { getLimitStatLabel } from '../../constants/stats';
import { FORMULA_STATS, isBasisStat } from '../../utils/autogear/customFormula';
import {
    MAX_BASIS_TERMS,
    MAX_NUMBER_MAGNITUDE,
    MIN_NUMBER_MAGNITUDE,
} from '../../schemas/sharedAutogearBuild';

// Non-component values shared by every basis-term editor, kept in a plain module so importing
// them can't be exported without tripping `react-refresh/only-export-components` on the
// component file (`BasisTermsEditor.tsx`).

/** A term's stat picker offers only what `usableBasisTerms` can honour — never `directDamage` or
 *  `effectiveHp`, which the scorer reads off the stat block as `undefined` and drops. */
export const BASIS_STAT_OPTIONS = FORMULA_STATS.filter(isBasisStat).map((s) => ({
    value: s,
    label: getLimitStatLabel(s),
}));

/** A term's weight kept as a string while being edited, so a field can sit empty or mid-edit
 *  without forcing a number. */
export interface DraftBasisTerm {
    stat: LimitableStat;
    weight: string;
}

export const draftFromBasis = (basis?: BasisTerm[]): DraftBasisTerm[] =>
    (basis ?? []).map((t) => ({ stat: t.stat, weight: String(t.weight) }));

/** The stat a newly-added term should default to: the first basis stat not already named by an
 *  existing term, so adding a term never starts on a duplicate. */
export const nextBasisStat = (terms: DraftBasisTerm[]): LimitableStat => {
    const used = new Set(terms.map((t) => t.stat));
    const nextOption = BASIS_STAT_OPTIONS.find((o) => !used.has(o.value));
    return nextOption?.value ?? BASIS_STAT_OPTIONS[0].value;
};

/**
 * The ONE authoring gate both basis-term editors (`OffFormulaNotice`'s applied-equation editor,
 * `CustomFormulaForm`'s row basis) call before saving a draft. Returns an error message for the
 * first defect found, or `null` when `terms` is empty (a basis is optional on a formula row —
 * the caller decides whether that's acceptable, e.g. `OffFormulaNotice` refuses an empty draft
 * itself since ITS basis is mandatory) or every term is authorable and the set is within the
 * share schema's own caps (`MAX_BASIS_TERMS`, `MAX_NUMBER_MAGNITUDE`, `MIN_NUMBER_MAGNITUDE` —
 * `sharedAutogearBuild.ts`, reused rather than copied so a saved equation can never then fail to
 * share with a generic error).
 *
 * AUTHORING is stricter than the scorer's own read-time gate, `usableBasisTerms`
 * (customFormula.ts), which keeps a zero-weight term (`weight >= 0`) since it is harmless once
 * stored — `resolveBasisValue` SUMS the terms, so a zero-weight term alongside a positive one
 * just contributes nothing, the way an absent term would. A term a player is actively typing is
 * different: a blank or zero weight there almost always means an unfilled field, not a
 * deliberate zero, so a fresh save refuses it here instead of silently storing a term that does
 * nothing.
 */
export const basisAuthoringError = (terms: DraftBasisTerm[]): string | null => {
    if (terms.length === 0) return null;
    if (terms.length > MAX_BASIS_TERMS) {
        return `An equation can have at most ${MAX_BASIS_TERMS} stats.`;
    }
    for (const term of terms) {
        const weight = Number(term.weight.trim());
        if (!isBasisStat(term.stat) || !Number.isFinite(weight) || weight <= 0) {
            return 'Every stat needs a weight above zero. Remove a stat instead of leaving it blank or at 0.';
        }
        if (weight > MAX_NUMBER_MAGNITUDE || weight < MIN_NUMBER_MAGNITUDE) {
            return 'This weight is too large or too small to save.';
        }
    }
    return null;
};

/** `terms` converted to `BasisTerm[]`, once `basisAuthoringError(terms)` has already returned
 *  `null` — every weight is guaranteed to parse as a finite, positive number at that point. */
export const parseAuthoredBasisTerms = (terms: DraftBasisTerm[]): BasisTerm[] =>
    terms.map((t) => ({ stat: t.stat, weight: Number(t.weight.trim()) }));
