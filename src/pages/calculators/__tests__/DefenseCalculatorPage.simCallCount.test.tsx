import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DefenseCalculatorPage from '../DefenseCalculatorPage';
import { simulateDefenseSurvivability } from '../../../utils/calculators/defenseSurvivabilitySim';
import { ShipSelector } from '../../../components/ship/ShipSelector';
import type { Ship } from '../../../types/ship';

// This file exists to answer a question the sibling DefenseCalculatorPage.test.tsx cannot: HOW
// OFTEN does the sim actually run. The memo used to depend on the whole `configs` array, so an
// edit to a config's NAME — a field the sim never reads — re-ran a full engine simulation per
// config on every keystroke. Spying on `simulateDefenseSurvivability` itself (rather than
// asserting on rendered output) is the only boundary that can observe that at all.
const mockGetShipById = vi.fn((_id: string): Ship | undefined => undefined);

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
vi.mock('../../../components/ship/ShipSelector', () => ({ ShipSelector: vi.fn(() => null) }));
vi.mock('../../../components/seo/Seo', () => ({ default: () => null }));
vi.mock('../../../hooks/useThemeColors', () => ({
    useThemeColors: () => ({ gridStroke: '#000', text: '#fff', bg: '#000' }),
}));

vi.mock('recharts', () => {
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return {
        ComposedChart: Pass,
        LineChart: Pass,
        ScatterChart: Pass,
        Bar: () => null,
        Line: () => null,
        Scatter: () => null,
        LabelList: () => null,
        Customized: () => null,
        XAxis: () => null,
        YAxis: () => null,
        CartesianGrid: () => null,
        Tooltip: () => null,
        ResponsiveContainer: Pass,
    };
});

vi.mock('../../../utils/calculators/defenseSurvivabilitySim', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('../../../utils/calculators/defenseSurvivabilitySim')>();
    return { ...actual, simulateDefenseSurvivability: vi.fn(actual.simulateDefenseSurvivability) };
});

const simSpy = vi.mocked(simulateDefenseSurvivability);

const renderPage = () =>
    render(
        <MemoryRouter>
            <DefenseCalculatorPage />
        </MemoryRouter>
    );

