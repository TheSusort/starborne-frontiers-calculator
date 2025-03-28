import React from 'react';
import { findBuffsInText } from '../../utils/buffUtils';
import { BuffTooltip } from './BuffTooltip';

interface SkillTooltipProps {
    skillText: string;
    skillType: string;
}

export const SkillTooltip: React.FC<SkillTooltipProps> = ({ skillText, skillType }) => {
    const buffs = findBuffsInText(skillText);

    return (
        <>
            <div className="bg-dark-lighter p-2 shadow-lg max-w-xs border border-gray-600">
                <div className="font-semibold text-primary">{skillType}</div>
                <div className="text-sm text-gray-300 mb-2">{skillText}</div>
            </div>

            {buffs.map((buffName) => (
                <BuffTooltip key={buffName} buffName={buffName} />
            ))}
        </>
    );
};
