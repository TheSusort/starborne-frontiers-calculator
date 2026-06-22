# D-PR14 — CF / Provoke applier implants (Bulwark + Doomsayer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model two implant special-effects that apply targeting-control debuffs the combat engine already honors — Bulwark (Provoke on an adjacent ally being damaged, once per round) and Doomsayer (Concentrate Fire on the highest-attack enemy at end-of-round if first to activate).

**Architecture:** Bulwark rides the existing `on-ally-attacked` + `counterTargetId` reactive path (Guardian precedent), adding a pure listener-level adjacency filter + an executor-side once-per-round gate. Doomsayer rides `end-of-round`, gated by a new `first-activator` condition, routing Concentrate Fire to a new `enemy-highest-attack` global-selector target. Both proc via the existing deterministic proc-chance gate. No combat fixture equips either implant → byte-identical goldens.

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/`, ability registry in `src/utils/abilities/`, types in `src/types/abilities.ts`.

**Spec:** `docs/superpowers/specs/2026-06-22-implant-gearset-abilities-D-pr14-design.md`

**Branch:** `feat/combat-d-pr14-cf-provoke-appliers` (worktree `.worktrees/d-pr14-cf-provoke-appliers`, stacked on D-PR13 tip).

---

## Key anchors (verified against current code)

- Debuff executor branch: `src/utils/combat/triggers.ts:1161` (`if (cfg.type === 'debuff')`). Routes via `intent.eventCtx?.counterTargetId` → `applyTimedAbilityStatus(round, status, undefined, counterTargetId)`; falls back to `ctx.enemy.id`. NO proc-gate today.
- `passesProcChanceGate(intent, ctx)` at `triggers.ts:992`; pass-through when `procChance` is undefined/≤0/≥1. Already used in heal/shield (1097), damage (1271), shield (1375) branches — NOT debuff.
- Purge global-selector precedent: `triggers.ts:1423` resolves `intent.ability.target === 'enemy-most-buffs' ? ctx.enemyWithMostBuffs?.(ownerId) ?? ctx.enemyId : counterTargetId`.
- `IntentExecContext.enemyWithMostBuffs?: (ownerId) => string | undefined` at `triggers.ts:634`; `adjacentAllyIdsFor?` at `triggers.ts:619`.
- `mostBuffsAmong` selector + drain-seam bindings: `engine.ts:3423` (selector), `engine.ts:3445` (`enemyWithMostBuffs: () => mostBuffsAmong(enemyAttackerActors)`, player drain), `engine.ts:3467` (`mostBuffsAmong(allPlayerActors)`, enemy drain).
- `on-ally-attacked` listener: `triggers.ts:391`; already enqueues `eventCtx: { counterTargetId: e.attackerId, damagedAllyId: e.targetId }`. `roleFilter` precedent at `triggers.ts:402-409`.
- `registerReactiveListeners` args: `triggers.ts:218-232` (destructures `{ bus, perOwner, enqueue, isOpposing, roleOf }` — NO adjacency helper today).
- `bySide(...).adjacentAllyIdsFor` built as `(ownerId) => adjacentAllyIds(ownerId, actors)` at `engine.ts:1795`.
- Round turn-loop: `engine.ts:3544` (`for (let actor = selectNext(); ...)`); `actingActorId = actor.id` + `turn-started` emit ~3601-3602. There are **THREE** `if (!isTurnBlocked(actor.id))` turn-body gates (one per actor kind): attacker at `engine.ts:3698`, walked-team ally at ~3886, real-enemy at ~4098. `isTurnBlocked` defined `engine.ts:1716`. A Stasis/Disable-skipped actor emits `turn-started` but does NOT enter these blocks.
- Condition system: `ConditionContext` (`evaluateConditions.ts:4-35`), `evaluateCondition` switch with a `default: return 0` (`evaluateConditions.ts:38-91` — so a new subject causes NO tsc error; the case is for behavior), `conditionsMet`. `buildActorConditionContext` lives at `triggers.ts:670` and delegates to `buildRoundContext` (`src/utils/abilities/roundContext.ts:13-68`) — the ACTUAL constructor; fields flow options-bag → `buildRoundContext` `state` param (~roundContext.ts:42) → return (~roundContext.ts:65) → `ConditionContext` (the `wasHitThisRound` path is the template). `buildDrainContext` at `triggers.ts:723`. `ConditionSubject` union at `abilities.ts:126`; `Condition` interface at `abilities.ts:172`.
- **Gate liveness:** `liveGateConditions` (`src/utils/combat/abilityStatusGating.ts:37-43`) rewrites any `derivable` condition whose subject is NOT in `LIVE_SUBJECTS` (`:15-29`) to `{ subject: 'always' }`; it runs at `triggers.ts:1068` before `conditionsMet`. ALACRITY's `not-hit-this-round` works ONLY because it is in `LIVE_SUBJECTS` (`:28`). `first-activator` MUST be added there too.
- Registry helpers: `mkNamedDebuff` (`buildEquipmentAbilities.ts:359-385`, hardcodes `target:'enemy'`), `mkNamedBuffGrant` with `opts.procChance` (`326-354`), proc tables `AMBUSH_PROC`/`SPEARHEAD_PROC`/`ALACRITY_PROC` (`217-239`), `IMPLANT_ABILITIES` map (`387`), implant id stamping `equip-implant-${implantName}` (`732`).
- `AbilityTarget` union: `abilities.ts:29-38` (currently ends `'enemy-most-buffs'`).
- `'Provoke'` (`buffs.ts:127`) and `'Concentrate Fire'` (`buffs.ts:461`) exist in `BUFFS`.
- Coverage test array: `equipmentCoverage.test.ts:121-148`; `BLOODTHIRST` at index 13, `EXUBERANCE` at 14 — `BULWARK`/`DOOMSAYER` insert per `IMPLANTS` declaration order (Bulwark `implants.ts:~1435`, Doomsayer `~1531`).
- Bulwark proc by rarity: 5/7/9/12/16% (common→legendary). Doomsayer: 7/9/12/16% (uncommon→legendary, NO common).

---

## File structure

- **Create** `src/utils/combat/highestAttack.ts` — pure `highestAttackAmong(ids, attackOf, isLiving)` selector (unit-testable).
- **Create** `src/utils/combat/__tests__/highestAttack.test.ts`.
- **Modify** `src/types/abilities.ts` — `AbilityTarget += 'enemy-highest-attack'`; `Ability.oncePerRound?`, `Ability.requireDamagedAllyAdjacent?`; `ConditionSubject += 'first-activator'`; `ConditionContext.firstActivator?`.
- **Modify** `src/utils/abilities/evaluateConditions.ts` — `first-activator` case + `firstActivator` field on `ConditionContext`.
- **Modify** `src/utils/abilities/roundContext.ts` — `buildRoundContext` `state` param + return object carry `firstActivator` (this is the ACTUAL `ConditionContext` constructor; `buildActorConditionContext` delegates to it).
- **Modify** `src/utils/combat/abilityStatusGating.ts` — add `'first-activator'` to `LIVE_SUBJECTS` (else `liveGateConditions` rewrites the gate to `always` and Doomsayer fires unconditionally — the same step that makes ALACRITY's `not-hit-this-round` work).
- **Modify** `src/utils/combat/triggers.ts` — `buildActorConditionContext` (lives HERE, ~670, not a standalone file) + `buildDrainContext` (~723) threading; `IntentExecContext` fields (`enemyWithHighestAttack`, `oncePerRoundConsumed`, `firstActivatorId`); debuff-executor proc gate + once-per-round + target routing; `registerReactiveListeners` adjacency arg + listener filter.
- **Modify** `src/utils/combat/engine.ts` — `firstActivatorId` round-state + set-site (ALL THREE `!isTurnBlocked` turn-body gates); `oncePerRoundConsumed` Set; `highestAttackAmong` binding into both drain seams; both `registerReactiveListeners` calls pass `adjacentAllyIdsFor`.
- **Modify** `src/utils/abilities/buildEquipmentAbilities.ts` — `mkNamedDebuff` opts; `BULWARK_PROC`/`DOOMSAYER_PROC`; `BULWARK`/`DOOMSAYER` registry entries.
- **Modify** `src/utils/abilities/__tests__/equipmentCoverage.test.ts` — add both implants.
- **Create** `src/utils/combat/__tests__/cfProvokeAppliers.integration.test.ts` — Bulwark + Doomsayer end-to-end.
- **Modify** `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry.

