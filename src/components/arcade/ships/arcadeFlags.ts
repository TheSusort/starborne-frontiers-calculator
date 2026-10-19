/** Official 3D ship models (loaded live from starborne.com). On only when the build sets
 *  `VITE_ARCADE_SHIP_MODELS=1`; production sets it in `netlify.toml`. */
export function shipModelsEnabled(): boolean {
    return import.meta.env.VITE_ARCADE_SHIP_MODELS === '1';
}

const disabled = () => Promise.reject(new Error('ship models disabled'));

/**
 * The only routes to three.js and the official models (`lazyShipModels.test.ts` keeps every
 * other import of them out): each rejects without loading anything while models are off, so a
 * build without the flag never requests the model chunk.
 */
export const loadShipSprites = () => (shipModelsEnabled() ? import('./shipSprites') : disabled());
export const loadShipModelView = () =>
    shipModelsEnabled() ? import('./ShipModelView') : disabled();

export type ShipSpritesModule = Awaited<ReturnType<typeof loadShipSprites>>;
