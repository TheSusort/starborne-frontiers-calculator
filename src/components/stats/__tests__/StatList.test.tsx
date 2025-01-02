import { render, screen } from '../../../test-utils/test-utils';
import { StatList } from '../StatList';
import { BaseStats, StatName } from '../../../types/stats';
import { STATS } from '../../../constants';

describe('StatList', () => {
    const mockStats: BaseStats = {
        hp: 1000,
        attack: 100,
        defence: 50,
        speed: 10,
        hacking: 0,
        security: 0,
        crit: 15,
        critDamage: 150,
        healModifier: 0,
    };

    test('renders all stats with correct values', () => {
        render(<StatList stats={mockStats} />);

        Object.entries(mockStats).forEach(([statName, value]) => {
            const label = screen.getByText(STATS[statName as StatName].label);
            expect(label).toBeInTheDocument();
            expect(label.nextElementSibling).toHaveTextContent(Math.round(value).toString());
        });
    });

    test('adds percentage symbol to percentage-only stats', () => {
        render(<StatList stats={mockStats} />);

        expect(screen.getByText('15%')).toBeInTheDocument(); // crit
        expect(screen.getByText('150%')).toBeInTheDocument(); // critDamage
        expect(screen.getByText('0%')).toBeInTheDocument(); // healModifier
    });

    test('shows title when provided', () => {
        const title = 'Test Stats';
        render(<StatList stats={mockStats} title={title} />);
        expect(screen.getByText(title)).toBeInTheDocument();
    });

    test('shows stat differences when comparison stats provided', () => {
        const comparisonStats: BaseStats = {
            ...mockStats,
            attack: 80, // -20
            defence: 70, // +20
            crit: 20, // +5
        };

        render(<StatList stats={mockStats} comparisonStats={comparisonStats} />);

        // Check for positive difference
        expect(screen.getByText('(+20)')).toBeInTheDocument();
        // Check for negative difference
        expect(screen.getByText('(-20)')).toBeInTheDocument();
    });

    test('applies custom className', () => {
        render(<StatList stats={mockStats} className="custom-class" />);
        const container = screen.getByTestId('stat-list');
        expect(container).toHaveClass('custom-class');
    });

    test('rounds decimal values', () => {
        const statsWithDecimals: BaseStats = {
            ...mockStats,
            attack: 100.6,
            defence: 50.2,
        };

        render(<StatList stats={statsWithDecimals} />);
        expect(screen.getByText('101')).toBeInTheDocument(); // 100.6 rounded
        expect(screen.getByText('50')).toBeInTheDocument(); // 50.2 rounded
    });

    test('does not show difference when values are equal', () => {
        const comparisonStats: BaseStats = { ...mockStats };
        render(<StatList stats={mockStats} comparisonStats={comparisonStats} />);

        // No difference indicators should be present
        const container = screen.getByTestId('stat-list');
        expect(container.textContent).not.toContain('(+');
        expect(container.textContent).not.toContain('(-');
    });
});
