import React from 'react';
import { BattleRound, BattleResult, BattleLogEvent } from '../../utils/calculators/battleSimulator';
import { fmt } from '../../utils/simulator/boardOverlays';

interface RoundEventLogProps {
    /** The current round whose events to render. */
    round: BattleRound;
    /** Roster (maps actorIds to display names + side). */
    roster: BattleResult['roster'];
}

/**
 * Scrollable, team-labeled readable log of the current round's events. Maps actorIds to
 * names via the roster, prefixing enemy-side ships with "Enemy ", and colors each line by
 * kind:
 *   - damage: "Enemy Selenite took 2,140"      (red)
 *   - heal:   "Graphite heals Judge for 1,411"  (green)
 *   - buff:   "Sentinel gains Attack Up"         (cyan)
 *   - debuff: "Enemy Curator afflicted with Def Down" (amber)
 *   - dot:    "Enemy Selenite afflicted with Corrosion" (purple)
 *   - death:  "Enemy Selenite destroyed"         (gray)
 */
const RoundEventLog: React.FC<RoundEventLogProps> = ({ round, roster }) => {
    /** Resolve an actorId to its team-labeled display name (enemy → "Enemy X"). */
    const nameOf = (actorId: string | undefined): string => {
        if (!actorId) return 'Unknown';
        const entry = roster.find((r) => r.actorId === actorId);
        if (!entry) return actorId;
        return entry.side === 'enemy' ? `Enemy ${entry.name}` : entry.name;
    };

    /** Title-case a buff/dot label (e.g. "corrosion" → "Corrosion"). */
    const labelOf = (label: string | undefined): string => {
        if (!label) return '';
        return label.charAt(0).toUpperCase() + label.slice(1);
    };

    const lineFor = (e: BattleLogEvent): string => {
        switch (e.kind) {
            case 'damage':
                return `${nameOf(e.actorId)} took ${fmt(e.amount ?? 0)}`;
            case 'heal':
                return e.targetId
                    ? `${nameOf(e.actorId)} heals ${nameOf(e.targetId)} for ${fmt(e.amount ?? 0)}`
                    : `${nameOf(e.actorId)} heals for ${fmt(e.amount ?? 0)}`;
            case 'buff':
                return `${nameOf(e.actorId)} gains ${labelOf(e.label)}`;
            case 'debuff':
            case 'dot':
                return `${nameOf(e.actorId)} afflicted with ${labelOf(e.label)}`;
            case 'death':
                return `${nameOf(e.actorId)} destroyed`;
        }
    };

    const colorFor = (kind: BattleLogEvent['kind']): string => {
        switch (kind) {
            case 'damage':
                return 'text-red-400';
            case 'heal':
                return 'text-green-400';
            case 'buff':
                return 'text-cyan-400';
            case 'debuff':
                return 'text-amber-400';
            case 'dot':
                return 'text-purple-400';
            case 'death':
                return 'text-theme-text-secondary';
        }
    };

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
