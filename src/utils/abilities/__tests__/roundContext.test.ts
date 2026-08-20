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
        // SP-4d: enemyHpPct is no longer a DPS-assumption default — see the dedicated
        // "absent enemy/target readings stay absent" test below.
        expect(ctx.enemyHpPct).toBeUndefined();
        expect(ctx.selfCritPower).toBe(0);
    });

    it('passes through selfCritPower when provided (sub-project I, PR I4a)', () => {
        const ctx = buildRoundContext({
            selfBuffNames: [],
            landedEnemyDebuffCount: 0,
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            effectiveCritRate: 0,
            selfCritPower: 150,
        });
        expect(ctx.selfCritPower).toBe(150);
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

    it('threads roundCrit through, leaving it undefined when omitted', () => {
        const base = {
            selfBuffNames: [],
            landedEnemyDebuffCount: 0,
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            effectiveCritRate: 50,
        };
        expect(buildRoundContext(base).roundCrit).toBeUndefined();
        const ctx = buildRoundContext({ ...base, roundCrit: true, enemyHpPct: 40 });
        expect(ctx.roundCrit).toBe(true);
        expect(ctx.enemyHpPct).toBe(40);
    });

    it('SP-4d: absent enemy/target readings stay absent — no phantom is materialised here', () => {
        // This file is the SECOND fabrication layer (spec §3.2). While it filled these in eagerly,
        // evaluateConditions never saw an absent value through the real funnel, so a fix applied
        // only there would have passed its own unit tests and changed nothing in a fight.
        const base = {
            selfBuffNames: [],
            landedEnemyDebuffCount: 0,
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            effectiveCritRate: 50,
        };
        const ctx = buildRoundContext(base);
        expect(ctx.enemyHpPct).toBeUndefined();
        expect(ctx.targetCritPower).toBeUndefined();
        expect(ctx.targetSpeed).toBeUndefined();
        expect(ctx.targetCurrentHp).toBeUndefined();
        expect(ctx.enemiesHitThisCast).toBeUndefined();
    });

    it('SP-4d: a supplied reading still passes through untouched', () => {
        const base = {
            selfBuffNames: [],
            landedEnemyDebuffCount: 0,
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            effectiveCritRate: 50,
        };
        const ctx = buildRoundContext({
            ...base,
            enemyHpPct: 40,
            targetCritPower: 150,
            targetSpeed: 90,
            targetCurrentHp: 5000,
            enemiesHitThisCast: 3,
        });
        expect(ctx.enemyHpPct).toBe(40);
        expect(ctx.targetCritPower).toBe(150);
        expect(ctx.targetSpeed).toBe(90);
        expect(ctx.targetCurrentHp).toBe(5000);
        expect(ctx.enemiesHitThisCast).toBe(3);
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

    describe('enemyDebuffNames sentinel (sub-project I, PR I1 — DPS-parity invariant)', () => {
        const base = {
            selfBuffNames: [],
            landedEnemyDebuffCount: 2,
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            effectiveCritRate: 0,
        };

        it('omitting enemyDebuffNames leaves it undefined on the returned context (DPS-simulator path)', () => {
            const ctx = buildRoundContext(base);
            expect(ctx.enemyDebuffNames).toBeUndefined();
            // the key must not even exist on the object (not an explicit `undefined` value) —
            // guards against a future refactor accidentally materializing the sentinel as `[]`.
            expect(Object.prototype.hasOwnProperty.call(ctx, 'enemyDebuffNames')).toBe(false);
        });

        it('passing a real (possibly empty) array threads it through untouched', () => {
            expect(buildRoundContext({ ...base, enemyDebuffNames: [] }).enemyDebuffNames).toEqual(
                []
            );
            expect(
                buildRoundContext({ ...base, enemyDebuffNames: ['Stasis', 'Stasis'] })
                    .enemyDebuffNames
            ).toEqual(['Stasis', 'Stasis']);
        });
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

    // SP-E, Task E2: `genericCount`/`enemyDotFamilyCounts` thread through the drain-time
    // (reactive) condition context the same way the four playerTurn.ts buildRoundContext calls
    // do — a foreign-caster aura or a drain-time reactive gated on a named DoT family (or the
    // bare enemy-dot-count subject) must see the SAME live counts a local cast-path gate does.
    it('threads genericCount into enemyDotCount and enemyDotFamilyCounts through untouched', () => {
        const ctx = buildActorConditionContext(makeStatusEngine() as never, 'attacker', {
            ...sharedBase,
            corrosionEntryCount: 1,
            infernoEntryCount: 1,
            bombCount: 1,
            genericCount: 2,
            enemyDotFamilyCounts: { 'Acidic Decay': 2 },
        });
        expect(ctx.enemyDotCount).toBe(5);
        expect(ctx.enemyDotFamilyCounts).toEqual({ 'Acidic Decay': 2 });
    });

    it('defaults genericCount to 0 and leaves enemyDotFamilyCounts undefined when omitted', () => {
        const ctx = buildActorConditionContext(makeStatusEngine() as never, 'attacker', {
            ...sharedBase,
            corrosionEntryCount: 1,
            infernoEntryCount: 1,
            bombCount: 1,
        });
        expect(ctx.enemyDotCount).toBe(3);
        expect(ctx.enemyDotFamilyCounts).toBeUndefined();
    });
});
