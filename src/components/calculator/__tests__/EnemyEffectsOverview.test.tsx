import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EnemyEffectsOverview } from '../EnemyEffectsOverview';
import { HealingSimulationResult } from '../../../utils/calculators/healingEngineAdapter';

const makeResult = (): HealingSimulationResult => ({
    rounds: [
        {
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
            incomingDamage: 3000,
            shieldAbsorbed: 0,
            targetHpPct: 100,
            targetShieldPool: 0,
            totalRoundHealing: 0,
            cumulativeHealing: 0,
            activeSelfBuffs: [],
            enemySelfBuffs: [{ buffName: 'Attack Up', turnsRemaining: 2 }],
            targetDebuffs: [{ buffName: 'Defense Down', turnsRemaining: 3, stacks: 2 }],
        },
        {
            round: 2,
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
            incomingDamage: 3000,
            shieldAbsorbed: 0,
            targetHpPct: 90,
            targetShieldPool: 0,
            totalRoundHealing: 0,
            cumulativeHealing: 0,
            activeSelfBuffs: [],
            enemySelfBuffs: [],
            targetDebuffs: [],
        },
    ],
    summary: {
        totalHealing: 0,
        totalDirectHeal: 0,
        totalHotHeal: 0,
        totalShield: 0,
        totalCleanses: 0,
        totalEffectiveHealing: 0,
        totalOverheal: 0,
        totalShieldAbsorbed: 0,
        totalIncomingDamage: 6000,
        avgHealingPerRound: 0,
    },
});

describe('EnemyEffectsOverview', () => {
    it('renders the enemy self-buffs and target debuffs for a round with effects', () => {
        render(<EnemyEffectsOverview result={makeResult()} rounds={2} />);
        expect(screen.getByText('Attack Up')).toBeInTheDocument();
        expect(screen.getByText('Defense Down')).toBeInTheDocument();
        // Section headings present.
        expect(screen.getByText('Enemy Self-Buffs')).toBeInTheDocument();
        expect(screen.getByText('Debuffs on Target')).toBeInTheDocument();
    });

    it('shows a "nothing applied" note for a round with no enemy effects', () => {
        render(<EnemyEffectsOverview result={makeResult()} rounds={2} />);
        // Round 2 has no effects.
        expect(screen.getAllByText(/no enemy effects/i).length).toBeGreaterThan(0);
    });
});
