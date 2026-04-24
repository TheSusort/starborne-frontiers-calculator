import React from 'react';
import { Button } from '../ui/Button';
import { CommunityRecommendation } from '../../types/communityRecommendation';
import { useAuth } from '../../contexts/AuthProvider';
import { useActiveProfile } from '../../contexts/ActiveProfileProvider';

interface CommunityActionsProps {
    recommendation: CommunityRecommendation | null;
    userVote: 'upvote' | 'downvote' | null;
    canShare: boolean;
    showShareForm: boolean;
    onVote: (voteType: 'upvote' | 'downvote') => void;
    onToggleShareForm: () => void;
}

export const CommunityActions: React.FC<CommunityActionsProps> = ({
    recommendation,
    userVote,
    canShare,
    showShareForm,
    onVote,
    onToggleShareForm,
}) => {
    // Votes are one-per-human: gate on auth user, not active profile.
    const { user } = useAuth();
    // Authorship (sharing a recommendation) is per active profile.
    const { activeProfileId } = useActiveProfile();

    return (
        <div className="pt-2 border-t border-dark-border space-y-2">
            {/* Voting for community recommendations — intentionally gated on auth user
                (not activeProfileId) so alt profiles cannot cast duplicate votes. */}
            {recommendation?.id && (
                <div className="flex items-center justify-center space-x-4">
                    {user ? (
                        <>
                            <span className="text-sm text-theme-text-secondary">
                                Rate this recommendation:
                            </span>
                            <Button
                                size="sm"
                                variant={userVote === 'upvote' ? 'primary' : 'secondary'}
                                onClick={() => onVote('upvote')}
                                className="flex items-center space-x-1"
                            >
                                <span>Helpful</span>
                            </Button>
                            <Button
                                size="sm"
                                variant={userVote === 'downvote' ? 'danger' : 'secondary'}
                                onClick={() => onVote('downvote')}
                                className="flex items-center space-x-1"
                            >
                                <span>Not Helpful</span>
                            </Button>
                        </>
                    ) : (
                        <span className="text-sm text-theme-text-secondary">Sign in to vote</span>
                    )}
                </div>
            )}

            {/* Share button section — gated on activeProfileId so each alt profile
                can author its own recommendations independently. */}
            {!showShareForm && (
                <div className="flex items-center justify-center">
                    {activeProfileId ? (
                        canShare ? (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={onToggleShareForm}
                                className="w-full flex items-center justify-center space-x-2"
                            >
                                <span>Share to Community</span>
                            </Button>
                        ) : (
                            <span className="text-sm text-theme-text-secondary">
                                Configure autogear settings to share your build
                            </span>
                        )
                    ) : (
                        <span className="text-sm text-theme-text-secondary">
                            Sign in to share your build
                        </span>
                    )}
                </div>
            )}
        </div>
    );
};
