/**
 * Nuqtu's Core Charge I (R121, R136): one stack per skill action that grants at least one buff to
 * an enemy, however many buffs or recipients that action covers. A skill action is an active or
 * charged cast, one firing of a reaction, or one firing of a passive (a per-turn gain, a
 * start-of-combat grant, a buff its owner's cast sets off — R175).
 *
 * The stack is read through the real Nuqtu passive (buildTraceShip, refit 4) with a plain 100% hit
 * as his active. Every case runs with Nuqtu on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { selfBuffStacksForOwner } from '../triggers';
import type { StatusEngine } from '../statusEngine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ShipTypeName } from '../../../constants/shipTypes';
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

const PLACEMENTS: Placement[] = ['player', 'enemy'];
const CORE_CHARGE = 'Core Charge I';

/** The kit's slots minus the passive: a real active/charged with no per-turn grants riding along. */
const withoutPassive = (ship: string): ShipSkills => ({
    ...realKit(ship),
    slots: realKit(ship).slots.filter((s) => s.slot !== 'passive'),
});

const buffAbility = (
    id: string,
    over: Partial<Ability> & { buffName?: string; duration?: number }
): Ability => {
    const { buffName = 'Attack Up II', duration = 2, ...rest } = over;
    return {
        id,
        type: 'buff',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'buff',
            buffName,
            parsedEffects: {},
            stacks: 1,
            isStackable: false,
            duration,
        },
        ...rest,
    };
};

const nuqtuUnit = (): BoardUnit => {
    const kit = realKit('Nuqtu');
    return {
        id: 'nuqtu',
        kit: {
            ...kit,
            slots: [
                { slot: 'active', abilities: hitKit(100).slots[0].abilities },
                ...kit.slots.filter((s) => s.slot === 'passive'),
            ],
        },
        position: 'M4',
        speed: 1,
        attack: 1000,
        hp: 1e9,
    };
};

interface Gainer {
    id: string;
    kit: ShipSkills;
    position: BoardUnit['position'];
    speed?: number;
    attack?: number;
    chargeCount?: number;
    startCharged?: boolean;
}

const gainerUnit = (g: Gainer): BoardUnit => ({
    id: g.id,
    kit: g.kit,
    position: g.position,
    speed: g.speed ?? 300,
    attack: g.attack ?? 0,
    hp: 1e9,
    chargeCount: g.chargeCount,
    startCharged: g.startCharged,
});

interface Result {
    stacks: number;
    buffEvents: Extract<CombatEvent, { type: 'buff-applied' }>[];
}

/** Nuqtu faces `gainers`; reads his Core Charge stacks and every buff the gainers received.
 *  `nuqtuRole` is the role his attackers read when they strike him ("when damaging a debuffer"). */
const run = (
    placement: Placement,
    gainers: Gainer[],
    numRounds = 1,
    nuqtuRole?: ShipTypeName
): Result => {
    const nuqtu = nuqtuUnit();
    const { input, id } = boardInput(placement, nuqtu, [], gainers.map(gainerUnit), numRounds);
    if (nuqtuRole !== undefined) {
        if (placement === 'player') input.role = nuqtuRole;
        else input.enemyAttackers.find((a) => a.id === nuqtu.id)!.role = nuqtuRole;
    }
    const bus = createEventBus();
    const buffEvents: Result['buffEvents'] = [];
    bus.on('buff-applied', (e) => {
        if (e.actorId !== id(nuqtu)) buffEvents.push(e);
    });
    let engine: StatusEngine | undefined;
    runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    return { stacks: selfBuffStacksForOwner(engine!, id(nuqtu), CORE_CHARGE), buffEvents };
};

const plainHitter = (id: string, position: Gainer['position']): Gainer => ({
    id,
    kit: hitKit(100),
    position,
    attack: 1000,
});

describe.each(PLACEMENTS)('Nuqtu on the %s side: persistent stacking self-buffs on a cast', (p) => {
    it('CONTROL: an enemy that grants no buff gives no Core Charge', () => {
        expect(run(p, [plainHitter('g', 'M4')]).stacks).toBe(0);
    });

    it("Isha's charged (3 Titanite Plating) is announced as a buff and is one Core Charge", () => {
        // Isha's real active/charged with her passive stripped (her per-round override grant would
        // be a second source). Starts charged, so her first cast is the charged.
        const gainer: Gainer = {
            id: 'isha',
            kit: withoutPassive('Isha'),
            position: 'M4',
            chargeCount: 1,
            startCharged: true,
        };
        const { stacks, buffEvents } = run(p, [gainer]);
        expect(buffEvents.filter((e) => e.buffName === 'Titanite Plating')).toHaveLength(1);
        expect(stacks).toBe(1);
    });

    it('a cast gaining 1 Overload and 1 Blast is announced for each and is ONE Core Charge', () => {
        const kit: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        hitKit(100).slots[0].abilities[0],
                        buffAbility('gain-overload', { buffName: 'Overload', duration: undefined }),
                        buffAbility('gain-blast', { buffName: 'Blast', duration: undefined }),
                    ],
                },
            ],
        };
        const { stacks, buffEvents } = run(p, [{ id: 'g', kit, position: 'M4', attack: 1000 }]);
        expect(buffEvents.map((e) => e.buffName).sort()).toEqual(['Blast', 'Overload']);
        expect(stacks).toBe(1);
    });
});

