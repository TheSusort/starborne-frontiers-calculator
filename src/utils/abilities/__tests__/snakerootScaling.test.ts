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

// Verbatim from docs/ship-skills.csv (second_passive_skill_text) — Snakeroot p2. The refit-2
// text; with the default 4-refit fixture this is the refit-active passive row.
const SNAKEROOT_P2 =
    'This Unit deals <unit-damage>120% damage</unit-damage> for every 4 stacks of damage over time inflicted on to a single enemy.';

// Verbatim from docs/ship-skills.csv (first_passive_skill_text) — Snakeroot p1 (the R0
// innate, same clause shape with a different rate — 100% per 7 stacks).
const SNAKEROOT_P1 =
    'This Unit deals <unit-damage>100% damage</unit-damage> for every 7 stacks of damage over time inflicted on to a single enemy.';

describe('Snakeroot per-DoT-entry damage scaling (model-completeness SP-D, PR-D3)', () => {
    it('"120% damage for every 4 stacks of DoT" → scaling on enemy-dot-count, base zeroed', () => {
        const s = ship({ secondPassiveSkillText: SNAKEROOT_P2 });
        const abilities = slot(buildShipAbilities(s).slots, 'passive')!.abilities;
        const dmg = abilityOfType(abilities, 'damage')!;

        // The whole 120% IS the per-4-entries rate — with 0 tracked DoT entries the ability
        // deals 0% damage, so the base <unit-damage> multiplier must be zeroed, not kept flat.
        expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 0 });
        expect(dmg.scaling).toBeDefined();
        expect(dmg.conditions[dmg.scaling!.conditionIndex]).toMatchObject({
            subject: 'enemy-dot-count',
            derivable: true,
        });
        // No countComparator/countThreshold on the scaling-source condition — bare, so
        // evaluateCondition returns the RAW DoT-entry count (Task 3 precedent), not a 0/1 gate.
        expect(dmg.conditions[dmg.scaling!.conditionIndex].countComparator).toBeUndefined();

        // 120% per 4 entries = 30 percentage points per entry. `enemy-dot-count` resolves to
        // the raw INTEGER entry count (0, 1, 2, …) — the same percentage-point convention as
        // the existing integer-count scaling precedents (Selenite's enemy-stealth-count
        // perUnit=10, Crucialis's self-crit perUnit=75), NOT the 0..1-fraction convention
        // reserved for the 0..100-scaled enemy-hp-pct/enemy-hp-missing-pct sources (Akula:
        // perUnit = value/100). scaledBonus folds `count * perUnit` additively into the
        // multiplier as percentage points (playerTurn.ts: `(effectiveMultiplier +
        // conditionalBonusPct) / 100`), so at 4 entries this must total 120, not 1.2.
        expect(dmg.scaling!.perUnit).toBeCloseTo(30);
        expect(dmg.scaling!.cap).toBeUndefined();
    });

    it('sibling first-passive phrasing (100% per 7 stacks) scales identically, different rate', () => {
        const s = ship({ firstPassiveSkillText: SNAKEROOT_P1, refits: [] });
        const abilities = slot(buildShipAbilities(s).slots, 'passive')!.abilities;
        const dmg = abilityOfType(abilities, 'damage')!;

        expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 0 });
        expect(dmg.conditions[dmg.scaling!.conditionIndex]).toMatchObject({
            subject: 'enemy-dot-count',
            derivable: true,
        });
        expect(dmg.scaling!.perUnit).toBeCloseTo(100 / 7);
    });
});
