# Sub-project A — Dynamic Effective-Stats Backbone — Design

**Date:** 2026-06-17
**Epic:** `2026-06-17-combat-realism-epic-roadmap.md` (sub-project A)
**Status:** Design, pending spec review + user approval.

> Line numbers are 2026-06-17 snapshots of `engine.ts` (~3,900 lines) / `playerTurn.ts` /
> `victimDamage.ts`. Re-locate by symbol name, not offset.

## 1. Problem

The combat engine models stat *buffs* only for the stats that affect damage, and computes
"effective" stats **piecemeal** at the point of use rather than as a per-actor snapshot:

- `ActorStats` (`state.ts:79`) holds only 7 stats: attack, crit, critDamage,
  defensePenetration, defence, hp, speed. **It has no hacking or security.**
- `calculateBuffTotals` (`playerTurn.ts:~280`) folds attack/crit/critDamage/outgoingDamage/
  defence/hp/speed (+ heal mods). **It does not fold hacking or security.**
- Effective damage stats are assembled inside the damage path (`victimHitDamage` scalars,
  `playerTurn.ts:~1115`; `effectiveAttack`, `defenceModifierPct`, `incomingDamageModifierPct`,
  `defensePenetrationPct`, per-victim affinity). Speed has its own live fold (`foldSpeedBuffPct`
  / `effectiveSpeedOf`).
- The debuff-landing roll (`debuffLandingChance`) is computed **once** from the configured
  hacking-vs-security values (`engine.ts:~497`); it never moves when a Hacking/Security
  Up/Down buff is active. It also **omits affinity's ±25% on hacking** (a divergence from
  `dpsSimulator`).

Consequence: Hacking Up/Down and Security Up/Down (which exist throughout the corpus —
Hacking Up ×20, Security Down ×7, etc.) are **inert** during a fight, and shield penetration
has **no consumer at all**. The sim is not yet "all stats dynamic."

## 2. Goal & scope

Make every combat-relevant stat **dynamic in-fight**, sourced from one unified per-round
snapshot, and routed to every consumer.

**In scope (in-fight layer only):**
- A unified `effectiveStatsOf(actor)` snapshot = **pre-fight base + folded in-fight buff/debuff
  deltas**, for all stats. (Pre-fight base is whatever stats the actor is constructed with;
  sub-project F refines that base later — A consumes it as given.)
- Migrate all existing piecemeal effective-stat computations to read the snapshot
  (byte-identical).
- **Newly dynamic behavior:**
  - **hacking / security** → debuff landing & resist shift mid-fight; **add affinity's ±25%
    on hacking** to the roll, and enforce the affinity-disadvantage "non-hacking effects not
    applied" rule.
  - confirm **speed → turn order** reads the unified snapshot.
- **shieldPenetration** is included in the snapshot so the shield system (**H**) can read it, but
  the shield-drain **split** consumer itself lives in H (it belongs with shield absorb), not A.

**Out of scope (other sub-projects):**
- Pre-fight base modifiers — squad leaders, Lionheart-style passives (**F**).
- The **shield system** — per-actor shield grant, sim surfacing, and the shield-pen split (**H**);
  shield *sources* (gear-set, overheal→shield implant) (**D**). A only exposes the
  `shieldPenetration` stat in the snapshot for H to read.
- HP is **not** in-fight-dynamic (no HP buffs); max HP stays fixed once combat starts.
- hpRegen has no combat consumer today → not wired in A (revisit if a consumer is added).
- damageReduction is already consumed; A folds it into the snapshot but adds no new behavior
  unless an audit shows a missing dynamic path.

## 3. The seam: `effectiveStatsOf(actor)`

A single accessor returns an actor's current effective stats for the round, folding the same
two buff sources the existing per-actor folds use (the `foldSpeedBuffPct` pattern generalized
to all stats):

```
effectiveStatsOf(actor): EffectiveStats
  = applyBuffDeltas(actor.baseStats, activeBuffTotalsFor(actor))
```

- Computed per round (speeds/landing can change as buffs expire), cached per `(actor, round)`.
- `EffectiveStats` carries every stat in the canonical list the engine consumes.
- `calculateBuffTotals` is extended to fold **hacking** and **security** (stat keys already exist
  in `StatName`); flat-vs-percentage handling follows the existing convention
  (`PERCENTAGE_ONLY_STATS`; hacking/security are flexible).
