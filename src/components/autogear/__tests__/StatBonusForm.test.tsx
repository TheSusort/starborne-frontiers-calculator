import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatBonusForm } from '../StatBonusForm';

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
