/**
 * Toxic Overflow's end-of-round spread resolves holder by holder in TURN ORDER (live speed, then
 * board position, then the player side), whichever side Hemlock is on and however the roster is
 * listed — each spread rolls the applier's landing gate, so the order decides who gets which roll.
 *
 * Board: Hemlock lands Toxic Overflow on both holders (the roster lists X first). Both hold a
 * seeded Corrosion stack. Both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { TOXIC_OVERFLOW } from '../../../constants/toxicOverflow';
import type { Ability } from '../../../types/abilities';
import type { CombatActor } from '../state';
import { mirrorBoard, realSlots, ShipSpec } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error('This suite requires docs/ship-skills.csv and docs/ship-data.json');
    }
});
beforeEach(() => setupKeyedRng(11));

const toxicOverflowOnAll = (): Ability => {
    const found = realSlots('Hemlock', ['charged'])[0].abilities.find(
        (a) => a.config.type === 'debuff' && a.config.buffName.startsWith(TOXIC_OVERFLOW)
    );
    if (!found) throw new Error('Hemlock charged carries no Toxic Overflow');
    return found;
};

const spreadOrder = (side: 'player' | 'enemy', speeds: { x: number; y: number }): string[] => {
    const hemlock: ShipSpec = {
        id: 'hemlock',
        position: 'M4',
        speed: 1000,
        hp: 1e9,
        hacking: 1000,
        pattern: 'Pattern-All',
        skills: { slots: [{ slot: 'active', abilities: [toxicOverflowOnAll()] }] },
    };
    const x: ShipSpec = { id: 'x', position: 'M4', speed: speeds.x, hp: 1e9 };
    const y: ShipSpec = { id: 'y', position: 'T4', speed: speeds.y, hp: 1e9 };
    const { input, idOf } = mirrorBoard({ caster: [hemlock], other: [x, y], numRounds: 1 }, side);
    const bus = createEventBus();
    const order: string[] = [];
    bus.on('corrosion-spread', (e: Extract<CombatEvent, { type: 'corrosion-spread' }>) => {
        order.push(e.sourceId === idOf('x') ? 'x' : e.sourceId === idOf('y') ? 'y' : e.sourceId);
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            for (const id of ['x', 'y']) {
                all.find((a) => a.id === idOf(id))!.corrosionEntries.push({
                    stacks: 1,
                    tier: 6,
                    remainingRounds: 9,
                    sourceId: idOf(id),
                });
            }
        },
    });
    return order;
};

describe("Toxic Overflow's end-of-round spread resolves in turn order", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: the faster holder spreads first although the roster lists it second`, () => {
            expect(spreadOrder(side, { x: 100, y: 200 })).toEqual(['y', 'x']);
        });
        it(`${side}-side: a speed tie goes to the top-row holder`, () => {
            expect(spreadOrder(side, { x: 150, y: 150 })).toEqual(['y', 'x']);
        });
        it(`${side}-side: a faster first-listed holder still spreads first`, () => {
            expect(spreadOrder(side, { x: 300, y: 200 })).toEqual(['x', 'y']);
        });
    }
});
