import { describe, it, expect } from 'vitest';
import { victimHitDamage, AttackerDamageScalars, VictimDefenseProfile } from '../victimDamage';
import { calculateDamageReduction } from '../../autogear/priorityScore';
import { computeAffinityModifiers } from '../../calculators/affinityUtils';

describe('victimHitDamage', () => {
    it('(a) hand-computed single-hit value: no crit, no buffs, neutral affinity', () => {
        // Simple inputs: 1 hit, no crit, no buffs/modifiers, no pen.
        // effectiveAttack = 1000, multiplierPct = 100 (raw 100 * 1 hit), no secondary.
        // preCritDamage = 1000 * (100/100) + 0 = 1000
        // victim defence = 1000, no modifier, no pen → effectiveDefense = 1000
        // damageReduction = calculateDamageReduction(1000)
        // nonCritFactor = (1 - dr/100) * 1 * 1 * 1
        // per-hit (no crit, roleScale 1) = (1000/1) * 1 * nonCritFactor
        const s: AttackerDamageScalars = {
            effectiveAttack: 1000,
            multiplierPct: 100,
            secondaryStatValue: 0,
            hits: 1,
            effectiveCritDamage: 50,
            outgoingDamageBuffPct: 0,
            incomingDamageModifierPct: 0,
            defensePenetrationPct: 0,
            attackerAffinity: 'antimatter', // neutral vs anything
        };
        const v: VictimDefenseProfile = {
            defence: 1000,
            defenceModifierPct: 0,
            affinity: 'thermal',
        };

        const dr = calculateDamageReduction(1000);
        const expected = 1000 * (1 - dr / 100);

        expect(victimHitDamage(s, v, false, 1)).toBeCloseTo(expected, 10);
    });

    it('(b) PARITY: sum of per-hit damages equals aggregate preCritDamage * postDefenseFactor', () => {
        // Mirror the engine's aggregate formula inline from the same inputs.
        const effectiveAttack = 1234;
        const rawMultiplier = 80;
        const hits = 4;
        const effectiveMultiplier = rawMultiplier * hits; // 320 — multiplier ALREADY includes hits
        const conditionalBonusPct = 35;
        const secondaryStatValue = 217.5;
        const effectiveCritDamage = 65;
        const outgoingDamageBuffPct = 30;
        const incomingDamageModifierPct = -10;
        const defensePenetrationPct = 20;

        const victimDefence = 850;
        const victimDefenceModifierPct = 15;
        const attackerAffinity = 'thermal';
        const victimAffinity = 'chemical'; // thermal > chemical → advantage

        // Aggregate side (replicating playerTurn lines 1115-1276).
        const effectivePen = defensePenetrationPct;
        const effectiveDefense =
            victimDefence * (1 + victimDefenceModifierPct / 100) * (1 - effectivePen / 100);
        const damageReduction =
            effectiveDefense > 0 ? calculateDamageReduction(effectiveDefense) : 0;
        const affinityDamageModifier = computeAffinityModifiers(
            attackerAffinity,
            victimAffinity
        ).damageModifier;
        const affinityMult = 1 + affinityDamageModifier / 100;
        const preCritDamage =
            effectiveAttack * ((effectiveMultiplier + conditionalBonusPct) / 100) +
            secondaryStatValue;
        const nonCritFactor =
            (1 - damageReduction / 100) *
            (1 + outgoingDamageBuffPct / 100) *
            (1 + incomingDamageModifierPct / 100) *
            affinityMult;

        // A fixed per-hit crit pattern across the 4 hits.
        const hitCrits = [true, false, true, false];
        const critHits = hitCrits.filter(Boolean).length;
        const critFraction = hits > 0 ? critHits / hits : 0;
        const damageCritMultiplier = 1 + critFraction * (effectiveCritDamage / 100);
        const postDefenseFactor = damageCritMultiplier * nonCritFactor;
        const aggregate = preCritDamage * postDefenseFactor;

        // Per-victim side.
        const s: AttackerDamageScalars = {
            effectiveAttack,
            multiplierPct: effectiveMultiplier + conditionalBonusPct,
            secondaryStatValue,
            hits,
            effectiveCritDamage,
            outgoingDamageBuffPct,
            incomingDamageModifierPct,
            defensePenetrationPct,
            attackerAffinity,
        };
        const v: VictimDefenseProfile = {
            defence: victimDefence,
            defenceModifierPct: victimDefenceModifierPct,
            affinity: victimAffinity,
        };

        const sum = hitCrits.reduce((acc, didCrit) => acc + victimHitDamage(s, v, didCrit, 1), 0);

        expect(sum).toBeCloseTo(aggregate, 10);
    });

    it('(c) roleScale 0.5 yields exactly half the roleScale 1.0 damage', () => {
        const s: AttackerDamageScalars = {
            effectiveAttack: 900,
            multiplierPct: 240,
            secondaryStatValue: 120,
            hits: 3,
            effectiveCritDamage: 55,
            outgoingDamageBuffPct: 20,
            incomingDamageModifierPct: 5,
            defensePenetrationPct: 10,
            attackerAffinity: 'electric',
        };
        const v: VictimDefenseProfile = {
            defence: 700,
            defenceModifierPct: -5,
            affinity: 'thermal',
        };

        const origin = victimHitDamage(s, v, true, 1);
        const covered = victimHitDamage(s, v, true, 0.5);

        expect(covered).toBeCloseTo(origin * 0.5, 12);
    });

    it('(e) equipReductionPct folds additively into the incoming term, reducing damage', () => {
        const s: AttackerDamageScalars = {
            effectiveAttack: 1000,
            multiplierPct: 100,
            secondaryStatValue: 0,
            hits: 1,
            effectiveCritDamage: 50,
            outgoingDamageBuffPct: 0,
            incomingDamageModifierPct: 0,
            defensePenetrationPct: 0,
            attackerAffinity: 'antimatter',
        };
        const v: VictimDefenseProfile = {
            defence: 0, // no defense reduction so the incoming factor dominates cleanly
            defenceModifierPct: 0,
            affinity: 'thermal',
        };

        const base = victimHitDamage(s, v, false, 1); // equipReductionPct defaults to 0
        const reduced = victimHitDamage(s, v, false, 1, 30);

        // incoming = 0 - 30 = -30 → factor (1 + (-30)/100) = 0.7
        expect(reduced).toBeCloseTo(base * 0.7, 10);
    });

    it('(f) equipReductionPct omitted === explicit 0 === current behavior (byte-identical)', () => {
        const s: AttackerDamageScalars = {
            effectiveAttack: 1234,
            multiplierPct: 215,
            secondaryStatValue: 80,
            hits: 2,
            effectiveCritDamage: 65,
            outgoingDamageBuffPct: 20,
            incomingDamageModifierPct: -10,
            defensePenetrationPct: 15,
            attackerAffinity: 'thermal',
        };
        const v: VictimDefenseProfile = {
            defence: 600,
            defenceModifierPct: 10,
            affinity: 'chemical',
        };

        expect(victimHitDamage(s, v, true, 1, 0)).toBe(victimHitDamage(s, v, true, 1));
        expect(victimHitDamage(s, v, false, 0.5, 0)).toBe(victimHitDamage(s, v, false, 0.5));
    });

    it('(d) affinity advantage increases and disadvantage decreases damage', () => {
        const base: AttackerDamageScalars = {
            effectiveAttack: 1000,
            multiplierPct: 150,
            secondaryStatValue: 0,
            hits: 1,
            effectiveCritDamage: 50,
            outgoingDamageBuffPct: 0,
            incomingDamageModifierPct: 0,
            defensePenetrationPct: 0,
            attackerAffinity: 'thermal',
        };
        const v: VictimDefenseProfile = {
            defence: 800,
            defenceModifierPct: 0,
            affinity: 'antimatter', // neutral
        };

        const neutral = victimHitDamage(base, v, false, 1);

        // thermal > chemical → advantage (+25%)
        const advantage = victimHitDamage(base, { ...v, affinity: 'chemical' }, false, 1);
        // thermal < electric → disadvantage (-25%)
        const disadvantage = victimHitDamage(base, { ...v, affinity: 'electric' }, false, 1);

        expect(advantage).toBeGreaterThan(neutral);
        expect(disadvantage).toBeLessThan(neutral);
        expect(advantage).toBeCloseTo(neutral * 1.25, 10);
        expect(disadvantage).toBeCloseTo(neutral * 0.75, 10);
    });
});