---

## Task 1: Pure `highestAttackAmong` selector

**Files:**
- Create: `src/utils/combat/highestAttack.ts`
- Test: `src/utils/combat/__tests__/highestAttack.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { highestAttackAmong } from '../highestAttack';

describe('highestAttackAmong', () => {
    const attackOf = (id: string) => ({ a: 100, b: 250, c: 250, d: 50 })[id] ?? 0;
    const living = (dead: string[]) => (id: string) => !dead.includes(id);

    it('returns the id with the greatest attack', () => {
        expect(highestAttackAmong(['a', 'b', 'd'], attackOf, living([]))).toBe('b');
    });

    it('breaks ties by roster order (first wins)', () => {
        expect(highestAttackAmong(['a', 'b', 'c'], attackOf, living([]))).toBe('b');
    });

    it('skips dead actors', () => {
        expect(highestAttackAmong(['b', 'c'], attackOf, living(['b']))).toBe('c');
    });

    it('returns undefined when no living candidate', () => {
        expect(highestAttackAmong(['a', 'b'], attackOf, living(['a', 'b']))).toBeUndefined();
        expect(highestAttackAmong([], attackOf, living([]))).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/highestAttack.test.ts`
Expected: FAIL — cannot find module `../highestAttack`.

- [ ] **Step 3: Implement**

```typescript
/**
 * D-PR14: pick the living actor id with the greatest (live, effective) attack from `ids`.
 * Ties resolve to the FIRST in `ids` order (deterministic for goldens). Returns undefined
 * when no living candidate exists. Pure — the caller supplies live attack + liveness, so the
 * engine wires effectiveStatsOf / destroyedRound and this stays unit-testable (mirrors
 * incomingEffects.ts / outgoingEffects.ts).
 */
export function highestAttackAmong(
    ids: string[],
    attackOf: (id: string) => number,
    isLiving: (id: string) => boolean
): string | undefined {
    let best: string | undefined;
    let bestAtk = -Infinity;
    for (const id of ids) {
        if (!isLiving(id)) continue;
        const atk = attackOf(id);
        if (atk > bestAtk) {
            bestAtk = atk;
            best = id;
        }
    }
    return best;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/highestAttack.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/highestAttack.ts src/utils/combat/__tests__/highestAttack.test.ts
git commit --no-verify -m "feat(combat): D-PR14 — pure highestAttackAmong selector"
```

