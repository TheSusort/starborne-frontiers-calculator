import React from 'react';
import { Button } from '../ui/Button';
import { Loader } from '../ui/Loader';
import { AIRecommendation } from '../../services/aiRecommendations';
import { AutogearSuggestion } from '../../types/autogearSuggestion';
import { ChevronDownIcon } from '../ui/icons';

interface RecommendationHeaderProps {
    source: 'community' | 'ai' | null;
    suggestion: AutogearSuggestion | null;
    communityRecommendation: AIRecommendation | null;
    loading: boolean;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onForceAI: () => void;
    onRetry: () => void;
}

export const RecommendationHeader: React.FC<RecommendationHeaderProps> = ({
    source,
    suggestion,
    communityRecommendation,
    loading,
    isExpanded,
    onToggleExpand,
    onForceAI,
    onRetry,
}) => {
    const renderVoteSum = (upvotes: number, downvotes: number) => {
        const sum = upvotes - downvotes;
        if (sum > 0) {
            return <span className="text-green-400">+{sum}</span>;
        } else if (sum < 0) {
            return <span className="text-red-400">{sum}</span>;
        } else {
            return <span className="text-gray-400">0</span>;
        }
    };

    return (
        <div
            onClick={onToggleExpand}
            className="w-full p-4 bg-dark border-b border-dark-border hover:bg-dark-lighter transition-colors text-left text-sm"
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                    <span className="">
                        <ChevronDownIcon
                            className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                        />
                    </span>
                    <span className="">{'Configuration Suggestion'}</span>
                    {source === 'community' && communityRecommendation && (
                        <div className="flex items-center space-x-2">
                            {renderVoteSum(
                                communityRecommendation.upvotes || 0,
                                communityRecommendation.downvotes || 0
                            )}
                            <span className="text-gray-400">
                                ({Math.round((communityRecommendation.score || 0) * 100)}% positive)
                            </span>
                        </div>
                    )}
                </div>
                <div className="flex items-center space-x-2">
                    {loading && (
                        <div className="flex items-center space-x-2">
                            <Loader size="sm" />
                            <span className="text-gray-400 text-sm">Loading...</span>
                        </div>
                    )}
                    {!loading && source === 'community' && (
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                                e.stopPropagation();
                                onForceAI();
                            }}
                            disabled={loading}
                        >
                            Generate
                        </Button>
                    )}
                    {!loading && source !== 'community' && suggestion && (
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                                e.stopPropagation();
                                onRetry();
                            }}
                            disabled={loading}
                        >
                            Generate
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};
