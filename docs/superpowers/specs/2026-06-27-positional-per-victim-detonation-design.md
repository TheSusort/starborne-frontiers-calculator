# Positional Per-Victim Detonation Attribution — Design

**Date:** 2026-06-27
**Status:** Approved (design); spec under review
**Epic:** Combat realism — positional battle sim (follows E2 per-victim leech, bomb-splash-on-death #161)

## Problem

In the positioned battle sim, the **firing hit** already lands **per-victim**: it routes through
`applyVictimDamage`, which decrements each footprint victim's own `currentHp`, records
`roundPerTargetDamage`, and fires that victim's death / per-victim reactives. Per-victim leech
(E2) and bomb-splash-on-death (#161) ride this same per-victim sink.

**Bomb/DoT detonation never made that jump.** It was explicitly left out of scope when the
per-victim direct path shipped — see `engine.ts:4462-4474`:

> "KEEP detonation (bombs are a separate mechanic, out of scope)."

So today, in positional mode, detonation flows **only** through the legacy aggregate path:

```
detonate()  (reads the ANCHOR enemy's containers only)
  → creditDamage(actor.id, 'detonation', turn.detonationDamage)        // engine.ts:4474
  → cumulativeDamage                                                    // engine.ts:5301
  → enemy.currentHp = enemyHp − (cumulativeDamage + cumulativeTeamDamage)   // engine.ts:5326
```

That reconciliation is **focus-enemy-only** and **anchor-container-only**. The consequences:

1. Only the **anchor's** stored bombs/DoTs detonate; bombs/DoTs accumulated on **covered /
   non-focus** victims (from other attackers or prior rounds) are silently ignored.
2. Detonation **cannot kill** a positioned victim, fire its per-victim death, on-death
   reactives, or the bomb-splash-on-death chain.
3. It routes through the focus-enemy `cumulativeDamage` overwrite (line 5326), which is itself
   suspect once direct damage is per-victim — a **must-verify seam** (see §4).

The same shape afflicts **timed** `processBombs` and `processAccumulators`: they run only on the
**focus enemy's** turn (`actor.id === enemy.id` gate at `engine.ts:4695`) against the focus
enemy's containers, crediting aggregate, never per positioned enemy.

This is distinct from bomb-splash-on-death (#161), which fires when a bomb **carrier dies before
detonation**. This design is about the **detonation event itself** landing per-victim.

## Goal

Make skill-triggered and timed bomb/DoT detonation land **per-victim** on the positional path —
each footprint victim (player→enemy) or footprint player (enemy→player) detonates its **own**
stored containers against its **own** `currentHp`, so detonation can kill positioned victims and
fire per-victim death/reactives — mirroring the per-victim firing-hit + per-victim leech model
already shipped, and honoring the engine team-symmetry rule (a ship behaves identically on
either side).

## Locked decisions (user-ratified 2026-06-27)

- **No role-scale.** Origin and covered footprint victims both detonate the **full** stored
  stacks. Bombs/DoTs are not affinity- or AoE-role-scaled in-game; only direct hits are.
- **Scope = skill-triggered detonate() + timed processBombs + processAccumulators.** DoT *ticks*
  (`tickDoTs`) are continuous damage, not detonation, and are flagged as a sibling follow-up
  (see §5), not included here.
- **Both directions (symmetric).** Player→enemy AND enemy→player per-victim detonation, in the
  same epic (stacked PRs), per [[feedback_engine_team_symmetry]].
- **Approach A** (per-victim detonation on the `applyVictimDamage` sink), decomposed into stacked
  PRs.

## Approach (chosen: A)

Extract detonation from the aggregate-credit path and route each victim's payout through the
existing per-victim sink `applyVictimDamage` — the single function that already handles
HP/shield/Barrier/Cheat-Death/death/per-victim reactives and feeds `roundPerTargetDamage`. This
is the exact sink bomb-splash-on-death (#161) and the per-victim direct hit already use, so the
HP/shield/death plumbing and team-symmetry come for free.

Rejected alternatives:

- **B — thread footprint victims + apply callback into `runPlayerTurn`.** Inflates an
  already-huge function's signature, does not naturally cover the engine-loop timed/accumulator
  bursts (which live outside `runPlayerTurn`), and raises byte-identical risk. Rejected.
- **C — unify all stored-damage resolution (skill + timed + ticks + accumulators, both sides)
  into one per-victim module in a single change.** Cleanest end state but largest blast radius /
  highest golden-move risk in one PR. The stacked-PR decomposition of A reaches the same place
  incrementally with per-PR byte-identical guarantees. Rejected as a single step.

## Design

### 1. Per-victim detonation mechanics

When a positional skill with a detonate ability fires, **each footprint victim** (the same
victim list `applyPositionalDamage` already resolves) detonates its **own** stored containers —
`pendingBombs`, `corrosionEntries`, `infernoEntries` — against its **own** `currentHp`. Victims
with empty containers contribute 0 (no event).

The three detonation types keep their existing formulas (`playerTurn.ts:526-591`,
`detonate()`), now evaluated against per-victim containers, and map onto the existing
`applyVictimDamage` flags (locked rules from shield-system H + bomb-splash precedent):

| Type | Damage formula (unchanged) | Shield interaction | Affinity |
|---|---|---|---|
| **Bomb** | `Σ stacks × dmgPerStack × affinityMult × (1 + detMod/100) × pct` | full-drain, **no penetration** (bomb-portion = full) | stored per-bomb `affinityMult` |
| **Inferno** | `Σ stacks × (tier/100) × attackerAtk × rounds × dotMult × affMult × pct × detMult` | **bypass** shield | detonating attacker's |
| **Corrosion** | `Σ stacks × (tier/100) × min(victimHp,500k) × rounds × dotMult × affMult × pct × detMult` | **bypass** shield | detonating attacker's |

Two behaviors fall out of "per-victim":

- **(a)** Corrosion's `baseHp` becomes `min(victimHp, 500_000)` — *that victim's* HP, not the
  anchor's (`detonate()` currently reads `args.enemyHp` = anchor).
- **(b)** The attacker-scalar terms (`effectiveAttack`, `dotMult`, `affinityMult` for
  inferno/corrosion; `detonationMult`) stay the **detonating attacker's** — matmul against
  per-victim containers, exactly as `detonate()` does today. Bomb entries keep their snapshotted
  per-entry `affinityMult` / `detonationDamageModifier` (the applier's), unchanged.

Detonation can now **kill** a positioned victim, firing its per-victim death →
`recordDestroyed` → on-death reactives + bomb-splash-on-death chain (all already wired through
`applyVictimDamage`).

### 2. Event shapes (per-victim)

- `dot-detonated` (`engine.ts:5291`) and `bomb-detonated` currently carry the **anchor**
  `targetId` / aggregate `damage`. Per-victim, they emit **once per victim** with that victim's
  `targetId` and that victim's payout — same pattern per-victim `dot-applied` / hit events
  already use on the positional path.
- Per-victim detonation damage records into `roundPerTargetDamage` (so the `perTargetDamage`
  RoundData row reflects it) and credits the **applier**: bombs keep per-entry applier
  attribution; inferno/corrosion credit the detonating attacker. These attribution rules are
  unchanged — now keyed per victim.

### 3. Timed bombs + accumulators

`processBombs` / `processAccumulators` (`engine.ts:4725` / `:4746`) run today only on the focus
enemy's turn (`actor.id === enemy.id`, `engine.ts:4695`) against the focus enemy's containers.
Per-victim means each **positioned enemy** bursts its own timed bombs / accumulators against its
own HP on its own turn. The round loop already iterates all `actor.kind === 'enemy'` actors; the
`actor.id === enemy.id` gate is what restricts the bursts to the focus enemy. Enemy→player
symmetry routes player-carried timed bombs through `playerSink` on the player victims' turns.

### 4. The line-5326 seam (crux risk)

Once detonation lands per-victim through `applyVictimDamage` (which decrements each victim's own
`currentHp` directly, like direct damage), it **must stop** feeding the focus-enemy
`cumulativeDamage` overwrite at `engine.ts:5326` — otherwise the focus enemy is hit twice (once
per-victim, once via the 5326 reconciliation). The change mirrors the existing direct-damage
credit suppression at `engine.ts:4469`:

```
if (!positional) {
    d.secondary += turn.secondaryDamage;
    d.conditional += turn.conditionalDamage;
    creditDamage(actor.id, 'direct', turn.directDamage);
    creditDamage(actor.id, 'detonation', turn.detonationDamage);   // ← detonation joins suppression
}
```

(non-positional keeps crediting detonation through the aggregate path → byte-identical).

**Display vs HP application are separate concerns.** The `detonationDamage` RoundData row /
`totalDetonationRaw` summary must still reflect detonation for the focus actor even when HP
application is per-victim — `direct` already solves this by sourcing the displayed row from the
per-victim path. **Planning Task 0 will verify** the exact arithmetic: whether `focus.detonation`
must source from `roundPerTargetDamage` (per-victim) for display, and confirm no double-count
against line 5326. This is the single highest-risk seam.

### 5. Out of scope (flagged follow-ups)

- **DoT ticks** (`tickDoTs`, `engine.ts:4705`): continuous per-round DoT damage shares the same
  focus-enemy-only restriction (`actor.id === enemy.id`) and is likely a sibling per-victim gap,
  but it is **not detonation** and is out of scope here. Flagged for a follow-up audit.
- **Per-victim NEW bomb/DoT application:** application stays anchor-only today
  (`runPlayerTurn` applies to `tgt.pendingBombs`/`corrosionEntries`). Per-victim detonation is
  meaningful regardless (bombs/DoTs accumulate on different victims across attackers/rounds), so
  per-victim *application* is a separate concern, not required by this design.

## PR decomposition

Stacked, each aiming **byte-identical** for non-positional goldens (hand-validate every
positional delta — never `vitest -u`):

- **PR1 — player→enemy skill-triggered detonation per-victim.** Extract `detonate()`'s per-type
  payout into a per-victim helper; invoke it for each footprint victim at the positional site;
  route through `applyVictimDamage`; suppress the aggregate detonation credit in positional
  (§4); per-victim events (§2). Resolves the line-5326 seam.
- **PR2 — timed bombs + accumulators per positioned enemy.** Lift the `actor.id === enemy.id`
  restriction so each positioned enemy bursts its own timed bombs/accumulators against its own
  HP (§3).
- **PR3 — enemy→player symmetric.** Same helper via `playerSink`; enemy detonate skills land
  per-player; the E5-symmetry invariant test.

## Testing

Harness mirrors `perVictimLeech.test.ts` — positioned actors, seeded containers, crit 0 for
exact integers.

- **PR1:** seed bombs/inferno/corrosion on *covered* and *origin* footprint victims; assert
  each detonates full against its own HP; covered victim's bombs no longer ignored; corrosion
  uses per-victim HP (`min(victimHp,500k)`); detonation kills a covered victim → death event +
  bomb-splash chain; credit attributed per applier; `dot-detonated`/`bomb-detonated` emit per
  victim. Byte-identical guard: non-positional detonation fixtures unchanged.
- **PR2:** seed timed bombs on a non-focus positioned enemy; assert they burst against its own
  HP on its own turn (not folded into the focus enemy).
- **PR3:** seed bombs on positioned players; enemy detonate skill lands per-player via
  `playerSink`; E5-symmetry invariant — a ship behaves identically on either side.

## Golden discipline (from project memory)

- Hand-validate **every** positional golden delta; **never** `vitest -u` goldens.
- Run the **whole** `npm test` suite for the golden audit — detonation fixtures live outside
  `src/utils/combat` too (enemy-cleanser lesson: `healingGoldenParity` scenarios).
- Worktrees need `.env` + `docs/*.csv` copied (else `.tsx` test collection + audit tests fail)
  and `node_modules` symlinked.

## Key file references

- `src/utils/combat/playerTurn.ts:526-591` — `detonate()`, the 3-branch per-type payout (the
  logic to extract into a per-victim helper).
- `src/utils/combat/playerTurn.ts:1500` — `detonate()` call site (anchor `enemy`).
- `src/utils/combat/engine.ts:4462-4474` — positional credit suppression block (where detonation
  credit joins suppression).
- `src/utils/combat/engine.ts:3216-3231` — `applyOutgoingToEnemy` / `applyVictimDamage` wrapper
  (the per-victim sink to route detonation through).
- `src/utils/combat/engine.ts:3306,3446` — `roundPerTargetDamage` writes (per-victim damage
  recording).
- `src/utils/combat/engine.ts:4695-4751` — focus-enemy-turn `processBombs`/`processAccumulators`
  (PR2).
- `src/utils/combat/engine.ts:5289-5326` — focus `detonationDamage` row + `cumulativeDamage` →
  `enemy.currentHp` reconciliation (the crux seam).
- `src/utils/combat/applyPositionalDamage` (`positionalApply.ts`) + `drivePositionalApply` /
  `onVictimResolved` — the per-victim apply loop and hook (E2 precedent for per-victim work).
- `src/utils/combat/__tests__/perVictimLeech.test.ts` — test-harness template.
