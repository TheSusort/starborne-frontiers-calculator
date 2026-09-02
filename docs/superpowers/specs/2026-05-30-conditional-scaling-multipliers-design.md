# Conditional Scaling Multipliers for Attacker DPS

**Date:** 2026-05-30
**Status:** Approved design — ready for implementation plan
**Area:** DPS calculator (`src/utils/calculators/dpsSimulator.ts`, `src/utils/skillTextParser.ts`, `src/pages/calculators/DPSCalculatorPage.tsx`)

## Problem

The DPS simulator models an attacker's direct damage from a fixed active/charged
skill multiplier plus an optional secondary stat-based term. Many attacker skills
in `docs/ship-skills.csv` instead carry a **conditional bonus** that scales the
skill multiplier by a count the base model ignores. Examples:

- Centurion: `100% damage with an additional 20% for each adjacent ally`
- Nuqtu: `140% damage, with additional damage equal to 80% of its Defense plus an extra 30% for each buff on the enemy`
- `+25% for each buff on this Unit`
- `+15% for each debuff on the enemy`
- `+30% for each Unit adjacent to the enemy`
- `20% more direct damage for each destroyed enemy, up to max of 100%`

The current parser deliberately captures only the base multiplier and drops the
conditional extra, so these attackers' damage is understated.

## Scope decisions (settled during brainstorming)

- **This iteration covers conditional scaling multipliers only.** Flat attack
  gains, HP-threshold/execute scaling, AoE/multi-target, and retaliation are
  out of scope.
- **Count handling is a hybrid.** Two condition families are auto-derived per
  round from existing sim state; the rest take a manual count input.
- The conditional bonus always folds into the **attack-based skill multiplier**,
  never the secondary stat term. For Nuqtu this means the `80% of Defense`
  secondary and the `+30% per enemy buff` conditional are independent fields that
  both apply.

### Why hybrid (the enemy is a static dummy)

The simulator models the enemy as a defense/HP dummy with no buffs of its own and
no surrounding formation. So only conditions whose count the sim already tracks
per round can be auto-derived:

| Condition phrase | `condition` | Derivable | Count source |
|---|---|---|---|
| `debuff on the enemy` | `enemy-debuff` | yes | landed enemy debuffs + active DoT groups that round |
| `buff on this Unit` | `self-buff` | yes | active self-buff entries that round |
| `buff on the enemy` | `enemy-buff` | no | manual |
| `adjacent ally` | `adjacent-ally` | no | manual |
| `adjacent to the enemy` | `enemy-adjacent` | no | manual |
| `destroyed enemy` | `enemy-destroyed` | no | manual |

Derivable conditions become **dynamic per-round** — the bonus ramps as the
attacker's buffs / the enemy's debuffs stack across rounds. Manual conditions use
a single static count every round.

## Data model (`src/types/calculator.ts`)

Mirror `SecondaryDamage`:

```ts
export type ConditionalCondition =
  | 'self-buff'        // derivable
  | 'enemy-debuff'     // derivable
  | 'enemy-buff'       // manual
  | 'adjacent-ally'    // manual
  | 'enemy-adjacent'   // manual
  | 'enemy-destroyed'; // manual

export interface ConditionalDamage {
  pct: number;             // per-unit bonus % added to the skill multiplier
  condition: ConditionalCondition;
  derivable: boolean;      // true → count from sim state; false → manual
  manualCount?: number;    // used when !derivable (default 1)
  cap?: number;            // optional total-bonus ceiling ("up to 100%")
}
```

- Add `activeConditional?: ConditionalDamage` and `chargedConditional?: ConditionalDamage`
  to `DPSShipConfig`, parallel to `activeSecondary` / `chargedSecondary`.
- Add the same two fields to `DPSSimulationInput`.
- Extend the `autoFilledFields` set union with `'activeConditional' | 'chargedConditional'`.
- Add the two fields to `DPSShipConfigUpdateableField` if the page edits them through
  the shared updater (otherwise a dedicated updater mirrors `updateConfigSecondary`).

## Parser (`src/utils/skillTextParser.ts`)

New `parseConditionalDamage(text: string | null | undefined): ConditionalDamage | null`.

Must match all three phrasings, with the `%` either tagged or untagged:

1. `with an additional <unit-damage>X%</unit-damage> … for each <phrase>`
2. `increasing by <unit-damage>X%</unit-damage> … for each <phrase>`
3. `plus an extra X% for each <phrase>` (untagged; may follow a secondary clause)

Rules:

- The per-unit `pct` is the number immediately tied to the `for each` clause
  (decimal supported, same as `parseSecondaryDamage`).
- The `condition` + `derivable` flag are decided solely by the trailing
  `for each <phrase>`, independent of any preceding `… of its Defense`/`… of its HP`.
- Optional cap: if the text contains `up to … N%` (e.g. "up to max of 100%"),
  set `cap = N`.
- `manualCount` defaults to `undefined` here (the page seeds the default of `1`
  for non-derivable conditions at auto-fill time, mirroring how other defaults
  are applied).
- Returns `null` when no `for each` conditional is present.

`parseConditionalDamage` and `parseSecondaryDamage` run independently on the same
text; Nuqtu yields a non-null result from both.

## Simulator (`dpsSimulator.ts`)

