# Healing Backlog Batch — Design

**Date:** 2026-06-08
**Status:** Approved (user-validated)
**Baseline:** PR #89 merged (`fdfee948`) — damage-leech heals/shields on main.
**Branch target:** `feat/healing-backlog`

## Goal

Clear the four self-contained healing/combat-engine backlog items left after the
damage-leech increment. Graphite/Refine reactive buff grants are **deferred to Phase 4**
(they need the whole-team damage-reaction model). Each item is independent (separate
file/seam) and ships as its own TDD task. The 22 DPS + 8 healing golden snapshots stay
byte-identical except where an item documents a hand-verified KNOWN-DIFF.

## Scope (user decision 2026-06-08: all four)

| # | Item | Size | Risk |
|---|---|---|---|
| 1 | Hermes Everliving Regeneration III grant (parser) | Small | None — additive parse |
| 2 | Team-actor `healModifier` threading | Small | None — DPS-inert |
| 3a | APEX shield-on-debuff (existing trigger) | Small | None |
| 3b | Defiant shield-on-Stasis (NEW trigger + event) | Medium | New machinery |
| 4 | Duplicate-passive-row buff/DoT auto-fill scan | Small-medium | Auto-fill test churn (NOT combat goldens) |

## Naming correction (do not repeat the roadmap's error)

The roadmap/handoff called item 1 "Pallas Everliving Regeneration 3 grant." That is
**wrong** — the kit is **Hermes** (`docs/ship-skills.csv` row 32 / `ships.ts` `Everliving_9`):
R4 passive = "Defense +20%. When an ally critically hits an enemy, this Unit gains 1 charge
to its Charged Skill and Everliving Regeneration III for 2 turns. Additionally, when this
Unit critically repairs an ally, it Cleanses 1 debuff from itself." **Pallas** (CSV row 110)
is the *different* "Attack Up II / Leech II after an ally is critically repaired" kit.
NOTE: the existing `buildShipAbilities.test.ts` fixture named `PALLAS_TEXT` actually carries
the Hermes-shaped text — a naming artifact; leave it or rename, but the real ship is Hermes.

## Design

### Item 1 — Hermes Everliving Regeneration III grant (parser)

**Files:** `src/utils/abilities/buildShipAbilities.ts`, `src/utils/skillTextParser.ts` (if the
buff-clause detection needs widening), tests in `buildShipAbilities.test.ts`.

Hermes's R4 passive on the `on-ally-crit` trigger emits the +1 charge ability today
(`detectAllyCritTrigger`, buildShipAbilities ~909) but NOT the "Everliving Regeneration III
for 2 turns" self-buff. Fix: the buff-grant emission loop must produce a `buff` ability for
Everliving Regeneration III (2 turns) carrying the **`on-ally-crit`** trigger (the same
reactive trigger the charge clause uses), so the engine's reactive buff follow-up applies it.

- Everliving Regeneration I/II/III are in `BUFFS` (lines 699/326/441) — their `parsedEffects`
  carry the incoming-repair amplification (Everliving Regen = an Inc.-Repair amplifier, NOT a
  HoT — confirmed in the healing-calc notes). So once the grant emits, the engine already
  folds it into the holder's incoming-heal channel.
- The clause shape is "gains 1 charge … **and** Everliving Regeneration III for 2 turns" —
  the buff grant is conjoined with a charge grant on the same reactive trigger. The fix
  ensures the buff clause is detected and gets the reactive trigger (not dropped, not left
  `on-cast`). Root cause to confirm in the plan: whether the buff is not emitted at all, or
  emitted without the `on-ally-crit` trigger.
- Tests: Hermes R4 passive → a `buff` ability {buffName 'Everliving Regeneration III',
  duration 2, trigger 'on-ally-crit', target 'self'} alongside the existing charge + cleanse
  abilities. Engine-level (optional): in healing mode, an ally crit applies the buff and the
  holder's incoming-heal rises. No golden churn (Hermes isn't in any golden fixture).

### Item 2 — Team-actor healModifier threading

**Files:** `src/types/calculator.ts` (`CombatStatBlock`), `src/utils/calculators/healingEngineAdapter.ts`
(`deriveTeamEngineActors`), wherever team `CombatStatBlock`s are auto-filled from a ship,
tests in the healing/adapter suite.

