import {
    createStars,
    createSunCache,
    drawFighterRear,
    drawGrid,
    drawGround,
    drawMountains,
    drawSky,
    drawStars,
    drawSun,
    sceneGeometry,
    SceneGeometry,
    Star,
    SunCache,
} from '../theme/synthwaveScene';
import { JUMP_SECONDS, SHIELD_BREAK_FLASH, SPAWN_Z } from '../../utils/arcade/constants';
import type { Checkpoint, GameState, Obstacle, Pickup } from '../../utils/arcade/types';
import {
    gridOffsetDelta,
    introGridLayers,
    laneWidthAtPlayer,
    project,
    screenHeadingDeg,
} from './projection';
import type { FlightOrigin } from './flightEvents';
import { drawEngineGlow, drawNeonFighter } from './neonFighter';
import type { NeonAccent } from './ships/factionTint';
import { cachedPortrait } from './ships/portraitSprite';
import { stakesBanner } from './duel/stakesText';
import {
    actionPitchDeg,
    advancePose,
    clampHeadingDeg,
    FrameSweeps,
    frameBlend,
    MAX_HEADING_DEG,
    pickSweep,
    PlayerPose,
    restingPose,
    settle,
    slideBank,
} from './ships/spritePoses';

export const INTRO_SECONDS = 1.2;
const LANE_SLIDE_RATE = 14;
const FADE_IN_UNITS = 10;
const GATE_COLOUR = '#b06cff';
const MIN_TEXT_PX = 8;
/** Width of the player sprite in fighter units: the neon fighter spans x ±2.2s. */
const SPRITE_FOOTPRINT = 4.4;
/** Vertical scale of the ship at the bottom of a duck. */
const DUCK_SQUASH = 0.55;

export type PlayerFrames = FrameSweeps<HTMLCanvasElement>;

/** What a duel gate shows: the opponent waiting behind it. */
export interface GateArt {
    name: string;
    level: number | undefined;
    portraitUrl: string | null;
    /** Rendered 3D sprite; preferred over the portrait once it is set. */
    sprite?: HTMLCanvasElement | null;
}

export interface FlightView {
    gridOffset: number;
    /** Rendered lane offset; eases toward the logical lane so lane changes slide. */
    playerX: number;
    stars: Star[];
    sun: SunCache;
    intro: FlightOrigin | null;
    introElapsed: number;
    /** Player hull outline colour; `null` keeps the default neon pink. */
    playerAccent: NeonAccent | null;
    /** Opponents per checkpoint id, in gate-slot order; a checkpoint without art is not drawn. */
    gateArt: Map<number, [GateArt, GateArt]>;
    /** Rendered player ship: heading sweeps by pitch and bank (see `spritePoses`); a sweep
     *  still rendering is `null` and `pickSweep` stands another in for it. `null` draws the
     *  neon fighter. */
    playerFrames: PlayerFrames | null;
    /** The player ship's drawn pose, eased toward the lane, slide and action every frame. */
    pose: PlayerPose;
}

export function createFlightView(
    origin?: FlightOrigin,
    accent: NeonAccent | null = null
): FlightView {
    return {
        gridOffset: 0,
        playerX: 0,
        stars: createStars(150),
        sun: createSunCache(),
        intro: origin ?? null,
        introElapsed: 0,
        playerAccent: accent,
        gateArt: new Map(),
        playerFrames: null,
        pose: restingPose(),
    };
}

export function advanceView(view: FlightView, travelUnits: number): void {
    view.gridOffset = (view.gridOffset + gridOffsetDelta(travelUnits)) % 1;
}

const laneOffset = (lane: number) => lane - 1;

/** How far the intro has flown the ship in from the page background, eased out: 0 at the start,
 *  1 once it is over or when the run did not start from the background. */
function introProgress(view: FlightView): number {
    if (!view.intro || view.introElapsed >= INTRO_SECONDS) return 1;
    const t = view.introElapsed / INTRO_SECONDS;
    return 1 - (1 - t) * (1 - t);
}

/** The pose the player ship eases toward: the nose aims at the vanishing point from wherever the
 *  ship is in its slide (within `MAX_HEADING_DEG`), the bank follows the slide and levels out
 *  once the ship settles, and the action sets pitch and duck. */
