import { useCallback } from 'react';
import type { Ship } from '../types/ship';
import { useShips } from '../contexts/ShipsContext';
import { resolveShipId } from '../utils/ship/resolveShipId';
import { useShipsData } from './useShipsData';

/** The app-wired form of `resolveShipId`: owned ships from ShipsContext, reference units from the
 *  unit catalogue. */
export function useShipIdResolver(): (shipId: string) => Ship | null {
    const { getShipById } = useShips();
    const { ships: units, getAscensionStats } = useShipsData();
    return useCallback(
        (shipId: string) => resolveShipId(shipId, { getShipById, units, getAscensionStats }),
        [getShipById, units, getAscensionStats]
    );
}
