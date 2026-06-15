# Combat Simulator Phase 5 — PR 1 Implementation Plan (`simulateBattle` adapter + symmetric result)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A `simulateBattle` adapter that runs two positioned squads through the existing `runCombat` and assembles a per-round, per-ship **symmetric result surface** (damage dealt/taken, healing, shields, HP curve, death, events) for both teams — the data layer the `/simulator` page (PR 2) renders.

**Architecture:** Page-first (full engine unify deferred). The Phase-4 positional path already runs both directions (player→enemy + enemy→player) when positions are supplied, and the engine emits a rich event stream. So PR 1 = (a) a pure **event-driven assembler** (`event stream + rosters → symmetric BattleResult`) + (b) the `simulateBattle` adapter that derives both teams, builds `CombatEngineInput` (positions + `enemyAttackers` + a `healTargetId` workaround + a tapped bus), runs `runCombat(numRounds=30)`, and feeds events to the assembler. **No engine-internal change → DPS/healing goldens byte-identical.**

**Tech Stack:** TypeScript, Vitest. New `src/utils/calculators/battleSimulator.ts`. Reuses `runCombat` (engine.ts), `deriveTeamEngineActors` (dpsSimulator.ts), `parseShipTargeting` (targetingParser.ts), `createEventBus`/`CombatEvent` (events.ts).

**Spec:** `docs/superpowers/specs/2026-06-15-combat-simulator-phase5-design.md` (§4.2 surface, §11 PR 1).

---

