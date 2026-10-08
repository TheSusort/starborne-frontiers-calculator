/**
 * A repair that heals 0 (its target is at full HP) is still a repair (R133b). Zosimos's active
 * reads "If the target was repaired this round, this Unit adds 1 charge to its charged skill", so
 * an enemy healer topping up full-HP allies before Zosimos acts still arms the clause.
 *
 * Real parsed active and charged slots (Zosimos, refit 4; his passive is left out so its own
 * charge gain cannot mask the active's), mounted on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import type { CombatActor } from '../state';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { ShipSkills } from '../../../types/abilities';
import { mirrorBoard, realSlots, type MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error('This suite requires docs/ship-skills.csv and docs/ship-data.json');
    }
});
beforeEach(() => setupKeyedRng(7));

const healAll = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'healer-repair',
                    type: 'heal',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                },
            ],
        },
    ],
});

const teams = (withHealer: boolean): MirrorTeams => ({
    caster: [
        {
            id: 'zosimos',
            position: 'M4',
            speed: 10,
            chargeCount: 5,
            hasChargedSkill: true,
            skills: { slots: realSlots('Zosimos', ['active', 'charged']) },
        },
    ],
    other: [
        { id: 'x', position: 'M4', speed: 1 },
        ...(withHealer
            ? [{ id: 'healer', position: 'M3' as const, speed: 150, skills: healAll() }]
            : []),
    ],
});

/** Charge Zosimos gained from his active's clause in round 1. `targetHpFraction` < 1 makes the
 *  repair land HP; 1 makes it heal 0. */
const chargeGains = (
    side: 'player' | 'enemy',
    withHealer: boolean,
    targetHpFraction: number
): number[] => {
    const { input, idOf } = mirrorBoard(teams(withHealer), side);
    const zosimos = idOf('zosimos');
    const target = idOf('x');
    const bus = createEventBus();
    const gains: number[] = [];
    bus.on('charge-changed', (e) => {
        if (e.actorId === zosimos && e.round === 1 && e.reason === 'manip')
            gains.push(e.newCharge - e.oldCharge);
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            for (const a of all) if (a.id === target) a.currentHp = a.stats.hp * targetHpFraction;
        },
    });
    return gains;
};

describe("Zosimos: 'If the target was repaired this round' counts a 0-HP repair", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: a repair onto a full-HP target arms the clause`, () => {
            expect(chargeGains(side, true, 1)).toEqual([1]);
        });
        it(`${side}-side: positive control, a repair that lands HP arms it`, () => {
            expect(chargeGains(side, true, 0.5)).toEqual([1]);
        });
        it(`${side}-side: negative control, no repair at all arms nothing`, () => {
            expect(chargeGains(side, false, 1)).toEqual([]);
        });
    }
});
