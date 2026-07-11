/**
 * selfBuffStacksForOwner — stacks-aware sibling of selfBuffNamesForOwners.
 *
 * The Protection damage-transfer resolver needs the STACK COUNT of a self-buff, aggregated across
 * ALL three status sources (scheduled snapshot self-buffs + timed ability statuses + aura/accum
 * ability statuses). Reading snapshot().activeSelfBuffs ALONE misses aura-granted buffs (real
 * Meatshield Protection, SP-G G1b) and any non-'attacker' owner — the exact trap this helper fixes.
 */
import { describe, it, expect } from 'vitest';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';
import { selfBuffStacksForOwner } from '../triggers';

const auraProtection = (stacks: number): RegisteredAbilityStatus => ({
    kind: 'aura',
    side: 'self',
    sourceSlot: 'passive',
    conditions: [],
    payload: { buffName: 'Protection', stacks, parsedEffects: {}, isStackable: true },
});

describe('selfBuffStacksForOwner', () => {
    it('reads an AURA-granted stackable buff (the production Meatshield path snapshot() alone misses)', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.registerAbilityStatuses([auraProtection(3)], 'prot-1');
        eng.beginRound(1);
        // The aura lives ONLY in the activeAbilityStatuses source — snapshot excludes it…
        expect(eng.snapshot('prot-1').activeSelfBuffs).toHaveLength(0);
        // …yet the helper surfaces its 3 stacks. No double-count (a single instance is in ONE source
        // only): the result is EXACTLY 3, not 6.
        expect(selfBuffStacksForOwner(eng, 'prot-1', 'Protection')).toBe(3);
    });

    it('returns 0 for a different buff name (exact-name match)', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.registerAbilityStatuses([auraProtection(3)], 'prot-1');
        eng.beginRound(1);
        expect(selfBuffStacksForOwner(eng, 'prot-1', 'Focus')).toBe(0);
    });

    it('returns 0 for an owner with no Protection at all', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        expect(selfBuffStacksForOwner(eng, 'nobody', 'Protection')).toBe(0);
    });

    it('a stackless entry (isStackable false → no reported count) defaults to 1', () => {
        // Non-stackable aura: activeAbilityStatuses does NOT surface a `stacks` count, so the entry
        // is present but stackless → the helper counts it as 1 (the `?? 1` default).
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const nonStackable: RegisteredAbilityStatus = {
            kind: 'aura',
            side: 'self',
            sourceSlot: 'passive',
            conditions: [],
            payload: { buffName: 'Protection', stacks: 1, parsedEffects: {} }, // isStackable omitted
        };
        eng.registerAbilityStatuses([nonStackable], 'prot-1');
        eng.beginRound(1);
        expect(selfBuffStacksForOwner(eng, 'prot-1', 'Protection')).toBe(1);
    });

    it('aggregates DISTINCT instances across sources (aura + a scheduled accumulating snapshot buff)', () => {
        // A scheduled per-round accumulating 'Protection' seeds the 'attacker' snapshot (2 stacks
        // after round-1 tick); an aura 'Protection' (3 stacks) registered on the SAME owner lives in
        // the ability-status source. These are TWO distinct instances in DISJOINT sources, so the
        // total is their sum (2 + 3 = 5) — confirming the helper reads every source, and that
        // summing does not conflate the two into one nor drop either.
        const eng = createStatusEngine({
            selfBuffs: [
                {
                    id: 'sched-prot',
                    buffName: 'Protection',
                    stacks: 2,
                    parsedEffects: {},
                    isStackable: true,
                    maxStacks: 2,
                    stackTrigger: 'per-round',
                },
            ],
            enemyDebuffs: [],
        });
        eng.registerAbilityStatuses([auraProtection(3)], 'attacker');
        eng.beginRound(1); // ticks the scheduled accum to 2
        // Snapshot carries ONLY the scheduled accum instance (2); the aura is in the other source (3).
        expect(selfBuffStacksForOwner(eng, 'attacker', 'Protection')).toBe(5);
    });
});
