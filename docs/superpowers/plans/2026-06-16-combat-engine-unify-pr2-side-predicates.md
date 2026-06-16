# Combat Engine bySide Unification — PR2: Side Predicates + Enemy Reactive-Routing Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the player-centric `isEnemySide` predicate inside `registerReactiveListeners` with a per-call `isOpposing` / `isSameSideAlly`, and fix `grantExtraAction` to resolve its granter from the combined roster — so an ENEMY-side ship's opposing/ally reactive triggers fire against the correct side (the campaign's first bug fix: the lone enemy Liberator that kills a player ship finally gets its `on-enemy-destroyed` extra action).

**Architecture:** Today `registerReactiveListeners` is called twice (player owners + enemy owners) with the SAME player-centric `isEnemySide` predicate, so for an enemy owner "an enemy died" only ever means "an enemy-SIDE actor died" — never its real opponent (a player). And `grantExtraAction` resolves the granter from `allPlayerActorsById`, dropping any enemy granter even when its trigger fired. PR2 parameterizes the listener factory with a per-call `isOpposing(actorId)` (player call passes today's `isEnemySide`; enemy call passes its negation) and derives `isSameSideAlly(actorId, ownerId) = !isOpposing(actorId) && actorId !== ownerId` internally, then switches the two `grantExtraAction` granter lookups to the combined `allActorsById` map (PR1 deferred this accessor here, to its first consumer). The reactive/event layer is already side-agnostic, so this is a predicate-parameterization + one-map-swap refactor, not new machinery.

**Tech Stack:** TypeScript, Vitest. Reactive listener factory in `src/utils/combat/triggers.ts`; engine wiring + roster in `src/utils/combat/engine.ts`.

**Spec:** `docs/superpowers/specs/2026-06-16-combat-engine-bySide-unification-design.md` (§4 PR2 row; root-cause memo: `project-enemy-side-reactive-routing-gap`).

**Safety gate (re-derived from the spec's PR2 row):** **BYTE-IDENTICAL** DPS + healing goldens. PR2 touches behavior-adjacent code, but only the PLAYER viewpoint is exercised by the goldens, and the player call passes `isOpposing: isEnemySide` — algebraically identical to today (`!isOpposing(x) === !isEnemySide(x)`, and every `on-ally-*` check was already combined with `!== ownerId`). So **any golden move here is a refactor LEAK** (predicate semantics drifted on the player path), NOT acceptable churn — fix the seam, never `vitest -u`. The behavioral fix lives entirely on the ENEMY call, which no DPS/healing golden exercises (single-target healing: enemies are undamaged, nothing on the enemy side dies → no opposing/ally enemy reaction has a triggering event). The fix is proven by NEW team-vs-team tests.

**Branch:** `feat/combat-engine-unify-pr2` off the current `feat/combat-sim-phase5-pr2` tip (PR1 merged there as `f379c7d3`). Work in the main checkout — do NOT create a fresh worktree (esbuild crash). Stacks on PR1; accept the rebase-`--onto`/retarget friction.

---

## File structure

- **Modify** `src/utils/combat/triggers.ts` — rename the `registerReactiveListeners` arg `isEnemySide` → `isOpposing`; add an internal `isSameSideAlly` helper; replace the 9 in-listener predicate uses; update the args docstring AND the factory-level trigger-by-trigger summary docstring (~140-174, which also names `isEnemySide`). Also relax the now-stale "granter is always a player actor" comment on the `grantExtraAction` delegate docstring if present.
- **Modify** `src/utils/combat/engine.ts` — introduce the combined `allActorsById` accessor (PR1-deferred, first consumer is here); pass `isOpposing` to both `registerReactiveListeners` call sites (player = `isEnemySide`, enemy = its negation); switch the two `grantExtraAction` granter lookups (`grantExtraAction` body + the Path-B `pendingExtraActions` flush) from `allPlayerActorsById` to `allActorsById`; update the stale "granter is always a player actor" comment.
- **Create** `src/utils/combat/__tests__/enemyReactiveRouting.test.ts` — Task 1 unit test of `registerReactiveListeners` predicate routing (enemy owner) + Task 2 end-to-end team-vs-team enemy-Liberator extra-action repro.

No production caller change. No changelog entry (internal refactor; the user-facing consequence — enemy reactive abilities firing in the simulator — is part of the broader unification, surfaced when the simulator ships, not a standalone shipped feature this PR). If the reviewer disagrees, a one-line changelog note ("enemy ships' reactive abilities now fire correctly in the combat simulator") is acceptable.

---

## Task 1: Parameterize the reactive-listener predicate (`isEnemySide` → `isOpposing` / `isSameSideAlly`)

**Files:**
- Modify: `src/utils/combat/triggers.ts` — `registerReactiveListeners` args type + body (~192-413)
- Modify: `src/utils/combat/engine.ts` — the two `registerReactiveListeners` call sites (~1840 player, ~1861 enemy)
- Test: `src/utils/combat/__tests__/enemyReactiveRouting.test.ts` (new)

**Why this is byte-identical for goldens:** the player call passes `isOpposing: isEnemySide`, so `isOpposing(x) === isEnemySide(x)` and `isSameSideAlly(x, owner) === !isEnemySide(x) && x !== owner` — exactly the existing player-side expressions (every `on-ally-*` listener already combined `!isEnemySide(...)` with an `!== ownerId` guard, verified below). The enemy call flips to the correct semantics; no golden exercises enemy opposing/ally reactions.

- [ ] **Step 1: Write the failing unit test**

Create `src/utils/combat/__tests__/enemyReactiveRouting.test.ts`. This drives `registerReactiveListeners` directly with a fake bus and a spy `enqueue`, mirroring the import style of `triggers.test.ts` (`createEventBus` from `../events`, `registerReactiveListeners` + `Intent` + `ReactiveAbility` from `../triggers`, `ab(...)` builder). Construct ONE enemy owner `'E1'` with two reactive abilities — an `on-enemy-destroyed` and an `on-ally-destroyed` (use the simplest non-extra-action payloads, e.g. a `buff`/`heal` config; the factory only ENQUEUES, so the config body is irrelevant to this test). Wire `isOpposing` so PLAYER ids are opposing to the enemy owner:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../events';
import { registerReactiveListeners, Intent, ReactiveAbility } from '../triggers';
import { Ability } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config' | 'trigger'>): Ability => ({
    id: `er${++idCounter}`,
    target: 'self',
    conditions: [],
    ...partial,
});

