import { describe, expect, it } from 'vitest';
import {
    beginPulls,
    createPullMemory,
    CreditPull,
    endPulls,
    FLICKER_MAX_HZ,
    MAGNET_EXPIRY_SECONDS,
    MAGNET_PULL_Z,
    magnetVisibility,
    nearestPulled,
    pullCredit,
    releasePull,
    RELEASE_SECONDS,
    rememberPull,
    restingPull,
} from '../magnetFx';
import { canCollect } from '../../../utils/arcade/collision';
import { PICKUP_HEIGHT } from '../../../utils/arcade/constants';
import type { Lane, Pickup, PickupKind, PlayerState } from '../../../utils/arcade/types';

const credit = (lane: number, z: number, kind: PickupKind = 'credit'): Pickup => ({
    id: 1,
    kind,
    lane: lane as Lane,
    z,
    resolved: false,
    collected: false,
});

const player = (lane: number, magnetTime = 5): PlayerState => ({
    lane: lane as Lane,
    action: 'run',
    actionTime: 0,
    shield: false,
    magnetTime,
});

const out = (): CreditPull => ({ laneX: 0, height: 0, scale: 0, glow: 0 });

/** The drawn ship: mid-slide between lanes, raised by a jump. */
const SHIP_X = 0.3;
const SHIP_HEIGHT = 0.7;

describe('pullCredit', () => {
    it('pulls an own-lane credit in the window toward the drawn ship', () => {
        const o = out();
        expect(pullCredit(o, credit(1, MAGNET_PULL_Z / 2), player(1), SHIP_X, SHIP_HEIGHT)).toBe(
            true
        );
        expect(o.laneX).toBeGreaterThan(0);
        expect(o.laneX).toBeLessThan(SHIP_X);
        expect(o.height).toBeGreaterThan(PICKUP_HEIGHT);
        expect(o.height).toBeLessThan(SHIP_HEIGHT);
        expect(o.scale).toBeLessThan(1);
    });

    it('pulls an adjacent-lane credit, across its whole lane gap by z = 0', () => {
        const o = out();
        expect(pullCredit(o, credit(0, MAGNET_PULL_Z / 2), player(1), SHIP_X, SHIP_HEIGHT)).toBe(
            true
        );
        expect(o.laneX).toBeGreaterThan(-1);
        expect(o.laneX).toBeLessThan(SHIP_X);
        pullCredit(o, credit(0, 0), player(1), SHIP_X, SHIP_HEIGHT);
        expect(o.laneX).toBe(SHIP_X);
    });

    it('leaves a credit two lanes away on its lane', () => {
        const o = out();
        expect(pullCredit(o, credit(2, 3), player(0), -1, SHIP_HEIGHT)).toBe(false);
        expect(o).toEqual({ laneX: 1, height: PICKUP_HEIGHT, scale: 1, glow: 0 });
    });

    it('pulls exactly the credits the engine will collect', () => {
        const o = out();
        for (const lane of [0, 1, 2])
            for (const at of [0, 1, 2])
                for (const magnetTime of [0, 4])
                    for (const kind of ['credit', 'shield', 'magnet'] as const) {
                        const p = credit(lane, 2, kind);
                        const pl = player(at, magnetTime);
                        const pulled = pullCredit(o, p, pl, at - 1, SHIP_HEIGHT);
                        expect(pulled).toBe(
                            kind === 'credit' && magnetTime > 0 && canCollect(p, pl)
                        );
                    }
    });

    it('does not pull without an active magnet', () => {
        const o = out();
        expect(pullCredit(o, credit(1, 2), player(1, 0), SHIP_X, SHIP_HEIGHT)).toBe(false);
        expect(o).toEqual({ laneX: 0, height: PICKUP_HEIGHT, scale: 1, glow: 0 });
    });

    it('does not pull outside the window: too far, or past the ship uncollected', () => {
        const o = out();
        for (const z of [MAGNET_PULL_Z + 0.01, 40, -0.01, -3]) {
            expect(pullCredit(o, credit(0, z), player(1), SHIP_X, SHIP_HEIGHT)).toBe(false);
            expect(o).toEqual({ laneX: -1, height: PICKUP_HEIGHT, scale: 1, glow: 0 });
        }
    });

    it('starts where the credit is drawn unpulled at the window edge', () => {
        const o = out();
        pullCredit(o, credit(0, MAGNET_PULL_Z), player(1), SHIP_X, SHIP_HEIGHT);
        expect(o.laneX).toBeCloseTo(-1, 9);
        expect(o.height).toBeCloseTo(PICKUP_HEIGHT, 9);
        expect(o.scale).toBeCloseTo(1, 9);
        expect(o.glow).toBeCloseTo(0, 9);
    });

    it('lands on the ship at z = 0, shrunk and at its brightest', () => {
        const o = out();
        pullCredit(o, credit(2, 0), player(1), SHIP_X, SHIP_HEIGHT);
        expect(o.laneX).toBe(SHIP_X);
        expect(o.height).toBe(SHIP_HEIGHT);
        expect(o.scale).toBeLessThan(0.3);
        expect(o.glow).toBe(1);
    });

    it('speeds up as it closes in', () => {
        const o = out();
        const xs: number[] = [];
        for (let z = MAGNET_PULL_Z; z >= 0; z -= MAGNET_PULL_Z / 8) {
            pullCredit(o, credit(0, z), player(1), SHIP_X, SHIP_HEIGHT);
            xs.push(o.laneX);
        }
        const steps = xs.slice(1).map((x, i) => x - xs[i]);
        for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    });
});