---

## Task 2: Type additions

**Files:**
- Modify: `src/types/abilities.ts`

These are pure type additions; the compiler is the test (later tasks consume them). No new runtime behavior here.

- [ ] **Step 1: Add the `AbilityTarget` value**

At `abilities.ts:38`, after `| 'enemy-most-buffs'`:

```typescript
    | 'enemy-most-buffs'
    | 'enemy-highest-attack'; // D-PR14 Doomsayer: living opposing actor with the greatest
    //                           live effective attack (global selector, resolved at drain).
```

- [ ] **Step 2: Add the two optional `Ability` fields**

Near `roleFilter?` (`abilities.ts:425`), add:

```typescript
    /** D-PR14 Bulwark: this reactive applies at most once per round per (owner, ability).
     *  Gated executor-side via IntentExecContext.oncePerRoundConsumed (check BEFORE the
     *  proc draw, mark only on a successful proc). Absent → no per-round limit. */
    oncePerRound?: boolean;
    /** D-PR14 Bulwark: an on-ally-attacked reactive fires only when the DAMAGED ally is
     *  adjacent to this owner (board neighbours; non-positional → any living same-side ally).
     *  Filtered in the listener via registerReactiveListeners' adjacentAllyIdsFor. Absent →
     *  any ally (existing behavior). */
    requireDamagedAllyAdjacent?: boolean;
```

- [ ] **Step 3: Add the `ConditionSubject` value**

At the `ConditionSubject` union (`abilities.ts:126`), add:

```typescript
    | 'first-activator' // D-PR14 Doomsayer: this owner was the first actor to take a REAL
    //                     (non-Stasis/Disable-skipped) turn this round.
```

- [ ] **Step 4: Run tsc, confirm what breaks**

Run: `npx tsc --noEmit`
Expected: in this codebase there is **no `switch` over `AbilityTarget`** and `evaluateCondition` has a `default` branch, so the new members likely produce **NO** tsc errors. Whatever errors DO appear are exhaustive `switch`/`Record` sites missing the new member (e.g. editor UI `AbilityCard`/`AbilityTypePicker`/`abilityDefaults`). **Record every such location.** If none, proceed (the editor-stub concern is moot).

- [ ] **Step 5: Add minimal stubs ONLY where tsc errors**

For each tsc error, add the minimal case to satisfy exhaustiveness, mirroring the neighbouring `'enemy-most-buffs'` handling (no behavior). If Step 4 produced no errors, skip this step.

- [ ] **Step 6: Commit**

```bash
git add src/types/abilities.ts
# plus any editor files touched in Step 5
git commit --no-verify -m "feat(combat): D-PR14 — types (enemy-highest-attack target, oncePerRound/adjacency ability fields, first-activator condition)"
```

---

## Task 3: `first-activator` condition evaluation + context threading

**Files:**
- Modify: `src/utils/abilities/evaluateConditions.ts` (`ConditionContext.firstActivator` + `evaluateCondition` case)
- Modify: `src/utils/abilities/roundContext.ts` (`buildRoundContext` state param + return — the REAL constructor)
- Modify: `src/utils/combat/abilityStatusGating.ts` (`LIVE_SUBJECTS += 'first-activator'`)
- Modify: `src/utils/combat/triggers.ts` (`buildActorConditionContext` ~670 + `buildDrainContext` ~723 + `IntentExecContext.firstActivatorId`)
- Test: create `src/utils/abilities/__tests__/firstActivatorCondition.test.ts`

> **Threading chain (mirror `wasHitThisRound` end-to-end):** `IntentExecContext.firstActivatorId` → `buildDrainContext` computes `firstActivator: ctx.firstActivatorId === ownerId` → `buildActorConditionContext` options bag → `buildRoundContext` `state` param → `buildRoundContext` return → `ConditionContext.firstActivator` → `evaluateCondition`. AND `LIVE_SUBJECTS` must include `'first-activator'` or `liveGateConditions` neutralizes it to `always`. Miss ANY link and Doomsayer is silently broken (fires always, or never).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { conditionsMet } from '../evaluateConditions';
// Reuse the shared condition-context fixture if present (makeConditionContext); else inline a full ConditionContext.

describe('first-activator condition', () => {
    it('is met when firstActivator is true', () => {
        const ctx = makeConditionContext({ firstActivator: true });
        expect(conditionsMet([{ subject: 'first-activator', derivable: true }], ctx)).toBe(true);
    });
    it('is NOT met when firstActivator is false/absent', () => {
        const ctx = makeConditionContext({ firstActivator: false });
        expect(conditionsMet([{ subject: 'first-activator', derivable: true }], ctx)).toBe(false);
    });
});
```

(If no `makeConditionContext` fixture exists at `src/utils/abilities/__tests__/conditionContextFixture.ts` — created in D-PR2 — build a full `ConditionContext` literal inline.)

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run <test file>`
Expected: FAIL — `'first-activator'` not handled / `firstActivator` not on the fixture.

