import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOffFormulaTuning, collectTuningRows } from '../useOffFormulaTuning';
import { bandsBetween } from '../../utils/autogear/simRerank/statBands';
import type { Ship } from '../../types/ship';
import type { GearSuggestion } from '../../types/autogear';

// Real baseStats and a real skill so the SIMULATE phase runs the actual combat engine rather
// than a degenerate always-zero-damage draw — mirrors useSimRerank.test.ts's `mkShip`.
const focus: Ship = {
    id: 'x',
    name: 'X',
    type: 'ATTACKER',
    baseStats: {
        attack: 5000,
        crit: 50,
        critDamage: 150,
        hacking: 200,
        security: 100,
        defence: 3000,
        hp: 50000,
        speed: 110,
    },
    equipment: {},
    implants: {},
    refits: [],
    activeSkillText: 'This Unit deals <unit-damage>150% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
} as unknown as Ship;

const runArgs = (over: Record<string, unknown> = {}) => ({
    ship: focus,
    configuredRole: 'ATTACKER' as never,
    stat: 'hacking' as never,
    gatingStat: 'security' as never,
    seed: 42,
    runCount: 2,
    runOptimizer: vi.fn(),
    deps: { getGearPiece: () => undefined, getEngineeringStatsForShipType: () => undefined },
    ...over,
});

const pass = (landed: number, suggestions: GearSuggestion[] = []) =>
    Promise.resolve({ suggestions, landed });

describe('useOffFormulaTuning', () => {
    it('clears previous results when a new run starts, so no stale row survives', async () => {
        const { result } = renderHook(() => useOffFormulaTuning());

        // First: a successful run that actually populates rows.
        const okOptimizer = vi.fn().mockResolvedValue({ suggestions: [], landed: 300 });
        await act(async () => {
            await result.current.run(runArgs({ runOptimizer: okOptimizer }));
        });
        await waitFor(() => expect(result.current.state.status).toBe('done'));
        expect(result.current.state.rows.length).toBeGreaterThan(0);

        // Then: a run that fails outright.
        const failingOptimizer = vi.fn().mockRejectedValue(new Error('boom'));
        await act(async () => {
            await result.current.run(runArgs({ runOptimizer: failingOptimizer }));
        });
        expect(result.current.state.rows).toEqual([]);
        expect(result.current.state.error).toBeTruthy();
        // A failed run must not report itself as never-started: 'idle' alongside an error is a
        // shape no reader can act on.
        expect(result.current.state.status).toBe('error');
    });

    it('runs the optimizer once per band PLUS a baseline and two probes', async () => {
        // Call-order based: 1st call is the floor probe, 2nd the ceiling probe, everything
        // after is the baseline plus one pass per band — matching collectTuningRows' own
        // sequencing. Floor=100, ceiling=600 divides evenly into BAND_COUNT bands with no
        // dedup collapsing, so the expected count is derived from the SAME bandsBetween call
        // the hook makes, not hard-coded — a implementation that never actually probes (and
        // so never varies floor/ceiling) cannot make this pass by accident.
        let call = 0;
        const runOptimizer = vi.fn().mockImplementation(() => {
            call++;
            if (call === 1) return pass(100);
            if (call === 2) return pass(600);
            return pass(250);
        });
        const { result } = renderHook(() => useOffFormulaTuning());
        await act(async () => {
            await result.current.run(runArgs({ runOptimizer }));
        });
        await waitFor(() => expect(result.current.state.status).toBe('done'));

        const expectedBandPasses = bandsBetween(100, 600).length;
        expect(runOptimizer).toHaveBeenCalledTimes(2 + 1 + expectedBandPasses);
    });

    it('marks a row unreachable when the optimizer lands outside its band', async () => {
        let call = 0;
        const runOptimizer = vi.fn().mockImplementation(() => {
            call++;
            if (call === 1) return pass(100);
            if (call === 2) return pass(600);
            // Every gearing pass beyond the probes (baseline + every band) lands on the same
            // value, which is inside only one of the five bands bandsBetween(100, 600) produces.
            return pass(440);
        });
        const { result } = renderHook(() => useOffFormulaTuning());
        await act(async () => {
            await result.current.run(runArgs({ runOptimizer }));
        });
        await waitFor(() => expect(result.current.state.status).toBe('done'));

        expect(result.current.state.rows.some((r) => !r.reachable)).toBe(true);
        expect(result.current.state.rows.some((r) => r.reachable)).toBe(true);
    });

    it('stops on cancel without writing rows', async () => {
        const runOptimizer = vi
            .fn()
            .mockImplementation(
                () =>
                    new Promise((resolve) =>
                        setTimeout(() => resolve({ suggestions: [], landed: 300 }), 50)
                    )
            );
        const { result } = renderHook(() => useOffFormulaTuning());
        act(() => {
            void result.current.run(runArgs({ runOptimizer }));
        });
        act(() => {
            result.current.cancel();
        });
        await waitFor(() => expect(result.current.state.status).toBe('cancelled'));
        expect(result.current.state.rows).toEqual([]);
    });

    it('resets to idle with no rows, aborting any in-flight run', async () => {
        const runOptimizer = vi.fn().mockResolvedValue({ suggestions: [], landed: 300 });
        const { result } = renderHook(() => useOffFormulaTuning());
        await act(async () => {
            await result.current.run(runArgs({ runOptimizer }));
        });
        await waitFor(() => expect(result.current.state.status).toBe('done'));

        act(() => {
            result.current.reset();
        });
        expect(result.current.state.status).toBe('idle');
        expect(result.current.state.rows).toEqual([]);
        expect(result.current.state.baseline).toBeUndefined();
    });

    // Progress is scoped to the current phase, so a reader that shows the phase alongside the
    // numbers never sees the count run backwards inside one phase. A single run-wide denominator
    // cannot do this: the band count is unknown until the probes finish.
    it('reports progress against a total that is constant within each phase', async () => {
        let call = 0;
        const runOptimizer = vi.fn().mockImplementation(() => {
            call++;
            if (call === 1) return pass(100);
            if (call === 2) return pass(600);
            return pass(250);
        });

        let phase: string = 'probing';
        const byPhase = new Map<string, Array<{ completed: number; total: number }>>();
        const result = await collectTuningRows({
            ...runArgs({ runOptimizer }),
            signal: new AbortController().signal,
            onPhase: (next) => {
                phase = next;
            },
            onProgress: (completed, total) => {
                const entries = byPhase.get(phase) ?? [];
                entries.push({ completed, total });
                byPhase.set(phase, entries);
            },
        });

        expect(result.status).toBe('done');
        expect([...byPhase.keys()]).toEqual(['probing', 'gearing', 'simulating']);
        for (const entries of byPhase.values()) {
            const totals = new Set(entries.map((e) => e.total));
            expect(totals.size).toBe(1);
            for (let i = 1; i < entries.length; i++) {
                expect(entries[i].completed).toBeGreaterThanOrEqual(entries[i - 1].completed);
            }
            expect(entries[entries.length - 1].completed).toBe(entries[0].total);
        }
    });
});
