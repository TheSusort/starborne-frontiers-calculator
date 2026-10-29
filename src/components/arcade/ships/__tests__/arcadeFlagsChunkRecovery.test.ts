import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadShipModelView, loadShipSprites } from '../arcadeFlags';
import { reportChunkLoadError } from '../../../error/staleChunkRecovery';

vi.mock('../../../error/staleChunkRecovery', () => ({ reportChunkLoadError: vi.fn() }));
vi.mock('../shipSprites', () => {
    throw new TypeError('Failed to fetch dynamically imported module: /assets/shipSprites-a.js');
});
vi.mock('../ShipModelView', () => {
    throw new TypeError('Failed to fetch dynamically imported module: /assets/ShipModelView-a.js');
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(reportChunkLoadError).mockClear();
});

describe('ship model loaders on a failed chunk', () => {
    it.each([
        ['loadShipSprites', loadShipSprites],
        ['loadShipModelView', loadShipModelView],
    ] as const)('%s reports the failure and still rejects', async (_name, load) => {
        vi.stubEnv('VITE_ARCADE_SHIP_MODELS', '1');
        const error = await load().then(
            () => null,
            (e: unknown) => e
        );
        expect(error).not.toBeNull();
        expect(reportChunkLoadError).toHaveBeenCalledWith(error);
    });

    it('reports nothing while models are off', async () => {
        vi.stubEnv('VITE_ARCADE_SHIP_MODELS', undefined);
        await expect(loadShipModelView()).rejects.toThrow('ship models disabled');
        expect(reportChunkLoadError).not.toHaveBeenCalled();
    });
});
