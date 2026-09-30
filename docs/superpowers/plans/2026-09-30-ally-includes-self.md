# "An ally" includes the caster; Grif hits each cleansed enemy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply two owner rulings from 2026-09-29 to the combat engine's reactive triggers.

**Architecture:** Five reactive triggers in `src/utils/combat/triggers.ts` guard on `isSameSideAlly` (same side AND not the owner). They switch to "same side, owner included" (`!isOpposing`). Two self-excluding triggers stay as they are. Grif's `on-enemy-cleansed` damage reaction fans out to one hit per cleansed enemy.

**Tech Stack:** TypeScript, vitest.

## Owner rulings (binding, do not re-derive)

1. **"an ally" in skill text includes the caster.** Only "another ally" / "other ally" excludes it. Passive reach stays board-wide (unchanged). The owner approved this per-trigger table on 2026-09-30:

   | Trigger (`triggers.ts`) | Ships | Change |
   |---|---|---|
   | `on-ally-debuffed` | Hayyan | include owner |
   | `on-ally-debuff-inflicted` | Belladonna, Oleander | include owner |
   | `on-ally-crit` | Sentinel, Howler, Hermes | include owner |
   | `on-ally-attacked` | Cultivator, Fuying, Guardian, Refine, Graphite, Centurion | include owner |
   | `on-ally-purged` | Salvation | include owner |
   | `on-ally-crit-dot` | Crocus ("When **another** ally…") | UNCHANGED, excludes owner |
   | `on-ally-destroyed` | Harvester | UNCHANGED, excludes owner (a destroyed ship cannot take the action) |

   The `'lowest-hp-ally'` recipient selector (Volk, Pallas, Valkyrie) is UNCHANGED: the owner ruled it keeps skipping the caster.
   Centurion's clause is "this Unit or an **adjacent** ally": its `requireDamagedAllyAdjacent` gate uses `adjacentAllyIdsFor(ownerId)`, which never contains the owner. So Centurion must NOT start double-retaliating on its own hits. A test must prove that.

2. **Grif** ("When an enemy cleanses a Debuff, this Unit deals 75% Damage that cannot critically hit"): the reaction fires once per cleanse cast **per enemy cleansed**, and hits that cleansed enemy. Example: Hayyan's active cleanses one debuff from Meiying and one from herself in one cast → Grif hits Meiying once and Hayyan once (two hits). Today he hits the cleanser (`counterTargetId: e.casterId`) once per cast. The same trigger's other users keep their current behaviour: Pestilence (Corrosion on all cleansed enemies, one reaction), Arum (Out. Damage Down on all cleansed enemies), Larkspur/Yarrow (self buff).

## Global Constraints

- Work in `/Users/kennethsusort/PersonalProjects/starborne-frontiers-calculator/.claude/worktrees/ally-self` (branch `fix/ally-includes-self`). `.env`, `docs/` reference data, `node_modules` (symlink) and `.husky/_` are in place. Do NOT delete, move or recreate `.env`.
- Node 22: prefix every `npx`/`npm` with `export PATH="$(ls -d ~/.nvm/versions/node/v22*/bin | tail -1):$PATH";`.
- Never run the Supabase CLI. **Never run `vitest -u` or otherwise update a snapshot.** If a golden snapshot moves (`src/utils/calculators/__tests__/__snapshots__/*.snap`, `src/utils/combat/__tests__/__snapshots__/*.snap`), STOP and report: the file, the moved keys, and which ship each key belongs to. Do not commit until the controller authorizes the move.
- Engine changes must be team-symmetric: every change applies to player-side and enemy-side owners alike. `isOpposing` is already side-relative.
- A test that asserted the old self-exclusion flips to the new rule. Rewrite it to assert the new behaviour and rename it to match; never delete it. Every new or flipped test must fail under the old guard. Prove it by running it once against the old code, and put the RED output in the report.
- Code comments: present-tense behaviour contracts only. No task numbers, no change history, no call-site counts. Where a comment above a changed guard says "Excludes this owner" / "ANY OTHER", rewrite it to the new rule and cite the ruling ("'an ally' includes the owner; only 'another ally' excludes it").
- Changelog (`src/constants/changelog.ts`, `UNRELEASED_CHANGES`, add at the top, verbatim):
  - `Combat simulator: skills that trigger on "an ally" now also trigger on the ship itself.`
  - `Combat simulator: Grif now hits every enemy whose debuff gets cleansed.`
