/**
 * The combat log's row for a hit that a Protection cascade split shows the share the original
 * target kept, and the protectors' own rows carry the rest: the rows sum to the hit, nothing is
 * counted twice.
 *
 * Lionheart (10 stacks at round start, 100% redirect, real kit): the ally's row reads 0 and his ten
 * sub-hit rows carry the hit. Meatshield (3 stacks, 30% redirect): the ally's row reads the 70% it
 * kept; the protector's slice is deferred into a DoT and logged by its tick rows.
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

/** Round 1 only: the attacker's fast single hit lands on the front-most unit (the ally), the
 *  protector stands behind it. */
const board = (protector: Ship, protectorSide: 'player' | 'enemy' | 'none'): Result => {
    const attacker = place(plainShip('Attacker'), 'M4', 500);
    const ally = place(plainShip('Ally'), 'M4', 50);
    const guard = place(protector, 'M1', 40);
    const protectedTeam = protectorSide === 'none' ? [ally] : [ally, guard];
    return simulateBattle({
        playerTeam: protectorSide === 'player' ? protectedTeam : [attacker],
        enemyTeam: protectorSide === 'player' ? [attacker] : protectedTeam,
        rounds: 1,
    });
};

/** What the log shows the attacker's hit doing to `allyId`, and what it shows the protector(s)
 *  taking from that same hit (rows the ally is the source of). */
const rowsOf = (result: Result, allyId: string, attackerId: string) => {
    const rows = flattenRound(result.combatLog[0]).filter((e) => e.kind === 'attack');
    const onAlly = rows
        .filter((e) => e.actorId === attackerId)
        .flatMap((e) => e.targets.filter((t) => t.targetId === allyId))
        .reduce((s, t) => s + (t.amount ?? 0), 0);
    const onProtectors = rows
        .filter((e) => e.actorId === allyId)
        .flatMap((e) => e.targets.filter((t) => t.targetId !== attackerId))
        .reduce((s, t) => s + (t.amount ?? 0), 0);
    return { onAlly, onProtectors };
};

const takenBy = (result: Result, id: string): number =>
    result.rounds[0].ships.find((s) => s.actorId === id)?.damageTaken ?? 0;

describe.each<'player' | 'enemy'>(['enemy', 'player'])(
    'Protection redirect rows, protector on the %s side',
    (side) => {
        it('Lionheart takes the whole hit: the ally row reads 0, his rows carry 1000', () => {
            const result = board(real('Lionheart'), side);
            const ally = idOf(result, 'Ally');
            const { onAlly, onProtectors } = rowsOf(result, ally, idOf(result, 'Attacker'));

            expect(takenBy(result, ally)).toBe(0);
            expect(onAlly).toBe(0);
            expect(onProtectors).toBeCloseTo(1000, 6);
        });

        it('Meatshield redirects 30%: the ally row reads the 700 it kept, not the 1000 thrown', () => {
            const result = board(real('Meatshield'), side);
            const ally = idOf(result, 'Ally');
            const { onAlly } = rowsOf(result, ally, idOf(result, 'Attacker'));

            expect(takenBy(result, ally)).toBeCloseTo(700, 6);
            expect(onAlly).toBeCloseTo(700, 6);
        });
    }
);

describe('Protection redirect rows, negative case', () => {
    it('with no protector the row reads the full hit', () => {
        const result = board(real('Lionheart'), 'none');
        const ally = idOf(result, 'Ally');
        const { onAlly, onProtectors } = rowsOf(result, ally, idOf(result, 'Attacker'));

        expect(onAlly).toBe(1000);
        expect(onProtectors).toBe(0);
        expect(takenBy(result, ally)).toBe(1000);
    });
});
