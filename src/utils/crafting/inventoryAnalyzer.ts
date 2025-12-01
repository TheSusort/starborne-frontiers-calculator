import { GearPiece } from '../../types/gear';
import { GearSlotName, ShipTypeName } from '../../constants';
import { calculatePriorityScore } from '../autogear/scoring';
import { SlotRoleScore } from '../../types/crafting';
import { GEAR_SLOTS } from '../../constants/gearTypes';
import { calculateGearStats } from '../gear/potentialCalculator';

/**
 * Analyzes gear inventory by slot and role to identify crafting needs
 */
export function analyzeGearBySlotAndRole(
    inventory: GearPiece[],
    roles: ShipTypeName[]
): SlotRoleScore[] {
    const results: SlotRoleScore[] = [];

    // Get all gear slots (excluding implants)
    const slots = Object.keys(GEAR_SLOTS) as GearSlotName[];

    for (const slot of slots) {
        for (const role of roles) {
            // Filter gear for this slot
            const slotGear = inventory.filter((piece) => piece.slot === slot);

            // Calculate scores for each piece
            const scores = slotGear
                .map((piece) => {
                    try {
                        const stats = calculateGearStats(piece);
                        return calculatePriorityScore(stats, [], role);
                    } catch (error) {
                        // If scoring fails, return a small positive value so we don't skip this slot
                        // Silently handle scoring errors to avoid console noise
                        return 0.1; // Small positive value
                    }
                })
                .filter((score) => score > 0)
                .sort((a, b) => b - a); // Sort descending

            // Skip if no gear at all for this slot
            if (scores.length === 0) continue;

            // Get top 50 scores (or all if less than 50)
            const topGearPieces = scores.slice(0, 50);

            // Calculate average and median
            const topGearPiecesAverage =
                topGearPieces.reduce((sum, score) => sum + score, 0) / topGearPieces.length;
            const sortedTopGearPieces = [...topGearPieces].sort((a, b) => a - b);
            const median =
                sortedTopGearPieces.length % 2 === 0
                    ? (sortedTopGearPieces[sortedTopGearPieces.length / 2 - 1] +
                          sortedTopGearPieces[sortedTopGearPieces.length / 2]) /
                      2
                    : sortedTopGearPieces[Math.floor(sortedTopGearPieces.length / 2)];

            // Determine if crafting is needed
            // Always suggest crafting if there's gear - priority will be based on need
            // Higher priority for:
            // - Large gap between average and median (suggests need for more pieces)
            // - Few pieces (less than 50)
            // - Low quality gear (low median score)
            // Always suggest if there's any gear - the priority system will rank them
            const needsCrafting = true; // Always suggest when gear exists

            results.push({
                slot,
                role,
                scores,
                top10Average: topGearPiecesAverage,
                median,
                needsCrafting,
            });
        }
    }

    return results;
}

/**
 * Calculates median of an array
 */
export function calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length % 2 === 0) {
        return (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    }
    return sorted[Math.floor(sorted.length / 2)];
}
