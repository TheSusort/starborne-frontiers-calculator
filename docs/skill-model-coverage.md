# Skill Model Coverage: Parser/Editor vs DPS Simulation

> Living document. Last audited **2026-06-03** on branch `feat/skill-ability-editor`.
> Updated **2026-06-03** after the deterministic-crit + hard-gating ship (spec 2026-06-03-deterministic-crit-and-hard-gating-design.md).
> Updated **2026-06-03** after the combat-engine Phase 1 ship (spec 2026-06-03-combat-engine-phase1-design.md).
> Updated **2026-06-04** after the combat-engine Phase 2 ship (branch `feat/combat-engine-phase2`).
> Updated **2026-06-05** after the combat-engine Phase 3 ship (branch `feat/combat-engine-phase3`).
> Updated **2026-06-05** after the team ShipSkills walk (branch `feat/combat-engine-team-skills-walk`).
> Updated **2026-06-06** after the ally-crit-dot reactive trigger (branch `feat/combat-engine-ally-crit-dot`).
> Updated **2026-06-07** after the Healing Calculator engine rebuild (branch `feat/healing-calc-engine`).
> Updated **2026-06-07** after the damage-leech heals & shields ship (branch `feat/damage-leech`): the ~14 leech text cells (~11 ships) now parse + simulate (see §5 LEECH, §6).
> Updated **2026-06-08** after the Phase 4a enemy-offense increment (branch `feat/combat-engine-phase4a-enemy-offense`): enemy is now a full `runPlayerTurn` actor vs the heal target; per-target status stores; affinity symmetry on enemy attacks; real `selfHpPct`; `attacked` event + live `on-attacked` trigger; enemy-applied DoTs tick on the tank (see §5 PHASE 4a, §6).
> Updated **2026-06-09** after the Phase 4b death & revive increment (branch `feat/combat-engine-phase4b-death-revive`): three live death triggers (`on-destroyed`/`on-ally-destroyed`/`on-enemy-destroyed`) + `on-cheat-death-activated`; Cheat Death survives a lethal hit at 1 HP once per combat (clearing removable statuses); new `unremovable` concept; Salvation on-destroyed ally-heal re-enabled; on-kill/on-ally-destroyed extra-action bridge (Sokol/Liberator/Harvester) (see §5 PHASE 4b, §6 item 9).
> Updated **2026-06-10** after the Phase 4c PR 2 on-ally-attacked reactives increment (branch `feat/combat-engine-phase4c-ally-damage`): new ally-scoped per-hit `on-ally-attacked` trigger with `triggerCritFilter` + `roleFilter` (category prefix match; unknown role = dormant); `eventCtx.damagedAllyId` routes 'ally'-target payloads to exactly the damaged ally; roles thread from ship data (`Ship.type` → page auto-fill → `roleByActorId`); Cultivator/Refine/Graphite/Guardian-ally-Provoke/Heliodor-p2 live; editor trigger + ally-role-filter controls (see §5 PHASE 4c PR 2, §6).
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
| `heal` | ✅ `parseHealAbilities` / `parseHealNoCrit` (basis: caster max HP / Attack / Defense / recipient max HP / **damage-dealt / damage-taken**; self/ally/all-allies targets; sentence-scoped; `leechScope` for passive damage-dealt) | ✅ pct, basis, target, noCrit, scope | ✅ **healing calc only** (consumed against a live heal target; provably inert in DPS runs — gated on `healTargetId`) | ⚠️ revive/Cheat Death stay unparsed; FrontLine R4 enemy-action leech disqualified; in-sim conditions follow the buff/debuff rules | ✅ stat bases: casterStat(basis) × pct% × critBlend × (1+healModifier%) × (1+outgoingHeal%) × (1+recipient incomingHeal%). Leech bases (damage-dealt/taken): see §5 LEECH | firing + passive (heals emitted text-position ordered) |
| `shield` | ✅ `parseHealAbilities` (basis × pct; incl. damage-dealt / damage-taken + `leechScope`) | ✅ pct, basis, target, scope | ✅ **healing calc only** — additive absorption pool, capped at target max HP, drains before HP, no expiry | ⚠️ same as heal | ✅ basis × pct only (NO crit, NO heal channels — documented assumption); leech-shield basis = §5 LEECH | firing + passive |
| `cleanse` / `purge` | ✅ `parseCleanse` (cleanse only — count of debuffs removed) | ✅ cleanse count | ⚠️ **healing calc: cleanse OUTPUT COUNT only** (reported, no debuff consumption yet); `purge` stays annotation-only | — | — | firing + passive |
| `control` | ❌ (Taunt/Provoke parse as buff/debuff *conditions*, not control abilities) | ❌ label-only | ❌ not consumed | — | — | — |

### Headline gaps (parsed + editable, but sim silently ignores)

