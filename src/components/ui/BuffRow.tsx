import React from 'react';
import { ActiveBuff } from '../../utils/combat/statusEngine';

/** Render a buff's remaining-turns label. 'recurring' = always-on aura; 'permanent' =
 *  persistent stacking status (Defense Shred et al.) — both render as unbounded. */
function formatTurns(t: ActiveBuff['turnsRemaining']): string {
    return t === 'recurring' || t === 'permanent' ? '∞' : `${t}t`;
}

interface BuffRowProps {
    buff: ActiveBuff;
    /** Dot colour intent — 'self' (blue) for buffs on the actor, 'enemy' (red) for debuffs
     *  landed on the opposing side. */
    variant: 'self' | 'enemy';
    /** Dimmed + "resisted" label for a debuff that failed to land. */
    resisted?: boolean;
}

/** A single status row: a colour-coded dot, the buff name, an optional stack count, and the
 *  remaining-turns (or "resisted") label. Shared per-round status primitive — reused by the
 *  DPS round overview and the Healing Calculator enemy-effects overview. */
export const BuffRow: React.FC<BuffRowProps> = ({ buff, variant, resisted }) => (
    <div className={`flex items-center gap-1.5 mb-1 ${resisted ? 'opacity-40' : ''}`}>
        <div
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${resisted ? 'bg-dark-border' : variant === 'self' ? 'bg-blue-500' : 'bg-red-500'}`}
        />
        <span className="flex-1 text-xs text-theme-text-primary truncate">{buff.buffName}</span>
        {buff.stacks !== undefined && (
            <span className="text-xs text-theme-text-secondary">×{buff.stacks}</span>
        )}
        {resisted ? (
            <span className="text-xs text-theme-text-secondary italic">resisted</span>
        ) : (
            <span className="text-xs text-theme-text-secondary">
                {formatTurns(buff.turnsRemaining)}
            </span>
        )}
    </div>
);
