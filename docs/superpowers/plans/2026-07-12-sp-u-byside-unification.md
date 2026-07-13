# SP-U bySide Engine Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the residual player/enemy mirror in `src/utils/combat/engine.ts` (R1–R6) and migrate the DPS calculator onto a real finite-HP skill-less enemy actor, deleting the dummy scalar sink.

**Architecture:** Five sequential increments (each a mergeable PR) — U4 was folded into U5 mid-execution (see Task 4 stub). U1–U3 are **byte-identical pure refactors** — the existing golden corpus is the test oracle; a golden diff = a bug. U5 carries the R6 `healTargetId` decouple (byte-identical phase 5a-0) plus the **sole audited golden move** (real enemy replaces the dummy sink; DPS goldens shift with an inspected diff). U6 is **additive UI** (no golden surface). Each increment ends green: `npm test`, `npm run audit:skills` (0 findings), `npm run lint`, `npx tsc --noEmit`.

**Tech Stack:** TypeScript, Vitest, React 18, Vite. Combat engine is a single large module (`engine.ts`, ~8078 lines) already ~80% unified behind `bySide(side)` / `TurnBindings` / `sink`.

**Spec:** `docs/superpowers/specs/2026-07-12-sp-u-byside-unification-design.md` — read it first.

## Global Constraints

