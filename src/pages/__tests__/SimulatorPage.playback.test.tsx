// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { BattleResult } from '../../utils/calculators/battleSimulator';
import type { Ship } from '../../types/ship';
// vi.mock calls below are hoisted above these imports, so the page import is safe here.
import SimulatorPage from '../SimulatorPage';

// Canned battle result returned by the mocked simulateBattle — exercises the playback
// wiring (boards + overlays + outcome) without running the real engine.
const battleResult: BattleResult = {
    rounds: [
        {
            round: 1,
            ships: [
                {
                    actorId: 'attacker',
                    side: 'player',
                    damageDealt: 1000,
                    damageTaken: 0,
                    healingDone: 0,
                    healingReceived: 0,
                    shieldsAbsorbed: 0,
                    shieldGranted: 0,
                    shieldStripped: 0,
                    currentShieldPool: 0,
                    incomingDamage: 0,
                    incomingShieldAbsorbed: 0,
                    incomingBarrierAbsorbed: 0,
                    hpPct: 100,
                    shieldPct: 0,
                    alive: true,
                    activeBuffs: [],
                    activeDebuffs: [],
                },
                {
                    actorId: 'e:enemy:0',
                    side: 'enemy',
                    damageDealt: 0,
                    damageTaken: 1000,
                    healingDone: 0,
                    healingReceived: 0,
                    shieldsAbsorbed: 0,
                    shieldGranted: 0,
                    shieldStripped: 0,
                    currentShieldPool: 0,
                    incomingDamage: 0,
                    incomingShieldAbsorbed: 0,
                    incomingBarrierAbsorbed: 0,
                    hpPct: 40,
                    shieldPct: 0,
                    alive: true,
                    activeBuffs: [],
                    activeDebuffs: [],
                },
            ],
            turnOrder: ['attacker', 'e:enemy:0'],
        },
        {
            round: 2,
            ships: [
                {
                    actorId: 'attacker',
                    side: 'player',
                    damageDealt: 1500,
                    damageTaken: 0,
                    healingDone: 0,
                    healingReceived: 0,
                    shieldsAbsorbed: 0,
                    shieldGranted: 0,
                    shieldStripped: 0,
                    currentShieldPool: 0,
                    incomingDamage: 0,
                    incomingShieldAbsorbed: 0,
                    incomingBarrierAbsorbed: 0,
                    hpPct: 100,
                    shieldPct: 0,
                    alive: true,
                    activeBuffs: [],
                    activeDebuffs: [],
                },
                {
                    actorId: 'e:enemy:0',
                    side: 'enemy',
                    damageDealt: 0,
                    damageTaken: 2500,
                    healingDone: 0,
                    healingReceived: 0,
                    shieldsAbsorbed: 0,
                    shieldGranted: 0,
                    shieldStripped: 0,
                    currentShieldPool: 0,
                    incomingDamage: 0,
                    incomingShieldAbsorbed: 0,
                    incomingBarrierAbsorbed: 0,
                    hpPct: 0,
                    shieldPct: 0,
                    alive: false,
                    activeBuffs: [],
                    activeDebuffs: [],
                },
            ],
            turnOrder: ['attacker', 'e:enemy:0'],
        },
    ],
    outcome: { winner: 'player', lastRound: 2 },
    roster: [
        { actorId: 'attacker', side: 'player', name: 'Nova', position: 'T1' },
        { actorId: 'e:enemy:0', side: 'enemy', name: 'Hexa', position: 'T4' },
    ],
    // Hierarchical combat log rendered by RoundEventLog (T10). `assembleBattleResult` derives
    // `rounds` and `combatLog` from the same event stream, so a two-round result carries a
    // combatLog round per battle round. Round 1: Nova chips Hexa to 40%. Round 2: Nova lands
    // the kill (Hexa → 0%).
    combatLog: [
        {
            round: 1,
            startOfRound: [],
            turns: [
                {
                    actorId: 'attacker',
                    chargeBefore: 0,
                    chargeMax: 0,
                    entries: [
                        {
                            kind: 'attack',
                            actorId: 'attacker',
                            slot: 'active',
                            targets: [
                                {
                                    targetId: 'e:enemy:0',
                                    amount: 1000,
                                    didHit: true,
                                    resultingHpPct: 40,
                                },
                            ],
                            reactions: [],
                        },
                    ],
                },
            ],
            endOfRound: [],
        },
        {
            round: 2,
            startOfRound: [],
            turns: [
                {
                    actorId: 'attacker',
                    chargeBefore: 0,
                    chargeMax: 0,
                    entries: [
                        {
                            kind: 'attack',
                            actorId: 'attacker',
                            slot: 'active',
                            targets: [
                                {
                                    targetId: 'e:enemy:0',
                                    amount: 1500,
                                    didHit: true,
                                    resultingHpPct: 0,
                                },
                            ],
                            reactions: [],
                        },
                    ],
                },
            ],
            endOfRound: [],
        },
    ],
};