// Reactive ability wrapper mirrors what the engine partitions onto a runtime
// (sourceSlot is opaque to registerReactiveListeners — it only rides into the Intent).
const ra = (ability: Ability): ReactiveAbility => ({ ability, sourceSlot: 'passive' });

describe('registerReactiveListeners — enemy-owner side routing (bySide PR2)', () => {
    it('routes an enemy owner\'s on-enemy-destroyed to OPPOSING (player) deaths, not same-side', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];
        const onEnemyDestroyed = ab({
            type: 'buff', trigger: 'on-enemy-destroyed',
            config: { type: 'buff', buffName: 'X', stat: 'attack', value: 1, turns: 1 } as never,
        });
        // For enemy owner E1, the PLAYER ids are opposing.
        const isOpposing = (id: string) => id === 'P1' || id === 'P2';
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'E1', reactiveAbilities: [ra(onEnemyDestroyed)] }],
            enqueue: (i) => enqueued.push(i),
            isOpposing,
        });
        bus.emit({ type: 'ship-destroyed', actorId: 'P1', round: 1 } as never); // opposing → fires
        bus.emit({ type: 'ship-destroyed', actorId: 'E2', round: 1 } as never); // same side → no
        expect(enqueued).toHaveLength(1);
        expect(enqueued[0].ownerId).toBe('E1');
    });

    it('routes an enemy owner\'s on-ally-destroyed to SAME-side non-self deaths only', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];
        const onAllyDestroyed = ab({
            type: 'buff', trigger: 'on-ally-destroyed',
            config: { type: 'buff', buffName: 'Y', stat: 'attack', value: 1, turns: 1 } as never,
        });
        const isOpposing = (id: string) => id === 'P1';
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'E1', reactiveAbilities: [ra(onAllyDestroyed)] }],
            enqueue: (i) => enqueued.push(i),
            isOpposing,
        });
        bus.emit({ type: 'ship-destroyed', actorId: 'E2', round: 1 } as never); // same-side ally → fires
        bus.emit({ type: 'ship-destroyed', actorId: 'E1', round: 1 } as never); // self → no (on-destroyed's job)
        bus.emit({ type: 'ship-destroyed', actorId: 'P1', round: 1 } as never); // opposing → no
        expect(enqueued).toHaveLength(1);
    });

    it('player-call parity: isOpposing = isEnemySide reproduces the legacy player routing', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];
        const onAllyDestroyed = ab({
            type: 'buff', trigger: 'on-ally-destroyed',
            config: { type: 'buff', buffName: 'Z', stat: 'attack', value: 1, turns: 1 } as never,
        });
        const isEnemySide = (id: string) => id === 'enemy'; // legacy player-side predicate
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'attacker', reactiveAbilities: [ra(onAllyDestroyed)] }],
            enqueue: (i) => enqueued.push(i),
            isOpposing: isEnemySide,
        });
        bus.emit({ type: 'ship-destroyed', actorId: 'T1', round: 1 } as never);    // ally player → fires
        bus.emit({ type: 'ship-destroyed', actorId: 'enemy', round: 1 } as never); // enemy → no
        bus.emit({ type: 'ship-destroyed', actorId: 'attacker', round: 1 } as never); // self → no
        expect(enqueued).toHaveLength(1);
    });
});
```

> NOTE on event-literal typing: the bus `emit` is typed to `CombatEvent`. If `as never` casts are rejected by lint/tsc, mirror how `triggers.test.ts` constructs `ship-destroyed` events (it imports `CombatEvent`) and build a properly-typed event object instead — the goal is a real `ship-destroyed` event with the `actorId` field. Likewise mirror the real `BuffConfig` shape from `types/abilities` for the ability `config` rather than `as never` if the cast is rejected.

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/enemyReactiveRouting.test.ts`
Expected: FAIL — `registerReactiveListeners` has no `isOpposing` arg yet (tsc/type error on the call, or the arg is ignored so routing is wrong).

