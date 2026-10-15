/**
 * With several taunters an attacker picks among them by its NORMAL targeting order — its own row
 * first, then the next row down (wrapping), front to back within a row — never by team-list
 * order. Real Iridium kits ("At the start of combat, this Unit gains Taunt"). Both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { Ability } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import { mirrorBoard, realSlots, ShipSpec } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error('This suite requires docs/ship-skills.csv and docs/ship-data.json');
    }
});
beforeEach(() => setupKeyedRng(9));

const hit: Ability = {
    id: 'hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
};

/** The spec id of the taunter the attacker hit, with the roster listed in the given order. */
const hitTaunter = (
    side: 'player' | 'enemy',
    attackerAt: Position,
    order: ['t', 'b'] | ['b', 't']
): string => {
    const iridium = (id: string, position: Position): ShipSpec => ({
        id,
        position,
        speed: 50,
        hp: 1e9,
        skills: {
            slots: [{ slot: 'active', abilities: [] }, ...realSlots('Iridium', ['passive'])],
        },
    });
    const taunters = { t: iridium('t', 'T4'), b: iridium('b', 'B4') };
    const bystander: ShipSpec = { id: 'x', position: 'M2', speed: 60, hp: 1e9 };
    const hitter: ShipSpec = {
        id: 'hitter',
        position: attackerAt,
        speed: 100,
        attack: 1000,
        skills: { slots: [{ slot: 'active', abilities: [hit] }] },
    };
    const { input, idOf } = mirrorBoard(
        {
            caster: [bystander, taunters[order[0]], taunters[order[1]]],
            other: [hitter],
            numRounds: 1,
        },
        side
    );
    const result = runCombat(input);
    const took = (id: string) => result.rounds[0].perActorIncoming?.[idOf(id)]?.incoming ?? 0;
    return took('t') > took('b') ? 't' : 'b';
};

describe('several taunters: the attacker picks by its normal targeting order', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: an attacker in the middle row scans middle, bottom, top and hits the bottom taunter`, () => {
            expect(hitTaunter(side, 'M4', ['t', 'b'])).toBe('b');
            expect(hitTaunter(side, 'M4', ['b', 't'])).toBe('b');
        });
        it(`${side}-side: an attacker in the top row hits the top taunter whichever way the roster is listed`, () => {
            expect(hitTaunter(side, 'T1', ['t', 'b'])).toBe('t');
            expect(hitTaunter(side, 'T1', ['b', 't'])).toBe('t');
        });
    }
});