vi.mock('../../utils/calculators/battleSimulator', async () => {
    const actual = await vi.importActual<typeof import('../../utils/calculators/battleSimulator')>(
        '../../utils/calculators/battleSimulator'
    );
    return { ...actual, simulateBattle: vi.fn(() => battleResult) };
});

const fakeShip = { id: 's1', name: 'Nova' } as unknown as Ship;

// Lightweight PlacementBoard mock: a button that immediately picks a ship so canRun flips
// true — the placement flow itself is Task 2's concern, not Task 4's.
// The page only commits a pick when a cell is selected, and state flushes between renders —
// so expose select and pick as separate buttons and click them in sequence.
vi.mock('../../components/simulator/PlacementBoard', () => ({
    default: ({
        title,
        onSelectPosition,
        onPickShip,
    }: {
        title: string;
        onSelectPosition: (p: 'T1') => void;
        onPickShip: (s: Ship) => void;
    }) => (
        <div>
            <button onClick={() => onSelectPosition('T1')}>select {title}</button>
            <button onClick={() => onPickShip(fakeShip)}>pick {title}</button>
        </div>
    ),
}));

vi.mock('../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
vi.mock('../../components/seo/Seo', () => ({ default: () => null }));
vi.mock('../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [], getShipById: () => undefined }),
}));
vi.mock('../../hooks/useShipsData', () => ({ useShipsData: () => ({ ships: [] }) }));
vi.mock('../../contexts/InventoryProvider', () => ({
    useInventory: () => ({ getGearPiece: () => undefined }),
}));
vi.mock('../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({ getEngineeringStatsForShipType: () => undefined }),
}));
vi.mock('../../utils/ship/combatStats', () => ({
    shipFinalStats: () => ({}),
    combatStatsFromShip: () => ({}),
}));

// The page autosaves its setup to localStorage and restores it on mount, so a setup left
// behind by one test would load itself into the next one's boards.
beforeEach(() => localStorage.clear());

