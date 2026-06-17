# A-Closeout — Live Debuff-Landing as Sole Producer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `liveDebuffLandingChance` the sole producer of debuff-landing chance — remove the `liveLandingComputable` ternary and delete the now-dead static `debuffLandingChance` scalar in all three forms (focus / enemy-attacker / walked-team), converting the 7 non-default test fixtures to stat-based landing. Closes sub-project A.

**Architecture:** The live stat-based path is already self-sufficient (A.2-partial: `liveDebuffLandingChance` defaults missing hacking→200 / security→100). Production already always uses it (every actor has bases), so the static scalar is dead weight. We remove the ternary + closure fallbacks (behavior commit, 7 fixtures converted), then delete the scalar fields + dead computations (tsc-guided mechanical), then unify the triggers read (A.1).

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-17-a-closeout-landing-sole-producer-design.md`. Epic: `docs/superpowers/specs/2026-06-17-combat-realism-epic-roadmap.md`.

**Gate:** **Production BYTE-IDENTICAL** — `battleSimulator`, `twoTeamBattle`, `dpsGoldenParity`, healing goldens must NOT move (`git status --porcelain | grep '\.snap'` empty after every task). The only changes are the 7 non-default fixtures' INPUTS (same assertions) and the 84 inert `debuffLandingChance: 1` line deletions. **Never blind `vitest -u`** — if any `.snap` moves, STOP and report.

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

**The 7 non-default fixtures** (confirmed by `grep -rhn "debuffLandingChance:" … | grep -oE "debuffLandingChance: [0-9.]+" | sort | uniq -c` → `6×0`, `1×0.5`, `84×1`):
- `triggers.test.ts` — 3× `0` (≈:295 focus `baseInput`, :933 enemy-attacker, :1419 enemy-attacker) + 1× `0.5` (≈:1060).
- `resistedEnemyDotsRoundEffects.test.ts` — 1× `0` (enemy-attacker).
- `enemyDebuffLandingChance.test.ts` — 1× `0` (enemy-attacker).
- `resistedEnemyDebuffsRoundEffects.test.ts` — 1× `0` (enemy-attacker).

**Conversion rule:** `debuffLandingChance: 0` → set the applying actor's `stats.hacking: 0` (→ effective
hacking 0 → `clamp(0 − security)/100 = 0` regardless of target security). `debuffLandingChance: 0.5` →
`hacking: 150` with the target at the default security 100 (→ 0.5). The `84× debuffLandingChance: 1` are
byte-identical to the live default (200 vs 100 → 1.0) and just get deleted.

---

## File structure

- **Modify (production):** `playerTurn.ts` (ternary + param), `engine.ts` (3 scalar fields + closures +
  runtime field), `effectiveStats.ts` (no change — already self-sufficient), `triggers.ts` (closure +
  A.1 accessor), `dpsSimulator.ts` (static formula + `deriveTeamEngineActors` teamLandingChance),
  `battleSimulator.ts` (`landingChance` + threading), `healingEngineAdapter.ts` (:177/:221/:238),
  `teamActorWalk.ts` (drop the synthesized `debuffLandingChance`).
- **Modify (tests):** the 7 non-default fixtures (convert) + ~40 files with `debuffLandingChance: 1`
  (delete the line; tsc surfaces each once the fields are gone).

---

## Task 1: Collapse the ternary + retire closure fallbacks + convert the 7 fixtures (BEHAVIOR commit)

This is the only behavior-sensitive task. After it, `runtime.liveDebuffLandingChance` is always set and
no closure reads the scalar. The scalar FIELDS remain (Task 2 deletes them), so the 84 `:1` tests still
compile and stay byte-identical.

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (`liveLandingComputable` ternary ~:699-721)
- Modify: `src/utils/combat/engine.ts` (closures ~:532 enemy, ~:1319 focus, ~:1451 walked)
- Modify: `src/utils/combat/triggers.ts` (~:932 DoT read)
- Modify the 7 fixtures: `triggers.test.ts`, `resistedEnemyDotsRoundEffects.test.ts`,
  `enemyDebuffLandingChance.test.ts`, `resistedEnemyDebuffsRoundEffects.test.ts`

- [ ] **Step 1: Confirm the fixture count BEFORE touching anything.** Run:
  ```
  grep -rhn "debuffLandingChance:" src/utils/combat/__tests__ src/utils/calculators/__tests__ | grep -oE "debuffLandingChance: [0-9.]+" | sort | uniq -c
  ```
  Expected: `6` × `0`, `1` × `0.5`, `84` × `1`. **If the non-default count (`0`/`0.5`) is NOT 7 total, STOP and report** — the spec capped this at 7.

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

- [ ] **Step 4: Convert the 7 non-default fixtures.** For EACH, replace the `debuffLandingChance: N`
  line with stat bases on the APPLYING actor that reproduce chance N, and confirm the test still passes
  with its EXISTING assertions:
  - `: 0` → add/set `hacking: 0` on that actor's stats (focus actor: its `stats.hacking`; enemy attacker:
    its `stats.hacking`). Effective hacking 0 → landing 0 regardless of target security.
  - `: 0.5` → `hacking: 150` (target keeps default security 100 → 0.5).
  Locate the exact stat object per fixture by reading each test (focus fixtures set stats via `baseInput`;
  enemy-attacker fixtures set stats on the `enemyAttackers[]` entry). Remove the now-redundant
  `debuffLandingChance` line from each converted fixture. Run each file:
  `npx vitest run triggers resistedEnemyDotsRoundEffects enemyDebuffLandingChance resistedEnemyDebuffsRoundEffects`
  → all PASS with unchanged assertions.

  > If giving an enemy attacker `hacking: 0` does not reproduce landing 0 (e.g. the test's target lacks a
  > security base AND the affinity is non-neutral), re-confirm via the formula and adjust — but `hacking: 0`
  > forces effective hacking 0 → `clamp(0 − security ≥ 0) = 0`, so this should always yield 0. If a fixture
  > resists differently than expected, inspect the actual result and pin the real behavior; do NOT weaken
  > the assertion.

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
- Modify: `src/utils/calculators/battleSimulator.ts` — `landingChance()` (~:593-600) + the `:656`
  enemy-attacker threading (+ any focus/walked threading of the scalar).
- Modify: `src/utils/calculators/healingEngineAdapter.ts` — compute (~:177) + threading (~:221/:238).
- Modify: `src/utils/combat/teamActorWalk.ts` — drop `debuffLandingChance: 1` from the synthesized walk.
- Modify: ~40 test files — delete every `debuffLandingChance: 1` line (and the `debuffLandingChance?` from
  any test-local input type/helpers).

- [ ] **Step 1: Remove the production field declarations + dead computations** listed above. After each
  removal, expect tsc to flag downstream readers — follow the errors.

- [ ] **Step 2: Run tsc and delete every flagged usage.** `npx tsc --noEmit` → it will list each remaining
  `debuffLandingChance` reference (production threading + the 84 test lines + any test-local
  `debuffLandingChance: number` in input-builder types/helpers). Delete each. Re-run until tsc is clean.

  > The 84 `debuffLandingChance: 1` test lines are byte-identical to delete (live default = 1.0). Many sit
  > in per-file `baseInput`/`mkInput` helpers — deleting from the helper covers many tests at once. Do NOT
  > change any assertion; only delete the inert input line.

- [ ] **Step 3: Verify byte-identity.** `npx vitest run` → all green, SAME snapshots as end of Task 1
  (`git status --porcelain | grep '\.snap'` → EMPTY). `npx tsc --noEmit` clean. `npm run lint` → 0.

  > If a snapshot moves or a test fails, a deletion changed behavior — STOP and report.

- [ ] **Step 4: Commit.**
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
  (`git diff <base>..HEAD --stat -- '*.snap'` empty) — only the 7 fixtures' inputs and the 84 inert
  deletions changed in tests.
- [ ] **Step 6:** `grep -rn "debuffLandingChance" src/` → only incidental/comment references remain, no
  live scalar field or fallback. `git status` clean.

---

## Done criteria (closes sub-project A)
- `liveDebuffLandingChance` is the sole landing producer; the `liveLandingComputable` ternary is gone.
- The static `debuffLandingChance` scalar is deleted in all three forms + the dead computations
  (dpsSimulator / deriveTeamEngineActors / battleSimulator / healingEngineAdapter / teamActorWalk).
- `triggers.ts` reads the live chance through one accessor (A.1).
- Production byte-identical (zero `.snap` movement); only the 7 non-default fixtures converted
  (assertions unchanged) and the 84 inert `: 1` lines removed.
- Suite + lint + tsc + audit:skills clean. **Sub-project A CLOSED.** Next: sub-project B (Stasis).
