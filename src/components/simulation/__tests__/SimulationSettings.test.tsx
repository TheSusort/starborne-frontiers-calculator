import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { SimulationSettings } from '../SimulationSettings';
import { Ship } from '../../../types/ship';
import { ShipTypeName } from '../../../constants';
import { vi } from 'vitest';

describe('SimulationSettings', () => {
    const mockShip: Ship = {
        id: 'ship1',
        name: 'Test Ship',
        rarity: 'legendary',
        faction: 'TERRAN_COMBINE',
        type: 'ATTACKER',
        equipment: {},
        equipmentLocked: false,
        refits: [],
        implants: [],
        baseStats: {
            hp: 1000,
            attack: 100,
            defence: 50,
            speed: 10,
            hacking: 0,
            security: 0,
            crit: 5,
            critDamage: 50,
            healModifier: 0,
        },
    };

    const defaultProps = {
        selectedShip: mockShip,
        selectedRole: 'Attacker' as ShipTypeName,
        onShipSelect: vi.fn(),
        onRoleSelect: vi.fn(),
        onRunSimulation: vi.fn(),
    };

    test('renders ship selector', () => {
        render(<SimulationSettings {...defaultProps} />);
        expect(screen.getByRole('button', { name: /select another ship/i })).toBeInTheDocument();
    });

    test('renders role selector', () => {
        render(<SimulationSettings {...defaultProps} />);
        expect(screen.getByText(/ship role/i)).toBeInTheDocument();
    });

    test('handles role selection', () => {
        render(<SimulationSettings {...defaultProps} />);
        const select = screen.getByRole('button', { name: /ship role/i });
        fireEvent.click(select);
        const option = screen.getByRole('option', { name: /defender/i });
        fireEvent.click(option);
        expect(defaultProps.onRoleSelect).toHaveBeenCalledWith('Defender');
    });

    test('handles run simulation click', () => {
        render(<SimulationSettings {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /run simulation/i }));
        expect(defaultProps.onRunSimulation).toHaveBeenCalled();
    });

    test('disables run simulation when no ship selected', () => {
        render(<SimulationSettings {...defaultProps} selectedShip={null} />);
        expect(screen.getByRole('button', { name: /run simulation/i })).toBeDisabled();
    });

    test('displays simulation info', () => {
        render(<SimulationSettings {...defaultProps} />);
        expect(screen.getByText(/this simulates scenarios/i)).toBeInTheDocument();
        expect(screen.getByText(/100% damage hits/i)).toBeInTheDocument();
        expect(screen.getByText(/15000 attack and 170 security/i)).toBeInTheDocument();
    });

    test('updates ship role description based on selection', () => {
        const { rerender } = render(<SimulationSettings {...defaultProps} />);

        // Test Defender description
        rerender(<SimulationSettings {...defaultProps} selectedRole="Defender" />);
        expect(screen.getByText(/take hits from an enemy/i)).toBeInTheDocument();

        // Test Debuffer description
        rerender(<SimulationSettings {...defaultProps} selectedRole="Debuffer" />);
        expect(screen.getByText(/try to hack an enemy/i)).toBeInTheDocument();

        // Test Supporter description
        rerender(<SimulationSettings {...defaultProps} selectedRole="Supporter" />);
        expect(screen.getByText(/heal an ally/i)).toBeInTheDocument();
    });
});
