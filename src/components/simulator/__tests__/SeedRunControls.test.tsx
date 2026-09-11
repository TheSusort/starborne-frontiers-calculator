import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SeedRunControls from '../SeedRunControls';

const baseProps = {
    seed: 123,
    runCount: 5,
    onSeedChange: () => {},
    onRunCountChange: () => {},
    onRun: () => {},
    canRun: true,
};

describe('SeedRunControls', () => {
    it('shows an Unpin control while locked when onUnpin is supplied, and it fires the callback', async () => {
        const onUnpin = vi.fn();
        render(<SeedRunControls {...baseProps} locked onUnpin={onUnpin} />);
        const button = screen.getByRole('button', { name: /unpin/i });
        await userEvent.click(button);
        expect(onUnpin).toHaveBeenCalled();
    });

    it('renders no Unpin control while unlocked, even with onUnpin supplied', () => {
        render(<SeedRunControls {...baseProps} locked={false} onUnpin={() => {}} />);
        expect(screen.queryByRole('button', { name: /unpin/i })).not.toBeInTheDocument();
    });

    it('renders no Unpin control while locked without onUnpin', () => {
        render(<SeedRunControls {...baseProps} locked />);
        expect(screen.queryByRole('button', { name: /unpin/i })).not.toBeInTheDocument();
    });
});
