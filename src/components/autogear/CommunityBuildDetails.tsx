import React from 'react';
import { Button } from '../ui/Button';
import { SHIP_TYPES } from '../../constants/shipTypes';
import { GEAR_SETS } from '../../constants/gearSets';
import { IMPLANTS } from '../../constants/implants';
import { STATS, getLimitStatLabel } from '../../constants/stats';
import type { StatName } from '../../types/stats';
import type { CommunityBuild } from '../../utils/communityBuild';

interface CommunityBuildDetailsProps {
    build: CommunityBuild;
    userVote: 'upvote' | 'downvote' | null;
    canVote: boolean;
    canApply: boolean;
    onVote: (voteType: 'upvote' | 'downvote') => void;
    onApply: () => void;
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

export const CommunityBuildDetails: React.FC<CommunityBuildDetailsProps> = ({
    build,
    userVote,
    canVote,
    canApply,
    onVote,
    onApply,
}) => {
    const { build: config } = build;
    const roleInfo = SHIP_TYPES[config.shipRole];
    const hasImplantSettings = config.optimizeImplants || config.excludedImplantTypes.length > 0;

    return (
        <div className="space-y-3 text-sm">
            {build.description && (
                <p className="text-theme-text-secondary italic">
                    &ldquo;{build.description}&rdquo;
                </p>
            )}

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

            {build.isLegacy && (
                <p className="text-xs text-theme-text-secondary">
                    Shared before fleet buffs and implant settings were captured, so this build
                    covers role, stat priorities, gear sets and stat bonuses only.
                </p>
            )}

            <div className="pt-2 border-t border-dark-border flex flex-wrap gap-2 items-center">
                <Button
                    size="sm"
                    variant="primary"
                    onClick={onApply}
                    disabled={!canApply}
                    title={canApply ? undefined : 'Select a ship to apply this build'}
                >
                    Apply to autogear
                </Button>
                {canVote ? (
                    <>
                        <Button
                            size="sm"
                            variant={userVote === 'upvote' ? 'primary' : 'secondary'}
                            onClick={() => onVote('upvote')}
                        >
                            Helpful
                        </Button>
                        <Button
                            size="sm"
                            variant={userVote === 'downvote' ? 'danger' : 'secondary'}
                            onClick={() => onVote('downvote')}
                        >
                            Not Helpful
                        </Button>
                    </>
                ) : (
                    <span className="text-xs text-theme-text-secondary">Sign in to vote</span>
                )}
            </div>
        </div>
    );
};
