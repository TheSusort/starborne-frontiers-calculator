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
| after critically damaging | Asphodel, Hermes | `self-crit` → count = effectiveCrit/100 |
| target has N buffs / per buff on target | Nuqtu, Rhodium | `enemy-buff` (manual count) |
| after inflicting a debuff | Hemlock | `enemy-debuff` (derivable) |
| hits 2+ enemies | Tygr | `enemy-adjacent` (manual count) |
| target is a Defender | Thresh | `enemy-type` (new global input) |
| target is Stealthed | Selenite | `enemy-buff` "Stealth" present (manual count) |
| on kill / when enemy repairs | Valiant, Obsidian, Zosimos | **excluded** (never fire) |
| ally crits / enemy dies → allies gain | Hermes, Liberator, Castor | **external** → `allyChargePerRound` (manual) |
| removes N charges from enemy | Demolisher, Thresh, Zosimos | **out of scope** (no enemy charged skill in single-ship sim) |
| starts combat fully Charged | Sansi, Valkyrie, … | already handled via `startCharged` |

## Data model (`src/types/calculator.ts`)

New `ChargeGain`, mirroring `ConditionalDamage`:

```ts
interface ChargeGain {
  amount: number;                  // charges per trigger (e.g. 1, 2)
  condition: ConditionalCondition; // reused enum + 3 new variants
  derivable: boolean;              // true → read sim state; false → use manualCount
  manualCount?: number;            // used when !derivable (default 1)
}
```

Extend `ConditionalCondition` with three variants (also future-proofs damage
conditionals):

- `'always'` — unconditional, or a condition that is always-true under the sim
  assumptions (Chakara speed, Cobalt full-HP). Count = 1.
- `'self-crit'` — derivable. Count = effectiveCrit / 100 (Asphodel, Hermes).
- `'enemy-type'` — derivable from the new global enemy-type input (Thresh
  "if Defender"). Count = 1 when the enemy type matches, else 0.

Existing reused conditions: `self-buff`, `enemy-debuff` (derivable, linear);
`enemy-buff`, `enemy-adjacent` (manual count). Add labels for the new variants to
`CONDITIONAL_CONDITION_LABELS`.

Add to `DPSShipConfig`:

- `selfChargeGain?: ChargeGain`
- `allyChargePerRound?: number`
- `enemyType?: EnemyBaseClass` — `'Attacker' | 'Defender' | 'Debuffer' | 'Supporter'`
  (a small enum, not the full role list)

Extend the `autoFilledFields` Set union with `'selfChargeGain'`.

Add to `DPSSimulationInput`: `selfChargeGain?`, `allyChargePerRound?`,
`enemyType?` (same types as above).

## Simulator (`src/utils/calculators/dpsSimulator.ts`)

Thread `selfChargeGain`, `allyChargePerRound`, and `enemyType` through
`runSinglePass` params/destructure and the `simulateDPS` call site.

In the round loop, after the action/charge-reset block, compute the bonus
charges and add them **every round**:

```ts
// Count derived exactly like conditionalBonusPct.
let chargeGainCount = 0;
if (selfChargeGain) {
  switch (selfChargeGain.condition) {
    case 'always':       chargeGainCount = 1; break;
    case 'self-crit':    chargeGainCount = effectiveCrit / 100; break;
    case 'self-buff':    chargeGainCount = /* count self buffs */; break;
    case 'enemy-debuff': chargeGainCount = /* count enemy debuffs */; break;
    case 'enemy-type':   chargeGainCount = enemyType === requiredType ? 1 : 0; break;
    default:             chargeGainCount = selfChargeGain.manualCount ?? 1; // enemy-buff, enemy-adjacent
  }
}
const bonusCharges = selfChargeGain
  ? chargeGainCount * selfChargeGain.amount
  : 0;
charges += bonusCharges + (allyChargePerRound ?? 0);
```

Charges accumulate **fractionally** for a precise average cadence (e.g. a
self-crit gain at 70% crit contributes 0.7/round). `roundData.charges` is
rounded only for display. The `charges >= chargeCount` threshold check is
unchanged. No new total/summary slice — cadence change naturally redistributes
the existing direct/charged damage.

`hasChargedSkill` gating is unchanged: bonus charges only matter when a charged
skill exists (`chargedMultiplier > 0 && chargeCount >= 1`).

Ordering note: derivable `self-crit` reads `effectiveCrit`, which is computed
mid-round; place the charge-gain block after `effectiveCrit` is available.

## Parser (`src/utils/skillTextParser.ts`)

New `parseChargeGain(text): ChargeGain | null`, a sibling of
`parseConditionalDamage`. Matches self-targeted charge gains:

- "adds N charge(s) to its Charged Skill" / "gains N charge(s) to its Charged
  Skill" / "gains a charge" → `amount`.
- "adds charges ... equal to the number of buffs on the target" (Rhodium) →
  `amount: 1`, condition `enemy-buff`, derivable false (manual count).
- Classify the surrounding condition clause into a `ConditionalCondition`
  (speed/full-HP → `always`; crit → `self-crit`; Defender → `enemy-type`;
  buffs on target → `enemy-buff`; debuff inflict → `enemy-debuff`; 2+ enemies →
  `enemy-adjacent`). Default to `always` when no recognizable condition.

Returns `null` for:

- enemy-removal phrasings ("removes N charges from the enemy")
- ally-grant-to-others ("all allies add 1 charge", "charged skill of all allies")
- on-kill / enemy-repair triggers (never fire under sim assumptions)

Reference data: `docs/ship-skills.csv`.

## Page wiring (`src/pages/calculators/DPSCalculatorPage.tsx`)

- Parse `selfChargeGain` in `buildSkillAutoFill` (scan active + passive skill
  texts, like other auto-fills).
- Seed `selfChargeGain` and defaults for `allyChargePerRound` / `enemyType` in
  **both** `getInitialConfig` and `selectShipForConfig`.
- Pass `selfChargeGain`, `allyChargePerRound`, `enemyType` into the
  `simulateDPS({...})` call.
- Add an `updateConfigChargeGain` updater mirroring `updateConfigConditional`,
  plus simple updaters for the flat `allyChargePerRound` and `enemyType`.
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
  critMultiplier 1, `enemyDefense:0`). E.g. `chargeCount:3` + `allyChargePerRound:1`
  → charged fires ~every 2 rounds; `selfChargeGain` with `always` → faster
  cadence than baseline; `self-crit` at 100% crit → +1/round.
- **Docs + changelog**: `DocumentationPage.tsx` (DPS section + "About the
  Simulation" prose) and `UNRELEASED_CHANGES` in `src/constants/changelog.ts`.
