# Combat simulator: open the battle log for a diverging seed

Issue #505. Follow-up to #502/#503 (stat overrides + seeded comparison) and #508/#509 (paired
delta statistics + async runs, PR #516).

## Problem

The seed-set comparison reports *that* two configurations diverge and gives no way to see *where*.
A player pins a baseline, changes a stat override, re-runs, and reads "Player wins +3". The
question that follows — what actually happened differently in those three fights — has no answer
in the UI today.

Replaying **one** side at a seed already works: `SeedSetResults`' per-seed buttons call
`handleOpenSeed(seed)`, which replays from the current run's recorded provenance. The baseline's
side cannot be replayed at all, because `PinnedBaseline` does not retain the input that produced
it.

## Scope

In:

- Replaying a pinned baseline at any seed.
- A divergence list in `RunComparison`: the seeds where the two configurations disagree on the
  winner.
- Opening one of those seeds as two stacked playbacks driven by a single shared round stepper.

Out:

- A round-count threshold for "differs". Winner mismatch is the filter; round counts are shown on
  each row so a same-winner-but-much-longer fight is visible without a threshold that cannot be
  defended.
- A side-by-side (two-column) layout. Each `BattlePlayback` already renders two mirrored
  `BattleBoard`s, so side by side is four boards wide and would collapse to the stacked layout
  below ~900px regardless. Stacked is the layout that works at the 400px floor.
- Anything about #506/#507/#510.

## A pre-existing property this feature inherits

`BattleSimulationInput` carries resolved stat blocks, but it does **not** carry gear-derived
abilities: `simulateBattle` resolves those inside the fight, via
`planPlacement(p, …, getGearPiece)` → `buildShipAbilitiesWithEquipment(p.ship, getGearPiece)`
(`src/utils/calculators/battleSimulator.ts`). So any replay — the existing `handleOpenSeed`
included — re-resolves gear set abilities against *today's* inventory. Re-gearing a ship between
pinning a baseline and replaying it can therefore change the replayed fight.

This is not introduced here and is not fixed here. The requirement is only that the baseline
replay threads `getGearPiece` exactly as the current-side replay does, so the two sides of a
divergence are resolved under identical rules.

## Design

### 1. `PinnedBaseline` retains its input

```ts
export interface PinnedBaseline {
    aggregate: SeedSetAggregate;
    overrides: OverrideSnapshot;
    input: BattleSimulationInput;
}
```

