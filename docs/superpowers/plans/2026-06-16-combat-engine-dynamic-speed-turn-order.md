# Dynamic Speed & Turn Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make turn order respond to speed buffs/debuffs in the combat engine — speed becomes a live stat that re-orders the unacted ships each time it changes, and conditional extra actions slot in at current effective speed.

**Architecture:** Order-only model (each ship acts once per round; speed = order, not frequency). Add `speed` as a buff stat folded through the existing `calculateBuffTotals` path. Replace the per-round pre-built `queue` array + indexed `for(qi)` loop with a **selection-based multiset action pool**: each step picks the next unacted actor by *current* effective speed via a pure side-agnostic `selectNextBySpeed`, so any mid-round speed change is reflected automatically (correctness by construction, no re-sort hooks). Extra-action grants push a pending action rather than splicing an array. All new pieces are side-agnostic — they seed the deferred team-agnostic unification.

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-16-combat-engine-dynamic-speed-turn-order-design.md`

**Branch:** `feat/combat-engine-dynamic-speed` (stacked on `feat/combat-sim-phase5-pr2` / PR #117; rebase `--onto main` after #117 merges).

---

## Key references (verified at HEAD)

- `src/utils/combat/state.ts:214` `buildTurnQueue` — sorts by static `a.stats.speed`. `orderByTurnPriority` (`:226`) is the shared comparator (speed desc → side player-before-enemy → input order).
- `src/utils/combat/engine.ts:1936` round loop builds `queue = buildTurnQueue([...teamCombatActors, attacker, enemy, ...enemyAttackerActors])`.
- `src/utils/combat/engine.ts:2589` `for (let qi = 0; qi < queue.length; qi++)` — the loop being replaced. Cursor state: `currentQi` (`:2389`), `inTurnLoop` (`:2390`). Dead-actor skip: `:2598` (`handleDeadTargetSkip`) + `:2602` general `destroyedRound` skip. Dispatch branches: focus `~:2810`, walked-team `~:2871`, enemy `~:3300`. Extra-action grants invoked at `:2870`/`:3012`/`:3370` via `processExtraActionGrants` (`:2356`) and `grantExtraAction` (`:2399`) with Path A (in-loop splice) / Path B (`pendingExtraActions` buffer, flushed `:2564`).
- `src/utils/combat/engine.ts:1410` `lowestSpeedAllyIds` / `:1535` `lowestSpeedEnemyIds` — computed once from static `stats.speed`.
- `src/utils/combat/playerTurn.ts:283` `calculateBuffTotals(buffs: Buff[])` — folds attack/crit/critDamage/outgoingDamage/defence/hp/heal; **no speed**. `resolveSelfBuffTotals` (`:333`) and the ability-status fold (`:1037`) are the two self-buff sources.
- `src/utils/calculators/dpsBuffHelpers.ts` `toSimBuffs` — SelectedGameBuff (`parsedEffects`) → sim `Buff[]`.
- `src/types/calculator.ts:60` `Buff.stat` union + `:90` `ParsedBuffEffects` — neither includes speed.
- `src/types/abilities.ts:155` `ModifierChannel` — no speed.
- `src/constants/buffs.ts` — Speed Up I/II/III (+10/+30/+45%), Speed Down I/II (−15/−30%), descriptions only.
- Status engine accessor for an arbitrary owner's active buffs: `statusEngine` returns `{ activeSelfBuffs, activeEnemyDebuffs }` (`statusEngine.ts:690`); ability statuses via `timedAbilityStatuses`/`activeAbilityStatuses`.

## Workflow notes

- `docs/` commits: NOT gitignored here (verified) — plain `git add`. Pre-commit hook runs the FULL vitest suite; use `--no-verify` only for docs-only commits.
- Dev server runs on :3000 from the main checkout (currently on this branch) — serves `/simulator` as the manual harness.
- NEVER `vitest -u` to bulk-regenerate goldens. Golden churn is acceptable here (user call: many team tests suspect) but every churned golden must be hand-audited and justified. DPS single-attacker goldens should NOT move — investigate if they do.
- `gh auth switch --user TheSusort` if gh acts as the wrong user.

---

## Task 0: Characterize speed-buff coverage (no code)

**Purpose:** Confirm the effective-speed fold can ignore conditional gating (i.e. all corpus speed buffs are unconditional timed statuses), and enumerate every speed buff name needing a `parsedEffects.speed` mapping.

**Files:** none (investigation → write findings into the plan's Task 1 as a checklist).

- [ ] **Step 1:** From `docs/ship-skills.csv`, list every distinct speed buff token (grep `-io "speed up[^<]*\|speed down[^<]*"` plus faction-named swiftness/celerity buffs). Cross-reference `src/constants/buffs.ts` for the canonical name + %.
- [ ] **Step 2:** Determine whether any speed buff is applied with a CONDITION (gated self-buff) or as a passive standing MODIFIER (vs a timed status). Grep the parser output / `buildShipAbilities` for any `modifier` with a speed channel or any conditionally-gated speed grant.
- [ ] **Step 3:** Record the result inline here: the buff-name → % table, and the verdict "all unconditional timed statuses" (expected) or the list of exceptions. This decides whether `effectiveSpeedOf` needs the gated-status path (Task 2b) or just the timed/always path. If a standing speed MODIFIER exists, Task 1 must also add `'speed'` to `ModifierChannel` and the modifier fold; otherwise skip that.

### Task 0 FINDINGS (2026-06-16, complete)

- **Speed buffs in corpus:** Speed Up I/II/III (+10/+30/+45%), Speed Down I/II (−15/−30%), XAOC Swiftness I/II/III (+10/+20/+30%), plus combined faction buffs (`constants/buffs.ts` lines 178/357/503) carrying `% Speed` components. All carry `"+X% Speed"` in their `description`.
- **`ParsedBuffEffects.speed` ALREADY EXISTS** (`types/calculator.ts`) and **`parseBuffEffects` ALREADY extracts it** (`buffParser.ts:56-57`, `/([+-]\d+(?:\.\d+)?)%\s*Speed/`). → **No parser/type work in Task 1.**
- **Verdict: all unconditional timed status grants.** No conditionally-gated speed buff; no standing speed MODIFIER. → `effectiveSpeedOf` needs only the timed/always + ability-status fold (NO gated-ctx path); **skip the `ModifierChannel` change entirely.**
- **Remaining gap (downstream only):** sim `Buff.stat` union (`calculator.ts:62`) lacks `'speed'`; `toSimBuffs` (`dpsBuffHelpers.ts`) doesn't forward `parsedEffects.speed`; `calculateBuffTotals` (`playerTurn.ts:283`) has no speed channel. **Task 1 is reduced to these three edits.**

---

## Task 1: Speed as a buff stat (model + parser fold)

**Files:**
- Modify: `src/types/calculator.ts` (`Buff.stat` union ~`:62`, `ParsedBuffEffects` ~`:90`)
- Modify: `src/utils/calculators/dpsBuffHelpers.ts` (`toSimBuffs`)
- Modify: `src/utils/combat/playerTurn.ts` (`calculateBuffTotals` ~`:283`)
- Modify: `src/constants/buffs.ts` (speed buff entries: add machine-readable `parsedEffects.speed` if entries carry effects; else map in parser)
- Modify: `src/utils/ship/skillTextParser.ts` (emit `parsedEffects.speed` for speed buff names) — confirm exact file during impl via the buff-name→effect mapping the parser already uses for Attack Up etc.
- Test: `src/utils/combat/__tests__/` (new `effectiveSpeed.test.ts`) + parser test in the existing parser suite

- [ ] **Step 1: Write failing test — `calculateBuffTotals` sums speed.** Add to a new `src/utils/combat/__tests__/effectiveSpeed.test.ts` (or co-located) a test that builds two sim `Buff`s `{stat:'speed', value:30}` + `{stat:'speed', value:-15}` and asserts the helper returns `speedBuff: 15`. (calculateBuffTotals is module-internal — export it or test via `resolveSelfBuffTotals`; prefer exporting `calculateBuffTotals` for direct unit testing, matching how other totals would be tested.)

- [ ] **Step 2: Run it — verify it fails** (`speedBuff` undefined / not summed). `npm test -- effectiveSpeed`.

- [ ] **Step 3: Add the type fields.** `ParsedBuffEffects.speed?: number` (comment: "additive %: +30 means ×1.30 on speed; turn-order only"); add `'speed'` to `Buff.stat`.

- [ ] **Step 4: Extend `toSimBuffs`** to emit `{stat:'speed', value: parsedEffects.speed}` when present (mirror the attack/crit cases).

- [ ] **Step 5: Add the speed channel to `calculateBuffTotals`** — `const speedBuff = buffs.filter(b => b.stat === 'speed').reduce((s,b)=>s+b.value, 0);` and include `speedBuff` in the returned object. (Add `speedBuff` to the `ReturnType` consumers as needed — it is additive; existing call sites ignore it.)

- [ ] **Step 6: Run the test — verify it passes.**

- [ ] **Step 7: Write failing parser test** — parsing "Speed Up II" (and one faction-named speed buff from Task 0) yields a buff whose `parsedEffects.speed === 30`. Run, verify fail.

- [ ] **Step 8: Map speed buff names → `parsedEffects.speed`** using the Task 0 table (in `constants/buffs.ts` and/or the parser's buff-name mapping). Run, verify pass.

- [ ] **Step 9: Full suite** `npm test` — expect green (additive change; nothing consumes `speedBuff` yet). `npm run lint`.

- [ ] **Step 10: Commit** `feat(combat): model speed as a buff stat (parser + calculateBuffTotals)`.

---

## Task 2: Pure selector + effective-speed authority

**Files:**
- Modify: `src/utils/combat/state.ts` (add `selectNextBySpeed`; keep `orderByTurnPriority` reused for the comparator)
- Modify: `src/utils/combat/engine.ts` (add `effectiveSpeedOf` closure near the other per-actor helpers, ~`:1410` region)
- Test: `src/utils/combat/__tests__/state.test.ts` (selector) + `effectiveSpeed.test.ts` (authority)

- [ ] **Step 1: Failing test for `selectNextBySpeed`.** In `state.test.ts`: given a list of `{actor, pending}` (or a `pendingByActor` map) and an `effectiveSpeedOf` callback, the function returns the actor with the highest effective speed among those with `pending > 0`; ties broken by side (player before enemy) then input order; returns `undefined` when no actor has pending > 0. Include a case where the callback returns a DIFFERENT order than `actor.stats.speed` (proves it uses the callback, not static speed).

- [ ] **Step 2: Run — verify fail** (function undefined).

- [ ] **Step 3: Implement `selectNextBySpeed`** in `state.ts` — pure, side-agnostic. Signature:
```ts
export function selectNextBySpeed(
    actors: CombatActor[],
    pendingOf: (id: string) => number,
    effectiveSpeedOf: (id: string) => number
): CombatActor | undefined {
    const eligible = actors
        .map((actor, i) => ({ actor, i, speed: effectiveSpeedOf(actor.id) }))
        .filter((e) => pendingOf(e.actor.id) > 0);
    if (eligible.length === 0) return undefined;
    return orderByTurnPriority(
        eligible.map((e) => ({ ...e, side: e.actor.side }))
    )[0].actor;
    // NOTE: orderByTurnPriority (state.ts:226) computes its OWN positional index
    // internally (.map((item,i)=>…)) and keys the input-order tiebreak off that — it
    // IGNORES any `i` we thread in. Correctness relies on `eligible` being a STABLE
    // filter over `actors` (canonical input order preserved), so the array positions
    // fed to orderByTurnPriority already encode input order. Pass `actors` in canonical
    // input order (= the old buildTurnQueue input order: team → attacker → enemy → enemyAttackers).
}
```

- [ ] **Step 4: Run — verify pass.**

- [ ] **Step 5: Failing test for `effectiveSpeedOf`.** In `effectiveSpeed.test.ts`, drive a minimal status engine: an actor with base speed 100 and an active "Speed Up II" self-buff → `effectiveSpeedOf` returns 130; with an added "Speed Down I" → 125 (×(1 + (30−15)/100)); with none → 100. (Build the harness from an existing statusEngine test's setup.)

- [ ] **Step 6: Run — verify fail.**

- [ ] **Step 7: Implement `effectiveSpeedOf(actorId)`** as an engine closure (it needs the status engine + `selfBuffLookup` + a base-speed lookup). It reuses the SAME self-buff fold the turn path uses: gather the actor's active self-buffs (`activeSelfBuffs` for the owner) + ability-status speed payloads, run them through `toSimBuffs`→`calculateBuffTotals`, take `.speedBuff`, return `baseSpeed * (1 + speedBuff/100)`. Base speed = the actor's construction-time `stats.speed`. Per Task 0, conditional gating is unnecessary; if Task 0 found gated speed buffs, gate with a lightweight ctx (mirror `buildStaticBuffContext`). Document the source set inline.

- [ ] **Step 8: Run — verify pass.** Full suite + lint.

- [ ] **Step 9: Commit** `feat(combat): selectNextBySpeed selector + effectiveSpeedOf authority`.

---

## Task 3: Convert the round loop to a selection-based action pool

**This is the core surgery.** It restructures the per-round loop in `engine.ts` (~`:2587`–end-of-round-assembly) WITHOUT changing what each turn *does* (the focus/team/enemy dispatch branches, drains, post-turn decrement, post-round assembly are preserved verbatim — only HOW the next actor is chosen and how extra actions re-enter changes).

**Files:**
- Modify: `src/utils/combat/engine.ts` (round loop body)
- Test: `src/utils/combat/__tests__/` integration (added in Task 6); rely on the existing suite as the regression net during this task.

**Invariants to preserve (call these out in the diff comments):**
1. Round-start: one pending action per LIVING actor (skip already-`destroyedRound` actors entirely, as the old build implicitly did by them being dead — verify: today dead actors are in `queue` but skipped at `:2602`; in the pool, seed them with 0 pending OR skip-on-select via the same `destroyedRound` guard. Keep the guard for actors that die DURING the round.)
2. Dispatch order within a turn unchanged (Pre/abilities/Post/drains).
3. `inTurnLoop`/`currentQi` semantics: Path A (in-loop) vs Path B (`pendingExtraActions` buffer) for death-triggered grants. In the pool model, "in-loop" = we are inside the while-body → push a pending action immediately; the Path B buffer (post-round enemy death) still flushes into next round's pool seed.
4. `extraActionFired` once-per-round Set + `MAX_EXTRA_TURNS_PER_ROUND` backstop unchanged.
5. Post-round assembly that currently iterates `queue` must iterate the round's actors instead (build a stable `roundActors` list = all actors seeded this round).

- [ ] **Step 1: Read the full loop end-to-end** (`engine.ts:2587` through the post-round assembly, ~`:3600`). Identify every read of `queue`, `qi`, `queue.length`, and `currentQi`. Write them down. (No edit yet.) **⚠️ SHADOWING TRAP:** there is an UNRELATED local `queue` — `drainQueue(queue: Intent[], …)` at `~:2424` (with `queue.splice`/`queue.length`) is the *intent* queue, not the turn queue. Do NOT touch it. Only the turn `queue` built from `buildTurnQueue` (`:1936`) is in scope. A blind grep/rename for `queue` will wrongly hit the intent queue.

- [ ] **Step 2: Introduce the pool state** above the loop, replacing `const queue = buildTurnQueue([...])`:
```ts
// Round actors = every participant this round (stable order = the old buildTurnQueue input
// order, used only as the deterministic input-order tiebreak — NOT the act order).
const roundActors = [...teamCombatActors, attacker, enemy, ...enemyAttackerActors];
// Pending actions per actor (multiset). Living actors seed 1; the dummy `enemy` and dead
// actors seed 0 (they never "act" via selection — the enemy dummy's DoT ticking is handled
// by its existing branch; see Step 6). Extra-action grants increment a pending count.
const pending = new Map<string, number>();
for (const a of roundActors) pending.set(a.id, /* living & selectable */ ? 1 : 0);
const pendingOf = (id: string) => pending.get(id) ?? 0;
```
Determine the exact "selectable" predicate from Step 1 (the dummy `enemy` sink and `destroyedRound` actors must not be *selected* — but the dummy enemy still needs its DoT-tick turn; confirm whether the dummy goes through selection today or is special-cased. Preserve its behavior exactly.)

- [ ] **Step 3: Replace the `for(qi)` with the selection while-loop:**
```ts
inTurnLoop = true;
try {
    let guard = 0;
    while (true) {
        if (++guard > MAX_SELECTION_TICKS) throw new Error(`round ${r}: selection did not terminate`);
        const actor = selectNextBySpeed(roundActors, pendingOf, effectiveSpeedOf);
        if (!actor) break;
        pending.set(actor.id, pendingOf(actor.id) - 1); // consume this action
        // (death-skip, dispatch branches, drains, post-turn decrement — verbatim from the old body)
        ...
    }
    // end-of-round-tagged extra actions drained here (Task 4)
} finally { inTurnLoop = false; currentQi = -1; }
```
Drop `currentQi` as an index; replace any `currentQi`-relative logic in `processExtraActionGrants` with "increment pending for the granter" (Task 4). Keep a no-op or remove `currentQi` once nothing reads it.

- [ ] **Step 4: Re-point every `queue`/`qi` reference** found in Step 1 to the pool model: dead-actor skip uses `actor.destroyedRound`; post-round assembly iterates `roundActors`; remove the index arithmetic. The dispatch branches (focus/team/enemy) are copied verbatim — they reference `actor`, not `qi`.

- [ ] **Step 5: Run the FULL suite** `npm test`. Triage every failure:
   - DPS single-attacker goldens / healing goldens that are byte-identical-expected and now differ → a real regression in the conversion (single-attacker order is trivial; should not move). FIX the conversion.
   - Team/multi-actor goldens that move → audit each: is the NEW order correct (speed desc → side → input)? If the old expectation was wrong, update it WITH a justification comment. If the new order is wrong, fix the conversion.
   - Keep going until green with every change audited.

- [ ] **Step 6: Verify the dummy-`enemy` DoT-tick and Path B buffer still behave** (these are the easiest to break). Add a temporary assertion / log if unsure, then remove.

- [ ] **Step 7: lint + tsc.** Commit `refactor(combat): selection-based round loop (action pool over static queue)`.

---

## Task 4: Extra actions push pending actions (Liberator / Thresh / Harvester)

**Files:**
- Modify: `src/utils/combat/engine.ts` (`processExtraActionGrants` `:2356`, `grantExtraAction` `:2399`, the `pendingExtraActions` flush `:2564`)
- Modify: `src/utils/abilities/applyAbilities.ts` (`ExtraActionGrant` is defined `~:221`; `endOfRound?: boolean` tag + wiring belongs in `extraActionsFromSkill` `~:230`)
- Test: Task 6 integration tests

- [ ] **Step 1:** Change `processExtraActionGrants` to `pending.set(granter.id, pendingOf(granter.id) + 1)` instead of `queue.splice(...)`, keeping the `extraActionFired` once-per-round gate and the `MAX_EXTRA_TURNS_PER_ROUND` increment/backstop. Because selection reads `effectiveSpeedOf` live and the grant fires AFTER `runPlayerTurn` (post-decrement), the re-selected action lands at the granter's CURRENT (post-buff-expiry) speed — the Thresh behavior. No explicit speed read needed here.

- [ ] **Step 2:** Path B (`pendingExtraActions` flush, `:2564`) now seeds `pending` for the granter at next round's pool build instead of `processExtraActionGrants(-1, ...)`. Keep the one-round-later timing.

- [ ] **Step 3:** End-of-round tag: if `ExtraActionGrant.endOfRound`, do NOT add to the speed pool; collect into a `endOfRoundActions: CombatActor[]` list drained after the while-loop (Step 3 of Task 3), in grant order. (Harvester's "1 extra end of round action".) Default grants stay speed-positioned (Liberator).

- [ ] **Step 4:** Wire `endOfRound` from the parser/`buildShipAbilities` where "end of round action" text is detected (grep for the existing extra-action detection; Harvester's third passive). If the detection doesn't currently distinguish, add the boolean; default false preserves Liberator behavior.

- [ ] **Step 5:** Full suite + lint. Commit `feat(combat): extra actions re-enter the pool at current effective speed`.

---

## Task 5: Chakara lowest-speed gate — live effective speed

**Files:**
- Modify: `src/utils/combat/engine.ts:1410` `lowestSpeedAllyIds`, `:1535` `lowestSpeedEnemyIds`
- Test: Task 6 integration (Chakara under a Speed Down)

- [ ] **Step 1: Failing test** — a 2-ally team where ally B has the lower base speed but ally A receives a Speed Down making A the lowest; assert the `lowest-speed-ally` gate now resolves for A, not B, at the round it is evaluated.

- [ ] **Step 2:** Replace the once-computed `lowestSpeedAllyIds`/`lowestSpeedEnemyIds` Sets with a live computation: a function `lowestSpeedAllyIds()` that reads `effectiveSpeedOf` over `allPlayerActors` at call time (min effective speed → all ties). Update the `isLowestSpeedAllyFor` delegate (`roundContext`/`buildDrainContext` seam) to call it live. Mirror for enemy side. (The handover flagged this dependency: "speeds static = turn order" was load-bearing for Chakara — now lifted.)

- [ ] **Step 3:** Run the Chakara test + full suite. Audit any Chakara golden churn (synthetic goldens use no speed buffs → expect none). Commit `fix(combat): Chakara lowest-speed gate reads live effective speed`.

---

## Task 6: Integration tests, golden audit, verify pass, docs

**Files:**
- Create: `src/utils/combat/__tests__/dynamicSpeed.integration.test.ts`
- Modify: `src/pages/DocumentationPage.tsx` (simulator/combat section — note speed now drives dynamic order)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

- [ ] **Step 1:** Integration tests (drive `runCombat` / `simulateBattle`):
   - Speed Down on a fast enemy reorders it later in the round.
   - Speed Up on a slow ally reorders it earlier.
   - Thresh-style: buffed-then-expired speed → extra action lands further back.
   - Liberator scenario A (acted, then ally kills → extra action re-selected) and B (slow Liberator, ally kills first → two actions this round), incl. once-per-round cap (second death → no third action).
   - Harvester end-of-round extra action drains last.
   - Guard test: a non-speed stat (attack) buff still applies live (regression net for the loop rewrite).

- [ ] **Step 2:** Run `npm test` — full green. Re-audit the complete golden diff vs `main`/branch-base: confirm DPS single-attacker goldens are byte-identical; every other change is justified in a comment or a regenerated-with-reason note.

- [ ] **Step 3:** `npm run lint`, `npx tsc --noEmit`, `npm run audit:skills` (expect 0 findings — no skill-parsing semantics changed beyond additive speed mapping).

- [ ] **Step 4: Manual verify** on :3000 `/simulator`: place a team with a Speed Up/Down ship vs an enemy team, Run, step rounds, confirm the turn-order strip reorders when the buff lands/expires. (The simulator page is the harness.)

- [ ] **Step 5:** DocumentationPage + changelog entry ("Combat simulator now reflects speed buffs/debuffs in turn order; ships with conditional extra actions re-enter the queue at their current speed").

- [ ] **Step 6: Commit** `test(combat): dynamic speed integration + docs/changelog`. Open/update the PR.

---

## Risks & mitigations

- **Loop rewrite (Task 3) is the high-risk step.** Mitigation: the per-turn dispatch bodies are copied verbatim; only selection + extra-action re-entry change. The full existing suite is the regression net; triage every failure rather than bulk-updating.
- **`effectiveSpeedOf` source completeness.** If Task 0 finds a gated/modifier speed buff, extend Task 2b accordingly; otherwise the timed/always + ability-status fold suffices.
- **Golden churn.** Acceptable but must be audited per-snapshot. DPS single-attacker goldens are the canary — they must not move.
- **Dummy `enemy` sink + Path B buffer** are the subtle bits of the loop; Task 3 Step 6 guards them explicitly.
