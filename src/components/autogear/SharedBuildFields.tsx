import React from 'react';
import { SHIP_TYPES } from '../../constants/shipTypes';
import { GEAR_SETS } from '../../constants/gearSets';
import { IMPLANTS } from '../../constants/implants';
import { STATS, getLimitStatLabel } from '../../constants/stats';
import type { StatName } from '../../types/stats';
import type { SharedAutogearBuild } from '../../types/communityRecommendation';

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

// Every constant lookup below is keyed by community-authored data. STATS,
// GEAR_SETS, SHIP_TYPES and IMPLANTS are Record<string, …> — they gate authoring,
// not input — so a foreign key yields undefined and must fall back, never index.
const setLabel = (setName: string): string =>
    GEAR_SETS[setName]?.name ?? IMPLANTS[setName]?.name ?? setName;

/**
 * All seven shared-build fields (role, stat priorities, gear sets, stat
 * bonuses, fleet buffs, implant settings) in the settings-panel vocabulary.
 *
 * Shared between the community build detail view and the share preview so a
 * build is always described the same way, wherever it is rendered.
 */
export const SharedBuildFields: React.FC<SharedBuildFieldsProps> = ({ build: config }) => {
    const roleInfo = SHIP_TYPES[config.shipRole];
    const hasImplantSettings = config.optimizeImplants || config.excludedImplantTypes.length > 0;

    return (
        <>
            <Section title="Role">
                <span className="inline-flex items-center gap-2">
                    {roleInfo?.iconUrl && <img src={roleInfo.iconUrl} alt="" className="w-4 h-4" />}
                    {roleInfo?.name ?? config.shipRole}
                </span>
            </Section>

            {/* Rendered as an ordered list: a priority's strength is its position,
                not a number on the row (StatPriority.weight is always 1). */}
            {config.statPriorities.length > 0 && (
                <Section title="Stat Priorities">
                    <ol className="list-decimal list-inside space-y-1">
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
                    </ol>
                </Section>
            )}

            {config.setPriorities.length > 0 && (
                <Section title="Gear Sets">
                    {config.setPriorities.map((set, index) => (
                        <div key={index} data-testid="community-build-set">
                            {set.kind === 'implant'
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
                            {STATS[bonus.stat as StatName]?.label ?? bonus.stat} ({' '}
                            {bonus.percentage}
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
                        <div key={key}>Excluded: {IMPLANTS[key]?.name ?? key}</div>
                    ))}
                </Section>
            )}
        </>
    );
};
