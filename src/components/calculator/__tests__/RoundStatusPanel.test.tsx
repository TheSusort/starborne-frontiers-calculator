import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoundStatusPanel } from '../RoundStatusPanel';
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
    healTargetBuffs: [],
    enemyEffects: [],
    ...over,
});

// Round with TWO enemies. BOTH land 'Defense Down' on the target (with different turnsRemaining) so
// the Heal Target roll-up has a dedup case to prove; each enemy also has a distinct self-buff.
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
                debuffs: [{ buffName: 'Defense Down', turnsRemaining: 1, stacks: 1 }],
                dots: [],
            },
        ],
    });

const NAMES: Record<string, string> = { e1: 'Makoli', e2: 'Enemy 2' };
const enemyName = (id: string) => NAMES[id] ?? id;

describe('RoundStatusPanel', () => {
    it('shows the empty "hover a round" state when nothing is hovered', () => {
        render(
            <RoundStatusPanel
                configs={[{ name: 'Healer 1', roundData: null }]}
                totalRounds={20}
                hoveredRound={null}
                enemyName={enemyName}
            />
        );
        expect(screen.getByText('Hover a round')).toBeInTheDocument();
        expect(screen.getByText(/Hover a round to see buffs and effects/i)).toBeInTheDocument();
    });

    it('shows the hovered round number in the header ("Round X of Y")', () => {
        render(
            <RoundStatusPanel
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
            <RoundStatusPanel
                configs={[{ name: 'Healer 1', roundData: twoEnemyRound() }]}
                totalRounds={20}
                hoveredRound={3}
                enemyName={enemyName}
            />
        );
        expect(screen.getByText('Makoli')).toBeInTheDocument();
        expect(screen.getByText('Enemy 2')).toBeInTheDocument();
        // Each enemy's own self-buff is per-enemy only.
        expect(screen.getByText('Attack Up')).toBeInTheDocument();
        expect(screen.getByText('Crit Up')).toBeInTheDocument();
        // The shared debuff appears under both enemies plus once in the aggregated Heal Target
        // section (deduped), hence getAllByText.
        expect(screen.getAllByText('Defense Down').length).toBeGreaterThanOrEqual(1);
    });

    it('renders each enemy group with its own Self-Buffs and Debuffs sub-sections', () => {
        render(
            <RoundStatusPanel
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
            <RoundStatusPanel
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

    it('shows a "no buffs or effects" note for a config with neither healer buffs nor enemy effects', () => {
        render(
            <RoundStatusPanel
                configs={[
                    {
                        name: 'Healer 1',
                        roundData: row({ round: 5, activeSelfBuffs: [], enemyEffects: [] }),
                    },
                ]}
                totalRounds={20}
                hoveredRound={5}
                enemyName={enemyName}
            />
        );
        expect(screen.getByText(/no buffs or effects this round/i)).toBeInTheDocument();
    });

    it("renders the healer's own active buffs under a Buffs sub-section, above the enemy effects", () => {
        render(
            <RoundStatusPanel
                configs={[
                    {
                        name: 'Healer 1',
                        roundData: row({
                            round: 3,
                            activeSelfBuffs: [
                                { buffName: 'Defense Up II', turnsRemaining: 2 },
                                { buffName: 'Repair Over Time', turnsRemaining: 3, stacks: 1 },
                            ],
                            enemyEffects: [
                                {
                                    enemyId: 'e1',
                                    selfBuffs: [{ buffName: 'Attack Up', turnsRemaining: 2 }],
                                    debuffs: [],
                                    dots: [],
                                },
                            ],
                        }),
                    },
                ]}
                totalRounds={20}
                hoveredRound={3}
                enemyName={enemyName}
            />
        );
        // Healer's own buffs render under a "Buffs" sub-section.
        expect(screen.getByText('Buffs')).toBeInTheDocument();
        expect(screen.getByText('Defense Up II')).toBeInTheDocument();
        expect(screen.getByText('Repair Over Time')).toBeInTheDocument();
        // The enemy effects still render alongside (e1 resolves to "Makoli").
        expect(screen.getByText('Makoli')).toBeInTheDocument();
        expect(screen.getByText('Attack Up')).toBeInTheDocument();
    });

    it('does NOT mark a config as empty when it has healer buffs but no enemy effects', () => {
        render(
            <RoundStatusPanel
                configs={[
                    {
                        name: 'Healer 1',
                        roundData: row({
                            round: 4,
                            activeSelfBuffs: [{ buffName: 'Defense Up II', turnsRemaining: 2 }],
                            enemyEffects: [],
                        }),
                    },
                ]}
                totalRounds={20}
                hoveredRound={4}
                enemyName={enemyName}
            />
        );
        expect(screen.queryByText(/no buffs or effects this round/i)).not.toBeInTheDocument();
        expect(screen.getByText('Buffs')).toBeInTheDocument();
        expect(screen.getByText('Defense Up II')).toBeInTheDocument();
    });

    it('hides zero-stack healer buffs from the Buffs sub-section', () => {
        render(
            <RoundStatusPanel
                configs={[
                    {
                        name: 'Healer 1',
                        roundData: row({
                            round: 4,
                            activeSelfBuffs: [
                                { buffName: 'Spent Stack', turnsRemaining: 2, stacks: 0 },
                            ],
                            enemyEffects: [],
                        }),
                    },
                ]}
                totalRounds={20}
                hoveredRound={4}
                enemyName={enemyName}
            />
        );
        expect(screen.queryByText('Spent Stack')).not.toBeInTheDocument();
        // Nothing else this round → falls back to the empty note.
        expect(screen.getByText(/no buffs or effects this round/i)).toBeInTheDocument();
    });

    it("renders an enemy's active DoTs on the target with the DPS DoT label (×stacks)", () => {
        render(
            <RoundStatusPanel
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
        // The DoT label appears in the per-enemy group AND the aggregated Heal Target section.
        expect(screen.getAllByText('Inferno I ×3').length).toBeGreaterThanOrEqual(1);
    });

    it('renders DoTs alongside self-buffs and debuffs in the same enemy group', () => {
        render(
            <RoundStatusPanel
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
        // Debuffs/DoTs appear per-enemy AND in the aggregated Heal Target section.
        expect(screen.getAllByText('Defense Down').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('DoTs on Target')).toBeInTheDocument();
        // Single stack → no ×N suffix.
        expect(screen.getAllByText('Corrosion I').length).toBeGreaterThanOrEqual(1);
    });

    it('falls back to the raw enemy id when no name is resolved', () => {
        render(
            <RoundStatusPanel
                configs={[{ name: 'Healer 1', roundData: twoEnemyRound() }]}
                totalRounds={20}
                hoveredRound={3}
                enemyName={(id) => id}
            />
        );
        expect(screen.getByText('e1')).toBeInTheDocument();
        expect(screen.getByText('e2')).toBeInTheDocument();
    });

    it('renders a Heal Target section with the target name, its own buffs, and the aggregated debuffs/DoTs on it', () => {
        render(
            <RoundStatusPanel
                configs={[
                    {
                        name: 'Healer 1',
                        roundData: row({
                            round: 3,
                            healTargetBuffs: [
                                { buffName: 'Cheat Death', turnsRemaining: 'recurring' },
                                { buffName: 'Barrier', turnsRemaining: 2, stacks: 1 },
                            ],
                            enemyEffects: [
                                {
                                    enemyId: 'e1',
                                    selfBuffs: [{ buffName: 'Attack Up', turnsRemaining: 2 }],
                                    debuffs: [{ buffName: 'Defense Down', turnsRemaining: 3 }],
                                    dots: [{ type: 'inferno', tier: 15, stacks: 2 }],
                                },
                            ],
                        }),
                    },
                ]}
                totalRounds={20}
                hoveredRound={3}
                enemyName={enemyName}
                healTargetName="Aegis"
            />
        );
        // The Heal Target sub-header with the threaded name.
        expect(screen.getByText('Aegis')).toBeInTheDocument();
        // Its OWN buffs render (incl. recurring Cheat Death) — these are unique to the target.
        expect(screen.getByText('Cheat Death')).toBeInTheDocument();
        expect(screen.getByText('Barrier')).toBeInTheDocument();
        // The aggregated debuffs/DoTs on the target render under the Heal Target section
        // (also shown per-enemy, hence getAllByText — at least one of each is the Heal Target one).
        expect(screen.getAllByText('Defense Down').length).toBe(2);
        expect(screen.getAllByText('Inferno I ×2').length).toBe(2);
    });

    it('dedupes a debuff landed by two enemies to ONE row in the Heal Target section (kept per-enemy)', () => {
        render(
            <RoundStatusPanel
                configs={[{ name: 'Healer 1', roundData: twoEnemyRound() }]}
                totalRounds={20}
                hoveredRound={3}
                enemyName={enemyName}
                healTargetName="Aegis"
            />
        );
        // BOTH enemies land 'Defense Down': it appears under each enemy (2) plus exactly ONE merged
        // row in the Heal Target roll-up — 3 total, NOT 4 (which would mean the aggregate duplicated
        // it). The merge keeps the larger turnsRemaining (e1's 3, stacks 2).
        expect(screen.getAllByText('Defense Down').length).toBe(3);
    });

    it('merges same type+tier DoTs from two enemies into one summed-stack row in the Heal Target section', () => {
        render(
            <RoundStatusPanel
                configs={[
                    {
                        name: 'Healer 1',
                        roundData: row({
                            round: 3,
                            enemyEffects: [
                                {
                                    enemyId: 'e1',
                                    selfBuffs: [],
                                    debuffs: [],
                                    dots: [{ type: 'inferno', tier: 15, stacks: 2 }],
                                },
                                {
                                    enemyId: 'e2',
                                    selfBuffs: [],
                                    debuffs: [],
                                    dots: [{ type: 'inferno', tier: 15, stacks: 3 }],
                                },
                            ],
                        }),
                    },
                ]}
                totalRounds={20}
                hoveredRound={3}
                enemyName={enemyName}
                healTargetName="Aegis"
            />
        );
        // Per-enemy rows keep their own attribution (2 and 3 stacks).
        expect(screen.getByText('Inferno I ×2')).toBeInTheDocument();
        expect(screen.getByText('Inferno I ×3')).toBeInTheDocument();
        // The Heal Target roll-up merges them into a single summed row (2 + 3 = 5 stacks).
        expect(screen.getByText('Inferno I ×5')).toBeInTheDocument();
    });

    it('hides zero-stack heal-target buffs and omits the section when the target has nothing', () => {
        render(
            <RoundStatusPanel
                configs={[
                    {
                        name: 'Healer 1',
                        roundData: row({
                            round: 4,
                            healTargetBuffs: [
                                { buffName: 'Spent Target Stack', turnsRemaining: 2, stacks: 0 },
                            ],
                            enemyEffects: [],
                        }),
                    },
                ]}
                totalRounds={20}
                hoveredRound={4}
                enemyName={enemyName}
                healTargetName="Aegis"
            />
        );
        expect(screen.queryByText('Spent Target Stack')).not.toBeInTheDocument();
        // No buffs + no debuffs/dots on target → the Heal Target sub-header does not render.
        expect(screen.queryByText('Aegis')).not.toBeInTheDocument();
    });
});
