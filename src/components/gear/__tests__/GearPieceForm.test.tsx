import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { GearPieceForm } from '../GearPieceForm';
import { GearPiece } from '../../../types/gear';
import { STATS, SLOT_MAIN_STATS } from '../../../constants';
import { vi } from 'vitest';

describe('GearPieceForm Component', () => {
    const mockGearPiece: GearPiece = {
        id: 'test-1',
        slot: 'weapon',
        level: 10,
        stars: 5,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [
            { name: 'critDamage', value: 15, type: 'percentage' },
            { name: 'hp', value: 500, type: 'flat' },
        ],
        setBonus: 'CRITICAL',
        shipId: 'ship1',
    };

    const defaultProps = {
        onSubmit: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders form with default values', () => {
        render(<GearPieceForm {...defaultProps} />);

        // Check initial form state
        expect(screen.getByRole('button', { name: /set bonus/i })).toHaveTextContent(/fortitude/i);
        expect(screen.getByRole('button', { name: 'Slot' })).toHaveTextContent(/weapon/i);
        expect(screen.getByRole('button', { name: 'Stars' })).toHaveTextContent(/1 ⭐/i);
        expect(screen.getByLabelText('Level')).toHaveValue(0);
        expect(screen.getByRole('button', { name: 'Rarity' })).toHaveTextContent(/rare/i);
    });

    test('renders form with editing values', () => {
        render(<GearPieceForm {...defaultProps} editingPiece={mockGearPiece} />);

        expect(screen.getByRole('button', { name: /set bonus/i })).toHaveTextContent(/critical/i);
        expect(screen.getByRole('button', { name: 'Slot' })).toHaveTextContent(/weapon/i);
        expect(screen.getByRole('button', { name: 'Stars' })).toHaveTextContent(/5 ⭐/i);
        expect(screen.getByLabelText('Level')).toHaveValue(10);
        expect(screen.getByRole('button', { name: 'Rarity' })).toHaveTextContent(/legendary/i);
    });

    test('handles main stat changes', async () => {
        render(<GearPieceForm {...defaultProps} />);

        // Change slot to sensor
        const slotSelect = screen.getByRole('button', { name: 'Slot' });
        fireEvent.click(slotSelect);
        fireEvent.click(screen.getByRole('option', { name: 'Sensor' }));

        // Change main stat
        const mainStatSelect = screen.getByTestId('main-stat-select');
        fireEvent.click(mainStatSelect);
        fireEvent.click(screen.getByRole('option', { name: 'Crit Power' }));

        // Verify type select is available for sensor
        expect(screen.getByRole('button', { name: /percentage/i })).toBeInTheDocument();
    });

    test('handles sub stats management', async () => {
        render(<GearPieceForm {...defaultProps} />);

        // Add a sub stat
        fireEvent.click(screen.getByRole('button', { name: 'Add stat' }));

        // Select stat type
        const statSelect = screen.getByRole('button', { name: 'Stat' });
        fireEvent.click(statSelect);
        fireEvent.click(screen.getByRole('option', { name: 'HP' }));

        // Enter value
        const valueInput = screen.getByLabelText('Value');
        fireEvent.change(valueInput, { target: { value: '500' } });

        // Remove stat
        fireEvent.click(screen.getByRole('button', { name: 'Remove stat' }));

        // Verify stat was removed
        expect(screen.queryByRole('button', { name: 'HP' })).not.toBeInTheDocument();
    });

    test('validates and submits form data', async () => {
        render(<GearPieceForm {...defaultProps} />);

        // Set form values
        const setBonusSelect = screen.getByRole('button', { name: 'Set Bonus' });
        fireEvent.click(setBonusSelect);
        fireEvent.click(screen.getByRole('option', { name: /critical/i }));

        fireEvent.change(screen.getByLabelText('Level'), { target: { value: '15' } });

        const starsSelect = screen.getByRole('button', { name: 'Stars' });
        fireEvent.click(starsSelect);
        fireEvent.click(screen.getByRole('option', { name: '5 ⭐' }));

        const raritySelect = screen.getByRole('button', { name: 'Rarity' });
        fireEvent.click(raritySelect);
        fireEvent.click(screen.getByRole('option', { name: 'Legendary' }));

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /add gear piece/i }));

        expect(defaultProps.onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                slot: 'weapon',
                level: 15,
                stars: 5,
                rarity: 'legendary',
                setBonus: 'CRITICAL',
                mainStat: expect.objectContaining({
                    name: 'attack',
                    type: 'flat',
                }),
                subStats: [],
            })
        );
    });

    test('validates main stat value against max limits', () => {
        render(<GearPieceForm {...defaultProps} />);

        const mainStatValue = screen.getByLabelText('Main Stat Value');
        fireEvent.change(mainStatValue, { target: { value: '99999' } });

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /add gear piece/i }));

        // Check that the value was capped at the max
        expect(defaultProps.onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                mainStat: expect.objectContaining({
                    value: STATS.attack.maxValue.flat,
                }),
            })
        );
    });

    test('updates available main stats when slot changes', () => {
        render(<GearPieceForm {...defaultProps} />);

        // Change to sensor slot
        const slotSelect = screen.getByRole('button', { name: 'Slot' });
        fireEvent.click(slotSelect);
        fireEvent.click(screen.getByRole('option', { name: 'Sensor' }));

        // Open main stat select
        const mainStatSelect = screen.getByTestId('main-stat-select');
        fireEvent.click(mainStatSelect);

        // Get all options within the main stat select
        const mainStatOptions = screen
            .getAllByRole('option')
            .filter(
                (option) =>
                    option.parentElement?.parentElement?.children[0].getAttribute('data-testid') ===
                    'main-stat-select'
            );
        //console.log(mainStatOptions);
        // Verify that we have the correct number of options
        expect(mainStatOptions).toHaveLength(SLOT_MAIN_STATS.sensor.length);

        // Verify each option is from the sensor main stats list
        mainStatOptions.forEach((option) => {
            const statName = option.textContent;
            // statName is in the STATS object, and the label is the same as the statName
            expect(Object.values(STATS).some((stat) => stat.label === statName)).toBe(true);
        });
    });

    test('resets form after submission when not editing', () => {
        render(<GearPieceForm {...defaultProps} />);

        // Change some values
        fireEvent.change(screen.getByLabelText('Level'), { target: { value: '15' } });
        fireEvent.click(screen.getByLabelText('Stars'));
        fireEvent.click(screen.getByRole('option', { name: '5 ⭐' }));

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /add gear piece/i }));

        // Check that values were reset
        expect(screen.getByLabelText('Level')).toHaveValue(0);
        expect(screen.getByRole('button', { name: 'Stars' })).toHaveTextContent('1 ⭐');
    });
});
