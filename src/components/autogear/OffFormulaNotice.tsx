import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui';
import type { Ship } from '../../types/ship';
import { type ShipTypeName, SHIP_TYPES } from '../../constants/shipTypes';
import {
    detectOffFormulaStats,
    type OffFormulaFinding,
    type OffFormulaStat,
} from '../../utils/autogear/offFormula/offFormulaStats';
import {
    deriveBasis,
    triggerProse,
    KNOWN_CADENCE_TRIGGERS,
    type DerivedBasis,
    type ExcludedCarrier,
} from '../../utils/autogear/offFormula/basisDerivation';
import { roleAxis, rolePrimaryStat } from '../../utils/autogear/offFormula/roleBasisHost';
import type { BasisTerm, RoleBasis } from '../../types/autogear';
import { BasisTermsEditor } from './BasisTermsEditor';
import {
    basisAuthoringError,
    draftFromBasis,
    nextBasisStat,
    parseAuthoredBasisTerms,
    type DraftBasisTerm,
} from './basisTermDraft';

/** What Apply writes back to the ship's config: the derived basis, attached to whichever axis
 *  `configuredRole` hosts (`roleAxis`, `roleBasisHost.ts`). `shipRole` is unchanged — the
 *  role's own formula keeps running, with `roleBasis` replacing only the one quantity that
 *  formula hosts (`roleHostsBasis`); every other role's scorer ignores it entirely. */
export interface OffFormulaApplyUpdate {
    shipRole: ShipTypeName;
    roleBasis: RoleBasis;
}

