import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { readIndexData, cacheKey, fetchText, fetchCatalogueUnits, unitUrl } from '../catalogueFetch';

const nextData = readFileSync(join(__dirname, 'fixtures/catalogue/index-next-data.json'), 'utf8');
const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${nextData}</script></body></html>`;

const aegisPayload = readFileSync(join(__dirname, 'fixtures/catalogue/aegis.json'), 'utf8');

// Keep retries in tests near-instant: a real run backs off 1s/2s, but the retry loop itself
// (attempt counting, which statuses retry) doesn't depend on how long the backoff is.
const FAST_RETRY = { attempts: 3, delayMs: [0, 0] };

describe('readIndexData', () => {
    it('reads build id, manifest and slugs', () => {
        const index = readIndexData(html);
        expect(index.buildId.length).toBeGreaterThan(0);
        expect(index.slugs).toHaveLength(3);
        expect(index.manifest.unitsSha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('throws when the page has no __NEXT_DATA__', () => {
        expect(() => readIndexData('<html></html>')).toThrow(/__NEXT_DATA__/);
    });

    it('throws when the manifest shape changed', () => {
        const broken = nextData.replace('"unitsSha256"', '"unitsHash"');
        expect(() =>
            readIndexData(`<script id="__NEXT_DATA__" type="application/json">${broken}</script>`)
        ).toThrow();
    });
});

describe('cacheKey', () => {
    it('changes when any watched hash changes', () => {
        const { manifest } = readIndexData(html);
        const base = cacheKey(manifest);
        expect(base).toMatch(/^catalogue-/);
        expect(cacheKey({ ...manifest, unitsSha256: 'f'.repeat(64) })).not.toBe(base);
        expect(cacheKey({ ...manifest, statusEffectsSha256: 'f'.repeat(64) })).not.toBe(base);
        expect(cacheKey({ ...manifest, localeSha256: { en: 'f'.repeat(64) } })).not.toBe(base);
    });
});

describe('fetchText', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('retries a 5xx and returns the body once a request succeeds', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response('busy', { status: 503 }))
            .mockResolvedValueOnce(new Response('ok body', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchText('https://example.test/x', FAST_RETRY)).resolves.toBe('ok body');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rejects a 404 after a single attempt', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchText('https://example.test/x', FAST_RETRY)).rejects.toThrow(/HTTP 404/);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects after exhausting attempts on repeated network errors', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchText('https://example.test/x', FAST_RETRY)).rejects.toThrow('fetch failed');
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});

describe('fetchCatalogueUnits', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('rejects with no partial array when one unit fails schema validation', async () => {
        const broken = JSON.parse(aegisPayload);
        delete broken.unit.stats.HullPoints;
        const fetchMock = vi.fn(async (url: string) => {
            if (url === unitUrl('aegis')) return new Response(JSON.stringify(broken), { status: 200 });
            return new Response(aegisPayload, { status: 200 });
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchCatalogueUnits(['good-a', 'aegis', 'good-b'])).rejects.toThrow(/aegis/);
    });
});
