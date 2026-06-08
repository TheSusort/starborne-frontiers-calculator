import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { EnemyEffectsOverview } from '../EnemyEffectsOverview';
import { HealingSimulationResult } from '../../../utils/calculators/healingEngineAdapter';

const baseRow = (round: number, hpPct: number) => ({
    round,
    action: 'active' as const,
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
    targetHpPct: hpPct,
    targetShieldPool: 0,
    totalRoundHealing: 0,
    cumulativeHealing: 0,
    activeSelfBuffs: [],
});

// Round 1: TWO enemies each produce distinct effects. Round 2: no enemy effects.
const makeResult = (): HealingSimulationResult => ({
    rounds: [
        {
            ...baseRow(1, 100),
            enemyEffects: [
                {
                    enemyId: 'e1',
                    selfBuffs: [{ buffName: 'Attack Up', turnsRemaining: 2 }],
                    debuffs: [{ buffName: 'Defense Down', turnsRemaining: 3, stacks: 2 }],
                },
                {
                    enemyId: 'e2',
                    selfBuffs: [{ buffName: 'Crit Up', turnsRemaining: 1 }],
                    debuffs: [{ buffName: 'Corrosion', turnsRemaining: 2 }],
                },
            ],
        },
        {
            ...baseRow(2, 90),
            enemyEffects: [],
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

const NAMES: Record<string, string> = { e1: 'Makoli', e2: 'Enemy 2' };
const enemyName = (id: string) => NAMES[id] ?? id;

describe('EnemyEffectsOverview', () => {
    it('groups effects by the source enemy ship, labelled with its resolved name', () => {
        render(<EnemyEffectsOverview result={makeResult()} rounds={2} enemyName={enemyName} />);

        // Each enemy attacker's resolved name is shown as a sub-header.
        const makoli = screen.getByText('Makoli');
        const enemy2 = screen.getByText('Enemy 2');
        expect(makoli).toBeInTheDocument();
        expect(enemy2).toBeInTheDocument();

        // The first enemy's own effects render (its self-buff + the debuff it landed).
        expect(screen.getByText('Attack Up')).toBeInTheDocument();
        expect(screen.getByText('Defense Down')).toBeInTheDocument();
        // The second enemy's own effects render, attributed separately.
        expect(screen.getByText('Crit Up')).toBeInTheDocument();
        expect(screen.getByText('Corrosion')).toBeInTheDocument();
    });

    it('renders each enemy group with its own Self-Buffs and Debuffs sub-sections', () => {
        render(<EnemyEffectsOverview result={makeResult()} rounds={2} enemyName={enemyName} />);
        // Two enemy groups in round 1 → two of each sub-heading.
        expect(screen.getAllByText('Self-Buffs').length).toBe(2);
        expect(screen.getAllByText('Debuffs on Target').length).toBe(2);
    });

    it('shows a "no enemy effects" note for a round with no enemy effects', () => {
        render(<EnemyEffectsOverview result={makeResult()} rounds={2} enemyName={enemyName} />);
        // Round 2 has no effects.
        expect(screen.getAllByText(/no enemy effects/i).length).toBeGreaterThan(0);
    });

    it('falls back to the raw enemy id when no name is resolved', () => {
        render(<EnemyEffectsOverview result={makeResult()} rounds={2} enemyName={(id) => id} />);
        expect(screen.getByText('e1')).toBeInTheDocument();
        expect(screen.getByText('e2')).toBeInTheDocument();
    });

    it('scopes each enemy group: its name header sits above its own effect rows', () => {
        render(<EnemyEffectsOverview result={makeResult()} rounds={2} enemyName={enemyName} />);
        // The round-1 container holds both enemy groups; Makoli's group carries Attack Up.
        const round1 = screen.getByText('Round 1').parentElement as HTMLElement;
        expect(within(round1).getByText('Makoli')).toBeInTheDocument();
        expect(within(round1).getByText('Attack Up')).toBeInTheDocument();
        expect(within(round1).getByText('Crit Up')).toBeInTheDocument();
    });
});
