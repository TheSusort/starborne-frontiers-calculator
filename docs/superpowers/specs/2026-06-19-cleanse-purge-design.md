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
  "any other type → not-simulated"). It is annotation-only (`NOT_SIMULATED_TYPES` at
  `src/components/skills/simCoverage.ts:16` includes `'purge'`; removing it there also un-greys the
  ability in the coverage UI / `AbilityCard` — a UI-visible change, not engine-only).

**Two firing paths (verified, correctness-critical).** Cleanse fires from TWO disjoint code paths that
never converge: (a) the **cast path**, fully inlined in `playerTurn.ts` (the `cfg.type === 'cleanse'`
arm at `playerTurn.ts:1577-1581`, crediting `cleanseCount` at :1581, over the `healAbilities` loop), and
(b) the **reactive path** via `executeIntent` (`triggers.ts:1117`). Most cleanse abilities are on-cast,
so wiring only `executeIntent` would leave the common case credit-only. C must wire **both** sites for
cleanse and for purge.

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

*File-path note:* bare `statusEngine.ts` / `triggers.ts` / `playerTurn.ts` / `engine.ts` citations are
under `src/utils/combat/`; `skillTextParser.ts` is under `src/utils/`; `buildShipAbilities.ts` under
`src/utils/abilities/`; `abilities.ts` under `src/types/`; `simCoverage.ts` under `src/components/skills/`.

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

Add a monotonic `appliedSeq: number` to both `BuffState` and `AccumulatingState` (NOT to
`PersistentStackState` — persistent maps are never gathered by the primitive, so persistent entries need
no seq). The engine closure holds a single counter, incremented on every successful write and stamped
onto the entry. **Complete write-site enumeration** (verified against `statusEngine.ts`):

`BuffState` (finite-duration) creation/refresh:
- `applyTimedAbilityStatus` (ability-channel timed write, `:993`)
- the timed `upsertBuff` path (scheduled timed write, `:615`)
- **family-refresh** — when `familyApplicationWins` returns true and an existing entry is overwritten,
  re-stamp `appliedSeq` → a refreshed status counts as newest.

`AccumulatingState`:
- scheduled-accum seeds (`:390` self, `:418` enemy) and the ability-accum seed (`registerAbilityStatuses`,
  `:921`) all create at `stacks: 0` — **inert until the first stack lands**.
