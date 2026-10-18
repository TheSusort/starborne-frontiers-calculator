/** Official 3D ship models (loaded live from starborne.com). Off unless the build sets
 *  `VITE_ARCADE_SHIP_MODELS=1`; production stays off until the asset owner approves. */
export function shipModelsEnabled(): boolean {
    return import.meta.env.VITE_ARCADE_SHIP_MODELS === '1';
}
