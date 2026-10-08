/**
 * Owner ruling R137 (in game 2026-10-08): Nosorog's reflect IS direct damage to the attacker. It
 * behaves like a counter-attack, so the attacker's "when directly damaged" reactions answer it:
 * Warden inflicts Corrosion I and repairs, Isha repairs, Stalwart counters. The Reflect GEAR SET's
 * bounce is NOT direct damage, so nothing answers it.
 *
 * Chain rule (R92 + lineage): Stalwart hits Nosorog → Nosorog reflects → that bounce is the first
 * aimed hit on Stalwart in the chain, so he counters → his counter hits Nosorog, whose
 * primary-target allowance Stalwart's cast already spent, so Nosorog does not reflect again.
 *
 * Real parsed kits (refit 4); every board runs with the reflector on the player side and on the
 * enemy side.
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
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { getGearSet } from '../../../constants/gearSets';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(137));

const SIDES: Placement[] = ['player', 'enemy'];

const passives = (ship: string): ShipSkills['slots'] =>
    realKit(ship).slots.filter((s) => s.slot === 'passive');

/** A plain 100% hitter carrying `ship`'s real passives. */
const hitterWith = (ship: string): ShipSkills => ({
    slots: [...hitKit(100).slots, ...passives(ship)],
});

/** Nosorog that never casts: his real passives (the reflect) or none at all. */
const nosorog = (withReflect: boolean): BoardUnit => ({
    id: 'nosorog',
    kit: {
        slots: [{ slot: 'active', abilities: [] }, ...(withReflect ? passives('Nosorog') : [])],
    },
    position: 'M4',
    speed: 1,
    attack: 10_000,
});

/** A hull wearing the Reflect gear set and nothing else. */
const reflectSetWearer = (): BoardUnit => {
    const slots = ['weapon', 'hull', 'generator', 'sensor'] as const;
    const pieces: GearPiece[] = slots
        .slice(0, getGearSet('REFLECT')?.minPieces ?? 2)
        .map((slot, i) => ({
            id: `reflect-${i}`,
            slot,
            level: 16,
            stars: 6,
            rarity: 'legendary',
            mainStat: null,
            subStats: [],
            setBonus: 'REFLECT',
        }));
    const ship = {
        id: 'wearer-ship',
        name: 'Wearer',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'DEFENDER',
        baseStats: {},
        equipment: Object.fromEntries(pieces.map((p) => [p.slot, p.id])),
        implants: {},
        refits: [],
    } as unknown as Ship;
    const built = buildShipAbilitiesWithEquipment(ship, (id) => pieces.find((p) => p.id === id));
    const passive = built.slots.find((s) => s.slot === 'passive');
    if (!passive?.abilities.some((a) => a.config.type === 'damage-reflection'))
        throw new Error('Reflect set did not build a damage-reflection passive');
    return {
        id: 'nosorog',
        kit: { slots: [{ slot: 'active', abilities: [] }, passive] },
        position: 'M4',
        speed: 1,
        attack: 10_000,
    };
};

interface Observed {
    /** Reflected damage that reached the attacker (perActorReflected). */
    reflectedOntoAttacker: number;
    /** Reflect rows Nosorog emitted onto the attacker. */
    reflectRows: number;
    /** Counter-attacks, as `from>to`. */
    counters: string[];
    /** Corrosion stacks the attacker landed on Nosorog. */
    corrosionOnReflector: number;
    /** Self-repairs by the attacker. */
    attackerSelfRepairs: number;
    /** Shield the attacker granted itself without a cast (a damage-taken shield). */
    attackerUncastShield: number;
}

const run = (placement: Placement, attacker: BoardUnit, reflector: BoardUnit): Observed => {
    const { input, id } = boardInput(placement, reflector, [], [attacker], 1);
    const att = id(attacker);
    const ref = id(reflector);
    const nameOf = (actorId: string): string =>
        actorId === att ? attacker.id : actorId === ref ? reflector.id : actorId;
    const bus = createEventBus();
    const obs: Observed = {
        reflectedOntoAttacker: 0,
        reflectRows: 0,
        counters: [],
        corrosionOnReflector: 0,
        attackerSelfRepairs: 0,
        attackerUncastShield: 0,
    };
    bus.on('attacked', (e) => {
        if (e.fromCounter) obs.counters.push(`${nameOf(e.attackerId)}>${nameOf(e.targetId)}`);
    });
    bus.on('reactive-damage-performed', (e) => {
        if (e.sourceId === ref && e.targetId === att) obs.reflectRows++;
    });
    bus.on('dot-applied', (e) => {
        if (e.sourceId === att && e.targetId === ref && e.dotType === 'corrosion')
            obs.corrosionOnReflector += e.stacks;
    });
    bus.on('reactive-heal-performed', (e) => {
        if (e.casterId === att && e.perTarget.some((t) => t.targetId === att))
            obs.attackerSelfRepairs++;
    });
    bus.on('shield-applied', (e) => {
        if (e.granterId === att && e.uncast) obs.attackerUncastShield += e.amount;
    });
    const { rounds } = runCombat({ ...input, bus });
    obs.reflectedOntoAttacker = rounds.reduce(
        (sum, r) => sum + (r.perActorReflected?.[att] ?? 0),
        0
    );
    return obs;
};

