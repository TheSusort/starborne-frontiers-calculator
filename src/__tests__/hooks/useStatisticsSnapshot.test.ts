import { describe, it, expect } from 'vitest';
import { getFirstDayOfMonth, getPreviousMonth } from '../../hooks/useStatisticsSnapshot';

describe('useStatisticsSnapshot helpers', () => {
    it('getFirstDayOfMonth returns first day of current month in ISO format', () => {
        const result = getFirstDayOfMonth(new Date('2026-03-15'));
        expect(result).toBe('2026-03-01');
    });

    it('getPreviousMonth returns first day of previous month', () => {
        const result = getPreviousMonth('2026-03-01');
        expect(result).toBe('2026-02-01');
    });

    it('getPreviousMonth handles January correctly', () => {
        const result = getPreviousMonth('2026-01-01');
        expect(result).toBe('2025-12-01');
    });

    it('getFirstDayOfMonth pads single-digit months', () => {
        const result = getFirstDayOfMonth(new Date('2026-01-05'));
        expect(result).toBe('2026-01-01');
    });
});
