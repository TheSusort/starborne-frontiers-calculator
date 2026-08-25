import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DefenseShipCard } from '../DefenseShipCard';
import { DefenseShipConfig } from '../../../types/calculator';
import { buildDefaultShipSkills } from '../../../utils/abilities/configToSimInputs';
import { Ship } from '../../../types/ship';

const mockGetShipById = vi.fn((_id: string): Ship | undefined => undefined);

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [], getShipById: mockGetShipById }),
}));

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

// ShipSelector pulls in ShipDisplay which needs many context providers — stub it out, mirroring
// EnemyAttackersPanel.test.tsx.
vi.mock('../../ship/ShipSelector', () => ({
    ShipSelector: () => null,
}));

const baseConfig: DefenseShipConfig = {
    id: '1',
    name: 'Ship 1',
    hp: 10000,
    defense: 5000,
    security: 70,
    buffs: [],
    shipSkills: buildDefaultShipSkills(),
    attack: 0,
    crit: 0,
    critDamage: 0,
    speed: 100,
    hacking: 200,
    healModifier: 0,
    chargeCount: 0,
    startCharged: false,
};

const minimalShip: Ship = {
    id: 'x',
    name: 'Test Ship',
    rarity: 'LEGENDARY',
    faction: 'ATLAS_SYNDICATE',
    type: 'ATTACKER',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 0,
        security: 0,
        crit: 0,
        critDamage: 0,
        speed: 0,
    },
    equipment: {},
    implants: {},
    refits: [],
};

const noop = () => {};

const renderCard = (overrides: Partial<Parameters<typeof DefenseShipCard>[0]> = {}) =>
    render(
        <DefenseShipCard
            config={baseConfig}
            isBest={false}
            isComparing={false}
            rounds={3}
            onRemove={noop}
            onUpdate={noop}
            onSelectShip={noop}
            onBuffsChange={noop}
            onShipSkillsChange={noop}
            {...overrides}
        />
    );

