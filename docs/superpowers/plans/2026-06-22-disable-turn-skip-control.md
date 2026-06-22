# Disable as a turn-skip control effect (D-PR13) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the combat engine treat a `Disable` status as a turn-skip control (skip the afflicted unit's scheduled action + suppress its reactives), without the Stasis-only break-on-hit / immunity behavior — lighting up the D-PR7 Martyrdom implant and the 5 skill-text Disable inflictors with no parser change.

**Architecture:** Buff-name-driven, mirroring Stasis. A new `disableBuffs.ts` defines `DISABLE_BUFFS`/`isDisable`. The engine gains `isDisabled` + a composite `isTurnBlocked = isStasised || isDisabled`, routed through the three turn-action gates and the reactive-suppression drain filter. Break-on-hit / immunity sites stay keyed on `isStasised` (Stasis-only). Cleanse-resume falls out free because `isDisabled` reads `ownerDebuffNames` live each turn.

**Tech Stack:** TypeScript, Vitest. Worktree: `.worktrees/d-pr13-disable-turn-skip` (branch `feat/combat-d-pr13-disable-turn-skip`, off the D-PR12 tip `998416c3`).

**Spec:** `docs/superpowers/specs/2026-06-22-disable-turn-skip-control-design.md`

---

## Conventions for every task

- Run a single test file: `npx vitest run <path>` (add `-t "<name>"` for one test). All commands run from the worktree root `.worktrees/d-pr13-disable-turn-skip`.
- The pre-commit hook runs the FULL vitest suite. Code commits go through it normally. Docs-only commits use `--no-verify` and `git add -f docs/...` (docs/ is gitignored).
- Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **NEVER** run `vitest -u` to update goldens. If a golden/snapshot moves, a real-ship Disable leaked into a fixture — stop and investigate.
- Reference files to mirror (read them before writing tests):
  - `src/utils/combat/stasisBuffs.ts` and its test `src/utils/combat/__tests__/stasisBuffs.test.ts`
  - `src/utils/combat/__tests__/stasis.test.ts` (the turn-skip + reactive-suppression + break harness — your primary template)
  - `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts` (the `D-PR7 Task 4` Martyrdom block, ~line 1486)

---

## Task 1: `disableBuffs.ts` module

**Files:**
- Create: `src/utils/combat/disableBuffs.ts`
- Test: `src/utils/combat/__tests__/disableBuffs.test.ts`

- [ ] **Step 1: Write the failing test.** Mirror `stasisBuffs.test.ts`.

```ts
import { describe, it, expect } from 'vitest';
import { DISABLE_BUFFS, isDisable } from '../disableBuffs';

describe('disableBuffs', () => {
    it('DISABLE_BUFFS contains Disable', () => {
        expect(DISABLE_BUFFS.has('Disable')).toBe(true);
    });
    it('isDisable returns true for Disable, false otherwise', () => {
        expect(isDisable('Disable')).toBe(true);
        expect(isDisable('Stasis')).toBe(false);
        expect(isDisable('Attack Down')).toBe(false);
    });
});
```

- [ ] **Step 2: Run to verify it fails.** `npx vitest run src/utils/combat/__tests__/disableBuffs.test.ts` → FAIL (`Cannot find module '../disableBuffs'`).

- [ ] **Step 3: Implement.** Create `src/utils/combat/disableBuffs.ts`:

```ts
/** Named debuffs that mean DISABLE — the game's second turn-skip control (after Stasis).
 *  While a unit carries an active Disable it cannot take its scheduled ACTION (active/charged
 *  skill + attack) and its reactive abilities are suppressed — IDENTICAL to Stasis on those two
 *  axes (recognized via the engine's `isTurnBlocked` composite). DoTs still tick and all timed
 *  statuses (Disable included) still decrement on the skipped turn, so duration N skips exactly
 *  N scheduled actions.
 *
 *  DIVERGES from Stasis on two axes (do NOT wire Disable into the Stasis-only sites):
 *    - NOT broken by a direct hit (Stasis is, see engine §4.5) — Disable persists when hit.
 *    - NO damage immunity — hits land normally (same as Stasis, which also takes damage).
 *
 *  Carried as a timed debuff in the victim's per-actor enemy-debuff store (decrements via the
 *  Post-Turn decrement). Disable carries no stat payload; duration comes from "for N turns".
 *  Extend from game data as other named turn-skip controls appear (e.g. Stun/Freeze). */
export const DISABLE_BUFFS: ReadonlySet<string> = new Set(['Disable']);

/** True iff `buffName` is a Disable turn-skip control. */
export function isDisable(buffName: string): boolean {
    return DISABLE_BUFFS.has(buffName);
}
```

- [ ] **Step 4: Run to verify it passes.** `npx vitest run src/utils/combat/__tests__/disableBuffs.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/combat/disableBuffs.ts src/utils/combat/__tests__/disableBuffs.test.ts
git commit -m "feat(combat): D-PR13 — Disable buff-name set + isDisable predicate"
```

---

## Task 2: Engine turn-skip — `isTurnBlocked` at the three turn-action gates

**Files:**
- Modify: `src/utils/combat/engine.ts` (reader ~1710; gates ~3690 / ~3878 / ~4090)
- Test: `src/utils/combat/__tests__/disable.test.ts` (new)

**Read first:** `stasis.test.ts` tests (i), (iii), and B3 Task 2 (i). You will mirror the harness (`ab`, `basicAttack`, `parsedTarget`, `basePattern`, `offensiveEnemyAt`, `teamAttackerAt`, the `run` helper, `POS_*` constants). Copy that harness into `disable.test.ts` and add a `disableInflictAttack(turns)` builder (identical to `stasisInflictAttack` but `buffName: 'Disable'`).

**IMPORTANT — event shapes (verified against `events.ts`):** the `attacked` event is `{ type, targetId, attackerId, round, didCrit? }` — it has **NO `damage` field**. To prove "damage lands" (no immunity), observe the `hp-changed` event instead: `{ type:'hp-changed', targetId, round, oldPct, newPct }` (fires when an actor takes HP damage). When you copy the `run` helper, ADD `'hp-changed'` to its `INTERESTING_TYPES` array so it is collected.

- [ ] **Step 1: Write the failing tests.** Create `src/utils/combat/__tests__/disable.test.ts` with the mirrored harness plus these tests (full code — adapt imports/harness from `stasis.test.ts`):

  **(i) A disabled enemy skips its action.** Mirror `stasis.test.ts` (i) but inflict `Disable(2)` from the focus every round; assert `enemy-front` never emits `ability-performed` across 4 rounds, `enemy-back` (untargeted) fires every round, `result.rounds` has length 4.

  **(ii) Disable(2) decrements on skipped turns → exactly 2 skips.** Mirror `stasis.test.ts` (iii): a `disable-bot` (speed 300, hp 1) inflicts `Disable(2)` on the focus in round 1, a `killer` team actor kills the bot round 1 (so no re-application), focus skips rounds 1–2 and fires in round 3. Assert focus `ability-performed` rounds: not 1, not 2, contains 3.

  **(iii) No immunity + no break-on-hit (the Stasis contrast).** This is the key divergence test.

