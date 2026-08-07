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
