/**
 * Mamma Maglienza's and the Capo's engine mechanics (#519). Owner rulings 2026-11-11:
 *   - infinite hacking: every debuff Mamma casts lands, including on a ship with affinity
 *     advantage over her; Block Debuff and control immunity still stop it;
 *   - "Whenever any ship dies": any death on either side, any cause, never the owner's own;
 *   - "after attacking": once after each of the owner's own attack casts;
 *   - "50% less damage from DoTs and Detonations": Bomb and Echoing Burst detonations,
 *     detonate-DoT bursts (once per burst) and Bomb splash;
 *   - Arc-Retribution: Stasis on the killer of a direct-damage death only, rolled normally.
 * Every board runs with the carrier on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { bossShip, npcShip } from '../../../constants/bountyBosses';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    hitKit,
    NO_KIT,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(519));

const SIDES: Placement[] = ['player', 'enemy'];

const mammaKit = (): ShipSkills => buildShipAbilities(bossShip('maglienza', 32)!);
const capoKit = (): ShipSkills => {
    const capo = npcShip('capo', 124);
    if (!capo) throw new Error('Capo missing from the encounter data');
    return buildShipAbilities(capo);
};

type Ev<T extends CombatEvent['type']> = Extract<CombatEvent, { type: T }>;

/** Runs the board and returns every event, in order. */
const runEvents = (input: Parameters<typeof runCombat>[0]): CombatEvent[] => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const capture = (e: CombatEvent) => events.push(e);
    for (const type of [
        'debuff-applied',
        'debuff-resisted',
        'dot-applied',
        'purge-performed',
        'buff-applied',
        'ship-destroyed',
        'skill-fired',
        'attacked',
        'status-snapshot',
        'charge-changed',
        'hot-ticked',
        'bomb-detonated',
        'dot-detonated',
        'dot-ticked',
        'accumulator-detonated',
        'hp-snapshot',
    ] as const) {
        bus.on(type, capture);
    }
    runCombat({ ...input, bus });
    return events;
};

const ofType = <T extends CombatEvent['type']>(events: CombatEvent[], type: T): Ev<T>[] =>
    events.filter((e): e is Ev<T> => e.type === type);

