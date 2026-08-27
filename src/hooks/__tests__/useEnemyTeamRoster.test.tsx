import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEnemyTeamRoster } from '../useEnemyTeamRoster';
import type { Position } from '../../types/encounters';

vi.mock('../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [], getShipById: () => undefined }),
}));
vi.mock('../../contexts/InventoryProvider', () => ({
    useInventory: () => ({ getGearPiece: () => undefined }),
}));
vi.mock('../useEngineeringStats', () => ({
    useEngineeringStats: () => ({ getEngineeringStatsForShipType: () => undefined }),
}));

const HEALING_OPTS = {
    minTeamShips: 1 as const,
    enemyIdSeed: 2,
    teamIdSeed: 2,
    defaultTeamSlot: (i: number) => (['M1', 'M2', 'M3', 'B1'] as Position[])[i] ?? 'M1',
    initialTeamShips: [
        {
            id: 'team-1',
            buffs: [],
            enemyDebuffs: [],
            startCharged: false,
            speed: 100,
            chargeCount: 0,
        },
    ],
};
const DEFENSE_OPTS = { minTeamShips: 0 as const, enemyIdSeed: 1, teamIdSeed: 1 };

describe('useEnemyTeamRoster', () => {
    it('enemyIdSeed decides the first added enemy label', () => {
        const defense = renderHook(() => useEnemyTeamRoster(DEFENSE_OPTS));
        act(() => defense.result.current.addEnemy());
        expect(defense.result.current.enemies[0].name).toBe('Enemy 1');

        const healing = renderHook(() => useEnemyTeamRoster(HEALING_OPTS));
        act(() => healing.result.current.addEnemy());
        expect(healing.result.current.enemies[0].name).toBe('Enemy 2');
    });

    it('addEnemy never seeds a colliding cell', () => {
        const { result } = renderHook(() => useEnemyTeamRoster(DEFENSE_OPTS));
        act(() => result.current.addEnemy());
        act(() => result.current.addEnemy());
        act(() => result.current.addEnemy());
        const cells = result.current.enemies.map((e) => e.position);
        expect(new Set(cells).size).toBe(cells.length);
    });

    it('minTeamShips: 0 lets the team roster be emptied', () => {
        const { result } = renderHook(() => useEnemyTeamRoster(DEFENSE_OPTS));
        act(() => result.current.addTeamShip());
        expect(result.current.teamShips).toHaveLength(1);
        const id = result.current.teamShips[0].id;
        act(() => result.current.removeTeamShip(id));
        expect(result.current.teamShips).toHaveLength(0);
    });

    it('minTeamShips: 1 RESETS the last team ship instead of deleting it, keeping its cell as-is', () => {
        const { result } = renderHook(() => useEnemyTeamRoster(HEALING_OPTS));
        act(() => result.current.updateTeamShip('team-1', { speed: 175, startCharged: true }));
        expect(result.current.teamShips[0].speed).toBe(175);

        act(() => result.current.removeTeamShip('team-1'));
        expect(result.current.teamShips).toHaveLength(1);
        expect(result.current.teamShips[0].speed).toBe(100);
        expect(result.current.teamShips[0].startCharged).toBe(false);
        expect(result.current.teamShips[0].buffs).toEqual([]);
        // An untouched ship must NOT gain an explicit cell just because the roster shrank.
        expect(result.current.teamShips[0].position).toBeUndefined();
    });

    it('addTeamShip caps the roster at 4 and does NOT set a position', () => {
        const { result } = renderHook(() => useEnemyTeamRoster(DEFENSE_OPTS));
        for (let i = 0; i < 6; i++) act(() => result.current.addTeamShip());
        expect(result.current.teamShips).toHaveLength(4);
        expect(result.current.teamShips.every((t) => t.position === undefined)).toBe(true);
    });

    it('omitting defaultTeamSlot omits the slot handlers', () => {
        const { result } = renderHook(() => useEnemyTeamRoster(DEFENSE_OPTS));
        expect(result.current.teamShipSlot).toBeUndefined();
        expect(result.current.changeTeamShipSlot).toBeUndefined();
    });

    it('changeTeamShipSlot SWAPS with the occupant rather than stacking two ships on one cell', () => {
        const { result } = renderHook(() => useEnemyTeamRoster(HEALING_OPTS));
        act(() => result.current.addTeamShip());
        const [a, b] = result.current.teamShips.map((t) => t.id);
        // b sits on its index default M2; move a onto M2 and b must take a's old M1.
        act(() => result.current.changeTeamShipSlot!(a, 'M2'));
        expect(result.current.teamShips.find((t) => t.id === a)!.position).toBe('M2');
        expect(result.current.teamShips.find((t) => t.id === b)!.position).toBe('M1');
    });

    it('enemyInputs carries BOTH target and pattern keys for every enemy', () => {
        const { result } = renderHook(() => useEnemyTeamRoster(DEFENSE_OPTS));
        act(() => result.current.addEnemy());
        const input = result.current.enemyInputs[0];
        // A missing `pattern` fails SILENTLY: the positional-apply gate needs both, and without
        // it nothing is credited per-victim while the damage number still looks plausible.
        expect(Object.keys(input)).toContain('target');
        expect(Object.keys(input)).toContain('pattern');
        expect(Object.keys(input)).toContain('chargedTarget');
        expect(Object.keys(input)).toContain('chargedPattern');
    });

    it('teamActors omits `position` entirely for an unplaced ship', () => {
        const { result } = renderHook(() => useEnemyTeamRoster(HEALING_OPTS));
        // Presence of `position` means "the user picked this cell" — sending the index default
        // makes every untouched ship look deliberate and can evict the heal target.
        expect('position' in result.current.teamActors[0]).toBe(false);
    });
});
