/**
 * Squad-leader selection persistence for the Combat Simulator page (PR F2).
 *
 * The page keeps one `SquadLeaderSelection | undefined` per side in plain component
 * state and mirrors it into localStorage under these keys (deliberately NOT the
 * `useStorage` IndexedDB/Supabase pipeline — this is throwaway per-device UI state,
 * same tier as view modes and filters).
 *
 * Stored values cross a trust boundary on read (localStorage is user-editable and
 * survives data updates), so `parseSquadLeaderSelection` validates the full shape
 * against the current SQUAD_LEADERS data: unknown faction, unknown leader name, or
 * a bad stage all resolve to `undefined` rather than reaching `simulateBattle`
 * (whose pass throws on unknown leaders).
 */
import { SQUAD_LEADERS } from '../../constants/squadLeaders';
import type { SquadLeaderSelection } from '../combat/preFight';

/** localStorage keys, one per board side. */
export const SQUAD_LEADER_STORAGE_KEYS = {
    player: 'simulator-squad-leader-player',
    enemy: 'simulator-squad-leader-enemy',
} as const;

/** Parse + validate a raw stored value. Anything malformed or no longer present in
 *  the SQUAD_LEADERS data → undefined (treated as "no leader selected"). */
export function parseSquadLeaderSelection(raw: string | null): SquadLeaderSelection | undefined {
    if (!raw) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { faction, name, stage } = parsed as Record<string, unknown>;
    if (typeof faction !== 'string' || typeof name !== 'string') return undefined;
    if (stage !== 1 && stage !== 2 && stage !== 3) return undefined;
    const leaders = SQUAD_LEADERS[faction];
    if (!leaders?.some((leader) => leader.name === name)) return undefined;
    return { faction, name, stage };
}

/** Read + validate the stored selection for a key. Never throws (storage may be
 *  unavailable, e.g. blocked third-party contexts) — falls back to undefined. */
export function readStoredSquadLeaderSelection(key: string): SquadLeaderSelection | undefined {
    try {
        return parseSquadLeaderSelection(localStorage.getItem(key));
    } catch {
        return undefined;
    }
}

/** Write-through for a selection change: persist the new value, or remove the key
 *  when the selection is cleared. Never throws (private-mode storage quota etc. —
 *  the in-memory selection still applies for the session). */
export function writeStoredSquadLeaderSelection(
    key: string,
    selection: SquadLeaderSelection | undefined
): void {
    try {
        if (selection) localStorage.setItem(key, JSON.stringify(selection));
        else localStorage.removeItem(key);
    } catch {
        // Storage unavailable — keep the selection in memory only.
    }
}
