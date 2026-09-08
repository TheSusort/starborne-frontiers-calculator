import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BasicsPage from '../BasicsPage';

// Seo renders into document.head via a portal in some setups; stub it so the test asserts
// page content only.
vi.mock('../../components/seo/Seo', () => ({ default: () => null }));
// Sidebar's `/favicon.ico?url` import fails under vitest (`Error: Denied ID /favicon.ico?url`);
// every existing page test that renders PageLayout stubs it out the same way (see e.g.
// SimulatorPage.test.tsx, DefenseCalculatorPage.test.tsx).
vi.mock('../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const renderPage = () =>
    render(
        <MemoryRouter>
            <BasicsPage />
        </MemoryRouter>
    );

describe('BasicsPage', () => {
    it('renders every section anchor named in the table of contents', () => {
        const { container } = renderPage();
        for (const id of [
            'turn-order',
            'roles',
            'stats',
            'affinities',
            'hacking-security',
            'targeting',
            'forced-targeting',
            'gear',
            'next-steps',
        ]) {
            expect(container.querySelector(`#${id}`), id).not.toBeNull();
            expect(container.querySelector(`a[href="#${id}"]`), `toc link ${id}`).not.toBeNull();
        }
    });

    it('never uses the words lane or column in its copy', () => {
        // Vocabulary is locked: rows are rows, 1-4 are positions.
        const { container } = renderPage();
        expect(container.textContent).not.toMatch(/\blanes?\b/i);
        expect(container.textContent).not.toMatch(/\bcolumns?\b/i);
    });

    it('never uses turn-meter vocabulary — speed sets turn order, nothing else', () => {
        const { container } = renderPage();
        expect(container.textContent).not.toMatch(/turn meter/i);
        expect(container.textContent).not.toMatch(/initiative/i);
    });

    it('states the hacking formula with its worked example', () => {
        renderPage();
        expect(screen.getByText(/80 hacking/i)).toBeInTheDocument();
        expect(screen.getByText(/40 security/i)).toBeInTheDocument();
    });

    it('composes the interactive targeting board', () => {
        renderPage();
        // Two 12-cell boards: your fleet and the enemy's. The row-scan lesson needs both —
        // it is about an attacker in one fleet's row hitting a ship in the other's.
        expect(screen.getAllByTestId(/^player-cell-/)).toHaveLength(12);
        expect(screen.getAllByTestId(/^enemy-cell-/)).toHaveLength(12);
    });
});
