import { describe, it, expect } from 'vitest';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';

// SELF-SIDE (buff) timed status — side: 'self' routes to selfMaps.get(ownerId) via
// applyTimedAbilityStatus, the exact store purge() reads (removeNewestFirst with 'buffs').
// Mirrors purgeRemoval.test.ts's mkTimedBuff.
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

// ENEMY-SIDE (debuff) timed status — side: 'enemy' routes to enemyMaps (the DEBUFF store),
// the store cleanse() reads. Mirrors cleanseRemoval.test.ts's mkTimed.
const mkTimedDebuff = (
    buffName: string,
    duration = 3
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    kind: 'timed',
    side: 'enemy',
    sourceSlot: 'active',
    conditions: [],
    duration,
    payload: { buffName, stacks: 1, parsedEffects: {} },
});

describe('statusEngine.purge — Buff Protection holder-state guard', () => {
    it('purge returns 0 and leaves all buffs when the holder carries Buff Protection', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Buff Protection'), 'e1');
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Attack Up I'), 'e1');

        const removed = eng.purge('e1', 'all');
        expect(removed).toBe(0);

        const names = eng.timedAbilityStatuses('self', 'e1').map((s) => s.payload.buffName);
        expect(names).toContain('Buff Protection');
        expect(names).toContain('Attack Up I');
    });

    it('control: without Buff Protection, purge removes buffs (returns > 0)', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Attack Up I'), 'e1');

        const removed = eng.purge('e1', 'all');
        expect(removed).toBeGreaterThan(0);

        const names = eng.timedAbilityStatuses('self', 'e1').map((s) => s.payload.buffName);
        expect(names).not.toContain('Attack Up I');
    });

    it('cleanse is unaffected by Buff Protection (purge-only scope)', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        // Holder carries Buff Protection as a self-buff...
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Buff Protection'), 'e1');
        // ...and a removable DEBUFF in the enemy store keyed to the same actor id.
        eng.applyTimedAbilityStatus(1, mkTimedDebuff('Attack Down'), 'attacker', 'e1');

        const removed = eng.cleanse('e1', 'all');
        expect(removed).toBeGreaterThan(0);

        const debuffNames = eng
            .timedAbilityStatuses('enemy', 'attacker', 'e1')
            .map((s) => s.payload.buffName);
        expect(debuffNames).not.toContain('Attack Down');
    });
});
