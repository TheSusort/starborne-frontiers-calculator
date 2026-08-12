# SP-3 — Healing Calculator: Real Positional Enemy + Positional Heals (SDD ledger)

Plan: docs/superpowers/plans/2026-08-12-sp3-healing-real-positional-enemy.md (committed 739219bd)
Spec: docs/superpowers/specs/2026-08-12-sp3-healing-real-positional-enemy-design.md (34c64da5)
Working dir: primary repo (NOT a worktree — tasks are sequential, and a fresh worktree
would need .env + docs/*.json + docs/*.csv copied in)

## Branches (three PRs)

- PR 3a `sp3a-healing-per-recipient-axis` — base 739219bd — Tasks 1-3
- PR 3b `sp3b-healing-positional-adapter` — base = main after 3a merges — Tasks 4-7
- PR 3c `sp3c-healing-placement-ui` — base = main after 3b merges — Tasks 8-9

## Controller-resolved ambiguities (do not re-derive)

- **Task 6 Step 4: `enemySecurity` / `enemySpeed` are BOTH OPTIONAL** on `CombatEngineInput`
  (`engine.ts:1180`, `:1186`). Resolution: **drop them** from the `runCombat` call rather than
  passing legacy-sink values.
- **Task 7 fixture pattern coverage CONFIRMED**: `'line|3|support'` is
  `[ORIGIN, cov(1,0), cov(2,0), cov(3,0)]` (`patternOffsets.ts:86`), so
  `Pattern-Line-Support-Range-3 @ M2` covers **M2, M3, M4** (the 4th cell clips off-board).
  Both allies at M3 and M4 ARE on the footprint. No fixture adjustment needed.

## Pre-flight ruling (owner, 2026-08-12)

- **Test fixtures are COPIED VERBATIM between test files, not extracted to `__testutils__`.**
  The plan mandates it (Task 2 Step 1, Task 7 Step 1) and the owner confirmed the plan governs:
  each test file stays independently readable when opened cold.
  **This is a ruled trade-off, not an oversight.** If a task reviewer or CodeRabbit flags the
  duplication, the controller ADJUDICATES with this ruling — do not dispatch a fix that extracts
  the fixtures. (Reviewers are never told what not to flag; the finding is simply resolved here.)

## Notes for every implementer

- husky pre-commit runs the FULL `npm test` (~minutes). Commits are slow; that is expected.
- **NEVER `vitest -u`.** Zero `.snap` movement is a hard gate in PR 3a.
- `src/components/ui/Select.tsx` is a PORTAL-BASED custom component, not a native `<select>`.
  Drive it with `fireEvent.click(getByLabelText(label))` then `fireEvent.click(getByText(option))`.
- Heals follow the caster's targeting PATTERN, never lowest HP. Only Volk repairs by lowest HP and
  that is its PASSIVE. Never adopt `teamBattle`'s `lowestHpAllyId` branch for the healing calculator.

## Tasks

Task 1: complete (commits 22222b6a..9e855ebd, review clean — spec ✅, quality Approved)
  - `perRecipientHealApply` input → `perRecipientApply` ctx flag; application site `playerTurn.ts:3637`
    switched off `teamBattle`; the lowest-HP routing line `playerTurn.ts:3353` UNTOUCHED (verified).
  - 6 tests; full suite 502 files / 5623 tests; ZERO `.snap` movement (verified across 2d5e9fee..9e855ebd).
  - **THREE plan-fixture defects found before any production edit** (implementer stopped each time
    instead of hacking the fixture — the right call):
    1. Direct-engine team actors need an explicit `walk` bundle; `normalizeTeamActorsToWalked`
       (`teamActorWalk.ts:47`) otherwise synthesizes `NEUTRAL_WALK_STATS` with **hp: 1**, silently
       discarding a bare `stats.hp`. Only the ADAPTER builds walk bundles.
    2. **`resolveSupportRecipients` FILTERS `baseRecipients` by the footprint; it never expands.**
       `recipientsFor` collapses a single-`ally` heal to `[healing.targetId]`, so multi-ally pattern
       healing comes ONLY from `all-allies` abilities.
    3. `lowestHpAllyId` compares HP **fractions**, not absolute HP — equal fractions tie and resolve
       by iteration order.
  - **Review finding (Important, FIXED in 9e855ebd):** the fence's first test named
    `perRecipientHealApply` but was structurally insensitive to it — with `teamBattle` false the base
    is one element, and `applyHealToTarget(raw, victim = healTarget)` (`engine.ts:2984`) lands on the
    same actor with or without the flag. Fixed by asserting routing-neutrality as an explicit
    invariant (a third test with no flags that must agree with the flag-on test).
  - MINOR for final review: fence tests 1 and 3 dereference `target!.currentHp` without a
    `toBeDefined()` guard (Fixture A's tests do guard) — fails via TypeError rather than a clean
    assertion message. Cosmetic.

Task 2: complete (commits d04f7e2e..e55f2897, review clean — spec ✅, quality Approved)
  - `HealingRoundEngine.perRecipient` + `creditRecipient?` (optional, `?.`-invoked); rebound at
    `engine.ts:7179` immediately after `currentRoundHealing` (verified: that is the ONLY rebind site).
  - Purely additive (+205/−0 in the task commit); 503 files / 5626 tests; ZERO `.snap` movement.
  - **Review finding (Important, FIXED in e55f2897):** the "recipient axis sums to source axis" test
    was vacuous on the RECIPIENT-COUNT axis. The reviewer instrumented the real fixture and dumped
    both maps: the healer starts at FULL HP so its `all-allies` self-share is 100% overheal
    (`effectiveHeal: 0`), leaving exactly ONE non-zero recipient — and a sum is invariant to which key
    holds the value. Fixed by damaging the focus healer too (two non-zero recipients) plus explicit
    per-entry preconditions.
  - MINOR for final review: the two recipients' shares are numerically EQUAL (5000/5000) in that
    fixture, so a bug that SWAPPED which key holds which share would still pass — no assertion ties a
    specific value to a specific recipient, only positivity. Fixture symmetry, not a design flaw.

### Verified facts for Task 3 (do not re-derive)

- Oracle command: **`npm run audit:placement-symmetry`** (`package.json:50` → `scripts/auditPlacementSymmetry.ts`).
- Concrete stale-comment targets after Tasks 1-2:
  - `playerTurn.ts:3633` — "calculator (teamBattle off) keeps single-target accounting on
    healing.targetId" — now governed by `perRecipientApply`, not `teamBattle`. STALE.
  - `playerTurn.ts:3636` — our own new comment cites `:3350`, but the routing line is now **`:3356`**.
    Self-inflicted stale line reference.
  - `playerTurn.ts:171-174` — the `teamBattle` doc should name `perRecipientApply` as the application
    signal while `teamBattle` remains the lowest-HP-routing signal.
  - `playerTurn.ts:3355` — routing comment, same correction as `:3633`.

### Carried findings for the SPEC (write up before PR 3a merges)

- **A single-`ally` heal can now be filtered to EMPTY.** Once positional, if the configured heal
  target stands off the caster's support footprint, `base = [targetId]` is filtered out and the heal
  reaches NOBODY. Previously inert (no positions → `footprintAllyIdsFor` returns `undefined`).
  Sharper than "the heal target may take no damage" — raised with the owner; may affect the
  placement-UI decision, since dropdowns do not make a footprint visible.
- **Deferred backlog item:** the battle sim's `teamBattle` → `lowestHpAllyId` applies to EVERY player
  single-`ally` heal, though by the owner's Volk ruling only a passive should behave that way. Likely
  latent sim defect; explicitly out of SP-3 scope (moving it would shift sim goldens).
