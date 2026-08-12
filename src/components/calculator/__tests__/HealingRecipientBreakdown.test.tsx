import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { HealingRecipientBreakdown } from '../HealingRecipientBreakdown';

const NAMES: Record<string, string> = {
    'heal-target': 'Aegis',
    'ally-two': 'Lionheart',
};

/** The rendered table body, so a row assertion cannot accidentally match the heading blurb. */
const table = () => screen.getByRole('region', { name: 'Healing by ally' });

describe('HealingRecipientBreakdown', () => {
    it('shows a row per recipient with DISTINCT names', () => {
        render(
            <HealingRecipientBreakdown
                healTargetId="heal-target"
                nameFor={(id) => NAMES[id] ?? id}
                recipients={[
                    { id: 'heal-target', effectiveHealing: 12400, overheal: 800 },
                    { id: 'ally-two', effectiveHealing: 2050, overheal: 410 },
                ]}
            />
        );
        // ⚠️ Distinct names are load-bearing: with duplicates both assertions could match the
        // SAME rendered row and the test would pass while observing one recipient (#318 class).
        expect(screen.getByText('Aegis')).toBeInTheDocument();
        expect(screen.getByText('Lionheart')).toBeInTheDocument();
        // ...and their own numbers arrive with them, on the row that names them — the two-row
        // shape is what the table exists for.
        const rows = within(table()).getAllByRole('row');
        const aegis = rows.find((r) => r.textContent?.includes('Aegis'))!;
        const lionheart = rows.find((r) => r.textContent?.includes('Lionheart'))!;
        expect(aegis).not.toBe(lionheart);
        expect(aegis).toHaveTextContent('12,400');
        expect(aegis).toHaveTextContent('800');
        expect(lionheart).toHaveTextContent('2,050');
        expect(lionheart).toHaveTextContent('410');
    });

    it('marks the heal target as the primary row', () => {
        render(
            <HealingRecipientBreakdown
                healTargetId="heal-target"
                nameFor={(id) => NAMES[id] ?? id}
                recipients={[
                    { id: 'ally-two', effectiveHealing: 2050, overheal: 410 },
                    { id: 'heal-target', effectiveHealing: 12400, overheal: 800 },
                ]}
            />
        );
        expect(screen.getByText('Primary')).toBeInTheDocument();
        // The mark belongs to the HEAL TARGET's row, and only to it — the input order above puts
        // the target second on purpose, so a table that simply marked its first row would pass the
        // assertion above while pointing at the wrong ship.
        const rows = within(table()).getAllByRole('row');
        const marked = rows.filter((r) => r.textContent?.includes('Primary'));
        expect(marked).toHaveLength(1);
        expect(marked[0]).toHaveTextContent('Aegis');
    });

    it('shows a team total row', () => {
        render(
            <HealingRecipientBreakdown
                healTargetId="heal-target"
                nameFor={(id) => NAMES[id] ?? id}
                recipients={[
                    { id: 'heal-target', effectiveHealing: 12400, overheal: 800 },
                    { id: 'ally-two', effectiveHealing: 2050, overheal: 410 },
                ]}
            />
        );
        expect(screen.getByText('Team total')).toBeInTheDocument();
        expect(screen.getByText('14,450')).toBeInTheDocument();
    });

    it('renders nothing when there is no per-recipient data', () => {
        const { container } = render(
            <HealingRecipientBreakdown
                healTargetId="heal-target"
                nameFor={(id) => id}
                recipients={[]}
            />
        );
        expect(container).toBeEmptyDOMElement();
    });
});
