import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { SimRerankSection } from '../SimRerankSection';
import type { Ship } from '../../../types/ship';
import type { SimRerankRow, SimRerankState } from '../../../hooks/useSimRerank';
import type { CandidateRun } from '../../../utils/autogear/simRerank/runCandidates';
import type { CandidateRow } from '../../../utils/autogear/simRerank/metricTable';
import type { SimulatorSetup } from '../../../utils/simulator/simulatorSetup';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports '/favicon.ico?url' —
// unresolvable under Vitest. Same workaround as the other component tests in this project.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

// SimRerankSection fetches its own encounter list (see its doc comment); stub it rather than
// wiring up the real hook's Supabase/ActiveProfile dependencies.
vi.mock('../../../hooks/useEncounterNotes', () => ({
    useEncounterNotes: () => ({ encounters: [], loading: false }),
}));

const hookState = vi.hoisted(() => {
    const current: SimRerankState = {
        status: 'idle',
        progress: { completed: 0, total: 0 },
        rows: [],
        table: [],
        excluded: [],
        ownBestExcluded: false,
        dropped: [],
    };
    return { current };
});
const run = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/useSimRerank', async () => {
    const actual = await vi.importActual<typeof import('../../../hooks/useSimRerank')>(
        '../../../hooks/useSimRerank'
    );
    return {
        ...actual,
        useSimRerank: () => ({
            state: hookState.current,
            run,
            cancel: vi.fn(),
            reset: vi.fn(),
        }),
    };
});

const ship = {
    id: 'focus',
    name: 'Focus',
    type: 'DEBUFFER',
    equipment: {},
} as unknown as Ship;

const setupWithShip: SimulatorSetup = {
    version: 1,
    name: 'My Setup',
    playerBoard: { M1: { shipId: 'focus' } },
    enemyBoard: { T1: { shipId: 'enemy' } },
    seed: 1,
    runCount: 20,
    savedAt: 0,
};

const props = (overrides: Partial<React.ComponentProps<typeof SimRerankSection>> = {}) => ({
    ship,
    savedSetups: [],
    deps: { getGearPiece: () => undefined, getEngineeringStatsForShipType: () => undefined },
    getShipById: () => undefined,
    gearToShipMap: new Map<string, string>(),
    resolveShip: () => null,
    runAutogearFor: vi.fn(),
    onApply: vi.fn(),
    ...overrides,
});

const open = () => fireEvent.click(screen.getByText(/simulate candidates/i));

const stubRun = (id: string): CandidateRun =>
    ({ id, focusActorId: 'attacker', aggregate: {} }) as unknown as CandidateRun;

