import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { GearSlot } from '../GearSlot';
import { GearPiece } from '../../../types/gear';
import { GEAR_SETS, RARITIES } from '../../../constants';
import { vi } from 'vitest';

describe('GearSlot Component', () => {
    const mockGear: GearPiece = {
        id: 'test-1',
        slot: 'weapon',
        level: 10,
        stars: 5,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [],
        setBonus: 'CRITICAL',
        shipId: 'ship1',
    };

    const defaultProps = {
        slotKey: 'weapon' as const,
        hoveredGear: null,
        onHover: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders empty slot correctly', () => {
        render(<GearSlot {...defaultProps} />);

        const emptySlot = screen.getByRole('button', { name: /equip gear piece/i });
        expect(emptySlot).toHaveTextContent(/equip/i);
        expect(emptySlot).toHaveClass('bg-dark-lighter', 'border-dark-border');
    });

    test('renders filled slot correctly', () => {
        render(<GearSlot {...defaultProps} gear={mockGear} />);

        // Check set bonus icon
        const setIcon = screen.getByAltText('CRITICAL');
        expect(setIcon).toHaveAttribute('src', GEAR_SETS.CRITICAL.iconUrl);
        expect(setIcon).toHaveClass('w-5');

        // Check main stat display
        expect(screen.getByText('ATK')).toBeInTheDocument();

        // Check stars display
        expect(screen.getByText('★ 5')).toBeInTheDocument();
    });

    test('handles slot selection', () => {
        const onSelect = vi.fn();
        render(<GearSlot {...defaultProps} onSelect={onSelect} />);

        fireEvent.click(screen.getByRole('button', { name: /equip gear piece/i }));
        expect(onSelect).toHaveBeenCalledWith('weapon');
    });

    test('handles gear removal', () => {
        const onRemove = vi.fn();
        render(<GearSlot {...defaultProps} gear={mockGear} onRemove={onRemove} />);

        // Remove button should be hidden by default
        const removeButton = screen.getByRole('button', { name: /remove gear piece/i });
        expect(removeButton).toHaveClass('hidden');

        // Hover to show remove button
        fireEvent.mouseEnter(removeButton.parentElement as HTMLElement);
        expect(removeButton).toHaveClass('group-hover:block');

        // Click remove button
        fireEvent.click(removeButton);
        expect(onRemove).toHaveBeenCalledWith('weapon');
    });

    test('handles hover events', () => {
        render(<GearSlot {...defaultProps} gear={mockGear} />);

        const gearSlot = screen.getByText('ATK').parentElement;
        expect(gearSlot).toBeInTheDocument();

        // Mouse enter
        fireEvent.mouseEnter(gearSlot as HTMLElement);
        expect(defaultProps.onHover).toHaveBeenCalledWith(mockGear);

        // Mouse leave
        fireEvent.mouseLeave(gearSlot as HTMLElement);
        expect(defaultProps.onHover).toHaveBeenCalledWith(null);
    });

    test('shows tooltip when gear is hovered', () => {
        render(<GearSlot {...defaultProps} gear={mockGear} hoveredGear={mockGear} />);

        // GearPieceDisplay should be visible in tooltip
        expect(screen.getByText('Main Stat')).toBeInTheDocument();
        expect(screen.getByText('Attack: 1000')).toBeInTheDocument();
    });

    test('applies correct rarity styles', () => {
        render(<GearSlot {...defaultProps} gear={mockGear} />);

        const gearSlot = screen.getByText('ATK').parentElement;
        expect(gearSlot).toHaveClass(RARITIES.legendary.borderColor);
    });

    test('adds pointer cursor when slot is selectable', () => {
        const { rerender } = render(
            <GearSlot {...defaultProps} gear={mockGear} onSelect={() => {}} />
        );

        const gearSlot = screen.getByText('ATK').parentElement;
        expect(gearSlot).toHaveClass('cursor-pointer');

        // Rerender without onSelect to verify cursor is removed
        rerender(<GearSlot {...defaultProps} gear={mockGear} />);
        expect(gearSlot).not.toHaveClass('cursor-pointer');
    });
});
