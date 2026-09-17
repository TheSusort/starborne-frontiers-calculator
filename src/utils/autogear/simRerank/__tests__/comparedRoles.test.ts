import { describe, it, expect } from 'vitest';
import { defaultComparedRoles } from '../comparedRoles';

describe('defaultComparedRoles', () => {
    it('covers every structurally different objective', () => {
        expect(defaultComparedRoles('ATTACKER').sort()).toEqual(
            ['DEBUFFER', 'DEFENDER', 'SUPPORTER'].sort()
        );
    });

    it("never repeats the ship's own role, and returns the other three exactly", () => {
        // Membership alone would still pass if a bug dropped or duplicated one of
        // the other families, so pin the whole set rather than one exclusion.
        const result = defaultComparedRoles('DEFENDER');
        expect(result).not.toContain('DEFENDER');
        expect(result.sort()).toEqual(['ATTACKER', 'DEBUFFER', 'SUPPORTER'].sort());
    });

    it('treats a role variant as covering its family, not just its own name', () => {
        // A hand-rolled prefix bug (e.g. matching only the literal 'DEBUFFER') would
        // still pass a bare not-toContain('DEBUFFER') check, since the array never
        // holds a variant name in the first place. Pin the full family-excluded set.
        const result = defaultComparedRoles('DEBUFFER_BOMBER');
        expect(result).not.toContain('DEBUFFER');
        expect(result.sort()).toEqual(['ATTACKER', 'DEFENDER', 'SUPPORTER'].sort());
    });

    it('offers a defender build to a debuffer, which is the case that motivated this', () => {
        expect(defaultComparedRoles('DEBUFFER')).toContain('DEFENDER');
    });

    it('returns every family, unduplicated, when the role is unknown', () => {
        // Length alone would pass with four copies of one family, so check identity too.
        const result = defaultComparedRoles(undefined);
        expect(result).toHaveLength(4);
        expect(result.sort()).toEqual(['ATTACKER', 'DEBUFFER', 'DEFENDER', 'SUPPORTER'].sort());
    });
});
