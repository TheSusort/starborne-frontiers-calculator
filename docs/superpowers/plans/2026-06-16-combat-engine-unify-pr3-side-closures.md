# Combat Engine bySide Unification — PR3: Unify Side-Closures into `bySide()` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the four hand-paired side closures — `grantAllyCharges`/`grantEnemyAllyCharges`, `lowestSpeedAllyIds`/`lowestSpeedEnemyIds`, and the drain-time `selfHpPctFor` self-HP% lookup — into ONE side-parameterized `bySide(side) → SideContext` seam (built on a new `actorsBySide(side)` primitive), deleting the mirror pair. Pure structural refactor, BYTE-IDENTICAL.

**Architecture:** Today the engine carries a player closure + a near-duplicate enemy mirror for each of three behaviors (ally-charge grant, lowest-speed-ally set, self-HP% gate). PR3 introduces `actorsBySide(side: 'player' | 'enemy') → CombatActor[]` (returns `allPlayerActors` or `enemyAttackerActors`) and a cached `bySide(side) → SideContext` that bundles `grantAllyCharges` / `lowestSpeedIds` / `selfHpPctFor`, each derived from `actorsBySide(side)`. Every consumer (the two drain bindings, the three `runPlayerTurn` call sites) switches from the standalone player/enemy closure to `bySide('player' | 'enemy').<field>`. `selfHpPctFor` additionally moves out of the inline `drainQueue` ctx spread into a `ReactiveSideCtx` field so it is sourced per-side. The closures' bodies are copied verbatim (only the captured actor list is parameterized + a `length === 0` guard unified), so the behavior is unchanged on every exercised path.

**Tech Stack:** TypeScript, Vitest. All work is in `src/utils/combat/engine.ts` (closures + wiring) + a JSDoc-only sweep in `src/utils/combat/triggers.ts`.

