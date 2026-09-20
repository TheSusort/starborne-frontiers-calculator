import React from 'react';
import type { Ship } from '../../types/ship';
import { type ShipTypeName, SHIP_TYPES } from '../../constants/shipTypes';
import {
    detectOffFormulaStats,
    type OffFormulaFinding,
} from '../../utils/autogear/simRerank/offFormulaStats';
import {
    deriveBasis,
    triggerProse,
    type DerivedBasis,
    type ExcludedCarrier,
} from '../../utils/autogear/simRerank/basisDerivation';
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

/**
 * Names one clause a passive left out of `basis`, in the ship's own numbers. For a ship whose
 * whole carrier lives in a passive slot (`equationLine` below then has nothing to add), this
 * sentence is the ONLY content that explains the finding at all — a generic caveat would leave
 * the reader with no idea what was skipped or why.
 */
const excludedLine = (ship: Ship, carrier: ExcludedCarrier): string =>
    `${ship.name} ${PRODUCES_LABEL[carrier.produces].clause} ${carrier.pct}% of ${percentBasisLabel(
        carrier.stat
    )} ${triggerProse(carrier.trigger)}; not counted, because a passive's frequency depends on the fight.`;

/**
 * Renders the weighted stat equation `deriveBasis` derived, in the ship's own numbers. When no
 * stat besides Attack feeds the active/charged basis, the derived scoring is exactly what a
 * normal ship's would be — there is nothing new to report from this ship's own active or charged
 * skills, so the caller only points at a passive clause when one is actually there to point at.
 */
const equationLine = (basis: DerivedBasis, hasExcluded: boolean): string => {
    const offAttack = basis.terms.filter((term) => term.stat !== 'attack');
    if (offAttack.length === 0) {
        const unchanged =
            'No stat besides Attack feeds its active or charged basis, so the derived scoring is unchanged.';
        return hasExcluded
            ? `${unchanged} The clause below is what a passive keeps the optimizer from counting.`
            : unchanged;
    }
    const formatted = basis.terms
        .map((term) => `${statLabel(term.stat)} x${term.weight.toFixed(3)}`)
        .join(' + ');
    const hasAttack = basis.terms.some((term) => term.stat === 'attack');
    return `In its own numbers, this is ${formatted}${hasAttack ? '' : ', and nothing from Attack'}.`;
};

export const OffFormulaNotice: React.FC<OffFormulaNoticeProps> = ({ ship, configuredRole }) => {
    const findings = detectOffFormulaStats(ship, configuredRole);
    if (findings.length === 0 || !configuredRole) return null;

    const roleLabel = SHIP_TYPES[configuredRole]?.name;
    // `excludedCarriers` (inside `deriveBasis`) walks every passive-slot carrier on the ship
    // regardless of the `produces` argument, so any one finding's `produces` returns the ship's
    // whole excluded set — one call covers every finding below.
    const excluded = deriveBasis(ship, findings[0].produces).excluded;

    return (
        <div className="card space-y-2">
            {findings.map((finding) => {
                const lever = finding.tunableStat;
                const key = `${finding.stat}-${finding.produces}-${lever ?? 'none'}`;
                // A collapsed finding names the lever explicitly, because the sentence has
                // already named a different stat as what the effect reads.
                const scored = lever && lever !== finding.stat ? statLabel(lever) : 'it';
                const basis = lever ? deriveBasis(ship, finding.produces) : null;
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
                                {equationLine(basis, excluded.length > 0)}
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
