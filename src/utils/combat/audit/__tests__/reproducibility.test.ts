import { describe, it, expect } from 'vitest';
import { checkReproducibility } from '../reproducibility';
import { canonicalPlacement } from '../fixtures';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import type { BattleSimulationInput } from '../../../calculators/battleSimulator';
import type { Ship } from '../../../../types/ship';

const battle = (): BattleSimulationInput => ({
    playerTeam: [canonicalPlacement(buildTraceShip('Demolisher') as Ship, 'T1')],
    enemyTeam: [canonicalPlacement(buildTraceShip('Lodolite') as Ship, 'M2')],
    rounds: 20,
});

describe('checkReproducibility', () => {
    it('returns no violation for a seeded battle (byte-reproducible)', () => {
        expect(checkReproducibility(battle(), 1)).toEqual([]);
    });
});
