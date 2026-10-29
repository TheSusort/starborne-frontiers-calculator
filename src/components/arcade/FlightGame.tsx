import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX, SkipForward } from 'lucide-react';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import FallbackErrorBoundary from '../error/FallbackErrorBoundary';
import { holdChunkReload } from '../error/staleChunkRecovery';
import { useBodyScrollLock } from '../ui/layout/useBodyScrollLock';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { createGame, step } from '../../utils/arcade/engine';
import { STEP_SECONDS } from '../../utils/arcade/constants';
import { computeScore, runResult } from '../../utils/arcade/scoring';
import { resolveDuel } from '../../utils/arcade/checkpoints';
import type {
    ChallengeKind,
    DuelEffect,
    DuelStakes,
    GameState,
    InputAction,
} from '../../utils/arcade/types';
import { useAuth } from '../../contexts/AuthProvider';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import type { Ship } from '../../types/ship';
import { SHIP_TYPES } from '../../constants/shipTypes';
import { getSynthwaveMusic, type MusicClock } from '../../utils/music/synthwaveMusic';
import { beatPulse, TRACK_BEATS } from '../../utils/music/beats';
import { useSynthwaveMusic } from '../../utils/music/useSynthwaveMusic';
import { usePauseMusicOnUnmountOffTheme } from '../../utils/music/usePauseMusicOffTheme';
import { useTheme } from '../../contexts/ThemeContext';
import { challengeSeed } from '../../utils/arcade/rng';
import { NO_NEAR_MISS, nextNearMissBadge, type NearMissBadge } from './nearMissBadge';
import {
    advanceView,
    createFlightView,
    explodeShip,
    FlightView,
    GateArt,
    INTRO_SECONDS,
    renderFlight,
} from './flightRenderer';
import { runWhenIdle, whenIdle } from './idle';
import { isSelectDropdownOpen, isTextTarget, keyToAction, swipeToAction } from './flightInput';
import { readLocalBest, writeLocalBest } from './localBest';
import { resumeArcadeMusic, writeMusicPref } from './musicPref';
import { GameOverPanel } from './GameOverPanel';
import { YouDiedOverlay } from './YouDiedOverlay';
import { canSkipDeath, deathStage } from './deathSequence';
import { createDeathCue, primeDeathAudio } from './deathSound';
import { slowMotion } from './explosion';
import { useArcadeSubmission, SubmissionStatus, type FinishedRun } from './useArcadeSubmission';
import { ArcadeUsernameModal } from './ArcadeUsernameModal';
import { GuestNameModal } from './GuestNameModal';
import { GameOverLeaderboard } from './GameOverLeaderboard';
import type { FlightOrigin } from './flightEvents';
import {
    anyCandidate,
    bundleGateShips,
    canDuel,
    canTeam,
    gearedCandidate,
    pickBundle,
    rowPicks,
    shipsOfPicks,
    TEAM_PICK_SHIPS,
    type DuelCandidateTest,
    type RowPicks,
} from './duel/pickOpponents';
import { createSpeedLines } from './speedLines';
import { previewBannerContent } from './previewHud';
import { PreviewBanner, type PreviewBannerContent } from './PreviewBanner';
import { zoneBanner, zoneIndexAt, zoneOf } from './zones';
import { createShipTrail } from './shipTrails';
import { createScrapeFx } from './scrapeFx';
import { skippedChallenge, type ChallengeResult } from './duel/challengeResult';
import { DuelSummary, type DuelSide } from './duel/DuelSummary';
import { factionAccent } from './ships/factionTint';
import { useArcadeFleet } from './ships/useArcadeFleet';
import { loadPortrait } from './ships/portraitSprite';
import { useShipVisuals } from './ships/useShipVisuals';
import { readLastShipId, writeLastShipId } from './ships/fleetOrder';
import { FighterSelect, PortraitView } from './FighterSelect';
import { loadShipModelView, shipModelsEnabled } from './ships/arcadeFlags';
import type { ShipVisual } from './ships/shipVisuals';
import {
    anySignal,
    cachedPlayerFrames,
    cachedViewerSprite,
    endArcadeSession,
    Facing,
    requestPlayerFrames,
    requestViewerSprite,
    setArcadePins,
} from './ships/arcadeSprites';

