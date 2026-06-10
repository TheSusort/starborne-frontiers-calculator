# Handoff: Combat Engine — Phase 4 (Enemy Offensive Actions) and beyond

> Paste a prompt section into a fresh session. Context baseline: **PR #89 (damage-leech)
> MERGED** + **PR #91 (healing backlog batch) MERGED** (merge `c6b90e26`, 2026-06-08).
> Memory `project_combat_engine_roadmap.md` has the full running state. Phase 4 is the
> NEXT milestone — it is LARGE and must be **decomposed into sub-increments**, each with
> its own brainstorm → spec → plan → subagent-driven-implementation cycle. This handoff
> is the decomposition map, not a single spec.

## End-state goal (user-stated 2026-06-05, unchanged — every increment designs against it)

A close-to-full **combat simulator**: a common team where any actor swaps in as the one
under evaluation. DPS ✅ → healing ✅ → **defense (needs Phase 4 enemy offense)** →
ultimately a **simulator page** (drop in a full team, per-round damage/healing/defense per
ship). The engine core already honors this: no hardcoded `'attacker'` (internal
`focusActorId`), per-actor `ActorDamage`/`ActorHealing` maps, one
`runPlayerTurn(PlayerActorRuntime)` pipeline, healing mode gated on `healTargetId`.

## Current engine state (orient before any prompt)

`src/utils/combat/`:
- `engine.ts` (~1700 lines): round loop with MUTABLE turn queue (extra actions splice the
  granter back at its speed position); per-actor `ActorDamage`/`ActorHealing` maps; the
  `creditDamage(sourceId, channel, amount)` chokepoint (damage-leech) feeding
  `procStandingLeeches`; healing mode (heal/shield/cleanse consumption vs a live heal
  target, shield absorption pool, HoT ticks, **enemy attackers** = offense-only bare-stat
  queue actors that bombard the heal target via `runEnemyAttackerTurn`); per-attack
  `damage-taken` procs (Quixilver/Malvex) in the enemy-attacker branch; dead-is-dead
  (`destroyedRound`, dead-target turn skip + synthesized focus turn).
- `playerTurn.ts` (~1300): `runPlayerTurn(PlayerActorRuntime)` — per-hit crit draws, the
  heal block (cast-rider `damage-dealt` basis), control-applied emission on the cast path.
- `triggers.ts` (~640): cast/reactive partition, pure enqueue-only listeners, FIFO intent
  queue, executor = sole mutator (charge/buff/debuff/dot/heal/shield/cleanse follow-ups).
- `enemyTurn.ts` (~100): `runEnemyAttackerTurn` — DAMAGE-ABILITIES-ONLY basics walk
  (multiplier × hits, per-hit crits, team-mirror charge cadence); NON-damage enemy
  abilities are SKIPPED (the Phase-4 seam). Bare-stat actor (no buffs/affinity).
- `statusEngine.ts` (~870, per-owner player stores), `events.ts`, `state.ts`,
  `abilityStatusGating.ts`, `shared.ts`.

**Triggers (11 live, `LIVE_TRIGGERS` in `types/abilities.ts`):** `start-of-round`,
`on-crit`, `on-debuff-inflicted`, `on-ally-debuff-inflicted`, `on-ally-crit-dot`,
`on-ally-critically-repaired`, `on-ally-crit`, `on-stasis-applied`, `on-bomb-detonated`.
**Annotation-only (types exist, NOT in LIVE_TRIGGERS — Phase 4 unlocks them):**
`on-attacked`, `on-ally-destroyed`, `on-destroyed`.

**Events (`events.ts`):** round/turn lifecycle, `ability-performed` (damage/critHits),
`buff-applied`/`buff-expired`, `debuff-applied`/`debuff-resisted` (discrete infliction),
`dot-applied`/`dot-ticked`/`dot-detonated`, `heal-performed`, `bomb-detonated`,
`control-applied` {casterId, effect, round} (emitted, effect UNSIMULATED — trigger source
only), `hp-changed`, `ship-destroyed`. NOTE there is NO `damage-taken` event — enemy
attacks produce one aggregate damage number per turn; the per-attack `damage-taken` PROC
seam lives inline in the engine's enemy-attacker branch.

**Goldens:** 22 DPS + (8+ new healing) snapshots (`dpsGoldenParity`/`healingGoldenParity`)
— the referee. Parity suites use HAND-BUILT `ab()` fixtures, NOT `buildShipAbilities`.

## What Phase 4 unlocks (the full inventory — from coverage doc §6 + this session's notes)

