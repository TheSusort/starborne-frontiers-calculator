# Reactive Cleanse (Reactive Ward + Warpstrike duration-reduction) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two cleanse-family reactive implant effects to the battle sim — Reactive Ward (on directly-damaged → proc-gated cleanse of 1 debuff, or 2 on a crit) and Warpstrike's deferred duration-reduction half (on dealing direct damage while self-debuffed → shave 1 turn off the newest self-debuff).

**Architecture:** Both flow through the single existing reactive `cleanse` executor branch (`triggers.ts` ~1407), distinguished by a new `mode: 'remove' | 'reduce-duration'` field — no turn-loop special-casing. Reactive Ward rides the existing `on-attacked` trigger; Warpstrike rides a new `on-deal-damage` trigger (which rides `ability-performed`, emitted exactly once per damage-dealing turn). A new status-engine primitive `reduceNewestDebuffDuration` does the partial-duration work. Both are registered as equipment abilities in `buildEquipmentAbilities.ts`.

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/`; equipment-ability registry in `src/utils/abilities/`.

**Spec:** `docs/superpowers/specs/2026-06-23-reactive-cleanse-design.md`

**Branch:** `feat/combat-d-pr-reactive-cleanse` (off `main` @ D-PR15).

---

## Pre-flight grounding (read before starting)

- Reactive `cleanse` executor branch: `src/utils/combat/triggers.ts` ~1407.
- `on-attacked` listener: `src/utils/combat/triggers.ts` ~382 (already builds `eventCtx: { counterTargetId }`).
- Trigger-listener `switch (ra.ability.trigger)`: `src/utils/combat/triggers.ts` ~251.
- `passesProcChanceGate` + **its doc-comment gate-desync rule**: `src/utils/combat/triggers.ts` ~1016-1023. The `!ctx.healing` early-return MUST precede the proc gate in remove-mode.
- `reactiveRecipients`: `src/utils/combat/triggers.ts` ~1004 — `self` target → `[ownerId]`.
- `cleanse` / `removeNewestFirst` / `isUnremovable`: `src/utils/combat/statusEngine.ts` ~899-989.
- `cleanse` AbilityConfig member: `src/types/abilities.ts` ~347-356 (shared with `purge`).
- `Intent.eventCtx`: `src/utils/combat/triggers.ts` ~102.
- `ability-performed` emit (once per turn): `src/utils/combat/playerTurn.ts` ~1404; positional path relies on it (`engine.ts` ~2887).
- Registry consumer / id-stamping: `src/utils/abilities/buildEquipmentAbilities.ts` ~769-780.

**Verified facts driving this plan:**
- `ability-performed` fires exactly once per damage-dealing turn (aggregate event; positional path emits none) → Warpstrike needs **no** once-per-turn guard.
- `reactiveRecipients` maps `target: 'self'` → `[ownerId]`.
- `passesProcChanceGate` is pass-through (returns `true` without touching the gate) when `procChance` is undefined → Warpstrike (no procChance) never advances the accumulator.
- No combat golden fixture equips Reactive Ward or Warpstrike → zero golden/.snap drift expected.

---

## Task 1: Status-engine primitive `reduceNewestDebuffDuration`

**Files:**
- Modify: `src/utils/combat/statusEngine.ts` (add to the `StatusEngine` interface ~163 near `cleanse`; add the implementation near `removeNewestFirst`/`cleanse` ~954-989; expose it on the returned object near the `cleanse,` entry ~1204)
- Test: `src/utils/combat/__tests__/statusEngine.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a `describe('reduceNewestDebuffDuration', ...)` block. Use the existing test file's helpers to apply timed enemy-side debuffs to an actor (mirror how `cleanseRemoval`/`statusEngine` tests apply debuffs — apply two timed debuffs with different durations and application order so newest-first is observable). Cover:

