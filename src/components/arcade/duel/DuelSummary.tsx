import React, { useEffect, useRef, useState } from 'react';
import { ChipRow } from '../../ui/ChipRow';
import { MeterBar } from '../../ui/MeterBar';
import type { ChallengeKind, DuelEffect, DuelStakes } from '../../../utils/arcade/types';
import {
    beatSeconds,
    type DuelBeat,
    type DuelHit,
    type DuelSideKey,
    type DuelSideState,
} from './duelPlayback';
import { isRace, type ChallengeResult, type RaceResult } from './challengeResult';
import {
    raceBarFill,
    raceFigureAt,
    raceFigureLabel,
    raceFigureText,
    raceRoundSeconds,
    raceStamp,
} from './racePlayback';
import { afterPlayback, challengeBanner, DUEL_RESULT_HOLD_MS, effectText } from './stakesText';

/** Floating numbers shown per ship per turn; a multi-hit turn shows only its first ones. */
const MAX_FLOATS = 4;
/** Status chips shown per row before the rest fold into "+N"; fewer on a three-ship side. */
const MAX_CHIPS = 2;
const MAX_TEAM_CHIPS = 1;

export interface DuelSide {
    name: string;
    level: number | undefined;
    imageUrl: string | null;
    /** The image already shows the ship facing the other side, so it is never mirrored. */
    facesOpponent?: boolean;
}

interface DuelSummaryProps {
    challenge: ChallengeKind;
    /** The flown ship first, then its allies, in board order. */
    players: DuelSide[];
    /** The gate's ship, or its trio in board order. */
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

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const hitText = (hit: DuelHit) => {
    switch (hit.kind) {
        case 'miss':
            return 'MISS';
        case 'damage':
            return `${NUMBER.format(hit.amount)}${hit.crit ? '!' : ''}`;
        case 'heal':
        case 'shield':
            return `+${NUMBER.format(hit.amount)}`;
    }
};

const hitClass = (hit: DuelHit) => {
    switch (hit.kind) {
        case 'miss':
            return 'text-sm font-semibold text-theme-text-secondary';
        case 'damage':
            return hit.crit
                ? 'text-2xl font-extrabold text-yellow-300'
                : 'text-lg font-bold text-white';
        case 'heal':
            return 'text-base font-bold text-green-400';
        case 'shield':
            return 'text-base font-bold text-sky-300';
    }
};

/** One turn's numbers over a ship, keyed by the turn so a new turn mounts fresh ones. */
const FloatingHits: React.FC<{ beat: number; hits: DuelHit[] }> = ({ beat, hits }) => (
    <>
        {hits.slice(0, MAX_FLOATS).map((hit, i) => (
            <span
                key={`${beat}-${i}`}
                data-testid="duel-hit"
                className={`arcade-duel-float absolute whitespace-nowrap drop-shadow ${hitClass(hit)}`}
                style={{
                    left: `${50 + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * 18}%`,
                    top: `${35 - i * 8}%`,
                    animationDelay: `${i * 90}ms`,
                }}
            >
                {hitText(hit)}
            </span>
        ))}
    </>
);

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
    state: DuelSideState;
    /** The turns whose numbers are still floating over this ship: the current one and the one
     *  before it, so a short turn does not cut a number off mid-rise. */
    floats: { beat: number; hits: DuelHit[] }[];
    /** Set on the turn this ship fires its charged skill. */
    charged: { beat: number; skillName?: string } | null;
    mirrored: boolean;
    /** One of three ships on its side: a smaller image beside the bars. */
    compact: boolean;
}

