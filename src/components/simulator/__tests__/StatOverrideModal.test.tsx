import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StatOverrideModal from '../StatOverrideModal';
import type { ResolvedCombatStats } from '../../../utils/simulator/statOverrides';

const base: ResolvedCombatStats = {
    attack: 12450,
    crit: 70,
    critDamage: 180,
    defensePenetration: 0,
    shieldPenetration: 0,
    hacking: 310,
    security: 240,
    defence: 8200,
    hp: 46500,
    healModifier: 0,
    speed: 118,
};

const props = {
    isOpen: true,
    onClose: () => {},
    shipName: 'Xcellence',
    position: 'T1' as const,
    base,
};

describe('StatOverrideModal', () => {
    it('prefills every overridable stat with its resolved value', () => {
        render(<StatOverrideModal {...props} onChange={() => {}} />);
        expect(screen.getByText('12450')).toBeInTheDocument();
        expect(screen.getByText('118')).toBeInTheDocument();
        expect(screen.getByText('46500')).toBeInTheDocument();
    });

    it('shows the ship and its board position in the title', () => {
        render(<StatOverrideModal {...props} onChange={() => {}} />);
        expect(screen.getByText(/Xcellence/)).toBeInTheDocument();
        expect(screen.getByText(/T1/)).toBeInTheDocument();
    });

    it('reports a changed stat as an override', async () => {
        const onChange = vi.fn();
        render(<StatOverrideModal {...props} onChange={onChange} />);
        await userEvent.click(screen.getByRole('button', { name: /attack/i }));
        const input = screen.getByRole('spinbutton', { name: /attack/i });
        await userEvent.clear(input);
        await userEvent.type(input, '12650');
        await userEvent.tab();
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ attack: 12650 }));
    });

    it('clears the override when the base value is typed back', async () => {
        const onChange = vi.fn();
        render(<StatOverrideModal {...props} overrides={{ attack: 12650 }} onChange={onChange} />);
        await userEvent.click(screen.getByRole('button', { name: /attack/i }));
        const input = screen.getByRole('spinbutton', { name: /attack/i });
        await userEvent.clear(input);
        await userEvent.type(input, '12450');
        await userEvent.tab();
        expect(onChange).toHaveBeenCalledWith({});
    });

    it('shows the delta from base for an overridden stat', () => {
        render(<StatOverrideModal {...props} overrides={{ speed: 133 }} onChange={() => {}} />);
        expect(screen.getByText('+15')).toBeInTheDocument();
    });

    it('clears every override at once', async () => {
        const onChange = vi.fn();
        render(
            <StatOverrideModal
                {...props}
                overrides={{ attack: 12650, speed: 133 }}
                onChange={onChange}
            />
        );
        await userEvent.click(screen.getByRole('button', { name: /reset all/i }));
        expect(onChange).toHaveBeenCalledWith({});
    });
});