Add optional `healModifier?: number` to `CombatStatBlock`. Thread it in
`deriveTeamEngineActors` into the engine's `TeamActorEngineInput.healModifier` (the engine
field already exists — `engine.ts:332/372`, consumed at `726` and in the standing-leech /
damage-taken folds). Remove the "healModifier is NOT threaded" hardcode at
`healingEngineAdapter.ts:144`. Auto-fill the stat from the ship where team `CombatStatBlock`s
are built (mirror how `attack`/`crit`/etc. are populated).

- DPS-inert: DPS mode never reads `healModifier`; adding an optional field to `CombatStatBlock`
  is additive and changes no DPS path → 22 DPS goldens byte-identical.
- Healing goldens: existing 8 fixtures set team `CombatStatBlock` without `healModifier`
  (defaults 0 → unchanged). A NEW golden (or an extension of an existing team-healer scenario)
  pins a team healer with `healModifier > 0` producing amplified heals.
- Test: a walked team healer with `healModifier: 50` heals at ×1.5 (mirrors the attacker's
  fold), proving the thread.

### Item 3a — APEX shield-on-debuff (existing trigger)

**Files:** `src/utils/abilities/buildShipAbilities.ts` (+ parser if needed), tests.

APEX passive "gains a Shield equal to 3% of their Max HP when an enemy gets debuffed" parses
as a `shield` ability {basis 'hp', pct 3} on the **existing** `on-debuff-inflicted` trigger
(own inflictions — APEX's active inflicts Speed Down / Crit Power Down, supplying the event).
The executor's shield follow-up (shipped with healing-calc, `triggers.ts`) grants it in
healing mode.

- Trigger choice: `on-debuff-inflicted` (own) — "an enemy gets debuffed" is dominated by
  APEX's own kit; matches the existing trigger with no new machinery. (Ally-inflicted debuffs
  firing it too would need `on-ally-debuff-inflicted` as well; out of scope — own is the
  faithful-enough model, documented.)
- Tests: APEX passive → `shield` {pct 3, basis 'hp', trigger 'on-debuff-inflicted'}. Engine
  (healing mode): APEX inflicts a debuff → shield pool grows by 3% max HP. No golden churn.
- NOTE: APEX's R4 adds "If that enemy has 3 or more debuffs, Inflict Block Shield" — a
  conditional control/inflict that is NOT this item (stays unparsed/annotation-only).

### Item 3b — Defiant shield-on-Stasis (NEW trigger + event)

**Files:** `src/utils/combat/events.ts` (new event), `src/types/abilities.ts` (new trigger
in `AbilityTrigger` + `LIVE_TRIGGERS`), `src/utils/combat/playerTurn.ts` (emit on the cast
path), `src/utils/combat/triggers.ts` (register listener), `src/utils/abilities/buildShipAbilities.ts`
(parse the reactive shield), tests.

