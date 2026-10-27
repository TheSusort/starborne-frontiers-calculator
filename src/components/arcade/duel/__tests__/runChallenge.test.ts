import { describe, it, expect, beforeAll, vi } from 'vitest';
import { runChallenge, runRace } from '../runChallenge';
import {
    cumulativeSide,
    endRace,
    hpLeftSide,
    isRace,
    raceOutcome,
    skippedChallenge,
    type RaceKind,
    type RaceSide,
} from '../challengeResult';
import { challengeSeed } from '../../../../utils/arcade/rng';
import { CHALLENGE_ROUNDS, duelOutcome } from '../runDuel';
import type { RowPicks } from '../pickOpponents';
import type { Ship } from '../../../../types/ship';
import type { BattleResult } from '../../../../utils/calculators/battleSimulator';
import type { CombatStatsDeps } from '../../../../utils/ship/combatStats';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';

const deps: CombatStatsDeps = {
    getGearPiece: () => undefined,
    getEngineeringStatsForShipType: () => undefined,
};

const side = (total: number): RaceSide => ({ byRound: [total], total });

const ended = (total: number, endRound?: number): RaceSide => ({
    byRound: [total],
    total,
    ...(endRound !== undefined ? { endRound } : {}),
});

describe('raceOutcome', () => {
    it('the higher figure wins', () => {
        expect(raceOutcome('dps', side(500), side(400))).toBe('win');
        expect(raceOutcome('dps', side(400), side(500))).toBe('lose');
    });

    it('equal figures with nothing to break the tie are a draw', () => {
        for (const kind of ['dps', 'heal', 'tank'] as const) {
            expect(raceOutcome(kind, side(250), side(250))).toBe('draw');
            expect(raceOutcome(kind, side(0), side(0))).toBe('draw');
        }
    });

    it('a ship that scores 0 loses to one that scores anything', () => {
        expect(raceOutcome('heal', side(0), side(1))).toBe('lose');
        expect(raceOutcome('heal', side(1), side(0))).toBe('win');
    });

    it('dps: on equal damage the earlier kill wins, and any kill beats none', () => {
        expect(raceOutcome('dps', ended(900, 2), ended(900, 3))).toBe('win');
        expect(raceOutcome('dps', ended(900, 4), ended(900, 3))).toBe('lose');
        expect(raceOutcome('dps', ended(900, 4), ended(900))).toBe('win');
        expect(raceOutcome('dps', ended(900, 3), ended(900, 3))).toBe('draw');
    });

    it('tank and heal: on equal figures the later destruction wins, and surviving beats both', () => {
        for (const kind of ['tank', 'heal'] as const) {
            expect(raceOutcome(kind, ended(0, 4), ended(0, 2))).toBe('win');
            expect(raceOutcome(kind, ended(0, 2), ended(0, 4))).toBe('lose');
            expect(raceOutcome(kind, ended(0), ended(0, 5))).toBe('win');
            expect(raceOutcome(kind, ended(0, 3), ended(0, 3))).toBe('draw');
        }
    });
});

