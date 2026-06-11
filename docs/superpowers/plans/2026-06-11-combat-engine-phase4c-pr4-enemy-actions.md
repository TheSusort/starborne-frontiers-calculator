# Combat Engine Phase 4c — PR 4: Enemy-Action Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make enemy repair/cleanse casts emit reactive events so player ships (Zosimos, Arum, Yarrow, Larkspur, Grif) react to them, and add a reactive `damage` executor branch for Grif's no-crit damage proc.

**Architecture:** New `cleanse-performed` event + event-only enemy heal/cleanse emission (a ship-backed enemy walking `runPlayerTurn` emits `heal-performed`/`cleanse-performed` with the enemy `casterId` but simulates NO numeric effect). Two new `AbilityTrigger` listener cases (`on-enemy-repaired`, `on-enemy-cleansed`) that filter `isEnemySide(casterId)`. A new `damage` reactive executor branch resolving with the owner's last-turn ctx (bomb-style fold), crediting the shared enemy pool, emitting nothing (no chain). Parser additions to lift the existing dormant "when an enemy repairs/cleanses" exclusion into live triggers.

**Tech Stack:** TypeScript, Vitest. All combat code under `src/utils/combat/`; ability types in `src/types/abilities.ts`; parser in `src/utils/skillTextParser.ts`; editor in `src/components/skills/AbilityCard.tsx`.

