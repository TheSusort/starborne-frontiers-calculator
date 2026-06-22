# D-PR14 — CF / Provoke applier implants (Bulwark + Doomsayer)

**Date:** 2026-06-22
**Epic:** Combat-realism — sub-project D (implant + gear-set abilities)
**Stacks on:** D-PR13 tip (`feat/combat-d-pr13-disable-turn-skip`, `642594a8`)
**Branch:** `feat/combat-d-pr14-cf-provoke-appliers`

## Summary

Model two implant special-effects that **apply** targeting-control debuffs the engine
already honors. This PR adds only the *applier* side — Concentrate Fire and Provoke are
already force-targeted by `positionalBinding.ts` / `buildForcedTargetingStatus` /
`provokerOf`; nothing about targeting changes.

- **Bulwark** — *"There is a {X}% chance, when an adjacent ally is directly damaged, to
  apply Provoke to that enemy for 1 turn, once per round."* (proc 5/7/9/12/16% by rarity)
- **Doomsayer** — *"At the end of the round, if this unit was the first to activate, there
  is a {X}% chance to apply Concentrate Fire to the enemy with the highest attack for 1
  turn."* (proc 7/9/12/16% by rarity, uncommon→legendary)

Both effects matter only in the battle simulator (they alter targeting), not the
single-ship DPS calculator — so **no DPS-page wiring** (unlike D-PR2's outgoing-damage).

## Goals / non-goals

**Goals**
- Faithfully apply Provoke (Bulwark, via the existing `counterTargetId` route) and
  Concentrate Fire (Doomsayer, via a new `enemy-highest-attack` global-selector route).
- Reuse existing machinery wherever it exists; add the smallest possible net-new
  primitives (Approach A — narrow, ad-hoc, no generalized condition primitives).
- Byte-identical combat goldens (no existing fixture equips either implant).

**Non-goals**
- No new targeting behavior; no changes to how Provoke/CF are *consumed*.
- No generalized `first-to-activate` ConditionSubject or declarative `oncePerRound`
  condition system (that is Approach B, explicitly rejected).
- No fix to the locked buff-duration decrement-timing behavior (see Known interactions).

## Architecture

### Reuse (already exists)
- `on-ally-attacked` reactive trigger + `eventCtx.counterTargetId` routing — Guardian's
  ally-Provoke counter-infliction is the direct precedent (`triggers.ts` ~387–417, debuff
  executor ~1161–1204).
- `end-of-round` reactive trigger (live; `events.ts`, Rhodium/C2b-2 precedent).
- `adjacentAllyIds(ownerId, actors)` (`adjacency.ts:21`) — degrades to all-living-allies in
  non-positional combat.
- `rollRateGate(gates, key, chance)` (`src/utils/calculators/rateAccumulator.ts:31`) +
  `makeRateGate` (`:17`) deterministic proc accumulators.
- Once-per-round pattern from D-PR3 `incoming-block`: `cfg.oncePerRound` flag + a consumed
  `Set` keyed `${ownerId}:${abilityId}`, with the **invariant**: check-consumed BEFORE
  drawing the gate, and mark consumed ONLY on a successful proc (engine.ts ~2607–2625).
- `mostBuffsAmong(roster)` selector pattern (engine.ts ~3423) — template for the new
  highest-attack selector.
- `effectiveStatsOf` for live effective attack.
- Provoke debuff application via `eventCtx.counterTargetId`: the debuff executor
  (`triggers.ts` ~1161–1204) routes to `counterTargetId` (the attacker), exactly like
  Martyrdom's on-destroyed Disable. **Bulwark reuses this path verbatim** — its
  `on-ally-attacked` listener sets `counterTargetId = attackerId`.
- `statusEngine.applyTimedAbilityStatus` to the target's per-target enemy-debuff store;
  family-overwrite keying on `buffName`.
- Registry: `IMPLANT_ABILITIES` in `buildEquipmentAbilities.ts` + per-rarity proc tables +
  `mkNamedDebuff` helper (Martyrdom's on-destroyed Disable applier is the precedent).
  **Proc values come from the hardcoded `*_PROC` tables, not the description text**
  (Doomsayer's legendary text has a "change"/"chance" typo — harmless since we never parse
  the percentage).

### NOT reusable as-is (the blocker the executor doesn't cover)
The debuff executor routes ONLY via `counterTargetId`, falling back to the singular default
`ctx.enemy.id`. It has **no global-selector branch** — the only global-selector executor is
the *purge* path (`target === 'enemy-most-buffs'`, `triggers.ts` ~1410), which a debuff
cannot use. So Doomsayer's "CF to the highest-attack enemy" is **net-new routing**, not
reuse (see Net-new #2 below). `mkNamedDebuff` also hardcodes `target:'enemy'`
(`buildEquipmentAbilities.ts` ~370) and cannot be reused as-is for Doomsayer.

### Net-new (this PR)
1. **`firstActivatorId`** — a round-state field on the engine, reset at round start, set
   once to the id of the **first actor to take a real (non-skipped) turn**. Skipped turns
   (Stasis / Disable / focus-skip) do NOT count as activating. **Set-site: immediately
   before the `runPlayerTurn` call, AFTER all skip branches resolve** (dead-target skip
   `~3552`, dead-actor `continue` `~3585`, AND the deeper Stasis/Disable/focus-skip
   branches inside the turn body) — `firstActivatorId ??= actor.id`. Placing it merely after
   the dead-actor skip would wrongly count a Stasis-skipped actor (contradicting the
   first-activator edge case below).
2. **Doomsayer CF routing — `target: 'enemy-highest-attack'` (the real net-new seam).**
   - New `AbilityTarget` value `'enemy-highest-attack'` (`types/abilities.ts` ~29–38).
   - New `IntentExecContext` field `enemyWithHighestAttack?: (ownerId: string) => string |
     undefined`, mirroring the existing `enemyWithMostBuffs` (`triggers.ts` ~634).
   - New branch in the **debuff** executor (`triggers.ts` ~1161): when
     `intent.ability.target === 'enemy-highest-attack'`, resolve the recipient via
     `ctx.enemyWithHighestAttack?.(intent.ownerId)` and pass it as the `counterTargetId`
     argument to `applyTimedAbilityStatus`; no living candidate → no-op (skip apply).
   - Bind at **both** drain seams (`engine.ts` ~3445 `drainIntents`, ~3467
     `drainEnemyIntents`): `highestEffectiveAttackAmong(enemyAttackerActors)` for player
     owners, `highestEffectiveAttackAmong(allPlayerActors)` for enemy owners — identical
     per-side pattern to `enemyWithMostBuffs`.
   - A `mkNamedDebuff` variant (or an `opts.target` param) emitting the new target, since
     the base helper hardcodes `target:'enemy'`.
3. **`highestEffectiveAttackAmong(roster)`** — selector mirroring `mostBuffsAmong`
   (`engine.ts` ~3423), returning the id of the living actor with the greatest live
   effective attack (`effectiveStatsOf`); ties → first in roster order; `undefined` if no
   living candidate. Bound per-side over the opposing roster (see #2).
4. **Bulwark once-per-round gate — executor-side, no config flag.** The
   `incoming-block` config's `oncePerRound` flag is NOT reusable (it lives only on that
   config variant, and `engine.ts` ~2614 keys the consume on `cfg.type ===
   'incoming-block'`). Instead: a fresh consumed-`Set` keyed `${ownerId}:${abilityId}` in
   the Bulwark drain path, decided by the ability id alone — **no `AbilityConfig` change,
   therefore no editor-exhaustiveness stubs**. Invariant preserved (check-consumed BEFORE
   the proc draw, mark consumed ONLY on a successful proc).
5. **Two `IMPLANT_ABILITIES` registry entries** + `BULWARK_PROC` / `DOOMSAYER_PROC` tables.

## Data flow

### Bulwark (reactive, per damaging hit on an adjacent ally)
Listeners are PURE (`triggers.ts` ~154 — they `enqueue` only, never mutate state; the proc
gate is drawn in the executor at drain time via `passesProcChanceGate`). So the gate
check/roll/mark all happen executor-side, NOT in the listener.
1. Enemy directly damages an ally → `on-ally-attacked` event (`attackerId`,
   `damagedAllyId`).
2. Bulwark's listener (owner) does a **pure** adjacency filter — `damagedAllyId ∈
   adjacentAllyIds(ownerId, actors)` (state read, no mutation) — and, if adjacent, enqueues
   a `debuff` Intent with `eventCtx.counterTargetId = attackerId`. Non-adjacent → no
   enqueue.
3. At drain, the executor for this intent:
   a. **once-per-round consumed?** for `(ownerId, abilityId)` → if yes, early-out BEFORE
      drawing the gate (keeps the proc accumulator sequence undisturbed — same ordering
      discipline as D-PR3's block path).
   b. **proc roll:** per-rarity chance via the proc gate.
   c. on success → mark the consumed-`Set`, then apply.
4. Apply **Provoke** (1 turn, `application:'apply'`, `casterId = ownerId`) to the
   attacker's per-target enemy-debuff store via the existing `counterTargetId` route.

### Doomsayer (end-of-round, global selector)
1. During the round the engine sets `firstActivatorId` once (first real turn).
2. At `end-of-round`, Doomsayer's listener (owner) checks:
   a. **gate:** `ownerId === firstActivatorId` → else stop.
   b. **proc roll:** per-rarity chance via the executor's `passesProcChanceGate` (the
      `end-of-round` listener only enqueues; gating is handled at drain, same as Bulwark).
3. On success → `highestEffectiveAttackAmong(opposingRoster)`; no living enemy → no-op.
4. Apply **Concentrate Fire** (1 turn, `casterId = ownerId`) to that enemy's per-target
   store.

### Determinism / goldens
Both effects touch the proc accumulators only when an effect-bearing piece is equipped. No
existing combat fixture equips Bulwark or Doomsayer → **byte-identical goldens / .snap**.

## Edge cases & faithfulness decisions

- **"First to activate" = first real turn.** A turn skipped by Stasis/Disable/focus-skip
  does not set `firstActivatorId`. If Doomsayer's owner is skipped all round, it never
  becomes first activator → no proc (correct).
- **Highest attack = live effective attack** at end-of-round (buffs/debuffs/shred folded),
  consistent with engine-wide effective-stat reads. Ties → roster order (deterministic).
  Self is never a candidate (selector runs over the opposing roster).
- **Bulwark adjacency in non-positional combat:** `adjacentAllyIds` returns all living
  allies, so Bulwark fires for any damaged ally — faithful to how adjacency degrades
  elsewhere. No special-casing.
- **Once-per-round scope:** the proc roll happens BEFORE marking consumed, so a *failed*
  roll does not lock the round — Bulwark keeps rolling on later adjacent-ally hits until it
  lands, then is locked for the round ("{X}% chance … once per round"). Matches the D-PR3
  invariant exactly.
- **Multiple adjacent allies hit in one round:** first successful proc locks the gate;
  later hits early-out.
- **Provoke onto an attacker that died in the same hit / CF when only dead enemies remain:**
  selectors skip dead actors; a harmless Provoke on a dead provoker has no effect. Mirrors
  existing reader null-tolerance — no crashes.

## Known interactions (flagged, not fixed)

Per the locked buff-duration decrement-timing behavior (see D-PR13's Disable note), a
"1 turn" debuff applied reactively / at end-of-round may expire after a single observable
enemy turn. This is consistent with how Provoke / Concentrate Fire / Stasis already behave;
we model faithful *application* and let existing duration semantics govern lifetime. No
timing change in this PR.

## Testing

- **Unit — selector:** `highestEffectiveAttackAmong` picks the live-highest-attack living
  enemy; tie → roster order; empty/all-dead → `undefined`.
- **Unit — registry:** `buildEquipmentAbilities` produces one ability each for Bulwark and
  Doomsayer at every rarity with the correct trigger / target / procChance / config; absent
  description → no ability (graceful skip).
- **Integration — Bulwark:** in a positional two-team sim, a hit on an adjacent ally applies
  Provoke to the attacker (read via `provokerOf`); proc forced on; once-per-round verified
  (second adjacent-ally hit same round does not re-apply / re-roll); non-adjacent ally hit
  does not trigger.
- **Integration — Doomsayer:** end-of-round, owner is first activator + proc forced on →
  Concentrate Fire lands on the highest-effective-attack enemy; owner NOT first activator →
  no application; owner skipped all round → not first activator.
- **Coverage tracker:** add `BULWARK`, `DOOMSAYER` to the implemented-implants assertion in
  `equipmentCoverage.test.ts` + per-rarity `>= 1 ability` assertions. NOTE: that assertion
  is an **ordered** `toEqual` array tracking `Object.keys(IMPLANTS)` declaration order —
  insert the two names at their declaration-order positions, do not append. They leave the
  unimplemented assertions for everything else intact.
- **Goldens:** full suite green with ZERO golden/.snap movement.

## Files touched

- `src/constants/implants.ts` — (read-only; data already present, lines ~1428–1609).
- `src/utils/combat/engine.ts` — `firstActivatorId` round-state field + set-site (before
  `runPlayerTurn`, after all skip branches); `highestEffectiveAttackAmong` selector; bind
  `enemyWithHighestAttack` into `IntentExecContext` at both drain seams; Bulwark
  once-per-round consumed-`Set` in the drain path.
- `src/utils/combat/triggers.ts` — Bulwark pure adjacency filter + `counterTargetId` enqueue
  on `on-ally-attacked`; executor-side once-per-round gate + proc roll; new
  `enemy-highest-attack` branch in the debuff executor; `enemyWithHighestAttack` field on
  `IntentExecContext`.
- `src/types/abilities.ts` — new `AbilityTarget` value `'enemy-highest-attack'`. No new
  trigger. No new `AbilityConfig` field (Bulwark's gate is engine-side, keyed by ability
  id).
- `src/utils/abilities/buildEquipmentAbilities.ts` — 2 registry entries + 2 proc tables; a
  `mkNamedDebuff` variant (or `opts.target`) for Doomsayer's `enemy-highest-attack` target.
- `src/utils/abilities/__tests__/equipmentCoverage.test.ts` — add the two implants at their
  declaration-order positions.
- **Editor-exhaustiveness stubs** (AbilityCard / AbilityTypePicker / abilityDefaults) — only
  for the new `AbilityTarget` value if those switches are target-exhaustive; confirm during
  planning (the new value is a *target*, not a config type, so a default-case may already
  cover it).

## Out of scope / next D buckets

Remaining special-effect implants after this PR: Block/Protection reactive buffs
(Firewall/Last Stand/Lockdown/Tenacity — need a Block-Debuff/Block-Damage/Buff-Protection
control primitive); shield-grant family (dormant on sub-project H); cleanse-reactive
(Reactive Ward) + Warpstrike duration half; charge generation (Chrono Reaver); detonation
(Voidfire Catalyst); plus the trivial Code Guard leftover (crit-by-stealthed
incoming-reduction — D-PR3's condition already exists, just unregistered). Special-effect
gear sets still open: Boost / Burner / Decimation / Reflect / Shield / Cloaking.
