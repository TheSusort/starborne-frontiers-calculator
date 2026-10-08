/**
 * Owner ruling R139 (2026-10-08): a hit FULLY redirected by Protection is not direct damage to the
 * protected ship. Lionheart (10 Protection at round start) takes all of a hit aimed at Stalwart, so:
 *  - Stalwart does not counter, and a Warden in his place does not react;
 *  - the hit does not lower Stalwart's Stasis;
 *  - the skill's NON-damage effects (Nayra's debuffs) still land on Stalwart.
 * A PARTIAL redirect (Meatshield's 3 stacks, 30%) leaves the kept 70% as direct damage (R143): the
 * protected ship still counters and its Stasis still drops.
 *
 * Real parsed kits (refit 4); every board runs with the protected side on the player side and on
 * the enemy side.
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
beforeEach(() => setupKeyedRng(139));

const SIDES: Placement[] = ['player', 'enemy'];

const passives = (ship: string): ShipSkills['slots'] =>
    realKit(ship).slots.filter((s) => s.slot === 'passive');

const passiveOnly = (ship: string): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [] }, ...passives(ship)],
});

type Protector = 'none' | 'Lionheart' | 'Meatshield';

const protectorUnit = (ship: Exclude<Protector, 'none'>): BoardUnit => ({
    id: ship.toLowerCase(),
    kit: passiveOnly(ship),
    position: 'M2',
    speed: 2,
    attack: 10_000,
});

const hitter = (kit: ShipSkills = hitKit(100)): BoardUnit => ({
    id: 'hitter',
    kit,
    position: 'M4',
    speed: 200,
    attack: 10_000,
    hacking: 1_000_000,
});

interface Observed {
    counters: string[];
    /** Rows a protector took from a hit aimed at the protected ship. */
    redirectRows: number;
    /** Direct hits on the protected ship that a Protection cascade split. */
    splitHits: number;
    /** Corrosion the hitter received. */
    corrosionOnHitter: number;
    /** Debuff names that landed on the protected ship. */
    debuffsOnProtected: string[];
    /** Rounds in which the protected ship cast its own skill. */
    protectedActed: number[];
}

const run = (
    placement: Placement,
    protectedShip: BoardUnit,
    protector: Protector,
    casters: BoardUnit[]
): Observed => {
    const allies = protector === 'none' ? [] : [protectorUnit(protector)];
    const [first, ...rest] = casters;
    const { input, id } = boardInput(placement, protectedShip, allies, [first, ...rest], 1);
    const all = [protectedShip, ...allies, ...casters];
    const nameOf = (actorId: string): string => all.find((u) => id(u) === actorId)?.id ?? actorId;
    const prot = id(protectedShip);
    const bus = createEventBus();
    const obs: Observed = {
        counters: [],
        redirectRows: 0,
        splitHits: 0,
        corrosionOnHitter: 0,
        debuffsOnProtected: [],
        protectedActed: [],
    };
    bus.on('attacked', (e) => {
        if (e.fromCounter) obs.counters.push(`${nameOf(e.attackerId)}>${nameOf(e.targetId)}`);
        if (e.targetId === prot && e.protectionSplit) obs.splitHits++;
    });
    bus.on('reactive-damage-performed', (e) => {
        if (e.sourceId === prot && nameOf(e.targetId) !== 'hitter') obs.redirectRows++;
    });
    bus.on('dot-applied', (e) => {
        if (nameOf(e.targetId) === 'hitter' && e.dotType === 'corrosion')
            obs.corrosionOnHitter += e.stacks;
    });
    bus.on('debuff-applied', (e) => {
        if (e.targetId === prot) obs.debuffsOnProtected.push(e.buffName);
    });
    bus.on('ability-performed', (e) => {
        if (e.actorId === prot) obs.protectedActed.push(e.round);
    });
    runCombat({ ...input, bus });
    return obs;
};

const stalwart = (): BoardUnit => ({
    id: 'stalwart',
    kit: passiveOnly('Stalwart'),
    position: 'M4',
    speed: 1,
    attack: 10_000,
});

