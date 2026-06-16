# Combat Engine bySide Unification — PR5a: Per-Actor Incoming Buckets (foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Introduce a per-actor incoming/shield/barrier accounting bucket that is written **in parallel** with the existing heal-target-only scalars (`roundIncomingDamage`/`roundShieldAbsorbed`/`roundBarrierAbsorbed`), with **no reader yet**. Pure foundation for PR5b (which flips the readers).

**Architecture:** The three per-round scalars are bumped inside the injected `DamageAccountingSink` (`engine.ts` ~2291–2306, the `playerSink`). PR5a keys a `Map<string, ActorIntake>` by the victim's actor id, writing each amount into both the scalar AND the per-actor bucket at the same points. To key the bucket, the sink's `addIncoming`/`addShieldAbsorbed`/`addBarrierAbsorbed` hooks gain the victim id (mirroring `onHealTargetDestroyed(victim)`, which already receives it). The bucket is exposed as an **additive, engine-internal** field on `HealingRoundEngine`; no adapter reads it. Nothing changes behavior.

**Tech Stack:** TypeScript, Vitest. Engine: `src/utils/combat/engine.ts`. Result type: `HealingRoundEngine` (engine.ts ~983–1004). Adapters (`healingEngineAdapter.ts`, `dpsSimulator.ts`) are NOT touched.

**Spec:** `docs/superpowers/specs/2026-06-16-combat-engine-bySide-unification-design.md` §3 item 6, §4 PR5 row. This is sub-split **PR5a of 5** (a–e). Per spec §4, re-deriving the golden expectation from the PR5 parent row: PR5 as a whole permits *audited healing-side churn*, but **PR5a specifically is byte-identical for BOTH DPS and healing goldens** — it only ADDS a write-only field, changing no emitted value. Campaign memory: `project-combat-engine-byside-unification` (PR5 = item 5, the churn-risk PR; PR5a is its byte-identical foundation).

---

## Background (verified by the PR5 architecture map)

