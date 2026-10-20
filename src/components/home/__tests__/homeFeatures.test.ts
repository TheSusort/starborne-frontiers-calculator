import { describe, it, expect } from 'vitest';
import { HOME_FEATURE_GROUPS, NEW_FEATURE_DAYS, isNewFeature } from '../homeFeatures';
import { resolveRoutePattern } from '../../../services/pageTracking/resolveRoutePattern';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-20T12:00:00Z');

describe('isNewFeature', () => {
    it('is true for a feature added today', () => {
        expect(isNewFeature('2026-10-20', NOW)).toBe(true);
    });

    it('is true one day before the window closes', () => {
        const added = new Date(NOW.getTime() - (NEW_FEATURE_DAYS - 1) * DAY).toISOString();
        expect(isNewFeature(added, NOW)).toBe(true);
    });

    it('is false exactly at the window boundary', () => {
        const added = new Date(NOW.getTime() - NEW_FEATURE_DAYS * DAY).toISOString();
        expect(isNewFeature(added, NOW)).toBe(false);
    });

    it('is false long after the window', () => {
        expect(isNewFeature('2026-01-01', NOW)).toBe(false);
    });

    it('is false when there is no date', () => {
        expect(isNewFeature(undefined, NOW)).toBe(false);
    });

    it('is false for an unparseable date', () => {
        expect(isNewFeature('not-a-date', NOW)).toBe(false);
    });

    it('is false for a date in the future', () => {
        expect(isNewFeature('2026-12-01', NOW)).toBe(false);
    });

    it('uses a 60 day window', () => {
        expect(NEW_FEATURE_DAYS).toBe(60);
    });
});

describe('HOME_FEATURE_GROUPS', () => {
    const features = HOME_FEATURE_GROUPS.flatMap((g) => g.features);

    it.each(features.map((f) => [f.title, f.to]))(
        '%s links to a registered route (%s)',
        (_title, to) => {
            const pathname = to.split(/[?#]/)[0];
            expect(resolveRoutePattern(pathname)).not.toBe('*');
        }
    );

    it('links the combat simulator to /simulator and gear simulation to /simulation', () => {
        expect(features.find((f) => f.title === 'Combat Simulator')?.to).toBe('/simulator');
        expect(features.find((f) => f.title === 'Gear Simulation')?.to).toBe('/simulation');
    });

    it('has no duplicate destinations', () => {
        const tos = features.map((f) => f.to);
        expect(new Set(tos).size).toBe(tos.length);
    });
});
