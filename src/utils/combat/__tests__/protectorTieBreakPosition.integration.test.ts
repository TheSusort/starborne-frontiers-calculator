/**
 * Two protectors at the same speed soak in BOARD POSITION order (top row first, then middle, then
 * bottom; lower column first), never by actor id. The first protector takes its stacks' share of a
 * hit and the next skims only what that share leaves. Both sides.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import type { Ability } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import { mirrorBoard, ShipSpec } from './__fixtures__/mirrorBoard';

beforeEach(() => setupKeyedRng(3));

/** "At the start of combat, this Unit gains 3 stacks of Protection." */
const protection3: Ability = {
    id: 'protection-3',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Protection',
        parsedEffects: {},
        stacks: 3,
        isStackable: true,
    },
};
const hit: Ability = {
    id: 'hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
};

/** Damage each protector took from one 1000-attack hit on V, by actor id. */
const soaked = (side: 'player' | 'enemy', topId: string, bottomId: string) => {
    const protector = (id: string, position: Position): ShipSpec => ({
        id,
        position,
        speed: 50,
        skills: { slots: [{ slot: 'passive', abilities: [protection3] }] },
    });
    const v: ShipSpec = { id: 'v', position: 'M4', speed: 5 };
    const h: ShipSpec = {
        id: 'h',
        position: 'M4',
        speed: 1,
        attack: 1000,
        skills: { slots: [{ slot: 'active', abilities: [hit] }] },
    };
    const { input, idOf } = mirrorBoard(
        {
            caster: [v, protector(topId, 'T1'), protector(bottomId, 'B1')],
            other: [h],
            numRounds: 1,
        },
        side
    );
    const result = runCombat(input);
    const took = (id: string) => result.rounds[0].perActorIncoming?.[idOf(id)]?.incoming ?? 0;
    return { top: took(topId), bottom: took(bottomId) };
};

describe('two same-speed protectors soak in board-position order', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: the top-row protector goes first whichever id it carries`, () => {
            const aFirst = soaked(side, 'a', 'z');
            const zFirst = soaked(side, 'z', 'a');
            expect(aFirst.top).toBeGreaterThan(aFirst.bottom);
            expect(zFirst.top).toBeGreaterThan(zFirst.bottom);
            expect(zFirst.top).toBeCloseTo(aFirst.top, 6);
        });
    }
});
