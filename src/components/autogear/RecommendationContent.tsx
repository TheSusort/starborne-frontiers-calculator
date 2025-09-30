import React from 'react';
import { AutogearSuggestion } from '../../types/autogearSuggestion';

interface RecommendationContentProps {
    suggestion: AutogearSuggestion;
}

export const RecommendationContent: React.FC<RecommendationContentProps> = ({ suggestion }) => {
    return (
        <div className="space-y-4">
            {/* Role Suggestion */}
            <div>
                <h5 className="text-sm font-semibold text-gray-300 mb-1">Recommended Role:</h5>
                <span className="inline-block px-2 py-1 bg-blue-900/50 text-blue-200 text-sm">
                    {suggestion.shipRole}
                </span>
            </div>

            <div className="flex space-x-4 divide-x divide-gray-700 *:ps-4 -mx-4">
                {/* Stat Priorities */}
                {suggestion.statPriorities && suggestion.statPriorities.length > 0 && (
                    <div>
                        <h5 className="text-sm font-semibold text-gray-300 mb-2">
                            Stat Priorities:
                        </h5>
                        <div className="space-y-1">
                            {suggestion.statPriorities.map((priority, index) => (
                                <div
                                    key={index}
                                    className="flex items-center justify-between text-sm"
                                >
                                    {(priority.minLimit || priority.maxLimit) && (
                                        <>
                                            <span className="text-gray-200 capitalize">
                                                {priority.stat}
                                                {': '}
                                            </span>
                                            <div className="flex items-center ms-2">
                                                <span className="text-yellow-400">
                                                    {priority.minLimit &&
                                                        `min ${priority.minLimit}`}{' '}
                                                    {priority.maxLimit &&
                                                        `max ${priority.maxLimit}`}
                                                    {priority.reasoning && (
                                                        <span className="text-gray-400">
                                                            {priority.reasoning}
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Stat Bonuses */}
                {suggestion.statBonuses && suggestion.statBonuses.length > 0 && (
                    <div>
                        <h5 className="text-sm font-semibold text-gray-300 mb-2">Stat Bonuses:</h5>
                        <div className="space-y-1">
                            {suggestion.statBonuses.map((bonus, index) => (
                                <div
                                    key={index}
                                    className="flex items-center justify-between text-sm"
                                >
                                    <span className="text-gray-200 capitalize">
                                        {bonus.stat}
                                        {': '}
                                    </span>
                                    <div className="flex items-center space-x-2 ms-2">
                                        <span className="text-yellow-400">{bonus.weight}</span>
                                        {bonus.reasoning && (
                                            <span className="text-gray-400">{bonus.reasoning}</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Set Priorities */}
                {suggestion.setPriorities && suggestion.setPriorities.length > 0 && (
                    <div>
                        <h5 className="text-sm font-semibold text-gray-300 mb-2">
                            Gear Set Priorities:
                        </h5>
                        <div className="space-y-1">
                            {suggestion.setPriorities.map((setPriority, index) => (
                                <div
                                    key={index}
                                    className="flex items-center justify-between text-sm"
                                >
                                    <span className="text-gray-200">{setPriority.setName}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Reasoning */}
            <div>
                <h5 className="text-sm font-semibold text-gray-300 mb-1">Reasoning:</h5>
                <p className="text-sm text-gray-400 italic">&ldquo;{suggestion.reasoning}&rdquo;</p>
            </div>
        </div>
    );
};
