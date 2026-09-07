import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatBonusForm } from '../StatBonusForm';
import type { StatBonusPreview } from '../../../utils/autogear/priorityScore';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports
// '/favicon.ico?url' — unresolvable under Vitest. Same workaround as the other
// component tests in this project (see AutogearQuickSettings.test.tsx).
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

// `Select` is a custom button + portaled listbox, not a native <select> — there is no
// HTMLSelectElement or `.options` to read. Open it (click the labelled trigger button)
// then read the rendered `role="option"` items, matching the query style used in
// src/components/gear/__tests__/GearCoverageGrid.test.tsx.
describe('StatBonusForm', () => {
    it('offers the derived stats alongside real ones', () => {
        render(<StatBonusForm onAdd={vi.fn()} />);
        fireEvent.click(screen.getByLabelText('Stat'));
        const optionLabels = screen.getAllByRole('option').map((option) => option.textContent);
        expect(optionLabels).toContain('Attack');
        expect(optionLabels).toContain('Direct Damage');
        expect(optionLabels).toContain('Effective HP');
    });

    it('labels the derived stats', () => {
        render(<StatBonusForm onAdd={vi.fn()} />);
        fireEvent.click(screen.getByLabelText('Stat'));
        expect(screen.getByRole('option', { name: 'Direct Damage' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Effective HP' })).toBeInTheDocument();
    });
});

describe('StatBonusForm contribution preview', () => {
    const previewFor = (): StatBonusPreview => ({
        statValue: 22000,
        baseScore: 3215,
        newScore: 7615,
        applies: true,
    });

    it('shows nothing before a stat is chosen', () => {
        render(<StatBonusForm onAdd={vi.fn()} previewFor={previewFor} />);
        expect(screen.queryByTestId('stat-bonus-preview')).toBeNull();
    });

    it('shows the base score and the resulting score once a stat is chosen', () => {
        render(<StatBonusForm onAdd={vi.fn()} previewFor={previewFor} />);
        fireEvent.click(screen.getByLabelText('Stat'));
        fireEvent.click(screen.getByRole('option', { name: 'HP' }));

        const preview = screen.getByTestId('stat-bonus-preview');
        expect(preview.textContent).toContain('3,215');
        expect(preview.textContent).toContain('+4,400');
        expect(preview.textContent).toContain('7,615');
    });

    it('warns instead of showing numbers when the bonus cannot apply', () => {
        const inert = (): StatBonusPreview => ({
            statValue: 22000,
            baseScore: 0,
            newScore: 0,
            applies: false,
        });
        render(<StatBonusForm onAdd={vi.fn()} previewFor={inert} />);
        fireEvent.click(screen.getByLabelText('Stat'));
        fireEvent.click(screen.getByRole('option', { name: 'HP' }));

        const preview = screen.getByTestId('stat-bonus-preview');
        expect(preview.textContent).toMatch(/role/i);
    });

    it('renders no preview block when no previewFor is supplied', () => {
        render(<StatBonusForm onAdd={vi.fn()} />);
        fireEvent.click(screen.getByLabelText('Stat'));
        fireEvent.click(screen.getByRole('option', { name: 'HP' }));
        expect(screen.queryByTestId('stat-bonus-preview')).toBeNull();
    });
});
