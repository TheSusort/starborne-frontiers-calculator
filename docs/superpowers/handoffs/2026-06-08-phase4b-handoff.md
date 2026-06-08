# Handoff: Combat Engine — Phase 4b (Death & Revive Modeling)

> Paste a prompt section into a fresh session. Context baseline: **Phase 4a branch
> `feat/combat-engine-phase4a-enemy-offense` MERGED-PENDING** (this increment; commit
> docs task is the last step before the PR). Memory `project_combat_engine_roadmap.md`
> has the full running state. Coverage doc `docs/skill-model-coverage.md` §5 (Phase 4a
> block) + §6 (items 9, 11, 12) are the authoritative rule source. The Phase-4
> decomposition map lives in
> `docs/superpowers/handoffs/2026-06-08-phase4-enemy-offense-handoff.md`.

## What Phase 4a delivered (orient before any prompt)

Phase 4a made the healing-mode enemy a **full `runPlayerTurn` actor** on the shared
pipeline. The damage-only `runEnemyAttackerTurn` / `enemyTurn.ts` was retired. Concretely:

- **Single-target focus-fire** — enemy always targets the configured heal target (tank).
  Death-fallback re-targeting, AoE, multi-enemy are deferred.
- **Full parsed kit** — affinity-modified damage, debuffs/DoTs applied to the tank,
  self-buffs to itself; the same `runPlayerTurn(PlayerActorRuntime)` pipeline handles both.
- **Affinity symmetry** — `computeAffinityModifiers(enemyAffinity, targetAffinity)` on
  enemy attacks; affinity auto-filled from the selected ship.
- **Real `selfHpPct`** for the tank — retro-activates parsed-but-previously-dropped
  self-HP gates on enemy abilities (Makoli/Guardian below-40%, Tormenter HP<50,
  self-execute patterns).
- **`attacked` event + live `on-attacked` trigger** — the heal target's reactive defenses
  (shields, heals, charge gains on being hit) fire from real combat events.
- **Per-target status stores** — tank's debuffs and enemy's self-buffs are isolated in
  the StatusEngine (keyed by `ENEMY_TARGET_ID` sentinel + per-owner store).
- **Live `enemyBuffNames` + `selfDebuffNames`** — player condition contexts read these
  name-arrays live from the per-target stores.
- **Enemy-applied DoTs tick on the tank** — Corrosion, Inferno, Bomb DoTs from enemy
  actors tick each round during the enemy's turn, crediting incoming damage.
- **DPS goldens byte-identical** (22 scenarios unchanged); healing result type grew
  additively (`enemySelfBuffs` / `targetDebuffs`).

### Phase 4a KNOWN LIMITATIONS (deliberate follow-ups — NOT bugs)

1. **`enemy-buff` / Provoke `self-debuff` conditions stay manual-count.** The live
   `enemyBuffNames` / `selfDebuffNames` arrays are correctly plumbed into every condition
   context, but the ship-data gates on those subjects are emitted `derivable: false` in
   `buildShipAbilities.ts` and the parser. Only `derivable: true` paths (count-scaling)
   consume the live data. Flipping the ship gates to `derivable: true` would make them
   live, but would churn all 22 DPS golden snapshots. A deliberate deferred follow-up:
   flip `derivable` in the parser / `buildShipAbilities.ts`, regenerate goldens under a
   controlled KNOWN-DIFF review. Tracked as §6 item 11 in the coverage doc.

2. **Enemy debuffs land at 100%.** Enemy actors carry no hacking stat →
   `debuffLandingChance: 1` hard-coded. Resolution: add optional `enemyHacking` to the
   enemy attacker config and apply the normal landing formula. Tracked as §6 item 12.

## What Phase 4b covers (the next milestone)

**Death and revive modeling.** Per the decomposition map (Phase 4 handoff §Decomposition
table, row 4b), the scope is:

- **`on-destroyed` + `on-ally-destroyed` live triggers.** These are currently
  annotation-only (in `types/abilities.ts` but NOT in `LIVE_TRIGGERS`). Phase 4b promotes
  them to live by emitting `ship-destroyed` events for ALL actors (the engine already
  emits `ship-destroyed` for the heal target in healing mode; this extends it to every
  actor), and by wiring the reactive-trigger machinery to drain `on-destroyed` listeners
  for the dying actor and `on-ally-destroyed` for every other player actor on the same side.

