# A-Closeout — Live Debuff-Landing as Sole Producer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `liveDebuffLandingChance` the sole producer of debuff-landing chance — remove the `liveLandingComputable` ternary and delete the now-dead static `debuffLandingChance` scalar in all three forms (focus / enemy-attacker / walked-team), converting the 8 behavioral non-default test fixtures (across 5 files) to stat-based landing. Closes sub-project A.

**Architecture:** The live stat-based path is already self-sufficient (A.2-partial: `liveDebuffLandingChance` defaults missing hacking→200 / security→100). Production already always uses it (every actor has bases), so the static scalar is dead weight. We remove the ternary + closure fallbacks (behavior commit, 8 fixtures converted), then delete the scalar fields + dead computations (tsc-guided mechanical), then unify the triggers read (A.1).

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-17-a-closeout-landing-sole-producer-design.md`. Epic: `docs/superpowers/specs/2026-06-17-combat-realism-epic-roadmap.md`.

**Gate:** **Production BYTE-IDENTICAL** — `battleSimulator`, `twoTeamBattle`, `dpsGoldenParity`, healing goldens must NOT move (`git status --porcelain | grep '\.snap'` empty after every task). The only changes are the 8 behavioral fixtures' INPUTS (same assertions), the 2 bucket-C assertion deletions, and the 84 inert `debuffLandingChance: 1` line deletions. **Never blind `vitest -u`** — if any `.snap` moves, STOP and report.

**Workflow:** Main checkout, branch `feat/combat-sim-phase5-pr2` (no fresh worktree — esbuild crash). `gh auth switch --hostname github.com --user TheSusort` only for PR ops. Docs gitignored → `git add -f` + `--no-verify`.

**Test runner:** NEVER bare `npm test` (Vitest WATCH — hangs). Use `npx vitest run <name>` / `npx vitest run`; `npx tsc --noEmit`; `npm run lint` (max-warnings 0, EVERY task); `npm run audit:skills`.

---

## Background (read first)

`liveDebuffLandingChance` (`effectiveStats.ts`) is already the self-sufficient producer: it defaults a
missing attacker `hacking → 200` and defender `security → 100`, reproducing the old static formula for
base-less/neutral actors. `playerTurn.ts:699-721` gates it behind
`liveLandingComputable = actor.stats.hacking !== undefined && enemy.stats.security !== undefined`,
falling back to a static `debuffLandingChance` scalar. In production that gate is ALWAYS true (every
actor has bases), so the scalar is never read — it is dead weight that only 7 test fixtures rely on.

**Fixture inventory — DO NOT trust a literal grep alone.** A plain `grep "debuffLandingChance: [0-9.]"`
undercounts: several files thread the non-default chance through a HELPER PARAMETER, so the behavioral
`0`/`0.5` never appears as a literal (and some literal `: 0` hits are `it()` test-NAME strings, not
values). Classify EVERY `debuffLandingChance` reference in tests into one of three buckets and handle
accordingly:

- **(A) Inert default** — `debuffLandingChance: 1` literal (≈84, many in per-file `baseInput`/`mkInput`
  helpers). Byte-identical to the live default (200 vs 100 → 1.0). **Just delete the line** (Task 2).
- **(B) Behavioral non-default** — a `0` or `0.5` chance that drives an assertion, whether a literal OR
  threaded through a helper param. **Convert to stat bases** (Task 1). Known sites:
  - `triggers.test.ts` — literals: ≈:295 (focus `baseInput`, `0`), :933 (enemy, `0`), :1419 (enemy, `0`),
    :1060 (`0.5`).
  - `resistedEnemyDotsRoundEffects.test.ts` — helper `dotEnemy(dlc)` / `runWithEnemy(0)` (≈:55/:87/:104).
  - `resistedEnemyDebuffsRoundEffects.test.ts` — helper `debuffEnemy(dlc)` / `runWithEnemy(0)` (≈:55/:89/:106).
  - `enemyDebuffLandingChance.test.ts` — helper `dotEnemy(dlc)` / `countDotApplied(0,…)` (≈:59/:92/:115).
  - `enemyBuffSelfDebuffGate.test.ts` — helper `provokeEnemy(dlc)` / `provokeEnemy(0)` (≈:515-521/:566).
  - `dynamicLanding.test.ts` — test-local input/runtime types carry `debuffLandingChance?` (≈:77/:134,
    :206/:225); these feed `PlayerActorRuntime`/input directly (the field Task 2 deletes).
- **(C) Asserts on the deleted field** — two sites that unit-test code producing the scalar we delete;
  they **cannot** be byte-identical. (Both handled in Task 2.)
  - `healingEngineAdapter.test.ts:905-1023` — a describe-block reading `cap.enemyAttackers[0].debuffLandingChance`
    (8 assertions, ≈:947/:961/:975/:989/:990/:1004/:1020/:1021). **Delete the whole describe-block** (its
    landing coverage now lives in `dynamicLanding.test.ts` + engine landing tests). Only if it asserts
    something NOT otherwise covered, rewrite minimally to assert via stat bases / observable outcome.
  - `teamActorWalk.test.ts:23` — `expect(w.debuffLandingChance).toBe(1)` inside the `synthesizeBuffOnlyWalk`
    describe-block (added in the A.3 migration). It asserts the synthesized field Task 2 removes from
    `teamActorWalk.ts:32`. **Delete just that one assertion line**; the rest of the describe-block stays.

**Conversion rule (bucket B):** `0` → set the APPLYING actor's `stats.hacking: 0` (→ effective hacking 0
→ `clamp(0 − security)/100 = 0` regardless of target security). `0.5` → `hacking: 150` with the target at
default security 100 (→ 0.5). For helper-based fixtures, the cleanest conversion is to give the helper a
`hacking` parameter instead of `debuffLandingChance` (so `runWithEnemy`/`provokeEnemy`/`dotEnemy` build the
enemy with `stats.hacking` and the existing `it()` assertions are untouched).

---

## File structure

- **Modify (production):** `playerTurn.ts` (ternary + param), `engine.ts` (3 scalar fields + closures +
  runtime field), `effectiveStats.ts` (no change — already self-sufficient), `triggers.ts` (closure +
  A.1 accessor), `dpsSimulator.ts` (static formula + `deriveTeamEngineActors` teamLandingChance),
  `battleSimulator.ts` (`landingChance` + threading), `healingEngineAdapter.ts` (:177/:221/:238),
  `teamActorWalk.ts` (drop the synthesized `debuffLandingChance`).
- **Modify (tests):** the 8 behavioral non-default fixtures (convert) + 2 bucket-C assertion sites
  (`healingEngineAdapter.test.ts`, `teamActorWalk.test.ts`) + ~40 files with `debuffLandingChance: 1`
  (delete the line; tsc surfaces each once the fields are gone).

---

## Task 1: Collapse the ternary + retire closure fallbacks + convert the 8 behavioral fixtures (BEHAVIOR commit)

This is the only behavior-sensitive task. After it, `runtime.liveDebuffLandingChance` is always set and
no closure reads the scalar. The scalar FIELDS remain (Task 2 deletes them), so the 84 `:1` tests still
compile and stay byte-identical.

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (`liveLandingComputable` ternary ~:699-721)
- Modify: `src/utils/combat/engine.ts` (closures ~:532 enemy, ~:1319 focus, ~:1451 walked)
- Modify: `src/utils/combat/triggers.ts` (~:932 DoT read)
- Modify the bucket-(B) fixtures (Background): `triggers.test.ts`, `resistedEnemyDotsRoundEffects.test.ts`,
  `enemyDebuffLandingChance.test.ts`, `resistedEnemyDebuffsRoundEffects.test.ts`,
  `enemyBuffSelfDebuffGate.test.ts`, `dynamicLanding.test.ts`

- [ ] **Step 1: Classify EVERY test `debuffLandingChance` reference BEFORE touching anything.** Run:
  ```
  grep -rn "debuffLandingChance" src/utils/combat/__tests__ src/utils/calculators/__tests__
  ```
  Bucket each hit per the Background: (A) inert `: 1` literal, (B) behavioral non-default (literal OR
  helper-threaded `0`/`0.5`), (C) asserts on the deleted field. Confirm:
  - bucket (B) = **8 behavioral conversions across 5 files** (triggers ×4 [:295/:933/:1419 `0`, :1060 `0.5`],
    resistedEnemyDots ×1, resistedEnemyDebuffs ×1, enemyDebuffLandingChance ×1, enemyBuffSelfDebuffGate ×1),
    PLUS `dynamicLanding.test.ts` test-local plumbing (inert — no behavioral value, just remove the field);
  - bucket (C) = exactly `healingEngineAdapter.test.ts:905-1023` AND `teamActorWalk.test.ts:23`.
  **If you find a bucket-(B) or (C) site NOT in this list, STOP and report the fuller inventory before
  converting** (the spec flagged enumeration as the main risk). In THIS task convert only bucket (B);
  bucket (A) deletions and the bucket (C) sites are Task 2.

- [ ] **Step 2: Collapse the ternary in `playerTurn.ts`.** Replace the `liveLandingComputable` block
  (~:699-721) so the live recompute is unconditional and the runtime field always set:
  ```typescript
  const liveLandingChance = liveDebuffLandingChance(
      statusEngine,
      selfBuffLookup,
      actor,
      enemy,
      affinityDamageModifier
  );
  const landsTimedEnemyApplicationLive = (application?: 'inflict' | 'apply'): boolean =>
      application === 'apply' ? !affinityDisadvantage : debuffLandingGate(liveLandingChance);
  runtime.liveDebuffLandingChance = liveLandingChance; // always set now
  statusEngine.setLandsTimedEnemyApplication((buff) =>
      landsTimedEnemyApplicationLive(buff.application)
  );
  ```
  (Keep the existing surrounding comments updated minimally. Do NOT remove the `debuffLandingChance`
  param yet — Task 2 does that.)

- [ ] **Step 3: Retire the closure `?? scalar` reads in `engine.ts`.** At the three closures, drop the
  `?? <scalar>` tail, keeping a neutral `?? 1` ONLY as a read-before-set guard:
  - enemy ~:532: `runtime.liveDebuffLandingChance ?? e.debuffLandingChance ?? 1` → `runtime.liveDebuffLandingChance ?? 1`
  - focus ~:1319: `attackerRuntime.liveDebuffLandingChance ?? debuffLandingChance` → `attackerRuntime.liveDebuffLandingChance ?? 1`
  - walked ~:1451: `runtime.liveDebuffLandingChance ?? w.debuffLandingChance` → `runtime.liveDebuffLandingChance ?? 1`
  And in `triggers.ts` ~:932: `owner.liveDebuffLandingChance ?? owner.debuffLandingChance` →
  `owner.liveDebuffLandingChance ?? 1`. (A.1 in Task 3 extracts this into one accessor.)

  > Rationale for `?? 1`: `liveDebuffLandingChance` is set at the start of every `runPlayerTurn`; DoTs/
  > reactives draw their OWNER's chance (owner applied them on its own turn → field set). The `?? 1` is a
  > defensive neutral default to avoid `undefined`/NaN if ever read before the owner's first turn. It is
  > NOT the scalar.

- [ ] **Step 4: Convert the bucket-(B) fixtures to stat bases.** For EACH, replace the chance with
  `stats.hacking` on the APPLYING actor reproducing the same chance, keeping EXISTING assertions:
  - `0` → `hacking: 0` (effective hacking 0 → `clamp(0 − security ≥ 0) = 0` regardless of target security).
  - `0.5` → `hacking: 150` (target keeps default security 100 → 0.5).
  Per-file:
  - **triggers.test.ts** (literals): set `hacking` on the focus `baseInput` (:295 case) / on the
    `enemyAttackers[]` entry (:933, :1419, :1060) and remove each `debuffLandingChance` line.
  - **resistedEnemyDots / resistedEnemyDebuffs / enemyDebuffLandingChance** (helper-based): change the
    helper (`dotEnemy`/`debuffEnemy`) to take a `hacking` param and set `stats.hacking` on the enemy instead
    of `debuffLandingChance`; update call sites (`runWithEnemy(0)` → pass hacking 0; `(1)` → omit/default).
  - **enemyBuffSelfDebuffGate.test.ts**: same — `provokeEnemy(dlc)` → `provokeEnemy(hacking)`; `provokeEnemy(0)`
    → enemy hacking 0; the `(1)`/`(undefined)` cases → default (omit).
  - **dynamicLanding.test.ts**: this file already exercises the LIVE path via hacking/security. Remove the
    test-local `debuffLandingChance?` fields (≈:77/:206) and the two assignment sites (≈:134/:225); for any
    assertion that depended on the scalar (not on hacking/security), set the actor's `hacking` to reproduce
    the chance. Verify every assertion still holds.
  Run: `npx vitest run triggers resistedEnemyDotsRoundEffects enemyDebuffLandingChance resistedEnemyDebuffsRoundEffects enemyBuffSelfDebuffGate dynamicLanding`
  → all PASS with unchanged assertions.

  > `hacking: 0` forces effective hacking 0 → landing 0 in all affinities. If a fixture resists differently
  > than expected, inspect the actual result and pin the REAL behavior; do NOT weaken the assertion. Leave
  > the `debuffLandingChance` INPUT FIELDS in place for now (Task 2 deletes them) — converting here means
  > adding `hacking` and removing the per-fixture `debuffLandingChance`, so these files end Task 1 with no
  > `debuffLandingChance` references.

- [ ] **Step 5: Verify production parity.** `npx vitest run` → all green. `git status --porcelain | grep '\.snap'`
  → EMPTY (zero snapshot churn — production byte-identical). `npx tsc --noEmit` clean. `npm run lint` → 0.

  > If ANY `.snap` moved, STOP and report — production was supposed to be byte-identical.

- [ ] **Step 6: Commit.**
  ```bash
  git add -A
  git commit -m "refactor(combat): A-closeout — live landing is sole producer (collapse ternary, retire closure fallbacks); convert 7 fixtures to stat-based (byte-identical)"
  ```

---

## Task 2: Delete the static scalar fields + dead computations + the 84 `:1` lines (tsc-guided)

Pure mechanical removal — the scalar is now unread. tsc lists every remaining usage; delete each.

**Files:**
- Modify: `src/utils/combat/engine.ts` — `CombatEngineInput.debuffLandingChance` (~:817) + destructure
  (~:1089); `EnemyActorInput.debuffLandingChance` (~:886) + enemy runtime init (~:509);
  `walk.debuffLandingChance` (~:770) + walked runtime init (~:1467); `runtime.debuffLandingChance`
  field (`PlayerActorRuntime` + enemy runtime shape).
- Modify: `src/utils/combat/playerTurn.ts` — the `debuffLandingChance` param/field (~:156/:630).
- Modify: `src/utils/calculators/dpsSimulator.ts` — static formula (~:243-246) + `runCombat` arg (~:278);
  `deriveTeamEngineActors` `teamLandingChance` (~:187) + the `walk.debuffLandingChance` it sets.
- Modify: `src/utils/calculators/battleSimulator.ts` — `landingChance()` (~:593-600) + the three
  threading sites (~:631 focus, ~:656 enemy-attacker, ~:687 walked/focusLanding). tsc-guided; confirm all.
- Modify: `src/utils/calculators/healingEngineAdapter.ts` — compute (~:177) + threading (~:221/:238).
- Modify: `src/utils/combat/teamActorWalk.ts` — drop `debuffLandingChance: 1` from the synthesized walk.
- Modify: ~40 test files — delete every `debuffLandingChance: 1` line (and the `debuffLandingChance?` from
  any test-local input type/helpers).

- [ ] **Step 1: Remove the production field declarations + dead computations** listed above. After each
  removal, expect tsc to flag downstream readers — follow the errors.

- [ ] **Step 2: Handle the bucket-(C) sites FIRST** (they assert on the field, not inert deletions):
  - `healingEngineAdapter.test.ts:905-1023` — describe-block asserting `cap.enemyAttackers[0].debuffLandingChance`
    (the adapter producing the deleted scalar). **Delete the describe-block.** The landing behavior is now
    tested live (`dynamicLanding.test.ts` + engine landing tests). If on reading it asserts adapter behavior
    NOT covered elsewhere, instead rewrite to check the adapter threads `hacking`/`enemySecurity` bases — but
    default to deletion.
  - `teamActorWalk.test.ts:23` — `expect(w.debuffLandingChance).toBe(1)`. **Delete that single assertion
    line** (keep the rest of the `synthesizeBuffOnlyWalk` describe-block).
  Run `npx vitest run healingEngineAdapter teamActorWalk` → green.

- [ ] **Step 3: Run tsc and delete every remaining flagged usage.** `npx tsc --noEmit` → it lists each
  remaining `debuffLandingChance` reference: the 84 inert `: 1` test lines + any test-local
  `debuffLandingChance: number` in input-builder types/helpers (e.g. the `dynamicLanding` locals already
  handled in Task 1; verify none remain). Delete each. Re-run until tsc is clean.

  > The 84 `debuffLandingChance: 1` test lines are byte-identical to delete (live default = 1.0). Many sit
  > in per-file `baseInput`/`mkInput` helpers — deleting from the helper covers many tests at once. Do NOT
  > change any assertion; only delete the inert input line.

- [ ] **Step 4: Verify byte-identity.** `npx vitest run` → all green, SAME snapshots as end of Task 1
  (`git status --porcelain | grep '\.snap'` → EMPTY). `npx tsc --noEmit` clean. `npm run lint` → 0.

  > If a snapshot moves or a test fails, a deletion changed behavior — STOP and report.

- [ ] **Step 5: Commit.**
  ```bash
  git add -A
  git commit -m "refactor(combat): A-closeout — delete dead static debuffLandingChance (fields, runtime, computations) + inert :1 test lines"
  ```

---

## Task 3: A.1 — unify the `triggers.ts` live-landing read

**Files:**
- Modify: `src/utils/combat/triggers.ts` (~:896 timed closure, ~:932 DoT read)

- [ ] **Step 1: Extract one accessor.** Add a tiny local, e.g.
  `const actorLiveLanding = (owner: …) => owner.liveDebuffLandingChance ?? 1;` and use it at the DoT read
  (~:932): `if (!owner.debuffLandingGate(actorLiveLanding(owner)))`. The timed path (~:896
  `owner.landsTimedEnemyApplication(cfg.application)`) keeps its closure (it carries the `'apply'`/
  `'inflict'` distinction) — A.1 removes only the duplicated direct field read, not the apply/inflict logic.

  > If the codebase prefers inlining over a 1-liner helper, a shared `const` at the call site is fine — the
  > goal is a single source for the read. Keep it minimal and byte-identical.

- [ ] **Step 2: Verify byte-identity.** `npx vitest run triggers` + `npx vitest run` → green, ZERO `.snap`
  movement. `npx tsc --noEmit` clean. `npm run lint` → 0.

- [ ] **Step 3: Commit.**
  ```bash
  git add -A
  git commit -m "refactor(combat): A-closeout — A.1 unify triggers live-landing read behind one accessor"
  ```

---

## Task 4: Full gate + sub-project A closure

**Files:** none (verification only).

- [ ] **Step 1:** `npx vitest run` → all green.
- [ ] **Step 2:** `npm run lint` → 0 warnings.
- [ ] **Step 3:** `npx tsc --noEmit` → clean.
- [ ] **Step 4:** `npm run audit:skills` → 0 findings / 141 ships.
- [ ] **Step 5:** Confirm ZERO combat `.snap` moved across the WHOLE closeout
  (`git diff <base>..HEAD --stat -- '*.snap'` empty) — only the 8 fixtures' inputs, 2 bucket-C deletions, and the 84 inert
  deletions changed in tests.
- [ ] **Step 6:** `grep -rn "debuffLandingChance" src/` → only incidental/comment references remain, no
  live scalar field or fallback. `git status` clean.

---

## Done criteria (closes sub-project A)
- `liveDebuffLandingChance` is the sole landing producer; the `liveLandingComputable` ternary is gone.
- The static `debuffLandingChance` scalar is deleted in all three forms + the dead computations
  (dpsSimulator / deriveTeamEngineActors / battleSimulator / healingEngineAdapter / teamActorWalk).
- `triggers.ts` reads the live chance through one accessor (A.1).
- Production byte-identical (zero `.snap` movement); only the 8 behavioral non-default fixtures converted
  (assertions unchanged) and the 84 inert `: 1` lines removed.
- Suite + lint + tsc + audit:skills clean. **Sub-project A CLOSED.** Next: sub-project B (Stasis).
