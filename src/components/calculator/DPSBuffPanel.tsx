import React from 'react';
import { ActiveDoTState, RoundData } from '../../utils/calculators/dpsSimulator';
import { ActiveBuff } from '../../utils/calculators/buffTimeline';
import { DoTApplicationEntry, DoTType } from '../../types/calculator';

interface DPSBuffPanelProps {
    ships: Array<{
        name: string;
        roundData: RoundData | null;
    }>;
    totalRounds: number;
    hoveredRound: number | null;
}

function formatTurns(t: ActiveBuff['turnsRemaining']): string {
    return t === 'recurring' ? '∞' : `${t}t`;
}

const DOT_NAMES: Record<DoTType, Record<number, string>> = {
    corrosion: { 3: 'Corrosion I', 6: 'Corrosion II', 9: 'Corrosion III' },
    inferno: { 15: 'Inferno I', 30: 'Inferno II', 45: 'Inferno III' },
    bomb: { 100: 'Bomb I', 200: 'Bomb II', 300: 'Bomb III' },
};

function dotLabel(dot: DoTApplicationEntry): string {
    const name = DOT_NAMES[dot.type]?.[dot.tier] ?? `${dot.type} (${dot.tier})`;
    return dot.stacks > 1 ? `${name} ×${dot.stacks}` : name;
}

function activeDoTLabel(dot: ActiveDoTState): string {
    const name = DOT_NAMES[dot.type]?.[dot.tier] ?? `${dot.type} (${dot.tier})`;
    return dot.stacks > 1 ? `${name} ×${dot.stacks}` : name;
}

const BuffRow: React.FC<{ buff: ActiveBuff; variant: 'self' | 'enemy' }> = ({ buff, variant }) => (
    <div className="flex items-center gap-1.5 mb-1">
        <div
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${variant === 'self' ? 'bg-blue-500' : 'bg-red-500'}`}
        />
        <span className="flex-1 text-xs text-theme-text-primary truncate">{buff.buffName}</span>
        {buff.stacks !== undefined && (
            <span className="text-xs text-theme-text-secondary">×{buff.stacks}</span>
        )}
        <span className="text-xs text-theme-text-secondary">
            {formatTurns(buff.turnsRemaining)}
        </span>
    </div>
);

const ShipSection: React.FC<{ name: string; roundData: RoundData | null }> = ({
    name,
    roundData,
}) => {
    const selfBuffs = roundData?.activeSelfBuffs ?? [];
    const enemyDebuffs = roundData?.activeEnemyDebuffs ?? [];
    const appliedDoTs = roundData?.appliedDoTs ?? [];
    const activeDoTStates = roundData?.activeDoTStates ?? [];

    return (
        <div className="px-2.5 py-2 border-b border-dark-border last:border-b-0">
            <div className="text-xs text-theme-text-secondary uppercase tracking-wide mb-1.5">
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
            {enemyDebuffs.length > 0 && (
                <>
                    <div className="text-xs text-theme-text-secondary mt-2 mb-1">Enemy Debuffs</div>
                    {enemyDebuffs.map((b, i) => (
                        <BuffRow key={`enemy-${b.buffName}-${i}`} buff={b} variant="enemy" />
                    ))}
                </>
            )}
            {appliedDoTs.length > 0 && (
                <>
                    <div className="text-xs text-theme-text-secondary mt-2 mb-1">DoTs Applied</div>
                    {appliedDoTs.map((dot, i) => (
                        <div key={`dot-${i}`} className="flex items-center gap-1.5 mb-1">
                            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-orange-500" />
                            <span className="flex-1 text-xs text-theme-text-primary truncate">
                                {dotLabel(dot)}
                            </span>
                            <span className="text-xs text-theme-text-secondary">
                                {dot.duration}t
                            </span>
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
                                {activeDoTLabel(dot)}
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
            {selfBuffs.length === 0 &&
                enemyDebuffs.length === 0 &&
                appliedDoTs.length === 0 &&
                activeDoTStates.length === 0 && (
                    <p className="text-xs text-dark-border italic">Nothing active</p>
                )}
        </div>
    );
};

export const DPSBuffPanel: React.FC<DPSBuffPanelProps> = ({ ships, totalRounds, hoveredRound }) => (
    <div className="w-48 flex-shrink-0 bg-dark border border-dark-border rounded overflow-hidden">
        <div className="bg-dark-lighter px-2.5 py-1.5 text-xs font-semibold text-theme-text-secondary uppercase tracking-wide">
            {hoveredRound != null ? `Round ${hoveredRound} of ${totalRounds}` : 'Hover a round'}
        </div>
        {ships.map((ship, i) => (
            <ShipSection key={i} name={ship.name} roundData={ship.roundData} />
        ))}
    </div>
);
