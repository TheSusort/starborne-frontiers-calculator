import { describe, it, expect } from 'vitest';
import { buildRoundContext } from '../roundContext';
import { buildActorConditionContext } from '../../combat/triggers';

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

    it('threads roundCrit and enemyHpPct through, defaulting enemyHpPct to 100', () => {
        const base = {
            selfBuffNames: [],
            landedEnemyDebuffCount: 0,
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            effectiveCritRate: 50,
        };
        expect(buildRoundContext(base).enemyHpPct).toBe(100);
        expect(buildRoundContext(base).roundCrit).toBeUndefined();
        const ctx = buildRoundContext({ ...base, roundCrit: true, enemyHpPct: 40 });
        expect(ctx.roundCrit).toBe(true);
        expect(ctx.enemyHpPct).toBe(40);
    });

    it('accepts explicit selfHpPct, enemyBuffNames, selfDebuffNames', () => {
        const ctx = buildRoundContext({
            selfBuffNames: [],
            landedEnemyDebuffCount: 0,
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            effectiveCritRate: 0,
            selfHpPct: 40,
            enemyBuffNames: ['Attack Up III'],
            selfDebuffNames: ['Defense Down II'],
        });
        expect(ctx.selfHpPct).toBe(40);
        expect(ctx.enemyBuffNames).toEqual(['Attack Up III']);
        expect(ctx.selfDebuffNames).toEqual(['Defense Down II']);
    });

    it('defaults selfHpPct to 100 and buff/debuff lists to [] when omitted', () => {
        const ctx = buildRoundContext({
            selfBuffNames: [],
            landedEnemyDebuffCount: 0,
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            effectiveCritRate: 0,
        });
        expect(ctx.selfHpPct).toBe(100);
        expect(ctx.enemyBuffNames).toEqual([]);
        expect(ctx.selfDebuffNames).toEqual([]);
    });
});

describe('buildActorConditionContext – condition-context plumbing', () => {
    function makeStatusEngine(selfBuffs: string[] = []) {
        return {
            snapshot: (_ownerId: string) => ({
                activeSelfBuffs: selfBuffs.map((name) => ({ buffName: name })),
                activeEnemyDebuffs: [],
            }),
            timedAbilityStatuses: () => [],
        };
    }

    const sharedBase = {
        corrosionEntryCount: 0,
        infernoEntryCount: 0,
        bombCount: 0,
        enemyHpPct: 100,
    };

    it('threads selfHpPct, enemyBuffNames, selfDebuffNames through to the returned context', () => {
        const ctx = buildActorConditionContext(makeStatusEngine() as never, 'attacker', {
            ...sharedBase,
            selfHpPct: 55,
            enemyBuffNames: ['Attack Up III'],
            selfDebuffNames: ['Defense Down II'],
        });
        expect(ctx.selfHpPct).toBe(55);
        expect(ctx.enemyBuffNames).toEqual(['Attack Up III']);
        expect(ctx.selfDebuffNames).toEqual(['Defense Down II']);
    });

    it('defaults selfHpPct to 100 and lists to [] when omitted from shared', () => {
        const ctx = buildActorConditionContext(makeStatusEngine() as never, 'attacker', sharedBase);
        expect(ctx.selfHpPct).toBe(100);
        expect(ctx.enemyBuffNames).toEqual([]);
        expect(ctx.selfDebuffNames).toEqual([]);
    });
});
