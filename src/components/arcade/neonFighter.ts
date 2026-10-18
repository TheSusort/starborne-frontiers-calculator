import type { NeonAccent } from './ships/factionTint';

/**
 * The arcade player ship: a neon wireframe fighter seen from behind. Every coordinate is a
 * multiple of `s`; the footprint spans x ±2.2s and y -0.8s..+0.6s (flames extend below), which
 * the arch obstacle's bar height in `flightRenderer` is tuned against.
 */
export interface NeonFighterPose {
    timeMs: number;
    /** -1..1, positive = banking right. */
    bank: number;
    /** Vertical scale: 1 normal, 0.55 ducking. */
    squash: number;
    /** 0..1 engine intensity. */
    thrust: number;
    /** Hull outline colour; defaults to the neon pink. */
    accent?: NeonAccent;
}

const HULL_FILL_TOP = 'rgba(42, 12, 70, 0.88)';
const HULL_FILL_BOTTOM = 'rgba(10, 4, 26, 0.92)';
const NEON_PINK = '#ff4fd8';
const NEON_PINK_GLOW = 'rgba(255, 79, 216, 0.28)';
const NEON_CYAN = '#40f0ff';
const NEON_CYAN_GLOW = 'rgba(64, 240, 255, 0.25)';
const NAV_LEFT = '255, 60, 110';
const NAV_RIGHT = '64, 255, 170';

const BANK_ROTATION = 0.25;
const LOWER_WING_FORESHORTEN = 0.2;
const NAV_BLINK_MS = 1100;

type Pt = readonly [number, number];

/** Right half of the hull outline, from the canopy tip clockwise to the engine centre line. */
const HULL_RIGHT: readonly Pt[] = [
    [0, -0.8],
    [0.18, -0.68],
    [0.34, -0.42],
    [1.55, -0.24],
    [2.2, -0.08],
    [2.12, 0.13],
    [1.3, 0.17],
    [0.62, 0.22],
    [0.52, 0.5],
    [0.46, 0.6],
    [0.18, 0.6],
    [0.12, 0.42],
    [0, 0.36],
];

/** Canted tail fin on the right side; mirrored for the left. */
const FIN_RIGHT: readonly Pt[] = [
    [0.22, -0.34],
    [0.52, -0.74],
    [0.62, -0.7],
    [0.5, -0.3],
];

/** Cyan panel lines on the right wing; mirrored for the left. */
const WING_LINES_RIGHT: readonly (readonly Pt[])[] = [
    [
        [0.5, -0.3],
        [1.6, -0.14],
        [2.08, -0.02],
    ],
    [
        [0.66, 0.1],
        [1.25, 0.03],
    ],
    [
        [1.62, -0.2],
        [1.72, 0.08],
    ],
];

const ENGINE_X = 0.32;
const ENGINE_Y = 0.5;

/**
 * Draws the fighter centred at the current origin. The caller's `globalAlpha` scales the
 * whole drawing (the intro cross-fade relies on that); canvas state is restored on return.
 */
