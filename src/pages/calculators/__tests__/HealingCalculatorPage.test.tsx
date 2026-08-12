import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HealingCalculatorPage from '../HealingCalculatorPage';
import type { Ship } from '../../../types/ship';
import { parseShipTargeting } from '../../../utils/targetingParser';

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

/** The measured Volk shape. `Pattern-Line-Support-from-centre-Range-1` from M2 covers {M2, M1, M3},
 *  so the heal target's coverage-aware default is M1 — which is ALSO the first team ship's default
 *  cell. That single overlap is what a seeded (and therefore "explicit"-looking) team-ship position
 *  turned into a zero, so it is the fixture for the priority guard below.
 *
 *  Unlike `supportHealer` this one carries a real, parseable ally heal, so the guard can assert the
 *  page's own reported NUMBER rather than only its warning text. */
const centreSupportHealer: Ship = {
    ...supportHealer,
    id: 'centre-healer',
    name: 'Centre Medic',
    activePattern: 'Pattern-Line-Support-from-centre-Range-1',
    activeSkillText:
        "This unit <unit-damage>repairs the ally for 40%</unit-damage> of this Unit's Max HP.",
    // Crit zeroed so the asserted total is derivable by hand (40% x 40,000 hp x 20 rounds) instead of
    // depending on where the crit accumulator's schedule happens to place its crits.
    baseStats: { ...supportHealer.baseStats, crit: 0, critDamage: 0 },
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

    // ── A team ship the user never touched must not outrank the heal target ─────
    //
    // ⚠️ THE HEADLINE-METRIC GUARD. `position` on a team ship means "the user picked this cell":
    // `resolveHealingPlayerPlacement` lets an explicit placement beat the heal target's
    // coverage-aware default (correctly — the user is authoritative), and the loser is MOVED to the
    // first free cell in `ATTACKER_SLOT_OPTIONS` order, chosen with no knowledge of coverage. Off the
    // footprint a heal delivers EXACTLY ZERO, and that zero is never softened.
    //
    // So the page must never present an untouched ship as a placement. It used to: it seeded
    // `defaultHealingTeamSlot(index)` into team-ship state at creation and always forwarded it, which
    // made a freshly configured board — one default team ship, an unplaced heal target — report total
    // healing 0. Measured before this fix: heal target evicted M1 → T1, outside {M2, M1, M3}.
    //
    // Asserted on BOTH observables the user has: the reported healing number (through the real
    // `simulateHealing` call, so this is the end-to-end guard) and the warning, which reads the same
    // shared resolver the sim does and therefore names whoever actually lost the cell.
    it('a default team ship does not evict the heal target off its covered cell', () => {
        mockGetShipById.mockImplementation((id) =>
            id === centreSupportHealer.id ? centreSupportHealer : undefined
        );
        render(
            <MemoryRouter initialEntries={[`/healing?shipId=${centreSupportHealer.id}`]}>
                <HealingCalculatorPage />
            </MemoryRouter>
        );
        // A separate heal target is what puts the heal target on the board as its own actor; while
        // the healer heals itself it always stands on its own (always-covered) anchor cell.
        fireEvent.click(screen.getByLabelText('Use healer as target (heal self)'));

        // THE NUMBER, and it pins the VALUE rather than a floor: 40% of the healer's 40,000 max HP is
        // 16,000 a cast, over the default 20 rounds = 320,000 — i.e. the full cast landing on the heal
        // target EVERY round. A floor would stay green on a partial regression; 0 is what this page
        // reported before the fix. (Raw, not effective: the heal target defaults behind the healer, so
        // it takes no fire and every point is overheal — an independent axis, decision 2's accepted
        // trade-off, not a healing failure.)
        expect(screen.getByText('Direct Heal (raw)').parentElement).toHaveTextContent('320,000');
        // The heal target is unplaced, so it takes the coverage-aware M1 and the untouched team ship
        // is the one that gives way. The heal target must NOT be the one named.
        expect(screen.queryByText(/^Heal Target is outside/)).not.toBeInTheDocument();
        // ANTI-VACUITY: the warning really is rendering for this board (the displaced team ship is
        // genuinely off-footprint), so the absence above is about WHO lost the cell — not about a
        // fixture that produces no warning at all.
        expect(
            screen.getByText(
                "Team 1 is outside Centre Medic's support pattern and will receive no healing from it."
            )
        ).toBeInTheDocument();
    });

    it('survives a ship whose targeting strings do not parse', () => {
        // BOTH axes of parseShipTargeting THROW on an unrecognised string (parseTarget's 8-entry
        // map; parsePattern's detectShape), and the page parses ship targeting on its RENDER path —
        // so one stale value in a stored ship record would crash the whole page rather than degrade.
        const brokenPattern = { ...supportHealer, activePattern: 'Pattern-Interpretive-Dance' };
        // Precondition: the guarded call really does throw on this input. Without it the test proves
        // only that the page renders, which it does for any ship — the try/catch could be deleted and
        // this would stay green.
        expect(() => parseShipTargeting(brokenPattern)).toThrow();
        mockGetShipById.mockImplementation((id) =>
            id === supportHealer.id ? brokenPattern : undefined
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

    it('survives a ship whose TARGET string does not parse', () => {
        // The other throwing axis, and it needs its own case: `parseTarget` throws on anything outside
        // its 8-entry map, entirely independently of the pattern — a fixture with a valid pattern and
        // a stale target reaches the same try/catch by a different route.
        const brokenTarget = { ...supportHealer, activeTarget: 'whoever-feels-worst' };
        expect(() => parseShipTargeting(brokenTarget)).toThrow();
        mockGetShipById.mockImplementation((id) =>
            id === supportHealer.id ? brokenTarget : undefined
        );
        render(
            <MemoryRouter initialEntries={[`/healing?shipId=${supportHealer.id}`]}>
                <HealingCalculatorPage />
            </MemoryRouter>
        );
        expect(screen.getByText('Healing Calculator')).toBeInTheDocument();
        // `targetingOf` falls back to NO targeting at all, so the (perfectly valid) support pattern
        // is discarded with it and there is no supporter to be outside of.
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
