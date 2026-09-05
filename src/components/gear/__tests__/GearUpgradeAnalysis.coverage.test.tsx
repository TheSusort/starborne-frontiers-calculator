import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { GearUpgradeAnalysis } from '../GearUpgradeAnalysis';
import { SHIP_TYPES } from '../../../constants/shipTypes';
import { buildCoverageMatrix } from '../../../utils/gear/roleSlotCoverage';
import type { CoverageMatrix } from '../../../utils/gear/roleSlotCoverage';

// jsdom has no scrollIntoView implementation; the click test below reaches it.
Element.prototype.scrollIntoView = vi.fn();

// Mock all context hooks and the analysis utility
vi.mock('../../../utils/gear/potentialCalculator', () => ({
    analyzePotentialUpgrades: vi.fn().mockReturnValue([
        {
            piece: {
                id: 'gear-1',
                slot: 'weapon',
                level: 16,
                stars: 6,
                rarity: 'legendary',
                mainStat: { name: 'attack', value: 100, type: 'flat' },
                subStats: [],
                setBonus: null,
            },
            improvement: 10,
            currentScore: 100,
        },
    ]),
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
    useGearUpgrades: () => ({
        simulateUpgrades: vi.fn(),
        clearUpgrades: vi.fn(),
        getUpgrade: vi.fn(),
    }),
}));

vi.mock('../../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: vi.fn() }),
}));

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({
        ships: [],
        gearToShipMap: new Map(),
        getShipFromGearId: vi.fn(),
        getShipById: vi.fn(),
    }),
}));

vi.mock('../../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({ engineeringStats: { stats: [] } }),
}));

vi.mock('../../../hooks/useTutorialTrigger', () => ({
    useTutorialTrigger: vi.fn(),
}));

