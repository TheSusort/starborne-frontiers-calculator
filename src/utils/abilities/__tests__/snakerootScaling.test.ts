import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, Skill } from '../../../types/abilities';

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}

function abilityOfType(abilities: Ability[], type: string): Ability | undefined {
    return abilities.find((a) => a.type === type);
}

// Old-corpus wording of Snakeroot's p2 (synthetic; the catalogue text differs). The refit-2
// text; with the default 4-refit fixture this is the refit-active passive row.
const SNAKEROOT_P2 =
    'This Unit deals <unit-damage>120% damage</unit-damage> for every 4 stacks of damage over time inflicted on to a single enemy.';

// Old-corpus wording of Snakeroot's p1 (synthetic) — the R0 innate, same clause shape with a
// different rate (100% per 7 stacks).
const SNAKEROOT_P1 =
    'This Unit deals <unit-damage>100% damage</unit-damage> for every 7 stacks of damage over time inflicted on to a single enemy.';

// Owner rulings R43/R43b/R90: a SEPARATE hit fired each time the DoT stacks inflicted on one
// enemy pass a multiple of N. The engine side is pinned in
// combat/__tests__/snakerootDotThresholdHit.integration.test.ts.
describe('Snakeroot "X% damage for every N stacks of damage over time" — a threshold hit', () => {
    it('"120% damage for every 4 stacks" → a 120% hit on each crossing of 4', () => {
        const s = ship({ secondPassiveSkillText: SNAKEROOT_P2 });
        const dmg = abilityOfType(
            slot(buildShipAbilities(s).slots, 'passive')!.abilities,
            'damage'
        )!;
        expect(dmg.trigger).toBe('on-enemy-dot-stacks-crossed');
        expect(dmg.target).toBe('enemy');
        expect(dmg.config).toEqual({ type: 'damage', multiplier: 120, everyDotStacks: 4 });
        // No longer a per-stack scaling on the cast.
        expect(dmg.scaling).toBeUndefined();
        expect(dmg.conditions).toEqual([]);
    });

    it('sibling first-passive phrasing (100% per 7 stacks) parses the same shape, own rate', () => {
        const s = ship({ firstPassiveSkillText: SNAKEROOT_P1, refits: [] });
        const dmg = abilityOfType(
            slot(buildShipAbilities(s).slots, 'passive')!.abilities,
            'damage'
        )!;
        expect(dmg.trigger).toBe('on-enemy-dot-stacks-crossed');
        expect(dmg.config).toEqual({ type: 'damage', multiplier: 100, everyDotStacks: 7 });
    });
});
