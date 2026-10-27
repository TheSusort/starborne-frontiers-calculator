import { describe, it, expect, beforeAll, vi } from 'vitest';
import { runChallenge, runRace } from '../runChallenge';
import {
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

describe('raceOutcome', () => {
    it('the higher figure wins', () => {
        expect(raceOutcome(side(500), side(400))).toBe('win');
        expect(raceOutcome(side(400), side(500))).toBe('lose');
    });

    it('the flown ship wins a tie', () => {
        expect(raceOutcome(side(250), side(250))).toBe('win');
    });

    it('a ship that scores 0 loses, unless both score 0', () => {
        expect(raceOutcome(side(0), side(1))).toBe('lose');
        expect(raceOutcome(side(1), side(0))).toBe('win');
        expect(raceOutcome(side(0), side(0))).toBe('win');
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

    it('at the cap, the player wins a tie on summed HP%', () => {
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
        expect(duelOutcome(tie).outcome).toBe('win');
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
