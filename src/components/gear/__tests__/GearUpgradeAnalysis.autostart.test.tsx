import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GearUpgradeAnalysis } from '../GearUpgradeAnalysis';
import type { ShipTypeName } from '../../../constants';
import type { StatName } from '../../../types/stats';

// Mock all context hooks and the analysis utility
vi.mock('../../../utils/gear/potentialCalculator', () => ({
    analyzePotentialUpgrades: vi.fn().mockReturnValue([]),
    baselineStatsCache: { clear: vi.fn() },
    baselineBreakdownCache: { clear: vi.fn() },
    simulateUpgrade: vi.fn(),
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

describe('GearUpgradeAnalysis auto-start', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('auto-starts analysis when initialStats is non-empty', () => {
        render(
            <GearUpgradeAnalysis
                inventory={[]}
                shipRoles={['ATTACKER' as ShipTypeName]}
                mode="analysis"
                initialStats={['security' as StatName]}
            />
        );
        // Auto-start fires on mount — button should show loading state
        expect(screen.getByRole('button', { name: /analyzing/i })).toBeInTheDocument();
    });

    it('does not auto-start when initialStats is absent', () => {
        render(
            <GearUpgradeAnalysis
                inventory={[]}
                shipRoles={['ATTACKER' as ShipTypeName]}
                mode="analysis"
            />
        );
        // No auto-start — button shows default text
        expect(screen.getByRole('button', { name: /analyze gear/i })).toBeInTheDocument();
    });

    it('does not auto-start when initialStats is empty', () => {
        render(
            <GearUpgradeAnalysis
                inventory={[]}
                shipRoles={['ATTACKER' as ShipTypeName]}
                mode="analysis"
                initialStats={[]}
            />
        );
        expect(screen.getByRole('button', { name: /analyze gear/i })).toBeInTheDocument();
    });
});
