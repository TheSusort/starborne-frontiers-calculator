import { describe, expect, it } from 'vitest';
import {
    advanceScrape,
    contactStrength,
    createScrapeFx,
    liveSparks,
    SCRAPE_SPARKS,
    ScrapeContact,
    SPARK_RATE,
} from '../scrapeFx';

/** A deterministic `random`. */
const lcg = (seed = 1) => {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
};

const FRAME = 1 / 60;
const U = 200;
const contact = (sink: number): ScrapeContact => ({ x: 400, y: 600, halfWidth: 60, u: U, sink });
const pools = (fx: ReturnType<typeof createScrapeFx>) => [
    fx.px,
    fx.py,
    fx.vx,
    fx.vy,
    fx.age,
    fx.ttl,
    fx.colour,
];

describe('scrape contact', () => {
    it('is nothing until the belly is below the track, full a little below it', () => {
        expect(contactStrength(null)).toBe(0);
        expect(contactStrength(contact(0))).toBe(0);
        expect(contactStrength(contact(-3))).toBe(0);
        expect(contactStrength(contact(0.01 * U))).toBeCloseTo(0.5, 9);
        expect(contactStrength(contact(0.2 * U))).toBe(1);
    });
});

describe('scrape sparks', () => {
    it('throws no sparks while the hull is clear of the track', () => {
        const fx = createScrapeFx();
        const random = lcg();
        for (let i = 0; i < 60; i++) advanceScrape(fx, FRAME, null, random);
        for (let i = 0; i < 60; i++) advanceScrape(fx, FRAME, contact(0), random);
        expect(liveSparks(fx)).toBe(0);
        expect(fx.glow).toBe(0);
    });

    it('throws sparks at the spark rate while sunk, in place in the pool', () => {
        const fx = createScrapeFx();
        const arrays = pools(fx);
        const random = lcg(5);
        const c = contact(0.1 * U);
        for (let i = 0; i < 6; i++) advanceScrape(fx, FRAME, c, random);
        const spawned = Math.floor(SPARK_RATE * 6 * FRAME + 1e-6);
        expect(liveSparks(fx)).toBeGreaterThanOrEqual(spawned - 1);
        expect(liveSparks(fx)).toBeLessThanOrEqual(spawned);
        expect(fx.glow).toBeGreaterThan(0.5);
        for (let i = 0; i < 600; i++) advanceScrape(fx, FRAME, c, random);
        expect(liveSparks(fx)).toBeLessThanOrEqual(SCRAPE_SPARKS);
        expect(pools(fx).every((a, i) => a === arrays[i])).toBe(true);
    });

    it('starts sparks on the contact line, thrown down the screen and out to the sides', () => {
        const fx = createScrapeFx();
        const c = contact(0.1 * U);
        advanceScrape(fx, 0.2, c, lcg(9));
        let left = 0;
        let right = 0;
        for (let i = 0; i < SCRAPE_SPARKS; i++) {
            if (fx.age[i] >= fx.ttl[i]) continue;
            expect(Math.abs(fx.px[i] - c.x)).toBeLessThanOrEqual(c.halfWidth);
            expect(fx.py[i]).toBe(c.y);
            expect(Math.sign(fx.vx[i])).toBe(Math.sign(fx.px[i] - c.x) || Math.sign(fx.vx[i]));
            if (fx.vx[i] < 0) left++;
            else right++;
        }
        expect(left).toBeGreaterThan(0);
        expect(right).toBeGreaterThan(0);
    });

    it('lets sparks fall and burn out once the hull leaves the track', () => {
        const fx = createScrapeFx();
        const random = lcg(3);
        for (let i = 0; i < 20; i++) advanceScrape(fx, FRAME, contact(0.1 * U), random);
        const i0 = fx.next === 0 ? SCRAPE_SPARKS - 1 : fx.next - 1;
        const vy = fx.vy[i0];
        advanceScrape(fx, FRAME, null, random);
        expect(fx.vy[i0]).toBeGreaterThan(vy * Math.exp(-3 * FRAME));
        for (let i = 0; i < 60; i++) advanceScrape(fx, FRAME, null, random);
        expect(liveSparks(fx)).toBe(0);
        expect(fx.glow).toBeLessThan(0.01);
    });

    it('holds still without game time', () => {
        const fx = createScrapeFx();
        const random = lcg(2);
        advanceScrape(fx, FRAME, contact(0.1 * U), random);
        const before = pools(fx).map((a) => Array.from(a));
        const glow = fx.glow;
        advanceScrape(fx, 0, contact(0.1 * U), random);
        advanceScrape(fx, Number.NaN, contact(0.1 * U), random);
        expect(pools(fx).map((a) => Array.from(a))).toEqual(before);
        expect(fx.glow).toBe(glow);
    });
});
