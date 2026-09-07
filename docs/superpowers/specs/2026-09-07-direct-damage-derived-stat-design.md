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

`resolveLimitStatValue` is already exported and re-exported through `src/utils/autogear/scoring.ts`
(the barrel `GeneticStrategy` imports from), so no new plumbing is needed for the strategies.

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

## Known limitation to surface in the UI

Role base scores differ by orders of magnitude: an attacker's is ~3,200 while a bomber's
`hacking × attack` is ~1,250,000. `applyAdditiveBonuses` adds a raw stat value to the base score, so
an additive `directDamage` bonus on a bomber contributes ~3,215 against 1.25M — invisible.
**Multiplier mode is the mode that works for a bomber**, and it is the mode this feature exists for.

This is pre-existing behaviour, not new (an additive `attack` bonus on a bomber is equally inert),
and fixing the scale mismatch across role formulas is out of scope. But since the whole point here
is bombers, `StatBonusForm`'s existing explanatory copy should note that multiplier mode is the one
that shifts a score whose base is large. No new component — the form already renders a `<p>` of
guidance and already has additive/multiplier tooltips.

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

## Docs and changelog

- `src/pages/DocumentationPage.tsx` — document the new stat and that derived stats work as bonuses.
- `src/constants/changelog.ts` `UNRELEASED_CHANGES` — two entries:
  - `Autogear: new Direct Damage stat weighs attack, crit, crit power and defense penetration together.`
  - `Autogear: Effective HP can now be used as a stat bonus, not just a requirement.`

## Out of scope

- Any change to `calculateBomberDebufferScore` or the other role formulas. #481 closed no-change and
  that stands; this feature is the alternative to changing them.
- Deriving the weight automatically from the kit text. The measured share depends on def pen and the
  opponent's defense, neither of which the app knows, so a derived default would be confidently
  wrong. The player picks.
- The role-formula scale mismatch (attacker ~3.2k vs bomber ~1.25M base scores).
