# Autogear "Assume all gear is calibrated" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-ship autogear toggle that scores every calibration-eligible gear piece as if it were calibrated to the target ship, so gear competes on its ceiling instead of on its current calibration state.

**Architecture:** The whole feature is a transform at the page boundary. Calibration is applied in exactly two places in the scoring pipeline (`statsCalculator.ts` slow path, `fastScoring/gearRegistry.ts` fast path), and both derive their gear from data `AutogearPage` already owns — the `availableInventory` array and the `getGearPiece` function. A new pure module bakes the calibrated main stat into a copy of each eligible piece; the page maps its inventory and wraps its getter with it. No strategy, scoring, or `statsCalculator` changes.

**Tech Stack:** TypeScript, React 18, Vitest, TailwindCSS. Spec: `docs/superpowers/specs/2026-08-19-autogear-assume-calibrated-design.md`.

**Where this plan refines the spec** (both deliberate; this plan is authoritative):
`assumedCalibrationEligible` takes `allowSimulatedLevel` as a positional boolean rather than
an options object, and the results marker uses a new `assumedCalibration` prop rather than
reusing `showCalibratedPreview` (reasoning in Task 6).

## Global Constraints

- **No database migration.** `autogear_configs.config` is a JSONB blob; the new field is optional and absent reads as `false`.
- **No emoji in UI text.** Plain text plus a colour class. (Project convention.)
- **Use existing UI components** from `src/components/ui/` — `Checkbox` for the toggle, never a raw `<input>`.
- **Never edit** `isCalibrationEligible`, `getCalibratedMainStat`, `getBaseMainStat`, or `reverseCalibrationStatValue` behaviour. Existing callers must keep today's semantics exactly.
- **Changelog before commit:** any `feat:`/`fix:` commit for user-facing behaviour needs a plain-English entry in `UNRELEASED_CHANGES` in `src/constants/changelog.ts`.
- **Test command:** `npx vitest run <path>` (bare `npm test` starts watch mode).
- **The husky pre-commit hook runs the full Vitest suite.** Commits are slow; that is expected and is the project's gate. Do not use `--no-verify` on implementation commits.
- **Two similar names, both intentional — do not "unify" them:** `assumeCalibrated` is the
  config flag meaning *the mode is on*; `assumedCalibration` is the per-piece display prop
  meaning *this piece was scored on a calibration it does not have*. A piece already
  calibrated to the target ship sits under `assumeCalibrated: true` with
  `assumedCalibration: false`.
- **Config field name:** `assumeCalibrated` (exact spelling, used across 11 files).
- **UI label:** "Assume all gear is calibrated" (exact string).

---

### Task 1: Export an unchecked calibration-stat helper

The transform needs to calibrate a stat on a piece that is not *currently* eligible (a level-0 piece being scored at simulated level 16). Both public helpers short-circuit on `isCalibrationEligible`, so the private `calculateCalibratedStatValue` gets exported under a clearer name.

**Files:**
- Modify: `src/utils/gear/calibrationUtils.ts:70` (rename + export the private function), `:88` (its one existing caller)
- Test: `src/utils/gear/__tests__/calibrationUtils.test.ts` (append)

**Interfaces:**
- Consumes: nothing
- Produces: `applyCalibrationToStat(stat: Stat, stars: number): number` — returns the calibrated **value** for `stat` at `stars` stars, with no eligibility check.

- [ ] **Step 1: Write the failing test**

Append to `src/utils/gear/__tests__/calibrationUtils.test.ts`. Add `applyCalibrationToStat` to the existing import block at the top of the file:

```ts
// ---------------------------------------------------------------------------
// applyCalibrationToStat
// ---------------------------------------------------------------------------
describe('applyCalibrationToStat', () => {
    it('doubles flat attack', () => {
        const stat: Stat = { name: 'attack', value: 1000, type: 'flat' };
        expect(applyCalibrationToStat(stat, 6)).toBe(2000);
    });

    it('adds 7 percentage points to a percentage stat at 6 stars', () => {
        const stat: Stat = { name: 'attack', value: 30, type: 'percentage' };
        expect(applyCalibrationToStat(stat, 6)).toBe(37);
    });

    it('adds 5 percentage points to a percentage stat at 5 stars', () => {
        const stat: Stat = { name: 'attack', value: 30, type: 'percentage' };
        expect(applyCalibrationToStat(stat, 5)).toBe(35);
    });

    it('multiplies flat hp by 1.5 at 6 stars and 1.525 at 5 stars', () => {
        expect(applyCalibrationToStat({ name: 'hp', value: 5000, type: 'flat' }, 6)).toBe(7500);
        expect(applyCalibrationToStat({ name: 'hp', value: 4000, type: 'flat' }, 5)).toBe(6100);
    });

    it('adds a flat 5 to speed', () => {
        expect(applyCalibrationToStat({ name: 'speed', value: 20, type: 'flat' }, 6)).toBe(25);
    });

    it('does NOT check eligibility — it calibrates any stat it is handed', () => {
        // The caller decides eligibility. This is the whole point of the export:
        // the assumed-calibration path calibrates pieces that are not yet level 16.
        const stat: Stat = { name: 'attack', value: 500, type: 'flat' };
        expect(applyCalibrationToStat(stat, 6)).toBe(1000);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/utils/gear/__tests__/calibrationUtils.test.ts
```

Expected: FAIL — `applyCalibrationToStat is not exported by '../calibrationUtils'` (an import/collection error, not an assertion failure).

- [ ] **Step 3: Rename and export the function**

In `src/utils/gear/calibrationUtils.ts`, change the declaration at line ~70 from:

```ts
/**
 * Calculate the calibrated value for a stat.
 */
function calculateCalibratedStatValue(stat: Stat, stars: number): number {
```

to:

```ts
/**
 * Calculate the calibrated value for a stat.
 *
 * NOTE: performs NO eligibility check — it calibrates whatever stat it is handed.
 * The checked entry point is getCalibratedMainStat(). This unchecked form exists
 * for the autogear "assume all gear is calibrated" mode, which deliberately
 * calibrates pieces that are not eligible today (see assumedCalibration.ts).
 */
export function applyCalibrationToStat(stat: Stat, stars: number): number {
```

The function body is unchanged.

Then update its one existing caller, inside `getCalibratedMainStat` at line ~144:

```ts
    return {
        ...baseStat,
        value: applyCalibrationToStat(baseStat, gear.stars),
    };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/utils/gear/__tests__/calibrationUtils.test.ts
```

Expected: PASS, all tests in the file (the pre-existing `getCalibratedMainStat` tests must still pass — they exercise the renamed function through its checked wrapper).

- [ ] **Step 5: Verify no other caller broke**

```bash
grep -rn "calculateCalibratedStatValue" src/
npx tsc --noEmit
```