describe('endRace', () => {
    it('when both ships are done, the race stops at the later of the two rounds', () => {
        const [a, b] = endRace(
            'dps',
            { byRound: [100, 300], total: 300, endRound: 2 },
            { byRound: [50, 150, 250], total: 250, endRound: 3 },
            CHALLENGE_ROUNDS
        );
        expect(a).toEqual({ byRound: [100, 300, 300], total: 300, endRound: 2 });
        expect(b).toEqual({ byRound: [50, 150, 250], total: 250, endRound: 3 });
    });

    it('a tank race ends at the first destruction, scored on HP left then', () => {
        const [a, b] = endRace(
            'tank',
            { byRound: [60, 0, 0, 0, 0], total: 0, endRound: 2 },
            { byRound: [80, 40, 0, 0, 0], total: 0, endRound: 3 },
            CHALLENGE_ROUNDS
        );
        expect(a).toEqual({ byRound: [60, 0], total: 0, endRound: 2 });
        expect(b).toEqual({ byRound: [80, 40], total: 40, endRound: 3 });
        expect(raceOutcome('tank', a, b)).toBe('lose');
    });

    it('a tank race where only one ship falls ends there and the survivor wins', () => {
        const [a, b] = endRace(
            'tank',
            { byRound: [90, 70, 50, 30, 10], total: 10 },
            { byRound: [60, 20, 0, 0, 0], total: 0, endRound: 3 },
            CHALLENGE_ROUNDS
        );
        expect(a.byRound).toEqual([90, 70, 50]);
        expect(a.total).toBe(50);
        expect(b.byRound).toEqual([60, 20, 0]);
        expect(raceOutcome('tank', a, b)).toBe('win');
    });

    it('a tank race where both ships fall in the same round is a draw', () => {
        const [a, b] = endRace(
            'tank',
            { byRound: [60, 0, 0, 0, 0], total: 0, endRound: 2 },
            { byRound: [30, 0, 0, 0, 0], total: 0, endRound: 2 },
            CHALLENGE_ROUNDS
        );
        expect(raceOutcome('tank', a, b)).toBe('draw');
    });

    it('a tank race where no ship falls runs the full race', () => {
        const [a] = endRace(
            'tank',
            { byRound: [90, 80, 70, 60, 50], total: 50 },
            { byRound: [95, 85, 75, 65, 55], total: 55 },
            CHALLENGE_ROUNDS
        );
        expect(a.byRound).toHaveLength(CHALLENGE_ROUNDS);
        expect(a.total).toBe(50);
    });

    it('when only one ship is done, both run the full race', () => {
        const [a, b] = endRace(
            'dps',
            { byRound: [100, 300], total: 300, endRound: 2 },
            { byRound: [50, 100, 150, 200, 250], total: 250 },
            CHALLENGE_ROUNDS
        );
        expect(a.byRound).toEqual([100, 300, 300, 300, 300]);
        expect(b.byRound).toEqual([50, 100, 150, 200, 250]);
        expect(a.byRound).toHaveLength(CHALLENGE_ROUNDS);
    });

    it('when neither ship is done, both run the full race', () => {
        const [a, b] = endRace(
            'heal',
            { byRound: [1, 2, 3, 4, 5], total: 5 },
            { byRound: [2, 4, 6, 8, 10], total: 10 },
            CHALLENGE_ROUNDS
        );
        expect(a.byRound).toHaveLength(CHALLENGE_ROUNDS);
        expect(b.byRound).toHaveLength(CHALLENGE_ROUNDS);
    });
});

/** A survivability run's rounds, each read at the round's top. */
const survivability = (hpAtTop: number[], destroyedRound?: number) => ({
    rounds: hpAtTop.map((hpPct, i) => ({
        round: i + 1,
        incomingDamage: 0,
        incomingDamageRaw: 0,
        shieldAbsorbed: 0,
        barrierAbsorbed: 0,
        convertedToShield: 0,
        hpPct,
        shieldPool: 0,
    })),
    destroyedRound,
});

describe('race figures', () => {
    it('damage and healing add up round by round; the total is the calculator total', () => {
        expect(cumulativeSide([100, 0, 250, 50, 0], 400)).toEqual({
            byRound: [100, 100, 350, 400, 400],
            total: 400,
        });
        expect(cumulativeSide([0, 0, 0, 0, 0], 0).byRound).toEqual([0, 0, 0, 0, 0]);
    });

    it('HP left after round r is the reading entering round r + 1', () => {
        const side = hpLeftSide(survivability([100, 90, 80, 70, 60, 50]), 5);
        expect(side).toEqual({ byRound: [90, 80, 70, 60, 50], total: 50 });
    });

    it('a ship destroyed inside the race has 0 HP left from that round on', () => {
        const side = hpLeftSide(survivability([100, 60, 20, 0, 0, 0], 3), 5);
        expect(side).toEqual({ byRound: [60, 20, 0, 0, 0], total: 0, endRound: 3 });
    });

    it('a ship destroyed only in the extra round survived the race', () => {
        const side = hpLeftSide(survivability([100, 80, 60, 40, 20, 5], 6), 5);
        expect(side).toEqual({ byRound: [80, 60, 40, 20, 5], total: 5 });
    });
});

/** Hand-built fight result: the last round's ships only, with an empty combat log. */
const fight = (
    winner: 'player' | 'enemy',
    player: [number, boolean][],
    enemy: [number, boolean][]
): BattleResult =>
    ({
        outcome: { winner, lastRound: CHALLENGE_ROUNDS },
        roster: [],
        combatLog: [],
        rounds: [
            {
                round: CHALLENGE_ROUNDS,
                ships: [
                    ...player.map(([hpPct, alive], i) => ({
                        actorId: `p${i}`,
                        side: 'player',
                        hpPct,
                        alive,
                    })),
                    ...enemy.map(([hpPct, alive], i) => ({
                        actorId: `e${i}`,
                        side: 'enemy',
                        hpPct,
                        alive,
                    })),
                ],
            },
        ],
    }) as unknown as BattleResult;

