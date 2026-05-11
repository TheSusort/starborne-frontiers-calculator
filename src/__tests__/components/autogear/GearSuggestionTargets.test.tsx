import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GearSuggestionTargets } from '../../../components/autogear/GearSuggestionTargets';
import { Ship } from '../../../types/ship';

// Sidebar imports /favicon.ico?url which is not available in test environment
vi.mock('../../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const makeTarget = (id: string) => ({
    ship: { id, name: `Ship ${id}` } as Ship,
    emptySlotCount: 2,
    isDonor: false,
});

describe('GearSuggestionTargets', () => {
    it('does not render Select All when only one target', () => {
        const onSelectAll = vi.fn();
        render(
            <GearSuggestionTargets
                targets={[makeTarget('a')]}
                onSelectShip={vi.fn()}
                onDismiss={vi.fn()}
                onSelectAll={onSelectAll}
            />
        );
        expect(screen.queryByRole('button', { name: /select all/i })).toBeNull();
    });

    it('does not render Select All when onSelectAll is not provided', () => {
        render(
            <GearSuggestionTargets
                targets={[makeTarget('a'), makeTarget('b')]}
                onSelectShip={vi.fn()}
                onDismiss={vi.fn()}
            />
        );
        expect(screen.queryByRole('button', { name: /select all/i })).toBeNull();
    });

    it('renders Select All when 2+ targets and onSelectAll is provided', () => {
        render(
            <GearSuggestionTargets
                targets={[makeTarget('a'), makeTarget('b')]}
                onSelectShip={vi.fn()}
                onDismiss={vi.fn()}
                onSelectAll={vi.fn()}
            />
        );
        expect(screen.getByRole('button', { name: /select all/i })).not.toBeNull();
    });

    it('calls onSelectAll with all ships when Select All is clicked', () => {
        const onSelectAll = vi.fn();
        const targets = [makeTarget('a'), makeTarget('b'), makeTarget('c')];
        render(
            <GearSuggestionTargets
                targets={targets}
                onSelectShip={vi.fn()}
                onDismiss={vi.fn()}
                onSelectAll={onSelectAll}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /select all/i }));
        expect(onSelectAll).toHaveBeenCalledOnce();
        expect(onSelectAll).toHaveBeenCalledWith(targets.map((t) => t.ship));
    });
});
