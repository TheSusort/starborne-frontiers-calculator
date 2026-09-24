import React from 'react';
import { SHIP_TYPES } from '../../constants/shipTypes';
import { getGearSet } from '../../constants/gearSets';
import { getImplantData } from '../../constants/implants';
import { STATS, getLimitStatLabel } from '../../constants/stats';
import type { SharedAutogearBuild } from '../../types/communityRecommendation';
import type { BasisTerm, CustomFormulaRow, RoleBasis } from '../../types/autogear';
import { usableBasis, usableBasisTerms } from '../../utils/autogear/customFormula';
import { roleHostsBasis } from '../../utils/autogear/offFormula/roleBasisHost';

interface SharedBuildFieldsProps {
    build: SharedAutogearBuild;
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div>
        <h5 className="text-xs uppercase tracking-wide font-semibold text-theme-text-secondary mb-1">
            {title}
        </h5>
        <div className="space-y-1">{children}</div>
    </div>
);

// Every constant lookup below is keyed by community-authored data, so every one falls back to
// the raw key: STATS/SHIP_TYPES via a plain index (their own key type still gates authoring, not
// input), GEAR_SETS/IMPLANTS via `getGearSet`/`getImplantData` (no index signature — an unrecognised
// name must resolve to `undefined`, not a type error).
const setLabel = (setName: string): string =>
    getGearSet(setName)?.name ?? getImplantData(setName)?.name ?? setName;

/** A derived/authored weight is never smaller than the share schema's own MIN_NUMBER_MAGNITUDE
 *  floor (1e-6, `sharedAutogearBuild.ts`) — well below `toFixed(3)`'s 0.0005 rounding floor, so a
 *  real nonzero weight there must not print as the misleading "x0.000". Falls back to exponential
 *  notation only in that narrow band; every ordinary weight (the smallest derived one is 0.008)
 *  still reads as a plain decimal. */
const formatWeight = (weight: number): string =>
    weight !== 0 && Math.abs(weight) < 0.0005 ? weight.toExponential(2) : weight.toFixed(3);

/** A formula row's basis terms, in the same "Stat xWeight" shape `CustomFormulaRowView` shows
 *  while editing — joined with `+` so a viewer reads the same equation the sharer configured. */
const basisTermsLine = (terms: BasisTerm[]): string =>
    terms
        .map((term) => `${getLimitStatLabel(term.stat)} x${formatWeight(term.weight)}`)
        .join(' + ');

const FORMULA_ROW_KIND_LABEL: Record<CustomFormulaRow['kind'], string> = {
    core: 'Core',
    bonus: 'Bonus',
};

/** What a `roleBasis` measures, in plain copy — never the raw `produces` key. */
const BASIS_AXIS_LABEL: Record<RoleBasis['produces'], string> = {
    damage: 'damage',
    repair: 'repairs',
    shield: 'shields',
};

/**
 * All nine shared-build fields (role, stat priorities, gear sets, stat
 * bonuses, fleet buffs, implant settings, custom formula, derived equation)
 * in the settings-panel vocabulary.
 *
 * Shared between the community build detail view and the share preview so a
 * build is always described the same way, wherever it is rendered.
 */
