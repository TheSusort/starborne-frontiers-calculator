import React, { useState } from 'react';
import { EngineeringStats, EngineeringStat } from '../types/stats';
import { EngineeringStatsForm } from '../components/EngineeringStatsForm';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { Button, CloseIcon } from '../components/ui';
import { SHIP_TYPES } from '../constants/shipTypes';
import { PageLayout } from '../components/layout/PageLayout';
import { CollapsibleForm } from '../components/layout/CollapsibleForm';

export const EngineeringStatsPage: React.FC = () => {
    const { engineeringStats, saveEngineeringStats } = useEngineeringStats();
    const [editingStats, setEditingStats] = useState<EngineeringStat | undefined>();
    const [isFormVisible, setIsFormVisible] = useState(false);
    const handleSubmit = (stats: EngineeringStat) => {
        const newEngStats: EngineeringStats = {
            stats: engineeringStats.stats.filter(s => s.shipType !== stats.shipType).concat(stats)
        };
        saveEngineeringStats(newEngStats);
        setEditingStats(undefined);

    };

    const handleDelete = (shipType: string) => {
        if (window.confirm('Are you sure you want to delete these engineering stats?')) {
            const newEngStats: EngineeringStats = {
                stats: engineeringStats.stats.filter(s => s.shipType !== shipType)
            };
            saveEngineeringStats(newEngStats);
            if (editingStats?.shipType === shipType) {
                setEditingStats(undefined);
            }
        }
    };

    return (
        <PageLayout
            title="Engineering Stats Management"
            action={{
                label: isFormVisible ? 'Hide Form' : 'Create New Engineering Stats',
                onClick: () => {
                    if (editingStats) {
                        setEditingStats(undefined);
                    }
                    setIsFormVisible(!isFormVisible);
                }
            }}
        >

            <CollapsibleForm isVisible={isFormVisible || !!editingStats}>
                <EngineeringStatsForm
                    initialStats={editingStats}
                    onSubmit={handleSubmit}
                />
            </CollapsibleForm>

            <div className="space-y-6 text-gray-200">
                <h3 className="text-xl font-semibold mb-4">Existing Engineering Stats</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {engineeringStats.stats.map((stat) => (
                        <div key={stat.shipType} className="bg-dark mb-4 p-4">
                            <h3 className="text-lg font-medium mb-3 ">{SHIP_TYPES[stat.shipType].name}</h3>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                {stat.stats.map((s) => (
                                    <div key={`${s.name}-${s.type}`} className="text-sm">
                                        {s.name}: +{s.value}
                                        {s.type === 'percentage' ? '%' : ''}
                                    </div>
                                ))}
                            </div>
                            <div className="flex gap-2 mt-4">
                                <Button
                                    variant="secondary"
                                    onClick={() => setEditingStats(stat)}
                                >
                                    Edit
                                </Button>
                                <Button
                                    variant="danger"
                                    onClick={() => handleDelete(stat.shipType)}
                                >
                                    <CloseIcon />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </PageLayout>
    );
};