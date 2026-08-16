/**
 * SP-4b-1 → SP-4c gate. Cluster C (`selected ?? tb.legacyVictim`) is the KEYSTONE: once nothing
 * takes that fallback, clusters B/D/E/F/G fall out behind it and 4c is pure deletion.
 *
 * This file pins what 4b-1 can actually guarantee: a run with a NON-EMPTY enemy roster never takes
 * it. Runs with no enemy at all still do — that is 4b-2's job, and the second test pins the
 * fallback as still-live so this file cannot silently go vacuous before then.
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

    it('STILL takes it with an empty roster — 4b-2 closes this, and the counter proves it is live', () => {
        // Without this, the assertion above could pass because the counter was never wired.
        const noEnemy = { ...bareInput(), enemyAttackers: [] };
        runCombat(noEnemy);
        expect(__getLegacyVictimFallbackCount()).toBeGreaterThan(0);
    });
});
