import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BountyCreditsCalculatorPage from '../BountyCreditsCalculatorPage';

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
});
