# Ship-Kit Correctness — Wave 5: Enemy-adjacency splash (`adjacent-enemies`)

**Date:** 2026-07-18
**Source:** `docs/ship-kit-fix-plan.md` Wave 5; `docs/ship-kit-correctness-ledger.md` findings.
**Status:** approved (design), pending implementation plan.

## Problem

The `AbilityTarget` enum has `adjacent-allies` (owner-anchored ally splash) but **no
enemy-adjacency scope**. Skill clauses that hit "the targeted enemy AND all enemies adjacent to
it", "all enemies adjacent to the (original) target", or (on bomb detonation) "all adjacent
enemies" are all silently collapsed to a single primary target (`target='enemy'`), dropping the
splash. Worse, because `detectEnemyGrantScope` tests `/all\s+enemies/`, sibling debuffs in the same
clause currently **over-widen to `all-enemies`** (Asphyxiator Defense Down III, Vindicator
Corrosion II / Out. Damage Down I).

### Findings closed

| Ship / clause | Effect | Scope needed | Current (buggy) parse |
|---|---|---|---|
| Asphyxiator active — Inferno III | dot | target + adjacent | `dot target=enemy`; sibling Defense Down III wrongly `all-enemies` |
| Asphyxiator charged — Stasis | control | target + adjacent | `control target=enemy`; sibling Stasis debuff wrongly `all-enemies` |
| Vindicator active — Provoke *(5th case surfaced by audit)* | debuff | adjacent only | `debuff` widened to `all-enemies` |
| Vindicator charged — Out. Damage Down I | debuff | adjacent only | `debuff` widened to `all-enemies` |
| Demolisher passive — bomb splash | reactive damage | adjacent only (anchored on bomb victim) | `damage target=enemy trigger=on-cast`, no `ignoresDefense`/no-crit |

## Design

### Two new `AbilityTarget` values (plural, matching `adjacent-allies`)

- **`adjacent-enemies`** — living opposing actors adjacent to the anchor, **anchor excluded**.
- **`target-and-adjacent-enemies`** — the anchor **plus** its adjacent enemies.

Rationale for two values (not one): Asphyxiator's Inferno/Stasis must reach the primary target
(so the anchor is *included*); Demolisher's splash must NOT re-hit the bomb victim (double-count)
and Vindicator's debuffs are text-scoped to adjacent-only. A single "always include anchor" value
would double-count Demolisher; a single "always exclude" value would drop Asphyxiator's primary.

### Recipient resolution — reuse `adjacentAllyIdsFor`

`adjacentAllyIdsFor(anchorId)` (engine.ts side-dispatcher ~2855) already returns "living same-side
neighbours of anchor, anchor excluded", routed by the anchor's side. Passing the **enemy target's**
id returns exactly "the target's adjacent enemies", team-symmetrically. No new resolver.

- `adjacent-enemies` → `adjacentAllyIdsFor(anchorId)`
- `target-and-adjacent-enemies` → `[anchorId, ...adjacentAllyIdsFor(anchorId)]`

The anchor is the ability's resolved **primary target** on the cast path, and the **bomb victim** on
Demolisher's reactive path.

### Fallback semantics (mirror `adjacentAllyIds`)

- **Positional** (anchor + ≥1 other opposing actor carry a board `position`): hex-neighbours via
  `neighbors(anchor.position)`.
