# Aura Classification — Finite-Duration Passive Buffs — Design

**Date:** 2026-06-09
**Status:** Approved (user-validated section by section)
**Baseline:** PR #93 (Phase 4b — death & revive) MERGED (merge `95ea370d`).
**Branch target:** `fix/aura-classification-finite-passive-buffs`
**Closes:** the deferred follow-up noted in commit `11f3fce7` — "passive-finite-duration aura
mis-classification (Everliving Regen survives Cheat Death)".

## Goal

Correct the combat engine's aura classification so that **"aura" means flat-stat passives
only**. Concretely, a passive-slot buff with a **finite (numeric) duration** must no longer be
treated as a permanent, re-derived aura. The canonical bug: Yazid/Tycho's *Everliving
Regeneration "for N turns"* runs forever and survives a Cheat Death revive, because the
classifier forces every passive-slot buff to `kind:'aura'` regardless of its duration.

This is an engine + (minimal) constants change. It is zero-RNG deterministic and additive — the
only intended behavioral deltas are for the small set of **non-reactive finite passive
self-buffs** (the "at start of combat … for N turns" group).

## The conceptual model the user is encoding (canonical for this increment)

The user's classification, which this increment makes the engine honor:

1. **Flat-stat auras are the ONLY true auras.** Permanent stat modifiers with no named buff
   (e.g. Snapdragon "+20% Crit Rate", Hermes "+20% Defense", "20% Shield Penetration"). They are
   always-on and survive everything.
2. **Permanent named buffs** (named `<unit-skill>` buffs granted/re-granted with **no** turn
   count — e.g. Magnetized Shielding, Affinity Overrides, the per-turn stackers) are *regular
   buffs*, not auras. They are granted/re-granted at trigger points (start of round/turn, on
   kill, on hit, …), and can be purged or spent. Their survival on death is governed by
   **removability**, not by being an aura.
3. **Finite-duration named buffs** (named buffs with "for N turns" — Everliving Regeneration,
   Marauder Rage, Stealth-2t, Atlas Coordination) are *regular buffs with a countdown*, usually
   conditionally gained. They expire on their timer and are wiped on death like any buff.

### Why flat-stat auras need no work

Flat-stat passives parse to `type:'modifier'` (channel-based) configs and are folded as standing
per-round modifiers in `playerTurn` (re-derived from ship data each round). They **never enter
`registerActorAbilityStatuses`**, which only processes `type:'buff' | 'debuff'`. So the
classifier's `kind:'aura'` branch only ever holds **named** buffs — which under the user's model
should not be auras at all.

## Current behavior (the bug)

`registerActorAbilityStatuses` (`src/utils/combat/engine.ts:130-134`):

```ts
const isAura =
    !accumulating &&
    (cfg.duration === 'recurring' ||
        cfg.duration === undefined ||
        slot.slot === 'passive');   // <-- forces ALL passive buffs permanent
```

