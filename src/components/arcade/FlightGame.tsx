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
    renderFlight,
} from './flightRenderer';
import { runWhenIdle, whenIdle } from './idle';
import { isSelectDropdownOpen, keyToAction, swipeToAction } from './flightInput';
import { readLocalBest, writeLocalBest } from './localBest';
import { GameOverPanel } from './GameOverPanel';
import { useArcadeSubmission, SubmissionStatus } from './useArcadeSubmission';
import { ArcadeUsernameModal } from './ArcadeUsernameModal';
import { ArcadeLeaderboard } from './ArcadeLeaderboard';
import type { FlightOrigin } from './flightEvents';
import { canDuel, pickOpponents } from './duel/pickOpponents';
import { createSpeedLines } from './speedLines';
import type { DuelResult } from './duel/runDuel';
import { DuelSummary, type DuelSide } from './duel/DuelSummary';
import { factionAccent } from './ships/factionTint';
import { loadPortrait } from './ships/portraitSprite';
import { useShipVisuals } from './ships/useShipVisuals';
import { readLastShipId, writeLastShipId } from './ships/fleetOrder';
import { FighterSelect, PortraitView } from './FighterSelect';
import { loadShipModelView, shipModelsEnabled } from './ships/arcadeFlags';
import type { ShipVisual } from './ships/shipVisuals';
import {
    anySignal,
    cachedGateSprite,
    cachedPlayerFrames,
    cachedViewerSprite,
    endArcadeSession,
    Facing,
    requestGateSprite,
    requestPlayerFrames,
    requestViewerSprite,
    setArcadePins,
} from './ships/arcadeSprites';

type Phase = 'select' | 'intro' | 'running' | 'paused' | 'countdown' | 'duel' | 'over';

const COUNTDOWN_SECONDS = 3;
/** A long frame (tab switch, GC pause) is clamped so the game never jumps ahead. */
const MAX_FRAME_SECONDS = 0.1;
const HUD_INTERVAL_SECONDS = 0.1;
const NO_INPUT: readonly InputAction[] = [];

const newSeed = () => Math.floor(Math.random() * 2 ** 32) >>> 0;
/** How long a ship stays focused on the select screen before its own sprites start rendering. */
const FOCUS_PREWARM_MS = 400;
/** How long it stays focused before its first opponents are picked and their art loads too. */
const FOCUS_OPPONENTS_MS = 1500;
/** Stands in for the session signal outside a mounted arcade: nothing started under it runs. */
const ABORTED_SIGNAL = (() => {
    const c = new AbortController();
    c.abort();
    return c.signal;
})();

