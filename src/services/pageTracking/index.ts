import { supabase } from '../../config/supabase';
import { CURRENT_VERSION } from '../../constants';
import { trackIdFromTarget } from './clicks';
import {
    deviceForWidth,
    loadIdentity,
    readTrackingOptOut,
    referrerHost,
    safeLocalStorage,
    safeSessionStorage,
    shouldTrack,
} from './environment';
import { PageTracker } from './tracker';
import { createRpcSender } from './transport';

let tracker: PageTracker | null = null;
let accessToken: string | null = null;

/**
 * One tracker per page load. The caller's JWT is forwarded so the server can attach `user_id`
 * and drop admin traffic; without a session the anon key is sent instead.
 */
export function getPageTracker(): PageTracker {
    if (tracker) return tracker;
    void supabase.auth.getSession().then(({ data }) => {
        accessToken = data.session?.access_token ?? null;
    });
    supabase.auth.onAuthStateChange((_event, session) => {
        accessToken = session?.access_token ?? null;
    });
    tracker = new PageTracker({
        now: () => Date.now(),
        newId: () => crypto.randomUUID(),
        identity: loadIdentity(safeLocalStorage(), safeSessionStorage(), () => crypto.randomUUID()),
        referrerHost: referrerHost(document.referrer, window.location.hostname),
        device: deviceForWidth(window.innerWidth),
        appVersion: CURRENT_VERSION,
        isEnabled: () =>
            shouldTrack(window.location.hostname, readTrackingOptOut(safeLocalStorage())),
        send: createRpcSender(
            import.meta.env.VITE_SUPABASE_URL as string,
            import.meta.env.VITE_SUPABASE_ANON_KEY as string,
            () => accessToken
        ),
    });
    return tracker;
}

export function attachPageTrackingListeners(target: PageTracker): () => void {
    const onClick = (event: MouseEvent) => {
        const trackId = trackIdFromTarget(event.target);
        if (trackId) target.recordClick(trackId);
    };
    const onVisibility = () => target.setVisible(document.visibilityState === 'visible');
    const onPageHide = () => target.setVisible(false);
    const onError = (event: ErrorEvent) => {
        const error: unknown = event.error;
        target.recordError(event.message, error instanceof Error ? error.stack : undefined);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
        const reason: unknown = event.reason;
        if (reason instanceof Error) target.recordError(reason.message, reason.stack);
        else target.recordError(String(reason), undefined);
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
    };
}
