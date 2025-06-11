import { render, screen, fireEvent, act } from '../../test-utils/test-utils';
import { SimulationPage } from '../manager/SimulationPage';
import { Ship } from '../../types/ship';
import { vi } from 'vitest';
import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { BaseStats } from '../../types/stats';

window.scrollTo = vi.fn();

// Mock data
const mockShip: Ship = {
    id: 'ship1',
    name: 'Test Ship',
    type: 'ATTACKER',
    faction: 'TERRAN',
    rarity: 'legendary',
    equipment: {},
    equipmentLocked: false,
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
    refits: [],
    implants: {},
};

// Mock hooks
vi.mock('../../contexts/ShipsContext', () => ({
    useShips: () => ({
        ships: [mockShip],
        loading: false,
        error: null,
        getShipById: (id: string) => (mockShip.id === id ? mockShip : null),
    }),
}));

// Mock UI components
vi.mock('../../components/ui', () => ({
    PageLayout: ({
        children,
        title,
        description,
    }: {
        children: React.ReactNode;
        title: string;
        description: string;
    }) => (
        <div>
            <h1>{title}</h1>
            <p>{description}</p>
            {children}
        </div>
    ),
    Button: ({
        children,
        onClick,
        disabled,
    }: {
        children: React.ReactNode;
        onClick: () => void;
        disabled: boolean;
    }) => (
        <button onClick={onClick} disabled={disabled}>
            {children}
        </button>
    ),
    Select: ({
        label,
        value,
        onChange,
        options,
    }: {
        label: string;
        value: string;
        onChange: (value: string) => void;
        options: { label: string; value: string }[];
    }) => (
        <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
            {options.map((opt: { label: string; value: string }) => (
                <option key={opt.value} value={opt.value}>
                    {opt.label}
                </option>
            ))}
        </select>
    ),
}));

// Mock ship selector
vi.mock('../../components/ship/ShipSelector', () => ({
    ShipSelector: ({ onSelect }: { onSelect: (ship: Ship) => void }) => (
        <button onClick={() => onSelect(mockShip)}>Select Ship</button>
    ),
}));

// Mock simulation components
vi.mock('../../components/simulation/SimulationResults', () => ({
    SimulationResults: ({ currentSimulation = {} }: { currentSimulation: SimulationSummary }) => (
        <div data-testid="simulation-results">
            {currentSimulation?.averageDamage && (
                <div>Average Damage: {currentSimulation.averageDamage}</div>
            )}
            {currentSimulation?.effectiveHP && (
                <div>Effective HP: {currentSimulation.effectiveHP}</div>
            )}
            {currentSimulation?.hackSuccessRate && (
                <div>Hack Success: {currentSimulation.hackSuccessRate}%</div>
            )}
            {currentSimulation?.averageHealing && (
                <div>Average Healing: {currentSimulation.averageHealing}</div>
            )}
        </div>
    ),
}));

// Add mock for simulationCalculator
vi.mock('../../utils/simulationCalculator', () => ({
    runSimulation: (stats: BaseStats, role: string) => {
        switch (role) {
            case 'Attacker':
                return {
                    averageDamage: 1000,
                    highestHit: 1500,
                    lowestHit: 800,
                    critRate: 0.25,
                };
            case 'Defender':
                return {
                    effectiveHP: 5000,
                    attacksWithstood: 10,
                    damageReduction: 50,
                };
            case 'Debuffer':
                return {
                    hackSuccessRate: 75,
                    averageDamage: 500,
                    highestHit: 750,
                    lowestHit: 400,
                    critRate: 0.15,
                };
            case 'Supporter':
                return {
                    averageHealing: 2000,
                    highestHeal: 2500,
                    lowestHeal: 1800,
                    critRate: 0.2,
                };
            default:
                return {};
        }
    },
}));

// Add mock for SimulationSettings
vi.mock('../../components/simulation/SimulationSettings', () => ({
    SimulationSettings: ({
        selectedShip,
        selectedRole,
        onShipSelect,
        onRoleSelect,
        onRunSimulation,
    }: {
        selectedShip: Ship | null;
        selectedRole: string;
        onShipSelect: (ship: Ship) => void;
        onRoleSelect: (role: string) => void;
        onRunSimulation: () => void;
    }) => (
        <div>
            <button onClick={() => onShipSelect(mockShip)}>Select Ship</button>
            <select
                aria-label="Ship Role"
                value={selectedRole}
                onChange={(e) => onRoleSelect(e.target.value)}
            >
                <option value="Attacker">Attacker</option>
                <option value="Defender">Defender</option>
                <option value="Debuffer">Debuffer</option>
                <option value="Supporter">Supporter</option>
            </select>
            <button onClick={onRunSimulation} disabled={!selectedShip} aria-label="Run Simulation">
                Run Simulation
            </button>
        </div>
    ),
}));

describe('SimulationPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders page title and description', () => {
        render(<SimulationPage />);
        expect(screen.getByText('Simulation')).toBeInTheDocument();
        expect(
            screen.getByText(
                /Simulate simplified attacks, hacks, heals, and defence with your ships and gear./i
            )
        ).toBeInTheDocument();
    });

    test('handles ship selection', () => {
        render(<SimulationPage />);

        fireEvent.click(screen.getByText('Select Ship'));

        expect(screen.getByRole('button', { name: /run simulation/i })).not.toBeDisabled();
    });

    test('handles role selection', () => {
        render(<SimulationPage />);

        const roleSelect = screen.getByLabelText('Ship Role') as HTMLSelectElement;
        fireEvent.change(roleSelect, { target: { value: 'Defender' } });

        expect(roleSelect.value).toBe('Defender');
    });

    test('runs simulation for attacker', async () => {
        render(<SimulationPage />);

        // Select ship and run simulation
        await act(async () => {
            fireEvent.click(screen.getByText('Select Ship'));
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /run simulation/i }));
        });

        expect(screen.getByTestId('simulation-results')).toHaveTextContent(/Average Damage: 1000/);
    });

    test('runs simulation for defender', async () => {
        render(<SimulationPage />);

        await act(async () => {
            fireEvent.click(screen.getByText('Select Ship'));
            fireEvent.change(screen.getByLabelText('Ship Role'), { target: { value: 'Defender' } });
            fireEvent.click(screen.getByRole('button', { name: /run simulation/i }));
        });

        expect(screen.getByTestId('simulation-results')).toHaveTextContent(/Effective HP: 5000/);
    });

    test('runs simulation for debuffer', async () => {
        render(<SimulationPage />);

        await act(async () => {
            fireEvent.click(screen.getByText('Select Ship'));
            fireEvent.change(screen.getByLabelText('Ship Role'), { target: { value: 'Debuffer' } });
            fireEvent.click(screen.getByRole('button', { name: /run simulation/i }));
        });

        expect(screen.getByTestId('simulation-results')).toHaveTextContent(/Hack Success: 75%/);
    });

    test('runs simulation for supporter', async () => {
        render(<SimulationPage />);

        await act(async () => {
            fireEvent.click(screen.getByText('Select Ship'));
            fireEvent.change(screen.getByLabelText('Ship Role'), {
                target: { value: 'Supporter' },
            });
            fireEvent.click(screen.getByRole('button', { name: /run simulation/i }));
        });

        expect(screen.getByTestId('simulation-results')).toHaveTextContent(/Average Healing: 2000/);
    });

    test('disables run button without ship selection', () => {
        render(<SimulationPage />);

        const runButton = screen.getByRole('button', { name: /run simulation/i });
        expect(runButton).toBeDisabled();
    });
});
