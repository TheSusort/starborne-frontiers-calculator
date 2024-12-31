import React, { useState, useEffect } from 'react';
import { EngineeringStat, Stat } from '../../types/stats';
import { ShipTypeName, SHIP_TYPES } from '../../constants';
import { StatModifierInput } from '../stats/StatModifierInput';
import { Button, Select } from '../ui';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';

interface EngineeringStatsFormProps {
    initialStats?: EngineeringStat | null;
    onSubmit: (stats: EngineeringStat) => void;
}

export const EngineeringStatsForm: React.FC<EngineeringStatsFormProps> = ({
    initialStats,
    onSubmit,
}) => {
    const [shipType, setShipType] = useState<ShipTypeName>(
        initialStats?.shipType || (Object.keys(SHIP_TYPES)[0] as ShipTypeName)
    );
    const [stats, setStats] = useState<Stat[]>(initialStats?.stats || []);

    const { getAllAllowedStats, engineeringStats } = useEngineeringStats();

    // Filter out ship types that already have stats
    const availableShipTypes = Object.entries(SHIP_TYPES).filter(
        ([key]) =>
            initialStats?.shipType === key || // Include current ship type if editing
            !engineeringStats.stats.some((stat) => stat.shipType === key)
    );

    const shipTypeOptions = availableShipTypes.map(([key, type]) => ({
        value: key,
        label: type.name,
    }));

    // Reset form to initial state
    const resetForm = () => {
        setShipType(Object.keys(SHIP_TYPES)[0] as ShipTypeName);
        setStats([]);
    };

    useEffect(() => {
        if (initialStats) {
            setShipType(initialStats.shipType);
            setStats(initialStats.stats);
        } else {
            resetForm();
        }
    }, [initialStats]);

    const handleStatChange = (newStats: Stat[]) => {
        setStats(newStats);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit({ shipType, stats });
        // Only reset if we're not editing existing stats
        if (!initialStats) {
            resetForm();
        }
    };

    return (
        <form onSubmit={handleSubmit} className="bg-dark p-6">
            <div className="mb-4">
                <Select
                    label="Ship Type"
                    value={shipType}
                    onChange={(value) => setShipType(value as ShipTypeName)}
                    options={shipTypeOptions}
                />
            </div>

            <StatModifierInput
                stats={stats}
                onChange={handleStatChange}
                maxStats={5}
                allowedStats={getAllAllowedStats()}
            />

            <Button
                aria-label="Save engineering stats"
                type="submit"
                className="mt-6"
                variant="primary"
            >
                Save Engineering Stats
            </Button>
        </form>
    );
};
