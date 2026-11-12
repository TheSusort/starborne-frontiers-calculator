// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { BattleResult } from '../../utils/calculators/battleSimulator';
import type { Ship } from '../../types/ship';
import type { Position } from '../../types/encounters';
import { encounterBoard } from '../../utils/simulator/bossBoard';
// vi.mock calls below are hoisted above these imports, so the page import is safe here.
import SimulatorPage from '../SimulatorPage';

const playerShip = { id: 's-player', name: 'Nova' } as unknown as Ship;
const enemyShip = { id: 's-enemy', name: 'Hexa' } as unknown as Ship;

const actor = (actorId: string, side: 'player' | 'enemy', damageDealt: number) => ({
    actorId,
    side,
    damageDealt,
    damageTaken: 0,
    healingDone: 0,
});

const battleResult = {
    rounds: [
        {
            round: 1,
            ships: [actor('p0', 'player', 1000), actor('e0', 'enemy', 100)],
            turnOrder: ['p0', 'e0'],
        },
    ],
    outcome: { winner: 'player', lastRound: 1 },
    roster: [
        { actorId: 'p0', side: 'player', name: 'Nova', position: 'T1' },
        { actorId: 'e0', side: 'enemy', name: 'Hexa', position: 'T4' },
    ],
    combatLog: [],
} as unknown as BattleResult;

vi.mock('../../utils/calculators/battleSimulator', async () => {
    const actual = await vi.importActual<typeof import('../../utils/calculators/battleSimulator')>(
        '../../utils/calculators/battleSimulator'
    );
    return { ...actual, simulateBattle: vi.fn(() => battleResult) };
});

// Stands in for the real board: exposes the writes the page takes from a board and renders the
// slots the page hands it.
vi.mock('../../components/simulator/PlacementBoard', () => ({
    default: ({
        title,
        formation,
        onSelectPosition,
        onPickShip,
        onLoadEncounter,
        headerSlot,
        footerSlot,
        hideHint,
    }: {
        title: string;
        formation: unknown[];
        onSelectPosition: (p: Position) => void;
        onPickShip: (s: Ship) => void;
        onLoadEncounter: (board: Record<string, unknown>) => void;
        headerSlot?: React.ReactNode;
        footerSlot?: React.ReactNode;
        hideHint?: boolean;
    }) => {
        const side = title.startsWith('Your') ? 'player' : 'enemy';
        return (
            <div data-testid={`board-${side}`} data-hide-hint={String(Boolean(hideHint))}>
                <button onClick={() => onSelectPosition('T1')}>select {side}</button>
                <button onClick={() => onPickShip(side === 'player' ? playerShip : enemyShip)}>
                    pick {side}
                </button>
                <button
                    onClick={() =>
                        onLoadEncounter(
                            encounterBoard('fenri', 32) as unknown as Record<string, unknown>
                        )
                    }
                >
                    load boss {side}
                </button>
                <span data-testid={`count-${side}`}>{formation.length}</span>
                <div data-testid={`header-${side}`}>{headerSlot}</div>
                <div data-testid={`footer-${side}`}>{footerSlot}</div>
            </div>
        );
    },
}));

vi.mock('../../components/simulator/BattlePlayback', () => ({
    default: () => <div>single battle playback</div>,
}));

