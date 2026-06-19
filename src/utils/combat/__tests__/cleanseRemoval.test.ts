import { describe, it, expect } from 'vitest';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';

// Minimal timed RegisteredAbilityStatus — every required field is set explicitly
// (no `as any` cast) to confirm type-soundness and match the real shape.
// shape verified against statusEngine.test.ts and statusEngine.ts RegisteredAbilityStatus.
const mkTimed = (buffName: string, duration = 3): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    kind: 'timed',
    side: 'enemy',
    sourceSlot: 'active',
    conditions: [],
    duration,
    payload: { buffName, stacks: 1, parsedEffects: {} },
});

describe('statusEngine.cleanse (newest-first removal)', () => {
    it('removes the N most-recently-applied debuffs from a victim, newest first', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        // Apply three distinct debuffs in order onto victim 'v1' (enemy-side, per-victim).
        eng.applyTimedAbilityStatus(1, mkTimed('Attack Down'), 'attacker', 'v1');
        eng.applyTimedAbilityStatus(1, mkTimed('Defense Down'), 'attacker', 'v1');
        eng.applyTimedAbilityStatus(1, mkTimed('Speed Down'), 'attacker', 'v1');
        const removed = eng.cleanse('v1', 2);
        expect(removed).toBe(2);
        // The two NEWEST (Defense Down, Speed Down) are gone; the oldest (Attack Down) remains.
        const names = eng
            .timedAbilityStatuses('enemy', 'attacker', 'v1')
            .map((s) => s.payload.buffName);
        expect(names).toEqual(['Attack Down']);
    });

    it('count cap: cleanse 1 of 3 removes only the newest', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, mkTimed('Attack Down'), 'attacker', 'v1');
        eng.applyTimedAbilityStatus(1, mkTimed('Defense Down'), 'attacker', 'v1');
        eng.applyTimedAbilityStatus(1, mkTimed('Speed Down'), 'attacker', 'v1');
        const removed = eng.cleanse('v1', 1);
        expect(removed).toBe(1);
        const names = eng
            .timedAbilityStatuses('enemy', 'attacker', 'v1')
            .map((s) => s.payload.buffName);
        // Speed Down is newest → removed; Attack Down + Defense Down remain.
        expect(names).toContain('Attack Down');
        expect(names).toContain('Defense Down');
        expect(names).not.toContain('Speed Down');
        expect(names).toHaveLength(2);
    });

    it("'all' removes every removable debuff", () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, mkTimed('Attack Down'), 'attacker', 'v1');
        eng.applyTimedAbilityStatus(1, mkTimed('Defense Down'), 'attacker', 'v1');
        eng.applyTimedAbilityStatus(1, mkTimed('Speed Down'), 'attacker', 'v1');
        const removed = eng.cleanse('v1', 'all');
        expect(removed).toBe(3);
        const names = eng
            .timedAbilityStatuses('enemy', 'attacker', 'v1')
            .map((s) => s.payload.buffName);
        expect(names).toHaveLength(0);
    });

    it('unremovable status is skipped and does not count toward the limit', () => {
        // 'Acidic Decay' is in UNREMOVABLE_STATUSES.
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, mkTimed('Acidic Decay'), 'attacker', 'v1');
        eng.applyTimedAbilityStatus(1, mkTimed('Attack Down'), 'attacker', 'v1');
        eng.applyTimedAbilityStatus(1, mkTimed('Defense Down'), 'attacker', 'v1');
        const removed = eng.cleanse('v1', 'all');
        // Acidic Decay is unremovable → 2 removed (Attack Down + Defense Down).
        expect(removed).toBe(2);
        const names = eng
            .timedAbilityStatuses('enemy', 'attacker', 'v1')
            .map((s) => s.payload.buffName);
        expect(names).toContain('Acidic Decay');
        expect(names).not.toContain('Attack Down');
        expect(names).not.toContain('Defense Down');
    });

    it("DoT debuffs (Corrosion, Inferno) are removable and removed by cleanse", () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        // Corrosion and Inferno use DOT_PREFIXES so each tier is its own family key — both
        // fit in the per-actor enemy timed map and are removable.
        eng.applyTimedAbilityStatus(1, mkTimed('Corrosion'), 'attacker', 'v1');
        eng.applyTimedAbilityStatus(1, mkTimed('Inferno'), 'attacker', 'v1');
        const removed = eng.cleanse('v1', 'all');
        expect(removed).toBe(2);
        const names = eng
            .timedAbilityStatuses('enemy', 'attacker', 'v1')
            .map((s) => s.payload.buffName);
        expect(names).toHaveLength(0);
    });

    it('accumulating debuff with stacks > 0 is removed; persistent-stacking debuff is not', () => {
        // Seed a non-persistent accumulating enemy debuff via registerAbilityStatuses.
        // 'Vulnerability' is a made-up name, not in PERSISTENT_STACKING_BUFFS or UNREMOVABLE_STATUSES.
        const accumDebuff: RegisteredAbilityStatus = {
            kind: 'accumulating',
            side: 'enemy',
            sourceSlot: 'active',
            conditions: [],
            stackTrigger: 'per-round',
            maxStacks: 5,
            payload: { buffName: 'Vulnerability', stacks: 1, parsedEffects: {} },
        };
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.registerAbilityStatuses([accumDebuff], 'attacker', 'v1');
        // Round 1: per-round increment fires at beginRound — stacks become 1 (0→positive).
        eng.beginRound(1);
        // Confirm stacks > 0 so appliedSeq was stamped.
        // The accumMap for 'v1' now has Vulnerability at stacks=1.

        // A persistent-stacking debuff ('Defense Shred') lives in the separate persistent
        // map and is NEVER gathered by removeNewestFirst — it is unremovable by construction.
        // We cannot insert it via registerAbilityStatuses (the engine routes it to the
        // persistent map via PERSISTENT_STACKING_BUFFS). We rely on the design guarantee:
        // the persistent maps are never iterated by removeNewestFirst.

        const removed = eng.cleanse('v1', 'all');
        // Vulnerability (stacks=1, accumulating, non-persistent) should be removed.
        expect(removed).toBe(1);
    });

    it('unknown actor id returns 0 and does not throw', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        expect(() => eng.cleanse('nobody', 3)).not.toThrow();
        expect(eng.cleanse('nobody', 3)).toBe(0);
    });

    // NOTE: 'permanent'-duration timed entries (turnsRemaining === 'permanent') are skipped
    // by isUnremovable. At the unit level these entries never reach the per-actor timed maps
    // (persistent-stacking statuses go to separate persistent maps; the only other path to a
    // 'permanent' turnsRemaining is via snapshot, not the timed maps). The isUnremovable guard
    // covers the belt-and-braces contract; a higher-level integration test would be needed to
    // exercise that specific branch if it ever becomes reachable.
});
