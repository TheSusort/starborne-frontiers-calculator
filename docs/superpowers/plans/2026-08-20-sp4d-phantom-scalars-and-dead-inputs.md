# SP-4d — Phantom Scalars and the Four Dead Inputs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A question about "the enemy" asked on a turn that resolved no victim answers *"there is no enemy"* instead of inventing one, and the four legacy enemy scalars — whose last readers were exactly those invented answers — are deleted from the engine boundary.

**Architecture:** One unresolvable answer at one choke point. `evaluateCondition` gains `undefined` in its return type meaning *the subject does not exist*; `conditionMet` rejects it **before** the `countComparator` switch, so no comparator can be satisfied by an absent subject; `scaledBonus` reads it as 0. Every layer that currently materialises a fabricated value (`buildRoundContext`, `playerTurn`'s derivation, `buildDrainContext`, the engine's `enemiesHitThisCastFor` resolver) stops doing so. With the last readings gone, `CombatEngineInput.enemyHp` / `enemyDefense` / `enemySpeed` / `enemySecurity` have no readers and are deleted along with their ~1,100 call-site lines.

**Tech Stack:** TypeScript (strict, no `exactOptionalPropertyTypes`), Vitest, React. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-20-sp4d-phantom-scalars-and-dead-inputs-design.md`. Read §2 (the fight), §3 (the mechanism) and §5.1 (what stays) before Task 1.

## Global Constraints

- **Never run `vitest -u`.** The golden audit spans the whole `npm test`. There is **no CI test workflow** — the husky pre-commit hook is the gate, and it runs the full suite on every commit.
- **The expected outcome of this whole branch is ZERO golden movement.** `git diff --name-only main...HEAD` must contain no `.snap` file. Movement means an earlier rung missed a path — investigate, do not re-pin (SP-4c §4.5).
- **Every line number in this plan is advisory; every symbol is authoritative.** SP-4c §10.4 found 4 of 5 recorded citations stale with no intervening commits. Re-resolve by symbol (`grep -n "<symbol>"`) before editing.
- **Re-measure, never quote.** Where a step states a count (1,109 occurrences, 268 files), re-take it at the branch point. A churn estimate ages exactly the way a reachability claim does (SP-4c §9.1).
- **The engine is not deterministic** (`rateAccumulator.ts` uses `Math.random`). Pin with `setupKeyedTestRng(seed)` **alone** — never follow it with `resetRateGateRng()`, which nulls the keyed provider and un-seeds the test.
- **A red test must be shown to fail against restored pre-rung semantics.** 4c-2c shipped a tripwire that passed byte-identical against the old world. Every task that adds a red test includes the restore-and-re-run step.
- Dev server is `npm start` (port 3000), not `npm run dev`. `gh auth switch --user TheSusort` before any `gh` command.
- `tsc --noEmit` covers `src` only (`tsconfig.json` `include: ["src"]`). A guard placed in `scripts/` is never evaluated.

---

## File Structure

| file | responsibility in this rung |
| --- | --- |
| `src/utils/abilities/evaluateConditions.ts` | **The choke point.** Owns the unresolvable answer: which subjects can be absent, and the rule that an absent subject is rejected before any comparator. |
| `src/utils/abilities/roundContext.ts` | The second fabrication layer. Stops materialising absent readings as `100` / `0` / `1`. |
| `src/utils/combat/playerTurn.ts` | The cast-path derivation. `PlayerRoundCtx.enemyHpPct` becomes gate-facing and optional; the row keeps a display number. |
| `src/utils/combat/triggers.ts` | The drain-path derivation. `buildDrainContext` stops dividing by `ctx.enemyHp`; `IntentExecContext.enemyHp` is deleted. |
| `src/utils/combat/engine.ts` | The `enemiesHitThisCastFor` resolver, the skip-row display constant, and the four boundary fields. |
| `src/utils/calculators/dpsSimulator.ts` | Stops forwarding the four scalars to the engine; keeps its own four for `synthesizedDpsEnemy`. |
| `src/utils/calculators/healingEngineAdapter.ts` | Drops the top-level `LEGACY_SINK_*` pass-through; keeps the per-enemy roster defaults. |
| `src/utils/abilities/__tests__/absentSubject.test.ts` (new) | Unit truth for the mechanism, including the comparator-proof case. |
| `src/utils/combat/__tests__/noVictimAbsentSubject.integration.test.ts` (new) | The engine-level pin: a support ship's phantom-gated payload does not fire. |
| `src/utils/combat/__tests__/noVictimResidualTripwires.test.ts` | Its three tripwire cases become direct assertions; its corpus-census guards are migrated, not deleted. |

---

### Task 1: The unresolvable answer in `evaluateConditions.ts`

**Files:**
- Modify: `src/utils/abilities/evaluateConditions.ts` (`ConditionContext.enemyHpPct`, `evaluateCondition`, `evalHpThreshold`, `conditionMet`, `scaledBonus`)
- Modify: `src/utils/combat/playerTurn.ts` (the `evaluateCondition` call in the ally-charge scale, ~`:937`)
- Test: `src/utils/abilities/__tests__/absentSubject.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `evaluateCondition(cond: Condition, ctx: ConditionContext): number | undefined` — `undefined` means *the subject does not exist*. `conditionMet(cond, ctx): boolean` unchanged in signature; returns `false` for an unresolvable condition. `ConditionContext.enemyHpPct?: number` (was required). `evalHpThreshold(cond, ctx): boolean | undefined` (module-private).

- [ ] **Step 1: Write the failing test**

Create `src/utils/abilities/__tests__/absentSubject.test.ts`:

```ts
/**
 * SP-4d — an absent subject is UNRESOLVABLE, not a fabricated value.
 *
 * THE GAME CASE (spec §2): Hermes repairs an ally with four enemies on the board. That turn
 * resolves no victim, so "the enemy's HP%", "the target's HP" and "enemies hit by this cast" have
 * no subject. Before this rung they answered 100 / 0 / 1 — a healthy enemy, a zero-stat enemy, and
 * a cast that hit one enemy. Give a support kit Cobalt's real clause shape ("if this Unit has more
 * HP than the enemy…") and the 0 makes it fire against nobody.
 *
 * The `eq 0` case below is the one that decides the MECHANISM rather than the values: answering 0
 * instead of a phantom fixes the `gt` clause and leaves the parser's own negation idiom
 * (`countComparator: 'eq', countThreshold: 0`, buildShipAbilities.ts:266) firing against nobody.
 * Rejecting an absent subject BEFORE the comparator switch is what closes both.
 */
import { describe, it, expect } from 'vitest';
import { conditionMet, evaluateCondition, scaledBonus } from '../evaluateConditions';
import { makeConditionContext } from './conditionContextFixture';
import type { Ability, Condition } from '../../../types/abilities';

const cond = (over: Partial<Condition>): Condition =>
    ({ subject: 'always', derivable: true, ...over }) as Condition;

describe('SP-4d: an absent subject does not resolve', () => {
    it('an enemy hp-threshold ABOVE gate does not fire with no enemy (was: TRUE against nobody)', () => {
        const ctx = makeConditionContext({ enemyHpPct: undefined });
        expect(
            conditionMet(cond({ subject: 'hp-threshold', hpComparator: 'above', hpPercent: 50 }), ctx)
        ).toBe(false);
    });

    it('an enemy hp-threshold BELOW gate still does not fire — the other direction is unchanged', () => {
        // Guards against a "fix" that inverts the answer instead of withholding it. Obsidian's real
        // `below 30` and Judge's `below 50` read false against the old phantom 100 too, so this case
        // must stay false for the same reason it always was: there is no enemy below the threshold.
        const ctx = makeConditionContext({ enemyHpPct: undefined });
        expect(
            conditionMet(cond({ subject: 'hp-threshold', hpComparator: 'below', hpPercent: 50 }), ctx)
        ).toBe(false);
    });

    it('a SELF hp-threshold is untouched — selfHpPct always has a subject', () => {
        const ctx = makeConditionContext({ enemyHpPct: undefined, selfHpPct: 20 });
        expect(
            conditionMet(
                cond({ subject: 'hp-threshold', hpSubject: 'self', hpComparator: 'below', hpPercent: 50 }),
                ctx
            )
        ).toBe(true);
    });

    it("Cobalt's clause shape does not fire against nobody (stat-vs-target hp gt)", () => {
        const ctx = makeConditionContext({ selfCurrentHp: 20000, targetCurrentHp: undefined });
        expect(
            conditionMet(cond({ subject: 'stat-vs-target', compareStat: 'hp', statComparator: 'gt' }), ctx)
        ).toBe(false);
    });

    it('a resolvable stat-vs-target gate still fires — the absent rule is not a blanket block', () => {
        const ctx = makeConditionContext({ selfCurrentHp: 20000, targetCurrentHp: 5000 });
        expect(
            conditionMet(cond({ subject: 'stat-vs-target', compareStat: 'hp', statComparator: 'gt' }), ctx)
        ).toBe(true);
    });

    it('THE COMPARATOR-PROOF CASE: an lte gate is not satisfied by an absent footprint either', () => {
        // Today `enemies-hit-this-cast` answers 1 with no footprint, so `lte 1` fires against nobody.
        // Answering 0 instead would ALSO fire it. Only rejecting before the comparator closes this.
        const ctx = makeConditionContext({ enemiesHitThisCast: undefined });
        expect(
            conditionMet(
                cond({ subject: 'enemies-hit-this-cast', countComparator: 'lte', countThreshold: 1 }),
                ctx
            )
        ).toBe(false);
    });

    it('THE COMPARATOR-PROOF CASE, negation idiom: eq 0 is not satisfied either', () => {
        const ctx = makeConditionContext({ enemiesHitThisCast: undefined });
        expect(
            conditionMet(
                cond({ subject: 'enemies-hit-this-cast', countComparator: 'eq', countThreshold: 0 }),
                ctx
            )
        ).toBe(false);
    });

    it("Tygr's real gte 2 gate is unchanged — a recorded footprint still resolves", () => {
        const ctx = makeConditionContext({ enemiesHitThisCast: 3 });
        expect(
            conditionMet(
                cond({ subject: 'enemies-hit-this-cast', countComparator: 'gte', countThreshold: 2 }),
                ctx
            )
        ).toBe(true);
    });

    it("Akula's HP-proportional scaling contributes 0 with no target (was: its full cap)", () => {
        // enemy-hp-pct is a SCALING source, not a gate: with the phantom 100 it paid the maximum
        // bonus. Absent must pay nothing, and `scaledBonus` is where that happens.
        const ability = {
            id: 'akulaish',
            type: 'modifier',
            target: 'self',
            trigger: 'on-cast',
            conditions: [cond({ subject: 'enemy-hp-pct' })],
            config: { type: 'modifier' },
            scaling: { conditionIndex: 0, perUnit: 0.3, cap: 30 },
        } as unknown as Ability;
        expect(scaledBonus(ability, makeConditionContext({ enemyHpPct: undefined }))).toBe(0);
        expect(scaledBonus(ability, makeConditionContext({ enemyHpPct: 50 }))).toBe(15);
    });

    it('enemy-hp-missing-pct does not invert into a full bonus when absent', () => {
        // The trap: `100 - undefined` is NaN, and a naive `100 - (ctx.enemyHpPct ?? 0)` pays 100.
        expect(
            evaluateCondition(
                cond({ subject: 'enemy-hp-missing-pct' }),
                makeConditionContext({ enemyHpPct: undefined })
            )
        ).toBeUndefined();
    });

    it('SIDE-WIDE subjects keep answering — a real roster exists even with no victim', () => {
        // Spec §3.1: since 4b-2b a real enemy roster is guaranteed, so "how many enemies have been
        // destroyed" and "does any enemy have a buff" have honest answers on a no-victim turn.
        const ctx = makeConditionContext({
            enemyHpPct: undefined,
            enemyDestroyedCount: 2,
            enemyBuffNames: ['Stealth'],
        });
        expect(conditionMet(cond({ subject: 'enemy-destroyed' }), ctx)).toBe(true);
        expect(conditionMet(cond({ subject: 'enemy-buff', buffName: 'Stealth' }), ctx)).toBe(true);
    });

    it('an unresolvable condition inside an anyOf run does not poison a resolvable sibling', () => {
        const ctx = makeConditionContext({ enemyHpPct: undefined, selfHpPct: 20 });
        const conditions = [
            cond({ subject: 'hp-threshold', hpComparator: 'above', hpPercent: 50, anyOf: true }),
            cond({ subject: 'hp-threshold', hpSubject: 'self', hpComparator: 'below', hpPercent: 50, anyOf: true }),
        ];
        // conditionsMet groups consecutive anyOf conditions into one OR-group.
        expect(conditions.some((c) => conditionMet(c, ctx))).toBe(true);
    });
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

Run: `npx vitest run src/utils/abilities/__tests__/absentSubject.test.ts`

Expected: the file does not compile at all — `makeConditionContext({ enemyHpPct: undefined })` is a type error while `ConditionContext.enemyHpPct` is required. That compile failure IS the first red. Confirm with `npx tsc --noEmit` and expect an error naming `enemyHpPct` in `absentSubject.test.ts`.

- [ ] **Step 3: Widen the field**

In `src/utils/abilities/evaluateConditions.ts`, change the `ConditionContext` member:

```ts
    /** SP-4d: OPTIONAL, and absent means "there is no enemy to ask about" — not "an enemy at full
     *  health". Absent on a no-victim turn (an ally-targeted cast resolves nobody) and at drain
     *  time (the fight-wide reading it used to carry described no actor on the board). Every arm
     *  that reads it returns `undefined` when it is absent; `conditionMet` rejects that before the
     *  comparator switch. Do NOT reintroduce a `?? 100` here or at any builder — that default is
     *  the phantom this rung deletes (spec §3.2: it was materialised in TWO layers). */
    enemyHpPct?: number; // 0..100
```

- [ ] **Step 4: Widen the return type and the arms**

Change the signature and doc:

```ts
/** Resolve one condition to a count (>= 0), or `undefined` when the condition's SUBJECT DOES NOT
 *  EXIST (SP-4d). `undefined` is not "zero" and not "unknown": it means the question cannot be
 *  asked, so `conditionMet` refuses it regardless of comparator and `scaledBonus` pays nothing. */
