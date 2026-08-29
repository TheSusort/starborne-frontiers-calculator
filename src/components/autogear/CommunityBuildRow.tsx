import React from 'react';
import { ChevronDownIcon } from '../ui/icons';
import { communityBuildSummary } from '../../utils/communityBuildSummary';
import type { CommunityBuild } from '../../utils/communityBuild';

interface CommunityBuildRowProps {
    build: CommunityBuild;
    isExpanded: boolean;
    isImplantMatch: boolean;
    onToggle: () => void;
}

const VoteSum: React.FC<{ upvotes: number; downvotes: number }> = ({ upvotes, downvotes }) => {
    const sum = upvotes - downvotes;
    if (sum > 0) return <span className="text-green-400 font-medium">+{sum}</span>;
    if (sum < 0) return <span className="text-red-400 font-medium">{sum}</span>;
    return <span className="text-theme-text-secondary">0</span>;
};

/**
 * One collapsed build. The whole row is the expand toggle, which is the
 * accordion-header exception to the "no raw <button>" rule.
 */
export const CommunityBuildRow: React.FC<CommunityBuildRowProps> = ({
    build,
    isExpanded,
    isImplantMatch,
    onToggle,
}) => (
    <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="w-full text-left p-2 border border-dark-border bg-dark hover:bg-dark-lighter transition-colors flex items-start justify-between gap-2"
    >
        <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 flex-wrap">
                <ChevronDownIcon
                    className={`w-3 h-3 text-theme-text-secondary flex-shrink-0 transition-transform duration-200 ${
                        isExpanded ? 'rotate-180' : ''
                    }`}
                />
                <span className="text-sm text-white truncate" data-testid="community-build-title">
                    {build.title}
                </span>
                {build.isImplantSpecific && build.ultimateImplant && (
                    <span
                        className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                            isImplantMatch
                                ? 'bg-purple-900/50 text-purple-200'
                                : 'bg-dark-lighter text-theme-text-secondary'
                        }`}
                    >
                        {build.ultimateImplant}
                    </span>
                )}
                <span className="text-xs px-1.5 py-0.5 rounded bg-dark-lighter text-theme-text-secondary flex-shrink-0">
                    Refit {build.shipRefitLevel}
                </span>
            </span>
            <span className="block text-xs text-theme-text-secondary mt-1 truncate">
                {communityBuildSummary(build.build)}
            </span>
        </span>
        <span className="text-xs flex-shrink-0">
            <VoteSum upvotes={build.upvotes} downvotes={build.downvotes} />
        </span>
    </button>
);
