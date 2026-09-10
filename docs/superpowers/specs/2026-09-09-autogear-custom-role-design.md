# Autogear custom roles — design

Date: 2026-09-09

## Problem

Autogear's Strategy selector offers a `Manual` option (`AutogearSettings.tsx`, the
`RoleSelector`'s `defaultOption`). Choosing it produces a dead screen and a meaningless
optimisation:

1. **The configuration UI is gated off.** The entire "Your tweaks" card renders under
   `{selectedShipRole && …}`. With no role there is no card, so there is nothing to
   configure — no limits, no set requirements, no buffs.
2. **The scoring is effectively lexicographic.** The no-role branch of
   `calculatePriorityScore` calls `calculateDefaultScore`, which weighs each priority by
   `2^(n-1-i)`. The first priority outweighs the sum of all the rest, so ordering is the
   only control that matters — and `weight` is hard-coded to `1` at every UI site, so the
   one field that could temper it is unreachable.
3. **`statBonuses` are silently dropped.** `calculateDefaultScore` never receives them, so
   a "Scale" tweak configured in Manual mode does nothing and says nothing.
4. **An empty configuration scores every candidate 0.** Every build ties, and the user gets
   arbitrary gear presented as a result.

The goal is a Manual mode that earns its place: build a custom role out of stats, say which
direction each stat should go, and say how much each one matters.

## Requirements

- Compose a custom role from an arbitrary set of stats, including the derived
  `effectiveHp` and `directDamage`.
- Per stat, choose a direction: as much as possible, or as little as possible.
- Per stat, choose how it combines with the others, because "both stats must be good" and
  "trade one against the other" are different intentions and the built-in roles use the
  former.
- Per stat, choose how much it matters.
- Floors and ceilings stay where they already are — the existing Limits tweak — rather than
  being folded into the formula.
- A custom role starts from a built-in role, so the user is not facing a blank page.

## Decisions taken during design

Each of these was a live fork; recording them so a later reader does not re-litigate.

- **Direction is per stat, not global.** Speed genuinely wants to be low on a ship that
  should act after its debuffer; crit merely wants no slot budget spent on it. Both
  intentions are expressible as a per-row direction.
- **Combining is per stat, not one mode for the whole formula.** A weighted sum corners on
  whichever stat is cheapest in the player's inventory (see issue #482 — a good piece is a
  plateau, and maximising one axis always picks a single-stat corner). A pure product cannot
  express "and a little speed". Rows therefore carry a kind: `core` multiplies, `bonus` adds.
- **Direction and limits are independent controls.** "Speed as low as possible but never
  below 120" is expressed as a Minimize formula row plus a separate min Limit, keeping the
  existing soft-penalty and hard-requirement machinery intact and unchanged.
- **Core importance is a preset, not a free number.** For a multiplied row a weight can only
  be an exponent. `hacking^10` corners the optimizer catastrophically, and a typo is enough
  to get there. Three presets — Slight 0.5, Normal 1, Heavy 2.
- **Custom roles are not shareable.** `communityBuild.ts` returns `null` for a build with no
  role, and the community schema types `shipRole` as a non-null `ShipTypeName`. Out of scope;
  the Share control is disabled with a stated reason rather than failing silently.
- **`statBonuses` do not apply in custom mode.** `applyAdditiveBonuses` returns a raw
  `statValue × percentage/100` — a "Defence 80%" row adds `5600`. A custom formula's base is
  of order 1. The mismatch is not specific to custom mode; role base scores already span
  `~6000` (Attacker DPS) to `~10^7` (`hacking × effectiveHp`), which is why the additive mode
  is marked advanced. Custom mode therefore hides "Scale" and surfaces any persisted Scale
  rows as inactive, instead of continuing to drop them in silence.

## Data model

Custom mode remains encoded as `shipRole: null`. No member is added to `ShipTypeName`: that
type is the ships' own role, consumed by gear coverage, engineering ranking, community
builds and ship display, and widening it would ripple through all of them.

