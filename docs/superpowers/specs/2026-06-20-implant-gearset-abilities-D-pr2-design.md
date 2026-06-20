# Combat Realism Epic — Sub-project D, PR2: Conditional Outgoing-Damage Implants (Design)

**Date:** 2026-06-20
**Sub-project:** D (new ability sources: implants + gear-set skills), second PR.
**Parent spec:** `docs/superpowers/specs/2026-06-20-implant-gearset-abilities-D-design.md`.
**Builds on:** D-PR1 (`feat/combat-d-implant-gearset`) — `buildEquipmentAbilities` registry,
`buildShipAbilitiesWithEquipment` passive-slot merge, `procChance` machinery, equipment coverage tracker.
**Branch:** `feat/combat-d-pr2-conditional-damage`, stacked on the D-PR1 tip.
**Status:** design (brainstorm complete, user-approved through all sections).

## 1. Context

D-PR1 shipped the equipment-ability **source layer** (a registry-based `buildEquipmentAbilities` merged
into the passive slot via `buildShipAbilitiesWithEquipment`) plus the `procChance` proc-gate machinery,
and lit up the first two effects (Leech gear set + Bloodthirst implant — both heals). The DPS calculator
page was deliberately **not** wired in D-PR1 because those effects are heals that don't affect DPS.

D-PR2 lights up the **conditional outgoing-damage** bucket from the parent spec (§5.2) — the implants
that increase a unit's outgoing direct damage under a condition:

- **Intrusion** (`src/constants/implants.ts`) — "Increases damage dealt by X% for **each debuff on the
  target** when directly damaging them." X = 1/2/3/4/5 by rarity (common/uncommon/rare/epic/legendary).
- **Arcane Siege** — "Increases outgoing Direct Damage by X% **while shielded**." X = 3/6/10/15/20.
- **Warpstrike** — "Increases damage by X% when directly damaging an enemy **while debuffed**, and
  reduces a random active debuff's duration by 1 turn." X = 1/2/3/4/5. (Only the damage half is in
  scope; see §6.)

Because these are outgoing damage, D-PR2 also **wires the DPS calculator page** to consume equipment
abilities (the wiring D-PR1 skipped).

### 1.1 Key finding that reshaped this PR

