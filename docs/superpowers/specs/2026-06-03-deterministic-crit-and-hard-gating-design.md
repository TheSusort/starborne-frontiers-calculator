# Deterministic Crit Schedule + Hard Condition Gating — Design

**Date:** 2026-06-03
**Branch:** `feat/skill-ability-editor`
**Status:** Approved
**Builds on:** `2026-06-01-skill-ability-editor-design.md` (shared ability model, Phases 1–3b shipped), `docs/skill-model-coverage.md` (coverage audit; this spec ships backlog items #1, #2, #6 and Tier 1+2 of ability ordering)

## Problem

The coverage audit found that condition gates on payload abilities are parsed and
editable but **never evaluated by the sim**: `runSinglePass` reads only the damage
ability's `scaling` rule (`scaledBonus`), so a condition without scaling does nothing
— for `damage`, `additional-damage`, `dot`, `detonate-dot`, and `accumulate-detonate`
alike. The editor looks honest; the sim ignores it.

Separately, crit is modeled as an expected-value multiplier
(`1 + crit/100 × critDamage/100`) folded into every hit. That makes `self-crit`
condition gates incoherent (a "when this unit crits" gate can only be probability-
weighted, never true/false), and it diverges from how the game resolves a hit.

Two of the sim's inputs are also still `Math.random()` rolls (debuff landing,
crit-power extend chance), so identical inputs produce different totals between
recomputes.

## Goals

1. **Hard-gate all payload ability types**: conditions not met → the ability
   contributes nothing that round.
2. **Per-round binary crit** decided by a deterministic schedule, replacing the
   expected-value multiplier.
3. **Fully deterministic sim**: zero `Math.random()`; identical inputs → identical
   output, always.
4. **Live enemy-HP gates**: derive enemy HP% from damage dealt so execute-style
   conditions activate mid-sim.
5. **Ability ordering**: parser emits abilities in skill-text order (the game's
   execution order); editor can reorder; gates see same-cast earlier effects.

