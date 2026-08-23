# Enemy-side heal-channel audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three enemy-applied heal-modifier channels (`Inc. Repair Down`,
`Out. Repair Down`) actually reduce repairs, and make Repair-Over-Time tick on both sides and on
off-anchor holders.

**Architecture:** One new per-victim read of the status engine's enemy-applied ability stores,
folded into the acting actor's own turn totals at the single seam that already folds `preFight`.
That one fold reaches all five downstream incoming-heal readers, because `playerTurn` publishes
its total into `lastTurnCtxByActor`, which is the first arm of the engine's
`recipientIncomingHealPct`. Separately, the HoT tick block loses its `healEventOnly` wrapper and
its anchor-only application, following the E5 heal-lift template already used by the enemy
cast-heal arm.

**Tech Stack:** TypeScript, Vitest, React (no UI change in this plan).

**Spec:** `docs/superpowers/specs/2026-08-23-enemy-side-heal-channel-audit-design.md` — read it
first. Issues: #367, #369.

## Global Constraints

- **R1 (locked game rule).** Non-stackable statuses sharing a name family overwrite each other by
  **highest tier**; survivors combine **additively**. Do NOT implement tier logic — the status
  engine already family-keys and tier-upserts (`deriveFamilyKey`, `statusEngine.ts:351`), so
  shadowing has happened before any fold you write. Every fold in this plan is a plain sum.
- **R2 (locked game rule).** A Repair-Over-Time tick is **not** a "performed repair": it fires no
  on-repaired trigger. Never emit `heal-performed` and never set `repairedThisRound` from the HoT
  block.
- **Team symmetry** is a locked project convention: an ability must behave identically whichever
  side carries it.
- `PERCENTAGE_ONLY_STATS` are stored as **integers** — `-50` means −50%, not `-0.5`.
- **Never run `vitest -u`.** Snapshot/golden changes are inspected by hand.
- The full suite is the pre-commit gate (husky). `npm test` = `vitest --run`. Baseline on this
  branch: **570 files, 6353 tests passing.**
- No emojis in UI text (no UI text in this plan, but the changelog entry counts).
- Branch: `feat/enemy-side-heal-channel-audit`, already created, spec committed at `eb768901`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/utils/combat/triggers.ts` | Modify (add one exported function near `ownerDebuffNamesFor`, ~line 2532) | The per-victim enemy-applied heal-modifier read. Lives here because this is where the other per-victim status readers (`ownerDebuffNamesFor`, `victimEnemyBuffs`, `victimSelfBuffs`) already live, and it is import-cycle safe. |
| `src/utils/combat/playerTurn.ts` | Modify (args interface ~713; fold seam ~1789; `holderIncomingFactor` ~4105; `tickHot` tail ~4128-4148; block gate ~4150; cast-heal factors ~4270, ~4330) | Consumes the new modifier as a turn input; owns the clamp helper and the HoT lift. |
| `src/utils/combat/engine.ts` | Modify (helper near ~3333; `recipientIncomingHealPct` ~3329; `buildTurnArgs` ~8388) | Computes the per-victim term and threads it into both walks; patches the pre-first-turn fallback arm. |
| `src/utils/combat/__tests__/enemyAppliedHealModifiers.test.ts` | Create | Unit tests for the new read (Task 1). |
| `src/utils/combat/__tests__/enemyAppliedIncomingRepair.test.ts` | Create | #367 integration tests (Tasks 2–4). |
| `src/utils/combat/__tests__/enemySideHotTick.test.ts` | Create | #369 integration tests (Task 5). |
| `src/utils/combat/__tests__/reversedRepairs.channels.test.ts` | Modify (~line 583) | The #362 fence asserting the enemy HoT channel is dead — replaced with the real enemy arm (Task 5). |
| `src/constants/changelog.ts` | Modify (`UNRELEASED_CHANGES`) | User-visible changelog entry (Task 6). |

---

### Task 1: The per-victim enemy-applied heal-modifier read

Pure function, no engine wiring. A reviewer can accept or reject this in isolation.

**Files:**
- Modify: `src/utils/combat/triggers.ts` (insert immediately after `ownerDebuffNamesFor`, which
  ends at ~line 2532, before the `// DEFAULT_ENEMY_TARGET is imported…` comment)
- Test: `src/utils/combat/__tests__/enemyAppliedHealModifiers.test.ts` (create)

**Interfaces:**
- Consumes: `StatusEngine` (already imported in `triggers.ts`), `NEUTRAL_NAMES_CTX`
  (module-local, `triggers.ts:2401`).
- Produces: `victimOwnEnemyHealModifiers(statusEngine: StatusEngine, victimId: string): { incomingHealPct: number; outgoingHealPct: number }`
  — consumed by Task 2 and Task 3.

**Why not reuse `victimEnemyBuffs`.** It looks like the right function and is the wrong one. Its
*scheduled* arm reads the **global `__enemy__`** bucket (`triggers.ts:2576`, deliberate — see its
jsdoc), not the per-victim store. For a **player** victim that bucket holds the debuffs the
**player side inflicted on enemies**, so folding it here would apply a player team's own inflicted
`Inc. Repair Down` to one of its own ships. Read the per-victim payload stores directly instead.

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/__tests__/enemyAppliedHealModifiers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createStatusEngine } from '../statusEngine';
import { victimOwnEnemyHealModifiers } from '../triggers';
import type { RegisteredAbilityStatus } from '../statusEngine';

// A timed enemy-side ability debuff carrying a parsed heal-channel effect. `side: 'enemy'` is
// what routes it into the per-victim enemy store keyed by the targetId passed to
// applyTimedAbilityStatus.
const timedEnemyDebuff = (
    buffName: string,
    parsedEffects: Record<string, number>,
    stacks = 1
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    kind: 'timed',
    side: 'enemy',
    sourceSlot: 'active',
    conditions: [],
    duration: 3,
    casterId: 'attacker',
    payload: { buffName, stacks, parsedEffects },
});

