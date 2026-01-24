import React from 'react';
import { Loader } from '../ui/Loader';
import { CommunityRecommendation } from '../../types/communityRecommendation';
import { ChevronDownIcon } from '../ui/icons';

interface RecommendationHeaderProps {
    recommendation: CommunityRecommendation | null;
    loading: boolean;
    isExpanded: boolean;
    onToggleExpand: () => void;
}

export const RecommendationHeader: React.FC<RecommendationHeaderProps> = ({
    recommendation,
    loading,
    isExpanded,
    onToggleExpand,
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

    const renderContent = () => {
        if (loading) {
            return (
                <div className="flex items-center space-x-2">
                    <Loader size="sm" />
                    <span className="text-gray-400">Loading recommendations...</span>
                </div>
            );
        }

        if (recommendation) {
            return (
                <div className="flex items-center space-x-2">
                    <span>{recommendation.title}</span>
                    {recommendation.is_implant_specific && recommendation.ultimate_implant && (
                        <span className="text-xs bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded">
                            {recommendation.ultimate_implant}
                        </span>
                    )}
                    {renderVoteSum(recommendation.upvotes || 0, recommendation.downvotes || 0)}
                    <span className="text-gray-400">
                        ({Math.round((recommendation.score || 0) * 100)}% positive)
                    </span>
                </div>
            );
        }

        return <span>Community Recommendations</span>;
    };

    return (
        <div
            onClick={onToggleExpand}
            className="w-full p-4 bg-dark border-b border-dark-border hover:bg-dark-lighter transition-colors text-left text-sm cursor-pointer"
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                    <span>
                        <ChevronDownIcon
                            className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                        />
                    </span>
                    {renderContent()}
                </div>
            </div>
        </div>
    );
};
