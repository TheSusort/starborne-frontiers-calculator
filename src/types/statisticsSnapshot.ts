export interface ShipsSnapshot {
    total: number;
    averageLevel: number;
    maxLevelCount: number;
    maxLevelPercentage: number;
    withImplantsCount: number;
    withImplantsPercentage: number;
    fullyGearedCount: number;
    fullyGearedPercentage: number;
    ungearedCount: number;
    ungearedPercentage: number;
    refits: {
        total: number;
        average: number;
        byRarity: { rarity: string; count: number }[];
    };
    byRarity: { rarity: string; count: number; percentage: number }[];
    byRole: { role: string; count: number; percentage: number }[];
    byFaction: { faction: string; count: number }[];
    levels: { range: string; count: number }[];
}

export interface GearSnapshot {
    total: number;
    equippedCount: number;
    equippedPercentage: number;
    unequippedCount: number;
    unequippedPercentage: number;
    averageLevel: number;
    averageStarLevel: number;
    maxLevelCount: number;
    maxLevelPercentage: number;
    bySet: { setName: string; count: number }[];
    byMainStat: {
        statName: string;
        statType: string;
        count: number;
        category: 'Offensive' | 'Defensive' | 'Utility';
    }[];
    byRarity: { rarity: string; count: number; percentage: number }[];
    byStarLevel: { stars: number; count: number }[];
    byLevel: { range: string; count: number }[];
    bySlot: { slot: string; count: number }[];
}

export interface ImplantsSnapshot {
    total: number;
    equippedCount: number;
    equippedPercentage: number;
    unequippedCount: number;
    unequippedPercentage: number;
    byRarity: { rarity: string; count: number; percentage: number }[];
    byType: { type: string; count: number; percentage: number }[];
    setsByType: {
        type: string;
        totalCount: number;
        setBonuses: { setName: string; count: number; percentage: number }[];
    }[];
}

export interface EngineeringSnapshot {
    totalPoints: number;
    averagePointsPerRole: number;
    mostInvestedRole: { role: string; points: number } | null;
    leastInvestedRole: { role: string; points: number } | null;
    rolesWithZeroInvestment: string[];
    byRole: {
        role: string;
        totalPoints: number;
        byStatType: { statName: string; points: number }[];
    }[];
}

export interface StatisticsSnapshot {
    id: string;
    userId: string;
    snapshotMonth: string;
    shipsStats: ShipsSnapshot | null;
    gearStats: GearSnapshot | null;
    implantsStats: ImplantsSnapshot | null;
    engineeringStats: EngineeringSnapshot | null;
    createdAt: string;
}

export interface SnapshotListItem {
    id: string;
    snapshotMonth: string;
}
