/**
 * What the combat log shows for hits that Protection splits, that a reflect bounces, and that a
 * ship turns into a damage-over-time effect (Voron):
 *  - a burst row shows what its holder kept, and its Protection shares nest under it;
 *  - a protector's share rows nest under the hit that was redirected, are labelled, and each carry
 *    the protector's own HP after that share;
 *  - an Echoing Burst row carries the holder's HP;
 *  - a hit fully converted into a DoT shows no damage number and no HP, whether it is a skill hit,
 *    a counter or a reflect.
 *
 * Asserted through `simulateBattle` on both sides, with `damageTaken` as the reference figure.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../../calculators/battleSimulator';
import { setupKeyedRng } from '../../../calculators/rateAccumulator';
import { flattenRound } from '../__testutils__/flattenCombatLog';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import type { CombatLogEntry } from '../types';
import type { Ship } from '../../../../types/ship';
import type { Position } from '../../../../types/encounters';

type Result = ReturnType<typeof simulateBattle>;
type Side = 'player' | 'enemy';
const SIDES: Side[] = ['player', 'enemy'];

beforeAll(() => {
    if (!csvAvailable()) throw new Error('docs/ship-skills.csv is required for the real kits');
});
beforeEach(() => setupKeyedRng(1));

const place = (
    ship: Ship,
    position: Position,
    speed: number,
    over: Partial<NonNullable<BattlePlacement['statOverrides']>> = {}
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 100_000,
        security: 0,
        defence: 0,
        hp: 10_000_000,
        speed,
        ...over,
    },
});

const plainShip = (name: string, text: string): Ship =>
    ({
        id: name,
        name,
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        affinity: 'antimatter',
        activeSkillText: text,
        chargeSkillCharge: 0,
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    }) as Partial<Ship> as Ship;

const real = (name: string): Ship => {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`${name} is missing from the reference data in this worktree`);
    return { ...ship, affinity: 'antimatter' };
};

const PROTECTION =
    'At the start of combat, this Unit gains 3 stacks of <unit-skill>Protection</unit-skill>.';
const POKE = 'This Unit deals <unit-damage>10% damage</unit-damage>.';

/** `subjects` fight on `side`, `others` on the other side. */
const fight = (side: Side, subjects: BattlePlacement[], others: BattlePlacement[]): Result =>
    simulateBattle({
        playerTeam: side === 'player' ? subjects : others,
        enemyTeam: side === 'player' ? others : subjects,
        rounds: 1,
    });

const idOf = (result: Result, name: string): string =>
    result.roster.find((r) => r.name === name)!.actorId;

const takenBy = (result: Result, id: string): number =>
    result.rounds[0].ships.find((s) => s.actorId === id)?.damageTaken ?? 0;

const rows = (result: Result): CombatLogEntry[] => flattenRound(result.combatLog[0]);

/** Everything the log says `victimId` took this round, summed over every row naming it. */
const loggedOn = (result: Result, victimId: string): number =>
    rows(result)
        .filter((e) => e.kind !== 'death')
        .flatMap((e) => e.targets.filter((t) => t.targetId === victimId))
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);

const sharesOf = (result: Result): CombatLogEntry[] =>
    rows(result).filter((e) => e.note === 'Protection');

describe.each(SIDES)(
    'a Bomb bursting on a Protection-covered ship, holder on the %s side',
    (side) => {
        const board = (withProtector: boolean): Result => {
            const bomber = place(
                plainShip(
                    'Bomber',
                    'This Unit inflicts <unit-skill>Bomb I</unit-skill> for 1 turn.'
                ),
                'M4',
                200
            );
            const holder = place(plainShip('Holder', POKE), 'M1', 50);
            const protector = place(plainShip('Protector', PROTECTION), 'T1', 40);
            return fight(
                side === 'player' ? 'enemy' : 'player',
                [bomber],
                withProtector ? [holder, protector] : [holder]
            );
        };

        it('the burst row and the log together never show more than the holder took', () => {
            const result = board(true);
            const holder = idOf(result, 'Holder');
            const burst = rows(result).find((e) => e.kind === 'bomb')!;

            expect(burst.targets[0].amount).toBeCloseTo(takenBy(result, holder), 6);
            expect(loggedOn(result, holder)).toBeCloseTo(takenBy(result, holder), 6);
        });

        it('with no protector the row is the whole burst', () => {
            const result = board(false);
            const burst = rows(result).find((e) => e.kind === 'bomb')!;

            expect(burst.targets[0].amount).toBeCloseTo(1000, 6);
        });
    }
);

