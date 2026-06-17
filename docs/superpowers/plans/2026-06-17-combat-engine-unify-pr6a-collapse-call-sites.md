# Combat Engine bySide Unification — PR6a: Collapse the 3 `runPlayerTurn` Call Sites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the three near-duplicate `runPlayerTurn` call sites (focus / walked-team / enemy) in `src/utils/combat/engine.ts` into ONE call parameterized by `bySide(actor.side)`, byte-identical.

**Architecture:** Approach 1 from the spec (§4.1) — fold each per-site divergence into a per-side binding consumed by a single arg-builder, plus three tiny per-actor resolvers. The arg-builder and per-side turn bindings live as **closures at round-loop scope** (after `drivePositionalApply`, before the `while (queue.length > 0)` turn loop) because they must close over round-loop-local symbols (`applyIncomingToTarget`/`applyOutgoingToEnemy`/`drivePositionalApply`/`statusLookupFor`) that do not exist when the cached `SideContext` is built. The genuinely kind-specific bookkeeping tails (player credit-row vs enemy `applyIncomingToTarget` intake + `roundEnemyEffects` + `attacked` emit, resisted staging, extra-action grants) stay explicit. `enemyHpDecline` is **preserved exactly** behind a per-side `declineFor` closure — PR6b kills the scalar.

**Tech Stack:** TypeScript, Vitest (goldens), ESLint (`--max-warnings 0`), `audit:skills`.

**Golden expectation (re-derived from parent spec row 6):** **BYTE-IDENTICAL.** Zero `.snap` movement. A golden diff = a refactor leak → fix the seam, NEVER `vitest -u`.

**Baseline (PR5d tip `9c8360b7`):** 2430 tests green, dps/healing goldens byte-identical, `tsc`/`lint`/`audit:skills` 0/141 clean.

---

## Context the implementer needs

**Why a refactor plan has no RED tests.** This is a pure byte-identical refactor. The characterization net already exists: the full Vitest suite + the DPS/healing golden snapshots + the dedicated routing tests (`enemyTeamRouting.test.ts`, `enemyReactiveRouting.test.ts`, `reactiveExtraAction.test.ts`, `positionalSelection*`). The TDD discipline here is: after every step, run the full suite (stays green) AND assert **zero** `.snap` file movement (`git diff --stat -- '*.snap'` is empty). There is no new behavior to test-drive.

**The three sites being collapsed** (all inside the `while (queue.length > 0)` turn loop, engine.ts):
- **focus** — `if (actor.kind === 'attacker')` ~2862; `runPlayerTurn` call ~2903.
- **walked-team** — `else if (actor.kind === 'team' && teamRuntimeById.has(actor.id))` ~3035; `runPlayerTurn` call ~3071.
- **enemy** — `else if (actor.kind === 'enemy')` ~3304; `runPlayerTurn` call ~3402 (inside the `else` of the `targetDead` guard).

> **Line numbers are a 2026-06-17 snapshot.** Re-locate by symbol name; each step shifts offsets.

**NOT touched:** the legacy non-walked team branch `else if (actor.kind === 'team')` ~3177 (deals no damage, no `runPlayerTurn`) and the dummy-enemy-self branch `else if (actor.kind === 'enemy' && actor.id === enemy.id)` ~3247.

**Per-side binding table (the byte-identity contract — each binding MUST reproduce the exact current per-site value):**

