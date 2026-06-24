# Charge Foundation (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make charge a signed, two-sided, gateable resource in the combat engine — adding a per-actor turn counter, an `every-n-turns` condition, an `end-of-turn` trigger, enemy-targeted charge removal (floored, immunity-gated), and a charge-loss-immunity flag — so the four charge feature phases can be built on top.

**Architecture:** Pure additive primitives. New `CombatActor` fields (`turnsTaken`, `chargeLossImmune`); a new `ConditionSubject` (`every-n-turns`) evaluated via the existing `evaluateCondition` machinery with `turnsTaken` threaded into the condition context; a new `AbilityTrigger` (`end-of-turn`) riding the **existing** `turn-ended` event; and an enemy-subtract branch in the two charge-application sites plus a `removeEnemyCharges` side-closure mirroring `grantAllyCharges`. No behavior changes for existing fixtures — every default keeps current goldens byte-identical.

**Tech Stack:** React 18, TypeScript, Vitest. Combat engine in `src/utils/combat/`, ability model in `src/types/abilities.ts` + `src/utils/abilities/`.

**Spec:** `docs/superpowers/specs/2026-06-23-charge-generation-manipulation-design.md`

**Workflow notes (project rules):**
- Run tests with `npm test`. **Never** run `vitest -u` to bless golden snapshots blindly — inspect every `.snap` diff and confirm it is the intended change.
- Git/PR ops use the `TheSusort` account: `gh auth switch --user TheSusort`.
- Commit message footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- `npm run lint` is `--max-warnings 0`; run it before each commit.

---

## File Structure

- `src/utils/combat/state.ts` — `CombatActor` interface + `createActor` (Task 1).
- `src/types/abilities.ts` — `AbilityTrigger` + `LIVE_TRIGGERS`; `ConditionSubject` + `Condition` fields (Tasks 2, 3).
- `src/utils/abilities/evaluateConditions.ts` — `ConditionContext` field + `evaluateCondition` case (Task 2).
- `src/utils/abilities/roundContext.ts` — `buildRoundContext` default (Task 2).
- `src/utils/combat/triggers.ts` — `end-of-turn` listener; `turnsTakenFor` drain threading; executor enemy-charge branch (Tasks 3, 4, 7).
- `src/utils/combat/engine.ts` — `turnsTaken` increment; `removeEnemyCharges` side-closure; delegate population (Tasks 5, 7).
- `src/utils/abilities/buildShipAbilities.ts` + `src/types/abilities.ts` (ShipSkills type, defined at `:504`) + `src/utils/calculators/battleSimulator.ts` — `chargeLossImmune` derivation + threading (Task 6).

---

### Task 1: Add `turnsTaken` + `chargeLossImmune` to the combat actor

**Files:**
- Modify: `src/utils/combat/state.ts:99-137` (`CombatActor`), `:139-171` (`createActor`)
- Test: `src/utils/combat/__tests__/actorStats.test.ts` (or a new `chargeFoundation.test.ts`)

- [ ] **Step 1: Write the failing test**

```ts
import { createActor } from '../state';

it('createActor seeds turnsTaken to 0 and chargeLossImmune to false', () => {
    const a = createActor({
        id: 'x', side: 'player', kind: 'attacker',
        stats: { hp: 100, attack: 10, defence: 0, hacking: 0, security: 0, crit: 0, critDamage: 0, speed: 100 } as never,
    });
    expect(a.turnsTaken).toBe(0);
    expect(a.chargeLossImmune).toBe(false);
});

it('createActor honors chargeLossImmune passthrough', () => {
    const a = createActor({
        id: 'x', side: 'player', kind: 'attacker',
        stats: { hp: 100, attack: 10, defence: 0, hacking: 0, security: 0, crit: 0, critDamage: 0, speed: 100 } as never,
        chargeLossImmune: true,
    });
    expect(a.chargeLossImmune).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/combat/__tests__/actorStats.test.ts`
Expected: FAIL — `turnsTaken`/`chargeLossImmune` undefined; `chargeLossImmune` not accepted by `createActor`.

- [ ] **Step 3: Implement**

