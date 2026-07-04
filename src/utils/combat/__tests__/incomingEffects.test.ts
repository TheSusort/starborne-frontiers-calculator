import { describe, it, expect } from 'vitest';
import { incomingReductionForHit, incomingBlockForIntake } from '../incomingEffects';
import { Ability, IncomingCondition, IncomingHitContext } from '../../../types/abilities';

const ctx = (over: Partial<IncomingHitContext> = {}): IncomingHitContext => ({
    didCrit: false,
    attackerStealthed: false,
    victimStealthed: false,
    victimStasised: false,
    hitIndexThisRound: 1,
    attackerHasDot: false,
    victimHasBarrierRecharging: false,
    selfHpPct: 100,
    ...over,
});

const reduction = (
    condition: IncomingCondition,
    pct: number,
    critFamily: boolean,
    scope: 'direct' | 'dot' = 'direct'
): Ability => ({
    id: `r-${condition}-${pct}`,
    type: 'incoming-reduction',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'incoming-reduction', scope, condition, pct, critFamily },
});

const hpScalingReduction = (
    perUnit: number,
    cap: number,
    scope: 'direct' | 'dot' = 'direct'
): Ability => ({
    id: `r-hpscale-${scope}`,
    type: 'incoming-reduction',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'incoming-reduction',
        scope,
        condition: 'always',
        pct: 0,
        critFamily: false,
        hpScaling: { perUnit, cap },
    },
});

const block = (
    condition: 'self-stealth' | 'nth-hit-2plus',
    procChance: number,
    blockPct: number,
    oncePerRound: boolean
): Ability => ({
    id: `b-${condition}`,
    type: 'incoming-block',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'incoming-block', condition, procChance, blockPct, oncePerRound },
});

describe('incomingReductionForHit', () => {
    it('non-crit-family reductions add (Voidshade self-stealth + Nebula self-stasis)', () => {
        const a = [reduction('self-stealth', 20, false), reduction('self-stasis', 35, false)];
        expect(
            incomingReductionForHit(a, ctx({ victimStealthed: true, victimStasised: true }))
        ).toBe(55);
    });
    it('self-stealth reduction inert when not stealthed', () => {
        expect(incomingReductionForHit([reduction('self-stealth', 20, false)], ctx())).toBe(0);
    });
    it('crit-family reductions take MAX not sum (Hardened 5 + Iridium 35 on a crit → 35)', () => {
        const a = [reduction('incoming-crit', 5, true), reduction('incoming-crit', 35, true)];
        expect(incomingReductionForHit(a, ctx({ didCrit: true }))).toBe(35);
    });
    it('crit-family inert on a non-crit hit', () => {
        expect(
            incomingReductionForHit([reduction('incoming-crit', 35, true)], ctx({ didCrit: false }))
        ).toBe(0);
    });
    it('crit-family MAX adds to non-crit-family sum (20 + max(5,35)=35 → 55)', () => {
        const a = [
            reduction('self-stealth', 20, false),
            reduction('incoming-crit', 5, true),
            reduction('incoming-crit', 35, true),
        ];
        expect(incomingReductionForHit(a, ctx({ didCrit: true, victimStealthed: true }))).toBe(55);
    });
    it('Hyperion gates on crit AND attacker-stealthed', () => {
        const a = [reduction('incoming-crit-by-stealthed', 35, true)];
        expect(incomingReductionForHit(a, ctx({ didCrit: true, attackerStealthed: true }))).toBe(
            35
        );
        expect(incomingReductionForHit(a, ctx({ didCrit: true, attackerStealthed: false }))).toBe(
            0
        );
        expect(incomingReductionForHit(a, ctx({ didCrit: false, attackerStealthed: true }))).toBe(
            0
        );
    });
    it('dot-scope reductions apply only on the dot path', () => {
        const a = [reduction('dot-inferno-corrosion', 30, false, 'dot')];
        expect(incomingReductionForHit(a, ctx({ dotType: 'inferno' }))).toBe(30);
        expect(incomingReductionForHit(a, ctx())).toBe(0);
    });
    it('direct-scope reductions never fire on a dot tick', () => {
        const a = [reduction('self-stealth', 20, false)];
        expect(
            incomingReductionForHit(a, ctx({ victimStealthed: true, dotType: 'corrosion' }))
        ).toBe(0);
    });

    // Epic PR12(C): the three new IncomingCondition values (attacker-has-dot,
    // self-barrier-recharging, always+hpScaling). Would FAIL pre-epic-PR12: `conditionMet`'s
    // switch had no case for any of these three, and `hpScaling` didn't exist on the
    // incoming-reduction config at all (TypeScript would reject the fixture).
    it('Anemone (attacker-has-dot): fires only when the ATTACKER carries a live DoT', () => {
        const a = [reduction('attacker-has-dot', 25, false)];
        expect(incomingReductionForHit(a, ctx({ attackerHasDot: true }))).toBe(25);
        expect(incomingReductionForHit(a, ctx({ attackerHasDot: false }))).toBe(0);
    });
    it('Panon (self-barrier-recharging): fires only when the VICTIM carries the named self-status', () => {
        const a = [reduction('self-barrier-recharging', 20, false)];
        expect(incomingReductionForHit(a, ctx({ victimHasBarrierRecharging: true }))).toBe(20);
        expect(incomingReductionForHit(a, ctx({ victimHasBarrierRecharging: false }))).toBe(0);
    });
    it('Tormenter (always + hpScaling): reduction scales linearly with missing HP, capped', () => {
        const a = [hpScalingReduction(0.3, 30)];
        // Full HP (0% missing) → 0 reduction.
        expect(incomingReductionForHit(a, ctx({ selfHpPct: 100 }))).toBe(0);
        // Half HP (50% missing) → 0.3 * 50 = 15.
        expect(incomingReductionForHit(a, ctx({ selfHpPct: 50 }))).toBeCloseTo(15, 6);
        // Zero HP (100% missing) → 0.3 * 100 = 30, exactly at the cap.
        expect(incomingReductionForHit(a, ctx({ selfHpPct: 0 }))).toBeCloseTo(30, 6);
        // A hypothetical steeper perUnit is still capped at 30 (cap wins over the raw formula).
        expect(incomingReductionForHit([hpScalingReduction(1, 30)], ctx({ selfHpPct: 0 }))).toBe(
            30
        );
    });
    it('hpScaling on a "direct" scope entry is inert during a DoT tick (scope mismatch)', () => {
        const a = [hpScalingReduction(0.3, 30, 'direct')];
        expect(incomingReductionForHit(a, ctx({ selfHpPct: 0, dotType: 'inferno' }))).toBe(0);
    });
});

