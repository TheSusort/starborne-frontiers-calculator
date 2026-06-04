# Skill Model Coverage: Parser/Editor vs DPS Simulation

> Living document. Last audited **2026-06-03** on branch `feat/skill-ability-editor`.
> Updated **2026-06-03** after the deterministic-crit + hard-gating ship (spec 2026-06-03-deterministic-crit-and-hard-gating-design.md).
> Updated **2026-06-03** after the combat-engine Phase 1 ship (spec 2026-06-03-combat-engine-phase1-design.md).
> Updated **2026-06-04** after the combat-engine Phase 2 ship (branch `feat/combat-engine-phase2`).
> Purpose: a single source of truth for what the ability model can *express*, what the
> parser *auto-fills*, what the editor *exposes*, and what the DPS sim actually
> *consumes* — so new sim features can be introduced in a structured, prioritized way.

**Pipeline:** `skillTextParser.ts` + `buildShipAbilities.ts` (auto-fill) → `ShipSkills`
(`src/types/abilities.ts`) → editor (`src/components/skills/*`) → sim inputs
(`configToSimInputs.ts`, `buffAbilityConverters.ts`) → `dpsSimulator.ts` (thin adapter
over `runCombat`) + `applyAbilities.ts` / `evaluateConditions.ts` / `roundContext.ts` /
`src/utils/combat/*` (`engine.ts`, `statusEngine.ts`, `abilityStatusGating.ts`).

---

## 1. Ability-type matrix

Legend: ✅ full, ⚠️ partial (see notes), ❌ none.