const engineWith = (victimId: string, ...statuses: ReturnType<typeof timedEnemyDebuff>[]) => {
    const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [], teamSources: [] });
    se.beginRound(1);
    for (const s of statuses) se.applyTimedAbilityStatus(1, s, victimId);
    return se;
};

describe('victimOwnEnemyHealModifiers (#367)', () => {
    it('returns zeros for an actor carrying nothing', () => {
        const se = engineWith('nobody');
        expect(victimOwnEnemyHealModifiers(se, 'tank')).toEqual({
            incomingHealPct: 0,
            outgoingHealPct: 0,
        });
    });

    it('reads an enemy-applied Inc. Repair Down II off the victim', () => {
        const se = engineWith('tank', timedEnemyDebuff('Inc. Repair Down II', { incomingHeal: -50 }));
        expect(victimOwnEnemyHealModifiers(se, 'tank').incomingHealPct).toBe(-50);
    });

    it('reads an enemy-applied Out. Repair Down II off the victim', () => {
        const se = engineWith('medic', timedEnemyDebuff('Out. Repair Down II', { outgoingHeal: -50 }));
        expect(victimOwnEnemyHealModifiers(se, 'medic').outgoingHealPct).toBe(-50);
    });

    it('is keyed per victim — a debuff on the tank is invisible on the medic', () => {
        const se = engineWith('tank', timedEnemyDebuff('Inc. Repair Down II', { incomingHeal: -50 }));
        expect(victimOwnEnemyHealModifiers(se, 'medic').incomingHealPct).toBe(0);
    });

    it('R1: a lower tier is already absent from the store, so the fold sees only the higher one', () => {
        // Both applications are made; the family-key/tier upsert keeps only Down II. The fold does
        // NOT implement this rule — it inherits it. If this ever returns -75, the status engine's
        // tier upsert changed and the additive fold is no longer safe.
        const se = engineWith(
            'tank',
            timedEnemyDebuff('Inc. Repair Down II', { incomingHeal: -50 }),
            timedEnemyDebuff('Inc. Repair Down I', { incomingHeal: -25 })
        );
        expect(victimOwnEnemyHealModifiers(se, 'tank').incomingHealPct).toBe(-50);
    });

    it('sums DIFFERENT families additively and multiplies each by its stacks', () => {
        const se = engineWith(
            'tank',
            timedEnemyDebuff('Inc. Repair Down II', { incomingHeal: -50 }),
            timedEnemyDebuff('Out. Repair Down II', { outgoingHeal: -20 }, 2)
        );
        expect(victimOwnEnemyHealModifiers(se, 'tank')).toEqual({
            incomingHealPct: -50,
            outgoingHealPct: -40,
        });
    });

    it('ignores debuffs with no heal-channel effect', () => {
        const se = engineWith('tank', timedEnemyDebuff('Defense Shred', { defense: -30 }));
        expect(victimOwnEnemyHealModifiers(se, 'tank')).toEqual({
            incomingHealPct: 0,
            outgoingHealPct: 0,
        });
    });
});
```

**Note on the fixture:** `createStatusEngine`'s input shape and `applyTimedAbilityStatus`'s exact
arity are established in this repo — copy them from an existing status-engine unit test rather
than trusting the sketch above if `tsc` disagrees. `src/utils/combat/__tests__/` has several;
grep for `createStatusEngine(` in `__tests__` and follow the closest one.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/utils/combat/__tests__/enemyAppliedHealModifiers.test.ts
```

Expected: FAIL — `victimOwnEnemyHealModifiers is not a function` / no exported member.

- [ ] **Step 3: Write the implementation**

In `src/utils/combat/triggers.ts`, immediately after `ownerDebuffNamesFor`:

```ts
/** Enemy-APPLIED heal-channel modifiers carried by `victimId` in its OWN per-victim enemy store
 *  (#367). Returns additive percentage points for the two channels an enemy debuff can move:
 *  `incomingHealPct` (`Inc. Repair Down/Up` — repairs LANDING on this actor) and
 *  `outgoingHealPct` (`Out. Repair Down` — repairs this actor PERFORMS).
 *
 *  PAYLOAD CHANNELS ONLY, deliberately — the two per-victim ability stores (timed, where all ten
 *  corpus appliers land, and aura/accumulating). The SCHEDULED channel is excluded for two
 *  reasons: (1) `upsertBuff` is hardcoded to the global `__enemy__` key, so the per-victim
 *  scheduled store is empty in every run today; (2) reading the GLOBAL `__enemy__` bucket here —
 *  as `victimEnemyBuffs` does for the DAMAGE channel — would be actively WRONG for this purpose:
 *  for a PLAYER victim that bucket holds the debuffs the PLAYER side inflicted on ENEMIES, so a
 *  player ship would have its own team's inflicted `Inc. Repair Down` applied to itself. Do not
 *  "unify" this with `victimEnemyBuffs` without re-reading that function's jsdoc.
 *
 *  TIER SHADOWING IS INHERITED, NOT IMPLEMENTED. `applyTimedAbilityStatus` already family-keys
 *  and tier-upserts (`deriveFamilyKey`), so an `Inc. Repair Down I` is already absent from the
 *  store whenever an `Inc. Repair Down II` is live. The fold is therefore a plain additive sum,
 *  which is the locked game rule (spec R1: same-family statuses overwrite by highest tier, then
 *  survivors add).
 *
 *  Team-agnostic: the enemy store is keyed by targetId regardless of which side the victim is on,
 *  so this reads a player-inflicted debuff on an enemy ship identically.
 *
 *  Carries the same NEUTRAL-ctx approximation as `victimEnemyBuffs`/`ownerDebuffNamesFor` on the
 *  aura/accumulating branch. It does not bite here: every corpus status in these two channels
 *  (`Inc. Repair Down I/II/III`, `Out. Repair Down II`) is TIMED, and the timed channel is gated
 *  at application time, before this read. */
export function victimOwnEnemyHealModifiers(
    statusEngine: StatusEngine,
    victimId: string
): { incomingHealPct: number; outgoingHealPct: number } {
    let incomingHealPct = 0;
    let outgoingHealPct = 0;
    const fold = (s: ActiveAbilityStatus): void => {
        const { parsedEffects, stacks } = s.payload;
        incomingHealPct += (parsedEffects.incomingHeal ?? 0) * stacks;
        outgoingHealPct += (parsedEffects.outgoingHeal ?? 0) * stacks;
    };
    for (const s of statusEngine.timedAbilityStatuses('enemy', undefined, victimId)) fold(s);
    for (const s of statusEngine.activeAbilityStatuses(
        'enemy',
        () => NEUTRAL_NAMES_CTX,
        undefined,
        victimId
    ))
        fold(s);
    return { incomingHealPct, outgoingHealPct };
}
```

If `ActiveAbilityStatus` is not already imported in `triggers.ts`, add it to the existing
`import type { … } from './statusEngine'`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/utils/combat/__tests__/enemyAppliedHealModifiers.test.ts
npx tsc --noEmit
```

Expected: all tests PASS, `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/enemyAppliedHealModifiers.test.ts
git commit -m "feat(engine): read enemy-applied heal-channel modifiers per victim (#367)"
```

---

### Task 2: Wire the incoming channel — one fold, five readers

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (args interface after `preFight?:` at ~713; fold seam
  after the `if (args.preFight)` block at ~1786-1790)
- Modify: `src/utils/combat/engine.ts` (`recipientIncomingHealPct` ~3329-3332; `buildTurnArgs`
  args literal near the `preFight` spread at ~8388)
- Test: `src/utils/combat/__tests__/enemyAppliedIncomingRepair.test.ts` (create)

**Interfaces:**
- Consumes: `victimOwnEnemyHealModifiers` from Task 1.
- Produces: a new optional turn arg
  `enemyAppliedHeal?: { incomingHealPct: number; outgoingHealPct: number }` on
  `playerTurn`'s args interface — consumed by Task 3.

**The design in one paragraph.** `playerTurn.ts:4619` publishes
`incomingHealPct: dmgStats.totals.incomingHealBuff` into `turnCtx`, which the engine stores in
`lastTurnCtxByActor`, which is the **first arm** of `recipientIncomingHealPct`
(`engine.ts:3330`). So folding the enemy-applied term into the actor's own `scheduledTotals`
reaches all five readers at once: `incomingPctFor`'s self arm (`playerTurn.ts:3931`),
`incomingPctFor`'s other-recipient arm (via the published ctx), `holderIncomingFactor`
(`playerTurn.ts:4105`), the cast-heal factors (`playerTurn.ts:4270`, `:4330`), and
`triggers.ts:4045`.

**⚠️ THE DOUBLE-COUNT TRAP — the most likely way to ship this wrong.** Once the term is inside the
published ctx, adding it *again* in `recipientIncomingHealPct` double-counts (−50% becomes
−100%). It belongs **only on that function's fallback arm**, which is the pre-first-turn window.
That arm is not a formality: 7 of the 8 appliers inflict from a damage clause that can land in
round 1 before the victim has taken a turn, so no ctx exists and the term would otherwise be
dropped entirely for that window. Test 3 and Test 4 below pin both halves.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/combat/__tests__/enemyAppliedIncomingRepair.test.ts`. Build the fixtures by
copying the harness from `src/utils/combat/__tests__/reversedRepairs.channels.test.ts` — it
already builds a medic + victim on either side with a controllable turn order (`medicSpeed`) and
an inflicted enemy status, which is exactly this shape. Reuse its `runFixture` pattern rather
than inventing one.

The four tests, and what each pins:

```ts
// 1. THE CORE #367 FIX. An enemy inflicts Inc. Repair Down II on a player ship; a player repair
//    lands at half value. DIFFERENTIAL, not nominal: run the same fixture with and without the
//    debuff and assert the ratio, so the test cannot pass because the repair was zero anyway.
it('an enemy-applied Inc. Repair Down II halves a player repair', () => {
    const withDebuff = arm({ statusName: 'Inc. Repair Down II', incomingHeal: -50 });
    const control = arm({ statusName: undefined });
    // EXISTENCE FIRST: prove the debuff actually landed, or a green amount assertion proves
    // nothing at all.
    expect(withDebuff.victimDebuffNames).toContain('Inc. Repair Down II');
    expect(withDebuff.healedAmount).toBeCloseTo(control.healedAmount * 0.5, 5);
});

// 2. R1's EXACT RULED SCENARIO. Inc. Repair Up II (self) + Inc. Repair Down II (enemy) +
//    Inc. Repair Down I (enemy) => the Down I is shadowed, +50 - 50 = 0, FULL repair.
it('R1: Up II + Down II + Down I nets to a full repair', () => {
    const run = arm({ selfBuff: 'Inc. Repair Up II', enemyStatuses: ['Inc. Repair Down II', 'Inc. Repair Down I'] });
    const control = arm({});
    expect(run.healedAmount).toBeCloseTo(control.healedAmount, 5);
});

// 3. THE PRE-FIRST-TURN ARM. The debuff lands in round 1 before the victim has acted, so
//    lastTurnCtxByActor holds nothing for it and only the fallback arm can carry the term.
//    Order the fixture so the healer repairs the victim BEFORE the victim's own first turn.
it('applies to a repair landing before the victim has taken its first turn', () => {
    // ...assert the same 0.5 ratio as test 1
});

// 4. NO DOUBLE-COUNT. The same debuff, read AFTER the victim has acted (so the ctx arm is live),
//    must still be -50% and not -100%. This is the test that fails if the fallback term is
//    added unconditionally instead of only on the `??` fallback.
it('does not double-count once the victim has a turn ctx', () => {
    // ...assert 0.5, and explicitly assert healedAmount > 0
});

// 5. THE SELF ARM, which the naive engine-only fix misses entirely: a ship repairing ITSELF
//    routes through incomingPctFor's `rid === actor.id` branch (dmgStats.totals), never through
//    recipientIncomingHealPct.
it('reduces a ship repairing ITSELF while carrying an enemy-applied Inc. Repair Down II', () => {
    // ...assert 0.5
});
```

Fill in the fixture bodies concretely — do not leave the comment bodies as written above. Each
test must assert a number, and each must assert the debuff's presence before asserting the amount.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/utils/combat/__tests__/enemyAppliedIncomingRepair.test.ts
```

Expected: tests 1, 3, 5 FAIL (the repair is at full value — the debuff reduces nothing). Test 2
may pass vacuously today (the debuff does nothing, so the repair is full — which is also the
right answer); that is fine, it becomes a real gate once the fix lands. Test 4 likewise. **Record
which tests failed and which passed** — this is the red baseline the reviewer checks against.

- [ ] **Step 3: Add the turn arg**

In `src/utils/combat/playerTurn.ts`, immediately after the `preFight?: PreFightCombatModifiers;`
line (~713):

```ts
    /** #367: enemy-APPLIED heal-channel modifiers carried by THIS acting actor in its own
     *  per-victim enemy store (`victimOwnEnemyHealModifiers`), in additive percentage points.
     *  Folded into the scheduled self-buff totals right beside `preFight` below, which is what
     *  makes ONE fold reach all five incoming-heal readers: the self arm of `incomingPctFor`,
     *  the HoT `holderIncomingFactor`, the two cast-heal factors, and — via the `turnCtx` this
     *  function publishes into `lastTurnCtxByActor` — the engine's `recipientIncomingHealPct`
     *  for every OTHER recipient. Absent → byte-identical. */
    enemyAppliedHeal?: { incomingHealPct: number; outgoingHealPct: number };
```

- [ ] **Step 4: Fold it at the `preFight` seam**

In `src/utils/combat/playerTurn.ts`, immediately after the closing brace of the
`if (args.preFight) { … }` block (~line 1790):

```ts
    // #367: the enemy-APPLIED half of the same two heal channels, folded into the same layer-1
    // totals as `preFight` above and for the same reason — every downstream heal consumer reads
    // these totals, so folding here is what makes the fix reach all of them at once instead of
    // patching each call site. Additive percentage points (R1: tier shadowing already happened
    // inside the status engine, so this is a plain sum). Absent → byte-identical.
    if (args.enemyAppliedHeal) {
        scheduledTotals.incomingHealBuff += args.enemyAppliedHeal.incomingHealPct;
        scheduledTotals.outgoingHealBuff += args.enemyAppliedHeal.outgoingHealPct;
    }
```

(The `outgoingHealPct` line is wired here but has no corpus effect until Task 3 confirms the
outgoing path; it is one line and folding both together avoids a second edit at the same seam.)

- [ ] **Step 5: Compute and thread it in the engine**

In `src/utils/combat/engine.ts`, in the `buildTurnArgs` args object literal, beside the existing
`...(a.preFight ? { preFight: a.preFight } : {})` at ~8388:

```ts
                // #367: this actor's own enemy-APPLIED heal-channel modifiers, computed fresh per
                // turn from the per-victim ability stores. Spread-guarded like `preFight` so a
                // clean actor omits the key entirely and every existing fixture stays
                // byte-identical.
                ...(() => {
                    const m = victimOwnEnemyHealModifiers(statusEngine, a.id);
                    return m.incomingHealPct !== 0 || m.outgoingHealPct !== 0
                        ? { enemyAppliedHeal: m }
                        : {};
                })(),
```

Add `victimOwnEnemyHealModifiers` to the existing `import { … } from './triggers'` block
(`engine.ts:119` already imports `victimEnemyBuffs` from there).

- [ ] **Step 6: Patch the pre-first-turn fallback arm ONLY**

In `src/utils/combat/engine.ts`, replace `recipientIncomingHealPct` (~3329-3332):

```ts
    const recipientIncomingHealPct = (id: string): number => {
        // ARM 1 — the actor has acted: its published ctx ALREADY includes the enemy-applied term
        // (playerTurn folds it into `scheduledTotals` beside `preFight`, and `turnCtx` publishes
        // the folded total). Adding it again here would double-count: −50% would read as −100%.
        const ctx = lastTurnCtxByActor.get(id);
        if (ctx !== undefined) return ctx.incomingHealPct;
        // ARM 2 — pre-first-turn: no ctx exists yet, so this is the ONLY place the enemy-applied
        // term can enter. Not a formality (#367): 7 of the 8 corpus appliers inflict
        // `Inc. Repair Down` from a DAMAGE clause, which can land in round 1 before the victim
        // has taken a turn — exactly this window.
        return (
            (allActorsById.get(id)?.preFight?.incomingHeal ?? 0) +
            victimOwnEnemyHealModifiers(statusEngine, id).incomingHealPct
        );
    };
```

⚠️ Note the semantics change from `??` to an explicit `ctx !== undefined` check. `??` would fall
through when `incomingHealPct` is `0`, which is a legitimate value — the old chain happened to
give the same answer only because the fallback was also `0`. With a non-zero enemy term in arm 2,
falling through on a real `0` would now double-count. Keep the explicit check.

- [ ] **Step 7: Run the tests**

```bash
npx vitest run src/utils/combat/__tests__/enemyAppliedIncomingRepair.test.ts
npx tsc --noEmit
```

Expected: all five PASS, `tsc` clean.

- [ ] **Step 8: Run the full suite and triage**

```bash
npm test 2>&1 | tail -40
```

Expected: some existing tests may move — any fixture where an enemy inflicts `Inc. Repair Down`
and a repair follows now reports less healing. **Inspect every diff; do not `-u`.** A moved
number that matches the new rule is correct; a moved number you cannot explain is a stop-and-ask.

- [ ] **Step 9: Commit**

```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/engine.ts \
        src/utils/combat/__tests__/enemyAppliedIncomingRepair.test.ts
git commit -m "fix(engine): enemy-applied Inc. Repair Down now reduces incoming repairs (#367)"
```

---

### Task 3: The outgoing twin — `Out. Repair Down`

**Files:**
- Test: `src/utils/combat/__tests__/enemyAppliedIncomingRepair.test.ts` (add a describe block)

No production change is expected: Task 2 Step 4 already folds `outgoingHealPct` into
`scheduledTotals.outgoingHealBuff`, which `playerTurn.ts:4270`/`:4330` consume as
`(1 + dmgStats.totals.outgoingHealBuff / 100)`. **This task's job is to prove that** — an
untested wire is not a fix.

**Interfaces:**
- Consumes: `enemyAppliedHeal.outgoingHealPct` from Task 2.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add to `enemyAppliedIncomingRepair.test.ts`:

```ts
describe('Out. Repair Down — the outgoing twin (#367 scope note)', () => {
    // Nayra and Ruiner are the two corpus appliers. An enemy-applied Out. Repair Down II on a
    // player HEALER must halve every repair that healer performs — on any recipient, unlike the
    // incoming channel which is keyed to the recipient.
    it('halves the repairs a debuffed healer performs', () => {
        const debuffed = arm({ healerStatus: 'Out. Repair Down II', outgoingHeal: -50 });
        const control = arm({});
        expect(debuffed.healerDebuffNames).toContain('Out. Repair Down II');
        expect(debuffed.healedAmount).toBeCloseTo(control.healedAmount * 0.5, 5);
    });

    // Direction check: the debuff belongs to the HEALER, not the recipient. Putting it on the
    // recipient must change nothing — this is what proves the fold reads the right actor's store.
    it('does nothing when it sits on the RECIPIENT instead of the healer', () => {
        const onRecipient = arm({ victimStatus: 'Out. Repair Down II', outgoingHeal: -50 });
        const control = arm({});
        expect(onRecipient.healedAmount).toBeCloseTo(control.healedAmount, 5);
    });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/utils/combat/__tests__/enemyAppliedIncomingRepair.test.ts -t "Out. Repair Down"
```

Expected: **both PASS immediately** if Task 2's wire is correct. If test 1 fails, the outgoing
fold is not reaching `dmgStats.totals.outgoingHealBuff` — debug that before proceeding, and record
what was wrong. Test 2 passing is not evidence on its own (it would also pass with the whole
channel dead); test 1 is the live half.

- [ ] **Step 3: Commit**

```bash
git add src/utils/combat/__tests__/enemyAppliedIncomingRepair.test.ts
git commit -m "test(engine): pin enemy-applied Out. Repair Down on the healer (#367)"
```

---

### Task 4: Clamp the incoming-heal factor at zero

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (add helper near `incomingPctFor` ~3930; use it at
  ~4105, ~4270, ~4330)
- Test: `src/utils/combat/__tests__/enemyAppliedIncomingRepair.test.ts` (add a describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces: module-local `incomingHealFactor(pct: number): number`.

**What is actually unclamped.** `applyHealToTarget` already floors HP movement on both paths
(`Math.max(0, Math.min(raw, deficit))` for a normal repair, `Math.max(0, raw)` for a #362
reversal), so HP cannot move the wrong way. What a negative `raw` *does* corrupt is everything
built from it: `healing.credit(…, 'hotHeal', raw)`, `healRawSum`, `heal-performed.amount`, and a
negative reported `overheal`. Clamping the **factor** guarantees `raw >= 0` at every consumption
site at once.

- [ ] **Step 1: Write the failing test**

```ts
describe('the incoming-repair factor is floored at zero (#367 §3.4)', () => {
    // A TRIPWIRE, not a live bug: under the locked tier rule only ONE Inc. Repair Down survives
    // on a family, so the worst reachable value is -75%. This test drives the fold past -100%
    // with two DIFFERENT-family reducers to prove a fully-suppressed repair lands as 0 and never
    // flips sign. If someone adds a third incoming-repair reducer, this is the guard that holds.
    it('a fold below -100% yields a repair of 0, never a negative amount', () => {
        const run = arm({ enemyStatuses: ['Inc. Repair Down III'], selfBuff: 'FixtureRepairDown', selfIncomingHeal: -50 });
        expect(run.healedAmount).toBe(0);
        expect(run.creditedHeal).toBe(0);
        expect(run.reportedOverheal).toBeGreaterThanOrEqual(0);
    });
});
```

Use a synthetic self-side buff carrying `incomingHeal: -50` for the second reducer (no corpus
status stacks with `Inc. Repair Down III`); that is the point — the test documents an
unreachable-today combination on purpose.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/utils/combat/__tests__/enemyAppliedIncomingRepair.test.ts -t "floored at zero"
```

Expected: FAIL — a negative credited/reported amount.

- [ ] **Step 3: Add the helper**

In `src/utils/combat/playerTurn.ts`, immediately after the `incomingPctFor` definition (~3933):

```ts
    /** #367 §3.4: the incoming-repair multiplier, floored at 0. The summed incoming-heal % is
     *  unclamped by construction (see the note in engine.ts's reversal branch), and a factor
     *  below 0 flips a repair's SIGN — crediting NEGATIVE healing into the buckets, into
     *  `heal-performed.amount` and into the battle report's healing done/received, and reporting
     *  a negative `overheal`. HP itself is safe (`applyHealToTarget` floors both of its paths),
     *  so this guards the accounting, which is where the damage would be silent.
     *
     *  A fully-suppressed repair is 0, never damage: Reversed Repairs (#362) is the only
     *  sanctioned repair→damage channel and it is an explicit status, not a sign accident.
     *
     *  UNREACHABLE TODAY under the locked tier rule (one surviving `Inc. Repair Down` per family,
     *  worst case −75%). This is a tripwire for the next person who adds an incoming-repair
     *  reducer. */
    const incomingHealFactor = (pct: number): number => Math.max(0, 1 + pct / 100);
```

- [ ] **Step 4: Use it at all three consumption sites**

`playerTurn.ts:4105`:

```ts
        const holderIncomingFactor = incomingHealFactor(dmgStats.totals.incomingHealBuff);
```

`playerTurn.ts:~4270` and `~4330` — replace `(1 + incomingPctFor(rid) / 100)` with:

```ts
                                incomingHealFactor(incomingPctFor(rid)) *
```

Keep the surrounding multiplication chain otherwise unchanged. There are exactly **two** such
occurrences (the `healEventOnly` arm and the normal arm); grep to confirm you got both:

```bash
grep -n "incomingPctFor(rid)" src/utils/combat/playerTurn.ts
```

Expected after the edit: two hits, both inside `incomingHealFactor(...)`.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/utils/combat/__tests__/enemyAppliedIncomingRepair.test.ts
npx tsc --noEmit && npm test 2>&1 | tail -20
```

Expected: all PASS, full suite green (the clamp is a no-op on every reachable value, so nothing
else should move — if something does, that is a finding worth reporting).

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/__tests__/enemyAppliedIncomingRepair.test.ts
git commit -m "fix(engine): floor the incoming-repair factor at zero (#367)"
```

---

### Task 5: #369 — lift the HoT tick to both sides and to off-anchor holders

The largest task, and the one with expected golden churn. Do not split it: the #362 fence goes red
the moment the gate is lifted, so the fence update and the lift must land together.

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (`tickHot` tail ~4128-4148; the `if (!healEventOnly)`
  block gate ~4150-4166)
- Modify: `src/utils/combat/__tests__/reversedRepairs.channels.test.ts` (~line 583, the
  `enemy-side victim: the HoT channel does not exist at all` test)
- Test: `src/utils/combat/__tests__/enemySideHotTick.test.ts` (create)

**Interfaces:**
- Consumes: `healing.recipientActor(id)` and `healing.applyHealToTarget(raw, victim, sourceId)`,
  both already on `HealingRuntimeCtx`.
- Produces: nothing new.

**Read this before editing.** The gate is a **deliberate patch**, documented at
`src/utils/combat/__tests__/enemyActions.test.ts:590-602`: it exists so a HoT-carrying **enemy**
cannot credit the **player** healing map under its own id or mutate the tank's HP. The fix is not
"delete the gate" — it is splitting the two things the gate conflates. The template is already in
this file: the enemy cast-heal arm at `playerTurn.ts:4256` performs the real per-recipient
application and credits nothing (E5 §4.1). Follow it.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/combat/__tests__/enemySideHotTick.test.ts`. Again, copy the medic+victim harness
from `reversedRepairs.channels.test.ts` — its `allyHotBuff(hotPct)` helper (line 122) and its
`medicSpeed: 900` ordering note (a foreign HoT applier with no turn ctx is skipped outright) are
exactly what these fixtures need.

```ts
// 1. THE CORE #369 FIX.
it('an enemy ship carrying Repair Over Time gains HP on its own turn', () => {
    const run = arm({ holderSide: 'enemy', hotPct: 10, holderStartHp: MAX / 2 });
    expect(run.holderHpAfter).toBeGreaterThan(MAX / 2);
    // Nominal, not just directional: the tick is applierMaxHp x hotPct% x stacks.
    expect(run.holderHpAfter - MAX / 2).toBeCloseTo(EXPECTED_TICK, 5);
});

// 2. R2 + the reason the gate existed. The enemy tick must credit NO player healing bucket and
//    emit NO heal-performed. This is the assertion that would have caught the original bug the
//    gate was patching, so it must stay green for the right reason.
it('an enemy tick credits no player healing bucket and emits no heal-performed', () => {
    const run = arm({ holderSide: 'enemy', hotPct: 10, holderStartHp: MAX / 2 });
    expect(run.holderHpAfter).toBeGreaterThan(MAX / 2);          // the tick DID happen
    expect(run.playerHealingBuckets).toEqual({});                 // ...and credited nothing
    expect(run.events.filter((e) => e.type === 'heal-performed')).toHaveLength(0);
});

// 3. THE OFF-ANCHOR PLAYER CASE (the side-independent half of #369).
it('an off-anchor PLAYER ally carrying a HoT gains HP', () => {
    const run = arm({ holderSide: 'player', isAnchor: false, hotPct: 10, holderStartHp: MAX / 2 });
    expect(run.holderHpAfter - MAX / 2).toBeCloseTo(EXPECTED_TICK, 5);
});

// 4. Attribution is unchanged: the tick is credited to the APPLIER, not the holder. Use a
//    FOREIGN applier (medic applies, victim holds) — with a self-applied HoT the two coincide
//    and an attribution bug is invisible. This is the trap reversedRepairs.channels.test.ts
//    documents at its line 528.
it('credits the APPLIER, not the holder, for an off-anchor tick', () => { /* ... */ });

// 5. The strict applier-ctx rule survives: a foreign applier that has not acted yet still SKIPS
//    the tick, with no base-stat fallback.
it('skips the tick when the foreign applier has no turn ctx yet', () => { /* ... */ });
```

- [ ] **Step 2: Run them, and prove they fail for the right reason**

```bash
npx vitest run src/utils/combat/__tests__/enemySideHotTick.test.ts
```

Expected: tests 1, 2, 3 FAIL (no HP movement at all). Test 2 will fail on its *first* assertion
(the tick did not happen), not its bucket assertion — confirm that, because a test 2 that "passes"
today would be passing vacuously.

- [ ] **Step 3: Plant the reachability probes**

Before writing the fix, prove the new fixtures actually reach the code you are about to change.
Insert at the top of the HoT block body in `playerTurn.ts` (~4151):

```ts
            throw new Error('PROBE-REACHED');
```

Run the two fixtures:

```bash
npx vitest run src/utils/combat/__tests__/enemySideHotTick.test.ts -t "enemy ship carrying"
npx vitest run src/utils/combat/__tests__/enemySideHotTick.test.ts -t "off-anchor PLAYER"
```

Expected **today**: neither fires the probe (the enemy fixture is gated out; the off-anchor
fixture reaches the block but not the apply). Now move the probe to just above the
`if (actor.id !== healing.targetId)` early-return and re-run the off-anchor fixture — it **must**
fire. If it does not, the fixture is not reaching the code under test and is worthless; fix the
fixture before going further. Remove the probe when done.

This step is not optional: a fixture that misses the site looks identical to one that hits it
(#368's lesson).

- [ ] **Step 4: Rewrite the `tickHot` tail**

Replace `playerTurn.ts:4128-4148` — everything from `if (actor.id !== healing.targetId) {` to the
end of the `perRecipientApply` block — with:

```ts
            // #369: the tick applies to the HOLDER, whichever side it is on and whether or not
            // the holder is the healing anchor. `applyHealToTarget` has taken its victim
            // explicitly since #362, so nothing about this path is anchor-specific any more —
            // the old `actor.id !== healing.targetId` early-return was a legacy restriction that
            // silently withheld HP from every off-anchor holder, PLAYER SIDE INCLUDED.
            const holderActor =
                actor.id === healing.targetId ? actor : healing.recipientActor(actor.id);
            const applied = holderActor
                ? healing.applyHealToTarget(raw, holderActor, creditId)
                : undefined;
            // `healEventOnly` gates CREDIT, never APPLICATION (E5 §4.1) — the same split the
            // enemy cast-heal arm below already uses. An enemy holder's tick moves its own HP and
            // contributes NOTHING to the player healing buckets, which is the actual invariant
            // the old whole-block gate was protecting (see enemyActions.test.ts:590).
            if (healEventOnly) return;
            // R10′ (#362): a reversed tick books nothing at all, gross bucket included.
            if (applied?.reversed) return;
            healing.credit(creditId, 'hotHeal', raw);
            // Holder not resolvable in the actor map → gross credit only, the pre-#369 off-anchor
            // behaviour. Defensive: every real run resolves it.
            if (!applied) return;
            healing.credit(creditId, 'effectiveHeal', applied.consumed);
            healing.credit(creditId, 'overheal', applied.overheal);
            // Recipient axis (SP-3b Task 7): the tick lands on the HOLDER (this acting actor),
            // whoever applied it — so the raw goes to the holder's `hotHeal` bucket while the
            // source axis keeps crediting the APPLIER. Gated on `perRecipientApply` so a legacy
            // single-target run still leaves `perRecipient` empty.
            if (healing.perRecipientApply) {
                healing.creditRecipient?.(actor.id, 'hotHeal', raw);
                healing.creditRecipient?.(actor.id, 'effectiveHeal', applied.consumed);
                healing.creditRecipient?.(actor.id, 'overheal', applied.overheal);
            }
        };
```

- [ ] **Step 5: Lift the block gate**

Replace `playerTurn.ts:4149-4150`:

```ts
        // Event-only (enemy) mode: HoT ticking must not credit or apply to the player healing map.
        if (!healEventOnly) {
```

with:

```ts
        // #369: BOTH sides tick. The gate that used to wrap this whole block was suppressing the
        // tick itself in order to suppress its CREDIT — `tickHot` now separates the two, so an
        // enemy holder moves its own HP and books nothing. R2: no `heal-performed` is emitted
        // from this block and `repairedThisRound` is not set, on either side — a HoT tick is not
        // a "performed repair" and fires no on-repaired trigger.
```

and dedent the two `for` loops out of the removed block, keeping their existing comments (`// (a)
Payload-carrying ability HoT statuses…` and `// (b) Scheduled snapshot HoTs…`) intact. Delete the
now-orphaned closing brace.

- [ ] **Step 6: Run the new tests**

```bash
npx vitest run src/utils/combat/__tests__/enemySideHotTick.test.ts
npx tsc --noEmit
```

Expected: all five PASS, `tsc` clean.

- [ ] **Step 7: Replace the #362 fence**

`reversedRepairs.channels.test.ts:583` currently asserts the enemy HoT channel is dead, and says
so: *"If a future change ever lets an enemy-side holder tick a HoT, this test goes red and whoever
makes that change owes the enemy arm of the test above."* That change is this one. It is doing its
job — do not delete it, replace it with the arm it asks for:

```ts
    // #369 lifted the enemy-side gate this test used to fence. It is now the real enemy arm of
    // the player-side test above: the channel is LIVE on both sides, so a reversal reverses it.
    it('enemy-side victim: HP down by the tick, and the same fixture heals without the debuff', () => {
        const START = VICTIM_MAX_HP / 2;
        const arm = (statusName: string) =>
            runFixture({
                victimSide: 'enemy',
                statusName,
                medicAbilities: [allyHotBuff(REPAIR_PCT)],
                medicSpeed: 900,
                victimStartHp: START,
            });
        const control = arm(CONTROL);
        const reversed = arm(REVERSED);
        expect(control.victimHp - START).toBe(RAW);
        expect(START - reversed.victimHp).toBe(RAW);
    });
```

Also update constraint **(b)** in that describe's header comment (lines 521-526) — it now
describes behaviour that no longer exists — and correct constraint **(a)**, which quotes the
condition as `if (actor.id === healing.targetId)` when the code reads `!==`, and which is now gone
entirely. Say what replaced it.

Finally, `enemyActions.test.ts:601-603` (`'Phase 4c PR 4 Task 5 fix: HoT ticking is gated behind
healEventOnly'`) asserts the old contract directly. Rewrite it to assert the **new** one: the tick
happens, and `credits` stays empty in event-only mode. Its `makeHealingSpy` already records
`credits` and `applied` separately, which is exactly the distinction the fix introduces — so the
spy needs no change, only the expectations.

- [ ] **Step 8: Run the full suite and triage the golden churn**

```bash
npm test 2>&1 | tail -60
```

**Expect healing goldens to move** — off-anchor player allies now gain HoT HP where previously
they were credited but not healed. This is the approved behaviour change. For each moved
golden/snapshot: identify the holder, confirm it is a non-anchor HoT carrier, and confirm the
delta equals `applierMaxHp × hotPct% × stacks × factors`. **Never `vitest -u`.** Update the
expectations by hand, and list every file you touched in the commit body.

If a moved number is NOT explained by that rule, stop and report it rather than accepting it.

- [ ] **Step 9: Commit**

```bash
git add -A src/utils/combat
git commit -m "fix(engine): repair-over-time now ticks on both sides and off-anchor (#369)"
```

---

### Task 6: Changelog, docs and issue corrections

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

**Interfaces:** none.

- [ ] **Step 1: Add the changelog entries**

Per `CLAUDE.md`, user-visible `fix:` commits get a plain-English entry in `UNRELEASED_CHANGES`
**before** committing. Three entries, no emojis:

```ts
'Enemy-applied "Inc. Repair Down" now actually reduces the repairs your ships receive. Eight enemy ships inflict it (Amartya, Larkspur, LeSabre, Ripper, Ruiner, Sansi, Sha Xing, Shashou) and until now it displayed on your ship but changed nothing.',
'Enemy-applied "Out. Repair Down" now reduces the repairs a debuffed healer performs.',
'Repair Over Time now ticks on enemy ships and on your own ships that are not the heal target. Enemy fights involving a repair-over-time were previously simulated with the enemy healing less than it should, making clear-time estimates look better than they are.',
```

Match the surrounding entries' voice and formatting exactly — read the existing array first.

- [ ] **Step 2: Verify the build and the docs**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -5
```

`DocumentationPage.tsx` needs **no** change: this plan alters simulation fidelity, not any
documented user-facing feature or flow. Confirm by grepping for a repair-modifier section:

```bash
grep -in "repair down\|repair over time" src/pages/DocumentationPage.tsx
```

If it returns nothing, there is nothing to sync — record that.

- [ ] **Step 3: Commit**

```bash
git add src/constants/changelog.ts
git commit -m "docs(changelog): enemy-side heal-channel fixes (#367, #369)"
```

- [ ] **Step 4: Correct the issue bodies (orchestrator, at PR time)**

Not a code step — do it when the PR opens:

- **#367** lists 6 appliers; the real list is **8**. `Sansi` and `Sha Xing` are missing. Post the
  corrected table (verified against `docs/ship-skills.csv`, 149 records).
- **#369** describes the gate as an oversight. It was a deliberate patch
  (`enemyActions.test.ts:590-602`). Note that the fix split credit from application rather than
  deleting the gate, and that the player-side off-anchor case was in the same line of code.

---

## Self-review

**Spec coverage:**

| Spec section | Task |
|---|---|
| R1 fold rule | Task 1 Step 1 (tier test), Task 2 test 2 |
| R2 tick-is-not-a-repair | Task 5 test 2, Step 5 comment |
| §2.1 / §3.1 one fold point | Task 2 |
| §3.2 double-count + pre-first-turn | Task 2 Step 6, tests 3–4 |
| §3.3 HoT lift + off-anchor | Task 5 |
| §3.4 clamp | Task 4 |
| §3.5 `Out. Repair Down` | Task 2 Step 4 (wire), Task 3 (proof) |
| §4 instrument validity | Task 5 Step 3 (probes); existence-before-amount asserts throughout |
| §4 fences to update | Task 5 Step 7 |
| §5 risks | Task 2 Step 8, Task 5 Step 8 (churn triage) |
| §6 out of scope | Not implemented, by design |

**Type consistency:** `enemyAppliedHeal: { incomingHealPct: number; outgoingHealPct: number }` is
the same shape returned by `victimOwnEnemyHealModifiers` in Task 1 and consumed in Tasks 2–3.
`incomingHealFactor(pct: number): number` is defined once (Task 4 Step 3) and used at three sites
(Step 4).

**Known gap left open deliberately:** the scheduled per-victim enemy channel is excluded from
`victimOwnEnemyHealModifiers` (Task 1 jsdoc explains why). It is empty in every run today because
`upsertBuff` is hardcoded to `__enemy__`. If `upsertBuff` ever becomes per-victim aware, this
function and `victimEnemyBuffs` both need revisiting — the jsdoc says so.
