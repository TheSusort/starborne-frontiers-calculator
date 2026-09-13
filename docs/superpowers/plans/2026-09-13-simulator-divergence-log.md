# Simulator Diverging-Seed Battle Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player click a seed where a pinned baseline and the current run disagree on the winner, and see both fights replayed side by side in round lockstep.

**Architecture:** `PinnedBaseline` starts retaining the `BattleSimulationInput` that produced it, which makes the baseline replayable at any seed. A pure `divergingSeeds` walks the two aggregates' already-recorded per-seed summaries and returns the winner mismatches. `useSimulatorRuns` gains one `divergence` slot holding both replayed `BattleResult`s. `BattlePlayback` becomes optionally round-controlled so a new `DivergencePlayback` can drive two of them from one `RoundStepper`.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, TailwindCSS.

Spec: `docs/superpowers/specs/2026-09-13-simulator-divergence-log-design.md`. Issue: #505.

## Global Constraints

- **UI components:** never raw `<button>` for a standard action — use `Button` from `src/components/ui/Button`. Never hand-roll a box — use the `card` CSS class (`bg-dark border border-dark-border p-4`). Tables use `DataTable` from `src/components/ui/tables/DataTable`.
- **No emojis in UI text.** Plain text plus colour classes.
- **Responsive:** the page must work at ~400px. The divergence playback is stacked, single column, for exactly this reason.
- **Comments:** present-tense behaviour contracts only. No change history, no task/phase numbers, no counts or call-site enumerations, no rule restated at N call sites. A comment that needs this plan to parse belongs in the commit body instead.
- **Run tests from this worktree.** `npx vitest run <path>` for a single file. The husky pre-commit hook runs the full suite plus `tsc --noEmit` and lint; do not use `--no-verify` on a source commit.
- **Never run `vitest -u`.**
- **Changelog:** an area prefix plus 8-12 words, one entry per user-visible change, added to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` before committing.
- **Mutation probes:** every load-bearing guard gets one — revert the guard, watch the test that claims to hold it fail, restore. A test that passes with the guard reverted pins nothing.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/utils/simulator/deltaStats.ts` (modify) | Export `assertPairedSeedSets`; `pairedSeries` calls it instead of inlining the check. |
| `src/utils/simulator/compareRuns.ts` (modify) | `PinnedBaseline.input`; new `DivergingSeed` type and `divergingSeeds` function. |
| `src/hooks/useSimulatorRuns.ts` (modify) | `divergence` state, `handleOpenDivergence`, clearing at every `battleResult` write site, `input` on pin. |
| `src/components/simulator/BattlePlayback.tsx` (modify) | Optional controlled `round` prop; suppresses its own stepper when controlled. |
| `src/components/simulator/DivergencePlayback.tsx` (create) | Shared round index, header, one `RoundStepper`, two labelled `BattlePlayback`s. |
| `src/components/simulator/RunComparison.tsx` (modify) | Divergence `DataTable` + `onOpenDivergence` prop. |
| `src/pages/SimulatorPage.tsx` (modify) | Renders `DivergencePlayback` or `BattlePlayback`. |
| `src/constants/changelog.ts`, `src/pages/DocumentationPage.tsx` (modify) | User-facing release note and in-app docs. |

---

### Task 1: `assertPairedSeedSets` + `divergingSeeds`

The pure layer. Nothing is re-run: `SeedSetAggregate.runs[]` already carries `{ seed, winner, lastRound }` for both sides.

**Files:**
- Modify: `src/utils/simulator/deltaStats.ts`
- Modify: `src/utils/simulator/compareRuns.ts`
- Test: `src/utils/simulator/__tests__/compareRuns.test.ts`

**Interfaces:**
- Produces: `assertPairedSeedSets(baseline: SeedSetAggregate, current: SeedSetAggregate): void` (throws), `DivergingSeed`, `divergingSeeds(baseline, current): DivergingSeed[]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/utils/simulator/__tests__/compareRuns.test.ts`. Add `divergingSeeds` to the existing import from `../compareRuns`, and add these imports at the top of the file:

```ts
import type { SeedRunSummary, SeedSetAggregate } from '../seededRuns';
```

Then the new block:

```ts
describe('divergingSeeds', () => {
    const BASE_SEED = 500;

    /** A three-seed aggregate whose per-seed winners and round counts are given directly. */
    const aggregate = (
        entries: Array<[winner: SeedRunSummary['winner'], lastRound: number]>
    ): SeedSetAggregate => {
        const runs: SeedRunSummary[] = entries.map(([winner, lastRound], i) => ({
            seed: BASE_SEED + i,
            winner,
            lastRound,
            perActor: {},
        }));
        return {
            baseSeed: BASE_SEED,
            count: runs.length,
            roster: [],
            runs,
            wins: {
                player: runs.filter((r) => r.winner === 'player').length,
                enemy: runs.filter((r) => r.winner === 'enemy').length,
                draw: runs.filter((r) => r.winner === 'draw').length,
            },
            meanRounds: 0,
            medianRounds: 0,
            perActorMean: {},
        };
    };

    it('returns nothing when both configurations produced the same winner on every seed', () => {
        const runs = aggregate([
            ['player', 6],
            ['enemy', 7],
            ['draw', 12],
        ]);
        expect(divergingSeeds(runs, aggregate([
            ['player', 9],
            ['enemy', 4],
            ['draw', 12],
        ]))).toEqual([]);
    });

    it('returns only the seed whose winner changed, carrying both round counts', () => {
        const baseline = aggregate([
            ['player', 6],
            ['enemy', 7],
            ['draw', 12],
        ]);
        const current = aggregate([
            ['player', 6],
            ['player', 9],
            ['draw', 12],
        ]);
        expect(divergingSeeds(baseline, current)).toEqual([
            {
                seed: BASE_SEED + 1,
                baselineWinner: 'enemy',
                currentWinner: 'player',
                baselineRounds: 7,
                currentRounds: 9,
            },
        ]);
    });

    it('returns rows in seed-set order', () => {
        const baseline = aggregate([
            ['enemy', 6],
            ['player', 6],
            ['enemy', 6],
        ]);
        const current = aggregate([
            ['player', 6],
            ['player', 6],
            ['draw', 6],
        ]);
        expect(divergingSeeds(baseline, current).map((row) => row.seed)).toEqual([
            BASE_SEED,
            BASE_SEED + 2,
        ]);
    });

    it('refuses to pair two different seed sets rather than walking them by index', () => {
        const baseline = aggregate([
            ['player', 6],
            ['enemy', 6],
        ]);
        const shifted = aggregate([
            ['player', 6],
            ['enemy', 6],
        ]);
        shifted.runs[1].seed = 9999;
        expect(() => divergingSeeds(baseline, shifted)).toThrow(/seed set/i);
    });

    it('refuses to pair seed sets of different lengths', () => {
        const baseline = aggregate([
            ['player', 6],
            ['enemy', 6],
        ]);
        expect(() => divergingSeeds(baseline, aggregate([['player', 6]]))).toThrow(/seed set/i);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/simulator/__tests__/compareRuns.test.ts`