describe.each(PLACEMENTS)('Nuqtu on the %s side: a passive gain every turn', (p) => {
    it('Ravager’s start-of-turn Overload is one Core Charge each turn', () => {
        const kit: ShipSkills = {
            slots: [
                { slot: 'active', abilities: hitKit(100).slots[0].abilities },
                ...realKit('Ravager').slots.filter((s) => s.slot === 'passive'),
            ],
        };
        const { stacks, buffEvents } = run(p, [{ id: 'rav', kit, position: 'M4' }], 3);
        expect(buffEvents.filter((e) => e.buffName === 'Overload')).toHaveLength(3);
        expect(stacks).toBe(3);
    });

    it('a buffing cast and the passive gain on the same turn are TWO actions', () => {
        const kit: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        hitKit(100).slots[0].abilities[0],
                        buffAbility('cast-buff', { buffName: 'Attack Up II' }),
                    ],
                },
                ...realKit('Ravager').slots.filter((s) => s.slot === 'passive'),
            ],
        };
        const { stacks } = run(p, [{ id: 'rav', kit, position: 'M4', attack: 1000 }], 2);
        expect(stacks).toBe(4);
    });

    it('Lev’s per-turn Blast is one Core Charge each turn', () => {
        const kit: ShipSkills = {
            slots: [
                { slot: 'active', abilities: hitKit(100).slots[0].abilities },
                ...realKit('Lev').slots.filter((s) => s.slot === 'passive'),
            ],
        };
        const { stacks, buffEvents } = run(p, [{ id: 'lev', kit, position: 'M4' }], 3);
        expect(buffEvents.filter((e) => e.buffName === 'Blast')).toHaveLength(3);
        expect(stacks).toBe(3);
    });
});

describe.each(PLACEMENTS)('Nuqtu on the %s side: one reaction firing', (p) => {
    /** "When attacked, grants Attack Up II and Defense Up II to all allies". */
    const reactor = (): Gainer => ({
        id: 'reactor',
        position: 'M4',
        kit: {
            slots: [
                { slot: 'active', abilities: [] },
                {
                    slot: 'passive',
                    abilities: [
                        buffAbility('react-atk', {
                            target: 'all-allies',
                            trigger: 'on-attacked',
                            buffName: 'Attack Up II',
                        }),
                        buffAbility('react-def', {
                            target: 'all-allies',
                            trigger: 'on-attacked',
                            buffName: 'Defense Up II',
                        }),
                    ],
                },
            ],
        },
    });
    const idle = (id: string, position: Gainer['position']): Gainer => ({
        id,
        position,
        kit: { slots: [{ slot: 'active', abilities: [] }] },
        speed: 5,
    });

    it('a reaction clause buffing three ships with two buffs is ONE Core Charge', () => {
        const { stacks, buffEvents } = run(p, [reactor(), idle('b', 'M3'), idle('c', 'M2')]);
        // Non-vacuity: the reaction really did hand out buffs to several ships.
        expect(new Set(buffEvents.map((e) => e.actorId)).size).toBeGreaterThanOrEqual(3);
        // Two buffs to three ships from one clause answering one hit.
        expect(stacks).toBe(1);
    });

    it('the same reaction firing in two rounds is one Core Charge per round', () => {
        const { stacks } = run(p, [reactor(), idle('b', 'M3'), idle('c', 'M2')], 2);
        expect(stacks).toBe(2);
    });
});

describe.each(PLACEMENTS)('Nuqtu on the %s side: a start-of-combat passive grant', (p) => {
    it('one passive granting three allies a buff at combat start is ONE Core Charge', () => {
        const seeder: Gainer = {
            id: 'seeder',
            position: 'M4',
            kit: {
                slots: [
                    { slot: 'active', abilities: [] },
                    {
                        slot: 'passive',
                        abilities: [
                            buffAbility('seed', {
                                target: 'all-allies',
                                buffName: 'Attack Up II',
                                duration: 3,
                            }),
                        ],
                    },
                ],
            },
        };
        const idle = (id: string, position: Gainer['position']): Gainer => ({
            id,
            position,
            kit: { slots: [{ slot: 'active', abilities: [] }] },
            speed: 5,
        });
        const { stacks, buffEvents } = run(p, [seeder, idle('b', 'M3'), idle('c', 'M2')]);
        expect(new Set(buffEvents.map((e) => e.actorId)).size).toBe(3);
        expect(stacks).toBe(1);
    });
});

