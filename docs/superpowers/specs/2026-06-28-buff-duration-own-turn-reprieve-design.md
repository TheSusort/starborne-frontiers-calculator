# Buff Duration Fix — Own-Turn Self-Buff Reprieve

**Date:** 2026-06-28
**Status:** Approved design, pre-implementation
**Area:** Combat engine (`src/utils/combat/statusEngine.ts`, `src/utils/combat/engine.ts`)

## Problem

A timed self-buff with text duration "N turns" is decremented at the **same turn's Post-Turn**
when the carrier applied it during its own turn. With `N = 1` the buff reaches
`turnsRemaining = 0` and expires before the carrier's next turn — one turn too early versus the
game.

In-game (user test, 2026-06-16, Thresh against a defender):

- R1 (active): gains Attack Up (1t), shoots with it, gains an extra charge.
- R2 (charged): Attack Up from R1 is **still active** + gains Crit Power Up (1t); shoots with
  both; Attack Up expires **after** R2.
- R3: Crit Power Up from R2 still active; gains Attack Up; shoots with both; Crit Power Up
  expires after R3.

So a "1 turn" self-buff is active across the applying turn **and** the carrier's next turn,
expiring after being used in that next turn. The applying turn does not count down.

This contradicts the previously-"locked" rule documented in the combat-engine state
(`decrementPlayer`/`decrementEnemy` decrement ALL timed self statuses including same-turn ones).

## Scope (confirmed)

**Self-buffs only.** Verified in-game only for self-buffs (the Thresh case). This aligns with
how the engine decrements:

- Decrement runs at the **carrier's own Post-Turn** (`engine.ts` ~5662–5676):
  `decrementPlayer(actor.id)` for the self-buff store, `decrementEnemy(actor.id)` for debuffs
  landed on the actor.
- A debuff/DoT is applied during the **attacker's** turn but decremented at the **victim's**
  Post-Turn — so it is never "same-turn" from its carrier's perspective and already gets full
  duration. No change required for debuffs/DoTs.
- The only statuses where `carrier == active actor at apply time` are self-buffs a ship grants
  itself on its own turn.

**Off-turn self-buffs are already correct and must NOT change.** A reactive self-buff applied
during another actor's turn (e.g. "when attacked, gain Shield 1 turn") is written while the
carrier is idle. The carrier's first Post-Turn after that application is its *next* turn, so it
already lasts through the next turn. The fix must therefore distinguish **own-turn** from
**off-turn** applications and only grant the reprieve to own-turn ones.

**Not affected:** enemy debuffs, DoTs (corrosion/inferno/bomb), persistent-stacking buffs
(separate maps, not turn-decremented), accumulating statuses (per-round/per-active/per-charge,
not turn-decremented).

## Rule (locked semantics)

A timed self-buff applied to a carrier **during that carrier's own turn** is not decremented at
the immediately-following Post-Turn. It first decrements at the carrier's **next** Post-Turn.

With `duration = N`: applied turn + next N of the carrier's turns ⇒ active across `N + 1` of the
carrier's turns.

## Approach (chosen: A — `appliedThisTurn` flag + `beginTurn` hook)

Add a per-status reprieve flag set at the self-side timed write seams when the carrier is the
active actor, consumed once at the carrier's next Post-Turn decrement. Self-side only; enemy side
untouched.

### Why not the alternatives

- **B — global turn-ordinal stamp:** same behavior but adds a global counter and threads
  "current turn" through every seam; no benefit over A.
- **C — engine-side freshly-applied key set:** keeps state off `BuffState` but spreads the logic
  across engine + statusEngine and is harder to reason about than a flag next to `turnsRemaining`.

## Changes

### 1. `BuffState` (`statusEngine.ts` ~276)

Add an optional field:

