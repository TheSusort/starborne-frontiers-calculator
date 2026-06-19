# Sub-project C — Cleanse + Purge (Status Removal) — Design

**Date:** 2026-06-19
**Branch:** `feat/combat-sim-phase5-pr2`
**Epic:** Combat-realism epic (sub-project C). Follows sub-project B (Stasis), which is complete.
**Status:** Spec — pending review.

## 1. Problem

The combat engine does not actually remove statuses.

- **Cleanse** parses (count + ally target) and emits a `{type:'cleanse', count}` ability, but the
  executor only credits a count to the healing calculator (`triggers.ts:1117` — `ctx.healing.credit(..., 'cleanseCount', ...)`).
  It never touches the status store. No debuff is ever removed.
- **Purge** has a type (`abilities.ts:21`) and config shape (`{type:'cleanse'|'purge', count}`,
  `abilities.ts:241`) but **no parser and no executor** — `executeIntent` skips it (`triggers.ts:1158`,
  "any other type → not-simulated"). It is annotation-only (`NOT_SIMULATED_TYPES` includes `'purge'`).

Sub-project C makes both real: cleanse removes debuffs from allies; purge removes buffs from enemies.

## 2. Locked rules (user-given)

1. **Count-based, newest-applied-first.** A cleanse/purge of N removes the N most-recently-applied
   removable statuses, by time of application. `"all"` removes every removable status.
