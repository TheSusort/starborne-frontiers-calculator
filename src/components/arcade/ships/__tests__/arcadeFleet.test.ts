import { describe, it, expect } from 'vitest';
import { arcadeFleet } from '../arcadeFleet';
import type { Ship } from '../../../../types/ship';

const s = (id: string) => ({ id, name: id }) as Ship;

describe('arcadeFleet', () => {
    it('flies the owned fleet when there is one', () => {
        expect(arcadeFleet([s('a')], false, [s('t')])).toEqual({ fleet: [s('a')], bare: false });
    });
    it('falls back to bare templates when the fleet is empty', () => {
        expect(arcadeFleet([], false, [s('t1'), s('t2')])).toEqual({
            fleet: [s('t1'), s('t2')],
            bare: true,
        });
    });
    it('does not fall back while the owned fleet is still loading', () => {
        expect(arcadeFleet([], true, [s('t')])).toEqual({ fleet: [], bare: false });
    });
});