```ts
// src/types/autogear.ts
export type FormulaRowKind = 'core' | 'bonus';
export type FormulaDirection = 'max' | 'min';
export type CoreImportance = 0.5 | 1 | 2; // Slight / Normal / Heavy

export interface CustomFormulaRow {
    stat: LimitableStat;
    kind: FormulaRowKind;
    direction: FormulaDirection;
    /** Exponent for a core row. Defaults to 1 (Normal). Unused on a bonus row. */
    importance?: CoreImportance;
    /** Coefficient for a bonus row, as a percentage. Defaults to 100. Unused on a core row. */
    percentage?: number;
}

export interface CustomFormula {
    rows: CustomFormulaRow[];
    /** The role this formula was seeded from; drives the Reset button and the label. */
    seededFrom?: ShipTypeName;
}
```

`SavedAutogearConfig` gains `customFormula?: CustomFormula`. It must stay optional: every
persisted config predates it and will read back `undefined`.

This is a new type rather than a reuse of either neighbour. `StatPriority` is the Limits
tweak — stat plus min/max plus a hard flag — and folding a formula into it would give one
row two unrelated jobs. `StatBonus` is the Scale tweak, whose two modes carry inconsistent
scale semantics (additive reads the raw stat value, multiplier reads a normalized one);
overloading it would make "Scale" mean two different things depending on whether a role is
selected.

Rows dedupe on `stat` + `kind`, matching how `onAddPriority` in `AutogearPage.tsx` dedupes
stat priorities.

**"Ignore" is an absent row.** The three intentions are Maximize, Minimize and Ignore, but in
custom mode there is no preset to opt out of, so Ignore is expressed by not having the row.
The UI offers Maximize/Minimize on a row and a remove button, and does not present a
third state that would behave identically to deletion.

## Scoring

A new `customFormulaScore(stats, formula)` in `priorityScore.ts` becomes the `else` branch of
the role switch in `calculatePriorityScore`, replacing `calculateDefaultScore`. Everything
downstream is untouched: limit penalties, set-requirement penalties, orphan penalties and the
`calculateHardViolation` path all operate on the returned base score exactly as they do for a
role.

For each row, with `c = MULTIPLIER_NORMALIZERS[row.stat]`:

```
n         = resolveLimitStatValue(stats, row.stat) / c
term(max) = n
term(min) = 1 / (1 + n)

score = Π core_i  term_i ^ importance_i   ×   (1 + Σ bonus_j (percentage_j / 100) × term_j)
```

Normalizers come from `MULTIPLIER_NORMALIZERS`, not `STAT_NORMALIZERS`. For a maximized core
row the constant is a cosmetic scale factor, but for a **minimized** row it is a real
parameter: it fixes the half-point, since `term = 0.5` exactly at `value = c`.
`MULTIPLIER_NORMALIZERS` sits at roughly each stat's geared value and is already pinned by
`derivedStatBonuses.test.ts`, which makes it the defensible choice. `ROLE_BASE_STATS` is not
touched — it is the percentage reference for stat rolls and raising it would double-count
every percentage roll.

Properties this family has, which are the reason for choosing it:

- Every term is monotone in the intended direction. Minimize terms and bonus rows are
  additionally strictly positive and bounded away from zero, so they contribute a gradient
  everywhere.
- **A maximized core term is 0 when the stat is 0, and that zeroes the whole product.** This
  is the product semantics on purpose — it is what makes a lopsided build lose, and it is
  what `hacking × dps` already does today. But it has a sharp edge: a core row on a stat the
  ship has none of scores every candidate 0 until some piece of gear supplies the stat, and
  every candidate ties, which is precisely the no-gradient failure this design exists to
  remove. Consequences for the seeds and the UI are handled below; the rule is **a stat that
  can be 0 at base belongs in a bonus row, not a core row.** In `ROLE_BASE_STATS` the
  zero-at-base stats are `healModifier` (0 for every role), `hacking` (0 for ATTACKER,
  DEFENDER and SUPPORTER) and `security` (0 for ATTACKER and SUPPORTER); `hp`, `attack`,
  `defence`, `speed`, `crit`, `critDamage` and both derived stats are non-zero everywhere.