**Spec:** `docs/superpowers/specs/2026-06-16-combat-engine-bySide-unification-design.md` (§3 the unifying seam, §4 PR3 row). Campaign status: `project-combat-engine-bySide-unification` memory (PR1 #118, PR2 #119 merged into `feat/combat-sim-phase5-pr2`).

**Safety gate (re-derived from the spec's PR3 row):** **BYTE-IDENTICAL** DPS + healing goldens. PR3 changes no behavior: the player `SideContext` reproduces the old player closures exactly; the enemy `SideContext` reproduces the old enemy closures exactly (the unified `lowestSpeedIds` keeps the enemy `length === 0 → ∅` guard, which is a no-op for the player side since `allPlayerActors` is never empty; the enemy `selfHpPctFor` returns 100 for every enemy owner — exactly what the old shared `healTarget`-based closure returned for any non-`healTarget` id, and an enemy owner id can never equal `healTarget.id` because `reservedActorIds` forbids the collision). Any golden movement here = a refactor LEAK → fix the seam, never `vitest -u`. The genuine per-actor enemy self-HP% realization (reading real enemy `currentHp`) is **deferred to PR5** (per-actor accounting), where enemy HP becomes meaningful and the denominator question is owned — re-deriving the golden expectation from the parent spec row per spec §124.

**Branch:** `feat/combat-engine-unify-pr3-side-closures` off the current `feat/combat-sim-phase5-pr2` tip (PR1 `f379c7d3` + PR2 `56d5a705` already there). Work in the **main checkout** — do NOT create a fresh worktree (esbuild crash). Stacks on PR2; accept the rebase-`--onto`/retarget friction (CodeRabbit only auto-reviews base=main PRs).

---

## File structure

- **Modify** `src/utils/combat/engine.ts`:
  - Add `selfHpPctFor?: (ownerId: string) => number` to the `ReactiveSideCtx` interface (~972).
  - Delete the four standalone closures: `lowestSpeedAllyIds` (~1476), `grantAllyCharges` (~1488), `grantEnemyAllyCharges` (~1608), `lowestSpeedEnemyIds` (~1618).
  - Introduce `actorsBySide` + `SideContext` + `bySide` (cached `playerSide`/`enemySide`) immediately AFTER `baseHpFor` (~1650), the last dependency.
  - Move the inline `selfHpPctFor` ctx spread inside `drainQueue` (~2602–2617) to read `sideCtx.selfHpPctFor`.
  - Rewire the two drain bindings (`drainIntents` ~2625, `drainEnemyIntents` ~2640) and the three `runPlayerTurn` call sites (focus ~2875, team ~3045, enemy ~3400) to `bySide('player' | 'enemy').<field>`.
  - Sweep the now-stale local comments referencing the deleted closures.
- **Modify** `src/utils/combat/triggers.ts` — JSDoc-only sweep of the stale "player actor" wording in the now-side-agnostic condition-context helpers (~75, ~504, ~641, ~670, ~817).

No production-caller change, no new ship mechanic, no parser change → `audit:skills` untouched. **No changelog entry** (internal refactor; no user-observable change this PR).

**Why no new failing test (the TDD note):** PR3 introduces NO new behavior — it is a byte-identical structural collapse. The TDD safety net is therefore the **existing characterization suite** (named per task) run green BEFORE the change and green AFTER, plus the **byte-identical golden gate** (the spec's load-bearing invariant). The closures being collapsed are already covered on BOTH sides: `allyChargeGrant.test.ts` + `enemyTeamRouting.test.ts` (ally-charge, player + enemy), `lowestSpeedAlly.test.ts` + `enemyReactiveSelfBuffs.test.ts` (lowest-speed-ally gate, player + enemy Chakara), `selfHpGate.test.ts` + `hpCrossing.test.ts` (self-HP% drain gate), `dynamicSpeed.smoke.test.ts` + `dynamicSpeedExtraAction.test.ts` (live effective speed). A grep gate (Task 4) proves the collapse actually happened (zero residual references to the deleted symbols). Adding a redundant new test would require exporting engine internals — rejected.

---

## Task 1: Introduce `actorsBySide` + `bySide(side)`; collapse `grantAllyCharges` + `lowestSpeed*`

**Files:**
- Modify: `src/utils/combat/engine.ts` — delete the four standalone closures; add the `bySide` seam after `baseHpFor` (~1650); rewire the grant + lowest-speed consumers.
- Test: none new (characterization via existing suite — see the TDD note above).

- [ ] **Step 1: Establish the green characterization baseline**

Run the covering suite BEFORE any edit and confirm green (this is the refactor's "red/green" anchor — there is no new failing test to write):

Run: `npx vitest run src/utils/combat/__tests__/allyChargeGrant.test.ts src/utils/combat/__tests__/enemyTeamRouting.test.ts src/utils/combat/__tests__/lowestSpeedAlly.test.ts src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts src/utils/combat/__tests__/dynamicSpeed.smoke.test.ts`
Expected: all PASS. (If any is already failing, STOP — the baseline is dirty; do not refactor on top of red.)

- [ ] **Step 2: Add the `bySide` seam after `baseHpFor`**

Locate `const baseHpFor = (id: string): number => baseHpById.get(id) ?? 0;` (~1650). Immediately after it, insert (it depends on `allPlayerActors`, `enemyAttackerActors`, `effectiveSpeedOf`, `healTarget`, and `baseHpFor` — all defined above this point):

```typescript
    // ── Side-context bundle (bySide unification PR3) ───────────────────────────
    // Collapses the four hand-paired side closures — grantAllyCharges/grantEnemyAllyCharges,
    // lowestSpeedAllyIds/lowestSpeedEnemyIds, and the drain-time self-HP% lookup — into ONE
    // side-parameterized SideContext. `actorsBySide(side)` is the primitive (its first
    // consumers are the closures below + the drain/turn call sites). Built once into cached
    // playerSide/enemySide objects so each field is a stable reference.
    //
    // BYTE-IDENTICAL: the player context reproduces the old player closures verbatim; the enemy
    // context reproduces the old enemy closures verbatim — lowestSpeedIds keeps the enemy
    // `length === 0 → ∅` guard (inert for the player side, which always has the attacker), grant
    // loops the side's own actors, and selfHpPctFor returns 100 for every enemy owner (exactly what
    // the old shared healTarget closure returned for a non-healTarget id; an enemy owner id can
    // never equal healTarget.id — reservedActorIds forbids it). The genuine per-actor enemy
    // self-HP% (real enemy currentHp) lands in PR5 with per-actor accounting.
    type Side = CombatActor['side'];

    const actorsBySide = (side: Side): CombatActor[] =>
        side === 'player' ? allPlayerActors : enemyAttackerActors;

    interface SideContext {
        /** Same-side actors: whose charges an ally-charge grant bumps / whose speeds the
         *  lowest-speed-ally gate scans. */
        actors: CombatActor[];
        /** Bump every same-side actor's charges by `amount` (capped at each actor's own
         *  chargeCount; chargeCount 0 skipped — no charge skill to bank). */
        grantAllyCharges: (amount: number) => void;
        /** Same-side ids sharing the minimum LIVE effective speed (ties → all). Empty side → ∅
         *  (DPS / no enemy attackers). Recomputed per gate eval (speed is dynamic). */
        lowestSpeedIds: () => Set<string>;
        /** Live self-HP% for a same-side drain owner (hp-threshold gates). Player side reads the
         *  heal target's live HP (every other id → 100), undefined in DPS mode (→ buildDrainContext
         *  defaults to 100). Enemy side returns 100 for every owner (no per-actor enemy HP until
         *  PR5). Consumed in Task 2. */
        selfHpPctFor?: (ownerId: string) => number;
    }

    const buildSideContext = (side: Side): SideContext => {
        const actors = actorsBySide(side);
        return {
            actors,
            grantAllyCharges: (amount: number): void => {
                for (const a of actors) {
                    if (a.chargeCount <= 0) continue;
                    a.charges = Math.min(a.charges + amount, a.chargeCount);
                }
            },
            lowestSpeedIds: (): Set<string> => {
                if (actors.length === 0) return new Set<string>();
                const speeds = actors.map((a) => effectiveSpeedOf(a));
                const min = Math.min(...speeds);
                return new Set(actors.filter((_, i) => speeds[i] === min).map((a) => a.id));
            },
            selfHpPctFor:
                side === 'player'
                    ? healTarget
                        ? (ownerId: string): number => {
                              if (ownerId !== healTarget.id) return 100;
                              // Same denominator as the cast-path selfHpPct (baseHpFor) so the gate
                              // flips at the same threshold at cast vs drain time.
                              const maxHp = baseHpFor(healTarget.id);
                              if (maxHp <= 0) return 100;
                              return Math.max(
                                  0,
                                  Math.min(100, (healTarget.currentHp / maxHp) * 100)
                              );
                          }
                        : undefined
                    : (): number => 100,
        };
    };

    const playerSide = buildSideContext('player');
    const enemySide = buildSideContext('enemy');
    const bySide = (side: Side): SideContext => (side === 'player' ? playerSide : enemySide);
```

> NOTE the `healTarget` narrowing: `healTarget` is `const` and narrowed by the enclosing `healTarget ?` ternary, so TS keeps it `CombatActor` (non-undefined) inside the closure body — identical to the existing inline pattern at ~2602. If tsc complains, mirror that existing site exactly.

- [ ] **Step 3: Delete the four standalone closures**

Remove these now-superseded definitions (their bodies are reproduced inside `buildSideContext`):
- `lowestSpeedAllyIds` (~1476–1480) and its leading comment block.
- `grantAllyCharges` (~1488–1493) and its leading comment block.
- `grantEnemyAllyCharges` (~1608–1613) and its leading comment block.
- `lowestSpeedEnemyIds` (~1618–1623) and its leading comment block.

Leave `allPlayerActors` (~1452), `enemyAttackerActors` (~1583), and `effectiveSpeedOf` (~1468) intact — they are now consumed by `actorsBySide`/`buildSideContext` (and `effectiveSpeedOf` is also used by the turn loop). Update the trailing clause of the `allPlayerActors` comment (~1450-1451: "Used by grantAllyCharges below…") to "Used by `actorsBySide`/`bySide` below."

- [ ] **Step 4: Rewire the grant + lowest-speed consumers**

`grep -n 'grantAllyCharges\|grantEnemyAllyCharges\|lowestSpeedAllyIds\|lowestSpeedEnemyIds' src/utils/combat/engine.ts` and apply (the `sideCtx.grantAllyCharges` use inside `drainQueue` ~2542 is the parameter — leave it):

| Site (symbol) | Old | New |
|---------------|-----|-----|
| `drainIntents` binding (~2630) | `grantAllyCharges,` | `grantAllyCharges: bySide('player').grantAllyCharges,` |
| `drainIntents` binding (~2629) | `isLowestSpeedAllyFor: (ownerId) => lowestSpeedAllyIds().has(ownerId),` | `isLowestSpeedAllyFor: (ownerId) => bySide('player').lowestSpeedIds().has(ownerId),` |
| `drainEnemyIntents` binding (~2649) | `grantAllyCharges: grantEnemyAllyCharges,` | `grantAllyCharges: bySide('enemy').grantAllyCharges,` |
| `drainEnemyIntents` binding (~2648) | `isLowestSpeedAllyFor: (ownerId) => lowestSpeedEnemyIds().has(ownerId),` | `isLowestSpeedAllyFor: (ownerId) => bySide('enemy').lowestSpeedIds().has(ownerId),` |
| focus `runPlayerTurn` (~2875) | `grantAllyCharges,` | `grantAllyCharges: bySide('player').grantAllyCharges,` |
| team `runPlayerTurn` (~3045) | `grantAllyCharges,` | `grantAllyCharges: bySide('player').grantAllyCharges,` |
| enemy `runPlayerTurn` (~3400) | `grantAllyCharges: grantEnemyAllyCharges,` | `grantAllyCharges: bySide('enemy').grantAllyCharges,` |

Update the now-stale local comments near these sites that name the deleted closures (e.g. the `drainEnemyIntents` comment ~2635 "grantAllyCharges is the enemy mirror"; the enemy-walk comment ~3393-3395 "uses the ENEMY mirror … grantEnemyAllyCharges") to reference `bySide('enemy').grantAllyCharges`. After this step `grep -n 'grantEnemyAllyCharges\|lowestSpeedAllyIds\|lowestSpeedEnemyIds' src/utils/combat/engine.ts` must return ZERO hits, and the only `grantAllyCharges` hits are `bySide(...).grantAllyCharges`, the `SideContext` field, and the `sideCtx.grantAllyCharges` param inside `drainQueue`.

- [ ] **Step 5: Type-check + re-run the characterization suite**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run src/utils/combat/__tests__/allyChargeGrant.test.ts src/utils/combat/__tests__/enemyTeamRouting.test.ts src/utils/combat/__tests__/lowestSpeedAlly.test.ts src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts src/utils/combat/__tests__/dynamicSpeed.smoke.test.ts src/utils/combat/__tests__/dynamicSpeedExtraAction.test.ts`
Expected: all PASS (same as Step 1 baseline).

- [ ] **Step 6: Goldens byte-identical (load-bearing)**

Run: `git status --porcelain '*.snap'`
Expected: NO `.snap` file modified. If any moved: STOP — a closure body or guard drifted (most likely the `lowestSpeedIds` empty-guard changed who is "lowest" for the player side, or the `grant` loop changed an actor list). Re-check against the table; NEVER `vitest -u`.

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): collapse grant/lowest-speed side closures into bySide() (bySide PR3 task 1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Fold `selfHpPctFor` into the `SideContext` / `ReactiveSideCtx`

**Files:**
- Modify: `src/utils/combat/engine.ts` — `ReactiveSideCtx` interface (~972); the inline `selfHpPctFor` spread inside `drainQueue` (~2602–2617); the two drain bindings (~2625, ~2640).

**Why this is byte-identical:** today the inline `drainQueue` spread builds ONE `selfHpPctFor` (closing over `healTarget`) used by BOTH drains; for the player drain it returns the heal target's HP (others 100), for the enemy drain it returns 100 for every enemy owner (since no enemy id equals `healTarget.id`). Sourcing it per-side from `bySide(side).selfHpPctFor` reproduces both exactly: `bySide('player').selfHpPctFor` is the same `healTarget` closure (or `undefined` in DPS, which `buildDrainContext` defaults to 100 via `?? 100` — identical to today's "field absent" path), and `bySide('enemy').selfHpPctFor` is `() => 100`.

- [ ] **Step 1: Add `selfHpPctFor` to `ReactiveSideCtx`**

In the `ReactiveSideCtx` interface (~972), after `grantAllyCharges`, add:

```typescript
    /** Live self-HP% for a same-side drain owner (drain-time hp-threshold gates). Optional —
     *  absent/undefined → buildDrainContext defaults the gate to 100 (DPS / pre-4c). Sourced from
     *  bySide(side).selfHpPctFor (bySide PR3): player = heal-target HP, enemy = 100 until PR5. */
    selfHpPctFor?: (ownerId: string) => number;
```

- [ ] **Step 2: Replace the inline `drainQueue` spread with the sideCtx field**

In `drainQueue`'s executor-ctx construction (~2602–2617), replace the conditional inline block:

```typescript
                        ...(healTarget
                            ? {
                                  selfHpPctFor: (ownerId: string): number => {
                                      if (ownerId !== healTarget.id) return 100;
                                      const maxHp = baseHpFor(healTarget.id);
                                      if (maxHp <= 0) return 100;
                                      return Math.max(
                                          0,
                                          Math.min(100, (healTarget.currentHp / maxHp) * 100)
                                      );
                                  },
                              }
                            : {}),
```

with the per-side field (preserve the surrounding explanatory comment block at ~2597-2601, updating its prose to say the closure is now sourced per-side from `sideCtx.selfHpPctFor`):

```typescript
                        selfHpPctFor: sideCtx.selfHpPctFor,
```

> `selfHpPctFor: undefined` (DPS player drain, where `bySide('player').selfHpPctFor` is `undefined`) is byte-identical to today's omitted field: `buildDrainContext` reads `ctx.selfHpPctFor?.(ownerId) ?? 100` (optional chaining treats absent and `undefined` identically).

- [ ] **Step 3: Pass `selfHpPctFor` from each drain binding**

`drainIntents` (~2625): add `selfHpPctFor: bySide('player').selfHpPctFor,` to the `ReactiveSideCtx` literal.
`drainEnemyIntents` (~2645): add `selfHpPctFor: bySide('enemy').selfHpPctFor,` to its `ReactiveSideCtx` literal.

- [ ] **Step 4: Type-check + self-HP% characterization**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run src/utils/combat/__tests__/selfHpGate.test.ts src/utils/combat/__tests__/hpCrossing.test.ts`
Expected: all PASS.

- [ ] **Step 5: Goldens byte-identical**

Run: `git status --porcelain '*.snap'`
Expected: NO `.snap` modified. If any moved: STOP — the per-side `selfHpPctFor` diverged from the old shared closure (check the player denominator `baseHpFor` and the enemy `() => 100`). NEVER `vitest -u`.

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): source drain selfHpPctFor per-side from bySide() (bySide PR3 task 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Sweep stale "player actor" JSDoc in the side-agnostic helpers

**Files:**
- Modify: `src/utils/combat/triggers.ts` — comment-only edits at the now-side-agnostic condition-context helpers.

**Why:** since enemy-team support (PRs #102–#104) and bySide PR2, `buildDrainContext` / `buildActorConditionContext` / `selfBuffNamesForOwners` / `ownerDebuffNamesFor` and the executor's ally-charge branch serve BOTH sides, but several docstrings still say "a player actor". This is the spec/memory-tracked PR3 deliverable ("sweep the stale 'player actor' condition-context JSDoc"). ZERO behavior change.

- [ ] **Step 1: Audit each occurrence**

Run: `grep -n 'player actor' src/utils/combat/triggers.ts`
Expected hits (verify line numbers — they shift): ~75, ~171, ~364, ~504, ~601, ~641, ~670, ~817.

- [ ] **Step 2: Update the genuinely-stale ones to side-neutral wording**

Edit these (comment text only — do not touch code):
- **~75** ("`ownerId` (Task 6) is the player actor whose reactive ability fired") → "the actor (either side) whose reactive ability fired".
- **~504** ("Build a ConditionContext for ONE player actor (`ownerId`)") → "for ONE actor (`ownerId`, either side)".
- **~641–642** ("Used to populate `enemyBuffNames` for a player actor's `enemy-buff` gates: the OPPOSING side from a player gate's view is the enemy attacker(s)") → reword to: the opposing-side buff names for ANY actor's `enemy-buff` gate (a player actor sees the enemy attackers; an enemy actor sees the player team — the engine passes the correct opposing owner ids).
- **~670** ("for a player actor whose own…") → "for an actor (either side) whose own enemy-applied debuffs…".
- **~817** ("EVERY player actor (per-actor cap, skip chargeCount 0)") → "EVERY same-side actor (per-actor cap, skip chargeCount 0)" — the ally-charge branch grants via the side-bound `grantAllyCharges`.

**Leave ~171, ~364 unchanged** — those ("for enemy owners: any player actor") are CORRECT descriptions of the per-call routing (updated in PR2). **~601** ("no debuffs on player actors") describes the DPS-mode no-op and is accurate; leave it unless the reviewer flags it.

- [ ] **Step 3: Type-check (comments only — sanity)**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/triggers.ts
git commit -m "docs(combat): sweep stale 'player actor' JSDoc in side-agnostic condition helpers (bySide PR3 task 3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Verify byte-identical + clean, then open the PR

**Files:** none (verification only).

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: ALL green (same count as the PR2 tip — PR3 adds no tests).

- [ ] **Step 2: Goldens byte-identical — the load-bearing check**

Run: `git diff --stat origin/feat/combat-sim-phase5-pr2 -- '*.snap'`
Expected: EMPTY (no `.snap` in the diff). The only changed files are `engine.ts` and `triggers.ts`. If any golden moved: STOP, fix the seam, NEVER `vitest -u`.

- [ ] **Step 3: Collapse-happened grep gate**

Run: `grep -n 'grantEnemyAllyCharges\|lowestSpeedAllyIds\|lowestSpeedEnemyIds' src/utils/combat/engine.ts`
Expected: ZERO hits (the paired closures are gone; only `bySide('player'|'enemy').grantAllyCharges` / `.lowestSpeedIds()` remain).

- [ ] **Step 4: Lint + skill audit**

Run: `npm run lint` → 0 warnings/errors (`--max-warnings 0`). `actorsBySide`, `bySide`, `playerSide`, `enemySide`, `SideContext`, `Side` are all read (drain + turn sites) — no unused-binding warning.
Run: `npm run audit:skills` → 0 findings / 141 ships (no parser/ability change).

- [ ] **Step 5: Push and open the PR**

```bash
gh auth switch --hostname github.com --user TheSusort
git push --no-verify origin feat/combat-engine-unify-pr3-side-closures | cat
gh pr create --base feat/combat-sim-phase5-pr2 \
  --title "refactor(combat): bySide unification PR3 — unify side-closures into bySide()" \
  --body "$(cat <<'EOF'
Third slice of the team-agnostic bySide engine unification (spec: docs/superpowers/specs/2026-06-16-combat-engine-bySide-unification-design.md, §4 PR3). Stacked on PR2 (#119).

## What
- New `actorsBySide(side)` primitive + cached `bySide(side) → SideContext` bundling the three side behaviors.
- Collapsed `grantAllyCharges`/`grantEnemyAllyCharges` → `bySide(side).grantAllyCharges`.
- Collapsed `lowestSpeedAllyIds`/`lowestSpeedEnemyIds` → `bySide(side).lowestSpeedIds()` (unified `length === 0 → ∅` guard).
- Moved the drain-time `selfHpPctFor` out of the inline `drainQueue` spread into a per-side `SideContext`/`ReactiveSideCtx` field (player = heal-target HP, enemy = 100 until PR5).
- Swept stale "player actor" JSDoc in the now-side-agnostic condition-context helpers in `triggers.ts`.

## Safety
- BYTE-IDENTICAL DPS + healing goldens (verified: no `.snap` movement). Each side's `SideContext` reproduces the old per-side closures verbatim; the enemy `selfHpPctFor` returns 100 exactly as the old shared `healTarget` closure did for any non-`healTarget` id.
- Covered by the existing characterization suite (ally-charge, lowest-speed, self-HP%, dynamic-speed — both sides). Grep gate confirms the paired closures are gone.

## Out of scope (flagged, deferred)
- The enemy `roleByActorId` gap (enemy `on-ally-attacked` role filters, e.g. enemy Graphite, stay dormant) is NOT cheap — `EnemyActorInput` carries no `role` field, so it needs a new input field + adapter/UI plumbing. Deferred (a later PR), not part of PR3.
- Genuine per-actor enemy self-HP% (reading real enemy `currentHp`) lands in PR5 with per-actor accounting.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

NOTE: PR base is the stacked branch `feat/combat-sim-phase5-pr2`. CodeRabbit only auto-reviews base=main PRs — retarget to main + rebase `--onto` once the chain merges. Poll `mergeState=CLEAN`; npm-audit RED is the pre-existing vite advisory (non-blocker). The user merges PRs ("merge when green").

---

## Definition of done

- [ ] `actorsBySide(side)` + `bySide(side) → SideContext` (cached `playerSide`/`enemySide`) defined once after `baseHpFor`; the four standalone closures (`grantAllyCharges`, `grantEnemyAllyCharges`, `lowestSpeedAllyIds`, `lowestSpeedEnemyIds`) deleted.
- [ ] All grant + lowest-speed consumers (2 drain bindings + 3 `runPlayerTurn` sites) route through `bySide('player'|'enemy').<field>`; grep for the deleted enemy/ally symbols returns zero.
- [ ] `selfHpPctFor` moved to the `ReactiveSideCtx`/`SideContext` field, sourced per-side; `drainQueue` reads `sideCtx.selfHpPctFor`.
- [ ] Stale "player actor" JSDoc swept in `triggers.ts` (side-neutral wording); no code touched there.
- [ ] `npm test` green; goldens BYTE-IDENTICAL (no `.snap` in the diff vs `origin/feat/combat-sim-phase5-pr2`).
- [ ] `npm run lint` clean; `npx tsc --noEmit` clean; `audit:skills` 0/141.
- [ ] PR opened against `feat/combat-sim-phase5-pr2`.
