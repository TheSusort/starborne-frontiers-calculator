# Skill Model Coverage: Parser/Editor vs DPS Simulation

> Living document. Last audited **2026-06-03** on branch `feat/skill-ability-editor`.
> Updated **2026-06-03** after the deterministic-crit + hard-gating ship (spec 2026-06-03-deterministic-crit-and-hard-gating-design.md).
> Purpose: a single source of truth for what the ability model can *express*, what the
> parser *auto-fills*, what the editor *exposes*, and what the DPS sim actually
> *consumes* — so new sim features can be introduced in a structured, prioritized way.

**Pipeline:** `skillTextParser.ts` + `buildShipAbilities.ts` (auto-fill) → `ShipSkills`
(`src/types/abilities.ts`) → editor (`src/components/skills/*`) → sim inputs
(`configToSimInputs.ts`, `buffAbilityConverters.ts`) → `dpsSimulator.ts` +
`applyAbilities.ts` / `evaluateConditions.ts` / `roundContext.ts` / `buffTimeline.ts`.

---

## 1. Ability-type matrix

Legend: ✅ full, ⚠️ partial (see notes), ❌ none.

| Type | Parser auto-fills | Editor fields | Sim consumes | Conditions gate in sim | Scaling in sim | Slots consulted by sim |
|---|---|---|---|---|---|---|
| `damage` | ✅ multiplier, `hits`, `noCrit`, scaling+cap, hp-threshold & enemy-effect & ally-gates as conditions | ✅ all incl. scaling | ✅ | ✅ `gateFiringAbilities` gates whole ability; `scaledBonus` scaling also gates zero-count conditions | ✅ `scaledBonus` on `conditions[scaling.conditionIndex]` | firing only |
| `additional-damage` | ✅ `parseSecondaryDamage` (hp/def %) | ✅ | ✅ | ✅ `gateFiringAbilities` (`applyAbilities.ts`) | ❌ | firing only |
| `modifier` | ✅ `parseModifiers` (outgoingDamage, critDamage, defPen flat + for-each scaling) | ⚠️ all except `isMultiplicative` (hidden, no-op) | ✅ | ✅ per-round, full `conditionsMet` (`applyAbilities.ts:37`) | ✅ | **firing + passive** |
| `buff` | ✅ via `buildSkillBuffAutoFill` + `detectGrantConditions` | ✅ (stacks, duration; `stackTrigger`/`maxStacks` come from picker, not directly editable) | ✅ via static conversion → `SelectedGameBuff` → `computeBuffTimeline` | ⚠️ **static gate only** at conversion time; never re-evaluated per round (`buffAbilityConverters.ts:117`) | stacks (accumulating via `stackTrigger`) | all slots (routed by `skillSource`) |
| `debuff` | ✅ same + `application` (inflict/apply) | ✅ | ✅ (landing roll: hacking vs security for inflict; affinity for apply) | ⚠️ static gate only | stacks | all slots |
| `dot` | ✅ `buildDoTAutoFill` (active/charged slots only — never passive) | ✅ (duration finite only) | ✅ Step 3, gated by hacking landing roll | ✅ `gateFiringAbilities` (`dotsFromSkill`) | ❌ | firing only |
| `extend-dot` | ✅ `parseExtendDoT` + `parseCritPowerExtend` | ✅ | ✅ Step 2.9 (corrosion+inferno, not bombs) | ✅ per-round `conditionsMet` (`dpsSimulator.ts:471`) + `chanceFromCritPower` probability | — | **firing + passive** (Valerian fix) |
| `detonate-dot` | ✅ `parseDetonateDoT` | ✅ | ✅ Step 2.95 | ✅ `gateFiringAbilities` | ❌ | firing only |
| `accumulate-detonate` | ⚠️ hardcoded effect names (Echoing Burst) | ✅ | ✅ Step 3b/6b (gated only by DoT landing roll) | ✅ `gateFiringAbilities` | ❌ | firing only |
| `charge` | ✅ `parseChargeGain` + condition classifier | ✅ | ✅ active rounds only, capped at `chargeCount` | ✅ per-round `conditionsMet` (`dpsSimulator.ts:433`); un-thresholded conditions also scale by expected value | expected-value via `evaluateCondition` | firing only |
| `heal` | ❌ never emitted | ❌ **type pickable but NO config fields rendered** (label-only in `AbilityCard`) | ❌ **not consumed** | — | — | — |
| `shield` | ❌ | ❌ label-only | ❌ not consumed | — | — | — |
| `cleanse` / `purge` | ❌ | ❌ label-only | ❌ not consumed | — | — | — |
| `control` | ❌ (Taunt/Provoke parse as buff/debuff *conditions*, not control abilities) | ❌ label-only | ❌ not consumed | — | — | — |

### Headline gaps (parsed + editable, but sim silently ignores)

1. **heal/shield/cleanse/purge/control** — exist in the model and type picker, have no
   editor fields and no sim consumption. (Expected: these are the Healing-calc /
   combat-sim seams.)

---

## 2. Condition-subject matrix