The sub-project-D spec and the prior working assumption framed the core work as *"wire passive
conditional-scaling into `conditionalBonusPct`"* — i.e. extend the additive multiplier-points fold in
`playerTurn.ts` (`conditionalBonusPct`, ~line 1210) to read passive-slot scaling, which today it does
not (it reads only the firing skill's damage ability).

A code-read showed a **simpler and more faithful** path already exists. `modifierTotalsFromAbilities`
(`src/utils/abilities/applyAbilities.ts:22-76`):

- already iterates **all** abilities passed to it, and `playerTurn.ts:1094-1097` already passes the
  **passive slot** (`modifierAbilities = [...firing, ...passive]`);
- already **gates** each ability by `conditionsMet(gateConditions(ability), ctx)` (line 41);
- already supports **both** a flat `config.value` **and** per-count `scaling` via
  `value + (scaling ? scaledBonus(ability, ctx) : 0)` (line 49);
- routes channel `outgoingDamage` into `dmgStats.totals.outgoingDamageBuff`, which
  `playerTurn.ts` applies as the **multiplicative** factor `(1 + outgoingDamageBuff/100)` inside
  `nonCritFactor` — and that factor scopes naturally to **direct** damage (DoT damage is computed on a
  separate path).

So these three effects can be modeled as passive `modifier` abilities on channel `outgoingDamage`, and
the engine **already folds them** — no `conditionalBonusPct` surgery. This is also more faithful: the
implants literally say "increase outgoing/dealt damage by X%" (multiplicative), whereas
`conditionalBonusPct` adds flat percentage-points onto the skill multiplier.

The **only** genuinely-new engine primitive is a `self-shield` condition subject for Arcane Siege (§4).

## 2. Goals / non-goals

**Goals**

- Add Intrusion, Arcane Siege, and Warpstrike (damage half) as `buildEquipmentAbilities` registry
  entries that ride the existing `outgoingDamage` modifier fold.
- Add the one new condition primitive (`self-shield`) Arcane Siege requires.
- Wire the DPS calculator page to consume equipment abilities.
- Keep all existing DPS / battle-sim / healing goldens **byte-identical**.

**Non-goals (deferred, with owner)**

- Warpstrike's "reduce a random active debuff's duration by 1 turn" half → **deferred** (self-debuff-
  mitigation / cleanse-family; not in this PR's machinery). See §6.
- Giant Slayer / Menace / Insidiousness / Voidfire Catalyst (the rest of the parent spec's
  "conditional outgoing dmg" row) → **later D PRs**. Menace + Giant Slayer need in-flight reactive
  damage amplification + a `target-higher-attack` condition (noted in D-PR1) and don't fit the passive
  modifier fold.
- Making shields actually *appear* in DPS/battle-sim (shield grants) → **sub-project H**. Arcane Siege
  is therefore dormant in integration until H lands; it is unit-tested in isolation now (§5).
- No autogear/scoring changes (`arcaneSiegeUtils` stays as is — that models the same implant only inside
  autogear scoring, independent of the combat engine).

## 3. Effect models (registry entries)

All three are added to `IMPLANT_ABILITIES` in `src/utils/abilities/buildEquipmentAbilities.ts`, mirroring
the D-PR1 per-rarity-builder pattern. Each returns a single `Ability` (minus `id`) of `type: 'modifier'`,
`channel: 'outgoingDamage'`, `target: 'self'`, `trigger: 'passive'`, `autoFilled: true`. Per-rarity
values are baked from `implants.ts`; a rarity absent from the value map yields `undefined` (skip).

### 3.1 Intrusion — per-count scaling

```
{
  type: 'modifier',
  target: 'self',
  trigger: 'passive',
  conditions: [{ subject: 'enemy-debuff', derivable: true }],
  scaling: { conditionIndex: 0, perUnit: X },   // X = 1/2/3/4/5
  config: { type: 'modifier', channel: 'outgoingDamage', value: 0, isMultiplicative: false },
  autoFilled: true,
}
```

- `enemy-debuff` is a bare scaling-source condition (no `countComparator`) → `gateConditions` removes it
  from the gate (it scales, never gates), so the modifier always folds and contributes
  `scaledBonus = perUnit × enemyDebuffCount`. Zero debuffs → +0%. `enemyDebuffCount` is already in
  `modifierCtx` (`landedEnemyDebuffCount`, `playerTurn.ts:1080`).
- `isMultiplicative: false` matches the channel convention — `modifierTotalsFromAbilities` ignores the
  flag and sums into the additive `outgoingDamageBuff` total, which is then applied multiplicatively as
  `(1 + outgoingDamageBuff/100)`. (This is the same treatment every existing `outgoingDamage` modifier
  already gets.)

### 3.2 Arcane Siege — flat, gated on self-shield

```
{
  type: 'modifier',
  target: 'self',
  trigger: 'passive',
  conditions: [{ subject: 'self-shield', derivable: true }],
  config: { type: 'modifier', channel: 'outgoingDamage', value: X, isMultiplicative: false },
  autoFilled: true,
}
```

- X = 3/6/10/15/20. No `scaling`; a flat `value` gated by the self-shield condition.
- `self-shield` is **not** a bare scaling source → `gateConditions` keeps it → the +X% applies only when
  `conditionsMet` (the unit is shielded). Dormant until shields exist in the path (§2).

### 3.3 Warpstrike (damage half) — flat, gated on self-debuff

```
{
  type: 'modifier',
  target: 'self',
  trigger: 'passive',
  conditions: [{ subject: 'self-debuff', derivable: true, countComparator: 'gte', countThreshold: 1 }],
  config: { type: 'modifier', channel: 'outgoingDamage', value: X, isMultiplicative: false },
  autoFilled: true,
}
```

- X = 1/2/3/4/5. A flat `value` gated on the unit having ≥1 debuff. Using a flat value + a `gte 1` gate
  (rather than `scaling` on `self-debuff`) is deliberate: `scaledBonus` always uses the **raw** count,
  so scaling on `self-debuff` would over-apply for a unit carrying multiple debuffs. The flat-value +
  gate gives a single +X% whenever debuffed. `selfDebuffNames` is already in `modifierCtx`
  (`playerTurn.ts:1091`).

## 4. New engine primitive — `self-shield` condition

The minimal additive change required for Arcane Siege:

1. **`ConditionSubject` union** (`src/types/abilities.ts`) — add `'self-shield'`.
2. **`ConditionContext`** (`src/utils/abilities/evaluateConditions.ts`) — add `selfShielded?: boolean`.
3. **`evaluateCondition`** — `case 'self-shield': return ctx.selfShielded ? 1 : 0;` (binary, derivable).
4. **`buildRoundContext`** — accept a `selfShielded` input and set it on the context it builds.
5. **`playerTurn.ts`** — thread `selfShielded: actor.shieldPool > 0` into the `buildRoundContext` call
   that produces `modifierCtx` (`~line 1078`). `actor` is the acting `CombatActor`; `shieldPool` exists
   on it (`state.ts:104`, init 0) and reflects the live remaining shield at attack time.

Emitted conditions use `derivable: true` — a `derivable: false` condition is treated as always-met
(`evaluateConditions.ts`), which would defeat the gate. (Mirrors the `target-repaired-this-round`
pattern.)

This is purely additive: no existing ability carries `subject: 'self-shield'`, and `selfShielded`
defaults falsy, so every existing fold is unchanged.

## 5. DPS calculator page wiring

`DPSCalculatorPage.tsx` already holds `getGearPiece` from `useInventory()` (line 39). Swap its three
`buildShipAbilities(ship)` call sites (lines 73, 384, 440) to
`buildShipAbilitiesWithEquipment(ship, getGearPiece)`, exactly mirroring the HealingCalculatorPage sites
D-PR1 wired. This is what makes Intrusion/Warpstrike actually affect a DPS run. (`battleSimulator`
already routes equipment abilities since D-PR1.)

## 6. Deferred: Warpstrike's debuff-duration reduction

Warpstrike also "reduces a random active debuff's duration by 1 turn" on the wielder. This is a
self-debuff-mitigation effect (cleanse-family), not an outgoing-damage modifier, and would pull in
machinery this PR otherwise doesn't touch (selecting/decrementing a random standing self-debuff at
attack time). It is **deferred** and noted in-code on the Warpstrike registry entry so the omission is
explicit. The damage half is the faithful, high-value part for a DPS/combat model.