- Commit trailer, exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
  ```
- No `--no-verify` on code commits. The pre-commit hook runs lint-staged, `tsc` and the full suite.

---

### Task 1: The five ally triggers include their owner

**Files:**
- Modify: `src/utils/combat/triggers.ts`: the guards in `case 'on-ally-debuff-inflicted'` (both the `debuff-applied` and `dot-applied` listeners, currently `isSameSideAlly(e.sourceId, ownerId)`), `case 'on-ally-crit'` (`!isSameSideAlly(e.actorId, ownerId)`), `case 'on-ally-debuffed'` (`isSameSideAlly(e.targetId, ownerId)`), `case 'on-ally-attacked'` (`!isSameSideAlly(e.targetId, ownerId)`), `case 'on-ally-purged'` (`isSameSideAlly(e.targetId, ownerId)`), and the trigger doc-comment block near the top of the file that describes these triggers ("not the owner itself").
- Leave untouched: `case 'on-ally-crit-dot'` and `case 'on-ally-destroyed'`, which keep `isSameSideAlly`.
- Also check the comment near `triggers.ts:2545` ("ALLY names, self-excluded — mirrors `isSameSideAlly`"). Work out which trigger(s) it serves. If it serves one of the five, the same inclusion applies there. If it serves only unchanged triggers, leave it. Report which.
- Tests: flip the existing self-exclusion tests and add new ones. Known flip candidates, not a complete list (grep for more):
  - `src/utils/combat/__tests__/allyDebuffReactivePromotion.integration.test.ts`: "…never to the owner" (~:206), "…not to itself" (~:222), "a debuff landing on Hayyan ITSELF … does NOT fire on-ally-debuffed" (~:451).
  - `src/utils/combat/__tests__/triggers.test.ts`: "fires when ANOTHER player actor is hit, not for own hits…" (~:2318), "scenario 16d: the heal target OWNING the on-ally-attacked ability does NOT fire on its own hits" (~:3963).
  - Also look in `allyCritReactivePromotion.integration.test.ts`, `sentinelAllyCritRouting.integration.test.ts`, `hermesAllyCritCharge.integration.test.ts`, `purgeReactiveIntegration.test.ts`, `corrosionToAcidicDecay.test.ts`.

**Interfaces:**
- Consumes: `isOpposing(actorId)` (side-relative, already in scope in `registerReactiveListeners`' closure beside `isSameSideAlly`).
- Produces: no new exports.

- [ ] **Step 1: Write failing tests, one per changed trigger, each an in-fight example.** Model each on the nearest existing test in the files above (same fixture helpers). Each must fail on the current code:
  1. `on-ally-debuffed`, Hayyan: an enemy's debuff lands on Hayyan herself → Hayyan repairs HERSELF for 6% of her Max HP.
  2. `on-ally-debuff-inflicted`, Belladonna: Belladonna's own active inflicts Corrosion I → her passive may convert it into Acidic Decay I. Pin the chance to certain, the way `corrosionToAcidicDecay.test.ts` does, and assert the conversion happened on Belladonna's own infliction.
  3. `on-ally-debuff-inflicted`, Oleander: Oleander's own debuff infliction adds 1 charge to her Charged Skill. If Oleander's real kit inflicts no debuff, build the ability directly, as the existing Oleander tests do.
  4. `on-ally-crit`, Sentinel: Sentinel's own crit makes her deal her passive's extra damage to that enemy, exactly once. The extra hit cannot crit, so assert there is no chain: exactly one reactive hit per own crit.
  5. `on-ally-attacked`, Guardian (or Refine): the owner is directly damaged (critically, for Guardian) → its own ally-attacked reaction fires on itself.
  6. `on-ally-attacked`, Centurion: an enemy hits Centurion → it retaliates ONCE, from its "this Unit" clause, not twice. An adjacent ally hit → it retaliates once (unchanged).
  7. `on-ally-purged`, Salvation: a buff purged from Salvation herself → she repairs herself for 5% of her Max HP.
  8. Team symmetry: one of the above (Hayyan is simplest) mirrored with Hayyan on the ENEMY side.
  9. Unchanged guards: Crocus's own crit DoT does NOT trigger her `on-ally-crit-dot` repair, and Harvester's own destruction does NOT enqueue its `on-ally-destroyed` action. Add these only if no existing test already pins them. Grep first, and cite the existing test if one exists.

- [ ] **Step 2: Run the new tests; confirm they fail for the expected reason** (the reaction does not fire on the owner).

- [ ] **Step 3: Change the five guards** from `isSameSideAlly(x, ownerId)` to `!isOpposing(x)`. For `on-ally-attacked` and `on-ally-crit` (early-return form), `!isSameSideAlly(x, ownerId)` becomes `isOpposing(x)`. Update the comments above each changed guard, and the top-of-file trigger doc block, to the new rule.

- [ ] **Step 4: Flip the existing self-exclusion tests** (see the list above; grep `triggers.test.ts` and the integration tests for any other test the change breaks). Each flipped test must assert the new behaviour.

- [ ] **Step 5: Run the combat tests, then the full suite.**
  `npx vitest run src/utils/combat` then `npx vitest run`.
  If any golden snapshot moves, STOP (see Global Constraints) and report the diff.

- [ ] **Step 6: Double-fire audit.** Using `docs/kit-audit-tools/corpus.json` (every ship's parsed abilities), list every ship that carries BOTH an own-event trigger and the matching ally trigger for the same kind of effect. The pairs are: `on-debuffed` + `on-ally-debuffed`; `on-debuff-inflicted` + `on-ally-debuff-inflicted`; `on-crit` + `on-ally-crit`; `on-attacked` + `on-ally-attacked`; `on-purged` + `on-ally-purged`. For each such ship, state whether the change now fires both on one event, and whether its text supports that. Report the list, even if it is empty.

- [ ] **Step 7: Commit** (hook must pass), subject `fix(combat): "an ally" triggers include the ship itself`.

---

### Task 2: Grif hits each cleansed enemy

**Files:**
- Modify: `src/utils/combat/triggers.ts`, `case 'on-enemy-cleansed'`.
- Modify: `src/constants/changelog.ts` (both changelog entries from Global Constraints, this task adds them).
- Test: `src/utils/combat/__tests__/enemyCleanse.integration.test.ts` (or the nearest Grif test; grep `Grif`).

- [ ] **Step 1: Failing test, in-fight example.** Grif is on one side. On the other side, a cleanser removes one debuff from each of two of its allies (A and B) in a single cast. Assert Grif's 75% no-crit reaction hits A once and B once (two `attack` rows, one per cleansed ship), and does NOT hit the cleanser unless the cleanser was itself cleansed. Add a second case: the cleanser removes two debuffs from ONE ally → Grif hits that ally once. Add a mirrored case with Grif on the enemy side.

- [ ] **Step 2: Run it; confirm it fails** (today: one hit, on the cleanser).

- [ ] **Step 3: Implement.** In the `on-enemy-cleansed` listener, when `ra.ability.type === 'damage'`, enqueue one intent per id in `e.targets`, each with `counterTargetId` set to that cleansed id. Every other ability type keeps today's single enqueue with `counterTargetId: e.casterId` and `cleansedEnemyIds: e.targets`, so Pestilence, Arum, Larkspur and Yarrow are unchanged. Rewrite the listener's comment to state the rule: the damage reaction hits each cleansed enemy once per cast (owner ruling), and the other reactions fire once per cast. Confirm the existing Pestilence test (`pestilenceEnemyCleanseCorrosion.integration.test.ts`) and the enemy-cleanse tests still pass unchanged.

- [ ] **Step 4: Changelog.** Add both entries verbatim at the top of `UNRELEASED_CHANGES`.

- [ ] **Step 5: Full suite, then commit.** Golden STOP rule applies. Subject `fix(combat): Grif hits each enemy whose debuff is cleansed`.
