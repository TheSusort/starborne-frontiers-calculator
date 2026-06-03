# Charge Manipulation — DPS Calculator Design

**Date:** 2026-05-31
**Status:** Approved

## Overview

Skill text frequently changes *when* a ship's Charged Skill fires by adding or
removing charges ("adds 1 charge to its Charged Skill", "gains 2 charges",
"when an enemy dies, all allies add 1 charge"). The DPS calculator already
tracks charges in `runSinglePass` — each active round adds +1 charge, and when
`charges >= chargeCount` the charged skill fires and charges reset to 0.

This feature feeds two additional charge sources into that accumulator so the
charged skill fires on a realistic cadence:

1. **Self charge gain** — auto-filled from the attacker's own skill text,
   evaluated per-round against sim state using the existing conditional-condition
   machinery.
2. **Ally charge per round** — a flat, manually-entered number representing
   supporters (Castor / Liberator / Hermes) that feed charges to the attacker.
   These live on *other* ships, so they cannot be parsed from the attacker's own
   skill text.

Both sources accumulate **every round** (active and charged). When the charged
skill fires, charges **reset to 0** — matching the simulator's current overflow
behavior. This only shifts cadence; it introduces no new damage slice.

## Sim assumptions (provided by user)

These bound which triggers are modelable and how:

- Enemy never dies → on-kill triggers never fire → **excluded**.
- Enemy never attacks → attacker always full HP → "if full HP" → **always true**.
- Speed conditionals → **always true**.
- Enemy never repairs → "when enemy repairs" triggers → **excluded**.
- All allies adjacent.
- Enemy not Stealthed unless that buff is explicitly added.
- On-crit / N-buffs / N-debuffs / debuff-infliction conditions are already
  modeled by the existing sim and condition framework.
- Enemy ship type is added as a new UI input and modeled.

## CSV trigger → model mapping

| Trigger phrasing | Ships | Model |
|---|---|---|
| enemies faster / lowest speed / at full HP | Chakara, Cobalt | `always` → count 1 |
| after critically damaging (own crit) | Asphodel | `self-crit` → count = effectiveCrit/100 |
| target has N buffs / per buff on target | Nuqtu, Rhodium | `enemy-buff` (manual count) |
| after inflicting a debuff | Hemlock | `enemy-debuff` (derivable) |
| hits 2+ enemies | Tygr | `enemy-adjacent` (manual count) |
| target is a Defender | Thresh | `enemy-type` (new global input) |
| target is Stealthed | Selenite | `enemy-buff` "Stealth" present (manual count) |
| on kill / when enemy repairs | Valiant, Obsidian, Zosimos | **excluded** (never fire) |
| **ally** crits / enemy dies → allies gain | Hermes (gains on *ally* crit), Liberator | **external** → `allyChargePerRound` (manual) |
| removes N charges from enemy | Demolisher, Thresh, Zosimos | **out of scope** (no enemy charged skill in single-ship sim) |
| starts combat fully Charged | Sansi, Valkyrie, … | already handled via `startCharged` |

Notes:
- **Thresh has two charge clauses in one skill**: "removes 1 charge from the enemy
  **and** adds 1 charge to this Unit's Charged Skill". `parseChargeGain` must
  extract the *self-add* ("adds 1 charge to this Unit's Charged Skill" + the
  "If the target is a Defender" condition → `enemy-type`) and ignore the
  enemy-removal clause in the same sentence.
- Castor (cited earlier as an ally-charge supporter) is **not** in
  `docs/ship-skills.csv`, so it is not a parser fixture — ally charges are
  manual (`allyChargePerRound`) regardless.

## Data model (`src/types/calculator.ts`)

New `ChargeGain`, mirroring `ConditionalDamage`:

```ts
interface ChargeGain {
  amount: number;                  // charges per trigger (e.g. 1, 2)
  condition: ConditionalCondition; // reused enum + 3 new variants
  derivable: boolean;              // true → read sim state; false → use manualCount
  manualCount?: number;            // used when !derivable (default 1)
  requiredEnemyType?: EnemyBaseClass; // only for condition 'enemy-type' (Thresh → 'Defender')
}
```

