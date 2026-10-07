/**
 * Owner ruling R113: an Echoing Burst whose duration a cut takes to 0 detonates there and then, as
 * a Bomb cut to 0 does — Warpstrike's single random cut (`accumulatorDurationCutCandidates`) and
 * Heliodor's / Pestilence's "all active debuffs" shorten (`reduceAccumulatorsOnVictim`). The burst
 * pays `accumulated × pct/100` (`accumulatorBurstDamage`, the formula the natural expiry uses),
 * credited to the accumulator's applier. What it pays is every direct hit the holder took since
 * the accumulator was applied (`gatherDirectHitIntoAccumulators`), the same as its natural expiry.
 */
import { describe, expect, it } from 'vitest';
import {
    createActor,
    CombatActor,
    PendingAccumulator,
    gatherDirectHitIntoAccumulators,
} from '../state';
import { createEventBus, CombatEvent } from '../events';
import { accumulatorDurationCutCandidates, reduceAccumulatorsOnVictim } from '../bombCountdown';

const acc = (over: Partial<PendingAccumulator> = {}): PendingAccumulator => ({
    roundsRemaining: 1,
    pct: 50,
    accumulated: 1000,
    sourceId: 'valk',
    ...over,
});

const holder = (): CombatActor =>
    createActor({
        id: 'x',
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 10_000,
            speed: 1,
        },
    });

const listen = () => {
    const bus = createEventBus();
    const events: Extract<CombatEvent, { type: 'accumulator-detonated' }>[] = [];
    bus.on('accumulator-detonated', (e: Extract<CombatEvent, { type: 'accumulator-detonated' }>) =>
        events.push(e)
    );
    return { bus, events };
};

describe('reduceAccumulatorsOnVictim (all-debuffs shorten)', () => {
    it('shortens every accumulator, bursting the one it takes to 0 through the sink', () => {
        const v = holder();
        const lasting = acc({ roundsRemaining: 3 });
        v.pendingAccumulators.push(acc(), lasting);
        const { bus, events } = listen();
        const sunk: [string, string, number][] = [];
        const n = reduceAccumulatorsOnVictim(v, 1, 4, bus, (victim, sourceId, damage) =>
            sunk.push([victim.id, sourceId, damage])
        );
        expect(n).toBe(2);
        expect(v.pendingAccumulators).toEqual([lasting]);
        expect(lasting.roundsRemaining).toBe(2);
        expect(events).toEqual([
            {
                type: 'accumulator-detonated',
                actorId: 'valk',
                victimId: 'x',
                round: 4,
                damage: 500,
            },
        ]);
        expect(sunk).toEqual([['x', 'valk', 500]]);
    });

    it('without an engine sink, debits shield then HP', () => {
        const v = holder();
        v.shieldPool = 200;
        v.pendingAccumulators.push(acc());
        reduceAccumulatorsOnVictim(v, 1, 1, listen().bus);
        expect(v.shieldPool).toBe(0);
        expect(v.currentHp).toBe(10_000 - 300);
    });

    it('a non-positive cut changes nothing', () => {
        const v = holder();
        v.pendingAccumulators.push(acc());
        expect(reduceAccumulatorsOnVictim(v, 0, 1, listen().bus)).toBe(0);
        expect(v.pendingAccumulators[0].roundsRemaining).toBe(1);
    });
});

describe('accumulatorDurationCutCandidates (single random cut)', () => {
    it('one candidate per accumulator; a cut to 0 bursts it, a cut short of 0 does not', () => {
        const v = holder();
        const first = acc({ roundsRemaining: 2, appliedSeq: 5 });
        v.pendingAccumulators.push(first);
        const { bus, events } = listen();
        const cands = accumulatorDurationCutCandidates(v, 2, bus);
        expect(cands.map((c) => c.seq)).toEqual([5]);
        cands[0].cut(1);
        expect(first.roundsRemaining).toBe(1);
        expect(events).toEqual([]);
        cands[0].cut(1);
        expect(v.pendingAccumulators).toEqual([]);
        expect(events.map((e) => e.damage)).toEqual([500]);
    });
});

describe('gatherDirectHitIntoAccumulators', () => {
    it('adds a hit on the holder to every accumulator it carries; nothing else', () => {
        const v = holder();
        const first = acc({ accumulated: 0 });
        const second = acc({ accumulated: 40 });
        v.pendingAccumulators.push(first, second);
        gatherDirectHitIntoAccumulators(v, 100);
        gatherDirectHitIntoAccumulators(v, 0);
        gatherDirectHitIntoAccumulators(v, -5);
        expect([first.accumulated, second.accumulated]).toEqual([100, 140]);
    });

    it('a cut to 0 bursts what the hits since application added, as the expiry would', () => {
        const v = holder();
        const a = acc({ accumulated: 0, roundsRemaining: 2 });
        gatherDirectHitIntoAccumulators(v, 300); // before application: never counts
        v.pendingAccumulators.push(a);
        gatherDirectHitIntoAccumulators(v, 100);
        const { bus, events } = listen();
        reduceAccumulatorsOnVictim(v, 1, 3, bus);
        expect(events).toEqual([]);
        gatherDirectHitIntoAccumulators(v, 600);
        reduceAccumulatorsOnVictim(v, 1, 3, bus);
        // 100 + 600 gathered, at 50%.
        expect(events.map((e) => e.damage)).toEqual([350]);
    });
});
