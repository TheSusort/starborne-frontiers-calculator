import React from 'react';
import { parseSkillText, extractSkillNames } from '../../utils/skillTextParser';
import { BuffTooltip } from './BuffTooltip';

interface SkillTooltipProps {
    skillText: string;
    skillType: string;
}

export const SkillTooltip: React.FC<SkillTooltipProps> = ({ skillText, skillType }) => {
    const segments = parseSkillText(skillText);
    const skillNames = extractSkillNames(skillText);

    // Helper to render text with line breaks
    const renderTextWithBreaks = (text: string) => {
        const parts = text.split('<br />');
        return parts.map((part, i) => (
            <React.Fragment key={i}>
                {part}
                {i < parts.length - 1 && <br />}
            </React.Fragment>
        ));
    };

    return (
        <>
            <div className="bg-dark-lighter p-2 shadow-lg max-w-xs border border-gray-600">
                <div className="font-semibold text-primary">{skillType}</div>
                <div className="text-sm text-gray-300 mb-2">
                    {segments.map((segment, index) => {
                        if (segment.type === 'text') {
                            return <span key={index}>{renderTextWithBreaks(segment.text)}</span>;
                        }

                        if (segment.type === 'unit-skill') {
                            // Skill/buff names with tooltip on hover
                            return (
                                <span key={index} className="relative group inline-block">
                                    <span className="skill-name">{segment.text}</span>
                                    {segment.buffDescription && (
                                        <div className="skill-tooltip">
                                            <div className="font-semibold text-sm text-primary capitalize">
                                                {segment.text}
                                            </div>
                                            <div className="text-sm text-gray-300">
                                                {segment.buffDescription}
                                            </div>
                                        </div>
                                    )}
                                </span>
                            );
                        }

                        if (segment.type === 'unit-damage') {
                            // Damage values in red/orange
                            return (
                                <span key={index} className="skill-damage">
                                    {renderTextWithBreaks(segment.text)}
                                </span>
                            );
                        }

                        if (segment.type === 'unit-aid') {
                            // Beneficial effects in green
                            return (
                                <span key={index} className="skill-aid">
                                    {renderTextWithBreaks(segment.text)}
                                </span>
                            );
                        }

                        return null;
                    })}
                </div>
            </div>

            {/* Show buff tooltips below for skills that have descriptions */}
            {skillNames
                .filter((name) => {
                    const segment = segments.find(
                        (s) => s.type === 'unit-skill' && s.text === name
                    );
                    return segment?.buffDescription;
                })
                .map((buffName) => (
                    <BuffTooltip key={buffName} buffName={buffName} />
                ))}
        </>
    );
};
