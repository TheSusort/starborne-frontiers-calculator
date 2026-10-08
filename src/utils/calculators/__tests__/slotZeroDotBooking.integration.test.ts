/**
 * The first player slot books its incoming Damage-over-Time like every other ship: its
 * `damageTaken` equals the HP, shield and barrier it lost, and the DoT's applier is credited the
 * same amount as `damageDealt`. Run with the DoT applier on either side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { simulateBattle, BattlePlacement } from '../battleSimulator';
import { setupKeyedRng } from '../rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable()) throw new Error('docs/ship-skills.csv is required for the real kits');
});
beforeEach(() => setupKeyedRng(104));

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
        hp: 600_000,
        speed,
    },
});

const real = (name: string): Ship => {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`${name} is missing from the reference data in this worktree`);
    return { ...ship, affinity: 'antimatter' };
};

describe('DoT intake on the first slot', () => {
    for (const applierSide of ['player', 'enemy'] as const) {
        it(`DoT appliers on the ${applierSide} side: every ship's damageTaken matches what it lost, and the applier is credited`, () => {
            // Hemlock and Oleander lay Corrosion; Provider and Jempol are the targets, slot 0 first.
            const appliers = [
                place(real('Hemlock'), 'M4', 140),
                place(real('Oleander'), 'T4', 130),
            ];
            const targets = [place(real('Provider'), 'M4', 120), place(real('Jempol'), 'T4', 110)];
            const result = simulateBattle({
                playerTeam: applierSide === 'player' ? appliers : targets,
                enemyTeam: applierSide === 'player' ? targets : appliers,
                rounds: 4,
            });
            const targetIds = result.roster
                .filter((r) => r.side !== applierSide)
                .map((r) => r.actorId);
            let tickedRounds = 0;
            for (const round of result.rounds) {
                for (const ship of round.ships) {
                    const lost =
                        ship.incomingDamage +
                        ship.incomingShieldAbsorbed +
                        ship.incomingBarrierAbsorbed;
                    expect(ship.damageTaken).toBeCloseTo(lost, 4);
                    if (targetIds.includes(ship.actorId) && lost > 0) tickedRounds += 1;
                }
                const dealt = round.ships.reduce((s, x) => s + x.damageDealt, 0);
                const taken = round.ships.reduce((s, x) => s + x.damageTaken, 0);
                expect(dealt).toBeCloseTo(taken, 4);
            }
            expect(tickedRounds).toBeGreaterThan(0);
        });
    }
});
