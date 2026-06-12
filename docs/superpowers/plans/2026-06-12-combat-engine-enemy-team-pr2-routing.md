# Enemy-Team Support PR 2 — Cross-Enemy Buff Routing + UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an enemy *supporter* buff the enemy team in the healing calculator — an enemy's `ally`/`all-allies` cast buffs now route to the enemy attackers (raising the bound attacker's effective stats → higher incoming damage), instead of leaking onto the player team. Plus the UI becomes a real "Enemy Team": rename + remove the 4-slot cap.

**Architecture:** Cast-path mirror of the player-side `ally`/`all-allies` routing (Gap A). The engine helper `registerActorAbilityStatuses` already fans aura/accumulating/timed statuses out **once per recipient** — so routing enemy cast buffs to an enemy recipient-id list (instead of `playerIds`) makes the per-recipient registration land on enemy stores for free (Gap C falls out of Gap A). Each enemy already walks `runPlayerTurn`, which folds `timedAbilityStatuses('self', id)` + `activeAbilityStatuses('self', ctx, id)` at its turn, so a buff registered onto its id is picked up automatically. No new per-actor store machinery.

**Tech Stack:** TypeScript, Vitest, React. Engine in `src/utils/combat/`. UI in `src/components/calculator/` + `src/pages/calculators/`.

**Spec:** `docs/superpowers/specs/2026-06-12-combat-engine-enemy-team-support-design.md` (§3.2 Gaps A + C + D, §4 PR 2).

