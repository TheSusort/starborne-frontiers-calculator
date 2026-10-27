import { describe, it, expect } from 'vitest';
import { createGame } from '../engine';
import { spawnRow } from '../spawner';
import { SPAWN_Z } from '../constants';

function rows(seed: number, count: number, distance: number) {
    const g = createGame(seed);
    g.distance = distance;
    return Array.from({ length: count }, () => spawnRow(g, SPAWN_Z));
}

describe('spawnRow', () => {
    it('is deterministic for a seed', () => {
        const shape = (seed: number) =>
            rows(seed, 50, 5000).map((r) => [
                r.obstacles.map((o) => `${o.kind}@${o.lane}`).join(','),
                r.pickups.map((p) => `${p.kind}@${p.lane}`).join(','),
            ]);
        expect(shape(42)).toEqual(shape(42));
        expect(shape(42)).not.toEqual(shape(43));
    });

    it('always leaves at least one lane free of obstacles', () => {
        for (const r of rows(3, 500, 100000)) {
            const lanes = new Set(r.obstacles.map((o) => o.lane));
            expect(lanes.size).toBe(r.obstacles.length);
            expect(lanes.size).toBeLessThanOrEqual(2);
        }
    });

    it('never puts a pickup in a lane that has an obstacle in the same row', () => {
        for (const r of rows(5, 500, 100000)) {
            const blocked = new Set(r.obstacles.map((o) => o.lane));
            for (const p of r.pickups) expect(blocked.has(p.lane)).toBe(false);
        }
    });

    it('starts with single obstacles and introduces doubles as distance grows', () => {
        const early = rows(9, 200, 0);
        const late = rows(9, 200, 100000);
        expect(early.every((r) => r.obstacles.length === 1)).toBe(true);
        expect(late.some((r) => r.obstacles.length === 2)).toBe(true);
    });

    it('produces every obstacle kind and both power-ups over a long run', () => {
        const all = rows(11, 2000, 100000);
        const kinds = new Set(all.flatMap((r) => r.obstacles.map((o) => o.kind)));
        const pickups = new Set(all.flatMap((r) => r.pickups.map((p) => p.kind)));
        expect([...kinds].sort()).toEqual(['high', 'low', 'wall']);
        expect([...pickups].sort()).toEqual(['credit', 'magnet', 'shield']);
    });

    it('gives every pickup of a trail one trailId and registers the trail', () => {
        const g = createGame(13);
        g.distance = 5000;
        let trails = 0;
        for (let i = 0; i < 200; i++) {
            const { pickups } = spawnRow(g, SPAWN_Z);
            if (pickups.length === 0) continue;
            trails++;
            const ids = new Set(pickups.map((p) => p.trailId));
            expect(ids.size).toBe(1);
            expect(g.trails[pickups[0].trailId]).toEqual({
                pending: pickups.length,
                missed: false,
            });
        }
        expect(trails).toBeGreaterThan(50);
    });
});
