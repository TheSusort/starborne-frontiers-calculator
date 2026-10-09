import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FACTIONS } from '../../constants/factions';

/**
 * Tripwire for the CSP in `netlify.toml`.
 *
 * "Copy as image" (`html-to-image`) inlines every `<img>` by `fetch()`ing it, so an image
 * host that is in `img-src` but missing from `connect-src` renders on the page yet fails
 * the capture: the fetch is blocked, the cloned `<img>` gets an empty src, and the whole
 * copy rejects. Every host a captured card draws images from must be in `connect-src`.
 */

const NETLIFY_TOML = readFileSync(resolve(__dirname, '../../../netlify.toml'), 'utf8');

const connectSrc = (): string[] => {
    const csp = NETLIFY_TOML.match(/Content-Security-Policy\s*=\s*"([^"]+)"/)?.[1];
    const directive = csp
        ?.split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith('connect-src '));
    if (!directive) throw new Error('connect-src not found in netlify.toml CSP');
    return directive.split(/\s+/).slice(1);
};

describe('netlify.toml CSP connect-src', () => {
    const captureImageOrigins = [
        'https://res.cloudinary.com',
        ...Object.values(FACTIONS).map((f) => new URL(f.iconUrl).origin),
    ];

    it.each([...new Set(captureImageOrigins)])('allows fetching %s', (origin) => {
        expect(connectSrc()).toContain(origin);
    });
});