Stasis is a `control` ability (`config.type 'control'`, `effect 'stasis'`) that the engine
does NOT simulate or emit (today it's a "not-simulated follow-up payload"). Defiant's passive
"gains Shield equal to 30% of its Max HP when applying Stasis" needs new machinery:

1. **Event** `control-applied` { casterId, effect: ControlEffect, round } — emitted on the
   CAST path (`playerTurn.ts`) when the firing skill (active/charged) carries a `control`
   ability. Present-only-when-fired; additive to `CombatEvent`. Emitting it does NOT make the
   engine simulate the control's combat effect (taunt/stasis/etc. stay unmodelled) — it only
   exposes the application moment for reactions. So DPS goldens are unaffected (no DPS fixture
   reacts to it; emitting an unconsumed event changes nothing).
2. **Trigger** `on-stasis-applied` — added to `AbilityTrigger` and `LIVE_TRIGGERS`. Narrow
   name (not generic `on-control-applied`): Stasis is the only control any ship reacts to
   today; trivially renamable/generalizable later. Listener (triggers.ts) fires when a
   `control-applied` event with `effect === 'stasis'` has `casterId === ownerId` (own-cast
   scoped — Defiant reacts to ITS OWN Stasis application).
3. **Executor**: the existing shield follow-up handles the `shield` config (no new executor
   branch — `on-stasis-applied` is just another live trigger routing a `shield` intent).
4. **Parser**: Defiant passive "Shield equal to 30% of its Max HP when applying Stasis" →
   `shield` {basis 'hp', pct 30} on the `on-stasis-applied` trigger. Defiant's own active
   ("inflicts Stasis") / charged supply the control ability whose firing emits the event.

- Determinism / discipline: listener is pure (enqueues intent only); executor is the sole
  mutator; the event is additive. DPS goldens byte-identical (no DPS fixture has a control on
  its firing skill that would emit, and even if emitted it's unconsumed). A new healing golden
  pins Defiant applying Stasis → 30%-max-HP shield.
- Defiant's R4 also has "When adjacent to a Supporter, gains 20% HP" — adjacency/HP-grant,
  NOT this item (annotation-only).

### Item 4 — Duplicate-passive-row buff/DoT auto-fill scan

**Files:** `src/utils/skillTextParser.ts` (`parseAllSkillEffects`), or
`src/utils/calculators/skillBuffAutoFill.ts` if the slot resolution is better placed there;
tests in `skillBuffAutoFill.test.ts` (+ `buildDoTAutoFill` coverage).

`parseAllSkillEffects(ship)` scans ALL THREE passive columns
(`firstPassiveSkillText`/`second`/`third`), so tier-inclusive passives (R0/R2/R4 each naming
a different tier of the same buff) produce duplicate/tier-conflicting auto-fill entries. The
engine path (`buildShipAbilities`) already resolves the **refit-active** passive via
`getShipSkillRows(ship)`. Align the auto-fill: scan only the refit-active passive row (plus
active + charge), matching the engine.

- Consumers: `buildSkillBuffAutoFill` (buff pickers) and `buildDoTAutoFill` (DoT config) —
  used by the DPS, Defense, and Speed calculator pages' auto-fill defaults.
- **Golden safety (the key constraint):** the combat-engine goldens (22 DPS + 8 healing) run
  on `buildShipAbilities`/hand-built fixtures, NOT on `buildSkillBuffAutoFill` → they are
  untouched. The impact is on auto-fill picker DEFAULTS and `skillBuffAutoFill.test.ts`
  expectations. Treat those test updates as legitimate (the old behavior was the bug). The
  plan MUST: (a) run the full combat-golden suites and confirm zero churn; (b) update the
  auto-fill tests to the refit-active-only contract; (c) spot-check the DPS/Defense/Speed
  pages' auto-fill on a tier-inclusive-passive ship to confirm the duplicates are gone and no
  legitimate grant is dropped.
- Risk if mis-scoped: if `getShipSkillRows` resolution differs from a ship's stored refit
  state, auto-fill could pick a different passive than before. The plan validates against a
  known multi-tier-passive ship (e.g. a ship whose passives name Everliving Regeneration
  II→III across rows).

## Cross-cutting constraints (inherited)

- Public DPS/healing result types stay additive; goldens = referee. The ONLY new
  event/trigger is item 3b's `control-applied` / `on-stasis-applied` (additive,
  present-only-when-fired). Zero combat-golden churn except documented hand-verified KNOWN-DIFF.
- Zero-RNG determinism; listeners pure (enqueue only); engine/executor sole mutator; no
  `'attacker'` literal in engine core; no RegExp lookbehind in `src/` (iOS Safari 15).
- Pre-commit full suite; ESLint zero warnings; no `--no-verify` for code commits.
- `docs/` gitignored → `git add -f` for spec/plan/coverage/handoff.
- Changelog: items 1–4 are user-noticeable (team healModifier, Hermes/APEX/Defiant sustain,
  cleaner auto-fill) — add concise plain-English notes to `UNRELEASED_CHANGES`; fold into the
  evolving healing/DPS entries where they fit rather than appending many new ones.
- Coverage doc `docs/skill-model-coverage.md`: update §5/§6 for the new trigger + the four
  items; remove the now-shipped backlog entries.

## Testing

Per-item TDD (parser fixtures + engine/adapter tests as noted). New healing goldens for
items 2 (team healModifier), 3b (Defiant Stasis shield) and optionally 3a (APEX) / 1 (Hermes)
— hand-verified, additions-only, existing 30 goldens byte-identical. Full suite + lint via
pre-commit. Item 4: auto-fill test updates + combat-golden zero-churn confirmation + page
spot-check.

## Verification (end of increment)

Live fleet check on the running dev server: a team healer with a heal modifier amplifies its
heals; Hermes ally-crit grants Everliving Regeneration; APEX builds shield as it debuffs;
Defiant builds shield when it applies Stasis; a multi-tier-passive ship's auto-fill no longer
shows duplicate buff entries. Skill Editor round-trips the new parsed abilities.
