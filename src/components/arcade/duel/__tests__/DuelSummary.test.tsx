import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuelSummary } from '../DuelSummary';
import { DUEL_RESULT_HOLD_MS } from '../stakesText';
import { MAX_PLAYBACK_SECONDS, type DuelBeat, type DuelSideState } from '../duelPlayback';
import type { DuelResult } from '../runDuel';
import type { DuelEffect } from '../../../../utils/arcade/types';

const player = { name: 'Nova', level: 60, imageUrl: null };
const opponent = { name: 'Rook', level: 60, imageUrl: null };

const sideState = (s: Partial<DuelSideState> = {}): DuelSideState => ({
    hpPct: 100,
    shieldPct: 0,
    buffs: [],
    debuffs: [],
    alive: true,
    charge: null,
    ...s,
});
const beat = (b: Partial<DuelBeat> = {}): DuelBeat => ({
    round: 1,
    actor: 'player',
    charged: null,
    hits: [],
    player: sideState(),
    enemy: sideState(),
    ...b,
});

const result: DuelResult = {
    outcome: 'win',
    beats: Array.from({ length: 11 }, (_, i) =>
        beat({
            round: Math.floor(i / 2) + 1,
            actor: i % 2 === 0 ? 'player' : 'enemy',
            player: sideState({ hpPct: 100 - i * 2 }),
            enemy: sideState({ hpPct: 100 - i * 9 }),
        })
    ),
};
/** Longer than the playback of any fight. */
const PLAYBACK_MS = MAX_PLAYBACK_SECONDS * 1000 + 500;

function show(effect: DuelEffect | null, onDone: () => void, r: DuelResult = result) {
    return render(
        <DuelSummary
            player={player}
            opponent={opponent}
            stakes="power-up"
            result={r}
            effect={effect}
            onDone={onDone}
        />
    );
}

const space = () => fireEvent.keyDown(window, { key: ' ', code: 'Space' });

const fakeTimers = () => {
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
};