describe('nearestPulled', () => {
    it('keeps the nearest pulled credits, nearest first, up to the cap', () => {
        const pickups = [9, 1, 5, 3, 7, 2, 0.5].map((z, i) => ({ ...credit(i % 3, z), id: i }));
        pickups.push({ ...credit(1, 4, 'shield'), id: 20 });
        const scratch: Pickup[] = [];
        const n = nearestPulled(pickups, player(1), 4, scratch);
        expect(n).toBe(4);
        expect(scratch.slice(0, n).map((p) => p.z)).toEqual([0.5, 1, 2, 3]);
    });

    it('skips credits the magnet will not collect, and collected ones', () => {
        const pickups = [credit(2, 1), credit(1, 50), { ...credit(1, 2), collected: true }];
        const scratch: Pickup[] = [];
        expect(nearestPulled(pickups, player(0), 4, scratch)).toBe(0);
    });
});

describe('magnetVisibility', () => {
    it('is full until the last seconds and off once the magnet has run out', () => {
        for (const time of [0, 0.37, 5.1]) {
            expect(magnetVisibility(8, time, false)).toBe(1);
            expect(magnetVisibility(MAGNET_EXPIRY_SECONDS, time, false)).toBe(1);
            expect(magnetVisibility(0, time, false)).toBe(0);
        }
    });

    it('flickers through the last seconds', () => {
        const seen = new Set<number>();
        for (let time = 0; time < 1; time += 0.01) seen.add(magnetVisibility(0.8, time, false));
        expect(Math.max(...seen)).toBe(1);
        expect(Math.min(...seen)).toBeLessThan(0.5);
    });

    it('never flickers faster than the strobing limit', () => {
        expect(FLICKER_MAX_HZ).toBeLessThanOrEqual(8);
        for (const left of [1.4, 0.7, 0.01]) {
            let flips = 0;
            let was = magnetVisibility(left, 0, false);
            for (let time = 0.001; time <= 1; time += 0.001) {
                const now = magnetVisibility(left, time, false);
                if (now !== was) flips++;
                was = now;
            }
            // Each flicker cycle flips twice.
            expect(flips / 2).toBeLessThanOrEqual(FLICKER_MAX_HZ + 1);
        }
    });

    it('fades steadily under reduced motion, whatever the time', () => {
        const a = magnetVisibility(1.2, 0, true);
        expect(magnetVisibility(1.2, 0.73, true)).toBe(a);
        expect(magnetVisibility(0.3, 0, true)).toBeLessThan(a);
        expect(a).toBeLessThan(1);
    });
});

describe('releasing a pulled credit', () => {
    const pulled = (z: number) => {
        const pk = credit(2, z);
        const pull = out();
        pullCredit(pull, pk, player(1), 0, 0.25);
        return { pk, pull };
    };

    it('eases back to its lane over RELEASE_SECONDS instead of snapping', () => {
        const m = createPullMemory();
        const { pk, pull } = pulled(4);
        beginPulls(m);
        rememberPull(m, pk, pull, 0.66, true, 1);
        endPulls(m);
        const drawn = { ...pull };

        const xs: number[] = [];
        for (const dt of [0, 0.03, 0.06, 0.09, 0.12, 0.15]) {
            beginPulls(m);
            const now = out();
            restingPull(now, pk);
            const rec = releasePull(m, pk, now, 10 + dt);
            endPulls(m);
            xs.push(now.laneX);
            if (dt === 0) {
                // The first released frame is where it was last drawn, and fully visible.
                expect(now.laneX).toBeCloseTo(drawn.laneX);
                expect(now.height).toBeCloseTo(drawn.height);
                expect(rec?.fade).toBe(1);
            }
            if (dt === RELEASE_SECONDS) expect(rec).toBeNull();
        }
        const lane = pk.lane - 1;
        for (let i = 1; i < xs.length; i++) {
            expect(Math.abs(xs[i] - lane)).toBeLessThan(Math.abs(xs[i - 1] - lane) + 1e-9);
        }
        expect(xs[xs.length - 1]).toBeCloseTo(lane);
        expect(xs[1]).not.toBeCloseTo(lane);
    });

    it('fades the beam out as it eases', () => {
        const m = createPullMemory();
        const { pk, pull } = pulled(4);
        beginPulls(m);
        rememberPull(m, pk, pull, 0.66, true, 0.8);
        endPulls(m);
        const fades = [0, 0.05, 0.1].map((dt) => {
            beginPulls(m);
            const now = out();
            restingPull(now, pk);
            const rec = releasePull(m, pk, now, 3 + dt);
            endPulls(m);
            return rec?.fade ?? -1;
        });
        expect(fades[0]).toBe(1);
        expect(fades[1]).toBeLessThan(fades[0]);
        expect(fades[2]).toBeLessThan(fades[1]);
        expect(fades[2]).toBeGreaterThan(0);
    });

    it('ignores a pickup that was never pulled, and forgets one that is gone', () => {
        const m = createPullMemory();
        const pk = credit(0, 5);
        const now = out();
        restingPull(now, pk);
        expect(releasePull(m, pk, now, 1)).toBeNull();
        expect(now.laneX).toBe(-1);

        const { pk: gone, pull } = pulled(3);
        beginPulls(m);
        rememberPull(m, gone, pull, 0.7, false, 1);
        endPulls(m);
        expect(m.count).toBe(1);
        beginPulls(m);
        endPulls(m);
        expect(m.count).toBe(0);
    });
});
