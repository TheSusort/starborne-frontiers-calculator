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
    /** Controlled round (1-based). When given, the parent owns the playback position and this
     *  component renders no stepper — two playbacks driven by one stepper is the point. A value
     *  past this fight's last round clamps to it, so a shorter fight beside a longer one holds
     *  on its final round. */
    round?: number;
}

export const outcomeLabel = (result: BattleResult): string => {
    const { winner } = result.outcome;
    return winner === 'player' ? 'Your team wins' : winner === 'enemy' ? 'Enemy wins' : 'Draw';
};

/**
 * The playback half of the Combat Simulator: outcome summary, round stepper, the two mirrored
 * BattleBoards, the optional per-ship detail card, and the round event log. Owns the playback
 * position (`currentRound`) when uncontrolled and always owns pinned-ship state, resetting both
 * whenever a fresh `result` arrives.
 */
const BattlePlayback: React.FC<BattlePlaybackProps> = ({ result, round }) => {
    // Round-stepper playback position (1-based).
    const [currentRound, setCurrentRound] = useState(1);
    // Pinned ship (synthetic roster actorId) for the per-ship detail card; null = none.
    const [pinned, setPinned] = useState<string | null>(null);

    // A new simulation resets playback to round 1 and clears the pinned ship.
    useEffect(() => {
        setCurrentRound(1);
        setPinned(null);
    }, [result]);

    // The round shown: the controlled prop when given, else the stepper's own state; clamped to
    // this fight's last round either way.
    const total = result.rounds.length;
    const effectiveRound = round ?? currentRound;
    const curRound = total > 0 ? result.rounds[Math.min(effectiveRound, total) - 1] : undefined;

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

            {curRound && round === undefined && (
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

                    <RoundEventLog
                        round={result.combatLog.find((r) => r.round === curRound.round)}
                        roster={result.roster}
                    />
                </>
            )}
        </>
    );
};

export default BattlePlayback;
