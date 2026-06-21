import { describe, it, expect, vi } from 'vitest';
import { healAmplificationForCast } from '../healAmplification';
import { Ability } from '../../../types/abilities';

const amp = (
    id: string,
    condition: 'target-hp-below-self' | 'target-below-25',
    ampPct: number,
    procChance?: number
): Ability => ({
    id,
    type: 'heal-amplification',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal-amplification', condition, ampPct, procChance },
});
const always = () => true;
const never = () => false;

describe('healAmplificationForCast', () => {
    it('returns 0 with no heal-amplification abilities', () => {
        expect(healAmplificationForCast([], { targetHpPct: 10, selfHpPct: 90 }, always)).toBe(0);
    });
    it('target-hp-below-self fires only when target HP% < self HP% (deterministic, no proc roll)', () => {
        const roll = vi.fn(() => true);
        const a = [amp('n', 'target-hp-below-self', 30)]; // no procChance
        expect(healAmplificationForCast(a, { targetHpPct: 40, selfHpPct: 90 }, roll)).toBe(30);
        expect(healAmplificationForCast(a, { targetHpPct: 95, selfHpPct: 90 }, roll)).toBe(0);
        expect(roll).not.toHaveBeenCalled();
    });
    it('target-below-25 with procChance respects the gate', () => {
        const a = [amp('v', 'target-below-25', 100, 0.5)];
        expect(healAmplificationForCast(a, { targetHpPct: 20, selfHpPct: 50 }, always)).toBe(100);
        expect(healAmplificationForCast(a, { targetHpPct: 20, selfHpPct: 50 }, never)).toBe(0);
        expect(healAmplificationForCast(a, { targetHpPct: 30, selfHpPct: 50 }, always)).toBe(0);
    });
    it('eligibility gates the proc roll (ineligible target does not consume the gate)', () => {
        const roll = vi.fn(() => true);
        healAmplificationForCast(
            [amp('v', 'target-below-25', 100, 0.5)],
            { targetHpPct: 80, selfHpPct: 50 },
            roll
        );
        expect(roll).not.toHaveBeenCalled();
    });
    it('sums additively across abilities', () => {
        const a = [
            amp('n', 'target-hp-below-self', 30),
            amp('v', 'target-below-25', 100, undefined),
        ];
        expect(healAmplificationForCast(a, { targetHpPct: 10, selfHpPct: 90 }, always)).toBe(130);
    });
});
