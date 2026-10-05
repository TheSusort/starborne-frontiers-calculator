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
import type { CombatActor, PendingBomb } from '../state';
import { createEventBus } from '../events';
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

/**
 * Demolisher: "When a Bomb explodes on an enemy, this Unit removes 2 charges from the enemy's
 * charged skill" — the enemy the Bomb exploded on. A Bomb seeded at countdown 1 on one holder
 * explodes on that holder's turn; the other holders keep their charges.
 */
describe('Demolisher: a Bomb explosion drains only the enemy it exploded on', () => {
    const demolisher = (): ShipSpec => ({
        id: 'demolisher',
        position: 'M4',
        speed: 10,
        skills: {
            slots: [{ slot: 'active', abilities: [] }, ...realSlots('Demolisher', ['passive'])],
        },
    });
    const teams: MirrorTeams = {
        caster: [demolisher()],
        other: [holder('e-a', 'M4', false), holder('e-b', 'M3', false), holder('e-c', 'M1', false)],
    };
    const IDS = ['e-a', 'e-b', 'e-c'];
    const bomb = (): PendingBomb => ({
        countdown: 1,
        damagePerStack: 10,
        stacks: 1,
        tier: 100,
        sourceId: 'seed',
        affinityMult: 1,
        detonationDamageModifier: 0,
        splashModifier: 0,
    });
    const run = (side: 'player' | 'enemy', bombed: string[]) => {
        const { input, idOf } = mirrorBoard(teams, side);
        const bus = createEventBus();
        const exploded: string[] = [];
        bus.on('bomb-detonated', (e) => exploded.push(e.victimId));
        let actors: CombatActor[] = [];
        runCombat({
            ...input,
            bus,
            __testTapActors: (all) => {
                actors = all;
                for (const id of bombed)
                    all.find((a) => a.id === idOf(id))!.pendingBombs.push(bomb());
            },
        });
        const charges = Object.fromEntries(
            IDS.map((id) => [id, actors.find((a) => a.id === idOf(id))?.charges])
        );
        return { charges, exploded: exploded.length };
    };

    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side Demolisher: a Bomb explodes on e-a → only e-a loses 2 charges`, () => {
            expect(run(side, ['e-a'])).toEqual({
                charges: { 'e-a': 1, 'e-b': 3, 'e-c': 3 },
                exploded: 1,
            });
        });
        it(`${side}-side Demolisher, reverse board: a Bomb explodes on e-c → only e-c loses 2`, () => {
            expect(run(side, ['e-c'])).toEqual({
                charges: { 'e-a': 3, 'e-b': 3, 'e-c': 1 },
                exploded: 1,
            });
        });
        it(`${side}-side Demolisher: Bombs explode on e-a and e-b → 2 each, e-c none`, () => {
            expect(run(side, ['e-a', 'e-b'])).toEqual({
                charges: { 'e-a': 1, 'e-b': 1, 'e-c': 3 },
                exploded: 2,
            });
        });
        it(`${side}-side Demolisher: no Bomb → nobody loses a charge`, () => {
            expect(run(side, [])).toEqual({
                charges: { 'e-a': 3, 'e-b': 3, 'e-c': 3 },
                exploded: 0,
            });
        });
    }
});
