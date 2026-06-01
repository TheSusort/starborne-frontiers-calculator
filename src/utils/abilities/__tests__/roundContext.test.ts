import { describe, it, expect } from 'vitest';
import { buildRoundContext } from '../roundContext';

describe('buildRoundContext', () => {
    it('sums enemyDebuffCount from landed + corrosion + inferno + bomb entry counts', () => {
        const ctx = buildRoundContext({
            selfBuffNames: [],
            landedEnemyDebuffCount: 2,
            corrosionEntryCount: 1,
            infernoEntryCount: 0,
            bombCount: 1,
            effectiveCritRate: 50,
        });
        expect(ctx.enemyDebuffCount).toBe(4);
    });

    it('passes through selfBuffNames, effectiveCritRate, and enemyType', () => {
        const ctx = buildRoundContext({
            selfBuffNames: ['Rally', 'Focus'],
            landedEnemyDebuffCount: 0,
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            effectiveCritRate: 73,
            enemyType: 'Defender',
        });
        expect(ctx.selfBuffNames).toEqual(['Rally', 'Focus']);
        expect(ctx.effectiveCritRate).toBe(73);
        expect(ctx.enemyType).toBe('Defender');
    });

    it('applies DPS-assumption static defaults', () => {
        const ctx = buildRoundContext({
            selfBuffNames: [],
            landedEnemyDebuffCount: 0,
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            effectiveCritRate: 0,
        });
        expect(ctx.selfDebuffNames).toEqual([]);
        expect(ctx.enemyBuffNames).toEqual([]);
        expect(ctx.adjacentAllyCount).toBe(0);
        expect(ctx.enemyAdjacentCount).toBe(0);
        expect(ctx.enemyDestroyedCount).toBe(0);
        expect(ctx.selfHpPct).toBe(100);
        expect(ctx.enemyHpPct).toBe(100);
    });

    it('leaves enemyType undefined when not provided', () => {
        const ctx = buildRoundContext({
            selfBuffNames: [],
            landedEnemyDebuffCount: 0,
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            effectiveCritRate: 0,
        });
        expect(ctx.enemyType).toBeUndefined();
    });
});
