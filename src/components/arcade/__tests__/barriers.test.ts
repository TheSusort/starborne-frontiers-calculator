import { describe, expect, it } from 'vitest';
import { duckDepth, HIGH_GAP } from '../barriers';
import { blocks } from '../../../utils/arcade/collision';
import { SHIP_RIDE_HEIGHT } from '../../../utils/arcade/constants';
import { NEON_BOTTOM, NEON_TOP, SHIP_UNIT } from '../flightRenderer';

/** Visible extents above and below the ship's centre, in lane widths at the player row: the
 *  neon fighter's outline, and synthetic level frames of sprites of a few builds. */
const SHIPS = {
    neon: { top: -NEON_TOP * SHIP_UNIT, bottom: NEON_BOTTOM * SHIP_UNIT },
    flat: { top: 0.07, bottom: 0.06 },
    typical: { top: 0.12, bottom: 0.085 },
    tall: { top: 0.15, bottom: 0.11 },
};

/** Ships whose visible height (top plus bottom) exceeds the gap under the high block less the
 *  track clearance; the two real sprites are among the tallest level frames (their sum runs to
 *  0.42). */
const OVERSIZE = {
    gelecek13: { top: 0.149, bottom: 0.27 },
    terran7: { top: 0.187, bottom: 0.237 },
    synthetic: { top: 0.2, bottom: 0.2 },
};

describe('duckDepth', () => {
    for (const [name, { top, bottom }] of Object.entries(SHIPS)) {
        it(`at the bottom of a duck, keeps the ${name} ship under the high block and over the track`, () => {
            const centre = SHIP_RIDE_HEIGHT - duckDepth(bottom);
            expect(centre + top).toBeLessThan(HIGH_GAP);
            expect(centre - bottom).toBeGreaterThan(0.02);
        });
    }

    it('dips as deep as the track allows, deeper than the bar alone needs', () => {
        const { top, bottom } = SHIPS.flat;
        const centre = SHIP_RIDE_HEIGHT - duckDepth(bottom);
        expect(centre - bottom).toBeLessThan(0.05);
        expect(centre + top).toBeLessThan(HIGH_GAP - 0.1);
    });

    for (const [name, { top, bottom }] of Object.entries(OVERSIZE)) {
        it(`keeps the oversize ${name} ship over the track, the bar not cleared`, () => {
            expect(top + bottom).toBeGreaterThan(HIGH_GAP - 0.03);
            const centre = SHIP_RIDE_HEIGHT - duckDepth(bottom);
            // It dips no lower than the clearance allows, and not at all if it rides lower.
            expect(centre).toBeLessThanOrEqual(SHIP_RIDE_HEIGHT);
            expect(centre - bottom).toBeGreaterThanOrEqual(
                Math.min(0.03, SHIP_RIDE_HEIGHT - bottom) - 1e-9
            );
            expect(centre + top).toBeGreaterThan(HIGH_GAP);
        });
    }

    it('leaves a running ship visibly blocked by the bar', () => {
        for (const { top } of Object.values(SHIPS)) {
            if (top < 0.1) continue;
            expect(SHIP_RIDE_HEIGHT + top).toBeGreaterThan(HIGH_GAP);
        }
        expect(blocks('high', 'run')).toBe(true);
        expect(blocks('high', 'duck')).toBe(false);
    });
});
