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

    it('marks a survivor distinctly and shows the absorbed total as a lower bound', () => {
        renderCard({
            result: {
                measuredEHP: 30_000,
                survived: true,
                elapsedRounds: 3,
                // toHp deliberately != measuredEHP/gross (5,000 absorbed by shield) so the
                // "To hull" row's number can't collide with the Measured EHP row's — a fixture
                // where every field is 30_000 makes `getByText('30,000')` ambiguous (matches
                // both rows) rather than proving the Measured EHP row specifically.
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
        expect(screen.getByText(/Measured EHP/i)).toBeInTheDocument();
        expect(screen.getByText('30,000')).toBeInTheDocument();
        // A survivor's number is a lower bound, never a death threshold.
        expect(screen.getByText(/Survived/i)).toBeInTheDocument();
    });

    it('names the round a casualty died in', () => {
        renderCard({
            result: {
                measuredEHP: 120_000,
                survived: false,
                destroyedRound: 2,
                elapsedRounds: 2,
                breakdown: {
                    toHp: 120_000,
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

    it('does not render the measured-EHP block when no result is provided', () => {
        renderCard();
        expect(screen.queryByText(/Measured EHP/i)).not.toBeInTheDocument();
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
