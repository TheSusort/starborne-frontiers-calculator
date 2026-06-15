# Positional Combat Phase 4 — PR 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Complete Phase 4 — death-fallback retargeting (verify), activate the dormant Harvester `on-ally-destroyed` extra action (verify), and fix Salvation's gross-heal counting a dead recipient — all capability-only, goldens byte-identical.

**Architecture:** PR 1 (#114) made enemy AoE able to kill *player* allies (via `applyIncomingToTarget` → `recordDestroyed` → `ship-destroyed`) and player attacks able to kill *enemies*. That unblocks three things that were dormant only because nothing died mid-combat: (1) inter-turn retargeting — `selectTargets`/`resolvePositionalTarget` already filter living, so the *next* attacker re-selects automatically; (2) the `on-ally-destroyed` reactive extra-action bridge (wired in Phase 4b, triggers.ts:350-358 + the extra-action reactive delegate) now has an ally that can actually die; (3) Salvation's `all-allies` on-destroyed heal credits gross `directHeal` per recipient regardless of liveness. Tasks 1-2 are **verification-first** (add the test that exercises the now-reachable path; fix only if it reveals a gap). Task 3 is the one guaranteed code change.

**Tech Stack:** TypeScript, Vitest. Engine in `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-15-positional-combat-phase4-design.md` (§6 = PR 2).

---

## Workflow notes (read first)

- **Branch + worktree:** PR 2 **stacks on PR 1**. Create branch `feat/combat-engine-phase4-pr2` off the tip of `feat/combat-engine-phase4-pr1` (PR #114), in a NEW worktree `.worktrees/phase4-pr2`. After creating it, **symlink** the gitignored `.env` + `docs/ship-targeting.csv`/`ship-skills.csv`/`bios.csv`/`combat-system.md` AND `.husky/_` from the main checkout (else env tests fail + the pre-commit hook is broken). When #114 merges, rebase `--onto origin/main <old-pr1-tip>` and retarget the PR base to main (stacked-squash dance).
- **`gh auth switch --hostname github.com --user TheSusort`** before any PR/gh op.
- **Goldens are SYNTHETIC** — any DPS/healing snapshot diff = a bug. NEVER `vitest -u`. PR 2 is capability-only; the byte-identical gate holds because no production caller passes positions. The Salvation fix (Task 3) only changes the synthetic Salvation-as-dead-caster case — confirm whether any golden covers it; if a golden moves, audit that it's ONLY the corrected gross `directHeal` for a dead recipient (not a live-target trajectory change), and only then accept (this is the rare audited-churn case — get explicit confirmation, do not `-u` blindly).
- **`docs/` gitignored** → `git add -f` plan/spec; docs commits `--no-verify`.
- Test cmds: `npm test -- <path>`, `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run audit:skills`. New combat tests → `src/utils/combat/__tests__/`.

---

## Task 1: Inter-turn retargeting (verification + fix if needed)

**Files:**
- Test: `src/utils/combat/__tests__/deathFallback.integration.test.ts` (new)
- (Modify `engine.ts` ONLY if a gap is found.)

When a positional focus-fire target dies, a later attacker that round (or next round) must re-select a *living* target; if the whole opposing side is dead, the ability whiffs cleanly (no crash, no spurious credit). PR 1's positional path re-resolves per hit and per turn on the live roster, so this is likely already correct — this task PROVES it and fixes only a real gap.

- [ ] **Step 1: Write the test.** Hand-built positional `runCombat` (healing mode, `healTargetId` set so `enemyAttackerActors` is populated). Two living enemies; a fast player attacker focus-fires and kills enemy A on its turn; assert a second player attacker (slower, same round OR next round) lands on enemy B (the living one), not the dead A. Add an all-enemies-dead case → the attacker's positional damage whiffs (no throw, no damage credited). Use the death-bracket / `ship-destroyed` observable idiom from `positionalDamage.integration.test.ts`.
- [ ] **Step 2: Run, expect PASS** (if already correct): `npm test -- src/utils/combat/__tests__/deathFallback.integration.test.ts`. If it FAILS, that's a real gap — diagnose (e.g. dead actor not excluded from the roster passed to `resolvePositionalTarget`/`footprintVictims`), implement the minimal fix in `engine.ts`, re-run.
- [ ] **Step 3:** `npm test` full suite byte-identical; `npx tsc --noEmit && npm run lint`.
- [ ] **Step 4: Commit** `test(combat): verify inter-turn positional retargeting + all-dead whiff` (or `feat(combat): ...` if a fix was needed).

---

## Task 2: Harvester `on-ally-destroyed` extra action (verification + fix if needed)

**Files:**
- Test: `src/utils/combat/__tests__/deathFallback.integration.test.ts` (extend)
- (Modify `engine.ts`/`triggers.ts` ONLY if a gap is found.)

The `on-ally-destroyed` listener (triggers.ts:350-358) is registered for player actors and the extra-action reactive bridge exists (Phase 4b, dormant because no ally died). With PR 1, an enemy AoE can kill a non-heal-target player ally → `ship-destroyed(actorId=ally)` → a Harvester-shaped ally's `on-ally-destroyed` extra-action should fire.

- [ ] **Step 1: Write the test.** Positional `runCombat`: a player team with (a) a Harvester-shaped actor carrying an `on-ally-destroyed` `extra-action` ability, and (b) another player ally positioned where a fast enemy's AoE/attack kills it. Assert the Harvester actor takes an EXTRA turn that round (observe via `RoundData.extraTurns` or the extra-turn count seam used by the existing extra-action tests — check `extra-action` tests for the exact observable). Build the Harvester ability with the hand-built `ab()` style (no parser).
- [ ] **Step 2: Run.** If PASS → the bridge already activates under positional deaths; great. If FAIL → diagnose (listener not registered for this owner? reactive extra-action intent not granted to the granter? the `ship-destroyed` for a player AoE victim not emitted?). Implement the minimal fix, re-run.
- [ ] **Step 3:** `npm test` byte-identical; tsc + lint clean.
- [ ] **Step 4: Commit** `test(combat): Harvester on-ally-destroyed extra action under positional death` (or `feat(...)` if fixed).

---

## Task 3: Salvation dead-recipient filtering (the real fix)

**Files:**
- Modify: `src/utils/combat/triggers.ts` — the REACTIVE executor heal block at **~lines 1009-1037**. Salvation's `all-allies` heal fires on the `on-destroyed` trigger (registered as a `ship-destroyed` listener at triggers.ts:343-358), so it is applied here as a reactive intent — NOT in engine.ts. The over-counting gross credit is at **line 1026**: `ctx.healing.credit(intent.ownerId, 'directHeal', raw)`, inside `for (const rid of recipients)` where `recipients = ctx.playerIds` for `all-allies`. The live-target guard `if (rid === ctx.healing.targetId)` (lines ~1027/1033) already isolates effectiveHeal/overheal/grantShield. (NOTE: engine.ts:1885-1902 is a SEPARATE analogous standing-leech loop — NOT the Salvation path; do not edit it for this task.)
- Test: `src/utils/combat/__tests__/` (new or extend a healing test)

Salvation's `all-allies` on-destroyed heal resolves recipients including the **dead caster** (Salvation itself), so gross `directHeal` over-counts (Phase 4b KNOWN LIMITATION 5). `effectiveHeal`/`overheal` already credit only the live heal target. Fix: in the gross-credit recipient loop, **skip recipients whose actor is dead** (`currentHp <= 0`) so gross `directHeal`/`shield` counts only living recipients. **Liveness seam:** `ctx.runtimes.get(rid)?.actor.currentHp` (the executor ctx exposes `runtimes: Map<string, PlayerActorRuntime>`, and `runtime.actor` carries `currentHp`). **Determinism:** decide the missing-runtime case explicitly — an `rid` in `ctx.playerIds` may have no entry in `ctx.runtimes` (unwalked legacy team actor); treat a missing runtime as ALIVE (credit it, preserving today's behavior) so only a *known-dead* recipient is skipped — this keeps non-Salvation goldens byte-identical.

- [ ] **Step 1: Write the failing test.** A synthetic Salvation-as-tank (or Salvation among allies) scenario where Salvation is destroyed and fires its `all-allies` on-destroyed heal. Assert gross `directHeal` does NOT include a share for the dead caster (only living recipients counted). Confirm the LIVE-target path (effectiveHeal/overheal) is unchanged. This is the contract that proves the over-count is gone.
- [ ] **Step 2: Run, expect FAIL** (current code over-counts).
- [ ] **Step 3: Implement** the dead-recipient skip. CAUTION: the live heal-target is alive during a normal heal, so a `currentHp <= 0` guard must NOT change the normal (non-Salvation) path → goldens byte-identical. Apply the guard at the recipient-iteration site so only genuinely-dead recipients are skipped from the gross credit. Mirror the guard in the shield branch if the same over-count applies.
- [ ] **Step 4: Run, expect PASS.** Then `npm test` full suite. **Check goldens:** ideally byte-identical (no golden has a dead all-allies-heal caster). If a golden DOES move, audit that it's ONLY the corrected dead-recipient gross `directHeal`/`shield` (no live-target value change) and SURFACE it for explicit human confirmation before accepting — do NOT `vitest -u` blindly.
- [ ] **Step 5:** `npx tsc --noEmit && npm run lint`.
- [ ] **Step 6: Commit** `fix(combat): exclude dead recipients from gross all-allies heal credit`.

---

## Task 4: Final verification + PR

- [ ] **Step 1:** `npm test` full suite green; DPS+healing goldens byte-identical (`git diff origin/main -- '*.snap'`; any churn must be the audited Task-3 dead-recipient case only, human-confirmed).
- [ ] **Step 2:** `npm run audit:skills` (0 findings / 141), `npx tsc --noEmit && npm run lint` clean.
- [ ] **Step 3:** Holistic self-review vs spec §6: retargeting reaches a living target / whiffs cleanly; Harvester extra action fires on a positional ally death; Salvation gross heal excludes dead recipients; capability-only (no production caller). Confirm Phase 4 is now COMPLETE (PR1 + PR2) and the only remaining positional work is Phase 5 (simulator page).
- [ ] **Step 4:** Open PR (`gh auth switch` first), base = `feat/combat-engine-phase4-pr1` (retarget to main after #114 merges). Body: capability-only, byte-identical, links spec; notes it completes Phase 4. CodeRabbit poll `mergeState`.

---

## Out of scope (Phase 5)
Full symmetric per-actor-per-side result surface + team-vs-team simulator display; per-victim leech/incoming attribution; per-victim defense-debuff sourcing; the simulator page (first production caller of positions). Wire `detectIgnoresForcedTargeting` + a Provoke applier when positions go live.
