import { describe, it, expect } from 'vitest';
import { calculateBuffTotals, outgoingFamiliesOf, shadowedOutgoingDelta } from '../buffTotals';
import { deriveFamilyKey } from '../statusEngine';
import { toSimBuffs } from '../../calculators/dpsBuffHelpers';
import type { SelectedGameBuff } from '../../../types/calculator';

/**
 * DIRECT unit tests on #389's cross-store family shadowing — `deriveFamilyKey`,
 * `outgoingFamiliesOf` and `shadowedOutgoingDelta`.
 *
 * WHY THESE EXIST, and why they are not "cleanup". The shipped fix arrived guarded ONLY through
 * `simulateDefenseSurvivability`, and the review measured what that bought: collapsing every
 * family into a single key — the exact defect spec §5.2 forbids — reddened exactly ONE assertion
 * in the whole 6,548-test suite, and that one was an incidental sub-case appended to a different
 * arm. Both blockers the review then found (a magnitude-only comparison where the rule says tier,
 * and a delta that subtracted the strongest self instance where the totals hold their sum) are
 * pure arithmetic in these three functions and needed no engine at all to catch.
 *
 * THE CURRENCY. Where an arm is about the RESULT rather than the delta, it folds the self list with
 * `calculateBuffTotals(toSimBuffs(...))` — literally what `resolveSelfBuffTotals` does — and adds
 * the delta to it, so the assertion is on the number the damage formula would actually use. That
 * is what makes the max-vs-sum distinction visible: the delta alone cannot show it.
 */

let idCounter = 0;
const buff = (
    buffName: string,
    parsedEffects: SelectedGameBuff['parsedEffects'],
    stacks = 1
): SelectedGameBuff => ({
    id: `b${++idCounter}`,
    buffName,
    stacks,
    parsedEffects,
    isStackable: false,
});

/** Real corpus values (src/constants/buffs.ts): I = -15%, II = -30%, III = -45%. */
const AD = (tier: 'I' | 'II' | 'III', stacks = 1) =>
    buff(`Attack Down ${tier}`, { attack: { I: -15, II: -30, III: -45 }[tier] }, stacks);
const OD = (tier: 'I' | 'II' | 'III', stacks = 1) =>
    buff(
        `Out. Damage Down ${tier}`,
        { outgoingDamage: { I: -15, II: -30, III: -45 }[tier] },
        stacks
    );

/** The self-side total the caller already holds, in the caller's own arithmetic. */
const selfAttackTotal = (buffs: SelectedGameBuff[]) =>
    calculateBuffTotals(toSimBuffs(buffs)).attackBuff;
const selfOutgoingTotal = (buffs: SelectedGameBuff[]) =>
    calculateBuffTotals(toSimBuffs(buffs)).outgoingDamageBuff;

describe('deriveFamilyKey', () => {
    // Newly public for #389, and cross-store shadowing now keys off it — a change to the
    // Roman-suffix handling silently changes which instances shadow each other.
    it('strips a Roman suffix into a family key plus a tier', () => {
        expect(deriveFamilyKey('Attack Down I')).toEqual({ familyKey: 'Attack Down', tier: 1 });
        expect(deriveFamilyKey('Attack Down III')).toEqual({ familyKey: 'Attack Down', tier: 3 });
        expect(deriveFamilyKey('Out. Damage Down II')).toEqual({
            familyKey: 'Out. Damage Down',
            tier: 2,
        });
    });

    it('gives an un-suffixed name its own key at tier 0', () => {
        expect(deriveFamilyKey('Overload')).toEqual({ familyKey: 'Overload', tier: 0 });
    });

    it('keeps DoTs and bombs OUT of families — they stack, per spec §6', () => {
        // The whole exception set. Each tier is its own entity, so the tier is deliberately 0 and
        // the key keeps its suffix: an Inferno II must never shadow an Inferno I.
        expect(deriveFamilyKey('Inferno I')).toEqual({ familyKey: 'Inferno I', tier: 0 });
        expect(deriveFamilyKey('Corrosion III')).toEqual({ familyKey: 'Corrosion III', tier: 0 });
        expect(deriveFamilyKey('Bomb II')).toEqual({ familyKey: 'Bomb II', tier: 0 });
    });

    it('does not treat an Up and a Down as one family', () => {
        expect(deriveFamilyKey('Attack Up II').familyKey).not.toBe(
            deriveFamilyKey('Attack Down II').familyKey
        );
    });
});