- **Enemy offensive actions (the keystone):** enemies deal real damage/debuffs/DoTs/
  self-buffs/heals to the WHOLE TEAM (not just the single bombarded heal target). The enemy
  becomes a player-pipeline actor (or near it). NON-damage enemy abilities in the walk
  (currently skipped). Unlocks the **24 manual enemy-buff conditions** (`enemy-buff`/
  `self-debuff` are forced to 0 today) and the `on-attacked` trigger.
- **Real `selfHpPct`** (fixed at 100 today): retro-activates Makoli/Guardian below-40%
  gates (parsed-but-DROPPED), Tormenter HP<50 extra action, self-execute gates, and makes
  heal consumption + the generic damage-reaction triggers meaningful.
- **Generic damage-reaction triggers** (`on-self-damaged`/`on-ally-damaged`) — discussed
  with the user 2026-06-08: GENERIC versions need whole-team enemy offense + real HP (this
  phase). The damage-leech per-attack proc point is the foundation. Isha-style "X% per hit,
  Y% on crit" reactive heals (the never-built `onCritHit`) need PER-HIT damage-taken
  granularity + crit info from the enemy attack (today: per-attack aggregate) — its own
  decision (trades against golden stability).
- **Death modeling:** `on-destroyed`/`on-ally-destroyed` triggers + `ship-destroyed` events
  (the engine already emits `ship-destroyed` for the heal target); **revive / Cheat Death**
  (Hayyan/Yazid/Tycho — ~5-6 cells); the annotation-only extra-action seams (Sokol on-kill,
  Harvester ally-destroyed — §6 item 9).
- **Enemy-action reactions** (~13 cells: Zosimos/Arum/Yarrow/Larkspur/Grif) — `on-attacked`
  and resist-reactions.
- **Targeting:** taunt/stealth/provoke targeting; multi-enemy player offense.
- **Consumption mechanics:** cleanse DEBUFF consumption (today: output count only, no debuff
  removal); purge consumption (Sefuba; Tithonus purge-count extra action — §6 item 9);
  **control effect simulation** (stasis/taunt/provoke/overload/concentrate-fire — today
  `control-applied` emits but the effect is unmodeled).
- **Damage reduction / reflect:** Voron damage→DoT transform, Lev charge-loss immunity,
  Nosorog "reflects 40% of Damage taken", incoming-damage-reduction texts.
- **Defense-calc adoption:** the defense calculator runs on the engine (needs enemy offense).
- **Graphite/Refine reactive buff grants** (deferred here from the healing backlog):
  "when an ally … damaged, grants Repair Over Time III" — route through the whole-team
  damage-reaction model.
- **Drain-time enemy-debuff undercount** (§6 item 8): the `includeAbilityEnemyNames` analogue
  — revisit when enemy offense lands (golden-locked today).

## Recommended decomposition (each = own spec → plan → subagent-driven cycle)

Phase 4 is too large for one spec. Suggested order (the keystone first; later ones depend on it):

| # | Sub-increment | Depends on | Notes |
|---|---|---|---|
| **4a** | **Enemy as a player-pipeline actor + whole-team damage intake + real `selfHpPct`** | — | THE keystone. The enemy walks a real (or near-real) kit dealing damage to all team actors; team actors track real HP; `selfHpPct` becomes live. Unlocks the most downstream (24 enemy-buff conditions, on-attacked, real HP gates). Biggest single design problem — brainstorm targeting/whole-team-intake/HP-tracking carefully. |
| **4b** | **Death & revive modeling** | 4a | `on-destroyed`/`on-ally-destroyed` live triggers, ship-death events for all actors, revive/Cheat Death (Hayyan/Yazid/Tycho), Sokol/Harvester extra-action seams. |
| **4c** | **Enemy-action reactions + generic damage triggers** | 4a | `on-attacked`, `on-self-damaged`/`on-ally-damaged` (generic), Zosimos/Arum/Yarrow/Larkspur/Grif, Isha onCritHit (per-hit decision), Graphite/Refine. |
| **4d** | **Targeting + multi-enemy** | 4a | taunt/stealth/provoke targeting; multiple enemies. May fold into 4a if the keystone design needs it. |
| **4e** | **Consumption & mitigation** | 4a | cleanse/purge debuff consumption, control effect simulation, damage reduction/reflect (Voron/Lev/Nosorog). |
| **4f** | **Defense-calc adoption** | 4a (+4e) | the defense calculator on the engine — the third calculator milestone. |
| **5** | **Simulator page** | 4a-4f | per-round damage/healing/defense per ship; the per-actor maps are the data source; own UX spec. |

Start with **4a** — it's the gate for everything. Brainstorm its scope tightly (it could
itself be split: e.g. "enemy deals damage to the whole team + real HP" before "enemy
non-damage abilities / 24 enemy-buff conditions").

## Hard constraints (unchanged — apply to every sub-increment)

