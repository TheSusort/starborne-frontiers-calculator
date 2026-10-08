/**
 * Owner ruling R137 (in game 2026-10-08): Nosorog's reflect IS direct damage to the attacker. It
 * behaves like a counter-attack, so the attacker's "when directly damaged" reactions answer it:
 * Warden inflicts Corrosion I and repairs, Isha repairs, and every counter answers it — Stalwart,
 * Centurion and Nyxen alike (R160). The Reflect GEAR SET's bounce is NOT direct damage, so nothing
 * answers it.
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
import type { StatusEngine } from '../statusEngine';
import { selfBuffStacksForOwner } from '../triggers';
import { exposedIncomingPct } from '../exposedStatus';
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
        expect(obs.counters).toEqual(['stalwart>nosorog']);
        expect(obs.reflectRows).toBe(1);
    });

    it('Centurion hits Nosorog → he retaliates against the reflect, and the chain stops (R160)', () => {
        const obs = run(placement, unit('centurion', hitterWith('Centurion')), nosorog(true));
        expect(obs.counters).toEqual(['centurion>nosorog']);
        expect(obs.reflectRows).toBe(1);
        const control = run(placement, unit('centurion', hitterWith('Centurion')), nosorog(false));
        expect(control.counters).toEqual([]);
    });

    it('Nyxen hits Nosorog shielded → the reflect strikes her shield and she counters (R160)', () => {
        // Her real active shields her (15% of max HP) before its added 100% hit lands on Nosorog.
        const kit: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ...realKit('Nyxen').slots.find((s) => s.slot === 'active')!.abilities,
                        ...hitKit(100).slots[0].abilities,
                    ],
                },
                ...passives('Nyxen'),
            ],
        };
        const obs = run(placement, unit('nyxen', kit), nosorog(true));
        expect(obs.counters).toEqual(['nyxen>nosorog']);
        expect(obs.reflectRows).toBe(1);
        const control = run(placement, unit('nyxen', kit), nosorog(false));
        expect(control.counters).toEqual([]);
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

/**
 * Owner ruling R162 (in game 2026-10-08): Nosorog's bounce is a direct hit in full — the
 * attacker's protector's Protection redirects it, it spends the attacker's Titanite Plating and
 * Exposed (and, per Exposed's own text, is amplified by it), and it uses Nosorog's shield
 * penetration. The Reflect gear set's bounce keeps none of that.
 */
