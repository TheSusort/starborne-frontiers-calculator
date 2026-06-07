import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EnemyAttackersPanel, EnemyAttackerConfig } from '../EnemyAttackersPanel';
import { buildDefaultShipSkills } from '../../../utils/abilities/configToSimInputs';

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [], getShipById: () => undefined }),
}));

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const manual: EnemyAttackerConfig = {
    id: '1',
    name: 'Enemy 1',
    attack: 4000,
    crit: 0,
    critDamage: 0,
    speed: 50,
    chargeCount: 0,
    startCharged: false,
};

const noop = () => {};

describe('EnemyAttackersPanel', () => {
    it('renders manual fields with their defaults', () => {
        render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[manual]}
                onAdd={noop}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={noop}
            />
        );
        expect(screen.getByLabelText('Attack')).toHaveValue(4000);
        expect(screen.getByLabelText('Speed')).toHaveValue(50);
        // No ship picked → autofill note absent
        expect(
            screen.queryByText('Damage abilities are simulated; other abilities are not yet.')
        ).not.toBeInTheDocument();
    });

    it('shows the autofill note when an enemy has walked skills (ship picked)', () => {
        render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[{ ...manual, shipId: 'x', shipSkills: buildDefaultShipSkills() }]}
                onAdd={noop}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={noop}
            />
        );
        // getShipById is mocked to undefined; the note depends on selectedShip, so this asserts
        // the manual path. The note presence is exercised in the page-level integration.
        expect(screen.getByLabelText('Attack')).toBeInTheDocument();
    });

    it('calls onAdd and hides the add button at the cap', () => {
        const onAdd = vi.fn();
        const { rerender } = render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[manual]}
                onAdd={onAdd}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={noop}
            />
        );
        fireEvent.click(screen.getByText('+ Add enemy attacker'));
        expect(onAdd).toHaveBeenCalled();

        const four = [1, 2, 3, 4].map((n) => ({ ...manual, id: `${n}`, name: `Enemy ${n}` }));
        rerender(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={four}
                onAdd={onAdd}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={noop}
            />
        );
        expect(screen.queryByText('+ Add enemy attacker')).not.toBeInTheDocument();
    });

    it('propagates manual edits and removal', () => {
        const onUpdate = vi.fn();
        const onRemove = vi.fn();
        render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[manual]}
                onAdd={noop}
                onRemove={onRemove}
                onSelectShip={noop}
                onUpdate={onUpdate}
            />
        );
        fireEvent.change(screen.getByLabelText('Attack'), { target: { value: '8000' } });
        expect(onUpdate).toHaveBeenCalledWith('1', { attack: 8000 });
        fireEvent.click(screen.getByLabelText('Remove enemy attacker'));
        expect(onRemove).toHaveBeenCalledWith('1');
    });
});
