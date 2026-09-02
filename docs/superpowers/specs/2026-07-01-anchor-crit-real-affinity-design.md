# Design — Anchor (primary-target) crit at the anchor's real affinity

**Date:** 2026-07-01
**Sub-project:** Sub-project 1 of the "eliminate `enemy[0]` from the sim" epic (handoff: `docs/superpowers/handoffs/2026-07-01-no-enemy0-in-sim-handoff.md`). Folds in the **SP3 audit** (aggregate/leech affinity) as a documented finding. **SP2 (per-target debuff landing) is explicitly out of scope.**
**Prereq shipped:** PR #183 (per-victim crit for *covered* AoE victims + affinity cap/penalty; `rollVictimCrit` closure).

## Problem

In the multi-enemy battle sim, the **anchor** (primary/selected positional victim) has its per-hit crit rolled at the **representative** opponent's affinity cap (`enemy[0]` for player-side, `player[0]` for enemy-side), not the affinity of the ship it is actually hitting.

Concretely: `playerTurn.ts` rolls the per-hit `hitCrits[]` array using `effectiveCrit = cappedCrit(dmgStats.totals.critBuff)`, where `cappedCrit` (`playerTurn.ts:864`) applies `affinityCritCap`/`affinityCritPenalty` — scalars computed once in `battleSimulator.ts` against the *representative* opponent (`computeAffinityModifiers(attackerAffinity, enemyRepAffinity)`, `:653/:657/:688`). `positionalApply` then has the anchor **reuse** that representative-capped `hitCrits[h]` (`positionalApply.ts:193`, the `isAnchor` branch). PR #183 already fixed **covered/splash** victims (they roll via `rollVictimCrit(victim.affinity)`), but the anchor still uses the representative cap.

The user directive: **for the multi-enemy sim we never want `enemy[0]`** — every affinity effect must resolve against the ship actually being hit. (The **DPS calculator** is exempt: it has one chosen target, so its representative *is* the target. DPS behaviour must not change.)

## Chosen approach — Strategy A (fix the affinity at the existing single roll site)

Rather than move the anchor's crit roll into `positionalApply` (the handoff's Sub-project-1 framing, which creates a "double draw" — a wasted `playerTurn` roll plus a fresh `positionalApply` draw), fix the affinity at the **existing** single roll site so the double draw is never created.

The engine already resolves the real anchor (`tgt` via `selectTurnTarget(actor)`) and computes `willApplyPositionally` **before** calling `runPlayerTurn` — symmetrically at all three sites (focus `engine.ts:4796/4814`, team `:5123/:5133`, enemy `:5612` region). `buildTurnArgs(actor, tgt)` already binds `enemy: tgt`, and `runPlayerTurn` already receives `deferAbilityPerformedToEngine` (≡ `willApplyPositionally`). For the positional case, the bound `enemy` **is** the resolved anchor, carrying its real `affinity`.

**The change:** in `playerTurn.ts`, when `deferAbilityPerformedToEngine` is true (i.e. this cast will resolve positionally), compute the crit cap/penalty from the **anchor's** affinity (`computeAffinityModifiers(attackerAff, enemy.affinity ?? 'antimatter')`) instead of the representative `affinityCritCap`/`affinityCritPenalty` scalars, and use those anchor-derived values inside `cappedCrit`. When `deferAbilityPerformedToEngine` is false (DPS, healing, non-positional sim), `cappedCrit` keeps the representative scalars — **byte-identical**.

**Consequences (all fall out for free):**
- `positionalApply.ts` needs **no change**: the anchor keeps reusing `hitCrits[h]` (`isAnchor` branch stays), which is now rolled at the anchor's real affinity. Covered victims keep rolling via `rollVictimCrit(victim.affinity)`. Every footprint victim is now per-victim-affinity-correct.
- `critHits` / `roundCrit` / `ctx.roundCrit` self-crit gates / the aggregate `directDamage` / the deferred `ability-performed` crit signal (`critAgg.anyCrit`/`critPairs`, which already counts the anchor's `hitCrits[h]` outcome in the footprint loop) **all** derive from the single real-affinity anchor roll — fully consistent, no double roll, no lifecycle surgery.
- **One draw per anchor hit** (unchanged draw count): `critGate(rate)` consumes exactly one draw regardless of `rate`, so only the boolean *outcome* changes where the anchor's affinity differs from the representative.

### Why not Strategy B (defer `roundCrit`/`critHits` out of `playerTurn` to the engine)
`ctx.roundCrit` gates firing abilities (`buildRoundContext(..., roundCrit, ...)`, `playerTurn.ts:1315/1323`) and is consumed *inside* `playerTurn`, before `positionalApply` runs. Deferring the crit result to the engine would break that gate's lifecycle and require reworking the `ctx` build. Strategy A keeps the entire crit lifecycle in place and only corrects the affinity input — far less invasive, no benefit forgone.

## Scope of golden re-baseline

- **Byte-identical:** any turn whose resolved anchor **equals that side's representative** — i.e. all player-side attacks in single-enemy sims (`tgt == enemyPlans[0]`), and all DPS/healing/non-positional casts (representative cap retained).
- **Re-baselines (expected, correct):** positional turns whose resolved anchor ≠ the side's representative — notably **enemy-side attacks in multi-player fixtures** (the enemy's target ≠ `player[0]`), and **player-side attacks in multi-enemy fixtures** when the primary target ≠ `enemy[0]`. Only the crit *outcome* shifts (draw count unchanged); downstream per-round RNG re-sequences from that point.
- **Hard gate:** DPS + healing goldens must stay **byte-identical**. Inspect every changed sim snapshot hunk; never `vitest -u` to blanket-update.