In `CombatActor` (after `chargeCount`, ~state.ts:113):
```ts
    /** Per-actor own-turn counter. Starts at 0; incremented at the actor's turn-start
     *  (engine.ts turn-started emit). Drives the `every-n-turns` condition (Chrono Reaver). */
    turnsTaken: number;
    /** When true, enemy-sourced charge removal is a no-op against this actor
     *  ("immune to charge loss effects"). Derived from ship skill text. */
    chargeLossImmune: boolean;
```

In `createActor`'s param object type (~state.ts:142-149) add `chargeLossImmune?: boolean;`. In the returned object add:
```ts
        turnsTaken: 0,
        chargeLossImmune: partial.chargeLossImmune ?? false,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/combat/__tests__/actorStats.test.ts` → PASS.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/utils/combat/state.ts src/utils/combat/__tests__/actorStats.test.ts
git commit -m "feat(combat): add turnsTaken + chargeLossImmune to CombatActor"
```

---

### Task 2: Add the `every-n-turns` condition

**Files:**
- Modify: `src/types/abilities.ts:146-197` (`ConditionSubject`), `:199-222` (`Condition`)
- Modify: `src/utils/abilities/evaluateConditions.ts:4-41` (`ConditionContext`), `:44-101` (`evaluateCondition`)
- Modify: `src/utils/abilities/roundContext.ts` (default)
- Test: `src/utils/abilities/__tests__/evaluateConditions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { evaluateCondition } from '../evaluateConditions';
import { makeConditionContext } from './conditionContextFixture'; // takes Partial<ConditionContext>

describe('every-n-turns condition', () => {
    const cond = (period: number, offset?: number) =>
        ({ subject: 'every-n-turns', derivable: true, period, offset }) as const;

    it('period 2 (offset 0) is met on even turn counts', () => {
        expect(evaluateCondition(cond(2), makeConditionContext({ turnsTaken: 2 }))).toBe(1);
        expect(evaluateCondition(cond(2), makeConditionContext({ turnsTaken: 4 }))).toBe(1);
        expect(evaluateCondition(cond(2), makeConditionContext({ turnsTaken: 1 }))).toBe(0);
        expect(evaluateCondition(cond(2), makeConditionContext({ turnsTaken: 3 }))).toBe(0);
    });

    it('period 3 is met on turns 3,6 only', () => {
        expect(evaluateCondition(cond(3), makeConditionContext({ turnsTaken: 3 }))).toBe(1);
        expect(evaluateCondition(cond(3), makeConditionContext({ turnsTaken: 6 }))).toBe(1);
        expect(evaluateCondition(cond(3), makeConditionContext({ turnsTaken: 2 }))).toBe(0);
    });

    it('turn 0 (no turn taken yet) never procs', () => {
        // turnsTaken defaults to 0; the impl guards t <= 0 so "every Nth turn" requires
        // at least one turn taken. (Engine never evaluates an end-of-turn intent at
        // turnsTaken 0 anyway — turnsTaken is bumped at turn-start before the turn body.)
        expect(evaluateCondition(cond(2), makeConditionContext({}))).toBe(0);
        expect(evaluateCondition(cond(1), makeConditionContext({ turnsTaken: 0 }))).toBe(0);
    });
});
```

`makeConditionContext` takes `Partial<ConditionContext>`, so once `turnsTaken?` is added to `ConditionContext` in Step 3, `makeConditionContext({ turnsTaken: 2 })` type-checks for free — no helper change needed.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/utils/abilities/__tests__/evaluateConditions.test.ts` → FAIL (subject not handled → returns 0 for all, or type error).

- [ ] **Step 3: Implement**

`abilities.ts` — add to `ConditionSubject` union (with doc comment):
```ts
    // Binary periodic gate: met when the owner's own-turn counter satisfies
    // turnsTaken % period === (offset ?? 0). period/offset live on Condition.
    // Used by Chrono Reaver (every other/third turn). Always derivable:true.
    | 'every-n-turns'
```
`abilities.ts` — add to `Condition` interface:
```ts
    /** For 'every-n-turns': the modulo period (e.g. 2 = every other turn). */
    period?: number;
    /** For 'every-n-turns': the residue to match (default 0). */
    offset?: number;
```

