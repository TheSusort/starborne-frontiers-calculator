import { describe, it, expect, beforeAll } from 'vitest';
import { buildTeam } from '../buildTeam';
import { simulateBattle } from '../../calculators/battleSimulator';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { referenceShip } from '../../ship/referenceShip';
import { BOUNTY_ENCOUNTERS, bossShip, npcShip, BOUNTY_ADDS } from '../../../constants/bountyBosses';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});

const deps = { getGearPiece: () => undefined, getEngineeringStatsForShipType: () => undefined };

const reference = (name: string) => {
    const template = buildTraceShip(name);
    if (!template) throw new Error(`no reference data for ${name}`);
    return referenceShip(template, 'r0', null);
};

const encounterBoard = (): BoardState => {
    const encounter = BOUNTY_ENCOUNTERS.find((e) => e.bountyId === 'maglienza' && e.level === 32)!;
    const board: BoardState = { T1: { ship: bossShip('maglienza', 32)! } };
    for (const add of encounter.adds) {
        const def = BOUNTY_ADDS.find((candidate) => candidate.id === add.addId)!;
        board[add.position] = { ship: npcShip(def.id, def.level)! };
    }
    return board;
};

describe('Mamma Maglienza encounter', () => {
    it('runs to completion with the boss and three Capos on the enemy side', () => {
        setupKeyedRng(1);
        const cells: Array<[Position, string]> = [
            ['M1', 'Butcher'],
            ['M2', 'Nuqtu'],
            ['M3', 'Larkspur'],
            ['M4', 'Laika'],
        ];
        // Mamma's row hit reaches every ship in the row; the hp floor keeps the row alive so the
        // Capos, the slowest units, still get a turn.
        const playerBoard: BoardState = {};
        for (const [pos, name] of cells)
            playerBoard[pos] = { ship: reference(name), overrides: { hp: 1e9 } };
        const result = simulateBattle({
            playerTeam: buildTeam(playerBoard, deps),
            enemyTeam: buildTeam(encounterBoard(), deps),
            rounds: 5,
        });
        expect(result.rounds.length).toBeGreaterThan(0);
        expect(
            result.rounds[0].ships.filter((s) => s.actorId.startsWith('e:npc:capo:124'))
        ).toHaveLength(3);
        expect(
            result.rounds[0].ships.some((s) => s.actorId.startsWith('e:boss:maglienza:32'))
        ).toBe(true);
        const attacks = result.combatLog.flatMap((r) =>
            r.turns.flatMap((t) => t.entries.filter((e) => e.kind === 'attack'))
        );
        expect(attacks.some((e) => e.actorId.startsWith('e:npc:capo:124'))).toBe(true);
        expect(attacks.some((e) => e.actorId.startsWith('e:boss:maglienza:32'))).toBe(true);
    });

    it('Mamma and each Capo strike the whole row they pick', () => {
        setupKeyedRng(1);
        // Row M holds three ships, row B one: Mamma picks the fullest row, the Capos the emptiest.
        const playerBoard: BoardState = {};
        for (const [pos, name] of [
            ['M2', 'Butcher'],
            ['M3', 'Nuqtu'],
            ['M4', 'Larkspur'],
            ['B4', 'Laika'],
        ] as Array<[Position, string]>)
            playerBoard[pos] = { ship: reference(name), overrides: { hp: 1e9 } };
        const result = simulateBattle({
            playerTeam: buildTeam(playerBoard, deps),
            enemyTeam: buildTeam(encounterBoard(), deps),
            rounds: 1,
        });
        const idAt = (pos: Position) =>
            result.roster.find((r) => r.side === 'player' && r.position === pos)!.actorId;
        const struckBy = (prefix: string) =>
            result.combatLog[0].turns
                .flatMap((t) => t.entries)
                .filter((e) => e.kind === 'attack' && e.actorId.startsWith(prefix))
                .map((e) => (e.kind === 'attack' ? e.targets.map((t) => t.targetId).sort() : []));
        const mRow = [idAt('M2'), idAt('M3'), idAt('M4')].sort();
        const mamma = struckBy('e:boss:maglienza:32');
        expect(mamma.length).toBeGreaterThan(0);
        for (const targets of mamma) expect(targets).toEqual(mRow);
        const capos = struckBy('e:npc:capo:124');
        expect(capos.length).toBeGreaterThan(0);
        for (const targets of capos) expect(targets).toEqual([idAt('B4')]);
    });
});

describe('boss-death win condition', () => {
    // Laika alone in row B draws every Capo's row-least cast (and its Disable), leaving the
    // three row-M ships free to act.
    const playerBoard = (): BoardState => {
        const board: BoardState = {};
        for (const [pos, name] of [
            ['M2', 'Butcher'],
            ['M3', 'Nuqtu'],
            ['M4', 'Larkspur'],
            ['B4', 'Laika'],
        ] as Array<[Position, string]>)
            board[pos] = { ship: reference(name), overrides: { hp: 1e9 } };
        return board;
    };
    // A one-hp boss dies to the first hit that reaches it; the three escorts stay healthy.
    const frailBossBoard = (): BoardState => {
        const board = encounterBoard();
        board.T1 = { ...board.T1!, overrides: { hp: 1 } };
        return board;
    };
    const destroyedIds = (result: ReturnType<typeof simulateBattle>) =>
        new Set(
            result.combatLog.flatMap((r) =>
                r.turns.flatMap((t) =>
                    t.entries.filter((e) => e.kind === 'death').map((e) => e.actorId)
                )
            )
        );

    // The combat log is not trimmed at the outcome, so it shows whether the engine itself stopped.
    const lastLoggedRound = (result: ReturnType<typeof simulateBattle>) =>
        Math.max(...result.combatLog.map((r) => r.round));

    it('buildTeam flags boss placements and no others', () => {
        const team = buildTeam(encounterBoard(), deps);
        expect(team.filter((p) => p.isBoss).map((p) => p.ship.id)).toEqual(['boss:maglienza:32']);
    });

    it('ends the fight when the boss dies with its escorts alive: the boss side loses', () => {
        setupKeyedRng(1);
        const result = simulateBattle({
            playerTeam: buildTeam(playerBoard(), deps),
            enemyTeam: buildTeam(frailBossBoard(), deps),
            rounds: 10,
        });
        expect(result.outcome.winner).toBe('player');
        expect(result.outcome.lastRound).toBeLessThan(10);
        expect(lastLoggedRound(result)).toBe(result.outcome.lastRound);
        const dead = destroyedIds(result);
        expect([...dead].some((id) => id.startsWith('e:boss:maglienza:32'))).toBe(true);
        expect([...dead].some((id) => id.startsWith('e:npc:capo:124'))).toBe(false);
    });

    it('is side-symmetric: a boss on the player side loses the fight for the player', () => {
        setupKeyedRng(1);
        const result = simulateBattle({
            playerTeam: buildTeam(frailBossBoard(), deps),
            enemyTeam: buildTeam(playerBoard(), deps),
            rounds: 10,
        });
        expect(result.outcome.winner).toBe('enemy');
        expect(result.outcome.lastRound).toBeLessThan(10);
        expect(lastLoggedRound(result)).toBe(result.outcome.lastRound);
    });

    it('does not end the fight for a non-boss unit with the same hp and escorts alive', () => {
        setupKeyedRng(1);
        const enemyTeam = buildTeam(frailBossBoard(), deps).map((p) => ({ ...p, isBoss: false }));
        const result = simulateBattle({
            playerTeam: buildTeam(playerBoard(), deps),
            enemyTeam,
            rounds: 3,
        });
        expect(result.rounds.length).toBe(3);
    });
});