```ts
// ── (iii) Disable does NOT break on a direct hit AND damage still lands ──────────────────
describe('D-PR13 — Disable: direct hit does NOT break it (contrast vs Stasis) and damage lands', () => {
    it('a disabled focus stays disabled for the full duration despite being hit each round, and takes the damage', () => {
        idc = 0;
        /**
         * disable-bot (speed 300, hp 1): inflicts Disable(3) on the focus in round 1, then is
         *   killed by `killer` (no re-application).
         * breaker (speed 150): a plain direct attacker that hits the focus EVERY round. Under
         *   Stasis this would BREAK the control (stasis B3 Task 2 (i)); under Disable it must NOT.
         * focus (speed 100, hp large): disabled rounds 1–3, must NOT act until round 4.
         * Assert: focus fires no ability-performed in rounds 1–3 (stayed disabled despite hits),
         *   fires in round 4; AND the breaker dealt damage to the focus (no immunity).
         */
        const { events, result } = run({
            /* ...MART-style base: attack 0, basicAttack, hp 1e9, speed 100, healTargetId 'attacker',
               numRounds 4, position POS_FOCUS, target front, pattern base, hacking 0... */
            teamActors: [teamAttackerAt('killer', POS_TEAM, 200, 10000)],
            enemyAttackers: [
                // disable-bot at front: applies Disable(3) to the focus in round 1, dies to killer.
                { id: 'disable-bot', /* speed 300, hp 1, hacking 200, security 0, position front,
                    target front, pattern base, shipSkills: disableInflictAttack(3) */ } as EnemyAttacker,
                // breaker: plain attacker hitting the focus each round (would break Stasis).
                offensiveEnemyAt('breaker', POS_ENEMY_BACK, 'front', basicAttack(), 150),
            ],
        });

        const abilityPerformed = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> => e.type === 'ability-performed'
        );
        const focusRounds = abilityPerformed.filter((e) => e.actorId === 'attacker').map((e) => e.round);
        expect(focusRounds).not.toContain(1);
        expect(focusRounds).not.toContain(2);
        expect(focusRounds).not.toContain(3); // NOT broken by the breaker's hits
        expect(focusRounds).toContain(4);     // Disable(3) expired → acts

        // No immunity: the breaker actually damaged the focus while it was disabled.
        // (The `attacked` event has no damage field — observe hp-changed's pct decline instead.)
        const focusHpChanged = events.filter(
            (e): e is Extract<CombatEvent, { type: 'hp-changed' }> =>
                e.type === 'hp-changed' && e.targetId === 'attacker'
        );
        expect(focusHpChanged.length).toBeGreaterThan(0);
        expect(focusHpChanged.some((e) => e.newPct < e.oldPct)).toBe(true);
        expect(result.rounds).toHaveLength(4);
    });
});
```

  > NOTE: `'hp-changed'` must be added to the copied `run` helper's `INTERESTING_TYPES` array (the stasis copy omits it). The `attacked` event carries no `damage` — do not assert on it.

- [ ] **Step 2: Run to verify they fail.** `npx vitest run src/utils/combat/__tests__/disable.test.ts` → FAIL (Disable not honored: the disabled actor still acts).

- [ ] **Step 3: Implement.** In `src/utils/combat/engine.ts`:

  1. Add the import (next to the stasis import ~line 54): `import { isStasis, STASIS_BUFFS } from './stasisBuffs';` → add `import { isDisable } from './disableBuffs';`
  2. Just after the `isStasised` reader (~1710) add:

```ts
    const isDisabled = (actorId: string): boolean => ownerDebuffNames(actorId).some(isDisable);
    /** Turn-blocked = cannot take its scheduled action this turn (Stasis OR Disable). Used by the
     *  three turn-action gates and the reactive-suppression drain filter. The Stasis-only break /
     *  immunity sites intentionally keep using isStasised (Disable never breaks). */
    const isTurnBlocked = (actorId: string): boolean => isStasised(actorId) || isDisabled(actorId);
```

  3. At each of the three turn-action gates, change `if (!isStasised(actor.id)) {` → `if (!isTurnBlocked(actor.id)) {`:
     - focus/attacker gate ~3690
     - walked-team gate ~3878
     - enemy gate ~4090

  > Grep `if (!isStasised(actor.id))` to find exactly these three and switch only them. Leave every `tgtWasStasised` / `enemyTgtWasStasised` / `teamTgtWasStasised`, the `stasisBreakPending` reads in the else-branches, the `victimStasised` event fields, and `__testTapIsStasised` on `isStasised` — Disable must NOT break.

- [ ] **Step 4: Run to verify they pass.** `npx vitest run src/utils/combat/__tests__/disable.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/disable.test.ts
git commit -m "feat(combat): D-PR13 — Disable skips the afflicted unit's turn (isTurnBlocked gate)"
```

