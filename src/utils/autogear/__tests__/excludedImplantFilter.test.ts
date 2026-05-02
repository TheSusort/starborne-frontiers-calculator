import { describe, it, expect } from 'vitest';
import type { GearPiece } from '../../../types/gear';

// Inline the filter predicate to test it independently of the page component.
function isExcludedByImplantType(
    gear: Pick<GearPiece, 'slot' | 'setBonus'>,
    excludedImplantTypes: string[]
): boolean {
    const isImplant = gear.slot.startsWith('implant_');
    return isImplant && excludedImplantTypes.includes(gear.setBonus ?? '');
}

const makeImplant = (setBonus: string | null): Pick<GearPiece, 'slot' | 'setBonus'> => ({
    slot: 'implant_major',
    setBonus,
});

const makeGear = (setBonus: string | null): Pick<GearPiece, 'slot' | 'setBonus'> => ({
    slot: 'weapon',
    setBonus,
});

describe('isExcludedByImplantType', () => {
    it('excludes an implant whose type is in the list', () => {
        expect(isExcludedByImplantType(makeImplant('BULWARK'), ['BULWARK'])).toBe(true);
    });

    it('does not exclude an implant whose type is not in the list', () => {
        expect(isExcludedByImplantType(makeImplant('STASIS'), ['BULWARK'])).toBe(false);
    });

    it('does not exclude a non-implant even if its setBonus matches', () => {
        expect(isExcludedByImplantType(makeGear('BULWARK'), ['BULWARK'])).toBe(false);
    });

    it('does not exclude an implant when the list is empty', () => {
        expect(isExcludedByImplantType(makeImplant('BULWARK'), [])).toBe(false);
    });

    it('does not exclude an implant with null setBonus', () => {
        expect(isExcludedByImplantType(makeImplant(null), ['BULWARK'])).toBe(false);
    });
});