- The empty product is 1, so a formula made only of bonus rows still scores.
- A minimized row cannot drive the score to zero: a 300-speed build still contributes `0.30`
  rather than `0`. A direction is a preference. Floors and ceilings are Limits, which is what
  makes the "direction only, limits separate" split coherent.
- With exactly one core row and no bonus rows, importance is inert — an exponent is a
  monotone transform and cannot reorder a single-term ranking. The UI disables the control in
  that case rather than presenting a knob that does nothing.

An empty formula blocks the run. With zero rows there is no signal, and the current behaviour
(score everything 0, return arbitrary gear, report it as a result) is worse than a refusal.
"Find gear" is disabled with a stated reason.

## UI

**Unblocking the card.** The gate on the "Your tweaks" card becomes
`{(selectedShipRole || isCustom) && …}`, with `isCustom = !!selectedShip && !selectedShipRole`.
In custom mode the card carries a **Custom formula** section above Stat priorities, the picker
gains a "Formula stat" entry, and the picker's "Scale" entry is hidden.

**Rows.** A formula row follows the established `StatPriorityRow` idiom — edit and remove,
no reorder (see "Ordering stops meaning anything" below) — and reads:

```
Core   ·  Attack        Maximize   Heavy
Core   ·  Crit Damage   Maximize   Normal
Bonus  ·  Speed         Minimize   40%
```

Direction and importance are `Select`s. On a lone core row with no bonus rows the importance
`Select` is disabled with a note that it cannot change the ranking.

**Live feedback.** The formula card shows the currently-equipped build's custom score,
recomputed as rows are edited. A formula whose effect is invisible is the failure mode being
fixed; a number that moves when a row changes is the minimum cure. The number is of order 1
(0.8, 1.4) because the terms are normalized, and it is labelled as relative — only its
movement means anything, and there is no scale on which to make it "meaningful".

**Naming.** The `RoleSelector`'s `defaultOption` is renamed from `"Manual"` to `"Custom"`,
and this document uses Custom throughout. The old label described an absence; the new one
describes what the user now builds.

**Seeding.** Selecting Custom with an empty formula offers "Start from:" and a role picker,
which fills in rows and records `seededFrom`. Five of the twelve role formulas are products of
stats and translate exactly; seven are not, and each seed is labelled with its fidelity rather
than presented as the role's real formula.

| Role | Seed | Fidelity |
|---|---|---|
| `DEBUFFER_DEFENSIVE` | core `hacking` × core `effectiveHp` | Exact |
| `SUPPORTER_SHIELD` | core `hp` | Exact |
| `ATTACKER` | core `directDamage` | Exact, except with an Arcane Siege implant |
| `DEBUFFER` | core `hacking` × core `directDamage` | Exact, except Arcane Siege |
| `DEBUFFER_BOMBER` | core `hacking` × core `attack` | Exact, except Arcane Siege |
| `DEFENDER` | core `effectiveHp` | Approximation — the real formula models survival rounds against incoming damage, including healing and shield |
| `DEFENDER_SECURITY` | core `effectiveHp` × core `security` | Approximation, same reason |
| `DEBUFFER_DEFENSIVE_SECURITY` | core `hacking` × core `security`, bonus `effectiveHp` | Approximation — the real formula is `a×b + c`, which a product cannot express |
| `SUPPORTER` | core `hp`, bonus `healModifier`, `crit` and `critDamage` | Approximation — `healModifier` is a bonus row, not core, because it is 0 at base for every role and a zero core term would zero the formula. The real `calculateHealerScore` uses `(1 + healModifier/100)` for the same reason |
| `SUPPORTER_BUFFER` | core `speed`, bonus `effectiveHp` | Approximation — the role also rewards a 4-piece Boost set |
| `SUPPORTER_OFFENSIVE` | core `speed`, bonus `attack` | Approximation — also rewards a 4-piece Boost set |
| `DEBUFFER_CORROSION` | core `hacking` | Approximation — the role also rewards 3× Decimation |

The Arcane Siege caveat is precise: `calculateDirectDamage` deliberately omits the multiplier
(a derived stat resolves from a stat block alone), while the `ATTACKER`, `DEBUFFER` and
`DEBUFFER_BOMBER` role formulas apply it. The two roles marked unconditionally exact carry no
Arcane Siege term at all.

