# Handoff: Combat Engine — Healing-Calc Adoption (and beyond)

> Paste a prompt section below into a fresh session. Context baseline: **PR #85**
> (extra actions + per-hit crits) is MERGED; **PR #86** (ally-crit-DoT reactive +
> parser false-positive guards) is merged or in final CodeRabbit triage — confirm
> merged before branching. Memory file `project_combat_engine_roadmap.md` has the
> running state. The 2026-06-06 coverage sweep (this handoff's origin) measured:
> **~99.4% of parsed abilities fully live**; the remaining text-mechanic gap IS the
> healing scope + Phase 4.

## End-state goal (user-stated 2026-06-05 — unchanged, every increment designs against this)

A close-to-full **combat simulator**: a common team where any actor swaps in as the one
under evaluation. After the DPS calc: extend to **healing** (focus a healer) — THE NEXT
MILESTONE — then **defense** (incoming damage, needs Phase 4 enemy offense), ultimately a
**simulator page** (drop in a full team, per-round damage/healing/defense per ship). The
engine core honors this: no hardcoded `'attacker'` (internal `focusActorId`), per-actor
damage map (`ActorDamage`), one `runPlayerTurn(PlayerActorRuntime)` pipeline.

## Current engine state (orient before any prompt)

- `src/utils/combat/`: `engine.ts` (~1335 lines: round loop with MUTABLE turn queue —
  extra actions splice the granter back in at its speed position, `processExtraActionGrants`
  + `MAX_EXTRA_TURNS_PER_ROUND` backstop; per-entry DoT attribution; owner-routed executor
  context), `playerTurn.ts` (~1230: per-hit crit draws — `drawHits` from the UNGATED firing
  skill, `critHits` count, blended multiplier `1+(critHits/hits)×cd`; `extraActionGrants`
  output; `viaCrit` on dot-applied emissions), `statusEngine.ts` (~870, per-owner player
  stores), `triggers.ts` (~510: SIX live triggers — `start-of-round`/`on-crit` (fires once
  PER CRITTING HIT via `ability-performed.critHits`)/`on-debuff-inflicted`/
  `on-ally-debuff-inflicted`/`on-bomb-detonated`/`on-ally-crit-dot` (NEW: ally crit-cast
  DoT via `dot-applied.viaCrit`); executor = sole mutator), `events.ts` (additive fields:
  `critHits` on ability-performed, `viaCrit` on dot-applied — both present-only-when-true),
  `state.ts`, `abilityStatusGating.ts`.
- **Extra actions** (PR #85): Nuqtu/Sustainer/Tormenter/Liberator/Tygr take full extra
  turns (queue re-insertion by speed; per-turn status ticking — verified). Sokol/Harvester/
  Tithonus phrasings deliberately NOT auto-parsed (`EXTRA_ACTION_DISQUALIFY_RE`).
- **Ally-crit-DoT** (PR #86): Crocus's passive corrosion fires on team crit-cast DoTs.
  Apply-time nuance: corrosion/inferno entries read applier ctx at TICK time (work even
  when the owner hasn't acted yet that round); BOMB reactive dots snapshot effectiveAttack
  at apply time and are SKIPPED for a ctx-less owner.
- **Parser guards** (PR #86): Morao heal-as-secondary, Vindicator/Paracelsus reactive
  procs, Valkyrie burst-reference — all parse clean now (heal/Phase-4 content unparsed by
  design; Valkyrie has an auditSkills allowlist entry).
- Golden parity suite: **22 snapshots** (`dpsGoldenParity.test.ts`) — the referee.
  20 = per-hit crits, 21 = extra action × cadence, 22 = ally-crit-DoT (all hand-verified).
  Full suite ~1314 tests / 84 files.
- `docs/skill-model-coverage.md` §5 holds ALL game-verified rules (incl. extra-action,
  per-hit-crit, ally-crit-dot blocks); §6 backlog is current.

## Coverage sweep results (2026-06-06 — what's left, quantified)

Text-level mechanics with NO parsed ability (the healing/Phase-4 gap):
- **97 heal/repair texts** (some keyword false-positives like "Inc. Repair Down" buff
  names; majority real heals) — HEALING CALC
- **42 shield texts** — HEALING CALC (or its own mini-phase)
- **35 cleanse texts** — consumption needs modeling; self-cleanse matters once enemy
  offense exists (Phase 4), ally-cleanse is healer kit
- **6 revive/Cheat Death texts** (Hayyan, Yazid, Tycho…) — HEALING CALC
- **28 purge/steal, 7 incoming-damage-reduction, 3 reflect, Voron damage→DoT transform,
  Lev charge-loss immunity** — PHASE 4
- 62 manual assume-active conditions (Taunt/Stealth/ally-on-team/enemy-buff) — by design,
  editor toggles; the 24-ability enemy-buff block unlocks with Phase 4.

## Increment menu (recommended order)

| # | Increment | Size | Notes |
|---|---|---|---|
| 1 | **Healing-calc adoption** | Phase-sized, OWN full spec cycle | The user's stated next milestone. Key scope questions for brainstorming (one at a time): heal CONSUMPTION model (`selfHpPct` is fixed 100 today — does healing need damage intake to matter, i.e. a stub of enemy offense, or report raw healing output like the DPS calc reports raw damage?); focus-a-healer reporting (the `focusActorId` machinery is ready; healing needs a per-actor healing map mirroring `ActorDamage`); heal targets (self/ally/all-allies routing exists from the team walk); HoT/RoT statuses (Everliving Regeneration — the timed-status machinery fits); crit heals (per-hit crit draws exist; Pallas's "repair cannot critically hit" parses via parseNoCrit's heal-subject exemption); Cheat Death/revive semantics; shield as damage-absorption vs flat-HP; the existing `HealingCalculatorPage` (387 lines) + `healingSimulator.ts` (83 lines, standalone expected-value model with STATISTICAL crit — predates the deterministic engine): adopt into the engine vs replace. Parser: heal abilities (`heal`/`shield` AbilityConfig variants EXIST, editor-pickable, never parsed from text — `parseSkillHeal` exists for the page's flat number). Reactive healing seams now live: Pallas `ally-critically-repaired` (manual today → could become a trigger like ally-crit-dot), Howler cleanse-on-ally-crit, Valkyrie heal-on-burst (`bomb-detonated`/accumulator events exist). |
| 2 | **Phase 4: enemy offensive actions** | Large, own spec cycle | Unlocks `on-attacked`/`on-destroyed`/on-resist (Vindicator), self-debuffs, the 24 manual enemy-buff conditions, cleanse/purge consumption, taunt/stealth targeting, multi-enemy, defense-calc adoption, damage reduction/reflect, real selfHpPct (which retro-activates Tormenter's HP<50 extra action and makes heal consumption meaningful). The enemy becomes a player-pipeline actor. |
| 3 | **Simulator page** (after 1+2) | Phase-sized | Per-round damage/healing/defense per ship; per-actor maps are the data source; own UX spec. |

Smaller backlog (self-contained, pick up opportunistically — coverage doc §6 numbering):
- §6 item 7: team-cast all-allies ACCUMULATING statuses tick on the attacker's cadence.
- §6 item 8: drain-time/foreign-caster `enemy-debuff` counts exclude ability-sourced
  statuses (golden-locked approximation; CodeRabbit PR #84 finding, deferred).
- Chakara lowest-speed-conditioned buffs don't parse (§6 item 10; manual picker works).
- Warding Screen persistent-stacking: still UNVERIFIED in-game (persistentStackingBuffs.ts).
- Sokol/Harvester/Tithonus extra actions (on-kill / ally-destroyed / purge-count seams).

## Hard constraints (unchanged — apply to every increment)

- DPS public API (`DPSSimulationInput`/`DPSSimulationResult`/`RoundData`) stays additive.
  A healing result type should follow the same discipline from day one.
- Zero-RNG determinism (`makeRateGate` accumulators; per-actor gate instances; fixed
  listener/queue/recipient order). Crit heals must draw deterministic gates, NOT the
  statistical `critRate × critDamage` blend the legacy healingSimulator uses.
- Golden parity (22 snapshots) is the referee — zero churn unless documented KNOWN-DIFF,
  hand-verified; NEVER `vitest -u` (delete + re-run for targeted regeneration).
- Listeners never mutate state; only the engine/executor mutates. New event fields are
  additive and present-only-when-true (`critHits`, `viaCrit` precedents).
- Engine core never compares the literal `'attacker'` — key on `focusActorId`/owner ids.
- Pre-commit hook runs the full suite (~2 min); no `--no-verify` for code commits.
- docs/ is gitignored — `git add -f` for specs/plans/handoffs/coverage doc.
- No RegExp lookbehind anywhere in src/ (iOS Safari 15 in browserslist).
- Changelog: ONE evolving DPS entry in `UNRELEASED_CHANGES` — edit in place; implementer
  subagents keep adding separate entries by mistake — fold them.

## Game-verified rules (do NOT re-litigate; all implemented — coverage doc §5 is canonical)

Added since the last handoff:
- Extra action = FULL normal turn; re-added into the turn queue at speed position
  (immediate only when fastest remaining); durations tick PER TURN TAKEN.
- Multi-hit skills crit-check PER HIT; on-crit follow-ups fire once per critting hit.
- Ally-crit-DoT = reactive on the infliction event; "with a critical hit" = the applying
  cast had ANY critting hit (approximation, documented); once per dot-applied event.
- Everything from Phases 2-3 + team walk: family tier rule, infliction-event definition,
  persistent stacking ([[project-persistent-stacking-buffs]]), target routing, drain-time
  conventions, charge-on-inflict per-event.

## Workflow

Full superpowers flow for increment 1 (brainstorming one question at a time → spec in
`docs/superpowers/specs/` → spec-reviewer loop → user gate → writing-plans → plan-reviewer
→ subagent-driven implementation on a `feat/` branch, two-stage review per task, final
whole-branch review). Golden discipline per task. Live verification with the user's
imported fleet at the end — **gotchas learned this session**:
- Dev server: localhost:3002 holds the 212-ship fleet; stale Vite instances sit on
  3002-3004 — reuse 3002. Pages with 200+ ships exceed snapshot token limits — use
  `evaluate_script`.
- The DPS page's FIRST text input is the **Config name** field — do NOT type ship names
  into it thinking it's a search box. The ship selector opens a MODAL with a
  "Search ships" placeholder input; ship cards are `cursor-pointer` divs (walk up from
  the name text node; plain `.click()` works on the card).
- In the Skill Editor modal, the **× on an ability card DELETES the ability** — close
  modals with Escape, never by clicking ×'s blindly. (An accidental delete is recoverable
  by re-selecting the ship, which re-stamps parsed skills.)
- CodeRabbit flow: triage → fix or skip-with-reason → reply in-thread → wait for
  re-review (it edits its comments with "addressed" markers; poll
  `pulls/N/comments` for reply confirmations + the status check) → merge when clean
  (merge commits, branches kept).