**Branch:** `feat/combat-engine-phase4c-enemy-actions` (off `main`, which is at PR #98 Barrier merged).

**Spec:** `docs/superpowers/specs/2026-06-10-combat-engine-phase4c-design.md` §4 PR 4 + §3.

---

## Scope-confirmation deltas (user-ratified 2026-06-11)

1. **Include both refit halves.** Grif's standing `+20% Defense` (separate sentence — a flat-stat self modifier) parses alongside the reactive damage proc. Arum's `Gelecek Contagion II → all allies` grant is part of the "when an enemy cleanses" sentence, so it parses as a SECOND reactive ability (on-enemy-cleansed, target all-allies) next to the Out. Damage Down I debuff.
2. **Reuse ship-backed path.** Enemy heal/cleanse events emit only from a ship-backed enemy attacker's walked cast skill — no new enemy config knob.
3. **Two clauses stay deferred/unmodeled.** Zosimos charge-sabotage ("decrease that enemy's charge for every second repair") is UNMODELED (no enemy charge race in healing mode). Arum's "all cleansed enemies" is approximated as the singular focus enemy. Both documented in coverage §5.

## Locked conventions (carried from PR 1–3, do not relitigate)

- Goldens are SYNTHETIC (hand-built `ab()`); any diff = bug — NEVER `vitest -u`. **PR 4 expects ZERO golden churn** (all new triggers key on events emitted only in healing mode with a ship-backed enemy that casts heal/cleanse — no existing fixture has one; DPS goldens are inert).
- Reactive heals/damage NEVER crit at drain time (deterministic). Grif "cannot critically hit" → `noCrit: true`.
- Listeners are PURE (enqueue only); the executor is the sole state mutator.
- `isEnemySide(actorId)` (engine.ts:1482) already covers the dummy wall + every enemy attacker.
- `gh auth switch --hostname github.com --user TheSusort` before any PR/merge op.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/utils/combat/events.ts` | Combat event union | Add `cleanse-performed` event |
| `src/types/abilities.ts` | Ability trigger taxonomy | Add `on-enemy-repaired`, `on-enemy-cleansed` to `AbilityTrigger` + `LIVE_TRIGGERS` |
| `src/utils/combat/triggers.ts` | Listener registration + executor | 2 new listener cases; `damage` executor branch; `creditReactiveDamage` field on `IntentExecContext` |
| `src/utils/combat/playerTurn.ts` | Per-turn pipeline incl. healing block | `healEventOnly` arg → enemy cast heal/cleanse emit events, skip numeric; emit `cleanse-performed` on the cleanse branch |
| `src/utils/combat/engine.ts` | Round loop / dispatch | Thread `creditReactiveDamage` into `executeIntent` ctx; pass `healEventOnly: true` on the enemy-attacker `runPlayerTurn` call |
| `src/utils/skillTextParser.ts` | Skill text → abilities | Detect `on-enemy-repaired`/`on-enemy-cleansed`; reactive `damage` (noCrit); lift dormant exclusion |
| `src/utils/buildShipAbilities.ts` | Wire parsed → ship abilities | Ensure new triggers/derivable flow through |
| `src/utils/__tests__/auditSkills*` (or audit util) | Parser parity | Parity entries for the 5 ships |
| `src/components/skills/AbilityCard.tsx` | Skill editor | Add 2 trigger select options |
| `src/utils/combat/__tests__/enemyActions.test.ts` | New unit tests | per-trigger coverage |
| `src/utils/combat/__tests__/healingGolden*.test.ts` (+ snapshot) | New golden scenario | one enemy-cleanse reaction scenario |
| `docs/skill-model-coverage.md` | Sim semantics + backlog | §5 PR-4 block; close §6 enemy-action items |
| `src/constants/changelog.ts` | UNRELEASED changelog | Fold into the ONE evolving DPS/combat entry |

---

## Task 1: `cleanse-performed` event

**Files:**
- Modify: `src/utils/combat/events.ts` (CombatEvent union)
- Test: `src/utils/combat/__tests__/events.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `events.test.ts` a test that the bus delivers a `cleanse-performed` event to a registered listener:

```ts
it('delivers cleanse-performed to listeners', () => {
    const bus = createEventBus();
    const seen: CombatEvent[] = [];
    bus.on('cleanse-performed', (e) => seen.push(e));
    bus.emit({ type: 'cleanse-performed', casterId: 'enemy', count: 1, round: 2 });
    expect(seen).toEqual([{ type: 'cleanse-performed', casterId: 'enemy', count: 1, round: 2 }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/events.test.ts -t "cleanse-performed"`
Expected: FAIL (TS: `cleanse-performed` not assignable to `CombatEvent`).

- [ ] **Step 3: Add the event to the union**

In `events.ts`, after the `heal-performed` variant, add:

```ts
    /** A cleanse cast resolved. `casterId` is the cleansing actor; `count` is the
     *  configured number of debuffs cleansed. Emitted on the cast path for ANY actor
     *  (player or enemy); enemy-side emission carries NO numeric effect (Phase 4c PR 4 —
     *  cast-fires-regardless: emitted on every qualifying cast, with no check that a
     *  debuff actually existed to cleanse). The `on-enemy-cleansed` listener filters
     *  `isEnemySide(casterId)`. */
    | { type: 'cleanse-performed'; casterId: string; count: number; round: number }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/events.test.ts -t "cleanse-performed"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/events.ts src/utils/combat/__tests__/events.test.ts
git commit -m "feat(combat): add cleanse-performed event"
```

---

## Task 2: New triggers in the taxonomy

**Files:**
- Modify: `src/types/abilities.ts` (`AbilityTrigger` union + `LIVE_TRIGGERS` set)
- Test: covered indirectly by Task 3; add a tiny type-level assertion in `enemyActions.test.ts` (created here).

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/__tests__/enemyActions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LIVE_TRIGGERS } from '../../../types/abilities';

