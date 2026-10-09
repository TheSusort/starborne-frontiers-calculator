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
import { calculateDamageReduction } from '../../autogear/statResolution';

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

/** The passive slot the Reflect gear set builds (its damage-reflection ability). */
const reflectSetPassive = (): ShipSkills['slots'][number] => {
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
    return passive;
};

/** A hull wearing the Reflect gear set and nothing else. */
const reflectSetWearer = (): BoardUnit => ({
    id: 'nosorog',
    kit: { slots: [{ slot: 'active', abilities: [] }, reflectSetPassive()] },
    position: 'M4',
    speed: 1,
    attack: 10_000,
});

/** Nosorog with his real reflect passive AND the Reflect gear set. */
const nosorogWithReflectSet = (): BoardUnit => ({
    ...nosorog(true),
    kit: {
        slots: [{ slot: 'active', abilities: [] }, ...passives('Nosorog'), reflectSetPassive()],
    },
});

/** The passive abilities two-piece `sets` build. */
const gearSetPassives = (sets: string[]): ShipSkills['slots'][number]['abilities'] => {
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
    const built = buildShipAbilitiesWithEquipment(ship, (id) => pieces.find((p) => p.id === id));
    return built.slots.find((s) => s.slot === 'passive')?.abilities ?? [];
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
        const leechRepair = (reflectPassives: ShipSkills['slots'], gearSets: string[]) => {
            const reflector: BoardUnit = {
                ...nosorog(false),
                kit: {
                    slots: [
                        { slot: 'active', abilities: [] },
                        ...reflectPassives,
                        { slot: 'passive', abilities: gearSetPassives(gearSets) },
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

/** A bystander on the reflector's side that only puts `status` on the hitter, first. */
const statusPlanter = (status: string, parsedEffects: Record<string, number> = {}): BoardUnit => ({
    id: 'planter',
    kit: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'plant',
                        type: 'debuff',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'debuff',
                            buffName: status,
                            parsedEffects,
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

interface Bounce {
    /** Each bounce row the reflector emitted onto the hitter, in log order. */
    rows: number[];
    /** The hitter's round-1 reflected intake (perActorReflected). */
    reflected: number;
    /** The hitter's Exposed read right after its attack resolves. */
    exposedLeft: number;
    /** What the hitter's Lionheart took through Protection. */
    redirected: number;
    /** Counter-attacks, as `from>to`. */
    counters: string[];
    /** What the reflector repaired itself for. */
    repaired: number;
}

/**
 * One round: `hitter` (100% hit) strikes `reflector`; a planter on the reflector's side puts
 * `status` on the hitter first. `lionheart` adds the hitter's protector beside it.
 */
const bounceOf = (
    placement: Placement,
    reflector: BoardUnit,
    opts: {
        status?: string;
        parsedEffects?: Record<string, number>;
        hitter?: BoardUnit;
        lionheart?: boolean;
    } = {}
): Bounce => {
    const hitter = opts.hitter ?? unit('hitter', hitKit(100));
    const lionheart: BoardUnit = {
        id: 'lionheart',
        kit: { slots: [{ slot: 'active', abilities: [] }, ...passives('Lionheart')] },
        position: 'M2',
        speed: 2,
    };
    const { input, id } = boardInput(
        placement,
        reflector,
        [statusPlanter(opts.status ?? 'Inert Mark', opts.parsedEffects)],
        opts.lionheart ? [hitter, lionheart] : [hitter],
        1
    );
    const hit = id(hitter);
    const ref = id(reflector);
    const out: Bounce = {
        rows: [],
        reflected: 0,
        exposedLeft: -1,
        redirected: 0,
        counters: [],
        repaired: 0,
    };
    let engine: StatusEngine | undefined;
    const bus = createEventBus();
    bus.on('ability-performed', (e) => {
        if (e.actorId === hit) out.exposedLeft = exposedIncomingPct(engine!, hit);
    });
    bus.on('reactive-damage-performed', (e) => {
        if (e.sourceId === ref && e.targetId === hit) out.rows.push(e.amount);
        if (opts.lionheart && e.sourceId === hit && e.targetId === id(lionheart))
            out.redirected += e.amount;
    });
    bus.on('attacked', (e) => {
        if (e.fromCounter)
            out.counters.push(
                `${e.attackerId === hit ? 'hitter' : 'reflector'}>${e.targetId === ref ? 'reflector' : 'hitter'}`
            );
    });
    bus.on('reactive-heal-performed', (e) => {
        if (e.casterId === ref) out.repaired += e.amount;
    });
    const { rounds } = runCombat({ ...input, bus, __testTapStatusEngine: (e) => (engine = e) });
    out.reflected = rounds[0].perActorReflected?.[hit] ?? 0;
    return out;
};

/**
 * R137: Nosorog's bounce is direct damage and the Reflect gear set's is not, so a Nosorog wearing
 * the set reflects one hit as TWO bounces — his own share as a direct hit (Exposed, Protection,
 * leech, counters), then the set's share as a plain bounce.
 */
describe.each(SIDES)('Nosorog wearing the Reflect set, on the %s side', (placement) => {
    it('the two shares land as separate bounces; only his own share reads and spends Exposed', () => {
        const ship = bounceOf(placement, nosorog(true)).rows;
        const gear = bounceOf(placement, reflectSetWearer()).rows;
        expect(ship).toHaveLength(1);
        expect(gear).toHaveLength(1);
        const [S, G] = [ship[0], gear[0]];
        expect(S).toBeGreaterThan(0);
        expect(G).toBeGreaterThan(0);

        const plain = bounceOf(placement, nosorogWithReflectSet());
        expect(plain.rows).toHaveLength(2);
        expect(plain.rows[0]).toBeCloseTo(S, 6);
        expect(plain.rows[1]).toBeCloseTo(G, 6);

        const exposed = bounceOf(placement, nosorogWithReflectSet(), { status: 'Exposed' });
        expect(exposed.rows).toHaveLength(2);
        expect(exposed.rows[0]).toBeCloseTo(S * 2, 6);
        expect(exposed.rows[1]).toBeCloseTo(G, 6);
        expect(exposed.reflected).toBeCloseTo(S * 2 + G, 6);
        expect(exposed.exposedLeft).toBe(0);
    });

    it("the hitter's Lionheart takes only Nosorog's own share through Protection", () => {
        const shipOnly = bounceOf(placement, nosorog(true), { lionheart: true });
        expect(shipOnly.redirected).toBeGreaterThan(0);
        const both = bounceOf(placement, nosorogWithReflectSet(), { lionheart: true });
        expect(both.rows).toHaveLength(2);
        expect(both.rows[1]).toBeGreaterThan(0);
        expect(both.redirected).toBeCloseTo(shipOnly.redirected, 6);
    });

    it('a Leech-set Nosorog repairs 15% of his own share only (R165)', () => {
        const reflector: BoardUnit = {
            ...nosorog(false),
            kit: {
                slots: [
                    { slot: 'active', abilities: [] },
                    ...passives('Nosorog'),
                    { slot: 'passive', abilities: gearSetPassives(['LEECH', 'REFLECT']) },
                ],
            },
        };
        const obs = bounceOf(placement, reflector);
        expect(obs.rows).toHaveLength(2);
        expect(obs.rows[1]).toBeGreaterThan(0);
        expect(obs.repaired).toBeCloseTo(obs.rows[0] * 0.15, 6);
    });

    it('Stalwart counters his own share once and never the set share', () => {
        const obs = bounceOf(placement, nosorogWithReflectSet(), {
            hitter: unit('hitter', hitterWith('Stalwart')),
        });
        expect(obs.rows).toHaveLength(2);
        expect(obs.counters).toEqual(['hitter>reflector']);
    });
});

/** Warden (his real passives) whose cast first grants himself `buff`, then hits for 100%. */
const wardenSelfBuffed = (buff: string, parsedEffects: Record<string, number>): BoardUnit =>
    unit('warden', {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'self-buff',
                        type: 'buff',
                        target: 'self',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'buff',
                            buffName: buff,
                            parsedEffects,
                            stacks: 1,
                            isStackable: false,
                            duration: 5,
                        },
                    },
                    ...hitKit(100).slots[0].abilities,
                ],
            },
            ...passives('Warden'),
        ],
    });

/**
 * Owner ruling R176 (2026-10-09): Nosorog's bounce reads the attacker's buffs and debuffs the way a
 * counter-attack does — Inc. Damage Up/Down and Exposed share one incoming channel. The Reflect gear
 * set's bounce reads none of them.
 */
describe.each(SIDES)(
    "the bounce reads the hitter's incoming modifiers, reflector on the %s side",
    (placement) => {
        const warden = () => unit('warden', hitterWith('Warden'));

        it('Inc. Damage Up II on Warden makes the bounce 30% larger', () => {
            const control = bounceOf(placement, nosorog(true), { hitter: warden() });
            const up = bounceOf(placement, nosorog(true), {
                hitter: warden(),
                status: 'Inc. Damage Up II',
                parsedEffects: { incomingDamage: 30 },
            });
            expect(control.rows).toHaveLength(1);
            expect(control.rows[0]).toBeGreaterThan(0);
            expect(up.rows[0]).toBeCloseTo(control.rows[0] * 1.3, 6);
        });

        it('Inc. Damage Down II on Warden makes the bounce 30% smaller', () => {
            const control = bounceOf(placement, nosorog(true), {
                hitter: wardenSelfBuffed('Inert Buff', {}),
            });
            const down = bounceOf(placement, nosorog(true), {
                hitter: wardenSelfBuffed('Inc. Damage Down II', { incomingDamage: -30 }),
            });
            expect(control.rows).toHaveLength(1);
            expect(control.rows[0]).toBeGreaterThan(0);
            expect(down.rows[0]).toBeCloseTo(control.rows[0] * 0.7, 6);
        });

        it('Exposed and Inc. Damage Up II add in one channel; Exposed is applied once', () => {
            const control = bounceOf(placement, nosorog(true), { hitter: warden() });
            const both = bounceOf(placement, nosorog(true), {
                hitter: warden(),
                status: 'Exposed',
                parsedEffects: { incomingDamage: 30 },
            });
            expect(both.rows[0]).toBeCloseTo(control.rows[0] * 2.3, 6);
            expect(both.exposedLeft).toBe(0);
        });

        it('Defense Down II on an armoured Warden lowers his defence against the bounce', () => {
            const armoured = () => unit('warden', hitterWith('Warden'), { defence: 5_000 });
            const control = bounceOf(placement, nosorog(true), { hitter: armoured() });
            const shredded = bounceOf(placement, nosorog(true), {
                hitter: armoured(),
                status: 'Defense Down II',
                parsedEffects: { defense: -30 },
            });
            const factor = (defence: number) => 1 - calculateDamageReduction(defence) / 100;
            expect(control.rows[0]).toBeGreaterThan(0);
            expect(shredded.rows[0]).toBeCloseTo(
                (control.rows[0] * factor(3_500)) / factor(5_000),
                6
            );
        });

        it("the Reflect gear set's bounce ignores Inc. Damage Up II", () => {
            const control = bounceOf(placement, reflectSetWearer(), { hitter: warden() });
            const up = bounceOf(placement, reflectSetWearer(), {
                hitter: warden(),
                status: 'Inc. Damage Up II',
                parsedEffects: { incomingDamage: 30 },
            });
            expect(control.rows[0]).toBeGreaterThan(0);
            expect(up.rows[0]).toBeCloseTo(control.rows[0], 6);
        });
    }
);
