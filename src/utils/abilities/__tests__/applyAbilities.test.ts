import { describe, it, expect } from 'vitest';
import {
    selectFiringSkill,
    damageInputsFromSkill,
    secondaryFromSkill,
    dotsFromSkill,
    chargeAbilitiesFromSkill,
    accumulatorsFromSkill,
    modifierTotalsFromAbilities,
    gateFiringAbilities,
    extraActionsFromSkill,
} from '../applyAbilities';
import { Ability, Condition, ModifierChannel, ShipSkills, Skill } from '../../../types/abilities';
import { ConditionContext } from '../evaluateConditions';

function damage(id: string, multiplier: number, hits?: number): Ability {
    return {
        id,
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier, ...(hits !== undefined ? { hits } : {}) },
    };
}

function additional(id: string, stat: 'hp' | 'defense', pct: number): Ability {
    return {
        id,
        type: 'additional-damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'additional-damage', stat, pct },
    };
}

function dot(
    id: string,
    dotType: 'corrosion' | 'inferno' | 'bomb',
    tier: number,
    stacks: number,
    duration: number
): Ability {
    return {
        id,
        type: 'dot',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'dot', dotType, tier, stacks, duration },
    };
}

function charge(id: string, amount: number): Ability {
    return {
        id,
        type: 'charge',
        target: 'self',
        trigger: 'on-cast',
        conditions: [{ subject: 'always', derivable: true }],
        config: { type: 'charge', amount },
    };
}

function modifier(
    id: string,
    channel: ModifierChannel,
    value: number,
    conditions: Ability['conditions'] = []
): Ability {
    return {
        id,
        type: 'modifier',
        target: 'self',
        trigger: 'on-cast',
        conditions,
        config: { type: 'modifier', channel, value, isMultiplicative: true },
    };
}

function makeCtx(overrides: Partial<ConditionContext> = {}): ConditionContext {
    return {
        selfBuffNames: [],
        selfDebuffNames: [],
        enemyBuffNames: [],
        enemyDebuffCount: 0,
        effectiveCritRate: 0,
        adjacentAllyCount: 0,
        enemyAdjacentCount: 0,
        enemyDestroyedCount: 0,
        selfHpPct: 100,
        enemyHpPct: 100,
        ...overrides,
    };
}

