import { Ship } from '../../types/ship';
import { ShipTypeName } from '../../constants';

export interface ShipRarityStats {
    rarity: string;
    count: number;
    percentage: number;
}

export interface ShipRoleStats {
    role: string;
    count: number;
    percentage: number;
}

export interface ShipFactionStats {
    faction: string;
    count: number;
}

export interface ShipRefitStats {
    total: number;
    average: number;
    byRarity: { rarity: string; count: number }[];
}

export interface ShipLevelStats {
    range: string;
    count: number;
}

export interface ShipStatistics {
    total: number;
    byRarity: ShipRarityStats[];
    byRole: ShipRoleStats[];
    byFaction: ShipFactionStats[];
    refits: ShipRefitStats;
    levels: ShipLevelStats[];
    averageLevel: number;
    maxLevelCount: number;
    maxLevelPercentage: number;
    withImplantsCount: number;
    withImplantsPercentage: number;
    fullyGearedCount: number;
    fullyGearedPercentage: number;
    ungearedCount: number;
    ungearedPercentage: number;
}

export function calculateShipStatistics(ships: Ship[]): ShipStatistics {
    if (ships.length === 0) {
        return {
            total: 0,
            byRarity: [],
            byRole: [],
            byFaction: [],
            refits: { total: 0, average: 0, byRarity: [] },
            levels: [],
            averageLevel: 0,
            maxLevelCount: 0,
            maxLevelPercentage: 0,
            withImplantsCount: 0,
            withImplantsPercentage: 0,
            fullyGearedCount: 0,
            fullyGearedPercentage: 0,
            ungearedCount: 0,
            ungearedPercentage: 0,
        };
    }

    const total = ships.length;

    // Calculate rarity distribution
    const rarityMap = new Map<string, number>();
    ships.forEach((ship) => {
        const rarity = ship.rarity || 'common';
        rarityMap.set(rarity, (rarityMap.get(rarity) || 0) + 1);
    });

    const byRarity: ShipRarityStats[] = Array.from(rarityMap.entries()).map(([rarity, count]) => ({
        rarity,
        count,
        percentage: (count / total) * 100,
    }));

    // Calculate role distribution
    const roleMap = new Map<string, number>();
    ships.forEach((ship) => {
        const role = ship.type || 'UNKNOWN';
        roleMap.set(role, (roleMap.get(role) || 0) + 1);
    });

    const byRole: ShipRoleStats[] = Array.from(roleMap.entries()).map(([role, count]) => ({
        role,
        count,
        percentage: (count / total) * 100,
    }));

    // Calculate faction distribution
    const factionMap = new Map<string, number>();
    ships.forEach((ship) => {
        const faction = ship.faction || 'UNKNOWN';
        factionMap.set(faction, (factionMap.get(faction) || 0) + 1);
    });

    const byFaction: ShipFactionStats[] = Array.from(factionMap.entries()).map(
        ([faction, count]) => ({
            faction,
            count,
        })
    );

    // Calculate refit statistics
    let totalRefits = 0;
    const refitsByRarity = new Map<string, number>();

    ships.forEach((ship) => {
        const refitCount = ship.refits ? Object.keys(ship.refits).length : 0;
        totalRefits += refitCount;

        if (refitCount > 0) {
            const rarity = ship.rarity || 'common';
            refitsByRarity.set(rarity, (refitsByRarity.get(rarity) || 0) + refitCount);
        }
    });

    const refits: ShipRefitStats = {
        total: totalRefits,
        average: totalRefits / total,
        byRarity: Array.from(refitsByRarity.entries()).map(([rarity, count]) => ({
            rarity,
            count,
        })),
    };

    // Calculate level distribution
    const levelBins = [
        { min: 1, max: 10, label: '1-10' },
        { min: 11, max: 20, label: '11-20' },
        { min: 21, max: 30, label: '21-30' },
        { min: 31, max: 40, label: '31-40' },
        { min: 41, max: 50, label: '41-50' },
        { min: 51, max: 59, label: '51-59' },
        { min: 60, max: 60, label: '60 (Max)' },
    ];

    const levelCounts = new Map<string, number>();
    let totalLevels = 0;
    let maxLevelCount = 0;

    ships.forEach((ship) => {
        const level = ship.level || 1;
        totalLevels += level;

        if (level === 60) {
            maxLevelCount++;
        }

        const bin = levelBins.find((b) => level >= b.min && level <= b.max);
        if (bin) {
            levelCounts.set(bin.label, (levelCounts.get(bin.label) || 0) + 1);
        }
    });

    const levels: ShipLevelStats[] = levelBins.map((bin) => ({
        range: bin.label,
        count: levelCounts.get(bin.label) || 0,
    }));

    const averageLevel = totalLevels / total;
    const maxLevelPercentage = (maxLevelCount / total) * 100;

    // Calculate implant statistics
    const withImplantsCount = ships.filter(
        (ship) => ship.implants && Object.keys(ship.implants).length > 0
    ).length;
    const withImplantsPercentage = (withImplantsCount / total) * 100;

    // Calculate gearing statistics
    const fullyGearedCount = ships.filter(
        (ship) => ship.equipment && Object.keys(ship.equipment).length === 6
    ).length;
    const fullyGearedPercentage = (fullyGearedCount / total) * 100;

    const ungearedCount = ships.filter(
        (ship) => !ship.equipment || Object.keys(ship.equipment).length === 0
    ).length;
    const ungearedPercentage = (ungearedCount / total) * 100;

    return {
        total,
        byRarity,
        byRole,
        byFaction,
        refits,
        levels,
        averageLevel,
        maxLevelCount,
        maxLevelPercentage,
        withImplantsCount,
        withImplantsPercentage,
        fullyGearedCount,
        fullyGearedPercentage,
        ungearedCount,
        ungearedPercentage,
    };
}

export function filterShips(
    ships: Ship[],
    filters: { role?: ShipTypeName | 'all'; rarity?: string | 'all' }
): Ship[] {
    let filtered = [...ships];

    if (filters.role && filters.role !== 'all') {
        filtered = filtered.filter((ship) => ship.type === filters.role);
    }

    if (filters.rarity && filters.rarity !== 'all') {
        filtered = filtered.filter((ship) => ship.rarity === filters.rarity);
    }

    return filtered;
}