/** `'dying'`: the run has ended and its explosion and "YOU DIED" screen play before `'over'`. */
type Phase = 'select' | 'intro' | 'running' | 'paused' | 'countdown' | 'duel' | 'dying' | 'over';

const COUNTDOWN_SECONDS = 3;
/** A long frame (tab switch, GC pause) is clamped so the game never jumps ahead. */
const MAX_FRAME_SECONDS = 0.1;
const HUD_INTERVAL_SECONDS = 0.1;
/** The game canvas's device-pixel-ratio cap. The renderer and its caches read the effective
 *  ratio back from the canvas size, so they follow it; the DOM overlays stay at full resolution. */
const ARCADE_MAX_DPR = 1;
const NO_INPUT: readonly InputAction[] = [];

const newSeed = () => Math.floor(Math.random() * 2 ** 32) >>> 0;

/** The credit streak's HUD chip: shown while on, fading out once lost; `pulse` counts the
 *  changes, so each one replays the chip's animation. */
interface StreakChip {
    state: 'off' | 'on' | 'lost';
    pulse: number;
}

interface Hud {
    score: number;
    credits: number;
    shield: boolean;
    magnet: number;
    streak: StreakChip;
    nearMiss: NearMissBadge;
}

const NO_STREAK: StreakChip = { state: 'off', pulse: 0 };
const EMPTY_HUD: Hud = {
    score: 0,
    credits: 0,
    shield: false,
    magnet: 0,
    streak: NO_STREAK,
    nearMiss: NO_NEAR_MISS,
};

const hudOf = (game: GameState, streak: StreakChip, nearMiss: NearMissBadge): Hud => ({
    score: computeScore(game),
    credits: game.credits,
    shield: game.player.shield,
    magnet: game.player.magnetTime,
    streak,
    nearMiss,
});

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
    challenge: ChallengeKind;
    /** The row's ships; the opponent is `picks.gates[slot]`. */
    picks: RowPicks;
    slot: 0 | 1;
    /** The flown ship, then its allies on a `team` row. */
    players: DuelSide[];
    /** `picks.gates[slot]`: one ship, or a trio. */
    opponents: DuelSide[];
    stakes: DuelStakes;
    result: ChallengeResult | null;
    effect: DuelEffect | null;
}

/** The game options for a run flown with `flownId`: duel rows when the fleet can field two
 *  opponents, and `team` rows when it can field a whole team row. */
const runOptions = (
    fleet: readonly Ship[],
    flownId: string | null,
    isCandidate: DuelCandidateTest
) => {
    const duels = canDuel(fleet, flownId, isCandidate);
    return { duels, teamChallenges: duels && canTeam(fleet, flownId, isCandidate) };
};

/** A pre-picked bundle (see `pickBundle`) big enough for whatever challenge a row draws. */
const pickRowBundle = (
    fleet: readonly Ship[],
    flownId: string,
    isCandidate: DuelCandidateTest
): Ship[] | null =>
    pickBundle(
        fleet,
        flownId,
        Math.random,
        isCandidate,
        canTeam(fleet, flownId, isCandidate) ? TEAM_PICK_SHIPS : 2
    );

/** "x2" beside the credit count while the credit streak doubles credits. It pulses when the
 *  streak turns on and fades out red when it breaks. */
const StreakBadge: React.FC<{ chip: StreakChip }> = ({ chip }) => {
    if (chip.state === 'off') return null;
    const on = chip.state === 'on';
    return (
        <Chip
            key={chip.pulse}
            variant={on ? 'accent' : 'debuff'}
            className={on ? 'arcade-streak-on' : 'arcade-streak-lost'}
        >
            x2
        </Chip>
    );
};

/** "NEAR MISS +75" beside the score, with the chain's length once it passes one. It pops on
 *  each near miss and fades out when the chain ends. */
