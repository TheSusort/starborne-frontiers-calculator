import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShipDisplay } from '../ShipDisplay';
import type { Ship } from '../../../types/ship';

vi.mock('../../../contexts/InventoryProvider', () => ({
    useInventory: () => ({ getGearPiece: () => undefined }),
}));
vi.mock('../../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({ getEngineeringStatsForShipType: () => undefined }),
}));
vi.mock('../../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: vi.fn() }),
}));
// Pulled in transitively; imports /favicon.ico?url, which Vitest cannot resolve.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const ship = {
    id: 'ship-1',
    name: 'Aegis',
    rarity: 'legendary',
    faction: 'ATLAS',
    type: 'ATTACKER',
    affinity: 'thermal',
    baseStats: { hp: 1000, attack: 100, crit: 10 },
    equipment: {},
    implants: {},
    refits: [],
} as unknown as Ship;

describe('ShipDisplay keyboard activation', () => {
    beforeEach(() => vi.clearAllMocks());

    it('fires onClick when the card itself takes Enter', () => {
        const onClick = vi.fn();
        render(<ShipDisplay ship={ship} variant="compact" onClick={onClick} />);

        fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });

        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('is not a tab stop when it has no click handler', () => {
        render(<ShipDisplay ship={ship} variant="compact" />);

        expect(screen.queryByRole('button')).toBeNull();
    });

    // The full card carries its own controls. A key press on one of those bubbles to the
    // card, so without a guard the card acts too and one Enter does two things.
    it('ignores a key press that came from a control inside the card', () => {
        const onClick = vi.fn();
        render(
            <ShipDisplay ship={ship} variant="compact" onClick={onClick}>
                <button type="button">Inner</button>
            </ShipDisplay>
        );

        fireEvent.keyDown(screen.getByRole('button', { name: 'Inner' }), { key: 'Enter' });

        expect(onClick).not.toHaveBeenCalled();
    });
});
