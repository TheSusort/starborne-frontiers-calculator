import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { BattleResult } from '../../utils/calculators/battleSimulator';
import SimulatorPage from '../SimulatorPage';

// Pins the page's wiring of the hook's divergence state: `onOpenDivergence` reaching
// `handleOpenDivergence`, `onClose` reaching `handleCloseDivergence` (not `handleUnpinBaseline`),
// the divergence pair replacing the single playback rather than joining it, and the
// squad-leader-unsimulated caveat surfacing per side while a pair is open. The hook's own state
// transitions are covered by useSimulatorRuns.test.ts; this file only pins the page's use of
// what the hook returns.

const handleOpenDivergence = vi.fn();
const handleCloseDivergence = vi.fn();
const handleUnpinBaseline = vi.fn();

const baselineResult = { outcome: { winner: 'player', lastRound: 1 } } as unknown as BattleResult;
const currentResult = { outcome: { winner: 'enemy', lastRound: 1 } } as unknown as BattleResult;
const singleBattleResult = {
    outcome: { winner: 'player', lastRound: 1 },
} as unknown as BattleResult;

// Base hook fixture, overridden per test. Fields the page does not read on the paths under
// test (canRun/handleRun/etc.) are stubbed just enough to satisfy the page's PropTypes.
const baseHookReturn = {
    battleResult: singleBattleResult as BattleResult | null,
    aggregate: null,
    baseline: null,
    divergence: null as { seed: number; baseline: BattleResult; current: BattleResult } | null,
    handleOpenDivergence,
    handleCloseDivergence,
    runError: null,
    effectiveSeed: 1,
    effectiveRunCount: 1,
    currentOverrides: null,
    canRun: true,
    handleRun: vi.fn(),
    handleOpenSeed: vi.fn(),
    handlePinBaseline: vi.fn(),
    handleUnpinBaseline,
    isRunning: false,
    progress: null,
    handleCancel: vi.fn(),
};

let hookReturn = { ...baseHookReturn };

vi.mock('../../hooks/useSimulatorRuns', () => ({
    useSimulatorRuns: () => hookReturn,
}));

vi.mock('../../components/simulator/SeedSetResults', () => ({
    default: () => null,
}));

vi.mock('../../components/simulator/RunComparison', () => ({
    default: ({ onOpenDivergence }: { onOpenDivergence: (seed: number) => void }) => (
        <button onClick={() => onOpenDivergence(42)}>open divergence for 42</button>
    ),
}));

vi.mock('../../components/simulator/DivergencePlayback', () => ({
    default: ({ seed, onClose }: { seed: number; onClose: () => void }) => (
        <div>
            <span>divergence playback for seed {seed}</span>
            <button onClick={onClose}>close divergence</button>
        </div>
    ),
}));

vi.mock('../../components/simulator/BattlePlayback', () => ({
    default: () => <div>single battle playback</div>,
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
vi.mock('../../hooks/useEncounterNotes', () => ({
    useEncounterNotes: () => ({ encounters: [], loading: false }),
}));

describe('SimulatorPage divergence wiring', () => {
    it('passes handleOpenDivergence (not a no-op) to RunComparison', () => {
        hookReturn = {
            ...baseHookReturn,
            aggregate: { runs: [] } as never,
            baseline: {} as never,
            currentOverrides: {} as never,
        };
        render(
            <MemoryRouter>
                <SimulatorPage />
            </MemoryRouter>
        );

        fireEvent.click(screen.getByText('open divergence for 42'));
        expect(handleOpenDivergence).toHaveBeenCalledWith(42);
    });

    it('renders the divergence pair instead of the single playback when a pair is open', () => {
        hookReturn = {
            ...baseHookReturn,
            divergence: { seed: 507, baseline: baselineResult, current: currentResult },
        };
        render(
            <MemoryRouter>
                <SimulatorPage />
            </MemoryRouter>
        );

        expect(screen.getByText('divergence playback for seed 507')).toBeInTheDocument();
        expect(screen.queryByText('single battle playback')).not.toBeInTheDocument();
    });

    it('renders the single playback when no pair is open', () => {
        hookReturn = { ...baseHookReturn };
        render(
            <MemoryRouter>
                <SimulatorPage />
            </MemoryRouter>
        );

        expect(screen.getByText('single battle playback')).toBeInTheDocument();
        expect(screen.queryByText(/divergence playback for seed/)).not.toBeInTheDocument();
    });

    it('closing a pair calls handleCloseDivergence, not handleUnpinBaseline', () => {
        hookReturn = {
            ...baseHookReturn,
            divergence: { seed: 507, baseline: baselineResult, current: currentResult },
        };
        render(
            <MemoryRouter>
                <SimulatorPage />
            </MemoryRouter>
        );

        fireEvent.click(screen.getByText('close divergence'));
        expect(handleCloseDivergence).toHaveBeenCalledTimes(1);
        expect(handleUnpinBaseline).not.toHaveBeenCalled();
    });

    it("surfaces only the baseline side's unsimulated squad-leader effects, labelled, when only it carries them", () => {
        const baselineWithCaveat = {
            outcome: { winner: 'player', lastRound: 1 },
            preFight: { unsimulated: [{ actorId: 'a1', name: 'Nova', texts: ['stacking buff'] }] },
        } as unknown as BattleResult;
        hookReturn = {
            ...baseHookReturn,
            divergence: { seed: 507, baseline: baselineWithCaveat, current: currentResult },
        };
        render(
            <MemoryRouter>
                <SimulatorPage />
            </MemoryRouter>
        );

        expect(
            screen.getByText('Baseline: squad leader effects not simulated this run')
        ).toBeInTheDocument();
        expect(
            screen.queryByText('Current: squad leader effects not simulated this run')
        ).not.toBeInTheDocument();
        expect(screen.getByText(/stacking buff/)).toBeInTheDocument();
    });

    it("labels each side's unsimulated effects separately when both carry them, never merged", () => {
        const baselineWithCaveat = {
            outcome: { winner: 'player', lastRound: 1 },
            preFight: {
                unsimulated: [{ actorId: 'a1', name: 'Nova', texts: ['baseline-only effect'] }],
            },
        } as unknown as BattleResult;
        const currentWithCaveat = {
            outcome: { winner: 'enemy', lastRound: 1 },
            preFight: {
                unsimulated: [{ actorId: 'a2', name: 'Vanguard', texts: ['current-only effect'] }],
            },
        } as unknown as BattleResult;
        hookReturn = {
            ...baseHookReturn,
            divergence: { seed: 507, baseline: baselineWithCaveat, current: currentWithCaveat },
        };
        render(
            <MemoryRouter>
                <SimulatorPage />
            </MemoryRouter>
        );

        expect(
            screen.getByText('Baseline: squad leader effects not simulated this run')
        ).toBeInTheDocument();
        expect(
            screen.getByText('Current: squad leader effects not simulated this run')
        ).toBeInTheDocument();
        expect(screen.getByText(/baseline-only effect/)).toBeInTheDocument();
        expect(screen.getByText(/current-only effect/)).toBeInTheDocument();
    });

    it('shows no unsimulated-effects caveat while a pair is open and neither side carries one', () => {
        hookReturn = {
            ...baseHookReturn,
            divergence: { seed: 507, baseline: baselineResult, current: currentResult },
        };
        render(
            <MemoryRouter>
                <SimulatorPage />
            </MemoryRouter>
        );

        expect(screen.queryByText(/squad leader effects not simulated/)).not.toBeInTheDocument();
    });
});