`handlePinBaseline` sets `input` from `provenance.input` — the record `useSimulatorRuns` already
keeps for exactly this reason. It is a snapshot taken at pin time, never a live read of the boards;
that discipline is what `RunProvenance` exists to enforce, and violating it is the bug #502 fixed
(an un-run edit displayed beside the previous run's numbers).

### 2. `divergingSeeds` — the pure function

In `src/utils/simulator/compareRuns.ts`, beside `diffOverrides` and `rostersDiffer`:

```ts
export interface DivergingSeed {
    seed: number;
    baselineWinner: SeedRunSummary['winner'];
    currentWinner: SeedRunSummary['winner'];
    baselineRounds: number;
    currentRounds: number;
}

export function divergingSeeds(
    baseline: SeedSetAggregate,
    current: SeedSetAggregate
): DivergingSeed[];
```

One row per seed where `baseline.runs[i].winner !== current.runs[i].winner`, in seed-set order.
Nothing is re-run: `SeedSetAggregate.runs[]` already carries `{ seed, winner, lastRound, perActor }`
for both sides.

**Pairing guard.** Walking two `runs` arrays by index is only valid when they are the same seed set.
That check already exists inside `pairedSeries` (`deltaStats.ts`). Extract it as an exported
`assertPairedSeedSets(baseline, current)` in `deltaStats.ts`, call it from both `pairedSeries` and
`divergingSeeds`, and keep the existing behaviour exactly: it **throws**, and there is deliberately
no unpaired fallback — a fallback would render a confident comparison of something else. In
practice the throw is unreachable because `effectiveRunParams` forces a variant onto the baseline's
seed set and `handlePinBaseline` refuses while a run is in flight; that unreachability is a property
to preserve, not a reason to drop the guard.

### 3. Hook state: one divergence slot

In `useSimulatorRuns`:

```ts
divergence: { seed: number; baseline: BattleResult; current: BattleResult } | null
handleOpenDivergence: (seed: number) => void
```

`handleOpenDivergence(seed)` requires both `baseline` and `provenance`. It replays
`runSeededBattle(baseline.input, seed, getGearPiece)` and
`runSeededBattle(provenance.input, seed, getGearPiece)`, sets both into the slot, and sets
`battleResult` to `null` — the page shows a divergence pair **or** a single playback, never both.
A throw from either replay clears the slot and writes `runError`.

**Clearing is the load-bearing part.** `divergence` is cleared everywhere `battleResult` is written
or nulled, so a pair can never sit beside an aggregate it did not come from:

- the synchronous single-run branch of `handleRun`
- the async `.then` when a result lands (but **not** when a cancelled run resolves `null` — a
  cancelled run writes nothing, and that includes not clearing what is displayed)
- the async `.catch`
- `handleOpenSeed`
- `handleUnpinBaseline` (without a baseline there is no baseline side to show)

Wrapped in `useCallback` like `handleOpenSeed`, for `RunComparison`'s memoized consumers.

### 4. `BattlePlayback` takes an optional controlled round

```ts
interface BattlePlaybackProps {
    result: BattleResult;
    /** Controlled round (1-based). When given, the parent owns the position and this component
     *  renders no stepper of its own. */
    round?: number;
}
```

When `round` is supplied it replaces the internal `currentRound` and the internal `RoundStepper` is
not rendered. Uncontrolled behaviour is untouched. The existing `Math.min(currentRound, total)`
clamp already handles the two fights ending on different rounds: a 12-round baseline and an 8-round
variant both display their own last round once the shared stepper goes past 8.

### 5. `DivergencePlayback` — the new component

`src/components/simulator/DivergencePlayback.tsx`. Props: `{ seed, baseline, current, onClose }`.
Owns the shared round index. Renders:

- a header naming the seed and both winners
- one `RoundStepper` with `total = max(baseline.rounds.length, current.rounds.length)`
- a Close `Button`
- two labelled (`Baseline` / `Current`) `BattlePlayback`s stacked in that order, both passed the
  shared `round`

### 6. `RunComparison` gains the divergence table

A new `onOpenDivergence: (seed: number) => void` prop and a `DataTable` of divergence rows: seed,
baseline winner, current winner, rounds (`7 → 9`), and an Open `Button`. Rows are computed inside
the existing `useMemo` over `[baseline.aggregate, current]` — this component re-renders on every
progress tick of a run in flight.

Empty message: the two configurations agreed on every seed's winner. Not "no data" — an empty
divergence list is a result, and it is the honest reading of a change that did not move any fight's
outcome.

### 7. `SimulatorPage` wiring

Renders `DivergencePlayback` when `divergence` is set, otherwise the existing
`{battleResult && <BattlePlayback result={battleResult} />}`.

## Testing

Every guard below carries a mutation probe: revert the guard, watch the test that claims to hold it
fail, restore it.

`divergingSeeds` (unit):

- identical aggregates → `[]`
- one flipped `winner` → exactly that seed's row, with both round counts
- a seed-set mismatch → throws
- rows are in seed-set order

`useSimulatorRuns` (hook):

- `baseline.input` is unchanged after the boards are edited post-pin
- `handleOpenDivergence` populates both sides and nulls `battleResult`
- a landing run clears `divergence`; a **cancelled** run does not
- `handleUnpinBaseline` clears `divergence`

`RunComparison` (render):

- only mismatching seeds get rows
- clicking a row's Open calls `onOpenDivergence` with that seed
- agreement on every seed renders the empty message

`BattlePlayback` (render):

- given `round`, it renders that round's content and no stepper
- without `round`, the existing stepper behaviour is unchanged
- a controlled round past a shorter fight's length clamps to that fight's last round

Fixture note: hand-built `SeedSetAggregate`s are the right fixture for the pure and render tests.
Do not assume a real-battle fixture produces divergence — the stat-overrides fixture saturates to
all-draw, which is why the #503 instrument-validity probe measures mean damage rather than win
count.

## Also ships

- A `UNRELEASED_CHANGES` entry in `src/constants/changelog.ts`.
- `src/pages/DocumentationPage.tsx` updated for the new comparison surface.
