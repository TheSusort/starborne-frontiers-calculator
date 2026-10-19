import { describe, it, expect } from 'vitest';
import { afterPlayback, DUEL_RESULT_HOLD_MS, effectText, stakesBanner } from '../stakesText';

describe('stakesText', () => {
    it('labels every stakes kind', () => {
        expect(stakesBanner('win-or-die')).toBe('WIN OR DIE');
        expect(stakesBanner('bonus-or-penalty')).toBe('CREDITS ON THE LINE');
        expect(stakesBanner('power-up')).toBe('POWER-UP');
    });

    it('describes every effect', () => {
        expect(effectText({ kind: 'bonus', amount: 500 })).toBe('+500');
        expect(effectText({ kind: 'credits', delta: 25 })).toBe('+25 credits');
        expect(effectText({ kind: 'credits', delta: -12 })).toBe('−12 credits');
        expect(effectText({ kind: 'credits', delta: 0 })).toBe('No credits lost');
        expect(effectText({ kind: 'shield' })).toBe('Shield!');
        expect(effectText({ kind: 'magnet' })).toBe('Magnet!');
        expect(effectText({ kind: 'shield-absorbed' })).toBe('Shield absorbed the defeat');
        expect(effectText({ kind: 'game-over' })).toBe('Destroyed');
        expect(effectText({ kind: 'none' })).toBe('No reward');
    });
});

describe('afterPlayback', () => {
    it('holds every outcome but a run-ending loss', () => {
        expect(afterPlayback({ kind: 'game-over' })).toBe('close');
        for (const effect of [
            { kind: 'bonus', amount: 500 },
            { kind: 'credits', delta: -3 },
            { kind: 'credits', delta: 0 },
            { kind: 'shield' },
            { kind: 'magnet' },
            { kind: 'shield-absorbed' },
            { kind: 'none' },
        ] as const) {
            expect(afterPlayback(effect)).toBe('hold');
        }
        // A skipped duel has no effect.
        expect(afterPlayback(null)).toBe('hold');
        expect(DUEL_RESULT_HOLD_MS).toBeGreaterThanOrEqual(1000);
        expect(DUEL_RESULT_HOLD_MS).toBeLessThanOrEqual(2000);
    });
});
