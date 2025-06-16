import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { AutogearSettings } from '../AutogearSettings';
import { Ship } from '../../../types/ship';
import { AUTOGEAR_STRATEGIES, AutogearAlgorithm } from '../../../utils/autogear/AutogearStrategy';
import { StatName } from '../../../types/stats';
import { vi } from 'vitest';
import { SHIP_TYPES } from '../../../constants';

describe('AutogearSettings Component', () => {
    const mockShip: Ship = {
        id: 'ship1',
        name: 'Test Ship',
        rarity: 'legendary',
        faction: 'TERRAN',
        type: 'ATTACKER',
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
        equipment: {},
        equipmentLocked: false,
        refits: [],
        implants: {},
    };

    const defaultProps = {
        selectedShip: null,
        selectedShipRole: null,
        selectedAlgorithm: AutogearAlgorithm.TwoPass,
        priorities: [],
        ignoreEquipped: false,
        onShipSelect: vi.fn(),
        onRoleSelect: vi.fn(),
        onAlgorithmSelect: vi.fn(),
        onAddPriority: vi.fn(),
        onRemovePriority: vi.fn(),
        onFindOptimalGear: vi.fn(),
        onIgnoreEquippedChange: vi.fn(),
        onToggleSecondaryRequirements: vi.fn(),
        showSecondaryRequirements: false,
        setPriorities: [],
        onAddSetPriority: vi.fn(),
        onRemoveSetPriority: vi.fn(),
        ignoreUnleveled: false,
        onIgnoreUnleveledChange: vi.fn(),
        statBonuses: [],
        onAddStatBonus: vi.fn(),
        onRemoveStatBonus: vi.fn(),
        useUpgradedStats: false,
        onUseUpgradedStatsChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders settings title', () => {
        render(<AutogearSettings {...defaultProps} />);
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    test('renders ship selector', () => {
        render(<AutogearSettings {...defaultProps} />);
        expect(screen.getByLabelText('Select a Ship')).toBeInTheDocument();
    });

    test('renders predefined strategies section', () => {
        render(<AutogearSettings {...defaultProps} />);
        expect(screen.getByText('Predefined Strategies (Experimental)')).toBeInTheDocument();

        // Check if all ship types are present
        Object.values(SHIP_TYPES).forEach((type) => {
            expect(
                screen.getByText(new RegExp(`${type.name}.*${type.description}`))
            ).toBeInTheDocument();
        });
    });

    test('shows priority form when no role is selected', () => {
        render(<AutogearSettings {...defaultProps} selectedShipRole={''} />);
        expect(screen.queryByLabelText(/stat/i)).toBeInTheDocument();
    });

    test('hides priority form when role is selected', () => {
        render(<AutogearSettings {...defaultProps} selectedShipRole="ATTACKER" />);
        expect(screen.queryByLabelText(/stat/i)).not.toBeInTheDocument();
    });

    test('renders existing priorities', () => {
        const priorities = [
            { stat: 'attack' as StatName, weight: 1 },
            { stat: 'critDamage' as StatName, maxLimit: 50, weight: 0.8 },
        ];

        render(<AutogearSettings {...defaultProps} priorities={priorities} />);

        expect(screen.getByText('attack')).toBeInTheDocument();
        expect(screen.getByText('critDamage (Max: 50)')).toBeInTheDocument();
    });

    test('handles remove priority', () => {
        const priorities = [{ stat: 'attack' as StatName, weight: 1 }];

        render(<AutogearSettings {...defaultProps} priorities={priorities} />);

        const removeButton = screen.getByRole('button', { name: /remove/i });
        fireEvent.click(removeButton);

        expect(defaultProps.onRemovePriority).toHaveBeenCalledWith(0);
    });

    test('renders algorithm selector', () => {
        render(<AutogearSettings {...defaultProps} />);
        expect(screen.getByText('Algorithm')).toBeInTheDocument();
    });

    test('renders ignore equipped checkbox', () => {
        render(<AutogearSettings {...defaultProps} />);
        const checkbox = screen.getByRole('checkbox', { name: /ignore currently equipped gear/i });
        expect(checkbox).toBeInTheDocument();

        fireEvent.click(checkbox);
        expect(defaultProps.onIgnoreEquippedChange).toHaveBeenCalledWith(true);
    });

    test('find optimal gear button is disabled when no ship selected', () => {
        render(<AutogearSettings {...defaultProps} selectedShip={null} />);
        const button = screen.getByRole('button', { name: /find optimal gear/i });
        expect(button).toBeDisabled();
    });

    test('find optimal gear button is disabled when no role or priorities selected', () => {
        render(
            <AutogearSettings
                {...defaultProps}
                selectedShip={mockShip}
                selectedShipRole={null}
                priorities={[]}
            />
        );
        const button = screen.getByRole('button', { name: /find optimal gear/i });
        expect(button).toBeDisabled();
    });

    test('find optimal gear button is enabled with valid configuration', () => {
        const priorities = [{ stat: 'attack' as StatName, weight: 1 }];
        render(
            <AutogearSettings {...defaultProps} selectedShip={mockShip} priorities={priorities} />
        );
        const button = screen.getByRole('button', { name: /find optimal gear/i });
        expect(button).toBeEnabled();

        fireEvent.click(button);
        expect(defaultProps.onFindOptimalGear).toHaveBeenCalled();
    });

    test('handles role selection', () => {
        render(<AutogearSettings {...defaultProps} />);
        const select = screen.getByTestId('role-select');
        fireEvent.click(select);

        const option = screen.getByText(
            `${SHIP_TYPES.ATTACKER.name} (${SHIP_TYPES.ATTACKER.description})`
        );
        fireEvent.click(option);

        expect(defaultProps.onRoleSelect).toHaveBeenCalledWith(SHIP_TYPES.ATTACKER.name);
    });

    test('handles algorithm selection', () => {
        render(<AutogearSettings {...defaultProps} />);
        const select = screen.getByTestId('algorithm-select');
        fireEvent.click(select);

        const option = screen.getByText(AUTOGEAR_STRATEGIES[AutogearAlgorithm.BeamSearch].name);
        fireEvent.click(option);

        expect(defaultProps.onAlgorithmSelect).toHaveBeenCalledWith(AutogearAlgorithm.BeamSearch);
    });
});
