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

// A plain-stat core/max row with no basis of its own — SUPPORTER's own shape (its core row is
// the plain stat `hp`), used below to prove the basis controls apply to a plain stat too.
const rikraRow: CustomFormulaRow = {
    stat: 'hp',
    kind: 'core',
    direction: 'max',
    importance: 1,
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

describe('CustomFormulaForm — basis survives an unrelated edit', () => {
    it('preserves basis when only importance changes', async () => {
        // handleSubmit used to rebuild the row from an explicit { stat, kind, direction,
        // importance } field list, naming neither `basis` — so editing any field on a
        // basis-bearing row silently stripped it.
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

describe('the summary shows only what the scorer honours', () => {
    it('hides a term usableBasis drops, instead of claiming it counts', () => {
        // A negative weight is filtered at score time. Showing "Attack x-5.000" would tell the
        // player their build is scored on something it is not.
        renderRow({
            ...cobaltRow,
            basis: [
                { stat: 'attack', weight: 2.1 },
                { stat: 'hp', weight: -5 },
            ],
        });
        expect(screen.getByText(/Attack x2\.100/)).toBeInTheDocument();
        expect(screen.queryByText(/x-5/)).not.toBeInTheDocument();
    });

    it('survives a stored weight that is not a number at all', () => {
        // Stored config is untyped JSON. Reading the weight straight off the row sent a string
        // to toFixed and took the whole formula panel down for that ship.
        const corrupt = {
            ...cobaltRow,
            basis: [{ stat: 'attack', weight: 'abc' }],
        } as unknown as CustomFormulaRow;
        expect(() => renderRow(corrupt)).not.toThrow();
        expect(screen.queryByText(/abc/)).not.toBeInTheDocument();
    });
});
