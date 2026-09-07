# Direct Damage: a derived autogear stat, usable as a stat bonus

**Date:** 2026-09-07
**Issue context:** follows #481 (closed no-change)

## Why

`#481` established that a bomber's crit-able damage share spans **~5% to ~69%** — a function of
(ship × your defense penetration × the opponent's defense), measured in
`docs/kit-audit-tools/bomberDamageSplit.ts`. Lingshe sits at a structural 0% (no damage clause on
either active; it scales *crit power* through the detonation channel instead), while Sha Xing
reaches 69%. No role-level constant can represent that spread, so `DEBUFFER_BOMBER` stays
crit-blind and the issue closed as no-change.

That leaves a real gap: **some bombers genuinely should gear crit, and today the calculator gives
the player no way to say so.** The role formula cannot know which — but the player does.

The existing per-ship lever is the wrong shape for it. `calculateMultiplierFactor` is linear in the
raw stat:

```js
total + (statValue / normalizer) * (bonus.percentage / 100)
```

So a `crit` bonus keeps rewarding crit past 100, where `calculateCritMultiplier` clamps it dead, and
it treats crit and crit power as independent when their value is multiplicative. It nudges a stat
rather than modelling damage.

## What

Follow the `effectiveHp` precedent. `effectiveHp` composites `hp × defence × damageReduction` behind
one name; **`directDamage`** composites `attack × crit × critDamage × defensePenetration` behind
one name. A bomber whose kit actually crits gets a `directDamage` bonus; Lingshe simply does not.

Two changes, in this order:

1. **Generalize derived stats from priority-only to the stat-bonus surface too.** `effectiveHp` is
   currently usable as a stat *priority/limit* but NOT as a stat *bonus* — `applyAdditiveBonuses`
   reads `stats[bonus.stat]`, which is `undefined` for a derived stat, and `StatBonusForm` only
   offers real stat names. Fixing this brings `effectiveHp` to parity as well (explicit owner
   request).
2. **Add `directDamage`** as a derived stat available on both surfaces.

The composite function already exists as `calculateDPS` (private in `priorityScore.ts`):

```js
const baseDPS = attack * critMultiplier * (1 - damageReduction / 100);
```

It needs exporting, called **without** `arcaneSiegeMultiplier` — that argument is set-dependent, and
`calculateRoleScore` already omits set params by design ("engineering stats are global per role and
gear-set composition is out of scope here").

### Naming

`directDamage`, label **"Direct Damage"**. The combat engine also uses `directDamage` for
non-DoT damage; autogear and the combat simulator are separate systems and the owner ruled the name
should stay the one that describes what it is.

## Touch points

Mirrors the recipe already proven by `effectiveHp` (PR #75).

### The stat itself

| file | change |
| --- | --- |
| `src/types/stats.ts` | `DerivedStatName = 'effectiveHp' \| 'directDamage'` |
| `src/utils/autogear/priorityScore.ts` | add `export function calculateDirectDamage(stats)` = `calculateDPS(stats)` with no set multiplier; add the `directDamage` branch to `resolveLimitStatValue` |
| `src/constants/stats.ts` | `DERIVED_STAT_LABELS.directDamage`; `STAT_NORMALIZERS.directDamage` (already keyed `Partial<Record<LimitableStat, number>>`, so no type change) |

### Derived stats on the stat-bonus surface

| file | change |
| --- | --- |
| `src/types/autogear.ts` | `StatBonus.stat` widens `string` → `LimitableStat` |
| `src/utils/autogear/priorityScore.ts` | `applyAdditiveBonuses` and `calculateMultiplierFactor` read via `resolveLimitStatValue(stats, bonus.stat)` instead of `stats[bonus.stat as keyof BaseStats]` |
| `src/constants/stats.ts` | `MULTIPLIER_NORMALIZERS` key type widens `keyof BaseStats` → `LimitableStat`, staying `Partial<Record<LimitableStat, number>>` — NEVER `Record<string, number>`, which would drop the compile-time key check; add `effectiveHp` AND `directDamage` entries |
| `src/components/autogear/StatBonusForm.tsx` | offer derived stats in the stat list; labels via `getLimitStatLabel` |
| `src/components/autogear/StatBonusRow.tsx` | label via `getLimitStatLabel` |
| `src/components/stats/StatPriorityForm.tsx` | add `directDamage` to the hand-curated `AVAILABLE_STATS` — it is NOT derived from a stat table, so a new derived stat must be added by hand. A `DERIVED_STAT_LABELS`-driven test now guards it |
| `src/utils/communityBuildSummary.ts`, `src/components/autogear/SharedBuildFields.tsx`, `src/components/autogear/AutogearConfigList.tsx` | the stat-BONUS label sites — swap `STATS[...]` for `getLimitStatLabel`. The stat-PRIORITY sites in two of these files were already derived-aware, which is why these were easy to miss |

`resolveLimitStatValue` is already exported and re-exported through `src/utils/autogear/scoring.ts`
(the barrel `GeneticStrategy` imports from), so no new plumbing is needed for the strategies.

### The contribution preview

| file | change |
| --- | --- |
| `src/utils/autogear/priorityScore.ts` | widen `calculateRoleScore(role, stats)` → `(role, stats, statBonuses?)`; add `previewStatBonus(stats, role, bonus, otherBonuses)` |
| `src/utils/autogear/scoring.ts` | re-export `previewStatBonus` from the barrel (import AND export blocks — the pattern `resolveLimitStatValue` already follows) |
| `src/pages/manager/AutogearPage.tsx` | pass the selected ship's `calculateTotalStats` result down (it already computes one for the suggestion diff) |
| `src/components/autogear/AutogearSettings.tsx` | compute the preview from `selectedShip` / `selectedShipRole` / `statBonuses` and pass the numbers to the form |
| `src/components/autogear/StatBonusForm.tsx` | render the preview block; see "Score magnitude" below |

### Fleet buffs stay real-stats-only

Owner ruling: fleet buffs stay as they are. A fleet buff models an actual in-game buff on an actual
stat — there is no fleet buff of "effective HP". The boundary already exists and holds cleanly:
`statBonusSchema` and `fleetBuffSchema` are separate objects in
`src/schemas/sharedAutogearBuild.ts`, and `communityBuild.ts` already documents two reverse indexes
(`STAT_NAME_INDEX` "valid for stat bonuses/fleet buffs", `LIMITABLE_STAT_INDEX` "valid for stat
priorities"). Only the *bonus* half moves to the limitable index; fleet buffs keep `STAT_NAME_INDEX`
and `statNameSchema`.

### Sharing and validation

| file | change |
| --- | --- |
| `src/schemas/sharedAutogearBuild.ts` | `statBonusSchema.stat`: `statNameSchema` → `limitableStatSchema`. `fleetBuffSchema` UNCHANGED |
| `src/utils/communityBuild.ts` | `normalizeLegacyStatBonuses` uses `LIMITABLE_STAT_INDEX` / `isLimitableStatKey`. The fleet-buff normalizer UNCHANGED. Update the `STAT_NAME_INDEX` doc comment, which currently claims it covers bonuses |

Widening the schema is backward-compatible: every previously-valid bonus stat is still valid, and
`limitableStatSchema` is a strict superset of `statNameSchema`.

### The fast-scoring path needs no change

`fastScoring/fastScore.ts` builds `statsForScoring` quickly and then delegates to the real
`calculatePriorityScore`, passing `context.statBonuses` straight through. Routing the two bonus
readers inside `priorityScore.ts` therefore covers the fast path automatically. Every field the
derived formulas read is already present in that vector: `hp`/`defence`/`damageReduction` (the
limit path already computes `effectiveHp` from it) and
`attack`/`crit`/`critDamage`/`defensePenetration` (the role formulas already read them).

## Normalizer values

`MULTIPLIER_NORMALIZERS`' contract is its own comment: "50% means roughly *this stat weighs about as
much as the base role score*". For an ATTACKER this is pinned by an identity rather than taste —
`calculateAttackerScore`'s base score **is** `calculateDPS`, so `directDamage == baseScore` there,
and a normalizer equal to a typical geared `directDamage` makes 100% double the score.

Measured references (computed from the codebase's own committed tables):

| quantity | value |
| --- | --- |
| `directDamage` at the ATTACKER scoring baseline (`getScoringBaselineStats`, def pen 0) | 3,215 |
| same, def pen 41 | 4,912 |
| attack 6,250, geared crit 100/200, def pen 41 | 5,314 |
| attack 8,000, geared crit 100/200, def pen 41 | 6,802 |
| `effectiveHp` at the ATTACKER bare chassis | 52,814 |
| `effectiveHp` at the DEFENDER bare chassis | 60,015 |

The existing entries sit at roughly each stat's *geared* value, not its bare-chassis value
(`attack` 10,000 against a bare 6,250; `hp` 50,000 against a bare 22,000; `crit` 80 and `critDamage`
130 against geared 100/200). Applying the same reading:

| table | key | value | derivation |
| --- | --- | --- | --- |
| `MULTIPLIER_NORMALIZERS` | `directDamage` | **6000** | a geared attacker's `directDamage` (attack ~8k, crit 100/200, real def pen) |
| `MULTIPLIER_NORMALIZERS` | `effectiveHp` | **120000** | ~2.3× the bare 52,814, matching hp's own bare→normalizer ratio |
| `STAT_NORMALIZERS` | `directDamage` | **3000** | keeps `attack`'s 5,000-scale ratio; ≈ the scoring-baseline value |

These are judgement calls within a measured range, not derivations, and the spec says so. **Pin all
three with a test** asserting the reference build's `directDamage`/`effectiveHp` against the
normalizer, so a later change to the crit targets or the defense curve fails loudly instead of
silently re-weighting every shared build.

## Score magnitude is SHOWN, never normalized away

Role base scores differ by orders of magnitude: an attacker's is ~3,200 while a bomber's
`hacking x attack` is ~1,250,000. `applyAdditiveBonuses` adds a raw stat value to the base score, so
the same "20%" is decisive on an attacker and invisible on a bomber.

**Rescaling the role base scores to a common range is explicitly rejected** (owner ruling). Additive
mode's semantic — "this stat contributes X% of its raw value to the score" — is deliberate, and
normalizing the base scores would destroy exactly that. The formulas stay as they are.

Instead the form **shows the magnitude** so the user can pick a percentage that does what they mean.
As the bonus is typed, `StatBonusForm` renders the marginal effect of that one bonus:

```
Stat: [ HP  v ]   %: [ 20 ]   Mode: (o) Additive  ( ) Multiplier

  This ship's base score:  3,215
  HP 22,000 x 20%       = +4,400
  -> score 3,215 -> 7,615  (+137%)
```

Live and exact per ship and role, so it cannot go stale the way a hardcoded range of typical scores
would.

### How the preview is computed

A pure helper beside the scoring code, so it is unit-testable without rendering:

```ts
export function previewStatBonus(
    stats: BaseStats,
    role: ShipTypeName | null,
    bonus: StatBonus,
    otherBonuses: StatBonus[]
): { statValue: number; baseScore: number; newScore: number };
```

- `statValue` is `resolveLimitStatValue(stats, bonus.stat)` — so a derived stat previews correctly.
- `baseScore` is the score with `otherBonuses` only; `newScore` adds `bonus`. The delta is therefore
  the **marginal** effect of the bonus being edited, which is what the user is deciding about, and
  it stays correct when several bonuses are already configured.
- This requires widening `calculateRoleScore(role, stats)` to
  `calculateRoleScore(role, stats, statBonuses?)`. Consistent with that function's existing
  docstring: it omits `setCount`/`arcaneSiegeMultiplier` because gear-set composition is out of
  scope, and stat bonuses are not set-dependent, so they pass through cleanly.

`AutogearPage` already calls `calculateTotalStats` for the selected ship, and `AutogearSettings`
already receives `selectedShip` and `selectedShipRole` — so the inputs are in hand.

**As shipped, the form receives a `previewFor?: (bonus: StatBonus) => StatBonusPreview` CALLBACK,
not precomputed numbers.** The preview has to track the in-progress stat, percentage and mode,
which only the form holds. The scoring still happens outside the component, in `previewStatBonus`,
so the testability this section is about is preserved.

**Also as shipped: the first row is labelled `Role score, current gear`, not "this ship's score".**
It reports `calculateRoleScore` (the bare formula) over the ship's CURRENTLY EQUIPPED gear, whereas
the optimizer's fitness is `calculatePriorityScore` — that formula times `(1 - penalties/100)`,
with `setCount` and `arcaneSiegeMultiplier` supplied, over stats that have had arena modifiers and
fleet buffs applied. The delta and the base/delta ratio survive all of it (the penalty factor is
multiplicative); only an absolute label would over-claim.

Reuses existing `ui/` primitives only; no new component. The form already renders a guidance `<p>`
and additive/multiplier tooltips.

## Testing

- `resolveLimitStatValue(stats, 'directDamage')` equals `calculateDPS(stats)` and responds to each
  of the four ingredients (attack, crit, critDamage, defensePenetration).
- Crit above 100 does NOT increase `directDamage` (the `calculateCritMultiplier` clamp) — this is
  the defect the raw-`crit` bonus has and the reason this stat exists.
- A `directDamage` **multiplier** bonus changes a `DEBUFFER_BOMBER` score, and a crit-only change
  with such a bonus present moves that score, where today it cannot move it at all. This is the
  feature's non-vacuity witness: assert the bomber score is UNMOVED by crit without the bonus and
  MOVED with it.
- An `effectiveHp` bonus (additive and multiplier) is non-zero — today it silently resolves to 0.
- Round-trip: a shared build carrying a `directDamage` bonus validates, and one carrying a
  `directDamage` *fleet buff* is REJECTED.
- Legacy normalization: a bonus recorded with the display label `'Direct Damage'` resolves to the
  `directDamage` key.
- Fast-path equivalence: `fastScore` and the slow path agree for a config carrying a derived-stat
  bonus.
- `previewStatBonus`: `newScore - baseScore` equals the bonus's real contribution for additive AND
  multiplier mode; the delta is MARGINAL (unchanged when unrelated `otherBonuses` are added); and a
  `directDamage` bonus previews a non-zero `statValue` where a naive `stats[stat]` read would give 0.
- `calculateRoleScore(role, stats)` with no third argument returns byte-identical results to before
  the widening, for every `ShipTypeName`.

## Docs and changelog

- `src/pages/DocumentationPage.tsx` — document the new stat and that derived stats work as bonuses.
- `src/constants/changelog.ts` `UNRELEASED_CHANGES` — three entries:
  - `Autogear: new Direct Damage stat weighs attack, crit, crit power and defense penetration together.`
  - `Autogear: Effective HP can now be used as a stat bonus, not just a requirement.`
  - `Autogear: stat bonuses now preview what they add to a ship's score.`

## Out of scope

- Any change to `calculateBomberDebufferScore` or the other role formulas. #481 closed no-change and
  that stands; this feature is the alternative to changing them.
- Deriving the weight automatically from the kit text. The measured share depends on def pen and the
  opponent's defense, neither of which the app knows, so a derived default would be confidently
  wrong. The player picks.
- Normalizing or rescaling the role base scores to a common range. Rejected by owner ruling: it
  would break additive mode's "X% of the stat's raw value" semantic, which is the point of that
  mode. The magnitude is surfaced in the UI instead.