describe.each(SIDES)('an Echoing Burst, holder on the %s side', (side) => {
    const board = (withProtector: boolean): Result => {
        const applier = place(
            plainShip(
                'Applier',
                'This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>Echoing Burst</unit-skill> for 1 turn.'
            ),
            'M4',
            200
        );
        const striker = place(
            plainShip('Striker', 'This Unit deals <unit-damage>300% damage</unit-damage>.'),
            'M3',
            150
        );
        const holder = place(plainShip('Holder', POKE), 'M1', 50, { hp: 100_000 });
        const protector = place(plainShip('Protector', PROTECTION), 'T1', 40);
        return fight(
            side === 'player' ? 'enemy' : 'player',
            [applier, striker],
            withProtector ? [holder, protector] : [holder]
        );
    };

    it("its row carries the holder's HP right after the burst", () => {
        const result = board(false);
        const burst = rows(result).find((e) => e.note === 'Echoing Burst detonated')!;

        // 100,000 less the 1,000 and 3,000 hits and the 3,000 burst.
        expect(burst.targets[0].amount).toBeCloseTo(3000, 6);
        expect(burst.targets[0].resultingHpPct).toBeCloseTo(93, 6);
    });

    it('under Protection the log never shows the holder more than it took', () => {
        const result = board(true);
        const holder = idOf(result, 'Holder');

        expect(loggedOn(result, holder)).toBeCloseTo(takenBy(result, holder), 6);
    });
});

describe.each(SIDES)('Protection share rows, protected ship on the %s side', (side) => {
    const board = (): Result => {
        const hitter = place(
            plainShip('Hitter', 'This Unit deals <unit-damage>1000% damage</unit-damage>.'),
            'M1',
            100
        );
        const ally = place(plainShip('Ally', POKE), 'M1', 50);
        const protector = place(plainShip('Protector', PROTECTION), 'T1', 40, { hp: 20_000 });
        return fight(side === 'player' ? 'enemy' : 'player', [hitter], [ally, protector]);
    };

    it("nest under the hit that was redirected, labelled, each with the protector's own HP", () => {
        const result = board();
        const hitter = idOf(result, 'Hitter');
        const turn = result.combatLog[0].turns.find((t) => t.actorId === hitter)!;
        const castRow = turn.entries.find((e) => e.kind === 'attack' && e.actorId === hitter)!;

        const shares = sharesOf(result);
        expect(shares).toHaveLength(3);
        // Every share is a reaction of the cast row, none is a top-level or foreign row.
        expect(castRow.reactions.filter((e) => e.note === 'Protection')).toHaveLength(3);
        // Three shares of 1,000 off a 20,000 HP protector.
        expect(shares.map((e) => e.targets[0].resultingHpPct)).toEqual([95, 90, 85]);
    });
});

describe.each(SIDES)(
    'shares of a counter-attack and a bounce, protected ship on the %s side',
    (side) => {
        it('every share row nests under an attack row, none stands alone in a turn', () => {
            const hitter = place(
                plainShip('Hitter', 'This Unit deals <unit-damage>1000% damage</unit-damage>.'),
                'M1',
                100
            );
            const protector = place(plainShip('Protector', PROTECTION), 'T1', 40);
            const result = fight(
                side,
                [hitter, protector],
                [place(real('Stalwart'), 'M1', 50), place(real('Nosorog'), 'T2', 60)]
            );
            const shares = sharesOf(result);
            const loose = result.combatLog[0].turns
                .flatMap((t) => t.entries)
                .concat(result.combatLog[0].startOfRound, result.combatLog[0].endOfRound)
                .filter((e) => e.note === 'Protection');

            expect(shares.length).toBeGreaterThan(0);
            expect(loose).toEqual([]);
            for (const parent of rows(result).filter((e) =>
                e.reactions.some((r) => r.note === 'Protection')
            )) {
                expect(parent.kind).toBe('attack');
            }
        });
    }
);

describe.each(SIDES)(
    'Nosorog bouncing onto an attacker covered by Protection, attacker on the %s side',
    (side) => {
        it('the log shows the attacker only what it took', () => {
            const hitter = place(
                plainShip('Hitter', 'This Unit deals <unit-damage>1000% damage</unit-damage>.'),
                'M1',
                100
            );
            const protector = place(plainShip('Protector', PROTECTION), 'T1', 40);
            const result = fight(side, [hitter, protector], [place(real('Nosorog'), 'M1', 50)]);
            const hitterId = idOf(result, 'Hitter');

            expect(loggedOn(result, hitterId)).toBeCloseTo(takenBy(result, hitterId), 6);
        });
    }
);

