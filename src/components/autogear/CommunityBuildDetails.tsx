import React from 'react';
import { Button } from '../ui/Button';
import type { CommunityBuild } from '../../utils/communityBuild';
import { SharedBuildFields } from './SharedBuildFields';

interface CommunityBuildDetailsProps {
    build: CommunityBuild;
    userVote: 'upvote' | 'downvote' | null;
    canVote: boolean;
    canApply: boolean;
    onVote: (voteType: 'upvote' | 'downvote') => void;
    onApply: () => void;
}

export const CommunityBuildDetails: React.FC<CommunityBuildDetailsProps> = ({
    build,
    userVote,
    canVote,
    canApply,
    onVote,
    onApply,
}) => {
    return (
        <div className="space-y-3 text-sm">
            {build.description && (
                <p className="text-theme-text-secondary italic">
                    &ldquo;{build.description}&rdquo;
                </p>
            )}

            <SharedBuildFields build={build.build} />

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
