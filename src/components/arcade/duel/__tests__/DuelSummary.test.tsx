import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuelSummary } from '../DuelSummary';
import { DUEL_RESULT_HOLD_MS } from '../stakesText';
import type { DuelResult } from '../runDuel';
import type { DuelEffect } from '../../../../utils/arcade/types';

const side = { name: 'Ship', level: 60, imageUrl: null };
const result: DuelResult = {
    outcome: 'win',
    timeline: Array.from({ length: 11 }, (_, i) => ({
        round: i,
        playerHpPct: 100 - i * 2,
        enemyHpPct: 100 - i * 9,
    })),
};
/** Longer than the playback of any timeline. */
const PLAYBACK_MS = 6000;

function show(effect: DuelEffect | null, onDone: () => void) {
    return render(
        <DuelSummary
            player={side}
            opponent={side}
            stakes="power-up"
            result={result}
            effect={effect}
            onDone={onDone}
        />
    );
}

const space = () => fireEvent.keyDown(window, { key: ' ', code: 'Space' });

describe('DuelSummary auto-advance', () => {
    beforeEach(() => {
        vi.useFakeTimers({
            toFake: [
                'setTimeout',
                'clearTimeout',
                'requestAnimationFrame',
                'cancelAnimationFrame',
                'performance',
            ],
        });
        vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('holds the outcome after the playback, then moves on once', () => {
        const onDone = vi.fn();
        const { getByText } = show({ kind: 'shield' }, onDone);
        act(() => void vi.advanceTimersByTime(PLAYBACK_MS));
        expect(getByText('Victory')).toBeInTheDocument();
        expect(onDone).not.toHaveBeenCalled();
        act(() => void vi.advanceTimersByTime(DUEL_RESULT_HOLD_MS - 50));
        expect(onDone).not.toHaveBeenCalled();
        act(() => void vi.advanceTimersByTime(100));
        expect(onDone).toHaveBeenCalledTimes(1);
        act(() => void vi.advanceTimersByTime(DUEL_RESULT_HOLD_MS * 3));
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('closes as soon as the playback ends when the loss ends the run', () => {
        const onDone = vi.fn();
        const { queryByText } = show({ kind: 'game-over' }, onDone);
        act(() => void vi.advanceTimersByTime(PLAYBACK_MS));
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(queryByText('Victory')).toBeNull();
    });

    it('never moves on after it is unmounted', () => {
        const onDone = vi.fn();
        const { unmount } = show({ kind: 'shield' }, onDone);
        act(() => void vi.advanceTimersByTime(PLAYBACK_MS));
        unmount();
        act(() => void vi.advanceTimersByTime(DUEL_RESULT_HOLD_MS * 3));
        expect(onDone).not.toHaveBeenCalled();
    });

    it('moves on at once when Space is pressed on the outcome', () => {
        const onDone = vi.fn();
        show({ kind: 'shield' }, onDone);
        act(() => void vi.advanceTimersByTime(PLAYBACK_MS));
        act(() => void space());
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('skips the playback to the outcome on the first Space', () => {
        const onDone = vi.fn();
        const { getByText } = show({ kind: 'shield' }, onDone);
        act(() => void vi.advanceTimersByTime(500));
        act(() => void space());
        expect(getByText('Victory')).toBeInTheDocument();
        expect(onDone).not.toHaveBeenCalled();
    });
});
