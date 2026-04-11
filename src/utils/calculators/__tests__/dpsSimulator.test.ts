import { describe, it, expect } from 'vitest';
import { simulateDPS } from '../dpsSimulator';

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
        buffs: [],
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
            expect(result.rounds.every((r) => r.bombDamage === 0)).toBe(true);
        });

        it('calculates correct summary totals', () => {
            const result = simulateDPS({ ...baseInput, rounds: 5 });
            const perRound = result.rounds[0].directDamage;
            expect(result.summary.totalDamage).toBe(perRound * 5);
            expect(result.summary.avgDamagePerRound).toBe(perRound);
            expect(result.summary.totalDirectDamage).toBe(perRound * 5);
            expect(result.summary.totalCorrosionDamage).toBe(0);
            expect(result.summary.totalInfernoDamage).toBe(0);
            expect(result.summary.totalBombDamage).toBe(0);
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
                buffs: [{ id: '1', stat: 'attack', value: 50 }],
                rounds: 1,
            });
            expect(withAtkBuff.rounds[0].infernoDamage).toBe(4500);

            const withOutgoingBuff = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: [{ id: '1', type: 'inferno', tier: 30, stacks: 1, duration: 2 }],
                buffs: [{ id: '1', stat: 'outgoingDamage', value: 50 }],
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
            expect(result.rounds[0].bombDamage).toBe(0);
            expect(result.rounds[1].bombDamage).toBe(10000);
            expect(result.rounds[2].bombDamage).toBe(10000);
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
            expect(noDef.rounds[0].bombDamage).toBe(withDef.rounds[0].bombDamage);
        });

        it('scales with attack buff', () => {
            const withAtkBuff = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: [{ id: '1', type: 'bomb', tier: 100, stacks: 1, duration: 1 }],
                buffs: [{ id: '1', stat: 'attack', value: 50 }],
                rounds: 1,
            });
            // effectiveAttack = 10000 * 1.5 = 15000, bomb = 1 * 15000 = 15000
            expect(withAtkBuff.rounds[0].bombDamage).toBe(15000);
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
                buffs: [{ id: '1', stat: 'outgoingDamage', value: 50 }],
                rounds: 1,
            });
            expect(noBuff.rounds[0].bombDamage).toBe(withBuff.rounds[0].bombDamage);
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
});
