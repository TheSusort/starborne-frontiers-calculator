/**
 * Arcane Siege adds into the Out. Damage sum rather than multiplying on its own (the
 * `outgoingDamageSeparate` channel's doc holds the rule and its evidence). A shielded legendary
 * Arcane Siege (+20%) under Out. Damage Up III (+45%) scales a hit by (1 + 0.45 + 0.20) / 1.45;
 * with no Out. Damage buff the two compositions agree at ×1.20. Real parse and placement path,
 * both sides of the board.
 */
import { describe, expect, it } from 'vitest';
import {
    hitAmounts,
    mirrorBoard,
    runForcedBattle,
    type BoardSpec,
    type UnitSpec,
} from '../__testutils__/equipmentBoard';

/** A faster ally that shields the attacker, and with `outDmg` also grants it Out. Damage Up III. */
const support = (outDmg: boolean): UnitSpec => ({
    name: 'S',
    position: 'M3',
    stats: { speed: 200 },
    active: outDmg
        ? 'This Unit grants <unit-skill>Out. Damage Up III</unit-skill> for 2 turns and a <unit-damage>shield equal to 100%</unit-damage> of its attack.'
        : 'This Unit grants a <unit-damage>shield equal to 100%</unit-damage> of its attack.',
    target: 'allies',
    pattern: 'Pattern-Circle-Support-Range-1',
});

const ATTACKER: UnitSpec = {
    name: 'A',
    position: 'M4',
    implant: { name: 'ARCANE_SIEGE', rarity: 'legendary', slot: 'implant_ultimate' },
    active: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    target: 'front',
    pattern: 'Pattern-Base',
};

const DUMMY: UnitSpec = {
    name: 'O',
    position: 'M4',
    active: 'This Unit grants a <unit-damage>shield equal to 1%</unit-damage> of its attack.',
    target: 'self',
    pattern: 'Pattern-Base-Support',
    stats: { speed: 1 },
};

const board = (outDmg: boolean): BoardSpec => ({
    player: [ATTACKER, support(outDmg)],
    enemy: [DUMMY],
    rounds: 1,
});

/** A's first hit with Arcane Siege worn, over the same hit with no gear. */
const siegeRatio = (b: BoardSpec) => {
    const [withSiege] = hitAmounts(runForcedBattle(b, true), 'A', 'O');
    const [without] = hitAmounts(runForcedBattle(b, false), 'A', 'O');
    expect(without).toBeGreaterThan(0);
    return withSiege / without;
};

describe('Arcane Siege composition with Out. Damage Up', () => {
    it.each([
        ['player side', board(true)],
        ['enemy side', mirrorBoard(board(true))],
    ])('%s: under Out. Damage Up III the shielded hit grows by 1.65 / 1.45', (_, b) => {
        expect(siegeRatio(b)).toBeCloseTo(1.65 / 1.45, 6);
    });

    it.each([
        ['player side', board(false)],
        ['enemy side', mirrorBoard(board(false))],
    ])('%s: with no Out. Damage buff the shielded hit grows by 1.20', (_, b) => {
        expect(siegeRatio(b)).toBeCloseTo(1.2, 6);
    });
});
