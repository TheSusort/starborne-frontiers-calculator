// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl } from '../SegmentedControl';

const options = [
    { value: 'normal', label: 'Normal · 12' },
    { value: 'small', label: 'Small · 7' },
];

describe('SegmentedControl', () => {
    it('names the group and marks only the selected option pressed', () => {
        render(
            <SegmentedControl label="Board" value="small" options={options} onChange={vi.fn()} />
        );
        expect(screen.getByRole('group', { name: 'Board' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Small · 7' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        expect(screen.getByRole('button', { name: 'Normal · 12' })).toHaveAttribute(
            'aria-pressed',
            'false'
        );
    });

    it('reports the clicked option', () => {
        const onChange = vi.fn();
        render(
            <SegmentedControl label="Board" value="normal" options={options} onChange={onChange} />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Small · 7' }));
        expect(onChange).toHaveBeenCalledWith('small');
    });

    it('does not report a click on an option that is already selected', () => {
        const onChange = vi.fn();
        render(
            <SegmentedControl label="Board" value="normal" options={options} onChange={onChange} />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Normal · 12' }));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('disables the whole control', () => {
        const onChange = vi.fn();
        render(
            <SegmentedControl
                label="Board"
                value="normal"
                options={options}
                onChange={onChange}
                disabled
            />
        );
        const small = screen.getByRole('button', { name: 'Small · 7' });
        expect(small).toBeDisabled();
        fireEvent.click(small);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('disables a single option and explains why in its title', () => {
        const onChange = vi.fn();
        render(
            <SegmentedControl
                label="Enemy"
                value="team"
                options={[
                    { value: 'team', label: 'Team' },
                    {
                        value: 'boss',
                        label: 'Bounty boss',
                        disabled: true,
                        title: 'Needs the normal board.',
                    },
                ]}
                onChange={onChange}
            />
        );
        const boss = screen.getByRole('button', { name: 'Bounty boss' });
        expect(boss).toBeDisabled();
        expect(boss).toHaveAttribute('title', 'Needs the normal board.');
        fireEvent.click(boss);
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Team' })).toBeEnabled();
    });

    it('exposes help text on the group', () => {
        render(
            <SegmentedControl
                label="Board"
                value="normal"
                options={options}
                onChange={vi.fn()}
                helpText="The small grid is the middle cell and the six around it."
            />
        );
        expect(screen.getByRole('group', { name: 'Board' })).toHaveAccessibleDescription(
            'The small grid is the middle cell and the six around it.'
        );
    });
});
