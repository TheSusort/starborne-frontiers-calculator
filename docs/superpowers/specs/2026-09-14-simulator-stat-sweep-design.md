# Simulator: sweep one stat across a range and chart the result

Issue: #507. Follow-up to #502 (stat overrides) / #503, unblocked by #516 (progress + cancel) and
informed by #508's noise verdict.

## Problem

#502 lets you ask "what would +200 speed do", but answering it is a manual loop: edit the
override, run, pin, edit, run, read two numbers. You get one point on a curve at a time — and the
interesting thing, *where the breakpoint is*, is exactly what a single A/B cannot show.

A sweep runs that loop for you: one placed ship, one of its eleven overridable stats, a range, one
seed set, a chart.

## Scope

Independent of the setup save/load work (#510). A sweep varies a built `BattleSimulationInput`,
not a serialized setup, so the two share no code and can land in either order.

## Steps

`src/utils/simulator/statSweep.ts`

```ts
interface SweepStep {
    value: number;
    /** True for the step at the target's currently resolved value. Exactly one step carries it. */
    isReference: boolean;
}

function sweepSteps(stat: OverridableStat, from: number, to: number, step: number,
                    resolved: number): SweepStep[]
```

Rules:

- `step > 0`, `from <= to`, all three finite; values are rounded to integers (stats are integers).
- Values below `OVERRIDE_MIN[stat] ?? 0` are refused — `hp` floors at 1, because an actor built at
  0 HP starts the fight on the engine's corpse path.
- **The resolved value is always a step**, inserted in order if the range excludes it. Every
  reading in this feature is relative to where the ship actually sits; without that point on the
  chart there is nothing to compare a step against, and "is this better than what I have" is the
  question the feature exists to answer.
- The step count is capped (`MAX_SWEEP_STEPS = 25`). Cost is multiplicative — 25 steps x 20 seeds
  is 500 battles — and an uncapped `step: 1` over a damage range would queue millions.

## Running

```ts
function runStatSweepAsync(
    input: BattleSimulationInput,
    target: { side: 'player' | 'enemy'; position: Position },
    stat: OverridableStat,
    steps: SweepStep[],
    baseSeed: number,
    count: number,
    options: { getGearPiece?; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }
): Promise<SweepResult | null>
```

- The input is built **once**. Each step clones only the one placement it varies — found by
  `position`, not by array index, so it cannot be knocked off by a change to `POSITION_ORDER` —
  as `{ ...placement, statOverrides: { ...placement.statOverrides, [stat]: value } }`, in a
  shallow copy of that side's array. Nothing else is rebuilt — `buildTeam` has already baked resolved stats
  into the input, so a step is "one number changed", not "re-resolve gear".
- **This deliberately bypasses `normalizeOverride`.** That helper returns `undefined` when the
  value equals the resolved base, which is correct for the override editor (storing a no-op
  override would make the badge and the configuration diff report a change that does not exist)
  and wrong here: it would silently delete the reference step, the one step the whole analysis is
  measured against.
- **Every step runs the same `baseSeed` and `count`.** Steps compared across different seed sets
  are unpaired while looking paired — the same rule `effectiveRunParams` enforces for a pinned
  baseline. The sweep owns one seed set for all its steps.
- Delegates each step to `runSeedSetAsync`, so yielding, cancellation and the "a cancelled run
  produces no partial result" contract are inherited rather than reimplemented. Progress is
  reported in battles (`step * count + completedInStep`) so the bar advances within a step, not
  only between steps.
- Aborting resolves `null`, never a partial sweep — same contract as `runSeedSetAsync`, for the
  same reason: a caller must not be able to display a result that was never produced.

`SweepResult` is `{ stat, steps: { value, isReference, aggregate }[], baseSeed, count, roster }`.

## Analysis

`src/utils/simulator/sweepAnalysis.ts`

Per step, against the reference step, reusing `pairedDelta` — which is valid here precisely
because every step ran the same seed set, so step *i* and reference *i* are the same fight under
two configurations:

| Series | `metricKind` |
| --- | --- |
| Win rate (player wins / count) | `'binary'` — per-seed value is a 0/1 indicator |
| Mean rounds | `'continuous'` |
| Player-side mean damage dealt | `'continuous'` |

Metric kind is chosen by what the metric **is**, never inferred from how a given pair of runs
landed. A win-rate row takes the exact sign test whatever its spread; a rounds row takes the
paired t rule even when every seed moved by at most one round.

Output per step and series: `{ value, delta: PairedDelta }`. The reference step's own delta
against itself is not computed — it is the origin, and `pairedDelta` of a series against itself is
a degenerate zero that would render as a "not distinguishable" marker on the one point that is by
definition the reference.

## Chart

`BaseChart` + a recharts `LineChart`, win rate as the primary series, mean rounds and player-side
damage dealt as toggleable secondaries (all already on `SeedSetAggregate`).

Player-side *total* damage, not the focus actor's alone: sweeping a support's speed is supposed to
show the team hitting harder, and a focus-only series reads that real effect as zero. The swept
ship's own figure stays available on `perActorMean` if a per-ship series is ever wanted.

Distinguishability is the point of the visual design. A win-rate curve wobbling 9/20 → 12/20 →
10/20 is a flat line with noise on it, and a line chart draws it as a trend regardless. So:

- Each step is a **marked point**. A step whose delta against the reference is `distinguishable`
  renders solid; one that is not renders hollow/muted. `chartLineDefaults` sets `dot: false`, so
  the sweep passes its own dot renderer.
- The connecting line is drawn muted — it orders the points, it does not assert a trend.
- The reference step is marked distinctly (a vertical reference line at its value) and labelled as
  the ship's current value.
- The legend/tooltip states the rule once: solid means the difference from the current value
  cleared its test at this seed count; hollow means it did not.

A sweep where every point is hollow is a real answer — this stat does not move the fight at this
seed count — and the chart must be able to say that rather than drawing a shape.

## UI

`src/components/simulator/StatSweepPanel.tsx`, collapsed by default below the run controls:

- Target: a `Select` of placed ships across both boards (labelled with side and position).
- Stat: a `Select` over `OVERRIDABLE_STATS` — the total list, so a new overridable stat appears
  here automatically.
- From / to / step `Input`s, prefilled from the target's resolved value when the target or stat
  changes (from = resolved, to = resolved + 50%, step = a round value giving ~7 steps).
- Run count, defaulting to 20 and independent of the page's own run count. A sweep's cost is
  multiplicative, so it does not inherit a setting chosen for a single run.
- A live cost preview: "7 steps x 20 seeds = 140 battles".
- Run / Cancel with the existing progress treatment.
- One line of copy: a sweep holds every other stat fixed, while real gear moves several at once —
  so a sweep answers "what would this stat be worth", not "what would this piece be worth".

`useStatSweep` (`src/hooks/useStatSweep.ts`) owns sweep state, its own `AbortController` and its
own generation ref. It writes **none** of `battleResult`, `aggregate`, `provenance`, `baseline` or
`divergence`: `handleRun`'s generation supersession would tangle with a concurrent sweep, and a
sweep is not a run whose result can be pinned or replayed. Run and Sweep disable each other while
either is in flight.

The sweep ignores any pinned baseline. `effectiveRunParams` exists to force a *variant run* onto
the baseline's seed set; a sweep is not a variant run, it owns its own seed set by construction,
and a sweep's reference is its own resolved-value step rather than whatever is pinned.

## Testing

- `sweepSteps`: ascending output, integer values, the hp floor, `step <= 0` and `from > to`
  refused, the cap enforced, and the reference value inserted in order both when the range
  contains it and when it does not.
- Step cloning is a **mutation probe**: after building a step's input, every other placement must
  be the same object it was, and the target's other stats unchanged. A probe that would pass
  against a deep clone of everything proves nothing, so assert object identity on the untouched
  placements.
- `sweepAnalysis` must be proved in **both** directions, or the solid/hollow marker is decoration:
  a fixture whose step genuinely differs reads `distinguishable`, and a coin-flip fixture reads not
  distinguishable. A test that only ever observes one verdict cannot fail if the verdict is
  hard-coded.
- A win-rate fixture that clears the t rule but fails the sign test must read not distinguishable —
  that divergence is the reason `metricKind` exists, and a test that never exercises it leaves the
  binary path unmeasured.
- Cancellation resolves `null` with no partial `SweepResult`.
- Progress reaches its total exactly once on a completed sweep, and never reports 100% on a
  cancelled one.

## Documentation and changelog

`DocumentationPage.tsx` gains a sweep section. One changelog entry, area-prefixed, 8-12 words.

## Out of scope

- Sweeping two stats (a surface, not a curve).
- Sweeping a stat on more than one ship at a time.
- Sweeping gear or sets — a sweep varies one number after every stat source, so it cannot express
  a set bonus or anything conditional (`applyStatOverrides`' contract).