- [ ] **Step 3: Implement (follow the threading chain end-to-end)**

(a) `evaluateConditions.ts` — add to `ConditionContext` (after `wasHitThisRound?`):

```typescript
    firstActivator?: boolean; // D-PR14: this owner took the round's first real turn.
```

Add a case in `evaluateCondition` (mirror `'not-hit-this-round'`):

```typescript
        case 'first-activator':
            return ctx.firstActivator ? 1 : 0;
```

(b) `roundContext.ts` — `buildRoundContext`'s `state` param type: add `firstActivator?: boolean;` (next to `wasHitThisRound`); and in the returned object add `firstActivator: state.firstActivator ?? false,` (mirror the `wasHitThisRound` line exactly).

(c) `triggers.ts` `buildActorConditionContext` (~670) — it receives an options bag and forwards to `buildRoundContext`. Add `firstActivator` to the options type and forward it (mirror `wasHitThisRound`).

(d) `triggers.ts` `buildDrainContext` (~723) — add to the options object it passes:

```typescript
        firstActivator: ctx.firstActivatorId === ownerId,
```

(e) `triggers.ts` `IntentExecContext` (near `enemyWithMostBuffs`, ~634) — add:

```typescript
    /** D-PR14: id of the round's first real (non-Stasis/Disable-skipped) activator. */
    firstActivatorId?: string;
```

(f) `abilityStatusGating.ts` — add `'first-activator'` to the `LIVE_SUBJECTS` set (~`:15-29`). **Without this, `liveGateConditions` rewrites Doomsayer's gate to `always` → it fires every round it procs.**

- [ ] **Step 4: Run it, verify it passes** (+ tsc)

Run: `npx vitest run src/utils/abilities/__tests__/firstActivatorCondition.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/utils/abilities/evaluateConditions.ts src/utils/abilities/roundContext.ts src/utils/combat/abilityStatusGating.ts src/utils/combat/triggers.ts src/utils/abilities/__tests__/firstActivatorCondition.test.ts
git commit --no-verify -m "feat(combat): D-PR14 — first-activator condition (live-subject + roundContext threading)"
```

---

## Task 4: Engine round-state — `firstActivatorId`, `oncePerRoundConsumed`, `enemyWithHighestAttack` binding

**Files:**
- Modify: `src/utils/combat/engine.ts`

No standalone unit test (engine internals) — verified by tsc here and by the Task 7 integration tests. Keep changes byte-identical for non-D-PR14 paths.

- [ ] **Step 1: Declare per-round state**

In the per-round scope (the body of the `for` over rounds, BEFORE the `drainIntents`/`drainEnemyIntents` definitions at ~3438 and the turn-loop at ~3544 — confirm the round-loop boundary by reading around 3400-3440), add:

```typescript
            // D-PR14: per-round state — reset each round.
            let firstActivatorId: string | undefined;
            const oncePerRoundConsumed = new Set<string>();
```

If `drainIntents` is defined ONCE outside the round loop, instead declare both in the enclosing combat scope and add, at the top of each round iteration, `firstActivatorId = undefined; oncePerRoundConsumed.clear();`. (Read the actual structure and pick the spot that resets every round AND is visible to both the turn-loop set-site and the drain option literals.)

- [ ] **Step 2: Add the `highestAttackAmong` binding next to `mostBuffsAmong`**

Import at top of file: `import { highestAttackAmong } from './highestAttack';`

After `mostBuffsAmong` (~3437), add a thin adapter. **`effectiveStatsOf` takes THREE args** — `effectiveStatsOf(statusEngine, selfBuffLookup, actor: CombatActor)` (`effectiveStats.ts:88`); the working highest-attack idiom is at `engine.ts:2974-2975` (`effectiveStatsOf(statusEngine, selfBuffLookup, actor).attack`, and `selfBuffLookup` is in scope). Liveness = `destroyedRound === undefined`:

```typescript
            // D-PR14: living opposing actor with the greatest LIVE effective attack
            // (Doomsayer's enemy-highest-attack target). Ties → roster order.
            const highestAttackInRoster = (roster: CombatActor[]): string | undefined =>
                highestAttackAmong(
                    roster.map((a) => a.id),
                    (id) => {
                        const a = roster.find((x) => x.id === id);
                        return a ? effectiveStatsOf(statusEngine, selfBuffLookup, a).attack : 0;
                    },
                    (id) => roster.find((a) => a.id === id)?.destroyedRound === undefined
                );
```

(Confirm `effectiveStatsOf` / `selfBuffLookup` are in scope at this point — both are used at 2974; if `selfBuffLookup` is named differently here, match the 2974 call.)

- [ ] **Step 3: Bind into both drain-seam ctx literals**

In `drainIntents` (~3445), add to the options object:

```typescript
                enemyWithHighestAttack: () => highestAttackInRoster(enemyAttackerActors),
                firstActivatorId,
                oncePerRoundConsumed,
```

In `drainEnemyIntents` (~3467), add:

```typescript
                enemyWithHighestAttack: () => highestAttackInRoster(allPlayerActors),
                firstActivatorId,
                oncePerRoundConsumed,
```

(`firstActivatorId` is read inside the arrow body at call time → reads the live value. If declared in the enclosing scope as a `let`, the closure reads it live; confirm.)

