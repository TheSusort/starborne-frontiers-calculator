import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { useBodyScrollLock } from '../ui/layout/useBodyScrollLock';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { createGame, step } from '../../utils/arcade/engine';
import { STEP_SECONDS } from '../../utils/arcade/constants';
import { computeScore, runResult } from '../../utils/arcade/scoring';
import type { GameState, InputAction, RunResult } from '../../utils/arcade/types';
import { useAuth } from '../../contexts/AuthProvider';
import { useShips } from '../../contexts/ShipsContext';
import type { Ship } from '../../types/ship';
import {
    advanceView,
    createFlightView,
    FlightView,
    INTRO_SECONDS,
    renderFlight,
} from './flightRenderer';
import { isSelectDropdownOpen, keyToAction, swipeToAction } from './flightInput';
import { readLocalBest, writeLocalBest } from './localBest';
import { GameOverPanel } from './GameOverPanel';
import { useArcadeSubmission, SubmissionStatus } from './useArcadeSubmission';
import { ArcadeUsernameModal } from './ArcadeUsernameModal';
import { ArcadeLeaderboard } from './ArcadeLeaderboard';
import type { FlightOrigin } from './flightEvents';
import { canDuel } from './duel/pickOpponents';
import { factionAccent } from './ships/factionTint';
import { readLastShipId, writeLastShipId } from './ships/fleetOrder';
import { FighterSelect } from './FighterSelect';

type Phase = 'select' | 'intro' | 'running' | 'paused' | 'countdown' | 'duel' | 'over';

const COUNTDOWN_SECONDS = 3;
/** A long frame (tab switch, GC pause) is clamped so the game never jumps ahead. */
const MAX_FRAME_SECONDS = 0.1;
const HUD_INTERVAL_SECONDS = 0.1;
const NO_INPUT: readonly InputAction[] = [];

const newSeed = () => Math.floor(Math.random() * 2 ** 32) >>> 0;

const SubmissionLine: React.FC<{
    status: SubmissionStatus;
    rank: number | null;
    onRetry: () => void;
}> = ({ status, rank, onRetry }) => {
    switch (status) {
        case 'signed-out':
            return (
                <p className="text-sm text-theme-text-secondary">
                    Sign in to join the leaderboard.
                </p>
            );
        case 'checking':
        case 'submitting':
            return <p className="text-sm text-theme-text-secondary">Saving score...</p>;
        case 'submitted':
            return (
                <p className="text-sm text-theme-text-secondary">
                    {rank ? `Leaderboard rank #${rank}` : 'Score saved'}
                </p>
            );
        case 'skipped':
            return <p className="text-sm text-theme-text-secondary">Score not submitted.</p>;
        case 'error':
            return (
                <div className="space-y-2">
                    <p className="text-sm text-red-400">Could not save your score.</p>
                    <Button variant="secondary" size="sm" onClick={onRetry}>
                        Retry
                    </Button>
                </div>
            );
        default:
            return null;
    }
};

interface FlightGameProps {
    origin?: FlightOrigin;
    onClose: () => void;
}

