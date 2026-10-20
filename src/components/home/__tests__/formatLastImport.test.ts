import { describe, it, expect } from 'vitest';
import { formatLastImport } from '../fleetPanelState';

const NOW = new Date('2026-10-20T12:00:00Z');

describe('formatLastImport', () => {
    it('is null when there is no timestamp', () => {
        expect(formatLastImport(null, NOW)).toBeNull();
    });

    it('is null for an unparseable timestamp', () => {
        expect(formatLastImport('garbage', NOW)).toBeNull();
    });

    it('says today within the same day', () => {
        expect(formatLastImport('2026-10-20T08:00:00Z', NOW)).toBe('today');
    });

    it('says 1 day ago after one day', () => {
        expect(formatLastImport('2026-10-19T08:00:00Z', NOW)).toBe('1 day ago');
    });

    it('counts whole days', () => {
        expect(formatLastImport('2026-10-10T12:00:00Z', NOW)).toBe('10 days ago');
    });

    it('treats a future timestamp as today', () => {
        expect(formatLastImport('2026-11-01T00:00:00Z', NOW)).toBe('today');
    });
});
