import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { useBodyScrollLock } from '../ui/layout/Modal';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { createGame, step } from '../../utils/arcade/engine';
import { STEP_SECONDS } from '../../utils/arcade/constants';
import { computeScore, runResult } from '../../utils/arcade/scoring';
import type { GameState, InputAction, RunResult } from '../../utils/arcade/types';
import {
    advanceView,
    createFlightView,
    FlightView,
    INTRO_SECONDS,
    renderFlight,
} from './flightRenderer';
import { keyToAction, swipeToAction } from './flightInput';
import { readLocalBest, writeLocalBest } from './localBest';
import { GameOverPanel } from './GameOverPanel';
import type { FlightOrigin } from './flightEvents';

type Phase = 'intro' | 'running' | 'paused' | 'countdown' | 'over';

const COUNTDOWN_SECONDS = 3;
/** A long frame (tab switch, GC pause) is clamped so the game never jumps ahead. */
const MAX_FRAME_SECONDS = 0.1;
const HUD_INTERVAL_SECONDS = 0.1;
const NO_INPUT: readonly InputAction[] = [];

const newSeed = () => Math.floor(Math.random() * 2 ** 32) >>> 0;

interface FlightGameProps {
    origin?: FlightOrigin;
    onClose: () => void;
}

const FlightGame: React.FC<FlightGameProps> = ({ origin, onClose }) => {
    const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const startOrigin = reducedMotion ? undefined : origin;

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gameRef = useRef<GameState>(createGame(newSeed()));
    const viewRef = useRef<FlightView>(createFlightView(startOrigin));
    const inputsRef = useRef<InputAction[]>([]);
    const phaseRef = useRef<Phase>(startOrigin ? 'intro' : 'running');
    const escapeBlockedRef = useRef(false);
    const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

    const [phase, setPhaseState] = useState<Phase>(phaseRef.current);
    const [hud, setHud] = useState({ score: 0, credits: 0, shield: false, magnet: 0 });
    const [countdown, setCountdown] = useState(0);
    const [result, setResult] = useState<RunResult | null>(null);
    const [localBest, setLocalBest] = useState(readLocalBest);

    useBodyScrollLock(true);

    const setPhase = useCallback((p: Phase) => {
        phaseRef.current = p;
        setPhaseState(p);
    }, []);

    const resume = useCallback(() => {
        if (phaseRef.current !== 'paused') return;
        setCountdown(COUNTDOWN_SECONDS);
        setPhase('countdown');
    }, [setPhase]);

    const togglePause = useCallback(() => {
        if (phaseRef.current === 'running' || phaseRef.current === 'countdown') setPhase('paused');
        else resume();
    }, [resume, setPhase]);

    const restart = useCallback(() => {
        gameRef.current = createGame(newSeed());
        viewRef.current = createFlightView();
        inputsRef.current = [];
        setResult(null);
        setHud({ score: 0, credits: 0, shield: false, magnet: 0 });
        setPhase('running');
    }, [setPhase]);

    // Game loop: fixed-step simulation, render every frame.
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = canvas.offsetWidth * dpr;
            canvas.height = canvas.offsetHeight * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            viewRef.current.sun.canvas = null;
        };
        resize();
        window.addEventListener('resize', resize);

        let raf = 0;
        let last = performance.now();
        let acc = 0;
        let hudTimer = 0;

        const frame = (now: number) => {
            const dt = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
            last = now;
            const game = gameRef.current;
            const view = viewRef.current;

            if (phaseRef.current === 'intro') {
                view.introElapsed += dt;
                if (view.introElapsed >= INTRO_SECONDS) setPhase('running');
            } else if (phaseRef.current === 'running') {
                acc += dt;
                let inputs: readonly InputAction[] = inputsRef.current.splice(0);
                while (acc >= STEP_SECONDS && game.status === 'running') {
                    const before = game.distance;
                    step(game, inputs, STEP_SECONDS);
                    inputs = NO_INPUT;
                    advanceView(view, game.distance - before);
                    acc -= STEP_SECONDS;
                }
                if (inputs.length > 0) inputsRef.current.unshift(...inputs);

                if (game.status === 'over') {
                    const r = runResult(game);
                    setResult(r);
                    setLocalBest(writeLocalBest(r.score));
                    setPhase('over');
                }
                hudTimer += dt;
                if (hudTimer >= HUD_INTERVAL_SECONDS) {
                    hudTimer = 0;
                    setHud({
                        score: computeScore(game),
                        credits: game.credits,
                        shield: game.player.shield,
                        magnet: game.player.magnetTime,
                    });
                }
            } else {
                acc = 0;
            }

            renderFlight(ctx, game, view, now, dt);
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', resize);
        };
    }, [setPhase]);

    // Resume countdown.
    useEffect(() => {
        if (phase !== 'countdown') return;
        if (countdown <= 0) {
            setPhase('running');
            return;
        }
        const id = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
        return () => window.clearTimeout(id);
    }, [phase, countdown, setPhase]);

    // Auto-pause when the tab is hidden or the window loses focus.
    useEffect(() => {
        const pause = () => {
            if (phaseRef.current === 'running' || phaseRef.current === 'countdown')
                setPhase('paused');
        };
        const onVisibility = () => {
            if (document.hidden) pause();
        };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('blur', pause);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('blur', pause);
        };
    }, [setPhase]);

    // Keyboard. Keys are only captured while flying or paused, so typing elsewhere is untouched.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (!escapeBlockedRef.current) onClose();
                return;
            }
            const p = phaseRef.current;
            if (p !== 'running' && p !== 'paused') return;
            if (e.key === 'p' || e.key === 'P') {
                togglePause();
                return;
            }
            const action = keyToAction(e.key);
            if (!action) return;
            e.preventDefault();
            if (p === 'running') inputsRef.current.push(action);
            else resume();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, resume, togglePause]);

    const onPointerDown = (e: React.PointerEvent) => {
        swipeStartRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: React.PointerEvent) => {
        const start = swipeStartRef.current;
        swipeStartRef.current = null;
        if (!start) return;
        if (phaseRef.current === 'paused') {
            resume();
            return;
        }
        const action = swipeToAction(e.clientX - start.x, e.clientY - start.y);
        if (action && phaseRef.current === 'running') inputsRef.current.push(action);
    };

    return (
        <div
            className="fixed inset-0 z-50 bg-black select-none"
            role="dialog"
            aria-modal="true"
            aria-label="Synthwave arcade"
        >
            <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full touch-none"
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
            />
            <div className="absolute top-0 inset-x-0 flex justify-between items-start p-4 pointer-events-none text-white font-mono">
                <div>
                    <div className="text-2xl">{hud.score.toLocaleString()}</div>
                    <div className="text-sm text-yellow-300">{hud.credits} credits</div>
                </div>
                <div className="flex gap-2 items-center pointer-events-auto">
                    {hud.shield && <span className="text-cyan-300 text-sm">SHIELD</span>}
                    {hud.magnet > 0 && (
                        <span className="text-pink-300 text-sm">
                            MAGNET {Math.ceil(hud.magnet)}
                        </span>
                    )}
                    {phase !== 'over' && (
                        <Button variant="secondary" size="sm" onClick={togglePause}>
                            {phase === 'paused' ? 'Resume' : 'Pause'}
                        </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={onClose}>
                        Quit
                    </Button>
                </div>
            </div>
            {phase === 'paused' && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="card text-center space-y-3 pointer-events-auto">
                        <p className="text-xl font-semibold">Paused</p>
                        <Button onClick={resume}>Resume</Button>
                    </div>
                </div>
            )}
            {phase === 'countdown' && countdown > 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-6xl font-bold text-white">
                    {countdown}
                </div>
            )}
            {phase === 'over' && result && (
                <GameOverPanel
                    result={result}
                    localBest={localBest}
                    onRetry={restart}
                    onQuit={onClose}
                />
            )}
        </div>
    );
};

export default FlightGame;
