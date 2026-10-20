import type { ErrorRecord, VisitRecord } from './tracker';

/**
 * Raw `fetch` with `keepalive` so a flush started while the tab is hiding or closing still lands.
 * `sendBeacon` cannot set the `apikey`/`Authorization` headers PostgREST requires. Failures are
 * dropped: tracking never retries and never surfaces errors.
 */
export function createRpcSender(
    url: string,
    anonKey: string,
    getToken: () => string | null
): (visits: VisitRecord[], errors: ErrorRecord[]) => void {
    return (visits, errors) => {
        fetch(`${url}/rest/v1/rpc/track_page_events`, {
            method: 'POST',
            keepalive: true,
            headers: {
                apikey: anonKey,
                Authorization: `Bearer ${getToken() ?? anonKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ p_visits: visits, p_errors: errors }),
        }).catch(() => undefined);
    };
}
