# Task 3 report — an empty enemy roster is a validation error

Branch `feat/sp4b2b-enemy-roster-required`, base `06802921` (Task 2b already landed on this branch).

## Summary

Added the runtime guard at the top of `normalizeCombatRoster` (`src/utils/combat/normalizeRoster.ts`):
an empty `enemyAttackers` array now throws
`Error('normalizeCombatRoster: enemyAttackers is empty — every run needs at least one opponent (SP-4b-2b). A caller with no enemy to model should synthesize an inert one, as healingEngineAdapter.practiceTarget does.')`
— verbatim per the brief. Deleted the two branches that guard made dead. Rewrote the stale
`enemyAttackers` field doc on `CombatEngineInput` in `engine.ts`. Ran the full suite to produce the
inventory. **The suite ends RED by design: 64 files / 253 tests fail, all throwing at the new
guard** (either with the exact contract message, or — for 3 files/4 tests — a `TypeError` one line
above it; both are diagnosed below). Committed with `--no-verify` since husky's pre-commit runs the
full suite, which is red on purpose.

## Step 1-2: the failing boundary test (red-then-green evidence)

Appended to `src/utils/combat/__tests__/normalizationBoundary.integration.test.ts`:

```ts
describe('the roster contract', () => {
    it('throws on an empty enemy roster rather than handing the run to the dummy', () => {
        expect(() => runCombat({ ...bareInput(), enemyAttackers: [] })).toThrow(
            /enemyAttackers is empty/
        );
    });
});
```

**RED** (before the guard existed):

```
 × the roster contract > throws on an empty enemy roster rather than handing the run to the dummy
   → expected [Function] to throw an error
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

**GREEN** (after Step 3's guard):

```
 ✓ the normalization boundary is live in runCombat > routes a position-less, targeting-less roster per-victim instead of into the sink
 ✓ the roster contract > throws on an empty enemy roster rather than handing the run to the dummy
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

## Step 3: the guard, and the two branches it makes dead

Added (verbatim from the brief) to the top of `normalizeCombatRoster`:

```ts
export function normalizeCombatRoster(input: CombatEngineInput): CombatEngineInput {
    // The contract (SP-4b-2b): every run has at least one opponent. This is a validation guard
    // rather than an accommodation on purpose — the boundary is the ONE place that accommodates an
    // under-specified input, and synthesizing a sink here is what kept the dummy alive.
    if (input.enemyAttackers.length === 0) {
        throw new Error(
            'normalizeCombatRoster: enemyAttackers is empty — every run needs at least one ' +
                'opponent (SP-4b-2b). A caller with no enemy to model should synthesize an inert ' +
                'one, as healingEngineAdapter.practiceTarget does.'
        );
    }
    const teamActors = input.teamActors ?? [];
    const enemyAttackers = input.enemyAttackers;
```

and simplified the enemy-side placement, now provably non-empty:

```ts
    const enemySlots = placeSide(
        enemyAttackers.map((e) => e.position),
        DEFAULT_ENEMY_SLOT,
        (i) => defaultEnemySlot(i + 1),
        resolveEnemySlots
    );
```

**Proof the two deleted branches were genuinely dead, not assumed:**

1. `input.enemyAttackers ?? []` (the `??` fallback for a nullish `enemyAttackers`): dead because the
   guard above already dereferences `input.enemyAttackers.length` unconditionally — a nullish value
   would have thrown a `TypeError` there, never reaching this line. So by the time execution reaches
   `const enemyAttackers = input.enemyAttackers`, the guard has already proven the value is a
   non-nullish, non-empty array. (This exact dereference-before-nullish-check gap is precisely what
   produces the 4 "other reason" `TypeError`s in the inventory below — see that section.)
2. `enemyAttackers.length ? placeSide(...) : []` (the length-gated ternary): dead for the same
   reason — `enemyAttackers` at that point is the guard-checked, provably-non-empty array, so the
   `: []` branch is unreachable. Confirmed empirically, not just by inspection: `npx tsc --noEmit -p .`
   reports zero errors after the simplification, and the full suite shows no test relying on
   `enemySlots` ever being `[]` post-guard (no failure anywhere mentions an empty `enemySlots`).

## Step 4: the rewritten field doc

