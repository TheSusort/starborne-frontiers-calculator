/**
 * Lionheart's "At the start of the round, this Unit gains 10 stacks of Protection" REFILLS him to
 * 10 (cap 10, not +10). A stack Pallas stole is restored at the next round start.
 *
 * Board: Lionheart (M1) and X (M4) against Pallas (M4, back-targeting, charged every second
 * turn: it steals one stack from Lionheart in rounds 2 and 4) and a hitter H whose charged hit
 * lands on X. Both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { Ability } from '../../../types/abilities';
import { mirrorBoard, realSlots, ShipSpec } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error('This suite requires docs/ship-skills.csv and docs/ship-data.json');
    }
});
beforeEach(() => setupKeyedRng(5));

const damage = (id: string, multiplier: number): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

/** X's damage taken in each round, with H's charged hit landing in `hitRound`. */
const incomingByRound = (side: 'player' | 'enemy', hitterCharge: number): number[] => {
    const lionheart: ShipSpec = {
        id: 'lionheart',
        position: 'M1',
        speed: 50,
        skills: {
            slots: [
                { slot: 'active', abilities: [damage('lion-active', 0)] },
                ...realSlots('Lionheart', ['passive']),
            ],
        },
    };
    const x: ShipSpec = { id: 'x', position: 'M4', speed: 10 };
    const pallas: ShipSpec = {
        id: 'pallas',
        position: 'M4',
        speed: 300,
        target: 'back',
        chargeCount: 1,
        skills: {
            slots: [
                { slot: 'active', abilities: [damage('pallas-active', 0)] },
                ...realSlots('Pallas', ['charged', 'passive']),
            ],
        },
    };
    const hitter: ShipSpec = {
        id: 'hitter',
        position: 'M3',
        speed: 1,
        attack: 1000,
        chargeCount: hitterCharge,
        skills: {
            slots: [
                { slot: 'active', abilities: [damage('hit-active', 0)] },
                { slot: 'charged', abilities: [damage('hit-charged', 100)] },
            ],
        },
    };
    const { input, idOf } = mirrorBoard(
        { caster: [lionheart, x], other: [pallas, hitter], numRounds: hitterCharge + 2 },
        side
    );
    const result = runCombat(input);
    return result.rounds.map((round) => round.perActorIncoming?.[idOf('x')]?.incoming ?? 0);
};

describe("Lionheart's start-of-round Protection refills to 10", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: a stack stolen in round 2 is back before the round-3 hit (X takes nothing)`, () => {
            const taken = incomingByRound(side, 2);
            expect(taken[2]).toBe(0);
        });
        it(`${side}-side: a round-4 hit meets only that round's fresh theft (one stack)`, () => {
            const taken = incomingByRound(side, 3);
            expect(taken[3]).toBeCloseTo(100, 6);
        });
    }
});
