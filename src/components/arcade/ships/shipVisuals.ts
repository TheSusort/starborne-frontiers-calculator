import type { Ship } from '../../../types/ship';
import { shipPortraitUrl } from '../../board/shipPortrait';

export interface ShipVisual {
    /** Absolute Cloudinary URL; `imageKey` is a Cloudinary public id, not a URL. */
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
    return {
        portraitUrl: shipPortraitUrl(ship.imageKey || template?.imageKey),
        visualKey: (definitionId && keys[definitionId]) || null,
    };
}
