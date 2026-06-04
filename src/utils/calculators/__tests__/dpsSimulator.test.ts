import { describe, it, expect } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { flatInputToAbilities } from '../../abilities/flatInputToAbilities';
import { SelectedGameBuff, ParsedBuffEffects } from '../../../types/calculator';
import { Ability, Condition, ShipSkills } from '../../../types/abilities';

function makeAlwaysBuff(id: string, effects: ParsedBuffEffects): SelectedGameBuff {
    return { id, buffName: id, stacks: 1, parsedEffects: effects, isStackable: false };
}

describe('simulateDPS', () => {
    const baseInput = {
        attack: 15000,
        crit: 100,
        critDamage: 150,
        defensePenetration: 0,
        activeMultiplier: 100,
        chargedMultiplier: 0,
        chargeCount: 0,
        activeDoTs: [],
        chargedDoTs: [],
        enemyDefense: 0,
        enemyHp: 500000,
        rounds: 3,
        selfBuffs: [] as SelectedGameBuff[],
        enemyDebuffs: [] as SelectedGameBuff[],
    };

    describe('active-only ship (no charged, no DoTs)', () => {
        it('produces identical direct damage each round', () => {
            const result = simulateDPS({ ...baseInput, enemyDefense: 0 });
            expect(result.rounds).toHaveLength(3);
            expect(result.rounds.every((r) => r.action === 'active')).toBe(true);
            const dmg = result.rounds[0].directDamage;
            expect(dmg).toBeGreaterThan(0);
            expect(result.rounds[1].directDamage).toBe(dmg);
            expect(result.rounds[2].directDamage).toBe(dmg);
            expect(result.rounds.every((r) => r.corrosionDamage === 0)).toBe(true);
            expect(result.rounds.every((r) => r.infernoDamage === 0)).toBe(true);
            expect(result.rounds.every((r) => r.detonationDamage === 0)).toBe(true);
        });

        it('calculates correct summary totals', () => {
            const result = simulateDPS({ ...baseInput, rounds: 5 });
            const perRound = result.rounds[0].directDamage;
            expect(result.summary.totalDamage).toBe(perRound * 5);
            expect(result.summary.avgDamagePerRound).toBe(perRound);
            expect(result.summary.totalDirectDamage).toBe(perRound * 5);
            expect(result.summary.totalCorrosionDamage).toBe(0);
            expect(result.summary.totalInfernoDamage).toBe(0);
            expect(result.summary.totalDetonationDamage).toBe(0);
        });

        it('applies defense reduction to direct damage', () => {
            const noDef = simulateDPS({ ...baseInput, enemyDefense: 0 });
            const withDef = simulateDPS({ ...baseInput, enemyDefense: 15000 });
            expect(withDef.rounds[0].directDamage).toBeLessThan(noDef.rounds[0].directDamage);
        });
    });

    describe('active + charged cycle', () => {
        it('fires charged after chargeCount active rounds', () => {
            const result = simulateDPS({
                ...baseInput,
                activeMultiplier: 150,
                chargedMultiplier: 350,
                chargeCount: 3,
                rounds: 8,
            });
            expect(result.rounds[0].action).toBe('active');
            expect(result.rounds[1].action).toBe('active');
            expect(result.rounds[2].action).toBe('active');
            expect(result.rounds[3].action).toBe('charged');
            expect(result.rounds[3].charges).toBe(0);
            expect(result.rounds[6].action).toBe('active');
            expect(result.rounds[7].action).toBe('charged');
        });

        it('exposes chargeCount on every round for charge-progress display', () => {
            const result = simulateDPS({
                ...baseInput,
                activeMultiplier: 150,
                chargedMultiplier: 350,
                chargeCount: 3,
                rounds: 5,
            });
            expect(result.rounds.every((r) => r.chargeCount === 3)).toBe(true);
            // Active rounds bank charges toward the threshold
            expect(result.rounds[0].charges).toBe(1);
            expect(result.rounds[2].charges).toBe(3);
        });

        it('reports chargeCount 0 when the ship has no charged skill', () => {
            const result = simulateDPS({
                ...baseInput,
                chargedMultiplier: 0,
                chargeCount: 0,
                rounds: 3,
            });
            expect(result.rounds.every((r) => r.chargeCount === 0)).toBe(true);
        });

        it('charged damage is higher when chargedMultiplier > activeMultiplier', () => {
            const result = simulateDPS({
                ...baseInput,
                activeMultiplier: 150,
                chargedMultiplier: 350,
                chargeCount: 3,
                rounds: 4,
            });
            const activeDmg = result.rounds[0].directDamage;
            const chargedDmg = result.rounds[3].directDamage;
            expect(chargedDmg).toBeGreaterThan(activeDmg);
            expect(chargedDmg / activeDmg).toBeCloseTo(350 / 150, 1);
        });
    });

    describe('charged skill guard', () => {
        it('skips charging when chargedMultiplier is 0', () => {
            const result = simulateDPS({
                ...baseInput,
                chargedMultiplier: 0,
                chargeCount: 3,
                rounds: 5,
            });
            expect(result.rounds.every((r) => r.action === 'active')).toBe(true);
        });

        it('skips charging when chargeCount is 0', () => {
            const result = simulateDPS({
                ...baseInput,
                chargedMultiplier: 200,
                chargeCount: 0,
                rounds: 5,
            });
            expect(result.rounds.every((r) => r.action === 'active')).toBe(true);
        });

        // Phase 2 semantics: an explicit charged slot with a 0-multiplier damage ability
        // now HAS an ability → the charged slot is non-empty → charged turns fire on cadence
        // (dealing 0 direct damage). Previously this tested that such a ship stays on 'active'
        // forever; that pre-Phase-2 behaviour was correct when hasChargedSkill required a
        // positive multiplier, but the widened rule counts ANY ability in the charged slot.
        it('an explicit 0-multiplier charged damage ability still fires charged turns (dealing 0)', () => {
            const shipSkills: ShipSkills = {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'active-dmg',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 100 },
                            },
                        ],
                    },
                    {
                        slot: 'charged',
                        abilities: [
                            {
                                id: 'charged-dmg',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 0 },
                            },
                        ],
                    },
                ],
            };
            const result = simulateDPS({
                ...baseInput,
                chargeCount: 3,
                rounds: 5,
                shipSkills,
            });
            // Phase 2 semantics change: the pre-Phase-2 rule (multiplier > 0) kept this
            // ship on 'active' forever; the widened rule (ANY charged-slot ability)
            // fires charged turns on cadence — round 4 is a charged turn dealing 0.
            expect(result.rounds[0].action).toBe('active');
            expect(result.rounds[1].action).toBe('active');
            expect(result.rounds[2].action).toBe('active');
            expect(result.rounds[3].action).toBe('charged');
            // 0-multiplier damage ability → no direct damage on the charged turn
            expect(result.rounds[3].directDamage).toBe(0);
        });

        it('a damage-less charged skill still fires on cadence and applies its buffs', () => {
            // Utility charged slot: only a buff ability, no damage. Phase 2: hasChargedSkill
            // widens to "charged slot carries ANY ability", so the ship banks charges and
            // fires charged turns; the buff ability applies on those turns.
            const shipSkills: ShipSkills = {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'active-dmg',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 100 },
                            },
                        ],
                    },
                    {
                        slot: 'charged',
                        abilities: [
                            {
                                id: 'charged-buff',
                                type: 'buff',
                                target: 'self',
                                trigger: 'on-cast',
                                conditions: [],
                                config: {
                                    type: 'buff',
                                    buffName: 'Attack Up II',
                                    stacks: 1,
                                    isStackable: false,
                                    parsedEffects: { attack: 20 },
                                    duration: 1,
                                },
                            },
                        ],
                    },
                ],
            };
            const result = simulateDPS({
                ...baseInput,
                chargeCount: 2,
                rounds: 4,
                shipSkills,
            });
            // chargeCount=2 → active r1, active r2, charged r3, active r4
            expect(result.rounds[0].action).toBe('active');
            expect(result.rounds[1].action).toBe('active');
            expect(result.rounds[2].action).toBe('charged');
            // The buff ability applies on the charged turn
            expect(
                result.rounds[2].activeSelfBuffs.some((b) => b.buffName === 'Attack Up II')
            ).toBe(true);
            // Duration 1 means it expires after the charged turn → not present on round 4
            expect(
                result.rounds[3].activeSelfBuffs.some((b) => b.buffName === 'Attack Up II')
            ).toBe(false);
        });
    });

    describe('passive charge abilities', () => {
        // Charge aura on the passive slot (Hermes/Asphodel/Hemlock/Oleander/Cobalt
        // pattern): sourced on ACTIVE rounds alongside the firing skill's charge
        // abilities, same gate/scale semantics, capped at chargeCount.
        const skillsWithPassiveCharge = (chargeConditions: Condition[]): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'active-dmg',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 150 },
                        },
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        {
                            id: 'charged-dmg',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 350 },
                        },
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        {
                            id: 'passive-charge',
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-cast',
                            conditions: chargeConditions,
                            config: { type: 'charge', amount: 1 },
                        },
                    ],
                },
            ],
        });

        it('accelerates the charged cadence (unconditional passive charge)', () => {
            const result = simulateDPS({
                ...baseInput,
                chargeCount: 3,
                rounds: 6,
                shipSkills: skillsWithPassiveCharge([]),
            });
            // Active rounds bank 1 (cadence) + 1 (passive aura), capped at 3:
            // r1 active (1+1=2), r2 active (3, cap), r3 CHARGED — was r4 before.
            expect(result.rounds[0].action).toBe('active');
            expect(result.rounds[0].charges).toBe(2);
            expect(result.rounds[1].action).toBe('active');
            expect(result.rounds[1].charges).toBe(3);
            expect(result.rounds[2].action).toBe('charged');
            expect(result.rounds[2].charges).toBe(0);
            // Cadence repeats: r4-r5 active, r6 charged.
            expect(result.rounds[5].action).toBe('charged');
        });

        it('a condition-gated passive charge contributes nothing when the condition fails', () => {
            // self-crit-scaled charge (Asphodel pattern) with crit 0: roundCrit is
            // always false, so the passive contributes 0 — original cadence (r4 charged).
            const result = simulateDPS({
                ...baseInput,
                crit: 0,
                chargeCount: 3,
                rounds: 4,
                shipSkills: skillsWithPassiveCharge([{ subject: 'self-crit', derivable: true }]),
            });
            expect(result.rounds[0].action).toBe('active');
            expect(result.rounds[1].action).toBe('active');
            expect(result.rounds[2].action).toBe('active');
            expect(result.rounds[3].action).toBe('charged');
        });
    });

    describe('scheduled charge-slot buffs follow real bonus-charge cadence', () => {
        // A charge aura on the ACTIVE slot accelerates the cadence: active rounds bank
        // 1 (cadence) + 1 (bonus), capped at chargeCount=3, so charged fires on rounds
        // 3/6/9 (the REAL cadence) instead of computeChargeSchedule's synthetic 4/8/12.
        // A scheduled charge-slot self-buff must ride that REAL cadence (action-fed).
        const skillsWithActiveCharge = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'active-dmg',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 150 },
                        },
                        {
                            id: 'active-charge',
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'charge', amount: 1 },
                        },
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        {
                            id: 'charged-dmg',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 350 },
                        },
                    ],
                },
            ],
        });

        it('scheduled charge-slot buff follows the real bonus-charge cadence', () => {
            const result = simulateDPS({
                ...baseInput,
                chargeCount: 3,
                rounds: 9,
                shipSkills: skillsWithActiveCharge(),
                selfBuffs: [
                    {
                        id: 'b',
                        buffName: 'Attack Up II',
                        stacks: 1,
                        isStackable: false,
                        parsedEffects: { attack: 20 },
                        skillSource: 'charge',
                        skillDuration: 1,
                    },
                ],
            });
            // Real charged round 3 → buff present; synthetic round 4 → buff absent.
            expect(result.rounds[2].activeSelfBuffs.map((b) => b.buffName)).toContain(
                'Attack Up II'
            );
            expect(result.rounds[3].activeSelfBuffs.map((b) => b.buffName)).not.toContain(
                'Attack Up II'
            );
        });
    });

    describe('actor speeds', () => {
        const corrosionSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'd',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100 },
                        },
                        {
                            id: 'c',
                            type: 'dot',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'dot',
                                dotType: 'corrosion',
                                tier: 5,
                                stacks: 1,
                                duration: 3,
                            },
                        },
                    ],
                },
            ],
        };

        it('a faster enemy ticks DoTs before the attacker acts — first tick lands in round 2', () => {
            // Enemy speed 150 > attacker 100: the enemy's round-1 turn precedes the
            // attacker's first DoT application, so the first corrosion tick happens on
            // the enemy's round-2 turn (using round-1's attacker context).
            const result = simulateDPS({
                ...baseInput,
                enemySpeed: 150,
                rounds: 3,
                enemyHp: 500000,
                shipSkills: corrosionSkills,
            });
            expect(result.rounds[0].corrosionDamage).toBe(0);
            expect(result.rounds[1].corrosionDamage).toBeGreaterThan(0);
        });

        it('default speeds keep the slow-enemy ordering (round-1 tick present)', () => {
            const result = simulateDPS({
                ...baseInput,
                rounds: 3,
                enemyHp: 500000,
                shipSkills: corrosionSkills,
            });
            expect(result.rounds[0].corrosionDamage).toBeGreaterThan(0);
        });
    });

    describe('corrosion', () => {
        it('accumulates stacks with expiry based on duration', () => {
            const result = simulateDPS({
                ...baseInput,
                activeDoTs: [{ id: '1', type: 'corrosion', tier: 3, stacks: 1, duration: 2 }],
                rounds: 4,
            });
            // r1: +1 stack (rem 2), tick 1 stack = 1*0.03*500000=15000, expire rem->1. End: 1 stack
            expect(result.rounds[0].corrosionDamage).toBe(15000);
            // r2: +1 stack (rem 2), tick 2 stacks = 30000, expire r1 rem->0 (removed), r2 rem->1. End: 1 stack
            expect(result.rounds[1].corrosionDamage).toBe(30000);
            // r3: +1 stack (rem 2), tick 2 stacks = 30000 (steady state). End: 1 stack
            expect(result.rounds[2].corrosionDamage).toBe(30000);
            // r4: steady state
            expect(result.rounds[3].corrosionDamage).toBe(30000);
        });

        it('is not affected by enemy defense', () => {
            const noDef = simulateDPS({
                ...baseInput,
                enemyDefense: 0,
                activeDoTs: [{ id: '1', type: 'corrosion', tier: 6, stacks: 2, duration: 2 }],
                rounds: 1,
            });
            const withDef = simulateDPS({
                ...baseInput,
                enemyDefense: 15000,
                activeDoTs: [{ id: '1', type: 'corrosion', tier: 6, stacks: 2, duration: 2 }],
                rounds: 1,
            });
            expect(noDef.rounds[0].corrosionDamage).toBe(withDef.rounds[0].corrosionDamage);
        });
    });

    describe('inferno', () => {
        it('deals damage with expiry', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: [{ id: '1', type: 'inferno', tier: 30, stacks: 1, duration: 2 }],
                rounds: 3,
            });
            // r1: 1 stack = 1*0.30*10000=3000, expire rem->1
            expect(result.rounds[0].infernoDamage).toBe(3000);
            // r2: 2 stacks = 6000, expire r1 stack
            expect(result.rounds[1].infernoDamage).toBe(6000);
            // r3: 2 stacks = 6000 steady state
            expect(result.rounds[2].infernoDamage).toBe(6000);
        });

        it('scales with attack buff but not outgoing damage buff', () => {
            const withAtkBuff = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: [{ id: '1', type: 'inferno', tier: 30, stacks: 1, duration: 2 }],
                selfBuffs: [makeAlwaysBuff('1', { attack: 50 })],
                rounds: 1,
            });
            expect(withAtkBuff.rounds[0].infernoDamage).toBe(4500);

            const withOutgoingBuff = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: [{ id: '1', type: 'inferno', tier: 30, stacks: 1, duration: 2 }],
                selfBuffs: [makeAlwaysBuff('1', { outgoingDamage: 50 })],
                rounds: 1,
            });
            expect(withOutgoingBuff.rounds[0].infernoDamage).toBe(3000);
        });
    });

    describe('bombs', () => {
        it('detonates after countdown reaches 0', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: [{ id: '1', type: 'bomb', tier: 100, stacks: 1, duration: 2 }],
                rounds: 4,
            });
            expect(result.rounds[0].detonationDamage).toBe(0);
            expect(result.rounds[1].detonationDamage).toBe(10000);
            expect(result.rounds[2].detonationDamage).toBe(10000);
        });

        it('is not affected by defense or outgoing damage buff', () => {
            const noDef = simulateDPS({
                ...baseInput,
                attack: 10000,
                enemyDefense: 0,
                activeDoTs: [{ id: '1', type: 'bomb', tier: 200, stacks: 1, duration: 1 }],
                rounds: 1,
            });
            const withDef = simulateDPS({
                ...baseInput,
                attack: 10000,
                enemyDefense: 15000,
                activeDoTs: [{ id: '1', type: 'bomb', tier: 200, stacks: 1, duration: 1 }],
                rounds: 1,
            });
            expect(noDef.rounds[0].detonationDamage).toBe(withDef.rounds[0].detonationDamage);
        });

        it('scales with attack buff', () => {
            const withAtkBuff = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: [{ id: '1', type: 'bomb', tier: 100, stacks: 1, duration: 1 }],
                selfBuffs: [makeAlwaysBuff('1', { attack: 50 })],
                rounds: 1,
            });
            // effectiveAttack = 10000 * 1.5 = 15000, bomb = 1 * 15000 = 15000
            expect(withAtkBuff.rounds[0].detonationDamage).toBe(15000);
        });

        it('is not affected by outgoing damage buff', () => {
            const noBuff = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: [{ id: '1', type: 'bomb', tier: 100, stacks: 1, duration: 1 }],
                rounds: 1,
            });
            const withBuff = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: [{ id: '1', type: 'bomb', tier: 100, stacks: 1, duration: 1 }],
                selfBuffs: [makeAlwaysBuff('1', { outgoingDamage: 50 })],
                rounds: 1,
            });
            expect(noBuff.rounds[0].detonationDamage).toBe(withBuff.rounds[0].detonationDamage);
        });
    });

    describe('accumulate-detonate (Echoing Burst)', () => {
        const damageAbility = (id: string, multiplier: number): Ability => ({
            id,
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier },
        });
        const accumulateAbility = (id: string, turns: number, pct: number): Ability => ({
            id,
            type: 'accumulate-detonate',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'accumulate-detonate', turns, pct },
        });
        const skills = (abilities: Ability[]): ShipSkills => ({
            slots: [{ slot: 'active', abilities }],
        });

        it('gathers direct damage and detonates for the % of the accumulated total on expiry', () => {
            const result = simulateDPS({
                ...baseInput,
                enemyDefense: 0,
                shipSkills: skills([damageAbility('d', 100), accumulateAbility('e', 2, 100)]),
                rounds: 3,
            });
            const dd = result.rounds[0].directDamage;
            expect(dd).toBeGreaterThan(0);
            // Round 1: the accumulator is freshly applied — nothing detonates yet.
            expect(result.rounds[0].detonationDamage).toBe(0);
            // Round 2: the round-1 accumulator expires, bursting 2 turns of gathered direct damage.
            expect(result.rounds[1].detonationDamage).toBeCloseTo(2 * dd, 5);
        });

        it('scales the burst by the detonation percentage', () => {
            const result = simulateDPS({
                ...baseInput,
                enemyDefense: 0,
                shipSkills: skills([damageAbility('d', 100), accumulateAbility('e', 2, 50)]),
                rounds: 3,
            });
            const dd = result.rounds[0].directDamage;
            // 50% of 2 gathered turns = 1× a single round's direct damage.
            expect(result.rounds[1].detonationDamage).toBeCloseTo(dd, 5);
        });
    });

    describe('mixed DoTs on active vs charged', () => {
        it('applies correct DoT config based on action type', () => {
            const result = simulateDPS({
                ...baseInput,
                activeMultiplier: 100,
                chargedMultiplier: 200,
                chargeCount: 2,
                activeDoTs: [{ id: '1', type: 'inferno', tier: 15, stacks: 1, duration: 2 }],
                chargedDoTs: [{ id: '2', type: 'corrosion', tier: 9, stacks: 3, duration: 2 }],
                rounds: 3,
            });
            // r1: active, +1 inferno (rem 2). Expire: rem->1. End: 1 inferno, 0 corrosion
            expect(result.rounds[0].activeInfernoStacks).toBe(1);
            expect(result.rounds[0].activeCorrosionStacks).toBe(0);
            // r2: active, +1 inferno (rem 2). Expire: r1 rem->0 (removed), r2 rem->1. End: 1 inferno, 0 corrosion
            expect(result.rounds[1].activeInfernoStacks).toBe(1);
            expect(result.rounds[1].activeCorrosionStacks).toBe(0);
            // r3: charged, +3 corrosion (rem 2). r2 inferno ticks then expires (rem->0). End: 0 inferno, 3 corrosion
            expect(result.rounds[2].action).toBe('charged');
            expect(result.rounds[2].activeInfernoStacks).toBe(0);
            expect(result.rounds[2].activeCorrosionStacks).toBe(3);
        });

        it('calculates mixed-tier corrosion damage correctly', () => {
            const result = simulateDPS({
                ...baseInput,
                activeMultiplier: 100,
                chargedMultiplier: 200,
                chargeCount: 2,
                enemyHp: 100000,
                activeDoTs: [{ id: '1', type: 'corrosion', tier: 3, stacks: 1, duration: 2 }],
                chargedDoTs: [{ id: '2', type: 'corrosion', tier: 9, stacks: 1, duration: 2 }],
                rounds: 4,
            });
            // r1: +1 tier3 (rem 2), tick 1*0.03*100000=3000, expire rem->1
            expect(result.rounds[0].corrosionDamage).toBe(3000);
            // r2: +1 tier3 (rem 2), tick (1+1)*0.03*100000=6000, expire r1 tier3 (rem->0)
            expect(result.rounds[1].corrosionDamage).toBe(6000);
            // r3: charged, +1 tier9 (rem 2), tick 1*0.03*100000 + 1*0.09*100000=12000, expire r2 tier3 (rem->0)
            expect(result.rounds[2].corrosionDamage).toBe(12000);
            // r4: active, +1 tier3 (rem 2), tick 1*0.09*100000 + 1*0.03*100000=12000, expire r3 tier9 (rem->0)
            expect(result.rounds[3].corrosionDamage).toBe(12000);
        });

        it('supports multiple DoT entries per skill', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: [
                    { id: '1', type: 'inferno', tier: 15, stacks: 1, duration: 2 },
                    { id: '2', type: 'inferno', tier: 30, stacks: 1, duration: 2 },
                ],
                rounds: 1,
            });
            // 1 stack at 15% + 1 stack at 30% = 1500 + 3000 = 4500
            expect(result.rounds[0].infernoDamage).toBe(4500);
        });
    });

    describe('round 1 DoT ticking', () => {
        it('DoTs deal damage on the turn they are applied', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: [{ id: '1', type: 'inferno', tier: 30, stacks: 2, duration: 2 }],
                rounds: 1,
            });
            expect(result.rounds[0].infernoDamage).toBe(6000);
        });
    });

    describe('DoT duration and expiry', () => {
        it('stacks expire after their duration', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: [{ id: '1', type: 'inferno', tier: 30, stacks: 1, duration: 1 }],
                rounds: 3,
            });
            // Duration 1: each stack ticks once then expires
            expect(result.rounds[0].infernoDamage).toBe(3000);
            expect(result.rounds[0].activeInfernoStacks).toBe(0); // expired after ticking
            expect(result.rounds[1].infernoDamage).toBe(3000);
            expect(result.rounds[2].infernoDamage).toBe(3000);
        });

        it('longer duration allows more overlap', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: [{ id: '1', type: 'inferno', tier: 15, stacks: 1, duration: 3 }],
                rounds: 5,
            });
            // r1: 1 stack = 1500
            expect(result.rounds[0].infernoDamage).toBe(1500);
            // r2: 2 stacks = 3000
            expect(result.rounds[1].infernoDamage).toBe(3000);
            // r3: 3 stacks = 4500 (max overlap with duration 3)
            expect(result.rounds[2].infernoDamage).toBe(4500);
            // r4: 3 stacks = 4500 (steady state, r1 expired)
            expect(result.rounds[3].infernoDamage).toBe(4500);
            // r5: steady
            expect(result.rounds[4].infernoDamage).toBe(4500);
        });
    });

    describe('always-active buffs', () => {
        const base = {
            attack: 1000,
            crit: 0,
            critDamage: 150,
            defensePenetration: 0,
            activeMultiplier: 100,
            chargedMultiplier: 0,
            chargeCount: 0,
            activeDoTs: [],
            chargedDoTs: [],
            enemyDefense: 0,
            enemyHp: 10000,
            rounds: 1,
            selfBuffs: [] as SelectedGameBuff[],
            enemyDebuffs: [] as SelectedGameBuff[],
        };

        it('defensePenetrationBuff adds to defensePenetration', () => {
            const withPen = simulateDPS({
                ...base,
                enemyDefense: 500,
                selfBuffs: [makeAlwaysBuff('pen', { defensePenetration: 20 })],
            });
            const noPen = simulateDPS({ ...base, enemyDefense: 500 });
            expect(withPen.summary.totalDamage).toBeGreaterThan(noPen.summary.totalDamage);
        });

        it('enemyDefenseModifier reduces enemy defense', () => {
            const withMod = simulateDPS({
                ...base,
                enemyDefense: 1000,
                enemyDebuffs: [makeAlwaysBuff('defdown', { defense: -30 })],
            });
            const noMod = simulateDPS({ ...base, enemyDefense: 1000 });
            expect(withMod.summary.totalDamage).toBeGreaterThan(noMod.summary.totalDamage);
        });

        it('incomingDamageModifier multiplies direct damage', () => {
            const withMod = simulateDPS({
                ...base,
                enemyDebuffs: [makeAlwaysBuff('incdmg', { incomingDamage: 30 })],
            });
            const noMod = simulateDPS({ ...base });
            expect(withMod.summary.totalDamage).toBeCloseTo(noMod.summary.totalDamage * 1.3, -1);
        });

        it('dotDamageModifier multiplies corrosion damage', () => {
            const dotBase = {
                ...base,
                activeDoTs: [
                    { id: '1', type: 'corrosion' as const, stacks: 1, tier: 10, duration: 2 },
                ],
            };
            const withMod = simulateDPS({
                ...dotBase,
                selfBuffs: [makeAlwaysBuff('dotup', { dotDamage: 50 })],
            });
            const noMod = simulateDPS({ ...dotBase });
            expect(withMod.summary.totalCorrosionDamage).toBeGreaterThan(
                noMod.summary.totalCorrosionDamage
            );
        });
        it('dotDamageModifier multiplies inferno damage', () => {
            const dotBase = {
                ...base,
                activeDoTs: [
                    { id: '1', type: 'inferno' as const, stacks: 1, tier: 30, duration: 2 },
                ],
            };
            const withMod = simulateDPS({
                ...dotBase,
                selfBuffs: [makeAlwaysBuff('dotup', { dotDamage: 50 })],
            });
            const noMod = simulateDPS({ ...dotBase });
            expect(withMod.summary.totalInfernoDamage).toBeGreaterThan(
                noMod.summary.totalInfernoDamage
            );
        });
    });

    describe('affinity modifiers', () => {
        const baseNoDefense = {
            attack: 15000,
            crit: 100,
            critDamage: 150,
            defensePenetration: 0,
            activeMultiplier: 100,
            chargedMultiplier: 0,
            chargeCount: 0,
            activeDoTs: [],
            chargedDoTs: [],
            enemyDefense: 0,
            enemyHp: 500000,
            rounds: 3,
            selfBuffs: [] as SelectedGameBuff[],
            enemyDebuffs: [] as SelectedGameBuff[],
        };

        it('advantage multiplies all damage by 1.25', () => {
            const baseline = simulateDPS(baseNoDefense);
            const result = simulateDPS({ ...baseNoDefense, affinityDamageModifier: 25 });
            expect(result.summary.totalDamage).toBe(
                Math.round(baseline.summary.totalDamage * 1.25)
            );
        });

        it('disadvantage reduces damage and applies crit penalty', () => {
            const result = simulateDPS({
                ...baseNoDefense,
                affinityDamageModifier: -25,
                affinityCritCap: 75,
                affinityCritPenalty: 25,
            });
            // effectiveCrit = min(75, 100-25) = 75; critDamage = 150.
            // Deterministic schedule (3 rounds): acc starts at 0; fires when acc >= 1.
            //   Round 1: acc = 0.75 → no crit → dmg = 15000 * 1.0 * 0.75 = 11250
            //   Round 2: acc = 1.50 → crit! acc=0.50 → dmg = 15000 * 2.5 * 0.75 = 28125
            //   Round 3: acc = 1.25 → crit! acc=0.25 → dmg = 15000 * 2.5 * 0.75 = 28125
            //   Total = 67500
            // (Previously this tested the expected-value formula 2.125× which has been
            //  replaced by the per-stream deterministic schedule — re-pinned intentionally.)
            expect(result.summary.totalDamage).toBe(67500);
        });

        it('zero modifier (default) leaves damage unchanged', () => {
            const baseline = simulateDPS(baseNoDefense);
            const result = simulateDPS({ ...baseNoDefense, affinityDamageModifier: 0 });
            expect(result.summary.totalDamage).toBe(baseline.summary.totalDamage);
        });

        it('affinity scales hacking, so it changes how often an inflicted debuff lands', () => {
            // Inflict (hacking-based) debuff. hacking 120 / security 100:
            //  disadvantage → effectiveHacking 90  → 0% land
            //  neutral      → 120 → 20% land
            //  advantage    → 150 → 50% land
            const inflictDebuff: SelectedGameBuff = {
                ...makeAlwaysBuff('inflict-debuff', { defense: -50 }),
                application: 'inflict',
            };
            const base = {
                ...baseNoDefense,
                enemyDefense: 10000,
                rounds: 2000,
                hacking: 120,
                enemySecurity: 100,
                enemyDebuffs: [inflictDebuff],
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
            };
            const landedRounds = (mods: Partial<typeof base>) =>
                simulateDPS({ ...base, ...mods }).rounds.filter((r) =>
                    r.activeEnemyDebuffs.some((ab) => ab.buffName === 'inflict-debuff')
                ).length;

            const disadvantage = landedRounds({
                affinityDamageModifier: -25,
                affinityCritCap: 75,
                affinityCritPenalty: 25,
            });
            const neutral = landedRounds({});
            const advantage = landedRounds({ affinityDamageModifier: 25 });

            expect(disadvantage).toBe(0); // 0% landing is deterministic
            expect(advantage).toBeGreaterThan(neutral);
            expect(neutral).toBeGreaterThan(disadvantage);
        });
    });

    describe('per-round buff accuracy', () => {
        // chargeCount=2, startCharged=false → charged fires on rounds 3, 6, 9…
        // (active r1, active r2, charged r3, active r4, active r5, charged r6, …)
        const chargeBuffBase = {
            attack: 10000,
            crit: 0,
            critDamage: 150,
            defensePenetration: 0,
            activeMultiplier: 100,
            chargedMultiplier: 200,
            chargeCount: 2,
            activeDoTs: [] as import('../../../types/calculator').DoTApplicationConfig,
            chargedDoTs: [] as import('../../../types/calculator').DoTApplicationConfig,
            enemyDefense: 0,
            enemyHp: 10000,
            rounds: 6,
            enemyDebuffs: [] as SelectedGameBuff[],
            startCharged: false as const,
        };

        it('charge buff only fires on charge rounds', () => {
            // Buff applies on 'charge', duration 2 → active during rounds 3, 4 (then expires)
            // attackBuff of 100 doubles effectiveAttack when active
            const chargeBuff: SelectedGameBuff = {
                id: 'cb1',
                buffName: 'Power Surge',
                stacks: 1,
                parsedEffects: { attack: 100 },
                isStackable: false,
                skillSource: 'charge',
                skillDuration: 2,
            };
            const result = simulateDPS({
                ...chargeBuffBase,
                selfBuffs: [chargeBuff],
            });

            // Rounds 1, 2: no charge buff → lower direct damage
            const dmgR1 = result.rounds[0].directDamage;
            const dmgR2 = result.rounds[1].directDamage;
            // Rounds 3, 4: buff active (attack doubled) → higher direct damage
            const dmgR3 = result.rounds[2].directDamage;
            const dmgR4 = result.rounds[3].directDamage;
            // Round 5: buff expired → lower again
            const dmgR5 = result.rounds[4].directDamage;

            expect(dmgR1).toBeLessThan(dmgR3);
            expect(dmgR2).toBeLessThan(dmgR3);
            // Rounds 3 and 4 should have higher damage (buff active)
            expect(dmgR3).toBeGreaterThan(dmgR1);
            expect(dmgR4).toBeGreaterThan(dmgR1);
            // Round 5: buff expired, back to base active-skill damage
            expect(dmgR5).toBe(dmgR1);
        });

        it('RoundData.activeSelfBuffs reflects timeline', () => {
            const chargeBuff: SelectedGameBuff = {
                id: 'cb1',
                buffName: 'Power Surge',
                stacks: 1,
                parsedEffects: { attack: 100 },
                isStackable: false,
                skillSource: 'charge',
                skillDuration: 2,
            };
            const result = simulateDPS({
                ...chargeBuffBase,
                selfBuffs: [chargeBuff],
            });

            // Round 1 (index 0): no charge buff yet
            expect(result.rounds[0].activeSelfBuffs).toHaveLength(0);
            // Round 3 (index 2): charge fires → buff is active
            const round3Buffs = result.rounds[2].activeSelfBuffs;
            expect(round3Buffs.some((ab) => ab.buffName === 'Power Surge')).toBe(true);
        });

        it('charge-scoped enemy debuff fires on the ATTACKER charge rounds (legacy rule; source schedule ignored)', () => {
            // The fixture's sourceChargeCount=2/sourceStartCharged=false happens to
            // COINCIDE with the attacker's own cadence (chargeCount 2 → charged rounds
            // 3, 6) — intentional, confirming the attacker-cadence legacy rule yields
            // the right rounds. Divergent cadences are probed in statusEngine.test.ts
            // ("LEGACY RULE" tests).
            const chargeScopeDebuff: SelectedGameBuff = {
                id: 'cs1',
                buffName: 'Armor Pierce',
                stacks: 1,
                parsedEffects: { defense: -20 },
                isStackable: false,
                skillSource: 'charge',
                skillDuration: 1,
                sourceChargeCount: 2,
                sourceStartCharged: false,
            };
            const base = {
                ...chargeBuffBase,
                selfBuffs: [] as SelectedGameBuff[],
                enemyDefense: 1000,
            };
            const withDebuff = simulateDPS({ ...base, enemyDebuffs: [chargeScopeDebuff] });
            const withoutDebuff = simulateDPS({ ...base, enemyDebuffs: [] });
            // Round 3 (index 2) is a charged round in both cases; debuff reduces enemy defense → more damage
            expect(withDebuff.rounds[2].directDamage).toBeGreaterThan(
                withoutDebuff.rounds[2].directDamage
            );
            // RoundData reflects the debuff on round 3, not on round 1
            expect(
                withDebuff.rounds[2].activeEnemyDebuffs.some((ab) => ab.buffName === 'Armor Pierce')
            ).toBe(true);
            expect(withDebuff.rounds[0].activeEnemyDebuffs).toHaveLength(0);
        });

        it('always-active buff present every round', () => {
            const alwaysBuff = makeAlwaysBuff('always1', { attack: 10 });
            const result = simulateDPS({
                ...chargeBuffBase,
                selfBuffs: [alwaysBuff],
            });

            // Every round should have the always-active buff in activeSelfBuffs
            for (const round of result.rounds) {
                expect(round.activeSelfBuffs.some((ab) => ab.buffName === 'always1')).toBe(true);
            }
        });
    });

    describe('hacking / security — debuff landing', () => {
        const baseWithDebuff = {
            ...baseInput,
            enemyDefense: 10000,
            rounds: 5,
            enemyDebuffs: [makeAlwaysBuff('def-debuff', { defense: -50 })],
        };

        it('100% landing (defaults) gives same result as 0% landing has no debuffs', () => {
            // At 100% landing debuffs always apply; at 0% they never apply.
            // These should differ when a defense debuff is present.
            const full = simulateDPS({ ...baseWithDebuff, hacking: 200, enemySecurity: 100 });
            const none = simulateDPS({ ...baseWithDebuff, hacking: 0, enemySecurity: 100 });
            expect(full.summary.totalDamage).toBeGreaterThan(none.summary.totalDamage);
        });

        it('0% landing gives same damage as having no debuffs', () => {
            const noLanding = simulateDPS({ ...baseWithDebuff, hacking: 0, enemySecurity: 100 });
            const noDebuffs = simulateDPS({ ...baseInput, enemyDefense: 10000, rounds: 5 });
            // Monte Carlo average at 0% should match deterministic no-debuff result closely
            expect(
                Math.abs(noLanding.summary.totalDamage - noDebuffs.summary.totalDamage)
            ).toBeLessThan(100);
        });

        it('100% landing gives same damage as deterministic full debuff (within rounding)', () => {
            const full = simulateDPS({ ...baseWithDebuff, hacking: 200, enemySecurity: 100 });
            const alwaysLands = simulateDPS({ ...baseWithDebuff }); // defaults: hacking 200, security 100
            expect(full.summary.totalDamage).toBe(alwaysLands.summary.totalDamage);
        });

        it('50% landing gives damage between 0% and 100% landing', () => {
            // Use a large round count so the stochastic mid-landing case reliably falls
            // between the deterministic 0% and 100% landing results.
            const full = simulateDPS({
                ...baseWithDebuff,
                rounds: 1000,
                hacking: 200,
                enemySecurity: 100,
            });
            const none = simulateDPS({
                ...baseWithDebuff,
                rounds: 1000,
                hacking: 0,
                enemySecurity: 100,
            });
            const partial = simulateDPS({
                ...baseWithDebuff,
                rounds: 1000,
                hacking: 150,
                enemySecurity: 100,
            });
            expect(partial.summary.totalDamage).toBeGreaterThan(none.summary.totalDamage);
            expect(partial.summary.totalDamage).toBeLessThan(full.summary.totalDamage);
        });

        it('produces same number of rounds regardless of landing chance', () => {
            const result = simulateDPS({ ...baseWithDebuff, hacking: 150, enemySecurity: 100 });
            expect(result.rounds).toHaveLength(5);
        });

        it('an "apply" debuff is guaranteed — lands even at 0% landing chance', () => {
            const applyDebuff: SelectedGameBuff = {
                ...makeAlwaysBuff('def-apply', { defense: -50 }),
                application: 'apply',
            };
            // At 0% landing, a resistible debuff never lands, but the guaranteed one always does.
            const guaranteed = simulateDPS({
                ...baseWithDebuff,
                enemyDebuffs: [applyDebuff],
                hacking: 0,
                enemySecurity: 100,
            });
            const resistible = simulateDPS({
                ...baseWithDebuff,
                hacking: 0,
                enemySecurity: 100,
            });
            expect(guaranteed.summary.totalDamage).toBeGreaterThan(resistible.summary.totalDamage);
            // Guaranteed lands every round, so it matches the 100%-landing result.
            const full = simulateDPS({
                ...baseWithDebuff,
                enemyDebuffs: [applyDebuff],
                hacking: 200,
                enemySecurity: 100,
            });
            expect(guaranteed.summary.totalDamage).toBe(full.summary.totalDamage);
            expect(
                guaranteed.rounds.every((r) =>
                    r.activeEnemyDebuffs.some((ab) => ab.buffName === 'def-apply')
                )
            ).toBe(true);
        });

        it('an "apply" (affinity-based) debuff is resisted at an affinity disadvantage', () => {
            const applyDebuff: SelectedGameBuff = {
                ...makeAlwaysBuff('def-apply', { defense: -50 }),
                application: 'apply',
            };
            // Same high hacking (would otherwise guarantee landing), but at an affinity
            // disadvantage the affinity-based debuff never lands per the combat hit-check.
            const disadvantage = simulateDPS({
                ...baseWithDebuff,
                enemyDebuffs: [applyDebuff],
                hacking: 200,
                enemySecurity: 100,
                affinityDamageModifier: -25,
                affinityCritCap: 75,
                affinityCritPenalty: 25,
            });
            const noDebuffs = simulateDPS({
                ...baseInput,
                enemyDefense: 10000,
                rounds: 5,
                affinityDamageModifier: -25,
                affinityCritCap: 75,
                affinityCritPenalty: 25,
            });
            // Resisted → the defense debuff never applies → same damage as having no debuff.
            expect(disadvantage.summary.totalDamage).toBe(noDebuffs.summary.totalDamage);
            expect(
                disadvantage.rounds.every(
                    (r) => !r.activeEnemyDebuffs.some((ab) => ab.buffName === 'def-apply')
                )
            ).toBe(true);

            // At neutral affinity the same apply debuff still lands every round.
            const neutral = simulateDPS({
                ...baseWithDebuff,
                enemyDebuffs: [applyDebuff],
                hacking: 200,
                enemySecurity: 100,
            });
            expect(neutral.summary.totalDamage).toBeGreaterThan(disadvantage.summary.totalDamage);
        });
    });

    describe('startCharged', () => {
        it('fires charged skill on round 1 when startCharged is true', () => {
            const result = simulateDPS({
                attack: 15000,
                crit: 0,
                critDamage: 150,
                defensePenetration: 0,
                activeMultiplier: 100,
                chargedMultiplier: 300,
                chargeCount: 3,
                activeDoTs: [],
                chargedDoTs: [],
                enemyDefense: 0,
                enemyHp: 500000,
                rounds: 5,
                selfBuffs: [],
                enemyDebuffs: [],
                startCharged: true,
            });
            expect(result.rounds[0].action).toBe('charged');
        });

        it('does not fire charged skill on round 1 when startCharged is false', () => {
            const result = simulateDPS({
                attack: 15000,
                crit: 0,
                critDamage: 150,
                defensePenetration: 0,
                activeMultiplier: 100,
                chargedMultiplier: 300,
                chargeCount: 3,
                activeDoTs: [],
                chargedDoTs: [],
                enemyDefense: 0,
                enemyHp: 500000,
                rounds: 5,
                selfBuffs: [],
                enemyDebuffs: [],
                startCharged: false,
            });
            expect(result.rounds[0].action).toBe('active');
        });

        it('defaults to not start charged when field is absent', () => {
            const result = simulateDPS({
                attack: 15000,
                crit: 0,
                critDamage: 150,
                defensePenetration: 0,
                activeMultiplier: 100,
                chargedMultiplier: 300,
                chargeCount: 3,
                activeDoTs: [],
                chargedDoTs: [],
                enemyDefense: 0,
                enemyHp: 500000,
                rounds: 5,
                selfBuffs: [],
                enemyDebuffs: [],
            });
            expect(result.rounds[0].action).toBe('active');
        });
    });

    describe('secondary stat-based damage', () => {
        const exactInput = {
            ...baseInput,
            attack: 1000,
            crit: 100,
            critDamage: 0,
            enemyDefense: 0,
            rounds: 1,
        };

        it('adds Defense-based secondary damage to the direct hit', () => {
            // preCrit = 1000*1.0 + 500*0.80 = 1400
            const result = simulateDPS({
                ...exactInput,
                defence: 500,
                hp: 0,
                activeSecondary: { stat: 'defense', pct: 80 },
            });
            expect(result.rounds[0].directDamage).toBe(1400);
            expect(result.summary.totalSecondaryDamage).toBe(400);
            expect(result.summary.totalDirectDamage).toBe(1400);
        });

        it('adds max-HP-based secondary damage', () => {
            // preCrit = 1000 + 20000*0.10 = 3000
            const result = simulateDPS({
                ...exactInput,
                defence: 0,
                hp: 20000,
                activeSecondary: { stat: 'hp', pct: 10 },
            });
            expect(result.rounds[0].directDamage).toBe(3000);
            expect(result.summary.totalSecondaryDamage).toBe(2000);
        });

        it('scales secondary damage with a Defense Up self-buff', () => {
            // effectiveDefence = 500 * 1.5 = 750; secondary = 750*0.8 = 600; preCrit = 1600
            const result = simulateDPS({
                ...exactInput,
                defence: 500,
                hp: 0,
                activeSecondary: { stat: 'defense', pct: 80 },
                selfBuffs: [makeAlwaysBuff('defup', { defense: 50 })],
            });
            expect(result.rounds[0].directDamage).toBe(1600);
            expect(result.summary.totalSecondaryDamage).toBe(600);
        });

        it('reports zero secondary damage when none configured', () => {
            const result = simulateDPS({ ...exactInput });
            expect(result.summary.totalSecondaryDamage).toBe(0);
            expect(result.rounds[0].directDamage).toBe(1000);
        });

        it('uses chargedSecondary (not activeSecondary) on a charged round', () => {
            // startCharged → round 1 is charged. preCrit = 1000 + 1000*0.50 = 1500.
            // activeSecondary (80%) must NOT be applied on the charged round.
            const result = simulateDPS({
                ...exactInput,
                defence: 1000,
                hp: 0,
                chargedMultiplier: 100,
                chargeCount: 1,
                startCharged: true,
                activeSecondary: { stat: 'defense', pct: 80 },
                chargedSecondary: { stat: 'defense', pct: 50 },
            });
            expect(result.rounds[0].action).toBe('charged');
            expect(result.rounds[0].directDamage).toBe(1500);
            expect(result.summary.totalSecondaryDamage).toBe(500);
        });
    });

    describe('conditional scaling damage', () => {
        const exactInput = {
            ...baseInput,
            attack: 1000,
            crit: 100,
            critDamage: 0, // critMultiplier = 1
            enemyDefense: 0, // no reduction
            activeMultiplier: 100,
            rounds: 1,
        };

        it('applies a manual count to a non-derivable condition', () => {
            // bonus = 30 * 3 = 90 → preCrit = 1000 * (100 + 90)/100 = 1900
            const result = simulateDPS({
                ...exactInput,
                activeConditional: {
                    pct: 30,
                    condition: 'enemy-buff',
                    derivable: false,
                    manualCount: 3,
                },
            });
            expect(result.rounds[0].directDamage).toBe(1900);
            expect(result.summary.totalConditionalDamage).toBe(900);
        });

        it('defaults manual count to 1 when omitted', () => {
            // bonus = 30 * 1 = 30 → preCrit = 1300
            const result = simulateDPS({
                ...exactInput,
                activeConditional: { pct: 30, condition: 'enemy-buff', derivable: false },
            });
            expect(result.rounds[0].directDamage).toBe(1300);
            expect(result.summary.totalConditionalDamage).toBe(300);
        });

        it('derives the count from active self buffs', () => {
            // 2 self buffs → count 2 → bonus = 25*2 = 50 → preCrit = 1500
            const result = simulateDPS({
                ...exactInput,
                selfBuffs: [makeAlwaysBuff('b1', {}), makeAlwaysBuff('b2', {})],
                activeConditional: { pct: 25, condition: 'self-buff', derivable: true },
            });
            expect(result.rounds[0].directDamage).toBe(1500);
            expect(result.summary.totalConditionalDamage).toBe(500);
        });

        it('respects the cap', () => {
            // raw bonus = 20*10 = 200, capped at 100 → preCrit = 2000
            const result = simulateDPS({
                ...exactInput,
                activeConditional: {
                    pct: 20,
                    condition: 'enemy-destroyed',
                    derivable: false,
                    manualCount: 10,
                    cap: 100,
                },
            });
            expect(result.rounds[0].directDamage).toBe(2000);
        });

        it('uses chargedConditional (not activeConditional) on a charged round', () => {
            const result = simulateDPS({
                ...exactInput,
                chargedMultiplier: 100,
                chargeCount: 1,
                startCharged: true,
                activeConditional: {
                    pct: 30,
                    condition: 'enemy-buff',
                    derivable: false,
                    manualCount: 3,
                },
                chargedConditional: {
                    pct: 10,
                    condition: 'enemy-buff',
                    derivable: false,
                    manualCount: 2,
                },
            });
            // charged round: bonus = 10*2 = 20 → preCrit = 1200
            expect(result.rounds[0].action).toBe('charged');
            expect(result.rounds[0].directDamage).toBe(1200);
            expect(result.summary.totalConditionalDamage).toBe(200);
        });

        it('reports zero conditional damage when none configured', () => {
            const result = simulateDPS({ ...exactInput });
            expect(result.summary.totalConditionalDamage).toBe(0);
            expect(result.rounds[0].directDamage).toBe(1000);
        });

        it('derives the enemy-debuff count from prior-round DoT entries (ramps over rounds)', () => {
            // A corrosion DoT is applied each active round, but this round's DoT is pushed
            // AFTER damage is computed — so the enemy-debuff count is the number of PRIOR-round
            // DoT entries: 0, then 1, then 2. bonus = 20% * count.
            const result = simulateDPS({
                ...exactInput,
                rounds: 3,
                activeDoTs: [{ id: 'c', type: 'corrosion', tier: 3, stacks: 1, duration: 10 }],
                activeConditional: { pct: 20, condition: 'enemy-debuff', derivable: true },
            });
            // A bare scaling-source condition SCALES but does not GATE (Meiying fix):
            // round 1 (count 0) deals the base 1000 with +0% bonus — the hit itself
            // always fires; only the per-debuff bonus is conditional.
            // round 1: 1000 + 0; round 2: count 1 → 1200; round 3: count 2 → 1400
            expect(result.rounds[0].directDamage).toBe(1000);
            expect(result.rounds[1].directDamage).toBe(1200);
            expect(result.rounds[2].directDamage).toBe(1400);
            // conditional slice: 0 + 200 + 400 = 600
            expect(result.summary.totalConditionalDamage).toBe(600);
        });
    });

    describe('charge manipulation', () => {
        // Helper: 1-based round numbers where the charged skill fired.
        const chargedRounds = (result: ReturnType<typeof simulateDPS>) =>
            result.rounds.filter((r) => r.action === 'charged').map((r) => r.round);

        const base = {
            attack: 1000,
            crit: 100,
            critDamage: 0,
            defensePenetration: 0,
            activeMultiplier: 100,
            chargedMultiplier: 200,
            chargeCount: 3,
            activeDoTs: [],
            chargedDoTs: [],
            enemyDefense: 0,
            enemyHp: 500000,
            rounds: 12,
            selfBuffs: [],
            enemyDebuffs: [],
        };

        it('baseline: charged fires once charges reach chargeCount (every 4th round for 3 charges)', () => {
            const result = simulateDPS({ ...base });
            expect(chargedRounds(result)).toEqual([4, 8, 12]);
        });

        it('allyChargePerRound speeds up cadence', () => {
            const result = simulateDPS({ ...base, allyChargePerRound: 1 });
            expect(chargedRounds(result)).toEqual([3, 6, 9, 12]);
        });

        it('always-true self gain speeds up cadence', () => {
            const result = simulateDPS({
                ...base,
                selfChargeGain: { amount: 1, condition: 'always', derivable: true },
            });
            expect(chargedRounds(result)).toEqual([3, 6, 9, 12]);
        });

        it('self-crit at 100% crit contributes +1/round', () => {
            const result = simulateDPS({
                ...base,
                selfChargeGain: { amount: 1, condition: 'self-crit', derivable: true },
            });
            expect(chargedRounds(result)).toEqual([3, 6, 9, 12]);
        });

        it('enemy-type gain only applies when enemy type matches', () => {
            const gain = {
                amount: 1,
                condition: 'enemy-type' as const,
                derivable: true,
                requiredEnemyType: 'Defender' as const,
            };
            const matched = simulateDPS({ ...base, selfChargeGain: gain, enemyType: 'Defender' });
            const unmatched = simulateDPS({ ...base, selfChargeGain: gain, enemyType: 'Attacker' });
            expect(chargedRounds(matched)).toEqual([3, 6, 9, 12]);
            expect(chargedRounds(unmatched)).toEqual([4, 8, 12]);
        });

        it('only gains on active rounds and caps charges at chargeCount (e.g. Selenite)', () => {
            // Conditional +1 on active rounds (enemy stealthed → manual count 1),
            // on top of the base +1. Charges must never exceed chargeCount, and the
            // charged round must bank nothing (it consumes all charges).
            const result = simulateDPS({
                ...base,
                selfChargeGain: {
                    amount: 1,
                    condition: 'enemy-buff',
                    derivable: false,
                    manualCount: 1,
                },
            });
            expect(chargedRounds(result)).toEqual([3, 6, 9, 12]);
            expect(result.rounds.every((r) => r.charges <= base.chargeCount)).toBe(true);
            result.rounds
                .filter((r) => r.action === 'charged')
                .forEach((r) => expect(r.charges).toBe(0));
        });

        it('does nothing when there is no charged skill', () => {
            const result = simulateDPS({
                ...base,
                chargedMultiplier: 0,
                allyChargePerRound: 5,
            });
            expect(chargedRounds(result)).toEqual([]);
        });

        it('a count-threshold charge gate adds the flat amount once (not scaled by the raw count)', () => {
            const chargeAbility = (conditions: Ability['conditions']): Ability => ({
                id: 'cg',
                type: 'charge',
                target: 'self',
                trigger: 'on-cast',
                conditions,
                config: { type: 'charge', amount: 1 },
            });
            const dmg = (id: string, multiplier: number): Ability => ({
                id,
                type: 'damage',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'damage', multiplier },
            });
            const skills = (conditions: Ability['conditions']): ShipSkills => ({
                slots: [
                    { slot: 'active', abilities: [dmg('a', 100), chargeAbility(conditions)] },
                    { slot: 'charged', abilities: [dmg('c', 200)] },
                ],
            });
            // self-buff count is 3; gate is "≥ 2 self buffs" → met. A correct gate adds +1/round
            // (cadence [3,6,9,12]); the old raw-count bug would add +3/round (much faster).
            const threeBuffs = [
                makeAlwaysBuff('b1', {}),
                makeAlwaysBuff('b2', {}),
                makeAlwaysBuff('b3', {}),
            ];
            const met = simulateDPS({
                ...base,
                shipSkills: skills([
                    {
                        subject: 'self-buff',
                        derivable: true,
                        countComparator: 'gte',
                        countThreshold: 2,
                    },
                ]),
                selfBuffs: threeBuffs,
            });
            expect(chargedRounds(met)).toEqual([3, 6, 9, 12]);

            // Below the threshold (1 < 2) the gate fails → no bonus → baseline cadence.
            const notMet = simulateDPS({
                ...base,
                shipSkills: skills([
                    {
                        subject: 'self-buff',
                        derivable: true,
                        countComparator: 'gte',
                        countThreshold: 2,
                    },
                ]),
                selfBuffs: [makeAlwaysBuff('b1', {})],
            });
            expect(chargedRounds(notMet)).toEqual([4, 8, 12]);
        });
    });

    describe('ShipSkills adapter equivalence', () => {
        it('flat input and its flatInputToAbilities form produce identical results', () => {
            const flat = {
                ...baseInput,
                attack: 22000,
                crit: 60,
                critDamage: 180,
                defensePenetration: 10,
                activeMultiplier: 140,
                chargedMultiplier: 320,
                chargeCount: 3,
                rounds: 12,
                enemyDefense: 12000,
                enemyHp: 400000,
                defence: 9000,
                hp: 80000,
                activeSecondary: { stat: 'defense' as const, pct: 80 },
                activeConditional: {
                    pct: 20,
                    condition: 'enemy-debuff' as const,
                    derivable: true,
                    cap: 100,
                },
                selfChargeGain: {
                    amount: 1,
                    condition: 'always' as const,
                    derivable: true,
                },
                activeDoTs: [
                    {
                        id: 'dot-1',
                        type: 'corrosion' as const,
                        tier: 6,
                        stacks: 2,
                        duration: 3,
                    },
                ],
                selfBuffs: [makeAlwaysBuff('atkBuff', { attack: 25 } as ParsedBuffEffects)],
                enemyDebuffs: [makeAlwaysBuff('defDown', { defense: -30 } as ParsedBuffEffects)],
            };

            const fromFlat = simulateDPS(flat);
            const fromSkills = simulateDPS({ ...flat, shipSkills: flatInputToAbilities(flat) });

            expect(fromSkills.rounds).toEqual(fromFlat.rounds);
            expect(fromSkills.summary).toEqual(fromFlat.summary);
        });
    });

    describe('modifier abilities (via shipSkills)', () => {
        const damageAbility = (id: string, multiplier: number, hits?: number): Ability => ({
            id,
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier, ...(hits !== undefined ? { hits } : {}) },
        });
        const modifierAbility = (
            id: string,
            channel: 'attack' | 'outgoingDamage',
            value: number
        ): Ability => ({
            id,
            type: 'modifier',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'modifier', channel, value, isMultiplicative: true },
        });
        const activeSkills = (abilities: Ability[]): ShipSkills => ({
            slots: [{ slot: 'active', abilities }],
        });

        it('outgoingDamage modifier matches an equivalent outgoingDamage buff', () => {
            const simA = simulateDPS({
                ...baseInput,
                shipSkills: activeSkills([
                    damageAbility('d', 100),
                    modifierAbility('m', 'outgoingDamage', 40),
                ]),
            });
            const simB = simulateDPS({
                ...baseInput,
                shipSkills: activeSkills([damageAbility('d', 100)]),
                selfBuffs: [makeAlwaysBuff('x', { outgoingDamage: 40 } as ParsedBuffEffects)],
            });
            expect(simA.rounds[0].directDamage).toBe(simB.rounds[0].directDamage);
        });

        it('attack modifier matches an equivalent attack buff', () => {
            const simA = simulateDPS({
                ...baseInput,
                shipSkills: activeSkills([
                    damageAbility('d', 100),
                    modifierAbility('m', 'attack', 50),
                ]),
            });
            const simB = simulateDPS({
                ...baseInput,
                shipSkills: activeSkills([damageAbility('d', 100)]),
                selfBuffs: [makeAlwaysBuff('x', { attack: 50 } as ParsedBuffEffects)],
            });
            expect(simA.rounds[0].directDamage).toBe(simB.rounds[0].directDamage);
        });

        it('conditional modifier applies only when the gate is met', () => {
            const conditionalModifier: Ability = {
                id: 'm',
                type: 'modifier',
                target: 'self',
                trigger: 'on-cast',
                conditions: [
                    { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
                ],
                config: {
                    type: 'modifier',
                    channel: 'outgoingDamage',
                    value: 40,
                    isMultiplicative: true,
                },
            };
            const skills = activeSkills([damageAbility('d', 100), conditionalModifier]);
            const matched = simulateDPS({
                ...baseInput,
                shipSkills: skills,
                enemyType: 'Defender',
            });
            const unmatched = simulateDPS({
                ...baseInput,
                shipSkills: skills,
                enemyType: 'Attacker',
            });
            expect(matched.rounds[0].directDamage).toBeGreaterThan(
                unmatched.rounds[0].directDamage
            );
        });

        it('multi-hit damage equals a single hit with the summed multiplier', () => {
            const multiHit = simulateDPS({
                ...baseInput,
                shipSkills: activeSkills([damageAbility('d', 50, 3)]),
            });
            const single = simulateDPS({
                ...baseInput,
                shipSkills: activeSkills([damageAbility('d', 150)]),
            });
            expect(multiHit.rounds[0].directDamage).toBe(single.rounds[0].directDamage);
        });
    });

    describe('extend-dot abilities (via shipSkills)', () => {
        const damageAbility = (id: string, multiplier: number): Ability => ({
            id,
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier },
        });
        const dotAbility = (
            id: string,
            dotType: 'corrosion' | 'inferno' | 'bomb',
            tier: number,
            duration: number
        ): Ability => ({
            id,
            type: 'dot',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'dot', dotType, tier, stacks: 1, duration },
        });
        const extendDotAbility = (id: string, turns: number): Ability => ({
            id,
            type: 'extend-dot',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'extend-dot', turns },
        });

        // Active applies a Corrosion DoT every round; Charged fires on rounds 3, 6 (chargeCount 2).
        const skills = (dot: Ability, charged: Ability[]): ShipSkills => ({
            slots: [
                { slot: 'active', abilities: [damageAbility('a', 100), dot] },
                { slot: 'charged', abilities: charged },
            ],
        });
        const base = { ...baseInput, enemyHp: 500000, rounds: 8, chargeCount: 2 };

        it('extending a ticking DoT (Corrosion) increases total damage', () => {
            const corrosion = dotAbility('cd', 'corrosion', 9, 2);
            const withExtend = simulateDPS({
                ...base,
                shipSkills: skills(corrosion, [damageAbility('c', 200), extendDotAbility('e', 1)]),
            });
            const noExtend = simulateDPS({
                ...base,
                shipSkills: skills(corrosion, [damageAbility('c', 200)]),
            });
            expect(withExtend.summary.totalDamage).toBeGreaterThan(noExtend.summary.totalDamage);
        });

        it('a self-crit chanceFromCritPower extend applies at full crit, not at zero crit', () => {
            const corrosion = dotAbility('cd', 'corrosion', 9, 2);
            const critExtend: Ability = {
                id: 'ce',
                type: 'extend-dot',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [{ subject: 'self-crit', derivable: true }],
                config: { type: 'extend-dot', turns: 1, chanceFromCritPower: true },
            };
            const skillsWith = (extra: Ability[]): ShipSkills => ({
                slots: [
                    { slot: 'active', abilities: [damageAbility('a', 100), corrosion, ...extra] },
                ],
            });
            // crit 100 + critDamage 150 → p = 1 → extension always applies → more Corrosion ticks.
            const withExtend = simulateDPS({
                ...base,
                crit: 100,
                critDamage: 150,
                shipSkills: skillsWith([critExtend]),
            });
            const noExtend = simulateDPS({
                ...base,
                crit: 100,
                critDamage: 150,
                shipSkills: skillsWith([]),
            });
            expect(withExtend.summary.totalCorrosionDamage).toBeGreaterThan(
                noExtend.summary.totalCorrosionDamage
            );
            // crit 0 → p = 0 → extension never applies.
            const zeroCrit = simulateDPS({
                ...base,
                crit: 0,
                critDamage: 150,
                shipSkills: skillsWith([critExtend]),
            });
            const zeroCritNoExtend = simulateDPS({
                ...base,
                crit: 0,
                critDamage: 150,
                shipSkills: skillsWith([]),
            });
            expect(zeroCrit.summary.totalCorrosionDamage).toBe(
                zeroCritNoExtend.summary.totalCorrosionDamage
            );
        });

        it('applies a chanceFromCritPower extend that lives on the PASSIVE slot (Valerian)', () => {
            const corrosion = dotAbility('cd', 'corrosion', 9, 2);
            const critExtend: Ability = {
                id: 'ce',
                type: 'extend-dot',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [{ subject: 'self-crit', derivable: true }],
                config: { type: 'extend-dot', turns: 1, chanceFromCritPower: true },
            };
            // Active applies Corrosion every round; the extension sits on the passive slot.
            const withPassiveExtend: ShipSkills = {
                slots: [
                    { slot: 'active', abilities: [damageAbility('a', 100), corrosion] },
                    { slot: 'passive', abilities: [critExtend] },
                ],
            };
            const noExtend: ShipSkills = {
                slots: [
                    { slot: 'active', abilities: [damageAbility('a', 100), corrosion] },
                    { slot: 'passive', abilities: [] },
                ],
            };
            const withE = simulateDPS({
                ...base,
                crit: 100,
                critDamage: 150,
                shipSkills: withPassiveExtend,
            });
            const noE = simulateDPS({
                ...base,
                crit: 100,
                critDamage: 150,
                shipSkills: noExtend,
            });
            expect(withE.summary.totalCorrosionDamage).toBeGreaterThan(
                noE.summary.totalCorrosionDamage
            );
        });

        it('does not extend Bombs — one-shot detonation total is unchanged', () => {
            const bomb = dotAbility('bd', 'bomb', 100, 2);
            const withExtend = simulateDPS({
                ...base,
                shipSkills: skills(bomb, [damageAbility('c', 200), extendDotAbility('e', 1)]),
            });
            const noExtend = simulateDPS({
                ...base,
                shipSkills: skills(bomb, [damageAbility('c', 200)]),
            });
            expect(withExtend.summary.totalDamage).toBe(noExtend.summary.totalDamage);
        });

        it('detonate-dot consumes active Inferno and pays it out as detonation damage', () => {
            const inferno = dotAbility('id', 'inferno', 15, 3);
            const detonate: Ability = {
                id: 'det',
                type: 'detonate-dot',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'detonate-dot', dotType: 'inferno', powerPct: 180 },
            };
            const withDetonate = simulateDPS({
                ...base,
                shipSkills: skills(inferno, [damageAbility('c', 200), detonate]),
            });
            const noDetonate = simulateDPS({
                ...base,
                shipSkills: skills(inferno, [damageAbility('c', 200)]),
            });
            // Detonation pays out remaining Inferno at once → more total + a detonationDamage spike.
            expect(withDetonate.summary.totalDetonationDamage).toBeGreaterThan(0);
            expect(withDetonate.summary.totalDamage).toBeGreaterThan(
                noDetonate.summary.totalDamage
            );
            // The round the charged skill fires (round 3, chargeCount 2) consumes Inferno stacks.
            expect(withDetonate.rounds[2].detonationDamage).toBeGreaterThan(0);
            expect(withDetonate.rounds[2].activeInfernoStacks).toBe(0);
        });
    });

    describe('no-crit damage (via shipSkills)', () => {
        const damage = (noCrit?: boolean): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'd',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'damage',
                                multiplier: 100,
                                ...(noCrit ? { noCrit } : {}),
                            },
                        },
                    ],
                },
            ],
        });

        it('a "cannot critically hit" attack applies no crit multiplier', () => {
            // baseInput: crit 100, critDamage 150 → normal crit multiplier 2.5×.
            const withCrit = simulateDPS({ ...baseInput, shipSkills: damage() });
            const noCrit = simulateDPS({ ...baseInput, shipSkills: damage(true) });
            expect(withCrit.rounds[0].directDamage).toBeGreaterThan(noCrit.rounds[0].directDamage);
            // No-crit damage equals the same attack with crit rate 0 (crit multiplier 1×).
            const crit0 = simulateDPS({ ...baseInput, crit: 0, shipSkills: damage() });
            expect(noCrit.rounds[0].directDamage).toBe(crit0.rounds[0].directDamage);
        });
    });

    describe('deterministic crit schedule', () => {
        it('crit 50 / critDamage 100 doubles damage on exactly half the active rounds', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                crit: 50,
                critDamage: 100,
                activeMultiplier: 100,
                chargeCount: 0,
                enemyDefense: 0,
                rounds: 10,
            });
            const damages = result.rounds.map((r) => r.directDamage);
            // accumulator: rounds 2,4,6,8,10 crit (acc reaches 1 on even rounds)
            expect(result.rounds.map((r) => r.didCrit)).toEqual([
                false,
                true,
                false,
                true,
                false,
                true,
                false,
                true,
                false,
                true,
            ]);
            expect(damages.filter((d) => d === 20000)).toHaveLength(5);
            expect(damages.filter((d) => d === 10000)).toHaveLength(5);
        });

        it('charged hits crit at the crit rate regardless of cadence (per-stream, no aliasing)', () => {
            // 50% crit + charged every 2nd round: with a single accumulator the charged
            // hit would ALWAYS or NEVER crit; per-stream guarantees half do.
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                crit: 50,
                critDamage: 100,
                activeMultiplier: 100,
                chargedMultiplier: 300,
                chargeCount: 1,
                enemyDefense: 0,
                rounds: 12,
            });
            const charged = result.rounds.filter((r) => r.action === 'charged');
            expect(charged.length).toBeGreaterThanOrEqual(5);
            const crits = charged.filter((r) => r.didCrit).length;
            expect(crits).toBe(Math.floor(charged.length / 2));
        });

        it('noCrit damage never crits and consumes no crit charge', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                crit: 100,
                critDamage: 100,
                chargeCount: 0,
                enemyDefense: 0,
                rounds: 4,
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                {
                                    id: 'd1',
                                    type: 'damage',
                                    target: 'enemy',
                                    trigger: 'on-cast',
                                    conditions: [],
                                    config: { type: 'damage', multiplier: 100, noCrit: true },
                                },
                            ],
                        },
                    ],
                },
            });
            expect(result.rounds.every((r) => !r.didCrit)).toBe(true);
            expect(result.rounds.every((r) => r.directDamage === 10000)).toBe(true);
        });

        it('crit 100 / critDamage 0 stays multiplier 1 (existing convention unchanged)', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                crit: 100,
                critDamage: 0,
                activeMultiplier: 100,
                chargeCount: 0,
                enemyDefense: 0,
                rounds: 3,
            });
            expect(result.rounds.every((r) => r.didCrit)).toBe(true);
            expect(result.rounds.every((r) => r.directDamage === 10000)).toBe(true);
        });
    });

    describe('deterministic debuff landing', () => {
        it('50% landing chance lands DoTs on exactly half the rounds, evenly spaced', () => {
            // hacking 150 vs security 100 → 50% landing chance
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                crit: 100,
                critDamage: 0,
                activeMultiplier: 100,
                chargeCount: 0,
                enemyDefense: 0,
                hacking: 150,
                enemySecurity: 100,
                rounds: 10,
                activeDoTs: [{ id: 'd', type: 'corrosion', tier: 6, stacks: 1, duration: 1 }],
            });
            const landedRounds = result.rounds.map((r) => r.dotsLanded);
            // back-loaded accumulator at rate 0.5: lands on even rounds
            expect(landedRounds).toEqual([
                false,
                true,
                false,
                true,
                false,
                true,
                false,
                true,
                false,
                true,
            ]);
        });

        it('is reproducible: two identical runs give identical totals', () => {
            const input = {
                ...baseInput,
                attack: 10000,
                crit: 37,
                critDamage: 150,
                activeMultiplier: 100,
                chargeCount: 0,
                enemyDefense: 0,
                hacking: 173,
                enemySecurity: 100,
                rounds: 30,
                // DoTs so the partial landing chance (0.73) actually feeds the summary —
                // exercises BOTH the crit and landing accumulators, not just crit.
                activeDoTs: [
                    { id: 'd', type: 'corrosion' as const, tier: 6, stacks: 1, duration: 2 },
                ],
            };
            expect(simulateDPS(input).summary).toEqual(simulateDPS(input).summary);
        });
    });

    describe('hard condition gating of payload abilities', () => {
        const gatedDamageSkills = (conditions: Condition[]): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'd1',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions,
                            config: { type: 'damage', multiplier: 100 },
                        },
                    ],
                },
            ],
        });

        it('a failing gate zeroes the damage ability', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                crit: 100,
                critDamage: 0,
                chargeCount: 0,
                enemyDefense: 0,
                rounds: 3,
                shipSkills: gatedDamageSkills([{ subject: 'enemy-debuff', derivable: true }]),
            });
            expect(result.rounds.every((r) => r.directDamage === 0)).toBe(true);
        });

        it('an execute gate (enemy below 50% HP) switches on once enough damage accumulates', () => {
            // 10k dmg/round vs 40k enemy HP. enemyHpPct ENTERING each round (from damage
            // through previous rounds): r1=100, r2=75, r3=50, r4=25. 'below 50' (strict <)
            // first passes entering round 4. So rounds 1-3 deal 10000, rounds 4+ deal 15000
            // (base + 10% of 50000 HP secondary, both ×1 with critDamage 0).
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                crit: 100,
                critDamage: 0,
                chargeCount: 0,
                enemyDefense: 0,
                enemyHp: 40000,
                rounds: 6,
                hp: 50000,
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                {
                                    id: 'base',
                                    type: 'damage',
                                    target: 'enemy',
                                    trigger: 'on-cast',
                                    conditions: [],
                                    config: { type: 'damage', multiplier: 100 },
                                },
                                {
                                    id: 'exec',
                                    type: 'additional-damage',
                                    target: 'enemy',
                                    trigger: 'on-cast',
                                    conditions: [
                                        {
                                            subject: 'hp-threshold',
                                            derivable: true,
                                            hpComparator: 'below',
                                            hpPercent: 50,
                                        },
                                    ],
                                    config: { type: 'additional-damage', stat: 'hp', pct: 10 },
                                },
                            ],
                        },
                    ],
                },
            });
            const damages = result.rounds.map((r) => r.directDamage);
            expect(damages).toEqual([10000, 10000, 10000, 15000, 15000, 15000]);
            // Entering-round enemy HP% (drives the gate, surfaced in the chart tooltip):
            // 100, 75, 50, 25, then floored at 0 once cumulative (45k) exceeds the 40k pool.
            expect(result.rounds.map((r) => r.enemyHpPct)).toEqual([100, 75, 50, 25, 0, 0]);
        });

        it('a fresh same-cast dot satisfies a LATER damage gate but not an EARLIER one (text order)', () => {
            const skills = (order: 'dot-first' | 'damage-first'): ShipSkills => {
                const dmg: Ability = {
                    id: 'd',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [{ subject: 'enemy-debuff', derivable: true }],
                    config: { type: 'damage', multiplier: 100 },
                };
                const dotAb: Ability = {
                    id: 'c',
                    type: 'dot',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'dot', dotType: 'corrosion', tier: 6, stacks: 1, duration: 2 },
                };
                return {
                    slots: [
                        {
                            slot: 'active',
                            abilities: order === 'dot-first' ? [dotAb, dmg] : [dmg, dotAb],
                        },
                    ],
                };
            };
            const base = {
                ...baseInput,
                attack: 10000,
                crit: 100,
                critDamage: 0,
                chargeCount: 0,
                enemyDefense: 0,
                rounds: 1,
            };
            expect(
                simulateDPS({ ...base, shipSkills: skills('dot-first') }).rounds[0].directDamage
            ).toBe(10000);
            expect(
                simulateDPS({ ...base, shipSkills: skills('damage-first') }).rounds[0].directDamage
            ).toBe(0);
        });

        it('gated-off dot abilities apply nothing (and do not feed the overlay)', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                crit: 100,
                critDamage: 0,
                chargeCount: 0,
                enemyDefense: 0,
                rounds: 3,
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                {
                                    id: 'c',
                                    type: 'dot',
                                    target: 'enemy',
                                    trigger: 'on-cast',
                                    conditions: [
                                        {
                                            subject: 'self-buff',
                                            derivable: true,
                                            buffName: 'Stealth',
                                        },
                                    ], // no Stealth → fail
                                    config: {
                                        type: 'dot',
                                        dotType: 'corrosion',
                                        tier: 6,
                                        stacks: 2,
                                        duration: 3,
                                    },
                                },
                                // damage gated on enemy-debuff: the DROPPED dot must NOT satisfy it
                                {
                                    id: 'd',
                                    type: 'damage',
                                    target: 'enemy',
                                    trigger: 'on-cast',
                                    conditions: [{ subject: 'enemy-debuff', derivable: true }],
                                    config: { type: 'damage', multiplier: 100 },
                                },
                            ],
                        },
                    ],
                },
            });
            expect(result.rounds.every((r) => r.corrosionDamage === 0)).toBe(true);
            expect(result.rounds.every((r) => r.activeCorrosionStacks === 0)).toBe(true);
            expect(result.rounds[0].directDamage).toBe(0); // dropped dot didn't feed the overlay
        });

        it('gated-off detonate-dot abilities contribute no detonation damage', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                crit: 100,
                critDamage: 0,
                chargeCount: 0,
                enemyDefense: 0,
                rounds: 3,
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                // ungated dot so there IS something detonatable each round
                                {
                                    id: 'c',
                                    type: 'dot',
                                    target: 'enemy',
                                    trigger: 'on-cast',
                                    conditions: [],
                                    config: {
                                        type: 'dot',
                                        dotType: 'corrosion',
                                        tier: 6,
                                        stacks: 2,
                                        duration: 3,
                                    },
                                },
                                // detonate gated on a never-met condition → must contribute nothing
                                {
                                    id: 'det',
                                    type: 'detonate-dot',
                                    target: 'enemy',
                                    trigger: 'on-cast',
                                    conditions: [
                                        {
                                            subject: 'self-buff',
                                            derivable: true,
                                            buffName: 'Stealth',
                                        },
                                    ],
                                    config: {
                                        type: 'detonate-dot',
                                        dotType: 'corrosion',
                                        powerPct: 100,
                                    },
                                },
                            ],
                        },
                    ],
                },
            });
            // The gated-off detonation never consumes the DoT: zero detonation damage and
            // corrosion keeps ticking (nonzero from round 2, once round-1 stacks tick).
            expect(result.rounds.every((r) => r.detonationDamage === 0)).toBe(true);
            expect(result.rounds[0].activeCorrosionStacks).toBeGreaterThan(0);
        });

        it('per-buff defPen modifier counts live timeline buffs and equals flat pen (Thresh)', () => {
            // Thresh R2 passive: "gains 7.5% defense penetration for each buff it has,
            // up to a max of 45%". The count is the round's active self-buffs from the
            // buff timeline — proven by equivalence with a flat defensePenetration input.
            const threshSkills: ShipSkills = {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'a',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 240 },
                            },
                        ],
                    },
                    {
                        slot: 'passive',
                        abilities: [
                            {
                                id: 'pen',
                                type: 'modifier',
                                target: 'self',
                                trigger: 'on-cast',
                                conditions: [{ subject: 'self-buff', derivable: true }],
                                scaling: { conditionIndex: 0, perUnit: 7.5, cap: 45 },
                                config: {
                                    type: 'modifier',
                                    channel: 'defensePenetration',
                                    value: 0,
                                    isMultiplicative: false,
                                },
                            },
                        ],
                    },
                ],
            };
            const base = {
                ...baseInput,
                attack: 10000,
                crit: 100,
                critDamage: 0,
                chargeCount: 0,
                enemyDefense: 12000, // nonzero so penetration matters
                rounds: 4,
                shipSkills: threshSkills,
            };
            const buffs = (n: number) =>
                Array.from({ length: n }, (_, i) => makeAlwaysBuff(`b${i}`, {}));
            const withPen = (pen: number) =>
                simulateDPS({
                    ...base,
                    shipSkills: {
                        slots: [threshSkills.slots[0]], // damage only, no modifier
                    },
                    defensePenetration: pen,
                }).summary.totalDamage;

            // 0 buffs → no pen; 2 buffs → 15; 8 buffs → capped at 45 (not 60)
            expect(simulateDPS({ ...base, selfBuffs: buffs(0) }).summary.totalDamage).toBe(
                withPen(0)
            );
            expect(simulateDPS({ ...base, selfBuffs: buffs(2) }).summary.totalDamage).toBe(
                withPen(15)
            );
            expect(simulateDPS({ ...base, selfBuffs: buffs(8) }).summary.totalDamage).toBe(
                withPen(45)
            );
            // sanity: pen actually changes the outcome
            expect(withPen(15)).toBeGreaterThan(withPen(0));
        });

        it('HP-proportional modifier shrinks as the enemy pool depletes (Akula)', () => {
            // Akula passive: "+up to 30% outgoing damage based on the target's CURRENT
            // HP%" → modifier scaling 0.3/HP-point, cap 30, on enemy-hp-pct.
            // 30k pool, base hit 10000:
            //  r1: hp 100%   → +30%   → 13000   (cum 13000)
            //  r2: hp 56.67% → +17%   → 11700   (cum 24700)
            //  r3: hp 17.67% → +5.3%  → 10530   (cum 35230 ≥ pool)
            //  r4+: hp 0%    → +0%    → 10000
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                crit: 100,
                critDamage: 0,
                chargeCount: 0,
                enemyDefense: 0,
                enemyHp: 30000,
                rounds: 5,
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                {
                                    id: 'a',
                                    type: 'damage',
                                    target: 'enemy',
                                    trigger: 'on-cast',
                                    conditions: [],
                                    config: { type: 'damage', multiplier: 100 },
                                },
                            ],
                        },
                        {
                            slot: 'passive',
                            abilities: [
                                {
                                    id: 'akula-mod',
                                    type: 'modifier',
                                    target: 'self',
                                    trigger: 'on-cast',
                                    conditions: [{ subject: 'enemy-hp-pct', derivable: true }],
                                    scaling: { conditionIndex: 0, perUnit: 0.3, cap: 30 },
                                    config: {
                                        type: 'modifier',
                                        channel: 'outgoingDamage',
                                        value: 0,
                                        isMultiplicative: true,
                                    },
                                },
                            ],
                        },
                    ],
                },
            });
            expect(result.rounds.map((r) => r.directDamage)).toEqual([
                13000, 11700, 10530, 10000, 10000,
            ]);
        });

        it('passive-slot damage hits fire when their gate passes (Judge)', () => {
            // Judge passive: "At the start of the round, this Unit deals 60% damage to
            // all enemies with less than 50% HP." Active: plain 230%.
            // 23k/round vs 100k pool → entering HP%: 100, 77, 54, 31(<50!), ...
            // Passive fires from round 4: 23000 + 6000 = 29000.
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                crit: 100,
                critDamage: 0,
                chargeCount: 0,
                enemyDefense: 0,
                enemyHp: 100000,
                rounds: 6,
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                {
                                    id: 'a',
                                    type: 'damage',
                                    target: 'enemy',
                                    trigger: 'on-cast',
                                    conditions: [],
                                    config: { type: 'damage', multiplier: 230 },
                                },
                            ],
                        },
                        {
                            slot: 'passive',
                            abilities: [
                                {
                                    id: 'p',
                                    type: 'damage',
                                    target: 'all-enemies',
                                    trigger: 'on-cast',
                                    conditions: [
                                        {
                                            subject: 'hp-threshold',
                                            derivable: true,
                                            hpComparator: 'below',
                                            hpPercent: 50,
                                        },
                                    ],
                                    config: { type: 'damage', multiplier: 60 },
                                },
                            ],
                        },
                    ],
                },
            });
            const damages = result.rounds.map((r) => r.directDamage);
            // entering HP%: 100, 77, 54, 31, 2, 0 → passive fires rounds 4-6
            expect(damages).toEqual([23000, 23000, 23000, 29000, 29000, 29000]);
        });

        it('a scaling-source condition does NOT gate the base damage (Meiying)', () => {
            // "dealing 190% damage, and when attacking a Supporter, it additionally deals
            // 90% damage" — the +90% is Supporter-only, but the 190% base hits everyone.
            const meiyingSkills: ShipSkills = {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'd',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [
                                    {
                                        subject: 'enemy-type',
                                        derivable: true,
                                        requiredEnemyType: 'Supporter',
                                    },
                                ],
                                scaling: { conditionIndex: 0, perUnit: 90 },
                                config: { type: 'damage', multiplier: 190 },
                            },
                        ],
                    },
                ],
            };
            const base = {
                ...baseInput,
                attack: 10000,
                crit: 100,
                critDamage: 0,
                chargeCount: 0,
                enemyDefense: 0,
                rounds: 2,
                shipSkills: meiyingSkills,
            };
            // Non-Supporter enemy: base 190% fires, +90% bonus does not.
            const vsAttacker = simulateDPS({ ...base, enemyType: 'Attacker' });
            expect(vsAttacker.rounds[0].directDamage).toBe(19000);
            // Unknown enemy type (the page default): same — base damage fires.
            const vsUnknown = simulateDPS({ ...base, enemyType: undefined });
            expect(vsUnknown.rounds[0].directDamage).toBe(19000);
            // Supporter: base + bonus.
            const vsSupporter = simulateDPS({ ...base, enemyType: 'Supporter' });
            expect(vsSupporter.rounds[0].directDamage).toBe(28000);
        });
    });
});
