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
    security: 0,
    chargeCount: 0,
    startCharged: false,
    shipSkills: buildDefaultShipSkills(),
};

const makeResult = (
    destroyedRound?: number,
    totalBarrierAbsorbed = 0
): HealingSimulationResult => ({
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
            barrierAbsorbed: 0,
            targetHpPct: 100,
            targetShieldPool: 0,
            totalRoundHealing: 5000,
            cumulativeHealing: 5000,
            activeSelfBuffs: [],
            healTargetBuffs: [],
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
        totalBarrierAbsorbed,
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
                slot="M2"
                onSlotChange={noop}
                takenSlots={[]}
            />
        );
        expect(screen.getByDisplayValue('Healer 1')).toBeInTheDocument();
        expect(screen.getByLabelText('HP')).toHaveValue(40000);
        expect(screen.getByLabelText('Heal Modifier (%)')).toHaveValue(20);
        expect(screen.getByText('Effective Healing')).toBeInTheDocument();
        expect(screen.getByText('Shield Absorbed')).toBeInTheDocument();
        // Overheal % of LANDED (recipient axis): totalOverheal / (totalEffectiveHealing +
        // totalOverheal) = 1000 / (5000 + 1000) = 17%. This fixture's totalHealing (6000)
        // happens to equal totalEffectiveHealing + totalOverheal too, so the number is
        // unchanged from the pre-fix "of raw" reading — the mixed-axis regression test below is
        // what actually distinguishes the two computations.
        expect(screen.getByText(/1,000 \(17% of landed\)/)).toBeInTheDocument();
        // The conditional "Barrier Absorbed" card is ABSENT when totalBarrierAbsorbed === 0.
        expect(screen.queryByText('Barrier Absorbed')).not.toBeInTheDocument();
    });

    // Review fix (SP-3b Task 7): `totalOverheal` is RECIPIENT-axis while `totalHealing` stayed
    // SOURCE-axis, so dividing overheal by totalHealing mixes the two — e.g. the role-filtered
    // regeneration scenario ends with totalOverheal: 4500, totalHealing: 0 (repairs came from an
    // ally, not the focus healer), which rendered "4,500 (0% of raw)" under the old formula.
    // The fixed ratio uses two recipient-axis numbers: totalOverheal / (totalEffectiveHealing +
    // totalOverheal) = 4500 / (3000 + 4500) = 60%.
    it('computes the overheal percentage from same-axis (recipient) numbers, not source throughput', () => {
        const mixedAxisResult: HealingSimulationResult = {
            rounds: [],
            summary: {
                totalHealing: 0, // SOURCE-axis: the focus healer cast nothing itself.
                totalDirectHeal: 0,
                totalHotHeal: 0,
                totalShield: 0,
                totalCleanses: 0,
                totalEffectiveHealing: 3000, // RECIPIENT-axis: landed on the heal target via an ally.
                totalOverheal: 4500, // RECIPIENT-axis.
                totalShieldAbsorbed: 0,
                totalBarrierAbsorbed: 0,
                totalIncomingDamage: 0,
                avgHealingPerRound: 0,
            },
        };
        render(
            <HealerConfigCard
                config={config}
                isBest
                isComparing={false}
                simResult={mixedAxisResult}
                bestEffectiveHealing={3000}
                onRemove={noop}
                onUpdate={noop}
                onSelectShip={noop}
                onStartChargedChange={noop}
                onShipSkillsChange={noop}
                slot="M2"
                onSlotChange={noop}
                takenSlots={[]}
            />
        );
        expect(screen.getByText(/4,500 \(60% of landed\)/)).toBeInTheDocument();
        expect(screen.queryByText(/0% of raw/)).not.toBeInTheDocument();
    });

    it('renders the Barrier Absorbed card when totalBarrierAbsorbed > 0', () => {
        render(
            <HealerConfigCard
                config={config}
                isBest
                isComparing={false}
                simResult={makeResult(undefined, 12345)}
                bestEffectiveHealing={5000}
                onRemove={noop}
                onUpdate={noop}
                onSelectShip={noop}
                onStartChargedChange={noop}
                onShipSkillsChange={noop}
                slot="M2"
                onSlotChange={noop}
                takenSlots={[]}
            />
        );
        expect(screen.getByText('Barrier Absorbed')).toBeInTheDocument();
        expect(screen.getByText((12345).toLocaleString())).toBeInTheDocument();
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
                slot="M2"
                onSlotChange={noop}
                takenSlots={[]}
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
                slot="M2"
                onSlotChange={noop}
                takenSlots={[]}
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
                slot="M2"
                onSlotChange={noop}
                takenSlots={[]}
            />
        );
        fireEvent.change(screen.getByLabelText('HP'), { target: { value: '55000' } });
        expect(onUpdate).toHaveBeenCalledWith('hp', 55000);
    });
});
