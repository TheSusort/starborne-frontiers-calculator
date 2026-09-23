import type { LimitableStat } from '../../types/stats';
import type { BasisTerm } from '../../types/autogear';
import { getLimitStatLabel } from '../../constants/stats';
import { FORMULA_STATS, isBasisStat } from '../../utils/autogear/customFormula';

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