---

## Task 3: Reactive suppression while disabled

**Files:**
- Modify: `src/utils/combat/engine.ts` (drain filter ~3323)
- Test: `src/utils/combat/__tests__/disable.test.ts` (append)

**Read first:** `stasis.test.ts` B3 Task 1 tests (a) on-attacked suppression and (c) incoming DoT still ticks. Mirror them with Disable.

- [ ] **Step 1: Write the failing tests.** Append two tests, copying the `onAttackedSelfBuffSlot` helper from `stasis.test.ts`:

  **(iv) on-attacked self-buff suppressed while disabled.** Focus carries `onAttackedSelfBuffSlot` ('Counter Shield'); a `disable-enemy` inflicts `Disable(4)`; an `attack-enemy` hits the focus each round. Assert zero `buff-applied` `Counter Shield` on `attacker` across all rounds (mirror stasis (a)). Include a non-vacuity control identical to stasis (d) (no Disable → Counter Shield DOES apply) — copy stasis (d) renaming Stasis→Disable, OR rely on the existing stasis (d) test (note in a comment that (d) is the shared symmetry anchor).

  **(v) incoming DoT still ticks on a disabled actor.** Mirror stasis (c): a `dot-disable-enemy` applies corrosion + `Disable(2)` in round 1; assert `dot-ticked` for `attacker` fires in rounds 1 AND 2 (incoming effects untouched).

- [ ] **Step 2: Run to verify (iv) fails, (v) passes.** `npx vitest run src/utils/combat/__tests__/disable.test.ts`. (iv) FAILS (the disabled focus still gets its counter buff — drain filter not yet routed). (v) likely PASSES already (incoming DoT ticks regardless). That's fine — (v) is a lock test.

- [ ] **Step 3: Implement.** In `engine.ts`, change the reactive-suppression drain filter (~3323) from `if (isStasised(intent.ownerId)) continue;` → `if (isTurnBlocked(intent.ownerId)) continue;`.

- [ ] **Step 4: Run to verify both pass.** `npx vitest run src/utils/combat/__tests__/disable.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/disable.test.ts
git commit -m "feat(combat): D-PR13 — suppress a disabled unit's reactive abilities"
```

---

## Task 4: Cleanse-resume lock test

**Files:**
- Test: `src/utils/combat/__tests__/disable.test.ts` (append). **No production change expected** — `isDisabled` reads `ownerDebuffNames` live, and `cleanse` removes the (removable) `Disable` debuff. This test locks that behavior.

- [ ] **Step 1: Write the test.** A focus is disabled by an enemy, then a team-actor cleanser (faster than the focus) cleanses the focus before its turn, so the focus resumes acting.