- Scalars declared per-round at `engine.ts` ~2108–2113.
- `DamageAccountingSink` interface at ~1013–1022: `addIncoming(amount)`, `addShieldAbsorbed(amount)`, `addBarrierAbsorbed(amount)`, `onHealTargetDestroyed?(victim)`.
- `applyVictimDamage(damage, victim, sink, …)` (~2168+) calls the hooks at ~2173 (`sink.addIncoming`), ~2196 (`addBarrierAbsorbed`), ~2211 (`addShieldAbsorbed`). It has `victim` in scope at all three.
- `playerSink` bumps the scalars at ~2291–2306 (and writes `healTargetDestroyedRound` via `onHealTargetDestroyed`). `enemySink` (~2320–2324) no-ops all three (player→dummy intake is NOT "incoming" — that's outgoing damage, already tracked in `roundDamage`).
- Post-round, the scalars are read once into the `HealingRoundEngine` row at ~3880–3882.
- **DPS mode** runs with `healing: undefined`; the enemy→player intake never fires (no enemy attackers / the dummy deals no return damage in DPS), and `enemySink` no-ops anyway → the per-actor bucket is never written in DPS mode → DPS goldens trivially byte-identical.
- **Healing goldens** snapshot the ADAPTER output (`HealingRoundData`), not the raw `HealingRoundEngine`. Adding an unread field to `HealingRoundEngine` leaves the adapter output byte-identical.

## File Structure

- **Modify:** `src/utils/combat/engine.ts`:
  - `DamageAccountingSink` interface (~1013–1022) — add a victim-id param to the three add-hooks.
  - The 3 hook call sites in `applyVictimDamage` (~2173/2196/2211) — pass `victim.id`.
  - `playerSink` (~2291–2306) — write the per-actor bucket alongside the scalars; `enemySink` (~2320–2324) — keep no-op (ignore the new param).
  - Per-round bucket map declaration (near ~2108–2113).
  - `HealingRoundEngine` type (~983–1004) + the post-round row assembly (~3880–3882) — add the additive `perActorIncoming` field.
- **Create:** `src/utils/combat/__tests__/perActorIncoming.test.ts` — locks bucket == scalar for the heal target.
- **Do NOT touch:** `healingEngineAdapter.ts`, `dpsSimulator.ts`, `battleSimulator.ts` (no reader changes — that's PR5b).

---

### Task 1: Define the per-actor intake bucket type + sink threading (no behavior change)

**Files:** Modify `src/utils/combat/engine.ts`.

- [ ] **Step 1: Read the sites first.** Read `engine.ts` ~983–1022 (HealingRoundEngine + DamageAccountingSink), ~2108–2113 (scalars), ~2168–2330 (applyVictimDamage + playerSink + enemySink), ~3880–3882 (row assembly). Confirm the exact identifiers (`roundIncomingDamage` etc., `victim`, `playerSink`, `enemySink`) before editing.

- [ ] **Step 2: Add the bucket type + the additive result field.**
  - Define an intake bucket shape (co-locate near `HealingRoundEngine`):
    ```ts
    /** Per-victim incoming accounting (PR5a foundation — written in parallel with the
     *  heal-target scalars; no reader until PR5b flips them). Keyed by victim actor id. */
    interface ActorIntake {
        incoming: number;
        shieldAbsorbed: number;
        barrierAbsorbed: number;
    }
    ```
  - Add `perActorIncoming: Map<string, ActorIntake>;` to `HealingRoundEngine` (additive; document it as the PR5a foundation, unread by adapters).

- [ ] **Step 3: Thread the victim id through the sink add-hooks.** Change `DamageAccountingSink`:
    ```ts
    addIncoming: (amount: number, victimId: string) => void;
    addShieldAbsorbed: (amount: number, victimId: string) => void;
    addBarrierAbsorbed: (amount: number, victimId: string) => void;
    ```
  Update the 3 call sites in `applyVictimDamage` to pass `victim.id`: `sink.addIncoming(damage, victim.id)`, `sink.addBarrierAbsorbed(damage, victim.id)`, `sink.addShieldAbsorbed(absorbed, victim.id)`. (Match the actual local variable names for the amounts at each site.)

- [ ] **Step 4: Declare the per-round bucket map + populate in playerSink.**
  - Near the scalar declarations (~2108–2113): `const perActorIncoming = new Map<string, ActorIntake>();` (fresh each round — declare it in the SAME scope/loop iteration the scalars live in).
  - Add a small get-or-create helper inline (or a `const intakeFor = (id: string) => { … }` closure) returning the map entry, creating `{incoming:0, shieldAbsorbed:0, barrierAbsorbed:0}` on first access.
  - In `playerSink`, alongside each scalar bump, bump the bucket:
    ```ts
    addIncoming: (amount, victimId) => { roundIncomingDamage += amount; intakeFor(victimId).incoming += amount; },
    addShieldAbsorbed: (amount, victimId) => { roundShieldAbsorbed += amount; intakeFor(victimId).shieldAbsorbed += amount; },
    addBarrierAbsorbed: (amount, victimId) => { roundBarrierAbsorbed += amount; intakeFor(victimId).barrierAbsorbed += amount; },
    ```
  - In `enemySink`, the add-hooks stay no-ops — accept the new `victimId` param and ignore it (the bucket must NOT record player→dummy intake).

- [ ] **Step 5: Populate the result field.** At the post-round row assembly (~3880–3882), add `perActorIncoming,` to the `HealingRoundEngine` row object (the same map instance built this round). Do NOT change `incomingDamage`/`shieldAbsorbed`/`barrierAbsorbed` (still the scalars — readers flip in PR5b).

- [ ] **Step 6: tsc + lint.** Run `npx tsc --noEmit` and `npm run lint` — clean.

- [ ] **Step 7: Commit.**
```bash
git add src/utils/combat/engine.ts
git commit -m "feat(combat): per-actor incoming accounting buckets, written in parallel (PR5a foundation)"
```

---

### Task 2: Lock the parallel-write correctness + byte-identical goldens

**Files:** Create `src/utils/combat/__tests__/perActorIncoming.test.ts`.

- [ ] **Step 1: Write the correctness test.** In a single-target healing scenario (mirror the healing fixtures in `decrementUnification.test.ts` / `healing` engine tests — set `healTargetId`, one or more enemy attackers that deal damage / drain shield / are blocked by a Barrier so all three channels are exercised across rounds), run `runCombat` and read the `HealingRoundEngine` rows from the result. Assert, for each round:
  - `row.perActorIncoming.get(healTarget.id)?.incoming === row.incomingDamage`
  - `…?.shieldAbsorbed === row.shieldAbsorbed`
  - `…?.barrierAbsorbed === row.barrierAbsorbed`
  - **Non-vacuous:** assert that across the run at least one round has a non-zero `incomingDamage` (and, if the fixture exercises shield/barrier, non-zero shieldAbsorbed/barrierAbsorbed) AND that the heal target has a bucket entry — so the equality can't pass by everything being zero / the map being empty.
  - Assert NO bucket entry exists for the dummy enemy id `'enemy'` (player→dummy intake must not be recorded as incoming).

- [ ] **Step 2: Run the test.** `npm test -- src/utils/combat/__tests__/perActorIncoming.test.ts` — expect PASS.

- [ ] **Step 3: Byte-identical goldens.** Run the DPS + healing golden parity suites (`npm test -- dpsGoldenParity healingGoldenParity`). Expect PASS with ZERO snapshot movement; confirm `git status --short` shows no `.snap`/golden file changed. If a golden moved, the additive field leaked into an adapter path — STOP and diagnose (the adapter must not read `perActorIncoming` in PR5a).

- [ ] **Step 4: Full suite + gates.** `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run audit:skills` (0/141).

- [ ] **Step 5: Commit.**
```bash
git add src/utils/combat/__tests__/perActorIncoming.test.ts
git commit -m "test(combat): lock per-actor incoming bucket == heal-target scalar (PR5a)"
```

---

### Task 3: Verification sweep

- [ ] **Step 1:** No changelog entry (internal foundation, no user-visible change) — confirm and skip.
- [ ] **Step 2:** `git diff feat/combat-sim-phase5-pr2...HEAD --stat` — confirm only `engine.ts`, `perActorIncoming.test.ts`, and this plan doc changed; no adapter files, no golden snapshots.
- [ ] **Step 3:** Hand off for final holistic review.

---

## Notes for the executor

- **Branch:** `feat/combat-engine-unify-pr5a-incoming-buckets` (already created off the PR4 tip `9cea0ea3` on `feat/combat-sim-phase5-pr2`). Will be locally squash-merged into `feat/combat-sim-phase5-pr2` (matching PR4), then PR5b branches off the new tip.
- **The load-bearing invariant:** PR5a is BYTE-IDENTICAL for all goldens. The bucket is write-only; nothing reads it until PR5b. If any golden moves, a reader leaked — fix the seam, never `vitest -u`.
- **Do NOT** flip any reader (`incomingDamage`/`shieldAbsorbed`/`barrierAbsorbed` stay sourced from the scalars), touch `healTargetDestroyedRound`, wire `indestructible`, or modify any adapter. Those are PR5b–e.
- **Workflow:** `gh auth switch --hostname github.com --user TheSusort` before any push. docs gitignored → `git add -f`, `--no-verify` for docs-only commits. `git push … | cat`.
