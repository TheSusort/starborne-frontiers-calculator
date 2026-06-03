import { describe, expect, it } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../dpsSimulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { SelectedGameBuff } from '../../../types/calculator';
import { configShipSkillsToSimInputs } from '../../abilities/configToSimInputs';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `g${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const damageSkills = (
    activeMult: number,
    chargedMult?: number,
    extra?: Partial<ShipSkills>
): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: activeMult } })],
        },
        ...(chargedMult
            ? [
                  {
                      slot: 'charged' as const,
                      abilities: [
                          ab({
                              type: 'damage',
                              config: { type: 'damage', multiplier: chargedMult },
                          }),
                      ],
                  },
              ]
            : []),
        ...(extra?.slots ?? []),
    ],
});

const buff = (
    partial: Partial<SelectedGameBuff> & Pick<SelectedGameBuff, 'id' | 'buffName' | 'parsedEffects'>
): SelectedGameBuff => ({
    stacks: 1,
    isStackable: false,
    ...partial,
});

const BASE: DPSSimulationInput = {
    attack: 15000,
    crit: 50,
    critDamage: 150,
    defensePenetration: 10,
    chargeCount: 3,
    enemyDefense: 8000,
    enemyHp: 400000,
    rounds: 12,
    selfBuffs: [],
    enemyDebuffs: [],
    hacking: 250,
    enemySecurity: 100,
    defence: 6000,
    hp: 30000,
};

const snap = (name: string, input: DPSSimulationInput) =>
    it(name, () => expect(simulateDPS(input)).toMatchSnapshot());

describe('dpsGoldenParity', () => {
    // Scenario 1: plain damage — no charged skill, simple active-only
    snap('plain damage', {
        ...BASE,
        chargeCount: 0,
        shipSkills: damageSkills(150),
    });

    // Scenario 2: charged cadence + startCharged
    snap('charged cadence + startCharged', {
        ...BASE,
        startCharged: true,
        shipSkills: damageSkills(120, 300),
    });

    // Scenario 3: multi-hit noCrit
    snap('multi-hit noCrit', {
        ...BASE,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            config: { type: 'damage', multiplier: 80, hits: 3, noCrit: true },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 300 } }),
                    ],
                },
            ],
        },
    });

    // Scenario 4: dots all types
    snap('dots all types', {
        ...BASE,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'corrosion',
                                tier: 5,
                                stacks: 2,
                                duration: 3,
                            },
                        }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'bomb',
                                tier: 120,
                                stacks: 1,
                                duration: 2,
                            },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'inferno',
                                tier: 8,
                                stacks: 3,
                                duration: 2,
                            },
                        }),
                    ],
                },
            ],
        },
    });

    // Scenario 5: extend-dot passive with crit-power chance
    snap('extend-dot passive with crit-power chance', {
        ...BASE,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'corrosion',
                                tier: 5,
                                stacks: 2,
                                duration: 3,
                            },
                        }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'bomb',
                                tier: 120,
                                stacks: 1,
                                duration: 2,
                            },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'inferno',
                                tier: 8,
                                stacks: 3,
                                duration: 2,
                            },
                        }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'extend-dot',
                            config: { type: 'extend-dot', turns: 1, chanceFromCritPower: true },
                        }),
                    ],
                },
            ],
        },
    });

    // Scenario 6: detonate + reapply
    snap('detonate + reapply', {
        ...BASE,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'inferno',
                                tier: 8,
                                stacks: 2,
                                duration: 3,
                            },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 200 } }),
                        ab({
                            type: 'detonate-dot',
                            config: { type: 'detonate-dot', dotType: 'inferno', powerPct: 150 },
                        }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'inferno',
                                tier: 8,
                                stacks: 2,
                                duration: 3,
                            },
                        }),
                    ],
                },
            ],
        },
    });

    // Scenario 7: accumulate-detonate
    snap('accumulate-detonate', {
        ...BASE,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                        ab({
                            type: 'accumulate-detonate',
                            config: { type: 'accumulate-detonate', turns: 2, pct: 50 },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 300 } }),
                    ],
                },
            ],
        },
    });

    // Scenario 8: charge gain + enemy-type condition
    // 'Defender' is a valid EnemyBaseClass member (see src/types/calculator.ts line 33)
    snap('charge gain + enemy-type condition', {
        ...BASE,
        enemyType: 'Defender',
        allyChargePerRound: 0.5,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                        ab({
                            type: 'charge',
                            config: { type: 'charge', amount: 1 },
                            conditions: [
                                {
                                    subject: 'enemy-type',
                                    derivable: true,
                                    requiredEnemyType: 'Defender',
                                },
                            ],
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 320 } }),
                    ],
                },
            ],
        },
    });

    // Scenario 9: modifiers flat + scaling + hp-threshold
    snap('modifiers flat + scaling + hp-threshold', {
        ...BASE,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'corrosion',
                                tier: 5,
                                stacks: 1,
                                duration: 3,
                            },
                        }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        // flat outgoingDamage modifier
                        ab({
                            type: 'modifier',
                            config: {
                                type: 'modifier',
                                channel: 'outgoingDamage',
                                value: 15,
                                isMultiplicative: false,
                            },
                        }),
                        // scaling defensePenetration modifier gated on enemy-debuff
                        ab({
                            type: 'modifier',
                            config: {
                                type: 'modifier',
                                channel: 'defensePenetration',
                                value: 0,
                                isMultiplicative: false,
                            },
                            conditions: [{ subject: 'enemy-debuff', derivable: true }],
                            scaling: { conditionIndex: 0, perUnit: 7.5, cap: 45 },
                        }),
                        // attack modifier gated on hp-threshold (self below 50%)
                        ab({
                            type: 'modifier',
                            config: {
                                type: 'modifier',
                                channel: 'attack',
                                value: 20,
                                isMultiplicative: false,
                            },
                            conditions: [
                                {
                                    subject: 'hp-threshold',
                                    derivable: true,
                                    hpComparator: 'below',
                                    hpPercent: 50,
                                    hpSubject: 'self',
                                },
                            ],
                        }),
                    ],
                },
            ],
        },
    });

    // Scenario 10: ability buffs/debuffs unconditioned
    // Mirrors page wiring: pass through configShipSkillsToSimInputs and spread into selfBuffs/enemyDebuffs
    (() => {
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                        // buff ability targeting self
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up',
                                parsedEffects: { attack: 30 },
                                stacks: 1,
                                isStackable: false,
                                duration: 2,
                            },
                        }),
                        // accumulating self-buff
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Momentum',
                                parsedEffects: { critDamage: 10 },
                                stacks: 1,
                                isStackable: true,
                                maxStacks: 5,
                                stackTrigger: 'per-active',
                                duration: 'recurring',
                            },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 300 } }),
                        // enemy debuff ability
                        ab({
                            type: 'debuff',
                            target: 'enemy',
                            config: {
                                type: 'debuff',
                                buffName: 'Defense Down II',
                                parsedEffects: { defense: -30 },
                                stacks: 1,
                                isStackable: false,
                                application: 'inflict',
                                duration: 2,
                            },
                        }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        // passive self-buff with recurring duration
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Focus',
                                parsedEffects: { crit: 15 },
                                stacks: 1,
                                isStackable: false,
                                duration: 'recurring',
                            },
                        }),
                    ],
                },
            ],
        };
        const converted = configShipSkillsToSimInputs(shipSkills);
        snap('ability buffs/debuffs unconditioned', {
            ...BASE,
            shipSkills,
            selfBuffs: [...BASE.selfBuffs, ...converted.selfBuffs],
            enemyDebuffs: [...BASE.enemyDebuffs, ...converted.enemyDebuffs],
        });
    })();

    // Scenario 11: manual + team buffs with static defPen/dot path
    snap('manual + team buffs with static defPen/dot path', {
        ...BASE,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'corrosion',
                                tier: 5,
                                stacks: 2,
                                duration: 3,
                            },
                        }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'bomb',
                                tier: 120,
                                stacks: 1,
                                duration: 2,
                            },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'inferno',
                                tier: 8,
                                stacks: 3,
                                duration: 2,
                            },
                        }),
                    ],
                },
            ],
        },
        selfBuffs: [
            // always-active (no skillSource): contributes static defPen + dotDamage
            buff({
                id: 'm1',
                buffName: 'Pen Up',
                parsedEffects: { defensePenetration: 20, dotDamage: 15 },
            }),
            // timed buff active for 2 rounds from active skill
            buff({
                id: 'm2',
                buffName: 'Attack Up',
                parsedEffects: { attack: 25 },
                skillSource: 'active',
                skillDuration: 2,
            }),
        ],
        enemyDebuffs: [
            // team debuff on charge schedule from another ship with sourceChargeCount=4, startCharged
            buff({
                id: 't1',
                buffName: 'Vulnerable',
                parsedEffects: { incomingDamage: 20 },
                skillSource: 'charge',
                skillDuration: 2,
                sourceChargeCount: 4,
                sourceStartCharged: true,
            }),
        ],
    });

    // Scenario 12: affinity disadvantage + apply debuff
    (() => {
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 300 } }),
                        // apply debuff — guaranteed but resisted on affinity disadvantage
                        ab({
                            type: 'debuff',
                            target: 'enemy',
                            config: {
                                type: 'debuff',
                                buffName: 'Armor Break',
                                parsedEffects: { defense: -20 },
                                stacks: 1,
                                isStackable: false,
                                application: 'apply',
                                duration: 2,
                            },
                        }),
                    ],
                },
            ],
        };
        const converted = configShipSkillsToSimInputs(shipSkills);
        snap('affinity disadvantage + apply debuff', {
            ...BASE,
            affinityDamageModifier: -25,
            affinityCritCap: 75,
            affinityCritPenalty: 25,
            shipSkills,
            selfBuffs: [...BASE.selfBuffs, ...converted.selfBuffs],
            enemyDebuffs: [...BASE.enemyDebuffs, ...converted.enemyDebuffs],
        });
    })();

    // Scenario 13: judge passive gated damage
    snap('judge passive gated damage', {
        ...BASE,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'damage',
                            config: { type: 'damage', multiplier: 60 },
                            conditions: [
                                {
                                    subject: 'hp-threshold',
                                    derivable: true,
                                    hpComparator: 'below',
                                    hpPercent: 50,
                                },
                            ],
                        }),
                    ],
                },
            ],
        },
    });

    // Scenario 14: KNOWN-DIFF conditional buff (updates in Task 7)
    // Active self-buff gated on enemy-debuff ≥ 3; active also applies corrosion each round.
    // Today the static gate neutralizes the threshold → buff always on.
    // After Task 7, the buff switches on only when live debuff count reaches 3.
    (() => {
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                        // Self-buff conditionally gated on enemy having ≥3 debuffs
                        ab({
                            type: 'buff',
                            target: 'self',
                            conditions: [
                                {
                                    subject: 'enemy-debuff',
                                    derivable: true,
                                    countComparator: 'gte',
                                    countThreshold: 3,
                                },
                            ],
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up',
                                parsedEffects: { attack: 30 },
                                stacks: 1,
                                isStackable: false,
                                duration: 2,
                            },
                        }),
                        // Corrosion applied each active round — debuff count ramps 0→3+ as entries accumulate
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'corrosion',
                                tier: 5,
                                stacks: 1,
                                duration: 3,
                            },
                        }),
                    ],
                },
            ],
        };
        const converted = configShipSkillsToSimInputs(shipSkills);
        snap('KNOWN-DIFF conditional buff (updates in Task 7)', {
            ...BASE,
            chargeCount: 0,
            shipSkills,
            selfBuffs: [...BASE.selfBuffs, ...converted.selfBuffs],
            enemyDebuffs: [...BASE.enemyDebuffs, ...converted.enemyDebuffs],
        });
    })();
});
