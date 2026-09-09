import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '../../../test-utils/test-utils';
import type { CustomFormula } from '../../../types/autogear';
import { AutogearSettings } from '../AutogearSettings';
import { makeSettingsProps } from './autogearSettingsProps';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports
// '/favicon.ico?url' — unresolvable under Vitest.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));
// useTutorialTrigger calls useTutorial(), which throws without a TutorialProvider;
// TestProviders does not supply one.
vi.mock('../../../hooks/useTutorialTrigger', () => ({ useTutorialTrigger: () => undefined }));

const renderPanel = (overrides: Parameters<typeof makeSettingsProps>[0] = {}) =>
    render(<AutogearSettings {...makeSettingsProps(overrides)} />);

const attackFormula: CustomFormula = {
    rows: [{ stat: 'attack', kind: 'core', direction: 'max', importance: 1 }],
};

describe('Custom mode panel', () => {
    it('shows the tweaks card with no role selected', () => {
        // Custom mode has no role, so the card must not depend on one being selected.
        renderPanel({ selectedShipRole: null });
        expect(screen.getByText(/your tweaks/i)).toBeInTheDocument();
    });

    it('says there are no stats yet, not no tweaks, when the formula is empty', () => {
        // With no role, "the role's defaults" is a non sequitur — this is the state the
        // whole card exists to fix, so its empty copy must name the actual gap.
        renderPanel({ selectedShipRole: null, customFormula: undefined });
        expect(screen.getByText(/no stats yet/i)).toBeInTheDocument();
        expect(screen.queryByText(/no tweaks yet/i)).not.toBeInTheDocument();
    });

    it('offers a seed role while the formula is empty', () => {
        renderPanel({ selectedShipRole: null, customFormula: undefined });
        expect(screen.getByText(/start from/i)).toBeInTheDocument();
    });

    it('drops the seed picker once the formula has a row', () => {
        renderPanel({ selectedShipRole: null, customFormula: attackFormula });
        expect(screen.queryByText(/start from/i)).not.toBeInTheDocument();
    });

    it('hides Scale from the picker and offers a formula stat instead', async () => {
        renderPanel({ selectedShipRole: null });
        await userEvent.click(screen.getByRole('button', { name: /add tweak/i }));
        expect(screen.getByText(/formula stat/i)).toBeInTheDocument();
        expect(screen.queryByText(/^Scale$/)).not.toBeInTheDocument();
    });

    it('keeps Scale in the picker when a role is selected', async () => {
        // Non-vacuity for the test above: the entry must exist somewhere, or "hidden in
        // Custom" would pass against a picker that never had a Scale entry at all.
        renderPanel({ selectedShipRole: 'ATTACKER' });
        await userEvent.click(screen.getByRole('button', { name: /add tweak/i }));
        expect(screen.getByText(/^Scale$/)).toBeInTheDocument();
        expect(screen.queryByText(/formula stat/i)).not.toBeInTheDocument();
    });

    it('shows a relative score for the equipped build', () => {
        renderPanel({ selectedShipRole: null, customFormula: attackFormula });
        expect(screen.getByText(/scores .* \(relative\)/i)).toBeInTheDocument();
    });

    it('lists persisted Scale rows as unused rather than dropping them silently', () => {
        renderPanel({
            selectedShipRole: null,
            customFormula: attackFormula,
            statBonuses: [{ stat: 'defence', percentage: 80, mode: 'additive' }],
        });
        expect(screen.getByText(/not used in custom/i)).toBeInTheDocument();
    });

    it('offers only Remove on an inactive Scale row, since editing it has no effect', () => {
        renderPanel({
            selectedShipRole: null,
            customFormula: attackFormula,
            statBonuses: [{ stat: 'defence', percentage: 80, mode: 'additive' }],
        });
        expect(screen.queryByRole('button', { name: 'Edit bonus' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove bonus' })).toBeInTheDocument();
    });
});

describe('Custom mode blocks a run it cannot score', () => {
    it('disables the run and states why when the formula is empty', () => {
        // An empty formula scores every candidate 0, which ties the whole search and
        // returns arbitrary gear — so the run stays blocked until a row exists.
        renderPanel({
            selectedShipRole: null,
            customFormula: undefined,
            priorities: [{ stat: 'speed', minLimit: 120, weight: 1 }],
        });
        expect(screen.getByRole('button', { name: /find optimal gear/i })).toBeDisabled();
        expect(screen.getByText(/add at least one stat/i)).toBeInTheDocument();
    });

    it('enables the run once the formula has a row', () => {
        renderPanel({ selectedShipRole: null, customFormula: attackFormula });
        expect(screen.getByRole('button', { name: /find optimal gear/i })).not.toBeDisabled();
    });

    it('loads a config that predates the formula field', () => {
        // customFormula is optional; a persisted SavedAutogearConfig reads back undefined.
        expect(() =>
            renderPanel({ selectedShipRole: 'ATTACKER', customFormula: undefined })
        ).not.toThrow();
    });
});
