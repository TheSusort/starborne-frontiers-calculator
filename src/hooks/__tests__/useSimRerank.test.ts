import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSimRerank, collectCandidateRuns } from '../useSimRerank';
import type { Ship } from '../../types/ship';
import type { GearSuggestion } from '../../types/autogear';
import type { ShipTypeName } from '../../constants/shipTypes';

const mkShip = (id: string, name: string, type: ShipTypeName = 'DEBUFFER'): Ship =>
    ({
        id,
        name,
        type,
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
    }) as unknown as Ship;

const focus = mkShip('focus', 'Focus');
const ally = mkShip('ally', 'Ally', 'ATTACKER');

const suggestion = (gearId: string): GearSuggestion[] => [{ slotName: 'weapon', gearId, score: 1 }];

// One deterministic loadout per role, so a row can be traced back to the role that produced it
// without running the real optimizer (which is CPU-bound and not under test here).
const runAutogearFor = vi.fn(async (role: ShipTypeName) => ({
    suggestions: suggestion(`gear-${role}`),
    hardRequirementsMet: true,
    attempts: 1,
    candidates: [],
}));

// Captures the AbortSignal actually handed to the seed-set runner, so a cancellation test can
// observe that the simulating phase shares the SAME controller as the gearing phase, rather than
// inferring it from the final status alone (a hook could reach 'cancelled' by some other path,
// e.g. an unrelated throw, without ever wiring the signal through).
const captured = vi.hoisted(() => ({ signal: undefined as AbortSignal | undefined }));

vi.mock('../../utils/simulator/seededRuns', async () => {
    const actual = await vi.importActual<typeof import('../../utils/simulator/seededRuns')>(
        '../../utils/simulator/seededRuns'
    );
    return {
        ...actual,
        runSeedSetAsync: (...callArgs: Parameters<typeof actual.runSeedSetAsync>) => {
            captured.signal = callArgs[3]?.signal;
            return actual.runSeedSetAsync(...callArgs);
        },
    };
});

const baseArgs = () => ({
    focus,
    source: { kind: 'practice' as const },
    comparedRoles: ['DEFENDER'] as ShipTypeName[],
    seed: 1234,
    runCount: 2,
    deps: {
        getGearPiece: () => undefined,
        getEngineeringStatsForShipType: () => undefined,
    },
    getShipById: (id: string) => ({ focus, ally })[id as 'focus' | 'ally'],
    gearToShipMap: new Map<string, string>(),
    resolveShip: () => null,
    runAutogearFor,
});

beforeEach(() => {
    runAutogearFor.mockClear();
    captured.signal = undefined;
});

