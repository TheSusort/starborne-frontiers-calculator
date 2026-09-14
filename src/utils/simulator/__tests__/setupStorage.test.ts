import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    SETUP_STORAGE_KEYS,
    readAutosavedSetup,
    writeAutosavedSetup,
    readSavedSetups,
    writeSavedSetups,
} from '../setupStorage';
import { AUTOSAVE_SETUP_NAME, type SimulatorSetup } from '../simulatorSetup';

const setup = (name: string): SimulatorSetup => ({
    version: 1,
    name,
    playerBoard: { T1: { shipId: 'owned-1' } },
    enemyBoard: { B4: { shipId: 'template:t:r0' } },
    seed: 7,
    runCount: 20,
    savedAt: 1,
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('autosave', () => {
    it('round-trips a setup', () => {
        writeAutosavedSetup(setup('auto'));
        expect(readAutosavedSetup()?.name).toBe('auto');
    });

    // The autosave is written under a placeholder name because the schema requires a non-empty
    // one; an autosave named '' would fail validation on every read.
    it('round-trips the name an autosave actually carries', () => {
        writeAutosavedSetup(setup(AUTOSAVE_SETUP_NAME));
        const restored = readAutosavedSetup();
        expect(restored).not.toBeNull();
        expect(restored?.name).toBe(AUTOSAVE_SETUP_NAME);
    });

    it('returns null when nothing is stored', () => {
        expect(readAutosavedSetup()).toBeNull();
    });

    it('returns null for non-JSON', () => {
        localStorage.setItem(SETUP_STORAGE_KEYS.autosave, '{{{');
        expect(readAutosavedSetup()).toBeNull();
    });

    it('returns null for JSON of the wrong shape', () => {
        localStorage.setItem(SETUP_STORAGE_KEYS.autosave, JSON.stringify({ version: 1 }));
        expect(readAutosavedSetup()).toBeNull();
    });

    it('returns null when reading storage throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(readAutosavedSetup()).toBeNull();
    });

    it('does not throw when writing storage throws', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        expect(() => writeAutosavedSetup(setup('auto'))).not.toThrow();
    });
});

describe('saved list', () => {
    it('round-trips a list', () => {
        writeSavedSetups([setup('a'), setup('b')]);
        expect(readSavedSetups().map((s) => s.name)).toEqual(['a', 'b']);
    });

    it('drops only the invalid entries', () => {
        localStorage.setItem(
            SETUP_STORAGE_KEYS.saved,
            JSON.stringify([setup('a'), { version: 99 }, setup('b')])
        );
        expect(readSavedSetups().map((s) => s.name)).toEqual(['a', 'b']);
    });

    it('returns an empty list for a non-array', () => {
        localStorage.setItem(SETUP_STORAGE_KEYS.saved, JSON.stringify({ a: 1 }));
        expect(readSavedSetups()).toEqual([]);
    });
});
