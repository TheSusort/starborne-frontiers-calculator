import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { markResident } from '../shipSprites';

const hooks = vi.hoisted(() => ({
    evict: null as null | ((model: unknown, key: string) => void),
}));
vi.mock('../shipModelLoader', () => ({
    loadShipModel: vi.fn(),
    releaseGpu: vi.fn(),
    trimShipModelsToClosedSize: vi.fn(),
    onShipModelEvicted: (listener: (model: unknown, key: string) => void) => {
        hooks.evict = listener;
        return () => {};
    },
}));

describe('markResident', () => {
    it('counts a cached model resident, but not one the cache evicted mid-render', () => {
        const stage = { resident: new Set<THREE.Object3D>() };
        const live = new THREE.Group();
        const gone = new THREE.Group();
        markResident(stage, live);
        hooks.evict?.(gone, 'Gone_1');
        markResident(stage, gone);
        expect([...stage.resident]).toEqual([live]);
    });
});
