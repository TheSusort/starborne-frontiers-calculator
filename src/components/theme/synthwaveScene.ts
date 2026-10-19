export const HORIZON_RATIO = 0.45;
export const GRID_NEAR_PLANE = 1;
export const GRID_FAR_PLANE = 15;

export interface SceneGeometry {
    w: number;
    h: number;
    horizonY: number;
    gridHeight: number;
    vanishX: number;
}

export function sceneGeometry(w: number, h: number): SceneGeometry {
    const horizonY = h * HORIZON_RATIO;
    return { w, h, horizonY, gridHeight: h - horizonY, vanishX: w / 2 };
}

/** Screen Y of a grid depth; the horizontal grid lines use the same mapping. */
export function depthToScreenY(g: SceneGeometry, depth: number): number {
    return g.horizonY + g.gridHeight * (GRID_NEAR_PLANE / depth);
}

export interface Star {
    x: number;
    y: number;
    size: number;
    brightness: number;
    twinkleSpeed: number;
    twinkleOffset: number;
}

export function createStars(count: number): Star[] {
    const stars: Star[] = [];
    for (let i = 0; i < count; i++) {
        stars.push({
            x: Math.random(),
            y: Math.random() * 0.5,
            size: Math.random() * 1.5 + 0.3,
            brightness: Math.random() * 0.6 + 0.2,
            twinkleSpeed: Math.random() * 2 + 1,
            twinkleOffset: Math.random() * Math.PI * 2,
        });
    }
    return stars;
}

/** The sun disc, re-rendered at most once per stripe frame into a canvas just big enough for it,
 *  in device pixels. `left`/`top` are its device-pixel origin on the main canvas, and `key` the
 *  geometry and pixel ratio it was sized for; a change of either re-creates it. */
export interface SunCache {
    canvas: HTMLCanvasElement | null;
    frame: number;
    left: number;
    top: number;
    key: string;
}

export const createSunCache = (): SunCache => ({
    canvas: null,
    frame: -1,
    left: 0,
    top: 0,
    key: '',
});

export interface OverheadShipHit {
    x: number;
    y: number;
    size: number;
    progress: number;
}

/** The fighter is ~11px wide, so the click target is a generous circle around it. */
export const OVERHEAD_HIT_RADIUS = 36;
const OVERHEAD_HIT_MAX_PROGRESS = 0.85;

export function hitTestOverheadShip(ship: OverheadShipHit | null, px: number, py: number): boolean {
    if (!ship || ship.progress >= OVERHEAD_HIT_MAX_PROGRESS) return false;
    const r = Math.max(OVERHEAD_HIT_RADIUS, ship.size * 3);
    const dx = px - ship.x;
    const dy = py - ship.y;
    return dx * dx + dy * dy <= r * r;
}

/** Fighter silhouette at the current transform. */
export function drawFighter(c: CanvasRenderingContext2D, s: number): void {
    c.beginPath();
    c.moveTo(s * 2.5, 0);
    c.lineTo(s * 1.2, -s * 0.25);
    c.lineTo(s * 0.3, -s * 0.3);
    c.lineTo(-s * 0.1, -s * 0.55);
    c.lineTo(-s * 0.5, -s * 0.35);
    c.lineTo(-s * 1.0, -s * 1.2);
    c.lineTo(-s * 1.5, -s * 1.0);
    c.lineTo(-s * 1.3, -s * 0.3);
    c.lineTo(-s * 1.5, -s * 0.15);
    c.lineTo(-s * 1.5, s * 0.15);
    c.lineTo(-s * 1.0, s * 0.2);
    c.lineTo(-s * 0.6, s * 0.5);
    c.lineTo(-s * 0.3, s * 0.25);
    c.lineTo(s * 0.5, s * 0.2);
    c.lineTo(s * 1.5, s * 0.1);
    c.closePath();
    c.fill();
}