export function evaluateCondition(cond: Condition, ctx: ConditionContext): number | undefined {
```

Replace the three arms. `enemy-hp-pct` / `enemy-hp-missing-pct`:

```ts
        // HP-percentage counts: the enemy's current/missing HP% (0..100). Used as SCALING sources
        // for HP-proportional modifiers (Akula/Tithonus) — perUnit is "per HP point". As a bare
        // gate they pass while the enemy lives. SP-4d: with no enemy neither question resolves —
        // and note the missing-HP arm must NOT compute `100 - 0`, which would pay the FULL bonus.
        case 'enemy-hp-pct':
            return ctx.enemyHpPct;
        case 'enemy-hp-missing-pct':
            return ctx.enemyHpPct === undefined ? undefined : 100 - ctx.enemyHpPct;
```

`enemies-hit-this-cast`:

```ts
        // SP-4d: was `?? 1` — a cast that resolved no victim booked a footprint of ONE. Absent now
        // means no footprint was recorded, which does not resolve. Tygr's `gte 2` and Berserker's
        // `gte 3` are unaffected either way; an `lte`/`eq 0` reader is the case this closes.
        case 'enemies-hit-this-cast':
            return ctx.enemiesHitThisCast;
```

`stat-vs-target` — the SELF readings keep their `?? 0`, because the acting unit always exists:

```ts
        case 'stat-vs-target': {
            // The OWNER always exists, so an absent self reading is a caller omission (0), not a
            // missing subject. The TARGET is the subject: absent means nobody to compare against,
            // and a `gt` comparator against a fabricated 0 was TRUE against nobody (spec §2).
            const self =
                cond.compareStat === 'crit-power'
                    ? (ctx.selfCritPower ?? 0)
                    : cond.compareStat === 'speed'
                      ? (ctx.selfSpeed ?? 0)
                      : (ctx.selfCurrentHp ?? 0);
            const target =
                cond.compareStat === 'crit-power'
                    ? ctx.targetCritPower
                    : cond.compareStat === 'speed'
                      ? ctx.targetSpeed
                      : ctx.targetCurrentHp;
            if (target === undefined) return undefined;
            return (cond.statComparator === 'lt' ? self < target : self > target) ? 1 : 0;
        }
```

`hp-threshold` and its helper:

```ts
function evalHpThreshold(cond: Condition, ctx: ConditionContext): boolean | undefined {
    const hp =
        cond.hpSubject === 'self'
            ? ctx.selfHpPct
            : cond.hpSubject === 'target'
              ? (ctx.targetHpPct ?? 100)
              : ctx.enemyHpPct;
    // SP-4d: only the enemy/default subject can be absent — `selfHpPct` is required and the heal
    // target's reading keeps its documented 100 default (healing-mode inertness, not a phantom).
    if (hp === undefined) return undefined;
    const t = cond.hpPercent ?? 0;
    return cond.hpComparator === 'above' ? hp > t : hp < t;
}
```

```ts
        case 'hp-threshold': {
            const met = evalHpThreshold(cond, ctx);
            return met === undefined ? undefined : met ? 1 : 0;
        }
```

- [ ] **Step 5: Reject an absent subject BEFORE the comparator switch**

```ts
export function conditionMet(cond: Condition, ctx: ConditionContext): boolean {
    const count = evaluateCondition(cond, ctx);
    // SP-4d, AND THE ORDER IS THE POINT: an absent subject is refused here, upstream of the
    // comparator. Falling through with a 0 would leave the parser's negation idiom
    // (`eq`/`countThreshold: 0`) and any `lte` gate satisfiable by a subject that does not exist —
    // the same phantom in a new direction. See absentSubject.test.ts's two comparator-proof cases.
    if (count === undefined) return false;
    if (cond.countComparator != null && cond.countThreshold != null) {
```

- [ ] **Step 6: Make scaling pay nothing for an absent subject**

In `scaledBonus`:

```ts
    const count = anyOfGroupIndices(ability.conditions, idx).reduce(
        // SP-4d: an absent subject contributes 0 rather than its fabricated reading. Measured
        // inert on the shipped corpus (spec §6: Akula and Tithonus are the only readers, both are
        // attackers, and every evaluation in the suite carries a live per-victim value).
        (sum, i) => sum + (evaluateCondition(ability.conditions[i], ctx) ?? 0),
        0
    );
```

- [ ] **Step 7: Fix the one other direct caller**

In `src/utils/combat/playerTurn.ts`, the ally-charge scale (~`:937`, inside the `gain +=` loop):

```ts
        const scale =
            !primary || primary.countComparator != null
                ? 1
                : // SP-4d: an unresolvable scaling source contributes no charge.
                  (evaluateCondition(primary, args.ctxFor.get(ability.id) ?? args.fallbackCtx) ?? 0);
```

- [ ] **Step 8: Run the new test, then the full suite**

Run: `npx vitest run src/utils/abilities/__tests__/absentSubject.test.ts`
Expected: all 12 cases PASS.

Run: `npx tsc --noEmit`
Expected: clean. If it names a `number | undefined` assignment you have found another direct consumer of `evaluateCondition` — handle it explicitly (`?? 0` for a scaling read, an early return for a gate read); do not widen the callee back.

Run: `npx vitest run`
Expected: green, and **no `.snap` file modified** (`git status --short` shows none). Nothing has gone absent yet — this task only teaches the layer how to say "no subject" — so any behaviour change here means an arm was rewritten wrongly.

- [ ] **Step 9: Commit**

```bash
git add src/utils/abilities/evaluateConditions.ts src/utils/abilities/__tests__/absentSubject.test.ts src/utils/combat/playerTurn.ts
git commit -m "feat(engine): an absent subject does not resolve (SP-4d task 1)"
```

---

### Task 2: Stop the second fabrication layer

**Files:**
- Modify: `src/utils/abilities/roundContext.ts` (`buildRoundContext` return block, ~`:146`, `:158-163`)
- Modify: `src/utils/abilities/__tests__/roundContext.test.ts` (the default pins, ~`:86`)
- Modify: `src/utils/combat/triggers.ts` (`NEUTRAL_NAMES_CTX` comment only)

**Interfaces:**
- Consumes: `ConditionContext.enemyHpPct?: number` and the `undefined`-means-absent rule from Task 1.
- Produces: `buildRoundContext(state)` no longer materialises `enemyHpPct`, `targetCritPower`, `targetSpeed`, `targetCurrentHp` or `enemiesHitThisCast` — an absent input field stays absent on the built context.

- [ ] **Step 1: Write the failing test**

In `src/utils/abilities/__tests__/roundContext.test.ts`, replace the `enemyHpPct` default pin (~`:86`, currently `expect(buildRoundContext(base).enemyHpPct).toBe(100)`) and add the four siblings:

```ts
    it('SP-4d: absent enemy/target readings stay absent — no phantom is materialised here', () => {
        // This file is the SECOND fabrication layer (spec §3.2). While it filled these in eagerly,
        // evaluateConditions never saw an absent value through the real funnel, so a fix applied
        // only there would have passed its own unit tests and changed nothing in a fight.
        const ctx = buildRoundContext(base);
        expect(ctx.enemyHpPct).toBeUndefined();
        expect(ctx.targetCritPower).toBeUndefined();
        expect(ctx.targetSpeed).toBeUndefined();
        expect(ctx.targetCurrentHp).toBeUndefined();
        expect(ctx.enemiesHitThisCast).toBeUndefined();
    });

    it('SP-4d: a supplied reading still passes through untouched', () => {
        const ctx = buildRoundContext({
            ...base,
            enemyHpPct: 40,
            targetCritPower: 150,
            targetSpeed: 90,
            targetCurrentHp: 5000,
            enemiesHitThisCast: 3,
        });
        expect(ctx.enemyHpPct).toBe(40);
        expect(ctx.targetCritPower).toBe(150);
        expect(ctx.targetSpeed).toBe(90);
        expect(ctx.targetCurrentHp).toBe(5000);
        expect(ctx.enemiesHitThisCast).toBe(3);
    });
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/utils/abilities/__tests__/roundContext.test.ts`
Expected: the first new case FAILS with `expected 100 to be undefined` (and `0`/`0`/`0`/`1` for the siblings). The second case passes already — it is the guard that the fix withholds rather than discards.

- [ ] **Step 3: Stop defaulting the five fields**

In `src/utils/abilities/roundContext.ts`, delete these five lines from the returned object:

```ts
        enemyHpPct: state.enemyHpPct ?? 100,
        targetCritPower: state.targetCritPower ?? 0,
        targetSpeed: state.targetSpeed ?? 0,
        targetCurrentHp: state.targetCurrentHp ?? 0,
        enemiesHitThisCast: state.enemiesHitThisCast ?? 1,
```

and replace them with conditional spreads, matching the idiom already used in this file for `roundCrit` and `enemyDotFamilyCounts`:

```ts
        // SP-4d: these five are NOT defaulted. An absent reading means the subject does not exist
        // (no victim resolved this turn), and evaluateConditions answers that honestly; inventing
        // `100` / `0` / `1` here is exactly the phantom the rung deletes, and it hid itself by
        // sitting one layer ABOVE the `??` in evaluateConditions. The conditional-spread idiom is
        // load-bearing: writing the key with an `undefined` value would also work at runtime, but
        // it makes `'enemyHpPct' in ctx` lie, which the sentinel-vs-legacy `enemyDebuffNames`
        // distinction in this same context type depends on.
        ...(state.enemyHpPct !== undefined ? { enemyHpPct: state.enemyHpPct } : {}),
        ...(state.targetCritPower !== undefined ? { targetCritPower: state.targetCritPower } : {}),
        ...(state.targetSpeed !== undefined ? { targetSpeed: state.targetSpeed } : {}),
        ...(state.targetCurrentHp !== undefined ? { targetCurrentHp: state.targetCurrentHp } : {}),
        ...(state.enemiesHitThisCast !== undefined
            ? { enemiesHitThisCast: state.enemiesHitThisCast }
            : {}),
```

Also update each field's own doc comment in the `state` parameter type (they currently read "Default 0" / "Default 1" / "DPS: configured enemyHp") to say the field is passed through and absence means no subject.

- [ ] **Step 4: Re-read the one caller that does not pass these**

Run: `grep -n "buildRoundContext(" src/utils/combat/triggers.ts src/utils/combat/playerTurn.ts`

There are six production call sites. Five pass `enemyHpPct` explicitly. The sixth — `NEUTRAL_NAMES_CTX` in `triggers.ts` (~`:2152`) — passes none of the five, so it silently held the phantom, and **`tsc` will not flag it** because the fields are optional. Its existing comment claims "a default (full-HP, no-debuff) round context". Correct the comment; do not add the fields back:

```ts
// Neutral resolver for the names-only aura/accum reads: a status's own conditions are evaluated
// against a NAMES-ONLY round context. SP-4d: it deliberately supplies no enemy-HP or target-stat
// reading, so any such gate here is UNRESOLVABLE rather than silently satisfied by a full-HP
// phantom — this ctx has no victim and never did. It remains a names-existence approximation: an
// "enemy has a buff" / "self has a debuff" gate only needs to know the status is present. No
// fixture exercises a conditional enemy aura/accum, so this is inert for current goldens.
```

- [ ] **Step 5: Run the full suite — this is the first step that can move behaviour**

Run: `npx vitest run`

Expected: green, no `.snap` modified. If a test fails, do **not** re-pin it. Read what it asserts: a gate that used to pass because of a fabricated reading is the bug this rung exists to fix, and the fixture needs to supply a real reading (or assert the new absence). Record any such fixture in the commit message — it is evidence the phantom was live, which the spec's §6 census predicted it was not.

- [ ] **Step 6: Commit**

```bash
git add src/utils/abilities/roundContext.ts src/utils/abilities/__tests__/roundContext.test.ts src/utils/combat/triggers.ts
git commit -m "fix(engine): buildRoundContext stops inventing absent enemy readings (SP-4d task 2)"
```

---

### Task 3: The cast path — gate-facing absence, display-facing number

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (the `enemyHpDecline`/`enemyHpPct` derivation ~`:1381`; the `PlayerTurnResult` return row ~`:4466`)
- Test: `src/utils/combat/__tests__/noVictimAbsentSubject.integration.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's absent rule, Task 2's non-defaulting builder.
- Produces: the turn-local `enemyHpPct: number | undefined`, forwarded to the five condition-context builders in this file. `PlayerTurnResult.enemyHpPct: number` stays **required** — it is the display row. A new exported constant `DISPLAY_ENEMY_HP_PCT_NO_VICTIM = 100`.

> **⚠️ CORRECT A STALE TYPE NAME BEFORE YOU START.** Three comments in `playerTurn.ts` (~`:1255`,
> ~`:1370`, ~`:1378`) and the `noVictimResidualTripwires.test.ts` header all name the fix site as
> **`PlayerRoundCtx.enemyHpPct` (~248), "make it optional"**. There is no such field:
> `PlayerRoundCtx` (declared at `:100`) carries no `enemyHpPct` at all, and the field at `:248` is
> **`PlayerTurnResult.enemyHpPct`** — the DISPLAY row, which this task deliberately keeps required.
> The gate-facing value is the turn-local `const enemyHpPct`, which flows into four
> `buildRoundContext` calls (`:1807`, `:2253`, `:2362`, `:2625`) plus one
> `buildActorConditionContext` call for a foreign caster's aura (~`:2168`). Widening the field at
> `:248` instead — which is what those comments instruct — would change the chart and move goldens
> while leaving every gate reading the phantom. Fix the three comments as part of this task.

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/__tests__/noVictimAbsentSubject.integration.test.ts`. It reuses the `noVictimPlayerTurn.test.ts` harness shape (same imports, same Hermes-shaped repair kit, same hurt-ally seeding — a repair on a full-HP ally is an overheal that may log nothing):

```ts
/**
 * SP-4d — the engine-level pin. A support ship's payload gated on a question about "the enemy"
 * does not fire on a turn that resolved no victim.
 *
 * THE GAME CASE: Hermes repairs an ally with a real enemy on the board. Give it Cobalt's real
 * clause shape — "If this Unit has more HP than the enemy" — attached to a self-shield. Before this
 * rung the enemy's HP read 0 on that turn, so 20,000 > 0 and the shield landed: a bonus whose own
 * text requires out-HPing an enemy, granted in a turn that had no enemy in it. The consumer
 * (`gateFiringAbilities`) is deliberately unfenced so the repair itself can land, so nothing else
 * suppresses it.
 *
 * Synthetic on purpose: no shipped kit can build this shape (none of the 24 ally-target ships
 * carries a phantom-satisfiable gate — spec §6), which is why the residual was tripwired rather
 * than red. Each case has a NEGATIVE half so it cannot pass by blocking everything.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { bareInput, bareAlly, bareEnemy, BARE_ALLY_ID } from '../__testutils__/bareRosterFixture';
import type { Condition, ShipSkills } from '../../../types/abilities';

const HURT_PCT = 0.4;

/** A Hermes-shaped repair, plus one self-shield carrying the gate under test. */
const repairKitWithGatedShield = (gate: Condition): ShipSkills =>
    ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'repair1',
                        type: 'heal',
                        target: 'all-allies',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'heal', pct: 27, basis: 'hp' },
                    },
                    {
                        id: 'gatedShield',
                        type: 'shield',
                        target: 'self',
                        trigger: 'on-cast',
                        conditions: [gate],
                        config: { type: 'shield', pct: 50, basis: 'hp' },
                    },
                ],
            },
        ],
    }) as ShipSkills;

