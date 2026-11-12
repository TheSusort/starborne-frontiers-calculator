import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BattleResult } from '../../utils/calculators/battleSimulator';
import type { Position } from '../../types/encounters';
import { ALL_POSITIONS } from '../../utils/targeting/board';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { StatCard } from '../ui/StatCard';
import { Button } from '../ui/Button';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Tooltip } from '../ui/layout/Tooltip';
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from '../ui/icons';
import { AnimatedHexBoard, type HexBoardShip } from '../board/AnimatedHexBoard';
import type { BoardShipIdentity } from '../board/beatBoardShip';
import { buildFightBeats, type FightSide } from '../board/fightBeats';
import ShipRoundCard from './ShipRoundCard';
import RoundEventLog from './RoundEventLog';
import TurnOrderStrip from './TurnOrderStrip';
import { TargetLines } from './TargetLines';
import {
    beatActorId,
    beatsByRound,
    nextPlayhead,
    playStart,
    prevPlayhead,
    shownBeat,
    sideBoardShips,
    statusSource,
    statusSources,
    targetLines,
    type Playhead,
} from './turnPlayback';

interface BattlePlaybackProps {
    /** A completed simulation. Owns the playhead and pinned-ship detail card. */
    result: BattleResult;
    /** Controlled round (1-based). When given, the parent owns the playback position and this
     *  component renders no player toolbar and no turn controls — two playbacks driven by one
     *  stepper is the point, and two fights' turns do not line up. It shows each round's end. A
     *  value past this fight's last round clamps to it, so a shorter fight beside a longer one
     *  holds on its final round. */
    round?: number;
    /** The cells each board draws: the grid the fight was set up on. */
    cells?: readonly Position[];
    /** A ship's portrait by its name, or `null` to draw its name instead. */
    portraitFor?: (name: string) => string | null;
}

type Speed = 'slow' | 'normal' | 'fast';

/** How long each turn shows while playing, per speed. */
const SPEED_MS: Record<Speed, number> = { slow: 2400, normal: 1500, fast: 700 };

const SPEED_OPTIONS = [
    { value: 'slow', label: 'Slow' },
    { value: 'normal', label: 'Normal' },
    { value: 'fast', label: 'Fast' },
] as const;

const isSpeed = (value: string): value is Speed => value in SPEED_MS;

// Consumed by DivergencePlayback; it is not itself a component so it does not affect HMR.
// eslint-disable-next-line react-refresh/only-export-components
export const outcomeLabel = (result: BattleResult): string => {
    const { winner } = result.outcome;
    return winner === 'player' ? 'Your team wins' : 'Enemy wins';
};

interface HoveredCell {
    side: FightSide;
    cell: Position;
    el: HTMLElement;
}

/**
 * The playback half of the Combat Simulator: the two sides on animated hex boards (the enemy's
 * mirrored), the turn order, the optional per-ship detail card, and the round event log.
 * Uncontrolled, it plays the fight turn by turn (`turnPlayback.ts`) from a toolbar: Play, Previous
 * and Next turn, a button per round, and a speed. While a turn plays, lines run from the acting
 * ship to the ships its attacks hit and statuses float over the ships they reach. Hovering or
 * focusing a ship shows its buffs and debuffs; clicking pins it for the detail card, which shows
 * that ship's round. Under reduced motion the boards jump from turn to turn with no floating text
 * or hit flash. Owns the playhead, speed and pinned ship, resetting the playhead and the pin
 * whenever a fresh `result` arrives.
 */