describe('modifierTotalsFromAbilities', () => {
    const zero = {
        attack: 0,
        crit: 0,
        critDamage: 0,
        outgoingDamage: 0,
        defence: 0,
        defensePenetration: 0,
        hp: 0,
    };

    it('sums a single outgoingDamage modifier', () => {
        const result = modifierTotalsFromAbilities(
            [modifier('m', 'outgoingDamage', 40)],
            makeCtx()
        );
        expect(result).toEqual({ ...zero, outgoingDamage: 40 });
    });

    it('returns all zero when a conditional modifier is gated false', () => {
        const result = modifierTotalsFromAbilities(
            [
                modifier('m', 'attack', 50, [
                    { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
                ]),
            ],
            makeCtx({ enemyType: 'Attacker' })
        );
        expect(result).toEqual(zero);
    });

    it('counts a conditional modifier when gated true', () => {
        const result = modifierTotalsFromAbilities(
            [
                modifier('m', 'attack', 50, [
                    { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
                ]),
            ],
            makeCtx({ enemyType: 'Defender' })
        );
        expect(result).toEqual({ ...zero, attack: 50 });
    });

    it('maps the "defense" channel to the defence bucket', () => {
        const result = modifierTotalsFromAbilities([modifier('m', 'defense', 30)], makeCtx());
        expect(result).toEqual({ ...zero, defence: 30 });
    });

    it('stacks two modifiers', () => {
        const result = modifierTotalsFromAbilities(
            [modifier('m1', 'attack', 20), modifier('m2', 'attack', 15)],
            makeCtx()
        );
        expect(result).toEqual({ ...zero, attack: 35 });
    });

    it('ignores channels with no DPS bucket (outgoingHeal, incomingDamage)', () => {
        const result = modifierTotalsFromAbilities(
            [modifier('m1', 'outgoingHeal', 50), modifier('m2', 'incomingDamage', 25)],
            makeCtx()
        );
        expect(result).toEqual(zero);
    });

    it('returns all zero with no abilities', () => {
        expect(modifierTotalsFromAbilities([], makeCtx())).toEqual(zero);
    });

    it('applies a scaling defense-penetration modifier (per self-buff, capped)', () => {
        // Thresh: 7.5% defPen per buff, up to 45%.
        const scalingDefPen: Ability = {
            id: 'p',
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
        };
        // 3 self-buffs → 22.5%
        expect(
            modifierTotalsFromAbilities(
                [scalingDefPen],
                makeCtx({ selfBuffNames: ['a', 'b', 'c'] })
            )
        ).toEqual({ ...zero, defensePenetration: 22.5 });
        // 10 self-buffs → capped at 45%
        expect(
            modifierTotalsFromAbilities(
                [scalingDefPen],
                makeCtx({ selfBuffNames: Array.from({ length: 10 }, (_, i) => `b${i}`) })
            )
        ).toEqual({ ...zero, defensePenetration: 45 });
    });
});

describe('selectFiringSkill', () => {
    const active: Skill = { slot: 'active', abilities: [damage('a', 100)] };
    const charged: Skill = { slot: 'charged', abilities: [damage('c', 300)] };

    it('returns the active slot for action "active"', () => {
        const skills: ShipSkills = { slots: [active, charged] };
        expect(selectFiringSkill(skills, 'active')).toBe(active);
    });

    it('returns the charged slot for action "charged"', () => {
        const skills: ShipSkills = { slots: [active, charged] };
        expect(selectFiringSkill(skills, 'charged')).toBe(charged);
    });

    it('returns undefined when the requested slot is absent', () => {
        const skills: ShipSkills = { slots: [active] };
        expect(selectFiringSkill(skills, 'charged')).toBeUndefined();
    });
});

describe('damageInputsFromSkill', () => {
    it('reads multiplier and defaults hits to 1', () => {
        const skill: Skill = { slot: 'active', abilities: [damage('a', 120)] };
        const result = damageInputsFromSkill(skill);
        expect(result.multiplier).toBe(120);
        expect(result.hits).toBe(1);
        expect(result.scalingAbility).toBe(skill.abilities[0]);
    });

    it('reads hits when present', () => {
        const skill: Skill = { slot: 'active', abilities: [damage('a', 50, 3)] };
        const result = damageInputsFromSkill(skill);
        expect(result.multiplier).toBe(50);
        expect(result.hits).toBe(3);
    });

    it('uses the first damage ability', () => {
        const skill: Skill = {
            slot: 'active',
            abilities: [additional('s', 'defense', 80), damage('a', 90), damage('a2', 10)],
        };
        const result = damageInputsFromSkill(skill);
        expect(result.multiplier).toBe(90);
        expect(result.scalingAbility?.id).toBe('a');
    });

    it('returns multiplier 0, hits 1, no scalingAbility when no damage ability', () => {
        const skill: Skill = { slot: 'active', abilities: [additional('s', 'hp', 50)] };
        const result = damageInputsFromSkill(skill);
        expect(result).toEqual({
            multiplier: 0,
            hits: 1,
            scalingAbility: undefined,
            noCrit: false,
        });
    });

    it('handles undefined skill', () => {
        expect(damageInputsFromSkill(undefined)).toEqual({
            multiplier: 0,
            hits: 1,
            scalingAbility: undefined,
            noCrit: false,
        });
    });
});

describe('secondaryFromSkill', () => {
    it('maps the first additional-damage ability', () => {
        const skill: Skill = {
            slot: 'active',
            abilities: [damage('a', 100), additional('s', 'defense', 80)],
        };
        expect(secondaryFromSkill(skill)).toEqual({ stat: 'defense', pct: 80 });
    });

    it('returns undefined when no additional-damage ability', () => {
        const skill: Skill = { slot: 'active', abilities: [damage('a', 100)] };
        expect(secondaryFromSkill(skill)).toBeUndefined();
    });

    it('handles undefined skill', () => {
        expect(secondaryFromSkill(undefined)).toBeUndefined();
    });
});

describe('dotsFromSkill', () => {
    it('maps a single dot ability', () => {
        const skill: Skill = {
            slot: 'active',
            abilities: [damage('a', 100), dot('d', 'corrosion', 6, 2, 3)],
        };
        const result = dotsFromSkill(skill);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            type: 'corrosion',
            tier: 6,
            stacks: 2,
            duration: 3,
        });
        expect(result[0].id).toBeTruthy();
    });

    it('maps multiple dot abilities', () => {
        const skill: Skill = {
            slot: 'active',
            abilities: [
                dot('d1', 'corrosion', 6, 2, 3),
                dot('d2', 'inferno', 30, 1, 2),
                dot('d3', 'bomb', 200, 1, 1),
            ],
        };
        const result = dotsFromSkill(skill);
        expect(result).toHaveLength(3);
        expect(result.map((d) => d.type)).toEqual(['corrosion', 'inferno', 'bomb']);
    });

    it('returns empty array when no dot abilities', () => {
        const skill: Skill = { slot: 'active', abilities: [damage('a', 100)] };
        expect(dotsFromSkill(skill)).toEqual([]);
    });

    it('handles undefined skill', () => {
        expect(dotsFromSkill(undefined)).toEqual([]);
    });
});

