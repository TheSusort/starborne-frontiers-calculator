# Selector-targeted debuff recipients (#403)

**Date:** 2026-08-27
**Issue:** #403 — "Selector-targeted debuffs land on the cast anchor, not the selector's victim"
**Parent:** #399 / PR #402 — this is the RECIPIENT axis that fix deliberately scoped out.
**Class:** footprint axis (which enemy a clause lands ON), distinct from the store axis (which
store it lands IN) that #399 closed. See `reference_store_axis_vs_side_axis`.

---

## 1. The defect

`resolveDebuffRecipientIds` (`debuffRecipients.ts:35`) has no arm for the three selector targets
— `enemy-most-buffs`, `enemy-highest-attack`, `enemy-highest-speed`. They fall through the
nine-branch ternary to its tail `[anchorId]`.

**In-fight.** A ship casts a skill whose pattern anchors on the front-most enemy, carrying a clause
that reads *"applies Stasis to the highest attack enemy."* Stasis lands on the front-most enemy.
The 9,000-attack ship behind it is untouched.

The reactive path is NOT affected — `triggers.ts:3928` resolves the selector through
`ctx.enemyWithHighestAttack`. This is the **cast** path only (`playerTurn.ts:2313` and PR8's
per-sub-attack call at `:2337`).

### Reachability

Latent. It needs a buff/debuff-typed config + a selector target + a NON-live trigger, and nothing
produces that shape: the parser emits selector targets only on live triggers (which
`partitionReactiveAbilities` pulls out before the cast path), and `AbilityCard.tsx`'s
`TARGET_OPTIONS` does not offer the selector targets to the editor.

That is the same reachability profile #399 itself had — it sat latent until someone hand-authored
the shape in a probe. Nothing user-visible moves, so **no changelog entry**.

---

## 2. Locked rulings

### R1 — Unresolved selector: fizzle on a board, bound victim in DPS mode

When the selector resolves to nobody (`most-buffs` with no buff anywhere on the opposing side;
empty roster):

- **positional caller** (`positionalLanding: true`, a real positioned roster) → **no recipient**.
  The clause fizzles: nothing inflicted, nothing resisted, no landing draw.
- **non-positional / DPS caller** (never supplies the delegate, so the selector can never resolve)
  → `[undefined]`, the turn's own bound victim. Keeps displayed DPS numbers byte-identical for
  every kit.

This is exactly the idiom the function's own tail already uses (`positionalLanding ? [] :
[undefined]`), and `landStatusOnRecipients` (`playerTurn.ts:2149`) already turns `[]` into
"nobody" and `[undefined]` into "the bound `enemy`" — no new landing machinery.

### R2 — Live resolution at clause time, not a turn-start snapshot

The selector resolves when the clause runs, not when the turn's args are built. Required by the
locked intra-cast clause-order rule (`project_intra_cast_clause_order`): a purge clause written
before the debuff clause changes who carries the most buffs, and the debuff must see the
post-purge board.

This is also the cheaper option: all three resolvers (`engine.ts:9864-9900`) already read
`statusEngine` live, so a closure is correct by construction and costs nothing on a cast with no
selector clause. Pre-computing would need an extra eager call per turn.

### R3 — Debuff-typed only; the buff-typed half is a measured residual

`matchingAbility` (`playerTurn.ts:2299`) searches `config.type === 'debuff'` only. A status that
reached the ENEMY store from a **buff**-typed config aimed at an enemy — the other half of what
#399's store fix covers — finds no ability at all, so `abTarget` is `undefined` and it lands on the
anchor regardless of the arms added here.

Not fixed here. Widening `matchingAbility` to accept buff-typed configs would change recipient
resolution for EVERY enemy-store buff-typed status, not just selector ones (a buff-typed
`all-enemies` config would start fanning out instead of hitting the anchor) — a bigger blast radius
than #403, needing its own reachability census
(`project_widening_invalidates_reachability_census`). Task 4 measures it and files it.

### R4 — The sibling purge loop keeps its anchor fall-back

The on-cast **purge** loop (`playerTurn.ts:3925`) resolves `enemy-most-buffs` through the eager
`enemyMostBuffsId` turn-arg and falls back to `[targetId]` when it is undefined. That stays. Purge
is a different clause type and re-ruling it is outside #403.

After this change the two loops in the same file disagree on the unresolved case by design. Both
sites get a comment naming the other, so it reads as a decision rather than drift.

---

## 3. Design

### 3.1 Classifier — `abilityTargetSide.ts`

Add a SECOND total map beside `ABILITY_TARGET_SIDE`:

```ts
export type EnemySelectorKind = 'most-buffs' | 'highest-attack' | 'highest-speed';

export const ABILITY_TARGET_SELECTOR: Record<AbilityTarget, EnemySelectorKind | null> = { ... };

