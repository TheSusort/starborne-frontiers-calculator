import { describe, it, expect } from 'vitest';
import { communityBuildSummary } from '../communityBuildSummary';
import type { SharedAutogearBuild } from '../../types/communityRecommendation';

const base: SharedAutogearBuild = {
    version: 1,
    shipRole: 'ATTACKER',
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    fleetBuffs: [],
    excludedImplantTypes: [],
    optimizeImplants: false,
};

describe('communityBuildSummary', () => {
    it('leads with the role name', () => {
        expect(communityBuildSummary(base)).toContain('Attacker');
    });

    it('includes set piece counts, so a 4-piece differs from a 2-piece', () => {
        const four = communityBuildSummary({
            ...base,
            setPriorities: [{ setName: 'CRITICAL', count: 4 }],
        });
        const two = communityBuildSummary({
            ...base,
            setPriorities: [{ setName: 'CRITICAL', count: 2 }],
        });
        expect(four).toContain('4x Critical');
        expect(four).not.toEqual(two);
    });

    it('names an implant-kind set priority without a piece count', () => {
        const summary = communityBuildSummary({
            ...base,
            setPriorities: [{ setName: 'MARTYRDOM', count: 1, kind: 'implant' }],
        });
        expect(summary).toContain('Martyrdom');
        expect(summary).not.toContain('1x Martyrdom');
    });

    it('includes only limit-carrying stat priorities', () => {
        const summary = communityBuildSummary({
            ...base,
            statPriorities: [
                { stat: 'crit', minLimit: 100 },
                { stat: 'critDamage' },
                { stat: 'speed', maxLimit: 200 },
            ],
        });
        expect(summary).toContain('Crit Rate min 100');
        expect(summary).toContain('Speed max 200');
        expect(summary).not.toContain('Crit Damage');
    });

    it('distinguishes an additive bonus from a multiplier bonus', () => {
        const additive = communityBuildSummary({
            ...base,
            statBonuses: [{ stat: 'attack', percentage: 30, mode: 'additive' }],
        });
        const multiplier = communityBuildSummary({
            ...base,
            statBonuses: [{ stat: 'attack', percentage: 30, mode: 'multiplier' }],
        });
        expect(additive).toContain('Attack 30% additive');
        expect(multiplier).toContain('Attack 30% multiplier');
        expect(additive).not.toEqual(multiplier);
    });

    it('treats a bonus with no mode as additive, matching StatBonusRow', () => {
        expect(
            communityBuildSummary({ ...base, statBonuses: [{ stat: 'attack', percentage: 30 }] })
        ).toContain('Attack 30% additive');
    });

    it('falls back to the raw key for an unknown set rather than crashing', () => {
        expect(() =>
            communityBuildSummary({ ...base, setPriorities: [{ setName: 'MYSTERY', count: 4 }] })
        ).not.toThrow();
        expect(
            communityBuildSummary({ ...base, setPriorities: [{ setName: 'MYSTERY', count: 4 }] })
        ).toContain('4x MYSTERY');
    });

    it('joins parts with a middot separator', () => {
        const summary = communityBuildSummary({
            ...base,
            setPriorities: [{ setName: 'CRITICAL', count: 4 }],
        });
        expect(summary).toBe('Attacker · 4x Critical');
    });

    it('returns just the role when nothing else is configured', () => {
        expect(communityBuildSummary(base)).toBe('Attacker');
    });
});
