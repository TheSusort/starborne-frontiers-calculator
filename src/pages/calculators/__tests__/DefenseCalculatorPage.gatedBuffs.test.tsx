import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DefenseCalculatorPage from '../DefenseCalculatorPage';
import { ShipSelector } from '../../../components/ship/ShipSelector';
import { computeBuffedStats } from '../../../utils/calculators/defenseCalculator';
import type { Ship } from '../../../types/ship';

// Task 8 (#391): Theoretical EHP must NOT count an auto-filled kit buff whose grant is
// conditionally GATED (e.g. Redeemer's "Defense Up II when HP drops below 60%"). This file
// exercises the real end-to-end wiring — ship selection -> buildShipAbilitiesWithEquipment ->
// gatedAutoFilledBuffs -> mergedBuffTotals -> the rendered "Theoretical EHP:" figure — rather than
// re-testing gatedAutoFilledBuffs in isolation (that lives in gatedBuffs.test.ts).
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
// Stubbed to null by default (ShipSelector pulls in heavy context-dependent display machinery);
// this file's only test swaps in a real, clickable stand-in so `selectShipForConfig` runs
// end-to-end, mirroring HealingCalculatorPage.test.tsx's convention.
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

// A mutable container the two mocked builders below read from, so the SAME grant can be flipped
// between gated and ungated across two clicks in one test. `vi.hoisted` because `vi.mock` factories
// are hoisted above ordinary `let`/`const` declarations.
const mockState = vi.hoisted(() => ({
    conditions: [
        {
            subject: 'hp-threshold',
            derivable: true,
            hpComparator: 'below',
            hpPercent: 60,
            hpSubject: 'self',
        },
    ] as unknown[],
}));

// Controls the ABILITY side of the join: a passive `buff` ability granting "Defense Up II", gated
// by whatever `mockState.conditions` currently holds.
vi.mock('../../../utils/abilities/buildShipAbilitiesWithEquipment', () => ({
    buildShipAbilitiesWithEquipment: () => ({
        slots: [
            {
                slot: 'passive',
                abilities: [
                    {
                        id: 'mock-redeemer-defense-up',
                        type: 'buff',
                        target: 'self',
                        trigger: 'on-cast',
                        conditions: mockState.conditions,
                        config: {
                            type: 'buff',
                            buffName: 'Defense Up II',
                            parsedEffects: { defense: 30 },
                            stacks: 1,
                            isStackable: false,
                        },
                    },
                ],
            },
        ],
    }),
}));

// Controls the BUFF side of the join: the auto-filled "Defense Up II" SelectedGameBuff that must
// match the ability above by buffName + skillSource -> Skill.slot. `mergeAutoFill` stays real.
vi.mock('../../../utils/calculators/skillBuffAutoFill', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('../../../utils/calculators/skillBuffAutoFill')>();
    return {
        ...actual,
        buildSkillBuffAutoFill: () => ({
            selfBuffs: [
                {
                    id: 'Defense Up II-passive1-self',
                    buffName: 'Defense Up II',
                    stacks: 1,
                    parsedEffects: { defense: 30 },
                    isStackable: false,
                    autoFilled: true,
                    skillSource: 'passive1',
                },
            ],
            enemyDebuffs: [],
        }),
    };
});

