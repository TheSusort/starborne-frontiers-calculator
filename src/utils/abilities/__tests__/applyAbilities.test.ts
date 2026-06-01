import { describe, it, expect } from 'vitest';
import {
    selectFiringSkill,
    damageInputsFromSkill,
    secondaryFromSkill,
    dotsFromSkill,
    chargeAbilitiesFromSkill,
} from '../applyAbilities';
import { Ability, ShipSkills, Skill } from '../../../types/abilities';

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
        expect(result).toEqual({ multiplier: 0, hits: 1, scalingAbility: undefined });
    });

    it('handles undefined skill', () => {
        expect(damageInputsFromSkill(undefined)).toEqual({
            multiplier: 0,
            hits: 1,
            scalingAbility: undefined,
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
