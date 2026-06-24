# Gear-set DoT pair — Burner + Decimation (combat-realism)

**Date:** 2026-06-24
**Status:** Design — pending plan
**Epic:** combat-realism (special-effect gear sets bucket)
**Baseline branch:** `main` (charge epic stack #151–#154 lands separately; this PR is independent of it)

## Summary

Add the two DoT-related special-effect gear sets to the equipment-ability registry:

- **Burner** (4pc) — "Applies Inferno 1 for 2 turns." (stat portion +15% attack already modeled)
- **Decimation** (2pc) — "+10% DoT damage" per complete set, max 3 sets = +30% (stat portion: none)

Both ride existing machinery. The only genuinely new primitive is a `dotDamage`
modifier channel for Decimation. No combat fixture equips either set, so the
expectation is **byte-identical goldens** (to be verified during planning).

This follows the established D-PR gear-set/implant registry pattern: stat portions
are already folded into combat stats; this PR adds **only** the special effects via
`GEAR_SET_ABILITIES` in `src/utils/abilities/buildEquipmentAbilities.ts`.

## Background — what already exists

- **DoT model.** `DoTType = 'corrosion' | 'inferno' | 'bomb'` (`types/calculator.ts`).
  Inferno tiers are 15/30/45 for Inferno 1/2/3 → **"Inferno 1" = tier 15**.
- **Reactive DoT executor** (`triggers.ts` ~1398): a `dot` AbilityConfig pushes an
  entry to `ctx.infernoEntries`/`ctx.corrosionEntries` with `sourceId = owner` and
  emits a `dot-applied` event to `ctx.enemy.id`. Already used by ship-skill reactive DoTs.
- **DoT tick damage** (`engine.ts` 752/770): each tick =
  `stacks × (tier/100) × base × ctx.dotMult × ctx.affinityMult`, where `ctx` is the
  **applier's** snapshotted per-round context (resolved per entry via `sourceId`).
- **`dotMult`** (`playerTurn.ts` 1234) = `1 + (selfDotModifier + enemyDotMod +
  dmgStats.selfDotDamageModifier) / 100`. `dmgStats.selfDotDamageModifier`
  (`effectiveStats.ts` 214) currently = `toDotAndPenModifiers(abilitySelfEffects, []).dotDamageModifier`,
  i.e. the sum of `parsedEffects.dotDamage` over the applier's timed/gated self-buff statuses
  (the "Out. DoT Up" buff channel). Bombs are excluded from this multiplier (corrosion + inferno only).
- **Passive-modifier fold** (`applyAbilities.ts` `modifierTotalsFromAbilities`): sums active
  `modifier` abilities into stat channels (`attack`/`crit`/`outgoingDamage`/…). Gear-set abilities
  are merged into the passive slot and the passive slot is already included in `modifierAbilities`
  (`[...firing, ...passive]`, per D-PR2). There is **no `dotDamage` channel today.**
- **Existing partial Decimation modeling (display/scoring only, NOT the engine):**
  `DoTDamage.tsx` stat-line (10% per *piece*) and `priorityScore.ts` autogear (10% per complete
  *set*). These are inconsistent and neither touches the battle-sim DoT ticks. This PR makes the
  **engine** honor Decimation for the first time; per-set semantics (below) is authoritative.

## Effect 1 — Burner

**Behaviour:** when the equipped ship casts (attacks), apply Inferno 1 (tier 15), 1 stack,
2 turns, to the cast target.

**Model:** a reactive `dot` ability in `GEAR_SET_ABILITIES`, trigger **`on-deal-damage`**:

```typescript
BURNER: () => ({
    type: 'dot',
    target: 'enemy',
    trigger: 'on-deal-damage',
    conditions: [],
    config: { type: 'dot', dotType: 'inferno', tier: 15, stacks: 1, duration: 2 },
    autoFilled: true,
})
```

- **Trigger correction (found during implementation):** `on-cast` does NOT work for a
  passive-slot DoT. The cast path only gathers DoTs from the *fired* skill
  (`dotsFromSkill(gatedSkill)`, playerTurn.ts:1262) — never the passive slot — and `on-cast`
  is not a `LIVE_TRIGGER`, so the reactive executor never fires it either. (Leech, also an
  `on-cast` gear-set ability, only works because it has a *dedicated* engine scan,
  `procStandingLeeches`.) Burner therefore uses **`on-deal-damage`** — a `LIVE_TRIGGER` that
  fires once per turn the owner deals direct damage (added in the reactive-cleanse PR; the
  Warpstrike precedent). Faithful to "applies Inferno when it attacks" and golden-safe
  (no fixture equips Burner).
- Rides the **existing** reactive DoT executor (`triggers.ts` ~1388) — pushes an inferno
  entry (`sourceId = owner`) and emits `dot-applied` to `ctx.enemy.id` (the attack target).
  No new application path.
- The entry ticks with the **applier's** snapshotted `dotMult`/`effectiveAttack`, so a
  Burner + Decimation ship's inferno is Decimation-boosted automatically.
- Single target (the attack target), per the design decision. Re-applies each attacking turn
  (refreshes the 2-turn duration). AoE-footprint application is explicitly out of scope.

## Effect 2 — Decimation

**Behaviour:** +10% DoT damage per complete 2pc Decimation set; max 3 sets (6 pieces) = +30%.
Self-scoped (boosts the equipped ship's own corrosion + inferno ticks; bombs excluded).

**Model:** a passive `modifier` ability feeding a **new `dotDamage` channel** that folds into
`dotMult`. This is symmetric with how D-PR2 routed conditional outgoing damage through the
`outgoingDamage` modifier channel.

Changes:

1. **`types/abilities.ts`** — add `'dotDamage'` to `ModifierChannel`.
2. **`applyAbilities.ts`** — add `dotDamage: number` to `ModifierTotals`; sum the
   `'dotDamage'` channel in `modifierTotalsFromAbilities` (mirrors the existing channel cases).
3. **`effectiveStats.ts`** — in `effectiveDamageStatsOf`, change the returned
   `selfDotDamageModifier` (line 214) **from** `dotPen.dotDamageModifier` **to**
   `dotPen.dotDamageModifier + mod.dotDamage` (`mod = modifierTotalsFromAbilities(...)` is
   already in scope at line 184). This is the single engine fold point — `dotMult` already
   consumes `dmgStats.selfDotDamageModifier`, so both the engine cast path and reactive-DoT
   ticks pick it up with no further wiring.
4. **`buildEquipmentAbilities.ts`** — Decimation builder emits
   `{ type:'modifier', target:'self', trigger:'on-cast', conditions:[],
     config:{ type:'modifier', channel:'dotDamage', value: completeSets*10, isMultiplicative:false } }`.

**Set-count plumbing:** the gear-set builder signature widens from
`() => Omit<Ability,'id'>` to `(count: number) => Omit<Ability,'id'>`. The activation loop
already holds `count` (pieces) and `minPieces`; pass `count`, and Decimation computes
`completeSets = Math.floor(count / minPieces)` (minPieces=2 → 1/2/3 sets at 2/4/6 pieces →
10/20/30%). Existing builders (Leech, Hardened, Burner) ignore the arg → byte-identical.

## DPS calculator wiring

Decimation affects DoT damage → DPS, so the DPS calculator must honor it. `dpsSimulator.ts`
(line ~241) derives its `selfDotModifier` **solely** from `toDotAndPenModifiers(selfBuffs, [])`
and never calls `modifierTotalsFromAbilities` on the self side, so the value is **not** sitting
in an existing variable the way it is on the engine side. Honoring Decimation in the DPS path
therefore requires the DPS simulator to actually **run** `modifierTotalsFromAbilities` over the
passive abilities (or otherwise extract the `dotDamage` channel) and add it into `selfDotModifier`
— a bit more than a one-token change to an existing sum.

`buildShipAbilitiesWithEquipment` is already wired into `DPSCalculatorPage` (verified: it is
passed as `shipSkills` at `DPSCalculatorPage.tsx:73`), so the Decimation `modifier` ability is
already present in the DPS ability set — only the fold into the DPS `dotMult` needs adding. The
exact seam is a plan-level detail; if it proves larger than a small additive change, it may be
peeled to a follow-up (the engine fold is the primary deliverable).

## Out of scope / explicitly deferred

- AoE-footprint Burner application (single-target only).
- Bomb DoT scaling from Decimation (matches the existing corrosion+inferno-only channel).
- Reconciling/removing the legacy per-piece `DoTDamage.tsx` display math (separate cleanup;
  not this PR's concern unless it visibly contradicts the engine — note for follow-up).

## Testing

- **Registry unit tests** (`buildEquipmentAbilities` test): Burner emits the inferno `dot`
  ability; Decimation emits a `dotDamage` modifier scaling with complete-set count
  (2pc→10, 4pc→20, 6pc→30); sub-`minPieces` piece counts emit nothing.
- **Modifier-fold unit test** (`applyAbilities` test): a `dotDamage` modifier sums into
  `ModifierTotals.dotDamage`; other channels unaffected.
- **Mutation-resistant engine integration tests** routed through the **real** registry
  (`buildShipAbilitiesWithEquipment` + a `getGearPiece` returning `setBonus:'BURNER'`/`'DECIMATION'`,
  not a hand-rolled ability):
  - Burner applies a 2-turn Inferno (tier 15, 1 stack) to the target on cast; expires after 2 ticks.
  - Decimation scales the equipped ship's inferno/corrosion ticks by `sets×10%` (assert the tick
    delta vs a no-Decimation control).
  - Composition: Burner + Decimation on the same ship → Burner's inferno is Decimation-boosted.
- **Coverage tracker** (`equipmentCoverage.test.ts`): add `BURNER` + `DECIMATION` to the
  implemented gear-set set (decl-order array, Set, and the `exactly{}` string).

## Verification gates

- Full suite green; `npm run lint`, `tsc` clean; `npm run audit:skills` unchanged.
- **ZERO golden / `.snap` drift** — confirm no combat fixture equips Burner or Decimation
  (grep fixtures for the set names). If any does, the change is no longer byte-identical and
  the goldens must be re-derived deliberately, not `-u`'d. Note: grepping `BURNER`/`DECIMATION`
  turns up **non-combat** hits in the autogear `fastScoring`/`fastPotential` scoring fixtures —
  those are scoring-only and do not touch combat goldens; don't be alarmed by them.
- DPS-calc numbers: byte-identical for ships without Decimation; correctly increased for ships
  with it (manual spot-check + the DPS wiring test).
