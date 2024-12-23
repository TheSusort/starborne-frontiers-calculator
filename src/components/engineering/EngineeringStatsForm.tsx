import React, { useState, useEffect } from 'react';
import { EngineeringStat, Stat } from '../../types/stats';
import { ShipTypeName, SHIP_TYPES } from '../../constants';
import { StatModifierInput } from '../stats/StatModifierInput';
import { Button, Select } from '../ui';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';

interface EngineeringStatsFormProps {
    initialStats?: EngineeringStat;
    onSubmit: (stats: EngineeringStat) => void;
}

export const EngineeringStatsForm: React.FC<EngineeringStatsFormProps> = ({
    initialStats,
    onSubmit
}) => {
    const [shipType, setShipType] = useState<ShipTypeName>(
        initialStats?.shipType || Object.keys(SHIP_TYPES)[0]
    );
    const [stats, setStats] = useState<Stat[]>(initialStats?.stats || []);

    const { getAllAllowedStats } = useEngineeringStats();

    // Reset form to initial state
    const resetForm = () => {
        setShipType(Object.keys(SHIP_TYPES)[0]);
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

    const shipTypeOptions = Object.entries(SHIP_TYPES).map(([key, type]) => ({
        value: key,
        label: type.name
    }));

    const handleStatChange = (newStats: Stat[]) => {
        setStats(newStats);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit({ shipType, stats });
        resetForm(); // Reset form after successful submission
    };

    return (
        <form onSubmit={handleSubmit} className="bg-dark  p-6">
            <div className="mb-4">
                <Select
                    label="Ship Type"
                    value={shipType}
                    onChange={(e) => setShipType(e.target.value)}
                    required
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
                type="submit"
                className="mt-6"
                variant="primary"
            >
                Save Engineering Stats
            </Button>
        </form>
    );
};