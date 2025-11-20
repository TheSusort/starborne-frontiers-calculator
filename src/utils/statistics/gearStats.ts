import { GearPiece } from '../../types/gear';
import { Ship } from '../../types/ship';
import { GearSetName } from '../../constants';
import { RarityName } from '../../constants/rarities';

export interface GearSetStats {
    setName: string;
    count: number;
}

export interface GearMainStatStats {
    statName: string;
    statType: string; // percentage or flat
    count: number;
    category: 'Offensive' | 'Defensive' | 'Utility';
}

export interface GearRarityStats {
    rarity: string;
    count: number;
    percentage: number;
}

export interface GearStarStats {
    stars: number;
    count: number;
}

export interface GearLevelStats {
    range: string;
    count: number;
}

export interface GearSlotStats {
    slot: string;
    count: number;
}

export interface GearStatistics {
    total: number;
    bySet: GearSetStats[];
    byMainStat: GearMainStatStats[];
    byRarity: GearRarityStats[];
    byStarLevel: GearStarStats[];
    byLevel: GearLevelStats[];
    bySlot: GearSlotStats[];
    equippedCount: number;
    equippedPercentage: number;
    unequippedCount: number;
    unequippedPercentage: number;
    averageLevel: number;
    averageStarLevel: number;
    maxLevelCount: number;
    maxLevelPercentage: number;
}

function categorizeMainStat(statName: string): 'Offensive' | 'Defensive' | 'Utility' {
    const offensiveStats = ['attack', 'crit', 'critDamage', 'defensePenetration'];
    const defensiveStats = ['hp', 'defence', 'shield', 'hpRegen'];

    if (offensiveStats.includes(statName)) {
        return 'Offensive';
    } else if (defensiveStats.includes(statName)) {
        return 'Defensive';
    } else {
        return 'Utility';
    }
}

