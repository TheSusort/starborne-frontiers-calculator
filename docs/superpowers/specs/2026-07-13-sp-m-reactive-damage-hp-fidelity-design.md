# SP-M — Reactive-damage HP fidelity (M1)

**Epic:** Team-Agnostic Engine Unification & Sim Fidelity (`2026-07-12-team-agnostic-engine-unification-epic-design.md`).
**Status:** design approved 2026-07-13. Branch: off `main` (SP-F PR3 `ba5199e9` merged).
**Scope:** M1 only. **M2 (Meatshield "steal Protection until 3 stacks") is DEFERRED** — see Non-goals.

---

## 1. Summary

Make reactive-damage procs **actually reduce the victim's HP in positional sim**, and surface them in
the F1 accounting (`perTargetDealt` → `damageDealt`, and the victim's `damageTaken`). Today the shared
reactive-damage executor `applyReactiveDamage` is **credit-only**: it computes the mitigated/crit amount,
credits the DPS focus scalar (`creditDamage`) and logs it, but never calls `applyVictimDamage`. So in a
positioned multi-ship battle a reactive proc deals **zero HP** to any enemy and is **absent** from the
per-attacker `damageDealt` surface.

This is a shared contract across **eight ships**: FrontLine (on-enemy-charged-cast), Grif
(on-enemy-cleansed), the re-tagged round-boundary procs Judge / Chakara / Incinerator / Rhodium, and the
`hpBasisPct` retaliations Paracelsus (on-destroyed) and Vindicator (on-resist). All eight are fixed
**uniformly** by the shared executor — there is no clean way to fix only FrontLine without special-casing.

## 2. Background & root cause (audited 2026-07-13)

- **Executor:** `applyReactiveDamage` (`engine.ts:4504`). Computes `raw` via the same
  `victimHitDamage` mitigation/crit walk `applyCounterAttack` uses (comment `engine.ts:4489-4499`),
  then `creditDamage(ownerId, 'direct', raw)` (`engine.ts:4595`) and `reactiveDealtByOwner.set(ownerId,
  raw)` (`:4594`). It **never** calls `applyVictimDamage` — "this executor never mutated a specific
  victim's HP before" (`:4494-4497`).
- **Drain wiring:** `triggers.ts:2742` (the `hpBasisPct` retaliation path — Paracelsus/Vindicator) and
  `triggers.ts:2778` (the multiplier path — FrontLine/Grif/Judge/Chakara/Incinerator/Rhodium). The
  returned `{dealt, didCrit}` flows **only** to `emitReactiveDamageLog` (`:2756`, `:2786`) — never to HP.
- **F1 gap (pinned):** `applyReactiveDamage` does not call `creditDealt`, so reactive damage is missing
  from `roundPerTargetDealt` (attacker→victim) → absent from `BattleResult`/`ShipRoundState.damageDealt`
  (`battleSimulator.ts:1016-1019`, `:357`). Documented in
  `docs/superpowers/notes/2026-07-13-f1-attribution-audit.md` §5b (`:194-216`), which explicitly flags
  that "SP-M's plan needs its own engine-side step" — F1's mirror cannot reach this path. **This spec
  retires that pin.**
- **Shield magnitude is already correct** (SP-G G3, shipped): the FrontLine reactive shield scales off
  the actual mitigated/crit dealt amount via `reactiveDealtByOwner` (read at `triggers.ts:2503-2504`),
  proven by `enemyChargedCast.integration.test.ts` (shield shrinks under enemy defense). **This spec
  does not touch the shield magnitude and does not remove `reactiveDealtByOwner`.**

## 3. The template: `applyCounterAttack`

The counter executor (`engine.ts:4470-4486`) is the precedent — a reactive hit that reduces HP and
reconciles:

```
if (raw <= 0) return;
applyVictimDamage(raw, attacker, sink, { killerId: owner.id, byDirectDamage: true, isCounter: true,
                                         shieldPenetrationPct: 0, bombPortion: 0 });
roundPerTargetDamage.set(attacker.id, (roundPerTargetDamage.get(attacker.id) ?? 0) + raw); // HP curve
creditDealt(owner.id, attacker.id, raw);                                                   // F1 damageDealt
return { dealt: raw, didCrit };
```

Note it does **not** call `creditDamage` (the DPS focus scalar `cumulativeDamage`). Reactive damage does
the opposite today. Reconciling those two accounting philosophies without regressions is the one genuine
design decision (§5).

## 4. Desired behaviour (invariants)

1. **Positional mode** (`!dpsEnemyTarget`; a real positioned opposing roster exists): a reactive proc
   reduces the resolved victim's HP **exactly once** via `applyVictimDamage`, surfaces on the victim's HP
   curve (`roundPerTargetDamage`) and `damageTaken`, and is attributed to the owner via `creditDealt`
   (`perTargetDealt` → `damageDealt`). The `damageDealt`↔`damageTaken` reconciliation the F1 sim goldens
   assert stays intact by construction. The victim may now **die** from reactive damage — death/retarget
   flows via the shared `applyVictimDamage` funnel (same as counters).
2. **DPS mode** (`dpsEnemyTarget`, no positioned enemy attackers): **no HP double-count** with the
   post-round aggregate apply (`engine.ts:7931-7943`, which lands `totalRoundDamage + teamRoundDamage`),
   and reactive damage **remains part of the DPS-calc's reported damage** (`cumulativeDamage`) exactly as
   today — `enemyChargedCast.integration.test.ts:417-420` (`focusCumulativeDamage(reaction) > control`)
   must still hold.
3. **Team-symmetric:** identical behaviour for a reactive-damage ship on either side (engine is
   team-agnostic post-bySide). Each affected mechanic gets a both-sides fixture.
4. **Flags preserved:** `noCrit` (Grif/Rhodium "cannot critically hit") and the `hpBasisPct` retaliation
   path (Paracelsus 50%-max-HP on-destroyed, Vindicator 30%-max-HP on-resist) flow through the same
   funnel and also reduce HP.
5. **Shield unchanged:** `reactiveDealtByOwner` is retained; the FrontLine shield magnitude and its tests
   are untouched.

## 5. The one genuine design decision (resolve in the plan)

Reactive damage currently feeds `cumulativeDamage` (via `creditDamage`) so it counts in the DPS metric AND
the DPS-mode post-round aggregate. Counters feed HP directly (`applyVictimDamage`) and skip
`cumulativeDamage`. The plan must land the HP reduction in positional mode **without** (a) double-counting
against the DPS-mode aggregate, or (b) dropping reactive damage from the DPS-calc's reported
`cumulativeDamage`. Candidate mechanisms, to settle via TDD:

- **(A, preferred) Mode-gated dual path.** Keep the current credit-only path in **DPS mode** unchanged
  (reactive stays in `cumulativeDamage` → aggregate applies HP once). In **positional mode**, apply via
  `applyVictimDamage` + `roundPerTargetDamage` + `creditDealt` (the counter model). Because the post-round
  aggregate only fires when `dpsEnemyTarget`, there is no aggregate in positional mode to double-apply —
  mirrors exactly how per-victim DoT/detonation already split the two modes (`engine.ts:7898-7916`
  "per-victim … land via applyVictimDamage, so folding … would double-drain"). Resolve whether the
  positional path also `creditDamage`s for the focus DPS row or leaves it to `perTargetDealt`.
- **(B, fallback) Unified counter-model path** (drop `creditDamage`, always `applyVictimDamage`).
  Rejected unless (A) proves infeasible: it removes reactive damage from `cumulativeDamage`, regressing the
  DPS-calc reported number and breaking the `enemyChargedCast` cumulative assertion — a fidelity loss for
  the DPS view.

The victim id is already resolved by the caller (`triggers.ts` `counterTargetId ?? ctx.enemy.id`) — the
executor only needs to apply against that concrete victim.

## 6. Affected ships (all via the shared executor)

| Ship | Trigger | Path | Notes |
|------|---------|------|-------|
| FrontLine | on-enemy-charged-cast | multiplier | 80% + shield (shield unchanged); once-per-round |
| Grif | on-enemy-cleansed | multiplier | `noCrit` |
| Judge / Chakara / Incinerator | round-boundary | multiplier | crit-eligible |
| Rhodium | round-boundary | multiplier | `noCrit` |
| Paracelsus | on-destroyed (self) | `hpBasisPct` | dead-owner retaliation (`allowDeadOwner`/`fromOwnDeath`) |
| Vindicator | on-resist | `hpBasisPct` | 30% max HP |

## 7. Testing & discipline

- **TDD:** a RED positional-sim test per mechanic family before the fix — assert the victim's HP declines
  (and appears in `damageTaken`/`damageDealt`) by the mitigated/crit amount; confirm RED, then fix.
- **Both-sides fixtures:** each mechanic verified with the reactive ship on the player side and the enemy
  side (team symmetry).
- **New sim fixtures carry the golden moves.** Existing goldens that move are audited as genuine
  behaviour changes (enemies now take reactive damage → may die sooner). `vitest -u` is forbidden;
  golden regens are inspected.
- **DPS-mode regression guard:** `enemyChargedCast.integration.test.ts` cumulative + shield + once-per-
  round assertions stay green unchanged.
- **`audit:skills` reports 0 findings / 0 stale.** No new allowlist entries; the FrontLine
  `shield-penetration-innate` allowlist entry is unrelated and stays.
- Full suite green (minus none), `tsc` + lint clean.
- **Changelog:** one plain-English `UNRELEASED_CHANGES` entry — reactive damage (FrontLine/Grif/Judge/
  Chakara/Incinerator/Rhodium procs, Paracelsus/Vindicator retaliations) now reduces the target's HP in
  positioned battles and shows up in damage-dealt/taken, instead of being tracked but never applied.

## 8. Acceptance criteria

- In a positioned battle, each of the eight reactive-damage mechanics reduces the resolved victim's HP by
  the defense-mitigated (crit-eligible where allowed) amount, and that amount appears in both the
  attacker's `damageDealt` and the victim's `damageTaken`; F1 reconciliation holds.
- DPS mode is byte-identical in reported `cumulativeDamage`/shield/once-per-round behaviour (regression
  tests unchanged).
- Team-symmetric (both-sides fixtures pass).
- The F1-attribution pin (`f1-attribution-audit.md` §5b / carry-forward #3) is retired (reactive damage
  now written to `perTargetDealt`).
- `audit:skills` 0; suite green; `tsc` + lint clean.

## 9. Non-goals

- **M2 (Meatshield "steal Protection until 3 stacks") — DEFERRED.** Audited 2026-07-13 as **corpus-inert**
  under the current model: Meatshield's Protection is a static 3-stack aura that is never cleared or
  decremented (no `clearAllOnRedirect`; `statusEngine.steal` touches only the timed map, not the
  aura/accum maps), so the clause never fires. Building it (parser for a named-buff/stack-threshold steal
  + a runtime increment/decrement-N primitive + charged-turn wiring, stealing from any unit with
  Protection with the source losing stacks) would be greenfield, exercised only by a synthetic fixture —
  like F5's `chargedTarget` axis. Deferred per user decision; revisit if the Protection-consumption model
  changes so Meatshield can drop below 3.
- **Shield magnitude** (SP-G G3, already shipped) — not touched.
- **Removing the `reactiveDealtByOwner` side-channel** — retained; it carries per-proc-reset semantics the
  round-cumulative `perTargetDealt` lacks, and is the shield's source.
- Monte-Carlo/distribution UI; targeting/board changes; #5 composition-selector merge (parked).
