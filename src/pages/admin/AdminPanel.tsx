import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthProvider';
import { PageLayout, Select, Tabs, CollapsibleForm, Button } from '../../components/ui';
import { UsageChart } from '../../components/admin/UsageChart';
import { AllUsersTable } from '../../components/admin/AllUsersTable';
import { StatCard } from '../../components/ui';
import { GrowthChart } from '../../components/admin/GrowthChart';
import { TableSizesTable } from '../../components/admin/TableSizesTable';
import { TemplateProposalsTable } from '../../components/admin/TemplateProposalsTable';
import { AddShipTemplateForm } from '../../components/admin/AddShipTemplateForm';
import { LiveTrafficCard } from '../../components/admin/LiveTrafficCard';
import {
    isAdmin,
    getDailyUsageStats,
    getTotalUserCount,
    DailyUsageStat,
} from '../../services/adminService';
import {
    getSystemStats,
    getGrowthStats,
    getTableSizes,
    getUserDistribution,
    SystemStats,
    GrowthMetric,
    TableInfo,
    UserDistribution,
} from '../../services/systemHealthService';
import {
    getPendingProposals,
    approveProposal,
    rejectProposal,
    addShipTemplate,
    TemplateProposalRecord,
    NewShipTemplateData,
} from '../../services/shipTemplateProposalService';
import { Loader } from '../../components/ui/Loader';
import { useNotification } from '../../hooks/useNotification';

