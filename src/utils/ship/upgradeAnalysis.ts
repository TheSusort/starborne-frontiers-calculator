import { GearPiece } from '../../types/gear';
import { GearSlotName, GEAR_SLOTS } from '../../constants/gearTypes';
import { SlotContribution } from './statDistribution';
import { UpgradeSuggestion } from '../../types/analysis';
import { analyzeGearQuality } from './gearSuggestions';
import { Ship } from '../../types/ship';
import { calculateTotalStats } from '../ship/statsCalculator';
import { GEAR_SETS } from '../../constants/gearSets';
import { ShipTypeName } from '../../constants/shipTypes';

const DESIRED_SETS: Record<ShipTypeName, string[]> = {
    ATTACKER: ['ATTACK', 'CRITICAL', 'ABYSSAL_ASSULT', 'AMBUSH'],
    DEFENDER: ['DEFENSE', 'FORTITUDE', 'ABYSSAL_SAFEGUARD', 'ABYSSAL_WARD', 'PROTECTION'],
    SUPPORTER: ['REPAIR', 'FORTITUDE', 'CRITICAL', 'ABYSSAL_SAFEGUARD'],
    SUPPORTER_BUFFER: ['BOOST', 'SPEED', 'FORTITUDE', 'AMBUSH'],
    DEBUFFER: ['HACKING', 'ABYSSAL_BREACH', 'ATTACK', 'CRITICAL', 'ABYSSAL_ASSULT', 'AMBUSH'],
};

export function analyzeUpgrades(
    slotContributions: SlotContribution[],
    equipment: Partial<Record<GearSlotName, string>>,
    getGearPiece: (id: string) => GearPiece | undefined,
    ship: Ship,
    finalStats: ReturnType<typeof calculateTotalStats>['final'],
    orphanSetPieces: GearPiece[]
): UpgradeSuggestion[] {
    const suggestions: UpgradeSuggestion[] = [];

    slotContributions.forEach((contribution) => {
        const gearId = equipment[contribution.slotName];
        if (!gearId) return;

        const gear = getGearPiece(gearId);
        if (!gear) return;

        const relevantSet = gear.setBonus && DESIRED_SETS[ship.type].includes(gear.setBonus);

        // Add gear quality check.
        if (
            contribution.relativeScore <
            GEAR_SLOTS[contribution.slotName].expectedContribution - 1
        ) {
            const qualityCheck = analyzeGearQuality(
                gear,
                ship,
                finalStats,
                getGearPiece,
                contribution
            );

            suggestions.push({
                slotName: contribution.slotName,
                currentLevel: gear.level,
                priority: contribution.relativeScore,
                reasons:
                    qualityCheck.reasons ||
                    'Consider replacing this piece with a piece with more contribution',
            });
        }

        const isPercentageSlot = ['sensor', 'software', 'thrusters'].includes(
            contribution.slotName
        );
        const expectedContribution = GEAR_SLOTS[contribution.slotName].expectedContribution;

        const existingSuggestion = suggestions.find(
            (suggestion) => suggestion.slotName === contribution.slotName
        );

        if (gear.level < 16) {
            const currentContribution = contribution.relativeScore;
            let reason: string;

            if (isPercentageSlot && currentContribution < expectedContribution) {
                reason = `${GEAR_SLOTS[contribution.slotName].label} provides percentage-based stats but is underperforming`;
            } else if (!isPercentageSlot && gear.level < 12) {
                reason = `Level up to increase flat stat bonus`;
            } else {
                reason = `Minor improvements available`;
            }

            if (existingSuggestion) {
                existingSuggestion.reasons.push({
                    title: 'Low level',
                    reason: reason,
                });
            } else {
                suggestions.push({
                    slotName: contribution.slotName,
                    currentLevel: gear.level,
                    priority: contribution.relativeScore,
                    reasons: [
                        {
                            title: 'Low level',
                            reason: reason,
                        },
                    ],
                });
            }
        }

        if (orphanSetPieces.length > 0 && !relevantSet) {
            // check for pieces with orphan relevant set bonus
            const orphanSetPiecesOtherThanThis = orphanSetPieces.filter(
                (piece) => piece.setBonus !== gear.setBonus
            );
            if (orphanSetPiecesOtherThanThis.length > 0) {
                const mostRelevantSetPiece = orphanSetPiecesOtherThanThis.reduce(
                    (mostRelevant, piece) => {
                        const hasRelevantSet =
                            piece.setBonus && DESIRED_SETS[ship.type].includes(piece.setBonus);
                        return hasRelevantSet ? piece : mostRelevant;
                    },
                    orphanSetPiecesOtherThanThis[0]
                );
                if (existingSuggestion) {
                    existingSuggestion.reasons.push({
                        title: 'Not optimal set bonus',
                        reason: `Switching to a ${GEAR_SETS[mostRelevantSetPiece.setBonus].name} ${GEAR_SLOTS[contribution.slotName].label} could improve your score, as it will provide an extra set bonus`,
                    });
                } else {
                    suggestions.push({
                        slotName: contribution.slotName,
                        currentLevel: gear.level,
                        reasons: [
                            {
                                title: 'Not optimal set bonus',
                                reason: `Switching to a ${GEAR_SETS[mostRelevantSetPiece.setBonus].name} ${GEAR_SLOTS[contribution.slotName].label} could improve your score, as it will provide an extra set bonus`,
                            },
                        ],
                    });
                }
            }
        }
    });

    // Sort by priority - expected contribution.
    return suggestions.sort((a, b) => {
        if (
            a.priority !== undefined &&
            b.priority !== undefined &&
            GEAR_SLOTS[a.slotName].expectedContribution - a.priority! !==
                GEAR_SLOTS[b.slotName].expectedContribution - b.priority!
        ) {
            return (
                GEAR_SLOTS[b.slotName].expectedContribution -
                b.priority! -
                (GEAR_SLOTS[a.slotName].expectedContribution - a.priority!)
            );
        }

        if (a.priority === undefined || b.priority === undefined) {
            return -1;
        }
        return 0;
    });
}
