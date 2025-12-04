import React, { useState, useMemo } from 'react';
import { PageLayout, Tabs } from '../components/ui';
import { useShips } from '../contexts/ShipsContext';
import { useInventory } from '../contexts/InventoryProvider';
import { useEngineeringStats } from '../contexts/EngineeringStatsProvider';
import { ShipsStatsTab } from '../components/statistics/ShipsStatsTab';
import { GearStatsTab } from '../components/statistics/GearStatsTab';
import { ImplantsStatsTab } from '../components/statistics/ImplantsStatsTab';
import { EngineeringStatsTab } from '../components/statistics/EngineeringStatsTab';
import { Link } from 'react-router-dom';

export const StatisticsPage: React.FC = () => {
    const { ships } = useShips();
    const { inventory: gear } = useInventory();
    const { engineeringStats } = useEngineeringStats();
    const [activeTab, setActiveTab] = useState('ships');

    // Separate gear and implants
    const gearOnly = useMemo(() => {
        return gear.filter((piece) => !piece.slot.startsWith('implant_'));
    }, [gear]);

    const implantsOnly = useMemo(() => {
        return gear.filter((piece) => piece.slot.startsWith('implant_'));
    }, [gear]);

    const hasData = ships.length > 0 || gear.length > 0;

    // Empty state
    if (!hasData) {
        return (
            <PageLayout title="Statistics" description="View statistics about your fleet and gear">
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="text-gray-400 text-lg mb-4">
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
                {/* Tabs */}
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

                {/* Tab Content */}
                {activeTab === 'ships' && <ShipsStatsTab ships={ships} />}
                {activeTab === 'gear' && <GearStatsTab gear={gear} ships={ships} />}
                {activeTab === 'implants' && <ImplantsStatsTab gear={gear} ships={ships} />}
                {activeTab === 'engineering' && (
                    <EngineeringStatsTab engineeringStats={engineeringStats.stats} />
                )}
            </div>
        </PageLayout>
    );
};

export default StatisticsPage;
