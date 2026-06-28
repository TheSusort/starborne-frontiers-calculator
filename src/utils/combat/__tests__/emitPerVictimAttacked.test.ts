import { describe, it, expect, vi } from 'vitest';
import { emitPerVictimAttacked } from '../emitPerVictimAttacked';
import type { CombatEvent, CombatEventBus } from '../events';

type AttackedEvent = Extract<CombatEvent, { type: 'attacked' }>;

function fakeBus(): { bus: CombatEventBus; emit: ReturnType<typeof vi.fn> } {
    const emit = vi.fn();
    const bus = { emit } as unknown as CombatEventBus;
    return { bus, emit };
}

describe('emitPerVictimAttacked', () => {
    it('emits one attacked per hit per victim, primary flagged, per-victim damage/shield', () => {
        const { bus, emit } = fakeBus();
        const victims = new Map([
            ['P', { damage: 1000, shieldWasHit: true }],
            ['C', { damage: 400, shieldWasHit: false }],
        ]);
        emitPerVictimAttacked({
            bus,
            round: 2,
            attackerId: 'A',
            primaryId: 'P',
            hitOutcomes: [true, false],
            victims,
        });
        const calls = emit.mock.calls.map((c) => c[0] as AttackedEvent);
        expect(calls).toHaveLength(4); // 2 victims x 2 hits
        const primary = calls.filter((e) => e.targetId === 'P');
        const covered = calls.filter((e) => e.targetId === 'C');
        expect(primary).toHaveLength(2);
        expect(covered).toHaveLength(2);
        expect(primary[0]).toMatchObject({
            type: 'attacked',
            attackerId: 'A',
            round: 2,
            isPrimaryTarget: true,
            shieldWasHit: true,
            damage: 1000,
        });
        expect(primary[0].didCrit).toBe(true);
        expect(primary[1].didCrit).toBeUndefined();
        expect(covered[0].isPrimaryTarget).toBeUndefined();
        expect(covered[0].shieldWasHit).toBeUndefined();
        expect(covered[0].damage).toBe(400);
        expect(covered[0].didCrit).toBe(true);
    });

    it('byte-identical to a single emitAttacked when only the primary is present', () => {
        const { bus, emit } = fakeBus();
        emitPerVictimAttacked({
            bus,
            round: 1,
            attackerId: 'A',
            primaryId: 'P',
            hitOutcomes: [false],
            victims: new Map([['P', { damage: 50, shieldWasHit: false }]]),
        });
        const calls = emit.mock.calls;
        expect(calls).toHaveLength(1);
        expect(calls[0][0]).toEqual({
            type: 'attacked',
            targetId: 'P',
            attackerId: 'A',
            round: 1,
            isPrimaryTarget: true,
            damage: 50,
        });
    });
});
