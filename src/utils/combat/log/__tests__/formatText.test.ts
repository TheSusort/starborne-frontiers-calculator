import { describe, expect, it } from 'vitest';
import { formatCombatLogText, type LogRosterEntry } from '../formatText';
import type { CombatLogRound } from '../types';

const roster: LogRosterEntry[] = [
    { actorId: 'p1', side: 'player', name: 'Alpha', position: 'T1' },
    { actorId: 'e1', side: 'enemy', name: 'Beta', position: 'M2' },
];

const snapshot = {
    attack: 1,
    defence: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    speed: 100,
    hacking: 0,
    security: 0,
    currentHp: 1000.4,
    maxHp: 2000,
    shieldPool: 0,
};

const snapshotWithShield = { ...snapshot, currentHp: 400, maxHp: 800, shieldPool: 150.6 };

const log: CombatLogRound[] = [
    {
        round: 1,
        startOfRound: [
            {
                kind: 'buff',
                actorId: 'e1',
                note: 'Stealth',
                targets: [{ targetId: 'e1' }],
                reactions: [],
            },
        ],
        turns: [
            {
                actorId: 'p1',
                chargeBefore: 0,
                chargeMax: 3,
                statsSnapshot: snapshot,
                entries: [
                    {
                        kind: 'attack',
                        actorId: 'p1',
                        skillName: 'Strike',
                        slot: 'active',
                        targets: [
                            {
                                targetId: 'e1',
                                amount: 1234.6,
                                didCrit: true,
                                didHit: true,
                                resultingHpPct: 61.7,
                            },
                        ],
                        reactions: [
                            {
                                kind: 'heal',
                                actorId: 'e1',
                                targets: [{ targetId: 'e1', amount: 0, overheal: 500.2 }],
                                reactions: [
                                    {
                                        kind: 'charge-changed',
                                        actorId: 'p1',
                                        note: 'charge 0→1 (manip)',
                                        targets: [],
                                        reactions: [],
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        kind: 'attack',
                        actorId: 'p1',
                        targets: [{ targetId: 'ghost', amount: 10, didHit: false }],
                        reactions: [],
                    },
                    {
                        kind: 'death',
                        actorId: 'e1',
                        targets: [{ targetId: 'p1' }],
                        reactions: [],
                    },
                ],
            },
            {
                actorId: 'e1',
                chargeBefore: 1,
                chargeMax: 0,
                statsSnapshot: snapshotWithShield,
                entries: [
                    {
                        kind: 'shield',
                        actorId: 'e1',
                        targets: [
                            { targetId: 'e1', amount: 300, overshield: 50, shieldWasHit: true },
                        ],
                        reactions: [],
                    },
                ],
            },
        ],
        endOfRound: [
            {
                kind: 'reversed-repair',
                actorId: 'e1',
                healerId: 'p1',
                targets: [{ targetId: 'p1', amount: 99.5 }],
                reactions: [],
            },
        ],
    },
];

describe('formatCombatLogText', () => {
    it('renders rounds, turns, targets and nested reactions as indented lines', () => {
        expect(formatCombatLogText(log, roster)).toBe(
            [
                '=== ROUND 1',
                '  [start] buff E.Beta@M2 {Stealth} -> E.Beta@M2',
                '-- TURN P.Alpha@T1 charge 0/3 hp 1000/2000',
                '  attack P.Alpha@T1 "Strike" (active) -> E.Beta@M2 1235 crit [62%]',
                '    heal E.Beta@M2 -> E.Beta@M2 0 overheal 500',
                '      charge-changed P.Alpha@T1 {charge 0→1 (manip)}',
                '  attack P.Alpha@T1 -> ghost 10 miss',
                '  death E.Beta@M2 killed by P.Alpha@T1',
                '-- TURN E.Beta@M2 hp 400/800 shield 151',
                '  shield E.Beta@M2 -> E.Beta@M2 300 overshield 50 shield hit',
                '  [end] reversed-repair E.Beta@M2 healer P.Alpha@T1 -> P.Alpha@T1 100',
                '',
            ].join('\n')
        );
    });

    it('renders an empty log as an empty string', () => {
        expect(formatCombatLogText([], roster)).toBe('');
    });
});
