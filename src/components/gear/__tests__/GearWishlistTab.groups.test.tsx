// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { WishlistEntry } from '../../../types/wishlist';

const wishlist = vi.hoisted(() => ({ entries: [] as WishlistEntry[] }));
const modalMounts = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../../contexts/GearWishlistProvider', () => ({
    useGearWishlistContext: () => ({
        entries: wishlist.entries,
        loading: false,
        addEntry: vi.fn(),
        addEntries: vi.fn(),
        updateEntry: vi.fn(),
        deleteEntry: vi.fn(),
        moveEntry: vi.fn(),
        moveGroup: vi.fn(),
    }),
}));
vi.mock('../../../contexts/ShipsContext', () => ({ useShips: () => ({ ships: [] }) }));
vi.mock('../../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: vi.fn() }),
}));
vi.mock('../../../hooks/useWishlistScores', () => ({
    useWishlistScores: () => ({ results: new Map(), scoring: false }),
}));
// Sidebar imports /favicon.ico?url, which the test environment cannot load.
vi.mock('../../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../WishlistSearchResults', () => ({ WishlistSearchResults: () => null }));
vi.mock('../WishlistFromShipModal', () => ({
    WishlistFromShipModal: () => {
        useEffect(() => {
            modalMounts.count += 1;
        }, []);
        return <div>from-ship-modal</div>;
    },
}));

import { GearWishlistTab } from '../GearWishlistTab';

const entry = (id: string, group?: string): WishlistEntry => ({
    id,
    name: `Entry ${id}`,
    filters: {},
    ...(group ? { group } : {}),
});

describe('GearWishlistTab groups', () => {
    beforeEach(() => {
        localStorage.clear();
        modalMounts.count = 0;
    });
    afterEach(() => {
        wishlist.entries = [];
    });

    it('renders named groups by first appearance with ungrouped last', () => {
        wishlist.entries = [entry('u'), entry('a', 'Alpha'), entry('b', 'Beta')];
        render(<GearWishlistTab inventory={[]} />);
        const headings = screen
            .getAllByText(/^(Alpha|Beta|Ungrouped)$/)
            .map((el) => el.textContent);
        expect(headings).toEqual(['Alpha', 'Beta', 'Ungrouped']);
    });

    it('shows no group headers when nothing is grouped', () => {
        wishlist.entries = [entry('u')];
        render(<GearWishlistTab inventory={[]} />);
        expect(screen.queryByText('Ungrouped')).toBeNull();
        expect(screen.getByText('Entry u')).toBeTruthy();
    });

    it('collapses a group and remembers it', () => {
        wishlist.entries = [entry('a', 'Alpha'), entry('b', 'Beta')];
        const { unmount } = render(<GearWishlistTab inventory={[]} />);
        fireEvent.click(screen.getByText('Alpha'));
        expect(screen.queryByText('Entry a')).toBeNull();
        unmount();
        render(<GearWishlistTab inventory={[]} />);
        expect(screen.queryByText('Entry a')).toBeNull();
        expect(screen.getByText('Entry b')).toBeTruthy();
    });

    it('keeps the From ship modal mounted when the first entries arrive', () => {
        const { rerender } = render(<GearWishlistTab inventory={[]} />);
        fireEvent.click(screen.getByText('From ship'));
        expect(modalMounts.count).toBe(1);
        wishlist.entries = [entry('a', 'Alpha')];
        rerender(<GearWishlistTab inventory={[]} />);
        expect(screen.getByText('from-ship-modal')).toBeTruthy();
        expect(modalMounts.count).toBe(1);
    });
});