- **Non-positional**: all living opposing actors (adjacent-only excludes the anchor).
- **DPS single-dummy scenario**: adjacent-only → `[]`; target+adjacent → `[dummy]` (identical to
  today's `enemy`). **DPS output is unchanged** — the fidelity gain is purely in the positional sim.

### No cast-damage fan-out

None of the five clauses splash *damage* on the cast path (Asphyxiator/Vindicator damage is
target-only; Demolisher's splash is reactive). `footprintVictims`/`applyPositionalDamage` are
untouched.

## Implementation — PR stack

### PR-A — enum + parser + debuff/control fan-out

- **Types:** add both values to `AbilityTarget` (`types/abilities.ts` ~88), to `SkillEffect.target`
  (`skillTextParser.ts` ~4563), and to `ENEMY_FACING_TARGETS` (`applyAbilities.ts` ~170) so
  `skillNeedsOpposingVictim` counts them.
- **Parser detector (clause-scoped):** recognise the adjacency phrase and route the *carrying
  clause's* effect:
  - "on the targeted enemy and all enemies adjacent to it / the enemy" → `target-and-adjacent-enemies`
  - "to all enemies adjacent to the (original) target" → `adjacent-enemies`
  Must run **before** the `/all\s+enemies/` widen in `detectEnemyGrantScope` (~5009) and be scoped to
  the specific effect clause, so sibling single-target debuffs (Defense Down III, Corrosion II) stay
  `enemy`. This is a clause-scoping fix in the family of `project_clause_scoping_abbrev_periods`.
- **Engine fan-out:** extend the debuff `recipientIds` computation (`playerTurn.ts` ~1492–1501) and
  Stasis/control named-status application to fan over the resolved id list for the two new targets.
- **Editor:** add both targets to the ability-target picker.
- **Closes:** Asphyxiator charged Stasis, Vindicator active Provoke, Vindicator charged Out. Damage
  Down I. Also fixes the sibling over-widen bug.

### PR-B — DoT multi-victim fan-out

- DoT application currently writes to a single `tgt.*Entries` container (bound in `buildTurnArgs`
  ~5511; written by `applyNewDoTs` playerTurn.ts ~773). Extend so a `target-and-adjacent-enemies` DoT
  lands on **each** recipient's inferno/corrosion/etc. container.
- **Closes:** Asphyxiator active Inferno III splash.

### PR-C — Demolisher reactive splash

- **New `ignoresDefense` flag** on the damage config (`types/abilities.ts` ~602) + executor support
  in `applyReactiveDamage` (engine.ts ~4610) so the splash bypasses the defence mitigation term.
- **No-crit regex:** extend `NO_CRIT_RE` (`skillTextParser.ts` ~2856) to match "cannot result in a
  critical hit" (in addition to "cannot critically hit").
- **Bomb-detonated victim id:** add `victimId` to the `bomb-detonated` event (`events.ts` ~251) and
  every emitter (playerTurn.ts ~911/2290; engine.ts ~5271/5368/7318) so the reactive executor can
  anchor the splash.
- **Parser:** route Demolisher passive splash → `trigger:'on-bomb-detonated'`,
  `target:'adjacent-enemies'`, `ignoresDefense:true`, `noCrit:true`. The generic on-cast damage
  builder (`buildShipAbilities.ts` ~1096–1141) never calls `detectBombDetonatedTrigger`; add that
  path plus the flag detection. Tolerate the CSV typo "adjavent".
- **Reactive executor:** fan `applyReactiveDamage` over `adjacentAllyIdsFor(bombVictimId)`.
- **Closes:** Demolisher passive splash.

## Testing

- **Build-level parser tests** per ship — assert `target` / `trigger` / `ignoresDefense` / `noCrit`
  on `buildShipAbilities` output. The kit-bundle trace serialises `target`, so the forced-trace
  re-verify confirms these (unlike condition gates — see Wave 4 lesson).
- **Positional-sim integration tests** (positions wired): splash fans to neighbours; adjacent-only
  excludes the anchor; `target-and-adjacent-enemies` includes it; Demolisher splash ignores Defense
  and never crits; splash is team-symmetric (enemy-side Demolisher/Asphyxiator behave identically).
- **DPS-invariance:** single-dummy scenario byte-identical to pre-change for Asphyxiator; adjacent-
  only contributes nothing.
- Full `npm test` (golden `audit:skills` spans the whole suite) after each PR; `npm run lint` (lint
  is a separate gate from `npm test`).

## Risks

- Shared-regex changes in the parser (`detectEnemyGrantScope`, `NO_CRIT_RE`) — run the full golden
  audit after each edit; the over-widen fix must not regress legitimate `all-enemies` clauses.
- Reactive-splash leaking to the DPS dummy sink — stamp/anchor on `victimId`, gate on positional
  completeness (see `project_reactive_dot_routing_and_dummy_gate`).
- New `bomb-detonated` field: every emitter must populate `victimId` or the splash silently no-ops.

## Out of scope (deferred)

- Asphyxiator passive on-crit single-debuff extend (Wave 8 — distinct from Wave 4's generic
  `extend-status`).
- Demolisher active Bomb III WRONG-EXEC (Wave 7).
- Quixilver Barrier all-allies target (Wave 8).