| Binding | Player (focus + team) | Enemy |
|---|---|---|
| `runtime` | `attackerRuntime` (focus) / `teamRuntimeById.get(id)!` (team) | `enemyPlayerRuntimeByActorId.get(id)!` |
| opposing roster | `enemyAttackerActors` | `allPlayerActors` |
| legacy fallback victim | `enemy` (dummy sink) | `healTarget!` |
| `enemyDefense` | `tgt.stats.defence` | `lastTurnCtxByActor.get(tgt.id)?.effectiveDefence ?? baseDefenceFor(tgt.id)` |
| `enemyHp` | `tgt.stats.hp` | `recipientMaxHp(tgt.id)` |
| `enemyHpDecline` | `selectedReal ? 0 : cumulativeDamage + cumulativeTeamDamage` | `max(0, recipientMaxHp(tgt.id) − tgt.currentHp)` |
| `enemyType` | `enemyType` | `undefined` |
| `enemyBuffNames` | `playerEnemyBuffNames()` | `enemyEnemyBuffNames()` |
| `healEventOnly` | absent (falsy) | `true` |
| `targetId` | omitted | `tgt.id` |
| `grantAllyCharges` | `bySide('player').grantAllyCharges` | `bySide('enemy').grantAllyCharges` |
| positional apply direction | `(victim, dmg) => applyOutgoingToEnemy(dmg, victim)` | enemy→player per-victim wrapper (read from the enemy site, ~after 3543) |
| `selfHpPct` maxHp denom | `baseHpFor(actor.id)` | `enemyRuntime.hp` |
| `selfDebuffNames`, `targetHpPct` (`healTargetHpPctNow()`), `healing` (`healingCtx`), DoT/bomb/accumulator containers (from `tgt`) | identical | identical |
| parsed target / pattern | `input.target` / `input.pattern` (focus); `teamTargetById.get(id)` / `teamPatternById.get(id)` (team) | `enemyTargetById.get(id)` / `enemyPatternById.get(id)` |

**Symbol scope (verified 2026-06-17):** `buildSideContext`/`playerSide`/`enemySide` built ~1657–1693. `baseDefenceFor` ~1702, `recipientMaxHp` ~1718 (AFTER buildSideContext). Round loop `for (let r…)` ~2047. `statusLookupFor` ~2055, `applyIncomingToTarget` ~2329, `applyOutgoingToEnemy` ~2348, `drivePositionalApply` ~2380 (all inside the round loop, before the `while` at ~2577). `cumulativeDamage`/`cumulativeTeamDamage` ~1489/1492 (`let`, round-volatile — read live). `lastTurnCtxByActor` ~1516 (mutated live). `playerEnemyBuffNames`/`enemyEnemyBuffNames` ~1609/1611. `enemy` ~1136, `allPlayerActors` ~1467, `healTarget` ~1529, `enemyAttackerActors` ~1576, the four `*ById` target/pattern maps ~1214/1224/1237/1247, `teamRuntimeById` ~1376, `enemyPlayerRuntimeByActorId` ~1578.

**Decisive consequence:** the per-side turn bindings + arg-builder CANNOT be fields on the cached `SideContext` (it is built before `baseDefenceFor`/`recipientMaxHp`/the apply wrappers exist → TDZ / staleness). Define them as closures at round-loop scope, after `drivePositionalApply` (~2410) and before the `while` (~2577). They reuse the cached `bySide(side)` for the round-invariant `grantAllyCharges` only.

**Commands:**
- Full suite: `npm test`
- Snapshot-movement check: `git diff --stat -- '*.snap'` (MUST be empty after every step)
- Targeted: `npx vitest run src/utils/combat/__tests__/<file>` (faster inner-loop)
- Gates: `npm run lint` · `npx tsc --noEmit` · `npm run audit:skills` (expect 0/141)

**Workflow:** Work on the main checkout, branch `feat/combat-sim-phase5-pr2`. `gh auth switch --hostname github.com --user TheSusort` before any PR/merge op. docs gitignored → `git add -f`, `--no-verify` for docs-only commits. Pipe `git push … | cat`. Merge decision (local squash vs GitHub PR) is the USER's — this plan stops at ready-for-review.

---

## Task 1: Verify baseline + lock the byte-identity reference

**Files:** none (verification only).

- [ ] **Step 1: Confirm clean baseline**

Run: `git status` (clean), `git log --oneline -1` (expect `9c8360b7` or current tip).

- [ ] **Step 2: Run the full suite + gates to record the green baseline**

Run: `npm test` → expect 2430 passing (record the exact number).
Run: `npm run lint` → 0 warnings. `npx tsc --noEmit` → clean. `npm run audit:skills` → 0 findings / 141 ships.

- [ ] **Step 3: Capture the three current arg objects verbatim**

Read engine.ts and copy the three `runPlayerTurn({ … })` argument objects (focus ~2903, team ~3071, enemy ~3402) into a scratch note. This is the byte-identity reference every later step is checked against — each binding's resolved value must equal the value here for the matching side.

No commit (verification task).

---

## Task 2: Add the three per-actor resolvers and wire them in (byte-identical)

**Files:** Modify `src/utils/combat/engine.ts` (round-loop scope, after `drivePositionalApply` ~2410, before `while` ~2577).

