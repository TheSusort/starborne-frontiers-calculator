/**
 * Abyssal Fenri Khaliriz's passive:
 *  - "When debuffed and having 6 or more debuffs, the Boss cleanses all but 5 debuffs."
 *  - "At the end of the round, the Boss inflicts Stasis for 1 turn on the enemy with the highest
 *    Defense."
 *
 * Every case runs with Fenri on the player side and on the enemy side.
 *
 * ASSUMPTIONS (owner has not ruled; each has its own named test so a ruling can flip it):
 *  - UNREMOVABLE-DEBUFFS-COUNT: White Phosphorus counts toward "6 or more" and survives the cleanse.
 *  - STASIS-MAY-PICK-STEALTH: the Stasis selector can choose a Stealthed ship.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { bossShip } from '../../../constants/bountyBosses';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { ownerDebuffNamesFor, actorDebuffCount } from '../triggers';
import type { StatusEngine } from '../statusEngine';
import type { CombatActor } from '../state';
import { boardInput, hitKit, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(33));

const SIDES: Placement[] = ['player', 'enemy'];

const fenriPassive = (): Ability[] =>
    buildShipAbilities(bossShip('fenri', 33)!).slots.find((s) => s.slot === 'passive')!.abilities;

const fenri = (over: Partial<BoardUnit> = {}): BoardUnit => ({
    id: 'fenri',
    kit: {
        slots: [
            { slot: 'active', abilities: [] },
            { slot: 'passive', abilities: fenriPassive() },
        ],
        controlImmune: true,
    },
    position: 'M4',
    speed: 130,
    hp: 1e9,
    hacking: 1e6,
    ...over,
});

const named = (buffName: string): Ability => ({
    id: `inflict-${buffName}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application: 'apply',
        duration: 9,
    },
});

const whitePhosphorus = (): Ability => ({
    id: 'inflict-wp',
    type: 'dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'dot',
        dotType: 'inferno',
        tier: 30,
        stacks: 1,
        duration: 9,
        family: 'White Phosphorus',
        unremovable: true,
    },
});

/** An opponent that lands one clause on Fenri each round, faster than Fenri so the landings come
 *  in the listed order (the first listed is the OLDEST debuff). */
const inflicters = (clauses: Ability[]): BoardUnit[] =>
    clauses.map((clause, n) => ({
        id: `inflicter-${n}`,
        kit: { slots: [{ slot: 'active', abilities: [clause] }] },
        position: (['M4', 'M3', 'M2', 'M1', 'T4', 'B4', 'T3', 'B3'] as Position[])[n],
        speed: 500 - n * 10,
        hacking: 1e6,
        hp: 1e9,
    }));

interface After {
    debuffNames: string[];
    count: number;
}

const heldAfterRound1 = (placement: Placement, clauses: Ability[]): After => {
    const f = fenri();
    const { input, id } = boardInput(placement, f, [], inflicters(clauses), 1);
    const bus = createEventBus();
    let engine: StatusEngine | undefined;
    let actor: CombatActor | undefined;
    const out: After = { debuffNames: [], count: 0 };
    runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
        __testTapActors: (all: CombatActor[]) => {
            actor = all.find((a) => a.id === id(f));
            bus.on('round-ended', () => {
                out.debuffNames = engine && actor ? ownerDebuffNamesFor(engine, actor.id) : [];
                out.count = engine && actor ? actorDebuffCount(engine, actor) : 0;
            });
        },
    });
    return out;
};

const probes = (n: number): Ability[] =>
    Array.from({ length: n }, (_, i) => named(`Probe ${String.fromCharCode(65 + i)}`));

