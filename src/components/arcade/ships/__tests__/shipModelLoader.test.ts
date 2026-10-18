import { afterEach, describe, it, expect, vi } from 'vitest';
import { loadShipModel, modelUrls, noseUpCorrection } from '../shipModelLoader';

vi.mock('three/examples/jsm/loaders/FBXLoader.js', () => ({
    FBXLoader: class {
        loadAsync = vi.fn(() => new Promise(() => {}));
    },
}));

afterEach(() => vi.useRealTimers());

describe('shipModelLoader', () => {
    it('builds the official render URLs', () => {
        expect(modelUrls('Atlas_4')).toEqual({
            fbx: 'https://starborne.com/ship-renders/Atlas_4/Atlas_4_LOD0.fbx',
            albedo: 'https://starborne.com/ship-renders/Atlas_4/Atlas_4_A.webp',
            emissive: 'https://starborne.com/ship-renders/Atlas_4/Atlas_4_E.webp',
            normal: 'https://starborne.com/ship-renders/Atlas_4/Atlas_4_N.webp',
            orm: 'https://starborne.com/ship-renders/Atlas_4/Atlas_4_ORM.webp',
        });
    });

    it('rejects after the timeout', async () => {
        vi.useFakeTimers();
        const p = loadShipModel('Slow_1', 10_000);
        const assertion = expect(p).rejects.toThrow(/timed out/);
        await vi.advanceTimersByTimeAsync(10_000);
        await assertion;
    });
});

describe('noseUpCorrection', () => {
    it('leaves a nose-forward model alone', () => {
        expect(noseUpCorrection({ x: 0.5, y: 0.2, z: 1.7 }, { x: 0, y: 0.02, z: -0.8 })).toBe(0);
    });

    it('leaves a tall model whose engines face backwards alone', () => {
        expect(noseUpCorrection({ x: 0.4, y: 0.7, z: 0.6 }, { x: 0, y: 0, z: -0.3 })).toBe(0);
    });

    it('leaves a model with belly engines alone when it is longest front to back', () => {
        expect(noseUpCorrection({ x: 0.6, y: 0.3, z: 0.7 }, { x: 0, y: -0.04, z: -0.02 })).toBe(0);
    });

    it('turns a nose-up model, engines at the bottom, nose-forward', () => {
        expect(noseUpCorrection({ x: 0.6, y: 0.74, z: 0.3 }, { x: 0, y: -0.34, z: 0.04 })).toBe(
            Math.PI / 2
        );
    });

    it('turns a nose-down model nose-forward', () => {
        expect(noseUpCorrection({ x: 0.6, y: 0.74, z: 0.3 }, { x: 0, y: 0.34, z: 0.04 })).toBe(
            -Math.PI / 2
        );
    });

    it('leaves a model without engine markers alone', () => {
        expect(noseUpCorrection({ x: 0.6, y: 0.74, z: 0.3 }, null)).toBe(0);
    });
});