**What:** Introduce `runtimeFor(actor)`, `parsedTargetFor(actor)`, `parsedPatternFor(actor)`. Wire them into all three sites WITHOUT collapsing the calls — replace the inline runtime/target/pattern lookups only. Each returns exactly today's per-site value.

- [ ] **Step 1: Add the resolvers**

After `drivePositionalApply` is declared (~2410), add:

```ts
// ── Unified per-actor turn resolvers (bySide unification PR6a) ──────────────
// Resolve the per-actor runtime / parsed target / parsed pattern uniformly so the
// three runPlayerTurn sites stop hard-coding their own lookups. Each reproduces the
// exact value its site used before — byte-identical.
const runtimeFor = (a: CombatActor): PlayerActorRuntime => {
    if (a.side === 'enemy') return enemyPlayerRuntimeByActorId.get(a.id)!;
    if (a.kind === 'attacker') return attackerRuntime;
    return teamRuntimeById.get(a.id)!;
};
const parsedTargetFor = (a: CombatActor): ParsedTarget | undefined => {
    if (a.side === 'enemy') return enemyTargetById.get(a.id);
    if (a.kind === 'attacker') return input.target;
    return teamTargetById.get(a.id);
};
const parsedPatternFor = (a: CombatActor): ParsedPattern | undefined => {
    if (a.side === 'enemy') return enemyPatternById.get(a.id);
    if (a.kind === 'attacker') return input.pattern;
    return teamPatternById.get(a.id);
};
```

> Verify `ParsedTarget`/`ParsedPattern`/`PlayerActorRuntime` are already imported (they are — used by the existing sites). Verify `CombatActor.side` exists (PR1) and `attacker.kind === 'attacker'`, walked-team actors `.kind === 'team'`, enemy actors `.kind === 'enemy'` AND `.side === 'enemy'`. The dummy `enemy` actor also has `.side === 'enemy'` but is never an acting focus/team actor, so `runtimeFor` is never called for it on a player branch.

- [ ] **Step 2: Wire `runtimeFor` into all three sites**

- focus ~2904: `runtime: attackerRuntime,` → `runtime: runtimeFor(actor),`
- team ~3072: `runtime: teamRuntimeById.get(actor.id)!,` → `runtime: runtimeFor(actor),`
- enemy ~3323: `const enemyRuntime = enemyPlayerRuntimeByActorId.get(actor.id)!;` → `const enemyRuntime = runtimeFor(actor);` (keep the local name `enemyRuntime` — it is read elsewhere in the branch, e.g. `enemyRuntime.hp`, `enemyRuntime.hasChargedSkill`).

- [ ] **Step 3: Wire `parsedTargetFor` / `parsedPatternFor` into all three sites**

- focus selection ~2883 uses `input.target`; positional gate ~2975 uses `input.target`/`input.pattern`; apply ~2985 uses `input.target!`/`input.pattern!`. Replace with `parsedTargetFor(actor)` / `parsedPatternFor(actor)` (capture once into locals `const target = parsedTargetFor(actor); const pattern = parsedPatternFor(actor);` at the top of the branch to avoid repeat calls and keep the `!` assertions valid).
- team ~3052 `const teamTarget = teamTargetById.get(actor.id);` → `const teamTarget = parsedTargetFor(actor);`; ~3113 `const teamPattern = teamPatternById.get(actor.id);` → `parsedPatternFor(actor)`.
- enemy ~3335 `const enemyTarget = enemyTargetById.get(actor.id);` → `parsedTargetFor(actor)`; ~3359 `const enemyPattern = enemyPatternById.get(actor.id);` → `parsedPatternFor(actor)`.

> Keep the existing local names (`teamTarget`, `enemyTarget`, etc.) so downstream references in each branch are untouched.

- [ ] **Step 4: Run the suite + snapshot check**

