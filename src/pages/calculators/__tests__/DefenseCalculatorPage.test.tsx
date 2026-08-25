import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DefenseCalculatorPage from '../DefenseCalculatorPage';

// Heavy contexts and the chart library are mocked: this is a render smoke that verifies the page
// mounts with its default ship config and that the Advanced section hosts the skill editor —
// mirroring the HealingCalculatorPage.test.tsx render-harness conventions.
vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [], getShipById: () => undefined }),
}));
vi.mock('../../../contexts/InventoryProvider', () => ({
    useInventory: () => ({ getGearPiece: () => undefined }),
}));
vi.mock('../../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({ getEngineeringStatsForShipType: () => undefined }),
}));
vi.mock('../../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../../components/ship/ShipSelector', () => ({ ShipSelector: () => null }));
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

const renderDefenseCalculatorPage = () =>
    render(
        <MemoryRouter>
            <DefenseCalculatorPage />
        </MemoryRouter>
    );

describe('DefenseCalculatorPage', () => {
    it('renders the page with a default ship config', () => {
        renderDefenseCalculatorPage();
        expect(screen.getByText('Defense Calculator')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Ship 1')).toBeInTheDocument();
    });

    it('a blank config exposes editable skill slots', () => {
        renderDefenseCalculatorPage();
        // The Advanced section hosts the skill editor; a blank config still has editable slots.
        fireEvent.click(screen.getByText(/Show Advanced/i));
        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.getByText('Charged')).toBeInTheDocument();
    });

    // The in-app docs name these three cards verbatim (`DocumentationPage.tsx`, the Defense
    // Calculator entry: "Enemy Team is where you build the group bombarding the ship… Team is its
    // own card… Combat Settings holds only the length of the fight"). Task 10 shipped that
    // paragraph naming "Enemy Attackers" and "Supporting Allies", neither of which the UI has ever
    // rendered — a user-facing inaccuracy nothing could catch. This arm is the tripwire on the side
    // that actually moves: rename a heading here and it goes red, which is the prompt to update
    // the docs paragraph in the same commit.
    it('renders the three collapsible cards the in-app docs name', () => {
        renderDefenseCalculatorPage();
        expect(screen.getByText(/Enemy Team \(\d+\)/)).toBeInTheDocument();
        expect(screen.getByText('Team')).toBeInTheDocument();
        expect(screen.getByText('Combat Settings')).toBeInTheDocument();
    });

    // NOTE: `Add Enemy` lives in the "Enemy Team" panel, and `CollapsibleForm` keeps its children
    // mounted while collapsed — so it is queryable without opening anything. Two tests in this file
    // used to click `/Combat Settings/i` first; that is a DIFFERENT panel and the click was a pure
    // no-op that read as a required step.
    it('reports a damage-absorbed figure once an attacker applies pressure', async () => {
        renderDefenseCalculatorPage();
        fireEvent.click(screen.getByRole('button', { name: /Add Enemy/i }));
        // Matched on the row's own CAPTION, not on "Damage absorbed" — the Theoretical EHP
        // explanation card names that figure too (to say what it is NOT), so the looser pattern
        // now matches two nodes.
        expect(
            await screen.findByText(/everything thrown at it, before its own reductions/i)
        ).toBeInTheDocument();
    });

    // #358 finding C1 — THE REGRESSION THE OLD GUARD COULD NOT SEE. The reduce behind `isBest` was
    // `currentEHP > bestEHP` seeded with `null`, and the page's DEFAULT state seeds `enemies: []`,
    // which becomes the `attack: 0` practice target. Every config therefore reports
    // `damageAbsorbed === 0`, `0 > 0` is false forever, the seed never leaves `null`, and the FIRST
    // PAGE A USER EVER SEES had no `border-primary`, no badge, no "Compared to best" row and no
    // highlighted chart series. On main the static ranking always produced a best.
    //
    // ⚠️ THE ARM BELOW IT (`gives the best-ship marker to…`) CANNOT CATCH THIS: it adds an enemy
    // first, so it only ever proved the reduce DISCRIMINATES, never that it ANSWERS. This arm adds
    // no enemy at all — the zero-pressure default, which is the state that regressed.
    it('marks a best config on the zero-pressure default, with no enemy added at all', () => {
        renderDefenseCalculatorPage();
        // No Add Enemy. Deliberately.
        expect(screen.getByText('Best ship configuration')).toBeInTheDocument();
    });

    // #358 finding C1, SECOND ORDER. When every config SURVIVES the window the headline is FLAT by
    // construction (raw damage thrown is a property of the attackers — see the axis note in
    // `defenseSurvivabilitySim.ts`), so a strict `>` never fires on the primary axis and the badge
    // lands on whichever card was added first, unranked. The tie-break ladder is
    // damageAbsorbed -> elapsedRounds -> Theoretical EHP.
    //
    // ⚠️ THE WEAKER CONFIG IS DELIBERATELY FIRST. With it second, "first wins" and "best wins"
    // would be the same card and this arm would prove nothing.
    it('breaks a flat-survivor tie on Theoretical EHP rather than insertion order', async () => {
        renderDefenseCalculatorPage();
        fireEvent.click(screen.getByRole('button', { name: 'Add Ship' }));

        const hpInputs = screen.getAllByLabelText('HP');
        const defenseInputs = screen.getAllByLabelText('Defense');
        // Both effectively unkillable, so both survive the whole window and their damage-absorbed
        // figures tie exactly. Only Defense separates them, i.e. only Theoretical EHP.
        fireEvent.change(hpInputs[0], { target: { value: '999999999' } });
        fireEvent.change(defenseInputs[0], { target: { value: '1000' } }); // FIRST, and weaker
        fireEvent.change(hpInputs[1], { target: { value: '999999999' } });
        fireEvent.change(defenseInputs[1], { target: { value: '20000' } });

        fireEvent.click(screen.getByRole('button', { name: /Add Enemy/i }));

        const notes = await screen.findAllByText(/Survived all/i);
        expect(notes).toHaveLength(2);
        const cards = notes.map((n) => n.closest('.card') as HTMLElement);
        expect(cards[0]).not.toBe(cards[1]);

        // The tie is REAL and this arm depends on it: the non-best card's "Compared to best" delta
        // is measured on `damageAbsorbed`, so a 0.00% there is direct evidence that the primary
        // axis could not decide and the ladder did. (It also pins finding I3 — the delta is on the
        // ranking axis, not on Theoretical EHP, where these two cards differ enormously.)
        const bestCard = cards.find((c) => c.textContent?.includes('Best ship configuration'));
        const otherCard = cards.find((c) => !c.textContent?.includes('Best ship configuration'));
        expect(bestCard).toBeDefined();
        expect(otherCard).toBeDefined();
        expect(within(otherCard as HTMLElement).getByText('0.00%')).toBeInTheDocument();

        // The badge is on the HIGHER-Defense card — the second one added, so this cannot be
        // "whichever came first".
        expect(within(bestCard as HTMLElement).getByDisplayValue('20000')).toBeInTheDocument();
    });

    // Carried from Task 9: `bestShip` (the reduce behind the `isBest` highlight) had NO test. Before
    // the fix this epic made, the ranking was INVERTED for survivors — a tankier ship reported a
    // SMALLER measured figure and lost the "Best ship configuration" marker to the weaker one. This
    // test gives two configs deliberately lopsided defence (0 vs 20,000, plus HP as a safety margin
    // against exact-formula assumptions) under identical enemy pressure, so one dies on round 1 and
    // the other survives the whole window — driving their damage absorbed figures far enough apart that
    // the comparison can't tie. It asserts the SURVIVOR (the one that withstood more raw damage)
    // carries the marker, not the casualty.
    //
    // ⚠️ THE SURVIVOR IS DELIBERATELY THE **FIRST** CONFIG, AND ORDER IS THE WHOLE TEST.
    // #358 ADDENDUM 3 (carried finding 11): this fixture used to add the tanky survivor LAST, and
    // that made it BLIND. Measured: replacing the whole reduce body with `return current` — which
    // ranks by nothing at all and simply marks the last config — left all four tests in this file
    // GREEN, because with the survivor last "the last one" and "the best one" are the same card.
    // With the survivor FIRST the two wrong reduces both go red for their own reason:
    //   • `return current` marks the fragile casualty (assertion 1 fails);
    //   • `return best`    never leaves the `null` seed, so NO card is marked (also assertion 1).
    // Re-verified against both mutations. If you reorder these configs, this test stops testing.
    it('gives the best-ship marker to the config that withstands more raw damage, not less', async () => {
        renderDefenseCalculatorPage();

        // Add a second config. Both still read the same default hp/defense at this point, so
        // `getAllByLabelText` unambiguously returns [ship1, ship2] in render order.
        fireEvent.click(screen.getByRole('button', { name: 'Add Ship' }));

        const hpInputs = screen.getAllByLabelText('HP');
        const defenseInputs = screen.getAllByLabelText('Defense');
        expect(hpInputs).toHaveLength(2);
        expect(defenseInputs).toHaveLength(2);

        // Config 1 ("Ship 1"): effectively unkillable — outlasts the whole round window. FIRST, so
        // "marks the last config" and "marks the best config" cannot be the same answer.
        fireEvent.change(hpInputs[0], { target: { value: '999999999' } });
        fireEvent.change(defenseInputs[0], { target: { value: '20000' } });
        // Config 2 ("Ship 2"): fragile — dies to the first hit.
        fireEvent.change(hpInputs[1], { target: { value: '50' } });
        fireEvent.change(defenseInputs[1], { target: { value: '0' } });

        // Add one enemy attacker so there is pressure to measure at all.
        fireEvent.click(screen.getByRole('button', { name: /Add Enemy/i }));

        const survivorNote = await screen.findByText(/Survived all/i);
        const destroyedNote = screen.getByText(/Destroyed round/i);

        const survivorCard = survivorNote.closest('.card');
        const destroyedCard = destroyedNote.closest('.card');
        expect(survivorCard).not.toBeNull();
        expect(destroyedCard).not.toBeNull();
        expect(survivorCard).not.toBe(destroyedCard);

        // The tankier config (the survivor) must carry the marker; the one that died first must not.
        expect(
            within(survivorCard as HTMLElement).getByText('Best ship configuration')
        ).toBeInTheDocument();
        expect(
            within(destroyedCard as HTMLElement).queryByText('Best ship configuration')
        ).not.toBeInTheDocument();
    });
});
