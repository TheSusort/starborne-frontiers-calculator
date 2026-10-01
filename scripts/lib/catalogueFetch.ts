/**
 * Network access to the official unit catalogue. The unit-locale API needs no Next.js build id;
 * slugs and the change-detection manifest come from the index page's `__NEXT_DATA__`.
 */
import {
    catalogueUnitPayloadSchema,
    indexDataSchema,
    type CatalogueManifest,
    type CatalogueUnit,
} from './catalogueSchema';

const ORIGIN = 'https://starborne.com';
export const INDEX_URL = `${ORIGIN}/frontiers/units`;
export const unitUrl = (slug: string) =>
    `${ORIGIN}/api/unit-catalogue/unit-locale?locale=en&slug=${encodeURIComponent(slug)}`;

const HEADERS = {
    'User-Agent':
        'starborne-frontiers-calculator catalogue sync (+https://github.com/TheSusort/starborne-frontiers-calculator)',
};

export const readIndexData = (html: string) => {
    const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    if (!raw) throw new Error('catalogue index has no __NEXT_DATA__ — page markup changed');
    const data = indexDataSchema.parse(JSON.parse(raw));
    return {
        buildId: data.buildId,
        manifest: data.props.pageProps.manifest,
        slugs: data.props.pageProps.units.map((u) => u.slug),
    };
};

/** Changes whenever unit data, status effects, or English text change upstream. */
export const cacheKey = (m: CatalogueManifest): string =>
    `catalogue-${m.unitsSha256.slice(0, 16)}-${m.localeSha256.en.slice(0, 16)}-${m.statusEffectsSha256.slice(0, 16)}`;

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAYS_MS = [1_000, 2_000];

/** A 5xx or network/timeout failure: worth retrying. A 4xx is thrown as a plain `Error` instead,
 *  since the request itself is wrong and a retry would just repeat it. */
class RetryableFetchError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface FetchTextOptions {
    /** Total calls to `fetch`, including the first. Default 3. */
    attempts?: number;
    /** Backoff before each retry, indexed by the attempt that just failed (so `delayMs[0]` runs
     *  before the second call). The last entry repeats if there are more retries than entries.
     *  Default [1000, 2000]ms; tests pass near-zero delays to stay fast. */
    delayMs?: number[];
}

export const fetchText = async (url: string, options: FetchTextOptions = {}): Promise<string> => {
    const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
    const delays = options.delayMs ?? DEFAULT_DELAYS_MS;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
            if (res.ok) return await res.text();
            const message = `${url} -> HTTP ${res.status}`;
            if (res.status >= 500) throw new RetryableFetchError(message);
            throw new Error(message);
        } catch (error) {
            lastError = error;
            if (!(error instanceof RetryableFetchError) && error instanceof Error && /HTTP \d+/.test(error.message)) {
                throw error;
            }
            if (attempt === attempts - 1) throw error;
            await sleep(delays[attempt] ?? delays[delays.length - 1]);
        }
    }
    throw lastError;
};

export const fetchCatalogueIndex = async () => readIndexData(await fetchText(INDEX_URL));

export const fetchCatalogueUnits = async (
    slugs: string[],
    concurrency = 4
): Promise<CatalogueUnit[]> => {
    const out: CatalogueUnit[] = new Array(slugs.length);
    let next = 0;
    const worker = async () => {
        while (next < slugs.length) {
            const i = next++;
            const body = JSON.parse(await fetchText(unitUrl(slugs[i])));
            const parsed = catalogueUnitPayloadSchema.safeParse(body);
            if (!parsed.success) {
                throw new Error(`${slugs[i]}: payload failed validation: ${parsed.error.message}`);
            }
            out[i] = parsed.data.unit;
        }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    return out;
};
