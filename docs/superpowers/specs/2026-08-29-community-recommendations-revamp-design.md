# Community Recommendations Revamp — Design

**Date:** 2026-08-29
**Status:** Approved, ready for implementation planning

## Problem

The community recommendation section on the autogear page has drifted away from the autogear
configuration it is supposed to describe.

**Fields stored but never displayed.** `RecommendationContent` renders `setPriority.setName` alone —
it drops `SetPriority.count` (so a 4-piece Critical build reads identically to a 2-piece one) and
drops `kind: 'implant'`, and it prints the raw set key rather than `GEAR_SETS[key].name`. It never
shows `StatPriority.weight`. It maps `StatBonus.percentage` to a bare number with no `%` and discards
`StatBonus.mode`, so an additive bonus and a multiplier bonus render identically.

**Fields never captured at all.** `CreateCommunityRecommendationInput` carries only
`statPriorities`, `statBonuses`, `setPriorities` and `shipRole`. Current `SavedAutogearConfig` also
carries `fleetBuffs`, `excludedImplantTypes`, `optimizeImplants`, `tryToCompleteSets`, `algorithm`,
`ignoreEquipped`, `ignoreUnleveled`, `useUpgradedStats`, `includeCalibratedGear`, `assumeCalibrated`
and `useArenaModifiers`. A shared build therefore cannot reproduce the result its author saw.

**A live display bug.** `RecommendationContent.tsx:44` guards the whole row body on
`(priority.minLimit || priority.maxLimit)`, so a stat priority carrying only a weight renders as an
empty `<div>`.

**A silent capture bug.** `AutogearQuickSettings` hand-builds the `currentConfig` object passed to
`CommunityRecommendations` and omits `fleetBuffs`, `excludedImplantTypes` and the calibration flags.
Even the fields the share path *could* carry are partly lost before it is reached.

**No way to use a recommendation.** Reading a build tells you what to type into the settings modal by
hand. There is no Apply.

**Discovery is poor.** One "best" recommendation is shown; every other build for the ship hides
behind a "show alternatives" toggle.

## Scope

In scope: the recommendation data model, the share path, the display, and a new Apply action.

Out of scope: the autogear algorithms themselves, the voting model (one vote per auth user, not per
profile — unchanged), and the recommendation moderation/admin story.

## Decisions

| Question | Decision |
| --- | --- |
| How much config to capture | The full build-shaping config, in a new versioned jsonb column |
| Which fields count as "the build" | role, stat priorities, stat bonuses, set priorities, fleet buffs, implant inclusion/exclusions |
| Which fields stay personal | algorithm, ignoreEquipped, ignoreUnleveled, useUpgradedStats, tryToCompleteSets, includeCalibratedGear, assumeCalibrated, useArenaModifiers |
| Apply safety | `ConfirmModal` before overwriting a non-empty config. No undo path. |
| Layout | Browsable list of every build for the ship; the selected one expands inline |
| Expanded body vocabulary | Mirrors the autogear settings panel exactly |
| Implant-specific builds | All builds listed; builds matching the equipped ultimate implant sort first |
| `ship_refit_level` | Captured on share and displayed as a chip. Informational only — no filtering, no sort. |

## Data model

### Migration

`supabase/migrations/20260829000001_community_recommendation_shared_config.sql`:

```sql
ALTER TABLE public.community_recommendations
  ADD COLUMN IF NOT EXISTS shared_config jsonb;
```

No new RLS policies. `community_recommendations` already has RLS enabled with row-level SELECT /
INSERT / UPDATE / DELETE policies (`supabase/migrations/20260424000003_alt_accounts_rls.sql`), and a
new column on an existing table inherits them.

### Payload

```ts
export interface SharedAutogearBuild {
    version: 1;
    shipRole: ShipTypeName;
    statPriorities: StatPriority[];   // stat, weight, minLimit, maxLimit, hardRequirement
    setPriorities: SetPriority[];     // setName, count, kind
    statBonuses: StatBonus[];         // stat, percentage, mode
    fleetBuffs: FleetBuff[];          // stat, percentage
    excludedImplantTypes: string[];
    optimizeImplants: boolean;
}
```

`version` exists so a future shape change can be migrated on read rather than guessed at.

### Backward and forward compatibility

**Write.** `createRecommendation` writes `shared_config` *and* keeps writing the legacy `ship_role`,
`stat_priorities`, `stat_bonuses`, `set_priorities` columns with the same values. A user running a
stale cached bundle keeps working.

