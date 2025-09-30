import React from 'react';
import { Button } from '../ui/Button';
import { AIRecommendation } from '../../services/aiRecommendations';
import { AutogearSuggestion } from '../../types/autogearSuggestion';

interface CommunityActionsProps {
    source: 'community' | 'ai' | null;
    suggestion: AutogearSuggestion | null;
    communityRecommendation: AIRecommendation | null;
    userVote: 'upvote' | 'downvote' | null;
    onVote: (voteType: 'upvote' | 'downvote') => void;
    onSaveToCommmunity: () => void;
    onApplyConfig?: (config: AutogearSuggestion) => void;
}

export const CommunityActions: React.FC<CommunityActionsProps> = ({
    source,
    suggestion,
    communityRecommendation,
    userVote,
    onVote,
    onSaveToCommmunity,
    onApplyConfig,
}) => {
    return (
        <div className="pt-2 border-t border-gray-600 space-y-2">
            {/* Voting for community recommendations */}
            {source === 'community' && communityRecommendation?.id && (
                <div className="flex items-center justify-center space-x-4">
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
                </div>
            )}

            {/* Save AI recommendation to community */}
            {source === 'ai' && suggestion && (
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={onSaveToCommmunity}
                    className="w-full flex items-center justify-center space-x-2"
                >
                    <span>Save for Community</span>
                </Button>
            )}

            {/* Apply Button (for future enhancement) */}
            {onApplyConfig && suggestion && (
                <Button
                    size="sm"
                    variant="primary"
                    onClick={() => onApplyConfig(suggestion)}
                    className="w-full"
                >
                    Apply Configuration
                </Button>
            )}
        </div>
    );
};
