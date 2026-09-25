import { describe, it, expect } from 'vitest';
import { isAffinityName, toAffinityName, AFFINITY_NAMES } from '../affinities';

describe('affinity guards (#564)', () => {
    it('AFFINITY_NAMES lists exactly the four AffinityName members', () => {
        expect([...AFFINITY_NAMES].sort()).toEqual(
            ['antimatter', 'chemical', 'electric', 'thermal'].sort()
        );
    });

    it('isAffinityName accepts only real affinity names', () => {
        expect(isAffinityName('chemical')).toBe(true);
        expect(isAffinityName('Chemical')).toBe(false);
        expect(isAffinityName('mythic')).toBe(false);
    });

    it('toAffinityName passes a real value through', () => {
        expect(toAffinityName('electric')).toBe('electric');
    });

    it('toAffinityName normalises case, like toRarityName', () => {
        expect(toAffinityName('Electric')).toBe('electric');
        expect(toAffinityName('CHEMICAL')).toBe('chemical');
    });

    it('toAffinityName returns undefined for null, undefined, or an unrecognised value', () => {
        expect(toAffinityName(null)).toBeUndefined();
        expect(toAffinityName(undefined)).toBeUndefined();
        expect(toAffinityName('mythic')).toBeUndefined();
        expect(toAffinityName('')).toBeUndefined();
    });
});
