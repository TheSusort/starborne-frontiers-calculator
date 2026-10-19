import { describe, it, expect } from 'vitest';
import { arcadeFleet } from '../arcadeFleet';
import type { Ship } from '../../../../types/ship';

const s = (id: string) => ({ id, name: id }) as Ship;

describe('arcadeFleet', () => {
    it('flies the owned fleet when there is one', () => {
        expect(arcadeFleet([s('a')], false, [s('t')], false)).toEqual({
            fleet: [s('a')],
            bare: false,
            loading: false,
        });
    });
    it('falls back to bare templates when the fleet is empty', () => {
        expect(arcadeFleet([], false, [s('t1'), s('t2')], false)).toEqual({
            fleet: [s('t1'), s('t2')],
            bare: true,
            loading: false,
        });
    });
    it('does not fall back while the owned fleet is still loading', () => {
        expect(arcadeFleet([], true, [s('t')], false)).toEqual({
            fleet: [],
            bare: false,
            loading: true,
        });
    });
    it('is loading, not bare, while there is no fleet and the templates are still loading', () => {
        expect(arcadeFleet([], false, [], true)).toEqual({
            fleet: [],
            bare: false,
            loading: true,
        });
    });
    it('does not wait for templates when the owned fleet is present', () => {
        expect(arcadeFleet([s('a')], false, [], true)).toEqual({
            fleet: [s('a')],
            bare: false,
            loading: false,
        });
    });
});
