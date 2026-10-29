import { useMemo } from 'react';
import { useAuth } from '../../../contexts/AuthProvider';
import { useShips } from '../../../contexts/ShipsContext';
import { useShipsData } from '../../../hooks/useShipsData';
import { arcadeFleet } from './arcadeFleet';

/** The fleet the arcade flies, and whether it is still being resolved. */
export function useArcadeFleet() {
    const { loading: authLoading } = useAuth();
    const { ships: ownedShips, fleetLoaded } = useShips();
    const { ships: templateShips, loading: templatesLoading } = useShipsData();
    // `fleetLoaded` reads a session still resolving as signed out, so auth must settle too.
    const ownedLoading = authLoading || !fleetLoaded;
    return useMemo(
        () => arcadeFleet(ownedShips, ownedLoading, templateShips, templatesLoading),
        [ownedShips, ownedLoading, templateShips, templatesLoading]
    );
}