describe('SimulatorPage playback', () => {
    it('after a Run shows the boards with HP content and the outcome', () => {
        render(
            <MemoryRouter>
                <SimulatorPage />
            </MemoryRouter>
        );

        // Place a ship on each side: select a cell, then pick (separate renders).
        fireEvent.click(screen.getByText(/select Your Team/i));
        fireEvent.click(screen.getByText(/pick Your Team/i));
        fireEvent.click(screen.getByText(/select Enemy Team/i));
        fireEvent.click(screen.getByText(/pick Enemy Team/i));

        fireEvent.click(screen.getByRole('button', { name: /Run Simulation/i }));

        // Outcome surfaced.
        expect(screen.getByText('Your team wins')).toBeInTheDocument();
        // Boards render the roster ships at their positions with their round-end HP (player
        // full, enemy at 40%).
        expect(screen.getByLabelText('Nova at T1, 100% HP')).toBeInTheDocument();
        expect(screen.getByLabelText('Hexa at T4, 40% HP')).toBeInTheDocument();
        // Stepper reports two rounds, starting on round 1.
        expect(screen.getByText('Round 1 / 2')).toBeInTheDocument();

        // Event log renders the real combat-log content for the current round: the turn
        // header for the acting ship and the attack line against the enemy.
        expect(screen.getByText(/Nova's turn/)).toBeInTheDocument();
        expect(screen.getByText(/Nova \[active\] → Enemy Hexa: 1,000 → 40%/)).toBeInTheDocument();

        // Step to round 2: the enemy is destroyed (HP 0%).
        fireEvent.click(screen.getByRole('button', { name: /Next round/i }));
        expect(screen.getByText('Round 2 / 2')).toBeInTheDocument();
        expect(screen.getByLabelText('Hexa at T4, 0% HP, destroyed')).toBeInTheDocument();
        // The event log re-renders for round 2 (the killing blow), not the round-1 content.
        expect(screen.getByText(/Nova \[active\] → Enemy Hexa: 1,500 → 0%/)).toBeInTheDocument();
    });
});

describe('SimulatorPage results area', () => {
    const renderPage = () =>
        render(
            <MemoryRouter>
                <SimulatorPage />
            </MemoryRouter>
        );

    const placeShips = () => {
        fireEvent.click(screen.getByText(/select Your Team/i));
        fireEvent.click(screen.getByText(/pick Your Team/i));
        fireEvent.click(screen.getByText(/select Enemy Team/i));
        fireEvent.click(screen.getByText(/pick Enemy Team/i));
    };

    const runSeeds = async (count: number) => {
        placeShips();
        fireEvent.change(screen.getByLabelText('Runs'), { target: { value: String(count) } });
        fireEvent.click(screen.getByRole('button', { name: /Run Simulation/i }));
        // The seed set runs asynchronously; the strip appears once it lands.
        await screen.findAllByRole('button', { name: /^Seed \d+:/ });
    };

    const seedSquares = () => screen.getAllByRole('button', { name: /^Seed \d+:/ });

    it('shows an empty playback state before any run', () => {
        renderPage();
        expect(screen.getByText('Run a simulation to watch the fight here.')).toBeInTheDocument();
    });

    it('opens the first seed of a multi-seed run without a click', async () => {
        renderPage();
        await runSeeds(3);

        expect(seedSquares()).toHaveLength(3);
        expect(seedSquares()[0]).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('Round 1 / 2')).toBeInTheDocument();
        expect(screen.getByLabelText('Nova at T1, 100% HP')).toBeInTheDocument();
        expect(screen.queryByText('Run a simulation to watch the fight here.')).toBeNull();
    });

    it('shows the clicked seed and marks it', async () => {
        renderPage();
        await runSeeds(3);

        fireEvent.click(seedSquares()[2]);

        expect(seedSquares()[2]).toHaveAttribute('aria-pressed', 'true');
        expect(seedSquares()[0]).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByText(/Seed \d+ · 3 of 3/)).toBeInTheDocument();
        expect(screen.getByText('Round 1 / 2')).toBeInTheDocument();
    });

    it('summarises a single run with verdict tiles', () => {
        renderPage();
        placeShips();
        fireEvent.click(screen.getByRole('button', { name: /Run Simulation/i }));

        expect(screen.getByText('Your win rate').parentElement).toHaveTextContent('100%');
        expect(screen.getByText('Fight length').parentElement).toHaveTextContent('2');
        expect(screen.getByText('Your top damage').parentElement).toHaveTextContent('2,500');
    });

    it('summarises a multi-seed run with verdict tiles and a grouped breakdown', async () => {
        renderPage();
        await runSeeds(3);

        expect(screen.getByText('Your win rate').parentElement).toHaveTextContent('3 of 3');
        const table = screen.getByRole('table');
        expect(within(table).getByText('Your team')).toBeInTheDocument();
        expect(within(table).getByText('Enemy')).toBeInTheDocument();
    });

    it('explains the empty compare tab when no baseline is pinned', async () => {
        renderPage();
        await runSeeds(3);

        fireEvent.click(screen.getByRole('button', { name: 'Compare to baseline' }));

        expect(
            screen.getByText(
                'Run several seeds, then use Pin as baseline in the run controls to compare later runs against it.'
            )
        ).toBeInTheDocument();
        expect(screen.queryByText('Round 1 / 2')).toBeNull();
    });

    it('renders the stat sweep open inside its own tab and keeps it out of view otherwise', () => {
        renderPage();
        const sweepBody = () => screen.getByText(/A sweep holds every other stat fixed/);
        expect(sweepBody()).not.toBeVisible();

        fireEvent.click(screen.getByRole('button', { name: 'Stat sweep' }));

        expect(sweepBody()).toBeVisible();
        expect(screen.queryByTestId('sweep-toggle')).toBeNull();
    });
});
