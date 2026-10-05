/**
 * The combat log's row for a hit's PRIMARY target shows what that target lost, the same figure a
 * splash row shows — including the target's own damage reductions, and including a passive-slot
 * damage instance that rides the same cast.
 *
 * Anemone (both refits): "This Unit takes 25% less direct damage from enemies debuffed with a
 * damage over time effect." Her active inflicts Corrosion I on the ship she hits, so when that
 * ship hits her back it is DoT-debuffed and she takes 25% less.
 *
 * Snakeroot R2+ passive: "This Unit deals 120% damage for every 4 stacks of damage over time
 * inflicted onto a single enemy." It is a separate damage instance that lands right after his
 * firing hit, on the same target; the row must carry both.
 *
 * Asserted through `simulateBattle` + `flattenCombatLog` — `runCombat` builds no log.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../../calculators/battleSimulator';
import { flattenRound } from '../__testutils__/flattenCombatLog';
import type { CombatLogEntry } from '../types';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import type { Ship } from '../../../../types/ship';
import type { Position } from '../../../../types/encounters';

type Result = ReturnType<typeof simulateBattle>;

const requireReferenceData = (): void => {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing — copy the gitignored reference data into this ' +
                'worktree. These cases read REAL kits and cannot run without it.'
        );
    }
};

const place = (
    ship: Ship,
    position: Position,
    o: Partial<BattlePlacement['statOverrides']> = {}
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
        speed: 100,
        ...o,
    },
});

/** A plain 100% single-target hitter. */
const plainShip = (): Ship =>
    ({
        id: 'plain',
        name: 'Plain',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        affinity: 'antimatter',
        activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
        chargeSkillCharge: 0,
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    }) as Partial<Ship> as Ship;

const real = (name: string): Ship => {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`${name} is missing from the reference data in this worktree`);
    return { ...ship, affinity: 'antimatter' };
};

const idOf = (result: Result, name: string): string =>
    result.roster.find((r) => r.name === name)!.actorId;

/** The logged amount of each round's attack row from `attacker` onto `target`. */
const loggedHits = (result: Result, attacker: string, target: string): number[] =>
    result.combatLog.map((round) => {
        const rows = flattenRound(round).filter(
            (e: CombatLogEntry) => e.kind === 'attack' && e.actorId === attacker
        );
        const amounts = rows.flatMap((e) =>
            e.targets.filter((t) => t.targetId === target).map((t) => t.amount ?? 0)
        );
        return amounts.reduce((s, a) => s + a, 0);
    });

const takenPerRound = (result: Result, id: string): number[] =>
    result.rounds.map((r) => r.ships.find((s) => s.actorId === id)?.damageTaken ?? 0);

describe("the primary row shows the target's own damage reduction (Anemone)", () => {
    beforeAll(requireReferenceData);

    it('PLAYER hits an ENEMY Anemone: the row reads what she lost, 25% under the hit', () => {
        const result = simulateBattle({
            playerTeam: [place(plainShip(), 'M4', { speed: 50 })],
            enemyTeam: [place(real('Anemone'), 'M4', { speed: 200 })],
            rounds: 2,
        });
        const anemone = idOf(result, 'Anemone');
        const logged = loggedHits(result, idOf(result, 'Plain'), anemone);

        expect(logged.every((a) => a > 0)).toBe(true);
        expect(logged).toEqual(takenPerRound(result, anemone));
    });

    it('ENEMY hits a PLAYER Anemone: the same row, the same figure', () => {
        const result = simulateBattle({
            playerTeam: [place(real('Anemone'), 'M4', { speed: 200 })],
            enemyTeam: [place(plainShip(), 'M4', { speed: 50 })],
            rounds: 2,
        });
        const anemone = idOf(result, 'Anemone');
        const logged = loggedHits(result, idOf(result, 'Plain'), anemone);

        expect(logged.every((a) => a > 0)).toBe(true);
        expect(logged).toEqual(takenPerRound(result, anemone));
    });
});

describe("the primary row carries Snakeroot's passive damage instance", () => {
    beforeAll(requireReferenceData);

    const board = (snakerootSide: 'player' | 'enemy'): Result => {
        const snake = place(real('Snakeroot'), 'M4', { speed: 200 });
        const victim = place(plainShip(), 'M4', { speed: 50, attack: 0 });
        return simulateBattle({
            playerTeam: [snakerootSide === 'player' ? snake : victim],
            enemyTeam: [snakerootSide === 'player' ? victim : snake],
            rounds: 3,
        });
    };

    /** Damage the victim took from DoT ticks each round, read off the log's own tick rows. */
    const tickedPerRound = (result: Result, victim: string): number[] =>
        result.combatLog.map((round) =>
            flattenRound(round)
                .filter((e) => e.kind === 'dot-ticked')
                .flatMap((e) => e.targets.filter((t) => t.targetId === victim))
                .reduce((s, t) => s + (t.amount ?? 0), 0)
        );

    it('PLAYER Snakeroot: each row equals the direct damage the enemy lost that round', () => {
        const result = board('player');
        const victim = idOf(result, 'Plain');
        const logged = loggedHits(result, idOf(result, 'Snakeroot'), victim);
        const ticked = tickedPerRound(result, victim);
        const direct = takenPerRound(result, victim).map((t, i) => t - ticked[i]);

        // Round 1 the enemy carries no DoT, so the passive adds nothing; from round 2 it does.
        expect(logged[1]).toBeGreaterThan(logged[0]);
        logged.forEach((a, i) => expect(a).toBeCloseTo(direct[i], 6));
    });

    it('ENEMY Snakeroot: the mirror logs the same rows', () => {
        const mirror = board('enemy');
        const player = board('player');

        expect(loggedHits(mirror, idOf(mirror, 'Snakeroot'), idOf(mirror, 'Plain'))).toEqual(
            loggedHits(player, idOf(player, 'Snakeroot'), idOf(player, 'Plain'))
        );
    });
});
