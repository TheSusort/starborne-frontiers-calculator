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
    healUnequalPerRecipient,
    healModifierScaling,
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
        // SP-F F2: dedicated per-recipient healing fixture — see the dedicated assertion below.
        ['healUnequalPerRecipient', healUnequalPerRecipient],
        // SP-F F4: dedicated heal-modifier scaling fixture — see the dedicated assertion below.
        ['healModifierScaling', healModifierScaling],
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

    // SP-F F2: dedicated per-recipient healing invariant (beyond the snapshot) — proves
    // `ShipRoundState.healingReceived` is sourced from `heal-performed.perTarget` (the engine's
    // real per-recipient breakdown), not an even split of the cast's total across recipients.
    // `healUnequalPerRecipient`'s three player ships have distinct Max HP and the healer's
    // active is an EXPLICIT "repairs all allies for 20% of their Max HP" cast (target-hp
    // basis — see the fixture's doc comment), so each recipient's true share is exactly 20% of
    // its OWN Max HP — three different numbers from the SAME cast. An even split would instead
    // give every recipient the same (wrong) average share.
    it("healUnequalPerRecipient: per-recipient healingReceived is each ship's own 20% Max HP share, not an even split (F2)", () => {
        const { rounds } = simulateBattle(healUnequalPerRecipient());
        expect(rounds.length).toBeGreaterThan(0);

        // Known fixture Max HPs (simGoldenFixtures.ts) — the healer's crit is pinned to 0, so
        // the heal never crits and every casting round's share is exactly 20% of Max HP with
        // no RNG-dependent multiplier to account for. Roster actorIds follow simulateBattle's
        // minting scheme (battleSimulator.ts ~L709-730): player[0] is ALWAYS the reserved
        // `'attacker'` id (the fixture's healer, first in `playerTeam`); the rest are
        // `p:<shipId>:<idx>` (1-based).
        const maxHp: Record<string, number> = {
            attacker: 220_000, // f2-healer
            'p:f2-front:1': 260_000,
            'p:f2-rear:2': 100_000,
        };
        const expectedShare = (id: string) => maxHp[id] * 0.2;

        let anyRoundChecked = false;
        for (const round of rounds) {
            const byId = new Map(round.ships.map((s) => [s.actorId, s]));
            const healer = byId.get('attacker');
            const front = byId.get('p:f2-front:1');
            const rear = byId.get('p:f2-rear:2');
            if (!healer || !front || !rear) continue;
            // Only assert in a round the heal actually fired this round.
            if (
                healer.healingReceived === 0 &&
                front.healingReceived === 0 &&
                rear.healingReceived === 0
            ) {
                continue;
            }
            anyRoundChecked = true;

            // Each recipient's OWN 20%-of-its-own-Max-HP share.
            expect(healer.healingReceived).toBeCloseTo(expectedShare('attacker'), 6);
            expect(front.healingReceived).toBeCloseTo(expectedShare('p:f2-front:1'), 6);
            expect(rear.healingReceived).toBeCloseTo(expectedShare('p:f2-rear:2'), 6);

            // Not an even split: three distinct Max HPs -> three genuinely distinct shares.
            expect(front.healingReceived).not.toBeCloseTo(rear.healingReceived, 0);
            expect(healer.healingReceived).not.toBeCloseTo(front.healingReceived, 0);
            expect(healer.healingReceived).not.toBeCloseTo(rear.healingReceived, 0);
        }
        // Non-vacuous: at least one round actually exercised the heal.
        expect(anyRoundChecked).toBe(true);
    });

    // SP-F F4: heal-modifier scaling (beyond the snapshot) — proves the per-ship `healModifier`
    // stat is threaded from the sim adapter into the engine and folds into heal casts as
    // `(1 + healModifier/100)`, on BOTH sides. Before F4 the adapter dropped the stat entirely
    // (0 in `battleSimulator.ts`) and the engine's enemy runtime builder hard-coded
    // `healModifier: 0`, so a simulated healer's output ignored its heal-modifier. Isolate each
    // side by toggling ONLY that side's modifier (50 vs 0) while holding the other at 0, and
    // sum that side's healingReceived across the run: the ratio must be exactly 1.5. The enemy
    // leg specifically exercises the engine.ts enemy-builder fix (team symmetry).
    it("healModifierScaling: a side's healingReceived scales by (1 + healModifier/100), both sides (F4)", () => {
        const sumSideHealing = (
            input: ReturnType<typeof healModifierScaling>,
            side: 'player' | 'enemy'
        ) => {
            const { rounds } = simulateBattle(input);
            let total = 0;
            for (const r of rounds) {
                for (const s of r.ships) {
                    if (s.side === side) total += s.healingReceived;
                }
            }
            return total;
        };

        // Player side: modifier ON (50) vs OFF (0), enemy held at 0 in both runs.
        const pOn = sumSideHealing(
            healModifierScaling({ playerHealModifier: 50, enemyHealModifier: 0 }),
            'player'
        );
        const pOff = sumSideHealing(
            healModifierScaling({ playerHealModifier: 0, enemyHealModifier: 0 }),
            'player'
        );
        expect(pOff).toBeGreaterThan(0);
        expect(pOn / pOff).toBeCloseTo(1.5, 5);

        // Enemy side: proves the engine's enemy runtime builder now folds healModifier (was
        // hard-coded 0 before F4). Player held at 0 in both runs.
        const eOn = sumSideHealing(
            healModifierScaling({ playerHealModifier: 0, enemyHealModifier: 50 }),
            'enemy'
        );
        const eOff = sumSideHealing(
            healModifierScaling({ playerHealModifier: 0, enemyHealModifier: 0 }),
            'enemy'
        );
        expect(eOff).toBeGreaterThan(0);
        expect(eOn / eOff).toBeCloseTo(1.5, 5);
    });
});
