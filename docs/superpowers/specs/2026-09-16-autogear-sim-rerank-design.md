# Autogear: simulate and compare candidate builds (#498)

Date: 2026-09-16
Issue: #498

## Problem

Autogear scores a build with a cheap proxy — a role formula, or a custom formula (#494). The
proxy exists because the optimizer evaluates on the order of 10^5 candidates and the combat sim
cannot run that often. For some ships the proxy cannot be right *in principle*:

- **The objective can be bimodal.** Xcellence's refit passive deals damage equal to 115% of his
  current shield *when an enemy resists a debuff infliction*. High hacking suppresses that channel
  and plays him as a controller; low hacking manufactures resists and plays him as an HP bruiser.
  Both are real builds. A formula reports whichever optimum its weights sit nearer, with one
  confident number.
- **The objective is not ship-local.** That resist channel is fed by debuffs *his teammates* fail
  to land. `customFormulaScore(stats, formula)` takes one ship's stats; no coefficients over that
  input can express "how much hacking my debuffers have". The limit is the proxy's *shape*, not
  its tuning.
- **The objective is not opponent-independent.** Proc rate depends on enemy security and affinity,
  so "best build for Xcellence" is undefined without naming a fight.

The combat sim has none of these problems, because it does not need to *know* any of it — it
plays the fight.

## Measured evidence

Spiked against the real engine before committing to the design: Xcellence built from his verbatim
`docs/ship-skills.csv` text at 2 refits (so the R2 passive with the on-resist channel is the
active one), at `M4` with two plain allies against three plain enemies, 12–20 seeds per point,
attack held at 5,000 throughout. One variable moved at a time.

**Hacking is a cliff, and above it is inert** (HP fixed at 56k, enemy security 100):

| hacking | 60 | 100 | 140 | 180 | 220 | 260 | 300 | 400 | 480 | 600 |
|---|---|---|---|---|---|---|---|---|---|---|
| focus damage | 167,571 | 167,571 | 174,119 | 132,412 | 77,955 | 77,955 | 77,955 | 77,955 | 77,955 | 77,955 |
| mean rounds | 4.8 | 4.8 | 5.3 | 7.9 | 9.9 | 9.9 | 9.9 | 9.9 | 9.9 | 9.9 |

The whole transition sits between 140 and 220. Past 220 the stat does nothing at all — identical
to the unit across every seed.

**HP is worth a lot, or nothing, depending on a different stat:**

| max HP | 30,000 | 42,000 | 56,000 | 72,000 | 90,000 | 110,000 |
|---|---|---|---|---|---|---|
| focus damage @ hacking 140 | 126,154 | 158,423 | 174,119 | 195,024 | 224,248 | 233,097 |
| focus damage @ hacking 480 | 77,955 | 77,955 | 77,955 | 77,955 | 77,955 | 77,955 |

At low hacking, HP nearly doubles his damage. At high hacking it is perfectly inert. This is not a
weighting a formula got wrong — it is a conditional, and `customFormulaScore(stats, formula)` has
no term that can hold it.

**The same build is twice as good against a different opponent** (hacking 300, HP 56k):

| enemy security | 50 | 100 | 200 | 400 | 800 | 1600 |
|---|---|---|---|---|---|---|
| focus damage | 77,955 | 77,955 | 77,955 | 167,571 | 167,571 | 167,571 |

"Best build for Xcellence" is undefined without naming the fight.

**And the role formula picks the wrong side of the cliff.** `DEBUFFER` seeds as
`core('hacking') × core('directDamage')` (`customFormulaSeeds.ts:45`), so the optimizer drives
hacking up — into the ≥220 regime, where hacking buys nothing, HP buys nothing, and his damage is
2.2× worse than the low-hacking build over a fight that lasts twice as long.

Caveat on the sharpness: every enemy in the fixture carries the same security, so the resist rate
is one number and outcomes cluster hard at each regime. A real fight with mixed enemies will show
a softer transition. The *existence* of the cliff, the conditional, and the opponent-dependence do
not depend on that.

## What this is

**A comparison tool, not an oracle.** After the optimizer finishes, the player can run a handful
of candidate builds through the combat sim over a pinned seed set and read a table of paired
outcome deltas against the build the ship currently wears. The formula stays the cheap way to
*find* good candidates; the sim reports how they actually play.

Explicitly **not** an auto-derived custom role. Sweeping formula candidates → autogear each → sim
→ fit weights is a surrogate-calibration loop: expensive (autogear is CPU-bound and main-thread),
it produces one answer for objectives that are sometimes bimodal, and it still cannot see the
team.

## Architecture

One adapter, one code path. Every fight source produces the same shape, and the sim call does not
know which source it came from:

```
fight source ──→ { playerBoard, enemyBoard, playerSquadLeader?, enemySquadLeader? }
                     │
candidate ──────────→ substitute ship.equipment in the focus placement
                     │
                     ├─→ buildTeam(board, deps)  →  BattlePlacement[]
                     │
                     └─→ runSeedSetAsync(input, seed, count, { getGearPiece, signal, onProgress })
                             │
                             └─→ SeedSetAggregate
                                     │
                                     └─→ deltaStats vs the baseline aggregate, per metric
```

Nothing new is needed in the engine or in `seededRuns`/`deltaStats`; both already do exactly this
for the simulator page. Passing a `Ship` whose `equipment` is the candidate's gives both the right
stats (via `combatStatsFromShip` inside `buildTeam`) and the right gear-set abilities (via
`buildShipAbilitiesWithEquipment`, which `simulateBattle` calls with `getGearPiece`). A candidate
must therefore be expressed as a ship with substituted equipment, never as a baked stat block —
baking drops gear abilities.

### §1 Fight sources

Three, presented in one dropdown. Only the third is a real fight on both sides, and the UI says
so — the issue's whole thesis is that the team-and-opponent-aware answer is the point, so a
practice fight must not be dressed up as one.

| Source | Player side | Enemy side | Leaders |
|---|---|---|---|
| **Practice fight** (default) | focus + generic allies | generic enemies | none |
| **Saved encounter** | the encounter's real formation | generic enemies | none |
| **Saved simulator setup** | setup's `playerBoard` | setup's `enemyBoard` | setup's |

- A `LocalEncounterNote.formation` is the **player's own** ships (it feeds the autogear gear queue
  via `formationToShipIds`, and `AutogearTeamsModal` consumes it). One side, no enemy, no leader —
  hence the generic enemy.