- [ ] **Step 3: Rename the arg and add `isSameSideAlly` in `triggers.ts`**

In `registerReactiveListeners`'s args type (~192), rename the field and rewrite its docstring:

```typescript
    /** True for any actor on the side OPPOSING this listener set's owners. The engine
     *  passes a per-call predicate: the PLAYER registration passes `isEnemySide`
     *  (opposing = enemy-side); the ENEMY registration passes its negation (opposing =
     *  player-side). Replaces the old player-centric `isEnemySide` arg so an enemy
     *  owner's opposing/ally reactions route against the correct side (bySide PR2). */
    isOpposing: (actorId: string) => boolean;
```

In the destructure (~210), swap `isEnemySide` → `isOpposing` and add the same-side-ally helper directly after it:

```typescript
    const { bus, perOwner, enqueue, isOpposing, roleOf } = args;
    // Same-side ally = NOT opposing AND not the owner itself (own events route to the
    // self-scoped triggers). Replaces the old `!isEnemySide(x) && x !== ownerId` pattern;
    // for the player call (isOpposing = isEnemySide) this is byte-identical.
    const isSameSideAlly = (actorId: string, ownerId: string): boolean =>
        !isOpposing(actorId) && actorId !== ownerId;
```

- [ ] **Step 4: Replace the 8 in-listener predicate uses**

