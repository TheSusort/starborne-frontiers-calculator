import React from 'react';
import { Button } from '../ui/Button';
import { AIRecommendation } from '../../services/aiRecommendations';

interface AlternativeRecommendationsProps {
    alternatives: AIRecommendation[];
    showAlternatives: boolean;
    selectedAlternative: AIRecommendation | null;
    onToggleShow: () => void;
    onSelectAlternative: (alternative: AIRecommendation) => void;
    onBackToMain: () => void;
}

export const AlternativeRecommendations: React.FC<AlternativeRecommendationsProps> = ({
    alternatives,
    showAlternatives,
    selectedAlternative,
    onToggleShow,
    onSelectAlternative,
    onBackToMain,
}) => {
    if (alternatives.length === 0) {
        return null;
    }

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
        <div className="pt-2 border-t border-gray-600">
            <div className="flex items-center justify-between mb-2">
                <h5 className="text-sm font-semibold text-gray-300">
                    {selectedAlternative
                        ? 'Other Suggestions'
                        : `${alternatives.length} Other Suggestion${alternatives.length === 1 ? '' : 's'}`}
                </h5>
                <div className="flex items-center space-x-2">
                    {selectedAlternative && (
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={onBackToMain}
                            className="text-blue-400 hover:text-blue-300"
                        >
                            Back to Top
                        </Button>
                    )}
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={onToggleShow}
                        className="text-gray-400 hover:text-gray-300"
                    >
                        {showAlternatives ? 'Hide' : 'View'}
                    </Button>
                </div>
            </div>

            {showAlternatives && (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                    {alternatives.map((alt) => (
                        <div
                            key={alt.id}
                            className={`p-3 rounded border cursor-pointer transition-colors ${
                                selectedAlternative?.id === alt.id
                                    ? 'border-blue-500 bg-blue-900/20'
                                    : 'border-gray-600 bg-gray-800/50 hover:border-gray-500'
                            }`}
                            onClick={() => onSelectAlternative(alt)}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-white">
                                    {alt.ship_role}
                                </span>
                                <div className="flex items-center space-x-2 text-xs">
                                    {renderVoteSum(alt.upvotes || 0, alt.downvotes || 0)}
                                </div>
                            </div>
                            <p className="text-xs text-gray-400 line-clamp-2">
                                &ldquo;{alt.reasoning}&rdquo;
                            </p>
                            {selectedAlternative?.id === alt.id && (
                                <div className="mt-2 text-xs text-blue-400">
                                    Currently viewing this suggestion
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
