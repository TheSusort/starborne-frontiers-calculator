import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomFormulaForm } from '../CustomFormulaForm';
import type { CustomFormulaRow } from '../../../types/autogear';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports
// '/favicon.ico?url' — unresolvable under Vitest. Same workaround as the other
// component tests in this project (see AutogearQuickSettings.test.tsx).
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

describe('CustomFormulaForm', () => {
    it('adds a core maximized row with Normal importance by default', async () => {
        const onAdd = vi.fn();
        render(<CustomFormulaForm onAdd={onAdd} />);
        await userEvent.click(screen.getByRole('button', { name: /add formula stat/i }));
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
        await userEvent.click(screen.getByRole('button', { name: /add formula stat/i }));
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
        await userEvent.click(screen.getByRole('button', { name: /add formula stat/i }));
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
        await userEvent.click(screen.getByRole('button', { name: /add formula stat/i }));
        expect(onAdd).not.toHaveBeenCalled();
    });

    it('rejects a non-finite weight arriving from a stored row', async () => {
        // A number input sanitizes a non-finite entry to empty, so typing cannot produce
        // this. A persisted config can: it is untyped storage, and the edit path seeds the
        // field from whatever it holds. This is the case the submit handler's finite check
        // exists for — `min="0"` cannot see it, since Infinity is above zero.
        const onSave = vi.fn();
        render(
            <CustomFormulaForm
                onAdd={vi.fn()}
                onSave={onSave}
                editingValue={{
                    stat: 'speed',
                    kind: 'bonus',
                    direction: 'max',
                    percentage: Number.POSITIVE_INFINITY,
                }}
            />
        );
        await userEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(onSave).not.toHaveBeenCalled();
    });

    it('normalizes a stored core importance the picker never offers', async () => {
        // Same trust boundary as the weight above: a stored row can carry an exponent
        // outside the three the picker offers, and saving it back would persist it.
        const onSave = vi.fn();
        render(
            <CustomFormulaForm
                onAdd={vi.fn()}
                onSave={onSave}
                editingValue={
                    // Parsed rather than written inline, because that is how a stored row
                    // arrives: JSON with no type to stop it holding an exponent the union
                    // forbids.
                    JSON.parse(
                        '{"stat":"attack","kind":"core","direction":"max","importance":0}'
                    ) as CustomFormulaRow
                }
            />
        );
        await userEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(onSave).toHaveBeenCalledWith({
            stat: 'attack',
            kind: 'core',
            direction: 'max',
            importance: 1,
        });
    });

    it('rejects a blank basis weight instead of silently submitting a 0-weight term', async () => {
        // `addBasisTerm` seeds a blank weight field. `Number('')` is 0, which is finite and
        // >= 0 — the SAME check `usableBasis` (customFormula.ts) uses at READ time — so without
        // a stricter AUTHORING guard this silently submits `basis:[{ stat:'attack', weight:0 }]`
        // and the player sees no feedback at all.
        const onAdd = vi.fn();
        render(<CustomFormulaForm onAdd={onAdd} />);
        await userEvent.click(screen.getByRole('button', { name: /add stat/i }));
        await userEvent.click(screen.getByRole('button', { name: /add formula stat/i }));
        expect(onAdd).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Every stat needs a weight above zero. Remove a stat instead of leaving it blank or at 0.'
        );
    });

    it('rejects an explicit 0 basis weight, not only a blank one', async () => {
        const onAdd = vi.fn();
        render(<CustomFormulaForm onAdd={onAdd} />);
        await userEvent.click(screen.getByRole('button', { name: /add stat/i }));
        const weightInput = screen.getByLabelText(/basis weight/i);
        await userEvent.type(weightInput, '0');
        await userEvent.click(screen.getByRole('button', { name: /add formula stat/i }));
        expect(onAdd).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('rejects a negative basis weight with the same inline error as blank/zero', async () => {
        const onAdd = vi.fn();
        render(<CustomFormulaForm onAdd={onAdd} />);
        await userEvent.click(screen.getByRole('button', { name: /add stat/i }));
        const weightInput = screen.getByLabelText(/basis weight/i);
        await userEvent.type(weightInput, '-1');
        await userEvent.click(screen.getByRole('button', { name: /add formula stat/i }));
        expect(onAdd).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('rejects more basis terms than the shared schema allows', async () => {
        const onAdd = vi.fn();
        render(<CustomFormulaForm onAdd={onAdd} />);
        for (let i = 0; i < 6; i++) {
            await userEvent.click(screen.getByRole('button', { name: /add stat/i }));
        }
        for (const input of screen.getAllByLabelText(/basis weight/i)) {
            await userEvent.type(input, '1');
        }
        await userEvent.click(screen.getByRole('button', { name: /add formula stat/i }));
        expect(onAdd).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(/at most 5 stats/i);
    });

    it('rejects a basis weight outside the shared schema magnitude window', async () => {
        const onAdd = vi.fn();
        render(<CustomFormulaForm onAdd={onAdd} />);
        await userEvent.click(screen.getByRole('button', { name: /add stat/i }));
        const weightInput = screen.getByLabelText(/basis weight/i);
        await userEvent.type(weightInput, '1e13');
        await userEvent.click(screen.getByRole('button', { name: /add formula stat/i }));
        expect(onAdd).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(/too large or too small/i);
    });

    it('clears a stale basis error once the player edits the offending term', async () => {
        const onAdd = vi.fn();
        render(<CustomFormulaForm onAdd={onAdd} />);
        await userEvent.click(screen.getByRole('button', { name: /add stat/i }));
        await userEvent.click(screen.getByRole('button', { name: /add formula stat/i }));
        expect(screen.getByRole('alert')).toBeInTheDocument();

        await userEvent.type(screen.getByLabelText(/basis weight/i), '2.1');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('accepts a positive basis weight', async () => {
        const onAdd = vi.fn();
        render(<CustomFormulaForm onAdd={onAdd} />);
        await userEvent.click(screen.getByRole('button', { name: /add stat/i }));
        const weightInput = screen.getByLabelText(/basis weight/i);
        await userEvent.type(weightInput, '2.1');
        await userEvent.click(screen.getByRole('button', { name: /add formula stat/i }));
        expect(onAdd).toHaveBeenCalledWith({
            stat: 'attack',
            kind: 'core',
            direction: 'max',
            importance: 1,
            basis: [{ stat: 'attack', weight: 2.1 }],
        });
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