Apply these exact swaps inside the listener bodies (each preserves player-call semantics; verified against the current source):

| Trigger | Old | New |
|---------|-----|-----|
| `on-ally-debuff-inflicted` (`debuff-applied`) | `e.sourceId !== ownerId && !isEnemySide(e.sourceId)` | `isSameSideAlly(e.sourceId, ownerId)` |
| `on-ally-debuff-inflicted` (`dot-applied`) | `e.sourceId !== ownerId && !isEnemySide(e.sourceId)` | `isSameSideAlly(e.sourceId, ownerId)` |
| `on-ally-crit-dot` | `e.viaCrit && e.sourceId !== ownerId && !isEnemySide(e.sourceId)` | `e.viaCrit && isSameSideAlly(e.sourceId, ownerId)` |
| `on-ally-crit` (guard) | `if (e.actorId === ownerId \|\| isEnemySide(e.actorId)) return;` | `if (!isSameSideAlly(e.actorId, ownerId)) return;` |
| `on-ally-attacked` (guard) | `if (e.targetId === ownerId \|\| isEnemySide(e.targetId)) return;` | `if (!isSameSideAlly(e.targetId, ownerId)) return;` |
| `on-ally-destroyed` | `e.actorId !== ownerId && !isEnemySide(e.actorId)` | `isSameSideAlly(e.actorId, ownerId)` |
| `on-enemy-destroyed` | `if (isEnemySide(e.actorId))` | `if (isOpposing(e.actorId))` |
| `on-enemy-repaired` | `if (isEnemySide(e.casterId))` | `if (isOpposing(e.casterId))` |
| `on-enemy-cleansed` | `if (isEnemySide(e.casterId))` | `if (isOpposing(e.casterId))` |

Leave each listener's explanatory comment intact except where it says "isEnemySide" verbatim — update the prose to "opposing / same-side ally" wording. This includes the factory-level summary docstring (~140-174), which names `isEnemySide` several times. After this step there must be ZERO remaining `isEnemySide` references inside `triggers.ts` (grep to confirm: `grep -n isEnemySide src/utils/combat/triggers.ts` → no hits). NOTE: the swap table has 9 rows (the `on-ally-debuff-inflicted` trigger contributes two listeners) — all 9 must be swapped; the grep gate is the authoritative check.

- [ ] **Step 5: Update both engine call sites**

In `engine.ts`, the PLAYER registration (~1840) — change the field to pass the existing `isEnemySide` under the new name (byte-identical):

```typescript
    registerReactiveListeners({
        bus,
        perOwner: reactivePerOwner,
        enqueue: (intent) => intentQueue.push(intent),
        isOpposing: isEnemySide,
        roleOf: (id) => roleByActorId.get(id),
    });
```

The ENEMY registration (~1861) — pass the NEGATION (player-side actors are opposing to an enemy owner):

```typescript
        registerReactiveListeners({
            bus,
            perOwner: enemyReactivePerOwner,
            enqueue: (intent) => enemyIntentQueue.push(intent),
            // Enemy owners: the PLAYER team is opposing. Negating the player-centric
            // isEnemySide flips on-enemy-* / on-ally-* to the enemy's own frame
            // (bySide PR2 — fixes the enemy reactive-routing bug).
            isOpposing: (id: string) => !isEnemySide(id),
            roleOf: (id) => roleByActorId.get(id),
        });
```

> Keep `isEnemySide` (engine.ts ~1830) exactly as-is — it stays the player-frame primitive that both calls are derived from. (Its own full unification into `bySide()` is PR3+, not here.)
>
> KNOWN OUT-OF-SCOPE (do NOT fix here): the enemy call's `roleOf` still reads `roleByActorId`, which is populated with PLAYER roles only — so an enemy `on-ally-attacked` role filter (enemy Graphite) stays dormant. That is a roleOf-map gap, not a predicate gap; it belongs to a later PR. Flag it, don't chase it.