describe('team outcome', () => {
    it('at the cap, the side with more summed HP% wins', () => {
        const won = fight(
            'enemy',
            [
                [10, true],
                [0, false],
                [80, true],
            ],
            [
                [40, true],
                [40, true],
                [0, false],
            ]
        );
        expect(duelOutcome(won).outcome).toBe('win');
        const lost = fight(
            'enemy',
            [
                [70, true],
                [0, false],
                [0, false],
            ],
            [
                [30, true],
                [30, true],
                [30, true],
            ]
        );
        expect(duelOutcome(lost).outcome).toBe('lose');
    });

    it('at the cap, equal summed HP% is a draw', () => {
        const tie = fight(
            'enemy',
            [
                [50, true],
                [50, true],
                [0, false],
            ],
            [
                [100, true],
                [0, false],
                [0, false],
            ]
        );
        expect(duelOutcome(tie).outcome).toBe('draw');
    });

    it('a wiped side loses whatever the summed HP%', () => {
        const wiped = fight(
            'enemy',
            [
                [0, false],
                [0, false],
                [0, false],
            ],
            [[1, true]]
        );
        expect(duelOutcome(wiped).outcome).toBe('lose');
    });

    it('both teams wiped in the same round is a draw, whoever the simulator names', () => {
        const dead: [number, boolean][] = [
            [0, false],
            [0, false],
            [0, false],
        ];
        expect(duelOutcome(fight('player', dead, dead)).outcome).toBe('draw');
        expect(duelOutcome(fight('enemy', dead, dead)).outcome).toBe('draw');
    });
});

describe('runRace length and ties', () => {
    const attacker = (attack: number): Ship =>
        ({
            id: 'a',
            name: 'a',
            rarity: 'legendary',
            faction: 'ATLAS_SYNDICATE',
            type: 'ATTACKER',
            baseStats: {
                hp: 10000,
                attack,
                defence: 0,
                hacking: 0,
                security: 0,
                crit: 0,
                critDamage: 0,
                speed: 100,
                healModifier: 0,
                hpRegen: 0,
                shield: 0,
                damageReduction: 0,
                defensePenetration: 0,
                shieldPenetration: 0,
            },
            equipment: {},
            implants: {},
            refits: [],
            activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
            activeTarget: 'front',
            activePattern: 'Pattern-Base',
        }) as unknown as Ship;

    it('dps: two identical ships that both kill in round 1 end the race there as a draw', () => {
        const r = runRace('dps', attacker(1e7), attacker(1e7), deps, 7);
        expect(r.flown.endRound).toBe(1);
        expect(r.rival.endRound).toBe(1);
        expect(r.flown.byRound).toHaveLength(1);
        expect(r.rival.byRound).toHaveLength(1);
        expect(r.outcome).toBe('draw');
    });

    it('dps: when only one ship kills, the race runs the full length', () => {
        const r = runRace('dps', attacker(1e7), attacker(100), deps, 7);
        expect(r.flown.endRound).toBe(1);
        expect(r.rival.endRound).toBeUndefined();
        expect(r.flown.byRound).toHaveLength(CHALLENGE_ROUNDS);
        expect(r.rival.byRound).toHaveLength(CHALLENGE_ROUNDS);
        expect(r.outcome).toBe('win');
    });
});

describe('challengeSeed', () => {
    it('is fixed by the run seed and the row, and differs between rows and runs', () => {
        expect(challengeSeed(42, 7)).toBe(challengeSeed(42, 7));
        expect(challengeSeed(42, 7)).not.toBe(challengeSeed(42, 8));
        expect(challengeSeed(42, 7)).not.toBe(challengeSeed(43, 7));
        expect(Number.isInteger(challengeSeed(42, 7))).toBe(true);
    });
});

