import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AbilityTypePicker } from '../AbilityTypePicker';

describe('AbilityTypePicker', () => {
    it('calls onPick with the chosen type', () => {
        const onPick = vi.fn();
        render(<AbilityTypePicker onPick={onPick} />);
        fireEvent.click(screen.getByRole('button', { name: 'Damage' }));
        expect(onPick).toHaveBeenCalledWith('damage');
    });

    it('renders a button for each ability type and calls onPick correctly', () => {
        const onPick = vi.fn();
        render(<AbilityTypePicker onPick={onPick} />);

        fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
        expect(onPick).toHaveBeenLastCalledWith('modifier');

        fireEvent.click(screen.getByRole('button', { name: 'Control' }));
        expect(onPick).toHaveBeenLastCalledWith('control');

        fireEvent.click(screen.getByRole('button', { name: 'Additional Damage' }));
        expect(onPick).toHaveBeenLastCalledWith('additional-damage');
    });

    it('renders category headings', () => {
        render(<AbilityTypePicker onPick={vi.fn()} />);
        expect(screen.getByText('Damage', { selector: 'span' })).toBeInTheDocument();
        expect(screen.getByText('Charge & Turns')).toBeInTheDocument();
        expect(screen.getByText('Utility')).toBeInTheDocument();
    });

    it('renders an Extra Action button that calls onPick with extra-action', () => {
        const onPick = vi.fn();
        render(<AbilityTypePicker onPick={onPick} />);
        fireEvent.click(screen.getByRole('button', { name: 'Extra Action' }));
        expect(onPick).toHaveBeenCalledWith('extra-action');
    });

    it('marks the Utility category as not simulated in DPS', () => {
        render(<AbilityTypePicker onPick={() => {}} />);
        expect(screen.getByText(/not simulated in the calculators yet/i)).toBeInTheDocument();
    });
});
