import { describe, it, expect } from 'vitest';
import { createStatusEngine } from '../statusEngine';
import type { RegisteredAbilityStatus } from '../statusEngine';

/** A hit-counted Barrier carries no turn window: it is stored with duration Infinity
 *  (Infinity − 1 === Infinity, expiry compares <= 0) so only the hit count expires it —
 *  the TOXIC_OVERFLOW_DURATION / castPathCheatDeath shape. Overrides let a case opt into
 *  a real turn duration instead (the Panon p1 canary). */
const timedBarrier = (
    over: Partial<Extract<RegisteredAbilityStatus, { kind: 'timed' }>> = {}
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    payload: { buffName: 'Barrier', stacks: 1, parsedEffects: {} },
    side: 'self',
    sourceSlot: 'charged',
    conditions: [],
    kind: 'timed',
    duration: Number.POSITIVE_INFINITY,
    ...over,
});

describe('hit-counted Barrier — status layer', () => {
    it('spends one charge per call and removes the status at zero', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timedBarrier({ hits: 2 }), 'q1');

        expect(eng.consumeStatusHit('q1', 'Barrier')).toBe(true);
        expect(eng.timedAbilityStatuses('self', 'q1').map((s) => s.active.buffName)).toContain(
            'Barrier'
        );

        expect(eng.consumeStatusHit('q1', 'Barrier')).toBe(true);
        expect(eng.timedAbilityStatuses('self', 'q1').map((s) => s.active.buffName)).not.toContain(
            'Barrier'
        );
    });

    it('is a no-op for a turn-duration Barrier (hitsRemaining absent)', () => {
        // The Panon p1 regression canary: "Barrier for 1 turn" must survive any number of hits.
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timedBarrier({ duration: 1 }), 'p1');

        expect(eng.consumeStatusHit('p1', 'Barrier')).toBe(false);
        expect(eng.timedAbilityStatuses('self', 'p1').map((s) => s.active.buffName)).toContain(
            'Barrier'
        );
    });

    it('is a no-op when the actor holds no such status', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        expect(eng.consumeStatusHit('nobody', 'Barrier')).toBe(false);
    });
});