- **Stamp policy (resolved):** stamp `appliedSeq` at the `0 → positive` stack transition (the moment the
  accumulating status first becomes active), applied at BOTH increment sites — `beginRound`'s
  `incrementPerRound` (`:573`) and `sourceFired`'s `incrementSlot` (`:649`). Do **not** re-stamp on later
  stack gains: a long-accumulating status is OLD, not new, so its recency anchor is when it first appeared.
  Seed-time creation does not stamp (the entry isn't active yet).

Round granularity (`appliedRound`) is too coarse — AoE / multi-debuff turns apply several statuses in
one turn; a global sequence makes newest-first ordering deterministic for goldens.

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

### 4.3 Eligibility invariant (verified safe)

The primitive must **never** remove an always-active / passive-sourced / aura named status — those
re-derive and removal is futile (and wrong). **This is verified safe as built today** (traced in
`statusEngine.ts`):

- Scheduled always-active buffs are split into `alwaysSelf`/`alwaysEnemy` at construction (`:343-351`)
  and only surface through `snapshot()` as `turnsRemaining: 'recurring'` (`:717-726`) — never written to
  the timed maps. `upsertBuff` (`:601`) iterates only `timedSelf`/`timedEnemy`, pre-filtered to
  `!isAlwaysActive`.
- Ability-sourced always-active statuses are classified `kind:'aura'` (→ `auraSelfMaps`/`auraEnemyMaps`)
  or `accumulating`; only `kind:'timed'` reaches `applyTimedAbilityStatus` and writes a finite `BuffState`.

So `selfMaps`/`enemyMaps` contain only genuinely finite statuses, and `removeNewestFirst` is safe without
any extra always-active exclusion. **Guard:** add an invariant note (and ideally a dev assertion) at the
`kind:'timed'` write so a future change that routes an always-active named status through the timed path
can't silently make it removable.

## 5. C1 — Cleanse (real removal)

1. Add `appliedSeq` (§4.1) and the `removeNewestFirst` / `cleanse` primitive (§4.2).
2. Expand `UNREMOVABLE_STATUSES` (debuffs): add `Barrier Recharging`, `Damage to Dot`.
3. **Parse `"all"`.** `CLEANSE_RE = /\bcleanses?\s+(\d+)/gi` (`skillTextParser.ts:1995`) only captures a
   digit, so "cleanses all debuffs" is dropped today. Extend to `/\bcleanses?\s+(\d+|all)\b/gi` and widen
   `count` to `number | 'all'` through `parseCleanse` (`skillTextParser.ts:2002`) →
   `buildShipAbilities` (`buildShipAbilities.ts:1024-1042`) → the `{type:'cleanse', count}` config
   (`abilities.ts:241`, today `count: number`). The `'all'` value flows into `removeNewestFirst`.
   (Without this, §2.1's "all removes everything" is unreachable for cleanse.)
   **Metric sites must NOT consume the widened `count` directly** — `cfg.count` feeds three numeric sites
   (`ctx.healing.credit(..., 'cleanseCount', cfg.count)` at `triggers.ts:1119`; `cleansePerformedCount +=
   cfg.count` at `playerTurn.ts:1580`; the cast-path `credit` at `playerTurn.ts:1581`), and `credit`/
   `cleansePerformedCount` are `number` (`playerTurn.ts:83`, `state.ts:29`). Switch all three to credit the
   **actual removed count returned by `removeNewestFirst`** (it returns the number deleted), not
   `cfg.count`. This both avoids the `number | 'all'` TS error and makes the metric honest (a "cleanse all"
   that removes 2 credits 2).
4. **Reactive path** — new engine delegate on the intent-exec context (mirroring `creditReactiveDamage` /
   `grantExtraAction`, supplied at `engine.ts` ~`:2852`/`:2891` where `statusEngine` is in scope):
   `ctx.cleanse?(actorId, count)`. Replace the reactive cleanse branch (`triggers.ts:1117`): resolve
   recipients from `intent.ability.target` (`self` → `[ownerId]`; `ally` → `[damagedAllyId ?? healTarget]`;
   `all-allies` → `ctx.playerIds`) exactly as the heal branch (`triggers.ts:1068`), call
   `ctx.cleanse(rid, count)` for each.
5. **Cast path** — add the missing second call site at `playerTurn.ts:1577-1581` (the inlined
   `cfg.type === 'cleanse'` arm): resolve recipients via the existing `recipientsFor(ability.target)`
   (`playerTurn.ts:1399`) and call `statusEngine.cleanse(rid, count)` directly (statusEngine is already in
   scope here — no delegate needed; consistent with how the cast path calls other statusEngine methods).
6. **Keep** the existing `cleanseCount` healing-mode credit (UI metric) at both sites, but sourced from
   `removeNewestFirst`'s return value rather than `cfg.count` (see step 3) — real removal is additive to it.
7. The `cleanse-performed` event already fires; `on-enemy-cleansed` reactors (Arum/Grif/Larkspur) keep working.

## 6. C2 — Purge (buff removal, mirror)

1. New `parsePurge` (target axis = enemy side), mirroring `parseCleanse` but with broader count matching —
   the corpus uses several phrasings:
   - "purges N buffs" / "purges all buffs" → `(\d+|all)`
   - "purges **a** buff" / "purges **an enemy** buff" (Lodolite p3, Sefuba p1/p2) → indefinite article
     counts as 1.
   - Proposed: `/\bpurges?\s+(?:(\d+|all)|an?\b)/i`, mapping `a`/`an` → count 1.
   - "**is Purged of all** buffs" (Lodolite charge, passive voice, target = "the enemy with the most
     Buffs") — a single-anchor most-buffs target. **Decision needed at plan time:** support the passive
     form now (single anchor) or defer with the AoE note. Do not silently drop it.
2. `buildShipAbilities` emits the `{type:'purge', count}` ability (today unparsed → annotation-only).
   Remove `'purge'` from `NOT_SIMULATED_TYPES` (`simCoverage.ts:16`) once simulated (UI-visible).
3. `purge(targetId, count)` = `removeNewestFirst(targetId, 'buffs', count)` (same primitive, buff side).
4. Wire **both** firing paths (mirror C1.4/C1.5): the reactive `executeIntent` purge branch (replacing the
   skip at `triggers.ts:1158`) via a new `ctx.purge?(actorId, count)` delegate, AND the cast path in
   `playerTurn.ts` (add a `cfg.type === 'purge'` arm calling `statusEngine.purge` directly). Target = the
   turn's selected enemy (single-anchor). AoE-purge across multiple enemies is deferred to sub-project E
   (per-victim AoE accounting), consistent with all other multi-target work.
5. Expand `UNREMOVABLE_STATUSES` (buffs): add `Protection` (Magnetized Shielding already present).
6. **`purge-performed` event + reactive triggers are IN SCOPE** (the corpus has purge reactors):
   - **Salvation** p3 — "when a buff is purged from an ally, repairs that ally 5%" → `on-ally-purged`.
   - **Sefuba** — "when this Unit purges a buff from an enemy, repairs itself…" and p2 "…**purges 1 more
     buff** from the enemy" → `on-enemy-purged` whose reaction **re-enters purge**.
   Add the `purge-performed` event and the `on-enemy-purged` + `on-ally-purged` trigger keys.
   **Chain guard:** Sefuba's purge-triggers-purge must not recurse unbounded. Follow the heal path's
   no-re-emit convention (`triggers.ts:1111`): the executor's own purge removal does NOT re-emit
   `purge-performed` from within a reactive purge (only cast-path / direct purges emit), so a reactive
   purge cannot re-trigger another reactive purge. Pin this in a test.

## 7. Resolved decisions & open details

**Resolved (user):**
- Stasis is cleansable (§2.5).
- `permanent`-duration kept as belt-and-braces unremovable; removal scoped to named finite + accumulating
  statuses, never aura/always-active continuous modifiers (§2.3).
- Non-persistent accumulating statuses are removable (§2.4).

**Resolved during spec review (2026-06-19):**
- Accumulating `appliedSeq` stamp = at the `0→positive` stack transition, both increment sites (§4.1).
- Cleanse/purge fire from TWO paths: cast (`playerTurn.ts`, direct statusEngine call) + reactive
  (`executeIntent`, via delegate). Both wired (§5.4-5.5, §6.4).
- Purge reactors exist (Salvation, Sefuba) → `purge-performed` event + triggers in scope, with chain
  guard (§6.6).
- Always-active named statuses verified to never reach the timed maps (§4.3) — invariant guard added.

**Open details for plan time:**
- Whether to support the passive "is Purged of all buffs" target form now or defer (§6.1).
- Final naming of the trigger keys (`on-enemy-purged` / `on-ally-purged`).

## 8. Golden gate (honesty)

**Not uniformly byte-identical.**

- **DPS mode** stays byte-identical: the attacker's allies carry no debuffs vs a dummy enemy → cleanse is
  a no-op; purge of a dummy's buffs is a no-op for existing fixtures.
- **Healing mode and two-team sim** will see **audited churn** wherever a cleanse/purge now legitimately
  removes a real status that previously lingered (e.g. a healer cleansing a DoT off the tank changes
  subsequent incoming damage). The moment cast-path cleanse becomes real (§5.5), churn is likely to span
  **several existing healing suites** — `healing.test.ts`, `events.test.ts`, `enemyActions.test.ts`,
  `leech.test.ts` — wherever a cleanse coexists with an enemy-applied debuff on the tank, including the
  `cleanse-performed`/leech interaction paths. Re-baseline per-file with line-by-line justification; every
  delta explained; **never** blind `vitest -u`.

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
