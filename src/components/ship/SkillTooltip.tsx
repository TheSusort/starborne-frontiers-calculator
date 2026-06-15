import React from 'react';
import { parseSkillText, extractSkillNames } from '../../utils/skillTextParser';
import { ClockIcon } from '../ui/icons';
import { SkillTargeting } from '../../utils/targetingParser';
import { BuffTooltip } from './BuffTooltip';
import { SkillTargetingBoard } from './SkillTargetingBoard';

interface SkillTooltipProps {
    skillText: string;
    skillType: string;
    charge?: number;
    inline?: boolean;
    targeting?: SkillTargeting;
}

export const SkillTooltip: React.FC<SkillTooltipProps> = ({
    skillText,
    skillType,
    charge,
    inline,
    targeting,
}) => {
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

    const content = (
        <>
            <div className="flex items-center gap-2">
                <span className="font-semibold text-primary">{skillType}</span>
                {charge !== undefined && (
                    <span className="flex items-center gap-1 font-medium">
                        <ClockIcon className="w-3.5 h-3.5" />
                        {charge}
                    </span>
                )}
            </div>
            <div className="text-sm text-theme-text mb-2">
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
                                        <div className="text-sm text-theme-text">
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
        </>
    );

    if (inline) {
        return (
            <>
                {targeting && <SkillTargetingBoard targeting={targeting} skillText={skillText} />}
                {content}
            </>
        );
    }

    return (
        <>
            {targeting && <SkillTargetingBoard targeting={targeting} skillText={skillText} />}
            <div className="bg-dark-lighter p-2 shadow-lg max-w-xs border border-dark-border">
                {content}
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