- [ ] **Step 4: Set `firstActivatorId` at ALL THREE real-activation sites**

There are three `if (!isTurnBlocked(actor.id)) {` turn-body gates (attacker ~3698, walked-team ally ~3886, real-enemy ~4098). A team ally or an enemy can be the round's first activator (enemy-side Doomsayer rides the `drainEnemyIntents` seam), so set it in ALL THREE, as the FIRST statement inside each block:

```typescript
                    if (!isTurnBlocked(actor.id)) {
                        // D-PR14: first REAL activation of the round (Stasis/Disable-skipped
                        // actors never enter these blocks, so they don't count). ??= writes once.
                        firstActivatorId ??= actor.id;
                        // ... existing block body ...
```

Confirm each of the three sites with `grep -n "if (!isTurnBlocked(actor.id))" src/utils/combat/engine.ts` and add the line at the top of each. Goldens are unaffected (no fixture equips the implant); the three sites are for multi-actor / enemy-side correctness.

- [ ] **Step 5: Run tsc**

Run: `npx tsc --noEmit`
Expected: errors — `enemyWithHighestAttack`/`oncePerRoundConsumed` not yet on `IntentExecContext`. (Added in Task 5; if you want this task to compile standalone, add those two `IntentExecContext` fields here. Recommended: add the field declarations in Task 5's first step and accept that Task 4 + Task 5 compile together — note this and proceed.)

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/engine.ts
git commit --no-verify -m "feat(combat): D-PR14 — engine round-state (firstActivatorId, oncePerRoundConsumed, highest-attack binding)"
```

---

## Task 5: Debuff executor — proc gate, once-per-round, `enemy-highest-attack` routing

**Files:**
- Modify: `src/utils/combat/triggers.ts` (debuff branch at 1161 + `IntentExecContext`)

- [ ] **Step 1: Add the two `IntentExecContext` fields**

Near `enemyWithMostBuffs` (~634):

```typescript
    /** D-PR14 Doomsayer: living opposing actor with the greatest live effective attack. */
    enemyWithHighestAttack?: (ownerId: string) => string | undefined;
    /** D-PR14 Bulwark: per-(owner,ability) once-per-round consume set (reset each round in engine). */
    oncePerRoundConsumed?: Set<string>;
```

- [ ] **Step 2: Add proc gate + once-per-round + target routing to the debuff branch**

Replace the head of the `if (cfg.type === 'debuff') {` branch (1161) and its `counterTargetId` computation. The new branch body opens:

```typescript
    if (cfg.type === 'debuff') {
        // D-PR14: once-per-round gate (Bulwark) — check consumed BEFORE drawing the proc gate,
        // so a failed roll never locks the round (mirrors D-PR3 incoming-block invariant).
        const onceKey = `${intent.ownerId}:${intent.ability.id}`;
        if (intent.ability.oncePerRound && ctx.oncePerRoundConsumed?.has(onceKey)) return;
        // D-PR14: proc-chance gate for reactive debuff appliers (Bulwark). Pass-through when
        // procChance is undefined → BYTE-IDENTICAL for every existing debuff applier (Martyrdom).
        if (!passesProcChanceGate(intent, ctx)) return;
        // Mark consumed ONLY after a successful proc (before the landing roll — "once per round"
        // is per attempt, matching the spec's read).
        if (intent.ability.oncePerRound) ctx.oncePerRoundConsumed?.add(onceKey);

        const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
            // ... unchanged ...
        };
        // D-PR14: target resolution — enemy-highest-attack global selector (Doomsayer) else the
        // counter-infliction route (Bulwark/Warden). Existing appliers use counterTargetId → identical.
        const counterTargetId =
            intent.ability.target === 'enemy-highest-attack'
                ? ctx.enemyWithHighestAttack?.(intent.ownerId)
                : intent.eventCtx?.counterTargetId;
        // No living highest-attack enemy → no-op (don't apply to the default enemy).
        if (intent.ability.target === 'enemy-highest-attack' && counterTargetId === undefined) return;
        // ... rest of the branch (landsTimedEnemyApplication / applyTimedAbilityStatus / emits) UNCHANGED ...
```

Keep the existing `status` literal and the `if (owner.landsTimedEnemyApplication(...))` block verbatim — only the lines above the `status` literal and the `counterTargetId` computation change.

- [ ] **Step 3: tsc + full debuff-path regression**

Run: `npx tsc --noEmit && npx vitest run src/utils/combat`
Expected: tsc clean. Combat suite GREEN with ZERO golden/.snap changes (Martyrdom/Warden debuff appliers have no `procChance`/`oncePerRound`/`enemy-highest-attack` → pass-through). If any golden moves, STOP — the pass-through is broken.

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/triggers.ts
git commit --no-verify -m "feat(combat): D-PR14 — debuff executor proc gate + once-per-round + enemy-highest-attack routing"
```

---

## Task 6: Listener adjacency filter (Bulwark)

**Files:**
- Modify: `src/utils/combat/triggers.ts` (registerReactiveListeners args + on-ally-attacked listener)
- Modify: `src/utils/combat/engine.ts` (pass `adjacentAllyIdsFor` into the registerReactiveListeners call)

- [ ] **Step 1: Add the optional arg to `registerReactiveListeners`**

In the args object (`triggers.ts:218-232`), after `roleOf?`:

```typescript
    /** D-PR14 Bulwark: same-side ids adjacent to an owner (living, owner excluded; non-positional
     *  → all living same-side allies). Used to gate requireDamagedAllyAdjacent reactions. Optional:
     *  DPS/unit fixtures omit it (→ treat any ally as adjacent). */
    adjacentAllyIdsFor?: (ownerId: string) => string[];
```

Destructure it: `const { bus, perOwner, enqueue, isOpposing, roleOf, adjacentAllyIdsFor } = args;`

- [ ] **Step 2: Filter in the on-ally-attacked listener**

In the `case 'on-ally-attacked':` listener (`triggers.ts:391`), after the `roleFilter` block (line ~409) and BEFORE the `enqueue({...})`:

```typescript
                        // D-PR14 Bulwark: fire only when the DAMAGED ally is adjacent to this
                        // owner. Pure read (listener stays enqueue-only). Helper absent → allow.
                        if (
                            ra.ability.requireDamagedAllyAdjacent &&
                            adjacentAllyIdsFor &&
                            !adjacentAllyIdsFor(ownerId).includes(e.targetId)
                        ) {
                            return;
                        }
```

- [ ] **Step 3: Pass `adjacentAllyIdsFor` from BOTH engine call sites**

There are TWO `registerReactiveListeners({ ... })` calls (player ~`engine.ts:2028`, enemy ~`engine.ts:2049`; confirm via `grep -n "registerReactiveListeners" src/utils/combat/engine.ts`). Add to BOTH args objects:

```typescript
            adjacentAllyIdsFor: (ownerId: string) => adjacentAllyIds(ownerId, actors),
```

`adjacentAllyIds` is already imported (`engine.ts:83`) and is side-correct (returns same-side allies of `ownerId` regardless of which team's listeners are registered), so the same line works for both. (The per-side `bySide(...).adjacentAllyIdsFor` helper at `engine.ts:1795` is equivalent if you prefer reusing it.)

- [ ] **Step 4: tsc + combat regression**

Run: `npx tsc --noEmit && npx vitest run src/utils/combat`
Expected: tsc clean; GREEN, ZERO golden movement (no existing ability sets `requireDamagedAllyAdjacent`).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/engine.ts
git commit --no-verify -m "feat(combat): D-PR14 — on-ally-attacked adjacency filter for Bulwark"
```

---

## Task 7: Registry entries + proc tables + `mkNamedDebuff` opts

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts`
- Test: `src/utils/abilities/__tests__/equipmentCoverage.test.ts` (registry unit assertions) — full coverage update is Task 8; here add focused build assertions.

- [ ] **Step 1: Write failing registry unit tests**

Add to a new `src/utils/abilities/__tests__/cfProvokeRegistry.test.ts` (or extend equipmentCoverage):

```typescript
import { describe, it, expect } from 'vitest';
// Build a ship equipping BULWARK / DOOMSAYER at each rarity and inspect the produced ability.
// Reuse the implant-equipping helper pattern from equipmentCoverage.test.ts (makePiece + getGearPiece).

describe('D-PR14 registry — Bulwark', () => {
    it('produces a Provoke debuff: on-ally-attacked, target enemy, oncePerRound, adjacency-required, procChance per rarity', () => {
        const ab = buildBulwark('epic'); // helper: build & return the single equip-implant ability
        expect(ab.config.type).toBe('debuff');
        expect(ab.config.buffName).toBe('Provoke');
        expect(ab.trigger).toBe('on-ally-attacked');
        expect(ab.target).toBe('enemy');
        expect(ab.oncePerRound).toBe(true);
        expect(ab.requireDamagedAllyAdjacent).toBe(true);
        expect(ab.procChance).toBeCloseTo(0.12);
        expect(ab.config.duration).toBe(1);
    });
});

describe('D-PR14 registry — Doomsayer', () => {
    it('produces a Concentrate Fire debuff: end-of-round, target enemy-highest-attack, first-activator gate, procChance per rarity', () => {
        const ab = buildDoomsayer('legendary');
        expect(ab.config.buffName).toBe('Concentrate Fire');
        expect(ab.trigger).toBe('end-of-round');
        expect(ab.target).toBe('enemy-highest-attack');
        expect(ab.conditions).toContainEqual({ subject: 'first-activator', derivable: true });
        expect(ab.procChance).toBeCloseTo(0.16);
        expect(ab.config.duration).toBe(1);
    });
});
```

(Implement `buildBulwark`/`buildDoomsayer` test helpers using the same equip-and-`buildEquipmentAbilities` mechanics as `implantAbilityCount` in equipmentCoverage.test.ts, returning the single produced ability.)

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run src/utils/abilities/__tests__/cfProvokeRegistry.test.ts`
Expected: FAIL — no abilities produced (registry entries absent → count 0).

- [ ] **Step 3: Extend `mkNamedDebuff` with an opts bag**

Change `mkNamedDebuff` signature (1359-385) to accept opts (keep existing callers working — opts optional, defaults preserve current behavior):

```typescript
function mkNamedDebuff(
    buffName: string,
    trigger: AbilityTrigger,
    duration: number | undefined,
    opts?: { target?: AbilityTarget; procChance?: number; conditions?: Condition[] }
): Omit<Ability, 'id'> | undefined {
    if (duration === undefined) return undefined;
    const buff = BUFFS.find((b) => b.name === buffName);
    if (!buff) return undefined;
    const { stackable, maxStacks } = isStackable(buff.description);
    return {
        type: 'debuff',
        target: opts?.target ?? 'enemy',
        trigger,
        conditions: opts?.conditions ?? [],
        ...(opts?.procChance !== undefined ? { procChance: opts.procChance } : {}),
        config: {
            type: 'debuff',
            buffName,
            parsedEffects: parseBuffEffects(buff.name, buff.description),
            stacks: 1,
            isStackable: stackable,
            maxStacks,
            application: 'apply',
            duration,
        },
        autoFilled: true,
    };
}
```

(Martyrdom's existing call `mkNamedDebuff('Disable', 'on-destroyed', n)` is unchanged → byte-identical.)

- [ ] **Step 4: Add proc tables**

Near the other `*_PROC` tables (~217-239):

```typescript
// D-PR14: Bulwark — X% chance, when an adjacent ally is directly damaged, apply Provoke 1 turn, once per round.
const BULWARK_PROC: Record<string, number> = {
    common: 0.05,
    uncommon: 0.07,
    rare: 0.09,
    epic: 0.12,
    legendary: 0.16,
};
// D-PR14: Doomsayer — at end of round, if first to activate, X% chance to apply Concentrate Fire
// to the highest-attack enemy 1 turn. No common variant. (Proc from THIS table, not the
// description text — Doomsayer's legendary text has a "change"/"chance" typo.)
const DOOMSAYER_PROC: Record<string, number> = {
    uncommon: 0.07,
    rare: 0.09,
    epic: 0.12,
    legendary: 0.16,
};
```

- [ ] **Step 5: Add the registry entries**

In `IMPLANT_ABILITIES` (~387), add:

```typescript
    BULWARK: (rarity) => {
        const procChance = BULWARK_PROC[rarity];
        if (procChance === undefined) return undefined;
        const base = mkNamedDebuff('Provoke', 'on-ally-attacked', 1, { procChance });
        if (!base) return undefined;
        return { ...base, oncePerRound: true, requireDamagedAllyAdjacent: true };
    },
    DOOMSAYER: (rarity) => {
        const procChance = DOOMSAYER_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedDebuff('Concentrate Fire', 'end-of-round', 1, {
            procChance,
            target: 'enemy-highest-attack',
            conditions: [{ subject: 'first-activator', derivable: true }],
        });
    },
```

- [ ] **Step 6: Run the registry tests + tsc**

Run: `npx vitest run src/utils/abilities/__tests__/cfProvokeRegistry.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/cfProvokeRegistry.test.ts
git commit --no-verify -m "feat(combat): D-PR14 — Bulwark + Doomsayer registry entries + proc tables"
```

---

## Task 8: Engine integration tests (Bulwark + Doomsayer end-to-end)

**Files:**
- Create: `src/utils/combat/__tests__/cfProvokeAppliers.integration.test.ts`

Use an existing two-team `simulateBattle` integration test as the template (search `src/utils/combat/__tests__` for tests that build two real teams + pass `getGearPiece`, e.g. the D-PR3/D-PR4 incoming/outgoing integration tests). Equip the implant via `getGearPiece` (implant `setBonus` = implant NAME, `rarity` picks the variant). Force procs by using a rarity whose `procChance` makes the deterministic accumulator fire on the first eligible event (or assert across enough events that the deterministic gate fires); follow the proc-forcing pattern the prior D integration tests use.

- [ ] **Step 1: Write the tests**

```typescript
describe('D-PR14 Bulwark (Provoke on adjacent-ally damage)', () => {
    it('applies Provoke to the attacker when an adjacent ally is directly damaged', () => {
        // two-team sim, Bulwark on a player ship adjacent to the hit ally;
        // assert provokerOf(statusEngine, attackerId) === bulwarkOwnerId after the hit.
    });
    it('does NOT fire when the damaged ally is not adjacent (positional)', () => {
        // position Bulwark owner away from the hit ally; assert no Provoke applied.
    });
    it('applies at most once per round', () => {
        // two adjacent-ally hits in one round; assert Provoke applied once (gate consumed).
    });
});

describe('D-PR14 Doomsayer (Concentrate Fire on highest-attack enemy at end of round)', () => {
    it('applies Concentrate Fire to the highest-attack enemy when the owner is first activator', () => {
        // Doomsayer owner is fastest (first to act) + proc forced; assert CF on the
        // highest-effective-attack enemy at end of round (read via ownerDebuffNamesFor / targeting).
    });
    it('does NOT apply when the owner is not the first activator', () => {
        // make another actor (team ally) faster so it activates first; assert no CF from Doomsayer.
        // This also exercises the walked-team-ally firstActivatorId set-site (~3886).
    });
    it('works for an ENEMY-side Doomsayer that activates first', () => {
        // Doomsayer on an enemy ship, fastest overall; assert CF applied to the highest-attack
        // PLAYER actor. Exercises the real-enemy set-site (~4098) + drainEnemyIntents seam.
    });
});
```

- [ ] **Step 2: Run, verify behavior**

Run: `npx vitest run src/utils/combat/__tests__/cfProvokeAppliers.integration.test.ts`
Expected: PASS. If the proc/first-activator gating doesn't fire as expected, debug via `superpowers:systematic-debugging` (likely a `liveGateConditions` stripping `first-activator`, or the adjacency helper not threaded — verify against Task 3/6).

- [ ] **Step 3: Commit**

```bash
git add src/utils/combat/__tests__/cfProvokeAppliers.integration.test.ts
git commit --no-verify -m "test(combat): D-PR14 — Bulwark + Doomsayer integration tests"
```

---

## Task 9: Coverage tracker + changelog + full-suite/golden verification

**Files:**
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts`
- Modify: `src/constants/changelog.ts`

- [ ] **Step 1: Update the coverage assertion**

In `equipmentCoverage.test.ts`, insert `'BULWARK'` and `'DOOMSAYER'` into the implemented-implants `toEqual([...])` array at their `IMPLANTS` declaration-order positions (between `'BLOODTHIRST'` and `'EXUBERANCE'` — confirm exact order against `constants/implants.ts`; if Bulwark/Doomsayer declare before Bloodthirst, place accordingly). Add per-rarity `it(...)` assertions mirroring SPEARHEAD's `for (const v of IMPLANTS['SPEARHEAD'].variants) expect(implantAbilityCount('SPEARHEAD', v.rarity)).toBe(1)`:

```typescript
    it('BULWARK produces 1 Provoke debuff per rarity (on-ally-attacked, once-per-round, procChance)', () => {
        for (const v of IMPLANTS['BULWARK'].variants) {
            expect(implantAbilityCount('BULWARK', v.rarity)).toBe(1);
        }
    });
    it('DOOMSAYER produces 1 Concentrate Fire debuff per rarity (end-of-round, first-activator, procChance)', () => {
        for (const v of IMPLANTS['DOOMSAYER'].variants) {
            expect(implantAbilityCount('DOOMSAYER', v.rarity)).toBe(1);
        }
    });
```

Remove BULWARK/DOOMSAYER from the "unimplemented → 0 abilities" assertions if they were explicitly listed there.

- [ ] **Step 2: Add the changelog entry**

In `src/constants/changelog.ts`, add to `UNRELEASED_CHANGES` (plain English, user-facing):

```
'Combat sim: Bulwark implants now apply Provoke to an enemy that damages a nearby ally, and Doomsayer implants apply Concentrate Fire to the strongest enemy at the end of the round.'
```

(Match the exact array/format of neighbouring entries.)

- [ ] **Step 3: Full suite + lint + tsc + audit**

Run:
```bash
npx vitest run
npx tsc --noEmit
npm run lint
npm run audit:skills   # if present in this repo's scripts; else skip
```
Expected: ALL tests GREEN, **ZERO golden/.snap movement** (no fixture equips these implants — confirm `git status` shows no `.snap` / golden changes), tsc clean, lint clean (max-warnings 0).

- [ ] **Step 4: Commit**

```bash
git add src/utils/abilities/__tests__/equipmentCoverage.test.ts src/constants/changelog.ts
git commit --no-verify -m "feat(combat): D-PR14 — coverage tracker + changelog for Bulwark/Doomsayer"
```

---

## Final verification & handoff

- [ ] **Verify** the whole suite is green with no golden movement: `npx vitest run` + `git status` clean of `.snap`.
- [ ] **Verify** `npx tsc --noEmit` and `npm run lint` clean.
- [ ] **Self-review** the diff for the byte-identical claims: the debuff-branch proc gate + once-per-round + target routing collapse to the prior code when `procChance`/`oncePerRound`/`enemy-highest-attack` are all absent; the adjacency filter is inert without `requireDamagedAllyAdjacent`.
- [ ] **Push** the branch and open the PR stacked on D-PR13 (`gh pr create --base feat/combat-d-pr13-disable-turn-skip`), per the D-stack strategy. Use `gh auth switch --user TheSusort` first if needed.

---

## Notes / gotchas

- **`git commit --no-verify`**: the pre-commit hook runs the full vitest suite; use `--no-verify` for incremental commits and rely on the explicit per-task test runs. Run the full suite once at Task 9.
- **Byte-identical invariant**: every executor change is gated on a new optional field (`procChance`/`oncePerRound`/`requireDamagedAllyAdjacent`/`target === 'enemy-highest-attack'`). If ANY existing golden moves, a gate's pass-through is broken — stop and fix before continuing.
- **`liveGateConditions` (REQUIRED, Task 3f)**: `first-activator` MUST be added to `LIVE_SUBJECTS` in `abilityStatusGating.ts`. Otherwise the gate is rewritten to `always` and Doomsayer fires every round it procs (ALACRITY's `not-hit-this-round` only works because it IS in that set).
- **Doomsayer threading is fragile**: the field flows through SIX hops (IntentExecContext → buildDrainContext → buildActorConditionContext → buildRoundContext state → buildRoundContext return → ConditionContext) plus LIVE_SUBJECTS. Miss any hop → Doomsayer fires always or never. The integration tests (Task 8) are what catch a broken hop — do not skip them.
- **Decrement-timing**: a "1 turn" Provoke/CF may expire after one observable enemy turn (locked behavior; not changed here).
- **DPS calculator page**: intentionally NOT wired — both effects are targeting debuffs that matter only in the battle sim.
