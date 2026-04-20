import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';
import type { StatName, EngineeringStat } from '../../../types/stats';
import type { ShipTypeName, GearSlotName } from '../../../constants';
// eslint-disable-next-line import/no-cycle
import { simulateUpgrade } from '../potentialCalculator';
import { buildPotentialContext } from './potentialContext';
import { scoreCurrentWithShip, scorePieceApplied } from './scorePieceUpgrade';

export interface PotentialResult {
    piece: GearPiece;
    currentScore: number;
    potentialScore: number;
    improvement: number;
}

export function fastAnalyzePotentialUpgrades(
    inventory: GearPiece[],
    shipRole: ShipTypeName,
    count: number = 6,
    slot?: GearSlotName,
    minRarity: 'rare' | 'epic' | 'legendary' = 'rare',
    simulationCount: number = 20,
    selectedStats: StatName[] = [],
    statFilterMode: 'AND' | 'OR' = 'AND',
    selectedGearSets: string[] = [],
    ship?: Ship,
    getGearPiece?: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType?: (shipType: ShipTypeName) => EngineeringStat | undefined
): PotentialResult[] {
    // Eligibility filter — identical predicate to slowAnalyzePotentialUpgrades.
    const rarityOrder = ['rare', 'epic', 'legendary'];
    const minRarityIndex = rarityOrder.indexOf(minRarity);
    const eligibleRarities = rarityOrder.slice(minRarityIndex);

    const pieceStats = (p: GearPiece): StatName[] => {
        const out: StatName[] = [];
        if (p.mainStat) out.push(p.mainStat.name);
        if (p.subStats) for (const s of p.subStats) out.push(s.name);
        return out;
    };
    const matchesStatFilter = (p: GearPiece): boolean => {
        if (selectedStats.length === 0) return true;
        const names = pieceStats(p);
        return statFilterMode === 'AND'
            ? selectedStats.every((s) => names.includes(s))
            : selectedStats.some((s) => names.includes(s));
    };

    const eligiblePieces = inventory.filter(
        (piece) =>
            piece.level < 16 &&
            eligibleRarities.includes(piece.rarity) &&
            !piece.slot.includes('implant') &&
            (!slot || piece.slot === slot) &&
            matchesStatFilter(piece) &&
            (selectedGearSets.length === 0 ||
                (piece.setBonus && selectedGearSets.includes(piece.setBonus)))
    );

    if (eligiblePieces.length === 0) return [];

    const ctx = buildPotentialContext({
        inventory: eligiblePieces,
        shipRole,
        slot,
        selectedStats,
        ship,
        getGearPiece,
        getEngineeringStatsForShipType,
    });

    const results: PotentialResult[] = [];
    for (const piece of eligiblePieces) {
        const targetSlot = slot ?? piece.slot;

        const currentScore = ctx.withShip
            ? scoreCurrentWithShip(ctx, piece, targetSlot)
            : scorePieceApplied(ctx, piece, targetSlot);

        let sumPotential = 0;
        for (let i = 0; i < simulationCount; i++) {
            const { piece: upgraded } = simulateUpgrade(piece);
            sumPotential += scorePieceApplied(ctx, upgraded, targetSlot);
        }
        const potentialScore = simulationCount > 0 ? sumPotential / simulationCount : currentScore;

        results.push({
            piece,
            currentScore,
            potentialScore,
            improvement: potentialScore - currentScore,
        });
    }

    return results.sort((a, b) => b.potentialScore - a.potentialScore).slice(0, count);
}