**Depends on:** PR 1 (`feat/combat-engine-enemy-team-support`, PR #102). This branch (`feat/combat-engine-enemy-team-pr2-routing`) is stacked on PR 1's tip. When PR 1 merges, rebase/retarget to main.

---

## Background the implementer needs

- **The bug (Gap A, verified):** `registerActorAbilityStatuses(castSkills, statusEngine, ownerId, playerIds, healTargetId?)` (`engine.ts:96`) routes a cast ability's recipients by target: `self` → `[ownerId]`, `ally`/`all-allies` → the passed `playerIds` order, `enemy`/`all-enemies` → the singular enemy maps. For ENEMY runtimes it is called at `engine.ts:~369` (inside `buildEnemyPlayerActorRuntime`) with `playerIds` — so an enemy supporter's `all-allies` Attack Up would register onto the PLAYER team. The comment there even flags it "irrelevant for pure damage actors" (true only because no enemy buffs allies today).

- **Why Gap C is free:** the helper fans non-timed statuses out with `statusEngine.registerAbilityStatuses(statuses, rid)` **once per recipient** (`engine.ts:~229`), and timed statuses carry `recipients` for the per-recipient application loop in `playerTurn` (`status.recipients`). Pass enemy ids as the recipient order and aura/accumulating land on enemy stores, timed apply to enemy recipients when the supporter's slot fires. The enemy walk's `runPlayerTurn` then folds them at each enemy's turn. No extra code.

- **`playerIds` is used ONLY for that one call inside `buildEnemyPlayerActorRuntime`** (verified: the ctx field, the destructure, and the registration call — no other use). So the builder can take an `enemyIds` recipient list and pass it instead. `healTargetId` is NOT passed for enemies → the Cheat-Death `ally` carve-out falls back to `[ownerId]`, irrelevant here.

- **Enemy ids are known upfront:** `enemyAttackerInputs` is validated at `engine.ts:1311-1321` (`seenEnemyAttackerIds`), so `enemyAttackerInputs.map((e) => e.id)` is available *before* the runtime `.map` at `engine.ts:1329`. And `actor.id === e.id` (createActor `id: e.id`), so the input-id list equals `enemyAttackerActorIds` (`engine.ts:1333`).

- **The dummy `enemy.id` is NOT a team member** — it's the heal target's victim-side stand-in. The enemy recipient order is the enemy *attacker* ids only (same set PR1 used for `recipientIds`).

- **Turn-order semantics (expected, not a bug):** a supporter's cast buff applies when its slot fires (its turn), so the buffed attacker reflects it that round only if the supporter acts before it (speed order). A 1-turn buff cast after the attacker's turn helps next round. This mirrors the player-side rule.

- **Pure supporter (ship-backed, no damage ability):** `runPlayerTurn` resolves `damage = 0`; it takes its turn and applies buffs without attacking. CONFIRM the enemy walk tolerates a zero-damage enemy turn without emitting a spurious `attacked` event or NaN. Manual flat-card enemies (no `shipSkills`) keep synthesizing a basic attack → unaffected.

- **UI:** `MAX_ENEMY_ATTACKERS = 4` (`EnemyAttackersPanel.tsx:35`) is imported by the panel, its test, and `HealingCalculatorPage.tsx` (the `addEnemy` guard at `:271`). Rename "Enemy Attackers" → "Enemy Team"; remove the cap.

- **Golden discipline:** synthetic goldens carry bare-stat enemies (no `shipSkills`, no ally-buffs) → byte-identical. NEVER `vitest -u`. Run `npx vitest run <path>`; `npm run lint` (max-warnings 0); `npx tsc --noEmit`; `npm run audit:skills`.

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/utils/combat/engine.ts` | Enemy runtime build + cast-status registration | Modify: thread an `enemyIds` recipient list into `buildEnemyPlayerActorRuntime`; use it (not `playerIds`) for the enemy `registerActorAbilityStatuses` call |
| `src/components/calculator/EnemyAttackersPanel.tsx` | Enemy team UI | Modify: rename label/text/aria to "Enemy Team"/"enemy"; remove `MAX_ENEMY_ATTACKERS` cap (header count, add-button gate); keep or remove the export per usage |
| `src/pages/calculators/HealingCalculatorPage.tsx` | Enemy add handler | Modify: drop the `>= MAX_ENEMY_ATTACKERS` guard + import |
| `src/components/calculator/__tests__/EnemyAttackersPanel.test.tsx` | Panel test | Modify: update label/cap expectations |
| `src/utils/combat/__tests__/enemyTeamRouting.test.ts` | NEW — engine coverage for cross-enemy routing | Create |
| `src/constants/changelog.ts` | `UNRELEASED_CHANGES` | Fold into the existing combat entry |
| `docs/skill-model-coverage.md` | §6 enemy-team item | Mark PR2 shipped |

---

## Task 1: Engine — route enemy cast `ally`/`all-allies` buffs to the enemy team (RED→GREEN)

**Files:**
- Test: `src/utils/combat/__tests__/enemyTeamRouting.test.ts` (create)
- Modify: `src/utils/combat/engine.ts`

- [ ] **Step 1: Write the failing test — an enemy supporter's `all-allies` Attack Up raises a SECOND enemy attacker's damage**

Reuse the harness from `src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts` (the `runCombat` healing harness, `ab()` ability builder, `result.healing.rounds[N].incomingDamage`). Build TWO enemies: a supporter whose active slot casts an `all-allies` Attack Up, and a plain attacker. Order their speeds so the supporter acts first. Assert total incoming damage exceeds a control where the supporter's buff is `self`-target instead of `all-allies` (so only the routing target differs). The delta proves the buff reached the OTHER enemy.

- [ ] **Step 2: Run — verify it FAILS**

Run: `npx vitest run src/utils/combat/__tests__/enemyTeamRouting.test.ts`
Expected: FAIL — the `all-allies` buff currently routes to `playerIds` (player team), so the second enemy's damage is unbuffed and incoming equals the control. Record the failure mode in a comment.

- [ ] **Step 3: Thread an enemy recipient list into the builder**

In `buildEnemyPlayerActorRuntime` (`engine.ts:329`), replace the `playerIds` ctx field with `enemyIds: string[]` (it is used only for the `registerActorAbilityStatuses` call — verified). Pass `enemyIds` into that call instead of `playerIds`:

```ts
// before: registerActorAbilityStatuses(castSkills, statusEngine, e.id, playerIds)
const { timedSelfBySlot, timedEnemyBySlot } = registerActorAbilityStatuses(
    castSkills,
    statusEngine,
    e.id,
    enemyIds // enemy-team ally-routing: an enemy ally/all-allies buff lands on the
             // enemy attackers, not the player team. Mirrors the player playerIds order.
);
```
Update the doc comment above the call (the "irrelevant for pure damage actors" note is now stale).

- [ ] **Step 4: Compute the enemy recipient order and pass it at the call site**

In `runCombat`, after the enemy-id validation loop (`engine.ts:~1321`), compute the recipient order from the inputs (available before the runtime `.map`):

```ts
// Enemy-team recipient order (mirror of playerIds): the enemy ATTACKER ids in input
// order — NOT the singular dummy enemy.id (that is the victim-side stand-in). Equals
// enemyAttackerActorIds (actor.id === input id) but computable before the runtimes map.
const enemyRecipientIds = enemyAttackerInputs.map((e) => e.id);
```
Pass it into the builder: `buildEnemyPlayerActorRuntime(e, { statusEngine, enemyIds: enemyRecipientIds, enemyDebuffLookup })` (`engine.ts:~1329`).

Note: `registerActorAbilityStatuses`'s parameter is named `playerIds` but is a generic ally-recipient order — passing enemy ids is correct. Optionally add a one-line comment there clarifying it is "the same-side ally recipient order (player ids for player actors, enemy ids for enemy actors)". Do NOT rename the param (it would touch the two player call sites for no behavioral gain) unless trivially clean.

- [ ] **Step 5: Run the test — verify it PASSES**

Run: `npx vitest run src/utils/combat/__tests__/enemyTeamRouting.test.ts`
Expected: PASS.

- [ ] **Step 6: Golden parity + tsc + lint**

Run: `npx vitest run src/utils/calculators/__tests__/healingGoldenParity.test.ts src/utils/calculators/__tests__/dpsGoldenParity.test.ts && npx tsc --noEmit && npm run lint`
Expected: byte-identical goldens, clean tsc + lint. If a golden churns, STOP — a fixture carries an enemy ally-buff, contradicting the premise.

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/enemyTeamRouting.test.ts
git commit -m "feat(combat): route enemy ally/all-allies cast buffs to the enemy team (enemy-team PR2)"
```

---

## Task 2: Engine — aura + pure-supporter coverage

**Files:**
- Test: `src/utils/combat/__tests__/enemyTeamRouting.test.ts` (extend)

- [ ] **Step 1: Test — an enemy `all-allies` AURA buff (recurring/no-duration) reaches another enemy**

Build a supporter whose `all-allies` buff is an aura (duration `'recurring'` or undefined) rather than timed. Assert the second enemy's damage reflects it each round (aura folds via `activeAbilityStatuses('self', ctx, id)`). This locks the per-recipient aura registration (Gap C) on the enemy side.

- [ ] **Step 2: Test — a pure supporter (no damage ability) buffs without attacking**

Build a supporter whose only ability is an `all-allies` buff (no damage slot), plus one plain attacker. Assert: (a) total incoming damage exceeds the no-supporter baseline (the buff reached the attacker), and (b) the run does not throw / produce NaN (the zero-damage supporter turn is tolerated). If a spurious `attacked`/incoming contribution appears from the supporter itself, report DONE_WITH_CONCERNS with the numbers rather than masking it.

- [ ] **Step 3: Run — verify PASS; commit**

Run: `npx vitest run src/utils/combat/__tests__/enemyTeamRouting.test.ts`
Expected: PASS.

```bash
git add src/utils/combat/__tests__/enemyTeamRouting.test.ts
git commit -m "test(combat): enemy aura routing + pure-supporter coverage"
```

---

## Task 3: Engine — isolation guard (no leak to the player team)

**Files:**
- Test: `src/utils/combat/__tests__/enemyTeamRouting.test.ts` (extend)

- [ ] **Step 1: Test — an enemy `all-allies` buff does NOT change player-side output**

Assert a player-side figure (e.g. `result.rounds[].cumulativeDamage`, the focus actor's outgoing damage — the same observable PR1's leak test used) is byte-identical with vs without the enemy supporter's `all-allies` buff. Add a non-vacuity assertion that the enemy incoming DID change, so the guard isn't comparing two unchanged runs. This proves the routing fix moved enemy buffs OFF the player ids.

- [ ] **Step 2: Run — verify PASS; commit**

Run: `npx vitest run src/utils/combat/__tests__/enemyTeamRouting.test.ts`
Expected: PASS.

```bash
git add src/utils/combat/__tests__/enemyTeamRouting.test.ts
git commit -m "test(combat): enemy buff does not leak onto the player team"
```

---

## Task 4: UI — "Enemy Team" rename + remove the slot cap

**Files:**
- Modify: `src/components/calculator/EnemyAttackersPanel.tsx`
- Modify: `src/pages/calculators/HealingCalculatorPage.tsx`
- Modify: `src/components/calculator/__tests__/EnemyAttackersPanel.test.tsx`

- [ ] **Step 1: Panel — rename + uncap**

In `EnemyAttackersPanel.tsx`:
- Header (`:165`): "Enemy Attackers ({enemies.length}/{MAX_ENEMY_ATTACKERS})" → "Enemy Team ({enemies.length})".
- Add-button gate (`:186`): remove the `enemies.length < MAX_ENEMY_ATTACKERS &&` condition so the button always shows.
- Button/aria copy: "+ Add enemy attacker" → "+ Add enemy"; "Remove enemy attacker" → "Remove enemy".
- Description text (the `<p>` after `CollapsibleForm`, ~`:171-173` — match on content, not line number): update to reflect supporters, e.g. "The enemy team attacking the heal target. A ship with a damage ability hits the target; a support ship buffs the team. Pick a ship to autofill its stats and walk its abilities, or enter stats manually."
- Remove the `MAX_ENEMY_ATTACKERS` export if nothing else needs it after Step 2 (grep first). If the test still wants it, keep it but it is no longer used for gating.

Use existing UI primitives — no raw HTML. (`Button`, `CollapsibleForm`, etc. already in use here.)

- [ ] **Step 2: Page — drop the add guard**

In `HealingCalculatorPage.tsx`: remove the `if (enemies.length >= MAX_ENEMY_ATTACKERS) return;` line (`:271`) and the `MAX_ENEMY_ATTACKERS` import (`:33`).

- [ ] **Step 3: Update the panel test**

In `EnemyAttackersPanel.test.tsx`: update label assertions ("Enemy Team"), the add-button text, and remove/adjust any cap-related test (e.g. a test that the add button hides at 4). Add a test that the add button is present even with >4 enemies if the existing test style supports it.

- [ ] **Step 4: Run UI tests + lint + tsc**

Run: `npx vitest run src/components/calculator/__tests__/EnemyAttackersPanel.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/calculator/EnemyAttackersPanel.tsx src/pages/calculators/HealingCalculatorPage.tsx src/components/calculator/__tests__/EnemyAttackersPanel.test.tsx
git commit -m "feat(healing): rename Enemy Attackers -> Enemy Team and remove the 4-slot cap"
```

---

## Task 5: Full suite + audit + docs

**Files:**
- Modify: `src/constants/changelog.ts`, `docs/skill-model-coverage.md`

- [ ] **Step 1: Full suite**

Run: `npx vitest run`
Expected: all green; healing + DPS goldens byte-identical (no `-u`).

- [ ] **Step 2: Audit + final tsc/lint**

Run: `npm run audit:skills && npx tsc --noEmit && npm run lint`
Expected: 0 findings / 141 ships; clean.

- [ ] **Step 3: Changelog (fold into the existing combat entry)**

Add a plain-English line to the single evolving combat `UNRELEASED_CHANGES` entry — e.g. "Healing Calculator: the enemy section is now a full Enemy Team (no longer capped at four) — enemy support ships buff their teammates, so a buffer's Attack Up raises the damage the other enemies deal to your heal target; a support ship with no attack just buffs without dealing damage." Fold, do not add a separate entry.

- [ ] **Step 4: Coverage doc §6**

Mark PR2 SHIPPED under the enemy-team-support item: cross-enemy `ally`/`all-allies` cast routing (Gap A) via the `enemyIds` recipient order threaded into `buildEnemyPlayerActorRuntime`; per-recipient aura (Gap C) free from the existing fan-out; UI rename + cap removal (Gap D). Note remaining: PR3 optional `grantAllyCharges`, and the deferred targeting/board-data items.

- [ ] **Step 5: Commit docs**

```bash
git add src/constants/changelog.ts
git add -f docs/skill-model-coverage.md
git commit --no-verify -m "docs(combat): enemy-team cross-enemy routing + UI PR2 — changelog + coverage"
```

---

## Task 6: Push, PR, review

- [ ] **Step 1: Push + PR (stacked on PR 1 until it merges)**

```bash
gh auth switch --hostname github.com --user TheSusort
git push -u origin feat/combat-engine-enemy-team-pr2-routing
# Base = PR1 branch while #102 is open; retarget to main after #102 merges.
gh pr create --base feat/combat-engine-enemy-team-support --title "feat(combat): enemy-team cross-enemy buff routing + UI (enemy-team support PR2)" --body "<summary + test plan + spec link; note it stacks on #102>"
```

- [ ] **Step 2: Address review** per the project flow (poll `mergeState=CLEAN` for CodeRabbit).

---

## Done-when

- An enemy supporter's `ally`/`all-allies` cast buffs (timed AND aura) raise other enemies' damage to the heal target; provably do NOT leak onto the player team.
- A pure supporter (no damage ability) buffs without attacking or erroring.
- The UI reads "Enemy Team" with no slot cap; the page allows >4 enemies.
- Full suite green; healing + DPS goldens byte-identical; `audit:skills` 0 findings; tsc + lint clean.
- Changelog + coverage doc updated.

## Out of scope (later)

- Enemy `grantAllyCharges` (a supporter accelerating an attacker's charged skill) → **PR 3** (only if a corpus enemy needs it).
- Enemy heal/cleanse routing to enemy allies (enemies never lose HP in healing mode → stays `healEventOnly`).
- All targeting/positional/AoE work → deferred phases.
