import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { readIndexData, cacheKey } from '../catalogueFetch';

const nextData = readFileSync(join(__dirname, 'fixtures/catalogue/index-next-data.json'), 'utf8');
const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${nextData}</script></body></html>`;

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
