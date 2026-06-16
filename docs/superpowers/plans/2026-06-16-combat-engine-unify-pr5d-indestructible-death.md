# Combat Engine bySide Unification — PR5d: Wire `indestructible` into the Death Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task (fresh subagent per task + two-stage review). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Gate the dummy-enemy death-path block (`engine.ts` ~3821 `if (enemy.currentHp <= 0)`) on `!enemy.indestructible`, so the DPS dummy stops being `recordDestroyed` — it no longer stamps `destroyedRound`, no longer emits `ship-destroyed`, and no longer fires the post-round on-enemy-destroyed drains. This realizes the user-ratified "dummy is a perpetual indestructible SINK" model. THE risky step of the PR5 sub-split.

**Architecture:** The dummy enemy (`enemy`, the only actor with `indestructible: true`, set at engine.ts ~1140) is a stat-block damage sink: it accumulates damage as `currentHp` decline and its modeled HP% feeds HP-gates, but it must NEVER actually die (a death would stop the pure-DPS measurement and would fire death-reactives). Today, when its modeled HP reaches 0, the engine calls `recordDestroyed(enemy, r, bus)` (stamp + `ship-destroyed` emit) and drains on-enemy-destroyed intents. PR5d short-circuits that block for an indestructible actor. The change is **byte-identical for the golden corpus** (proven below) but is a **legitimate, audited behavior change** for the real model: a player on-enemy-destroyed reactive (Liberator/Sokol) will no longer fire against the dummy's modeled-HP-zero, and the dummy no longer emits `ship-destroyed`.

**Tech Stack:** TypeScript, Vitest. Engine: `src/utils/combat/engine.ts`. Flag: `CombatActor.indestructible` (state.ts ~119, set on the dummy at engine.ts ~1140). `recordDestroyed` (state.ts ~167) is NOT modified.

**Spec:** `docs/superpowers/specs/2026-06-16-combat-engine-bySide-unification-design.md` §3 item 6, §4 PR5 row. Sub-split **PR5d of 5** (a–e). Per the PR5 parent row, PR5d keeps all goldens byte-identical while making an audited behavior change confined to the (corpus-absent) on-enemy-destroyed-against-dummy path. Campaign memory: `project-combat-engine-byside-unification`.

---

## Background (verified against the PR5c tip `83182b78`; corpus verified by an Explore sweep)

- Dummy death path (engine.ts ~3821):
  ```ts
  if (enemy.currentHp <= 0) {
      recordDestroyed(enemy, r, bus);   // stamp destroyedRound + emit ship-destroyed (idempotent)
      drainIntents();                    // Path-B post-round on-enemy-destroyed drain (player)
      drainEnemyIntents();               // …and enemy-side
  }
  ```
  This is the POST-ROUND death drain. `drainIntents`/`drainEnemyIntents` are ALSO called pre-round (~2722) and per-turn (~3695) — those are NOT death-gated and PR5d leaves them untouched; gating this block skips ONLY the post-round death drain. The per-turn drains already empty the queue every turn, so nothing is pending here unless the dummy's own `ship-destroyed` queued an on-enemy-destroyed intent (which needs a listener that doesn't exist in goldens). Comment already notes: "With NO on-enemy-destroyed listener registered the intent queue is empty → this is a NO-OP (goldens byte-identical)."
- `enemy.currentHp = Math.max(0, enemyHp - (cumulativeDamage + cumulativeTeamDamage))` (~3808). The dummy DOES reach 0 HP in the golden corpus — **43 snapshot rows have `"enemyHpPct": 0`** — so `recordDestroyed(enemy)` fires today in those scenarios. This is a live path, not dead code.
- **Why suppressing it is byte-identical (the load-bearing facts):**
  1. **No golden registers an `on-enemy-destroyed` listener** — the ONLY trigger keyed on the `ship-destroyed` event (triggers.ts ~361). Verified: zero occurrences in `dpsGoldenParity.test.ts` / `healingGoldenParity.test.ts`. (NOTE: the healing goldens DO carry `on-enemy-cleansed` reactives, but those fire on `cleanse-performed` events, NOT `ship-destroyed`, and their intents drain per-turn — death-path-irrelevant.) So the dummy's suppressed `ship-destroyed` emit has no listener that would alter a snapshot value, and the post-round death drain here is a no-op in every golden.
  2. **No test asserts the dummy's `ship-destroyed` event or `enemy.destroyedRound`** (Explore-verified; the only `destroyedRound` assertions are the heal target's, healing scenarios 7/12).
  3. **The dummy's turn bookkeeping does NOT depend on `destroyedRound`.** The turn-skip guard (engine.ts ~2788) is `actor.destroyedRound !== undefined && !(healTarget && actor.id===healTarget.id) && !isDummyEnemy` — the dummy is exempt via `!isDummyEnemy` REGARDLESS of `destroyedRound`. Comment at ~2785: skipping the dummy "would drop a turn-started/ended pair and break every DPS golden." So whether `destroyedRound` is set (today) or undefined (after PR5d), the dummy still runs its full post-0-HP turn (DoT ticks, debuff decrements, turn-started/ended) identically. **This is the crux: PR5d does NOT cause the dummy to start being skipped.**
  4. The DPS adapter reads only `rawTotals` + `RoundData` columns; `enemy.destroyedRound` and `ship-destroyed` are neither → adapter output unaffected.
  5. Combat is a fixed-length loop (`for (let r = 1; r <= numRounds; r++)`, ~2043); no early termination on enemy death → suppressing the dummy's death cannot change round count.