- **Revive / Cheat Death (~5-6 cells).** Ships: Hayyan, Yazid, Tycho (and possibly 2-3
  more). Parsing pattern: "when this unit would be destroyed / is destroyed, instead
  survives with X% HP" or "restores Y% HP to a destroyed ally". Engine requirement: a
  `revive` ability type (or special flag on `heal`) that intercepts the death event before
  HP is floored at 0, or schedules a resurrection after the destroy. The model must track
  a "pending revive" state to avoid double-triggers, and respect "once per combat" limits.

- **Sokol on-kill extra-action seam (§6 item 9a).** Sokol gains an extra action after
  destroying an enemy. Currently annotation-only because it requires `ship-destroyed`
  events for the enemy. Phase 4b delivers those events, so Sokol's seam becomes closeable.

- **Harvester ally-destroyed extra-action seam (§6 item 9b).** Harvester gains an extra
  action when an ally is destroyed. Requires `on-ally-destroyed` live trigger. Phase 4b
  delivers that too.

- **Tithonus purge-count extra-action seam (§6 item 9c)** is NOT part of Phase 4b —
  it requires purge consumption (Phase 4e).

## Engine seams to build on

- `engine.ts` already emits `ship-destroyed` for the heal target; the event shape is in
  `events.ts`. Generalize to all actors and add a `sourceId` / `actorId` so listeners can
  distinguish whose death fired.
- `state.ts` has a `destroyedRound` field on the heal target's runtime. The general-actor
  version can store this in the `PlayerActorRuntime` struct (already has an HP field).
- `triggers.ts` has the reactive-partition machinery; add `on-destroyed` /
  `on-ally-destroyed` to `LIVE_TRIGGERS` and register listeners the same way as
  `on-crit` / `on-debuff-inflicted`.
- The dead-is-dead semantic (HP floors at 0, dead target skips turns, receives no heals)
  already exists for the heal target. Extend to all actors.
- `LIVE_TRIGGERS` is in `src/types/abilities.ts` — add the two new values there.

## Hard constraints (unchanged — apply to every sub-increment)

- DPS + healing goldens (22 + 8+) = referee; zero churn except documented KNOWN-DIFF.
  NEVER `vitest -u` (delete + re-run for targeted regeneration).
- Zero-RNG determinism; listeners PURE (enqueue only).
- Engine core NEVER compares the literal `'attacker'`.
- No RegExp lookbehind in `src/` (iOS Safari 15).
- Pre-commit runs the full suite; no `--no-verify`. ESLint zero warnings.
- `docs/` gitignored — `git add -f` for specs/plans/handoffs/coverage.
- Changelog: one evolving entry per calculator; no per-task appends.
- UI: existing `src/components/ui/` primitives; no raw HTML form controls.

## Workflow (full superpowers flow)

brainstorming (scope revive semantics, revive ability type model, once-per-combat cap,
dead-is-dead for all actors) → spec in `docs/superpowers/specs/` → spec-reviewer loop →
user gate → writing-plans → plan-reviewer → subagent-driven implementation on a
`feat/combat-engine-phase4b-death-revive` branch → final whole-branch review →
finishing-a-development-branch → PR.

## Phase sequence after 4b

| # | Sub-increment | Notes |
|---|---|---|
| **4c** | Enemy-action reactions + generic damage triggers | `on-attacked` consumer ships, `on-self-damaged`/`on-ally-damaged`, Graphite/Refine |
| **4d** | Targeting + multi-enemy | taunt/stealth/provoke targeting, AoE, death-fallback re-targeting |
| **4e** | Consumption & mitigation | cleanse debuff consumption, purge, control effects, damage reduction/reflect |
| **4f** | Defense-calc adoption | defense calculator on the engine |
| **5** | Simulator page | per-round damage/healing/defense per actor; own UX spec |

## Related docs and memory

- **Coverage doc:** `docs/skill-model-coverage.md` §5 (Phase 4a block) + §6 (items 9, 11, 12)
- **Phase-4 decomposition map:** `docs/superpowers/handoffs/2026-06-08-phase4-enemy-offense-handoff.md`
- **Memory:** `project_combat_engine_roadmap.md` (running state), `project_persistent_stacking_buffs.md`
- **Spec/plan location:** `docs/superpowers/specs/` and `docs/superpowers/plans/`