- Public DPS/healing result types stay additive; a defense result type follows the same
  discipline. Goldens (22 DPS + healing) = referee; zero churn except documented
  hand-verified KNOWN-DIFF. NEVER `vitest -u` (delete + re-run for targeted regeneration).
- Zero-RNG determinism (`makeRateGate` per actor/stream; separate heal-crit gates).
  Listeners PURE (enqueue only); engine/executor sole mutator. New event fields additive
  and present-only-when-true.
- Engine core NEVER compares the literal `'attacker'` — key on `focusActorId`/owner ids.
- No RegExp lookbehind in `src/` (iOS Safari 15); `scripts/auditSkills.ts` is Node-only
  (it may use lookbehind — don't touch / don't copy into `src/`).
- Pre-commit runs the full suite (~2 min); no `--no-verify` for code commits. ESLint zero warnings.
- `docs/` gitignored — `git add -f` for specs/plans/handoffs/coverage.
- Changelog: fold into the evolving DPS/healing/defense `UNRELEASED_CHANGES` entries; don't
  append many new array elements (implementer subagents keep appending — watch them).
- UI: use existing `src/components/ui/` primitives; no raw HTML form controls.

## Game-verified rules (canonical = coverage doc §5; do NOT re-litigate)

All Phases 0-3 + team walk + extra-actions/per-hit-crits + ally-crit-dot + healing-calc +
damage-leech + healing-backlog rules. Highlights relevant to Phase 4:
- Landing = ONE check at infliction (hacking − security, floor 0, no minimum) or affinity
  for `apply`; landed → full duration; nothing resists after landing (cleanse = the Phase-4
  consumption feature). Persistent stacking: [[project-persistent-stacking-buffs]].
- Enemy attackers (healing-calc) are bare-stat, damage-abilities-only basics-walk actors —
  Phase 4 generalizes them to full kits hitting the whole team.
- `control-applied` already emits (Defiant); the control's own lockout effect is the Phase-4
  consumption work. Inert latent gap (documented in `buildShipAbilities.ts`): control
  abilities carry `conditions:[]`, so a GATED Stasis would over-emit — thread the inflicting
  ability's conditions onto the control ability if a gated-Stasis self-reactor ever ships.

## Workflow (full superpowers flow per sub-increment)

brainstorming (one question at a time → scope decomposition first if the sub-increment is
still too big) → spec in `docs/superpowers/specs/` → spec-reviewer loop → user gate →
writing-plans → plan-reviewer → subagent-driven implementation on a `feat/` branch
(two-stage review per task: spec compliance then code quality) → final whole-branch review
→ finishing-a-development-branch → PR → babysit CodeRabbit to merge.

**Workflow gotchas (this session's lessons):**
- Dev server on **port 3000** holds the user's fleet (was :3002 in older handoffs — the user
  moved it). Pages with 200+ ships exceed snapshot token limits — use `evaluate_script`, not
  full a11y snapshots, for fleet-heavy pages. The Healing/DPS pages: ship selectors open a
  MODAL with "Search ships"; set React-controlled inputs via the native value setter +
  `input` event; ship cards are `cursor-pointer` divs. The Skill Editor's × DELETES an
  ability — close with Escape.
- **`gh` active account drifts to `kennethsflow` (NOT a collaborator) → PR/merge ops fail with
  "must be a collaborator". Run `gh auth switch --hostname github.com --user TheSusort` before
  any PR create/merge.** Merge convention: merge commit, branches kept (delete the local one
  after).
- CodeRabbit flow: it reviews a few min after push; triage inline comments → fix or
  skip-with-reason → reply in-thread → it re-reviews on the next push and marks threads
  addressed → merge when `mergeStateStatus: CLEAN` + checks green. The "npm audit" check can
  FLAKE on the `supabase` package's postinstall (binary download "incorrect header check") —
  it's not a vuln/code issue; `gh run rerun <id> --failed` clears it.
- A SEPARATE agent once committed unrelated work onto the active branch (shared working tree) —
  use explicit per-file `git add`, never `git add -A`; watch `git status` for foreign changes.
- Subagent-driven discipline that worked across #89/#91: fold each review's cheap actionable
  minors into the NEXT task's "preliminary" step; DECLINE design-taste findings that contradict
  the approved spec (document the reasoning). Final whole-branch reviewer should EMPIRICALLY
  re-verify load-bearing claims (corpus parser checks, golden parity), not trust task reports.

## Related memory

[[project-combat-engine-roadmap]] (running state), [[project-persistent-stacking-buffs]],
[[project-dps-skill-mechanic-pipeline]], [[project-skill-ability-editor]]. Coverage doc
`docs/skill-model-coverage.md` §5 (canonical rules) + §6 (backlog — Phase-4 pointer at the end).
