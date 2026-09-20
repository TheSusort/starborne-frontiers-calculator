import React, { useMemo } from 'react';
import type { Ship } from '../../types/ship';
import { type ShipTypeName, SHIP_TYPES } from '../../constants/shipTypes';
import {
    detectOffFormulaStats,
    type OffFormulaFinding,
    type OffFormulaStat,
} from '../../utils/autogear/simRerank/offFormulaStats';
import {
    deriveBasis,
    triggerProse,
    KNOWN_CADENCE_TRIGGERS,
    type DerivedBasis,
    type ExcludedCarrier,
} from '../../utils/autogear/simRerank/basisDerivation';
import { CUSTOM_FORMULA_SEEDS } from '../../utils/autogear/customFormulaSeeds';
import type { CombatStatsDeps } from '../../utils/ship/combatStats';
import type { LimitableStat } from '../../types/stats';
import type { GearSuggestion, StatPriority } from '../../types/autogear';
import type { StatBounds } from '../../utils/autogear/simRerank/statBounds';

/** `AutogearSettings` and `AutogearSettingsModal` still declare an `offFormulaTuning` prop of
 *  this shape and thread it down to where `OffFormulaNotice` used to take it. This component no
 *  longer reads it; the type stays exported so those two files' prop declarations keep resolving. */
export interface OffFormulaTuningDeps {
    deps: CombatStatsDeps;
    runOptimizer: (
        stat: LimitableStat,
        priorities: StatPriority[]
    ) => Promise<{ suggestions: GearSuggestion[]; landed: number }>;
    /** The achievable range of `stat` over the pool this ship's run draws from. */
    statBounds: (stat: LimitableStat) => StatBounds;
}

export interface OffFormulaNoticeProps {
    ship: Ship;
    /** The CONFIGURED autogear role, which can differ from `ship.type`. Null means Custom mode,
     *  where the detector returns nothing. */
    configuredRole: ShipTypeName | null;
}

/** Two sentence shapes an `OffFormulaFinding.produces` needs: `scales` for the aggregate finding
 *  sentence ("Ship's damage scales off X"), `clause` for one carrier's own clause ("Ship deals
 *  damage equal to 60% of X ..."). One table, because a second table naming the same three verbs
 *  is a duplicate label table waiting to drift out of sync with this one. */
const PRODUCES_LABEL: Record<OffFormulaFinding['produces'], { scales: string; clause: string }> = {
    damage: { scales: 'damage scales', clause: 'deals damage equal to' },
    repair: { scales: 'repairs scale', clause: 'repairs' },
    shield: { scales: 'shields scale', clause: 'shields for' },
};

const STAT_LABEL: Record<string, string> = {
    hp: 'HP',
    defence: 'Defence',
    attack: 'Attack',
    security: 'Security',
    shield: 'its shield pool',
};

const statLabel = (stat: string): string => STAT_LABEL[stat] ?? stat;

/** `hp` reads as "max HP" in a percentage-of-stat clause, matching how the skill text itself is
 *  worded ("repairs 60% of its Max HP"). Every other stat keeps its plain `STAT_LABEL`. */
const percentBasisLabel = (stat: ExcludedCarrier['stat']): string =>
    stat === 'hp' ? `max ${statLabel(stat)}` : statLabel(stat);

/** The reason a passive-slot carrier never feeds the derived basis. `pre-combat` fires once per
 *  fight and `start-of-turn`/`start-of-round` fire every round — their frequency is known, but a
 *  one-shot or per-round cadence still doesn't fit the active-versus-charged cast ratio the basis
 *  is built from. Every other trigger (conditional or reactive) really does fire at a frequency
 *  the basis cannot measure. */
const excludedReason = (trigger: string): string =>
    KNOWN_CADENCE_TRIGGERS.has(trigger)
        ? "not counted, because a one-shot or per-round passive doesn't fit the active-versus-charged cast ratio the basis is built from"
        : "not counted, because a passive's frequency depends on the fight";

/**
 * Names one clause a passive left out of `basis`, in the ship's own numbers. For a ship whose
 * whole carrier lives in a passive slot (`equationLine` below then has nothing to add), this
 * sentence is the ONLY content that explains the finding at all — a generic caveat would leave
 * the reader with no idea what was skipped or why.
 */
const excludedLine = (ship: Ship, carrier: ExcludedCarrier): string =>
    `${ship.name} ${PRODUCES_LABEL[carrier.produces].clause} ${carrier.pct}% of ${percentBasisLabel(
        carrier.stat
    )} ${triggerProse(carrier.trigger)}; ${excludedReason(carrier.trigger)}.`;

/** Maps a derived-stat core row to the single stat that stands in for it in a basis comparison,
 *  per `BasisTerm`'s doc in types/autogear.ts: `directDamage`'s primary factor is Attack,
 *  `effectiveHp`'s is HP. A plain-stat core row (e.g. SUPPORTER's `core('hp')`) maps to itself. */
const CORE_ROW_PRIMARY: Partial<Record<string, OffFormulaStat>> = {
    directDamage: 'attack',
    effectiveHp: 'hp',
};

const VALID_BASIS_STATS: ReadonlySet<OffFormulaStat> = new Set([
    'attack',
    'hp',
    'defence',
    'security',
    'shield',
]);

/**
 * The stat `equationLine` treats as the role's baseline, read off `CUSTOM_FORMULA_SEEDS`: the
 * first core row (in the seed's own order) that resolves to a stat a derived basis can carry a
 * term on. Falls back to Attack when no core row resolves to one — every role whose real formula
 * scores Attack (ATTACKER, DEBUFFER, DEBUFFER_BOMBER) resolves its own `directDamage`/`attack`
 * core row first, so the fallback only fires for a role with no basis-comparable core stat at
 * all (e.g. SUPPORTER_BUFFER's core row is Speed).
 */
