import React, { useState } from 'react';
import { EngineeringStats, EngineeringStat } from '../types/stats';
import { EngineeringStatsForm } from '../components/EngineeringStatsForm';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { Button, CloseIcon } from '../components/ui';
import { SHIP_TYPES } from '../constants/shipTypes';

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
        <div className="max-w-4xl space-y-8 text-white">
            <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold mb-6">Engineering Stats Management</h1>
            <Button
                    onClick={() => {
                        if (editingStats) {
                            setEditingStats(undefined);
                        }
                        setIsFormVisible(!isFormVisible);
                    }}
                >
                    {isFormVisible ? 'Hide Form' : 'Create New Engineering Stats'}
                </Button>
            </div>

            <div className={`transition-all duration-300 ease-in-out ${isFormVisible || editingStats ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'}`}>
                <EngineeringStatsForm
                    initialStats={editingStats}
                    onSubmit={handleSubmit}
                />
            </div>

            <div className="mt-8">
                <h2 className="text-xl font-semibold mb-4">Existing Engineering Stats</h2>
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
        </div>
    );
};