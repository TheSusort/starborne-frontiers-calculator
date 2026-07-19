import { describe, it, expect, vi } from 'vitest';
import { runSeededBattle } from '../seededBattle';
import { canonicalPlacement } from '../fixtures';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import type { BattleSimulationInput } from '../../../calculators/battleSimulator';
import type { Ship } from '../../../../types/ship';
import * as rateAccumulator from '../../../calculators/rateAccumulator';

const battle = (): BattleSimulationInput => ({
    playerTeam: [canonicalPlacement(buildTraceShip('Demolisher') as Ship, 'T1')],
    enemyTeam: [canonicalPlacement(buildTraceShip('Lodolite') as Ship, 'M2')],
    rounds: 20,
});

describe('runSeededBattle', () => {
    it('is byte-reproducible for the same seed', () => {
        const a = JSON.stringify(runSeededBattle(battle(), 1));
        const b = JSON.stringify(runSeededBattle(battle(), 1));
        expect(a).toBe(b);
    });

    it('differs across seeds (RNG actually flows)', () => {
        const a = JSON.stringify(runSeededBattle(battle(), 1));
        const b = JSON.stringify(runSeededBattle(battle(), 2));
        expect(a).not.toBe(b);
    });

    it('resets the RNG (via finally) even when the battle throws', () => {
        // Spy directly on resetRateGateRng so we observe the finally firing, rather than
        // inferring it from later-call behaviour (setupKeyedTestRng unconditionally
        // overwrites the module RNG on every call, so a later runSeededBattle would look
        // fine even if this finally never ran — that was the vacuous version of this test).
        const resetSpy = vi.spyOn(rateAccumulator, 'resetRateGateRng');
        const callsBefore = resetSpy.mock.calls.length;

        const throwingBattle: BattleSimulationInput = { ...battle(), playerTeam: [] };
        expect(() => runSeededBattle(throwingBattle, 1)).toThrow();

        expect(resetSpy.mock.calls.length - callsBefore).toBe(1);

        resetSpy.mockRestore();
    });
});