describe('SimRerankSection', () => {
    it('is collapsed until opened', () => {
        render(<SimRerankSection {...props()} />);
        // CollapsibleAccordion keeps the body mounted (so its height transition has something to
        // animate) and marks it `inert` instead — a collapsed control is not visible to the user,
        // not absent from the DOM.
        expect(screen.getByRole('button', { name: /^run$/i })).not.toBeVisible();
    });

    it('says a practice fight is not a team-aware answer', () => {
        render(<SimRerankSection {...props()} />);
        open();
        expect(screen.getByText(/not a real team/i)).toBeInTheDocument();
    });

    // A fixture with only "practice" available cannot fail for a source that should NOT carry
    // the note — a saved setup naming this ship must also be offered, selected, and shown to
    // drop the note.
    it('drops the note once a real saved-setup fight is selected', () => {
        render(<SimRerankSection {...props({ savedSetups: [setupWithShip] })} />);
        open();
        expect(screen.getByText(/not a real team/i)).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Fight source'));
        fireEvent.click(screen.getByText('My Setup'));

        expect(screen.queryByText(/not a real team/i)).not.toBeInTheDocument();
    });

    it("pre-fills every compared role, excluding the ship's own family", () => {
        render(<SimRerankSection {...props()} />);
        open();
        expect(screen.getByLabelText('Attacker')).toBeChecked();
        expect(screen.getByLabelText('Defender')).toBeChecked();
        expect(screen.getByLabelText('Supporter')).toBeChecked();
        expect(screen.queryByLabelText('Debuffer')).not.toBeInTheDocument();
    });

    it('keeps seed and run count behind the advanced disclosure', () => {
        render(<SimRerankSection {...props()} />);
        open();
        expect(screen.getByLabelText(/seed/i)).not.toBeVisible();
        fireEvent.click(screen.getByText(/advanced/i));
        expect(screen.getByLabelText(/seed/i)).toBeVisible();
    });

    const cell = (metric: string, mean: number, distinguishable: boolean) => ({
        metric,
        mean,
        se: 1,
        n: 20,
        distinguishable,
    });

    it('shows a delta for a distinguishable cell and "no clear difference" for the rest', () => {
        hookState.current = {
            ...hookState.current,
            status: 'done',
            rows: [
                {
                    id: 'DEFENDER:best',
                    role: 'DEFENDER',
                    rank: 'best',
                    run: stubRun('DEFENDER:best'),
                },
            ] as SimRerankRow[],
            table: [
                {
                    id: 'DEFENDER:best',
                    cells: {
                        winRate: cell('winRate', 0.2, true),
                        rounds: cell('rounds', -2, true),
                        focusDamageDealt: cell('focusDamageDealt', 1200, true),
                        focusDamageTaken: cell('focusDamageTaken', 0, false),
                        focusHealingDone: cell('focusHealingDone', 0, false),
                        teamDamageDealt: cell('teamDamageDealt', 800, true),
                    },
                },
            ] as unknown as CandidateRow[],
        };
        render(<SimRerankSection {...props()} />);
        open();

        // Both non-distinguishable cells read as "no clear difference" — never a number.
        expect(screen.getAllByText(/no clear difference/i)).toHaveLength(2);
        // A distinguishable cell renders its actual delta instead.
        expect(screen.getByText('+20%')).toBeInTheDocument();
        expect(screen.getByText('+1,200')).toBeInTheDocument();
    });

    it('re-sorts on a header click without running the sim again', () => {
        hookState.current = {
            ...hookState.current,
            status: 'done',
            rows: [
                {
                    id: 'DEFENDER:best',
                    role: 'DEFENDER',
                    rank: 'best',
                    run: stubRun('DEFENDER:best'),
                },
                {
                    id: 'ATTACKER:best',
                    role: 'ATTACKER',
                    rank: 'best',
                    run: stubRun('ATTACKER:best'),
                },
            ] as SimRerankRow[],
            table: [
                {
                    id: 'DEFENDER:best',
                    cells: {
                        winRate: cell('winRate', 0, false),
                        rounds: cell('rounds', 0, false),
                        focusDamageDealt: cell('focusDamageDealt', 10, true),
                        focusDamageTaken: cell('focusDamageTaken', 0, false),
                        focusHealingDone: cell('focusHealingDone', 0, false),
                        teamDamageDealt: cell('teamDamageDealt', 500, true),
                    },
                },
                {
                    id: 'ATTACKER:best',
                    cells: {
                        winRate: cell('winRate', 0, false),
                        rounds: cell('rounds', 0, false),
                        focusDamageDealt: cell('focusDamageDealt', 900, true),
                        focusDamageTaken: cell('focusDamageTaken', 0, false),
                        focusHealingDone: cell('focusHealingDone', 0, false),
                        teamDamageDealt: cell('teamDamageDealt', 50, true),
                    },
                },
            ] as unknown as CandidateRow[],
        };
        render(<SimRerankSection {...props()} />);
        open();

        // Ship is DEBUFFER, so the initial sort is on team damage (its suggested primary) —
        // Defender (500) ranks ahead of Attacker (50).
        const bodyRowsBefore = screen.getAllByRole('row').slice(1);
        expect(bodyRowsBefore[0].textContent).toContain('Defender');
        expect(bodyRowsBefore[1].textContent).toContain('Attacker');

        run.mockClear();
        fireEvent.click(screen.getByText('Damage dealt'));

        // Sorting by focus damage dealt instead flips the order (Attacker 900 > Defender 10) —
        // this only happens if the click re-sorts the already-computed table.
        const bodyRowsAfter = screen.getAllByRole('row').slice(1);
        expect(bodyRowsAfter[0].textContent).toContain('Attacker');
        expect(bodyRowsAfter[1].textContent).toContain('Defender');
        expect(run).not.toHaveBeenCalled();
    });

    it('states when its own best build was excluded, and reports what a runner-up would strip', () => {
        hookState.current = {
            ...hookState.current,
            status: 'done',
            ownBestExcluded: true,
            excluded: [
                {
                    role: 'DEBUFFER',
                    rank: 'best',
                    stripped: [{ gearId: 'g1', fromShipId: 'ally', fromShipName: 'Ally One' }],
                },
            ],
        };
        render(<SimRerankSection {...props()} />);
        open();

        expect(screen.getByText(/own suggested build was not evaluated/i)).toBeInTheDocument();
        expect(screen.getByText(/Ally One/)).toBeInTheDocument();
    });

    it('reports ships a saved setup dropped', () => {
        hookState.current = {
            ...hookState.current,
            status: 'done',
            dropped: [{ side: 'player', position: 'M2' }],
        };
        render(<SimRerankSection {...props()} />);
        open();

        expect(screen.getByText(/1 ship.*no longer exist/i)).toBeInTheDocument();
    });

    it("follows the ship's CONFIGURED role, not its game-data type, when the two differ", () => {
        // Typed ATTACKER in the game data, but configured as a DEFENDER for this build.
        const attackerTypedShip: Ship = { ...ship, type: 'ATTACKER' };
        hookState.current = {
            ...hookState.current,
            status: 'done',
            rows: [
                {
                    id: 'DEFENDER:best',
                    role: 'DEFENDER',
                    rank: 'best',
                    run: stubRun('DEFENDER:best'),
                },
            ] as SimRerankRow[],
            table: [
                {
                    id: 'DEFENDER:best',
                    cells: {
                        winRate: cell('winRate', 0, false),
                        rounds: cell('rounds', 0, false),
                        focusDamageDealt: cell('focusDamageDealt', 0, false),
                        focusDamageTaken: cell('focusDamageTaken', -500, true),
                        focusHealingDone: cell('focusHealingDone', 0, false),
                        teamDamageDealt: cell('teamDamageDealt', 0, false),
                    },
                },
            ] as unknown as CandidateRow[],
        };
        render(
            <SimRerankSection {...props({ ship: attackerTypedShip, configuredRole: 'DEFENDER' })} />
        );
        open();

        // The configured role is the own-role row, so it must not also be offered as something
        // to compare against — that would run and show the same build twice.
        expect(screen.queryByLabelText('Defender')).not.toBeInTheDocument();
        // A family sharing neither the ship's type nor its configured role is still offered.
        expect(screen.getByLabelText('Attacker')).toBeInTheDocument();

        // The suggested-primary column follows the configured role (Defender -> team damage),
        // not the ship's ATTACKER type (which would suggest damage dealt).
        expect(screen.getByText('Team damage (suggested)')).toBeInTheDocument();

        // The own-role row is labelled by the configured role, not the ship's type.
        expect(screen.getByText('Defender (current role)')).toBeInTheDocument();
    });

    it('calls onApply with the clicked row', () => {
        const onApply = vi.fn();
        const row = {
            id: 'DEFENDER:best',
            role: 'DEFENDER',
            rank: 'best',
            run: stubRun('DEFENDER:best'),
        };
        hookState.current = {
            ...hookState.current,
            status: 'done',
            rows: [row] as SimRerankRow[],
            table: [
                {
                    id: 'DEFENDER:best',
                    cells: {
                        winRate: cell('winRate', 0, false),
                        rounds: cell('rounds', 0, false),
                        focusDamageDealt: cell('focusDamageDealt', 0, false),
                        focusDamageTaken: cell('focusDamageTaken', 0, false),
                        focusHealingDone: cell('focusHealingDone', 0, false),
                        teamDamageDealt: cell('teamDamageDealt', 0, false),
                    },
                },
            ] as unknown as CandidateRow[],
        };
        render(<SimRerankSection {...props({ onApply })} />);
        open();

        fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));

        expect(onApply).toHaveBeenCalledWith(row);
    });
});
