import { render, screen, fireEvent, waitFor } from '../../../test-utils/test-utils';
import { StatModifierInput } from '../StatModifierInput';
import { Stat, StatName, StatType } from '../../../types/stats';
import { STATS } from '../../../constants';
import { vi } from 'vitest';

describe('StatModifierInput', () => {
    const mockStats: Stat[] = [
        { name: 'attack', value: 100, type: 'flat' },
        { name: 'defence', value: 50, type: 'percentage' },
        { name: 'crit', value: 20, type: 'percentage' },
        { name: 'critDamage', value: 10, type: 'percentage' },
        { name: 'healModifier', value: 10, type: 'percentage' },
        { name: 'hp', value: 100, type: 'flat' },
        { name: 'speed', value: 100, type: 'flat' },
        { name: 'hacking', value: 100, type: 'flat' },
        { name: 'security', value: 100, type: 'flat' },
    ];

    const defaultProps = {
        stats: mockStats,
        onChange: vi.fn(),
        maxStats: 3,
        allowedStats: {
            attack: { allowedTypes: ['flat', 'percentage'] as StatType[] },
            defence: { allowedTypes: ['flat', 'percentage'] as StatType[] },
            crit: { allowedTypes: ['percentage'] as StatType[] },
            critDamage: { allowedTypes: ['percentage'] as StatType[] },
            healModifier: { allowedTypes: ['percentage'] as StatType[] },
            hp: { allowedTypes: ['flat'] as StatType[] },
            speed: { allowedTypes: ['flat'] as StatType[] },
            hacking: { allowedTypes: ['flat'] as StatType[] },
            security: { allowedTypes: ['flat'] as StatType[] },
            shield: { allowedTypes: ['percentage'] as StatType[] },
            hpRegen: { allowedTypes: ['percentage'] as StatType[] },
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders all stat inputs', () => {
        render(<StatModifierInput {...defaultProps} />);

        mockStats.forEach((stat) => {
            const label = STATS[stat.name].label;
            const statLabelElement = screen.getByLabelText(new RegExp(label, 'i'));
            expect(statLabelElement).toBeInTheDocument();
            expect(
                statLabelElement.parentElement?.parentElement?.nextElementSibling?.querySelector(
                    'input'
                )
            ).toHaveValue(stat.value);
            expect(
                statLabelElement.parentElement?.parentElement?.nextElementSibling?.nextElementSibling?.querySelector(
                    'button'
                )
            ).toHaveTextContent(new RegExp(stat.type, 'i'));
        });
    });

    test('handles stat name change', () => {
        render(<StatModifierInput {...defaultProps} />);

        const statSelect = screen.getAllByLabelText(/stat/i)[0];
        fireEvent.click(statSelect);
        fireEvent.click(screen.getAllByRole('option', { name: /crit/i })[0]);

        const expectedStats = [
            { name: 'crit', value: 100, type: 'percentage' },
            ...mockStats.slice(1),
        ];
        expect(defaultProps.onChange).toHaveBeenCalledWith(expectedStats);
    });

    test('handles value change', () => {
        render(<StatModifierInput {...defaultProps} />);

        const valueInput = screen.getAllByRole('spinbutton', { name: /value/i })[0];
        fireEvent.change(valueInput, { target: { value: '200' } });

        const expectedStats = [{ ...mockStats[0], value: 200 }, ...mockStats.slice(1)];
        expect(defaultProps.onChange).toHaveBeenCalledWith(expectedStats);
    });

    test('handles type change', () => {
        render(<StatModifierInput {...defaultProps} />);

        const typeSelect = screen.getAllByLabelText(/type/i)[0];
        fireEvent.click(typeSelect);
        fireEvent.click(screen.getAllByRole('option', { name: /percentage/i })[0]);

        const expectedStats = [{ ...mockStats[0], type: 'percentage' }, ...mockStats.slice(1)];
        expect(defaultProps.onChange).toHaveBeenCalledWith(expectedStats);
    });

    test('adds new stat when under max limit', () => {
        const testProps = {
            ...defaultProps,
            stats: mockStats.slice(0, 2),
            maxStats: 3,
        };

        render(<StatModifierInput {...testProps} />);

        const addButton = screen.getByRole('button', { name: /add stat/i });
        fireEvent.click(addButton);

        expect(defaultProps.onChange).toHaveBeenCalledWith([
            ...testProps.stats,
            expect.objectContaining({
                name: Object.keys(defaultProps.allowedStats)[0],
                value: 0,
                type: expect.any(String),
            }),
        ]);
    });

    test('removes stat', () => {
        render(<StatModifierInput {...defaultProps} />);

        const removeButtons = screen.getAllByRole('button', { name: /remove stat/i });
        fireEvent.click(removeButtons[0]);

        const expectedStats = mockStats.slice(1);
        expect(defaultProps.onChange).toHaveBeenCalledWith(expectedStats);
    });

    test('respects maxStats limit', () => {
        render(<StatModifierInput {...defaultProps} maxStats={2} />);

        expect(screen.queryByRole('button', { name: /add stat/i })).not.toBeInTheDocument();
    });

    test('handles excluded stats', async () => {
        const excludedStats = [{ name: 'attack' as StatName, type: 'percentage' as StatType }];
        render(<StatModifierInput {...defaultProps} excludedStats={excludedStats} />);

        const statSelect = screen.getAllByLabelText(/type/i)[0];
        fireEvent.click(statSelect);
        await waitFor(() => {
            // The percentage option should not be available for attack
            expect(statSelect.nextElementSibling?.children[1]).toHaveTextContent(/flat/i);
        });
    });
});
