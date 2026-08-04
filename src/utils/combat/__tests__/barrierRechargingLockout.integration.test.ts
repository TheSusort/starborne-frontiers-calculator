import { describe, it, expect } from 'vitest';
import { createStatusEngine } from '../statusEngine';
import { holdsBarrierRecharging, BARRIER_RECHARGING } from '../barrierRecharging';

const timed = (buffName: string, duration: number) => ({
    payload: { buffName, stacks: 1, parsedEffects: {} },
    side: 'self' as const,
    sourceSlot: 'passive' as const,
    conditions: [],
    kind: 'timed' as const,
    duration,
});

describe('Barrier Recharging lockout predicate', () => {
    it('is true for an actor carrying the status', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timed(BARRIER_RECHARGING, 3), 'a1');
        expect(holdsBarrierRecharging(eng, 'a1')).toBe(true);
    });

    it('is false for an actor without it, and for an unrelated status', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timed('Barrier', 1), 'a2');
        expect(holdsBarrierRecharging(eng, 'a2')).toBe(false);
        expect(holdsBarrierRecharging(eng, 'nobody')).toBe(false);
    });
});