| Type | Parser auto-fills | Editor fields | Sim consumes | Conditions gate in sim | Scaling in sim | Slots consulted by sim |
|---|---|---|---|---|---|---|
| `damage` | ✅ multiplier, `hits`, `noCrit`, scaling+cap, hp-threshold & enemy-effect & ally-gates as conditions | ✅ all incl. scaling | ✅ | ✅ `gateFiringAbilities` gates the ability — EXCEPT the bare scaling-source condition, which scales only (Meiying: base 190% hits everyone, +90% Supporter-only). A scaling condition WITH `countComparator` gates too. | ✅ `scaledBonus` on `conditions[scaling.conditionIndex]` | **firing + passive** (passive damage = gated extra hit, e.g. Judge) |
| `additional-damage` | ✅ `parseSecondaryDamage` (hp/def %) | ✅ | ✅ | ✅ `gateFiringAbilities` (`applyAbilities.ts`) | ❌ | firing only |
| `modifier` | ✅ `parseModifiers` (outgoingDamage, critDamage, defPen flat + for-each scaling) | ⚠️ all except `isMultiplicative` (hidden, no-op) | ✅ | ✅ per-round, full `conditionsMet` (`applyAbilities.ts:37`) | ✅ | **firing + passive** |
| `buff` | ✅ via `buildSkillBuffAutoFill` + `detectGrantConditions` | ✅ (stacks, duration; `stackTrigger`/`maxStacks` come from picker, not directly editable) | ✅ via combat engine's status machinery (`statusEngine.ts`); `SelectedGameBuff` conversion remains **only** for the DPS page preview and manual/team picker paths | ✅ **dynamic** — timed: gated at application (each cast); aura/accumulating: per-round effect inclusion; live-subject rule: derivable conditions on non-derivable subjects neutralized to always; manual (non-derivable) thresholds keep literal gating (`abilityStatusGating.ts`) | stacks (accumulating via `stackTrigger`) | all slots (routed by `skillSource`) |
| `debuff` | ✅ same + `application` (inflict/apply) | ✅ | ✅ (landing roll: hacking vs security for inflict; affinity for apply); flows directly into the combat engine's status machinery | ✅ **dynamic** — same gating rules as buff (timed at application; aura per-round; live-subject rule) | stacks | all slots |
| `dot` | ✅ `buildDoTAutoFill` (active/charged slots only — never passive) | ✅ (duration finite only) | ✅ Step 3, gated by hacking landing roll | ✅ `gateFiringAbilities` (`dotsFromSkill`) | ❌ | firing only |
| `extend-dot` | ✅ `parseExtendDoT` + `parseCritPowerExtend` | ✅ | ✅ Step 2.9 (corrosion+inferno, not bombs) | ✅ per-round `conditionsMet` against the payload ctx (binary self-crit) + deterministic `chanceFromCritPower` schedule | — | **firing + passive** (Valerian fix) |
| `detonate-dot` | ✅ `parseDetonateDoT` | ✅ | ✅ Step 2.95 | ✅ `gateFiringAbilities` | ❌ | firing only |
| `accumulate-detonate` | ⚠️ hardcoded effect names (Echoing Burst) | ✅ | ✅ Step 3b/6b (gated only by DoT landing roll) | ✅ `gateFiringAbilities` | ❌ | firing only |
| `charge` | ✅ `parseChargeGain` + condition classifier | ✅ | ✅ active rounds only, capped at `chargeCount` | ✅ `gateFiringAbilities`; un-thresholded conditions also scale (binary self-crit, per-count subjects) | per-count / binary self-crit via `evaluateCondition` (positional ctx) | **firing + passive** |
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
| `enemy-hp-pct` / `enemy-hp-missing-pct` | ✅ (`hpProportionalScaling`: "up to X% based on the target's current/missing HP" — Akula/Tithonus) | count = live `enemyHpPct` (or `100 −` it) | real | ✅ HP-proportional scaling modifiers track the declining pool |
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
| `buff/debuff.duration` `'recurring'` or `undefined` | Treated as permanent always-active aura in the status engine (included every round while its conditions pass). |
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
| buff/debuff (via status engine; `skillSource` routes scheduled buffs, ability statuses registered at engine creation) | all slots ✅ |
| `damageInputsFromSkill` | firing **+ passive** — the passive slot's damage ability is gated per round and added as an extra hit (Judge's start-of-round 60% vs <50% HP). Passive `additional-damage`/`secondary` still firing-only (no known ship). |
| `secondaryFromSkill` | firing only |
| `dotsFromSkill` | firing only — **a `dot` added to the passive slot in the editor is a silent no-op** (parser never emits passive DoTs, but the editor allows it) |
| `chargeAbilitiesFromSkill` | firing **+ passive** ✅ (active rounds only by design; both pre-gated via `gateFiringAbilities`) |
| `detonationsFromSkill` / `accumulatorsFromSkill` | firing only |

**Rule when adding a mechanic:** if it can live on a passive (extend/detonate/modifier/
buff/charge-aura), source it from firing + passive.

---

## 5. Buff/debuff path: in-loop application semantics (combat engine Phase 1 + 2)

- **Buff/debuff abilities flow directly into the combat engine** (`src/utils/combat/engine.ts`
  + `statusEngine.ts`). At engine creation, all buff/debuff abilities in `shipSkills.slots` are
  registered with the status engine (classified as timed, aura, or accumulating). The static
  `SelectedGameBuff` conversion path (`buffAbilitiesToSelectedBuffs`) now serves **only** the
  DPS page preview (merged attacker buff totals display) and the manual/team buff pickers — it
  is no longer the sim's source of truth.
- **No-double-count invariant:** buff/debuff abilities enter the engine from `shipSkills`
  directly; manual picker buffs and team-ship buffs remain `SelectedGameBuff` arrays and enter
  via `selfBuffs`/`enemyDebuffs`. The two paths are disjoint by construction.
