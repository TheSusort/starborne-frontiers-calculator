import React from 'react';
import { SquadLeader, SquadLeaderEffect } from '../../constants/squadLeaders';
import { RARITIES } from '../../constants/rarities';

const STEP_LABELS = ['I', 'II', 'III'] as const;

// Ally-targeted effects read as buffs (green); enemy-targeted effects read as
// debuffs (red) — mirrors the buff/debuff colouring on the Effect Index page.
const effectColorClass = (effect: SquadLeaderEffect): string =>
    effect.target === 'all-enemies' ? 'text-red-400' : 'text-green-400';

const EffectLine: React.FC<{ effect: SquadLeaderEffect }> = ({ effect }) => (
    <li className={`text-sm ${effectColorClass(effect)}`}>
        {effect.text}
        {effect.recurrence === 'per-round' && (
            <span className="text-theme-text-secondary"> (per round)</span>
        )}
        {effect.condition && (
            <span className="text-theme-text-secondary"> — {effect.condition.text}</span>
        )}
    </li>
);

interface Props {
    leader: SquadLeader;
}

export const SquadLeaderCard: React.FC<Props> = ({ leader }) => {
    const rarity = RARITIES[leader.rarity];

    return (
        <div className={`bg-dark p-4 border ${rarity.borderColor}`}>
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold">{leader.name}</h3>
                <span className={`text-xs uppercase font-medium ${rarity.textColor}`}>
                    {rarity.label}
                </span>
            </div>

            <div className="space-y-3">
                {leader.stages.map((effects, stepIndex) =>
                    effects.length > 0 ? (
                        <div key={stepIndex} className="flex gap-3">
                            <span className="w-6 shrink-0 text-sm font-semibold text-theme-text-secondary">
                                {STEP_LABELS[stepIndex]}
                            </span>
                            <ul className="space-y-1">
                                {effects.map((effect, effectIndex) => (
                                    <EffectLine key={effectIndex} effect={effect} />
                                ))}
                            </ul>
                        </div>
                    ) : null
                )}
            </div>
        </div>
    );
};

export default SquadLeaderCard;
