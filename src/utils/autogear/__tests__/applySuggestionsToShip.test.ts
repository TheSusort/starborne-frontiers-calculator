import { describe, it, expect } from 'vitest';
import { applySuggestionsToShip } from '../applySuggestionsToShip';
import type { Ship } from '../../../types/ship';
import type { GearSuggestion } from '../../../types/autogear';
import type { EquipmentSlotName } from '../../../constants/gearTypes';

const ship = (): Ship =>
    ({
        id: 'focus',
        name: 'Focus',
        type: 'ATTACKER',
        baseStats: {},
        equipment: { weapon: 'old-weapon', hull: 'old-hull' },
        implants: { implant_major: 'old-implant' },
        refits: [],
    }) as unknown as Ship;

const suggestion = (slotName: EquipmentSlotName, gearId: string): GearSuggestion => ({
    slotName: slotName,
    gearId,
    score: 1,
});

describe('applySuggestionsToShip', () => {
    it('substitutes suggested gear and leaves untouched slots on their current piece', () => {
        const result = applySuggestionsToShip(ship(), [suggestion('weapon', 'new-weapon')]);
        expect(result.equipment.weapon).toBe('new-weapon');
        expect(result.equipment.hull).toBe('old-hull');
    });

    it('routes implant slots to implants, not equipment', () => {
        const result = applySuggestionsToShip(ship(), [suggestion('implant_major', 'new-implant')]);
        expect(result.implants?.implant_major).toBe('new-implant');
        // `equipment` is gear-slot-keyed only — `implant_major` is not a key of its type at
        // all, so the stronger check is that the new implant id never lands among its values.
        expect(Object.values(result.equipment)).not.toContain('new-implant');
    });

    it('does not mutate the input ship', () => {
        const original = ship();
        applySuggestionsToShip(original, [suggestion('weapon', 'new-weapon')]);
        expect(original.equipment.weapon).toBe('old-weapon');
    });

    it('keeps the ship identity, so the engine still resolves its skills', () => {
        const result = applySuggestionsToShip(ship(), [suggestion('weapon', 'new-weapon')]);
        expect(result.id).toBe('focus');
        expect(result.name).toBe('Focus');
    });
});
