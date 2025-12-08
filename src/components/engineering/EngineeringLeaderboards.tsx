import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthProvider';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { BaseChart, ChartTooltip } from '../ui/charts';
import {
    getEngineeringLeaderboard,
    getEngineeringTokensLeaderboard,
    LeaderboardEntry,
    TokensLeaderboardEntry,
} from '../../services/engineeringLeaderboardService';
import { TrophyIcon } from '../ui/icons';

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

interface EngineeringLeaderboardsProps {
    className?: string;
}

export const EngineeringLeaderboards: React.FC<EngineeringLeaderboardsProps> = ({
    className = '',
}) => {
    const { user } = useAuth();
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [leaderboardLoading, setLeaderboardLoading] = useState(false);
    const [tokensLeaderboard, setTokensLeaderboard] = useState<TokensLeaderboardEntry[]>([]);
    const [tokensLeaderboardLoading, setTokensLeaderboardLoading] = useState(false);

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
        return leaderboard.map((entry) => {
            const usernamePart = entry.username ? ` ${entry.username}` : '';
            const name = entry.isCurrentUser
                ? `#${entry.rank}${usernamePart} (You)`
                : `#${entry.rank}${usernamePart}`;
            return {
                name,
                points: entry.totalPoints,
                isCurrentUser: entry.isCurrentUser,
                rank: entry.rank,
            };
        });
    }, [leaderboard]);

    // Prepare tokens leaderboard chart data
    const tokensLeaderboardChartData = useMemo(() => {
        return tokensLeaderboard.map((entry) => {
            const usernamePart = entry.username ? ` ${entry.username}` : '';
            const name = entry.isCurrentUser
                ? `#${entry.rank}${usernamePart} (You)`
                : `#${entry.rank}${usernamePart}`;
            return {
                name,
                tokens: entry.totalTokens,
                isCurrentUser: entry.isCurrentUser,
                rank: entry.rank,
            };
        });
    }, [tokensLeaderboard]);

    if (!user) {
        return (
            <div className={`${className}`}>
                <div className="flex items-center justify-center h-[300px]">
                    <div className="text-gray-400">Please sign in to view leaderboards</div>
                </div>
            </div>
        );
    }

    return (
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-6 ${className}`}>
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
                                width={120}
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
                                width={120}
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
    );
};
