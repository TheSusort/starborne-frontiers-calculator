import React, { useMemo } from 'react';
import { Button } from '../ui';
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
import {
    roleAxis,
    rolePrimaryStat,
    isDefenderFamilyRole,
    DEFENDER_TILT_BONUS,
} from '../../utils/autogear/simRerank/roleBasisHost';
import type { RoleBasis, StatBonus } from '../../types/autogear';

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
    /** Writes the derived basis into the ship's config. Optional so a caller that has not
     *  wired persistence (or a test only asserting the notice's copy) can omit it — the button
     *  it drives simply does not render. */
    onApply?: (update: OffFormulaApplyUpdate) => void;
    /** Appends `DEFENDER_TILT_BONUS` to the ship's stat bonuses. Optional for the same reason as
     *  `onApply` — a caller not ready to persist the write simply omits it, and the tilt button
     *  does not render. */
    onApplyTilt?: (bonus: StatBonus) => void;
    /** The ship's current stat bonuses. The tilt button is wired to the same handler the manual
     *  "Add stat bonus" form uses (`onAddStatBonus` in `AutogearSettings.tsx`), which REPLACES an
     *  existing bonus on the same stat rather than adding a second one — so once any Defence
     *  bonus already exists, the button withholds itself rather than risk silently overwriting a
     *  value the player set on purpose. Defaults to empty, matching a caller with nothing saved
     *  yet. */
    statBonuses?: StatBonus[];
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

export const OffFormulaNotice: React.FC<OffFormulaNoticeProps> = ({
    ship,
    configuredRole,
    onApply,
    onApplyTilt,
    statBonuses = [],
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

    if (findings.length === 0 || !configuredRole) return null;

    const roleLabel = SHIP_TYPES[configuredRole]?.name;
    // `excludedCarriers` doesn't vary with `produces` (see the comment on `basisByProduces`), so
    // reading it off the first finding is safe here — unlike `hostedBasis` below, which must
    // read the axis the ROLE hosts, never merely the first finding's.
    const excluded = basisByProduces.get(findings[0].produces)?.excluded ?? [];

    // The axis a derived basis can replace in `configuredRole`'s own formula (`roleAxis`,
    // `roleBasisHost.ts`) — null for a role with no single scalable quantity to replace
    // (DEFENDER-family and four others; see `roleBasisHost.ts`'s doc for the full list and why).
    // Apply, the equation line, and the "add it by hand" advice all gate on this: printing an
    // equation the role's formula can never use invites gearing for a stat that formula does not
    // want (owner ruling, #544 — Panon is gearing for Defence because he tanks, not because his
    // kit happens to deal damage too).
    const hostAxis = roleAxis(configuredRole);
    const coreStat = hostAxis ? rolePrimaryStat(configuredRole) : null;
    const hostedBasis = hostAxis ? (basisByProduces.get(hostAxis) ?? null) : null;
    const canApply = !!hostedBasis && hostedBasis.terms.length > 0;

    const handleApply = () => {
        if (!onApply || !hostAxis || !hostedBasis || hostedBasis.terms.length === 0) return;
        onApply({
            shipRole: configuredRole,
            roleBasis: { produces: hostAxis, terms: hostedBasis.terms },
        });
    };

    // The Defender tilt (#544) gates on the AXIS a finding describes, not merely on a finding
    // being present: only a finding whose `tunableStat` is `defence` — the ship's kit damage
    // reading Defence, the lever a player could actually gear — under one of the two
    // survival-rounds roles (`isDefenderFamilyRole`) offers it. A DEFENDER-family ship whose
    // carrier reads a different stat (Opal: attack) gets no tilt; neither does a defence-lever
    // finding under a role outside the family (no host axis does not imply "Defender-shaped").
    // Withheld once a Defence bonus already exists — see `statBonuses`'s own doc for why.
    const canTilt =
        isDefenderFamilyRole(configuredRole) &&
        findings.some((f) => f.tunableStat === 'defence') &&
        !statBonuses.some((b) => b.stat === 'defence');

    const handleTilt = () => {
        if (!onApplyTilt) return;
        onApplyTilt(DEFENDER_TILT_BONUS);
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
            {onApply && canApply && (
                <Button variant="secondary" size="sm" onClick={handleApply}>
                    Use this equation
                </Button>
            )}
            {onApplyTilt && canTilt && (
                <div className="space-y-1 border-t border-dark-border pt-2">
                    <p className="text-xs text-theme-text-secondary">
                        {ship.name} turns Defence into damage as a side effect of tanking, so
                        gearing for Defence pays off twice. When two builds would otherwise survive
                        equally well, this nudges the optimizer to prefer the one with more Defence
                        — it never picks a build that survives fewer rounds.
                    </p>
                    <Button variant="secondary" size="sm" onClick={handleTilt}>
                        Prefer Defence in ties
                    </Button>
                </div>
            )}
        </div>
    );
};
