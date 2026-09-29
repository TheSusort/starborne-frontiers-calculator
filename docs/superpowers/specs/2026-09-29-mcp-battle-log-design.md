# MCP `battle_log` tool — design (2026-09-29)

## Goal

Let an assistant read one simulated fight turn by turn through the MCP. Today `simulate_battle`
returns only aggregates (wins, rounds, per-ship damage/taken/healing); diagnosing *why* a ship
dealt 0 or healed 785k needs the event log. Workflow it enables: run `simulate_battle` over N
seeds, spot an odd run, replay that seed with `battle_log`.

Out of scope: rule fixes found during the 2026-09-29 bug hunt (Hayyan self-as-ally, Grif
per-cleansed-enemy) — separate PR.

## Owner decisions

- **Format:** compact plain text, one line per log entry, reactions indented under their cause.
- **Shape:** a new tool `battle_log`, not a flag on `simulate_battle`.
- **Size:** no filters and no cap. The player side is at most 5 ships (7 in one rare mode), so a
  log stays manageable. The tool description warns that it is token-intensive.

## Components

### 1. Text formatter — `src/utils/combat/log/formatText.ts`

Pure: `formatCombatLogText(combatLog: CombatLogRound[], roster: BattleResult['roster']): string`.
Lives beside `buildCombatLog.ts` so scripts (e.g. `traceShip`) can reuse it; imports nothing from
`src/mcp` or React.

- Ship label: `P.<name>@<position>` / `E.<name>@<position>` from `roster` (distinguishes two ships
  of the same name). An id missing from `roster` prints raw.
- Per round: `=== ROUND n`, then `startOfRound` entries prefixed `[start]`, then each turn, then
  `endOfRound` entries prefixed `[end]`.
- Turn header: `-- TURN <label> charge <chargeBefore>/<chargeMax>`, plus
  `hp <currentHp>/<maxHp>` when `statsSnapshot` is present.
- Entry line: `<kind> <actor label>` then, when present, `"<skillName>"`, `(<slot>)`, `{<note>}`,
  then `-> ` and a comma-joined target list. Nested `reactions` are indented one level (two
  spaces) deeper, recursively.
- Target: `<label>` then, when present, the rounded `amount`, ` crit`, ` miss` (`didHit === false`),
  ` overheal <n>`, ` overshield <n>`, ` shield hit` (`shieldWasHit`), ` [<resultingHpPct>%]`.
- `reversed-repair` entries also show `healer <label>` from `healerId`.
- Numbers are rounded to integers. Output ends with a trailing newline.

### 2. Tool — `battle_log` in `src/mcp/tools/simulate.ts`

- **Input:** `boardInputShape` (player, enemy, leaders, profile_id, seed) with `refineBoards`. No
  `runs`.
- **Run:** `loadBoardData` → `buildBattleInput` → one `runSeededBattle(input, seed, getGearPiece)`.
  No deadline guard: `runSeededBattle` takes no deadline, and one battle costs ~100 ms.
- **Output (JSON, as every tool):**
  - `seed`
  - `outcome`: `{ winner: 'player' | 'enemy' | 'draw', rounds }` (`rounds` = `outcome.lastRound`)
  - `ships`: same per-ship shape as `simulate_battle` (`side, position, name, damage_dealt,
    damage_taken, healing_done`), totals for this one fight via `summarizeRun`
  - `unsimulated`: as `simulate_battle`
  - `log`: the formatter's string
- **Description:** returns one fight's full turn-by-turn log; token-intensive; intended for
  replaying a seed that `simulate_battle` flagged; same seed and input give the same fight. Plus
  the shared `CAVEATS`.
- Registered in `TOOLS` (`src/mcp/registry.ts`) after `sweep_stat`.

### 3. Tests

- **Formatter unit test** (`src/utils/combat/log/__tests__/formatText.test.ts`): a hand-built
  `CombatLogRound[]` + roster exercising a nested reaction, crit/miss/overheal/resulting-HP
  target fields, start/end-of-round entries, a missing snapshot, and an unknown actor id. Plus one
  test on a real `runSeededBattle` result asserting every roster label appears and no raw actor id
  (`p:`/`e:` prefix) leaks when every actor is on the roster.
- **Determinism tripwire:** for the same board and seed N, `battle_log`'s `ships` equal
  `simulate_battle`'s `ships` with `runs: 1, seed: N`, and `outcome.rounds` equals its
  `mean_rounds`. This is what makes "replay the odd seed" trustworthy.
- **Tool tests** following `tools.simulate.test.ts` / `tools.simulate.wiring.test.ts`: the log is a
  non-empty string starting `=== ROUND 1`; `registry.test.ts`'s tool-name list gains `battle_log`.

### 4. Docs and changelog

- `DocumentationPage.tsx` MCP "What the Assistant Can Do": add replaying one simulated fight as a
  full turn-by-turn log.
- `UNRELEASED_CHANGES`: `MCP: new battle_log tool returns one fight's full turn-by-turn log.`

## Error handling

Board validation errors come from `refineBoards` / `buildBattleInput` exactly as for
`simulate_battle`.
