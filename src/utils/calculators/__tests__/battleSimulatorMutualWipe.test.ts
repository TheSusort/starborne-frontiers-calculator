/**
 * A fight that wipes both teams on one turn is won by the side that dealt the final killing
 * damage: the side whose last ship died LAST loses. A dying Stalwart's counter that kills the
 * last enemy is Stalwart's side's win. Real Stalwart kit, on either side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { simulateBattle, assembleBattleResult, type BattlePlacement } from '../battleSimulator';
import type { CombatEvent } from '../../combat/events';
import { setupKeyedRng } from '../rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error('This suite requires docs/ship-skills.csv and docs/ship-data.json');
    }
});
beforeEach(() => setupKeyedRng(21));

const stats = (hp: number, attack: number, speed: number) => ({
    attack,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    hacking: 0,
    security: 0,
    defence: 0,
    hp,
    speed,
});

const placed = (ship: Ship, position: Position, s: ReturnType<typeof stats>): BattlePlacement => ({
    ship,
    position,
    statOverrides: s,
});

const hitter = (): Ship =>
    ({
        id: 'hitter',
        name: 'hitter',
        type: 'ATTACKER',
        refits: [],
        activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
        baseStats: {
            hp: 1,
            attack: 1,
            defence: 0,
            hacking: 0,
            security: 0,
            crit: 0,
            critDamage: 150,
            speed: 1,
        },
    }) as unknown as Ship;

/** The fast hitter kills Stalwart (1,000 HP) in one blow; Stalwart's counter (1,000 attack) then
 *  kills the hitter (500 HP). Both teams are wiped on that turn. */
const mutualWipe = (stalwartSide: 'player' | 'enemy') => {
    const stalwart = placed(buildTraceShip('Stalwart')!, 'M4', stats(1_000, 1_000, 1));
    const attacker = placed(hitter(), 'M4', stats(500, 1_000_000, 100));
    return simulateBattle({
        playerTeam: [stalwartSide === 'player' ? stalwart : attacker],
        enemyTeam: [stalwartSide === 'player' ? attacker : stalwart],
        rounds: 3,
    });
};

describe('a mutual wipe goes to the side whose reaction landed the killing blow', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`Stalwart on the ${side} side: its dying counter wins the fight for that side`, () => {
            const result = mutualWipe(side);
            // Both rosters are empty by the end of round 1: the wipe is mutual.
            expect(result.rounds).toHaveLength(1);
            expect(result.rounds[0].ships.every((s) => !s.alive)).toBe(true);
            expect(result.outcome.winner).toBe(side);
        });
    }
});

describe('assembleBattleResult: the last ship destroyed in a mutual wipe names the loser', () => {
    const roster = [
        {
            actorId: 'p',
            side: 'player' as const,
            name: 'p',
            position: 'M4' as Position,
            maxHp: 100,
        },
        { actorId: 'e', side: 'enemy' as const, name: 'e', position: 'M4' as Position, maxHp: 100 },
    ];
    const run = (order: string[]) =>
        assembleBattleResult({
            events: order.map((actorId): CombatEvent => ({
                type: 'ship-destroyed',
                actorId,
                round: 1,
            })),
            perRoundPerTarget: {},
            roster,
            numRounds: 3,
        }).outcome.winner;
    it('the enemy ship dying last is a player win', () => {
        expect(run(['p', 'e'])).toBe('player');
    });
    it('the player ship dying last is an enemy win', () => {
        expect(run(['e', 'p'])).toBe('enemy');
    });
});
