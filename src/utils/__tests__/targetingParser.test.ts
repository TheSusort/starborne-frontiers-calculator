import { describe, it, expect } from 'vitest';
import { parseTarget } from '../targetingParser';

describe('parseTarget', () => {
    it('maps enemy-side selections', () => {
        expect(parseTarget('front')).toEqual({ raw: 'front', side: 'enemy', selection: 'front' });
        expect(parseTarget('back')).toEqual({ raw: 'back', side: 'enemy', selection: 'back' });
        expect(parseTarget('skip')).toEqual({ raw: 'skip', side: 'enemy', selection: 'skip' });
        expect(parseTarget('all')).toEqual({ raw: 'all', side: 'enemy', selection: 'all' });
    });

    it('maps ally-side selections', () => {
        expect(parseTarget('allies')).toEqual({ raw: 'allies', side: 'ally', selection: 'team' });
        expect(parseTarget('all-allies')).toEqual({
            raw: 'all-allies',
            side: 'ally',
            selection: 'all',
        });
        expect(parseTarget('other-allies')).toEqual({
            raw: 'other-allies',
            side: 'ally',
            selection: 'others',
        });
        expect(parseTarget('self')).toEqual({ raw: 'self', side: 'ally', selection: 'self' });
    });

    it('is case/whitespace tolerant', () => {
        expect(parseTarget('  Front ')).toMatchObject({ side: 'enemy', selection: 'front' });
    });

    it('throws on unknown target', () => {
        expect(() => parseTarget('sideways')).toThrow(/unknown target/i);
    });
});