```ts
// 1. Reduces the NEWEST-applied debuff's duration by `turns`, leaves others untouched.
//    Apply debuff A (3 turns) then debuff B (3 turns); reduceNewestDebuffDuration(id, 1)
//    → B has 2 turns remaining, A still 3. Returns 1.
// 2. Expires (removes) a debuff reduced to <= 0.
//    Apply a 1-turn debuff; reduceNewestDebuffDuration(id, 1) → debuff gone. Returns 1.
// 3. Skips non-numeric durations ('recurring'/'permanent') and UNREMOVABLE_STATUSES —
//    if the ONLY debuff is unremovable/recurring, returns 0 and nothing changes.
// 4. Unknown actor id (no debuffs) → returns 0, no throw.
// 5. turns > 1 reduces by that many (e.g. 2-turn debuff, reduce by 2 → expires).
```

Assert via `snapshot(id)` / the engine's existing read API for active debuffs + their remaining turns (match whatever `statusEngine.test.ts` already uses to read durations).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest --run src/utils/combat/__tests__/statusEngine.test.ts -t "reduceNewestDebuffDuration"`
Expected: FAIL — `reduceNewestDebuffDuration is not a function`.

- [ ] **Step 3: Add the interface method**

In the `StatusEngine` interface (near `cleanse(actorId, count): number;`):

```ts
/** Reduce the duration of ONE timed debuff on `actorId` by `turns`, newest-applied first
 *  (highest appliedSeq). Reduced to <= 0 → the debuff is removed (expired). Only timed
 *  debuffs are eligible (accumulating/persistent have no finite duration); 'recurring'/
 *  'permanent' and UNREMOVABLE_STATUSES are skipped (consistent with cleanse). Returns 1
 *  if a debuff was affected, else 0. Unknown id → 0. */
reduceNewestDebuffDuration(actorId: string, turns: number): number;
```

- [ ] **Step 4: Implement the primitive**

Near `cleanse` (~988):

```ts
/** See interface doc. Mirrors removeNewestFirst's candidate gathering/skip rules over the
 *  per-victim TIMED enemy store only, then decrements-or-deletes the newest candidate. */
const reduceNewestDebuffDuration = (actorId: string, turns: number): number => {
    const timedMap = enemyMaps.get(actorId);
    if (!timedMap) return 0;
    let best: { seq: number; key: string; s: BuffState } | undefined;
    for (const [key, s] of timedMap) {
        // Only timed entries carry a numeric duration; 'recurring'/'permanent' are not reducible.
        if (typeof s.turnsRemaining !== 'number') continue;
        if (isUnremovable(s.buffName, s.turnsRemaining)) continue;
        if (!best || s.appliedSeq > best.seq) best = { seq: s.appliedSeq, key, s };
    }
    if (!best) return 0;
    best.s.turnsRemaining = (best.s.turnsRemaining as number) - turns;
    if ((best.s.turnsRemaining as number) <= 0) timedMap.delete(best.key);
    return 1;
};
```

Expose it on the returned engine object (near `cleanse,` ~1204): add `reduceNewestDebuffDuration,`.