describe.each(SIDES)('a hit turned into a DoT by Voron, Voron on the %s side', (side) => {
    const voron = () => place(real('Voron'), 'M1', 50);
    const hitter = () =>
        place(
            plainShip('Hitter', 'This Unit deals <unit-damage>1000% damage</unit-damage>.'),
            'M1',
            100
        );

    const converted = (result: Result, actorName: string, victimId: string) =>
        rows(result)
            .filter((e) => e.kind === 'attack' && e.actorId === idOf(result, actorName))
            .flatMap((e) => e.targets.filter((t) => t.targetId === victimId));

    it('a skill hit shows no number and no HP, only that it was converted', () => {
        const result = fight(side, [voron()], [hitter()]);
        const voronId = idOf(result, 'Voron');
        const hits = converted(result, 'Hitter', voronId);

        expect(hits).toHaveLength(1);
        expect(hits[0].convertedToDot).toBe(true);
        expect(hits[0].amount).toBeUndefined();
        expect(hits[0].resultingHpPct).toBeUndefined();
    });

    it('a counter-attack that Voron converts shows no number', () => {
        const stalwart = place(real('Stalwart'), 'M1', 100);
        const result = fight(side, [voron()], [stalwart]);
        const voronId = idOf(result, 'Voron');
        const counters = converted(result, 'Stalwart', voronId);

        expect(counters.length).toBeGreaterThan(0);
        for (const t of counters) {
            expect(t.convertedToDot).toBe(true);
            expect(t.amount).toBeUndefined();
        }
    });

    it("Nosorog's reflect onto Voron shows no number", () => {
        const result = fight(side, [voron()], [place(real('Nosorog'), 'M1', 100)]);
        const voronId = idOf(result, 'Voron');
        const bounces = converted(result, 'Nosorog', voronId);

        expect(bounces.length).toBeGreaterThan(0);
        for (const t of bounces) {
            expect(t.convertedToDot).toBe(true);
            expect(t.amount).toBeUndefined();
        }
    });

    it('a hit on a ship that does not convert still shows its number', () => {
        const result = fight(side, [place(plainShip('Ally', POKE), 'M1', 50)], [hitter()]);
        const allyId = idOf(result, 'Ally');
        const hits = converted(result, 'Hitter', allyId);

        expect(hits[0].convertedToDot).toBeUndefined();
        expect(hits[0].amount).toBeCloseTo(10_000, 6);
    });
});

describe.each(SIDES)('a converted hit is no direct damage, Voron on the %s side', (side) => {
    const hitter = () =>
        place(
            plainShip('Hitter', 'This Unit deals <unit-damage>1000% damage</unit-damage>.'),
            'M1',
            100
        );
    /** Cultivator's "when an ally is directly damaged" repair, at refit 4. */
    const cultivator = () =>
        place({ ...real('Cultivator'), refits: [{}, {}, {}, {}] as Ship['refits'] }, 'T1', 40);
    /** Cultivator's repairs during the hitter's turn: its own cleanse repair comes on its own turn. */
    const repairsBy = (result: Result, name: string): CombatLogEntry[] => {
        const hitterTurn = result.combatLog[0].turns.find(
            (t) => t.actorId === idOf(result, 'Hitter')
        )!;
        const walk = (e: CombatLogEntry): CombatLogEntry[] => [e, ...e.reactions.flatMap(walk)];
        return hitterTurn.entries
            .flatMap(walk)
            .filter((e) => e.kind === 'heal' && e.actorId === idOf(result, name));
    };

    it("an ally's reaction to being directly damaged does not answer it", () => {
        const result = fight(side, [place(real('Voron'), 'M1', 50), cultivator()], [hitter()]);

        expect(repairsBy(result, 'Cultivator')).toHaveLength(0);
    });

    it('control: the same board with a ship that does not convert does draw the repair', () => {
        const result = fight(
            side,
            [place(plainShip('Ally', POKE), 'M1', 50), cultivator()],
            [hitter()]
        );

        expect(repairsBy(result, 'Cultivator').length).toBeGreaterThan(0);
    });
});
