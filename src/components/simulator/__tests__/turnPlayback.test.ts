import { describe, expect, it } from 'vitest';
import type { FightBeat } from '../../board/fightBeats';
import type { BattleResult } from '../../../utils/calculators/battleSimulator';
import type { CombatLogEntry } from '../../../utils/combat/log/types';
import {
    beatsByRound,
    nextPlayhead,
    playStart,
    prevPlayhead,
    shownBeat,
    statusSource,
    statusSources,
    targetLines,
    type Playhead,
} from '../turnPlayback';

const beat = (round: number) => ({ round }) as FightBeat;

// Round 1 has two turns, round 2 none (nobody acted), round 3 one.
const beats = [beat(1), beat(1), beat(3)];
const byRound = beatsByRound(beats);
const TOTAL = 3;

const p = (round: number, turn: number | null): Playhead => ({ round, turn });

describe('turnPlayback', () => {
    it('groups beats by round', () => {
        expect(byRound.get(1)).toEqual([0, 1]);
        expect(byRound.get(2)).toBeUndefined();
        expect(byRound.get(3)).toEqual([2]);
    });

    it('next: through the turns, across a round without beats, then null at the end', () => {
        expect(nextPlayhead(p(1, 0), byRound, TOTAL)).toEqual(p(1, 1));
        expect(nextPlayhead(p(1, 1), byRound, TOTAL)).toEqual(p(2, null));
        // A round's end counts as its last turn.
        expect(nextPlayhead(p(1, null), byRound, TOTAL)).toEqual(p(2, null));
        expect(nextPlayhead(p(2, null), byRound, TOTAL)).toEqual(p(3, 0));
        expect(nextPlayhead(p(3, 0), byRound, TOTAL)).toBeNull();
    });

    it('prev: back through the turns into the previous round’s last, then null at the start', () => {
        expect(prevPlayhead(p(3, 0), byRound)).toEqual(p(2, null));
        expect(prevPlayhead(p(2, null), byRound)).toEqual(p(1, 1));
        expect(prevPlayhead(p(1, null), byRound)).toEqual(p(1, 0));
        expect(prevPlayhead(p(1, 0), byRound)).toBeNull();
    });

    it('play starts a round from its first turn, plays on mid-round, and replays a finished fight', () => {
        expect(playStart(p(1, null), byRound, TOTAL)).toEqual(p(1, 0));
        expect(playStart(p(1, 0), byRound, TOTAL)).toEqual(p(1, 1));
        expect(playStart(p(2, null), byRound, TOTAL)).toEqual(p(3, 0));
        expect(playStart(p(3, 0), byRound, TOTAL)).toEqual(p(1, 0));
    });

    it('shows the turn’s beat, the last one at a round’s end, and none for an empty round', () => {
        expect(shownBeat(p(1, 0), byRound)).toBe(0);
        expect(shownBeat(p(1, null), byRound)).toBe(1);
        expect(shownBeat(p(2, null), byRound)).toBeNull();
    });
});

describe('targetLines', () => {
    const ship = (position: string) => ({ position }) as FightBeat['player'][number];
    const acting = {
        round: 1,
        actor: 'player',
        actorShip: 1,
        player: [ship('T1'), ship('M2')],
        enemy: [ship('T1'), ship('B3')],
        targets: [
            { side: 'enemy', ship: 1, role: 'main' },
            { side: 'enemy', ship: 0, role: 'splash' },
        ],
    } as FightBeat;

    it('runs from the acting ship’s cell to each target’s cell, with its role', () => {
        expect(targetLines(acting)).toEqual([
            {
                role: 'main',
                from: { side: 'player', cell: 'M2' },
                to: { side: 'enemy', cell: 'B3' },
            },
            {
                role: 'splash',
                from: { side: 'player', cell: 'M2' },
                to: { side: 'enemy', cell: 'T1' },
            },
        ]);
    });

    it('draws nothing for a beat with no actor or no targets', () => {
        expect(targetLines({ ...acting, actor: null })).toEqual([]);
        expect(targetLines({ ...acting, targets: [] })).toEqual([]);
        expect(targetLines({ ...acting, targets: undefined })).toEqual([]);
        expect(targetLines(undefined)).toEqual([]);
    });

    it('skips a line from a ship to its own cell', () => {
        const self = {
            ...acting,
            targets: [{ side: 'player', ship: 1, role: 'main' }],
        } as FightBeat;
        expect(targetLines(self)).toEqual([]);
    });
});

