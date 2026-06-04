# Combat Engine Phase 1: Turn-Engine Refactor, Dynamic Buff Gating, and Editor Guardrails

**Date:** 2026-06-03
**Status:** Approved design
**Baseline:** `main` after PR #72 (skill-ability-editor) and the deterministic-crit + hard-gating ship
**Supersedes:** the "per-round gate filter" approach sketched for backlog item 2 in `docs/skill-model-coverage.md` §6

## Problem

Two related problems, one direction:

1. **Static buff gating produces wrong DPS numbers.** Buff/debuff abilities are converted
   once (`buffAbilitiesToSelectedBuffs`) against a sentinel context and scheduled by
   `computeBuffTimeline`; their conditions are never re-evaluated. A "gain Attack Up when
   the enemy has 3+ debuffs" buff is either always on the timeline or never — the live
   per-round debuff count doesn't gate it. Ships with threshold-gated buffs
   (Crocus/Nuqtu/APEX-style) simulate incorrectly.
2. **The sim's architecture blocks the roadmap.** We want ships reacting to other ships
   (reactive `Ability.trigger` values: `on-crit`, `on-attacked`, `on-ally-destroyed`),
   which requires events/listeners and ship turn order — the structure described in
   `docs/combat-system.md`. The current `simulateDPS` (one 816-line function over a
   precomputed buff timeline) cannot grow into that. Bolting dynamic gating onto the
   precomputed timeline would be scaffolding we tear down later.

Decision: refactor now. Restructure the DPS simulator into a combat-engine core shaped
after `docs/combat-system.md`, with dynamic buff gating falling out of in-loop buff
application, and an event bus as the seam for future reactive mechanics.

Plus one small independent fix (Phase 0): the editor lets users configure ability types
and placements the sim silently ignores.

## Roadmap (north star)

`src/utils/combat/` implements combat-system.md's flow — Combat Loop (turn meter) →
Process Turn (Pre Turn → Create Skill List → Process Skill Abilities → Post Turn) — with
an event bus threaded through it. The DPS calculator is a degenerate configuration of
that engine: one acting ship, a dummy enemy, deterministic resolution.

| Phase | Scope | Status |
|---|---|---|
| **0** | Editor guardrails: mark not-simulated types, warn on passive-slot no-ops | **this spec** (ships first, own PR) |
| **1** | Engine core, attacker-only: turn loop, in-loop buff application with live condition gating, event bus (emit-only), DPS adapter | **this spec** |
| 2 | Ships act in order: team ships + enemy become actors with speed-based turn meter; team buffs apply on their actual turns; enemy turns exist; durations decrement in the owner's Post Turn | future spec |
| 3 | Reactive triggers: `Ability.trigger` consumed via event listeners enqueuing follow-up ability executions | future spec |
| 4 | Full combat sim: targeting/taunt/provoke/stealth, multi-enemy, hit checks, heal/shield/cleanse/control consumption, own page, PvP/PvE round limits | future spec |

Each phase is its own spec → plan → implementation cycle. This spec covers Phases 0–1.

## Phase 0: Editor guardrails

Decisions (user-confirmed):