describe('outgoingFamiliesOf', () => {
    it('keys by family, not by name, and reports tier, strongest instance and sum', () => {
        const m = outgoingFamiliesOf([AD('III')]);
        expect([...m.keys()]).toEqual(['Attack Down']);
        expect(m.get('Attack Down')?.attack).toEqual({ pct: -45, tier: 3, sum: -45 });
    });

    it('keeps DIFFERENT families in DIFFERENT buckets', () => {
        // The direct guard on spec §5.2. This is the assertion the family-collapse mutation
        // (`deriveFamilyKey` replaced by a constant key) cannot survive — the pre-existing sim arm
        // could not see it, because the two channels are carried independently and these two
        // families touch different ones.
        const m = outgoingFamiliesOf([AD('III'), OD('III'), buff('Attack Up II', { attack: 30 })]);
        expect([...m.keys()].sort()).toEqual(['Attack Down', 'Attack Up', 'Out. Damage Down']);
    });

    it('multiplies by stacks — a family strength is post-stacks', () => {
        expect(outgoingFamiliesOf([AD('I', 4)]).get('Attack Down')?.attack).toEqual({
            pct: -60,
            tier: 1,
            sum: -60,
        });
    });

    it('lets the HIGHER TIER win even when the lower tier carries more magnitude', () => {
        // B1, at its root. Magnitude-only comparison (what shipped) reported -60 here; the rule is
        // tier first, so the III instance is the family's strength and the I is shadowed.
        const m = outgoingFamiliesOf([AD('I', 4), AD('III')]);
        expect(m.get('Attack Down')?.attack.pct).toBe(-45);
        expect(m.get('Attack Down')?.attack.tier).toBe(3);
        // ...and the sum still reports what an additive fold of the same list would contain.
        expect(m.get('Attack Down')?.attack.sum).toBe(-105);
    });

    it('is order-independent', () => {
        expect(outgoingFamiliesOf([AD('III'), AD('I', 4)]).get('Attack Down')?.attack).toEqual(
            outgoingFamiliesOf([AD('I', 4), AD('III')]).get('Attack Down')?.attack
        );
    });

    it('falls back to MAGNITUDE at equal tier, which is what discriminates un-suffixed names', () => {
        // `Overload` and every other Roman-less name derives tier 0, so a naive switch to
        // tier-only would make two Overloads tie and the second one silently vanish.
        const m = outgoingFamiliesOf([
            buff('Overload', { outgoingDamage: 10 }, 5),
            buff('Overload', { outgoingDamage: 10 }),
        ]);
        expect(m.get('Overload')?.outgoingDamage).toEqual({ pct: 50, tier: 0, sum: 60 });
        // BOTH ORDERS. With the incumbent listed first, "keep the incumbent on a tie" hides a
        // missing tie-break; the challenger has to be able to win too.
        const reversed = outgoingFamiliesOf([
            buff('Overload', { outgoingDamage: 10 }),
            buff('Overload', { outgoingDamage: 10 }, 5),
        ]);
        expect(reversed.get('Overload')?.outgoingDamage).toEqual({ pct: 50, tier: 0, sum: 60 });
    });

    it('skips buffs that touch neither outgoing channel', () => {
        expect(outgoingFamiliesOf([buff('Crit Rate Up II', { crit: 20 })]).size).toBe(0);
    });

    it('does not let a family lend its tier to a channel it never touched', () => {
        // A zero contribution is not an instance. Were it one, this `Attack Down III` would stand
        // at tier 3 on the outgoing-damage channel and shadow a real instance there.
        const m = outgoingFamiliesOf([AD('III')]);
        expect(m.get('Attack Down')?.outgoingDamage).toEqual({ pct: 0, tier: 0, sum: 0 });
    });

    it('tracks the two channels of one family independently', () => {
        const m = outgoingFamiliesOf([
            buff('Suppression II', { attack: -30, outgoingDamage: -10 }),
            buff('Suppression I', { attack: -15, outgoingDamage: -80 }),
        ]);
        expect(m.get('Suppression')?.attack).toEqual({ pct: -30, tier: 2, sum: -45 });
        // Tier still decides per channel — the tier-2 instance wins the outgoing channel too,
        // despite the tier-1 instance carrying eight times the magnitude there.
        expect(m.get('Suppression')?.outgoingDamage).toEqual({ pct: -10, tier: 2, sum: -90 });
    });
});

