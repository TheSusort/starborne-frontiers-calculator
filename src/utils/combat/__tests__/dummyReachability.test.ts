/**
 * SP-4b-1 → SP-4c gate. Cluster C (`selected ?? tb.legacyVictim`) is the KEYSTONE: once nothing
 * takes that fallback, clusters B/D/E/F/G fall out behind it and 4c is pure deletion.
 *
 * This file pins what 4b-1 can actually guarantee: a run with a NON-EMPTY enemy roster never takes
 * it.
 *
 * SP-4b-2b UPDATE. 4b-2b did the promised job: an empty roster is now refused at the normalization
 * boundary, so "a run with no enemy still takes the fallback" is no longer a reachable state and the
 * second test asserts the REFUSAL instead. That cost this file its own vacuity guard — the old
 * second test's `> 0` reading was what proved the counter was wired at all. See that test's comment
 * for where the surviving liveness evidence lives, and note that Task 7 of this PR re-homes it here.
 *
 * ⚠️ READ BEFORE TREATING A ZERO HERE AS 4c's GO-AHEAD. This file is NOT sufficient on its own,
 * for two independent reasons:
 *
 *  1. **Coverage.** It exercises `bareInput()` — one focus-attacker damage path — plus an empty
 *     roster. It does NOT exercise team-actor turns, enemy turns, corpse targeting, death
 *     retargeting, or walked-team damage. A zero here means "this shape does not reach the
 *     fallback", never "no shape does". Broaden it across those paths before 4c leans on it.
 *     (Raised on PR #324 and correct.)
 *  2. **Semantics.** The counter records CONSULTATIONS of `tb.legacyVictim`, not credits to the
 *     legacy sink. The two come apart: in the mid-run whiff window the fallback is consulted and
 *     nothing is booked, so the count is legitimately non-zero while no damage routes to the sink.
 *     4c must handle that path rather than expect a global zero.
 *
 * Both are recorded in `.superpowers/sdd/progress.md` under "Residual for SP-4c".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    runCombat,
    __getLegacyVictimFallbackCount,
    __resetLegacyVictimFallbackCount,
} from '../engine';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
// Fixtures live in __testutils__, NOT in the other test file. Importing from a `.test.ts`
// module executes its `describe` blocks as an import side effect — the suites would run twice,
// under two different files, with two different seeds.
import { bareInput } from '../__testutils__/bareRosterFixture';

describe('dummy reachability after normalization', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        __resetLegacyVictimFallbackCount();
    });

    it('never takes the legacyVictim fallback when an enemy roster is supplied', () => {
        runCombat(bareInput());
        expect(__getLegacyVictimFallbackCount()).toBe(0);
    });

    // SP-4b-2b INVERTED THIS TEST. It used to read "STILL takes it with an empty roster — 4b-2
    // closes this, and the counter proves it is live", running an empty-roster fight and asserting
    // `__getLegacyVictimFallbackCount() > 0`. 4b-2b is that closure: the empty roster is now
    // refused at the normalization boundary, so the shape that reached the fallback no longer
    // exists and the old premise is illegal by contract.
    //
    // ⚠️ WHAT THIS COSTS. That assertion carried a second, unrelated job: it was the LIVENESS
    // PROOF for the counter, i.e. the reason the test above's `toBe(0)` cannot pass merely because
    // `__getLegacyVictimFallbackCount` was never wired to anything. A throw-assertion does not
    // observe the counter at all, so that proof does NOT survive here.
    //
    // Sibling coverage that does keep the counter honest: `damageChannelAccounting.integration
    // .test.ts` → "a never-targetable PLAYER roster is a CORPSE, so the enemy whiffs" asserts
    // `__getLegacyVictimFallbackCount()` is exactly `ROUNDS` (4) — a real, non-zero, exactly-pinned
    // reading through `runCombat`. So a counter stuck at 0 still fails the suite, just from another
    // file. Task 7 of this PR re-homes the liveness proof into THIS file and widens it with a
    // sink-CREDIT counter (the counter here records CONSULTATIONS, which is the second caveat in
    // this file's header).
    it('REFUSES an empty roster outright — the shape that reached the fallback is now illegal', () => {
        const noEnemy = { ...bareInput(), enemyAttackers: [] };
        expect(() => runCombat(noEnemy)).toThrow(/enemyAttackers is empty/);
    });
});
