# DPS Calculator: Secondary Stat-Based Damage

**Date:** 2026-05-29
**Status:** Approved (design)

## Problem

Some ships deal a secondary chunk of damage scaled off a stat other than Attack —
typically Defense or max HP. Examples:

- **Chakara** (active): "deals 180% damage with additional damage equal to **80% of its Defense**".
- **Lodolite** (active): "deals 240% damage with additional damage equal to **10% of its max HP**".

The DPS calculator currently models only `Attack × skillMultiplier` for direct
damage and ignores these secondary contributions. The `parseSkillDamage` parser
already *deliberately skips* `<unit-damage>` tags followed by "of its"/"of this"
(see `skillTextParser.ts:134`), leaving the secondary portion unaccounted for.

## Scope

Support secondary damage sourced from **Defense** and **max HP** only. There is
**no ship that deals secondary *damage* from Attack** — the "of its Attack" cases
in the data are heals/shields (Howler repairs, Graphite shield), not damage.

## Confirmed Mechanic

The secondary stat-based damage is **added to the skill's base hit before crit
and defense reduction**, sharing the same crit roll and the same enemy defense
reduction as the primary hit. It is one combined hit, not a separate instance.

`calculateCritMultiplier` (`priorityScore.ts:72`) returns a unitless multiplier
(`1 + crit×critDamage`), and `calculateDamageReduction` returns a percentage, so
the refactor is purely a reassociation of existing terms.

### Current formula (`dpsSimulator.ts`)

```
baseDamage   = effectiveAttack × critMult × (1 − DR/100)
directDamage = baseDamage × (skillMult/100) × (1+outgoing/100) × (1+incoming/100) × affinity
```

### New formula

```
preCrit      = effectiveAttack × (skillMult/100)  +  effectiveSourceStat × (secondaryPct/100)
directDamage = preCrit × critMult × (1 − DR/100) × (1+outgoing/100) × (1+incoming/100) × affinity
```

Where `secondaryPct` and `effectiveSourceStat` are selected per round by the
action taken (active vs charged):

- `effectiveSourceStat` = `effectiveDefence` when the secondary stat is Defense,
  `effectiveHp` when it is max HP, or `0` when the action has no secondary.

The secondary contribution folds into the **direct** damage bucket for totals,
and is **also tracked separately** in the summary (`totalSecondaryDamage`) and
surfaced as its own line in the per-ship summary UI.

## Buff Scaling

Secondary damage **scales with in-sim buffs**, mirroring how Attack already does:

- Attack today: `effectiveAttack = attack × (1 + attackBuff/100)` (`dpsSimulator.ts:255`).
- Defense: `effectiveDefence = defence × (1 + defenceBuff/100)`.
- HP: `effectiveHp = hp × (1 + hpBuff/100)`.

The realistic case is **Defense Up I/II/III** (`+15% / +X% Defense`), which already
parse to `ParsedBuffEffects.defense`. Note that `effects.defense` is interpreted as
an *enemy* defense modifier only on the enemy-debuff path (`toEnemyModifiers`); the
self-buff path (`toSimBuffs`) currently ignores it, so reading it as a self-Defense
boost in the self path introduces no conflict.

There is **no HP% buff in the current game data**, so HP scaling is wired for
symmetry/future-proofing but will be inert until such a buff exists.

## Approach

**Reuse the existing attack-buff path.** Add `defence`/`hp` to the per-round buff
totals exactly as attack flows through the buff timeline today. This is consistent
with existing code and gives round-by-round accuracy.

Rejected alternatives:
- *Precompute a flat secondary number* — loses round-by-round buff scaling.
- *Generic "any stat-scaled damage" abstraction* — over-engineered for two stats (YAGNI).

## Components

### 1. Parser — `src/utils/skillTextParser.ts`

New `parseSecondaryDamage(text): SecondaryDamage | null`:

- Matches `additional damage equal to <unit-damage>X%</unit-damage> of (its|this Unit's) (Defense|max HP)`
  (case-insensitive; tolerate "this unit's"/"this Unit's").
- Returns `{ stat: 'defense' | 'hp', pct: X }`, or `null` if none.
- The existing `parseSkillDamage` continues to return the primary multiplier
  (it already skips the "of its"/"of this" tags), so the two are independent.

### 2. Types — `src/types/calculator.ts`

