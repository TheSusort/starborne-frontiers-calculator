import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { GearSuggestions } from '../GearSuggestions';
import { GearPiece } from '../../../types/gear';
import { GearSuggestion } from '../../../types/autogear';
import { GEAR_SLOT_ORDER } from '../../../constants/gearTypes';
import { vi } from 'vitest';
import { STATS } from '../../../constants/stats';

describe('GearSuggestions Component', () => {
    const mockGearPieces: Record<string, GearPiece> = {
        gear1: {
            id: 'gear1',
            slot: 'weapon',
            level: 1,
            stars: 6,
            rarity: 'legendary',
            mainStat: { name: 'attack', value: 1000, type: 'flat' },
            subStats: [],
            setBonus: 'CRITICAL',
            shipId: 'ship1',
        },
        gear2: {
            id: 'gear2',
            slot: 'hull',
            level: 1,
            stars: 5,
            rarity: 'legendary',
            mainStat: { name: 'hp', value: 2000, type: 'flat' },
            subStats: [],
            setBonus: 'FORTITUDE',
        },
    };

    const mockSuggestions: GearSuggestion[] = [
        { slotName: 'weapon', gearId: 'gear1', score: 100 },
        { slotName: 'hull', gearId: 'gear2', score: 90 },
    ];

    const defaultProps = {
        suggestions: mockSuggestions,
        getGearPiece: vi.fn((id: string) => mockGearPieces[id]),
        hoveredGear: null,
        onHover: vi.fn(),
        onEquip: vi.fn(),
        onLockEquipment: vi.fn(),
        ship: undefined,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders suggested gear title', () => {
        render(<GearSuggestions {...defaultProps} />);
        expect(screen.getByText('Suggested Gear')).toBeInTheDocument();
    });

    test('renders all gear slots', () => {
        render(<GearSuggestions {...defaultProps} />);

        // Empty slots should show "equip" text
        const emptySlots = screen.getAllByText('equip');
        // Total slots minus suggested gear slots
        expect(emptySlots).toHaveLength(GEAR_SLOT_ORDER.length - mockSuggestions.length);

        // Should have one "Equip All Suggestions" button
        expect(screen.getByRole('button', { name: /equip all suggestions/i })).toBeInTheDocument();
    });

    test('renders suggested gear in correct slots', () => {
        render(<GearSuggestions {...defaultProps} />);

        mockSuggestions.forEach((suggestion) => {
            const gear = mockGearPieces[suggestion.gearId];
            const statLabel = STATS[gear.mainStat?.name || 'attack'].shortLabel;
            expect(screen.getByText(statLabel)).toBeInTheDocument();
        });
    });

    test('handles gear hover', () => {
        render(<GearSuggestions {...defaultProps} />);

        // Find the gear container by its stat value
        const gearContainer = screen.getByText('ATK').parentElement;
        expect(gearContainer).toBeInTheDocument();

        fireEvent.mouseEnter(gearContainer!);
        expect(defaultProps.onHover).toHaveBeenCalledWith(mockGearPieces['gear1']);

        fireEvent.mouseLeave(gearContainer!);
        expect(defaultProps.onHover).toHaveBeenCalledWith(null);
    });

    test('handles equip all suggestions', () => {
        render(<GearSuggestions {...defaultProps} />);

        const equipButton = screen.getByRole('button', { name: /equip all suggestions/i });
        fireEvent.click(equipButton);

        expect(defaultProps.onEquip).toHaveBeenCalled();
    });

    test('displays empty slots when no suggestions', () => {
        render(<GearSuggestions {...defaultProps} suggestions={[]} />);

        const emptySlots = screen.getAllByText('equip');
        expect(emptySlots).toHaveLength(GEAR_SLOT_ORDER.length);
    });

    test('shows gear set icons for suggested gear', () => {
        render(<GearSuggestions {...defaultProps} />);

        mockSuggestions.forEach((suggestion) => {
            const gear = mockGearPieces[suggestion.gearId];
            const setIcon = screen.getByAltText(gear.setBonus || 'FORTITUDE');
            expect(setIcon).toBeInTheDocument();
        });
    });

    test('shows star ratings for suggested gear', () => {
        render(<GearSuggestions {...defaultProps} />);

        mockSuggestions.forEach((suggestion) => {
            const gear = mockGearPieces[suggestion.gearId];
            expect(screen.getByText(`★ ${gear.stars}`)).toBeInTheDocument();
        });
    });

    test('handles undefined gear pieces gracefully', () => {
        const getGearPiece = vi.fn((_id: string) => undefined);
        render(<GearSuggestions {...defaultProps} getGearPiece={getGearPiece} />);

        // Should show all slots as empty
        const emptySlots = screen.getAllByText('equip');
        expect(emptySlots).toHaveLength(GEAR_SLOT_ORDER.length);
    });
});
