import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

        fireEvent.click(screen.getByRole('button', { name: /Run/i }));

        // Outcome surfaced.
        expect(screen.getByText('Your team wins')).toBeInTheDocument();
        // Boards render the roster ships at their positions. "Nova" also appears in the
        // turn-order strip below the boards, so assert at least one (board) occurrence.
        expect(screen.getAllByText('Nova').length).toBeGreaterThan(0);
        expect(screen.getByText('Hexa')).toBeInTheDocument();
        // HP bars present (player full, enemy at 40%).
        expect(screen.getByTestId('hp-bar-T1')).toHaveStyle({ width: '100%' });
        expect(screen.getByTestId('hp-bar-T4')).toHaveStyle({ width: '40%' });
        // Stepper reports two rounds, starting on round 1.
        expect(screen.getByText('Round 1 / 2')).toBeInTheDocument();

        // Event log renders the real combat-log content for the current round: the turn
        // header for the acting ship and the attack line against the enemy.
        expect(screen.getByText(/Nova's turn/)).toBeInTheDocument();
        expect(screen.getByText(/Nova \[active\] → Enemy Hexa: 1,000 → 40%/)).toBeInTheDocument();

        // Step to round 2: the enemy is destroyed (HP 0%).
        fireEvent.click(screen.getByRole('button', { name: /Next round/i }));
        expect(screen.getByText('Round 2 / 2')).toBeInTheDocument();
        expect(screen.getByTestId('hp-bar-T4')).toHaveStyle({ width: '0%' });
        // The event log re-renders for round 2 (the killing blow), not the round-1 content.
        expect(screen.getByText(/Nova \[active\] → Enemy Hexa: 1,500 → 0%/)).toBeInTheDocument();
    });
});