Extend `ConditionalCondition` with three variants (also future-proofs damage
conditionals):

- `'always'` — unconditional, or a condition that is always-true under the sim
  assumptions (Chakara speed, Cobalt full-HP). Count = 1.
- `'self-crit'` — derivable. Count = effectiveCrit / 100 (Asphodel only). Note
  Hermes is *not* self-crit — it gains on **ally** crits → external/manual.
- `'enemy-type'` — derivable from the new **global** enemy-type input (Thresh
  "if Defender"). Count = 1 when the enemy type matches, else 0.

Existing reused conditions: `self-buff`, `enemy-debuff` (derivable, linear);
`enemy-buff`, `enemy-adjacent` (manual count). Add labels for the new variants to
`CONDITIONAL_CONDITION_LABELS`.

Define a small enemy-class enum (deliberately **not** `ShipTypeName` from
`src/constants/shipTypes.ts`, whose role list has variants like
`Defender(Security)`):

```ts
type EnemyBaseClass = 'Attacker' | 'Defender' | 'Debuffer' | 'Supporter';
```

Add to **`DPSShipConfig`** (per-attacker, auto-filled / user-tuned):

- `selfChargeGain?: ChargeGain`
- `allyChargePerRound?: number`

Enemy type is a property of the **enemy, not each attacker**, so it is **global
page state** (alongside `enemyDefense` / `enemyHp` / `enemySecurity` /
`enemyAffinity` in `DPSCalculatorPage`), **not** on `DPSShipConfig`. The required
type for the `enemy-type` condition is stored on the parsed `ChargeGain` (e.g. a
`requiredEnemyType?: EnemyBaseClass` field, or implied as "Defender" for the only
known case) and compared against the global value in the sim.

Extend the `autoFilledFields` Set union with `'selfChargeGain'`.

Add to `DPSSimulationInput`: `selfChargeGain?: ChargeGain`,
`allyChargePerRound?: number`, `enemyType?: EnemyBaseClass`.

## Simulator (`src/utils/calculators/dpsSimulator.ts`)

Thread `selfChargeGain`, `allyChargePerRound`, and `enemyType` through
`runSinglePass` params/destructure and the `simulateDPS` call site.

**Placement (important):** the bonus-charge block must go **after** the existing
conditional-bonus evaluation (currently ~dpsSimulator.ts:332-352), *not* after
the action/charge-reset block at ~244-256. It depends on values that only exist
later in the round: `effectiveCrit` (computed ~line 294, needed for `self-crit`)
and `landedEnemyDebuffs` + DoT arrays (computed ~line 341, needed for the
`enemy-debuff` derivable count). Adding it at the reset block would reference
undefined locals. The block reuses the same counting expressions as
`conditionalBonusPct` (self-buff count, enemy-debuff count).

The bonus is computed every round, then applied to `charges`. Because the
threshold check happens at the **top** of the round (line 244) reading the value
carried from the previous round, adding the bonus at the bottom of the round body
means it counts toward the *next* round's check — matching the existing `+1`
active-round semantics:

```ts
// Count derived exactly like conditionalBonusPct above.
let chargeGainCount = 0;
if (selfChargeGain) {
  switch (selfChargeGain.condition) {
    case 'always':       chargeGainCount = 1; break;
    case 'self-crit':    chargeGainCount = effectiveCrit / 100; break;
    case 'self-buff':    chargeGainCount = entry.activeSelfBuffs.filter(
                           (ab) => ab.stacks === undefined || ab.stacks > 0).length; break;
    case 'enemy-debuff': chargeGainCount = landedEnemyDebuffs.length +
                           corrosionEntries.length + infernoEntries.length +
                           pendingBombs.length; break;
    case 'enemy-type':   chargeGainCount =
                           enemyType === selfChargeGain.requiredEnemyType ? 1 : 0; break;
    default:             chargeGainCount = selfChargeGain.manualCount ?? 1; // enemy-buff, enemy-adjacent
  }
}
const bonusCharges = selfChargeGain ? chargeGainCount * selfChargeGain.amount : 0;
if (hasChargedSkill) {
  charges += bonusCharges + (allyChargePerRound ?? 0);
}
```

