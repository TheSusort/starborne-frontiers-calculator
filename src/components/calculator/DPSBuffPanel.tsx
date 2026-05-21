import React from 'react';
import { RoundData } from '../../utils/calculators/dpsSimulator';
import { ActiveBuff } from '../../utils/calculators/buffTimeline';

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

const BuffRow: React.FC<{ buff: ActiveBuff; variant: 'self' | 'enemy' }> = ({ buff, variant }) => (
    <div className="flex items-center gap-1.5 mb-1">
        <div
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${variant === 'self' ? 'bg-blue-500' : 'bg-red-500'}`}
        />
        <span className="flex-1 text-xs text-theme-text-primary truncate">{buff.buffName}</span>
        <span className="text-xs text-theme-text-secondary">
            {formatTurns(buff.turnsRemaining)}
        </span>
    </div>
);

const ShipSection: React.FC<{ name: string; roundData: RoundData | null }> = ({
    name,
    roundData,
}) => (
    <div className="px-2.5 py-2 border-b border-dark-border last:border-b-0">
        <div className="text-xs text-theme-text-secondary uppercase tracking-wide mb-1.5">
            {name}
        </div>
        <div className="text-xs text-theme-text-secondary mb-1">Your Buffs</div>
        {roundData && roundData.activeSelfBuffs.length > 0 ? (
            roundData.activeSelfBuffs.map((b, i) => (
                <BuffRow key={`self-${b.buffName}-${i}`} buff={b} variant="self" />
            ))
        ) : (
            <p className="text-xs text-dark-border italic mb-1">None active</p>
        )}
        <div className="text-xs text-theme-text-secondary mt-2 mb-1">Enemy Debuffs</div>
        {roundData && roundData.activeEnemyDebuffs.length > 0 ? (
            roundData.activeEnemyDebuffs.map((b, i) => (
                <BuffRow key={`enemy-${b.buffName}-${i}`} buff={b} variant="enemy" />
            ))
        ) : (
            <p className="text-xs text-dark-border italic">None active</p>
        )}
    </div>
);

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