**The sim is zero-RNG.** All probabilistic outcomes — crits, debuff/DoT landing, DoT
extension chances — use deterministic fractional-accumulator schedules. Identical inputs
always produce identical round-by-round results.

Real counts come from `buildRoundContext` (`roundContext.ts:12-39`), built twice per
round (as `modifierCtx` and `ctx`), both **before Step-3 DoT application**.
`enemyDebuffCount` = landed debuffs + DoT **entry counts** (not stacks).

| Subject | Parser emits it | Sim count source | DPS-assumption value | Effectively live in sim? |
|---|---|---|---|---|
| `always` | ✅ (charge fallback) | constant 1 | 1 | ✅ |
| `self-buff` | ✅ (Taunt-self, full-HP via status mapping) | timeline `activeSelfBuffs` names (filterable by `buffName`) | real | ✅ |
| `self-debuff` | ✅ (Provoke) | `selfDebuffNames: []` | **always 0** | ❌ manual only (`eq 0` gates pass, presence gates fail) |
| `enemy-buff` | ✅ (Taunt, Stealth, count gates) | `enemyBuffNames: []` | **always 0** | ❌ manual only |
| `enemy-debuff` | ✅ | landed debuffs + DoT entries — **name-agnostic, `buffName` ignored** (`evaluateConditions.ts:31-35`) | real | ✅ |
| `enemy-type` | ✅ (incl. negation, anyOf OR-lists) | global page-level `enemyType` | real | ✅ |
| `self-crit` | ✅ | binary per-round outcome from deterministic crit schedule (in payload ctx); `effectiveCritRate / 100` probability in modifier ctx | real | ✅ |
| `hp-threshold` | ✅ (below/above, self/enemy) | `selfHpPct` fixed 100; `enemyHpPct` derived from cumulative damage vs configured enemy HP pool — declines each round | self fixed 100, enemy live | ✅ enemy HP-threshold gates now switch mid-fight; self remains fixed |
| `adjacent-ally` | ✅ (for-each scaling) | `adjacentAllyCount` | **0** | ❌ manual only |
| `enemy-adjacent` | ✅ (charge classifier) | `enemyAdjacentCount` | **0** | ❌ manual only |
| `enemy-destroyed` | ✅ (for-each, Judge) | `enemyDestroyedCount` | **0** | ❌ manual only |
| `ally-inflicts-debuff` | ✅ | non-derivable | `manualCount` | manual toggle |
| `ally-critically-repaired` | ✅ | non-derivable | `manualCount` | manual toggle |
| `ally-crit-dot` | ✅ | non-derivable | `manualCount` | manual toggle |
| `ally-on-team` | ✅ ("if \<Name> is on the same team") | non-derivable (`buffName` holds the ally name) | `manualCount` | manual toggle |

**Gate vs scaler invariant:** `countComparator`/`countThreshold` gate only
(`conditionMet`, `evaluateConditions.ts:76-89`); `scaledBonus` always uses the **raw**
count (`evaluateConditions.ts:117-125`). One condition can be both. OR-groups: runs of
consecutive `anyOf` conditions OR together; groups AND (`evaluateConditions.ts:92-115`).

---

## 3. Field-level no-ops and partials

| Field | Status |
|---|---|
| `Ability.trigger` | Model has 6 values (`on-cast`, `start-of-round`, `on-crit`, `on-attacked`, `on-ally-destroyed`, `on-destroyed`); parser only emits `on-cast`; **editor never exposes it; sim never reads it**. The reactive-event seam. |
| `Ability.target` | Editor exposes 5 values; sim only distinguishes self-vs-enemy when routing buff/debuff conversion. `ally`/`all-allies`/`all-enemies` have no distinct sim meaning (all-allies modifiers fold into self — correct for single-ship DPS). |
| `modifier.isMultiplicative` | Deliberate no-op, documented in `applyAbilities.ts:38-40`; hidden in editor. |
| `modifier.channel` `outgoingHeal` / `incomingDamage` | No DPS bucket — silently dropped (`applyAbilities.ts:68`). |
| `buff/debuff.duration` `'recurring'` or `undefined` | Treated as permanent/always-active in the timeline (`buffTimeline.ts:52-60`). |
| `buff/debuff.maxStacks` | Only caps **accumulating** buffs; ignored otherwise. |
| `buff/debuff.stackTrigger` | Consumed by the timeline, but not directly editable (comes from the buff picker / parser). |
| `Condition.buffName` on `enemy-debuff` | Ignored — enemy-debuff count is name-agnostic by design. |
| `scaling.conditionIndex` | Model supports any index; **editor hardcodes `conditions[0]`**. |
| `ParsedBuffEffects` heal keys (`outgoingHeal`, `incomingHeal`) | Dropped by `toSimBuffs`/`toEnemyModifiers`. |
| `dot.duration` | Finite only — no `'recurring'` DoTs anywhere in the chain (matches game). |

---

## 4. Slot sourcing (the recurring gotcha)

Most per-round extractions read **only the firing skill** (active or charged slot for
that round). The always-active passive slot must be folded in explicitly per mechanic —
forgetting this silently drops passive-sourced abilities (the Valerian extend-dot bug).

