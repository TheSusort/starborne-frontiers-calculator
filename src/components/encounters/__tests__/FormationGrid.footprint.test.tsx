// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FormationGrid from '../FormationGrid';
import { bossFootprintOfId, bossShip } from '../../../constants/bountyBosses';

vi.mock('../../../contexts/ShipsContext', () => ({ useShips: () => ({ ships: [] }) }));
vi.mock('../../../hooks/useShipsData', () => ({ useShipsData: () => ({ ships: [] }) }));

const boss = bossShip('fenri', 32)!;

const renderGrid = () => {
    const onPositionSelect = vi.fn();
    const onRemoveShip = vi.fn();
    const onEditStats = vi.fn();
    render(
        <FormationGrid
            formation={[{ position: 'M1', shipId: boss.id }]}
            resolveShip={(pos) => (pos === 'M1' ? boss : null)}
            footprintOf={bossFootprintOfId}
            onPositionSelect={onPositionSelect}
            onRemoveShip={onRemoveShip}
            onEditStats={onEditStats}
        />
    );
    return { onPositionSelect, onRemoveShip, onEditStats };
};

describe('FormationGrid multi-hex units', () => {
    it('routes select, ctrl-remove and shift-edit on the secondary cell to the anchor', () => {
        const { onPositionSelect, onRemoveShip, onEditStats } = renderGrid();
        // M2 draws no label, so it is the hex right before the labelled M3 hex.
        const hexes = screen.getAllByRole('button');
        const m3 = screen.getByText('M3').closest('button')!;
        const secondary = hexes[hexes.indexOf(m3) - 1];
        fireEvent.click(secondary);
        expect(onPositionSelect).toHaveBeenCalledWith('M1');
        fireEvent.click(secondary, { ctrlKey: true });
        expect(onRemoveShip).toHaveBeenCalledWith('M1');
        fireEvent.click(secondary, { shiftKey: true });
        expect(onEditStats).toHaveBeenCalledWith('M1');
    });

    it('names the secondary cell after the unit that covers it', () => {
        renderGrid();
        const m3 = screen.getByText('M3').closest('button')!;
        const hexes = screen.getAllByRole('button');
        const secondary = hexes[hexes.indexOf(m3) - 1];
        expect(secondary.getAttribute('aria-label')).toBe(`${boss.name} (also covers M2)`);
        expect(screen.getByRole('button', { name: `${boss.name} (also covers M2)` })).toBe(
            secondary
        );
    });
});
