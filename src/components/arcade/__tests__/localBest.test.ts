import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    readLocalBest,
    readLocalBestRun,
    writeLocalBest,
    ARCADE_BEST_KEY,
    ARCADE_BEST_RUN_KEY,
} from '../localBest';
import type { RunResult } from '../../../utils/arcade/types';

beforeEach(() => localStorage.clear());

const run = (score: number, distance = 0, credits = 0): RunResult => ({
    score,
    distance,
    credits,
    bestNearMissChain: 0,
    nearMissPoints: 0,
});

describe('localBest', () => {
    it('is 0 when nothing is stored or the value is junk', () => {
        expect(readLocalBest()).toBe(0);
        localStorage.setItem(ARCADE_BEST_KEY, 'banana');
        expect(readLocalBest()).toBe(0);
    });
    it('keeps the maximum', () => {
        expect(writeLocalBest(run(500))).toBe(500);
        expect(writeLocalBest(run(200))).toBe(500);
        expect(readLocalBest()).toBe(500);
    });
    it('treats a non-finite score as 0', () => {
        writeLocalBest(run(500));
        expect(writeLocalBest(run(NaN))).toBe(500);
        expect(readLocalBest()).toBe(500);
    });
    it('reads 0 when getItem throws', () => {
        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        expect(readLocalBest()).toBe(0);
        expect(readLocalBestRun()).toBeNull();
        spy.mockRestore();
    });
    it('survives storage that throws', () => {
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        expect(writeLocalBest(run(300))).toBe(300);
        spy.mockRestore();
    });
});

describe('localBest run', () => {
    it('stores the distance and credits of a better run', () => {
        writeLocalBest(run(500, 6420, 312));
        expect(readLocalBestRun()).toEqual({ score: 500, distance: 6420, credits: 312 });
    });
    it('does not overwrite the run with a worse one', () => {
        writeLocalBest(run(500, 6420, 312));
        writeLocalBest(run(200, 9000, 999));
        expect(readLocalBestRun()).toEqual({ score: 500, distance: 6420, credits: 312 });
    });
    it('replaces the run when a better score arrives', () => {
        writeLocalBest(run(500, 6420, 312));
        writeLocalBest(run(800, 100, 5));
        expect(readLocalBestRun()).toEqual({ score: 800, distance: 100, credits: 5 });
    });
    it('reads a legacy score-only best as a run without distance or credits', () => {
        localStorage.setItem(ARCADE_BEST_KEY, '700');
        expect(readLocalBestRun()).toEqual({ score: 700, distance: null, credits: null });
    });
    it('is null with no best at all', () => {
        expect(readLocalBestRun()).toBeNull();
    });
    it('falls back to score-only on malformed JSON', () => {
        localStorage.setItem(ARCADE_BEST_KEY, '700');
        localStorage.setItem(ARCADE_BEST_RUN_KEY, '{nope');
        expect(readLocalBestRun()).toEqual({ score: 700, distance: null, credits: null });
    });
    it('is null on malformed JSON with no score either', () => {
        localStorage.setItem(ARCADE_BEST_RUN_KEY, '{nope');
        expect(readLocalBestRun()).toBeNull();
    });
    it('ignores a run record that disagrees with the best score', () => {
        localStorage.setItem(ARCADE_BEST_KEY, '700');
        localStorage.setItem(
            ARCADE_BEST_RUN_KEY,
            JSON.stringify({ score: 100, distance: 1, credits: 1 })
        );
        expect(readLocalBestRun()).toEqual({ score: 700, distance: null, credits: null });
    });
    it('nulls invalid distance or credits inside a stored run', () => {
        localStorage.setItem(ARCADE_BEST_KEY, '700');
        localStorage.setItem(
            ARCADE_BEST_RUN_KEY,
            JSON.stringify({ score: 700, distance: -5, credits: 'x' })
        );
        expect(readLocalBestRun()).toEqual({ score: 700, distance: null, credits: null });
    });
});