Expected: the grep prints nothing, and `tsc` reports no errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/gear/calibrationUtils.ts src/utils/gear/__tests__/calibrationUtils.test.ts
git commit -m "refactor(gear): export applyCalibrationToStat for unchecked calibration"
```

---

### Task 2: The assumed-calibration transform module

A pure module with no React and no page dependencies: the relaxed eligibility predicate, the per-piece transform, and a memoised getter wrapper.

**Files:**
- Create: `src/utils/gear/assumedCalibration.ts`
- Test: `src/utils/gear/__tests__/assumedCalibration.test.ts`

**Interfaces:**
- Consumes: `applyCalibrationToStat(stat, stars)` from Task 1
- Produces:
  - `assumedCalibrationEligible(gear: GearPiece, allowSimulatedLevel: boolean): boolean`
  - `withAssumedCalibration(gear: GearPiece, allowSimulatedLevel: boolean): GearPiece`
  - `makeAssumedCalibrationGetter(getGearPiece: (id: string) => GearPiece | undefined, allowSimulatedLevel: boolean): (id: string) => GearPiece | undefined`

- [ ] **Step 1: Write the failing test**

Create `src/utils/gear/__tests__/assumedCalibration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    assumedCalibrationEligible,
    withAssumedCalibration,
    makeAssumedCalibrationGetter,
} from '../assumedCalibration';
import { GearPiece } from '../../../types/gear';

