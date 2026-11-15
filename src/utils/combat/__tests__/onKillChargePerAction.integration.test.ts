/**
 * "When an enemy is destroyed, all allies add 1 charge to their charged skills" (Liberator) fires
 * once per action that kills: one action destroying three enemies gives +1, and two actions that
 * each kill give +2 (owner ruling 2026-11-15). Run through the real parse and placement path, on
 * both sides of the board.
 */
import { describe, expect, it } from 'vitest';
import {
    entriesOf,
    mirrorBoard,
    runForcedBattle,
    type BoardSpec,
    type UnitSpec,
} from '../__testutils__/equipmentBoard';

const ON_KILL_CHARGE =
    'When an enemy is destroyed, all allies <unit-skill>add 1 charge</unit-skill> to their charged skills.';

/** The passive's owner: slow, so it acts after the kills, with a charged skill to fill. */
const GRANTER: UnitSpec = {
    name: 'L',
    position: 'T4',
    active: 'This Unit grants a <unit-damage>shield equal to 1%</unit-damage> of its attack.',
    target: 'self',
    pattern: 'Pattern-Base-Support',
    charged: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    chargeCount: 9,
    passives: [ON_KILL_CHARGE],
    stats: { speed: 10 },
};

const killer = (name: string, position: UnitSpec['position'], pattern: string, speed: number) =>
    ({
        name,
        position,
        active: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
        target: 'front',
        pattern,
        stats: { speed, attack: 1_000_000 },
    }) as UnitSpec;

const weak = (name: string, position: UnitSpec['position']) =>
    ({
        name,
        position,
        active: 'This Unit grants a <unit-damage>shield equal to 1%</unit-damage> of its attack.',
        target: 'self',
        pattern: 'Pattern-Base-Support',
        stats: { hp: 1, speed: 1 },
    }) as UnitSpec;

/** One area cast destroys three enemies. */
const oneActionThreeKills: BoardSpec = {
    player: [GRANTER, killer('K', 'M4', 'Pattern-Circle-Range-1', 200)],
    enemy: [weak('E1', 'M4'), weak('E2', 'M3'), weak('E3', 'T4'), weak('Spare', 'B1')],
    rounds: 1,
};

/** Two ships each destroy one enemy with their own action. */
const twoActionsOneKillEach: BoardSpec = {
    player: [
        GRANTER,
        killer('K1', 'M4', 'Pattern-Base', 200),
        killer('K2', 'B4', 'Pattern-Base', 150),
    ],
    enemy: [weak('E1', 'M4'), weak('E2', 'M3'), weak('Spare', 'B1')],
    rounds: 1,
};

/** Charge the passive granted to `who`: its reactive charge rows on that ship. */
const passiveGrants = (board: BoardSpec, who: string) => {
    const run = runForcedBattle(board, true);
    const deaths = entriesOf(run, 'death').length;
    const grants = entriesOf(run, 'charge-changed').filter(
        (e) => e.actorId === run.id(who) && (e.note ?? '').includes('manip')
    ).length;
    return { deaths, grants };
};

describe('on-kill all-allies charge: once per action that kills', () => {
    it.each([
        ['player side', oneActionThreeKills],
        ['enemy side', mirrorBoard(oneActionThreeKills)],
    ])('%s: one action destroying three enemies gives +1', (_, board) => {
        const { deaths, grants } = passiveGrants(board, 'L');
        expect(deaths).toBe(3);
        expect(grants).toBe(1);
    });

    it.each([
        ['player side', twoActionsOneKillEach],
        ['enemy side', mirrorBoard(twoActionsOneKillEach)],
    ])('%s: two actions that each kill give +2', (_, board) => {
        const { deaths, grants } = passiveGrants(board, 'L');
        expect(deaths).toBe(2);
        expect(grants).toBe(2);
    });
});