export interface OffFormulaNoticeProps {
    ship: Ship;
    /** The CONFIGURED autogear role, which can differ from `ship.type`. Null means Custom mode,
     *  where the detector returns nothing. */
    configuredRole: ShipTypeName | null;
    /** The ship's currently-stored `roleBasis` (`AutogearShipConfig.roleBasis`), read back so the
     *  notice can render whether an equation is already in use — the write survives past the
     *  click (it lives in the page's own config state, not this component), but nothing painted
     *  that fact until this prop existed (#544). Undefined means no equation has been applied. */
    appliedRoleBasis?: RoleBasis;
    /** Writes the derived basis into the ship's config. Optional so a caller that has not
     *  wired persistence (or a test only asserting the notice's copy) can omit it — the button
     *  it drives simply does not render. */
    onApply?: (update: OffFormulaApplyUpdate) => void;
    /** Clears `appliedRoleBasis` (writes `roleBasis: undefined`). Optional for the same reason as
     *  `onApply` — the "Stop using this equation" control simply does not render without it. */
    onClear?: () => void;
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

/** The sentence pointing at the excluded-clause list below, agreeing in number with how many
 *  clauses are there. */
const clausePointer = (excludedCount: number): string =>
    excludedCount > 1
        ? 'The clauses below are what a passive keeps the optimizer from counting.'
        : 'The clause below is what a passive keeps the optimizer from counting.';

/** Whether `terms` describe scoring different from the role's own baseline: at least one term
 *  on a stat other than `coreStat` (the role's own primary stat, `rolePrimaryStat`). A basis that
 *  reduces to `coreStat` alone — or to nothing at all — reproduces exactly what the role formula
 *  already assumes, so Apply would be a no-op button and Restore would return to that same no-op
 *  (#544 I2). Every caller that decides whether the derivation is worth acting on reads this one
 *  predicate rather than re-deriving it from `terms.length`. */
const basisChangesScoring = (terms: BasisTerm[], coreStat: OffFormulaStat | null): boolean =>
    terms.some((term) => term.stat !== coreStat);

const PRODUCES_NOUN: Record<OffFormulaFinding['produces'], string> = {
    damage: 'damage',
    repair: 'repairs',
    shield: 'shields',
};

/**
 * Renders the weighted stat equation `deriveBasis` derived, in the ship's own numbers, against
 * `coreStat` — the stat the CONFIGURED role's own formula already scores (`rolePrimaryStat`).
 * When no stat besides `coreStat` feeds the active/charged basis, the derived scoring is exactly
 * what the role formula already assumes — there is nothing new to report from this ship's own
 * active or charged skills, so the caller only points at a passive clause when one is actually
 * there to point at.
 */
const equationLine = (
    basis: DerivedBasis,
    coreStat: OffFormulaStat,
    excludedCount: number,
    produces: OffFormulaFinding['produces']
): string => {
    if (!basisChangesScoring(basis.terms, coreStat)) {
        // An empty basis has no active/charged carrier at all — saying "no stat besides
        // `coreStat` feeds it" would wrongly imply `coreStat` itself is one of the carriers.
        // A nonempty basis that still reduces to `coreStat` (Vindicator, FrontLine) really is
        // fed by that stat, so the "unchanged" claim can name it.
        const unchanged =
            basis.terms.length === 0
                ? `Nothing in its active or charged skills produces ${PRODUCES_NOUN[produces]}, so the derived scoring is unchanged.`
                : `No stat besides ${statLabel(
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

/** Whether two basis term sets score identically: the same stat/weight pairs, in either order.
 *  Decides whether an applied basis is still the kit's own derived equation or a player's edited
 *  version of it — never a diff of insertion order, which carries no scoring meaning. */
const basisTermsMatch = (a: BasisTerm[], b: BasisTerm[]): boolean => {
    if (a.length !== b.length) return false;
    const key = (t: BasisTerm) => `${t.stat}:${t.weight}`;
    const sortedA = a.map(key).sort();
    const sortedB = b.map(key).sort();
    return sortedA.every((v, i) => v === sortedB[i]);
};

export const OffFormulaNotice: React.FC<OffFormulaNoticeProps> = ({
    ship,
    configuredRole,
    appliedRoleBasis,
    onApply,
    onClear,
}) => {
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

    // The axis a derived basis can replace in `configuredRole`'s own formula (`roleAxis`,
    // `roleBasisHost.ts`) — null for a role with no single scalable quantity to replace
    // (DEFENDER-family and four others; see `roleBasisHost.ts`'s doc for the full list and why).
    // Apply, the equation line, and the "add it by hand" advice all gate on this: printing an
    // equation the role's formula can never use invites gearing for a stat that formula does not
    // want (owner ruling, #544 — Panon is gearing for Defence because he tanks, not because his
    // kit happens to deal damage too).
    const hostAxis = configuredRole ? roleAxis(configuredRole) : null;
    // An applied basis only reads as "in use" when its `produces` is the axis THIS role hosts —
    // the scorer applies it under that same condition (`roleHostsBasis`), so a basis stored under
    // a role the player has since changed away from is correctly ignored by both. Rendering it as
    // applied anyway would claim a scoring effect the ship no longer has.
    const applied = !!appliedRoleBasis && !!hostAxis && appliedRoleBasis.produces === hostAxis;

    // The derived equation for the axis THIS role hosts, computed independent of whether the
    // detector currently reports a finding on it — an applied basis stays "in use" even on a
    // render where `findings` comes back empty (see the comment below), and Restore/the
    // edited-vs-derived label must still have something to compare against in that state.
    const derivedForApplied = useMemo(
        () => (applied && hostAxis ? deriveBasis(ship, hostAxis) : null),
        [ship, hostAxis, applied]
    );

    const [isEditing, setIsEditing] = useState(false);
    const [draftTerms, setDraftTerms] = useState<DraftBasisTerm[]>([]);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Switching the open ship or role must not leave a stale editor (or a stale error) open
    // against a DIFFERENT ship's equation.
    useEffect(() => {
        setIsEditing(false);
        setSaveError(null);
    }, [ship.id, configuredRole]);

    // An applied basis stays visible (and removable) even on a re-render where the detector no
    // longer flags anything new — the scorer keeps using it regardless of what the detector says
    // today, so hiding the card here would leave it in use with no way to stop.
    if (!configuredRole || (findings.length === 0 && !applied)) return null;

    const roleLabel = SHIP_TYPES[configuredRole]?.name;

    const coreStat = hostAxis ? rolePrimaryStat(configuredRole) : null;
    const hostedBasis = hostAxis ? (basisByProduces.get(hostAxis) ?? null) : null;
    // `hostedBasis.excluded` is ship-wide (`excludedCarriers` ignores its `produces` argument —
    // see `basisByProduces`'s comment above), so a carrier on a DIFFERENT axis from `hostAxis`
    // would otherwise still count here. Restricted to carriers this axis actually produces, or a
    // ship whose only exclusion is, say, a `shield` passive would offer to write a `repair`
    // equation from a clause that has nothing to do with repairs.
    const hostAxisExcluded = hostedBasis
        ? hostedBasis.excluded.filter((carrier) => carrier.produces === hostAxis)
        : [];
    // `excludedCarriers` doesn't vary with `produces` (see the comment on `basisByProduces`), so
    // reading it off the first finding is safe here — the ship-wide fallback below for a role
    // with no equation to point from.
    const shipWideExcluded =
        findings.length > 0 ? (basisByProduces.get(findings[0].produces)?.excluded ?? []) : [];
    // The list rendered below must agree with the clause-pointer sentence embedded in the
    // equation line, which only ever names carriers on the axis THIS role hosts
    // (`hostAxisExcluded`) — #544 I3, pinned by `OffFormulaNotice.test.tsx`. A role that hosts
    // nothing (the DEFENDER family) never renders that pointer at all, since `equationLine` only
    // runs for a finding whose `produces` matches a real `hostAxis` — so there is no pointer for
    // a filtered list to disagree with, and the ship-wide set stays purely informational instead.
    const excluded = hostAxis ? hostAxisExcluded : shipWideExcluded;

    // `hostedBasis` is only set when a finding on `hostAxis` exists (`basisByProduces` is keyed
    // off `findings`), so this already implies an on-axis finding — a ship whose only carrier on
    // the hosted axis is a passive derives no terms here, but the notice still owes it an entry
    // point: the excluded clause is what the player needs in hand to write the term themselves.
    const hostedBasisChangesScoring =
        !!hostedBasis && basisChangesScoring(hostedBasis.terms, coreStat);
    const canApply = hostedBasisChangesScoring;
    const canWriteEquation =
        !!hostedBasis && !hostedBasisChangesScoring && hostAxisExcluded.length > 0;

    const handleApply = () => {
        if (!onApply || !hostAxis || !hostedBasis || hostedBasis.terms.length === 0) return;
        onApply({
            shipRole: configuredRole,
            roleBasis: { produces: hostAxis, terms: hostedBasis.terms },
        });
    };

    // The terms actually in force right now — what the "in use" state and the editor's starting
    // point both read, since a player's edit lives nowhere but `appliedRoleBasis` itself.
    const appliedTerms = applied ? (appliedRoleBasis?.terms ?? []) : [];
    // Whether the applied terms are still the kit's own derivation, or a player's edited version
    // of it — `derivedForApplied` is null only when `applied` is false, in which case this value
    // is never read.
    const editedFromDerived =
        applied && derivedForApplied
            ? !basisTermsMatch(appliedTerms, derivedForApplied.terms)
            : false;
    // A ship reaching applied state through Write an equation has no derivation worth pointing
    // to — either genuinely nothing (`derivedForApplied.terms` empty) or a derivation that
    // reduces to the role's own stat and so changes nothing (#544 I2, e.g. Xcellence) — distinct
    // from an ordinary edit, which starts from a derivation that actually changes the scoring
    // and diverges from it. Read off `derivedForApplied` itself (the live recompute), not off
    // how this ship happened to reach applied state, so the label stays correct across edits.
    const derivationChangesScoring =
        !!derivedForApplied && basisChangesScoring(derivedForApplied.terms, coreStat);
    const writtenFromScratch = applied && !derivationChangesScoring;
    // Restoring writes `derivedForApplied.terms` straight back through `onApply` (`handleRestore`
    // below) — offering it when the derivation doesn't change scoring would hand the player back
    // the exact no-op equation Apply itself refuses to offer (#544 I2), undoing the equation they
    // wrote for no reason they asked for.
    const canRestore = editedFromDerived && derivationChangesScoring;

    const startEditing = () => {
        setDraftTerms(draftFromBasis(appliedTerms));
        setSaveError(null);
        setIsEditing(true);
    };

    // The Write-an-equation entry point: same editor, same save path (`handleSaveEdit` writes
    // whatever draft validates, regardless of how the editor was opened), starting from nothing
    // rather than a derivation that doesn't exist for this ship.
    const startWriting = () => {
        setDraftTerms([]);
        setSaveError(null);
        setIsEditing(true);
    };

    const cancelEditing = () => {
        setIsEditing(false);
        setSaveError(null);
    };

    const addDraftTerm = () => {
        setDraftTerms((terms) => [...terms, { stat: nextBasisStat(terms), weight: '' }]);
    };

    const updateDraftTerm = (index: number, patch: Partial<DraftBasisTerm>) => {
        setDraftTerms((terms) => terms.map((t, i) => (i === index ? { ...t, ...patch } : t)));
    };

    const removeDraftTerm = (index: number) => {
        setDraftTerms((terms) => terms.filter((_, i) => i !== index));
    };

    // Only changes `terms` — `produces` and `shipRole` stay exactly what they were, so an edit
    // still has to match the role's own axis to count (owner ruling, #544).
    const handleSaveEdit = () => {
        if (!onApply || !hostAxis) return;
        // A from-scratch draft with no terms at all (Write an equation, saved empty) has no stat
        // on screen to "remove" — that refusal only fits a draft with terms already in it, so
        // the two cases get different copy. Everything else routes through the shared authoring
        // gate (`basisAuthoringError`, basisTermDraft.ts) — see its own doc for why authoring is
        // stricter than the scorer's read-time gate.
        if (draftTerms.length === 0) {
            setSaveError('Add at least one stat with a weight above zero.');
            return;
        }
        const authoringError = basisAuthoringError(draftTerms);
        if (authoringError) {
            setSaveError(authoringError);
            return;
        }
        onApply({
            shipRole: configuredRole,
            roleBasis: { produces: hostAxis, terms: parseAuthoredBasisTerms(draftTerms) },
        });
        setSaveError(null);
        setIsEditing(false);
    };

    const handleRestore = () => {
        if (!onApply || !hostAxis || !derivedForApplied) return;
        onApply({
            shipRole: configuredRole,
            roleBasis: { produces: hostAxis, terms: derivedForApplied.terms },
        });
        setIsEditing(false);
        setSaveError(null);
    };

    // Stop ends the applied state the same way Restore replaces it: closing any open editor and
    // dropping its draft/error. Leaving the editor open here would let a later Save re-apply a
    // basis and silently undo the Stop the player just clicked.
    const handleStop = () => {
        onClear?.();
        setIsEditing(false);
        setDraftTerms([]);
        setSaveError(null);
    };

    return (
        <div className="card space-y-2">
            {findings.map((finding) => {
                const lever = finding.tunableStat;
                const key = `${finding.stat}-${finding.produces}-${lever ?? 'none'}`;
                // A collapsed finding names the lever explicitly, because the sentence has
                // already named a different stat as what the effect reads.
                const scored = lever && lever !== finding.stat ? statLabel(lever) : 'it';
                // An equation line states what `coreStat` (the role's own formula stat) gets
                // displaced by — meaningless unless THIS finding's axis is the one `coreStat`
                // belongs to. A finding on another axis (e.g. a `repair` finding on a
                // damage-hosting role) gets the finding sentence only; the excluded-carrier block
                // below still lists every passive clause regardless, same as a role that hosts
                // nothing at all.
                const basis =
                    lever && hostAxis && finding.produces === hostAxis
                        ? (basisByProduces.get(finding.produces) ?? null)
                        : null;
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
                        {basis && coreStat && (
                            <p className="text-xs text-theme-text-secondary">
                                {equationLine(
                                    basis,
                                    coreStat,
                                    hostAxisExcluded.length,
                                    finding.produces
                                )}
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
            {onApply && canApply && !applied && (
                <Button variant="secondary" size="sm" onClick={handleApply}>
                    Use this equation
                </Button>
            )}
            {onApply && canWriteEquation && !applied && !isEditing && (
                <Button variant="secondary" size="sm" onClick={startWriting}>
                    Write an equation
                </Button>
            )}
            {applied && (
                <div className="space-y-2">
                    <p className="text-xs text-theme-text-secondary">
                        Autogear will score {ship.name} with this equation on its next run.
                    </p>
                    {appliedTerms.length > 0 && (
                        <p className="text-xs text-theme-text-secondary">
                            {appliedTerms
                                .map((term) => `${statLabel(term.stat)} x${term.weight.toFixed(3)}`)
                                .join(' + ')}
                        </p>
                    )}
                    <p className="text-xs text-theme-text-secondary">
                        {writtenFromScratch
                            ? 'This equation was written by hand; the kit has nothing to derive here.'
                            : editedFromDerived
                              ? 'This is your own version of the equation.'
                              : "This is the kit's own equation."}
                    </p>
                    <div className="flex gap-2 flex-wrap">
                        {onApply && !isEditing && (
                            <Button variant="secondary" size="sm" onClick={startEditing}>
                                Edit this equation
                            </Button>
                        )}
                        {onApply && canRestore && (
                            <Button variant="secondary" size="sm" onClick={handleRestore}>
                                Restore the derived equation
                            </Button>
                        )}
                        {onClear && (
                            <Button variant="secondary" size="sm" onClick={handleStop}>
                                Stop using this equation
                            </Button>
                        )}
                    </div>
                </div>
            )}
            {isEditing && (
                <div className="space-y-2 border-t border-dark-border pt-2">
                    <BasisTermsEditor
                        terms={draftTerms}
                        onUpdate={updateDraftTerm}
                        onRemove={removeDraftTerm}
                        onAdd={addDraftTerm}
                    />
                    {saveError && (
                        <p className="text-xs text-red-400" role="alert">
                            {saveError}
                        </p>
                    )}
                    <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={cancelEditing}>
                            Cancel
                        </Button>
                        <Button variant="primary" size="sm" onClick={handleSaveEdit}>
                            Save equation
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};
