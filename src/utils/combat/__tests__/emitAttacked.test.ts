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
            // With no explicit `subAttackIndex` the caller is the non-positional one, which
            // passes the whole cast's hitOutcomes in ONE call — so the hit's own position IS its
            // sub-attack index (a `hits: N` cast is N consecutive attacks, R1).
            subAttackIndex: 0,
        });
        expect(events[1]).toEqual({
            type: 'attacked',
            targetId: 't1',
            attackerId: 'a1',
            round: 2,
            isPrimaryTarget: true,
            shieldWasHit: true,
            damage: 500,
            subAttackIndex: 1,
        });
    });

    it('an explicit subAttackIndex overrides the hit position (the positional callers)', () => {
        const { events, bus } = fakeBus();
        // The positional path groups signals by sub-attack, so each call carries exactly ONE hit
        // outcome and the index it belongs to — which is NOT its position within this call.
        emitAttacked({
            bus,
            round: 2,
            targetId: 't1',
            attackerId: 'a1',
            hitOutcomes: [true],
            isPrimaryTarget: true,
            shieldWasHit: false,
            damage: 500,
            subAttackIndex: 2,
        });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ subAttackIndex: 2 });
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
        expect(events[0]).toEqual({
            type: 'attacked',
            targetId: 't',
            attackerId: 'a',
            round: 1,
            // `subAttackIndex` is NOT conditional — every `attacked` carries one, so the
            // once-per-attack rider guard always has an attack identity to key on.
            subAttackIndex: 0,
        });
    });
});
