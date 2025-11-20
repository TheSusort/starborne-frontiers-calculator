import { GearPiece } from '../../types/gear';
import { Ship } from '../../types/ship';
import { RarityName } from '../../constants/rarities';

export interface ImplantRarityStats {
    rarity: string;
    count: number;
    percentage: number;
}

export interface ImplantTypeStats {
    type: string;
    count: number;
    percentage: number;
}

export interface ImplantSetStats {
    setName: string;
    count: number;
    percentage: number;
}

export interface ImplantTypeSetStats {
    type: string;
    totalCount: number;
    setBonuses: ImplantSetStats[];
}

export interface ImplantStatistics {
    total: number;
    byRarity: ImplantRarityStats[];
    byType: ImplantTypeStats[];
    setsByType: ImplantTypeSetStats[];
    equippedCount: number;
    equippedPercentage: number;
    unequippedCount: number;
    unequippedPercentage: number;
}

const IMPLANT_TYPE_LABELS: Record<string, string> = {
    implant_minor_alpha: 'Minor Alpha',
    implant_minor_gamma: 'Minor Gamma',
    implant_minor_sigma: 'Minor Sigma',
    implant_major: 'Major',
    implant_ultimate: 'Ultimate',
};

export function calculateImplantStatistics(
    implants: GearPiece[],
    ships: Ship[]
): ImplantStatistics {
    if (implants.length === 0) {
        return {
            total: 0,
            byRarity: [],
            byType: [],
            setsByType: [],
            equippedCount: 0,
            equippedPercentage: 0,
            unequippedCount: 0,
            unequippedPercentage: 0,
        };
    }

    const total = implants.length;

    // Calculate rarity distribution
    const rarityMap = new Map<string, number>();
    implants.forEach((implant) => {
        const rarity = implant.rarity || 'common';
        rarityMap.set(rarity, (rarityMap.get(rarity) || 0) + 1);
    });

    const byRarity: ImplantRarityStats[] = Array.from(rarityMap.entries()).map(
        ([rarity, count]) => ({
            rarity,
            count,
            percentage: (count / total) * 100,
        })
    );

    // Calculate type distribution
    const typeMap = new Map<string, number>();
    implants.forEach((implant) => {
        const type = implant.slot || 'UNKNOWN';
        typeMap.set(type, (typeMap.get(type) || 0) + 1);
    });

    const byType: ImplantTypeStats[] = Array.from(typeMap.entries())
        .map(([type, count]) => ({
            type: IMPLANT_TYPE_LABELS[type] || type,
            count,
            percentage: (count / total) * 100,
        }))
        .sort((a, b) => b.count - a.count);

    // Calculate set bonus distribution per type
    const typeSetMap = new Map<string, { implants: GearPiece[]; setMap: Map<string, number> }>();

    implants.forEach((implant) => {
        const type = implant.slot || 'UNKNOWN';
        if (!typeSetMap.has(type)) {
            typeSetMap.set(type, { implants: [], setMap: new Map() });
        }
        const typeData = typeSetMap.get(type)!;
        typeData.implants.push(implant);

        const setName = implant.setBonus || 'None';
        typeData.setMap.set(setName, (typeData.setMap.get(setName) || 0) + 1);
    });

    const setsByType: ImplantTypeSetStats[] = Array.from(typeSetMap.entries())
        .map(([type, data]) => {
            const totalCount = data.implants.length;
            const setBonuses: ImplantSetStats[] = Array.from(data.setMap.entries())
                .map(([setName, count]) => ({
                    setName,
                    count,
                    percentage: (count / totalCount) * 100,
                }))
                .sort((a, b) => b.count - a.count);

            return {
                type: IMPLANT_TYPE_LABELS[type] || type,
                totalCount,
                setBonuses,
            };
        })
        .sort((a, b) => {
            // Sort by implant type order
            const order = ['Minor Alpha', 'Minor Gamma', 'Minor Sigma', 'Major', 'Ultimate'];
            return order.indexOf(a.type) - order.indexOf(b.type);
        });

    // Calculate equipped/unequipped by checking ships' implants
    const equippedImplantIds = new Set<string>();
    ships.forEach((ship) => {
        Object.values(ship.implants).forEach((implantId) => {
            if (implantId) {
                equippedImplantIds.add(implantId);
            }
        });
    });

    const equippedCount = implants.filter((implant) => equippedImplantIds.has(implant.id)).length;
    const equippedPercentage = (equippedCount / total) * 100;
    const unequippedCount = total - equippedCount;
    const unequippedPercentage = (unequippedCount / total) * 100;

    return {
        total,
        byRarity,
        byType,
        setsByType,
        equippedCount,
        equippedPercentage,
        unequippedCount,
        unequippedPercentage,
    };
}

export function filterImplants(
    implants: GearPiece[],
    filters: {
        type?: string | 'all';
        rarity?: RarityName | 'all';
    }
): GearPiece[] {
    let filtered = [...implants];

    if (filters.type && filters.type !== 'all') {
        filtered = filtered.filter((implant) => {
            const label = IMPLANT_TYPE_LABELS[implant.slot];
            return label === filters.type;
        });
    }

    if (filters.rarity && filters.rarity !== 'all') {
        filtered = filtered.filter((implant) => implant.rarity === filters.rarity);
    }

    return filtered;
}
