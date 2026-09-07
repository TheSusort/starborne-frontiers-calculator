import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatPriorityForm } from '../StatPriorityForm';
import { DERIVED_STAT_LABELS, getLimitStatLabel } from '../../../constants/stats';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports
// '/favicon.ico?url' — unresolvable under Vitest. Same workaround as the other
// component tests in this project (see AutogearQuickSettings.test.tsx).
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

// `Select` is a custom button + portaled listbox, not a native <select> — there is no
// HTMLSelectElement or `.options` to read. Open it (click the labelled trigger button)
// then read the rendered `role="option"` items, matching the query style used in
// src/components/autogear/__tests__/StatBonusForm.test.tsx.
describe('StatPriorityForm', () => {
    it('offers Direct Damage as a stat priority', () => {
        render(<StatPriorityForm onAdd={vi.fn()} />);
        fireEvent.click(screen.getByLabelText('Stat'));
        expect(screen.getByRole('option', { name: 'Direct Damage' })).toBeInTheDocument();
    });

    // `directDamage` was missed from AVAILABLE_STATS once already on this branch and had
    // to be fixed. Drive this off DERIVED_STAT_LABELS so a future third derived stat is
    // covered automatically instead of relying on someone remembering to add it here too.
    it('offers every derived stat as a stat priority', () => {
        render(<StatPriorityForm onAdd={vi.fn()} />);
        fireEvent.click(screen.getByLabelText('Stat'));
        for (const key of Object.keys(DERIVED_STAT_LABELS)) {
            const label = getLimitStatLabel(key as keyof typeof DERIVED_STAT_LABELS);
            expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
        }
    });
});