const mockShip: Ship = {
    id: 'mock-redeemer',
    name: 'Mock Redeemer',
    rarity: 'LEGENDARY',
    faction: 'ATLAS_SYNDICATE',
    type: 'SUPPORTER',
    baseStats: {
        hp: 40000,
        attack: 5000,
        defence: 5000,
        hacking: 200,
        security: 0,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
};

const renderDefenseCalculatorPage = () =>
    render(
        <MemoryRouter>
            <DefenseCalculatorPage />
        </MemoryRouter>
    );

/** Reads the rendered "Theoretical EHP:" figure out of the given card. */
const readTheoreticalEHP = (card: HTMLElement): number => {
    const label = within(card).getByText('Theoretical EHP:');
    const row = label.parentElement as HTMLElement;
    const valueSpan = row.querySelectorAll('span')[1];
    return Number((valueSpan.textContent ?? '').replace(/,/g, ''));
};

describe('DefenseCalculatorPage gated buffs (#391)', () => {
    beforeEach(() => {
        mockGetShipById.mockReset();
        mockGetShipById.mockReturnValue(undefined);
        mockState.conditions = [
            {
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: 'below',
                hpPercent: 60,
                hpSubject: 'self',
            },
        ];
        vi.mocked(ShipSelector).mockReset();
        vi.mocked(ShipSelector).mockImplementation(
            ({ onSelect }: { onSelect: (ship: Ship) => void }) => (
                <button onClick={() => onSelect(mockShip)}>pick mock ship</button>
            )
        );
    });

    it('excludes a below-60%-HP gated Defense Up II from Theoretical EHP, and counts it once the gate is lifted', () => {
        renderDefenseCalculatorPage();
        const card = screen.getByText('pick mock ship').closest('.card') as HTMLElement;

        // Gated: the grant's only path carries an unmet HP-threshold condition, so the buff must
        // NOT be counted. Compare against the formula computed with NO buff at all — an exact
        // match here means the gated buff contributed nothing, not merely "some smaller amount".
        fireEvent.click(within(card).getByText('pick mock ship'));
        const hp = Number(within(card).getByLabelText<HTMLInputElement>('HP').value);
        const defense = Number(within(card).getByLabelText<HTMLInputElement>('Defense').value);
        const security = Number(within(card).getByLabelText<HTMLInputElement>('Security').value);

        const gatedEHP = readTheoreticalEHP(card);
        const expectedUngatedFromZeroBuff = Math.round(
            computeBuffedStats(hp, defense, security, undefined).effectiveHP
        );
        expect(gatedEHP).toBe(expectedUngatedFromZeroBuff);

        // Vacuity guard: lift the gate (conditions -> []) and re-select the same ship so the page
        // rebuilds `shipSkills` from the now-ungated mock. A detector that silently reported
        // nothing would already have passed the assertion above — this is the half that catches it.
        mockState.conditions = [];
        fireEvent.click(within(card).getByText('pick mock ship'));

        const ungatedEHP = readTheoreticalEHP(card);
        const expectedWithBuffCounted = Math.round(
            computeBuffedStats(hp, defense, security, {
                defenseBuff: 30,
                incomingDamageBuff: 0,
                securityBuff: 0,
            }).effectiveHP
        );
        expect(ungatedEHP).toBe(expectedWithBuffCounted);
        expect(ungatedEHP).toBeGreaterThan(gatedEHP);
    });

    // Item 3 (#391 final review): `gatedBuffsByConfig`'s `useMemo` threads real page state
    // (`c.speed`, `allySpeeds`/`enemyDebuffNames` derived from `teamShips`, `hasEnemy` from
    // `enemies.length > 0`) into `gatedAutoFilledBuffs` — but nothing previously observed that
    // wiring surviving a regression to hardcoded/inert state. Chakara's "lowest Speed among
    // allies" shape is the sharpest lever: with an EMPTY ally roster the measured ship is
    // trivially the slowest of one -> MET -> the buff counts and the disclosure line is absent.
    // Adding a real team ship with a LOWER speed flips the gate to NOT MET -> the buff drops and
    // "Not counted (conditional):" appears naming it. A hardcoded `allySpeeds: []` state (the
    // reviewer's proven mutation) cannot see the added team ship at all, so this assertion stays
    // on the "absent" branch even after the slower ally is added.
    it('threads the real ally roster into the gate: adding a slower team ship flips lowest-speed-ally from met to unmet', () => {
        mockState.conditions = [{ subject: 'lowest-speed-ally', derivable: true }];
        renderDefenseCalculatorPage();
        const card = screen.getByText('pick mock ship').closest('.card') as HTMLElement;
        fireEvent.click(within(card).getByText('pick mock ship'));

        // Empty ally roster (the page's default state): the measured ship (speed 100) is
        // trivially the sole, and therefore lowest-speed, actor -> MET -> nothing dropped.
        expect(screen.queryByText('Not counted (conditional):')).not.toBeInTheDocument();

        // Add a team ship and give it a Speed lower than the measured ship's 100 — a real ally
        // that is genuinely slower, so the measured ship is no longer the lowest-speed one.
        fireEvent.click(screen.getByText('+ Add team ship'));
        fireEvent.change(screen.getByLabelText('Speed'), { target: { value: '50' } });

        expect(within(card).getByText('Not counted (conditional):')).toBeInTheDocument();
        expect(
            within(card).getByText(
                '- Defense Up II - when this unit has the lowest Speed among allies'
            )
        ).toBeInTheDocument();
    });
});
