import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ArcadeLeaderboardEntry } from '../../../utils/arcade/leaderboardRows';
import { ArcadeLeaderboard } from '../ArcadeLeaderboard';

const { rows } = vi.hoisted(() => ({
    rows: [
        { rank: 1, username: 'Ace', bestScore: 900, isMe: false, ship: 'Nayra' },
        { rank: 2, username: 'Bee', bestScore: 800, isMe: false, ship: null },
        { rank: 3, username: 'Cee', bestScore: 700, isMe: false, ship: 'Unknown Ship' },
        { rank: 4, username: 'Dee', bestScore: 600, isMe: false, ship: 'Nayra' },
        { rank: 5, username: 'Eve', bestScore: 500, isMe: false, ship: null },
    ] as ArcadeLeaderboardEntry[],
}));

vi.mock('../../../services/arcadeService', () => ({
    getArcadeLeaderboard: () => Promise.resolve(rows),
}));
vi.mock('../../../contexts/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../../hooks/useShipsData', () => ({
    useShipsData: () => ({ ships: [{ name: 'Nayra', imageKey: 'nayra_key' }] }),
}));
vi.mock('../../ui/Image', () => ({
    Image: ({ src, alt }: { src: string; alt?: string }) => <img src={src} alt={alt} />,
}));

const rowOf = (username: string) => screen.getByText(username).closest('tr') as HTMLElement;
const podiumOf = (username: string) => screen.getByText(username).closest('.card') as HTMLElement;

describe('ArcadeLeaderboard ship', () => {
    it('shows the pilot portrait and name of a resolved ship in the list', async () => {
        render(<ArcadeLeaderboard />);
        await screen.findByText('Dee');
        const row = within(rowOf('Dee'));
        expect(row.getByText('Nayra')).toBeTruthy();
        expect(row.getByRole('img').getAttribute('src')).toBe('nayra_key_Portrait.jpg');
    });

    it('shows nothing extra for a neon-fighter row', async () => {
        render(<ArcadeLeaderboard />);
        await screen.findByText('Eve');
        const row = rowOf('Eve');
        expect(within(row).queryByRole('img')).toBeNull();
        expect(row.textContent).toBe('#5Eve500');
    });

    it('shows the ship on the podium', async () => {
        render(<ArcadeLeaderboard />);
        await screen.findByText('Ace');
        const card = within(podiumOf('Ace'));
        expect(card.getByText('Nayra')).toBeTruthy();
        expect(card.getByRole('img').getAttribute('src')).toBe('nayra_key_Portrait.jpg');
        expect(within(podiumOf('Bee')).queryByRole('img')).toBeNull();
    });

    it('shows the name only when the ship does not resolve to a template', async () => {
        render(<ArcadeLeaderboard />);
        await screen.findByText('Cee');
        const card = within(podiumOf('Cee'));
        expect(card.getByText('Unknown Ship')).toBeTruthy();
        expect(card.queryByRole('img')).toBeNull();
    });
});
