/** Official 3D ship models (loaded live from starborne.com). On only when the build sets
 *  `VITE_ARCADE_SHIP_MODELS=1`; production sets it in `netlify.toml`. */
export function shipModelsEnabled(): boolean {
    return import.meta.env.VITE_ARCADE_SHIP_MODELS === '1';
}
