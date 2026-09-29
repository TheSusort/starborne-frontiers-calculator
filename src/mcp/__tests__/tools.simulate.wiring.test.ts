import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as seededRuns from '../../utils/simulator/seededRuns';
import { SIM_TIME_BUDGET_MS, simulateBattle, sweepStat } from '../tools/simulate';
import { McpToolError } from '../types';
import { call, ctxOver } from './fixtures';
import { GEAR_ID, simTables as tables, vsAtlas } from './simFixtures';

vi.mock('../../utils/simulator/seededRuns', async (importOriginal) => {
    const actual = await importOriginal<typeof seededRuns>();
    return {
        ...actual,
        runSeedSet: vi.fn(actual.runSeedSet),
        runSeededBattle: vi.fn(actual.runSeededBattle),
    };
});

const raw = vsAtlas('s1');

// The arrow body must not be an expression: `mockClear()` returns the mock itself (for
// chaining), and a hook that returns a function has Vitest treat it as a teardown callback —
// which would invoke `runSeedSet()` with no arguments after every test.
beforeEach(() => {
    vi.mocked(seededRuns.runSeedSet).mockClear();
    vi.mocked(seededRuns.runSeededBattle).mockClear();
});

describe('simulator tool wiring', () => {
    it('simulate_battle hands runSeedSet a getGearPiece that resolves the equipped gear', async () => {
        const { ctx } = ctxOver(tables());

        await call(simulateBattle, raw, ctx);

        const getGearPiece = vi.mocked(seededRuns.runSeedSet).mock.calls[0][3];
        expect(getGearPiece?.(GEAR_ID)?.id).toBe(GEAR_ID);
    });

    it('sweep_stat hands every step the same getGearPiece', async () => {
        const { ctx } = ctxOver(tables());

        await call(
            sweepStat,
            {
                ...raw,
                target: { side: 'player', position: 'T1' },
                stat: 'speed',
                from: 100,
                to: 140,
                step: 20,
                runs_per_step: 1,
            },
            ctx
        );

        const calls = vi.mocked(seededRuns.runSeedSet).mock.calls;
        expect(calls.length).toBeGreaterThan(1);
        for (const args of calls) expect(args[3]?.(GEAR_ID)?.id).toBe(GEAR_ID);
    });

    it('sweep_stat refuses a sweep over the battle cap before running a single battle', async () => {
        const { ctx } = ctxOver(tables());

        await expect(
            call(
                sweepStat,
                {
                    ...raw,
                    target: { side: 'player', position: 'T1' },
                    stat: 'speed',
                    from: 100,
                    to: 340,
                    step: 10,
                    runs_per_step: 100,
                },
                ctx
            )
        ).rejects.toBeInstanceOf(McpToolError);
        expect(seededRuns.runSeedSet).not.toHaveBeenCalled();
    });

    const stopped = (battles: number) =>
        new McpToolError(
            `Stopped after ${battles} battles: one call has about 20 seconds. Lower runs (or runs_per_step, or the number of steps) and try again.`
        );
    const sweepRaw = {
        ...raw,
        target: { side: 'player', position: 'T1' },
        stat: 'speed',
        from: 100,
        to: 140,
        step: 20,
        runs_per_step: 1,
    };

    it('simulate_battle turns a passed deadline into a tool error with the battle count', async () => {
        const { ctx } = ctxOver(tables());
        vi.mocked(seededRuns.runSeedSet).mockImplementationOnce(() => {
            throw new seededRuns.SimulationDeadlineError(7);
        });

        await expect(call(simulateBattle, raw, ctx)).rejects.toEqual(stopped(7));
    });

    it('sweep_stat turns a passed deadline into a tool error with the battle count', async () => {
        const { ctx } = ctxOver(tables());
        vi.mocked(seededRuns.runSeedSet).mockImplementationOnce(() => {
            throw new seededRuns.SimulationDeadlineError(7);
        });

        await expect(call(sweepStat, sweepRaw, ctx)).rejects.toEqual(stopped(7));
    });

    it('both tools hand runSeedSet a deadline one time budget from the start of the call', async () => {
        const { ctx } = ctxOver(tables());

        const before = performance.now();
        await call(simulateBattle, raw, ctx);
        await call(sweepStat, sweepRaw, ctx);
        const after = performance.now();

        const calls = vi.mocked(seededRuns.runSeedSet).mock.calls;
        expect(calls.length).toBeGreaterThan(1);
        for (const args of calls) {
            expect(args[4]).toBeGreaterThanOrEqual(before + SIM_TIME_BUDGET_MS);
            expect(args[4]).toBeLessThanOrEqual(after + SIM_TIME_BUDGET_MS);
        }
    });

    it('sweep_stat looks for unsimulated squad-leader effects in one battle, not one per step', async () => {
        const { ctx } = ctxOver(tables());

        await call(
            sweepStat,
            {
                ...sweepRaw,
                player: [{ position: 'T1', ship_id: 'm1' }],
                player_leader: { faction: 'MARAUDERS', name: 'Brandisher', stage: 2 },
            },
            ctx
        );

        expect(vi.mocked(seededRuns.runSeedSet).mock.calls.length).toBeGreaterThan(1);
        expect(seededRuns.runSeededBattle).toHaveBeenCalledTimes(1);
    });
});