export const SharedBuildFields: React.FC<SharedBuildFieldsProps> = ({ build: config }) => {
    // Custom mode (`shipRole: null`) has no role to look up — matches AutogearConfigList's
    // own "Custom" fallback so a build reads the same way wherever it is shown.
    const roleInfo = config.shipRole ? SHIP_TYPES[config.shipRole] : undefined;
    const hasImplantSettings = config.optimizeImplants || config.excludedImplantTypes.length > 0;
    const formulaRows = config.customFormula?.rows ?? [];
    // A `roleBasis` only means something on the axis its own role hosts (`roleHostsBasis`,
    // roleBasisHost.ts) — the scorer ignores it otherwise (priorityScore.ts), so an old row
    // carrying one from a role it can't attach to (or a `shipRole` that no longer names a real
    // role — `isShipTypeKey`'s `Object.prototype.hasOwnProperty` check via `roleInfo` above)
    // must not show an Equation section the ship's own scoring never runs.
    const roleHostsRoleBasis =
        !!config.shipRole &&
        !!roleInfo &&
        !!config.roleBasis &&
        roleHostsBasis(config.shipRole, config.roleBasis.produces);
    // Read through `usableBasisTerms` rather than the stored array directly — matches
    // `CustomFormulaRowView`'s own display rule, so a viewer only ever sees the terms the
    // scorer actually reads, never one it would silently drop.
    const equationTerms =
        roleHostsRoleBasis && config.roleBasis
            ? usableBasisTerms(config.roleBasis.terms)
            : undefined;
    const equationAxisLabel =
        roleHostsRoleBasis && config.roleBasis ? BASIS_AXIS_LABEL[config.roleBasis.produces] : null;

    return (
        <>
            <Section title="Role">
                <span className="inline-flex items-center gap-2">
                    {roleInfo?.iconUrl && <img src={roleInfo.iconUrl} alt="" className="w-4 h-4" />}
                    {roleInfo?.name ?? config.shipRole ?? 'Custom'}
                </span>
            </Section>

            {config.statPriorities.length > 0 && (
                <Section title="Stat Priorities">
                    <ul className="list-disc list-inside space-y-1">
                        {config.statPriorities.map((priority, index) => (
                            <li key={index} data-testid="community-build-priority">
                                {getLimitStatLabel(priority.stat)}
                                {priority.minLimit !== undefined && ` (min: ${priority.minLimit})`}
                                {priority.maxLimit !== undefined && ` (max: ${priority.maxLimit})`}
                                {priority.hardRequirement && (
                                    <span className="text-amber-400"> — Hard Requirement</span>
                                )}
                            </li>
                        ))}
                    </ul>
                </Section>
            )}

            {formulaRows.length > 0 && (
                <Section title="Formula">
                    <ul className="space-y-1">
                        {formulaRows.map((row, index) => {
                            const basisTerms = usableBasis(row);
                            return (
                                <li key={index} data-testid="community-build-formula-row">
                                    <span className="text-xs uppercase tracking-wide text-theme-text-secondary mr-1">
                                        {FORMULA_ROW_KIND_LABEL[row.kind]}
                                    </span>
                                    {getLimitStatLabel(row.stat)}
                                    {row.direction === 'min' && ' — as little as possible'}
                                    {row.kind === 'bonus' &&
                                        row.percentage !== undefined &&
                                        ` (${row.percentage}%)`}
                                    {basisTerms && basisTerms.length > 0 && (
                                        <div className="text-xs text-theme-text-secondary">
                                            {basisTermsLine(basisTerms)}
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </Section>
            )}

            {equationTerms && equationTerms.length > 0 && (
                <Section title="Equation">
                    <div data-testid="community-build-equation">
                        Scores {equationAxisLabel} as: {basisTermsLine(equationTerms)}
                    </div>
                </Section>
            )}

            {config.setPriorities.length > 0 && (
                <Section title="Gear Sets">
                    {config.setPriorities.map((set, index) => (
                        <div key={index} data-testid="community-build-set">
                            {/* A legacy set priority with no recorded piece count is
                                shown without one, rather than inventing a number. */}
                            {set.kind === 'implant' || set.count === undefined
                                ? setLabel(set.setName)
                                : `${setLabel(set.setName)} ( ${set.count} pieces)`}
                        </div>
                    ))}
                </Section>
            )}

            {config.statBonuses.length > 0 && (
                <Section title="Stat Bonuses">
                    {config.statBonuses.map((bonus, index) => (
                        <div key={index} data-testid="community-build-bonus">
                            {getLimitStatLabel(bonus.stat)} ( {bonus.percentage}
                            {'%) — '}
                            <span className="text-xs text-theme-text-secondary">
                                {bonus.mode === 'multiplier' ? 'Multiplier' : 'Additive'}
                            </span>
                        </div>
                    ))}
                </Section>
            )}

            {config.fleetBuffs.length > 0 && (
                <Section title="Fleet Buffs">
                    {config.fleetBuffs.map((buff, index) => (
                        <div key={index} data-testid="community-build-fleet-buff">
                            {STATS[buff.stat]?.label ?? buff.stat} +{buff.percentage}%
                        </div>
                    ))}
                </Section>
            )}

            {hasImplantSettings && (
                <Section title="Implants">
                    {config.optimizeImplants && <div>Optimize implants</div>}
                    {config.excludedImplantTypes.map((key) => (
                        <div key={key}>Excluded: {getImplantData(key)?.name ?? key}</div>
                    ))}
                </Section>
            )}
        </>
    );
};