Out of scope: full sequential execution (mid-cast stat changes; relative
dot-vs-detonate order), position-aware timeline debuffs, dynamic per-round buff
gating (coverage backlog #4), heal/shield/cleanse/purge/control consumption,
autogear fast-scoring changes.

## Design

### 1. Deterministic rate accumulators

New module `src/utils/calculators/rateAccumulator.ts`:

```ts
export function makeRateGate(): (rate: number) => boolean;
// internal: acc += clamp(rate, 0, 1); if (acc >= 1 - EPS) { acc -= 1; return true; }
```

- Rate is supplied **per call** — crit rate changes round-to-round with
  buffs/modifiers and the accumulator absorbs that naturally.
- `EPS` guards float drift (rate 0.1 over 10 calls fires exactly once).
- Frequency-exact by construction: rate `p` over `n` calls fires
  `floor`/`round`-of-`p·n` times, evenly spaced (max gap `ceil(1/p)`).

Four independent instances per `runSinglePass`, declared with the other
fresh-per-call mutable state:

| Gate | Replaces | Advances |
|---|---|---|
| `activeCritGate` | expected-value crit multiplier | each **active** round, by `effectiveCrit/100` |
| `chargedCritGate` | 〃 | each **charged** round, by `effectiveCrit/100` |
| `debuffLandingGate` | `Math.random() < debuffLandingChance` | once per round |
| `extendChanceGate` | `Math.random()` in crit-power extend | per extend attempt, by `critPowerFactor` |

**Per-stream crit gates** (active vs charged) prevent cadence aliasing: with one
global accumulator, 50% crit + charged-every-2-rounds could make the charged hit
*always* or *never* crit depending on phase alignment. Separate streams guarantee
each hit class crits at exactly the crit rate.

### 2. The round's crit outcome

After modifiers fold in (final `effectiveCrit` known), the firing stream's gate
advances once → `roundCrit: boolean`.

- **`noCrit` rule:** if the firing skill's damage ability has `noCrit`, `roundCrit`
  is forced `false` and the gate does **not** advance — an uncrittable attack
  cannot trigger crit effects and consumes no crit chance.
- **Damage math:** `damageCritMultiplier = roundCrit ? 1 + effectiveCritDamage/100 : 1`.
  The expected-value `calculateCritMultiplier` is no longer called by the sim (it
  remains untouched in autogear fast scoring; small sim-vs-autogear divergence at
  partial crit rates is accepted — long-run frequencies are identical).
- **Condition plumbing:** `ConditionContext` gains optional `roundCrit?: boolean`.
  `evaluateCondition('self-crit')` returns `roundCrit ? 1 : 0` when set, else the
  existing `effectiveCritRate / 100`.
- **Two-tier semantics (the chicken-and-egg):** `roundCrit` needs final
  `effectiveCrit`, which needs modifiers, which can be self-crit-gated. Resolution
  unchanged from today (`dpsSimulator.ts:341`): `modifierCtx` keeps the
  probability-based pre-modifier crit estimate (`roundCrit` unset); the payload ctx
  built after the fold-in carries the binary outcome. The imprecise tier
  (self-crit-gated crit modifiers) is unpopulated in the 147-ship data.
- **Downstream consumers** of binary `roundCrit`: self-crit payload gates,
  crit-conditional damage scaling, crit-gated charge gains (`+amount` on crit
  rounds — lumpier but deterministic cadence, same average), and the crit-power
  extend (skip when crit-gated and `!roundCrit`, else `extendChanceGate(critPowerFactor)`).

### 3. Ordered hard gate for payload abilities

New function in `src/utils/abilities/applyAbilities.ts`:

```ts
export function gateFiringAbilities(
    skill: Skill | undefined,
    baseCtx: ConditionContext
): { gatedSkill: Skill | undefined; ctxFor: Map<string, ConditionContext> };
```

Walks the firing skill's abilities **in array order**, maintaining an overlay on
`enemyDebuffCount`:

- For each ability: `conditionsMet(ability.conditions, overlaidCtx)` — fail → the
  ability is dropped from `gatedSkill`; pass → kept.
- A kept `dot` ability increments the overlay by 1 (one more debuff **entry**,
  matching the sim's entry-count semantics), so **later** abilities in the same
  cast see it. "Inflicts 2 Corrosion. Deals 90% damage +30% per debuff" resolves
  like the game.
- `ctxFor[abilityId]` records each ability's positional ctx so `scaledBonus` uses
  counts *as of that ability's position*, not the round snapshot.

All existing extractors (`damageInputsFromSkill`, `secondaryFromSkill`,
`dotsFromSkill`, `detonationsFromSkill`, `accumulatorsFromSkill`,
`chargeAbilitiesFromSkill`) run **unchanged** on `gatedSkill`. The charge loop's
own `conditionsMet` check becomes redundant (gating already filtered) and may be
removed.

**Invariants preserved:**

- Gate vs scaler: gating uses `conditionMet` (honors `countComparator`
  thresholds); scaling reads the raw `evaluateCondition` count off the same
  condition. One condition can do both.
- Extend-dot and modifiers keep their existing per-round gating paths (firing +
  passive slots); `gateFiringAbilities` covers the firing-skill payload types only.

**Known approximation (documented, not fixed):** `debuff` abilities travel via the
buff timeline, not the payload path, so they land before damage regardless of text
position; a damage gate written *before* its inflict still sees the timeline
debuff. Position-aware timeline debuffs are Tier-3/combat-sim scope.

### 4. `runSinglePass` round order (revised)

1. Action selection (active/charged), charge consumption.
2. Timeline buffs → buff totals.
3. `debuffLandingGate(debuffLandingChance)` → `roundDebuffLanded`; landed/resisted
   enemy debuffs.
4. `modifierCtx` (pre-modifier crit estimate, probability self-crit — unchanged) +
   derived `enemyHpPct` (§5).
5. Modifier fold-in → final effective stats.
6. `roundCrit` decision (firing stream's crit gate; `noCrit` rule).
7. Payload ctx: binary self-crit + `enemyHpPct`.
8. **Ordered gate pass** (`gateFiringAbilities`) → extraction from `gatedSkill`.
9. Existing steps unchanged in sequence: extend-dot (2.9) → detonate (2.95) →
   direct damage → charge gains (active rounds) → DoT application (3) →
   accumulate-detonate (3b) → ticks (4/5) → expiry → bookkeeping.

Ability extraction moves from the top of the round to step 8 (it currently runs
before the ctx exists). `effectiveMultiplier`/`secondary`/`dotsConfig` are first
consumed after step 8, so the move is safe.

### 5. Derived enemy HP

`buildRoundContext` input gains the derived value:

```ts
enemyHpPct = enemyHp > 0
    ? Math.max(0, 100 * (1 - cumulativeDamage / enemyHp))
    : 100;
```

computed from cumulative damage **through the previous round**, fed to both
`modifierCtx` and the payload ctx. `selfHpPct` stays 100 (the sim takes no
damage): "at full HP" self-gates pass; "self below X%" needs the manual toggle —
unchanged. Execute gates ("below 50% HP") switch on mid-sim and are visible in the
round chart. Once cumulative damage exceeds `enemyHp` the pct floors at 0 — the
DPS sim deliberately keeps hitting the "dead" dummy.

### 6. Parser: emit abilities in skill-text order (Tier 1)

`abilitiesFromText` (in `buildShipAbilities.ts`) collects `{ability, textPos}`
pairs and sorts by `textPos` before emitting, instead of pushing per detector
category:

- Each detector (`parseSkillDamage`, `parseSecondaryDamage`, `parseExtendDoT`,
  `parseDetonateDoT`, `parseChargeGain`, `parseModifiers`, …) additionally
  surfaces its regex `match.index` into the assembler.
- DoT and buff/debuff auto-fill abilities take the position of their
  `<unit-skill>` tag in the row text (first occurrence of the buff name);
  positionless sources sort to end-of-list.
- Result: `buildShipAbilities` output order ≈ the order effects appear in skill
  text — the game's execution order — which the ordered gate pass (§3) then honors.

### 7. Editor: manual reorder

`AbilityCard` headers gain up/down arrow buttons (`Button variant="link"
size="xs"`, existing icons); `SkillEditorModal`/`SkillSlotList` thread
`moveAbility(slot, index, direction)`. No drag-and-drop. The list already renders
in array order; order is now sim-meaningful.

### 8. UI surfacing

- `RoundData` gains `didCrit: boolean`; the chart tooltip (`DPSRoundChart.tsx`)
  badges crit rounds.
- The "Charged skill fires: every N rounds" summary derives cadence from the
  actual charged rounds in `roundData` (crit-gated charge gains make cadence
  potentially irregular); irregular cadence renders as e.g. "rounds 3, 5, 8 …" or
  "every ~N rounds".

## Error handling / edge cases

- `enemyHp <= 0` or missing → `enemyHpPct` stays 100 (no execute gating).
- All payload abilities gated off on a round → multiplier 0, zero damage round
  (valid; chart shows it).
- `hasChargedSkill` still derives from the **ungated** charged damage multiplier
  (a conditionally-gated charged skill must still bank/fire charges).
- Rates outside [0,1] clamp inside `makeRateGate`.
- Accumulators are per-`runSinglePass` locals — no cross-call state.
- Flat-input path (`flatInputToAbilities`) flows through the same engine —
  flat ↔ explicit-abilities equivalence is preserved by construction.

## Testing

- **`rateAccumulator.test.ts`**: exact frequency (0.7 over 10 → 7, evenly
  spaced), rate 1 → always, rate 0 → never, varying rates, float drift
  (0.1 × 10 → exactly 1), clamping.
- **`gateFiringAbilities`**: drops failing abilities; overlay makes a fresh dot
  visible to later gates but not earlier ones; threshold comparators honored;
  `ctxFor` positional scaling counts.
- **`dpsSimulator`**: crit schedule (`crit:50, critDamage:100` → exact alternating
  pattern, assert per-round numbers + `didCrit`); per-stream non-aliasing (50%
  crit + charged-every-2 → charged hits crit half the time); `noCrit` consumes no
  crit charge; execute gate flips on at the computed round; gated-off
  dot/detonate/secondary contribute zero; deterministic partial
  `debuffLandingChance` (0.5 → exact landing pattern).
- **Suite audit**: tests at intermediate crit rates re-pinned to the schedule
  model; `crit:100` / `crit:0` conventions produce unchanged numbers by
  construction; flat ↔ abilities equivalence test stays green.
- **Parser**: emission order matches text order for a multi-effect skill from
  `docs/ship-skills.csv` (e.g. Corrosion-then-scaled-damage).

## Documentation & changelog

- `DocumentationPage.tsx` DPS section + in-page "About the Simulation" prose:
  deterministic per-round crit schedule, live condition gates on damage/DoT/
  detonation abilities, enemy HP declines with damage dealt.
- `UNRELEASED_CHANGES` in `src/constants/changelog.ts` before the feat commit.
- `docs/skill-model-coverage.md`: flip the shipped matrix rows (payload gates →
  live, hp-threshold → derived, zero-RNG note); strike backlog items #1, #2, #6;
  note Tier 1+2 ordering shipped, Tier 3 deferred.

## Decision log

| Decision | Choice | Alternatives rejected |
|---|---|---|
| Crit model | Per-stream deterministic accumulators | Single-pass RNG (recompute jitter), multi-pass average (slow, blurs cadence, converges to EV anyway), single global accumulator (cadence aliasing with charge cycle) |
| HP gates | Derive enemy HP% from cumulative damage | Neutralize derivable HP gates (keeps overcount), static HP% setting (constant, gates never flip) |
| Gate scope | All five payload types | Damage-only (leaves editor half-honest) |
| Remaining RNG | Determinize (landing + extend chance) | Keep `Math.random` (recompute wobble persists) |
| Gate placement | Central ordered `gateFiringAbilities` filter | ctx threaded into each extractor (signature churn, repeated logic), call-site checks (scattered) |
| Ordering depth | Tier 1 (text-order emission + editor reorder) + Tier 2 (order-aware gating overlay) | Tier 3 sequential execution (combat-sim scope) |
| Self-crit-gated modifiers | Keep pre-modifier probability estimate | Fixed-point iteration over the crit circle (complexity for an unpopulated case) |
