import React, { useState } from 'react';
import { GEAR_SLOTS } from '../../constants/gearTypes';
import { UpgradeSuggestion } from '../../types/analysis';
import { Tooltip } from '../ui/layout/Tooltip';
import { InfoIcon } from '../ui/icons/InfoIcon';

interface Props {
    suggestions: UpgradeSuggestion[];
}

export const UpgradeSuggestions: React.FC<Props> = ({ suggestions }) => {
    const [tooltips, setTooltips] = useState<Record<string, boolean>>({});
    const [tooltipContent, setTooltipContent] = useState<Record<string, string>>({});

    const handleMouseEnter = (id: string, reason: string) => {
        setTooltipContent((prev) => ({ ...prev, [id]: reason }));
        setTooltips((prev) => ({ ...prev, [id]: true }));
    };

    const handleMouseLeave = (id: string) => {
        setTooltips((prev) => ({ ...prev, [id]: false }));
    };

    if (suggestions.length === 0) return null;

    return (
        <section className="bg-dark p-4">
            <h3 className="font-semibold">Upgrade Suggestions (EXPERIMENTAL)</h3>
            <p className="text-xs text-gray-400 mb-4">
                <span>
                    These are suggestions for upgrading your gear, based on the gear contribution
                    and the ship&apos;s final score.
                </span>
            </p>
            <div className="space-y-3">
                {suggestions.map((suggestion) => (
                    <div
                        key={suggestion.slotName}
                        className={`p-3 border-l-4 ${
                            suggestion.priority! <
                            GEAR_SLOTS[suggestion.slotName].expectedContribution - 5
                                ? 'border-red-500 bg-red-900/20'
                                : suggestion.priority! <
                                    GEAR_SLOTS[suggestion.slotName].expectedContribution - 2
                                  ? 'border-yellow-500 bg-yellow-900/20'
                                  : 'border-blue-500 bg-blue-900/20'
                        }`}
                    >
                        <div className="flex flex-col mb-1">
                            <span className="font-medium">
                                {GEAR_SLOTS[suggestion.slotName].label}
                            </span>
                            {suggestion.priority && (
                                <span className="text-xs w-full">
                                    {suggestion.priority.toFixed(1)}% is a{' '}
                                    {suggestion.priority! <
                                    GEAR_SLOTS[suggestion.slotName].expectedContribution - 5
                                        ? 'very'
                                        : suggestion.priority! <
                                            GEAR_SLOTS[suggestion.slotName].expectedContribution - 2
                                          ? ''
                                          : 'fairly'}{' '}
                                    low contribution for a {GEAR_SLOTS[suggestion.slotName].label}{' '}
                                    piece
                                </span>
                            )}
                            {suggestion.currentLevel !== 16 && (
                                <span className="text-sm">
                                    Level {suggestion.currentLevel} → 16
                                </span>
                            )}
                        </div>
                        <ul className="text-sm text-gray-400 list-disc ml-4">
                            {suggestion.reasons.map((reason, index) => {
                                const tooltipId = `${suggestion.slotName}-${index}`;
                                return (
                                    <li key={index}>
                                        <span
                                            className="font-bold text-xs inline-flex items-center"
                                            onMouseEnter={() =>
                                                handleMouseEnter(tooltipId, reason.reason)
                                            }
                                            onMouseLeave={() => handleMouseLeave(tooltipId)}
                                        >
                                            {reason.title} <InfoIcon />
                                        </span>
                                        <Tooltip isVisible={tooltips[tooltipId] || false}>
                                            <span className="text-gray-400 bg-dark-lighter p-2 border border-gray-300">
                                                {tooltipContent[tooltipId]}
                                            </span>
                                        </Tooltip>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </div>
        </section>
    );
};
