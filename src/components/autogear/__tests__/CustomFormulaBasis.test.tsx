import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomFormulaRowView } from '../CustomFormulaRow';
import { CustomFormulaForm } from '../CustomFormulaForm';
import type { CustomFormulaRow } from '../../../types/autogear';
import type { BaseStats } from '../../../types/stats';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports
// '/favicon.ico?url' — unresolvable under Vitest. Same workaround as the other
// component tests in this project.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const stats = (over: Partial<BaseStats> = {}): BaseStats => ({
    hp: 50000,
    attack: 10000,
    defence: 7000,
    speed: 130,
    hacking: 200,
    security: 75,
    crit: 50,
    critDamage: 130,
    healModifier: 0,
    hpRegen: 0,
    shield: 0,
    damageReduction: 0,
    defensePenetration: 0,
    ...over,
});

// Cobalt's real damage basis (Attack x2.1 + HP x0.267), pinned in basisDerivation's own tests.
const cobaltRow: CustomFormulaRow = {
    stat: 'directDamage',
    kind: 'core',
    direction: 'max',
    importance: 1,
    basis: [
        { stat: 'attack', weight: 2.1 },
        { stat: 'hp', weight: 0.267 },
    ],
};

// Rikra's whole carrier lives in a passive: nothing survives into `basis`, so `excludedNote`
// is the only content the notice had to give — and the only thing worth carrying onto the row.
const rikraRow: CustomFormulaRow = {
    stat: 'hp',
    kind: 'core',
    direction: 'max',
    importance: 1,
    excludedNote: ['repairs 60% of max HP when an enemy is destroyed'],
};

const renderRow = (row: CustomFormulaRow, shipStats: BaseStats | null = stats()) =>
    render(
        <CustomFormulaRowView
            row={row}
            isEditing={false}
            shipStats={shipStats}
            isLoneCoreRow={false}
            onEdit={vi.fn()}
            onRemove={vi.fn()}
        />
    );

describe('CustomFormulaRowView — basis display', () => {
    it('shows each basis term on a core row naming a derived stat', () => {
        renderRow(cobaltRow);
        expect(screen.getByText(/Attack x2\.100/)).toBeInTheDocument();
        expect(screen.getByText(/HP x0\.267/)).toBeInTheDocument();
    });

    it('shows no basis terms on a row with none', () => {
        renderRow({ stat: 'speed', kind: 'core', direction: 'max', importance: 1 });
        expect(screen.queryByText(/x\d/)).not.toBeInTheDocument();
    });

    it('never renders an add/remove control — editing a row happens through the form', () => {
        renderRow(cobaltRow);
        expect(screen.queryByRole('button', { name: /add stat/i })).not.toBeInTheDocument();
    });

    it('ignores a basis on a row the scorer would never honour (bonus, or minimized)', () => {
        // usableBasis only reads a `core`/`max` row's basis; a summary that showed terms here
        // would describe scoring that never happens.
        renderRow({
            stat: 'directDamage',
            kind: 'bonus',
            direction: 'max',
            percentage: 100,
            basis: cobaltRow.basis,
        });
        expect(screen.queryByText(/x\d/)).not.toBeInTheDocument();
    });

    it('shows the excluded-clause note even when there is no basis to show', () => {
        renderRow(rikraRow);
        expect(screen.getByText(/repairs 60% of max HP/)).toBeInTheDocument();
    });

    it("labels an effectiveHp basis as a tilt, not the ship's own equation", () => {
        renderRow({
            stat: 'effectiveHp',
            kind: 'core',
            direction: 'max',
            importance: 1,
            basis: [{ stat: 'defence', weight: 0.15 }],
        });
        expect(screen.getByText(/tilt/i)).toBeInTheDocument();
        expect(screen.queryByText(/ship's own equation/i)).not.toBeInTheDocument();
    });

    it("labels a directDamage basis as the ship's own equation, not a tilt", () => {
        renderRow(cobaltRow);
        expect(screen.getByText(/ship's own equation/i)).toBeInTheDocument();
        expect(screen.queryByText(/tilt/i)).not.toBeInTheDocument();
    });
});

describe('CustomFormulaForm — basis controls follow usableBasis', () => {
    it('shows basis controls on a plain-stat core/max row being edited', async () => {
        // usableBasis honours a basis on ANY core/max row, plain stats included — SUPPORTER's
        // core row is the plain stat `hp`. Gating on "derived stats only" would make this row,
        // the one the feature exists for, un-editable.
        render(<CustomFormulaForm onAdd={vi.fn()} onSave={vi.fn()} editingValue={rikraRow} />);
        expect(screen.getByRole('button', { name: /add stat/i })).toBeInTheDocument();
    });

    it('hides basis controls on a minimized row, which cannot use one', async () => {
        render(
            <CustomFormulaForm
                onAdd={vi.fn()}
                onSave={vi.fn()}
                editingValue={{ stat: 'speed', kind: 'core', direction: 'min', importance: 1 }}
            />
        );
        expect(screen.queryByRole('button', { name: /add stat/i })).not.toBeInTheDocument();
    });

    it('hides basis controls on a bonus row, which cannot use one', () => {
        render(
            <CustomFormulaForm
                onAdd={vi.fn()}
                onSave={vi.fn()}
                editingValue={{ stat: 'attack', kind: 'bonus', direction: 'max', percentage: 100 }}
            />
        );
        expect(screen.queryByRole('button', { name: /add stat/i })).not.toBeInTheDocument();
    });

    it('offers basis controls on a brand-new core row, not only when editing one', () => {
        // `usableBasis` honours a basis on any core/max row and knows nothing about whether the
        // row already exists, so withholding the control while composing one would deny an
        // author a basis the scorer would have honoured.
        render(<CustomFormulaForm onAdd={vi.fn()} />);
        expect(screen.getByRole('button', { name: /^add stat$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^add formula stat$/i })).toBeInTheDocument();
    });

    it('offers only stats usableBasis can honour in the basis-stat picker', async () => {
        render(<CustomFormulaForm onAdd={vi.fn()} onSave={vi.fn()} editingValue={rikraRow} />);
        await userEvent.click(screen.getByRole('button', { name: /add stat/i }));
        await userEvent.click(screen.getByLabelText(/basis stat/i));
        expect(screen.getByRole('option', { name: 'HP' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Direct Damage' })).not.toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Effective HP' })).not.toBeInTheDocument();
    });
});

describe('CustomFormulaForm — basis and excludedNote survive an unrelated edit', () => {
    it('preserves basis when only importance changes', async () => {
        // handleSubmit used to rebuild the row from an explicit { stat, kind, direction,
        // importance } field list, naming neither `basis` nor `excludedNote` — so editing any
        // field on a basis-bearing row silently stripped both.
        const onSave = vi.fn();
        render(<CustomFormulaForm onAdd={vi.fn()} onSave={onSave} editingValue={cobaltRow} />);
        await userEvent.click(screen.getByLabelText(/^importance$/i));
        await userEvent.click(screen.getByText(/heavy/i));
        await userEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                stat: 'directDamage',
                kind: 'core',
                direction: 'max',
                importance: 2,
                basis: cobaltRow.basis,
            })
        );
    });

    it('preserves excludedNote when only importance changes', async () => {
        const onSave = vi.fn();
        render(<CustomFormulaForm onAdd={vi.fn()} onSave={onSave} editingValue={rikraRow} />);
        await userEvent.click(screen.getByLabelText(/^importance$/i));
        await userEvent.click(screen.getByText(/heavy/i));
        await userEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                excludedNote: rikraRow.excludedNote,
            })
        );
    });
});

