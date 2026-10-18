import { describe, expect, it } from 'vitest';
import { catalogueUnitSchema } from '../catalogueSchema';

describe('catalogueUnitSchema shipVisualKey', () => {
    const key = catalogueUnitSchema.shape.shipVisualKey;
    it('accepts a plain identifier or nothing', () => {
        expect(key.safeParse('Terran_7').success).toBe(true);
        expect(key.safeParse(undefined).success).toBe(true);
    });
    it('rejects anything that could leave its URL path segment', () => {
        for (const bad of ['../x', 'a/b', 'a b', 'a?b', 'a%2F', '']) {
            expect(key.safeParse(bad).success).toBe(false);
        }
    });
});
