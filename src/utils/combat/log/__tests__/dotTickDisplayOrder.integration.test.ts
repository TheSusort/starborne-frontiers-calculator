/**
 * A DoT ticks at the start of its holder's turn, so the log prints the tick before that ship's own
 * attack row (and a Repair Over Time tick likewise). Run with the DoT holder on either side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../../calculators/battleSimulator';
import { setupKeyedRng } from '../../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import type { Ship } from '../../../../types/ship';
import type { Position } from '../../../../types/encounters';

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
        hp: 900_000,
        speed,
    },
});

const real = (name: string): Ship => {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`${name} is missing from the reference data in this worktree`);
    return { ...ship, affinity: 'antimatter' };
};

describe('DoT tick display order', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`holder on the ${side} side: the tick prints before the holder's attack`, () => {
            const holders = [place(real('Provider'), 'M4', 120), place(real('Jempol'), 'T4', 110)];
            const appliers = [
                place(real('Hemlock'), 'M4', 140),
                place(real('Oleander'), 'T4', 130),
            ];
            const result = simulateBattle({
                playerTeam: side === 'player' ? holders : appliers,
                enemyTeam: side === 'player' ? appliers : holders,
                rounds: 4,
            });
            const holderIds = new Set(
                result.roster.filter((r) => r.side === side).map((r) => r.actorId)
            );
            let checked = 0;
            for (const round of result.combatLog) {
                for (const turn of round.turns) {
                    if (!holderIds.has(turn.actorId)) continue;
                    const tick = turn.entries.findIndex(
                        (e) => e.kind === 'dot-ticked' && e.actorId === turn.actorId
                    );
                    const attack = turn.entries.findIndex(
                        (e) => e.kind === 'attack' && e.actorId === turn.actorId
                    );
                    if (tick === -1 || attack === -1) continue;
                    checked += 1;
                    expect(tick).toBeLessThan(attack);
                }
            }
            expect(checked).toBeGreaterThan(0);
        });
    }
});
