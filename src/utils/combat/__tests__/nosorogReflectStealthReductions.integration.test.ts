/**
 * Nosorog's reflect bounce is direct damage that lands like a counter (R137, R176), so it reads
 * the attacker's stealth-conditional reductions the way a counter does: a stealthed hitter under
 * "takes X% less direct damage while Stealth is active" (Voidshade, Wusheng) takes the reduced
 * bounce, and an unstealthed one takes it whole.
 *
 * Every case runs with Nosorog on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    hitKit,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(5));

const SIDES: Placement[] = ['player', 'enemy'];

const passive = (ability: Ability): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [ability],
});

/** "Takes 20% less direct damage while Stealth is active." */
const stealthReduction = passive({
    id: 'stealth-reduction',
    type: 'incoming-reduction',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'incoming-reduction',
        scope: 'direct',
        condition: 'self-stealth',
        pct: 20,
        critFamily: false,
    },
});

/** An always-on Stealth on its holder. */
const stealthAura = passive({
    id: 'stealth-aura',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Stealth',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
    },
});

const nosorog = (): BoardUnit => ({
    id: 'nosorog',
    kit: {
        slots: [
            { slot: 'active', abilities: [] },
            ...realKit('Nosorog').slots.filter((s) => s.slot === 'passive'),
        ],
    },
    position: 'M4',
    speed: 1,
    attack: 1,
    defence: 5_000,
});

const hitter = (extra: ShipSkills['slots']): BoardUnit => ({
    id: 'hitter',
    kit: { slots: [...hitKit(100).slots, ...extra] },
    position: 'M4',
    speed: 50,
    attack: 10_000,
    defence: 0,
});

/** The bounce Nosorog lands on the hitter in round 1. */
const bounce = (placement: Placement, extra: ShipSkills['slots']): number => {
    const reflector = nosorog();
    const attacker = hitter(extra);
    const { input, id } = boardInput(placement, reflector, [], [attacker], 1);
    const bus = createEventBus();
    const rows: number[] = [];
    bus.on('reactive-damage-performed', (e) => {
        if (e.sourceId === id(reflector) && e.targetId === id(attacker)) rows.push(e.amount);
    });
    runCombat({ ...input, bus });
    expect(rows).toHaveLength(1);
    return rows[0];
};

describe.each(SIDES)('Nosorog on the %s side', (placement) => {
    it('a stealthed hitter under a stealth-conditional reduction takes the reduced bounce', () => {
        const bare = bounce(placement, [stealthAura]);
        const reduced = bounce(placement, [stealthAura, stealthReduction]);
        expect(bare).toBeGreaterThan(0);
        expect(reduced).toBeCloseTo(bare * 0.8, 6);
    });

    it('an unstealthed hitter with the same reduction takes the bounce whole', () => {
        const bare = bounce(placement, []);
        const withReduction = bounce(placement, [stealthReduction]);
        expect(withReduction).toBeCloseTo(bare, 6);
    });
});
