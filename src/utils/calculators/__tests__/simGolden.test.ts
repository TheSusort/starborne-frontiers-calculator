import { describe, it, expect } from 'vitest';
import { simulateBattle } from '../battleSimulator';
import {
    twoVsTwo,
    threeVsThree,
    dpsMode,
    healingMode,
    deathPath,
    healCasting,
} from './__fixtures__/simGoldenFixtures';

// High-level regression guard for the engine-unification epic. A diff = a real behavior change.
// vitest -u is FORBIDDEN except a deliberate, audited fidelity move (SP-F).
describe('sim goldens (BattleResult snapshots)', () => {
    it.each([
        ['2v2', twoVsTwo],
        ['3v3', threeVsThree],
        ['dps', dpsMode],
        ['healing', healingMode],
        // SP-U U5: a decisive-outcome battle (terminates on a real wipe) and a sim-mode
        // heal-casting battle (locks the R6-decoupled positionalTeamBattle heal routing).
        ['deathPath', deathPath],
        ['healCasting', healCasting],
    ])('%s', (_n, build) => {
        // Snapshot the structured result (per-round per-ship totals + outcome), not the free-text log.
        const { rounds, outcome, roster } = simulateBattle(build());
        expect({ rounds, outcome, roster }).toMatchSnapshot();
    });

    // SP-U U5: intent-guard for the death-path fixture (beyond the snapshot) — it MUST end in a
    // decisive player win on a real wipe strictly inside the window, with ≥1 ship destroyed.
    it('deathPath terminates on a decisive wipe (not a draw)', () => {
        const { rounds, outcome } = simulateBattle(deathPath());
        expect(outcome.winner).toBe('player');
        expect(outcome.winner).not.toBe('draw');
        expect(outcome.lastRound).toBeLessThan(8);
        // At least one ship shows as not-alive (a death) somewhere in the trimmed rounds.
        const anyDeath = rounds.some((r) => r.ships.some((s) => s.alive === false));
        expect(anyDeath).toBe(true);
    });
});
