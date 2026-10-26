import { describe, it, expect } from 'vitest';
import {
    checkInvariants,
    checkOpenInvariants,
    durationExtenderKinds,
    extraActionActorIds,
    OPEN_INVARIANTS,
    shipDurationExtensionKinds,
    shipGrantsExtraAction,
} from '../invariants';
import { isPersistentByName } from '../../../../constants/oneShotPersistentBuffs';
import { stacksIndependently } from '../../statusEngine';
import { runSeededBattle } from '../../../simulator/seededRuns';
import { canonicalPlacement } from '../fixtures';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { buildCombatLog } from '../../log/buildCombatLog';
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

// Hand-built status-duration snapshots, read off `result.audit` by the duration invariants.
type DurationSnap = NonNullable<BattleResult['audit']>['statusDurations'][number];
const snap = (
    n: number,
    actorId: string,
    statuses: { buffs?: [string, number][]; debuffs?: [string, number][] }
): DurationSnap => ({
    round: n,
    actorId,
    buffs: (statuses.buffs ?? []).map(([buffName, turnsRemaining]) => ({
        buffName,
        turnsRemaining,
    })),
    debuffs: (statuses.debuffs ?? []).map(([buffName, turnsRemaining]) => ({
        buffName,
        turnsRemaining,
    })),
});
const audited = (combatLog: CombatLogRound[], statusDurations: DurationSnap[]): BattleResult => ({
    ...logResult(combatLog),
    audit: { statusDurations, hitIncomingFactors: [] },
});
const noted = (
    kind: CombatLogEntryKind,
    actorId: string,
    targetIds: string[],
    note: string
): CombatLogEntry => ({ ...entry(kind, actorId, targetIds), note });

describe('checkInvariants — status durations only count down', () => {
    const twoRounds = (round2: CombatLogTurn[] = [turn('A', [])]): CombatLogRound[] => [
        round(1, [turn('A', [])]),
        round(2, round2),
    ];

    it('flags a buff whose remaining turns rise with no application row', () => {
        const result = audited(twoRounds(), [
            snap(1, 'A', { buffs: [['Attack Up II', 1]] }),
            snap(2, 'A', { buffs: [['Attack Up II', 3]] }),
        ]);
        const v = ids(result, 'status-duration-rises');
        expect(v).toHaveLength(1);
        expect(v[0]).toMatchObject({ round: 2, actorId: 'A' });
    });

    it('flags a debuff rise just the same', () => {
        const result = audited(twoRounds(), [
            snap(1, 'B', { debuffs: [['Defense Down II', 1]] }),
            snap(2, 'B', { debuffs: [['Defense Down II', 2]] }),
        ]);
        expect(ids(result, 'status-duration-rises')).toHaveLength(1);
    });

    it('allows a rise that an application of that name onto that holder explains', () => {
        const result = audited(
            twoRounds([turn('C', [noted('buff', 'C', ['A'], 'Attack Up II')])]),
            [
                snap(1, 'A', { buffs: [['Attack Up II', 1]] }),
                snap(2, 'A', { buffs: [['Attack Up II', 3]] }),
            ]
        );
        expect(ids(result, 'status-duration-rises')).toEqual([]);
    });

    it('does not accept an application onto another holder, of another name, or of the other kind', () => {
        const result = audited(
            twoRounds([
                turn('C', [
                    noted('buff', 'C', ['C'], 'Attack Up II'),
                    noted('buff', 'C', ['A'], 'Attack Up I'),
                    noted('debuff', 'B', ['A'], 'Attack Up II'),
                ]),
            ]),
            [
                snap(1, 'A', { buffs: [['Attack Up II', 1]] }),
                snap(2, 'A', { buffs: [['Attack Up II', 3]] }),
            ]
        );
        expect(ids(result, 'status-duration-rises')).toHaveLength(1);
    });

    it('allows a buff rise of a name a steal moved this round', () => {
        const result = audited(
            twoRounds([turn('C', [noted('steal', 'C', ['B'], 'stole Attack Up II x2')])]),
            [
                snap(1, 'A', { buffs: [['Attack Up II', 1]] }),
                snap(2, 'A', { buffs: [['Attack Up II', 3]] }),
            ]
        );
        expect(ids(result, 'status-duration-rises')).toEqual([]);
    });

    it('exempts buff rises on a buff extender side and debuff rises opposite a debuff extender', () => {
        const statuses = [
            snap(1, 'A', { buffs: [['Attack Up II', 1]], debuffs: [['Defense Down I', 1]] }),
            snap(1, 'B', { buffs: [['Attack Up II', 1]], debuffs: [['Defense Down I', 1]] }),
            snap(2, 'A', { buffs: [['Attack Up II', 2]], debuffs: [['Defense Down I', 2]] }),
            snap(2, 'B', { buffs: [['Attack Up II', 2]], debuffs: [['Defense Down I', 2]] }),
        ];
        const result = audited(twoRounds(), statuses);
        const extenders = new Map([['C', new Set<'buff' | 'debuff'>(['buff', 'debuff'])]]);
        const v = checkInvariants(result, { durationExtenders: extenders }).filter(
            (x) => x.invariant === 'status-duration-rises'
        );
        // A's buff (C's side) and B's debuff (C's opposition) are exempt; A's debuff and B's
        // buff are not.
        expect(v.map((x) => `${x.actorId}:${x.detail.split(' ')[0]}`).sort()).toEqual([
            'A:debuff',
            'B:buff',
        ]);
    });

    it('follows neither independently stacking nor persistent statuses', () => {
        expect(stacksIndependently('Repair Over Time II')).toBe(true);
        expect(isPersistentByName('Defense Shred')).toBe(true);
        const result = audited(twoRounds(), [
            snap(1, 'A', { buffs: [['Repair Over Time II', 1]], debuffs: [['Defense Shred', 1]] }),
            snap(2, 'A', { buffs: [['Repair Over Time II', 3]], debuffs: [['Defense Shred', 3]] }),
        ]);
        expect(ids(result, 'status-duration-rises')).toEqual([]);
    });

    it('checks nothing on a result with no audit trail', () => {
        const result = logResult(twoRounds());
        expect(allViolations(result)).toEqual([]);
    });
});

