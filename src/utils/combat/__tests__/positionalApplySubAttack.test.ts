import { describe, it, expect } from 'vitest';
import { parsePattern, parseTarget } from '../../targetingParser';
import { applyPositionalDamage } from '../positionalApply';
import type { AttackerDamageScalars, VictimDefenseProfile } from '../victimDamage';
import type { CombatActor } from '../state';

// CHARACTERIZATION TESTS (epic: multi-hit full-walk attacks, PR1).
// Several assertions here pass on first run by design. Their value is failing LATER —
// they pin the sub-attack surface that PR2-PR5 build on, and the N=1 invariant that
// bounds the epic's blast radius. See
// docs/superpowers/specs/2026-08-07-multi-hit-full-walk-attacks-design.md §7.

const actor = (id: string, position: CombatActor['position'], currentHp = 1e9): CombatActor =>
    ({ id, position, currentHp }) as CombatActor;

const scalars = (hits: number): AttackerDamageScalars => ({
    effectiveAttack: 1000,
    multiplierPct: 100,
    secondaryStatValue: 0,
    hits,
    effectiveCritDamage: 0,
    outgoingDamageBuffPct: 0,
    incomingDamageModifierPct: 0,
    defensePenetrationPct: 0,
    attackerAffinity: 'chemical',
});

const profile = (): VictimDefenseProfile => ({
    defence: 0,
    defenceModifierPct: 0,
    affinity: 'chemical',
});

/** applyToVictim stub that books the full hit, matching the engine's real funnel. */
const bookingApply = (victim: CombatActor, damage: number) => {
    victim.currentHp -= damage;
    return { shieldBefore: 0, hpDamage: damage, barriered: false, incomingBooked: damage };
};

describe('applyPositionalDamage — SubAttackOutcome', () => {
    it('hits:3 single-target → one entry per sub-attack, indexed 0..2', () => {
        const result = applyPositionalDamage({
            hitCrits: [false, false, false],
            scalars: scalars(3),
            pattern: parsePattern('Pattern-Base'),
            actorPosition: 'M2',
            target: parseTarget('front'),
            opposingLiving: [actor('front', 'M4')],
            defenseProfileOf: profile,
            applyToVictim: bookingApply,
        });

        expect(result.subAttacks).toHaveLength(3);
        expect(result.subAttacks.map((s) => s.index)).toEqual([0, 1, 2]);
        expect(result.subAttacks.every((s) => s.whiffed === false)).toBe(true);
        expect(result.subAttacks.map((s) => s.victimIds)).toEqual([
            ['front'],
            ['front'],
            ['front'],
        ]);
    });

    it("per-sub-attack damage sums that sub-attack's booked victim damage, and the total reconciles", () => {
        const result = applyPositionalDamage({
            hitCrits: [false, false, false],
            scalars: scalars(3),
            pattern: parsePattern('Pattern-Base'),
            actorPosition: 'M2',
            target: parseTarget('front'),
            opposingLiving: [actor('front', 'M4')],
            defenseProfileOf: profile,
            applyToVictim: bookingApply,
        });

        // Each sub-attack books a positive amount, and all three are equal (same victim,
        // same scalars, no crits) — the fold re-split is even.
        const [a, b, c] = result.subAttacks.map((s) => s.damage);
        expect(a).toBeGreaterThan(0);
        expect(b).toBeCloseTo(a, 10);
        expect(c).toBeCloseTo(a, 10);
    });

    it('didCrit is per sub-attack, not per cast', () => {
        const result = applyPositionalDamage({
            hitCrits: [false, true, false],
            scalars: scalars(3),
            pattern: parsePattern('Pattern-Base'),
            actorPosition: 'M2',
            target: parseTarget('front'),
            opposingLiving: [actor('front', 'M4')],
            defenseProfileOf: profile,
            applyToVictim: bookingApply,
        });

        expect(result.subAttacks.map((s) => s.didCrit)).toEqual([false, true, false]);
        // The existing cast-level aggregates are unchanged by this addition.
        expect(result.anyCrit).toBe(true);
        expect(result.critPairs).toBe(1);
    });

    it('an AoE sub-attack lists every footprint victim in one entry', () => {
        // Pattern-Line-Range-1 @ M4 → origin M4, covered M3.
        const result = applyPositionalDamage({
            hitCrits: [false],
            scalars: scalars(1),
            pattern: parsePattern('Pattern-Line-Range-1'),
            actorPosition: 'M2',
            target: parseTarget('front'),
            opposingLiving: [actor('origin', 'M4'), actor('covered', 'M3')],
            defenseProfileOf: profile,
            applyToVictim: bookingApply,
        });

        expect(result.subAttacks).toHaveLength(1);
        expect(result.subAttacks[0].victimIds).toEqual(['origin', 'covered']);
    });

    it('a whiffed sub-attack still produces an entry, so indices stay aligned', () => {
        // Sole target has 1 HP and dies on sub-attack 0; sub-attacks 1-2 whiff.
        const only = actor('only', 'M4', 1);
        const result = applyPositionalDamage({
            hitCrits: [false, false, false],
            scalars: scalars(3),
            pattern: parsePattern('Pattern-Base'),
            actorPosition: 'M2',
            target: parseTarget('front'),
            opposingLiving: [only],
            defenseProfileOf: profile,
            applyToVictim: bookingApply,
        });

        expect(result.subAttacks).toHaveLength(3);
        expect(result.subAttacks.map((s) => s.whiffed)).toEqual([false, true, true]);
        expect(result.subAttacks[1]).toEqual({
            index: 1,
            whiffed: true,
            didCrit: false,
            damage: 0,
            victimIds: [],
        });
    });
});

