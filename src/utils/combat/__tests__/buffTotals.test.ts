import { describe, it, expect } from 'vitest';
import {
    calculateBuffTotals,
    familiesOf,
    strongestPerFamily,
    shadowedDelta,
    FOLD_SHADOW_CHANNELS,
} from '../buffTotals';
import type { SelectedGameBuff } from '../../../types/calculator';
import { toSimBuffs } from '../../calculators/dpsBuffHelpers';

describe('calculateBuffTotals — attackFlat channel (D-PR10)', () => {
    it('sums attackFlat into attackFlatBuff (D-PR10)', () => {
        const t = calculateBuffTotals([
            { id: 'x', stat: 'attackFlat', value: 300 },
            { id: 'y', stat: 'attackFlat', value: 200 },
            { id: 'z', stat: 'attack', value: 20 },
        ]);
        expect(t.attackFlatBuff).toBe(500);
        expect(t.attackBuff).toBe(20); // percentage channel untouched
    });
});

// ── #398 — the five channels that were DEAD on the enemy store ────────────────────────────────
// These assertions are about the SHADOWING MACHINERY over the newly-added channel names, not about
// the engine: `familiesOf` indexes `parsedEffects[channel]` generically, so widening
// SHADOW_CHANNELS is all that is needed for it to see them. The behavioural half lives in
// enemyAppliedStatChannels.test.ts.
describe('#398 — the five newly-live channels', () => {
    const buff = (
        buffName: string,
        parsedEffects: SelectedGameBuff['parsedEffects'],
        stacks = 1
    ): SelectedGameBuff => ({
        id: `b-${buffName}`,
        buffName,
        stacks,
        parsedEffects,
        isStackable: false,
    });

    it('familiesOf extracts every one of the five channels', () => {
        const fams = familiesOf(
            [
                buff('Crit Rate Down III', { crit: -30 }),
                buff('Crit Power Down III', { critDamage: -50 }),
                buff('Speed Down II', { speed: -50 }),
                buff('Hacking Down II', { hacking: -150 }),
                buff('Security Down II', { security: -100 }),
            ],
            FOLD_SHADOW_CHANNELS
        );
        expect(fams.get('Crit Rate Down')?.crit?.pct).toBe(-30);
        expect(fams.get('Crit Power Down')?.critDamage?.pct).toBe(-50);
        expect(fams.get('Speed Down')?.speed?.pct).toBe(-50);
        expect(fams.get('Hacking Down')?.hacking?.pct).toBe(-150);
        expect(fams.get('Security Down')?.security?.pct).toBe(-100);
    });

    it('shadowedDelta raises the total to the applied instance when the applied tier wins', () => {
        // Own `Speed Down I` (-20) vs applied `Speed Down II` (-50): applied wins on tier, so the
        // delta moves the total from -20 to exactly -50 (a -30 delta), NOT to the -70 sum.
        const applied = familiesOf([buff('Speed Down II', { speed: -50 })], FOLD_SHADOW_CHANNELS);
        const { delta } = shadowedDelta(
            applied,
            [buff('Speed Down I', { speed: -20 })],
            FOLD_SHADOW_CHANNELS
        );
        expect(delta.speed).toBe(-30);
    });

    it('shadowedDelta leaves the total alone when the actor own instance wins', () => {
        const applied = familiesOf([buff('Speed Down I', { speed: -20 })], FOLD_SHADOW_CHANNELS);
        const { delta } = shadowedDelta(
            applied,
            [buff('Speed Down II', { speed: -50 })],
            FOLD_SHADOW_CHANNELS
        );
        expect(delta.speed ?? 0).toBe(0);
    });

    it('does not collapse DIFFERENT families on the same channel', () => {
        // Shadowing is per NAMED family: two different families both contribute in full.
        const applied = familiesOf(
            [buff('Crit Rate Down III', { crit: -30 }), buff('Inc. Crit Down I', { crit: -10 })],
            FOLD_SHADOW_CHANNELS
        );
        const { delta } = shadowedDelta(applied, [], FOLD_SHADOW_CHANNELS);
        expect(delta.crit).toBe(-40);
    });

    it('treats hacking/security FLAT units on the same magnitude comparison', () => {
        // hacking/security are flat stat units, not percentages. The comparison is magnitude-only,
        // so the stronger flat instance wins exactly as a percentage one does.
        const applied = familiesOf(
            [buff('Hacking Down II', { hacking: -150 })],
            FOLD_SHADOW_CHANNELS
        );
        const { delta } = shadowedDelta(
            applied,
            [buff('Hacking Down I', { hacking: -80 })],
            FOLD_SHADOW_CHANNELS
        );
        expect(delta.hacking).toBe(-70); // -80 own → -150 applied
    });
});

