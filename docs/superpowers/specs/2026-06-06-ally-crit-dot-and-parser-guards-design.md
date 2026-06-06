# Ally-Crit-DoT Reactive + Parser False-Positive Guards — Design

**Date:** 2026-06-06
**Status:** Lighter spec (small increment, per the increment-1/2 precedent)
**Branch:** `feat/combat-engine-ally-crit-dot`
**Baseline:** main after PR #85 (extra actions + per-hit crits). Golden parity suite = 21 snapshots.
**Origin:** user-reported live bug (Crocus) + coverage sweep findings (2026-06-06, this session).

## Problem

1. **Crocus (user-tested in-game, does not fire in the sim):** "When another ally
   inflicts a Damage Over Time (DoT) effect with a critical hit, this Unit … inflicts
   Corrosion II for 2 turns on that enemy." Parses today as an on-cast `dot` ability on
   the passive slot with a manual `ally-crit-dot` condition — double-dead: passive-slot
   dots are silent no-ops (`PASSIVE_NOOP_TYPES`), and the mechanic is reactive, not
   on-cast. Crocus is the only ship with this text shape.
2. **Three parser false-positives** currently silenced only by the passive-noop rule
   (latent phantom-damage landmines if the ability is ever moved or the rule changes):
   - **Morao p2:** "repairs an **additional 5% of its Max HP**" → mis-parsed as
     `additional-damage` (it is a heal).
   - **Valkyrie p1/p2:** "**When an Echoing Burst explodes** … repair 5% of damage
     dealt" → mis-parsed as a fresh `accumulate-detonate` application (it is a
     heal-on-burst reference to an existing burst).
   - **Vindicator p2 / Paracelsus p1+p2:** "When this Unit **resists** a debuff …
     deals damage equal to 30% of its max HP" / "**Upon being killed** … deals Damage
     equal to 50% of its max HP" → mis-parsed as on-cast `additional-damage` (they are
     Phase-4 reactive procs: on-resist, on-death).

## Design

### 1. New live reactive trigger: `on-ally-crit-dot`

- `AbilityTrigger` union gains `'on-ally-crit-dot'`; added to `LIVE_TRIGGERS`
  (types/abilities.ts — the editor's Trigger select picks it up from there).
- **Event plumbing:** the `dot-applied` event gains `viaCrit?: boolean` (additive,
  present only when true): the applying cast had ≥ 1 critting hit. Emitted from the
  applier's turn (`playerTurn.ts` `applyNewDoTs` emission site, where `critHits` is in
  scope: `viaCrit = critHits > 0`). DoTs applied by reactive executor intents emit
  WITHOUT `viaCrit` (drain-time has no crit outcome — consistent with the existing
  "crit-gated conditions evaluate as not-crit at drain time" convention).
- **Listener** (`registerReactiveListeners` in triggers.ts), per owner:
  `dot-applied` where `e.viaCrit && e.sourceId !== ownerId && e.sourceId !== enemyId`
  → enqueue (mirrors `on-ally-debuff-inflicted`'s ally-scoping exactly). One enqueue
  per qualifying dot-applied EVENT (consistent with the game-verified per-infliction-
  event rule for charge-on-inflict). Listener stays pure.
- **Execution:** nothing new — `dot` is already in `REACTIVE_ABILITY_TYPES` and the
  Phase-3 executor handles dot follow-up intents (owner-routed appliers, landing
  gates, sourceId attribution). Reactive partition is slot-agnostic, so the
  passive-noop problem disappears by construction.
- **Parser:** the existing ally-crit-dot detection (`parseAllyCritDot` feeding the
  `ally-crit-dot` manual condition on the DoT ability) is rerouted: the dot ability
  gets `trigger: 'on-ally-crit-dot'` and NO ally-crit-dot condition (the trigger IS
  the gate — same pattern as the Phase-3 charge-on-inflict reroute). The
  `ally-crit-dot` ConditionSubject stays in the union for stored configs/editor
  back-compat but is no longer parser-emitted for this shape.
- `auditSkills.ts` consumes `buildShipAbilities` output directly — no separate mirror
  needed; verify the Crocus rows in the audit report.

**Documented approximations (flag for live verification):**
- "with a critical hit" = the applying cast had ANY critting hit (`critHits > 0`).
  Per-hit DoT attribution is not modeled (DoTs apply once per cast).
- An ally cast applying MULTIPLE DoT types with a crit fires the trigger once per
  dot-applied event (per-infliction-event rule). Rare (no current ship does this with
  a crit-DoT text); note in coverage doc.

### 2. Parser false-positive guards (skillTextParser.ts)

All three guards are narrow, lookbehind-free, and clause-scoped:

- **`parseSecondaryDamage`:** skip a match whose sentence context is a heal —
  "repairs … additional X% of its Max HP" (the additional-amount belongs to the
  repair verb). Guard: "repair" appears before the matched "additional" within the
  same sentence.
- **`parseSecondaryDamage`:** skip matches inside clearly-reactive lead-in sentences —
  "When this Unit resists …", "Upon being killed/destroyed …" (Phase-4 procs;
  annotation-only until then). Keep the guard NARROW (resist/killed/destroyed/death
  lead-ins only) so legitimate conditional actives keep parsing.
- **`parseAccumulateDetonate`:** skip when the Echoing Burst mention is a reference to
  an existing burst exploding ("when an/the Echoing Burst explodes") rather than an
  infliction (no inflict/apply verb governs the name).

Result: Morao/Valkyrie/Vindicator/Paracelsus passives parse to NO phantom
damage/accumulate abilities (their heal/reactive content stays unparsed until the
healing/Phase-4 increments).

## Golden parity

- Existing 21 snapshots: **zero churn expected** — no fixture carries ally-crit-dot,
  the affected parser shapes feed no fixtures (all hand-built), and `viaCrit` is
  additive on an event that snapshots don't capture.
- **New golden scenario 22:** focus actor with a reactive `on-ally-crit-dot` dot
  ability + a walked team actor whose active applies a DoT and crits (deterministic
  gate). Locks: trigger fires only on team crit-casts, the focus actor's corrosion
  entries appear with the focus actor's sourceId, per-event frequency. Hand-verified.
- Unit tests: viaCrit emission (crit vs no-crit casts; executor-applied dots omit it),
  listener scoping (own casts excluded, enemy excluded), parser guards (the four
  ships' real texts produce no false-positive abilities; existing secondary-damage and
  accumulate-detonate ships still parse — regression-lock Chakara/Nuqtu secondary and
  Valkyrie's CHARGED Echoing Burst infliction).

## Hard constraints (inherited)

Additive public API; zero-RNG determinism; listeners never mutate; no `'attacker'`
literals; no RegExp lookbehind; pre-commit full suite, never `--no-verify` for code;
docs/ gitignored (`git add -f`); ONE evolving DPS changelog entry, edited in place.

## Documentation

- Coverage doc §5: the ally-crit-DoT rule + the any-hit-crit and per-event
  approximations; §6: remove the Crocus gap, note the four false-positive texts now
  parse clean (heal/Phase-4 content deferred by design).
- DocumentationPage: only if the DPS docs enumerate live triggers (check; likely a
  one-word list addition).

## Out of scope

- Heal-on-burst (Valkyrie), heal/cleanse/shield consumption (healing calc — next).
- On-resist / on-death procs (Vindicator/Paracelsus — Phase 4).
- Howler's cleanse-on-ally-crit (cleanse not modeled).
- Pallas ally-critically-repaired (healing calc).
