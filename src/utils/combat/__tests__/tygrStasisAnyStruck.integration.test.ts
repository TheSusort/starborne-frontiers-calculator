/**
 * Tygr's passive "After damaging an enemy affected by Stasis, once per round, this Unit gains one
 * extra action" fires once if ANY enemy his cast strikes holds Stasis (the self-gain shape of
 * rulings R17/R20), not only the aimed one. Stasis on an enemy outside his pattern never counts,
 * and he never gains more than one extra action a round.
 *
 * Real parsed active + passive (buildTraceShip, refit 4), active on Line-Range-2 from M4, mounted
 * on both sides. A faster helper lands Stasis first: aimed at the front enemy (A, M4) or the
 * back-most one — B at M3 inside the Line, or C at M1 outside it.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { ShipSkills } from '../../../types/abilities';
import { mirrorBoard, realSlots, ShipSpec, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(7));

const landsStatus = (name: string): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: `helper-${name}`,
                    type: 'debuff',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'debuff',
                        buffName: name,
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        application: 'inflict',
                        duration: 3,
                    },
                },
            ],
        },
    ],
});

interface Case {
    /** The helper's aim: 'front' = A, 'back' = the back-most enemy on the board. */
    aim: 'front' | 'back';
    /** C at M1, outside Tygr's Line, so it is the back-most enemy. */
    withC: boolean;
    status: string;
}

const teams = ({ aim, withC, status }: Case): MirrorTeams => ({
    caster: [
        {
            id: 'tygr',
            position: 'M4',
            attack: 1000,
            speed: 50,
            pattern: 'Pattern-Line-Range-2',
            skills: { slots: realSlots('Tygr', ['active', 'passive']) },
        },
        {
            id: 'helper',
            position: 'T4',
            speed: 150,
            hacking: 1e6,
            target: aim,
            skills: landsStatus(status),
        },
    ],
    other: [
        { id: 'e-A', position: 'M4', speed: 1 },
        { id: 'e-B', position: 'M3', speed: 1 },
        ...(withC ? [{ id: 'e-C', position: 'M1', speed: 1 } as ShipSpec] : []),
    ],
    numRounds: 2,
});

const LABEL: Record<string, string> = { 'e-A': 'A', 'e-B': 'B', 'e-C': 'C' };

const run = (c: Case, side: 'player' | 'enemy') => {
    const { input, idOf } = mirrorBoard(teams(c), side);
    const label = new Map(Object.keys(LABEL).map((id) => [idOf(id), LABEL[id]]));
    const tygr = idOf('tygr');
    const bus = createEventBus();
    const turns = [0, 0];
    const stasisOn = new Set<string>();
    const struck = new Set<string>();
    bus.on('turn-started', (e) => {
        if (e.actorId === tygr) turns[e.round - 1]++;
    });
    bus.on('debuff-applied', (e) => {
        if (e.buffName === 'Stasis' && e.round === 1) stasisOn.add(label.get(e.targetId) ?? '?');
    });
    bus.on('attacked', (e) => {
        if (e.attackerId === tygr && e.round === 1) struck.add(label.get(e.targetId) ?? '?');
    });
    runCombat({ ...input, bus });
    return { turns, stasisOn: [...stasisOn].sort(), struck: [...struck].sort() };
};

describe("Tygr: 'After damaging an enemy affected by Stasis' reads every struck enemy", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: Stasis on covered B → one extra action each round`, () => {
            expect(run({ aim: 'back', withC: false, status: 'Stasis' }, side)).toEqual({
                turns: [2, 2],
                stasisOn: ['B'],
                struck: ['A', 'B'],
            });
        });
        it(`${side}-side reverse board: Stasis on aimed A → one extra action each round`, () => {
            expect(run({ aim: 'front', withC: false, status: 'Stasis' }, side)).toEqual({
                turns: [2, 2],
                stasisOn: ['A'],
                struck: ['A', 'B'],
            });
        });
        it(`${side}-side: Stasis on C outside the Line → no extra action`, () => {
            expect(run({ aim: 'back', withC: true, status: 'Stasis' }, side)).toEqual({
                turns: [1, 1],
                stasisOn: ['C'],
                struck: ['A', 'B'],
            });
        });
        it(`${side}-side: covered B holds a different debuff → no extra action`, () => {
            expect(run({ aim: 'back', withC: false, status: 'Disable' }, side)).toEqual({
                turns: [1, 1],
                stasisOn: [],
                struck: ['A', 'B'],
            });
        });
    }
});
