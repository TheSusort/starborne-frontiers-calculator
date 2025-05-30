import React from 'react';
import { EngineeringStat } from '../../types/stats';
import { Button, CloseIcon, EditIcon } from '../ui';
import { SHIP_TYPES } from '../../constants';
import { StatDisplay } from '../stats/StatDisplay';

interface EngineeringStatsListProps {
    stats: EngineeringStat[];
    onEdit: (stat: EngineeringStat) => void;
    onDelete: (shipType: string) => void;
}

export const EngineeringStatsList: React.FC<EngineeringStatsListProps> = ({
    stats,
    onEdit,
    onDelete,
}) => {
    if (!stats || stats.length === 0) {
        return (
            <div className="text-center py-8 text-gray-400 bg-dark-lighter border-2 border-dashed">
                No engineering stats found.
            </div>
        );
    }

    return (
        <>
            <h3 className="text-xl font-semibold mb-4">Existing Engineering Stats</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {stats.map((stat) => (
                    <div key={stat.shipType} className="bg-dark mb-4 border border-gray-600">
                        <div className="flex justify-between items-center px-4 py-2 border-b border-gray-600">
                            <h3 className="text-lg font-medium">
                                {SHIP_TYPES[stat.shipType].name}
                            </h3>
                            <Button
                                aria-label="Edit engineering stats"
                                variant="secondary"
                                size="sm"
                                className="ms-auto me-2"
                                onClick={() => {
                                    onEdit(stat);
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                            >
                                <EditIcon />
                            </Button>
                            <Button
                                aria-label="Delete engineering stats"
                                variant="danger"
                                size="sm"
                                onClick={() => onDelete(stat.shipType)}
                            >
                                <CloseIcon />
                            </Button>
                        </div>
                        <div className="p-4 space-y-4 flex-grow">
                            <div className="text-sm text-gray-400 mb-2">Engineering Stats</div>
                            <div className="space-y-2">
                                <StatDisplay stats={stat.stats} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
};