describe('Phase 4c PR 4 — enemy-action triggers', () => {
    it('registers on-enemy-repaired and on-enemy-cleansed as live triggers', () => {
        expect(LIVE_TRIGGERS.has('on-enemy-repaired')).toBe(true);
        expect(LIVE_TRIGGERS.has('on-enemy-cleansed')).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/enemyActions.test.ts`
Expected: FAIL (TS error: `'on-enemy-repaired'` not assignable to `AbilityTrigger`).

- [ ] **Step 3: Add the triggers**

In `abilities.ts`, extend the `AbilityTrigger` union (after `'on-hp-threshold-crossed'`):

```ts
    | 'on-hp-threshold-crossed'
    // Fired when an ENEMY-SIDE actor repairs (reuses heal-performed) or cleanses a
    // debuff (cleanse-performed). Player reactions: Zosimos charge gain on enemy
    // repair; Arum/Yarrow/Larkspur/Grif reactions on enemy cleanse. Phase 4c PR 4.
    | 'on-enemy-repaired'
    | 'on-enemy-cleansed';
```

Add both to `LIVE_TRIGGERS`:

```ts
    'on-hp-threshold-crossed',
    'on-enemy-repaired',
    'on-enemy-cleansed',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/enemyActions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/abilities.ts src/utils/combat/__tests__/enemyActions.test.ts
git commit -m "feat(combat): add on-enemy-repaired/on-enemy-cleansed triggers"
```

---

## Task 3: Listener cases for the two enemy triggers

**Files:**
- Modify: `src/utils/combat/triggers.ts` (`registerReactiveListeners` switch + the doc block ~lines 122–166)
- Test: `src/utils/combat/__tests__/enemyActions.test.ts`

The listeners are thin: enqueue once per qualifying event. `on-enemy-repaired` → `heal-performed` where `isEnemySide(casterId)`; `on-enemy-cleansed` → `cleanse-performed` where `isEnemySide(casterId)`. Mirror the existing `on-enemy-destroyed` pattern (triggers.ts:344).

- [ ] **Step 1: Write the failing test**

Add to `enemyActions.test.ts` a direct test of `registerReactiveListeners` (matches the pattern other listener tests use — build a bus, a `perOwner`, an `isEnemySide`, capture enqueued intents):

```ts
import { registerReactiveListeners } from '../triggers';
import { createEventBus } from '../events';
import type { Intent } from '../triggers';
import type { Ability } from '../../../types/abilities';

function reactiveAbility(trigger: Ability['trigger']): Ability {
    return {
        id: `${trigger}-ab`,
        type: 'charge',
        target: 'self',
        trigger,
        conditions: [],
        config: { type: 'charge', amount: 1 },
    };
}

it('on-enemy-repaired enqueues only for enemy-side heal-performed', () => {
    const bus = createEventBus();
    const enqueued: Intent[] = [];
    registerReactiveListeners({
        bus,
        perOwner: [
            {
                ownerId: 'zosimos',
                reactiveAbilities: [
                    { ability: reactiveAbility('on-enemy-repaired'), sourceSlot: 'passive' },
                ],
            },
        ],
        enqueue: (i) => enqueued.push(i),
        isEnemySide: (id) => id === 'enemy',
    });
    // Enemy repair → enqueue.
    bus.emit({ type: 'heal-performed', casterId: 'enemy', targets: ['enemy'], round: 1, amount: 0 });
    // A player ally's repair must NOT enqueue this (it is not an enemy action).
    bus.emit({ type: 'heal-performed', casterId: 'ally', targets: ['tank'], round: 1, amount: 100 });
    expect(enqueued).toHaveLength(1);
});

it('on-enemy-cleansed enqueues only for enemy-side cleanse-performed', () => {
    const bus = createEventBus();
    const enqueued: Intent[] = [];
    registerReactiveListeners({
        bus,
        perOwner: [
            {
                ownerId: 'grif',
                reactiveAbilities: [
                    { ability: reactiveAbility('on-enemy-cleansed'), sourceSlot: 'passive' },
                ],
            },
        ],
        enqueue: (i) => enqueued.push(i),
        isEnemySide: (id) => id === 'enemy',
    });
    bus.emit({ type: 'cleanse-performed', casterId: 'enemy', count: 1, round: 1 });
    bus.emit({ type: 'cleanse-performed', casterId: 'ally', count: 1, round: 1 }); // player cleanse, ignored
    expect(enqueued).toHaveLength(1);
});
```

> NOTE: confirm the exact `ReactiveAbility`/`Intent` shapes against `triggers.ts` and existing listener tests (`triggers.test.ts`) before finalizing the test — match their import style and the `reactiveAbilities` element shape (`{ ability, sourceSlot }`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/enemyActions.test.ts -t "enemy-"`
Expected: FAIL (no enqueues — the triggers hit the `default` no-op case).

- [ ] **Step 3: Add the listener cases**

In `registerReactiveListeners`, after the `on-enemy-destroyed` case (triggers.ts:344-350):

```ts
                case 'on-enemy-repaired':
                    bus.on('heal-performed', (e) => {
                        // Enemy-scoped: any enemy-side actor's repair (dummy wall + enemy
                        // attackers). One enqueue per qualifying cast — Zosimos banks a charge.
                        if (isEnemySide(e.casterId)) enqueue(intent);
                    });
                    break;
                case 'on-enemy-cleansed':
                    bus.on('cleanse-performed', (e) => {
                        // Enemy-scoped: any enemy-side actor's cleanse. One enqueue per cast.
                        if (isEnemySide(e.casterId)) enqueue(intent);
                    });
                    break;
```

Add two bullets to the listener doc block (~line 160) describing the new cases (mirror the `on-enemy-destroyed` bullet wording).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/enemyActions.test.ts -t "enemy-"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/enemyActions.test.ts
git commit -m "feat(combat): on-enemy-repaired/on-enemy-cleansed listeners"
```

---

## Task 4: `damage` reactive executor branch + `creditReactiveDamage`

**Files:**
- Modify: `src/utils/combat/triggers.ts` (`IntentExecContext` interface + `executeIntent`)
- Modify: `src/utils/combat/engine.ts` (wire `creditReactiveDamage` into the `executeIntent` ctx ~line 1986)
- Test: `src/utils/combat/__tests__/enemyActions.test.ts`

Grif's proc resolves with the owner's last-turn ctx (bomb-style fold: `effectiveAttack × pct × affinityMult`), no enemy-defense mitigation (documented approximation, mirrors the bomb path), `noCrit` always. Emits nothing → no chain.

- [ ] **Step 1: Write the failing test**

Add a unit test that drives `executeIntent` with a `damage` config and asserts `creditReactiveDamage` is called with `ownerId` and the bomb-style amount; and that with no `lastTurnCtxByActor` entry it is NOT called (skip). Build a minimal `IntentExecContext` (follow the shape other executor tests use, e.g. in `triggers.test.ts`):

```ts
it('damage reactive branch credits owner pool with bomb-style fold, skips without ctx', () => {
    const credited: { ownerId: string; amount: number }[] = [];
    const baseCtx = makeExecCtx({ // helper mirroring triggers.test.ts ctx builder
        creditReactiveDamage: (ownerId, amount) => credited.push({ ownerId, amount }),
        lastTurnCtxByActor: new Map([
            ['grif', { effectiveAttack: 1000, affinityMult: 1.5 /* ...other PlayerRoundCtx fields */ }],
        ]),
    });
    const intent: Intent = {
        ownerId: 'grif',
        sourceSlot: 'passive',
        ability: {
            id: 'grif-dmg', type: 'damage', target: 'enemy', trigger: 'on-enemy-cleansed',
            conditions: [], config: { type: 'damage', multiplier: 0.75, noCrit: true },
        },
    };
    executeIntent(intent, baseCtx);
    expect(credited).toEqual([{ ownerId: 'grif', amount: 1000 * 0.75 * 1.5 }]);

    // No ctx for the owner → skip.
    credited.length = 0;
    executeIntent({ ...intent, ownerId: 'grif-noctx' }, baseCtx);
    expect(credited).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/enemyActions.test.ts -t "damage reactive"`
Expected: FAIL (`damage` falls into the "any other type → skip" path; `creditReactiveDamage` not on the ctx type).

- [ ] **Step 3: Add the ctx field + executor branch**

In `IntentExecContext` (triggers.ts ~line 446, after `selfHpPctFor`):

```ts
    /** Credit reactive direct damage to the owner's round damage map against the shared
     *  enemy pool (Phase 4c PR 4 — Grif's on-enemy-cleansed 75% damage proc). Wraps the
     *  engine's `creditDamage(ownerId, 'direct', amount)` so the standing-leech hook still
     *  sees it. Absent → the damage branch is inert (unit fixtures / DPS mode without the
     *  delegate). */
    creditReactiveDamage?: (ownerId: string, amount: number) => void;
```

In `executeIntent`, add a branch BEFORE the `extra-action` branch (after the `dot` branch):

```ts
    if (cfg.type === 'damage') {
        // Reactive direct-damage proc (Grif's on-enemy-cleansed "75% Damage that cannot
        // critically hit"). Bomb-style fold from the owner's last-turn ctx: effectiveAttack
        // × pct × affinityMult, NO enemy-defense mitigation (documented approximation,
        // mirrors the bomb path) and NO crit (cfg.noCrit always set by the parser; drain
        // time has no crit outcome regardless). Before the owner's first turn (faster enemy,
        // round 1) there is no ctx → skip, exactly like a bomb follow-up. Emits NO event
        // (ability-performed/attacked) → the proc cannot chain.
        const ownerCtx = ctx.lastTurnCtxByActor.get(intent.ownerId);
        if (ownerCtx === undefined) return;
        const amount = ownerCtx.effectiveAttack * cfg.multiplier * ownerCtx.affinityMult;
        if (amount > 0) ctx.creditReactiveDamage?.(intent.ownerId, amount);
        return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/enemyActions.test.ts -t "damage reactive"`
Expected: PASS

- [ ] **Step 5: Wire the delegate in the engine**

In `engine.ts`, in the `executeIntent(intent, { ... })` ctx object (~line 1986, alongside `recordResisted`), add:

```ts
                        // Phase 4c PR 4: reactive direct damage (Grif) credits the owner's
                        // round map via the single credit point so leeches still see it.
                        creditReactiveDamage: (ownerId: string, amount: number): void => {
                            creditDamage(ownerId, 'direct', amount);
                        },
```

- [ ] **Step 6: Run the full combat suite — verify zero churn**

Run: `npx vitest run src/utils/combat/`
Expected: PASS, no golden snapshot diffs (the delegate is only invoked by a `damage` reactive intent, which no existing fixture produces).

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/engine.ts src/utils/combat/__tests__/enemyActions.test.ts
git commit -m "feat(combat): reactive damage executor branch (Grif on-enemy-cleansed)"
```

---

## Task 5: Event-only enemy heal/cleanse emission

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (`runPlayerTurn` args + the healing block ~1372-1567)
- Modify: `src/utils/combat/engine.ts` (pass `healEventOnly: true` on the enemy-attacker `runPlayerTurn` call ~line 2525)
- Test: `src/utils/combat/__tests__/enemyActions.test.ts`

When a ship-backed enemy attacker casts an active/charged skill carrying heal/cleanse abilities, emit `heal-performed`/`cleanse-performed` with the enemy `casterId` but credit NO player healing buckets and mutate NO target. Also emit `cleanse-performed` on the PLAYER cleanse path (symmetric; the listener filters by side) so player cleanses are observable too — but only the enemy side has reactions in PR 4.

Design: thread a boolean `healEventOnly` arg into `runPlayerTurn` (default false). In the healing block:
- Add a `cleanse-performed` emit to the cleanse branch (BOTH modes) carrying `casterId: actor.id, count: cfg.count`.
- When `healEventOnly`: for heal/shield abilities skip `credit`/`applyHealToTarget`/`grantShieldToTarget` (still collect `healTargets` so `heal-performed` emits with `amount: 0`, no `critHits`); for cleanse skip `credit('cleanseCount')` but still emit `cleanse-performed`. Restrict the enemy event-only emission to the CAST skill (`gatedSkill`) heal/cleanse abilities (the passive is a standing effect, not a cast — spec §3.2 "cast skill carries").

> IMPLEMENTATION NOTE: the cleanse branch currently lives inside the `healAbilities` loop (playerTurn.ts:1550). Track a `cleansePerformedCount` accumulator across that loop and emit ONE `cleanse-performed` after the loop if `> 0` (mirrors the single `heal-performed` per cast at line 1557), carrying the summed count. Keep the `heal-performed` emit gated on `healTargets.length > 0` as today.

- [ ] **Step 1: Write the failing test (enemy cleanse emits event, no numeric)**

Add an integration-style test using `runCombat` with a ship-backed enemy attacker whose active skill carries a `cleanse` ability, a heal target, and a Grif-like player owner with an `on-enemy-cleansed` damage proc. Assert: (a) a `cleanse-performed` event with `casterId` = the enemy id is emitted; (b) the player healing buckets contain NO `cleanseCount` credit for the enemy; (c) Grif's damage proc credited the enemy pool. Use the existing `runCombat` test harness in `enemyActorRuntime.test.ts` / `healing.test.ts` as the template for building enemy attackers with `shipSkills`.

> Prefer a focused engine test. If wiring a full `runCombat` scenario is heavy, split into: (5a) a `runPlayerTurn` unit test asserting `healEventOnly` emits `cleanse-performed`/`heal-performed` with no `healing.credit` calls (spy on a fake `healing` ctx), and (5b) the `runCombat` integration test for the end-to-end reaction.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/enemyActions.test.ts -t "enemy cleanse"`
Expected: FAIL (no `cleanse-performed` emitted today; or enemy credits player buckets).

- [ ] **Step 3: Add `healEventOnly` arg + healing-block branching**

Add `healEventOnly?: boolean` to the `runPlayerTurn` args type. In the healing block:
- cleanse branch: accumulate `cleansePerformedCount += cfg.count`; only `healing.credit(actor.id, 'cleanseCount', cfg.count)` when `!healEventOnly`.
- heal/shield branches: when `healEventOnly`, skip all `healing.*` calls but still `healTargets.push(rid)` (so `heal-performed` emits). When event-only, force `didCrit = false` and `raw`-sum to 0 (no numeric).
- after the loop: emit `cleanse-performed` when `cleansePerformedCount > 0`; keep the `heal-performed` emit (with `amount: healRawSum` which is 0 in event-only mode).
- Restrict enemy event-only heal/cleanse abilities to `gatedSkill?.abilities` (exclude `gatedPassive`) — build `healAbilities` accordingly when `healEventOnly`.

- [ ] **Step 4: Pass `healEventOnly` in the engine enemy branch**

In `engine.ts` enemy-attacker `runPlayerTurn` call (~line 2559, alongside `healing: healingCtx`):

```ts
                            healing: healingCtx,
                            // Phase 4c PR 4: an enemy's heal/cleanse cast emits heal-performed/
                            // cleanse-performed (so player on-enemy-* reactions fire) but credits
                            // NO player healing buckets and mutates no target — event-only.
                            healEventOnly: true,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/enemyActions.test.ts`
Expected: PASS

- [ ] **Step 6: Full combat suite — verify zero churn**

Run: `npx vitest run src/utils/combat/`
Expected: PASS, no golden diffs (existing fixtures have no ship-backed enemy with a heal/cleanse cast; player cleanse path adds a `cleanse-performed` emit that no existing listener consumes, so no behavioral change).

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/engine.ts src/utils/combat/__tests__/enemyActions.test.ts
git commit -m "feat(combat): event-only enemy heal/cleanse emission"
```

---

## Task 6: Parser — detect enemy-action triggers + reactive damage + Grif standing buff

**Files:**
- Modify: `src/utils/skillTextParser.ts`
- Test: the `skillTextParser` test suite (find with `grep -rl skillTextParser src/utils/__tests__ src/**/__tests__`) — add lock tests per ship phrasing.

Current state: the `ENEMY_*` exclusion regex (skillTextParser.ts:341) treats "when an enemy repairs / enemy performs a repair / when an enemy dies" as dormant/non-derivable. PR 4 lifts repair + cleanse out of that exclusion into live, derivable triggers.

Ship phrasings to handle (from `docs/ship-skills.csv`):
- **Zosimos** passive: "When an enemy repairs, this Unit gains a charge to its Charged Skill." → `on-enemy-repaired`, `charge` config amount 1, target self, `derivable: true`. (Refit adds "decrease that enemy's charge…" → UNMODELED; ignore.)
- **Arum** passive: "When an enemy cleanses a debuff, this Unit inflicts all cleansed enemies with Out. Damage Down I for 1 turn." → `on-enemy-cleansed`, `debuff` Out. Damage Down I, target enemy, duration 1. Refit second passive adds "…and this Unit grants all allies Gelecek Contagion II for 3 turns." → a SECOND `on-enemy-cleansed` ability, `buff` Gelecek Contagion II, target all-allies, duration 3.
- **Yarrow / Larkspur** passive: "When an enemy cleanses a Debuff, this Unit gains Gelecek Contagion I/II for N turns." → `on-enemy-cleansed`, `buff`, target self.
- **Grif** passive (refit): "This Unit increases its Defense by 20%. When an enemy cleanses a Debuff, this Unit deals 75% Damage that cannot critically hit." → TWO abilities: (1) standing self `modifier` defense +20% (multiplicative? — it's "increases its Defense by 20%", a flat-stat passive → `modifier` channel `defense`, `isMultiplicative: true`, value 20, trigger `on-cast`/passive standing per existing modifier convention); (2) `on-enemy-cleansed` `damage` config multiplier 0.75 `noCrit: true`, target enemy.

> The Inc./Out. abbreviation-period masking rule applies if any clause-splitting is added — mask "Inc."/"Out." periods before sentence split in BOTH the parser and auditSkills (see `[[project-clause-scoping-abbrev-periods]]`).

- [ ] **Step 1: Write failing parser lock tests**

In the parser test suite, add per-ship assertions that the parsed abilities carry the expected trigger/config. Example for Grif:

```ts
it('parses Grif refit passive: standing +20% defense + on-enemy-cleansed 75% no-crit damage', () => {
    const abilities = parseSkillText(GRIF_REFIT_PASSIVE_TEXT, 'passive');
    expect(abilities).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'modifier', config: expect.objectContaining({ channel: 'defense', value: 20 }) }),
        expect.objectContaining({ trigger: 'on-enemy-cleansed', config: expect.objectContaining({ type: 'damage', multiplier: 0.75, noCrit: true }) }),
    ]));
});
```

Add analogous tests for Zosimos (charge on-enemy-repaired), Arum (debuff + all-allies buff, both on-enemy-cleansed), Yarrow/Larkspur (self buff on-enemy-cleansed).

> Match the real parser entry point and ability shape — inspect an existing parser test for `on-attacked`/`on-hp-threshold-crossed` to copy the exact call signature and assertion style.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run <parser test file> -t "enemy"`
Expected: FAIL (triggers currently dormant / not detected).

- [ ] **Step 3: Implement parser detection**

- Add a `detectEnemyRepairTrigger` / `detectEnemyCleanseTrigger` helper (or extend the existing trigger dispatch) returning the trigger when the sentence matches "when an enemy repairs" / "when an enemy cleanses a debuff" (case-insensitive, sentence-scoped). Remove repair/cleanse from the dormant `ENEMY_*` exclusion regex (keep "when an enemy dies" handled by the existing on-enemy-destroyed path; keep ally-grant exclusions).
- Route the trigger's effect clause through the existing config parsers: charge → `charge`; "inflicts … Out. Damage Down I" → `debuff`; "gains/grants … Gelecek Contagion" → `buff` (self vs all-allies by subject); "deals X% Damage that cannot critically hit" → `damage` with `noCrit: true` (reuse the existing no-crit detection at skillTextParser.ts:1012/1247).
- Emit `derivable: true` (these are now live).
- Grif standing "+20% Defense" sentence: parse via the existing modifier/defense path (separate sentence, no trigger).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run <parser test file> -t "enemy"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/skillTextParser.ts <parser test file>
git commit -m "feat(parser): on-enemy-repaired/cleansed triggers + Grif standing defense"
```

---

## Task 7: `buildShipAbilities` wiring + auditSkills parity

**Files:**
- Modify: `src/utils/buildShipAbilities.ts` (if any trigger/derivable gating filters new triggers)
- Modify: the `audit:skills` parity source (find via `grep -rln "auditSkills\|audit:skills" src`)
- Test: run `npm run` audit script / parity test

- [ ] **Step 1: Inspect `buildShipAbilities.ts`** for any allow-list or derivable-gating that would drop the new triggers; extend if needed (mirror how `on-hp-threshold-crossed` flowed through in PR 3).

- [ ] **Step 2: Run the skill audit** to surface parser/audit parity drift:

Run: `npm run audit:skills` (or the documented audit command)
Expected: the 5 PR-4 ships (Zosimos/Arum/Yarrow/Larkspur/Grif) now parse their reactive abilities; no parity regressions elsewhere.

- [ ] **Step 3: Apply the abbreviation-period masking** in auditSkills if clause-splitting touches Inc./Out. names (parity with the parser side).

- [ ] **Step 4: Commit**

```bash
git add src/utils/buildShipAbilities.ts <audit source/tests>
git commit -m "chore(audit): parity for enemy-action triggers"
```

---

## Task 8: Editor trigger options

**Files:**
- Modify: `src/components/skills/AbilityCard.tsx` (`TRIGGER_OPTIONS` ~line 121)
- Test: `src/components/skills/__tests__/AbilityCard.test.ts` (if it asserts option presence)

- [ ] **Step 1: Add the two options** to `TRIGGER_OPTIONS`:

```ts
    { value: 'on-enemy-repaired', label: 'When an enemy repairs' },
    { value: 'on-enemy-cleansed', label: 'When an enemy cleanses a debuff' },
```

- [ ] **Step 2: Run editor tests + lint**

Run: `npx vitest run src/components/skills/__tests__/AbilityCard.test.tsx && npm run lint`
Expected: PASS, no lint warnings.

- [ ] **Step 3: Commit**

```bash
git add src/components/skills/AbilityCard.tsx src/components/skills/__tests__/AbilityCard.test.tsx
git commit -m "feat(editor): enemy-action trigger options"
```

---

## Task 9: Golden scenario — enemy-cleanse reaction

**Files:**
- Modify: the healing golden scenario source + its `.snap` (find via `ls src/utils/calculators/__tests__/__snapshots__ src/utils/combat/__tests__/__snapshots__`)
- Test: the golden parity test

A new SYNTHETIC scenario (hand-built `ab()`, no parser import): a ship-backed enemy attacker that casts a cleanse, plus a Grif-like player with the `on-enemy-cleansed` 75% damage proc and (optionally) Yarrow's self-buff grant. Lock the enemy-cleanse event contract + the reactive damage credit + the all-allies/self buff routing.

- [ ] **Step 1: Add the scenario** to the golden scenario list (append, matching the existing scenario-builder shape; do NOT modify existing scenarios).

- [ ] **Step 2: Generate the snapshot ONCE for the NEW scenario only**

Run the golden test; for a NET-NEW scenario the snapshot is additive. Inspect the diff: it MUST be purely the new scenario's block. If ANY existing scenario's numbers changed, STOP — that is a bug, not a golden update.

Run: `npx vitest run <golden test file>`

- [ ] **Step 3: Audit the diff** — confirm additive-only, then accept the new snapshot block.

- [ ] **Step 4: Commit**

```bash
git add <golden source> <snapshot file>
git commit -m "test(combat): golden scenario for enemy-cleanse reaction"
```

---

## Task 10: Coverage doc + changelog

**Files:**
- Modify: `docs/skill-model-coverage.md` (§5 PR-4 block; close §6 enemy-action backlog)
- Modify: `src/constants/changelog.ts` (fold into the ONE evolving UNRELEASED DPS/combat entry)

- [ ] **Step 1: §5 PR-4 block** — document: event-only enemy heal/cleanse emission; cast-fires-regardless approximation; reactive `damage` bomb-style fold (no enemy-defense mitigation); Zosimos charge-sabotage UNMODELED; Arum "all cleansed enemies" → singular focus enemy.

- [ ] **Step 2: §6** — mark the enemy-action backlog items shipped (the repair/cleanse reaction family; note items 10–12 still pending for PR 5/6).

- [ ] **Step 3: Changelog** — add a plain-English line to the existing combat entry in `UNRELEASED_CHANGES` (e.g. "Ships that react to enemy repairs/cleanses — Zosimos, Arum, Yarrow, Larkspur, Grif — now fire in the Healing Calculator."). Do NOT create a second entry; FOLD into the existing one.

- [ ] **Step 4: Full suite + lint**

Run: `npm test && npm run lint`
Expected: ALL PASS, max-warnings 0.

- [ ] **Step 5: Commit**

```bash
git add docs/skill-model-coverage.md src/constants/changelog.ts
git commit -m "docs: coverage + changelog for 4c PR 4 enemy-action reactions"
```

---

## Final verification (before PR)

- [ ] `npm test` — full suite green (target: ~1925+ tests, +N new). No golden churn outside Task 9's additive scenario.
- [ ] `npm run lint` — zero warnings.
- [ ] Manual spot-check: build the parser audit for the 5 ships; confirm triggers/configs.
- [ ] `gh auth switch --hostname github.com --user TheSusort` then open the PR; poll `mergeState=CLEAN` (not check status).
- [ ] PR body: list shipped ships, the documented approximations, and the zero-golden-churn claim.

## Determinism / inertness invariants (must hold)

- DPS goldens BYTE-IDENTICAL (every new trigger keys on healing-mode-only events).
- `creditReactiveDamage` invoked only by a `damage` reactive intent — absent from every existing fixture.
- The player cleanse path's new `cleanse-performed` emit has no player-side consumer in PR 4 → no behavioral change.
- Reactive damage cannot chain (emits no `ability-performed`/`attacked`); `MAX_INTENT_GENERATIONS` backstop unchanged.
