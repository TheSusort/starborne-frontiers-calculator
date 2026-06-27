# Enemy-side Cleanse Lift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the enemy-side event-only cleanse stub so an enemy ship's on-cast cleanse actually removes player-applied debuffs from itself/its allies, symmetric to the already-shipped E5 enemy-heal lift and #166 enemy-shield lift.

**Architecture:** Unify the two arms of the cleanse branch in `runPlayerTurn`'s heal/shield/cleanse loop. Both player and enemy paths call the already-side-agnostic `statusEngine.cleanse(rid)` over the already-side-aware `recipientsFor(ability.target)` recipients; the ONLY remaining side-difference is suppressing the player-facing `cleanseCount` metric credit on the enemy path. The `cleanse-performed` emit guard (`> 0`) is unchanged, so the event now reflects real removal on both sides.

**Tech Stack:** TypeScript, Vitest, the combat engine under `src/utils/combat/`.

---

## Background (read before starting)

- Spec: `docs/superpowers/specs/2026-06-27-enemy-cleanse-lift-design.md`
- Handoff: `docs/superpowers/handoffs/2026-06-27-enemy-cleanse-lift-handoff.md`
- The locked principle is **team-symmetry**: an enemy `else`-stub that removes nothing while the player path removes is a bug. Memory `feedback_engine_team_symmetry`.
- **Branch:** stack on the current `feat/combat-enemy-oncast-self-shields` (#166) tip. Create the work branch off it. Rebase onto `main` once #165/#166 merge.
- **Workflow gotchas:** `gh auth switch --user TheSusort` if `gh` is the wrong account. Husky pre-commit runs the full vitest suite. **Never `vitest -u`** (don't auto-update goldens). `docs/` is gitignored → `git add -f` to track spec/plan.

### Verified facts (don't re-investigate)

- `statusEngine.cleanse(actorId, count)` → `removeNewestFirst(actorId, 'debuffs', count)` reads `enemyMaps.get(actorId)` + `accumEnemyMaps.get(actorId)` — side-agnostic, keyed by actor id (`statusEngine.ts:1002-1003`, `968-997`). No new primitive needed.
- In the positional sim, player-applied debuffs on an enemy land in `enemyMaps` keyed by that enemy's **real actor id** (`playerTurn.ts:987` passes `targetId`; `engine.ts:3618` sets `targetId: tgt.id`).
- An enemy self-cleanse resolves recipients via `recipientsFor` (`playerTurn.ts:1709-1718`): `self → [actor.id]`, `all-allies → enemyIds`, single `ally → lowestHpEnemyAllyId()`. The same id keys `enemyMaps` → cleanse finds the player-applied debuff.

---

## File Structure

- **Modify:** `src/utils/combat/playerTurn.ts` (~lines 2002–2017) — the cleanse branch. The one production change.
- **Create:** `src/utils/combat/__tests__/enemyCleanse.integration.test.ts` — positional two-team end-to-end test (mirrors `enemyOnCastShield.integration.test.ts`).
- **Modify:** `src/utils/combat/__tests__/enemyActions.test.ts` — the existing event-only emission test that moves under the lift, plus a new partial-removal case and an explicit negative control.
- **Modify:** `src/constants/changelog.ts` — one `UNRELEASED_CHANGES` line.

---

## Task 1: Failing integration test for the enemy cleanse lift

Mirror `enemyOnCastShield.integration.test.ts`. The player (focus, speed 200) applies a removable debuff to the enemy each round, then the enemy (speed 50) casts a `cleanse count: 2` on its turn. The distinguishing observable is the `cleanse-performed` **count**: the old stub emits the nominal `2`; the lift emits the **real removed `1`**. The negative control (no debuff applied → no event) doubles as the cadence-change assertion.

**Files:**
- Create: `src/utils/combat/__tests__/enemyCleanse.integration.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
/**
 * enemyCleanse.integration.test.ts — enemy on-cast cleanse removal (positional two-team sim).
 *
 * Symmetric counterpart to E5's enemy HEAL lift and #166's enemy SHIELD lift: an enemy ship's
 * on-cast CLEANSE ability now REMOVES debuffs the player applied to it (and emits a
 * cleanse-performed reflecting the REAL removed count) — previously the enemy arm of the cleanse
 * branch removed nothing and bumped the count by the nominal cfg.count.
 *
 * Distinguishing observable: the player applies ONE removable debuff and the enemy cleanses
 * count: 2. PRE-FIX the stub emits cleanse-performed { count: 2 } (nominal) and removes nothing;
 * POST-FIX it emits { count: 1 } (real removal). The negative control (no debuff applied → no
 * cleanse-performed) is the explicit cadence-change guard (old stub always fired).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import type { ShipSkills, Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type CleansePerformed = Extract<CombatEvent, { type: 'cleanse-performed' }>;

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// Player active: a damage hit PLUS a removable debuff ('Attack Down', application 'apply' → lands
// with no affinity disadvantage) onto the positionally-anchored front enemy.
const damageThenDebuff = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'ec-basic',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
        {
            id: 'ec-debuff',
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: 'Attack Down',
                parsedEffects: { attack: -30 },
                stacks: 1,
                isStackable: false,
                application: 'apply',
                duration: 5,
            },
        } as unknown as Ability,
    ],
});

const damageOnly = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'ec-basic',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
    ],
});

// Enemy whose ACTIVE cleanses up to `count` debuffs off itself (no damage).
const selfCleanseSkills = (count: number): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'enemy-oncast-cleanse',
                    type: 'cleanse',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'cleanse', count },
                },
            ],
        },
    ],
});

const enemyAt = (id: string, position: Position, shipSkills: ShipSkills): EnemyAttacker =>
    ({
        id,
        stats: { attack: 1_000, crit: 0, critDamage: 0, defence: 0, hp: 40_000, speed: 50 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills,
    }) as EnemyAttacker;

// Player FOCUS at M4 fires `front` (anchors the enemy at M4) and acts FIRST (speed 200), immortal.
const playerVsEnemy = (
    playerSlot: ShipSkills['slots'][number],
    enemies: EnemyAttacker[],
    overrides: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [playerSlot] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    speed: 200,
    healTargetId: 'attacker',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: enemies,
    ...overrides,
});

describe('enemy on-cast cleanse: removes a player-applied debuff (real removed count)', () => {
    it('POSITIVE: player applies 1 debuff, enemy cleanses count 2 → cleanse-performed { count: 1 }', () => {
        const bus = createEventBus();
        const events: CleansePerformed[] = [];
        bus.on('cleanse-performed', (e) => {
            if (e.type === 'cleanse-performed') events.push(e);
        });
        runCombat(
            playerVsEnemy(damageThenDebuff(), [enemyAt('foe', 'M4', selfCleanseSkills(2))], { bus })
        );
        // The enemy's own cleanse-performed, keyed on the enemy id.
        const enemyCleanse = events.filter((e) => e.casterId === 'foe');
        expect(enemyCleanse.length).toBe(1);
        // REAL removal (1) — NOT the nominal cfg.count (2). PRE-FIX this is 2 and the test fails.
        expect(enemyCleanse[0].count).toBe(1);
    });

    it('NEGATIVE control: enemy cleanses with NO debuff applied → no cleanse-performed (cadence)', () => {
        const bus = createEventBus();
        const events: CleansePerformed[] = [];
        bus.on('cleanse-performed', (e) => {
            if (e.type === 'cleanse-performed') events.push(e);
        });
        runCombat(
            playerVsEnemy(damageOnly(), [enemyAt('foe', 'M4', selfCleanseSkills(2))], { bus })
        );
        // Nothing to remove → real count 0 → NO event. PRE-FIX the stub fires { count: 2 } and fails.
        expect(events.filter((e) => e.casterId === 'foe')).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails against current code**

Run: `npx vitest --run src/utils/combat/__tests__/enemyCleanse.integration.test.ts`
Expected: BOTH cases FAIL — positive expects `count` 1 but gets 2 (nominal stub); negative expects 0 events but the stub fired one with `count: 2`.

> If instead the positive case fails because `enemyCleanse.length` is 0 (no event at all), STOP — that means the enemy cleanse isn't running through the event-only stub in this harness; re-verify the player→enemy debuff actually landed (the `damageThenDebuff` ability) and that the enemy acts. Do not proceed to Task 2 until the failure is the EXPECTED nominal-vs-real-count failure.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/utils/combat/__tests__/enemyCleanse.integration.test.ts
git commit -m "test(combat): failing enemy on-cast cleanse-lift integration test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Note: the husky pre-commit runs the full suite and this test fails by design. Use `--no-verify` for THIS commit only (the failing-test commit), matching the epic's cadence (`19dbbd24 test(combat): failing enemy on-cast self-shield integration test`). Re-enable the hook for all later commits.

```bash
git commit --no-verify -m "test(combat): failing enemy on-cast cleanse-lift integration test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Implement the lift

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (~lines 2002–2017)

- [ ] **Step 1: Replace the cleanse branch with the unified version**

Find this block (the `else if (cfg.type === 'cleanse')` arm of the heal/shield/cleanse loop):

```ts
            } else if (cfg.type === 'cleanse') {
                // Real removal is player-side only (recipientsFor returns player ids; enemy-side
                // actors run event-only and side-correct enemy routing is deferred). The metric
                // and the cleanse-performed event reflect the ACTUAL number removed.
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

Replace it with:

```ts
            } else if (cfg.type === 'cleanse') {
                // Team-symmetric removal: BOTH the player path and the enemy (event-only) path
                // remove real debuffs via the side-agnostic statusEngine.cleanse over the
                // side-aware recipientsFor recipients (self/ally/all-allies). cleansePerformedCount
                // reflects the ACTUAL removed count on both sides, so the cleanse-performed emit
                // (guarded `> 0`) now fires only on real removal — symmetric to the E5 heal lift and
                // the #166 shield lift. The ONLY side-difference is the player-facing cleanseCount
                // metric: the enemy event-only path suppresses it (mirrors E5/#166 credit suppression).
                let removed = 0;
                for (const rid of recipientsFor(ability.target)) {
                    removed += statusEngine.cleanse(rid, cfg.count);
                }
                cleansePerformedCount += removed;
                if (!healEventOnly) healing.credit(actor.id, 'cleanseCount', removed);
            }
```

- [ ] **Step 2: Run the Task 1 integration test — verify it passes**

Run: `npx vitest --run src/utils/combat/__tests__/enemyCleanse.integration.test.ts`
Expected: BOTH cases PASS (positive `count` 1; negative 0 events).

- [ ] **Step 3: Run the broader combat suite — verify no golden movement + spot the moving assertion test**

Run: `npx vitest --run src/utils/combat`
Expected: the ONLY failures are in `enemyActions.test.ts` (the event-only emission test that asserts the old nominal cadence — fixed in Task 3). **ZERO `.snap` movement.** If any OTHER assertion test fails, STOP and investigate (it indicates an unanticipated fixture with an enemy cleanser).

- [ ] **Step 4: Commit the lift**

```bash
git add src/utils/combat/playerTurn.ts
git commit -m "feat(combat): lift enemy on-cast cleanse removal (symmetric to E5/shield lifts)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> The husky hook will run the full suite; the known `enemyActions.test.ts` failures from this lift mean the hook blocks. Commit with `--no-verify` here (the suite is green except for the deliberately-stale assertions fixed in the very next task), OR reorder to land Task 3 first. RECOMMENDED: do Task 3 before committing Task 2, then make ONE combined commit. See Task 3 Step 5.

---

## Task 3: Update + extend `enemyActions.test.ts`

The "E5: enemy heal RESTORES HP…" test (~line 405) asserts `cleanse.count === 2` but seeds no debuffs on the cleanse recipient. Under the lift, real removal = 0 → no `cleanse-performed` → assertions at ~420–422 fail. Seed 2 removable debuffs on the recipient so real removal = 2 and the assertion holds. Then add a partial-removal case and an explicit negative control.

The cleanse ability in `healCleanseSkills()` targets `'ally'`; for this enemy runtime `recipientsFor('ally')` → `lowestHpEnemyAllyId()` → `'enemy1'` (the sole `enemyIds` entry). So seed the debuffs on `'enemy1'`.

**Files:**
- Modify: `src/utils/combat/__tests__/enemyActions.test.ts`

- [ ] **Step 1: Add a timed-debuff seeding helper near the top of the `Phase 4c PR 4 Task 5a` describe block**

Add this helper (mirrors `cleanseRemoval.test.ts`'s `mkTimed`) inside the describe, before the `it(...)` blocks. Extend the existing statusEngine import to bring in the type — use the inline `type` modifier to stay clean under `verbatimModuleSyntax`: `import { createStatusEngine, type RegisteredAbilityStatus } from '../statusEngine';` (adapt to whatever the file's current statusEngine import line is):

```ts
    // Minimal enemy-side timed debuff to seed onto a recipient's per-actor debuff store, so an
    // enemy cleanse has something REAL to remove. Shape mirrors cleanseRemoval.test.ts's mkTimed.
    const mkTimedDebuff = (
        buffName: string
    ): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
        kind: 'timed',
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        duration: 5,
        payload: { buffName, stacks: 1, parsedEffects: {} },
    });
```

- [ ] **Step 2: In the "E5: enemy heal RESTORES HP…" test, seed 2 debuffs on `'enemy1'` before `runPlayerTurn`**

After `const args = makeArgs(makeRuntime(healCleanseSkills(), 'enemy'), spy.healing, true);` and before `runPlayerTurn(args);`, insert:

```ts
        // Seed two removable debuffs on the cleanse recipient (enemy1 — the lowest-HP enemy ally
        // the 'ally'-targeted cleanse routes to) so the lift removes a REAL count of 2.
        args.statusEngine.applyTimedAbilityStatus(1, mkTimedDebuff('Attack Down'), 'attacker', 'enemy1');
        args.statusEngine.applyTimedAbilityStatus(1, mkTimedDebuff('Defense Down'), 'attacker', 'enemy1');
```

The existing assertions (`cleanse!.count === 2`, etc.) now hold because real removal = 2. Update the inline comment on the count assertion if present to read "REAL removal of the 2 seeded debuffs (not the nominal cfg.count)".

- [ ] **Step 3: Add a partial-removal test (count 2, only 1 debuff → event count 1)**

Add a new `it(...)` in the same describe block:

```ts
    it('lift: enemy cleanse count 2 against ONE seeded debuff emits cleanse-performed { count: 1 }', () => {
        const events: CombatEvent[] = [];
        const spy = makeHealingSpy();
        const args = makeArgs(makeRuntime(healCleanseSkills(), 'enemy'), spy.healing, true);
        // Only ONE removable debuff exists → real removal clamps to 1, NOT the nominal cfg.count 2.
        args.statusEngine.applyTimedAbilityStatus(1, mkTimedDebuff('Attack Down'), 'attacker', 'enemy1');
        args.bus.on('cleanse-performed', (e) => events.push(e));

        runPlayerTurn(args);

        const cleanse = events.find((e) => e.type === 'cleanse-performed');
        expect(cleanse).toBeDefined();
        expect(cleanse!.casterId).toBe('enemy1');
        expect(cleanse!.count).toBe(1);
        // Still no player metric credit on the enemy path.
        expect(spy.credits).toHaveLength(0);
    });
```

- [ ] **Step 4: Add an explicit negative control (no debuff → no cleanse-performed)**

Add another `it(...)`:

```ts
    it('lift: enemy cleanse with NO seeded debuff removes nothing and emits no cleanse-performed', () => {
        const events: CombatEvent[] = [];
        const spy = makeHealingSpy();
        const args = makeArgs(makeRuntime(healCleanseSkills(), 'enemy'), spy.healing, true);
        // No debuffs seeded on enemy1 → real removal 0 → cleanse-performed must NOT fire (cadence
        // change from the old stub, which always fired by nominal count).
        args.bus.on('cleanse-performed', (e) => events.push(e));

        runPlayerTurn(args);

        expect(events.find((e) => e.type === 'cleanse-performed')).toBeUndefined();
        expect(spy.credits).toHaveLength(0);
    });
```

- [ ] **Step 5: Run `enemyActions.test.ts` + the integration test — verify the lift cases pass**

Run: `npx vitest --run src/utils/combat/__tests__/enemyActions.test.ts src/utils/combat/__tests__/enemyCleanse.integration.test.ts`
Expected: the E5-seeded, partial, and negative cases PASS. The pre-existing "Task 5b" Grif test in `enemyActions.test.ts` will still FAIL here — it is handled in Task 3b below. Do NOT commit yet.

---

## Task 3b: Reconcile the pre-existing "Task 5b" Grif test with the symmetric cadence

**Why this exists:** `enemyActions.test.ts` has a pre-existing test (the `Phase 4c PR 4 Task 5b` describe, ~line 705, `it('enemy cleanse cast emits cleanse-performed (enemy id), no player credit, Grif procs')`) that asserts the OLD always-fire cadence: an enemy whose active is `cleanse self count:1` — **with no debuff ever applied to it** — fires `cleanse-performed` every round and drives a focus-player Grif `on-enemy-cleansed` damage proc (`grifDamage === perRoundProc * 3`). Under the lift, a no-op enemy cleanse removes nothing → no `cleanse-performed` → no Grif proc. This is the exact open-Q2 Arum/Grif reactor behavior change the spec approved (full symmetry). The fix splits cleanly: (a) the old test's harness already models "enemy cleanse with nothing to remove", so it becomes the NEGATIVE/cadence assertion; (b) the positive Grif chain (proc fires on a REAL removal) moves to the positional integration test, where landing a debuff on the enemy already works (Task 1's harness).

