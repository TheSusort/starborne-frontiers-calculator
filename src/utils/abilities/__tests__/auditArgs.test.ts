import { describe, it, expect } from 'vitest';
import { parseAuditArgs } from '../../../../scripts/lib/auditArgs';

describe('parseAuditArgs', () => {
    it('defaults to seed=1, count=10 with no flags', () => {
        expect(parseAuditArgs([])).toEqual({ seed: 1, count: 10 });
    });

    it('parses --seed and --count', () => {
        expect(parseAuditArgs(['--seed', '42', '--count', '7'])).toEqual({ seed: 42, count: 7 });
    });

    it('parses the flags in either order', () => {
        expect(parseAuditArgs(['--count', '3', '--seed', '9'])).toEqual({ seed: 9, count: 3 });
    });

    it('leaves the default when only one flag is given', () => {
        expect(parseAuditArgs(['--seed', '5'])).toEqual({ seed: 5, count: 10 });
        expect(parseAuditArgs(['--count', '2'])).toEqual({ seed: 1, count: 2 });
    });
});