/** Fighter seen from behind (flying away). */
export function drawFighterRear(c: CanvasRenderingContext2D, s: number): void {
    c.beginPath();
    // Fuselage center
    c.moveTo(0, -s * 0.8);
    // Right side of fuselage
    c.lineTo(s * 0.4, -s * 0.5);
    // Right wing
    c.lineTo(s * 2.0, -s * 0.2);
    c.lineTo(s * 2.2, s * 0.1);
    c.lineTo(s * 0.6, s * 0.2);
    // Right engine
    c.lineTo(s * 0.5, s * 0.6);
    c.lineTo(s * 0.2, s * 0.6);
    // Tail center
    c.lineTo(s * 0.15, s * 0.3);
    // Dorsal fin
    c.lineTo(0, -s * 0.1);
    c.lineTo(-s * 0.15, s * 0.3);
    // Left engine
    c.lineTo(-s * 0.2, s * 0.6);
    c.lineTo(-s * 0.5, s * 0.6);
    c.lineTo(-s * 0.6, s * 0.2);
    // Left wing
    c.lineTo(-s * 2.2, s * 0.1);
    c.lineTo(-s * 2.0, -s * 0.2);
    // Left side of fuselage
    c.lineTo(-s * 0.4, -s * 0.5);
    c.closePath();
    c.fill();
}

/** Contrail drawn as one batched path per alpha bucket. */
export function drawContrail(
    c: CanvasRenderingContext2D,
    points: { x: number; y: number }[],
    maxAlpha: number,
    maxWidth: number
): void {
    if (points.length < 2) return;
    // Draw in 5 buckets instead of per-segment
    const buckets = 5;
    const segPerBucket = Math.ceil(points.length / buckets);
    for (let b = 0; b < buckets; b++) {
        const startIdx = Math.max(b * segPerBucket, 1);
        const endIdx = Math.min((b + 1) * segPerBucket, points.length);
        if (startIdx >= endIdx) continue;
        const midT = (startIdx + endIdx) / 2 / points.length;
        c.strokeStyle = `rgba(220, 200, 255, ${midT * maxAlpha})`;
        c.lineWidth = midT * maxWidth;
        c.beginPath();
        c.moveTo(points[startIdx - 1].x, points[startIdx - 1].y);
        for (let i = startIdx; i < endIdx; i++) {
            c.lineTo(points[i].x, points[i].y);
        }
        c.stroke();
    }
}

export function drawSky(ctx: CanvasRenderingContext2D, g: SceneGeometry): void {
    const { w, horizonY } = g;
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyGrad.addColorStop(0, '#0a0515');
    skyGrad.addColorStop(0.4, '#1a0a30');
    skyGrad.addColorStop(0.7, '#2a1045');
    skyGrad.addColorStop(1, '#3d1555');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, horizonY);

    // Nebula/pink patches on sides
    const nebulaLeft = ctx.createRadialGradient(
        w * 0.1,
        horizonY * 0.6,
        0,
        w * 0.1,
        horizonY * 0.6,
        w * 0.25
    );
    nebulaLeft.addColorStop(0, 'rgba(180, 40, 100, 0.15)');
    nebulaLeft.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = nebulaLeft;
    ctx.fillRect(0, 0, w * 0.4, horizonY);

    const nebulaRight = ctx.createRadialGradient(
        w * 0.9,
        horizonY * 0.5,
        0,
        w * 0.9,
        horizonY * 0.5,
        w * 0.2
    );
    nebulaRight.addColorStop(0, 'rgba(120, 30, 80, 0.1)');
    nebulaRight.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = nebulaRight;
    ctx.fillRect(w * 0.6, 0, w * 0.4, horizonY);
}