Run: `npm test` → green (same count as baseline). `git diff --stat -- '*.snap'` → EMPTY.
Run: `npx tsc --noEmit` → clean. `npm run lint` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): PR6a Task 2 — per-actor runtime/target/pattern resolvers"
```

---

## Task 3: Add the per-side turn-binding resolver (byte-identical)

**Files:** Modify `src/utils/combat/engine.ts` (round-loop scope, beside the Task 2 resolvers).

**What:** Introduce `turnBindings(side)` returning the per-side fields from the binding table. Wire each field into the three arg objects so they read from `turnBindings(actor.side)` instead of inline values. Still THREE `runPlayerTurn` calls — only the argument *sources* change. Each field reproduces the exact current per-site value.

- [ ] **Step 1: Define the interface + resolver**

```ts
// ── Unified per-side turn bindings (bySide unification PR6a) ────────────────
// Per-side values the three runPlayerTurn sites diverge on. Each reproduces the
// exact value its site used before → byte-identical. PR6b folds declineFor into a
// uniform currentHp read; the credit/intake & emit TAILS stay per-kind (→ PR7).
interface TurnBindings {
    opposingRoster: CombatActor[];
    legacyVictim: CombatActor;
    victimDefenceFor: (tgt: CombatActor) => number;
    victimMaxHpFor: (tgt: CombatActor) => number;
    declineFor: (tgt: CombatActor, selectedReal: boolean) => number;
    enemyTypeArg: EnemyBaseClass | undefined;
    enemyBuffNamesUnion: () => string[];
    healEventOnly: boolean;
    applyToVictim: (victim: CombatActor, damage: number) => ReturnType<typeof applyVictimDamage>;
}
const playerTurnBindings: TurnBindings = {
    opposingRoster: enemyAttackerActors,
    legacyVictim: enemy,
    victimDefenceFor: (tgt) => tgt.stats.defence,
    victimMaxHpFor: (tgt) => tgt.stats.hp,
    declineFor: (_tgt, selectedReal) =>
        selectedReal ? 0 : cumulativeDamage + cumulativeTeamDamage,
    enemyTypeArg: enemyType,
    enemyBuffNamesUnion: playerEnemyBuffNames,
    healEventOnly: false,
    applyToVictim: (victim, damage) => applyOutgoingToEnemy(damage, victim),
};
const enemyTurnBindings: TurnBindings = {
    opposingRoster: allPlayerActors,
    legacyVictim: healTarget!,
    victimDefenceFor: (tgt) =>
        lastTurnCtxByActor.get(tgt.id)?.effectiveDefence ?? baseDefenceFor(tgt.id),
    victimMaxHpFor: (tgt) => recipientMaxHp(tgt.id),
    declineFor: (tgt) => Math.max(0, recipientMaxHp(tgt.id) - tgt.currentHp),
    enemyTypeArg: undefined,
    enemyBuffNamesUnion: enemyEnemyBuffNames,
    healEventOnly: true,
    applyToVictim: (victim, damage) => applyIncomingToTarget(damage, victim),
};
const turnBindings = (side: Side): TurnBindings =>
    side === 'player' ? playerTurnBindings : enemyTurnBindings;