- **Golden discipline:** `vitest -u` is FORBIDDEN. U1–U4 + U6 keep BOTH golden tiers (synthetic DPS/healing + sim `BattleResult`) byte-identical. U5 is the only sanctioned golden regen, and every regenerated snapshot must be inspected line-by-line and justified in the PR body.
- **Team-symmetric:** every mechanic behaves identically on either side (a ship acts the same as player or enemy).
- **Production RNG untouched:** production is `Math.random`; only the test harness seeds/streams (SP-0 keyed sub-streams).
- **Per-increment green gate:** `npm test` (all files), `npm run audit:skills` → 0 findings, `npm run lint` (max-warnings 0), `npx tsc --noEmit`.
- **Workflow:** `gh auth switch --user TheSusort` before any PR op; docs are gitignored → `git add -f` and docs-only commits use `--no-verify`; dev server on port 3000.
- **Branch:** `sp-u/byside-unification`, off `main` @ `fb595fb7`. Each increment is its own PR onto main (or stacked, orchestrator's call).
- **Commit trailer:** end commit messages with the Co-Authored-By + Claude-Session trailer used across this repo.

---

## File map

| File | Responsibility | Touched by |
|------|----------------|-----------|
| `src/utils/combat/engine.ts` | The combat loop; all residual dual-path (R1–R6) lives here | U1, U2, U3, U5 (R6 folded into U5) |
| `src/utils/calculators/battleSimulator.ts` | Real-vs-real sim adapter; sets the vestigial `healTargetId` | U5 (R6 decouple) |
| `src/utils/calculators/dpsSimulator.ts` | DPS adapter over the engine; owns `DPSSimulationSummary` | U5 |
| `src/utils/calculators/healingEngineAdapter.ts` | Healing adapter; sets a real `healTargetId` | U5 (verify only) |
| `src/utils/calculators/__tests__/simGolden.test.ts` + `simGoldenFixtures.ts` | SP-0 sim goldens | U5 (add death-path + heal-casting fixtures) |
| `src/pages/calculators/DPSCalculatorPage.tsx` | DPS page state + ranking + charts | U5 (wiring), U6 (metric display) |
| `src/components/calculator/EnemySettingsPanel.tsx` | DPS enemy-config UI | U6 |
| `src/pages/DocumentationPage.tsx` | In-app docs | U6 |
| `src/constants/changelog.ts` | `UNRELEASED_CHANGES` | U5, U6 (user-facing) |

---

## Task 1 (U1): Collapse `playerSink` / `enemySink` → one `sink`

**Files:**
- Modify: `src/utils/combat/engine.ts` (sink defs `4206–4216` and `4265–4275`; consumers `applyIncomingToTarget` `4245`, `applyOutgoingToEnemy` `4286`)

**Interfaces:**
- Consumes: `intakeFor(id)`, `DamageAccountingSink`, `applyVictimDamage` (all existing).
- Produces: a single `const sink: DamageAccountingSink` replacing both `playerSink` and `enemySink`. No signature changes to `applyIncomingToTarget` / `applyOutgoingToEnemy`.

**Why byte-identical:** the two sink objects have identical bodies today (both `intakeFor(victimId).<field> += amount`). Collapsing them cannot change any value.

- [ ] **Step 1: Confirm the bodies are identical.** Read `engine.ts:4206–4216` and `4265–4275`. Verify all three methods (`addIncoming`/`addShieldAbsorbed`/`addBarrierAbsorbed`) are textually identical modulo the variable name. If they diverge in any way, STOP and report — the collapse is not safe.

- [ ] **Step 2: Define one `sink`.** Replace the `playerSink` definition (`4206–4216`) with a single `const sink: DamageAccountingSink = { … }` (same three methods). Delete the `enemySink` definition (`4265–4275`). Keep the surrounding comments (merge the two rationale comments into one that notes it serves both directions — ids are globally unique across sides).

- [ ] **Step 3: Route both consumers through `sink`.** In `applyIncomingToTarget` change `applyVictimDamage(damage, victim, playerSink, …)` (`4245`) → `sink`. In `applyOutgoingToEnemy` change `applyVictimDamage(damage, enemyVictim, enemySink, …)` (`4286`) → `sink`.

- [ ] **Step 4: Verify no stale references.** Run `grep -n "playerSink\|enemySink" src/utils/combat/engine.ts` — expect zero matches.

- [ ] **Step 5: Green gate (golden oracle).**

```bash
npm test 2>&1 | tail -20        # ALL files green, ZERO golden diffs
npm run audit:skills            # 0 findings
npm run lint && npx tsc --noEmit
```
Expected: full suite green with no snapshot changes. If any golden moved, the collapse was not byte-identical — revert and investigate.

- [ ] **Step 6: Commit.**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): collapse player/enemy damage sinks into one (SP-U U1)"
```

---

## Task 2 (U2): Extract the triplicated positional-apply block (Option B)

> **Reshaped 2026-07-12** after the U2 implementer's diff table disproved the original premise. The three turn-body *tails* do NOT diverge only by `TurnBindings`: the **enemy** tail uses a different accounting model (credits *incoming* via `applyIncomingToTarget` + a damage-taken leech block + distinct `attacked` emit + `roundEnemyEffects` display grouping + pre-call incoming-reduction), which is the incoming-damage model that **U5** rewrites when the scalar sink dies. Forcing a full 3-way `applyTurnResult` now would create the `if (side==='enemy')` tangle the escalate clause forbids. **Option B (chosen):** extract only the genuinely-unifiable chunk — the triplicated *positional-apply block* (the single largest duplicated section, present near-verbatim at all three sites) — behind a side-parameterized helper with an `onVictimResolved` leech callback. The incoming-vs-outgoing accounting divergence stays inline, deferred to U5.

**Files:**
- Modify: `src/utils/combat/engine.ts` (positional-apply block: focus `~6337–6474`, team `~6648–6773`, enemy `~7353–7478`; `runPlayerTurn` calls at focus `6280`, team `6613`, enemy `7165`)

**Interfaces:**
- Consumes: `TurnBindings` / `turnBindings(side)` (`~4898–4959`) — specifically `tb.opposingRoster` and `tb.applyToVictim`; the unified `sink` from U1; `drivePositionalApply`, per-victim detonation, the per-victim emits; the pre-call head-locals `preTurnVictimStatus`, `target`, `pattern`, `tgt`, `turnArgs.aoeVictimIds`.
- Produces: a single side-parameterized helper, e.g.
  `drivePositionalTurnApply(actor: CombatActor, tb: TurnBindings, sel: PositionalTurnSel, onVictimResolved: (victim, dmg, outcome) => void): void`
  where `sel` carries the pre-call head-locals the block reads (`{ tgt, pattern, target, preTurnVictimStatus, aoeVictimCount }`) and `onVictimResolved` injects the per-victim leech direction: focus/team pass `procStandingLeechesPerVictim(actor.id, dmg)` (player→enemy standing leech); enemy passes `procTakenLeechesPerVictim(victim, dmg, outcome)` + captures `positionalShieldWasHit`. Exact param-object shape and callback signature finalized by the implementer against the live code (the diff table in `.superpowers/sdd/task-2-report.md` is the map).

**Why byte-identical:** the positional-apply block is ALREADY tb-parameterized (`tb.opposingRoster` / `tb.applyToVictim`); the only per-site divergence inside it is the leech direction (Note A in the diff table), which the `onVictimResolved` callback isolates. Everything else in the block is verbatim modulo local variable names (`turn`/`teamTurn`, `d`/`td`, `critAgg`/`teamCritAgg`). Extracting it reproduces each site exactly. Golden corpus is the oracle — do NOT write new "failing" tests. Event EMISSION ORDER within the block is load-bearing — preserve it exactly.

- [ ] **Step 1: Confirm the block boundaries against the diff table.** Open `.superpowers/sdd/task-2-report.md` (rows 3–4 + Note A). Re-read the positional-apply block at all three sites (focus `~6337–6474`, team `~6648–6773`, enemy `~7353–7478`). Confirm the ONLY intra-block divergence is the `onVictimResolved` leech direction (Note A). If a second genuine divergence exists inside the block, record it and treat it the same way (a second injected callback) — do not branch on `side` inside the helper.

- [ ] **Step 2: Extract `drivePositionalTurnApply`.** Create the helper co-located with `buildTurnArgs` (near `~5159`). Move the block body in, taking `sel` (the head-locals) as a param and calling `onVictimResolved` at the per-victim leech point. Replace captured per-side literals with `tb.*` accessors.

- [ ] **Step 3: Call it from all three sites.** Replace the three inlined positional-apply blocks with a `drivePositionalTurnApply(actor, tb, sel, onVictimResolved)` call, passing each site's `sel` and its leech callback. Leave the surrounding tail rows (the incoming-vs-outgoing accounting, focus/team/enemy role-specific rows) inline. Add a one-line comment at the enemy site noting its incoming-accounting tail is deferred to U5.

- [ ] **Step 4: Green gate (golden oracle).**

```bash
npm test 2>&1 | tail -30        # ZERO golden diffs across DPS/healing + sim tiers
npm run audit:skills
npm run lint && npx tsc --noEmit
```
Expected: full suite green, no snapshot changes. Any golden move = the extraction dropped/reordered an emit or mis-wired a callback → revert and re-check Step 1.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): extract triplicated positional-apply block into drivePositionalTurnApply (SP-U U2)"
```

