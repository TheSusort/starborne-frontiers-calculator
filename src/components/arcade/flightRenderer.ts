import {
    createStars,
    createSunCache,
    drawFighterRear,
    drawGridFan,
    drawGridLines,
    drawStars,
    drawSunDisc,
    sceneGeometry,
    SceneGeometry,
    Star,
    SunCache,
} from '../theme/synthwaveScene';
import {
    JUMP_PEAK,
    JUMP_SCALE_GAIN,
    PICKUP_HEIGHT,
    PICKUP_RADIUS,
    SHIELD_BREAK_FLASH,
    SHIP_RIDE_HEIGHT,
    SPAWN_Z,
} from '../../utils/arcade/constants';
import { jumpArc } from '../../utils/arcade/collision';
import type { Checkpoint, GameState, Obstacle, Pickup } from '../../utils/arcade/types';
import {
    gridOffsetDelta,
    introGridLayers,
    laneWidthAtPlayer,
    project,
    projectInto,
    Projected,
    screenHeadingDeg,
} from './projection';
import type { FlightOrigin } from './flightEvents';
import { drawNeonFighter } from './neonFighter';
import {
    Backdrop,
    createBackdrop,
    drawBackdropFan,
    drawBackdropGround,
    drawBackdropSky,
} from './backdrop';
import { barrierPulse, drawBarrier } from './barriers';
import {
    drawShieldBack,
    drawShieldBreak,
    drawShieldFront,
    drawShieldPickup,
    ShieldPlacement,
    fitShield,
} from './shield';
import { frameFootprint } from './spriteFootprint';
import {
    advanceSpeedLines,
    createSpeedLines,
    drawSpeedLines,
    laneWedge,
    SpeedLinePool,
} from './speedLines';
import {
    advanceExplosion,
    createExplosion,
    drawExplosion,
    Explosion,
    startExplosion,
} from './explosion';
import { advanceTrail, createShipTrail, drawShipTrails, ShipBox, ShipTrail } from './shipTrails';
import type { NeonAccent } from './ships/factionTint';
import { cachedPortrait } from './ships/portraitSprite';
import { stakesBanner } from './duel/stakesText';
import {
    actionPitchDeg,
    advancePose,
    clampHeadingDeg,
    FrameSweeps,
    frameBlend,
    LEVEL_BANK,
    LEVEL_HEADING,
    LEVEL_PITCH_ROW,
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
/** The shield pickup's radius against `PICKUP_RADIUS`. */
const SHIELD_PICKUP_SIZE = 1.2;
/** Width of the player sprite in fighter units: the neon fighter spans x ±2.2s. */
const SPRITE_FOOTPRINT = 4.4;
/** Vertical scale of the neon fighter at the bottom of a duck; it has no pitched frames, so a
 *  duck flattens it. A 3D sprite is not squashed: it pitches its nose down instead. */
const DUCK_SQUASH = 0.55;
/** How far a duck lowers the ship, in lane widths at the player row: the neon fighter, and the
 *  3D sprite, which drops further to make up for not being squashed. Either way the ducking
 *  ship's top stays under a high block's gap (see `barriers`). */
const DUCK_DROP = 0.08;
const SPRITE_DUCK_DROP = 0.13;

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
    /** The static sky and ground, cached per screen size. */
    backdrop: Backdrop;
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
    /** Streaks rushing out of the vanishing point; `null` under reduced motion. */
    speedLines: SpeedLinePool | null;
    /** The lane wedge new speed lines keep out of, from the last drawn frame's geometry. */
    laneWedge: number;
    /** The player ship's wake and air-flow streaks; `null` under reduced motion. */
    trail: ShipTrail | null;
    /** World travel since the last drawn frame, which the trail turns into game time. */
    trailTravel: number;
    /** The canvas's device pixel ratio, as its owner set the transform; 0 reads it back from
     *  the canvas size. */
    dpr: number;
    /** Set by `explodeShip`: the ship is gone and its explosion plays where it was. */
    dying: boolean;
    explosion: Explosion;
}

/** Lane wedge used before the first frame has measured the screen. */
const DEFAULT_LANE_WEDGE = 0.8;

export function createFlightView(
    origin?: FlightOrigin,
    accent: NeonAccent | null = null,
    reducedMotion = false
): FlightView {
    return {
        gridOffset: 0,
        playerX: 0,
        stars: createStars(150),
        sun: createSunCache(),
        backdrop: createBackdrop(),
        intro: origin ?? null,
        introElapsed: 0,
        playerAccent: accent,
        gateArt: new Map(),
        playerFrames: null,
        pose: restingPose(),
        speedLines: reducedMotion ? null : createSpeedLines(DEFAULT_LANE_WEDGE),
        laneWedge: DEFAULT_LANE_WEDGE,
        trail: reducedMotion ? null : createShipTrail(),
        trailTravel: 0,
        dpr: 0,
        dying: false,
        explosion: createExplosion(),
    };
}

/** Ends the ship: from the next frame it is not drawn and explodes where it was (a short flash
 *  under reduced motion); `view.explosion.elapsed` times the death sequence. */