describe('DefenseCalculatorPage sim call count', () => {
    // Braced, not `() => simSpy.mockClear()`: `mockClear()` returns the mock itself for chaining,
    // and Vitest treats a function RETURNED from `beforeEach` as a teardown callback to invoke
    // after the test — with zero arguments. An arrow expression body here would silently register
    // `simSpy` as its own post-test cleanup hook and crash the real implementation on `input`
    // being `undefined`.
    beforeEach(() => {
        simSpy.mockClear();
        vi.mocked(ShipSelector).mockReset();
        vi.mocked(ShipSelector).mockReturnValue(null);
    });

    it('editing a config NAME runs zero simulations', () => {
        renderPage();
        simSpy.mockClear();
        const nameInput = screen.getAllByDisplayValue(/Ship|Configuration/i)[0];
        fireEvent.change(nameInput, { target: { value: 'Tanky McTankface' } });
        expect(simSpy).toHaveBeenCalledTimes(0);
    });

    it('editing HP runs the sim (the instrument can report non-zero)', async () => {
        // The three numeric inputs debounce their commit (Task 6), so the sim only runs once the
        // 250ms trailing edge fires. Fake timers + a flush, not a relaxed assertion — the debounce
        // must still satisfy ">0" once settled.
        vi.useFakeTimers();
        try {
            renderPage();
            simSpy.mockClear();
            const hp = screen.getByLabelText('HP');
            fireEvent.change(hp, { target: { value: '50000' } });
            await act(async () => {
                vi.advanceTimersByTime(300);
            });
            expect(simSpy.mock.calls.length).toBeGreaterThan(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('typing seven digits into HP settles to ONE simulation pass', async () => {
        vi.useFakeTimers();
        try {
            renderPage();
            simSpy.mockClear();
            const hp = screen.getByLabelText('HP');
            for (const value of ['1', '12', '123', '1234', '12345', '123456', '1234567']) {
                fireEvent.change(hp, { target: { value } });
            }
            // Nothing should have run yet — the debounce window is still open.
            expect(simSpy).toHaveBeenCalledTimes(0);
            await act(async () => {
                vi.advanceTimersByTime(300);
            });
            // One settled pass, one sim per config (there is one default config).
            expect(simSpy).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    // Task 6 final-review item 3 — this file's name promises "N sims per keystroke", but until
    // here it was narrower than that on two axes at once:
    //
    //   1. It only ever exercised HP. `simulateDefenseSurvivability` is called once per config,
    //      inside a `configs.forEach` — nothing above pinned that Defense and Security debounce
    //      their commit too, so removing the debounce from either alone (leaving HP's untouched)
    //      left every test in this file green.
    //   2. It only ever had ONE config, so `toHaveBeenCalledTimes(1)` could not tell "1 because
    //      the debounce/memo held" apart from "1 because there is exactly one config to
    //      simulate". A SECOND config makes a correctly-settled pass report exactly 2 — one call
    //      per config, from the same `forEach` — so the count now pins N, not just >0.
    //
    // The three arms below add a second config and repeat the "type digits, assert 0 before the
    // debounce fires, advance past it, assert the settled count" shape from the HP test above for
    // all three debounced fields, each asserting 2 (not 1) on settle.
    it('typing into HP across two configs settles to TWO simulation passes, not one', async () => {
        vi.useFakeTimers();
        try {
            renderPage();
            fireEvent.click(screen.getByRole('button', { name: 'Add Ship' }));
            simSpy.mockClear();
            const hpInputs = screen.getAllByLabelText('HP');
            expect(hpInputs).toHaveLength(2);
            for (const value of ['1', '12', '123', '1234', '12345', '123456', '1234567']) {
                fireEvent.change(hpInputs[0], { target: { value } });
            }
            expect(simSpy).toHaveBeenCalledTimes(0);
            await act(async () => {
                vi.advanceTimersByTime(300);
            });
            // One pass PER CONFIG, not one pass total — the second config is the tripwire a
            // single-config suite cannot set.
            expect(simSpy).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('editing Defense debounces its commit and settles to TWO simulation passes across two configs', async () => {
        vi.useFakeTimers();
        try {
            renderPage();
            fireEvent.click(screen.getByRole('button', { name: 'Add Ship' }));
            simSpy.mockClear();
            const defenseInputs = screen.getAllByLabelText('Defense');
            expect(defenseInputs).toHaveLength(2);
            for (const value of ['1', '12', '123', '1234']) {
                fireEvent.change(defenseInputs[1], { target: { value } });
            }
            // Nothing should have run yet — Defense debounces its commit exactly like HP does.
            // Without this arm, a debounce removed from Defense alone left the whole file green.
            expect(simSpy).toHaveBeenCalledTimes(0);
            await act(async () => {
                vi.advanceTimersByTime(300);
            });
            expect(simSpy).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('editing Security debounces its commit and settles to TWO simulation passes across two configs', async () => {
        vi.useFakeTimers();
        try {
            renderPage();
            fireEvent.click(screen.getByRole('button', { name: 'Add Ship' }));
            simSpy.mockClear();
            const securityInputs = screen.getAllByLabelText('Security');
            expect(securityInputs).toHaveLength(2);
            for (const value of ['1', '12', '123', '1234']) {
                fireEvent.change(securityInputs[1], { target: { value } });
            }
            // Nothing should have run yet — Security debounces its commit exactly like HP does.
            expect(simSpy).toHaveBeenCalledTimes(0);
            await act(async () => {
                vi.advanceTimersByTime(300);
            });
            expect(simSpy).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    // Task 10 (#391 follow-up): `defenderFieldsFromShip` hardcoded `startCharged: false` while
    // still reading `chargeCount` off `ship.chargeSkillCharge` — charge count honoured,
    // charged-at-start dropped. This is the ONLY actor on the page whose charged-at-start text was
    // ignored: the enemy and team rosters get it through `useEnemyTeamRoster`, and the healing
    // page's healer picker calls `detectShipCharged` directly. Akula, Chimei, Los, Sansi, Valkyrie
    // and Wusheng all declare "starts combat fully charged" — picking any of them as the defender
    // must simulate them charged, exactly as picking them for the enemy or team roster already does.
    //
    // ShipSelector is stubbed to null for every other test in this file; this is the one place
    // that swaps in a real, clickable stand-in so the actual `onSelectShip` handler runs
    // end-to-end, rather than re-asserting the mapping in isolation.
    it('a defender whose kit says it starts combat fully charged is simulated charged', () => {
        const akula = {
            id: 'akula',
            name: 'Akula',
            baseStats: { hp: 40000, attack: 10000, defence: 5000, security: 1000, speed: 100 },
            chargeSkillCharge: 2,
            firstPassiveSkillText: 'This Unit starts combat fully charged.',
        } as unknown as Ship;
        vi.mocked(ShipSelector).mockImplementation(
            ({ onSelect }: { onSelect: (ship: Ship) => void }) => (
                <button onClick={() => onSelect(akula)}>pick defender ship</button>
            )
        );

        renderPage();
        simSpy.mockClear();
        fireEvent.click(screen.getByText('pick defender ship'));

        expect(simSpy).toHaveBeenCalled();
        expect(simSpy.mock.calls.at(-1)![0]).toMatchObject({
            chargeCount: 2,
            startCharged: true,
        });
    });
});
