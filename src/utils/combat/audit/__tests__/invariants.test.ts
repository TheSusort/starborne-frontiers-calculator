import { describe, it, expect } from 'vitest';
import {
    checkInvariants,
    checkOpenInvariants,
    extraActionActorIds,
    OPEN_INVARIANTS,
    shipGrantsExtraAction,
} from '../invariants';
import { runSeededBattle } from '../../../simulator/seededRuns';
import { canonicalPlacement } from '../fixtures';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import type { BattleResult, BattleSimulationInput } from '../../../calculators/battleSimulator';
import type {
    CombatLogEntry,
    CombatLogEntryKind,
    CombatLogRound,
    CombatLogTurn,
} from '../../log/types';
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

describe('checkInvariants — conservation', () => {
    it('flags a per-round damageDealt/damageTaken mismatch on a non-protection battle', () => {
        const result = runSeededBattle(battle(), 1); // Demolisher mirror — no Protection
        result.rounds[0].ships[0].damageDealt += 5000; // break the ledger
        expect(checkInvariants(result).some((x) => x.invariant === 'damage-conservation')).toBe(
            true
        );
    });
});

const allViolations = (result: BattleResult) => [
    ...checkInvariants(result),
    ...checkOpenInvariants(result),
];
const ids = (result: BattleResult, invariant: string) =>
    allViolations(result).filter((x) => x.invariant === invariant);

describe('checkInvariants — highest tier wins', () => {
    it('flags two tiers of one buff family on a ship at once', () => {
        const result = runSeededBattle(battle(), 1);
        result.rounds[0].ships[0].activeBuffs = ['Attack Up I', 'Attack Up II'];
        expect(ids(result, 'single-tier-family')).toHaveLength(1);
    });

    it('flags two tiers of one debuff family on a ship at once', () => {
        const result = runSeededBattle(battle(), 1);
        result.rounds[0].ships[0].activeDebuffs = ['Defense Down I', 'Defense Down III'];
        expect(ids(result, 'single-tier-family')).toHaveLength(1);
    });

    it('does not flag the families the engine stacks independently', () => {
        const result = runSeededBattle(battle(), 1);
        result.rounds[0].ships[0].activeBuffs = ['Repair Over Time I', 'Repair Over Time II'];
        result.rounds[0].ships[0].activeDebuffs = ['Corrosion I', 'Corrosion II', 'Defense Shred'];
        expect(ids(result, 'single-tier-family')).toEqual([]);
    });

    it('does not pair a buff with a debuff of the same family', () => {
        const result = runSeededBattle(battle(), 1);
        result.rounds[0].ships[0].activeBuffs = ['Attack Up I'];
        result.rounds[0].ships[0].activeDebuffs = ['Attack Up II'];
        expect(ids(result, 'single-tier-family')).toEqual([]);
    });
});

describe('checkInvariants — shield', () => {
    it('flags a negative end-of-round shield pool', () => {
        const result = runSeededBattle(battle(), 1);
        result.rounds[0].ships[0].currentShieldPool = -1;
        expect(ids(result, 'shield-non-negative')).toHaveLength(1);
    });

    it('flags a negative turn-start shield pool', () => {
        const result = runSeededBattle(battle(), 1);
        const turn = result.combatLog[0].turns.find((t) => t.statsSnapshot);
        if (!turn?.statsSnapshot) throw new Error('fixture: no turn carries a stats snapshot');
        turn.statsSnapshot.shieldPool = -1;
        expect(ids(result, 'shield-non-negative')).toHaveLength(1);
    });
});

describe('checkInvariants — one turn per round', () => {
    it('flags an actor taking a second turn in a round', () => {
        const result = runSeededBattle(battle(), 1);
        const turns = result.combatLog[0].turns;
        turns.push({ ...turns[0], entries: [] });
        const v = ids(result, 'no-extra-turns');
        expect(v).toHaveLength(1);
        expect(v[0].actorId).toBe(turns[0].actorId);
    });

    it('allows a second turn to an actor whose kit grants an extra action', () => {
        const result = runSeededBattle(battle(), 1);
        const turns = result.combatLog[0].turns;
        turns.push({ ...turns[0], entries: [] });
        const v = checkInvariants(result, {
            extraActionActorIds: new Set([turns[0].actorId]),
        }).filter((x) => x.invariant === 'no-extra-turns');
        expect(v).toEqual([]);
    });

    it('extraActionActorIds names the ships whose kit carries an extra-action ability', () => {
        const input: BattleSimulationInput = {
            playerTeam: [canonicalPlacement(buildTraceShip('Sokol') as Ship, 'T1')],
            enemyTeam: [canonicalPlacement(buildTraceShip('Demolisher') as Ship, 'M2')],
            rounds: 1,
        };
        const result = runSeededBattle(input, 1);
        expect(shipGrantsExtraAction(input.playerTeam[0].ship)).toBe(true);
        expect(shipGrantsExtraAction(input.enemyTeam[0].ship)).toBe(false);
        expect([...extraActionActorIds(input, result)]).toEqual([result.roster[0].actorId]);
    });
});

