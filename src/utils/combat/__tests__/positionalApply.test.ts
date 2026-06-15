import { describe, it, expect } from 'vitest';
import { parsePattern, parseTarget } from '../../targetingParser';
import { footprintVictims, applyPositionalDamage } from '../positionalApply';
import type { AttackerDamageScalars, VictimDefenseProfile } from '../victimDamage';
import type { CombatActor } from '../state';

const actor = (id: string, position: CombatActor['position'], currentHp = 100): CombatActor =>
    ({ id, position, currentHp }) as CombatActor;

describe('footprintVictims', () => {
    it('single-target pattern (origin only) → origin occupant at roleScale 1.0', () => {
        const pattern = parsePattern('Pattern-Base');
        const living = [actor('front', 'M4'), actor('back', 'M1')];

        const hits = footprintVictims(pattern, 'M4', living);

        expect(hits).toHaveLength(1);
        expect(hits[0].victim.id).toBe('front');
        expect(hits[0].roleScale).toBe(1.0);
    });

    it('AoE pattern with occupants at origin + covered → origin 1.0, covered 0.5', () => {
        // Pattern-Line-Range-1 @ M4 → origin M4, covered M3.
        const pattern = parsePattern('Pattern-Line-Range-1');
        const living = [actor('origin', 'M4'), actor('covered', 'M3'), actor('elsewhere', 'M1')];

        const hits = footprintVictims(pattern, 'M4', living);

        expect(hits).toHaveLength(2);
        const byId = new Map(hits.map((h) => [h.victim.id, h.roleScale]));
        expect(byId.get('origin')).toBe(1.0);
        expect(byId.get('covered')).toBe(0.5);
        expect(byId.has('elsewhere')).toBe(false);
    });

    it('covered cell with NO living occupant contributes nothing', () => {
        // Pattern-Line-Range-1 @ M4 → origin M4, covered M3. M3 is empty.
        const pattern = parsePattern('Pattern-Line-Range-1');
        const living = [actor('origin', 'M4')];

        const hits = footprintVictims(pattern, 'M4', living);

        expect(hits).toHaveLength(1);
        expect(hits[0].victim.id).toBe('origin');
        expect(hits[0].roleScale).toBe(1.0);
    });

    it('dead actor (currentHp 0) at a covered cell is excluded', () => {
        const pattern = parsePattern('Pattern-Line-Range-1');
        const living = [actor('origin', 'M4'), actor('deadCovered', 'M3', 0)];

        const hits = footprintVictims(pattern, 'M4', living);

        expect(hits).toHaveLength(1);
        expect(hits[0].victim.id).toBe('origin');
    });
});