`evaluateConditions.ts` — add to `ConditionContext`:
```ts
    /** The condition owner's own-turn counter (CombatActor.turnsTaken). Live-derived by
     *  the engine drain context; defaults 0 (DPS / no-delegate → period>=2 never met). */
    turnsTaken?: number;
```
`evaluateConditions.ts` — add a `case` in `evaluateCondition` (before `default`):
```ts
        case 'every-n-turns': {
            const period = cond.period ?? 1;
            const t = ctx.turnsTaken ?? 0;
            // Require at least one turn taken — "every Nth turn" is undefined at turn 0,
            // and turn 0 % anything === 0 would otherwise spuriously proc.
            if (period <= 0 || t <= 0) return 0;
            return t % period === (cond.offset ?? 0) ? 1 : 0;
        }
```

`roundContext.ts` — add `turnsTaken?: number;` to the `state` param and `turnsTaken: state.turnsTaken ?? 0,` to the returned context (default keeps DPS inert).

- [ ] **Step 4: Run to verify it passes** → PASS.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/types/abilities.ts src/utils/abilities/evaluateConditions.ts src/utils/abilities/roundContext.ts src/utils/abilities/__tests__/
git commit -m "feat(combat): add every-n-turns condition subject"
```

---

### Task 3: Add the `end-of-turn` trigger riding `turn-ended`

**Files:**
- Modify: `src/types/abilities.ts:48-100` (`AbilityTrigger`), `:110-144` (`LIVE_TRIGGERS`)
- Modify: `src/utils/combat/triggers.ts:377-384` (add a sibling `case` after `start-of-turn`)
- Test: `src/utils/combat/__tests__/` — a focused reactive test (model on the existing `start-of-turn` coverage; grep tests for `'start-of-turn'` to find the closest fixture).

- [ ] **Step 1: Write the failing test**

A test that registers an owner with an `end-of-turn` charge ability and asserts the intent enqueues when the engine emits `turn-ended` for that owner (and does NOT enqueue on another actor's `turn-ended`). If a unit-level harness for `registerReactiveListeners` exists (used by `start-of-turn`), mirror it; otherwise assert via an engine integration golden in Task 5 and keep this task to the type + listener wiring with a compile/`LIVE_TRIGGERS` membership assertion:

```ts
import { LIVE_TRIGGERS } from '../../../types/abilities';
it('end-of-turn is a live trigger', () => {
    expect(LIVE_TRIGGERS.has('end-of-turn')).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (`end-of-turn` not in the set / not a valid union member).

- [ ] **Step 3: Implement**

`abilities.ts` — add to `AbilityTrigger` (near `start-of-turn`):
```ts
    // Fires at the OWNER's own turn-END (rides the existing per-actor `turn-ended`
    // event, self-scoped on actorId === ownerId). Mirror of `start-of-turn`. Used by
    // Chrono Reaver (end-of-turn + every-n-turns charge gain).
    | 'end-of-turn'
```
`abilities.ts` — add `'end-of-turn',` to `LIVE_TRIGGERS`.

`triggers.ts` — add after the `start-of-turn` case (`:384`):
```ts
                case 'end-of-turn':
                    bus.on('turn-ended', (e) => {
                        // Self-scoped: THIS owner's own turn ended. turn-ended fires once per
                        // actor (engine.ts:4584), so the ownerId guard scopes it per owner.
                        if (e.actorId === ownerId) enqueue(intent);
                    });
                    break;
```

> **Timing note (not same-instant as start-of-turn):** `turn-ended` is emitted at engine.ts:4584, which is AFTER that turn's per-turn drain (`drainIntents`/`drainEnemyIntents` ~:4556) and after `advanceChargeCadence`. So an enqueued end-of-turn intent does **not** drain at the owner's own turn-end — it sits in the queue until the next per-turn drain (next actor) or the round-tail drain. This is correct and intended: `turnsTaken` is only bumped at the owner's *next* turn-start, so by the time the deferred drain runs, `turnsTakenFor(ownerId)` still reads N and the `every-n-turns` gate evaluates `N % period` (banking toward future turns, per spec). Unlike `start-of-turn` (drained the same turn at ~:4556), end-of-turn is deferred — don't expect same-instant charge application.

- [ ] **Step 4: Run to verify it passes** → PASS.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/types/abilities.ts src/utils/combat/triggers.ts src/utils/combat/__tests__/
git commit -m "feat(combat): add end-of-turn trigger riding turn-ended"
```

---

### Task 4: Thread `turnsTaken` into the drain condition context

**Files:**
- Modify: `src/utils/combat/triggers.ts` — `IntentExecContext` (~`:660-705`, near `wasHitThisRoundFor`), `buildDrainContext` (`:806-851`), and `buildActorConditionContext` (same module — find its definition and add a `turnsTaken` option threaded into the returned `ConditionContext`).
- Test: covered by Task 5's engine integration golden (the delegate is engine-populated; a unit test here would duplicate Task 2 + Task 5).

- [ ] **Step 1: Add the delegate to `IntentExecContext`** (mirror `wasHitThisRoundFor`, ~triggers.ts:687):
```ts
    /** The owner's current own-turn counter (CombatActor.turnsTaken). Engine-populated;
     *  absent in DPS mode → defaults 0 (every-n-turns inert). */
    turnsTakenFor?: (ownerId: string) => number;
```

- [ ] **Step 2: Pass it through `buildDrainContext`** (add to the `buildActorConditionContext(...)` options block, ~triggers.ts:849):
```ts
        // every-n-turns gate (Chrono Reaver). Default 0 → DPS / no-delegate paths read 0 and
        // stay byte-identical (period>=2 never met).
        turnsTaken: ctx.turnsTakenFor?.(ownerId) ?? 0,
```

- [ ] **Step 3: Thread the option through `buildActorConditionContext`** — add `turnsTaken?: number` to its options type and `turnsTaken: opts.turnsTaken ?? 0` (or pass into `buildRoundContext`) so it lands on the returned `ConditionContext`.

- [ ] **Step 4: Run the full suite to confirm no golden drift**

Run: `npm test`
Expected: PASS, **zero** `.snap` changes (every default is 0 / unchanged).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/utils/combat/triggers.ts
git commit -m "feat(combat): thread turnsTaken into drain condition context"
```

---

### Task 5: Increment `turnsTaken` per turn + populate the delegate + integration golden

**Files:**
- Modify: `src/utils/combat/engine.ts:3659` (increment at `turn-started` emit), and the shared drain-queue context block where `wasHitThisRoundFor` is populated (`:3435`) to supply `turnsTakenFor`. (The combat-wide actor lookup is `allActorsById`, engine.ts:1701. The cast-path block at `:3140` is the firing context, not a drain context — it does NOT receive these delegates, so no change there.)
- Test: `src/utils/combat/__tests__/chargeEveryNTurns.integration.test.ts` (new)

- [ ] **Step 1: Write the failing integration test**

Build a single-attacker engine run (follow an existing integration test in `__tests__/` for the harness — e.g. how `enemyActorRuntime.test.ts` or a charge test sets up `ShipSkills`) whose passive carries one ability: `{ type: 'charge', amount: 1, target: 'self', trigger: 'end-of-turn', conditions: [{ subject: 'every-n-turns', derivable: true, period: 2, offset: 0 }] }`, on a ship with `chargeCount: 5` and no charged-skill firing in the window. Assert the actor's banked `charges` after N turns matches **baseline (+1/turn) plus the every-2nd-turn proc**:

| End of own turn | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| baseline cadence (+1/turn) | 1 | 2 | 3 | 4 |
| every-n-turns(2) proc | – | +1 | – | +1 |
| **banked charges** | 1 | 3 | 4 | 6→capped 5 |

Assert charges at end of turn 2 === 3 (baseline 2 + proc 1), confirming the proc fires on the even turn and not the odd. (Pick `chargeCount` high enough that no charged fire/reset happens inside the asserted window, so the arithmetic is clean.)

- [ ] **Step 2: Run to verify it fails** → FAIL (`turnsTaken` never advances → proc never fires → charges low by the proc count).

- [ ] **Step 3: Implement**

After `bus.emit({ type: 'turn-started', actorId: actor.id, round: r });` (engine.ts:3659):
```ts
                actor.turnsTaken += 1;
```
Add `turnsTakenFor: (ownerId) => allActorsById.get(ownerId)?.turnsTaken ?? 0` to the shared drain-queue context block that already sets `wasHitThisRoundFor` (engine.ts:3435). `allActorsById` (engine.ts:1701) is combat-wide and in scope there. `turnsTaken` is per-actor and combat-wide, so a single shared closure covers both sides — mirror `wasHitThisRoundFor`, not the per-side `firstActivatorId`.

- [ ] **Step 4: Run to verify it passes** → PASS. Then run `npm test` and confirm **no unintended `.snap` drift** (inspect any diff; a turn counter alone should not change existing goldens).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/utils/combat/engine.ts src/utils/combat/__tests__/chargeEveryNTurns.integration.test.ts
git commit -m "feat(combat): increment per-actor turnsTaken + wire every-n-turns engine gate"
```

---

### Task 6: Derive `chargeLossImmune` from ship skill text

**Files:**
- Modify: `src/types/abilities.ts:504` (`ShipSkills` type — add `chargeLossImmune?: boolean` next to `doesntBreakStasis?` at `:509`)
- Modify: `src/utils/abilities/buildShipAbilities.ts:1648-1652` area (the §4.5 don't-break-Stasis scan — add a sibling scan for the charge-loss-immunity clause)
- Modify: `src/utils/calculators/battleSimulator.ts:630-715` (thread `chargeLossImmune` from `shipSkills` into the `createActor` inputs, mirror `doesntBreakStasis`)
- Modify: `src/utils/combat/engine.ts:466/485-486, 1203/1221-1222, 1267/1295-1296` (pass the input flag into each `createActor` call alongside `doesntBreakStasis`)
- Test: `src/utils/abilities/__tests__/buildShipAbilities.test.ts` (or the skill-parse test that covers `doesntBreakStasis`)

- [ ] **Step 1: Write the failing test**

```ts
it('sets chargeLossImmune from "immune to charge loss effects" skill text', () => {
    const skills = buildShipAbilities(/* a ship whose passive includes "This Unit is immune to charge loss effects." */);
    expect(skills.chargeLossImmune).toBe(true);
});
it('leaves chargeLossImmune false when no such clause', () => {
    const skills = buildShipAbilities(/* a plain ship */);
    expect(skills.chargeLossImmune).toBeFalsy();
});
```

Use the real in-game text (`src/constants/ships.ts:1128` — `"immune to charge loss effects"`). Find the actual ship name there for the fixture.

- [ ] **Step 2: Run to verify it fails** → FAIL (`chargeLossImmune` undefined).

- [ ] **Step 3: Implement**

Mirror the `doesntBreakStasis` derivation at buildShipAbilities.ts:1648-1652 — scan all skill rows for `/immune to charge[- ]?loss/i` and set `shipSkills.chargeLossImmune = true`. Add the field to the `ShipSkills` type in `src/types/abilities.ts:504` (next to `doesntBreakStasis?` at `:509`). Thread it through `battleSimulator.ts` (the three `doesntBreakStasis` lines at `:631/:658/:715`) (alongside the three `doesntBreakStasis: plan/focus.shipSkills.doesntBreakStasis` lines) into the actor-input objects, and pass `chargeLossImmune: <input>.chargeLossImmune` into each `createActor` call in engine.ts (sibling to the `doesntBreakStasis:` lines at :486, :1222, :1296).

- [ ] **Step 4: Run to verify it passes** → PASS. Run `npm test` (no golden drift — flag is inert until Task 7 consumes it).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/types/abilities.ts src/utils/abilities/buildShipAbilities.ts src/utils/calculators/battleSimulator.ts src/utils/combat/engine.ts src/utils/abilities/__tests__/
git commit -m "feat(combat): derive chargeLossImmune from skill text"
```

---

### Task 7: Enemy-targeted charge removal (subtract, floor 0, immunity-gated)

**Files:**
- Modify: `src/utils/combat/engine.ts:1776` area — add a `removeEnemyCharges` side-closure to `SideContext` (mirror `grantAllyCharges`), and populate it on `IntentExecContext` at the call sites that pass `grantAllyCharges` (`:3140, :3360, :3492, :3518`).
- Modify: `src/utils/combat/triggers.ts:622-625` (`IntentExecContext` — add `removeEnemyCharges`), `:1167-1178` (executor charge branch — route enemy targets).
- Modify: `src/utils/combat/playerTurn.ts:1307-1341` (cast-path charge step — route enemy targets through the same delegate, so an on-cast enemy-removal ability works in Phase 1).
- Test: `src/utils/combat/__tests__/enemyChargeRemoval.integration.test.ts` (new) + a focused executor unit test.

- [ ] **Step 1: Write the failing test(s)**

Integration: a player ship whose active skill carries `{ type: 'charge', amount: 2, target: 'enemy', trigger: 'on-cast', conditions: [] }`, against an enemy seeded with `charges: 3` (and `chargeCount >= 3`). After the player's cast, assert enemy `charges === 1` (3 − 2). A second case: enemy `charges: 1`, removal 2 → floored to `0`. A third case: enemy with `chargeLossImmune: true` → `charges` unchanged.

- [ ] **Step 2: Run to verify it fails** → FAIL (enemy charge untouched — no enemy-target branch).

- [ ] **Step 3: Implement**

`engine.ts` — in `buildSideContext` (alongside `grantAllyCharges`, :1776), add a closure that operates on the **opposing** side's actors:
```ts
            // Enemy-targeted charge removal: subtract from each opposing actor, floored at 0,
            // skipping immune actors and those with no charged skill. Mirror of grantAllyCharges
            // but on the opposing side, and subtractive.
            removeEnemyCharges: (amount: number): void => {
                for (const a of actorsBySide(side === 'player' ? 'enemy' : 'player')) {
                    if (a.chargeCount <= 0 || a.chargeLossImmune) continue;
                    a.charges = Math.max(0, a.charges - amount);
                }
            },
```
Add `removeEnemyCharges: (amount: number) => void;` to the `SideContext` type and to `IntentExecContext` (triggers.ts, near `grantAllyCharges`). Populate it at every site that already passes `grantAllyCharges` (engine.ts :3140, :3360, :3492, :3518) via `bySide(...).removeEnemyCharges` / `sideCtx.removeEnemyCharges`.

`triggers.ts` executor charge branch (:1167) — route enemy targets before the self/ally handling:
```ts
    if (cfg.type === 'charge') {
        if (intent.ability.target === 'enemy' || intent.ability.target === 'all-enemies') {
            ctx.removeEnemyCharges(cfg.amount);
            return;
        }
        if (intent.ability.target === 'ally' || intent.ability.target === 'all-allies') {
            ctx.grantAllyCharges(cfg.amount);
            return;
        }
        if (owner.actor.chargeCount === 0) return;
        owner.actor.charges = Math.min(owner.actor.charges + cfg.amount, owner.actor.chargeCount);
        return;
    }
```

`playerTurn.ts` cast-path charge step (:1307-1341) — add the symmetric enemy-target routing through the engine-supplied `removeEnemyCharges` callback (thread it in the same way `grantAllyCharges` is threaded into the player-turn context). On-cast enemy-removal abilities will be produced by the Phase 1 parser; this wiring makes the application path ready.

- [ ] **Step 4: Run to verify it passes** → PASS. Run `npm test`; confirm no unintended `.snap` drift (no existing fixture targets enemy charge).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/utils/combat/engine.ts src/utils/combat/triggers.ts src/utils/combat/playerTurn.ts src/utils/combat/__tests__/enemyChargeRemoval.integration.test.ts
git commit -m "feat(combat): enemy-targeted charge removal (floored, immunity-gated)"
```

---

## Done criteria for Phase 0

- All tasks committed; `npm test` green with no unexplained `.snap` drift; `npm run lint` clean.
- The five primitives exist and are unit/integration covered: `turnsTaken`, `every-n-turns`, `end-of-turn`, `chargeLossImmune`, enemy-target charge removal.
- **No changelog/docs entry** — Phase 0 is pure infrastructure with no user-visible behavior yet (no ship/implant emits these abilities until Phases 1–4). Changelog entries land with the feature phases.
- Open the PR off `main` (or the agreed integration branch) with `gh auth switch --user TheSusort`.

## Not in this plan (later phases, each its own plan off the merged foundation)

- Phase 1 — enemy charge removal parsing (skill text → enemy-target charge abilities; bomb-detonated removal; every-2nd-repair counter) + immunity end-to-end.
- Phase 2 — Chrono Reaver `IMPLANT_ABILITIES` builder (end-of-turn + every-n-turns) + parity check vs `chronoReaver.ts`.
- Phase 3 — conditional self-charge (start-of-turn + `hp-threshold` full-HP gate) parsing.
- Phase 4 — new opposing-scoped `on-enemy-charged-cast` trigger + reaction parsing.
