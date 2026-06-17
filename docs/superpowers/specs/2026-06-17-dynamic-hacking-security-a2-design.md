# Sub-project A — PR A2: Dynamic Hacking/Security & Debuff Landing — Design

**Date:** 2026-06-17
**Epic:** `2026-06-17-combat-realism-epic-roadmap.md` (sub-project A)
**Parent spec:** `2026-06-17-dynamic-effective-stats-design.md` (A2 is the "light up the newly-dynamic stats" row)
**Predecessors:** A1a (accessor, shipped), A1b (damage-path consumer migration, shipped)
**Status:** Design — user-approved 2026-06-17; pending spec review.

> Line numbers are 2026-06-17 snapshots. Re-locate by symbol name, not offset.

## 1. Problem & goal

Hacking and security exist throughout the buff corpus (Hacking Up ×N, Security Up/Down) but are
**inert in-fight**: the debuff-landing chance is computed **once** at fight setup and never moves
when a Hacking/Security buff lands or expires. The positional/healing engine path also **omits
affinity's ±25% on the hacking roll** (a divergence from `dpsSimulator`, which applies it).

A1a/A1b built the unified `effectiveStatsOf` snapshot and migrated the damage path to it; hacking
and security are carried in the snapshot as **base pass-through, unfolded, and unread**. A2 makes
them dynamic and routes them to the landing roll.

**Goal:** debuff **landing** (attacker hacking) and **resist** (defender security) shift mid-fight
from the unified snapshot, with affinity ±25% applied to the attacker's hacking in the engine path.

## 2. Decided scope (user-ratified 2026-06-17)

- **Resist = the defender's LIVE per-target security** — recompute the landing roll from
  `effectiveStatsOf(defender).security` at draw time (the turn's target is in scope in
  `runPlayerTurn`). A Security Up buff on the defender raises its resist live. The "defender" is
  the turn's target; full **AoE per-victim** resist stays in sub-project E.
- **Single PR**, audited churn (no A2a/A2b split). Infra + parser + dynamic landing + affinity ship
  together; every moved snapshot explained.
- **Affinity on hacking** = the same `affinityDamageModifier` (±25) `dpsSimulator` already reuses
  for the hacking roll; **attacker-hacking only**, not defender security (resolved 2026-06-17).
- Hacking/security are **flat** stats (`src/types/stats.ts` flexible group); their buffs are
  **flat additive** (e.g. `+40 Hacking`, `+20 Security`), folded by summation — NOT percentages.

**Out of scope:** AoE per-victim resist (E); hpRegen/damageReduction dynamic paths (no gap found);
shield-pen (H). HP remains non-in-fight-dynamic.

## 3. The fold pipeline (infra)

| Surface | Today | A2 change |
|---|---|---|
| `ParsedBuffEffects` (`src/types/calculator.ts`) | has `security?`, **no `hacking?`** | add `hacking?: number` (flat) |
| `Buff.stat` union (`calculator.ts`) | CLOSED — excludes `'hacking'` **and** `'security'` | add `'hacking' \| 'security'` |
| `toSimBuffs` (`src/utils/calculators/dpsBuffHelpers.ts`) | **drops** `security` (no branch); no `hacking` | add branches for `hacking` + `security` |
| `calculateBuffTotals` (`src/utils/combat/buffTotals.ts`) | no hacking/security fold | fold `hackingBuff` + `securityBuff`; extend return shape |
| `foldActorBuffTotals` / `effectiveDamageStatsOf.totals` (`effectiveStats.ts`) | enumerate the `calculateBuffTotals` shape field-by-field | carry the two new fields (unread by the damage path) |
| `effectiveStatsOf` (`effectiveStats.ts`) | `hacking/security = base ?? 0` (pass-through) | **fold**: `base + buffTotal` (flat additive) |

The fold reuses the existing two self-buff sources (scheduled + timed ability statuses) — the same
`foldActorBuffTotals` machinery A1a built. No new fold source.

## 4. Base-stat plumbing (sequencing landmine — do FIRST within the PR)

**BINDING ORDER:** plumb base hacking/security onto **every** actor before any consumer reads them.
Otherwise an actor defaults to 0 → landing over-lands (attacker) or never resists (defender).

- **Walked-team actors** (`engine.ts` ~1162-1173): thread base `security` (A1a threaded `hacking`;
  the walk bundle needs the `security` field plumbed from its source — `deriveTeamEngineActors`).
- **Enemy actors** (`engine.ts` ~467-479 / `buildEnemyPlayerActorRuntime`): plumb base **hacking and
  security** (currently neither — every enemy would be a perfect lander / zero-resist).
- **DPS dummy / configured enemy:** plumb the configured `enemySecurity` onto the dummy's base
  `security`, so `effectiveStatsOf(defender).security` returns it (else dynamic resist reads 0 and
  every debuff lands).
- **Player attacker actor:** plumb base `hacking` onto the attacker's `ActorStats` too. The
  configured `input.hacking` today lives only in the DPS adapter scalar, NOT on
  `effectiveStatsOf(attacker).hacking` (the attacker `createActor` at `engine.ts:1111` carries no
  `hacking`). The live landing read needs it on the actor — a **discrete task**, symmetric with the
  dummy's security, so it isn't missed.

This is the same plumbing the parent spec's holistic-review sequencing note flagged: **(1) plumb
base, (2) wire fold, (3) consume in landing.**

## 5. Dynamic landing/resist mechanism

