# C1 — Cleanse (Real Removal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `cleanse` actually remove debuffs (newest-applied-first, respecting the unremovable set) instead of only crediting a count, in both the healing calculator and the two-team battle sim.

**Architecture:** Add a monotonic `appliedSeq` to the status-store entries; build one shared `removeNewestFirst` primitive in `statusEngine` exposed as `cleanse(actorId, count)`; call it directly from the two cleanse firing sites (cast path in `playerTurn.ts`, reactive path in `executeIntent`). `statusEngine` is in scope at both sites, so no new engine delegate is needed (deviation from spec §5.4 — simpler).

**Tech Stack:** TypeScript, Vitest. Combat engine under `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-19-cleanse-purge-design.md` (sub-project C, C1 portion).

**Scope note (this is C1 only):** purge (C2) is a separate plan. C1 ships the shared `removeNewestFirst` primitive + `cleanse`; C2 adds `purge` as a thin mirror.

---

## Key decisions (read before starting)

- **No delegate.** Both firing sites call `statusEngine.cleanse(...)` directly (`statusEngine` is a `runPlayerTurn` binding and is on `IntentExecContext` as `ctx.statusEngine`). The spec's `ctx.cleanse` delegate is unnecessary.
- **Where cleanse engages:** wherever `healing`/`ctx.healing` is present = healing calculator AND the two-team battle sim (the sim sets `healTargetId`). DPS mode has no `healing` ctx → cleanse is inert → DPS goldens byte-identical.
- **Cast-path side gate:** cast-path removal runs only under `!healEventOnly` (player-side). Enemy-side actors run event-only and `recipientsFor` is not side-aware → **enemy-side cast cleanse removal is DEFERRED** (documented limitation; mirrors the existing enemy heal/shield event-only asymmetry). The reactive path's `ctx.playerIds` IS side-correct, so reactive cleanse works for both sides.
- **Metric vs event count:** the `cleanseCount` healing-metric credits the ACTUAL removed count (honest). The `cleanse-performed` event keeps firing on a player-side cleanse that removed ≥1 (count = removed); enemy-side event-only keeps the prior fire-on-action cadence (so Arum/Grif `on-enemy-cleansed` reactors are unaffected).
- **`appliedSeq` stamping:** every `BuffState` write/refresh stamps `appliedSeq` (required field); accumulating entries stamp at the `0 → positive` stack transition (optional field), not at seed and not on later gains.
- **Golden gate:** Tasks 1–2 byte-identical (primitive unwired; unremovable-set expansion). Tasks 3–5 produce AUDITED healing/battle-sim churn (real removal changes downstream HP/damage). NEVER blind `vitest -u` — explain every snapshot delta. `audit:skills` 0/141, `npm run lint`, `npx tsc --noEmit` clean every task.

**Test-runner gotcha:** bare `npm test` is Vitest WATCH (hangs). Use `npx vitest run <file-or-name>`.

---

## File structure

- **Modify** `src/utils/combat/statusEngine.ts` — add `appliedSeq` to `BuffState`/`AccumulatingState`; a monotonic counter; stamp at write sites; add `removeNewestFirst` + `cleanse` + interface declaration.
- **Modify** `src/utils/combat/cheatDeathBuffs.ts` — expand `UNREMOVABLE_STATUSES` (debuffs).
- **Modify** `src/utils/combat/playerTurn.ts` — cast-path cleanse arm (~:1577) calls `statusEngine.cleanse`.
- **Modify** `src/utils/combat/triggers.ts` — reactive cleanse branch (~:1117) calls `ctx.statusEngine.cleanse`.
- **Modify** `src/utils/skillTextParser.ts` — `CLEANSE_RE` accepts `all`; `parseCleanse` count widens.
- **Modify** `src/utils/abilities/buildShipAbilities.ts` — cleanse config count widens.
- **Modify** `src/types/abilities.ts` — `{type:'cleanse'|'purge'; count: number | 'all'}`.
- **Test (new)** `src/utils/combat/__tests__/cleanseRemoval.test.ts` — primitive unit tests.
- **Test (modify)** healing suites that exercise cleanse (`healing.test.ts`, `events.test.ts`, `enemyActions.test.ts`, `leech.test.ts`) — re-baseline audited churn.
- **Changelog:** `src/constants/changelog.ts` `UNRELEASED_CHANGES` (cleanse now removes debuffs) — user-facing.