- **Dynamic gating (live-subject rule):**
  - *Timed* (finite `duration`): gated at application — each round the source slot fires, the
    ability's (live-gated) conditions are evaluated against the current round context. If the
    gate passes the status is applied for its window; if not, the cast is skipped. A later cast
    of the same slot can still apply it if conditions later satisfy.
  - *Aura* (`duration: 'recurring'`/`undefined`, or passive slot): held in an aura list; included
    in each round's snapshot only when its conditions pass that round (can flicker on/off).
  - *Accumulating* (`stackTrigger && isStackable`): stack accumulation is unconditional; per-round
    effect inclusion is gated (aura rule).
  - **Live-subject rule:** derivable conditions on subjects the Phase-1 sim cannot derive (e.g.
    `adjacent-ally`, `enemy-buff`) are neutralized to `always`, preserving the old static gate's
    "satisfiable in principle" semantics. Manual (non-derivable) thresholds keep literal gating
    (`abilityStatusGating.ts:liveGateConditions`).
- **Debuff landing: application-time roll with persistence (Phase 2).** Timed debuffs roll once
  at application; if the roll passes the debuff persists its full window without re-rolling each
  round. If the roll fails the application is skipped entirely. Recurring/aura debuffs (and
  accumulating stacks) keep a per-round roll — they re-enter the active set each round and must
  land anew. This replaces the Phase-1 per-round re-roll for all timed debuffs.
- **Same-family overwrite rule (game-verified 2026-06-04).** Within a buff family (the buff name
  minus its `I`/`II`/`III` tier suffix), a new application overwrites the existing entry only if
  (a) its tier is higher, or (b) the tier is equal AND the new cast's duration is longer than the
  existing buff's remaining turns. Otherwise the application is skipped and the stronger/longer
  buff persists. Enforced at BOTH `statusEngine.ts` upsert sites (`upsertBuff` for scheduled/team
  buffs and `applyTimedAbilityStatus` for the attacker's own buff/debuff abilities) via the shared
  `familyApplicationWins` helper. Same-source re-applications still refresh (after the post-turn
  decrement a 2-turn buff has 1 remaining, and `2 > 1`). A landed-but-family-blocked application is
  silently absorbed — it landed (the landing roll ran first), the stronger buff simply stays, and
  it is NOT recorded as resisted nor folded into the round totals. (DoT families — Corrosion/
  Inferno/Bomb — are exempt: each tier is its own entity and stacks independently.)
- **Action-fed status engine — `computeChargeSchedule` retired (Phase 2).** The status engine
  is now driven by real `sourceFired` action events rather than a synthetic charge schedule.
  Scheduled charge-slot buffs follow the attacker's actual bonus-charge cadence (the old
  invariant-4 quirk is fixed). Legacy merged-buff paths continue to ride the attacker's cadence;
  per-buff `sourceChargeCount`/`sourceStartCharged` fields are deprecated.
- **Once-per-round speed-ordered turns (Phase 2).** Each simulated round every ship acts once,
  in descending Speed order. Ties: team ships act before the attacker; the attacker acts before
  the enemy. Default speeds: attacker and team ships 100, enemy 50. Configurable via the Speed
  inputs on the attacker's stats grid, each team-ship card, and Enemy Settings.
- **Team ship buffs via `teamActors` (Phase 2).** Team support ships are registered as real
  actors; their buff/debuff abilities are re-timed onto their actual turns within each round.
  A faster support acts before the attacker and buffs apply in the same round; a slower support
  (or one whose first charge is still building) benefits the attacker starting the next round.
- **Owner Post-Turn decrement + `buff-expired` emission (Phase 2).** Status durations decrement
  at the end of the owner's turn (Post Turn phase) rather than at the top of the following round.
  DoTs tick at the start of the afflicted ship's (enemy's) turn. When a status reaches zero
  duration the engine emits a `buff-expired` event. Same-turn applications are included in the
  window — identical to Phase-1 semantics at default speeds.
- **`hasChargedSkill` widened (Phase 2).** Charged skills whose abilities deal no direct damage
  (pure utility: buffs, charge-grants, DoTs with no hit) are now recognised as charged skills.
  They fire on their normal charge cadence and their effects are applied.