- A `SimulatorSetup` (`src/utils/simulator/simulatorSetup.ts`, schema in
  `src/schemas/simulatorSetup.ts`) stores both boards as `{ shipId, overrides }`, plus both squad
  leaders, `seed` and `runCount`. Ship **IDs**, not baked snapshots, so it resolves against the
  live fleet.
- The dropdown lists only sources whose player side contains the ship being geared. A source
  whose ships no longer resolve is listed as unavailable with its missing count, not hidden.
- A saved setup's own `seed` and `runCount` seed the controls when it is selected. The user can
  still change them.

### §2 The practice board

**One fixture for every role.** The role picks the primary metric and nothing else — not the board
shape, not the enemy. A focus-alone board would make the DEBUFFER primary ("team damage dealt")
identical to focus damage — vacuous by construction; and a per-role enemy stat block would be four
sets of invented constants to justify, each one a lever on the answer.

- Player side: the focus ship at `M4`, plus two generic allies.
- Enemy side: three generic enemies.
- Generic combatants follow the `sweepBoardFixture` pattern — a real `Ship` with minimal skill
  text (`This Unit deals <unit-damage>100% damage</unit-damage>.`) so the engine has something to
  cast. A ship with no skill text resolves to zero abilities and every fight is a 0-damage draw.
- Enemy stats start from `DEFAULT_ENEMY_HP` / `_DEFENCE` / `_SECURITY` / `_SPEED`
  (`healingDefaultEnemy.ts`), so the practice enemy and the healing calculator's practice target
  cannot drift into two different numbers.
