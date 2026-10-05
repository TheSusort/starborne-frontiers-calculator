/**
 * Repair Over Time heals from the HOLDER's own max HP (owner ruling R55, 2026-10-05; the game's
 * tooltip: "This Unit repairs 10/15/20% of its max HP every turn").
 *
 * Flamel's real active grants Repair Over Time I (10%) to her allies. Board: Flamel (speed 300)
 * casts first, the opponent (speed 200) then hits the holder, and the holder (speed 100) ticks
 * at the start of its own turn. Flamel's own 17% repair lands before the hit, on a full-HP holder,
 * so the tick is the only HP the holder regains after the hit. `hot-ticked.amount` is the HP that
 * landed, so every expected tick below leaves the holder short of full.
 *
 * Run with Flamel on the player side and on the enemy side.
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
    hitKit,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(55));

/** The HP each `hot-ticked` landed on the holder in round 1, in order. */
const holderTicks = (
    placement: Placement,
    flamelHp: number,
    holderHp: number,
    hit: number
): number[] => {
    const flamel: BoardUnit = {
        id: 'flamel',
        kit: realKit('Flamel'),
        position: 'M3',
        speed: 300,
        hp: flamelHp,
        // Never charged, so every cast is the active's Repair Over Time I.
        chargeCount: 99,
        pattern: parsePattern('Pattern-Support-All'),
    };
    const holder: BoardUnit = {
        id: 'holder',
        kit: NO_KIT,
        position: 'M4',
        speed: 100,
        hp: holderHp,
    };
    const opponent: BoardUnit = {
        id: 'opponent',
        kit: hitKit(),
        position: 'M4',
        speed: 200,
        attack: hit,
    };
    const { input, id } = boardInput(placement, flamel, [holder], [opponent], 1);
    const holderId = id(holder);
    const bus = createEventBus();
    const ticks: number[] = [];
    bus.on('hot-ticked', (e: Extract<CombatEvent, { type: 'hot-ticked' }>) => {
        if (e.holderId === holderId) ticks.push(Math.round(e.amount));
    });
    let holderHit = 0;
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.targetId === holderId) holderHit += e.damage ?? 0;
    });
    runCombat({ ...input, bus });
    // Instrument check: the hit really opened the room the expected tick needs.
    expect(holderHit).toBeGreaterThan(0);
    return ticks;
};

describe.each<Placement>(['player', 'enemy'])('Flamel on the %s side', (placement) => {
    it('a 60,000-HP holder of a 20,000-HP Flamel repairs 6,000 (10% of its own max HP)', () => {
        expect(holderTicks(placement, 20_000, 60_000, 30_000)).toEqual([6000]);
    });

    it('reverse board: a 20,000-HP holder of a 60,000-HP Flamel repairs 2,000', () => {
        expect(holderTicks(placement, 60_000, 20_000, 15_000)).toEqual([2000]);
    });

    it("negative: the applier's max HP does not move the tick", () => {
        const small = holderTicks(placement, 20_000, 60_000, 30_000);
        const large = holderTicks(placement, 45_000, 60_000, 30_000);
        expect(large).toEqual(small);
    });
});