`src/utils/combat/engine.ts`, the `enemyAttackers` property on `CombatEngineInput` (located by name;
line numbers have moved during this branch — it now sits a few lines later than the brief's `:1259`
because Task 2b added code above it). Old text (false since SP-4b-1, and the class of stale comment
that produced a confident, wrong CodeRabbit finding on #324):

```ts
    /** Enemy attackers (healing mode): offense-only queue actors bombarding the heal
     *  target. The singular dummy `enemy` remains the player-offense target + DoT carrier.
     *  `defence` and `hp` are optional now (default 0 for bare-stat legacy path); Task 9
     *  populates them with real matchup values via the adapter. */
```

New text:

```ts
    /** The opposing roster — REQUIRED on every run since SP-4b-2b, and never empty (the boundary
     *  throws). Real ships carrying stats + `shipSkills`, positioned by `normalizeCombatRoster`
     *  when they arrive without a slot. A caller with no enemy to model synthesizes an inert one
     *  rather than passing `[]`; see `healingEngineAdapter.practiceTarget`.
     *  `defence` and `hp` are optional now (default 0 for bare-stat legacy path); Task 9
     *  populates them with real matchup values via the adapter. */
```

(Kept the trailing `defence`/`hp` sentence — it is still true and unrelated to the stale claim being
corrected.)

## Step 5: the inventory

`npx vitest run` on the full suite after the guard landed: **528 files / 5838 tests total — 464
files / 5585 tests GREEN, 64 files / 253 tests RED**, every one of them throwing inside
`normalizeCombatRoster`. `npx tsc --noEmit -p .` → 0 errors. `npx eslint` on the three changed files
→ 0 problems. No `.snap` file moved (`git status --short` shows none).

I did not stop at `grep -c "enemyAttackers is empty"` — that undercounts, because the code-frame
vitest prints around a *different* error can itself contain the literal string "enemyAttackers is
empty" (it's quoting the source line that defines the message), which produces a false positive if
you grep the raw log. I parsed the structured "Failed Tests" summary block per-test instead, taking
only the text between the test header and the first stack (`❯`) line as the actual thrown message.
That is how the 3-file/4-test "other reason" population below was found — a naive `grep -c` on the
raw log would have hidden it inside the 253 count.

**Headline: 64 files, 253 tests. 61 files / 249 tests fail with the exact contract message
("(a)" below). 3 files / 4 tests fail for a different reason — a `TypeError`, one line earlier in
the same guard — diagnosed in "(b)" below, not folded into the 249.**

### (a) Fail with the contract message — 61 files / 249 tests

| File | Failing tests |
|---|---|
| `src/utils/calculators/__tests__/rhodiumChakaraDpsModeCredit.integration.test.ts` | 1 |
| `src/utils/combat/__tests__/accumulatorGather.integration.test.ts` | 1 |
| `src/utils/combat/__tests__/actorStats.test.ts` | 3 |
| `src/utils/combat/__tests__/adjacentEnemiesDebuff.integration.test.ts` | 2 |
| `src/utils/combat/__tests__/adjacentEnemiesDot.integration.test.ts` | 1 |
| `src/utils/combat/__tests__/allyDebuffReactivePromotion.integration.test.ts` | 1 |
| `src/utils/combat/__tests__/apexSelfShieldGate.integration.test.ts` | 2 |
| `src/utils/combat/__tests__/applyOutgoingToEnemy.test.ts` | 3 |
| `src/utils/combat/__tests__/blockBuff.test.ts` | 1 |
| `src/utils/combat/__tests__/bombDetonatedVictimId.test.ts` | 1 |
| `src/utils/combat/__tests__/bombModifierExclusion.test.ts` | 1 |
| `src/utils/combat/__tests__/bombSplashOnDeath.integration.test.ts` | 1 |
| `src/utils/combat/__tests__/buffDurationOwnTurnReprieve.test.ts` | 3 |
| `src/utils/combat/__tests__/buffOnlyTeamWalk.integration.test.ts` | 1 |
| `src/utils/combat/__tests__/chargedOverdrive.integration.test.ts` | 5 |
| `src/utils/combat/__tests__/corrosionToAcidicDecay.test.ts` | 2 |
| `src/utils/combat/__tests__/damageChannelAccounting.integration.test.ts` | 2 |
| `src/utils/combat/__tests__/deathFallback.integration.test.ts` | 1 |
| `src/utils/combat/__tests__/decrementUnification.test.ts` | 3 |
| `src/utils/combat/__tests__/demolisherBombSplash.integration.test.ts` | 1 |
| `src/utils/combat/__tests__/destroyedRoundUnification.test.ts` | 1 |
| `src/utils/combat/__tests__/dummyEnemyTurnGate.test.ts` | 1 |
| `src/utils/combat/__tests__/dummyReachability.test.ts` | 1 |
| `src/utils/combat/__tests__/enemiesHitGate.integration.test.ts` | 1 |
| `src/utils/combat/__tests__/enemyBuffSelfDebuffGate.test.ts` | 4 |
| `src/utils/combat/__tests__/enemyDotCountGate.integration.test.ts` | 3 |
| `src/utils/combat/__tests__/engine.events.test.ts` | 36 |
| `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts` | 18 |
| `src/utils/combat/__tests__/forcedAffinityReciprocalGate.integration.test.ts` | 2 |
| `src/utils/combat/__tests__/gearSetDotPair.integration.test.ts` | 4 |
| `src/utils/combat/__tests__/healing.test.ts` | 39 |
| `src/utils/combat/__tests__/healingPerRecipientApply.test.ts` | 6 |
| `src/utils/combat/__tests__/healingPerRecipientAxis.test.ts` | 5 |
| `src/utils/combat/__tests__/hpCrossing.test.ts` | 1 |
| `src/utils/combat/__tests__/indestructibleDeath.test.ts` | 6 |
| `src/utils/combat/__tests__/leech.test.ts` | 8 |
| `src/utils/combat/__tests__/lowestSpeedAlly.test.ts` | 3 |
| `src/utils/combat/__tests__/multiEnemyDotStateReporting.integration.test.ts` | 1 |
| `src/utils/combat/__tests__/outDetonationDamageUpBuff.integration.test.ts` | 3 |
| `src/utils/combat/__tests__/outgoingAmplificationEngine.test.ts` | 1 |
| `src/utils/combat/__tests__/overloadLifecycle.test.ts` | 4 |
| `src/utils/combat/__tests__/ownCleanseReactivePromotion.integration.test.ts` | 2 |
| `src/utils/combat/__tests__/perActorIncomingSurface.test.ts` | 1 |
| `src/utils/combat/__tests__/perActorShield.test.ts` | 1 |
| `src/utils/combat/__tests__/perVictimDotTick.integration.test.ts` | 1 |
| `src/utils/combat/__tests__/perVictimPlayerTimedDetonation.integration.test.ts` | 2 |
| `src/utils/combat/__tests__/perVictimTimedDetonation.integration.test.ts` | 1 |
| `src/utils/combat/__tests__/preFightModifiersEngine.test.ts` | 4 |
| `src/utils/combat/__tests__/procChanceGate.test.ts` | 4 |
| `src/utils/combat/__tests__/purgeConditionalSources.test.ts` | 2 |
| `src/utils/combat/__tests__/reactiveShieldRouting.test.ts` | 1 |
| `src/utils/combat/__tests__/runModeEquivalence.test.ts` | 6 |
| `src/utils/combat/__tests__/shieldAppliedEvent.test.ts` | 3 |
| `src/utils/combat/__tests__/shieldGrantBattleSim.test.ts` | 1 |
| `src/utils/combat/__tests__/shieldPenetration.test.ts` | 4 |
| `src/utils/combat/__tests__/statVsTargetGate.integration.test.ts` | 3 |
| `src/utils/combat/__tests__/teamAuraDistribution.integration.test.ts` | 3 |
| `src/utils/combat/__tests__/triggers.test.ts` | 23 |
| `src/utils/combat/__tests__/victimEnemyModifiers.test.ts` | 1 |
| `src/utils/combat/__tests__/wave7WardenDebuffInflicted.integration.test.ts` | 1 |
| `src/utils/combat/__tests__/wildfireTeamAuraCritPower.integration.test.ts` | 1 |

Total: 61 files, 249 tests.

### (b) Fail for a DIFFERENT reason — 3 files / 4 tests, one root cause

All four throw `TypeError: Cannot read properties of undefined (reading 'length')` from
`normalizeRoster.ts:98` (`input.enemyAttackers.length`) — the guard's own dereference, one line
*before* it can construct the contract `Error`. Root cause: these three fixtures don't set
`enemyAttackers: []`; they omit the key entirely (or set it to `undefined` explicitly) and hide the
missing required field from `tsc` behind an `as CombatEngineInput` cast, so `input.enemyAttackers`
is `undefined` at runtime, not `[]`. The brief's guard code is `input.enemyAttackers.length === 0`
verbatim — it doesn't defend against `undefined`, only against an empty array — so this shape falls
through to a raw property-access crash instead of the intended message.

This is the same behavioural population the guard is meant to catch (a fixture secretly running
without an opponent), just manifesting as a different crash because the guard, as specified, assumes
its input is at least an array. Not fixed here per the brief's explicit instruction not to touch the
failing fixtures — Tasks 4-6 give these three a real enemy exactly like the other 61, they'll simply
see a `TypeError` rather than the contract message until then.

| File | Test | Diagnosis |
|---|---|---|
| `src/utils/combat/__tests__/normalizeRoster.test.ts` | `normalizeCombatRoster — auto-placement > leaves an empty enemy roster empty — it never invents an enemy` (line 93-96) | Calls `normalizeCombatRoster(baseInput())`; `baseInput()`'s factory (line 14-35) never sets `enemyAttackers`, cast via `as CombatEngineInput`. The test's own premise — the boundary tolerates and preserves an empty roster — is exactly the old contract SP-4b-2b reverses; the test is now asserting behaviour that no longer exists, not exercising a bug. |
| `src/utils/combat/__tests__/perVictimWalkedTeamDetonation.integration.test.ts` | `per-victim skill-triggered detonation (positional WALKED-TEAM ally → enemy) > REGRESSION: a NON-positional walked-team detonate still surfaces detonationDamage via the legacy aggregate path` (line 331) | Sets `enemyAttackers: undefined` explicitly, with its own comment: "No positioned enemy victims; the lone enemy is the dummy sink (no enemyAttackers)." This fixture was deliberately invoking the dummy fallback — exactly the behaviour this epic is deleting. |
| `src/utils/combat/__tests__/shieldBasisSecondaryDamage.integration.test.ts` | both tests in `PR9a: shield-basis additional damage reads the LIVE caster shieldPool at cast time` (lines 110, 133) | `runCombat({ ...CLEAN_MATH, ... } as CombatEngineInput)` in both calls never sets `enemyAttackers`; the cast hides the missing required field from `tsc`. |

### Discrepancy vs. the brief's "~20 files" estimate — reconciled, not a defect

The brief predicted ~20 files "measured at 39d463f1" (this epic's base commit). The measured number
on this branch is **64 files**. This is a real branch-state difference, not a miscount:
`progress.md`'s own "Measured at 39d463f1" section says "Exactly 20 files pass no `enemyAttackers`
at all" — but that count is from *before* Task 1 landed, when the field was still optional, and it
counts fixtures that omitted the key entirely. Task 1 (commit `4104adbc`) made the field required and,
to keep `tsc` green, mechanically added `enemyAttackers: []` to **148 call sites across 118 files**
(confirmed via `git show --stat 4104adbc` / `git show 4104adbc | grep -c 'enemyAttackers: \[\]'`).
That codemod is exactly what grew the population Task 3's guard now catches — 20 was the right answer
to a different (pre-Task-1) question; 64 is the real number for this branch today. **Tasks 4-6 should
plan around 64 files / 253 tests, not 20.**

### Production-safety check (per the brief's item 4)

Confirmed none of the 64 failing files is a production caller: all 64 paths are under `__tests__/`
directories (`.test.ts` / `.integration.test.ts`), verified against the full file list above and by
grep for `battleSimulator.ts`, `dpsSimulator.ts`, `healingEngineAdapter.ts` in the failure list (zero
matches). Each production caller was independently re-checked against the current tree:

- `battleSimulator.ts:830` throws its own `simulateBattle: enemyTeam is empty` before ever
  calling `runCombat`, so it can't reach the new guard with an empty roster.
- `dpsSimulator.ts:500-502` computes `effectiveEnemyAttackers` — `input.enemyAttackers?.length ?
  input.enemyAttackers : [synthesized]` — so `runCombat` always receives at least the synthesized
  enemy.
- `healingEngineAdapter.ts:634` passes `engineEnemyAttackers`, which Task 2 populates with the
  practice target whenever the caller supplies no real enemy; never `[]`.

No production path hits the throw. This confirms note 4 from the task brief — nothing user-facing
should break — holds on this branch.

## Commit

```
9cfd4c1e feat(engine): an empty enemy roster is a validation error
```
(committed with `--no-verify`, per the brief — husky's pre-commit runs the full suite, which is red
on purpose in this task).

Files changed: `src/utils/combat/normalizeRoster.ts`, `src/utils/combat/engine.ts`,
`src/utils/combat/__tests__/normalizationBoundary.integration.test.ts`, `.superpowers/sdd/progress.md`,
`.superpowers/sdd/task-3-report.md`.