```ts
interface BuffState {
    buffName: string;
    turnsRemaining: number;
    tier: number;
    // ...existing fields...
    /** Set true when this timed self-buff was applied during the carrier's OWN turn.
     *  Granted a one-turn reprieve at that turn's Post-Turn (skipped + flipped false), then
     *  decrements normally from the carrier's next Post-Turn. Off-turn / enemy-side writes
     *  leave it falsy. */
    appliedThisTurn?: boolean;
}
```

### 2. `beginTurn(actorId)` — new statusEngine method

- Internal state: `let currentTurnActorId: string | undefined`.
- `beginTurn(actorId)` sets `currentTurnActorId = actorId`.
- Add to the public `StatusEngine` interface with a doc comment.
- The id passed is the carrier's **store-key id** for that actor (see Engine wiring): `'attacker'`
  for the focus actor, the real actor id for team actors.

### 3. Self-side timed write seams — stamp the flag

For each seam that writes a **timed** `BuffState` to a **self-side** store, set
`appliedThisTurn: writeKeyId === currentTurnActorId`, where `writeKeyId` is the store-key id the
seam routes by:

- `upsertBuff` (scheduled, self side → `'attacker'` store, ~660): `writeKeyId = 'attacker'`.
- `sourceFired` (scheduled timed buffs for a fired source → `'attacker'` store): `writeKeyId = 'attacker'`.
- `applyTimedAbilityStatus` (ability-sourced, self side → `selfEffectiveId`, ~1178):
  `writeKeyId = selfEffectiveId`.

Persistent-stacking and accumulating writes are not timed-turn statuses → not stamped.
Enemy-side writes are not stamped.

Note on refresh: the family-rule refresh path re-`set`s the same key with a fresh `BuffState`, so
the flag is recomputed on refresh. A refresh during the carrier's own turn re-grants the reprieve
(and resets duration) — correct.

#### Scheduled self-buffs always route to the `'attacker'` store (pre-existing legacy routing)

`upsertBuff` and `sourceFired` hardcode the self-side store to `'attacker'`
(`statusEngine.ts:643`), regardless of which actor fired — `sourceFired(actor.id, …)` is called
for the firing actor (`playerTurn.ts:811`) but its self-side scheduled buffs still land in the
`'attacker'` store. That store is only decremented by `decrementPlayer('attacker')`, i.e. at the
**focus actor's** Post-Turn. Consequences for the reprieve stamp (`writeKeyId = 'attacker'`):

- **Focus actor (`actor.id === 'attacker'`)** firing its own scheduled self-buff on its turn:
  `currentTurnActorId === 'attacker'` ⇒ flag true ⇒ reprieve granted at the focus Post-Turn.
  This is the Thresh case and the primary path being fixed. ✓
