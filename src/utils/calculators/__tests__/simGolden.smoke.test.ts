// SP-0, Task 5: smoke test for the four sim-golden fixtures. Confirms each fixture runs
// through `simulateBattle` and produces a well-formed `BattleResult` (non-empty roster,
// at least one round, a valid outcome winner). Task 6 snapshots these fixtures — this test
// intentionally does NOT snapshot; it only guards well-formedness.
import { describe, it, expect } from 'vitest';
import { simulateBattle } from '../battleSimulator';
import { twoVsTwo, threeVsThree, dpsMode, healingMode } from './__fixtures__/simGoldenFixtures';

describe('sim-golden fixtures run', () => {
    it.each([
        ['2v2', twoVsTwo],
        ['3v3', threeVsThree],
        ['dps', dpsMode],
        ['heal', healingMode],
    ] as const)('%s produces a well-formed BattleResult', (_name, build) => {
        const r = simulateBattle(build());
        expect(r.roster.length).toBeGreaterThan(0);
        expect(r.rounds.length).toBeGreaterThan(0);
        expect(['player', 'enemy', 'draw']).toContain(r.outcome.winner);
    });
});
