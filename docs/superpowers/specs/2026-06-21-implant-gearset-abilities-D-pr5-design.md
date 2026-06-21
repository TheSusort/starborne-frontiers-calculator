# Combat Realism Epic — Sub-project D, PR5: Reactive heal/leech (Design)

**Date:** 2026-06-21
**Sub-project:** D (implant + gear-set abilities), PR5.
**Parent spec:** `docs/superpowers/specs/2026-06-20-implant-gearset-abilities-D-design.md` (§5.2 "reactive heal/leech" row).
**Stacks on:** D-PR4 (`feat/combat-d-pr4-outgoing-amplification`, tip `29bafb64`, PR #132). Branch
`feat/combat-d-pr5-reactive-heal`; retarget to `main` once the D stack merges.
**Status:** design (brainstorm complete, user-approved through scope + game-rule decisions).

## 1. Context

D-PR1 shipped Bloodthirst + the Leech set (the on-crit / standing leech effects) and built the reactive
heal executor (basis cases attack/defense/target-hp/maxHp/damage-dealt). D-PR4 generalized the reactive
`damage` executor to honor `procChance` (via `passesProcChanceGate`) and added the `rollOutgoingProc`
per-(owner,ability) gate closure. This PR lights up three more of the §5.2 "reactive heal/leech" row:

- **Second Wind** — "Upon receiving critical direct damage, there is a 7–16% chance to repair 10% of
  this unit's max HP." Reactive self-heal triggered by *receiving* a critical hit.
- **Nourishment** — "Increases repair by 10–30% when targeting an ally with lower HP." Deterministic
  heal-*cast* amplifier, gated on the heal target's HP relative to the caster.
- **Vivacious Repair** — "When repairing an ally with less than 25% HP, there is a 21–32% chance to
  double the repair." Proc heal-*cast* amplifier, gated on the target's absolute HP.

**Exuberance** ("when repaired, chance to increase that repair") is the fourth effect in the row but is
**deferred** — it is heal-*received* amplification, which has no existing seam (no `on-heal-received`
trigger, no post-heal hook). It is a distinct, higher-risk mechanism and gets its own PR (D-PR6), the
way Voidfire Catalyst was deferred from D-PR4.

Reconnaissance findings that shape this design:
- The reactive heal executor (`triggers.ts`) already supports `basis: 'hp'` (= caster max HP) and now
  honors `procChance`. The on-attacked listener already supports `triggerCritFilter: 'crit'`. So Second
  Wind rides existing machinery entirely.
- The cast-heal fold (`playerTurn.ts`, the heal block) multiplies `raw` by
  `healModifier × outgoingHealBuff × incomingHealBuff(recipient)`. The conditional `modifier` fold
  (`modifierTotalsFromAbilities`) **ignores heal channels** ("outgoingHeal has no DPS bucket — ignore"),
  and the cast heal has **no conditional outgoing-heal amplifier** and **no proc**. So Nourishment +
  Vivacious need a new **heal-cast amplification primitive** (the heal mirror of D-PR4's
  `outgoingEffects`).
- Both `targetHpPct` (recipient) and `selfHpPct` (caster) already exist in the condition context
  (`ConditionContext` / `roundContext.ts`), threaded from `selfHpPctArg`/`targetHpPctArg` into
  `runPlayerTurn`.

## 2. Goals / non-goals

**Goals**

- Light up **Second Wind, Nourishment, Vivacious Repair** in the combat engine.
- A reusable **heal-cast amplification primitive** — a per-recipient multiplier on a cast repair, gated
  by heal-target HP conditions, deterministic (Nourishment) or proc'd (Vivacious) — the heal-side
  analogue of D-PR4's `outgoingAmplificationForHit`.
- Keep all DPS / healing / battle-sim **goldens byte-identical** (no fixture carries these implants; the
  primitive returns 0 at its defaults).

**Non-goals**

- **Exuberance** (heal-received amplification) → D-PR6.
- No UI / autogear / scoring changes.
- No change to the deterministic proc model — heal-amp procs ride the same `rollOutgoingProc` gate
  closure D-PR4 added (a generic `(abilityId, chance) ⇒ bool` over the combat-lifetime
  `procChanceGates` map).

## 3. Architecture

### 3.1 Second Wind — rides existing machinery (registry entry only)

Mirror Bloodthirst's `IMPLANT_ABILITIES` entry, with:

```ts
SECOND_WIND: (rarity) => {
  const pc = SECOND_WIND_PROC[rarity];   // uncommon 0.07 / rare 0.09 / epic 0.12 / legendary 0.16
  if (pc === undefined) return undefined;
  return {
    type: 'heal',
    target: 'self',
    trigger: 'on-attacked',
    triggerCritFilter: 'crit',            // fires only on a critical hit received
    conditions: [],
    procChance: pc,
    config: { type: 'heal', pct: 10, basis: 'hp' },  // 10% of caster max HP
    autoFilled: true,
  };
}
```

- The `on-attacked` listener already self-scopes (`e.targetId === ownerId`) and applies
  `triggerCritFilter` against the hit's `didCrit`. The reactive heal executor computes `basis: 'hp'` as
  the owner's effective max HP, rolls `procChance` via `passesProcChanceGate`, and credits/applies the
  repair. No new engine code.
- **Known limitation (documented, pre-existing healing-model behavior):** in single-target
  healing-calculator mode, a self-heal from a non-heal-target actor credits gross repair but only
  *restores HP* if that actor is the heal target. In the battle simulator (per-actor pools, post-E5) it
  restores the actor's own HP. Accepted; Second Wind on the tank (the usual heal target) works fully.

### 3.2 Heal-cast amplification primitive — Nourishment + Vivacious Repair

A new pure module **`src/utils/combat/healAmplification.ts`** (the heal-side mirror of
`outgoingEffects.ts`):

```ts
// types/abilities.ts additions
export type HealAmpCondition = 'target-hp-below-self' | 'target-below-25';
export interface HealAmpContext {
  targetHpPct: number;   // the heal recipient's HP% at cast time
  selfHpPct: number;     // the caster's HP% at cast time
}
// new AbilityConfig member
{ type: 'heal-amplification'; condition: HealAmpCondition; ampPct: number; procChance?: number }

// healAmplification.ts
export function healAmplificationForCast(
  casterAbilities: Ability[],
  ctx: HealAmpContext,
  rollProc: (abilityId: string, chance: number) => boolean,
): number   // summed amplification % for this cast on this recipient (0 when nothing applies)
```

Semantics (mirror `outgoingAmplificationForHit`): for each `heal-amplification` ability whose condition
is met, fire iff `procChance` is absent (deterministic) OR `rollProc(id, procChance)` returns true; on
firing, add `ampPct`. Eligibility gates the proc roll.

- `conditionMet`: `'target-hp-below-self'` → `ctx.targetHpPct < ctx.selfHpPct`; `'target-below-25'` →
  `ctx.targetHpPct < 25`.
- **Deterministic vs proc:** an ability with no `procChance` always fires when gated (Nourishment); one
  with `procChance` rolls the gate (Vivacious). `healAmplificationForCast` treats `procChance === undefined`
  as "always" (no roll) — so deterministic effects never touch a gate.

Registry entries (`buildEquipmentAbilities.ts`), `trigger: 'on-cast'` / `conditions: []` inert (the live
condition lives in `config`, evaluated per-cast by the evaluator — mirrors D-PR4):

| Implant | condition | ampPct | procChance |
|---|---|---|---|
| **Nourishment** | `target-hp-below-self` | 10/15/20/30 (uncommon/rare/epic/legendary) | — (deterministic) |
| **Vivacious Repair** | `target-below-25` | 100 (double) | 0.21/0.26/0.32 (rare/epic/legendary) |

### 3.3 Cast-heal wiring (`playerTurn.ts`)

In the cast-heal fold (the heal block), after `raw` is computed for a recipient with the existing
`healModifier × outgoingHealBuff × incomingHealBuff` factors, apply the amplification multiplicatively:

```ts
const healAmpAbilities = (passiveSkill?.abilities ?? []).filter(
  (a) => a.config.type === 'heal-amplification'
);
// per recipient `rid`, with its targetHpPct:
const healAmpPct = healAmpAbilities.length > 0 && rollOutgoingProc
  ? healAmplificationForCast(healAmpAbilities,
      { targetHpPct: recipientHpPctFor(rid), selfHpPct: selfHpPctArg }, rollOutgoingProc)
  : 0;
raw *= 1 + healAmpPct / 100;
```

- Guarded by `healAmpAbilities.length > 0 && rollOutgoingProc` → when no heal-amp ability exists the
  fold is untouched → **byte-identical**.
- Reuses `args.rollOutgoingProc` (D-PR4) verbatim — a generic per-(owner,ability) gate roller; heal-amp
  ability ids are distinct from any outgoing-amp ids, so gates never collide.
- `selfHpPct` = the caster's HP% (`selfHpPctArg`); `targetHpPct` = the recipient's HP% (the per-recipient
  value the cast fold already resolves for the recipient's incoming-heal / condition context).
- Applies to the cast repair only (reactive heals are a separate executor; Nourishment/Vivacious are
  about the *caster's* repair output).

### 3.4 Condition context

`target-hp-below-self` consumes both `targetHpPct` and `selfHpPct`, which already exist in
`ConditionContext`. The `HealAmpCondition` is kept **local to the heal-amp evaluator** (not added as a
global `ConditionSubject`), mirroring how D-PR4's `OutgoingCondition` lived with `outgoingEffects` — the
comparison is specific to the heal-cast seam.

## 4. Integration risks to verify FIRST (plan step 1)

1. **`selfHpPctArg` must be the caster's live HP% in the cast-heal path.** It defaults to 100. If the
   engine does not thread the acting healer's real HP% into `runPlayerTurn` for the healing/sim paths,
   `target-hp-below-self` degenerates (always true when the caster reads 100% and the target is below).
   Verify what `selfHpPctArg` carries at the heal-cast sites BEFORE relying on the comparison; if it is
   not the caster's live HP%, that wiring is part of this PR (or Nourishment's condition must be
   reconsidered). **Characterize this before writing the plan's Nourishment task.**
2. **`targetHpPct` per recipient at cast time** — confirm the cast fold can supply each recipient's HP%
   to the evaluator (single-target heal: the bound heal target; multi-recipient: per recipient). For a
   self-cast, `targetHpPct === selfHpPct` → `target-hp-below-self` is false (correct: not healing a
   lower-HP ally).
3. **Second Wind HP-restore routing** for a non-heal-target actor — confirm/accept the §3.1 limitation.

## 5. Effect coverage / corpus

- Coverage tracker `equipmentCoverage.test.ts`: implemented-implants set gains `NOURISHMENT`,
  `SECOND_WIND`, `VIVACIOUS_REPAIR`. Exuberance stays in the unimplemented loop (deferred — keeps it
  flagged, not silently passing).

## 6. Testing & invariants

- **Unit — `healAmplificationForCast`:** each condition fires only when its HP gate is met; deterministic
  (no procChance) always fires when gated; proc'd respects `rollProc`; eligibility gates the proc roll;
  additive sum across abilities.
- **Unit — `buildEquipmentAbilities`:** Second Wind → reactive `heal` on `on-attacked`+crit-filter, basis
  `hp`, pct 10, per-rarity procChance; Nourishment → `heal-amplification` target-hp-below-self, per-rarity
  ampPct, no procChance; Vivacious → `heal-amplification` target-below-25, ampPct 100, per-rarity
  procChance; no-common/uncommon variants skipped where the source lacks them.
- **Integration (healing-mode `runCombat`):** Nourishment boosts a cast repair when the target's HP% is
  below the caster's and not otherwise; Vivacious doubles a repair on a <25% target at its gated
  frequency (and 0 above 25%); Second Wind repairs the receiver at its gated frequency when it takes a
  critical hit (and not on a non-crit hit).
- **Load-bearing invariant:** all DPS / healing / battle-sim goldens **byte-identical** (plan step 1 =
  fixture audit for Second Wind / Nourishment / Vivacious; the cast-heal fold and reactive executor are
  inert at defaults). Never `vitest -u`.
- `audit:skills` unchanged.

## 7. Open questions for the plan

1. The exact `selfHpPctArg` provenance at each cast-heal site (risk #1) — characterize and, if needed,
   scope the plumbing.
2. The exact per-recipient `targetHpPct` accessor in the cast-heal fold to feed the evaluator.
3. Whether `healAmplificationForCast` belongs in its own module or alongside `outgoingEffects` (default:
   own module `healAmplification.ts` for focus; they share only the `rollProc` shape).
