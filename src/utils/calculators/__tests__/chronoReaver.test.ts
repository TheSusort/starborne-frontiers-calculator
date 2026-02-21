import { describe, it, expect } from 'vitest';
import { simulateChronoReaver } from '../chronoReaver';

describe('simulateChronoReaver', () => {
    describe('no CR (baseline)', () => {
        it('fires charged every N+1 rounds for N charges', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'none',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 10,
            });

            // Without CR: 4 active rounds then 1 charged, repeating
            expect(result.rounds).toHaveLength(10);
            expect(result.rounds[4].action).toBe('charged');
            expect(result.rounds[9].action).toBe('charged');
            expect(result.rounds[0].action).toBe('active');
        });

        it('calculates correct damage totals', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'none',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 5,
            });

            // 4 active (150 each) + 1 charged (350) = 950
            expect(result.rounds[4].totalDamage).toBe(950);
        });
    });

    describe('legendary CR (procs every 2nd turn)', () => {
        it('matches expected pattern for 4 charges', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'legendary',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 7,
            });

            // r1: active -> 1c
            // r2: active -> 2c + CR -> 3c
            // r3: active -> 4c
            // r4: charged -> 0c + CR -> 1c
            // r5: active -> 2c
            // r6: active -> 3c + CR -> 4c
            // r7: charged -> 0c
            expect(result.rounds[0]).toMatchObject({
                action: 'active',
                endCharges: 1,
                crProc: false,
            });
            expect(result.rounds[1]).toMatchObject({
                action: 'active',
                endCharges: 3,
                crProc: true,
            });
            expect(result.rounds[2]).toMatchObject({
                action: 'active',
                endCharges: 4,
                crProc: false,
            });
            expect(result.rounds[3]).toMatchObject({
                action: 'charged',
                endCharges: 1,
                crProc: true,
            });
            expect(result.rounds[4]).toMatchObject({
                action: 'active',
                endCharges: 2,
                crProc: false,
            });
            expect(result.rounds[5]).toMatchObject({
                action: 'active',
                endCharges: 4,
                crProc: true,
            });
            expect(result.rounds[6]).toMatchObject({
                action: 'charged',
                endCharges: 0,
                crProc: false,
            });
        });
    });

    describe('epic CR (procs every 3rd turn)', () => {
        it('matches expected pattern for 4 charges', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'epic',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 8,
            });

            // r1: active -> 1c
            // r2: active -> 2c
            // r3: active -> 3c + CR -> 4c
            // r4: charged -> 0c
            // r5: active -> 1c
            // r6: active -> 2c + CR -> 3c
            // r7: active -> 4c
            // r8: charged -> 0c
            expect(result.rounds[0]).toMatchObject({
                action: 'active',
                endCharges: 1,
                crProc: false,
            });
            expect(result.rounds[1]).toMatchObject({
                action: 'active',
                endCharges: 2,
                crProc: false,
            });
            expect(result.rounds[2]).toMatchObject({
                action: 'active',
                endCharges: 4,
                crProc: true,
            });
            expect(result.rounds[3]).toMatchObject({
                action: 'charged',
                endCharges: 0,
                crProc: false,
            });
            expect(result.rounds[4]).toMatchObject({
                action: 'active',
                endCharges: 1,
                crProc: false,
            });
            expect(result.rounds[5]).toMatchObject({
                action: 'active',
                endCharges: 3,
                crProc: true,
            });
            expect(result.rounds[6]).toMatchObject({
                action: 'active',
                endCharges: 4,
                crProc: false,
            });
            expect(result.rounds[7]).toMatchObject({
                action: 'charged',
                endCharges: 0,
                crProc: false,
            });
        });
    });

    describe('wasted procs', () => {
        it('detects wasted proc when active fills to max on a proc turn', () => {
            // 3 charges, legendary CR
            const result = simulateChronoReaver({
                chargesRequired: 3,
                crRarity: 'legendary',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 9,
            });

            // r1: active -> 1c
            // r2: active -> 2c + CR -> 3c
            // r3: charged -> 0c
            // r4: active -> 1c + CR -> 2c
            // r5: active -> 3c
            // r6: charged -> 0c + CR -> 1c
            // r7: active -> 2c
            // r8: active -> 3c + CR -> WASTED (already at max)
            // r9: charged -> 0c
            expect(result.rounds[7]).toMatchObject({
                action: 'active',
                endCharges: 3,
                crProc: true,
                wastedProc: true,
            });
            expect(result.summary.wastedProcs).toBe(1);
        });
    });

    describe('summary metrics', () => {
        it('calculates avg damage per round', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'none',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 10,
            });

            // 10 rounds: 8 active (150) + 2 charged (350) = 1900 / 10 = 190
            expect(result.summary.avgDamagePerRound).toBe(190);
        });

        it('calculates charged attack frequency', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'legendary',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 7,
            });

            // 2 charged attacks in 7 rounds = every 3.5 rounds
            expect(result.summary.chargedFrequency).toBe(3.5);
        });

        it('calculates DPS increase vs no CR', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'legendary',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 7,
            });

            expect(result.summary.dpsIncreasePercent).toBeGreaterThan(0);
        });

        it('counts total procs and wasted procs', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'legendary',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 7,
            });

            // Legendary procs on r2, r4, r6 = 3 procs in 7 rounds
            expect(result.summary.totalProcs).toBe(3);
            expect(result.summary.wastedProcs).toBe(0);
        });
    });
});
