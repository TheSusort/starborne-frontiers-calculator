import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAbortError } from '../../idle';
import { loadShipModel } from '../shipModelLoader';
import { pinModel, setArcadeOpen } from '../modelPins';

const parse = vi.fn();
vi.mock('three/examples/jsm/loaders/FBXLoader.js', () => ({
    FBXLoader: class {
        parse = parse;
    },
}));
vi.mock('three', async (importOriginal) => ({
    ...(await importOriginal<typeof import('three')>()),
    FileLoader: class {
        setResponseType() {
            return this;
        }
        loadAsync = async () => new ArrayBuffer(1);
    },
    TextureLoader: class {
        setCrossOrigin() {}
        loadAsync = async () => ({});
    },
}));

afterEach(() => {
    parse.mockReset();
    setArcadeOpen(true);
});

describe('model parse while the arcade is closed', () => {
    it('drops the queued parse of an unpinned model, and a later load retries', async () => {
        setArcadeOpen(false);
        await expect(loadShipModel('Gate_1')).rejects.toSatisfy(isAbortError);
        expect(parse).not.toHaveBeenCalled();

        setArcadeOpen(true);
        await loadShipModel('Gate_1').catch(() => {});
        expect(parse).toHaveBeenCalledTimes(1);
    });

    it('still parses a pinned model', async () => {
        setArcadeOpen(false);
        const release = pinModel('Gate_2');
        await loadShipModel('Gate_2').catch(() => {});
        expect(parse).toHaveBeenCalledTimes(1);
        release();
    });
});