export function explodeShip(view: FlightView, reducedMotion: boolean): void {
    view.dying = true;
    view.explosion.started = false;
    view.explosion.elapsed = 0;
    view.explosion.reducedMotion = reducedMotion;
}

/** How long the barriers already at or past the ship (the one it hit among them) take to
 *  vanish once it has exploded, so the explosion is not hidden behind the barrier it hit. */
const WRECK_FADE_SECONDS = 0.3;

/** How long the ship's trails take to fade once it has exploded. */
const TRAIL_DEATH_FADE_SECONDS = 0.25;

/** Scrolls the grid and the speed lines and ages the ship's trail by world travel, so all hold
 *  still while the game does not step (paused, countdown, duel). */
export function advanceView(view: FlightView, travelUnits: number): void {
    view.gridOffset = (view.gridOffset + gridOffsetDelta(travelUnits)) % 1;
    view.trailTravel += travelUnits;
    if (view.speedLines) advanceSpeedLines(view.speedLines, travelUnits, view.laneWedge);
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

function drawObstacle(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    o: Obstacle,
    timeMs: number,
    fade: number
): void {
    const p = project(g, laneOffset(o.lane), o.z);
    ctx.globalAlpha = fade * Math.min(1, Math.max(0, (SPAWN_Z - o.z) / FADE_IN_UNITS));
    drawBarrier(ctx, o.kind, p.x, p.y, p.width, p.scale, barrierPulse(timeMs, o.id));
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
    timeMs: number,
    dpr: number
): void {
    const p = project(g, laneOffset(pk.lane), pk.z);
    const u = p.width;
    const bob = Math.sin(timeMs * 0.006 + pk.id) * 0.04 * u;
    const cx = p.x;
    const cy = p.y - PICKUP_HEIGHT * u + bob;
    const r = PICKUP_RADIUS * u;
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
        const atPlayerRow = PICKUP_RADIUS * SHIELD_PICKUP_SIZE * laneWidthAtPlayer(g) * dpr;
        drawShieldPickup(ctx, cx, cy, r * SHIELD_PICKUP_SIZE, atPlayerRow, p.scale);
    } else {
        ctx.strokeStyle = '#ff60c0';
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI, 0, true);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

/** Whether the player ship draws as a 3D sprite: its level sweep has rendered, and `pickSweep`
 *  stands it in for any sweep still rendering. */
const showsSprite = (view: FlightView): boolean =>
    !!view.playerFrames?.[LEVEL_PITCH_ROW]?.[LEVEL_BANK];

/** The ship's height above the track, in lane widths at the player row: its ride height, raised
 *  by a jump's arc and lowered by a duck. */
function shipLift(game: GameState, view: FlightView): number {
    const { action, actionTime } = game.player;
    const arc = action === 'jump' ? jumpArc(actionTime) : 0;
    const drop = showsSprite(view) ? SPRITE_DUCK_DROP : DUCK_DROP;
    return SHIP_RIDE_HEIGHT + arc * JUMP_PEAK - drop * view.pose.duck;
}

/** The shield's placement, rewritten every frame rather than allocated. */
const shieldAt: ShieldPlacement = { x: 0, y: 0, rx: 0, ry: 0, dpr: 1, bank: 0 };

/** The neon fighter's outline from its centre, in ship units (see `neonFighter`). */
const NEON_HALF_WIDTH = 2.2;
const NEON_TOP = -0.8;
const NEON_BOTTOM = 0.6;

/** Where the player ship is drawn this frame: its `ShipBox`, its ship unit `s` (see
 *  `neonFighter`), the neon fighter's duck squash and the intro's progress. */
interface ShipPlacement extends ShipBox {
    s: number;
    squash: number;
    intro: number;
}

/** The ship's placement, rewritten every frame rather than allocated. */
const shipAt: ShipPlacement = {
    x: 0,
    y: 0,
    halfWidth: 0,
    top: 0,
    bottom: 0,
    baseX: 0,
    baseY: 0,
    s: 0,
    squash: 1,
    intro: 1,
};
const baseAt: Projected = { x: 0, y: 0, scale: 0, width: 0 };

/**
 * Places the player ship: on its lane at its lift, flown in from the page background during the
 * intro, with its visible extent from the 3D sprite's level frame (so it does not wobble as
 * frames blend) or the neon fighter's outline.
 */
function placeShip(out: ShipPlacement, g: SceneGeometry, game: GameState, view: FlightView): void {
    const base = projectInto(g, view.playerX, 0, baseAt);
    const u = laneWidthAtPlayer(g);
    let s = u * 0.16;
    let x = base.x;
    let y = base.y - u * shipLift(game, view);

    const { action, actionTime } = game.player;
    if (action === 'jump') s *= 1 + jumpArc(actionTime) * JUMP_SCALE_GAIN;
    const squash = showsSprite(view) ? 1 : 1 - (1 - DUCK_SQUASH) * view.pose.duck;

    const e = introProgress(view);
    if (view.intro && e < 1) {
        x = view.intro.x + (x - view.intro.x) * e;
        y = view.intro.y + (y - view.intro.y) * e;
        s = view.intro.size + (s - view.intro.size) * e;
    }

    const level = view.playerFrames?.[LEVEL_PITCH_ROW]?.[LEVEL_BANK]?.[LEVEL_HEADING];
    const fp = level ? frameFootprint(level) : null;
    if (fp) {
        const size = s * SPRITE_FOOTPRINT;
        out.halfWidth = fp.halfWidth * size;
        out.top = fp.top * size;
        out.bottom = fp.bottom * size;
    } else {
        out.halfWidth = NEON_HALF_WIDTH * s;
        out.top = NEON_TOP * s * squash;
        out.bottom = NEON_BOTTOM * s * squash;
    }
    out.x = x;
    out.y = y;
    out.baseX = base.x;
    out.baseY = base.y;
    out.s = s;
    out.squash = squash;
    out.intro = e;
}

/** Fits the shield around the placed ship's visible extent. */
function placeShield(
    out: ShieldPlacement,
    ship: ShipPlacement,
    view: FlightView,
    dpr: number
): void {
    fitShield(out, ship.halfWidth, (ship.bottom - ship.top) / 2);
    out.x = ship.x;
    out.y = ship.y + (ship.top + ship.bottom) / 2;
    out.dpr = dpr;
    out.bank = view.pose.bank;
}

function drawPlayer(
    ctx: CanvasRenderingContext2D,
    ship: ShipPlacement,
    game: GameState,
    view: FlightView,
    timeMs: number,
    dpr: number
): void {
    const { x, y, s, squash, intro: e } = ship;
    const { pose } = view;
    const shield = shieldAt;
    placeShield(shield, ship, view, dpr);
    if (game.player.shield) drawShieldBack(ctx, shield, timeMs);

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
        // A model's engines sit in different places per ship, so it draws without exhaust.
        const size = s * SPRITE_FOOTPRINT;
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

    if (game.player.shield) drawShieldFront(ctx, shield, timeMs);
    if (game.shieldBreakTime > 0) {
        drawShieldBreak(ctx, shield, 1 - game.shieldBreakTime / SHIELD_BREAK_FLASH);
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
    const dpr = view.dpr > 0 ? view.dpr : ctx.canvas.width / w;

    const target = laneOffset(game.player.lane);
    view.playerX = settle(
        view.playerX + (target - view.playerX) * Math.min(1, dt * LANE_SLIDE_RATE),
        target
    );
    view.pose = advancePose(view.pose, targetPose(g, game, view), dt);

    ctx.clearRect(0, 0, w, h);
    drawBackdropSky(ctx, g, view.backdrop, dpr);
    drawStars(ctx, g, view.stars, timeMs, true);
    drawSunDisc(ctx, g, view.sun, timeMs, true);
    drawBackdropGround(ctx, g, view.backdrop, dpr);
    drawGridLines(ctx, g, view.gridOffset);
    const intro = introProgress(view);
    if (intro < 1) drawGridFan(ctx, g, introGridLayers(g, intro));
    else drawBackdropFan(ctx, g, view.backdrop, dpr);
    view.laneWedge = laneWedge(g);
    if (view.speedLines) drawSpeedLines(ctx, g, view.speedLines, game.speed);

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
    const wreckFade = Math.max(0, 1 - view.explosion.elapsed / WRECK_FADE_SECONDS);
    const drawItem = (item: (typeof items)[number]) => {
        if ('obstacle' in item) {
            const o = item.obstacle;
            drawObstacle(ctx, g, o, timeMs, view.dying && o.z <= 0 ? wreckFade : 1);
        } else if ('pickup' in item) drawPickup(ctx, g, item.pickup, timeMs, dpr);
        else drawCheckpoint(ctx, g, item.checkpoint, view.gateArt.get(item.checkpoint.id));
    };
    // Items already past the player are nearer the camera, so they draw over it.
    for (const item of items) if (item.z >= 0) drawItem(item);
    const ship = shipAt;
    placeShip(ship, g, game, view);
    const u = laneWidthAtPlayer(g);
    const boom = view.explosion;
    if (view.dying) {
        if (!boom.started) {
            startExplosion(boom, ship.x, ship.y, u, view.playerX, boom.reducedMotion, Math.random);
        } else {
            advanceExplosion(boom, dt);
        }
    }
    if (view.trail) {
        const seconds = game.speed > 0 ? view.trailTravel / game.speed : 0;
        advanceTrail(view.trail, seconds, view.playerX);
        const e = ship.intro;
        const fade = view.dying ? Math.max(0, 1 - boom.elapsed / TRAIL_DEATH_FADE_SECONDS) : 1;
        drawShipTrails(ctx, g, view.trail, game.speed, view.playerX, ship, u, e * e * fade);
    }
    view.trailTravel = 0;
    if (!view.dying) drawPlayer(ctx, ship, game, view, timeMs, dpr);
    for (const item of items) if (item.z < 0) drawItem(item);
    if (view.dying) drawExplosion(ctx, g, boom, w, h);
}