(Confirm `BuffState` is the in-scope type name used by `enemyMaps`; if the local alias differs, match it. `turnsRemaining` is `number | 'recurring' | 'permanent'`, so the `as number` narrowing after the `typeof` guard is safe and may be unnecessary if TS already narrows — drop the casts if lint complains.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest --run src/utils/combat/__tests__/statusEngine.test.ts -t "reduceNewestDebuffDuration"`
Expected: PASS (all 5).

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/statusEngine.ts src/utils/combat/__tests__/statusEngine.test.ts
git commit -m "feat(combat): reduceNewestDebuffDuration status-engine primitive"
```

---

## Task 2: Extend cleanse AbilityConfig + Intent.eventCtx.didCrit (types)

**Files:**
- Modify: `src/types/abilities.ts` (the `cleanse | purge` config member ~347)
- Modify: `src/utils/combat/triggers.ts` (`Intent.eventCtx` ~102)

- [ ] **Step 1: Add cleanse config fields**

In the `{ type: 'cleanse' | 'purge'; count; countScaling? }` member, add (cleanse-only — document that purge never sets these):

```ts
/** Reactive Ward: debuffs to cleanse when the triggering hit was a crit (else `count`).
 *  Read from intent.eventCtx.didCrit by the reactive cleanse executor. cleanse-only. */
critCount?: number;
/** D-PR(reactive-cleanse): 'remove' (default) deletes whole debuffs (cleanse);
 *  'reduce-duration' shaves `durationTurns` off the newest debuff (Warpstrike). cleanse-only. */
mode?: 'remove' | 'reduce-duration';
/** Turns to reduce in 'reduce-duration' mode (default 1). cleanse-only. */
durationTurns?: number;
```

- [ ] **Step 2: Add `didCrit` to Intent.eventCtx**

In `Intent.eventCtx` (after `triggerDamage?`):

```ts
/** The triggering hit's crit outcome (on-attacked → attacked.didCrit), read by the
 *  reactive cleanse executor to pick `critCount` over `count` (Reactive Ward). */
didCrit?: boolean;
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (additive optional fields — no call sites break).

- [ ] **Step 4: Commit**

```bash
git add src/types/abilities.ts src/utils/combat/triggers.ts
git commit -m "feat(combat): cleanse config (critCount/mode/durationTurns) + eventCtx.didCrit"
```

---

## Task 3: on-attacked threads didCrit + cleanse executor remove-mode (proc gate + crit-count)

**Files:**
- Modify: `src/utils/combat/triggers.ts` (`on-attacked` listener ~393; cleanse executor branch ~1407)
- Test: `src/utils/combat/__tests__/cleanseReactivePath.test.ts`

- [ ] **Step 1: Write the failing tests**

Add cases to `cleanseReactivePath.test.ts` (follow the file's existing harness for building an Intent + IntentExecContext with a healing ctx and a real status engine carrying debuffs):

```ts
// A. remove-mode, no procChance: cleanses `count` debuffs (existing behavior preserved).
// B. remove-mode, didCrit true + critCount set: cleanses critCount (2), not count (1).
// C. remove-mode, didCrit false + critCount set: cleanses count (1).
// D. remove-mode, procChance present + gate FAILS (procChance very low, or drive the gate
//    so it doesn't fire): cleanses 0. (Mirror reactiveDamageProcGate.test.ts's gate-driving.)
// E. gate-desync guard: in a NON-healing ctx (ctx.healing undefined), remove-mode returns
//    early WITHOUT consulting the proc gate (assert the gate accumulator is untouched —
//    or at minimum that no throw and no cleanse occurs).
```

Set `intent.eventCtx = { didCrit: true/false }` for B/C. Build the cleanse config with `mode: 'remove'`, `count: 1`, `critCount: 2`, and a `procChance` for D.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --run src/utils/combat/__tests__/cleanseReactivePath.test.ts`
Expected: FAIL (crit-count not honored; proc gate not applied).

- [ ] **Step 3: Thread didCrit in the on-attacked listener**

At `triggers.ts` ~393, change the enqueue to also carry `didCrit`:

```ts
enqueue({ ...intent, eventCtx: { counterTargetId: e.attackerId, didCrit: e.didCrit } });
```

- [ ] **Step 4: Rewrite the cleanse executor branch (remove-mode portion)**

Replace the branch at ~1407. **CRITICAL ORDERING (see `passesProcChanceGate` doc ~1019):** in remove-mode the `!ctx.healing` early-return MUST come *before* the proc gate, or the rate accumulator desyncs between healing/non-healing passes.

```ts
if (cfg.type === 'cleanse') {
    const mode = cfg.mode ?? 'remove';
    // reduce-duration handled in Task 4; for now keep remove-mode correct.
    // remove mode — keep the !ctx.healing return BEFORE the proc gate (gate-desync rule).
    if (!ctx.healing) return;
    if (!passesProcChanceGate(intent, ctx)) return;
    const recipients = reactiveRecipients(intent, ctx, ctx.healing.targetId);
    const count =
        intent.eventCtx?.didCrit && cfg.critCount != null ? cfg.critCount : cfg.count;
    let removed = 0;
    for (const rid of recipients) removed += ctx.statusEngine.cleanse(rid, count);
    // Credit the ACTUAL removed count.
    ctx.healing.credit(intent.ownerId, 'cleanseCount', removed);
    return;
}
```

(Task 4 inserts the `reduce-duration` branch before the `!ctx.healing` remove-mode block. The `const mode` line is added now so the diff in Task 4 is small.)

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest --run src/utils/combat/__tests__/cleanseReactivePath.test.ts`
Expected: PASS. Also run the existing on-cast cleanse tests to confirm no regression:
`npx vitest --run src/utils/combat/__tests__/cleanseCastPath.test.ts src/utils/combat/__tests__/cleanseAll.test.ts src/utils/combat/__tests__/cleanseRemoval.test.ts`
Expected: PASS (byte-identical — `mode` defaults to remove, `critCount`/`didCrit` absent → `count`).

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/cleanseReactivePath.test.ts
git commit -m "feat(combat): reactive cleanse honors procChance + crit-count (Reactive Ward executor)"
```

---

## Task 4: cleanse executor reduce-duration mode

**Files:**
- Modify: `src/utils/combat/triggers.ts` (cleanse executor branch from Task 3)
- Test: `src/utils/combat/__tests__/cleanseReactivePath.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// F. reduce-duration mode reduces the newest self-debuff by durationTurns (default 1)
//    and credits cleanseCount = number affected (1). Use a self-target intent + an actor
//    carrying two timed debuffs; assert the newest lost a turn, the other unchanged.
// G. reduce-duration mode works WITHOUT ctx.healing (pure status mutation): build a ctx
//    with healing undefined → still calls reduceNewestDebuffDuration, no throw, no credit.
// H. reduce-duration with no eligible debuff → affected 0, no throw.
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --run src/utils/combat/__tests__/cleanseReactivePath.test.ts -t "reduce-duration"`
Expected: FAIL (mode ignored → falls into remove path / requires healing).

- [ ] **Step 3: Insert the reduce-duration branch**

In the cleanse branch, immediately after `const mode = cfg.mode ?? 'remove';` and BEFORE the `if (!ctx.healing) return;` remove block:

```ts
if (mode === 'reduce-duration') {
    // No shipped duration-reduction ability sets procChance (deterministic), so the gate is
    // pass-through and never advances — safe to consult regardless of healing mode.
    if (!passesProcChanceGate(intent, ctx)) return;
    // Pure status mutation — does NOT require healing mode. Self-target → [ownerId].
    const fallback = ctx.healing?.targetId ?? intent.ownerId;
    const recipients = reactiveRecipients(intent, ctx, fallback);
    let affected = 0;
    for (const rid of recipients)
        affected += ctx.statusEngine.reduceNewestDebuffDuration(rid, cfg.durationTurns ?? 1);
    ctx.healing?.credit(intent.ownerId, 'cleanseCount', affected);
    return;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest --run src/utils/combat/__tests__/cleanseReactivePath.test.ts`
Expected: PASS (F/G/H + all Task 3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/cleanseReactivePath.test.ts
git commit -m "feat(combat): reactive cleanse reduce-duration mode (Warpstrike half)"
```

---

## Task 5: New trigger `on-deal-damage`

**Files:**
- Modify: `src/types/abilities.ts` (`AbilityTrigger` union + runtime trigger array, ~49/~99)
- Modify: `src/utils/combat/triggers.ts` (listener switch ~251)
- Test: `src/utils/combat/__tests__/triggers.test.ts`

- [ ] **Step 1: Write the failing test**

In `triggers.test.ts`, register an ability with `trigger: 'on-deal-damage'` via `registerReactiveListeners`, emit `ability-performed` events on the bus, and assert enqueue behavior:

```ts
// - emits enqueue when actorId === ownerId AND damage > 0
// - does NOT enqueue when actorId !== ownerId
// - does NOT enqueue when damage is 0 / undefined
```

Follow the file's existing pattern for the `on-crit` / `on-attacked` listener tests (build the bus, register, emit, assert the intent queue).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest --run src/utils/combat/__tests__/triggers.test.ts -t "on-deal-damage"`
Expected: FAIL — `'on-deal-damage'` not assignable to `AbilityTrigger` (and no listener).

- [ ] **Step 3: Add the trigger to the type + runtime array**

`src/types/abilities.ts`: add `| 'on-deal-damage'` to the `AbilityTrigger` union (group it near `on-crit`/`on-debuff-inflicted` with a comment), **and `'on-deal-damage',` to the `LIVE_TRIGGERS` array (~line 98)**. The `LIVE_TRIGGERS` membership is load-bearing: `isReactiveAbility` (`triggers.ts` ~123) gates on `LIVE_TRIGGERS.has(trigger)`, so without it the ability is never partitioned as reactive and the listener never registers. Adding it only to the union is NOT enough.

- [ ] **Step 4: Add the listener**

In the `switch (ra.ability.trigger)` (`triggers.ts` ~251), add:

```ts
case 'on-deal-damage':
    bus.on('ability-performed', (e) => {
        // Warpstrike duration-reduction: fires on the OWNER's own damage-dealing turn.
        // runPlayerTurn emits exactly ONE aggregate ability-performed per turn (positional
        // path emits none — engine.ts ~2887), so this is once-per-turn for single- and
        // multi-hit/AoE alike — no guard needed. The while-debuffed requirement is an
        // ability condition (self-debuff), enforced at drain via gateConditions.
        if (e.actorId !== ownerId) return;
        // ability-performed.damage is optional (events.ts) and tsconfig is strict — guard with
        // ?? 0 (the codebase pattern for optional numeric event fields, cf. e.critHits ?? 0).
        if ((e.damage ?? 0) <= 0) return;
        enqueue(intent);
    });
    break;
```

- [ ] **Step 5: Run to verify it passes + tsc**

Run: `npx vitest --run src/utils/combat/__tests__/triggers.test.ts -t "on-deal-damage"` → PASS
Run: `npx tsc --noEmit` → PASS (any exhaustiveness switch over triggers now needs `on-deal-damage`; the editor stub in Task 7 covers the UI one — if tsc flags an editor switch here, add the stub now).

- [ ] **Step 6: Commit**

```bash
git add src/types/abilities.ts src/utils/combat/triggers.ts src/utils/combat/__tests__/triggers.test.ts
git commit -m "feat(combat): on-deal-damage reactive trigger (rides ability-performed)"
```

---

## Task 6: Registry — multi-ability builder + REACTIVE_WARD + WARPSTRIKE second ability

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (builder type ~77; consumer ~769; add REACTIVE_WARD + a WARPSTRIKE proc/const table + the WARPSTRIKE builder ~468)
- Test: a unit test for the registry — extend `src/utils/abilities/__tests__/equipmentCoverage.test.ts` or add `buildEquipmentAbilities.test.ts` if one exists; otherwise put the ability-shape assertions in `equipmentCoverage.test.ts` (it already calls `implantAbilityCount`).

- [ ] **Step 1: Write the failing tests**

```ts
// REACTIVE_WARD: produces 1 ability per rarity; trigger 'on-attacked', type 'cleanse',
//   mode 'remove', target 'self', count 1, critCount 2, procChance == rarity table
//   (common .05 / uncommon .07 / epic .12 / legendary .16; rare → no ability/undefined).
// WARPSTRIKE: produces 2 abilities per rarity — one modifier (existing, outgoingDamage,
//   self-debuff gate) AND one cleanse (mode 'reduce-duration', durationTurns 1, target
//   'self', trigger 'on-deal-damage', self-debuff condition, NO procChance).
```

Use `implantAbilityCount('REACTIVE_WARD', rarity)` and `('WARPSTRIKE', rarity)` plus a shape inspection of the built abilities (call `buildEquipmentAbilities` with a fake `getGearPiece` returning a piece whose `setBonus` is the implant name + the rarity, like the existing integration setup).

**Explicit edit:** the existing WARPSTRIKE assertion at `equipmentCoverage.test.ts` ~line 251 — `expect(implantAbilityCount('WARPSTRIKE', v.rarity)).toBe(1)` — must change to `.toBe(2)`, and its test title from "1 ability" to "2 abilities". Do NOT leave it at `.toBe(1)` (it will fail once WARPSTRIKE returns two abilities).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --run src/utils/abilities/__tests__/equipmentCoverage.test.ts`
Expected: FAIL (REACTIVE_WARD not in registry → 0 abilities; WARPSTRIKE still 1).

- [ ] **Step 3: Allow builders to return an array**

Change the builder type (~77):

```ts
type ImplantAbilityBuilder = (
    rarity: string
) => Omit<Ability, 'id'> | Omit<Ability, 'id'>[] | undefined;
```

Update the consumer (~769-780) to normalize + stamp ids (single → existing id byte-identical; array → index-suffixed):

```ts
const builder = IMPLANT_ABILITIES[implantName];
if (builder) {
    const res = builder(piece.rarity);
    if (!res) continue;
    const partials = Array.isArray(res) ? res : [res];
    partials.forEach((partial, i) => {
        abilities.push({
            ...partial,
            // Single-ability implants keep their exact id (byte-identical). Multi-ability
            // implants (Warpstrike) index-suffix so each gets a unique, stable id; proc-rate
            // gates key on (owner, ability.id), so ids must be distinct per ability.
            id:
                partials.length === 1
                    ? `equip-implant-${implantName}-${gearId}`
                    : `equip-implant-${implantName}-${gearId}-${i}`,
        });
    });
    continue;
}
```

- [ ] **Step 4: Add the REACTIVE_WARD rarity table + builder**

Near the other proc tables (top of file):

```ts
const REACTIVE_WARD_PROC: Record<string, number> = {
    common: 0.05,
    uncommon: 0.07,
    epic: 0.12,
    legendary: 0.16,
};
```

In `IMPLANT_ABILITIES`:

```ts
// Reactive cleanse: when directly damaged, X% chance to cleanse 1 debuff (2 if the hit
// was a crit). No rare variant exists in implants.ts.
REACTIVE_WARD: (rarity) => {
    const pc = REACTIVE_WARD_PROC[rarity];
    if (pc === undefined) return undefined;
    return {
        type: 'cleanse',
        target: 'self',
        trigger: 'on-attacked',
        conditions: [],
        procChance: pc,
        config: { type: 'cleanse', count: 1, critCount: 2, mode: 'remove' },
        autoFilled: true,
    };
},
```

- [ ] **Step 5: Make WARPSTRIKE return both abilities**

Rewrite the WARPSTRIKE builder (~468) to return an array: the existing modifier object PLUS the duration-reduction cleanse. Keep the existing modifier object verbatim. Add:

```ts
WARPSTRIKE: (rarity) => {
    const value = WARPSTRIKE_PCT[rarity];
    if (value === undefined) return undefined;
    const selfDebuffGate = {
        subject: 'self-debuff' as const,
        derivable: true,
        countComparator: 'gte' as const,
        countThreshold: 1,
    };
    return [
        // Damage half (D-PR2, unchanged): +X% outgoing direct damage while self-debuffed.
        {
            type: 'modifier',
            target: 'self',
            trigger: 'on-cast',
            conditions: [selfDebuffGate],
            config: { type: 'modifier', channel: 'outgoingDamage', value, isMultiplicative: false },
            autoFilled: true,
        },
        // Duration-reduction half: on dealing direct damage while self-debuffed, reduce the
        // newest self-debuff by 1 turn. Deterministic (no procChance).
        {
            type: 'cleanse',
            target: 'self',
            trigger: 'on-deal-damage',
            conditions: [selfDebuffGate],
            config: { type: 'cleanse', count: 0, mode: 'reduce-duration', durationTurns: 1 },
            autoFilled: true,
        },
    ];
},
```

(Confirm the `conditions`/config object literal types match the existing modifier entry — reuse the exact `subject: 'self-debuff'` shape already in the file. `count: 0` is an inert placeholder for the cleanse union's required `count`; reduce-duration mode ignores it. If the `cleanse` config type makes `count` required and `0` reads oddly, that's fine — it is never consulted in reduce-duration mode.)

- [ ] **Step 6: Run to verify they pass + tsc**

Run: `npx vitest --run src/utils/abilities/__tests__/equipmentCoverage.test.ts`
Run: `npx tsc --noEmit`
Expected: PASS (REACTIVE_WARD shape; WARPSTRIKE 2 abilities; ids index-suffixed for Warpstrike, unchanged for all single-ability implants).

- [ ] **Step 7: Commit**

```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/equipmentCoverage.test.ts
git commit -m "feat(combat): register Reactive Ward + Warpstrike duration-reduction (multi-ability builder)"
```

---

## Task 7: Editor stubs + coverage tracker

**Files:**
- Modify: `src/components/.../AbilityCard.tsx` (the `TRIGGER_OPTIONS` list — find via `grep -rn "TRIGGER_OPTIONS" src/components`)
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts` (implemented-implants set)

- [ ] **Step 1: Add the `on-deal-damage` editor stub**

Add an `on-deal-damage` entry to `TRIGGER_OPTIONS` (mirror the existing trigger entries, e.g. label "On dealing damage"). This keeps the manual ability editor's trigger dropdown exhaustive. (No `ConditionRow` change — `self-debuff` already exists.)

- [ ] **Step 2: Update the coverage tracker**

In `equipmentCoverage.test.ts`, add `REACTIVE_WARD` to the implemented-implants set in **all three** spots (the `.toEqual([...])` decl-order array, the `Set`, and the `it('exactly {…}')` string). The `.toEqual([...])` array and the `it` title follow `Object.keys(IMPLANTS)` order — REACTIVE_WARD lives at ~line 2468 of `implants.ts`, so insert it at the matching position (not appended). WARPSTRIKE is already in the set; its `implantAbilityCount` assertion was changed to `.toBe(2)` in Task 6.

- [ ] **Step 3: Run to verify**

Run: `npx vitest --run src/utils/abilities/__tests__/equipmentCoverage.test.ts`
Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components src/utils/abilities/__tests__/equipmentCoverage.test.ts
git commit -m "chore(combat): editor trigger stub + coverage tracker for reactive cleanse"
```

---

## Task 8: Engine integration tests (real registry)

**Files:**
- Test: `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`

Route everything through the REAL registry (`buildShipAbilitiesWithEquipment` + a ship whose equipped piece has `setBonus = 'REACTIVE_WARD' / 'WARPSTRIKE'` and the chosen rarity), overriding only `procChance: 1` for single-event determinism where needed — the D-PR16 Last Stand mutation-probe lesson: a hand-rolled ability can pass even when the wiring is broken, so assert the registry shape too.

- [ ] **Step 1: Write the Reactive Ward integration test**

```ts
// Build a battle where the Reactive-Ward carrier holds 2 timed debuffs and is directly hit.
// procChance forced to 1 (or assert statistically via the gate). 
// - Non-crit hit → exactly 1 debuff cleansed.
// - Crit hit → exactly 2 debuffs cleansed.
// Assert via the post-round status snapshot / cleanse credit on the result.
```

- [ ] **Step 2: Write the Warpstrike integration test**

```ts
// Build a battle where the Warpstrike carrier is itself debuffed (2 timed debuffs) and takes
// a damage-dealing turn against an enemy.
// - The newest self-debuff loses ONE EXTRA turn beyond the normal post-turn decrement
//   (i.e. -2 net this turn vs -1 for a non-Warpstrike control), OR is removed if it had 1 left.
//   (Account for the same-turn post-turn decrement — assert the DELTA vs a no-Warpstrike control
//   ship in the same setup, mirroring how D-PR13's Martyrdom/Disable test isolates the extra tick.)
// - The D-PR2 damage half still applies (outgoing damage is boosted while self-debuffed) — assert
//   both abilities are present from the registry and the damage modifier still fires.
```

Use a no-Warpstrike control ship in an otherwise identical setup to isolate the extra duration tick from the normal decrement (this avoids baking the decrement-timing quirk into the assertion).

- [ ] **Step 3: Add a registry-shape assertion**

Assert `buildShipAbilitiesWithEquipment` for a WARPSTRIKE-equipped ship yields both the `outgoingDamage` modifier and the `reduce-duration` cleanse (trigger `on-deal-damage`), and for REACTIVE_WARD yields the `on-attacked` cleanse with `critCount: 2`. This makes the mutation-probe bite.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest --run src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/__tests__/equipmentAbilities.integration.test.ts
git commit -m "test(combat): engine integration for Reactive Ward + Warpstrike duration-reduction"
```

---

## Task 9: Full verification + changelog

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

- [ ] **Step 1: Add a changelog entry**

Add a plain-English entry to `UNRELEASED_CHANGES` (match the existing entry style), e.g.:
"Battle simulator now models the Reactive Ward implant (chance to cleanse a debuff when hit, doubled on crits) and the duration-reduction half of Warpstrike (shaves a turn off one of your debuffs when you attack while debuffed)."

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: All pass except the known pre-existing env-failing FILES (missing Supabase URL + gitignored `docs/*.csv`). Confirm no NEW failures and **zero golden/.snap drift** (no `-u`, ever — if any golden moved, STOP and investigate; the spec predicts zero movement).

- [ ] **Step 3: tsc + lint + skills audit**

Run: `npx tsc --noEmit && npm run lint && npm run audit:skills`
Expected: tsc clean; lint clean (max-warnings 0); `audit:skills` 141/0 unchanged.

- [ ] **Step 4: Confirm zero golden drift explicitly**

Run: `git status --porcelain` after the suite — expect no modified `*.snap` / golden fixture files. If any appear, investigate before proceeding (do NOT commit a golden change for this PR).

- [ ] **Step 5: Commit**

```bash
git add src/constants/changelog.ts
git commit -m "docs(combat): changelog for reactive cleanse (Reactive Ward + Warpstrike)"
```

- [ ] **Step 6: Final review handoff**

Dispatch a holistic code review (the campaign's per-PR final-review step) and address findings before opening the PR.

---

## Definition of Done

- `reduceNewestDebuffDuration` primitive + unit tests.
- Reactive cleanse executor honors `procChance` (remove-mode, `!ctx.healing` before the gate) and `critCount`; supports `reduce-duration` mode (no healing dependency).
- `on-attacked` threads `didCrit`; new `on-deal-damage` trigger.
- REACTIVE_WARD registered (1 ability/rarity, no rare); WARPSTRIKE returns both halves (multi-ability builder; single-ability implant ids unchanged).
- Editor trigger stub + coverage tracker updated.
- Engine integration tests via the real registry (mutation-probe-resistant).
- Full suite green, tsc/lint clean, `audit:skills` 141/0, **zero golden/.snap drift**, changelog entry added.
- DPS page intentionally NOT wired (defensive/status-only effects).
