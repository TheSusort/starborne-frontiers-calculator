import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SeedRunControls from '../SeedRunControls';
import { MAX_RUN_COUNT, MIN_RUN_COUNT } from '../../../utils/simulator/seedRunInputs';

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

    it('disables the seed and run-count inputs (and New seed) while locked — the visible half of the pairing guarantee', () => {
        render(<SeedRunControls {...baseProps} locked />);
        expect(screen.getByLabelText(/seed/i)).toBeDisabled();
        expect(screen.getByLabelText(/runs/i)).toBeDisabled();
        expect(screen.getByRole('button', { name: /new seed/i })).toBeDisabled();
    });

    it('leaves the seed and run-count inputs enabled while unlocked', () => {
        render(<SeedRunControls {...baseProps} locked={false} />);
        expect(screen.getByLabelText(/seed/i)).not.toBeDisabled();
        expect(screen.getByLabelText(/runs/i)).not.toBeDisabled();
    });

    it('clamps a run count above the ceiling to MAX_RUN_COUNT rather than passing it through', () => {
        const onRunCountChange = vi.fn();
        render(<SeedRunControls {...baseProps} onRunCountChange={onRunCountChange} />);
        fireEvent.change(screen.getByLabelText(/runs/i), { target: { value: '5000' } });
        expect(onRunCountChange).toHaveBeenCalledWith(MAX_RUN_COUNT);
    });

    it('clamps a cleared run-count field to MIN_RUN_COUNT instead of 0', () => {
        const onRunCountChange = vi.fn();
        render(<SeedRunControls {...baseProps} onRunCountChange={onRunCountChange} />);
        fireEvent.change(screen.getByLabelText(/runs/i), { target: { value: '' } });
        expect(onRunCountChange).toHaveBeenCalledWith(MIN_RUN_COUNT);
    });

    it('clamps a non-finite seed value to a safe fallback', () => {
        const onSeedChange = vi.fn();
        render(<SeedRunControls {...baseProps} onSeedChange={onSeedChange} />);
        fireEvent.change(screen.getByLabelText(/seed/i), { target: { value: '' } });
        expect(onSeedChange).toHaveBeenCalledWith(0);
    });
});