// Sidebar imports /favicon.ico?url which is not available in test environment
vi.mock('../../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));

vi.mock('../../../utils/gear/roleSlotCoverage', () => ({
    buildCoverageMatrix: vi.fn(),
    COVERAGE_MIN_LEVEL: 16,
    COVERAGE_SAMPLE_SIZE: 20,
    TIE_EPSILON: 1e-9,
}));

// usePersistedCoverageSampleSize reads useAuth; a signed-out user is enough
// to exercise the grid without pulling in a real AuthProvider.
vi.mock('../../../contexts/AuthProvider', () => ({
    useAuth: () => ({ user: null }),
}));

const GEAR_SLOT_NAMES = ['weapon', 'hull', 'generator', 'sensor', 'software', 'thrusters'] as const;

/** A minimal, fully-populated matrix covering only ATTACKER and DEFENDER. */
function makeMatrix({
    roleOrder,
    slotOrderByRole,
    weaponCount,
    weaponPriority,
}: {
    roleOrder: ('ATTACKER' | 'DEFENDER')[];
    slotOrderByRole: Record<'ATTACKER' | 'DEFENDER', (typeof GEAR_SLOT_NAMES)[number][]>;
    weaponCount: number;
    weaponPriority: number;
}): CoverageMatrix {
    const cells = {} as CoverageMatrix['cells'];
    for (const role of roleOrder) {
        cells[role] = {};
        GEAR_SLOT_NAMES.forEach((slot, index) => {
            cells[role][slot] = {
                role,
                slot,
                count: slot === 'weapon' ? weaponCount : 1,
                priority: slot === 'weapon' ? weaponPriority : 0.1,
                rank: index + 1,
            };
        });
    }
    return {
        cells,
        roleOrder,
        slotOrderByRole,
    };
}

const buildCoverageMatrixMock = vi.mocked(buildCoverageMatrix);

describe('GearUpgradeAnalysis coverage grid', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        buildCoverageMatrixMock.mockReturnValue(
            makeMatrix({
                roleOrder: ['ATTACKER', 'DEFENDER'],
                slotOrderByRole: {
                    ATTACKER: [...GEAR_SLOT_NAMES],
                    DEFENDER: [...GEAR_SLOT_NAMES],
                },
                weaponCount: 5,
                weaponPriority: 0.42,
            })
        );
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('shows the coverage grid before any analysis has run', () => {
        render(
            <GearUpgradeAnalysis
                inventory={[]}
                shipRoles={Object.keys(SHIP_TYPES)}
                mode="analysis"
            />
        );
        expect(screen.getByText('Coverage')).toBeInTheDocument();
    });

    it('does not show the coverage grid in simulation mode', () => {
        render(
            <GearUpgradeAnalysis
                inventory={[]}
                shipRoles={Object.keys(SHIP_TYPES)}
                mode="simulation"
            />
        );
        expect(screen.queryByText('Coverage')).not.toBeInTheDocument();
    });

    it('orders role cards by coverage.roleOrder, not by the static shipRoles prop order', async () => {
        // shipRoles is given ATTACKER-first; the mocked matrix says DEFENDER
        // has higher farming priority overall, so DEFENDER's card must render first.
        buildCoverageMatrixMock.mockReturnValue(
            makeMatrix({
                roleOrder: ['DEFENDER', 'ATTACKER'],
                slotOrderByRole: {
                    ATTACKER: [...GEAR_SLOT_NAMES],
                    DEFENDER: [...GEAR_SLOT_NAMES],
                },
                weaponCount: 5,
                weaponPriority: 0.42,
            })
        );

        render(
            <GearUpgradeAnalysis
                inventory={[]}
                shipRoles={['ATTACKER', 'DEFENDER']}
                mode="analysis"
                initialStats={['security']}
            />
        );

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        const attackerCard = document.getElementById('role-card-ATTACKER');
        const defenderCard = document.getElementById('role-card-DEFENDER');
        expect(attackerCard).toBeInTheDocument();
        expect(defenderCard).toBeInTheDocument();

        // DOCUMENT_POSITION_FOLLOWING (4) means attackerCard comes AFTER defenderCard.
        expect(
            defenderCard!.compareDocumentPosition(attackerCard!) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });

    it('badges each slot tab with the coverage cell count and priority percentage', async () => {
        render(
            <GearUpgradeAnalysis
                inventory={[]}
                shipRoles={['ATTACKER', 'DEFENDER']}
                mode="analysis"
                initialStats={['security']}
            />
        );

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(screen.getAllByText('5 · 42%').length).toBeGreaterThan(0);
    });

    it('clicking a grid cell selects that role/slot tab and scrolls to the card', async () => {
        render(
            <GearUpgradeAnalysis
                inventory={[]}
                shipRoles={['ATTACKER', 'DEFENDER']}
                mode="analysis"
                initialStats={['security']}
            />
        );

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        fireEvent.click(screen.getByTestId('coverage-cell-DEFENDER-weapon'));

        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

        const defenderCard = document.getElementById('role-card-DEFENDER');
        expect(defenderCard).toBeInTheDocument();
        const weaponTab = within(defenderCard!).getByRole('button', { name: 'Weapon' });
        expect(weaponTab).toHaveAttribute('aria-current', 'page');
    });

    it("renders a role card's slot tabs in coverage.slotOrderByRole order, with All Slots first", async () => {
        // ATTACKER's mocked order is the reverse of GEAR_SLOT_ORDER; DEFENDER
        // stays identity-ordered so only ATTACKER's card is a useful witness.
        const reversedAttackerOrder = [...GEAR_SLOT_NAMES].reverse();
        buildCoverageMatrixMock.mockReturnValue(
            makeMatrix({
                roleOrder: ['ATTACKER', 'DEFENDER'],
                slotOrderByRole: {
                    ATTACKER: reversedAttackerOrder,
                    DEFENDER: [...GEAR_SLOT_NAMES],
                },
                weaponCount: 5,
                weaponPriority: 0.42,
            })
        );

        render(
            <GearUpgradeAnalysis
                inventory={[]}
                shipRoles={['ATTACKER', 'DEFENDER']}
                mode="analysis"
                initialStats={['security']}
            />
        );

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        const attackerCard = document.getElementById('role-card-ATTACKER');
        expect(attackerCard).toBeInTheDocument();

        // Scope to the tab nav itself so result-card buttons (Edit, etc.)
        // in the currently-selected slot's results can't pollute the order.
        const tabNav = within(attackerCard!).getByRole('navigation', { name: 'Tabs' });
        const tabLabels = within(tabNav)
            .getAllByRole('button')
            .map((button) => button.getAttribute('aria-label'));

        expect(tabLabels).toEqual([
            'All Slots',
            'Thrusters',
            'Software',
            'Sensors',
            'Generator',
            'Hull',
            'Weapon',
        ]);
    });

    it('rebuilds the coverage matrix with the sample size chosen in the grid header', async () => {
        render(
            <GearUpgradeAnalysis
                inventory={[]}
                shipRoles={['ATTACKER', 'DEFENDER']}
                mode="analysis"
            />
        );

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Target pieces per slot' }));
        fireEvent.click(screen.getByRole('option', { name: '100' }));

        // Proves the wiring end-to-end: Select -> persisted state -> the
        // useMemo dependency array -> a real re-invocation of
        // buildCoverageMatrix with the new N, not just a prop the grid
        // received and never used.
        expect(buildCoverageMatrixMock).toHaveBeenLastCalledWith([], 100);
    });

    it('only shows grid rows for roles in shipRoles, preserving coverage order', async () => {
        // The matrix covers three roles (SUPPORTER included), but shipRoles
        // names only two of them. A grid row with no corresponding
        // `role-card-<role>` would update selectedSlots on click and then
        // find nothing to scroll to, so SUPPORTER must not render a row --
        // and ATTACKER/DEFENDER must keep the matrix's own roleOrder.
        const base = makeMatrix({
            roleOrder: ['ATTACKER', 'DEFENDER'],
            slotOrderByRole: {
                ATTACKER: [...GEAR_SLOT_NAMES],
                DEFENDER: [...GEAR_SLOT_NAMES],
            },
            weaponCount: 5,
            weaponPriority: 0.42,
        });
        const threeRoleMatrix = {
            cells: {
                ...base.cells,
                SUPPORTER: Object.fromEntries(
                    GEAR_SLOT_NAMES.map((slot) => [
                        slot,
                        { role: 'SUPPORTER', slot, count: 1, priority: 0.1, rank: 1 },
                    ])
                ),
            },
            roleOrder: ['ATTACKER', 'SUPPORTER', 'DEFENDER'],
            slotOrderByRole: {
                ...base.slotOrderByRole,
                SUPPORTER: [...GEAR_SLOT_NAMES],
            },
        } as unknown as CoverageMatrix;
        buildCoverageMatrixMock.mockReturnValue(threeRoleMatrix);

        render(
            <GearUpgradeAnalysis
                inventory={[]}
                shipRoles={['ATTACKER', 'DEFENDER']}
                mode="analysis"
            />
        );

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(screen.getByTestId('coverage-role-ATTACKER')).toBeInTheDocument();
        expect(screen.getByTestId('coverage-role-DEFENDER')).toBeInTheDocument();
        expect(screen.queryByTestId('coverage-role-SUPPORTER')).not.toBeInTheDocument();
        expect(screen.queryByTestId('coverage-cell-SUPPORTER-weapon')).not.toBeInTheDocument();
    });
});
