/**
 * Lionheart's active "deals 170% damage and grants Defense Up II for 2 turns" names no
 * recipient. Owner rulings R60/R62 (2026-10-05, Q4): the grant goes to Lionheart HIMSELF and his
 * ADJACENT allies — the game gives his active a support pattern of its own beside the offensive
 * Line-from-centre one, which `docs/ship-targeting.csv` does not carry.
 *
 * Board: Lionheart at M3 casts his active once. M3's neighbours are M2, M4, T2, T3, B2, B3
 * (targeting/board.ts), so the ally at M4 is adjacent and the ally at M1 is two hexes away. The
 * reverse board swaps the two allies' cells. Both allies are full roster members on Lionheart's
 * side that differ only by position, so "the far ally got nothing" measures adjacency.
 *
 * Run with Lionheart on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { parsePattern } from '../../targetingParser';
import {
    boardInput,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { Position } from '../../../types/encounters';
import type { ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(60));

/** Who received `buffName` in round 1, as unit ids ('lionheart' for the caster). */
const recipients = (
    placement: Placement,
    kit: ShipSkills,
    nearCell: Position,
    farCell: Position,
    buffName: string
): string[] => {
    const caster: BoardUnit = {
        id: 'lionheart',
        kit,
        position: 'M3',
        speed: 300,
        attack: 1000,
        // Never charged, so his one cast is the active.
        chargeCount: 99,
        pattern: parsePattern('Pattern-Line-from-centre-Range-1'),
    };
    const near: BoardUnit = { id: 'near', kit: NO_KIT, position: nearCell, speed: 10 };
    const far: BoardUnit = { id: 'far', kit: NO_KIT, position: farCell, speed: 10 };
    const opponent: BoardUnit = { id: 'opponent', kit: NO_KIT, position: 'M4', speed: 1 };
    const { input, id } = boardInput(placement, caster, [near, far], [opponent], 1);
    const unitById = new Map([caster, near, far].map((u) => [id(u), u.id]));
    const bus = createEventBus();
    const out = new Set<string>();
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.buffName === buffName) out.add(unitById.get(e.actorId) ?? e.actorId);
    });
    runCombat({ ...input, bus });
    return [...out].sort();
};

/** The non-vacuity control: one plain all-allies Defense Up II on Lionheart's damage active. */
const allAlliesControl = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'hit',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 170 },
                },
                {
                    id: 'control',
                    type: 'buff',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Defense Up II',
                        parsedEffects: { defense: 30 },
                        stacks: 1,
                        isStackable: false,
                        duration: 2,
                    },
                },
            ],
        },
    ],
});

describe.each<Placement>(['player', 'enemy'])('Lionheart on the %s side', (placement) => {
    it('Defense Up II lands on Lionheart and the adjacent ally, not the far one', () => {
        expect(recipients(placement, realKit('Lionheart'), 'M4', 'M1', 'Defense Up II')).toEqual([
            'lionheart',
            'near',
        ]);
    });

    it('reverse board: the ally cells swapped, the grant follows adjacency', () => {
        // `near` now stands two hexes away at M1 and `far` beside him at T3.
        expect(recipients(placement, realKit('Lionheart'), 'M1', 'T3', 'Defense Up II')).toEqual([
            'far',
            'lionheart',
        ]);
    });

    it('control: an all-allies grant from the same cell reaches all three', () => {
        expect(recipients(placement, allAlliesControl(), 'M4', 'M1', 'Defense Up II')).toEqual([
            'far',
            'lionheart',
            'near',
        ]);
    });
});
