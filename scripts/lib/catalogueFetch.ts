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

const fetchText = async (url: string): Promise<string> => {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return res.text();
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
