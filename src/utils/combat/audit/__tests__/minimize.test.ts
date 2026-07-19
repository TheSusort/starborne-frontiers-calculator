import { describe, it, expect } from 'vitest';
import { minimizeComposition } from '../minimize';
import type { BattleSimulationInput } from '../../../calculators/battleSimulator';

const ph = (id: string, position: string) => ({ ship: { id, name: id }, position }) as never;

describe('minimizeComposition', () => {
    it('shrinks to the smallest ship set that still triggers the predicate', () => {
        const input: BattleSimulationInput = {
            playerTeam: [
                ph('BombShip', 'T1'),
                ph('ReactorShip', 'M2'),
                ph('Filler1', 'B2'),
                ph('Filler2', 'T2'),
            ],
            enemyTeam: [ph('E1', 'T1'), ph('E2', 'M2'), ph('E3', 'B2'), ph('E4', 'T2')],
            rounds: 10,
        };
        const stillFails = (c: BattleSimulationInput) => {
            const names = new Set(c.playerTeam.map((p) => p.ship.id));
            return names.has('BombShip') && names.has('ReactorShip');
        };
        const min = minimizeComposition(input, stillFails);
        expect(min.playerTeam.map((p) => p.ship.id).sort()).toEqual(['BombShip', 'ReactorShip']);
        expect(min.enemyTeam).toHaveLength(1);
    });

    it('never empties a side even when the predicate stays true', () => {
        const input: BattleSimulationInput = {
            playerTeam: [ph('P1', 'T1'), ph('P2', 'M2'), ph('P3', 'B2')],
            enemyTeam: [ph('E1', 'T1'), ph('E2', 'M2')],
            rounds: 10,
        };
        // Predicate always returns true - no reduction condition
        const stillFails = (_c: BattleSimulationInput) => true;
        const min = minimizeComposition(input, stillFails);
        // Should never reduce below 1 ship per side
        expect(min.playerTeam).toHaveLength(1);
        expect(min.enemyTeam).toHaveLength(1);
    });
});
