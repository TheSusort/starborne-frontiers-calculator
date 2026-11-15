/**
 * Eelun Naphula's passive (#519). Owner rulings 2026-11-14:
 *   - "When an ally dies, … all allies add 1 charge to their Charged Skill": one charge per
 *     own-side death to every living ally, Eelun included ("an ally" includes self). Several
 *     deaths at once give one charge each (the text; the spec's open item notes a game run that
 *     showed fewer);
 *   - "At the start of each round, the Boss repairs 12% of its Max HP for each other living
 *     ally": 12% × the other living allies when the repair resolves, none with nobody left;
 *   - "At the end of each turn, the Boss gains Enrage Hacking III": +3 flat hacking per stack,
 *     stackable and unremovable, banked at the end of each of her own turns (extra actions
 *     included), so a stack never raises the cast that earned it.
 * Every board runs with Eelun on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent, type CombatEventBus } from '../events';
import type { CombatActor } from '../state';
import type { StatusEngine } from '../statusEngine';
import { liveDebuffLandingChance } from '../effectiveStats';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { bossShip } from '../../../constants/bountyBosses';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    FOCUS_ID,
    hitKit,
    NO_KIT,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { parsePattern, parseTarget } from '../../targetingParser';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(519));

const SIDES: Placement[] = ['player', 'enemy'];

const EELUN_HP = 1_000_000;

/** Eelun with her real kit. A high `chargeCount` keeps her on her active. */
const eelun = (extra: Partial<BoardUnit> = {}): BoardUnit => ({
    id: 'eelun',
    kit: buildShipAbilities(bossShip('eelun', 32)!),
    position: 'M4',
    speed: 300,
    hp: EELUN_HP,
    hacking: 1e6,
    chargeCount: 99,
    pattern: parsePattern('Pattern-All'),
    target: parseTarget('all'),
    ...extra,
});

/** An Eelun ally that dies to any hit. */
const frail = (id: string, position: BoardUnit['position']): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed: 1,
    hp: 1,
});

/** An Eelun ally that survives everything and can hold charges. */
const sturdy = (id: string, position: BoardUnit['position']): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed: 2,
    hp: 1e12,
    chargeCount: 99,
});

/** An opponent that strikes every one of Eelun's side before she acts. */
const sweeper = (attack = 1000): BoardUnit => ({
    id: 'sweeper',
    kit: hitKit(100),
    position: 'M1',
    speed: 500,
    attack,
    pattern: parsePattern('Pattern-All'),
    target: parseTarget('all'),
});

const victim = (): BoardUnit => ({
    id: 'victim',
    kit: NO_KIT,
    position: 'B3',
    speed: 2,
    hp: 1e12,
    security: 0,
});

const run = (
    placement: Placement,
    carrier: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[],
    rounds: number,
    tap?: (bus: CombatEventBus, actors: () => CombatActor[], engine: () => StatusEngine) => void
) => {
    const { input, id } = boardInput(placement, carrier, allies, opponents, rounds);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    let actors: CombatActor[] = [];
    let engine: StatusEngine | undefined;
    tap?.(
        bus,
        () => actors,
        () => engine!
    );
    for (const type of ['ship-destroyed', 'charge-changed', 'buff-applied', 'stats-snapshot'])
        bus.on(type as CombatEvent['type'], (e: CombatEvent) => events.push(e));
    runCombat({
        ...input,
        bus,
        __testTapActors: (a) => {
            actors = a;
        },
        __testTapStatusEngine: (s) => {
            engine = s;
        },
    });
    return { events, id };
};

/** Board ids before the run: the focus actor is Eelun on the player side and her first
 *  opponent on the enemy side (`boardInput`). */
const eelunIdOn = (placement: Placement) => (placement === 'player' ? FOCUS_ID : 'eelun');
const firstOpponentIdOn = (placement: Placement, unit: BoardUnit) =>
    placement === 'player' ? unit.id : FOCUS_ID;

type Ev<T extends CombatEvent['type']> = Extract<CombatEvent, { type: T }>;
const ofType = <T extends CombatEvent['type']>(events: CombatEvent[], type: T): Ev<T>[] =>
    events.filter((e): e is Ev<T> => e.type === type);