export function drawNeonFighter(
    ctx: CanvasRenderingContext2D,
    s: number,
    pose: NeonFighterPose
): void {
    const bank = Math.max(-1, Math.min(1, pose.bank));
    const thrust = Math.max(0, Math.min(1, pose.thrust));
    const alpha = ctx.globalAlpha;
    const t = pose.timeMs;
    const pink = pose.accent?.core ?? NEON_PINK;
    const pinkGlow = pose.accent?.glow ?? NEON_PINK_GLOW;

    // The wing dipping toward the ground turns away from the camera, so it reads shorter.
    const kRight = 1 - LOWER_WING_FORESHORTEN * Math.max(0, bank);
    const kLeft = 1 - LOWER_WING_FORESHORTEN * Math.max(0, -bank);
    const X = (x: number) => s * x * (x >= 0 ? kRight : kLeft);
    const Y = (y: number) => s * y;
    const mirror = (pts: readonly Pt[]): Pt[] => pts.map(([x, y]) => [-x, y]);

    const path = (pts: readonly Pt[], close: boolean) => {
        ctx.beginPath();
        ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
        if (close) ctx.closePath();
    };
    const neonStroke = (core: string, glow: string, width: number) => {
        ctx.strokeStyle = glow;
        ctx.lineWidth = Math.max(2.5, s * width * 3.5);
        ctx.stroke();
        ctx.strokeStyle = core;
        ctx.lineWidth = Math.max(1, s * width);
        ctx.stroke();
    };

    ctx.save();
    ctx.rotate(bank * BANK_ROTATION);
    ctx.scale(1, pose.squash);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Engine bloom behind the hull.
    ctx.globalCompositeOperation = 'lighter';
    const bloomPulse = 0.85 + 0.15 * Math.sin(t * 0.02);
    const bloom = ctx.createRadialGradient(0, Y(ENGINE_Y), 0, 0, Y(ENGINE_Y), s * 1.6);
    bloom.addColorStop(0, `rgba(255, 90, 220, ${0.45 * thrust * bloomPulse})`);
    bloom.addColorStop(0.5, `rgba(140, 60, 255, ${0.16 * thrust * bloomPulse})`);
    bloom.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(-s * 1.6, Y(ENGINE_Y) - s * 1.6, s * 3.2, s * 3.2);
    ctx.globalCompositeOperation = 'source-over';

    // Tail fins sit behind the fuselage.
    const hullGrad = ctx.createLinearGradient(0, Y(-0.8), 0, Y(0.6));
    hullGrad.addColorStop(0, HULL_FILL_TOP);
    hullGrad.addColorStop(1, HULL_FILL_BOTTOM);
    for (const fin of [FIN_RIGHT, mirror(FIN_RIGHT)]) {
        path(fin, true);
        ctx.fillStyle = hullGrad;
        ctx.fill();
        neonStroke(pink, pinkGlow, 0.045);
    }

    // Hull: one closed outline from both mirrored halves.
    const hull: Pt[] = [...HULL_RIGHT, ...mirror(HULL_RIGHT).reverse().slice(1, -1)];
    path(hull, true);
    ctx.fillStyle = hullGrad;
    ctx.fill();
    neonStroke(pink, pinkGlow, 0.055);

    // Cyan panel lines: wings plus the fuselage spine.
    for (const line of [...WING_LINES_RIGHT, ...WING_LINES_RIGHT.map(mirror)]) {
        path(line, false);
        neonStroke(NEON_CYAN, NEON_CYAN_GLOW, 0.03);
    }
    path(
        [
            [0, -0.36],
            [0, 0.3],
        ],
        false
    );
    neonStroke(NEON_CYAN, NEON_CYAN_GLOW, 0.025);
    for (const side of [1, -1]) {
        path(
            [
                [side * 0.12, 0.05],
                [side * 0.3, -0.12],
                [side * 0.4, -0.08],
            ],
            false
        );
        neonStroke(NEON_CYAN, NEON_CYAN_GLOW, 0.022);
    }

    // Canopy on the fuselage's upper spine.
    ctx.beginPath();
    ctx.moveTo(0, Y(-0.74));
    ctx.quadraticCurveTo(X(0.2), Y(-0.6), X(0.16), Y(-0.42));
    ctx.quadraticCurveTo(0, Y(-0.34), X(-0.16), Y(-0.42));
    ctx.quadraticCurveTo(X(-0.2), Y(-0.6), 0, Y(-0.74));
    ctx.closePath();
    const canopy = ctx.createLinearGradient(0, Y(-0.74), 0, Y(-0.36));
    canopy.addColorStop(0, 'rgba(200, 255, 255, 0.95)');
    canopy.addColorStop(0.35, 'rgba(64, 240, 255, 0.85)');
    canopy.addColorStop(1, 'rgba(30, 60, 160, 0.75)');
    ctx.fillStyle = canopy;
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 255, 255, 0.9)';
    ctx.lineWidth = Math.max(0.75, s * 0.02);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(X(-0.07), Y(-0.64));
    ctx.quadraticCurveTo(X(-0.1), Y(-0.55), X(-0.08), Y(-0.48));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = Math.max(0.75, s * 0.025);
    ctx.stroke();

    // Engine nozzles and flames.
    for (const side of [-1, 1]) {
        const nx = X(side * ENGINE_X);
        const ny = Y(ENGINE_Y);
        const rx = Math.abs(X(side * 0.14));
        const ry = s * 0.1;
        const phase = side * 1.7;
        const flicker =
            0.75 + 0.15 * Math.sin(t * 0.031 + phase) + 0.1 * Math.sin(t * 0.097 + phase * 2.3);
        const len = s * (0.5 + 0.75 * flicker) * thrust;

        ctx.globalCompositeOperation = 'lighter';
        if (len > 0) {
            const outer = ctx.createLinearGradient(0, ny, 0, ny + len);
            outer.addColorStop(0, `rgba(255, 80, 210, ${0.85 * flicker})`);
            outer.addColorStop(0.6, `rgba(150, 60, 255, ${0.45 * flicker})`);
            outer.addColorStop(1, 'rgba(80, 40, 255, 0)');
            ctx.fillStyle = outer;
            ctx.beginPath();
            ctx.moveTo(nx - rx * 1.05, ny);
            ctx.quadraticCurveTo(nx - rx * 0.6, ny + len * 0.6, nx, ny + len);
            ctx.quadraticCurveTo(nx + rx * 0.6, ny + len * 0.6, nx + rx * 1.05, ny);
            ctx.closePath();
            ctx.fill();

            const coreLen = len * 0.55;
            const core = ctx.createLinearGradient(0, ny, 0, ny + coreLen);
            core.addColorStop(0, `rgba(255, 255, 255, ${0.95 * flicker})`);
            core.addColorStop(0.5, `rgba(120, 250, 255, ${0.7 * flicker})`);
            core.addColorStop(1, 'rgba(64, 240, 255, 0)');
            ctx.fillStyle = core;
            ctx.beginPath();
            ctx.moveTo(nx - rx * 0.5, ny);
            ctx.quadraticCurveTo(nx - rx * 0.25, ny + coreLen * 0.6, nx, ny + coreLen);
            ctx.quadraticCurveTo(nx + rx * 0.25, ny + coreLen * 0.6, nx + rx * 0.5, ny);
            ctx.closePath();
            ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';

        // Nozzle ring with a hot glowing throat.
        ctx.beginPath();
        ctx.ellipse(nx, ny, rx, ry, 0, 0, Math.PI * 2);
        const throat = ctx.createRadialGradient(nx, ny, 0, nx, ny, rx);
        throat.addColorStop(0, `rgba(255, 255, 255, ${0.4 + 0.6 * thrust})`);
        throat.addColorStop(0.5, `rgba(255, 120, 230, ${0.3 + 0.6 * thrust})`);
        throat.addColorStop(1, 'rgba(60, 10, 80, 0.9)');
        ctx.fillStyle = throat;
        ctx.fill();
        neonStroke(NEON_CYAN, NEON_CYAN_GLOW, 0.035);
    }

    // Wing-tip navigation lights blink in alternation.
    const blinkPhase = (t % NAV_BLINK_MS) / NAV_BLINK_MS;
    ctx.globalCompositeOperation = 'lighter';
    for (const [side, rgb, on] of [
        [-1, NAV_LEFT, blinkPhase < 0.5],
        [1, NAV_RIGHT, blinkPhase >= 0.5],
    ] as const) {
        const lx = X(side * 2.16);
        const ly = Y(0.01);
        const level = on ? 1 : 0.18;
        const r = s * 0.42;
        const halo = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
        halo.addColorStop(0, `rgba(${rgb}, ${0.9 * level})`);
        halo.addColorStop(0.35, `rgba(${rgb}, ${0.3 * level})`);
        halo.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = halo;
        ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
        ctx.globalAlpha = alpha * (on ? 1 : 0.45);
        ctx.fillStyle = on ? '#ffffff' : `rgb(${rgb})`;
        ctx.beginPath();
        ctx.arc(lx, ly, Math.max(0.8, s * 0.06), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = alpha;
    }

    ctx.restore();
}