---

## Task 0: Baseline

- [ ] **Step 1: Confirm green baseline**

Run: `npx vitest run` (full suite) — confirm all pass. Record the count (memory: ~2540).
Run: `npm run lint` → 0 problems. Run: `npx tsc --noEmit` → clean. Run: `npm run audit:skills` → 0/141.

- [ ] **Step 2: Inventory cleanse-exercising tests (no change, just note)**

Run: `grep -rln "cleanse\|Cleanse\|cleanseCount\|cleanse-performed" src/utils/combat/__tests__ src/utils/calculators/__tests__`
Note which suites assert on `cleanseCount` / cleanse behavior — these are the Task-3/4/5 churn candidates.

---

## Task 1: `appliedSeq` + `removeNewestFirst` + `cleanse` primitive (unwired)

**Files:**
- Modify: `src/utils/combat/statusEngine.ts`
- Test: `src/utils/combat/__tests__/cleanseRemoval.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/__tests__/cleanseRemoval.test.ts`. Use the `createStatusEngine` setup pattern from `statusEngine.test.ts`. The primitive operates on the per-actor enemy store (debuffs). Drive debuffs onto an actor id via `applyTimedAbilityStatus` (ability channel) and assert `cleanse` removes newest-first.

```typescript
import { describe, it, expect } from 'vitest';
import { createStatusEngine } from '../statusEngine';
// Use a minimal RegisteredAbilityStatus shape — copy the timed-status construction
// pattern from statusEngine.test.ts (search for applyTimedAbilityStatus usage).

const mkTimed = (buffName: string, duration = 3) => ({
    kind: 'timed' as const,
    duration,
    payload: { buffName, stacks: 1, parsedEffects: {} },
    // casterId optional; conditions omitted
});

describe('statusEngine.cleanse (newest-first removal)', () => {
    it('removes the N most-recently-applied debuffs from a victim, newest first', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        // Apply three distinct debuffs in order onto victim 'v1' (enemy-side, per-victim).
        eng.applyTimedAbilityStatus(1, mkTimed('Attack Down') as any, 'attacker', 'v1');
        eng.applyTimedAbilityStatus(1, mkTimed('Defense Down') as any, 'attacker', 'v1');
        eng.applyTimedAbilityStatus(1, mkTimed('Speed Down') as any, 'attacker', 'v1');
        const removed = eng.cleanse('v1', 2);
        expect(removed).toBe(2);
        // The two NEWEST (Defense Down, Speed Down) are gone; the oldest (Attack Down) remains.
        const names = eng.timedAbilityStatuses('enemy', 'attacker', 'v1').map((s) => s.buffName);
        expect(names).toEqual(['Attack Down']);
    });
});
```

