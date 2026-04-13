import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShips } from '../../contexts/ShipsContext';
import { getEmptySlotCount } from '../../utils/ship/missingGear';
import { StarIcon } from '../ui/icons';
import { ChevronDownIcon, ChevronUpIcon } from '../ui/icons/ChevronIcons';

const STORAGE_KEY = 'starred_alerts_minimized';

export const StarredShipAlerts: React.FC = () => {
    const { ships } = useShips();
    const navigate = useNavigate();
    const [minimized, setMinimized] = useState<boolean>(() => {
        try {
            return localStorage.getItem(STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    });

    const alertShips = useMemo(
        () => ships.filter((ship) => ship.starred === true && getEmptySlotCount(ship) > 0),
        [ships]
    );

    if (alertShips.length === 0) {
        return null;
    }

    const handleToggleMinimized = () => {
        const next = !minimized;
        setMinimized(next);
        try {
            localStorage.setItem(STORAGE_KEY, String(next));
        } catch {
            // ignore storage errors
        }
    };

    const handleShipClick = (shipId: string) => {
        void navigate(`/autogear?shipId=${shipId}`);
    };

    if (minimized) {
        return (
            <button
                onClick={handleToggleMinimized}
                className="fixed bottom-16 right-4 z-40 flex items-center gap-1.5 bg-dark border border-dark-border rounded-lg px-3 py-2 text-theme-text hover:bg-dark-lighter transition-colors"
                aria-label={`${alertShips.length} starred ships with missing gear`}
            >
                <StarIcon className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-medium">{alertShips.length}</span>
                <ChevronUpIcon className="w-3 h-3 text-theme-text-secondary" />
            </button>
        );
    }

    return (
        <div className="fixed bottom-16 right-4 z-40 w-72 sm:w-80 bg-dark border border-dark-border rounded-lg shadow-lg flex flex-col max-h-80">
            <div className="flex items-center justify-between px-3 py-2 border-b border-dark-border shrink-0">
                <div className="flex items-center gap-1.5">
                    <StarIcon className="w-4 h-4 text-yellow-400" />
                    <span className="text-sm font-semibold text-theme-text">
                        Missing Gear ({alertShips.length})
                    </span>
                </div>
                <button
                    onClick={handleToggleMinimized}
                    className="text-theme-text-secondary hover:text-theme-text transition-colors"
                    aria-label="Minimize panel"
                >
                    <ChevronDownIcon className="w-4 h-4" />
                </button>
            </div>
            <ul className="overflow-y-auto flex-1 py-1">
                {alertShips.map((ship) => (
                    <li key={ship.id}>
                        <button
                            onClick={() => handleShipClick(ship.id)}
                            className="w-full text-left px-3 py-2 hover:bg-dark-lighter transition-colors flex items-center justify-between gap-2"
                        >
                            <span className="text-sm text-theme-text truncate">{ship.name}</span>
                            <span className="text-xs text-theme-text-secondary shrink-0">
                                {getEmptySlotCount(ship)} empty
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
};
