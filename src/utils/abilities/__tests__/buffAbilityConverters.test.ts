import { describe, it, expect } from 'vitest';
import { Ability, ShipSkills } from '../../../types/abilities';
import { SelectedGameBuff, ParsedBuffEffects } from '../../../types/calculator';
import {
    abilityToSelectedBuff,
    selectedBuffToAbility,
    buildStaticBuffContext,
    buffAbilitiesToSelectedBuffs,
    selectedBuffsToBuffAbilities,
} from '../buffAbilityConverters';

const effects: ParsedBuffEffects = { attack: 30 };

const buffAbility = (overrides: Partial<Ability> = {}): Ability => ({
    id: 'a1',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Power Up',
        parsedEffects: effects,
        stacks: 2,
        isStackable: true,
        maxStacks: 5,
        stackTrigger: 'per-round',
    },
    ...overrides,
});

const debuffAbility = (overrides: Partial<Ability> = {}): Ability => ({
    id: 'd1',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Weaken',
        parsedEffects: { defense: -30 },
        stacks: 1,
        isStackable: false,
        application: 'apply',
    },
    ...overrides,
});

const damageAbility = (): Ability => ({
    id: 'dmg1',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 1.5 },
});

const gameBuff = (overrides: Partial<SelectedGameBuff> = {}): SelectedGameBuff => ({
    id: 'gb1',
    buffName: 'Power Up',
    stacks: 2,
    parsedEffects: effects,
    isStackable: true,
    ...overrides,
});

describe('abilityToSelectedBuff', () => {
    it('converts a buff ability to a SelectedGameBuff copying core fields', () => {
        const sb = abilityToSelectedBuff(buffAbility());
        expect(sb).not.toBeNull();
        expect(sb!.buffName).toBe('Power Up');
        expect(sb!.stacks).toBe(2);
        expect(sb!.parsedEffects).toEqual(effects);
        expect(sb!.isStackable).toBe(true);
        expect(sb!.maxStacks).toBe(5);
        expect(sb!.stackTrigger).toBe('per-round');
    });

    it('returns null for a non-buff ability', () => {
        expect(abilityToSelectedBuff(damageAbility())).toBeNull();
    });
});

describe('selectedBuffToAbility', () => {
    it('produces a buff ability for a self target', () => {
        const ab = selectedBuffToAbility(gameBuff(), 'self');
        expect(ab.type).toBe('buff');
        expect(ab.target).toBe('self');
        expect(ab.config.type).toBe('buff');
        if (ab.config.type === 'buff') {
            expect(ab.config.buffName).toBe('Power Up');
            expect(ab.config.stacks).toBe(2);
            expect(ab.config.parsedEffects).toEqual(effects);
        }
    });

    it('produces a debuff ability with application apply for an enemy target', () => {
        const ab = selectedBuffToAbility(gameBuff({ buffName: 'Weaken' }), 'enemy');
        expect(ab.type).toBe('debuff');
        expect(ab.target).toBe('enemy');
        expect(ab.config.type).toBe('debuff');
        if (ab.config.type === 'debuff') {
            expect(ab.config.buffName).toBe('Weaken');
            expect(ab.config.application).toBe('apply');
        }
    });
});

describe('buildStaticBuffContext', () => {
    it('sets enemyType and satisfiable defaults across all 11 fields', () => {
        const ctx = buildStaticBuffContext({ enemyType: 'Defender' });
        expect(ctx.enemyType).toBe('Defender');
        expect(ctx.effectiveCritRate).toBe(100);
        expect(ctx.selfBuffNames).toEqual([]);
        expect(ctx.selfDebuffNames).toEqual([]);
        expect(ctx.enemyBuffNames).toEqual([]);
        expect(ctx.enemyDebuffCount).toBe(1);
        expect(ctx.adjacentAllyCount).toBe(1);
        expect(ctx.enemyAdjacentCount).toBe(1);
        expect(ctx.enemyDestroyedCount).toBe(1);
        expect(ctx.selfHpPct).toBe(100);
        expect(ctx.enemyHpPct).toBe(100);
    });
});

