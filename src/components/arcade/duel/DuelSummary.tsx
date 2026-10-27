import React, { useEffect, useRef, useState } from 'react';
import { ChipRow } from '../../ui/ChipRow';
import { MeterBar } from '../../ui/MeterBar';
import { AnimatedHexBoard, type HexBoardShip } from '../../board/AnimatedHexBoard';
import { FloatingHits } from '../../board/FloatingHits';
import type { Position } from '../../../types/encounters';
import type { ChallengeKind, DuelEffect, DuelStakes } from '../../../utils/arcade/types';
import type { FightBeat, FightHit, FightSide, FightShipState } from '../../board/fightBeats';
import {
    beatBoardShip,
    beatShipProps,
    chargedText,
    type BoardShipIdentity,
} from '../../board/beatBoardShip';
import { beatSeconds } from './duelPlayback';
import { isRace, type ChallengeResult, type RaceResult } from './challengeResult';
import {
    raceBarFill,
    raceFigureAt,
    raceFigureLabel,
    raceFigureText,
    raceRoundSeconds,
    raceStamp,
} from './racePlayback';
import { TEAM_FIELD } from './teamCells';
import {
    afterPlayback,
    challengeBanner,
    DUEL_RESULT_HOLD_MS,
    outcomeEffectText,
} from './stakesText';

/** Status chips shown per ship before the rest fold into "+N"; a 3v3 cell shows the count only. */
const MAX_CHIPS = 2;

export interface DuelSide extends BoardShipIdentity {
    level: number | undefined;
}

interface DuelSummaryProps {
    challenge: ChallengeKind;
    /** The flown ship first, then its allies, in the order of each beat's `player` ships. */
    players: DuelSide[];
    /** The gate's ship, or its trio in the order of each beat's `enemy` ships. */
    opponents: DuelSide[];
    stakes: DuelStakes;
    /** `null` while the challenge is still being run. */
    result: ChallengeResult | null;
    effect: DuelEffect | null;
    /** A race shows its final bars at once, without the round-by-round fill. */
    reducedMotion?: boolean;
    onDone: () => void;
}

const hpFill = (hp: number) => (hp < 30 ? 'bg-red-500' : 'bg-green-500');

/** A ship's image, or its name where it has none; `mirrored` flips an image that does not already
 *  face the opponent (a portrait). */
const ShipImage: React.FC<{ side: DuelSide; mirrored: boolean }> = ({ side, mirrored }) =>
    side.imageUrl ? (
        <img
            src={side.imageUrl}
            alt={side.name}
            className={`max-h-full max-w-full object-contain ${mirrored && !side.facesOpponent ? '-scale-x-100' : ''}`}
        />
    ) : (
        <span className="text-sm font-semibold text-theme-text-secondary">{side.name}</span>
    );

interface ShipProps {
    side: DuelSide;
    state: FightShipState;
    /** The turns whose numbers are still floating over this ship: the current one and the one
     *  before it, so a short turn does not cut a number off mid-rise. */
    floats: { beat: number; hits: FightHit[] }[];
    /** Set on the turn this ship fires its charged skill. */
    charged: { beat: number; skillName?: string } | null;
    mirrored: boolean;
}

/** One ship of a 1v1. Every row is always rendered (an empty one invisible) so the card keeps
 *  its height. */
