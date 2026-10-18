import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import FallbackErrorBoundary from '../error/FallbackErrorBoundary';
import { useBodyScrollLock } from '../ui/layout/useBodyScrollLock';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { createGame, step } from '../../utils/arcade/engine';
import { STEP_SECONDS } from '../../utils/arcade/constants';
import { computeScore, runResult } from '../../utils/arcade/scoring';
import { resolveDuel } from '../../utils/arcade/checkpoints';
import type {
    DuelEffect,
    DuelStakes,
    GameState,
    InputAction,
    RunResult,
} from '../../utils/arcade/types';
import { useAuth } from '../../contexts/AuthProvider';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import type { Ship } from '../../types/ship';
import {
    advanceView,
    createFlightView,
    FlightView,
    GateArt,
    INTRO_SECONDS,
    PlayerFrames,
    renderFlight,
} from './flightRenderer';
import {
    BANK_ANGLES_DEG,
    LEVEL_BANK,
    LEVEL_PITCH_ROW,
    PITCH_ANGLES_DEG,
    SweepRef,
} from './ships/spritePoses';
import { whenIdle } from './idle';
import { isSelectDropdownOpen, keyToAction, swipeToAction } from './flightInput';
import { readLocalBest, writeLocalBest } from './localBest';
import { GameOverPanel } from './GameOverPanel';
import { useArcadeSubmission, SubmissionStatus } from './useArcadeSubmission';
import { ArcadeUsernameModal } from './ArcadeUsernameModal';
import { ArcadeLeaderboard } from './ArcadeLeaderboard';
import type { FlightOrigin } from './flightEvents';
import { canDuel, pickOpponents } from './duel/pickOpponents';
import type { DuelResult } from './duel/runDuel';
import { DuelSummary, type DuelSide } from './duel/DuelSummary';
import { factionAccent } from './ships/factionTint';
import { loadPortrait } from './ships/portraitSprite';
import { useShipVisuals } from './ships/useShipVisuals';
import { readLastShipId, writeLastShipId } from './ships/fleetOrder';
import { FighterSelect, PortraitView } from './FighterSelect';
import { shipModelsEnabled } from './ships/arcadeFlags';
import type { ShipVisual } from './ships/shipVisuals';
import { evictOldest } from './ships/viewerCache';

type Phase = 'select' | 'intro' | 'running' | 'paused' | 'countdown' | 'duel' | 'over';

const COUNTDOWN_SECONDS = 3;
/** A long frame (tab switch, GC pause) is clamped so the game never jumps ahead. */
const MAX_FRAME_SECONDS = 0.1;
const HUD_INTERVAL_SECONDS = 0.1;
const NO_INPUT: readonly InputAction[] = [];

const newSeed = () => Math.floor(Math.random() * 2 ** 32) >>> 0;
/** Duel renders kept at once: the flown ship's own (never evicted), the pair at the open
 *  checkpoint and the pre-picked next pair, with room to spare. */
const VIEWER_CACHE_SIZE = 6;

// three.js and the official models are only reachable through these dynamic imports, and
// every caller checks `shipModelsEnabled()` first, so a build without the flag never loads them.
const ShipModelView = React.lazy(() => import('./ships/ShipModelView'));
const shipSprites = () => import('./ships/shipSprites');

type Facing = 'left' | 'right';

const renderShipModel = (ship: Ship, visual: ShipVisual): React.ReactNode => {
    const portrait = <PortraitView ship={ship} visual={visual} />;
    if (!visual.visualKey) return portrait;
    return (
        <FallbackErrorBoundary key={visual.visualKey} fallback={portrait}>
            <Suspense fallback={portrait}>
                <ShipModelView visualKey={visual.visualKey} fallback={portrait} />
            </Suspense>
        </FallbackErrorBoundary>
    );
};