describe('DuelSummary auto-advance', () => {
    fakeTimers();

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

describe('DuelSummary playback', () => {
    fakeTimers();

    it('plays one turn every half second', () => {
        const { getByText, getByRole } = show({ kind: 'shield' }, vi.fn());
        const hull = () => getByRole('progressbar', { name: 'Rook hull' });
        act(() => void vi.advanceTimersByTime(100));
        expect(hull()).toHaveAttribute('aria-valuenow', '100');
        act(() => void vi.advanceTimersByTime(500));
        expect(hull()).toHaveAttribute('aria-valuenow', '91');
        act(() => void vi.advanceTimersByTime(500));
        expect(hull()).toHaveAttribute('aria-valuenow', '82');
        expect(getByText('Round 2')).toBeInTheDocument();
    });

    it('a long fight shrinks every turn so the playback ends within the cap', () => {
        const long: DuelResult = {
            outcome: 'win',
            beats: Array.from({ length: 60 }, () => beat()),
        };
        const { queryByText } = show({ kind: 'shield' }, vi.fn(), long);
        act(() => void vi.advanceTimersByTime(MAX_PLAYBACK_SECONDS * 1000 - 300));
        expect(queryByText('Victory')).toBeNull();
        act(() => void vi.advanceTimersByTime(400));
        expect(queryByText('Victory')).toBeInTheDocument();
    });

    it('shows a shield bar only while the ship has a shield', () => {
        const r: DuelResult = {
            outcome: 'win',
            beats: [
                beat({ player: sideState({ shieldPct: 40 }) }),
                beat({ player: sideState({ shieldPct: 0 }) }),
            ],
        };
        const { getByRole, getByText, queryByText } = show({ kind: 'shield' }, vi.fn(), r);
        act(() => void vi.advanceTimersByTime(100));
        const bar = getByRole('progressbar', { name: 'Nova shield' });
        expect(bar).toHaveAttribute('aria-valuenow', '40');
        expect(bar.parentElement).not.toHaveClass('invisible');
        expect(getByText('40% shield')).toBeInTheDocument();
        expect(getByRole('progressbar', { name: 'Rook shield' }).parentElement).toHaveClass(
            'invisible'
        );
        act(() => void vi.advanceTimersByTime(500));
        expect(getByRole('progressbar', { name: 'Nova shield' }).parentElement).toHaveClass(
            'invisible'
        );
        expect(queryByText('40% shield')).toBeNull();
    });

    it('lists buffs and debuffs, folding the overflow into +N', () => {
        const r: DuelResult = {
            outcome: 'win',
            beats: [
                beat({
                    player: sideState({
                        buffs: ['Attack Up III', 'Hacking Up III', 'Overclock III', 'Stealth'],
                        debuffs: ['Provoke'],
                    }),
                }),
            ],
        };
        const { getByRole } = show({ kind: 'shield' }, vi.fn(), r);
        act(() => void vi.advanceTimersByTime(100));
        const buffs = getByRole('list', { name: 'Nova buffs' });
        const items = within(buffs).getAllByRole('listitem');
        expect(items.map((i) => i.textContent)).toEqual(['Attack Up III', 'Hacking Up III', '+2']);
        expect(items[2]).toHaveAttribute('title', 'Overclock III, Stealth');
        expect(
            within(getByRole('list', { name: 'Nova debuffs' }))
                .getAllByRole('listitem')
                .map((i) => i.textContent)
        ).toEqual(['Provoke']);
        expect(
            within(getByRole('list', { name: 'Rook buffs' })).queryAllByRole('listitem')
        ).toEqual([]);
    });

    it("floats each turn's numbers over the ship they landed on, then none on the outcome", () => {
        const r: DuelResult = {
            outcome: 'win',
            beats: [
                beat({
                    hits: [
                        { side: 'enemy', kind: 'damage', amount: 1234.4, crit: true },
                        { side: 'enemy', kind: 'damage', amount: 98765, crit: false },
                        { side: 'player', kind: 'shield', amount: 500, crit: false },
                    ],
                }),
                beat({
                    actor: 'enemy',
                    hits: [
                        { side: 'player', kind: 'miss', amount: 0, crit: false },
                        { side: 'enemy', kind: 'heal', amount: 2500, crit: false },
                    ],
                }),
            ],
        };
        const { getByText, queryAllByTestId } = show({ kind: 'shield' }, vi.fn(), r);
        act(() => void vi.advanceTimersByTime(100));
        expect(getByText('1,234!')).toHaveClass('arcade-duel-float', 'text-2xl');
        expect(getByText('98,765')).not.toHaveClass('text-2xl');
        expect(getByText('+500')).toHaveClass('text-sky-300');
        expect(getByText('1,234!').closest('.relative')).toHaveTextContent('Rook');
        expect(getByText('+500').closest('.relative')).toHaveTextContent('Nova');
        act(() => void vi.advanceTimersByTime(500));
        expect(getByText('MISS')).toBeInTheDocument();
        expect(getByText('+2,500')).toHaveClass('text-green-400');
        // The previous turn's numbers are still finishing their rise.
        expect(getByText('1,234!')).toBeInTheDocument();
        act(() => void vi.advanceTimersByTime(PLAYBACK_MS));
        expect(queryAllByTestId('duel-hit')).toEqual([]);
    });

    it('flags a charged skill on the side that fired it, by name when the log has one', () => {
        const r: DuelResult = {
            outcome: 'win',
            beats: [
                beat({ actor: 'player', charged: {} }),
                beat({ actor: 'enemy' }),
                beat({ actor: 'enemy', charged: { skillName: 'Overload' } }),
            ],
        };
        const { getByText, queryByRole, getByRole } = show({ kind: 'shield' }, vi.fn(), r);
        act(() => void vi.advanceTimersByTime(100));
        expect(getByRole('status')).toHaveTextContent('CHARGED SKILL');
        act(() => void vi.advanceTimersByTime(500));
        expect(queryByRole('status')).toBeNull();
        act(() => void vi.advanceTimersByTime(500));
        expect(getByText('CHARGED: Overload')).toBeInTheDocument();
    });

    it('fills the charge meter from the latest turn start', () => {
        const r: DuelResult = {
            outcome: 'win',
            beats: [beat({ player: sideState({ charge: { value: 1, max: 4 } }) })],
        };
        const { getByRole } = show({ kind: 'shield' }, vi.fn(), r);
        act(() => void vi.advanceTimersByTime(100));
        expect(getByRole('progressbar', { name: 'Nova charge' })).toHaveAttribute(
            'aria-valuenow',
            '25'
        );
        expect(getByRole('progressbar', { name: 'Rook charge' }).parentElement).toHaveClass(
            'invisible'
        );
    });
});