Key facts (verified): `creditReactiveDamage(ownerId, amount)` → `creditDamage(ownerId, 'direct', amount)` (engine.ts:3904), so a Grif `on-enemy-cleansed` proc credits the `direct` bucket → surfaces in `result.rounds[r].directDamage` on BOTH paths. A positional player's own ATTACK damage credits the per-target bucket (`perTargetDamage`), NOT `directDamage` — so reading `directDamage` isolates the Grif reactive even when the focus also attacks.

**Files:**
- Modify: `src/utils/combat/__tests__/enemyActions.test.ts` (the Task 5b test)
- Modify: `src/utils/combat/__tests__/enemyCleanse.integration.test.ts` (add a Grif positive case)

- [ ] **Step 1: Retarget the Task 5b test to assert the new symmetric cadence**

Update the existing `it('enemy cleanse cast emits cleanse-performed (enemy id), no player credit, Grif procs')` (~line 755) to reflect that a no-op enemy cleanse now removes nothing → no event → no Grif proc. Keep the no-player-credit assertion (still true). Rename the `it(...)` title to describe the new behavior, e.g. `'enemy cleanse with nothing to remove emits NO cleanse-performed and does not proc Grif (symmetric cadence)'`. Replace the three assertion blocks (the `cleanseEvents`, the `enemyRows` credit check, and the `grifDamage` block at ~lines 792–819) with:

