import { useCallback, useMemo } from 'react';
import type { Ship } from '../../../types/ship';
import { useShipsData } from '../../../hooks/useShipsData';
import { SHIP_VISUAL_KEYS } from './shipVisualKeys';
import { resolveShipVisual, type ShipVisual } from './shipVisuals';

/** Fleet ships resolve to their template by name, as elsewhere in the app. */
export function useShipVisuals(): (ship: Ship) => ShipVisual {
    const { ships: templates, getDefinitionId } = useShipsData();
    const byName = useMemo(() => new Map(templates.map((t) => [t.name, t])), [templates]);
    return useCallback(
        (ship: Ship) => {
            const template = byName.get(ship.name);
            const definitionId = template ? getDefinitionId(template.id) : null;
            return resolveShipVisual(ship, template, definitionId, SHIP_VISUAL_KEYS);
        },
        [byName, getDefinitionId]
    );
}
