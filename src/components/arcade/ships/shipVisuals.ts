import type { Ship } from '../../../types/ship';

export interface ShipVisual {
    portraitUrl: string | null;
    /** Official render key; `null` → callers use the portrait. */
    visualKey: string | null;
}

/** A fleet ship carries no definition id, so the 3D key comes from its template's. */
export function resolveShipVisual(
    ship: Ship,
    template: Ship | undefined,
    definitionId: string | null,
    keys: Readonly<Record<string, string>>
): ShipVisual {
    const imageKey = ship.imageKey || template?.imageKey;
    return {
        portraitUrl: imageKey ? `${imageKey}_BigPortrait.jpg` : null,
        visualKey: (definitionId && keys[definitionId]) || null,
    };
}