The three set-rewarding roles state that fact in one line. Seeds add stat rows only; they do
not silently add set requirements.

Every remaining core row in the table is safe from the zero-core-term edge by construction:
the debuffer seeds put `hacking` in a core row and `hacking` is 200 at base for every
`DEBUFFER*` role, and `DEFENDER_SECURITY` puts `security` in a core row where DEFENDER has 90.
A seed never places a role's core row on a stat that role has none of.

**A core row on a zero stat is called out in the UI.** When a core row's stat resolves to 0 on
the currently-equipped build, the row carries a note — "0 on this ship, so the formula scores
0 until gear supplies it" — because the live score reading 0 shows the symptom and the row has
to supply the cause. This is the one case a user can construct by hand that reproduces the
tie-everything behaviour the design removes elsewhere.

**Reset.** The existing "Reset to role defaults" button becomes "Reset formula" in custom
mode: re-seed from `seededFrom` when it is set, otherwise clear the formula.

## Threading

`customFormula?: CustomFormula` becomes the twelfth positional parameter of
`findOptimalGear`, matching the existing signature style rather than opening an
options-object refactor of eleven parameters across four strategies. It flows through
`AutogearStrategy`, `BaseStrategy`, all four strategies, `calculateTotalScore`,
`fastScoring/context.ts` and `fastScore.ts`, into `calculatePriorityScore`.

The fast path imposes no constraint on the formula's shape: `fastScore` builds a complete
stat block via `fastCalculateStats` and calls `calculatePriorityScore` on it, so a product of
stats is as expressible as a sum. This was checked before the scoring family was chosen; a
fast path that summed per-piece contributions would have ruled products out.

`calculateDefaultScore`, `getOrderMultipliers` and `orderMultiplierCache` are deleted along
with the branch they serve.

## Ordering stops meaning anything

`calculateDefaultScore` is the only code anywhere that reads the *order* of
`statPriorities`. Every other consumer treats a `StatPriority` as an order-independent
penalty: `calculatePriorityScore`'s limit loop and `calculateHardViolation` both iterate the
list and sum, so a reordering cannot change either result. Deleting the default-score branch
therefore makes stat-priority order inert everywhere.

Two consequences, both of which are removals of controls and claims that would otherwise
start lying:

- **The reorder arrows come off `StatPriorityRow`**, along with `onMovePriority` and its
  handler in `AutogearPage.tsx`. A pair of buttons that reorders a list nothing reads is
  worse than no buttons. Formula rows are not given arrows either: a product and a sum are
  both commutative, so a formula's rows have no meaningful order.
- **`SharedBuildFields.tsx`'s ordered-list rendering and its comment both go.** The comment
  at line 48 — "a priority's strength is its position, not a number on the row
  (`StatPriority.weight` is always 1)" — is false in both halves. The `weight` half becomes
  false with this change; the *position* half is already false today, because a shared build
  always carries a role and a role's base score never called `calculateDefaultScore` at all.
  The `<ol>` becomes a `<ul>`, and the comment is deleted rather than reworded around.

## Sites the change touches

- `src/types/autogear.ts` — the new types and `customFormula?`.
- `src/utils/autogear/priorityScore.ts` — `customFormulaScore`; delete the default-score path.
- `src/utils/autogear/scoring.ts` — thread the formula; add it to the memo cache key.
- `src/utils/autogear/fastScoring/context.ts`, `fastScore.ts` — thread the formula.
- `src/utils/autogear/AutogearStrategy.ts`, `BaseStrategy.ts` and the four strategies.
- `src/pages/manager/AutogearPage.tsx` — default config, row add/update/remove/move handlers,
  seed and reset handlers, pass-through to the strategy.
- `src/components/autogear/AutogearSettings.tsx` — the role gate, formula section, picker
  entries, hiding Scale, seed UI.
- Two new components: a formula row and a formula form, in `src/components/autogear/`.
- `src/components/autogear/AutogearConfigList.tsx` — renders nothing for a null role today;
  show "Custom" and a formula summary.
