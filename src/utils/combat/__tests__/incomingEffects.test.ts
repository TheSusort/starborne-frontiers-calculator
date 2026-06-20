import { describe, it, expect } from 'vitest';
import { incomingReductionForHit, incomingBlockForIntake } from '../incomingEffects';
import { Ability, IncomingCondition, IncomingHitContext } from '../../../types/abilities';

const ctx = (over: Partial<IncomingHitContext> = {}): IncomingHitContext => ({
    didCrit: false,
    attackerStealthed: false,
    victimStealthed: false,
    victimStasised: false,
    hitIndexThisRound: 1,
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