describe('applyPositionalDamage — subAttackIndex threading', () => {
    it('every per-victim callback receives the index of its sub-attack', () => {
        const applyIdx: number[] = [];
        const emitIdx: number[] = [];
        const resolvedIdx: number[] = [];
        const reductionIdx: number[] = [];
        const ampIdx: number[] = [];

        applyPositionalDamage({
            hitCrits: [false, false, false],
            scalars: scalars(3),
            pattern: parsePattern('Pattern-Base'),
            actorPosition: 'M2',
            target: parseTarget('front'),
            opposingLiving: [actor('front', 'M4')],
            defenseProfileOf: profile,
            applyToVictim: (victim, damage, _isAnchor, subAttackIndex) => {
                applyIdx.push(subAttackIndex as number);
                return bookingApply(victim, damage);
            },
            emitHit: (_v, _d, _c, subAttackIndex) => {
                emitIdx.push(subAttackIndex as number);
            },
            onVictimResolved: (_v, _d, _o, _c, subAttackIndex) => {
                resolvedIdx.push(subAttackIndex as number);
            },
            incomingReductionFor: (_v, _c, subAttackIndex) => {
                reductionIdx.push(subAttackIndex as number);
                return 0;
            },
            outgoingAmplificationFor: (_v, _c, subAttackIndex) => {
                ampIdx.push(subAttackIndex as number);
                return 0;
            },
        });

        expect(applyIdx).toEqual([0, 1, 2]);
        expect(emitIdx).toEqual([0, 1, 2]);
        expect(resolvedIdx).toEqual([0, 1, 2]);
        expect(reductionIdx).toEqual([0, 1, 2]);
        expect(ampIdx).toEqual([0, 1, 2]);
    });

    it('an AoE sub-attack passes the SAME index to every footprint victim', () => {
        const seen: Array<{ id: string; idx: number }> = [];

        applyPositionalDamage({
            hitCrits: [false, false],
            scalars: scalars(2),
            pattern: parsePattern('Pattern-Line-Range-1'),
            actorPosition: 'M2',
            target: parseTarget('front'),
            opposingLiving: [actor('origin', 'M4'), actor('covered', 'M3')],
            defenseProfileOf: profile,
            applyToVictim: (victim, damage, _isAnchor, subAttackIndex) => {
                seen.push({ id: victim.id, idx: subAttackIndex as number });
                return bookingApply(victim, damage);
            },
        });

        // Two sub-attacks x two footprint victims. Both victims of sub-attack 0 see index 0.
        expect(seen).toEqual([
            { id: 'origin', idx: 0 },
            { id: 'covered', idx: 0 },
            { id: 'origin', idx: 1 },
            { id: 'covered', idx: 1 },
        ]);
    });

    it('rollVictimCrit receives the sub-attack index', () => {
        const rollIdx: number[] = [];

        applyPositionalDamage({
            hitCrits: [false, false],
            scalars: scalars(2),
            pattern: parsePattern('Pattern-Line-Range-1'),
            actorPosition: 'M2',
            target: parseTarget('front'),
            opposingLiving: [actor('origin', 'M4'), actor('covered', 'M3')],
            defenseProfileOf: profile,
            applyToVictim: bookingApply,
            // Only non-anchor victims resolve via this callback.
            rollVictimCrit: (_victim, subAttackIndex) => {
                rollIdx.push(subAttackIndex as number);
                return false;
            },
        });

        expect(rollIdx).toEqual([0, 1]);
    });
});

