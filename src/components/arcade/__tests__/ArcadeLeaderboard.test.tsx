import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ArcadeLeaderboardEntry } from '../../../utils/arcade/leaderboardRows';
import { ArcadeLeaderboard } from '../ArcadeLeaderboard';

const { rows, guestRows } = vi.hoisted(() => ({
    guestRows: [
        { rank: 1, username: 'Ace', bestScore: 900, isMe: false, ship: null, isGuest: false },
        { rank: 1, username: 'Ace', bestScore: 900, isMe: false, ship: null, isGuest: true },
        { rank: 3, username: 'Bo', bestScore: 700, isMe: false, ship: null, isGuest: false },
        { rank: 4, username: 'Cy', bestScore: 600, isMe: false, ship: null, isGuest: true },
    ].map((r) => ({
        distance: null,
        credits: null,
        ...r,
    })),
    rows: [
        { rank: 1, username: 'Ace', bestScore: 900, isMe: false, ship: 'Nayra', isGuest: false },
        { rank: 2, username: 'Bee', bestScore: 800, isMe: false, ship: null, isGuest: false },
        {
            rank: 3,
            username: 'Cee',
            bestScore: 700,
            isMe: false,
            ship: 'Unknown Ship',
            isGuest: false,
        },
        { rank: 4, username: 'Dee', bestScore: 600, isMe: false, ship: 'Nayra', isGuest: false },
        { rank: 5, username: 'Eve', bestScore: 500, isMe: false, ship: null, isGuest: false },
    ].map((r) => ({
        distance: null,
        credits: null,
        ...r,
    })),
}));

vi.mock('../../../hooks/useShipsData', () => ({
    useShipsData: () => ({ ships: [{ name: 'Nayra', imageKey: 'nayra_key' }] }),
}));
vi.mock('../../ui/Image', () => ({
    Image: ({ src, alt }: { src: string; alt?: string }) => <img src={src} alt={alt} />,
}));

const rowOf = (username: string) => screen.getByText(username).closest('tr') as HTMLElement;
const podiumOf = (username: string) => screen.getByText(username).closest('.card') as HTMLElement;

const board = (
    data: ArcadeLeaderboardEntry[],
    extra: Partial<React.ComponentProps<typeof ArcadeLeaderboard>> = {}
) => <ArcadeLeaderboard rows={data} loading={false} failed={false} onRetry={() => {}} {...extra} />;

describe('ArcadeLeaderboard ship', () => {
    it('shows the pilot portrait and name of a resolved ship in the list', async () => {
        render(board(rows));
        await screen.findByText('Dee');
        const row = within(rowOf('Dee'));
        expect(row.getByText('Nayra')).toBeTruthy();
        expect(
            row.getByText('Nayra').closest('tr')!.querySelector('img')!.getAttribute('src')
        ).toBe('nayra_key_Portrait.jpg');
    });

    it('shows nothing extra for a neon-fighter row', async () => {
        render(board(rows));
        await screen.findByText('Eve');
        const row = rowOf('Eve');
        expect(row.querySelector('img')).toBeNull();
        expect(row.textContent).toBe('#5Eve500\u2013 \u00b7 \u2013\u2013\u2013');
    });

    it('shows the ship on the podium', async () => {
        render(board(rows));
        await screen.findByText('Ace');
        const card = within(podiumOf('Ace'));
        expect(card.getByText('Nayra')).toBeTruthy();
        expect(podiumOf('Ace').querySelector('img')!.getAttribute('src')).toBe(
            'nayra_key_Portrait.jpg'
        );
        expect(podiumOf('Bee').querySelector('img')).toBeNull();
    });

    it('shows the name only when the ship does not resolve to a template', async () => {
        render(board(rows));
        await screen.findByText('Cee');
        const card = within(podiumOf('Cee'));
        expect(card.getByText('Unknown Ship')).toBeTruthy();
        expect(podiumOf('Cee').querySelector('img')).toBeNull();
    });

    it('gives every podium card the same subtitle slot, filled or empty', async () => {
        render(board(rows));
        await screen.findByText('Bee');
        const slots = ['Ace', 'Bee', 'Cee'].map((n) =>
            podiumOf(n).querySelector('span.h-5.w-full')
        );
        expect(slots.every((s) => s !== null)).toBe(true);
        expect(slots[1]!.textContent).toBe('');
    });
});

describe('ArcadeLeaderboard guests', () => {
    it('tags guest rows on the podium and in the table without duplicate keys', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(board(guestRows));
        const tags = await screen.findAllByText('GUEST');
        expect(tags).toHaveLength(2);
        expect(tags.filter((t) => !t.closest('tr'))).toHaveLength(1);
        expect(tags.filter((t) => t.closest('tr'))).toHaveLength(1);
        const keyWarnings = errorSpy.mock.calls.filter((call) =>
            call.some((arg) => typeof arg === 'string' && arg.includes('same key'))
        );
        expect(keyWarnings).toHaveLength(0);
        errorSpy.mockRestore();
    });
});

describe('ArcadeLeaderboard distance and credits', () => {
    const withRun: ArcadeLeaderboardEntry[] = [
        ...rows.slice(0, 3),
        { ...rows[3], distance: 6420, credits: 312 },
        { ...rows[4], distance: null, credits: 5 },
    ];
    // Podium Ace has a run
    withRun[0] = { ...rows[0], distance: 11200, credits: 604 };

    it('shows distance and credits on the podium and in the table', async () => {
        render(board(withRun));
        await screen.findByText('Dee');
        expect(within(podiumOf('Ace')).getByText('11,200 m \u00b7 604 credits')).toBeTruthy();
        const cells = Array.from(rowOf('Dee').querySelectorAll('td')).map((c) => c.textContent);
        expect(cells).toContain('6,420 m');
        expect(cells).toContain('312 credits');
    });
    it('renders a missing value as a dash', async () => {
        render(board(withRun));
        await screen.findByText('Eve');
        const cells = Array.from(rowOf('Eve').querySelectorAll('td')).map((c) => c.textContent);
        expect(cells).toContain('\u2013');
        expect(cells).toContain('5 credits');
    });
    it('hides the separate columns below sm and repeats the run under the score', async () => {
        render(board(withRun));
        await screen.findByText('Dee');
        const hidden = Array.from(rowOf('Dee').querySelectorAll('td.hidden'));
        expect(hidden).toHaveLength(2);
        expect(
            screen
                .getAllByText('6,420 m \u00b7 312 credits')
                .some((e) => e.className.includes('sm:hidden'))
        ).toBe(true);
    });
});

describe('ArcadeLeaderboard states', () => {
    it('offers Retry on failure', () => {
        const onRetry = vi.fn();
        render(board([], { failed: true, onRetry }));
        fireEvent.click(screen.getByText('Retry'));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
    it('shows the empty message when there are no scores', () => {
        render(board([]));
        expect(screen.getByText('No scores yet. Be the first.')).toBeTruthy();
    });
});
