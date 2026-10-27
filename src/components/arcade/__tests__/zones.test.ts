import { describe, expect, it } from 'vitest';
import {
    blendColour,
    blendPalette,
    parseColour,
    runSecondsAt,
    ZONE_FADE_SECONDS,
    ZONE_FADE_STEPS,
    ZONE_METERS,
    zoneBanner,
    zoneBlendAt,
    zoneIndexAt,
    zonePaletteAt,
    ZONES,
} from '../zones';
import { nextSpeed } from '../../../utils/arcade/engine';
import { METERS_PER_UNIT, START_SPEED, STEP_SECONDS } from '../../../utils/arcade/constants';
import { SUNSET_SCENE } from '../../theme/synthwaveScene';

/** Distance in units at `meters`. */
const at = (meters: number) => meters / METERS_PER_UNIT;

/** The distance `seconds` of running after `fromUnits`, stepped the way the engine steps. */
function runFor(fromUnits: number, seconds: number): number {
    let d = 0;
    let speed = START_SPEED;
    while (d < fromUnits) {
        d += speed * STEP_SECONDS;
        speed = nextSpeed(speed, STEP_SECONDS);
    }
    for (let t = 0; t < seconds - 1e-9; t += STEP_SECONDS) {
        d += speed * STEP_SECONDS;
        speed = nextSpeed(speed, STEP_SECONDS);
    }
    return d;
}

describe('zones', () => {
    it('changes zone every ZONE_METERS and cycles through the zones', () => {
        expect(zoneIndexAt(0)).toBe(0);
        expect(zoneIndexAt(at(ZONE_METERS - 1))).toBe(0);
        expect(zoneIndexAt(at(ZONE_METERS))).toBe(1);
        expect(zoneIndexAt(at(4 * ZONE_METERS + 10))).toBe(4);
        expect(ZONES.map((z) => z.name)).toEqual(['Sunset', 'Neon Night', 'Red Alert', 'Ice']);
        expect(zoneBanner(1)).toBe('ZONE 2 · NEON NIGHT');
        expect(zoneBanner(4)).toBe('ZONE 5 · SUNSET');
    });

    it('draws zone 1 in the page background colours, unchanged', () => {
        expect(zonePaletteAt(0).scene).toBe(SUNSET_SCENE);
        expect(zonePaletteAt(at(ZONE_METERS - 1))).toBe(ZONES[0].palette);
        expect(zoneBlendAt(at(500))).toBe(1);
    });

    it('times the ramp the way the engine steps it', () => {
        for (const meters of [0, 300, 1000, 2500, 6000]) {
            const from = at(meters);
            const after = runFor(from, ZONE_FADE_SECONDS);
            expect(runSecondsAt(after) - runSecondsAt(from)).toBeCloseTo(ZONE_FADE_SECONDS, 1);
        }
    });

    it('fades over ZONE_FADE_SECONDS of running from the boundary', () => {
        const boundary = at(ZONE_METERS);
        expect(zoneBlendAt(boundary)).toBe(0);
        expect(zonePaletteAt(boundary)).toBe(ZONES[0].palette);
        const mid = runFor(boundary, ZONE_FADE_SECONDS / 2);
        expect(zoneBlendAt(mid)).toBeCloseTo(0.5, 1);
        const midPalette = zonePaletteAt(mid);
        expect(midPalette).not.toBe(ZONES[0].palette);
        expect(midPalette).not.toBe(ZONES[1].palette);
        const after = runFor(boundary, ZONE_FADE_SECONDS + 0.05);
        expect(zoneBlendAt(after)).toBe(1);
        expect(zonePaletteAt(after)).toBe(ZONES[1].palette);
    });

    it('blends from the last zone back into the first when it cycles', () => {
        const boundary = at(4 * ZONE_METERS);
        expect(zonePaletteAt(boundary)).toBe(ZONES[3].palette);
        const mid = zonePaletteAt(runFor(boundary, ZONE_FADE_SECONDS / 2));
        const half = blendPalette(ZONES[3].palette, ZONES[0].palette, 0.5);
        expect(parseColour(mid.scene.sky[0])).toEqual(
            parseColour(half.scene.sky[0]).map((v, i) =>
                // One step of quantisation either side.
                expect.closeTo(v, i < 3 ? 255 / ZONE_FADE_STEPS : 1 / ZONE_FADE_STEPS)
            )
        );
        expect(zonePaletteAt(runFor(boundary, ZONE_FADE_SECONDS + 0.05))).toBe(ZONES[0].palette);
    });

    it('returns the same palette object for every distance in one fade step', () => {
        const boundary = at(2 * ZONE_METERS);
        const seen = new Set();
        for (let d = boundary; d < runFor(boundary, ZONE_FADE_SECONDS + 0.1); d += 0.5) {
            seen.add(zonePaletteAt(d));
        }
        expect(seen.size).toBeLessThanOrEqual(ZONE_FADE_STEPS + 1);
        const d = runFor(boundary, 0.7);
        expect(zonePaletteAt(d)).toBe(zonePaletteAt(d));
    });

    it('blends colours per RGBA channel', () => {
        expect(blendColour('#000000', 'rgba(200, 100, 50, 0.5)', 0.5)).toBe(
            'rgba(100, 50, 25, 0.75)'
        );
        expect(blendColour('180, 80, 255', '40, 200, 255', 0.25)).toBe('145, 110, 255');
        expect(blendColour('#ffccaa', '#ffccaa', 0.3)).toBe('rgba(255, 204, 170, 1)');
    });

    it('gives every zone a palette of the same shape with valid colours', () => {
        const leaves = (v: unknown, path = ''): [string, string][] =>
            typeof v === 'string'
                ? [[path, v]]
                : Object.entries(v as object).flatMap(([k, c]) => leaves(c, `${path}.${k}`));
        const shape = leaves(ZONES[0].palette).map(([p]) => p);
        for (const zone of ZONES) {
            const l = leaves(zone.palette);
            expect(l.map(([p]) => p)).toEqual(shape);
            for (const [, colour] of l) {
                const rgba = parseColour(colour);
                expect(rgba.every((c) => Number.isFinite(c))).toBe(true);
                expect(Math.max(...rgba.slice(0, 3))).toBeLessThanOrEqual(255);
                expect(rgba[3]).toBeLessThanOrEqual(1);
            }
        }
    });
});
