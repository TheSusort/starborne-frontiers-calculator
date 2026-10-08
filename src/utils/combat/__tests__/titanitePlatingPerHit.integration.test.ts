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
import { selfBuffStacksForOwner } from '../triggers';
import type { StatusEngine } from '../statusEngine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
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

// =============================================================================
// A counter-attack or passive damage proc is a direct hit, so it spends a stack like a skill hit;
// a Protection-transferred slice is not a hit on the holder, so it does not.
// =============================================================================

const PLATING = 'Titanite Plating';

const reactive = (type: 'counter' | 'damage'): Ability => ({
    id: `reactive-${type}`,
    type,
    target: 'enemy',
    trigger: 'on-attacked',
    conditions: [],
    config:
        type === 'counter'
            ? { type: 'counter', multiplier: 100, hits: 1 }
            : { type: 'damage', multiplier: 100 },
});

const protectionAura = (stacks: number): Ability => ({
    id: 'protection-aura',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'buff', buffName: 'Protection', parsedEffects: {}, stacks, isStackable: true },
});

/** Isha casts her charged first (3 plating stacks), then reads her stacks at the end of round 1.
 *  `opponentKit` is what the opposing unit does; `ally` (optional) stands in front of Isha. */
const platingAfterRound1 = (
    placement: Placement,
    opponentKit: ShipSkills,
    opts: { ishaProtects?: boolean } = {}
): { stacks: number; incoming: number } => {
    const ishaKit = realKit('Isha');
    const isha: BoardUnit = {
        id: 'isha',
        kit: opts.ishaProtects
            ? {
                  ...ishaKit,
                  slots: [...ishaKit.slots, { slot: 'passive', abilities: [protectionAura(3)] }],
              }
            : ishaKit,
        position: opts.ishaProtects ? 'M1' : 'M4',
        speed: 300,
        defence: 2000,
        chargeCount: 4,
        startCharged: true,
    };
    const ally: BoardUnit = { id: 'front', kit: hitKit(), position: 'M4', speed: 50, attack: 1 };
    const opponent: BoardUnit = {
        id: 'opponent',
        kit: opponentKit,
        position: 'M4',
        speed: 100,
        attack: 10_000,
    };
    const { input, id } = boardInput(
        placement,
        isha,
        opts.ishaProtects ? [ally] : [],
        [opponent],
        1
    );
    let engine: StatusEngine | undefined;
    const result = runCombat({
        ...input,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    return {
        stacks: selfBuffStacksForOwner(engine!, id(isha), PLATING),
        incoming: result.rounds[0].perActorIncoming?.[id(isha)]?.incoming ?? 0,
    };
};

const passiveOnly = (a: Ability): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        { slot: 'passive', abilities: [a] },
    ],
});

describe.each<Placement>(['player', 'enemy'])(
    'reactive hits on an Isha on the %s side',
    (placement) => {
        it('CONTROL: with nothing hitting her, the 3 stacks stand', () => {
            expect(platingAfterRound1(placement, NO_KIT)).toEqual({ stacks: 3, incoming: 0 });
        });

        it('a skill hit spends one stack', () => {
            expect(platingAfterRound1(placement, hitKit()).stacks).toBe(2);
        });

        it('a counter-attack hit spends one stack', () => {
            // The opponent never acts; Isha attacks it, and its counter lands on her.
            expect(platingAfterRound1(placement, passiveOnly(reactive('counter'))).stacks).toBe(2);
        });

        it('a passive damage proc hit spends one stack', () => {
            expect(platingAfterRound1(placement, passiveOnly(reactive('damage'))).stacks).toBe(2);
        });

        it('a Protection-transferred slice does not spend one', () => {
            // Isha protects the front ally; the opponent hits the ally and Isha absorbs a slice.
            const r = platingAfterRound1(placement, hitKit(), { ishaProtects: true });
            expect(r.incoming).toBeGreaterThan(0); // the slice really landed on her
            expect(r.stacks).toBe(3);
        });
    }
);
