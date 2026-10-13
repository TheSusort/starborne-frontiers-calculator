import { describe, it, expect } from 'vitest';
import {
    victimHitDamage,
    victimHitDamageParts,
    AttackerDamageScalars,
    VictimDefenseProfile,
    type IncomingReductionParts,
} from '../victimDamage';
import { calculateDamageReduction } from '../../autogear/priorityScore';
import { computeAffinityModifiers } from '../../calculators/affinityUtils';

/** A victim's reductions: ship passives (summed) and separate gear/implant/leader factors. */
const parts = (passivePct: number, separatePcts: number[] = []): IncomingReductionParts => ({
    passivePct,
    separatePcts,
});

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

    it('(e) a passive reduction multiplies the incoming factor by (1 − passive)', () => {
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

        const base = victimHitDamage(s, v, false, 1); // no reduction by default
        const reduced = victimHitDamage(s, v, false, 1, parts(30));

        // passive bucket 30 → factor (1 − 0.30) = 0.7
        expect(reduced).toBeCloseTo(base * 0.7, 10);
    });

    it('(f) an omitted reduction === explicit empty parts (byte-identical)', () => {
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

        expect(victimHitDamage(s, v, true, 1, parts(0))).toBe(victimHitDamage(s, v, true, 1));
        expect(victimHitDamage(s, v, false, 0.5, parts(0))).toBe(victimHitDamage(s, v, false, 0.5));
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// #358 ADDENDUM 3 (C2/C3) — THE MIXED INCOMING CHANNEL, AT THE DAMAGE SITE
//
// `incomingDamageModifierPct` is a SUM of four things and only two of them are victim-side. The
// previous iteration treated it as ATOMIC and left the whole term on the pre-mitigation axis, so a
// defender's own 'Inc. Damage Down II' shrank its own "damage absorbed" headline — the inversion
// this addendum exists to remove. Dropping the term wholesale would have been just as wrong: it
// would have stripped the attacker's 'Out. Damage Up' / 'Exposed' amplification too.
//
// These arms fence the SPLIT itself, at the one place it is applied. `victimSideIncomingPct`
// carries only the victim's own `Inc. Damage Down/Up` family (`selfIncoming`). The squad-leader
// incoming baseline is not on this channel: `hitReductionFor` passes it as a separate factor in
// the `reduction` parts, which the bucket arms below cover (and `preFightModifiersEngine.test.ts`
// pins that it never reaches `victimIncomingModifiers`).
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('victimHitDamageParts — the victim-side / attacker-side incoming split (#358 addendum 3)', () => {
    const scalars = (over: Partial<AttackerDamageScalars> = {}): AttackerDamageScalars => ({
        effectiveAttack: 1000,
        multiplierPct: 100,
        secondaryStatValue: 0,
        hits: 1,
        effectiveCritDamage: 0,
        outgoingDamageBuffPct: 0,
        incomingDamageModifierPct: 0,
        defensePenetrationPct: 0,
        attackerAffinity: 'antimatter',
        ...over,
    });
    // Non-zero defence throughout: with defence 0 the two axes coincide and every arm below would
    // pass on a `preMitigation` that had simply copied `damage`.
    const victim = (over: Partial<VictimDefenseProfile> = {}): VictimDefenseProfile => ({
        defence: 2000,
        defenceModifierPct: 0,
        affinity: 'thermal',
        ...over,
    });

    it('a VICTIM-SIDE reduction lowers `damage` but leaves `preMitigation` untouched', () => {
        const bare = victimHitDamageParts(scalars(), victim(), false, 1);
        // −30% of the mixed channel, ALL of it victim-side (the ship's own Inc. Damage Down, or a
        // squad leader's pre-fight protection — the engine sums them into one field).
        const warded = victimHitDamageParts(
            scalars(),
            victim({ incomingDamageModifierPct: -30, victimSideIncomingPct: -30 }),
            false,
            1
        );
        // It really is a reduction on the axis that measures what ARRIVED…
        expect(warded.damage).toBeCloseTo(bare.damage * 0.7, 10);
        // …and it is invisible on the axis that measures what was THROWN.
        expect(warded.preMitigation).toBeCloseTo(bare.preMitigation, 10);
        // The fixture is live on both counts: the axes are genuinely distinct here.
        expect(bare.preMitigation).toBeGreaterThan(bare.damage);
    });

    it('ATTACKER-APPLIED amplification raises BOTH axes — it is part of the attack as thrown', () => {
        const bare = victimHitDamageParts(scalars(), victim(), false, 1);
        // +40% from 'Out. Damage Up' / 'Exposed': the enemy side applied it, so `victimSideIncomingPct`
        // stays 0 and the whole term survives onto the pre-mitigation axis.
        const amped = victimHitDamageParts(
            scalars(),
            victim({ incomingDamageModifierPct: 40, victimSideIncomingPct: 0 }),
            false,
            1
        );
        expect(amped.damage).toBeCloseTo(bare.damage * 1.4, 10);
        expect(amped.preMitigation).toBeCloseTo(bare.preMitigation * 1.4, 10);
    });

    it('a MIXED channel splits: only the victim-side half comes off the thrown axis', () => {
        // The case that defeats every simpler implementation. +40 attacker amplification and −30
        // victim-side protection ride the SAME summed field (+10 net).
        //   • drop the term wholesale → preMitigation loses the +40 too (too low),
        //   • keep the term wholesale → preMitigation keeps the −30 (too high on `damage`'s axis,
        //     and the shipped bug),
        //   • split it → preMitigation carries exactly +40.
        const bare = victimHitDamageParts(scalars(), victim(), false, 1);
        const mixed = victimHitDamageParts(
            scalars(),
            victim({ incomingDamageModifierPct: 10, victimSideIncomingPct: -30 }),
            false,
            1
        );
        expect(mixed.damage).toBeCloseTo(bare.damage * 1.1, 10);
        expect(mixed.preMitigation).toBeCloseTo(bare.preMitigation * 1.4, 10);
        // Explicit negatives for the two wrong implementations, so neither can pass this arm.
        expect(mixed.preMitigation).not.toBeCloseTo(bare.preMitigation * 1.1, 6); // term kept whole
        expect(mixed.preMitigation).not.toBeCloseTo(bare.preMitigation, 6); // term dropped whole
    });

    it('victim reductions (passive and separate buckets) lower `damage` only, never `preMitigation`', () => {
        const bare = victimHitDamageParts(scalars(), victim(), false, 1);
        const passive = victimHitDamageParts(scalars(), victim(), false, 1, parts(25));
        expect(passive.damage).toBeCloseTo(bare.damage * 0.75, 10);
        expect(passive.preMitigation).toBeCloseTo(bare.preMitigation, 10);
        // separate bucket 20 → 0.8
        const geared = victimHitDamageParts(scalars(), victim(), false, 1, parts(0, [20]));
        expect(geared.damage).toBeCloseTo(bare.damage * 0.8, 10);
        expect(geared.preMitigation).toBeCloseTo(bare.preMitigation, 10);
    });

    it('the buckets compose multiplicatively: buffs × (1 − Σpassive) × Π(1 − separate)', () => {
        const bare = victimHitDamageParts(scalars(), victim(), false, 1);
        // buff −30, passives 25 + 10 (sum 35), separate 20 and 15:
        // 0.70 × 0.65 × 0.80 × 0.85 = 0.30940 (above the 0.30 floor)
        const all = victimHitDamageParts(
            scalars(),
            victim({ incomingDamageModifierPct: -30 }),
            false,
            1,
            parts(35, [20, 15])
        );
        expect(all.damage).toBeCloseTo(bare.damage * 0.7 * 0.65 * 0.8 * 0.85, 10);
        // Not the retired additive sum (1 − 0.30 − 0.35 − 0.20 − 0.15 → floored 0.30).
        expect(all.damage).not.toBeCloseTo(bare.damage * 0.3, 6);
    });

    // ── THE ATTACKER'S CRIT PENALTY IS NOT A VICTIM REDUCTION (#358) ────────────────────────────
    //
    // The attacker's own squad-leader `outgoingCritDamage` penalty makes its crits land smaller,
    // i.e. it shrinks the attack AS THROWN. Stripping it from the thrown axis would over-report
    // "damage absorbed" by exactly that penalty, so it rides its own parameter.
    it('`attackerCritPenaltyPct` shrinks the attack as THROWN: it lowers BOTH axes', () => {
        const bare = victimHitDamageParts(scalars(), victim(), false, 1);
        const nerfedAttacker = victimHitDamageParts(scalars(), victim(), false, 1, undefined, 25);
        expect(nerfedAttacker.damage).toBeCloseTo(bare.damage * 0.75, 10);
        // The pre-mitigation axis falls too, unlike the victim-side buckets above.
        expect(nerfedAttacker.preMitigation).toBeCloseTo(bare.preMitigation * 0.75, 10);
        expect(nerfedAttacker.preMitigation).not.toBeCloseTo(bare.preMitigation, 6);
    });

    it('victim reductions and the attacker crit penalty are INDEPENDENT on the thrown axis', () => {
        // 25 points either way: `damage` matches (both are ×0.75 factors here), the thrown axis
        // separates them.
        const asVictim = victimHitDamageParts(scalars(), victim(), false, 1, parts(25), 0);
        const asAttacker = victimHitDamageParts(scalars(), victim(), false, 1, undefined, 25);
        expect(asAttacker.damage).toBeCloseTo(asVictim.damage, 10);
        expect(asAttacker.preMitigation).toBeLessThan(asVictim.preMitigation);
    });

    it('an absent `victimSideIncomingPct` behaves exactly as 0 (pre-addendum-3 default)', () => {
        // A crit at half role-scale with a live passive reduction — the busiest shape in the
        // function, so the equality below is not a degenerate one.
        const CRIT_SCALARS = scalars({ effectiveCritDamage: 50 });
        const absent = victimHitDamageParts(
            CRIT_SCALARS,
            victim({ incomingDamageModifierPct: -30 }),
            true,
            0.5,
            parts(10)
        );
        const explicitZero = victimHitDamageParts(
            CRIT_SCALARS,
            victim({ incomingDamageModifierPct: -30, victimSideIncomingPct: 0 }),
            true,
            0.5,
            parts(10)
        );
        // Byte-identical (toBe, not toBeCloseTo): the two must reduce to the same expression, so a
        // fixture that omits the field cannot drift from one that sets it to zero.
        expect(absent.damage).toBe(explicitZero.damage);
        expect(absent.preMitigation).toBe(explicitZero.preMitigation);
        // Liveness: the fixture is not trivially zero on either axis.
        expect(absent.preMitigation).toBeGreaterThan(absent.damage);
    });
});

describe('victimHitDamageParts — reflectBase (#678)', () => {
    const scalars = (over: Partial<AttackerDamageScalars> = {}): AttackerDamageScalars => ({
        effectiveAttack: 1500,
        multiplierPct: 140,
        secondaryStatValue: 30,
        hits: 2,
        effectiveCritDamage: 80,
        outgoingDamageBuffPct: 0,
        incomingDamageModifierPct: 0,
        defensePenetrationPct: 0,
        attackerAffinity: 'chemical',
        ...over,
    });
    const victim: VictimDefenseProfile = {
        defence: 2000,
        defenceModifierPct: 0,
        affinity: 'thermal',
    };

    it('is the per-hit pre-crit raw damage: no crit, outgoing, affinity, defence or incoming term', () => {
        const s = scalars();
        const expected = ((1500 * 1.4 + 30) / 2) * 0.5;
        const bare = victimHitDamageParts(s, victim, false, 0.5);
        expect(bare.reflectBase).toBeCloseTo(expected, 10);
        // Crit, +45% outgoing, an incoming reduction and a different affinity move `damage`...
        const loaded = victimHitDamageParts(
            scalars({ outgoingDamageBuffPct: 45, attackerAffinity: 'thermal' }),
            { ...victim, affinity: 'chemical', incomingDamageModifierPct: -20 },
            true,
            0.5,
            parts(30)
        );
        expect(loaded.damage).not.toBeCloseTo(bare.damage, 3);
        // ...and leave `reflectBase` exactly where it was.
        expect(loaded.reflectBase).toBeCloseTo(expected, 10);
    });
});
