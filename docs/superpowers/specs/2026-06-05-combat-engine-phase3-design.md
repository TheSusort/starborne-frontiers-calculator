# Combat Engine Phase 3: Reactive Triggers

**Date:** 2026-06-05
**Status:** Approved design
**Baseline:** `main` after PR #82 (combat-engine Phase 2 + post-merge game-rule corrections)
**Builds on:** `docs/superpowers/specs/2026-06-03-combat-engine-phase1-design.md` (engine core,
event bus, "Contract for Phase 3") and `docs/superpowers/specs/2026-06-04-combat-engine-phase2-design.md`
(once-per-round speed-ordered turn queue, owner Post-Turn decrement, action-fed status engine,
application-time landing persistence).

## Problem

The ability model has carried a reactive `trigger` field since Phase 1
(`'on-cast' | 'start-of-round' | 'on-crit' | 'on-attacked' | 'on-ally-destroyed' | 'on-destroyed'`,
types/abilities.ts) but the engine consumes only `on-cast`. Reactive ship mechanics are
approximated as condition gates, with two classes of error:

1. **Wrong cadence.** Hemlock-style "gains 1 charge after it inflicts a debuff" is parsed as an
   `enemy-debuff` count condition whose un-thresholded count SCALES the charge gain per standing
   enemy debuff — too fast. Game-verified rule (2026-06-04): +1 per INFLICTION EVENT (a landed
   debuff/DoT application by this unit this turn), not per standing debuff.