describe('runChallenge with picks that do not fit', () => {
    const a = { id: 'a', name: 'a' } as Ship;
    const single: RowPicks = { kind: 'single', gates: [a, a] };
    const team: RowPicks = {
        kind: 'team',
        gates: [
            [a, a, a],
            [a, a, a],
        ],
        allies: [a, a],
    };

    it('skips a team row without team picks, and a one-ship row with them', () => {
        expect(runChallenge('team', a, single, 0, deps, 1)).toEqual(skippedChallenge('team'));
        expect(runChallenge('dps', a, team, 0, deps, 1)).toEqual(skippedChallenge('dps'));
        expect(runChallenge('duel', a, team, 1, deps, 1)).toEqual(skippedChallenge('duel'));
    });

    it('a race that throws is skipped and warns in development', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const broken: CombatStatsDeps = {
            getGearPiece: () => {
                throw new Error('boom');
            },
            getEngineeringStatsForShipType: () => undefined,
        };
        const geared = { ...a, baseStats: {}, equipment: { weapon: 'x' } } as unknown as Ship;
        const r = runRace('dps', geared, geared, broken, 1);
        expect(r).toEqual(skippedChallenge('dps'));
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

/** Real template ships from the gitignored reference data, at full refits with no gear. The
 *  trace factory's refits carry no stat list, which stat resolution needs. */
function template(name: string): Ship {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`${name} is missing from docs/ship-data.json / ship-skills.csv`);
    return { ...ship, refits: ship.refits.map((r) => ({ ...r, stats: [] })) };
}

describe('races on real template ships', () => {
    beforeAll(() => {
        if (!csvAvailable() || !shipDataAvailable()) {
            throw new Error(
                'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored).'
            );
        }
    });

    const cases: { kind: RaceKind; strong: string; weak: string }[] = [
        { kind: 'dps', strong: 'Akula', weak: 'Flamel' },
        { kind: 'heal', strong: 'Flamel', weak: 'Akula' },
        { kind: 'tank', strong: 'Bedrock', weak: 'Akula' },
    ];

    for (const { kind, strong, weak } of cases) {
        it(`${kind}: finite figures over ${CHALLENGE_ROUNDS} rounds and a decided winner`, () => {
            const a = template(strong);
            const b = template(weak);
            const r = runRace(kind, a, b, deps, challengeSeed(1234, 5));
            expect(r.kind).toBe(kind);
            expect(r.outcome).not.toBe('skipped');
            for (const s of [r.flown, r.rival]) {
                expect(s.byRound).toHaveLength(CHALLENGE_ROUNDS);
                expect(s.byRound.every(Number.isFinite)).toBe(true);
                expect(Number.isFinite(s.total)).toBe(true);
                expect(s.byRound.at(-1)).toBeCloseTo(s.total, 0);
            }
            // Same inputs and seed → the same result.
            expect(runRace(kind, a, b, deps, challengeSeed(1234, 5))).toEqual(r);
            // Swapping the ships swaps the figures; the outcome follows the figures.
            const back = runRace(kind, b, a, deps, challengeSeed(1234, 5));
            expect(back.flown).toEqual(r.rival);
            expect(back.rival).toEqual(r.flown);
        });
    }

    it('dps: the attacker out-damages the healer', () => {
        const r = runRace('dps', template('Akula'), template('Flamel'), deps, 9);
        expect(r.flown.total).toBeGreaterThan(r.rival.total);
        expect(r.outcome).toBe('win');
    });

    it('heal: the healer out-heals an attacker that heals nothing', () => {
        const r = runRace('heal', template('Akula'), template('Flamel'), deps, 9);
        expect(r.flown.total).toBe(0);
        expect(r.rival.total).toBeGreaterThan(0);
        expect(r.outcome).toBe('lose');
    });

    it('tank: the attacker takes damage, so HP left can decide a loss', () => {
        const r = runRace('tank', template('Akula'), template('Bedrock'), deps, 9);
        expect(r.flown.total).toBeLessThan(100);
        expect(r.flown.byRound[0]).toBeGreaterThanOrEqual(r.flown.total);
    });

    it('duel and team run through runChallenge on real ships', () => {
        const [a, b, c, d, e, f, g, h, i] = [
            'Akula',
            'Faust',
            'Bedrock',
            'Flamel',
            'Cultivator',
            'Grif',
            'Butcher',
            'Cobalt',
            'Anemone',
        ].map(template);
        const duel = runChallenge('duel', a, { kind: 'single', gates: [b, c] }, 1, deps, 3);
        expect(isRace(duel)).toBe(false);
        expect(duel.kind).toBe('duel');
        expect(duel.outcome).not.toBe('skipped');
        const team = runChallenge(
            'team',
            a,
            {
                kind: 'team',
                gates: [
                    [b, c, d],
                    [e, f, g],
                ],
                allies: [h, i],
            },
            0,
            deps,
            3
        );
        expect(team.kind).toBe('team');
        expect(team.outcome).not.toBe('skipped');
        if (!isRace(team)) {
            expect(team.beats.length).toBeGreaterThan(0);
            expect(Math.max(...team.beats.map((beat) => beat.round))).toBeLessThanOrEqual(
                CHALLENGE_ROUNDS
            );
        }
    });
});
