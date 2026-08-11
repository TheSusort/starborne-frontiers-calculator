import React from 'react';
import { RoundData } from '../../utils/calculators/dpsSimulator';
import { BuffRow } from '../ui/BuffRow';
import { dotStateLabel } from './dotLabels';

interface DPSBuffPanelProps {
    ships: Array<{
        name: string;
        color: string;
        totalDamage: number;
        roundData: RoundData | null;
    }>;
    totalRounds: number;
    hoveredRound: number | null;
}

/** Plain status-name chip. Mirrors the turn-order chip in ShipConfigSummary so the two
 *  name-list surfaces in the DPS calculator look like one thing. */
const StatusChip: React.FC<{ name: string; tone: 'self' | 'enemy' }> = ({ name, tone }) => (
    <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-dark-lighter ${
            tone === 'enemy' ? 'text-red-400' : 'text-theme-text-primary'
        }`}
    >
        {name}
    </span>
);

const ShipSection: React.FC<{ name: string; color: string; roundData: RoundData | null }> = ({
    name,
    color,
    roundData,
}) => {
    const selfBuffs = roundData?.activeSelfBuffs ?? [];
    const enemyDebuffs = roundData?.activeEnemyDebuffs ?? [];
    const resistedEnemyDebuffs = roundData?.resistedEnemyDebuffs ?? [];
    const appliedDoTs = roundData?.appliedDoTs ?? [];
    const dotsLanded = roundData?.dotsLanded ?? true;
    const activeDoTStates = roundData?.activeDoTStates ?? [];

    // SP-2: the ROUND-TAIL view — what each side still carries after every decrement and drain.
    // The lists above are the focus's TURN-time view; a status that expired at the round tail
    // legitimately appears there and not here.
    const endOfRoundSelfBuffs = roundData?.focusStatuses?.buffNames ?? [];
    // Merged across the enemy roster and de-duplicated: with the single enemy the page ships this
    // is just that enemy's list, and reading only the first entry is the shape #318 had to fix.
    const endOfRoundEnemyDebuffs = [
        ...new Set(Object.values(roundData?.enemyStatuses ?? {}).flatMap((s) => s.debuffNames)),
    ];
    const hasEndOfRound = endOfRoundSelfBuffs.length > 0 || endOfRoundEnemyDebuffs.length > 0;

    const hasDebuffs = enemyDebuffs.length > 0 || resistedEnemyDebuffs.length > 0;
    const hasDoTs = appliedDoTs.length > 0;
    const isEmpty =
        selfBuffs.length === 0 &&
        !hasDebuffs &&
        !hasDoTs &&
        activeDoTStates.length === 0 &&
        !hasEndOfRound;

    return (
        <div className="px-2.5 py-2 border-b border-dark-border last:border-b-0">
            <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color }}>
                {name}
            </div>
            {selfBuffs.length > 0 && (
                <>
                    <div className="text-xs text-theme-text-secondary mb-1">Your Buffs</div>
                    {selfBuffs.map((b, i) => (
                        <BuffRow key={`self-${b.buffName}-${i}`} buff={b} variant="self" />
                    ))}
                </>
            )}
            {hasDebuffs && (
                <>
                    <div className="text-xs text-theme-text-secondary mt-2 mb-1">Enemy Debuffs</div>
                    {enemyDebuffs.map((b, i) => (
                        <BuffRow key={`enemy-${b.buffName}-${i}`} buff={b} variant="enemy" />
                    ))}
                    {resistedEnemyDebuffs.map((b, i) => (
                        <BuffRow
                            key={`resisted-${b.buffName}-${i}`}
                            buff={b}
                            variant="enemy"
                            resisted
                        />
                    ))}
                </>
            )}
            {hasDoTs && (
                <>
                    <div className="text-xs text-theme-text-secondary mt-2 mb-1">
                        {dotsLanded ? 'DoTs Inflicted' : 'DoTs Resisted'}
                    </div>
                    {appliedDoTs.map((dot, i) => (
                        <div
                            key={`dot-${i}`}
                            className={`flex items-center gap-1.5 mb-1 ${!dotsLanded ? 'opacity-40' : ''}`}
                        >
                            <div
                                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotsLanded ? 'bg-orange-500' : 'bg-dark-border'}`}
                            />
                            <span className="flex-1 text-xs text-theme-text-primary truncate">
                                {dotStateLabel(dot)}
                            </span>
                            {dotsLanded ? (
                                <span className="text-xs text-theme-text-secondary">
                                    {dot.duration}t
                                </span>
                            ) : (
                                <span className="text-xs text-theme-text-secondary italic">
                                    resisted
                                </span>
                            )}
                        </div>
                    ))}
                </>
            )}
            {activeDoTStates.length > 0 && (
                <>
                    <div className="text-xs text-theme-text-secondary mt-2 mb-1">Active DoTs</div>
                    {activeDoTStates.map((dot, i) => (
                        <div key={`adot-${i}`} className="flex items-center gap-1.5 mb-1">
                            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-500" />
                            <span className="flex-1 text-xs text-theme-text-primary truncate">
                                {dotStateLabel(dot)}
                            </span>
                            <span className="text-xs text-theme-text-secondary">
                                {dot.type === 'bomb'
                                    ? `det. ${dot.ticksRemaining}t`
                                    : `${dot.ticksRemaining}t`}
                            </span>
                        </div>
                    ))}
                </>
            )}
            {hasEndOfRound && (
                <>
                    <div className="text-xs text-theme-text-secondary mt-2 mb-1">End of Round</div>
                    {endOfRoundSelfBuffs.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                            {endOfRoundSelfBuffs.map((name) => (
                                <StatusChip key={`eor-self-${name}`} name={name} tone="self" />
                            ))}
                        </div>
                    )}
                    {endOfRoundEnemyDebuffs.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                            {endOfRoundEnemyDebuffs.map((name) => (
                                <StatusChip key={`eor-enemy-${name}`} name={name} tone="enemy" />
                            ))}
                        </div>
                    )}
                </>
            )}
            {isEmpty && <p className="text-xs text-dark-border italic">Nothing active</p>}
        </div>
    );
};

export const DPSBuffPanel: React.FC<DPSBuffPanelProps> = ({ ships, totalRounds, hoveredRound }) => (
    <div className="w-48 flex-shrink-0 card !p-0 rounded overflow-hidden">
        <div className="bg-dark-lighter px-2.5 py-1.5 text-xs font-semibold text-theme-text-secondary uppercase tracking-wide">
            {hoveredRound != null ? `Round ${hoveredRound} of ${totalRounds}` : 'Hover a round'}
        </div>
        {ships.map((ship, i) => (
            <ShipSection key={i} name={ship.name} color={ship.color} roundData={ship.roundData} />
        ))}
    </div>
);