---

## Task 3 (U3): Merge the twin reactive machinery

**Files:**
- Modify: `src/utils/combat/engine.ts` (`intentQueue` `2660` / `enemyIntentQueue` `2722`; `registerReactiveListeners` `2702` + `2728`; `drainIntents` `5751` / `drainEnemyIntents` `5780`; paired call sites `5845–5846`, `7671–7672`, `7701–7702`, `7843–7844`)

**Interfaces:**
- Consumes: `drainQueue(queue, sideCtx)` (`5519`, already unified), `ReactiveSideCtx`, `registerReactiveListeners`, `isEnemySide`.
- Produces: one bySide reactive structure keyed by side, e.g.
  `intentQueues: Record<Side, IntentQueue>` and `drainIntentsFor(side: Side): void`, with the paired call sites replaced by a loop over both sides in a **fixed, documented order** (whatever order reproduces today's paired-call sequence — verify against the golden corpus which side drains first).

**Why byte-identical:** the drain machinery (`drainQueue`) is already shared; only the two queues + their `ReactiveSideCtx` (`isOpposing: isEnemySide` vs `!isEnemySide`) and the registration differ. Preserving the existing drain ORDER at each paired call site keeps emission order — and thus goldens — identical.

- [ ] **Step 1: Pin the drain order.** At each of the four paired call sites (`5845–5846`, `7671–7672`, `7701–7702`, `7843–7844`), note which of `drainIntents` / `drainEnemyIntents` is called first. This order is load-bearing for event-emission order in goldens — record it.

- [ ] **Step 2: Build the bySide queue structure.** Replace the two `IntentQueue` locals with `intentQueues: Record<Side, …>`. Replace the two `registerReactiveListeners` calls with one loop over sides that passes the correct `ReactiveSideCtx` (`isOpposing` = `side === 'enemy' ? !isEnemySide-equivalent …` — reproduce the existing per-side value exactly).

- [ ] **Step 3: Replace the drains.** Define `drainIntentsFor(side)` wrapping `drainQueue(intentQueues[side], sideCtx(side))`. At each paired call site, call the two sides in the Step-1 order (do NOT reorder).

- [ ] **Step 4: Green gate (golden oracle).**

```bash
npm test 2>&1 | tail -20        # ZERO golden diffs (emission order preserved)
npm run audit:skills
npm run lint && npx tsc --noEmit
```
Expected: full suite green, no snapshot changes. A golden move here almost always = a drain-order flip → recheck Step 1.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): merge twin reactive intent queues into one bySide structure (SP-U U3)"
```

---

## Task 4 (U4): REMOVED — folded into Task 5 (U5)

> **Reshaped 2026-07-12.** U4 (decouple enemy-roster construction from `healTargetId`, R6) proved impossible as a byte-identical standalone refactor. The U4 implementer's investigation (report `.superpowers/sdd/task-4-report.md`) found that `battleSimulator`'s fake `healTargetId: focus.id` is NOT purely vestigial: besides unlocking the enemy roster it also builds `healingCtx`, which is what makes heal-casting ships actually heal in **real-vs-real sim mode** (`positionalTeamBattle` + `lowestHpAllyId`). Removing it silently regresses that feature (uncaught — no current sim golden has a healer). Worse, the two crash sites it exposed — `takenLeechesByOwner.get(healTarget!.id)` (leech keyed to the single heal target) and the `legacyVictim` fallback → `tgt.currentHp` — live in the **enemy incoming-accounting tail** that U2 already deferred to U5 and that U5 converts to per-victim. R6 is therefore inseparable from U5's accounting rework. **Decision: fold R6 into U5.** See Task 5's new phase 5a-0.

---

## Task 5 (U5): D4 keystone — decouple `healTargetId` (R6) + real finite-HP skill-less DPS enemy (the audited golden move)

**Files:**
- Modify: `src/utils/combat/engine.ts` (healing-mode signal: `healTargetId` read `~1963`, derived `healTarget` `~1968`, `healingMode` `~1972`, throw `~1977`; crash sites `takenLeechesByOwner.get(healTarget!.id)` `~7411` and `legacyVictim: healTarget!` `~4927`/`selectTurnTarget` fallback → `tgt.currentHp` `~6974`; `healingCtx` construction `~2593–2627`; dummy sink construct `~1477–1494`; scalar overwrite `~7773–7844`; the `indestructible` death-gate `~7822`) — **all line refs approximate; grep to locate (shifted by U1–U3).**
- Modify: `src/utils/calculators/battleSimulator.ts` (vestigial `healTargetId: focus.id` binding ~`900` + its doc paragraphs)
- Modify: `src/utils/calculators/dpsSimulator.ts` (`DPSSimulationSummary` `~179–191`; result assembly `~338–345`)
- Modify existing tests that assert the throw: `healing.test.ts` (the `.toThrow(/enemyAttackers require healTargetId/)` case ~`1168`) + review comments in `perVictimTimedDetonation.integration.test.ts`, `positionalDamage.integration.test.ts`, `protectionTransfer.integration.test.ts` that document the throw-forces-healing-mode behavior.
- Add test: `src/utils/calculators/__tests__/dpsSimulator.test.ts` (new `roundsToKill` / `survived` cases) — use the existing DPS test file if present, else create it
- Modify: `src/utils/calculators/__tests__/simGoldenFixtures.ts` + `simGolden.test.ts` (add a death-path fixture AND a heal-casting sim fixture — see 5c)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

**Interfaces:**
- Consumes: the engine's existing `enemyAttackers` real-actor input path (as used by healing/battle sims); `applyVictimDamage`; per-actor `roundDamage` map (`3330`); `BattleResult.outcome` shape (`{ winner, lastRound }`).
- Produces: extended `DPSSimulationSummary`:
  ```ts
  export interface DPSSimulationSummary {
      totalDamage: number;
      avgDamagePerRound: number;
      /** Round the enemy was destroyed; undefined if it survived the window. */
      roundsToKill?: number;
      /** True when the enemy survived all N rounds (never reached 0 HP). */
      survived: boolean;
      /** Enemy HP% remaining at the end of the window (0 when killed). */
      finalHpPct: number;
      totalDirectDamage: number;
      totalCorrosionDamage: number;
      totalInfernoDamage: number;
      totalDetonationDamage: number;
      totalSecondaryDamage: number;
      totalConditionalDamage: number;
      teamTotalDamage?: number;
  }
  ```

**This is the sole audited golden move.** DPS goldens WILL shift (scalar → per-victim basis + early termination). Each regenerated snapshot is inspected and justified. Sim goldens should stay stable — investigate any move (the new heal-casting sim fixture from 5c is added here, not regenerated).

### 5a-0 — Decouple `healTargetId` (R6), preserving sim-mode healing

This phase MUST land before 5a's scalar-sink deletion: the real DPS enemy has no heal target, so the engine must first tolerate `healTarget === undefined` while `enemyAttackers` are present, without crashing and without regressing sim-mode healing.

- [ ] **Step 0a: Introduce a healing-mode signal decoupled from `healTargetId`.** Today `healingMode = !!healTarget` and `healingCtx = healTarget ? {…} : undefined`. Replace the single `healTargetId`-truthiness proxy with an explicit signal: build `healingCtx` (and enable the heal/shield pipeline) when there is a heal FOCUS **or** a real positional team battle (the sim case). Concretely: gate `healingCtx` construction and `args.healing` on `healTarget || positionalTeamBattle` (the real-vs-real sim condition `battleSimulator` runs under), so removing the fake binding keeps `healingCtx` built for sim runs. The heal-application closures (`applyHealToTarget`/`grantShieldToTarget`/`lowestHpAllyId`) must resolve targets from the team roster, not from `healTarget` — verify they already do (they use `positionalTeamBattle` ally-resolution) or thread the roster in.

- [ ] **Step 0b: Build the enemy roster from `enemyAttackers` presence.** Change the roster-build/fire gate to key on `enemyAttackers?.length` instead of `healTargetId`. Remove `throw new Error('runCombat: enemyAttackers require healTargetId')`.

- [ ] **Step 0c: Guard the two crash sites.** `takenLeechesByOwner.get(healTarget!.id)` (~7411) → guard on `healingCtx`/`healTarget` (the enemy damage-taken-leech accounting is a healing-calculator concern; in DPS/sim mode it resolves per-victim via the U2 `onVictimResolved` path — do NOT key it to a single heal target). The `legacyVictim: healTarget!` fallback (~4927) feeding `tgt.currentHp` (~6974): when positional selection resolves no living target and there is no heal target, the enemy has no victim this turn → skip the apply (guard `tgt &&`) rather than crash. Confirm this skip is byte-identical for existing healing/sim goldens (where `healTarget` was always defined, so the guard never changed the path).

- [ ] **Step 0d: Drop the vestigial binding.** In `battleSimulator.ts`, remove `healTargetId: focus.id` (~900) and its VESTIGIAL doc paragraphs. Sim now passes no `healTargetId`; `healingCtx` is instead built via the `positionalTeamBattle` signal from Step 0a.

- [ ] **Step 0e: Update the throw-dependent tests.** Remove/rewrite `healing.test.ts`'s `.toThrow(/enemyAttackers require healTargetId/)` assertion (~1168). Review the 3 integration tests whose comments cite the throw as their reason for healing-mode; update comments where stale (no behavior change expected in them).

- [ ] **Step 0f: Green gate for the decouple (still byte-identical).**

```bash
npm test 2>&1 | tail -30        # sim + healing goldens byte-identical; the throw test now removed/rewritten
npm run audit:skills && npm run lint && npx tsc --noEmit
```
Expected: full suite green, NO golden diffs. The existing sim + healing goldens are the guard that the roster still builds and sim healing still runs. (The heal-casting sim fixture in 5c then LOCKS sim-mode healing against future regressions.) Commit this as its own commit within the U5 PR:
`git commit -m "refactor(combat): decouple healTargetId — enemy roster from enemyAttackers, healingCtx from positionalTeamBattle (SP-U U5)"`

### 5a — Engine: real enemy replaces the dummy sink

- [ ] **Step 1: Route DPS through a real enemy actor.** Build the DPS opponent as a real actor via the `enemyAttackers` path (real `hp`/`defence`/`security`/`speed`/`affinity`/`type`, **no skills** — no kit parsed). Remove `indestructible: true` from its construction (`1477–1494`). It now takes per-victim damage through `applyVictimDamage` like any real enemy and dies at 0 HP.

- [ ] **Step 2: Delete the scalar sink.** Remove the `cumulativeDamage`/`cumulativeTeamDamage` accumulation and the `enemy.currentHp = Math.max(0, enemyHp - enemyHpDecline)` overwrite (`~7779`, `~7802`, `~7808–7809`). Enemy HP now declines naturally via `applyVictimDamage`. Keep the `hp-changed` emission but source it from the real `enemy.currentHp`. Remove the `!enemy.indestructible` special-case at `~7822` (the enemy is now destructible; `recordDestroyed` fires normally). **Also fix the now-false comment at `~7297–7298`** ("Inert regardless (no production caller threads enemy position+pattern)") flagged in U2 review — the enemy positional path IS exercised (sim goldens + now the real DPS enemy); correct or delete it.

- [ ] **Step 2b: Verify the enemy accounting converges (do NOT force a full extraction).** With the scalar sink gone and the enemy real, the enemy's damage-taken accounting flows per-victim through `applyVictimDamage`/`intakeFor` like the player side (R5). Confirm the enemy incoming-accounting tail (the rows U2 left inline, `~7292`/`~7463`) now produces per-victim results and no longer depends on the deleted scalar. A full `applyTurnResult` merge of the enemy tail is OPTIONAL polish, not required by U5 — note it for the final review if the convergence makes it trivial, but do not expand U5's diff to force it.

- [ ] **Step 3: Verify HP%-gates read real HP.** Confirm `enemyHpPct` (threaded via `roundContext.ts` → `evaluateConditions.ts`) now derives from the real `enemy.currentHp`, not the deleted scalar. hp-threshold / enemy-hp-pct skills must still resolve.

- [ ] **Step 4: Full-suite golden inspection.**

```bash
npm test 2>&1 | tail -40
```
Expected: DPS goldens FAIL/change. For EACH changed snapshot, open the diff and confirm the change is explained by (per-victim damage basis) and/or (early termination on kill) — nothing else. If a change is unexplained, STOP. Sim + healing goldens should be unchanged.

- [ ] **Step 5: Regenerate ONLY the audited DPS goldens.** After confirming every diff is explained, regenerate the DPS golden snapshots (targeted, not repo-wide `-u`). Re-run `npm test` → green. Record the justification for the PR body.

### 5b — DPS adapter: rounds-to-kill

- [ ] **Step 6: Write failing adapter tests.**

```ts
// dpsSimulator.test.ts
it('reports roundsToKill when the enemy dies within the window', () => {
    const res = simulateDPS({ /* strong attacker, low-HP enemy, rounds: 20 */ });
    expect(res.summary.survived).toBe(false);
    expect(res.summary.roundsToKill).toBeGreaterThan(0);
    expect(res.summary.finalHpPct).toBe(0);
});

