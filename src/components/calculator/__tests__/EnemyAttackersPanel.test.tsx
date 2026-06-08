import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EnemyAttackersPanel, EnemyAttackerConfig } from '../EnemyAttackersPanel';
import { buildDefaultShipSkills } from '../../../utils/abilities/configToSimInputs';
import { Ship } from '../../../types/ship';

const mockGetShipById = vi.fn((_id: string): Ship | undefined => undefined);

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [], getShipById: mockGetShipById }),
}));

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

// ShipSelector pulls in ShipDisplay which needs many context providers — stub it out.
vi.mock('../../ship/ShipSelector', () => ({
    ShipSelector: () => null,
}));

const minimalShip: Ship = {
    id: 'x',
    name: 'Test Ship',
    rarity: 'LEGENDARY',
    faction: 'ATLAS_SYNDICATE',
    type: 'ATTACKER',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 0,
        security: 0,
        crit: 0,
        critDamage: 0,
        speed: 0,
    },
    equipment: {},
    implants: {},
    refits: [],
};

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
    beforeEach(() => {
        mockGetShipById.mockReset();
        mockGetShipById.mockReturnValue(undefined);
    });
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

    it('shows the autofill note when a ship is selected for an enemy', () => {
        mockGetShipById.mockImplementation((id: string) => (id === 'x' ? minimalShip : undefined));
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
        expect(
            screen.getByText('Damage abilities are simulated; other abilities are not yet.')
        ).toBeInTheDocument();
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

    it('renders an affinity selector defaulting to Antimatter', () => {
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
        // The shared Affinity Select renders its label and the selected option text.
        expect(screen.getByText('Affinity')).toBeInTheDocument();
        expect(screen.getByText('Antimatter')).toBeInTheDocument();
    });

    it('reflects the enemy affinity field and calls onUpdate with the chosen affinity', () => {
        const onUpdate = vi.fn();
        render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[{ ...manual, affinity: 'thermal' }]}
                onAdd={noop}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={onUpdate}
            />
        );
        // Selected value is reflected.
        expect(screen.getByText('Thermal')).toBeInTheDocument();
        // Open the affinity Select and pick Electric.
        fireEvent.click(screen.getByLabelText('Affinity'));
        fireEvent.click(screen.getByText('Electric'));
        expect(onUpdate).toHaveBeenCalledWith('1', { affinity: 'electric' });
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

    it('renders correctly with zero enemies and still shows the Add button', () => {
        render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[]}
                onAdd={noop}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={noop}
            />
        );
        // No enemy cards rendered.
        expect(screen.queryByLabelText('Remove enemy attacker')).not.toBeInTheDocument();
        // Add button still visible (0 < MAX_ENEMY_ATTACKERS).
        expect(screen.getByText('+ Add enemy attacker')).toBeInTheDocument();
    });
});
