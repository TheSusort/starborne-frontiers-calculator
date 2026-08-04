import { describe, it, expect } from 'vitest';
import {
    ONE_SHOT_PERSISTENT_BUFFS,
    isPersistentByName,
    persistentCapFor,
} from '../../../constants/oneShotPersistentBuffs';
import { PERSISTENT_STACKING_BUFFS } from '../../../constants/persistentStackingBuffs';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';

describe('one-shot persistent buff names', () => {
    it('holds exactly the two tranche-2 statuses', () => {
        expect([...ONE_SHOT_PERSISTENT_BUFFS].sort()).toEqual([
            'Charged Overdrive II',
            'Shield Converter',
        ]);
    });

    it('does NOT contain the standing Charge Overdrive II — different mechanic, same magnitude', () => {
        expect(ONE_SHOT_PERSISTENT_BUFFS.has('Charge Overdrive II')).toBe(false);
    });

    it('treats both one-shot and stacking names as persistent', () => {
        expect(isPersistentByName('Shield Converter')).toBe(true);
        expect(isPersistentByName('Charged Overdrive II')).toBe(true);
        expect(isPersistentByName('Overload')).toBe(true);
        expect(isPersistentByName('Attack Up III')).toBe(false);
    });

    it('caps a one-shot at exactly 1 stack', () => {
        expect(persistentCapFor('Shield Converter')).toBe(1);
        expect(persistentCapFor('Charged Overdrive II')).toBe(1);
    });

    it('preserves the existing stacking caps unchanged', () => {
        for (const [name, cap] of PERSISTENT_STACKING_BUFFS) {
            expect(persistentCapFor(name)).toBe(cap);
        }
    });
});

// Step 6's original sketch called a `createStatusEngine({ selfBuffs, enemyDebuffs, abilities,
// ownerId })` shape that does not exist on StatusEngineInput. The real engine exposes
// `applyTimedAbilityStatus(round, status, recipientId?)` directly as a public method (mirrored
// from src/utils/combat/__tests__/statusEngine.test.ts's "ability statuses (Task 6)" describe
// block), and `registerAbilityStatuses` is a no-op for `kind: 'timed'` entries (they are applied
// lazily via `applyTimedAbilityStatus`, never stored by `registerAbilityStatuses` itself) — so
// driving the engine through `applyTimedAbilityStatus` directly is both simpler and exactly what
// production call sites do. The two assertions below (visible via `timedAbilityStatuses`, gone
// after `removeSelfBuffByName`) are unchanged from the brief.
describe('one-shot routing through the status engine', () => {
    it('a one-shot with a leaked duration is visible to the narrowed read and is spendable', () => {
        const engine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        engine.beginRound(1);

        const status: RegisteredAbilityStatus = {
            payload: {
                buffName: 'Charged Overdrive II',
                stacks: 1,
                parsedEffects: {},
            },
            side: 'self',
            sourceSlot: 'active',
            // Leaked duration from the parser's backward scan (see oneShotPersistentBuffs.ts
            // doc comment) — the persistent route must ignore this entirely.
            duration: 3,
            conditions: [],
            kind: 'timed',
        };
        engine.applyTimedAbilityStatus(1, status, 'attacker');

        const held = () =>
            engine
                .timedAbilityStatuses('self', 'attacker')
                .some((s) => s.active.buffName === 'Charged Overdrive II');

        expect(held()).toBe(true);

        // Decrement past the leaked duration (3) — a genuinely-timed entry would expire and
        // vanish on its own by the 3rd Post-Turn. A persistent-routed one-shot has no timer at
        // all (turnsRemaining: 'permanent'), so it must still be held afterward: this is what
        // proves the duration was actually ignored, not merely that removal works.
        engine.decrementPlayer('attacker');
        engine.decrementPlayer('attacker');
        engine.decrementPlayer('attacker');
        engine.decrementPlayer('attacker');
        expect(held()).toBe(true);

        engine.removeSelfBuffByName('attacker', 'Charged Overdrive II');
        expect(held()).toBe(false);
    });
});
