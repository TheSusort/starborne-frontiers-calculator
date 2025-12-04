import React, { useMemo, useState, useEffect } from 'react';
import { EngineeringStat } from '../../types/stats';
import { StatCard } from './StatCard';
import { calculateEngineeringStatistics } from '../../utils/statistics/engineeringStats';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell } from 'recharts';
import { BaseChart, ChartTooltip } from '../ui/charts';
import { useAuth } from '../../contexts/AuthProvider';
import {
    getEngineeringLeaderboard,
    getEngineeringTokensLeaderboard,
    LeaderboardEntry,
    TokensLeaderboardEntry,
} from '../../services/engineeringLeaderboardService';
import { TrophyIcon } from '../ui/icons';

interface EngineeringStatsTabProps {
    engineeringStats: EngineeringStat[];
}

const CHART_COLORS = [
    '#3b82f6', // HP
    '#ef4444', // Attack
    '#10b981', // Defence
    '#f59e0b', // Speed
    '#8b5cf6', // Hacking
    '#06b6d4', // Other
];

// Medal colors matching the ship leaderboard
const MEDAL_COLORS = {
    gold: '#facc15', // yellow-400
    goldLight: '#fef08a', // yellow-200 (for current user in 1st)
    silver: '#d1d5db', // gray-300
    silverLight: '#f3f4f6', // gray-100 (for current user in 2nd)
    bronze: '#d97706', // amber-600
    default: '#d97706', // bronze
    currentUser: '#f7b06e', // orange
};

// Get bar color based on rank and whether it's the current user
const getLeaderboardBarColor = (rank: number, isCurrentUser: boolean): string => {
    if (isCurrentUser) {
        if (rank === 1) return MEDAL_COLORS.goldLight;
        if (rank === 2) return MEDAL_COLORS.silverLight;
        return MEDAL_COLORS.currentUser;
    }
    if (rank === 1) return MEDAL_COLORS.gold;
    if (rank === 2) return MEDAL_COLORS.silver;
    return MEDAL_COLORS.default;
};

// Custom Y-axis tick component with trophy icons for top 3
interface CustomYAxisTickProps {
    x?: number;
    y?: number;
    payload?: { value: string };
}

