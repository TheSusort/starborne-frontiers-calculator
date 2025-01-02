import { render, screen } from '../../../test-utils/test-utils';
import { SimulationResults } from '../SimulationResults';
import { SimulationSummary } from '../../../utils/simulationCalculator';

describe('SimulationResults', () => {
    const mockAttackerSimulation: SimulationSummary = {
        averageDamage: 1000,
        highestHit: 1500,
        lowestHit: 500,
        critRate: 0.15,
    };

    const mockDefenderSimulation: SimulationSummary = {
        effectiveHP: 10000,
        damageReduction: 25,
        attacksWithstood: 10,
    };

    const mockDebufferSimulation: SimulationSummary = {
        hackSuccessRate: 75,
        averageDamage: 500,
    };

    const mockSupporterSimulation: SimulationSummary = {
        averageHealing: 1000,
        highestHeal: 1500,
        lowestHeal: 500,
    };

    test('renders attacker stats correctly', () => {
        render(<SimulationResults currentSimulation={mockAttackerSimulation} role="Attacker" />);

        expect(screen.getByText('Average Damage:')).toBeInTheDocument();
        expect(screen.getByText('1000')).toBeInTheDocument();
        expect(screen.getByText('Highest Hit:')).toBeInTheDocument();
        expect(screen.getByText('1500')).toBeInTheDocument();
        expect(screen.getByText('Lowest Hit:')).toBeInTheDocument();
        expect(screen.getByText('500')).toBeInTheDocument();
        expect(screen.getByText('Crit Rate:')).toBeInTheDocument();
        expect(screen.getByText('15%')).toBeInTheDocument();
    });

    test('renders defender stats correctly', () => {
        render(<SimulationResults currentSimulation={mockDefenderSimulation} role="Defender" />);

        expect(screen.getByText('Effective HP:')).toBeInTheDocument();
        expect(screen.getByText('10,000')).toBeInTheDocument();
        expect(screen.getByText('Damage Reduction:')).toBeInTheDocument();
        expect(screen.getByText('25%')).toBeInTheDocument();
        expect(screen.getByText('Attacks Withstood:')).toBeInTheDocument();
        expect(screen.getByText('10')).toBeInTheDocument();
    });

    test('renders debuffer stats correctly', () => {
        render(<SimulationResults currentSimulation={mockDebufferSimulation} role="Debuffer" />);

        expect(screen.getByText('Hack Success Rate:')).toBeInTheDocument();
        expect(screen.getByText('75%')).toBeInTheDocument();
        expect(screen.getByText('Average Damage:')).toBeInTheDocument();
        expect(screen.getByText('500')).toBeInTheDocument();
    });

    test('renders supporter stats correctly', () => {
        render(<SimulationResults currentSimulation={mockSupporterSimulation} role="Supporter" />);

        expect(screen.getByText('Average Healing:')).toBeInTheDocument();
        expect(screen.getByText('1,000')).toBeInTheDocument();
        expect(screen.getByText('Highest Heal:')).toBeInTheDocument();
        expect(screen.getByText('1,500')).toBeInTheDocument();
        expect(screen.getByText('Lowest Heal:')).toBeInTheDocument();
        expect(screen.getByText('500')).toBeInTheDocument();
    });

    test('shows comparison when suggested simulation is provided', () => {
        const suggestedSimulation: SimulationSummary = {
            averageDamage: 1200,
            highestHit: 1800,
            lowestHit: 600,
            critRate: 0.2,
        };

        render(
            <SimulationResults
                currentSimulation={mockAttackerSimulation}
                suggestedSimulation={suggestedSimulation}
                role="Attacker"
            />
        );

        expect(screen.getByText('Current Configuration')).toBeInTheDocument();
        expect(screen.getByText('Suggested Configuration')).toBeInTheDocument();
        expect(screen.getByText('(20.0%)')).toBeInTheDocument(); // Damage improvement
    });
});
