import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/Button';
import { MeterBar } from '../../ui/MeterBar';
import type { DuelEffect, DuelStakes } from '../../../utils/arcade/types';
import type { DuelResult } from './runDuel';
import { effectText, stakesBanner } from './stakesText';

/** The duel's playback length; the whole timeline plays in this time whatever its round count. */
const ANIM_SECONDS = 5;

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

/** `mirrored` flips an image that does not already face the opponent (a portrait). */
const Side: React.FC<{ side: DuelSide; hp: number; mirrored?: boolean }> = ({
    side,
    hp,
    mirrored = false,
}) => (
    <div className="flex-1 min-w-0 space-y-2">
        <div className="h-28 flex items-center justify-center">
            {side.imageUrl ? (
                <img
                    src={side.imageUrl}
                    alt={side.name}
                    className={`max-h-full max-w-full object-contain ${mirrored && !side.facesOpponent ? '-scale-x-100' : ''}`}
                />
            ) : (
                <span className="text-lg font-semibold text-theme-text-secondary">{side.name}</span>
            )}
        </div>
        <div className="truncate font-semibold">{side.name}</div>
        {side.level !== undefined && (
            <div className="text-sm text-theme-text-secondary">Lv {side.level}</div>
        )}
        <MeterBar percentage={hp} label={`${side.name} hull`} fillClassName={hpFill(hp)} />
        <div className="text-xs text-theme-text-secondary">{Math.round(hp)}% HP</div>
    </div>
);

const outcomeTitle = (outcome: DuelResult['outcome']) =>
    outcome === 'win' ? 'Victory' : outcome === 'lose' ? 'Defeat' : 'Duel skipped';

/**
 * In-game duel overlay: "Simulating…" until `result` arrives, then the HP timeline plays back
 * over `ANIM_SECONDS` and the outcome and its effect are shown. Space or a click skips the
 * playback; once the outcome is shown, Space, a click or Continue calls `onDone`.
 */
export const DuelSummary: React.FC<DuelSummaryProps> = ({
    player,
    opponent,
    stakes,
    result,
    effect,
    onDone,
}) => {
    const [t, setT] = useState(0);
    const [finished, setFinished] = useState(false);
    const timeline = result?.timeline ?? [];

    // An empty timeline (a skipped duel) has nothing to play back.
    useEffect(() => {
        if (!result) return;
        if (result.timeline.length === 0) {
            setFinished(true);
            return;
        }
        let raf = 0;
        let start: number | null = null;
        const tick = (now: number) => {
            start ??= now;
            const elapsed = (now - start) / 1000;
            if (elapsed >= ANIM_SECONDS) {
                setT(ANIM_SECONDS);
                setFinished(true);
                return;
            }
            setT(elapsed);
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

    const index = finished
        ? timeline.length - 1
        : Math.min(timeline.length - 1, Math.floor((t / ANIM_SECONDS) * timeline.length));
    const point = index >= 0 ? timeline[index] : null;
    const playerHp = point?.playerHpPct ?? 100;
    const enemyHp = point?.enemyHpPct ?? 100;

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
                    <Side side={player} hp={playerHp} />
                    <div className="self-center text-xl font-bold text-theme-text-secondary">
                        VS
                    </div>
                    <Side side={opponent} hp={enemyHp} mirrored />
                </div>
                {!result ? (
                    <p className="text-theme-text-secondary">Simulating…</p>
                ) : !finished ? (
                    <p className="text-theme-text-secondary">Round {point?.round ?? 0}</p>
                ) : (
                    <div className="space-y-3">
                        <h2 className="text-2xl font-bold">{outcomeTitle(result.outcome)}</h2>
                        {effect && <p className="text-lg">{effectText(effect)}</p>}
                        <Button
                            onClick={(e) => {
                                e.stopPropagation();
                                onDone();
                            }}
                        >
                            Continue
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};