```

> **Byte-identity proof obligations (state these in the commit body):**
> - `legacyVictim: healTarget!` — enemy branch only runs when `healTargetId` is set (engine throws otherwise ~1535), so the `!` matches the existing enemy-site `healTarget!`.
> - `enemy.declineFor` reproduces the enemy site's `targetHpDecline = max(0, targetMaxHpForEnemy − tgt.currentHp)` where `targetMaxHpForEnemy = recipientMaxHp(tgt.id)`. Identical.
> - `enemy.applyToVictim` must equal the enemy site's positional per-victim wrapper. **Read the enemy `drivePositionalApply` call (~after 3543) and confirm its `applyToVictim` is `(victim, damage) => applyIncomingToTarget(damage, victim)`.** If it differs, copy the exact wrapper used there. (The non-positional enemy damage path also routes through `applyIncomingToTarget(damage)` — same closure, default victim.)
> - `playerTurnBindings.victimDefenceFor`/`victimMaxHpFor` read `tgt.stats.*` — matches focus/team `enemyDefense: tgt.stats.defence`, `enemyHp: tgt.stats.hp`.
> - `applyVictimDamage` and `EnemyBaseClass` are already imported/in scope (used by the existing apply wrappers and `enemyType`). Confirm before use.

- [ ] **Step 2: Wire the player-side arg objects (focus + team) to read from `turnBindings('player')`**

Capture `const tb = turnBindings(actor.side);` at the top of each branch. In the focus + team arg objects:
- `enemy: tgt,` stays (tgt computed from selection — Task 4 unifies the fallback via `tb.legacyVictim`).
- `enemyDefense: tgt.stats.defence,` → `enemyDefense: tb.victimDefenceFor(tgt),`
- `enemyHp: tgt.stats.hp,` → `enemyHp: tb.victimMaxHpFor(tgt),`
- `enemyHpDecline: selectedEnemy ? 0 : cumulativeDamage + cumulativeTeamDamage,` → `enemyHpDecline: tb.declineFor(tgt, selectedEnemy != null),` (team: `selectedTeamEnemy != null`)
- `enemyType,` → `enemyType: tb.enemyTypeArg,`
- `grantAllyCharges: bySide('player').grantAllyCharges,` → `grantAllyCharges: bySide(actor.side).grantAllyCharges,`
- `enemyBuffNames: playerEnemyBuffNames(),` → `enemyBuffNames: tb.enemyBuffNamesUnion(),`
- leave `selfDebuffNames`, `targetHpPct`, `healing`, `selfHpPct`, `corrosionEntries`/etc. untouched (uniform / per-actor — handled in Task 5).

- [ ] **Step 3: Wire the enemy-side arg object to read from `turnBindings('enemy')`**

In the enemy arg object (~3402):
- `enemyDefense: targetDefence,` → `enemyDefense: tb.victimDefenceFor(tgt),` (then DELETE the now-unused `const targetDefence = …` ~3387 — lint will flag it).
- `enemyHp: targetMaxHpForEnemy,` → `enemyHp: tb.victimMaxHpFor(tgt),` (keep `targetMaxHpForEnemy`/`targetHpDecline` for now if still read by `declineFor` wiring; remove whatever becomes unused — see next bullet).
- `enemyHpDecline: targetHpDecline,` → `enemyHpDecline: tb.declineFor(tgt, false),` then DELETE the now-unused `const targetMaxHpForEnemy`/`const targetHpDecline` locals (~3393/3394) if nothing else reads them. (Check: `targetMaxHpForEnemy` may also feed `recipientMaxHp`-derived reads — grep before deleting.)
- `enemyType: undefined,` → `enemyType: tb.enemyTypeArg,`
- `grantAllyCharges: bySide('enemy').grantAllyCharges,` → `grantAllyCharges: bySide(actor.side).grantAllyCharges,`
- `enemyBuffNames: enemyEnemyBuffNames(),` → `enemyBuffNames: tb.enemyBuffNamesUnion(),`
- `healEventOnly: true,` → `healEventOnly: tb.healEventOnly,`
- leave `targetId`, `selfHpPct`, `targetHpPct`, `healing`, containers untouched (Task 5 / kept).

- [ ] **Step 4: Suite + snapshot + gates**

`npm test` → green, count unchanged. `git diff --stat -- '*.snap'` → EMPTY. `npx tsc --noEmit` → clean. `npm run lint` → 0 (fix any unused-var from deleted locals).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): PR6a Task 3 — per-side TurnBindings, sites read from turnBindings(side)"
```

---

## Task 4: Unify positional target selection + the legacy victim fallback

**Files:** Modify `src/utils/combat/engine.ts`.

**What:** The three sites each compute `selectedX` then `const tgt = selectedX ?? <legacyVictim>`. They differ ONLY by opposing roster + legacy victim — both now in `TurnBindings`. Extract one `selectTurnTarget(actor)` returning `{ tgt, selectedReal }`.

- [ ] **Step 1: Add the helper (beside the Task 2/3 resolvers)**

```ts
// Unified positional target selection (bySide unification PR6a). Reproduces the
// focus(C1)/team(C2)/enemy(C3) selection: resolve the actor's parsed target against
// its opposing roster, else fall back to the side's legacy victim (dummy / heal target).
const selectTurnTarget = (a: CombatActor): { tgt: CombatActor; selectedReal: boolean } => {
    const tb = turnBindings(a.side);
    const target = parsedTargetFor(a);
    const selected =
        isPositional(a.position, tb.opposingRoster) && target
            ? resolvePositionalTarget(
                  a.position!,
                  target,
                  tb.opposingRoster,
                  statusLookupFor(tb.opposingRoster),
                  {
                      ignoresForcedTargeting: a.ignoresForcedTargeting,
                      provokedBy: provokerOf(statusEngine, a.id),
                  }
              )
            : null;
    return { tgt: selected ?? tb.legacyVictim, selectedReal: selected != null };
};
```

