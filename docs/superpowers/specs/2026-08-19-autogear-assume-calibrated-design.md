# Autogear: "Assume all gear is calibrated" — Design

**Date:** 2026-08-19
**Branch:** `feat/autogear-assume-calibrated`
**Status:** Approved design, ready for implementation planning

## Problem

Calibration gives a gear piece a substantial main-stat bonus (attack flat doubles; hp flat ×1.5;
percentage stats gain +5pp at 5★ / +7pp at 6★). Today the autogear optimizer only applies that bonus
to pieces already calibrated to the target ship.

The consequence: an already-calibrated piece scores with its bonus while an equally-good-or-better
uncalibrated piece scores without one. The calibrated piece wins on a bonus the challenger could
also have. Calibration is therefore a *lock-in* — the optimizer keeps recommending what you already
calibrated, and never surfaces the piece that would be better if you moved the calibration to it.

## Goal

A per-ship autogear toggle that scores every calibration-eligible piece **as if it were calibrated
to the target ship**, so gear competes on its ceiling rather than on its current calibration state.

## Decisions

These were settled during brainstorming and are not open for re-litigation during implementation.

### D1 — Relationship to "Include calibrated gear"

The two toggles are orthogonal:

| Toggle | Controls |
|---|---|
| `includeCalibratedGear` (existing) | **Availability** — whether gear calibrated to *another* ship may be considered at all |
| `assumeCalibrated` (new) | **Stats** — whether eligible gear is scored with the calibration bonus |

With **both** on, gear currently calibrated to another ship is included **and** receives the bonus,
because re-calibrating it to this ship is possible in-game.

With `assumeCalibrated` on but `includeCalibratedGear` off, other-ship gear remains excluded. The
existing filter at `AutogearPage.tsx:653` is untouched.

### D2 — Eligibility

Real calibration requires level 16, 5–6★, non-implant (`isCalibrationEligible`).

