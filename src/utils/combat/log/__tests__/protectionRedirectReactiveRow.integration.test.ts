/**
 * A counter-attack or passive damage proc that a Protection cascade splits rows the victim at what
 * it took, like a cast hit: the victim's rows sum to its own damage taken and the protector's rows
 * carry the rest, so nothing is counted twice.
 *
 * Nyxen's counter and Chakara's round-start hit (real kits) land on a ship standing in front of
 * its team's protector. Lionheart (10 stacks, 100% redirect) takes it all; Meatshield (3 stacks,
 * 30% redirect) leaves the victim 70%.
 *
 * Asserted through `simulateBattle` + `flattenRound` — `runCombat` builds no log.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../../calculators/battleSimulator';
import { flattenRound } from '../__testutils__/flattenCombatLog';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import type { Ship } from '../../../../types/ship';
import type { Position } from '../../../../types/encounters';

type Result = ReturnType<typeof simulateBattle>;

beforeAll(() => {
    if (!csvAvailable()) throw new Error('docs/ship-skills.csv is required for the real kits');
});

const place = (ship: Ship, position: Position, speed: number): BattlePlacement => ({
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
    },
});

const plainShip = (name: string): Ship =>
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

/** `reactor` (Nyxen / Chakara) faces a plain `Victim` that stands in front of `guard`. */
const board = (reactor: string, guard: Ship | undefined): Result => {
    const victim = place(plainShip('Victim'), 'M4', 500);
    const team = guard ? [victim, place(guard, 'M1', 40)] : [victim];
    return simulateBattle({
        playerTeam: team,
        enemyTeam: [place(real(reactor), 'M4', 600)],
        rounds: 1,
    });
};

/** Everything the log rows land on `id` in round 1, whoever the actor and whatever the kind. */
const rowsOn = (result: Result, id: string, fromActor: string) =>
    flattenRound(result.combatLog[0])
        .filter((e) => e.kind === 'attack' && e.actorId === fromActor)
        .flatMap((e) => e.targets.filter((t) => t.targetId === id))
        .reduce((s, t) => s + (t.amount ?? 0), 0);

const takenBy = (result: Result, id: string): number =>
    result.rounds[0].ships.find((s) => s.actorId === id)?.damageTaken ?? 0;

describe.each(['Nyxen', 'Chakara'])('%s: reactive hits on a protected ship', (reactor) => {
    it('CONTROL: with no protector the rows equal the damage taken', () => {
        const result = board(reactor, undefined);
        const victim = idOf(result, 'Victim');
        const logged = rowsOn(result, victim, idOf(result, reactor));

        expect(takenBy(result, victim)).toBeGreaterThan(0);
        expect(logged).toBeCloseTo(takenBy(result, victim), 6);
    });

    it('Lionheart redirects a hit in full: the victim rows read what it took', () => {
        const result = board(reactor, real('Lionheart'));
        const control = board(reactor, undefined);
        const victim = idOf(result, 'Victim');
        const taken = takenBy(result, victim);

        // Chakara's round-start hit lands before Lionheart's own round-start grant, so only the
        // later hits are redirected; Nyxen's counter is redirected whole.
        expect(taken).toBeLessThan(takenBy(control, idOf(control, 'Victim')));
        expect(rowsOn(result, victim, idOf(result, reactor))).toBeCloseTo(taken, 6);
    });

    it('Meatshield redirects 30%: the victim rows read the 70% it took', () => {
        const result = board(reactor, real('Meatshield'));
        const control = board(reactor, undefined);
        const victim = idOf(result, 'Victim');
        const taken = takenBy(result, victim);

        expect(taken).toBeCloseTo(takenBy(control, idOf(control, 'Victim')) * 0.7, 6);
        expect(rowsOn(result, victim, idOf(result, reactor))).toBeCloseTo(taken, 6);
    });
});
