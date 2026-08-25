/**
 * #358 TASK 13, BLOCKER 2 — the ZERO-PRESSURE default must not rank on `elapsedRounds`.
 *
 * The page's default state seeds `enemies: []`, which the adapter runs as ONE inert practice target
 * (40,000 HP / 5,000 defence, `attack: 0` — `healingEngineAdapter.ts`). That target is KILLABLE,
 * and the defender takes its own turns with the real `attack` off the ship sheet, so a wiped roster
 * ends the run (#329). MEASURED at `rounds: 20`, `damageAbsorbed` 0 throughout:
 *
 *     defender attack       0 → 20 rounds
 *                       4,000 → 13 rounds
 *                      40,000 →  2 rounds
 *                     400,000 →  1 round
 *
 * So with `elapsedRounds` at key 2 of the ranking ladder the badge went to the WEAKEST-ATTACKING
 * ship on the very first page a user ever sees — and three shipped claims said the default
 * "degrades gracefully to main's old static ranking". The ladder is now
 * `damageAbsorbed → Theoretical EHP → elapsedRounds`.
 *
 * ⚠️ WHY THIS IS A SEPARATE FILE AND NOT ONE MORE ARM IN `DefenseCalculatorPage.test.tsx`. That
 * file's arms cannot reach this: `attack` has NO input on the ship card, so the only way to give a
 * config a non-zero one is to pick a ship — and that file mocks `ShipSelector` to `() => null`.
 * The existing zero-pressure arm therefore runs at attack 0 for every config, where the round
 * counts TIE and key 3 never speaks. `vi.mock` is hoisted per module, so the stub below cannot be
 * shared with that file (the same reason `HealingCalculatorPage.zeroEnemies.test.tsx` duplicates
 * its mock block).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DefenseCalculatorPage from '../DefenseCalculatorPage';
import type { Ship } from '../../../types/ship';

/** Two ships that differ ONLY in attack. Everything the ranking reads about toughness is set
 *  through the card's own HP/Defense inputs afterwards, so Theoretical EHP is explicit in the test
 *  body rather than a by-product of `calculateTotalStats`. */
const { PEASHOOTER, SLEDGEHAMMER } = vi.hoisted(() => {
    const base = {
        rarity: 'legendary',
        faction: 'terran',
        type: 'defender',
        affinity: 'chemical',
        level: 60,
        rank: 5,
        equipment: {},
        refits: [],
        implants: [],
        // Parses to a plain 200%-damage active (verified against the real parser). Without an
        // offensive ability the defender never swings, the practice target never dies, and every
        // config reports the full window — which is exactly the blind spot this file exists to
        // cover.
        activeSkillText: 'This Unit deals <unit-damage>200% damage</unit-damage>.',
    };
    return {
        PEASHOOTER: {
            ...base,
            id: 'peashooter',
            name: 'Peashooter',
            baseStats: {
                hp: 10_000,
                attack: 1_000,
                defence: 5_000,
                speed: 100,
                crit: 0,
                critDamage: 0,
                hacking: 200,
                security: 70,
            },
        } as unknown as Ship,
        SLEDGEHAMMER: {
            ...base,
            id: 'sledgehammer',
            name: 'Sledgehammer',
            baseStats: {
                hp: 10_000,
                attack: 100_000,
                defence: 5_000,
                speed: 100,
                crit: 0,
                critDamage: 0,
                hacking: 200,
                security: 70,
            },
        } as unknown as Ship,
    };
});