Note the existing `+1` is added inside the active branch at the top (line 254)
and the charged round resets to 0 (line 248). So net accumulation toward the next
fire is: active round = `1 + bonus + ally`; charged round = `bonus + ally` (the
reset happens before this block runs, so post-fire rounds still bank bonus/ally
charges — consistent with the "every round" decision).

Charges accumulate **fractionally** for a precise average cadence (e.g. a
self-crit gain at 70% crit contributes 0.7/round). `roundData.charges` is
rounded only for display. The `charges >= chargeCount` threshold check is
unchanged. No new total/summary slice — cadence change naturally redistributes
the existing direct/charged damage.

`hasChargedSkill` gating is unchanged: bonus charges only matter when a charged
skill exists (`chargedMultiplier > 0 && chargeCount >= 1`).

## Parser (`src/utils/skillTextParser.ts`)

New `parseChargeGain(text): ChargeGain | null`, a sibling of
`parseConditionalDamage`.

**Tag-awareness:** in `docs/ship-skills.csv` every charge amount is wrapped in a
tag — `<unit-aid>adds 1 charge</unit-aid>`, `<unit-aid>gains 2 charges</unit-aid>`,
`<unit-aid>add 1 charge</unit-aid>` — while the condition clause is plain text
*outside* the tag, before or after it ("If the target is a Defender, …",
"… if it is at full HP", "after critically damaging an enemy"). Like
`parseSecondaryDamage`/`parseSkillDamage`, the regex must tolerate the tag
wrapping: match the amount inside `<unit-aid>…</unit-aid>` (also handle the
`<unit-skill>` wrapping used by Castor-style ally lines for the negative case),
and read the condition from the surrounding plain text. Match the number word too
("gains a charge" → amount 1). (Note: the only CSV instance of "gains a charge"
is Zosimos, whose enemy-repair condition makes it an excluded → null case via the
clause precedence below; the number-word handling is illustrative for
amount extraction.)

Match self-targeted charge gains:

- "adds N charge(s) to its/this Unit's Charged Skill" / "gains N charge(s) to its
  Charged Skill" / "gains a charge" → `amount`.
- "adds charges ... equal to the number of buffs on the target" (Rhodium) →
  `amount: 1`, condition `enemy-buff`, derivable false (manual count).

**New condition classifier (do not reuse `mapConditionPhrase`):** the existing
`mapConditionPhrase` (skillTextParser.ts ~180-195) only recognizes the
conditional-damage "for each …" grammar (buff/debuff on unit/enemy, adjacent
ally, destroyed enemy) — *none* of the charge triggers use that phrasing. Write a
dedicated classifier mapping the charge-trigger clauses:

- speed ("more Speed than this Unit", "lowest Speed") / full-HP ("at full HP") → `always`
- "critically damaging" / "critically hits" (self) → `self-crit`
- "is a Defender" → `enemy-type` (set `requiredEnemyType: 'Defender'`)
- "buffs on the target" / "3 or more buffs" → `enemy-buff`
- "Stealthed" / "has Stealth" → `enemy-buff` (Stealth)
- "inflicts a debuff" / "after it inflicts a debuff" → `enemy-debuff`
- "damages 2 or more enemies" → `enemy-adjacent`
- default → `always` (unconditional self-add)

Returns `null` for:

- enemy-removal phrasings ("removes N charges from the enemy")
- ally-grant-to-others ("all allies add 1 charge", "charged skill of all allies")
- on-kill / enemy-repair triggers (never fire under sim assumptions)