const BattlePlayback: React.FC<BattlePlaybackProps> = ({
    result,
    round,
    cells = ALL_POSITIONS,
    portraitFor,
}) => {
    const [playhead, setPlayhead] = useState<Playhead>({ round: 1, turn: null });
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState<Speed>('normal');
    // Pinned ship (synthetic roster actorId) for the per-ship detail card; null = none.
    const [pinned, setPinned] = useState<string | null>(null);
    const [hovered, setHovered] = useState<HoveredCell | null>(null);
    const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const boardsRef = useRef<HTMLDivElement>(null);
    // The delay a turn arms its timer with, read when it is armed: a speed change takes effect
    // from the next turn.
    const speedMsRef = useRef(SPEED_MS[speed]);
    useEffect(() => {
        speedMsRef.current = SPEED_MS[speed];
    }, [speed]);

    // A new simulation resets playback to round 1 and clears the pinned ship.
    useEffect(() => {
        setPlayhead({ round: 1, turn: null });
        setPlaying(false);
        setPinned(null);
        setHovered(null);
    }, [result]);

    const beats = useMemo(() => buildFightBeats(result, { statusFloats: true }), [result]);
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
        }, speedMsRef.current);
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

    const prev = prevPlayhead(head, byRound);
    const next = nextPlayhead(head, byRound, total);

    const beatIndex = shownBeat(head, byRound);
    const beat = beatIndex !== null ? beats[beatIndex] : undefined;
    const live = !controlled && head.turn !== null;
    const actingId = live ? beatActorId(result, beat) : null;
    const turnCount = byRound.get(head.round)?.length ?? 0;
    const lines = useMemo(() => (live ? targetLines(beat) : []), [live, beat]);

    const identity = useMemo(() => {
        const byId = new Map(result.roster.map((r) => [r.actorId, r]));
        return (actorId: string): BoardShipIdentity => {
            const name = byId.get(actorId)?.name ?? actorId;
            const imageUrl = portraitFor?.(name) ?? null;
            // Pilot portraits already face the opponent, so the enemy board does not flip them.
            return { name, imageUrl, facesOpponent: imageUrl !== null };
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
    const hoverCell = (side: FightSide) => (cell: Position | null, el: HTMLElement | null) =>
        setHovered(cell && el ? { side, cell, el } : null);

    // Secondary footprint cell -> anchor, per side, for the roster's multi-hex units.
    const secondaryCellsOf = (side: FightSide): Partial<Record<Position, Position>> => {
        const map: Partial<Record<Position, Position>> = {};
        for (const r of result.roster) {
            if (r.side !== side) continue;
            for (const cell of r.footprint?.slice(1) ?? []) map[cell] = r.position;
        }
        return map;
    };

    const boardShips = (side: FightSide) =>
        sideBoardShips({
            result,
            beats,
            side,
            beat: beatIndex,
            round: curRound,
            live,
            motion: !reducedMotion,
            identity,
        });
    const shipsBySide: Record<FightSide, Partial<Record<Position, HexBoardShip>>> = {
        player: boardShips('player'),
        enemy: boardShips('enemy'),
    };

    // A beat's statuses come from round-end snapshots: the shown round's at its end (and on its
    // last turn, which snaps to it), the previous round's on any earlier turn.
    const roundBeats = byRound.get(head.round);
    const lastTurnShown = beatIndex !== null && roundBeats?.[roundBeats.length - 1] === beatIndex;
    const statusRound = live && !lastTurnShown ? head.round - 1 : head.round;
    const sources = useMemo(() => statusSources(result, statusRound), [result, statusRound]);

    const board = (side: FightSide) => (
        <section data-board-side={side} className="min-w-0 flex-1 space-y-2">
            <h2 className="text-lg font-semibold">
                {side === 'player' ? 'Your Team' : 'Enemy Team'}
            </h2>
            <AnimatedHexBoard
                cells={cells}
                ships={shipsBySide[side]}
                mirrored={side === 'enemy'}
                secondaryCells={secondaryCellsOf(side)}
                tone={side}
                label={side === 'player' ? 'Your team battle board' : 'Enemy team battle board'}
                onSelectCell={pinCell(side)}
                selectedCell={pinnedCell(side)}
                onHoverCell={hoverCell(side)}
            />
        </section>
    );

    const nameOf = (actorId: string) => result.roster.find((r) => r.actorId === actorId)?.name;
    const statusText = !live
        ? `Round ${roundIndex} · round end`
        : `Round ${roundIndex} · turn ${(head.turn ?? 0) + 1} of ${turnCount} · ${
              (actingId && nameOf(actingId)) || 'round effects'
          }`;

    const hoveredShip = hovered ? shipsBySide[hovered.side][hovered.cell] : undefined;
    const hoveredId = hovered ? positionOf.get(`${hovered.side}:${hovered.cell}`) : undefined;
    const statusList = (title: string, names: readonly string[]) => (
        <div>
            <div className="font-semibold">
                {title} · {names.length}
            </div>
            {names.length === 0 ? (
                <div className="text-theme-text-secondary">None</div>
            ) : (
                <ul className="space-y-0.5">
                    {names.map((name) => {
                        const source = hoveredId
                            ? statusSource(sources, hoveredId, name)
                            : undefined;
                        return (
                            <li key={name} className="flex justify-between gap-3">
                                <span>{name}</span>
                                <span className="text-theme-text-secondary">
                                    {source === undefined
                                        ? ''
                                        : source === hoveredId
                                          ? 'self'
                                          : nameOf(source)}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );

    // Space and the arrows drive the player from anywhere inside it. A button keeps Space for its
    // own activation, a form field keeps both, and the speed control keeps the arrows.
    const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
        if (controlled || e.ctrlKey || e.metaKey || e.altKey) return;
        const target = e.target as HTMLElement;
        if (target.closest('input, select, textarea')) return;
        if (e.key === ' ') {
            if (target.closest('button')) return;
            e.preventDefault();
            togglePlay();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            if (target.closest('[data-speed-control]')) return;
            e.preventDefault();
            step(e.key === 'ArrowLeft' ? prev : next);
        }
    };

    const roundEvents = (
        <RoundEventLog
            round={curRound && result.combatLog.find((r) => r.round === curRound.round)}
            roster={result.roster}
        />
    );

    return (
        <section
            aria-label="Battle playback"
            className="space-y-4"
            onKeyDown={controlled ? undefined : onKeyDown}
        >
            {controlled && (
                <StatCard
                    title="Outcome"
                    value={outcomeLabel(result)}
                    subtitle={`Round ${result.outcome.lastRound}`}
                    color={result.outcome.winner === 'player' ? 'green' : 'red'}
                />
            )}

            {curRound && !controlled && (
                <div className="card flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span
                        className={`text-sm font-semibold ${
                            result.outcome.winner === 'player' ? 'text-green-400' : 'text-red-400'
                        }`}
                    >
                        {outcomeLabel(result)} in round {result.outcome.lastRound}
                    </span>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={togglePlay}
                        aria-label={playing ? 'Pause' : 'Play'}
                        className="flex items-center gap-2"
                    >
                        {playing ? (
                            <PauseIcon aria-hidden="true" />
                        ) : (
                            <PlayIcon aria-hidden="true" />
                        )}
                        {playing ? 'Pause' : 'Play'}
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => step(prev)}
                        disabled={!prev}
                        aria-label="Previous turn"
                    >
                        <ChevronLeftIcon aria-hidden="true" />
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => step(next)}
                        disabled={!next}
                        aria-label="Next turn"
                    >
                        <ChevronRightIcon aria-hidden="true" />
                    </Button>
                    <div role="group" aria-label="Rounds" className="flex flex-wrap gap-1">
                        {result.rounds.map((_, i) => (
                            <button
                                key={i}
                                type="button"
                                aria-pressed={i + 1 === roundIndex}
                                onClick={() => step({ round: i + 1, turn: null })}
                                className={`h-7 min-w-7 border px-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                                    i + 1 === roundIndex
                                        ? 'border-primary bg-primary/20 text-primary'
                                        : 'border-dark-border text-theme-text-secondary hover:bg-dark-border'
                                }`}
                            >
                                {i + 1}
                            </button>
                        ))}
                    </div>
                    <span
                        className="min-w-0 truncate text-sm text-theme-text-secondary"
                        aria-live="polite"
                    >
                        {statusText}
                    </span>
                    <div data-speed-control className="sm:ml-auto">
                        <SegmentedControl
                            label="Playback speed"
                            size="sm"
                            value={speed}
                            options={SPEED_OPTIONS}
                            onChange={(value) => isSpeed(value) && setSpeed(value)}
                        />
                    </div>
                </div>
            )}

            {curRound && (
                <div
                    className={
                        controlled
                            ? 'space-y-4'
                            : 'space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-4 lg:space-y-0'
                    }
                >
                    <div className="min-w-0 space-y-4">
                        <div className="card space-y-3">
                            <div
                                ref={boardsRef}
                                className="relative flex flex-col gap-4 sm:flex-row sm:items-start"
                            >
                                {board('player')}
                                {board('enemy')}
                                {live && <TargetLines lines={lines} containerRef={boardsRef} />}
                            </div>
                            {!controlled && (
                                <ul
                                    className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-theme-text-secondary"
                                    aria-label="Target lines"
                                >
                                    <li className="flex items-center gap-2">
                                        <span
                                            aria-hidden="true"
                                            className="inline-block h-1 w-6 bg-primary"
                                        />
                                        Main target
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <span
                                            aria-hidden="true"
                                            className="inline-block w-6 border-t-2 border-dashed border-orange-300"
                                        />
                                        Splash
                                    </li>
                                </ul>
                            )}
                            <p className="text-xs text-theme-text-secondary">
                                Hover a ship for its buffs and debuffs. Click to pin its round.
                                {!controlled && (
                                    <span className="hidden sm:inline">
                                        {' '}
                                        ← → step · Space plays
                                    </span>
                                )}
                            </p>
                        </div>

                        <TurnOrderStrip
                            order={curRound.turnOrder}
                            roster={result.roster}
                            actingId={actingId}
                        />

                        {pinned && (
                            <ShipRoundCard
                                actorId={pinned}
                                round={curRound}
                                roster={result.roster}
                            />
                        )}
                    </div>

                    {controlled ? (
                        roundEvents
                    ) : (
                        <div className="lg:max-h-[75vh] lg:overflow-y-auto">{roundEvents}</div>
                    )}
                </div>
            )}

            <Tooltip
                isVisible={hoveredShip !== undefined}
                targetElement={hovered?.el}
                className="card w-60 space-y-2 text-xs shadow-lg"
            >
                {hoveredShip && hovered && (
                    <>
                        <div>
                            <div className="text-sm font-semibold">
                                {hoveredShip.name} · {hovered.cell}
                            </div>
                            <div className="text-theme-text-secondary">
                                {Math.round(hoveredShip.hpPct)}% HP
                                {hoveredShip.shieldPct > 0 &&
                                    ` · ${Math.round(hoveredShip.shieldPct)}% shield`}
                            </div>
                            {live && (
                                <div className="text-theme-text-secondary">
                                    As of the last round end
                                </div>
                            )}
                        </div>
                        {statusList('Buffs', hoveredShip.buffs)}
                        {statusList('Debuffs', hoveredShip.debuffs)}
                    </>
                )}
            </Tooltip>
        </section>
    );
};

export default BattlePlayback;
