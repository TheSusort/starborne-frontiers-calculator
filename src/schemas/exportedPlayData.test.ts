import { describe, it, expect } from 'vitest';
import { validateExportedPlayData } from './exportedPlayData';

describe('validateExportedPlayData', () => {
    it('rejects empty object', () => {
        const r = validateExportedPlayData({});
        expect(r.success).toBe(false);
        expect((r as { success: false; error: string }).error).toMatch(/invalid/i);
    });
    it('rejects null', () => {
        expect(validateExportedPlayData(null).success).toBe(false);
    });
    it('rejects missing Equipment', () => {
        const r = validateExportedPlayData({ Units: [], Engineering: [] });
        expect(r.success).toBe(false);
    });
    it('accepts valid minimal structure', () => {
        const r = validateExportedPlayData({ Units: [], Equipment: [], Engineering: [] });
        expect(r.success).toBe(true);
    });
});
