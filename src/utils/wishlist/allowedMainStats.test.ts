import { describe, it, expect } from 'vitest';
import { filterMainStatKeys, getAllowedMainStatNames } from './allowedMainStats';

describe('getAllowedMainStatNames', () => {
    it('is the stat union of every gear slot when none is selected', () => {
        const names = getAllowedMainStatNames([]);
        expect([...names].sort()).toEqual(
            ['attack', 'crit', 'critDamage', 'defence', 'hacking', 'hp', 'security', 'speed'].sort()
        );
    });

    it('narrows to the selected slot', () => {
        expect([...getAllowedMainStatNames(['weapon'])]).toEqual(['attack']);
    });

    it('unions several slots', () => {
        expect([...getAllowedMainStatNames(['weapon', 'hull'])].sort()).toEqual(['attack', 'hp']);
    });
});

describe('filterMainStatKeys', () => {
    it('drops chosen main stats the selected slots cannot roll', () => {
        expect(filterMainStatKeys(['attack:flat', 'crit:percentage'], ['weapon'])).toEqual([
            'attack:flat',
        ]);
    });

    it('keeps everything when no slot is selected', () => {
        const keys = ['attack:flat', 'crit:percentage'];
        expect(filterMainStatKeys(keys, [])).toEqual(keys);
    });
});