- Allies wound naturally under enemy fire, which is what gives a SUPPORTER's healing metric
  something to measure. No `__testTapActors` — that is test-only and mutates the live roster.

The practice fight answers "does this build beat what I wear, against a generic opponent". It
does **not** answer the team-aware question. The UI states this next to the source.

### §3 Candidate pool

**Baseline: the build the ship currently wears.** This makes the headline question "does
autogear's answer actually beat what I have?", which is answerable even when every runner-up is
useless.

**Candidates:**

1. Autogear's returned best.
2. Distinct runners-up from `GeneticStrategy`'s final population, subject to all of:
   - `violation === 0` (a hard-requirement violator is not a build the user asked for),
   - deduped by equipment ID-set (a converged GA's top N are near-copies; without this the table
     is N identical rows),
   - from the final population of the attempt that produced the returned best — Genetic runs 1–5
     attempts and only that attempt's population is commensurate with the result.

**Contract change.** A new optional field:

```ts
export interface AutogearResult {
    suggestions: GearSuggestion[];
    hardRequirementsMet: boolean;
    violations?: HardRequirementViolation[];
    attempts: number;
    /** Distinct runner-up loadouts, best-first, excluding `suggestions` itself. Populated only by
     *  GeneticStrategy; absent means the strategy exposes no ranked pool. */
    candidates?: GearSuggestion[][];
}
```

Optional and Genetic-only, so `TwoPassStrategy`, `SetFirstStrategy` and every existing caller are
untouched. Reuse the existing best-individual → `GearSuggestion[]` conversion rather than writing
a second one.

**Gear-steal exclusion.** With the default `ignoreEquipped: false`, autogear draws from gear
equipped on any *unlocked* ship (`AutogearPage.tsx:731`). A candidate that takes a piece off a
ship also on the fight board would produce an impossible fight — one piece worn twice. Such
candidates are **excluded** before simulation.

This can discard autogear's own #1. The table therefore reports exclusions explicitly — how many
candidates were dropped and which board allies they would have stripped — because a user who
cannot tell "bad" from "not evaluated" is being misled. When the #1 itself is excluded, that is
stated at the top of the table, not buried in a count.

**Realistic size.** GA convergence plus dedupe plus exclusion means 2–4 rows, sometimes the
baseline alone. That is a correct outcome and the table says it plainly.

**Every row is applyable.** A row the user cannot act on changes nothing; applying a row uses the
same path as applying autogear's suggestion today.

### §4 Running, and the metric table

**One seed set, shared.** Every candidate runs the same `baseSeed .. baseSeed + count - 1` as the
baseline — the `effectiveRunParams` rule. An unpaired comparison that presents itself as paired is
the failure mode `deltaStats` was built to avoid.

Note the existing, accepted limit, stated in `runSeedSet`'s own doc: seeding is not *full*
pairing. A gear change alters kill timing, which alters how many draws each actor takes, so keyed
sub-streams desync downstream of the first divergence even under one seed. This feature inherits
that; it does not claim more.

**Async and cancellable.** A measured 5v5 battle runs ~27 ms (30-round cap, both sides surviving —
a conservative upper bound). Four candidates × 20 seeds ≈ 2.2 s; ten × 20 ≈ 5.3 s. Synchronous
that is a frozen page, so runs go through `runSeedSetAsync` with an `AbortSignal` and
`onProgress`, reported across the whole job (candidate *i* of *n*, seed *j* of *k*).

**Locating the focus.** `SeedSetAggregate.perActorMean` is keyed by engine `actorId`
(`p:<shipId>:<i>`, with player index 0 rewritten to `FOCUS_ID`). Index 0 is decided by
`buildTeam`'s `POSITION_ORDER`, not by which ship is being geared, so the focus ship is **not**
reliably `FOCUS_ID`. Resolve it from the aggregate's `roster` by ship ID. A board holding the same
ship in two positions is rejected as a fight source rather than guessed at.

**Columns.** Each is a `deltaStats` paired delta of the candidate's aggregate against the
baseline's:

