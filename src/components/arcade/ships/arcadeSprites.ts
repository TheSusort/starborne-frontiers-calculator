import { abortError, isAbortError, runWhenIdle } from '../idle';
import { loadShipSprites, ShipSpritesModule } from './arcadeFlags';
import { createPinSet, setArcadeOpen } from './modelPins';
import {
    BANK_ANGLES_DEG,
    FrameSweeps,
    LEVEL_BANK,
    LEVEL_PITCH_ROW,
    PITCH_ANGLES_DEG,
    SweepRef,
} from './spritePoses';
import { evictOldest } from './viewerCache';

/**
 * The arcade's rendered ship sprites, cached for the page's lifetime by visual key so a reopened
 * arcade reuses them. Every request takes the signal of whoever asked: aborting it drops the
 * request's queued idle work, and a request whose signal has aborted counts as never made, so
 * the next one starts afresh. This module has no three.js dependency; it reaches the renderer
 * only through `loadShipSprites`.
 */

export type Facing = 'left' | 'right';
export type PlayerFrames = FrameSweeps<HTMLCanvasElement>;

/** Player frame grids kept at once (about 12 MB each); the flown ship's and those still filling
 *  are never evicted. */
const PLAYER_GRIDS_KEPT = 3;
/** Gate sprites kept at once (128 px squares). */
const GATE_SPRITES_KEPT = 16;
/** Duel renders kept at once: the flown ship's own (never evicted), the pair at the open
 *  checkpoint and the pre-picked next pair, with room to spare. */
const VIEWER_SPRITES_KEPT = 6;