- **`isDummyEnemy`** (engine.ts ~2787 `actor.kind === 'enemy' && actor.id === enemy.id`) is used at ~2791 (turn-skip) and ~3716 (debuff store). The dummy is the ONLY actor with `indestructible: true` AND the only `kind==='enemy'` with `enemy.id`, so `isDummyEnemy` ≡ `actor.indestructible` in this engine. **PR5d does NOT touch the `isDummyEnemy` sites** (that rename is out of scope — leave for the capstone/cleanup); PR5d only gates the death-path block, which references `enemy` directly, on `enemy.indestructible`.

## File Structure

- **Modify:** `src/utils/combat/engine.ts` — the death-path block at ~3821 only.
- **Create:** `src/utils/combat/__tests__/indestructibleDeath.test.ts` — characterization invariants (byte-identical surface) + the RED→GREEN behavior-change locks (no dummy ship-destroyed / no on-enemy-destroyed reaction against the dummy).
- **Do NOT touch:** `state.ts` (`recordDestroyed`/`indestructible` are correct), the `isDummyEnemy` turn-skip/debuff sites (~2787/2791/3716), any adapter, the `enemyHpDecline` scalar (that's PR5e), or PR5c's destroyed-round seam.

---

### Task 1: Characterize the dummy-death surface + write the RED behavior-change locks

**Files:** Create `src/utils/combat/__tests__/indestructibleDeath.test.ts`.

- [ ] **Step 1: Read the sites.** Read engine.ts ~3804-3834 (HP decline + death block + drains), ~2785-2795 (turn-skip guard), ~1136-1150 (dummy construction with `indestructible: true`), and state.ts ~163-171 (recordDestroyed). Read `perActorIncoming.test.ts` for the DPS-fixture helpers.

- [ ] **Step 2: INVARIANT locks (GREEN now, MUST stay GREEN after Task 2).** Build a DPS fixture (no `healTargetId`; `enemy` is the sink) where the dummy's modeled HP reaches 0 within the simulated rounds (small `enemyHp` + enough attack/rounds — confirm a round hits `enemyHpPct: 0`). Assert the OBSERVABLE surface that must not move:
  - `result.rawTotals` (direct/cumulative/etc.) equals a captured baseline.
  - The dummy keeps accumulating damage AFTER its HP hits 0 (e.g. `cumulativeDamage` keeps rising in later rounds, or a DoT applied to the dummy keeps ticking post-0) — i.e. the dummy is NOT skipped post-death. (Use the per-round `result.rounds[]` data.)
  - Non-vacuous: assert at least one round has `enemyHpPct === 0`.

- [ ] **Step 3: RED behavior-change locks (FAIL now, PASS after Task 2).** These encode the audited change:
  - **No dummy `ship-destroyed`:** capture `bus` events (mirror the `bus.on('ship-destroyed', …)` pattern in `destroyedRoundUnification.test.ts`); in the dummy-reaches-0 DPS fixture, assert NO `ship-destroyed` event fires for `actorId === 'enemy'`. (RED today — the dummy emits one when HP hits 0.)
  - **No on-enemy-destroyed reaction against the dummy:** construct a fixture with a player-side `on-enemy-destroyed` reactive (e.g. an `extra-action` or ally-charge ability with `trigger: 'on-enemy-destroyed'` on the focus/team — mirror the trigger usage in `reactiveExtraAction.test.ts`) AND the dummy reaching 0 HP. Assert the reactive does NOT fire (no extra action / no charge bump attributable to the dummy's "death"). (RED today — the dummy's `ship-destroyed` triggers it; after PR5d the dummy never dies so it must not.)
  - If a clean on-enemy-destroyed fixture proves too fiddly to assert deterministically, at minimum keep the `ship-destroyed`-absence lock (that alone pins the core change) and note the reaction lock as a follow-up — but PREFER to include it.

- [ ] **Step 4: Run.** `npm test -- indestructibleDeath` — INVARIANT locks GREEN, behavior-change locks RED (expected). Do NOT commit yet (RED tests). Record exactly which assertions are RED and why, to confirm Task 2 turns them GREEN for the right reason.

  (Commit happens in Task 2 once the implementation turns the RED locks GREEN, so the suite is green at every commit.)

---

### Task 2: Gate the death-path block on `!enemy.indestructible`

**Files:** Modify `src/utils/combat/engine.ts`; the test file from Task 1 turns fully GREEN.

- [ ] **Step 1: Gate the block (~3821).** Change `if (enemy.currentHp <= 0) {` to `if (enemy.currentHp <= 0 && !enemy.indestructible) {`. Update the block's comment: an `indestructible` sink (the DPS dummy) never dies — it keeps accumulating damage as `currentHp` decline for HP%-gates but is never `recordDestroyed`, emits no `ship-destroyed`, and fires no post-round on-enemy-destroyed drain. Note that the dummy's turn bookkeeping is unaffected (the turn-skip is gated on `isDummyEnemy`, not `destroyedRound`), so DoT/decrement ticking continues exactly as before — the byte-identical invariant.

- [ ] **Step 2: Run the behavior-change + invariant locks.** `npm test -- indestructibleDeath` — ALL GREEN now (invariants still hold; the RED locks flipped GREEN).

- [ ] **Step 3: Byte-identical goldens.** `npm test -- dpsGoldenParity healingGoldenParity` — PASS with ZERO `.snap` movement (`git status --short` clean of golden files). **This is the load-bearing gate — even though the dummy reaches 0 HP in 43 golden rows, suppressing its recordDestroyed must move nothing (no observer). If a golden moves, an on-enemy-destroyed reaction or a destroyedRound read leaked — STOP and diagnose. Never `vitest -u`.**

- [ ] **Step 4: Full suite + gates.** `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run audit:skills` (0/141). Note: a NON-golden integration test elsewhere MIGHT assert the dummy's death (Explore found none in goldens, but the full suite is the backstop). If a non-golden test breaks, audit whether it encoded the OLD (now-changed) dummy-death behavior — if so, update it with a comment explaining the PR5d model change; if it reveals an unintended consequence, STOP.

- [ ] **Step 5: Commit** (no `--no-verify`; pre-commit runs the full suite):
```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/indestructibleDeath.test.ts
git commit -m "feat(combat): indestructible dummy enemy never dies — gate death path on the flag (PR5d)"
```

---

### Task 3: Verification sweep + handoff

- [ ] **Step 1:** Changelog: this is an internal-model change with NO user-visible effect in the shipped DPS/healing calculators (the dummy-death suppression only matters once positions/real on-enemy-destroyed-vs-dummy paths are user-reachable, which they are not in the current UI). Confirm no user-facing behavior change and SKIP the changelog (note the reasoning).
- [ ] **Step 2:** `git diff feat/combat-sim-phase5-pr2...HEAD --stat` — confirm only `engine.ts` + the new test + this plan doc changed; no `state.ts`, no adapter, no golden snapshots, no `isDummyEnemy` sites touched.
- [ ] **Step 3:** Hand off for final holistic review. Reviewer must independently: (a) confirm `ship-destroyed` emission for the dummy is suppressed and NOTHING else changed emission-wise; (b) confirm the dummy still runs its post-0-HP turn bookkeeping (DoT ticks / debuff decrements) — i.e. the turn-skip is still `isDummyEnemy`-gated and unaffected; (c) re-run the byte-identical golden gate and a revert experiment; (d) confirm the 43 `enemyHpPct: 0` golden rows still produce identical snapshots.

---

## Notes for the executor

- **Branch:** `feat/combat-engine-unify-pr5d-indestructible-death` (already created off the PR5c tip `83182b78` on `feat/combat-sim-phase5-pr2`). After review → LOCAL squash-merge into `feat/combat-sim-phase5-pr2` (DO NOT push to origin — overnight directive; keep local). Then PR5e branches off the new tip.
- **The load-bearing invariant:** byte-identical goldens DESPITE the dummy reaching 0 HP in 43 rows. The proof is the no-observer argument (no on-enemy-destroyed listener; destroyedRound unread for the dummy; turn-skip is isDummyEnemy-gated). The RED→GREEN behavior locks pin the intended change; the golden gate pins the invariance.
- **Do NOT** touch the `isDummyEnemy` sites (out of scope), `state.ts`, the `enemyHpDecline` scalar (PR5e deletes it), or any adapter.
- **Workflow:** docs gitignored → `git add -f`, `--no-verify` for docs-only commits. Keep ALL commits LOCAL (no push).
