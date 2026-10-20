import { describe, it, expect } from 'vitest';
import { shouldRecordPath } from '../useLastVisitedPath';

describe('shouldRecordPath', () => {
    it.each(['/ships', '/gear', '/ships/index', '/simulator', '/arcade'])('records %s', (p) => {
        expect(shouldRecordPath(p)).toBe(true);
    });

    it('records a parameterised route', () => {
        expect(shouldRecordPath('/ships/0b6f2c1e-1111-2222-3333-444455556666')).toBe(true);
    });

    it('excludes the home page', () => {
        expect(shouldRecordPath('/')).toBe(false);
    });

    it('excludes the OAuth consent callback', () => {
        expect(shouldRecordPath('/oauth/consent')).toBe(false);
    });

    it('excludes unknown routes (404)', () => {
        expect(shouldRecordPath('/definitely/not/a/page')).toBe(false);
    });
});