// Hand-built combat logs for the log-walk invariants. Player A and C, enemy B and D.
const entry = (
    kind: CombatLogEntryKind,
    actorId: string,
    targetIds: string[] = [],
    reactions: CombatLogEntry[] = []
): CombatLogEntry => ({
    kind,
    actorId,
    targets: targetIds.map((targetId) => ({ targetId })),
    reactions,
});
const turn = (actorId: string, entries: CombatLogEntry[]): CombatLogTurn => ({
    actorId,
    chargeBefore: 0,
    chargeMax: 0,
    entries,
});
const logResult = (combatLog: CombatLogRound[]): BattleResult => ({
    rounds: [],
    outcome: { winner: 'player', lastRound: combatLog.length },
    roster: [
        { actorId: 'A', side: 'player', name: 'A', position: 'T1' },
        { actorId: 'C', side: 'player', name: 'C', position: 'T2' },
        { actorId: 'B', side: 'enemy', name: 'B', position: 'T1' },
        { actorId: 'D', side: 'enemy', name: 'D', position: 'T2' },
    ],
    combatLog,
});
const round = (
    n: number,
    turns: CombatLogTurn[],
    startOfRound: CombatLogEntry[] = [],
    endOfRound: CombatLogEntry[] = []
): CombatLogRound => ({ round: n, startOfRound, turns, endOfRound });
/** A kills B; the killing hit is nested under B's death row, as buildCombatLog routes it. */
const killB = (): CombatLogTurn =>
    turn('A', [entry('death', 'B', ['A'], [entry('attack', 'A', ['B'])])]);

describe('checkInvariants — corpses', () => {
    it('does not flag the killing hit or the rest of the killing block', () => {
        const result = logResult([
            round(1, [
                turn('A', [
                    entry('death', 'B', ['A'], [entry('attack', 'A', ['B'])]),
                    entry('debuff', 'A', ['B']),
                ]),
            ]),
        ]);
        expect(allViolations(result)).toEqual([]);
    });

    it('flags a hostile row aimed at a ship that died in an earlier block', () => {
        const result = logResult([
            round(1, [killB(), turn('C', [entry('attack', 'C', ['B', 'D'])])]),
        ]);
        const v = ids(result, 'corpse-hostile-target');
        expect(v).toHaveLength(1);
        expect(v[0].actorId).toBe('B');
    });

    it('flags a grant onto a dead ally, including a charge change', () => {
        const result = logResult([
            round(1, [
                killB(),
                turn('D', [entry('buff', 'D', ['B', 'D']), entry('charge-changed', 'B')]),
            ]),
        ]);
        expect(ids(result, 'corpse-ally-grant')).toHaveLength(2);
    });

    it('flags a dead ship acting, but not its DoT ticking or its status expiring', () => {
        const result = logResult([
            round(1, [killB()]),
            round(
                2,
                [turn('D', [entry('dot-ticked', 'B', ['B']), entry('buff-expired', 'B')])],
                [entry('buff', 'B', ['B'])]
            ),
        ]);
        const v = ids(result, 'corpse-acts');
        expect(v).toHaveLength(1);
        expect(v[0].round).toBe(2);
        expect(ids(result, 'corpse-hostile-target')).toEqual([]);
    });
});

describe('checkInvariants — the wiping turn ends the fight', () => {
    const killD = (): CombatLogTurn =>
        turn('C', [entry('death', 'D', ['C'], [entry('attack', 'C', ['D'])])]);

    it('flags a turn after the turn that wiped a side', () => {
        const result = logResult([round(1, [killB(), killD(), turn('A', [])])]);
        const v = ids(result, 'no-turn-after-wipe');
        expect(v).toHaveLength(1);
        expect(v[0].actorId).toBe('A');
    });

    it('flags a drain row after the wiping turn', () => {
        const result = logResult([round(1, [killB(), killD()], [], [entry('buff', 'C', ['C'])])]);
        expect(ids(result, 'entry-after-wipe')).toHaveLength(1);
        expect(ids(result, 'no-turn-after-wipe')).toEqual([]);
    });

    it('does not flag a fight that ends on its wiping turn', () => {
        const result = logResult([round(1, [killB(), killD()])]);
        expect(allViolations(result)).toEqual([]);
    });
});

describe('checkInvariants vs checkOpenInvariants', () => {
    it('reports each open invariant only through checkOpenInvariants', () => {
        const result = logResult([
            round(1, [killB(), turn('C', [entry('attack', 'C', ['B'])]), turn('D', [])], [], []),
            round(2, [], [entry('buff', 'B', ['B'])]),
        ]);
        const open = checkOpenInvariants(result).map((v) => v.invariant);
        expect(open).toContain('corpse-hostile-target');
        expect(open).toContain('corpse-acts');
        expect(open.every((id) => OPEN_INVARIANTS.has(id))).toBe(true);
        expect(checkInvariants(result).filter((v) => OPEN_INVARIANTS.has(v.invariant))).toEqual([]);
    });
});
