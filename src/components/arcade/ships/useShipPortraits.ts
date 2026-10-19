import { useCallback, useMemo } from 'react';
import { useShipsData } from '../../../hooks/useShipsData';

/**
 * Resolves a ship name to its pilot portrait's Cloudinary public id (`<imageKey>_Portrait.jpg`)
 * via the ship template of that name, as elsewhere in the app; null when no template matches.
 */
export function useShipPortraits(): (name: string) => string | null {
    const { ships: templates } = useShipsData();
    const byName = useMemo(() => new Map(templates.map((t) => [t.name, t.imageKey])), [templates]);
    return useCallback(
        (name: string) => {
            const imageKey = byName.get(name);
            return imageKey ? `${imageKey}_Portrait.jpg` : null;
        },
        [byName]
    );
}