/** Charges each actor received from a charge grant (not from its own turns). */
const grantedCharges = (events: CombatEvent[], actorId: string) =>
    ofType(events, 'charge-changed')
        .filter((e) => e.actorId === actorId && e.reason === 'manip')
        .reduce((sum, e) => sum + (e.newCharge - e.oldCharge), 0);

describe.each(SIDES)('ally-death charges, Eelun on the %s side', (placement) => {
    it('an ally dying gives every living ally +1 charge, Eelun included', () => {
        const keeper = sturdy('keeper', 'T4');
        const carrier = eelun();
        const { events, id } = run(
            placement,
            carrier,
            [frail('add', 'M2'), keeper],
            [sweeper(), victim()],
            2
        );
        expect(ofType(events, 'ship-destroyed').map((e) => e.actorId)).toEqual(['add']);
        expect(grantedCharges(events, id(carrier))).toBe(1);
        expect(grantedCharges(events, keeper.id)).toBe(1);
    });

    it('three simultaneous deaths give +3', () => {
        const keeper = sturdy('keeper', 'T4');
        const carrier = eelun();
        const { events, id } = run(
            placement,
            carrier,
            [frail('add1', 'M2'), frail('add2', 'T2'), frail('add3', 'B2'), keeper],
            [sweeper(), victim()],
            1
        );
        expect(ofType(events, 'ship-destroyed')).toHaveLength(3);
        expect(grantedCharges(events, id(carrier))).toBe(3);
        expect(grantedCharges(events, keeper.id)).toBe(3);
    });

    it('validity: with no death nobody is granted a charge', () => {
        const keeper = sturdy('keeper', 'T4');
        const carrier = eelun();
        const { events, id } = run(placement, carrier, [keeper], [sweeper(), victim()], 2);
        expect(ofType(events, 'ship-destroyed')).toEqual([]);
        expect(grantedCharges(events, id(carrier))).toBe(0);
        expect(grantedCharges(events, keeper.id)).toBe(0);
    });
});

describe.each(SIDES)('round-start repair, Eelun on the %s side', (placement) => {
    /** HP Eelun regains at the start of round 2: read at the end of her round-1 turn and again at
     *  the start of the sweeper's round-2 turn (the first turn of round 2). Round 1's sweep took
     *  her to 10% HP first, so no repair is capped by her max HP. */
    const roundTwoRepair = (allies: BoardUnit[]): number => {
        const eelunId = eelunIdOn(placement);
        let before: number | undefined;
        let after: number | undefined;
        run(placement, eelun(), allies, [sweeper(0.9 * EELUN_HP), victim()], 2, (bus, actors) => {
            const hp = () => actors().find((a) => a.id === eelunId)!.currentHp;
            bus.on('turn-ended', (e: Ev<'turn-ended'>) => {
                if (e.round === 1 && e.actorId === eelunId) before = hp();
            });
            bus.on('turn-started', (e: Ev<'turn-started'>) => {
                if (e.round === 2 && after === undefined) after = hp();
            });
        });
        expect(before).toBeCloseTo(0.1 * EELUN_HP, 0);
        return after! - before!;
    };

    it.each([
        ['4 other living allies', 4, 0, 0.48],
        ['2 other living allies (2 more died in round 1)', 2, 2, 0.24],
        ['no other ally', 0, 0, 0],
    ])('with %s she repairs the matching share of her max HP', (_label, living, dying, share) => {
        const positions: BoardUnit['position'][] = ['T2', 'T3', 'B2', 'M2'];
        const allies = [
            ...positions.slice(0, living).map((p, i) => sturdy(`ally${i}`, p)),
            ...positions.slice(living, living + dying).map((p, i) => frail(`doomed${i}`, p)),
        ];
        expect(roundTwoRepair(allies)).toBeCloseTo(share * EELUN_HP, 0);
    });
});

