import React, { useEffect, useState } from 'react';
import { BattleResult } from '../../utils/calculators/battleSimulator';
import { StatCard } from '../ui/StatCard';
import { overlaysForRound } from '../../utils/simulator/boardOverlays';
import RoundStepper from './RoundStepper';
import BattleBoard from './BattleBoard';
import ShipRoundCard from './ShipRoundCard';
import RoundEventLog from './RoundEventLog';
import TurnOrderStrip from './TurnOrderStrip';

interface BattlePlaybackProps {
    /** A completed simulation. Owns the round-stepper position and pinned-ship detail card. */
    result: BattleResult;
}

const outcomeLabel = (result: BattleResult): string => {
    const { winner } = result.outcome;
    return winner === 'player' ? 'Your team wins' : winner === 'enemy' ? 'Enemy wins' : 'Draw';
};

/**
 * The playback half of the Combat Simulator: outcome summary, round stepper, the two mirrored
 * BattleBoards, the optional per-ship detail card, and the round event log. Owns the playback
 * position (`currentRound`) and pinned-ship state, resetting both whenever a fresh `result`
 * arrives (the parent page no longer tracks these).
 */
const BattlePlayback: React.FC<BattlePlaybackProps> = ({ result }) => {
    // Round-stepper playback position (1-based).
    const [currentRound, setCurrentRound] = useState(1);
    // Pinned ship (synthetic roster actorId) for the per-ship detail card; null = none.
    const [pinned, setPinned] = useState<string | null>(null);

    // A new simulation resets playback to round 1 and clears the pinned ship.
    useEffect(() => {
        setCurrentRound(1);
        setPinned(null);
    }, [result]);

    // The round currently shown by the stepper (1-based, clamped to the trimmed rounds).
    const total = result.rounds.length;
    const curRound = total > 0 ? result.rounds[Math.min(currentRound, total) - 1] : undefined;

    return (
        <>
            <StatCard
                title="Outcome"
                value={outcomeLabel(result)}
                subtitle={`Round ${result.outcome.lastRound}`}
                color={
                    result.outcome.winner === 'player'
                        ? 'green'
                        : result.outcome.winner === 'enemy'
                          ? 'red'
                          : 'yellow'
                }
            />

            {curRound && (
                <RoundStepper
                    round={Math.min(currentRound, total)}
                    total={total}
                    onChange={setCurrentRound}
                />
            )}

            {curRound && (
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <BattleBoard
                            title="Your Team"
                            overlays={overlaysForRound(curRound, 'player', result.roster)}
                            pinnedActorId={pinned}
                            onPinShip={setPinned}
                        />
                        <BattleBoard
                            title="Enemy Team"
                            overlays={overlaysForRound(curRound, 'enemy', result.roster)}
                            mirrored
                            pinnedActorId={pinned}
                            onPinShip={setPinned}
                        />
                    </div>

                    <TurnOrderStrip order={curRound.turnOrder} roster={result.roster} />

                    {pinned && (
                        <ShipRoundCard actorId={pinned} round={curRound} roster={result.roster} />
                    )}

                    <RoundEventLog round={curRound} roster={result.roster} />
                </>
            )}
        </>
    );
};

export default BattlePlayback;
