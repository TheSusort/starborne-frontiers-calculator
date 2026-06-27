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

## PR-B — Positioned-player timed bursts

**Branch:** `feat/combat-positional-detonation-pr5-player-timed` off PR-A (`feat/combat-positional-detonation-pr4-walked-team`, #171). Worktree at `.worktrees/pr5-player-timed` (this epic ran in-place before; PR-B uses a worktree because the main dir is busy rebasing the upstream stack). Worktree setup already done: `node_modules` symlinked, `.env` + `docs/*.csv` copied.

**What it does:** the byte-for-byte mirror of PR2 (per-positioned-**enemy** timed burst) onto the **player** side. A positioned player (focus attacker OR walked-team ally) carrying **enemy-seeded** `pendingBombs`/`pendingAccumulators` bursts them at the START of its own turn, against its OWN HP, via `playerSink` — instead of those timed containers never firing.

**Decision (detailing checklist resolved):** **Extract-first**, like PR-A. The timed-burst block exists today at exactly ONE site (PR2 enemy). Extract it into a shared `applyPositionedTimedBurst(actor, sink, opposingRoster)` closure (commit 1, byte-identical — enemy site adopts), then add the two player sites that call it (commit 2). After extraction the burst is shared by 3 sites (enemy + focus + walked-team), parameterized only by `sink` + `opposingRoster`. The accumulator gather input (`allPlayersDirect`) is computed inside the helper — correct for the enemy site, the ratified inert placeholder for the player side (no enemy-direct sum exists; no fixture/ability applies accumulators to players).

**Anchor re-grep (PR-A-shifted, in this PR-B base; all `:NNNN` are grep-anchors — verify before editing):**
- PR2 enemy timed block: grep `PER-POSITIONED-ENEMY TIMED BURST` (~`:4933`); its dead-after-burst guard: grep `burstDestroyedActor` (~`:5040`).
- Shared-closure neighborhood: grep `const applyPerVictimDetonation =` (~`:3575`) — place the new helper immediately after it (same in-round-loop scope; closes over `r`/`roundPerTargetDamage`/`perActorDetonation`/`roundDamage`/`bus`, which rebind per round BEFORE any turn-loop call — same safety PR-A verified).
- Focus attacker site: grep `ATTACKER TURN` (~`:4376`) → `firstActivatorId ??= actor.id;` (~`:4394`); body runs through `processExtraActionGrants(actor, turn.extraActionGrants);` to the stasis `} else {` at ~`:4612`.
- Walked-team site: grep `WALKED TEAM TURN` (~`:4636`) → `firstActivatorId ??= actor.id;` (~`:4650`).
- `pushSynthesizedFocusSkipTurn` helper: grep it (~`:3810`).
- Sinks: `playerSink` (~`:3160`), `enemySink` (~`:3213`); type `DamageAccountingSink` (~`:1141`); `focusActorId = 'attacker'` (~`:1292`).

**Why NO positional-hint-gate change (unlike PR-A):** PR-A widened the `engine.ts:3730` hint because skill detonation rides the `runPlayerTurn` recipe. Timed bursts do NOT — they read `actor.pendingBombs`/`pendingAccumulators` directly in the engine turn body. The only gate is the burst's own `isPositional(actor.position, enemyAttackerActors)` + non-empty-container check. **No `runPlayerTurn`/playerTurn.ts change at all.**

### Task B1: Extract the shared positioned timed-burst closure (byte-identical refactor)

**Files:**
- Modify: `src/utils/combat/engine.ts` (helper decl + PR2 enemy call site)
- Test: the whole existing suite is the guard (provably-inert refactor — no new test)

- [ ] **Step 1: Green baseline.** Run `npm test 2>&1 | tail -20`; record the exact count (e.g. `3483 passed`). B1 must not change it.

- [ ] **Step 2: Define the shared closure.** Add immediately after `applyPerVictimDetonation` (grep `const applyPerVictimDetonation =`). The body is the PR2 enemy burst verbatim, parameterized by `sink` + `opposingRoster`; the gate + the internal `allPlayersDirect` computation move inside:

```typescript
// Shared positioned timed-burst loop. A POSITIONED actor carrying timed
// pendingBombs/pendingAccumulators (seeded by the opposing side's earlier bomb/accumulator
// applications) bursts them at the START of its own turn — against its OWN HP — via
// applyVictimDamage (the per-victim sink). Bombs + accumulators = full shield drain, NO
// penetration (bomb-splash precedent). Credited to the per-round detonation tally keyed by
// the bomb's APPLIER (sourceId, unchanged attribution) + roundPerTargetDamage on the
// bursting actor. NEVER routed through creditDamage(actor.id,'detonation') — that feeds
// cumulativeDamage → the focus-dummy HP overwrite (~:5432) → double-hit (HP already drained
// inside applyVictimDamage). STRICT no-op (byte-identical) when the actor carries no timed
// containers OR is not positioned vs opposingRoster — no fixture seeds actor-side timed
// containers. Used by the enemy site (PR2: sink=enemySink, roster=allPlayerActors) and the
// focus attacker + walked-team sites (PR-B: sink=playerSink, roster=enemyAttackerActors).
const applyPositionedTimedBurst = (
    actor: CombatActor,
    sink: DamageAccountingSink,
    opposingRoster: CombatActor[]
): void => {
    const hasTimedContainers =
        actor.pendingBombs.length > 0 || actor.pendingAccumulators.length > 0;
    if (!hasTimedContainers || !isPositional(actor.position, opposingRoster)) return;

    processBombs({
        pendingBombs: actor.pendingBombs,
        emitBombDetonated: (actorId, stacks, damage) =>
            bus.emit({ type: 'bomb-detonated', actorId, round: r, stacks, damage }),
        creditDetonation: (sourceId, damage) => {
            applyVictimDamage(damage, actor, sink, {
                killerId: sourceId,
                byDirectDamage: true,
                bombPortion: damage, // full shield drain, no pen
                shieldPenetrationPct: 0,
            });
            roundPerTargetDamage.set(
                actor.id,
                (roundPerTargetDamage.get(actor.id) ?? 0) + damage
            );
            perActorDetonation.set(
                sourceId,
                (perActorDetonation.get(sourceId) ?? 0) + damage
            );
        },
    });

    // Accumulator gather input: the round-global player-DIRECT sum (same expression as the
    // focus-dummy path). CORRECT for the enemy site; for the player side it is an INERT
    // placeholder — the symmetric all-enemies-direct sum is not exposed and no fixture/ability
    // applies accumulators to players. // symmetric input TBD — inert, no fixture
    const allPlayersDirect = [...roundDamage.values()].reduce((s, d) => s + d.direct, 0);
    processAccumulators({
        pendingAccumulators: actor.pendingAccumulators,
        allPlayersDirect,
        creditDetonation: (sourceId, damage) => {
            applyVictimDamage(damage, actor, sink, {
                killerId: sourceId,
                byDirectDamage: true,
                bombPortion: damage, // full shield drain, no pen (bomb-style)
                shieldPenetrationPct: 0,
            });
            roundPerTargetDamage.set(
                actor.id,
                (roundPerTargetDamage.get(actor.id) ?? 0) + damage
            );
            perActorDetonation.set(
                sourceId,
                (perActorDetonation.get(sourceId) ?? 0) + damage
            );
        },
    });
};
```

> **Capture guard:** the body must reference ONLY its params (`actor`, `sink`, `opposingRoster`) plus the legitimately-shared closures (`processBombs`, `processAccumulators`, `applyVictimDamage`, `bus`, `r`, `roundPerTargetDamage`, `perActorDetonation`, `roundDamage`, `isPositional`). After extracting, scan the body to confirm no accidental outer capture of the enemy site's `actor`/`enemySink`/`allPlayerActors`. Confirm the shared helpers are in scope: `isPositional` is a module-level import; `processBombs`/`processAccumulators` are module-level function declarations (grep their `function`/`const` decls). All are reachable from the helper.

- [ ] **Step 3: Replace the PR2 enemy block with a call.** Grep `PER-POSITIONED-ENEMY TIMED BURST`. Replace the inline gate + `processBombs` + `allPlayersDirect` + `processAccumulators` block (the `const enemyHasTimedContainers = …` line through the closing `}` of the `if (enemyHasTimedContainers && isPositional(...)) { … }`) with:
```typescript
applyPositionedTimedBurst(actor, enemySink, allPlayerActors);
```
Leave the dead-after-burst guard (`const burstDestroyedActor = …` and its `if (!burstDestroyedActor) { … }` wrap of the enemy action body) exactly as-is — that stays per-site.

- [ ] **Step 4: tsc + lint + full suite — prove inert.** Run `npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -20`. Expected: clean; suite green with the **exact same count** as Step 1; ZERO `.snap` moved.

- [ ] **Step 5: Commit.**
```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): extract shared positioned timed-burst closure

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task B2: Positioned-player timed bursts at the focus + walked-team sites (new behavior)

**Files:**
- Modify: `src/utils/combat/engine.ts` (focus attacker body, walked-team body)
- Test: `src/utils/combat/__tests__/perVictimPlayerTimedDetonation.integration.test.ts` (new)

- [ ] **Step 1: Write the failing integration test.** Model on `perVictimTimedDetonation.integration.test.ts` (its helpers: `timedBomb`, `accumulator`, `enemyAt`, `lineRange1Pattern`, `POSITIONAL_BASE`, and `__testTapActors` to push containers onto an actor by id). Crit 0 → exact integers. The KEY DIFFERENCE from PR2: tap the **player** actor (`'attacker'` for focus, or a walked-team ally id) instead of an enemy, and the positional base must include `enemyAttackers` so `isPositional(playerActor.position, enemyAttackerActors)` is true. Cases:
  1. **Focus attacker timed bomb:** `__testTapActors` pushes a `timedBomb` (countdown reaching 0 within `numRounds`) onto `'attacker'`; focus positioned with `enemyAttackers` present → assert it bursts against the focus attacker's OWN HP via `playerSink` (its `currentHp` drops by the burst; `perActorDetonation[applier]` + `roundPerTargetDamage['attacker']` reflect it); `bomb-detonated` emits with the applier `actorId`.
  2. **Focus attacker accumulator:** push `accumulator(accumulated, pct, roundsRemaining=1)` onto `'attacker'` → bursts for `(accumulated + Σ allPlayersDirect over its active runs) × pct/100`. **CAUTION — unlike the PR2 enemy case, `allPlayersDirect` is NOT 0 on the player side** (the focus's own direct credit may be non-zero unless suppressed). Pick a base where the focus does no creditable direct at the burst turn (e.g. a non-positional-apply firing path / attack 0 for that turn), OR read `roundDamage` at the burst turn position and assert the exact computed value. Document the chosen value's derivation in a comment.
  3. **Walked-team ally timed bomb:** seed a `team`/`teamActors` input with a positioned ally; tap its id with a `timedBomb` → bursts against ITS own HP via `playerSink` on its own turn.
  4. **Lethal self-burst (focus):** seed a bomb whose burst ≥ focus HP → focus dies; assert death event + bomb-splash-on-death chain fires, AND the round still assembles (synthesized focus turn — no throw on the post-round `focusTurns.length` guard).
  5. **Lethal self-burst (walked-team):** ally dies to its burst → death/splash; round assembles (no focus synthesis; its action body is skipped).
  6. **Non-positional regression pin:** tap a player-actor timed container in NON-positional mode → it does NOT burst at the player turn (`isPositional` false) — assert no per-victim burst, and the legacy focus-dummy timed path (grep `:4807`-area `tickDoTs`/`processBombs` on the dummy enemy) is unchanged.
  7. **isPositional-gate negative pin:** positioned player WITH a timed container but `enemyAttackers` empty (or the player not positioned vs them) → no burst. Prove non-vacuous by temporarily flipping the helper's gate to `if (!hasTimedContainers) return;` and confirming this case THEN bursts; document the flip in a comment and revert before commit.

- [ ] **Step 2: Run it — verify it fails.** Run `npx vitest run src/utils/combat/__tests__/perVictimPlayerTimedDetonation.integration.test.ts`. Expected: positional cases (1–5) FAIL (player timed containers never burst today); regression/negative pins (6,7) PASS.

- [ ] **Step 3: Add the burst + dead-after-burst guard at the focus attacker site.** Grep `ATTACKER TURN` → the `if (!isTurnBlocked(actor.id)) {` body. Right after `firstActivatorId ??= actor.id;` insert the burst, then WRAP the existing action body (from `const target = parsedTargetFor(actor);` through `processExtraActionGrants(actor, turn.extraActionGrants);`) in the dead-after-burst guard. Net shape:

```typescript
firstActivatorId ??= actor.id;

// PR-B: PER-POSITIONED-PLAYER TIMED BURST (enemy-seeded bombs/accumulators on the focus
// attacker burst against its OWN HP at its turn-start, via playerSink). Mirror of the PR2
// enemy site; strict no-op for every existing fixture (none seed player-actor timed
// containers). Canonical turn-start order is tickDoTs → processBombs → processAccumulators;
// PR-C will add tickDoTs AHEAD of this burst.
applyPositionedTimedBurst(actor, playerSink, enemyAttackerActors);

// Dead-after-burst guard (PR2 lesson): a lethal self-burst stamped destroyedRound inside
// applyVictimDamage AFTER the top-of-turn dead-skip already ran, so it cannot be caught
// there. Key off destroyedRound (canonical death signal), NOT currentHp > 0 (bare actors
// carry currentHp 0). healTarget carve-out mirrors the top-of-turn guard. A focus actor
// killed by its own burst must still push a synthesized focus turn so the post-round
// focusTurns.length guard does not throw.
const burstDestroyedActor =
    actor.destroyedRound !== undefined &&
    !(healTarget && actor.id === healTarget.id);
if (!burstDestroyedActor) {
    const target = parsedTargetFor(actor);
    /* …existing focus action body, unchanged, re-indented one level… */
    processExtraActionGrants(actor, turn.extraActionGrants);
} else if (actor.id === focusActorId) {
    pushSynthesizedFocusSkipTurn();
}
```
The existing stasis `} else { … }` at the `if (!isTurnBlocked)` level is untouched (it handles `isTurnBlocked` true; the new guard nests inside the `!isTurnBlocked` true branch). The re-indent of the action body must move ZERO goldens — verify in Step 6.

- [ ] **Step 4: Add the burst + guard at the walked-team site.** Grep `WALKED TEAM TURN` → `firstActivatorId ??= actor.id;`. Insert the same burst call, then wrap the walked-team action body. No focus synthesis — a walked-team actor is never the focus:
```typescript
firstActivatorId ??= actor.id;

// PR-B: per-positioned-player timed burst (walked-team ally). Same as the focus site; no
// focusTurns synthesis (a walked-team actor is never the focus). tickDoTs added ahead by PR-C.
applyPositionedTimedBurst(actor, playerSink, enemyAttackerActors);
const burstDestroyedActor =
    actor.destroyedRound !== undefined &&
    !(healTarget && actor.id === healTarget.id);
if (!burstDestroyedActor) {
    const teamTarget = parsedTargetFor(actor);
    /* …existing walked-team action body, unchanged, re-indented one level… */
}
```
> **Shadowing note:** each player site declares a local `burstDestroyedActor`; the enemy site already has one. All three are in separate block scopes (different branches of the turn-kind `if/else if`) — no collision. Confirm with tsc.

- [ ] **Step 5: Run the new test — verify it passes.** Run `npx vitest run src/utils/combat/__tests__/perVictimPlayerTimedDetonation.integration.test.ts`. Expected: PASS (all cases).

- [ ] **Step 6: tsc + lint + full suite audit.** Run `npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -30`. Expected: clean; only the new test added; ZERO existing `.snap` moved (the action-body re-indentation alone must not move any golden).

- [ ] **Step 7: Commit.**
```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/perVictimPlayerTimedDetonation.integration.test.ts
git commit -m "feat(combat): positioned-player timed bomb/accumulator burst

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task B3: Changelog + docs

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx` only if the positional-sim section enumerates timed-burst coverage

- [ ] **Step 1:** Add a plain-English `UNRELEASED_CHANGES` entry: timed bombs/accumulators stored on a positioned player ship now burst against that ship on its own turn (previously only positioned enemies and the focus dummy did).
- [ ] **Step 2:** Commit `docs(combat): changelog for positioned-player timed bursts` (docs-only → `--no-verify`; husky runs the full vitest suite on commit).

### Task B4: Review + PR

- [ ] **Step 1:** Final holistic review (superpowers:requesting-code-review): confirm the three timed-burst sites (enemy/focus/walked-team) are mutually consistent through the shared closure, no `cumulativeDamage` double-count, dead-after-burst guard correct at each site (focus synthesizes, walked-team/enemy don't), E5-symmetry intact (same carrier bursts identical integers as player vs enemy — case 3 vs the PR2 enemy fixture).
- [ ] **Step 2:** `gh auth switch --user TheSusort`; push; open PR-B stacked on PR-A (#171, base `feat/combat-positional-detonation-pr4-walked-team`).

---

## PR-C — Per-victim DoT ticks, both sides (OUTLINE — detail in-place after PR-B lands)

**Branch:** off PR-B. **Highest risk** — Task 0 is a blocking written deliverable before any apply code.

### Task C0 (BLOCKING, written deliverable, reviewed before code)
Produce a channel-map: which `creditDamage` channels (`dot-inferno`, `dot-corrosion`, …) feed `cumulativeDamage` and thus the line-5326/5432 `enemy.currentHp` overwrite. Confirm the per-victim display story — the DPS DoT breakdown (`dot-*` totals) must still reflect per-victim ticks for the focus actor WITHOUT feeding HP twice (the detonation precedent: HP via `applyVictimDamage`, display via `roundPerTargetDamage` + per-victim path, aggregate credit suppressed in positional). Commit as a plan note; review before C.1/C.2.

#### Task C0 — DELIVERABLE (channel-map, verified against the PR-B-base `engine.ts` in this worktree)

> Line numbers are this worktree's (`feat/combat-positional-detonation-pr6-dot-ticks`, off PR-B). Re-grep the symbolic anchors before C.1/C.2 — a later refactor in this PR will shift them.

**Q1 — Which channels feed the `enemy.currentHp` overwrite?**

The overwrite is `engine.ts:5673`:
```
enemy.currentHp = Math.max(0, enemyHp - enemyHpDecline);   // enemyHpDecline = cumulativeDamage + cumulativeTeamDamage  (:5672)
```
Its two inputs accumulate per round from the `roundDamage` map only:
- `cumulativeDamage += totalRoundDamage` (`:5644`), where `totalRoundDamage = focus.direct + focus.corrosion + focus.inferno + focus.detonation` (`:5643`).
- `cumulativeTeamDamage += teamRoundDamage` (`:5666`), where `teamRoundDamage = Σ_{id≠focus} (d.direct + d.corrosion + d.inferno + d.detonation)` (`:5662-5664`).

`roundDamage[id][channel]` is written through **exactly one** seam — `creditDamage(id, channel, amount)` (`:2640-2643` → `dmg(id)[channel] += amount`). So:

> **The four channels that drain the dummy `enemy.currentHp` are `direct`, `corrosion`, `inferno`, `detonation`, summed over focus + team. Any `creditDamage(_, 'corrosion'|'inferno', _)` call feeds the line-5673 overwrite.**

The focus-dummy `tickDoTs` (`:4966-4981`) credits via `credit: (sourceId, dotType, dmg) => creditDamage(sourceId, dotType, dmg)` — i.e. it is precisely the legacy aggregate DoT→HP path.

**Q2 — Does a per-victim DoT tick double-drain if it also credits?** Yes.

C.1 drains the positioned enemy's **own** `currentHp` via `applyVictimDamage(..., enemySink, { byDirectDamage:false })`. If the same tick also called `creditDamage(sourceId, 'corrosion'|'inferno', _)`, that amount re-enters `cumulativeDamage` and drains the dummy `enemy.currentHp` a *second* time at `:5673`.

> **Locked rule (identical to the detonation seam): positioned per-victim DoT ticks MUST NOT call `creditDamage` for the `corrosion`/`inferno` channels.** This is the DoT analog of PR1–PR3 moving `creditDamage(_,'detonation',_)` inside `if(!positional)` / never calling it on the per-victim path.

**Q3 — Display story (keep focus DoT DPS without double-feeding HP).** Mirror detonation exactly.

- The DoT DPS breakdown reads `totalCorrosionRaw`/`totalInfernoRaw` (`:5650-5651`, surfaced `:5888-5889`); the RoundData row reads `corrosionDamage = focus.corrosion` / `infernoDamage = focus.inferno` (`:5627-5628`). All sourced from `focus.{corrosion,inferno}` in the `roundDamage` map.
- **In positional mode this is already 0:** the focus-dummy `tickDoTs` ticks `enemy.corrosionEntries`/`infernoEntries` (bound `:1664-1665` to the dummy/`legacyVictim`), which stay **empty** because positional DoT application lands on `tgt.corrosionEntries` (positioned victims, `:3766`). So positional DoT builds currently under-report focus DoT DPS — the same gap detonation had before PR1.
- **Detonation's split (the template):** HP via `applyVictimDamage`; DISPLAY via the `perActorDetonation` map (init `:1944`, per-round reset `:3832`, keyed by caster/applier), folded into the focus row as `focus.detonation + perActorDetonation[focus]` (`:5629-5630`) and into `totalDetonationRaw` (`:5656`) — while `totalRoundDamage`/`cumulativeDamage` deliberately use `focus.detonation` **only** (`:5643`, guard comment `:5652-5655`).
- **DoT analog — introduce `perActorDot: Map<string, { corrosion: number; inferno: number }>`** (per-round reset alongside `perActorDetonation` at `:3832`; init near `:1944`), keyed by the DoT entry's `sourceId` (matches the focus-dummy `credit(sourceId, …)` attribution). On a positioned per-victim tick, the per-victim `credit` callback:
  1. applies HP: `applyVictimDamage(damage, victim, sink, { byDirectDamage:false })`;
  2. records per-target display: `roundPerTargetDamage[victim.id] += damage`;
  3. records focus-DPS display: `perActorDot[sourceId][channel] += damage`;
  and **never** calls `creditDamage`.
  Then at post-round assembly fold focus's share into the row + raw totals, NOT into the HP-feeding sums:
  - `corrosionDamage = focus.corrosion + (perActorDot.get(focusActorId)?.corrosion ?? 0)`; `infernoDamage` likewise.
  - `totalCorrosionRaw += <that>`; `totalInfernoRaw += <that>`.
  - **`totalRoundDamage`/`cumulativeDamage` stay `focus.{direct,corrosion,inferno,detonation}` ONLY** — `perActorDot` is never added there (the exact `:5652-5655` detonation guard, extended to DoTs).
- Non-positional / DPS-mode: `perActorDot` is empty (no positioned per-victim ticks) → byte-identical, ZERO `.snap` moved. `tickDoTs` already computes final (post-Vortex-Veil) damage and `applyVictimDamage` applies it to HP as-is (the block step is gated on `byDirectDamage`, skipped for DoTs, `:2773`) → no re-scaling.

**Q4 — C.2 (enemy→player) has NO `cumulativeDamage` seam.** DoTs applied *by enemies* are never the focus player's DPS, so they never touch `roundDamage`/`creditDamage`. They route via `playerSink`/`applyIncomingToTarget(..., { byDirectDamage:false })` into the victim's HP + healing-mode intake accounting. The heal-target prologue already does exactly this (`:4400-4438`: `tickDoTs` → sum `tankDotDamage` → `applyIncomingToTarget`, **not** `creditDamage`). The `enemy.currentHp` overwrite is a focus-DUMMY concept irrelevant to player victims. C.2's only display surface is the heal-target healing-accounting branch (`tankDotSnapshot`/`tankDotDamage`→incoming/`handleDeadTargetSkip`), preserved as a branch of the unified path; non-heal-target positioned players just take HP damage.

**Decisions locked for C.1/C.2 code:**
1. HP-feeding channels: `direct`/`corrosion`/`inferno`/`detonation` over focus + team via `roundDamage`.
2. C.1: HP via `applyVictimDamage(enemySink, byDirectDamage:false)`; display via NEW `perActorDot` (sourceId-keyed, per channel) + `roundPerTargetDamage[victim]`; NEVER `creditDamage(corrosion/inferno)`. Fold `perActorDot[focus]` into the focus corrosion/inferno row + raw totals at post-round assembly, NOT into `totalRoundDamage`/`cumulativeDamage`.
3. C.2: HP via `playerSink`/`applyIncomingToTarget(byDirectDamage:false)`; no `creditDamage`, no `cumulativeDamage` interaction; heal-target keeps `tankDotSnapshot`/`tankDotDamage`→incoming-accounting/`handleDeadTargetSkip`.
4. The per-victim `tickDoTs` invocation passes `enemyHp: recipientMaxHp(victim.id)` (corrosion scales with the victim's own max HP), `ctxFor: lastTurnCtxByActor`, per-victim `emitTicked` (`targetId = victim.id`), and `incomingDotReductionPct` for the victim's Vortex Veil. `tickDoTs` mutates + `expireStacks`-ages that victim's own entries on its own turn.

### C.1 — player→enemy (positioned enemies)
Add `tickDoTs` at the enemy-attacker turn-start, ahead of PR2's timed block (canonical order `tickDoTs → processBombs → processAccumulators`). HP via `applyVictimDamage(dmg, actor, enemySink, { byDirectDamage:false })`; per-applier ctx via `lastTurnCtxByActor`; corrosion `baseHp = recipientMaxHp(actor.id)`; per-victim `dot-ticked`; suppress the cumulativeDamage feed for positioned enemies (per C0). Gate: positioned enemy with non-empty DoT containers.

### C.2 — enemy→player (unify the heal-target path)
Replace the heal-target prologue (grep `Task 11b: tick the HEAL TARGET's own enemy-applied DoTs`, ~`:4373`) with ONE per-victim DoT-tick path at every positioned player's turn-start (attacker + walked-team). Routes via `playerSink`/`applyIncomingToTarget` (`byDirectDamage:false`); per-applier ctx; corrosion `baseHp = recipientMaxHp(victim.id)`; per-victim Vortex Veil `incomingDotReductionPct`. Heal-target stays a branch: `tankDotSnapshot`, `tankDotDamage`→incoming healing accounting, `handleDeadTargetSkip` all fire when victim IS the heal target. Single path keyed per turning actor → structural double-tick guard.

**Tests:** `perVictimDotTick.integration.test.ts` — C.1 enemy own-HP tick (corrosion uses own HP) + lethal tick→death; C.2 non-heal-target player tick + heal-target still ticks once with accounting/snapshot/dead-skip intact (unification regression); E5-symmetry pin (same carrier ticks identical integers/events both sides); non-positional + DPS-mode regression pins.

**Detailing checklist when PR-C starts:** complete C0 first and get it reviewed; re-grep all anchors; design the per-victim DoT-tick closure (it will be called at 3+ sites — enemy, attacker, walked-team — so extract like A1/B); carefully preserve every heal-target side-effect during unification (the highest golden-move risk in the epic).

---

## Done criteria (whole epic)
- Skill detonation, timed bursts, and DoT ticks all resolve per-victim at every applicable turn-branch site, both directions.
- Every PR byte-identical for non-positional/DPS goldens (ZERO `.snap` moved per PR).
- E5-symmetry pins green (same ship behaves identically on either side) for detonation (existing), timed bursts (PR-B), and DoT ticks (PR-C).
- tsc + lint (max-warnings 0) clean; full `npm test` green.