describe('incomingBlockForIntake', () => {
    const yes = () => true;
    const no = () => false;
    it('Shadowguard full block (self-stealth) → 1.0 when it procs', () => {
        expect(
            incomingBlockForIntake(
                [block('self-stealth', 0.16, 1, true)],
                ctx({ victimStealthed: true }),
                yes
            )
        ).toBe(1);
    });
    it('Shadowguard inert when not stealthed', () => {
        expect(
            incomingBlockForIntake(
                [block('self-stealth', 0.16, 1, true)],
                ctx({ victimStealthed: false }),
                yes
            )
        ).toBe(0);
    });
    it('Ironclad partial block only on the 2nd+ intake', () => {
        const a = [block('nth-hit-2plus', 0.2, 0.5, false)];
        expect(incomingBlockForIntake(a, ctx({ hitIndexThisRound: 1 }), yes)).toBe(0);
        expect(incomingBlockForIntake(a, ctx({ hitIndexThisRound: 2 }), yes)).toBe(0.5);
    });
    it('no block when the roll fails', () => {
        expect(
            incomingBlockForIntake(
                [block('nth-hit-2plus', 0.2, 0.5, false)],
                ctx({ hitIndexThisRound: 2 }),
                no
            )
        ).toBe(0);
    });
    it('full block supersedes partial when both proc', () => {
        const a = [block('self-stealth', 0.16, 1, true), block('nth-hit-2plus', 0.2, 0.5, false)];
        expect(
            incomingBlockForIntake(a, ctx({ victimStealthed: true, hitIndexThisRound: 2 }), yes)
        ).toBe(1);
    });
    it('returns 0 with no block abilities', () => {
        expect(incomingBlockForIntake([], ctx({ hitIndexThisRound: 2 }), yes)).toBe(0);
    });
});
