import { describe, it, expect } from 'vitest';
import { calculateBuffTotals } from '../buffTotals';

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
