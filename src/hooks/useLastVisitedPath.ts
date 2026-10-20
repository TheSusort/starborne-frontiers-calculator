import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { StorageKey } from '../constants/storage';
import { resolveRoutePattern } from '../services/pageTracking/resolveRoutePattern';

/** Route patterns that are never a place to "continue" to. `*` is the 404. */
const UNRECORDED_PATTERNS: ReadonlySet<string> = new Set(['/', '*', '/oauth/consent']);

/** True for a pathname worth offering as "continue where you left off". */
export const shouldRecordPath = (pathname: string): boolean =>
    !UNRECORDED_PATTERNS.has(resolveRoutePattern(pathname));

export const readLastVisitedPath = (): string | null => {
    try {
        const stored = localStorage.getItem(StorageKey.LAST_VISITED_PATH);
        return stored && shouldRecordPath(stored) ? stored : null;
    } catch {
        return null;
    }
};

/** Remembers the last page the player was on. Renders nothing; must sit inside the router. */
export const useLastVisitedPath = (): void => {
    const { pathname } = useLocation();

    useEffect(() => {
        if (!shouldRecordPath(pathname)) return;
        try {
            localStorage.setItem(StorageKey.LAST_VISITED_PATH, pathname);
        } catch {
            // Storage unavailable or full; "continue where you left off" just stays hidden.
        }
    }, [pathname]);
};
