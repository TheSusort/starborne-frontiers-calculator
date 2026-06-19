import { describe, it, expect } from 'vitest';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';

// Minimal timed RegisteredAbilityStatus for a SELF-SIDE (buff) status.
// side: 'self' routes to selfMaps.get(ownerId) via applyTimedAbilityStatus,
// which is exactly the store purge() targets (removeNewestFirst with 'buffs').
// shape verified against statusEngine.ts and cleanseRemoval.test.ts.
const mkTimedBuff = (
    buffName: string,
    duration = 3
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    kind: 'timed',
    side: 'self',
    sourceSlot: 'active',
    conditions: [],
    duration,
    payload: { buffName, stacks: 1, parsedEffects: {} },
});

describe('statusEngine.purge (newest-first self-buff removal)', () => {
    it('(a) removes the 2 newest self-buffs of an actor, oldest remains, returns 2', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        // Apply three distinct self-buffs onto 'e1' in order.
        // recipientId = 'e1' routes to selfMaps.get('e1').
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Attack Up'), 'e1');
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Defense Up'), 'e1');
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Speed Up'), 'e1');

        const removed = eng.purge('e1', 2);
        expect(removed).toBe(2);

        // The two NEWEST (Defense Up, Speed Up) are gone; the oldest (Attack Up) remains.
        const names = eng
            .timedAbilityStatuses('self', 'e1')
            .map((s) => s.payload.buffName);
        expect(names).toEqual(['Attack Up']);
    });

    it("(b) 'all' removes all self-buffs", () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Attack Up'), 'e1');
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Defense Up'), 'e1');
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Speed Up'), 'e1');

        const removed = eng.purge('e1', 'all');
        expect(removed).toBe(3);

        const names = eng
            .timedAbilityStatuses('self', 'e1')
            .map((s) => s.payload.buffName);
        expect(names).toHaveLength(0);
    });

    it('(c) Protection and Magnetized Shielding (unremovable buffs) survive purge(all); ordinary buffs are removed; returned count excludes them', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Protection'), 'e1');
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Magnetized Shielding'), 'e1');
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Attack Up'), 'e1');

        const removed = eng.purge('e1', 'all');
        // Only Attack Up is removable.
        expect(removed).toBe(1);

        const names = eng
            .timedAbilityStatuses('self', 'e1')
            .map((s) => s.payload.buffName);
        expect(names).toContain('Protection');
        expect(names).toContain('Magnetized Shielding');
        expect(names).not.toContain('Attack Up');
    });

    it('(d) unknown actor id returns 0 and does not throw', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        expect(() => eng.purge('nobody', 3)).not.toThrow();
        expect(eng.purge('nobody', 3)).toBe(0);
    });
});