it('reports survived + finalHpPct when the enemy outlasts the window', () => {
    const res = simulateDPS({ /* weak attacker, high-HP enemy, rounds: 20 */ });
    expect(res.summary.survived).toBe(true);
    expect(res.summary.roundsToKill).toBeUndefined();
    expect(res.summary.finalHpPct).toBeGreaterThan(0);
});
```

- [ ] **Step 7: Run → expect FAIL** (`survived`/`roundsToKill`/`finalHpPct` not on the summary yet).

```bash
npx vitest run src/utils/calculators/__tests__/dpsSimulator.test.ts
```

- [ ] **Step 8: Implement.** Extend `DPSSimulationSummary` (signature above). In the result assembly (`338–345`), read the engine `BattleResult`: if the enemy is in the wiped set, `roundsToKill = outcome.lastRound`, `survived = false`, `finalHpPct = 0`; else `survived = true`, `roundsToKill = undefined`, `finalHpPct` = enemy's end-of-window HP%. Keep `totalDamage` / `avgDamagePerRound` as accumulated (now from per-actor `roundDamage`).

- [ ] **Step 9: Run → expect PASS.** Then full `npm test` green.

### 5c — Death-path + heal-casting sim goldens + changelog

- [ ] **Step 10: Add the death-path sim golden.** In `simGoldenFixtures.ts`, add a decisive-outcome fixture (a battle that terminates on a real wipe, `winner !== 'draw'`, `≥1` death). Add its snapshot assertion in `simGolden.test.ts`. This closes the SP-0 follow-up (all four existing sim goldens end in `draw`).

- [ ] **Step 10b: Add the heal-casting sim golden (locks sim-mode healing after the R6 decouple).** Add a fixture with a heal-casting ship on a real-vs-real team, so `positionalTeamBattle` + `lowestHpAllyId` heal-application is EXERCISED by a golden. This is the regression guard for 5a-0's healingCtx decoupling — without it, the sim-mode-healing feature has zero golden coverage. Snapshot it in `simGolden.test.ts` (writes once, then stable).

```bash
npx vitest run src/utils/calculators/__tests__/simGolden.test.ts   # new fixtures snapshot writes once, then stable
```

- [ ] **Step 11: Changelog.** Add a plain-English `UNRELEASED_CHANGES` entry: the DPS calculator now simulates a real, destructible target and reports rounds-to-kill.

- [ ] **Step 12: Green gate + commit.**

```bash
npm run audit:skills && npm run lint && npx tsc --noEmit && npm test 2>&1 | tail -20
git add src/utils/combat/engine.ts src/utils/calculators/dpsSimulator.ts \
        src/utils/calculators/__tests__/ src/constants/changelog.ts
