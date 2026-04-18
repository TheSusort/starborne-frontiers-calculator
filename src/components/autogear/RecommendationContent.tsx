import React from 'react';
import { AutogearSuggestion } from '../../types/autogearSuggestion';
import { SHIP_TYPES } from '../../constants';

interface RecommendationContentProps {
    suggestion: AutogearSuggestion;
}

export const RecommendationContent: React.FC<RecommendationContentProps> = ({ suggestion }) => {
    const getRoleInfo = (role: string) => {
        const roleData = SHIP_TYPES[role];
        return roleData || { name: role, iconUrl: '' };
    };

    const roleInfo = getRoleInfo(suggestion.shipRole);

    return (
        <div className="space-y-4">
            {/* Role Suggestion */}
            <div>
                <h5 className="text-sm font-semibold text-theme-text mb-1">Recommended Role:</h5>
                <span className="inline-flex items-center gap-2 px-2 py-1 bg-blue-900/50 text-blue-200 text-sm">
                    {roleInfo.iconUrl && (
                        <img src={roleInfo.iconUrl} alt={roleInfo.name} className="w-4 h-4" />
                    )}
                    {roleInfo.name}
                </span>
            </div>

            <div className="flex flex-wrap gap-4">
                {/* Stat Priorities */}
                {suggestion.statPriorities && suggestion.statPriorities.length > 0 && (
                    <div>
                        <h5 className="text-sm font-semibold text-theme-text mb-2">
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
                                            <span className="text-theme-text capitalize">
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
                                                        <span className="text-theme-text-secondary">
                                                            {priority.reasoning}
                                                        </span>
                                                    )}
                                                    {priority.hardRequirement && (
                                                        <span> (strict)</span>
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
                        <h5 className="text-sm font-semibold text-theme-text mb-2">
                            Stat Bonuses:
                        </h5>
                        <div className="space-y-1">
                            {suggestion.statBonuses.map((bonus, index) => (
                                <div
                                    key={index}
                                    className="flex items-center justify-between text-sm"
                                >
                                    <span className="text-theme-text capitalize">
                                        {bonus.stat}
                                        {': '}
                                    </span>
                                    <div className="flex items-center space-x-2 ms-2">
                                        <span className="text-yellow-400">{bonus.weight}</span>
                                        {bonus.reasoning && (
                                            <span className="text-theme-text-secondary">
                                                {bonus.reasoning}
                                            </span>
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
                        <h5 className="text-sm font-semibold text-theme-text mb-2">
                            Gear Set Priorities:
                        </h5>
                        <div className="space-y-1">
                            {suggestion.setPriorities.map((setPriority, index) => (
                                <div
                                    key={index}
                                    className="flex items-center justify-between text-sm"
                                >
                                    <span className="text-theme-text">{setPriority.setName}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Reasoning */}
            {suggestion.reasoning && (
                <div>
                    <h5 className="text-sm font-semibold text-theme-text mb-1">Reasoning:</h5>
                    <p className="text-sm text-theme-text-secondary italic">
                        &ldquo;{suggestion.reasoning}&rdquo;
                    </p>
                </div>
            )}
        </div>
    );
};
