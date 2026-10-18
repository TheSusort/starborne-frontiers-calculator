import { Cloudinary } from '@cloudinary/url-gen';
import type { Ship } from '../../../types/ship';

const cld = new Cloudinary({
    cloud: { cloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME },
});

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
    const imageKey = ship.imageKey || template?.imageKey;
    return {
        portraitUrl: imageKey ? cld.image(`${imageKey}_BigPortrait.jpg`).toURL() : null,
        visualKey: (definitionId && keys[definitionId]) || null,
    };
}
