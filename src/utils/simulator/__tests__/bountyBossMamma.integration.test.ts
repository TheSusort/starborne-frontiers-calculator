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
        const playerBoard: BoardState = {};
        for (const [pos, name] of cells) playerBoard[pos] = { ship: reference(name) };
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
});
