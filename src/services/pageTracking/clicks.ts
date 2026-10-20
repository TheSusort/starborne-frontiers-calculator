export type ClickMap = Record<string, number>;

/** Mirrors the check in `track_page_events`; a key the server would drop is never counted. */
export const TRACK_ID_PATTERN = /^[a-z0-9._-]{1,64}$/;
export const MAX_CLICK_KEYS = 50;
export const MAX_CLICK_COUNT = 999;

export function addClick(map: ClickMap, trackId: string): ClickMap {
    if (!TRACK_ID_PATTERN.test(trackId)) return map;
    const current = Object.hasOwn(map, trackId) ? map[trackId] : undefined;
    if (current === undefined && Object.keys(map).length >= MAX_CLICK_KEYS) return map;
    return { ...map, [trackId]: Math.min(MAX_CLICK_COUNT, (current ?? 0) + 1) };
}

/** Only elements carrying `data-track` are counted; unlabelled clicks are ignored by design. */
export function trackIdFromTarget(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    return target.closest('[data-track]')?.getAttribute('data-track') ?? null;
}

export function navTrackId(path: string): string {
    return path === '/' ? 'nav.home' : `nav.${path.slice(1).replace(/\//g, '.')}`;
}