(Adjust the `mkTimed`/assertion accessor to whatever `statusEngine.test.ts` actually uses for reading per-victim timed statuses — confirm the exact `RegisteredAbilityStatus` shape and the read accessor before writing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/cleanseRemoval.test.ts`
Expected: FAIL — `eng.cleanse is not a function`.

- [ ] **Step 3: Add `appliedSeq` fields + counter**

In `statusEngine.ts`, add a REQUIRED `appliedSeq` to `BuffState` (it is stamped at every write) and an OPTIONAL `appliedSeq?` to `AccumulatingState` (stamped at first stack):

```typescript
interface BuffState {
    buffName: string;
    turnsRemaining: number;
    tier: number;
    payload?: AbilityStatusPayload;
    casterId?: string;
    /** Monotonic application order, newest = largest. Stamped at every write/refresh.
     *  Drives cleanse/purge newest-applied-first removal. */
    appliedSeq: number;
}

interface AccumulatingState {
    // ...existing fields...
    /** Application order, stamped at the 0→positive stack transition (when the status first
     *  becomes active). Undefined while seeded-but-inert (stacks 0). */
    appliedSeq?: number;
}
```

Inside `createStatusEngine`, near the other closure state, add:

```typescript
    // Monotonic application sequence for newest-first cleanse/purge ordering.
    let appliedSeqCounter = 0;
    const nextAppliedSeq = (): number => ++appliedSeqCounter;
```

- [ ] **Step 4: Stamp at the BuffState write sites**

In `applyTimedAbilityStatus` (the `map.set(familyKey, {...})` ~:993) add `appliedSeq: nextAppliedSeq(),`.
In `upsertBuff` (the timed `map.set(familyKey, {...})` ~:615) add `appliedSeq: nextAppliedSeq(),`.
(Both are the create-and-refresh paths — a family-refresh re-`set`s, so it re-stamps = newest. Good.)

- [ ] **Step 5: Stamp accumulating at the 0→positive transition**

In `incrementPerRound` (~:573) and `incrementSlot` (~:649), capture the pre-increment stacks and stamp on the 0→positive edge:

```typescript
        const incrementPerRound = (map: Map<string, AccumulatingState>) => {
            for (const state of map.values()) {
                if (state.trigger !== 'per-round') continue;
                const before = state.stacks;
                state.stacks =
                    state.maxStacks !== undefined
                        ? Math.min(state.stacks + state.rate, state.maxStacks)
                        : state.stacks + state.rate;
                if (before === 0 && state.stacks > 0) state.appliedSeq = nextAppliedSeq();
            }
        };
```

Apply the identical `before === 0 && state.stacks > 0` stamp inside `incrementSlot`'s `if (fires) { ... }` block. Do NOT stamp at the seed sites (~:390/:418/:921) — they create at `stacks: 0` (inert).

- [ ] **Step 6: Add `removeNewestFirst` + `cleanse`**

Add near `removeTimedEnemyStatus` (~:898):

```typescript
    /** Remove up to `count` removable statuses for `actorId` on the chosen side, NEWEST-APPLIED
     *  FIRST. `side: 'debuffs'` → the actor's enemy-side timed + accumulating stores (cleanse);
     *  `side: 'buffs'` → its self-side stores (purge, wired in C2). Skips UNREMOVABLE_STATUSES,
     *  'permanent'-duration entries, and inert (stacks 0) accumulating entries; persistent-stack
     *  maps are never gathered (unremovable by construction). Auras/always-active are not in these
     *  maps (they re-derive). `count === 'all'` removes every removable candidate. Returns the
     *  number actually removed. Unknown id → no-op (returns 0). */
    const removeNewestFirst = (
        actorId: string,
        side: 'debuffs' | 'buffs',
        count: number | 'all'
    ): number => {
        const timedMap = side === 'debuffs' ? enemyMaps.get(actorId) : selfMaps.get(actorId);
        const accumMap =
            side === 'debuffs' ? accumEnemyMaps.get(actorId) : accumSelfMaps.get(actorId);
        const candidates: { seq: number; remove: () => void }[] = [];
        if (timedMap) {
            for (const [key, s] of timedMap) {
                if (isUnremovable(s.buffName, s.turnsRemaining)) continue;
                candidates.push({ seq: s.appliedSeq, remove: () => timedMap.delete(key) });
            }
        }
        if (accumMap) {
            for (const [key, s] of accumMap) {
                if (s.stacks <= 0 || s.appliedSeq === undefined) continue;
                if (isUnremovable(s.buffName, 0)) continue; // accum never expires → name-gate only
                candidates.push({ seq: s.appliedSeq, remove: () => accumMap.delete(key) });
            }
        }
        candidates.sort((a, b) => b.seq - a.seq);
        const limit = count === 'all' ? candidates.length : Math.min(count, candidates.length);
        for (let i = 0; i < limit; i++) candidates[i].remove();
        return limit;
    };

    const cleanse = (actorId: string, count: number | 'all'): number =>
        removeNewestFirst(actorId, 'debuffs', count);
```

Declare `cleanse` on the `StatusEngine` interface (next to `removeTimedEnemyStatus`):

```typescript
    /** Remove up to `count` removable debuffs from `actorId`'s per-victim enemy store, newest
     *  first (see removeNewestFirst). `'all'` removes every removable debuff. Returns count removed. */
    cleanse(actorId: string, count: number | 'all'): number;
```

Add `cleanse,` to the returned engine object literal.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/cleanseRemoval.test.ts` → PASS.

- [ ] **Step 8: Add the rest of the primitive unit tests**

Extend the test file with cases (each its own `it`):
- count cap (cleanse 1 of 3 removes only the newest).
- `'all'` removes every removable.
- unremovable skipped: a debuff in `UNREMOVABLE_STATUSES` (e.g. `Acidic Decay`) is NOT removed and does NOT count toward the limit.
- `'permanent'`-duration debuff skipped (construct via `upsertBuff`/a recurring source if reachable, else document why untestable at unit level).
- DoT removal: a `Corrosion`/`Inferno` debuff is removable (same store).
- accumulating: a non-persistent accumulating debuff with `stacks>0` is removable and ordered by its first-stack `appliedSeq`; a persistent-stacking debuff (`Defense Shred`) is NOT removed (separate map, not gathered).
- unknown id → returns 0, no throw.

Run: `npx vitest run src/utils/combat/__tests__/cleanseRemoval.test.ts` → all PASS.

- [ ] **Step 9: Verify byte-identical (primitive unwired)**

Run: `npx vitest run` (full). Expected: baseline count + the new tests, ZERO `.snap` movement, lint/tsc/audit clean.

- [ ] **Step 10: Commit**

```bash
git add -f src/utils/combat/statusEngine.ts src/utils/combat/__tests__/cleanseRemoval.test.ts
git commit --no-verify -m "C1 T1: appliedSeq + removeNewestFirst/cleanse primitive (unwired)"
```

---

## Task 2: Expand `UNREMOVABLE_STATUSES` (debuffs)

**Files:**
- Modify: `src/utils/combat/cheatDeathBuffs.ts:9-15`
- Test: `src/utils/combat/__tests__/cleanseRemoval.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `cleanseRemoval.test.ts`: applying `Barrier Recharging` and `Damage to Dot` debuffs onto a victim, then `cleanse(id, 'all')`, leaves both in place.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/cleanseRemoval.test.ts` → the new case FAILS (currently removable).

- [ ] **Step 3: Expand the set**

```typescript
export const UNREMOVABLE_STATUSES: ReadonlySet<string> = new Set<string>([
    'Acidic Decay',
    'Magnetized Shielding',
    // In-game "Unremovable" debuffs (game UI, 2026-06-19) — survive cleanse/purge/Cheat Death.
    'Barrier Recharging',
    'Damage to Dot',
]);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/cleanseRemoval.test.ts` → PASS.

- [ ] **Step 5: Verify byte-identical (incl. Cheat Death wipe)**

`UNREMOVABLE_STATUSES` is also consulted by `clearRemovable` (Cheat-Death revive wipe). Run the full suite: `npx vitest run`. If any golden churns, it means a fixture revived an actor carrying `Barrier Recharging`/`Damage to Dot` that USED to be wiped — audit it (almost certainly none). Expected: byte-identical. lint/tsc clean.

- [ ] **Step 6: Commit**

```bash
git add -f src/utils/combat/cheatDeathBuffs.ts src/utils/combat/__tests__/cleanseRemoval.test.ts
git commit --no-verify -m "C1 T2: expand UNREMOVABLE_STATUSES (Barrier Recharging, Damage to Dot)"
```

---

## Task 3: Wire the cast path (player-side real removal)

**Files:**
- Modify: `src/utils/combat/playerTurn.ts:1577-1582`
- Test (modify): the healing suites that exercise cleanse (from Task 0 inventory)

- [ ] **Step 1: Write a failing integration test**

Add a healing-mode test (in the most appropriate existing healing suite, or a new `cleanseCastPath.test.ts`): a player healer with a cleanse ability, an enemy attacker that applies a removable debuff (e.g. `Attack Down`) to the heal target. After the cleanser's turn, the debuff is gone from the heal target's store, and `cleanseCount` reflects the actual removed count (1).

Use the existing healing-mode harness (look at `healing.test.ts` for how to build a healer + enemy attacker + heal target via the engine adapter / `runCombat`).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run <that test>` → FAIL (debuff still present; cleanse credits nominal count, removes nothing).

- [ ] **Step 3: Implement the cast-path removal**

Replace the cleanse arm at `playerTurn.ts:1577-1582`:

```typescript
            } else if (cfg.type === 'cleanse') {
                // Real removal is player-side only (recipientsFor returns player ids; enemy-side
                // actors run event-only and side-correct enemy routing is deferred). The metric
                // and the cleanse-performed event reflect the ACTUAL number removed.
                if (!healEventOnly) {
                    let removed = 0;
                    for (const rid of recipientsFor(ability.target)) {
                        removed += statusEngine.cleanse(rid, cfg.count);
                    }
                    cleansePerformedCount += removed;
                    healing.credit(actor.id, 'cleanseCount', removed);
                } else {
                    // Enemy-side event-only: no removal yet — preserve the cleanse-performed
                    // cadence so on-enemy-cleansed reactors (Arum/Grif) stay unaffected.
                    cleansePerformedCount += cfg.count;
                }
            }