describe.each(SIDES)('Fenri threshold cleanse, carrier on the %s side', (placement) => {
    it('holds five removable debuffs without cleansing', () => {
        const after = heldAfterRound1(placement, probes(5));
        expect(after.debuffNames.sort()).toEqual([
            'Probe A',
            'Probe B',
            'Probe C',
            'Probe D',
            'Probe E',
        ]);
    });

    it('cleanses back to five when the sixth lands, removing the newest', () => {
        const after = heldAfterRound1(placement, probes(6));
        expect(after.debuffNames.sort()).toEqual([
            'Probe A',
            'Probe B',
            'Probe C',
            'Probe D',
            'Probe E',
        ]);
    });

    // ASSUMPTION UNREMOVABLE-DEBUFFS-COUNT
    it('UNREMOVABLE-DEBUFFS-COUNT: with two unremovable and five removable landing in turn, the newest removable go until five are held', () => {
        const after = heldAfterRound1(placement, [
            whitePhosphorus(),
            ...probes(2),
            whitePhosphorus(),
            ...probes(5).slice(2),
        ]);
        // 2 WP + 5 named = 7 landed. The cleanse fires on the 6th and 7th landings, one newest
        // removable each (Probe D, then Probe E), so never more than six are held at once and
        // five remain.
        expect(after.count).toBe(5);
        expect(after.debuffNames.sort()).toEqual(['Probe A', 'Probe B', 'Probe C']);
    });
});

describe('Fenri threshold cleanse gate', () => {
    it('is a self-debuff count gate on the on-debuffed trigger, keeping five', () => {
        const cleanse = fenriPassive().find((a) => a.type === 'cleanse')!;
        expect(cleanse.trigger).toBe('on-debuffed');
        expect(cleanse.target).toBe('self');
        expect(cleanse.conditions).toMatchObject([
            { subject: 'self-debuff', countComparator: 'gte', countThreshold: 6 },
        ]);
        expect(cleanse.config).toMatchObject({ type: 'cleanse', keep: 5 });
    });
});

// ---------------------------------------------------------------------------------------------
// End-of-round Stasis on the highest-Defense enemy
// ---------------------------------------------------------------------------------------------

const target = (
    id: string,
    position: Position,
    defence: number,
    over: Partial<BoardUnit> = {}
): BoardUnit => ({
    id,
    kit: hitKit(1),
    position,
    speed: 100,
    defence,
    hp: 1e9,
    ...over,
});

interface Run {
    events: CombatEvent[];
    /** The unit names the carrier's Stasis landed on, in landing order. */
    stasised: string[];
    firedIn: (unit: BoardUnit, round: number) => boolean;
    carrierId: string;
}

function fenriWithHit(): ShipSkills {
    return {
        slots: [
            { slot: 'active', abilities: hitKit(1).slots[0].abilities },
            { slot: 'passive', abilities: fenriPassive() },
        ],
        controlImmune: true,
    };
}

const runStasis = (placement: Placement, opponents: BoardUnit[], rounds: number): Run => {
    const carrier = fenri({ kit: fenriWithHit(), attack: 1e6 });
    const { input, id } = boardInput(placement, carrier, [], opponents, rounds);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of ['debuff-applied', 'skill-fired'] as const)
        bus.on(type, (e) => events.push(e));
    runCombat({ ...input, bus });
    const nameOf = (actorId: string): string =>
        opponents.find((u) => id(u) === actorId)?.id ?? actorId;
    return {
        events,
        carrierId: id(carrier),
        stasised: events
            .filter(
                (e): e is Extract<CombatEvent, { type: 'debuff-applied' }> =>
                    e.type === 'debuff-applied' && e.buffName === 'Stasis'
            )
            .map((e) => nameOf(e.targetId)),
        firedIn: (unit, round) =>
            events.some(
                (e) => e.type === 'skill-fired' && e.actorId === id(unit) && e.round === round
            ),
    };
};

