import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BountyCreditsCalculatorPage from '../BountyCreditsCalculatorPage';
import { DEFAULT_SETTINGS, isSettings } from '../bountyCreditsSettings';

vi.mock('../../../contexts/AuthProvider', () => ({
    useAuth: () => ({ user: null, loading: false }),
}));
// The `ui` barrel pulls ui/layout/Sidebar, which imports '/favicon.ico?url' — unresolvable under Vitest.
vi.mock('../../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../../components/seo/Seo', () => ({ default: () => null }));

describe('BountyCreditsCalculatorPage', () => {
    it('renders a row per level and names the best level', () => {
        render(
            <MemoryRouter>
                <BountyCreditsCalculatorPage />
            </MemoryRouter>
        );
        expect(screen.getByText('Bounty Credits')).toBeInTheDocument();
        // Default bounty is Fenri (L33 available) → 33 level rows; ranked by credits per energy by
        // default, where L29 edges out L33.
        expect(screen.getAllByTestId('bounty-level-row')).toHaveLength(33);
        expect(screen.getByTestId('bounty-best')).toHaveTextContent('Level 29');
    });

    it('shows 32 level rows once Eelun (no abyssal level) is selected', () => {
        render(
            <MemoryRouter>
                <BountyCreditsCalculatorPage />
            </MemoryRouter>
        );
        fireEvent.click(screen.getByText('Fenri Khaliriz'));
        fireEvent.click(screen.getByText('Eelun Naphula'));
        expect(screen.getAllByTestId('bounty-level-row')).toHaveLength(32);
    });

    it('background mode pays 90% energy and hides the fight-time inputs', () => {
        render(
            <MemoryRouter>
                <BountyCreditsCalculatorPage />
            </MemoryRouter>
        );
        expect(screen.getByText('Seconds per fight')).toBeInTheDocument();
        const rowFor = (level: string) =>
            screen
                .getAllByTestId('bounty-level-row')
                .find((el) => el.textContent === level)!
                .closest('tr')!;
        expect(rowFor('33')).not.toHaveTextContent('9.9');
        fireEvent.click(screen.getByText('Normal'));
        fireEvent.click(screen.getByText('Background'));
        expect(screen.queryByText('Seconds per fight')).not.toBeInTheDocument();
        expect(screen.getByText('Default tier')).toBeInTheDocument();
        expect(rowFor('33')).toHaveTextContent('9.9');
    });

    it('a per-level tier override changes that row and clears when set back to the default', () => {
        render(
            <MemoryRouter>
                <BountyCreditsCalculatorPage />
            </MemoryRouter>
        );
        const rowFor = (level: string) =>
            screen
                .getAllByTestId('bounty-level-row')
                .find((el) => el.textContent === level)!
                .closest('tr')!;
        const pickTier = (optionName: string) => {
            fireEvent.click(within(rowFor('33')).getByLabelText('Tier, level 33'));
            fireEvent.click(screen.getByRole('option', { name: optionName }));
        };
        fireEvent.click(screen.getByText('Normal'));
        fireEvent.click(screen.getByText('Background'));
        expect(within(rowFor('33')).getByLabelText('Tier, level 33')).not.toHaveClass(
            'text-primary'
        );

        pickTier('Win in 1 round (1 min)');
        expect(rowFor('33')).toHaveTextContent('17,000');
        expect(within(rowFor('33')).getByLabelText('Tier, level 33')).toHaveClass('text-primary');

        pickTier('Win the battle (6 min)');
        expect(rowFor('33')).toHaveTextContent('2,833');
        expect(within(rowFor('33')).getByLabelText('Tier, level 33')).not.toHaveClass(
            'text-primary'
        );
    });
});

describe('isSettings', () => {
    it('accepts the defaults', () => {
        expect(isSettings(DEFAULT_SETTINGS)).toBe(true);
    });

    it.each([
        ['non-numeric star', { stars: ['x'] }],
        ['out-of-range star', { stars: [7] }],
        ['unknown rarity', { rarities: ['mythic'] }],
        ['non-string set', { sets: [1] }],
        ['string override value', { secondsOverrides: { '30': '30' } }],
        ['array overrides', { secondsOverrides: [] }],
        ['NaN extra credits', { extraCreditsPct: NaN }],
        ['unknown mode', { mode: 'idle' }],
        ['unknown default tier', { defaultTier: 'r2' }],
        ['unknown override tier', { tierOverrides: { '33': 'fast' } }],
        ['infinite seconds', { secondsPerFight: Infinity }],
    ])('rejects %s', (_name, patch) => {
        expect(isSettings({ ...DEFAULT_SETTINGS, ...patch })).toBe(false);
    });
});
