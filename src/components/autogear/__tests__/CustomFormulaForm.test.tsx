import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomFormulaForm } from '../CustomFormulaForm';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports
// '/favicon.ico?url' — unresolvable under Vitest. Same workaround as the other
// component tests in this project (see AutogearQuickSettings.test.tsx).
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

describe('CustomFormulaForm', () => {
    it('adds a core maximized row with Normal importance by default', async () => {
        const onAdd = vi.fn();
        render(<CustomFormulaForm onAdd={onAdd} />);
        await userEvent.click(screen.getByRole('button', { name: /add/i }));
        expect(onAdd).toHaveBeenCalledWith({
            stat: 'attack',
            kind: 'core',
            direction: 'max',
            importance: 1,
        });
    });

    it('omits importance and carries a percentage on a bonus row', async () => {
        const onAdd = vi.fn();
        render(<CustomFormulaForm onAdd={onAdd} />);
        await userEvent.click(screen.getByLabelText(/how it counts/i));
        await userEvent.click(screen.getByText(/added/i));
        await userEvent.click(screen.getByRole('button', { name: /add/i }));
        expect(onAdd).toHaveBeenCalledWith({
            stat: 'attack',
            kind: 'bonus',
            direction: 'max',
            percentage: 100,
        });
    });

    it('submits a bonus row with a 0 weight rather than falling back to 100', async () => {
        const onAdd = vi.fn();
        render(<CustomFormulaForm onAdd={onAdd} />);
        await userEvent.click(screen.getByLabelText(/how it counts/i));
        await userEvent.click(screen.getByText(/added/i));
        const weightInput = screen.getByLabelText(/weight %/i);
        await userEvent.clear(weightInput);
        await userEvent.type(weightInput, '0');
        await userEvent.click(screen.getByRole('button', { name: /add/i }));
        expect(onAdd).toHaveBeenCalledWith({
            stat: 'attack',
            kind: 'bonus',
            direction: 'max',
            percentage: 0,
        });
    });

    it('rejects a negative bonus weight instead of submitting it', async () => {
        const onAdd = vi.fn();
        render(<CustomFormulaForm onAdd={onAdd} />);
        await userEvent.click(screen.getByLabelText(/how it counts/i));
        await userEvent.click(screen.getByText(/added/i));
        const weightInput = screen.getByLabelText(/weight %/i);
        await userEvent.clear(weightInput);
        await userEvent.type(weightInput, '-5');
        await userEvent.click(screen.getByRole('button', { name: /add/i }));
        expect(onAdd).not.toHaveBeenCalled();
    });

    it('prefills from an edited row and saves it back', async () => {
        const onSave = vi.fn();
        render(
            <CustomFormulaForm
                onAdd={vi.fn()}
                onSave={onSave}
                editingValue={{
                    stat: 'speed',
                    kind: 'core',
                    direction: 'min',
                    importance: 2,
                }}
            />
        );
        await userEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(onSave).toHaveBeenCalledWith({
            stat: 'speed',
            kind: 'core',
            direction: 'min',
            importance: 2,
        });
    });
});
