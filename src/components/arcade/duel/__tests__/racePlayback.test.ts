import { describe, expect, it } from 'vitest';
import type { RaceResult } from '../challengeResult';
import { MAX_PLAYBACK_SECONDS } from '../duelPlayback';
import {
    RACE_ROUND_SECONDS,
    raceBarFill,
    raceFigureAt,
    raceFigureLabel,
    raceFigureText,
    raceRoundSeconds,
    raceStamp,
} from '../racePlayback';

const race = (
    kind: RaceResult['kind'],
    flown: number[],
    rival: number[],
    outcome: RaceResult['outcome'] = 'win'
): RaceResult => ({
    kind,
    outcome,
    flown: { byRound: flown, total: flown.at(-1) ?? 0 },
    rival: { byRound: rival, total: rival.at(-1) ?? 0 },
});

describe('racePlayback', () => {
    it('plays a round a second, and a five-round race well inside the playback cap', () => {
        expect(raceRoundSeconds(5)).toBe(RACE_ROUND_SECONDS);
        expect(raceRoundSeconds(5) * 5).toBeLessThanOrEqual(MAX_PLAYBACK_SECONDS);
        expect(raceRoundSeconds(40) * 40).toBeLessThanOrEqual(MAX_PLAYBACK_SECONDS);
        expect(raceRoundSeconds(0)).toBe(0);
    });

    it('labels and formats each race figure', () => {
        expect(raceFigureLabel('dps')).toBe('Damage dealt');
        expect(raceFigureLabel('heal')).toBe('Healing done');
        expect(raceFigureLabel('tank')).toBe('HP left');
        expect(raceFigureText('dps', 12345.6)).toBe('12,346');
        expect(raceFigureText('tank', 42.4)).toBe('42%');
    });

    it('reads the figure after each round, 0 before the first and the last one past the end', () => {
        const side = { byRound: [10, 30, 60], total: 60 };
        expect(raceFigureAt(side, 0)).toBe(0);
        expect(raceFigureAt(side, 2)).toBe(30);
        expect(raceFigureAt(side, 9)).toBe(60);
        expect(raceFigureAt({ byRound: [], total: 0 }, 1)).toBe(0);
    });

    it('fills damage and healing against the leader, HP left as itself, and never NaN', () => {
        const dps = race('dps', [100, 200], [50, 400], 'lose');
        expect(raceBarFill(dps, 400)).toBe(100);
        expect(raceBarFill(dps, 200)).toBe(50);
        expect(raceBarFill(race('tank', [80, 60], [90, 70]), 60)).toBe(60);
        expect(raceBarFill(race('heal', [0, 0], [0, 0]), 0)).toBe(0);
    });

    it('stamps the winner WIN and the other LOSE, and nothing on a skipped race', () => {
        expect(raceStamp(race('dps', [1], [1], 'win'), 'flown')).toBe('WIN');
        expect(raceStamp(race('dps', [1], [1], 'win'), 'rival')).toBe('LOSE');
        expect(raceStamp(race('dps', [1], [2], 'lose'), 'flown')).toBe('LOSE');
        expect(raceStamp(race('dps', [], [], 'skipped'), 'rival')).toBeNull();
    });
});
