import { parseSimulatorSetup, parseSimulatorSetupList } from '../../schemas/simulatorSetup';
import type { SimulatorSetup } from './simulatorSetup';

/**
 * Simulator setups are throwaway per-device UI state — the same tier as view modes, filters and
 * the squad-leader selections in `squadLeaderSelection.ts` — deliberately NOT the `useStorage`
 * IndexedDB/Supabase pipeline.
 */
export const SETUP_STORAGE_KEYS = {
    autosave: 'simulator-setup-autosave',
    saved: 'simulator-setup-saved',
} as const;

/** Bounds how much this page can accumulate in a storage area shared with everything else on the
 *  origin. A save past the cap drops the oldest entry. */
export const MAX_SAVED_SETUPS = 50;

/** Reads never throw: storage can be unavailable (private mode, blocked third-party contexts) and
 *  the stored value is user-editable. */
const readRaw = (key: string): unknown => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

/** Writes never throw either (quota, private mode): the value stays in memory for the session. */
const writeRaw = (key: string, value: unknown): void => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage unavailable.
    }
};

export function readAutosavedSetup(): SimulatorSetup | null {
    return parseSimulatorSetup(readRaw(SETUP_STORAGE_KEYS.autosave));
}

export function writeAutosavedSetup(setup: SimulatorSetup): void {
    writeRaw(SETUP_STORAGE_KEYS.autosave, setup);
}

export function readSavedSetups(): SimulatorSetup[] {
    return parseSimulatorSetupList(readRaw(SETUP_STORAGE_KEYS.saved));
}

export function writeSavedSetups(setups: SimulatorSetup[]): void {
    writeRaw(SETUP_STORAGE_KEYS.saved, setups.slice(-MAX_SAVED_SETUPS));
}
