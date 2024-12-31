import React, { useState } from 'react';
import { EngineeringStats, EngineeringStat } from '../types/stats';
import { EngineeringStatsForm } from '../components/engineering/EngineeringStatsForm';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { PageLayout, CollapsibleForm } from '../components/ui';
import { useNotification } from '../hooks/useNotification';
import { EngineeringStatsList } from '../components/engineering/EngineeringStatsList';

export const EngineeringStatsPage: React.FC = () => {
    const { engineeringStats, saveEngineeringStats } = useEngineeringStats();
    const [editingStats, setEditingStats] = useState<EngineeringStat | undefined>();
    const [isFormVisible, setIsFormVisible] = useState(false);
    const { addNotification } = useNotification();

    const handleSubmit = (stats: EngineeringStat) => {
        const newEngStats: EngineeringStats = {
            stats: engineeringStats.stats
                .filter((s) => s.shipType !== stats.shipType)
                .concat(stats),
        };
        saveEngineeringStats(newEngStats);
        if (editingStats) {
            addNotification('success', 'Engineering stats updated successfully');
        } else {
            addNotification('success', 'Engineering stats added successfully');
        }
        setEditingStats(undefined);
    };

    const handleDelete = (shipType: string) => {
        const newEngStats: EngineeringStats = {
            stats: engineeringStats.stats.filter((s) => s.shipType !== shipType),
        };
        saveEngineeringStats(newEngStats);
        if (editingStats?.shipType === shipType) {
            setEditingStats(undefined);
        }
        addNotification('success', 'Engineering stats deleted successfully');
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
                },
                variant: isFormVisible ? 'secondary' : 'primary',
            }}
        >
            <CollapsibleForm isVisible={isFormVisible || !!editingStats}>
                <EngineeringStatsForm
                    initialStats={editingStats}
                    onSubmit={(stats) => {
                        handleSubmit(stats);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                />
            </CollapsibleForm>

            <div className="space-y-4 text-gray-200">
                <EngineeringStatsList
                    stats={engineeringStats.stats}
                    onEdit={(stat: EngineeringStat) => {
                        setEditingStats(stat);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    onDelete={handleDelete}
                />
            </div>
        </PageLayout>
    );
};
