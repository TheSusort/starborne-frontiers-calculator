import { describe, it, expect } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { DEFAULT_DOT_CONFIG } from '../../../types/calculator';

describe('simulateDPS', () => {
    const baseInput = {
        attack: 15000,
        crit: 100,
        critDamage: 150,
        defensePenetration: 0,
        activeMultiplier: 100,
        chargedMultiplier: 0,
        chargeCount: 0,
        activeDoTs: { ...DEFAULT_DOT_CONFIG },
        chargedDoTs: { ...DEFAULT_DOT_CONFIG },
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
        it('accumulates stacks and ticks each round', () => {
            const result = simulateDPS({
                ...baseInput,
                activeDoTs: { ...DEFAULT_DOT_CONFIG, corrosionTier: 3, corrosionStacks: 1 },
                rounds: 3,
            });
            expect(result.rounds[0].corrosionDamage).toBe(15000);
            expect(result.rounds[0].activeCorrosionStacks).toBe(1);
            expect(result.rounds[1].corrosionDamage).toBe(30000);
            expect(result.rounds[1].activeCorrosionStacks).toBe(2);
            expect(result.rounds[2].corrosionDamage).toBe(45000);
        });

        it('is not affected by enemy defense', () => {
            const noDef = simulateDPS({
                ...baseInput,
                enemyDefense: 0,
                activeDoTs: { ...DEFAULT_DOT_CONFIG, corrosionTier: 6, corrosionStacks: 2 },
                rounds: 1,
            });
            const withDef = simulateDPS({
                ...baseInput,
                enemyDefense: 15000,
                activeDoTs: { ...DEFAULT_DOT_CONFIG, corrosionTier: 6, corrosionStacks: 2 },
                rounds: 1,
            });
            expect(noDef.rounds[0].corrosionDamage).toBe(withDef.rounds[0].corrosionDamage);
        });
    });

    describe('inferno', () => {
        it('deals damage based on attacker attack per stack', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: { ...DEFAULT_DOT_CONFIG, infernoTier: 30, infernoStacks: 1 },
                rounds: 2,
            });
            expect(result.rounds[0].infernoDamage).toBe(3000);
            expect(result.rounds[1].infernoDamage).toBe(6000);
        });

        it('scales with attack buff but not outgoing damage buff', () => {
            const withAtkBuff = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: { ...DEFAULT_DOT_CONFIG, infernoTier: 30, infernoStacks: 1 },
                buffs: [{ id: '1', stat: 'attack', value: 50 }],
                rounds: 1,
            });
            expect(withAtkBuff.rounds[0].infernoDamage).toBe(4500);

            const withOutgoingBuff = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: { ...DEFAULT_DOT_CONFIG, infernoTier: 30, infernoStacks: 1 },
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
                activeDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    bombTier: 100,
                    bombStacks: 1,
                    bombCountdown: 2,
                },
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
                activeDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    bombTier: 200,
                    bombStacks: 1,
                    bombCountdown: 1,
                },
                rounds: 1,
            });
            const withDef = simulateDPS({
                ...baseInput,
                attack: 10000,
                enemyDefense: 15000,
                activeDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    bombTier: 200,
                    bombStacks: 1,
                    bombCountdown: 1,
                },
                rounds: 1,
            });
            expect(noDef.rounds[0].bombDamage).toBe(withDef.rounds[0].bombDamage);
        });
    });

    describe('mixed DoTs on active vs charged', () => {
        it('applies correct DoT config based on action type', () => {
            const result = simulateDPS({
                ...baseInput,
                activeMultiplier: 100,
                chargedMultiplier: 200,
                chargeCount: 2,
                activeDoTs: { ...DEFAULT_DOT_CONFIG, infernoTier: 15, infernoStacks: 1 },
                chargedDoTs: { ...DEFAULT_DOT_CONFIG, corrosionTier: 9, corrosionStacks: 3 },
                rounds: 3,
            });
            expect(result.rounds[0].activeInfernoStacks).toBe(1);
            expect(result.rounds[0].activeCorrosionStacks).toBe(0);
            expect(result.rounds[1].activeInfernoStacks).toBe(2);
            expect(result.rounds[1].activeCorrosionStacks).toBe(0);
            expect(result.rounds[2].action).toBe('charged');
            expect(result.rounds[2].activeInfernoStacks).toBe(2);
            expect(result.rounds[2].activeCorrosionStacks).toBe(3);
        });

        it('calculates mixed-tier corrosion damage correctly', () => {
            const result = simulateDPS({
                ...baseInput,
                activeMultiplier: 100,
                chargedMultiplier: 200,
                chargeCount: 2,
                enemyHp: 100000,
                activeDoTs: { ...DEFAULT_DOT_CONFIG, corrosionTier: 3, corrosionStacks: 1 },
                chargedDoTs: { ...DEFAULT_DOT_CONFIG, corrosionTier: 9, corrosionStacks: 1 },
                rounds: 4,
            });
            expect(result.rounds[0].corrosionDamage).toBe(3000);
            expect(result.rounds[1].corrosionDamage).toBe(6000);
            expect(result.rounds[2].corrosionDamage).toBe(15000);
            expect(result.rounds[3].corrosionDamage).toBe(18000);
        });
    });

    describe('round 1 DoT ticking', () => {
        it('DoTs deal damage on the turn they are applied', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: { ...DEFAULT_DOT_CONFIG, infernoTier: 30, infernoStacks: 2 },
                rounds: 1,
            });
            expect(result.rounds[0].infernoDamage).toBe(6000);
        });
    });
});
