/**
 * SP-2 Task 5: the panel's "End of Round" section reads the engine's round-tail status snapshot.
 *
 * Distinct from the existing "Your Buffs" / "Enemy Debuffs" sections above it, which are the
 * focus's TURN-time view. The two legitimately differ — a self-buff granted on the focus's own turn
 * is live at its next turn-start but can be gone by that round's tail — so the fixture below
 * deliberately gives the two channels different names.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DPSBuffPanel } from '../DPSBuffPanel';
import type { RoundData } from '../../../utils/calculators/dpsSimulator';

const row = (over: Partial<RoundData>): RoundData => ({
    round: 1,
    action: 'active',
    charges: 0,
    chargeCount: 0,
    didCrit: false,
    enemyHpPct: 100,
    directDamage: 0,
    corrosionDamage: 0,
    infernoDamage: 0,
    detonationDamage: 0,
    totalRoundDamage: 0,
    cumulativeDamage: 0,
    activeCorrosionStacks: 0,
    activeInfernoStacks: 0,
    activeBombCount: 0,
    activeSelfBuffs: [],
    activeEnemyDebuffs: [],
    resistedEnemyDebuffs: [],
    appliedDoTs: [],
    dotsLanded: true,
    activeDoTStates: [],
    ...over,
});

const renderPanel = (roundData: RoundData | null) =>
    render(
        <DPSBuffPanel
            ships={[{ name: 'Ship 1', color: '#fff', totalDamage: 100, roundData }]}
            totalRounds={3}
            hoveredRound={1}
        />
    );

describe('DPSBuffPanel end-of-round chips', () => {
    it('lists the focus buffs still standing at the round tail', () => {
        renderPanel(row({ focusStatuses: { buffNames: ['Fortitude'], debuffNames: [] } }));

        expect(screen.getByText('End of Round')).toBeInTheDocument();
        expect(screen.getByText('Fortitude')).toBeInTheDocument();
    });

    it('lists enemy debuffs still standing, merged across the enemy roster without duplicates', () => {
        renderPanel(
            row({
                enemyStatuses: {
                    'enemy-1': { buffNames: [], debuffNames: ['Attack Down', 'Slow'] },
                    'enemy-2': { buffNames: [], debuffNames: ['Attack Down'] },
                },
            })
        );

        expect(screen.getAllByText('Attack Down')).toHaveLength(1);
        expect(screen.getByText('Slow')).toBeInTheDocument();
    });

    it('renders no End of Round section when the round carries no snapshot', () => {
        renderPanel(row({}));

        expect(screen.queryByText('End of Round')).not.toBeInTheDocument();
    });

    it('does not confuse the turn-time list with the round-tail list', () => {
        renderPanel(
            row({
                activeSelfBuffs: [{ buffName: 'Turn Time Only', stacks: 1, turnsRemaining: 3 }],
                focusStatuses: { buffNames: ['Round Tail Only'], debuffNames: [] },
            })
        );

        expect(screen.getByText('Turn Time Only')).toBeInTheDocument();
        expect(screen.getByText('Round Tail Only')).toBeInTheDocument();
    });
});

describe('DPSBuffPanel end-of-round chips — both directions', () => {
    it('lists debuffs the enemy put on YOU', () => {
        renderPanel(row({ focusStatuses: { buffNames: [], debuffNames: ['Attack Down'] } }));

        expect(screen.getByText('End of Round')).toBeInTheDocument();
        expect(screen.getByText('Attack Down')).toBeInTheDocument();
    });

    it('lists the enemy own buffs', () => {
        renderPanel(
            row({ enemyStatuses: { 'enemy-1': { buffNames: ['Shield Up'], debuffNames: [] } } })
        );

        expect(screen.getByText('Shield Up')).toBeInTheDocument();
    });
});
