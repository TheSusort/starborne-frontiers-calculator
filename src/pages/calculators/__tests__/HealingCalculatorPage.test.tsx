import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HealingCalculatorPage from '../HealingCalculatorPage';
import type { Ship } from '../../../types/ship';

const mockGetShipById = vi.fn((_id: string): Ship | undefined => undefined);

// Heavy contexts and the chart library are mocked: this is a render smoke that verifies the page
// mounts with its panels and a default healer config, exercising the simulateHealing wiring.
vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [], getShipById: mockGetShipById }),
}));
vi.mock('../../../contexts/InventoryProvider', () => ({
    useInventory: () => ({ getGearPiece: () => undefined }),
}));
vi.mock('../../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({ getEngineeringStatsForShipType: () => undefined }),
}));
vi.mock('../../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));
// ShipSelector pulls in ShipDisplay, which needs many context providers — stub it out. Only the
// tests that actually pick a ship reach it.
vi.mock('../../../components/ship/ShipSelector', () => ({ ShipSelector: () => null }));
vi.mock('../../../components/seo/Seo', () => ({ default: () => null }));
vi.mock('../../../hooks/useThemeColors', () => ({
    useThemeColors: () => ({ gridStroke: '#000', text: '#fff' }),
}));

vi.mock('recharts', () => {
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return {
        ComposedChart: Pass,
        LineChart: Pass,
        Bar: () => null,
        Line: () => null,
        XAxis: () => null,
        YAxis: () => null,
        CartesianGrid: () => null,
        Tooltip: () => null,
        ResponsiveContainer: Pass,
    };
});

/** A support healer whose footprint is deliberately TINY: Line-Support-Range-1 from M2 covers
 *  {M2, M3} only, so the default team ship at M1 is off-pattern and receives nothing. */
const supportHealer: Ship = {
    id: 'support-healer',
    name: 'Kindly Medic',
    rarity: 'LEGENDARY',
    faction: 'ATLAS_SYNDICATE',
    type: 'SUPPORTER',
    baseStats: {
        hp: 40000,
        attack: 10000,
        defence: 5000,
        hacking: 200,
        security: 0,
        crit: 50,
        critDamage: 100,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    activeTarget: 'allies',
    activePattern: 'Pattern-Line-Support-Range-1',
};

describe('HealingCalculatorPage', () => {
    beforeEach(() => {
        mockGetShipById.mockReset();
        mockGetShipById.mockReturnValue(undefined);
    });

    it('renders the page with panels and a default healer config', () => {
        render(
            <MemoryRouter>
                <HealingCalculatorPage />
            </MemoryRouter>
        );
        expect(screen.getByText('Healing Calculator')).toBeInTheDocument();
        expect(screen.getByText('Heal Target')).toBeInTheDocument();
        expect(screen.getByText(/Enemy Team/)).toBeInTheDocument();
        expect(screen.getByText('Team')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Healer 1')).toBeInTheDocument();
        // Results summary renders → simulateHealing ran without throwing (the StatCard title and
        // the timeline legend both surface "Effective Healing").
        expect(screen.getAllByText('Effective Healing').length).toBeGreaterThan(0);
        expect(screen.getByText('About the Simulation')).toBeInTheDocument();
    });

    it('removeEnemy: clicking X on the only enemy attacker reduces the count to 0', () => {
        render(
            <MemoryRouter>
                <HealingCalculatorPage />
            </MemoryRouter>
        );
        // Initially one enemy → count shows (1).
        expect(screen.getByText(/Enemy Team \(1\)/)).toBeInTheDocument();
        // Click the remove button for the first (and only) enemy attacker.
        fireEvent.click(screen.getByLabelText('Remove enemy'));
        // Guard removed → count now shows (0).
        expect(screen.getByText(/Enemy Team \(0\)/)).toBeInTheDocument();
    });

    // ── Decision 8: the uncovered-placement warning ─────────────────────────────
    // An ally outside every supporter's footprint receives EXACTLY ZERO healing (owner-ruled
    // game-faithful, never softened). A silent zero is indistinguishable from a bug, so the page
    // must say so. This is the safety net for the whole positional model.
    it("warns that an ally outside the healer's support footprint gets no healing", () => {
        mockGetShipById.mockImplementation((id) =>
            id === supportHealer.id ? supportHealer : undefined
        );
        render(
            <MemoryRouter initialEntries={[`/healing?shipId=${supportHealer.id}`]}>
                <HealingCalculatorPage />
            </MemoryRouter>
        );
        // The healer starts at M2, whose Line-Support-Range-1 footprint is {M2, M3}; the default
        // team ship sits at M1 — outside it.
        expect(screen.getByText('Placement warning')).toBeInTheDocument();
        expect(
            screen.getByText(
                "Team 1 is outside Kindly Medic's support pattern and will receive no healing from it."
            )
        ).toBeInTheDocument();
    });

    it('survives a ship whose targeting strings do not parse', () => {
        // BOTH axes of parseShipTargeting THROW on an unrecognised string (parseTarget's 8-entry
        // map; parsePattern's detectShape), and the page parses ship targeting on its RENDER path —
        // so one stale value in a stored ship record would crash the whole page rather than degrade.
        mockGetShipById.mockImplementation((id) =>
            id === supportHealer.id
                ? { ...supportHealer, activePattern: 'Pattern-Interpretive-Dance' }
                : undefined
        );
        render(
            <MemoryRouter initialEntries={[`/healing?shipId=${supportHealer.id}`]}>
                <HealingCalculatorPage />
            </MemoryRouter>
        );
        // The page still renders, and with no resolvable pattern there is no supporter to be
        // outside of — so no warning either.
        expect(screen.getByText('Healing Calculator')).toBeInTheDocument();
        expect(screen.queryByText('Placement warning')).not.toBeInTheDocument();
    });

    it('shows NO placement warning for a manual healer with no support pattern', () => {
        // ANTI-VACUITY CONTRAST for the test above: the default page has no supporter at all, so
        // nothing is "uncovered" — warning on every ally of a damage-only team would be noise.
        render(
            <MemoryRouter>
                <HealingCalculatorPage />
            </MemoryRouter>
        );
        expect(screen.queryByText('Placement warning')).not.toBeInTheDocument();
    });
});