Expected: FAIL — `divergingSeeds` is not exported from `../compareRuns`.

- [ ] **Step 3: Extract the pairing guard in `deltaStats.ts`**

In `src/utils/simulator/deltaStats.ts`, add this exported function immediately above `pairedSeries`:

```ts
/** Throw unless the two aggregates ran the identical seed set in the identical order. Anything
 *  that walks both `runs` arrays by index is only valid under that condition, and there is
 *  deliberately no unpaired fallback: a fallback would still present its output as a comparison
 *  of these two configurations while measuring something else. */
export function assertPairedSeedSets(baseline: SeedSetAggregate, current: SeedSetAggregate): void {
    if (
        baseline.runs.length !== current.runs.length ||
        baseline.runs.some((run, i) => run.seed !== current.runs[i].seed)
    ) {
        throw new Error(
            'assertPairedSeedSets: the two aggregates do not share a seed set, so a paired comparison is not valid'
        );
    }
}
```

Then replace the body of `pairedSeries` above its `return` so the inline check is gone:

```ts
export function pairedSeries(
    baseline: SeedSetAggregate,
    current: SeedSetAggregate,
    pick: (run: SeedRunSummary) => number
): { baseline: number[]; current: number[] } {
    assertPairedSeedSets(baseline, current);
    return {
        baseline: baseline.runs.map(pick),
        current: current.runs.map(pick),
    };
}
```

The existing `deltaStats.test.ts` throw assertions match on `/seed set/i`, so they keep passing against the new message.

- [ ] **Step 4: Add `divergingSeeds` to `compareRuns.ts`**

Add to the imports at the top of `src/utils/simulator/compareRuns.ts`:

```ts
import type { SeedRunSummary, SeedSetAggregate } from './seededRuns';
import { assertPairedSeedSets } from './deltaStats';
```

(`SeedSetAggregate` is already imported as a type there — merge, do not duplicate the import.)

Append at the end of the file:

```ts
/** One seed where two configurations disagreed about who won. Round counts ride along so a
 *  fight that also took much longer is visible without a round-count threshold deciding which
 *  rows exist. */
export interface DivergingSeed {
    seed: number;
    baselineWinner: SeedRunSummary['winner'];
    currentWinner: SeedRunSummary['winner'];
    baselineRounds: number;
    currentRounds: number;
}

/** The seeds where a pinned baseline and the current run produced different winners, in seed-set
 *  order. Reads the recorded per-seed summaries both aggregates already carry — nothing is
 *  re-simulated here. */
export function divergingSeeds(
    baseline: SeedSetAggregate,
    current: SeedSetAggregate
): DivergingSeed[] {
    assertPairedSeedSets(baseline, current);
    const rows: DivergingSeed[] = [];
    baseline.runs.forEach((baselineRun, i) => {
        const currentRun = current.runs[i];
        if (baselineRun.winner === currentRun.winner) return;
        rows.push({
            seed: baselineRun.seed,
            baselineWinner: baselineRun.winner,
            currentWinner: currentRun.winner,
            baselineRounds: baselineRun.lastRound,
            currentRounds: currentRun.lastRound,
        });
    });
    return rows;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/utils/simulator/__tests__/compareRuns.test.ts src/utils/simulator/__tests__/deltaStats.test.ts`
Expected: PASS, both files.

- [ ] **Step 6: Mutation probe the pairing guard**

Temporarily delete the `assertPairedSeedSets(baseline, current);` line from `divergingSeeds`. Run `npx vitest run src/utils/simulator/__tests__/compareRuns.test.ts`. Expected: the two "refuses to pair" tests FAIL. Restore the line and re-run; expected PASS. If either test still passed without the guard, the test is not pinning it — fix the test before continuing.

- [ ] **Step 7: Commit**

```bash
git add src/utils/simulator/deltaStats.ts src/utils/simulator/compareRuns.ts src/utils/simulator/__tests__/compareRuns.test.ts
git commit -m "feat(simulator): find the seeds where a baseline and the current run disagree"
```

---

### Task 2: `PinnedBaseline` retains its input

A required field, so `tsc --noEmit` enumerates every construction site for you. Do not hand-maintain a list of them — compile, fix what the compiler names, compile again.

