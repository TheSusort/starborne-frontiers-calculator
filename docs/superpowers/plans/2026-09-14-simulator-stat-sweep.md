# Simulator Stat Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sweep one placed ship's one stat across a range, run the same seed set at every step, and chart win rate, mean rounds and player-side damage — marking which steps are actually distinguishable from the ship's current value.

**Architecture:** The engine input is built once; each step clones only the one placement it varies and delegates its seed set to the existing `runSeedSetAsync`. Every step shares one seed set, so each step is paired against the reference step (the ship's resolved value) through the existing `pairedDelta` — binary for win rate, continuous for rounds and damage. A dedicated `useStatSweep` hook owns the sweep's state and abort controller and touches none of the ordinary run state.

**Tech Stack:** React 19 + TypeScript, recharts (via `src/components/ui/charts/`), Vitest + Testing Library, TailwindCSS.

**Spec:** `docs/superpowers/specs/2026-09-14-simulator-stat-sweep-design.md`

## Global Constraints

- **Read the spec before Task 1.** It states the rulings this plan implements.
- **UI components:** never raw `<button>`, never a hand-rolled card/modal/input. Use `Button`, `Input`, `Select` from `src/components/ui/` and the `card` CSS class. Charts come from `src/components/ui/charts/`.
- **No emojis in UI text.** Plain text plus colour classes.
- **Comments:** present-tense behaviour contracts only. No change history, no task/PR numbers, no counts or site enumerations. A comment that would need this PR to parse belongs in the commit body.
- **Changelog:** an area prefix plus 8-12 words in `UNRELEASED_CHANGES` (`src/constants/changelog.ts`), added before the commit that ships the change.
- **`docs/` is gitignored.** The spec and this plan must be added with `git add -f`.
- **Tests:** `npm test -- --run <path>` for one file. The full `npm test` includes a golden audit and is slow — run it once before opening the PR.
- **Seeding:** pin RNG with `setupKeyedRng(seed)` **alone**; calling `resetRateGateRng()` after it un-seeds. `runSeededBattle` already does both correctly — go through it, never `simulateBattle` directly.
- **Never run the Supabase CLI.** This PR touches no database.

---

### Task 1: Sweep steps

**Files:**
- Create: `src/utils/simulator/statSweep.ts`
- Test: `src/utils/simulator/__tests__/statSweep.test.ts`

**Interfaces:**
- Consumes: `OverridableStat`, `OVERRIDE_MIN` from `src/utils/simulator/statOverrides.ts`.
- Produces:
  ```ts
  export const MAX_SWEEP_STEPS = 25;
  export interface SweepStep { value: number; isReference: boolean }
  export function sweepSteps(
      stat: OverridableStat, from: number, to: number, step: number, resolved: number
  ): SweepStep[];   // throws on invalid input
  ```

- [ ] **Step 1: Write the failing test**

Create `src/utils/simulator/__tests__/statSweep.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sweepSteps, MAX_SWEEP_STEPS } from '../statSweep';

describe('sweepSteps', () => {
    it('walks the range in ascending integer steps', () => {
        expect(sweepSteps('speed', 100, 120, 5, 100).map((s) => s.value)).toEqual([
            100, 105, 110, 115, 120,
        ]);
    });

    it('marks exactly one step as the reference, at the resolved value', () => {
        const steps = sweepSteps('speed', 100, 120, 5, 110);
        expect(steps.filter((s) => s.isReference).map((s) => s.value)).toEqual([110]);
    });

    it('inserts the resolved value in order when the range excludes it', () => {
        const steps = sweepSteps('speed', 100, 120, 10, 93);
        expect(steps.map((s) => s.value)).toEqual([93, 100, 110, 120]);
        expect(steps[0].isReference).toBe(true);
    });

    it('inserts a resolved value that falls between two steps', () => {
        const steps = sweepSteps('speed', 100, 120, 10, 113);
        expect(steps.map((s) => s.value)).toEqual([100, 110, 113, 120]);
        expect(steps.find((s) => s.value === 113)?.isReference).toBe(true);
    });

    it('never emits a value below the stat floor', () => {
        // hp floors at 1: an actor built at 0 HP starts the fight on the engine's corpse path.
        expect(() => sweepSteps('hp', 0, 100, 50, 100)).toThrow(/floor|minimum/i);
    });

    it('allows 0 for a stat with no floor', () => {
        expect(sweepSteps('crit', 0, 20, 10, 10).map((s) => s.value)).toEqual([0, 10, 20]);
    });

    it('refuses a non-positive or non-finite step', () => {
        expect(() => sweepSteps('speed', 100, 120, 0, 100)).toThrow();
        expect(() => sweepSteps('speed', 100, 120, -5, 100)).toThrow();
        expect(() => sweepSteps('speed', 100, 120, NaN, 100)).toThrow();
    });

    it('refuses an inverted range', () => {
        expect(() => sweepSteps('speed', 120, 100, 5, 110)).toThrow();
    });

    it('refuses a range that would exceed the step cap', () => {
        expect(() => sweepSteps('speed', 0, 1000, 1, 100)).toThrow(
            new RegExp(String(MAX_SWEEP_STEPS))
        );
    });

    it('rejects an enormous range without iterating it', () => {
        // A number field is one keystroke from this. The cap must be computed, not discovered by
        // counting to it.
        const started = Date.now();
        expect(() => sweepSteps('speed', 0, 1_000_000_000, 1, 100)).toThrow();
        expect(Date.now() - started).toBeLessThan(100);
    });

    it('rounds fractional inputs to integers', () => {
        expect(sweepSteps('speed', 100.4, 110.6, 5.2, 100).map((s) => s.value)).toEqual([
            100, 105, 110,
        ]);
    });

    it('never emits a duplicate value when the resolved value is already a step', () => {
        const values = sweepSteps('speed', 100, 120, 10, 110).map((s) => s.value);
        expect(new Set(values).size).toBe(values.length);
    });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --run src/utils/simulator/__tests__/statSweep.test.ts`
Expected: FAIL — `Failed to resolve import "../statSweep"`.

- [ ] **Step 3: Implement**

Create `src/utils/simulator/statSweep.ts`:

```ts
import { OVERRIDE_MIN, type OverridableStat } from './statOverrides';

/** Cost is multiplicative — steps x seeds battles — so an uncapped range at `step: 1` would queue
 *  millions. */
export const MAX_SWEEP_STEPS = 25;

export interface SweepStep {
    value: number;
    /** The step at the target's currently resolved value. Exactly one step carries it: every
     *  reading in a sweep is a difference FROM where the ship actually sits. */
    isReference: boolean;
}

export function sweepSteps(
    stat: OverridableStat,
    from: number,
    to: number,
    step: number,
    resolved: number
): SweepStep[] {
    if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step)) {
        throw new Error('sweep range must be finite');
    }
    if (step <= 0) throw new Error('sweep step must be positive');

    const start = Math.round(from);
    const end = Math.round(to);
    const increment = Math.max(1, Math.round(step));
    if (start > end) throw new Error('sweep range must run from a lower value to a higher one');

    const floor = OVERRIDE_MIN[stat] ?? 0;
    if (start < floor) throw new Error(`${stat} has a floor of ${floor}`);

    // Counted BEFORE the loop: `from: 0, to: 1e9, step: 1` is one keystroke away in a number
    // field, and discovering the cap by iterating to it freezes the page first.
    const plannedSteps = Math.floor((end - start) / increment) + 1;
    if (plannedSteps > MAX_SWEEP_STEPS) {
        throw new Error(`a sweep runs at most ${MAX_SWEEP_STEPS} steps`);
    }

    const reference = Math.round(resolved);
    const values = new Set<number>();
    for (let value = start; value <= end; value += increment) values.add(value);
    if (reference >= floor) values.add(reference);

    // The reference can add one past the planned count.
    if (values.size > MAX_SWEEP_STEPS) {
        throw new Error(`a sweep runs at most ${MAX_SWEEP_STEPS} steps`);
    }

    return [...values]
        .sort((a, b) => a - b)
        .map((value) => ({ value, isReference: value === reference }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run src/utils/simulator/__tests__/statSweep.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: no errors.

```bash
git add src/utils/simulator/statSweep.ts src/utils/simulator/__tests__/statSweep.test.ts
git commit -m "feat(simulator): derive sweep steps with the resolved value always included"
```

---

### Task 2: Running a sweep

**Files:**
- Modify: `src/utils/simulator/statSweep.ts`
- Test: `src/utils/simulator/__tests__/statSweepRun.test.ts`

**Interfaces:**
- Consumes: `SweepStep` (Task 1); `runSeedSetAsync`, `SeedSetAggregate` from `./seededRuns`; `BattleSimulationInput`, `BattlePlacement` from `../calculators/battleSimulator`.
- Produces:
  ```ts
  export interface SweepTarget { side: 'player' | 'enemy'; position: Position }
  export interface SweepStepResult { value: number; isReference: boolean; aggregate: SeedSetAggregate }
  export interface SweepResult {
      stat: OverridableStat; target: SweepTarget;
      baseSeed: number; count: number; steps: SweepStepResult[];
  }
  export function stepInput(
      input: BattleSimulationInput, target: SweepTarget, stat: OverridableStat, value: number
  ): BattleSimulationInput;
  export function runStatSweepAsync(
      input: BattleSimulationInput, target: SweepTarget, stat: OverridableStat,
      steps: SweepStep[], baseSeed: number, count: number,
      options?: { getGearPiece?: (id: string) => GearPiece | undefined;
                  signal?: AbortSignal;
                  onProgress?: (completed: number, total: number) => void }
  ): Promise<SweepResult | null>;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/utils/simulator/__tests__/statSweepRun.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { stepInput, runStatSweepAsync } from '../statSweep';
import type { BattleSimulationInput, BattlePlacement } from '../../calculators/battleSimulator';
import type { Ship } from '../../../types/ship';

const placement = (id: string, position: BattlePlacement['position']): BattlePlacement => ({
    ship: { id, name: id } as unknown as Ship,
    position,
    statOverrides: { attack: 100, speed: 100, hp: 1000 },
});

const input = (): BattleSimulationInput => ({
    playerTeam: [placement('p1', 'T1'), placement('p2', 'M2')],
    enemyTeam: [placement('e1', 'T1')],
});

describe('stepInput', () => {
    it('changes only the targeted stat on the targeted placement', () => {
        const base = input();
        const stepped = stepInput(base, { side: 'player', position: 'M2' }, 'speed', 175);
        const target = stepped.playerTeam.find((p) => p.position === 'M2')!;
        expect(target.statOverrides).toEqual({ attack: 100, speed: 175, hp: 1000 });
    });

    it('leaves every other placement as the same object', () => {
        // A mutation probe: if the implementation deep-clones everything, this assertion still
        // has to hold, because "untouched" here means object identity, not deep equality.
        const base = input();
        const stepped = stepInput(base, { side: 'player', position: 'M2' }, 'speed', 175);
        expect(stepped.playerTeam.find((p) => p.position === 'T1')).toBe(base.playerTeam[0]);
        expect(stepped.enemyTeam[0]).toBe(base.enemyTeam[0]);
    });

    it('does not mutate the input it was given', () => {
        const base = input();
        stepInput(base, { side: 'player', position: 'M2' }, 'speed', 175);
        expect(base.playerTeam[1].statOverrides?.speed).toBe(100);
    });

    it('sets a value equal to the resolved base rather than dropping it', () => {
        // normalizeOverride returns undefined when value === base; a sweep must not do that, or
        // the reference step disappears.
        const base = input();
        const stepped = stepInput(base, { side: 'player', position: 'T1' }, 'speed', 100);
        expect(stepped.playerTeam[0].statOverrides?.speed).toBe(100);
    });

    it('targets the enemy side when asked', () => {
        const base = input();
        const stepped = stepInput(base, { side: 'enemy', position: 'T1' }, 'attack', 500);
        expect(stepped.enemyTeam[0].statOverrides?.attack).toBe(500);
        expect(stepped.playerTeam[0]).toBe(base.playerTeam[0]);
    });

    it('throws when the target position holds no placement', () => {
        expect(() => stepInput(input(), { side: 'player', position: 'B4' }, 'speed', 1)).toThrow();
    });
});

describe('runStatSweepAsync', () => {
    const steps = [
        { value: 100, isReference: true },
        { value: 150, isReference: false },
    ];
    const target = { side: 'player', position: 'T1' } as const;

    it('runs every step on the same seed set', async () => {
        const result = await runStatSweepAsync(input(), target, 'speed', steps, 999, 3);
        expect(result).not.toBeNull();
        expect(result!.steps).toHaveLength(2);
        for (const step of result!.steps) {
            expect(step.aggregate.baseSeed).toBe(999);
            expect(step.aggregate.count).toBe(3);
            expect(step.aggregate.runs.map((r) => r.seed)).toEqual([999, 1000, 1001]);
        }
    });

    it('reports progress in battles and reaches the total exactly once', async () => {
        const onProgress = vi.fn();
        await runStatSweepAsync(input(), target, 'speed', steps, 1, 3, { onProgress });
        const totals = onProgress.mock.calls.filter(([done, total]) => done === total);
        expect(totals).toHaveLength(1);
        expect(onProgress.mock.calls.at(-1)).toEqual([6, 6]);
    });

    it('resolves null on abort and never a partial sweep', async () => {
        const controller = new AbortController();
        const promise = runStatSweepAsync(input(), target, 'speed', steps, 1, 5, {
            signal: controller.signal,
            onProgress: () => controller.abort(),
        });
        await expect(promise).resolves.toBeNull();
    });

    it('never reports 100% on a cancelled sweep', async () => {
        const controller = new AbortController();
        const onProgress = vi.fn((done: number, total: number) => {
            if (done >= 1) controller.abort();
            void total;
        });
        await runStatSweepAsync(input(), target, 'speed', steps, 1, 5, {
            signal: controller.signal,
            onProgress,
        });
        expect(onProgress.mock.calls.some(([done, total]) => done === total)).toBe(false);
    });
});
```

The fixture placements are minimal; if `simulateBattle` rejects them (it needs a real `Ship` with skills), build the two teams with the same helper the existing `seededRuns.test.ts` uses — read that file first and reuse its fixture builder rather than inventing one. The assertions must not change.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --run src/utils/simulator/__tests__/statSweepRun.test.ts`
Expected: FAIL — `stepInput` is not exported.

- [ ] **Step 3: Implement**

Append to `src/utils/simulator/statSweep.ts`. **Merge the new imports into the existing import block at the top of the file** — `import/first` rejects an import after a declaration:

```ts
import type { Position } from '../../types/encounters';
import type { GearPiece } from '../../types/gear';
import type { BattlePlacement, BattleSimulationInput } from '../calculators/battleSimulator';
import { runSeedSetAsync, type SeedSetAggregate } from './seededRuns';

export interface SweepTarget {
    side: 'player' | 'enemy';
    position: Position;
}

export interface SweepStepResult {
    value: number;
    isReference: boolean;
    aggregate: SeedSetAggregate;
}

export interface SweepResult {
    stat: OverridableStat;
    target: SweepTarget;
    baseSeed: number;
    count: number;
    steps: SweepStepResult[];
}

/**
 * One step's engine input: the given input with a single stat changed on a single placement.
 *
 * The placement is found by `position`, not by array index, so the lookup does not depend on
 * `buildTeam`'s ordering. Every other placement is carried over as the same object — a step is
 * one number changed, not a rebuild, and `buildTeam` has already baked resolved stats in.
 *
 * A value equal to the placement's resolved base is written, not dropped. `normalizeOverride`
 * drops it (storing a no-op override would make the editor's badge report a change that does not
 * exist); here it is the reference step every other step is measured against.
 */
export function stepInput(
    input: BattleSimulationInput,
    target: SweepTarget,
    stat: OverridableStat,
    value: number
): BattleSimulationInput {
    const key = target.side === 'player' ? 'playerTeam' : 'enemyTeam';
    const team = input[key];
    const index = team.findIndex((placement) => placement.position === target.position);
    if (index < 0) {
        throw new Error(`no ${target.side} placement at ${target.position}`);
    }
    const next: BattlePlacement[] = [...team];
    const placement = team[index];
    next[index] = {
        ...placement,
        statOverrides: { ...placement.statOverrides, [stat]: value },
    };
    return { ...input, [key]: next };
}

export interface StatSweepOptions {
    getGearPiece?: (id: string) => GearPiece | undefined;
    signal?: AbortSignal;
    /** `(completedBattles, totalBattles)` — battles, not steps, so the bar advances within a
     *  step and not only between them. */
    onProgress?: (completed: number, total: number) => void;
}

/**
 * Run one seed set per step and collect the aggregates.
 *
 * Every step uses the same `baseSeed` and `count`. Steps run over different seed sets are
 * unpaired while still presenting themselves as comparable — the same rule `effectiveRunParams`
 * enforces for a pinned baseline.
 *
 * Resolves `null` when the signal aborts — never a partial sweep, for the same reason
 * `runSeedSetAsync` never returns a partial aggregate: a caller must not be able to display a
 * result that was not produced.
 */
export async function runStatSweepAsync(
    input: BattleSimulationInput,
    target: SweepTarget,
    stat: OverridableStat,
    steps: SweepStep[],
    baseSeed: number,
    count: number,
    options: StatSweepOptions = {}
): Promise<SweepResult | null> {
    const { getGearPiece, signal, onProgress } = options;
    const totalBattles = steps.length * count;
    const results: SweepStepResult[] = [];

    for (const [index, step] of steps.entries()) {
        if (signal?.aborted) return null;
        const completedBefore = index * count;
        const aggregate = await runSeedSetAsync(
            stepInput(input, target, stat, step.value),
            baseSeed,
            count,
            {
                getGearPiece,
                signal,
                onProgress: (completed) => onProgress?.(completedBefore + completed, totalBattles),
            }
        );
        if (aggregate === null) return null;
        results.push({ value: step.value, isReference: step.isReference, aggregate });
    }

    if (signal?.aborted) return null;
    return { stat, target, baseSeed, count, steps: results };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run src/utils/simulator/__tests__/statSweepRun.test.ts`
Expected: PASS, 10 tests.

If "reaches the total exactly once" fails: `runSeedSetAsync` throttles to ~100 reports per seed set, so a step's inner progress may not report every seed. The outer total is still reached exactly once, on the last step's last seed. Fix the implementation if that is not what happens; do not relax the assertion.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: no errors.

```bash
git add src/utils/simulator/statSweep.ts src/utils/simulator/__tests__/statSweepRun.test.ts
git commit -m "feat(simulator): run a seed set per sweep step on one shared seed set"
```

---

### Task 3: Sweep analysis

**Files:**
- Create: `src/utils/simulator/sweepAnalysis.ts`
- Test: `src/utils/simulator/__tests__/sweepAnalysis.test.ts`

**Interfaces:**
- Consumes: `SweepResult`, `SweepStepResult` (Task 2); `pairedDelta`, `PairedDelta` from `./deltaStats`; `SeedSetAggregate`, `SeedRunSummary` from `./seededRuns`.
- Produces:
  ```ts
  export type SweepSeries = 'winRate' | 'meanRounds' | 'playerDamage';
  export interface SweepPoint {
      value: number; isReference: boolean;
      winRate: number; meanRounds: number; playerDamage: number;
      /** Absent on the reference step: it is the origin, not a comparison. */
      deltas?: Record<SweepSeries, PairedDelta>;
  }
  export function analyseSweep(result: SweepResult): SweepPoint[];
  ```

Series definitions, so later tasks and tests agree:
- `winRate` — player wins / count, per step. Per-seed value for pairing is `1` when `run.winner === 'player'`, else `0`. Metric kind `'binary'`.
- `meanRounds` — `aggregate.meanRounds`. Per-seed value `run.lastRound`. Metric kind `'continuous'`.
- `playerDamage` — mean total damage dealt by every player-side actor. Per-seed value: sum of `run.perActor[actorId].damageDealt` over actor ids the roster marks `side === 'player'`. Metric kind `'continuous'`.

Player-side total, not the focus actor's: sweeping a support's speed is supposed to show the team hitting harder, and a focus-only series reports that real effect as zero.

- [ ] **Step 1: Write the failing test**

Create `src/utils/simulator/__tests__/sweepAnalysis.test.ts`. Build aggregates directly (no engine) so the fixtures state exactly what the analysis must read:

```ts
import { describe, it, expect } from 'vitest';
import { analyseSweep } from '../sweepAnalysis';
import type { SweepResult } from '../statSweep';
import type { SeedRunSummary, SeedSetAggregate } from '../seededRuns';

const roster = [
    { actorId: 'p:a:0', side: 'player' as const, name: 'A', position: 'T1' as const },
    { actorId: 'p:b:1', side: 'player' as const, name: 'B', position: 'M1' as const },
    { actorId: 'e:c:0', side: 'enemy' as const, name: 'C', position: 'T1' as const },
];

/** winners[i] is seed i's winner; damage[i] is EACH player actor's damage that seed. */
const aggregate = (winners: ('player' | 'enemy')[], rounds: number[], damage: number[]) => {
    const runs: SeedRunSummary[] = winners.map((winner, i) => ({
        seed: 100 + i,
        winner,
        lastRound: rounds[i],
        perActor: {
            'p:a:0': { damageDealt: damage[i], damageTaken: 0, healingDone: 0 },
            'p:b:1': { damageDealt: damage[i], damageTaken: 0, healingDone: 0 },
            'e:c:0': { damageDealt: 999, damageTaken: 0, healingDone: 0 },
        },
    }));
    const wins = { player: 0, enemy: 0, draw: 0 };
    for (const run of runs) wins[run.winner]++;
    return {
        baseSeed: 100,
        count: runs.length,
        roster,
        runs,
        wins,
        meanRounds: rounds.reduce((a, b) => a + b, 0) / rounds.length,
        medianRounds: 0,
        perActorMean: {},
    } as SeedSetAggregate;
};

const sweep = (steps: { value: number; isReference: boolean; aggregate: SeedSetAggregate }[]) =>
    ({ stat: 'speed', target: { side: 'player', position: 'T1' }, baseSeed: 100, count: steps[0].aggregate.count, steps }) as SweepResult;

const W = 'player' as const;
const L = 'enemy' as const;

describe('analyseSweep', () => {
    it('sums player-side damage across actors and excludes the enemy', () => {
        const points = analyseSweep(
            sweep([{ value: 100, isReference: true, aggregate: aggregate([W, W], [5, 5], [10, 20]) }])
        );
        // Two player actors at 10 and 20 per seed -> 20 and 40 per seed -> mean 30.
        expect(points[0].playerDamage).toBe(30);
    });

    it('reports win rate as player wins over the seed count', () => {
        const points = analyseSweep(
            sweep([{ value: 100, isReference: true, aggregate: aggregate([W, L, W, W], [5, 5, 5, 5], [1, 1, 1, 1]) }])
        );
        expect(points[0].winRate).toBe(0.75);
    });

    it('gives the reference step no deltas', () => {
        const points = analyseSweep(
            sweep([{ value: 100, isReference: true, aggregate: aggregate([W, L], [5, 6], [1, 2]) }])
        );
        expect(points[0].deltas).toBeUndefined();
    });

    it('calls a real difference distinguishable', () => {
        // The per-seed DIFFERENCES must vary. All-identical differences give se = 0, and then the
        // verdict turns on how pairedDelta handles mean/0 rather than on the rule being tested.
        const spread = (a: number, b: number) => Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b));
        const base = aggregate(Array(12).fill(L), spread(10, 11), spread(100, 120));
        const better = aggregate(Array(12).fill(W), spread(4, 6), spread(900, 860));
        const points = analyseSweep(
            sweep([
                { value: 100, isReference: true, aggregate: base },
                { value: 200, isReference: false, aggregate: better },
            ])
        );
        expect(points[1].deltas!.winRate.distinguishable).toBe(true);
        expect(points[1].deltas!.meanRounds.distinguishable).toBe(true);
        expect(points[1].deltas!.playerDamage.distinguishable).toBe(true);
    });

    it('calls a coin flip not distinguishable', () => {
        const base = aggregate(
            [W, L, W, L, W, L, W, L, W, L, W, L],
            [10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11],
            [100, 110, 100, 110, 100, 110, 100, 110, 100, 110, 100, 110]
        );
        const same = aggregate(
            [L, W, W, L, L, W, W, L, W, L, L, W],
            [11, 10, 10, 11, 11, 10, 10, 11, 10, 11, 11, 10],
            [110, 100, 100, 110, 110, 100, 100, 110, 100, 110, 110, 100]
        );
        const points = analyseSweep(
            sweep([
                { value: 100, isReference: true, aggregate: base },
                { value: 200, isReference: false, aggregate: same },
            ])
        );
        expect(points[1].deltas!.winRate.distinguishable).toBe(false);
    });

    it('uses the sign test for win rate, not the t rule', () => {
        // Four seeds of twelve flip to a win, all in the same direction, the rest unchanged.
        // The paired t rule clears on this; the exact sign test rates it a coin flip. If win rate
        // is ever routed through the continuous path, this test fails.
        const base = aggregate(
            [L, L, L, L, W, W, W, W, W, W, W, W],
            Array(12).fill(10),
            Array(12).fill(100)
        );
        const flipped = aggregate(
            [W, W, W, W, W, W, W, W, W, W, W, W],
            Array(12).fill(10),
            Array(12).fill(100)
        );
        const points = analyseSweep(
            sweep([
                { value: 100, isReference: true, aggregate: base },
                { value: 200, isReference: false, aggregate: flipped },
            ])
        );
        expect(points[1].deltas!.winRate.distinguishable).toBe(false);
    });
});
```

Before implementing, run the "sign test, not the t rule" fixture's numbers through `deltaStats`' own tests to confirm the fixture really does separate the two rules at this size — `src/utils/simulator/__tests__/deltaStats.test.ts` already exercises that divergence, so copy its flip count rather than guessing. A fixture where both rules agree makes this test vacuous: it would pass against an implementation that routes win rate through the continuous path, which is exactly the bug it exists to catch.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --run src/utils/simulator/__tests__/sweepAnalysis.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/utils/simulator/sweepAnalysis.ts`:

```ts
import { pairedDelta, type PairedDelta } from './deltaStats';
import type { SeedSetAggregate } from './seededRuns';
import type { SweepResult } from './statSweep';

export type SweepSeries = 'winRate' | 'meanRounds' | 'playerDamage';

export interface SweepPoint {
    value: number;
    isReference: boolean;
    winRate: number;
    meanRounds: number;
    playerDamage: number;
    /** Absent on the reference step: it is the origin every other step is measured from, and a
     *  series compared against itself is a degenerate zero that would render as a verdict. */
    deltas?: Record<SweepSeries, PairedDelta>;
}

/** Total damage dealt by the player side in one seed, summed across its actors. Sweeping a
 *  support's speed is meant to show the TEAM hitting harder; a focus-only figure reports that as
 *  zero. */
const playerDamagePerSeed = (aggregate: SeedSetAggregate): number[] => {
    const playerActorIds = aggregate.roster
        .filter((entry) => entry.side === 'player')
        .map((entry) => entry.actorId);
    return aggregate.runs.map((run) =>
        playerActorIds.reduce((total, actorId) => total + (run.perActor[actorId]?.damageDealt ?? 0), 0)
    );
};

const winIndicatorPerSeed = (aggregate: SeedSetAggregate): number[] =>
    aggregate.runs.map((run) => (run.winner === 'player' ? 1 : 0));

const roundsPerSeed = (aggregate: SeedSetAggregate): number[] =>
    aggregate.runs.map((run) => run.lastRound);

const mean = (values: number[]): number =>
    values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Collapse a sweep into plottable points, each tested against the reference step.
 *
 * Pairing is valid because every step ran the SAME seed set, so seed *i* of a step and seed *i*
 * of the reference are the same fight under two configurations.
 *
 * The metric kind is a property of the metric, never inferred from how a particular pair of runs
 * landed: a win/draw indicator takes the exact sign test whatever its spread, and rounds take the
 * paired t rule even when every seed moved by at most one round.
 */
export function analyseSweep(result: SweepResult): SweepPoint[] {
    const reference = result.steps.find((step) => step.isReference);

    return result.steps.map((step) => {
        const wins = winIndicatorPerSeed(step.aggregate);
        const rounds = roundsPerSeed(step.aggregate);
        const damage = playerDamagePerSeed(step.aggregate);

        const point: SweepPoint = {
            value: step.value,
            isReference: step.isReference,
            winRate: mean(wins),
            meanRounds: mean(rounds),
            playerDamage: mean(damage),
        };

        if (!reference || step.isReference) return point;

        point.deltas = {
            winRate: pairedDelta(winIndicatorPerSeed(reference.aggregate), wins, 'binary'),
            meanRounds: pairedDelta(roundsPerSeed(reference.aggregate), rounds, 'continuous'),
            playerDamage: pairedDelta(playerDamagePerSeed(reference.aggregate), damage, 'continuous'),
        };
        return point;
    });
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run src/utils/simulator/__tests__/sweepAnalysis.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: no errors.

```bash
git add src/utils/simulator/sweepAnalysis.ts src/utils/simulator/__tests__/sweepAnalysis.test.ts
git commit -m "feat(simulator): test every sweep step against the ship's current value"
```

---

### Task 4: The sweep hook

**Files:**
- Create: `src/hooks/useStatSweep.ts`
- Test: `src/hooks/__tests__/useStatSweep.test.ts`

**Interfaces:**
- Consumes: `runStatSweepAsync`, `sweepSteps`, `SweepResult`, `SweepTarget` (Tasks 1-2); `analyseSweep`, `SweepPoint` (Task 3).
- Produces:
  ```ts
  export interface UseStatSweepArgs {
      buildInput: () => BattleSimulationInput;
      getGearPiece?: (id: string) => GearPiece | undefined;
  }
  export interface RunSweepArgs {
      target: SweepTarget; stat: OverridableStat;
      from: number; to: number; step: number; resolved: number;
      baseSeed: number; count: number;
  }
  export interface UseStatSweepResult {
      points: SweepPoint[] | null;
      stat: OverridableStat | null;
      isSweeping: boolean;
      progress: { completed: number; total: number } | null;
      error: string | null;
      runSweep: (args: RunSweepArgs) => void;
      cancelSweep: () => void;
      clearSweep: () => void;
  }
  export function useStatSweep(args: UseStatSweepArgs): UseStatSweepResult;
  ```

The hook writes none of `battleResult`, `aggregate`, `provenance`, `baseline` or `divergence`. `useSimulatorRuns`' generation ref supersedes runs, and a sweep sharing that machinery would let either cancel the other's result. It also ignores any pinned baseline: a sweep owns its seed set by construction and its reference is its own resolved-value step.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/__tests__/useStatSweep.test.ts`. Reuse Task 2's fixture builder for `buildInput` (import it or copy it verbatim — the two must describe the same board):

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useStatSweep } from '../useStatSweep';
import type { BattleSimulationInput, BattlePlacement } from '../../utils/calculators/battleSimulator';
import type { Ship } from '../../types/ship';

const placement = (id: string, position: BattlePlacement['position']): BattlePlacement => ({
    ship: { id, name: id } as unknown as Ship,
    position,
    statOverrides: { attack: 100, speed: 100, hp: 1000 },
});

const buildInput = (): BattleSimulationInput => ({
    playerTeam: [placement('p1', 'T1'), placement('p2', 'M2')],
    enemyTeam: [placement('e1', 'T1')],
});

const args = {
    target: { side: 'player', position: 'T1' } as const,
    stat: 'speed' as const,
    from: 100,
    to: 120,
    step: 10,
    resolved: 100,
    baseSeed: 7,
    count: 2,
};

// Captures the AbortSignal the hook hands to the sweep runner, so the unmount test can observe
// cleanup directly rather than inferring it.
let lastSignal: AbortSignal | undefined;
const capturedSignal = () => lastSignal;

vi.mock('../../utils/simulator/statSweep', async () => {
    const actual = await vi.importActual<typeof import('../../utils/simulator/statSweep')>(
        '../../utils/simulator/statSweep'
    );
    return {
        ...actual,
        runStatSweepAsync: (...callArgs: Parameters<typeof actual.runStatSweepAsync>) => {
            lastSignal = callArgs[6]?.signal;
            return actual.runStatSweepAsync(...callArgs);
        },
    };
});

describe('useStatSweep', () => {
    it('populates one point per step', async () => {
        const { result } = renderHook(() => useStatSweep({ buildInput }));
        act(() => result.current.runSweep(args));
        await waitFor(() => expect(result.current.isSweeping).toBe(false));
        expect(result.current.points?.map((p) => p.value)).toEqual([100, 110, 120]);
        expect(result.current.stat).toBe('speed');
        expect(result.current.error).toBeNull();
    });

    it('reports an invalid range as an error instead of throwing', async () => {
        const { result } = renderHook(() => useStatSweep({ buildInput }));
        act(() => result.current.runSweep({ ...args, step: 0 }));
        expect(result.current.error).toMatch(/step/i);
        expect(result.current.points).toBeNull();
        expect(result.current.isSweeping).toBe(false);
    });

    it('is sweeping while a sweep is in flight and not after', async () => {
        const { result } = renderHook(() => useStatSweep({ buildInput }));
        act(() => result.current.runSweep(args));
        expect(result.current.isSweeping).toBe(true);
        await waitFor(() => expect(result.current.isSweeping).toBe(false));
    });

    it('leaves the previous points in place when a sweep is cancelled', async () => {
        const { result } = renderHook(() => useStatSweep({ buildInput }));
        act(() => result.current.runSweep(args));
        await waitFor(() => expect(result.current.points).not.toBeNull());
        const first = result.current.points;

        act(() => result.current.runSweep({ ...args, to: 200, step: 10 }));
        act(() => result.current.cancelSweep());
        await waitFor(() => expect(result.current.isSweeping).toBe(false));
        // A cancelled sweep produced nothing, so it must not blank the result being read.
        expect(result.current.points).toBe(first);
    });

    it('aborts the sweep in flight when it unmounts', async () => {
        // React no longer warns about a post-unmount state write, so a console.error spy here
        // would pass whether or not the hook cleans up. Observe the signal directly instead.
        const { result, unmount } = renderHook(() => useStatSweep({ buildInput }));
        act(() => result.current.runSweep({ ...args, to: 200, step: 10, count: 5 }));
        const signal = capturedSignal();
        expect(signal?.aborted).toBe(false);
        unmount();
        expect(signal?.aborted).toBe(true);
    });

    it('clears every field', async () => {
        const { result } = renderHook(() => useStatSweep({ buildInput }));
        act(() => result.current.runSweep(args));
        await waitFor(() => expect(result.current.points).not.toBeNull());
        act(() => result.current.clearSweep());
        expect(result.current.points).toBeNull();
        expect(result.current.stat).toBeNull();
        expect(result.current.error).toBeNull();
        expect(result.current.progress).toBeNull();
    });
});
```

If the minimal placements above do not survive `simulateBattle`, swap in the fixture builder `src/utils/simulator/__tests__/seededRuns.test.ts` uses — the assertions stay as written.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --run src/hooks/__tests__/useStatSweep.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/hooks/useStatSweep.ts`. Mirror `useSimulatorRuns`' concurrency handling exactly, because the same hazards apply:

- An `abortRef` holding the current `AbortController`, aborted at the start of every `runSweep` and on unmount.
- A `generationRef` bumped at the start of every `runSweep` and on unmount; every `.then`/`.catch` checks `generation === generationRef.current` before writing state.
- `sweepSteps` is called inside a `try`/`catch` in `runSweep`; a range error sets `error` and returns.
- A `null` resolution (cancelled) clears `isSweeping`/`progress` and writes nothing else.
- `runSweep` stores `analyseSweep(result)` in `points`, not the raw `SweepResult`.
- **`runSweep` does not clear `points` when it starts.** A cancelled sweep produced nothing, so
  blanking the previous result on start would destroy a result the user is still reading whenever
  they cancel. `points` is replaced only when a sweep completes, or by `clearSweep`.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run src/hooks/__tests__/useStatSweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: no errors.

```bash
git add src/hooks/useStatSweep.ts src/hooks/__tests__/useStatSweep.test.ts
git commit -m "feat(simulator): own sweep state separately from the run state"
```

---

### Task 5: The sweep panel, chart, and page wiring

**Files:**
- Create: `src/components/simulator/StatSweepPanel.tsx`
- Create: `src/components/simulator/StatSweepChart.tsx`
- Create: `src/components/simulator/__tests__/StatSweepPanel.test.tsx`
- Create: `src/components/simulator/__tests__/StatSweepChart.test.tsx`
- Modify: `src/pages/SimulatorPage.tsx`
- Modify: `src/pages/DocumentationPage.tsx`
- Modify: `src/constants/changelog.ts`

**Interfaces:**
- Consumes: `useStatSweep` (Task 4), `SweepPoint` (Task 3), `OVERRIDABLE_STATS`, `combatStatsFromShip`/`shipFinalStats` (for the resolved value), the chart primitives in `src/components/ui/charts/`.
- Produces: nothing other consumers rely on.

- [ ] **Step 1: Write the failing chart test**

Create `src/components/simulator/__tests__/StatSweepChart.test.tsx`. recharts does not lay out in jsdom, so assert on what the component computes rather than on rendered geometry: give it points where one step is `distinguishable` and one is not, and assert the component marks them differently (a `data-testid` per point carrying `data-distinguishable`), that the reference step is marked, and that a legend explains the solid/hollow rule. Look at `src/components/ui/charts/` consumers elsewhere in the app for how they test around recharts before choosing the assertion surface.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --run src/components/simulator/__tests__/StatSweepChart.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the chart**

Create `src/components/simulator/StatSweepChart.tsx`:

- `BaseChart` wrapping a recharts `LineChart` over `SweepPoint[]`, x-axis the swept value.
- One visible series at a time, chosen by the caller: win rate (as a percentage), mean rounds, or player-side damage.
- `chartLineDefaults` sets `dot: false`; pass a custom `dot` renderer instead. A point whose `deltas[series].distinguishable` is true renders filled; one that is false renders hollow/muted. The reference point renders in its own style and gets a `ReferenceLine` at its x value labelled as the ship's current value.
- The connecting line is drawn muted — it orders the points, it does not assert a trend.
- `ChartLegend` states the rule once: a filled point's difference from the current value cleared its test at this seed count; a hollow one's did not.
- Use `CHART_LINE_COLORS` and `LINE_CHART_MARGIN`.

A sweep where every point is hollow is a real answer — this stat does not move the fight at this seed count — and the chart must be able to say that rather than drawing a shape.

- [ ] **Step 4: Run the chart test to confirm it passes**

Run: `npm test -- --run src/components/simulator/__tests__/StatSweepChart.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing panel test**

Create `src/components/simulator/__tests__/StatSweepPanel.test.tsx`, asserting:

```
- the target Select lists every placed ship on both boards, labelled with side and position
- the stat Select offers every entry of OVERRIDABLE_STATS
- from/to/step prefill from the selected target's resolved value, and re-prefill when the
  target or stat changes
- the cost preview reads "<steps> steps x <count> seeds = <n> battles" and updates with the
  inputs
- Run is disabled when no target is selected
- while sweeping, Run is replaced by Cancel and progress is announced in an aria-live region
- an invalid range shows the hook's error and runs nothing
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npm test -- --run src/components/simulator/__tests__/StatSweepPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 7: Build the panel**

Create `src/components/simulator/StatSweepPanel.tsx`, inside the `card` class, collapsed by default:

- Target `Select` over both boards' placements.
- Stat `Select` over `OVERRIDABLE_STATS` — the total list, so a new overridable stat appears here with no change.
- `Input`s for from / to / step, prefilled when the target or stat changes: from = the resolved value, to = resolved + 50%, step = a round value giving roughly seven steps.
- An `Input` for the sweep's own run count, default 20, independent of the page's run count: a sweep's cost is multiplicative and must not inherit a number chosen for a single run.
- A live cost preview, and a soft warning in `text-amber-400` past 300 battles.
- Run / Cancel `Button`s and the progress treatment `SeedRunControls` uses (an unconditionally-mounted `aria-live="polite"` span that is empty until there is progress — a screen reader announces a live region inconsistently when the region and its first text arrive in the same mutation).
- One line of copy: a sweep holds every other stat fixed, while real gear moves several at once — so it answers what the stat is worth, not what a piece is worth.
- Series toggle (win rate / mean rounds / player damage) driving `StatSweepChart`.

The resolved value for prefill comes from the placement the same way `StatOverrideModal` gets it — read that component and reuse its derivation rather than recomputing `combatStatsFromShip` differently here.

- [ ] **Step 8: Run the panel test to confirm it passes**

Run: `npm test -- --run src/components/simulator/__tests__/StatSweepPanel.test.tsx`
Expected: PASS.

- [ ] **Step 9: Wire into `SimulatorPage`**

- **Lift `buildInput` out of `useSimulatorRuns`.** It is currently a closure inside that hook, so
  the page cannot hand the same function to the sweep without duplicating it — and two copies of
  "how an engine input is built" will drift the moment one grows a field. Either return
  `buildInput` from `useSimulatorRuns` or move it to a shared helper both hooks call, and have
  `useSimulatorRuns` use that same helper. A duplicate is not acceptable here.
- Mount `StatSweepPanel` below the run controls, passing both boards, `statsDeps`, `getGearPiece` and that shared `buildInput`.
- Disable the page's Run while a sweep is in flight, and the panel's Run while a normal run is in flight. Pass each hook's `isRunning`/`isSweeping` to the other's control.
- The sweep's base seed is **the seed the user can see** in `SeedRunControls`. Check whether that
  control is bound to the page's `seed` or to `effectiveSeed` while a baseline is pinned, and pass
  whichever one it displays — a sweep run on a seed the user cannot see is unreproducible. The
  sweep still owns its own run count, and its reference is its own resolved-value step rather than
  any pinned baseline.

- [ ] **Step 10: Verify**

Run: `npm test -- --run src/components/simulator src/hooks/__tests__/useStatSweep.test.ts src/utils/simulator`
Expected: PASS.

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Run `npm start` (port 3000, not `run dev`). Place a team on both sides, sweep a damage dealer's attack from its resolved value upward, and confirm: the chart draws, the reference line sits at the current value, hollow points appear where the fight barely moves, and Cancel stops a long sweep promptly.

- [ ] **Step 11: Documentation and changelog**

In `src/pages/DocumentationPage.tsx`, add a sweep section to the simulator docs: what a sweep varies, that every step runs the same seeds, what a hollow point means, and that a sweep holds every other stat fixed while real gear moves several at once.

In `src/constants/changelog.ts`, add to `UNRELEASED_CHANGES` — an area prefix plus 8-12 words:

```
'Combat simulator: sweep one stat across a range and chart it.',
'Combat simulator: sweep points show which differences beat the noise.',
```

- [ ] **Step 12: Full test run and commit**

Run: `npm test -- --run`
Expected: PASS.

```bash
git add src/components/simulator/StatSweepPanel.tsx src/components/simulator/StatSweepChart.tsx \
        src/components/simulator/__tests__/StatSweepPanel.test.tsx \
        src/components/simulator/__tests__/StatSweepChart.test.tsx \
        src/pages/SimulatorPage.tsx src/pages/DocumentationPage.tsx src/constants/changelog.ts
git add -f docs/superpowers/specs/2026-09-14-simulator-stat-sweep-design.md \
           docs/superpowers/plans/2026-09-14-simulator-stat-sweep.md
git commit -m "feat(simulator): sweep one stat across a range and chart the result"
```

---

## Definition of done

- `npm test -- --run`, `npx tsc --noEmit` and `npm run lint` all clean.
- Every step of a sweep runs the same seed set, and the ship's resolved value is always one of the steps.
- A step that is not distinguishable from the current value renders differently from one that is, and win rate is judged by the sign test rather than the t rule.
- A cancelled sweep produces no partial result and never reports 100%.
- A sweep in flight cannot land its result onto boards that changed under it, and cannot disturb the ordinary run's result, baseline or provenance.
