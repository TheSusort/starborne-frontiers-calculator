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
    // Passive slot: charge {trigger:'on-debuff-inflicted'} gains +1 every debuff-applied event
    //   from the attacker; timed enemy debuff {trigger:'on-crit', defense:-30, duration 2}
    //   lands the round a crit occurs (and also emits debuff-applied → additional +1 charge).
    // No charged slot — hasChargedSkill=false; charges accumulate on attacker.charges (cap=3)
    // from reactive triggers only (no preTurn banking). All rounds are active.
    // crit:50 → deterministic accumulator fires on every 2nd active round (rounds 2,4,6,8,10);
    // BASE hacking/security → 100% landing chance; chargeCount:3; 10 rounds.
    // Charge accumulation trace (no banking, triggers only, capped at chargeCount=3):
    //   Non-crit active: +1 (active debuff) per round.
    //   Crit active:     +1 (active debuff) +1 (on-crit debuff) = +2 (often hits cap 3).
    // Round sequence: r1 active(nc,1), r2 active(crit,3), r3 active(nc,3), r4 active(crit,3),
    //   r5 active(nc,3), r6 active(crit,3), r7 active(nc,3), r8 active(crit,3),
    //   r9 active(nc,3), r10 active(crit,3).
    // Defense-down 'Armor Breach' (-30%) first in activeEnemyDebuffs at r3 (applied
    // end-of-r2 drain; Post-Turn decrements it to turnsRemaining=1; visible r3, expires after r3).
    // directDamage shows defense-down effect on rounds 3,5,7,9 (Armor Breach active).
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
});