1. **purge/control** — exist in the model and type picker, have no sim consumption.
   (Heal/shield/cleanse are now parsed + consumed by the **Healing Calculator** — see §5
   HEALING. Purge/control remain Phase-4 seams.)

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
| `hp-threshold` | ✅ (below/above, self/enemy) | `selfHpPct`: live for the heal target in healing mode (bombarded tank's current HP%); fixed 100 in DPS mode and for un-targeted actors. `enemyHpPct` derived from cumulative damage vs configured enemy HP pool — declines each round | self live in healing mode (tank), fixed 100 in DPS | ✅ enemy HP-threshold gates switch mid-fight; DERIVABLE self HP-threshold gates (at-full-HP off-switch, extra-action HP<N, modifier HP<N) now switch for the tank in healing mode. **Non-derivable** self HP-threshold gates (Makoli/Guardian-style reactive heals) stay manual — the parser marks "below X% HP" on reactive heals as non-derivable, and the "when directly damaged" trigger is unmodeled (4c). |
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
| `Ability.trigger` | Union now has 16 values; 15 are LIVE (everything except the `on-cast` default — see `LIVE_TRIGGERS` in `src/types/abilities.ts` and §6 item 5 for the per-phase history, latest: `on-ally-attacked`, Phase 4c PR 2). Parser emits all live triggers (see §5); **editor exposes a Trigger select**; the sim routes every live trigger through the reactive machinery; remaining annotation-only reactive *families* are hp-crossing + enemy-action (4c PRs 3–4). |
| `Ability.target` | Editor exposes 5 values; sim only distinguishes self-vs-enemy when routing buff/debuff conversion. `ally`/`all-allies`/`all-enemies` have no distinct sim meaning (all-allies modifiers fold into self — correct for single-ship DPS). |
| `modifier.isMultiplicative` | Deliberate no-op, documented in `applyAbilities.ts:38-40`; hidden in editor. |
| `modifier.channel` `outgoingHeal` / `incomingDamage` | No DPS bucket — silently dropped (`applyAbilities.ts:68`). |
| `buff/debuff.duration` `'recurring'` or `undefined` | Treated as permanent always-active aura in the status engine (included every round while its conditions pass). |
| `buff/debuff.maxStacks` | Only caps **accumulating** buffs; ignored otherwise. |
| `buff/debuff.stackTrigger` | Consumed by the timeline, but not directly editable (comes from the buff picker / parser). |
| `Condition.buffName` on `enemy-debuff` | Ignored — enemy-debuff count is name-agnostic by design. |
| `scaling.conditionIndex` | Model supports any index; **editor hardcodes `conditions[0]`**. |
| `ParsedBuffEffects` heal keys (`outgoingHeal`, `incomingHeal`) | Dropped in DPS (`toSimBuffs`/`toEnemyModifiers`); **consumed in the healing calc** as outgoing/incoming repair multipliers. |
| `ParsedBuffEffects.hotPct` | Parsed from "Repair Over Time I/II/III" buff descriptions ("N% Applying Unit HP%"); **consumed in the healing calc** as a HoT (ticks at the holder's turn). "Everliving Regeneration" is NOT a HoT — it is an incoming-repair amplifier. |
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
- **Reactive triggers (Phase 3).** The live trigger set and their event keys:
  - `start-of-round` → `round-started` (emitted at the round boundary, before any turn). Self-buffs
    with "at the start of the round" phrasing (Valkyrie and ~12 other occurrences) emit their
    timed windows here; real duration windows instead of the prior passive-aura approximation.
  - `on-crit` → `ability-performed` where `actorId === owner`; enqueues once per CRITTING HIT
    (the event's `critHits` field; falls back to the `didCrit` binary for events without it).
    Covers crit-inflicted debuffs (Enforcer's Defense Shred) and crit-triggered self-buffs
    (Wusheng stealth). **Shipped 2026-06-06:** per-hit crit draws — each hit of a multi-hit
    skill crit-checks individually against the deterministic gate, so a 3-hit attacker at 50%
    crit produces the in-game ~1.5 on-crit events per turn (the former once-per-turn
    divergence is closed; see the extra-actions §5 entry).
  - `on-debuff-inflicted` → `debuff-applied` / `dot-applied` with `sourceId === attacker`. Each
    discrete infliction event: a landed timed debuff application or a landed DoT config entry
    applied by the attacker that turn. A cast landing 2 debuffs = 2 events. Family-blocked-but-
    landed applications count (the stronger buff persisted, but the unit did inflict).
    Recurring/aura per-round folds do **not** count — standing effects are not infliction events.
    Per-standing scaling is preserved and untouched for "per buff/debuff ON the target" texts
    (Nuqtu/Rhodium).
  - `on-ally-debuff-inflicted` → `debuff-applied` with `sourceId` = a team actor (landed timed
    debuff applications on the team actor's turn). Requires `teamActors` to be configured;
    without it, ally-triggers never fire. Team DoT lists are deferred — only team timed debuff
    applications are derivable this phase. Covers Oleander charge-on-ally-inflict.
  - `on-ally-crit-dot` → `dot-applied` from a team actor (`sourceId !== owner`) where
    `viaCrit === true`. **Game rule (Crocus):** "When another ally inflicts a DoT effect with a
    critical hit, inflicts Corrosion II on that enemy." Shipped 2026-06-06.
    **`viaCrit` event contract:** the flag is set on `dot-applied` only when the casting ability
    carried at least one critting hit (player-cast applications only — executor-applied DoTs such
    as bomb-tick and DoT-extension never carry `viaCrit`). This matches the contract for
    `ability-performed.critHits`: it is an opt-in field present only when > 0.
    **Documented approximations:**
    1. *Per-cast, not per-hit attribution.* "With a critical hit" is interpreted as: the cast
       that applied the DoT had ANY critting hit. Per-hit DoT attribution (whether the specific
       hit that placed a given DoT type was itself a crit) is not modeled — the sim does not
       track which hit of a multi-hit skill placed which DoT entry.
    2. *One trigger per `dot-applied` event.* A single team-actor cast that applies multiple
       DoT types with a crit emits one `dot-applied` event per DoT type; the listener fires
       once per such event. This is the per-infliction-event rule: the trigger fires as many
       times as distinct DoT infliction events occur, not once per cast regardless of how many
       types land.
    **Apply-time nuance (golden scenario 22):** Corrosion is a DoT applied by pushing a
    corrosion entry (the executor's dot branch in triggers.ts) — NO apply-time
    effective-attack snapshot; corrosion ticks are enemy-HP-scaled and read the applier's
    ctx (DoT modifier + affinity) at TICK time. This means the reactive corrosion fires
    correctly even when the Crocus owner has not yet acted that round (no last-turn ctx).
    A BOMB-type reactive DoT from an owner with no last-turn ctx IS skipped: bomb
    `damagePerStack` snapshots the applier's effective attack at application time.
  - `on-bomb-detonated` → `bomb-detonated` (emitted per burst on countdown expiry and from
    skill-driven detonations). Covers Lingshe stealth, enemy charge removal, Echoing Burst
    repairs. The machinery supports any buff/debuff/dot/charge follow-up from this trigger;
    it is DPS-neutral today only because the currently-classified ships' payloads all happen
    to be not-simulated types (stealth / charge removal / repair).
  - Non-live triggers (`on-attacked`, `on-ally-destroyed`, `on-destroyed`) were **annotation-only**
    at Phase 3 (normal on-cast pipeline, manual assume-active conditions). All three have since
    gone LIVE — `on-attacked` in Phase 4a (per-hit + crit filter in 4c PR 1), the destroyed pair
    in Phase 4b, and `on-ally-attacked` joined in 4c PR 2; see those §5 blocks.
- **Intent/drain semantics (Phase 3).** Reactive listeners push intents onto the engine's queue;
  the engine drains after `round-started` (start-of-round intents execute before any turn) and
  after each actor's turn body before Post Turn. A triggered effect never boosts the action that
  triggered it (e.g. Enforcer's crit-inflicted Defense Shred is active the following round).
  Triggered ability executions emit events, enabling chaining (a triggered debuff infliction can
  feed an `on-debuff-inflicted` charge listener in the same drain). A `MAX_INTENT_GENERATIONS = 10`
  backstop converts a pathological loop into a thrown error rather than a hang.
- **Charge-on-inflict fix (Phase 3, game-verified 2026-06-04).** Hemlock-style "gains 1 charge
  after it inflicts a debuff" is now `on-debuff-inflicted` with a flat +1 per infliction event,
  not the previous `enemy-debuff` count condition that scaled per standing debuff (too fast).
  Per-standing scaling is preserved for "per buff/debuff ON the target" texts.
- **Editor Trigger select (Phase 3; extended 2026-06-06).** `AbilityCard` gains a Trigger
  `Select` listing every union value with plain-language labels. Non-live triggers render a note "Not simulated —
  treated as assume-active". Changing the trigger on a buff/debuff/dot/charge ability is
  sufficient to route it through the reactive machinery.
- **Persistent stacking statuses (game-verified 2026-06-05).** Four named statuses are NOT timed,
  regardless of what the skill text says — each landed application adds a stack (capped at the
  buff DB max) and the status persists until cleansed/consumed. Since cleanse, kills, and incoming
  hits are not simulated, they are PERMANENT in-sim:
  **Defense Shred** (max 20, -2% Defense/stack), **Blast** (max 4, +15% Outgoing/stack),
  **Overload** (max 10, removed on-kill in-game → never in-sim), **Titanite Plating** (max 5, loses
  a stack per incoming hit in-game → never in-sim). The **buff-name rule OVERRIDES the skill-text
  duration** — Enforcer's "inflicts Defense Shred for 3 turns" persists and climbs in-game, so the
  3-turn text is ignored. Both application doors (`statusEngine.applyTimedAbilityStatus` and the
  scheduled `upsertBuff` path) route these by name into per-side persistent-stack maps before the
  family-rule timed paths; they fold with effect × stacks and carry a `turnsRemaining: 'permanent'`
  sentinel so the attacker-turn partition takes the no-re-roll fold (a landed persistent status is
  never re-rolled per round — only NEW applications can be resisted, adding no stack). The list
  lives in `src/constants/persistentStackingBuffs.ts` (NOT `buffs.ts`, which `fetch-buffs`
  regenerates). **Defense Matrix stays TIMED** (its texts carry "for x turns") — deliberately
  excluded. **Warding Screen** ("Stackable up to 4") is an OPEN QUESTION — unverified in-game,
  deliberately absent until confirmed.
- **Team ShipSkills walk (2026-06-05, branch `feat/combat-engine-team-skills-walk`).**
  Team ships now walk their parsed `ShipSkills` as full combat actors. Key mechanics:

  **Routing table.** `self`-targeted abilities (grants, charge gains, buffs) apply to the
  caster only. `ally`/`all-allies`-targeted abilities and unscoped grants apply to every
  player actor (attacker + all team ships). All debuffs and DoTs route to the enemy.
  Condition-clause scope does not leak: grant conditions that appear inside a debuff
  sentence (Pallas, Refine, AEGIS self-buffs) stay `self`; only explicit ally-scope
  phrases promote to `all-allies` or `ally`.

  **Per-actor statuses + condition contexts.** Each player actor now carries its own
  timed/aura/accumulating status maps. Every condition evaluation — application-time
  gates, aura inclusion each round, drain-time checks inside the intent executor — uses
  the owning actor's active buff names and its own crit rate against the shared enemy
  state (HP%, debuff counts, enemy type). A caster-gated grant ("if the caster has buff
  X, all allies gain Y") reads the caster's buffs to decide application and lands on
  every player actor when the gate passes.

  **teamDamage attribution model.** Every point of enemy HP decline belongs to exactly
  one source actor. The focus actor's (attacker's) damage fills the existing
  `totalRoundDamage` + per-type fields; everything from non-focus player actors rolls up
  into `RoundData.teamDamage`. By construction `totalRoundDamage + teamDamage = round HP
  delta`. `summary.teamTotalDamage` is the cross-round sum. Enemy HP% and HP-threshold
  gates derive from attacker + team cumulative damage. The focus-only summary (DPS,
  damage-type breakdown) is unaffected — the attacker's comparison remains meaningful
  regardless of team composition.

  **Per-applier DoT contexts.** Inferno ticks resolve against the applier's own
  effective attack, DoT modifier, and affinity multiplier each round (the engine keeps a
  last-turn ctx per actor). Corrosion stays enemy-HP-scaled but uses the applier's DoT
  modifier + affinity. Bombs snapshot `damagePerStack` from the applier at application.
  DoT ticks and bomb bursts attribute to `teamDamage` for team-applied entries.
  `dot-applied` events carry the team actor's `sourceId` and feed `on-ally-debuff-
  inflicted` listeners on the attacker.

  **Reactive parity.** `partitionReactiveAbilities` runs once per walked actor; reactive
  listeners are registered keyed to each actor's own owner id. Registration order: focus
  actor (attacker) first, then team actors in input order — this is a fixed implementation
  choice (Task 6) for determinism; cross-owner registration order only matters when
  multiple owners share a listener, and any fixed order is deterministic. Listener guards:
  `on-crit` → `actorId === owner`; `on-debuff-inflicted` → `sourceId === owner`;
  `on-ally-debuff-inflicted` → player `sourceId !== owner`; `start-of-round` and
  `on-bomb-detonated` → global. The intent executor uses the owner for stats, landing
  rolls, and crit gates; charge intents targeting `ally`/`all-allies` bump every player
  actor. Team DoT `dot-applied` events are live (the FUTURE seam in triggers.ts is
  removed).

  **Ally charge grants.** An `ally`/`all-allies`-targeted charge ability (e.g. Hermes)
  bumps every player actor's charge accumulator, each capped at its own `chargeCount`.
  `allyChargePerRound` on the attacker config remains as a coexisting manual input
  (users without a configured Hermes keep it; both accumulate independently per actor).

  **Echoing Burst accumulators.** Gather all players' direct damage to the enemy
  (damage-taken semantics; attacker + team contribute to the same pool). The detonation
  burst lands in the caster's own `detonation` channel.

  **Parser ally-scope rules.** `SkillEffect.target` is now `'self' | 'ally' | 'all-allies'
  | 'enemy'` (the 5-member union with `all-enemies` is `AbilityTarget` in the ability
  model, which the engine routes on). Detection is VERB-AWARE (live-verification fix
  2026-06-05): receiving verbs ("gains/has") route by the SUBJECT — "all allies gain X"
  → `all-allies`, "This Unit gains X" → `self`; the bestowing verb ("grants") routes by
  the RECEIVER — "grants all allies / them X" → `all-allies`/`ally`, "grants itself X"
  → `self` (Nuqtu), and **receiver-less "This Unit grants X" → `all-allies`** (the locked
  routing rule: unspecified grants go to all players — Oleander-style support actives).
  "the (other) ally with the highest …" → `ally`. The condition-clause non-leak rule:
  condition sub-clauses (introduced by "if", "when", "after", etc.) are stripped before
  receiver detection, so a trigger's "an ally" cannot fake a receiver (Pallas's "gains X
  after an ally is critically repaired" stays `self`). Audit: 81 all-allies targets and
  1 single-ally target (Howler) across the corpus; attacker-only fixtures are unaffected
  (self and all-allies both fold onto the attacker's side when no team actors are walked).

  **focusActorId / per-actor damage map seam.** The engine core has no hardcoded
  `'attacker'` string in its hot paths. The DPS adapter passes `focusActorId: 'attacker'`;
  a future simulator page passes whichever actor it wants to focus without engine changes.
  Round damage accumulates in a `Map<actorId, contributions>` — the simulator-page read
  seam is in place from day one.

  **Known approximations (documented in code):**
  - *Accumulating-status cadence*: a team ship that casts an accumulating (stackTrigger)
    all-allies buff uses the attacker's cast cadence for the aura inclusion tick — the
    stack accumulates on the team actor's real turns, but the per-round effect inclusion
    runs on the attacker's round context. This is conservative (never over-counts stacks)
    but may mis-time the effect window for fast team ships. Logged as a backlog item
    (see §6).
  - *Speed-buff turn reordering*: received Speed Up buffs do not reorder turns mid-round;
    the queue uses static input speeds (Phase 4 / turn-meter manipulation).
- **Extra actions (2026-06-06, branch `feat/combat-engine-extra-actions-per-hit-crit`).**
  Ships whose passive or charged text grants an extra action (Nuqtu, Sustainer, Tormenter,
  Liberator, Tygr) gain a full additional turn, re-inserted into the round's turn queue at
  their Speed position. Game-verified rules now locked by the engine:

  1. **Extra action = full normal turn.** The granting actor re-enters the queue and takes
     an ordinary turn (active or charged, per cadence) — it is not a reduced or
     conditional action.
  2. **Re-inserted by Speed.** The extra turn slot is placed immediately after the last
     actor whose Speed is higher; if the granting actor is the fastest remaining ship it
     acts again immediately.
  3. **Status durations tick per turn taken.** An extra turn counts as a full turn for
     decrement purposes — a 1-turn buff applied on the main turn expires after the extra
     turn (buff-expired event count pinned by the golden scenario 21 test).
  4. **Multi-hit skills crit-check per hit.** Each hit of a multi-hit skill draws its own
     crit accumulator slot; on-crit follow-up effects fire once per critting hit. Damage
     averages correctly; trigger frequency now matches the game.
  5. **On-crit follow-ups fire per critting hit** (not once per action stream). The engine
     emits ONE `ability-performed` event per cast carrying a `critHits` count (present only
     when > 0; `didCrit` stays the any-hit binary); the reactive `on-crit` listener enqueues
     one intent per critting hit from that count, drained after the action stream completes.

  **Tygr Stasis approximation.** Tygr's extra-action condition "if the enemy is affected
  by Stasis" is approximated as enemy-has-any-debuff (name-agnostic, same semantics as all
  other `enemy-debuff` conditions). This is conservative (Stasis is rare; the condition is
  non-derivable anyway) and documented in the parser code.

  **`RoundData.extraTurns`.** The round data struct gains an optional `extraTurns` field
  counting the extra turns taken by the focus actor that round. Rendered as "+N extra turn"
  in the DPS round chart tooltip.
- **Healing Calculator engine rebuild (2026-06-07, branch `feat/healing-calc-engine`).**
  The Healing Calculator now rides the same deterministic combat engine as DPS. The healing
  path is **gated on `healTargetId`**: when absent the engine runs provably inert for DPS
  (the 22 DPS goldens are byte-identical), and the healing path only activates when a live
  heal target is configured. Adapter: `simulateHealing` (`src/utils/calculators/
  healingEngineAdapter.ts`). Hand-verified by `healingGoldenParity.test.ts` (8 referee-built
  scenarios). The following rules are game-verified or documented-assumption:

  **Heal formula + channels (game-modeled).** A heal's raw amount =
  `casterStat(basis) × pct% × critBlend × (1 + healModifier%) × (1 + outgoingHeal%) ×
  (1 + recipient incomingHeal%)`. The `basis` is one of: caster max HP, caster Attack,
  caster Defense, or recipient max HP ("their Max HP"). `critBlend` comes from the heal
  crit schedule (see next). NoCrit heals (Pallas) skip the crit draw entirely (no schedule
  slot consumed) and use a 1.0 blend.

  **Separate per-actor heal crit gates (WHY: damage-schedule isolation).** Heal crits draw
  from a **dedicated per-actor heal crit accumulator**, never the damage crit gates. A
  healer's damage crits and heal crits advance independently, so consuming the damage
  schedule for a heal (or vice-versa) can never alias the two cadences. This isolation is
  the same fractional-accumulator discipline the damage gates use, just on a separate
  schedule per actor.

  **Heal consumption vs a live target.** `effective = min(raw, maxHp − currentHp)`; the
  shortfall is tracked as overheal. A heal landing on a target already at full HP is 100%
  overheal. Dead targets (HP floored at 0) receive nothing.

  **Shields (user-verified pool cap 2026-06-07; no-crit/no-channels is an ASSUMPTION —
  verify in game).** A shield's amount = `basis × pct` only — NO crit blend and NONE of the
  heal channels (healModifier / outgoingHeal / incomingHeal) apply. It adds to an **additive
  absorption pool on the target, capped at the target's max HP** (user-verified game rule).
  The pool **drains before HP** on incoming hits and has **no expiry**. The no-crit /
  no-channels treatment is a documented assumption pending in-game confirmation.

  **HoT (Repair Over Time) ticking (cast-turn-tick note → VERIFY in game).** "Repair Over
  Time I/II/III" buff descriptions parse into `hotPct`. A HoT ticks at the **holder's turn
  start** for `applierMaxHp × hotPct% × stacks × (1 + holder incomingHeal%)`. The applier
  context is read at **TICK time** (the corrosion rule) — a foreign applier without a live
  ctx is **strictly skipped** (no tick). A **self-applied HoT ticks on its own cast turn**
  (flagged for in-game verification — the game may delay the first tick a turn).
  "Everliving Regeneration" is an incoming-repair amplifier, NOT a HoT.

  **Ally-heal → heal-target routing (user-confirmed).** An `ally`/`all-allies`-targeted heal
  or shield from any actor lands on the configured heal target (the single tracked recipient
  this increment). Self-targeted heals stay on the caster. This routing rule was confirmed
  with the user.

  **Dead-is-dead semantics (game-modeled).** The heal target's HP floors at 0. A destroyed
  target skips its own turns, receives no further heals, and enemies stop attacking it. The
  round it dies is reported as `destroyedRound`; the sim continues (other actors still act)
  so comparison runs complete.

  **Reactive heal triggers (drain-time approximations).** Two reactive triggers are LIVE for
  healing: `on-ally-critically-repaired` (own crit-repair of an ally — Pallas cleanse) and
  `on-ally-crit` (per ally critting hit — Pallas charge). The intent executor learned
  heal/shield/cleanse follow-ups, with documented **drain-time simplifications**:
  - Reactive heals fold as `basis × pct × (1 + healModifier)` — NO crit, NO outgoing/
    incoming channels.
  - Reactive shields fold as `basis × pct` — NO crit, NO channels.
  - Reactive follow-ups do **NOT** re-emit a `heal-performed` event, so a reactive heal
    cannot chain into another `on-ally-critically-repaired` listener (no re-emission chain).
  A new `heal-performed` event is emitted by player-cast heals (the trigger source for
  `on-ally-critically-repaired`). **Parser gap:** Pallas's "Everliving Regeneration 3" grant
  does NOT parse (no application verb) — manual editor fallback (see §6).

  **Enemy attackers (offense-only queue actors).** Up to 4 enemy attackers act at their own
  Speed. Two flavors:
  - *Manual flat cards* — one basic attack of `attack × 100%` vs the target's defence via
    `calculateDamageReduction`, with per-hit deterministic crits.
  - *Ship-backed basics walk* — DAMAGE abilities only (active/charged cadence with the
    same team-mirror charge banking as the DPS team walk, multipliers, multi-hit per-hit
    crits). NON-damage enemy abilities (buffs/debuffs/heals on the enemy side) are **skipped
    until Phase 4**.

  **Healing ignores affinity (this increment).** Heal/shield amounts do not apply an affinity
  matchup multiplier this increment (the DPS engine does for damage). Team actors heal at
  `healModifier 0` — `CombatStatBlock` lacks the healModifier field (documented; see §6).
- **Healing backlog batch (2026-06-08, branch `feat/healing-backlog`).** A cluster of reactive
  shield/heal procs and parser cleanups, all gated on healing mode (DPS goldens byte-identical):

  **`control-applied` event + `on-stasis-applied` trigger (new machinery).** Stasis inflictions
  ("inflicts/applies Stasis") now parse into a `control` ability (conservative: ONLY Stasis;
  Provoke/Taunt stay targeting-status CONDITIONS). The cast path emits a new `control-applied`
  event so reactions can fire. The control's OWN lockout/combat effect (Stasis itself) remains
  UNSIMULATED — `control` is a TRIGGER SOURCE only, not a modeled effect. The control ability
  carries no conditions, so a gated Stasis (e.g. Crocus "if target has >3 debuffs") emits
  control-applied unconditionally; inert today (no ship both gates its own Stasis and reacts to
  it) and documented in `buildShipAbilities.ts`. Scoping is own-cast: the trigger fires for the
  inflicting actor's own Stasis casts.

  **Defiant shield-on-Stasis.** Defiant's "gains Shield equal to 30% of its Max HP when applying
  Stasis" parses into a SHIELD anchored in the "when applying Stasis" clause, riding the
  `on-stasis-applied` reactive trigger (`detectStasisAppliedTrigger`, position-scoped). Defiant's
  Stasis is on its CHARGED skill, so the shield fires on the charged cast (VERIFY in game that the
  shield procs on the charged cast and not a delayed turn).

  **APEX shield-on-debuff.** A SHIELD whose anchor falls in the "when an enemy gets debuffed"
  sentence rides `on-debuff-inflicted` (own inflictions, position-scoped — see
  `detectDebuffInflictedTrigger`). APEX gains a shield reacting to its own debuff inflictions.

  **Hermes Everliving Regeneration III reactive grant.** A supplementary BUFFS-gated
  conjoined-grant scan in `parseSkillEffects` emits a trailing self-buff in a "gains X … and
  <BuffName> for N turns" construct even when the leading conjunct consumes the verb (Hermes:
  "gains 1 charge … and Everliving Regeneration III for 2 turns"). Deduped against the segment-loop
  output and gated by BUFFS membership (arabic→roman normalized); across the full corpus the only
  net-new emission is Hermes's Everliving Regeneration III. The buff-merge loop attaches the
  `on-ally-crit` reactive trigger automatically. (Everliving Regeneration is an incoming-repair
  amplifier, NOT a HoT — see the HEALING block above.)

  **Team-actor healModifier now threaded.** `CombatStatBlock` gains a `healModifier` field and the
  team-actor heal fold reads it, so a team support ship's own gear healModifier feeds its heals
  (previously fixed at 0; see the prior §5 HEALING note, now superseded). Team-ship cards expose an
  editable Heal Modifier input.

  **Refit-active auto-fill scan alignment.** The buff auto-fill (`parseAllSkillEffects`) now scans
  the refit-active passive via `getShipSkillRows()` — the same resolver the rest of the skill model
  uses — instead of all passive tiers, so a ship no longer emits duplicate tier buffs from
  inactive refit passives.
- **Damage-leech heals & shields (2026-06-07, branch `feat/damage-leech`).** LEECH — heals/
  shields equal to a percentage of damage **dealt** or **taken** (~14 text cells / ~11 ships).
  Two new heal/shield bases `'damage-dealt'` / `'damage-taken'` plus an optional
  `leechScope: 'all' | 'detonation'` (passive damage-dealt only). For `damage-dealt`, the
  **slot decides the mechanism**: active/charged-slot = a cast rider (resolved in the heal
  block); passive-slot = a standing leech (engine `creditDamage` hook). `damage-taken` is
  **hook-owned regardless of slot** — `isHookOwned` excludes every `damage-taken` heal/shield
  from the cast path, and the per-attack proc scans the heal target's passive-slot
  `damage-taken` abilities (the only shape any ship uses). Zero RNG; all 30 goldens
  stayed byte-identical (the credit wrapper is a pure refactor; D is per-attack; DPS mode inert).
  The following rules are game-decided (user decisions 2026-06-07) or documented approximations:

  **Leech repairs draw heal crits (user decision 2026-06-07).** A leech repair (X% of damage
  dealt) DRAWS a heal crit on the separate per-actor heal crit gate UNLESS the text says the
  repair "cannot critically hit". Magnolia/Valerian/Iridium/Opal crit; Tithonus and Pallas parse
  `noCrit: true` and skip the draw (no schedule slot consumed). Rationale: the explicit "cannot
  critically hit" exemptions imply crits are the default. On the in-game verify list.

  **Standing-leech scope = ALL credited damage (user decision 2026-06-07).** A standing passive
  leech (Magnolia 20/40% self, Valerian 15% self) leeches EVERY point of damage credited to the
  actor: direct hits + DoT ticks (Corrosion / Inferno) + detonations (`leechScope: 'all'`,
  default). Valerian's "including DoT ticks" phrasing is treated as clarification, not
  differentiation — **Magnolia leeches her own Inferno ticks too**. Valkyrie's burst-heal is
  scoped to detonations only (`leechScope: 'detonation'`) — it procs only on Echoing Burst
  explosions, splitting into two abilities (self 5% + lowest-HP ally 5%). On the in-game verify list.

  **Cast-rider 'damage-dealt' basis = the cast's own direct damage (group A).** Iridium, Opal,
  Tithonus, Pallas, Quixilver-active, FrontLine active/charged. The basis resolves to THIS turn's
  cast direct-damage total (which already includes secondary/conditional sub-buckets), EXCLUDING
  detonation damage (no group-A ship detonates on the same cast). It is folded through the FULL
  heal pipeline — heal-crit draw (unless `noCrit`), `healModifier`, `outgoingHeal`, recipient
  `incomingHeal` for heals; `basis × pct` only for shields (existing convention). Emits
  `heal-performed` like any cast heal. The player-turn heal block **skips** passive-slot
  `damage-dealt`/`damage-taken` abilities (slot-partition guard — they belong to the standing
  hook / enemy-attack block; processing them here would double-count).

  **Standing-leech + damage-taken procs use a SIMPLIFIED fold and emit NO `heal-performed`.**
  Their heal fold is `amount × pct × (1 + healModifier%)` plus (unless `noCrit`) one heal-crit
  draw — NO outgoing/incoming channels (the same simplification the executor's reactive-heal fold
  uses). The crit draw reads the owner's standing `PlayerActorRuntime.crit` / `.critDamage` (base
  + gear), NOT the mid-turn folded `effectiveCrit`. Shields fold `amount × pct` only. They emit
  **no `heal-performed`** (chain guard, same as executor reactive heals) — consequence: leech
  procs never feed `on-ally-critically-repaired`. Documented. Standing procs apply **immediately
  at credit time** via a new `creditDamage(sourceId, channel, amount)` engine closure
  (`channel ∈ {direct, detonation, corrosion, inferno}`) wrapping the existing credit points; a
  DoT-tick leech lands during the enemy turn, before later queue entries (deterministic order).
  The hook no-ops in DPS mode and with an empty table is a pure refactor (goldens are the referee).

  **Damage-taken procs fire PER ENEMY ATTACK on the FULL aggregate attack damage (group D).**
  Quixilver passive (shield 25% of damage taken) and Malvex (shield 15% of "damage dealt to
  them" = damage TAKEN, recipient = self). They proc AFTER the attack's shield-first drain
  resolves, on the aggregate attack damage (never absorbing their own trigger). **Quixilver is
  gated on punch-through** — it procs only when the attack started with a shield pool > 0 AND
  dealt HP damage (the only reading consistent with the user-verified shield-first drain model).
  **Malvex is unconditional** (its "primary target" is always true in the single-target
  bombardment model). Per-ATTACK (not per-hit) is a deliberate approximation: per-hit application
  would restructure the shield-drain arithmetic and risk float-level churn on the 8 locked healing
  goldens, and the accuracy gap (mid-attack shield compounding) is below the enemy-model fidelity.
  Dead target = no procs. `runEnemyAttackerTurn` is unchanged. On the in-game verify list.

  **Out of scope (Phase-4 cells, parser-disqualified or untouched).** FrontLine R4 ("When an
  enemy uses their Charged skill…") — enemy-action reaction; gets a parser disqualifier so it
  cannot half-parse. Laika ("Shield equal to 20% of its Max HP upon removing Shield from an
  enemy") — hp-basis shield with an unparseable trigger; pre-existing behaviour untouched. Both
  noted as known Phase-4 cells. Revive/Cheat Death guard retained.

- **Phase 4a: Enemy as a full `runPlayerTurn` actor (2026-06-08, branch `feat/combat-engine-phase4a-enemy-offense`).**
  The healing-mode enemy became a FULL combat actor on the shared `runPlayerTurn` pipeline.
  The damage-only `runEnemyAttackerTurn` / `enemyTurn.ts` was retired.

  **Single-target focus-fire model.** The enemy targets the configured heal target (tank) on
  every turn. DEFERRED: positional rows / front-back-skip targeting / AoE patterns,
  death-fallback re-targeting, multi-enemy. These are Phase 4b/4d scope items.

  **Full parsed kit vs the tank.** The enemy walks its complete ability set:
  affinity-modified damage, debuffs/DoTs applied to the tank, and self-buffs to itself.
  The same `runPlayerTurn(PlayerActorRuntime)` pipeline handles both player and enemy actors;
  no separate code path remains.

  **Affinity symmetry on enemy attacks.** Enemy attacks resolve
  `computeAffinityModifiers(enemyAffinity, targetAffinity)` — the enemy's matchup against the
  heal target — scaling damage by the same affinity formula the player side uses. Affinity is
  configured per enemy attacker in the UI; auto-filled when picking a ship.

  **Real `selfHpPct` for the tank.** The heal target's current HP percentage is now live and
  fed as `selfHpPct` in the actor's condition context. This activates the DERIVABLE self-HP
  gates the parser emits: (1) **at-full-HP / above-99% gates** now correctly switch OFF when
  the actor is below full HP; (2) **Tormenter-style extra-action HP<N gates**
  (`EXTRA_ACTION_SELF_HP_RE`) switch ON when the actor's HP drops below the threshold; and
  (3) **`hpThresholdFromSentence` modifier clauses** (e.g. Los's "30% more damage when its HP
  is below 50%") become live. These are the `hp-threshold` conditions the parser marks
  derivable. **NOT activated by 4a:** Makoli/Guardian-style "below X% HP" REACTIVE HEALS
  ("When directly damaged while below 40% HP, repairs 20%") — the parser keeps "below X% HP"
  gates on REACTIVE heals MANUAL (non-derivable; see `skillTextParser.ts:485,599`), and the
  "when directly damaged" trigger itself is not yet modeled (deferred to **4c**). Real
  `selfHpPct` does not reach those repair abilities.

  **`attacked` event + live `on-attacked` trigger.** A new additive `attacked` event is
  emitted each time an actor takes damage from an enemy turn. The `on-attacked` trigger is
  now in `LIVE_TRIGGERS`: when a player actor is attacked, its `on-attacked` reactive
  abilities execute via the normal intent-queue drain. This makes the heal target's reactive
  defenses (shields, heals, charge gains triggered by being hit) fire from real combat events
  rather than being silently assume-active.

  **Per-target status stores in `statusEngine`.** The StatusEngine's debuff side was
  generalized to per-target keyed stores. The lone enemy is keyed by an `ENEMY_TARGET_ID`
  sentinel; the heal target (tank) has its own debuff store. Enemy self-buffs live in their
  own per-owner buff store. This ensures the tank's landed debuffs and the enemy's self-buffs
  are fully isolated and each conditions context reads only its own side.

  **Player condition contexts — live `enemyBuffNames` + `selfDebuffNames`.** Player actors
  now read live `enemyBuffNames` (the names of the opposing side's currently-active
  self-buffs) and `selfDebuffNames` (their own currently-landed debuffs) from the per-target
  status stores. These are name-only arrays (no double-fold with other count fields).

  **Enemy-applied DoTs tick on the tank.** DoTs that the enemy inflicts on the heal target
  now tick each round during the enemy's turn, crediting incoming damage to the tank. The
  existing DoT-tick machinery from the player side is reused. This means Corrosion, Inferno,
  and Bomb DoTs from enemy attackers deal their damage over time correctly, making survival
  estimates against DoT-heavy enemies accurate.

  **Healing UI additions.** The enemy attacker panel gains an affinity selector per enemy
  (auto-filled from the ship's affinity when a ship is selected). A new Enemy Effects round
  overview panel shows, per round, the enemy attacker's active self-buffs and the debuffs /
  DoTs they have landed on the tank.

  **KNOWN LIMITATIONS (Phase 4a — documented follow-ups, NOT bugs).**

  1. *`enemy-buff` / Provoke `self-debuff` conditions stay manual-count (not live)*. The
     engine plumbing now feeds live `enemyBuffNames` and `selfDebuffNames` through to every
     condition context. However, the ship-data conditions that gate on `enemy-buff` or on the
     Provoke-style `self-debuff` subject are emitted with `derivable: false` in
     `buildShipAbilities.ts` and the parser. Only `derivable: true` conditions (e.g. the
     "for each debuff on self" count-scaling path) consume the new live data. Flipping those
     ship gates to `derivable: true` would make the `enemy-buff`/`self-debuff` gates live,
     but would churn the 22 DPS golden snapshots (ships with those conditions would now see 0
     enemy buffs / 0 self-debuffs rather than assume-active-1). This is a deliberate
     follow-up, not done in Phase 4a.

  2. *Enemy debuffs land at 100% on the tank.* Enemy attacker ships carry no hacking stat,
     so there is no hacking-vs-security landing roll for debuffs they inflict. All enemy
     debuffs land unconditionally (`debuffLandingChance: 1`). A proper enemy hacking stat
     (and a configurable tank security stat for enemy debuff landing) is a follow-up item.

  **DPS Calculator unchanged.** No DPS goldens were touched; the 22 DPS golden parity
  scenarios are byte-identical throughout this increment. The healing result type grew
  additively (`enemySelfBuffs` / `targetDebuffs`).

- **Phase 4b: Death & revive — Cheat Death + death triggers (2026-06-09, branch `feat/combat-engine-phase4b-death-revive`).**
  Ship destruction became a first-class combat event and the reactive machinery learned to
  fire on it. Cheat Death (survive-a-lethal-hit) is now modeled.

  **Three live death triggers + Cheat-Death signal.** `on-destroyed` (self),
  `on-ally-destroyed` (ally), and `on-enemy-destroyed` (enemy) joined `LIVE_TRIGGERS`,
  alongside a new `on-cheat-death-activated` trigger. A general `ship-destroyed` event fires
  for every actor (player, team, enemy) via `recordDestroyed`, carrying a per-actor
  `destroyedRound`. The death/revive triggers drain through the same intent-queue machinery as
  the other reactive triggers; they were previously annotation-only (assume-active, §6 item 5).

  **Cheat Death.** Recognized named buffs (`CHEAT_DEATH_BUFFS` in
  `src/utils/combat/cheatDeathBuffs.ts`) let an actor survive an otherwise-lethal hit **at 1 HP,
  once per combat** (a per-actor `cheatDeathConsumed` flag), detected via `selfBuffNamesForOwners`.
  On activation the engine wipes the actor's REMOVABLE statuses (`statusEngine.clearRemovable`
  for StatusEngine timed buffs/debuffs, plus the tank's `corrosionEntries` / `infernoEntries`
  DoTs) and emits `cheat-death-activated`. Ships: Yazid, Tycho, Hayyan (grants the whole team),
  Hermes.

  **Removability — new `unremovable` concept.** Effects are now removable BY DEFAULT;
  unremovable ones are description-marked via the `UNREMOVABLE_STATUSES` name-set (seeded with
  **Acidic Decay**), and persistent-stacking debuffs are unremovable by construction. Bombs /
  Blast are left untouched (persistent). `clearRemovable` + `isUnremovable` are the reusable
  primitives 4e (cleanse/purge consumption) will build on.

  **Yazid `on-cheat-death-activated` follow-on.** Yazid repairs 60% of Max HP (once per combat)
  and gains Barrier (name-only; the shield effect is UNMODELED) in the round Cheat Death fires.

  **Salvation `on-destroyed` ally-heal re-enabled.** Salvation's "when destroyed, repair all
  allies" heal now fires on the live `on-destroyed` trigger (it was disqualified as an unmodeled
  reactive in PR #92's phantom-heal cleanup).

  **Reactive extra-action bridge.** On-kill / on-ally-destroyed extra actions are wired through
  the reactive machinery: Sokol (on-kill, once per round, DPS — the extra action lands the round
  AFTER the kill), Liberator (on-kill extra action + all-allies charge), and Harvester
  (on-ally-destroyed — WIRED BUT DORMANT in healing mode, since allies aren't attacked until 4d's
  multi-target targeting).

  **KNOWN LIMITATIONS (Phase 4b — documented follow-ups, NOT bugs).**

  1. *Hermes Cheat-Death grant ignores its HP gate.* Hermes's "if the target is below 40% HP,
     grants Cheat Death" parses as an UNCONDITIONAL all-allies Cheat Death grant — the
     below-X%-HP gate is NOT attached (the HP-threshold classifier only matches damage clauses).
     Deferred to **4c** with the other below-X%-HP reactives. (Hermes is intentionally omitted
     from the user-facing changelog Cheat-Death ship list because its grant currently over-fires
     — the below-40%-HP gate is deferred to 4c; do not advertise it as working.)
  2. *Tycho's Barrier is an HP-threshold reactive, not on Cheat-Death-activation.* Tycho grants
     Barrier "when its HP drops below 40%" — an `hp-threshold` reactive, not an
     `on-cheat-death-activated` follow-on. Not modeled in 4b; deferred to **4c**.
  3. *Harvester on-ally-destroyed extra action is wired-but-DORMANT until 4d.* In single-target
     focus-fire healing mode no ally is attacked, so the ally-destroyed event never fires; the
     listener is in place and will activate once 4d introduces multi-target targeting.
  4. *Barrier shield effect UNMODELED.* Only the named buff-grant fires (Yazid/Tycho Barrier) —
     the shield amount is not simulated, the same emitted-not-simulated convention as control
     buffs.
  5. *Salvation on-destroyed dead-caster-recipient edge.* The heal's `all-allies` scope resolves
     to all player ids with NO dead-actor filtering, so a dead caster counts as a recipient in
     `directHeal` (gross) — this only surfaces in the synthetic Salvation-as-tank case;
     `effectiveHeal` / `overheal` credit only the live target. Dead-recipient filtering is a
     **4d** concern.
  6. *On-kill extra action lands the round AFTER the kill.* Sokol / Liberator's on-kill extra
     action resolves a round late because enemy death is reconciled post-round in the DPS sim —
     a deliberate, documented model.
  7. *Cheat Death does NOT wipe passive-granted finite-duration buffs (e.g. Everliving Regeneration),
     because they are mis-modeled as infinite auras.* `clearRemovable` sweeps only the TIMED
     `selfMaps`/`enemyMaps` (+ the actor-state DoTs); it does NOT touch auras. But a buff granted on
     a **passive slot** is classified as an aura **regardless of its explicit duration**
     (`isAura = … || slot.slot === 'passive'`, engine.ts) — so Yazid's "Everliving Regeneration II
     **for 9 turns**" is modeled as an infinite recurring aura that never expires and survives Cheat
     Death's wipe. Consequence: Yazid's `on-cheat-death-activated` 60% repair keeps Everliving Regen's
     **+20% Incoming Repair** (≈48,437 on a 67,273-HP Yazid / 1440 in the unit test) — internally
     consistent with the current (buggy) buff model, but wrong vs the game: Everliving Regen is a
     **one-time start-of-combat grant**, so once Cheat Death (or a purge) removes it, it should NOT
     return. **Root-cause fix (deferred to its own increment — broad, churns DPS+healing goldens):**
     classify passive-granted buffs with an explicit finite duration as **TIMED** (one-shot, expire
     after N turns, no re-derive), not auras. That single change makes Everliving Regen last its 9
     turns AND lets the existing timed `clearRemovable` wipe it (→ follow-on flat 60%), with the
     post-wipe heal-channel recompute already prototyped. NOT done in 4b: it reclassifies every
     ship's "at start of combat, gain X for N turns" passive and needs its own golden review.
     The reactive-heal incoming/outgoing-repair scaling (PR #93) is correct under either model.

  **Goldens byte-identical.** This increment is engine + docs + labels; the 22 DPS golden parity
  scenarios remain byte-identical.

- **Phase 4c PR 1: per-hit `attacked` + self-damage reactives (2026-06-10, branch `feat/combat-engine-phase4c-self-damage`).**
  - `attacked` is now emitted PER HIT of the enemy's fired damage ability, each event carrying its
    own hit's `didCrit` (per-hit crit draws threaded out of `runPlayerTurn` via
    `PlayerTurnResult.hitCrits` — same draws, never re-drawn; `[]` for no-damage casts and
    `noCrit` abilities → fallback single event with the round binary). Damage application stays
    AGGREGATE (one shield-first drain per attack; events emit post-drain). DoT ticks/bombs/
    detonations never emit `attacked`. When PR 3 adds tank-side `hp-changed`, it stays
    once-per-attack (intended granularity asymmetry).
  - `Ability.triggerCritFilter` (`'crit'`|`'non-crit'`|absent): the on-attacked listener filters
    per hit. Isha parses as the mutually exclusive pair (3% non-crit / 6% crit, CSV typo
    `"criticall"` tolerated). Editor: "Hit filter" select on on-attacked abilities; the field is
    stripped when the trigger changes away.
  - Per-event intents: `Intent.eventCtx.counterTargetId` carries the attacker; the executor's
    debuff branch routes counter-inflictions to THAT enemy's per-target store.
    **Counter-DoT decision (spec §3.5): Warden/Shepherd-style "inflicts Corrosion on that enemy"
    lands as a NAME-ONLY debuff (`parsedEffects {}`, not a ticking DoT)** — no enemy HP race
    exists in healing mode; the named status is visible + condition-relevant. NOTE:
    `EnemyRoundEffects.debuffs` is heal-target-centric (debuffs the enemy inflicted ON the tank);
    counter-debuffs on enemy attackers are observable via `debuff-applied` events only (golden
    scenario 23 asserts via the bus) — a result-surface for them is a 4d/simulator-page concern.
  - Live drain-time `selfHpPct`: `IntentExecContext.selfHpPctFor` (heal target only; denominator
    `baseHpFor` — SAME as the cast path, deliberately not effective-max). "While below X% HP" gates
    on self-subject damage reactions now parse DERIVABLE and evaluate at drain time vs live
    post-attack HP — strict below (exactly 40% does NOT fire; golden scenario 22 locks the
    boundary). The gate applies to non-heal follow-ups too (Makoli's Disable carries the same
    below-40 condition).
  - Parser: `ParsedHealAbility.damageReaction` (self-subject + self-recipient only; may be
    present-but-empty = ungated); exported `detectDamageReactionTrigger` (sentence-scoped via
    shared `rawSentenceAround`, ally-subject guard incl. `"another ally"`,
    `"cannot/cannont critically hit"` rider scrub, `hpBelowPct` extraction). Audit parity:
    `auditSkills` consumes `buildShipAbilities` so parity is automatic; a tripwire flags
    self-subject reactions that regress to ungated on-cast.
  - **Ships now live:** Warden (3% repair + name-only Corrosion counter), Isha (3/6 pair),
    Makoli (gated 20% repair + gated Disable), Guardian (gated 20% repair + crit-only Binderburg
    Resilience), Heliodor first passive (8% self-repair), plus corpus collateral reclassified from
    phantom auras/on-cast to on-attacked: Shepherd (counter Corrosion + Attack Down), Opal
    (Attack Down II + Defense Up II), Flamel (Speed Down I + Stasis card), Iridium
    (Speed Down I/II), Panguan (Stealth), Stalwart (Legion Discipline II).
  - **Phantom over-fires removed:** Guardian's Binderburg Resilience was an unconditional
    per-round aura; the reclassified collateral ships' grants similarly stop misfiring on-cast.
    (Warden's Corrosion previously emitted NOTHING at builder level — its counter is strictly
    additive.)
  - **Deferred/known:** Heliodor's "reduce debuff durations by 1" → 4e (cleanse family);
    Heliodor 2nd passive/Cultivator/Refine/Graphite ally-subject reactions → 4c PR 2
    *(SHIPPED 2026-06-10 — see the PR 2 block below)*; Guardian's
    ally-Provoke → PR 2 *(SHIPPED — same block; the inert manual-condition Provoke artifact is
    now dropped by the rule-5 scrub)*; Panon "If directly damaged" phrasing (not "when") keeps a residual aura —
    follow-up; Purifier cleanse-on-damaged phantom — follow-up; Nayra CSV source typo
    `"When directly damage"` (missing -d) keeps Terran Bolster III unmodeled — allowlisted with
    accurate reason; consider typo tolerance later.

  **In-game verification list additions:** per-hit reaction cadence vs multi-hit enemies (Isha
  repairs once per hit?); counter-infliction landing (does Warden's Corrosion roll
  hacking-vs-security?); strict-below threshold semantics at exactly X%; reactive heals never
  crit (4b convention carried over).

- **Phase 4c PR 2: `on-ally-attacked` reactives (2026-06-10, branch `feat/combat-engine-phase4c-ally-damage`).**
  - **Trigger semantics.** `on-ally-attacked` listens on the same per-hit `attacked` events as
    `on-attacked`, but ALLY-SCOPED: it fires when ANOTHER player actor is hit by an enemy attack —
    `targetId !== ownerId && !isEnemySide(targetId)` (own hits excluded; enemy-side targets
    excluded). It fires once PER HIT (a 2-hit enemy active → 2 reactions/round), honors
    `triggerCritFilter` (`'crit'`/`'non-crit'` evaluated against each hit's own `didCrit`), and a
    new `Ability.roleFilter?: ShipRoleCategory[]` over the DAMAGED ally's role: category
    prefix-matching over `ShipTypeName` via `matchesRoleCategory` in `constants/shipTypes.ts`
    (`type === c || type.startsWith(`${c}_`)` — so `ATTACKER_DPS` etc. match `ATTACKER`).
    **Unknown/absent role on the damaged ally = NO match** (a role-filtered reaction stays
    dormant rather than inflating numbers — conservative). Absent/empty `roleFilter` = any ally.
  - **`eventCtx.damagedAllyId` routing rule.** Each fired intent carries
    `eventCtx: { counterTargetId: e.attackerId, damagedAllyId: e.targetId }`. The executor routes
    an `'ally'`-target heal or buff payload to EXACTLY `damagedAllyId` (this is what prevents the
    naive "grant to all players" over-grant); counter-debuffs (`target: 'enemy'` + `inflict`)
    still ride `counterTargetId` to the ATTACKER's per-target store (PR 1 machinery, unchanged).
    Heal recipients fall back to `healing.targetId` when no `damagedAllyId` is present (cast-path
    reactions); explicit `all-allies` targets are NOT narrowed (Heliodor p2 heals everyone).
  - **Role threading source (ship data).** `Ship.type` → healing-page auto-fill (team-ship slots,
    the heal-target pick, and healer-as-target) → `TeamActorInput.role` / `healerRole` (adapter
    input) → engine `roleByActorId` map → the listener's `roleOf(actorId)` lookup. Manual-stat
    actors have no role → role-filtered reactions stay dormant for them unless a role is set.
  - **Parser.** `detectDamageReactionTrigger` gains the ally-subject branch: ally-subject
    sentences classify as `on-ally-attacked`. The CRIT shape REQUIRES passive voice
    (`DR_ALLY_CRIT_HIT_RE`, "is critically hit") — Crocus's ACTIVE-voice "inflicts a DoT with a
    critical hit" stays `on-ally-crit-dot` (guarded by a lock test). Role words after "an ally"
    ("when an ally attacker or debuffer is directly damaged" — roles AFTER "ally", the only
    order `DR_ALLY_ROLES_RE` matches) extract into `roleFilter`. `parseHealAbilities` now
    emits ally-subject heals (flagged `damageReaction.allySubject`) and non-self-recipient
    self-subject heals (PR 1 only emitted self-recipient ones); `resolveHealTarget` resolves
    "them" with an "all allies" antecedent → `all-allies` (Heliodor p2's "repairs them").
  - **buildShipAbilities.** The heal-trigger wiring honors `allySubject` (ally-subject reaction →
    `on-ally-attacked`); the buff path threads `roleFilter` through and FORCES `target: 'ally'`
    for on-ally-attacked buff grants (so the damagedAllyId routing applies); rule-5
    self-referential status-condition artifacts are dropped (Guardian's Provoke debuff no longer
    emits a phantom self-conditioned copy).
  - **Ships now live:**
    - *Cultivator* — 8% of CULTIVATOR's max HP repaired to the damaged ally, per hit. The text's
      "within the active pattern" is approximated as ANY ally (pattern adjacency is a 4d
      targeting concern — real fix there).
    - *Refine* — Inc. Damage Down I to the damaged ally: 1 turn (first passive) / 2 turns
      (second passive). The text is recipient-less; the spec-locked reading = the damaged ally.
    - *Graphite* — Repair Over Time III (2 turns) to the damaged ally, ONLY when that ally's
      role is Attacker or Debuffer (`roleFilter: ['ATTACKER','DEBUFFER']`). The granted HoT
      ticks are REAL healing on the holder's turn, credited to Graphite
      (applier-maxHp × hotPct basis — the foreign-applier HoT rule from the healing engine).
    - *Guardian* (third clause) — Provoke (1 turn) applied to the enemy that CRITICALLY hit an
      ally: `triggerCritFilter: 'crit'` + counter-routed via `counterTargetId` to that enemy's
      per-target store. (Its pre-existing inert manual-condition Provoke artifact is dropped —
      the rule-5 scrub above.)
    - *Heliodor* (second passive) — 8% repair to ALL allies when Heliodor ITSELF is directly
      damaged (`on-attacked`, self-subject, `all-allies` recipient via the "them" antecedent
      resolution). The sentence's other half — "reduces Debuff durations by 1 turn" — is
      DEFERRED to 4e (cleanse family).
  - **Editor.** 'When an ally is attacked' trigger option on `AbilityCard`; an "Ally role filter"
    `CheckboxGroup` shown for that trigger (empty = any ally); the "Hit filter" select is now
    editable for BOTH attacked-family triggers (`on-attacked` + `on-ally-attacked`).
    `CheckboxGroup` gained `helpLabel` support + unique per-instance checkbox ids (duplicate-id
    collision across ability cards fixed).
  - **auditSkills.** Ally-damage phrasings are no longer intentionally-skipped;
    `INTENTIONAL_REACTIVE_RE` narrowed to the genuinely-unmodeled shapes: Panon "If directly
    damaged", Sansi "when hit", Lev "critical hit occurs", ally-OUTGOING "inflicts" reactions
    (Provider/Oleander/Belladonna — an ALLY attacking, not being attacked), Wusheng stealth
    rider. Audit clean: 143 ships / 0 findings.
  - **Goldens.** New healing golden scenarios 24 (per-hit ally-damage repair routing: 2-hit
    enemy → 2 × 8% reactions/round routed to the damaged tank, credited to the reacting owner)
    and 25 (role-filtered RoT grant: DEFENDER tank dormant / ATTACKER tank live with Graphite-
    credited 2500 HoT ticks from round 2). DPS goldens byte-identical.
  - **Approximations / known limitations:**
    - `attacked` events carry no damage amounts, so reactions are flat %-of-max-HP per hit —
      per-hit cadence is real, per-hit magnitude is not damage-proportional (no corpus ship
      needs it today).
    - Cultivator "within the active pattern" ≈ ANY ally (4d).
    - Heliodor p2's debuff-duration-reduction half deferred to 4e.
    - Reactive heals NEVER crit (4b convention carried over).
    - Role filter is conservative on unknown roles: a damaged ally with no role NEVER satisfies
      a `roleFilter` — dormant, not inflated.
    - In healing mode only the heal target is ever attacked (single-target focus-fire), so
      "the damaged ally" === the tank today; `damagedAllyId` routing future-proofs 4d
      multi-target targeting (the contract is already per-event, not per-mode).

  **In-game verification list additions:** Cultivator pattern adjacency (is "within the active
  pattern" really any-ally for typical formations?); Refine recipient (does Inc. Damage Down land
  on the damaged ally, the whole team, or Refine itself?); Graphite role gate against in-game
  role taxonomy (do hybrid roles count?); Guardian ally-Provoke cadence on multi-hit crits
  (once per critting hit?).

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
> **Shipped 2026-06-05 (combat-engine Phase 3, this branch — feat/combat-engine-phase3):**
> - Reactive trigger machinery: bus listeners + engine-owned intent queue; drain after
>   `round-started` and after each actor's turn body before Post Turn.
> - Live trigger set: `start-of-round`, `on-crit`, `on-debuff-inflicted`,
>   `on-ally-debuff-inflicted`, `on-bomb-detonated` (see §5 above).
> - Parser auto-classification: Hemlock/Oleander charge-on-inflict fixed to per-infliction event;
>   Enforcer/Wusheng crit-triggered debuffs/buffs; Valkyrie + ~12 others start-of-round self-buffs;
>   Lingshe bomb-detonate reactives. Non-live reactive phrasings untouched.
> - `debuff-applied` retimed to discrete infliction events only (`sourceId` added); recurring/aura
>   per-round folds stop emitting it. `dot-applied` gains `sourceId`. New `round-started` and
>   `bomb-detonated` events.
> - Editor Trigger select on `AbilityCard` with non-live trigger notes.
>
> **Shipped 2026-06-05 (team ShipSkills walk — feat/combat-engine-team-skills-walk):**
> - Team ships walk their parsed `ShipSkills` as full combat actors (see §5 "Team ShipSkills walk"
>   block above).
> - Parser ally-scope: `SkillEffect.target` granular for buff abilities; verb-aware receiver
>   detection (receiver-less "grants" → all-allies); condition-clause non-leak rule.
>   The `audit:skills` ally-scope pass parses each slot text in isolation (per-slot, not the
>   refit-state combined build) so passive grants surface too: 85 all-allies + 2 single-ally.
> - Per-actor status maps, condition contexts, gate instances, and DoT applier contexts.
> - teamDamage attribution: per-actor damage map; `RoundData.teamDamage` + `summary.teamTotalDamage`;
>   focus-actor summary fields unaffected.
> - Reactive parity: per-owner listener registration; team DoT `dot-applied` seam live.
> - Ally charge grants to all player actors; `allyChargePerRound` coexists.
> - Echoing Burst gathers all players' direct damage.
> - focusActorId / per-actor damage map engine seam (simulator-page ready).
> - UI: team cards gain stats grid, affinity select + matchup badge, full skill editor; manual
>   extras pickers retain; DPSRoundChart shows a separate team-damage cumulative line.
>
> **Shipped 2026-06-06 (extra actions + per-hit crits — feat/combat-engine-extra-actions-per-hit-crit):**
> - Per-hit crit draws: each hit of a multi-hit skill draws its own crit accumulator slot;
>   the damage multiplier is blended across hits. On-crit follow-up effects fire once per
>   critting hit. Golden scenario 20 locks the contract.
> - Extra-action abilities: `extra-action` ability type added to the model; parser detects
>   Nuqtu/Sustainer/Tormenter/Liberator/Tygr phrasings; editor exposes the type; the engine
>   re-inserts the granting actor into the round queue at its Speed position for a full extra
>   turn (once per occurrence; `oncePerRound` cap). `RoundData.extraTurns` reports the count;
>   the round tooltip shows "+N extra turn". Status durations decrement again on the extra turn.
>   Golden scenario 21 locks cadence + buff-expiry behaviour. Chakara passive-damage lock test
>   added (Task 9). Annotation-only seams: Sokol on-kill, Harvester ally-destroyed, Tithonus
>   purge-count (Phase 4 / purge modeling). Tygr Stasis → any-enemy-debuff approximation
>   documented in §5.
>
> **Shipped 2026-06-06 (ally-crit-dot reactive trigger — feat/combat-engine-ally-crit-dot):**
> - `on-ally-crit-dot` trigger: Crocus "when another ally inflicts a DoT with a critical hit,
>   inflicts Corrosion II" now simulated. `dot-applied` events carry `viaCrit` when the
>   casting ability had any critting hit; the listener fires once per qualifying event.
>   Golden scenario 22 locks the contract. Two documented approximations (per-cast not per-hit
>   attribution; once-per-event firing) and the corrosion-vs-bomb apply-time nuance are
>   recorded in §5.
> - Parser false-positive guards: Morao heal-as-secondary, Valkyrie burst-as-application,
>   Vindicator and Paracelsus reactive-proc texts now parse clean. These are deliberately
>   unmodeled content (heals and Phase-4 reactive procs) — no ability emitted, no audit
>   finding. Valkyrie gets an `auditSkills` allowlist entry for its burst-reference phrasing.
>   These fold into the existing heal/Phase-4 seam items (§6 items 6 and 9) — no new items.
>
> **Shipped 2026-06-07 (Healing Calculator engine rebuild — feat/healing-calc-engine):**
> - Item 6 (heal/shield consumption) — SHIPPED for the Healing Calculator. heal/shield/cleanse
>   parsed (`parseHealAbilities`/`parseCleanse`/`parseHealNoCrit`), emitted text-position ordered
>   by `buildShipAbilities`, and consumed by the engine in healing mode (gated on `healTargetId`;
>   DPS runs provably inert). `parseSkillHeal` (legacy flat %) deleted. See §5 HEALING for the full
>   rule set: heal formula + channels, separate per-actor heal crit gates, shield additive pool
>   (capped at max HP, drains before HP, no expiry), HoT ticking (`hotPct`), ally-heal routing,
>   dead-is-dead, reactive heal triggers (`on-ally-critically-repaired`, `on-ally-crit`), enemy
>   attackers (manual flat + ship basics walk), healing-ignores-affinity.
> - Adapter `simulateHealing`; golden suite `healingGoldenParity.test.ts` (8 scenarios). UI rebuilt
>   in the DPS-page image (healer config compare, HealTargetPanel, EnemyAttackersPanel, TeamPanel
>   reuse, Skill Editor heal/shield/cleanse fields, HealingTimelineChart + cumulative comparison,
>   survival stat).
>
> **Shipped 2026-06-07 (damage-leech heals & shields — feat/damage-leech):**
> - LEECH heals/shields parsed + simulated for the ~14 text cells / ~11 ships: two new bases
>   `'damage-dealt'` / `'damage-taken'` + optional `leechScope`. Cast riders (Iridium, Opal,
>   Tithonus, Pallas, Quixilver-active, FrontLine) fold through the player-turn heal block;
>   standing leeches (Magnolia, Valerian) + Valkyrie's detonation-scoped burst fire via a new
>   `creditDamage` engine hook; damage-taken shields (Quixilver passive, Malvex) proc per enemy
>   attack. All 30 goldens byte-identical. New healing goldens: Magnolia (Inferno-tick leech),
>   Valerian (Corrosion leech), Tithonus + Pallas (noCrit riders), Valkyrie (detonation leech),
>   Quixilver (active rider + taken passive). See §5 LEECH for the full rule set. Skill Editor
>   gains the Damage dealt / Damage taken basis options + a scope select on passive damage-dealt.
>
> **Shipped 2026-06-08 (healing backlog batch — feat/healing-backlog):**
> - New machinery: `control-applied` event + `on-stasis-applied` reactive trigger (own-cast scoped;
>   the control's own Stasis effect stays UNSIMULATED — it is a trigger source only). Stasis
>   inflictions parse into a `control` ability (conservative: Stasis only).
> - Defiant shield-on-Stasis (fires on the CHARGED cast), APEX shield-on-debuff
>   (`on-debuff-inflicted`, own inflictions) — both now simulated for the Healing Calculator.
> - Hermes Everliving Regeneration III reactive grant: a BUFFS-gated conjoined-grant scan emits the
>   trailing self-buff so the `on-ally-crit` reactive trigger attaches (was item 11 — formerly
>   mislabelled "Pallas"; the actual ship is Hermes). Single net-new corpus emission.
> - Team-actor healModifier threaded: `CombatStatBlock` gains `healModifier`; team support ships
>   heal with their own heal-boost stat (was item 12). Team-ship cards expose the input.
> - Refit-active auto-fill scan alignment: buff auto-fill scans the refit-active passive via
>   `getShipSkillRows()` — no duplicate tier buffs from inactive refit passives.
> - DPS goldens byte-identical; all healing changes gated on healing mode.
>
> **In-game verification list (healing — assumptions to confirm):**
> - *Defiant shield-on-Stasis fires on the charged cast*: Defiant's Stasis is on its charged skill,
>   so the shield procs on the charged cast in-sim. Confirm the shield grants on the charged cast
>   and is not delayed a turn.
> - *Gated-Stasis control over-emit (latent)*: the `control` ability carries no conditions, so a
>   gated Stasis (e.g. a "if target has >3 debuffs" Stasis) would emit `control-applied`
>   unconditionally. Inert today (no ship both gates its own Stasis and reacts to it); if a future
>   ship pairs a gated Stasis with an own-stasis reaction, thread the inflicting ability's
>   conditions onto the control ability (see the code note in `buildShipAbilities.ts`).
> - *Self-HoT cast-turn tick*: a self-applied Repair Over Time ticks on its own cast turn in-sim.
>   The game may delay the first tick one turn — confirm and adjust if so.
> - *Shield no-crit / no-channels*: shields use `basis × pct` only (no heal crit, no
>   healModifier/outgoing/incoming). Confirm shields do not crit or scale with repair channels.
> - *Shield no-expiry*: the absorption pool persists until drained. Confirm shields do not time out.
> - *Magnolia DoT-tick leech*: her standing leech is modeled as including her Inferno ticks
>   (`leechScope: 'all'`). Confirm in-game that her "repairs … of the damage it deals" really
>   credits DoT-tick damage and not just direct hits.
> - *Leech repairs draw crits*: leech repairs without an explicit "cannot critically hit" clause
>   crit (the explicit exemptions on Tithonus/Pallas imply the default). Confirm the explicit
>   "cannot crit" text is redundant-by-default and not a special-case exemption.
> - *Per-ATTACK damage-taken approximation*: Quixilver/Malvex shields proc on the aggregate
>   per-attack damage, not per-hit. Confirm the mid-attack shield-compounding difference is
>   negligible in practice.
> - *FrontLine R4 + Laika still unparsed (Phase 4)*: FrontLine R4's enemy-charged-skill leech
>   shield and Laika's shield-on-shield-remove remain unmodeled (Phase-4 enemy-action / hp-basis
>   trigger cells); confirm they are intentionally absent until Phase 4.
>
> **Shipped 2026-06-08 (Phase 4a — enemy as full offensive actor, branch `feat/combat-engine-phase4a-enemy-offense`):**
> - Enemy is now a full `runPlayerTurn` actor (single-target focus-fire vs the heal target).
>   `runEnemyAttackerTurn` / `enemyTurn.ts` retired.
> - Full parsed kit: affinity-modified damage, debuffs/DoTs to the tank, self-buffs to itself.
> - Affinity symmetry: enemy resolves `computeAffinityModifiers(enemyAffinity, targetAffinity)`.
> - Real `selfHpPct` for the tank: activates the DERIVABLE self-HP gates (at-full-HP
>   off-switch, Tormenter HP<50 extra-action, Los-style modifier HP<N). Makoli/Guardian
>   "below X% HP" REACTIVE heals are NOT activated — the parser keeps those gates
>   manual + the "when directly damaged" trigger is unmodeled (deferred to 4c).
> - `attacked` event + `on-attacked` trigger moved from annotation-only to LIVE (`LIVE_TRIGGERS`).
> - Per-target status stores: each target's debuffs are isolated in the StatusEngine; enemy
>   self-buffs in their own per-owner store.
> - Player condition contexts read live `enemyBuffNames` + `selfDebuffNames` (names only).
> - Enemy-applied DoTs tick on the tank each round (existing DoT-tick machinery reused).
> - UI: affinity selector per enemy attacker + Enemy Effects round overview panel.
> - DPS goldens byte-identical (22 scenarios); healing result type grew additively.
>
> **Phase 4a KNOWN LIMITATIONS (backlog follow-ups):**
> - *`enemy-buff` / Provoke `self-debuff` conditions still manual* — the live `enemyBuffNames`/
>   `selfDebuffNames` arrays are plumbed and correct, but the ship-data conditions that gate on
>   these subjects are emitted `derivable: false` (parser / `buildShipAbilities.ts`). Only
>   `derivable: true` paths (count-scaling) consume the live data. Making the ship gates live
>   requires flipping them to `derivable: true`, which would churn the 22 DPS goldens. Tracked
>   as item 11 below (renumbered from the items 11/12 that shipped in the healing-backlog batch).
> - *Enemy debuffs land at 100%* — no hacking stat on enemy actors → no hacking-vs-security
>   landing roll; `debuffLandingChance: 1` hard-coded. Tracked as item 12 below.
>
> **Shipped 2026-06-09 (Phase 4b — death & revive, branch `feat/combat-engine-phase4b-death-revive`):**
> - Three live death triggers (`on-destroyed`/`on-ally-destroyed`/`on-enemy-destroyed`) +
>   `on-cheat-death-activated`, all in `LIVE_TRIGGERS`; general `ship-destroyed` event for all
>   actors via `recordDestroyed` + per-actor `destroyedRound`.
> - Cheat Death: survive a lethal hit at 1 HP, once per combat (`cheatDeathConsumed`), recognized
>   named buffs (`CHEAT_DEATH_BUFFS`: Yazid/Tycho/Hayyan-grants-all/Hermes); on activation clears
>   removable statuses (`clearRemovable` + tank DoTs) and emits `cheat-death-activated`.
> - New `unremovable` concept: effects removable by default; `UNREMOVABLE_STATUSES` name-set
>   (seeded Acidic Decay) + persistent-stacking debuffs unremovable; Bombs/Blast left untouched.
> - Yazid `on-cheat-death-activated` follow-on: 60% self-repair (once per combat) + Barrier
>   (name-only; shield UNMODELED). Salvation `on-destroyed` ally-heal re-enabled.
> - Reactive extra-action bridge: Sokol (on-kill, lands the round after), Liberator (on-kill +
>   all-allies charge), Harvester (on-ally-destroyed — wired but dormant until 4d). §6 item 9a/9b.
> - DPS goldens byte-identical (22 scenarios).
>
> **Phase 4b KNOWN LIMITATIONS (deferrals):** Hermes Cheat-Death grant drops its below-40%-HP
> gate (parses unconditional → 4c); Tycho's Barrier is an HP-threshold reactive, not on
> Cheat-Death (→ 4c); Harvester ally-destroyed dormant until 4d; Barrier shield UNMODELED;
> Salvation on-destroyed `all-allies` has no dead-recipient filter (dead caster counts in gross
> `directHeal`; effective/overheal credit only the live target → 4d); on-kill extra action lands
> the round after the kill (post-round enemy-death reconciliation — deliberate).
>
> **Shipped 2026-06-10 (Phase 4c PR 1 — per-hit attacked + self-damage reactives, branch `feat/combat-engine-phase4c-self-damage`):**
> - `attacked` emitted per hit of the enemy's fired ability, each with its own `didCrit`; fallback
>   single event for no-damage casts/noCrit abilities; DoT ticks/bombs/detonations excluded.
> - `Ability.triggerCritFilter` (`'crit'`|`'non-crit'`|absent): per-hit listener filter. Isha pair
>   parsed (3% non-crit / 6% crit; CSV typo `"criticall"` tolerated). Editor "Hit filter" select.
> - `Intent.eventCtx.counterTargetId` threads the attacker id; executor debuff branch routes
>   counter-inflictions to that enemy's per-target store. Counter-DoT modeled as NAME-ONLY debuff.
> - Drain-time `selfHpPct` via `IntentExecContext.selfHpPctFor` (denominator `baseHpFor`); "below X%
>   HP" gates on self-subject reactions now parse DERIVABLE and evaluate post-attack vs strict-below
>   comparator (exactly 40% does NOT fire; golden scenario 22 locks the boundary).
> - `ParsedHealAbility.damageReaction` parser (`detectDamageReactionTrigger`, sentence-scoped via
>   `rawSentenceAround`); ally-subject guard; `"cannot/cannont critically hit"` rider scrub; audit
>   tripwire for self-subject regressions. `auditSkills` parity automatic via `buildShipAbilities`.
> - Ships live: Warden (3% repair + name-only Corrosion counter), Isha (3/6 pair), Makoli (gated
>   20% repair + gated Disable), Guardian (gated 20% repair + crit-only Binderburg Resilience),
>   Heliodor first passive (8% self-repair); corpus collateral reclassified from phantom auras/
>   on-cast: Shepherd, Opal, Flamel, Iridium, Panguan, Stalwart.
> - Phantom over-fires removed: Guardian Binderburg, and the reclassified ships no longer apply
>   on-cast. (Warden's Corrosion was previously emitting nothing at builder level — strictly additive.)
> - DPS goldens byte-identical (22 scenarios); 3 new healing golden scenarios (21–23).
>
> **Shipped 2026-06-10 (Phase 4c PR 2 — on-ally-attacked reactives, branch `feat/combat-engine-phase4c-ally-damage`):**
> - New `on-ally-attacked` trigger (in `LIVE_TRIGGERS`): per HIT when ANOTHER player actor is hit
>   by an enemy attack (own hits + enemy-side targets excluded); honors `triggerCritFilter` per
>   hit and a new `Ability.roleFilter` (ShipRoleCategory[] — category prefix-match over the
>   damaged ally's `ShipTypeName`; unknown/absent role NEVER matches; absent/empty = any ally).
> - `eventCtx.damagedAllyId`: 'ally'-target reactive heal/buff payloads route to EXACTLY the
>   damaged ally; counter-debuffs still ride `counterTargetId` to the attacker.
> - Roles thread from ship data: `Ship.type` → healing-page auto-fill → `TeamActorInput.role` /
>   `healerRole` → engine `roleByActorId` → listener `roleOf`.
> - Parser ally-subject branch in `detectDamageReactionTrigger` (passive voice required for the
>   crit shape; Crocus active-voice guard; role words → roleFilter); `parseHealAbilities` emits
>   ally-subject + non-self-recipient heals; "them" with "all allies" antecedent → all-allies.
> - Ships live: Cultivator (8% caster-max-HP to the damaged ally; pattern ≈ any ally → 4d),
>   Refine (Inc. Damage Down I to the damaged ally, 1t p1 / 2t p2), Graphite (Repair Over Time
>   III 2t, Attacker/Debuffer allies only — HoT ticks credited to Graphite), Guardian ally-crit
>   Provoke (counter-routed, crit-only), Heliodor p2 (8% to ALL allies when itself damaged;
>   duration-reduction half → 4e).
> - Editor: 'When an ally is attacked' trigger + Ally role filter CheckboxGroup; Hit filter
>   editable for both attacked-family triggers. auditSkills: ally-damage phrasings no longer
>   skipped; 143 ships / 0 findings.
> - DPS goldens byte-identical (22 scenarios); 2 new healing golden scenarios (24–25).
>   See §5 PHASE 4c PR 2 for full semantics + approximations.
>
> **Phase 4c–4f and simulator page (partially shipped / pending):**
> - **4c PR 1 — SHIPPED 2026-06-10** (`feat/combat-engine-phase4c-self-damage`): per-hit
>   `attacked` emission; `triggerCritFilter`; drain-time `selfHpPct`; counter-debuff routing;
>   `damageReaction` parser; Warden/Isha/Makoli/Guardian/Heliodor self-damage reactives live;
>   phantom over-fires removed for Shepherd/Opal/Flamel/Iridium/Panguan/Stalwart (see §5
>   PHASE 4c PR 1).
> - **4c PR 2 — SHIPPED 2026-06-10** (`feat/combat-engine-phase4c-ally-damage`):
>   `on-ally-attacked` reactives (Heliodor 2nd passive, Cultivator, Refine, Graphite
>   role-filtered); Guardian ally-crit-hit Provoke; `damagedAllyId` routing; role threading
>   from ship data; editor trigger + role-filter controls (see §5 PHASE 4c PR 2).
> - **4c PR 3 — pending** — `on-hp-threshold-crossed` reactives via tank-side `hp-changed`
>   (Tycho Barrier below-40% once-per-battle; Hermes Cheat-Death grant below-40% gate fix).
> - **4c PR 4 — pending** — enemy-action reactions (event-only enemy heal/cleanse emission,
>   `cleanse-performed`, reactive `damage` executor branch): Zosimos/Arum/Yarrow/Larkspur/Grif.
> - **4c PR 5 — pending** — enemy realism pair: §6 item 11 `derivable` flip for
>   `enemy-buff`/Provoke `self-debuff` gates (controlled DPS-golden regeneration) + item 12
>   enemy hacking landing roll.
> - **4c PR 6 — pending** — §6 item 10 Chakara `lowest-speed-ally` condition subject.
> - **4c follow-ups (unassigned):** Panon "If directly damaged" phrasing gap (residual aura);
>   Purifier cleanse-on-damaged phantom; Nayra CSV typo ("When directly damage") tolerance;
>   FrontLine R4 enemy-charged-skill leech shield; result-surface for counter-debuffs on
>   enemy attackers (4d/simulator-page concern); noCrit MULTI-hit enemy attacks degrade to a
>   single aggregate `attacked` event (hitCrits is [] for noCrit — unreachable today, no
>   corpus skill combines "cannot critically hit" with a hit count; fix = fill(false), no
>   gate draws).
> - **4d Targeting + multi-enemy** — taunt/stealth/provoke targeting; multiple enemies;
>   AoE; death-fallback re-targeting.
> - **4e Consumption & mitigation** — cleanse debuff consumption (today output-count only),
>   purge, control effect simulation (stasis/taunt/provoke effects), damage reduction/reflect.
> - **4f Defense-calc adoption** — defense calculator on the engine.
> - **5 Simulator page** — per-round damage/healing/defense per actor; own UX spec.

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
5. **`trigger` field** *(partially shipped 2026-06-05, Phase 3; extended 2026-06-06; `on-attacked`
   shipped Phase 4a; death/revive triggers shipped Phase 4b 2026-06-09; `on-attacked` upgraded to
   per-hit with `triggerCritFilter` Phase 4c PR 1 2026-06-10; `on-ally-attacked` shipped Phase 4c
   PR 2 2026-06-10)* — the reactive machinery now
   consumes `start-of-round`, `on-crit`, `on-debuff-inflicted`, `on-ally-debuff-inflicted`,
   `on-bomb-detonated`, `on-ally-crit-dot`, `on-attacked` (Phase 4a; upgraded to per-hit with
   optional crit/non-crit filter in Phase 4c PR 1 — see §5 PHASE 4c PR 1), `on-ally-attacked`
   (Phase 4c PR 2 — per-hit, ally-scoped, crit + role filtered; see §5 PHASE 4c PR 2), and the
   four death/revive triggers `on-destroyed` / `on-ally-destroyed` / `on-enemy-destroyed` /
   `on-cheat-death-activated` (Phase 4b — see §5 PHASE 4b). All are in `LIVE_TRIGGERS`. Remaining
   annotation-only reactives are the hp-crossing and enemy-action families deferred
   to 4c PRs 3–4.
6. **Heal/shield consumption** *(shipped 2026-06-07, feat/healing-calc-engine — see §5 HEALING
   and the shipped block above)*. heal/shield parsed + consumed by the Healing Calculator
   (DPS unaffected). Remaining heal-side seams now tracked as items 11–12 below and the Phase-4
   pointer (revive/Cheat Death, damage-reactive shields, cleanse debuff consumption, purge,
   NON-damage enemy abilities in the healing walk).
   *Parser false-positive guards (2026-06-06):* Morao's heal-as-secondary and
   Vindicator/Paracelsus reactive-proc texts parse clean with no DPS ability emitted.
7. **Team accumulating-status cadence approximation** — a team ship whose accumulating
   (stackTrigger) buff targets `all-allies` stacks on the team actor's real turns, but the
   per-round aura-inclusion tick runs on the attacker's round context. This is conservative
   (never over-counts stacks), but may mis-time the effect window by one round for team
   actors faster than the attacker. Resolution: generalize aura inclusion per actor (medium
   cost; low user-visible impact today given few ships with `stackTrigger` + ally-scope).
   Documented in §5 known approximations; introduced 2026-06-05 (team walk).
8. **Drain-time enemy-debuff counts exclude ability-sourced statuses** — `enemy-debuff gte N`
   threshold gates (Asphyxiator etc.) read `landedEnemyDebuffCount` from
   `snapshot().activeEnemyDebuffs` in `buildActorConditionContext` (`triggers.ts`), which omits
   payload-carrying ABILITY-sourced enemy debuffs. So at drain time and for foreign-caster auras
   the tally undercounts — ability-applied statuses don't increment the gate. Pre-dates the team
   walk (`buildDrainContext` used this same snapshot count before the team-walk PR) and is
   golden-locked: every hand-built drain fixture is anchored to this approximation. Resolution
   would mirror the self-side `includeAbilitySelfNames` switch with an `includeAbilityEnemyNames`
   analogue, but enabling it churns all locked drain goldens (medium cost; low user-visible impact
   given how few ships gate on enemy-debuff counts via ability-sourced statuses).
   Flagged by CodeRabbit on the team-walk PR; accepted as pre-existing Phase-3 drain semantics.
9. **Extra-action seams (death modeling + purge modeling)** — three extra-action phrasings:
   - *9a. Sokol on-kill* — **CLOSED, shipped Phase 4b (2026-06-09).** Extra action granted after
     destroying an enemy; now wired through the `on-enemy-destroyed` reactive (once per round,
     DPS). The extra action lands the round AFTER the kill (enemy death is reconciled post-round
     in the DPS sim) — a deliberate, documented model. Liberator's on-kill extra action +
     all-allies charge shipped in the same bridge.
   - *9b. Harvester ally-destroyed* — **CLOSED, shipped Phase 4b (2026-06-09).** Extra action
     after an ally is destroyed; now wired through the `on-ally-destroyed` reactive. WIRED BUT
     DORMANT in single-target focus-fire healing mode (no ally is attacked until 4d's
     multi-target targeting), so the event does not yet fire — the listener activates with 4d.
   - *9c. Tithonus purge-count* — DEFERRED to **4e**. Extra action after purging 4+ buffs in a
     single skill — requires purge mechanics (cleanse/purge consumption modeling). Remains an
     assume-active annotation ability until then.
10. **Chakara lowest-speed buff-condition gap** — Chakara's third passive applies Attack Up II
    and Defense Up II at round start when it has the lowest Speed among allies. The parser
    currently emits only the passive damage ability (60% to the highest Speed Enemy); the two
    buff abilities with the lowest-speed condition are not extracted (condition subject has no
    parser mapping). This means Chakara's self-buffs are invisible to the sim for the turns
    the condition fires. Resolution: add a `lowest-speed-ally` condition subject and emit the
    buff abilities from the passive start-of-round clause. Low user-visible impact (most
    Chakara configurations have the attacker as the slowest ship, making the condition always
    true; manual picker is a workaround). Added 2026-06-06; Task 9 locks the damage proc parse.

> *Items 11 (Hermes Everliving-Regeneration grant — formerly mislabelled "Pallas") and 12
> (team-actor healModifier) shipped 2026-06-08 in the healing backlog batch — see the shipped
> block above.*

11. **`enemy-buff` / Provoke `self-debuff` conditions still manual-count (Phase 4a follow-up)** —
    The engine now feeds live `enemyBuffNames` (enemy's active self-buff names) and
    `selfDebuffNames` (tank's own debuff names) into every player condition context. However,
    the ship-data conditions that gate on the `enemy-buff` subject (e.g. "if the enemy has
    Stealth") and the Provoke-style `self-debuff` gates are emitted `derivable: false` in
    `buildShipAbilities.ts` and the parser; only `derivable: true` conditions (the
    count-scaling path) consume the live arrays. Making the ship gates live requires flipping
    them to `derivable: true`, which would churn all 22 DPS golden snapshots (those ships
    would then see 0 enemy-buffs / 0 self-debuffs instead of the previous assume-active-1
    treatment). Deliberately deferred: the live plumbing exists; the golden-churn cost is the
    blocker. Resolution: flip `derivable` in the parser / `buildShipAbilities.ts`, regenerate
    the 22 DPS goldens under a controlled KNOWN-DIFF review (medium cost; meaningful accuracy
    gain for any ship with an enemy-buff or self-debuff gate).

12. **Enemy debuffs land at 100% on the tank (Phase 4a simplification)** — Enemy attacker
    actors carry no hacking stat, so there is no hacking-vs-security landing roll when they
    inflict debuffs on the heal target; `debuffLandingChance` is hard-coded to `1` (always
    land). Resolution: add an optional `enemyHacking` stat to the enemy attacker config and
    apply the normal landing formula. Medium cost; relevant for security-stacked tanks facing
    debuff-heavy enemies.

---

## 7. Out-of-model sim parameters (for completeness)

Flat inputs that interact with abilities but live outside `ShipSkills`: base stats
(attack/crit/critDamage/defence/hp/hacking/defensePenetration), `chargeCount` +
`startCharged` + `allyChargePerRound`, global `enemyType`, `enemyDefense`/`enemyHp`/
`enemySecurity`, affinity modifiers (damage/crit cap/crit penalty), global
attacker/enemy buff pickers, and team-ship buff/debuff contributions (driven by
`teamActors` — each team actor carries `shipSkills`, `stats`, and `affinity` when picked
from the ship list; per-actor speed/chargeCount/startCharged; the per-buff
`sourceStartCharged` fields are deprecated). Modifier abilities fold additively into the
same percentage buckets as buffs. Enemy affinity is an additional input (`enemyAffinity`)
used to compute each player actor's affinity matchup multipliers.