2. **Wrong timing.** Crit-inflicted debuffs ("When this Unit critically hits an enemy it inflicts
   Defense Shred" — Enforcer) and start-of-round buffs (Valkyrie's "Speed Up II for 1 turn at the
   start of the round") are modeled as always-on conditions/auras instead of discrete reactions
   with real windows.

Phase 2 built the structure reactions need (real turns to react to). Phase 3 wires the Phase 1
listener contract: events → listeners → intents → enqueued follow-up ability executions.

## Decisions (user-confirmed during brainstorming)

| Question | Decision |
|---|---|
| Live triggers | `start-of-round`, `on-crit` (self), `on-debuff-inflicted` (self — required by the Hemlock fix), `on-ally-debuff-inflicted` (team-turn derivable), `on-bomb-detonated`. All five confirmed. |
| Non-derivable triggers | `on-attacked`, `on-ally-destroyed`, `on-destroyed` and all phrasings the sim cannot derive (ally crits, enemy cleanses/repairs, on-kill, ally damaged, enemy charged-active) stay manual assume-active — current behavior, zero churn. |
| Extra End-of-Round Actions | OUT — own later increment. The Task-1 turn-count-agnostic loop is the seam. |
| `debuff-applied` retiming | Pure retime: the event means a discrete INFLICTION event only. No `debuff-persisted` split (no consumer needs it). Recurring/aura per-round folds stop emitting it entirely (see Events). |
| Editor | `AbilityCard` gets an editable Trigger select (all union values); non-live triggers marked "Not simulated — treated as assume-active". |
| Architecture | Approach A: bus listeners + engine-owned intent queue (the Phase 1 contract), over inline dispatch or post-turn event-log replay. |
| Family-blocked applications | A landed-but-family-blocked application still counts as an infliction event (the unit did inflict; the stronger buff persisted). |

## Trigger model

`AbilityTrigger` gains three values:
`'on-debuff-inflicted' | 'on-ally-debuff-inflicted' | 'on-bomb-detonated'` (union now nine).

| Trigger | Live? | Event key | Coverage (docs/ship-skills.csv survey 2026-06-04) |
|---|---|---|---|
| `on-cast` | default | — (normal pipeline) | everything else |
| `start-of-round` | YES | `round-started` | Valkyrie et al. "at the start of the round" self-buffs (~13 occurrences of the phrase, subset are reactive self-buffs); Judge's passive damage stays on its existing special-cased path |
| `on-crit` | YES | `ability-performed` with `didCrit && actorId === attacker` | "When this Unit critically hits an enemy it inflicts X" ×2 (Enforcer Defense Shred), crit-triggered self-buffs (Wusheng stealth) |
| `on-debuff-inflicted` | YES | `debuff-applied` / `dot-applied` with `sourceId === attacker` | Hemlock charge ("this Unit inflicts a Debuff" ×1 + charge texts) |
| `on-ally-debuff-inflicted` | YES | `debuff-applied` with `sourceId` = a team actor | Oleander charge, "ally inflicts a debuff" ×2 (+ Corrosion variants ×2 — team DoTs deferred, so only the debuff form is derivable) |
| `on-bomb-detonated` | YES | `bomb-detonated` | ×3 reactives (Lingshe stealth, enemy charge removal, Echoing Burst repairs) — payloads are all currently not-simulated types, so the trigger is wired but DPS-neutral today |
| `on-attacked` | no | — | enemy takes no offensive actions until Phase 4 |
| `on-ally-destroyed` | no | — | allies never die in-sim |
| `on-destroyed` | no | — | self never dies in-sim |

Abilities with non-live triggers behave exactly as today: normal on-cast pipelines, manual
assume-active conditions. The trigger value is annotation only until a later phase makes it live.

**Infliction event definition** (game-verified 2026-06-04): each landed timed debuff application
+ each landed DoT config entry applied by that unit that turn. A cast landing 2 debuffs = 2
events = +2 charges for Hemlock-style gains. Family-blocked-but-landed applications count.
Recurring/aura per-round folds do NOT count (standing effects, not inflictions). Per-standing
scaling stays correct and untouched for "per buff/debuff ON the target" texts (Nuqtu/Rhodium).

**`on-crit` granularity:** the engine's crit is decided once per attacker action stream
(deterministic `roundCrit`), so the trigger fires once per crit TURN, not per hit — multi-hit
skills aggregate. Documented limitation.

## Events (`events.ts`)

- **`debuff-applied` retimed + `sourceId` added.** Fires only at discrete infliction events:
  attacker ability-sourced timed applications, scheduled timed applications (attacker + team,
  via `sourceFired`), with `sourceId` = the inflicting actor. Recurring/aura per-round folds
  STOP emitting it — if they emitted per round, a standing aura debuff would feed a
  charge-on-inflict listener every round, which is exactly the too-fast bug being fixed. The
  pre-Phase-3 per-round emission had no production consumer (only the emission test).
- **`dot-applied` gains `sourceId`** (the inflicting actor) — DoT applications are infliction
  events for `on-debuff-inflicted`.
- **New `round-started`** (round) — emitted at the round boundary (where `statusEngine.beginRound`
  runs, before the first turn). DEVIATION from the Phase 1 contract's `start-of-round` →
  `turn-started` mapping, which was written when 1 round = 1 turn; with multi-actor rounds
  `turn-started` fires several times per round and is the wrong key. Doc note at the union.
- **New `bomb-detonated`** (actorId = bomb owner/attacker, round, stacks, damage) — emitted per
  burst from `processBombs` (countdown expiry, on the enemy's turn) and from `detonate()`'s bomb
  branch (skill-driven). The post-round aggregate `dot-detonated` tap is unchanged.

## Engine flow

### Task 1 — structural prep (MUST be first; zero golden churn)

The round loop's row assembly assumes exactly one attacker turn per round (definite-assignment
round-scoped locals, `attackerHasActed` flag, `teamResistedEnemyDebuffs` staging). Enqueued
follow-up executions break that assumption. Restructure first, gated by ZERO golden churn:

- Extract the attacker turn body into `runAttackerTurn(...)` returning its row contributions
  (`action`, `roundCrit`, `enemyHpPct`, `dotsConfig`, `dotsLanded`, `activeSelfBuffsForRound`,
  landed/resisted lists, damage numbers, `AttackerRoundCtx`).
- The round loop folds turn results into a round accumulator tolerating 0..N attacker turns per
  round (the EoR-actions seam, though EoR itself is out of scope).
- Unify the attacker's loop-local `charges` onto `attacker.charges` (the `CombatActor` field
  team actors already use) — the intent executor needs one mutation point.
- engine.ts (~1580 lines) gets decomposed where it serves the extraction (attacker-turn module
  split out); no gold-plating. The `sourceFired`/landing-hook/`timedBySource` seams in
  statusEngine.ts were built for extension — read their doc comments before reshaping.

### Listener registration

