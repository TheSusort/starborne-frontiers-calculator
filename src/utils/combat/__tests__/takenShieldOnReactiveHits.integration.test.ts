/**
 * Damage-taken shields fire on every direct hit, not only on cast hits (every hit is direct, R36):
 *  - Malvex, "When directly damaged as a primary target, gains shield equal to 15% of the damage
 *    dealt": a counter-attack and a round-start hit aimed at him are primary-target hits (R92,
 *    R101, R110), so he shields.
 *  - Quixilver, "gains a shield equal to 25% of the damage taken when taking HP damage and still
 *    having a shield" (R140): a counter-attack and a round-start hit that break through her shield
 *    shield her too.
 *
 * Real parsed kits (refit 4); every board runs with the shielder on the player side and on the
 * enemy side, each against a control where the hit never comes.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    realKit,
    hitKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(140));

const SIDES: Placement[] = ['player', 'enemy'];

const slotsOf = (ship: string, keep: readonly string[]): ShipSkills['slots'] =>
    realKit(ship).slots.filter((s) => keep.includes(s.slot));

const passiveOnly = (ship: string): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [] }, ...slotsOf(ship, ['passive'])],
});

/** Shield the shielder granted itself without a cast (a damage-taken shield), per round. */
const uncastShieldByRound = (
    placement: Placement,
    shielder: BoardUnit,
    opponent: BoardUnit,
    rounds: number
): number[] => {
    const { input, id } = boardInput(placement, shielder, [], [opponent], rounds);
    const me = id(shielder);
    const bus = createEventBus();
    const byRound = Array.from({ length: rounds }, () => 0);
    bus.on('shield-applied', (e) => {
        if (e.granterId === me && e.uncast) byRound[e.round - 1] += e.amount;
    });
    runCombat({ ...input, bus });
    return byRound;
};

const stalwart = (withPassive: boolean): BoardUnit => ({
    id: 'stalwart',
    kit: withPassive ? passiveOnly('Stalwart') : { slots: [{ slot: 'active', abilities: [] }] },
    position: 'M4',
    speed: 1,
    attack: 10_000,
});

/** Chakara with only her passives: at round start she hits the fastest enemy for 60%. */
const chakara = (withPassive: boolean): BoardUnit => ({
    id: 'chakara',
    kit: withPassive ? passiveOnly('Chakara') : { slots: [{ slot: 'active', abilities: [] }] },
    position: 'M4',
    speed: 1,
    attack: 10_000,
});

describe.each(SIDES)('shielder on the %s side', (placement) => {
    describe('Malvex', () => {
        const malvex = (kit: ShipSkills): BoardUnit => ({
            id: 'malvex',
            kit,
            position: 'M4',
            speed: 300,
            attack: 10_000,
        });

        it("Stalwart's counter strikes Malvex as a primary target → Malvex shields", () => {
            const kit = { slots: [...hitKit(100).slots, ...slotsOf('Malvex', ['passive'])] };
            const [r1] = uncastShieldByRound(placement, malvex(kit), stalwart(true), 1);
            expect(r1).toBeGreaterThan(0);
            const [control] = uncastShieldByRound(placement, malvex(kit), stalwart(false), 1);
            expect(control).toBe(0);
        });

        it("Chakara's round-start hit strikes Malvex as a primary target → Malvex shields", () => {
            const [r1] = uncastShieldByRound(
                placement,
                malvex(passiveOnly('Malvex')),
                chakara(true),
                1
            );
            expect(r1).toBeGreaterThan(0);
            const [control] = uncastShieldByRound(
                placement,
                malvex(passiveOnly('Malvex')),
                chakara(false),
                1
            );
            expect(control).toBe(0);
        });
    });

    describe('Quixilver', () => {
        /** Her real active (a hit that shields her) plus her passives. */
        const quixilver = (): BoardUnit => ({
            id: 'quixilver',
            kit: { slots: slotsOf('Quixilver', ['active', 'passive']) },
            position: 'M4',
            speed: 300,
            attack: 10_000,
        });

        it("Stalwart's counter breaks through her shield → she shields off it", () => {
            const [r1] = uncastShieldByRound(placement, quixilver(), stalwart(true), 1);
            expect(r1).toBeGreaterThan(0);
            const [control] = uncastShieldByRound(placement, quixilver(), stalwart(false), 1);
            expect(control).toBe(0);
        });

        it("Chakara's round-2 start hit breaks through her shield → she shields off it", () => {
            const [r1, r2] = uncastShieldByRound(placement, quixilver(), chakara(true), 2);
            // Round 1's round-start hit finds no shield yet; her round-1 cast grants one.
            expect(r1).toBe(0);
            expect(r2).toBeGreaterThan(0);
            const control = uncastShieldByRound(placement, quixilver(), chakara(false), 2);
            expect(control).toEqual([0, 0]);
        });
    });
});