describe.each(SIDES)('protected ship on the %s side', (placement) => {
    it('Lionheart takes the whole hit aimed at Stalwart → Stalwart does not counter', () => {
        const obs = run(placement, stalwart(), 'Lionheart', [hitter()]);
        expect(obs.redirectRows).toBeGreaterThan(0);
        expect(obs.counters).toEqual([]);
    });

    it('control: no protector → Stalwart counters the hitter', () => {
        const obs = run(placement, stalwart(), 'none', [hitter()]);
        expect(obs.redirectRows).toBe(0);
        expect(obs.counters).toEqual(['stalwart>hitter']);
    });

    it('partial redirect: Meatshield takes 30% → Stalwart still counters', () => {
        const obs = run(placement, stalwart(), 'Meatshield', [hitter()]);
        expect(obs.splitHits).toBeGreaterThan(0);
        expect(obs.counters).toEqual(['stalwart>hitter']);
    });

    it('Warden fully covered by Lionheart does not react; uncovered she does', () => {
        const warden = (): BoardUnit => ({
            id: 'warden',
            kit: passiveOnly('Warden'),
            position: 'M4',
            speed: 1,
            attack: 10_000,
            hacking: 1_000_000,
        });
        expect(run(placement, warden(), 'Lionheart', [hitter()]).corrosionOnHitter).toBe(0);
        expect(run(placement, warden(), 'none', [hitter()]).corrosionOnHitter).toBe(1);
    });

    it("Nayra's debuffs still land on a fully covered Stalwart, and he does not counter", () => {
        const nayra = hitter({
            slots: realKit('Nayra').slots.filter((s) => s.slot === 'active'),
        });
        const obs = run(placement, stalwart(), 'Lionheart', [nayra]);
        expect(obs.redirectRows).toBeGreaterThan(0);
        expect(obs.counters).toEqual([]);
        expect(obs.debuffsOnProtected).toEqual(
            expect.arrayContaining(['Defense Down II', 'Crit Rate Down III'])
        );
    });

    it('a counter fully redirected by Lionheart draws no counter back', () => {
        // Stalwart A hits Stalwart B; B counters A. With Lionheart beside A, A takes none of
        // that counter, so A does not counter back (R89 (ii) needs a counter that damages A).
        const stalwartA = (): BoardUnit => ({
            id: 'stalwart-a',
            kit: { slots: [...hitKit(100).slots, ...passives('Stalwart')] },
            position: 'M4',
            speed: 300,
            attack: 10_000,
        });
        const stalwartB = (): BoardUnit => ({ ...stalwart(), id: 'stalwart-b' });
        const counters = (withLionheart: boolean): string[] => {
            const a = stalwartA();
            const b = stalwartB();
            const allies = withLionheart ? [protectorUnit('Lionheart')] : [];
            const { input, id } = boardInput(placement, a, allies, [b], 1);
            const all = [a, ...allies, b];
            const nameOf = (actorId: string): string =>
                all.find((u) => id(u) === actorId)?.id ?? actorId;
            const bus = createEventBus();
            const seen: string[] = [];
            bus.on('attacked', (e) => {
                if (e.fromCounter) seen.push(`${nameOf(e.attackerId)}>${nameOf(e.targetId)}`);
            });
            runCombat({ ...input, bus });
            return seen;
        };
        expect(counters(false)).toEqual(['stalwart-b>stalwart-a', 'stalwart-a>stalwart-b']);
        expect(counters(true)).toEqual([]);
    });

    describe('Stasis', () => {
        /** Razi's charged Stasis (1 turn) with its damage stripped, as an active cast first in
         *  round 1 — a damage-free cast, so it neither breaks the Stasis nor spends Protection. */
        const stasisApplier = (): BoardUnit => ({
            id: 'applier',
            kit: {
                slots: [
                    {
                        slot: 'active',
                        abilities: realKit('Razi')
                            .slots.filter((s) => s.slot === 'charged')
                            .flatMap((s) => s.abilities)
                            .filter((a) => a.config.type !== 'damage'),
                    },
                ],
            },
            position: 'M3',
            speed: 400,
            hacking: 1_000_000,
        });
        /** Stalwart with a 1% active so his turn is observable. */
        const actingStalwart = (): BoardUnit => ({ ...stalwart(), kit: hitKit(1) });

        it('a fully redirected hit does not lower Stasis → Stalwart skips round 1', () => {
            const obs = run(placement, actingStalwart(), 'Lionheart', [stasisApplier(), hitter()]);
            expect(obs.redirectRows).toBeGreaterThan(0);
            expect(obs.protectedActed).toEqual([]);
        });

        it('control: an uncovered hit takes Stasis 1 → 0 → Stalwart acts in round 1', () => {
            const obs = run(placement, actingStalwart(), 'none', [stasisApplier(), hitter()]);
            expect(obs.protectedActed).toEqual([1]);
        });

        it('control: the applier alone leaves Stasis on → Stalwart skips round 1', () => {
            const obs = run(placement, actingStalwart(), 'none', [stasisApplier()]);
            expect(obs.protectedActed).toEqual([]);
        });

        it('partial redirect (Meatshield) → the kept share lowers Stasis → Stalwart acts', () => {
            const obs = run(placement, actingStalwart(), 'Meatshield', [stasisApplier(), hitter()]);
            expect(obs.splitHits).toBeGreaterThan(0);
            expect(obs.protectedActed).toEqual([1]);
        });
    });
});