The engine always creates an internal bus. `input.bus`, if provided, remains a pure external
write-only tap — its listeners attach to the same bus (registered before the engine's own) and
must not mutate state, unchanged contract. Walking `shipSkills.slots` at setup, abilities whose
trigger is in the live set are EXCLUDED from the on-cast pipelines (status registration, charge
auras, firing-skill sourcing) and instead registered as reactive listeners in slot/text order —
fixed registration order = fixed execution order. Listeners are pure: matching event in → push
`{ ability, sourceSlot, triggeringEvent }` onto the engine's intent queue. Only the engine
mutates state (Phase 1 contract).

### Drain points

1. After `round-started` emission — start-of-round intents execute before any turn.
2. After each actor's turn body, BEFORE that actor's Post Turn — follow-ups are "consecutive
   actions" within the turn (combat-system.md §6); statuses they apply obey the Phase 2
   same-turn decrement rule.

A triggered effect never boosts the hit that triggered it (Enforcer's crit-inflicted Defense
Shred lands after the crit, affecting later rounds) — game-accurate.

### Chaining

Intent execution emits events (a triggered debuff infliction emits `debuff-applied`), which feed
listeners again — follow-ups chain like the game's consecutive actions. A per-drain generation
counter (named const `MAX_INTENT_GENERATIONS = 10` — a safety backstop far above any real chain,
not a tuned value) converts a pathological loop into a thrown error rather than a hang.
Determinism holds: FIFO queue, `makeRateGate` accumulators drawn in execution order, identical
inputs → identical outputs.

### Intent executor

A small dispatcher reusing existing machinery:

| Ability type | Execution |
|---|---|
| `charge` | `actor.charges = min(charges + amount, chargeCount)` — cap as today; attacker only |
| `buff` | timed application via `statusEngine.applyTimedAbilityStatus` (family rule applies). Reactive buffs bypass the aura-by-passive-slot classification — their duration decides; no duration → default 1 turn (an edge case, not the common path: the start-of-round parser path always keeps the parsed duration; the fallback covers editor-set triggers on duration-less buffs) |
| `debuff` | landing rules at execution (`landsTimedEnemyApplication`), family rule, emits `debuff-applied` (chainable) |
| `dot` | append via the `applyNewDoTs` path with its own landing draw at execution |
| other (heal/control/named no-effect buffs) | a named buff with no parsed effects applies (DPS-neutral); not-simulated types skip silently — the bomb-detonate payloads land here |

### Ally inflictions

`statusEngine.sourceFired` gains an `appliedEnemy` return (alongside the existing
`resistedEnemy`) so team-turn landed timed applications emit `debuff-applied` with the team
actor's `sourceId` — the key for `on-ally-debuff-inflicted` (Oleander). Team DoT lists stay
deferred, so ally inflictions = team timed debuff applications only. Without `teamActors`
configured, ally-triggers never fire (manual baseline preserved).

## Parser (`src/utils/skillTextParser.ts`)

- **Charge-on-inflict fix (game-verified):** `classifyChargeCondition`'s `inflict + debuff`
  branch (~line 355) stops returning the `enemy-debuff` count condition. The charge ability is
  emitted with `trigger: 'on-debuff-inflicted'` (Hemlock) or `'on-ally-debuff-inflicted'` when
  `ALLY_INFLICTS_DEBUFF_RE` matches (Oleander), amount = flat +1 per event. Per-standing scaling
  untouched for "per buff/debuff ON the target" texts (`PER_BUFF_CHARGE_RE`, count thresholds —
  Nuqtu/Rhodium).
- **Crit-inflicted debuffs:** "When this Unit critically hits an enemy it inflicts X" → the
  debuff/DoT ability gets `trigger: 'on-crit'`.
- **Start-of-round self-buffs:** "gains X for N turns at the start of the round" → buff ability
  with `trigger: 'start-of-round'`, duration kept — real timed windows instead of the
  passive-aura approximation.
- **Bomb-detonate reactives:** "When this Unit detonates a Bomb…" / "When a Bomb explodes…"
  payloads → `trigger: 'on-bomb-detonated'`.
- **Non-derivable reactive phrasings keep their current modeling untouched** — only the five
  live triggers are parser-assigned this phase.
- Clause detection must respect the abbreviation-period masking ("Inc."/"Out." buff-name periods
  break sentence-split clause scoping) — in BOTH the parser and `auditSkills`.

**Audit script** (`npm run audit:skills`): mirrored classification updates. The implementation
includes a proper audit run enumerating every reclassified ship (Hemlock, Oleander, Enforcer,
Valkyrie, Lingshe at minimum).

## Editor (`AbilityCard`)

A Trigger `Select` (shared `Select` component, label "Trigger") listing all nine union values
with plain-language labels. Non-live triggers render a Phase-0-style note "Not simulated —
treated as assume-active". Default stays `on-cast` (`abilityDefaults.ts` unchanged). Changing
the trigger on a buff/debuff/dot/charge ability is sufficient to route it through the reactive
machinery — no other editor plumbing.

## Public API

`DPSSimulationInput` / `DPSSimulationResult` / `RoundData`: **no changes.** Triggered charge
gains surface through the existing `charges` field; triggered statuses appear in the existing
active/landed lists on subsequent rounds.

## Determinism

Zero-RNG holds. All gates remain `makeRateGate` accumulators; triggered debuff/DoT landings draw
at execution time in deterministic queue order; listener registration order is slot/text order;
identical inputs → identical outputs.

## Testing

**Golden parity (18 snapshots) is the referee.**

- Task 1 (restructure) and the `debuff-applied` retiming: zero churn — pure relocation /
  emission-only change.
- Trigger tasks: every snapshot diff must trace to a reclassified ship in a fixture.
  Expected KNOWN-DIFF sources:
  - **KD-1 charge-on-inflict cadence:** fixtures with Hemlock-style ships — charge cadence slows
    from per-standing-debuff scaling to per-infliction (+1/event). The point of the fix;
    hand-verify round-by-round.
  - **KD-2 crit-inflicted debuffs:** the debuff lands only on actual crit turns, starting the
    round after the crit, instead of the prior always-on approximation.
  - **KD-3 start-of-round buffs:** aura → timed window semantics.
  - Implementation starts with a fixture audit enumerating which of the 18 hit each KD; anything
    outside the list is a regression.

**New behavioral tests:**

- Hemlock: cast landing 2 debuffs → +2 charges; standing aura debuff → no gain (recurring-fold
  non-emission); resisted application → no charge; family-blocked-but-landed → +1.
- Oleander: team actor's landed timed debuff → +1 attacker charge on the team turn; no
  `teamActors` → no gains.
- Enforcer: crit turn → Defense Shred applied after the hit (this round's damage unaffected,
  active next round); non-crit turn → nothing.
- Start-of-round: 1-turn buff applied at the round boundary, active during the attacker's turn,
  expires at owner Post Turn.
- Chaining: triggered debuff infliction feeds an on-debuff-inflicted charge listener in the same
  drain; generation cap throws on a constructed loop.
- Determinism: two identical runs byte-equal; listener execution order = slot/text order.
- Events: `debuff-applied` infliction-only + `sourceId`; `round-started`; `bomb-detonated`.
- Parser: each reclassification + Nuqtu/Rhodium per-standing unchanged. The `chargedRounds`
  helper in statusEngine.test.ts is checked against any banking-rule touch (none expected).

**Live verification:** dev server + chrome tools against the user's imported fleet
(localhost:3002 origin, 212 ships) on Hemlock/Oleander/Enforcer configs at the end.

## Docs & housekeeping riding the branch

- `docs/skill-model-coverage.md` §5–6: trigger consumption shipped; backlog item 5 partially
  closed (live set vs still-manual set).
- `DocumentationPage`: short reactive-triggers paragraph.
- **Changelog consolidation (user directive):** merge the existing DPS-related
  `UNRELEASED_CHANGES` entries (DPS/editor upgrade, passive charge auras, Phase 2 turn order,
  buff-family fix, Valerian fix + turn-order strip) into ONE evolving DPS entry; the Autogear
  Effective HP entry stays separate. All future DPS-calc work updates that one entry until the
  combat-engine phases are done.

## Out of scope

- Extra End-of-Round Actions (Nuqtu/Liberator/Chakara) — own later increment; the
  turn-count-agnostic loop is the seam.
- Team DoT lists and the full ShipSkills walk for team ships (own spec; target-routing semantics
  is its open problem).
- Enemy offensive actions, `on-attacked`/`on-ally-destroyed`/`on-destroyed` consumption,
  targeting/taunt/stealth, multi-enemy, heal/shield/cleanse/control consumption, self-HP realism
  (Phase 4).
- Turn-meter manipulation; positioning-based tie-breaks.
- Migrating Judge's start-of-round passive damage onto the trigger machinery (stays
  special-cased; zero churn).

## Workflow constraints (unchanged)

- Golden discipline per-task; never vitest `-u`; pre-commit hook runs the full suite.
- docs/ is gitignored — `git add -f` for this spec and the plan.
- Branch: `feat/combat-engine-phase3`; subagent-driven implementation with two-stage review per
  task.
