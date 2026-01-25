import React from 'react';
import { Button } from '../ui/Button';
import { CommunityRecommendation } from '../../types/communityRecommendation';
import { useAuth } from '../../contexts/AuthProvider';

interface CommunityActionsProps {
    recommendation: CommunityRecommendation | null;
    userVote: 'upvote' | 'downvote' | null;
    hasRunAutogear: boolean;
    showShareForm: boolean;
    onVote: (voteType: 'upvote' | 'downvote') => void;
    onToggleShareForm: () => void;
}

export const CommunityActions: React.FC<CommunityActionsProps> = ({
    recommendation,
    userVote,
    hasRunAutogear,
    showShareForm,
    onVote,
    onToggleShareForm,
}) => {
    const { user } = useAuth();

    return (
        <div className="pt-2 border-t border-gray-600 space-y-2">
            {/* Voting for community recommendations */}
            {recommendation?.id && (
                <div className="flex items-center justify-center space-x-4">
                    {user ? (
                        <>
                            <span className="text-sm text-gray-400">Rate this recommendation:</span>
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
                        <span className="text-sm text-gray-400">Sign in to vote</span>
                    )}
                </div>
            )}

            {/* Share button section */}
            {!showShareForm && (
                <div className="flex items-center justify-center">
                    {user ? (
                        hasRunAutogear ? (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={onToggleShareForm}
                                className="w-full flex items-center justify-center space-x-2"
                            >
                                <span>Share to Community</span>
                            </Button>
                        ) : (
                            <span className="text-sm text-gray-500">
                                Run autogear to share your build
                            </span>
                        )
                    ) : (
                        <span className="text-sm text-gray-400">Sign in to share your build</span>
                    )}
                </div>
            )}
        </div>
    );
};
