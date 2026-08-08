/**
 * Per-victim crit seam: rollVictimCrit callback.
 *
 * Validates that when `rollVictimCrit` is supplied, the ANCHOR victim reuses
 * `hitCrits[h]` while COVERED victims resolve their crit via the callback.
 * When the callback is unsupplied, every victim (anchor and covered) uses
 * `hitCrits[h]` — byte-identical to the pre-seam behaviour.
 */
import { describe, it, expect } from 'vitest';
import { parsePattern, parseTarget } from '../../targetingParser';
import { applyPositionalDamage } from '../positionalApply';
import type { AttackerDamageScalars, VictimDefenseProfile } from '../victimDamage';
import type { CombatActor } from '../state';

const actor = (id: string, position: CombatActor['position'], currentHp = 1e9): CombatActor =>
    ({ id, position, currentHp }) as CombatActor;

/**
 * Scalars with effectiveCritDamage=100 so a crit exactly doubles the
 * pre-roleScale damage (×2 multiplier before roleScale folds in).
 * hits=1 keeps the footprint stable across the single hit.
 */
const scalars = (): AttackerDamageScalars => ({
    effectiveAttack: 1000,
    multiplierPct: 100,
    secondaryStatValue: 0,
    hits: 1,
    effectiveCritDamage: 100, // crit multiplier = 1 + 100/100 = 2×
    outgoingDamageBuffPct: 0,
    incomingDamageModifierPct: 0,
    defensePenetrationPct: 0,
    attackerAffinity: 'chemical',
});

// Neutral affinity, no defence — pure crit-multiplier signal.
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