let wide = true;
vi.mock('../../hooks/useMediaQuery', () => ({ useMediaQuery: () => wide }));
vi.mock('../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));
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

beforeEach(() => {
    localStorage.clear();
    wide = true;
});

const renderPage = () =>
    render(
        <MemoryRouter>
            <SimulatorPage />
        </MemoryRouter>
    );

const placeShips = () => {
    fireEvent.click(screen.getByText('select player'));
    fireEvent.click(screen.getByText('pick player'));
    fireEvent.click(screen.getByText('select enemy'));
    fireEvent.click(screen.getByText('pick enemy'));
};

const runBar = () => screen.getByTestId('run-bar');

describe('SimulatorPage setup strip', () => {
    it('collapses the boards into a strip of ship names once a run completes', () => {
        renderPage();
        placeShips();
        expect(screen.getByTestId('board-player')).toBeInTheDocument();
        expect(screen.queryByTestId('setup-strip')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Run Simulation/i }));

        const strip = screen.getByTestId('setup-strip');
        expect(within(strip).getByText('Nova')).toBeInTheDocument();
        expect(within(strip).getByText('Hexa')).toBeInTheDocument();
        expect(within(strip).getByText('VS')).toBeInTheDocument();
        expect(screen.queryByTestId('board-player')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Setup name')).not.toBeInTheDocument();
    });

    it('brings the boards back on Edit setup and collapses again on the next run', () => {
        renderPage();
        placeShips();
        fireEvent.click(screen.getByRole('button', { name: /Run Simulation/i }));

        fireEvent.click(screen.getByRole('button', { name: 'Edit setup' }));
        expect(screen.getByTestId('board-player')).toBeInTheDocument();
        expect(screen.queryByTestId('setup-strip')).not.toBeInTheDocument();
        // The result survives editing: the boards are not what the result was derived from.
        expect(screen.getByText('Your win rate')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Run Simulation/i }));
        expect(screen.getByTestId('setup-strip')).toBeInTheDocument();
        expect(screen.queryByTestId('board-player')).not.toBeInTheDocument();
    });

    it('stays expanded while a rerun is pending or cancelled, and folds when a new result lands', async () => {
        renderPage();
        placeShips();
        fireEvent.change(screen.getByLabelText('Runs'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: /Run Simulation/i }));
        await screen.findByTestId('setup-strip');

        fireEvent.click(screen.getByRole('button', { name: 'Edit setup' }));
        fireEvent.click(screen.getByRole('button', { name: /Run Simulation/i }));
        // Running: the previous result is still shown and the setup stays open.
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
        expect(screen.getByTestId('board-player')).toBeInTheDocument();
        expect(screen.queryByTestId('setup-strip')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await screen.findByRole('button', { name: /Run Simulation/i });
        expect(screen.getByTestId('board-player')).toBeInTheDocument();
        expect(screen.queryByTestId('setup-strip')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Run Simulation/i }));
        await screen.findByTestId('setup-strip');
        expect(screen.queryByTestId('board-player')).not.toBeInTheDocument();
    });

    it('opening a seed does not re-expand the setup', async () => {
        renderPage();
        placeShips();
        fireEvent.change(screen.getByLabelText('Runs'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: /Run Simulation/i }));
        const squares = await screen.findAllByRole('button', { name: /^Seed \d+:/ });
        fireEvent.click(squares[1]);
        expect(screen.getByTestId('setup-strip')).toBeInTheDocument();
    });

    it('groups duplicate ship names and names the boss with its level', () => {
        renderPage();
        placeShips();
        fireEvent.click(screen.getByText('load boss enemy'));
        fireEvent.click(screen.getByRole('button', { name: /Run Simulation/i }));

        const strip = screen.getByTestId('setup-strip');
        expect(within(strip).getByText(/Fenri Khaliriz.*32/)).toBeInTheDocument();
    });
});