const CustomYAxisTick: React.FC<CustomYAxisTickProps> = ({ x, y, payload }) => {
    if (!payload || x === undefined || y === undefined) return null;

    const label = payload.value;
    // Extract rank from label (e.g., "#1" or "#1 (You)")
    const rankMatch = label.match(/^#(\d+)/);
    const rank = rankMatch ? parseInt(rankMatch[1], 10) : 0;
    const isCurrentUser = label.includes('(You)');

    // Medal colors for top 3
    const medalColors: Record<number, string> = {
        1: '#facc15', // gold
        2: '#d1d5db', // silver
    };

    const showTrophy = rank >= 1 && rank <= 2;
    const medalColor = medalColors[rank];

    // Determine label color: current user gets their color, top 3 get medal colors, others get gray
    const getLabelColor = () => {
        if (isCurrentUser) return MEDAL_COLORS.currentUser;
        if (showTrophy) return medalColor;
        return '#9ca3af';
    };

    return (
        <g transform={`translate(${x},${y})`}>
            {showTrophy ? (
                <>
                    <foreignObject x={-35} y={-8} width={20} height={20}>
                        <TrophyIcon className="w-4 h-4" style={{ color: medalColor }} />
                    </foreignObject>
                    <text x={-17} y={4} textAnchor="start" fill={getLabelColor()} fontSize={12}>
                        {label}
                    </text>
                </>
            ) : (
                <text x={-5} y={4} textAnchor="end" fill={getLabelColor()} fontSize={12}>
                    {label}
                </text>
            )}
        </g>
    );
};

export const EngineeringStatsTab: React.FC<EngineeringStatsTabProps> = ({ engineeringStats }) => {
    const { user } = useAuth();
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [leaderboardLoading, setLeaderboardLoading] = useState(false);
    const [tokensLeaderboard, setTokensLeaderboard] = useState<TokensLeaderboardEntry[]>([]);
    const [tokensLeaderboardLoading, setTokensLeaderboardLoading] = useState(false);

    const stats = useMemo(() => {
        return calculateEngineeringStatistics(engineeringStats);
    }, [engineeringStats]);

    // Fetch leaderboard data when user is logged in
    useEffect(() => {
        if (!user?.id) {
            setLeaderboard([]);
            setTokensLeaderboard([]);
            return;
        }

        const fetchLeaderboards = async () => {
            setLeaderboardLoading(true);
            setTokensLeaderboardLoading(true);
            try {
                const [pointsData, tokensData] = await Promise.all([
                    getEngineeringLeaderboard(user.id),
                    getEngineeringTokensLeaderboard(user.id),
                ]);
                setLeaderboard(pointsData);
                setTokensLeaderboard(tokensData);
            } catch (error) {
                console.error('Failed to fetch leaderboards:', error);
                setLeaderboard([]);
                setTokensLeaderboard([]);
            } finally {
                setLeaderboardLoading(false);
                setTokensLeaderboardLoading(false);
            }
        };

        fetchLeaderboards();
    }, [user?.id]);

    // Prepare leaderboard chart data
    const leaderboardChartData = useMemo(() => {
        return leaderboard.map((entry) => ({
            name: entry.isCurrentUser ? `#${entry.rank} (You)` : `#${entry.rank}`,
            points: entry.totalPoints,
            isCurrentUser: entry.isCurrentUser,
            rank: entry.rank,
        }));
    }, [leaderboard]);

    // Prepare tokens leaderboard chart data
    const tokensLeaderboardChartData = useMemo(() => {
        return tokensLeaderboard.map((entry) => ({
            name: entry.isCurrentUser ? `#${entry.rank} (You)` : `#${entry.rank}`,
            tokens: entry.totalTokens,
            isCurrentUser: entry.isCurrentUser,
            rank: entry.rank,
        }));
    }, [tokensLeaderboard]);

    // Prepare data for points by role chart
    const roleChartData = stats.byRole.map((role) => ({
        name: role.role,
        points: role.totalPoints,
    }));

    // Prepare data for stacked bar chart (points by stat type per role)
    const stackedChartData = stats.byRole.map((role) => {
        const data: Record<string, string | number> = { name: role.role };
        role.byStatType.forEach((stat) => {
            data[stat.statName] = stat.points;
        });
        return data;
    });

    // Get all unique stat names for the legend
    const allStatNames = useMemo(() => {
        const names = new Set<string>();
        stats.byRole.forEach((role) => {
            role.byStatType.forEach((stat) => {
                names.add(stat.statName);
            });
        });
        return Array.from(names);
    }, [stats.byRole]);

    // Empty state
    if (stats.totalPoints === 0) {
        return (
            <div className="bg-dark p-12 border border-dark-border text-center">
                <div className="text-gray-400 text-lg">No engineering points invested yet.</div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Overview Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    title="Total Points"
                    value={stats.totalPoints.toLocaleString()}
                    color="blue"
                />
                <StatCard
                    title="Average Per Role"
                    value={stats.averagePointsPerRole.toFixed(0)}
                    color="green"
                />
                <StatCard
                    title="Most Invested"
                    value={stats.mostInvestedRole?.role || 'N/A'}
                    subtitle={`${stats.mostInvestedRole?.points || 0} points`}
                    color="yellow"
                />
                <StatCard
                    title="Roles with 0 Points"
                    value={stats.rolesWithZeroInvestment.length}
                    color="red"
                />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Points by Role */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Points by Role</h3>
                    <BaseChart height={400}>
                        <BarChart data={roleChartData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis type="number" stroke="#9ca3af" />
                            <YAxis dataKey="name" type="category" stroke="#9ca3af" width={150} />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                            <Bar dataKey="points" fill="#3b82f6" />
                        </BarChart>
                    </BaseChart>
                </div>

                {/* Stat Type Breakdown */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Point Distribution by Stat Type</h3>
                    <BaseChart height={400}>
                        <BarChart data={stackedChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="name" stroke="#9ca3af" />
                            <YAxis stroke="#9ca3af" />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                            <Legend />
                            {allStatNames.map((statName, index) => (
                                <Bar
                                    key={statName}
                                    dataKey={statName}
                                    stackId="a"
                                    fill={CHART_COLORS[index % CHART_COLORS.length]}
                                />
                            ))}
                        </BarChart>
                    </BaseChart>
                </div>
            </div>

            {/* Engineering Leaderboards */}
            {user && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Engineering Points Leaderboard */}
                    <div className="card">
                        <h3 className="text-lg font-semibold mb-4">Engineering Points Ranking</h3>
                        <p className="text-sm text-gray-400 mb-4">
                            Compare your total engineering points with other players.
                        </p>
                        {leaderboardLoading ? (
                            <div className="flex items-center justify-center h-[300px]">
                                <div className="text-gray-400">Loading leaderboard...</div>
                            </div>
                        ) : leaderboardChartData.length === 0 ? (
                            <div className="flex items-center justify-center h-[300px]">
                                <div className="text-gray-400">
                                    No data available. Start investing engineering points!
                                </div>
                            </div>
                        ) : (
                            <BaseChart height={300}>
                                <BarChart data={leaderboardChartData} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                    <XAxis type="number" stroke="#9ca3af" />
                                    <YAxis
                                        dataKey="name"
                                        type="category"
                                        stroke="#9ca3af"
                                        width={100}
                                        interval={0}
                                        tick={<CustomYAxisTick />}
                                    />
                                    <Tooltip
                                        content={
                                            <ChartTooltip
                                                formatter={(value: number | string) =>
                                                    `${Number(value).toLocaleString()} points`
                                                }
                                            />
                                        }
                                        cursor={{ fill: 'transparent' }}
                                    />
                                    <Bar dataKey="points">
                                        {leaderboardChartData.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={getLeaderboardBarColor(
                                                    entry.rank,
                                                    entry.isCurrentUser
                                                )}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </BaseChart>
                        )}
                    </div>

                    {/* Engineering Tokens Leaderboard */}
                    <div className="card">
                        <h3 className="text-lg font-semibold mb-4">Engineering Tokens Ranking</h3>
                        <p className="text-sm text-gray-400 mb-4">
                            Compare total tokens spent. Higher levels cost more tokens!
                        </p>
                        {tokensLeaderboardLoading ? (
                            <div className="flex items-center justify-center h-[300px]">
                                <div className="text-gray-400">Loading leaderboard...</div>
                            </div>
                        ) : tokensLeaderboardChartData.length === 0 ? (
                            <div className="flex items-center justify-center h-[300px]">
                                <div className="text-gray-400">
                                    No data available. Start investing engineering points!
                                </div>
                            </div>
                        ) : (
                            <BaseChart height={300}>
                                <BarChart data={tokensLeaderboardChartData} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                    <XAxis type="number" stroke="#9ca3af" />
                                    <YAxis
                                        dataKey="name"
                                        type="category"
                                        stroke="#9ca3af"
                                        width={100}
                                        interval={0}
                                        tick={<CustomYAxisTick />}
                                    />
                                    <Tooltip
                                        content={
                                            <ChartTooltip
                                                formatter={(value: number | string) =>
                                                    `${Number(value).toLocaleString()} tokens`
                                                }
                                            />
                                        }
                                        cursor={{ fill: 'transparent' }}
                                    />
                                    <Bar dataKey="tokens">
                                        {tokensLeaderboardChartData.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={getLeaderboardBarColor(
                                                    entry.rank,
                                                    entry.isCurrentUser
                                                )}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </BaseChart>
                        )}
                    </div>
                </div>
            )}

            {/* Detailed Table */}
            <div className="card">
                <h3 className="text-lg font-semibold mb-4">Detailed Investment Table</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-dark-border">
                                <th className="text-left py-2 text-gray-400">Role</th>
                                {allStatNames.map((statName) => (
                                    <th
                                        key={statName}
                                        className="text-right py-2 px-2 text-gray-400"
                                    >
                                        {statName}
                                    </th>
                                ))}
                                <th className="text-right py-2 text-gray-400 font-bold">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.byRole.map((role) => {
                                const statMap = new Map(
                                    role.byStatType.map((s) => [s.statName, s.points])
                                );
                                return (
                                    <tr key={role.role} className="border-b border-gray-800">
                                        <td className="py-2">{role.role}</td>
                                        {allStatNames.map((statName) => (
                                            <td key={statName} className="text-right py-2 px-2">
                                                {statMap.get(statName) || 0}
                                            </td>
                                        ))}
                                        <td className="text-right py-2 font-bold text-yellow-400">
                                            {role.totalPoints}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Zero Investment Warning */}
            {stats.rolesWithZeroInvestment.length > 0 && (
                <div className="bg-red-900/20 border border-red-700 p-4">
                    <h4 className="text-red-400 font-semibold mb-2">Roles with No Investment</h4>
                    <div className="text-gray-300">{stats.rolesWithZeroInvestment.join(', ')}</div>
                </div>
            )}
        </div>
    );
};