const roleCoreStat = (role: ShipTypeName): OffFormulaStat => {
    for (const row of CUSTOM_FORMULA_SEEDS[role].rows) {
        if (row.kind !== 'core') continue;
        const mapped = CORE_ROW_PRIMARY[row.stat] ?? (row.stat as OffFormulaStat);
        if (VALID_BASIS_STATS.has(mapped)) return mapped;
    }
    return 'attack';
};

/** The sentence pointing at the excluded-clause list below, agreeing in number with how many
 *  clauses are there. */
const clausePointer = (excludedCount: number): string =>
    excludedCount > 1
        ? 'The clauses below are what a passive keeps the optimizer from counting.'
        : 'The clause below is what a passive keeps the optimizer from counting.';

/**
 * Renders the weighted stat equation `deriveBasis` derived, in the ship's own numbers, against
 * `coreStat` — the stat the CONFIGURED role's own formula already scores (see `roleCoreStat`).
 * When no stat besides `coreStat` feeds the active/charged basis, the derived scoring is exactly
 * what the role formula already assumes — there is nothing new to report from this ship's own
 * active or charged skills, so the caller only points at a passive clause when one is actually
 * there to point at.
 */
const equationLine = (
    basis: DerivedBasis,
    coreStat: OffFormulaStat,
    excludedCount: number
): string => {
    const offCore = basis.terms.filter((term) => term.stat !== coreStat);
    if (offCore.length === 0) {
        const unchanged = `No stat besides ${statLabel(
            coreStat
        )} feeds its active or charged basis, so the derived scoring is unchanged.`;
        return excludedCount > 0 ? `${unchanged} ${clausePointer(excludedCount)}` : unchanged;
    }
    const formatted = basis.terms
        .map((term) => `${statLabel(term.stat)} x${term.weight.toFixed(3)}`)
        .join(' + ');
    const hasCoreStat = basis.terms.some((term) => term.stat === coreStat);
    return `In its own numbers, this is ${formatted}${
        hasCoreStat ? '' : `, and nothing from ${statLabel(coreStat)}`
    }.`;
};

export const OffFormulaNotice: React.FC<OffFormulaNoticeProps> = ({ ship, configuredRole }) => {
    // `buildShipAbilities(ship)` (inside both `detectOffFormulaStats` and `deriveBasis`) is a
    // regex-driven skill-text parser, and `OffFormulaNotice` sits beside sibling `useState`s in
    // `AutogearSettings` that re-render it on unrelated UI interactions — memoised so it is
    // re-parsed only when `ship` or `configuredRole` actually changes, not on every such render.
    const findings = useMemo(
        () => detectOffFormulaStats(ship, configuredRole),
        [ship, configuredRole]
    );
    // `excludedCarriers` (inside `deriveBasis`) walks every passive-slot carrier on the ship
    // regardless of the `produces` argument, so any one finding's `produces` returns the ship's
    // whole excluded set. Keyed by `produces` rather than called once per finding, since two
    // findings can name different `produces` values.
    const basisByProduces = useMemo(() => {
        const map = new Map<OffFormulaFinding['produces'], DerivedBasis>();
        for (const finding of findings) {
            if (!map.has(finding.produces)) {
                map.set(finding.produces, deriveBasis(ship, finding.produces));
            }
        }
        return map;
    }, [ship, findings]);

    if (findings.length === 0 || !configuredRole) return null;

    const roleLabel = SHIP_TYPES[configuredRole]?.name;
    const coreStat = roleCoreStat(configuredRole);
    const excluded = basisByProduces.get(findings[0].produces)?.excluded ?? [];

    return (
        <div className="card space-y-2">
            {findings.map((finding) => {
                const lever = finding.tunableStat;
                const key = `${finding.stat}-${finding.produces}-${lever ?? 'none'}`;
                // A collapsed finding names the lever explicitly, because the sentence has
                // already named a different stat as what the effect reads.
                const scored = lever && lever !== finding.stat ? statLabel(lever) : 'it';
                const basis = lever ? (basisByProduces.get(finding.produces) ?? null) : null;
                return (
                    <div key={key} className="space-y-1">
                        <p className="text-xs text-amber-400">
                            {ship.name}&apos;s {PRODUCES_LABEL[finding.produces].scales} off{' '}
                            {statLabel(finding.stat)}
                            {lever && lever !== finding.stat
                                ? `, which ${statLabel(lever)} drives`
                                : ''}
                            .{' '}
                            {finding.severity === 'severe'
                                ? `The ${roleLabel} formula does not score ${scored}.`
                                : `The ${roleLabel} formula scores ${scored} only as part of a total it can trade away for another stat.`}
                            {!lever &&
                                ' No gear stat drives it, so there is nothing to put in a formula.'}
                        </p>
                        {basis && (
                            <p className="text-xs text-theme-text-secondary">
                                {equationLine(basis, coreStat, excluded.length)}
                            </p>
                        )}
                    </div>
                );
            })}
            {excluded.length > 0 && (
                <div className="space-y-1 border-t border-dark-border pt-2">
                    {excluded.map((carrier, index) => (
                        <p
                            key={`${carrier.stat}-${carrier.produces}-${carrier.trigger}-${index}`}
                            className="text-xs text-theme-text-secondary"
                        >
                            {excludedLine(ship, carrier)}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
};