```ts
// ── (vi) cleanse-resume: removing Disable lets the unit walk again ───────────────────────
describe('D-PR13 — Disable: cleanse removes it and the unit resumes its regular walk', () => {
    it('a disabled focus whose Disable is cleansed acts again on its next scheduled turn', () => {
        idc = 0;
        /**
         * disable-bot (speed 300, hp 1): inflicts Disable(5) on the focus round 1, killed by `killer`.
         * cleanser (team actor, speed 150): casts a self/ally cleanse on the focus EACH round
         *   (heal-target cleanse). Acts before the focus (150 > 100).
         * focus (speed 100): disabled round 1; in round 2 the cleanser removes Disable BEFORE the
         *   focus's turn → focus acts in round 2 (well before Disable(5) would expire on its own).
         * Assert: focus fires in round 2 (resumed early via cleanse), proving cleanse-resume.
         * Without cleanse, Disable(5) would keep it skipping rounds 1–5.
         */
        // Cleanser slot: a `cleanse` ability, target 'ally'/'self' onto the heal target (focus).
        // Mirror an existing cleanse setup — grep `type: 'cleanse'` in the combat __tests__ for the
        // exact config shape (count: 1, target resolving to the heal target). Run in healing mode.
        // ... assert focusFiredRounds.toContain(2);
    });
});
```

  > Read an existing cleanse test (grep `type: 'cleanse'` under `src/utils/combat/__tests__/`) for the exact `cleanse` ability config + how it targets the heal target. The cleanser must be on the SAME side as the disabled unit (cleanse removes the actor's own debuffs). Use the focus (heal target) as the disabled unit so a player-side cleanse applies.

- [ ] **Step 2: Run.** `npx vitest run src/utils/combat/__tests__/disable.test.ts -t "cleanse"` → expected PASS (no prod change). If it FAILS, debug: confirm `cleanse` reaches the focus's debuff store and `Disable` is not classified unremovable.

- [ ] **Step 3: Commit.**

```bash
git add src/utils/combat/__tests__/disable.test.ts
git commit -m "test(combat): D-PR13 — lock cleanse-resume (cleansed Disable restores the walk)"
```

---

## Task 5: Martyrdom end-to-end — the killer skips after the kill

**Files:**
- Test: `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts` (extend the `D-PR7 Task 4 integration — Martyrdom` describe block, ~line 1486). **No production change** — this proves Martyrdom (which already emits `Disable` on the killer, Test A) now causes a real turn-skip.

**Read first:** the existing Martyrdom block (`buildMartyrdomShipSkills`, `directKiller`, `MART_BASE`, `collect`) and `stasis.test.ts` positional helpers.

- [ ] **Step 1: Write the test.** Add a Test C that observes the killer skipping after it kills a Martyrdom carrier. Use a SURVIVING heal target + a positioned team-actor carrier so the killer keeps having something to do (non-vacuity), and the carrier's death is the only thing that disables the killer.

  Design (adapt field names to the harness):
  - `healTargetId: 'tank'` — a high-HP survivor with no offense, positioned BACK (e.g. `M1`).
  - A team actor `'martyr'` positioned FRONT (`M4`), low HP, `walk.shipSkills = buildMartyrdomShipSkills()` (legendary). It dies to the killer in round 1.
  - Enemy `killer` (speed high) targets `'front'` with a lethal direct hit: kills `martyr` round 1; from round 2 its `'front'` target is `tank` (still alive).
  - `numRounds: 4` (legendary Disable = 2).
  - Collect `ability-performed` for the killer.
  - **Assert:** killer fires in round 1 (the kill), is ABSENT in rounds 2 and 3 (disabled 2 turns), and fires again in round 4. Sanity: a `ship-destroyed` for `martyr` in round 1, and a `debuff-applied` `Disable` targeting the killer.
  - **Non-vacuity control:** an identical run where `martyr` carries NO Martyrdom (plain active only) → the killer fires in rounds 2 and 3 (attacking `tank`). Assert that contrast so the absence in the main run is genuine suppression.

  > If team-actor positioning + a surviving tank proves awkward, the equivalent observable is the killer's reactive: give the killer a `start-of-round` self-buff slot (copy `startOfRoundAttackUpSlot` from `stasis.test.ts`) and assert that buff is applied round 1 but suppressed rounds 2–3 (Task 3 suppression), returning round 4 — using a legendary carrier as the heal target itself (combat continues past its death for all `numRounds`). Either observation is acceptable; pick whichever is non-vacuous in the control. Document the chosen rationale in a test comment.

- [ ] **Step 2: Run.** `npx vitest run src/utils/combat/__tests__/equipmentAbilities.integration.test.ts -t "Martyrdom"` → PASS (and the control contrast must be non-vacuous: the killer DOES act in rounds 2–3 without Martyrdom).

- [ ] **Step 3: Commit.**

```bash
git add src/utils/combat/__tests__/equipmentAbilities.integration.test.ts
git commit -m "test(combat): D-PR13 — Martyrdom end-to-end: the disabled killer skips its turns"
```

---

## Task 6: Skill-text Disable lights up (parser lock test)

**Files:**
- Test: `src/utils/abilities/__tests__/buildShipAbilities.test.ts` (append). **No production change** — proves "inflicts Disable for N turns" parses to a named `Disable` debuff (so the 5 corpus inflictors ride the same engine gate as Martyrdom).

- [ ] **Step 1: Write the test.** Read the existing Makoli Disable test (~line 1710 in that file) for the `buildShipAbilities` invocation shape. Add a test that builds a ship whose active skill text is e.g. `'This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>Disable</unit-skill> for 1 turn.'` and asserts the produced abilities include a `type: 'debuff'` ability with `config.buffName === 'Disable'` and `config.duration === 1`. (Confirm it is NOT emitted as a `type: 'control'` ability — `parseControlInflict` is Stasis-only.)

- [ ] **Step 2: Run.** `npx vitest run src/utils/abilities/__tests__/buildShipAbilities.test.ts -t "Disable"` → expected PASS. If the duration/shape differs, adapt the assertion to the actual parser output (the point is: a named `Disable` debuff, not a control ability).

- [ ] **Step 3: Commit.**

```bash
git add src/utils/abilities/__tests__/buildShipAbilities.test.ts
git commit -m "test(combat): D-PR13 — lock skill-text 'inflicts Disable' → named Disable debuff"
```

---

## Task 7: Docs, changelog, and full verification

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify (if it tracks control simulation): `docs/skill-model-coverage.md`
- Modify (if it documents control effects): `src/pages/DocumentationPage.tsx`

- [ ] **Step 1: Changelog.** Add a plain-English entry to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`, e.g.: *"Combat simulator: the Disable control now skips the affected ship's turn (and locks out its reactions), so effects like the Martyrdom implant and Disable-inflicting skills take effect in the simulation."*

- [ ] **Step 2: Coverage doc.** Check `docs/skill-model-coverage.md` (and the `simCoverage.ts` note) for any claim that Disable / control turn-skip is unsimulated. `NOT_SIMULATED_TYPES` stays `{'control'}` (the control *type* still only drives cast-path reactions). If the coverage doc says only Stasis skips turns, update it to note Disable now does too via the named-debuff path. If nothing references it, skip (and say so in the commit).

- [ ] **Step 3: In-app docs.** If `DocumentationPage.tsx` documents control/Stasis behavior in the combat sim, add Disable alongside it. If not, skip.

- [ ] **Step 4: Byte-identical audit.** Confirm no golden/snapshot moved and no fixture carries a turn-taking `Disable`:

```bash
grep -rn "Disable" src/utils/calculators/__tests__/ src/utils/combat/__tests__/ | grep -v "disable.test.ts\|disableBuffs\|equipmentAbilities.integration\|buildShipAbilities"
git status --porcelain   # expect NO .snap changes
```

  Expected: the only `Disable` references outside this PR's new/extended tests are pre-existing (e.g. the Makoli parser test, the existing Martyrdom Test A/B). No `.snap` files in the diff.

- [ ] **Step 5: Full suite + lint + types + skills audit.**

```bash
npx vitest run            # entire suite green (new tests added, ZERO golden movement)
npm run lint              # 0 warnings
npx tsc --noEmit          # clean
npm run audit:skills      # unchanged (0 findings / 141 ships)
```

  If any golden/snapshot changed, STOP — investigate the leak (do not `-u`).

- [ ] **Step 6: Commit.**

```bash
git add src/constants/changelog.ts docs/skill-model-coverage.md src/pages/DocumentationPage.tsx
git commit -m "docs(combat): D-PR13 — changelog + coverage note for Disable turn-skip"
```

  (Drop paths that you didn't actually change from the `git add`.)

---

## Done criteria

- `disableBuffs.ts` + `isTurnBlocked` route the three turn gates and the reactive drain filter; break/immunity stay Stasis-only.
- New `disable.test.ts` proves: skip, duration-N decrement, NO break-on-hit, NO immunity, reactive suppression, cleanse-resume.
- Martyrdom end-to-end test shows the killer skipping after the kill (non-vacuous control).
- Skill-text `Disable` parses to a named debuff (lock test).
- Full suite green, goldens byte-identical, lint/tsc/audit clean, changelog updated.