describe.each(SIDES)('the bounce as a direct hit, reflector on the %s side', (placement) => {
    /** Runs `reflector` against `opponents`; opponents[0] is the ship that hits him. */
    const board = (reflector: BoardUnit, opponents: BoardUnit[], reflectorShieldPen = 0) => {
        const { input, id } = boardInput(placement, reflector, [], opponents, 1);
        if (reflectorShieldPen > 0) {
            if (placement === 'player') input.shieldPenetration = reflectorShieldPen;
            else
                input.enemyAttackers = input.enemyAttackers.map((e) =>
                    e.id === id(reflector)
                        ? { ...e, stats: { ...e.stats, shieldPenetration: reflectorShieldPen } }
                        : e
                );
        }
        return { input, id };
    };

    it("the hitter's Lionheart takes the bounce through Protection", () => {
        const redirectedOntoLionheart = (reflector: BoardUnit): number => {
            const hitter = unit('hitter', hitKit(100));
            const lionheart: BoardUnit = {
                id: 'lionheart',
                kit: { slots: [{ slot: 'active', abilities: [] }, ...passives('Lionheart')] },
                position: 'M2',
                speed: 2,
            };
            const { input, id } = board(reflector, [hitter, lionheart]);
            const bus = createEventBus();
            let rows = 0;
            bus.on('reactive-damage-performed', (e) => {
                if (e.sourceId === id(hitter) && e.targetId === id(lionheart)) rows++;
            });
            runCombat({ ...input, bus });
            return rows;
        };
        expect(redirectedOntoLionheart(nosorog(true))).toBeGreaterThan(0);
        expect(redirectedOntoLionheart(reflectSetWearer())).toBe(0);
    });

    it("the bounce spends one of Isha's Titanite Plating stacks", () => {
        const platingAfter = (reflector: BoardUnit): number => {
            const isha: BoardUnit = {
                ...unit('isha', realKit('Isha')),
                chargeCount: 4,
                startCharged: true,
            };
            const { input, id } = board(reflector, [isha]);
            let engine: StatusEngine | undefined;
            runCombat({ ...input, __testTapStatusEngine: (e) => (engine = e) });
            return selfBuffStacksForOwner(engine!, id(isha), 'Titanite Plating');
        };
        expect(platingAfter(nosorog(false))).toBe(3);
        expect(platingAfter(reflectSetWearer())).toBe(3);
        expect(platingAfter(nosorog(true))).toBe(2);
    });

    it('Exposed on the hitter doubles the bounce and is spent by it', () => {
        /** A bystander beside Nosorog that only puts `status` on the hitter, first. */
        const exposer = (status: string): BoardUnit => ({
            id: 'exposer',
            kit: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'expose',
                                type: 'debuff',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: {
                                    type: 'debuff',
                                    buffName: status,
                                    parsedEffects: {},
                                    stacks: 1,
                                    isStackable: false,
                                    duration: 5,
                                    application: 'apply',
                                },
                            },
                        ],
                    },
                ],
            },
            position: 'M2',
            speed: 400,
        });
        const measure = (reflector: BoardUnit, status: string) => {
            const hitter = unit('hitter', hitKit(100));
            const { input, id } = boardInput(placement, reflector, [exposer(status)], [hitter], 1);
            let engine: StatusEngine | undefined;
            // Read right after the hitter's attack resolves: Exposed is round-scoped, so an
            // end-of-fight read would see it gone either way.
            let exposedLeft = -1;
            const bus = createEventBus();
            bus.on('ability-performed', (e) => {
                if (e.actorId === id(hitter)) exposedLeft = exposedIncomingPct(engine!, id(hitter));
            });
            const { rounds } = runCombat({
                ...input,
                bus,
                __testTapStatusEngine: (e) => (engine = e),
            });
            return {
                reflected: rounds[0].perActorReflected?.[id(hitter)] ?? 0,
                exposedLeft,
            };
        };
        const control = measure(nosorog(true), 'Inert Mark');
        const exposed = measure(nosorog(true), 'Exposed');
        expect(control.reflected).toBeGreaterThan(0);
        expect(exposed.reflected).toBeCloseTo(control.reflected * 2, 6);
        expect(exposed.exposedLeft).toBe(0);
        // The gear set's bounce neither reads nor spends it.
        const gear = measure(reflectSetWearer(), 'Exposed');
        const gearControl = measure(reflectSetWearer(), 'Inert Mark');
        expect(gear.reflected).toBeCloseTo(gearControl.reflected, 6);
        expect(gear.exposedLeft).toBeGreaterThan(0);
    });

    it("the bounce uses Nosorog's shield penetration against a shielded hitter", () => {
        // Nyxen's real active shields her (15% of max HP) before its added hit lands on Nosorog.
        const nyxen = unit('nyxen', {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ...realKit('Nyxen').slots.find((s) => s.slot === 'active')!.abilities,
                        ...hitKit(100).slots[0].abilities,
                    ],
                },
            ],
        });
        const intake = (reflector: BoardUnit, pen: number) => {
            const { input, id } = board(reflector, [nyxen], pen);
            const { rounds } = runCombat(input);
            return rounds[0].perActorIncoming?.[id(nyxen)] ?? { incoming: 0, shieldAbsorbed: 0 };
        };
        const unpenetrated = intake(nosorog(true), 0);
        expect(unpenetrated.incoming).toBeGreaterThan(0);
        expect(unpenetrated.shieldAbsorbed).toBeCloseTo(unpenetrated.incoming, 6);
        const penetrated = intake(nosorog(true), 100);
        expect(penetrated.incoming).toBeGreaterThan(0);
        expect(penetrated.shieldAbsorbed).toBe(0);
        // The gear set's bounce ignores the wearer's penetration.
        const gear = intake(reflectSetWearer(), 100);
        expect(gear.shieldAbsorbed).toBeCloseTo(gear.incoming, 6);
    });

    it("a Leech-set Nosorog repairs 15% of the bounce it dealt (R165); the gear set's bounce does not leech", () => {
        /** The passive abilities two-piece `sets` build. */
        const gearPassives = (sets: string[]): ShipSkills['slots'][number]['abilities'] => {
            const slots = ['weapon', 'hull', 'generator', 'sensor'] as const;
            const pieces: GearPiece[] = sets.flatMap((set, s) =>
                [0, 1].map((i) => ({
                    id: `${set}-${i}`,
                    slot: slots[s * 2 + i],
                    level: 16,
                    stars: 6,
                    rarity: 'legendary',
                    mainStat: null,
                    subStats: [],
                    setBonus: set,
                }))
            );
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
            const built = buildShipAbilitiesWithEquipment(ship, (id) =>
                pieces.find((p) => p.id === id)
            );
            return built.slots.find((s) => s.slot === 'passive')?.abilities ?? [];
        };
        const leechRepair = (reflectPassives: ShipSkills['slots'], gearSets: string[]) => {
            const reflector: BoardUnit = {
                ...nosorog(false),
                kit: {
                    slots: [
                        { slot: 'active', abilities: [] },
                        ...reflectPassives,
                        { slot: 'passive', abilities: gearPassives(gearSets) },
                    ],
                },
            };
            const hitter = unit('hitter', hitKit(100));
            const { input, id } = boardInput(placement, reflector, [], [hitter], 1);
            const bus = createEventBus();
            let repaired = 0;
            bus.on('reactive-heal-performed', (e) => {
                if (e.casterId === id(reflector)) repaired += e.amount;
            });
            const { rounds } = runCombat({ ...input, bus });
            return { repaired, reflected: rounds[0].perActorReflected?.[id(hitter)] ?? 0 };
        };
        const leeching = leechRepair(passives('Nosorog'), ['LEECH']);
        expect(leeching.reflected).toBeGreaterThan(0);
        expect(leeching.repaired).toBeCloseTo(leeching.reflected * 0.15, 6);
        // Controls: no reflect → nothing dealt; the gear set's bounce is not direct → no leech.
        expect(leechRepair([], ['LEECH']).repaired).toBe(0);
        const gear = leechRepair([], ['LEECH', 'REFLECT']);
        expect(gear.reflected).toBeGreaterThan(0);
        expect(gear.repaired).toBe(0);
    });
});
