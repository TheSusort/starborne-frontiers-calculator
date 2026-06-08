import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HealerConfigCard } from '../HealerConfigCard';
import { HealerShipConfig } from '../../../types/calculator';
import { buildDefaultShipSkills } from '../../../utils/abilities/configToSimInputs';
import { HealingSimulationResult } from '../../../utils/calculators/healingEngineAdapter';

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [], getShipById: () => undefined }),
}));

// Sidebar imports /favicon.ico?url which is not available in the test environment.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const config: HealerShipConfig = {
    id: '1',
    name: 'Healer 1',
    hp: 40000,
    attack: 10000,
    defence: 5000,
    crit: 50,
    critDamage: 100,
    healModifier: 20,
    speed: 100,
    hacking: 200,
    chargeCount: 0,
    startCharged: false,
    shipSkills: buildDefaultShipSkills(),
};

const makeResult = (destroyedRound?: number): HealingSimulationResult => ({
    rounds: [
        {
            round: 1,
            action: 'active',
            charges: 0,
            chargeCount: 0,
            didCrit: false,
            directHeal: 5000,
            hotHeal: 0,
            shield: 0,
            cleanseCount: 0,
            effectiveHealing: 5000,
            overheal: 1000,
            incomingDamage: 0,
            shieldAbsorbed: 0,
            targetHpPct: 100,
            targetShieldPool: 0,
            totalRoundHealing: 5000,
            cumulativeHealing: 5000,
            activeSelfBuffs: [],
            enemyEffects: [],
        },
    ],
    summary: {
        totalHealing: 6000,
        totalDirectHeal: 5000,
        totalHotHeal: 1000,
        totalShield: 2000,
        totalCleanses: 3,
        totalEffectiveHealing: 5000,
        totalOverheal: 1000,
        totalShieldAbsorbed: 1500,
        totalIncomingDamage: 0,
        avgHealingPerRound: 6000,
        ...(destroyedRound !== undefined ? { destroyedRound } : {}),
    },
});

const noop = () => {};

describe('HealerConfigCard', () => {
    it('renders the editable stats and the results summary', () => {
        render(
            <HealerConfigCard
                config={config}
                isBest
                isComparing={false}
                simResult={makeResult()}
                bestEffectiveHealing={5000}
                onRemove={noop}
                onUpdate={noop}
                onSelectShip={noop}
                onStartChargedChange={noop}
                onShipSkillsChange={noop}
            />
        );
        expect(screen.getByDisplayValue('Healer 1')).toBeInTheDocument();
        expect(screen.getByLabelText('HP')).toHaveValue(40000);
        expect(screen.getByLabelText('Heal Modifier (%)')).toHaveValue(20);
        expect(screen.getByText('Effective Healing')).toBeInTheDocument();
        expect(screen.getByText('Shield Absorbed')).toBeInTheDocument();
        // Overheal with % of raw: 1000 / 6000 = 17%
        expect(screen.getByText(/1,000 \(17% of raw\)/)).toBeInTheDocument();
    });

    it('shows positive survival text when the target survives', () => {
        render(
            <HealerConfigCard
                config={config}
                isBest={false}
                isComparing={false}
                simResult={makeResult()}
                bestEffectiveHealing={5000}
                onRemove={noop}
                onUpdate={noop}
                onSelectShip={noop}
                onStartChargedChange={noop}
                onShipSkillsChange={noop}
            />
        );
        expect(screen.getByText('Survived 1 round')).toBeInTheDocument();
    });

    it('shows danger survival text when the target is destroyed', () => {
        render(
            <HealerConfigCard
                config={config}
                isBest={false}
                isComparing={false}
                simResult={makeResult(7)}
                bestEffectiveHealing={5000}
                onRemove={noop}
                onUpdate={noop}
                onSelectShip={noop}
                onStartChargedChange={noop}
                onShipSkillsChange={noop}
            />
        );
        expect(screen.getByText('Destroyed round 7')).toBeInTheDocument();
    });

    it('propagates stat edits via onUpdate', () => {
        const onUpdate = vi.fn();
        render(
            <HealerConfigCard
                config={config}
                isBest={false}
                isComparing={false}
                simResult={undefined}
                bestEffectiveHealing={undefined}
                onRemove={noop}
                onUpdate={onUpdate}
                onSelectShip={noop}
                onStartChargedChange={noop}
                onShipSkillsChange={noop}
            />
        );
        fireEvent.change(screen.getByLabelText('HP'), { target: { value: '55000' } });
        expect(onUpdate).toHaveBeenCalledWith('hp', 55000);
    });
});
