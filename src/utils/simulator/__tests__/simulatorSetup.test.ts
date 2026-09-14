import { describe, it, expect } from 'vitest';
import { serializeSetup, deserializeSetup, SIMULATOR_SETUP_VERSION } from '../simulatorSetup';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import type { Ship } from '../../../types/ship';

const ship = (id: string, name: string) => ({ id, name }) as unknown as Ship;
const owned = ship('owned-1', 'Owned');
const reference = ship('template:tmpl-1:refitted', 'Reference');

const playerBoard: BoardState = {
    T1: { ship: owned, overrides: { speed: 150 } },
    M2: { ship: reference },
    // An empty override object is the alternate spelling of "no overrides"; it must not survive.
    B3: { ship: owned, overrides: {} },
};
const enemyBoard: BoardState = { T4: { ship: reference, overrides: { hp: 9000 } } };

const args = {
    name: 'My Setup',
    playerBoard,
    enemyBoard,
    playerSquadLeader: { faction: 'TERRAN', name: 'Someone', stage: 2 } as const,
    enemySquadLeader: undefined,
    seed: 424242,
    runCount: 20,
    savedAt: 1_700_000_000_000,
};

const resolveAll = (id: string) =>
    id === owned.id ? owned : id === reference.id ? reference : null;

describe('serializeSetup', () => {
    it('carries ship ids, overrides, leaders, seed and run count', () => {
        const setup = serializeSetup(args);
        expect(setup.version).toBe(SIMULATOR_SETUP_VERSION);
        expect(setup.name).toBe('My Setup');
        expect(setup.seed).toBe(424242);
        expect(setup.runCount).toBe(20);
        expect(setup.savedAt).toBe(1_700_000_000_000);
        expect(setup.playerBoard.T1).toEqual({ shipId: 'owned-1', overrides: { speed: 150 } });
        expect(setup.enemyBoard.T4).toEqual({
            shipId: 'template:tmpl-1:refitted',
            overrides: { hp: 9000 },
        });
        expect(setup.playerSquadLeader).toEqual({ faction: 'TERRAN', name: 'Someone', stage: 2 });
        expect(setup.enemySquadLeader).toBeUndefined();
    });

    it('omits overrides entirely for a placement that carries none', () => {
        const setup = serializeSetup(args);
        expect(setup.playerBoard.M2).toEqual({ shipId: 'template:tmpl-1:refitted' });
        expect('overrides' in setup.playerBoard.M2!).toBe(false);
        expect('overrides' in setup.playerBoard.B3!).toBe(false);
    });
});

describe('deserializeSetup', () => {
    it('round-trips a setup back to equivalent boards', () => {
        const result = deserializeSetup(serializeSetup(args), resolveAll);
        expect(result.dropped).toEqual([]);
        expect(result.playerBoard.T1).toEqual({ ship: owned, overrides: { speed: 150 } });
        expect(result.playerBoard.M2).toEqual({ ship: reference, overrides: undefined });
        expect(result.enemyBoard.T4).toEqual({ ship: reference, overrides: { hp: 9000 } });
        expect(result.seed).toBe(424242);
        expect(result.runCount).toBe(20);
        expect(result.playerSquadLeader).toEqual({ faction: 'TERRAN', name: 'Someone', stage: 2 });
    });

    it('drops a cell whose ship id no longer resolves and reports it, keeping the rest', () => {
        const resolveOnlyReference = (id: string) => (id === reference.id ? reference : null);
        const result = deserializeSetup(serializeSetup(args), resolveOnlyReference);
        expect(result.playerBoard.T1).toBeUndefined();
        expect(result.playerBoard.B3).toBeUndefined();
        expect(result.playerBoard.M2).toBeDefined();
        expect(result.enemyBoard.T4).toBeDefined();
        expect(result.dropped).toEqual([
            { side: 'player', position: 'T1' },
            { side: 'player', position: 'B3' },
        ]);
    });

    it('does not throw when every ship id dangles', () => {
        const result = deserializeSetup(serializeSetup(args), () => null);
        expect(result.playerBoard).toEqual({});
        expect(result.enemyBoard).toEqual({});
        expect(result.dropped).toHaveLength(4);
    });
});