describe('checkInvariants — a held window never exceeds what was written', () => {
    const toRows = (pairs: [string, number][]) =>
        pairs.map(([buffName, turnsRemaining]) => ({ buffName, turnsRemaining }));
    /** `snap` plus the round's store writes. */
    const written = (
        n: number,
        actorId: string,
        statuses: { buffs?: [string, number][]; debuffs?: [string, number][] },
        writes: { buffs?: [string, number][]; debuffs?: [string, number][] }
    ): DurationSnap => ({
        ...snap(n, actorId, statuses),
        buffWrites: toRows(writes.buffs ?? []),
        debuffWrites: toRows(writes.debuffs ?? []),
    });
    const oneRound = [round(1, [turn('A', [])])];
    const twoRounds = [round(1, [turn('A', [])]), round(2, [turn('A', [])])];

    // The own-turn reprieve skips the holder's first Post-Turn countdown; a skip that also added a
    // turn leaves a fresh status one turn above the turns it was applied with.
    it('flags a status applied this round that holds more turns than it was written with', () => {
        const result = audited(oneRound, [
            written(1, 'A', { buffs: [['Stealth', 3]] }, { buffs: [['Stealth', 2]] }),
        ]);
        const v = ids(result, 'status-duration-rises');
        expect(v).toHaveLength(1);
        expect(v[0].detail).toContain('its longest write 2');
    });

    it('flags it on the debuff store just the same', () => {
        const result = audited(oneRound, [
            written(1, 'B', { debuffs: [['Speed Down I', 2]] }, { debuffs: [['Speed Down I', 1]] }),
        ]);
        expect(ids(result, 'status-duration-rises')).toHaveLength(1);
    });

    it('allows a status held at or below its write, and a refresh up to the longer write', () => {
        const result = audited(twoRounds, [
            written(1, 'A', { buffs: [['Stealth', 2]] }, { buffs: [['Stealth', 2]] }),
            written(
                2,
                'A',
                { buffs: [['Stealth', 2]] },
                {
                    buffs: [
                        ['Stealth', 1],
                        ['Stealth', 2],
                    ],
                }
            ),
        ]);
        expect(ids(result, 'status-duration-rises')).toEqual([]);
    });

    it('flags a rise an application row names but no store write backs', () => {
        const result = audited(
            [
                round(1, [turn('A', [])]),
                round(2, [turn('C', [noted('buff', 'C', ['A'], 'Attack Up II')])]),
            ],
            [
                written(1, 'A', { buffs: [['Attack Up II', 1]] }, {}),
                written(2, 'A', { buffs: [['Attack Up II', 3]] }, {}),
            ]
        );
        expect(ids(result, 'status-duration-rises')).toHaveLength(1);
    });

    it('reads nothing into a status with neither a prior window nor a write', () => {
        const result = audited(oneRound, [written(1, 'A', { buffs: [['Stealth', 9]] }, {})]);
        expect(ids(result, 'status-duration-rises')).toEqual([]);
    });

    it('still exempts a side fielding a duration extender', () => {
        const result = audited(oneRound, [
            written(1, 'A', { buffs: [['Stealth', 3]] }, { buffs: [['Stealth', 2]] }),
        ]);
        const extenders = new Map([['C', new Set<'buff' | 'debuff'>(['buff'])]]);
        const v = checkInvariants(result, { durationExtenders: extenders }).filter(
            (x) => x.invariant === 'status-duration-rises'
        );
        expect(v).toEqual([]);
    });
});

