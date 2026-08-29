import React, { useMemo } from 'react';
import { Select } from '../ui/Select';
import {
    sortCommunityBuilds,
    isImplantMatch,
    type CommunityBuild,
    type CommunityBuildSort,
} from '../../utils/communityBuild';
import { CommunityBuildRow } from './CommunityBuildRow';
import { CommunityBuildDetails } from './CommunityBuildDetails';

interface CommunityBuildListProps {
    builds: CommunityBuild[];
    equippedUltimateImplant: string | null;
    sort: CommunityBuildSort;
    onSortChange: (sort: CommunityBuildSort) => void;
    expandedId: string | null;
    onToggleExpand: (id: string) => void;
    userVote: 'upvote' | 'downvote' | null;
    canVote: boolean;
    canApply: boolean;
    onVote: (voteType: 'upvote' | 'downvote') => void;
    onApply: (build: CommunityBuild) => void;
}

export const CommunityBuildList: React.FC<CommunityBuildListProps> = ({
    builds,
    equippedUltimateImplant,
    sort,
    onSortChange,
    expandedId,
    onToggleExpand,
    userVote,
    canVote,
    canApply,
    onVote,
    onApply,
}) => {
    const sorted = useMemo(
        () => sortCommunityBuilds(builds, equippedUltimateImplant, sort),
        [builds, equippedUltimateImplant, sort]
    );

    if (sorted.length === 0) {
        return (
            <p className="text-sm text-theme-text-secondary text-center py-2">
                Be the first to share a recommendation for this ship!
            </p>
        );
    }

    return (
        <div className="space-y-2">
            <div className="flex justify-end">
                <Select
                    aria-label="Sort community builds"
                    className="w-36"
                    options={[
                        { value: 'top', label: 'Top rated' },
                        { value: 'newest', label: 'Newest' },
                    ]}
                    value={sort}
                    onChange={(value) => onSortChange(value as CommunityBuildSort)}
                />
            </div>

            {sorted.map((build) => (
                <div key={build.id}>
                    <CommunityBuildRow
                        build={build}
                        isExpanded={expandedId === build.id}
                        isImplantMatch={isImplantMatch(build, equippedUltimateImplant)}
                        onToggle={() => onToggleExpand(build.id)}
                    />
                    {expandedId === build.id && (
                        <div className="border border-t-0 border-dark-border bg-dark-lighter p-3">
                            <CommunityBuildDetails
                                build={build}
                                userVote={userVote}
                                canVote={canVote}
                                canApply={canApply}
                                onVote={onVote}
                                onApply={() => onApply(build)}
                            />
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};
