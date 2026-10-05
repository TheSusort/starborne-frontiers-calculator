/**
 * The round limit is a defeat (owner ruling 61; docs/combat-system.md §1, "Round limit exceeded →
 * Defeat"): when the last round ends with both sides still holding a living ship, the enemy wins.
 * A wipe before the limit still decides the fight the ordinary way, and a same-round mutual wipe
 * stays a draw (not covered by the ruling).
 *
 * Real kits through `simulateBattle`, the Simulator page's path.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { simulateBattle, BattlePlacement, assembleBattleResult } from '../battleSimulator';
import { setupKeyedRng } from '../rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

const placement = (
    name: string,
    id: string,
    position: Position,
    stats: { attack: number; hp: number; speed: number }
): BattlePlacement => {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`${name} missing from reference data`);
    return {
        ship: { ...ship, id },
        position,
        statOverrides: {
            attack: stats.attack,
            crit: 0,
            critDamage: 100,
            defensePenetration: 0,
            hacking: 0,
            security: 0,
            defence: 0,
            hp: stats.hp,
            speed: stats.speed,
        },
    };
};

// Two real Bedrocks (single-target 90% hitters). At 1e12 HP and 1 attack nothing can die.
const TANK = { attack: 1, hp: 1e12 };

const fight = (player: BattlePlacement[], enemy: BattlePlacement[], rounds: number) => {
    setupKeyedRng(1);
    return simulateBattle({ playerTeam: player, enemyTeam: enemy, rounds }).outcome;
};

describe('round limit: both sides alive at the last round → the enemy wins', () => {
    it('player side faster: an enemy win at the limit', () => {
        const outcome = fight(
            [placement('Bedrock', 'p1', 'M4', { ...TANK, speed: 200 })],
            [placement('Bedrock', 'e1', 'M4', { ...TANK, speed: 100 })],
            3
        );
        expect(outcome).toEqual({ winner: 'enemy', lastRound: 3 });
    });

    it('reverse board (enemy side faster, a different kit on each side): still an enemy win', () => {
        const outcome = fight(
            [placement('Stalwart', 'p1', 'M4', { ...TANK, speed: 100 })],
            [placement('Bedrock', 'e1', 'M4', { ...TANK, speed: 200 })],
            3
        );
        expect(outcome).toEqual({ winner: 'enemy', lastRound: 3 });
    });

    it('the limit is the configured round count, not a hardcoded 30', () => {
        const outcome = fight(
            [placement('Bedrock', 'p1', 'M4', { ...TANK, speed: 200 })],
            [placement('Bedrock', 'e1', 'M4', { ...TANK, speed: 100 })],
            5
        );
        expect(outcome).toEqual({ winner: 'enemy', lastRound: 5 });
    });

    it('negative: a player wipe of the enemy before the limit is still a player win', () => {
        const outcome = fight(
            [placement('Bedrock', 'p1', 'M4', { attack: 1e9, hp: 1e12, speed: 200 })],
            [placement('Bedrock', 'e1', 'M4', { attack: 1, hp: 1000, speed: 100 })],
            5
        );
        expect(outcome.winner).toBe('player');
        expect(outcome.lastRound).toBeLessThan(5);
    });

    it('enemy-side twin of the negative: an enemy wipe of the player before the limit', () => {
        const outcome = fight(
            [placement('Bedrock', 'p1', 'M4', { attack: 1, hp: 1000, speed: 100 })],
            [placement('Bedrock', 'e1', 'M4', { attack: 1e9, hp: 1e12, speed: 200 })],
            5
        );
        expect(outcome.winner).toBe('enemy');
        expect(outcome.lastRound).toBeLessThan(5);
    });
});

describe('round limit: outcomes the ruling does not cover', () => {
    const roster = [
        {
            actorId: 'attacker',
            side: 'player' as const,
            name: 'P',
            position: 'M4' as const,
            maxHp: 1,
        },
        { actorId: 'e1', side: 'enemy' as const, name: 'E', position: 'M4' as const, maxHp: 1 },
    ];

    it('a same-round mutual wipe is still a draw', () => {
        const result = assembleBattleResult({
            events: [
                { type: 'ship-destroyed', actorId: 'attacker', round: 2 },
                { type: 'ship-destroyed', actorId: 'e1', round: 2 },
            ],
            perRoundPerTarget: {},
            roster,
            numRounds: 5,
        });
        expect(result.outcome).toEqual({ winner: 'draw', lastRound: 2 });
    });

    it('a roster with an empty side reaches the limit as a draw (nobody to win)', () => {
        const result = assembleBattleResult({
            events: [],
            perRoundPerTarget: {},
            roster: roster.filter((r) => r.side === 'player'),
            numRounds: 3,
        });
        expect(result.outcome).toEqual({ winner: 'draw', lastRound: 3 });
    });
});
