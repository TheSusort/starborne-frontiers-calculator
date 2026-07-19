import { describe, it, expect } from 'vitest';
import { checkInvariants } from '../invariants';
import { runSeededBattle } from '../seededBattle';
import { canonicalPlacement } from '../fixtures';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import type { BattleSimulationInput } from '../../../calculators/battleSimulator';
import type { Ship } from '../../../../types/ship';

const battle = (): BattleSimulationInput => ({
    playerTeam: [canonicalPlacement(buildTraceShip('Demolisher') as Ship, 'T1')],
    enemyTeam: [canonicalPlacement(buildTraceShip('Demolisher') as Ship, 'M2')],
    rounds: 20,
});

describe('checkInvariants — pure result checks', () => {
    it('reports no violations for a normal battle', () => {
        const result = runSeededBattle(battle(), 1);
        expect(checkInvariants(result)).toEqual([]);
    });

    it('flags an hpPct outside [0,100]', () => {
        const result = runSeededBattle(battle(), 1);
        result.rounds[0].ships[0].hpPct = 140;
        expect(checkInvariants(result).some((x) => x.invariant === 'hp-bounds')).toBe(true);
    });

    it('flags a dead actor whose corpse appears in turnOrder in a LATER round', () => {
        const result = runSeededBattle({ ...battle(), rounds: 2 }, 1);
        const dead = result.rounds[0].ships[0];
        dead.alive = false; // dead as of round 1
        const round2 = result.rounds[1];
        round2.turnOrder = [...round2.turnOrder, dead.actorId]; // corpse acts in round 2
        const violations = checkInvariants(result);
        expect(
            violations.some(
                (x) =>
                    x.invariant === 'no-dead-acts' &&
                    x.actorId === dead.actorId &&
                    x.round === round2.round
            )
        ).toBe(true);
    });

    it('does NOT flag an actor appearing only in its own death-round turnOrder', () => {
        // Single-round result: no later round exists, so there is nothing for the actor's
        // own-round appearance to be measured "later than" — isolates the "died and acted in
        // the same round" case from any real (unmutated) appearance in a later round.
        const result = runSeededBattle({ ...battle(), rounds: 1 }, 1);
        const dead = result.rounds[0].ships[0];
        dead.alive = false; // dead as of round 1
        result.rounds[0].turnOrder = [dead.actorId]; // legal: died THIS round, still acted this round
        expect(checkInvariants(result).some((x) => x.invariant === 'no-dead-acts')).toBe(false);
    });
});
