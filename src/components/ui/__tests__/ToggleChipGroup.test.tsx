import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToggleChipGroup } from '../ToggleChipGroup';

const OPTIONS = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta', activeClassName: 'text-rarity-epic' },
];

describe('ToggleChipGroup', () => {
    it('exposes the selection as pressed buttons in a labelled group', () => {
        render(
            <ToggleChipGroup label="Letters" options={OPTIONS} values={['b']} onChange={vi.fn()} />
        );
        expect(screen.getByRole('group', { name: 'Letters' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute(
            'aria-pressed',
            'false'
        );
        const beta = screen.getByRole('button', { name: 'Beta' });
        expect(beta).toHaveAttribute('aria-pressed', 'true');
        expect(beta).toHaveClass('text-rarity-epic');
    });

    it('adds an unpicked value and removes a picked one', () => {
        const onChange = vi.fn();
        render(
            <ToggleChipGroup label="Letters" options={OPTIONS} values={['b']} onChange={onChange} />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
        expect(onChange).toHaveBeenLastCalledWith(['b', 'a']);
        fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
        expect(onChange).toHaveBeenLastCalledWith([]);
    });
});