| Mechanic | Sources |
|---|---|
| `modifierTotalsFromAbilities` | firing **+ passive** ✅ |
| extend-dot loop | firing **+ passive** ✅ |
| buff/debuff (via timeline `skillSource`) | all slots ✅ |
| `damageInputsFromSkill` | firing only (correct — passives don't attack) |
| `secondaryFromSkill` | firing only |
| `dotsFromSkill` | firing only — **a `dot` added to the passive slot in the editor is a silent no-op** (parser never emits passive DoTs, but the editor allows it) |
| `chargeAbilitiesFromSkill` | firing only (active rounds only by design) |
| `detonationsFromSkill` / `accumulatorsFromSkill` | firing only |

**Rule when adding a mechanic:** if it can live on a passive (extend/detonate/modifier/
buff/charge-aura), source it from firing + passive.

---

## 5. Buff/debuff path: static gating semantics

- Buff/debuff abilities never reach the sim directly. They are converted **once** (per
  config+enemyType memo) by `buffAbilitiesToSelectedBuffs` → `SelectedGameBuff` →
  `computeBuffTimeline` schedules them per round.
- **Static gate:** `staticGateConditions` (`buffAbilityConverters.ts:100-105`) checks
  `conditionsMet` against a **sentinel context** (presence counts = 1, "satisfiable in
  principle"). Derivable count-threshold gates are neutralized to `always` so a literal
  `gte 4` isn't wrongly compared against sentinel 1; **manual** thresholds keep literal
  gating. Real excludes today: enemy-type mismatch and manual-off toggles.
- **Once scheduled, conditions are never re-evaluated per round.** A "gain Attack Up
  when enemy has ≥3 debuffs" buff is either always on the timeline or never — the
  per-round debuff count doesn't gate it. (Modifier abilities DO re-evaluate per round;
  that's the current workaround for condition-sensitive stat effects.)
- **No-double-count invariant:** the sim reads only damage/additional/dot/extend/
  detonate/accumulate/charge/modifier types from `shipSkills`; buff/debuff effects enter
  only via the converted `SelectedGameBuff` arrays. Disjoint by construction.
- Scheduling info (`skillSource`, `skillDuration`) is rebuilt at conversion (slot →
  `skillSource`, `config.duration` → `skillDuration`). Feeding converter output that
  lacks scheduling into `computeBuffTimeline` makes it permanent (over-counts) — known
  trap.

---

## 6. Prioritized backlog: introducing parsed features into the sim

Ordered by (user surprise × implementation cost). Item 1 is "the editor lets you
configure it and it looks like it works, but it does nothing".

> **Shipped 2026-06-03:** condition gates on `damage`/`additional-damage`/`dot`/
> `detonate-dot`/`accumulate-detonate` (formerly items 1–2), and HP-threshold realism
> for the enemy HP dimension (formerly item 6), are all shipped. Ability ordering:
> Tier 1 (text-order emission from parser) and Tier 2 (order-aware gating overlay +
> editor reorder buttons) are shipped; Tier 3 (reactive event dispatch) is still deferred.

1. **Editor fields + validation for the no-op types** — either render config fields for
   heal/shield/cleanse/purge/control (and visibly mark them "not simulated in DPS"), or
   hide them from the DPS editor's type picker until a calc consumes them. Also: warn or
   block `dot`/`charge`/`detonate` on the passive slot (silent no-ops today).
2. **Dynamic per-round buff gating** (deferred from Phase 3b) — re-evaluate buff/debuff
   conditions per round instead of static include/exclude. Needs a condition-aware
   timeline (or per-round filtering of `activeSelfBuffs` by their source ability's
   conditions). The biggest correctness win for ships like Crocus/Nuqtu/APEX
   (threshold-gated buffs).
3. **Passive-slot sourcing audit** — extend firing+passive sourcing to `charge` (charge
   auras) and `detonate`/`dot` if any ship's passive carries them; audit
   `ship-skills.csv` first.
4. **Self HP-threshold realism** — `selfHpPct` is still fixed at 100. A declining
   self-HP curve (or configurable self-HP%) would make "if it is at full HP" and
   self-execute-style gates meaningful.
5. **`trigger` field** — reactive events (`on-crit`, `on-attacked`, …) need an event
   dispatch inside the round loop. Largest lift; prerequisite for cleanse/control
   modeling and the future combat sim. Until then, keep modeling reactives as manual
   condition toggles.
6. **Heal/shield consumption** — scoped to the Healing-calc adoption spec, not DPS.

---

## 7. Out-of-model sim parameters (for completeness)

Flat inputs that interact with abilities but live outside `ShipSkills`: base stats
(attack/crit/critDamage/defence/hp/hacking/defensePenetration), `chargeCount` +
`startCharged` + `allyChargePerRound`, global `enemyType`, `enemyDefense`/`enemyHp`/
`enemySecurity`, affinity modifiers (damage/crit cap/crit penalty), global
attacker/enemy buff pickers, and team-ship buff/debuff contributions (scheduled with
`sourceStartCharged`). Modifier abilities fold additively into the same percentage
buckets as buffs.
