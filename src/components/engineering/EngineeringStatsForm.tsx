import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { EngineeringStat, Stat, StatName } from '../../types/stats';
import { ShipTypeName, SHIP_TYPES, STATS } from '../../constants';
import {
    BaseRoleName,
    ENGINEERING_STATS_BY_ROLE,
    isEngineeringFlatStat,
} from '../../constants/engineeringStats';
import { Button, Select, Input } from '../ui';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';

const BASE_ROLES: BaseRoleName[] = ['ATTACKER', 'DEFENDER', 'SUPPORTER', 'DEBUFFER'];

interface EngineeringStatsFormProps {
    initialStats?: EngineeringStat | null;
    onSubmit: (stats: EngineeringStat) => void;
}

export const EngineeringStatsForm: React.FC<EngineeringStatsFormProps> = ({
    initialStats,
    onSubmit,
}) => {
    const [shipType, setShipType] = useState<ShipTypeName>(
        (initialStats?.shipType as ShipTypeName) || 'ATTACKER'
    );
    const [stats, setStats] = useState<Stat[]>(initialStats?.stats || []);

    const { engineeringStats } = useEngineeringStats();

    // Get the fixed stats for the selected role
    const roleStats = useMemo(
        () => ENGINEERING_STATS_BY_ROLE[shipType as BaseRoleName],
        [shipType]
    );

    // Only show the 4 base roles, filtering out ones that already have stats
    const shipTypeOptions = BASE_ROLES.filter(
        (role) =>
            initialStats?.shipType === role ||
            !engineeringStats.stats?.some((stat) => stat.shipType === role)
    ).map((role) => ({
        value: role,
        label: SHIP_TYPES[role].name,
    }));

    // Build stats array from role's fixed stats, preserving existing values
    const buildStatsForRole = useCallback((role: StatName[], existingStats: Stat[]): Stat[] => {
        return role.map((statName) => {
            const existing = existingStats.find((s) => s.name === statName);
            return {
                name: statName,
                value: existing?.value ?? 0,
                type: isEngineeringFlatStat(statName) ? 'flat' : 'percentage',
            } as Stat;
        });
    }, []);

    // When ship type changes, rebuild stats for the new role
    useEffect(() => {
        setStats((prev) => buildStatsForRole(roleStats, prev));
    }, [roleStats, buildStatsForRole]);

    // Reset form to initial state
    const resetForm = useCallback(() => {
        setShipType('ATTACKER');
        setStats(buildStatsForRole(ENGINEERING_STATS_BY_ROLE['ATTACKER'], []));
    }, [buildStatsForRole]);

    useEffect(() => {
        if (initialStats) {
            setShipType(initialStats.shipType);
            setStats(buildStatsForRole(roleStats, initialStats.stats));
        } else {
            resetForm();
        }
    }, [initialStats, roleStats, buildStatsForRole, resetForm]);

    const handleValueChange = (statName: StatName, value: number) => {
        setStats((prev) => prev.map((s) => (s.name === statName ? { ...s, value } : s)));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // Only include stats with non-zero values
        const nonZeroStats = stats.filter((s) => s.value !== 0);
        onSubmit({ shipType, stats: nonZeroStats });
        if (!initialStats) {
            resetForm();
        }
    };

    return (
        <form onSubmit={handleSubmit} className="card max-w-md">
            <div className="mb-4">
                <Select
                    label="Ship Type"
                    value={shipType}
                    onChange={(value) => setShipType(value as ShipTypeName)}
                    options={shipTypeOptions}
                />
            </div>

            <div className="space-y-3">
                {stats.map((stat) => (
                    <div key={stat.name} className="flex items-end gap-4">
                        <div className="flex-1">
                            <Input
                                type="number"
                                label={`${STATS[stat.name].label} (${stat.type === 'flat' ? 'Flat' : '%'})`}
                                value={stat.value}
                                onChange={(e) =>
                                    handleValueChange(stat.name, Number(e.target.value))
                                }
                                min={0}
                            />
                        </div>
                    </div>
                ))}
            </div>

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
