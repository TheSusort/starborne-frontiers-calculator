/**
 * Titanite Plating loses one stack each time its holder takes direct damage. Catalogue: "Increases
 * Defense by 5% for each stack, up to a maximum of 5 stacks, and removes one stack after taking
 * direct damage." (game-verified 2026-06-05: persists, -1 stack per incoming hit).
 *
 * Isha casts her charged first in round 1 ("gains 3 stacks of Titanite Plating"); an opponent then
 * hits her with a 3-hit attack every round. Round 1's three hits read 3, 2 and 1 stacks, so each
 * one lands harder than the last; round 2's hits read none and match an Isha who never cast it.
 * Run with Isha on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
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

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

/** Every hit Isha took from the opponent, per round, in order. */
const hitsOnIsha = (placement: Placement, castsCharged: boolean): Record<number, number[]> => {
    const isha: BoardUnit = {
        id: 'isha',
        kit: realKit('Isha'),
        position: 'M4',
        speed: 300,
        defence: 2000,
        chargeCount: 4,
        startCharged: castsCharged,
    };
    const opponent: BoardUnit = {
        id: 'opponent',
        kit: hitKit(100, 3),
        position: 'M4',
        speed: 100,
        attack: 10_000,
    };
    const { input, id } = boardInput(placement, isha, [], [opponent], 2);
    const bus = createEventBus();
    const out: Record<number, number[]> = {};
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.targetId !== id(isha) || e.attackerId !== id(opponent)) return;
        (out[e.round] ??= []).push(Math.round(e.takenDamage ?? 0));
    });
    runCombat({ ...input, bus });
    return out;
};

describe.each<Placement>(['player', 'enemy'])('Isha on the %s side', (placement) => {
    it('each hit spends one stack: round 1 climbs, round 2 is back to bare defence', () => {
        const withPlating = hitsOnIsha(placement, true);
        const bare = hitsOnIsha(placement, false);
        const [h1, h2, h3] = withPlating[1];
        expect(withPlating[1]).toHaveLength(3);
        expect(h1).toBeLessThan(h2);
        expect(h2).toBeLessThan(h3);
        expect(h3).toBeLessThan(bare[1][0]);
        expect(withPlating[2]).toEqual(bare[2]);
    });
});