describe('CustomFormulaForm — adding and validating a basis term', () => {
    it('adds a term, which is how an excluded passive is put back', async () => {
        const onSave = vi.fn();
        render(<CustomFormulaForm onAdd={vi.fn()} onSave={onSave} editingValue={rikraRow} />);
        await userEvent.click(screen.getByRole('button', { name: /add stat/i }));
        await userEvent.click(screen.getByLabelText(/basis stat/i));
        await userEvent.click(screen.getByRole('option', { name: 'HP' }));
        await userEvent.type(screen.getByLabelText(/basis weight/i), '0.4');
        await userEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                basis: [{ stat: 'hp', weight: 0.4 }],
                excludedNote: rikraRow.excludedNote,
            })
        );
    });

    it('refuses a negative weight rather than saving one the scorer will drop', async () => {
        const onSave = vi.fn();
        render(<CustomFormulaForm onAdd={vi.fn()} onSave={onSave} editingValue={cobaltRow} />);
        const weightInput = screen.getAllByLabelText(/basis weight/i)[0];
        await userEvent.clear(weightInput);
        await userEvent.type(weightInput, '-1');
        await userEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(onSave).not.toHaveBeenCalled();
    });

    it('refuses a non-finite weight arriving from a stored row', async () => {
        // Same trust boundary as the bonus percentage: a stored row is untyped JSON and can
        // hold a weight typing could never produce. Constructed rather than typed, matching how
        // CustomFormulaForm.test.tsx exercises the same case for a bonus percentage.
        const onSave = vi.fn();
        const corrupted: CustomFormulaRow = {
            stat: 'directDamage',
            kind: 'core',
            direction: 'max',
            importance: 1,
            basis: [{ stat: 'attack', weight: Number.POSITIVE_INFINITY }],
        };
        render(<CustomFormulaForm onAdd={vi.fn()} onSave={onSave} editingValue={corrupted} />);
        await userEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(onSave).not.toHaveBeenCalled();
    });

    it('removes a term via its own remove control', async () => {
        const onSave = vi.fn();
        render(<CustomFormulaForm onAdd={vi.fn()} onSave={onSave} editingValue={cobaltRow} />);
        await userEvent.click(screen.getAllByRole('button', { name: /remove basis term/i })[0]);
        await userEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                basis: [{ stat: 'hp', weight: 0.267 }],
            })
        );
    });
});

describe('excludedNote travels with the basis', () => {
    it('is dropped when the row is switched to one that cannot hold a basis', async () => {
        // The note explains what a basis LEAVES OUT. On a bonus row, which the scorer never
        // reads a basis from, it would describe scoring that is not happening.
        const onSave = vi.fn();
        render(<CustomFormulaForm onAdd={vi.fn()} onSave={onSave} editingValue={rikraRow} />);
        await userEvent.click(screen.getByLabelText(/how it counts/i));
        await userEvent.click(screen.getByText(/added/i));
        await userEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(onSave).toHaveBeenCalledWith(
            expect.not.objectContaining({ excludedNote: expect.anything() })
        );
    });
});