describe('applyPositionalDamage — PR1 invariants', () => {
    it('N=1: a single-hit cast produces exactly one sub-attack whose damage is the cast total', () => {
        const booked: number[] = [];

        const result = applyPositionalDamage({
            hitCrits: [false],
            scalars: scalars(1),
            pattern: parsePattern('Pattern-Line-Range-1'),
            actorPosition: 'M2',
            target: parseTarget('front'),
            opposingLiving: [actor('origin', 'M4'), actor('covered', 'M3')],
            defenseProfileOf: profile,
            applyToVictim: bookingApply,
            emitHit: (_v, damage) => {
                booked.push(damage);
            },
        });

        expect(result.subAttacks).toHaveLength(1);
        const total = booked.reduce((s, d) => s + d, 0);
        expect(result.subAttacks[0].damage).toBeCloseTo(total, 10);
    });

    it('the cast-level aggregates are unchanged by the sub-attack addition', () => {
        // 2 sub-attacks x 2 footprint victims, all critting → critPairs 4, 2 distinct victims,
        // and 2 sub-attacks each flagged didCrit. critPairs must NOT collapse to the sub-attack
        // count, and subAttacks must NOT collapse to critPairs.
        const result = applyPositionalDamage({
            hitCrits: [true, true],
            scalars: scalars(2),
            pattern: parsePattern('Pattern-Line-Range-1'),
            actorPosition: 'M2',
            target: parseTarget('front'),
            opposingLiving: [actor('origin', 'M4'), actor('covered', 'M3')],
            defenseProfileOf: profile,
            applyToVictim: bookingApply,
            rollVictimCrit: () => true,
        });

        expect(result.anyCrit).toBe(true);
        expect(result.critPairs).toBe(4);
        expect(result.critVictimIds).toEqual(['origin', 'covered']);
        expect(result.subAttacks).toHaveLength(2);
        expect(result.subAttacks.map((s) => s.didCrit)).toEqual([true, true]);
    });

    it('sub-attack damage reconciles with the total booked across the whole cast', () => {
        const booked: number[] = [];

        const result = applyPositionalDamage({
            hitCrits: [false, true, false],
            scalars: scalars(3),
            pattern: parsePattern('Pattern-Line-Range-1'),
            actorPosition: 'M2',
            target: parseTarget('front'),
            opposingLiving: [actor('origin', 'M4'), actor('covered', 'M3')],
            defenseProfileOf: profile,
            applyToVictim: bookingApply,
            emitHit: (_v, damage) => {
                booked.push(damage);
            },
        });

        const castTotal = booked.reduce((s, d) => s + d, 0);
        const subTotal = result.subAttacks.reduce((s, a) => s + a.damage, 0);
        expect(subTotal).toBeCloseTo(castTotal, 10);
    });

    it('subAttacks[h].index always equals its array position, whiffs included', () => {
        const only = actor('only', 'M4', 1);
        const result = applyPositionalDamage({
            hitCrits: [false, false, false, false],
            scalars: scalars(4),
            pattern: parsePattern('Pattern-Base'),
            actorPosition: 'M2',
            target: parseTarget('front'),
            opposingLiving: [only],
            defenseProfileOf: profile,
            applyToVictim: bookingApply,
        });

        result.subAttacks.forEach((s, i) => expect(s.index).toBe(i));
    });
});

// PR2 Task 2 — the engine buckets its `attacked` signals by (subAttackIndex, victim) instead of
// by victim alone. These pin the enumeration that grouping relies on: exactly one visit per
// (sub-attack, victim) pair, so every bucket holds exactly ONE hitOutcome and the TOTAL number of
// `attacked` events a cast emits is unchanged by the regrouping.
describe('applyPositionalDamage — attacked signal grouping', () => {
    it('total attacked cardinality is unchanged when grouped by sub-attack', () => {
        // 3 sub-attacks x 2 footprint victims = 6 (sub-attack, victim) pairs.
        // Grouping must not add or drop any.
        const pairs: Array<{ idx: number; id: string }> = [];

        const result = applyPositionalDamage({
            hitCrits: [false, false, false],
            scalars: scalars(3),
            pattern: parsePattern('Pattern-Line-Range-1'),
            actorPosition: 'M2',
            target: parseTarget('front'),
            opposingLiving: [actor('origin', 'M4'), actor('covered', 'M3')],
            defenseProfileOf: profile,
            applyToVictim: (victim, damage, _isAnchor, subAttackIndex) => {
                pairs.push({ idx: subAttackIndex as number, id: victim.id });
                return bookingApply(victim, damage);
            },
        });

        expect(pairs).toHaveLength(6);
        expect(result.subAttacks.map((s) => s.victimIds.length)).toEqual([2, 2, 2]);
        // Every (sub-attack, victim) pair appears exactly once — so bucketing by the pair yields
        // one hitOutcome per bucket and 6 `attacked` events in total, the same 6 the flat
        // victim-keyed map produced as 2 victims x 3 outcomes.
        expect(new Set(pairs.map((p) => `${p.idx}:${p.id}`)).size).toBe(6);
    });

    it('a victim killed on sub-attack 0 is absent from later sub-attacks', () => {
        const frail = actor('origin', 'M4', 1);
        const result = applyPositionalDamage({
            hitCrits: [false, false, false],
            scalars: scalars(3),
            pattern: parsePattern('Pattern-Line-Range-1'),
            actorPosition: 'M2',
            target: parseTarget('front'),
            opposingLiving: [frail, actor('covered', 'M3')],
            defenseProfileOf: profile,
            applyToVictim: bookingApply,
        });

        expect(result.subAttacks[0].victimIds).toContain('origin');
        // origin died on sub-attack 0 → later sub-attacks re-anchor and must not list it.
        expect(result.subAttacks[1].victimIds).not.toContain('origin');
        expect(result.subAttacks[2].victimIds).not.toContain('origin');
    });
});