/** Every row is always rendered (an empty one invisible) so the card keeps its height. */
const Ship: React.FC<ShipProps> = ({ side, state, floats, charged, mirrored, compact }) => {
    const hp = state.hpPct;
    const shield = state.shieldPct;
    const image = (
        <div
            className={`relative flex items-center justify-center ${compact ? 'h-16 w-24 shrink-0' : 'h-28'}`}
        >
            <ShipImage side={side} mirrored={mirrored} />
            <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
                {floats.map((f) => (
                    <FloatingHits key={f.beat} beat={f.beat} hits={f.hits} />
                ))}
            </div>
            {charged && (
                <div
                    key={charged.beat}
                    role="status"
                    className="arcade-duel-charged absolute inset-x-0 top-0 truncate border border-primary/70 bg-primary/20 px-1 py-0.5 text-xs font-bold tracking-widest text-primary"
                >
                    {charged.skillName ? `CHARGED: ${charged.skillName}` : 'CHARGED SKILL'}
                </div>
            )}
        </div>
    );
    const bars = (
        <div className={`min-w-0 ${compact ? 'flex-1 space-y-1' : 'space-y-2'}`}>
            <div className={`truncate font-semibold ${compact ? 'text-sm' : ''}`}>{side.name}</div>
            {!compact && side.level !== undefined && (
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
                {shield > 0 && <span className="text-sky-300">{Math.round(shield)}% shield</span>}
            </div>
            <div className={state.charge ? '' : 'invisible'}>
                <MeterBar
                    percentage={state.charge ? (100 * state.charge.value) / state.charge.max : 0}
                    label={`${side.name} charge`}
                    fillClassName="bg-primary"
                    className="!h-1"
                />
            </div>
            <ChipRow
                items={state.buffs}
                label={`${side.name} buffs`}
                max={compact ? MAX_TEAM_CHIPS : MAX_CHIPS}
                variant="buff"
            />
            <ChipRow
                items={state.debuffs}
                label={`${side.name} debuffs`}
                max={compact ? MAX_TEAM_CHIPS : MAX_CHIPS}
                variant="debuff"
            />
        </div>
    );
    return compact ? (
        <div className={`flex items-center gap-2 ${mirrored ? 'flex-row-reverse text-right' : ''}`}>
            {image}
            {bars}
        </div>
    ) : (
        <div className="space-y-2">
            {image}
            {bars}
        </div>
    );
};

const IDLE: DuelSideState = {
    hpPct: 100,
    shieldPct: 0,
    buffs: [],
    debuffs: [],
    alive: true,
    charge: null,
};

const outcomeTitle = (result: ChallengeResult) => {
    if (result.outcome === 'win') return 'Victory';
    if (result.outcome === 'lose') return 'Defeat';
    return result.kind === 'duel' ? 'Duel skipped' : 'Challenge skipped';
};

/** The numbers still floating over ship `ship` of `side` while beat `index` plays. */
const floatsFor = (beats: DuelBeat[], index: number, side: DuelSideKey, ship: number) =>
    [index - 1, index]
        .filter((i) => i >= 0)
        .map((i) => ({
            beat: i,
            hits: beats[i].hits.filter((h) => h.side === side && h.ship === ship),
        }))
        .filter((f) => f.hits.length > 0);

/** A fight's ships, each side a column; the player's side is on the left. */
const FightBody: React.FC<{
    players: DuelSide[];
    opponents: DuelSide[];
    beats: DuelBeat[];
    index: number;
    playing: boolean;
}> = ({ players, opponents, beats, index, playing }) => {
    const beat = index >= 0 ? beats[index] : null;
    const compact = players.length > 1 || opponents.length > 1;
    const column = (sides: DuelSide[], key: DuelSideKey) => (
        <div className={`flex-1 min-w-0 ${compact ? 'space-y-3' : ''}`}>
            {sides.map((side, ship) => (
                <Ship
                    key={ship}
                    side={side}
                    state={beat?.[key][ship] ?? IDLE}
                    floats={playing ? floatsFor(beats, index, key, ship) : []}
                    charged={
                        playing && beat?.actor === key && beat.actorShip === ship && beat.charged
                            ? { beat: index, skillName: beat.charged.skillName }
                            : null
                    }
                    mirrored={key === 'enemy'}
                    compact={compact}
                />
            ))}
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
 *  itself and, once the race is over, its WIN/LOSE stamp. */
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
 * shows three ships a side. A race (`dps`, `heal`, `tank`) fills a bar per ship round by round
 * (`raceRoundSeconds`) with the figure it compares, then stamps each ship WIN or LOSE.
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
            className="absolute inset-0 z-[55] flex items-center justify-center p-4 bg-black/70"
            onClick={advance}
        >
            <div
                className={`card w-full ${team ? 'max-w-2xl' : 'max-w-lg'} max-h-full overflow-y-auto space-y-4 text-center`}
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
                        {effect && <p className="text-lg">{effectText(effect)}</p>}
                    </div>
                )}
            </div>
        </div>
    );
};
