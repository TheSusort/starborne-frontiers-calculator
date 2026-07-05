import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BattleBoard from '../BattleBoard';
import type { CellOverlay } from '../../../utils/simulator/boardOverlays';
import type { Position } from '../../../types/encounters';

const overlay = (over: Partial<CellOverlay> & { actorId: string; name: string }): CellOverlay => ({
    hpPct: 100,
    shieldPct: 0,
    alive: true,
    currentShieldPool: 0,
    buffs: [],
    debuffs: [],
    ...over,
});

describe('BattleBoard', () => {
    const overlays: Partial<Record<Position, CellOverlay>> = {
        T1: overlay({ actorId: 'attacker', name: 'Nova', hpPct: 30, effect: 'damage' }),
        M2: overlay({ actorId: 'p:s2:1', name: 'Lyra', hpPct: 0, alive: false }),
    };

    it('renders occupied cells with ship names and HP bars', () => {
        render(<BattleBoard title="Your Team" overlays={overlays} onPinShip={vi.fn()} />);
        expect(screen.getByText('Nova')).toBeInTheDocument();
        expect(screen.getByText('Lyra')).toBeInTheDocument();
        const novaBar = screen.getByTestId('hp-bar-T1');
        expect(novaBar).toHaveStyle({ width: '30%' });
    });

    it('marks a dead ship with destroyed styling/text', () => {
        render(<BattleBoard title="Your Team" overlays={overlays} onPinShip={vi.fn()} />);
        expect(screen.getByText('destroyed')).toBeInTheDocument();
    });

    it('clicking a cell calls onPinShip with the actorId', () => {
        const onPinShip = vi.fn();
        render(<BattleBoard title="Your Team" overlays={overlays} onPinShip={onPinShip} />);
        fireEvent.click(screen.getByText('Nova'));
        expect(onPinShip).toHaveBeenCalledWith('attacker');
    });

    it('renders 12 grid cells (3x4)', () => {
        render(<BattleBoard title="Your Team" overlays={overlays} onPinShip={vi.fn()} />);
        expect(screen.getAllByRole('gridcell')).toHaveLength(12);
    });

    it('renders the shield badge when effect is "shield"', () => {
        const shieldOverlays: Partial<Record<Position, CellOverlay>> = {
            T1: overlay({ actorId: 'attacker', name: 'Nova', effect: 'shield' }),
        };
        render(<BattleBoard title="Your Team" overlays={shieldOverlays} onPinShip={vi.fn()} />);
        expect(screen.getByLabelText('shield absorbed')).toBeInTheDocument();
        expect(screen.getByText('shield')).toBeInTheDocument();
    });

    it('shows current shield pool when greater than zero', () => {
        const shieldOverlays: Partial<Record<Position, CellOverlay>> = {
            T1: overlay({
                actorId: 'attacker',
                name: 'Nova',
                currentShieldPool: 18106,
                shieldPct: 30,
            }),
        };
        render(<BattleBoard title="Your Team" overlays={shieldOverlays} onPinShip={vi.fn()} />);
        const shieldBar = screen.getByTestId('shield-bar-T1');
        expect(shieldBar).toHaveStyle({ width: '30%' });
    });
});
