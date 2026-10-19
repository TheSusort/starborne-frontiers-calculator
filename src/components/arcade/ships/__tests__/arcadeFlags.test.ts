import { afterEach, describe, it, expect, vi } from 'vitest';
import { loadShipModelView, loadShipSprites, shipModelsEnabled } from '../arcadeFlags';

const imported = vi.hoisted(() => ({ sprites: false, view: false }));
vi.mock('../shipSprites', () => {
    imported.sprites = true;
    return {};
});
vi.mock('../ShipModelView', () => {
    imported.view = true;
    return { default: () => null };
});

afterEach(() => vi.unstubAllEnvs());

describe('shipModelsEnabled', () => {
    it('is on only for the exact value 1', () => {
        vi.stubEnv('VITE_ARCADE_SHIP_MODELS', '1');
        expect(shipModelsEnabled()).toBe(true);
        vi.stubEnv('VITE_ARCADE_SHIP_MODELS', 'true');
        expect(shipModelsEnabled()).toBe(false);
        vi.stubEnv('VITE_ARCADE_SHIP_MODELS', '');
        expect(shipModelsEnabled()).toBe(false);
    });
    it('is off when the variable is unset', () => {
        vi.stubEnv('VITE_ARCADE_SHIP_MODELS', undefined);
        expect('VITE_ARCADE_SHIP_MODELS' in import.meta.env).toBe(false);
        expect(shipModelsEnabled()).toBe(false);
    });
});

describe('ship model loaders', () => {
    it('reject without importing anything while models are off', async () => {
        vi.stubEnv('VITE_ARCADE_SHIP_MODELS', undefined);
        await expect(loadShipSprites()).rejects.toThrow('ship models disabled');
        await expect(loadShipModelView()).rejects.toThrow('ship models disabled');
        expect(imported).toEqual({ sprites: false, view: false });
    });
    it('import the modules while models are on', async () => {
        vi.stubEnv('VITE_ARCADE_SHIP_MODELS', '1');
        await loadShipSprites();
        await loadShipModelView();
        expect(imported).toEqual({ sprites: true, view: true });
    });
});