describe.each(SIDES)('Fenri end-of-round Stasis, carrier on the %s side', (placement) => {
    const trio = (defences: [number, number, number]): BoardUnit[] => [
        target('a', 'M4', defences[0]),
        target('b', 'M3', defences[1]),
        target('c', 'M2', defences[2]),
    ];

    it('lands on the highest-Defense enemy, and flipping the defences flips the target', () => {
        expect(runStasis(placement, trio([100, 900, 300]), 1).stasised).toEqual(['b']);
        expect(runStasis(placement, trio([100, 300, 900]), 1).stasised).toEqual(['c']);
    });

    it('lands at the end of the round, after every turn of that round', () => {
        const r = runStasis(placement, trio([100, 900, 300]), 1);
        const landing = r.events.findIndex(
            (e) => e.type === 'debuff-applied' && e.buffName === 'Stasis'
        );
        const lastTurn = r.events.reduce(
            (last, e, i) => (e.type === 'skill-fired' && e.round === 1 ? i : last),
            -1
        );
        expect(r.events.some((e) => e.type === 'skill-fired' && e.actorId === r.carrierId)).toBe(
            true
        );
        expect(landing).toBeGreaterThan(lastTurn);
    });

    it('uses live effective Defense, buffs included', () => {
        const buffed = target('b', 'M3', 800, {
            kit: {
                slots: [
                    { slot: 'active', abilities: hitKit(1).slots[0].abilities },
                    {
                        slot: 'passive',
                        abilities: [
                            {
                                id: 'defence-up',
                                type: 'buff',
                                target: 'self',
                                trigger: 'pre-combat',
                                conditions: [],
                                config: {
                                    type: 'buff',
                                    buffName: 'Defense Up III',
                                    duration: 9,
                                    stacks: 1,
                                    isStackable: false,
                                    parsedEffects: { defense: 50 },
                                },
                            },
                        ],
                    },
                ],
            },
        });
        expect(runStasis(placement, [target('a', 'M4', 1000), buffed], 1).stasised).toEqual(['b']);
    });

    it('breaks a Defense tie by board position', () => {
        // The lower `positionTurnRank` (M3 before M4) takes the tie.
        expect(runStasis(placement, trio([500, 500, 100]), 1).stasised).toEqual(['b']);
        const swapped = [target('a', 'M3', 500), target('b', 'M4', 500), target('c', 'M2', 100)];
        expect(runStasis(placement, swapped, 1).stasised).toEqual(['a']);
    });

    it('picks the next-highest when the highest-Defense enemy is dead', () => {
        // The front ship has 1 hp and dies to Fenri's hit before the round ends.
        const r = runStasis(
            placement,
            [target('a', 'M4', 900, { hp: 1 }), target('b', 'M3', 600), target('c', 'M2', 300)],
            1
        );
        expect(r.stasised).toEqual(['b']);
    });

    it('makes the Stasised ship skip its next turn only', () => {
        const units = trio([100, 900, 300]);
        const [a, b, c] = units;
        const r = runStasis(placement, units, 2);
        expect(r.firedIn(b, 1)).toBe(true);
        expect(r.firedIn(b, 2)).toBe(false);
        expect(r.firedIn(a, 2)).toBe(true);
        expect(r.firedIn(c, 2)).toBe(true);
    });

    it('does not land on a control-immune highest-Defense enemy', () => {
        const immune = target('a', 'M4', 900, { kit: { ...hitKit(1), controlImmune: true } });
        expect(runStasis(placement, [immune, target('b', 'M3', 100)], 1).stasised).toEqual([]);
    });

    // ASSUMPTION STASIS-MAY-PICK-STEALTH
    it('STASIS-MAY-PICK-STEALTH: a Stealthed highest-Defense ship is still chosen', () => {
        const stealthed = target('b', 'M3', 900, {
            kit: {
                slots: [
                    { slot: 'active', abilities: hitKit(1).slots[0].abilities },
                    {
                        slot: 'passive',
                        abilities: [
                            {
                                id: 'stealth',
                                type: 'buff',
                                target: 'self',
                                trigger: 'pre-combat',
                                conditions: [],
                                config: {
                                    type: 'buff',
                                    buffName: 'Stealth',
                                    duration: 10,
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
        expect(runStasis(placement, [target('a', 'M4', 100), stealthed], 1).stasised).toEqual([
            'b',
        ]);
    });
});

describe('Fenri Stasis clause shape', () => {
    it('targets the enemy with the highest Defense at the end of the round', () => {
        const stasis = fenriPassive().find(
            (a) =>
                a.type === 'debuff' && a.config.type === 'debuff' && a.config.buffName === 'Stasis'
        )!;
        expect(stasis.trigger).toBe('end-of-round');
        expect(stasis.target).toBe('enemy-highest-defense');
    });
});