// R159: a stackable buff at its stack cap is not granted again, so it is no gain.
describe.each(PLACEMENTS)('Nuqtu on the %s side: a gain at the stack cap', (p) => {
    /** Ravager's real passive with Overload capped at 2 stacks. */
    const cappedRavager = (): ShipSkills => ({
        slots: [
            { slot: 'active', abilities: hitKit(100).slots[0].abilities },
            ...realKit('Ravager')
                .slots.filter((s) => s.slot === 'passive')
                .map((slot) => ({
                    ...slot,
                    abilities: slot.abilities.map((a) =>
                        a.config.type === 'buff' && a.config.buffName === 'Overload'
                            ? { ...a, config: { ...a.config, maxStacks: 2 } }
                            : a
                    ),
                })),
        ],
    });

    it('below the cap each Overload gain is a Core Charge; at the cap none is', () => {
        const { stacks, buffEvents } = run(
            p,
            [{ id: 'rav', kit: cappedRavager(), position: 'M4' }],
            5
        );
        expect(buffEvents.filter((e) => e.buffName === 'Overload')).toHaveLength(2);
        expect(stacks).toBe(2);
    });

    it('a reactive grant at its cap is no gain either', () => {
        const reactor: Gainer = {
            id: 'reactor',
            position: 'M4',
            kit: {
                slots: [
                    { slot: 'active', abilities: [] },
                    {
                        slot: 'passive',
                        abilities: [
                            {
                                ...buffAbility('react-stack', {
                                    trigger: 'on-attacked',
                                    buffName: 'Fortify',
                                }),
                                config: {
                                    type: 'buff',
                                    buffName: 'Fortify',
                                    parsedEffects: {},
                                    stacks: 1,
                                    isStackable: true,
                                    maxStacks: 2,
                                    duration: 'recurring',
                                },
                            },
                        ],
                    },
                ],
            },
        };
        const { stacks } = run(p, [reactor], 4);
        expect(stacks).toBe(2);
    });
});

// R175: a passive that grants a buff when its owner's cast damages an enemy is its own activation,
// apart from the cast. Rys (refit 4): the charged gains Hacking Up III; the passive gains XAOC
// Swiftness II when damaging a debuffer or supporter. Anjian (refit 4): the passive gains Stealth
// and Tianchen Precision II on the same gate — one firing, two buffs.
describe.each(PLACEMENTS)('Nuqtu on the %s side: a passive buff riding a cast (R175)', (p) => {
    /** Rys's real kit; `charged` starts her charged, otherwise her charged slot is stripped so
     *  every cast is the buffless active. */
    const rys = (charged: boolean): Gainer => ({
        id: 'rys',
        kit: charged
            ? realKit('Rys')
            : {
                  ...realKit('Rys'),
                  slots: realKit('Rys').slots.filter((s) => s.slot !== 'charged'),
              },
        position: 'M4',
        attack: 1000,
        chargeCount: charged ? 1 : 0,
        startCharged: charged,
    });
    const gainedNames = (r: Result) => r.buffEvents.map((e) => e.buffName).sort();

    it("Rys's charged buff and her passive buff in one attack are TWO Core Charges", () => {
        const r = run(p, [rys(true)], 1, 'DEBUFFER');
        expect(gainedNames(r)).toEqual(['Hacking Up III', 'XAOC Swiftness II']);
        expect(r.stacks).toBe(2);
    });

    it('CONTROL: against a defender her passive stays silent and the charged is ONE', () => {
        const r = run(p, [rys(true)], 1, 'DEFENDER');
        expect(gainedNames(r)).toEqual(['Hacking Up III']);
        expect(r.stacks).toBe(1);
    });

    it("Rys's buffless active with her passive buff is ONE Core Charge per turn", () => {
        const r = run(p, [rys(false)], 2, 'DEBUFFER');
        expect(gainedNames(r)).toEqual(['XAOC Swiftness II', 'XAOC Swiftness II']);
        expect(r.stacks).toBe(2);
    });

    it("Anjian's passive granting two buffs in one firing is ONE Core Charge", () => {
        const anjian: Gainer = {
            id: 'anjian',
            kit: realKit('Anjian'),
            position: 'M4',
            attack: 1000,
        };
        const r = run(p, [anjian], 1, 'DEBUFFER');
        expect(gainedNames(r)).toEqual(['Stealth', 'Tianchao Precision II']);
        expect(r.stacks).toBe(1);
    });
});