- **Ability self-buffs visible to modifier gates:** after Phase 1, ability-sourced self-buff names
  (timed + aura currently active) and ability-sourced crit totals are included in `modifierCtx`
  (`selfBuffNames` + `effectiveCritRate`). This means a `modifier` ability gated on `self-buff X`
  will correctly see a buff X that was applied by another ability in the same cast. Locked by
  golden scenario 15.

---

## 6. Prioritized backlog: introducing parsed features into the sim

Ordered by (user surprise × implementation cost). Item 1 is "the editor lets you
configure it and it looks like it works, but it does nothing".

> **Shipped 2026-06-03:** condition gates on `damage`/`additional-damage`/`dot`/
> `detonate-dot`/`accumulate-detonate` (formerly items 1–2), and HP-threshold realism
> for the enemy HP dimension (formerly item 6), are all shipped. Ability ordering:
> Tier 1 (text-order emission from parser) and Tier 2 (order-aware gating overlay +
> editor reorder buttons) are shipped; Tier 3 (reactive event dispatch) is still deferred.
>
> **Shipped 2026-06-03 (Phase 0, PR #76 — feat/editor-noop-guardrails):**
> - Item 1: Editor guardrails (no-op type warnings, passive-slot DoT/charge/detonate validation).
>
> **Shipped 2026-06-03 (combat-engine Phase 1, this branch — feat/combat-engine-core):**
> - Item 2: Dynamic per-round buff/debuff gating via the combat engine — timed: at application;
>   aura/accumulating: per-round effect inclusion; live-subject rule. Crocus/Nuqtu/APEX threshold
>   buffs now switch on/off live.
>
> **Shipped 2026-06-04 (combat-engine Phase 2, this branch — feat/combat-engine-phase2):**
> - Real actor turns: team ships and the enemy with speed/turn meter — once-per-round,
>   speed-ordered (team → attacker → enemy default; enemy default speed 50); configurable Speed
>   inputs on the attacker stats grid, team-ship cards, and Enemy Settings.
> - Application-time debuff landing with persistence: timed debuffs roll once on apply and
>   persist (or miss) their full window; recurring/aura debuffs keep per-round rolls.
> - Post-turn duration decrement on the owner: durations now decrement in each status owner's
>   Post Turn phase; `buff-expired` emitted; DoTs tick at the start of the enemy's turn.
> - `hasChargedSkill` widened to include charged skills with no direct damage (pure utility);
>   `computeChargeSchedule` retired; status engine is now action-fed via `sourceFired`.
>
> **Phase 3 pointer (not yet started):**
> - Reactive triggers (`on-crit`, `on-attacked`).

1. **Editor fields + validation for the no-op types** *(shipped 2026-06-03, PR #76 — Phase 0,
   feat/editor-noop-guardrails)* — config fields rendered and "not simulated" labels added for
   heal/shield/cleanse/purge/control; passive slot warns on `dot`/`detonate` (silent no-ops;
   `charge` was dropped from the warning set 2026-06-04 when passive charge auras became sourced).
2. **Dynamic per-round buff gating** *(shipped 2026-06-03, this branch — combat-engine Phase 1,
   feat/combat-engine-core)* — see §5 above.
3. **Passive-slot sourcing audit** — *(charge auras shipped 2026-06-04,
   feat/combat-engine-followups: the 2026-06-04 audit over `ship-skills.csv` found 5
   passive charge auras — Hermes, Asphodel, Hemlock, Oleander, Cobalt — now sourced
   firing + passive on active rounds.)* Remaining: `detonate`/`dot` on passives if any
   ship ever carries them (none known today).
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
attacker/enemy buff pickers, and team-ship buff/debuff contributions (driven by
`teamActors` — each team actor's real turn cadence via its own `speed`/`chargeCount`/
`startCharged`; the per-buff `sourceStartCharged` fields are deprecated). Modifier
abilities fold additively into the same percentage buckets as buffs.
