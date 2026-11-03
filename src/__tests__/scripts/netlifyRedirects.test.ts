import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * A request for a missing `/assets/*` file must 404, not fall through to the SPA shell: a page
 * still on a replaced build would otherwise get `index.html` as a script and could not tell it
 * from a chunk-load error. Netlify applies `public/_redirects` before `netlify.toml`, so both
 * must put the 404 rule ahead of the SPA fallback, and neither may force it (a forced rule would
 * shadow assets that exist).
 */

const ROOT = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

/** `from`, `to`, status and force flag of each rule in a `_redirects` file, in order. */
function redirectsRules(text: string) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
            const [from, to, status = '301'] = line.split(/\s+/);
            return { from, to, status: status.replace('!', ''), force: status.endsWith('!') };
        });
}

/** The same fields for each `[[redirects]]` table in `netlify.toml`, in order. */
function tomlRules(text: string) {
    return text
        .split('[[redirects]]')
        .slice(1)
        .map((block) => {
            const body = block.split(/\n\s*\[/)[0];
            const field = (name: string) =>
                body.match(new RegExp(`${name}\\s*=\\s*"?([^"\\n]+)"?`))?.[1];
            return {
                from: field('from'),
                to: field('to'),
                status: field('status'),
                force: field('force') === 'true',
            };
        });
}

describe.each([
    ['public/_redirects', redirectsRules(read('public/_redirects'))],
    ['netlify.toml', tomlRules(read('netlify.toml'))],
])('%s', (_file, rules) => {
    it('answers a missing asset with an unforced 404 ahead of the SPA fallback', () => {
        const assets = rules.findIndex((r) => r.from === '/assets/*');
        const spa = rules.findIndex((r) => r.from === '/*' && r.to === '/index.html');
        expect(assets).toBeGreaterThanOrEqual(0);
        expect(spa).toBeGreaterThan(assets);
        expect(rules[assets]).toMatchObject({ status: '404', force: false });
        expect(rules[spa].force).toBe(false);
    });
});