> Confirm this is character-identical to all three existing selection blocks (focus ~2882, team ~3053, enemy ~3336) — same `resolvePositionalTarget` signature, same options. The ONLY per-site differences were the roster (`tb.opposingRoster`) and the fallback (`tb.legacyVictim`).

- [ ] **Step 2: Replace the three selection blocks**

- focus: replace the `selectedEnemy`/`tgt` computation with `const { tgt, selectedReal } = selectTurnTarget(actor);` and update `declineFor(tgt, selectedReal)`. Delete the old `selectedEnemy` local; the positional gate ~2973 uses `selectedEnemy` only via the `tgt`/scalars path — re-derive from `selectedReal`/`tgt` (the gate keys off `isPositional + pattern + positionalScalars`, not `selectedEnemy`).
- team: same with `selectedTeamEnemy` → `selectedReal`.
- enemy: replace `selectedPlayer`/`tgt`; `targetDead = tgt.currentHp <= 0` stays.

> **Watch:** each branch still needs `target`/`pattern` locals for its positional-apply gate/call. Keep `const target = parsedTargetFor(actor); const pattern = parsedPatternFor(actor);` at branch top (Task 2 added these for focus; ensure team/enemy have them too). `selectTurnTarget` re-derives `target` internally — that double call is cheap and pure; acceptable, or thread it out if preferred.

- [ ] **Step 3: Suite + snapshot + gates**

`npm test` → green. `git diff --stat -- '*.snap'` → EMPTY. `tsc`/`lint` clean.

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): PR6a Task 4 — unified selectTurnTarget(actor) across all three sites"
```

---

## Task 5: Unify `selfHpPct` + extract `buildTurnArgs(actor, tgt, selectedReal)` and collapse to ONE call

**Files:** Modify `src/utils/combat/engine.ts`.

**What:** The capstone step. Unify `selfHpPct` (verify the maxHp denom), then extract a single `buildTurnArgs` producing the full `runPlayerTurn` argument object for any side, and replace all three call expressions with `runPlayerTurn(buildTurnArgs(...))`. Tails stay per-kind.

- [ ] **Step 1: Verify the `selfHpPct` maxHp denominator**

Player sites use `baseHpFor(actor.id)`; enemy uses `enemyRuntime.hp` (= `runtimeFor(actor).hp`). Confirm whether `baseHpFor(id) === runtimeFor(id).hp` for player actors:
Run: add a temporary `console.assert(baseHpFor(actor.id) === runtimeFor(actor).hp)` in each player branch, run a healing test that exercises focus+team, observe no assert fire; then remove. (Or reason from construction: `baseHpById` vs `runtime.hp` source.)
- If EQUAL: unify the denom to `runtimeFor(actor).hp` for all sides.
- If NOT EQUAL: keep the denom per-side — add `selfHpMaxHpFor: (a) => number` to `TurnBindings` (player → `baseHpFor(a.id)`, enemy → `runtimeFor(a).hp`). Either way the resolved value is byte-identical.

- [ ] **Step 2: Add `buildTurnArgs`**

Beside the other resolvers, add a builder that returns the full arg object. It takes the acting actor, the resolved `tgt`, and `selectedReal`; reads `turnBindings(actor.side)`, `runtimeFor`, the uniform fields, and conditionally includes `targetId`/`healEventOnly` for the enemy side:

```ts
const buildTurnArgs = (a: CombatActor, tgt: CombatActor, selectedReal: boolean) => {
    const tb = turnBindings(a.side);
    const rt = runtimeFor(a);
    const maxHp = /* Step 1 result */;
    return {
        runtime: rt,
        enemy: tgt,
        ...(a.side === 'enemy' ? { targetId: tgt.id } : {}),
        statusEngine,
        corrosionEntries: tgt.corrosionEntries,
        infernoEntries: tgt.infernoEntries,
        pendingBombs: tgt.pendingBombs,
        pendingAccumulators: tgt.pendingAccumulators,
        enemyDefense: tb.victimDefenceFor(tgt),
        enemyHp: tb.victimMaxHpFor(tgt),
        enemyType: tb.enemyTypeArg,
        bus,
        round: r,
        enemyHpDecline: tb.declineFor(tgt, selectedReal),
        grantAllyCharges: bySide(a.side).grantAllyCharges,
        healing: healingCtx,
        ...(tb.healEventOnly ? { healEventOnly: true } : {}),
        selfHpPct: maxHp > 0 ? (100 * Math.max(0, a.currentHp)) / maxHp : 100,
        targetHpPct: healTargetHpPctNow(),
        enemyBuffNames: tb.enemyBuffNamesUnion(),
        selfDebuffNames: ownerDebuffNames(a.id),
    };
};
```

> **CRITICAL byte-identity checks before replacing:**
> - **Key order / presence.** `runPlayerTurn`'s arg is an object — key order does not affect behavior, but `targetId` and `healEventOnly` PRESENCE does. Player calls today OMIT both; the spreads above keep them absent for players. Confirm `runPlayerTurn` treats absent `targetId` exactly as the player sites rely on (it does — player sites never passed it).
> - The enemy site reads `a.currentHp` via `enemyRuntime.actor.currentHp` today, not `actor.currentHp`. **Confirm `enemyRuntime.actor === actor` for the acting enemy** (it should — the runtime wraps the same actor). If not, source `currentHp` per-side. Verify with a temp assert.
> - Every other field (`statusEngine`, `bus`, `round: r`, `healingCtx`, `ownerDebuffNames`, `healTargetHpPctNow`) is already identical across the three sites (verified) — confirm against the Task 1 scratch note.

- [ ] **Step 3: Replace the three call expressions**

- focus ~2903: `const turn = runPlayerTurn({ … });` → `const turn = runPlayerTurn(buildTurnArgs(actor, tgt, selectedReal));`
- team ~3071: `const teamTurn = runPlayerTurn({ … });` → `const teamTurn = runPlayerTurn(buildTurnArgs(actor, tgt, selectedReal));`
- enemy ~3402: `const enemyTurn = runPlayerTurn({ … });` → `const enemyTurn = runPlayerTurn(buildTurnArgs(actor, tgt, selectedReal));` (still inside the `else` of the `targetDead` guard — the guard stays).

Do these ONE site at a time, running `npm test` + the snapshot check after EACH replacement, so a leak is localized to one site.

- [ ] **Step 4: Full suite + snapshot + gates**

`npm test` → green, count unchanged. `git diff --stat -- '*.snap'` → EMPTY. `npx tsc --noEmit` clean. `npm run lint` → 0. `npm run audit:skills` → 0/141.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): PR6a Task 5 — collapse 3 runPlayerTurn calls into one buildTurnArgs(actor)"
```

