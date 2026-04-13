import React from 'react';
import { Ship } from '../../types/ship';
import { Button } from '../ui';
import { CloseIcon, StarIcon } from '../ui/icons';

export interface GearSuggestionTarget {
    ship: Ship;
    emptySlotCount: number;
    isDonor: boolean;
}

interface GearSuggestionTargetsProps {
    targets: GearSuggestionTarget[];
    onSelectShip: (ship: Ship) => void;
    onDismiss: () => void;
}

export const GearSuggestionTargets: React.FC<GearSuggestionTargetsProps> = ({
    targets,
    onSelectShip,
    onDismiss,
}) => {
    if (targets.length === 0) return null;

    return (
        <div className="card space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-theme-text">Ships needing gear</h4>
                <button
                    onClick={onDismiss}
                    className="text-theme-text-secondary hover:text-theme-text p-1"
                    title="Dismiss"
                >
                    <CloseIcon className="h-4 w-4" />
                </button>
            </div>
            <div className="space-y-2">
                {targets.map(({ ship, emptySlotCount, isDonor }) => (
                    <div
                        key={ship.id}
                        className="flex items-center justify-between gap-2 p-2 bg-dark-lighter rounded"
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            {ship.starred && (
                                <StarIcon className="text-yellow-400 h-3.5 w-3.5 flex-shrink-0" />
                            )}
                            <span className="text-sm text-theme-text truncate">{ship.name}</span>
                            <span className="text-xs text-theme-text-secondary whitespace-nowrap">
                                {emptySlotCount} empty
                            </span>
                            {isDonor && (
                                <span className="text-xs text-yellow-500 whitespace-nowrap">
                                    (donor)
                                </span>
                            )}
                        </div>
                        <Button variant="secondary" size="xs" onClick={() => onSelectShip(ship)}>
                            Select
                        </Button>
                    </div>
                ))}
            </div>
        </div>
    );
};
