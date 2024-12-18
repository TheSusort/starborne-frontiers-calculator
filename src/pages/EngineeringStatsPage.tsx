import React, { useState } from 'react';
import { EngineeringStats, EngineeringStat } from '../types/stats';
import { EngineeringStatsForm } from '../components/stats/EngineeringStatsForm';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { Button, CloseIcon } from '../components/ui';
import { SHIP_TYPES } from '../constants/shipTypes';
import { PageLayout } from '../components/layout/PageLayout';
import { CollapsibleForm } from '../components/layout/CollapsibleForm';
import { useNotification } from '../contexts/NotificationContext';
export const EngineeringStatsPage: React.FC = () => {
    const { engineeringStats, saveEngineeringStats } = useEngineeringStats();
    const [editingStats, setEditingStats] = useState<EngineeringStat | undefined>();
    const [isFormVisible, setIsFormVisible] = useState(false);
    const { addNotification } = useNotification();

    const handleSubmit = (stats: EngineeringStat) => {
        const newEngStats: EngineeringStats = {
            stats: engineeringStats.stats.filter(s => s.shipType !== stats.shipType).concat(stats)
        };
        saveEngineeringStats(newEngStats);
        setEditingStats(undefined);

    };

    const handleDelete = (shipType: string) => {
        const newEngStats: EngineeringStats = {
            stats: engineeringStats.stats.filter(s => s.shipType !== shipType)
        };
        saveEngineeringStats(newEngStats);
        if (editingStats?.shipType === shipType) {
            setEditingStats(undefined);
        }
    };

    return (
        <PageLayout
            title="Engineering Stats Management"
            description="Manage your engineering stats."
            action={{
                label: isFormVisible ? 'Hide Form' : 'Create',
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
                    onSubmit={(stats) => {
                        handleSubmit(stats);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        addNotification('success', 'Engineering stats saved successfully');
                    }}
                />
            </CollapsibleForm>

            <div className="space-y-6 text-gray-200">
                {engineeringStats.stats.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 bg-dark-lighter  border-2 border-dashed">
                        No engineering stats found.
                    </div>
                ) : (
                <>
                    <h3 className="text-xl font-semibold mb-4">Existing Engineering Stats</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {engineeringStats.stats.map((stat) => (
                            <div key={stat.shipType} className="bg-dark mb-4 border border-gray-600">
                                <div className="flex justify-between items-center px-4 py-2 border-b border-gray-600">
                                    <h3 className="text-lg font-medium">{SHIP_TYPES[stat.shipType].name}</h3>
                                    <Button
                                        variant="danger"
                                        onClick={() => {
                                            handleDelete(stat.shipType);
                                            addNotification('success', 'Engineering stats deleted successfully');
                                        }}
                                    >
                                        <CloseIcon />
                                    </Button>
                                </div>
                                <div className="grid grid-cols-1 px-4 py-2">
                                    {stat.stats.map((s) => (
                                        <div key={`${s.name}-${s.type}`} className="text-sm flex justify-between">
                                            <span>{s.name}:</span>
                                            <span>
                                                +{s.value}{s.type === 'percentage' ? '%' : ''}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex gap-2 p-4">
                                    <Button
                                        variant="secondary"
                                        onClick={() => {
                                            setEditingStats(stat);
                                            window.scrollTo({ top: 0, behavior: 'smooth' });
                                        }}
                                    >
                                        Edit
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
                )}
            </div>
        </PageLayout>
    );
};