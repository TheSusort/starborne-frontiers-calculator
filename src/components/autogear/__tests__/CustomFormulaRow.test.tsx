import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CustomFormulaRowView } from '../CustomFormulaRow';
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

const renderRow = (row: CustomFormulaRow, shipStats: BaseStats | null, isLoneCoreRow = false) =>
    render(
        <CustomFormulaRowView
            row={row}
            isEditing={false}
            shipStats={shipStats}
            isLoneCoreRow={isLoneCoreRow}
            onEdit={vi.fn()}
            onRemove={vi.fn()}
        />
    );

const ZERO_NOTE = /0 on this ship/i;

describe('CustomFormulaRowView — the zero-stat note', () => {
    it('warns when a maximized core row sits on a stat the build has none of', () => {
        // One zero core term zeroes the whole product, tying every candidate — the
        // no-gradient failure the custom formula exists to remove.
        renderRow(
            { stat: 'healModifier', kind: 'core', direction: 'max', importance: 1 },
            stats({ healModifier: 0 })
        );
        expect(screen.getByText(ZERO_NOTE)).toBeInTheDocument();
    });

    it('stays silent once the stat has a value', () => {
        renderRow(
            { stat: 'healModifier', kind: 'core', direction: 'max', importance: 1 },
            stats({ healModifier: 50 })
        );
        expect(screen.queryByText(ZERO_NOTE)).not.toBeInTheDocument();
    });

    it('stays silent for a bonus row, which adds rather than multiplies', () => {
        renderRow(
            { stat: 'healModifier', kind: 'bonus', direction: 'max', percentage: 100 },
            stats({ healModifier: 0 })
        );
        expect(screen.queryByText(ZERO_NOTE)).not.toBeInTheDocument();
    });

    it('stays silent for a minimized row, where zero is the best the stat can be', () => {
        // A minimized term is 1/(1+0) = 1 at zero, so a warning here would be wrong.
        renderRow(
            { stat: 'healModifier', kind: 'core', direction: 'min', importance: 1 },
            stats({ healModifier: 0 })
        );
        expect(screen.queryByText(ZERO_NOTE)).not.toBeInTheDocument();
    });

    it('stays silent when no ship is selected and there are no stats to read', () => {
        renderRow({ stat: 'healModifier', kind: 'core', direction: 'max', importance: 1 }, null);
        expect(screen.queryByText(ZERO_NOTE)).not.toBeInTheDocument();
    });
});

describe('CustomFormulaRowView — importance', () => {
    it('shows the importance of a core row that shares the formula with others', () => {
        renderRow(
            { stat: 'attack', kind: 'core', direction: 'max', importance: 2 },
            stats(),
            false
        );
        expect(screen.getByText(/Heavy/)).toBeInTheDocument();
    });

    it('hides it on a lone core row, where an exponent cannot reorder anything', () => {
        renderRow({ stat: 'attack', kind: 'core', direction: 'max', importance: 2 }, stats(), true);
        expect(screen.queryByText(/Heavy/)).not.toBeInTheDocument();
    });

    it('shows a bonus row percentage instead', () => {
        renderRow(
            { stat: 'speed', kind: 'bonus', direction: 'max', percentage: 40 },
            stats(),
            false
        );
        expect(screen.getByText(/40%/)).toBeInTheDocument();
    });
});

describe('CustomFormulaRowView — direction', () => {
    it('spells out a minimized row so the intent is not carried by a symbol', () => {
        renderRow({ stat: 'speed', kind: 'core', direction: 'min', importance: 1 }, stats());
        expect(screen.getByText(/as little as possible/i)).toBeInTheDocument();
    });

    it('leaves a maximized row unqualified', () => {
        renderRow({ stat: 'speed', kind: 'core', direction: 'max', importance: 1 }, stats());
        expect(screen.queryByText(/as little as possible/i)).not.toBeInTheDocument();
    });
});
