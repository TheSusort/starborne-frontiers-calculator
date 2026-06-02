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

    it('defensive-only passive (Anemone) produces no passive slot — the UI surfaces the slot from skill text instead', () => {
        // Anemone's passive is pure mitigation/repair; nothing the ability parser models.
        // buildShipAbilities yields no passive slot, so ShipConfigCard derives `hasPassive`
        // from the ship's skill text (getSkillRowForSlot) to still show the Edit button.
        const s = ship({
            activeSkillText: 'This Unit deals <unit-damage>140% damage</unit-damage>.',
            thirdPassiveSkillText:
                'This Unit takes 25% less direct damage from enemies debuffed with a Damage over Time effect.',
        });

        const { slots } = buildShipAbilities(s);
        expect(slot(slots, 'passive')).toBeUndefined();
    });

    it('Judge passive: HP-gated damage (no scaling) + separate per-destroyed modifier + flat defPen', () => {
        const s = ship({
            thirdPassiveSkillText:
                'This Unit ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects and has <unit-damage>20% defense penetration</unit-damage><br /><br />At the start of the round, this Unit deals <unit-damage>60% damage</unit-damage> to all enemies with less than 50% HP.<br /><br />This Unit deals <unit-damage>20% more direct damage</unit-damage> for each destroyed enemy, up to max of 100%.',
        });

        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive')!;

        // The 60% damage is gated by enemy HP < 50% and has NO scaling (the per-destroyed
        // bonus belongs to the modifier, not this ability).
        const dmg = abilityOfType(passive.abilities, 'damage')!;
        expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 60 });
        expect(dmg.scaling).toBeUndefined();
        expect(dmg.conditions).toEqual([
            { subject: 'hp-threshold', derivable: true, hpComparator: 'below', hpPercent: 50 },
        ]);

        // The "20% more direct damage for each destroyed enemy, up to 100%" is the outgoing-damage modifier.
        const modifier = passive.abilities.find(
            (a) => a.config.type === 'modifier' && a.config.channel === 'outgoingDamage'
        )!;
        expect(modifier.scaling).toMatchObject({ perUnit: 20, cap: 100 });
        expect(modifier.conditions).toEqual([{ subject: 'enemy-destroyed', derivable: false }]);

        // Flat 20% defense penetration modifier is still present.
        expect(
            passive.abilities.some(
                (a) =>
                    a.config.type === 'modifier' &&
                    a.config.channel === 'defensePenetration' &&
                    a.config.value === 20
            )
        ).toBe(true);
    });

    it('Provider charged: damage + extend-dot (charge removal is ignored)', () => {
        const s = ship({
            activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
            chargeSkillText:
                'This Unit deals <unit-damage>200% damage</unit-damage>, removes 1 charge from the enemy, and extends active Damage Over Time effects by 1 turn.',
            chargeSkillCharge: 3,
        });

        const charged = slot(buildShipAbilities(s).slots, 'charged')!;
        expect(abilityOfType(charged.abilities, 'damage')!.config).toMatchObject({
            multiplier: 200,
        });
        const extend = abilityOfType(charged.abilities, 'extend-dot')!;
        expect(extend.config).toEqual({ type: 'extend-dot', turns: 1 });
        expect(extend.target).toBe('enemy');
    });

    it('Provider passive: no-crit damage gated by ally-inflicts-debuff + gated Crit Rate Down II', () => {
        const s = ship({
            thirdPassiveSkillText:
                'This Unit has 20% Shield Penetration. When another ally inflicts a debuff onto an enemy, this unit deals <unit-damage>50% damage</unit-damage> to that enemy that cannont critically hit and inflict <unit-skill>Crit Rate Down II</unit-skill> for 1 turn.',
        });

        const passive = slot(buildShipAbilities(s).slots, 'passive')!;

        const dmg = abilityOfType(passive.abilities, 'damage')!;
        expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 50, noCrit: true });
        expect(dmg.conditions).toEqual([{ subject: 'ally-inflicts-debuff', derivable: false }]);

        const debuff = passive.abilities.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Crit Rate Down II'
        )!;
        expect(debuff.conditions).toEqual([{ subject: 'ally-inflicts-debuff', derivable: false }]);
    });

    it('Lodolite active: Concentrate Fire debuff gated by a negated enemy-type (non-Defenders)', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>240% damage</unit-damage>. When targeting non-Defenders, apply <unit-skill>Concentrate Fire</unit-skill> for 2 turns.',
        });

        const active = slot(buildShipAbilities(s).slots, 'active')!;
        const debuff = active.abilities.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Concentrate Fire'
        )!;
        expect(debuff.conditions).toEqual([
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender', negate: true },
        ]);
    });

    it('Incinerator passive: damage + modifier both gated by enemy-debuff(Inferno)', () => {
        const s = ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            secondPassiveSkillText:
                'At the end of the round, this unit deals <unit-damage>100% damage</unit-damage> to all enemies with <unit-skill>Inferno</unit-skill>.<br /><br />Additionally, this Unit deals <unit-damage>30% more direct damage</unit-damage> to enemies afflicted with <unit-skill>Inferno</unit-skill>.',
        });

        const passive = slot(buildShipAbilities(s).slots, 'passive')!;

        const dmg = abilityOfType(passive.abilities, 'damage')!;
        expect(dmg.config).toMatchObject({ multiplier: 100 });
        expect(dmg.conditions).toEqual([
            { subject: 'enemy-debuff', buffName: 'Inferno', derivable: true },
        ]);

        const mod = passive.abilities.find(
            (a) => a.config.type === 'modifier' && a.config.channel === 'outgoingDamage'
        )!;
        expect(mod.config).toMatchObject({ channel: 'outgoingDamage', value: 30 });
        expect(mod.conditions).toEqual([
            { subject: 'enemy-debuff', buffName: 'Inferno', derivable: true },
        ]);
    });

    it('Obsidian charged: "increases Damage by 100% to enemies with less than 30% HP" → enemy-HP-gated modifier', () => {
        const s = ship({
            chargeSkillText:
                'This Unit deals <unit-damage>250% Damage</unit-damage>, with additional Damage equal to <unit-damage>20%</unit-damage> of its max HP and increases <unit-damage>Damage by 100%</unit-damage> to enemies with less than <unit-damage>30%</unit-damage> HP.',
            chargeSkillCharge: 3,
        });
        const charged = slot(buildShipAbilities(s).slots, 'charged')!;
        expect(abilityOfType(charged.abilities, 'damage')!.config).toMatchObject({
            multiplier: 250,
        });
        expect(abilityOfType(charged.abilities, 'additional-damage')!.config).toMatchObject({
            stat: 'hp',
            pct: 20,
        });
        const mod = charged.abilities.find(
            (a) => a.config.type === 'modifier' && a.config.channel === 'outgoingDamage'
        )!;
        expect(mod.config).toMatchObject({ channel: 'outgoingDamage', value: 100 });
        expect(mod.target).toBe('self');
        expect(mod.conditions).toEqual([
            {
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: 'below',
                hpPercent: 30,
                hpSubject: 'enemy',
            },
        ]);
    });

    it('Los passive: "30% more direct damage when its HP is below 50%" → self HP-gated modifier', () => {
        const s = ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            secondPassiveSkillText:
                'This Unit deals <unit-damage>30% more Direct damage</unit-damage> when its HP is below 50%.<br />Additionally, this Unit starts combat fully charged.',
        });
        const mod = slot(buildShipAbilities(s).slots, 'passive')!.abilities.find(
            (a) => a.config.type === 'modifier' && a.config.channel === 'outgoingDamage'
        )!;
        expect(mod.config).toMatchObject({ channel: 'outgoingDamage', value: 30 });
        expect(mod.target).toBe('self');
        expect(mod.conditions).toEqual([
            {
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: 'below',
                hpPercent: 50,
                hpSubject: 'self',
            },
        ]);
    });

    it('Valerian passive: crit-power Corrosion extension gated by self-crit', () => {
        const s = ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            secondPassiveSkillText:
                'This Unit repairs 15% of damage dealt, including damage over time effects. After inflicting <unit-skill>Corrosion</unit-skill> with a Critical hit, the duration of the newly applied Corrosion is extended by 1 turn, with the extension chance equal to the Critical Power.',
        });
        const ext = abilityOfType(
            slot(buildShipAbilities(s).slots, 'passive')!.abilities,
            'extend-dot'
        )!;
        expect(ext.config).toEqual({ type: 'extend-dot', turns: 1, chanceFromCritPower: true });
        expect(ext.conditions).toEqual([{ subject: 'self-crit', derivable: true }]);
    });

    it('Belladonna passive: crit-power extension gated by ally-inflicts-debuff (team)', () => {
        const s = ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            secondPassiveSkillText:
                'When an ally inflicts <unit-skill>Corrosion</unit-skill>, this Unit has a chance to convert it.<br /><br />Upon converting Corrosion, this Unit extends the newly applied Acidic Decay status for 1 turn, with the chance to equal to its crit power.',
        });
        const ext = abilityOfType(
            slot(buildShipAbilities(s).slots, 'passive')!.abilities,
            'extend-dot'
        )!;
        expect(ext.config).toMatchObject({ chanceFromCritPower: true, turns: 1 });
        expect(ext.conditions).toEqual([{ subject: 'ally-inflicts-debuff', derivable: false }]);
    });

    it('Crocus passive: ally-crit-DoT triggers a gated Corrosion II DoT', () => {
        const s = ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            secondPassiveSkillText:
                'When another ally inflicts a Damage Over Time (DoT) effect with a critical hit, this Unit repairs itself for 3% of its Max HP and inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns on that enemy.',
        });
        const dot = abilityOfType(slot(buildShipAbilities(s).slots, 'passive')!.abilities, 'dot')!;
        expect(dot.config).toMatchObject({ type: 'dot', dotType: 'corrosion' });
        expect(dot.conditions).toEqual([{ subject: 'ally-crit-dot', derivable: false }]);
    });

    it('Incinerator charged: damage + DoT(inferno) + detonate-dot(inferno, 180%)', () => {
        const s = ship({
            chargeSkillText:
                'This Unit deals <unit-damage>225% damage</unit-damage>, detonates Inferno effects with 180% of their power, and inflicts <unit-skill>Inferno III</unit-skill> for 3 turns.',
            chargeSkillCharge: 3,
        });

        const charged = slot(buildShipAbilities(s).slots, 'charged')!;
        expect(abilityOfType(charged.abilities, 'damage')!.config).toMatchObject({
            multiplier: 225,
        });
        expect(abilityOfType(charged.abilities, 'dot')!.config).toMatchObject({
            dotType: 'inferno',
        });
        const detonate = abilityOfType(charged.abilities, 'detonate-dot')!;
        expect(detonate.config).toEqual({
            type: 'detonate-dot',
            dotType: 'inferno',
            powerPct: 180,
        });
        expect(detonate.target).toBe('enemy');
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

    it('Lodolite passive: crit-damage vs Defenders + all-ally damage vs enemies with Concentrate Fire/Stealth', () => {
        const s = ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            secondPassiveSkillText:
                'This Unit ignores <unit-skill>Stealth</unit-skill> effects.<br /><br />This Unit deals <unit-damage>10% more critical damage</unit-damage> to defenders, all allies deal <unit-damage>15% more direct damage</unit-damage> to enemies with <unit-skill>Concentrate Fire</unit-skill> or <unit-skill>Stealth</unit-skill>.',
        });

        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const mods = passive.abilities.filter((a) => a.config.type === 'modifier');

        // 10% more critical damage to defenders → critDamage modifier gated by enemy-type Defender.
        const crit = mods.find(
            (m) => m.config.type === 'modifier' && m.config.channel === 'critDamage'
        )!;
        expect(crit.config).toMatchObject({ channel: 'critDamage', value: 10 });
        expect(crit.target).toBe('self');
        expect(crit.conditions).toEqual([
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
        ]);

        // 15% more direct damage to enemies with Concentrate Fire or Stealth → all-ally outgoing,
        // gated by enemy-buff (anyOf), NOT a self-buff Stealth condition.
        const out = mods.find(
            (m) => m.config.type === 'modifier' && m.config.channel === 'outgoingDamage'
        )!;
        expect(out.config).toMatchObject({ channel: 'outgoingDamage', value: 15 });
        expect(out.target).toBe('all-allies');
        // Concentrate Fire is a debuff → derivable enemy-debuff; Stealth is a buff → manual enemy-buff.
        expect(out.conditions).toEqual([
            { subject: 'enemy-debuff', buffName: 'Concentrate Fire', derivable: true, anyOf: true },
            { subject: 'enemy-buff', buffName: 'Stealth', derivable: false, anyOf: true },
        ]);
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
        // Taunt = enemy buff, Provoke = self debuff (both targeting effects), anyOf.
        expect(outgoing.conditions).toEqual([
            { subject: 'enemy-buff', buffName: 'Taunt', derivable: false, anyOf: true },
            { subject: 'self-debuff', buffName: 'Provoke', derivable: false, anyOf: true },
        ]);

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

    it('attaches an enemy-debuff count gate to a threshold-gated inflicted debuff (Crocus-style)', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals 150% Damage and inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns. If the target has more than 3 Debuffs, it inflicts <unit-skill>Stasis</unit-skill> for 2 turns.',
        });
        const active = buildShipAbilities(s).slots.find((sl) => sl.slot === 'active');
        const stasis = active!.abilities.find(
            (a) =>
                a.type === 'debuff' && a.config.type === 'debuff' && a.config.buffName === 'Stasis'
        );
        expect(stasis?.conditions).toEqual([
            { subject: 'enemy-debuff', derivable: true, countComparator: 'gte', countThreshold: 4 },
        ]);
        // The unconditional Corrosion II DoT in the same skill stays ungated.
        expect(abilityOfType(active!.abilities, 'dot')?.conditions).toEqual([]);
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
            { subject: 'enemy-buff', buffName: 'Taunt', derivable: false, anyOf: true },
            { subject: 'self-debuff', buffName: 'Provoke', derivable: false, anyOf: true },
        ]);
    });
});
