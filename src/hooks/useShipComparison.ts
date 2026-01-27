import { useState, useMemo, useCallback } from 'react';
import { Ship } from '../types/ship';

export const useShipComparison = <T extends Ship>(ships: T[]) => {
    const [comparisonShipIds, setComparisonShipIds] = useState<string[]>([]);

    const addToComparison = useCallback((shipId: string) => {
        setComparisonShipIds((prev) => {
            if (prev.includes(shipId)) return prev;
            return [...prev, shipId];
        });
    }, []);

    const removeFromComparison = useCallback((shipId: string) => {
        setComparisonShipIds((prev) => prev.filter((id) => id !== shipId));
    }, []);

    const clearComparison = useCallback(() => {
        setComparisonShipIds([]);
    }, []);

    const isInComparison = useCallback(
        (shipId: string) => comparisonShipIds.includes(shipId),
        [comparisonShipIds]
    );

    const comparisonShips = useMemo(() => {
        return comparisonShipIds
            .map((id) => ships.find((s) => s.id === id))
            .filter((s): s is T => s !== undefined);
    }, [comparisonShipIds, ships]);

    return {
        comparisonShipIds,
        comparisonShips,
        addToComparison,
        removeFromComparison,
        clearComparison,
        isInComparison,
    };
};