describe('useSimRerank', () => {
    it('starts idle with no rows', () => {
        const { result } = renderHook(() => useSimRerank());
        expect(result.current.state.status).toBe('idle');
        expect(result.current.state.rows).toEqual([]);
        expect(result.current.state.table).toEqual([]);
        expect(result.current.state.dropped).toEqual([]);
    });

    it("runs the ship's own role and every compared role, and labels each row accordingly", async () => {
        const { result } = renderHook(() => useSimRerank());
        await act(async () => {
            await result.current.run(baseArgs());
        });
        await waitFor(() => expect(result.current.state.status).toBe('done'));

        // Not just "a DEFENDER row exists somewhere" — the optimizer must actually have been
        // invoked under both roles, and every invocation must survive into exactly one row (the
        // mock produces no runner-ups), so a bug that dropped or duplicated a role's row fails
        // this.
        expect(runAutogearFor).toHaveBeenCalledWith('DEBUFFER');
        expect(runAutogearFor).toHaveBeenCalledWith('DEFENDER');
        expect(result.current.state.rows).toHaveLength(2);
        expect(new Set(result.current.state.rows.map((r) => r.role))).toEqual(
            new Set(['DEBUFFER', 'DEFENDER'])
        );

        // Each row carries the loadout that produced it — Apply has nothing to equip without
        // this, so a row must not just describe its build (role/rank), it must contain it.
        const debufferRow = result.current.state.rows.find((r) => r.role === 'DEBUFFER');
        const defenderRow = result.current.state.rows.find((r) => r.role === 'DEFENDER');
        expect(debufferRow?.loadout).toEqual(suggestion('gear-DEBUFFER'));
        expect(defenderRow?.loadout).toEqual(suggestion('gear-DEFENDER'));
    });

    it('runs every candidate on the same seed set, so the deltas are paired', async () => {
        const { result } = renderHook(() => useSimRerank());
        await act(async () => {
            await result.current.run(baseArgs());
        });
        await waitFor(() => expect(result.current.state.status).toBe('done'));

        const seeds = new Set(result.current.state.rows.map((r) => r.run.aggregate.baseSeed));
        const counts = new Set(result.current.state.rows.map((r) => r.run.aggregate.count));
        expect(result.current.state.rows.length).toBeGreaterThan(1);
        expect(seeds).toEqual(new Set([1234]));
        expect(counts).toEqual(new Set([2]));

        // The baseline is part of the same paired comparison, not simulated separately under its
        // own seed set.
        expect(result.current.state.baseline?.aggregate.baseSeed).toBe(1234);
        expect(result.current.state.baseline?.aggregate.count).toBe(2);

        // The metric table must actually be built from the surviving rows — a table that stayed
        // empty, or one built from the wrong candidates, both pass a test that only checks
        // `.length > 1` on rows.
        expect(result.current.state.table.map((row) => row.id).sort()).toEqual(
            result.current.state.rows.map((row) => row.id).sort()
        );
    });

    it('excludes a candidate that strips a board ally, and names what it took', async () => {
        const { result } = renderHook(() => useSimRerank());
        await act(async () => {
            await result.current.run({
                ...baseArgs(),
                // The encounter puts the ally on the board; the DEFENDER candidate wears
                // a piece the ally is still wearing.
                source: {
                    kind: 'encounter' as const,
                    note: {
                        id: 'e1',
                        name: 'Team',
                        createdAt: 0,
                        formation: [
                            { shipId: 'focus', position: 'M4' as const },
                            { shipId: 'ally', position: 'T2' as const },
                        ],
                    },
                },
                resolveShip: (id: string) => ({ focus, ally })[id as 'focus' | 'ally'] ?? null,
                gearToShipMap: new Map([['gear-DEFENDER', 'ally']]),
            });
        });
        await waitFor(() => expect(result.current.state.status).toBe('done'));

        expect(result.current.state.excluded).toHaveLength(1);
        expect(result.current.state.excluded[0].stripped[0].fromShipName).toBe('Ally');
        expect(result.current.state.excluded[0].role).toBe('DEFENDER');
        expect(result.current.state.excluded[0].rank).toBe('best');
        expect(result.current.state.rows.map((r) => r.role)).not.toContain('DEFENDER');

        // The exclusion is of the DEFENDER candidate specifically, not a side effect of the
        // ship's OWN role also getting flagged — its own DEBUFFER build used a different piece
        // and must survive.
        expect(result.current.state.ownBestExcluded).toBe(false);
        expect(result.current.state.rows.map((r) => r.role)).toContain('DEBUFFER');
        // The optimizer still ran under DEFENDER — exclusion happens to its OUTPUT, it does not
        // short-circuit the role out of the job.
        expect(runAutogearFor).toHaveBeenCalledWith('DEFENDER');
    });

    it("marks ownBestExcluded when the ship's own best loadout is the one stripped", async () => {
        const { result } = renderHook(() => useSimRerank());
        await act(async () => {
            await result.current.run({
                ...baseArgs(),
                comparedRoles: [],
                source: {
                    kind: 'encounter' as const,
                    note: {
                        id: 'e1',
                        name: 'Team',
                        createdAt: 0,
                        formation: [
                            { shipId: 'focus', position: 'M4' as const },
                            { shipId: 'ally', position: 'T2' as const },
                        ],
                    },
                },
                resolveShip: (id: string) => ({ focus, ally })[id as 'focus' | 'ally'] ?? null,
                // Focus's own role is DEBUFFER, so its best loadout is gear-DEBUFFER here.
                gearToShipMap: new Map([['gear-DEBUFFER', 'ally']]),
            });
        });
        await waitFor(() => expect(result.current.state.status).toBe('done'));

        expect(result.current.state.ownBestExcluded).toBe(true);
        expect(result.current.state.excluded).toHaveLength(1);
        expect(result.current.state.excluded[0].role).toBe('DEBUFFER');
        expect(result.current.state.excluded[0].rank).toBe('best');
        expect(result.current.state.rows).toHaveLength(0);
        // Nothing survived to compare, but the baseline still ran so the page has something to
        // show against.
        expect(result.current.state.baseline).toBeDefined();
        expect(result.current.state.table).toEqual([]);
    });

    it('surfaces cells the resolved fight dropped, e.g. a saved ship id that no longer resolves', async () => {
        const { result } = renderHook(() => useSimRerank());
        await act(async () => {
            await result.current.run({
                ...baseArgs(),
                comparedRoles: [],
                // 'ghost' is not in the resolver below, so the fight drops its cell and runs
                // without it.
                source: {
                    kind: 'encounter' as const,
                    note: {
                        id: 'e1',
                        name: 'Team',
                        createdAt: 0,
                        formation: [
                            { shipId: 'focus', position: 'M4' as const },
                            { shipId: 'ghost', position: 'T2' as const },
                        ],
                    },
                },
                resolveShip: (id: string) => ({ focus, ally })[id as 'focus' | 'ally'] ?? null,
            });
        });
        await waitFor(() => expect(result.current.state.status).toBe('done'));

        expect(result.current.state.dropped).toEqual([{ side: 'player', position: 'T2' }]);
    });

    it("turns the genetic optimizer's runner-ups into their own rows, distinct from the role's best", async () => {
        const { result } = renderHook(() => useSimRerank());
        const withRunnerUp = vi.fn(async (role: ShipTypeName) => ({
            suggestions: suggestion(`gear-${role}`),
            hardRequirementsMet: true,
            attempts: 1,
            candidates: role === 'DEBUFFER' ? [suggestion(`gear-${role}-alt`)] : [],
        }));

        await act(async () => {
            await result.current.run({
                ...baseArgs(),
                comparedRoles: [],
                runAutogearFor: withRunnerUp,
            });
        });
        await waitFor(() => expect(result.current.state.status).toBe('done'));

        expect(result.current.state.rows).toHaveLength(2);
        expect(new Set(result.current.state.rows.map((r) => r.id)).size).toBe(2);
        const ranks = result.current.state.rows.map((r) => r.rank);
        expect(ranks).toContainEqual('best');
        expect(ranks).toContainEqual({ alt: 1 });
        expect(result.current.state.rows.every((r) => r.role === 'DEBUFFER')).toBe(true);
        // The metric table must contain the runner-up too, not just the best.
        expect(result.current.state.table).toHaveLength(2);

        // The runner-up's row carries its OWN loadout, distinct from the best's — a bug that
        // reused `suggestions.suggestions` for every rank would give both rows the same gear.
        const bestRow = result.current.state.rows.find((r) => r.rank === 'best');
        const altRow = result.current.state.rows.find((r) => typeof r.rank === 'object');
        expect(bestRow?.loadout).toEqual(suggestion('gear-DEBUFFER'));
        expect(altRow?.loadout).toEqual(suggestion('gear-DEBUFFER-alt'));
    });

    it('stops the gearing phase between roles once cancelled, never starting a later role', async () => {
        const { result } = renderHook(() => useSimRerank());
        act(() => {
            void result.current.run({
                ...baseArgs(),
                comparedRoles: ['DEFENDER', 'SUPPORTER'],
            });
        });
        act(() => result.current.cancel());
        await waitFor(() => expect(result.current.state.status).toBe('cancelled'));

        // Cancelling before the loop yields back means only the first role's optimizer call had
        // already fired; a hook that instead let the whole gearing phase finish before checking
        // cancellation would call this for every role.
        expect(runAutogearFor.mock.calls.length).toBeLessThan(3);
        expect(result.current.state.table).toEqual([]);
        expect(result.current.state.rows).toEqual([]);
        expect(result.current.state.baseline).toBeUndefined();
    });

    it('aborts the simulating phase through the same controller once gearing has finished', async () => {
        const { result } = renderHook(() => useSimRerank());
        act(() => {
            void result.current.run({ ...baseArgs(), runCount: 50 });
        });
        await waitFor(() => expect(result.current.state.status).toBe('simulating'));
        act(() => result.current.cancel());
        await waitFor(() => expect(result.current.state.status).toBe('cancelled'));

        // Proves cancel() reaches the actual seed-set runner rather than only being observed
        // through the final status — the same AbortController must feed both phases.
        expect(captured.signal?.aborted).toBe(true);
        expect(result.current.state.table).toEqual([]);
        expect(result.current.state.baseline).toBeUndefined();
    });
});

describe('collectCandidateRuns', () => {
    it('runs the gearing-then-simulating sequence directly, with no renderer involved', async () => {
        const phases: Array<'gearing' | 'simulating'> = [];
        const controller = new AbortController();

        const result = await collectCandidateRuns({
            ...baseArgs(),
            signal: controller.signal,
            onProgress: () => {},
            onPhase: (phase) => phases.push(phase),
        });

        expect(phases).toEqual(['gearing', 'simulating']);
        expect(result.status).toBe('done');
        expect(result.baseline).toBeDefined();
        expect(result.rows.length).toBeGreaterThan(0);
        expect(result.table.map((row) => row.id).sort()).toEqual(
            result.rows.map((row) => row.id).sort()
        );
    });
});
