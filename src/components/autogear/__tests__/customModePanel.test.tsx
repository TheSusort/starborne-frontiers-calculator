import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '../../../test-utils/test-utils';
import type { CustomFormula } from '../../../types/autogear';
import { AutogearSettings } from '../AutogearSettings';
import { AutogearConfigList } from '../AutogearConfigList';
import { makeSettingsProps } from './autogearSettingsProps';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports
// '/favicon.ico?url' — unresolvable under Vitest.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));
// useTutorialTrigger calls useTutorial(), which throws without a TutorialProvider;
// TestProviders does not supply one.
vi.mock('../../../hooks/useTutorialTrigger', () => ({ useTutorialTrigger: () => undefined }));

const renderPanel = (overrides: Parameters<typeof makeSettingsProps>[0] = {}) =>
    render(<AutogearSettings {...makeSettingsProps(overrides)} />);

const attackFormula: CustomFormula = {
    rows: [{ stat: 'attack', kind: 'core', direction: 'max', importance: 1 }],
};

describe('Custom mode panel', () => {
    it('shows the tweaks card with no role selected', () => {
        // Custom mode has no role, so the card must not depend on one being selected.
        renderPanel({ selectedShipRole: null });
        expect(screen.getByText(/your tweaks/i)).toBeInTheDocument();
    });

    it('says there are no stats yet, not no tweaks, when the formula is empty', () => {
        // With no role, "the role's defaults" is a non sequitur — this is the state the
        // whole card exists to fix, so its empty copy must name the actual gap.
        renderPanel({ selectedShipRole: null, customFormula: undefined });
        expect(screen.getByText(/no stats yet/i)).toBeInTheDocument();
        expect(screen.queryByText(/no tweaks yet/i)).not.toBeInTheDocument();
    });

    it('offers a seed role while the formula is empty', () => {
        renderPanel({ selectedShipRole: null, customFormula: undefined });
        expect(screen.getByText(/start from/i)).toBeInTheDocument();
    });

    it('drops the seed picker once the formula has a row', () => {
        renderPanel({ selectedShipRole: null, customFormula: attackFormula });
        expect(screen.queryByText(/start from/i)).not.toBeInTheDocument();
    });

    it('hides Scale from the picker and offers a formula stat instead', async () => {
        renderPanel({ selectedShipRole: null });
        await userEvent.click(screen.getByRole('button', { name: /add tweak/i }));
        expect(screen.getByText(/formula stat/i)).toBeInTheDocument();
        expect(screen.queryByText(/^Scale$/)).not.toBeInTheDocument();
    });

    it('puts the formula stat above the other tweaks, under its own heading', async () => {
        // A formula stat decides the score; the rest only constrain it. The picker groups
        // them so that difference is visible before the choice is made.
        renderPanel({ selectedShipRole: null });
        await userEvent.click(screen.getByRole('button', { name: /add tweak/i }));

        expect(screen.getByText(/^Custom formula$/i)).toBeInTheDocument();
        expect(screen.getByText(/^Other tweaks$/i)).toBeInTheDocument();

        const formulaStat = screen.getByText(/^Formula stat$/i);
        const limits = screen.getByText(/^Limits$/i);
        expect(formulaStat.compareDocumentPosition(limits)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('groups nothing when a role is selected, because there is no formula', async () => {
        renderPanel({ selectedShipRole: 'ATTACKER' });
        await userEvent.click(screen.getByRole('button', { name: /add tweak/i }));
        // Non-vacuity: proves the picker actually opened, so the two absences below are
        // about grouping headings and not about a click that silently did nothing.
        expect(screen.getByText(/^Scale$/)).toBeInTheDocument();
        expect(screen.queryByText(/^Custom formula$/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/^Other tweaks$/i)).not.toBeInTheDocument();
    });

    it('keeps Scale in the picker when a role is selected', async () => {
        // Non-vacuity for the test above: the entry must exist somewhere, or "hidden in
        // Custom" would pass against a picker that never had a Scale entry at all.
        renderPanel({ selectedShipRole: 'ATTACKER' });
        await userEvent.click(screen.getByRole('button', { name: /add tweak/i }));
        expect(screen.getByText(/^Scale$/)).toBeInTheDocument();
        expect(screen.queryByText(/formula stat/i)).not.toBeInTheDocument();
    });

    it('shows a relative score for the equipped build', () => {
        renderPanel({ selectedShipRole: null, customFormula: attackFormula });
        expect(screen.getByText(/scores .* \(relative\)/i)).toBeInTheDocument();
    });

    it('lists persisted Scale rows as unused rather than dropping them silently', () => {
        renderPanel({
            selectedShipRole: null,
            customFormula: attackFormula,
            statBonuses: [{ stat: 'defence', percentage: 80, mode: 'additive' }],
        });
        expect(screen.getByText(/not used in custom/i)).toBeInTheDocument();
    });

    it('offers only Remove on an inactive Scale row, since editing it has no effect', () => {
        renderPanel({
            selectedShipRole: null,
            customFormula: attackFormula,
            statBonuses: [{ stat: 'defence', percentage: 80, mode: 'additive' }],
        });
        expect(screen.queryByRole('button', { name: 'Edit bonus' })).not.toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: /edit .* scale percentage/i })
        ).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove bonus' })).toBeInTheDocument();
    });
});