---

## Task 6: Unify the positional-apply direction via `applyToVictim` (byte-identical)

**Files:** Modify `src/utils/combat/engine.ts`.

**What:** The three `drivePositionalApply({ … applyToVictim … })` calls differ only by `opposingLiving` (roster) and `applyToVictim` (direction) — both in `TurnBindings`. Route them through `tb`. This finishes folding the per-side apply direction.

- [ ] **Step 1: Rewire the three `drivePositionalApply` calls**

For each site's positional-apply block (focus ~2981, team ~3122, enemy ~after 3543):
- `opposingLiving: enemyAttackerActors,` (player) / `allPlayerActors` (enemy) → `opposingLiving: turnBindings(actor.side).opposingRoster,`
- `applyToVictim: (victim, damage) => applyOutgoingToEnemy(damage, victim),` (player) / the enemy wrapper → `applyToVictim: turnBindings(actor.side).applyToVictim,`

> Confirm the `applyToVictim` signature in `drivePositionalApply` is `(victim, damage) => …` matching `TurnBindings.applyToVictim`. If `drivePositionalApply` calls it as `(victim, damage)`, the binding matches; if `(damage, victim)`, adjust the `TurnBindings` closure arg order to match the DRIVER, and keep the non-positional `tb.applyToVictim` call sites consistent. **Pin the arg order from the actual `drivePositionalApply` definition (~2380).**

- [ ] **Step 2: Suite + snapshot + gates**

`npm test` → green. `git diff --stat -- '*.snap'` → EMPTY. `tsc`/`lint`/`audit` clean.