```ts
        // SYMMETRIC CADENCE: the enemy cleanse has nothing to remove (no debuff was applied to
        // enemy1), so real removal is 0 → NO cleanse-performed fires (matches the player path).
        const cleanseEvents = events.filter((e) => e.type === 'cleanse-performed');
        expect(cleanseEvents).toHaveLength(0);

        // The enemy credited NO player healing buckets under its own id (unchanged by the lift).
        const enemyRows = (result.healing?.rounds ?? []).map((rd) => rd.perActor.get('enemy1'));
        for (const row of enemyRows) {
            if (!row) continue;
            expect(row.cleanseCount ?? 0).toBe(0);
            expect(row.directHeal ?? 0).toBe(0);
            expect(row.effectiveHeal ?? 0).toBe(0);
        }

        // No cleanse-performed → the focus's on-enemy-cleansed Grif proc never fires → no damage.
        const grifDamage = result.rounds.reduce((sum, rd) => sum + rd.directDamage, 0);
        expect(grifDamage).toBe(0);
```

Update the describe-block header comment (~lines 700–704) to note the test now asserts the no-removal cadence; the positive Grif chain lives in `enemyCleanse.integration.test.ts`.

- [ ] **Step 2: Add a Grif positive case to the positional integration test**

In `src/utils/combat/__tests__/enemyCleanse.integration.test.ts`, add a focus-side Grif `on-enemy-cleansed` damage passive to a player who ALSO applies a removable debuff to the enemy, so the enemy's real cleanse drives the proc. Add a new `it(...)` in a new describe block. Build a player slot list = the existing `damageThenDebuff()` active PLUS a Grif passive:

```ts
const grifPassive = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: 'ec-grif',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-enemy-cleansed',
            conditions: [],
            config: { type: 'damage', multiplier: 200, noCrit: true },
        } as unknown as Ability,
    ],
});

describe('enemy on-cast cleanse: drives a focus on-enemy-cleansed (Grif) proc on REAL removal', () => {
    it('enemy removes a player-applied debuff → focus Grif on-enemy-cleansed proc fires', () => {
        const input = playerVsEnemy(damageThenDebuff(), [enemyAt('foe', 'M4', selfCleanseSkills(2))]);
        // Inject the Grif passive alongside the player's debuff active.
        input.shipSkills = { slots: [damageThenDebuff(), grifPassive()] };
        const result = runCombat(input);
        // The Grif on-enemy-cleansed reactive credits the 'direct' bucket (creditReactiveDamage →
        // creditDamage(_, 'direct', _)). The player's OWN attack credits perTargetDamage, so
        // directDamage isolates the proc. Real removal happened → proc fired → directDamage > 0.
        const grifDamage = result.rounds.reduce((sum, rd) => sum + rd.directDamage, 0);
        expect(grifDamage).toBeGreaterThan(0);
    });
});
```

> If `damageThenDebuff`/`playerVsEnemy`/`selfCleanseSkills` are defined inside another describe's scope, hoist the helpers to module scope (or duplicate minimally) so this new describe can use them. Keep it compiling and DRY.

