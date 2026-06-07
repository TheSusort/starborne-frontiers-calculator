import React from 'react';
import { orderByTurnPriority } from '../../utils/combat/state';

/** One actor in a per-config turn-order strip: resolved name, turn-order speed, and side. */
export interface TurnOrderActor {
    name: string;
    speed: number;
    side: 'player' | 'enemy';
}

interface TurnOrderStripProps {
    /**
     * Actors in INPUT order (the caller's contract for equal-speed tiebreaks — list team actors
     * before the acting ship before the enemies, mirroring buildTurnQueue's caller contract).
     * The strip applies the engine's shared `orderByTurnPriority` (speed DESC, player-first,
     * then input order) so the displayed order matches how the round actually resolves.
     */
    actors: TurnOrderActor[];
    /** Heading label; defaults to "Turn Order". */
    title?: string;
}

/**
 * Per-config turn-order strip shared by the DPS and Healing config cards. Renders one chip per
 * actor (position, name, speed) in the engine's resolved order; enemy chips are tinted danger.
 */
export const TurnOrderStrip: React.FC<TurnOrderStripProps> = ({ actors, title = 'Turn Order' }) => {
    const turnOrder = orderByTurnPriority(actors);
    return (
        <div className="mb-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                {title}
            </span>
            <div className="flex flex-wrap gap-1 mt-1" data-testid="turn-order-strip">
                {turnOrder.map((actor, i) => (
                    <span
                        key={`${actor.name}-${i}`}
                        data-testid="turn-order-chip"
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-dark-lighter ${
                            actor.side === 'enemy' ? 'text-red-400' : 'text-theme-text-primary'
                        }`}
                    >
                        <span className="text-theme-text-secondary">{i + 1}</span>
                        <span className="font-medium">{actor.name}</span>
                        <span className="text-theme-text-secondary">{actor.speed}</span>
                    </span>
                ))}
            </div>
        </div>
    );
};
