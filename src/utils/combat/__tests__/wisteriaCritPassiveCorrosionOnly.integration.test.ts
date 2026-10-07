/**
 * Wisteria's passive — "When this Unit inflicts Corrosion with a critical hit, it also inflicts
 * Inferno II for 2 turns" — answers a critical Corrosion infliction only (owner ruling). A
 * critical cast that lands some other DoT gives her nothing.
 *
 * Wisteria carries her real passive (refit 4) beside a hand-built active that deals damage and
 * inflicts either Corrosion I (the control) or Inferno I. Every hit crits and every DoT lands.
 * The measure is how many Inferno II (tier 30) stacks she inflicts. Both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { DoTType } from '../../../types/calculator';
import { mirrorBoard, realSlots, ShipSpec } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(11));

const activeInflicting = (dotType: DoTType): ShipSkills['slots'][number] => {
    const abilities: Ability[] = [
        {
            id: 'w-hit',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
        {
            id: 'w-dot',
            type: 'dot',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'dot',
                dotType,
                tier: dotType === 'corrosion' ? 3 : 15,
                stacks: 1,
                duration: 3,
            },
        },
    ];
    return { slot: 'active', abilities };
};

const infernoIIInflicted = (side: 'player' | 'enemy', dotType: DoTType): number => {
    const wisteria: ShipSpec = {
        id: 'wisteria',
        position: 'M4',
        speed: 100,
        attack: 1000,
        crit: 100,
        critDamage: 50,
        hacking: 1e6,
        skills: { slots: [activeInflicting(dotType), ...realSlots('Wisteria', ['passive'])] },
    };
    const x: ShipSpec = { id: 'x', position: 'M4', speed: 1, hp: 1e9 };
    const { input, idOf } = mirrorBoard({ caster: [wisteria], other: [x], numRounds: 2 }, side);
    const bus = createEventBus();
    let n = 0;
    bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) => {
        if (e.sourceId === idOf('wisteria') && e.dotType === 'inferno' && e.tier === 30)
            n += e.stacks;
    });
    runCombat({ ...input, bus });
    return n;
};

describe("Wisteria's crit passive answers a critical Corrosion infliction only", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: a critical Corrosion I wakes it (control)`, () => {
            expect(infernoIIInflicted(side, 'corrosion')).toBeGreaterThan(0);
        });
        it(`${side}-side: a critical Inferno I does not`, () => {
            expect(infernoIIInflicted(side, 'inferno')).toBe(0);
        });
    }
});
