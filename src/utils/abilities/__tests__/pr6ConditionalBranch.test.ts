import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { gateFiringAbilities, damageInputsFromSkill } from '../applyAbilities';
import { scaledBonus } from '../evaluateConditions';
import { Ability, Skill } from '../../../types/abilities';
import { Ship } from '../../../types/ship';
import { makeConditionContext } from './conditionContextFixture';

// PR6a — conditional-branch damage phrasing hardening. Each ship's named clause is dropped or
// mis-gated in the pre-change parser (verified via a full-corpus dump). These red tests exercise
// PRODUCTION slot routing (buildShipAbilities) per the epic's binding verification protocol.

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}
function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}
function damageOf(abilities: Ability[]): Ability | undefined {
    return abilities.find((a) => a.type === 'damage');
}

describe('PR6a conditional-branch phrasing', () => {
    describe('self-buff-count scaling', () => {
        it('Valiant charged: "increased by 22.5% for each buff on itself" → self-buff scaling', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit gains <unit-skill>Legion Discipline II</unit-skill> for 2 turns and deals <unit-damage>145% Damage</unit-damage>, increased by <unit-damage>22.5%</unit-damage> for each buff on itself.',
                chargeSkillCharge: 3,
            });
            const dmg = damageOf(slot(buildShipAbilities(s).slots, 'charged')!.abilities)!;
            expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 145 });
            expect(dmg.scaling).toMatchObject({ conditionIndex: 0, perUnit: 22.5 });
            expect(dmg.conditions[0]).toMatchObject({ subject: 'self-buff', derivable: true });
        });

        it('Sustainer charged: "additional 30% for each buff on it" → self-buff scaling', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit deals <unit-damage>205% damage</unit-damage> with an additional <unit-damage>30%</unit-damage> for each buff on it. If this Unit has no debuffs, it gains one extra action.',
                chargeSkillCharge: 3,
            });
            const dmg = damageOf(slot(buildShipAbilities(s).slots, 'charged')!.abilities)!;
            expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 205 });
            expect(dmg.scaling).toMatchObject({ conditionIndex: 0, perUnit: 30 });
            expect(dmg.conditions[0]).toMatchObject({ subject: 'self-buff', derivable: true });
        });
    });

    describe('self-crit conditional', () => {
        it('Crucialis charged: "when it is critical, deals and additional 190%" → self-crit scaling', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit deals <unit-damage>200% damage</unit-damage> and when it is critical, deals and additional <unit-damage>190%</unit-damage> damage.',
                chargeSkillCharge: 3,
            });
            const dmg = damageOf(slot(buildShipAbilities(s).slots, 'charged')!.abilities)!;
            expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 200 });
            expect(dmg.scaling).toMatchObject({ conditionIndex: 0, perUnit: 190 });
            expect(dmg.conditions[0]).toMatchObject({ subject: 'self-crit', derivable: true });
        });
    });

    describe('self-Stealth conditional (word-order variant)', () => {
        it('Yin Jian active: "if Stealthed, additional deals 50%" → self-buff(Stealth) scaling', () => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>95% damage</unit-damage> and, if <unit-aid>Stealthed</unit-aid>, additional deals <unit-damage>50%</unit-damage> damage.',
            });
            const dmg = damageOf(slot(buildShipAbilities(s).slots, 'active')!.abilities)!;
            expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 95 });
            expect(dmg.scaling).toMatchObject({ conditionIndex: 0, perUnit: 50 });
            expect(dmg.conditions[0]).toMatchObject({ subject: 'self-buff', buffName: 'Stealth' });
        });
    });

    describe('enemy-named-debuff conditional', () => {
        it('Wrecker charged: "if target affected by Inferno, additional 50%" → enemy-debuff(Inferno) scaling', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit deals <unit-damage>155% damage</unit-damage> and, if the target is affected by <unit-skill>Inferno</unit-skill>, deals an additional <unit-damage>50% damage</unit-damage>.',
                chargeSkillCharge: 2,
            });
            const dmg = damageOf(slot(buildShipAbilities(s).slots, 'charged')!.abilities)!;
            expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 155 });
            // Binary "if affected by Inferno" → cap at perUnit so multiple Inferno stacks
            // can't inflate the one-time +50% bonus.
            expect(dmg.scaling).toMatchObject({ conditionIndex: 0, perUnit: 50, cap: 50 });
            expect(dmg.conditions[0]).toMatchObject({
                subject: 'enemy-debuff',
                buffName: 'Inferno',
                derivable: true,
            });
        });

        it('Rikra active: "additional 60% against Taunted or Provoked enemies" → enemy-debuff OR-group scaling', () => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>140% damage</unit-damage>, with additional <unit-damage>60%</unit-damage> damage against Taunted or Provoked enemies.',
            });
            const dmg = damageOf(slot(buildShipAbilities(s).slots, 'active')!.abilities)!;
            expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 140 });
            expect(dmg.scaling).toMatchObject({ conditionIndex: 0, perUnit: 60, cap: 60 });
            // Taunt OR Provoke — anyOf group. Taunt is type 'buff' (enemy-buff), Provoke type
            // 'debuff' (enemy-debuff) per constants/buffs.ts + classifyEnemyEffect.
            expect(dmg.conditions).toEqual([
                expect.objectContaining({ subject: 'enemy-buff', buffName: 'Taunt', anyOf: true }),
                expect.objectContaining({
                    subject: 'enemy-debuff',
                    buffName: 'Provoke',
                    anyOf: true,
                }),
            ]);
        });

        it('Rikra charged: conditional bonus attaches to the damage ability even when a buff precedes it', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit gains <unit-skill>Defense Up II</unit-skill> for 2 turns, and deals <unit-damage>180% damage</unit-damage> with additional <unit-damage>80%</unit-damage> damage against Taunted or Provoked enemies.',
                chargeSkillCharge: 2,
            });
            const abilities = slot(buildShipAbilities(s).slots, 'charged')!.abilities;
            const dmg = damageOf(abilities)!;
            expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 180 });
            expect(dmg.scaling).toMatchObject({ conditionIndex: 0, perUnit: 80, cap: 80 });
            expect(dmg.conditions).toEqual([
                expect.objectContaining({ subject: 'enemy-buff', buffName: 'Taunt', anyOf: true }),
                expect.objectContaining({
                    subject: 'enemy-debuff',
                    buffName: 'Provoke',
                    anyOf: true,
                }),
            ]);
            // Subject-aware rule 5: the Defense Up II buff must NOT inherit self Taunt/Provoke gates.
            const buff = abilities.find((a) => a.type === 'buff')!;
            expect(buff.conditions).toEqual([]);
        });
    });

    describe('"increased to X against Defenders" replacement + conditional Stasis (Gallant)', () => {
        it('active: base 115 + enemy-type(Defender) delta scaling 20', () => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>115% Damage</unit-damage>, increased to <unit-damage>135%</unit-damage> against Defenders.',
            });
            const dmg = damageOf(slot(buildShipAbilities(s).slots, 'active')!.abilities)!;
            expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 115 });
            expect(dmg.scaling).toMatchObject({ conditionIndex: 0, perUnit: 20 });
            expect(dmg.conditions[0]).toMatchObject({
                subject: 'enemy-type',
                requiredEnemyType: 'Defender',
            });
        });

        it('charged: base 175 + Defender delta 10 + conditional Stasis control', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit deals <unit-damage>175% Damage</unit-damage>, increased to <unit-damage>185%</unit-damage> with additional <unit-skill>Stasis</unit-skill> applied for 1 turn against Defenders.',
                chargeSkillCharge: 2,
            });
            const abilities = slot(buildShipAbilities(s).slots, 'charged')!.abilities;
            const dmg = damageOf(abilities)!;
            expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 175 });
            expect(dmg.scaling).toMatchObject({ conditionIndex: 0, perUnit: 10 });
            expect(dmg.conditions[0]).toMatchObject({
                subject: 'enemy-type',
                requiredEnemyType: 'Defender',
            });
            const control = abilities.find((a) => a.type === 'control');
            expect(control).toBeDefined();
            expect(control!.config).toMatchObject({ type: 'control', effect: 'stasis' });
            expect(control!.conditions[0]).toMatchObject({
                subject: 'enemy-type',
                requiredEnemyType: 'Defender',
            });
        });
    });

    // Regression guard: Panon's charged "If THIS UNIT is affected by Provoke or Taunt, it instead
    // … deals 170% … additional Damage equal to 130% of its Defense" is a SELF-gated replacement
    // branch (SP-F F1), NOT an additive enemy-conditional bonus. The enemy-effect parser must
    // NOT attach a +130% enemy-Taunt/Provoke scaling to Panon's 140% base damage — instead the
    // base damage now carries the NEGATED self Taunt/Provoke-absent gate (both eq/0), and a
    // second, replacement damage ability (built by SP-F F1) carries the anyOf pair.
    it('Panon charged: self-gated "instead" branch is NOT mis-parsed as an enemy-conditional bonus', () => {
        const s = ship({
            chargeSkillText:
                'This Unit deals <unit-damage>140% damage</unit-damage> plus an additional <unit-damage>100%</unit-damage> of its Defense.<br /><br />If this Unit is affected by <unit-skill>Provoke</unit-skill> or <unit-skill>Taunt</unit-skill>, it instead gains <unit-skill>Barrier</unit-skill> for 1 hit and deals <unit-damage>170% damage</unit-damage> with an additional Damage equal to <unit-damage>130%</unit-damage> of its Defense.',
            chargeSkillCharge: 3,
        });
        const dmg = damageOf(slot(buildShipAbilities(s).slots, 'charged')!.abilities)!;
        expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 140 });
        // No enemy-effect scaling attached, and no enemy Taunt/Provoke conditions leaked onto it.
        expect(dmg.scaling).toBeUndefined();
        // SP-F F1: the base branch now carries the NEGATED self-gate (fires when NEITHER status
        // is present) instead of an empty array.
        expect(dmg.conditions).toEqual([
            {
                subject: 'self-buff',
                buffName: 'Taunt',
                derivable: true,
                countComparator: 'eq',
                countThreshold: 0,
            },
            {
                subject: 'self-debuff',
                buffName: 'Provoke',
                derivable: true,
                countComparator: 'eq',
                countThreshold: 0,
            },
        ]);
    });

    // Combat-integration + DPS-parity layer: prove the Rikra OR-gated bonus resolves through the
    // real sim gate/scale path — base ALWAYS fires, the +60% adds on either Taunt (enemy-buff) or
    // Provoke (enemy-debuff), and it contributes 0 in single-ship DPS mode (no live enemy state).
    describe('Rikra OR-gate resolves through the sim gate/scale path', () => {
        const rikraActive = (): Skill => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>140% damage</unit-damage>, with additional <unit-damage>60%</unit-damage> damage against Taunted or Provoked enemies.',
            });
            return buildShipAbilities(s).slots.find((sl) => sl.slot === 'active')!;
        };

        it('base 140% fires regardless of enemy state (the OR-group only scales, never gates)', () => {
            const skill = rikraActive();
            // No Taunt/Provoke on the enemy → the damage ability still survives gating.
            const { gatedSkill } = gateFiringAbilities(skill, makeConditionContext());
            expect(damageInputsFromSkill(gatedSkill).multiplier).toBe(140);
        });

        it('+60% on a Taunted enemy (enemy-buff), on a Provoked enemy (enemy-debuff), 0 on neither', () => {
            const dmg = damageInputsFromSkill(rikraActive()).scalingAbility!;
            // DPS default (no live enemy names) → 0 bonus.
            expect(scaledBonus(dmg, makeConditionContext())).toBe(0);
            // Taunt is a buff on the enemy → enemy-buff match.
            expect(scaledBonus(dmg, makeConditionContext({ enemyBuffNames: ['Taunt'] }))).toBe(60);
            // Provoke is a debuff → name-specific enemy-debuff match (caller opts in via names).
            expect(scaledBonus(dmg, makeConditionContext({ enemyDebuffNames: ['Provoke'] }))).toBe(
                60
            );
            // Both present → capped at 60 (binary), not 120.
            expect(
                scaledBonus(
                    dmg,
                    makeConditionContext({
                        enemyBuffNames: ['Taunt'],
                        enemyDebuffNames: ['Provoke'],
                    })
                )
            ).toBe(60);
            // Strip is symmetric: the base still fires (140) even when the enemy DOES carry the
            // OR condition — the group only scales the bonus, it never gates/consumes the base.
            const { gatedSkill } = gateFiringAbilities(
                rikraActive(),
                makeConditionContext({ enemyBuffNames: ['Taunt'] })
            );
            expect(damageInputsFromSkill(gatedSkill).multiplier).toBe(140);
        });
    });
});
