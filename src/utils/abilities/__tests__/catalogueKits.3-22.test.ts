import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import type { Ability } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import { parseSlot, sigs } from './helpers/catalogueWording';

// The kits game version 3.22 redesigned (user ruling: every one is the live kit). Each slot's
// text is a NEW kit, not a rewording of ours, so each is asserted directly against what the
// catalogue sentence says. The signature list is asserted in FULL so an extra ability fails, and
// every slot whose meaning rides a condition, scaling rule or config value asserts that too — a
// signature (`type|target|trigger|name`) cannot see any of them.

const sorted = (xs: string[]): string[] => [...xs].sort();
const only = (abilities: Ability[], type: Ability['type']): Ability => {
    const hits = abilities.filter((a) => a.type === type);
    expect(hits).toHaveLength(1);
    return hits[0];
};

describe('3.22 kits — damage clauses', () => {
    it('Gallant active: "if the target is a defender it instead deals 155%" replaces 115%', () => {
        const text =
            'This Unit deals <unit-damage>115% damage</unit-damage>, if the target is a defender it instead deals <unit-damage>155% damage</unit-damage>.';
        const abilities = parseSlot('active', text);
        expect(sigs(abilities)).toEqual(['damage|enemy|on-cast|damage']);
        // A replacement: base 115 plus the (155 − 115) difference, only against a Defender.
        expect(only(abilities, 'damage')).toMatchObject({
            config: { multiplier: 115 },
            conditions: [{ subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' }],
            scaling: { conditionIndex: 0, perUnit: 40 },
        });
    });

    it('Gallant charged: the defender branch deals 205% and inflicts Stasis', () => {
        const text =
            'This Unit deals <unit-damage>175% damage</unit-damage>, if the target is a defender it instead deals <unit-damage>205% damage</unit-damage> and inflicts <unit-skill>Stasis</unit-skill> for 1 turn.';
        const abilities = parseSlot('charged', text);
        expect(sigs(abilities)).toEqual(
            sorted([
                'damage|enemy|on-cast|damage',
                'control|enemy|on-cast|control',
                'debuff|enemy|on-cast|Stasis',
            ])
        );
        const defender = [
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
        ];
        expect(only(abilities, 'damage')).toMatchObject({
            config: { multiplier: 175 },
            conditions: defender,
            scaling: { conditionIndex: 0, perUnit: 30 },
        });
        // The Stasis belongs to the defender branch only.
        expect(only(abilities, 'control').conditions).toEqual(defender);
        expect(only(abilities, 'debuff').conditions).toEqual(defender);
    });

    it('IonScorp charged: "but when attacking a defender, it instead deals 220%" replaces 190%', () => {
        const text =
            'This Unit deals <unit-damage>190% damage</unit-damage>, but when attacking a defender, it instead deals <unit-damage>220% damage</unit-damage> and inflicts <unit-skill>Disable</unit-skill> for 1 turn.';
        const abilities = parseSlot('charged', text);
        expect(sigs(abilities)).toEqual(
            sorted([
                'damage|enemy|on-cast|damage',
                'control|enemy|on-cast|control',
                'debuff|enemy|on-cast|Disable',
            ])
        );
        const defender = [
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
        ];
        expect(only(abilities, 'damage')).toMatchObject({
            config: { multiplier: 190 },
            conditions: defender,
            scaling: { conditionIndex: 0, perUnit: 30 },
        });
        expect(only(abilities, 'control').conditions).toEqual(defender);
        expect(only(abilities, 'debuff').conditions).toEqual(defender);
    });

    it('Meiying active: 200% plus an additional 100% against a supporter', () => {
        const text =
            'This Unit deals <unit-damage>200% damage</unit-damage>, and when attacking a supporter, it deals an additional <unit-damage>100% damage</unit-damage>.';
        const abilities = parseSlot('active', text);
        expect(sigs(abilities)).toEqual(['damage|enemy|on-cast|damage']);
        expect(only(abilities, 'damage')).toMatchObject({
            config: { multiplier: 200 },
            conditions: [
                { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Supporter' },
            ],
            scaling: { conditionIndex: 0, perUnit: 100 },
        });
    });

    it('Meiying charged: 250% and Stasis, plus an additional 125% against a supporter', () => {
        const text =
            'This Unit deals <unit-damage>250% damage</unit-damage> and inflicts <unit-skill>Stasis</unit-skill> for 1 turn. When attacking a supporter, it deals an additional <unit-damage>125% damage</unit-damage>.';
        const abilities = parseSlot('charged', text);
        expect(sigs(abilities)).toEqual(
            sorted([
                'damage|enemy|on-cast|damage',
                'control|enemy|on-cast|control',
                'debuff|enemy|on-cast|Stasis',
            ])
        );
        expect(only(abilities, 'damage')).toMatchObject({
            config: { multiplier: 250 },
            conditions: [
                { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Supporter' },
            ],
            scaling: { conditionIndex: 0, perUnit: 125 },
        });
        // The Stasis is unconditional — the supporter clause gates only the extra damage.
        expect(only(abilities, 'control').conditions).toEqual([]);
        expect(only(abilities, 'debuff').conditions).toEqual([]);
    });

    it("Meiying: the ignore-Taunt/Provoke flag comes from the passive, not the attacks' text", () => {
        const kit = {
            refits: [],
            chargeSkillCharge: 2,
            activeSkillText:
                'This Unit deals <unit-damage>200% damage</unit-damage>, and when attacking a supporter, it deals an additional <unit-damage>100% damage</unit-damage>.',
            chargeSkillText:
                'This Unit deals <unit-damage>250% damage</unit-damage> and inflicts <unit-skill>Stasis</unit-skill> for 1 turn. When attacking a supporter, it deals an additional <unit-damage>125% damage</unit-damage>.',
        };
        const passive =
            "This Unit's attacks ignore <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects.<br /><br />Upon destroying an enemy with a <unit-aid>debuff</unit-aid>, this Unit inflicts <unit-skill>Stasis</unit-skill> on all adjacent enemies for 1 turn.";
        expect(buildShipAbilities(kit as unknown as Ship).ignoresForcedTargeting).toBeUndefined();
        expect(
            buildShipAbilities({ ...kit, firstPassiveSkillText: passive } as unknown as Ship)
                .ignoresForcedTargeting
        ).toBe(true);
    });

    it('Akula charged: 220% damage', () => {
        const abilities = parseSlot(
            'charged',
            'This Unit deals <unit-damage>220% damage</unit-damage>.'
        );
        expect(sigs(abilities)).toEqual(['damage|enemy|on-cast|damage']);
        expect(only(abilities, 'damage')).toMatchObject({
            config: { multiplier: 220 },
            conditions: [],
        });
    });

    it('Crucialis active: "if a critical hit, deals an additional 90%" is a crit-gated bonus', () => {
        const text =
            'This Unit deals <unit-damage>80% damage</unit-damage> and, if a critical hit, deals an additional <unit-damage>90% damage</unit-damage>.';
        const abilities = parseSlot('active', text);
        expect(sigs(abilities)).toEqual(['damage|enemy|on-cast|damage']);
        expect(only(abilities, 'damage')).toMatchObject({
            config: { multiplier: 80 },
            conditions: [{ subject: 'self-crit', derivable: true }],
            scaling: { conditionIndex: 0, perUnit: 90 },
        });
    });

    it('Crucialis charged: "if a critical hit, deals an additional 210%" is a crit-gated bonus', () => {
        const text =
            'This Unit deals <unit-damage>200% damage</unit-damage> and, if a critical hit, deals an additional <unit-damage>210% damage</unit-damage>.';
        const abilities = parseSlot('charged', text);
        expect(sigs(abilities)).toEqual(['damage|enemy|on-cast|damage']);
        expect(only(abilities, 'damage')).toMatchObject({
            config: { multiplier: 200 },
            conditions: [{ subject: 'self-crit', derivable: true }],
            scaling: { conditionIndex: 0, perUnit: 210 },
        });
    });

    // "a control effect" names a CATEGORY of statuses, not a status called "control". Which
    // statuses belong to it is not modelled, so the bonus is left out and only the base damage
    // fires: a condition keyed on the name 'control' would match no status in the combat sim and
    // ANY debuff in DPS mode (whose name-agnostic fallback counts every debuff).
    it('Sokol active: the base 80% fires; the control-effect bonus is not minted', () => {
        const text =
            'This Unit deals <unit-damage>80% damage</unit-damage> and, if the target is affected by a <unit-skill>control</unit-skill> effect, deals an additional <unit-damage>130% damage</unit-damage>.';
        const abilities = parseSlot('active', text);
        expect(sigs(abilities)).toEqual(['damage|enemy|on-cast|damage']);
        const dmg = only(abilities, 'damage');
        expect(dmg.config).toMatchObject({ multiplier: 80 });
        expect(dmg.conditions).toEqual([]);
        expect(dmg.scaling).toBeUndefined();
    });

    it('Sokol charged: the base 120% fires; the control-effect bonus is not minted', () => {
        const text =
            'This Unit deals <unit-damage>120% damage</unit-damage> and, if the target is affected by a <unit-skill>control</unit-skill> effect, deals an additional <unit-damage>150% damage</unit-damage>.';
        const abilities = parseSlot('charged', text);
        expect(sigs(abilities)).toEqual(['damage|enemy|on-cast|damage']);
        const dmg = only(abilities, 'damage');
        expect(dmg.config).toMatchObject({ multiplier: 120 });
        expect(dmg.conditions).toEqual([]);
        expect(dmg.scaling).toBeUndefined();
    });
});
