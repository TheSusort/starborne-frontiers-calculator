import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatPriorityForm } from '../StatPriorityForm';

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
});