## SP3 audit — aggregate / leech affinity (documented no-op)

`affinityMult = 1 + affinityDamageModifier / 100` (`playerTurn.ts:1307`) uses the **representative** `affinityDamageModifier` for the aggregate `directDamage`. Verified this does **not** surface `enemy[0]`'s affinity in the sim:
- The **per-victim damage** actually applied to each footprint victim (anchor included) is computed in `victimDamage.ts` via `computeAffinityModifiers(s.attackerAffinity, v.affinity)` — real per-victim affinity. The `attacked` per-victim events carry that real damage.
- The **combat log** renders per-victim numbers from `entry.targets` (the per-victim `attacked` emits), not from the aggregate `ability-performed.damage` (`RoundEventLog.tsx:72-98` — `renderTargets` maps `entry.targets`). So the representative `affinityMult` on the aggregate is **not user-visible per-target** in the sim.
- The aggregate `directDamage` feeds only the DPS number (single target = representative = correct) and the RoundData aggregate/`ability-performed.damage` display value.
- **Leech (E2):** per-victim leech is wired via `onVictimResolved` on the real per-victim damage, not the aggregate.

**Conclusion:** leave `affinityMult`/`affinityDamageModifier` representative-based. Changing it would churn DPS goldens for zero sim benefit. Documented as a known, non-user-visible residual.

## Documented residuals (unchanged by this work)

1. **Per-hit anchor re-resolution:** `hitCrits[]` is rolled up front in `playerTurn` at the initially-resolved anchor's affinity; if a multi-hit cast kills the anchor and `positionalApply` re-resolves a *different* anchor on a later hit, that later hit reuses the up-front cap. No worse than today (the anchor already reused the up-front `hitCrits[h]`); improves the common (no-mid-cast-kill) case. Rare; document.
2. **SP3 aggregate `affinityMult`:** representative-based (above).
3. **SP2 — per-target debuff landing** (`affinityDisadvantage` `'apply'` gate; `'inflict'` hacking-vs-security gate): still resolves against the bound `enemy`/representative. **Out of scope** — its own spec later (requires positional/per-victim debuff routing, which does not exist yet).

## Files touched

- `src/utils/combat/playerTurn.ts` — the sole production change: compute anchor-affinity cap/penalty when `deferAbilityPerformedToEngine`, use in `cappedCrit`. Compute the override **at the `cappedCrit` site (`:864`)** — both raw inputs are already in scope there (`attackerAffinity` destructured from `runtime` at `:749`, the bound `enemy` at `:781`); **no hoist required** (the `attackerAff` alias at `:1249` is just convenience). `computeAffinityModifiers` is **already imported** (`:22`) — add no new import.
- No change to `positionalApply.ts`, `engine.ts`, `battleSimulator.ts`, or `victimDamage.ts`.

## Testing

- **Unit (playerTurn):** a positional cast (`deferAbilityPerformedToEngine: true`) against an anchor whose affinity puts the attacker at a disadvantage rolls `hitCrits` at the **anchor's** capped rate, not the representative's; the same cast with `deferAbilityPerformedToEngine: false` uses the representative cap (byte-identical). Assert via a seeded/deterministic `critGate` and a crit total that straddles the two caps so the outcome differs.
- **Regression:** `positionalApplyPerVictimCrit.test.ts` still passes unchanged (no `positionalApply` change; anchor still reuses `hitCrits[h]`).
- **Goldens:** run the full `npm test`. Confirm DPS + healing snapshots byte-identical (hard gate). Inspect each changed sim-positional hunk; confirm changes are confined to turns whose anchor ≠ representative.

## Out of scope

- SP2 (per-target debuff landing) — separate spec.
- Any DPS-calculator behaviour change.
- Non-positional sim casts against the dummy sink (no anchor to resolve; representative is the only opponent modelled on that path).