export function drawStars(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    stars: Star[],
    timeMs: number,
    animate: boolean
): void {
    const { w, h } = g;
    for (const star of stars) {
        const twinkle = animate
            ? Math.sin(timeMs * 0.001 * star.twinkleSpeed + star.twinkleOffset) * 0.3 + 0.7
            : 1;
        const alpha = star.brightness * twinkle;
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(star.x * w, star.y * h, star.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

function sunCircle(g: SceneGeometry): { sunX: number; sunY: number; sunR: number } {
    const sunR = g.h * 0.18;
    return { sunX: g.w / 2, sunY: g.horizonY - sunR * 0.6, sunR };
}

/** The sun's outer glow; it changes only with the geometry. */
export function drawSunGlow(ctx: CanvasRenderingContext2D, g: SceneGeometry): void {
    const { sunX, sunY, sunR } = sunCircle(g);
    const outerGlow = ctx.createRadialGradient(sunX, sunY, sunR, sunX, sunY, sunR * 4);
    outerGlow.addColorStop(0, 'rgba(255, 150, 180, 0.25)');
    outerGlow.addColorStop(0.3, 'rgba(200, 80, 150, 0.1)');
    outerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = outerGlow;
    ctx.fillRect(0, 0, g.w, g.horizonY + sunR);
}

/** The sun: its outer glow, then its striped disc. */
export function drawSun(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    cache: SunCache,
    timeMs: number,
    animate: boolean
): void {
    drawSunGlow(ctx, g);
    drawSunDisc(ctx, g, cache, timeMs, animate);
}

/** The striped sun disc, through `cache`; the stripes scroll when `animate`. */
export function drawSunDisc(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    cache: SunCache,
    timeMs: number,
    animate: boolean
): void {
    const { w, h } = g;
    const time = timeMs;
    const canvas = ctx.canvas;
    const { sunX, sunY, sunR } = sunCircle(g);

    const sunFrame = Math.floor(time / 50); // ~20fps for sun stripes
    if (canvas.width === 0 || canvas.height === 0) return;
    const dpr = canvas.width / w;
    // The disc's device-pixel box, snapped outward so the cache lands 1:1 on the canvas pixels.
    const left = Math.floor((sunX - sunR) * dpr);
    const top = Math.floor((sunY - sunR) * dpr);
    const width = Math.ceil((sunX + sunR) * dpr) - left;
    const height = Math.ceil((sunY + sunR) * dpr) - top;
    const key = `${w}x${h}@${dpr}`;
    if (!cache.canvas || cache.key !== key) {
        cache.canvas ??= document.createElement('canvas');
        cache.canvas.width = width;
        cache.canvas.height = height;
        cache.left = left;
        cache.top = top;
        cache.key = key;
        cache.frame = -1;
    }
    if (sunFrame !== cache.frame) {
        cache.frame = sunFrame;
        const sunCtx = cache.canvas.getContext('2d')!;
        sunCtx.setTransform(dpr, 0, 0, dpr, -left, -top);
        sunCtx.clearRect(sunX - sunR - 1, sunY - sunR - 1, sunR * 2 + 2, sunR * 2 + 2);

        sunCtx.save();
        sunCtx.beginPath();
        sunCtx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
        sunCtx.clip();

        const sunGrad = sunCtx.createLinearGradient(sunX, sunY - sunR, sunX, sunY + sunR);
        sunGrad.addColorStop(0, '#ffccaa');
        sunGrad.addColorStop(0.3, '#ff99aa');
        sunGrad.addColorStop(0.6, '#ee6688');
        sunGrad.addColorStop(1, '#aa3366');
        sunCtx.fillStyle = sunGrad;
        sunCtx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2);

        // Punch out stripes
        sunCtx.globalCompositeOperation = 'destination-out';
        const numSunStripes = 11;
        const sunStripeSpeed = animate ? (time * 0.00003) % 1 : 0;
        for (let i = 0; i < numSunStripes; i++) {
            const rawPos = (i / numSunStripes + sunStripeSpeed) % 1;
            const stripeY = sunY + sunR * (1 - rawPos * 2);
            const thickness = 24 * Math.max(1 - rawPos / 0.7, 0);
            if (thickness < 0.3) continue;

            sunCtx.fillStyle = 'rgba(0, 0, 0, 1)';
            sunCtx.fillRect(sunX - sunR, stripeY, sunR * 2, thickness);
        }
        sunCtx.restore();
    }
    const { width: cw, height: ch } = cache.canvas;
    ctx.drawImage(cache.canvas, 0, 0, cw, ch, left / dpr, top / dpr, cw / dpr, ch / dpr);
}

const mountainScale = ({ w, h }: SceneGeometry) => Math.max(h * 0.012, Math.min(h, w) * 0.015);
/** The tallest mountain peak, in units of `mountainScale`. */
const MAX_PEAK = 5.5;

/** Screen y of the highest point the mountains and the horizon glow line reach. */
export const mountainsTop = (g: SceneGeometry): number =>
    Math.min(g.horizonY - MAX_PEAK * mountainScale(g), g.horizonY - HORIZON_GLOW_ABOVE);

export function drawMountains(ctx: CanvasRenderingContext2D, g: SceneGeometry): void {
    const { w, horizonY } = g;
    ctx.fillStyle = '#0d0620';
    ctx.beginPath();
    ctx.moveTo(-10, horizonY);
    const scale = mountainScale(g);
    const peakHeights = [
        [-0.05, 1.5],
        [0.0, 3],
        [0.04, 4.5],
        [0.08, 3.5],
        [0.12, 5],
        [0.17, 3],
        [0.2, 2],
        [0.24, 3.5],
        [0.28, 4],
        [0.33, 2.5],
        [0.37, 1.5],
        [0.42, 2],
        [0.47, 1],
        [0.5, 0.5],
        [0.53, 0.8],
        [0.57, 1.5],
        [0.62, 3],
        [0.66, 2],
        [0.7, 3.5],
        [0.76, 5.5],
        [0.8, 4],
        [0.84, 4.5],
        [0.88, 3],
        [0.91, 4],
        [0.95, 2.5],
        [1.0, 1.5],
        [1.05, 1],
    ];
    for (const [px, peakH] of peakHeights) {
        ctx.lineTo(px * w, horizonY - peakH * scale);
    }
    ctx.lineTo(w + 10, horizonY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(80, 30, 80, 0.15)';
    ctx.fill();
}

/** How far above the horizon the horizon glow line starts. */
const HORIZON_GLOW_ABOVE = 8;

export function drawGround(ctx: CanvasRenderingContext2D, g: SceneGeometry): void {
    const { w, h, horizonY } = g;
    const groundGrad = ctx.createLinearGradient(0, horizonY, 0, h);
    groundGrad.addColorStop(0, '#1a0835');
    groundGrad.addColorStop(0.05, '#0d0420');
    groundGrad.addColorStop(1, '#050210');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, horizonY, w, h - horizonY);

    // === HORIZON GLOW LINE ===
    const horizGlow = ctx.createLinearGradient(0, horizonY - HORIZON_GLOW_ABOVE, 0, horizonY + 15);
    horizGlow.addColorStop(0, 'rgba(200, 100, 255, 0)');
    horizGlow.addColorStop(0.4, 'rgba(200, 100, 255, 0.6)');
    horizGlow.addColorStop(0.5, 'rgba(220, 120, 255, 0.9)');
    horizGlow.addColorStop(0.6, 'rgba(200, 100, 255, 0.6)');
    horizGlow.addColorStop(1, 'rgba(200, 100, 255, 0)');
    ctx.fillStyle = horizGlow;
    ctx.fillRect(0, horizonY - HORIZON_GLOW_ABOVE, w, HORIZON_GLOW_ABOVE + 15);
}

/**
 * The fan of vertical grid lines: line `i` of `count + 1` sits at `t = i / count` and runs
 * straight from `vanishX + (t - 0.5) * topSpread` on the horizon to
 * `bottomLeft + t * bottomSpread` on the near plane (the bottom of the screen).
 */
export interface GridColumns {
    count: number;
    topSpread: number;
    bottomSpread: number;
    bottomLeft: number;
}

/** A fan of vertical lines drawn at `alpha` (multiplied into the context's own alpha). */
export interface GridLayer {
    columns: GridColumns;
    alpha: number;
}

/** The page background's fan: off-centre at the bottom, denser on wide screens. */
export function defaultGridColumns(g: SceneGeometry): GridColumns {
    const spreadBottom = Math.max(g.w * 10, g.h * 12);
    return {
        count: g.w / g.h > 1.2 ? 40 : 20,
        topSpread: Math.max(g.h * 0.2, g.w * 0.15),
        bottomSpread: spreadBottom,
        bottomLeft: -spreadBottom * 0.3,
    };
}

export function gridLineEnds(
    g: SceneGeometry,
    columns: GridColumns,
    t: number
): { topX: number; bottomX: number } {
    return {
        topX: g.vanishX + (t - 0.5) * columns.topSpread,
        bottomX: columns.bottomLeft + t * columns.bottomSpread,
    };
}

/** Screen x of the grid line at fan position `t` (fractional between lines) at a grid depth;
 *  the lines are straight, so this is exact for every point `drawGrid` draws. */
export function gridLineX(
    g: SceneGeometry,
    columns: GridColumns,
    t: number,
    depth: number
): number {
    const { topX, bottomX } = gridLineEnds(g, columns, t);
    return topX + (bottomX - topX) * (GRID_NEAR_PLANE / depth);
}

/** Fill colours of the fan's lines, glow and core, by line index: they depend only on the line
 *  count, so they are built once per count. */
const fanColours = new Map<number, { glow: string[]; core: string[] }>();

function fanColoursFor(count: number): { glow: string[]; core: string[] } {
    let colours = fanColours.get(count);
    if (!colours) {
        colours = { glow: [], core: [] };
        for (let i = 0; i <= count; i++) {
            const absFromCenter = Math.abs(i / count - 0.5);
            const glow = Math.max(0.35 - absFromCenter * 0.35, 0.02);
            const core = Math.max(0.55 - absFromCenter * 0.5, 0.05);
            colours.glow.push(`rgba(180, 80, 255, ${glow})`);
            colours.core.push(`rgba(180, 80, 255, ${core})`);
        }
        fanColours.set(count, colours);
    }
    return colours;
}

function drawGridColumns(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    columns: GridColumns
): void {
    // Vertical grid lines — NO shadowBlur, double-draw for glow
    const { horizonY, h } = g;
    const gridBottom = h;
    const numVLines = columns.count;
    const colours = fanColoursFor(numVLines);

    // Glow pass
    for (let i = 0; i <= numVLines; i++) {
        const t = i / numVLines;
        const topX = g.vanishX + (t - 0.5) * columns.topSpread;
        const bottomX = columns.bottomLeft + t * columns.bottomSpread;
        const absFromCenter = Math.abs(t - 0.5);
        const bottomW = Math.max(14 - absFromCenter * 20, 0.8);
        const topW = 0.6;

        ctx.fillStyle = colours.glow[i];
        ctx.beginPath();
        ctx.moveTo(topX - topW / 2, horizonY);
        ctx.lineTo(topX + topW / 2, horizonY);
        ctx.lineTo(bottomX + bottomW / 2, gridBottom);
        ctx.lineTo(bottomX - bottomW / 2, gridBottom);
        ctx.closePath();
        ctx.fill();
    }
    // Core pass
    for (let i = 0; i <= numVLines; i++) {
        const t = i / numVLines;
        const topX = g.vanishX + (t - 0.5) * columns.topSpread;
        const bottomX = columns.bottomLeft + t * columns.bottomSpread;
        const absFromCenter = Math.abs(t - 0.5);
        const bottomW = Math.max(4 - absFromCenter * 6, 0.2);
        const topW = 0.15;

        ctx.fillStyle = colours.core[i];
        ctx.beginPath();
        ctx.moveTo(topX - topW / 2, horizonY);
        ctx.lineTo(topX + topW / 2, horizonY);
        ctx.lineTo(bottomX + bottomW / 2, gridBottom);
        ctx.lineTo(bottomX - bottomW / 2, gridBottom);
        ctx.closePath();
        ctx.fill();
    }
}

/** The horizontal lines' edge-fading gradients for a screen `w` wide, at full opacity: a line
 *  is stroked with one under `globalAlpha` set to its own opacity. A horizontal gradient is the
 *  same at every y, so one per pass serves every line. Built once per context and width. */
const lineGradients = new WeakMap<
    CanvasRenderingContext2D,
    { w: number; glow: CanvasGradient; core: CanvasGradient }
>();

function lineGradientsFor(
    ctx: CanvasRenderingContext2D,
    w: number
): { glow: CanvasGradient; core: CanvasGradient } {
    let cached = lineGradients.get(ctx);
    if (!cached || cached.w !== w) {
        const glow = ctx.createLinearGradient(0, 0, w, 0);
        glow.addColorStop(0, 'rgba(180, 80, 255, 0)');
        glow.addColorStop(0.3, 'rgba(180, 80, 255, 1)');
        glow.addColorStop(0.7, 'rgba(180, 80, 255, 1)');
        glow.addColorStop(1, 'rgba(180, 80, 255, 0)');
        const core = ctx.createLinearGradient(0, 0, w, 0);
        core.addColorStop(0, 'rgba(180, 80, 255, 0)');
        core.addColorStop(0.25, 'rgba(180, 80, 255, 1)');
        core.addColorStop(0.75, 'rgba(180, 80, 255, 1)');
        core.addColorStop(1, 'rgba(180, 80, 255, 0)');
        cached = { w, glow, core };
        lineGradients.set(ctx, cached);
    }
    return cached;
}

/** The floor grid's horizontal lines, scrolled by `gridOffset` (0..1). */
export function drawGridLines(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    gridOffset: number
): void {
    const { w } = g;
    // Horizontal grid lines — NO shadowBlur, use double-draw for glow
    const numHLines = 20;
    const gridSpeed = gridOffset;
    const gradients = lineGradientsFor(ctx, w);
    const alpha = ctx.globalAlpha;

    // First pass: wide faint "glow" lines — fade toward edges
    ctx.strokeStyle = gradients.glow;
    for (let i = 0; i < numHLines; i++) {
        const depth =
            GRID_FAR_PLANE - ((i / numHLines + gridSpeed) % 1) * (GRID_FAR_PLANE - GRID_NEAR_PLANE);
        const screenY = depthToScreenY(g, depth);
        const closeness = 1 - (depth - GRID_NEAR_PLANE) / (GRID_FAR_PLANE - GRID_NEAR_PLANE);
        ctx.globalAlpha = alpha * Math.min(closeness * 0.15, 0.12);
        ctx.lineWidth = 2 + closeness * 6;
        ctx.beginPath();
        ctx.moveTo(0, screenY);
        ctx.lineTo(w, screenY);
        ctx.stroke();
    }
    // Second pass: thin bright core lines — fade toward edges
    ctx.strokeStyle = gradients.core;
    for (let i = 0; i < numHLines; i++) {
        const depth =
            GRID_FAR_PLANE - ((i / numHLines + gridSpeed) % 1) * (GRID_FAR_PLANE - GRID_NEAR_PLANE);
        const screenY = depthToScreenY(g, depth);
        const closeness = 1 - (depth - GRID_NEAR_PLANE) / (GRID_FAR_PLANE - GRID_NEAR_PLANE);
        ctx.globalAlpha = alpha * Math.min(closeness * 0.8, 0.7);
        ctx.lineWidth = 0.3 + closeness * 2;
        ctx.beginPath();
        ctx.moveTo(0, screenY);
        ctx.lineTo(w, screenY);
        ctx.stroke();
    }
    ctx.globalAlpha = alpha;
}

/** The floor grid's vertical fan (each layer's, or the one `GridColumns` given, or the page
 *  background's) and the glow over the grid's centre. Nothing here moves. */
export function drawGridFan(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    gridColumns?: GridColumns | readonly GridLayer[]
): void {
    const { w, horizonY, gridHeight, vanishX } = g;
    if (Array.isArray(gridColumns)) {
        for (const { columns, alpha } of gridColumns as readonly GridLayer[]) {
            if (alpha <= 0) continue;
            ctx.save();
            ctx.globalAlpha *= alpha;
            drawGridColumns(ctx, g, columns);
            ctx.restore();
        }
    } else {
        drawGridColumns(ctx, g, (gridColumns as GridColumns | undefined) ?? defaultGridColumns(g));
    }

    // Center glow on grid
    const centerGlow = ctx.createRadialGradient(
        vanishX,
        horizonY + 20,
        0,
        vanishX,
        horizonY + gridHeight * 0.3,
        w * 0.4
    );
    centerGlow.addColorStop(0, 'rgba(180, 80, 255, 0.15)');
    centerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = centerGlow;
    ctx.fillRect(0, horizonY, w, gridHeight);
}

/** Draws the floor grid: the horizontal lines, then the vertical fan of each layer (or the one
 *  `GridColumns` given, or the page background's), then the centre glow. */
export function drawGrid(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    gridOffset: number,
    gridColumns?: GridColumns | readonly GridLayer[]
): void {
    drawGridLines(ctx, g, gridOffset);
    drawGridFan(ctx, g, gridColumns);
}

export function drawFadeOverlay(ctx: CanvasRenderingContext2D, g: SceneGeometry): void {
    const { w, h } = g;
    const overlay = ctx.createLinearGradient(0, 0, 0, h);
    overlay.addColorStop(0, 'rgba(13, 10, 46, 0.6)');
    overlay.addColorStop(0.45, 'rgba(13, 10, 46, 0.35)');
    overlay.addColorStop(0.55, 'rgba(13, 10, 46, 0.35)');
    overlay.addColorStop(1, 'rgba(13, 10, 46, 0.65)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, w, h);
}