describe('buffAbilitiesToSelectedBuffs', () => {
    const skills = (abilities: Ability[]): ShipSkills => ({
        slots: [{ slot: 'active', abilities }],
    });

    it('includes a condition-less buff in selfBuffs', () => {
        const ctx = buildStaticBuffContext({});
        const { selfBuffs, enemyDebuffs } = buffAbilitiesToSelectedBuffs(
            skills([buffAbility()]),
            ctx
        );
        expect(selfBuffs).toHaveLength(1);
        expect(selfBuffs[0].buffName).toBe('Power Up');
        expect(enemyDebuffs).toHaveLength(0);
    });

    it('gates an enemy-type condition by ctx.enemyType', () => {
        const gated = buffAbility({
            conditions: [{ subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' }],
        });
        const excluded = buffAbilitiesToSelectedBuffs(
            skills([gated]),
            buildStaticBuffContext({ enemyType: 'Attacker' })
        );
        expect(excluded.selfBuffs).toHaveLength(0);

        const included = buffAbilitiesToSelectedBuffs(
            skills([gated]),
            buildStaticBuffContext({ enemyType: 'Defender' })
        );
        expect(included.selfBuffs).toHaveLength(1);
    });

    it('gates a non-derivable condition by its manualCount', () => {
        const ctx = buildStaticBuffContext({});
        const excluded = buffAbilitiesToSelectedBuffs(
            skills([
                buffAbility({
                    conditions: [{ subject: 'always', derivable: false, manualCount: 0 }],
                }),
            ]),
            ctx
        );
        expect(excluded.selfBuffs).toHaveLength(0);

        const included = buffAbilitiesToSelectedBuffs(
            skills([
                buffAbility({
                    conditions: [{ subject: 'always', derivable: false, manualCount: 1 }],
                }),
            ]),
            ctx
        );
        expect(included.selfBuffs).toHaveLength(1);
    });

    it('routes an enemy-target debuff into enemyDebuffs', () => {
        const ctx = buildStaticBuffContext({});
        const { selfBuffs, enemyDebuffs } = buffAbilitiesToSelectedBuffs(
            skills([debuffAbility()]),
            ctx
        );
        expect(selfBuffs).toHaveLength(0);
        expect(enemyDebuffs).toHaveLength(1);
        expect(enemyDebuffs[0].buffName).toBe('Weaken');
    });

    it('routes an all-allies target buff into selfBuffs', () => {
        const ctx = buildStaticBuffContext({});
        const allAlliesBuff = buffAbility({
            target: 'all-allies',
            conditions: [],
        });
        const { selfBuffs, enemyDebuffs } = buffAbilitiesToSelectedBuffs(
            skills([allAlliesBuff]),
            ctx
        );
        expect(selfBuffs).toHaveLength(1);
        expect(selfBuffs[0].buffName).toBe('Power Up');
        expect(enemyDebuffs).toHaveLength(0);
    });

    it('applies AND gate for multi-condition: excludes if any condition fails', () => {
        const ctx = buildStaticBuffContext({ enemyType: 'Defender' });
        const multiConditionBuff = buffAbility({
            conditions: [
                { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
                { subject: 'enemy-buff', derivable: false, manualCount: 0 },
            ],
        });
        const excluded = buffAbilitiesToSelectedBuffs(skills([multiConditionBuff]), ctx);
        expect(excluded.selfBuffs).toHaveLength(0);

        const multiConditionBuffIncluded = buffAbility({
            conditions: [
                { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
                { subject: 'enemy-buff', derivable: false, manualCount: 1 },
            ],
        });
        const included = buffAbilitiesToSelectedBuffs(skills([multiConditionBuffIncluded]), ctx);
        expect(included.selfBuffs).toHaveLength(1);
    });
});

describe('selectedBuffsToBuffAbilities', () => {
    it('maps selfBuffs to buff abilities and enemyDebuffs to debuff abilities', () => {
        const abilities = selectedBuffsToBuffAbilities(
            [gameBuff({ id: 'b1' }), gameBuff({ id: 'b2' })],
            [gameBuff({ id: 'e1', buffName: 'Weaken' })]
        );
        const buffs = abilities.filter((a) => a.type === 'buff');
        const debuffs = abilities.filter((a) => a.type === 'debuff');
        expect(buffs).toHaveLength(2);
        expect(buffs.every((a) => a.target === 'self')).toBe(true);
        expect(debuffs).toHaveLength(1);
        expect(debuffs[0].target).toBe('enemy');
    });
});

describe('Round-trip: selectedBuffsToBuffAbilities → buffAbilitiesToSelectedBuffs', () => {
    it('preserves self buffs and enemy debuffs through a full round-trip', () => {
        // Hand-built inputs for determinism: one self buff, one enemy debuff
        const selfBuffs: SelectedGameBuff[] = [
            {
                id: 'x',
                buffName: 'Attack Up II',
                stacks: 1,
                parsedEffects: { attack: 30 },
                isStackable: false,
                maxStacks: 1,
                autoFilled: true,
            },
        ];
        const enemyDebuffs: SelectedGameBuff[] = [
            {
                id: 'y',
                buffName: 'Defense Down II',
                stacks: 2,
                parsedEffects: { defense: -30 },
                isStackable: true,
                maxStacks: 5,
                stackTrigger: 'per-round',
                autoFilled: false,
            },
        ];

        // Forward: SelectedGameBuff[] → Ability[]
        const abilities = selectedBuffsToBuffAbilities(selfBuffs, enemyDebuffs);
        expect(abilities).toHaveLength(2);

        // Build ShipSkills
        const shipSkills: ShipSkills = {
            slots: [{ slot: 'active', abilities }],
        };

        // Backward: Ability[] → SelectedGameBuff[]
        const round = buffAbilitiesToSelectedBuffs(shipSkills, buildStaticBuffContext({}));

        // Assert: self buffs match by name
        expect(round.selfBuffs.map((b) => b.buffName).sort()).toEqual(
            selfBuffs.map((b) => b.buffName).sort()
        );

        // Assert: enemy debuffs match by name
        expect(round.enemyDebuffs.map((b) => b.buffName).sort()).toEqual(
            enemyDebuffs.map((b) => b.buffName).sort()
        );

        // Assert: for at least one buff, stacks and parsedEffects match the original
        const roundedSelfBuff = round.selfBuffs.find((b) => b.buffName === 'Attack Up II');
        expect(roundedSelfBuff).toBeDefined();
        expect(roundedSelfBuff!.stacks).toBe(selfBuffs[0].stacks);
        expect(roundedSelfBuff!.parsedEffects).toEqual(selfBuffs[0].parsedEffects);

        // Assert: for the debuff, stacks and parsedEffects match
        const roundedEnemyDebuff = round.enemyDebuffs.find((b) => b.buffName === 'Defense Down II');
        expect(roundedEnemyDebuff).toBeDefined();
        expect(roundedEnemyDebuff!.stacks).toBe(enemyDebuffs[0].stacks);
        expect(roundedEnemyDebuff!.parsedEffects).toEqual(enemyDebuffs[0].parsedEffects);
    });
});
