import { describe, expect, it } from 'vitest';
import {
    DUCK_MAX_SINK_SHARE,
    DUCK_SINK_SHARE,
    duckDepth,
    HIGH_GAP,
    MIN_DUCK_DROP,
} from '../barriers';
import { blocks } from '../../../utils/arcade/collision';
import { SHIP_RIDE_HEIGHT } from '../../../utils/arcade/constants';
import { DUCK_SQUASH, NEON_BOTTOM, NEON_TOP, SHIP_UNIT } from '../flightRenderer';

/** Visible extents above and below the ship's centre at the bottom of a duck, in lane widths at
 *  the player row: the neon fighter's squashed outline, and synthetic level frames of sprites of
 *  a few builds. */
const SHIPS = {
    neon: {
        top: -NEON_TOP * SHIP_UNIT * DUCK_SQUASH,
        bottom: NEON_BOTTOM * SHIP_UNIT * DUCK_SQUASH,
    },
    flat: { top: 0.07, bottom: 0.06 },
    typical: { top: 0.12, bottom: 0.085 },
    tall: { top: 0.15, bottom: 0.11 },
};

/** Ships too tall to fit under the high block at the usual sink share: the two real sprites are
 *  among the tallest level frames (their height runs to 0.42). `GIANT` would have to sink more
 *  than `DUCK_MAX_SINK_SHARE` of itself to fit. */
const OVERSIZE = {
    gelecek13: { top: 0.149, bottom: 0.27 },
    terran7: { top: 0.187, bottom: 0.237 },
    synthetic: { top: 0.2, bottom: 0.2 },
};
const GIANT = { top: 0.4, bottom: 0.3 };

const ALL = { ...SHIPS, ...OVERSIZE };

/** The ship's centre over the track at the bottom of a duck. */
const duckedCentre = (top: number, bottom: number) => SHIP_RIDE_HEIGHT - duckDepth(top, bottom);

describe('duckDepth', () => {
    for (const [name, { top, bottom }] of Object.entries(ALL)) {
        it(`skims the ${name} ship along the track, its belly sunk and its top under the bar`, () => {
            const centre = duckedCentre(top, bottom);
            const sunk = bottom - centre;
            expect(sunk).toBeGreaterThan(0);
            expect(sunk / (top + bottom)).toBeGreaterThanOrEqual(DUCK_SINK_SHARE - 1e-9);
            expect(sunk / (top + bottom)).toBeLessThanOrEqual(DUCK_MAX_SINK_SHARE + 1e-9);
            expect(centre + top).toBeLessThan(HIGH_GAP);
        });

        it(`drops the ${name} ship clearly from its ride height`, () => {
            expect(duckDepth(top, bottom)).toBeGreaterThanOrEqual(MIN_DUCK_DROP);
        });
    }

    it('sinks a ship that fits under the bar by the usual share of its height', () => {
        const { top, bottom } = SHIPS.typical;
        const sunk = bottom - duckedCentre(top, bottom);
        expect(sunk / (top + bottom)).toBeCloseTo(DUCK_SINK_SHARE, 9);
    });

    it('sinks a ship taller than the gap deeper, just enough to fit under the bar', () => {
        const { top, bottom } = OVERSIZE.terran7;
        const sunk = bottom - duckedCentre(top, bottom);
        expect(sunk / (top + bottom)).toBeGreaterThan(DUCK_SINK_SHARE);
        expect(duckedCentre(top, bottom) + top).toBeGreaterThan(HIGH_GAP - 0.05);
    });

    it('caps the sink for a ship too tall to fit, leaving it over the bar', () => {
        const { top, bottom } = GIANT;
        const centre = duckedCentre(top, bottom);
        expect((bottom - centre) / (top + bottom)).toBeCloseTo(DUCK_MAX_SINK_SHARE, 9);
        expect(centre + top).toBeGreaterThan(HIGH_GAP);
    });

    it('leaves a running ship visibly blocked by the bar', () => {
        for (const { top } of Object.values(SHIPS)) {
            if (top < 0.1) continue;
            expect(SHIP_RIDE_HEIGHT + top).toBeGreaterThan(HIGH_GAP);
        }
        expect(blocks('high', 'run')).toBe(true);
        expect(blocks('high', 'duck')).toBe(false);
    });
});
