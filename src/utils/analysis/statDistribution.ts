import { BaseStats, EngineeringStat } from '../../types/stats';
import { GearPiece } from '../../types/gear';
import { GearSlotName, GEAR_SLOTS, ShipTypeName, SHIP_TYPES } from '../../constants';
import { calculateTotalScore } from '../autogear/scoring';
import { Ship } from '../../types/ship';
import { calculateTotalStats } from '../statsCalculator';

export interface SlotContribution {
    slotName: GearSlotName;
    absoluteScore: number;
    relativeScore: number;
    primaryStats: {
        statName: string;
        value: number;
        percentage: number;
    }[];
}

export function analyzeStatDistribution(
    equipment: Partial<Record<GearSlotName, string>>,
    getGearPiece: (id: string) => GearPiece | undefined,
    ship: Ship,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
): SlotContribution[] {
    // Calculate total score with all equipment using ship's role
    const totalScore = calculateTotalScore(
        ship,
        equipment,
        [],
        getGearPiece,
        getEngineeringStatsForShipType,
        SHIP_TYPES[ship.type].name
    );

    // Calculate total stats with all equipment
    const totalStats = calculateTotalStats(
        ship.baseStats,
        equipment,
        getGearPiece,
        ship.refits,
        ship.implants,
        getEngineeringStatsForShipType(ship.type)
    ).final;

    // Calculate contribution per slot
    const contributions: SlotContribution[] = [];
    let totalAbsoluteScore = 0;

    // First pass: calculate absolute scores
    Object.entries(GEAR_SLOTS).forEach(([slot]) => {
        const gearId = equipment[slot as GearSlotName];
        if (!gearId) return;

        const gear = getGearPiece(gearId);
        if (!gear) return;

        const equipmentWithoutSlot = { ...equipment };
        delete equipmentWithoutSlot[slot as GearSlotName];
        const scoreWithoutSlot = calculateTotalScore(
            ship,
            equipmentWithoutSlot,
            [],
            getGearPiece,
            getEngineeringStatsForShipType,
            SHIP_TYPES[ship.type].name
        );

        const slotScore = totalScore - scoreWithoutSlot;
        totalAbsoluteScore += Math.max(0, slotScore); // Only count positive contributions

        // Calculate stats without this piece
        const statsWithoutSlot = calculateTotalStats(
            ship.baseStats,
            equipmentWithoutSlot,
            getGearPiece,
            ship.refits,
            ship.implants,
            getEngineeringStatsForShipType(ship.type)
        ).final;

        const statContributions: { statName: string; value: number; percentage: number }[] = [];

        // Calculate stat contributions
        Object.entries(totalStats).forEach(([statName, totalValue]) => {
            const valueWithout = statsWithoutSlot[statName as keyof BaseStats] || 0;
            const contribution = totalValue - valueWithout;

            if (contribution !== 0) {
                const percentage =
                    (contribution / (totalValue - ship.baseStats[statName as keyof BaseStats])) *
                    100;
                statContributions.push({
                    statName,
                    value: contribution,
                    percentage: isFinite(percentage) ? percentage : 0,
                });
            }
        });

        contributions.push({
            slotName: slot as GearSlotName,
            absoluteScore: slotScore,
            relativeScore: 0, // Will be calculated in second pass
            primaryStats: statContributions
                .filter((stat) => stat.value !== 0)
                .sort((a, b) => Math.abs(b.percentage) - Math.abs(a.percentage)),
        });
    });

    // Second pass: calculate relative scores
    contributions.forEach((contribution) => {
        contribution.relativeScore =
            totalAbsoluteScore > 0
                ? (Math.max(0, contribution.absoluteScore) / totalAbsoluteScore) * 100
                : 0;
    });

    return contributions.sort((a, b) => b.absoluteScore - a.absoluteScore);
}
