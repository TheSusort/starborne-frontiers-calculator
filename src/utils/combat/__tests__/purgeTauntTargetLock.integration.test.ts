/**
 * Owner ruling 2026-10-26: Iridium holds Taunt; Cobalt's active "purges 1 buff from the enemy and
 * deals 200% damage" purges it. "Purge removed taunt and still target iridium. Next hit targets the
 * natural target (no taunt)." And for a multi-hit cast: "A multiform with purge would retarget after
 * the first hit removing the taunt." So the cast's first hit stays on the target chosen when the
 * turn began; every later hit, of this cast or the next turn, selects from the live board.
 *
 * Board (both mounts): the purger at M4; a plain ship X at M4 (its natural `front` pick); the
 * taunter T at M1 (col 4 is the front, so Taunt drags the hit backwards). T's Taunt lasts 3 turns,
 * so only the purge can explain round 2 going to X.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { mirrorBoard, realSlots, ShipSpec } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error('This suite requires docs/ship-skills.csv and docs/ship-data.json');
    }
});
beforeEach(() => setupKeyedRng(11));

const taunt3: Ability = {
    id: 'taunt3',
    type: 'buff',
    target: 'self',
    trigger: 'pre-combat',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Taunt',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 3,
    },
};
const purge1: Ability = {
    id: 'purge1',
    type: 'purge',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'purge', count: 1 },
};
const steal1: Ability = {
    id: 'steal1',
    type: 'buff-steal',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'buff-steal', count: 1 },
};
const damage = (hits?: number): Ability => ({
    id: 'dmg',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, ...(hits ? { hits } : {}) },
});

/** Per round, the damage T and X took. */
const fight = (side: 'player' | 'enemy', purgerSkills: ShipSkills, numRounds = 2) => {
    const purger: ShipSpec = {
        id: 'purger',
        position: 'M4',
        speed: 100,
        attack: 1000,
        hacking: 1e6,
        skills: purgerSkills,
    };
    const x: ShipSpec = { id: 'x', position: 'M4', speed: 50, hp: 1e9 };
    const t: ShipSpec = {
        id: 't',
        position: 'M1',
        speed: 40,
        hp: 1e9,
        skills: {
            slots: [
                { slot: 'active', abilities: [] },
                { slot: 'passive', abilities: [taunt3] },
            ],
        },
    };
    const { input, idOf } = mirrorBoard({ caster: [purger], other: [x, t], numRounds }, side);
    const result = runCombat(input);
    return result.rounds.map((r) => ({
        t: r.perActorIncoming?.[idOf('t')]?.incoming ?? 0,
        x: r.perActorIncoming?.[idOf('x')]?.incoming ?? 0,
    }));
};

describe('a pre-damage purge of Taunt does not move the hit it precedes', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side Cobalt: the purge strips Taunt, the hit still lands on the taunter; next turn hits X`, () => {
            const rounds = fight(side, { slots: realSlots('Cobalt', ['active']) });
            expect(rounds[0].t).toBeGreaterThan(0);
            expect(rounds[0].x).toBe(0);
            expect(rounds[1].x).toBeGreaterThan(0);
            expect(rounds[1].t).toBe(0);
        });

        it(`${side}-side steal: stealing the Taunt does not move the hit either`, () => {
            const rounds = fight(side, {
                slots: [{ slot: 'active', abilities: [steal1, damage()] }],
            });
            expect(rounds[0].t).toBeGreaterThan(0);
            expect(rounds[0].x).toBe(0);
            expect(rounds[1].x).toBeGreaterThan(0);
            expect(rounds[1].t).toBe(0);
        });

        it(`${side}-side control: without the purge, Taunt holds both turns`, () => {
            const rounds = fight(side, { slots: [{ slot: 'active', abilities: [damage()] }] });
            expect(rounds[0].t).toBeGreaterThan(0);
            expect(rounds[0].x).toBe(0);
            expect(rounds[1].t).toBeGreaterThan(0);
            expect(rounds[1].x).toBe(0);
        });

        it(`${side}-side two-hit purger: the first hit lands on the taunter, the second on X`, () => {
            const rounds = fight(
                side,
                { slots: [{ slot: 'active', abilities: [purge1, damage(2)] }] },
                1
            );
            expect(rounds[0].t).toBeGreaterThan(0);
            expect(rounds[0].x).toBeGreaterThan(0);
            expect(rounds[0].t).toBe(rounds[0].x);
        });
    }
});
