import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthProvider';
import {
    PageLayout,
    Select,
    Tabs,
    CollapsibleForm,
    Button,
    Input,
    StatCard,
} from '../../components/ui';
import { UsageChart } from '../../components/admin/UsageChart';
import { AllUsersTable } from '../../components/admin/AllUsersTable';
import { GrowthChart } from '../../components/admin/GrowthChart';
import { TableSizesTable } from '../../components/admin/TableSizesTable';
import { TemplateProposalsTable } from '../../components/admin/TemplateProposalsTable';
import {
    AddShipTemplateForm,
    ShipTemplateFormData,
} from '../../components/admin/AddShipTemplateForm';
import { LiveTrafficCard } from '../../components/admin/LiveTrafficCard';
import { ArenaModifiersTab } from '../../components/admin/ArenaModifiersTab';
import { getAllSeasons } from '../../services/arenaModifierService';
import { ArenaSeason } from '../../types/arena';
import {
    isAdmin,
    getDailyUsageStats,
    getTotalUserCount,
    getLifetimeStats,
    DailyUsageStat,
    LifetimeStats,
} from '../../services/adminService';
import {
    getSystemStats,
    getGrowthStats,
    getTableSizes,
    refreshSystemSnapshot,
    SystemStats,
    GrowthMetric,
    TableInfo,
} from '../../services/systemHealthService';
import {
    getPendingProposals,
    approveProposal,
    rejectProposal,
    addShipTemplate,
    getAllShipTemplates,
    updateShipTemplate,
    TemplateProposalRecord,
    NewShipTemplateData,
    ShipTemplate,
} from '../../services/shipTemplateProposalService';
import { Loader } from '../../components/ui/Loader';
import { useNotification } from '../../hooks/useNotification';
import { FACTIONS } from '../../constants/factions';
import { SHIP_TYPES } from '../../constants/shipTypes';

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
    const [refreshingSystemStats, setRefreshingSystemStats] = useState(false);
    const [growthMetrics, setGrowthMetrics] = useState<GrowthMetric[]>([]);
    const [tableSizes, setTableSizes] = useState<TableInfo[]>([]);

    // Template proposals state
    const [templateProposals, setTemplateProposals] = useState<TemplateProposalRecord[]>([]);
    const [addingTemplate, setAddingTemplate] = useState(false);
    const [showAddTemplateForm, setShowAddTemplateForm] = useState(false);

    // Edit template states
    const [allTemplates, setAllTemplates] = useState<ShipTemplate[]>([]);
    const [templateSearchQuery, setTemplateSearchQuery] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState<ShipTemplate | null>(null);
    const [showEditTemplateForm, setShowEditTemplateForm] = useState(false);
    const [updatingTemplate, setUpdatingTemplate] = useState(false);

    // Lifetime stats
    const [lifetimeStats, setLifetimeStats] = useState<LifetimeStats | null>(null);

    // Arena seasons state
    const [arenaSeasons, setArenaSeasons] = useState<ArenaSeason[]>([]);

    const loadData = React.useCallback(async () => {
        const [
            statsData,
            userCount,
            sysStats,
            growth,
            tables,
            proposals,
            lifetime,
            templates,
            seasons,
        ] = await Promise.all([
            getDailyUsageStats(daysBack),
            getTotalUserCount(),
            getSystemStats(),
            getGrowthStats(daysBack),
            getTableSizes(),
            getPendingProposals(),
            getLifetimeStats(),
            getAllShipTemplates(),
            getAllSeasons(),
        ]);

        if (statsData) setDailyStats(statsData);
        setTotalUsers(userCount);
        if (sysStats) setSystemStats(sysStats);
        if (growth) setGrowthMetrics(growth);
        if (tables) setTableSizes(tables);
        if (proposals) setTemplateProposals(proposals);
        if (lifetime) setLifetimeStats(lifetime);
        if (templates) setAllTemplates(templates);
        if (seasons) setArenaSeasons(seasons);
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

    const handleUpdateTemplate = async (data: NewShipTemplateData) => {
        if (!selectedTemplate) return;
        setUpdatingTemplate(true);
        try {
            const result = await updateShipTemplate(selectedTemplate.id, data);
            if (result.success) {
                addNotification('success', `Ship template "${data.name}" updated successfully!`);
                const templates = await getAllShipTemplates();
                if (templates) setAllTemplates(templates);
                const updated = templates.find((t) => t.id === selectedTemplate.id);
                if (updated) setSelectedTemplate(updated);
            } else {
                addNotification('error', `Failed to update ship template: ${result.error}`);
            }
        } catch (error) {
            addNotification(
                'error',
                `Error updating ship template: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        } finally {
            setUpdatingTemplate(false);
        }
    };

    const handleRefreshSystemStats = async () => {
        setRefreshingSystemStats(true);
        try {
            const fresh = await refreshSystemSnapshot();
            if (fresh) {
                setSystemStats(fresh);
                addNotification('success', 'System stats refreshed');
            } else {
                addNotification('error', 'Failed to refresh system stats');
            }
        } finally {
            setRefreshingSystemStats(false);
        }
    };

    const formatRelativeTime = (iso: string): string => {
        const diffMs = Date.now() - new Date(iso).getTime();
        const minutes = Math.floor(diffMs / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes} min ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

    useEffect(() => {
        const checkAdminAndLoadData = async () => {
            if (!user) {
                void navigate('/');
                return;
            }

            // Check if user is admin
            const adminStatus = await isAdmin(user.id);
            setIsUserAdmin(adminStatus);

            if (!adminStatus) {
                void navigate('/');
                return;
            }

            // Load analytics data
            await loadData();
            setLoading(false);
        };

        void checkAdminAndLoadData();
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

    const convertTemplateToFormData = (template: ShipTemplate): ShipTemplateFormData => {
        const factionEntry = Object.values(FACTIONS).find(
            (f) => f.name.toUpperCase().replace(/\s+/g, '_') === template.faction
        );
        const typeEntry = Object.values(SHIP_TYPES).find(
            (t) =>
                t.name.toUpperCase().replace(/\s+/g, '_').replace(/\(/g, '_').replace(/\)/g, '') ===
                template.type
        );

        return {
            name: template.name,
            affinity: (template.affinity || 'chemical') as ShipTemplateFormData['affinity'],
            rarity: template.rarity,
            faction: factionEntry?.name || template.faction,
            type: typeEntry?.name || template.type,
            hp: template.base_stats.hp,
            attack: template.base_stats.attack,
            defence: template.base_stats.defence,
            hacking: template.base_stats.hacking,
            security: template.base_stats.security,
            critRate: template.base_stats.crit_rate,
            critDamage: template.base_stats.crit_damage,
            speed: template.base_stats.speed,
            hpRegen: template.base_stats.hp_regen || 0,
            shield: template.base_stats.shield || 0,
            shieldPenetration: template.base_stats.shield_penetration || 0,
            defensePenetration: template.base_stats.defense_penetration || 0,
            imageKey: template.image_key || '',
            activeSkillText: template.active_skill_text || '',
            chargeSkillText: template.charge_skill_text || '',
            chargeSkillCharge: template.charge_skill_charge || 0,
            firstPassiveSkillText: template.first_passive_skill_text || '',
            secondPassiveSkillText: template.second_passive_skill_text || '',
            thirdPassiveSkillText: template.third_passive_skill_text || '',
            definitionId: template.definition_id || '',
        };
    };

    const filteredTemplates =
        templateSearchQuery.length >= 2
            ? allTemplates.filter((t) =>
                  t.name.toLowerCase().includes(templateSearchQuery.toLowerCase())
              )
            : [];

    const handleSelectTemplate = (template: ShipTemplate) => {
        setSelectedTemplate(template);
        setTemplateSearchQuery(template.name);
        setShowEditTemplateForm(true);
    };

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
                        { id: 'arena', label: 'Arena' },
                    ]}
                    activeTab={activeTab}
                    onChange={setActiveTab}
                />

                {/* Analytics Tab */}
                {activeTab === 'analytics' && (
                    <div className="space-y-6">
                        {/* Live Traffic */}
                        <LiveTrafficCard />

                        {/* Period Stats */}
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

                        {/* Lifetime Stats */}
                        {lifetimeStats && (
                            <div>
                                <h3 className="text-lg font-semibold mb-3 text-theme-text">
                                    Lifetime Statistics
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    <StatCard
                                        title="Lifetime Autogear Runs"
                                        value={lifetimeStats.totalAutogearRuns.toLocaleString()}
                                        color="blue"
                                    />
                                    <StatCard
                                        title="Lifetime Data Imports"
                                        value={lifetimeStats.totalDataImports.toLocaleString()}
                                        color="green"
                                    />
                                    <StatCard
                                        title="Lifetime Total Activity"
                                        value={lifetimeStats.totalActivity.toLocaleString()}
                                        color="yellow"
                                    />
                                    <StatCard
                                        title="Active Users"
                                        value={lifetimeStats.activeUsers.toLocaleString()}
                                        color="purple"
                                        subtitle={`${totalUsers > 0 ? Math.round((lifetimeStats.activeUsers / totalUsers) * 100) : 0}% of all users`}
                                    />
                                    <StatCard
                                        title="Avg Autogear / User"
                                        value={lifetimeStats.avgAutogearPerUser.toFixed(1)}
                                        color="blue"
                                    />
                                    <StatCard
                                        title="Avg Imports / User"
                                        value={lifetimeStats.avgImportsPerUser.toFixed(1)}
                                        color="green"
                                    />
                                </div>
                            </div>
                        )}

                        {/* All Users Table */}
                        <AllUsersTable />
                    </div>
                )}

                {/* System Health Tab */}
                {activeTab === 'system-health' && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-semibold text-theme-text">
                                    System Stats
                                </h3>
                                {systemStats?.updated_at && (
                                    <p className="text-sm text-gray-400">
                                        Last updated {formatRelativeTime(systemStats.updated_at)}
                                    </p>
                                )}
                            </div>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => void handleRefreshSystemStats()}
                                disabled={refreshingSystemStats}
                            >
                                {refreshingSystemStats ? 'Refreshing…' : 'Refresh now'}
                            </Button>
                        </div>

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
                        {/* Toggle Buttons */}
                        <div className="flex justify-end gap-2">
                            <Button
                                onClick={() => {
                                    setShowEditTemplateForm(!showEditTemplateForm);
                                    if (showAddTemplateForm) setShowAddTemplateForm(false);
                                }}
                                variant={showEditTemplateForm ? 'secondary' : 'primary'}
                            >
                                {showEditTemplateForm ? 'Hide Edit Form' : 'Edit Existing Template'}
                            </Button>
                            <Button
                                onClick={() => {
                                    setShowAddTemplateForm(!showAddTemplateForm);
                                    if (showEditTemplateForm) setShowEditTemplateForm(false);
                                }}
                                variant={showAddTemplateForm ? 'secondary' : 'primary'}
                            >
                                {showAddTemplateForm ? 'Hide Add Form' : 'Add New Ship Template'}
                            </Button>
                        </div>

                        {/* Edit Template Section */}
                        <CollapsibleForm isVisible={showEditTemplateForm}>
                            <div className="card space-y-4">
                                <h3 className="text-xl font-semibold">Edit Existing Template</h3>
                                <div className="relative">
                                    <Input
                                        type="text"
                                        value={templateSearchQuery}
                                        onChange={(e) => {
                                            setTemplateSearchQuery(e.target.value);
                                            if (
                                                selectedTemplate &&
                                                e.target.value !== selectedTemplate.name
                                            ) {
                                                setSelectedTemplate(null);
                                            }
                                        }}
                                        placeholder="Search templates by name (min 2 characters)..."
                                    />
                                    {filteredTemplates.length > 0 && !selectedTemplate && (
                                        <div className="absolute z-10 w-full mt-1 card shadow-lg max-h-60 overflow-y-auto">
                                            {filteredTemplates.map((template) => (
                                                <button
                                                    key={template.id}
                                                    type="button"
                                                    className="w-full text-left px-4 py-2 hover:bg-dark-700 text-sm transition-colors"
                                                    onClick={() => handleSelectTemplate(template)}
                                                >
                                                    <span className="font-medium">
                                                        {template.name}
                                                    </span>
                                                    <span className="text-theme-text-secondary ml-2">
                                                        {template.faction} · {template.type} ·{' '}
                                                        {template.rarity}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {templateSearchQuery.length >= 2 &&
                                        filteredTemplates.length === 0 &&
                                        !selectedTemplate && (
                                            <div className="absolute z-10 w-full mt-1 bg-dark-800 border border-dark-600 rounded-lg shadow-lg px-4 py-2 text-theme-text-secondary text-sm">
                                                No templates found
                                            </div>
                                        )}
                                </div>
                            </div>
                            {selectedTemplate && (
                                <div className="mt-4">
                                    <AddShipTemplateForm
                                        onSubmit={handleUpdateTemplate}
                                        loading={updatingTemplate}
                                        mode="edit"
                                        initialData={convertTemplateToFormData(selectedTemplate)}
                                    />
                                </div>
                            )}
                        </CollapsibleForm>

                        {/* Add Template Form */}
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

                {/* Arena Tab */}
                {activeTab === 'arena' && (
                    <ArenaModifiersTab
                        seasons={arenaSeasons}
                        onSeasonsChange={() => void getAllSeasons().then(setArenaSeasons)}
                    />
                )}
            </div>
        </PageLayout>
    );
};

export default AdminPanel;