export function enemySelectorKind(target: AbilityTarget): EnemySelectorKind | null;
```

This is the FOOTPRINT axis the file's JSDoc currently says it deliberately omits — update that
paragraph: the file now answers two axes, each as its own total `Record`, and says which is which.

Why a total `Record` and not a three-way `||`: `tsc` refuses to compile when a new `AbilityTarget`
variant appears. That property is the entire reason #399 exists — four hand-written chains had
silently gone stale. Do NOT hand-enumerate the three selectors inside `debuffRecipients.ts`.

`triggers.ts`'s existing hand-written selector sites (`:3573`, `:3928`, `:4926`, `:4930`, `:5105`)
are NOT migrated to the new map here. They are correct today; migrating them is a separate cleanup.

### 3.2 Turn arg — `selectorEnemyIdFor`

New optional field on `playerTurn`'s arg type, documented in that file's house style (what supplies
it, team-symmetry, and what `undefined` degrades to):

```ts
selectorEnemyIdFor?: (kind: EnemySelectorKind) => string | undefined;
```

Same delegate shape as the `adjacentEnemyIdsFor` field two entries above it — which is already a
param of the very helper being changed. Supplied by `engine.ts`'s `buildTurnArgs` (~:8697), built
over `tb.opposingRoster` from the three resolvers already defined for the reactive ctx:

| kind | resolver |
| --- | --- |
| `most-buffs` | `mostBuffsAmong(tb.opposingRoster)` |
| `highest-attack` | `highestAttackInRoster(tb.opposingRoster)` |
| `highest-speed` | `highestSpeedInRoster(tb.opposingRoster)` |

Team-symmetric for free: `tb.opposingRoster` is the same roster the existing eager
`enemyMostBuffsId` and the reactive ctx builders (`:9969`, `:10009`) use, and it is already
side-relative.

No `onceByOwner` memo, for any of the three. `highestAttack`/`highestSpeed` are already live in the
reactive ctx, so those two match it. `most-buffs` deliberately DIFFERS: the reactive ctx wraps it in
`onceByOwner` (`:9969`) because a purge co-occurs with that resolution and the memo pins one answer
for the whole reactive drain. The cast path has the opposite requirement — R2's written-clause-order
rule says a purge clause EARLIER IN THE SAME CAST must be visible to a later debuff clause, which a
memo would hide. A reviewer will hit this asymmetry; it is intended, and the delegate's JSDoc says
so.

### 3.3 The arm — `debuffRecipients.ts`

New param `selectorEnemyIdFor`, and a branch placed AHEAD of the `all-enemies` branches (a selector
target is single-victim; it must never reach the AoE footprint arms):

```
kind = enemySelectorKind(abTarget)          // abTarget undefined → null, tail unchanged
kind !== null
  ? (id = selectorEnemyIdFor?.(kind)) !== undefined
      ? [id]
      : positionalLanding ? [] : [undefined]     // R1
  : <existing nine-branch ternary, unchanged>
```

Both call sites inherit it: the cast-time call and PR8's per-sub-attack call go through this one
helper, so a MULTI-HIT selector clause re-resolves per sub-attack against that sub-attack's live
board — correct by the multi-hit full-walk rule (`project_multi_hit_full_walk_attacks`), and it
gets overkill retargeting for free the same way `all-enemies` does.

Extend the file's JSDoc: it is the one place the branch rules are described, and the selector arm
plus R1 belong there, not restated at the call sites.

---

## 4. Tasks

**Task 1 — classifier.** `ABILITY_TARGET_SELECTOR` + `enemySelectorKind` + JSDoc rewrite for the
two-axis file. Unit test: the map is total and the three selectors are the only non-null entries.
No production behaviour change.

**Task 2 — the arm.** `debuffRecipients.ts` param + branch; `playerTurn.ts` arg field, destructure,
and both call sites; `engine.ts` `buildTurnArgs` delegate. Unit tests in
`debuffRecipients.test.ts`: one arm per selector kind (resolved → `[id]`), plus the R1 fork in BOTH
directions — positional unresolved → `[]`, non-positional unresolved → `[undefined]`, and
delegate-absent → `[undefined]`.

**Task 3 — flip the probe.** `selectorTargetStoreSide.test.ts`:
- SELECTOR arm asserts the mark lands on `HIGH_ATTACK_ID` and is ABSENT from `ANCHOR_ID`.
- CONTROL arm (`target: 'enemy'`) unchanged — it is the instrument validation. If it moves, the
  probe is measuring its own wiring, not the fix (`feedback_measurement_instrument_validity`).
- Add arms for `enemy-most-buffs` and `enemy-highest-speed`. Without them two of the three
  selectors ship unmeasured, and the two-enemy fixture must make the selector's victim and the
  anchor DIFFERENT actors for each (the #399 final-review trap: with one enemy the two answers
  coincide).
- Add a positional R1 arm: `most-buffs` with no buff anywhere → the mark is on NEITHER enemy.
- Rewrite the file header. The paragraph recording "measured result: the debuff still lands on the
  ANCHOR" is the record that the defect was real — keep it, in the past tense, and state what
  changed it.

**Task 4 — record the buff-typed residual (R3).** A probe arm measuring that a buff-typed
enemy-selector status still lands on the anchor, a comment at `playerTurn.ts:2299` naming the
boundary, and a new issue. Mirror how #399 recorded THIS issue.

**Task 5 — comments at the divergence (R4).** `playerTurn.ts:3925` (purge) and the new arm each
name the other and say why they differ.

**Task 6 — verification.** Full `npm test` — the golden audit spans the whole suite, not the
touched files (`project_combat_engine_current_state`). `tsc --noEmit` catches what vitest cannot
(`reference_sim_test_harness_traps`). Never `vitest -u`. Seed RNG with `setupKeyedTestRng(seed)`
alone.

---

## 5. Out of scope

- Migrating `triggers.ts`'s three selector ternaries to `ABILITY_TARGET_SELECTOR`.
- The buff-typed `matchingAbility` widening (R3) — its own issue.
- Re-ruling the on-cast purge fall-back (R4).
- `AbilityCard.tsx`'s `TARGET_OPTIONS` — offering the selector targets to the editor would make
  this reachable; that is a product decision, and #404 (reachability pins cannot see PERSISTED user
  abilities) would have to land first.
