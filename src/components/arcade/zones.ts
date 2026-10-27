import {
    ACCELERATION,
    LATE_ACCELERATION,
    MAX_SPEED,
    METERS_PER_UNIT,
    RAMP_SPEED,
    START_SPEED,
} from '../../utils/arcade/constants';
import { metersTravelled } from '../../utils/arcade/scoring';
import { SUNSET_SCENE, type ScenePalette } from '../theme/synthwaveScene';
import { SUNSET_BARRIERS, type BarrierColours } from './barriers';
import { SUNSET_SPEED_LINES, type SpeedLineColours } from './speedLines';

/**
 * Zones: every `ZONE_METERS` of the run the scenery takes the next zone's colours, cycling
 * through `ZONES`, cross-fading over `ZONE_FADE_SECONDS` of game time. The zone and its fade are
 * pure functions of the distance travelled, so every run sees the same zones at the same metres.
 */
export const ZONE_METERS = 1000;
export const ZONE_FADE_SECONDS = 2;
/** A fade moves through this many palettes, so the caches keyed by palette rebuild at most this
 *  many times per fade. */
export const ZONE_FADE_STEPS = 16;

/** Everything a zone colours. */
export interface ZonePalette {
    scene: ScenePalette;
    barriers: BarrierColours;
    speedLines: SpeedLineColours;
}

export interface Zone {
    name: string;
    palette: ZonePalette;
}

const NEON_NIGHT: ZonePalette = {
    scene: {
        sky: ['#02030f', '#060a26', '#0b1440', '#122060'],
        nebulaLeft: 'rgba(40, 120, 220, 0.16)',
        nebulaRight: 'rgba(90, 40, 200, 0.12)',
        sunGlow: ['rgba(120, 200, 255, 0.25)', 'rgba(60, 100, 230, 0.1)'],
        sun: ['#c8f6ff', '#70c8ff', '#5a78ff', '#3a2aa8'],
        ground: ['#081236', '#040a20', '#020510'],
        horizon: '80, 200, 255',
        horizonCore: '150, 235, 255',
        grid: '40, 200, 255',
    },
    barriers: {
        wall: {
            top: 'rgba(190, 80, 255, 0.9)',
            bottom: 'rgba(40, 10, 110, 0.9)',
            glow: 'rgba(190, 80, 255, 0.35)',
            core: '#ecd4ff',
        },
        low: {
            top: 'rgba(190, 255, 170, 1)',
            bottom: 'rgba(40, 180, 90, 1)',
            glow: 'rgba(90, 255, 140, 0.4)',
            core: '#eeffe8',
        },
        high: {
            top: 'rgba(255, 120, 220, 0.95)',
            bottom: 'rgba(80, 90, 255, 0.95)',
            glow: 'rgba(255, 90, 200, 0.38)',
            core: '#ffd8f4',
        },
    },
    speedLines: {
        glow: ['rgba(64, 240, 255, 0.16)', 'rgba(160, 110, 255, 0.14)'],
        core: ['rgba(150, 245, 255, 0.55)', 'rgba(205, 175, 255, 0.5)'],
    },
};

const RED_ALERT: ZonePalette = {
    scene: {
        sky: ['#120204', '#2a0508', '#45080c', '#661014'],
        nebulaLeft: 'rgba(230, 50, 20, 0.18)',
        nebulaRight: 'rgba(170, 20, 30, 0.12)',
        sunGlow: ['rgba(255, 120, 60, 0.3)', 'rgba(220, 40, 20, 0.12)'],
        sun: ['#fff0a0', '#ffb040', '#ff5020', '#b01010'],
        ground: ['#2a0606', '#140303', '#070101'],
        horizon: '255, 80, 40',
        horizonCore: '255, 170, 100',
        grid: '255, 50, 60',
    },
    barriers: {
        wall: {
            top: 'rgba(255, 200, 60, 0.9)',
            bottom: 'rgba(130, 40, 0, 0.9)',
            glow: 'rgba(255, 170, 40, 0.35)',
            core: '#fff0c0',
        },
        low: {
            top: 'rgba(160, 250, 255, 1)',
            bottom: 'rgba(30, 150, 220, 1)',
            glow: 'rgba(64, 240, 255, 0.4)',
            core: '#e6feff',
        },
        high: {
            top: 'rgba(255, 110, 60, 0.95)',
            bottom: 'rgba(150, 20, 90, 0.95)',
            glow: 'rgba(255, 90, 40, 0.38)',
            core: '#ffd0b0',
        },
    },
    speedLines: {
        glow: ['rgba(255, 80, 60, 0.16)', 'rgba(255, 190, 80, 0.14)'],
        core: ['rgba(255, 165, 145, 0.55)', 'rgba(255, 225, 155, 0.5)'],
    },
};