describe('DefenseShipCard', () => {
    beforeEach(() => {
        mockGetShipById.mockReset();
        mockGetShipById.mockReturnValue(undefined);
    });

    // #358 ADDENDUM 2 — TWO AXES ON ONE CARD. `damageAbsorbed` is RAW damage THROWN at the ship;
    // `breakdown.gross` and its four terms are what ARRIVED, after defence mitigated it. They do
    // NOT sum, so every fixture below keeps them DISTINCT (raw strictly above gross). A fixture
    // where the two are equal — as this one used to be — cannot tell the axes apart and would
    // pass even if the card rendered the wrong one.
    it('marks a survivor distinctly and shows the raw figure with its rounds beside it', () => {
        renderCard({
            result: {
                damageAbsorbed: 80_000, // THROWN
                survived: true,
                elapsedRounds: 3,
                // Every number distinct so `getByText` proves the row it claims to: raw 80,000 vs
                // arrived 30,000, split 25,000 hull + 5,000 shield.
                breakdown: {
                    toHp: 25_000,
                    toShield: 5_000,
                    toBarrier: 0,
                    toConversion: 0,
                    gross: 30_000,
                },
                rounds: [],
            },
        });
        expect(screen.getByText(/Damage absorbed/i)).toBeInTheDocument();
        expect(screen.getByText('80,000')).toBeInTheDocument();
        // ROUNDS BESIDE THE FIGURE (owner ruling). Required, not decorative: the metric only moves
        // when the round of death moves, so the rounds are what separate two equal headlines.
        expect(screen.getByText(/over 3 rounds/i)).toBeInTheDocument();
        // A survivor's number is a lower bound, never a death threshold.
        expect(screen.getByText(/Survived all 3 rounds/i)).toBeInTheDocument();
        expect(screen.getByText(/lower bound, not a limit/i)).toBeInTheDocument();
    });

    it('labels the breakdown axis so the raw headline is not read as its total', () => {
        renderCard({
            result: {
                damageAbsorbed: 80_000,
                survived: true,
                elapsedRounds: 3,
                breakdown: {
                    toHp: 25_000,
                    toShield: 5_000,
                    toBarrier: 0,
                    toConversion: 0,
                    gross: 30_000,
                },
                rounds: [],
            },
        });
        // The breakdown carries its OWN sub-total, explicitly labelled as the post-reduction axis —
        // without it a reader sums 25,000 + 5,000 against an 80,000 headline and calls it a bug.
        // "(after its reductions)", not "(after defence)": the sub-total is also after the victim's
        // own `Inc. Damage Down`, `equipReductionPct`, `preFightIncoming` and block procs, so the
        // narrower label understated what it covers (finding M5).
        expect(screen.getByText(/Reached the ship \(after its reductions\)/i)).toBeInTheDocument();
        expect(screen.getByText('30,000')).toBeInTheDocument();
        expect(
            screen.getByText(/everything thrown at it, before its own reductions/i)
        ).toBeInTheDocument();
    });

    // #358 ADDENDUM 3 (C1) — THE HEADLINE ORDER. Rounds survived first, damage absorbed second,
    // the static estimate third and named for what it is. Asserted on DOCUMENT ORDER, not mere
    // presence: three labels that all exist somewhere on the card is exactly the state this
    // requirement was written to change.
    it('renders the three headline numbers in order: rounds, damage absorbed, theoretical EHP', () => {
        const { container } = renderCard({
            result: {
                damageAbsorbed: 80_000,
                survived: true,
                elapsedRounds: 3,
                breakdown: {
                    toHp: 25_000,
                    toShield: 5_000,
                    toBarrier: 0,
                    toConversion: 0,
                    gross: 30_000,
                },
                rounds: [],
            },
        });
        const text = container.textContent ?? '';
        const rounds = text.indexOf('Rounds survived');
        const absorbed = text.indexOf('Damage absorbed');
        const theoretical = text.indexOf('Theoretical EHP');
        expect(rounds).toBeGreaterThanOrEqual(0);
        expect(absorbed).toBeGreaterThan(rounds);
        expect(theoretical).toBeGreaterThan(absorbed);
        // "Measured EHP" is RETIRED — the name is what invited the post-mitigation reading.
        expect(text).not.toContain('Measured EHP');
        // …and the static figure says it is an estimate, not a measurement.
        expect(
            screen.getByText(/An estimate from hangar stats, not a measurement/i)
        ).toBeInTheDocument();
    });

    // #358 ADDENDUM 3 (Part B, finding 6) — THE BREAKDOWN ROWS ARE ROUNDED. They rendered through a
    // bare `.toLocaleString()` while the headline was `Math.round`-ed, so a real fight printed
    // "To hull 24,999.667" directly under a clean "30,000". Fractional fixture values, because an
    // integer one cannot tell a rounded render from an unrounded one.
    it('rounds every breakdown row, not just the headline', () => {
        renderCard({
            result: {
                damageAbsorbed: 80_000.4,
                survived: true,
                elapsedRounds: 3,
                breakdown: {
                    toHp: 24_999.667,
                    toShield: 5_000.333,
                    toBarrier: 1_200.5,
                    toConversion: 800.25,
                    gross: 32_000.75,
                },
                rounds: [],
            },
        });
        for (const shown of ['25,000', '5,000', '1,201', '800', '32,001', '80,000']) {
            expect(screen.getByText(shown)).toBeInTheDocument();
        }
        // The explicit negative: no row may still print its fraction.
        expect(screen.queryByText(/24,999\.667/)).not.toBeInTheDocument();
        expect(screen.queryByText(/5,000\.333/)).not.toBeInTheDocument();
    });

    // #358 finding I5 — ROSTER-WIPE TERMINATION falsifies "Survived all N rounds". A fight ends at
    // the end of the round that wipes a side (#329), so a high-attack defender can finish on round
    // 6 of a 20-round setting: `survived: true`, `elapsedRounds: 6`, and the card used to print
    // "Survived all 6 rounds" against a window the user had set to 20. Two such survivors also
    // absorb DIFFERENT totals, which is why the changelog's "two survivors tie" is now qualified.
    it('says the enemy team was wiped when a survivor ends the fight early', () => {
        renderCard({
            rounds: 20,
            result: {
                damageAbsorbed: 80_000,
                survived: true,
                elapsedRounds: 6, // SHORTER than the configured window
                breakdown: {
                    toHp: 25_000,
                    toShield: 0,
                    toBarrier: 0,
                    toConversion: 0,
                    gross: 30_000,
                },
                rounds: [],
            },
        });
        expect(screen.getByText(/the enemy team was wiped on round 6 of 20/i)).toBeInTheDocument();
        // …and it must NOT claim the full window was survived.
        expect(screen.queryByText(/Survived all/i)).not.toBeInTheDocument();
    });

    it('says the full window was survived when it really was', () => {
        renderCard({
            rounds: 6,
            result: {
                damageAbsorbed: 80_000,
                survived: true,
                elapsedRounds: 6, // EQUALS the configured window
                breakdown: {
                    toHp: 25_000,
                    toShield: 0,
                    toBarrier: 0,
                    toConversion: 0,
                    gross: 30_000,
                },
                rounds: [],
            },
        });
        expect(screen.getByText(/Survived all 6 rounds/i)).toBeInTheDocument();
        expect(screen.queryByText(/wiped on round/i)).not.toBeInTheDocument();
    });

    it('names the round a casualty died in', () => {
        renderCard({
            result: {
                damageAbsorbed: 300_000, // THROWN
                survived: false,
                destroyedRound: 2,
                elapsedRounds: 2,
                breakdown: {
                    toHp: 120_000, // ARRIVED — roughly the ship's HP, as it always is on a casualty
                    toShield: 0,
                    toBarrier: 0,
                    toConversion: 0,
                    gross: 120_000,
                },
                rounds: [],
            },
        });
        expect(screen.getByText(/Destroyed round 2/i)).toBeInTheDocument();
    });

    it('does not render the damage-absorbed block when no result is provided', () => {
        renderCard();
        expect(screen.queryByText(/Damage absorbed/i)).not.toBeInTheDocument();
    });

    it('does not show a Passive row for a ship with no passive skill text', () => {
        mockGetShipById.mockImplementation((id: string) =>
            id === 'x' ? { ...minimalShip, activeSkillText: 'Deals damage.' } : undefined
        );
        renderCard({ config: { ...baseConfig, shipId: 'x' } });
        fireEvent.click(screen.getByText(/Show Advanced/i));
        expect(screen.queryByText('Passive')).not.toBeInTheDocument();
    });

    it('shows a Passive row for a ship with passive skill text', () => {
        mockGetShipById.mockImplementation((id: string) =>
            id === 'x'
                ? {
                      ...minimalShip,
                      activeSkillText: 'Deals damage.',
                      firstPassiveSkillText: 'Regenerates HP each round.',
                  }
                : undefined
        );
        renderCard({ config: { ...baseConfig, shipId: 'x' } });
        fireEvent.click(screen.getByText(/Show Advanced/i));
        expect(screen.getByText('Passive')).toBeInTheDocument();
    });
});