In `runSinglePass`, after `roundSelfBuffs` and `landedEnemyDebuffs` are resolved
for the round, and after picking `secondary`, also pick the round's conditional:

```ts
const conditional = action === 'charged' ? chargedConditional : activeConditional;
```

Compute the count:

- `self-buff` → number of active self-buff **entries** that round
  (`roundSelfBuffs.length` — entry/group count, not summed stacks)
- `enemy-debuff` → `landedEnemyDebuffs.length` + active DoT **entries**
  (`corrosionEntries.length + infernoEntries.length + pendingBombs.length` — group
  count, not `totalStacks`)
- any manual condition → `conditional.manualCount ?? 1`

Three semantics decisions for the `enemy-debuff` count, settled to remove ambiguity:

1. **Entries, not stacks.** Count the number of distinct debuff entries / DoT
   groups (array lengths), matching "number of debuffs on the enemy." A 3-stack
   Corrosion entry counts as 1.
2. **Prior-round DoTs only.** The count is read at damage-calculation time
   (right after `landedEnemyDebuffs` is resolved), so the DoT arrays still hold
   only *previous* rounds' applications — the DoTs this skill applies in Step 3
   are not yet counted. This models "debuffs already on the enemy when the hit
   lands."
3. **Coupled to the landing roll (intended).** `landedEnemyDebuffs` is gated by
   the per-round `roundDebuffLanded` roll, so on a failed roll the game-buff
   debuff portion of the count is 0 (DoT entries still count). Sim tests must pin
   the landing chance to 1 (high `hacking`, low `enemySecurity`) for determinism.

Then:

```ts
let bonusPct = 0;
if (conditional) {
  const count = /* per the rules above */;
  bonusPct = conditional.pct * count;
  if (conditional.cap !== undefined) bonusPct = Math.min(bonusPct, conditional.cap);
}
```

Fold into the attack multiplier (the secondary term is unchanged):

```ts
const preCritDamage =
  effectiveAttack * ((multiplier + bonusPct) / 100) + secondaryStatValue;
```

Track the conditional slice for reporting, parallel to `secondaryDamage`:

```ts
const conditionalDamage = effectiveAttack * (bonusPct / 100) * postDefenseFactor;
```

Accumulate `totalConditionalRaw` and expose `totalConditionalDamage` in
`DPSSimulationSummary` (new bucket next to `totalSecondaryDamage`).

### Worked example (Nuqtu, active skill, 3 enemy buffs)

- `multiplier = 140`, `activeSecondary = { stat: 'defense', pct: 80 }`,
  `activeConditional = { pct: 30, condition: 'enemy-buff', derivable: false, manualCount: 3 }`
- `bonusPct = 30 × 3 = 90`
- `preCritDamage = effectiveAttack × (140 + 90)/100 + effectiveDefence × 0.80`

## UI (`ShipConfigCard` + `DPSCalculatorPage`)

Auto-fill (`buildConfigFromShip`-equivalent) detects conditional damage from
`activeSkillText` / `chargeSkillText` and populates `activeConditional` /
`chargedConditional`, adding `'activeConditional'` / `'chargedConditional'` to
`autoFilledFields`, exactly as secondary damage does.

Rendering (parallel to the secondary-damage controls):

- **Derivable** condition → a read-only chip, e.g. `+15% per enemy debuff (auto-counted)`.
- **Manual** condition → the per-unit `%` shown alongside a small numeric `Input`
  for `manualCount` (pre-filled `1`), labelled with the condition
  (e.g. `+30% per enemy buff` with a count field).

Use existing UI primitives (`Input`, the same chip/label styling the secondary
controls use). Extend the summary/formula line to surface the conditional
contribution (`totalConditionalDamage`), consistent with the existing
`Direct = (Attack × SkillMultiplier% + SourceStat × Secondary%) × …` line.

## Tests

`src/utils/__tests__` (or alongside existing skill-parser tests):

- `parseConditionalDamage`:
  - tagged `additional X% … for each` → correct pct/condition/derivable
  - `increasing by X% … for each`
  - untagged `plus an extra X% for each buff on the enemy` (Nuqtu) → `enemy-buff`, derivable=false
  - each condition phrase maps to the right `condition` + `derivable` flag
  - decimal pct
  - `up to … N%` → `cap = N`
  - no conditional → `null`
  - co-occurrence: Nuqtu text yields both a secondary and a conditional

`src/utils/calculators/__tests__/dpsSimulator.test.ts`:

- derivable `enemy-debuff` / `self-buff`: bonus ramps as count grows across rounds
- manual condition: static bonus every round
- `cap` respected when `pct × count` exceeds it
- `totalConditionalDamage` accumulates and equals the summed conditional slice

## Docs & changelog

- Update `src/pages/DocumentationPage.tsx` DPS section to describe conditional
  scaling (derivable vs manual, the per-round behavior).
- Add a plain-English entry to `UNRELEASED_CHANGES` in
  `src/constants/changelog.ts`.

## Out of scope (YAGNI)

- Conditional extras applied to the secondary-stat term (none observed; Nuqtu's
  extra is attack-based and handled above).
- Flat attack gains, HP-threshold/execute scaling, AoE/multi-target, retaliation —
  separate future iterations.
