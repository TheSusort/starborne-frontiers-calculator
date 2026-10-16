import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BountyCreditsCalculatorPage, {
    DEFAULT_SETTINGS,
    isSettings,
} from '../BountyCreditsCalculatorPage';

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
        ['infinite seconds', { secondsPerFight: Infinity }],
    ])('rejects %s', (_name, patch) => {
        expect(isSettings({ ...DEFAULT_SETTINGS, ...patch })).toBe(false);
    });
});
