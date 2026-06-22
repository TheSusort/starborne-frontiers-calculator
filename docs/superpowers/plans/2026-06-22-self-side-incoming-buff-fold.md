# Self-/friendly-side incoming-damage buff fold (D-PR12) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold friendly-side `Inc. Damage Down/Up` buffs into the per-victim incoming-damage modifier so a self-/ally-buffed ship actually takes less (or more) damage — lighting up Makoli, Salvation, Shelter, Refine, and the D-PR7 Battlecry implant.

**Architecture:** Mirror the existing enemy-side per-victim incoming fold on the friendly side. A new `victimSelfBuffs` reader (a `'self'`-side twin of `victimEnemyBuffs`) returns the victim's own friendly buffs; a new `toSelfIncomingDamageModifier` extractor sums their `incomingDamage`; the engine's per-victim closure (`victimEnemyModifiers` → renamed `victimIncomingModifiers`) adds that term to the same `incomingDamageModifier` that already flows into `victimHitDamage`'s `nonCritFactor`. Team-agnostic (one unified per-victim seam). Direct-damage channel only — incoming-DoT deferred.

**Tech Stack:** TypeScript, Vitest. Pure combat-engine utilities under `src/utils/combat/` and `src/utils/calculators/`.

**Spec:** `docs/superpowers/specs/2026-06-22-self-side-incoming-buff-fold-design.md`

**Base:** branch `feat/combat-d-pr12-self-side-incoming-buff-fold`, worktree `.worktrees/d-pr12-self-incoming-buff-fold`, stacked on D-PR11 tip `e859a75a`.

---

## Critical conventions (read before starting)

- **NEVER run bare `npm test` / `npm test --`** — it launches Vitest in WATCH mode and hangs the agent. Always use `npx vitest run <path-or-name>`.
- **NEVER run `vitest -u` / `--update`** to "fix" golden/`.snap` mismatches blindly. Golden movement in this PR is EXPECTED but each delta must be **audited** (Task 6) before any snapshot is updated.
- **Commits trigger a pre-commit hook that runs the full Vitest suite** (slow). Run targeted `npx vitest run` first to confirm green, then commit. Use the commit messages given.
- Line numbers in this plan are anchored to the D-PR11 base (`e859a75a`) and are approximate — **resolve every reference by symbol name** (grep), not the number.
- All sign conventions follow enemy-side: `parsedEffects.incomingDamage` negative = less damage taken (`-30` → `×0.70`); positive = more.

---

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/utils/calculators/dpsBuffHelpers.ts` | buff→modifier extractors | + `toSelfIncomingDamageModifier` (mirror of `toEnemyModifiers`'s incoming reducer) |
| `src/utils/combat/triggers.ts` | per-victim status readers | + `victimSelfBuffs` (mirror of `victimEnemyBuffs`); import `expandBuffEntry` |
| `src/utils/combat/engine.ts` | per-victim modifier wiring | rename closure `victimEnemyModifiers` → `victimIncomingModifiers`; add self term; add 2 imports |
| `src/utils/calculators/__tests__/dpsBuffHelpers.selfIncoming.test.ts` | unit | NEW — Task 1 |
| `src/utils/combat/__tests__/victimSelfBuffs.test.ts` | unit | NEW — Task 2 (mirror `victimEnemyBuffs.test.ts`) |
| `src/utils/combat/__tests__/selfIncomingBuffFold.integration.test.ts` | engine integration | NEW — Tasks 3–4 (mirror `incomingReductionEngine.test.ts`) |
| `src/constants/changelog.ts` | user-facing changelog | + UNRELEASED_CHANGES entry — Task 5 |

---

## Task 1: `toSelfIncomingDamageModifier` extractor (pure)

**Files:**
- Modify: `src/utils/calculators/dpsBuffHelpers.ts` (next to `toEnemyModifiers`, ~line 71)
- Test: `src/utils/calculators/__tests__/dpsBuffHelpers.selfIncoming.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { toSelfIncomingDamageModifier } from '../dpsBuffHelpers';
import type { SelectedGameBuff } from '../../../types/calculator';