function targetPose(g: SceneGeometry, game: GameState, view: FlightView): PlayerPose {
    const { action, actionTime, lane } = game.player;
    return {
        headingDeg: clampHeadingDeg(screenHeadingDeg(g, view.playerX)),
        bank: slideBank(laneOffset(lane), view.playerX),
        pitchDeg: actionPitchDeg(action, actionTime),
        duck: action === 'duck' ? 1 : 0,
    };
}

let blendCanvas: HTMLCanvasElement | null = null;

/**
 * Draws the weighted frames centred on the origin at `size`. Several frames are summed with
 * additive compositing into an offscreen canvas first: on premultiplied pixels that gives exactly
 * Σ weight × frame, so the hull stays fully opaque mid-blend, where stacking translucent frames
 * on the scene would let the grid show through it.
 */
function drawBlendedFrames(
    ctx: CanvasRenderingContext2D,
    frames: { frame: HTMLCanvasElement; weight: number }[],
    size: number
): void {
    if (frames.length === 1) {
        ctx.drawImage(frames[0].frame, -size / 2, -size / 2, size, size);
        return;
    }
    const { width, height } = frames[0].frame;
    blendCanvas ??= document.createElement('canvas');
    if (blendCanvas.width !== width || blendCanvas.height !== height) {
        blendCanvas.width = width;
        blendCanvas.height = height;
    }
    const blend = blendCanvas.getContext('2d');
    if (!blend) return;
    blend.clearRect(0, 0, width, height);
    blend.globalCompositeOperation = 'lighter';
    for (const { frame, weight } of frames) {
        blend.globalAlpha = weight;
        blend.drawImage(frame, 0, 0);
    }
    ctx.drawImage(blendCanvas, -size / 2, -size / 2, size, size);
}

function drawObstacle(ctx: CanvasRenderingContext2D, g: SceneGeometry, o: Obstacle): void {
    const p = project(g, laneOffset(o.lane), o.z);
    const u = p.width;
    ctx.globalAlpha = Math.min(1, Math.max(0, (SPAWN_Z - o.z) / FADE_IN_UNITS));
    if (o.kind === 'wall') {
        ctx.fillStyle = 'rgba(255, 40, 140, 0.85)';
        ctx.strokeStyle = '#ff9ad5';
        ctx.lineWidth = Math.max(1, 2 * p.scale);
        ctx.fillRect(p.x - 0.42 * u, p.y - 0.9 * u, 0.84 * u, 0.9 * u);
        ctx.strokeRect(p.x - 0.42 * u, p.y - 0.9 * u, 0.84 * u, 0.9 * u);
    } else if (o.kind === 'low') {
        ctx.fillStyle = '#40f0ff';
        ctx.fillRect(p.x - 0.45 * u, p.y - 0.22 * u, 0.9 * u, 0.08 * u);
        ctx.fillRect(p.x - 0.47 * u, p.y - 0.26 * u, 0.04 * u, 0.26 * u);
        ctx.fillRect(p.x + 0.43 * u, p.y - 0.26 * u, 0.04 * u, 0.26 * u);
    } else {
        ctx.fillStyle = '#ffb040';
        // The bar's bottom edge (-0.30u) sits between the ducking ship's top (about -0.24u)
        // and the running ship's top (about -0.38u), so only a duck visibly clears it.
        ctx.fillRect(p.x - 0.47 * u, p.y - 0.62 * u, 0.94 * u, 0.32 * u);
        ctx.fillRect(p.x - 0.47 * u, p.y - 0.62 * u, 0.05 * u, 0.62 * u);
        ctx.fillRect(p.x + 0.42 * u, p.y - 0.62 * u, 0.05 * u, 0.62 * u);
    }
    ctx.globalAlpha = 1;
}

