# SP-4c-2d — Delete the Dummy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the vestigial `enemy` dummy actor from the combat engine, ruling that a victimless reactive infliction is a no-op, and stop the skill editor from authoring the shape that needed the ruling.

**Architecture:** Three commits in one PR, in a forced order. Commit 1 makes all four reactive-executor fallback sites no-op and **deletes `enemy`/`enemyId` from `IntentExecContext`**, so `tsc` — not grep — proves no site can still reach the dummy through the drain context. Commit 2 deletes the actor and clusters A/B/D/E/F/G. Commit 3 constrains the skill editor so the un-targeted shape can no longer be authored.

**Tech Stack:** TypeScript, Vitest + React Testing Library, TailwindCSS. No new dependencies.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-18-sp4c-match-end-and-delete-the-dummy-design.md` — §10 is this rung's design; §4's cluster table is the deletion inventory; §9.4/§9.5 are the hand-offs.
- **Navigate by symbol, never by line number.** §10.4 measured 4 of 5 of §9.4's citations and 3 of the engine's own internal cross-refs already stale at `e8cdafdd` with no intervening commits. Every line number in this plan is advisory as of `e8cdafdd`; every `grep` anchor is authoritative.
- **Baseline to hold:** 533 test files / 5894 tests passing, `npx tsc --noEmit` clean, `npm run lint` clean, oracle `npm run audit:placement-symmetry -- --seeds 15` at exactly `shipsSwept 147 / symmetricShips 146 / findings 2`.
- **Zero golden movement.** Per §4.5, any `.snap` drift means an earlier rung missed a path — investigate, do not re-pin. **Never run `vitest -u`.**
- Husky pre-commit runs the full suite and is the only gate — **there is no CI test workflow.**
- The engine is **not** deterministic (`rateAccumulator.ts` uses `Math.random`). Pin any new fixture with `setupKeyedTestRng` + `resetRateGateRng`.
- `grep -q` is unreliable in this shell (it is a ugrep wrapper). Use `grep -n` / `grep -c` / `grep -rl`.
- Only commit 3 gets an `UNRELEASED_CHANGES` entry in `src/constants/changelog.ts`. Commits 1 and 2 get none, deliberately (§9.7).
- `docs/superpowers/**` is gitignored — stage plan/spec edits with `git add -f`.

---

## File Structure

**Commit 1 — the no-op ruling**

| File | Responsibility |
| --- | --- |
| `src/utils/combat/triggers.ts` | The four fallback sites; delete `enemy`/`enemyId` from `IntentExecContext` |
| `src/utils/combat/engine.ts` | Stop supplying the two deleted fields |
| `src/utils/combat/__tests__/victimlessInflictionNoOp.test.ts` | **NEW** — the two tripwires |
| `src/utils/combat/__tests__/purgeReactive.test.ts` | Migrate (a); de-vacuum (c) and (d) |
| `src/utils/combat/__tests__/purgeConditionalSources.test.ts` | Migrate the two fallback cases |
| ~30 further test files | Mechanical: drop `enemy:` / `enemyId:` from ctx literals (tsc enumerates them) |

**Commit 2 — the deletion**

| File | Responsibility |
| --- | --- |
| `src/utils/combat/engine.ts` | Clusters A/B/D/E/F/G; the dead turn body; `SENTINEL_ENEMY_ACTOR_ID` |
| `src/utils/combat/__tests__/retiredDummyTurn.test.ts` | Test 1 dies, test 2 migrates (§9.5) |
| `src/utils/combat/__tests__/dummyReachability.test.ts` | Six paths keep a positive half; riding cleanups |
| `src/utils/combat/__tests__/indestructibleDeath.test.ts` | Loses two `dpsEnemyTarget`-only cases |
| `src/utils/combat/__tests__/sentinelActorIdReservation.test.ts` | **NEW** — §4.6's two-directional pair |

**Commit 3 — the editor guard**

| File | Responsibility |
| --- | --- |
| `src/components/skills/simCoverage.ts` | `isVictimlessInfliction(ability)` predicate + warning copy |
| `src/components/skills/AbilityCard.tsx` | Constrain `TARGET_OPTIONS`; render the inline error |
| `src/components/skills/__tests__/simCoverage.test.ts` | Predicate unit tests |
| `src/components/skills/__tests__/AbilityCard.test.tsx` | Constrain + flag render tests |
| `src/constants/changelog.ts` | The single user-facing entry |

---

## Task 1: The no-op ruling (commit 1)

**Files:**
- Create: `src/utils/combat/__tests__/victimlessInflictionNoOp.test.ts`
- Modify: `src/utils/combat/triggers.ts` (four sites + two interface fields)
- Modify: `src/utils/combat/engine.ts` (the drain-ctx supply site)
- Modify: `src/utils/combat/__tests__/purgeReactive.test.ts`
- Modify: `src/utils/combat/__tests__/purgeConditionalSources.test.ts`
- Modify: ~30 test files carrying `enemy:` / `enemyId:` in an `IntentExecContext` literal

**Interfaces:**
- Consumes: nothing from earlier tasks (first task).
- Produces: `IntentExecContext` **without** `enemy: CombatActor` and **without** `enemyId: string`. Task 2 relies on this — once the drain context cannot see the dummy, deleting the actor touches only `engine.ts`.

### Background the implementer needs

A "reactive infliction" is a passive that fires on an event rather than on a cast, and inflicts something on an enemy. Normally the triggering event stamps *which* enemy, in `intent.eventCtx.victimId` or `.counterTargetId`. Four executor branches in `triggers.ts` had a fallback for when neither is stamped: aim at the DPS dummy, a hidden actor with id `'enemy'`.

Since SP-4c-2c the dummy takes no turn, so anything landing on it never ticks and never expires — while `dotCarrierActors` still *reports* it. §10.1 measured the purge branch's fallback taken **73 times** across the suite by real ships (Rhodium's end-of-round purge, whenever no enemy carries a buff). The rule this task adopts is the one the engine already documents in the damage branch:

> *"A selector that resolves nothing is a NO-OP — it never falls back to the dummy."* — `triggers.ts`, above the `enemy-most-buffs` arm

- [ ] **Step 1: Write the two failing tripwires**

Create `src/utils/combat/__tests__/victimlessInflictionNoOp.test.ts`.

Tripwire 1 needs a **synthetic** ability, because §10.1 established that no shipped kit can build the shape (all 40 corpus shapes resolve a target). Tripwire 2 pins the one shipped consumer.

Model the fixture on an existing reactive-DoT integration test — read `src/utils/combat/__tests__/dummyReachability.test.ts` header first for the file conventions this suite uses, and copy its harness imports rather than inventing new ones.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { setupKeyedTestRng, resetRateGateRng } from '../__testutils__/…'; // match dummyReachability's import
import type { Ability } from '../../../types/abilities';

// SP-4c-2d: a reactive infliction whose triggering event stamps NEITHER victimId NOR
// counterTargetId is a NO-OP. It used to land on the vestigial `enemy` dummy, where (since
// SP-4c-2c retired that actor's turn) it never ticked and never expired while dotCarrierActors
// kept reporting it. No SHIPPED kit reaches this arm — all 40 corpus shapes resolve a target
// (spec §10.1) — so tripwire 1 must build the shape synthetically.

describe('SP-4c-2d: a victimless reactive infliction is a no-op', () => {
    beforeEach(() => {
        setupKeyedTestRng();
        resetRateGateRng();
    });

    it('a start-of-round DoT with target:enemy applies NOTHING and emits no dot-applied', () => {
        const victimlessDot: Ability = {
            id: 'synthetic-victimless-dot',
            type: 'dot',
            target: 'enemy',
            trigger: 'start-of-round',
            config: {
                type: 'dot',
                dotType: 'corrosion',
                stacks: 1,
                tier: 3,
                duration: 3,
            },
        } as unknown as Ability;

        const result = runCombat(/* fixture: one player carrying victimlessDot on its passive
                                    slot, plus a real positioned enemy roster */);

        // NEGATIVE: nothing landed anywhere.
        expect(
            result.log.flatMap((r) => r.entries).filter((e) => e.kind === 'dot-applied')
        ).toHaveLength(0);
        // and no phantom carrier reporting
        expect(result.dotState?.corrosionStacks ?? []).toEqual([0, 0, 0, 0]);
    });

    it('POSITIVE HALF: the same DoT with target:enemy-highest-attack still lands', () => {
        const targetedDot: Ability = {
            id: 'synthetic-targeted-dot',
            type: 'dot',
            target: 'enemy-highest-attack',
            trigger: 'start-of-round',
            config: {
                type: 'dot',
                dotType: 'corrosion',
                stacks: 1,
                tier: 3,
                duration: 3,
            },
        } as unknown as Ability;

        const result = runCombat(/* same fixture, targetedDot instead */);

        // Pins VICTIMLESSNESS, not "reactive DoTs stopped working".
        expect(
            result.log.flatMap((r) => r.entries).filter((e) => e.kind === 'dot-applied').length
        ).toBeGreaterThan(0);
    });

    it("Rhodium's end-of-round purge no-ops when no enemy carries a buff", () => {
        // The ONE shipped consumer of a dummy fallback (spec §10.1, 73 measured hits).
        // `mostBuffsAmong` returns undefined when no enemy carries any buff, and the purge
        // branch alone fell through to the dummy. Rhodium's `damage` half on the same trigger
        // and target already returned — now both agree.
        const result = runCombat(/* Rhodium vs an enemy roster carrying ZERO self-buffs */);

        expect(
            result.log.flatMap((r) => r.entries).filter((e) => e.kind === 'purge')
        ).toHaveLength(0);
    });

    it('POSITIVE HALF: the same purge fires when an enemy IS buffed', () => {
        const result = runCombat(/* Rhodium vs an enemy roster where one member self-buffs */);

        const purges = result.log
            .flatMap((r) => r.entries)
            .filter((e) => e.kind === 'purge');
        expect(purges.length).toBeGreaterThan(0);
        // and it named a REAL enemy, never the sentinel string
        for (const p of purges) expect(p.targetId).not.toBe('enemy');
    });
});
```

⚠️ **Resolve every `/* fixture */` placeholder against the real harness before running.** Copy a working `runCombat` invocation from `dummyReachability.test.ts` and adapt it — do not invent field names. Per §9.6, an invalid `TargetSelection` string runs **GREEN** under vitest and is caught only by `tsc`, so a hand-written fixture that looks plausible may silently exercise a different path.

⚠️ **Column 4 is the FRONT of the enemy roster**, not column 1 — a fixture that assumes otherwise measures the wrong actor.

- [ ] **Step 2: Run the tripwires and confirm they fail for the RIGHT reason**

```bash
npx vitest run src/utils/combat/__tests__/victimlessInflictionNoOp.test.ts
```

Expected: the two negative tests **FAIL** (a `dot-applied` is emitted; a `purge` is emitted), the two positive halves **PASS**.

**If a negative test passes here, stop.** It means the fixture never reached the arm — the tripwire would be vacuous, which is exactly the defect 4c-2c shipped and had to fix. Prove the fixture reaches the arm by adding a temporary `console.error` at the site and confirming it prints, then remove it.

- [ ] **Step 3: Make the debuff branch no-op**

In `src/utils/combat/triggers.ts`, find the loop with `grep -n "for (const applicationTargetId of applicationTargetIds)"`. Insert the guard as the **first statement in the loop body**, above the existing `perVictimOk` check:

```typescript
        for (const applicationTargetId of applicationTargetIds) {
            // SP-4c-2d: a victimless infliction is a NO-OP — the rule the reactive damage
            // branch already states above its selector arms. Before this rung an unresolved
            // target fell through to `ctx.enemy.id`, the vestigial dummy sink.
            if (applicationTargetId === undefined) continue;
```

Then find `grep -n "const debuffTargetId" src/utils/combat/triggers.ts` and drop its fallback:

```typescript
            const debuffTargetId = applicationTargetId;
```

- [ ] **Step 4: Make the dot branch no-op**

Find it with `grep -n "const routedVictimId" src/utils/combat/triggers.ts`. Replace the three-line resolution:

```typescript
        const routedVictimId = intent.eventCtx?.victimId ?? intent.eventCtx?.counterTargetId;
        // SP-4c-2d: victimless → NO-OP, so no container push and NO `dot-applied`. Before this
        // rung the stack landed in the dummy's containers, where since 4c-2c it never ticked and
        // never expired while `dotCarrierActors` kept REPORTING it (spec §9.8).
        if (routedVictimId === undefined) return;
        const victim = ctx.actorById?.(routedVictimId);
        // A unit-test ctx without an `actorById` delegate cannot resolve the object but still
        // knows the id — keep using it rather than inventing a target.
        const victimId = victim?.id ?? routedVictimId;
```

**Leave `landDotOn`'s `(victim?.corrosionEntries ?? ctx.corrosionEntries)` tails alone.** `ctx.corrosionEntries` / `infernoEntries` / `pendingBombs` stay: they also feed `buildDrainContext`'s condition scalars (`corrosionEntryCount`, `enemyDotFamilyCounts`), which is **4d**'s business, not this rung's.

- [ ] **Step 5: Make the damage branch no-op**

Find it with `grep -n "const opposing = ctx.livingOpposingActorIds"`. Replace:

```typescript
            const opposing = ctx.livingOpposingActorIds?.(intent.ownerId) ?? [];
            // SP-4c-2d: an empty living roster is a NO-OP, matching the two selector arms above
            // — this arm is the last one that still fell back to the dummy.
            if (opposing.length === 0) return;
            victimIds = [opposing[0]];
```

- [ ] **Step 6: Make the purge branch no-op — the one with a shipped consumer**

Find it with `grep -n "intent.ability.target === 'enemy-most-buffs'" src/utils/combat/triggers.ts` (the occurrence inside the purge branch, near `const targetId =`). Replace:

```typescript
        const targetId =
            intent.ability.target === 'enemy-most-buffs'
                ? ctx.enemyWithMostBuffs?.(intent.ownerId)
                : (intent.eventCtx?.counterTargetId ?? intent.eventCtx?.victimId);
        // SP-4c-2d: this was the ONLY fallback with a SHIPPED consumer — Rhodium's end-of-round
        // purge, in every round where no enemy carried a buff (`mostBuffsAmong` returns undefined
        // there, `engine.ts`). Measured 73 hits suite-wide. Rhodium's own `damage` half on the
        // same trigger and same target already returned on undefined; now both halves agree.
        if (targetId === undefined) return;
```

- [ ] **Step 7: Delete the two fields from `IntentExecContext`**

This is what makes `tsc` the gate rather than a grep — the mistake §10.1 corrected was that §9.8 found one of four sites by reading code.

In `src/utils/combat/triggers.ts`, find `grep -n "export interface IntentExecContext" -A 6` and delete exactly these two lines:

```typescript
    enemy: CombatActor;
    enemyId: string;
```

Then in `src/utils/combat/engine.ts`, find the supply site with `grep -n "enemyId: enemy.id" src/utils/combat/engine.ts` and delete both lines of the pair:

```typescript
                        enemy,
                        enemyId: enemy.id,
```

- [ ] **Step 8: Let tsc enumerate every remaining reader, and fix them**

```bash
npx tsc --noEmit
```

Expected: errors in roughly 30 test files that build an `IntentExecContext` literal — measured at `e8cdafdd` as 39 `enemyId:` lines across 23 files plus 55 `enemy:` lines across 25 files (overlapping). Each is a mechanical deletion of the now-excess property from the literal.

**If tsc reports an error in a non-test file you did not touch, stop and read it** — that is a fifth production reader, and finding one is the entire reason this step exists.

- [ ] **Step 9: Migrate the four tests that pin the deleted behaviour**

All four name the fallback in their own titles, so they are pinning behaviour this task deletes — not regressions.

In `src/utils/combat/__tests__/purgeReactive.test.ts`, rewrite case (a):

```typescript
    it('(a) NO-OPS when counterTargetId is absent (SP-4c-2d: was a fallback to ctx.enemyId)', () => {
        const { ctx, purgedCalls } = makePurgeCtx(1);
        executeIntent(makePurgeIntent(), ctx);
        expect(purgedCalls).toHaveLength(0);
    });
```

⚠️ **Cases (c) and (d) must ALSO change, and they are the dangerous ones — they will keep PASSING while becoming vacuous.** Both call `makePurgeIntent()` with no `counterTargetId`, so after this task the executor returns before reaching what they claim to test. (c) claims to test the `fromPurgeEvent` emission gate; (d) claims to test the `removed === 0` gate. Give both a real target so they test their own subject:

```typescript
    it('(c) does NOT emit when fromPurgeEvent is true, but removal still happens', () => {
        const { ctx, purgedCalls, emitted } = makePurgeCtx(1);
        // SP-4c-2d: counterTargetId is now REQUIRED for this case to reach the emission gate at
        // all — without it the executor no-ops and this test would pass vacuously.
        executeIntent(
            makePurgeIntent({ fromPurgeEvent: true, counterTargetId: 'routed-enemy' }),
            ctx
        );
        expect(purgedCalls).toHaveLength(1);
        expect(emitted).toHaveLength(0);
    });

    it('(d) does NOT emit when removed === 0', () => {
        const { ctx, emitted } = makePurgeCtx(0);
        // SP-4c-2d: same — a routed target is required or the no-op satisfies this vacuously.
        executeIntent(makePurgeIntent({ counterTargetId: 'routed-enemy' }), ctx);
        expect(emitted).toHaveLength(0);
    });
```

In `src/utils/combat/__tests__/purgeConditionalSources.test.ts`, rewrite the two fallback cases:

```typescript
    it('target:enemy NO-OPS when counterTargetId absent (SP-4c-2d: was ctx.enemyId)', () => {
        const { ctx, purgedCalls } = makeMostBuffsCtx(() => 'most-buffed-enemy');
        executeIntent(makeMostBuffsIntent({ target: 'enemy' }), ctx);
        expect(purgedCalls).toHaveLength(0);
    });

    it('target:enemy-most-buffs NO-OPS when the delegate returns undefined (SP-4c-2d)', () => {
        // This is Rhodium's shipped shape: no enemy carries a buff, so mostBuffsAmong returns
        // undefined. It used to purge the dummy; it now no-ops, matching the damage branch.
        const { ctx, purgedCalls } = makeMostBuffsCtx(() => undefined);
        executeIntent(makeMostBuffsIntent(), ctx);
        expect(purgedCalls).toHaveLength(0);
    });
```

Also re-tense the neighbouring title that still advertises the deleted fallback (it passes, because it supplies `counterTargetId`, but its name is now false — the comment-adjacency class from §10.6):

```typescript
    it('target:enemy resolves counterTargetId (most-buffs delegate unused)', () => {
```

- [ ] **Step 10: Run the tripwires — they must now pass**

```bash
npx vitest run src/utils/combat/__tests__/victimlessInflictionNoOp.test.ts
```

Expected: all four PASS.

- [ ] **Step 11: Prove the tripwires witness the rung**

Per 4c-2c's lesson — that rung shipped a tripwire which passed byte-identical against pre-rung semantics — a tripwire must be shown to **fail against the world it claims to have changed**.

Revert the four production guards only (Steps 3–6), keeping the tests, and re-run:

```bash
git stash push src/utils/combat/triggers.ts
npx vitest run src/utils/combat/__tests__/victimlessInflictionNoOp.test.ts
```

Expected: the two negative tests FAIL. Then restore:

```bash
git stash pop
```

**If they still pass with the guards reverted, the tripwires are vacuous — go back to Step 1.**

- [ ] **Step 12: Full verification**

```bash
npx vitest run 2>&1 | tail -5
npx tsc --noEmit
npm run lint
npm run audit:placement-symmetry -- --seeds 15 2>&1 | tail -8
```

Expected: all test files passing (533 + 1 new = 534), `tsc` clean, `lint` clean, oracle exactly `147 / 146 / 2`.

**Expected golden movement: ZERO.** §10.3 measured this: `realKitFingerprints.test.ts` does not move despite carrying 60 of the 73 purge-fallback hits, because the fingerprint is a token SET and Rhodium already emits its `purge` token from rounds where an enemy *is* buffed. If a `.snap` drifts, investigate — do not re-pin, and never `vitest -u`.

- [ ] **Step 13: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/engine.ts \
        src/utils/combat/__tests__/
git commit -m "$(cat <<'EOF'
feat(engine): a victimless reactive infliction is a no-op (SP-4c-2d 1/3)

Four reactive-executor branches fell back to the vestigial `enemy` dummy when the
triggering event stamped no victim. Spec §9.8 inventoried ONE of them; walking
IntentExecContext's `enemy`/`enemyId` by type found four, and the purge branch had a
SHIPPED consumer: Rhodium's end-of-round purge, whenever no enemy carried a buff
(mostBuffsAmong returns undefined there). Measured 73 hits across the suite.

All four now no-op, which is the rule the damage branch already documented. In-fight
effect: a Rhodium that used to spend its end-of-round purge on an invisible ghost now
correctly does nothing when there is nothing to purge — and its `damage` half, which
already returned on the same trigger and target, no longer disagrees with its purge half.

`enemy` and `enemyId` are DELETED from IntentExecContext rather than left unread, so tsc
proves no fifth reader survives.

Zero golden movement, oracle 147/146/2.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V65xi1NsFW1sP32DYcxqug
EOF
)"
```

---

## Task 2: The deletion (commit 2)

**Files:**
- Modify: `src/utils/combat/engine.ts` (clusters A/B/D/E/F/G, the dead turn body, the sentinel)
- Modify: `src/utils/combat/__tests__/retiredDummyTurn.test.ts`
- Modify: `src/utils/combat/__tests__/dummyReachability.test.ts`
- Modify: `src/utils/combat/__tests__/indestructibleDeath.test.ts`
- Create: `src/utils/combat/__tests__/sentinelActorIdReservation.test.ts`

**Interfaces:**
- Consumes: from Task 1, an `IntentExecContext` with no `enemy`/`enemyId` — so the drain path needs no further work here.
- Produces: `SENTINEL_ENEMY_ACTOR_ID` (a module-level `const` exported from `engine.ts`, value `'enemy'`). Task 3 does not consume it.

### The inventory, by grep anchor

§9.4's line numbers had already rotted at `e8cdafdd`. **Locate each item by its anchor:**

| Item | grep anchor | Advisory line |
| --- | --- | --- |
| the dummy actor (cluster A) | `id: 'enemy',` | `:1943` |
| the dead turn body | `} else if (actor.kind === 'enemy' && actor.id === enemy.id) {` | `:9970`–`:10057` |
| its ⛔ opening banner | `⛔ DEAD BRANCH SINCE SP-4c-2c` | `:9972` |
| `isDummyEnemy` binding | `const isDummyEnemy =` | `:8876` |
| dead-actor-skip exemption | `⛔ THE \`enemy\` DUMMY — DEAD SITE` | `:8846` |
| `dotCarrierActors` membership | `const dotCarrierActors: CombatActor[] = [enemy,` | `:2623` |
| `reservedActorIds` | `const reservedActorIds = new Set<string>([enemy.id,` | `:2566` |
| `turnOrderActors` | `const turnOrderActors = allActors.filter` | `:2807` |
| `hasPositionedEnemyRoster` | `const hasPositionedEnemyRoster =` | `:2803` |
| `enemyOutcome` return field | `enemyOutcome: {` | `:1821`, `:11760` |
| `enemyFinalHpPct` | `const enemyFinalHpPct =` | `:11741` |
| the round-tail HP-decline block | `const enemyHpDecline = cumulativeDamage` | `:11247` |

⚠️ **Three of the engine's own internal cross-references are stale**: comments reading *"see the banner at `:9957`"* point at a banner that is at `:9972`. Fix or delete them as you go; do not propagate them.

- [ ] **Step 1: Write the reservation pair (failing)**

Create `src/utils/combat/__tests__/sentinelActorIdReservation.test.ts`. §4.6 requires fencing the reservation in **both** directions — too loose lets a caller collide with the bucket id; too strict is a silent behaviour change.

```typescript
import { describe, it, expect } from 'vitest';
import { runCombat, SENTINEL_ENEMY_ACTOR_ID } from '../engine';

// SP-4c-2d §4.3: the dummy actor is gone, but the side-wide scheduled-debuff bucket still
// needs an id to emit `buff-expired` under. SENTINEL_ENEMY_ACTOR_ID keeps the literal 'enemy'
// so the event stream stays byte-identical across the deletion — the name is honest that it
// identifies a BUCKET, not a claim that an actor exists.
//
// The string must stay RESERVED. If a caller could name a real enemy attacker 'enemy', its
// events would interleave with the bucket's under one id — invisible in the log and
// impossible to attribute afterwards.

describe('SP-4c-2d: the sentinel id is reserved in both directions', () => {
    it('no ACTOR carries the sentinel id on any run', () => {
        const result = runCombat(/* any standard positional fixture */);
        expect(
            result.allActors.map((a) => a.id).filter((id) => id === SENTINEL_ENEMY_ACTOR_ID)
        ).toHaveLength(0);
    });

    it('runCombat still REJECTS an enemy attacker named with the sentinel id', () => {
        expect(() =>
            runCombat(/* same fixture, but one enemyAttacker given id SENTINEL_ENEMY_ACTOR_ID */)
        ).toThrow();
    });
});
```

- [ ] **Step 2: Run it — the first case must fail**

```bash
npx vitest run src/utils/combat/__tests__/sentinelActorIdReservation.test.ts
```

Expected: case 1 FAILS (the dummy actor still exists and carries `'enemy'`); case 2 PASSES already (the reservation is live today).

- [ ] **Step 3: Excise the already-dead code (no behaviour change)**

This step is intentionally behaviour-free — it removes code SP-4c-2c proved unreachable. Do it first so the risky part lands against a smaller file.

Delete, by anchor:
1. The whole `} else if (actor.kind === 'enemy' && actor.id === enemy.id) {` turn body, from the `else if` through the `⛔ END OF THE DEAD BRANCH` banner (`tickDoTs` / `processBombs` / `processAccumulators`, ~88 lines).
2. The `const isDummyEnemy =` binding and the ternary that reads it (provably always `false`).
3. The `!isDummyEnemy` conjunct in the dead-actor-skip guard, and the ⛔-bannered comment block documenting what it used to claim.
4. The dummy from `dotCarrierActors`: `[enemy, ...enemyAttackerActors]` becomes `[...enemyAttackerActors]`.

- [ ] **Step 4: Checkpoint — still green**

```bash
npx vitest run 2>&1 | tail -5
npx tsc --noEmit
```

Expected: unchanged from Task 1's result. **If anything moves here, one of the four items was not actually dead** — stop and investigate rather than adjusting a test.

- [ ] **Step 5: Introduce the sentinel and delete the actor (clusters A/D/G)**

Add near the top of `engine.ts`, beside the other module constants:

```typescript
/** SP-4c-2d §4.3: the id the side-wide scheduled-enemy-debuff bucket emits `buff-expired`
 *  under. The dummy actor that used to host that bucket is gone; the bucket is not. Keeping
 *  the literal 'enemy' keeps the event stream byte-identical across the deletion, and the
 *  name is honest about what it is — an id for a bucket, not a claim that an actor exists.
 *  Attributing the expiry to one positioned enemy instead would be the same lie `finalHpPct`
 *  told when it silently described only `enemyAttackers[0]`.
 *
 *  It stays RESERVED (see `reservedActorIds`): freeing the string would let a caller name a
 *  real enemy attacker 'enemy' and interleave its events with the bucket's under one id. */
export const SENTINEL_ENEMY_ACTOR_ID = 'enemy';
```

Then:
1. Delete the `createActor({ id: 'enemy', … })` call and the `enemy` binding (cluster A).
2. `reservedActorIds`: source the reservation from the constant — `new Set<string>([SENTINEL_ENEMY_ACTOR_ID, ...playerIds])`.
3. `turnOrderActors`: the filter has nothing left to exclude — `const turnOrderActors = allActors;` (or inline `allActors` at its use sites, whichever reads better after the actor is gone).
4. `hasPositionedEnemyRoster`: collapses to constant `true` (cluster G). Delete the binding and simplify its readers; the SP-4c-2a `MIN_TARGETABLE_MAX_HP` floor already made it constant.
5. Re-key the scheduled-debuff `buff-expired` emit to `SENTINEL_ENEMY_ACTOR_ID`.
6. The `[enemy.id]` condition-context defaults (cluster G) → `[SENTINEL_ENEMY_ACTOR_ID]` or delete, per what each site now means.

- [ ] **Step 6: Delete clusters B, E and F**

**Cluster B** — `dpsEnemyTarget` is `enemyAttackerInputs.length === 0`, which `normalizeCombatRoster` has made **provably constant false** since 4b-2b (it throws on an empty roster). Delete the flag and all three branches: the round-tail `applyVictimDamage(roundEnemyDamage, enemy, …)`, the `enemy.destroyedRound === undefined ? enemy.id : undefined` reactive-resolver arms, and the `dpsEnemyTarget && enemy.destroyedRound` break.

**Cluster E** — the round-tail `enemyHpDecline` block, the dummy's coarse integer `hp-changed` tap, `enemyFinalHpPct`, and the `enemyOutcome` return field. §4.1 records that `enemyOutcome` has had **no production consumer since 4b-2a** (`dpsSimulator` re-derives `survived`/`roundsToKill`/`finalHpPct` from its own `ship-destroyed` bus tap).

**Cluster F** — both `tgt.id !== enemy.id` context guards, the `victim.id !== enemy.id` HP-path backstop, and the `holder.id === enemy.id` skip.

- [ ] **Step 7: Handle the two test files per §9.5 — one dies, one MIGRATES**

In `src/utils/combat/__tests__/retiredDummyTurn.test.ts`:

- **Delete** the stranded-DoT test. It pins a dummy-specific hazard (a DoT pushed onto the dummy's containers never ticks, never expires, and is still reported by `dotCarrierActors`) and dies with the actor.
- **Migrate, do not delete,** the scheduled-decrement test. It pins something *not* dummy-specific: the round-tail decrement of a side-wide bucket that **outlives the actor that used to host it**. Only the reported `actorId` changes hosts — re-point the assertion at `SENTINEL_ENEMY_ACTOR_ID` and update the rationale comment to say the id denotes a bucket.

⚠️ CodeRabbit flagged a hand-off that contradicted this ruling once already. Do not delete the file wholesale.

In `src/utils/combat/__tests__/indestructibleDeath.test.ts`: delete the two `dpsEnemyTarget`-only cases (its header already marks them as such), keep the other four — they measure the real positioned enemy.

- [ ] **Step 8: Rework `dummyReachability.test.ts` and close its riding cleanups**

All six paths must keep a **positive half** — a `turn-started`, a `perTargetDealt` row naming the victim, a `ship-destroyed`, a changed victim id — so that a zero produced by a case which never ran its path stays impossible. This is the file's own stated standard in its header, and §9's riding list records four violations of it:

- the two cases with no positive half (weaker duplicates of FOCUS DAMAGE and CORPSE TARGETING) — give each one, or delete it as a duplicate
- the dead `DUMMY_HP` / `enemyHp: DUMMY_HP` scaffolding in the LIVENESS fixture — nothing has read it since the corrosion derivation went
- the one call site that bypasses the file's own `consultations()` helper — route it through

Then re-tense the file's remaining `dummyEnemyIsVestigial` references (the binding was deleted in 4c-2c; the symbol is stale everywhere).

- [ ] **Step 9: Run the reservation pair and the full suite**

```bash
npx vitest run src/utils/combat/__tests__/sentinelActorIdReservation.test.ts
npx vitest run 2>&1 | tail -5
npx tsc --noEmit
npm run lint
npm run audit:placement-symmetry -- --seeds 15 2>&1 | tail -8
```

Expected: reservation pair PASSES both directions; full suite green; `tsc` and `lint` clean; oracle `147 / 146 / 2`; **zero golden movement**.

- [ ] **Step 10: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/
git commit -m "$(cat <<'EOF'
refactor(engine): delete the dummy enemy actor (SP-4c-2d 2/3)

Clusters A/B/D/E/F/G per spec §4, plus §9.4's grep-invisible items: the ~88-line dead
turn body (spelled `actor.kind === 'enemy' && actor.id === enemy.id` inline, so an
`isDummyEnemy` grep misses it), the dead isDummyEnemy Post-Turn arm, the dead-actor-skip
exemption, and the dummy's dotCarrierActors membership.

The side-wide scheduled-debuff bucket outlives its host: SENTINEL_ENEMY_ACTOR_ID keeps the
literal 'enemy' so the event stream stays byte-identical, and the string stays RESERVED so
no caller can name a real enemy attacker into a collision with it. Fenced in both
directions per §4.6.

retiredDummyTurn's stranded-DoT test dies with the actor; its scheduled-decrement test
MIGRATES (§9.5) — the bucket is not dummy-specific, only its reported actorId was.

Zero golden movement, oracle 147/146/2.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V65xi1NsFW1sP32DYcxqug
EOF
)"
```

---

## Task 3: The editor guard (commit 3)

> ## ⛔ SUPERSEDED — READ THIS BEFORE FOLLOWING ANY STEP BELOW
>
> **Task 3 shipped as WARN-ONLY. Every instruction below that filters `TARGET_OPTIONS`, removes the
> `enemy` option, or recommends a replacement target is SUPERSEDED and must not be followed.**
> See spec §11.2–§11.3 for the measurement and the owner ruling.
>
> Why: this task's design rested on a list of "self-resolving" enemy targets that was **wrong for the
> `dot`/`debuff` branches**. In this engine, *"does target T resolve?"* is a question about the
> **executor branch**, not about T. Measured:
> - the **dot** branch consults `ability.target` only for an `all-enemies` fan-out gated on
>   `eventCtx.cleansedEnemyIds`, which a victimless trigger never stamps → on such a trigger **every**
>   target drops, `all-enemies` included;
> - the **debuff** branch resolves only `enemy-highest-attack`;
> - `TARGET_OPTIONS` does not even **offer** `enemy-highest-attack`.
>
> So there is no valid replacement target to steer a user toward: constraining the dropdown steers
> them nowhere, and the warning text drafted below ("for example 'All enemies' or 'Adjacent enemies'")
> is **false advice** — neither resolves on a victimless trigger. Blocking was therefore dropped in
> favour of warning, which is also `simCoverage.ts`'s own stated precedent ("warn, don't block, so real
> ship passives can still be documented ahead of sim support").
>
> **What actually shipped** (commit `9d627b4c`): `isVictimlessInfliction` in
> `src/components/skills/simCoverage.ts` + an inline warning in `AbilityCard.tsx`. **No dropdown is
> constrained** — a test pins that every Target option stays selectable. The predicate carries one
> load-bearing carve-out: **Selenite**'s passive is `debuff` + `start-of-round` +
> `enemy-highest-attack`, which genuinely resolves, so it must not be flagged.
>
> The steps below are kept for the record of what was planned, not as instructions.


**Files:**
- Modify: `src/components/skills/simCoverage.ts`
- Modify: `src/components/skills/AbilityCard.tsx`
- Modify: `src/components/skills/__tests__/simCoverage.test.ts`
- Modify: `src/components/skills/__tests__/AbilityCard.test.tsx`
- Modify: `src/constants/changelog.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–2 (this task touches no engine code).
- Produces: `isVictimlessInfliction(ability: Ability): boolean` and `VICTIMLESS_INFLICTION_WARNING: string`, both exported from `src/components/skills/simCoverage.ts`.

### Why this task exists

Task 1 made the engine drop a victimless infliction, which is correct but **silent**. The authoring surface must refuse the shape, or a user can still build it and watch it do nothing.

`SkillEditorModal` offers `start-of-round` in its trigger dropdown, and it is a member of `LIVE_TRIGGERS`, so it really fires. A user can author *"At the start of the round, inflict Corrosion II on an enemy"* — trigger `start-of-round`, type `dot`, target `enemy` — today. Before 4c-2c it ticked against an invisible ghost; since 4c-2c it applies, logs, reports stacks, and deals **zero**.

⚠️ **There is no save button to hook.** `SkillEditorModal` is live-edit — `onChange` fires per keystroke and the modal just closes. So the guard is *constrain the options* + *flag what is already stored*, per §10.5. Do not add a save gate; that was considered and rejected as converting a live-edit modal into a staged-edit one.

- [ ] **Step 1: Write the failing predicate tests**

Add to `src/components/skills/__tests__/simCoverage.test.ts`:

```typescript
import { isVictimlessInfliction } from '../simCoverage';
import type { Ability } from '../../../types/abilities';

describe('isVictimlessInfliction', () => {
    // SP-4c-2d: the engine now drops a dot/debuff whose trigger stamps no victim and whose
    // target names none either. The editor must not let that shape be authored.
    it('flags a start-of-round dot aimed at a bare `enemy`', () => {
        expect(
            isVictimlessInfliction({
                type: 'dot',
                trigger: 'start-of-round',
                target: 'enemy',
            } as Ability)
        ).toBe(true);
    });

    it('clears the same trigger when the target names a selector', () => {
        expect(
            isVictimlessInfliction({
                type: 'dot',
                trigger: 'start-of-round',
                target: 'enemy-highest-attack',
            } as Ability)
        ).toBe(false);
    });

    it('clears a bare `enemy` when the TRIGGER stamps a victim', () => {
        expect(
            isVictimlessInfliction({
                type: 'debuff',
                trigger: 'on-attacked',
                target: 'enemy',
            } as Ability)
        ).toBe(false);
    });

    it('ignores types that carry no infliction (damage routes via livingOpposingActorIds)', () => {
        expect(
            isVictimlessInfliction({
                type: 'damage',
                trigger: 'start-of-round',
                target: 'enemy',
            } as Ability)
        ).toBe(false);
    });
});
```

- [ ] **Step 2: Run — expect a missing-export failure**

```bash
npx vitest run src/components/skills/__tests__/simCoverage.test.ts
```

Expected: FAIL, `isVictimlessInfliction is not a function` / not exported.

- [ ] **Step 3: Implement the predicate**

Append to `src/components/skills/simCoverage.ts`:

```typescript
/**
 * Triggers whose listeners stamp NEITHER `victimId` NOR `counterTargetId` on the intent, so a
 * reactive infliction fired from them has no "that enemy" to land on. Read off the listener
 * bodies in `src/utils/combat/triggers.ts`; `on-deal-damage` is deliberately ABSENT — its
 * listener does stamp `victimId`.
 */
const VICTIMLESS_TRIGGERS: ReadonlySet<AbilityTrigger> = new Set([
    'start-of-round',
    'end-of-round',
    'start-of-turn',
    'end-of-turn',
]);

/**
 * Targets that resolve a victim on their own — via a selector or a fan-out — rather than from
 * the triggering event. A bare `enemy` is NOT one of them.
 */
const SELF_RESOLVING_ENEMY_TARGETS: ReadonlySet<AbilityTarget> = new Set([
    'enemy-highest-attack',
    'enemy-highest-speed',
    'enemy-most-buffs',
    'adjacent-enemies',
    'all-enemies',
    'target-and-adjacent-enemies',
]);

/** Infliction types whose reactive executor drops the application when no victim resolves
 *  (SP-4c-2d). `damage` is excluded: its branch resolves the first living opposing actor. */
const INFLICTION_TYPES: ReadonlySet<AbilityType> = new Set(['dot', 'debuff']);

export const VICTIMLESS_INFLICTION_WARNING =
    'This trigger does not identify an enemy, so "Enemy" cannot be resolved and nothing will be applied. Pick a target that names one — for example "All enemies" or "Adjacent enemies".';

/**
 * True when an ability would be silently dropped by the combat engine: an infliction on a
 * trigger that stamps no victim, aimed at a bare `enemy`.
 */
export function isVictimlessInfliction(ability: Ability): boolean {
    return (
        INFLICTION_TYPES.has(ability.type) &&
        VICTIMLESS_TRIGGERS.has(ability.trigger) &&
        !SELF_RESOLVING_ENEMY_TARGETS.has(ability.target)
    );
}
```

Add `AbilityTrigger` and `AbilityTarget` to the existing `../../types/abilities` import.

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/components/skills/__tests__/simCoverage.test.ts
```

Expected: all four PASS.

- [ ] **Step 5: Write the failing card tests**

Add to `src/components/skills/__tests__/AbilityCard.test.tsx` (copy the existing render harness in that file rather than inventing one):

```typescript
    it('omits the bare Enemy target option on a victimless trigger', () => {
        render(
            <AbilityCard
                {...baseProps}
                ability={
                    { type: 'dot', trigger: 'start-of-round', target: 'all-enemies' } as Ability
                }
            />
        );
        const targetSelect = screen.getByLabelText('Target');
        expect(
            Array.from(targetSelect.querySelectorAll('option')).map((o) => o.textContent)
        ).not.toContain('Enemy');
    });

    it('keeps the Enemy option when the trigger stamps a victim', () => {
        render(
            <AbilityCard
                {...baseProps}
                ability={{ type: 'dot', trigger: 'on-attacked', target: 'enemy' } as Ability}
            />
        );
        const targetSelect = screen.getByLabelText('Target');
        expect(
            Array.from(targetSelect.querySelectorAll('option')).map((o) => o.textContent)
        ).toContain('Enemy');
    });

    it('flags an ALREADY-SAVED ability that carries the dropped combination', () => {
        // The half the dropdown constraint cannot reach: this shape is already stored.
        render(
            <AbilityCard
                {...baseProps}
                ability={{ type: 'dot', trigger: 'start-of-round', target: 'enemy' } as Ability}
            />
        );
        expect(screen.getByText(VICTIMLESS_INFLICTION_WARNING)).toBeInTheDocument();
    });
```

- [ ] **Step 6: Run — expect three failures**

```bash
npx vitest run src/components/skills/__tests__/AbilityCard.test.tsx
```

Expected: the first and third FAIL; the second PASSES already.

- [ ] **Step 7: Constrain the dropdown and render the flag**

In `src/components/skills/AbilityCard.tsx`, import `isVictimlessInfliction` and `VICTIMLESS_INFLICTION_WARNING` from `./simCoverage`, then compute the option list beside the existing `TARGET_OPTIONS` use:

```tsx
                {/* SP-4c-2d: on a trigger that stamps no victim, a bare `enemy` cannot be
                    resolved and the engine drops the application. Remove the option rather
                    than let it be picked. */}
                options={
                    isVictimlessInfliction({ ...ability, target: 'enemy' } as Ability)
                        ? TARGET_OPTIONS.filter((o) => o.value !== 'enemy')
                        : TARGET_OPTIONS
                }
```

And render the flag next to the existing `PASSIVE_NOOP_WARNING` block, so both live-warning surfaces sit together:

```tsx
            {/* SP-4c-2d: reaches abilities ALREADY SAVED with the dropped combination — the
                dropdown constraint above only prevents new ones. */}
            {isVictimlessInfliction(ability) && (
                <p className="text-xs text-yellow-400">{VICTIMLESS_INFLICTION_WARNING}</p>
            )}
```

Note the guard is called with `target: 'enemy'` forced for the *dropdown* decision (asking "would `enemy` be droppable here?") and with the real ability for the *flag* decision (asking "is this ability droppable?"). Keep both — they answer different questions.

- [ ] **Step 8: Run — expect PASS**

```bash
npx vitest run src/components/skills/__tests__/AbilityCard.test.tsx src/components/skills/__tests__/simCoverage.test.ts
```

Expected: all PASS.

- [ ] **Step 9: Add the changelog entry**

In `src/constants/changelog.ts`, append to `UNRELEASED_CHANGES`. Per §9.7's trap, the claim is about the **editor**, not the engine — "reactive DoTs now work" would credit this rung with a fix the ladder already shipped:

```typescript
    'The skill editor now flags a passive that inflicts a DoT or debuff without naming a target — previously it saved silently and did nothing in the combat sim.',
```

- [ ] **Step 10: Verify and commit**

```bash
npx vitest run 2>&1 | tail -5
npx tsc --noEmit
npm run lint
```

Expected: green, clean, clean.

```bash
git add src/components/skills/ src/constants/changelog.ts
git commit -m "$(cat <<'EOF'
feat(skills): the editor rejects an infliction that names no target (SP-4c-2d 3/3)

Commit 1 made the engine drop a victimless dot/debuff, which is correct but silent. A user
could still author "At the start of the round, inflict Corrosion II on an enemy" in the
skill editor — start-of-round is a LIVE trigger — and watch the combat log report stacks
every round while their DPS number never moved.

SkillEditorModal is live-edit with no save gate, so the guard is two-sided: the Target
dropdown drops a bare `enemy` when the trigger stamps no victim, and an inline flag catches
abilities ALREADY SAVED with that combination, which the dropdown cannot reach.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V65xi1NsFW1sP32DYcxqug
EOF
)"
```

---

## Task 4: Sweep, whole-branch verification, PR

**Files:**
- Modify: whichever files the sweep finds
- Modify: `docs/superpowers/specs/2026-08-18-sp4c-match-end-and-delete-the-dummy-design.md` (measured-outcome amendment)

**Interfaces:**
- Consumes: the three commits from Tasks 1–3.
- Produces: the PR.

- [ ] **Step 1: Mechanical sweep — the closed symbol set**

Every mention of a deleted identifier is definitionally stale. This half is verifiable by a grep returning zero:

```bash
grep -rn "dummyEnemyIsVestigial\|isDummyEnemy\|dpsEnemyTarget\|enemyOutcome" src scripts --include='*.ts' --include='*.tsx'
```

Expected at `e8cdafdd` before the sweep: `dummyEnemyIsVestigial` 26 lines / 18 files (already stale since 4c-2c deleted the binding), plus the others. Delete or re-tense every hit. Re-run until it returns nothing.

- [ ] **Step 2: Judgment sweep — every file the diff touches**

```bash
git diff --name-only main...HEAD
```

For each file, audit its comments for claims this branch falsified. **This is where all four of 4c-2c's false-comment rounds landed** — comment adjacent to changed code.

Known candidates already recorded in §9's riding list:
- the triplicated rejected-alternative history (three copies of the same `dummyEnemyIsVestigial` rationale in `engine.ts`)
- the `"team -> attacker -> enemy"` tiebreak clause, now ambiguous
- `simGoldenFixtures.ts`'s "kept verbatim" paragraph, which then retenses itself
- the three internal cross-refs pointing at `:9957` for a banner at `:9972`
- the damage branch's `else`-arm comment listing `on-deal-damage` as having "no specific triggering enemy" — true *for that branch* (it never reads `victimId`) but easy to misread as a claim about the listener, which does stamp it

**Do not sweep the ~779 remaining "dummy" lines across 146 untouched files.** That was ruled out of scope: it would bury the deletion in review and destroy context that explains why the code looks as it does.

- [ ] **Step 3: Whole-branch verification**

```bash
npx vitest run 2>&1 | tail -5
npx tsc --noEmit
npm run lint
npm run audit:placement-symmetry -- --seeds 15 2>&1 | tail -8
git diff --stat main...HEAD
```

Expected: all files green, `tsc` clean, `lint` clean, oracle exactly `147 / 146 / 2`, **zero `.snap` files in the diffstat**.

- [ ] **Step 4: Re-measure and amend the spec with the outcome**

§10's numbers were measured at `e8cdafdd` before implementation. Record what actually happened — churn, any golden movement, the final counts — as a short §11. Per §9.1, a churn figure ages exactly the way a reachability claim does, so the amendment states its own measurement point.

```bash
git add -f docs/superpowers/specs/2026-08-18-sp4c-match-end-and-delete-the-dummy-design.md
git commit -m "docs(spec): SP-4c-2d measured outcome"
```

- [ ] **Step 5: Open the PR**

```bash
gh auth switch --user TheSusort
git push -u origin HEAD
gh pr create --title "SP-4c-2d: delete the dummy enemy, and stop the editor authoring what needed it" --body "$(cat <<'EOF'
Closes the SP-4c-2 ladder. Three commits:

1. **A victimless reactive infliction is a no-op.** Spec §9.8 inventoried one fallback site; walking `IntentExecContext`'s `enemy`/`enemyId` by type found four, and the purge branch had a shipped consumer — Rhodium's end-of-round purge, whenever no enemy carried a buff (73 measured hits). All four adopt the rule the damage branch already documented. The two fields are deleted from the interface, so `tsc` proves no fifth reader survives.
2. **The dummy actor is deleted.** Clusters A/B/D/E/F/G plus §9.4's grep-invisible items. `SENTINEL_ENEMY_ACTOR_ID` keeps the literal `'enemy'` for the side-wide scheduled-debuff bucket, still reserved, fenced in both directions.
3. **The skill editor refuses the shape.** Constrained target options plus a flag for already-saved abilities.

**In-fight effect:** a Rhodium that used to spend its end-of-round purge on an invisible ghost now correctly does nothing when there is nothing to purge — and stops disagreeing with its own damage half. A user-authored "start of round, inflict Corrosion on an enemy" passive can no longer be saved in a shape that silently does nothing.

Zero golden movement. Oracle `147 / 146 / 2`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01V65xi1NsFW1sP32DYcxqug
EOF
)"
```

- [ ] **Step 6: Verify CodeRabbit's reviewed range against HEAD**

⚠️ **A green CodeRabbit check does not mean it reviewed your latest commit.** This epic has been bitten twice by a green check whose reviewed range ended earlier — once from rate limiting (1 review/hour). Always diff the reported range against `HEAD` before trusting it, and say explicitly in the PR which commits went unreviewed if any did.

---

## Self-Review

**Spec coverage.** §10.1 four sites → Task 1 Steps 3–6. §10.2 field deletion → Step 7. §10.3 measured expectations → Steps 11–12. §10.4 corrected inventory → Task 2's anchor table. §10.5 editor guard → Task 3. §10.6 verification + sweep → Task 4 Steps 1–3. §10.7 scope boundaries → recorded in Task 1 Step 4 (`ctx.corrosionEntries` stays, 4d owns it) and not otherwise touched. §4 clusters A–G → Task 2 Steps 3, 5, 6. §4.3 sentinel → Task 2 Step 5. §4.6 test pair → Task 2 Steps 1–2. §9.5 one-dies-one-migrates → Task 2 Step 7.

**Known gap, deliberate.** The `runCombat` fixtures in Task 1 Step 1 and Task 2 Step 1 are marked `/* … */` rather than written out. Every attempt to write them from memory would risk the §9.6 trap where an invalid `TargetSelection` runs green under vitest and only `tsc` objects. The plan instead instructs the implementer to copy a working invocation from `dummyReachability.test.ts` and adapt it, and Step 2 of each task gates on the tripwire failing for the right reason. This is the one place the plan trades literal code for a verification gate.

**Type consistency.** `isVictimlessInfliction(ability: Ability): boolean` and `VICTIMLESS_INFLICTION_WARNING: string` are defined in Task 3 Step 3 and used with those exact names in Steps 5 and 7. `SENTINEL_ENEMY_ACTOR_ID` is defined in Task 2 Step 5 and imported under that name in Task 2 Step 1. `IntentExecContext` (not "DrainContext", which is only the informal name in the spec) is the real interface name used throughout Task 1.