describe('statusSources', () => {
    const entry = (
        kind: CombatLogEntry['kind'],
        actorId: string,
        holder: string,
        note: string,
        extra: Partial<CombatLogEntry> = {}
    ): CombatLogEntry => ({
        kind,
        actorId,
        targets: [{ targetId: holder }],
        reactions: [],
        note,
        ...extra,
    });
    const result = (rounds: CombatLogEntry[][]) =>
        ({
            outcome: { winner: 'player', lastRound: rounds.length },
            roster: [],
            rounds: [],
            combatLog: rounds.map((entries, i) => ({
                round: i + 1,
                startOfRound: [],
                turns: [{ actorId: 'a', chargeBefore: 0, chargeMax: 0, entries }],
                endOfRound: [],
            })),
        }) as unknown as BattleResult;

    it('names the granter of a buff or the applier of a debuff', () => {
        const sources = statusSources(
            result([
                [
                    entry('buff', 'ally', 'me', 'Attack Up II'),
                    entry('debuff', 'foe', 'me', 'Defense Down I'),
                    entry('dot-applied', 'foe2', 'me', 'corrosion III ×2'),
                ],
            ]),
            1
        );
        expect(statusSource(sources, 'me', 'Attack Up II')).toBe('ally');
        expect(statusSource(sources, 'me', 'Defense Down I')).toBe('foe');
        expect(statusSource(sources, 'me', 'Corrosion')).toBe('foe2');
    });

    it('reads a self-grant as the holder’s own id, and an unknown status as none', () => {
        const sources = statusSources(result([[entry('buff', 'me', 'me', 'Provoke')]]), 1);
        expect(statusSource(sources, 'me', 'Provoke')).toBe('me');
        expect(statusSource(sources, 'me', 'Stealth')).toBeUndefined();
        expect(statusSource(sources, 'someone else', 'Provoke')).toBeUndefined();
    });

    it('falls back to the tier-stripped name, exact name first', () => {
        const sources = statusSources(
            result([
                [
                    entry('buff', 'weak', 'me', 'Attack Up I'),
                    entry('buff', 'exact', 'me', 'Attack Up III'),
                ],
            ]),
            1
        );
        expect(statusSource(sources, 'me', 'Attack Up III')).toBe('exact');
        expect(statusSource(sources, 'me', 'Attack Up II')).toBe('exact');
        const lone = statusSources(result([[entry('buff', 'weak', 'me', 'Attack Up I')]]), 1);
        expect(statusSource(lone, 'me', 'Attack Up II')).toBe('weak');
    });

    it('lets the latest application win, including a nested reaction, and skips attempts', () => {
        const reacted = entry('buff', 'first', 'me', 'Shield Up', {
            reactions: [entry('buff', 'reactor', 'me', 'Shield Up')],
        });
        const sources = statusSources(
            result([
                [reacted, entry('buff', 'outclassed', 'me', 'Shield Up', { attemptOnly: true })],
            ]),
            1
        );
        expect(statusSource(sources, 'me', 'Shield Up')).toBe('reactor');
    });

    it('never reads a round past the one asked for', () => {
        const fight = result([
            [entry('buff', 'early', 'me', 'Attack Up II')],
            [entry('buff', 'late', 'me', 'Attack Up II')],
        ]);
        expect(statusSource(statusSources(fight, 1), 'me', 'Attack Up II')).toBe('early');
        expect(statusSource(statusSources(fight, 2), 'me', 'Attack Up II')).toBe('late');
        expect(statusSource(statusSources(fight, 0), 'me', 'Attack Up II')).toBeUndefined();
    });
});