/** Minimal gear piece; defaults are calibration-eligible today (level 16, 6 stars). */
function makeGear(overrides: Partial<GearPiece> = {}): GearPiece {
    return {
        id: 'gear-1',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [{ name: 'hp', value: 500, type: 'flat' }],
        setBonus: null,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// assumedCalibrationEligible
// ---------------------------------------------------------------------------
describe('assumedCalibrationEligible', () => {
    it('accepts level 16 6-star gear', () => {
        expect(assumedCalibrationEligible(makeGear(), false)).toBe(true);
    });

    it('accepts level 16 5-star gear', () => {
        expect(assumedCalibrationEligible(makeGear({ stars: 5 }), false)).toBe(true);
    });

    it('rejects gear below 5 stars', () => {
        expect(assumedCalibrationEligible(makeGear({ stars: 4 }), false)).toBe(false);
        expect(assumedCalibrationEligible(makeGear({ stars: 4 }), true)).toBe(false);
    });

    it('rejects implants in every slot', () => {
        expect(assumedCalibrationEligible(makeGear({ slot: 'implant_major' }), true)).toBe(false);
        expect(assumedCalibrationEligible(makeGear({ slot: 'implant_minor_1' }), true)).toBe(false);
        expect(assumedCalibrationEligible(makeGear({ slot: 'implant_ultimate' }), true)).toBe(false);
    });

    it('rejects sub-16 gear when simulated levels are NOT allowed', () => {
        expect(assumedCalibrationEligible(makeGear({ level: 0 }), false)).toBe(false);
        expect(assumedCalibrationEligible(makeGear({ level: 15 }), false)).toBe(false);
    });

    it('accepts sub-16 gear when simulated levels ARE allowed', () => {
        expect(assumedCalibrationEligible(makeGear({ level: 0 }), true)).toBe(true);
        expect(assumedCalibrationEligible(makeGear({ level: 15 }), true)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// withAssumedCalibration
// ---------------------------------------------------------------------------
describe('withAssumedCalibration', () => {
    it('bakes the calibrated value into the main stat', () => {
        const result = withAssumedCalibration(makeGear(), false);
        expect(result.mainStat).toEqual({ name: 'attack', value: 2000, type: 'flat' });
    });

    it('leaves sub-stats untouched', () => {
        const result = withAssumedCalibration(makeGear(), false);
        expect(result.subStats).toEqual([{ name: 'hp', value: 500, type: 'flat' }]);
    });

    it('does not mutate the input piece', () => {
        const gear = makeGear();
        withAssumedCalibration(gear, false);
        expect(gear.mainStat).toEqual({ name: 'attack', value: 1000, type: 'flat' });
    });

    it('preserves id, slot, set bonus and stars', () => {
        const gear = makeGear({ id: 'g-9', setBonus: 'DECIMATION', stars: 5 });
        const result = withAssumedCalibration(gear, false);
        expect(result.id).toBe('g-9');
        expect(result.slot).toBe('weapon');
        expect(result.setBonus).toBe('DECIMATION');
        expect(result.stars).toBe(5);
    });

    it('returns ineligible pieces unchanged (same reference)', () => {
        const implant = makeGear({ slot: 'implant_major' });
        expect(withAssumedCalibration(implant, true)).toBe(implant);

        const lowStar = makeGear({ stars: 4 });
        expect(withAssumedCalibration(lowStar, true)).toBe(lowStar);

        const unleveled = makeGear({ level: 0 });
        expect(withAssumedCalibration(unleveled, false)).toBe(unleveled);
    });

    it('returns a piece with no main stat unchanged (same reference)', () => {
        const noMain = makeGear({ mainStat: null });
        expect(withAssumedCalibration(noMain, false)).toBe(noMain);
    });

    it('calibrates sub-16 gear when simulated levels are allowed', () => {
        const result = withAssumedCalibration(makeGear({ level: 0 }), true);
        expect(result.mainStat).toEqual({ name: 'attack', value: 2000, type: 'flat' });
    });

    // The double-application guard. Downstream consumers (statsCalculator,
    // fastScoring/gearRegistry) apply the bonus themselves when
    // gear.calibration.shipId matches the ship being scored. Stripping the
    // metadata is what stops them applying it a SECOND time on top of ours.
    it('strips calibration metadata so downstream cannot apply the bonus again', () => {
        const gear = makeGear({ calibration: { shipId: 'ship-1' } });
        const result = withAssumedCalibration(gear, false);
        expect(result.calibration).toBeUndefined();
        expect(result.mainStat).toEqual({ name: 'attack', value: 2000, type: 'flat' });
    });

    it('gives a piece calibrated elsewhere the same value as an uncalibrated one', () => {
        const mine = withAssumedCalibration(makeGear({ calibration: { shipId: 'other' } }), false);
        const free = withAssumedCalibration(makeGear(), false);
        expect(mine.mainStat).toEqual(free.mainStat);
    });
});

// ---------------------------------------------------------------------------
// makeAssumedCalibrationGetter
// ---------------------------------------------------------------------------
describe('makeAssumedCalibrationGetter', () => {
    it('transforms whatever the wrapped getter returns', () => {
        const inner = (id: string) => (id === 'gear-1' ? makeGear() : undefined);
        const getter = makeAssumedCalibrationGetter(inner, false);
        expect(getter('gear-1')?.mainStat).toEqual({ name: 'attack', value: 2000, type: 'flat' });
    });

    it('passes undefined straight through for an unknown id', () => {
        const getter = makeAssumedCalibrationGetter(() => undefined, false);
        expect(getter('nope')).toBeUndefined();
    });

    // The getter is called once per gear per scored loadout in the slow path's
    // hot loop. Without memoisation it would allocate a fresh object every call.
    it('memoises: repeated calls return the identical object and hit the inner getter once', () => {
        let calls = 0;
        const inner = (_id: string) => {
            calls++;
            return makeGear();
        };
        const getter = makeAssumedCalibrationGetter(inner, false);
        const first = getter('gear-1');
        const second = getter('gear-1');
        expect(first).toBe(second);
        expect(calls).toBe(1);
    });

    it('composes over an upgraded-stats getter: calibrates the SIMULATED value', () => {
        // Mirrors AutogearPage's upgradedGearGetter, which swaps in the
        // simulated level-16 main stat for a sub-16 piece. The calibration
        // bonus must land on 1200 (the simulated value), not on 300.
        const raw = makeGear({ level: 0, mainStat: { name: 'attack', value: 300, type: 'flat' } });
        const upgraded = (_id: string): GearPiece => ({
            ...raw,
            mainStat: { name: 'attack', value: 1200, type: 'flat' },
        });
        const getter = makeAssumedCalibrationGetter(upgraded, true);
        expect(getter('gear-1')?.mainStat).toEqual({
            name: 'attack',
            value: 2400,
            type: 'flat',
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/utils/gear/__tests__/assumedCalibration.test.ts
```

Expected: FAIL — cannot resolve `../assumedCalibration`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/gear/assumedCalibration.ts`:

```ts
/**
 * "Assume all gear is calibrated" — the autogear mode that scores every
 * calibration-eligible piece as if it were calibrated to the ship being
 * optimized, so gear competes on its ceiling rather than on whichever ship
 * happens to hold its calibration today.
 *
 * Design note — BAKE, DON'T TAG. This module writes the calibrated value
 * straight into a copy of the piece's mainStat and strips the `calibration`
 * field, rather than tagging the piece with `calibration: { shipId }`.
 * Two reasons:
 *
 *   1. Both downstream consumers (statsCalculator.ts and
 *      fastScoring/gearRegistry.ts) gate on isCalibrationEligible(), which
 *      hard-requires level === 16. A tagged sub-16 piece under "Use upgraded
 *      stats" would silently receive no bonus.
 *   2. Stripping `calibration` prevents DOUBLE APPLICATION on a piece already
 *      calibrated to the target ship — it would otherwise get the bonus once
 *      from here and again from the consumer.
 *
 * See docs/superpowers/specs/2026-08-19-autogear-assume-calibrated-design.md
 */

import { GearPiece } from '../../types/gear';
import { applyCalibrationToStat } from './calibrationUtils';

/**
 * Relaxed calibration eligibility for the assumed-calibration mode.
 *
 * Real calibration additionally requires level 16 (see isCalibrationEligible).
 * When `allowSimulatedLevel` is true — i.e. the ship's "Use upgraded stats" is
 * on, so sub-16 gear is being scored at its simulated level-16 stats — the
 * level requirement is dropped, because such a piece WOULD be eligible once
 * upgraded. Both toggles then answer the same question: what is the ceiling if
 * I invest in this gear?
 */
export function assumedCalibrationEligible(gear: GearPiece, allowSimulatedLevel: boolean): boolean {
    return (
        !gear.slot.includes('implant') &&
        (gear.stars === 5 || gear.stars === 6) &&
        (gear.level === 16 || allowSimulatedLevel)
    );
}

/**
 * Return a copy of `gear` scored as if calibrated to the ship being optimized.
 * Ineligible pieces, and pieces with no main stat, are returned unchanged (by
 * reference) so callers can map an entire inventory cheaply.
 *
 * Sub-stats are never touched — calibration only affects the main stat.
 */
export function withAssumedCalibration(gear: GearPiece, allowSimulatedLevel: boolean): GearPiece {
    if (!gear.mainStat || !assumedCalibrationEligible(gear, allowSimulatedLevel)) {
        return gear;
    }
    return {
        ...gear,
        mainStat: {
            ...gear.mainStat,
            value: applyCalibrationToStat(gear.mainStat, gear.stars),
        },
        calibration: undefined,
    };
}

/**
 * Wrap a gear getter so every piece it returns is scored as if calibrated.
 *
 * Memoised: the slow scoring path calls the getter once per gear per scored
 * loadout, so an unmemoised wrapper would allocate a fresh object on every call
 * inside the optimizer's hot loop. The cache lives as long as the wrapper, i.e.
 * one autogear run for one ship.
 *
 * Compose this OUTSIDE any upgraded-stats getter — assumed(upgraded(get)) — so
 * the bonus applies to the simulated level-16 main stat rather than the level-0
 * one.
 */
export function makeAssumedCalibrationGetter(
    getGearPiece: (id: string) => GearPiece | undefined,
    allowSimulatedLevel: boolean
): (id: string) => GearPiece | undefined {
    const cache = new Map<string, GearPiece | undefined>();
    return (id: string) => {
        if (cache.has(id)) return cache.get(id);
        const piece = getGearPiece(id);
        const transformed = piece ? withAssumedCalibration(piece, allowSimulatedLevel) : undefined;
        cache.set(id, transformed);
        return transformed;
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/utils/gear/__tests__/assumedCalibration.test.ts
```

Expected: PASS, all tests.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit && npx eslint src/utils/gear/assumedCalibration.ts src/utils/gear/__tests__/assumedCalibration.test.ts
```

Expected: no output from either.

- [ ] **Step 6: Commit**

```bash
git add src/utils/gear/assumedCalibration.ts src/utils/gear/__tests__/assumedCalibration.test.ts
git commit -m "feat(gear): add assumed-calibration transform for autogear"
```

---

### Task 3: Fix the stale score cache

**This is a pre-existing bug, independent of the new feature.** `scoring.ts` holds a module-level `scoreCache` keyed by `ship.id | equipmentKey | implantsKey | role | bonuses | arena | fleetBuffs`. **The key does not describe the gear's stats.** Only `GeneticStrategy` calls `clearScoreCache()` (line 117); `TwoPassStrategy`, `SetFirstStrategy` and `BeamSearchStrategy` never do. So today, on those three strategies, changing gear stats underneath the optimizer — toggling "Use upgraded stats", or editing a gear piece — and re-running in the same session serves stale scores. The new toggle would land in the same trap.

**Files:**
- Modify: `src/pages/manager/AutogearPage.tsx:522` (start of the team run)
- Test: `src/utils/autogear/__tests__/scoring.test.ts` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: nothing later tasks import. Task 5 depends on this fix being in place.

- [ ] **Step 1: Write the failing test**

Append to `src/utils/autogear/__tests__/scoring.test.ts`. Extend the existing import from `'../scoring'` to also pull in `calculateTotalScore` and `clearScoreCache`, and add these imports at the top of the file:

```ts
import { makeTestShip } from '../fastScoring/__tests__/fixtures/testInventory';
import { GearPiece } from '../../../types/gear';
```

Then append:

```ts
// ---------------------------------------------------------------------------
// scoreCache invalidation
// ---------------------------------------------------------------------------
describe('clearScoreCache', () => {
    function makeWeapon(attack: number): GearPiece {
        return {
            id: 'w-1',
            slot: 'weapon',
            level: 16,
            stars: 6,
            rarity: 'legendary',
            mainStat: { name: 'attack', value: attack, type: 'flat' },
            subStats: [],
            setBonus: null,
        };
    }

    const ship = makeTestShip({ id: 'cache-ship' });
    const equipment = { weapon: 'w-1' } as const;
    const priorities: StatPriority[] = [{ stat: 'attack', weight: 1 }];
    const noEngineering = () => undefined;

    function score(attack: number): number {
        return calculateTotalScore(
            ship,
            equipment,
            priorities,
            () => makeWeapon(attack),
            noEngineering
        );
    }

    it('makes calculateTotalScore observe changed gear stats', () => {
        clearScoreCache();
        const low = score(1000);

        // Same ship, same equipment IDS — only the gear's stats changed. The
        // cache key does not describe stats, so without a clear this returns
        // the stale score.
        clearScoreCache();
        const high = score(9000);

        expect(high).toBeGreaterThan(low);
    });

    it('clears every cache that feeds the score, not just the score map', () => {
        // Guards the real failure mode: a cache added to this module that
        // clearScoreCache() forgets to clear. Two clears with different stats
        // either side must produce two different answers.
        clearScoreCache();
        const first = score(2000);
        clearScoreCache();
        const second = score(2000);
        clearScoreCache();
        const third = score(8000);

        expect(second).toBe(first);
        expect(third).not.toBe(first);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/utils/autogear/__tests__/scoring.test.ts
```

Expected: FAIL — `calculateTotalScore` and `clearScoreCache` are not in the existing import list, so the file fails to collect. (These tests characterise behaviour `clearScoreCache` already has; they exist to lock it in. They pass once the imports are added — that is fine and expected. The page-level fix is Step 3.)

- [ ] **Step 3: Call clearScoreCache at the start of a team run**

In `src/pages/manager/AutogearPage.tsx`, find this block at line ~522:

```ts
        const startTime = performance.now();
        // eslint-disable-next-line no-console
        console.log('Starting team optimization...');
```

Replace it with:

```ts
        // Drop memoised scores from any previous run. The scoreCache key
        // describes equipment IDS, not the gear's stats, so a run whose gear
        // stats differ from the last one ("Use upgraded stats", "Assume all
        // gear is calibrated", or a gear piece edited since) would otherwise
        // read stale scores. Only GeneticStrategy clears it itself; TwoPass,
        // SetFirst and BeamSearch do not. Clearing once per team run (not per
        // ship) keeps all within-run caching intact — the key already includes
        // ship.id, so cross-ship reuse was negligible.
        clearScoreCache();

        const startTime = performance.now();
        // eslint-disable-next-line no-console
        console.log('Starting team optimization...');
```

Add the import. Find the existing import of scoring helpers in `AutogearPage.tsx`; if none exists, add:

```ts
import { clearScoreCache } from '../../utils/autogear/scoring';
```

- [ ] **Step 4: Run tests and typecheck**

```bash
npx vitest run src/utils/autogear/__tests__/scoring.test.ts && npx tsc --noEmit
```

Expected: PASS, and no `tsc` output.

- [ ] **Step 5: Verify the call is actually reachable**

```bash
grep -n "clearScoreCache" src/pages/manager/AutogearPage.tsx
```

Expected: two lines — the import and the call inside the team-run handler. Confirm by reading the surrounding function that the call sits **before** the `for` loop over `validShips`, not inside it.

- [ ] **Step 6: Commit**

```bash
git add src/pages/manager/AutogearPage.tsx src/utils/autogear/__tests__/scoring.test.ts
git commit -m "fix(autogear): clear the score cache at the start of each run

The scoreCache key describes equipment IDs, not gear stats, and only
GeneticStrategy cleared it. Re-running TwoPass/SetFirst/BeamSearch after
changing gear stats (Use upgraded stats, or an edited piece) served stale
scores."
```

---

### Task 4: Config field and UI toggle

Adds the setting end to end so it persists and round-trips, but does not yet change scoring. Deliverable: the checkbox appears, toggles, saves, and reloads.

**Files:**
- Modify: `src/types/autogear.ts:48`
- Modify: `src/pages/manager/AutogearPage.tsx` — lines ~161, ~311, ~595, ~1490, ~1689, ~1718
- Modify: `src/components/autogear/AutogearSettings.tsx` — lines ~72, ~100, ~257, ~281, ~338, ~343, ~1075
- Modify: `src/components/autogear/AutogearSettingsModal.tsx` — lines ~25, ~53

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `shipConfig.assumeCalibrated: boolean` on the per-ship config object in `AutogearPage`, and `SavedAutogearConfig.assumeCalibrated?: boolean`. Task 5 and Task 6 read both.

- [ ] **Step 1: Add the persisted field**

In `src/types/autogear.ts`, in `SavedAutogearConfig`, directly after the `includeCalibratedGear` line:

```ts
    includeCalibratedGear?: boolean;
    /** Score every calibration-eligible piece as if calibrated to this ship. */
    assumeCalibrated?: boolean;
```

- [ ] **Step 2: Add it to the page's per-ship config state**

In `src/pages/manager/AutogearPage.tsx`, in the `shipConfigs` state type at line ~161, after `includeCalibratedGear: boolean;`:

```ts
                includeCalibratedGear: boolean;
                assumeCalibrated: boolean;
```

In the default config object at line ~311, after `includeCalibratedGear: false,`:

```ts
                includeCalibratedGear: false,
                assumeCalibrated: false,
```

In the saved-config object built before each run at line ~595, after `includeCalibratedGear: shipConfig.includeCalibratedGear,`:

```ts
                includeCalibratedGear: shipConfig.includeCalibratedGear,
                assumeCalibrated: shipConfig.assumeCalibrated,
```

In the reset-to-defaults object at line ~1718, after `includeCalibratedGear: false,`:

```ts
                                includeCalibratedGear: false,
                                assumeCalibrated: false,
```

Note: `applySavedConfigs` at line ~336 spreads the saved config wholesale, so loading needs no edit.

- [ ] **Step 3: Thread the prop through the settings modal**

In `src/components/autogear/AutogearSettingsModal.tsx`, in `AutogearSettingsModalProps`, after `includeCalibratedGear: boolean;` (line ~25):

```ts
    includeCalibratedGear: boolean;
    assumeCalibrated: boolean;
```

and after `onIncludeCalibratedGearChange: (value: boolean) => void;` (line ~53):

```ts
    onIncludeCalibratedGearChange: (value: boolean) => void;
    onAssumeCalibratedChange: (value: boolean) => void;
```

The component body spreads `...settingsProps` into `AutogearSettings`, so no other edit is needed here.

- [ ] **Step 4: Add the checkbox to the settings panel**

In `src/components/autogear/AutogearSettings.tsx`:

Props interface, after `includeCalibratedGear: boolean;` (line ~72):

```ts
    includeCalibratedGear: boolean;
    assumeCalibrated: boolean;
```

after `onIncludeCalibratedGearChange: (value: boolean) => void;` (line ~100):

```ts
    onIncludeCalibratedGearChange: (value: boolean) => void;
    onAssumeCalibratedChange: (value: boolean) => void;
```

Destructuring, after `includeCalibratedGear,` (line ~257):

```ts
    includeCalibratedGear,
    assumeCalibrated,
```

after `onIncludeCalibratedGearChange,` (line ~281):

```ts
    onIncludeCalibratedGearChange,
    onAssumeCalibratedChange,
```

The advanced-options counter at line ~334. Change:

```ts
        (includeCalibratedGear ? 1 : 0) +
        (activeSeason && useArenaModifiers ? 1 : 0);
    const advancedTotal = activeSeason ? 7 : 6;
```

to:

```ts
        (includeCalibratedGear ? 1 : 0) +
        (assumeCalibrated ? 1 : 0) +
        (activeSeason && useArenaModifiers ? 1 : 0);
    const advancedTotal = activeSeason ? 8 : 7;
```

The checkbox itself, directly after the `includeCalibratedGear` `<Checkbox>` at line ~1069:

```tsx
                            <Checkbox
                                id="assumeCalibrated"
                                label="Assume all gear is calibrated"
                                checked={assumeCalibrated}
                                onChange={onAssumeCalibratedChange}
                                helpLabel="When enabled, every calibration-eligible piece (5-6 star, level 16) is scored as if it were calibrated to this ship, so gear competes on its ceiling instead of on whichever ship holds its calibration today. Combine with 'Include calibrated gear' to also re-use gear currently calibrated to another ship. With 'Use upgraded stats' on, gear below level 16 is included too. Suggested pieces that need calibrating are marked in the results."
                            />
```

- [ ] **Step 5: Wire the page's prop and handler**

In `src/pages/manager/AutogearPage.tsx`, after the `includeCalibratedGear={...}` prop at line ~1490:

```tsx
                    includeCalibratedGear={
                        shipSettings ? getShipConfig(shipSettings.id).includeCalibratedGear : false
                    }
                    assumeCalibrated={
                        shipSettings ? getShipConfig(shipSettings.id).assumeCalibrated : false
                    }
```

and after the `onIncludeCalibratedGearChange` handler at line ~1689:

```tsx
                    onAssumeCalibratedChange={(assumeCalibrated) => {
                        if (shipSettings) {
                            updateShipConfig(shipSettings.id, { assumeCalibrated });
                        }
                    }}
```

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: no output from either. If `tsc` reports a missing prop, a plumbing site was skipped — the compiler is the checklist here, since every one of these props is required (not optional).

- [ ] **Step 7: Verify in the running app**

```bash
npm start
```

Open the Autogear page, select a ship, open its settings, expand "Advanced options". Confirm: the "Assume all gear is calibrated" checkbox is present below "Include calibrated gear"; the counter reads "0 of 7 enabled" with no active arena season (or "0 of 8" with one); ticking it increments the count; running autogear and reopening the settings shows it still ticked.

- [ ] **Step 8: Commit**

```bash
git add src/types/autogear.ts src/pages/manager/AutogearPage.tsx src/components/autogear/AutogearSettings.tsx src/components/autogear/AutogearSettingsModal.tsx
git commit -m "feat(autogear): add the assume-all-gear-calibrated setting"
```

---

### Task 5: Wire the mode into the optimizer

Makes the toggle actually change scoring, on both the fast and slow paths, and on both sides of the current-vs-suggested comparison.

**Files:**
- Modify: `src/pages/manager/AutogearPage.tsx` — the per-ship loop, lines ~695 (after `availableInventory`), ~704, ~711, ~717–723, ~779, ~789
- Test: `src/utils/autogear/fastScoring/__tests__/assumedCalibrationParity.test.ts` (create)

**Interfaces:**
- Consumes: `withAssumedCalibration`, `makeAssumedCalibrationGetter` (Task 2); `shipConfig.assumeCalibrated` (Task 4); the cache fix (Task 3)
- Produces: nothing later tasks import

- [ ] **Step 1: Write the failing parity test**

Create `src/utils/autogear/fastScoring/__tests__/assumedCalibrationParity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calculateTotalStats } from '../../../ship/statsCalculator';
import { buildGearRegistry } from '../gearRegistry';
import { STAT_INDEX, STAT_COUNT } from '../../../fastScoring/statVector';
import {
    withAssumedCalibration,
    makeAssumedCalibrationGetter,
} from '../../../gear/assumedCalibration';
import { TEST_BASE_STATS, makeTestShip } from './fixtures/testInventory';
import { GearPiece } from '../../../../types/gear';

function makeWeapon(overrides: Partial<GearPiece> = {}): GearPiece {
    return {
        id: 'w-1',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [],
        setBonus: null,
        ...overrides,
    };
}

const SHIP_ID = 'ship-1';
const ship = makeTestShip({ id: SHIP_ID, equipment: { weapon: 'w-1' } });

/** Attack contributed by gear alone, via the slow path. */
function slowPathAttack(piece: GearPiece): number {
    const stats = calculateTotalStats(
        ship.baseStats,
        { weapon: 'w-1' },
        () => piece,
        [],
        {},
        undefined,
        SHIP_ID
    );
    return stats.afterGear.attack - stats.afterEngineering.attack;
}

/** Attack contributed by gear alone, via the fast path's precomputed registry. */
function fastPathAttack(piece: GearPiece): number {
    const reg = buildGearRegistry([piece], TEST_BASE_STATS, SHIP_ID);
    return reg.statBuffer[reg.idOf.get(piece.id)! * STAT_COUNT + STAT_INDEX.attack];
}

describe('assumed calibration: fast/slow parity', () => {
    it('agree on an uncalibrated piece with the mode OFF', () => {
        const piece = makeWeapon();
        expect(fastPathAttack(piece)).toBe(slowPathAttack(piece));
        expect(slowPathAttack(piece)).toBe(1000);
    });

    it('agree on an uncalibrated piece with the mode ON', () => {
        const piece = withAssumedCalibration(makeWeapon(), false);
        expect(fastPathAttack(piece)).toBe(slowPathAttack(piece));
        expect(slowPathAttack(piece)).toBe(2000);
    });

    it('agree on a piece calibrated to THIS ship with the mode ON — no double bonus', () => {
        const piece = withAssumedCalibration(
            makeWeapon({ calibration: { shipId: SHIP_ID } }),
            false
        );
        expect(fastPathAttack(piece)).toBe(slowPathAttack(piece));
        // 2000, not 4000: the transform stripped the metadata so neither
        // consumer re-applies the bonus on top.
        expect(slowPathAttack(piece)).toBe(2000);
    });

    it('agree on a piece calibrated ELSEWHERE with the mode ON', () => {
        const piece = withAssumedCalibration(
            makeWeapon({ calibration: { shipId: 'some-other-ship' } }),
            false
        );
        expect(fastPathAttack(piece)).toBe(slowPathAttack(piece));
        expect(slowPathAttack(piece)).toBe(2000);
    });
});

describe('assumed calibration: mode OFF is a no-op', () => {
    it('leaves an uncalibrated piece at its base value', () => {
        expect(slowPathAttack(makeWeapon())).toBe(1000);
    });

    it('still applies the REAL bonus to a piece calibrated to this ship', () => {
        // The mode being off must not disturb existing calibration handling.
        expect(slowPathAttack(makeWeapon({ calibration: { shipId: SHIP_ID } }))).toBe(2000);
    });

    it('still ignores a piece calibrated to another ship', () => {
        expect(slowPathAttack(makeWeapon({ calibration: { shipId: 'other' } }))).toBe(1000);
    });
});

describe('assumed calibration: composition with upgraded stats', () => {
    it('calibrates the simulated level-16 value, not the level-0 one', () => {
        const raw = makeWeapon({
            id: 'w-2',
            level: 0,
            mainStat: { name: 'attack', value: 300, type: 'flat' },
        });
        const upgradedGetter = (_id: string): GearPiece => ({
            ...raw,
            mainStat: { name: 'attack', value: 1200, type: 'flat' },
        });
        const getter = makeAssumedCalibrationGetter(upgradedGetter, true);
        expect(getter('w-2')?.mainStat?.value).toBe(2400);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/utils/autogear/fastScoring/__tests__/assumedCalibrationParity.test.ts
```

Expected: PASS for the "mode OFF" cases and FAIL only if Task 2 was not completed. If every case passes, that is correct — this file characterises the transform's interaction with both scoring paths and is the regression net for Step 3. Read the output and confirm all four parity cases ran.

- [ ] **Step 3: Add the imports to the page**

In `src/pages/manager/AutogearPage.tsx`, add:

```ts
import {
    withAssumedCalibration,
    makeAssumedCalibrationGetter,
} from '../../utils/gear/assumedCalibration';
```

- [ ] **Step 4: Transform the inventory**

Find the end of the `availableInventory` chain at line ~695 — it ends with:

```ts
                    return !shipConfig.ignoreUnleveled || gear.level > 0;
                });
```

Immediately after that closing `});`, insert:

```ts
            // "Assume all gear is calibrated": score every calibration-eligible
            // piece as if calibrated to this ship. This array feeds the fast
            // path's gear registry; the getter below feeds the slow path.
            const scoredInventory = shipConfig.assumeCalibrated
                ? availableInventory.map((gear) =>
                      withAssumedCalibration(gear, shipConfig.useUpgradedStats)
                  )
                : availableInventory;
```

Then in the implant pre-filter block immediately below (line ~704), replace both references to `availableInventory` with `scoredInventory`:

```ts
            const filteredInventory = shipConfig.optimizeImplants
                ? filterTopImplantsPerSlot(
                      scoredInventory,
                      shipConfig.statPriorities,
                      equippedImplantIds,
                      shipConfig.statBonuses
                  )
                : scoredInventory;
```

- [ ] **Step 5: Wrap the gear getter**

Replace the `getGearForShip` block at lines ~717–723:

```ts
            // Gear getter for this ship.
            // Stored mainStat values are always BASE (uncalibrated) — the import
            // pipeline normalises calibrated gear at import time.
            // calculateTotalStats applies the calibration bonus only when
            // gear.calibration.shipId === the target ship's id, so no reversal
            // is needed here.
            const getGearForShip = shipConfig.useUpgradedStats ? upgradedGearGetter : getGearPiece;
```

with:

```ts
            // Gear getter for this ship.
            // Stored mainStat values are always BASE (uncalibrated) — the import
            // pipeline normalises calibrated gear at import time.
            // calculateTotalStats applies the calibration bonus only when
            // gear.calibration.shipId === the target ship's id, so no reversal
            // is needed here.
            const baseGearGetter = shipConfig.useUpgradedStats ? upgradedGearGetter : getGearPiece;
            // Assumed calibration wraps OUTSIDE the upgraded-stats getter, so
            // the bonus lands on the simulated level-16 main stat rather than
            // the level-0 one.
            const getGearForShip = shipConfig.assumeCalibrated
                ? makeAssumedCalibrationGetter(baseGearGetter, shipConfig.useUpgradedStats)
                : baseGearGetter;
```

- [ ] **Step 6: Use the same getter for both sides of the comparison**

The assumption must apply to the current baseline too, so the reported delta is purely the gear-swap gain rather than gear-swap plus a calibration you could have done anyway.

In the `currentStats` call at line ~779, replace:

```ts
                shipConfig.useUpgradedStats ? upgradedGearGetter : getGearPiece,
```

with:

```ts
                getGearForShip,
```

Do the same in the `suggestedStats` call at line ~789. After the edit both calls read `getGearForShip`.

- [ ] **Step 7: Verify no stale references remain**

```bash
grep -n "availableInventory\|upgradedGearGetter\|getGearForShip" src/pages/manager/AutogearPage.tsx
```

Expected: `availableInventory` appears only in its own declaration and in the `scoredInventory` map. `upgradedGearGetter` appears only in its declaration/assignment and in `baseGearGetter`. Every consumer inside the per-ship loop reads `scoredInventory` or `getGearForShip`.

- [ ] **Step 8: Run the full suite and typecheck**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: `tsc` silent; the suite green. If `.tsx` files fail to collect with "supabaseUrl is required", the worktree is missing `.env` — copy it from the main repo.

- [ ] **Step 9: Verify in the running app**

```bash
npm start
```

Pick a ship with at least one uncalibrated 5–6★ level-16 piece in inventory. Run autogear with the toggle **off** and note the suggestions and total stats. Turn the toggle **on** and re-run. Expect the suggested main stats to be higher, and expect pieces to change where a stronger uncalibrated piece was previously losing to a calibrated one. Then toggle back **off** and re-run: the original result must return — this is the check that Task 3's cache fix is working.

- [ ] **Step 10: Commit**

```bash
git add src/pages/manager/AutogearPage.tsx src/utils/autogear/fastScoring/__tests__/assumedCalibrationParity.test.ts
git commit -m "feat(autogear): score gear as if calibrated when the mode is on"
```

---

### Task 6: Mark assumed-calibration pieces in the results

The optimizer now scores with bonuses the user has not paid for. The results must show the same numbers the optimizer used, and say plainly which pieces need calibrating.

**Deviation from the spec, deliberate:** the spec proposed reusing the existing `showCalibratedPreview` prop. Use a **new** `assumedCalibration` prop instead. `showCalibratedPreview` is entangled with the `isCalibrationActive && !showCalibratedPreview` branches at `GearPieceDisplay.tsx:317–330`, which control how a *really* calibrated piece renders its before/after values; reusing it would change that rendering as a side effect. A separate prop leaves `CalibrationModal`'s behaviour untouched.

**Also fixes a latent bug:** `GearPieceDisplay`'s custom `memo` comparator (line ~455) does not compare `showCalibratedPreview`. Any prop that only changes the displayed stat is invisible to it, so the card would not re-render when the mode is toggled. Both props go into the comparator.

**Files:**
- Modify: `src/components/gear/GearPieceDisplay.tsx` — props (~32), destructuring (~54), `displayMainStat` memo (~113), main-stat render (~313), marker render, memo comparator (~480)
- Modify: `src/components/autogear/GearSuggestions.tsx` — props (~28), destructuring (~46), the two `GearPieceDisplay`/`GearSlot` render sites (~125, ~146)
- Modify: `src/components/gear/GearSlot.tsx` — props (~19), destructuring (~32), pass-through (~103)
- Modify: `src/pages/manager/AutogearPage.tsx:1236` (pass the flag to `GearSuggestions`)

**Interfaces:**
- Consumes: `assumedCalibrationEligible`, `applyCalibrationToStat` (Tasks 1–2); `shipConfig.assumeCalibrated` (Task 4)
- Produces: nothing later tasks import

- [ ] **Step 1: Add the prop to GearPieceDisplay**

In `src/components/gear/GearPieceDisplay.tsx`, in the `Props` interface after `showCalibratedPreview`:

```ts
    /** Show calibrated main stat value even if not actively calibrated */
    showCalibratedPreview?: boolean;
    /** Autogear's "assume all gear is calibrated" mode scored this piece as if
     *  calibrated to the suggested ship, though it is not. Renders the
     *  calibrated main stat plus a marker saying calibration is required. */
    assumedCalibration?: boolean;
```

and in the destructuring after `showCalibratedPreview = false,`:

```ts
        showCalibratedPreview = false,
        assumedCalibration = false,
```

Add the imports:

```ts
import { assumedCalibrationEligible } from '../../utils/gear/assumedCalibration';
import { applyCalibrationToStat } from '../../utils/gear/calibrationUtils';
```

- [ ] **Step 2: Show the calibrated value**

Replace the `displayMainStat` memo at line ~112:

```ts
        // Get the main stat to display - use calibrated if calibration is active or preview requested
        const displayMainStat = useMemo(() => {
            if (!gear.mainStat) return null;
            if ((isCalibrationActive || showCalibratedPreview) && isCalibrationEligible(gear)) {
                return getCalibratedMainStat(gear);
            }
            return gear.mainStat;
        }, [gear, isCalibrationActive, showCalibratedPreview]);
```

with:

```ts
        // Get the main stat to display - use calibrated if calibration is active or preview requested
        const displayMainStat = useMemo(() => {
            if (!gear.mainStat) return null;
            // Autogear's assumed-calibration mode: show what the optimizer
            // scored. Uses the relaxed predicate so a sub-16 piece under "Use
            // upgraded stats" previews too — isCalibrationEligible would reject it.
            if (assumedCalibration && assumedCalibrationEligible(gear, true)) {
                return {
                    ...gear.mainStat,
                    value: applyCalibrationToStat(gear.mainStat, gear.stars),
                };
            }
            if ((isCalibrationActive || showCalibratedPreview) && isCalibrationEligible(gear)) {
                return getCalibratedMainStat(gear);
            }
            return gear.mainStat;
        }, [gear, isCalibrationActive, showCalibratedPreview, assumedCalibration]);
```

Then, in the main-stat `StatDisplay` at line ~313, the `isCalibrationActive && !showCalibratedPreview` branch would show the raw `gear.mainStat` as the headline for a piece calibrated to this ship. Under assumed calibration that contradicts the value the optimizer used, so short-circuit it. Change:

```tsx
                                        stats={
                                            isCalibrationActive && !showCalibratedPreview
                                                ? [gear.mainStat as Stat]
                                                : [displayMainStat as Stat]
                                        }
```

to:

```tsx
                                        stats={
                                            isCalibrationActive &&
                                            !showCalibratedPreview &&
                                            !assumedCalibration
                                                ? [gear.mainStat as Stat]
                                                : [displayMainStat as Stat]
                                        }
```

and the `upgradedStats` prop immediately below it, from:

```tsx
                                        upgradedStats={
                                            isCalibrationActive &&
                                            !showCalibratedPreview &&
                                            displayMainStat
                                                ? [displayMainStat]
                                                : upgrade?.mainStat &&
                                                    !isMaxLevel &&
                                                    !showCalibratedPreview
                                                  ? [upgrade.mainStat as Stat]
                                                  : undefined
                                        }
```

to:

```tsx
                                        upgradedStats={
                                            isCalibrationActive &&
                                            !showCalibratedPreview &&
                                            !assumedCalibration &&
                                            displayMainStat
                                                ? [displayMainStat]
                                                : upgrade?.mainStat &&
                                                    !isMaxLevel &&
                                                    !showCalibratedPreview &&
                                                    !assumedCalibration
                                                  ? [upgrade.mainStat as Stat]
                                                  : undefined
                                        }
```

- [ ] **Step 3: Render the marker**

Directly after the closing `</div>` of the Main Stat block (the block that ends just before the `{/* Implant Description */}` comment at line ~335), insert:

```tsx
                        {assumedCalibration && !isCalibrationActive && (
                            <div className="text-xs text-amber-400">Requires calibration</div>
                        )}
```

The `!isCalibrationActive` guard keeps the marker off a piece already calibrated to this ship — that one needs nothing.

- [ ] **Step 4: Fix the memo comparator**

In the comparator at line ~455, extend the first block. Change:

```ts
        if (
            prevProps.gear.id !== nextProps.gear.id ||
            prevProps.mode !== nextProps.mode ||
            prevProps.showDetails !== nextProps.showDetails
        ) {
            return false;
        }
```

to:

```ts
        if (
            prevProps.gear.id !== nextProps.gear.id ||
            prevProps.mode !== nextProps.mode ||
            prevProps.showDetails !== nextProps.showDetails ||
            // Both change the displayed main stat without changing the gear
            // object, so the card must re-render when either flips.
            prevProps.showCalibratedPreview !== nextProps.showCalibratedPreview ||
            prevProps.assumedCalibration !== nextProps.assumedCalibration
        ) {
            return false;
        }
```

- [ ] **Step 5: Thread the flag through GearSlot**

In `src/components/gear/GearSlot.tsx`, add to the props interface after `suggestedForShipId?: string;`:

```ts
    suggestedForShipId?: string;
    assumedCalibration?: boolean;
```

to the destructuring after `suggestedForShipId,`:

```ts
        suggestedForShipId,
        assumedCalibration,
```

and to the `GearPieceDisplay` render at line ~103, after `suggestedForShipId={suggestedForShipId}`:

```tsx
                            suggestedForShipId={suggestedForShipId}
                            assumedCalibration={assumedCalibration}
```

- [ ] **Step 6: Thread it through GearSuggestions**

In `src/components/autogear/GearSuggestions.tsx`, add to `GearSuggestionsProps` after `useUpgradedStats: boolean;`:

```ts
    useUpgradedStats: boolean;
    /** Autogear's "assume all gear is calibrated" mode was on for this run. */
    assumeCalibrated?: boolean;
```

to the destructuring after `useUpgradedStats,`:

```ts
    useUpgradedStats,
    assumeCalibrated = false,
```

Add the import:

```ts
import { assumedCalibrationEligible } from '../../utils/gear/assumedCalibration';
```

Add this helper inside the component, next to `getSuggestionForSlot`:

```ts
    /** True when this piece was scored on a calibration it does not yet have. */
    const isAssumedCalibration = (gear: GearPiece | undefined) =>
        !!gear &&
        assumeCalibrated &&
        assumedCalibrationEligible(gear, useUpgradedStats) &&
        gear.calibration?.shipId !== ship?.id;
```

At the collapsed `GearSlot` render (line ~118), the gear is computed inline. Hoist it so the helper can see it. Change:

```tsx
                                const suggestion = getSuggestionForSlot(slotName);
                                return (
                                    <div
                                        key={slotName}
                                        className="flex items-center justify-center"
                                    >
                                        <GearSlot
                                            slotKey={slotName}
                                            gear={
                                                suggestion
                                                    ? getGearPiece(suggestion.gearId)
                                                    : undefined
                                            }
```

to:

```tsx
                                const suggestion = getSuggestionForSlot(slotName);
                                const slotGear = suggestion
                                    ? getGearPiece(suggestion.gearId)
                                    : undefined;
                                return (
                                    <div
                                        key={slotName}
                                        className="flex items-center justify-center"
                                    >
                                        <GearSlot
                                            slotKey={slotName}
                                            gear={slotGear}
                                            assumedCalibration={isAssumedCalibration(slotGear)}
```

At the expanded `GearPieceDisplay` render (line ~146), after `suggestedForShipId={ship?.id}`:

```tsx
                                            suggestedForShipId={ship?.id}
                                            assumedCalibration={isAssumedCalibration(gear)}
```

- [ ] **Step 7: Pass the config from the page**

In `src/pages/manager/AutogearPage.tsx`, in the `<GearSuggestions>` render at line ~1236, after `useUpgradedStats={shipConfig.useUpgradedStats}`:

```tsx
                                                    useUpgradedStats={shipConfig.useUpgradedStats}
                                                    assumeCalibrated={shipConfig.assumeCalibrated}
```

- [ ] **Step 8: Typecheck, lint and run the suite**

```bash
npx tsc --noEmit && npm run lint && npx vitest run
```

Expected: all three clean.

- [ ] **Step 9: Verify in the running app**

```bash
npm start
```

Run autogear with the toggle on for a ship whose best pieces are uncalibrated. Confirm on the suggestion cards: uncalibrated eligible pieces show the boosted main stat and a "Requires calibration" line; a piece already calibrated to that ship shows its boosted stat with **no** marker; implants and 4★ pieces show neither. Then turn the toggle off, re-run, and confirm every marker is gone and the main stats drop back — this exercises the memo-comparator fix.

- [ ] **Step 10: Commit**

```bash
git add src/components/gear/GearPieceDisplay.tsx src/components/gear/GearSlot.tsx src/components/autogear/GearSuggestions.tsx src/pages/manager/AutogearPage.tsx
git commit -m "feat(autogear): mark suggestions that rely on an assumed calibration

Also adds showCalibratedPreview and assumedCalibration to GearPieceDisplay's
memo comparator — neither changes the gear object, so the card would not
re-render when they flip."
```

---

### Task 7: Changelog, in-app docs, tutorial copy

**Files:**
- Modify: `src/constants/changelog.ts:8` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx:1428` (the "Equipment Constraints" card)
- Modify: `src/constants/tutorialSteps.ts:116`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Add the changelog entries**

In `src/constants/changelog.ts`, add these two strings at the **top** of the `UNRELEASED_CHANGES` array (immediately after the opening `[`):

```ts
    'Autogear: a new "Assume all gear is calibrated" option scores every calibration-eligible piece (5-6 star, level 16) as if it were calibrated to the ship you are gearing. Calibration boosts a piece\'s main stat substantially, so previously an already-calibrated piece would beat a better uncalibrated one on a bonus the challenger could equally have had — the optimizer kept recommending whatever you had already calibrated and never showed you the piece worth moving the calibration to. Turn it on to see the real ceiling. Combine it with "Include calibrated gear" to also re-use gear currently calibrated to another ship, and with "Use upgraded stats" to include gear you have not levelled to 16 yet. The current-gear side of the comparison gets the same treatment, so the difference you see is the gain from swapping gear rather than from calibrating what you already wear. Suggested pieces that would need calibrating are marked "Requires calibration" — the mode can recommend more calibrations than you can actually afford.',
    'Autogear: re-running the optimizer after changing what gear is worth no longer reuses the previous run\'s scores. Toggling "Use upgraded stats", or editing a gear piece and running again, could leave the Two-Pass, Set First and Beam Search algorithms scoring against the stale values from the run before. The Genetic algorithm was unaffected.',
```

- [ ] **Step 2: Document the settings**

In `src/pages/DocumentationPage.tsx`, in the "Equipment Constraints" `<ul>`, after the "Use upgraded stats" `<li>` (line ~1447) and before the "Optimize implants" `<li>`, insert:

```tsx
                                        <li>
                                            <strong>Include calibrated gear:</strong> When enabled,
                                            gear calibrated to other ships is included in the
                                            search. On its own it scores that gear at its base stats
                                            — without the calibration bonus, which belongs to the
                                            other ship.
                                        </li>
                                        <li>
                                            <strong>Assume all gear is calibrated:</strong> When
                                            enabled, every calibration-eligible piece (5-6 star,
                                            level 16) is scored as if it were calibrated to this
                                            ship. Without it, an already-calibrated piece competes
                                            against uncalibrated gear while holding a bonus that
                                            gear could equally have, so the optimizer keeps
                                            recommending whatever you calibrated first. The two
                                            calibration options are independent: &quot;Include
                                            calibrated gear&quot; decides what is available, this
                                            one decides how it is scored — with both on, gear
                                            calibrated elsewhere is included and gets the bonus too.
                                            With &quot;Use upgraded stats&quot; on, gear below level
                                            16 is included as well, since it would be eligible once
                                            upgraded. Your ship&apos;s current gear is scored the
                                            same way, so the before/after difference is the gain
                                            from swapping gear rather than from calibrating what you
                                            already wear. Suggested pieces needing calibration are
                                            marked; calibration is a limited resource, so check that
                                            the result is one you can actually afford.
                                        </li>
```

- [ ] **Step 3: Update the tutorial copy**

In `src/constants/tutorialSteps.ts`, replace the description at line ~116:

```ts
            description:
                'Filters that change which gear is available to the optimizer (ignore equipped, ignore unleveled, use upgraded stats, complete sets, optimize implants, include calibrated). Click to expand.',
```

with:

```ts
            description:
                'Filters that change which gear is available to the optimizer, and how it is scored (ignore equipped, ignore unleveled, use upgraded stats, complete sets, optimize implants, include calibrated, assume all gear is calibrated). Click to expand.',
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npm run lint && npm run format:check
```

Expected: all clean. If `format:check` complains, run `npm run format` and re-check.

- [ ] **Step 5: Check the docs render**

```bash
npm start
```

Open the Documentation page, find the Autogear section's "Equipment Constraints" card, and confirm both new bullets read correctly and no apostrophe renders as a raw `'` (the codebase escapes them as `&apos;`/`&quot;`).

- [ ] **Step 6: Commit**

```bash
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx src/constants/tutorialSteps.ts
git commit -m "docs(autogear): document the assume-all-gear-calibrated setting"
```

---

## Final Verification

- [ ] **Full suite green**

```bash
npx vitest run
```

Expected: no failures. `.tsx` collection errors mentioning `supabaseUrl is required` mean the worktree lost its `.env`; copy it from the main repo rather than editing config.

- [ ] **Typecheck, lint, format**

```bash
npx tsc --noEmit && npm run lint && npm run format:check
```

- [ ] **Review the whole diff**

```bash
git diff origin/main --stat
```

Expected files: `src/types/autogear.ts`, `src/utils/gear/calibrationUtils.ts`, `src/utils/gear/assumedCalibration.ts`, `src/utils/gear/__tests__/{calibrationUtils,assumedCalibration}.test.ts`, `src/utils/autogear/__tests__/scoring.test.ts`, `src/utils/autogear/fastScoring/__tests__/assumedCalibrationParity.test.ts`, `src/pages/manager/AutogearPage.tsx`, `src/pages/DocumentationPage.tsx`, `src/components/autogear/{AutogearSettings,AutogearSettingsModal,GearSuggestions}.tsx`, `src/components/gear/{GearPieceDisplay,GearSlot}.tsx`, `src/constants/{changelog,tutorialSteps}.ts`, and the spec plus this plan.

No migration file should appear. No file under `src/utils/autogear/strategies/`, `src/utils/autogear/scoring.ts`, `src/utils/ship/statsCalculator.ts` or `src/utils/autogear/fastScoring/gearRegistry.ts` should appear — if one does, the transform leaked out of the page boundary and the approach needs re-checking.

- [ ] **Confirm the two toggles are independent**

In the running app, for one ship, check all four combinations of "Include calibrated gear" × "Assume all gear is calibrated":

| Include | Assume | Expected |
|---|---|---|
| off | off | today's behaviour |
| on | off | other-ship gear appears, scored at base stats |
| off | on | other-ship gear still excluded; own/free gear scored with the bonus |
| on | on | other-ship gear appears **and** carries the bonus |
