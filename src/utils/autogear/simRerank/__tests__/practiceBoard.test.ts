import { describe, it, expect } from 'vitest';
import { practiceBoards } from '../practiceBoard';
import { buildTeam } from '../../../simulator/buildTeam';
import { runSeedSet } from '../../../simulator/seededRuns';
import type { Ship } from '../../../../types/ship';

const focus = (): Ship =>
    ({
        id: 'focus',
        name: 'Focus',
        type: 'ATTACKER',
        baseStats: {
            attack: 5000,
            crit: 50,
            critDamage: 150,
            hp: 50000,
            defence: 3000,
            speed: 110,
        },
        equipment: {},
        implants: {},
        refits: [],
        activeSkillText: 'This Unit deals <unit-damage>150% damage</unit-damage>.',
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    }) as unknown as Ship;

const deps = {
    getGearPiece: () => undefined,
    getEngineeringStatsForShipType: () => undefined,
};

describe('practiceBoards', () => {
    it('places the focus and gives it allies, so team damage is not focus damage', () => {
        const { playerBoard } = practiceBoards(focus());
        const placed = Object.values(playerBoard).filter(Boolean);
        expect(placed.length).toBeGreaterThan(1);
        expect(placed.some((p) => p.ship.id === 'focus')).toBe(true);
    });

    it('produces a fight somebody actually loses, so outcomes are non-degenerate', () => {
        const { playerBoard, enemyBoard } = practiceBoards(focus());
        const aggregate = runSeedSet(
            {
                playerTeam: buildTeam(playerBoard, deps),
                enemyTeam: buildTeam(enemyBoard, deps),
                rounds: 30,
            },
            1,
            4
        );
        expect(aggregate.wins.draw).toBeLessThan(4);
    });

    it('gives every combatant skill text, or the engine has nothing to cast', () => {
        const { playerBoard, enemyBoard } = practiceBoards(focus());
        for (const board of [playerBoard, enemyBoard]) {
            for (const placement of Object.values(board)) {
                expect(placement.ship.activeSkillText ?? '').not.toBe('');
            }
        }
    });

    it('deals damage in the fight, so the fixture is not silently inert', () => {
        const { playerBoard, enemyBoard } = practiceBoards(focus());
        const aggregate = runSeedSet(
            {
                playerTeam: buildTeam(playerBoard, deps),
                enemyTeam: buildTeam(enemyBoard, deps),
                rounds: 30,
            },
            1,
            2
        );
        const total = Object.values(aggregate.perActorMean).reduce(
            (sum, t) => sum + t.damageDealt,
            0
        );
        expect(total).toBeGreaterThan(0);
    });
});
