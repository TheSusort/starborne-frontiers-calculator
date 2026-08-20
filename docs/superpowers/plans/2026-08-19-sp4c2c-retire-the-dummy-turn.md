# SP-4c-2c — Retire the Dummy's Turn: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The vestigial dummy `enemy` actor stops taking turns entirely, and the side-wide scheduled-enemy-debuff decrement it used to host runs unconditionally at the round tail.

**Architecture:** Two one-line switches in `engine.ts` (`turnOrderActors` drops the dummy unconditionally; the D5 `decrementEnemy()` block loses its `if`), which orphans the `dummyEnemyIsVestigial` binding and kills the last route into `dummySinkCreditCount`. Because that counter can then no longer be made to move by anything in the suite, it is deleted in this rung rather than left as an unfalsifiable zero for 4c-2d to gate on. Two new tripwires pin the hazards the retirement creates.

**Tech Stack:** TypeScript, Vitest, the existing `src/utils/combat/__testutils__/` fixtures (`bareRosterFixture`, `turnOrderTap`).

**Spec:** `docs/superpowers/specs/2026-08-18-sp4c-match-end-and-delete-the-dummy-design.md` §7.4 (the rung table), §8.3–8.4 (what 4c-2b handed over).
**Predecessor plan:** `docs/superpowers/plans/2026-08-19-sp4c2b-no-victim-player-turn.md`.

---

## 0. MEASURED FACTS — read this before anything else

Every number below was measured on `main` @ `f1bce838` by applying the two switches on a scratch
basis and running the full suite + the oracle. **Do not re-derive them from the spec; the spec is
stale here.** (This is spec §7.5's own rule: *a claim about whether a path is reachable is a
measurement, not a reading.*)

| Claim | Spec §7.4 said | MEASURED on `f1bce838` |
| --- | --- | --- |
| Churn | "3,883 no-op turn events across 73 files, 3 of them golden suites" | **2 failing tests in 2 files.** 5,890 / 5,892 still pass |
| Golden movement | 3 golden suites move | **ZERO.** `src/utils/combat/audit/__tests__/{fingerprint,kitFingerprintScenarios,placementSymmetry,ablation}.test.ts` all green, untouched |
| Oracle | not stated | **Exact baseline** — `npm run audit:placement-symmetry -- --seeds 15` → `147 / 146 / 2` |

The spec's estimate was taken at `8d2c2a61` — *before* 4c-2a floored the 0-max-HP pressure source and
*before* 4c-2b stopped the player side consulting the ghost. Those two rungs did the work the
turn-order deletion was expected to do. **Record this correction in the spec (Task 4); do not silently
let a wrong number stand.**

### 0.1 The two tests that move, and why each is exactly the right one

1. `src/utils/combat/__tests__/dummyEnemyTurnGate.test.ts` → *"a player actor with an ALLY-side
   target: the dummy enemy still takes its tick turn"* — `expected 0 to be greater than 0`. This
   test's entire subject is the gate this rung retires.
2. `src/utils/combat/__tests__/dummyReachability.test.ts` → the `LIVENESS` case —
   `expect(result.rounds[0].corrosionDamage).toBe(500)` reads **0**, and `credited` drops from
   `BARE_ROUNDS` to 0.

### 0.2 THE LOAD-BEARING FINDING: this rung kills the credit counter's last liveness proof

