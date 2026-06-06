# Skill Model Coverage: Parser/Editor vs DPS Simulation

> Living document. Last audited **2026-06-03** on branch `feat/skill-ability-editor`.
> Updated **2026-06-03** after the deterministic-crit + hard-gating ship (spec 2026-06-03-deterministic-crit-and-hard-gating-design.md).
> Updated **2026-06-03** after the combat-engine Phase 1 ship (spec 2026-06-03-combat-engine-phase1-design.md).
> Updated **2026-06-04** after the combat-engine Phase 2 ship (branch `feat/combat-engine-phase2`).
> Updated **2026-06-05** after the combat-engine Phase 3 ship (branch `feat/combat-engine-phase3`).
> Updated **2026-06-05** after the team ShipSkills walk (branch `feat/combat-engine-team-skills-walk`).
> Updated **2026-06-06** after the ally-crit-dot reactive trigger (branch `feat/combat-engine-ally-crit-dot`).
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
| `Ability.trigger` | Model now has 10 values (union extended in Phase 3 + ally-crit-dot: `on-cast`, `start-of-round`, `on-crit`, `on-debuff-inflicted`, `on-ally-debuff-inflicted`, `on-ally-crit-dot`, `on-bomb-detonated`, `on-attacked`, `on-ally-destroyed`, `on-destroyed`); parser emits all live triggers (see §5); **editor exposes a Trigger select**; sim routes the six live triggers through the reactive machinery; non-live triggers remain annotation-only (assume-active). |
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
  - Non-live triggers (`on-attacked`, `on-ally-destroyed`, `on-destroyed`) are **annotation-only**:
    abilities with these triggers behave as today (normal on-cast pipeline, manual assume-active
    conditions). The engine cannot derive them until Phase 4.
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
- **Editor Trigger select (Phase 3).** `AbilityCard` gains a Trigger `Select` listing all nine
  union values with plain-language labels. Non-live triggers render a note "Not simulated —
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
> **Phase 4 pointer (not yet started):**
> - Enemy offensive actions, `on-attacked`/`on-ally-destroyed`/`on-destroyed` consumption,
>   targeting/taunt/stealth, multi-enemy, heal/shield/cleanse/control consumption, self-HP realism.

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
5. **`trigger` field** *(partially shipped 2026-06-05, Phase 3; extended 2026-06-06)* — six
   live triggers (`start-of-round`, `on-crit`, `on-debuff-inflicted`, `on-ally-debuff-inflicted`,
   `on-bomb-detonated`, `on-ally-crit-dot`) are fully consumed via the reactive machinery. Three
   non-derivable triggers (`on-attacked`, `on-ally-destroyed`, `on-destroyed`) remain
   annotation-only (assume-active manual conditions) until Phase 4 brings enemy offensive actions
   and ship-death modeling.
6. **Heal/shield consumption** — scoped to the Healing-calc adoption spec, not DPS.
   *Parser false-positive guards (2026-06-06):* Morao's heal-as-secondary and
   Vindicator/Paracelsus reactive-proc texts now parse clean with no ability emitted —
   deliberate non-coverage, deferred here.
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
9. **Annotation-only extra-action seams (Phase 4 / purge modeling)** — three extra-action
   phrasings are deliberate annotation stubs, not yet simulated:
   - *Sokol on-kill*: extra action granted after destroying an enemy — requires ship-death
     modeling (Phase 4).
   - *Harvester ally-destroyed*: extra action after an ally is destroyed — requires ally-death
     events (Phase 4).
   - *Tithonus purge-count*: extra action after purging 4+ buffs in a single skill — requires
     purge mechanics (cleanse/purge modeling, also Phase 4 / Healing-calc seam).
   Until those events are derivable these three remain assume-active annotation abilities.
10. **Chakara lowest-speed buff-condition gap** — Chakara's third passive applies Attack Up II
    and Defense Up II at round start when it has the lowest Speed among allies. The parser
    currently emits only the passive damage ability (60% to the highest Speed Enemy); the two
    buff abilities with the lowest-speed condition are not extracted (condition subject has no
    parser mapping). This means Chakara's self-buffs are invisible to the sim for the turns
    the condition fires. Resolution: add a `lowest-speed-ally` condition subject and emit the
    buff abilities from the passive start-of-round clause. Low user-visible impact (most
    Chakara configurations have the attacker as the slowest ship, making the condition always
    true; manual picker is a workaround). Added 2026-06-06; Task 9 locks the damage proc parse.

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