```

(At this point `cfg.count` is still `number`; Task 5 widens it. The `else` branch's `+= cfg.count` is replaced in Task 5 to handle `'all'`.)

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `npx vitest run <that test>` → PASS.

- [ ] **Step 5: Re-baseline audited healing-golden churn**

Run: `npx vitest run`. Healing/battle-sim goldens where a player cleanse coexists with a removable debuff WILL churn (debuff removed → different downstream incoming damage / HP curves / `cleanseCount`). For EACH churned snapshot: open the diff, confirm the delta is explained by a legitimate removal (a debuff that should now be gone, a `cleanseCount` that now equals the real removed count, a `cleanse-performed` that no longer fires when nothing was removable). Update the snapshot ONLY after confirming each delta line-by-line. NEVER blind `vitest -u`. Document the audited deltas in the commit message.

- [ ] **Step 6: lint/tsc/audit**

Run: `npm run lint` (0), `npx tsc --noEmit` (clean), `npm run audit:skills` (0/141).

- [ ] **Step 7: Commit**

```bash
git add -f src/utils/combat/playerTurn.ts <changed test/snap files>
git commit --no-verify -m "C1 T3: cast-path cleanse removes debuffs (player-side); audited golden churn"
```

---

## Task 4: Wire the reactive path

**Files:**
- Modify: `src/utils/combat/triggers.ts:1117-1121`
- Test: a reactive-cleanse integration test (Pallas: on-ally-critically-repaired → cleanse 1 from self)

- [ ] **Step 1: Write the failing test**

A reactive cleanse fixture (the `on-cast`-vs-reactive distinction lives in `buildShipAbilities`; Pallas's cleanse rides `on-ally-critically-repaired`). Construct a healing-mode scenario where the reactive cleanse fires while a removable debuff sits on the recipient, and assert it is removed + `cleanseCount` credited the removed count.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run <that test>` → FAIL (reactive cleanse only credits today).