const debuffProbe = (application: 'inflict' | 'apply'): Ability => ({
    id: `probe-${application}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Probe Mark',
        duration: 5,
        stacks: 1,
        isStackable: false,
        application,
        parsedEffects: {},
    },
});

const withFlag = (kit: ShipSkills, alwaysLands: boolean): ShipSkills => {
    const { alwaysLandsDebuffs: _drop, ...rest } = kit;
    return alwaysLands ? { ...rest, alwaysLandsDebuffs: true } : rest;
};

const probeKit = (application: 'inflict' | 'apply', alwaysLands: boolean): ShipSkills =>
    withFlag(
        {
            slots: [
                {
                    slot: 'active',
                    abilities: [...hitKit(10).slots[0].abilities, debuffProbe(application)],
                },
            ],
        },
        alwaysLands
    );

/** A slow victim that never acts before the caster: chemical (advantage over electric) and
 *  with security far above the caster's hacking. */
const advantagedVictim = (id = 'victim'): BoardUnit => ({
    id,
    kit: NO_KIT,
    position: 'M1',
    speed: 1,
    security: 10_000,
    affinity: 'chemical',
});

const dummyAt = (id: string, position: BoardUnit['position']): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed: 1,
});

const caster = (kit: ShipSkills, extra: Partial<BoardUnit> = {}): BoardUnit => ({
    id: 'mamma',
    kit,
    position: 'M1',
    speed: 300,
    attack: 1000,
    hacking: 0,
    affinity: 'electric',
    chargeCount: 2,
    ...extra,
});

// ---------------------------------------------------------------------------
// Infinite hacking
// ---------------------------------------------------------------------------

describe.each(SIDES)('infinite hacking, caster on the %s side', (placement) => {
    const round1 = (kit: ShipSkills, victim = advantagedVictim()) => {
        const c = caster(kit);
        const { input, id } = boardInput(placement, c, [], [victim], 1);
        const events = runEvents(input).filter((e) => 'round' in e && e.round === 1);
        return { events, casterId: id(c), victimId: id(victim) };
    };

    it("Mamma's real Inferno II lands on an advantaged, high-security victim", () => {
        const { events, casterId, victimId } = round1(mammaKit());
        const dots = ofType(events, 'dot-applied').filter(
            (e) => e.sourceId === casterId && e.targetId === victimId
        );
        expect(dots.map((d) => d.dotType)).toContain('inferno');
    });

    it('validity: without the flag the same Inferno is resisted', () => {
        const { events, casterId, victimId } = round1(withFlag(mammaKit(), false));
        const dots = ofType(events, 'dot-applied').filter(
            (e) => e.sourceId === casterId && e.targetId === victimId
        );
        expect(dots).toEqual([]);
    });

    it.each(['inflict', 'apply'] as const)(
        'an %s debuff lands on an advantaged, high-security victim',
        (application) => {
            const { events, victimId } = round1(probeKit(application, true));
            expect(
                ofType(events, 'debuff-applied').some(
                    (e) => e.targetId === victimId && e.buffName === 'Probe Mark'
                )
            ).toBe(true);
            expect(ofType(events, 'debuff-resisted')).toEqual([]);
        }
    );

    it.each(['inflict', 'apply'] as const)(
        'validity: without the flag the %s debuff is resisted',
        (application) => {
            const { events, victimId } = round1(probeKit(application, false));
            expect(
                ofType(events, 'debuff-resisted').some(
                    (e) => e.targetId === victimId && e.buffName === 'Probe Mark'
                )
            ).toBe(true);
        }
    );

    it('the charged purge strips an advantaged victim', () => {
        const purgeKit: ShipSkills = withFlag(
            {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ...hitKit(10).slots[0].abilities,
                            {
                                id: 'probe-purge',
                                type: 'purge',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'purge', count: 3 },
                            },
                        ],
                    },
                ],
            },
            true
        );
        const buffer: BoardUnit = {
            ...advantagedVictim(),
            speed: 500,
            kit: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'self-up',
                                type: 'buff',
                                target: 'self',
                                trigger: 'on-cast',
                                conditions: [],
                                config: {
                                    type: 'buff',
                                    buffName: 'Attack Up I',
                                    duration: 5,
                                    stacks: 1,
                                    isStackable: false,
                                    parsedEffects: {},
                                },
                            },
                        ],
                    },
                ],
            },
        };
        const purged = (kit: ShipSkills) => {
            const { events, victimId } = round1(kit, buffer);
            return ofType(events, 'purge-performed').filter(
                (e) => e.targetId === victimId && e.count > 0
            );
        };
        expect(purged(purgeKit).length).toBeGreaterThan(0);
        expect(purged(withFlag(purgeKit, false))).toEqual([]);
    });

    it('Block Debuff still stops her debuffs', () => {
        const blocker: BoardUnit = {
            ...advantagedVictim(),
            speed: 500,
            kit: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'self-block',
                                type: 'buff',
                                target: 'self',
                                trigger: 'on-cast',
                                conditions: [],
                                config: {
                                    type: 'buff',
                                    buffName: 'Block Debuff',
                                    duration: 5,
                                    stacks: 1,
                                    isStackable: false,
                                    parsedEffects: {},
                                },
                            },
                        ],
                    },
                ],
            },
        };
        const { events, victimId } = round1(probeKit('inflict', true), blocker);
        expect(
            ofType(events, 'debuff-applied').some(
                (e) => e.targetId === victimId && e.buffName === 'Probe Mark'
            )
        ).toBe(false);
    });

    it('control immunity still stops her control debuffs', () => {
        const stasisKit = withFlag(
            {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ...hitKit(10).slots[0].abilities,
                            {
                                ...debuffProbe('inflict'),
                                id: 'probe-stasis',
                                config: {
                                    ...(debuffProbe('inflict').config as Extract<
                                        Ability['config'],
                                        { type: 'debuff' }
                                    >),
                                    buffName: 'Stasis',
                                },
                            },
                        ],
                    },
                ],
            },
            true
        );
        const stasisLands = (victim: BoardUnit) => {
            const { events, victimId } = round1(stasisKit, victim);
            return ofType(events, 'debuff-applied').some(
                (e) => e.targetId === victimId && e.buffName === 'Stasis'
            );
        };
        expect(stasisLands(advantagedVictim())).toBe(true);
        expect(
            stasisLands({ ...advantagedVictim(), kit: { ...NO_KIT, controlImmune: true } })
        ).toBe(false);
    });
});

describe.each(SIDES)('infinite hacking on reactions, carrier on the %s side', (placement) => {
    /** Answers every hit with an `apply` debuff and a purge on the attacker. */
    const retaliationKit = (alwaysLands: boolean): ShipSkills =>
        withFlag(
            {
                slots: [
                    { slot: 'active', abilities: [] },
                    {
                        slot: 'passive',
                        abilities: [
                            { ...debuffProbe('apply'), trigger: 'on-attacked' },
                            {
                                id: 'probe-purge-back',
                                type: 'purge',
                                target: 'enemy',
                                trigger: 'on-attacked',
                                conditions: [],
                                config: { type: 'purge', count: 3 },
                            },
                        ],
                    },
                ],
            },
            alwaysLands
        );

    /** Chemical, high security, buffs itself and then hits the carrier. */
    const attacker = (): BoardUnit => ({
        id: 'hitter',
        position: 'M1',
        speed: 500,
        attack: 10,
        security: 10_000,
        affinity: 'chemical',
        kit: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ...hitKit(10).slots[0].abilities,
                        {
                            id: 'self-up',
                            type: 'buff',
                            target: 'self',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up I',
                                duration: 5,
                                stacks: 1,
                                isStackable: false,
                                parsedEffects: {},
                            },
                        },
                    ],
                },
            ],
        },
    });

    const run = (alwaysLands: boolean) => {
        const carrier: BoardUnit = {
            id: 'mamma',
            kit: retaliationKit(alwaysLands),
            position: 'M1',
            speed: 1,
            hacking: 0,
            affinity: 'electric',
        };
        const hitter = attacker();
        const { input, id } = boardInput(placement, carrier, [], [hitter], 1);
        const events = runEvents(input);
        return {
            marked: ofType(events, 'debuff-applied').some(
                (e) => e.targetId === id(hitter) && e.buffName === 'Probe Mark'
            ),
            purged: ofType(events, 'purge-performed').some(
                (e) => e.targetId === id(hitter) && e.count > 0
            ),
        };
    };

    it('a reactive apply debuff and purge reach an advantaged attacker', () => {
        expect(run(true)).toEqual({ marked: true, purged: true });
    });

    it('validity: without the flag both are stopped by the affinity matchup', () => {
        expect(run(false)).toEqual({ marked: false, purged: false });
    });

    it('the same holds for a carrier walked as a team ally', () => {
        if (placement === 'enemy') return; // an enemy ally runs the enemy-attacker path above
        const carrier: BoardUnit = {
            id: 'mamma',
            kit: retaliationKit(true),
            position: 'M1',
            speed: 1,
            hacking: 0,
            affinity: 'electric',
        };
        // Row-most: T and M hold one ship each, the tie goes to M (row-most ties go M → B → T).
        const hitter: BoardUnit = {
            ...attacker(),
            target: parseTarget('row-most'),
            pattern: parsePattern('Pattern-Row'),
        };
        const focus: BoardUnit = { ...dummyAt('focus', 'T1'), hp: 1e9 };
        const { input, id } = boardInput('player', focus, [carrier], [hitter], 1);
        const events = runEvents(input);
        expect(
            ofType(events, 'debuff-applied').some(
                (e) => e.sourceId === id(carrier) && e.targetId === id(hitter)
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// "Whenever any ship dies" and "after attacking"
// ---------------------------------------------------------------------------

const passiveOf = (kit: ShipSkills, buffName: string): Ability => {
    const found = kit.slots
        .find((s) => s.slot === 'passive')
        ?.abilities.find((a) => a.config.type === 'buff' && a.config.buffName === buffName);
    if (!found) throw new Error(`no ${buffName} passive`);
    return found;
};

/** A unit that carries only Mamma's two passive grants beside `active`. */
const passiveCarrierKit = (active: Ability[]): ShipSkills => {
    const mamma = mammaKit();
    return {
        slots: [
            { slot: 'active', abilities: active },
            {
                slot: 'passive',
                abilities: [
                    passiveOf(mamma, 'Repair Self Over Time I'),
                    passiveOf(mamma, 'Enrage Attack III'),
                ],
            },
        ],
    };
};

const grantsOf = (events: CombatEvent[], actorId: string, buffName: string) =>
    ofType(events, 'buff-applied').filter((e) => e.actorId === actorId && e.buffName === buffName);

const rowKiller = (id: string, position: BoardUnit['position']): BoardUnit => ({
    id,
    kit: hitKit(100),
    position,
    speed: 300,
    attack: 1_000_000,
    target: parseTarget('row-most'),
    pattern: parsePattern('Pattern-Row'),
});

const fodder = (id: string, position: BoardUnit['position']): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed: 2,
    hp: 100,
});

describe.each(SIDES)('whenever any ship dies, carrier on the %s side', (placement) => {
    const carrier = (): BoardUnit => ({
        id: 'mamma',
        kit: passiveCarrierKit([]),
        position: 'B1',
        speed: 1,
    });

    it('two enemies killed by one ally cast grant two Repair Self Over Time I copies', () => {
        const c = carrier();
        const opponents = [fodder('e1', 'M3'), fodder('e2', 'M4'), dummyAt('e3', 'T4')];
        const { input, id } = boardInput(placement, c, [rowKiller('killer', 'M1')], opponents, 1);
        const events = runEvents(input);
        const deaths = ofType(events, 'ship-destroyed').map((e) => e.actorId);
        expect(deaths.sort()).toEqual([id(opponents[0]), id(opponents[1])].sort());
        expect(grantsOf(events, id(c), 'Repair Self Over Time I')).toHaveLength(2);
    });

    it('the granted Repair Self Over Time I heals the carrier 10% of its max HP per live copy per tick', () => {
        const maxHp = 1_000_000;
        const c: BoardUnit = { ...carrier(), position: 'M2', hp: maxHp };
        // A weak enemy hitter keeps the carrier below max HP so no tick is lost to overheal.
        const chip: BoardUnit = { ...rowKiller('chip', 'T1'), attack: 300_000 };
        const opponents = [fodder('e1', 'M3'), fodder('e2', 'M4'), chip];
        const { input, id } = boardInput(placement, c, [rowKiller('killer', 'M1')], opponents, 3);
        const events = runEvents(input);
        const carrierId = id(c);
        expect(grantsOf(events, carrierId, 'Repair Self Over Time I')).toHaveLength(2);
        const ticks = ofType(events, 'hot-ticked').filter((e) => e.holderId === carrierId);
        expect(ticks.length).toBeGreaterThan(0);
        for (const t of ticks) {
            const copies = t.amount / (maxHp * 0.1);
            expect(copies).toBeCloseTo(Math.round(copies), 5);
            expect(copies).toBeGreaterThanOrEqual(1);
        }
    });

    it("an ally's death grants a copy too", () => {
        const c = carrier();
        const ally = fodder('ally', 'M2');
        const { input, id } = boardInput(
            placement,
            c,
            [ally, dummyAt('ally2', 'M3')],
            [rowKiller('killer', 'M1')],
            1
        );
        const events = runEvents(input);
        expect(ofType(events, 'ship-destroyed').map((e) => e.actorId)).toEqual([id(ally)]);
        expect(grantsOf(events, id(c), 'Repair Self Over Time I')).toHaveLength(1);
    });

    it('a DoT-tick death grants a copy', () => {
        const c = carrier();
        const burner: BoardUnit = {
            id: 'burner',
            kit: {
                slots: [
                    {
                        slot: 'active',
                        abilities: mammaKit()
                            .slots.find((s) => s.slot === 'active')!
                            .abilities.filter((a) => a.type === 'dot'),
                    },
                ],
            },
            position: 'M1',
            speed: 300,
            attack: 1_000_000,
            hacking: 10_000,
        };
        const victim = fodder('victim', 'M1');
        const { input, id } = boardInput(placement, c, [burner], [victim, dummyAt('e2', 'T4')], 2);
        const events = runEvents(input);
        const death = ofType(events, 'ship-destroyed').find((e) => e.actorId === id(victim));
        expect(death?.byDirectDamage).toBe(false);
        expect(grantsOf(events, id(c), 'Repair Self Over Time I')).toHaveLength(1);
    });

    it("the carrier's own death by a direct hit grants nothing", () => {
        // The killing hit's reaction chain is one a dead owner may still react to (R117), so
        // only the listener's own-death exclusion stops this grant. The grant here reaches every
        // ally, because a dead carrier's self-grant has no living recipient to observe it on.
        const toAllies: Ability = {
            ...passiveOf(mammaKit(), 'Repair Self Over Time I'),
            target: 'all-allies',
        };
        const c: BoardUnit = {
            id: 'mamma',
            kit: { slots: [{ slot: 'passive', abilities: [toAllies] }] },
            position: 'M2',
            speed: 1,
            hp: 100,
        };
        const ally = dummyAt('ally', 'T3');
        const { input, id } = boardInput(placement, c, [ally], [rowKiller('killer', 'M1')], 1);
        const events = runEvents(input);
        const deaths = ofType(events, 'ship-destroyed');
        expect(deaths.map((e) => e.actorId)).toEqual([id(c)]);
        expect(deaths[0].byDirectDamage).toBe(true);
        expect(grantsOf(events, id(ally), 'Repair Self Over Time I')).toEqual([]);
    });

    it('validity: the same all-allies grant reaches the ally when another ship dies', () => {
        const toAllies: Ability = {
            ...passiveOf(mammaKit(), 'Repair Self Over Time I'),
            target: 'all-allies',
        };
        const c: BoardUnit = {
            id: 'mamma',
            kit: { slots: [{ slot: 'passive', abilities: [toAllies] }] },
            position: 'B1',
            speed: 1,
        };
        const ally = dummyAt('ally', 'T3');
        const { input, id } = boardInput(
            placement,
            c,
            [ally, rowKiller('killer', 'M1')],
            [fodder('e1', 'M3'), dummyAt('e3', 'T4')],
            1
        );
        const events = runEvents(input);
        expect(grantsOf(events, id(ally), 'Repair Self Over Time I')).toHaveLength(1);
    });

    it('validity: no death, no grant', () => {
        const c = carrier();
        const { input, id } = boardInput(
            placement,
            c,
            [{ ...rowKiller('killer', 'M1'), attack: 1 }],
            [fodder('e1', 'M3'), dummyAt('e3', 'T4')],
            1
        );
        const events = runEvents(input);
        expect(ofType(events, 'ship-destroyed')).toEqual([]);
        expect(grantsOf(events, id(c), 'Repair Self Over Time I')).toEqual([]);
    });
});

describe.each(SIDES)('after attacking, carrier on the %s side', (placement) => {
    const victim = (): BoardUnit => ({ ...dummyAt('victim', 'M1'), hp: 1e12 });

    it('each attack cast banks one Enrage stack, read from the next cast on (+6% each)', () => {
        const c: BoardUnit = {
            id: 'mamma',
            kit: passiveCarrierKit(hitKit(100).slots[0].abilities),
            position: 'M1',
            speed: 300,
            attack: 10_000,
        };
        const v = victim();
        const { input, id } = boardInput(placement, c, [], [v], 4);
        const events = runEvents(input);
        const hits = ofType(events, 'attacked')
            .filter((e) => e.attackerId === id(c))
            .map((e) => Math.round(e.takenDamage ?? 0));
        expect(hits).toEqual([10_000, 10_600, 11_200, 11_800]);
        expect(grantsOf(events, id(c), 'Enrage Attack III')).toHaveLength(4);
    });

    it('a cast that deals no damage banks no stack', () => {
        const c: BoardUnit = {
            id: 'mamma',
            kit: passiveCarrierKit([debuffProbe('inflict')]),
            position: 'M1',
            speed: 300,
            attack: 10_000,
            hacking: 10_000,
        };
        const { input, id } = boardInput(placement, c, [], [victim()], 3);
        const events = runEvents(input);
        expect(ofType(events, 'skill-fired').filter((e) => e.actorId === id(c))).toHaveLength(3);
        expect(grantsOf(events, id(c), 'Enrage Attack III')).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// "Inferno II twice for 12 turns each": two independent Inferno II debuffs
// ---------------------------------------------------------------------------

describe.each(SIDES)('Inferno II twice, Mamma on the %s side', (placement) => {
    const cleanseOne: Ability = {
        id: 'cleanse-one',
        type: 'cleanse',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'cleanse', count: 1 },
    };

    /** Inferno damage the victim takes per round. Mamma (attack 10,000, faster) casts first each
     *  round; the victim ticks at its own turn, then casts. */
    const infernoTicks = (victimKit: ShipSkills, rounds: number) => {
        const mammaActive = mammaKit().slots.find((s) => s.slot === 'active')!;
        const c = caster({ slots: [mammaActive] }, { attack: 10_000, hacking: 10_000 });
        const victim: BoardUnit = { ...dummyAt('victim', 'M1'), kit: victimKit, hp: 1e12 };
        const { input, id } = boardInput(placement, c, [], [victim], rounds);
        const events = runEvents(input);
        const applied = ofType(events, 'dot-applied').filter(
            (e) => e.targetId === id(victim) && e.dotType === 'inferno'
        );
        const ticks = new Map<number, number>();
        for (const e of events) {
            if (e.type !== 'dot-ticked' || e.targetId !== id(victim) || e.dotType !== 'inferno')
                continue;
            ticks.set(e.round, (ticks.get(e.round) ?? 0) + Math.round(e.damage));
        }
        return { applied, ticks };
    };

    it('one cast lands two Inferno II debuffs, each ticking 30% of attack', () => {
        const { applied, ticks } = infernoTicks(NO_KIT, 1);
        expect(applied.map((e) => [e.tier, e.stacks])).toEqual([[30, 2]]);
        expect(ticks.get(1)).toBe(6000);
    });

    it('cleansing one debuff leaves the other ticking', () => {
        // Round 2 adds a second pair: 4 Infernos uncleansed, 3 after one cleanse.
        const kept = infernoTicks(NO_KIT, 2).ticks;
        const cleansed = infernoTicks(
            { slots: [{ slot: 'active', abilities: [cleanseOne] }] },
            2
        ).ticks;
        expect([kept.get(1), kept.get(2)]).toEqual([6000, 12_000]);
        expect([cleansed.get(1), cleansed.get(2)]).toEqual([6000, 9000]);
    });
});

// ---------------------------------------------------------------------------
// Capo: Arc-Retribution (Stasis on its killer) and the row charge removal
// ---------------------------------------------------------------------------

describe.each(SIDES)('Arc-Retribution, Capo on the %s side', (placement) => {
    const capo = (hacking: number): BoardUnit => ({
        id: 'capo',
        kit: capoKit(),
        position: 'M1',
        speed: 1,
        hp: 100,
        hacking,
        chargeCount: 2,
    });
    /** Survives everything and never acts, so nobody ever hits the killer. */
    const anchor = (): BoardUnit => ({ ...dummyAt('anchor', 'M2'), hp: 1e12 });

    /** The rounds in which `actorId` cast. */
    const castRounds = (events: CombatEvent[], actorId: string) =>
        ofType(events, 'skill-fired')
            .filter((e) => e.actorId === actorId)
            .map((e) => e.round);

    const directKill = (opts: { capoHacking: number; killerKit?: ShipSkills }) => {
        const c = capo(opts.capoHacking);
        const killer: BoardUnit = {
            ...rowKiller('killer', 'M1'),
            kit: opts.killerKit ?? hitKit(100),
            security: 0,
        };
        const { input, id } = boardInput(placement, c, [anchor()], [killer], 4);
        const events = runEvents(input);
        const death = ofType(events, 'ship-destroyed').find((e) => e.actorId === id(c));
        return { events, death, killerId: id(killer) };
    };

    it('a direct kill puts the killer in Stasis: it loses its next two turns', () => {
        const { events, death, killerId } = directKill({ capoHacking: 10_000 });
        expect(death).toMatchObject({ round: 1, killerId, byDirectDamage: true });
        expect(
            ofType(events, 'debuff-applied').some(
                (e) => e.targetId === killerId && e.buffName === 'Stasis'
            )
        ).toBe(true);
        expect(castRounds(events, killerId)).toEqual([1, 4]);
    });

    it('the Stasis is rolled: a high-security killer resists it and keeps acting', () => {
        const { events, killerId } = directKill({ capoHacking: 0 });
        expect(
            ofType(events, 'debuff-resisted').some(
                (e) => e.targetId === killerId && e.buffName === 'Stasis'
            )
        ).toBe(true);
        expect(castRounds(events, killerId)).toEqual([1, 2, 3, 4]);
    });

    it('a control-immune killer is never put in Stasis', () => {
        const { events, killerId } = directKill({
            capoHacking: 10_000,
            killerKit: { ...hitKit(100), controlImmune: true },
        });
        expect(castRounds(events, killerId)).toEqual([1, 2, 3, 4]);
    });

    it('a DoT-tick kill puts nobody in Stasis', () => {
        const c = capo(10_000);
        const burner: BoardUnit = {
            id: 'burner',
            kit: {
                slots: [
                    {
                        slot: 'active',
                        abilities: mammaKit()
                            .slots.find((s) => s.slot === 'active')!
                            .abilities.filter((a) => a.type === 'dot'),
                    },
                ],
            },
            position: 'M1',
            speed: 300,
            attack: 1_000_000,
            hacking: 10_000,
            target: parseTarget('row-most'),
            pattern: parsePattern('Pattern-Row'),
        };
        const { input, id } = boardInput(placement, c, [anchor()], [burner], 4);
        const events = runEvents(input);
        const death = ofType(events, 'ship-destroyed').find((e) => e.actorId === id(c));
        expect(death?.byDirectDamage).toBe(false);
        expect(ofType(events, 'debuff-applied').filter((e) => e.buffName === 'Stasis')).toEqual([]);
        expect(castRounds(events, id(burner))).toEqual([1, 2, 3, 4]);
    });

    it('a Bomb kill puts nobody in Stasis', () => {
        const c = capo(10_000);
        const bomber: BoardUnit = {
            id: 'bomber',
            kit: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'probe-bomb',
                                type: 'dot',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: {
                                    type: 'dot',
                                    dotType: 'bomb',
                                    tier: 100,
                                    stacks: 1,
                                    duration: 1,
                                },
                            },
                        ],
                    },
                ],
            },
            position: 'M1',
            speed: 300,
            attack: 1_000_000,
            hacking: 10_000,
            target: parseTarget('row-most'),
            pattern: parsePattern('Pattern-Row'),
        };
        const { input, id } = boardInput(placement, c, [anchor()], [bomber], 4);
        const events = runEvents(input);
        const death = ofType(events, 'ship-destroyed').find((e) => e.actorId === id(c));
        expect(death).toMatchObject({ byDetonation: true });
        expect(ofType(events, 'debuff-applied').filter((e) => e.buffName === 'Stasis')).toEqual([]);
    });
});

describe.each(SIDES)("the Capo's row hit removes charges, Capo on the %s side", (placement) => {
    it('every ship in the struck row loses 2 charges; a charge-loss-immune ship keeps its own', () => {
        const capo: BoardUnit = {
            id: 'capo',
            kit: capoKit(),
            position: 'M1',
            speed: 300,
            defence: 1,
            chargeCount: 2,
            target: parseTarget('row-least'),
            pattern: parsePattern('Pattern-Row'),
        };
        const charged = (
            id: string,
            position: BoardUnit['position'],
            immune = false
        ): BoardUnit => ({
            ...dummyAt(id, position),
            hp: 1e12,
            chargeCount: 4,
            startCharged: true,
            kit: {
                slots: [
                    { slot: 'active', abilities: [] },
                    { slot: 'charged', abilities: [] },
                ],
                ...(immune ? { chargeLossImmune: true } : {}),
            },
        });
        const row = [charged('v1', 'M1'), charged('v2', 'M2'), charged('v3', 'M3', true)];
        const { input, id } = boardInput(placement, capo, [], row, 1);
        const events = runEvents(input);
        const removed = ofType(events, 'charge-changed').filter(
            (e) => e.round === 1 && e.reason === 'manip' && e.newCharge < e.oldCharge
        );
        expect(removed.map((e) => [e.actorId, e.oldCharge, e.newCharge]).sort()).toEqual(
            [
                [id(row[0]), 4, 2],
                [id(row[1]), 4, 2],
            ].sort()
        );
        const struck = new Set(
            ofType(events, 'attacked')
                .filter((e) => e.attackerId === id(capo))
                .map((e) => e.targetId)
        );
        expect(struck).toEqual(new Set(row.map(id)));
    });
});

// ---------------------------------------------------------------------------
// "50% less damage from DoTs and Detonations"
// ---------------------------------------------------------------------------

type ReductionSet = 'none' | 'dot' | 'detonation' | 'both';
const REDUCTION_SETS: ReductionSet[] = ['none', 'dot', 'detonation', 'both'];

/** A unit carrying Mamma's own incoming reductions, narrowed to `set`. */
const reductionCarrier = (set: ReductionSet): BoardUnit => {
    const reductions = mammaKit()
        .slots.find((s) => s.slot === 'passive')!
        .abilities.filter(
            (a) =>
                a.config.type === 'incoming-reduction' && (set === 'both' || a.config.scope === set)
        );
    return {
        id: 'mamma',
        kit: {
            slots: [
                { slot: 'active', abilities: [] },
                { slot: 'passive', abilities: reductions },
            ],
        },
        position: 'M1',
        speed: 1,
        hp: 1e9,
    };
};

const opponentWith = (abilities: Ability[]): BoardUnit => ({
    id: 'opponent',
    kit: { slots: [{ slot: 'active', abilities }] },
    position: 'M1',
    speed: 300,
    attack: 10_000,
    hacking: 10_000,
});

const dotAbility = (config: Ability['config'], id: string): Ability => ({
    id,
    type: config.type as Ability['type'],
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config,
});

describe.each(SIDES)('detonation reduction, carrier on the %s side', (placement) => {
    /** HP the carrier lost over `rounds`, and the events. */
    const lossOf = (set: ReductionSet, opponent: BoardUnit, rounds: number) => {
        const c = reductionCarrier(set);
        const { input, id } = boardInput(placement, c, [], [opponent], rounds);
        const events = runEvents(input);
        const last = ofType(events, 'hp-snapshot')
            .filter((e) => e.actorId === id(c))
            .at(-1)!;
        return { lost: Math.round(last.maxHp - last.currentHp), events };
    };

    it('a Bomb burst: the detonation scope halves it, the DoT scope does not', () => {
        const bomber = opponentWith([
            dotAbility({ type: 'dot', dotType: 'bomb', tier: 100, stacks: 1, duration: 1 }, 'bomb'),
        ]);
        const lost = Object.fromEntries(
            REDUCTION_SETS.map((set) => [set, lossOf(set, bomber, 1).lost])
        );
        expect(lost.none).toBeGreaterThan(0);
        expect(lost).toEqual({
            none: lost.none,
            dot: lost.none,
            detonation: lost.none / 2,
            both: lost.none / 2,
        });
    });

    it.each<[string, Ability['config']]>([
        ['a detonate-Bomb clause', { type: 'detonate-dot', dotType: 'bomb', powerPct: 100 }],
        ['a countdown cut to 0', { type: 'bomb-countdown-reduce', turns: 10 }],
    ])('a Bomb set off by %s: halved by the detonation scope only', (_label, trigger) => {
        // Round 1 plants a long-fused Bomb; round 2's cast sets it off (the firing hit carries a
        // detonate clause). The plant is ordered after the trigger so a cast never sets off its own.
        const bomber = opponentWith([
            ...hitKit(1).slots[0].abilities,
            dotAbility(trigger, 'set-off'),
            dotAbility({ type: 'dot', dotType: 'bomb', tier: 100, stacks: 1, duration: 9 }, 'bomb'),
        ]);
        const run = (set: ReductionSet) => {
            const { lost, events } = lossOf(set, bomber, 2);
            const burst = ofType(events, 'bomb-detonated').reduce((sum, e) => sum + e.damage, 0);
            return { lost, burst: Math.round(burst) };
        };
        const none = run('none');
        expect(none.burst).toBeGreaterThan(0);
        expect(run('dot').lost).toBe(none.lost);
        const halved = run('detonation');
        expect(halved.burst).toBe(none.burst);
        expect(none.lost - halved.lost).toBe(none.burst / 2);
    });

    it('an Echoing Burst: the detonation scope halves the burst only', () => {
        const burster = opponentWith([
            ...hitKit(100).slots[0].abilities,
            dotAbility({ type: 'accumulate-detonate', turns: 2, pct: 100 }, 'echo'),
        ]);
        const run = (set: ReductionSet) => {
            const { lost, events } = lossOf(set, burster, 2);
            const burst = ofType(events, 'accumulator-detonated').reduce(
                (sum, e) => sum + e.damage,
                0
            );
            return { lost, burst: Math.round(burst) };
        };
        const none = run('none');
        const both = run('both');
        expect(none.burst).toBeGreaterThan(0);
        expect(both.burst).toBe(none.burst);
        expect(none.lost - both.lost).toBe(none.burst / 2);
        expect(run('dot').lost).toBe(none.lost);
    });

    it('a detonate-DoT burst is halved once, whichever scope the carrier holds', () => {
        // Round 1 inflicts Inferno; round 2 detonates it (the firing hit carries the detonation).
        const detonator = opponentWith([
            ...hitKit(1).slots[0].abilities,
            ...mammaKit()
                .slots.find((s) => s.slot === 'active')!
                .abilities.filter((a) => a.type === 'dot'),
            dotAbility({ type: 'detonate-dot', dotType: 'inferno', powerPct: 100 }, 'det'),
        ]);
        const burst = (set: ReductionSet) =>
            Math.round(
                ofType(lossOf(set, detonator, 2).events, 'dot-detonated').reduce(
                    (sum, e) => sum + e.damage,
                    0
                )
            );
        const none = burst('none');
        expect(none).toBeGreaterThan(0);
        expect({
            dot: burst('dot'),
            detonation: burst('detonation'),
            both: burst('both'),
        }).toEqual({ dot: none / 2, detonation: none / 2, both: none / 2 });
    });
});

describe.each(SIDES)('Bomb splash is detonation damage, carrier on the %s side', (placement) => {
    /** HP the carrier (M1) lost to splash from its bombed neighbour at M2. */
    const splashLoss = (
        set: ReductionSet,
        holderHp: number,
        opponents: BoardUnit[],
        rounds: number
    ) => {
        const c = reductionCarrier(set);
        const holder: BoardUnit = {
            id: 'holder',
            kit: NO_KIT,
            position: 'M2',
            speed: 1,
            hp: holderHp,
        };
        const { input, id } = boardInput(placement, c, [holder], opponents, rounds);
        const events = runEvents(input);
        const last = ofType(events, 'hp-snapshot')
            .filter((e) => e.actorId === id(c))
            .at(-1)!;
        return Math.round(last.maxHp - last.currentHp);
    };
    const longBomb = dotAbility(
        { type: 'dot', dotType: 'bomb', tier: 100, stacks: 1, duration: 9 },
        'bomb'
    );

    it("a bombed ally's death splash: halved by the detonation scope only", () => {
        // The bomber plants a long-fused Bomb on the holder; the killer then destroys it. One
        // round, so the killer never reaches the carrier.
        const opponents = [
            { ...opponentWith([longBomb]), id: 'bomber' },
            {
                ...opponentWith(hitKit(100).slots[0].abilities),
                id: 'killer',
                speed: 200,
                attack: 1e7,
            },
        ];
        const loss = (set: ReductionSet) => splashLoss(set, 100, opponents, 1);
        const none = loss('none');
        expect(none).toBeGreaterThan(0);
        expect({ dot: loss('dot'), detonation: loss('detonation'), both: loss('both') }).toEqual({
            dot: none,
            detonation: none / 2,
            both: none / 2,
        });
    });

    it("Demolisher's splash copy of a Bomb burst: halved by the detonation scope only", () => {
        const splashCopy: Ability = {
            id: 'demolisher-splash',
            type: 'damage',
            target: 'adjacent-enemies',
            trigger: 'on-bomb-detonated',
            conditions: [],
            config: { type: 'damage', multiplier: 100, noCrit: true, ignoresDefense: true },
        };
        // Plants a one-turn Bomb on the holder each round; its burst splashes onto the carrier.
        const bomber = opponentWith([
            dotAbility({ type: 'dot', dotType: 'bomb', tier: 100, stacks: 1, duration: 1 }, 'bomb'),
        ]);
        const demolisher: BoardUnit = {
            ...bomber,
            kit: { slots: [...bomber.kit.slots, { slot: 'passive', abilities: [splashCopy] }] },
        };
        const loss = (set: ReductionSet) => splashLoss(set, 1e9, [demolisher], 2);
        const none = loss('none');
        expect(none).toBeGreaterThan(0);
        expect({ dot: loss('dot'), detonation: loss('detonation'), both: loss('both') }).toEqual({
            dot: none,
            detonation: none / 2,
            both: none / 2,
        });
    });
});
