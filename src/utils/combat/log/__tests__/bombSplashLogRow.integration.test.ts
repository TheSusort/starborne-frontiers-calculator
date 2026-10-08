/**
 * A bomb carrier's death splash moves its neighbour's HP, so the combat log carries a row for it:
 * the splash amount, credited to the bomb's applier, with the neighbour's HP afterwards.
 *
 * Board: Demolisher (real kit, bombs its target) bombs the front ship in round 1; a faster-acting
 * striker then kills the carrier before the bomb goes off, and the carrier splashes the ship
 * behind it. One round, so the neighbour takes nothing else.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../../calculators/battleSimulator';
import { setupKeyedRng } from '../../../calculators/rateAccumulator';
import { flattenRound } from '../__testutils__/flattenCombatLog';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import type { Ship } from '../../../../types/ship';
import type { Position } from '../../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable()) throw new Error('docs/ship-skills.csv is required for the real kits');
});
beforeEach(() => setupKeyedRng(9));

const CARRIER_HP = 100_000;
const NEIGHBOUR_HP = 1_000_000;

const place = (
    ship: Ship,
    position: Position,
    speed: number,
    over: Partial<NonNullable<BattlePlacement['statOverrides']>> = {}
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 20_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 100_000,
        security: 0,
        defence: 0,
        hp: 1e9,
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

describe('bomb splash on the carrier’s death', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side} side: the neighbour's HP loss has a row, with its HP afterwards`, () => {
            const bombers = [
                place(real('Demolisher'), 'M4', 200, { attack: 5_000 }),
                place(
                    plainShip('Striker', 'This Unit deals <unit-damage>400% damage</unit-damage>.'),
                    'T4',
                    100,
                    { attack: 100_000 }
                ),
            ];
            const defenders = [
                place(plainShip('Carrier', 'This Unit deals 0% damage.'), 'M4', 10, {
                    hp: CARRIER_HP,
                }),
                place(plainShip('Neighbour', 'This Unit deals 0% damage.'), 'M3', 5, {
                    hp: NEIGHBOUR_HP,
                }),
            ];
            const result = simulateBattle({
                playerTeam: side === 'player' ? bombers : defenders,
                enemyTeam: side === 'player' ? defenders : bombers,
                rounds: 1,
            });
            const id = (name: string) => result.roster.find((r) => r.name === name)!.actorId;
            const carrierId = id('Carrier');
            const neighbourId = id('Neighbour');
            const demolisherId = id('Demolisher');
            const carrier = result.rounds[0].ships.find((s) => s.actorId === carrierId)!;
            expect(carrier.alive).toBe(false);
            const neighbour = result.rounds[0].ships.find((s) => s.actorId === neighbourId)!;
            expect(neighbour.damageTaken).toBeGreaterThan(0);

            const rows = flattenRound(result.combatLog[0]).flatMap((e) =>
                e.targets
                    .filter((t) => t.targetId === neighbourId && (t.amount ?? 0) > 0)
                    .map((t) => ({ entry: e, target: t }))
            );
            expect(rows).toHaveLength(1);
            const [{ entry, target }] = rows;
            expect(entry.actorId).toBe(demolisherId);
            expect(target.amount).toBeCloseTo(neighbour.damageTaken, 4);
            expect(target.resultingHpPct).toBeCloseTo(
                (100 * (NEIGHBOUR_HP - neighbour.damageTaken)) / NEIGHBOUR_HP,
                4
            );
        });
    }
});