- `src/components/autogear/AutogearQuickSettings.tsx` — role display with a null role.
- `src/components/autogear/SharedBuildFields.tsx` — `SHIP_TYPES[config.shipRole]` on a null
  role; the `<ol>` becomes a `<ul>` and the line-48 comment is deleted.
- `src/components/autogear/StatPriorityRow.tsx` — remove the reorder arrows; and
  `onMovePriority` with its `AutogearPage.tsx` handler.
- `src/hooks/useCommunityRecommendations.ts` — `canShare` is `!!selectedShip && !!currentBuild`
  and gains a null-role check, so `CommunityRecommendations.tsx` renders its "Share your
  build" branch with a stated reason instead of letting `communityBuild.ts` return `null`.
- `src/components/autogear/AutogearSettings.tsx` — the `defaultOption="Manual"` passed to
  `RoleSelector` becomes `"Custom"`. `src/components/ui/RoleSelector.tsx` itself takes the
  label as a prop and needs no change; `ShipForm.tsx` and `SquadLeaderPicker.tsx` pass their
  own and are unaffected.
- `src/pages/DocumentationPage.tsx` and `src/constants/changelog.ts`.

Deliberately unchanged: `EngineeringPreviewTab.tsx` (~line 361) and `handleFindGearUpgrades`
in `AutogearPage.tsx` (~line 378) both fall back to `ship.type` when the config's role is
null, and keep doing so.

## Tests

Each is written so that it can fail — a probe that cannot report the opposite result is not a
measurement.

1. **Strategy threading tripwire, keyed to the enum.** Iterate `AutogearAlgorithm` through
   `getStrategy`, run each strategy with formula A and with formula B, and assert the results
   differ. A hand-written list of strategies would silently omit the fifth one somebody adds
   later; the enum is the source of truth, and this is the test that catches a strategy
   dropping the parameter on the floor.
2. **Seed fidelity.** For each of the five exactly-translatable roles, with Arcane Siege
   absent, `customFormulaScore` on the seeded formula must rank a fixture set identically to
   `calculateRoleScore` for that role. This fails if a role formula is edited without its seed
   being updated.
3. **Property probes.** Under a product, a balanced build outranks a lopsided one with the
   same normalized total. A minimized row ranks a lower value higher. A weighted sum corners
   on the cheap stat where the product does not. These are the three tables the design was
   agreed against.
4. **Zero core term.** A core row on a stat the build has none of scores 0, and every
   candidate ties. The test pins the behaviour deliberately rather than leaving it to be
   discovered, and pins its counterpart: the same stat in a *bonus* row leaves the other rows'
   ranking intact. It also asserts no seed in the table places a core row on a stat that is 0
   in `getBaseRoleStats(role)` — which is the tripwire that fails if someone adds a seed, or
   edits `ROLE_BASE_STATS`, without rechecking.
5. **Cache key.** Two different formulas on the same ship and the same gear must produce
   different scores. Today the key in `scoring.ts` carries `shipRole || 'none'` and nothing
   about the formula; only `clearScoreCache()` at the start of each run keeps that from being
   a live bug, and this test pins the guarantee rather than leaving it to a comment.
6. **Persisted-config defaults.** A `SavedAutogearConfig` with no `customFormula` loads and
   runs. A custom config carrying only Limits blocks the run with a stated reason instead of
   scoring every candidate 0.
7. **Order inertness.** `calculatePriorityScore` and `calculateHardViolation` return the same
   value for a `statPriorities` list and a shuffled copy of it, in both role and custom mode.
   This is the claim that justifies removing the reorder arrows, so it needs a test rather
   than the argument in this document. To be non-vacuous it must use a list of at least two
   priorities with *different* stats and limits that actually bite — a shuffle of one
   element, or of priorities that no candidate violates, would pass no matter what the code
   did.

## Out of scope

- Sharing custom builds to the community library.
- Saved, named, reusable custom roles across ships. Configs are per ship, as today.
- Any change to how `statBonuses` behave when a role *is* selected.
- Any change to the role formulas themselves.
