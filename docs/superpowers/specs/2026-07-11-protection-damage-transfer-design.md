# Protection Damage Transfer — Design

**Date:** 2026-07-11
**Status:** Approved design, pending implementation plan
**Mechanic type:** Combat-engine — reactive damage redirect (`Protection` buff consumption)

## 1. Motivation

`Protection` already exists as a defined game buff (`src/constants/buffs.ts:822`):

> *"Redirects 10% of incoming direct damage to allies to this unit. This effect is stackable, unremovable and stealable."*

The buff is **granted and tracked** today (Meatshield seeds 3 stacks at combat start; stacks surface via `statusEngine.snapshot(id).activeSelfBuffs`) but is **never consumed** — the transfer is a long-standing deferred mechanic (`src/types/abilities.ts:50-52`). This spec defines the consumption: how a protector intercepts a fraction of the damage its allies take.

The damage model below was reverse-engineered empirically and then confirmed against three controlled in-game fights (§3). All numbers reproduce to within measurement noise (~1%).

## 2. The confirmed damage model

For a single direct hit, let `P` be the hit's **pre-target-defense** damage — everything the engine already computes for a hit *except* the target's defense mitigation:

```
P = raw × crit × skill × affinity(attacker → TARGET) × outgoing-buffs
      (raw = effectiveAttack × multiplier + secondaryStat; outgoing-buffs includes Overload, etc.)

redirectFraction = 0.10 × (Protection stacks on the protector)

  TARGET keeps:      (1 − redirectFraction) × P × mitigation(TARGET defense)
  PROTECTOR takes:    redirectFraction     × P × mitigation(PROTECTOR defense)
```

**The single most important rule:** the redirected chunk uses the **protector's own defense** but the **original target's affinity and outgoing modifiers** — affinity is resolved once, against the target, and *not* re-resolved against the protector. (`victimHitDamage` computes affinity per-victim today, so this must be overridden for the transfer, or the protector would get its own — wrong — matchup.)

`mitigation(def) = 1 − calculateDamageReduction(def)/100`, using the existing formula in `src/utils/autogear/priorityScore.ts`.

## 3. Empirical validation (calibration reference for tests)

Setup: **Butcher** (Thermal; 16521 attack, 174 crit power, 100 crit rate, 160% skill, **1 Overload stack** = +10% outgoing) attacks **Cultivator** (Chemical; 8236 defence + Defense Up III = ×1.45). **Meatshield** (Electric; 4008 defence, 3 Protection stacks) protects.

Derived: `P = 72428 (raw) × 1.25 (Thermal>Chemical) × 1.10 (Overload) = 99,589`.

| Measurement | Model | Observed | Δ |
|---|---|---|---|
| Culti, **no** Meatshield (full hit) | 22,273 | 22,572 | −1.3% |
| Culti, with Meatshield (keeps 70%) | 15,591 | 15,801 | −1.3% |
| Meatshield per stack, fight 1 (def 4008) | 4,692 | 4,643 | +1.1% |
| Meatshield per stack, fight 2 (def ×1.45) | 3,784 | 3,743 | +1.1% |
| Split `15801 / 22572` | 0.7000 | 0.7000 | exact |

Fight-2 (Meatshield given +45% defence) confirmed the redirect re-mitigates on the **protector's own defence**: observed chunk ratio `4643/3743 = 1.2404` matches `mit(4008)/mit(4008×1.45) = 1.2402` to 0.03%. The `+25%` affinity on the chunk (vs Meatshield's *own* electric matchup of −25%) is the proof that the redirect keeps the **target's** affinity, not the protector's.

These five numbers are the golden fixtures for the test suite. Butcher's raw must be **calibrated to the observed `P`** (≈99,589), not to nominal 160%/×2.74 — the extra comes from Overload, which the engine already models.

## 4. Behavior rules

1. **Coverage — all allies.** Any living same-side ally's incoming direct damage is eligible for redirect to a Protection holder. (Meatshield's "non-defender ally" wording belongs to `defense-substitution`, not to transfer.)
2. **No self-cover.** A protector redirects only its allies' damage, never its own — it takes its own hits normally.
3. **Direct damage only.** DoT ticks, reflected damage, and other non-direct intake do **not** trigger transfer (`cause.byDirectDamage` gate).
4. **Multi-protector = speed-ordered cascade.** When a target `T` has multiple protectors, order them fastest-first `[P1, P2, …]`. `T` redirects to `P1`; `P1`'s received chunk is itself a direct hit, so `P2` skims `0.10 × P2.stacks` of *P1's chunk*; `P3` skims from `P2`'s chunk; etc. Each hop uses the *next* protector's own stacks against the *previous* protector's pre-defense chunk. A visited-set guard prevents loops.
   - Consequence: the **original target loses only the first hop** (`0.10 × P1.stacks`, capped at 100% = 10 stacks). Later hops redistribute *within* the protector pool and never pull more off `T`.