const Ship: React.FC<ShipProps> = ({ side, state, floats, charged, mirrored }) => {
    const hp = state.hpPct;
    const shield = state.shieldPct;
    return (
        <div className="space-y-2">
            <div className="relative flex h-28 items-center justify-center">
                <ShipImage side={side} mirrored={mirrored} />
                <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
                    {floats.map((f) => (
                        <FloatingHits key={f.beat} turn={f.beat} hits={f.hits} />
                    ))}
                </div>
                {charged && (
                    <div
                        key={charged.beat}
                        role="status"
                        className="board-banner absolute inset-x-0 top-0 truncate border border-primary/70 bg-primary/20 px-1 py-0.5 text-xs font-bold tracking-widest text-primary"
                    >
                        {chargedText(charged)}
                    </div>
                )}
            </div>
            <div className="min-w-0 space-y-2">
                <div className="truncate font-semibold">{side.name}</div>
                {side.level !== undefined && (
                    <div className="text-sm text-theme-text-secondary">Lv {side.level}</div>
                )}
                <MeterBar percentage={hp} label={`${side.name} hull`} fillClassName={hpFill(hp)} />
                <div className={shield > 0 ? '' : 'invisible'}>
                    <MeterBar
                        percentage={shield}
                        label={`${side.name} shield`}
                        fillClassName="bg-sky-400"
                    />
                </div>
                <div className="flex justify-between gap-2 text-xs text-theme-text-secondary">
                    <span>{Math.round(hp)}% HP</span>
                    {shield > 0 && (
                        <span className="text-sky-300">{Math.round(shield)}% shield</span>
                    )}
                </div>
                <div className={state.charge ? '' : 'invisible'}>
                    <MeterBar
                        percentage={
                            state.charge ? (100 * state.charge.value) / state.charge.max : 0
                        }
                        label={`${side.name} charge`}
                        fillClassName="bg-primary"
                        className="!h-1"
                    />
                </div>
                <ChipRow
                    items={state.buffs}
                    label={`${side.name} buffs`}
                    max={MAX_CHIPS}
                    variant="buff"
                />
                <ChipRow
                    items={state.debuffs}
                    label={`${side.name} debuffs`}
                    max={MAX_CHIPS}
                    variant="debuff"
                />
            </div>
        </div>
    );
};

const outcomeTitle = (result: ChallengeResult) => {
    if (result.outcome === 'win') return 'Victory';
    if (result.outcome === 'lose') return 'Defeat';
    if (result.outcome === 'draw') return 'Draw';
    return result.kind === 'duel' ? 'Duel skipped' : 'Challenge skipped';
};

/** One side of a 3v3 on the small grid, each ship on the cell its beat state names. The
 *  player's board (left) has its front on the right and the enemy's (right) is mirrored, so both
 *  fronts face the middle. Before the first beat the board is empty. */
const TeamBoard: React.FC<{
    sides: DuelSide[];
    sideKey: FightSide;
    beats: FightBeat[];
    index: number;
    playing: boolean;
}> = ({ sides, sideKey, beats, index, playing }) => {
    const states = beats[Math.max(0, index)]?.[sideKey] ?? [];
    const ships: Partial<Record<Position, HexBoardShip>> = {};
    states.forEach((s, i) => {
        const side = sides[i];
        if (side) ships[s.position] = beatBoardShip(side, beats, index, playing, sideKey, i);
    });
    return (
        <AnimatedHexBoard
            cells={TEAM_FIELD}
            ships={ships}
            mirrored={sideKey === 'enemy'}
            tone={sideKey}
            label={sideKey === 'player' ? 'Your board' : 'Enemy board'}
            className="min-w-0 flex-1"
        />
    );
};

/** A fight's ships: a 1v1 as two columns, a 3v3 as two hex boards; the player's side is on the
 *  left, matching the renders `FlightGame` asks for (the flown side faces right). */
const FightBody: React.FC<{
    players: DuelSide[];
    opponents: DuelSide[];
    beats: FightBeat[];
    index: number;
    playing: boolean;
}> = ({ players, opponents, beats, index, playing }) => {
    if (players.length > 1 || opponents.length > 1) {
        const board = (sides: DuelSide[], key: FightSide) => (
            <TeamBoard sides={sides} sideKey={key} beats={beats} index={index} playing={playing} />
        );
        return (
            <div className="flex items-center gap-1 sm:gap-3">
                {board(players, 'player')}
                <div className="text-xs font-bold text-theme-text-secondary sm:text-xl">VS</div>
                {board(opponents, 'enemy')}
            </div>
        );
    }
    const column = (sides: DuelSide[], key: FightSide) => (
        <div className="flex-1 min-w-0">
            {sides.map((side, ship) => {
                const { state, floats, charged } = beatShipProps(beats, index, playing, key, ship);
                return (
                    <Ship
                        key={ship}
                        side={side}
                        state={state}
                        floats={floats}
                        charged={charged}
                        mirrored={key === 'enemy'}
                    />
                );
            })}
        </div>
    );
    return (
        <div className="flex items-start gap-4">
            {column(players, 'player')}
            <div className="self-center text-xl font-bold text-theme-text-secondary">VS</div>
            {column(opponents, 'enemy')}
        </div>
    );
};