const ShipModelView = React.lazy(loadShipModelView);

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
    const reducedMotionRef = useRef(reducedMotion);
    reducedMotionRef.current = reducedMotion;

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
            view: createFlightView(
                startOrigin,
                flown ? factionAccent(flown.faction) : null,
                reducedMotion
            ),
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
    /** The flown ship whose opponents `nextOpponentsRef` holds. */
    const nextOpponentsForRef = useRef<string | null>(null);
    /** Bumped whenever a run is replaced; a duel simulation that finishes under an older
     *  generation is discarded. */
    const runGenerationRef = useRef(0);
    /** Aborted when the arcade unmounts: work started under it is dropped, and its results never
     *  reach state or the view. Created by the mount effect, so each mount has its own. */
    const sessionRef = useRef<AbortController | null>(null);
    /** The select screen's focused ship, while its sprites wait to start or render ahead. */
    const focusRef = useRef<{ key: string; controller: AbortController; timers: number[] } | null>(
        null
    );
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

    // The session lives from mount to unmount; see `sessionRef`.
    useEffect(() => {
        const session = new AbortController();
        sessionRef.current = session;
        return () => {
            session.abort();
            focusRef.current?.timers.forEach((t) => window.clearTimeout(t));
            focusRef.current = null;
            endArcadeSession();
        };
    }, []);

    const sessionSignal = () => sessionRef.current?.signal ?? ABORTED_SIGNAL;

    /** A ship's official render key, or null while models are off or it has none. */
    const keyOf = useCallback(
        (ship: Ship) => (shipModelsEnabled() ? visualOfRef.current(ship).visualKey : null),
        []
    );

    /** Pins the models and renders of the flown ship and of every opponent still ahead. */
    const refreshPins = useCallback(() => {
        const ahead = gameRef.current.checkpoints
            .filter((c) => !c.resolved)
            .flatMap((c) => opponentsRef.current.get(c.id) ?? []);
        const opponents = [...ahead, ...(nextOpponentsRef.current ?? [])];
        const flown = flownRef.current;
        setArcadePins(flown && keyOf(flown), opponents.map(keyOf));
    }, [keyOf]);

    /** Starts rendering a ship's frame grid and its duel render, under `signal`. */
    const warmPlayerSprites = useCallback((key: string, signal: AbortSignal) => {
        void requestPlayerFrames(key, signal).catch(() => {});
        void requestViewerSprite(key, 'right', signal).catch(() => {});
    }, []);

    /** Gives the flown ship's frame grid to the run once its level sweep is ready: the level
     *  sweep first, then the banked, pitched and pitched-banked sweeps fill in during idle
     *  time. The run keeps the neon fighter until the level sweep is ready, and for good if it
     *  fails. */
    const requestFlownFrames = useCallback(
        (ship: Ship) => {
            const key = keyOf(ship);
            if (!key) return;
            const session = sessionSignal();
            warmPlayerSprites(key, session);
            requestPlayerFrames(key, session)
                .then((frames) => {
                    const flown = flownRef.current;
                    if (session.aborted || !flown || keyOf(flown) !== key) return;
                    viewRef.current.playerFrames = frames;
                })
                .catch(() => {});
        },
        [keyOf, warmPlayerSprites]
    );

    /** Starts loading a ship's gate art under `signal`: its portrait and, with models on, its
     *  sprite and duel render. */
    const warmGateArt = useCallback(
        (ship: Ship, signal: AbortSignal = sessionSignal()) => {
            const { portraitUrl } = visualOfRef.current(ship);
            if (portraitUrl) void loadPortrait(portraitUrl).catch(() => {});
            const key = keyOf(ship);
            if (!key) return;
            void requestGateSprite(key, signal).catch(() => {});
            void requestViewerSprite(key, 'left', signal).catch(() => {});
        },
        [keyOf]
    );

    /** Picks the next checkpoint's opponents for `flown` now and starts rendering their art
     *  under `signal`. */
    const prepareNextOpponents = useCallback(
        (flown: Ship | null = flownRef.current, signal: AbortSignal = sessionSignal()) => {
            const pick =
                flown && canDuel(shipsRef.current, flown.id)
                    ? pickOpponents(shipsRef.current, flown.id, Math.random)
                    : null;
            nextOpponentsRef.current = pick;
            nextOpponentsForRef.current = flown?.id ?? null;
            pick?.forEach((ship) => warmGateArt(ship, signal));
            refreshPins();
        },
        [warmGateArt, refreshPins]
    );

    /** On the select screen, a ship that stays focused has its own sprites rendered ahead and,
     *  after a longer dwell, its first opponents picked and their art loaded, so a run launched
     *  with it starts with them ready. Moving focus on drops that ship's queued work. */
    const onFocusShip = useCallback(
        (ship: Ship) => {
            const key = keyOf(ship);
            const previous = focusRef.current;
            if (previous && previous.key === key) return;
            if (previous) {
                previous.timers.forEach((t) => window.clearTimeout(t));
                previous.controller.abort();
            }
            focusRef.current = null;
            if (!key) return;
            const controller = new AbortController();
            const signal = anySignal(sessionSignal(), controller.signal);
            const timers = [
                window.setTimeout(() => {
                    if (!signal.aborted) warmPlayerSprites(key, signal);
                }, FOCUS_PREWARM_MS),
                window.setTimeout(() => {
                    if (!signal.aborted) prepareNextOpponents(ship, signal);
                }, FOCUS_OPPONENTS_MS),
            ];
            focusRef.current = { key, controller, timers };
        },
        [keyOf, warmPlayerSprites, prepareNextOpponents]
    );

    // Visual keys need the ship templates, which may arrive after mount. A run that starts
    // without the select screen also picks its first opponents here, after the flown ship's
    // own sprites are queued.
    useEffect(() => {
        const flown = flownRef.current;
        if (flown) requestFlownFrames(flown);
        if (flown && nextOpponentsForRef.current !== flown.id) prepareNextOpponents(flown);
        else nextOpponentsRef.current?.forEach((ship) => warmGateArt(ship));
        refreshPins();
    }, [visualOf, requestFlownFrames, prepareNextOpponents, warmGateArt, refreshPins]);

    // Speed lines follow a reduced-motion change mid-run.
    useEffect(() => {
        const view = viewRef.current;
        if (reducedMotion) view.speedLines = null;
        else view.speedLines ??= createSpeedLines(view.laneWedge);
    }, [reducedMotion]);

    // Heavy idle work (model parses) waits while the ship is flying.
    useEffect(() => {
        runWhenIdle.hold(phase === 'intro' || phase === 'running');
    }, [phase]);

    /** Starts a fresh run with the flown ship and duel setting already in the refs. Opponents
     *  already picked for this ship are kept. */
    const restart = useCallback(() => {
        const flown = flownRef.current;
        runGenerationRef.current++;
        opponentsRef.current.clear();
        if (!flown || nextOpponentsForRef.current !== flown.id) prepareNextOpponents();
        setDuel(null);
        gameRef.current = createGame(newSeed(), { duels: duelsRef.current });
        viewRef.current = createFlightView(
            undefined,
            flown ? factionAccent(flown.faction) : null,
            reducedMotionRef.current
        );
        const key = flown && keyOf(flown);
        viewRef.current.playerFrames = key ? cachedPlayerFrames(key) : null;
        refreshPins();
        inputsRef.current = [];
        setResult(null);
        setHud({ score: 0, credits: 0, shield: false, magnet: 0 });
        setPhase('running');
    }, [setPhase, prepareNextOpponents, keyOf, refreshPins]);

    const launch = useCallback(
        (ship: Ship) => {
            writeLastShipId(ship.id);
            const focus = focusRef.current;
            if (focus) {
                focus.timers.forEach((t) => window.clearTimeout(t));
                // A focused ship's sprites keep rendering if it is the one launched.
                if (focus.key !== keyOf(ship)) focus.controller.abort();
                focusRef.current = null;
            }
            flownRef.current = ship;
            duelsRef.current = canDuel(ships, ship.id);
            refreshPins();
            requestFlownFrames(ship);
            restart();
        },
        [ships, restart, requestFlownFrames, keyOf, refreshPins]
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
            const key = keyOf(ship);
            const render = key ? cachedViewerSprite(key, facing) : null;
            if (render) {
                const side = { name: ship.name, level: ship.level, imageUrl: render };
                return { side: { ...side, facesOpponent: true }, pending: null };
            }
            return {
                side: { name: ship.name, level: ship.level, imageUrl: visual.portraitUrl },
                pending: key ? requestViewerSprite(key, facing, sessionSignal()) : null,
            };
        },
        [keyOf]
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
        const session = sessionSignal();
        const generation = runGenerationRef.current;
        const current = () => !session.aborted && generation === runGenerationRef.current;
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
                        d && d.id === id && current()
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
                if (!current()) return;
                r = runDuel(flown, opponent, statsDepsRef.current, newSeed());
            } catch {
                r = { outcome: 'skipped', timeline: [] };
            }
            if (!current()) return;
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
        const session = sessionSignal();
        /** Checkpoints whose gates have been passed and handled. */
        const passed = new WeakSet<object>();

        /** The pre-picked pair, re-resolved against the current fleet; null if a ship has left
         *  the fleet or is now the flown one. */
        const takePrepared = (flownId: string): [Ship, Ship] | null => {
            const prepared = nextOpponentsRef.current;
            nextOpponentsRef.current = null;
            nextOpponentsForRef.current = null;
            if (!prepared) return null;
            const current = prepared.map((p) =>
                shipsRef.current.find((s) => s.id === p.id && s.id !== flownId)
            );
            return current[0] && current[1] ? [current[0], current[1]] : null;
        };

        /** A gate's art: the portrait, and the sprite as soon as it has rendered. */
        const toGateArt = (ship: Ship): GateArt => {
            const { portraitUrl } = visualOfRef.current(ship);
            if (portraitUrl) void loadPortrait(portraitUrl).catch(() => {});
            const key = keyOf(ship);
            const art: GateArt = {
                name: ship.name,
                level: ship.level,
                portraitUrl,
                sprite: key ? cachedGateSprite(key) : null,
            };
            if (key && !art.sprite) {
                requestGateSprite(key, session)
                    .then((sprite) => {
                        if (!session.aborted) art.sprite = sprite;
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
                    refreshPins();
                }

                if (game.status === 'over') finishRun();
                else if (game.status === 'duel') startDuel();
                // Passing a checkpoint through the free lane starts no duel, so the next pair
                // is picked in the next idle time, as far as possible from the next lane choice.
                for (const c of game.checkpoints) {
                    if (!c.resolved || passed.has(c) || !view.gateArt.has(c.id)) continue;
                    passed.add(c);
                    refreshPins();
                    if (game.status === 'running' && !nextOpponentsRef.current) {
                        const run = runGenerationRef.current;
                        void whenIdle().then(() => {
                            if (session.aborted) return;
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
        };
    }, [setPhase, finishRun, startDuel, prepareNextOpponents, keyOf, refreshPins]);

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
                    onFocusShip={onFocusShip}
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
