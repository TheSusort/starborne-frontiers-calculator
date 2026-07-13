import { describe, it, expect } from 'vitest';
import { simulateBattle } from '../battleSimulator';
import {
    twoVsTwo,
    threeVsThree,
    dpsMode,
    healingMode,
    deathPath,
    healCasting,
    f1Reconciliation,
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
        // SP-F F1: dedicated AoE reconciliation fixture — see the intent-guard test below.
        ['f1Reconciliation', f1Reconciliation],
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

    // SP-F F1: round-level reconciliation invariant (beyond the snapshot) — generic, no
    // hardcoded attacker/victim ids. `damageDealt` and `damageTaken` are two marginal sums of
    // the SAME per-attacker×victim `perTargetDealt` matrix (Σ over victims for one attacker's
    // row == damageDealt; Σ over attackers for one victim's column == damageTaken/
    // perTargetDamage) — so summing EITHER field over every ship in a round must produce the
    // SAME total, regardless of how many attackers/victims/AoE footprints are involved.
    // Exercised on f1Reconciliation (dedicated AoE fixture) AND threeVsThree/twoVsTwo (already
    // cover Pattern-All AoE, counterattack, bomb detonation, and DoT-tick attribution) as a
    // belt-and-suspenders check that the invariant holds across every mirrored channel.
    it.each([
        ['f1Reconciliation', f1Reconciliation],
        ['threeVsThree', threeVsThree],
        ['twoVsTwo', twoVsTwo],
    ])('%s: Σ damageDealt == Σ damageTaken for every round (F1 reconciliation)', (_n, build) => {
        const { rounds } = simulateBattle(build());
        expect(rounds.length).toBeGreaterThan(0);
        let anyNonZeroRound = false;
        for (const round of rounds) {
            const totalDealt = round.ships.reduce((s, ship) => s + ship.damageDealt, 0);
            const totalTaken = round.ships.reduce((s, ship) => s + ship.damageTaken, 0);
            if (totalDealt > 0 || totalTaken > 0) anyNonZeroRound = true;
            expect(totalDealt).toBeCloseTo(totalTaken, 6);
        }
        // Non-vacuous: at least one round actually had damage flowing.
        expect(anyNonZeroRound).toBe(true);
    });
});
