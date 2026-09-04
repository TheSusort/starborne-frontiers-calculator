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