- [ ] **Step 3: Verify the whole combat suite is green with ZERO `.snap` movement**

Run: `npx vitest --run src/utils/combat`
Expected: 0 failed. Confirm `git status --porcelain | grep '\.snap'` is empty. Then `npx tsc --noEmit` clean.

- [ ] **Step 4: Single combined commit (lift + all test changes)**

The working tree now holds: the lift (`playerTurn.ts`), the `enemyActions.test.ts` changes (E5 seeding + partial + negative + the retargeted Task 5b), and the integration-test Grif addition. Husky runs the full suite on commit — it should pass now, so do NOT use `--no-verify`.

```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/__tests__/enemyActions.test.ts src/utils/combat/__tests__/enemyCleanse.integration.test.ts
git commit -m "feat(combat): lift enemy on-cast cleanse removal (symmetric to E5/shield lifts)

Enemy cleanse abilities now remove player-applied debuffs via the side-agnostic
statusEngine.cleanse over side-aware recipients; cleanse-performed reflects the REAL
removed count on both sides. Player cleanseCount metric suppressed on the enemy path.
A no-op enemy cleanse no longer fires cleanse-performed (symmetric cadence) — the
on-enemy-cleansed Grif chain now requires a real removal.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Changelog, docs, and final verification gates

**Files:**
- Modify: `src/constants/changelog.ts`

- [ ] **Step 1: Add a changelog line**

Insert a new entry into the `UNRELEASED_CHANGES` array in `src/constants/changelog.ts` (append after the last existing string, before the closing `];`):

```ts
    'Combat simulator: enemy ships that cast a cleanse skill now actually remove the debuffs you applied to them, instead of the cleanse having no effect. Skills that trigger off an enemy being cleansed (such as Arum and Grif) now fire only when a debuff is really removed.',
