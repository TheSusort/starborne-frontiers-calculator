# E1 — Symmetric incoming surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the player→enemy damage direction record per-victim intake (incoming / shieldAbsorbed / barrierAbsorbed) into the same `perActorIncoming` map the enemy→player direction already uses, so every victim — on either side — has a real damage-intake surface. This is the keystone foundation for E2 (per-victim leech).

**Architecture:** The engine already has a direction-agnostic per-victim intake map `perActorIncoming` (keyed by actor id, ids globally unique across sides) and a `DamageAccountingSink` abstraction. The enemy→player wrapper (`applyIncomingToTarget`) uses `playerSink`, which writes `intakeFor(victimId)`. The player→enemy wrapper (`applyOutgoingToEnemy`) uses `enemySink`, whose three hooks are currently **no-ops** (`engine.ts:2442-2446`). E1 replaces those no-ops with the exact `playerSink` bodies. `applyOutgoingToEnemy`'s only production caller is the **positional** apply path (`drivePositionalApply`, `engine.ts:2619`); all existing non-positional fixtures never call it, so they add no enemy key and stay byte-identical.

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/`.

---

## Byte-identical analysis (READ FIRST — the load-bearing invariant)

- `applyOutgoingToEnemy` (`engine.ts:2447`) is wired **only** at the positional binding `drivePositionalApply` (`engine.ts:2619`: `applyToVictim: (victim, damage) => applyOutgoingToEnemy(damage, victim)`). It is NOT called on any non-positional path. (`__testTapApplyOutgoingToEnemy` at `:2459` is test-only.)
- The two tests that assert on `perActorIncoming` — `perActorIncoming.test.ts` and `destroyedRoundUnification.test.ts` — use **only manual (non-positional) enemies** (no `position` field; see `perActorIncoming.test.ts:12-13`, `destroyedRoundUnification.test.ts:26-27`). After E1, `applyOutgoingToEnemy` is still never called in those fixtures → no `'enemy'` key is ever added → their `expect(rd.perActorIncoming.has('enemy')).toBe(false)` assertions remain true.
- The adapter (`healingEngineAdapter.ts`) and `battleSimulator.ts` do **not** surface `perActorIncoming` into their result types — so no `.snap` golden serializes it. DPS/healing snapshot goldens cannot move.
- `twoTeamBattle.test.ts` IS positional and WILL now populate enemy intake buckets, but it does **not** assert on `perActorIncoming` (it reads `perTargetDamage` = damage *dealt*, unchanged) → its assertions stay green.

**Conclusion: E1 is FULLY byte-identical (zero `.snap` movement, every existing test green).** The new enemy intake buckets are observable only through the NEW test added in Task 1. If ANY existing golden or test moves, STOP — the invariant leaked; investigate, do not `vitest -u`.

---

## File Structure

- **Modify:** `src/utils/combat/engine.ts` — replace the three no-op `enemySink` hooks (`:2442-2446`) with the `playerSink` bodies; update the stale `enemySink` comment (`:2433-2441`).
- **Modify (test):** `src/utils/combat/__tests__/twoTeamBattle.test.ts` — add one `describe` block reusing the file's existing `battle()` / `run()` / `ENEMY_IDS` harness to prove the enemy victim now gets a per-actor intake bucket.

No new files. No type changes (the `ActorIntake` type and `perActorIncoming` map already exist; `enemySink` already conforms to `DamageAccountingSink`).

---

## Task 1: Failing test — player→enemy hit records enemy intake

**Files:**
- Test: `src/utils/combat/__tests__/twoTeamBattle.test.ts` (add a new `describe` at the end, reusing existing helpers)

- [ ] **Step 1: Write the failing test**

Add at the end of `twoTeamBattle.test.ts` (reuses the existing `battle`, `run`, `ENEMY_IDS`, `PLAYER_IDS` helpers already in this file). The round accessor mirrors `perActorIncoming.test.ts:112` (`result.healing!.rounds`).

```typescript
describe('E1 — symmetric incoming surface: player→enemy hits record per-victim intake', () => {
    it('an enemy struck by a player attack gets a perActorIncoming bucket with incoming > 0 (non-vacuous)', () => {
        idc = 0;
        // Players immortal so the battle runs; enemies tanky enough to survive and keep being hit.
        const { result } = run(
            battle({
                playerHp: 1_000_000_000,
                enemyHp: 1_000_000_000,
                playerAttack: 5000,
                enemyAttack: 5000,
            })
        );

        const rounds = result.healing!.rounds;

        // At least one enemy victim has an intake bucket with positive incoming.
        const enemyBucketRounds = rounds.filter((rd) =>
            [...ENEMY_IDS].some((id) => (rd.perActorIncoming.get(id)?.incoming ?? 0) > 0)
        );
        expect(enemyBucketRounds.length).toBeGreaterThan(0);

        // The player side is still tracked too (symmetry — enemy→player intake unaffected).
        const playerBucketRounds = rounds.filter((rd) =>
            [...PLAYER_IDS].some((id) => rd.perActorIncoming.has(id))
        );
        expect(playerBucketRounds.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `npx vitest run twoTeamBattle -t "symmetric incoming surface"`
Expected: FAIL — `enemyBucketRounds.length` is `0` because `enemySink`'s hooks are no-ops, so `intakeFor(enemyId)` is never created and `perActorIncoming.get(enemyId)` is `undefined`.

(If it does NOT fail, STOP — the harness/accessor is wrong. Confirm `result.healing!.rounds` is the right surface and `battle()` produces a positional run that calls `applyOutgoingToEnemy`.)

- [ ] **Step 3: Commit the failing test**

```bash
git add src/utils/combat/__tests__/twoTeamBattle.test.ts
git commit --no-verify -m "test(combat): E1 — failing test for symmetric enemy intake surface"
```

---

## Task 2: Make the enemySink hooks real

**Files:**
- Modify: `src/utils/combat/engine.ts:2433-2446`

- [ ] **Step 1: Replace the no-op enemySink with the real intake writes**

Replace the comment block (`:2433-2441`) and the no-op object (`:2442-2446`) with:

```typescript
        // Player→enemy intake (E1 — symmetric incoming surface). The symmetric THIN wrapper over
        // applyVictimDamage for the direction where a PLAYER attacks an ENEMY victim. The enemy
        // victim runs the FULL HP/shield/Barrier/Cheat-Death/recordDestroyed path AND now records
        // its incoming / shield-absorbed / barrier-absorbed into the same per-actor `intakeFor`
        // bucket the playerSink uses — keyed by the ENEMY victim's id (ids are globally unique
        // across sides, so one map serves both directions). `applyOutgoingToEnemy` is only invoked
        // on the positional apply path (drivePositionalApply), so non-positional fixtures never add
        // an enemy key → byte-identical. The enemy victim is never the heal target, so no
        // heal-target death-round bookkeeping applies. E2 (per-victim leech) reads this surface.
        const enemySink: DamageAccountingSink = {
            addIncoming: (amount, victimId) => {
                intakeFor(victimId).incoming += amount;
            },
            addShieldAbsorbed: (amount, victimId) => {
                intakeFor(victimId).shieldAbsorbed += amount;
            },
            addBarrierAbsorbed: (amount, victimId) => {
                intakeFor(victimId).barrierAbsorbed += amount;
            },
        };
```

(The bodies are intentionally identical to `playerSink` (`:2410-2420`). They are kept as a separate named const so E2/future work can let the two directions diverge without churning the player path.)

- [ ] **Step 2: Run the Task 1 test to verify it PASSES**

Run: `npx vitest run twoTeamBattle -t "symmetric incoming surface"`
Expected: PASS — enemy victims now get `intakeFor(enemyId)` buckets with `incoming > 0`.

- [ ] **Step 3: Commit**

```bash
git add src/utils/combat/engine.ts
git commit --no-verify -m "feat(combat): E1 — symmetric incoming surface (enemy victims record intake)"
```

---

## Task 3: Byte-identical verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the two perActorIncoming-asserting tests**

Run: `npx vitest run perActorIncoming destroyedRoundUnification`
Expected: PASS — both use non-positional manual enemies; their `has('enemy') === false` assertions stay true (no `applyOutgoingToEnemy` call → no enemy key).

- [ ] **Step 2: Run the full positional + two-team suite**

Run: `npx vitest run twoTeamBattle positionalDamage dpsSimulator`
Expected: PASS, no assertion changes.

- [ ] **Step 3: Run the full test suite + confirm ZERO golden movement**

Run: `npx vitest run`
Then: `git status --porcelain` and `git diff --stat -- '*.snap'`
Expected: all tests green; **no `.snap` file modified** (the load-bearing invariant). If any `.snap` moved, STOP and investigate — do NOT `vitest -u`.

- [ ] **Step 4: Lint + typecheck + skill audit**

Run: `npm run lint && npx tsc --noEmit && npm run audit:skills`
Expected: lint 0 warnings, tsc clean, audit 0 findings / 141 ships.

(No commit — verification only. If anything fails, fix under the same task before proceeding.)

---

## Task 4: Doc closeout

**Files:**
- Modify: `docs/superpowers/specs/2026-06-19-per-victim-aoe-accounting-E-design.md` (mark E1 shipped)

- [ ] **Step 1: Append an E1-shipped note to the spec**

Add a short "E1 SHIPPED" line under §4 (commit, byte-identical confirmation, that the enemy intake surface is now live and unread until E2).

- [ ] **Step 2: Commit (docs are gitignored → force-add, skip hook)**

```bash
git add -f docs/superpowers/specs/2026-06-19-per-victim-aoe-accounting-E-design.md
git commit --no-verify -m "docs(spec): E1 shipped — symmetric incoming surface"
```

**No changelog entry:** E1 is internal-only plumbing (no user-facing behavior change; enemy intake is unread until E2). Per CLAUDE.md, skip the changelog.

---

## Done criteria

- New Task 1 test passes (enemy victims get intake buckets on the positional path).
- `perActorIncoming.test.ts` + `destroyedRoundUnification.test.ts` green (no enemy key on non-positional fixtures).
- Full suite green; **zero `.snap` movement**; lint 0; tsc clean; audit 0/141.
- E2 can now read per-victim enemy intake off `perActorIncoming`.