/** One ship's lane of a race: its image, its bar filled to the figure after `round`, the figure
 *  itself and, once the race is over, its WIN, LOSE or DRAW stamp. */
const RaceLane: React.FC<{
    side: DuelSide;
    result: RaceResult;
    who: 'flown' | 'rival';
    round: number;
    finished: boolean;
}> = ({ side, result, who, round, finished }) => {
    const value = raceFigureAt(result[who], round);
    const stamp = finished ? raceStamp(result, who) : null;
    const label = raceFigureLabel(result.kind);
    return (
        <div className="flex-1 min-w-0 space-y-2">
            <div className="relative h-28 flex items-center justify-center">
                <ShipImage side={side} mirrored={who === 'rival'} />
                {stamp && (
                    <div
                        role="status"
                        className={`absolute inset-x-0 top-1/2 -translate-y-1/2 border-2 py-1 text-2xl font-extrabold tracking-widest ${
                            stamp === 'WIN'
                                ? 'border-green-400 bg-green-500/20 text-green-300'
                                : stamp === 'DRAW'
                                  ? 'border-yellow-400 bg-yellow-500/20 text-yellow-300'
                                  : 'border-red-400 bg-red-500/20 text-red-300'
                        }`}
                    >
                        {stamp}
                    </div>
                )}
            </div>
            <div className="truncate font-semibold">{side.name}</div>
            <MeterBar
                percentage={raceBarFill(result, value)}
                label={`${side.name} ${label.toLowerCase()}`}
                fillClassName={who === 'flown' ? 'bg-primary' : 'bg-sky-400'}
                className="!h-3"
            />
            <div className="text-lg font-bold tabular-nums">
                {raceFigureText(result.kind, value)}
            </div>
        </div>
    );
};

const RaceBody: React.FC<{
    player: DuelSide;
    opponent: DuelSide;
    result: RaceResult;
    round: number;
    finished: boolean;
}> = ({ player, opponent, result, round, finished }) => (
    <div className="space-y-2">
        <div className="text-xs uppercase tracking-widest text-theme-text-secondary">
            {raceFigureLabel(result.kind)}
        </div>
        <div className="flex items-start gap-4">
            <RaceLane side={player} result={result} who="flown" round={round} finished={finished} />
            <div className="self-center text-xl font-bold text-theme-text-secondary">VS</div>
            <RaceLane
                side={opponent}
                result={result}
                who="rival"
                round={round}
                finished={finished}
            />
        </div>
    </div>
);

/**
 * In-game challenge overlay: "Simulating…" until `result` arrives, then its playback. A fight
 * (`duel`, `team`) plays back turn by turn (`beatSeconds`) with each ship's HP, shield, charge,
 * buffs and debuffs, the numbers each turn lands and a banner on a charged skill; a `team` fight
 * shows each side's three ships on its hex board (`TeamBoard`). A race (`dps`, `heal`, `tank`) fills a bar per ship round by round
 * (`raceRoundSeconds`) with the figure it compares, then stamps each ship WIN, LOSE or DRAW.
 * After the playback the outcome and its effect are shown for `DUEL_RESULT_HOLD_MS` before
 * `onDone` is called (see `afterPlayback`: a loss that ends the run calls it as soon as the
 * playback ends, with no outcome shown). Space or a click skips the playback, and on the outcome
 * calls `onDone` at once. The hold only counts while the page is visible and focused.
 */