function drawGate(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    lane: number,
    z: number,
    art: GateArt
): void {
    const p = project(g, laneOffset(lane), z);
    const u = p.width;
    const half = 0.42 * u;
    const shoulder = p.y - 0.9 * u;

    ctx.save();
    ctx.strokeStyle = GATE_COLOUR;
    ctx.shadowColor = GATE_COLOUR;
    ctx.shadowBlur = 12 * p.scale;
    ctx.lineWidth = Math.max(1, 4 * p.scale);
    ctx.beginPath();
    ctx.moveTo(p.x - half, p.y);
    ctx.lineTo(p.x - half, shoulder);
    ctx.arc(p.x, shoulder, half, Math.PI, 0);
    ctx.lineTo(p.x + half, p.y);
    ctx.stroke();
    ctx.restore();

    const cx = p.x;
    const cy = shoulder + 0.05 * u;
    const r = 0.3 * u;
    const sprite = art.sprite ?? null;
    const img = sprite ? null : art.portraitUrl ? cachedPortrait(art.portraitUrl) : null;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    if (sprite) {
        // The sprite's frame is square with the ship centred, so it fits the circle unclipped.
        ctx.drawImage(sprite, cx - r * 1.2, cy - r * 1.2, r * 2.4, r * 2.4);
    } else if (img) {
        ctx.clip();
        const fit = Math.max((2 * r) / img.naturalWidth, (2 * r) / img.naturalHeight);
        const w = img.naturalWidth * fit;
        const h = img.naturalHeight * fit;
        ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    } else {
        ctx.fillStyle = GATE_COLOUR;
        ctx.globalAlpha *= 0.6;
        ctx.fill();
    }
    ctx.restore();

    const fontPx = 0.075 * u;
    if (fontPx < MIN_TEXT_PX) return;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `600 ${fontPx}px sans-serif`;
    const textTop = cy + r + 0.04 * u;
    ctx.fillText(art.name, cx, textTop, 2 * half - 4);
    if (art.level !== undefined) {
        ctx.font = `${fontPx * 0.85}px sans-serif`;
        ctx.fillText(`Lv ${art.level}`, cx, textTop + fontPx * 1.15, 2 * half - 4);
    }
}

function drawCheckpoint(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    c: Checkpoint,
    art: [GateArt, GateArt] | undefined
): void {
    if (!art) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, (SPAWN_Z - c.z) / FADE_IN_UNITS));
    drawGate(ctx, g, c.gates[0], c.z, art[0]);
    drawGate(ctx, g, c.gates[1], c.z, art[1]);

    const centre = project(g, 0, c.z);
    const u = centre.width;
    const fontPx = 0.11 * u;
    if (fontPx >= MIN_TEXT_PX) {
        ctx.font = `bold ${fontPx}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = GATE_COLOUR;
        ctx.shadowColor = GATE_COLOUR;
        ctx.shadowBlur = 10 * centre.scale;
        ctx.fillText(stakesBanner(c.stakes), centre.x, centre.y - 1.42 * u);
    }
    ctx.restore();
}

function drawPickup(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    pk: Pickup,
    timeMs: number
): void {
    const p = project(g, laneOffset(pk.lane), pk.z);
    const u = p.width;
    const bob = Math.sin(timeMs * 0.006 + pk.id) * 0.04 * u;
    const cx = p.x;
    const cy = p.y - 0.3 * u + bob;
    const r = 0.12 * u;
    ctx.globalAlpha = Math.min(1, Math.max(0, (SPAWN_Z - pk.z) / FADE_IN_UNITS));
    ctx.lineWidth = Math.max(1, 2 * p.scale);
    if (pk.kind === 'credit') {
        ctx.fillStyle = '#ffe04a';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r * 0.7, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r * 0.7, cy);
        ctx.closePath();
        ctx.fill();
    } else if (pk.kind === 'shield') {
        ctx.strokeStyle = '#40f0ff';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.2, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        ctx.strokeStyle = '#ff60c0';
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI, 0, true);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

function drawPlayer(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    game: GameState,
    view: FlightView,
    timeMs: number
): void {
    const base = project(g, view.playerX, 0);
    const u = laneWidthAtPlayer(g);
    let s = u * 0.16;
    let x = base.x;
    let y = base.y - u * 0.25;

    const { action, actionTime } = game.player;
    if (action === 'jump') {
        const t = 1 - actionTime / JUMP_SECONDS;
        const arc = Math.sin(Math.PI * t);
        y -= arc * u * 0.6;
        s *= 1 + arc * 0.25;
    }
    const { pose } = view;
    const squash = 1 - (1 - DUCK_SQUASH) * pose.duck;
    y += u * 0.08 * pose.duck;

    const e = introProgress(view);
    if (view.intro && e < 1) {
        x = view.intro.x + (x - view.intro.x) * e;
        y = view.intro.y + (y - view.intro.y) * e;
        s = view.intro.size + (s - view.intro.size) * e;
    }

    ctx.save();
    ctx.translate(x, y);
    // The clicked background silhouette cross-fades into the neon fighter during the intro.
    if (e < 1) {
        ctx.save();
        ctx.globalAlpha = 1 - e;
        ctx.scale(1, squash);
        ctx.fillStyle = '#0d0620';
        ctx.strokeStyle = '#e070ff';
        ctx.lineWidth = 1.5;
        drawFighterRear(ctx, s);
        ctx.stroke();
        ctx.restore();
    }
    const { headingDeg, bank } = pose;
    ctx.globalAlpha = e;
    const blend = view.playerFrames ? frameBlend(headingDeg, bank, pose.pitchDeg) : [];
    // Blend corners whose sweeps fall back to the same frame are drawn as that one frame.
    const frames: { frame: HTMLCanvasElement; weight: number }[] = [];
    for (const { weight, ...index } of blend) {
        const sweep = view.playerFrames ? pickSweep(view.playerFrames, index) : null;
        const frame = sweep?.[index.heading];
        if (!frame) continue;
        const same = frames.find((f) => f.frame === frame);
        if (same) same.weight += weight;
        else frames.push({ frame, weight });
    }
    if (frames.length > 0) {
        // The sprite spans the fighter's footprint.
        const size = s * SPRITE_FOOTPRINT;
        drawEngineGlow(ctx, s, { timeMs, bank, squash, thrust: 1 });
        ctx.scale(1, squash);
        drawBlendedFrames(ctx, frames, size);
    } else {
        drawNeonFighter(ctx, s, {
            timeMs,
            bank,
            yaw: headingDeg / MAX_HEADING_DEG,
            squash,
            thrust: 1,
            accent: view.playerAccent ?? undefined,
        });
    }
    ctx.restore();

    if (game.player.shield) {
        ctx.strokeStyle = 'rgba(64, 240, 255, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, s * 3, 0, Math.PI * 2);
        ctx.stroke();
    }
    if (game.shieldBreakTime > 0) {
        const k = 1 - game.shieldBreakTime / SHIELD_BREAK_FLASH;
        ctx.strokeStyle = `rgba(255, 255, 255, ${1 - k})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, s * (3 + k * 3), 0, Math.PI * 2);
        ctx.stroke();
    }
}

