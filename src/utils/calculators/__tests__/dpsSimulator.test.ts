import { describe, it, expect } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { flatInputToAbilities } from '../../abilities/flatInputToAbilities';
import { SelectedGameBuff, ParsedBuffEffects } from '../../../types/calculator';
import { Ability, ShipSkills } from '../../../types/abilities';

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

        it('skips charging when an explicit charged damage ability has multiplier 0', () => {
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
            expect(result.rounds.every((r) => r.action === 'active')).toBe(true);
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
            // effectiveCrit = min(75, 100-25) = 75; critMult = 1 + 0.75*150/100 = 2.125
            // directDamage = 15000 * 2.125 * 0.75 = 23906.25; total ≈ 71719 (±1 rounding)
            expect(Math.abs(result.summary.totalDamage - 71719)).toBeLessThanOrEqual(1);
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

        it('charge-scoped enemy debuff fires on the source ship charge rounds', () => {
            // sourceChargeCount=2, sourceStartCharged=false → charge rounds are 3, 6
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
            // round 1: count 0 → preCrit 1000; round 2: count 1 → 1200; round 3: count 2 → 1400
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
});
