import React from 'react';
import { Loader } from '../ui/Loader';
import { ChevronDownIcon } from '../ui/icons';

interface RecommendationHeaderProps {
    buildCount: number;
    loading: boolean;
    isExpanded: boolean;
    onToggleExpand: () => void;
}

export const RecommendationHeader: React.FC<RecommendationHeaderProps> = ({
    buildCount,
    loading,
    isExpanded,
    onToggleExpand,
}) => (
    <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        className="w-full card hover:bg-dark-lighter transition-colors cursor-pointer border-none text-left"
    >
        <span className="flex items-center gap-2">
            <ChevronDownIcon
                className={`w-4 h-4 text-theme-text-secondary flex-shrink-0 transition-transform duration-200 ${
                    isExpanded ? 'rotate-180' : ''
                }`}
            />
            {loading ? (
                <span className="flex items-center gap-2">
                    <Loader size="sm" />
                    <span className="text-theme-text-secondary text-sm">Loading...</span>
                </span>
            ) : buildCount > 0 ? (
                <span className="text-sm font-medium text-white">
                    {buildCount} community {buildCount === 1 ? 'build' : 'builds'}
                </span>
            ) : (
                <span className="text-sm text-theme-text-secondary">No community builds yet</span>
            )}
        </span>
    </button>
);