function buff(incomingDamage: number, stacks = 1): SelectedGameBuff {
    return {
        id: `b-${incomingDamage}-${stacks}`,
        buffName: 'Inc. Damage Down II',
        stacks,
        parsedEffects: { incomingDamage },
        isStackable: false,
    };
}

describe('toSelfIncomingDamageModifier', () => {
    it('returns 0 for an empty list', () => {
        expect(toSelfIncomingDamageModifier([])).toBe(0);
    });

    it('sums incomingDamage across buffs', () => {
        expect(toSelfIncomingDamageModifier([buff(-30), buff(-15)])).toBe(-45);
    });

    it('multiplies each entry by its stacks', () => {
        expect(toSelfIncomingDamageModifier([buff(-10, 3)])).toBe(-30);
    });

    it('preserves sign (Inc. Damage Up = positive)', () => {
        expect(toSelfIncomingDamageModifier([buff(30)])).toBe(30);
    });

    it('ignores buffs without an incomingDamage effect', () => {
        const noEffect: SelectedGameBuff = {
            id: 'x', buffName: 'Attack Up I', stacks: 1,
            parsedEffects: { attack: 15 }, isStackable: false,
        };
        expect(toSelfIncomingDamageModifier([noEffect])).toBe(0);
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/utils/calculators/__tests__/dpsBuffHelpers.selfIncoming.test.ts`
Expected: FAIL — `toSelfIncomingDamageModifier is not a function`.

- [ ] **Step 3: Implement** (in `dpsBuffHelpers.ts`, directly after `toEnemyModifiers`)

```ts
/** Sum the self-/friendly-side incoming-DIRECT-damage modifier from a victim's OWN buffs.
 *  Mirror of toEnemyModifiers' incoming reducer, but for friendly buffs (Inc. Damage Down/Up).
 *  Negative = less damage taken; positive = more. Summed into the same per-victim
 *  incomingDamageModifier as enemy-side debuffs (engine victimIncomingModifiers). */
export function toSelfIncomingDamageModifier(selected: SelectedGameBuff[]): number {
    return selected.reduce((sum, s) => sum + (s.parsedEffects.incomingDamage ?? 0) * s.stacks, 0);
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/utils/calculators/__tests__/dpsBuffHelpers.selfIncoming.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/calculators/dpsBuffHelpers.ts src/utils/calculators/__tests__/dpsBuffHelpers.selfIncoming.test.ts
git commit -m "feat(combat): D-PR12 — toSelfIncomingDamageModifier extractor"
```

---

## Task 2: `victimSelfBuffs` reader

A `'self'`-side twin of `victimEnemyBuffs` (`triggers.ts`, ~line 866). Reads the victim's own friendly buffs across three channels: scheduled self-buffs (`snapshot(victimId).activeSelfBuffs` expanded via `selfBuffLookup`), timed ability statuses, and aura/accumulating ability statuses.

**Files:**
- Modify: `src/utils/combat/triggers.ts` (add function next to `victimEnemyBuffs`; extend the `./buffTotals` import to include `expandBuffEntry`)
- Test: `src/utils/combat/__tests__/victimSelfBuffs.test.ts` (create — mirror `victimEnemyBuffs.test.ts`)

**Reference:** `src/utils/combat/__tests__/victimEnemyBuffs.test.ts` for the `createStatusEngine` harness and how to apply timed / aura statuses. Self-side equivalents:
- scheduled self-buff: seed via the engine's `selfBuffLookup` map + a `snapshot(victimId).activeSelfBuffs` entry (see how `selfBuffNamesForOwners` reads them, `triggers.ts` ~795).
- timed: `applyTimedAbilityStatus` with `side: 'self'` and `ownerId = victimId`.
- aura/accumulating: `registerAbilityStatuses` with `side: 'self'`, `ownerId = victimId`.

- [ ] **Step 1: Write the failing test**

Mirror `victimEnemyBuffs.test.ts`, but for `victimSelfBuffs(statusEngine, victimId, selfBuffLookup)` with `parsedEffects.incomingDamage` buffs. Cover:
1. Empty → `[]`.
2. A timed self-buff with `{ incomingDamage: -30 }` applied to `victimId` is returned (and `toSelfIncomingDamageModifier` of the result is `-30`).
3. A scheduled self-buff name present in `activeSelfBuffs` is expanded via `selfBuffLookup`.
4. **Isolation:** an *enemy-side* debuff on the same `victimId` is NOT returned by `victimSelfBuffs` (it reads the `'self'` store only).
5. **Per-actor:** a self-buff on actor A is NOT returned when querying actor B.

```ts
import { describe, it, expect } from 'vitest';
import { createStatusEngine } from '../statusEngine';
import { victimSelfBuffs } from '../triggers';
import { toSelfIncomingDamageModifier } from '../../calculators/dpsBuffHelpers';
import type { SelectedGameBuff } from '../../../types/calculator';

// (Build the harness by copying the helpers from victimEnemyBuffs.test.ts and switching
//  side 'enemy' → 'self' and the target/owner plumbing per the signatures in statusEngine.ts:
//    timedAbilityStatuses('self', ownerId)
//    activeAbilityStatuses('self', () => ctx, ownerId)
//    snapshot(ownerId).activeSelfBuffs )

function selfIncomingBuff(name: string, incomingDamage: number): SelectedGameBuff {
    return { id: `t-${name}`, buffName: name, stacks: 1,
        parsedEffects: { incomingDamage }, isStackable: false };
}

describe('victimSelfBuffs', () => {
    it('returns [] when the victim carries no self-buffs', () => {
        const se = createStatusEngine(/* … */);
        expect(victimSelfBuffs(se, 'ship-1', new Map())).toEqual([]);
    });

    it('returns a timed self incoming-damage buff applied to the victim', () => {
        // apply a timed 'self' status { incomingDamage: -30 } to 'ship-1'
        const se = createStatusEngine(/* … */);
        // … applyTimedAbilityStatus(side:'self', ownerId:'ship-1', payload incomingDamage:-30)
        const result = victimSelfBuffs(se, 'ship-1', new Map());
        expect(toSelfIncomingDamageModifier(result)).toBe(-30);
    });

    it('does NOT return enemy-side debuffs on the same victim id', () => {
        // apply an enemy-side debuff to 'ship-1'; victimSelfBuffs must ignore it
        const se = createStatusEngine(/* … */);
        expect(victimSelfBuffs(se, 'ship-1', new Map())).toEqual([]);
    });

    it('reads scheduled self-buffs via selfBuffLookup', () => {
        const lookup = new Map([['Inc. Damage Down I', [selfIncomingBuff('Inc. Damage Down I', -15)]]]);
        const se = createStatusEngine(/* with activeSelfBuffs: [{buffName:'Inc. Damage Down I'}] on ship-1 */);
        expect(toSelfIncomingDamageModifier(victimSelfBuffs(se, 'ship-1', lookup))).toBe(-15);
    });
});
```

> The implementer fills the harness from `victimEnemyBuffs.test.ts`. Keep the four behaviors above; the exact status-application calls follow that file's patterns.

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/victimSelfBuffs.test.ts`
Expected: FAIL — `victimSelfBuffs is not exported`.

- [ ] **Step 3: Implement** (in `triggers.ts`, directly after `victimEnemyBuffs`)

First extend the import at the top of `triggers.ts`:
```ts
import { expandEnemyDebuffs, payloadToSelectedBuff, expandBuffEntry } from './buffTotals';
```

Then add the reader (reuses the file-local `NEUTRAL_NAMES_CTX`):
```ts
/** Friendly twin of victimEnemyBuffs: a victim's OWN self-/ally-granted buffs, across all
 *  three channels — scheduled self-buffs (snapshot(victimId).activeSelfBuffs, expanded via
 *  selfBuffLookup), timed ability statuses, and aura/accumulating ability statuses. Used by
 *  the engine's per-victim incoming fold (victimIncomingModifiers) to source friendly
 *  Inc. Damage Down/Up. Team-agnostic: 'self'-side statuses are keyed by the actor's own id
 *  (same read used by selfBuffNamesForOwners for either team). The aura/accumulating channel
 *  carries the same NEUTRAL-ctx approximation noted on victimEnemyBuffs; the live ship sources
 *  (Makoli/Salvation/Shelter/Refine/Battlecry) are TIMED and not approximated. */
export function victimSelfBuffs(
    statusEngine: StatusEngine,
    victimId: string,
    selfBuffLookup: Map<string, SelectedGameBuff[]>
): SelectedGameBuff[] {
    const scheduled = statusEngine
        .snapshot(victimId)
        .activeSelfBuffs.flatMap((ab) => expandBuffEntry(ab, selfBuffLookup.get(ab.buffName) ?? []));
    const timed = statusEngine
        .timedAbilityStatuses('self', victimId)
        .map((s) => payloadToSelectedBuff(s.payload));
    const active = statusEngine
        .activeAbilityStatuses('self', () => NEUTRAL_NAMES_CTX, victimId)
        .map((s) => payloadToSelectedBuff(s.payload));
    return [...scheduled, ...timed, ...active];
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/victimSelfBuffs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/victimSelfBuffs.test.ts
git commit -m "feat(combat): D-PR12 — victimSelfBuffs friendly-side per-victim reader"
```

---

## Task 3: Wire the friendly term into the engine per-victim closure

Extend the per-victim modifier closure so its `incomingDamageModifier` includes the victim's own friendly buffs, summed with enemy-side. This is the behavior-changing step (lights up the sources). TDD via an engine integration test.

**Files:**
- Modify: `src/utils/combat/engine.ts` — the `victimEnemyModifiers` closure (~line 2826); imports near top (~line 79 `victimEnemyBuffs` from triggers; ~line 21 dpsBuffHelpers)
- Test: `src/utils/combat/__tests__/selfIncomingBuffFold.integration.test.ts` (create)

**Reference for the integration harness:** `src/utils/combat/__tests__/incomingReductionEngine.test.ts` — D-PR3's engine test that sets up a victim with an incoming-reduction ability and asserts reduced taken damage via `runCombat`. Mirror its two-team / positional setup but give the victim a friendly `Inc. Damage Down` self-buff instead of an incoming-reduction ability.

- [ ] **Step 1: Write the failing integration test**

Set up a `runCombat` where a victim ship carries `Inc. Damage Down II` (`incomingDamage: -30`) as a self-buff and is hit by an opponent. Capture the victim's taken direct damage, and compare against an identical run WITHOUT the buff. Assert the buffed run's taken damage ≈ 0.70× the baseline (allow a small tolerance for rounding).

```ts
// Pattern (fill plumbing from incomingReductionEngine.test.ts):
//   const baseline = runCombat(setupWithoutBuff);
//   const buffed   = runCombat(setupWithInc.DamageDownII_onVictim);
//   const takenBase = takenDirectDamage(baseline, victimId);
//   const takenBuff = takenDirectDamage(buffed, victimId);
//   expect(takenBuff).toBeCloseTo(takenBase * 0.70, /*precision*/ 0);
//   expect(takenBuff).toBeLessThan(takenBase);
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/selfIncomingBuffFold.integration.test.ts`
Expected: FAIL — buffed taken damage equals baseline (buff is currently emit-only).

- [ ] **Step 3: Implement the fold**

Top-of-file imports:
```ts
// add to the triggers import (the line with victimEnemyBuffs):
import { /* …, */ victimEnemyBuffs, victimSelfBuffs } from './triggers';
// add to the dpsBuffHelpers import (the line with toEnemyModifiers):
import { toSimBuffs, toEnemyModifiers, toEnemyDotModifier, toSelfIncomingDamageModifier } from '../calculators/dpsBuffHelpers';
```

Rewrite the closure (rename `victimEnemyModifiers` → `victimIncomingModifiers`; keep the existing comment, append a friendly-side note):
```ts
const victimIncomingModifiers = (
    victimId: string
): { enemyDefenseModifier: number; incomingDamageModifier: number } => {
    const enemy = toEnemyModifiers(victimEnemyBuffs(statusEngine, victimId, enemyDebuffLookup));
    // D-PR12: friendly-side incoming-DIRECT-damage buffs on the victim's OWN 'self' store
    // (Inc. Damage Down/Up — Makoli/Salvation/Shelter/Refine/Battlecry). Summed into the SAME
    // per-victim incomingDamageModifier as enemy debuffs. Team-agnostic (victimId keys the
    // actor's own self store regardless of side). Direct channel only; incoming-DoT deferred.
    const selfIncoming = toSelfIncomingDamageModifier(
        victimSelfBuffs(statusEngine, victimId, selfBuffLookup)
    );
    return {
        enemyDefenseModifier: enemy.enemyDefenseModifier,
        incomingDamageModifier: enemy.incomingDamageModifier + selfIncoming,
    };
};
```

Update the test-tap call to pass the renamed closure (keep the existing field name `__testTapVictimEnemyModifiers` to avoid type/test churn — it now also reflects the friendly term, which is 0 when no self-buffs are present, so existing tap tests stay green):
```ts
input.__testTapVictimEnemyModifiers?.(victimIncomingModifiers);
```

Verify `selfBuffLookup` is in scope here (declared ~line 1403 in the same `runCombat` body, used alongside `enemyDebuffLookup`). It is.

- [ ] **Step 4: Run the new test + the existing per-victim/tap tests, verify they pass**

```bash
npx vitest run src/utils/combat/__tests__/selfIncomingBuffFold.integration.test.ts \
  src/utils/combat/__tests__/perVictimDefenseDebuff.test.ts \
  src/utils/combat/__tests__/victimEnemyBuffs.test.ts \
  src/utils/combat/__tests__/incomingReductionEngine.test.ts
```
Expected: PASS. (Existing tap/per-victim tests carry no friendly self-buffs → friendly term = 0 → unchanged.)

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/selfIncomingBuffFold.integration.test.ts
git commit -m "feat(combat): D-PR12 — fold friendly-side incoming-damage buffs per-victim"
```

---

## Task 4: Team-agnostic mirror + D-PR3 additive composition

Add two more cases to `selfIncomingBuffFold.integration.test.ts` proving (a) the fold works when the buffed victim is an **enemy-side** ship (team-agnostic) and (b) a friendly buff **and** a D-PR3 `incoming-reduction` ability combine **additively within one factor**, not as a product.

**Files:**
- Modify: `src/utils/combat/__tests__/selfIncomingBuffFold.integration.test.ts`

- [ ] **Step 1: Add the failing/teaching cases**

```ts
it('reduces incoming damage for a self-buffing ENEMY-side victim (team-agnostic)', () => {
    // Mirror the Task-3 setup but place the Inc. Damage Down ship on the ENEMY team and
    // have a player attack it. Assert its taken damage ≈ 0.70× the no-buff baseline.
});

it('composes ADDITIVELY with a D-PR3 incoming-reduction ability (one factor, not a product)', () => {
    // Victim carries BOTH: a friendly Inc. Damage Down II (-30) self-buff AND a D-PR3
    // incoming-reduction ability worth 20% (equipReductionPct = 20).
    // incoming = (-30) - 20 = -50 → factor (1 + -50/100) = 0.50.
    // Assert taken ≈ 0.50× baseline — NOT the product 0.70 × 0.80 = 0.56.
    // (Build the D-PR3 ability side from incomingReductionEngine.test.ts.)
});
```

- [ ] **Step 2: Run, verify the enemy-mirror passes immediately** (the seam is already team-agnostic) **and the composition case asserts 0.50, not 0.56.**

Run: `npx vitest run src/utils/combat/__tests__/selfIncomingBuffFold.integration.test.ts`
Expected: PASS once the composition assertion is written to the additive 0.50 magnitude. If it was written expecting 0.56 (product), it correctly FAILS — fix the assertion to 0.50, the true engine behavior (`victimDamage.ts` combines all incoming terms into one `(1 + incoming/100)`).

- [ ] **Step 3: Commit**

```bash
git add src/utils/combat/__tests__/selfIncomingBuffFold.integration.test.ts
git commit -m "test(combat): D-PR12 — team-agnostic mirror + additive D-PR3 composition"
```

---

## Task 5: Golden-churn audit + changelog

The fold lights up real ship sources, so existing goldens may move where one of the five sources is a **victim while buffed**. Audit, don't blindly update.

**Files:**
- Possibly modify: golden/`.snap` fixtures under `src/**/__tests__/` (only after auditing)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

- [ ] **Step 1: Run the full suite and capture failures**

Run: `npx vitest run 2>&1 | tee /tmp/d-pr12-suite.txt`
Identify every failing golden/snapshot test.

- [ ] **Step 2: Audit each delta**

For each moved golden, confirm the delta is a **faithful incoming-damage reduction** (a victim that carries `Inc. Damage Down` now takes proportionally less direct damage; `Inc. Damage Up` more). Confirm the victim genuinely carries the buff at the moment of the hit. If any delta is NOT explained by friendly incoming folding, STOP — it's a bug, not churn; investigate before proceeding. Use `superpowers:systematic-debugging` if a delta is unexplained.

- [ ] **Step 3: Update only audited snapshots**

For confirmed-correct deltas, update the specific snapshot files (targeted, e.g. `npx vitest run <file> -u` for that file ONLY after auditing — never a blanket `-u`). Record in the commit body a one-line justification per moved fixture (which ship, which buff, expected ratio).

- [ ] **Step 4: Add the changelog entry** (`UNRELEASED_CHANGES` in `src/constants/changelog.ts`)

Plain-English, e.g.:
```
'Combat sim: ships that buff themselves or allies with "Incoming Damage Down" (Makoli, Salvation, Shelter, Refine) — and allies buffed by the Battlecry implant — now actually take reduced direct damage in the simulation.'
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(combat): D-PR12 — audited golden updates + changelog for friendly incoming fold

<one line per moved fixture: ship / buff / ratio>"
```

---

## Task 6: Final verification gate

- [ ] **Step 1: Full suite green**

Run: `npx vitest run`
Expected: all green (count = D-PR11 baseline + the new D-PR12 tests).

- [ ] **Step 2: Lint + types**

Run: `npm run lint && npx tsc --noEmit`
Expected: 0 errors / 0 warnings (ESLint is max-warnings 0).

- [ ] **Step 3: Skill audit unchanged**

Run: `npm run audit:skills`
Expected: 141 ships, 0 findings (this PR adds no skill-parser changes).

- [ ] **Step 4: Confirm no unintended drift**

Run: `git diff --stat e859a75a..HEAD`
Confirm only the files in the File-structure table (+ audited goldens) changed.

- [ ] **Step 5: Request code review**

Use `superpowers:requesting-code-review` for a holistic review (focus: team-agnosticism of the fold, additive D-PR3 composition correctness, golden-churn audit completeness, no enemy-side path regression).

---

## Done criteria

- Friendly-side incoming-DIRECT-damage fold live for all five sources, team-agnostic (player & enemy victims).
- Enemy-side incoming path unchanged (per-victim tap/defense tests still green).
- D-PR3 composition additive-within-one-factor (proven by test at the 0.50 magnitude).
- Every golden delta audited and justified; lint/tsc/`audit:skills` clean.
- Incoming-DoT explicitly out of scope (deferred per spec).