**Clause precedence:** check the negative/ignore patterns (enemy-removal,
ally-grant, on-kill, enemy-repair) *before* extracting a self-add, because a
single skill can contain both (Thresh: "removes 1 charge from the enemy and adds
1 charge to this Unit's Charged Skill"). Strip/ignore the enemy-removal clause,
then extract the self-add ("adds 1 charge to this Unit's Charged Skill" +
"If the target is a Defender" → `enemy-type`). Conversely, a line whose only
charge phrase is ally-grant/removal returns `null`.

Reference data: `docs/ship-skills.csv`.

## Page wiring (`src/pages/calculators/DPSCalculatorPage.tsx`)

- Parse `selfChargeGain` in `buildSkillAutoFill` (scan active + passive skill
  texts, like other auto-fills).
- Seed `selfChargeGain` and a default `allyChargePerRound` in **both**
  `getInitialConfig` and `selectShipForConfig` (per-attacker config).
- Add `enemyType` as **global page state** (`useState`), alongside the existing
  `enemyDefense` / `enemyHp` / `enemySecurity` / `enemyAffinity` — *not* on
  `DPSShipConfig`.
- Pass per-attacker `selfChargeGain` + `allyChargePerRound` and the global
  `enemyType` into each `simulateDPS({...})` call.
- Add an `updateConfigChargeGain` updater mirroring `updateConfigConditional`,
  plus a simple updater for the flat `allyChargePerRound`; `enemyType` uses its
  own page-level setter.
- Wire the new props into `<ShipConfigCard>`.

## UI

- **`ShipConfigCard.tsx`** — new collapsible "Charge Manipulation" section,
  mirroring the "Conditional Damage" section: self-gain amount + condition
  select + manual count (shown only for non-derivable conditions) + an
  "Ally charges / round" numeric field. Re-sync the collapsible open-state with a
  `useEffect` keyed on the parsed `selfChargeGain` / `allyChargePerRound` values.
- **`ShipConfigSummary.tsx`** — a breakdown line showing the effective cadence
  (average rounds between charged skills) and the active charge sources.
- **Enemy-type selector** — a `Select` (None / Attacker / Defender / Debuffer /
  Supporter) placed near the enemy stat inputs, feeding the `enemy-type`
  condition.

All UI uses existing primitives (`Select`, `Input`, `CollapsibleForm`/section
pattern, `card`) per project conventions.

## Out of scope (flagged)

- Enemy charge removal and ally-grant-to-others as *modeled* effects — there is
  no enemy/ally charged skill in a single-ship sim. Parsed-skipped.
- On-kill / enemy-repair triggers — excluded (enemy never dies/repairs).
- Threshold conditions like Nuqtu "if target has 3+ buffs" auto-fill as
  `enemy-buff` with a manual count; the user tunes the exact count. The parser
  does not encode the threshold arithmetic.
- Per-supporter rows for ally charges — a single flat number covers the common
  case (YAGNI).

## Testing

- **Parser** (`src/utils/__tests__/skillTextParser.test.ts`): positive cases
  Chakara (`always`), Nuqtu/Rhodium (`enemy-buff`), Thresh (`enemy-type`),
  Selenite (`enemy-buff` Stealth), Tygr (`enemy-adjacent`), Hemlock
  (`enemy-debuff`), Asphodel (`self-crit`); negative cases Demolisher
  (enemy-removal → null), Valiant (on-kill → null), Liberator (ally-grant → null).
- **Simulator** (`src/utils/calculators/__tests__/dpsSimulator.test.ts`):
  cadence-shift assertions using the test convention (`crit:100, critDamage:0` →
  critMultiplier 1, `enemyDefense:0`). **Derive expected fire-rounds by hand from
  the exact accumulation** (active round banks `1 + bonus + ally`; charged round
  resets to 0 then banks `bonus + ally`; threshold checked at round start), then
  assert the specific rounds where `action === 'charged'` — do not assert a vague
  "~every 2 rounds". Cases: baseline (no manipulation) unchanged vs. current
  behavior; `allyChargePerRound:1` at `chargeCount:3` fires sooner; `selfChargeGain`
  `always` faster than baseline; `self-crit` at 100% crit contributes +1/round;
  `enemy-type` gives the bonus only when `enemyType` matches `requiredEnemyType`.
- **Docs + changelog**: `DocumentationPage.tsx` (DPS section + "About the
  Simulation" prose) and `UNRELEASED_CHANGES` in `src/constants/changelog.ts`.
