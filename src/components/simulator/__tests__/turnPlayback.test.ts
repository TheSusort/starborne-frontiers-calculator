import { describe, expect, it } from 'vitest';
import type { FightBeat } from '../../board/fightBeats';
import {
    beatsByRound,
    nextPlayhead,
    playStart,
    prevPlayhead,
    shownBeat,
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