const unit = (id: string, kit: ShipSkills, extra: Partial<BoardUnit> = {}): BoardUnit => ({
    id,
    kit,
    position: 'M4',
    speed: 300,
    attack: 10_000,
    hacking: 1_000_000,
    ...extra,
});

describe.each(SIDES)('Nosorog on the %s side', (placement) => {
    it('Warden hits Nosorog → the reflect wakes Warden: Corrosion I on Nosorog and a repair', () => {
        const obs = run(placement, unit('warden', hitterWith('Warden')), nosorog(true));
        expect(obs.reflectedOntoAttacker).toBeGreaterThan(0);
        expect(obs.corrosionOnReflector).toBe(1);
        expect(obs.attackerSelfRepairs).toBe(1);
    });

    it('control: Nosorog without his reflect → Warden takes no hit and does not react', () => {
        const obs = run(placement, unit('warden', hitterWith('Warden')), nosorog(false));
        expect(obs.reflectedOntoAttacker).toBe(0);
        expect(obs.corrosionOnReflector).toBe(0);
        expect(obs.attackerSelfRepairs).toBe(0);
    });

    it('the Reflect gear set bounces damage at Warden, but that is not direct damage', () => {
        const obs = run(placement, unit('warden', hitterWith('Warden')), reflectSetWearer());
        expect(obs.reflectedOntoAttacker).toBeGreaterThan(0);
        expect(obs.corrosionOnReflector).toBe(0);
        expect(obs.attackerSelfRepairs).toBe(0);
    });

    it('Isha hits Nosorog → she repairs once off the reflect', () => {
        const obs = run(placement, unit('isha', hitterWith('Isha')), nosorog(true));
        expect(obs.reflectedOntoAttacker).toBeGreaterThan(0);
        expect(obs.attackerSelfRepairs).toBe(1);
    });

    it('Stalwart hits Nosorog → one reflect, one counter, and the chain stops there', () => {
        const obs = run(placement, unit('stalwart', hitterWith('Stalwart')), nosorog(true));
        // The reflect lands like a counter, then Stalwart's counter answers it.
        expect(obs.counters).toEqual(['nosorog>stalwart', 'stalwart>nosorog']);
        expect(obs.reflectRows).toBe(1);
    });

    it("Nosorog's own reaction to the hit resolves before Stalwart's counter to the reflect (R39)", () => {
        // Nosorog also carries Warden's "when directly damaged" passive, so the cast hit wakes him
        // and the reflect wakes Stalwart: the second reaction answers a later event.
        const reflector: BoardUnit = {
            ...nosorog(true),
            kit: {
                slots: [
                    { slot: 'active', abilities: [] },
                    ...passives('Nosorog'),
                    ...passives('Warden'),
                ],
            },
            hacking: 1_000_000,
            speed: 1,
        };
        const stalwart = unit('stalwart', hitterWith('Stalwart'));
        const { input, id } = boardInput(placement, reflector, [], [stalwart], 1);
        const bus = createEventBus();
        const order: string[] = [];
        bus.on('dot-applied', (e) => {
            if (e.sourceId === id(reflector)) order.push('nosorog-corrosion');
        });
        bus.on('attacked', (e) => {
            if (e.fromCounter && e.attackerId === id(stalwart)) order.push('stalwart-counter');
        });
        runCombat({ ...input, bus });
        // The third entry is Nosorog's Warden passive answering Stalwart's counter in turn.
        expect(order).toEqual(['nosorog-corrosion', 'stalwart-counter', 'nosorog-corrosion']);
    });

    it('control: Stalwart against the Reflect gear set → the bounce draws no counter', () => {
        const obs = run(placement, unit('stalwart', hitterWith('Stalwart')), reflectSetWearer());
        expect(obs.reflectedOntoAttacker).toBeGreaterThan(0);
        expect(obs.counters).toEqual([]);
    });

    it('Malvex hits Nosorog → the reflect is a primary-target hit on Malvex, so he shields', () => {
        const malvex = unit('malvex', hitterWith('Malvex'));
        const obs = run(placement, malvex, nosorog(true));
        expect(obs.reflectedOntoAttacker).toBeGreaterThan(0);
        expect(obs.attackerUncastShield).toBeGreaterThan(0);
        const control = run(placement, malvex, nosorog(false));
        expect(control.attackerUncastShield).toBe(0);
    });
});
