import { describe, expect, it } from 'vitest';
import type { Refit } from '../../../types/ship';
import { applyGuaranteedCrit } from '../perShipRules';

const totalCrit = (baseCrit: number, refits: Refit[]): number =>
    baseCrit +
    refits
        .flatMap((refit) => refit.stats)
        .filter((stat) => stat.name === 'crit')
        .reduce((sum, stat) => sum + stat.value, 0);

describe('applyGuaranteedCrit', () => {
    it('counts crit a refit already carries, so base plus refits lands on exactly 100', () => {
        const refits: Refit[] = [
            { id: 'r1', stats: [{ name: 'attack', value: 0, type: 'flat' }] },
            { id: 'r2', stats: [{ name: 'crit', value: 10, type: 'percentage' }] },
        ];
        const baseStats = { crit: 50 };
        applyGuaranteedCrit('Tormenter', 2, refits, baseStats);
        expect(totalCrit(baseStats.crit, refits)).toBe(100);
    });

    it('adds nothing when base and refit crit already reach 100', () => {
        const refits: Refit[] = [
            { id: 'r1', stats: [{ name: 'crit', value: 60, type: 'percentage' }] },
        ];
        const baseStats = { crit: 50 };
        applyGuaranteedCrit('Tormenter', 1, refits, baseStats);
        expect(totalCrit(baseStats.crit, refits)).toBe(110);
    });
});