const supportRun = (gate: Condition) => {
    const bus = createEventBus();
    const shieldsOnFocus: number[] = [];
    const allyRepairs: number[] = [];
    bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
        const forFocus = e.perTarget?.find((t) => t.targetId === 'attacker');
        if (forFocus && forFocus.amount > 0) shieldsOnFocus.push(forFocus.amount);
    });
    bus.on('heal-performed', (e: Extract<CombatEvent, { type: 'heal-performed' }>) => {
        const forAlly = e.perTarget?.find((t) => t.targetId === BARE_ALLY_ID);
        if (forAlly && forAlly.amount > 0) allyRepairs.push(forAlly.amount);
    });
    runCombat({
        ...bareInput(),
        mode: 'battle',
        position: 'M4',
        target: { raw: 'ally-team', side: 'ally', selection: 'team' },
        pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
        shipSkills: repairKitWithGatedShield(gate),
        teamActors: [bareAlly()],
        enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
        bus,
        __testTapActors: (actors) => {
            const ally = actors.find((a) => a.id === BARE_ALLY_ID);
            if (ally) ally.currentHp = ally.stats.hp * HURT_PCT;
        },
    });
    return { shieldsOnFocus, allyRepairs };
};

// Do NOT call resetRateGateRng() after setupKeyedTestRng() — reset un-seeds the test.
describe('SP-4d: a no-victim turn resolves no enemy-derived gate', () => {
    beforeEach(() => setupKeyedTestRng(12345));

    it("Cobalt's HP-vs-target clause does not grant the shield against nobody", () => {
        const { shieldsOnFocus, allyRepairs } = supportRun({
            subject: 'stat-vs-target',
            compareStat: 'hp',
            statComparator: 'gt',
            derivable: true,
        } as Condition);
        expect(shieldsOnFocus).toEqual([]);
        // The negative half, and the reason this is not a "block everything" test: the repair the
        // whole no-victim path exists to deliver must still land.
        expect(allyRepairs.length).toBeGreaterThan(0);
    });

    it('an enemy hp-threshold ABOVE gate does not grant the shield against nobody', () => {
        const { shieldsOnFocus, allyRepairs } = supportRun({
            subject: 'hp-threshold',
            hpComparator: 'above',
            hpPercent: 50,
            derivable: true,
        } as Condition);
        expect(shieldsOnFocus).toEqual([]);
        expect(allyRepairs.length).toBeGreaterThan(0);
    });

    it('an UNGATED shield on the same cast still lands — the turn is not being suppressed', () => {
        const { shieldsOnFocus } = supportRun({ subject: 'always', derivable: true } as Condition);
        expect(shieldsOnFocus.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run it and confirm the first two cases fail**

Run: `npx vitest run src/utils/combat/__tests__/noVictimAbsentSubject.integration.test.ts`
Expected: cases 1 and 2 FAIL — `shieldsOnFocus` is non-empty, because the phantom satisfied the gate. Case 3 passes. **If case 1 or 2 passes before you touch `playerTurn.ts`, stop**: the fixture is not reaching the gate (check that the run is `mode: 'battle'` with an ally-side target, and that `gateFiringAbilities` is what evaluates a `shield` payload) — a green test here would be the advertised-but-unbuilt-fixture failure this epic keeps catching.

- [ ] **Step 3: Make the gate-facing field optional and derive it only when there is a victim**

In `src/utils/combat/playerTurn.ts`, at the `enemyHpDecline` derivation (~`:1381`), replace both lines and the residual note above them:

```ts
    // SP-4d: with no victim there is no HP to have declined and no denominator to divide by, so
    // there is NO READING — the gate-facing value is absent, and every enemy-HP gate on this turn
    // is unresolvable rather than satisfied by a fabricated 100 ("a healthy enemy"). The
    // 4c-2b-era residual note that stood here is discharged; do not restore a `: 100` fallback.
    const enemyHpPct = hasVictim
        ? enemyHp > 0
            ? Math.max(0, 100 * (1 - Math.max(0, enemyHp - enemy.currentHp) / enemyHp))
            : 0
        : undefined;
```

Note the `: 0` in the inner branch: a victim whose max HP is 0 is a real victim with no HP, which is 0%, not 100%. Verify this branch is reachable at all before keeping it — if `normalizeCombatRoster` guarantees a positive max HP, replace the inner ternary with a direct division and say so in the comment rather than leaving an unreachable arm.

The four `buildRoundContext` literals in this file pass `enemyHpPct,` — leave them exactly as they are. They now forward `undefined`, and Task 2 made the builder withhold the key.

- [ ] **Step 4: Give the display row its own honest name**

`PlayerTurnResult.enemyHpPct` stays a required `number` — it is the round chart's value, not a gate reading. `tsc` will now flag the `return { action, roundCrit, hitCrits, enemyHpPct, … }` row (~`:4466`), because the local is `number | undefined`. That is the one site to fix, and it is the display boundary:

```ts
/** DISPLAY ONLY. The round chart needs a number for a turn that struck nobody; this is NOT a
 *  reading of any enemy's HP, and the gate-facing `enemyHpPct` on the same turn is ABSENT.
 *  Kept at 100 so the chart and every golden stay byte-identical across SP-4d. The honest display
 *  value for a multi-enemy roster is a separate question — filed with #331. */
export const DISPLAY_ENEMY_HP_PCT_NO_VICTIM = 100;
```

and in the row assembly at `:4466`: `enemyHpPct: enemyHpPct ?? DISPLAY_ENEMY_HP_PCT_NO_VICTIM,`.

Leave the five condition-context call sites forwarding the bare local. They now pass `undefined`, which Task 2 (and Task 4, for `buildActorConditionContext`) turns into a withheld key.

- [ ] **Step 5: Run the new test, then the full suite**

Run: `npx vitest run src/utils/combat/__tests__/noVictimAbsentSubject.integration.test.ts`
Expected: all three cases PASS.

Run: `npx tsc --noEmit`
Expected: clean. Errors here are the useful kind — each names a consumer that assumed a `number`. For a gate consumer, let the absence flow; for a display consumer, use `DISPLAY_ENEMY_HP_PCT_NO_VICTIM`.

Run: `npx vitest run`
Expected: green, **no `.snap` modified**.

- [ ] **Step 6: Prove the red tests can witness the rung**

Temporarily restore the old derivation (`const enemyHpPct = enemyHp > 0 ? Math.max(0, 100 * (1 - enemyHpDecline / enemyHp)) : 100;` with `enemyHpDecline` gated on `hasVictim`), re-run the new integration file, and confirm cases 1 and 2 FAIL again. Then revert the restoration.

This is not optional. 4c-2c shipped a tripwire whose fixture had already been fixed by an earlier rung, so it passed byte-identical against the old world — green, deterministic, observing nothing. A test that cannot fail against pre-rung semantics is not evidence.

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/engine.ts src/utils/combat/__tests__/noVictimAbsentSubject.integration.test.ts
git commit -m "fix(engine): a no-victim turn has no enemy-HP reading (SP-4d task 3)"
```

---

### Task 4: The drain path, and the footprint

**Files:**
- Modify: `src/utils/combat/triggers.ts` (`buildDrainContext` ~`:2051`; `IntentExecContext.enemyHp` ~`:1486`; `buildActorConditionContext`'s `shared.enemyHpPct` ~`:1787`/`:1861`; `buildPerVictimConditionCtx`'s `base.enemyHpPct` fallback ~`:2782`)
- Modify: `src/utils/combat/playerTurn.ts` (~`:2168` — the fifth condition-context builder, a foreign caster's aura, which also forwards `enemyHpPct`)
- Modify: `src/utils/combat/engine.ts` (`enemiesHitThisCastFor` resolver ~`:8474`; the `enemyHp,` member of the `IntentExecContext` literal ~`:8316`)
- Test: `src/utils/combat/__tests__/noVictimAbsentSubject.integration.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's absent rule; Task 3's optional `PlayerRoundCtx.enemyHpPct`.
- Produces: `IntentExecContext.enemyHp` **deleted**. `buildActorConditionContext`'s `shared.enemyHpPct?: number` (was required). `enemiesHitThisCastFor: (ownerId: string) => number | undefined`.

- [ ] **Step 1: Measure before you change anything (spec §6.1 items 2 and 3)**

Two claims this task rests on are currently code-readings, and §7.5's rule is that reachability is a measurement.

**(a) Is the drain-time reading really a constant 100 on every positional run?** Add a temporary `console.error` at `buildDrainContext`'s derivation reporting the computed `enemyHpPct` and run `npx vitest run 2>&1 | grep ... | sort | uniq -c`. Expect every value to be exactly 100. Any other value names a fixture where the drain gate reads something real, and that fixture's behaviour will change — investigate before proceeding.

**(b) Does a real single-target cast register a footprint, or does it rely on `?? 1`?** Same technique at the `enemiesHitThisCastFor` resolver: log whether the map had an entry. Expect hits with entries from positional casts. This decides nothing about correctness (`1` and absent both fail every `gte 2`/`gte 3` reader in the corpus) but it tells you whether the fix belongs at the booking site or the resolver.

Record both results in the commit message. Remove the probes before committing.

- [ ] **Step 2: Write the failing test**

Append to `src/utils/combat/__tests__/noVictimAbsentSubject.integration.test.ts` a drain-path case. Use a reactive (non-`on-cast`) trigger so the gate is evaluated by `buildDrainContext` rather than the cast path:

```ts
    it('a REACTIVE payload gated on an enemy hp-threshold ABOVE does not fire at drain time', () => {
        // The drain context's enemy-HP reading was a fight-wide scalar
        // (`100 * (1 - cumulativeDamage / enemyHp)`) which — because positional credit books
        // per-victim and never feeds `cumulativeDamage` — sat at exactly 100 on every positional
        // run, i.e. on every run there is. A `below` gate read false there (dead but fail-closed);
        // an `above` gate read TRUE against a number describing no actor on the board.
        const bus = createEventBus();
        const shieldsOnFocus: number[] = [];
        bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
            const forFocus = e.perTarget?.find((t) => t.targetId === 'attacker');
            if (forFocus && forFocus.amount > 0) shieldsOnFocus.push(forFocus.amount);
        });
        runCombat({
            ...bareInput(),
            mode: 'battle',
            position: 'M4',
            target: { raw: 'ally-team', side: 'ally', selection: 'team' },
            pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'repair1',
                                type: 'heal',
                                target: 'all-allies',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'heal', pct: 27, basis: 'hp' },
                            },
                        ],
                    },
                    {
                        slot: 'passive',
                        abilities: [
                            {
                                id: 'reactiveShield',
                                type: 'shield',
                                target: 'self',
                                trigger: 'on-repair',
                                conditions: [
                                    {
                                        subject: 'hp-threshold',
                                        hpComparator: 'above',
                                        hpPercent: 50,
                                        derivable: true,
                                    },
                                ],
                                config: { type: 'shield', pct: 50, basis: 'hp' },
                            },
                        ],
                    },
                ],
            } as ShipSkills,
            teamActors: [bareAlly()],
            enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
            bus,
            __testTapActors: (actors) => {
                const ally = actors.find((a) => a.id === BARE_ALLY_ID);
                if (ally) ally.currentHp = ally.stats.hp * HURT_PCT;
            },
        });
        expect(shieldsOnFocus).toEqual([]);
    });
```

Confirm the trigger name against `src/types/abilities.ts` before running — if `'on-repair'` is not a modelled reactive trigger, pick one that is (the reactive-trigger union is the authority) and keep the gate identical. A test whose trigger never fires is vacuous no matter what it asserts.

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/utils/combat/__tests__/noVictimAbsentSubject.integration.test.ts -t 'REACTIVE'`
Expected: FAIL — the shield lands, because the drain ctx answered 100.

- [ ] **Step 4: Stop deriving the drain reading**

In `buildDrainContext` (`src/utils/combat/triggers.ts`), delete the derivation:

```ts
    const enemyHpPct =
        ctx.enemyHp > 0 ? Math.max(0, 100 * (1 - ctx.cumulativeDamage / ctx.enemyHp)) : 100;
```

and pass no reading at all — remove the `enemyHpPct,` member from the `buildActorConditionContext` call, with a comment where it stood:

```ts
        // SP-4d: NO fight-wide enemy-HP reading. It used to be
        // `100 * (1 - cumulativeDamage / enemyHp)`, both terms legacy scalars describing the dummy
        // sink SP-4c-2d deleted; on a positional run (every run) it sat at a constant 100. A
        // `below` gate read false off it and an `above` gate read TRUE against nobody. Enemy-HP
        // gates that CAN be re-checked per resolved target already are (`perVictimOk`, see
        // splitDrainGateConditions); the rest are now honestly unresolvable instead of
        // dead-but-fail-closed. Do not reintroduce a scalar here.
```

Then make the parameter optional in `buildActorConditionContext`:

```ts
        /** SP-4d: OPTIONAL. Absent means the caller has no single enemy to report an HP% for — the
         *  drain path never does. Forwarded as-is; never defaulted (spec §3.2). */
        enemyHpPct?: number;
```

and keep the forward at the built-context site conditional so the key is genuinely absent:

```ts
        ...(shared.enemyHpPct !== undefined ? { enemyHpPct: shared.enemyHpPct } : {}),
```

- [ ] **Step 5: Fix the per-victim fallback**

`buildPerVictimConditionCtx` (~`:2782`) falls back to `base.enemyHpPct` when the victim's max HP is unknown, and its own comment already says the fallback "describes NO actor". With `base.enemyHpPct` now optional, that fallback becomes absence — which is the correct answer. Adjust the type and the comment:

```ts
    // A victim with a known max HP reports ITS OWN live HP%. Otherwise there is no reading: SP-4d
    // made `base.enemyHpPct` absent (it was the legacy fight-wide scalar this comment already
    // described as belonging to no actor), so the gate is unresolvable rather than answered by a
    // number about nobody.
    const enemyHpPct =
        maxHp > 0 ? Math.max(0, Math.min(100, (100 * victim.currentHp) / maxHp)) : base.enemyHpPct;
```

- [ ] **Step 6: Delete `IntentExecContext.enemyHp` and the footprint default**

In `src/utils/combat/triggers.ts`, delete the `enemyHp: number;` member of `IntentExecContext` (~`:1486`). `tsc` will name the literal in `engine.ts` (~`:8316`) that supplies it — delete that member too.

In `src/utils/combat/engine.ts`, the resolver:

```ts
                        // SP-D: live per-actor count of enemies damaged by that actor's most recent
                        // cast this round (Berserker's Marauder Rage, drained via on-deal-damage).
                        // SP-4d: absent id → UNDEFINED, not 1. An owner with no recorded footprint
                        // did not hit one enemy; nothing is known about its footprint, so an
                        // `enemies-hit-this-cast` gate does not resolve. Tygr's `gte 2` and
                        // Berserker's `gte 3` are unaffected — 1 failed them too.
                        enemiesHitThisCastFor: (ownerId) => enemiesHitThisCastByActor.get(ownerId),
```

Update the resolver's type on `IntentExecContext` to `(ownerId: string) => number | undefined` and follow `tsc` to the drain-context forward, which must stay conditional (no key when absent).

- [ ] **Step 7: Run the new case, then the full suite**

Run: `npx vitest run src/utils/combat/__tests__/noVictimAbsentSubject.integration.test.ts`
Expected: all four cases PASS.

Run: `npx tsc --noEmit` — clean. Run: `npx vitest run` — green, no `.snap` modified.

- [ ] **Step 8: Prove the new case can witness the rung**

Restore the deleted `buildDrainContext` derivation temporarily (re-add a local `const enemyHpPct = 100;` and forward it), re-run the REACTIVE case, confirm it FAILS, then revert.

- [ ] **Step 9: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/engine.ts src/utils/combat/__tests__/noVictimAbsentSubject.integration.test.ts
git commit -m "fix(engine): the drain path has no fight-wide enemy-HP reading (SP-4d task 4)"
```

---

### Task 5: The skip row, and `enemyHp`'s last reader

**Files:**
- Modify: `src/utils/combat/engine.ts` (`pushSynthesizedFocusSkipTurn` ~`:8131-8152`; the `enemyHp = 1_000_000_000` destructure ~`:1880` and its comment block ~`:1870-1879`)

**Interfaces:**
- Consumes: `DISPLAY_ENEMY_HP_PCT_NO_VICTIM` from Task 3; Task 4 having removed the drain reader.
- Produces: no reader of `input.enemyHp` anywhere in `engine.ts`.

- [ ] **Step 1: Write the failing check as a grep, not a test**

There is nothing behavioural to assert here — the change is a value-level no-op by construction (the skip row's derivation is `min(cumulative, max(0, enemyHp))` over a 1e9 denominator, measured 0 on all 152 calls when 4c-2d introduced it). The falsifiable statement is about readers:

Run: `grep -n "enemyHp\b" src/utils/combat/engine.ts | grep -v "enemyHpPct" | grep -v "^\s*//"`

Expected **before** this task: the destructure, the skip-row derivation, and the two per-victim `enemyHp:` arguments (`tb.victimMaxHpFor(tgt)`, `recipientMaxHp(...)` — those are per-victim max HP passed to `tickDoTs`, **not** the input scalar; leave them alone).
Expected **after**: only the per-victim arguments.

- [ ] **Step 2: Replace the skip-row derivation with the display constant**

In `pushSynthesizedFocusSkipTurn`, delete the `enemyHpDecline`/`enemyHpPct` block and use the constant:

```ts
            // The row's `enemyHpPct` for a turn that never happened. SP-4d: this was the LAST
            // reader of the `enemyHp` input — a scalar restored by 4c-2d when the dummy actor it
            // described was deleted, dividing a cumulative-damage numerator (which positional
            // credit never feeds) by a 1e9 denominator, so it reported 100 on all 152 measured
            // calls. It is a DISPLAY value for a turn with no victim, so it now says so by name.
            // Filed separately (with #331): on a round where the focus died, the chart therefore
            // reports "Enemy HP: 100%" while the real enemy may be at 12% — that is the display
            // layer's own question, and naming this constant is what makes it findable.
            const enemyHpPct = DISPLAY_ENEMY_HP_PCT_NO_VICTIM;
```

Import the constant from `playerTurn.ts`.

- [ ] **Step 3: Delete the destructure and its stale comment**

Remove `enemyHp = 1_000_000_000,` from `runCombat`'s destructure, and delete the comment block above it wholesale — including the sentence *"and `enemyHp` is a REQUIRED field"*, which has contradicted the declaration 650 lines below since 4c-2d widened the field (spec §1.1). Replace it with one line:

```ts
        // SP-4d: `enemyDefense` / `enemyHp` / `enemySecurity` / `enemySpeed` are gone from
        // `CombatEngineInput` entirely — they were the deleted dummy actor's stat block, and their
        // last two readers were enemy-HP% phantoms. A victim's real HP/defence come from the
        // positioned `enemyAttackers` roster.
```

- [ ] **Step 4: Verify**

Run the Step 1 grep — only the per-victim arguments remain.
Run: `npx tsc --noEmit` — clean. Run: `npx vitest run` — green, **no `.snap` modified**. Golden movement here would mean the skip row's derivation was NOT the constant it was measured to be; investigate rather than re-pin.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(engine): the skip row's enemy HP% is a named display constant (SP-4d task 5)"
```

---

### Task 6: Delete the four fields

**Files:**
- Modify: `src/utils/combat/engine.ts` (`CombatEngineInput.enemyDefense` ~`:1222`, `enemyHp` ~`:1223`, `enemySecurity` ~`:1259`, `enemySpeed` ~`:1270`, and the long doc comments above them)
- Modify: `src/utils/calculators/dpsSimulator.ts` (the `runCombat` argument list: `enemyDefense`, `enemyHp`, `enemySecurity`, `enemySpeed`)
- Modify: `src/utils/calculators/healingEngineAdapter.ts` (`enemyDefense: LEGACY_SINK_DEFENCE`, `enemyHp: LEGACY_SINK_HP`, `enemySecurity: LEGACY_SINK_SECURITY`, `enemySpeed: 0`)
- Modify: ~268 files passing one of the four to `runCombat`

**Interfaces:**
- Consumes: Tasks 3–5 having removed every reader.
- Produces: `CombatEngineInput` with no fight-wide enemy scalars. `DPSSimulationInput` keeps its own four unchanged.

- [ ] **Step 1: Re-measure the churn at the branch point**

Do not use this plan's numbers. Run:

```bash
node -e '
const fs=require("fs"),path=require("path");const files=[];
(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
 if(e.isDirectory())w(p);else if(/\.tsx?$/.test(e.name))files.push(p);}})("src");
let total=0;const counts={};let n=0;
for(const f of files){const s=fs.readFileSync(f,"utf8");
 const m=s.match(/\benemy(Hp|Defense|Speed|Security)\s*:/g);if(!m)continue;n++;total+=m.length;
 for(const x of m){const k=x.replace(/\s*:/,"");counts[k]=(counts[k]||0)+1;}}
console.log("files:",n,"occurrences:",total,counts);'
```

Record the result in the commit message. At `dc7f2056` it read 268 files / 1,109 occurrences (`enemyHp` 524, `enemyDefense` 496, `enemySecurity` 73, `enemySpeed` 16); a materially different number means something moved and the inventory needs re-reading, not overriding.

- [ ] **Step 2: Delete the four fields and their doc comments**

In `src/utils/combat/engine.ts`, remove the four members from `CombatEngineInput` together with the multi-paragraph comments above them (they describe the dummy's stat block, the 1e9 fallback, and "removing them is rung 4d's job" — all discharged here).

- [ ] **Step 3: Let `tsc` name every call site**

Run: `npx tsc --noEmit 2>&1 | tee /tmp/sp4d-churn.txt | tail -5`

Every error is an excess property in an object literal — the fields are already optional, so each is a pure deletion. Work the list. This is the gate: **a missed site is a compile error, not a silent survivor**, which is what makes a ~1,100-line mechanical sweep safe.

Two rules while sweeping:

1. **Do not touch `DPSSimulationInput`'s own four fields.** They are the DPS calculator's real enemy configuration and still build `synthesizedDpsEnemy` when a caller supplies no roster (spec §5.1). A test constructing a `DPSSimulationInput` (e.g. `dpsSimulator.test.ts`, `dpsRealEnemyFixture.ts`) keeps them; a test constructing a `CombatEngineInput` loses them.
2. **Do not delete a fixture's `enemyAttackers` entry alongside the scalar.** Several fixtures keep a roster entry's `stats.hp` in step with the old scalar (`statVsTargetGate.integration.test.ts` says so explicitly). The roster entry is the real victim and must stay.

- [ ] **Step 4: Trim the two adapters**

`src/utils/calculators/dpsSimulator.ts`: remove `enemyDefense`, `enemyHp`, `enemySecurity`, `enemySpeed` from the `runCombat` argument list and update the surrounding comments (they say "passed on for rung 4d to remove"). Keep the local `enemyDefense` / `enemyHp` / `enemySpeed` / `enemySecurity` bindings — `synthesizedDpsEnemy` still needs them.

`src/utils/calculators/healingEngineAdapter.ts`: remove the four `LEGACY_SINK_*` / `0` arguments to `runCombat`. **Keep `LEGACY_SINK_DEFENCE` / `LEGACY_SINK_HP` / `LEGACY_SINK_SECURITY` themselves** — they are still the per-enemy roster defaults at the `e.stats.defence ?? LEGACY_SINK_DEFENCE` block, which describes real roster members whose card left a stat blank. Update the `LEGACY_SINK_*` comment block so it stops describing a pass-through it no longer performs.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npm run lint` — clean.
Run: `npx vitest run` — green, **no `.snap` modified**.
Run: `grep -rn "enemyDefense\|enemySpeed\|enemySecurity" src --include="*.ts" --include="*.tsx" | grep -v "DPSSimulationInput\|dpsSimulator\|LEGACY_SINK\|enemyDefenseModifier" | head -20` — read whatever survives and confirm each is a per-victim or DPS-input use, not an engine-boundary one.

- [ ] **Step 6: Commit**

Commit the churn **separately** from the type change if the diff is large enough to bury it — reviewers (human and CodeRabbit) get one hour per review on this repo, and ~1,100 mechanical deletions in the same commit as a semantics change wastes it.

```bash
git add -A src
git commit -m "refactor(engine)!: delete the four fight-wide enemy scalars (SP-4d task 6)"
```

---

### Task 7: Migrate the tripwires, sweep the claims, close the issues

**Files:**
- Modify: `src/utils/combat/__tests__/noVictimResidualTripwires.test.ts`
- Modify: `src/utils/combat/playerTurn.ts`, `src/utils/combat/engine.ts`, `src/utils/combat/triggers.ts` (comment sweep only)
- Modify: `docs/superpowers/specs/2026-08-20-sp4d-phantom-scalars-and-dead-inputs-design.md` (amendment section)

- [ ] **Step 1: Convert the three tripwire cases into direct assertions**

The file's three cases exist because the phantoms could not be asserted directly — each scans the corpus to prove no shipped kit can observe the phantom. Tasks 1–4 make the phantoms directly assertable, so the cases become redundant with `absentSubject.test.ts` and `noVictimAbsentSubject.integration.test.ts`.

**Migrate, do not delete.** SP-4c §9.5 ruled migrate-don't-delete for exactly this situation and CodeRabbit enforced it once already on that rung. Specifically:

- Delete cases (a), (b) and (c) — each replaced by a named case in the two new files. In each deletion, note in the new file's header which tripwire it discharges.
- **Keep** the `is non-vacuous: the corpus scan really produces conditions` case and the `ALLY_TARGET_SHIPS is not stale` pin, moving them to whichever file still scans the corpus. If neither new file scans the corpus, keep this file with those two cases and a rewritten header explaining that it now guards the corpus census the spec's §6 inertness claims rest on.
- Rewrite the file header: the residuals are fixed, and the header must not keep describing them in the present tense. A HISTORY banner must be scoped to exactly what it disclaims — 4c-2c shipped one that covered a single claim while four present-tense falsehoods survived beneath it.

- [ ] **Step 2: Run the migrated file**

Run: `npx vitest run src/utils/combat/__tests__/noVictimResidualTripwires.test.ts`
Expected: PASS with the remaining cases; no case still asserting a phantom is unobservable.

- [ ] **Step 3: Sweep every comment that describes the old world**

Run: `grep -rn "phantom\|residual\|rung 4d\|4d's\|REQUIRED field\|dummy sink\|PlayerRoundCtx.enemyHpPct" src/utils/combat/*.ts src/utils/abilities/*.ts src/utils/calculators/*.ts src/utils/combat/__tests__/noVictimResidualTripwires.test.ts`

Read every hit and re-tense or delete it. **When you narrow a claim, sweep every document that carries it** — 4c-2c fixed a false claim in the engine, the test header and the spec, left it standing in the plan, and CodeRabbit found it there. That includes this plan file and the spec.

- [ ] **Step 4: Full verification**

```bash
npx vitest run                 # green
npx tsc --noEmit               # clean
npm run lint                   # clean
git diff --name-only main...HEAD | grep '\.snap' || echo "ZERO golden movement"
```

Then the oracle at `--seeds 15`; expected `147 / 146 / 2` (the two known-open Enforcer `debuff-resisted` seeds, likely RNG). Do not accept a different reading without explaining it.

- [ ] **Step 5: Changelog decision — record it, do not skip it silently**

No `UNRELEASED_CHANGES` entry. Every behaviour change in this rung is measured corpus-inert: no shipped kit carries a phantom-satisfiable gate (spec §6), so no user can observe a different number. State this in the PR body so the omission reads as a decision rather than an oversight. If Task 2 or 3 turned up a fixture whose behaviour genuinely moved, that is a user-visible change and it **does** need an entry.

- [ ] **Step 6: Amend the spec with what the rung actually cost**

Add an amendment section to the spec stating its own measurement point (the branch HEAD, not `dc7f2056`): suite file/test counts, the re-measured churn, whether golden movement was zero, the oracle reading, and each §6.1 measurement's actual answer. A churn figure ages exactly the way a reachability claim does — the amendment is what stops the next rung quoting a stale table, which is the mistake this rung began by correcting.

- [ ] **Step 7: Issue housekeeping**

```bash
gh auth switch --user TheSusort
```

- Close **#333** referencing the PR.
- **Verify and close #334.** Its resolution reads as shipped in 4c-2d's commit 1 (*"warn when an authored infliction names no enemy"*, `dc7f2056`). Confirm against the code before closing; if it is genuinely still open, say so and leave it.
- **File the display issue**: on a round where the focus is destroyed before its turn, the round chart reports `Enemy HP: 100%` while the real enemy may be at 12%. Reference `DISPLAY_ENEMY_HP_PCT_NO_VICTIM` as the exact site and link #331 as the same family (`RoundData` still describing a one-enemy world).
- **File the fail-closed residue issue**: `enemyDebuffCount` / `enemyDotCount` / `enemyShielded` still answer `0` / `false` with no victim, which only misfires under `eq`/`lte` — no parser path emits that for an enemy subject and the corpus contains none, so it is authorable-only, the same reachability class as the parked OR-run hazard from #328. Quote spec §3.1's per-victim-vs-side-wide rule so the follow-up does not have to re-derive it.

- [ ] **Step 8: Commit and open the PR**

```bash
git add -A src docs
git commit -m "test(engine): migrate the no-victim tripwires to direct assertions (SP-4d task 7)"
```

Open the PR with: the game example from spec §2, the measured outcome table, the §6.1 answers, the zero-golden-movement statement, and the changelog decision. Merge when green per the owner's standing rule, after confirming CodeRabbit actually reviewed — a rate-limited run reports **pass** without reviewing, so verify via the reviews API rather than trusting the green check, and remember it EDITS its summary comment rather than posting a new one.

---

## Self-Review

**Spec coverage.** §1/§1.1 (one rung, stale premise) → Tasks 5, 6 and Task 7 Step 6. §2 (the fight) → the headers of both new test files. §3 (mechanism) → Task 1. §3.1 (per-victim vs side-wide) → Task 1 Steps 4–5 plus its side-wide case; the residue is filed in Task 7 Step 7. §3.2 (two layers) → Task 2, and Task 2 Step 4 covers the third, `tsc`-invisible layer (`NEUTRAL_NAMES_CTX`). §3.3 (the three subjects) → Tasks 1, 3, 4. §4 (gate/display split) → Task 3 Step 4, Task 5 Step 2. §5 inventory → Tasks 3–6, one row each. §5.1 (what stays) → Task 6 Steps 3–4. §6 (measurements taken) → cited in comments where load-bearing. §6.1 (measurements owed) → Task 4 Step 1 and Task 6 Step 1. §7 (tests and exit criteria) → Tasks 1–4 plus Task 7 Step 4. §8 (out of scope) → Task 7 Step 7 files each item.

**Placeholders.** None. Every code step carries the actual code; the one place the plan cannot pre-compute an answer (the reactive trigger name in Task 4 Step 2) says so explicitly and names the authority to check, rather than leaving a silent guess.

**Type consistency.** `evaluateCondition(cond, ctx): number | undefined` (Task 1) is what `conditionMet`, `scaledBonus` and the `playerTurn` scale read (Task 1 Steps 5–7). `ConditionContext.enemyHpPct?: number` (Task 1) is what `buildRoundContext` forwards conditionally (Task 2), what `PlayerRoundCtx.enemyHpPct?: number` feeds (Task 3), and what `buildActorConditionContext`'s `shared.enemyHpPct?: number` and `buildPerVictimConditionCtx`'s fallback consume (Task 4). `DISPLAY_ENEMY_HP_PCT_NO_VICTIM` is defined once in Task 3 Step 4 and imported in Task 5 Step 2 under that exact name. `enemiesHitThisCastFor: (ownerId: string) => number | undefined` (Task 4 Step 6) matches `ConditionContext.enemiesHitThisCast?: number` (unchanged type, new meaning for absence).
