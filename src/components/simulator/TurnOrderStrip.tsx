import React from 'react';
import { BattleResult } from '../../utils/calculators/battleSimulator';

interface TurnOrderStripProps {
    /** Distinct acting actorIds for the round, in true speed order (`BattleRound.turnOrder`). */
    order: string[];
    /** Roster mapping actorId → { name, side } for labeling each entry. */
    roster: BattleResult['roster'];
}

/**
 * Horizontal strip of a round's turn order (true speed order). Each entry shows the ship name
 * with a side-colored chip; enemy-side ships are prefixed "Enemy " so the two teams read apart.
 * Fed by the current round's `turnOrder` from BattlePlayback.
 */
const TurnOrderStrip: React.FC<TurnOrderStripProps> = ({ order, roster }) => {
    const byId = React.useMemo(() => {
        const map = new Map<string, BattleResult['roster'][number]>();
        for (const entry of roster) map.set(entry.actorId, entry);
        return map;
    }, [roster]);

    const entries = order
        .map((actorId) => byId.get(actorId))
        .filter((e): e is BattleResult['roster'][number] => e !== undefined);

    if (entries.length === 0) return null;

    return (
        <div className="card">
            <h3 className="text-sm font-semibold mb-2 text-theme-text-secondary uppercase tracking-wide">
                Turn order
            </h3>
            <ol className="flex flex-wrap items-center gap-2" aria-label="round turn order">
                {entries.map((entry, index) => (
                    <li
                        key={`${entry.actorId}-${index}`}
                        className="flex items-center gap-1.5 text-xs"
                    >
                        <span className="text-theme-text-secondary w-4 text-right">
                            {index + 1}
                        </span>
                        <span
                            className={`px-2 py-1 rounded border ${
                                entry.side === 'enemy'
                                    ? 'border-red-500/50 text-red-300 bg-red-500/10'
                                    : 'border-green-500/50 text-green-300 bg-green-500/10'
                            }`}
                        >
                            {entry.side === 'enemy' ? `Enemy ${entry.name}` : entry.name}
                        </span>
                    </li>
                ))}
            </ol>
        </div>
    );
};

export default TurnOrderStrip;
