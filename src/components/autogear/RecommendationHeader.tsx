import React from 'react';
import { Loader } from '../ui/Loader';
import { CommunityRecommendation } from '../../types/communityRecommendation';
import { ChevronDownIcon } from '../ui/icons';
import { SHIP_TYPES } from '../../constants';

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
    const getRoleInfo = (role: string) => {
        const roleData = SHIP_TYPES[role];
        return roleData || { name: role, iconUrl: '' };
    };

    const renderVoteSum = (upvotes: number, downvotes: number) => {
        const sum = upvotes - downvotes;
        if (sum > 0) {
            return <span className="text-green-400 font-medium">+{sum}</span>;
        } else if (sum < 0) {
            return <span className="text-red-400 font-medium">{sum}</span>;
        } else {
            return <span className="text-gray-500">0</span>;
        }
    };

    return (
        <div
            onClick={onToggleExpand}
            className="w-full card hover:bg-dark-lighter transition-colors cursor-pointer border-none"
        >
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <ChevronDownIcon
                        className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                    />

                    {loading ? (
                        <div className="flex items-center gap-2">
                            <Loader size="sm" />
                            <span className="text-gray-400 text-sm">Loading...</span>
                        </div>
                    ) : recommendation ? (
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                            {/* Role icon */}
                            {recommendation.ship_role &&
                                getRoleInfo(recommendation.ship_role).iconUrl && (
                                    <img
                                        src={getRoleInfo(recommendation.ship_role).iconUrl}
                                        alt={getRoleInfo(recommendation.ship_role).name}
                                        className="w-4 h-4 flex-shrink-0"
                                    />
                                )}

                            {/* Title */}
                            <span className="text-sm font-medium text-white truncate">
                                {recommendation.title}
                            </span>

                            {/* Role label */}
                            <span className="text-xs text-gray-400 flex-shrink-0">
                                ({getRoleInfo(recommendation.ship_role).name})
                            </span>

                            {/* Implant badge */}
                            {recommendation.is_implant_specific &&
                                recommendation.ultimate_implant && (
                                    <span className="text-xs bg-purple-900/50 text-purple-300 px-1.5 py-0.5 rounded flex-shrink-0">
                                        {recommendation.ultimate_implant}
                                    </span>
                                )}
                        </div>
                    ) : (
                        <span className="text-sm text-gray-400">
                            No community recommendations yet
                        </span>
                    )}
                </div>

                {/* Vote info */}
                {recommendation && !loading && (
                    <div className="flex items-center gap-2 flex-shrink-0 text-xs">
                        {renderVoteSum(recommendation.upvotes || 0, recommendation.downvotes || 0)}
                        <span className="text-gray-500">
                            {Math.round((recommendation.score || 0) * 100)}%
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};
