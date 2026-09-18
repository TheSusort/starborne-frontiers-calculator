import { describe, it, expect } from 'vitest';
import { sparringOpponents } from '../sparringOpponents';
import type { Position } from '../../../../types/encounters';
import type { Ship } from '../../../../types/ship';

const focus = {
    id: 'f',
    name: 'Focus',
    type: 'ATTACKER',
    baseStats: { attack: 5000, crit: 50, critDamage: 150, hp: 50000, defence: 3000, speed: 110 },
    equipment: {},
    implants: {},
    refits: [],
    activeSkillText: 'This Unit deals <unit-damage>150% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
} as unknown as Ship;

/** Every enemy cell across every opponent, so a stat check cannot pass by accident on a build
 *  that only varied the first enemy position and left the other two at their fixture default. */
const allEnemyStats = (
    opponents: { enemyBoard: Record<string, { ship?: Ship } | undefined> }[],
    stat: 'hacking' | 'security' | 'defence' | 'attack'
): number[][] =>
    opponents.map((o) =>
        Object.values(o.enemyBoard)
            .filter((cell): cell is { ship: Ship } => !!cell?.ship)
            .map((cell) => cell.ship.baseStats[stat])
    );

describe('sparringOpponents', () => {
    it('returns exactly three opponents', () => {
        expect(sparringOpponents(focus, 'security').opponents).toHaveLength(3);
    });

    it('varies ONLY the gating stat, for every enemy, so any difference is attributable to it', () => {
        const { opponents } = sparringOpponents(focus, 'security');

        const securities = allEnemyStats(opponents, 'security');
        // Within one opponent every enemy shares the same gate level...
        for (const perBoard of securities) expect(new Set(perBoard).size).toBe(1);
        // ...and the three opponents' levels are pairwise distinct.
        expect(new Set(securities.map((perBoard) => perBoard[0])).size).toBe(3);

        // A non-gating stat is identical for every enemy across all three boards. Checking only
        // the first cell would pass an implementation that varied one enemy and left the other
        // two at practiceBoard.ts's default.
        const attacks = allEnemyStats(opponents, 'attack').flat();
        expect(new Set(attacks).size).toBe(1);
    });

    it('varies hacking when the gate is the focus resisting', () => {
        const { opponents } = sparringOpponents(focus, 'hacking');
        const hackings = allEnemyStats(opponents, 'hacking');
        for (const perBoard of hackings) expect(new Set(perBoard).size).toBe(1);
        expect(new Set(hackings.map((perBoard) => perBoard[0])).size).toBe(3);
    });

    it('varies defence independently for each opponent', () => {
        const { opponents } = sparringOpponents(focus, 'defence');
        const defences = allEnemyStats(opponents, 'defence');
        for (const perBoard of defences) expect(new Set(perBoard).size).toBe(1);
        expect(new Set(defences.map((perBoard) => perBoard[0])).size).toBe(3);
    });

    it("seats the focus on the shared player board at the practice position, as the caller's own object", () => {
        const { playerBoard, focusPosition } = sparringOpponents(focus, 'defence');
        // Identity, not just id: the player board is not rebuilt per opponent, so the focus
        // ship placed on it must be the exact object the caller passed in.
        expect(playerBoard[focusPosition]?.ship).toBe(focus);
    });

    it('gives each opponent independent ship objects, so mutating one cannot corrupt another', () => {
        const { opponents } = sparringOpponents(focus, 'security');
        const [low, medium, high] = opponents;
        const position = Object.keys(low.enemyBoard)[0] as Position;

        const lowShip = low.enemyBoard[position]!.ship;
        const mediumShip = medium.enemyBoard[position]!.ship;
        const highShip = high.enemyBoard[position]!.ship;

        expect(lowShip).not.toBe(mediumShip);
        expect(lowShip.baseStats).not.toBe(mediumShip.baseStats);

        // Mutating one opponent's enemy stats must not leak into the others.
        lowShip.baseStats.security = 999999;
        expect(mediumShip.baseStats.security).not.toBe(999999);
        expect(highShip.baseStats.security).not.toBe(999999);
    });
});
