import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthProvider';
import { PageLayout } from '../../components/ui';
import { UsageChart } from '../../components/admin/UsageChart';
import { TopUsersTable } from '../../components/admin/TopUsersTable';
import { StatCard } from '../../components/admin/StatCard';
import {
    isAdmin,
    getDailyUsageStats,
    getTopActiveUsers,
    getTotalUserCount,
    DailyUsageStat,
    TopUser,
} from '../../services/adminService';
import { Loader } from '../../components/ui/Loader';

export const AdminPanel: React.FC = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [isUserAdmin, setIsUserAdmin] = useState(false);
    const [dailyStats, setDailyStats] = useState<DailyUsageStat[]>([]);
    const [topUsers, setTopUsers] = useState<TopUser[]>([]);
    const [totalUsers, setTotalUsers] = useState(0);
    const [daysBack, setDaysBack] = useState(30);

    useEffect(() => {
        const checkAdminAndLoadData = async () => {
            if (!user) {
                navigate('/');
                return;
            }

            // Check if user is admin
            const adminStatus = await isAdmin(user.id);
            setIsUserAdmin(adminStatus);

            if (!adminStatus) {
                navigate('/');
                return;
            }

            // Load analytics data
            await loadData();
            setLoading(false);
        };

        checkAdminAndLoadData();
    }, [user, navigate, daysBack]);

    const loadData = async () => {
        const [statsData, usersData, userCount] = await Promise.all([
            getDailyUsageStats(daysBack),
            getTopActiveUsers(5),
            getTotalUserCount(),
        ]);

        if (statsData) setDailyStats(statsData);
        if (usersData) setTopUsers(usersData);
        setTotalUsers(userCount);
    };

    if (loading) {
        return (
            <PageLayout title="Admin Panel" description="Loading...">
                <Loader />
            </PageLayout>
        );
    }

    if (!isUserAdmin) {
        return null;
    }

    // Calculate summary stats from daily data
    const totalAutogearRuns = dailyStats.reduce((sum, stat) => sum + stat.total_autogear_runs, 0);
    const totalDataImports = dailyStats.reduce((sum, stat) => sum + stat.total_data_imports, 0);
    const avgDailyActiveUsers =
        dailyStats.length > 0
            ? Math.round(
                  dailyStats.reduce((sum, stat) => sum + stat.unique_active_users, 0) /
                      dailyStats.length
              )
            : 0;

    return (
        <PageLayout
            title="Admin Panel"
            description="Analytics and insights about app usage and user activity"
        >
            <div className="space-y-6">
                {/* Time Range Selector */}
                <div className="flex justify-end">
                    <select
                        value={daysBack}
                        onChange={(e) => setDaysBack(Number(e.target.value))}
                        className="px-4 py-2 bg-dark-lighter border border-gray-700  text-white focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                        <option value={7}>Last 7 days</option>
                        <option value={14}>Last 14 days</option>
                        <option value={30}>Last 30 days</option>
                        <option value={60}>Last 60 days</option>
                        <option value={90}>Last 90 days</option>
                    </select>
                </div>

                {/* Summary Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard title="Total Users" value={totalUsers.toLocaleString()} />
                    <StatCard
                        title={`Autogear Runs (${daysBack}d)`}
                        value={totalAutogearRuns.toLocaleString()}
                    />
                    <StatCard
                        title={`Data Imports (${daysBack}d)`}
                        value={totalDataImports.toLocaleString()}
                    />
                    <StatCard
                        title="Avg Daily Active Users"
                        value={avgDailyActiveUsers.toLocaleString()}
                    />
                </div>

                {/* Usage Chart */}
                <UsageChart data={dailyStats} title={`Daily Usage (Last ${daysBack} Days)`} />

                {/* Top Users Table */}
                <TopUsersTable users={topUsers} />
            </div>
        </PageLayout>
    );
};

export default AdminPanel;