export function renderFlight(
    ctx: CanvasRenderingContext2D,
    game: GameState,
    view: FlightView,
    timeMs: number,
    dt: number
): void {
    const w = ctx.canvas.offsetWidth;
    const h = ctx.canvas.offsetHeight;
    if (w === 0 || h === 0) return;
    const g = sceneGeometry(w, h);

    const target = laneOffset(game.player.lane);
    view.playerX = settle(
        view.playerX + (target - view.playerX) * Math.min(1, dt * LANE_SLIDE_RATE),
        target
    );
    view.pose = advancePose(view.pose, targetPose(g, game, view), dt);

    ctx.clearRect(0, 0, w, h);
    drawSky(ctx, g);
    drawStars(ctx, g, view.stars, timeMs, true);
    drawSun(ctx, g, view.sun, timeMs, true);
    drawMountains(ctx, g);
    drawGround(ctx, g);
    drawGrid(ctx, g, view.gridOffset, introGridLayers(g, introProgress(view)));

    const items: ({ z: number } & (
        { obstacle: Obstacle } | { pickup: Pickup } | { checkpoint: Checkpoint }
    ))[] = [
        ...game.obstacles.map((o) => ({ z: o.z, obstacle: o })),
        ...game.pickups.filter((p) => !p.collected).map((p) => ({ z: p.z, pickup: p })),
        // A checkpoint stops drawing once it reaches the player, so the gate just flown through
        // never covers the ship during the post-duel countdown.
        ...game.checkpoints.filter((c) => c.z > 0).map((c) => ({ z: c.z, checkpoint: c })),
    ];
    items.sort((a, b) => b.z - a.z);
    const drawItem = (item: (typeof items)[number]) => {
        if ('obstacle' in item) drawObstacle(ctx, g, item.obstacle);
        else if ('pickup' in item) drawPickup(ctx, g, item.pickup, timeMs);
        else drawCheckpoint(ctx, g, item.checkpoint, view.gateArt.get(item.checkpoint.id));
    };
    // Items already past the player are nearer the camera, so they draw over it.
    for (const item of items) if (item.z >= 0) drawItem(item);
    drawPlayer(ctx, g, game, view, timeMs);
    for (const item of items) if (item.z < 0) drawItem(item);
}