A per-round, per-target landing chance, mirroring `dpsSimulator.ts:240-246` but with live folded
stats + affinity in the engine path:

```
effHacking = effectiveStatsOf(attacker).hacking * (1 + affinityDamageModifier / 100)   // attacker-only affinity
effSec     = effectiveStatsOf(defender).security                                        // no affinity on security
chance     = clamp(effHacking - effSec, 0, 100) / 100
```

- Computed per round, cached per `(attacker, round)` like the other effective-stat reads.
- Route the **live** `chance` into the existing gate consumers — `debuffLandingGate(...)`,
  `roundDebuffLanded()`, `landsTimedEnemyApplication('inflict')` — in place of the baked-in static
  `debuffLandingChance` scalar. `makeRateGate` (the deterministic rate accumulator) is unchanged;
  only its **rate** becomes live. The engine becomes the **source of truth** for landing; the
  scalar threaded by `dpsSimulator`/`healingEngineAdapter` is demoted to redundant/fallback.
- **Team-agnostic:** `runPlayerTurn` runs for player/team/enemy (engine.ts:3005/3124/3397), so enemy
  attackers get the same dynamic landing vs the player defender's live security — advancing the
  "behaves identically on both sides" goal.
- **`defender` = the turn's target.** AoE multi-victim resist is E.

**Affinity-disadvantage "non-hacking effects not applied" rule:** the existing
`landsTimedEnemyApplication('apply') = !affinityDisadvantage` gate (`engine.ts:1253-1264`,
`:467-479`) IS this rule — an affinity-disadvantaged attacker's `apply`/affinity-only effects are
resisted. Keep it. Verify it also covers the recurring/aura `'apply'` path; extend only if an audit
finds a gap. `'inflict'` (and unmarked) effects draw the live hacking-vs-security gate.

## 6. Parser emission

Add a `hacking` branch to `parseBuffEffects` (`src/utils/calculators/buffParser.ts`) — regex
`([+-]\d+)\s*Hacking`, mirroring the existing flat `Security` branch — emitting
`parsedEffects.hacking`. The buff data (`src/constants/buffs.ts`) already carries Hacking/Security
Up/Down entries; only the parser branch is missing for hacking. Spot-check the actual buff text for
spacing variants (the Security branch already matches both `+40 Security` and `+40Security` via
`\s*`); confirm the Hacking entries match the chosen regex.

## 7. Golden / audit strategy

**Audited churn**, explained snapshot-by-snapshot:
- Combat goldens move **only** where a hacking/security buff is active **or** affinity is non-neutral
  on an inflicted (`'inflict'`) debuff. Synthetic fixtures using none of these stay byte-identical.
- The **skill-audit** golden (`docs/skill-audit.md`) moves for newly-recognized Hacking buffs —
  expected; explained.
- **DPS-mode parity check (load-bearing):** with the dummy's plumbed base security + the attacker's
  configured hacking + affinity, the new internal computation must reproduce today's static
  `debuffLandingChance` when no hacking/security buff is active — confirm DPS goldens that have no
  such buffs stay byte-identical.

## 8. Testing (per parent spec §6)

New team-vs-team tests, each asserting a **non-zero baseline then the shift** (vacuous-test guard):
- A Hacking Down debuff on the attacker lowers its landing chance mid-fight.
- A Security Up buff on the defender raises its resist mid-fight (fewer debuffs land).
- An affinity-disadvantaged attacker fails to land an `'apply'` debuff.
- Parser test: "Hacking Up/Down" text → `parsedEffects.hacking` with the right flat value.
- `effectiveStatsOf` test: a self Hacking/Security buff folds into `.hacking`/`.security`.

`audit:skills` 0/141 (modulo the explained skill-audit.md delta), lint + tsc clean. Subagent-driven;
per-task spec + quality + final holistic review.

## 9. Risks

- **Plumb-base-before-consume ordering** — the top byte-identity/correctness risk; the plan
  sequences base plumbing first, fold second, landing-consume last.
- **Engine-vs-threaded landing reconciliation** — the engine becomes the source of truth; the plan
  must prove DPS-mode parity (§7) so demoting the threaded scalar doesn't silently shift no-buff
  fixtures.
- **Shape-extension reach** — adding `hackingBuff`/`securityBuff` to the `calculateBuffTotals` shape
  touches `effectiveStats.ts` (A1b code) in two places; carried-but-unread keeps the damage path
  byte-identical.

## 10. References
- Landing formula + affinity-on-hacking: `src/utils/calculators/dpsSimulator.ts:240-246`,
  `:178-211` (team), `healingEngineAdapter.ts:174`.
- Gates: `engine.ts:1250/474/1253-1264/467-479`, `playerTurn.ts:731`, `statusEngine.ts:305/669`.
- Types: `src/types/calculator.ts` (`ParsedBuffEffects` ~91, `Buff.stat` ~60-74), `src/types/stats.ts`.
- Fold: `src/utils/combat/buffTotals.ts`, `src/utils/combat/effectiveStats.ts`,
  `src/utils/calculators/dpsBuffHelpers.ts` (`toSimBuffs`).
- Base plumbing: `src/utils/combat/state.ts` (`ActorStats`), `engine.ts` walked-team ~1162-1173.
- Affinity model: `docs/Loading_Screen_Affinities.png` (advantage +25% damage & hacking;
  disadvantage −25% damage & hacking + crit cap 75% + non-hacking effects not applied).