export function calculateGearStatistics(gear: GearPiece[], ships: Ship[]): GearStatistics {
    if (gear.length === 0) {
        return {
            total: 0,
            bySet: [],
            byMainStat: [],
            byRarity: [],
            byStarLevel: [],
            byLevel: [],
            bySlot: [],
            equippedCount: 0,
            equippedPercentage: 0,
            unequippedCount: 0,
            unequippedPercentage: 0,
            averageLevel: 0,
            averageStarLevel: 0,
            maxLevelCount: 0,
            maxLevelPercentage: 0,
        };
    }

    const total = gear.length;

    // Calculate set distribution
    const setMap = new Map<string, number>();
    gear.forEach((piece) => {
        if (piece.setBonus) {
            setMap.set(piece.setBonus, (setMap.get(piece.setBonus) || 0) + 1);
        } else {
            setMap.set('None', (setMap.get('None') || 0) + 1);
        }
    });

    const bySet: GearSetStats[] = Array.from(setMap.entries())
        .map(([setName, count]) => ({
            setName,
            count,
        }))
        .sort((a, b) => b.count - a.count);

    // Calculate main stat distribution
    const mainStatMap = new Map<string, { count: number; type: string; category: string }>();
    gear.forEach((piece) => {
        if (piece.mainStat) {
            const key = `${piece.mainStat.name}_${piece.mainStat.type}`;
            const existing = mainStatMap.get(key);
            if (existing) {
                existing.count++;
            } else {
                mainStatMap.set(key, {
                    count: 1,
                    type: piece.mainStat.type,
                    category: categorizeMainStat(piece.mainStat.name),
                });
            }
        }
    });

    const byMainStat: GearMainStatStats[] = Array.from(mainStatMap.entries())
        .map(([key, data]) => {
            const [statName, statType] = key.split('_');
            return {
                statName,
                statType,
                count: data.count,
                category: data.category as 'Offensive' | 'Defensive' | 'Utility',
            };
        })
        .sort((a, b) => b.count - a.count);

    // Calculate rarity distribution
    const rarityMap = new Map<string, number>();
    gear.forEach((piece) => {
        const rarity = piece.rarity || 'common';
        rarityMap.set(rarity, (rarityMap.get(rarity) || 0) + 1);
    });

    const byRarity: GearRarityStats[] = Array.from(rarityMap.entries()).map(([rarity, count]) => ({
        rarity,
        count,
        percentage: (count / total) * 100,
    }));

    // Calculate star level distribution
    const starMap = new Map<number, number>();
    let totalStars = 0;
    gear.forEach((piece) => {
        const stars = piece.stars || 1;
        totalStars += stars;
        starMap.set(stars, (starMap.get(stars) || 0) + 1);
    });

    const byStarLevel: GearStarStats[] = [1, 2, 3, 4, 5, 6].map((stars) => ({
        stars,
        count: starMap.get(stars) || 0,
    }));

    const averageStarLevel = totalStars / total;

    // Calculate level distribution
    const levelBins = [
        { min: 0, max: 3, label: '0-3' },
        { min: 4, max: 7, label: '4-7' },
        { min: 8, max: 11, label: '8-11' },
        { min: 12, max: 15, label: '12-15' },
        { min: 16, max: 16, label: '16 (Max)' },
    ];

    const levelCounts = new Map<string, number>();
    let totalLevels = 0;
    let maxLevelCount = 0;

    gear.forEach((piece) => {
        const level = piece.level || 1;
        totalLevels += level;

        if (level === 16) {
            maxLevelCount++;
        }

        const bin = levelBins.find((b) => level >= b.min && level <= b.max);
        if (bin) {
            levelCounts.set(bin.label, (levelCounts.get(bin.label) || 0) + 1);
        }
    });

    const byLevel: GearLevelStats[] = levelBins.map((bin) => ({
        range: bin.label,
        count: levelCounts.get(bin.label) || 0,
    }));

    const averageLevel = totalLevels / total;
    const maxLevelPercentage = (maxLevelCount / total) * 100;

    // Calculate slot distribution
    const slotMap = new Map<string, number>();
    gear.forEach((piece) => {
        const slot = piece.slot || 'UNKNOWN';
        slotMap.set(slot, (slotMap.get(slot) || 0) + 1);
    });

    const bySlot: GearSlotStats[] = Array.from(slotMap.entries()).map(([slot, count]) => ({
        slot,
        count,
    }));

    // Calculate equipped/unequipped by checking ships' equipment
    const equippedGearIds = new Set<string>();
    ships.forEach((ship) => {
        Object.values(ship.equipment).forEach((gearId) => {
            if (gearId) {
                equippedGearIds.add(gearId);
            }
        });
    });

    const equippedCount = gear.filter((piece) => equippedGearIds.has(piece.id)).length;
    const equippedPercentage = (equippedCount / total) * 100;
    const unequippedCount = total - equippedCount;
    const unequippedPercentage = (unequippedCount / total) * 100;

    return {
        total,
        bySet,
        byMainStat,
        byRarity,
        byStarLevel,
        byLevel,
        bySlot,
        equippedCount,
        equippedPercentage,
        unequippedCount,
        unequippedPercentage,
        averageLevel,
        averageStarLevel,
        maxLevelCount,
        maxLevelPercentage,
    };
}

export function filterGear(
    gear: GearPiece[],
    filters: {
        setBonus?: GearSetName | 'all' | 'none';
        mainStatType?: string | 'all';
        rarity?: RarityName | 'all';
    }
): GearPiece[] {
    let filtered = [...gear];

    if (filters.setBonus && filters.setBonus !== 'all') {
        if (filters.setBonus === 'none') {
            filtered = filtered.filter((piece) => !piece.setBonus);
        } else {
            filtered = filtered.filter((piece) => piece.setBonus === filters.setBonus);
        }
    }

    if (filters.mainStatType && filters.mainStatType !== 'all') {
        filtered = filtered.filter((piece) => {
            if (!piece.mainStat) return false;
            const key = `${piece.mainStat.name}_${piece.mainStat.type}`;
            return key === filters.mainStatType;
        });
    }

    if (filters.rarity && filters.rarity !== 'all') {
        filtered = filtered.filter((piece) => piece.rarity === filters.rarity);
    }

    return filtered;
}