interface DuelState {
    /** Distinguishes this duel from later ones, so a late render lands only in its own. */
    id: number;
    player: DuelSide;
    opponent: DuelSide;
    stakes: DuelStakes;
    result: DuelResult | null;
    effect: DuelEffect | null;
}

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
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const visualOf = useShipVisuals();
    // The game loop reads these through refs so a fleet, gear or template update never restarts it.
    const shipsRef = useRef(ships);
    shipsRef.current = ships;
    const visualOfRef = useRef(visualOf);
    visualOfRef.current = visualOf;
    const statsDepsRef = useRef({ getGearPiece, getEngineeringStatsForShipType });
    statsDepsRef.current = { getGearPiece, getEngineeringStatsForShipType };
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
    /** The two opponents behind each checkpoint's gates, in gate-slot order. */
    const opponentsRef = useRef(new Map<number, [Ship, Ship]>());
    /** The pair for the next checkpoint to appear, picked while the game is not being flown so
     *  their sprites render before the gates are on screen; null → picked when it appears. */
    const nextOpponentsRef = useRef<[Ship, Ship] | null>(null);
    /** Bumped whenever a run is replaced or the game unmounts; a duel simulation that finishes
     *  under an older generation is discarded. */
    const runGenerationRef = useRef(0);
    /** The flown ship's rendered frame grid; `frames` is null until its level row is ready,
     *  and the other rows fill in later. */
    const playerFramesRef = useRef<{ shipId: string; frames: PlayerFrames | null } | null>(null);
    /** Gate sprites by visual key, as data URLs: in flight, and finished. */
    const spriteRequestsRef = useRef(new Map<string, Promise<string>>());
    /** Duel-summary renders by `${visualKey}:${facing}`, as data URLs: in flight, and finished. */
    const viewerRequestsRef = useRef(new Map<string, Promise<string>>());
    const viewerUrlsRef = useRef(new Map<string, string>());
    /** The flown ship's duel render id, kept when the viewer caches are bounded. */
    const playerViewerIdRef = useRef<string | null>(null);
    const duelSeqRef = useRef(0);

    const [phase, setPhaseState] = useState<Phase>(phaseRef.current);
    const [hud, setHud] = useState({ score: 0, credits: 0, shield: false, magnet: 0 });
    const [countdown, setCountdown] = useState(0);
    const [result, setResult] = useState<RunResult | null>(null);
    const [localBest, setLocalBest] = useState(readLocalBest);
    const [previousBest, setPreviousBest] = useState(0);
    const [duel, setDuel] = useState<DuelState | null>(null);
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

    /** A ship at the official viewer's angle, bow toward `facing`, as a data URL; rendered once
     *  per visual key and facing. */
    const requestViewerSprite = useCallback((key: string, facing: Facing): Promise<string> => {
        const id = `${key}:${facing}`;
        const isPinned = (k: string) => k === playerViewerIdRef.current;
        let p = viewerRequestsRef.current.get(id);
        if (!p) {
            p = shipSprites()
                .then((m) => m.renderViewerSprite(key, facing))
                .then((canvas) => {
                    const url = canvas.toDataURL();
                    viewerUrlsRef.current.set(id, url);
                    evictOldest(viewerUrlsRef.current, VIEWER_CACHE_SIZE, isPinned);
                    return url;
                });
            p.catch(() => viewerRequestsRef.current.delete(id));
            viewerRequestsRef.current.set(id, p);
            evictOldest(viewerRequestsRef.current, VIEWER_CACHE_SIZE, isPinned);
        }
        return p;
    }, []);

    /** Renders the flown ship's frame grid once per ship: the level heading sweep first, then
     *  its duel render and the banked, pitched and pitched-banked sweeps, each in idle time. A
     *  sweep that fails to render is skipped. The run keeps the neon fighter until the level
     *  sweep is ready, and for good if it fails. */
    const requestPlayerFrames = useCallback(
        (ship: Ship) => {
            const key = shipModelsEnabled() ? visualOfRef.current(ship).visualKey : null;
            if (!key || playerFramesRef.current?.shipId === ship.id) return;
            playerFramesRef.current = { shipId: ship.id, frames: null };
            playerViewerIdRef.current = `${key}:right`;
            const isCurrent = () => playerFramesRef.current?.shipId === ship.id;
            const pitches = PITCH_ANGLES_DEG.map((_, i) => i);
            const banks = BANK_ANGLES_DEG.map((_, i) => i);
            const pitched = pitches.filter((p) => p !== LEVEL_PITCH_ROW);
            const banked = banks.filter((b) => b !== LEVEL_BANK);
            const idleBatches: SweepRef[][] = [
                banked.map((bank) => ({ pitch: LEVEL_PITCH_ROW, bank })),
                pitched.map((pitch) => ({ pitch, bank: LEVEL_BANK })),
                ...pitched.map((pitch) => banked.map((bank) => ({ pitch, bank }))),
            ];
            shipSprites()
                .then(async (m) => {
                    const level = { pitch: LEVEL_PITCH_ROW, bank: LEVEL_BANK };
                    const [levelSweep] = await m.renderChaseSweeps(key, [level]);
                    if (!isCurrent()) return;
                    const frames: PlayerFrames = pitches.map(() => banks.map(() => null));
                    frames[level.pitch][level.bank] = levelSweep;
                    playerFramesRef.current = { shipId: ship.id, frames };
                    if (flownRef.current?.id === ship.id) viewRef.current.playerFrames = frames;
                    void requestViewerSprite(key, 'right').catch(() => {});
                    // The view holds `frames` itself, so sweeps filled in here show up next frame.
                    for (const batch of idleBatches) {
                        let sweeps: HTMLCanvasElement[][];
                        try {
                            sweeps = await m.renderChaseSweeps(key, batch, { idle: true });
                        } catch {
                            continue;
                        }
                        if (!isCurrent()) return;
                        batch.forEach(({ pitch, bank }, i) => (frames[pitch][bank] = sweeps[i]));
                    }
                })
                .catch(() => {
                    if (isCurrent() && !playerFramesRef.current?.frames) {
                        playerFramesRef.current = null;
                    }
                });
        },
        [requestViewerSprite]
    );

    /** A ship's gate sprite as a data URL, rendered once per visual key. */
    const requestSprite = useCallback((key: string): Promise<string> => {
        let p = spriteRequestsRef.current.get(key);
        if (!p) {
            p = shipSprites()
                .then((m) => m.renderGateSprite(key))
                .then((canvas) => canvas.toDataURL());
            p.catch(() => spriteRequestsRef.current.delete(key));
            spriteRequestsRef.current.set(key, p);
        }
        return p;
    }, []);

    /** Starts loading a ship's gate art: its portrait and, with models on, its sprite. */
    const warmGateArt = useCallback(
        (ship: Ship) => {
            const { portraitUrl, visualKey } = visualOfRef.current(ship);
            if (portraitUrl) void loadPortrait(portraitUrl).catch(() => {});
            if (shipModelsEnabled() && visualKey) {
                void requestSprite(visualKey).catch(() => {});
                void requestViewerSprite(visualKey, 'left').catch(() => {});
            }
        },
        [requestSprite, requestViewerSprite]
    );

    /** Picks the next checkpoint's opponents now and starts rendering their art. */
    const prepareNextOpponents = useCallback(() => {
        const flown = flownRef.current;
        const pick =
            flown && duelsRef.current
                ? pickOpponents(shipsRef.current, flown.id, Math.random)
                : null;
        nextOpponentsRef.current = pick;
        pick?.forEach(warmGateArt);
    }, [warmGateArt]);

    // A run that starts without the select screen picks its first opponents on mount.
    useEffect(() => {
        if (initial.flown) prepareNextOpponents();
    }, [initial.flown, prepareNextOpponents]);

    // Visual keys need the ship templates, which may arrive after mount.
    useEffect(() => {
        if (flownRef.current) requestPlayerFrames(flownRef.current);
        nextOpponentsRef.current?.forEach(warmGateArt);
    }, [visualOf, requestPlayerFrames, warmGateArt]);

    /** Starts a fresh run with the flown ship and duel setting already in the refs. */
    const restart = useCallback(() => {
        const flown = flownRef.current;
        runGenerationRef.current++;
        opponentsRef.current.clear();
        prepareNextOpponents();
        setDuel(null);
        gameRef.current = createGame(newSeed(), { duels: duelsRef.current });
        viewRef.current = createFlightView(undefined, flown ? factionAccent(flown.faction) : null);
        const rendered = playerFramesRef.current;
        viewRef.current.playerFrames =
            flown && rendered?.shipId === flown.id ? rendered.frames : null;
        inputsRef.current = [];
        setResult(null);
        setHud({ score: 0, credits: 0, shield: false, magnet: 0 });
        setPhase('running');
    }, [setPhase, prepareNextOpponents]);

    const launch = useCallback(
        (ship: Ship) => {
            writeLastShipId(ship.id);
            flownRef.current = ship;
            duelsRef.current = canDuel(ships, ship.id);
            requestPlayerFrames(ship);
            restart();
        },
        [ships, restart, requestPlayerFrames]
    );

    const finishRun = useCallback(() => {
        const r = runResult(gameRef.current);
        setResult(r);
        setPreviousBest(readLocalBest());
        setLocalBest(writeLocalBest(r.score));
        setPhase('over');
    }, [setPhase]);

    /** A duel side: the official-angle render facing `facing` if it is ready, else the portrait.
     *  `pending` resolves to the render when the side shows the portrait while models are on. */
    const toSide = useCallback(
        (ship: Ship, facing: Facing): { side: DuelSide; pending: Promise<string> | null } => {
            const visual = visualOfRef.current(ship);
            const key = shipModelsEnabled() ? visual.visualKey : null;
            const render = key ? viewerUrlsRef.current.get(`${key}:${facing}`) : undefined;
            if (render) {
                const side = { name: ship.name, level: ship.level, imageUrl: render };
                return { side: { ...side, facesOpponent: true }, pending: null };
            }
            return {
                side: { name: ship.name, level: ship.level, imageUrl: visual.portraitUrl },
                pending: key ? requestViewerSprite(key, facing) : null,
            };
        },
        [requestViewerSprite]
    );

    /** Opens the summary for the game's pending duel and simulates it off the frame. */
    const startDuel = useCallback(() => {
        const game = gameRef.current;
        const pending = game.pendingDuel;
        // Re-resolved so the duel uses the ship as ShipsContext currently enriches it.
        const flown =
            shipsRef.current.find((s) => s.id === flownRef.current?.id) ?? flownRef.current;
        const opponent = pending
            ? opponentsRef.current.get(pending.checkpointId)?.[pending.slot]
            : undefined;
        if (!pending || !flown || !opponent) {
            resolveDuel(game, 'skipped');
            prepareNextOpponents();
            setCountdown(COUNTDOWN_SECONDS);
            setPhase('countdown');
            return;
        }
        setPhase('duel');
        const generation = runGenerationRef.current;
        const id = ++duelSeqRef.current;
        const player = toSide(flown, 'right');
        const rival = toSide(opponent, 'left');
        setDuel({
            id,
            player: player.side,
            opponent: rival.side,
            stakes: pending.stakes,
            result: null,
            effect: null,
        });
        // A side showing the portrait switches to its render if it arrives while this duel is
        // still open; the duel never waits for it.
        const swapIn = (which: 'player' | 'opponent', render: Promise<string> | null) =>
            render
                ?.then((imageUrl) =>
                    setDuel((d) =>
                        d && d.id === id && generation === runGenerationRef.current
                            ? { ...d, [which]: { ...d[which], imageUrl, facesOpponent: true } }
                            : d
                    )
                )
                .catch(() => {});
        void swapIn('player', player.pending);
        void swapIn('opponent', rival.pending);
        prepareNextOpponents();
        // The animation frame commits the "Simulating…" state; the timeout then runs the
        // synchronous simulation after that frame has been painted.
        const simulate = async () => {
            let r: DuelResult;
            try {
                const { runDuel } = await import('./duel/runDuel');
                if (generation !== runGenerationRef.current) return;
                r = runDuel(flown, opponent, statsDepsRef.current, newSeed());
            } catch {
                r = { outcome: 'skipped', timeline: [] };
            }
            if (generation !== runGenerationRef.current) return;
            const effect = resolveDuel(gameRef.current, r.outcome);
            setDuel((d) => d && { ...d, result: r, effect });
        };
        requestAnimationFrame(() => window.setTimeout(() => void simulate(), 0));
    }, [setPhase, toSide, prepareNextOpponents]);

    const onDuelDone = useCallback(() => {
        if (phaseRef.current !== 'duel') return;
        const game = gameRef.current;
        // A duel still being simulated has not been resolved yet.
        if (game.status === 'duel') return;
        setDuel(null);
        setHud({
            score: computeScore(game),
            credits: game.credits,
            shield: game.player.shield,
            magnet: game.player.magnetTime,
        });
        if (game.status === 'over') {
            finishRun();
            return;
        }
        setCountdown(COUNTDOWN_SECONDS);
        setPhase('countdown');
    }, [finishRun, setPhase]);

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
        const generation = runGenerationRef;
        /** Checkpoints whose gates have been passed and handled. */
        const passed = new WeakSet<object>();

        /** The pre-picked pair, re-resolved against the current fleet; null if a ship has left
         *  the fleet or is now the flown one. */
        const takePrepared = (flownId: string): [Ship, Ship] | null => {
            const prepared = nextOpponentsRef.current;
            nextOpponentsRef.current = null;
            if (!prepared) return null;
            const current = prepared.map((p) =>
                shipsRef.current.find((s) => s.id === p.id && s.id !== flownId)
            );
            return current[0] && current[1] ? [current[0], current[1]] : null;
        };

        const toGateArt = (ship: Ship): GateArt => {
            const { portraitUrl, visualKey } = visualOfRef.current(ship);
            if (portraitUrl) void loadPortrait(portraitUrl).catch(() => {});
            const art: GateArt = { name: ship.name, level: ship.level, portraitUrl };
            if (shipModelsEnabled() && visualKey) {
                requestSprite(visualKey)
                    .then((url) => loadPortrait(url))
                    .then((img) => {
                        art.spriteUrl = img.src;
                    })
                    .catch(() => {});
            }
            return art;
        };

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

                const flown = flownRef.current;
                for (const c of game.checkpoints) {
                    if (view.gateArt.has(c.id) || c.resolved || !flown) continue;
                    const pick =
                        takePrepared(flown.id) ??
                        pickOpponents(shipsRef.current, flown.id, Math.random);
                    if (!pick) {
                        // No opponents to show: the engine ignores a resolved checkpoint.
                        c.resolved = true;
                        continue;
                    }
                    opponentsRef.current.set(c.id, pick);
                    view.gateArt.set(c.id, [toGateArt(pick[0]), toGateArt(pick[1])]);
                }

                if (game.status === 'over') finishRun();
                else if (game.status === 'duel') startDuel();
                // Passing a checkpoint through the free lane starts no duel, so the next pair
                // is picked in the next idle time, as far as possible from the next lane choice.
                for (const c of game.checkpoints) {
                    if (!c.resolved || passed.has(c) || !view.gateArt.has(c.id)) continue;
                    passed.add(c);
                    if (game.status === 'running' && !nextOpponentsRef.current) {
                        const run = runGenerationRef.current;
                        void whenIdle().then(() => {
                            if (run === runGenerationRef.current && !nextOpponentsRef.current) {
                                prepareNextOpponents();
                            }
                        });
                    }
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
            generation.current++;
        };
    }, [setPhase, finishRun, startDuel, requestSprite, prepareNextOpponents]);

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
                    {phase !== 'over' && phase !== 'select' && phase !== 'duel' && (
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
                    renderShip={shipModelsEnabled() ? renderShipModel : undefined}
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
            {phase === 'duel' && duel && (
                <DuelSummary
                    player={duel.player}
                    opponent={duel.opponent}
                    stakes={duel.stakes}
                    result={duel.result}
                    effect={duel.effect}
                    onDone={onDuelDone}
                />
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