const ICE: ZonePalette = {
    scene: {
        sky: ['#0a1424', '#1a3050', '#2f5578', '#5a86a8'],
        nebulaLeft: 'rgba(200, 230, 255, 0.15)',
        nebulaRight: 'rgba(150, 200, 255, 0.1)',
        sunGlow: ['rgba(220, 240, 255, 0.3)', 'rgba(140, 200, 255, 0.12)'],
        sun: ['#ffffff', '#d8f4ff', '#9cd8ff', '#5a9ad0'],
        ground: ['#1c3550', '#0e1d30', '#050b16'],
        horizon: '170, 230, 255',
        horizonCore: '230, 250, 255',
        grid: '120, 210, 255',
    },
    barriers: {
        wall: {
            top: 'rgba(230, 250, 255, 0.9)',
            bottom: 'rgba(60, 110, 190, 0.9)',
            glow: 'rgba(180, 230, 255, 0.35)',
            core: '#ffffff',
        },
        low: {
            top: 'rgba(225, 175, 255, 1)',
            bottom: 'rgba(120, 60, 220, 1)',
            glow: 'rgba(200, 140, 255, 0.4)',
            core: '#f4e8ff',
        },
        high: {
            top: 'rgba(120, 255, 230, 0.95)',
            bottom: 'rgba(60, 80, 200, 0.95)',
            glow: 'rgba(100, 240, 220, 0.38)',
            core: '#dafff8',
        },
    },
    speedLines: {
        glow: ['rgba(200, 240, 255, 0.16)', 'rgba(140, 200, 255, 0.14)'],
        core: ['rgba(240, 252, 255, 0.55)', 'rgba(190, 230, 255, 0.5)'],
    },
};

/** The zones in run order; zone 1 (Sunset) is the page background's look. */
export const ZONES: readonly Zone[] = [
    {
        name: 'Sunset',
        palette: { scene: SUNSET_SCENE, barriers: SUNSET_BARRIERS, speedLines: SUNSET_SPEED_LINES },
    },
    { name: 'Neon Night', palette: NEON_NIGHT },
    { name: 'Red Alert', palette: RED_ALERT },
    { name: 'Ice', palette: ICE },
];

/** The run's zone at `distanceUnits` of travel, counted from 0. */
export function zoneIndexAt(distanceUnits: number): number {
    return Math.floor(metersTravelled(distanceUnits) / ZONE_METERS);
}

export const zoneOf = (index: number): Zone => ZONES[index % ZONES.length];

/** "ZONE 2 · NEON NIGHT" for zone index 1. */
export const zoneBanner = (index: number): string =>
    `ZONE ${index + 1} · ${zoneOf(index).name.toUpperCase()}`;

const EARLY_UNITS = (RAMP_SPEED ** 2 - START_SPEED ** 2) / (2 * ACCELERATION);
const LATE_UNITS = (MAX_SPEED ** 2 - RAMP_SPEED ** 2) / (2 * LATE_ACCELERATION);

/** Seconds a constant acceleration `a` from `v0` takes to cover `d`. */
const accelerating = (v0: number, a: number, d: number) =>
    (Math.sqrt(v0 * v0 + 2 * a * d) - v0) / a;

/**
 * Game seconds of running the run takes to cover `distanceUnits`, along the speed ramp
 * `nextSpeed` follows (START_SPEED to RAMP_SPEED at ACCELERATION, then to MAX_SPEED at
 * LATE_ACCELERATION). Duels and countdowns stop both the speed and the distance, so the ramp is
 * a function of distance alone.
 */
