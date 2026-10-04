/**
 * A reactive enemy charge removal reaches only the enemy its event names, never the whole board.
 *
 * Zosimos: "this Unit removes 1 charge from the enemy's charged skill for every repair they
 * perform" — "they" is the repairer. A board where e-a repairs itself and e-b, e-c sit idle drains
 * e-a alone.
 *
 * Real parsed passive (buildTraceShip, refit 4), mounted on both sides. Every holder starts with 3
 * charges and has no charged skill, so nothing re-banks and the seeded value minus the drains is
 * exactly what is read back.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';
import { mirrorBoard, realSlots, ShipSpec, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(7));

const selfRepair = (id: string): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: `${id}-repair`,
                    type: 'heal',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                },
            ],
        },
    ],
});

const holder = (id: string, position: ShipSpec['position'], repairs: boolean): ShipSpec => ({
    id,
    position,
    chargeCount: 3,
    startCharged: true,
    hasChargedSkill: false,
    speed: 150,
    ...(repairs ? { skills: selfRepair(id) } : {}),
});

const chargesAfter = (teams: MirrorTeams, side: 'player' | 'enemy', ids: string[]) => {
    const { input, idOf } = mirrorBoard(teams, side);
    let actors: CombatActor[] = [];
    runCombat({ ...input, __testTapActors: (all) => (actors = all) });
    return Object.fromEntries(
        ids.map((id) => [id, actors.find((a) => a.id === idOf(id))?.charges])
    );
};

describe('Zosimos: a repair drains only the repairer', () => {
    const zosimos = (): ShipSpec => ({
        id: 'zosimos',
        position: 'M4',
        speed: 10,
        skills: {
            slots: [{ slot: 'active', abilities: [] }, ...realSlots('Zosimos', ['passive'])],
        },
    });
    const teams = (repairers: string[]): MirrorTeams => ({
        caster: [zosimos()],
        other: [
            holder('e-a', 'M4', repairers.includes('e-a')),
            holder('e-b', 'M3', repairers.includes('e-b')),
            holder('e-c', 'M2', repairers.includes('e-c')),
        ],
    });
    const IDS = ['e-a', 'e-b', 'e-c'];

    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side Zosimos: e-a repairs → only e-a loses a charge`, () => {
            expect(chargesAfter(teams(['e-a']), side, IDS)).toEqual({
                'e-a': 2,
                'e-b': 3,
                'e-c': 3,
            });
        });
        it(`${side}-side Zosimos, reverse board: e-c repairs → only e-c loses a charge`, () => {
            expect(chargesAfter(teams(['e-c']), side, IDS)).toEqual({
                'e-a': 3,
                'e-b': 3,
                'e-c': 2,
            });
        });
        it(`${side}-side Zosimos: two repairers each lose one, the idle holder none`, () => {
            expect(chargesAfter(teams(['e-a', 'e-b']), side, IDS)).toEqual({
                'e-a': 2,
                'e-b': 2,
                'e-c': 3,
            });
        });
        it(`${side}-side Zosimos: no repair → nobody loses a charge`, () => {
            expect(chargesAfter(teams([]), side, IDS)).toEqual({ 'e-a': 3, 'e-b': 3, 'e-c': 3 });
        });
    }
});