```

- [ ] **Step 2: Check in-app docs**

Open `src/pages/DocumentationPage.tsx` and search for any combat/cleanse description that claims enemy cleanses are inert or unsupported. If present, update it to reflect that enemy cleanses now remove debuffs. If there's no such mention, no change is needed (note this in the task summary).

- [ ] **Step 3: Run the full verification gates**

```bash
npx tsc --noEmit            # clean
npm run lint                # 0 warnings
npm run audit:skills        # 141/0
npx vitest --run src/utils/combat   # 0 failed, ZERO .snap movement
```

Expected: all clean. If `audit:skills` is not 141/0, STOP — the parser corpus is unrelated to this change and a delta means something else moved.

- [ ] **Step 4: Run the complete test suite once (husky parity)**

Run: `npm test`
Expected: 0 failed tests. (If a fresh worktree: copy the main repo's `.env` first or ~14 `.tsx` files fail to *collect* — that's 0 failed tests, a collection error, not a regression.)

- [ ] **Step 5: Commit changelog/docs**

```bash
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs(combat): changelog + docs for enemy cleanse lift

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(Drop `DocumentationPage.tsx` from the `git add` if Step 2 made no change.)

---

## Done criteria

- `enemyCleanse.integration.test.ts` positive (real count 1) + negative (no event) pass; reverting the lift fails exactly those.
- `enemyActions.test.ts` E5 test passes via 2 seeded debuffs; partial-removal (count 1) and negative-control cases pass.
- `cleanseCastPath.test.ts` and all other combat tests stay byte-identical / green; ZERO `.snap` movement.
- `tsc` clean, lint 0 warnings, `audit:skills` 141/0, full suite 0 failed.
- Changelog line added.