Auras fold every round via `activeAbilityStatuses` (re-derived, never decrement) and are
**preserved by `clearRemovable`** (statusEngine.ts:145-146 — "Standing always-active/aura source
lists are NOT touched — they re-derive each round"). So a finite passive buff:
- never expires (active every round), and
- survives a Cheat Death wipe (re-derived next round).

Reactive finite buffs are NOT affected by this bug: `partitionReactiveAbilities` pulls any
buff/debuff whose trigger ∈ `LIVE_TRIGGERS` (on-crit, on-kill/`on-enemy-destroyed`, on-attacked,
`start-of-round`, on-debuff-inflicted, …) out of `castSkills` before this loop; they are applied
at their trigger via `executeIntent` with their own duration. The bug only reaches **non-reactive**
passive buffs — those whose trigger is the default `on-cast` (notably "at the start of combat",
which `detectReactiveTrigger` does not match).

## The change

### 1. Classification

Drop the `slot.slot === 'passive'` clause from `isAura`:

```ts
const isAura =
    !accumulating &&
    (cfg.duration === 'recurring' || cfg.duration === undefined);
```

Result:
- **Numeric duration** → classifies as `timed` (was `aura`). ← the fix.
- **`'recurring'` / `undefined` duration** → still `aura` (unchanged): the no-duration named
  buffs (group 2) and stackers. Behaviorally identical to today.

### 2. Application timing — the load-bearing detail

A `timed` self-status is only *applied* when `status.sourceSlot === action`, and `action` is
only ever `'active' | 'charged'` (`playerTurn.ts:104,671`). **The passive slot never fires as an
action.** So a passive-sourced `timed` status, with no further work, would register but never
apply — the buff would vanish entirely. Re-applying it every turn would instead refresh the
window to N each turn → effectively permanent again. Neither is correct: "for N turns" is a
**one-time window from combat start**.

**Mechanism:** passive-sourced `timed` ability self-statuses are **applied once at combat start
(round-1 seeding)** with their numeric duration, onto each of their recipients. They are never
re-applied (passive never fires), so they ride the existing per-round `decrementPlayer` countdown
and **expire naturally after N turns**. This reuses the entire existing timed-status lifecycle —
family/tier upsert rules, decrement, `clearRemovable`, and the `buff-expired` event. The only new
behavior is the round-1 seeding pass for passive-sourced timed self-statuses.

Open implementation detail for the plan (not a design decision): the exact seeding site — at
StatusEngine construction vs. an explicit round-1 step in the engine. Either reuses
`applyTimedAbilityStatus`/the timed maps; the requirement is "applied exactly once at combat
start, then decremented normally."

The seeding must gate each status through `conditionsMet` against the round-1 context, for parity
with the cast path / `executeIntent` (a co-gated grant must respect its gate). The
affected-ship enumeration (below) should surface whether any affected buff carries a co-gate that
only the per-turn `postDebuffGateCtx` can evaluate; the "at start of combat … for N turns" buffs
are typically unconditional, so this is expected to be a no-op in practice.

### 3. Death survival via removability (no new machinery)

`clearRemovable` (statusEngine.ts:840-856) already preserves entries that are
`turnsRemaining === 'permanent'` or whose `buffName ∈ UNREMOVABLE_STATUSES`, and wipes everything
else. We lean on this:

- **Finite timed passive buffs** (Everliving Regen) are removable → wiped on a Cheat Death revive
  and do **not** reappear (they are applied statuses now, not re-derived auras). ✓ the fix.
- **No-duration named buffs left as `aura`** (Magnetized Shielding) re-derive each round → survive
  death naturally, which is correct *because* they are unremovable.
- **Belt-and-suspenders:** extend `UNREMOVABLE_STATUSES` (`src/utils/combat/cheatDeathBuffs.ts`,
  currently just `Acidic Decay`) with description-marked-unremovable named buffs (e.g.
  `Magnetized Shielding`) so that if one ever lands as an *applied* status (e.g. granted
  reactively), it still survives a wipe.

No new status kind, no new death logic, no change to `clearRemovable`'s rule.

## Scope

**Behavior changes only for:** non-reactive finite passive **self**-buffs — the "at start of
combat … for N turns" set. Confirmed examples: **Yazid** (Everliving Regeneration II, 9t),
**Tycho** (Everliving Regeneration I/II, 6t/9t), **Crucialis / IonScorp** (Atlas Coordination
I/II, 6t/12t), **Iridium** (Taunt, 1t). The precise set is **derived, not guessed** — see
verification below.

**No change to:**
- Reactive finite buffs (already partitioned + re-granted at trigger).
- Flat-stat `type:'modifier'` auras (folded as standing modifiers; never in this path).
- No-duration named buffs (`undefined`/`'recurring'`) — still `aura`.
- Persistent stacking buffs (Blast/Overload — separate accumulating/persistent maps).
- **Cheat Death** — special-cased in the parser (forced `'recurring'`, never timer-decremented;
  `skillTextParser.ts:1968`) and consumed by the Phase-4b interceptor. Untouched.
- Enemy-side timed debuffs (applied via `sourceFired`, not this aura branch).

## Testing

- **StatusEngine / engine unit tests:** a non-reactive finite passive self-buff
  (a) is active rounds 1..N, (b) is gone round N+1, (c) emits `buff-expired` at expiry,
  (d) is wiped by `clearRemovable` / a Cheat-Death activation and does **not** reappear next
  round. Plus: an unremovable no-duration named buff survives a `clearRemovable` wipe.
- **Golden parity (`dpsGoldenParity.test.ts`, healing + DPS snapshots):** regenerate, but **every
  delta must be explained** (KNOWN-DIFF review; never blanket `vitest -u`). Deltas are expected
  *only* for the affected ships, and likely concentrated in **healing/survival-mode** rows
  (Everliving Regeneration is a regen — pure-DPS rows for these ships may not move at all). Any
  unexpected delta is a bug, not a snapshot to bless.

## Verification (drives the exact affected-ship list)

Before/with implementation, enumerate the real affected set deterministically: over all ships,
list passive abilities the engine classifies as `kind:'aura'` **with a numeric duration** under
the current rule (i.e. those that flip to `timed`). This is the authoritative scope and the
review checklist for snapshot deltas. The CSV scan in brainstorming is an approximation only
(it over-matches reactive grants and enemy-debuff inflictions).

## Documentation & changelog

- `UNRELEASED_CHANGES` in `src/constants/changelog.ts`: plain-English entry — finite-duration
  passive buffs (e.g. Everliving Regeneration) now correctly expire after their stated turns and
  no longer persist through a destroyed/revived (Cheat Death) unit.
- No `DocumentationPage.tsx` change expected (internal combat-model correctness, no new
  user-facing feature surface).

## Out of scope / deferred

- The "full reclassification" (eliminating the `aura` kind entirely and modeling no-duration
  named buffs as a new non-decrementing applied status). Rejected in favor of this targeted fix:
  it would touch the per-round conditional re-gating machinery and broaden snapshot churn for no
  behavioral gain, given no-duration named buffs in this path are unremovable and thus correct as
  re-derived auras today.
- Simulating enemy purge of player buffs / "spent" buff mechanics beyond the existing Cheat
  Death and persistent-stacking special cases.