- **Team (non-focus) actor's scheduled self-buff:** `writeKeyId ('attacker') !=
  currentTurnActorId (<real team id>)` ⇒ flag false ⇒ **no reprieve**; the entry continues to
  decrement on the focus actor's cadence exactly as it does today. This is an **accepted,
  pre-existing limitation**, not introduced by this change — team scheduled self-buffs already
  live on the focus-actor cadence in the `'attacker'` store. The reprieve deliberately does not
  alter that legacy routing.
- **Team actor's _ability-sourced_ self-buff** (the path team actors actually use for their own
  self-buffs) flows through `applyTimedAbilityStatus` with `recipientId = actor.id` into the
  team actor's real-id store, decremented at that actor's own Post-Turn. The stamp
  (`writeKeyId = selfEffectiveId = actor.id`) matches `currentTurnActorId` ⇒ reprieve granted. ✓

So team-actor coverage is via the ability path (test #2 must exercise that path specifically);
team scheduled self-buffs are intentionally left on legacy routing.

### 4. `decrementPlayer(ownerId)` — consume the flag

```ts
for (const [key, s] of map) {
    if (s.appliedThisTurn) {
        s.appliedThisTurn = false; // reprieve consumed; next Post-Turn decrements normally
        continue;                  // no decrement this Post-Turn
    }
    s.turnsRemaining -= 1;
    if (s.turnsRemaining <= 0) {
        expired.push(s.buffName);
        map.delete(key);
    }
}
```

`decrementEnemy` is unchanged.

### 5. Engine wiring (`engine.ts`)

Call `statusEngine.beginTurn(actor.id)` at each actor's turn start — at/just before the
`turn-started` emit (~4353): `bus.emit({ type: 'turn-started', actorId: actor.id, round: r })`.

Id alignment (the linchpin), confirmed against current code:

- `focusActorId = 'attacker'` (line 1292). For the focus actor `actor.id === 'attacker'`, which
  matches the `'attacker'` self-store key used by `upsertBuff`/`sourceFired`. ✓
- Team actors' **ability-sourced** self-buffs go through `applyTimedAbilityStatus` with
  `recipientId = actor.id` → real-id store, matched by `beginTurn(actor.id)`. ✓
- Team actors' **scheduled** self-buffs route to the `'attacker'` store (legacy routing) and
  stay on the focus-actor cadence with no reprieve — accepted pre-existing limitation, detailed
  in §3 "Scheduled self-buffs always route to the `'attacker'` store". The plan must NOT treat
  this as a gap to chase.

## Edge cases (worked through)

- **Refresh during own turn:** flag recomputed true + duration reset → survives to next turn. ✓
- **Extra action same round:** flag cleared at the first Post-Turn (skip + flip false); the
  extra action's Post-Turn decrements it → buff active through the extra action, expires after.
  Matches "lasts through the next turn." ✓
- **Off-turn reactive self-buff:** `currentTurnActorId` is the attacker, not the carrier →
  flag stays falsy → unchanged. ✓
- **Carrier with no active turn yet (`currentTurnActorId` undefined):** comparison is false →
  no reprieve. Safe default. ✓

## Testing

New behavioral tests (encode the intended new rule before regenerating goldens):

1. **Thresh-style lifetime, focus path:** a 1-turn self-buff applied on the focus actor's turn is
   active across two of its turns and expires after the second.
2. **Thresh-style lifetime, positional/team path:** same, for a team actor (real id) using an
   **ability-sourced** self-buff (the `applyTimedAbilityStatus` path), proving the
   `beginTurn(actor.id)` id alignment in the positional path. (Do NOT assert reprieve on a team
   actor's *scheduled* self-buff — that path stays on legacy `'attacker'`-store routing by
   design, per §3.)
3. **Negative control — off-turn reactive self-buff:** an on-attacked self-buff applied during
   the attacker's turn is NOT extended (no reprieve).
4. **Unit on `decrementPlayer`:** an `appliedThisTurn` entry survives one decrement (flag flips
   false), then expires on the next.
5. **Enemy side unchanged:** an existing enemy-debuff lifetime test stays green (no reprieve on
   the enemy path).

Golden handling (per decision): **regenerate + spot-verify**. Regenerate the mechanical golden
shift across the suite, then manually verify the Thresh anchor and a representative sample of DPS
scenario goldens reflect the +1 lifetime. Do **not** blindly `vitest -u` without inspecting the
anchor diffs (combat-workflow gotcha).

## Risk / blast radius

- Every self-applied timed buff lifetime shifts +1 → large but bounded golden churn (DPS
  scenarios + combat goldens). Enemy debuffs, DoTs, persistent/accum stacks unchanged.
- `dynamicSpeedExtraAction.test.ts` encodes the current one-turn-early expiry as its premise; its
  mechanism assertion stays valid but the expiry premise must be refreshed.
- The dynamic-speed turn-order feature is independent and correct (`selectNextBySpeed` reads live
  speed buffs at selection time, agnostic to expiry timing).

## Out of scope

- Any +1 change to enemy debuffs or DoTs (not verified in-game; would be a separate project with
  far larger churn).
- Changes to persistent-stacking or accumulating status lifetimes.