- [ ] **Step 6: Run the unit test + type-check**

Run: `npx vitest run src/utils/combat/__tests__/enemyReactiveRouting.test.ts` → all 3 cases PASS.
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/engine.ts src/utils/combat/__tests__/enemyReactiveRouting.test.ts
git commit -m "fix(combat): route enemy reactive triggers via per-call isOpposing predicate (bySide PR2 task 1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Fix `grantExtraAction` to resolve the granter from the combined roster

**Files:**
- Modify: `src/utils/combat/engine.ts` — introduce `allActorsById` (after `allActors`, ~1596); `grantExtraAction` body (~2490); Path-B `pendingExtraActions` flush (~2653); stale comment (~2482)
- Test: `src/utils/combat/__tests__/enemyReactiveRouting.test.ts` (append the end-to-end repro)

**Why Task 1 alone isn't enough:** after Task 1, the enemy Liberator's `on-enemy-destroyed` listener FIRES when a player dies (the predicate is fixed) and routes through the executor's `extra-action` branch into `grantExtraAction`. But `grantExtraAction` resolves the granter from `allPlayerActorsById`, which has no enemy ids → `if (!granter) return;` silently drops it. `processExtraActionGrants` itself already works for any actor (it bumps the `pending` / `endOfRoundPending` maps, both seeded from `roundActors === allActors`, which includes enemy ids). So the ONLY missing piece is the granter lookup.

- [ ] **Step 1: Write the failing end-to-end repro test**

Append to `enemyReactiveRouting.test.ts` a team-vs-team `runCombat` scenario, grounded in the `twoTeamBattle.test.ts` harness (positioned actors + `healTargetId` to unlock the enemy roster) and the `reactiveExtraAction.test.ts` ability builders (the `extra-action` / `on-enemy-destroyed` passive). Set up: an ENEMY attacker carrying a Liberator-style passive (`type:'extra-action'`, `target:'self'`, `trigger:'on-enemy-destroyed'`, `config:{ type:'extra-action', oncePerRound:true }`) plus a plain damage active strong enough to one-shot a fragile PLAYER ship; TWO player ships (a fragile victim + a tanky survivor set as `healTargetId`) so the player team is not wiped and combat continues.

