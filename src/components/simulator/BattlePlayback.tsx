import React, { useEffect, useMemo, useState } from 'react';
import { BattleResult } from '../../utils/calculators/battleSimulator';
import type { Position } from '../../types/encounters';
import { ALL_POSITIONS } from '../../utils/targeting/board';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { StatCard } from '../ui/StatCard';
import { Button } from '../ui/Button';
import { ChevronLeftIcon, ChevronRightIcon } from '../ui/icons';
import { AnimatedHexBoard } from '../board/AnimatedHexBoard';
import type { BoardShipIdentity } from '../board/beatBoardShip';
import { buildFightBeats, type FightSide } from '../board/fightBeats';
import RoundStepper from './RoundStepper';
import ShipRoundCard from './ShipRoundCard';
import RoundEventLog from './RoundEventLog';
import TurnOrderStrip from './TurnOrderStrip';
import {
    beatActorId,
    beatsByRound,
    nextPlayhead,
    playStart,
    prevPlayhead,
    shownBeat,
    sideBoardShips,
    type Playhead,
} from './turnPlayback';

interface BattlePlaybackProps {
    /** A completed simulation. Owns the round-stepper position and pinned-ship detail card. */
    result: BattleResult;
    /** Controlled round (1-based). When given, the parent owns the playback position and this
     *  component renders no stepper and no turn controls — two playbacks driven by one stepper
     *  is the point, and two fights' turns do not line up. It shows each round's end. A value
     *  past this fight's last round clamps to it, so a shorter fight beside a longer one holds
     *  on its final round. */
    round?: number;
    /** The cells each board draws: the grid the fight was set up on. */
    cells?: readonly Position[];
    /** A ship's portrait by its name, or `null` to draw its name instead. */
    portraitFor?: (name: string) => string | null;
}

/** How long each turn shows while playing. */
const TURN_MS = 900;

// Consumed by DivergencePlayback; it is not itself a component so it does not affect HMR.
// eslint-disable-next-line react-refresh/only-export-components
export const outcomeLabel = (result: BattleResult): string => {
    const { winner } = result.outcome;
    return winner === 'player' ? 'Your team wins' : 'Enemy wins';
};

/**
 * The playback half of the Combat Simulator: outcome summary, round stepper, the two sides on
 * animated hex boards (the enemy's mirrored), the turn order, the optional per-ship detail card,
 * and the round event log. Uncontrolled, it plays the fight turn by turn (`turnPlayback.ts`):
 * the stepper's Play runs the turns through the rounds, Previous/Next turn step one turn, and
 * picking a round shows that round's end. Under reduced motion the boards jump from turn to turn
 * with no floating numbers or hit flash. Clicking a ship pins it for the detail card, which
 * shows that ship's round. Owns the playhead and the pinned ship, resetting both whenever a
 * fresh `result` arrives.
 */
