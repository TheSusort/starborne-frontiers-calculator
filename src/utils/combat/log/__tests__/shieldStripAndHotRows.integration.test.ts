/**
 * Two rows the combat log used to omit although they move the board:
 *  - a Repair Over Time tick (the holder's HP rises), and
 *  - a shield strip (APEX, Laika, Malvex remove a share of the target's shield pool), which also
 *    books a per-ship `shieldStripped` stat so the shield pool reconciles round to round.
 * Each runs with the subject on the player side and mirrored on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../../calculators/battleSimulator';
import { setupKeyedRng } from '../../../calculators/rateAccumulator';
import { flattenCombatLog } from '../__testutils__/flattenCombatLog';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import type { Ship } from '../../../../types/ship';
import type { Position } from '../../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable()) throw new Error('docs/ship-skills.csv is required for the real kits');
});
beforeEach(() => setupKeyedRng(34));

const place = (ship: Ship, position: Position, speed: number): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 20_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 50_000,
        security: 0,
        defence: 0,
        hp: 400_000,
        speed,
    },
});

const real = (name: string): Ship => {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`${name} is missing from the reference data in this worktree`);
    return { ...ship, affinity: 'antimatter' };
};

const fleet = (names: string[], speed: number): BattlePlacement[] =>
    names.map((n, i) => place(real(n), (['M4', 'T4', 'B4', 'M3'] as Position[])[i], speed - i * 5));

describe('shield strips', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side} side: a strip has a row and the shield pool reconciles`, () => {
            const strippers = fleet(['APEX', 'Laika', 'Malvex', 'Provider'], 150);
            const shielded = fleet(['Zenith', 'Quixilver', 'Crucialis', 'Iridium'], 100);
            const result = simulateBattle({
                playerTeam: side === 'player' ? strippers : shielded,
                enemyTeam: side === 'player' ? shielded : strippers,
                rounds: 6,
            });
            const rows = flattenCombatLog(result).filter((e) => e.kind === 'shield-stripped');
            expect(rows.length).toBeGreaterThan(0);
            for (const row of rows) {
                expect(row.targets).toHaveLength(1);
                expect(row.targets[0].amount).toBeGreaterThan(0);
            }
            // Shield pool conservation from round 2 on: pool = previous pool + granted - absorbed -
            // stripped. (Round 1 starts from whatever pre-combat shield the ship was seeded with,
            // which is nobody's grant, so there it only has to imply a non-negative start.)
            const poolBefore = new Map<string, number>();
            let strippedTotal = 0;
            for (const round of result.rounds) {
                for (const ship of round.ships) {
                    const spent = ship.shieldsAbsorbed + ship.shieldStripped;
                    if (round.round === 1) {
                        expect(ship.currentShieldPool - ship.shieldGranted + spent).toBeGreaterThan(
                            -1e-6
                        );
                    } else {
                        const before = poolBefore.get(ship.actorId) ?? 0;
                        expect(ship.currentShieldPool).toBeCloseTo(
                            Math.max(0, before + ship.shieldGranted - spent),
                            3
                        );
                    }
                    poolBefore.set(ship.actorId, ship.currentShieldPool);
                    strippedTotal += ship.shieldStripped;
                }
            }
            const rowTotal = rows.reduce((s, e) => s + (e.targets[0].amount ?? 0), 0);
            expect(strippedTotal).toBeCloseTo(rowTotal, 3);
        });
    }
});

describe('Repair Over Time ticks', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side} side: a tick has a row on its holder`, () => {
            const healers = fleet(['Graphite', 'Iridium', 'Provider', 'Zenith'], 150);
            const strikers = fleet(['Nosorog', 'Tygr', 'Larkspur', 'Demolisher'], 100);
            const result = simulateBattle({
                playerTeam: side === 'player' ? healers : strikers,
                enemyTeam: side === 'player' ? strikers : healers,
                rounds: 4,
            });
            const rows = flattenCombatLog(result).filter((e) => e.kind === 'hot-ticked');
            expect(rows.length).toBeGreaterThan(0);
            const healerIds = new Set(
                result.roster.filter((r) => r.side === side).map((r) => r.actorId)
            );
            for (const row of rows) {
                expect(row.targets).toHaveLength(1);
                expect(row.targets[0].targetId).toBe(row.actorId);
                expect(healerIds.has(row.actorId)).toBe(true);
                expect(row.targets[0].amount).toBeGreaterThan(0);
            }
        });
    }
});
