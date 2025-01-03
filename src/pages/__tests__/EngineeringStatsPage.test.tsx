import { render, screen, fireEvent, waitFor } from '../../test-utils/test-utils';
import { EngineeringStatsPage } from '../EngineeringStatsPage';
import { EngineeringStats, EngineeringStat } from '../../types/stats';
import { vi } from 'vitest';
import React from 'react';
import { ShipTypeName } from '../../constants';

window.scrollTo = vi.fn();

// Mock hooks
const mockSaveEngineeringStats = vi.fn();
const mockAddNotification = vi.fn();

const mockEngStats: EngineeringStats = {
    stats: [
        {
            shipType: 'ATTACKER',
            stats: [
                { name: 'attack', value: 10, type: 'percentage' },
                { name: 'critDamage', value: 5, type: 'percentage' },
            ],
        },
    ],
};

vi.mock('../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({
        engineeringStats: mockEngStats,
        saveEngineeringStats: mockSaveEngineeringStats,
    }),
}));

vi.mock('../../hooks/useNotification', () => ({
    useNotification: () => ({
        addNotification: mockAddNotification,
    }),
}));

// Mock UI components
vi.mock('../../components/ui', () => ({
    PageLayout: ({
        children,
        title,
        description,
        action,
    }: {
        children: React.ReactNode;
        title: string;
        description: string;
        action: { onClick: () => void; label: string };
    }) => (
        <div>
            <h1>{title}</h1>
            <p>{description}</p>
            <button onClick={action?.onClick}>{action?.label}</button>
            {children}
        </div>
    ),
    CollapsibleForm: ({
        children,
        isVisible,
    }: {
        children: React.ReactNode;
        isVisible: boolean;
    }) => <div className={isVisible ? '' : 'max-h-0'}>{children}</div>,
}));

// Mock EngineeringStatsForm
vi.mock('../../components/engineering/EngineeringStatsForm', () => ({
    EngineeringStatsForm: ({
        onSubmit,
        initialStats,
    }: {
        onSubmit: (stats: EngineeringStat) => void;
        initialStats: EngineeringStat;
    }) => (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onSubmit({
                    shipType: (initialStats?.shipType as ShipTypeName) || 'ATTACKER',
                    stats: initialStats?.stats || [
                        { name: 'attack', value: 15, type: 'percentage' },
                    ],
                });
            }}
        >
            <button type="submit">{initialStats ? 'Update Stats' : 'Add Stats'}</button>
        </form>
    ),
}));

// Mock EngineeringStatsList
vi.mock('../../components/engineering/EngineeringStatsList', () => ({
    EngineeringStatsList: ({
        stats,
        onEdit,
        onDelete,
    }: {
        stats: EngineeringStat[];
        onEdit: (stat: EngineeringStat) => void;
        onDelete: (shipType: ShipTypeName) => void;
    }) => (
        <div>
            {stats.map((stat: EngineeringStat) => (
                <div key={stat.shipType}>
                    <span>{stat.shipType}</span>
                    <button onClick={() => onEdit(stat)}>Edit</button>
                    <button onClick={() => onDelete(stat.shipType)}>Delete</button>
                </div>
            ))}
        </div>
    ),
}));

describe('EngineeringStatsPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders page title and description', () => {
        render(<EngineeringStatsPage />);
        expect(screen.getByText('Engineering Stats Management')).toBeInTheDocument();
        expect(screen.getByText('Manage your engineering stats.')).toBeInTheDocument();
    });

    test('toggles form visibility', () => {
        render(<EngineeringStatsPage />);
        const form = screen.getByText('Add Stats')?.closest('.max-h-0');
        expect(form).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /create/i }));
        expect(form).not.toHaveClass('max-h-0');

        fireEvent.click(screen.getByRole('button', { name: /hide form/i }));
        expect(form).toHaveClass('max-h-0');
    });

    test('handles stats addition', async () => {
        render(<EngineeringStatsPage />);

        fireEvent.click(screen.getByRole('button', { name: /create/i }));
        fireEvent.click(screen.getByRole('button', { name: /add stats/i }));

        await waitFor(() => {
            expect(mockSaveEngineeringStats).toHaveBeenCalledWith({
                stats: expect.arrayContaining([
                    expect.objectContaining({
                        shipType: 'ATTACKER',
                        stats: expect.arrayContaining([
                            expect.objectContaining({
                                name: 'attack',
                                value: 15,
                                type: 'percentage',
                            }),
                        ]),
                    }),
                ]),
            });
            expect(mockAddNotification).toHaveBeenCalledWith(
                'success',
                'Engineering stats added successfully'
            );
        });
    });

    test('handles stats editing', async () => {
        render(<EngineeringStatsPage />);

        // Click edit button
        fireEvent.click(screen.getByRole('button', { name: /edit/i }));

        // Submit updated stats
        fireEvent.click(screen.getByRole('button', { name: /update stats/i }));

        await waitFor(() => {
            expect(mockSaveEngineeringStats).toHaveBeenCalled();
            expect(mockAddNotification).toHaveBeenCalledWith(
                'success',
                'Engineering stats updated successfully'
            );
        });
    });

    test('handles stats deletion', async () => {
        render(<EngineeringStatsPage />);

        // Click delete button
        fireEvent.click(screen.getByRole('button', { name: /delete/i }));

        await waitFor(() => {
            expect(mockSaveEngineeringStats).toHaveBeenCalledWith({
                stats: expect.not.arrayContaining([
                    expect.objectContaining({
                        shipType: 'ATTACKER',
                    }),
                ]),
            });
            expect(mockAddNotification).toHaveBeenCalledWith(
                'success',
                'Engineering stats deleted successfully'
            );
        });
    });
});
