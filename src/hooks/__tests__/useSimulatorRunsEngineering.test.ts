/**
 * The player's engineering applies on BOTH boards of the combat simulator (owner ruling
 * 2026-10-22), including a ship the player puts on the enemy board: `useSimulatorRuns` builds
 * both teams from the same `statsDeps`. A ship with 1,000 attack under +10% Attacker
 * engineering enters the fight with 1,100 attack on either side.
 *
 * Real stat resolution (`buildTeam` → `combatStatsFromShip`); only the battle run is stubbed, to
 * capture the engine input the hook builds.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSimulatorRuns } from '../useSimulatorRuns';
import type { BattleResult, BattleSimulationInput } from '../../utils/calculators/battleSimulator';
import type { Ship } from '../../types/ship';
import type { EngineeringStat } from '../../types/stats';

const ran: BattleSimulationInput[] = [];
vi.mock('../../utils/simulator/seededRuns', () => ({
    runSeededBattle: (input: BattleSimulationInput): BattleResult => {
        ran.push(input);
        return {
            rounds: [],
            outcome: { winner: 'enemy', lastRound: 0 },
            roster: [],
            combatLog: [],
        };
    },
    runSeedSetAsync: async () => null,
}));

const ship = (id: string): Ship => ({
    id,
    name: id,
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    baseStats: {
        hp: 10_000,
        attack: 1000,
        defence: 1000,
        hacking: 100,
        security: 100,
        crit: 10,
        critDamage: 50,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
});

const attackerEngineering: EngineeringStat = {
    shipType: 'ATTACKER',
    stats: [{ name: 'attack', value: 10, type: 'percentage' }],
};

const runWith = (engineering: EngineeringStat | undefined): BattleSimulationInput => {
    ran.length = 0;
    const { result } = renderHook(() =>
        useSimulatorRuns({
            playerBoard: { M4: { ship: ship('mine') } },
            enemyBoard: { M4: { ship: ship('theirs') } },
            statsDeps: {
                getGearPiece: () => undefined,
                getEngineeringStatsForShipType: (t) =>
                    engineering?.shipType === t ? engineering : undefined,
            },
            playerSquadLeader: undefined,
            enemySquadLeader: undefined,
            getGearPiece: undefined,
            seed: 1,
            runCount: 1,
            gridMode: 'normal',
        })
    );
    act(() => {
        result.current.handleRun();
    });
    expect(ran).toHaveLength(1);
    return ran[0];
};

describe('simulator engineering reaches both boards', () => {
    it('+10% Attacker engineering raises the attack of the player ship AND the enemy-board ship', () => {
        const without = runWith(undefined);
        expect(without.playerTeam[0].statOverrides?.attack).toBe(1000);
        expect(without.enemyTeam[0].statOverrides?.attack).toBe(1000);

        const withEng = runWith(attackerEngineering);
        expect(withEng.playerTeam[0].statOverrides?.attack).toBe(1100);
        expect(withEng.enemyTeam[0].statOverrides?.attack).toBe(1100);
    });
});