const SHIPS_BY_ID = new Map<string, Ship>([
    [PEASHOOTER.id, PEASHOOTER],
    [SLEDGEHAMMER.id, SLEDGEHAMMER],
]);

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({
        ships: [...SHIPS_BY_ID.values()],
        getShipById: (id: string) => SHIPS_BY_ID.get(id),
    }),
}));
vi.mock('../../../contexts/InventoryProvider', () => ({
    useInventory: () => ({ getGearPiece: () => undefined }),
}));
vi.mock('../../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({ getEngineeringStatsForShipType: () => undefined }),
}));
vi.mock('../../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));
/** The one mock that differs from the sibling file: a real selector, so a config can be given a
 *  non-zero `attack`. One button per ship, per card. */
vi.mock('../../../components/ship/ShipSelector', () => ({
    ShipSelector: ({ onSelect }: { onSelect: (ship: Ship) => void }) => (
        <div>
            {[...SHIPS_BY_ID.values()].map((s) => (
                <button key={s.id} onClick={() => onSelect(s)}>
                    {`pick-${s.id}`}
                </button>
            ))}
        </div>
    ),
}));
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

describe('DefenseCalculatorPage — zero-pressure ranking', () => {
    it('ranks on Theoretical EHP, not on the rounds a weak attacker racks up', async () => {
        render(
            <MemoryRouter>
                <DefenseCalculatorPage />
            </MemoryRouter>
        );

        // NO enemy is added. Deliberately: this is the default page, key 1 (`damageAbsorbed`) ties
        // at 0, and the question is which key breaks that tie.
        fireEvent.click(screen.getByRole('button', { name: 'Add Ship' }));

        // ⚠️ ORDER IS THE TEST. The card that must LOSE is FIRST, so "first wins" and "best wins"
        // cannot be the same answer. Card 1 is the weak attacker (many rounds, low Theoretical
        // EHP); card 2 is the hard hitter (few rounds, high Theoretical EHP).
        const pickWeak = screen.getAllByRole('button', { name: 'pick-peashooter' });
        const pickHard = screen.getAllByRole('button', { name: 'pick-sledgehammer' });
        expect(pickWeak).toHaveLength(2);
        fireEvent.click(pickWeak[0]);
        fireEvent.click(pickHard[1]);

        // Toughness is set AFTER selection, because selecting a ship overwrites hp/defense from the
        // sheet. Card 2 is far tankier, so Theoretical EHP orders them the opposite way to rounds.
        const hpInputs = screen.getAllByLabelText('HP');
        const defenseInputs = screen.getAllByLabelText('Defense');
        fireEvent.change(hpInputs[0], { target: { value: '10000' } });
        fireEvent.change(defenseInputs[0], { target: { value: '0' } });
        fireEvent.change(hpInputs[1], { target: { value: '999999' } });
        fireEvent.change(defenseInputs[1], { target: { value: '20000' } });

        // LIVENESS 1 — the two configs really do have DIFFERENT round counts, so key 3 is not
        // inert and this arm is genuinely discriminating. The weak attacker never finishes the
        // practice target and reports the full window; the hard hitter ends the run early.
        expect(await screen.findByText(/Survived all 20 rounds/)).toBeInTheDocument();
        const earlyFinish = screen.getByText(/destroyed the inert practice target on round/);
        expect(earlyFinish).toBeInTheDocument();

        // LIVENESS 2 — key 1 really is tied, so the tie-break ladder is what answered. With
        // nothing shooting back the "Compared to best" row is suppressed (0/0), and the
        // zero-pressure notice above the cards states the same thing.
        expect(
            screen.getByText(/No enemy attackers yet, so nothing is being thrown/)
        ).toBeInTheDocument();

        // THE ASSERTION. The badge is on the tanky card — the SECOND one added, and the one with
        // FEWER rounds. With `elapsedRounds` back at key 2 it lands on the Peashooter instead.
        const badge = screen.getByText('Best ship configuration');
        const bestCard = badge.closest('.card') as HTMLElement;
        expect(bestCard).not.toBeNull();
        expect(within(bestCard).getByDisplayValue('999999')).toBeInTheDocument();
        expect(within(bestCard).getByDisplayValue('20000')).toBeInTheDocument();
        // …and the early finish is on that same card, i.e. the winner is the one with the FEWEST
        // rounds. Without this the assertion above would also pass on an engine where the tanky
        // ship happened to survive longest.
        expect(earlyFinish.closest('.card')).toBe(bestCard);
        // Exactly one badge — a reduce that marks everything would satisfy the checks above.
        expect(screen.getAllByText('Best ship configuration')).toHaveLength(1);
    });
});
