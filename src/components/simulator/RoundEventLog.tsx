import React from 'react';
import { BattleRound, BattleResult, BattleLogEvent } from '../../utils/calculators/battleSimulator';

interface RoundEventLogProps {
    /** The current round whose events to render. */
    round: BattleRound;
    /** Roster (maps actorIds to display names). */
    roster: BattleResult['roster'];
}

const fmt = (n: number): string => Math.round(n).toLocaleString();

/**
 * Scrollable readable log of the current round's events. Maps actorIds to names via the
 * roster:
 *   - damage: "Nova -> Hexa: 2,140"
 *   - heal:   "Medic heals Nova: 800"
 *   - death:  "Hexa destroyed"
 */
const RoundEventLog: React.FC<RoundEventLogProps> = ({ round, roster }) => {
    const nameOf = (actorId: string | undefined): string => {
        if (!actorId) return 'Unknown';
        return roster.find((r) => r.actorId === actorId)?.name ?? actorId;
    };

    const lineFor = (e: BattleLogEvent): string => {
        if (e.kind === 'damage') {
            return `${nameOf(e.actorId)} -> ${nameOf(e.targetId)}: ${fmt(e.amount ?? 0)}`;
        }
        if (e.kind === 'heal') {
            return e.targetId
                ? `${nameOf(e.actorId)} heals ${nameOf(e.targetId)}: ${fmt(e.amount ?? 0)}`
                : `${nameOf(e.actorId)} heals: ${fmt(e.amount ?? 0)}`;
        }
        return `${nameOf(e.actorId)} destroyed`;
    };

    const colorFor = (kind: BattleLogEvent['kind']): string =>
        kind === 'damage'
            ? 'text-red-400'
            : kind === 'heal'
              ? 'text-green-400'
              : 'text-theme-text-secondary';

    return (
        <div className="card">
            <h3 className="text-lg font-semibold mb-2">Round {round.round} events</h3>
            {round.events.length === 0 ? (
                <p className="text-sm text-theme-text-secondary">No events this round.</p>
            ) : (
                <ul className="max-h-64 overflow-y-auto space-y-1 text-sm">
                    {round.events.map((e, i) => (
                        <li key={i} className={colorFor(e.kind)}>
                            {lineFor(e)}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default RoundEventLog;
