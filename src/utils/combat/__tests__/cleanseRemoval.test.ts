import { describe, it, expect } from 'vitest';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';

// Minimal timed RegisteredAbilityStatus — every required field is set explicitly
// (no `as any` cast) to confirm type-soundness and match the real shape.
// shape verified against statusEngine.test.ts and statusEngine.ts RegisteredAbilityStatus.
const mkTimed = (
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

    it('DoT debuffs (Corrosion, Inferno) are removable and removed by cleanse', () => {
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

    it('accumulating debuff with stacks > 0 is removed; persistent-stacking debuff (Defense Shred) survives cleanse(all)', () => {
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

        // Apply a real persistent-stacking debuff (Defense Shred) via the normal timed path.
        // The engine routes PERSISTENT_STACKING_BUFFS by name into the separate persistent map
        // — removeNewestFirst never visits that map, so it is unremovable by construction.
        eng.applyTimedAbilityStatus(1, mkTimed('Defense Shred'), 'attacker', 'v1');

        const removed = eng.cleanse('v1', 'all');
        // Vulnerability (stacks=1, accumulating, non-persistent) should be removed (1).
        // Defense Shred lives in the persistent map — never gathered → not counted.
        expect(removed).toBe(1);

        // Defense Shred must still be present in the persistent map after cleanse.
        // It carries a payload (ability-sourced), so it appears via timedAbilityStatuses
        // (not snapshot, which excludes payload-carrying entries).
        const persistentNames = eng
            .timedAbilityStatuses('enemy', 'attacker', 'v1')
            .map((s) => s.payload.buffName);
        expect(persistentNames).toContain('Defense Shred');
    });

    it('cross-store interleave: cleanse removes the NEWER entry regardless of which store it lives in', () => {
        // Load-bearing case: proves that enemyMaps (timed) and accumEnemyMaps (accumulating)
        // are gathered into one candidate list and sorted together by appliedSeq.

        // Scenario A: timed debuff applied FIRST (older), then accumulating debuff goes 0→positive
        // (newer). cleanse(1) must remove the accumulating one (newer) and leave the timed one (older).
        const accumDebuffA: RegisteredAbilityStatus = {
            kind: 'accumulating',
            side: 'enemy',
            sourceSlot: 'active',
            conditions: [],
            stackTrigger: 'per-round',
            maxStacks: 5,
            payload: { buffName: 'Vulnerability', stacks: 1, parsedEffects: {} },
        };
        const engA = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        engA.registerAbilityStatuses([accumDebuffA], 'attacker', 'v1');

        engA.beginRound(1);
        // Apply the TIMED debuff first → gets appliedSeq=1 (older).
        engA.applyTimedAbilityStatus(1, mkTimed('Attack Down'), 'attacker', 'v1');
        // The per-round accum increment already fired at beginRound above,
        // so Vulnerability stacks went 0→1 inside beginRound (before applyTimedAbilityStatus).
        // But beginRound(1) ran BEFORE applyTimedAbilityStatus, so Vulnerability's seq < Attack Down's seq.
        // We need the accum to be NEWER. Run a second round so accum ticks again — but that
        // would also tick if already >0. Instead: use a per-active trigger so we control the stamp.
        // Re-do with per-active trigger so we can fire it AFTER the timed apply.
        const accumDebuffB: RegisteredAbilityStatus = {
            kind: 'accumulating',
            side: 'enemy',
            sourceSlot: 'active',
            conditions: [],
            stackTrigger: 'per-active', // only increments on sourceFired('attacker','active',r)
            maxStacks: 5,
            payload: { buffName: 'Vulnerability', stacks: 1, parsedEffects: {} },
        };
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.registerAbilityStatuses([accumDebuffB], 'attacker', 'v1');
        eng.beginRound(1);
        // Step 1: apply the TIMED debuff — it gets appliedSeq first (lower = older).
        eng.applyTimedAbilityStatus(1, mkTimed('Attack Down'), 'attacker', 'v1');
        // Step 2: fire the attacker's active slot → per-active increment → Vulnerability 0→1.
        //         appliedSeq is stamped NOW (higher = newer).
        eng.sourceFired('attacker', 'active', 1);

        // cleanse(1) must remove the accumulating Vulnerability (newer) and keep Attack Down (older).
        const removedA = eng.cleanse('v1', 1);
        expect(removedA).toBe(1);

        // Attack Down must remain in enemyMaps.
        const timedAfter = eng
            .timedAbilityStatuses('enemy', 'attacker', 'v1')
            .map((s) => s.payload.buffName);
        expect(timedAfter).toContain('Attack Down');

        // Vulnerability must be gone from accumEnemyMaps — snapshot stacks should be 0 or absent.
        const snapA = eng.snapshot('attacker', 'v1');
        const accumNames = snapA.activeEnemyDebuffs.map((b) => b.buffName);
        expect(accumNames).not.toContain('Vulnerability');

        // Scenario B (reverse): accumulating debuff goes active FIRST (older appliedSeq),
        // then timed debuff applied (newer appliedSeq). cleanse(1) removes the timed one (newer).
        const accumDebuffC: RegisteredAbilityStatus = {
            kind: 'accumulating',
            side: 'enemy',
            sourceSlot: 'active',
            conditions: [],
            stackTrigger: 'per-active',
            maxStacks: 5,
            payload: { buffName: 'Vulnerability', stacks: 1, parsedEffects: {} },
        };
        const eng2 = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng2.registerAbilityStatuses([accumDebuffC], 'attacker', 'v2');
        eng2.beginRound(1);
        // Step 1: fire attacker active → Vulnerability 0→1 (gets lower appliedSeq = older).
        eng2.sourceFired('attacker', 'active', 1);
        // Step 2: apply timed debuff (gets higher appliedSeq = newer).
        eng2.applyTimedAbilityStatus(1, mkTimed('Defense Down'), 'attacker', 'v2');

        const removedB = eng2.cleanse('v2', 1);
        expect(removedB).toBe(1);

        // Defense Down (timed, newer) must be gone.
        const timedAfterB = eng2
            .timedAbilityStatuses('enemy', 'attacker', 'v2')
            .map((s) => s.payload.buffName);
        expect(timedAfterB).not.toContain('Defense Down');

        // Vulnerability (accum, older) must still be active.
        // It carries a payload (ability-sourced), so it appears via activeAbilityStatuses.
        // The accumDebuffC has conditions:[] so conditionsMet always returns true regardless
        // of the ctx fields — a minimal stub is sufficient here.
        const minCtx = {
            selfBuffNames: [] as string[],
            selfDebuffNames: [] as string[],
            enemyBuffNames: [] as string[],
            enemyDebuffCount: 0,
            effectiveCritRate: 0,
            adjacentAllyCount: 0,
            enemyAdjacentCount: 0,
            enemyDestroyedCount: 0,
            selfHpPct: 100,
            enemyHpPct: 100,
        };
        const activeAfterB = eng2
            .activeAbilityStatuses('enemy', () => minCtx, 'attacker', 'v2')
            .map((s) => s.payload.buffName);
        expect(activeAfterB).toContain('Vulnerability');
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
