import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SimulatorSetupBar from '../SimulatorSetupBar';
import type { SimulatorSetup } from '../../../utils/simulator/simulatorSetup';

const setup = (name: string): SimulatorSetup => ({
    version: 1,
    name,
    playerBoard: {},
    enemyBoard: {},
    seed: 1,
    runCount: 1,
    savedAt: 1,
});

const props = {
    saved: [setup('Alpha'), setup('Beta')],
    onSave: vi.fn(),
    onLoad: vi.fn(),
    onDelete: vi.fn(),
    canSave: true,
};

/** `Select` is a portal-backed button + role="option" list, not a native <select> — the same
 *  driver `SquadLeaderPicker.test.tsx` uses. */
const pickSavedSetup = (name: string) => {
    fireEvent.click(screen.getByRole('button', { name: /saved setups/i }));
    fireEvent.click(screen.getByRole('option', { name }));
};

describe('SimulatorSetupBar', () => {
    it('saves under a typed name', () => {
        const onSave = vi.fn();
        render(<SimulatorSetupBar {...props} onSave={onSave} />);
        fireEvent.change(screen.getByLabelText(/setup name/i), { target: { value: 'Gamma' } });
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        expect(onSave).toHaveBeenCalledWith('Gamma');
    });

    it('does not save an empty or whitespace-only name', () => {
        const onSave = vi.fn();
        render(<SimulatorSetupBar {...props} onSave={onSave} />);
        fireEvent.change(screen.getByLabelText(/setup name/i), { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        expect(onSave).not.toHaveBeenCalled();
    });

    it('asks before overwriting a name already in the list', () => {
        const onSave = vi.fn();
        render(<SimulatorSetupBar {...props} onSave={onSave} />);
        fireEvent.change(screen.getByLabelText(/setup name/i), { target: { value: 'Alpha' } });
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        expect(onSave).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
        expect(onSave).toHaveBeenCalledWith('Alpha');
    });

    it('loads the selected setup', () => {
        const onLoad = vi.fn();
        render(<SimulatorSetupBar {...props} onLoad={onLoad} />);
        pickSavedSetup('Beta');
        fireEvent.click(screen.getByRole('button', { name: /load/i }));
        expect(onLoad).toHaveBeenCalledWith('Beta');
    });

    it('asks before deleting', () => {
        const onDelete = vi.fn();
        render(<SimulatorSetupBar {...props} onDelete={onDelete} />);
        pickSavedSetup('Alpha');
        fireEvent.click(screen.getByRole('button', { name: /delete/i }));
        expect(onDelete).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /confirm|delete setup/i }));
        expect(onDelete).toHaveBeenCalledWith('Alpha');
    });
});