The mode uses a **relaxed** predicate: a piece qualifies if it is 5–6★ and non-implant **and**
(level 16 **or** the ship's `useUpgradedStats` is on).

Rationale: "Use upgraded stats" already scores sub-16 gear at its *simulated* level-16 stats. A
piece so simulated would be calibration-eligible in reality, so refusing it the calibration bonus
produces a half-state where the tool simulates the upgrade but not the calibration that upgrade
unlocks. Both toggles answer the same question — "what is the ceiling if I invest in this gear?"

### D3 — Results display

Results show the **hypothetical**: suggested stats include the assumed bonuses, so the displayed
numbers match the score the optimizer actually used. Pieces relying on an assumed calibration are
visibly marked so the user knows what to go calibrate.

Rejected: showing real (un-assumed) stats. That would make the displayed suggestion contradict the
optimizer's own choice, and a correctly-chosen piece could read as a downgrade.

### D4 — The "current" baseline

The assumption applies to **both** sides of the current-vs-suggested comparison. The ship's
currently-equipped uncalibrated eligible gear is also scored as calibrated.

Rationale: calibrating gear you already wear is available without re-gearing, so counting it as a
gain from the swap would overstate the swap. Applying to both sides makes the delta purely the
gear-swap gain. This also falls out of the implementation for free (a single getter swap).

### D5 — Out of scope

The mode can recommend a loadout the user cannot actually field, since calibration is a limited
in-game resource. The Section-D3 marker is the mitigation. A calibration-budget constraint
(">= N calibrations required, you have M") is a separate feature and is **not** part of this work.

## Design

### Data model

New optional field on `SavedAutogearConfig` (`src/types/autogear.ts`):

```ts
assumeCalibrated?: boolean;   // default false
```

`autogear_configs.config` is a JSONB blob, so **no database migration is required**. Absent field
reads as `false`, so existing saved configs are unaffected.

### Mechanism: one gear-getter wrapper, zero strategy changes

Calibration is applied in exactly two places in the scoring pipeline:

- `src/utils/ship/statsCalculator.ts:67` — slow path
- `src/utils/autogear/fastScoring/gearRegistry.ts:98` — fast path

Both derive their gear from data `AutogearPage` already controls: the `availableInventory` array
(which feeds `buildFastScoringContext` → `buildGearRegistry`) and the `getGearPiece` function
(which feeds `calculateTotalStats` and equipped-implant resolution).

Therefore the entire feature is a **transform at the page boundary**. No strategy, scoring, or
`statsCalculator` code changes. This mirrors the existing `upgradedGearGetter` precedent at
`AutogearPage.tsx:514`.

#### Bake, don't tag

New module `src/utils/gear/assumedCalibration.ts`:

```ts
assumedCalibrationEligible(gear: GearPiece, allowSimulatedLevel: boolean): boolean
    !gear.slot.includes('implant')
    && (gear.stars === 5 || gear.stars === 6)
    && (gear.level === 16 || allowSimulatedLevel)

withAssumedCalibration(piece, allowSimulatedLevel): GearPiece
    eligible && piece.mainStat
        ? { ...piece, mainStat: applyCalibrationToStat(piece.mainStat, piece.stars),
                      calibration: undefined }
        : piece
```

The transform **bakes** the calibrated value into `mainStat` rather than tagging the piece with
`calibration: { shipId }`. Two reasons:

1. Both consumers gate on `isCalibrationEligible()`, which hard-requires `level === 16`. A tagged
   level-0 piece under "Use upgraded stats" would silently receive no bonus — exactly the half-state
   D2 rules out.
2. Stripping `calibration` prevents **double application** on gear already calibrated to the target
   ship, which would otherwise get the bonus once from the transform and again from the consumer.

`getCalibratedMainStat()` also short-circuits on `isCalibrationEligible`, so the currently-private
`calculateCalibratedStatValue` in `src/utils/gear/calibrationUtils.ts` is exported as
`applyCalibrationToStat` for the unchecked path. The existing checked helpers
(`isCalibrationEligible`, `getCalibratedMainStat`, `reverseCalibrationStatValue`) are unchanged, so
every existing caller keeps today's behaviour.

Sub-stats are never touched — calibration only affects the main stat.

#### Composition with "Use upgraded stats"

Order matters. `upgradedGearGetter` replaces `mainStat` with the simulated level-16 stat; the
calibration bonus must then apply to *that* value, not the level-0 one. The wrappers compose as:

```
assumed(upgraded(getGearPiece))
```

#### Application points in `AutogearPage.tsx`

When `shipConfig.assumeCalibrated` is on for the ship being optimized:

- `availableInventory` is mapped through `withAssumedCalibration` (feeds the fast path's registry)
- `getGearForShip` is wrapped (feeds the slow path and equipped-implant resolution)
- `currentStats` and `suggestedStats` both use the wrapped getter — this is D4, obtained for free

`allowSimulatedLevel` is that same ship's `shipConfig.useUpgradedStats`.

### Cache invalidation

`src/utils/autogear/scoring.ts:52` holds a module-level `scoreCache` keyed by

```
ship.id | equipmentKey | implantsKey | role | bonuses | arena | fleetBuffs
```

**The key does not describe the gear's stats.** The same equipment set scored under assumed
calibration and under real calibration therefore collides. `clearScoreCache()` is called only by
`GeneticStrategy` (line 117); `TwoPassStrategy`, `SetFirstStrategy` and `BeamSearchStrategy` never
call it. Toggling the flag and re-running in the same session would serve stale scores.

This is a **pre-existing bug**, not one this feature introduces: the cache can already serve stale
scores today on `TwoPass`/`SetFirst`/`BeamSearch` whenever gear stats change underneath it in the
same session — toggling "Use upgraded stats", or editing a gear piece and re-running.

**Fix (in scope for this work, deliberately not split out):** call `clearScoreCache()` once at the
start of a team autogear run in `AutogearPage`. Per-run (not per-ship) preserves all within-run
caching; the key already includes `ship.id`, so cross-ship reuse was negligible. This closes both
the new flag's collision and the existing hole.

Two neighbouring caches were checked and are **not** hazards:

- `FastCache` in `fastScoring/context.ts:130` — constructed fresh per `buildFastScoringContext`.
- `gearStatsCache` in `statsCalculator.ts:15` — declared and cleared but never read or written.
  It is dead code. Do not build on it.

### Results display

The results view keeps passing the **real** `getGearPiece`, so gear cards show true inventory data.
The hypothetical is surfaced through a new dedicated `assumedCalibration` prop on `GearPieceDisplay`,
not the existing `showCalibratedPreview`: `showCalibratedPreview` is entangled with the
`isCalibrationActive && !showCalibratedPreview` render branches that govern how genuinely-calibrated
gear displays, and it is shared with `CalibrationModal`. Piggybacking the assumed-calibration case
onto it risked changing that unrelated real-calibration rendering. The new prop:

- `assumedCalibration` makes the card render the calibrated main stat, matching the number the
  optimizer scored, and shows a visible marker that calibration is required.

One edit inside `GearPieceDisplay`:

1. The `displayMainStat` memo (line ~113) gains an `assumedCalibration` branch that builds the
   preview from the same base stat the optimizer's `assumed(upgraded(get))` composition scores —
   the simulated level-16 main stat when "Use upgraded stats" is on, otherwise the raw stored one.

Per project convention the marker is plain text plus a colour class — **no emoji**.

Stat totals need no work: they come from `suggestedStats`, already computed through the wrapped
getter.

### UI

Checkbox in Advanced options in `AutogearSettings.tsx`, directly below "Include calibrated gear":

- **Label:** "Assume all gear is calibrated"
- **Help text:** states that gear is scored as if calibrated to this ship, that it combines with
  "Include calibrated gear" to also re-use gear calibrated elsewhere, and that suggested pieces
  needing calibration are marked in the results.

### Plumbing sites

Mirrors `includeCalibratedGear` exactly:

| File | Line | What |
|---|---|---|
| `src/types/autogear.ts` | 48 | field on `SavedAutogearConfig` |
| `src/pages/manager/AutogearPage.tsx` | 161 | `ShipConfig` type |
| | 311 | default `false` |
| | 595 | persisted config object |
| | 1490 | prop to settings modal |
| | 1689 | change handler |
| | 1718 | reset default |
| `src/components/autogear/AutogearSettings.tsx` | 72 | prop type |
| | 257 | destructure |
| | 338 | advanced "N of M enabled" counter |
| | ~1075 | the checkbox |
| `src/components/autogear/AutogearSettingsModal.tsx` | 25 | pass-through |

`applySavedConfigs` (`AutogearPage.tsx:336`) spreads the saved config wholesale — no edit needed.
`AutogearQuickSettings`'s community-recommendation object already omits sibling flags — no edit
needed.

## Testing

Vitest, alongside existing `src/utils/gear/__tests__` and `src/utils/autogear/fastScoring/__tests__`.

1. `assumedCalibrationEligible` — 5★ and 6★ level-16 gear qualify; implants do not; 4★ does not;
   level-0 qualifies only when `allowSimulatedLevel` is true.
2. `withAssumedCalibration` — bakes the calibrated main stat; leaves sub-stats untouched; returns
   ineligible pieces unchanged (same object contents).
3. **No double application** — a piece already calibrated to the target ship gets the bonus exactly
   once end-to-end (the `calibration`-stripping guard).
4. **Composition order** — with "Use upgraded stats" on, the bonus applies to the simulated level-16
   main stat, not the level-0 value.
5. **Fast/slow parity** under the mode, via the existing equivalence-test ladder.
6. **Regression** — with the flag off, suggestions and stats are identical to today.

## Docs and conventions

Required by `CLAUDE.md`:

- `src/constants/changelog.ts` → add a plain-English `UNRELEASED_CHANGES` entry **before**
  committing the feature.
- `src/pages/DocumentationPage.tsx` → document the toggle and its interaction with
  "Include calibrated gear" and "Use upgraded stats".
- `src/constants/tutorialSteps.ts:116` enumerates the advanced filters in prose — add the new one so
  the tutorial does not go stale.