**Read.** If `shared_config` is present and valid, it is the build. Otherwise the build is
synthesised from the legacy columns, with `fleetBuffs: []`, `excludedImplantTypes: []`,
`optimizeImplants: false`. Legacy rows are not badged; they simply show fewer sections.

**`ship_refit_level`.** Currently hardcoded to `0` on insert and never read. It starts being written
as `selectedShip.refits.length` and displayed as a chip on the list row. Existing rows keep `0`,
which renders as "Refit 0" — correct for the many builds shared before refits mattered, and not worth
backfilling.

## Validation

`shared_config` is written by one user and read by every other user, then fed into the autogear
engine. It crosses a trust boundary in both directions, so it gets a Zod schema following the
`src/schemas/exportedPlayData.ts` pattern:

`src/schemas/sharedAutogearBuild.ts` exports `sharedAutogearBuildSchema` and
`validateSharedAutogearBuild(value): SharedAutogearBuild | null`.

- Validated on **write**, so a malformed local config never reaches the table.
- Validated on **read**, per row. A row whose `shared_config` fails validation falls back to its
  legacy columns; if those are unusable too, the row is dropped from the list and a warning logged.
  A hostile or corrupt payload must not be able to reach `updateShipConfig`.
- `stat` / `setName` / implant keys are validated against the known unions, so Apply cannot inject an
  unknown key into the engine.

**Display lookups must be total-safe regardless.** `STATS`, `GEAR_SETS`, `SHIP_TYPES` and `IMPLANTS`
are `Record` types that gate authoring, not input — indexing them with a key from a persisted foreign
payload can yield `undefined`. `StatBonusRow.tsx` currently does `STATS[bonus.stat as StatName].label`
with no guard and throws on an unknown stat. Every lookup in the new components uses
`STATS[key]?.label ?? key` and equivalents, and the existing `StatBonusRow` gets the same guard.

## Service layer

`CommunityRecommendationService.getBestRecommendation` (an RPC that lives only in prod — it is not in
`supabase/migrations/`) and `getAlternatives` collapse into:

```ts
static async listForShip(shipName: string): Promise<CommunityRecommendation[]>
```

One query, ordered by `score desc, total_votes desc, created_at desc`, returning every row for the
ship. The RPC stops being called. Implant relevance is applied client-side rather than in SQL, so
the "other implant" builds remain visible instead of being filtered away.

Sort, applied after the score ordering:

1. `is_implant_specific` and `ultimate_implant` matches the ship's equipped ultimate implant
2. not `is_implant_specific`
3. `is_implant_specific` with a different `ultimate_implant`

Vote fetching stays as-is: one `getUserVote` per expanded build, not per row.

## UI

The section lives in the narrow left sidebar of the autogear page, once per selected ship. Width is a
real constraint; every layout below is single-column.

### Collapsed

Header shows the **count** ("3 community builds"), not the top build's title, plus the sort control.

The sort control offers **Top rated** (default) and **Newest**. The implant grouping described under
"Service layer" always applies and is not user-controllable; the chosen sort orders builds *within*
each implant group.

### Expanded

A list of one-line rows. Each row shows title, implant chip (when implant-specific), refit chip, a
one-line config summary, and the vote sum. The top build auto-expands on open. One build is expanded
at a time.

The one-line summary is produced by `communityBuildSummary.ts` in the same style as the existing
`AutogearConfigList` per-ship summary: role, set priorities with counts, limit-carrying stat
priorities, and stat bonuses with their mode abbreviated.

### Expanded build body

Sections, in this order, each omitted when empty: Role, Stat priorities, Gear sets, Stat bonuses,
Fleet buffs, Implants. The rendering mirrors the settings panel word for word — most importantly
stat bonuses read `Attack (30%) — Additive` / `Speed (50%) — Multiplier`, matching `StatBonusRow`, so
the two representations cannot drift. Set priorities read `4 × Critical`; implant-kind entries read
the implant name. Stat priorities show `min 100 · strict` and `weight 3×` and are never blank.

Apply and the two vote buttons sit **inside** the expanded build, so it is unambiguous which build
they act on. "Share your build" sits in the section footer.

### Components

New:

- `CommunityBuildList.tsx` — the list, sort control, expansion state
- `CommunityBuildRow.tsx` — one collapsed row
- `CommunityBuildDetails.tsx` — the expanded config-mirror body
- `src/utils/communityBuildSummary.ts` — the one-line summary string

