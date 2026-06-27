# Design: Enemy-side cleanse lift

**Date:** 2026-06-27
**Status:** Approved (brainstorm complete)
**Epic:** combat-realism — enemy-side event-only consumption trio (heal / shield / cleanse)
**Siblings:** E5 enemy-heal lift; #166 enemy on-cast self-shields
**Handoff:** `docs/superpowers/handoffs/2026-06-27-enemy-cleanse-lift-handoff.md`

---

## Summary

Lift the **event-only cleanse stub** in `src/utils/combat/playerTurn.ts` so enemy cleanse
abilities actually **remove debuffs**, instead of only bumping a count and emitting the event.
This completes the enemy event-only consumption trio: enemy heals restore HP (E5), enemy
on-cast shields grant pools (#166), and now enemy cleanses remove debuffs.

**Guiding principle (locked):** combat-engine work is **team-symmetric** — a ship behaves
identically whatever side it's on. The enemy-side `else` stub that removes nothing while the
player path removes is a bug, not a simplification. See memory `feedback_engine_team_symmetry`.

## Background / the gap

`src/utils/combat/playerTurn.ts`, the heal/shield/cleanse consumption loop runs enemy casts in
event-only mode (`healEventOnly === true`). The cleanse branch (~lines 2002–2017) today:

```ts
} else if (cfg.type === 'cleanse') {
    if (!healEventOnly) {
        let removed = 0;
        for (const rid of recipientsFor(ability.target)) {
            removed += statusEngine.cleanse(rid, cfg.count);
        }
        cleansePerformedCount += removed;
        healing.credit(actor.id, 'cleanseCount', removed);
    } else {
        // Enemy-side event-only: no removal yet — preserve the cleanse-performed
        // cadence so on-enemy-cleansed reactors (Arum/Grif) stay unaffected.
        cleansePerformedCount += typeof cfg.count === 'number' ? cfg.count : 1;
    }
}
```

The `else` (enemy) branch removes **nothing** — it bumps the count by the nominal `count` (or 1)
so `cleanse-performed` still fires, driving on-enemy-cleansed reactors (Arum/Grif).

## Verification of the key unknown (resolved)

The handoff's open-question #1 — *do player-applied debuffs on an enemy land keyed by that
enemy's real id in the positional sim, so an enemy cleanse finds them?* — is **resolved: YES**.

Evidence chain (positional two-team sim):
- Player applies a timed debuff to a specific enemy via
  `playerTurn.ts:987` → `statusEngine.applyTimedAbilityStatus(r, status, actor.id, targetId)`,
  where the 4th arg `targetId` is the **real enemy victim id** (sourced from `engine.ts:3618`,
  `targetId: tgt.id`, `tgt` being a real enemy `CombatActor` from `enemyAttackerActors`).
- `statusEngine.ts:1136-1137` routes the enemy-side status to
  `getEnemyMap(enemyTargetId ?? DEFAULT_ENEMY_TARGET)` → keyed by that real enemy id.
- The enemy self-cleanse calls `cleanse(rid)` where `rid` comes from `recipientsFor('self')`
  → `[actor.id]` (`playerTurn.ts:1710`) → the enemy's **own real id**.
- `cleanse(actorId)` → `removeNewestFirst(actorId, 'debuffs', count)` reads
  `enemyMaps.get(actorId)` + `accumEnemyMaps.get(actorId)` (`statusEngine.ts:1002-1003`, `968-997`)
  — side-agnostic, keyed by actor id.

So the player applies and the enemy cleanses under the **same real enemy actor id**; the lift
is observable end-to-end. (The legacy single-attacker DPS path also works, via the shared
`DEFAULT_ENEMY_TARGET` sentinel on both sides.) No new status-engine primitive is required
(unlike the reactive-cleanse PR, which added `reduceNewestDebuffDuration`).

## Design

### 1. The lift (playerTurn.ts ~2002–2017)

Unify the cleanse branch so both modes perform real removal over the routed recipients; the
**only** side-difference is suppressing the player-facing metric credit on the enemy path:

```ts
} else if (cfg.type === 'cleanse') {
    let removed = 0;
    for (const rid of recipientsFor(ability.target)) {
        removed += statusEngine.cleanse(rid, cfg.count);
    }
    cleansePerformedCount += removed;
    // Player path ONLY: credit the player-facing cleanseCount metric bucket.
    // Enemy (event-only) path suppresses it — mirrors E5/#166 credit suppression.
    if (!healEventOnly) healing.credit(actor.id, 'cleanseCount', removed);
}
```

- `statusEngine.cleanse(rid)` is already side-agnostic (removes from `enemyMaps.get(rid)`).
- `recipientsFor(ability.target)` already routes enemy recipients
  (`self → [actor.id]`, `all-allies → enemyIds`, single `ally → lowestHpEnemyAllyId()`).
  Cleanse abilities target self/ally/all-allies — all covered. Same routing E5/#166 use.
- Credit suppression: the enemy path must NOT credit `healing.credit(actor.id, 'cleanseCount', …)`
  — it's a player-facing metric bucket (mirrors E5/#166).

### 2. Event cadence — full symmetry (locked decision)

The unified code makes `cleansePerformedCount` reflect the **real removed count** on both sides.
The existing emit guard already does the right thing:

```ts
if (cleansePerformedCount > 0) {
    bus.emit({ type: 'cleanse-performed', casterId: actor.id, count: cleansePerformedCount, round: r });
}
```

So `cleanse-performed` fires **only when ≥1 debuff was actually removed**. An enemy cleanse with
nothing to remove no longer fires the event — on-enemy-cleansed reactors (Arum/Grif) react only
to real removals, exactly like the player side. **No code change to the emit block;** the cadence
shift falls out of the unified count.

This is a deliberate, by-symmetry behavior change from the old stub (which always fired ≥1).

### 3. Scope

- All recipients: self / ally / all-allies (mirrors #166's all-recipients decision).
- Out of scope: positional per-victim **detonation** attribution (the remaining epic deferral,
  `engine.ts` ~4000 caveat).

## Testing

### Update: `enemyActions.test.ts` "E5: enemy heal RESTORES HP…" (~line 405)

This test asserts `cleanse.count === 2` for an enemy cleanser (`enemy1`) but seeds **no debuffs**
(`createStatusEngine({ selfBuffs: [], enemyDebuffs: [] })`). Under the lift, real removal = 0 →
no `cleanse-performed` → the assertions at ~420–422 fail. This is the single moving assertion
test the handoff flagged (NOT a `.snap` golden).

Fix: seed **2 removable debuffs on the cleanse recipient** before `runPlayerTurn` — the cleanse
ability targets `'ally'`, which for this enemy runtime routes to `lowestHpEnemyAllyId()` =
`enemy1` (the sole enemy ally). Apply via
`statusEngine.applyTimedAbilityStatus(1, <timed debuff status>, undefined, 'enemy1')` so real
removal = 2 and `cleanse.count === 2` holds — turning the assertion into a genuine positive.
Add a negative-control assertion in the same suite: with no debuffs seeded, no `cleanse-performed`
fires (makes the symmetry behavior change explicit).

### Update: partial-removal case in `enemyActions.test.ts`

Add a partial-removal assertion to the same suite — this is the crux of the symmetry fix and the
case where the old stub diverged most. `statusEngine.cleanse(rid, count)` clamps to available
candidates (`Math.min(count, candidates.length)`, statusEngine.ts:994), so an enemy cleanse with
`count: 2` against **only 1** removable debuff fires `cleanse-performed` with `count === 1` — not
the nominal 2 the old stub always bumped. Assert this explicitly.

### New: `enemyCleanse.integration.test.ts`

Mirror `enemyOnCastShield.integration.test.ts` — real skill registry + positional two-team
harness. Real cleanse actives (e.g. Cultivator, Hayyan) bundle cleanse with shields/buffs/heals,
so all assertions must scope to the **`cleanse-performed`** event specifically (not "no events"),
and isolate the cleanse observable from co-bundled effects:
- **Positive:** an enemy with a cleanse active + the player has landed a removable debuff on that
  enemy → after the enemy's cast, the debuff is gone (assert via status snapshot / debuff-derived
  observable, or a `cleanse-performed` count reflecting REAL removal).
- **Negative control:** enemy with no removable debuff → nothing removed, **no `cleanse-performed`
  fires** (assert on that event's absence specifically).
- **Revert check:** reverting the lift makes exactly the positive case fail.

### Player-side regression guard

The dedicated player cleanse cast-path test `cleanseCastPath.test.ts` stays **byte-identical**
(player-only path, untouched by the `else`-branch change; player removal already happened
pre-lift). Note: the `enemyActions.test.ts` "normal mode (healEventOnly false)" test (~lines
437–470) already seeds debuffs and asserts real removal on the player branch — it is already
correct and must NOT move.

### Golden audit

`npx vitest --run src/utils/combat` → expect **ZERO `.snap` movement** (no fixture equips an enemy
cleanser, same as #166). Investigate any assertion test that moves beyond the deliberately-updated
`enemyActions.test.ts` case.

## Verification gates (every epic PR)

`npx tsc --noEmit` clean · `npm run lint` 0 warnings · `npm run audit:skills` 141/0 ·
`npm test` 0 failed tests · ZERO `.snap` golden movement.

## Branch / stack hygiene

- Branch off the **#166 tip** (current branch `feat/combat-enemy-oncast-self-shields`), matching
  how #166 stacked on #165. Rebase onto `main` once #165 and #166 land
  (`git rebase --onto origin/main <166-tip> <cleanse-branch>`).
- `docs/` is gitignored → `git add -f` to track spec/plan.
- Workflow gotchas: `gh auth switch --user TheSusort` if `gh` acts as the wrong account; fresh
  worktrees lack `.env` (~14 `.tsx` test files fail to *collect*, 0 failed tests — copy `.env`
  in); Husky pre-commit runs the full vitest suite; **never `vitest -u`**.

## Changelog

User-facing combat behaviour change → add a plain-English line to `UNRELEASED_CHANGES` in
`src/constants/changelog.ts` before committing the implementation (enemy ships that cast cleanse
now actually remove debuffs you applied to them).

## Pointers

- Memory: `feedback_engine_team_symmetry`, `project_enemy_oncast_self_shields` (#166 — closest
  template), `project_enemy_side_attacked_emission` (#165), `project_combat_realism_epic`
  (sub-project C cleanse/purge history), `project_combat_engine_current_state` (workflow gotchas).
- Sub-project C (cleanse/purge) is marked CLOSED in epic memory, but that closure was player-side
  + reactive; this enemy-side on-cast cleanse removal is the remaining symmetry gap.
