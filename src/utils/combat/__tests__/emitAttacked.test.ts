import { describe, it, expect } from 'vitest';
import { emitAttacked } from '../emitAttacked';
import type { CombatEvent } from '../events';

const fakeBus = () => {
    const events: CombatEvent[] = [];
    return { events, bus: { on() {}, emit: (e: CombatEvent) => void events.push(e) } };
};

describe('emitAttacked', () => {
    it('emits one attacked event per hit outcome with correct flags', () => {
        const { events, bus } = fakeBus();
        emitAttacked({
            bus,
            round: 2,
            targetId: 't1',
            attackerId: 'a1',
            hitOutcomes: [true, false],
            isPrimaryTarget: true,
            shieldWasHit: true,
            damage: 500,
        });
        expect(events).toHaveLength(2);
        expect(events[0]).toEqual({
            type: 'attacked',
            targetId: 't1',
            attackerId: 'a1',
            round: 2,
            isPrimaryTarget: true,
            shieldWasHit: true,
            didCrit: true,
            damage: 500,
        });
        expect(events[1]).toEqual({
            type: 'attacked',
            targetId: 't1',
            attackerId: 'a1',
            round: 2,
            isPrimaryTarget: true,
            shieldWasHit: true,
            damage: 500,
        });
    });

    it('omits shieldWasHit/damage when falsy and isPrimaryTarget when false', () => {
        const { events, bus } = fakeBus();
        emitAttacked({
            bus,
            round: 1,
            targetId: 't',
            attackerId: 'a',
            hitOutcomes: [false],
            isPrimaryTarget: false,
            shieldWasHit: false,
            damage: 0,
        });
        expect(events[0]).toEqual({ type: 'attacked', targetId: 't', attackerId: 'a', round: 1 });
    });
});