const NearMissCallout: React.FC<{ badge: NearMissBadge }> = ({ badge }) => {
    if (badge.state === 'off') return null;
    const on = badge.state === 'on';
    return (
        <div
            key={badge.pulse}
            className={`flex items-baseline gap-2 font-bold text-yellow-300 arcade-near-miss ${
                on ? 'arcade-near-miss-pop' : 'arcade-near-miss-lost'
            }`}
        >
            <span className="text-lg sm:text-2xl">NEAR MISS +{badge.points}</span>
            {badge.chain > 1 && (
                <span className="text-base sm:text-xl text-pink-300">x{badge.chain}</span>
            )}
        </div>
    );
};

/** "ZONE 2 · NEON NIGHT" under the score as a zone starts, in the zone's grid colour; it fades
 *  in and out once (the fade stays under reduced motion). Keyed by the zone, so each one replays
 *  it. */
const ZoneBanner: React.FC<{ zone: number | null }> = ({ zone }) => {
    if (zone === null) return null;
    return (
        <div
            key={zone}
            className="mt-1 text-sm sm:text-lg font-bold tracking-widest arcade-zone-banner"
            style={{ color: `rgb(${zoneOf(zone).palette.scene.grid})` }}
        >
            {zoneBanner(zone)}
        </div>
    );
};

/** The playback position the frame loop reads the beat from, rewritten every frame. */
const musicClock: MusicClock = { track: '/audio/disco.mp3', time: 0, playing: false };

