/**
 * "When this Unit is directly damaged AS A PRIMARY TARGET" scopes the whole sentence, every clause
 * hanging off it:
 *  - Stalwart: "… it deals 70% damage to the enemy and gains Legion Discipline II for 3 turns" —
 *    the buff, like the counter, needs him to be the hit's primary target.
 *  - Malvex: "… this Unit gains shield equal to 15% of the damage dealt".
 * A covered (non-primary) hit inside an area pattern fires neither.
 *
 * Real parsed passives (buildTraceShip, refit 4), mounted on both sides. A hand-built attacker
 * fires a 100% Cone-Range-1 cast at the front enemy: A at M4 is its primary target, B at M3 is
 * covered, O at M1 stands outside the cone. The passive ship takes one of those three places.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import {
    mirrorBoard,
    realSlots,
    ShipSpec,
    MirrorTeams,
    NO_SKILLS,
} from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(7));

const coneHit: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'cone-hit',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
            ],
        },
    ],
};

type Place = 'A' | 'B' | 'O';
const POS: Record<Place, Position> = { A: 'M4', B: 'M3', O: 'M1' };

/** The passive ship at `place`, harmless fillers on the other two places. */
const teams = (ship: string, place: Place): MirrorTeams => ({
    caster: [
        {
            id: 'cone',
            position: 'M4',
            attack: 1000,
            speed: 150,
            pattern: 'Pattern-Cone-Range-1',
            skills: coneHit,
        },
    ],
    other: (['A', 'B', 'O'] as Place[]).map((p): ShipSpec =>
        p === place
            ? {
                  id: 'holder',
                  position: POS[p],
                  speed: 1,
                  skills: {
                      slots: [{ slot: 'active', abilities: [] }, ...realSlots(ship, ['passive'])],
                  },
              }
            : { id: `filler-${p}`, position: POS[p], speed: 1, skills: NO_SKILLS }
    ),
});

const run = (ship: string, place: Place, side: 'player' | 'enemy') => {
    const { input, idOf } = mirrorBoard(teams(ship, place), side);
    const holder = idOf('holder');
    const cone = idOf('cone');
    const bus = createEventBus();
    let struck = false;
    let primary = false;
    const buffs: string[] = [];
    let shield = 0;
    bus.on('attacked', (e) => {
        if (e.attackerId === cone && e.targetId === holder && e.round === 1) {
            struck = true;
            primary = e.isPrimaryTarget === true;
        }
    });
    bus.on('buff-applied', (e) => {
        if (e.actorId === holder && e.round === 1) buffs.push(e.buffName);
    });
    bus.on('shield-applied', (e) => {
        if (e.granterId === holder && e.round === 1) shield += e.amount;
    });
    runCombat({ ...input, bus });
    return { struck, primary, buffs, shield: Math.round(shield) };
};

describe("Stalwart: 'directly damaged as a primary target … gains Legion Discipline II'", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: primary target → gains it`, () => {
            expect(run('Stalwart', 'A', side)).toEqual({
                struck: true,
                primary: true,
                buffs: ['Legion Discipline II'],
                shield: 0,
            });
        });
        it(`${side}-side: covered by the cone → no buff`, () => {
            expect(run('Stalwart', 'B', side)).toEqual({
                struck: true,
                primary: false,
                buffs: [],
                shield: 0,
            });
        });
        it(`${side}-side: outside the cone → no buff`, () => {
            expect(run('Stalwart', 'O', side)).toEqual({
                struck: false,
                primary: false,
                buffs: [],
                shield: 0,
            });
        });
    }
});

describe("Malvex: 'When directly damaged as a primary target, … shield equal to 15% of the damage dealt'", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: primary target → 15% of the 1000 taken`, () => {
            expect(run('Malvex', 'A', side)).toEqual({
                struck: true,
                primary: true,
                buffs: [],
                shield: 150,
            });
        });
        it(`${side}-side: covered by the cone → no shield`, () => {
            expect(run('Malvex', 'B', side)).toEqual({
                struck: true,
                primary: false,
                buffs: [],
                shield: 0,
            });
        });
        it(`${side}-side: outside the cone → no shield`, () => {
            expect(run('Malvex', 'O', side)).toEqual({
                struck: false,
                primary: false,
                buffs: [],
                shield: 0,
            });
        });
    }
});