- **Not-simulated types stay pickable, marked clearly.** `heal`, `shield`, `cleanse`,
  `purge`, `control` remain in `AbilityTypePicker` (the Utility category) with a visible
  "not simulated in DPS" note, and `AbilityCard` shows the same note on existing
  abilities of these types (today's default case renders only "No editable fields for
  this ability type."). They are kept as annotations for the future Healing-calc /
  combat-sim phases.
- **Passive-slot no-ops warn, don't block.** When a `dot`, `charge`, `detonate-dot`,
  `accumulate-detonate`, or `additional-damage` ability sits on the **passive** slot,
  `AbilityCard` shows a visible warning ("Not simulated on the passive slot") — the sim
  sources these types from the firing skill only. Saving stays allowed so real ship
  passives can be documented ahead of sim support.

Touch points: `src/components/skills/AbilityTypePicker.tsx` (type buttons / labels),
`src/components/skills/AbilityCard.tsx` (default case at ~477-482; new slot-aware
warning — the card needs to know its slot, passed down from `SkillEditorModal`'s existing
`slot` prop). Reuse existing patterns: `helpLabel`, `text-xs text-theme-text-secondary`
notes (no emojis, per project convention).

Phase 0 is independent of Phase 1 and ships first as its own small PR with a changelog
entry.

## Phase 1: Engine core (attacker-only)

### Module layout — new `src/utils/combat/`

| File | Responsibility |
|---|---|
| `state.ts` | `CombatState` types: `actors[]` (id, side `player`/`enemy`, base stats, current HP, speed, turn meter, statuses, DoT stacks, skill charge state), turn/round counters |
| `engine.ts` | The combat loop: tick turn meter → select actor → Pre Turn (decrement charge cooldowns, queue charged skill) → fire skill (abilities in text order, as today) → Post Turn (decrement buff/debuff/DoT durations, expire, reset turn meter) |
| `statusEngine.ts` | In-loop buff/debuff application and per-turn aura/effect resolution (see below) |
| `events.ts` | Typed `CombatEvent` union + synchronous bus |
| `resolution.ts` | Existing deterministic schedules moved verbatim: crit accumulator, hacking/affinity landing rolls, crit-power extend chance. Zero-RNG stays; this is the seam where an RNG/Monte-Carlo policy could plug in later |

`src/utils/calculators/dpsSimulator.ts` becomes a thin adapter:
`DPSSimulationInput` → engine setup → run → fold engine output into
`RoundData[]` / `DPSSimulationResult`. **Public API shapes (`DPSSimulationInput`,
`DPSSimulationResult`, `RoundData`) are unchanged — the DPS page and `DPSBuffPanel` are
untouched.** (`DPSBuffPanel` imports only the `ActiveBuff` type; it moves or re-exports.)

In Phase 1 the actor list is `[attacker, enemyDummy]`. Only the attacker acts; the enemy
actor is where today's loop-local enemy state moves to (HP pool, landed debuffs, DoT
entries, bombs, accumulators). Each engine round = one attacker turn — 1:1 with today's
rounds, so DPS outputs stay comparable.

### In-loop buff application (backlog item 2)

When a skill fires, its `buff`/`debuff` abilities apply **at that moment**, conditions
evaluated against live engine state via the existing `evaluateConditions`:

- **Timed buffs (finite duration)** — gate at application. Condition false → that
  application is skipped. Condition true → the status persists its full duration
  regardless of later state. Re-application refreshes as today.
- **Recurring/permanent buffs** (typical passives) — conditional auras. They stay in the
  status list; their *effect* is included each turn only if their conditions pass that
  turn.

This **replaces** the sentinel static gate (`buildStaticBuffContext`), the
condition-neutralization hack (`staticGateConditions`), and `computeBuffTimeline`.
Buff/debuff abilities flow into the engine directly with conditions intact — the
`SelectedGameBuff` conversion drops out of the sim path (it survives only where the
editor/buff-picker round-trip needs it).

**Externally scheduled effects stay scheduled in Phase 1:** manual picker buffs and
team-ship contributions (`SelectedGameBuff` with `skillSource` / `skillDuration` /
`sourceChargeCount` / `sourceStartCharged`) enter via a small scheduler that applies
them on their computed rounds (reusing `computeChargeSchedule`, which relocates from
`buffTimeline.ts` into `src/utils/combat/` alongside this scheduler), condition-less —
same behavior as today. Phase 2 replaces team scheduling with real turns.

**Determinism and ordering rules:**

- Condition contexts snapshot at defined points. The debuff-count context is built
  before the firing skill's own new DoT applications land (preserving today's
  "context built before Step-3" semantics).
- Within a turn, enemy-debuff applications resolve before self-buff gates — so "gain X
  when the enemy has ≥N debuffs" sees this turn's debuffs deterministically. This
  single-pass order (debuffs → recount → self-buffs) breaks the circularity without
  fixpoint iteration.
- **Live-subject rule:** only sim-derivable subjects gate dynamically — `enemy-debuff`
  count, `hp-threshold`, `enemy-hp-pct` / `enemy-hp-missing-pct`, `self-buff` presence,
  `self-crit`, `enemy-type`. Non-derivable subjects (`adjacent-ally`, `enemy-adjacent`,
  `enemy-destroyed`, `enemy-buff`, `self-debuff`, ally-event subjects) keep today's
  semantics: satisfiable-in-principle unless a **manual** count threshold gates them.
  Without this rule they would flip from "included" to "always excluded", since their
  live counts are hardcoded 0.

**No-double-count invariant (restated for the new architecture):** ability-sourced
buffs/debuffs enter the engine **only** directly from `ShipSkills`; converted
`SelectedGameBuff` arrays enter **only** from the manual pickers and team ships. The
conversion call for the attacker's own abilities is deleted in the same change, with a
test asserting a buff ability contributes exactly once.

