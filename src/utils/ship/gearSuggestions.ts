import { GearPiece } from '../../types/gear';
import { Ship } from '../../types/ship';
import { BaseStats, StatName } from '../../types/stats';
import { calculateTotalStats } from '../ship/statsCalculator';
import { ShipTypeName } from '../../constants/shipTypes';
import { SlotContribution } from './statDistribution';
import { GEAR_SLOTS } from '../../constants/gearTypes';
import { UpgradeReason } from '../../types/analysis';

interface GearQualityCheck {
    reasons: UpgradeReason[];
}

const DESIRED_STATS: Record<ShipTypeName, StatName[]> = {
    ATTACKER: ['crit', 'critDamage', 'attack', 'speed'],
    DEFENDER: ['hp', 'defence', 'security'],
    SUPPORTER: ['hp', 'crit', 'critDamage', 'healModifier'],
    SUPPORTER_BUFFER: ['speed', 'hp', 'defence'],
    DEBUFFER: ['hacking', 'speed', 'attack', 'crit', 'critDamage'],
};

function checkCritRate(gear: GearPiece, totalStats: BaseStats): UpgradeReason | null {
    if (totalStats.crit < 95 && !gear.subStats.some((s) => s.name === 'crit')) {
        return {
            title: 'Low crit rate',
            reason: 'Consider finding a new piece with more crit rate substats',
        };
    }
    return null;
}

export function analyzeGearQuality(
    gear: GearPiece,
    ship: Ship,
    totalStats: ReturnType<typeof calculateTotalStats>['final'],
    getGearPiece: (id: string) => GearPiece | undefined,
    slotContribution: SlotContribution
): GearQualityCheck {
    const desiredStats = DESIRED_STATS[ship.type];
    const relevantSubstats = gear.subStats.filter((stat) => desiredStats.includes(stat.name));

    const qualityCheck: GearQualityCheck = {
        reasons: [],
    };
    // Check rarity first
    if (!['epic', 'legendary'].includes(gear.rarity)) {
        qualityCheck.reasons.push({
            title: 'Low rarity',
            reason: `An epic or legendary ${gear.slot} piece would have more substats`,
        });
    }

    if (gear.stars <= 4) {
        qualityCheck.reasons.push({
            title: 'Low stars',
            reason: `A higher star ${gear.slot} piece would have more main stat`,
        });
    }

    // Check substat relevance
    if (relevantSubstats.length < 2) {
        qualityCheck.reasons.push({
            title: 'Low relevant substat count',
            reason: `Only ${relevantSubstats.length} relevant substat${relevantSubstats.length === 1 ? '' : 's'}`,
        });
    }

    // Role-specific checks
    const boostPieces = Object.values(ship.equipment).filter(
        (id) => id && getGearPiece(id)?.setBonus === 'boost'
    ).length;

    const critCheck = checkCritRate(gear, totalStats);

    switch (ship.type) {
        // @ts-expect-error supporters want repair set, and crit check
        case 'SUPPORTER':
            if (gear.setBonus !== 'repair') {
                qualityCheck.reasons.push({
                    title: 'Not a repair piece',
                    reason: `Consider finding a new ${gear.slot} with the repair set`,
                });
            }
        // Fall through to crit check
        case 'ATTACKER':
        case 'DEBUFFER':
            if (critCheck) {
                qualityCheck.reasons.push(critCheck);
            }
            break;

        case 'SUPPORTER_BUFFER':
            if (
                boostPieces < 4 &&
                gear.setBonus !== 'boost' &&
                slotContribution.relativeScore < GEAR_SLOTS[gear.slot].expectedContribution
            ) {
                qualityCheck.reasons.push({
                    title: 'Boost set bonus not found',
                    reason: 'Consider investing in the Boost set for boosters.',
                });
            }
            break;
    }

    // If we got here, the gear is mostly relevant
    return qualityCheck;
}
