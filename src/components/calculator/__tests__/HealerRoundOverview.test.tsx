import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { HealerRoundOverview } from '../HealerRoundOverview';
import {
    HealingSimulationResult,
    HealingRoundData,
} from '../../../utils/calculators/healingEngineAdapter';

const row = (over: Partial<HealingRoundData>): HealingRoundData => ({
    round: 1,
    action: 'active',
    charges: 0,
    chargeCount: 0,
    didCrit: false,
    directHeal: 0,
    hotHeal: 0,
    shield: 0,
    cleanseCount: 0,
    effectiveHealing: 0,
    overheal: 0,
    incomingDamage: 0,
    shieldAbsorbed: 0,
    targetHpPct: 100,
    targetShieldPool: 0,
    totalRoundHealing: 0,
    cumulativeHealing: 0,
    activeSelfBuffs: [],
    enemyEffects: [],
    ...over,
});

// Round 1: a crit active heal with HoT, shield, a cleanse, overheal, and incoming damage.
// Round 2: a charged action with nothing happening (empty round). Round 3: team healing present.
const makeResult = (): HealingSimulationResult => ({
    rounds: [
        row({
            round: 1,
            didCrit: true,
            directHeal: 5000,
            hotHeal: 1200,
            shield: 3000,
            cleanseCount: 2,
            effectiveHealing: 4800,
            overheal: 1400,
            incomingDamage: 2500,
            shieldAbsorbed: 1000,
            targetHpPct: 60,
            targetShieldPool: 2000,
            totalRoundHealing: 6200,
            cumulativeHealing: 6200,
        }),
        row({
            round: 2,
            action: 'charged',
            chargeCount: 3,
            targetHpPct: 80,
            cumulativeHealing: 6200,
        }),
        row({
            round: 3,
            directHeal: 2000,
            effectiveHealing: 2000,
            targetHpPct: 95,
            totalRoundHealing: 2000,
            cumulativeHealing: 8200,
            teamHealing: 1500,
        }),
    ],
    summary: {
        totalHealing: 8200,
        totalDirectHeal: 7000,
        totalHotHeal: 1200,
        totalShield: 3000,
        totalCleanses: 2,
        totalEffectiveHealing: 6800,
        totalOverheal: 1400,
        totalShieldAbsorbed: 1000,
        totalIncomingDamage: 2500,
        avgHealingPerRound: 2733,
    },
});

describe('HealerRoundOverview', () => {
    it('renders a per-round block for each round with its round number', () => {
        render(<HealerRoundOverview result={makeResult()} name="Tassio" rounds={3} />);
        expect(screen.getByText('Round 1')).toBeInTheDocument();
        expect(screen.getByText('Round 2')).toBeInTheDocument();
        expect(screen.getByText('Round 3')).toBeInTheDocument();
    });

    it('surfaces the per-round healer output numbers for an active heal round', () => {
        render(<HealerRoundOverview result={makeResult()} name="Tassio" rounds={3} />);
        const round1 = screen.getByText('Round 1').closest('div[data-round]') as HTMLElement;

        // Direct heal, HoT, shield granted, effective, overheal all rendered as formatted numbers.
        expect(within(round1).getByText(/5,000/)).toBeInTheDocument(); // direct heal
        expect(within(round1).getByText(/1,200/)).toBeInTheDocument(); // HoT
        expect(within(round1).getByText(/3,000/)).toBeInTheDocument(); // shield granted
        expect(within(round1).getByText(/4,800/)).toBeInTheDocument(); // effective heal
        expect(within(round1).getByText(/1,400/)).toBeInTheDocument(); // overheal
        // Cleanses count — paired with its label.
        const cleanseLabel = within(round1).getByText('Cleanses');
        expect(
            within(cleanseLabel.parentElement as HTMLElement).getByText('2')
        ).toBeInTheDocument();
        // Incoming damage and target HP%.
        expect(within(round1).getByText(/2,500/)).toBeInTheDocument();
        expect(within(round1).getByText(/60%/)).toBeInTheDocument();
    });

    it('marks a crit round with a Crit badge', () => {
        render(<HealerRoundOverview result={makeResult()} name="Tassio" rounds={3} />);
        const round1 = screen.getByText('Round 1').closest('div[data-round]') as HTMLElement;
        expect(within(round1).getByText(/crit/i)).toBeInTheDocument();
    });

    it('marks a charged round with a Charged badge', () => {
        render(<HealerRoundOverview result={makeResult()} name="Tassio" rounds={3} />);
        const round2 = screen.getByText('Round 2').closest('div[data-round]') as HTMLElement;
        expect(within(round2).getByText(/charged/i)).toBeInTheDocument();
    });

    it('shows team healing when the round carries it', () => {
        render(<HealerRoundOverview result={makeResult()} name="Tassio" rounds={3} />);
        const round3 = screen.getByText('Round 3').closest('div[data-round]') as HTMLElement;
        expect(within(round3).getByText(/1,500/)).toBeInTheDocument();
    });

    it('renders the healer name in the header', () => {
        render(<HealerRoundOverview result={makeResult()} name="Tassio" rounds={3} />);
        expect(screen.getByText(/Tassio/)).toBeInTheDocument();
    });

    it('clamps the rendered rounds to the available round data', () => {
        render(<HealerRoundOverview result={makeResult()} name="Tassio" rounds={10} />);
        // Only 3 rounds exist in the fixture, so no Round 4 block.
        expect(screen.queryByText('Round 4')).not.toBeInTheDocument();
    });
});