Changed:

- `RecommendationHeader.tsx` — count-based rather than best-build-based
- `CommunityRecommendations.tsx` — composes the list; the `toAIRecommendation` shim is deleted
- `CommunityActions.tsx` — vote buttons move into the expanded build; share stays in the footer
- `ShareRecommendationForm.tsx` — gains a read-only preview of exactly what is being captured
- `useCommunityRecommendations.ts` — returns a build list plus expansion state instead of
  `recommendation` / `alternatives` / `selectedAlternative`
- `AutogearQuickSettings.tsx` — stops hand-building `currentConfig`; passes the real config through
- `StatBonusRow.tsx` — total-safe `STATS` lookup

Deleted:

- `AlternativeRecommendations.tsx`
- `RecommendationContent.tsx`
- the `AIRecommendation` type in `src/types/communityRecommendation.ts`

All UI uses existing `src/components/ui/` primitives — `Button`, `ConfirmModal`,
`CollapsibleAccordion`, the `card` class. No raw `<button>` except the row-level expand toggle, which
falls under the accordion-header exception.

## Apply

`CommunityBuildDetails` raises `onApply(build)`. The handler lifts through
`CommunityRecommendations` → `AutogearQuickSettings` → `AutogearPage`, where it calls the existing
`updateShipConfig(shipId, updates)` with:

```
shipRole, statPriorities, setPriorities, statBonuses,
fleetBuffs, excludedImplantTypes, optimizeImplants
```

and nothing else. The personal toggles are not in the update object, so they cannot be touched.

This writes page state, matching how the settings modal behaves. It persists through the existing
`saveConfig` call that already runs when autogear is started (`AutogearPage.tsx:615`). Apply does not
write to Supabase directly.

**Confirmation.** A `ConfirmModal` appears when the ship's existing config is non-empty, defined as
any of: `statPriorities`, `setPriorities`, `statBonuses`, `fleetBuffs` or `excludedImplantTypes` is a
non-empty array, or `optimizeImplants` is `true`. `shipRole` is excluded from this test because it
always defaults to the ship's own type and so is never empty. The modal lists which sections will be
overwritten. When the config is empty the modal is skipped and Apply takes effect immediately. A
success notification confirms the apply. There is no undo.

## Testing

- `sharedAutogearBuild` schema: valid round-trip; rejects unknown stat keys, unknown set names,
  wrong types, missing `version`.
- Service read path: a row with valid `shared_config` uses it; a legacy row with no `shared_config`
  synthesises from the legacy columns; a row with corrupt `shared_config` falls back rather than
  throwing.
- Implant sort: equipped-implant matches first, generic second, other-implant last, score order
  preserved within each group.
- `communityBuildSummary`: counts, modes and limits all present; unknown keys render as the raw key
  rather than crashing.
- `CommunityBuildDetails`: a weight-only stat priority renders its weight and not an empty row; an
  additive and a multiplier bonus render differently; a 4-piece and a 2-piece set render differently.
- Apply: writes exactly the seven build fields; asserts `algorithm`, `ignoreEquipped`,
  `ignoreUnleveled`, `useUpgradedStats`, `tryToCompleteSets`, `includeCalibratedGear`,
  `assumeCalibrated`, `useArenaModifiers` are unchanged.
- Confirm gate: modal shown for a non-empty config, skipped for an empty one.

Existing `AutogearQuickSettings.test.tsx` mocks `CommunityRecommendations` and should keep passing
unchanged.

## Documentation and changelog

- `src/pages/DocumentationPage.tsx`: update the community recommendations section to describe the
  build list, what a shared build now carries, and Apply.
- `UNRELEASED_CHANGES` in `src/constants/changelog.ts`: user-facing entries for the richer shared
  build, the browsable list, and the Apply button.

## Risks

- **Old rows look thin.** Every pre-migration recommendation lacks fleet buffs and implant settings.
  Accepted: they render fewer sections and Apply writes fewer fields. No backfill is possible.
- **The prod-only RPC.** `get_best_community_recommendation` exists in prod but not in
  `supabase/migrations/`. This design stops calling it; it is left in place rather than dropped, so
  no migration drift is introduced.
- **Section height.** The list makes the section taller in a narrow sidebar. Mitigated by one-line
  rows and a single expanded build at a time.