describe('strongestPerFamily — one instance per named family (#667)', () => {
    const b = (
        id: string,
        buffName: string,
        parsedEffects: SelectedGameBuff['parsedEffects'],
        stacks = 1
    ): SelectedGameBuff => ({ id, buffName, stacks, parsedEffects, isStackable: false });

    it('keeps one copy of an identical duplicate', () => {
        const out = strongestPerFamily([
            b('a', 'Attack Up III', { attack: 45 }),
            b('b', 'Attack Up III', { attack: 45 }),
        ]);
        expect(out.map((x) => x.id)).toEqual(['a']);
    });

    it('higher tier wins regardless of order', () => {
        const lo = b('lo', 'Attack Up I', { attack: 15 });
        const hi = b('hi', 'Attack Up III', { attack: 45 });
        expect(strongestPerFamily([lo, hi]).map((x) => x.id)).toEqual(['hi']);
        expect(strongestPerFamily([hi, lo]).map((x) => x.id)).toEqual(['hi']);
    });

    it('equal tier: larger post-stacks magnitude wins', () => {
        const one = b('one', 'Overload', { attack: 10 }, 1);
        const three = b('three', 'Overload', { attack: 10 }, 3);
        expect(strongestPerFamily([one, three]).map((x) => x.id)).toEqual(['three']);
    });

    it('different families all survive', () => {
        const out = strongestPerFamily([
            b('a', 'Attack Up III', { attack: 45 }),
            b('d', 'Defense Up II', { defense: 30 }),
            b('c', 'Crit Power Up I', { critDamage: 20 }),
        ]);
        expect(out.map((x) => x.id)).toEqual(['a', 'd', 'c']);
    });

    it('DoT and bomb instances are never reduced', () => {
        const out = strongestPerFamily([
            b('c1', 'Corrosion III', { dotDamage: 5 }),
            b('c2', 'Corrosion III', { dotDamage: 5 }),
            b('i1', 'Inferno II', { dotDamage: 5 }),
            b('i2', 'Inferno II', { dotDamage: 5 }),
            b('b1', 'Bomb I', { dotDamage: 5 }),
            b('b2', 'Bomb I', { dotDamage: 5 }),
        ]);
        expect(out).toHaveLength(6);
    });

    it('independently ticking buffs are never reduced: Repair Over Time and Nanobots', () => {
        const out = strongestPerFamily([
            b('n1', 'Power Infused Nanobots', { attackFlat: 3000 }),
            b('n2', 'Power Infused Nanobots', { attackFlat: 2500 }),
            b('r1', 'Repair Over Time II', { hotPct: 10, outgoingHeal: 5 }),
            b('r2', 'Repair Over Time II', { hotPct: 10, outgoingHeal: 5 }),
        ]);
        expect(out).toHaveLength(4);
    });

    it('entries with no numeric effect and heal-over-time entries pass through', () => {
        const out = strongestPerFamily([
            b('e1', 'Stealth', {}),
            b('e2', 'Stealth', {}),
            b('h1', 'Repair Over Time II', { hotPct: 10 }),
            b('h2', 'Repair Over Time II', { hotPct: 10 }),
        ]);
        expect(out).toHaveLength(4);
    });

    it('a fold of the reduced list counts a duplicated family once', () => {
        const totals = calculateBuffTotals(
            toSimBuffs(
                strongestPerFamily([
                    b('a', 'Attack Up III', { attack: 45 }),
                    b('b', 'Attack Up III', { attack: 45 }),
                    b('s', 'Speed Up II', { speed: 30 }),
                    b('t', 'Speed Up I', { speed: 15 }),
                ])
            )
        );
        expect(totals.attackBuff).toBe(45);
        expect(totals.speedBuff).toBe(30);
    });
});