## 7. Testing & invariants

- **Unit — registry entries** (`buildEquipmentAbilities.test.ts`): each implant at each rarity emits a
  single `modifier`/`outgoingDamage` ability with the expected `value`, `scaling`, and `conditions`;
  unsupported rarity → none; graceful skip on missing pieces (already covered by the D-PR1 harness).
- **Unit — `self-shield`** (`evaluateConditions` test): returns 1 when `selfShielded` true, 0 otherwise;
  an Arcane Siege modifier folds +X% only when the context is shielded.
- **Integration**: a ship with Intrusion attacking an enemy carrying N debuffs deals
  `× (1 + X·N/100)` of its no-implant direct damage; a ship with Warpstrike deals `× (1 + X/100)` only
  while itself debuffed, and unmodified otherwise.
- **Coverage tracker** (`equipmentCoverage.test.ts`): implemented implants set updated to
  `BLOODTHIRST, INTRUSION, ARCANE_SIEGE, WARPSTRIKE` (in `IMPLANTS` declaration order), and the
  per-implant "produces 0 abilities" guard for those three is replaced with positive assertions.
- **Load-bearing byte-identical invariant:** existing DPS / battle-sim / healing goldens stay
  **byte-identical**. The `self-shield` subject + `selfShielded` ctx field are additive, and equipment
  abilities only run where `getGearPiece` is threaded. **First plan step (do before any wiring):** grep
  the DPS/battle-sim/healing fixtures for ships carrying Intrusion / Arcane Siege / Warpstrike implants
  (expected: none). Confirm the invariant is empty before it can silently break; if a fixture *does*
  carry one, neutralize it or deliberately audit the churn (never `vitest -u`).

## 8. Open questions for the plan

1. Exact `IMPLANTS` declaration order for the coverage-tracker `implementedImplants` assertion (read it
   at plan time; the test filters `Object.keys(IMPLANTS)`).
2. Whether `buildRoundContext` is called in more than one place that should carry `selfShielded` (only
   the `modifierCtx` site needs it for these effects; thread minimally, default falsy elsewhere).
3. Confirm `actor.shieldPool` is in scope and live at the `modifierCtx` build site in every `runPlayerTurn`
   entry (player/team/enemy) — it is the same team-agnostic function, but verify the param plumbing.
