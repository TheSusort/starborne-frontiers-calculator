# Positional Per-Victim Stored-Damage Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete per-victim resolution of all stored/continuous damage (skill detonation, timed bursts, DoT ticks) across all four combat turn-branch sites, both directions, so positioned victims resolve their own containers against their own HP.

**Architecture:** Three stacked PRs (A→B→C) on top of PR3 (`feat/combat-positional-detonation-pr3-enemy`, #170). Each routes per-victim payout through the existing `applyVictimDamage` sink (Approach A, inherited from the parent detonation epic) and stays byte-identical for non-positional goldens. PR-A extracts the now-duplicated detonation loop into a shared closure then adds the walked-team site; PR-B mirrors PR2's timed bursts onto the player side; PR-C adds per-victim DoT ticks both sides and unifies the heal-target tick path.

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/engine.ts` (one large `runCombat` closure), pure detonation helper in `src/utils/combat/detonation.ts`.

**Spec:** `docs/superpowers/specs/2026-06-27-positional-per-victim-stored-damage-completion-design.md`

---

## Conventions for this epic (read first)

- **All `engine.ts:NNNN` references are grep-anchors, not literal offsets.** Line numbers drift, and each stacked PR shifts them further. Always grep for the named marker (the comment text or symbol) to locate a site.
- **Golden discipline:** hand-validate **every** positional delta; **never** `vitest -u`. Run the **whole** `npm test` suite for each golden audit — detonation/DoT fixtures live outside `src/utils/combat` (e.g. `healingGoldenParity`).
- **Auth/workflow:** `gh auth switch --user TheSusort` before any `gh` call. Dev server on :3000. In-place branches (no worktree) per the established epic pattern; if a worktree is used, copy `.env` + `docs/*.csv` and symlink `node_modules`.
- **Byte-identical proof:** after each task, `npm test` must show ZERO `.snap` files moved and no pre-existing golden changes. tsc + lint clean (`npm run lint` is max-warnings 0).
- **Stacking:** PR-A branches off #170. PR-B off PR-A. PR-C off PR-B. Detail PR-B/PR-C in-place once the prior PR lands (line numbers will have moved).

---

## PR-A — Walked-team skill detonation + shared-helper extraction

**Branch:** `feat/combat-positional-detonation-pr4-walked-team` off `feat/combat-positional-detonation-pr3-enemy`.

**Two commits:** (1) byte-identical refactor extracting `applyPerVictimDetonation`; (2) the walked-team site (new behavior).

### Task A1: Extract the shared per-victim detonation closure (byte-identical refactor)

**Files:**
- Modify: `src/utils/combat/engine.ts` (focus block — grep `for (const victim of detonationTargets.values())` near the focus attacker turn, currently ~`:4496`; enemy block — same marker near the enemy-attacker turn, currently ~`:5316`)
- Test: the entire existing suite is the guard (no new test file — this is a provably-inert refactor)

The two loops are identical except the sink (`enemySink`/`playerSink`) and recipe variable. Both close over `applyVictimDamage`, `bus`, `r`, `perActorDetonation`, `roundPerTargetDamage`, `tb`, and `detonateContainers`.

- [ ] **Step 1: Establish the green baseline.**

Run: `npm test 2>&1 | tail -20`
Expected: full suite green (note the exact test count, e.g. `3477 passed`). Record it — A1 must not change it.

- [ ] **Step 2: Define the shared closure.**

Add this inner function in `runCombat`'s scope, AFTER `perActorDetonation` is declared and AFTER `tb`/`turnBindings` are available but BEFORE the turn loop (grep for `let perActorDetonation` ~`:1944` and `const drivePositionalApply` ~`:3393`; place it adjacent to `drivePositionalApply` so it shares the same closure neighborhood). The body is the existing focus loop verbatim, parameterized:

```typescript
// Shared per-victim skill-triggered detonation loop. Each victim hit by the cast
// that is STILL ALIVE detonates its OWN containers (no role-scale). Bombs = full
// shield drain/no pen; inferno+corrosion BYPASS shield. Credited to the detonating
// actor's per-round detonation tally + roundPerTargetDamage; NOT into cumulativeDamage
// (HP lands per-victim via applyVictimDamage). Used by the focus (player→enemy),
// enemy (enemy→player), and walked-team (player→enemy) sites — the ONLY difference
// between call sites is the sink + the recipe source.
const applyPerVictimDetonation = (
    recipe: DetonationRecipe,
    victims: Map<string, CombatActor>,
    sink: DamageAccountingSink,
    actorId: string
): void => {
    for (const victim of victims.values()) {
        if (victim.currentHp <= 0) continue; // died to the firing hit (already splashed)
        const result = detonateContainers(recipe, {
            corrosionEntries: victim.corrosionEntries,
            infernoEntries: victim.infernoEntries,
            pendingBombs: victim.pendingBombs,
            victimHp: tb.victimMaxHpFor(victim),
        });
        if (result.bomb > 0) {
            applyVictimDamage(result.bomb, victim, sink, {
                killerId: actorId,
                byDirectDamage: true,
                bombPortion: result.bomb, // full shield drain, no pen
                shieldPenetrationPct: 0,
            });
            bus.emit({
                type: 'bomb-detonated',
                actorId,
                round: r,
                stacks: result.bombStacks,
                damage: result.bomb,
            });
            roundPerTargetDamage.set(
                victim.id,
                (roundPerTargetDamage.get(victim.id) ?? 0) + result.bomb
            );
        }
        const bypass = result.inferno + result.corrosion;
        if (bypass > 0) {
            applyVictimDamage(bypass, victim, sink, { byDirectDamage: false }); // DoT → bypass shield
            bus.emit({ type: 'dot-detonated', targetId: victim.id, round: r, damage: bypass });
            roundPerTargetDamage.set(
                victim.id,
                (roundPerTargetDamage.get(victim.id) ?? 0) + bypass
            );
        }
        const dealt = result.bomb + bypass;
        if (dealt > 0) {
            perActorDetonation.set(actorId, (perActorDetonation.get(actorId) ?? 0) + dealt);
        }
    }
};
```

> **Caveat:** `tb` is per-side (`turnBindings(actor.side)`) at each call site. The focus/walked-team sites use the player→enemy `tb`; the enemy site uses the enemy→player `tb`. `victimMaxHpFor` must come from the **caller's** `tb`, not a captured one. Therefore pass `tb` in too — amend the signature to `(recipe, victims, sink, actorId, tb)` and have each call site pass its own `tb`. Verify which `tb` each existing loop used before extracting (grep `const tb = turnBindings` above each loop).
>
> **Capture guard:** the helper body must reference ONLY its parameters plus the legitimately-shared closures (`applyVictimDamage`, `bus`, `r`, `perActorDetonation`, `roundPerTargetDamage`, `detonateContainers`). It must NOT reference any outer `tb`, `actor`, `detonationRecipe`, or `enemyPositionalDetonation` — those differ per call site and are now passed in. After extracting, scan the body to confirm no accidental outer capture.

- [ ] **Step 3: Replace the focus block with a call.**

Grep the focus loop (`for (const victim of detonationTargets.values())` near the focus attacker turn). Replace the whole `if (detonationRecipe && detonationRecipe.dets.length > 0) { for (...) {...} }` body's inner loop with:
```typescript
if (detonationRecipe && detonationRecipe.dets.length > 0) {
    applyPerVictimDetonation(detonationRecipe, detonationTargets, enemySink, actor.id, tb);
}
```

- [ ] **Step 4: Replace the enemy block with a call.**

Grep the enemy loop (same marker near the enemy-attacker turn, uses `enemyPositionalDetonation` + `playerSink`). Replace with:
```typescript
if (enemyPositionalDetonation && enemyPositionalDetonation.dets.length > 0) {
    applyPerVictimDetonation(enemyPositionalDetonation, detonationTargets, playerSink, actor.id, tb);
}
```

- [ ] **Step 5: tsc + lint + full suite — prove inert.**

Run: `npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -20`
Expected: tsc clean, lint clean, suite green with the **exact same count** as Step 1, ZERO `.snap` moved.

- [ ] **Step 6: Commit.**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): extract shared per-victim detonation closure

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task A2: Walked-team per-victim detonation (new behavior)

**Files:**
- Modify: `src/utils/combat/engine.ts` (positional-hint gate — grep `a.id === focusActorId || a.side === 'enemy'`, ~`:3667`; walked-team branch — grep `WALKED TEAM TURN`, ~`:4618`; walked-team detonation credit — grep `creditDamage(actor.id, 'detonation', teamTurn.detonationDamage)`, ~`:4761`)
- Test: `src/utils/combat/__tests__/perVictimWalkedTeamDetonation.integration.test.ts` (new)

- [ ] **Step 1: Write the failing integration test.**

Model on `perVictimEnemyDetonation.integration.test.ts`. Use `__testTapActors` seeding, crit 0 for exact integers. Cases:
1. A **walked-team ally** (not the focus attacker), positioned with a parsed target+pattern, casts a detonate-dot skill; seed bombs on a covered footprint victim → assert that victim's bombs detonate against its own HP (covered victim no longer ignored).
2. Seed corrosion on a victim → assert it uses that victim's own HP (`min(victimHp,500k)`), bypasses shield.
3. Detonation kills a covered victim → assert death event + bomb-splash-on-death chain.
4. Credit attributed per applier; `bomb-detonated`/`dot-detonated` emit per victim with own `targetId`.
5. **Non-positional regression pin:** a walked-team detonate in non-positional mode still surfaces `detonationDamage` via the legacy aggregate path (assert unchanged).
6. **isPositional-gate negative pin:** walked-team actor with target but NO pattern stays on legacy path (no per-victim detonation) — prove non-vacuous by asserting the legacy credit fires.

- [ ] **Step 2: Run it — verify it fails.**

Run: `npx vitest run src/utils/combat/__tests__/perVictimWalkedTeamDetonation.integration.test.ts`
Expected: FAIL — covered victim's bombs ignored / no per-victim detonation (walked-team still on anchor path).

- [ ] **Step 3: Widen the positional-hint gate.**

Grep `a.id === focusActorId || a.side === 'enemy'`. Extend to include positioned walked-team players. Confirm the exact predicate the focus/enemy sites use; the walked-team condition should mirror the `teamPositional` gate (`a.kind === 'team'` and positioned vs `enemyAttackerActors`). Verify (read playerTurn.ts `buildTurnArgs`/`runPlayerTurn`) that `positional:true` ONLY swaps `detonate()` for the recipe build — no other behavior change — exactly as PR3 verified.

- [ ] **Step 4: Collect `detonationTargets` in the walked-team apply hook.**

In the walked-team branch, in the existing `drivePositionalApply` `onVictimResolved` callback (grep `teamFocusEnemyHit = true`), add (mirroring the focus site) a `const detonationTargets = new Map<string, CombatActor>();` before the call and `detonationTargets.set(victim.id, victim);` inside the hook.

- [ ] **Step 5: Call the shared closure + suppress the aggregate credit.**

After `drivePositionalApply` in the walked-team branch, add:
```typescript
const teamDetonationRecipe = teamTurn.positionalDetonation;
if (teamDetonationRecipe && teamDetonationRecipe.dets.length > 0) {
    applyPerVictimDetonation(teamDetonationRecipe, detonationTargets, enemySink, actor.id, tb);
}
```
Then move the existing `creditDamage(actor.id, 'detonation', teamTurn.detonationDamage)` (grep it, ~`:4761`) INTO the `if (!teamPositional)` block — mirror exactly how the focus site nests detonation credit in `if (!positional)`.

- [ ] **Step 6: Run the new test — verify it passes.**

Run: `npx vitest run src/utils/combat/__tests__/perVictimWalkedTeamDetonation.integration.test.ts`
Expected: PASS.

- [ ] **Step 7: tsc + lint + full suite audit.**

Run: `npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -30`
Expected: clean; only the new test added; ZERO existing `.snap` moved.

- [ ] **Step 8: Commit.**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/perVictimWalkedTeamDetonation.integration.test.ts
git commit -m "feat(combat): walked-team per-victim skill-triggered detonation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task A3: Changelog + docs

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx` if the positional-sim section describes detonation coverage

- [ ] **Step 1:** Add a plain-English `UNRELEASED_CHANGES` entry: positioned ally ships now detonate their targets' bombs/DoTs per-victim (previously only the focus attacker and enemies did).
- [ ] **Step 2:** Commit `docs(combat): changelog for walked-team per-victim detonation`.

### Task A4: Review + PR

- [ ] **Step 1:** Final holistic review (the parent epic's practice: confirm the four detonation sites are now mutually consistent, no cumulativeDamage double-count, symmetry intact). Use superpowers:requesting-code-review.
- [ ] **Step 2:** `gh auth switch --user TheSusort`; push; open PR-A stacked on #170 (base `feat/combat-positional-detonation-pr3-enemy`).

---

## PR-B — Positioned-player timed bursts (OUTLINE — detail in-place after PR-A lands)

**Branch:** off PR-A. Mirror of PR2 (grep `PER-POSITIONED-ENEMY TIMED BURST`, ~`:4886`) onto the player attacker (grep `ATTACKER TURN`, ~`:4314`) and walked-team (grep `WALKED TEAM TURN`) branches.

**Shape (per site):** at the start of the turn body, after `firstActivatorId ??=`, inside the `!isTurnBlocked` gate:
- Gate `(actor.pendingBombs.length > 0 || actor.pendingAccumulators.length > 0) && isPositional(actor.position, enemyAttackerActors)`.
- `processBombs` + `processAccumulators` callbacks route via `applyVictimDamage(dmg, actor, playerSink, { killerId: sourceId, byDirectDamage:true, bombPortion: dmg, shieldPenetrationPct:0 })` (accumulator same flags), `roundPerTargetDamage[actor.id]`, `perActorDetonation[sourceId]` (applier-keyed). NEVER `creditDamage('detonation')`.
- Accumulator gather input: reuse `allPlayersDirect` with inline `// symmetric input TBD — inert, no fixture` note.
- Dead-after-burst guard on `actor.destroyedRound !== undefined` (+ healTarget carve-out). Focus attacker: lethal self-burst still `pushSynthesizedFocusSkipTurn()`.

**Tests:** `perVictimPlayerTimedDetonation.integration.test.ts` — burst on positioned player (focus + walked-team) via `playerSink`; lethal burst → death/splash; non-positional + gate-negative pins.

**Detailing checklist when PR-B starts:** re-grep all anchors (shifted by PR-A); decide whether the two player sites share a helper closure like A1 did (likely yes — extract `applyPositionedTimedBurst` if the focus/walked-team/enemy timed blocks triplicate); confirm `pushSynthesizedFocusSkipTurn` ordering vs the burst.

---

## PR-C — Per-victim DoT ticks, both sides (OUTLINE — detail in-place after PR-B lands)

**Branch:** off PR-B. **Highest risk** — Task 0 is a blocking written deliverable before any apply code.

### Task C0 (BLOCKING, written deliverable, reviewed before code)
Produce a channel-map: which `creditDamage` channels (`dot-inferno`, `dot-corrosion`, …) feed `cumulativeDamage` and thus the line-5326/5432 `enemy.currentHp` overwrite. Confirm the per-victim display story — the DPS DoT breakdown (`dot-*` totals) must still reflect per-victim ticks for the focus actor WITHOUT feeding HP twice (the detonation precedent: HP via `applyVictimDamage`, display via `roundPerTargetDamage` + per-victim path, aggregate credit suppressed in positional). Commit as a plan note; review before C.1/C.2.

### C.1 — player→enemy (positioned enemies)
Add `tickDoTs` at the enemy-attacker turn-start, ahead of PR2's timed block (canonical order `tickDoTs → processBombs → processAccumulators`). HP via `applyVictimDamage(dmg, actor, enemySink, { byDirectDamage:false })`; per-applier ctx via `lastTurnCtxByActor`; corrosion `baseHp = recipientMaxHp(actor.id)`; per-victim `dot-ticked`; suppress the cumulativeDamage feed for positioned enemies (per C0). Gate: positioned enemy with non-empty DoT containers.

### C.2 — enemy→player (unify the heal-target path)
Replace the heal-target prologue (grep `Task 11b: tick the HEAL TARGET's own enemy-applied DoTs`, ~`:4248`) with ONE per-victim DoT-tick path at every positioned player's turn-start (attacker + walked-team). Routes via `playerSink`/`applyIncomingToTarget` (`byDirectDamage:false`); per-applier ctx; corrosion `baseHp = recipientMaxHp(victim.id)`; per-victim Vortex Veil `incomingDotReductionPct`. Heal-target stays a branch: `tankDotSnapshot`, `tankDotDamage`→incoming healing accounting, `handleDeadTargetSkip` all fire when victim IS the heal target. Single path keyed per turning actor → structural double-tick guard.

**Tests:** `perVictimDotTick.integration.test.ts` — C.1 enemy own-HP tick (corrosion uses own HP) + lethal tick→death; C.2 non-heal-target player tick + heal-target still ticks once with accounting/snapshot/dead-skip intact (unification regression); E5-symmetry pin (same carrier ticks identical integers/events both sides); non-positional + DPS-mode regression pins.

**Detailing checklist when PR-C starts:** complete C0 first and get it reviewed; re-grep all anchors; design the per-victim DoT-tick closure (it will be called at 3+ sites — enemy, attacker, walked-team — so extract like A1/B); carefully preserve every heal-target side-effect during unification (the highest golden-move risk in the epic).

---

## Done criteria (whole epic)
- Skill detonation, timed bursts, and DoT ticks all resolve per-victim at every applicable turn-branch site, both directions.
- Every PR byte-identical for non-positional/DPS goldens (ZERO `.snap` moved per PR).
- E5-symmetry pins green (same ship behaves identically on either side) for detonation (existing), timed bursts (PR-B), and DoT ticks (PR-C).
- tsc + lint (max-warnings 0) clean; full `npm test` green.