```ts
export type SecondaryDamageStat = 'defense' | 'hp';
export interface SecondaryDamage {
    stat: SecondaryDamageStat;
    pct: number; // e.g. 80 for "80% of Defense"
}
```

- `DPSShipConfig` gains: `defence: number`, `hp: number`,
  `activeSecondary?: SecondaryDamage`, `chargedSecondary?: SecondaryDamage`.
- `Buff.stat` union gains `'defence' | 'hp'`.
- `ParsedBuffEffects` gains `hp?: number`.
- Extend `autoFilledFields` union to include the new secondary fields so the
  "auto-filled" marker behaves like the existing multiplier fields. Note this
  union is declared in **two** places — `types/calculator.ts:83` and locally in
  `DPSCalculatorPage.tsx:39` (`buildSkillAutoFill`) — both must be kept in sync
  (or the local one refactored to import the shared type).

### 3. Buff helpers — `src/utils/calculators/dpsBuffHelpers.ts` + `buffParser.ts`

- `toSimBuffs`: emit self `defence` / `hp` `Buff` entries from
  `parsedEffects.defense` / `parsedEffects.hp`.
- `calculateBuffTotals` (in `dpsSimulator.ts`): also sum `defenceBuff` and `hpBuff`.
- `buffParser.parseBuffEffects`: add an HP% regex (`([+-]\d+)%\s*(?:Max\s*)?HP`)
  → `effects.hp` (future-proofing; no current buff matches).

### 4. Simulator — `src/utils/calculators/dpsSimulator.ts`

- `DPSSimulationInput` gains `defence`, `hp`, `activeSecondary?`, `chargedSecondary?`.
- Per round: compute `effectiveDefence` / `effectiveHp` from the buff totals; pick
  the action's secondary; add `secondaryStatValue × pct/100` into `preCrit` before
  crit/DR.
- Track `totalSecondaryDamage` in `DPSSimulationSummary` (still counted within
  `totalDirectDamage` so existing totals are unaffected).
- Thread the new fields through `runSinglePass`.

### 5. Page — `src/pages/calculators/DPSCalculatorPage.tsx`

- `buildSkillAutoFill` (and the init/select paths): call `parseSecondaryDamage` on
  `activeSkillText` and `chargeSkillText`; set `activeSecondary` / `chargedSecondary`;
  add the fields to `autoFilledFields` when detected.
- Capture `final.defence` and `final.hp` into the config on ship select and init.
- Manual / default configs: `defence`/`hp` defaults (e.g. `0`), no secondary.
- Pass the new fields into `simulateDPS`.

### 6. UI — `src/components/calculator/ShipConfigCard.tsx`

- New collapsible **"Secondary Damage"** sub-section inside Advanced,
  **auto-expanded when a secondary is detected** (few ships use it):
  - Defense (source) and HP (source) numeric inputs.
  - For Active and Charged: a stat `Select` (None / Defense / Max HP) + a percent
    `Input`.
  - `auto-filled` `helpLabel` markers, consistent with the multiplier fields.
- Per-ship summary (`ShipConfigSummary.tsx`): add a **Secondary Damage** line
  showing `summary.totalSecondaryDamage`.

### 7. Tests

- `skillTextParser.test.ts`: Chakara → `{defense, 80}`; Lodolite → `{hp, 10}`;
  "this Unit's max HP" variant; no-secondary → `null`; regression that
  `parseSkillDamage` still returns the primary (180/240) for the same texts.
- `dpsSimulator` test: secondary adds the expected amount to direct damage; the
  secondary portion scales with a Defense Up self-buff; `totalSecondaryDamage`
  reported correctly; configs with no secondary are unchanged.

### 8. Docs + changelog

- `DocumentationPage.tsx` and the page's "About the Simulation" block: update the
  direct-damage formula to show the secondary term.
- `src/constants/changelog.ts` `UNRELEASED_CHANGES`: plain-English entry.

## Out of Scope

- Secondary damage from stats other than Defense / max HP.
- Conditional gating of secondary damage (e.g. "if target is a Defender").
- Conditional additive bonuses (e.g. "an extra 30% per enemy buff") — the parser
  captures only the **base** percentage and ignores the conditional extra.
- Secondary damage on DoT/heal skills (this is direct-hit damage only).
```