export const AdminPanel: React.FC = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { addNotification } = useNotification();
    const [loading, setLoading] = useState(true);
    const [isUserAdmin, setIsUserAdmin] = useState(false);
    const [dailyStats, setDailyStats] = useState<DailyUsageStat[]>([]);
    const [totalUsers, setTotalUsers] = useState(0);
    const [daysBack, setDaysBack] = useState(7);
    const [activeTab, setActiveTab] = useState('analytics');

    // System health states
    const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
    const [growthMetrics, setGrowthMetrics] = useState<GrowthMetric[]>([]);
    const [tableSizes, setTableSizes] = useState<TableInfo[]>([]);
    const [userDistribution, setUserDistribution] = useState<UserDistribution[]>([]);

    // Template proposals state
    const [templateProposals, setTemplateProposals] = useState<TemplateProposalRecord[]>([]);
    const [addingTemplate, setAddingTemplate] = useState(false);
    const [showAddTemplateForm, setShowAddTemplateForm] = useState(false);

    const loadData = React.useCallback(async () => {
        const [statsData, userCount, sysStats, growth, tables, distribution, proposals] =
            await Promise.all([
                getDailyUsageStats(daysBack),
                getTotalUserCount(),
                getSystemStats(),
                getGrowthStats(daysBack),
                getTableSizes(),
                getUserDistribution(),
                getPendingProposals(),
            ]);

        if (statsData) setDailyStats(statsData);
        setTotalUsers(userCount);
        if (sysStats) setSystemStats(sysStats);
        if (growth) setGrowthMetrics(growth);
        if (tables) setTableSizes(tables);
        if (distribution) setUserDistribution(distribution);
        if (proposals) setTemplateProposals(proposals);
    }, [daysBack]);

    const handleApproveProposal = async (proposalId: string) => {
        if (!user) return;

        const result = await approveProposal(proposalId, user.id);
        if (result.success) {
            addNotification('success', 'Proposal approved successfully');
            // Reload proposals
            const proposals = await getPendingProposals();
            setTemplateProposals(proposals);
        } else {
            addNotification('error', `Failed to approve proposal: ${result.error}`);
        }
    };

    const handleRejectProposal = async (proposalId: string) => {
        if (!user) return;

        const result = await rejectProposal(proposalId, user.id);
        if (result.success) {
            addNotification('success', 'Proposal rejected');
            // Reload proposals
            const proposals = await getPendingProposals();
            setTemplateProposals(proposals);
        } else {
            addNotification('error', `Failed to reject proposal: ${result.error}`);
        }
    };

    const handleAddTemplate = async (data: NewShipTemplateData) => {
        setAddingTemplate(true);
        try {
            const result = await addShipTemplate(data);
            if (result.success) {
                addNotification('success', `Ship template "${data.name}" added successfully!`);
                setShowAddTemplateForm(false); // Close the form on success
            } else {
                addNotification('error', `Failed to add ship template: ${result.error}`);
            }
        } catch (error) {
            addNotification(
                'error',
                `Error adding ship template: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        } finally {
            setAddingTemplate(false);
        }
    };

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
    }, [user, navigate, loadData]);

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
                    <div className="ms-auto">
                        <Select
                            value={daysBack.toString()}
                            onChange={(value) => setDaysBack(Number(value))}
                            className=""
                            options={[
                                { value: '7', label: 'Last 7 days' },
                                { value: '14', label: 'Last 14 days' },
                                { value: '30', label: 'Last 30 days' },
                                { value: '60', label: 'Last 60 days' },
                                { value: '90', label: 'Last 90 days' },
                            ]}
                        />
                    </div>
                </div>

                {/* Tabs */}
                <Tabs
                    tabs={[
                        { id: 'analytics', label: 'Analytics' },
                        { id: 'system-health', label: 'System Health' },
                        {
                            id: 'template-proposals',
                            label: `Templates ${templateProposals.length > 0 ? `(${templateProposals.length})` : ''}`,
                        },
                    ]}
                    activeTab={activeTab}
                    onChange={setActiveTab}
                />

                {/* Analytics Tab */}
                {activeTab === 'analytics' && (
                    <div className="space-y-6">
                        {/* Live Traffic */}
                        <LiveTrafficCard />

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
                        <UsageChart
                            data={dailyStats}
                            title={`Daily Usage (Last ${daysBack} Days)`}
                        />

                        {/* All Users Table */}
                        <AllUsersTable />
                    </div>
                )}

                {/* System Health Tab */}
                {activeTab === 'system-health' && (
                    <div className="space-y-6">
                        {/* System Stats */}
                        {systemStats && (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                <StatCard
                                    title="Total Ships"
                                    value={systemStats.total_ships.toLocaleString()}
                                    color="blue"
                                />
                                <StatCard
                                    title="Total Gear"
                                    value={systemStats.total_inventory.toLocaleString()}
                                    color="green"
                                />
                                <StatCard
                                    title="Total Loadouts"
                                    value={systemStats.total_loadouts.toLocaleString()}
                                    color="yellow"
                                />
                                <StatCard
                                    title="Active Users"
                                    value={systemStats.total_active_users.toLocaleString()}
                                    color="purple"
                                />
                            </div>
                        )}

                        {/* Average Stats */}
                        {systemStats && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <StatCard
                                    title="Avg Ships per User"
                                    value={systemStats.avg_ships_per_user.toFixed(1)}
                                    color="blue"
                                />
                                <StatCard
                                    title="Avg Gear per User"
                                    value={systemStats.avg_gear_per_user.toFixed(1)}
                                    color="green"
                                />
                            </div>
                        )}

                        {/* Growth Chart */}
                        {growthMetrics.length > 0 && (
                            <GrowthChart
                                data={growthMetrics}
                                title={`Content Growth (Last ${daysBack} Days)`}
                            />
                        )}

                        {/* Table Sizes */}
                        {tableSizes.length > 0 && <TableSizesTable tables={tableSizes} />}
                    </div>
                )}

                {/* Template Proposals Tab */}
                {activeTab === 'template-proposals' && (
                    <div className="space-y-6">
                        {/* Toggle Button */}
                        <div className="flex justify-end">
                            <Button
                                onClick={() => setShowAddTemplateForm(!showAddTemplateForm)}
                                variant={showAddTemplateForm ? 'secondary' : 'primary'}
                            >
                                {showAddTemplateForm ? 'Hide Form' : 'Add New Ship Template'}
                            </Button>
                        </div>

                        {/* Collapsible Form */}
                        <CollapsibleForm isVisible={showAddTemplateForm}>
                            <AddShipTemplateForm
                                onSubmit={handleAddTemplate}
                                loading={addingTemplate}
                            />
                        </CollapsibleForm>

                        <TemplateProposalsTable
                            proposals={templateProposals}
                            onApprove={handleApproveProposal}
                            onReject={handleRejectProposal}
                        />
                    </div>
                )}
            </div>
        </PageLayout>
    );
};

export default AdminPanel;
