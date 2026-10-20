import React, { useEffect, useRef, useState } from 'react';
import { ChipRow } from '../../ui/ChipRow';
import { MeterBar } from '../../ui/MeterBar';
import type { DuelEffect, DuelStakes } from '../../../utils/arcade/types';
import { beatSeconds, type DuelBeat, type DuelHit, type DuelSideState } from './duelPlayback';
import type { DuelResult } from './runDuel';
import { afterPlayback, DUEL_RESULT_HOLD_MS, effectText, stakesBanner } from './stakesText';

/** Floating numbers shown per ship per turn; a multi-hit turn shows only its first ones. */
const MAX_FLOATS = 4;
/** Status chips shown per row before the rest fold into "+N". */
const MAX_CHIPS = 2;

export interface DuelSide {
    name: string;
    level: number | undefined;
    imageUrl: string | null;
    /** The image already shows the ship facing the other side, so it is never mirrored. */
    facesOpponent?: boolean;
}

interface DuelSummaryProps {
    player: DuelSide;
    opponent: DuelSide;
    stakes: DuelStakes;
    /** `null` while the duel is still being simulated. */
    result: DuelResult | null;
    effect: DuelEffect | null;
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

interface SideProps {
    side: DuelSide;
    state: DuelSideState;
    /** The turns whose numbers are still floating over this ship: the current one and the one
     *  before it, so a short turn does not cut a number off mid-rise. */
    floats: { beat: number; hits: DuelHit[] }[];
    /** Set on the turn this ship fires its charged skill. */
    charged: { beat: number; skillName?: string } | null;
    /** `mirrored` flips an image that does not already face the opponent (a portrait). */
    mirrored?: boolean;
}

/** Every row is always rendered (an empty one invisible) so the card keeps its height. */
const Side: React.FC<SideProps> = ({ side, state, floats, charged, mirrored = false }) => {
    const hp = state.hpPct;
    const shield = state.shieldPct;
    return (
        <div className="flex-1 min-w-0 space-y-2">
            <div className="relative h-28 flex items-center justify-center">
                {side.imageUrl ? (
                    <img
                        src={side.imageUrl}
                        alt={side.name}
                        className={`max-h-full max-w-full object-contain ${mirrored && !side.facesOpponent ? '-scale-x-100' : ''}`}
                    />
                ) : (
                    <span className="text-lg font-semibold text-theme-text-secondary">
                        {side.name}
                    </span>
                )}
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

const outcomeTitle = (outcome: DuelResult['outcome']) =>
    outcome === 'win' ? 'Victory' : outcome === 'lose' ? 'Defeat' : 'Duel skipped';

/** The numbers still floating over `side` while beat `index` plays. */
const floatsFor = (beats: DuelBeat[], index: number, side: 'player' | 'enemy') =>
    [index - 1, index]
        .filter((i) => i >= 0)
        .map((i) => ({ beat: i, hits: beats[i].hits.filter((h) => h.side === side) }))
        .filter((f) => f.hits.length > 0);

/**
 * In-game duel overlay: "Simulating…" until `result` arrives, then the fight plays back turn by
 * turn (`beatSeconds`) with each ship's HP, shield, charge, buffs and debuffs, the numbers each
 * turn lands and a banner on a charged skill. After the playback the outcome and its effect are
 * shown for `DUEL_RESULT_HOLD_MS` before `onDone` is called (see `afterPlayback`: a loss that ends
 * the run calls it as soon as the playback ends, with no outcome shown). Space or a click skips
 * the playback, and on the outcome calls `onDone` at once. The hold only counts while the page is
 * visible and focused.
 */
export const DuelSummary: React.FC<DuelSummaryProps> = ({
    player,
    opponent,
    stakes,
    result,
    effect,
    onDone,
}) => {
    const [index, setIndex] = useState(0);
    const [finished, setFinished] = useState(false);
    const beats = result?.beats ?? [];

    // An empty fight (a skipped duel) has nothing to play back.
    useEffect(() => {
        if (!result) return;
        const count = result.beats.length;
        if (count === 0) {
            setFinished(true);
            return;
        }
        const perBeat = beatSeconds(count);
        let raf = 0;
        let start: number | null = null;
        let shown = 0;
        // Re-renders only when the shown turn changes, not on every animation frame.
        const tick = (now: number) => {
            start ??= now;
            const elapsed = (now - start) / 1000;
            if (elapsed >= perBeat * count) {
                setFinished(true);
                return;
            }
            const beat = Math.min(count - 1, Math.floor(elapsed / perBeat));
            if (beat !== shown) {
                shown = beat;
                setIndex(beat);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [result]);

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

    const shownIndex = finished ? beats.length - 1 : Math.min(index, beats.length - 1);
    const beat = shownIndex >= 0 ? beats[shownIndex] : null;
    const playing = !!beat && !finished;
    const sideProps = (key: 'player' | 'enemy') => ({
        state: beat?.[key] ?? IDLE,
        floats: playing ? floatsFor(beats, shownIndex, key) : [],
        charged:
            playing && beat.actor === key && beat.charged
                ? { beat: shownIndex, skillName: beat.charged.skillName }
                : null,
    });

    return (
        <div
            className="absolute inset-0 z-[55] flex items-center justify-center p-4 bg-black/70"
            onClick={advance}
        >
            <div className="card w-full max-w-lg space-y-4 text-center">
                <div className="text-sm font-semibold tracking-widest text-primary">
                    {stakesBanner(stakes)}
                </div>
                <div className="flex items-start gap-4">
                    <Side side={player} {...sideProps('player')} />
                    <div className="self-center text-xl font-bold text-theme-text-secondary">
                        VS
                    </div>
                    <Side side={opponent} {...sideProps('enemy')} mirrored />
                </div>
                {!result ? (
                    <p className="text-theme-text-secondary">Simulating…</p>
                ) : !finished ? (
                    <p className="text-theme-text-secondary">Round {beat?.round ?? 0}</p>
                ) : closes ? null : (
                    <div className="space-y-3">
                        <h2 className="text-2xl font-bold">{outcomeTitle(result.outcome)}</h2>
                        {effect && <p className="text-lg">{effectText(effect)}</p>}
                    </div>
                )}
            </div>
        </div>
    );
};