describe('shadowedOutgoingDelta', () => {
    it('is a no-op when the enemy applied nothing', () => {
        expect(shadowedOutgoingDelta(new Map(), [AD('III')])).toEqual({
            attackPct: 0,
            outgoingDamagePct: 0,
        });
    });

    it('contributes the whole applied value when the actor carries no instance of the family', () => {
        const delta = shadowedOutgoingDelta(outgoingFamiliesOf([AD('III')]), []);
        expect(delta).toEqual({ attackPct: -45, outgoingDamagePct: 0 });
    });

    it('§5.3 CROSS-STORE: the applied HIGHER tier lands the total on exactly its own value', () => {
        const self = [AD('I')];
        const delta = shadowedOutgoingDelta(outgoingFamiliesOf([AD('III')]), self);
        expect(selfAttackTotal(self) + delta.attackPct).toBe(-45);
        expect(selfAttackTotal(self) + delta.attackPct).not.toBe(-15); // not the weaker instance
        expect(selfAttackTotal(self) + delta.attackPct).not.toBe(-60); // and NOT additive
    });

    it('§5.3 REVERSE: a higher SELF tier stands and the delta is zero', () => {
        const self = [AD('III')];
        const delta = shadowedOutgoingDelta(outgoingFamiliesOf([AD('I')]), self);
        expect(delta.attackPct).toBe(0);
        expect(selfAttackTotal(self) + delta.attackPct).toBe(-45);
    });

    it('does not double an equal tier standing on both sides', () => {
        const self = [AD('III')];
        const delta = shadowedOutgoingDelta(outgoingFamiliesOf([AD('III')]), self);
        expect(delta.attackPct).toBe(0);
        expect(selfAttackTotal(self) + delta.attackPct).toBe(-45);
    });

    it('B1: a STACKED lower self tier is still shadowed by a higher applied tier', () => {
        // The measured divergence between the two rules. Self `Attack Down I` at four stacks puts
        // -60 in the totals; an applied `Attack Down III` is -45. Magnitude-only left the total at
        // -60 — simultaneously weaker-tier-wins and past every single instance in the fight.
        const self = [AD('I', 4)];
        expect(selfAttackTotal(self)).toBe(-60);
        const delta = shadowedOutgoingDelta(outgoingFamiliesOf([AD('III')]), self);
        expect(selfAttackTotal(self) + delta.attackPct).toBe(-45);
    });

    it('B2: DUPLICATE self instances of one family do not leak into the result', () => {
        // Two entries under the same name — reachable via `selfBuffLookup` accumulating across the
        // attacker and every team actor, and via one family standing in `activeSelfBuffs` and
        // `abilitySelfEffects` at once. The totals hold their SUM (-30), so a delta that subtracted
        // only the strongest (-15) would leave -60 behind: the additive outcome §5.1 forbids.
        const self = [AD('I'), AD('I')];
        expect(selfAttackTotal(self)).toBe(-30);
        const delta = shadowedOutgoingDelta(outgoingFamiliesOf([AD('III')]), self);
        expect(delta.attackPct).toBe(-15);
        expect(selfAttackTotal(self) + delta.attackPct).toBe(-45);
    });

    it('B2: the result never overshoots the applied value, however many duplicates stand', () => {
        for (const copies of [1, 2, 3, 5]) {
            const self = Array.from({ length: copies }, () => AD('II'));
            const delta = shadowedOutgoingDelta(outgoingFamiliesOf([AD('III')]), self);
            expect(selfAttackTotal(self) + delta.attackPct).toBe(-45);
        }
    });

    it('§5.3 CROSS-FAMILY: a different family on the SAME channel is not shadowed', () => {
        // The guard against over-collapsing, in the one shape that can see it: an `Attack Up` the
        // actor self-buffs against an applied `Attack Down`. Both apply and they net out.
        const self = [buff('Attack Up II', { attack: 30 })];
        const delta = shadowedOutgoingDelta(outgoingFamiliesOf([AD('III')]), self);
        expect(delta.attackPct).toBe(-45);
        expect(selfAttackTotal(self) + delta.attackPct).toBe(-15);
    });

    it('§5.3 CROSS-FAMILY: the two outgoing channels stay separate', () => {
        const self = [AD('III')];
        const delta = shadowedOutgoingDelta(outgoingFamiliesOf([AD('III'), OD('III')]), self);
        expect(delta.attackPct).toBe(0); // same family, equal tier — shadowed
        expect(delta.outgoingDamagePct).toBe(-45); // different family — applies in full
    });

    it('does not shadow across channels within one family', () => {
        // Self carries the family only on the ATTACK channel; the applied instance of the same
        // family touches only OUTGOING DAMAGE. It must land in full, and must not have the self
        // side's attack sum subtracted from it.
        const self = [AD('II')];
        const applied = outgoingFamiliesOf([buff('Attack Down III', { outgoingDamage: -45 })]);
        const delta = shadowedOutgoingDelta(applied, self);
        expect(delta.outgoingDamagePct).toBe(-45);
        expect(selfOutgoingTotal(self) + delta.outgoingDamagePct).toBe(-45);
    });

    it('sums the deltas of SEVERAL applied families', () => {
        const delta = shadowedOutgoingDelta(outgoingFamiliesOf([AD('II'), OD('I')]), []);
        expect(delta).toEqual({ attackPct: -30, outgoingDamagePct: -15 });
    });

    it('discriminates un-suffixed names by magnitude, both directions', () => {
        // Tier 0 on both sides, so the tie-break is all there is. This is why the fix could not
        // simply switch to tier.
        const bigSelf = [buff('Overload', { outgoingDamage: 10 }, 5)];
        const smallApplied = outgoingFamiliesOf([buff('Overload', { outgoingDamage: 10 })]);
        expect(shadowedOutgoingDelta(smallApplied, bigSelf).outgoingDamagePct).toBe(0);

        const smallSelf = [buff('Overload', { outgoingDamage: 10 })];
        const bigApplied = outgoingFamiliesOf([buff('Overload', { outgoingDamage: 10 }, 5)]);
        const delta = shadowedOutgoingDelta(bigApplied, smallSelf);
        expect(selfOutgoingTotal(smallSelf) + delta.outgoingDamagePct).toBe(50);
    });
});
