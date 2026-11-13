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
    const encounter = BOUNTY_ENCOUNTERS.find((e) => e.bountyId === 'colosso' && e.level === 32)!;
    const boss = bossShip('colosso', 32)!;
    const board: BoardState = { T3: { ship: boss } };
    for (const add of encounter.adds) {
        const def = BOUNTY_ADDS.find((candidate) => candidate.id === add.addId)!;
        board[add.position] = { ship: npcShip(def.id, def.level)! };
    }
    return board;
};

describe('General Colosso encounter', () => {
    it('runs to completion; the Major Grands cast their active and never a charged skill', () => {
        setupKeyedRng(1);
        const playerBoard: BoardState = {};
        for (const [pos, name] of [
            ['M1', 'Butcher'],
            ['M2', 'Nuqtu'],
            ['M3', 'Larkspur'],
            ['M4', 'Laika'],
        ] as Array<[Position, string]>)
            playerBoard[pos] = { ship: reference(name), overrides: { hp: 1e9 } };
        const result = simulateBattle({
            playerTeam: buildTeam(playerBoard, deps),
            enemyTeam: buildTeam(encounterBoard(), deps),
            rounds: 6,
        });
        expect(result.rounds.length).toBeGreaterThan(0);
        const turns = result.combatLog.flatMap((r) => r.turns);
        const grandTurns = turns.filter((t) => t.actorId.startsWith('e:npc:major-grand:124'));
        expect(grandTurns.length).toBeGreaterThan(0);
        for (const turn of grandTurns) expect(turn.chargeMax).toBe(0);
        const grandAttacks = grandTurns
            .flatMap((t) => t.entries)
            .filter((e) => e.kind === 'attack');
        expect(grandAttacks.length).toBeGreaterThan(0);
        expect(grandAttacks.every((e) => e.kind === 'attack' && e.slot !== 'charged')).toBe(true);
        const colosso = turns.filter((t) => t.actorId.startsWith('e:boss:colosso:32'));
        const colossoSlots = colosso
            .flatMap((t) => t.entries)
            .flatMap((e) => (e.kind === 'attack' ? [e.slot] : []));
        expect(colossoSlots).toContain('active');
        expect(colossoSlots).toContain('charged');
    });
});
