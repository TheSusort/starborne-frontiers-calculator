import { EngineeringStat } from '../../types/stats';
import { ShipTypeName } from '../../constants';

export interface RoleEngineeringStats {
    role: ShipTypeName;
    totalPoints: number;
    byStatType: { statName: string; points: number }[];
}

export interface EngineeringStatistics {
    totalPoints: number;
    averagePointsPerRole: number;
    byRole: RoleEngineeringStats[];
    mostInvestedRole: { role: ShipTypeName; points: number } | null;
    leastInvestedRole: { role: ShipTypeName; points: number } | null;
    rolesWithZeroInvestment: ShipTypeName[];
}

export function calculateEngineeringStatistics(
    engineeringStats: EngineeringStat[]
): EngineeringStatistics {
    if (engineeringStats.length === 0) {
        return {
            totalPoints: 0,
            averagePointsPerRole: 0,
            byRole: [],
            mostInvestedRole: null,
            leastInvestedRole: null,
            rolesWithZeroInvestment: [],
        };
    }

    let totalPoints = 0;
    const byRole: RoleEngineeringStats[] = [];

    engineeringStats.forEach((roleStat) => {
        let roleTotal = 0;
        const byStatType: { statName: string; points: number }[] = [];

        roleStat.stats.forEach((stat) => {
            // Convert stat value to engineering points spent
            // Flat stats: 2 stat points per engineering point (divide by 2)
            // Percentage stats: 1 stat point per engineering point (use as is)
            const engineeringPoints =
                stat.type === 'flat' ? (stat.value || 0) / 2 : stat.value || 0;

            roleTotal += engineeringPoints;
            totalPoints += engineeringPoints;

            byStatType.push({
                statName: stat.name,
                points: engineeringPoints,
            });
        });

        byRole.push({
            role: roleStat.shipType,
            totalPoints: roleTotal,
            byStatType,
        });
    });

    // Sort by total points descending
    byRole.sort((a, b) => b.totalPoints - a.totalPoints);

    const averagePointsPerRole = totalPoints / engineeringStats.length;

    // Find most and least invested roles
    const mostInvestedRole =
        byRole.length > 0 ? { role: byRole[0].role, points: byRole[0].totalPoints } : null;

    // Find least invested (excluding zero)
    const nonZeroRoles = byRole.filter((r) => r.totalPoints > 0);
    const leastInvestedRole =
        nonZeroRoles.length > 0
            ? {
                  role: nonZeroRoles[nonZeroRoles.length - 1].role,
                  points: nonZeroRoles[nonZeroRoles.length - 1].totalPoints,
              }
            : null;

    // Find roles with zero investment
    const rolesWithZeroInvestment = byRole.filter((r) => r.totalPoints === 0).map((r) => r.role);

    return {
        totalPoints,
        averagePointsPerRole,
        byRole,
        mostInvestedRole,
        leastInvestedRole,
        rolesWithZeroInvestment,
    };
}