describe('accumulatorsFromSkill', () => {
    const accumulate = (id: string, turns: number, pct: number): Ability => ({
        id,
        type: 'accumulate-detonate',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'accumulate-detonate', turns, pct },
    });

    it('extracts accumulate-detonate abilities as {turns, pct}', () => {
        const skill: Skill = {
            slot: 'charged',
            abilities: [damage('a', 240), accumulate('e', 2, 100)],
        };
        expect(accumulatorsFromSkill(skill)).toEqual([{ turns: 2, pct: 100 }]);
    });

    it('returns empty array when no accumulate-detonate abilities', () => {
        const skill: Skill = { slot: 'active', abilities: [damage('a', 100)] };
        expect(accumulatorsFromSkill(skill)).toEqual([]);
    });

    it('handles undefined skill', () => {
        expect(accumulatorsFromSkill(undefined)).toEqual([]);
    });
});

describe('chargeAbilitiesFromSkill', () => {
    it('extracts all charge abilities', () => {
        const c1 = charge('c1', 1);
        const c2 = charge('c2', 2);
        const skill: Skill = {
            slot: 'active',
            abilities: [damage('a', 100), c1, c2],
        };
        expect(chargeAbilitiesFromSkill(skill)).toEqual([c1, c2]);
    });

    it('returns empty array when no charge abilities', () => {
        const skill: Skill = { slot: 'active', abilities: [damage('a', 100)] };
        expect(chargeAbilitiesFromSkill(skill)).toEqual([]);
    });

    it('handles undefined skill', () => {
        expect(chargeAbilitiesFromSkill(undefined)).toEqual([]);
    });
});

describe('gateFiringAbilities', () => {
    const baseCtx: ConditionContext = {
        selfBuffNames: [],
        selfDebuffNames: [],
        enemyBuffNames: [],
        enemyDebuffCount: 0,
        effectiveCritRate: 100,
        adjacentAllyCount: 0,
        enemyAdjacentCount: 0,
        enemyDestroyedCount: 0,
        selfHpPct: 100,
        enemyHpPct: 100,
    };
    const dmg = (id: string, conditions: Condition[] = []): Ability => ({
        id,
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions,
        config: { type: 'damage', multiplier: 100 },
    });
    const dot = (id: string): Ability => ({
        id,
        type: 'dot',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'dot', dotType: 'corrosion', tier: 6, stacks: 1, duration: 2 },
    });

    it('returns undefined skill for undefined input', () => {
        expect(gateFiringAbilities(undefined, baseCtx).gatedSkill).toBeUndefined();
    });

    it('drops abilities whose conditions fail; keeps the rest', () => {
        const skill: Skill = {
            slot: 'active',
            abilities: [
                dmg('a', [{ subject: 'enemy-debuff', derivable: true }]), // 0 debuffs → fail
                dot('b'),
            ],
        };
        const { gatedSkill } = gateFiringAbilities(skill, baseCtx);
        expect(gatedSkill!.abilities.map((a) => a.id)).toEqual(['b']);
    });

    it('a kept dot makes a LATER enemy-debuff gate pass, but not an EARLIER one', () => {
        const failEarly: Skill = {
            slot: 'active',
            abilities: [dmg('a', [{ subject: 'enemy-debuff', derivable: true }]), dot('b')],
        };
        expect(
            gateFiringAbilities(failEarly, baseCtx).gatedSkill!.abilities.map((a) => a.id)
        ).toEqual(['b']);

        const passLate: Skill = {
            slot: 'active',
            abilities: [dot('b'), dmg('a', [{ subject: 'enemy-debuff', derivable: true }])],
        };
        expect(
            gateFiringAbilities(passLate, baseCtx).gatedSkill!.abilities.map((a) => a.id)
        ).toEqual(['b', 'a']);
    });

    it('ctxFor records the positional context (overlay applied) per ability', () => {
        const skill: Skill = { slot: 'active', abilities: [dot('b'), dmg('a')] };
        const { ctxFor } = gateFiringAbilities(skill, baseCtx);
        expect(ctxFor.get('b')!.enemyDebuffCount).toBe(0);
        expect(ctxFor.get('a')!.enemyDebuffCount).toBe(1);
    });

    it('honors count-threshold comparators as gates', () => {
        const skill: Skill = {
            slot: 'active',
            abilities: [
                dmg('a', [
                    {
                        subject: 'enemy-debuff',
                        derivable: true,
                        countComparator: 'gte',
                        countThreshold: 2,
                    },
                ]),
            ],
        };
        expect(
            gateFiringAbilities(skill, { ...baseCtx, enemyDebuffCount: 1 }).gatedSkill!.abilities
        ).toHaveLength(0);
        expect(
            gateFiringAbilities(skill, { ...baseCtx, enemyDebuffCount: 2 }).gatedSkill!.abilities
        ).toHaveLength(1);
    });

    it('a bare scaling-source condition does NOT gate (scaler only)', () => {
        // Meiying shape: base damage + "additionally deals X% vs Supporters" — the
        // enemy-type condition only scales the bonus; the base hit fires regardless.
        const ability: Ability = {
            ...dmg('a', [
                { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Supporter' },
            ]),
            scaling: { conditionIndex: 0, perUnit: 90 },
        };
        const skill: Skill = { slot: 'active', abilities: [ability] };
        // enemy-type mismatch (no enemyType in ctx → condition evaluates 0) → still KEPT
        expect(gateFiringAbilities(skill, baseCtx).gatedSkill!.abilities).toHaveLength(1);
    });

    it('a scaling-source condition WITH a countComparator still gates', () => {
        // Explicit threshold marks the condition as deliberately gate+scaler.
        const ability: Ability = {
            ...dmg('a', [
                {
                    subject: 'enemy-debuff',
                    derivable: true,
                    countComparator: 'gte',
                    countThreshold: 2,
                },
            ]),
            scaling: { conditionIndex: 0, perUnit: 10 },
        };
        const skill: Skill = { slot: 'active', abilities: [ability] };
        expect(
            gateFiringAbilities(skill, { ...baseCtx, enemyDebuffCount: 1 }).gatedSkill!.abilities
        ).toHaveLength(0);
        expect(
            gateFiringAbilities(skill, { ...baseCtx, enemyDebuffCount: 3 }).gatedSkill!.abilities
        ).toHaveLength(1);
    });

    it('non-scaling conditions on a scaled ability still gate', () => {
        // scaling refers to conditions[0]; conditions[1] is an independent hard gate.
        const ability: Ability = {
            ...dmg('a', [
                { subject: 'enemy-debuff', derivable: true },
                { subject: 'self-buff', derivable: true, buffName: 'Stealth' },
            ]),
            scaling: { conditionIndex: 0, perUnit: 20 },
        };
        const skill: Skill = { slot: 'active', abilities: [ability] };
        // Stealth missing → gated off despite the scaling condition being exempt
        expect(gateFiringAbilities(skill, baseCtx).gatedSkill!.abilities).toHaveLength(0);
        // Stealth present → kept (scaling condition at count 0 does not gate)
        expect(
            gateFiringAbilities(skill, { ...baseCtx, selfBuffNames: ['Stealth'] }).gatedSkill!
                .abilities
        ).toHaveLength(1);
    });
});

