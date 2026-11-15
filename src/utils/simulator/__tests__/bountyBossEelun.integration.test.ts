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
    const encounter = BOUNTY_ENCOUNTERS.find((e) => e.bountyId === 'eelun' && e.level === 32)!;
    const boss = bossShip('eelun', 32)!;
    const board: BoardState = { T1: { ship: boss } };
    for (const add of encounter.adds) {
        const def = BOUNTY_ADDS.find((candidate) => candidate.id === add.addId)!;
        board[add.position] = { ship: npcShip(def.id, def.level)! };
    }
    return board;
};

const playerBoard = (): BoardState => {
    const board: BoardState = {};
    for (const [pos, name] of [
        ['M1', 'Butcher'],
        ['M2', 'Nuqtu'],
        ['M3', 'Larkspur'],
        ['M4', 'Laika'],
    ] as Array<[Position, string]>)
        board[pos] = { ship: reference(name), overrides: { hp: 1e9, attack: 1e6 } };
    return board;
};

describe('Eelun Naphula encounter', () => {
    it("runs to completion and a boss death ends the fight in the player's favour", () => {
        setupKeyedRng(1);
        const result = simulateBattle({
            playerTeam: buildTeam(playerBoard(), deps),
            enemyTeam: buildTeam(encounterBoard(), deps),
            rounds: 12,
        });
        expect(result.rounds.length).toBeGreaterThan(0);
        expect(result.outcome.winner).toBe('player');
        const eelunHp = result.combatLog
            .flatMap((r) => r.turns)
            .flatMap((t) => t.entries)
            .flatMap((e) => e.targets)
            .filter((t) => t.targetId.startsWith('e:boss:eelun:32'))
            .map((t) => t.resultingHpPct);
        expect(eelunHp).toContain(0);
    });

    it('every unit casts, including Eelun and Beleth whose skills deal no damage', () => {
        setupKeyedRng(1);
        const players = playerBoard();
        for (const key of Object.keys(players))
            players[key as Position]!.overrides = { hp: 1e9, attack: 1 };
        const result = simulateBattle({
            playerTeam: buildTeam(players, deps),
            enemyTeam: buildTeam(encounterBoard(), deps),
            rounds: 3,
        });
        const turns = result.combatLog.flatMap((r) => r.turns);
        const effectOf: Record<string, string> = {
            'boss:eelun:32': 'shield',
            'npc:beleth:124': 'buff',
            'npc:sitri:124': 'attack',
            'npc:corson:124': 'attack',
        };
        for (const [id, kind] of Object.entries(effectOf)) {
            const kinds = turns
                .filter((t) => t.actorId.startsWith(`e:${id}`))
                .flatMap((t) => t.entries)
                .map((e) => e.kind);
            expect(kinds, id).toContain(kind);
        }
    });
});
