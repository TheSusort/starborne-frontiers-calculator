import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { GearSuggestion } from '../../types/autogear';
import { RarityName } from '../../constants/rarities';

// Arcane Siege multiplier values by rarity
export const ARCANE_SIEGE_MULTIPLIERS: Record<RarityName, number> = {
    common: 3,
    uncommon: 5,
    rare: 10,
    epic: 15,
    legendary: 20,
};

/**
 * Check if ship has Arcane Siege implant and return its multiplier
 */
export function getArcaneSiegeInfo(
    ship: Ship,
    getGearPiece: (id: string) => GearPiece | undefined
): { hasImplant: boolean; multiplier: number; rarity: RarityName | null } {
    const implants = ship.implants || {};

    for (const implantId of Object.values(implants)) {
        if (!implantId) continue;
        const implant = getGearPiece(implantId);
        if (implant?.setBonus === 'ARCANE_SIEGE') {
            const rarity = implant.rarity as RarityName;
            const multiplier = ARCANE_SIEGE_MULTIPLIERS[rarity] || 0;
            return { hasImplant: true, multiplier, rarity };
        }
    }

    return { hasImplant: false, multiplier: 0, rarity: null };
}

/**
 * Check if suggestions include shield gear pieces
 */
export function hasShieldGearInSuggestions(
    suggestions: GearSuggestion[],
    getGearPiece: (id: string) => GearPiece | undefined
): boolean {
    return suggestions.some((suggestion) => {
        const gear = getGearPiece(suggestion.gearId);
        return gear?.setBonus === 'SHIELD';
    });
}

/**
 * Count shield gear pieces in suggestions
 */
export function countShieldGearInSuggestions(
    suggestions: GearSuggestion[],
    getGearPiece: (id: string) => GearPiece | undefined
): number {
    return suggestions.filter((suggestion) => {
        const gear = getGearPiece(suggestion.gearId);
        return gear?.setBonus === 'SHIELD';
    }).length;
}
