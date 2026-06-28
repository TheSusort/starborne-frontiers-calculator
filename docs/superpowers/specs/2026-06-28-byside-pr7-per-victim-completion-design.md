# bySide PR7 — Phase-5 per-victim completion (design)

**Date:** 2026-06-28
**Status:** Design — pending spec review
**Campaign:** `project-combat-engine-byside-unification` (the deferred capstone PR7) /
`project-combat-realism-epic`

## Background

The bySide unification campaign (PR1–PR6b) collapsed the combat engine's dual
player-centric / enemy-mirror paths into one team-agnostic `bySide` engine. PR7
was deferred as *"Phase-5 per-victim accounting (leech / incoming attribution /
defense+modifier sourcing); additive; may split."*

Most of PR7's original scope already shipped under other names:

- **Per-victim leech** → sub-project E2 (engine.ts:2416, 2492).
- **Per-victim incoming attribution** → PR5a (`perActorIncoming` buckets) + sub-project E.
- **Per-victim defense + modifier sourcing** → B1/PR7b (engine.ts:3349, 3439, 3443).
- **Per-victim detonation / timed bursts / DoT ticks** → the #168–#173 chain
  (all merged to main 2026-06-28).

Three concrete gaps remain, each flagged as a "Phase-5 follow-up" in the engine.
This spec covers all three in a **single PR**.

## Goals

1. **Per-victim event fidelity** — covered AoE footprint victims emit their own
   `attacked` events (and break Stasis on hit), so their reactives fire. Today
   only the primary target does.
2. **Per-victim result surface** — surface each victim's incoming/shield/barrier
   intake on `RoundData` and in the battle-simulator UI. Today only the
   heal-target row is exposed.
3. **Damage-modifier scope closeout** — document that incoming/outgoing damage
   modifiers are direct-damage-only (DoTs and bombs excluded), and lock the bomb
   exclusion with a test.

## Non-goals

- Applying incoming/outgoing damage modifiers to DoTs or bombs. Per the game
  rules (confirmed by the maintainer): these modifiers affect **direct damage
  only**. DoTs and bombs are excluded by design.
- Splitting `ability-performed` per victim. It stays the attacker-scoped,
  once-per-turn aggregate so the Warpstrike (`on-deal-damage`) and Bloodthirst
  (`triggerDamage` basis) reactive contracts are preserved.

## Component 1 — Per-victim `attacked` emission + Stasis-break

### Current behaviour

All three positional cast-sites — focus player→enemy (engine.ts ~4735),
walked-team (~4973), enemy→player (~5631) — run the shared `drivePositionalApply`
helper, which lands damage per footprint victim via `applyPositionalDamage`. Each
site then emits a single `attacked` **only for the primary victim**, gated on
`focusEnemyHit` / `victim.id === tgt.id`. Covered footprint victims take real HP /
shield / death damage but emit **no** `attacked` event, so their on-attacked
reactives never fire: counters (Stalwart / Nyxen / Centurion / Guardian),
Tenacity, Reactive Ward, Second Wind, Bloodthirst-basis, etc.

`emitAttacked` (src/utils/combat/emitAttacked.ts) is already direction-agnostic
and emits one event per hit from a `hitOutcomes: boolean[]` crit list, with
conditional spreads for `isPrimaryTarget` / `shieldWasHit` / `didCrit` / `damage`.

### Change

1. **Collect every hit victim.** Generalize the per-site
   `focusEnemyHit` / `focusEnemyDamage` / `focusEnemyShieldWasHit` locals into a
   `Map<victimId, { damage: number; shieldWasHit: boolean }>` populated inside the
   existing `onVictimResolved` hook (already invoked per victim with
   `(victim, damage, outcome, didCrit)`). `shieldWasHit` is derived exactly as the
   current focus computation: `!outcome.barriered && outcome.shieldBefore > 0 &&
   outcome.hpDamage < damage`, OR-accumulated across the attack's hits.
2. **Emit per victim.** Replace the focus-only emit with a loop over that map.
   For each victim call `emitAttacked` with:
   - `hitOutcomes`: the attacker's per-hit crit schedule
     (`turn.hitCrits.length > 0 ? turn.hitCrits : [turn.roundCrit]`) — unchanged;
     crit is an attacker-per-hit property applied to all footprint victims.
   - `targetId`: the victim's id; `attackerId`: the acting actor's id.
   - `damage` / `shieldWasHit`: that victim's own collected values.
   - `isPrimaryTarget: true` **only** when `victim.id === tgt.id`.
3. **Both directions.** Apply the same change at all three cast-sites. The
   player→enemy and enemy→player emits use the same helper and the same
   per-victim collection; the only per-site difference is the existing roster /
   sink binding.
4. **`ability-performed` is untouched** — still one aggregate emit per turn.

### Per-victim Stasis-break (blocking spike)

Today the on-hit Stasis-break fires inside `runPlayerTurn` for the resolved
`targetId` only (engine.ts:3454-3458 documents the AoE-footprint deferral). The
break is **deferred** — it marks the victim rather than removing Stasis
immediately (engine.ts:3334) — and a same-turn re-apply check skips the break if
the same turn's `inflictedEnemyDebuffs` re-applied Stasis to that victim.

Because `runPlayerTurn` does not know the AoE footprint (positional apply happens
engine-side after it returns), the per-footprint break must fire **engine-side**
after `drivePositionalApply`, once per hit victim, reusing the **same deferred-mark
+ same-turn re-apply-check path** the selected-target break uses. This is the
highest-risk sub-task; the implementation plan MUST open with a spike that:

- locates the existing selected-target break mechanism and its re-apply guard,
- confirms it can be invoked per-victim engine-side without double-breaking the
  selected target,
- verifies ordering vs the ability timed-debuff loop (the break must not remove a
  Stasis the same attack just re-applied).

If the spike finds the break cannot be cleanly invoked per-victim, fall back to
landing per-victim `attacked` first and treating Stasis-break-per-footprint as a
follow-up (surfaced to the maintainer), rather than forcing a fragile change.

## Component 2 — `perActorIncoming` result surface + UI

### Current behaviour

The engine maintains `perActorIncoming: Map<string, { incoming, shieldAbsorbed,
barrierAbsorbed }>` (PR5a). Since PR5b, each positional victim's AoE share lands
in its **own** per-actor bucket — the heal-target row is no longer inflated — but
the result still exposes only the single heal-target row (engine.ts:5407, 5455).

`RoundData` (dpsSimulator.ts:97) already has the established per-actor surfacing
pattern: `perActorShield`, `perActorReflected`, `perActorSplash`,
`perActorDetonation` — each a `Record<string, …>` set only when non-empty, so
runs without the feature keep the legacy shape and goldens stay byte-identical.

### Change

1. **Surface on `RoundData`.** Add
   `perActorIncoming?: Record<string, { incoming: number; shieldAbsorbed: number;
   barrierAbsorbed: number }>`. At the row-push, build it from the engine's
   `perActorIncoming` map, including only actors with a nonzero entry; set the
   field only when the resulting record is non-empty. Mirror `perActorShield`'s
   assembly verbatim.
2. **Wire the UI.** Display covered victims' damage-taken (incoming / shield /
   barrier) in the battle-simulator surfacing, wherever `perActorShield` is
   currently rendered. Reuse the existing per-actor row UI primitives; do not
   hand-roll new card/table markup.

This component is purely additive — byte-identical for all non-positional /
single-victim runs (the field stays absent).

## Component 3 — Damage-modifier scope closeout

### Current behaviour

The per-victim incoming-damage modifier (`Inc. Damage Down/Up` self-buff +
`Out. Damage Up` enemy-debuff) is applied to the **direct** channel only, via
`defenseProfileOf.incomingDamageModifierPct` in `drivePositionalApply`. DoT ticks
(`tickDoTs`) honor only `incomingDotReductionPct` (the dedicated Vortex Veil
DoT-reduction). The comment at engine.ts:3368 reads *"Direct channel only;
incoming-DoT deferred"*, implying DoT support was intended.

### Change

1. **Reword the comment** to state the modifiers are **direct-damage-only — DoTs
   and bombs both excluded** — by design, not deferred.
2. **Verify + lock the bomb exclusion.** Bombs apply via detonation / timed-burst
   with an explicit `bombPortion` and never flow through `defenseProfileOf`, so
   the expectation is they already bypass `incomingDamageModifierPct`. Add a test
   that proves a victim carrying an `Inc. Damage Down/Up` buff takes **unmodified**
   bomb damage, on both the positional and non-positional paths. If the test
   surfaces a leak, add an explicit exclusion guard (this would be a real fix
   rather than doc-only).

## Testing & golden discipline

### New tests

- **Per-victim attacked (integration):** an AoE cast hitting a covered victim that
  carries an on-attacked reactive (e.g. a counter) → the covered victim's reactive
  fires. Non-vacuous: assert the reactive's observable effect, and that flipping
  the emission off drops it.
- **E5-symmetry pin:** the same AoE attacker fires byte-identical per-victim
  `attacked` events (count, targets, crit/shield/damage signals) whether on the
  player or enemy side. The canonical team-symmetry test.
- **Per-footprint Stasis-break:** an AoE cast that hits two stasised footprint
  victims breaks Stasis on **both**, respecting the same-turn re-apply guard.
- **`perActorIncoming` surface:** a positional round with covered victims exposes
  each victim's incoming/shield/barrier; a non-positional round leaves the field
  absent.
- **Bomb-modifier exclusion:** a victim with `Inc. Damage Down/Up` takes
  unmodified bomb damage (positional + non-positional).

### Golden audit

- Component 1 can move goldens **only** if an existing fixture has an AoE cast
  hitting a covered victim that carries an on-attacked reactive. Hand-validate
  every delta; **never** `vitest -u`. Expected: byte-identical for the vast
  majority (no fixture is known to equip a covered-victim on-attacked reactive).
- Components 2 and 3 are byte-identical (additive field / doc + new test).
- Run the **whole** `npm test` suite — per-victim fixtures live outside
  `src/utils/combat` too (e.g. `healingGoldenParity`). Confirm `tsc`, `lint`
  (`--max-warnings 0`), and `audit:skills` (141/0) clean.

## Risk summary

| Component | Risk | Behavioural | Golden churn |
|-----------|------|-------------|--------------|
| 1 attacked emission | medium | yes (covered-victim reactives) | only if a fixture hits a reactive-bearing covered victim |
| 1 Stasis-break | medium (spike-gated) | yes | as above |
| 2 result surface + UI | low | no (additive) | none |
| 3 modifier closeout | low/none | no (doc + lock) | none (unless a bomb leak is found) |

## Open implementation questions (resolve in the plan)

1. Does `onVictimResolved` fire once per victim or once per (victim, hit)? The
   collection map and `shieldWasHit` OR-accumulation must match. (Confirm against
   `applyPositionalDamage`.)
2. The exact selected-target Stasis-break call path and its re-apply guard, so the
   per-footprint break reuses it without double-breaking the primary target.
3. Where `perActorShield` is rendered in the battle-simulator UI, to colocate the
   `perActorIncoming` display.
