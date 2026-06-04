import { describe, it, expect } from 'vitest';
import { computeChargeSchedule } from '../chargeSchedule';

describe('computeChargeSchedule', () => {
    it('returns empty array for 0 rounds', () => {
        expect(computeChargeSchedule(2, false, 0)).toEqual([]);
    });

    it('returns empty array when chargeCount is 0', () => {
        expect(computeChargeSchedule(0, false, 5)).toEqual([]);
    });

    it('startCharged=false, chargeCount=2: charged on rounds 3,6', () => {
        expect(computeChargeSchedule(2, false, 6)).toEqual([3, 6]);
    });

    it('startCharged=true, chargeCount=2: charged on rounds 1,4,7', () => {
        expect(computeChargeSchedule(2, true, 7)).toEqual([1, 4, 7]);
    });

    it('chargeCount=1, startCharged=false: charged on rounds 2,4,6', () => {
        expect(computeChargeSchedule(1, false, 6)).toEqual([2, 4, 6]);
    });

    it('chargeCount=3, startCharged=false: charged on round 4,8', () => {
        expect(computeChargeSchedule(3, false, 8)).toEqual([4, 8]);
    });
});