// Minimal scalars/profile — affinity neutral so damage is finite and predictable.
const scalars = (): AttackerDamageScalars => ({
    effectiveAttack: 1000,
    multiplierPct: 100,
    secondaryStatValue: 0,
    hits: 3,
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

interface Call {
    id: string;
    damage: number;
    didCrit: boolean;
}

describe('applyPositionalDamage', () => {
    it('3-hit single-target: anchor dies on hit 1 → hits 2-3 redirect to next living target', () => {
        const pattern = parsePattern('Pattern-Base');
        const target = parseTarget('front');
        // front-most (col 4) anchor first, then a back target with plenty of HP.
        const anchorActor = actor('anchor', 'M4', 1);
        const next = actor('next', 'M1', 1e9);
        const opposingLiving = [anchorActor, next];

        const applyCalls: Call[] = [];
        const emitCalls: Call[] = [];

        applyPositionalDamage({
            hits: 3,
            hitCrits: [false, false, false],
            scalars: scalars(),
            pattern,
            actorPosition: 'M2',
            target,
            opposingLiving,
            defenseProfileOf: profile,
            // Real decrement: anchor (1 HP) dies on hit 1; next (1e9 HP) survives all hits.
            applyToVictim: (victim, damage) => {
                applyCalls.push({ id: victim.id, damage, didCrit: false });
                victim.currentHp -= damage;
            },
            emitHit: (victim, damage, didCrit) => {
                emitCalls.push({ id: victim.id, damage, didCrit });
            },
        });

        // Hit 1 → anchor (dies). Hits 2-3 re-resolve to `next` (the only living target left).
        expect(applyCalls.map((c) => c.id)).toEqual(['anchor', 'next', 'next']);
        expect(emitCalls.map((c) => c.id)).toEqual(['anchor', 'next', 'next']);
        expect(anchorActor.currentHp).toBeLessThanOrEqual(0);
        expect(next.currentHp).toBeGreaterThan(0);
    });

    it('all opposing dead before a hit → whiff: neither applyToVictim nor emitHit invoked', () => {
        const pattern = parsePattern('Pattern-Base');
        const target = parseTarget('front');
        const only = actor('only', 'M4');
        const opposingLiving = [only];

        const applyCalls: Call[] = [];
        const emitCalls: Call[] = [];

        applyPositionalDamage({
            hits: 3,
            hitCrits: [false, false, false],
            scalars: scalars(),
            pattern,
            actorPosition: 'M2',
            target,
            opposingLiving,
            defenseProfileOf: profile,
            applyToVictim: (victim, damage) => {
                applyCalls.push({ id: victim.id, damage, didCrit: false });
                victim.currentHp = 0;
            },
            emitHit: (victim, damage, didCrit) => {
                emitCalls.push({ id: victim.id, damage, didCrit });
            },
        });

        // Only one living target → hit 1 kills it, hits 2-3 whiff (no calls).
        expect(applyCalls.map((c) => c.id)).toEqual(['only']);
        expect(emitCalls.map((c) => c.id)).toEqual(['only']);
    });

    it('AoE multi-hit: each hit applies origin (full) + covered (half)', () => {
        // Pattern-Line-Range-1 @ M4 → origin M4, covered M3.
        const pattern = parsePattern('Pattern-Line-Range-1');
        const target = parseTarget('front');
        const origin = actor('origin', 'M4', 1e9);
        const covered = actor('covered', 'M3', 1e9);
        const opposingLiving = [origin, covered];

        const emitCalls: Call[] = [];

        applyPositionalDamage({
            hits: 2,
            hitCrits: [false, false],
            scalars: scalars(),
            pattern,
            actorPosition: 'M2',
            target,
            opposingLiving,
            defenseProfileOf: profile,
            // High HP, real damage decrement — nobody dies, so footprint stays stable.
            applyToVictim: (victim, damage) => {
                victim.currentHp -= damage;
            },
            emitHit: (victim, damage, didCrit) => {
                emitCalls.push({ id: victim.id, damage, didCrit });
            },
        });

        // 2 hits × (origin + covered) = 4 calls.
        expect(emitCalls).toHaveLength(4);
        const originCalls = emitCalls.filter((c) => c.id === 'origin');
        const coveredCalls = emitCalls.filter((c) => c.id === 'covered');
        expect(originCalls).toHaveLength(2);
        expect(coveredCalls).toHaveLength(2);
        // Covered cell takes exactly half the origin cell's per-hit damage (roleScale 0.5).
        expect(coveredCalls[0].damage).toBeCloseTo(originCalls[0].damage * 0.5, 6);
    });

    it('hitCrits shorter than hits → missing entries treated as false (no crash)', () => {
        const pattern = parsePattern('Pattern-Base');
        const target = parseTarget('front');
        const only = actor('only', 'M4', 1e9);
        const opposingLiving = [only];

        const emitCalls: Call[] = [];

        expect(() =>
            applyPositionalDamage({
                hits: 3,
                hitCrits: [true], // only one entry; hits 2-3 fall back to false
                scalars: { ...scalars(), effectiveCritDamage: 50 },
                pattern,
                actorPosition: 'M2',
                target,
                opposingLiving,
                defenseProfileOf: profile,
                applyToVictim: (victim, damage) => {
                    victim.currentHp -= damage;
                },
                emitHit: (victim, damage, didCrit) => {
                    emitCalls.push({ id: victim.id, damage, didCrit });
                },
            })
        ).not.toThrow();

        expect(emitCalls.map((c) => c.didCrit)).toEqual([true, false, false]);
    });
});
