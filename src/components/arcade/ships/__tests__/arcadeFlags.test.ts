import { afterEach, describe, it, expect, vi } from 'vitest';
import { shipModelsEnabled } from '../arcadeFlags';

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
});