export function runSecondsAt(distanceUnits: number): number {
    const d = Math.max(0, distanceUnits);
    if (d <= EARLY_UNITS) return accelerating(START_SPEED, ACCELERATION, d);
    const early = (RAMP_SPEED - START_SPEED) / ACCELERATION;
    if (d <= EARLY_UNITS + LATE_UNITS) {
        return early + accelerating(RAMP_SPEED, LATE_ACCELERATION, d - EARLY_UNITS);
    }
    const late = (MAX_SPEED - RAMP_SPEED) / LATE_ACCELERATION;
    return early + late + (d - EARLY_UNITS - LATE_UNITS) / MAX_SPEED;
}

/** How far the fade into the current zone has gone, 0..1: 1 in zone 1 and once
 *  `ZONE_FADE_SECONDS` of running have passed since the zone's boundary. */
export function zoneBlendAt(distanceUnits: number): number {
    const index = zoneIndexAt(distanceUnits);
    if (index === 0) return 1;
    const boundary = (index * ZONE_METERS) / METERS_PER_UNIT;
    const elapsed = runSecondsAt(distanceUnits) - runSecondsAt(boundary);
    return Math.max(0, Math.min(1, elapsed / ZONE_FADE_SECONDS));
}

type Rgba = [number, number, number, number];

/** Parses `#rrggbb`, `rgba(r, g, b, a)`, `rgb(r, g, b)` or a bare `r, g, b` triple. */
export function parseColour(colour: string): Rgba {
    if (colour.startsWith('#')) {
        const n = parseInt(colour.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    const parts = colour
        .replace(/^rgba?\(|\)$/g, '')
        .split(',')
        .map((p) => Number(p.trim()));
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** The per-channel blend of two colours of the same notation, `t` of the way from `a` to `b`. A
 *  bare `r, g, b` triple stays a triple; anything else comes back as `rgba(...)`. */
export function blendColour(a: string, b: string, t: number): string {
    const x = parseColour(a);
    const y = parseColour(b);
    const c = x.map((v, i) => v + (y[i] - v) * t);
    const rgb = `${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}`;
    return /^[\d\s,.]+$/.test(a) ? rgb : `rgba(${rgb}, ${round3(c[3])})`;
}

type Tree = string | readonly Tree[] | { readonly [key: string]: Tree };

function blendTree(a: Tree, b: Tree, t: number): Tree {
    if (typeof a === 'string') return blendColour(a, b as string, t);
    if (Array.isArray(a)) return a.map((v: Tree, i) => blendTree(v, (b as readonly Tree[])[i], t));
    const x = a as { readonly [key: string]: Tree };
    const y = b as { readonly [key: string]: Tree };
    const out: Record<string, Tree> = {};
    for (const key of Object.keys(x)) out[key] = blendTree(x[key], y[key], t);
    return out;
}

/** Every colour of the palettes blended `t` of the way from `a` to `b`. */
export const blendPalette = (a: ZonePalette, b: ZonePalette, t: number): ZonePalette =>
    blendTree(a as unknown as Tree, b as unknown as Tree, t) as unknown as ZonePalette;

/** Blended palettes by `from` zone and step, so a fade returns the same objects every run. */
const blended = new Map<number, ZonePalette>();

/**
 * The palette drawn at `distanceUnits`: the zone's own once its fade is over, else the previous
 * zone's blended toward it in `ZONE_FADE_STEPS` steps. The same distance always returns the same
 * object, and a fade returns at most `ZONE_FADE_STEPS + 1` of them, so caches keyed by the
 * palette object rebuild only when the step changes.
 */
export function zonePaletteAt(distanceUnits: number): ZonePalette {
    const index = zoneIndexAt(distanceUnits);
    const step = Math.floor(zoneBlendAt(distanceUnits) * ZONE_FADE_STEPS);
    const to = index % ZONES.length;
    if (step >= ZONE_FADE_STEPS) return ZONES[to].palette;
    const from = (index - 1) % ZONES.length;
    if (step === 0) return ZONES[from].palette;
    const key = from * (ZONE_FADE_STEPS + 1) + step;
    let palette = blended.get(key);
    if (!palette) {
        palette = blendPalette(ZONES[from].palette, ZONES[to].palette, step / ZONE_FADE_STEPS);
        blended.set(key, palette);
    }
    return palette;
}