`dummySinkCreditCount` is the counter §8.4 nominates as 4c-2d's deletion gate. Its doc names two
routes into the scalar channel that feeds it: route 1 (the `dpsEnemyTarget` branch) is unreachable by
contract since 4b-2b throws on an empty roster, and route 2 (the dummy's own DoT-tick turn) is what
**this rung retires**.

Measured, not reasoned — a `console.error` at the increment site (`engine.ts:11245`) with both
switches applied, over the whole suite:

```console
$ npx vitest run --reporter=basic 2>&1 | grep -c "DUMMY_CREDIT_SITE_REACHED"
0
```

**Nothing in 532 files can make the counter move any more.** A counter whose zero cannot be falsified
is not evidence — it is precisely the fixture-vacuity defect class this repo has been bitten by
before (`project_real_kit_golden_fingerprints`: green, deterministic, observing nothing). So this
rung DELETES it, and replaces the file's guarantee with a structural, falsifiable one.

⚠️ **State the claim precisely.** The correct claim is **"corpus-dead: no shape the suite can build
reaches the site"**, NOT "structurally unreachable". The increment sits in the round-tail vestigial-sink
`else` branch keyed on `totalRoundDamage + teamRoundDamage > 0` — it is *not* inside the dummy's turn
body. It is syntactically reachable by any future change that routes scalar damage again. This is the
same distinction the counter's own doc already draws ("no SHIPPED caller reaches the sink", not "the
sink is unreachable"). Do not overstate it in a comment, a commit message, or the changelog.

### 0.3 `legacyVictimFallbackCount` SURVIVES this rung untouched

The *other* counter keeps a live, non-zero home:
`src/utils/combat/__tests__/damageChannelAccounting.integration.test.ts:422` reads
`expect(__getLegacyVictimFallbackCount()).toBe(ROUNDS)` on a never-targetable **player** roster.
That reading is enemy-side (the heal-target binding) and is **rung 4e's** business, not this one's.
**Do not touch `legacyVictimFallbackCount`, its exports, or its readers.**

### 0.4 Two hazards the retirement creates — both measured

**(a) A DoT landed on the dummy's containers is now STRANDED, and still reported.** Probed with the
`LIVENESS` fixture (a test tap pushes one corrosion entry onto the dummy) with the switches applied:

```text
TURNS_R1 ["attacker","e1"]      <- no "enemy": the dummy takes no turn
TURNS_R2 ["attacker","e1"]
CORROSION_DMG   [0,0]           <- never ticks
ACTIVE_STACKS   [1,1]           <- but IS still reported, every round, forever
```

The stacks never tick, never expire, and `dotCarrierActors` (`engine.ts:2671`) still includes the
dummy, so `activeCorrosionStacks` reports them for the rest of the run. It must be pinned, because
4c-2d deletes the actor and needs to know what it is deleting.

⚠️ **This paragraph originally continued "No production route writes there … so this is constructible
only through `__testTapActors`". The final whole-branch review MEASURED that wrong** — see spec §9.8.
The player-turn route is indeed closed (4c-2b; the dummy is not in `opposingRoster`), but a live
REACTIVE route survives: the dummy's containers are aliased into `drainQueue` as `ctx.*`, and
`triggers.ts` pushes to `(victim?.corrosionEntries ?? ctx.corrosionEntries)` whenever an intent's
`eventCtx` stamps neither `victimId` nor `counterTargetId`. The honest claim is **"no SHIPPED KIT
reaches it"** — all 16 reactive non-`on-cast` DoT abilities in the corpus stamp a victim, which is why
nothing moved. Same overstatement class §0.2 warns about for the credit counter, and I made it anyway:
**when you narrow a claim, sweep every document that carries it.**

**(b) The scheduled-enemy-debuff decrement MOVES within the round.** Previously, on a
non-vestigial run, the side-wide `__enemy__` bucket was decremented at the dummy's own Post-Turn,
*mid-round*. Now it is decremented at the round tail, after every actor has acted. Zero tests moved,
so nothing in the corpus observes it — but it is a real semantic shift and gets a positive test.

⚠️ **The two switches MUST land together.** `dummyEnemyIsVestigial` gates both the turn order *and*
the D5 decrement. Flipping only the turn-order one leaves ally-side-target runs with no dummy turn
*and* a still-`false` D5 gate — so the scheduled bucket would never decrement at all, silently
resurrecting the exact regression the D5 block was written to fix.

## Global Constraints

- **No new dummy branches.** LOCKED ruling from this epic: nothing in this rung may add a
  `if (isDummy…)` / `id === enemy.id` conditional. The rung removes conditionals; it does not add them.
- **Team symmetry** is a locked project rule (`feedback_engine_team_symmetry`). Nothing here is
  player-side-only: the dummy is the enemy side's structural counterpart and its retirement is
  side-neutral by construction.
- **A history banner must be scoped to exactly what it disclaims** (§8.3). When you mark a comment
  stretch HISTORICAL, the banner must cover every falsehood beneath it — not the first one only.
- **Percentage stats** are stored as integers; **never run `vitest -u`**; the golden audit spans the
  whole `npm test`. There is **no CI test workflow** — the husky pre-commit hook is the gate.
- **`npm start`**, not `npm run dev`.
- Verification commands, run from the repo root:
  - `npx vitest run` — full suite. Baseline: **532 files / 5,892 tests green**.
  - `npx tsc --noEmit` — must be clean.
  - `npm run lint` — must be clean (`--max-warnings 0`, so an orphaned binding is an ERROR).
  - `npm run audit:placement-symmetry -- --seeds 15` — must read exactly `147 / 146 / 2`.

---

## File Structure

| File | Change | Responsibility after the rung |
| --- | --- | --- |
| `src/utils/combat/engine.ts` | Modify | The two switches; delete `dummyEnemyIsVestigial`; delete `dummySinkCreditCount` + its two exports + its doc block; repair the comment stretches the switches falsify |
| `src/utils/combat/__tests__/dummyEnemyTurnGate.test.ts` | Modify | Becomes a permanent tripwire: the dummy is in NO turn order, on either branch of the retired gate |
| `src/utils/combat/__tests__/dummyReachability.test.ts` | Modify | Keeps its six `consulted: 0` path cases (enemy-side reading, 4e's business); drops every credit-counter reading; its vacuity guard moves to `__getNoVictimPlayerTurnCount` |
| `src/utils/combat/__tests__/retiredDummyTurn.test.ts` | **Create** | The two §0.4 hazard tripwires. A single new file so 4c-2d can dispose of both at once — but see the ⚠️ below: 4c-2d must DELETE the first test and MIGRATE the second |
| `docs/superpowers/specs/2026-08-18-sp4c-match-end-and-delete-the-dummy-design.md` | Modify | §9 amendment: the churn correction and the counter-deletion decision |

---

### Task 1: Retire the turn, and delete the counter it was the last liveness proof for

This is one atomic task on purpose. The two switches cannot be split (§0.4's warning), and leaving the
credit counter behind for one rung would mean ending the task with a knowingly-vacuous assertion in the
tree — the defect class this rung exists to avoid.

**Files:**
- Modify: `src/utils/combat/engine.ts` — lines `1760`, `1774–1826`, `2825`, `2858–2867`, `11081–11085`, `11241–11245`
- Test: `src/utils/combat/__tests__/dummyEnemyTurnGate.test.ts:160–180`
- Test: `src/utils/combat/__tests__/dummyReachability.test.ts` (imports, `beforeEach` blocks, `counters()`, every case's assertion, the `LIVENESS` case)

**Interfaces:**
- Consumes: `collectTurns` from `../__testutils__/turnOrderTap`; `bareInput`/`bareEnemy`/`bareAlly`/`BARE_ENEMY_ID`/`BARE_ALLY_ID`/`SECOND_BARE_ENEMY_ID` from `../__testutils__/bareRosterFixture`; `__getLegacyVictimFallbackCount`/`__resetLegacyVictimFallbackCount`/`__getNoVictimPlayerTurnCount`/`__resetNoVictimPlayerTurnCount` from `../engine`.
- Produces: `__getDummySinkCreditCount` and `__resetDummySinkCreditCount` **cease to exist** — Task 2 and 4c-2d must not import them. `__getLegacyVictimFallbackCount`, `__resetLegacyVictimFallbackCount`, `__getNoVictimPlayerTurnCount`, `__resetNoVictimPlayerTurnCount` are unchanged and still exported.

- [ ] **Step 1: Invert the ally-side case in the turn-gate test**

In `src/utils/combat/__tests__/dummyEnemyTurnGate.test.ts`, replace the whole
`it('a player actor with an ALLY-side target: the dummy enemy still takes its tick turn', …)` block
(lines 160–180) with:

```ts
    it('a player actor with an ALLY-side target: the dummy STILL takes no turn', () => {
        idc = 0;
        // SP-4c-2c INVERTED THIS CASE, and it is now the file's most load-bearing one.
        //
        // Until this rung the reading was `> 0`: the focus is a support ship (positioned at M4,
        // active target ALLY-side), so conjunct 2 of the retired `dummyEnemyIsVestigial`
        // (`t?.side === 'enemy'`) was false, the AND was false, and the dummy stayed in the turn
        // order to tick its containers. That was the LAST shape in which the dummy acted.
        //
        // The gate is gone: `turnOrderActors` now drops the dummy unconditionally. This case and
        // its enemy-side twin below are therefore a MATCHED PAIR reading the same 0 through the
        // two branches of the retired gate — which is exactly what makes them a tripwire against
        // the gate being reintroduced. Keep BOTH: a single case could be satisfied by a
        // reintroduced gate that happened to pick the branch it exercises.
        const count = enemyTurnStartedCount(
            BASE({
                healTargetId: 'attacker',
                mode: 'healing',
                position: 'M4',
                target: allySideTarget(),
                pattern: basePattern(),
                enemyAttackers: [basicEnemyAt('enemy-front', 'M4')],
            })
        );
        expect(count).toBe(0);
    });
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

```bash
npx vitest run src/utils/combat/__tests__/dummyEnemyTurnGate.test.ts
```

Expected: FAIL — `expected 1 to be +0`. **Verify the number is 1, not 0.** A `0` here would mean the
fixture stopped reaching the not-fully-positional branch for some *other* reason and the test is
vacuous before you have even changed the engine.

- [ ] **Step 3: Throw the two switches**

In `src/utils/combat/engine.ts`, replace lines 2865–2867:

```ts
    const turnOrderActors = dummyEnemyIsVestigial
        ? allActors.filter((a) => a.id !== enemy.id)
        : allActors;
```

with:

```ts
    // SP-4c-2c: the dummy `enemy` is in NO turn order, unconditionally. It is still a member of
    // allActors/allActorsById (4c-2d deletes the actor itself); it simply never acts. Measured on
    // f1bce838: this moves 2 tests in 2 files, zero goldens, and the oracle stays at 147/146/2.
    const turnOrderActors = allActors.filter((a) => a.id !== enemy.id);
```

Then delete the now-orphaned binding at lines 2858–2864 (`const dummyEnemyIsVestigial = …`) in its
entirety. `hasPositionedEnemyRoster` on the line above it **stays** — it has other readers
(`engine.ts:8647`, `:8684`, the reactive target resolvers).

Then replace lines 11081–11085:

```ts
        if (dummyEnemyIsVestigial) {
            for (const buffName of statusEngine.decrementEnemy().expired) {
                bus.emit({ type: 'buff-expired', actorId: enemy.id, round: r, buffName });
            }
        }
```

with:

```ts
        for (const buffName of statusEngine.decrementEnemy().expired) {
            bus.emit({ type: 'buff-expired', actorId: enemy.id, round: r, buffName });
        }
```

- [ ] **Step 4: Confirm the turn-gate test passes and see the second failure appear**

```bash
npx vitest run src/utils/combat/__tests__/dummyEnemyTurnGate.test.ts src/utils/combat/__tests__/dummyReachability.test.ts
```

Expected: `dummyEnemyTurnGate.test.ts` fully PASSES; `dummyReachability.test.ts` FAILS on the
`LIVENESS` case with `expected +0 to be 500`. That is §0.1's finding reproducing exactly — the next
steps are its resolution.

- [ ] **Step 5: Delete the credit counter from the engine**

In `src/utils/combat/engine.ts`:

1. Delete the whole `dummySinkCreditCount` doc block and its three declarations (lines ~1774–1826):
   the doc comment opening "TEST-ONLY instrumentation, and the COMPANION to
   `legacyVictimFallbackCount`", `let dummySinkCreditCount = 0;`, `export function __getDummySinkCreditCount()`, and
   `export function __resetDummySinkCreditCount()`.
2. At line 11245, replace:

```ts
            // SP-4b-2b Task 7: the ONE live site where damage is BOOKED against the dummy. Keyed on
            // THIS round's own contribution, not the cumulative total — `enemyHpDecline` stays > 0
            // for every later round once anything has ever been booked, which would read as a fresh
            // credit each round. `cumulativeDamage`/`cumulativeTeamDamage` were advanced by exactly
            // these two terms above, so the delta is exact. See `__getDummySinkCreditCount`.
            if (totalRoundDamage + teamRoundDamage > 0) dummySinkCreditCount++;
```

with:

```ts
            // SP-4c-2c DELETED THE INSTRUMENTATION THAT SAT HERE (`dummySinkCreditCount++`), and the
            // reason is worth keeping: retiring the dummy's turn removed the last route that could
            // make it move. Measured with a console.error at this line over the whole suite — 0 hits
            // in 532 files, where the pre-rung tree hit it twice. A counter whose zero cannot be
            // falsified is not evidence, so it went rather than becoming 4c-2d's vacuous gate.
            // PRECISION, because the counter's own doc drew this line and it still holds: that is
            // "no shape the suite can build reaches here", NOT "this line is unreachable". It is the
            // round-tail scalar branch, not the dummy's turn body, so any future change that routes
            // scalar damage lights it up again.
```

3. At line 1760, in `noVictimPlayerTurnCount`'s doc, the sentence "…`dummySinkCreditCount`; this one
   exists so `dummyReachability`'s vacuity guard keeps a MOVING…" now names a deleted symbol.
   Rewrite that clause so it stands alone: this counter IS `dummyReachability`'s vacuity guard now,
   not a companion to one.
4. At line 2825, the live-rationale paragraph cites "`dummySinkCreditCount`'s doc, route 2, and
   `dummyReachability`'s LIVENESS case" as the reason the dummy's turn still buys something. Both
   citations are dead and the rationale is spent — this is handled in Task 3, but delete the dangling
   symbol reference now so the tree carries no reference to a symbol that does not exist.

- [ ] **Step 6: Re-home `dummyReachability.test.ts`**

In `src/utils/combat/__tests__/dummyReachability.test.ts`:

1. Remove `__getDummySinkCreditCount` and `__resetDummySinkCreditCount` from the import list and both
   `beforeEach` blocks.
2. Replace the `counters()` helper with the single surviving reading:

```ts
/** The one surviving counter this file reads. Enemy-side only since SP-4c-2b — see the header. */
const consultations = (): number => __getLegacyVictimFallbackCount();
```

3. In every case, replace `expect(counters()).toEqual({ consulted: 0, credited: 0 })` with
   `expect(consultations()).toBe(0)`, and replace the two bare
   `expect(__getDummySinkCreditCount()).toBe(0);` lines in the `CORPSE TARGETING` case with nothing
   (its `expect(__getLegacyVictimFallbackCount()).toBe(0);` already stands).
4. Replace the entire `LIVENESS` case with the version below. The fixture is unchanged — only what it
   proves changes, from "the credit counter can move" to "the no-victim path is live AND the dummy's
   turn is gone". **It keeps a non-zero reading**, so the file's zeros stay non-vacuous:

```ts
    it('LIVENESS: the no-victim player turn is what keeps this file honest now', () => {
        // THIS FILE'S VACUITY GUARD, re-homed for the third and final time — and the change of
        // SUBJECT is the point. Every other case here reads 0, and a zero from a reading wired to
        // nothing means nothing, so exactly one case must read non-zero off a live path.
        //
        // WHAT MOVED IN SP-4c-2c. This case used to prove `__getDummySinkCreditCount` could move,
        // via the dummy's own DoT-tick turn — the one route SP-4c-2a's floor did not close. That
        // rung retired the dummy's turn, which removed the route, and a counter nothing can move is
        // worse than no counter: the credit counter was therefore deleted outright rather than left
        // reading an unfalsifiable 0. Measured: with the turn retired, a console.error at the
        // increment site hit 0 times across all 532 suite files.
        //
        // The guard now rides on `__getNoVictimPlayerTurnCount`, which SP-4c-2b introduced and which
        // reads BARE_ROUNDS on exactly this shape: the focus is positioned with an ALLY-side active
        // target, so `resolvePositionalTarget` returns null every round, `selectTurnTarget` answers
        // `tgt: undefined` on the player side, and the turn RUNS with no victim (it does not skip —
        // that distinction is 4c-2b's whole subject and 24 shipped support ships depend on it).
        const DUMMY_HP = 10_000;
        const { result, actorsThatTookTurns } = collectTurns({
            ...bareInput(),
            position: 'M4',
            target: { raw: 'ally-team', side: 'ally', selection: 'team' },
            pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
            enemyHp: DUMMY_HP,
        });

        // The path RAN: the focus took an ally-targeted turn every round and booked nothing against
        // anybody, which is what a no-victim turn looks like from outside.
        expect(actorsThatTookTurns(1)).toContain('attacker');
        expect(dealtBy(result, 1, 'attacker')).toBeUndefined();
        // ...and the dummy is not in the order at all — the SP-4c-2c switch, observed here rather
        // than assumed, on the very shape that used to be the one exception to it.
        expect(actorsThatTookTurns(1)).not.toContain('enemy');
        expect(actorsThatTookTurns(BARE_ROUNDS)).not.toContain('enemy');

        // The non-zero reading, and the whole reason this case exists.
        expect(__getNoVictimPlayerTurnCount()).toBe(BARE_ROUNDS);
        // Enemy-side consultations stay 0: the roster member resolves the targetable focus.
        expect(consultations()).toBe(0);
    });
```

5. Rewrite the file's header block. It currently devotes a numbered section (§2, §3) and several
   paragraphs to the two-counter split and to "rungs 4c-2b/4c-2c plan to gate their deletions on
   `credits === 0`". There is one counter now and that gating plan was abandoned for the reason above.
   The header must state: what the file guarantees (six paths never consult the enemy-side fallback),
   which counter it reads and that the reading is enemy-side-only, where its liveness comes from, and
   that the credit counter was deleted in 4c-2c along with the reason. **Do not append a banner over
   the stale sections — rewrite them.** (§8.3: a banner scoped narrower than the falsehoods beneath it
   launders the rest.)

- [ ] **Step 7: Verify the pair, then the whole suite**

```bash
npx vitest run src/utils/combat/__tests__/dummyEnemyTurnGate.test.ts src/utils/combat/__tests__/dummyReachability.test.ts
```

Expected: both files fully PASS.

```bash
npx vitest run
npx tsc --noEmit
npm run lint
```

Expected: **532 files / 5,892 tests green**, tsc clean, lint clean. Anything else is a finding — this
rung was measured to move exactly the two tests you just rewrote. In particular, a lint error naming
`dummyEnemyIsVestigial` means Step 3's deletion was missed.

- [ ] **Step 8: Commit**

```bash
git add src/utils/combat/engine.ts \
        src/utils/combat/__tests__/dummyEnemyTurnGate.test.ts \
        src/utils/combat/__tests__/dummyReachability.test.ts
git commit -m "feat(engine): the dummy enemy takes no turn, on any run (SP-4c-2c)"
```

---

### Task 2: Tripwire the two hazards the retirement creates

Both are measured facts from §0.4, not speculation. Neither is reachable from production input today;
both are constructible in a test, and 4c-2d needs to know they exist before it deletes the actor.

**Files:**
- Create: `src/utils/combat/__tests__/retiredDummyTurn.test.ts`

**Interfaces:**
- Consumes: `runCombat` from `../engine`; `collectTurns` from `../__testutils__/turnOrderTap`; `bareInput` from `../__testutils__/bareRosterFixture`; `setupKeyedTestRng` from `../../calculators/rateAccumulator`.
- Produces: nothing imported elsewhere. A standalone file so 4c-2d can dispose of both tests at once. ⚠️ SUPERSEDED DURING EXECUTION — spec §9.5 is the authority: 4c-2d deletes the stranded-DoT test and MIGRATES the scheduled-decrement one (re-keying the reported `actorId`), because that one pins a round-tail decrement of a side-wide bucket which outlives the actor. Deleting the file wholesale would drop the only coverage of it.

- [ ] **Step 1: Write the file with both tripwires**

```ts
/**
 * SP-4c-2c — the two consequences of retiring the dummy `enemy`'s turn.
 *
 * ⚠️ TWO CLAIMS IN THIS SAMPLE WERE FALSIFIED DURING EXECUTION. The shipped file says the correct
 * thing; this block is kept as the plan's record. Read spec §9.5 and §9.8 for the authority.
 *
 * (1) "Neither is reachable from any production input" — WRONG, and the final whole-branch review
 * measured it. That covers only the PLAYER-TURN route (`tgt: undefined` since SP-4c-2b, and the dummy
 * is not in `opposingRoster`). A live REACTIVE route survives: the dummy's containers are aliased into
 * `drainQueue` as `ctx.*`, and `triggers.ts` pushes to `(victim?.corrosionEntries ?? ctx.corrosionEntries)`
 * whenever an intent's `eventCtx` stamps neither `victimId` nor `counterTargetId`. The honest claim is
 * "no SHIPPED KIT reaches it" — all 16 reactive non-`on-cast` DoT abilities in the corpus stamp a victim.
 *
 * (2) "This whole file goes with the dummy; it is not migrated" — WRONG for the second test. The
 * stranded-DoT test does die with the actor. The scheduled-decrement test pins a round-tail decrement
 * of a side-wide bucket that OUTLIVES the actor; only the reported `actorId` dies with the dummy, so
 * 4c-2d must MIGRATE it.
 *
 * Both are pinned because SP-4c-2d deletes the actor and must know exactly what it is deleting — an
 * undocumented behaviour discovered during a pure-deletion rung reads as that rung's regression.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { bareInput } from '../__testutils__/bareRosterFixture';
import { collectTurns } from '../__testutils__/turnOrderTap';

/** `bareInput().numRounds`. */
const BARE_ROUNDS = 2;

describe('the retired dummy turn', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
    });

    it('STRANDS a DoT pushed onto the dummy: it never ticks, never expires, and is still reported', () => {
        // The fixture is SP-4c-2b's LIVENESS shape verbatim — an ally-side active target, which was
        // the last thing that kept the dummy in the turn order — plus a test tap that pushes one
        // corrosion entry straight onto the dummy's container.
        //
        // Before SP-4c-2c the dummy took its turn and this entry ticked for 500 a round
        // (1 stack x tier 5/100 x min(enemyHp, 500_000) = 0.05 x 10_000) while `remainingRounds`
        // counted down. Now there is no turn to tick it in, so it is frozen: 0 damage forever, and
        // because `dotCarrierActors` (engine.ts) still includes the dummy for REPORTING, the stack
        // is still counted into every round's row. Measured, not predicted.
        const DUMMY_HP = 10_000;
        const { result, actorsThatTookTurns } = collectTurns({
            ...bareInput(),
            position: 'M4',
            target: { raw: 'ally-team', side: 'ally', selection: 'team' },
            pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
            enemyHp: DUMMY_HP,
            __testTapActors: (actors) => {
                actors.find((a) => a.id === 'enemy')?.corrosionEntries.push({
                    tier: 5,
                    stacks: 1,
                    remainingRounds: 5, // outlives the run, so expiry is never the reason it stops
                    sourceId: 'attacker',
                });
            },
        });

        // The dummy really is absent from the order — without this the two zeros below could be
        // explained by the entry never having been pushed.
        expect(actorsThatTookTurns(1)).not.toContain('enemy');
        expect(actorsThatTookTurns(BARE_ROUNDS)).not.toContain('enemy');

        // It never ticks: 500/round became 0/round.
        expect(result.rounds.map((r) => r.corrosionDamage)).toEqual([0, 0]);
        // ...but it IS still reported, every round, at full stack count. This is the strand.
        expect(result.rounds.map((r) => r.activeCorrosionStacks)).toEqual([1, 1]);
    });

    it('DECREMENTS the side-wide scheduled enemy-debuff bucket exactly once per round', () => {
        // WHAT MOVED. A SCHEDULED (`enemyDebuffs`) entry lives in the side-wide '__enemy__' store,
        // which has no carrier actor. Its decrement used to be hung on the dummy's own Post-Turn and
        // was mirrored by a round-tail block gated on `dummyEnemyIsVestigial`, so exactly one of the
        // two fired. SP-4c-2c retired the turn and dropped the gate, leaving the round-tail block as
        // the sole decrement site.
        //
        // The shape below is the one that took the DUMMY'S-TURN route before this rung (ally-side
        // active target), so it is precisely where a double-decrement or a dropped decrement would
        // show. A 2-round debuff applied at the start therefore expires on round 2, not 1 (double)
        // and not never (dropped).
        const expiries: number[] = [];
        const bus = {
            ...runCombatBus(),
        };
        void bus;
        const { result } = collectTurns({
            ...bareInput(),
            numRounds: 4,
            position: 'M4',
            target: { raw: 'ally-team', side: 'ally', selection: 'team' },
            pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
            enemyDebuffs: [{ name: 'Def Down', stacks: 1, duration: 2 }],
        });
        void expiries;

        // Observed through the row's own enemy-debuff reporting rather than through `buff-expired`,
        // because the event is log-only and carries the sentinel's id: the ROW is what a consumer
        // actually reads. Round 1 and 2 carry it; rounds 3 and 4 do not.
        expect(result.rounds.map((r) => r.activeEnemyDebuffs?.includes('Def Down') ?? false)).toEqual(
            [true, true, false, false]
        );
    });
});
```

⚠️ **The second test above is written against an ASSUMED shape for the scheduled-debuff input and
for the row field, and the `runCombatBus()` placeholder is deliberate scaffolding you must remove.**
Before implementing it, establish the real shapes by reading them, not guessing:

```bash
grep -n "enemyDebuffs" src/utils/combat/engine.ts | head -20
grep -n "activeEnemyDebuffs" src/utils/combat/engine.ts | head
grep -rn "enemyDebuffs: \[" src/utils/combat/__tests__ | head -5
```

Then rewrite the test body to the real field names and the real `enemyDebuffs` entry shape, and drop
the `runCombatBus`/`expiries` scaffolding entirely. If `activeEnemyDebuffs` turns out to be
snapshotted during the focus's turn (its comment at the D5 block says it is), assert on whichever
row field genuinely observes the bucket — and if no row field does, observe `buff-expired` through
`createEventBus` instead and assert it fires exactly once, on round 2, with `actorId: 'enemy'`.

- [ ] **Step 2: Run and confirm both tripwires pass**

```bash
npx vitest run src/utils/combat/__tests__/retiredDummyTurn.test.ts
```

Expected: 2 tests PASS. If the strand test reads `[0, 0]` for `activeCorrosionStacks`, the tap did not
land — check `__testTapActors` fires before the first round rather than weakening the assertion.

- [ ] **Step 3: MUTATION-VERIFY both tripwires — do not skip this**

A tripwire that cannot fail is the thing this rung deleted a counter to avoid. Prove each one bites:

```bash
# 1. Temporarily restore the dummy to the turn order in engine.ts:
#      const turnOrderActors = allActors;
npx vitest run src/utils/combat/__tests__/retiredDummyTurn.test.ts
# Expected: BOTH tests fail — the strand test because corrosion ticks again (500/round) and the
# stacks decrement, the decrement test because the bucket now decrements twice per round.
# 2. Revert that edit and re-run: both pass again.
```

Record the observed failure messages in the commit body. If a test still passes under the mutation,
it is not observing what its name claims and must be rewritten before you commit.

- [ ] **Step 4: Full verification**

```bash
npx vitest run
npx tsc --noEmit
npm run lint
```

Expected: 533 files / 5,894 tests green (the two new tests), tsc clean, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/__tests__/retiredDummyTurn.test.ts
git commit -m "test(engine): pin the two consequences of the retired dummy turn (SP-4c-2c)"
```

---

### Task 3: Repair the comments the switches falsified

`engine.ts` carries several long comment stretches written when the dummy still acted. Task 1 made
them false. **This is not cosmetic**: §8.3 records that a stale rationale in exactly this stretch
("the dummy MUST stay in the turn order") was what 4c-2c had to be talked out of believing, and the
`project_reachability_is_a_measurement` memory records four consecutive false-comment rounds on one
branch of this epic.

**Files:**
- Modify: `src/utils/combat/engine.ts` — lines ~1174, ~2680–2694, ~2775–2864, ~8915–8930, ~10995–11010, ~11040–11080

- [ ] **Step 1: Fix the four live falsehoods**

Each of these now states something untrue. Fix the statement; do not merely add a banner above it.

1. **`dotCarrierReports` (~2680–2694).** Its second bullet reads "the DUMMY sink is explicitly EXEMPT
   from that skip, so it keeps taking turns and its containers keep ticking and expiring normally.
   Its entries are live state and are reported exactly as before." **All three clauses are now
   false** — this is the strand Task 2 pins. Rewrite the bullet to say: the dummy takes no turn at
   all since 4c-2c, so anything in its containers is frozen; nothing writes there through any
   SHIPPED kit (a live reactive route exists — see spec §9.8), so the containers are empty in
   practice; the `|| a.id === enemy.id` disjunct is
   now redundant (the dummy is never destroyed, so the first disjunct already admits it) and is kept
   only until 4c-2d removes the carrier. Cite `retiredDummyTurn.test.ts`.
2. **The turn-order construction note (~2775–2864).** With the gate deleted, the entire HISTORICAL
   stretch and the "LIVE RATIONALE" paragraph beneath it are spent — the live rationale said the
   turn "exists only to TICK THE DoT CONTAINERS THE DUMMY ITSELF CARRIES", and there is no turn.
   Collapse the whole stretch to a few lines: what the dummy still is (a member of
   `allActors`/`allActorsById`, the enemy side's structural counterpart, the `legacyVictim` object on
   a binding nothing consults), what it no longer is (an offense sink, since 4c-2b; a turn-taker,
   since 4c-2c), and that 4c-2d deletes it. Keep the `hasPositionedEnemyRoster` paragraph (SP-M M1's
   narrowest-correct-signal note) — that binding survives and its rationale is still live.
3. **The D5 block (~11040–11080).** Its "CANNOT DOUBLE-FIRE" argument rests on
   `turnOrderActors` dropping the dummy *iff* `dummyEnemyIsVestigial` — a gate that no longer
   exists. The conclusion still holds and is now *stronger*: the dummy never takes a turn, so the
   `isDummyEnemy` Post-Turn branch is unreachable and this is the sole decrement site. Rewrite the
   argument to that form. Also fix the sentence "Once a real positioned enemy roster exists the dummy
   is dropped from the turn order (`dummyEnemyIsVestigial`), so that call never ran" — drop the
   condition; it is now unconditional. State the within-round timing shift §0.4(b) records, and cite
   `retiredDummyTurn.test.ts`'s second case.
4. **The Post-Turn `isDummyEnemy` ternary (~11008).** `statusEngine.decrementEnemy()` (no-arg,
   sentinel store) is now dead — the dummy never reaches a Post Turn. Leave the code (deleting it is
   4c-2d's inventory) but mark it: `// SP-4c-2c: the true arm is DEAD — the dummy takes no turn, so
   this ternary always takes the per-actor branch. Deleted with the actor in 4c-2d.`

- [ ] **Step 2: Mark the two other now-dead dummy sites for 4c-2d**

Do not delete them (that is 4c-2d's job, and its zero-movement claim depends on knowing its own
inventory), but mark each so the deleting rung finds them:

- `~8915–8930`: the dead-actor `continue` guard's `!isDummyEnemy` exemption, and the four-line comment
  above it justifying the exemption ("IF the terminal break above were ever removed, a dead `enemy`
  would still take its turn"). The exemption can never fire — the dummy is not in the loop.
- `~1174`: "UNREACHABLE, not absent. SP-4c deletes it with the dummy." — verify this still reads
  correctly after Task 1 and update the rung reference if it names the wrong one.

- [ ] **Step 3: Verify no stale citation survives**

```bash
grep -n "dummyEnemyIsVestigial\|dummySinkCreditCount\|__getDummySinkCreditCount" src/utils/combat/engine.ts
```

Expected: **zero hits.** Both symbols are deleted; a surviving mention is a comment citing a symbol
that no longer exists.

```bash
grep -rn "dummyEnemyIsVestigial" src/
```

Expected: hits only in test files' *comments*, each of which must now read as history rather than as a
description of current code. Fix any that read present-tense —
`extraActions.test.ts:119`, `dynamicSpeed.smoke.test.ts:92`, `engine.events.test.ts:476`,
`reactiveDamageNoDummyTarget.test.ts:87` are the known ones. `engine.events.test.ts:476` in particular
says the bucket is decremented at the round boundary "precisely BECAUSE the dummy has no turn to hang
the decrement on" — that is now unconditionally true rather than positional-run-only, and the
parenthetical naming the `dummyEnemyIsVestigial` block needs updating.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run && npx tsc --noEmit && npm run lint
```

Expected: 533 files / 5,894 tests green, tsc clean, lint clean. (Comment-only changes must move
nothing — if a test moves here, a code line was edited by accident.)

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/
git commit -m "docs(engine): the dummy's turn is gone — repair the rationales that assumed it (SP-4c-2c)"
```

---

### Task 4: Amend the spec, and close out

**Files:**
- Modify: `docs/superpowers/specs/2026-08-18-sp4c-match-end-and-delete-the-dummy-design.md`

- [ ] **Step 1: Add a §9 amendment**

Append a `## 9. AMENDMENT (2026-08-19) — what 4c-2c actually cost` section recording, in the same
voice as §8:

1. **The churn table in §7.4 was wrong for 4c-2c, and by two orders of magnitude** — "3,883 no-op
   turn events across 73 files, 3 of them golden suites" measured **2 tests in 2 files, zero golden
   movement, oracle unchanged at 147/146/2**. The estimate predated 4c-2a and 4c-2b, which between
   them did the work. Correct the cell in §7.4 in place *and* record the correction here, the way §8
   corrected §4. **The generalisable lesson is §7.5's, one rung on:** a churn estimate ages the same
   way a reachability claim does — re-measure before the rung, never quote the table.
2. **§8.4's hand-off was right that the credit counter was 4c-2c's remaining work, and wrong about
   what "handling it" would mean.** It framed the job as driving `credited` to 0; the measurement
   showed the rung makes the counter unfalsifiable instead. Record the decision (deleted here, not in
   4c-2d) and the reason, including the precision from §0.2: corpus-dead, not structurally
   unreachable.
3. **Update §7.4's 4c-2d row.** Its inventory loses `dummySinkCreditCount` (deleted here) and gains
   the four sites Task 3 marked: the dead `isDummyEnemy` Post-Turn arm, the dead-actor-skip exemption,
   the dummy's membership in `dotCarrierActors`, and `retiredDummyTurn.test.ts` itself. Its
   **zero-movement** expectation is unchanged and is now better founded than when written.

- [ ] **Step 2: Decide the changelog entry — and record the decision either way**

Per `CLAUDE.md`, `feat:` commits that users would notice get an entry in `UNRELEASED_CHANGES`
(`src/constants/changelog.ts`); refactors and test-only changes are skipped.

This rung moved **zero** user-observable behaviour: no golden moved, no oracle finding moved, and the
only semantic shift (§0.4(b)'s within-round decrement timing) is unobservable in the whole corpus.
**Recommendation: no changelog entry.** State that conclusion in the PR body rather than leaving it
unaddressed — and note the trap that bit #332's changelog: a user-facing claim written from the
headline behaviour will overstate it. "The phantom enemy line no longer appears in the combat log"
would be such an overstatement here, because the dummy's `turn-started`/`turn-ended` pair was already
suppressed on every positional run before this rung.

- [ ] **Step 3: Full verification, then the PR**

```bash
npx vitest run
npx tsc --noEmit
npm run lint
npm run audit:placement-symmetry -- --seeds 15
```

Required readings, all four: **533 files / 5,894 tests green**; tsc clean; lint clean; oracle exactly
`shipsSwept: 147 / symmetricShips: 146 / findings: 2`. Any other oracle reading is a finding, not
noise — quote it rather than re-running until it agrees.

```bash
git add docs/superpowers/specs/2026-08-18-sp4c-match-end-and-delete-the-dummy-design.md
git commit -m "docs(spec): amend SP-4c with 4c-2c's measured churn and the counter deletion"
gh pr create --title "feat(engine): the dummy enemy takes no turn, on any run (SP-4c-2c)" --body "..."
```

The PR body must carry: the §0 measured-facts table (the correction is the headline), the counter
deletion and its evidence, the two tripwires with their mutation-verification results, and the
explicit no-changelog decision. **Verify CodeRabbit's reviewed range against HEAD by grepping the
review body for the SHA** — a green check with a stale range is this repo's known false-green shape,
and the justification must be the range, never the check.

---

## Self-Review

**Spec coverage.** §7.4's 4c-2c row ("Drop the dummy from the turn order unconditionally; the D5
scheduled decrement becomes unconditional") → Task 1 Step 3, both switches. §8.4's hand-off (the
credit counter is 4c-2c's remaining work) → Task 1 Steps 5–6 plus the §0.2 finding that reframes it.
§8.3's warning about the stale turn-order rationale → Task 3 Step 1.2. §7.2.2's requirement that
4c-2d stay genuinely zero-movement → Task 4 Step 1.3 hands it a corrected inventory.

**Not in this rung, deliberately:** issue #333 (the three phantom scalars on a no-victim turn — its
own rung), #334 (the victimless reactive arm aiming at the sentinel — §8's note says 4c-2d forces
that decision), #335 (the enemy-side ally-targeted supporter, which is 4e's and needs the
player-side rule adopted, per `feedback_engine_team_symmetry`), and #331. None is blocked by this rung
and none blocks it.

**Known soft spot, called out rather than hidden:** Task 2 Step 1's second test is written against an
assumed `enemyDebuffs` entry shape and an assumed row field, with scaffolding (`runCombatBus`,
`expiries`) that must be removed. That step carries explicit `grep` commands to establish the real
shapes first and a stated fallback (observe `buff-expired` through `createEventBus`) if no row field
observes the bucket. The strand test in the same file was measured end-to-end and needs no such
discovery. Do not implement that second test from the sample code as written.
