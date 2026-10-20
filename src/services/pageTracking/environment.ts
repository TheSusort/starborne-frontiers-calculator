export type Device = 'mobile' | 'tablet' | 'desktop';

export interface Identity {
    visitorId: string;
    sessionId: string;
    /** True on the first page load of a browser-tab session; that load's first visit is the entry. */
    isNewSession: boolean;
}

const VISITOR_KEY = 'tracking_visitor_id';
const SESSION_KEY = 'tracking_session_id';
export const TRACKING_OPT_OUT_KEY = 'tracking_opt_out';

export function safeLocalStorage(): Storage | null {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

export function safeSessionStorage(): Storage | null {
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

function read(storage: Storage | null, key: string): string | null {
    try {
        return storage?.getItem(key) ?? null;
    } catch {
        return null;
    }
}

function write(storage: Storage | null, key: string, value: string | null): void {
    try {
        if (value === null) storage?.removeItem(key);
        else storage?.setItem(key, value);
    } catch {
        // Storage can be full or blocked; tracking then runs with per-load ids.
    }
}

export function loadIdentity(
    local: Storage | null,
    session: Storage | null,
    newId: () => string
): Identity {
    let visitorId = read(local, VISITOR_KEY);
    if (!visitorId) {
        visitorId = newId();
        write(local, VISITOR_KEY, visitorId);
    }
    let sessionId = read(session, SESSION_KEY);
    const isNewSession = !sessionId;
    if (!sessionId) {
        sessionId = newId();
        write(session, SESSION_KEY, sessionId);
    }
    return { visitorId, sessionId, isNewSession };
}

export function deviceForWidth(width: number): Device {
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
}

export function referrerHost(referrer: string, ownHost: string): string | null {
    if (!referrer) return null;
    try {
        const host = new URL(referrer).hostname.toLowerCase();
        return host && host !== ownHost ? host : null;
    } catch {
        return null;
    }
}

export function readTrackingOptOut(local: Storage | null): boolean {
    return read(local, TRACKING_OPT_OUT_KEY) === '1';
}

export function writeTrackingOptOut(local: Storage | null, optedOut: boolean): void {
    write(local, TRACKING_OPT_OUT_KEY, optedOut ? '1' : null);
}

export function shouldTrack(hostname: string, optedOut: boolean): boolean {
    return !optedOut && hostname !== 'localhost' && hostname !== '127.0.0.1';
}

/** `crypto.randomUUID` is missing on Safari < 15.4 and in insecure contexts; `getRandomValues` is not. */
export function randomId(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