const BattlePlayback: React.FC<BattlePlaybackProps> = ({
    result,
    round,
    cells = ALL_POSITIONS,
    portraitFor,
}) => {
    const [playhead, setPlayhead] = useState<Playhead>({ round: 1, turn: null });
    const [playing, setPlaying] = useState(false);
    // Pinned ship (synthetic roster actorId) for the per-ship detail card; null = none.
    const [pinned, setPinned] = useState<string | null>(null);
    const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

    // A new simulation resets playback to round 1 and clears the pinned ship.
    useEffect(() => {
        setPlayhead({ round: 1, turn: null });
        setPlaying(false);
        setPinned(null);
    }, [result]);

    const beats = useMemo(() => buildFightBeats(result), [result]);
    const byRound = useMemo(() => beatsByRound(beats), [beats]);
    const total = result.rounds.length;
    const controlled = round !== undefined;
    const head: Playhead = controlled ? { round: Math.min(round, total), turn: null } : playhead;
    const roundIndex = Math.min(head.round, total);
    const curRound = total > 0 ? result.rounds[roundIndex - 1] : undefined;

    // Playing re-arms one timeout per turn from the latest playhead, and stops at the fight's
    // end.
    useEffect(() => {
        if (!playing || controlled) return;
        const id = setTimeout(() => {
            const next = nextPlayhead(playhead, byRound, total);
            if (next) setPlayhead(next);
            else setPlaying(false);
        }, TURN_MS);
        return () => clearTimeout(id);
    }, [playing, controlled, playhead, byRound, total]);

    const togglePlay = () => {
        if (playing) {
            setPlaying(false);
            return;
        }
        setPlayhead(playStart(playhead, byRound, total));
        setPlaying(true);
    };

    const step = (to: Playhead | null) => {
        if (!to) return;
        setPlaying(false);
        setPlayhead(to);
    };

    const beatIndex = shownBeat(head, byRound);
    const beat = beatIndex !== null ? beats[beatIndex] : undefined;
    const live = !controlled && head.turn !== null;
    const actingId = live ? beatActorId(result, beat) : null;
    const turnCount = byRound.get(head.round)?.length ?? 0;

    const identity = useMemo(() => {
        const byId = new Map(result.roster.map((r) => [r.actorId, r]));
        return (actorId: string): BoardShipIdentity => {
            const name = byId.get(actorId)?.name ?? actorId;
            return { name, imageUrl: portraitFor?.(name) ?? null };
        };
    }, [result, portraitFor]);

    const positionOf = useMemo(
        () => new Map(result.roster.map((r) => [`${r.side}:${r.position}`, r.actorId])),
        [result]
    );
    const pinnedCell = (side: FightSide): Position | null => {
        const entry = result.roster.find((r) => r.actorId === pinned);
        return entry && entry.side === side ? entry.position : null;
    };
    const pinCell = (side: FightSide) => (cell: Position) => {
        const actorId = positionOf.get(`${side}:${cell}`) ?? null;
        setPinned((prev) => (prev === actorId ? null : actorId));
    };

    const board = (side: FightSide) => (
        <section className="min-w-0 flex-1 space-y-2">
            <h2 className="text-lg font-semibold">
                {side === 'player' ? 'Your Team' : 'Enemy Team'}
            </h2>
            <AnimatedHexBoard
                cells={cells}
                ships={sideBoardShips({
                    result,
                    beats,
                    side,
                    beat: beatIndex,
                    round: curRound,
                    live,
                    motion: !reducedMotion,
                    identity,
                })}
                mirrored={side === 'enemy'}
                tone={side}
                label={side === 'player' ? 'Your team battle board' : 'Enemy team battle board'}
                onSelectCell={pinCell(side)}
                selectedCell={pinnedCell(side)}
            />
        </section>
    );

    const turnText = !live
        ? 'Round end'
        : `Turn ${(head.turn ?? 0) + 1} / ${turnCount}${
              actingId
                  ? `: ${result.roster.find((r) => r.actorId === actingId)?.name ?? ''}`
                  : ': round effects'
          }`;

    return (
        <>
            <StatCard
                title="Outcome"
                value={outcomeLabel(result)}
                subtitle={`Round ${result.outcome.lastRound}`}
                color={result.outcome.winner === 'player' ? 'green' : 'red'}
            />

            {curRound && !controlled && (
                <RoundStepper
                    round={roundIndex}
                    total={total}
                    onChange={(r) => step({ round: r, turn: null })}
                    play={{ playing, onToggle: togglePlay }}
                />
            )}

            {curRound && (
                <>
                    <div className="card space-y-3">
                        {!controlled && (
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => step(prevPlayhead(head, byRound))}
                                    disabled={!prevPlayhead(head, byRound)}
                                    aria-label="Previous turn"
                                    className="flex items-center gap-1"
                                >
                                    <ChevronLeftIcon aria-hidden="true" />
                                    Turn
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => step(nextPlayhead(head, byRound, total))}
                                    disabled={!nextPlayhead(head, byRound, total)}
                                    aria-label="Next turn"
                                    className="flex items-center gap-1"
                                >
                                    Turn
                                    <ChevronRightIcon aria-hidden="true" />
                                </Button>
                                <span
                                    className="min-w-0 truncate text-sm text-theme-text-secondary"
                                    aria-live="polite"
                                >
                                    Round {roundIndex}: {turnText}
                                </span>
                            </div>
                        )}
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                            {board('player')}
                            {board('enemy')}
                        </div>
                        <p className="text-xs text-theme-text-secondary">
                            Click a ship to see its round in detail.
                        </p>
                    </div>

                    <TurnOrderStrip
                        order={curRound.turnOrder}
                        roster={result.roster}
                        actingId={actingId}
                    />

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
