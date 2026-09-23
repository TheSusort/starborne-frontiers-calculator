import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { OffFormulaTuningPanel } from '../OffFormulaTuningPanel';
import type { Ship } from '../../../types/ship';
import type { ShipTypeName } from '../../../constants/shipTypes';
import type { TunableOffFormulaFinding } from '../../../utils/autogear/offFormula/offFormulaStats';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports '/favicon.ico?url' —
// unresolvable under Vitest. Same workaround as the other component tests in this project.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const reset = vi.hoisted(() => vi.fn());
const run = vi.hoisted(() => vi.fn());
const cancel = vi.hoisted(() => vi.fn());
const hookState = vi.hoisted(() => ({
    current: {
        status: 'idle',
        progress: { completed: 0, total: 0 },
        rows: [],
        opponents: [],
    },
}));

vi.mock('../../../hooks/useOffFormulaTuning', async () => {
    const actual = await vi.importActual<typeof import('../../../hooks/useOffFormulaTuning')>(
        '../../../hooks/useOffFormulaTuning'
    );
    return {
        ...actual,
        useOffFormulaTuning: () => ({ state: hookState.current, run, cancel, reset }),
    };
});

const ship = (id: string): Ship =>
    ({
        id,
        name: id,
        type: 'ATTACKER',
        equipment: {},
        implants: {},
        refits: [],
    }) as unknown as Ship;

const finding = (
    stat: TunableOffFormulaFinding['stat'],
    trigger: string = 'on-cast'
): TunableOffFormulaFinding => ({
    stat,
    produces: 'damage',
    severity: 'severe',
    trigger,
    tunableStat: stat,
});

const props = (overrides: Record<string, unknown> = {}) => ({
    ship: ship('x'),
    configuredRole: 'ATTACKER' as ShipTypeName,
    finding: finding('security'),
    deps: { getGearPiece: () => undefined, getEngineeringStatsForShipType: () => undefined },
    runOptimizer: vi.fn(),
    statBounds: () => ({ floor: 0, ceiling: 100 }),
    ...overrides,
});

describe('OffFormulaTuningPanel', () => {
    beforeEach(() => {
        reset.mockClear();
        hookState.current = {
            status: 'idle',
            progress: { completed: 0, total: 0 },
            rows: [],
            opponents: [],
        };
    });

    // The context-invalidation hard requirement: a completed table for a PREVIOUS context must
    // never survive a change to the ship, the configured role, or the tuned stat while this
    // panel stays mounted. Deleting the panel's invalidating `useEffect` makes every case here
    // fail — that is the tripwire the requirement asked for.
    it('resets the run when the tuned stat changes', () => {
        const { rerender } = render(<OffFormulaTuningPanel {...props()} />);
        reset.mockClear(); // drop the mount-time call
        rerender(<OffFormulaTuningPanel {...props({ finding: finding('defence') })} />);
        expect(reset).toHaveBeenCalled();
    });

    it('resets the run when the ship changes', () => {
        const { rerender } = render(<OffFormulaTuningPanel {...props()} />);
        reset.mockClear();
        rerender(<OffFormulaTuningPanel {...props({ ship: ship('y') })} />);
        expect(reset).toHaveBeenCalled();
    });

    it('resets the run when the configured role changes', () => {
        const { rerender } = render(<OffFormulaTuningPanel {...props()} />);
        reset.mockClear();
        rerender(<OffFormulaTuningPanel {...props({ configuredRole: 'DEFENDER' })} />);
        expect(reset).toHaveBeenCalled();
    });

    // The gating stat rides `finding.trigger`, not `finding.stat`: `gatingStatFor` maps 'on-cast'
    // to 'defence' and 'on-debuff-resisted' to 'hacking'. Two findings on the SAME stat with
    // different triggers are therefore different runs, and a dependency list keyed only on the
    // stat would leave the first finding's table on screen for the second.
    it('resets the run when the trigger changes the gating stat but the stat stays the same', () => {
        const { rerender } = render(<OffFormulaTuningPanel {...props()} />);
        reset.mockClear();
        rerender(
            <OffFormulaTuningPanel
                {...props({ finding: finding('security', 'on-debuff-resisted') })}
            />
        );
        expect(reset).toHaveBeenCalled();
    });

    it('does not reset on a re-render with the same context', () => {
        const { rerender } = render(<OffFormulaTuningPanel {...props()} />);
        reset.mockClear();
        rerender(<OffFormulaTuningPanel {...props()} />);
        expect(reset).not.toHaveBeenCalled();
    });
});
