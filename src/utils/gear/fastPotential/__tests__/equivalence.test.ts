import { describe, it, expect } from 'vitest';
import { generateEligibleInventory, seededRandom } from './fixtures/testInventory';

describe('fixture sanity', () => {
    it('generates deterministic inventory for the same seed', () => {
        const a = generateEligibleInventory(42, 12);
        const b = generateEligibleInventory(42, 12);
        expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
        expect(a[0].mainStat?.value).toBe(b[0].mainStat?.value);
    });

    it('seededRandom is reproducible', () => {
        const r1 = seededRandom(1);
        const r2 = seededRandom(1);
        for (let i = 0; i < 5; i++) expect(r1()).toBe(r2());
    });

    it('every generated piece has level < 16', () => {
        const pieces = generateEligibleInventory(7, 30);
        for (const p of pieces) expect(p.level).toBeLessThan(16);
    });
});
