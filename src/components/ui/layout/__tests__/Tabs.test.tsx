import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from '../Tabs';

describe('Tabs', () => {
    it('renders a tab badge next to its label', () => {
        render(
            <Tabs
                tabs={[
                    { id: 'a', label: 'Weapon', badge: '3 · 42%' },
                    { id: 'b', label: 'Hull' },
                ]}
                activeTab="a"
                onChange={() => {}}
            />
        );
        expect(screen.getByText('3 · 42%')).toBeInTheDocument();
    });

    it('keeps the accessible name as the label alone', () => {
        render(
            <Tabs
                tabs={[{ id: 'a', label: 'Weapon', badge: '3 · 42%' }]}
                activeTab="a"
                onChange={() => {}}
            />
        );
        expect(screen.getByRole('button', { name: 'Weapon' })).toBeInTheDocument();
    });

    it('exposes badgeDescription as the accessible description, without changing the accessible name', () => {
        render(
            <Tabs
                tabs={[
                    {
                        id: 'a',
                        label: 'Weapon',
                        badge: '3 · 42%',
                        badgeDescription:
                            '3 pieces owned at level 16, 42 percent levelling priority',
                    },
                ]}
                activeTab="a"
                onChange={() => {}}
            />
        );
        // The accessible NAME must stay label-only -- `name` here asserts
        // that, and `description` proves the badge's words still reach a
        // screen reader through `aria-describedby`.
        const tab = screen.getByRole('button', {
            name: 'Weapon',
            description: '3 pieces owned at level 16, 42 percent levelling priority',
        });
        expect(tab).toBeInTheDocument();
    });

    it('does not add aria-describedby when there is no badge', () => {
        render(<Tabs tabs={[{ id: 'a', label: 'Weapon' }]} activeTab="a" onChange={() => {}} />);
        expect(screen.getByRole('button', { name: 'Weapon' })).not.toHaveAttribute(
            'aria-describedby'
        );
    });

    it('still switches tabs', async () => {
        const onChange = vi.fn();
        render(
            <Tabs
                tabs={[
                    { id: 'a', label: 'Weapon' },
                    { id: 'b', label: 'Hull' },
                ]}
                activeTab="a"
                onChange={onChange}
            />
        );
        await userEvent.click(screen.getByRole('button', { name: 'Hull' }));
        expect(onChange).toHaveBeenCalledWith('b');
    });
});
