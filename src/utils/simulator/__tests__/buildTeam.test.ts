import { describe, it, expect } from 'vitest';
import { buildTeam } from '../buildTeam';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import type { Ship } from '../../../types/ship';
import { bossShip } from '../../../constants/bountyBosses';

// `type` is set so the engineering lookup takes its real branch; `deps` returns undefined for it,
// which is the un-engineered case. `calculateTotalStats` defaults refits/implants, so a hollow
// ship resolves without throwing.
const ship = (id: string, name: string): Ship =>
    ({
        id,
        name,
        type: 'ATTACKER',
        baseStats: { attack: 1000, hp: 10000, defence: 500, speed: 100, crit: 10, critDamage: 150 },
        equipment: {},
        refits: [],
        implants: {},
    }) as unknown as Ship;

const deps = {
    getGearPiece: () => undefined,
    getEngineeringStatsForShipType: () => undefined,
};

describe('buildTeam', () => {
    it('orders placements by board position, not by insertion order', () => {
        // Insertion order here is M2 then T1. Player index 0 becomes the engine's FOCUS_ID, so
        // click order must not decide which ship is the focus — otherwise removing and
        // re-placing a ship moves focus and changes results for a reason unrelated to the tweak
        // under test.
        const board: BoardState = {
            M2: { ship: ship('b', 'Second') },
            T1: { ship: ship('a', 'First') },
        };
        expect(buildTeam(board, deps).map((p) => p.position)).toEqual(['T1', 'M2']);
    });

    it('passes the fully resolved stat block, never bare base stats', () => {
        const board: BoardState = { T1: { ship: ship('a', 'First') } };
        const [placement] = buildTeam(board, deps);
        expect(placement.statOverrides).toBeDefined();
        expect(placement.statOverrides?.attack).toBeGreaterThan(0);
        expect(placement.statOverrides?.speed).toBeGreaterThan(0);
    });

    it('lets a placement override win field-by-field over the resolved block', () => {
        const board: BoardState = {
            T1: { ship: ship('a', 'First'), overrides: { attack: 99999 } },
        };
        const [placement] = buildTeam(board, deps);
        expect(placement.statOverrides?.attack).toBe(99999);
        // Untouched stats still come from the resolution, not from the override record.
        expect(placement.statOverrides?.speed).toBeGreaterThan(0);
    });

    it('leaves an un-overridden placement identical to one with an empty override record', () => {
        const bare = buildTeam({ T1: { ship: ship('a', 'x') } }, deps);
        const empty = buildTeam({ T1: { ship: ship('a', 'x'), overrides: {} } }, deps);
        expect(bare[0].statOverrides).toEqual(empty[0].statOverrides);
    });
});

describe('buildTeam — bounty boss footprint', () => {
    it('a boss placement carries the boss footprint; an ordinary ship carries none', () => {
        const board: BoardState = {
            M1: { ship: bossShip('fenri', 32)! },
            T3: { ship: ship('a', 'First') },
        };
        const team = buildTeam(board, deps);
        expect(team.find((p) => p.position === 'M1')?.footprint).toEqual(['M1', 'M2']);
        expect(team.find((p) => p.position === 'T3')).not.toHaveProperty('footprint');
    });

    it('a boss placed anywhere but its anchor cell is rejected', () => {
        const board: BoardState = { T3: { ship: bossShip('fenri', 32)! } };
        expect(() => buildTeam(board, deps)).toThrow(/must be placed at its anchor M1, not T3/);
    });
});
