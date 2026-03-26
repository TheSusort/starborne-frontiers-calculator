import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatCard } from '../../../components/ui/StatCard';

describe('StatCard', () => {
    it('renders without delta when no previousValue is provided', () => {
        const { container } = render(<StatCard title="Ships" value={42} />);
        // No delta badge should be present
        expect(container.querySelector('[data-testid="stat-card-delta"]')).toBeNull();
    });

    it('renders positive delta in green when positiveDirection is up (default)', () => {
        const { container } = render(
            <StatCard title="Ships" value={50} previousValue={40} positiveDirection="up" />
        );
        const delta = container.querySelector('[data-testid="stat-card-delta"]');
        expect(delta).not.toBeNull();
        expect(delta?.textContent).toBe('+10');
        expect(delta?.className).toContain('text-green');
    });

    it('renders negative delta in red when positiveDirection is up', () => {
        const { container } = render(
            <StatCard title="Ships" value={30} previousValue={40} positiveDirection="up" />
        );
        const delta = container.querySelector('[data-testid="stat-card-delta"]');
        expect(delta).not.toBeNull();
        expect(delta?.textContent).toBe('-10');
        expect(delta?.className).toContain('text-red');
    });

    it('renders decrease in green when positiveDirection is down (less is better)', () => {
        const { container } = render(
            <StatCard
                title="Ungeared Ships"
                value={5}
                previousValue={15}
                positiveDirection="down"
            />
        );
        const delta = container.querySelector('[data-testid="stat-card-delta"]');
        expect(delta).not.toBeNull();
        expect(delta?.textContent).toBe('-10');
        expect(delta?.className).toContain('text-green');
    });

    it('renders increase in red when positiveDirection is down (less is better)', () => {
        const { container } = render(
            <StatCard
                title="Ungeared Ships"
                value={20}
                previousValue={10}
                positiveDirection="down"
            />
        );
        const delta = container.querySelector('[data-testid="stat-card-delta"]');
        expect(delta).not.toBeNull();
        expect(delta?.textContent).toBe('+10');
        expect(delta?.className).toContain('text-red');
    });

    it('renders zero delta in gray', () => {
        const { container } = render(
            <StatCard title="Ships" value={42} previousValue={42} positiveDirection="up" />
        );
        const delta = container.querySelector('[data-testid="stat-card-delta"]');
        expect(delta).not.toBeNull();
        expect(delta?.textContent).toBe('0');
        expect(delta?.className).toContain('text-gray');
    });

    it('handles string numeric values and computes delta correctly', () => {
        const { container } = render(
            <StatCard title="Average" value="38.2" previousValue={36.0} positiveDirection="up" />
        );
        const delta = container.querySelector('[data-testid="stat-card-delta"]');
        expect(delta).not.toBeNull();
        expect(delta?.textContent).toBe('+2.2');
        expect(delta?.className).toContain('text-green');
    });

    it('returns no delta when current value is non-numeric string', () => {
        const { container } = render(
            <StatCard title="Label" value="N/A" previousValue={10} positiveDirection="up" />
        );
        expect(container.querySelector('[data-testid="stat-card-delta"]')).toBeNull();
    });
});
