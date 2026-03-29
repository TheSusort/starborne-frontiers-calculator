import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PageLayout, Tabs } from '../../components/ui';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../contexts/EngineeringStatsProvider';
import { ShipsStatsTab } from '../../components/statistics/ShipsStatsTab';
import { GearStatsTab } from '../../components/statistics/GearStatsTab';
import { ImplantsStatsTab } from '../../components/statistics/ImplantsStatsTab';
import { EngineeringStatsTab } from '../../components/statistics/EngineeringStatsTab';
import { SnapshotSelector } from '../../components/statistics/SnapshotSelector';
import { useStatisticsSnapshot } from '../../hooks/useStatisticsSnapshot';

export const StatisticsPage: React.FC = () => {
    const { ships, loading: shipsLoading } = useShips();
    const { inventory: gear, loading: gearLoading } = useInventory();
    const { engineeringStats, loading: engineeringLoading } = useEngineeringStats();
    const [activeTab, setActiveTab] = useState('ships');

    const gearOnly = useMemo(() => {
        return gear.filter((piece) => !piece.slot.startsWith('implant_'));
    }, [gear]);

    const implantsOnly = useMemo(() => {
        return gear.filter((piece) => piece.slot.startsWith('implant_'));
    }, [gear]);

    const hasData = ships.length > 0 || gear.length > 0;
    const allContextsLoaded = !shipsLoading && !gearLoading && !engineeringLoading;

    const {
        snapshots,
        selectedSnapshot,
        selectedMonth,
        setSelectedMonth,
        loading: snapshotLoading,
    } = useStatisticsSnapshot({
        ships,
        gear: gearOnly,
        implants: implantsOnly,
        engineeringStats: engineeringStats.stats,
        allContextsLoaded,
    });

    if (!hasData) {
        return (
            <PageLayout title="Statistics" description="View statistics about your fleet and gear">
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="text-theme-text-secondary text-lg mb-4">
                        No data available. Import your game data to see statistics.
                    </div>
                    <Link
                        to="/"
                        className="px-6 py-3 bg-primary text-white hover:bg-primary-dark transition-colors"
                    >
                        Upload Game File
                    </Link>
                </div>
            </PageLayout>
        );
    }

    return (
        <PageLayout
            title="Statistics"
            description="Detailed statistics about your ships, gear, and engineering"
        >
            <div className="space-y-6">
                <SnapshotSelector
                    snapshots={snapshots}
                    selectedMonth={selectedMonth}
                    onChange={setSelectedMonth}
                    loading={snapshotLoading}
                />

                <Tabs
                    tabs={[
                        { id: 'ships', label: `Ships (${ships.length})` },
                        { id: 'gear', label: `Gear (${gearOnly.length})` },
                        { id: 'implants', label: `Implants (${implantsOnly.length})` },
                        { id: 'engineering', label: 'Engineering' },
                    ]}
                    activeTab={activeTab}
                    onChange={setActiveTab}
                />

                {activeTab === 'ships' && (
                    <ShipsStatsTab
                        ships={ships}
                        previousStats={selectedSnapshot?.shipsStats ?? undefined}
                    />
                )}
                {activeTab === 'gear' && (
                    <GearStatsTab
                        gear={gear}
                        ships={ships}
                        previousStats={selectedSnapshot?.gearStats ?? undefined}
                    />
                )}
                {activeTab === 'implants' && (
                    <ImplantsStatsTab
                        gear={gear}
                        ships={ships}
                        previousStats={selectedSnapshot?.implantsStats ?? undefined}
                    />
                )}
                {activeTab === 'engineering' && (
                    <EngineeringStatsTab
                        engineeringStats={engineeringStats.stats}
                        previousStats={selectedSnapshot?.engineeringStats ?? undefined}
                    />
                )}
            </div>
        </PageLayout>
    );
};

export default StatisticsPage;
