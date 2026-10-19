import { describe, expect, it } from 'vitest';
import {
    advanceExplosion,
    createExplosion,
    EMBERS,
    explosionActive,
    EXPLOSION_SECONDS,
    liveParticles,
    SLOW_MOTION_SECONDS,
    slowMotion,
    SPARKS,
    startExplosion,
} from '../explosion';
import {
    canSkipDeath,
    DEATH_SKIP_GRACE,
    DEATH_TIMING,
    deathStage,
    REDUCED_DEATH_TIMING,
} from '../deathSequence';

/** A deterministic `random`. */
const lcg = (seed = 1) => {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
};

const FRAME = 1 / 60;
const pools = (e: ReturnType<typeof createExplosion>) => [
    e.px,
    e.py,
    e.vx,
    e.vy,
    e.age,
    e.ttl,
    e.colour,
];

describe('explosion particle pool', () => {
    it('is idle until started', () => {
        const e = createExplosion();
        expect(explosionActive(e)).toBe(false);
        advanceExplosion(e, FRAME);
        expect(e.elapsed).toBe(0);
        expect(liveParticles(e)).toBe(0);
    });

    it('fills the whole pool in place at the start', () => {
        const e = createExplosion();
        const arrays = pools(e);
        startExplosion(e, 100, 200, 50, 0, false, lcg());
        expect(liveParticles(e)).toBe(SPARKS + EMBERS);
        expect(pools(e).every((a, i) => a === arrays[i])).toBe(true);
        expect(explosionActive(e)).toBe(true);
    });

    it('burns out within EXPLOSION_SECONDS, sparks before embers, without growing', () => {
        const e = createExplosion();
        const arrays = pools(e);
        startExplosion(e, 0, 0, 40, 0, false, lcg(7));
        let sparksOutAt = -1;
        for (let t = 0; t < EXPLOSION_SECONDS + 0.2; t += FRAME) {
            advanceExplosion(e, FRAME);
            let sparks = 0;
            for (let i = 0; i < SPARKS; i++) if (e.age[i] < e.ttl[i]) sparks++;
            if (sparks === 0 && sparksOutAt < 0) sparksOutAt = e.elapsed;
        }
        expect(liveParticles(e)).toBe(0);
        expect(sparksOutAt).toBeGreaterThan(0);
        expect(sparksOutAt).toBeLessThan(1);
        expect(explosionActive(e)).toBe(false);
        expect(pools(e).every((a, i) => a === arrays[i])).toBe(true);
    });

    it('slows rising particles and pulls the burst down over time', () => {
        const e = createExplosion();
        startExplosion(e, 0, 0, 40, 0, false, lcg(3));
        const before = Array.from(e.vy);
        for (let i = 0; i < 20; i++) advanceExplosion(e, FRAME);
        before.forEach((vy, i) => {
            if (vy < 0) expect(e.vy[i]).toBeGreaterThan(vy);
        });
        const meanY = () => e.py.reduce((a, b) => a + b, 0) / e.py.length;
        const early = meanY();
        for (let i = 0; i < 40; i++) advanceExplosion(e, FRAME);
        expect(meanY()).toBeGreaterThan(early);
    });

    it('can be set off again, refilling the same pool', () => {
        const e = createExplosion();
        startExplosion(e, 0, 0, 40, 0, false, lcg(1));
        for (let i = 0; i < 200; i++) advanceExplosion(e, FRAME);
        startExplosion(e, 0, 0, 40, 0, false, lcg(2));
        expect(e.elapsed).toBe(0);
        expect(liveParticles(e)).toBe(SPARKS + EMBERS);
    });

    it('has no particles under reduced motion, only a short flash', () => {
        const e = createExplosion();
        startExplosion(e, 0, 0, 40, 0, true, lcg());
        expect(liveParticles(e)).toBe(0);
        expect(explosionActive(e)).toBe(true);
        for (let i = 0; i < 60; i++) advanceExplosion(e, FRAME);
        expect(explosionActive(e)).toBe(false);
    });
});

describe('slow motion', () => {
    it('eases the world to a stop', () => {
        expect(slowMotion(0, false)).toBeGreaterThan(0);
        expect(slowMotion(0, false)).toBeLessThan(1);
        expect(slowMotion(0.3, false)).toBeLessThan(slowMotion(0.1, false));
        expect(slowMotion(SLOW_MOTION_SECONDS, false)).toBe(0);
        expect(slowMotion(5, false)).toBe(0);
    });

    it('stops at once under reduced motion', () => {
        expect(slowMotion(0, true)).toBe(0);
    });
});

describe('death sequence', () => {
    it('runs explosion, then YOU DIED, then the panel', () => {
        expect(deathStage(0, false)).toBe('explosion');
        expect(deathStage(DEATH_TIMING.youDiedAt - 0.01, false)).toBe('explosion');
        expect(deathStage(DEATH_TIMING.youDiedAt, false)).toBe('you-died');
        expect(deathStage(DEATH_TIMING.panelAt - 0.01, false)).toBe('you-died');
        expect(deathStage(DEATH_TIMING.panelAt, false)).toBe('panel');
    });

    it('shows YOU DIED before the explosion is over and holds it for a while', () => {
        expect(DEATH_TIMING.youDiedAt).toBeLessThan(EXPLOSION_SECONDS);
        expect(DEATH_TIMING.panelAt - DEATH_TIMING.youDiedAt).toBeGreaterThanOrEqual(3);
    });

    it('comes sooner under reduced motion', () => {
        expect(REDUCED_DEATH_TIMING.youDiedAt).toBeLessThan(DEATH_TIMING.youDiedAt);
        expect(deathStage(REDUCED_DEATH_TIMING.youDiedAt, true)).toBe('you-died');
        expect(deathStage(REDUCED_DEATH_TIMING.panelAt, true)).toBe('panel');
    });

    it('ignores skips in the first moments after the crash', () => {
        expect(canSkipDeath(0)).toBe(false);
        expect(canSkipDeath(DEATH_SKIP_GRACE - 0.01)).toBe(false);
        expect(canSkipDeath(DEATH_SKIP_GRACE)).toBe(true);
        expect(DEATH_SKIP_GRACE).toBeLessThan(DEATH_TIMING.youDiedAt);
    });
});
