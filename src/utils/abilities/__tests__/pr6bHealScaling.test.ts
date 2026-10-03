import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ability, Skill } from '../../../types/abilities';
import { Ship } from '../../../types/ship';

// Per-count repair scaling: the per-count repair is recorded as an Ability-level `scaling` rule +
// a count Condition, mirroring the damage-scaling convention (total = config.pct + perUnit ×
// count), and the combat engine's cast-heal pass folds it in. These tests exercise PRODUCTION
// slot routing; debuffedEnemyCountHealScaling.integration.test.ts covers the engine side.

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}
function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}
function healOf(abilities: Ability[]): Ability | undefined {
    return abilities.find((a) => a.type === 'heal');
}

describe('PR6b heal-scaling', () => {
    it('Oleander active: base 100% + additional 8.5% repair per debuffed enemy', () => {
        const s = ship({
            activeSkillText:
                'This Unit grants <unit-skill>Hacking Up III</unit-skill> for 2 turns and <unit-damage>repairs 100%</unit-damage> of its Max HP, with an additional <unit-damage>8.5%</unit-damage> repair for each debuffed enemy.',
            chargeSkillCharge: 6,
        });
        const heal = healOf(slot(buildShipAbilities(s).slots, 'active')!.abilities)!;
        // Base repair stays 100%; the +8.5% per debuffed enemy is a scaling bonus on top.
        expect(heal.config).toMatchObject({ type: 'heal', pct: 100, basis: 'hp' });
        const idx = heal.scaling!.conditionIndex!;
        expect(heal.scaling).toMatchObject({ perUnit: 8.5 });
        expect(heal.conditions[idx]).toEqual({
            subject: 'debuffed-enemy-count',
            derivable: true,
        });
    });

    it('a damage bonus "for each debuffed enemy" counts debuffed enemy units too', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>100%</unit-damage> damage, with 10% more damage for each <unit-aid>debuffed</unit-aid> enemy.',
            chargeSkillCharge: 6,
        });
        const mod = slot(buildShipAbilities(s).slots, 'active')!.abilities.find(
            (a) => a.type === 'modifier'
        )!;
        expect(mod.scaling).toMatchObject({ conditionIndex: 0, perUnit: 10 });
        expect(mod.conditions).toEqual([{ subject: 'debuffed-enemy-count', derivable: true }]);
    });

    it('"for each debuff on the enemy" keeps counting debuffs on the target', () => {
        const s = ship({
            activeSkillText:
                'This Unit <unit-damage>repairs 10%</unit-damage> of its Max HP, with an additional <unit-damage>5%</unit-damage> repair for each debuff on the enemy.',
            chargeSkillCharge: 6,
        });
        const heal = healOf(slot(buildShipAbilities(s).slots, 'active')!.abilities)!;
        const idx = heal.scaling!.conditionIndex!;
        expect(heal.conditions[idx]).toEqual({ subject: 'enemy-debuff', derivable: true });
    });

    it('Meatshield charged: 1.5% repair per debuff on itself (pure per-count → base 0)', () => {
        const s = ship({
            chargeSkillText:
                'This Unit <unit-damage>repairs 1.5%</unit-damage> of its max HP for each <unit-aid>debuff</unit-aid> on itself.<br /><br />If this Unit has less than 3 stacks of <unit-skill>Protection</unit-skill>, it steals <unit-skill>Protection</unit-skill> until this Unit has 3 stacks of <unit-skill>Protection</unit-skill>.',
            chargeSkillCharge: 3,
        });
        const heal = healOf(slot(buildShipAbilities(s).slots, 'charged')!.abilities)!;
        // Purely per-count: total = 1.5% × (debuffs on self), so base 0 + perUnit 1.5.
        expect(heal.config).toMatchObject({ type: 'heal', pct: 0, basis: 'hp' });
        const idx = heal.scaling!.conditionIndex!;
        expect(heal.scaling).toMatchObject({ perUnit: 1.5 });
        expect(heal.conditions[idx]).toMatchObject({ subject: 'self-debuff', derivable: true });
    });
});