- [ ] **Step 3: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): PR6a Task 6 — route positional apply through TurnBindings (roster + direction)"
```

---

## Task 7: Add a characterization test for the collapsed path + final sweep

**Files:** Create `src/utils/combat/__tests__/turnArgsUnification.test.ts` (or co-located per the combat test convention — match where `enemyTeamRouting.test.ts` lives).

**What:** The goldens are the primary lock, but add a focused engine-level test that exercises all three collapsed paths in ONE `runCombat` and asserts the observables that prove each side's bindings resolved correctly (non-vacuous — assert non-zero baselines per the project's vacuous-isolation-test lesson).

- [ ] **Step 1: Write the test**

Build a healing-mode `runCombat` input with: a damaging focus attacker, a walked team actor that deals damage, and an enemy attacker that hits the heal target. Assert:
- focus + team damage rows are non-zero (player credit path intact),
- the heal target takes non-zero incoming from the enemy (enemy intake path intact),
- the enemy's `enemyType` matchup is absent while the player's `enemyType` is applied (pick a fixture where it is observable, or assert via an enemy-buff/hp-gate that only fires on the correct side),
- no cross-side leak (enemy self-buffs don't appear in player rows — with a non-zero player baseline so the assertion can actually fail).

> Reuse fixtures/builders from `enemyTeamRouting.test.ts`. If a clean observable for `enemyType`-absence isn't cheap, drop that sub-assertion — the goldens already lock it; do NOT contrive a vacuous check.

- [ ] **Step 2: Run the new test**

Run: `npx vitest run src/utils/combat/__tests__/turnArgsUnification.test.ts` → PASS.

- [ ] **Step 3: Full suite + all gates + snapshot**

`npm test` → green (baseline + new tests). `git diff --stat -- '*.snap'` → EMPTY. `npx tsc --noEmit` clean. `npm run lint` → 0. `npm run audit:skills` → 0/141.

- [ ] **Step 4: Update the changelog (skip if not user-facing)**

This is an internal refactor with no user-visible change → **no** `UNRELEASED_CHANGES` entry (per CLAUDE.md: skip refactors). Confirm and move on.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/__tests__/turnArgsUnification.test.ts
git commit -m "test(combat): PR6a — characterization test for the collapsed runPlayerTurn path"
```

---

## Done criteria

- One `runPlayerTurn(buildTurnArgs(actor, …))` call replaces the three former sites; selection via `selectTurnTarget`, apply via `TurnBindings.applyToVictim`, all per-side divergence in `TurnBindings` + the three resolvers.
- Per-kind bookkeeping tails (player credit-row vs enemy intake + `roundEnemyEffects` + `attacked` emit + resisted staging + extra-action grants + enemy dead-target cadence guard) preserved verbatim.
- `enemyHpDecline` preserved exactly via `declineFor` (PR6b kills the scalar).
- Full suite green, **zero `.snap` movement**, `tsc`/`lint`/`audit:skills` 0/141 clean.
- Final holistic review (subagent-driven workflow) before handing to the user for the merge decision.

## Risks & gotchas

- **Closure scope (the big one):** all new closures MUST be defined inside the round loop, after `drivePositionalApply` (~2410) and before the `while` (~2577), so they see `applyIncomingToTarget`/`applyOutgoingToEnemy`/`statusLookupFor`/`drivePositionalApply`/`cumulativeDamage`/`recipientMaxHp`/`baseDefenceFor` and re-bind per round. They reuse the cached `bySide(side)` only for `grantAllyCharges`. Do NOT add them to `SideContext`.
- **`applyToVictim` arg order** — pin from `drivePositionalApply`'s definition; the non-positional enemy path uses `applyIncomingToTarget(damage, victim)` (damage-first). Keep the `TurnBindings.applyToVictim` signature consistent with BOTH call shapes (positional driver + any direct use). If shapes differ, do not unify direct enemy intake into `applyToVictim` — leave the non-positional enemy `applyIncomingToTarget(damage)` tail as-is (it is a tail, not part of the call).
- **`enemyRuntime.actor === actor`** for the acting enemy — verify before sourcing `selfHpPct`'s `currentHp` from `actor`.
- **Unused-local cleanup** after rewiring (`targetDefence`, `targetMaxHpForEnemy`, `targetHpDecline`) — `--max-warnings 0` will reject leftovers; grep each before deleting.
- **Never `vitest -u`.** Any `.snap` movement is a leak — bisect to the offending binding and fix it to reproduce the old value.
- **Spec cross-ref:** parent row 6 / §4.1 = byte-identical. Tails → PR7. `enemyHpDecline` scalar → PR6b.