git commit -m "feat(combat): DPS calc drives a real finite-HP skill-less enemy; rounds-to-kill (SP-U U5)"
```

---

## Task 6 (U6): DPS enemy-config UI + rounds-to-kill display (additive)

**Files:**
- Modify: `src/components/calculator/EnemySettingsPanel.tsx` (killable-target framing; keep manual stat-block + high-HP default)
- Modify: `src/pages/calculators/DPSCalculatorPage.tsx` (ranking + headline metric + kill-round chart marker)
- Modify: `src/components/calculator/ShipConfigSummary.tsx` (surface `roundsToKill` / `survived`)
- Modify: `src/pages/DocumentationPage.tsx` (DPS calc docs)
- Modify: `src/constants/changelog.ts`
- Add test: config-comparison ranking unit test (co-locate with the DPS page's existing tests, else a small pure ranking helper + its test)

**Interfaces:**
- Consumes: `DPSSimulationSummary` with `roundsToKill` / `survived` / `finalHpPct` (from U5).
- Produces: a pure ranking helper, e.g.
  `rankDpsConfigs(results: { id: string; summary: DPSSimulationSummary }[]): string[]` — returns config ids best→worst per the §4 rule. Kept pure and separately tested so the ranking logic isn't buried in JSX.

**No golden change** — UI only.

- [ ] **Step 1: Write failing ranking tests.**

```ts
it('ranks killers before survivors, killers by fewest rounds', () => {
    const order = rankDpsConfigs([
        { id: 'survivor', summary: s({ survived: true, finalHpPct: 30, totalDamage: 999 }) },
        { id: 'slow', summary: s({ survived: false, roundsToKill: 6, totalDamage: 200 }) },
        { id: 'fast', summary: s({ survived: false, roundsToKill: 4, totalDamage: 180 }) },
    ]);
    expect(order).toEqual(['fast', 'slow', 'survivor']);
});

