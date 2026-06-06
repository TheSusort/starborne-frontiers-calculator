import { describe, expect, it } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../dpsSimulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { SelectedGameBuff } from '../../../types/calculator';

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

const snap = (name: string, mkInput: () => DPSSimulationInput) =>
    it(name, () => {
        idCounter = 0;
        expect(simulateDPS(mkInput())).toMatchSnapshot();
    });

describe('dpsGoldenParity', () => {
    // Scenario 1: plain damage — no charged skill, simple active-only
    snap('plain damage', () => ({
        ...BASE,
        chargeCount: 0,
        shipSkills: damageSkills(150),
    }));

    // Scenario 2: charged cadence + startCharged
    snap('charged cadence + startCharged', () => ({
        ...BASE,
        startCharged: true,
        shipSkills: damageSkills(120, 300),
    }));

    // Scenario 3: multi-hit noCrit
    snap('multi-hit noCrit', () => ({
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
    }));

    // Scenario 4: dots all types
    snap('dots all types', () => ({
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
    }));

    // Scenario 5: extend-dot passive with crit-power chance
    snap('extend-dot passive with crit-power chance', () => ({
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
    }));

    // Scenario 6: detonate + reapply
    snap('detonate + reapply', () => ({
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
    }));

    // Scenario 7: accumulate-detonate
    snap('accumulate-detonate', () => ({
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
    }));

    // Scenario 8: charge gain + enemy-type condition
    // 'Defender' is a valid EnemyBaseClass member (see src/types/calculator.ts line 33)
    snap('charge gain + enemy-type condition', () => ({
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
    }));

    // Scenario 9: modifiers flat + scaling + hp-threshold
    snap('modifiers flat + scaling + hp-threshold', () => ({
        ...BASE,
        enemyHp: 100000,
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
                        // attack modifier gated on hp-threshold (enemy below 50%)
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
                                },
                            ],
                        }),
                    ],
                },
            ],
        },
    }));

    // Scenario 10: ability buffs/debuffs unconditioned
    // Mirrors the post-Task-6 page wiring: the sim reads buff/debuff abilities from
    // shipSkills directly (no converted spread into selfBuffs/enemyDebuffs).
    snap('ability buffs/debuffs unconditioned', () => {
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
        return {
            ...BASE,
            shipSkills,
        };
    });

    // Scenario 11: manual + team buffs with static defPen/dot path
    snap('manual + team buffs with static defPen/dot path', () => ({
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
    }));

    // Scenario 12: affinity disadvantage + apply debuff
    snap('affinity disadvantage + apply debuff', () => {
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
        return {
            ...BASE,
            affinityDamageModifier: -25,
            affinityCritCap: 75,
            affinityCritPenalty: 25,
            shipSkills,
        };
    });

    // Scenario 13: judge passive gated damage
    snap('judge passive gated damage', () => ({
        ...BASE,
        enemyHp: 80000,
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
    }));

    // Scenario 15: ability buff feeds modifier gate (coupling lock)
    // A timed self-buff (Overdrive, +20% attack) is applied by the active skill each round.
    // A passive modifier (+25% outgoingDamage) is gated on the self-buff 'Overdrive' being active.
    // Round-1 verification: base no-buff directDamage = 7410 (multiplier 150, BASE stats).
    // With Overdrive (+20% attack): effectiveAttack = 15000 × 1.20 = 18000
    // With outgoingDamage modifier (+25%): damage × 1.25
    // Expected round-1 directDamage ≈ 7410 × 1.20 × 1.25 ≈ 11115 (non-crit)
    snap('ability buff feeds modifier gate (coupling lock)', () => {
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Overdrive',
                                parsedEffects: { attack: 20 },
                                stacks: 1,
                                isStackable: false,
                                duration: 2,
                            },
                        }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'modifier',
                            conditions: [
                                {
                                    subject: 'self-buff',
                                    derivable: true,
                                    buffName: 'Overdrive',
                                },
                            ],
                            config: {
                                type: 'modifier',
                                channel: 'outgoingDamage',
                                value: 25,
                                isMultiplicative: false,
                            },
                        }),
                    ],
                },
            ],
        };
        return {
            ...BASE,
            chargeCount: 0,
            shipSkills,
        };
    });

    // Scenario 14: KNOWN-DIFF conditional buff — captured pre-gating, updated by the
    // dynamic-gating task (plan Task 6; the snap title's "Task 7" is the historical
    // pre-renumbering name, kept verbatim because it is the snapshot key).
    // Active self-buff gated on enemy-debuff ≥ 2; active also applies corrosion each round.
    // Statically the gate neutralized the threshold → buff always on. With dynamic
    // gating, the buff switches on only when the live debuff count reaches 2
    // (count is 0 entering round 1, 1 entering round 2, 2 entering round 3 → flip ON at round 3).
    snap('KNOWN-DIFF conditional buff (updates in Task 7)', () => {
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                        // Self-buff conditionally gated on enemy having ≥2 debuffs
                        ab({
                            type: 'buff',
                            target: 'self',
                            conditions: [
                                {
                                    subject: 'enemy-debuff',
                                    derivable: true,
                                    countComparator: 'gte',
                                    countThreshold: 2,
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
                        // Corrosion applied each active round — debuff count ramps 0→2+ as entries accumulate
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
        return {
            ...BASE,
            chargeCount: 0,
            shipSkills,
        };
    });

    // Scenario 16: passive charge aura — a charge ability on the passive slot
    // accelerates the charged cadence on active rounds (Hermes/Cobalt pattern).
    // Locks the firing+passive charge sourcing shipped in the follow-ups PR.
    // Cadence: r1 active → charges 2 (1 cadence + 1 aura), r2 active → 3 (cap),
    // r3 charged → 0; repeats every 3 rounds (charged on r3/r6/r9/r12, was r4/r8/r12).
    snap('passive charge aura accelerates charged cadence', () => ({
        ...BASE,
        shipSkills: damageSkills(150, 320, {
            slots: [
                {
                    slot: 'passive' as const,
                    abilities: [
                        ab({
                            type: 'charge',
                            target: 'self',
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
            ],
        }),
    }));

    // Scenario 18: reactive triggers — on-debuff-inflicted charge + on-crit-inflicted debuff.
    // Active slot: damage + timed enemy debuff (inflict, duration 2) applied every cast.
    // Charged slot: damage (multiplier 300) — provides hasChargedSkill=true so reactively-
    //   gained charges are actually spent on real charged rounds.
    // Passive slot: charge {trigger:'on-debuff-inflicted'} gains +1 every debuff-applied event
    //   from the attacker; timed enemy debuff {trigger:'on-crit', defense:-30, duration 2}
    //   lands the round a crit occurs (and also emits debuff-applied → additional +1 charge).
    // chargeCount:3; BASE hacking/security → 100% landing chance; 10 rounds.
    // Charge accumulation trace (preTurn banking + reactive drains, capped at chargeCount=3):
    //   Active non-crit: preTurn +1 banking + reactive +1 (Sensor Down inflict) = +2 net.
    //   Active crit: preTurn +1 + reactive +1 (Sensor Down) + chained +1 (Armor Breach) = capped 3.
    //   Charged round: charges reset to 0 at preTurn; the damage-only charged slot inflicts no
    //     debuff, BUT a charged-stream crit chains on-crit → Armor Breach → +1 reactive charge.
    // Hand-verified round sequence (charges/didCrit shown as snapshotted, i.e. end of round):
    //   r1 active(nc):   0+1 bank, +1 Sensor Down → charges=2.
    //   r2 active(CRIT): 2+1=3 cap; Sensor Down + Armor Breach gains capped → charges=3.
    //   r3 charged(nc):  3>=3 fires, reset 0; no inflictions → charges=0.
    //   r4 active(nc):   +1 bank +1 Sensor Down → charges=2.
    //   r5 active(CRIT): 2+1=3 cap → charges=3.
    //   r6 charged(CRIT): reset 0; chargedCritGate fires → Armor Breach chained → charges=1.
    //   r7 active(nc):   1+1 bank +1 Sensor Down → charges=3.
    //   r8 charged(nc):  3>=3 fires, reset 0 → charges=0.
    //   r9 active(CRIT): 0+1 bank +1 Sensor Down +1 Armor Breach → charges=3.
    //   r10 charged(CRIT): reset 0; chargedCrit fires → Armor Breach chained → charges=1.
    // Charged rounds: r3, r6, r8, r10 (4 in the 10-round window — cadence locked).
    // Crit rounds: r2/r5/r9 (active stream, 50% accumulator over active rounds) and r6/r10
    //   (charged stream — the two action streams draw from SEPARATE crit accumulators).
    // Armor Breach (duration 2, applied at the post-turn drain of each crit round, enemy
    //   post-turn decrements same round) is visible with turnsRemaining=1 the FOLLOWING
    //   round: r3 (from r2), r6 (from r5), r7 (from r6), r10 (from r9).
    snap('reactive triggers (charge on inflict + crit-inflicted debuff)', () => {
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                        ab({
                            type: 'debuff',
                            target: 'enemy',
                            config: {
                                type: 'debuff',
                                buffName: 'Sensor Down',
                                parsedEffects: { defense: -20 },
                                stacks: 1,
                                isStackable: false,
                                application: 'inflict',
                                duration: 2,
                            },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 300 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-debuff-inflicted',
                            config: { type: 'charge', amount: 1 },
                        }),
                        ab({
                            type: 'debuff',
                            target: 'enemy',
                            trigger: 'on-crit',
                            config: {
                                type: 'debuff',
                                buffName: 'Armor Breach',
                                parsedEffects: { defense: -30 },
                                stacks: 1,
                                isStackable: false,
                                application: 'inflict',
                                duration: 2,
                            },
                        }),
                    ],
                },
            ],
        };
        return {
            ...BASE,
            rounds: 10,
            shipSkills,
        };
    });

    // Scenario 17: team actor with real turns — fast support (speed 140) applies an
    // active-slot 2-turn attack buff on each of its turns; a charge-slot defense-down
    // debuff on its chargeCount-2 startCharged cadence (charged turns 1/4/7/10); enemy
    // speed 50 (default). Locks the multi-actor round shape (team buffs re-timed onto
    // real team turns). Round-1 trace: startCharged → the team's round-1 turn is CHARGED,
    // so the CHARGE-slot debuff ('Team Defense Down') lands round 1; the ACTIVE-slot buff
    // ('Team Attack Up') does NOT fire round 1 (no active turn) — it first applies round 2.
    // Round-2 trace: team banks (charges 1), fires ACTIVE → 'Team Attack Up' applies; the
    // round-1 charge debuff is still in its 2-turn window. (debuff lands every round it is
    // attempted: hacking 250 vs security 100 → landing chance clamps to 1.0.)
    snap('team actor re-timed buffs (multi-actor rounds)', () => ({
        ...BASE,
        teamActors: [
            {
                id: 'support-1',
                speed: 140,
                chargeCount: 2,
                startCharged: true,
                selfBuffs: [
                    buff({
                        id: 'ta1',
                        buffName: 'Team Attack Up',
                        parsedEffects: { attack: 20 },
                        skillSource: 'active',
                        skillDuration: 2,
                    }),
                ],
                enemyDebuffs: [
                    buff({
                        id: 'td1',
                        buffName: 'Team Defense Down',
                        parsedEffects: { defense: -15 },
                        skillSource: 'charge',
                        skillDuration: 2,
                    }),
                ],
            },
        ],
        shipSkills: damageSkills(150, 320),
    }));

    // Scenario 19: walked team actor (full team-skills walk).
    // An attacker (active + charged damage, chargeCount 3) + ONE WALKED team actor whose
    // hand-built shipSkills exercise the whole walk: an all-allies timed buff (lands on the
    // attacker AND the team itself), an enemy timed debuff (inflict), an inferno DoT, a
    // damage ability (populates teamDamage), an on-debuff-inflicted reactive charge ability,
    // and a charged-slot all-allies Crit Power Up buff. Non-default speeds: team 130 acts
    // before the attacker (100); enemy 50. Team affinity 'thermal' vs enemyAffinity 'chemical'
    // → ADVANTAGE (per-actor affinity derivation: +25% team damage, crit cap 100).
    //
    // Reactive charge cadence (team chargeCount 2): on each ACTIVE turn the team banks +1 and
    // emits two infliction events — the timed Defense Down (debuff-applied) and the inferno
    // (dot-applied) — each firing the on-debuff-inflicted listener for +1, so +2 reactive +
    // +1 bank = +3, capped at chargeCount 2 → the team reaches charged on its turn 2 (round 2).
    // A charged turn resets charges to 0; the charged slot inflicts no debuff/DoT, so it banks
    // only the +1 the next active turn (plus reactive on the active turns). Expect charged team
    // turns on rounds 2, 4, 6, 8, 10 — and Crit Power Up (duration 1) on the attacker exactly
    // those rounds. The snapshot self-writes; verified round-by-round in the task report.
    snap('walked team actor (full team-skills walk)', () => {
        const teamSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        // all-allies timed buff → attacker + team itself.
                        ab({
                            type: 'buff',
                            target: 'all-allies',
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up',
                                parsedEffects: { attack: 20 },
                                stacks: 1,
                                isStackable: false,
                                duration: 2,
                            },
                        }),
                        // enemy timed debuff (inflict).
                        ab({
                            type: 'debuff',
                            target: 'enemy',
                            config: {
                                type: 'debuff',
                                buffName: 'Defense Down',
                                parsedEffects: { defense: -15 },
                                stacks: 1,
                                isStackable: false,
                                application: 'inflict',
                                duration: 2,
                            },
                        }),
                        // inferno DoT.
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'inferno',
                                tier: 15,
                                stacks: 2,
                                duration: 3,
                            },
                        }),
                        // damage ability → teamDamage non-zero.
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        // reactive: +1 charge on each debuff/DoT infliction this actor lands.
                        ab({
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-debuff-inflicted',
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        // charged-slot all-allies buff → Crit Power Up on the attacker the
                        // rounds the team fires charged (duration 1).
                        ab({
                            type: 'buff',
                            target: 'all-allies',
                            config: {
                                type: 'buff',
                                buffName: 'Crit Power Up',
                                parsedEffects: { critDamage: 30 },
                                stacks: 1,
                                isStackable: false,
                                duration: 1,
                            },
                        }),
                    ],
                },
            ],
        };
        return {
            ...BASE,
            rounds: 10,
            speed: 100,
            enemySpeed: 50,
            enemyAffinity: 'chemical',
            // Attacker: active + charged damage, chargeCount 3.
            shipSkills: damageSkills(150, 300),
            teamActors: [
                {
                    id: 'team-1',
                    speed: 130, // acts before the attacker (100)
                    chargeCount: 2,
                    startCharged: false,
                    selfBuffs: [],
                    enemyDebuffs: [],
                    shipSkills: teamSkills,
                    stats: {
                        attack: 12000,
                        crit: 25,
                        critDamage: 140,
                        defensePenetration: 0,
                        hacking: 220,
                        defence: 0,
                        hp: 0,
                    },
                    affinity: 'thermal',
                },
            ],
        };
    });

    // Scenario 20: per-hit crits — 3-hit active at 50% crit with an on-crit-charged
    // debuff follow-up. Locks the per-hit draw schedule, the blended crit multiplier,
    // and per-critting-hit trigger frequency. Added with the per-hit-crit increment
    // (2026-06-06); hand-verified.
    snap('per-hit crits (multi-hit + on-crit follow-up)', () => ({
        ...BASE,
        chargeCount: 4,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            config: { type: 'damage', multiplier: 90, hits: 3 },
                        }),
                        ab({
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-crit',
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } }),
                    ],
                },
            ],
        },
    }));
});
