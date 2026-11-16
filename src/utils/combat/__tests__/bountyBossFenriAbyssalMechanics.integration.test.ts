/**
 * Abyssal Fenri Khaliriz's "50% less damage from damage over time effects and Bombs": the DoT
 * tick and a Bomb detonation are halved; an Echoing Burst is not (the clause names Bombs, not
 * detonations in general).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { bossShip } from '../../../constants/bountyBosses';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { boardInput, hitKit, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import type { Ability } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(519));

const SIDES: Placement[] = ['player', 'enemy'];

type Ev<T extends CombatEvent['type']> = Extract<CombatEvent, { type: T }>;

const runEvents = (input: Parameters<typeof runCombat>[0]): CombatEvent[] => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of ['bomb-detonated', 'accumulator-detonated', 'hp-snapshot'] as const) {
        bus.on(type, (e) => events.push(e));
    }
    runCombat({ ...input, bus });
    return events;
};

const ofType = <T extends CombatEvent['type']>(events: CombatEvent[], type: T): Ev<T>[] =>
    events.filter((e): e is Ev<T> => e.type === type);

/** A carrier holding Fenri's own incoming reductions, or none. */
const carrier = (reductions: boolean): BoardUnit => {
    const abilities = reductions
        ? buildShipAbilities(bossShip('fenri', 33)!)
              .slots.find((s) => s.slot === 'passive')!
              .abilities.filter((a) => a.config.type === 'incoming-reduction')
        : [];
    return {
        id: 'fenri',
        kit: {
            slots: [
                { slot: 'active', abilities: [] },
                { slot: 'passive', abilities },
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

const clause = (config: Ability['config'], id: string): Ability => ({
    id,
    type: config.type as Ability['type'],
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config,
});

describe('Abyssal Fenri incoming reductions', () => {
    it('parses a DoT entry and a bomb-only detonation entry', () => {
        const reductions = buildShipAbilities(bossShip('fenri', 33)!)
            .slots.find((s) => s.slot === 'passive')!
            .abilities.filter((a) => a.config.type === 'incoming-reduction')
            .map((a) => a.config);
        expect(reductions).toMatchObject([
            { scope: 'dot', pct: 50 },
            { scope: 'detonation', pct: 50, bombOnly: true },
        ]);
    });
});

describe.each(SIDES)('Abyssal Fenri reductions, carrier on the %s side', (placement) => {
    const lossOf = (reductions: boolean, opponent: BoardUnit, rounds: number) => {
        const c = carrier(reductions);
        const { input, id } = boardInput(placement, c, [], [opponent], rounds);
        const events = runEvents(input);
        const last = ofType(events, 'hp-snapshot')
            .filter((e) => e.actorId === id(c))
            .at(-1)!;
        return { lost: Math.round(last.maxHp - last.currentHp), events };
    };

    it('halves a Bomb burst', () => {
        const bomber = opponentWith([
            clause({ type: 'dot', dotType: 'bomb', tier: 100, stacks: 1, duration: 1 }, 'bomb'),
        ]);
        const none = lossOf(false, bomber, 1).lost;
        expect(none).toBeGreaterThan(0);
        expect(lossOf(true, bomber, 1).lost).toBe(none / 2);
    });

    it.each<[string, Ability['config']]>([
        ['a detonate-Bomb clause', { type: 'detonate-dot', dotType: 'bomb', powerPct: 100 }],
        ['a countdown cut to 0', { type: 'bomb-countdown-reduce', turns: 10 }],
    ])('halves a Bomb set off by %s', (_label, trigger) => {
        const bomber = opponentWith([
            ...hitKit(1).slots[0].abilities,
            clause(trigger, 'set-off'),
            clause({ type: 'dot', dotType: 'bomb', tier: 100, stacks: 1, duration: 9 }, 'bomb'),
        ]);
        const none = lossOf(false, bomber, 2);
        const burst = ofType(none.events, 'bomb-detonated').reduce((sum, e) => sum + e.damage, 0);
        expect(burst).toBeGreaterThan(0);
        expect(none.lost - lossOf(true, bomber, 2).lost).toBe(Math.round(burst) / 2);
    });

    it('halves a DoT tick', () => {
        const burner = opponentWith([
            clause({ type: 'dot', dotType: 'inferno', tier: 30, stacks: 1, duration: 3 }, 'burn'),
        ]);
        const none = lossOf(false, burner, 2).lost;
        expect(none).toBeGreaterThan(0);
        expect(lossOf(true, burner, 2).lost).toBe(none / 2);
    });

    it('does not reduce an Echoing Burst', () => {
        const burster = opponentWith([
            ...hitKit(100).slots[0].abilities,
            clause({ type: 'accumulate-detonate', turns: 2, pct: 100 }, 'echo'),
        ]);
        const none = lossOf(false, burster, 2);
        const reduced = lossOf(true, burster, 2);
        const burst = ofType(none.events, 'accumulator-detonated').reduce(
            (sum, e) => sum + e.damage,
            0
        );
        expect(burst).toBeGreaterThan(0);
        expect(reduced.lost).toBe(none.lost);
    });
});

describe.each(SIDES)('Abyssal Fenri Bomb splash, carrier on the %s side', (placement) => {
    /** HP the carrier (M1) lost to splash from its bombed neighbour at M2. */
    const splashLoss = (
        reductions: boolean,
        holderHp: number,
        opponents: BoardUnit[],
        rounds: number
    ) => {
        const c = carrier(reductions);
        const holder: BoardUnit = {
            id: 'holder',
            kit: { slots: [] },
            position: 'M2',
            speed: 1,
            hp: holderHp,
        };
        const { input, id } = boardInput(placement, c, [holder], opponents, rounds);
        const last = ofType(runEvents(input), 'hp-snapshot')
            .filter((e) => e.actorId === id(c))
            .at(-1)!;
        return Math.round(last.maxHp - last.currentHp);
    };

    it("halves a bombed ally's death splash", () => {
        const opponents = [
            {
                ...opponentWith([
                    clause(
                        { type: 'dot', dotType: 'bomb', tier: 100, stacks: 1, duration: 9 },
                        'bomb'
                    ),
                ]),
                id: 'bomber',
            },
            {
                ...opponentWith(hitKit(100).slots[0].abilities),
                id: 'killer',
                speed: 200,
                attack: 1e7,
            },
        ];
        const none = splashLoss(false, 100, opponents, 1);
        expect(none).toBeGreaterThan(0);
        expect(splashLoss(true, 100, opponents, 1)).toBe(none / 2);
    });

    it("halves Demolisher's splash copy of a Bomb burst", () => {
        const splashCopy: Ability = {
            id: 'demolisher-splash',
            type: 'damage',
            target: 'adjacent-enemies',
            trigger: 'on-bomb-detonated',
            conditions: [],
            config: { type: 'damage', multiplier: 100, noCrit: true, ignoresDefense: true },
        };
        const bomber = opponentWith([
            clause({ type: 'dot', dotType: 'bomb', tier: 100, stacks: 1, duration: 1 }, 'bomb'),
        ]);
        const demolisher: BoardUnit = {
            ...bomber,
            kit: { slots: [...bomber.kit.slots, { slot: 'passive', abilities: [splashCopy] }] },
        };
        const none = splashLoss(false, 1e9, [demolisher], 2);
        expect(none).toBeGreaterThan(0);
        expect(splashLoss(true, 1e9, [demolisher], 2)).toBe(none / 2);
    });
});
