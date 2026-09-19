import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OffFormulaNotice } from '../OffFormulaNotice';
import type { Ship } from '../../../types/ship';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports '/favicon.ico?url' —
// unresolvable under Vitest. Same workaround as the other component tests in this project.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../../utils/autogear/simRerank/offFormulaStats', () => ({
    detectOffFormulaStats: vi.fn(),
    gatingStatFor: () => 'defence',
}));
import { detectOffFormulaStats } from '../../../utils/autogear/simRerank/offFormulaStats';

// The panel's own behaviour (probing, banding, simulating) is covered by
// useOffFormulaTuning.test.ts and its own component test; this file only checks that the
// notice wires the control through, so a lightweight stand-in is enough.
vi.mock('../OffFormulaTuningPanel', () => ({
    OffFormulaTuningPanel: ({ finding }: { finding: { stat: string } }) => (
        <div data-testid="tuning-panel">panel for {finding.stat}</div>
    ),
}));

const ship = { id: 's', name: 'Chakara', type: 'ATTACKER' } as unknown as Ship;
const mocked = vi.mocked(detectOffFormulaStats);
const tuning = { deps: {} as never, runOptimizer: vi.fn() };

describe('OffFormulaNotice', () => {
    it('names the stat and the role formula that ignores it', () => {
        mocked.mockReturnValue([
            {
                stat: 'defence',
                produces: 'damage',
                severity: 'severe',
                trigger: 'on-cast',
                tunableStat: 'defence',
            },
        ]);
        render(<OffFormulaNotice ship={ship} configuredRole="ATTACKER" />);
        // Pins the whole sentence, not just the word "defence" — a subject-verb mismatch like
        // "damage scale off" (plural verb, singular subject) would slip past a bare word match.
        expect(screen.getByText(/damage scales off Defence/)).toBeInTheDocument();
        expect(screen.getByText(/Attacker/)).toBeInTheDocument();
    });

    it('renders nothing at all when the ship has no finding', () => {
        mocked.mockReturnValue([]);
        const { container } = render(<OffFormulaNotice ship={ship} configuredRole="ATTACKER" />);
        // An empty wrapper div would still push layout and read as a bug in a dense settings
        // panel, so assert on the container rather than on absence of text.
        expect(container).toBeEmptyDOMElement();
    });

    // A shared word ("trade" appearing in both copies, say) would let this pass regardless of
    // which severity actually renders, so each assertion below checks the OTHER severity's
    // phrase is absent, not just that its own phrase is present.
    it('reads a substitution finding differently from a severe one', () => {
        mocked.mockReturnValue([
            {
                stat: 'defence',
                produces: 'damage',
                severity: 'substitution',
                trigger: 'on-cast',
                tunableStat: 'defence',
            },
        ]);
        const { unmount } = render(<OffFormulaNotice ship={ship} configuredRole="DEFENDER" />);
        expect(screen.getByText(/trade/i)).toBeInTheDocument();
        expect(screen.queryByText(/does not score/i)).not.toBeInTheDocument();
        unmount();

        mocked.mockReturnValue([
            {
                stat: 'defence',
                produces: 'damage',
                severity: 'severe',
                trigger: 'on-cast',
                tunableStat: 'defence',
            },
        ]);
        render(<OffFormulaNotice ship={ship} configuredRole="DEFENDER" />);
        expect(screen.getByText(/does not score/i)).toBeInTheDocument();
        expect(screen.queryByText(/trade/i)).not.toBeInTheDocument();
    });

    // The collapse, from the notice's side: the sentence must name BOTH what the damage reads
    // and the gearable stat behind it, or a player told to tune HP has no idea why.
    it('names the chain when the lever is not what the effect reads', () => {
        mocked.mockReturnValue([
            {
                stat: 'shield',
                produces: 'damage',
                severity: 'severe',
                trigger: 'on-cast',
                tunableStat: 'hp',
            },
        ]);
        render(<OffFormulaNotice ship={ship} configuredRole="ATTACKER" tuning={tuning} />);
        expect(
            screen.getByText(/damage scales off its shield pool, which HP drives/)
        ).toBeInTheDocument();
        // Severity names the LEVER, not a bare "it": the reader has just been shown two stats.
        expect(screen.getByText(/does not score HP/)).toBeInTheDocument();
        expect(screen.getByText(/measure it/i)).toBeInTheDocument();
    });

    // The gate. Non-vacuity for the case above: the same finding WITHOUT a lever must offer no
    // control, or the panel would mount on a stat no band can reach.
    it('offers no control for a finding with no gearable lever, but still reports it', () => {
        mocked.mockReturnValue([
            { stat: 'shield', produces: 'damage', severity: 'severe', trigger: 'on-cast' },
        ]);
        render(<OffFormulaNotice ship={ship} configuredRole="ATTACKER" tuning={tuning} />);
        expect(screen.getByText(/damage scales off its shield pool/)).toBeInTheDocument();
        expect(screen.getByText(/nothing to measure/i)).toBeInTheDocument();
        expect(screen.queryByText(/measure it/i)).not.toBeInTheDocument();
    });

    it('offers no "Measure it" control when the caller supplies no tuning support', () => {
        mocked.mockReturnValue([
            {
                stat: 'defence',
                produces: 'damage',
                severity: 'severe',
                trigger: 'on-cast',
                tunableStat: 'defence',
            },
        ]);
        render(<OffFormulaNotice ship={ship} configuredRole="ATTACKER" />);
        expect(screen.queryByText(/measure it/i)).not.toBeInTheDocument();
    });

    it('mounts the tuning panel for a finding only once "Measure it" is pressed', () => {
        mocked.mockReturnValue([
            {
                stat: 'defence',
                produces: 'damage',
                severity: 'severe',
                trigger: 'on-cast',
                tunableStat: 'defence',
            },
        ]);
        render(<OffFormulaNotice ship={ship} configuredRole="ATTACKER" tuning={tuning} />);

        expect(screen.queryByTestId('tuning-panel')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText(/measure it/i));
        expect(screen.getByTestId('tuning-panel')).toHaveTextContent('panel for defence');

        fireEvent.click(screen.getByText(/hide measurement/i));
        expect(screen.queryByTestId('tuning-panel')).not.toBeInTheDocument();
    });
});
