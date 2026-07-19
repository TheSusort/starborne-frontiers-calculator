import { describe, it, expect } from 'vitest';
import { runSeededBattle } from '../seededBattle';
import { canonicalPlacement } from '../fixtures';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import type { BattleSimulationInput } from '../../../calculators/battleSimulator';
import type { Ship } from '../../../../types/ship';

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
});
