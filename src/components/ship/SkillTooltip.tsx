import React from 'react';

interface Props {
    skillText: string;
    skillType: string;
}

export const SkillTooltip: React.FC<Props> = ({ skillText, skillType }) => {
    if (!skillText) return null;

    return (
        <div className="bg-dark-lighter border border-dark-border p-2 rounded-md shadow-lg max-w-md">
            <div className="font-secondary text-sm text-primary mb-1">{skillType}</div>
            <div className="text-sm text-gray-300">{skillText}</div>
        </div>
    );
};
