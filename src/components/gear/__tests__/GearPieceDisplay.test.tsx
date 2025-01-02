import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { GearPieceDisplay } from '../GearPieceDisplay';
import { GearPiece } from '../../../types/gear';
import { GEAR_SETS, RARITIES } from '../../../constants';
import { vi } from 'vitest';

// Mock useShips hook
vi.mock('../../../hooks/useShips', () => ({
    useShips: () => ({
        getShipById: (id: string) => (id === 'ship1' ? { name: 'Test Ship' } : undefined),
    }),
}));

describe('GearPieceDisplay Component', () => {
    const mockGear: GearPiece = {
        id: 'gear1',
        slot: 'weapon',
        level: 15,
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
        gear: mockGear,
        showDetails: true,
        mode: 'manage' as const,
    };

    test('renders basic gear information', () => {
        render(<GearPieceDisplay {...defaultProps} />);

        expect(screen.getByText('weapon')).toBeInTheDocument();
        expect(screen.getByText('★ 5')).toBeInTheDocument();
        expect(screen.getByText('Lvl 15')).toBeInTheDocument();
    });

    test('renders main stat', () => {
        render(<GearPieceDisplay {...defaultProps} />);

        expect(screen.getByText('Main Stat')).toBeInTheDocument();
        expect(screen.getByText('Attack: 1000')).toBeInTheDocument();
    });

    test('renders sub stats', () => {
        render(<GearPieceDisplay {...defaultProps} />);

        expect(screen.getByText('Sub Stats')).toBeInTheDocument();
        expect(screen.getByText('Crit Power')).toBeInTheDocument();
        expect(screen.getByText('15%')).toBeInTheDocument();
        expect(screen.getByText('HP')).toBeInTheDocument();
        expect(screen.getByText('500')).toBeInTheDocument();
    });

    test('shows equipped ship name', () => {
        render(<GearPieceDisplay {...defaultProps} />);
        expect(screen.getByText('Equipped by: Test Ship')).toBeInTheDocument();
    });

    test('renders set bonus icon', () => {
        render(<GearPieceDisplay {...defaultProps} />);
        const icon = screen.getByAltText('CRITICAL');
        expect(icon).toHaveAttribute('src', GEAR_SETS.CRITICAL.iconUrl);
    });

    test('applies rarity styles', () => {
        render(<GearPieceDisplay {...defaultProps} />);
        const header = screen.getByText('weapon').closest('div')?.parentElement?.parentElement;
        expect(header).toHaveClass(RARITIES.legendary.textColor);
        expect(header).toHaveClass(RARITIES.legendary.borderColor);
    });

    describe('Manage mode', () => {
        test('shows edit and remove buttons', () => {
            const onEdit = vi.fn();
            const onRemove = vi.fn();

            render(<GearPieceDisplay {...defaultProps} onEdit={onEdit} onRemove={onRemove} />);

            expect(screen.getByRole('button', { name: /edit gear piece/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /remove gear piece/i })).toBeInTheDocument();
        });

        test('handles edit click', () => {
            const onEdit = vi.fn();
            render(<GearPieceDisplay {...defaultProps} onEdit={onEdit} />);

            fireEvent.click(screen.getByRole('button', { name: /edit gear piece/i }));
            expect(onEdit).toHaveBeenCalledWith(mockGear);
        });

        test('handles remove click', () => {
            const onRemove = vi.fn();
            render(<GearPieceDisplay {...defaultProps} onRemove={onRemove} />);

            fireEvent.click(screen.getByRole('button', { name: /remove gear piece/i }));
            expect(onRemove).toHaveBeenCalledWith(mockGear.id);
        });
    });

    describe('Select mode', () => {
        test('shows equip button', () => {
            const onEquip = vi.fn();
            render(<GearPieceDisplay {...defaultProps} mode="select" onEquip={onEquip} />);

            expect(screen.getByRole('button', { name: /equip gear piece/i })).toBeInTheDocument();
        });

        test('handles equip click', () => {
            const onEquip = vi.fn();
            render(<GearPieceDisplay {...defaultProps} mode="select" onEquip={onEquip} />);

            fireEvent.click(screen.getByRole('button', { name: /equip gear piece/i }));
            expect(onEquip).toHaveBeenCalledWith(mockGear);
        });
    });

    test('hides details when showDetails is false', () => {
        render(<GearPieceDisplay {...defaultProps} showDetails={false} />);

        expect(screen.queryByText('Main Stat')).not.toBeInTheDocument();
        expect(screen.queryByText('Sub Stats')).not.toBeInTheDocument();
    });
});
