import { describe, it, expect } from 'vitest';
import { applySuggestionsToShip } from '../candidateShip';
import type { Ship } from '../../../../types/ship';
import type { GearSuggestion } from '../../../../types/autogear';

const ship = (): Ship =>
    ({
        id: 'focus',
        name: 'Focus',
        type: 'ATTACKER',
        baseStats: {},
        equipment: { weapon: 'old-weapon', hull: 'old-hull' },
        implants: { implant_alpha: 'old-implant' },
        refits: [],
    }) as unknown as Ship;

const suggestion = (slotName: string, gearId: string): GearSuggestion => ({
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
        const result = applySuggestionsToShip(ship(), [suggestion('implant_alpha', 'new-implant')]);
        expect(result.implants?.implant_alpha).toBe('new-implant');
        expect(result.equipment.implant_alpha).toBeUndefined();
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
