# MCP spec 3: `simulate_battle` and `sweep_stat` (#562)

Two compute tools on the existing `/mcp` server (spec 2, `2026-09-25-mcp-auth-plumbing-design.md`).
An assistant places the caller's own ships and/or reference ships on two boards and gets the
combat simulator's result back, or sweeps one stat on one ship and gets a paired verdict per step.
The numbers must match what the Simulator page shows for the same boards, seed and run count.

## Decisions

- **Runs in-process in the `/mcp` Netlify function, synchronously.** No background function or
  job table: the MCP token is read-only at the database (spec 1), so it cannot write a job row.
  Input caps keep the worst case well inside the function's ~30 s limit (measured in prod, #573).
- **Enemy board:** the caller's own ships (geared, as `get_my_fleet` resolves them) and/or
  reference ships by template name, `r0` or `refitted` (level 60, no gear). Nothing else.
- **Engineering matches the Simulator page:** the caller's engineering applies to every ship on
  both boards, template enemies included (one `CombatStatsDeps` for both, as `buildTeam` does).
- **`simulate_battle` defaults to 1 run** (the page's default). **`sweep_stat` defaults to 20 runs
  per step** (the page's sweep panel default): with one run per step `pairedDelta` has nothing to
  test and `distinguishable` is always false.
- **Rate limiting is deferred** until this spec ships; it lands before the next release.

## Tool surface

### Shared board input

```
profile_id?:     string                 // from list_profiles; defaults to the main account
player:          Cell[]                 // min 1
enemy:           Cell[]                 // min 1
player_leader?:  { faction, name, stage: 1|2|3 }   // from SQUAD_LEADERS
enemy_leader?:   { faction, name, stage: 1|2|3 }
seed:            integer                // default 1

Cell = { position: 'T1'…'B4', stat_overrides?: StatOverrides } & (
         { ship_id: string }                                    // a ship from get_my_fleet
       | { template: string, variant: 'r0' | 'refitted' } )     // enemy board only
```

- At most one ship per position, and a `ship_id` at most once per board (Zod `superRefine`).
- `template` cells are allowed on the enemy board only.
- `stat_overrides` keys are the 11 `OVERRIDABLE_STATS`. Values are integers in the units
  `get_my_fleet` reports (crit `70`, not `0.7`) and at or above `OVERRIDE_MIN` (hp ≥ 1, others
  ≥ 0). They compose through `applyStatOverrides`, so they win over gear, refits, implants and
  engineering, and cannot express a set bonus.

### `simulate_battle`

Adds `runs: integer 1–200, default 1`.

Returns:

```
{ runs, seed,
  outcome: { player_wins, enemy_wins, draws, win_rate, mean_rounds, median_rounds },
  ships: [{ side, position, name, damage_dealt, damage_taken, healing_done }],   // per-run means
  unsimulated: [{ ship, texts }] }   // squad-leader effects the engine did not model (preFight.unsimulated)
```

No per-round log — it does not fit a tool response. The description tells the assistant that
`unsimulated` entries make the figures less reliable, and that a non-UUID implant slot is not
read (#578), so that implant's effect is missing.

### `sweep_stat`

Adds `target: { side, position }`, `stat` (an `OverridableStat`), `from`, `to`, `step`,
`runs_per_step: integer 1–100, default 20`.

- Steps come from `sweepSteps(stat, from, to, step, resolved)`, where `resolved` is the target's
  current final stat. The reference step is always included; at most `MAX_SWEEP_STEPS` (25).
- `steps × runs_per_step ≤ 500` (the total battle cap), checked before any battle runs.

Returns `{ stat, target, seed, runs_per_step, current_value, points }`, one point per step from `analyseSweep`:
`value, is_reference, win_rate, mean_rounds, team_damage`, and on non-reference steps a
`delta` per series `{ mean, se, n, distinguishable }` against the reference step.

## Architecture

**Files:**

- `src/mcp/simBoards.ts` — the shared input schema and a board builder: validated input plus the
  fetched ships, templates, ascension rows, gear and engineering → `BattleSimulationInput` and
  `getGearPiece`. Pure; no database.
- `src/mcp/tools/simulate.ts` — both tools: fetch, build, run, summarise.
- `src/utils/simulator/statSweep.ts` gains `runStatSweep`, a synchronous twin of
  `runStatSweepAsync` built from the same `stepInput` and `runSeedSet`, not a second copy of the
  step logic.
- `registry.ts` adds both tools. `readOnlyHint: true` stays true: the tools write nothing.

**Per request:**

1. Check `profile_id` against `fetchProfiles` (as `get_my_fleet` does).
2. In parallel: `fetchShips` (error on any `ship_id` not in it), `fetchEngineeringStats`, and — if
   any template cell exists — the templates with their `ascension_stats`. `transformShipTemplate`
   drops that column, so the template read keeps the raw row's `ascension_stats` and runs it
   through `parseAscensionStats`, as `useShipsData` does.
3. `fetchGearByIds` for every equipment and implant id on the placed own ships → `gearById`.
   `clearGearStatsCache()` first: a warm instance serves many requests.
4. Template cells become `referenceShip(template, variant, ascension)`. Each side is built with
   `buildTeam` — the page's builder — so cell order (T1…B4, first occupied = focus actor) and
   resolved stats match the page. Engineering comes from one `CombatStatsDeps` for both boards.
5. Run with `getGearPiece` always passed:
   - `simulate_battle`: `runSeedSet(input, seed, runs, getGearPiece)`.
   - `sweep_stat`: `runStatSweep` → `analyseSweep`.
6. Summarise to the shapes above.

## Fidelity requirements (each has a tripwire test)

1. `getGearPiece` reaches `simulateBattle`. Without it `buildShipAbilities` replaces
   `buildShipAbilitiesWithEquipment` and gear-set and implant abilities vanish with no error.
2. Every placement carries final stats in `statOverrides` (via `buildTeam`); without them the
   engine floors to un-geared base stats.
3. A `refitted` template carries its 6 ascension refits.
4. The caller's engineering reaches template enemies.
5. The tool is wiring, not a new aggregator: its figures equal `runSeedSet` / `runStatSweepAsync`
   called directly on the same input.

## Errors

All are `McpToolError`s, worded for the assistant:

- A `ship_id` not in the profile → "not one of your ships on this profile; use get_my_fleet".
- An unknown template → `findShipTemplate`'s existing message.
- `refitted` on a template that `canBeFullyRefitted` rejects → "has no refit data; use r0".
- An unknown squad leader, or a stage it does not have.
- `sweep_stat`: an empty target cell; `sweepSteps`' own errors (range, step, > 25 steps); and
  steps × runs over 500, naming the step count so the assistant can widen `step` or cut runs.
- `simulateBattle` throws for invalid input only; anything else is logged in full by
  `registerTools`, as today.

## Testing

Unit tests against the mocked Supabase client in `src/mcp/__tests__/fixtures.ts`:

- Each fidelity requirement above, each proving the instrument can report the opposite: a geared
  own ship gives different figures from the same ship un-geared; a gear-set ability changes the
  result only when `getGearPiece` is passed; `refitted` differs from `r0`; engineering changes a
  template enemy's figures.
- Same input and seed → identical output; `simulate_battle` equals `runSeedSet` direct;
  `runStatSweep` equals `runStatSweepAsync` on the same input.
- Validation: duplicate position, duplicate `ship_id`, template on the player board, override
  below floor, and steps × runs > 500 rejected before any battle runs.
- `simBoards.ts`, `tools/simulate.ts` and `utils/simulator/seededRuns.ts` added to `ENTRIES` in
  `src/mcp/__tests__/nodeLoad.test.ts`.

**Timing check (not a vitest):** a one-off measurement of the worst case — the largest board the
Simulator page allows, full kits, 500 battles — recorded in the PR. If it exceeds ~15 s, lower the
battle cap before merging.

## Docs and changelog

- `DocumentationPage.tsx`: the MCP section lists the two new tools.
- `UNRELEASED_CHANGES`: `AI assistants: your assistant can now run battles and stat sweeps.`

## Out of scope

- **Rate limiting** — follows this spec, before the next release.
- **Usage counting in `daily_usage_stats` (#543)** — the MCP token is read-only at the database.
- **Saved simulator setups** — localStorage only; the server cannot read them.
- **Encounter notes as a board source** — no MCP tool lists them yet.
- **NPC bosses (#519)**, and enemies at any level or rank other than 60 `r0` / `refitted`.
- **An autogear tool**, per-round combat logs, and background or long-running jobs.