export const DuelSummary: React.FC<DuelSummaryProps> = ({
    challenge,
    players,
    opponents,
    stakes,
    result,
    effect,
    reducedMotion = false,
    onDone,
}) => {
    const [index, setIndex] = useState(0);
    const [finished, setFinished] = useState(false);
    const race = result && isRace(result) ? result : null;
    const beats = result && !isRace(result) ? result.beats : [];
    const steps = race ? race.flown.byRound.length : beats.length;

    // Nothing to play back (a skipped challenge), or a race under reduced motion, finishes at
    // once.
    useEffect(() => {
        if (!result) return;
        const raced = isRace(result);
        const count = raced ? result.flown.byRound.length : result.beats.length;
        if (count === 0 || (raced && reducedMotion)) {
            setFinished(true);
            return;
        }
        const perStep = raced ? raceRoundSeconds(count) : beatSeconds(count);
        let raf = 0;
        let start: number | null = null;
        let shown = 0;
        // Re-renders only when the shown step changes, not on every animation frame.
        const tick = (now: number) => {
            start ??= now;
            const elapsed = (now - start) / 1000;
            if (elapsed >= perStep * count) {
                setFinished(true);
                return;
            }
            const step = Math.min(count - 1, Math.floor(elapsed / perStep));
            if (step !== shown) {
                shown = step;
                setIndex(step);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [result, reducedMotion]);

    const finishedRef = useRef(finished);
    finishedRef.current = finished;
    const resultRef = useRef(result);
    resultRef.current = result;
    const onDoneRef = useRef(onDone);
    onDoneRef.current = onDone;

    const advance = () => {
        if (!resultRef.current) return;
        if (finishedRef.current) onDoneRef.current();
        else setFinished(true);
    };

    const closes = finished && !!result && afterPlayback(effect) === 'close';
    // After the playback, the outcome holds and then moves on; the hold restarts from the
    // beginning when the page comes back after being hidden or blurred.
    useEffect(() => {
        if (!finished || !result) return;
        if (afterPlayback(effect) === 'close') {
            onDoneRef.current();
            return;
        }
        let timer = 0;
        const start = () => {
            window.clearTimeout(timer);
            if (document.hidden || !document.hasFocus()) return;
            timer = window.setTimeout(() => onDoneRef.current(), DUEL_RESULT_HOLD_MS);
        };
        const stop = () => window.clearTimeout(timer);
        const onVisibility = () => (document.hidden ? stop() : start());
        start();
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('blur', stop);
        window.addEventListener('focus', start);
        return () => {
            stop();
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('blur', stop);
            window.removeEventListener('focus', start);
        };
    }, [finished, result, effect]);
    const advanceRef = useRef(advance);
    advanceRef.current = advance;

    // Capture phase so Space never reaches the run's jump handler.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== ' ' && e.code !== 'Space') return;
            e.preventDefault();
            e.stopPropagation();
            if (!e.repeat) advanceRef.current();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, []);

    const shownIndex = finished ? steps - 1 : Math.min(index, steps - 1);
    const playing = !!result && !finished && shownIndex >= 0;
    const team = players.length > 1 || opponents.length > 1;
    const round = race ? shownIndex + 1 : (beats[shownIndex]?.round ?? 0);

    return (
        <div
            className={`absolute inset-0 z-[55] flex items-center justify-center bg-black/70 ${team ? 'p-2 sm:p-4' : 'p-4'}`}
            onClick={advance}
        >
            <div
                className={`card w-full ${team ? 'max-w-2xl !p-3 sm:!p-4' : 'max-w-lg'} max-h-full overflow-y-auto space-y-4 text-center`}
            >
                <div className="text-sm font-semibold tracking-widest text-primary">
                    {challengeBanner(challenge, stakes)}
                </div>
                {race ? (
                    <RaceBody
                        player={players[0]}
                        opponent={opponents[0]}
                        result={race}
                        round={round}
                        finished={finished}
                    />
                ) : (
                    <FightBody
                        players={players}
                        opponents={opponents}
                        beats={beats}
                        index={shownIndex}
                        playing={playing}
                    />
                )}
                {!result ? (
                    <p className="text-theme-text-secondary">Simulating…</p>
                ) : !finished ? (
                    <p className="text-theme-text-secondary">Round {round}</p>
                ) : closes ? null : (
                    <div className="space-y-3">
                        <h2 className="text-2xl font-bold">{outcomeTitle(result)}</h2>
                        {effect && (
                            <p className="text-lg">{outcomeEffectText(result.outcome, effect)}</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
