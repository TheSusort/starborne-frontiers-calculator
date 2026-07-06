import { describe, it, expect } from 'vitest';
import { conditionMet } from '../evaluateConditions';
import { makeConditionContext } from './conditionContextFixture';

describe('stat-vs-target condition', () => {
    it('crit-power gt: met when self crit power exceeds target', () => {
        const cond = {
            subject: 'stat-vs-target' as const,
            derivable: true,
            compareStat: 'crit-power' as const,
            statComparator: 'gt' as const,
        };
        expect(
            conditionMet(cond, makeConditionContext({ selfCritPower: 150, targetCritPower: 100 }))
        ).toBe(true);
        expect(
            conditionMet(cond, makeConditionContext({ selfCritPower: 100, targetCritPower: 150 }))
        ).toBe(false);
    });
    it('speed lt: met when self speed is below target (Chakara)', () => {
        const cond = {
            subject: 'stat-vs-target' as const,
            derivable: true,
            compareStat: 'speed' as const,
            statComparator: 'lt' as const,
        };
        expect(conditionMet(cond, makeConditionContext({ selfSpeed: 40, targetSpeed: 60 }))).toBe(
            true
        );
        expect(conditionMet(cond, makeConditionContext({ selfSpeed: 60, targetSpeed: 40 }))).toBe(
            false
        );
    });
    it('hp gt: uses ABSOLUTE current HP, not percentage (Cobalt)', () => {
        const cond = {
            subject: 'stat-vs-target' as const,
            derivable: true,
            compareStat: 'hp' as const,
            statComparator: 'gt' as const,
        };
        expect(
            conditionMet(
                cond,
                makeConditionContext({ selfCurrentHp: 50000, targetCurrentHp: 18000 })
            )
        ).toBe(true);
        expect(
            conditionMet(
                cond,
                makeConditionContext({ selfCurrentHp: 10000, targetCurrentHp: 18000 })
            )
        ).toBe(false);
    });
    it('unset target stat defaults to 0 (crit power: no enemy field → gate met)', () => {
        const cond = {
            subject: 'stat-vs-target' as const,
            derivable: true,
            compareStat: 'crit-power' as const,
            statComparator: 'gt' as const,
        };
        expect(conditionMet(cond, makeConditionContext({ selfCritPower: 150 }))).toBe(true);
    });
});