2. **DoTs are included** in cleanse (they are ordinary removable debuffs).
3. **Removable = a *named* status with a finite round count, not tagged unremovable.**
   - Continuous passive modifiers with **no buff/debuff name** (e.g. Lodolite's "+damage for allies vs
     enemies carrying Concentrate Fire while stealthed") are **not removable** — they live in the
     modifier/aura channel, never as a named status.
   - Permanent / always-active / passive-sourced named statuses (no round count) are **not removable**
     (they would just re-derive next round).
   - Persistent-stacking statuses (Defense Shred, Blast, Overload, Titanite Plating) are **not removable**
     (unremovable by construction — separate maps).
   - Statuses explicitly tagged **Unremovable** in-game are **not removable**.
4. **Non-persistent accumulating statuses ARE removable** (the stackable statuses in the accumulating
   maps that are not in the persistent-stacking set).
5. **Stasis is cleansable** — a cleanse on a stasised ally removes Stasis and frees it early. (Stasis is
   a finite-duration named debuff, not tagged unremovable; no special case.)
6. **In-game Unremovable set** (from the game UI, user-supplied):
   - Debuffs: `Acidic Decay`, `Barrier Recharging`, `Damage to Dot`
   - Buffs: `Magnetized Shielding`, `Protection`
   - (`UNREMOVABLE_STATUSES` today holds only `Acidic Decay` + `Magnetized Shielding`.)

## 3. Store topology (grounding)

The status engine is direction-agnostic by actor id (`statusEngine.ts`):

- `selfMaps.get(id)` → `Map<familyKey, BuffState>` = the **buffs** actor `id` carries (the purge target).
- `enemyMaps.get(id)` → `Map<familyKey, BuffState>` = the **debuffs** on actor `id` (the cleanse target).
  Per-victim by id (B1 routing makes both attack directions land here keyed by the victim's id).
- `accumSelfMaps.get(id)` / `accumEnemyMaps.get(id)` → `Map<buffName, AccumulatingState>` = the
  accumulating buffs / debuffs (non-persistent stackables).
- `persistentSelfMaps` / `persistentEnemyMaps` → persistent-stacking — **never gathered** (unremovable
  by construction).
- Auras (`aurasSelf`/`aurasEnemy`) and always-active entries re-derive each round and are **not** named
  finite statuses in these maps — naturally untouched.

Existing primitives to build on:
- `isUnremovable(buffName, turnsRemaining)` (`statusEngine.ts:867`) — `true` when `turnsRemaining ===
  'permanent'` or `UNREMOVABLE_STATUSES.has(buffName)`. The shared gate.
- `clearRemovable(id)` (`:877`) — sweeps both `selfMaps.get(id)` + `enemyMaps.get(id)`, skipping
  `isUnremovable`. Used by Cheat Death (wipe-all on revive).
- `removeTimedEnemyStatus(targetId, buffName)` (`:894`) — B3's single-name targeted removal. C
  generalizes this into "remove up to N, newest-first".

## 4. Design

### 4.1 Application-order field

Add a monotonic `appliedSeq: number` to both `BuffState` and `AccumulatingState`. The engine closure
holds a single counter, incremented on every successful write and stamped onto the entry:

- `applyTimedAbilityStatus` (ability-channel timed write)
- the timed `upsertBuff` path (scheduled timed write)
- accumulating entry creation / seed
- **family-refresh** (`familyApplicationWins` re-application) re-stamps `appliedSeq` → a refreshed status
  counts as newest.

Round granularity (`appliedRound`) is too coarse — AoE / multi-debuff turns apply several statuses in
one turn; a global sequence makes newest-first ordering deterministic for goldens.

For accumulating entries, `appliedSeq` is stamped at creation; a stack-gain does **not** re-stamp
(open detail — see §7, defaults to "creation-time" unless review prefers last-stack recency).

### 4.2 The removal primitive

```
removeNewestFirst(actorId, side: 'debuffs' | 'buffs', count: number | 'all'): number
```

- Gather candidate entries from the timed map **and** the accumulating map for `actorId` on the chosen
  side (`debuffs` → `enemyMaps` + `accumEnemyMaps`; `buffs` → `selfMaps` + `accumSelfMaps`).
  Persistent-stack maps are **not** gathered.
- Filter out `isUnremovable(name, turnsRemaining)` entries (persistent already excluded by not gathering).
- Sort candidates by `appliedSeq` descending (newest first).
- Delete up to `count` (`'all'` → all candidates) from their owning map.
- Return the number actually removed (for the metric / events).

`cleanse(targetId, count)` = `removeNewestFirst(targetId, 'debuffs', count)`.
`purge(targetId, count)` = `removeNewestFirst(targetId, 'buffs', count)`.

Unknown id → lazy-empty maps → no-op (returns 0).

### 4.3 Eligibility invariant (correctness-critical)

The primitive must **never** remove an always-active / passive-sourced / aura named status — those
re-derive and removal is futile (and wrong). The `isUnremovable` `permanent`-sentinel guard plus the
fact that auras/always-active entries are not finite-duration `BuffState` entries should cover this, but
**planning must verify the storage representation** of always-active named statuses written via
`upsertBuff` (what `turnsRemaining` they carry) so the primitive provably skips them. If an always-active
named entry can land in a timed map with a finite `turnsRemaining`, the gather step must additionally
exclude always-active-sourced entries.

## 5. C1 — Cleanse (real removal)

1. Add `appliedSeq` (§4.1) and the `removeNewestFirst` / `cleanse` primitive (§4.2).
2. Expand `UNREMOVABLE_STATUSES` (debuffs): add `Barrier Recharging`, `Damage to Dot`.
3. New engine delegate on the intent-exec context (mirroring `creditReactiveDamage` / `grantExtraAction`):
   `ctx.cleanse?(actorId, count)`, wired from the engine where the statusEngine is in scope.
4. Replace the cleanse executor branch (`triggers.ts:1117`): resolve recipients from
   `intent.ability.target` (`self` → `[ownerId]`; `ally` → `[damagedAllyId ?? healTarget]`;
   `all-allies` → `ctx.playerIds`) exactly as the heal branch does, and call `ctx.cleanse(rid, count)`
   for each. **Keep** the existing `cleanseCount` healing-mode credit (UI metric) — real removal is
   additive to it. Must engage on both cast-path and reactive firings (wherever the ability fires today).
5. The `cleanse-performed` event already fires; `on-enemy-cleansed` reactors (Arum/Grif/Larkspur) keep working.

## 6. C2 — Purge (buff removal, mirror)

1. New `parsePurge` (`/\bpurges?\s+(\d+|all)/i`, target axis = enemy side), mirroring `parseCleanse`.
2. `buildShipAbilities` emits the `{type:'purge', count}` ability (today unparsed → annotation-only).
   Remove `'purge'` from `NOT_SIMULATED_TYPES` once it is simulated.
3. `purge(targetId, count)` = `removeNewestFirst(targetId, 'buffs', count)` (same primitive, buff side).
4. New `ctx.purge?(actorId, count)` delegate; replace the purge skip (`triggers.ts:1158`).
   Target = the turn's selected enemy (single-anchor). AoE-purge across multiple enemies is deferred to
   sub-project E (per-victim AoE accounting), consistent with all other multi-target work.
5. Expand `UNREMOVABLE_STATUSES` (buffs): add `Protection` (Magnetized Shielding already present).
6. `purge-performed` event + reactive trigger (e.g. `on-enemy-purged` / `on-ally-purged`) — add **only if**
   the corpus has ships reacting to purge (check in planning; YAGNI otherwise).

## 7. Resolved decisions & open details

**Resolved (user):**
- Stasis is cleansable (§2.5).
- `permanent`-duration kept as belt-and-braces unremovable; removal scoped to named finite + accumulating
  statuses, never aura/always-active continuous modifiers (§2.3).
- Non-persistent accumulating statuses are removable (§2.4).

**Open details for planning / spec review:**
- Accumulating `appliedSeq` stamp: creation-time (default) vs last-stack-gain recency.
- Exact engine wiring site(s) for the `cleanse`/`purge` delegates and the cast-vs-reactive firing paths.
- Whether any ship reacts to purge (drives the `purge-performed` event decision).
- Storage representation of always-active named statuses (the §4.3 invariant verification).

## 8. Golden gate (honesty)

**Not uniformly byte-identical.**

- **DPS mode** stays byte-identical: the attacker's allies carry no debuffs vs a dummy enemy → cleanse is
  a no-op; purge of a dummy's buffs is a no-op for existing fixtures.
- **Healing mode and two-team sim** will see **audited churn** wherever a cleanse/purge now legitimately
  removes a real status that previously lingered (e.g. a healer cleansing a DoT off the tank changes
  subsequent incoming damage). Every delta explained line-by-line; **never** blind `vitest -u`.

This matches the B-series gate convention. `audit:skills` 0/141, lint, and `tsc --noEmit` clean every PR.

## 9. Testing

- Unit tests for `removeNewestFirst` / `cleanse` / `purge`: newest-first ordering across mixed
  timed+accumulating stores; count-capping; `'all'`; unremovable skipped (named set + persistent +
  permanent); DoT removal; Stasis removal frees the ally; unknown id no-op.
- Integration: a healer with a cleanse ability removes a real enemy-applied debuff in healing mode
  (audited golden); a purger removes an enemy self-buff in two-team sim.
- Mirror harness: existing status-removal tests + the B3 `removeTimedEnemyStatus` / Stasis-break tests.

## 10. Out of scope

- AoE cleanse/purge across multiple victims (→ sub-project E, per-victim AoE accounting).
- Implant / gear-set sourced cleanse/purge abilities (→ sub-project D, ability sources).
- Reflect / counter / shield mechanics (→ G / H).