describe('Custom mode blocks a run it cannot score', () => {
    it('disables the run and states why when the formula is empty', () => {
        // An empty formula scores every candidate 0, which ties the whole search and
        // returns arbitrary gear — so the run stays blocked until a row exists.
        renderPanel({
            selectedShipRole: null,
            customFormula: undefined,
            priorities: [{ stat: 'speed', minLimit: 120, weight: 1 }],
        });
        expect(screen.getByRole('button', { name: /find optimal gear/i })).toBeDisabled();
        expect(screen.getByText(/add at least one stat/i)).toBeInTheDocument();
    });

    it('enables the run once the formula has a row', () => {
        renderPanel({ selectedShipRole: null, customFormula: attackFormula });
        expect(screen.getByRole('button', { name: /find optimal gear/i })).not.toBeDisabled();
    });

    it('loads a config that predates the formula field', () => {
        // customFormula is optional; a persisted SavedAutogearConfig reads back undefined.
        expect(() =>
            renderPanel({ selectedShipRole: 'ATTACKER', customFormula: undefined })
        ).not.toThrow();
    });
});

type ConfigListProps = ComponentProps<typeof AutogearConfigList>;

const configListProps = (overrides: Partial<ConfigListProps>): ConfigListProps => ({
    shipRole: null,
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    ignoreEquipped: false,
    ignoreUnleveled: false,
    useUpgradedStats: false,
    tryToCompleteSets: false,
    optimizeImplants: false,
    ...overrides,
});

describe('stat priorities carry no reorder control', () => {
    const two = [
        { stat: 'speed' as const, minLimit: 120, weight: 1 },
        { stat: 'crit' as const, minLimit: 60, weight: 1 },
    ];

    it('renders neither arrow, in role mode', () => {
        // Nothing scores a stat priority by its list position — `stat-priority order is
        // inert` in priorityScore.test.ts holds that — so there is no order to control.
        renderPanel({ selectedShipRole: 'ATTACKER', priorities: two });
        expect(screen.queryByLabelText(/move priority up/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/move priority down/i)).not.toBeInTheDocument();
    });

    it('still renders the rows themselves', () => {
        // Non-vacuity: an absent arrow proves nothing if the rows never rendered.
        // `two` holds both fixture priorities, so both rows' Remove buttons show.
        renderPanel({ selectedShipRole: 'ATTACKER', priorities: two });
        expect(screen.getAllByLabelText(/remove priority/i)).toHaveLength(two.length);
    });
});

describe('set, bonus and buff rows carry no reorder control', () => {
    // Nothing reads the order of these three lists: the set-penalty loop in
    // calculatePriorityScore accumulates, applyAdditiveBonuses and calculateMultiplierFactor
    // both reduce to a sum, and applyFleetBuffs adds or multiplies — all commutative. See #497.
    const rows = {
        selectedShipRole: 'ATTACKER' as const,
        setPriorities: [
            { setName: 'DECIMATION' as const, count: 4 },
            { setName: 'FORTITUDE' as const, count: 2 },
        ],
        statBonuses: [
            { stat: 'attack' as const, percentage: 20, mode: 'additive' as const },
            { stat: 'defence' as const, percentage: 10, mode: 'additive' as const },
        ],
        fleetBuffs: [
            { stat: 'attack' as const, percentage: 15 },
            { stat: 'hp' as const, percentage: 5 },
        ],
    };

    it('renders no arrow on any of the three lists', () => {
        renderPanel(rows);
        expect(screen.queryAllByLabelText(/move set priority (up|down)/i)).toHaveLength(0);
        expect(screen.queryAllByLabelText(/move bonus (up|down)/i)).toHaveLength(0);
        expect(screen.queryAllByLabelText(/move buff (up|down)/i)).toHaveLength(0);
    });

    it('still renders all three lists of rows', () => {
        // Non-vacuity: an absent arrow proves nothing if the rows never rendered. Each
        // fixture holds two entries, so each Remove label must appear twice.
        renderPanel(rows);
        expect(screen.getAllByLabelText(/remove set priority/i)).toHaveLength(2);
        expect(screen.getAllByLabelText(/remove bonus/i)).toHaveLength(2);
        expect(screen.getAllByLabelText(/remove buff/i)).toHaveLength(2);
    });
});

describe('AutogearConfigList labels a roleless config', () => {
    it('reads Custom rather than rendering nothing', () => {
        render(<AutogearConfigList {...configListProps({ shipRole: null })} />);
        expect(screen.getByText('Custom')).toBeInTheDocument();
    });

    it('reads the role name when there is one', () => {
        // Non-vacuity: proves the row renders a role at all, so the Custom assertion
        // above is about the null case and not about an element that never appears.
        render(<AutogearConfigList {...configListProps({ shipRole: 'ATTACKER' })} />);
        expect(screen.getByText('Attacker')).toBeInTheDocument();
    });

    it('summarises a formula-only config instead of reading No configuration set', () => {
        render(
            <AutogearConfigList
                {...configListProps({ shipRole: null, customFormula: attackFormula })}
            />
        );
        expect(screen.queryByText(/no configuration set/i)).not.toBeInTheDocument();
        expect(screen.getByText(/formula: attack/i)).toBeInTheDocument();
    });

    it('reads No configuration set when the config is genuinely empty', () => {
        // Non-vacuity: proves the empty-state copy still renders at all, so the formula
        // config above is read against real text and not an element that never appears.
        render(<AutogearConfigList {...configListProps({ shipRole: null })} />);
        expect(screen.getByText(/no configuration set/i)).toBeInTheDocument();
    });
});
