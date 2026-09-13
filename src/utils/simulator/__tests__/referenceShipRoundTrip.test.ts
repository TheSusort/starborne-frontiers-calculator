import { describe, it, expect } from 'vitest';
import { buildTeam } from '../buildTeam';
import { simulateBattle } from '../../calculators/battleSimulator';
import { referenceShip, AscensionStat } from '../../ship/referenceShip';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import type { Ship } from '../../../types/ship';
import type { BaseStats } from '../../../types/stats';

/**
 * A reference ship reaches the engine through several layers that were written when every
 * board cell held a ship the player OWNS — it has an id no owned row has, no gear, and refits
 * this app did not import. This walks the whole path a placed unit actually takes rather than
 * asserting against any one of those layers, because the layer that breaks next is the one
 * nobody listed.
 */

const baseStats: BaseStats = {
    hp: 12000,
    attack: 3000,
    defence: 1800,
    hacking: 90,
    security: 25,
    crit: 10,
    critDamage: 60,
    speed: 100,
    healModifier: 0,
    hpRegen: 0,
    shield: 0,
    shieldPenetration: 0,
    defensePenetration: 0,
    damageReduction: 0,
};

const template = (id: string, name: string): Ship =>
    ({
        id,
        name,
        rarity: 'legendary',
        faction: 'ATLAS',
        type: 'ATTACKER',
        affinity: 'thermal',
        baseStats: { ...baseStats },
        equipment: {},
        implants: {},
        refits: [],
        activeSkillText: 'Deals 100% damage to the target.',
        firstPassiveSkillText: '',
    }) as unknown as Ship;

const ascension: AscensionStat[] = [
    { level: 1, attribute: 'HullPoints', type: 'Percentage', value: 0.15 },
    { level: 3, attribute: 'Power', type: 'Percentage', value: 0.15 },
    { level: 4, attribute: 'Initiative', type: 'Flat', value: 10 },
    { level: 5, attribute: 'Defense', type: 'Percentage', value: 0.05 },
    { level: 6, attribute: 'HullPoints', type: 'Percentage', value: 0.15 },
];

const deps = {
    getGearPiece: () => undefined,
    getEngineeringStatsForShipType: () => undefined,
};

const board = (ship: Ship): BoardState => ({ T1: { ship } });

describe('a reference ship on a simulator board', () => {
    it('resolves to real combat stats, not an empty block', () => {
        const ship = referenceShip(template('T', 'Testship'), 'r0', ascension);
        const [placement] = buildTeam(board(ship), deps);

        expect(placement.statOverrides?.attack).toBe(baseStats.attack);
        expect(placement.statOverrides?.hp).toBe(baseStats.hp);
    });

    it('carries its refit stats into the resolved block', () => {
        const r0 = referenceShip(template('T', 'Testship'), 'r0', ascension);
        const refitted = referenceShip(template('T', 'Testship'), 'refitted', ascension);

        const [bare] = buildTeam(board(r0), deps);
        const [full] = buildTeam(board(refitted), deps);

        // 15% hp at level 1 and again at level 6, 15% attack at level 3.
        expect(full.statOverrides?.hp).toBeGreaterThan(bare.statOverrides?.hp ?? 0);
        expect(full.statOverrides?.attack).toBeGreaterThan(bare.statOverrides?.attack ?? 0);
    });

    it('fights: the engine runs a board made only of reference ships', () => {
        const player = referenceShip(template('P', 'Playership'), 'refitted', ascension);
        const enemy = referenceShip(template('E', 'Enemyship'), 'r0', ascension);

        const result = simulateBattle({
            playerTeam: buildTeam(board(player), deps),
            enemyTeam: buildTeam(board(enemy), deps),
            rounds: 5,
        });

        expect(result.rounds.length).toBeGreaterThan(0);
    });

    // Two placements of the same reference version share a ship id, which an owned board can
    // never produce. The engine mints actor ids per side and index, so they must stay distinct
    // participants rather than collapsing into one.
    it('keeps two copies of one reference version apart', () => {
        const ship = referenceShip(template('T', 'Testship'), 'r0', ascension);
        const twoUp: BoardState = { T1: { ship }, T2: { ship } };

        const result = simulateBattle({
            playerTeam: buildTeam(twoUp, deps),
            enemyTeam: buildTeam(
                board(referenceShip(template('E', 'Enemyship'), 'r0', null)),
                deps
            ),
            rounds: 3,
        });

        const playerIds = result.roster
            .filter((entry) => entry.side === 'player')
            .map((entry) => entry.actorId);

        expect(playerIds).toHaveLength(2);
        expect(new Set(playerIds).size).toBe(2);
    });
});