describe('extraActionsFromSkill', () => {
    it('collects on-cast extra-action abilities; skips other types and non-cast triggers', () => {
        const skill: Skill = {
            slot: 'active',
            abilities: [
                {
                    id: 'x1',
                    type: 'extra-action',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'extra-action', oncePerRound: true },
                },
                {
                    id: 'x2',
                    type: 'extra-action',
                    target: 'self',
                    trigger: 'on-ally-destroyed',
                    conditions: [],
                    config: { type: 'extra-action', oncePerRound: false },
                },
                {
                    id: 'x3',
                    type: 'charge',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'charge', amount: 1 },
                },
            ],
        };
        expect(extraActionsFromSkill(skill)).toEqual([{ abilityId: 'x1', oncePerRound: true }]);
        expect(extraActionsFromSkill(undefined)).toEqual([]);
    });

    it('a gated-out extra-action ability does not appear in grants', () => {
        // An extra-action with a failing condition is dropped by gateFiringAbilities
        // before extraActionsFromSkill sees the skill — grants must be empty.
        const conditionedExtraAction: Ability = {
            id: 'xa',
            type: 'extra-action',
            target: 'self',
            trigger: 'on-cast',
            conditions: [{ subject: 'self-buff', derivable: true, buffName: 'Stealth' }],
            config: { type: 'extra-action', oncePerRound: true },
        };
        const rawSkill: Skill = { slot: 'active', abilities: [conditionedExtraAction] };
        // Stealth not present → gateFiringAbilities drops the ability
        const { gatedSkill } = gateFiringAbilities(rawSkill, makeCtx());
        expect(extraActionsFromSkill(gatedSkill)).toEqual([]);
        // Stealth present → ability passes the gate → grant surfaces
        const { gatedSkill: gatedSkillWith } = gateFiringAbilities(rawSkill, {
            ...makeCtx(),
            selfBuffNames: ['Stealth'],
        });
        expect(extraActionsFromSkill(gatedSkillWith)).toEqual([
            { abilityId: 'xa', oncePerRound: true },
        ]);
    });
});
