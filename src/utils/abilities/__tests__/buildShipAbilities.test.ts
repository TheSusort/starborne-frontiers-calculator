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

describe('buildShipAbilities', () => {
    it('Selenite active: damage + additional-damage(hp) + charge(enemy-buff/Stealth)', () => {
        const s = ship({
            activeSkillText:
                "This Unit deals <unit-damage>200% damage</unit-damage> with additional damage equal to <unit-damage>10%</unit-damage> of this Unit's max HP. If any target is <unit-aid>Stealthed</unit-aid>, it <unit-aid>adds 1 charge</unit-aid> to this Unit's Charged Skill.",
            chargeSkillCharge: 4,
        });

        const { slots } = buildShipAbilities(s);
        const active = slot(slots, 'active');
        expect(active).toBeDefined();

        const dmg = abilityOfType(active!.abilities, 'damage');
        expect(dmg).toMatchObject({
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'damage', multiplier: 200 },
            autoFilled: true,
        });

        const add = abilityOfType(active!.abilities, 'additional-damage');
        expect(add).toMatchObject({
            type: 'additional-damage',
            target: 'enemy',
            config: { type: 'additional-damage', stat: 'hp', pct: 10 },
            autoFilled: true,
        });

        const charge = abilityOfType(active!.abilities, 'charge');
        expect(charge).toMatchObject({
            type: 'charge',
            target: 'self',
            trigger: 'on-cast',
            config: { type: 'charge', amount: 1 },
            autoFilled: true,
        });
        expect(charge!.conditions[0]).toMatchObject({
            subject: 'enemy-buff',
            derivable: false,
            buffName: 'Stealth',
        });
    });

    it('Chakara active: damage(180) + additional-damage(defense, 80) + charge', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>180% damage</unit-damage> with additional damage equal to <unit-damage>80%</unit-damage> of its Defense. If all damaged enemies have more Speed than this Unit, it <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.',
            chargeSkillCharge: 2,
        });

        const { slots } = buildShipAbilities(s);
        const active = slot(slots, 'active');
        expect(active).toBeDefined();

        expect(abilityOfType(active!.abilities, 'damage')).toMatchObject({
            config: { type: 'damage', multiplier: 180 },
        });
        expect(abilityOfType(active!.abilities, 'additional-damage')).toMatchObject({
            config: { type: 'additional-damage', stat: 'defense', pct: 80 },
        });

        const charge = abilityOfType(active!.abilities, 'charge');
        expect(charge).toBeDefined();
        expect(charge!.config).toMatchObject({ type: 'charge', amount: 1 });
        // Speed condition is classified 'always'/derivable by parseChargeGain.
        expect(charge!.conditions[0]).toMatchObject({ subject: 'always', derivable: true });
    });

    it('Panguan active: damage(145) with conditional scaling (perUnit 30) attached to base', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>145% damage</unit-damage>, increasing by <unit-damage>30%</unit-damage> for each Unit adjacent to the enemy, and inflicts <unit-skill>Bomb II</unit-skill> for 2 turns.',
        });

        const { slots } = buildShipAbilities(s);
        const active = slot(slots, 'active');
        expect(active).toBeDefined();

        const dmg = abilityOfType(active!.abilities, 'damage');
        expect(dmg).toMatchObject({ config: { type: 'damage', multiplier: 145 } });
        expect(dmg!.scaling).toMatchObject({ conditionIndex: 0, perUnit: 30 });
        expect(dmg!.scaling!.cap).toBeUndefined();
        expect(dmg!.conditions).toHaveLength(1);
        expect(dmg!.conditions[0]).toMatchObject({ subject: 'enemy-adjacent', derivable: false });

        // Task 3b: Bomb II is now emitted as a dot ability on the active slot.
        expect(abilityOfType(active!.abilities, 'dot')).toMatchObject({
            config: { type: 'dot', dotType: 'bomb', tier: 200 },
        });
    });

    it('charged slot: damage ability with multiplier 300', () => {
        const s = ship({
            activeSkillText: 'deals <unit-damage>100% damage</unit-damage>',
            chargeSkillText: 'deals <unit-damage>300% damage</unit-damage>',
            chargeSkillCharge: 3,
        });

        const { slots } = buildShipAbilities(s);
        const charged = slot(slots, 'charged');
        expect(charged).toBeDefined();
        expect(abilityOfType(charged!.abilities, 'damage')).toMatchObject({
            config: { type: 'damage', multiplier: 300 },
        });

        const active = slot(slots, 'active');
        expect(abilityOfType(active!.abilities, 'damage')).toMatchObject({
            config: { type: 'damage', multiplier: 100 },
        });
    });

    it('Enforcer active: multi-hit damage ability with { multiplier: 50, hits: 3 }', () => {
        const s = ship({
            activeSkillText:
                'This Unit attacks three times with each attack dealing <unit-damage>50% damage</unit-damage>.',
        });

        const { slots } = buildShipAbilities(s);
        const active = slot(slots, 'active');
        expect(active).toBeDefined();

        const dmg = abilityOfType(active!.abilities, 'damage');
        expect(dmg).toMatchObject({
            config: { type: 'damage', multiplier: 50, hits: 3 },
        });
    });

    it('Panguan active: dot ability { dotType: bomb, tier: 200 } on active slot', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>145% damage</unit-damage>, increasing by <unit-damage>30%</unit-damage> for each Unit adjacent to the enemy, and inflicts <unit-skill>Bomb II</unit-skill> for 2 turns.',
        });

        const { slots } = buildShipAbilities(s);
        const active = slot(slots, 'active');
        expect(active).toBeDefined();

        const dot = abilityOfType(active!.abilities, 'dot');
        expect(dot).toMatchObject({
            type: 'dot',
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'dot', dotType: 'bomb', tier: 200, stacks: 1, duration: 2 },
            autoFilled: true,
        });
        expect(dot!.conditions).toEqual([]);
    });

    it('Panguan second passive: modifier ability { outgoingDamage, 40, multiplicative } target all-allies', () => {
        const s = ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            secondPassiveSkillText:
                'Friendly <unit-aid>Stealthed</unit-aid> units deal 40% more direct damage.<br /><br />This Unit Gains <unit-skill>Stealth</unit-skill> for 2 turns when directly damaged.',
        });

        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive');
        expect(passive).toBeDefined();

        const mod = abilityOfType(passive!.abilities, 'modifier');
        expect(mod).toMatchObject({
            type: 'modifier',
            target: 'all-allies',
            config: {
                type: 'modifier',
                channel: 'outgoingDamage',
                value: 40,
                isMultiplicative: true,
            },
            autoFilled: true,
        });
        expect(mod!.conditions[0]).toMatchObject({ subject: 'self-buff', buffName: 'Stealth' });
    });

    it('Howler active: self buff (Attack Up III) coexists with active damage', () => {
        const s = ship({
            activeSkillText:
                'This Unit grants <unit-skill>Attack Up III</unit-skill> for 2 turns and <unit-damage>repairs 90%</unit-damage> of its Attack.',
        });

        const { slots } = buildShipAbilities(s);
        const active = slot(slots, 'active');
        expect(active).toBeDefined();

        const buff = abilityOfType(active!.abilities, 'buff');
        expect(buff).toMatchObject({
            type: 'buff',
            target: 'self',
            trigger: 'on-cast',
            config: { type: 'buff', buffName: 'Attack Up III' },
            autoFilled: true,
        });
    });

    it('Snapdragon active: enemy debuff (Defense Down II) coexists with active damage', () => {
        const s = ship({
            activeSkillText:
                'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns and deals <unit-damage>160% damage</unit-damage>.',
        });

        const { slots } = buildShipAbilities(s);
        const active = slot(slots, 'active');
        expect(active).toBeDefined();

        // Damage ability still present.
        expect(abilityOfType(active!.abilities, 'damage')).toMatchObject({
            config: { type: 'damage', multiplier: 160 },
        });

        const debuff = abilityOfType(active!.abilities, 'debuff');
        expect(debuff).toMatchObject({
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'debuff', buffName: 'Defense Down II' },
            autoFilled: true,
        });
    });

    it('parses Thresh-style passive: conditional outgoing-dmg modifier + scaling defPen modifier, no false damage', () => {
        const s = ship({
            // factory default refits + only secondPassiveSkillText → getShipSkillRows picks Passive R2
            secondPassiveSkillText:
                'This Unit deals <unit-damage>25% more direct damage</unit-damage> when affected by <unit-skill>Taunt</unit-skill> or <unit-skill>Provoke</unit-skill>.<br /><br />This Unit gains <unit-damage>7.5% defense penetration</unit-damage> for each <unit-aid>buff</unit-aid> it has, up to a max of 45%.',
        });
        const passive = buildShipAbilities(s).slots.find((sl) => sl.slot === 'passive');
        const mods = passive!.abilities.filter((a) => a.type === 'modifier');
        // No false-positive base-damage ability from "25% more direct damage".
        expect(passive!.abilities.some((a) => a.type === 'damage')).toBe(false);

        const outgoing = mods.find(
            (m) => m.config.type === 'modifier' && m.config.channel === 'outgoingDamage'
        )!;
        expect(outgoing.config).toMatchObject({ channel: 'outgoingDamage', value: 25 });
        expect(outgoing.conditions.map((c) => c.buffName)).toEqual(['Taunt', 'Provoke']);
        expect(outgoing.conditions.every((c) => c.anyOf)).toBe(true);

        const defPen = mods.find(
            (m) => m.config.type === 'modifier' && m.config.channel === 'defensePenetration'
        )!;
        expect(defPen.scaling).toMatchObject({ conditionIndex: 0, perUnit: 7.5, cap: 45 });
        expect(defPen.conditions[0]).toMatchObject({ subject: 'self-buff', derivable: true });
    });

    it('parses Judge-style passive: flat defPen modifier + capped "% more damage for each destroyed" scaling', () => {
        const s = ship({
            secondPassiveSkillText:
                'This Unit ignores Taunt and Provoke effects and has 20% defense penetration. This Unit deals 20% more direct damage for each destroyed enemy, up to max of 100%.',
        });
        const passive = buildShipAbilities(s).slots.find((sl) => sl.slot === 'passive');
        const mods = passive!.abilities.filter((a) => a.type === 'modifier');

        const defPen = mods.find(
            (m) => m.config.type === 'modifier' && m.config.channel === 'defensePenetration'
        )!;
        expect(defPen.config).toMatchObject({ channel: 'defensePenetration', value: 20 });
        expect(defPen.scaling).toBeUndefined();
        expect(defPen.conditions).toEqual([]);

        const outgoing = mods.find(
            (m) => m.config.type === 'modifier' && m.config.channel === 'outgoingDamage'
        )!;
        // Scaling, not a flat +20% bonus — defaults to 0 until the destroyed count is set.
        expect(outgoing.config).toMatchObject({ channel: 'outgoingDamage', value: 0 });
        expect(outgoing.scaling).toMatchObject({ conditionIndex: 0, perUnit: 20, cap: 100 });
        expect(outgoing.conditions[0]).toMatchObject({
            subject: 'enemy-destroyed',
            derivable: false,
        });
    });

    it('attaches an enemy-type condition to a conditionally-granted buff (Thresh-style)', () => {
        const s = ship({
            activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
            chargeSkillText:
                'When targeting a Defender, this Unit gains <unit-skill>Attack Up II</unit-skill> for 1 turn.',
            chargeSkillCharge: 2,
        });
        const charged = buildShipAbilities(s).slots.find((sl) => sl.slot === 'charged');
        const buff = abilityOfType(charged!.abilities, 'buff');
        expect(buff?.config).toMatchObject({ type: 'buff', buffName: 'Attack Up II' });
        expect(buff?.conditions[0]).toMatchObject({
            subject: 'enemy-type',
            derivable: true,
            requiredEnemyType: 'Defender',
        });
    });

    it('attaches a self-crit condition to a crit-gated granted buff (Lionheart-style)', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals 170% damage. If this critically hits, this Unit gains <unit-skill>Attack Up II</unit-skill> for 1 turn.',
        });
        const active = buildShipAbilities(s).slots.find((sl) => sl.slot === 'active');
        const buff = abilityOfType(active!.abilities, 'buff');
        expect(buff?.config).toMatchObject({ type: 'buff', buffName: 'Attack Up II' });
        expect(buff?.conditions).toEqual([{ subject: 'self-crit', derivable: true }]);
    });

    it('attaches anyOf Taunt/Provoke conditions to a status-gated granted buff (Panon-style)', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals 80% damage. If this Unit is Provoked or Taunted, this Unit gains <unit-skill>Terran Guard III</unit-skill> for 2 turns.',
        });
        const active = buildShipAbilities(s).slots.find((sl) => sl.slot === 'active');
        const buff = active!.abilities.find(
            (a) =>
                a.type === 'buff' &&
                a.config.type === 'buff' &&
                a.config.buffName === 'Terran Guard III'
        );
        expect(buff?.conditions).toEqual([
            { subject: 'self-buff', buffName: 'Taunt', derivable: false, anyOf: true },
            { subject: 'self-buff', buffName: 'Provoke', derivable: false, anyOf: true },
        ]);
    });
});