- All existing consumers are migrated to read `effectiveStatsOf` so there is **one** source of
  truth. The migration reproduces today's values exactly.

## 4. Increment sequence (leaf-first)

| PR | Scope | Golden gate |
|----|-------|-------------|
| **A1** | Add hacking/security to `ActorStats`; extend `calculateBuffTotals` to fold them; build `effectiveStatsOf` + `EffectiveStats`; **migrate all existing consumers** (damage scalars, defence modifier, speed/turn-order, HP%/decline) to read it. No new dynamic behavior. | **Byte-identical** — reproduces today's piecemeal values exactly (hacking/security folded but not yet consumed). |
| **A2** | **Light up the newly-dynamic stats:** dynamic debuff landing/resist from effective hacking/security; add affinity ±25% to the hacking roll + enforce the disadvantage "non-hacking effects not applied" rule; sweep any remaining stat that should be dynamic. (Shield-pen *split* is sub-project H.) | **Audited churn** — landing/resist shift only when a hacking/security buff is active or affinity is non-neutral on a hacking effect. Synthetic goldens that use none of these stay byte-identical; every moved snapshot explained. |

A1 may sub-split if the consumer migration is large (e.g. A1a accessor + fold written alongside
with no reader = byte-identical à la PR5a, then A1b flip consumers).

## 5. Stat-by-stat consumer map (to verify exhaustively during A1)

| Stat | Status today | A action |
|------|--------------|----------|
| attack | dynamic (effectiveAttack) | migrate to snapshot |
| defence | dynamic (defenceModifierPct) | migrate to snapshot |
| crit / critDamage | dynamic | migrate to snapshot |
| speed | dynamic (effectiveSpeedOf) → turn order | confirm + migrate to snapshot |
| defensePenetration | dynamic | migrate to snapshot |
| hp | not in-fight-dynamic (no HP buffs); max fixed | snapshot holds base; no fold |
| **hacking** | **static** (landing computed once, affinity omitted) | **A2: fold + dynamic landing + affinity ±25%** |
| **security** | **static** | **A2: fold + dynamic resist** |
| **shieldPenetration** | no consumer | include in snapshot; split consumer is **H** |
| healModifier | folded/consumed (healing) | confirm it reads snapshot |
| damageReduction | consumed | fold; add dynamic path only if audit finds a gap |
| hpRegen / shield | no combat consumer / excluded | not in A |

## 6. Safety, testing, workflow

- **Per-PR gate:** A1 byte-identical (any golden move = a migration leak; fix the seam, never
  `vitest -u`). A2 audited churn, explained line-by-line.
- A characterization test locks `effectiveStatsOf` == the old piecemeal values per stat before
  the migration (the PR5a parity-test pattern).
- A2 gets new team-vs-team tests: a Hacking Down debuff lowers an attacker's landing chance
  mid-fight; a Security Up buff raises resist; an affinity-disadvantaged attacker fails to land
  an `apply` debuff; a shield-pen attacker splits damage 80/20 against a shielded victim.
- **Vacuous-test trap:** landing/resist assertions must compare an observable the actor actually
  produces (assert a non-zero baseline, then the shift).
- `audit:skills` 0/141, lint + tsc clean every PR. Subagent-driven; per-task spec + quality +
  final holistic review. Standard campaign workflow (see epic roadmap §Workflow).

## 7. Open questions (resolve during planning)
- Does affinity apply to the **resist** side (security) too, or only the attacker's hacking? The
  image specifies hacking; security's affinity treatment needs confirmation (default: affinity
  affects the attacker's hacking only, per the image).
- (Shield-pen split ordering vs Barrier/Cheat-Death intercepts is sub-project H's concern, not A's.)

## 8. References
- Epic: `2026-06-17-combat-realism-epic-roadmap.md`.
- `src/utils/combat/state.ts` (`ActorStats`), `playerTurn.ts` (`calculateBuffTotals`,
  `foldSpeedBuffPct`, victim scalars ~1115), `engine.ts` (landing gate ~494,
  `effectiveSpeedOf`, `applyIncomingToTarget`), `victimDamage.ts` (`AttackerDamageScalars`,
  `VictimDefenseProfile`).
- Affinity: `docs/Loading_Screen_Affinities.png`. Stats: `src/types/stats.ts`.