## Workflow notes (read first)
- **Branch + worktree:** branch `feat/combat-sim-phase5-pr1` off latest `origin/main` in a new worktree `.worktrees/sim-pr1`. Symlink the gitignored `.env` + `docs/ship-targeting.csv`/`ship-skills.csv`/`bios.csv`/`combat-system.md` + `.husky/_` from the main checkout (else env tests fail + the pre-commit hook breaks).
- **`gh auth switch --hostname github.com --user TheSusort`** before any PR/gh op.
- **Goldens byte-identical:** PR 1 adds a NEW caller only; no engine change. `git diff origin/main -- '*.snap'` must be empty. NEVER blind `vitest -u`.
- `docs/` gitignored → `git add -f`; docs commits `--no-verify`. New tests → `src/utils/combat/__tests__/` or `src/utils/calculators/__tests__/`.
- Test cmds: `npm test -- <path>`, `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run audit:skills`.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/utils/calculators/battleSimulator.ts` | **new** — `simulateBattle(input): BattleResult`; the event-driven `assembleBattleResult(...)`; result types | Create |
| `src/utils/calculators/__tests__/battleAssemble.test.ts` | **new** — assembler unit tests (synthetic event streams) | Create |
| `src/utils/combat/__tests__/twoTeamBattle.test.ts` | **new** — end-to-end two-team harness through `runCombat` | Create |

---

## Task 1: Characterization spike — confirm mutual positional combat emits for both sides

**File:** `src/utils/combat/__tests__/twoTeamBattle.test.ts` (new)

Before building the assembler, PROVE the data source: a tiny 2v2 positioned battle through `runCombat` (healing mode, `healTargetId` = a player ship) must emit damage events for BOTH directions (player→enemy AND enemy→player).

- [ ] **Step 1: Write the spike test.** Hand-build (reuse the `ab()`/`manualEnemy`/positioned-actor style from `src/utils/combat/__tests__/positionalDamage.integration.test.ts`): a player side with 2 positioned actors (one as focus `attacker`, one as a walked `teamActor`, each with a damage `shipSkills` + `position` + parsed `target`/`pattern`), and `enemyAttackers` with 2 positioned actors (damage skills + position + target/pattern). Set `healTargetId` to a player ship. Pass a captured `bus` (collect all events). `numRounds: 3`.
- [ ] **Step 2: Run + assert mutual emission.** Assert the event stream contains `ability-performed`/`attacked` events where (a) a player actor damages an enemy actor (targetId ∈ enemy ids) AND (b) an enemy actor damages a player actor (targetId ∈ player ids), and `hp-changed`/`ship-destroyed` for both sides as HP allows. Also capture which event types carry the per-victim damage (ability-performed vs attacked vs perTargetDamage in the returned rounds) — **document the findings in a comment block** (this is the contract the assembler relies on). Run: `npm test -- src/utils/combat/__tests__/twoTeamBattle.test.ts`.
- [ ] **Step 3: Pin the data-source contract in the comment (verified during plan review — confirm it holds):**
  - **damage TAKEN (per victim, both directions)** = `RoundData.perTargetDamage` (keyed by victim id; fed by `emitHit` at all 3 attack sites — symmetric).
  - **damage DEALT (per attacker, both directions)** = sum of `ability-performed.damage` grouped by `actorId` (enemy actors walk `runPlayerTurn` and emit it too).
  - **readable event-log lines** come from `ability-performed` / `heal-performed` / `ship-destroyed` (these carry attacker attribution) — **NOT `attacked`**, which carries NO damage amount and fires only for the anchor victim (not per AoE-covered cell). Do not try to reconstruct dealt-damage from `attacked`.
  If any of this is FALSE in practice, STOP and report — Task 2 depends on it.
- [ ] **Step 4: Commit** `test(combat): characterize two-team positional battle event stream`.

---

## Task 2: Symmetric result types + pure event-driven assembler

**Files:** `src/utils/calculators/battleSimulator.ts` (create — types + `assembleBattleResult`), `src/utils/calculators/__tests__/battleAssemble.test.ts`

Define the symmetric surface (§4.2) and a PURE assembler from the event stream (+ roster + per-round `perTargetDamage` from the rounds, per Task 1's findings).

```ts
export interface ShipRoundState {
    actorId: string;
    side: 'player' | 'enemy';
    damageDealt: number;
    damageTaken: number;
    healingDone: number;
    healingReceived: number;
    shieldsAbsorbed: number;
    hpPct: number;            // end-of-round
    alive: boolean;
    activeBuffs: string[];    // from buff-applied/expired tracking (names)
    activeDebuffs: string[];
}
export interface BattleRound {
    round: number;
    ships: ShipRoundState[];          // every living-or-just-died actor, both sides
    events: BattleLogEvent[];         // ordered: who hit/healed/killed whom (for the log)
}
export interface BattleResult {
    rounds: BattleRound[];            // trimmed at termination
    outcome: { winner: 'player' | 'enemy' | 'draw'; lastRound: number };
    roster: { actorId: string; side: 'player'|'enemy'; name: string; position: Position }[];
}
export function assembleBattleResult(args: {
    events: CombatEvent[];
    perRoundPerTarget: Record<number, Record<string, number>>; // from RoundData.perTargetDamage by round
    roster: Array<{ actorId: string; side: 'player'|'enemy'; name: string; position: Position; maxHp: number }>;
    numRounds: number;
}): BattleResult
```

Assembler logic (driven by Task 1's confirmed sources): group events by round; per round per actor accumulate `damageDealt` = sum of `ability-performed.damage` by `actorId`; `damageTaken` = `perRoundPerTarget` by victim id; heals/HP/death/buffs from events; track `hpPct` from the latest `hp-changed.newPct` (default 100); `alive` false once `ship-destroyed`; collect a readable `events` log per round. Compute `outcome`: the first round where all of one side's actors are destroyed → winner = other side, `lastRound` = that round; trim later rounds; no wipe by round `numRounds` → `draw`.

> **Attribution edge (document in the assembler, not a bug):** `ability-performed.damage` is the attacker's aggregate for the turn; the per-victim split in `perTargetDamage` has NO source id. So per-actor `damageDealt` and per-actor `damageTaken` are each sound, but you CANNOT cross-tab "how much X dealt to specific victim Y" in an AoE round from this data. §4.2 does not require that cross-tab — keep dealt and taken as separate per-actor totals.

- [ ] **Step 1: Write failing tests** with HAND-BUILT synthetic `CombatEvent[]` (no `runCombat`): (a) a player ability-performed + an enemy attacked → correct damageDealt/damageTaken on both sides; (b) heal-performed → healingDone/Received; (c) hp-changed → hpPct; (d) ship-destroyed → alive=false + (when a side fully dies) outcome.winner + rounds trimmed; (e) no-wipe → draw at numRounds.
- [ ] **Step 2: Run, expect FAIL** (`npm test -- src/utils/calculators/__tests__/battleAssemble.test.ts`).
- [ ] **Step 3: Implement** types + `assembleBattleResult` (pure; no engine import — only `CombatEvent` type + `Position`).
- [ ] **Step 4: Run, expect PASS.** `npm test` full suite byte-identical.
- [ ] **Step 5: Commit** `feat(sim): symmetric battle result types + pure event-driven assembler`.

---

## Task 3: `simulateBattle` adapter — derive teams, run engine, assemble

**Files:** `src/utils/calculators/battleSimulator.ts` (add `simulateBattle` + input types), tests in `twoTeamBattle.test.ts`

```ts
export interface BattlePlacement { ship: Ship; statOverrides?: Partial<CombatStatBlock>; position: Position; }
export interface BattleSimulationInput { playerTeam: BattlePlacement[]; enemyTeam: BattlePlacement[]; rounds?: number; /* default 30 */ }
export function simulateBattle(input: BattleSimulationInput): BattleResult
```

Implementation:
- Derive each placed ship's combat stats (reuse the `deriveTeamEngineActors`-style stat derivation in `dpsSimulator.ts`; apply `statOverrides`), affinity, and `parseShipTargeting(ship)` → per-actor `target`/`pattern` (active; charged where applicable).
- Build `CombatEngineInput`: player side = one ship as the focus `attacker` + the rest as `teamActors` (each with `walk` block, `position`, `target`, `pattern`); enemy side = `enemyAttackers` (each with `position`, `target`, `pattern`, stats, `shipSkills`); **`healTargetId` = the focus player ship's id** (vestigial requirement so `enemyAttackers` populate + the enemy positional path runs — document inline). Provide a fresh `bus`.
- Run `runCombat({ ..., numRounds: rounds ?? 30, bus })`; collect `bus` events + the returned `rounds[].perTargetDamage`.
- Build the `roster` (id/side/name/position/maxHp) and call `assembleBattleResult(...)`; return the `BattleResult`.
- **Actor-id derivation rule (required):** the engine throws on duplicate `enemyAttackers` ids and on collision with reserved ids (`'attacker'`, `'enemy'`) or player actor ids (engine.ts ~1490/1494). The adapter MUST mint globally-unique actor ids across BOTH squads and avoid the reserved ones (e.g. prefix `p:`/`e:` + ship id + placement index). Map these back to ship names for the `roster`.

- [ ] **Step 1: Write failing end-to-end test** in `twoTeamBattle.test.ts`: two small real-ish squads (hand-built `Ship`-shaped objects or fixtures) → `simulateBattle` → assert per-ship per-round `damageDealt`/`damageTaken` are non-zero on both sides, a ship that should die has `alive:false` + a sensible `outcome.winner`, and the 30-round cap / early termination behaves (e.g. a one-sided matchup wipes the weaker team and trims rounds).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `simulateBattle` (derivation + engine wiring + assemble).
- [ ] **Step 4: Run, expect PASS;** `npm test` full suite **byte-identical** (`git diff origin/main -- '*.snap'` empty — new caller only). `npx tsc --noEmit && npm run lint`.
- [ ] **Step 5: Commit** `feat(sim): simulateBattle adapter (positioned squads -> runCombat -> symmetric result)`.

---

## Task 4: Two-team harness hardening + edge cases

**File:** `src/utils/combat/__tests__/twoTeamBattle.test.ts` (extend)

Lock the adapter's correctness on the cases PR 2 + the deferred unify will rely on:
- [ ] **Step 1:** Add tests: (a) **win/loss/draw** outcomes (one-sided wipe → winner; mutual survival to cap → draw); (b) **death-round** correctness (a ship destroyed round N has `alive:false` from N on, absent/decayed after); (c) **healing** ships register `healingDone`/`healingReceived`; (d) **AoE** spreads `damageTaken` across covered enemy cells (origin full / covered half) via the symmetric surface — the fixture MUST place victims so a multi-cell AoE pattern (e.g. `line`/`cone` range ≥1) actually covers ≥2 enemy cells (a single-target parsed pattern won't exercise the covered-half path); (e) per-round `events` log lists the right attacker→victim lines.
- [ ] **Step 2: Run, expect PASS** (these exercise Tasks 2–3; fix any gaps surfaced).
- [ ] **Step 3:** full suite byte-identical; tsc + lint clean.
- [ ] **Step 4: Commit** `test(sim): two-team battle outcomes, death-round, healing, AoE accounting`.

---

## Task 5: Final verification + PR

- [ ] **Step 1:** `npm test` full suite green; **DPS/healing goldens byte-identical** (`git diff origin/main -- '*.snap'` empty).
- [ ] **Step 2:** `npm run audit:skills` (0/141), `npx tsc --noEmit && npm run lint` clean.
- [ ] **Step 3:** Holistic self-review vs spec §4.2/§11: symmetric surface exposes per-round per-ship damage dealt/taken/heal/shields/HP/death + events for both sides; `simulateBattle` is the page↔engine seam; engine untouched (byte-identical); `healTargetId` workaround documented.
- [ ] **Step 4:** Open PR (`gh auth switch` first), base `main`. Body: page-first PR 1 of 2, data layer for `/simulator`, byte-identical, links spec. No changelog yet (no user-visible surface until PR 2's page). Poll CodeRabbit `mergeState`.

---

## Out of scope (later)
- The `/simulator` page UI → **PR 2**.
- Full team-agnostic engine unification (A1..An) → **deferred later phase** (page becomes its harness).
- Per-victim defense-debuff sourcing / full leech symmetry inside the engine → deferred unify phase (the assembler surfaces what the positional path provides today).