const SubmissionLine: React.FC<{
    status: SubmissionStatus;
    rank: number | null;
    onRetry: () => void;
    onJoinGuest: () => void;
}> = ({ status, rank, onRetry, onJoinGuest }) => {
    switch (status) {
        case 'guest-invite':
            return (
                <div className="space-y-2">
                    <Button size="sm" onClick={onJoinGuest}>
                        Join the leaderboard as a guest
                    </Button>
                    <p className="text-xs text-theme-text-secondary">
                        or sign in to use your account name.
                    </p>
                </div>
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

/** Holds the arcade closed until its fleet is resolved: the opening phase is chosen once, from
 *  the fleet present at mount. Once resolved it stays open, so a later reload never ends a run. */
const FlightGame: React.FC<FlightGameProps> = (props) => {
    const { loading } = useArcadeFleet();
    const resolvedRef = useRef(false);
    if (!loading) resolvedRef.current = true;
    if (!resolvedRef.current) {
        return (
            <div
                className="fixed inset-0 z-50 bg-black"
                role="dialog"
                aria-modal="true"
                aria-label="Synthwave arcade"
                aria-busy="true"
            />
        );
    }
    return <FlightGameRun {...props} />;
};

const FlightGameRun: React.FC<FlightGameProps> = ({ origin, onClose }) => {
    const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const startOrigin = reducedMotion ? undefined : origin;
    const reducedMotionRef = useRef(reducedMotion);
    reducedMotionRef.current = reducedMotion;

    const { user } = useAuth();
    const { fleet: ships, bare } = useArcadeFleet();
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    // Bare templates fly without engineering.
    const noEngineering = useCallback(() => undefined, []);
    const isCandidate = useMemo(
        () => (bare ? anyCandidate : gearedCandidate(getGearPiece)),
        [bare, getGearPiece]
    );
    const visualOf = useShipVisuals();
    // The game loop reads these through refs so a fleet, gear or template update never restarts it.
    const shipsRef = useRef(ships);
    shipsRef.current = ships;
    const visualOfRef = useRef(visualOf);
    visualOfRef.current = visualOf;
    const statsDepsRef = useRef({
        getGearPiece,
        getEngineeringStatsForShipType: bare ? noEngineering : getEngineeringStatsForShipType,
        isCandidate,
    });
    statsDepsRef.current = {
        getGearPiece,
        getEngineeringStatsForShipType: bare ? noEngineering : getEngineeringStatsForShipType,
        isCandidate,
    };
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // The background easter egg skips the select screen and flies the last chosen ship, if
    // it is still owned; otherwise a fleet opens on the select screen.
    const [initial] = useState(() => {
        const lastShipId = readLastShipId();
        const flown = startOrigin ? (ships.find((s) => s.id === lastShipId) ?? null) : null;
        const options = runOptions(ships, flown?.id ?? null, isCandidate);
        const phase: Phase = startOrigin ? 'intro' : ships.length > 0 ? 'select' : 'running';
        return {
            lastShipId,
            flown,
            options,
            phase,
            game: createGame(newSeed(), options),
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
    /** The current run's game options; see `runOptions`. */
    const optionsRef = useRef(initial.options);
    const rootRef = useRef<HTMLDivElement>(null);
    const inputsRef = useRef<InputAction[]>([]);
    const phaseRef = useRef<Phase>(initial.phase);
    const escapeBlockedRef = useRef(false);
    const music = useSynthwaveMusic();
    const musicRef = useRef(music);
    musicRef.current = music;
    usePauseMusicOnUnmountOffTheme(useTheme().theme === 'synthwave');
    // The click that opens the game from the background is the gesture that lets audio start.
    const openedFromOrigin = startOrigin !== undefined;
    useEffect(() => {
        if (openedFromOrigin) resumeArcadeMusic(musicRef.current);
    }, [openedFromOrigin]);
    const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
    /** The ships behind each checkpoint's gates. */
    const opponentsRef = useRef(new Map<number, RowPicks>());
    /** The bundle for the next checkpoint to appear (see `pickBundle`), picked while the game is
     *  not being flown so its gate sprites render before the gates are on screen; null → picked
     *  when it appears. */
    const nextOpponentsRef = useRef<Ship[] | null>(null);
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
    const [hud, setHud] = useState<Hud>(EMPTY_HUD);
    const streakRef = useRef<StreakChip>(NO_STREAK);
    const nearMissRef = useRef<NearMissBadge>(NO_NEAR_MISS);
    /** The zone the run is in, and the one whose banner shows (none in zone 1). */
    const zoneRef = useRef(0);
    const [bannerZone, setBannerZone] = useState<number | null>(null);
    /** The checkpoint whose slow-motion preview runs, and the banner it shows (kept after the
     *  preview ends so the banner can fade out). */
    const previewIdRef = useRef<number | null>(null);
    const [previewBanner, setPreviewBanner] = useState<PreviewBannerContent | null>(null);
    const [previewShown, setPreviewShown] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const [finished, setFinished] = useState<FinishedRun | null>(null);
    const result = finished?.result ?? null;
    const [localBest, setLocalBest] = useState(readLocalBest);
    const [previousBest, setPreviousBest] = useState(0);
    const [duel, setDuel] = useState<DuelState | null>(null);
    /** Whether the dying run shows the "YOU DIED" screen yet (see `deathStage`). */
    const [youDied, setYouDied] = useState(false);
    const youDiedRef = useRef(false);
    const submission = useArcadeSubmission(finished);

    // While a name modal is open, Escape belongs to the modal.
    useEffect(() => {
        escapeBlockedRef.current =
            phase === 'over' &&
            (submission.status === 'needs-username' || submission.status === 'needs-guest-name');
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

    // A reload for a stale model chunk (see `reportChunkLoadError`) waits while a run, its result
    // screen or its leaderboard submit is up: it goes ahead on the select screen or on closing.
    useEffect(() => {
        holdChunkReload(phase !== 'select');
    }, [phase]);
    useEffect(() => () => holdChunkReload(false), []);

    const sessionSignal = () => sessionRef.current?.signal ?? ABORTED_SIGNAL;

    /** A ship's official render key, or null while models are off or it has none. */
    const keyOf = useCallback(
        (ship: Ship) => (shipModelsEnabled() ? visualOfRef.current(ship).visualKey : null),
        []
    );

    /** Pins the models of the flown ship and of every ship the duel screen may show for the rows
     *  still ahead and the pre-picked next row. */
    const refreshPins = useCallback(() => {
        const ahead = gameRef.current.checkpoints
            .filter((c) => !c.resolved)
            .flatMap((c) => {
                const picks = opponentsRef.current.get(c.id);
                return picks ? shipsOfPicks(picks) : [];
            });
        const next = nextOpponentsRef.current;
        const opponents = [...ahead, ...(next ?? [])];
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

    /** Starts loading a ship's portrait for its gate and, with models on and `render` set, its
     *  duel render, under `signal`. */
    const warmGateArt = useCallback(
        (ship: Ship, render: boolean, signal: AbortSignal = sessionSignal()) => {
            const { portraitUrl } = visualOfRef.current(ship);
            if (portraitUrl) void loadPortrait(portraitUrl).catch(() => {});
            const key = keyOf(ship);
            if (!key || !render) return;
            void requestViewerSprite(key, 'left', signal).catch(() => {});
        },
        [keyOf]
    );

    /** Warms every portrait of a pre-picked bundle, and the duel renders of the ships its gates
     *  may lead with. */
    const warmBundle = useCallback(
        (bundle: readonly Ship[], signal: AbortSignal = sessionSignal()) => {
            const leads = new Set(bundleGateShips(bundle));
            for (const ship of bundle) warmGateArt(ship, leads.has(ship), signal);
        },
        [warmGateArt]
    );

    /** Picks the next checkpoint's opponents for `flown` now and starts rendering their art
     *  under `signal`. */
    const prepareNextOpponents = useCallback(
        (flown: Ship | null = flownRef.current, signal: AbortSignal = sessionSignal()) => {
            const pick = flown
                ? pickRowBundle(shipsRef.current, flown.id, statsDepsRef.current.isCandidate)
                : null;
            nextOpponentsRef.current = pick;
            nextOpponentsForRef.current = flown?.id ?? null;
            if (pick) warmBundle(pick, signal);
            refreshPins();
        },
        [warmBundle, refreshPins]
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
        else if (nextOpponentsRef.current) warmBundle(nextOpponentsRef.current);
        refreshPins();
    }, [visualOf, requestFlownFrames, prepareNextOpponents, warmBundle, refreshPins]);

    // A run started from the background can begin before the fleet's gear has loaded. The intro
    // never steps the game, so until it ends a fresh game replaces one decided without duels or
    // without team rows once the fleet and gear allow them.
    useEffect(() => {
        const flown = flownRef.current;
        if (phaseRef.current !== 'intro' || !flown) return;
        const options = runOptions(ships, flown.id, isCandidate);
        const current = optionsRef.current;
        const gains =
            (options.duels && !current.duels) ||
            (options.teamChallenges && !current.teamChallenges);
        if (!gains) return;
        optionsRef.current = options;
        gameRef.current = createGame(newSeed(), options);
    }, [ships, isCandidate]);

    // Speed lines, the ship's trail and scrape and the magnet's motion follow a reduced-motion
    // change.
    useEffect(() => {
        const view = viewRef.current;
        view.reducedMotion = reducedMotion;
        if (reducedMotion) {
            view.speedLines = null;
            view.trail = null;
            view.scrape = null;
        } else {
            view.speedLines ??= createSpeedLines(view.laneWedge);
            view.trail ??= createShipTrail();
            view.scrape ??= createScrapeFx();
        }
    }, [reducedMotion]);

    // Heavy idle work (model parses) waits while the ship is flying or exploding.
    useEffect(() => {
        runWhenIdle.hold(phase === 'intro' || phase === 'running' || phase === 'dying');
    }, [phase]);

    /** Starts a fresh run with the flown ship already in its ref; whether it gets duels is
     *  decided again from the current fleet. Opponents already picked for this ship are kept. */
    const restart = useCallback(() => {
        const flown = flownRef.current;
        runGenerationRef.current++;
        opponentsRef.current.clear();
        if (!flown || nextOpponentsForRef.current !== flown.id) prepareNextOpponents();
        setDuel(null);
        // Re-checked against the current fleet and inventory, which may have loaded since.
        optionsRef.current = runOptions(
            shipsRef.current,
            flown?.id ?? null,
            statsDepsRef.current.isCandidate
        );
        gameRef.current = createGame(newSeed(), optionsRef.current);
        viewRef.current = createFlightView(
            undefined,
            flown ? factionAccent(flown.faction) : null,
            reducedMotionRef.current
        );
        const key = flown && keyOf(flown);
        viewRef.current.playerFrames = key ? cachedPlayerFrames(key) : null;
        refreshPins();
        inputsRef.current = [];
        setFinished(null);
        previewIdRef.current = null;
        setPreviewShown(false);
        youDiedRef.current = false;
        setYouDied(false);
        streakRef.current = NO_STREAK;
        nearMissRef.current = NO_NEAR_MISS;
        setHud(EMPTY_HUD);
        setPhase('running');
    }, [setPhase, prepareNextOpponents, keyOf, refreshPins]);

    /** Play/pause from the HUD or `M`; the arcade remembers the choice for the next launch. */
    const toggleMusic = useCallback(() => {
        musicRef.current.toggle();
        writeMusicPref(getSynthwaveMusic().getSnapshot().isPlaying);
    }, []);

    const launch = useCallback(
        (ship: Ship) => {
            resumeArcadeMusic(musicRef.current);
            writeLastShipId(ship.id);
            const focus = focusRef.current;
            if (focus) {
                focus.timers.forEach((t) => window.clearTimeout(t));
                // A focused ship's sprites keep rendering if it is the one launched.
                if (focus.key !== keyOf(ship)) focus.controller.abort();
                focusRef.current = null;
            }
            flownRef.current = ship;
            refreshPins();
            requestFlownFrames(ship);
            restart();
        },
        [restart, requestFlownFrames, keyOf, refreshPins]
    );

    const deathCue = useMemo(() => createDeathCue(), []);

    // The crash sound plays from the frame loop; every gesture in the arcade unlocks its audio
    // first (see `primeDeathAudio`).
    useEffect(() => {
        const events = ['keydown', 'pointerdown', 'touchstart'] as const;
        for (const e of events) window.addEventListener(e, primeDeathAudio, { passive: true });
        return () => {
            for (const e of events) window.removeEventListener(e, primeDeathAudio);
        };
    }, []);

    /** Ends the run: the result is recorded and submitted now, while the ship explodes with its
     *  crash sound and the death screen plays before the game-over panel shows it. */
    const finishRun = useCallback(() => {
        deathCue.crash(gameRef.current);
        const r = runResult(gameRef.current);
        setFinished({ result: r, shipName: flownRef.current?.name ?? null });
        setPreviousBest(readLocalBest());
        setLocalBest(writeLocalBest(r));
        explodeShip(viewRef.current, reducedMotionRef.current);
        youDiedRef.current = false;
        setYouDied(false);
        setPhase('dying');
    }, [setPhase, deathCue]);

    /** Skips the rest of the death sequence to the game-over panel. */
    const skipDeath = useCallback(() => {
        if (phaseRef.current !== 'dying') return;
        if (canSkipDeath(viewRef.current.explosion.elapsed)) setPhase('over');
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
        const picks = pending ? opponentsRef.current.get(pending.checkpointId) : undefined;
        if (!pending || !flown || !picks) {
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
        const { challenge, slot } = pending;
        const seed = challengeSeed(game.seed, pending.checkpointId);
        const players = [flown, ...(picks.kind === 'team' ? picks.allies : [])].map((ship) =>
            toSide(ship, 'right')
        );
        const rivals = (picks.kind === 'team' ? picks.gates[slot] : [picks.gates[slot]]).map(
            (ship) => toSide(ship, 'left')
        );
        setDuel({
            id,
            challenge,
            picks,
            slot,
            players: players.map((p) => p.side),
            opponents: rivals.map((r) => r.side),
            stakes: pending.stakes,
            result: null,
            effect: null,
        });
        // A side showing the portrait switches to its render if it arrives while this duel is
        // still open; the duel never waits for it.
        const swapIn = (
            which: 'players' | 'opponents',
            at: number,
            render: Promise<string> | null
        ) =>
            render
                ?.then((imageUrl) =>
                    setDuel((d) =>
                        d && d.id === id && current()
                            ? {
                                  ...d,
                                  [which]: d[which].map((side, i) =>
                                      i === at ? { ...side, imageUrl, facesOpponent: true } : side
                                  ),
                              }
                            : d
                    )
                )
                .catch(() => {});
        players.forEach((p, i) => void swapIn('players', i, p.pending));
        rivals.forEach((r, i) => void swapIn('opponents', i, r.pending));
        prepareNextOpponents();
        // The animation frame commits the "Simulating…" state; the timeout then runs the
        // synchronous simulation after that frame has been painted.
        const simulate = async () => {
            let r: ChallengeResult;
            try {
                const { runChallenge } = await import('./duel/runChallenge');
                if (!current()) return;
                r = runChallenge(challenge, flown, picks, slot, statsDepsRef.current, seed);
            } catch {
                r = skippedChallenge(challenge);
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
        setHud(hudOf(game, streakRef.current, nearMissRef.current));
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

        /** The ratio the transform uses; the renderer draws its caches at it too. */
        let dpr = 1;
        const resize = () => {
            dpr = Math.min(window.devicePixelRatio || 1, ARCADE_MAX_DPR);
            canvas.width = Math.round(canvas.offsetWidth * dpr);
            canvas.height = Math.round(canvas.offsetHeight * dpr);
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

        /** The pre-picked bundle, re-resolved against the current fleet; null if a ship has left
         *  the fleet, is now the flown one or is no longer a duel candidate. */
        const takePrepared = (flownId: string): Ship[] | null => {
            const prepared = nextOpponentsRef.current;
            nextOpponentsRef.current = null;
            nextOpponentsForRef.current = null;
            if (!prepared) return null;
            const current = prepared.map((p) =>
                shipsRef.current.find(
                    (s) => s.id === p.id && s.id !== flownId && statsDepsRef.current.isCandidate(s)
                )
            );
            return current.every((s) => s !== undefined) ? current : null;
        };

        /** A gate's art: the portraits of the ships behind it, loading if not yet cached. */
        const toGateArt = (ships: readonly Ship[]): GateArt => ({
            ships: ships.map((ship) => {
                const { portraitUrl } = visualOfRef.current(ship);
                if (portraitUrl) void loadPortrait(portraitUrl).catch(() => {});
                return {
                    name: ship.name,
                    level: ship.level,
                    role: SHIP_TYPES[ship.type]?.name ?? '',
                    portraitUrl,
                };
            }),
        });

        /** Moves the steps' events into the HUD, once per frame. */
        const drainEvents = (game: GameState) => {
            let streak = streakRef.current;
            for (const e of game.events) {
                if (e.kind === 'near-miss') continue;
                const state = e.kind === 'streak-on' ? 'on' : 'lost';
                streak = { state, pulse: streak.pulse + 1 };
            }
            const nearMiss = nextNearMissBadge(
                nearMissRef.current,
                game.events,
                game.nearMissChain
            );
            game.events.length = 0;
            if (streak !== streakRef.current || nearMiss !== nearMissRef.current) {
                streakRef.current = streak;
                nearMissRef.current = nearMiss;
                setHud(hudOf(game, streak, nearMiss));
            }
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
                drainEvents(game);
                const zone = zoneIndexAt(game.distance);
                if (zone !== zoneRef.current) {
                    zoneRef.current = zone;
                    setBannerZone(zone > 0 ? zone : null);
                }

                const flown = flownRef.current;
                for (const c of game.checkpoints) {
                    if (view.gateArt.has(c.id) || c.resolved || !flown) continue;
                    const prepared = takePrepared(flown.id);
                    const fresh = () => {
                        const bundle = pickRowBundle(
                            shipsRef.current,
                            flown.id,
                            statsDepsRef.current.isCandidate
                        );
                        return bundle && rowPicks(c.challenge, bundle);
                    };
                    const picks = (prepared && rowPicks(c.challenge, prepared)) ?? fresh();
                    if (!picks) {
                        // No opponents to show: the engine ignores a resolved checkpoint.
                        c.resolved = true;
                        continue;
                    }
                    opponentsRef.current.set(c.id, picks);
                    const [left, right] =
                        picks.kind === 'team' ? picks.gates : picks.gates.map((ship) => [ship]);
                    view.gateArt.set(c.id, [toGateArt(left), toGateArt(right)]);
                    refreshPins();
                }

                const previewId =
                    game.status === 'running' ? (game.preview?.checkpointId ?? null) : null;
                if (previewId !== previewIdRef.current) {
                    previewIdRef.current = previewId;
                    const row = game.checkpoints.find((c) => c.id === previewId);
                    if (row) {
                        setPreviewBanner(
                            previewBannerContent(
                                row,
                                opponentsRef.current.get(row.id),
                                (ship) => visualOfRef.current(ship).portraitUrl
                            )
                        );
                    }
                    setPreviewShown(!!row);
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
                    setHud(hudOf(game, streakRef.current, nearMissRef.current));
                }
            } else if (phaseRef.current === 'dying') {
                acc = 0;
                // The world slows to a stop around the explosion. Only what is drawn moves: the
                // run's result was taken at the crash.
                const reduced = view.explosion.reducedMotion;
                const elapsed = view.explosion.elapsed;
                const travel = game.speed * dt * slowMotion(elapsed, reduced);
                if (travel > 0) {
                    for (const o of game.obstacles) o.z -= travel;
                    for (const p of game.pickups) p.z -= travel;
                    for (const c of game.checkpoints) c.z -= travel;
                    advanceView(view, travel);
                }
                const stage = deathStage(elapsed, reduced);
                if (stage !== 'explosion' && !youDiedRef.current) {
                    youDiedRef.current = true;
                    setYouDied(true);
                }
                if (stage === 'panel') setPhase('over');
            } else {
                acc = 0;
            }

            view.dpr = dpr;
            const clock = getSynthwaveMusic().clock(musicClock);
            view.beat = beatPulse(clock.time, TRACK_BEATS[clock.track], clock.playing);
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
            const chord = e.ctrlKey || e.metaKey;
            if ((e.key === 'm' || e.key === 'M') && !chord && !isTextTarget(e.target)) {
                if (!e.repeat) toggleMusic();
                return;
            }
            if (p === 'dying') {
                if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    if (!e.repeat) skipDeath();
                }
                return;
            }
            if (p === 'over' || p === 'select') return;
            if ((e.key === 'p' || e.key === 'P') && !chord) {
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
    }, [onClose, resume, togglePause, skipDeath, toggleMusic]);

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
        if (phaseRef.current === 'dying') {
            skipDeath();
            return;
        }
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
                        <div className="flex items-baseline gap-3">
                            <div className="text-2xl">{hud.score.toLocaleString()}</div>
                            <NearMissCallout badge={hud.nearMiss} />
                        </div>
                        <div className="flex items-center gap-2 text-sm text-yellow-300">
                            <span>{hud.credits} credits</span>
                            <StreakBadge chip={hud.streak} />
                        </div>
                        <ZoneBanner zone={bannerZone} />
                    </div>
                )}
                <div className="flex gap-2 items-center pointer-events-auto">
                    {hud.shield && <span className="text-cyan-300 text-sm">SHIELD</span>}
                    {hud.magnet > 0 && (
                        <span className="text-pink-300 text-sm">
                            MAGNET {Math.ceil(hud.magnet)}
                        </span>
                    )}
                    <span className="hidden sm:inline text-xs text-white/60">
                        {music.trackTitle}
                    </span>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={toggleMusic}
                        aria-label={music.isPlaying ? 'Pause music' : 'Play music'}
                        title={music.isPlaying ? 'Pause music (M)' : 'Play music (M)'}
                    >
                        {music.isPlaying ? <Volume2 size={14} /> : <VolumeX size={14} />}
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={music.next}
                        aria-label="Next track"
                        title="Next track"
                    >
                        <SkipForward size={14} />
                    </Button>
                    {phase !== 'over' &&
                        phase !== 'select' &&
                        phase !== 'duel' &&
                        phase !== 'dying' && (
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
            {(phase === 'running' || phase === 'paused') && (
                <PreviewBanner content={previewBanner} shown={previewShown} />
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
                    challenge={duel.challenge}
                    players={duel.players}
                    opponents={duel.opponents}
                    stakes={duel.stakes}
                    result={duel.result}
                    effect={duel.effect}
                    reducedMotion={reducedMotion}
                    onDone={onDuelDone}
                />
            )}
            {phase === 'dying' && youDied && <YouDiedOverlay />}
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
                        onJoinGuest={submission.joinAsGuest}
                    />
                    <div className="max-h-64 overflow-y-auto text-left">
                        <GameOverLeaderboard refreshKey={submission.leaderboardVersion} />
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
            {!user && (
                <GuestNameModal
                    isOpen={phase === 'over' && submission.status === 'needs-guest-name'}
                    onSave={submission.saveGuestName}
                    onCancel={submission.skip}
                />
            )}
        </div>
    );
};

export default FlightGame;