/** A signal that aborts as soon as any of `signals` does. */
export function anySignal(...signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    for (const s of signals) {
        if (s.aborted) {
            controller.abort();
            break;
        }
        s.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return controller.signal;
}

let sprites: ShipSpritesModule | null = null;
const spritesModule = () =>
    loadShipSprites().then((m) => {
        sprites = m;
        return m;
    });

let flownKey: string | null = null;
/** The most recent ship flown, kept after the arcade closes. */
let lastFlownKey: string | null = null;
const flownPins = createPinSet({ urgent: true });
const opponentPins = createPinSet();

/** Keeps the flown ship's sprites and the models of it and its pending opponents cached; the
 *  flown ship's model is parsed even while heavy idle work is held. */
export function setArcadePins(flown: string | null, opponents: Iterable<string | null>): void {
    if (flown) {
        setArcadeOpen(true);
        lastFlownKey = flown;
    }
    flownKey = flown;
    flownPins.set([flown]);
    opponentPins.set(opponents);
}

/** The arcade has closed: releases its pins, stops holding heavy idle work, frees the sprite
 *  renderer's GPU resources and trims the caches to the most recent flown ship's frame grid,
 *  viewer render and model (see `trimSpriteCaches`). Queued model parses for unpinned ships are
 *  dropped. The next pin or sprite request reopens the arcade. */
export function endArcadeSession(): void {
    setArcadeOpen(false);
    setArcadePins(null, []);
    runWhenIdle.hold(false);
    const keep = lastFlownKey;
    for (const k of [...grids.keys()]) if (k !== keep) grids.delete(k);
    viewerSprites.retain((id) => keep !== null && id === viewerId(keep, 'right'));
    sprites?.disposeSpriteStage();
    sprites?.trimSpriteCaches(keep);
}

/** A sprite request from a live session reopens the arcade. */
function reopenFor(signal: AbortSignal): void {
    if (!signal.aborted) setArcadeOpen(true);
}

interface Request<T> {
    promise: Promise<T>;
    value?: T;
    signal: AbortSignal;
}

/**
 * Requests by id, deduplicated while live, bounded to `size` with pinned and in-flight entries
 * kept. A failed request removes only its own entry, never a newer one under the same id.
 */
export function createRequestCache<T>(
    size: number,
    isPinned: (id: string) => boolean,
    start: (id: string, signal: AbortSignal) => Promise<T>
) {
    const entries = new Map<string, Request<T>>();
    const live = (r: Request<T> | undefined): r is Request<T> =>
        !!r && (r.value !== undefined || !r.signal.aborted);
    return {
        get(id: string, signal: AbortSignal): Promise<T> {
            const hit = entries.get(id);
            if (live(hit)) {
                entries.delete(id);
                entries.set(id, hit);
                return hit.promise;
            }
            const entry: Request<T> = { promise: start(id, signal), signal };
            entries.set(id, entry);
            entry.promise.then(
                (value) => {
                    if (entries.get(id) !== entry) return;
                    entry.value = value;
                    evictOldest(
                        entries,
                        size,
                        (k) => isPinned(k) || entries.get(k)?.value === undefined
                    );
                },
                () => {
                    if (entries.get(id) === entry) entries.delete(id);
                }
            );
            return entry.promise;
        },
        /** Drops every entry `keep` does not accept. */
        retain(keep: (id: string) => boolean): void {
            for (const id of [...entries.keys()]) if (!keep(id)) entries.delete(id);
        },
        /** The finished value, for drawing without waiting. */
        cached(id: string): T | null {
            return entries.get(id)?.value ?? null;
        },
    };
}

const gateSprites = createRequestCache<HTMLCanvasElement>(
    GATE_SPRITES_KEPT,
    () => false,
    (key, signal) => spritesModule().then((m) => m.renderGateSprite(key, { signal }))
);

/** A ship's gate sprite: its level chase-camera frame. */
export const requestGateSprite = (key: string, signal: AbortSignal) => {
    reopenFor(signal);
    return gateSprites.get(key, signal);
};
export const cachedGateSprite = (key: string) => gateSprites.cached(key);

const viewerId = (key: string, facing: Facing) => `${key}:${facing}`;
const viewerSprites = createRequestCache<string>(
    VIEWER_SPRITES_KEPT,
    (id) => flownKey !== null && id === viewerId(flownKey, 'right'),
    (id, signal) => {
        const at = id.lastIndexOf(':');
        const facing = id.slice(at + 1) as Facing;
        return spritesModule()
            .then((m) => m.renderViewerSprite(id.slice(0, at), facing, { signal }))
            .then((canvas) => canvas.toDataURL());
    }
);

/** A ship at the official viewer's angle, bow toward `facing`, as a data URL for the duel
 *  summary. */
export const requestViewerSprite = (key: string, facing: Facing, signal: AbortSignal) => {
    reopenFor(signal);
    return viewerSprites.get(viewerId(key, facing), signal);
};
export const cachedViewerSprite = (key: string, facing: Facing) =>
    viewerSprites.cached(viewerId(key, facing));

const LEVEL: SweepRef = { pitch: LEVEL_PITCH_ROW, bank: LEVEL_BANK };
const pitchedRows = PITCH_ANGLES_DEG.map((_, i) => i).filter((p) => p !== LEVEL_PITCH_ROW);
const bankedColumns = BANK_ANGLES_DEG.map((_, i) => i).filter((b) => b !== LEVEL_BANK);

/** The order a frame grid fills in: the level sweep, then the banked, pitched and
 *  pitched-banked sweeps, so the commonest poses are ready first. */
export const SWEEP_ORDER: readonly SweepRef[] = [
    LEVEL,
    ...bankedColumns.map((bank) => ({ pitch: LEVEL_PITCH_ROW, bank })),
    ...pitchedRows.map((pitch) => ({ pitch, bank: LEVEL_BANK })),
    ...pitchedRows.flatMap((pitch) => bankedColumns.map((bank) => ({ pitch, bank }))),
];

interface FrameGrid {
    frames: PlayerFrames;
    /** Resolves once the level sweep is in `frames`; rejects if it cannot be rendered. */
    level: Promise<PlayerFrames>;
    filling: { signal: AbortSignal } | null;
}

const grids = new Map<string, FrameGrid>();

/**
 * Fills `grid` in `SWEEP_ORDER`, skipping sweeps it already has, so a fill stopped by its signal
 * resumes where it left off. A sweep other than the level one that fails to render is skipped.
 */
export async function fillFrameGrid(
    frames: PlayerFrames,
    renderSweep: (ref: SweepRef) => Promise<HTMLCanvasElement[]>,
    signal: AbortSignal,
    onLevel: () => void
): Promise<void> {
    for (const ref of SWEEP_ORDER) {
        if (signal.aborted) throw abortError();
        if (!frames[ref.pitch][ref.bank]) {
            try {
                frames[ref.pitch][ref.bank] = await renderSweep(ref);
            } catch (e) {
                if (ref === LEVEL || isAbortError(e)) throw e;
            }
        }
        if (ref === LEVEL) onLevel();
    }
}

/**
 * The ship's frame grid (see `PlayerFrames`), resolved once its level sweep is ready; the other
 * sweeps fill into the same arrays afterwards, so a view holding them shows each as it lands.
 */
export function requestPlayerFrames(key: string, signal: AbortSignal): Promise<PlayerFrames> {
    reopenFor(signal);
    let grid = grids.get(key);
    if (grid) {
        grids.delete(key);
        grids.set(key, grid);
        if (grid.filling && !grid.filling.signal.aborted) return grid.level;
    } else {
        const frames: PlayerFrames = PITCH_ANGLES_DEG.map(() => BANK_ANGLES_DEG.map(() => null));
        grid = { frames, level: Promise.resolve(frames), filling: null };
        grids.set(key, grid);
    }
    const filled = grid;
    if (filled.frames.every((row) => row.every(Boolean))) {
        return Promise.resolve(filled.frames);
    }
    const filling = { signal };
    filled.filling = filling;
    let resolveLevel!: () => void;
    let rejectLevel!: (e: unknown) => void;
    filled.level = new Promise<PlayerFrames>((resolve, reject) => {
        resolveLevel = () => resolve(filled.frames);
        rejectLevel = reject;
    });
    filled.level.catch(() => {});
    spritesModule()
        .then((m) =>
            fillFrameGrid(
                filled.frames,
                (ref) => m.renderChaseSweeps(key, [ref], { signal }).then(([sweep]) => sweep),
                signal,
                resolveLevel
            )
        )
        .catch(rejectLevel)
        .finally(() => {
            if (filled.filling === filling) filled.filling = null;
            evictOldest(grids, PLAYER_GRIDS_KEPT, (k) => k === flownKey || !!grids.get(k)?.filling);
        });
    return filled.level;
}

/** The ship's frame grid if its level sweep has rendered, for a run starting now. */
export function cachedPlayerFrames(key: string): PlayerFrames | null {
    const frames = grids.get(key)?.frames;
    return frames?.[LEVEL.pitch][LEVEL.bank] ? frames : null;
}
