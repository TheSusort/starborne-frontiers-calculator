import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ROUTE_PATTERNS } from '../../../constants/routes';
import { resolveRoutePattern } from '../resolveRoutePattern';

describe('ROUTE_PATTERNS', () => {
    it('lists exactly the <Route path> values declared in App.tsx', () => {
        const app = readFileSync(resolve(__dirname, '../../../App.tsx'), 'utf8');
        const declared = [...app.matchAll(/path="([^"]*)"/g)].map((m) => m[1]).sort();
        expect([...ROUTE_PATTERNS].sort()).toEqual(declared);
    });
});

describe('resolveRoutePattern', () => {
    it.each(ROUTE_PATTERNS.filter((p) => !p.includes(':') && p !== '*'))(
        'resolves the static route %s to itself',
        (pattern) => {
            expect(resolveRoutePattern(pattern)).toBe(pattern);
        }
    );

    it('collapses ids into the param pattern', () => {
        expect(resolveRoutePattern('/ships/0b6f2c1e-1111-2222-3333-444455556666')).toBe(
            '/ships/:shipId'
        );
        expect(resolveRoutePattern('/ships/leaderboard/Asphyxiator')).toBe(
            '/ships/leaderboard/:shipName'
        );
    });

    it('prefers a static segment over a param', () => {
        expect(resolveRoutePattern('/ships/index')).toBe('/ships/index');
        expect(resolveRoutePattern('/ships/lore')).toBe('/ships/lore');
    });

    it('ignores trailing slashes and falls back to * for unknown paths', () => {
        expect(resolveRoutePattern('/gear/')).toBe('/gear');
        expect(resolveRoutePattern('/does/not/exist')).toBe('*');
    });
});
