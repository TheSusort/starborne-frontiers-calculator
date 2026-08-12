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

(none complete yet)
