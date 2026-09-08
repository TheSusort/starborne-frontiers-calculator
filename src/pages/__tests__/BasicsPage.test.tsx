import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BasicsPage from '../BasicsPage';
import { ROLE_GUIDE } from '../../components/basics/roleGuideData';
import { STATS } from '../../constants/stats';
import { TARGETING_RULES, PATTERN_SHAPES } from '../../constants/targetingRules';
import { GEAR_SETS } from '../../constants/gearSets';

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

    it('labels every role-table stat from STATS, never a hand-typed name', () => {
        // Guards against the roles table drifting from StatGuideTable's names (e.g. a
        // hand-typed "Crit Damage" next to StatGuideTable's "Crit Power" for the same stat).
        const { container } = renderPage();
        for (const cat of Object.keys(ROLE_GUIDE) as (keyof typeof ROLE_GUIDE)[]) {
            const row = container.querySelector(`[data-testid="role-row-${cat}"]`);
            expect(row, cat).not.toBeNull();
            for (const stat of ROLE_GUIDE[cat].stats) {
                expect(row!.textContent, `${cat} / ${stat}`).toContain(STATS[stat].label);
            }
        }
    });

    it('never uses lane/column vocabulary in any locked targeting or gear-set constant', () => {
        // BasicsPage.test's rendered-text sweep above only sees what's MOUNTED —
        // TargetingBoard renders one rule/pattern description at a time, so the
        // never-rendered ones (e.g. back/skip/all) would slip through a render-only check.
        // This asserts directly over the source-of-truth constants instead.
        for (const rule of Object.values(TARGETING_RULES)) {
            expect(rule.description, rule.id).not.toMatch(/\blanes?\b/i);
            expect(rule.description, rule.id).not.toMatch(/\bcolumns?\b/i);
        }
        for (const shape of Object.values(PATTERN_SHAPES)) {
            expect(shape.label, shape.id).not.toMatch(/\blanes?\b/i);
            expect(shape.label, shape.id).not.toMatch(/\bcolumns?\b/i);
        }
        for (const set of Object.values(GEAR_SETS)) {
            if (typeof set.description !== 'string') continue;
            expect(set.description, set.name).not.toMatch(/\blanes?\b/i);
            expect(set.description, set.name).not.toMatch(/\bcolumns?\b/i);
        }
    });
});