describe('applyPositionalDamage — rollVictimCrit callback (per-victim crit seam)', () => {
    /**
     * AoE setup: Pattern-Line-Range-1 @ M4 → origin M4 (anchor), covered M3.
     * hitCrits=[false]  → anchor does NOT crit.
     * rollVictimCrit = (v) => v.id === 'covered'  → covered DOES crit.
     *
     * With effectiveCritDamage=100 and roleScale 0.5 for covered:
     *   anchor damage  = preCritPerHit × 1 (no crit)  × 1.0 (origin  roleScale)
     *   covered damage = preCritPerHit × 2 (crit)     × 0.5 (covered roleScale)
     *   → covered damage == anchor damage (crit×2 exactly cancels roleScale×0.5)
     *
     * The key assertion is that the COVERED victim's emitHit.didCrit === true
     * while the ANCHOR victim's emitHit.didCrit === false.
     */
    it('anchor uses hitCrits[h]=false; covered uses rollVictimCrit → true', () => {
        const pattern = parsePattern('Pattern-Line-Range-1');
        const target = parseTarget('front');
        const anchorActor = actor('origin', 'M4');
        const coveredActor = actor('covered', 'M3');
        const opposingLiving = [anchorActor, coveredActor];

        const emitCalls: Call[] = [];

        applyPositionalDamage({
            hitCrits: [false], // anchor must NOT crit
            scalars: scalars(),
            pattern,
            actorPosition: 'M2',
            target,
            opposingLiving,
            defenseProfileOf: profile,
            applyToVictim: (victim, damage) => {
                victim.currentHp -= damage;
                return { shieldBefore: 0, hpDamage: damage, barriered: false };
            },
            emitHit: (victim, damage, didCrit) => {
                emitCalls.push({ id: victim.id, damage, didCrit });
            },
            // Covered victim crits; anchor does not.
            rollVictimCrit: (v) => v.id === 'covered',
        });

        expect(emitCalls).toHaveLength(2);
        const byId = new Map(emitCalls.map((c) => [c.id, c]));

        const anchorCall = byId.get('origin')!;
        const coveredCall = byId.get('covered')!;

        // Anchor reuses hitCrits[0]=false → no crit
        expect(anchorCall.didCrit).toBe(false);

        // Covered resolves via callback → crits
        expect(coveredCall.didCrit).toBe(true);

        // Covered damage: roleScale 0.5 × crit×2 = same as anchor (1.0 × no-crit×1)
        expect(coveredCall.damage).toBeCloseTo(anchorCall.damage, 6);
    });

    /**
     * Without rollVictimCrit supplied, both anchor and covered use hitCrits[h]=false.
     * This is the byte-identical fallback path.
     */
    it('rollVictimCrit unsupplied → both anchor and covered use hitCrits[h] (false)', () => {
        const pattern = parsePattern('Pattern-Line-Range-1');
        const target = parseTarget('front');
        const anchorActor = actor('origin', 'M4');
        const coveredActor = actor('covered', 'M3');
        const opposingLiving = [anchorActor, coveredActor];

        const emitCalls: Call[] = [];

        applyPositionalDamage({
            hitCrits: [false],
            scalars: scalars(),
            pattern,
            actorPosition: 'M2',
            target,
            opposingLiving,
            defenseProfileOf: profile,
            applyToVictim: (victim, damage) => {
                victim.currentHp -= damage;
                return { shieldBefore: 0, hpDamage: damage, barriered: false };
            },
            emitHit: (victim, damage, didCrit) => {
                emitCalls.push({ id: victim.id, damage, didCrit });
            },
            // No rollVictimCrit → fallback to hitCrits[h]
        });

        expect(emitCalls).toHaveLength(2);
        for (const call of emitCalls) {
            expect(call.didCrit).toBe(false);
        }
        // Covered gets half origin damage (roleScale 0.5, no crit adjustment)
        const anchorCall = emitCalls.find((c) => c.id === 'origin')!;
        const coveredCall = emitCalls.find((c) => c.id === 'covered')!;
        expect(coveredCall.damage).toBeCloseTo(anchorCall.damage * 0.5, 6);
    });

    /**
     * Return value: anchor no-crit, covered crits via rollVictimCrit.
     * anyCrit must be true; critPairs must be 1; critVictimIds names ONLY the covered victim
     * (the crit IDENTITY the on-ally-crit reactive routes "that enemy" off — the anchor did
     * NOT crit, so routing off the cast's selected target would hit the wrong ship).
     */
    it('returns { anyCrit: true, critPairs: 1, critVictimIds: [covered] } when only the covered victim crits', () => {
        const pattern = parsePattern('Pattern-Line-Range-1');
        const target = parseTarget('front');
        const anchorActor = actor('origin', 'M4');
        const coveredActor = actor('covered', 'M3');
        const opposingLiving = [anchorActor, coveredActor];

        const result = applyPositionalDamage({
            hitCrits: [false], // anchor does NOT crit
            scalars: scalars(),
            pattern,
            actorPosition: 'M2',
            target,
            opposingLiving,
            defenseProfileOf: profile,
            applyToVictim: (victim, damage) => {
                victim.currentHp -= damage;
                return { shieldBefore: 0, hpDamage: damage, barriered: false };
            },
            rollVictimCrit: (v) => v.id === 'covered', // only covered crits
        });

        expect(result).toEqual({
            anyCrit: true,
            critPairs: 1,
            critVictimIds: ['covered'],
            subAttacks: [
                {
                    index: 0,
                    whiffed: false,
                    didCrit: true,
                    damage: expect.any(Number),
                    victimIds: ['origin', 'covered'],
                    critVictimIds: ['covered'],
                },
            ],
        });
    });

    /**
     * Return value: nobody crits (hitCrits=[false], no rollVictimCrit).
     * anyCrit must be false; critPairs must be 0.
     */
    it('returns { anyCrit: false, critPairs: 0 } when nobody crits', () => {
        const pattern = parsePattern('Pattern-Line-Range-1');
        const target = parseTarget('front');
        const anchorActor = actor('origin', 'M4');
        const coveredActor = actor('covered', 'M3');
        const opposingLiving = [anchorActor, coveredActor];

        const result = applyPositionalDamage({
            hitCrits: [false],
            scalars: scalars(),
            pattern,
            actorPosition: 'M2',
            target,
            opposingLiving,
            defenseProfileOf: profile,
            applyToVictim: (victim, damage) => {
                victim.currentHp -= damage;
                return { shieldBefore: 0, hpDamage: damage, barriered: false };
            },
            // No rollVictimCrit → fallback to hitCrits[h]=false → nobody crits
        });

        expect(result).toEqual({
            anyCrit: false,
            critPairs: 0,
            critVictimIds: [],
            subAttacks: [
                {
                    index: 0,
                    whiffed: false,
                    didCrit: false,
                    damage: expect.any(Number),
                    victimIds: ['origin', 'covered'],
                    critVictimIds: [],
                },
            ],
        });
    });

    /**
     * When hitCrits[h]=true (anchor crits) and rollVictimCrit returns false for covered,
     * the anchor crits and the covered does NOT.
     */
    it('anchor crits (hitCrits[h]=true); rollVictimCrit=false → covered does NOT crit', () => {
        const pattern = parsePattern('Pattern-Line-Range-1');
        const target = parseTarget('front');
        const anchorActor = actor('origin', 'M4');
        const coveredActor = actor('covered', 'M3');
        const opposingLiving = [anchorActor, coveredActor];

        const emitCalls: Call[] = [];

        applyPositionalDamage({
            hitCrits: [true], // anchor crits
            scalars: scalars(),
            pattern,
            actorPosition: 'M2',
            target,
            opposingLiving,
            defenseProfileOf: profile,
            applyToVictim: (victim, damage) => {
                victim.currentHp -= damage;
                return { shieldBefore: 0, hpDamage: damage, barriered: false };
            },
            emitHit: (victim, damage, didCrit) => {
                emitCalls.push({ id: victim.id, damage, didCrit });
            },
            // Covered does NOT crit; anchor does (via hitCrits)
            rollVictimCrit: (_v) => false,
        });

        expect(emitCalls).toHaveLength(2);
        const byId = new Map(emitCalls.map((c) => [c.id, c]));

        const anchorCall = byId.get('origin')!;
        const coveredCall = byId.get('covered')!;

        expect(anchorCall.didCrit).toBe(true);
        expect(coveredCall.didCrit).toBe(false);

        // With effectiveCritDamage=100: anchor = preCritPerHit × 2 × 1.0
        //                               covered = preCritPerHit × 1 × 0.5
        // → covered = anchor / 4
        expect(coveredCall.damage).toBeCloseTo(anchorCall.damage * 0.25, 6);
    });

    /**
     * critPairs accumulates across multiple HITS: a 2-hit AoE where the covered victim
     * crits on both hits AND the anchor crits on both → 4 critting (hit, victim) pairs.
     */
    it('critPairs counts every critting (hit, victim) pair across multiple hits', () => {
        const pattern = parsePattern('Pattern-Line-Range-1');
        const target = parseTarget('front');
        const anchorActor = actor('origin', 'M4');
        const coveredActor = actor('covered', 'M3');
        const opposingLiving = [anchorActor, coveredActor];

        const result = applyPositionalDamage({
            hitCrits: [true, true], // anchor crits on both hits
            scalars: { ...scalars(), hits: 2 }, // 2-hit AoE, footprint stable
            pattern,
            actorPosition: 'M2',
            target,
            opposingLiving,
            defenseProfileOf: profile,
            applyToVictim: (victim, damage) => {
                victim.currentHp -= damage;
                return { shieldBefore: 0, hpDamage: damage, barriered: false };
            },
            rollVictimCrit: (_v) => true, // covered crits on both hits too
        });

        // 2 hits × 2 victims, all crit → 4 critting pairs, but only 2 DISTINCT crit victims:
        // critVictimIds de-duplicates across hits ("deals X to that enemy" is per enemy, not per
        // critting (hit, victim) pair), and lists them in first-crit order.
        //
        // critPairs (4) and subAttacks.length (2) are DIFFERENT numbers measuring different axes:
        // critPairs multiplies hits × victims, whereas a sub-attack is one full-walk attack whose
        // AoE footprint is a single spread. Do NOT "fix" either to match the other.
        expect(result).toEqual({
            anyCrit: true,
            critPairs: 4,
            critVictimIds: ['origin', 'covered'],
            subAttacks: [
                {
                    index: 0,
                    whiffed: false,
                    didCrit: true,
                    damage: expect.any(Number),
                    victimIds: ['origin', 'covered'],
                    // Per-SUB-ATTACK crit slice: each sub-attack crit both victims, so Σ of the
                    // two lengths (2 + 2) reproduces the cast-wide critPairs of 4 exactly. This is
                    // the number PR2 puts on each sub-attack's own `ability-performed` as
                    // `critHits` — the cast-wide 4 there would count every crit N times over.
                    critVictimIds: ['origin', 'covered'],
                },
                {
                    index: 1,
                    whiffed: false,
                    didCrit: true,
                    damage: expect.any(Number),
                    victimIds: ['origin', 'covered'],
                    critVictimIds: ['origin', 'covered'],
                },
            ],
        });
    });
});