describe('SimulatorPage board mode and footers', () => {
    it('puts each squad leader picker in its board footer', () => {
        renderPage();
        expect(within(screen.getByTestId('footer-player')).getByLabelText(/faction/i)).toBeTruthy();
        expect(within(screen.getByTestId('footer-enemy')).getByLabelText(/faction/i)).toBeTruthy();
    });

    it('shows the click hint once, below both boards, and hides it on each board', () => {
        renderPage();
        expect(screen.getAllByText(/Click to select a ship/)).toHaveLength(1);
        expect(screen.getByTestId('board-player')).toHaveAttribute('data-hide-hint', 'true');
        expect(screen.getByTestId('board-enemy')).toHaveAttribute('data-hide-hint', 'true');
    });

    it('reveals the boss picker only in Bounty boss mode', () => {
        renderPage();
        const header = screen.getByTestId('header-enemy');
        expect(within(header).queryByLabelText('Encounter')).not.toBeInTheDocument();
        fireEvent.click(within(header).getByRole('button', { name: 'Bounty boss' }));
        expect(within(header).getByLabelText('Encounter')).toBeInTheDocument();
        expect(within(header).getByRole('button', { name: 'Bounty boss' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
    });

    it('derives boss mode from a loaded boss, and Team clears it', () => {
        renderPage();
        fireEvent.click(screen.getByText('load boss enemy'));
        const header = screen.getByTestId('header-enemy');
        expect(within(header).getByRole('button', { name: 'Bounty boss' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        expect(screen.getByTestId('count-enemy')).not.toHaveTextContent('0');
        // A boss has no squad leader, so the footer says so instead of offering a picker.
        expect(screen.getByTestId('footer-enemy')).toHaveTextContent(/no squad leader/i);
        expect(within(screen.getByTestId('footer-enemy')).queryByLabelText(/faction/i)).toBeNull();

        fireEvent.click(within(header).getByRole('button', { name: 'Team' }));
        expect(screen.getByTestId('count-enemy')).toHaveTextContent('0');
        expect(within(header).queryByLabelText('Encounter')).not.toBeInTheDocument();
        expect(within(screen.getByTestId('footer-enemy')).getByLabelText(/faction/i)).toBeTruthy();
    });

    it('disables Bounty boss on the small grid', () => {
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: 'Small · 7' }));
        expect(
            within(screen.getByTestId('header-enemy')).getByRole('button', { name: 'Bounty boss' })
        ).toBeDisabled();
    });

    it('says in visible text why Bounty boss is disabled on the small grid', () => {
        renderPage();
        expect(screen.queryByText('Bounty bosses need the normal board.')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Small · 7' }));
        expect(screen.getByText('Bounty bosses need the normal board.')).toBeInTheDocument();
    });

    it('blocks the run in boss mode until a boss is chosen, without clearing the enemy team', () => {
        renderPage();
        placeShips();
        expect(screen.getByRole('button', { name: /Run Simulation/i })).toBeEnabled();

        fireEvent.click(
            within(screen.getByTestId('header-enemy')).getByRole('button', { name: 'Bounty boss' })
        );

        expect(screen.getByRole('button', { name: /Run Simulation/i })).toBeDisabled();
        expect(within(runBar()).getByText('Pick a bounty boss to run.')).toBeInTheDocument();
        expect(screen.getByTestId('count-enemy')).toHaveTextContent('1');

        fireEvent.click(screen.getByText('load boss enemy'));
        expect(screen.getByRole('button', { name: /Run Simulation/i })).toBeEnabled();
        expect(screen.queryByText('Pick a bounty boss to run.')).not.toBeInTheDocument();
    });
});

describe('SimulatorPage run bar', () => {
    it('is a sticky bar below modals and the select listbox, with no overflow ancestor', () => {
        renderPage();
        const bar = runBar();
        expect(bar.className).toMatch(/\bsticky\b/);
        expect(bar.className).toMatch(/\bbottom-0\b/);
        expect(bar.className).toMatch(/\bz-30\b/);
        for (let el = bar.parentElement; el; el = el.parentElement) {
            expect(el.className).not.toMatch(/overflow-/);
        }
    });

    it('holds the summary, seed controls and Run, and the hint while a side is empty', () => {
        renderPage();
        const bar = within(runBar());
        expect(bar.getByText(/0 vs 0/)).toBeInTheDocument();
        expect(bar.getByText(/Normal grid/)).toBeInTheDocument();
        expect(bar.getByText(/no squad leaders/i)).toBeInTheDocument();
        expect(bar.getByLabelText('Seed')).toBeInTheDocument();
        expect(bar.getByRole('button', { name: /Run Simulation/i })).toBeDisabled();
        expect(bar.getByText('Place at least one ship on each team to run.')).toBeInTheDocument();
    });

    it('summarises the matchup and the last result', async () => {
        renderPage();
        placeShips();
        expect(within(runBar()).getByText(/1 vs 1/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Runs'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: /Run Simulation/i }));
        await screen.findAllByRole('button', { name: /^Seed \d+:/ });
        expect(within(runBar()).getByText('Last run: 3 / 3 wins')).toBeInTheDocument();
    });

    it('says Boss when the enemy side is a boss', () => {
        renderPage();
        fireEvent.click(screen.getByText('pick player'));
        fireEvent.click(screen.getByText('load boss enemy'));
        expect(within(runBar()).getByText(/vs Boss/)).toBeInTheDocument();
    });

    it('moves Pin as baseline into the bar, and hides it once a baseline is pinned', async () => {
        renderPage();
        placeShips();
        fireEvent.change(screen.getByLabelText('Runs'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: /Run Simulation/i }));
        await screen.findAllByRole('button', { name: /^Seed \d+:/ });

        const pin = screen.getByRole('button', { name: 'Pin as baseline' });
        expect(runBar()).toContainElement(pin);

        fireEvent.click(pin);
        expect(screen.queryByRole('button', { name: 'Pin as baseline' })).not.toBeInTheDocument();
        expect(
            within(runBar()).getByRole('button', { name: 'Unpin baseline' })
        ).toBeInTheDocument();
    });

    it('on a phone keeps only the summary and Run in the bar, the rest in flow above the tabs', () => {
        wide = false;
        renderPage();
        const bar = within(runBar());
        expect(bar.getByText(/0 vs 0/)).toBeInTheDocument();
        expect(bar.getByRole('button', { name: /Run Simulation/i })).toBeInTheDocument();
        expect(bar.queryByLabelText('Seed')).not.toBeInTheDocument();
        expect(bar.queryByRole('button', { name: /new seed/i })).not.toBeInTheDocument();

        const seed = screen.getByLabelText('Seed');
        expect(runBar()).not.toContainElement(seed);
        const tabs = screen.getByRole('navigation', { name: 'Tabs' });
        expect(seed.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
