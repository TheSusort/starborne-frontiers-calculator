import { reportChunkLoadError } from '../../error/staleChunkRecovery';

/** Official 3D ship models (loaded live from starborne.com). On only when the build sets
 *  `VITE_ARCADE_SHIP_MODELS=1`; production sets it in `netlify.toml`. */
export function shipModelsEnabled(): boolean {
    return import.meta.env.VITE_ARCADE_SHIP_MODELS === '1';
}

const disabled = () => Promise.reject(new Error('ship models disabled'));

/** Passes a failed chunk to `reportChunkLoadError`, which reloads a page left on a replaced
 *  build; the caller still gets the rejection and shows its fallback. */
const recovering = <T>(load: Promise<T>): Promise<T> =>
    load.catch((error: unknown) => {
        reportChunkLoadError(error);
        throw error;
    });

/**
 * The only routes to three.js and the official models (`lazyShipModels.test.ts` keeps every
 * other import of them out): each rejects without loading anything while models are off, so a
 * build without the flag never requests the model chunk.
 */
export const loadShipSprites = () =>
    shipModelsEnabled() ? recovering(import('./shipSprites')) : disabled();
export const loadShipModelView = () =>
    shipModelsEnabled() ? recovering(import('./ShipModelView')) : disabled();

export type ShipSpritesModule = Awaited<ReturnType<typeof loadShipSprites>>;
