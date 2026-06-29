import React from 'react';
import { BattleResult } from '../../utils/calculators/battleSimulator';
import type { CombatLogRound } from '../../utils/combat/log/types';

interface RoundEventLogProps {
    /** The hierarchical combat-log round to render (from `BattleResult.combatLog`). */
    round: CombatLogRound | undefined;
    /** Roster (maps actorIds to display names + side). */
    roster: BattleResult['roster'];
}

/**
 * STUB (T9): the lossy `BattleLogEvent[]` render layer was removed; this component now
 * takes the rich hierarchical `CombatLogRound`. The full turn/entry/reaction renderer is
 * the NEXT task (T10) — for now this renders a minimal placeholder so the build stays green.
 *
 * `roster` is threaded through unchanged so T10 can resolve actorIds → display names without
 * touching the parent wiring.
 */
const RoundEventLog: React.FC<RoundEventLogProps> = ({ round }) => {
    const turnCount = round?.turns.length ?? 0;
    return (
        <div className="card">
            <h3 className="text-lg font-semibold mb-2">Round {round?.round ?? '-'} events</h3>
            <p className="text-sm text-theme-text-secondary">
                {turnCount === 0
                    ? 'No events this round.'
                    : `${turnCount} turn${turnCount === 1 ? '' : 's'} this round.`}
            </p>
        </div>
    );
};

export default RoundEventLog;