- [ ] **Step 3: Implement the reactive-path removal**

Replace `triggers.ts:1117-1121`:

```typescript
    if (cfg.type === 'cleanse') {
        if (!ctx.healing) return; // healing mode off → not-simulated follow-up
        // ctx.playerIds is the SAME-SIDE ally id order (sideCtx.recipientIds) — side-correct for
        // both player and enemy reactive drains. ctx.statusEngine is the live store.
        const recipients =
            intent.ability.target === 'ally'
                ? [intent.eventCtx?.damagedAllyId ?? ctx.healing.targetId]
                : intent.ability.target === 'all-allies'
                  ? ctx.playerIds
                  : [intent.ownerId];
        let removed = 0;
        for (const rid of recipients) removed += ctx.statusEngine.cleanse(rid, cfg.count);
        ctx.healing.credit(intent.ownerId, 'cleanseCount', removed);
        return;
    }
```

(Recipient resolution mirrors the heal branch at `triggers.ts:1068`. `cfg.count` widens in Task 5.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run <that test>` → PASS.

- [ ] **Step 5: Re-baseline audited churn + checks**

Run: `npx vitest run`. Audit any churn (reactive cleanse now removes). lint/tsc/audit clean.

- [ ] **Step 6: Commit**

```bash
git add -f src/utils/combat/triggers.ts <changed test/snap files>
git commit --no-verify -m "C1 T4: reactive-path cleanse removes debuffs (side-correct); audited churn"
```

---

## Task 5: `"cleanse all"` support

**Files:**
- Modify: `src/utils/skillTextParser.ts:1995,2002-2030`
- Modify: `src/utils/abilities/buildShipAbilities.ts:1024-1042`
- Modify: `src/types/abilities.ts:241`
- Modify: `src/utils/combat/playerTurn.ts` (the Task-3 `else` branch)
- Test: parser test + a "cleanse all" integration test

- [ ] **Step 1: Write the failing parser test**

In the skill-parser test suite, assert `parseCleanse('cleanses all debuffs from all allies')` returns `[{ count: 'all', target: 'all-allies', explicitTarget: true }]`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run <parser test>` → FAIL ("all" not captured; returns []).

- [ ] **Step 3: Widen the count type**

`abilities.ts:241`:
```typescript
    | { type: 'cleanse' | 'purge'; count: number | 'all' }
```

`skillTextParser.ts`:
```typescript
const CLEANSE_RE = /\bcleanses?\s+(\d+|all)\b/gi;
```
and in `parseCleanse`, change the return type's `count` to `number | 'all'`, and the parse:
```typescript
        const raw = m[1].toLowerCase();
        const count: number | 'all' = raw === 'all' ? 'all' : parseInt(raw, 10);
        if (count !== 'all' && (!count || isNaN(count))) continue;
```
(update the `results` array element type to `count: number | 'all'`.)

`buildShipAbilities.ts:1024-1042`: `config: { type: 'cleanse', count: c.count }` already passes through — `c.count` is now `number | 'all'`; no change beyond tsc following the widened type.

- [ ] **Step 4: Fix the Task-3 `else` branch for `'all'`**

In `playerTurn.ts`, the enemy-side event-only branch `cleansePerformedCount += cfg.count` cannot add `'all'`:

```typescript
                } else {
                    cleansePerformedCount += typeof cfg.count === 'number' ? cfg.count : 1;
                }
```

- [ ] **Step 5: Run tsc — confirm the widening is clean**

Run: `npx tsc --noEmit`. Expected: clean. (The metric/event sites all consume `removed: number` or the guarded `else`, so no `number | 'all'` leaks into a numeric context. `statusEngine.cleanse` accepts `number | 'all'`.)

- [ ] **Step 6: Add the "cleanse all" integration test**

A ship whose text is "cleanses all debuffs" (e.g. AEGIS-style) now emits a cleanse ability and removes every removable debuff on the recipient(s). Assert all removable debuffs gone, unremovable ones retained, `cleanseCount` = number removed.

- [ ] **Step 7: Run parser + integration tests**

Run: `npx vitest run <parser test> <integration test>` → PASS.

- [ ] **Step 8: Re-baseline audited churn**

Ships that previously failed to parse "cleanses all …" now emit a cleanse ability → new behavior in `audit:skills` and any golden involving them. Run: `npx vitest run` and `npm run audit:skills`. Audit churn (a newly-parsed cleanse is legitimate). Confirm `audit:skills` still 0/141 (the new ability is wired, not a finding). lint/tsc clean.

- [ ] **Step 9: Commit**

```bash
git add -f src/utils/skillTextParser.ts src/utils/abilities/buildShipAbilities.ts src/types/abilities.ts src/utils/combat/playerTurn.ts <test/snap files>
git commit --no-verify -m "C1 T5: parse and apply 'cleanse all'; widen count to number|'all'"
```

---

## Task 6: Changelog + closeout

- [ ] **Step 1: Changelog entry**

Add to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` a plain-English line, e.g. "Cleanse now actually removes debuffs (newest first, respecting unremovable statuses) in the healing and battle simulators, instead of only counting them."

- [ ] **Step 2: Full gate**

Run: `npx vitest run` (all green), `npm run lint` (0), `npx tsc --noEmit` (clean), `npm run audit:skills` (0/141).

- [ ] **Step 3: Commit**

```bash
git add src/constants/changelog.ts
git commit --no-verify -m "C1: changelog — cleanse removes debuffs"
```

---

## Known limitations carried into C2 / later

- **Enemy-side CAST cleanse removal is deferred** (recipientsFor not side-aware; enemy actors run event-only). Reactive enemy cleanse works (ctx.playerIds is side-correct). A later enemy-side / team-unification pass closes the cast-path gap.
- **AoE cleanse** (cleansing multiple victims from one cast) is single-anchor today; multi-victim is sub-project E.
- The `removeNewestFirst` primitive already supports `side: 'buffs'` — C2 adds the `purge` wrapper + parser + reactive/cast wiring + `purge-performed` event + reactors (Salvation/Sefuba) with the chain guard.