it('breaks roundsToKill ties by higher total damage', () => {
    const order = rankDpsConfigs([
        { id: 'lo', summary: s({ survived: false, roundsToKill: 4, totalDamage: 100 }) },
        { id: 'hi', summary: s({ survived: false, roundsToKill: 4, totalDamage: 300 }) },
    ]);
    expect(order).toEqual(['hi', 'lo']);
});

it('ranks all-survived configs by lower remaining HP%', () => {
    const order = rankDpsConfigs([
        { id: 'a', summary: s({ survived: true, finalHpPct: 40, totalDamage: 100 }) },
        { id: 'b', summary: s({ survived: true, finalHpPct: 12, totalDamage: 100 }) },
    ]);
    expect(order).toEqual(['b', 'a']);   // graceful all-survived fallback
});
```
(`s()` = a small summary-fixture factory in the test file.)

- [ ] **Step 2: Run → expect FAIL** (`rankDpsConfigs` undefined).

- [ ] **Step 3: Implement `rankDpsConfigs`.** Killers first (ascending `roundsToKill`, tie-break descending `totalDamage`); survivors last (ascending `finalHpPct`). Pure function, no React.

- [ ] **Step 4: Run → expect PASS.**

- [ ] **Step 5: Wire the UI.** Use `rankDpsConfigs` for the comparison ordering; render the headline column as rounds-to-kill (killers) / "survived (X% HP left)" (survivors) in `ShipConfigSummary`, keeping total damage + avg/round as secondary. In the cumulative chart, mark the kill round where enemy HP reaches 0. Update `EnemySettingsPanel` copy to frame the enemy as a destructible target (manual stat-block unchanged; high-HP default retained per U-D4).

- [ ] **Step 6: Manual verification (dev server).** Start on :3000, open the DPS calculator, lower enemy HP so a config kills, confirm the ranking + rounds-to-kill display + kill-round chart marker; raise HP so all survive, confirm the "survived (X% HP)" fallback. Use the `verify` skill / browser tools; capture a screenshot for the PR.

- [ ] **Step 7: Docs + changelog.** Update `DocumentationPage.tsx` (DPS calc now a time-to-kill tool with a configurable target) and add an `UNRELEASED_CHANGES` entry.

- [ ] **Step 8: Green gate + commit.**

```bash
npm run audit:skills && npm run lint && npx tsc --noEmit && npm test 2>&1 | tail -20
git add src/components/calculator/ src/pages/calculators/DPSCalculatorPage.tsx \
        src/pages/DocumentationPage.tsx src/constants/changelog.ts
