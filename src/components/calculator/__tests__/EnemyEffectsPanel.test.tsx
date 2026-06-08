import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EnemyEffectsPanel } from '../EnemyEffectsPanel';
import { HealingRoundData } from '../../../utils/calculators/healingEngineAdapter';

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

// Round with TWO enemies, each producing distinct self-buffs and debuffs on the target.
const twoEnemyRound = (): HealingRoundData =>
    row({
        round: 3,
        enemyEffects: [
            {
                enemyId: 'e1',
                selfBuffs: [{ buffName: 'Attack Up', turnsRemaining: 2 }],
                debuffs: [{ buffName: 'Defense Down', turnsRemaining: 3, stacks: 2 }],
                dots: [],
            },
            {
                enemyId: 'e2',
                selfBuffs: [{ buffName: 'Crit Up', turnsRemaining: 1 }],
                debuffs: [{ buffName: 'Corrosion', turnsRemaining: 2 }],
                dots: [],
            },
        ],
    });

const NAMES: Record<string, string> = { e1: 'Makoli', e2: 'Enemy 2' };
const enemyName = (id: string) => NAMES[id] ?? id;

describe('EnemyEffectsPanel', () => {
    it('shows the empty "hover a round" state when nothing is hovered', () => {
        render(
            <EnemyEffectsPanel
                configs={[{ name: 'Healer 1', roundData: null }]}
                totalRounds={20}
                hoveredRound={null}
                enemyName={enemyName}
            />
        );
        expect(screen.getByText('Hover a round')).toBeInTheDocument();
        expect(screen.getByText(/Hover a round to see enemy effects/i)).toBeInTheDocument();
    });

    it('shows the hovered round number in the header ("Round X of Y")', () => {
        render(
            <EnemyEffectsPanel
                configs={[{ name: 'Healer 1', roundData: twoEnemyRound() }]}
                totalRounds={20}
                hoveredRound={3}
                enemyName={enemyName}
            />
        );
        expect(screen.getByText('Round 3 of 20')).toBeInTheDocument();
    });

    it('groups the hovered round effects by the source enemy, labelled with its resolved name', () => {
        render(
            <EnemyEffectsPanel
                configs={[{ name: 'Healer 1', roundData: twoEnemyRound() }]}
                totalRounds={20}
                hoveredRound={3}
                enemyName={enemyName}
            />
        );
        expect(screen.getByText('Makoli')).toBeInTheDocument();
        expect(screen.getByText('Enemy 2')).toBeInTheDocument();
        // First enemy's own effects.
        expect(screen.getByText('Attack Up')).toBeInTheDocument();
        expect(screen.getByText('Defense Down')).toBeInTheDocument();
        // Second enemy's own effects, attributed separately.
        expect(screen.getByText('Crit Up')).toBeInTheDocument();
        expect(screen.getByText('Corrosion')).toBeInTheDocument();
    });

    it('renders each enemy group with its own Self-Buffs and Debuffs sub-sections', () => {
        render(
            <EnemyEffectsPanel
                configs={[{ name: 'Healer 1', roundData: twoEnemyRound() }]}
                totalRounds={20}
                hoveredRound={3}
                enemyName={enemyName}
            />
        );
        expect(screen.getAllByText('Self-Buffs').length).toBe(2);
        expect(screen.getAllByText('Debuffs on Target').length).toBe(2);
    });

    it('renders a section per healer config, each with the config name and its own enemy effects', () => {
        render(
            <EnemyEffectsPanel
                configs={[
                    { name: 'Healer A', color: '#111', roundData: twoEnemyRound() },
                    {
                        name: 'Healer B',
                        color: '#222',
                        roundData: row({
                            round: 3,
                            enemyEffects: [
                                {
                                    enemyId: 'e3',
                                    selfBuffs: [{ buffName: 'Speed Up', turnsRemaining: 2 }],
                                    debuffs: [],
                                    dots: [],
                                },
                            ],
                        }),
                    },
                ]}
                totalRounds={20}
                hoveredRound={3}
                enemyName={(id) => ({ ...NAMES, e3: 'Drone' })[id] ?? id}
            />
        );
        // Both config headers render.
        expect(screen.getByText('Healer A')).toBeInTheDocument();
        expect(screen.getByText('Healer B')).toBeInTheDocument();
        // Config A's enemies + Config B's distinct enemy all appear.
        expect(screen.getByText('Makoli')).toBeInTheDocument();
        expect(screen.getByText('Drone')).toBeInTheDocument();
        expect(screen.getByText('Speed Up')).toBeInTheDocument();
    });

    it('shows a "no enemy effects" note for a config with no enemy effects this round', () => {
        render(
            <EnemyEffectsPanel
                configs={[{ name: 'Healer 1', roundData: row({ round: 5, enemyEffects: [] }) }]}
                totalRounds={20}
                hoveredRound={5}
                enemyName={enemyName}
            />
        );
        expect(screen.getByText(/no enemy effects this round/i)).toBeInTheDocument();
    });

    it("renders an enemy's active DoTs on the target with the DPS DoT label (×stacks)", () => {
        render(
            <EnemyEffectsPanel
                configs={[
                    {
                        name: 'Healer 1',
                        roundData: row({
                            round: 4,
                            enemyEffects: [
                                {
                                    enemyId: 'e1',
                                    selfBuffs: [],
                                    debuffs: [],
                                    dots: [{ type: 'inferno', tier: 15, stacks: 3 }],
                                },
                            ],
                        }),
                    },
                ]}
                totalRounds={20}
                hoveredRound={4}
                enemyName={enemyName}
            />
        );
        // DoT-only enemy still surfaces, with its DoTs-on-Target sub-section + the labelled stack.
        expect(screen.getByText('Makoli')).toBeInTheDocument();
        expect(screen.getByText('DoTs on Target')).toBeInTheDocument();
        expect(screen.getByText('Inferno I ×3')).toBeInTheDocument();
    });

    it('renders DoTs alongside self-buffs and debuffs in the same enemy group', () => {
        render(
            <EnemyEffectsPanel
                configs={[
                    {
                        name: 'Healer 1',
                        roundData: row({
                            round: 4,
                            enemyEffects: [
                                {
                                    enemyId: 'e1',
                                    selfBuffs: [{ buffName: 'Attack Up', turnsRemaining: 2 }],
                                    debuffs: [{ buffName: 'Defense Down', turnsRemaining: 2 }],
                                    dots: [{ type: 'corrosion', tier: 3, stacks: 1 }],
                                },
                            ],
                        }),
                    },
                ]}
                totalRounds={20}
                hoveredRound={4}
                enemyName={enemyName}
            />
        );
        expect(screen.getByText('Attack Up')).toBeInTheDocument();
        expect(screen.getByText('Defense Down')).toBeInTheDocument();
        expect(screen.getByText('DoTs on Target')).toBeInTheDocument();
        // Single stack → no ×N suffix.
        expect(screen.getByText('Corrosion I')).toBeInTheDocument();
    });

    it('falls back to the raw enemy id when no name is resolved', () => {
        render(
            <EnemyEffectsPanel
                configs={[{ name: 'Healer 1', roundData: twoEnemyRound() }]}
                totalRounds={20}
                hoveredRound={3}
                enemyName={(id) => id}
            />
        );
        expect(screen.getByText('e1')).toBeInTheDocument();
        expect(screen.getByText('e2')).toBeInTheDocument();
    });
});
