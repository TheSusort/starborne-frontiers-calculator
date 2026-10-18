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
import type { GameState, Obstacle, Pickup } from '../../utils/arcade/types';
import { gridOffsetDelta, laneWidthAtPlayer, project } from './projection';
import type { FlightOrigin } from './flightEvents';

export const INTRO_SECONDS = 1.2;
const LANE_SLIDE_RATE = 14;
const FADE_IN_UNITS = 10;

export interface FlightView {
    gridOffset: number;
    /** Rendered lane offset; eases toward the logical lane so lane changes slide. */
    playerX: number;
    stars: Star[];
    sun: SunCache;
    intro: FlightOrigin | null;
    introElapsed: number;
}

export function createFlightView(origin?: FlightOrigin): FlightView {
    return {
        gridOffset: 0,
        playerX: 0,
        stars: createStars(150),
        sun: createSunCache(),
        intro: origin ?? null,
        introElapsed: 0,
    };
}

export function advanceView(view: FlightView, travelUnits: number): void {
    view.gridOffset = (view.gridOffset + gridOffsetDelta(travelUnits)) % 1;
}

const laneOffset = (lane: number) => lane - 1;

function drawLaneRails(ctx: CanvasRenderingContext2D, g: SceneGeometry): void {
    ctx.strokeStyle = 'rgba(255, 120, 220, 0.35)';
    ctx.lineWidth = 2;
    for (const x of [-1.5, -0.5, 0.5, 1.5]) {
        const a = project(g, x, -2);
        const b = project(g, x, SPAWN_Z);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    }
}

function drawObstacle(ctx: CanvasRenderingContext2D, g: SceneGeometry, o: Obstacle): void {
    const p = project(g, laneOffset(o.lane), o.z);
    const u = laneWidthAtPlayer(g) * p.scale;
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
        ctx.fillRect(p.x - 0.47 * u, p.y - 0.95 * u, 0.94 * u, 0.14 * u);
        ctx.fillRect(p.x - 0.47 * u, p.y - 0.95 * u, 0.05 * u, 0.95 * u);
        ctx.fillRect(p.x + 0.42 * u, p.y - 0.95 * u, 0.05 * u, 0.95 * u);
    }
    ctx.globalAlpha = 1;
}

function drawPickup(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    pk: Pickup,
    timeMs: number
): void {
    const p = project(g, laneOffset(pk.lane), pk.z);
    const u = laneWidthAtPlayer(g) * p.scale;
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
    view: FlightView
): void {
    const base = project(g, view.playerX, 0);
    const u = laneWidthAtPlayer(g);
    let s = u * 0.16;
    let x = base.x;
    let y = base.y - u * 0.25;
    let squash = 1;

    const { action, actionTime } = game.player;
    if (action === 'jump') {
        const t = 1 - actionTime / JUMP_SECONDS;
        const arc = Math.sin(Math.PI * t);
        y -= arc * u * 0.6;
        s *= 1 + arc * 0.25;
    } else if (action === 'duck') {
        squash = 0.55;
        y += u * 0.08;
    }

    if (view.intro && view.introElapsed < INTRO_SECONDS) {
        const t = view.introElapsed / INTRO_SECONDS;
        const e = 1 - (1 - t) * (1 - t);
        x = view.intro.x + (x - view.intro.x) * e;
        y = view.intro.y + (y - view.intro.y) * e;
        s = view.intro.size + (s - view.intro.size) * e;
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, squash);
    const glow = ctx.createRadialGradient(0, s * 0.6, 0, 0, s * 0.6, s * 2);
    glow.addColorStop(0, 'rgba(220, 180, 255, 0.8)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-s * 2, -s * 1.4, s * 4, s * 4);
    ctx.fillStyle = '#0d0620';
    ctx.strokeStyle = '#e070ff';
    ctx.lineWidth = 1.5;
    drawFighterRear(ctx, s);
    ctx.stroke();
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
    view.playerX += (target - view.playerX) * Math.min(1, dt * LANE_SLIDE_RATE);

    ctx.clearRect(0, 0, w, h);
    drawSky(ctx, g);
    drawStars(ctx, g, view.stars, timeMs, true);
    drawSun(ctx, g, view.sun, timeMs, true);
    drawMountains(ctx, g);
    drawGround(ctx, g);
    drawGrid(ctx, g, view.gridOffset);
    drawLaneRails(ctx, g);

    const items: ({ z: number } & ({ obstacle: Obstacle } | { pickup: Pickup }))[] = [
        ...game.obstacles.map((o) => ({ z: o.z, obstacle: o })),
        ...game.pickups.filter((p) => !p.collected).map((p) => ({ z: p.z, pickup: p })),
    ];
    items.sort((a, b) => b.z - a.z);
    const drawItem = (item: (typeof items)[number]) => {
        if ('obstacle' in item) drawObstacle(ctx, g, item.obstacle);
        else drawPickup(ctx, g, item.pickup, timeMs);
    };
    // Items already past the player are nearer the camera, so they draw over it.
    for (const item of items) if (item.z >= 0) drawItem(item);
    drawPlayer(ctx, g, game, view);
    for (const item of items) if (item.z < 0) drawItem(item);
}