| Column | Source | `metricKind` |
|---|---|---|
| Win rate | `runs[].winner === 'player'` as a 0/1 indicator | `'binary'` |
| Rounds | `runs[].lastRound` | `'continuous'` |
| Focus damage dealt | focus actor `damageDealt` | `'continuous'` |
| Focus damage taken | focus actor `damageTaken` | `'continuous'` |
| Focus healing done | focus actor `healingDone` | `'continuous'` |
| Team damage dealt | all player actors' `damageDealt` | `'continuous'` |

`metricKind` is chosen by what the metric **is**, never inferred from how a particular pair of
runs happened to land. A rounds delta where every seed moves by at most one round still takes the
continuous rule.

**Primary metric by role**, marking the suggested column and driving the initial sort:

| Role family | Suggested primary |
|---|---|
| `ATTACKER` | Focus damage dealt |
| `DEFENDER*` | Focus damage taken (lower better), with rounds as secondary |
| `SUPPORTER*` | Focus healing done |
| `DEBUFFER*` | Team damage dealt |

The user can select any column and re-sort **without re-simulating** — the aggregates are already
computed and sorting is a client-side reorder. Nothing is hidden: all six columns show for every
role, because ranking a controller on any single one of them is the "confident wrong answer" the
issue warns about.

**Indistinguishable is a result.** Where `distinguishable` is false the cell says so rather than
showing a delta the reader will over-trust. A table where no candidate separates from the baseline
is the honest report that the proxy already found the plateau — that is useful output, not a
failure.

No overall "winner" is emitted.

### §5 UI

A collapsed **Simulate candidates** section under Strategy in `AutogearSettings`, off by default —
the feature is opt-in and costs seconds of compute. Contents: the fight-source dropdown, seed and
run-count inputs (reusing `clampSeed` / `clampRunCount` and the existing `SeedRunControls`
bounds), a Run button, progress with Cancel, and the results table.

Existing UI components throughout (`Button`, `Select`, `Input`, the `card` class, the `ui/tables/`
primitives). No raw `<button>`, no hand-rolled boxes.

## Testing

- **Adapter**: a candidate's substituted equipment reaches both the resolved stats and the gear-set
  abilities — a test that fails if the adapter ever bakes a stat block instead of passing a `Ship`.
- **Candidate pool**: dedupe by equipment ID-set collapses near-identical elites; a violator is
  excluded; runners-up come from the right attempt.
- **Gear-steal exclusion**: a candidate taking a board teammate's piece is excluded and reported;
  a candidate taking an *off-board* ship's piece is kept.
- **Focus resolution**: a board where the geared ship is not in the earliest position still reads
  that ship's own totals — this test fails if anyone assumes `FOCUS_ID`.
- **Pairing**: every candidate's aggregate carries the baseline's `baseSeed` and `count`. A
  tripwire, not a comment: the failure it guards is silent.
- **Metric kind**: the win-rate column takes the sign test and the rest take the t rule,
  asserted against `deltaStats` directly.
- **Non-vacuity**: the practice-board fixture must produce a fight where builds actually separate
  on at least one metric. A fixture where every candidate ties is a vacuous test that reads as a
  pass.

## Also in scope

- `src/pages/DocumentationPage.tsx` — the in-app docs gain the feature, including the statement
  that a practice fight is not a team-aware answer.
- One `UNRELEASED_CHANGES` entry in `src/constants/changelog.ts`.

## Deliberately excluded

- **Rank correlation (formula order vs sim order).** The issue proposes it as the validation
  instrument. Spearman over 2–4 candidates is noise, and the paired deltas already say whether the
  sim agrees with the formula's order.
- **Cross-config candidates** (autogear the same ship under two roles and compare). This is what
  would actually surface Xcellence's second basin — a converged GA explores one. Worth a follow-up
  once the table proves readable; out of scope here.
- **Optimising the whole team at once.** Out of reach: the comparison is one ship's builds against
  a fixed team.
- **Web workers.** Autogear is already main-thread and CPU-bound; this adds a cancellable async
  job, not a threading model.