5. **Cap at 100%.** `redirectFraction = min(1, 0.10 × stacks)` at each hop.
6. **Trigger frequency is per-unit** (new modeled attribute on the Protection-granting ability):
   - `every-hit` — fires on every direct hit (Meatshield).
   - `first-hit-per-round` — fires only on the first direct hit any ally takes each round (Lionheart). Requires per-round tracking.
7. **Team symmetry.** Enemy-side protectors behave identically. Build a side-agnostic protector/stack map and resolve allies via `bySide(side)`.

## 5. Engine integration

Follow the **Reflect model** (`engine.ts:3820-3924`) — structurally identical (re-mitigate on a different ship, keep a specific affinity source, guard re-entry):

- **Hook / `P` capture:** the per-victim seam `victimHitDamage` (`victimDamage.ts:104-149`) / `applyPositionalDamage` (`positionalApply.ts:208-217`). `P` = `perHitShare × hitCritMultiplier × (nonCritFactor without the `(1 − damageReduction/100)` factor)`. Capture `P` before the target's defence term is applied, peel off `redirectFraction × P`, and reduce the target's applied damage to the remainder.
- **Redirect application:** recursively `applyVictimDamage(redirected, protector, protectorSink, { killerId: attackerId, byDirectDamage: true, isProtectionTransfer: true })`. The redirected amount is computed via `victimHitDamage` with a **spliced `VictimDefenseProfile`**: `defence` = protector's, `affinity` = **original target's**, so affinity is not re-resolved. Add an `isProtectionTransfer` re-entry guard mirroring `isReflected`/`isCounter` (`engine.ts:3401-3411`).
- **Stacks & protectors:** read stacks from `statusEngine.snapshot(id).activeSelfBuffs` (`buffName === 'Protection'`, `.stacks`). Build a side-agnostic protector map mirroring `defenseSubstitutionCarrierIds` (`engine.ts:2885-2894`). Resolve a target's protector-allies via `bySide(side).adjacentAllyIdsFor` (all living same-side allies in non-positional mode), filtered to Protection holders, sorted by speed.
- **HP-curve credit:** accumulate redirected damage into `roundPerTargetDamage` (as Reflect does at `engine.ts:3934`) so it appears on the protector's HP trace.

## 6. Composition with `defense-substitution` (already shipped)

`defense-substitution` (Meatshield R4, `engine.ts:2907-2925`) currently substitutes the highest same-side ally defence for *all* direct damage to non-defender allies. Because transfer peels off **before** the defence term, the target's remaining `(1 − fraction)` still reads the substituted defence at the four defence-read sites (`engine.ts:4234, 4496, 4694, 4706`). This makes R4's literal wording true: the portion *"not transferred by Protection"* is what gets the substituted defence. No change to the substitution helper is required, but a regression test must lock the interleaving.

## 7. Scope

**In scope (this spec):**
- Consume the `Protection` buff to transfer direct damage per §2 / §4.
- Multi-protector speed-ordered cascade with loop guard and 100% cap.
- `triggerFrequency` field on the Protection ability; Meatshield (`every-hit`) fully wired.
- Team-symmetric protector map; HP-curve credit; re-entry guard.
- Regression test for `defense-substitution` interleaving.

**Deferred (future SPs):**
- `first-hit-per-round` trigger + the skill-text parsing to set it (Lionheart). The field is modeled now; the parser + per-round tracking is a follow-up phase.
- DoT-transform (Meatshield R2/R3 "damage from Protection becomes a DoT") — reuse the existing `transform-incoming-to-dot` primitive (`engine.ts:3506-3549`); wire once base transfer lands.
- Dynamic stack-stealing (Meatshield charge skill "steals Protection until 3 stacks").

## 8. Testing strategy

- **Golden numbers** from §3: a fixture fight reproducing Culti 15801 / 22572 and Meatshield 4643 / 3743, with Butcher's raw calibrated to `P ≈ 99,589` (1 Overload stack). Assert within ~1.5%.
- **Affinity-source test:** a protector whose own matchup with the attacker differs from the target's — assert the chunk uses the *target's* affinity (would be the −25% trap otherwise).
- **Cascade test:** two protectors of different speeds; assert P1 skims from the original and P2 skims from P1's chunk (not from the original).
- **No-self-cover, direct-only, and 100%-cap** edge tests.
- **Team-symmetry:** mirror one fixture with the protector on the enemy side; identical result.
- **defense-substitution interleave:** non-defender target with a substitution carrier present; assert the remainder uses substituted defence and the transferred chunk uses the protector's own.

## 9. Risks / open items

- The ~1% residual in §3 is defence/buff reading precision, not a model gap; do not chase it in fixtures — calibrate `P` to the observed full-hit number.
- Cascade + AoE interaction: an AoE hit on multiple allies each spawns its own cascade; ensure the visited-set is per-hit, not per-turn, so distinct hits don't suppress each other.
- Re-entry guard must permit the cascade (protector→protector) while blocking a true cycle (P1↔P2). Speed-ordered, next-only traversal with a visited set achieves this.
