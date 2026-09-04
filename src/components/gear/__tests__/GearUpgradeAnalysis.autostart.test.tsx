import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { GearUpgradeAnalysis } from '../GearUpgradeAnalysis';

// Mock all context hooks and the analysis utility
vi.mock('../../../utils/gear/potentialCalculator', () => ({
    analyzePotentialUpgrades: vi.fn().mockReturnValue([]),
    baselineStatsCache: { clear: vi.fn() },
    baselineBreakdownCache: { clear: vi.fn() },
    simulateUpgrade: vi.fn(),
    // roleSlotCoverage.ts reads this at module scope (legendary substat/
    // upgrade-roll counts for its ideal-piece search) — real shape from
    // potentialCalculator.ts's own UPGRADE_LEVELS.legendary.
    UPGRADE_LEVELS: {
        legendary: { increases: [4, 8, 12, 16], additions: [], initialSubstats: 4 },
    },
}));

vi.mock('../../../hooks/useGearUpgrades', () => ({
    useGearUpgrades: () => ({ simulateUpgrades: vi.fn(), clearUpgrades: vi.fn() }),
}));

vi.mock('../../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: vi.fn() }),
}));

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [] }),
}));

vi.mock('../../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({ engineeringStats: { stats: [] } }),
}));

vi.mock('../../../hooks/useTutorialTrigger', () => ({
    useTutorialTrigger: vi.fn(),
}));

// Sidebar imports /favicon.ico?url which is not available in test environment
vi.mock('../../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));

// usePersistedCoverageSampleSize reads useAuth; a signed-out user is enough
// to exercise the grid without pulling in a real AuthProvider.
vi.mock('../../../contexts/AuthProvider', () => ({
    useAuth: () => ({ user: null }),
}));

describe('GearUpgradeAnalysis auto-start', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('auto-starts analysis when initialStats is non-empty', async () => {
        render(
            <GearUpgradeAnalysis
                inventory={[]}
                shipRoles={['ATTACKER']}
                mode="analysis"
                initialStats={['security']}
            />
        );
        // Loading state is synchronously set before the first await inside handleAnalyze
        expect(screen.getByRole('button', { name: /analyzing/i })).toBeInTheDocument();
        // Drain pending microtasks and advance fake timers so the async tail settles cleanly
        await act(async () => {
            await vi.runAllTimersAsync();
        });
    });

    it('does not auto-start when initialStats is absent', () => {
        render(<GearUpgradeAnalysis inventory={[]} shipRoles={['ATTACKER']} mode="analysis" />);
        // No auto-start — button shows default text
        expect(screen.getByRole('button', { name: /analyze gear/i })).toBeInTheDocument();
    });

    it('does not auto-start when initialStats is empty', () => {
        render(
            <GearUpgradeAnalysis
                inventory={[]}
                shipRoles={['ATTACKER']}
                mode="analysis"
                initialStats={[]}
            />
        );
        expect(screen.getByRole('button', { name: /analyze gear/i })).toBeInTheDocument();
    });
});