git commit -m "feat(calculator): DPS enemy-config + rounds-to-kill ranking UI (SP-U U6)"
```

---

## Self-review notes (author)

- **Spec coverage:** R1→U1, R2→U3, R3→U1, R4/R5→U5, **R6→U5 phase 5a-0 (folded from U4 after the U4 escalation — decoupling isn't byte-identical: the fake binding also enables sim-mode healing, and the crash sites are in the enemy incoming-accounting tail U5 reworks)**, positional-apply block (reshaped from PR7 tails)→U2; U-D1/U-D2 (finite enemy + rounds-to-kill)→U5/U6; U-D4 (high-HP default)→U6 Step 5; U-D5 (no ship picker)→U6 (manual stat-block only); SP-0 death-path golden→U5 Step 10; sim-mode-healing regression guard→U5 Step 10b (heal-casting sim golden). All spec sections mapped.
- **Refactor-vs-TDD:** U1–U3 + U5 phase 5a-0 are byte-identical refactors (golden corpus as oracle — no red state to write); U5 5a/5b + U6 use red-green TDD for the new `roundsToKill`/ranking behavior and the audited golden move. This is deliberate, not a placeholder gap.
- **Type consistency:** `DPSSimulationSummary` fields (`roundsToKill?`, `survived`, `finalHpPct`) are defined once in U5 and consumed unchanged by `rankDpsConfigs` in U6.
- **Deferred detail:** U2/U3 give exact locations + target signatures + the byte-identical invariant rather than literal merged bodies, because the final code depends on the live line-by-line diff the implementer must read first (Step 1 of each). This is the honest granularity for an in-place refactor of an 8000-line module under a golden guard.