All other mechanics keep their exact math, relocated not rewritten: DoT
application/tick steps, extend-dot (incl. deterministic crit-power schedule),
detonate-dot, accumulate-detonate, charge gain, per-round modifier evaluation
(`modifierTotalsFromAbilities` against the engine's turn context), affinity math,
firing+passive slot sourcing rules.

### Event bus

`events.ts` defines a typed `CombatEvent` union emitted at fixed points:

`turn-started` / `turn-ended` (actor, round) · `skill-fired` (actor, slot, name) ·
`ability-performed` (actor, target, ability type, payload: damage, didCrit, didHit) ·
`buff-applied` / `buff-expired` · `debuff-applied` / `debuff-resisted` ·
`dot-applied` / `dot-ticked` / `dot-detonated` · `hp-changed` (target, old/new pct) ·
`ship-destroyed`

**Phase 1 behavior:** the engine emits all of these EXCEPT `buff-expired`, which is
declared in the union but intentionally unemitted until Phase 2 moves duration expiry
into the owner's Post Turn (see the doc note in `events.ts`) — consumers must not expect
it in Phase 1. The only consumer is the DPS adapter's round-log builder (deriving
`RoundData` breakdowns from events where convenient; direct accumulation where simpler —
emission is the contract, consumption is incremental). No ability-driven listeners yet.

**Contract for Phase 3:** listeners are registered per-combat (`bus.on(type, fn)`),
synchronous, and deterministic (fixed registration order = fixed execution order).
Listeners never mutate state — only the engine mutates state; listeners produce
*intents* (enqueued follow-up ability executions), mirroring combat-system.md §6's
follow-up-skill semantics. Reactive `Ability.trigger` values map onto event types:
`on-crit` → `ability-performed` with `didCrit`; `on-attacked` → `ability-performed`
where target = self; `on-ally-destroyed` → `ship-destroyed`; `start-of-round` →
`turn-started`. (`on-cast` is the default non-reactive trigger and `on-destroyed` is
self-destruction — both intentionally unmapped here.) The union is defined now so
Phase 1 emits everything Phase 3 needs.

### Testing

- **Golden parity first.** Before touching the sim, capture snapshot fixtures from the
  *current* `simulateDPS` for a corpus of representative configs: plain damage, DoT
  ships, charge ships, conditional modifiers, buff/debuff ships, team buffs, affinity
  cases. The refactored engine must reproduce them exactly — **except** configs with
  condition-gated buffs, where diffs are the point; those get hand-verified expected
  values and become the new gating tests.
- **New gating tests:** ramping enemy-debuff count switching a buff on mid-fight;
  declining enemy HP switching one off; aura on/off flicker across rounds; timed-window
  persistence after the condition lapses; skipped application followed by a passing
  re-application.
- **Retired/adapted:** `buffTimeline.test.ts` dies with the module.
  `computeChargeSchedule` survives (external scheduled effects + charge math) and keeps
  its tests. `buffAbilityConverters` tests for the static gate shrink to the surviving
  editor round-trip paths.

### Risks and mitigations

1. **Decomposing the 816-line `simulateDPS`** — mitigated by golden parity tests and
   moving math verbatim before changing behavior.
2. **Double-counting during transition** (ability buffs entering both directly and via
   conversion) — conversion call deleted in the same change; invariant test.
3. **`RoundData` derivation drift** — the adapter asserts per-round damage totals equal
   engine-state HP deltas in tests.

### Docs and changelog

- Update `docs/skill-model-coverage.md`: timeline/static-gate sections (§5), backlog
  (§6), slot-sourcing notes that reference `computeBuffTimeline`.
- `UNRELEASED_CHANGES` entries: Phase 0 editor warnings; Phase 1 "conditional buffs now
  switch on/off based on live combat state" fix.
- `DocumentationPage` only if user-visible wording changes.

## Out of scope (this spec)

- Multi-actor turns, speed inputs, turn-meter manipulation effects (Phase 2)
- Reactive trigger consumption, follow-up skills (Phase 3)
- Targeting, taunt/provoke/stealth, hit checks, multi-enemy, heal/shield/cleanse/purge/
  control consumption, self-HP realism (Phase 4 / separate backlog items)
- Backlog item 3 (passive-slot sourcing audit) — unchanged by this work