const FlightGame: React.FC<FlightGameProps> = ({ origin, onClose }) => {
    const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const startOrigin = reducedMotion ? undefined : origin;

    const { ships } = useShips();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // The background easter egg skips the select screen and flies the last chosen ship, if
    // it is still owned; otherwise a fleet opens on the select screen.
    const [initial] = useState(() => {
        const lastShipId = readLastShipId();
        const flown = startOrigin ? (ships.find((s) => s.id === lastShipId) ?? null) : null;
        const duels = canDuel(ships, flown?.id ?? null);
        const phase: Phase = startOrigin ? 'intro' : ships.length > 0 ? 'select' : 'running';
        return {
            lastShipId,
            flown,
            duels,
            phase,
            game: createGame(newSeed(), { duels }),
            view: createFlightView(startOrigin, flown ? factionAccent(flown.faction) : null),
        };
    });
    const gameRef = useRef<GameState>(initial.game);
    const viewRef = useRef<FlightView>(initial.view);
    const flownRef = useRef<Ship | null>(initial.flown);
    const duelsRef = useRef(initial.duels);
    const rootRef = useRef<HTMLDivElement>(null);
    const inputsRef = useRef<InputAction[]>([]);
    const phaseRef = useRef<Phase>(initial.phase);
    const escapeBlockedRef = useRef(false);
    const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

    const [phase, setPhaseState] = useState<Phase>(phaseRef.current);
    const [hud, setHud] = useState({ score: 0, credits: 0, shield: false, magnet: 0 });
    const [countdown, setCountdown] = useState(0);
    const [result, setResult] = useState<RunResult | null>(null);
    const [localBest, setLocalBest] = useState(readLocalBest);
    const [previousBest, setPreviousBest] = useState(0);
    const { user } = useAuth();
    const submission = useArcadeSubmission(result);

    // While the username modal is open, Escape belongs to the modal.
    useEffect(() => {
        escapeBlockedRef.current = phase === 'over' && submission.status === 'needs-username';
    }, [phase, submission.status]);

    useBodyScrollLock(true);

    const setPhase = useCallback((p: Phase) => {
        phaseRef.current = p;
        setPhaseState(p);
    }, []);

    const resume = useCallback(() => {
        if (phaseRef.current !== 'paused') return;
        // A run paused during the intro skips the rest of it and resumes through the countdown.
        viewRef.current.introElapsed = Math.max(viewRef.current.introElapsed, INTRO_SECONDS);
        setCountdown(COUNTDOWN_SECONDS);
        setPhase('countdown');
    }, [setPhase]);

    const isPausable = (p: Phase) => p === 'intro' || p === 'running' || p === 'countdown';

    const togglePause = useCallback(() => {
        if (isPausable(phaseRef.current)) setPhase('paused');
        else resume();
    }, [resume, setPhase]);

    /** Starts a fresh run with the flown ship and duel setting already in the refs. */
    const restart = useCallback(() => {
        const flown = flownRef.current;
        gameRef.current = createGame(newSeed(), { duels: duelsRef.current });
        viewRef.current = createFlightView(undefined, flown ? factionAccent(flown.faction) : null);
        inputsRef.current = [];
        setResult(null);
        setHud({ score: 0, credits: 0, shield: false, magnet: 0 });
        setPhase('running');
    }, [setPhase]);

    const launch = useCallback(
        (ship: Ship) => {
            writeLastShipId(ship.id);
            flownRef.current = ship;
            duelsRef.current = canDuel(ships, ship.id);
            restart();
        },
        [ships, restart]
    );

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
                    setPreviousBest(readLocalBest());
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

    // Focus moves into the overlay so keyboard input never lands on the page underneath.
    useEffect(() => {
        rootRef.current?.focus();
    }, []);

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
            if (isPausable(phaseRef.current)) setPhase('paused');
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
                // On the select screen an open dropdown owns Escape: the Select closes itself
                // (React handler, too late for this capture listener to defer to).
                if (phaseRef.current === 'select' && isSelectDropdownOpen()) return;
                if (!escapeBlockedRef.current) onClose();
                return;
            }
            const p = phaseRef.current;
            if (p === 'over' || p === 'select') return;
            if (e.key === 'p' || e.key === 'P') {
                if (!e.repeat) togglePause();
                return;
            }
            if (p !== 'running' && p !== 'paused') return;
            const action = keyToAction(e.key);
            if (!action) return;
            e.preventDefault();
            if (e.repeat) return;
            if (p === 'running') inputsRef.current.push(action);
            else resume();
        };
        // Capture phase: the handler reads escapeBlockedRef before the modal's own Escape
        // handler can change the status.
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose, resume, togglePause]);

    const onPointerDown = (e: React.PointerEvent) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        swipeStartRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerCancel = () => {
        swipeStartRef.current = null;
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
            ref={rootRef}
            tabIndex={-1}
            className="fixed inset-0 z-50 bg-black select-none outline-none"
            role="dialog"
            aria-modal="true"
            aria-label="Synthwave arcade"
        >
            <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full touch-none"
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
            />
            <div className="absolute top-0 inset-x-0 flex justify-between items-start p-4 pointer-events-none text-white font-mono">
                {phase === 'select' ? (
                    <div />
                ) : (
                    <div>
                        <div className="text-2xl">{hud.score.toLocaleString()}</div>
                        <div className="text-sm text-yellow-300">{hud.credits} credits</div>
                    </div>
                )}
                <div className="flex gap-2 items-center pointer-events-auto">
                    {hud.shield && <span className="text-cyan-300 text-sm">SHIELD</span>}
                    {hud.magnet > 0 && (
                        <span className="text-pink-300 text-sm">
                            MAGNET {Math.ceil(hud.magnet)}
                        </span>
                    )}
                    {phase !== 'over' && phase !== 'select' && (
                        <Button variant="secondary" size="sm" onClick={togglePause}>
                            {phase === 'paused' ? 'Resume' : 'Pause'}
                        </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={onClose}>
                        Quit
                    </Button>
                </div>
            </div>
            {phase === 'select' && (
                <FighterSelect
                    ships={ships}
                    initialShipId={initial.lastShipId}
                    onLaunch={launch}
                    onQuit={onClose}
                />
            )}
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
                    previousBest={previousBest}
                    onRetry={restart}
                    onQuit={onClose}
                >
                    <SubmissionLine
                        status={submission.status}
                        rank={submission.rank}
                        onRetry={submission.retry}
                    />
                    <div className="max-h-64 overflow-y-auto text-left">
                        <ArcadeLeaderboard refreshKey={submission.leaderboardVersion} />
                    </div>
                </GameOverPanel>
            )}
            {user && (
                <ArcadeUsernameModal
                    isOpen={phase === 'over' && submission.status === 'needs-username'}
                    userId={user.id}
                    onSaved={submission.onUsernameSaved}
                    onCancel={submission.skip}
                />
            )}
        </div>
    );
};

export default FlightGame;