**Files:**
- Modify: `src/utils/simulator/compareRuns.ts`
- Modify: `src/hooks/useSimulatorRuns.ts:handlePinBaseline`
- Test: `src/hooks/__tests__/useSimulatorRuns.test.ts`
- Fixtures the compiler will flag: `src/utils/simulator/__tests__/effectiveRunParams.test.ts`, `src/components/simulator/__tests__/RunComparison.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `PinnedBaseline.input: BattleSimulationInput`.

- [ ] **Step 1: Write the failing test**

Add to the main `describe('useSimulatorRuns')` block in `src/hooks/__tests__/useSimulatorRuns.test.ts`:

```ts
it('pins the input that produced the baseline, and a later board edit does not change it', async () => {
    const { result, rerender } = renderHook(
        (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
        { initialProps: baseArgs({ playerBoard: board('T1', 'nova', { attack: 100 }) }) }
    );

    await act(async () => {
        result.current.handleRun();
    });
    act(() => {
        result.current.handlePinBaseline();
    });

    const pinnedInput = result.current.baseline?.input;
    expect(pinnedInput).toBeDefined();

    // The boards move on. A pinned baseline is a snapshot of the run that produced it, so its
    // input must not follow them — replaying it later has to reproduce the pinned fight.
    rerender(baseArgs({ playerBoard: board('T1', 'vanguard', { attack: 999 }) }));

    expect(result.current.baseline?.input).toBe(pinnedInput);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/useSimulatorRuns.test.ts -t 'pins the input'`
Expected: FAIL — `Property 'input' does not exist on type 'PinnedBaseline'`.

- [ ] **Step 3: Add the field**

In `src/utils/simulator/compareRuns.ts`, extend the interface and its doc:

```ts
/** A seed-set aggregate frozen as the comparison point, alongside the override snapshot and the
 *  fully-resolved engine input that produced it. The seed and run count live inside `aggregate` —
 *  see `effectiveRunParams`' doc for how a pinned baseline forces a variant run onto this same
 *  seed set. `input` is what makes the baseline replayable at a seed after the boards have moved
 *  on; it is captured at pin time and never re-derived from live state. */
export interface PinnedBaseline {
    aggregate: SeedSetAggregate;
    overrides: OverrideSnapshot;
    input: BattleSimulationInput;
}
```

Add to that file's imports:

```ts
import type { BattleResult, BattleSimulationInput } from '../calculators/battleSimulator';
```

(`BattleResult` is already imported there — merge into the one statement.)

In `src/hooks/useSimulatorRuns.ts`, `handlePinBaseline` becomes:

```ts
setBaseline({ aggregate, overrides: provenance.overrides, input: provenance.input });
```

- [ ] **Step 4: Fix the fixtures the compiler names**

Run: `npx tsc --noEmit`

It will name every object literal that is now missing `input`. Fix each by adding a minimal input:

In `src/utils/simulator/__tests__/effectiveRunParams.test.ts`, add above the `baseline` helper and use it:

```ts
import type { BattleSimulationInput } from '../../calculators/battleSimulator';

const input: BattleSimulationInput = { playerTeam: [], enemyTeam: [] };

const baseline = (baseSeed: number, count: number): PinnedBaseline => ({
    aggregate: aggregate(baseSeed, count),
    overrides: {},
    input,
});
```

In `src/components/simulator/__tests__/RunComparison.test.tsx`, add one helper near the top and route every baseline fixture through it:

```ts
import type { BattleSimulationInput } from '../../../utils/calculators/battleSimulator';
import type { PinnedBaseline } from '../../../utils/simulator/compareRuns';

const emptyInput: BattleSimulationInput = { playerTeam: [], enemyTeam: [] };

/** Wraps an aggregate as a pinned baseline. The input is inert here — this component never
 *  replays, it only reads figures and hands a seed back to its caller. */
const pinned = (aggregate: SeedSetAggregate): PinnedBaseline => ({
    aggregate,
    overrides: {},
    input: emptyInput,
});
```

Then replace each fixture:
- `const baseline = { aggregate: aggregate(4, 6, 1000, 1), overrides: {} };` becomes `const baseline = pinned(aggregate(4, 6, 1000, 1));`
- `const noiseBaseline = { aggregate: aggregate(10, 6, 1000, 2), overrides: {} };` becomes `const noiseBaseline = pinned(aggregate(10, 6, 1000, 2));`
- `const divergentBaseline = { aggregate: divergentSeedSet(8, 6, 1000), overrides: {} };` becomes `const divergentBaseline = pinned(divergentSeedSet(8, 6, 1000));`
- `const flipBaseline = { aggregate: aggregate(10, 6, 1000, 0), overrides: {} };` becomes `const flipBaseline = pinned(aggregate(10, 6, 1000, 0));`
- `skewedBaseline` and `noisyBaseline` (multi-line object literals around lines 283 and 306) each become `pinned(<their existing aggregate expression>)`. Read each one and keep its aggregate expression exactly; only the wrapper changes. If either carries a non-empty `overrides`, keep that by spreading: `{ ...pinned(<aggregate>), overrides: <its overrides> }`.

Re-run `npx tsc --noEmit` until clean.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/useSimulatorRuns.test.ts src/utils/simulator/__tests__/effectiveRunParams.test.ts src/components/simulator/__tests__/RunComparison.test.tsx`
Expected: PASS, all three files.

- [ ] **Step 6: Mutation probe the snapshot**

Temporarily change `handlePinBaseline` to build a fresh input instead of reading the recorded one: `setBaseline({ aggregate, overrides: provenance.overrides, input: buildInput() })`. Run `npx vitest run src/hooks/__tests__/useSimulatorRuns.test.ts -t 'pins the input'`. Expected: FAIL — a fresh `buildInput()` is a different object, so the identity assertion breaks. Restore.

- [ ] **Step 7: Commit**

```bash
git add src/utils/simulator/compareRuns.ts src/hooks/useSimulatorRuns.ts src/hooks/__tests__/useSimulatorRuns.test.ts src/utils/simulator/__tests__/effectiveRunParams.test.ts src/components/simulator/__tests__/RunComparison.test.tsx
git commit -m "feat(simulator): keep the engine input that produced a pinned baseline"
```

---

### Task 3: The `divergence` slot in `useSimulatorRuns`

**Files:**
- Modify: `src/hooks/useSimulatorRuns.ts`
- Test: `src/hooks/__tests__/useSimulatorRuns.test.ts`

**Interfaces:**
- Consumes: `PinnedBaseline.input` (Task 2).
- Produces: on `UseSimulatorRunsResult` — `divergence: { seed: number; baseline: BattleResult; current: BattleResult } | null`, `handleOpenDivergence: (seed: number) => void`, `handleCloseDivergence: () => void`.

- [ ] **Step 1: Write the failing tests**

Add to `src/hooks/__tests__/useSimulatorRuns.test.ts`:

```ts
describe('divergence playback', () => {
    /** Runs, pins, then opens a divergence — the state every test in this block starts from. */
    const runPinAndOpen = async (seed = 507) => {
        const rendered = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs() }
        );
        await act(async () => {
            rendered.result.current.handleRun();
        });
        act(() => {
            rendered.result.current.handlePinBaseline();
        });
        act(() => {
            rendered.result.current.handleOpenDivergence(seed);
        });
        return rendered;
    };

    it('replays both sides at the seed and hides the single-fight playback', async () => {
        const { result } = await runPinAndOpen(507);

        expect(result.current.divergence?.seed).toBe(507);
        expect(result.current.divergence?.baseline).toBe(fakeBattleResult);
        expect(result.current.divergence?.current).toBe(fakeBattleResult);
        // A divergence pair and a single playback are alternatives, never both on the page.
        expect(result.current.battleResult).toBeNull();

        // Both replays go through the pinned/recorded inputs at the SAME seed.
        const seeds = mockRunSeededBattle.mock.calls.map((call) => call[1]);
        expect(seeds).toEqual([507, 507]);
    });

    it('does nothing without a pinned baseline', async () => {
        const { result } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs() }
        );
        await act(async () => {
            result.current.handleRun();
        });
        act(() => {
            result.current.handleOpenDivergence(507);
        });
        expect(result.current.divergence).toBeNull();
        expect(result.current.runError).toMatch(/baseline/i);
    });

    it('clears the pair when a new run lands', async () => {
        const { result } = await runPinAndOpen();
        await act(async () => {
            result.current.handleRun();
        });
        expect(result.current.divergence).toBeNull();
    });

    it('keeps the pair when a run is cancelled, because a cancelled run writes nothing', async () => {
        const { result } = await runPinAndOpen();
        const release = holdNextRun();
        act(() => {
            result.current.handleRun();
        });
        act(() => {
            result.current.handleCancel();
        });
        await act(async () => {
            release();
        });
        expect(result.current.divergence?.seed).toBe(507);
    });

    it('clears the pair when the baseline is unpinned', async () => {
        const { result } = await runPinAndOpen();
        act(() => {
            result.current.handleUnpinBaseline();
        });
        expect(result.current.divergence).toBeNull();
    });

    it('clears the pair when a single seed is opened from the results list', async () => {
        const { result } = await runPinAndOpen();
        act(() => {
            result.current.handleOpenSeed(509);
        });
        expect(result.current.divergence).toBeNull();
        expect(result.current.battleResult).toBe(fakeBattleResult);
    });

    it('closes the pair without dropping the pinned baseline', async () => {
        const { result } = await runPinAndOpen();
        act(() => {
            result.current.handleCloseDivergence();
        });
        expect(result.current.divergence).toBeNull();
        // Close is not unpin: the next diverging seed must open without re-running anything.
        expect(result.current.baseline).not.toBeNull();
    });

    it('reports a replay failure and shows no pair', async () => {
        const rendered = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs() }
        );
        await act(async () => {
            rendered.result.current.handleRun();
        });
        act(() => {
            rendered.result.current.handlePinBaseline();
        });
        mockRunSeededBattle.mockImplementationOnce(() => {
            throw new Error('replay exploded');
        });
        act(() => {
            rendered.result.current.handleOpenDivergence(507);
        });
        expect(rendered.result.current.divergence).toBeNull();
        expect(rendered.result.current.runError).toBe('replay exploded');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/__tests__/useSimulatorRuns.test.ts -t 'divergence playback'`
Expected: FAIL — `handleOpenDivergence` is not a function.

- [ ] **Step 3: Implement the slot**

In `src/hooks/useSimulatorRuns.ts`:

Add to the `UseSimulatorRunsResult` interface:

```ts
    /** The two fights behind one diverging seed: the pinned baseline's and the current run's,
     *  replayed under the same seed. Mutually exclusive with `battleResult` — the page shows a
     *  pair or a single fight, never both. */
    divergence: { seed: number; baseline: BattleResult; current: BattleResult } | null;
    /** Replays both configurations at `seed` and opens them as a pair. */
    handleOpenDivergence: (seed: number) => void;
    /** Closes an open pair. Distinct from unpinning — the baseline stays pinned, so the next
     *  diverging seed opens without re-running anything. */
    handleCloseDivergence: () => void;
```

Add the state beside the others:

```ts
    const [divergence, setDivergence] = useState<{
        seed: number;
        baseline: BattleResult;
        current: BattleResult;
    } | null>(null);
```

In `handleRun`, the synchronous branch: add `setDivergence(null);` immediately after `setAggregate(null);` in the `try`, and again in that branch's `catch` beside `setBattleResult(null)`.

In `handleRun`, the async `.then`: add `setDivergence(null);` immediately after the `if (result === null) return;` guard — **after**, so a cancelled run leaves the pair standing. In the `.catch`: add `setDivergence(null);` beside `setBattleResult(null)`.

In `handleOpenSeed`, inside the `try` before `setBattleResult(...)`: `setDivergence(null);` and in its `catch` as well.

`handleUnpinBaseline` becomes:

```ts
    const handleUnpinBaseline = () => {
        setBaseline(null);
        // Without a baseline there is no baseline side to show, so an open pair would be half a
        // comparison.
        setDivergence(null);
    };
```

Add the handler, beside `handleOpenSeed`:

```ts
    // Replays one seed under BOTH configurations: the pinned baseline's frozen input and the
    // input that produced the current aggregate. `getGearPiece` is threaded into both, because
    // `simulateBattle` resolves gear-derived abilities during the fight rather than reading them
    // off the input — so dropping it on one side would resolve the two fights under different
    // rules.
    const handleOpenDivergence = useCallback(
        (seed: number) => {
            if (!baseline) {
                setRunError('Pin a baseline before opening a diverging seed.');
                return;
            }
            if (!provenance) {
                setRunError('No run to replay yet.');
                return;
            }
            setRunError(null);
            try {
                const baselineResult = runSeededBattle(baseline.input, seed, getGearPiece);
                const currentResult = runSeededBattle(provenance.input, seed, getGearPiece);
                setBattleResult(null);
                setDivergence({ seed, baseline: baselineResult, current: currentResult });
            } catch (err) {
                setDivergence(null);
                setRunError(err instanceof Error ? err.message : 'Simulation failed');
            }
        },
        [baseline, provenance, getGearPiece]
    );
```

Add the closer beside it:

```ts
    const handleCloseDivergence = () => setDivergence(null);
```

Add `divergence`, `handleOpenDivergence` and `handleCloseDivergence` to the returned object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/useSimulatorRuns.test.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Mutation probe the cancel carve-out**

Move the `setDivergence(null);` in the async `.then` to **above** the `if (result === null) return;` guard. Run `npx vitest run src/hooks/__tests__/useSimulatorRuns.test.ts -t 'keeps the pair when a run is cancelled'`. Expected: FAIL. Restore the correct order and re-run; expected PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useSimulatorRuns.ts src/hooks/__tests__/useSimulatorRuns.test.ts
git commit -m "feat(simulator): replay both configurations at one diverging seed"
```

---

### Task 4: `BattlePlayback` takes an optional controlled round

**Files:**
- Modify: `src/components/simulator/BattlePlayback.tsx`
- Create: `src/components/simulator/__tests__/BattlePlayback.test.tsx`

**Interfaces:**
- Produces: `BattlePlaybackProps.round?: number`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/simulator/__tests__/BattlePlayback.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BattlePlayback from '../BattlePlayback';
import type { BattleResult } from '../../../utils/calculators/battleSimulator';

const shipState = (actorId: string, side: 'player' | 'enemy', hpPct: number) => ({
    actorId,
    side,
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    healingReceived: 0,
    shieldsAbsorbed: 0,
    shieldGranted: 0,
    currentShieldPool: 0,
    incomingDamage: 0,
    incomingShieldAbsorbed: 0,
    incomingBarrierAbsorbed: 0,
    hpPct,
    shieldPct: 0,
    alive: true,
    activeBuffs: [],
    activeDebuffs: [],
});

/** A fight of `rounds` rounds where the player's HP drops by 10 points per round, so the
 *  displayed round is readable off the board rather than off the stepper's own label. */
const battle = (rounds: number): BattleResult =>
    ({
        rounds: Array.from({ length: rounds }, (_, i) => ({
            round: i + 1,
            ships: [
                shipState('attacker', 'player', 100 - i * 10),
                shipState('e:enemy:0', 'enemy', 100),
            ],
            turnOrder: ['attacker', 'e:enemy:0'],
        })),
        outcome: { winner: 'player', lastRound: rounds },
        roster: [
            { actorId: 'attacker', side: 'player', name: 'Nova', position: 'T1' },
            { actorId: 'e:enemy:0', side: 'enemy', name: 'Hexa', position: 'T1' },
        ],
        combatLog: [],
    }) as unknown as BattleResult;

describe('BattlePlayback', () => {
    it('renders its own stepper when uncontrolled', () => {
        render(<BattlePlayback result={battle(5)} />);
        expect(screen.getByLabelText('Next round')).toBeInTheDocument();
        expect(screen.getByText('Round 1 / 5')).toBeInTheDocument();
    });

    it('shows the round it is given and renders no stepper when controlled', () => {
        render(<BattlePlayback result={battle(5)} round={3} />);
        // The parent owns the position, so a second stepper here would be a second source of
        // truth for it.
        expect(screen.queryByLabelText('Next round')).not.toBeInTheDocument();
        expect(screen.getByText('70%')).toBeInTheDocument();
    });

    it('clamps a controlled round past the end to this fight’s last round', () => {
        // The two sides of a divergence can end on different rounds; the shorter fight holds at
        // its own last round rather than blanking out.
        render(<BattlePlayback result={battle(3)} round={9} />);
        expect(screen.getByText('80%')).toBeInTheDocument();
    });
});
```

If `70%` / `80%` do not appear, open `src/utils/simulator/boardOverlays.ts` and `BattleBoard.tsx` to see how `hpPct` is rendered, and assert on that exact text instead. The assertion must read a **per-round** value, not the outcome card — an assertion that passes on any round pins nothing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/simulator/__tests__/BattlePlayback.test.tsx`
Expected: the first test PASSES (existing behaviour), the second and third FAIL — `round` is not a prop, so round 1 is displayed and the stepper is present.

- [ ] **Step 3: Implement the prop**

In `src/components/simulator/BattlePlayback.tsx`:

```tsx
interface BattlePlaybackProps {
    /** A completed simulation. Owns the round-stepper position and pinned-ship detail card. */
    result: BattleResult;
    /** Controlled round (1-based). When given, the parent owns the playback position and this
     *  component renders no stepper — two playbacks driven by one stepper is the point. A value
     *  past this fight's last round clamps to it, so a shorter fight beside a longer one holds
     *  on its final round. */
    round?: number;
}

const BattlePlayback: React.FC<BattlePlaybackProps> = ({ result, round }) => {
```

Replace the round resolution so the prop wins when present (the existing `total` and `curRound` lines):

```tsx
    const total = result.rounds.length;
    const effectiveRound = round ?? currentRound;
    const curRound = total > 0 ? result.rounds[Math.min(effectiveRound, total) - 1] : undefined;
```

Guard the stepper on being uncontrolled:

```tsx
            {curRound && round === undefined && (
                <RoundStepper
                    round={Math.min(currentRound, total)}
                    total={total}
                    onChange={setCurrentRound}
                />
            )}
```

Leave the internal `currentRound` state and its reset effect alone — uncontrolled use is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/simulator/__tests__/BattlePlayback.test.tsx src/pages/__tests__/SimulatorPage.playback.test.tsx`
Expected: PASS, both files. The page playback test is the regression check that uncontrolled behaviour did not move.

- [ ] **Step 5: Mutation probe the clamp**

Temporarily change `Math.min(effectiveRound, total)` to `effectiveRound`. Run `npx vitest run src/components/simulator/__tests__/BattlePlayback.test.tsx`. Expected: the clamp test FAILS. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/components/simulator/BattlePlayback.tsx src/components/simulator/__tests__/BattlePlayback.test.tsx
git commit -m "feat(simulator): let a parent drive a playback's round position"
```

---

### Task 5: `DivergencePlayback`

**Files:**
- Create: `src/components/simulator/DivergencePlayback.tsx`
- Create: `src/components/simulator/__tests__/DivergencePlayback.test.tsx`

**Interfaces:**
- Consumes: `BattlePlayback`'s `round` prop (Task 4).
- Produces: default export `DivergencePlayback`, props `{ seed: number; baseline: BattleResult; current: BattleResult; onClose: () => void }`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/simulator/__tests__/DivergencePlayback.test.tsx`. Copy the `shipState` and `battle` helpers from `BattlePlayback.test.tsx` verbatim into this file, with one change — `battle` takes a winner so the two sides differ:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DivergencePlayback from '../DivergencePlayback';
import type { BattleResult } from '../../../utils/calculators/battleSimulator';

const shipState = (actorId: string, side: 'player' | 'enemy', hpPct: number) => ({
    actorId,
    side,
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    healingReceived: 0,
    shieldsAbsorbed: 0,
    shieldGranted: 0,
    currentShieldPool: 0,
    incomingDamage: 0,
    incomingShieldAbsorbed: 0,
    incomingBarrierAbsorbed: 0,
    hpPct,
    shieldPct: 0,
    alive: true,
    activeBuffs: [],
    activeDebuffs: [],
});

const battle = (rounds: number, winner: 'player' | 'enemy' | 'draw'): BattleResult =>
    ({
        rounds: Array.from({ length: rounds }, (_, i) => ({
            round: i + 1,
            ships: [
                shipState('attacker', 'player', 100 - i * 10),
                shipState('e:enemy:0', 'enemy', 100),
            ],
            turnOrder: ['attacker', 'e:enemy:0'],
        })),
        outcome: { winner, lastRound: rounds },
        roster: [
            { actorId: 'attacker', side: 'player', name: 'Nova', position: 'T1' },
            { actorId: 'e:enemy:0', side: 'enemy', name: 'Hexa', position: 'T1' },
        ],
        combatLog: [],
    }) as unknown as BattleResult;

describe('DivergencePlayback', () => {
    const props = {
        seed: 507,
        baseline: battle(4, 'enemy'),
        current: battle(7, 'player'),
        onClose: vi.fn(),
    };

    it('names the seed and both outcomes', () => {
        render(<DivergencePlayback {...props} />);
        expect(screen.getByText(/Seed 507/)).toBeInTheDocument();
        expect(screen.getByText('Baseline')).toBeInTheDocument();
        expect(screen.getByText('Current')).toBeInTheDocument();
    });

    it('drives both fights from one stepper, over the longer fight’s round count', () => {
        render(<DivergencePlayback {...props} />);
        // One stepper, not one per fight — the whole point is that both sides show the same round.
        expect(screen.getAllByLabelText('Next round')).toHaveLength(1);
        expect(screen.getByText('Round 1 / 7')).toBeInTheDocument();
    });

    it('advances both fights together, and the shorter one holds at its last round', () => {
        render(<DivergencePlayback {...props} />);
        // Step to round 6: past the 4-round baseline, inside the 7-round current run.
        for (let i = 0; i < 5; i++) {
            fireEvent.click(screen.getByLabelText('Next round'));
        }
        expect(screen.getByText('Round 6 / 7')).toBeInTheDocument();
        // Baseline holds at its round 4 (70%), current shows its round 6 (50%).
        expect(screen.getByText('70%')).toBeInTheDocument();
        expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('closes', () => {
        const onClose = vi.fn();
        render(<DivergencePlayback {...props} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        expect(onClose).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/simulator/__tests__/DivergencePlayback.test.tsx`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the component**

Create `src/components/simulator/DivergencePlayback.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import type { BattleResult } from '../../utils/calculators/battleSimulator';
import { Button } from '../ui/Button';
import RoundStepper from './RoundStepper';
import BattlePlayback from './BattlePlayback';

interface DivergencePlaybackProps {
    seed: number;
    /** The pinned baseline's fight at this seed. */
    baseline: BattleResult;
    /** The current run's fight at the same seed. */
    current: BattleResult;
    onClose: () => void;
}

const winnerLabel = (result: BattleResult): string => {
    const { winner } = result.outcome;
    return winner === 'player' ? 'your team' : winner === 'enemy' ? 'the enemy' : 'a draw';
};

/**
 * One seed's two fights, stacked and stepped together. A single `RoundStepper` drives both
 * playbacks so round N of the baseline sits directly above round N of the current run, which is
 * the comparison this view exists to make. Its total is the longer fight's round count; the
 * shorter fight clamps to its own last round (see `BattlePlayback`'s `round` prop).
 *
 * Stacked rather than side by side because each `BattlePlayback` already renders two mirrored
 * boards, so two columns of them do not fit the narrowest supported width.
 */
const DivergencePlayback: React.FC<DivergencePlaybackProps> = ({
    seed,
    baseline,
    current,
    onClose,
}) => {
    const [round, setRound] = useState(1);
    const total = Math.max(baseline.rounds.length, current.rounds.length);

    // A different seed is a different pair of fights, so playback restarts.
    useEffect(() => {
        setRound(1);
    }, [seed, baseline, current]);

    return (
        <div className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h2 className="text-lg font-semibold">Seed {seed}</h2>
                    <p className="text-sm text-theme-text-secondary">
                        Baseline won by {winnerLabel(baseline)} in {baseline.outcome.lastRound}{' '}
                        rounds; the current run, {winnerLabel(current)} in{' '}
                        {current.outcome.lastRound}.
                    </p>
                </div>
                <Button variant="secondary" size="sm" onClick={onClose}>
                    Close
                </Button>
            </div>

            {total > 0 && (
                <RoundStepper round={Math.min(round, total)} total={total} onChange={setRound} />
            )}

            <div className="space-y-4">
                <section className="space-y-4">
                    <h3 className="text-base font-semibold">Baseline</h3>
                    <BattlePlayback result={baseline} round={round} />
                </section>
                <section className="space-y-4">
                    <h3 className="text-base font-semibold">Current</h3>
                    <BattlePlayback result={current} round={round} />
                </section>
            </div>
        </div>
    );
};

export default DivergencePlayback;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/simulator/__tests__/DivergencePlayback.test.tsx`
Expected: PASS.

If the "Baseline won by" sentence collides with the `getByText('Baseline')` heading query, tighten the heading assertion to `screen.getByRole('heading', { name: 'Baseline' })` rather than changing the copy.

- [ ] **Step 5: Mutation probe the shared stepper**

Temporarily change `total` to `baseline.rounds.length`. Run the file. Expected: the "over the longer fight's round count" and "advances both together" tests FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/components/simulator/DivergencePlayback.tsx src/components/simulator/__tests__/DivergencePlayback.test.tsx
git commit -m "feat(simulator): step a diverging seed's two fights together"
```

---

### Task 6: The divergence table in `RunComparison`

**Files:**
- Modify: `src/components/simulator/RunComparison.tsx`
- Test: `src/components/simulator/__tests__/RunComparison.test.tsx`

**Interfaces:**
- Consumes: `divergingSeeds` (Task 1), `pinned` test helper (Task 2).
- Produces: `RunComparison` prop `onOpenDivergence: (seed: number) => void`.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/simulator/__tests__/RunComparison.test.tsx`. Every existing `render(<RunComparison .../>)` call in the file will need the new required prop — add `onOpenDivergence={() => {}}` to each; `tsc --noEmit` names them all.

```tsx
describe('diverging seeds', () => {
    /** Same seed set, same everything, except that seed 502 flips from an enemy win to a player
     *  win and takes three rounds longer. */
    const flipOneSeed = () => {
        const base = aggregate(10, 6, 1000, 0);
        const variant = aggregate(10, 6, 1000, 0);
        variant.runs[2] = { ...variant.runs[2], winner: 'player', lastRound: 9 };
        base.runs[2] = { ...base.runs[2], winner: 'enemy', lastRound: 6 };
        return { base, variant };
    };

    it('lists only the seeds whose winner changed', () => {
        const { base, variant } = flipOneSeed();
        render(
            <RunComparison
                baseline={pinned(base)}
                current={variant}
                currentOverrides={currentOverrides}
                onOpenDivergence={() => {}}
            />
        );
        expect(screen.getByText('502')).toBeInTheDocument();
        expect(screen.getByText('6 → 9')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /open/i })).toHaveLength(1);
    });

    it('hands the seed back when a row is opened', () => {
        const { base, variant } = flipOneSeed();
        const onOpenDivergence = vi.fn();
        render(
            <RunComparison
                baseline={pinned(base)}
                current={variant}
                currentOverrides={currentOverrides}
                onOpenDivergence={onOpenDivergence}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /open/i }));
        expect(onOpenDivergence).toHaveBeenCalledWith(502);
    });

    it('says the two configurations agreed rather than showing an empty table', () => {
        const same = aggregate(10, 6, 1000, 0);
        render(
            <RunComparison
                baseline={pinned(same)}
                current={aggregate(10, 6, 1400, 0)}
                currentOverrides={currentOverrides}
                onOpenDivergence={() => {}}
            />
        );
        expect(screen.getByText(/same winner on every seed/i)).toBeInTheDocument();
    });
});
```

Add `vi` and `fireEvent` to the file's existing imports from `vitest` and `@testing-library/react`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/simulator/__tests__/RunComparison.test.tsx -t 'diverging seeds'`
Expected: FAIL — no divergence table is rendered.

- [ ] **Step 3: Implement the table**

In `src/components/simulator/RunComparison.tsx`:

Extend the imports:

```ts
import {
    diffOverrides,
    divergingSeeds,
    rostersDiffer,
    type DivergingSeed,
    type OverrideSnapshot,
    type PinnedBaseline,
} from '../../utils/simulator/compareRuns';
import { Button } from '../ui/Button';
```

Extend `Props`:

```ts
interface Props {
    baseline: PinnedBaseline;
    current: SeedSetAggregate;
    currentOverrides: OverrideSnapshot;
    /** Opens both configurations' fights at one seed. */
    onOpenDivergence: (seed: number) => void;
}
```

Add a winner label helper beside `statLabel`:

```ts
/** Winner as a player reads it, rather than the engine's side token. */
const WINNER_LABEL: Record<DivergingSeed['baselineWinner'], string> = {
    player: 'You',
    enemy: 'Enemy',
    draw: 'Draw',
};
```

Inside the existing `useMemo`, add `diverging: divergingSeeds(baseline.aggregate, current),` to the returned object. It belongs here rather than in the render body because this component re-renders on every progress tick of a run in flight.

Add the columns and table. Place the `DataTable` after the override-diff table at the end of the returned JSX:

```tsx
    const divergenceColumns: Column<DivergingSeed>[] = [
        { key: 'seed', label: 'Seed', render: (row) => row.seed },
        { key: 'baselineWinner', label: 'Baseline', render: (row) => WINNER_LABEL[row.baselineWinner] },
        { key: 'currentWinner', label: 'Current', render: (row) => WINNER_LABEL[row.currentWinner] },
        {
            key: 'rounds',
            label: 'Rounds',
            align: 'right',
            render: (row) => `${row.baselineRounds} → ${row.currentRounds}`,
        },
        {
            key: 'open',
            label: '',
            align: 'right',
            render: (row) => (
                <Button variant="secondary" size="sm" onClick={() => onOpenDivergence(row.seed)}>
                    Open
                </Button>
            ),
        },
    ];
```

```tsx
            <div className="space-y-2">
                <h3 className="text-base font-semibold">Diverging seeds</h3>
                <DataTable
                    data={deltas.diverging}
                    columns={divergenceColumns}
                    getRowKey={(row) => String(row.seed)}
                    emptyMessage="Both configurations produced the same winner on every seed."
                />
            </div>
```

- [ ] **Step 4: Fix the existing call sites the compiler names**

Run: `npx tsc --noEmit` and add `onOpenDivergence={() => {}}` to every `RunComparison` render in the test file it flags. `SimulatorPage.tsx` is wired in Task 7 — if the compiler flags it now, pass `() => {}` there temporarily and replace it in Task 7.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/simulator/__tests__/RunComparison.test.tsx`
Expected: PASS, whole file.

- [ ] **Step 6: Mutation probe the filter**

Temporarily change `divergingSeeds`' early return from `if (baselineRun.winner === currentRun.winner) return;` to `if (false) return;`. Run the RunComparison file. Expected: "lists only the seeds whose winner changed" FAILS on the button count, and "says the two configurations agreed" FAILS. Restore.

- [ ] **Step 7: Commit**

```bash
git add src/components/simulator/RunComparison.tsx src/components/simulator/__tests__/RunComparison.test.tsx
git commit -m "feat(simulator): list the seeds where a baseline and the current run disagree"
```

---

### Task 7: Wire the page, changelog and docs

**Files:**
- Modify: `src/pages/SimulatorPage.tsx`
- Modify: `src/constants/changelog.ts`
- Modify: `src/pages/DocumentationPage.tsx`
- Test: `src/pages/__tests__/SimulatorPage.test.tsx`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Wire the page**

In `src/pages/SimulatorPage.tsx`, pull the two new values out of the hook alongside `battleResult` and `aggregate`:

```ts
        divergence,
        handleOpenDivergence,
        handleCloseDivergence,
```

Pass the handler to `RunComparison`:

```tsx
                    {baseline && aggregate && currentOverrides && (
                        <RunComparison
                            baseline={baseline}
                            current={aggregate}
                            currentOverrides={currentOverrides}
                            onOpenDivergence={handleOpenDivergence}
                        />
                    )}
```

Replace the single playback line with the pair-or-single choice:

```tsx
                    {divergence ? (
                        <DivergencePlayback
                            seed={divergence.seed}
                            baseline={divergence.baseline}
                            current={divergence.current}
                            onClose={handleCloseDivergence}
                        />
                    ) : (
                        battleResult && <BattlePlayback result={battleResult} />
                    )}
```

`handleCloseDivergence` (Task 3), not `handleUnpinBaseline`: closing a pair must leave the baseline pinned, or the next diverging seed cannot be opened without re-running.

Add the import:

```ts
import DivergencePlayback from '../components/simulator/DivergencePlayback';
```

- [ ] **Step 2: Run the page and hook tests**

Run: `npx vitest run src/pages/__tests__/ src/hooks/__tests__/useSimulatorRuns.test.ts`
Expected: PASS.

- [ ] **Step 3: Add the changelog entry**

In `src/constants/changelog.ts`, add to the top of `UNRELEASED_CHANGES`:

```ts
    'Combat simulator: open both fights for a seed where a baseline and your run disagree.',
```

- [ ] **Step 4: Update the in-app documentation**

In `src/pages/DocumentationPage.tsx`, find the Combat Simulator section (search for the existing baseline/comparison copy) and add this sentence to the paragraph describing the baseline comparison, matching the surrounding markup and prose style:

> With a baseline pinned, the comparison also lists every seed where the two configurations picked a different winner. Opening one replays both fights stacked and stepped together, so the same round of each sits one above the other.

Do not add a new heading for it — it belongs in the comparison paragraph that already exists.

- [ ] **Step 5: Run the full suite and the type check**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean typecheck, whole suite green. If `.tsx` files fail to collect with `supabaseUrl is required`, the worktree is missing `.env` — copy it from the main checkout before re-running.

- [ ] **Step 6: Commit**

```bash
git add src/pages/SimulatorPage.tsx src/hooks/useSimulatorRuns.ts src/hooks/__tests__/useSimulatorRuns.test.ts src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "feat(simulator): open a diverging seed from the baseline comparison"
```

---

## Verification

Before opening a PR:

- `npx tsc --noEmit` clean
- `npx vitest run` green, whole suite
- `npm run lint` clean
- Every mutation probe in this plan performed, and each one observed to fail before being restored