Assert via a **non-vacuous control comparison** (per the spec's vacuous-isolation-trap warning): run the identical battle twice — once with the extra-action passive present, once absent — and assert the enemy Liberator takes exactly ONE more turn WITH the passive. Count the enemy Liberator's `turn-started` events (`events.filter(e => e.type==='turn-started' && e.actorId===LIBERATOR_ID).length`). Both runs must produce identical damage (the passive is non-damaging) → the kill happens in both → the only delta is the extra action.

```typescript
// (sketch — fill in positioned builders + ids from twoTeamBattle.test.ts)
const liberatorTurns = (withPassive: boolean): number => {
    const { events, LIBERATOR_ID } = runTeamBattle({ withExtraActionPassive: withPassive });
    return events.filter(e => e.type === 'turn-started' && e.actorId === LIBERATOR_ID).length;
};
it('enemy Liberator gains its on-enemy-destroyed extra action after killing a player ship', () => {
    const withPassive = liberatorTurns(true);
    const without = liberatorTurns(false);
    // Sanity: the kill actually happens in BOTH runs (non-vacuous baseline).
    expect(/* a player ship destroyed in the control run */).toBe(true);
    // The fix: exactly one extra action (once per round, single kill).
    expect(withPassive).toBe(without + 1);
});
```

> The exact extra-turn LANDING ROUND (same-round Path A vs next-round Path B) depends on when a real positioned player victim's death is reconciled — OBSERVE it from the live engine while implementing and pin it in a comment; the regression PROPERTY asserted is the total-turn delta (`+1`), which is timing-independent. If you also want a per-round assertion, add it only after observing the real behavior — never guess it.

- [ ] **Step 2: Run the repro, verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/enemyReactiveRouting.test.ts -t "extra action after killing"`
Expected: FAIL — `withPassive === without` (the grant is dropped by the player-only granter lookup), so `withPassive === without + 1` is false.

- [ ] **Step 3: Introduce the combined `allActorsById` accessor**

In `engine.ts`, immediately AFTER the `allActors` definition (~1596, the PR1 seam), add (PR1 explicitly deferred this accessor to its first consumer — here):

```typescript
    // Combined id→actor map over the unified roster (bySide unification PR2 — first
    // consumer). Unlike allPlayerActorsById (attacker + team only), this includes the
    // dummy enemy and every enemy attacker, so a reactive granter on EITHER side
    // resolves. Used by grantExtraAction; companion actorsBySide lands in PR3.
    const allActorsById = new Map<string, CombatActor>(allActors.map((a) => [a.id, a]));
```

(`allActorsById` is read in Step 4, so it is not an unused binding — no `--max-warnings 0` issue.)

- [ ] **Step 4: Switch the two `grantExtraAction` granter lookups + fix the stale comment**

In `grantExtraAction` (~2490): `const granter = allPlayerActorsById.get(granterId);` → `const granter = allActorsById.get(granterId);`

In the Path-B flush (~2653): `const granter = allPlayerActorsById.get(g.granterId);` → `const granter = allActorsById.get(g.granterId);`

Update the now-stale comment block above `grantExtraAction` (~2481-2483) — replace "The granter is always a player actor (the ship whose death-passive fired); a missing id is impossible (the reactive owner ids ARE player ids)" with:

```typescript
        // onto pendingExtraActions; the next round's pool build flushes it. The granter is the
        // ship whose reactive passive fired — a PLAYER or (since bySide PR2) an ENEMY actor; it
        // is resolved from the combined allActorsById roster. A missing id is impossible (every
        // reactive owner id is in allActors) → skip defensively rather than throw mid-drain.
```

> Do NOT touch the `healTarget` lookup (`allPlayerActorsById.get(healTargetId)`, ~1536) or any other `allPlayerActorsById` use — the heal target is always a player; only the two granter lookups change.

- [ ] **Step 5: Run the repro + type-check**

Run: `npx vitest run src/utils/combat/__tests__/enemyReactiveRouting.test.ts` → all cases PASS (`withPassive === without + 1`).
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/enemyReactiveRouting.test.ts
git commit -m "fix(combat): resolve extra-action granter from combined roster so enemy grants land (bySide PR2 task 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Verify byte-identical + clean, then open the PR

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: ALL green (prior count + the new `enemyReactiveRouting.test.ts` cases).

- [ ] **Step 2: Goldens byte-identical — the load-bearing check**

Run: `git status --porcelain '*.snap'` and `git diff --stat origin/feat/combat-sim-phase5-pr2 -- '*.snap'`
Expected: NO `.snap` file modified. The only changed files are `triggers.ts`, `engine.ts`, and the new test file.
If any golden moved: **STOP.** The player-call predicate semantics leaked (the player call must remain `isOpposing: isEnemySide`, exactly reproducing the old expressions). Re-check Task 1 Step 4's swaps against the table and Task 1 Step 5's player call. NEVER run `vitest -u`. (A healing-golden move would mean an enemy attacker in a synthetic fixture actually had a triggering opposing/ally reaction — if so, audit whether it's a legitimate latent-bug fix and escalate to the user before accepting; the spec's expectation is byte-identical.)

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 warnings/errors (`--max-warnings 0`). `allActorsById` is read by `grantExtraAction`; no unused-binding warning.

- [ ] **Step 4: Skill audit (sanity — untouched)**

Run: `npm run audit:skills`
Expected: 0 findings / 141 ships (no parser/ability change in this PR).

- [ ] **Step 5: Manual `/simulator` smoke check**

The dev server serves `/simulator` on :3000 (already on this branch). Place a lone enemy Liberator (R4) vs a fragile player ship; confirm that when the enemy Liberator kills the player ship it takes a second action that round (the codified repro from `project-enemy-side-reactive-routing-gap`). Note the result in the PR body.

- [ ] **Step 6: Push and open the PR**

```bash
gh auth switch --hostname github.com --user TheSusort
git push --no-verify origin feat/combat-engine-unify-pr2 | cat
gh pr create --base feat/combat-sim-phase5-pr2 \
  --title "fix(combat): bySide unification PR2 — side predicates + enemy reactive-routing fix" \
  --body "$(cat <<'EOF'
Second slice of the team-agnostic bySide engine unification (spec: docs/superpowers/specs/2026-06-16-combat-engine-bySide-unification-design.md, §4 PR2). Stacked on PR1 (#118).

## What
- `registerReactiveListeners` now takes a per-call `isOpposing(actorId)` instead of the player-centric `isEnemySide`, and derives `isSameSideAlly(id, owner) = !isOpposing(id) && id !== owner` internally. The player registration passes `isOpposing: isEnemySide` (byte-identical); the enemy registration passes its negation.
- `grantExtraAction` (and the Path-B pending-grant flush) now resolve the granter from the combined `allActorsById` roster instead of the player-only `allPlayerActorsById`, so an enemy granter's grant lands.

## Fixes
- An ENEMY-side ship's opposing/ally reactive triggers (`on-enemy-destroyed`, `on-ally-destroyed`, `on-ally-attacked`, `on-enemy-repaired`/`-cleansed`) now fire against the correct side. The codified repro — a lone enemy Liberator that kills a player ship now gets its `on-enemy-destroyed` extra action — passes (verified by a control-comparison team-vs-team test + a `/simulator` smoke check). Retires the `project-enemy-side-reactive-routing-gap` bug class.

## Safety
- BYTE-IDENTICAL DPS + healing goldens (verified: no `.snap` movement). The player call is algebraically identical to today; the behavioral change lives entirely on the enemy call, which no golden exercises.
- New `enemyReactiveRouting.test.ts`: 3 predicate unit tests + 1 end-to-end enemy-Liberator extra-action repro (non-vacuous control comparison).

## Out of scope (flagged, deferred)
- Enemy `on-ally-attacked` role filters (enemy Graphite) stay dormant — the enemy `roleOf` map carries player roles only. That is a roleOf-map gap, not a predicate gap; a later PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

NOTE: PR base is the stacked branch `feat/combat-sim-phase5-pr2`. CodeRabbit only auto-reviews base=main PRs — retarget to main and rebase `--onto` once PR1's chain merges. Poll `mergeState=CLEAN`; npm-audit RED is the pre-existing vite advisory (non-blocker). The user merges PRs ("merge when green").

---

## Definition of done

- [ ] `registerReactiveListeners` takes `isOpposing` (not `isEnemySide`); `isSameSideAlly` derived internally; all 8 in-listener predicate uses swapped; zero `isEnemySide` references remain in `triggers.ts`.
- [ ] Player call passes `isOpposing: isEnemySide`; enemy call passes `isOpposing: (id) => !isEnemySide(id)`.
- [ ] `allActorsById` defined once over `allActors`; both `grantExtraAction` granter lookups use it; the stale "granter is always a player actor" comment updated. `allPlayerActorsById` otherwise untouched (incl. `healTarget`).
- [ ] `enemyReactiveRouting.test.ts`: 3 predicate unit tests + the control-comparison enemy-Liberator extra-action repro, all green.
- [ ] `npm test` green; goldens BYTE-IDENTICAL (no `.snap` in the diff).
- [ ] `npm run lint` clean; `npx tsc --noEmit` clean; `audit:skills` 0/141.
- [ ] `/simulator` smoke check confirms enemy Liberator takes its extra action on a kill.
- [ ] PR opened against `feat/combat-sim-phase5-pr2`.