describe.each(SIDES)('Enrage Hacking III, Eelun on the %s side', (placement) => {
    const BASE_HACKING = 500;

    /** Her landing chance, from the roll's own producer, against a target whose security equals
     *  her base hacking: each Enrage Hacking III stack she holds adds 0.03. */
    const chanceOverBase = (
        engine: StatusEngine,
        actors: CombatActor[],
        eelunId: string,
        victimId: string
    ): number => {
        const me = actors.find((a) => a.id === eelunId)!;
        const target = actors.find((a) => a.id === victimId)!;
        const wall = { ...target, stats: { ...target.stats, security: BASE_HACKING } };
        return Number(liveDebuffLandingChance(engine, new Map(), me, wall, 0).toFixed(6));
    };

    /** Her landing chance over base at the start of each of her turns, and her stack grants. */
    const perTurn = (carrier: BoardUnit, rounds: number) => {
        const v = victim();
        const eelunId = eelunIdOn(placement);
        const chances: number[] = [];
        const { events } = run(placement, carrier, [], [v], rounds, (bus, actors, engine) => {
            bus.on('turn-started', (e: Ev<'turn-started'>) => {
                if (e.actorId === eelunId)
                    chances.push(
                        chanceOverBase(engine(), actors(), eelunId, firstOpponentIdOn(placement, v))
                    );
            });
        });
        const grants = ofType(events, 'buff-applied').filter(
            (e) => e.actorId === eelunId && e.buffName === 'Enrage Hacking III'
        );
        return { chances, grants };
    };

    it('she gains a stack at the end of each turn: +3 hacking after one turn, +6 after two', () => {
        const { chances, grants } = perTurn(eelun({ hacking: BASE_HACKING }), 3);
        expect(chances).toEqual([0, 0.03, 0.06]);
        expect(grants).toHaveLength(3);
    });

    it("her first cast's Acidic Decay rolls with her pre-stack hacking", () => {
        const carrier = eelun({ hacking: BASE_HACKING });
        const v = victim();
        const eelunId = eelunIdOn(placement);
        const atLanding: number[] = [];
        run(placement, carrier, [], [v], 2, (bus, actors, engine) => {
            bus.on('dot-applied', (e: Ev<'dot-applied'>) => {
                if (e.sourceId === eelunId)
                    atLanding.push(
                        chanceOverBase(engine(), actors(), eelunId, firstOpponentIdOn(placement, v))
                    );
            });
        });
        expect(atLanding).toEqual([0, 0.03]);
    });

    it('an extra action is a turn too: two turns in one round bank two stacks', () => {
        const extraAction: Ability = {
            id: 'test-extra',
            type: 'extra-action',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'extra-action', oncePerRound: true, endOfRound: true },
        };
        const real = buildShipAbilities(bossShip('eelun', 32)!);
        const kit: ShipSkills = {
            ...real,
            slots: [
                { slot: 'active', abilities: [extraAction] },
                real.slots.find((s) => s.slot === 'passive')!,
            ],
        };
        const { chances, grants } = perTurn(eelun({ kit, hacking: BASE_HACKING }), 1);
        expect(chances).toEqual([0, 0.03]);
        expect(grants).toHaveLength(2);
    });
});

describe.each(SIDES)('reactive extra-action recipients, granter on the %s side', (placement) => {
    const reactiveGrant = (recipients?: 'self' | 'other-allies'): ShipSkills => ({
        slots: [
            {
                slot: 'passive',
                abilities: [
                    {
                        id: 'test-reactive-extra',
                        type: 'extra-action',
                        target: 'self',
                        trigger: 'on-ally-destroyed',
                        conditions: [],
                        config: {
                            type: 'extra-action',
                            oncePerRound: true,
                            endOfRound: true,
                            ...(recipients !== undefined ? { recipients } : {}),
                        },
                    },
                ],
            },
        ],
    });

    /** Turns each unit takes in round 1, while `add` dies to the sweeper's opening strike. */
    const round1Turns = (recipients?: 'self' | 'other-allies') => {
        const granter = eelun({ kit: reactiveGrant(recipients), chargeCount: 0 });
        const keeper = sturdy('keeper', 'T4');
        const turns: Record<string, number> = {};
        const { id } = run(
            placement,
            granter,
            [frail('add', 'M2'), keeper],
            [sweeper(), victim()],
            1,
            (bus) => {
                bus.on('turn-started', (e: Ev<'turn-started'>) => {
                    turns[e.actorId] = (turns[e.actorId] ?? 0) + 1;
                });
            }
        );
        return { granterTurns: turns[id(granter)], keeperTurns: turns[keeper.id] };
    };

    it("an 'other-allies' grant gives every other living ally the turn, not the granter", () => {
        expect(round1Turns('other-allies')).toEqual({ granterTurns: 1, keeperTurns: 2 });
    });

    it('validity: without recipients the granter takes the extra turn instead', () => {
        expect(round1Turns()).toEqual({ granterTurns: 2, keeperTurns: 1 });
    });
});
