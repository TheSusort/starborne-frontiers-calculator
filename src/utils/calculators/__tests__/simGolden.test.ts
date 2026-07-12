import { describe, it, expect } from 'vitest';
import { simulateBattle } from '../battleSimulator';
import { twoVsTwo, threeVsThree, dpsMode, healingMode } from './__fixtures__/simGoldenFixtures';

// High-level regression guard for the engine-unification epic. A diff = a real behavior change.
// vitest -u is FORBIDDEN except a deliberate, audited fidelity move (SP-F).
describe('sim goldens (BattleResult snapshots)', () => {
    it.each([
        ['2v2', twoVsTwo],
        ['3v3', threeVsThree],
        ['dps', dpsMode],
        ['healing', healingMode],
    ])('%s', (_n, build) => {
        // Snapshot the structured result (per-round per-ship totals + outcome), not the free-text log.
        const { rounds, outcome, roster } = simulateBattle(build());
        expect({ rounds, outcome, roster }).toMatchSnapshot();
    });
});