describe('checkInvariants — a lower tier never replaces a higher one', () => {
    const drop = (round2: CombatLogTurn[], heldTurns = 3): BattleResult =>
        audited(
            [round(1, [turn('A', [])]), round(2, round2)],
            [
                snap(1, 'A', { debuffs: [['Defense Down II', heldTurns]] }),
                snap(2, 'A', { debuffs: [['Defense Down I', 2]] }),
            ]
        );

    it('flags a tier drop while the higher copy still had turns left', () => {
        const result = drop([
            turn('A', []),
            turn('B', [noted('debuff', 'B', ['A'], 'Defense Down I')]),
        ]);
        const v = ids(result, 'status-tier-drop');
        expect(v).toHaveLength(1);
        expect(v[0]).toMatchObject({ round: 2, actorId: 'A' });
    });

    it('allows a tier drop once the higher copy ran out on the holder Post-Turns', () => {
        expect(ids(drop([turn('A', [])], 1), 'status-tier-drop')).toEqual([]);
    });

    it.each([
        ['an expiry row names it', entry('buff-expired', 'A')],
        ['a cleanse reached the holder', entry('cleanse', 'C', ['A'])],
        ['the holder cheated death', entry('cheat-death', 'A', ['A'])],
    ])('allows a tier drop when %s', (_, row) => {
        const expiry =
            row.kind === 'buff-expired' ? { ...row, note: 'Defense Down II expired' } : row;
        expect(ids(drop([turn('A', [expiry])]), 'status-tier-drop')).toEqual([]);
    });

    it('allows a tier drop when a cast cleanse reached the holder, read through buildCombatLog', () => {
        // The cleanse row comes from the engine's own event, not a hand-built entry, so the
        // invariant sees the recipients the log builder actually records.
        const roster = logResult([]).roster;
        const [round2] = buildCombatLog(
            [
                { type: 'round-started', round: 2 },
                { type: 'turn-started', actorId: 'A', round: 2 },
                { type: 'turn-ended', actorId: 'A', round: 2 },
                { type: 'turn-started', actorId: 'C', round: 2 },
                { type: 'cleanse-performed', casterId: 'C', count: 1, round: 2, targets: ['A'] },
                { type: 'turn-ended', actorId: 'C', round: 2 },
                { type: 'round-ended', round: 2 },
            ],
            roster,
            new Map()
        );
        expect(ids(drop(round2.turns), 'status-tier-drop')).toEqual([]);
    });
});

describe('checkInvariants — non-defence damage reduction is capped at 70%', () => {
    const hits = (...factors: number[]): BattleResult => ({
        ...logResult([]),
        audit: {
            statusDurations: [],
            hitIncomingFactors: factors.map((factor) => ({
                round: 1,
                attackerId: 'B',
                victimId: 'A',
                factor,
                block: 'none' as const,
            })),
        },
    });

    it('flags a hit priced below 0.30', () => {
        const v = ids(hits(0.3, 0.29, 1.2), 'incoming-reduction-cap');
        expect(v).toHaveLength(1);
        expect(v[0].actorId).toBe('A');
    });

    it('holds a hit on the floor, float noise included', () => {
        expect(ids(hits(0.3, 0.3 - 1e-12), 'incoming-reduction-cap')).toEqual([]);
    });
});

describe('durationExtenderKinds', () => {
    it('names the ships whose kit extends a buff or a debuff duration', () => {
        expect([...shipDurationExtensionKinds(buildTraceShip('Ripper') as Ship)]).toEqual(['buff']);
        expect([...shipDurationExtensionKinds(buildTraceShip('Lev') as Ship)]).toEqual(['debuff']);
        expect(shipDurationExtensionKinds(buildTraceShip('Demolisher') as Ship).size).toBe(0);
        const input: BattleSimulationInput = {
            playerTeam: [canonicalPlacement(buildTraceShip('Ripper') as Ship, 'T1')],
            enemyTeam: [canonicalPlacement(buildTraceShip('Demolisher') as Ship, 'M2')],
            rounds: 1,
        };
        const result = runSeededBattle(input, 1);
        const kinds = durationExtenderKinds(input, result);
        expect([...kinds.keys()]).toEqual([result.roster[0].actorId]);
    });
});

describe('checkInvariants vs checkOpenInvariants', () => {
    it('reports each open invariant only through checkOpenInvariants', () => {
        const killD = (): CombatLogTurn =>
            turn('C', [entry('death', 'D', ['C'], [entry('attack', 'C', ['D'])])]);
        const result = logResult([round(1, [killB(), killD()], [], [entry('buff', 'C', ['C'])])]);
        const open = checkOpenInvariants(result).map((v) => v.invariant);
        expect(open).toEqual(['entry-after-wipe']);
        expect(open.every((id) => OPEN_INVARIANTS.has(id))).toBe(true);
        expect(checkInvariants(result).filter((v) => OPEN_INVARIANTS.has(v.invariant))).toEqual([]);
    });

    it('gates the corpse invariants: checkInvariants reports them', () => {
        const result = logResult([
            round(1, [killB(), turn('C', [entry('attack', 'C', ['B'])]), turn('D', [])], [], []),
            round(2, [], [entry('buff', 'B', ['B']), entry('heal', 'C', ['B'])]),
        ]);
        const gated = checkInvariants(result).map((v) => v.invariant);
        expect(gated).toContain('corpse-hostile-target');
        expect(gated).toContain('corpse-acts');
        expect(gated).toContain('corpse-ally-grant');
        expect(checkOpenInvariants(result)).toEqual([]);
    });
});
