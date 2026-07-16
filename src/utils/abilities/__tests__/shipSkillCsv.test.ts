import { describe, it, expect } from 'vitest';
import {
    parseCsvLine,
    csvAvailable,
    loadShipSkillRecords,
} from '../../../../scripts/lib/shipSkillCsv';

describe('shipSkillCsv', () => {
    it('parses a quoted field containing commas and escaped quotes', () => {
        expect(parseCsvLine('a,"b,c","d""e"')).toEqual(['a', 'b,c', 'd"e']);
    });

    it.skipIf(!csvAvailable())('loads structured records with a resolvable name', () => {
        const records = loadShipSkillRecords();
        expect(records.length).toBeGreaterThan(100);
        const aegis = records.find((r) => r.name === 'AEGIS');
        expect(aegis).toBeDefined();
        expect(aegis!.active.length).toBeGreaterThan(0);
        expect(aegis!.passives).toHaveLength(3);
    });
});
