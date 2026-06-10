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

    it('Akula passive (R2 text): HP-proportional scaling modifier, not a flat +30%', () => {
        // Was modelled flat at max while the sim assumed full enemy HP; enemy HP now
        // declines per round, so the bonus scales on the live enemy-hp-pct count.
        const s = ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            secondPassiveSkillText:
                "This Unit's attacks don't break <unit-skill>Stasis</unit-skill>. Starts combat fully Charged. Increases outgoing direct damage by up to <unit-damage>30%</unit-damage> based on the target's current HP percentage; the higher the percentage, the more the damage.",
        });
        const mod = slot(buildShipAbilities(s).slots, 'passive')!.abilities.find(
            (a) => a.config.type === 'modifier' && a.config.channel === 'outgoingDamage'
        )!;
        expect(mod.config).toMatchObject({ channel: 'outgoingDamage', value: 0 });
        expect(mod.target).toBe('self');
        expect(mod.conditions[0]).toMatchObject({ subject: 'enemy-hp-pct', derivable: true });
        expect(mod.scaling!.perUnit).toBeCloseTo(0.3);
        expect(mod.scaling!.cap).toBe(30);
    });

    it('Crucialis active: base damage + self-crit conditional bonus', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>80% damage</unit-damage> and, if critical, additionally deals <unit-damage>75%</unit-damage> damage.',
        });
        const dmg = abilityOfType(
            slot(buildShipAbilities(s).slots, 'active')!.abilities,
            'damage'
        )!;
        expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 80 });
        expect(dmg.conditions).toEqual([{ subject: 'self-crit', derivable: true }]);
        expect(dmg.scaling).toMatchObject({ conditionIndex: 0, perUnit: 75 });
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
        expect(ext.config).toEqual({
            type: 'extend-dot',
            turns: 1,
            chanceFromCritPower: true,
            scope: 'inflicted',
        });
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

    it('Crocus passive: ally-crit-DoT routes through the on-ally-crit-dot reactive trigger (conditions empty)', () => {
        const s = ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            secondPassiveSkillText:
                'When another ally inflicts a Damage Over Time (DoT) effect with a critical hit, this Unit repairs itself for 3% of its Max HP and inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns on that enemy.',
        });
        const dot = abilityOfType(slot(buildShipAbilities(s).slots, 'passive')!.abilities, 'dot')!;
        expect(dot.config).toMatchObject({ type: 'dot', dotType: 'corrosion' });
        expect(dot.trigger).toBe('on-ally-crit-dot');
        expect(dot.conditions).toEqual([]);
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

    it('Valkyrie charged: accumulate-detonate(Echoing Burst, 2 turns, 100%) without a redundant debuff card', () => {
        const s = ship({
            chargeSkillText:
                "This Unit's attack ignores Taunt and Provoke, deals <unit-damage>240% damage</unit-damage>, and inflicts <unit-skill>Inc. Damage Up II</unit-skill> and <unit-skill>Echoing Burst</unit-skill> for 2 turns.",
            chargeSkillCharge: 2,
        });

        const charged = slot(buildShipAbilities(s).slots, 'charged')!;
        const accumulate = abilityOfType(charged.abilities, 'accumulate-detonate')!;
        expect(accumulate.config).toEqual({
            type: 'accumulate-detonate',
            turns: 2,
            pct: 100,
        });
        expect(accumulate.target).toBe('enemy');
        // Echoing Burst is represented only by the accumulate-detonate ability, not a debuff card.
        expect(
            charged.abilities.some(
                (a) => a.config.type === 'debuff' && a.config.buffName === 'Echoing Burst'
            )
        ).toBe(false);
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

    it('Howler active: team buff (Attack Up III) coexists with active damage', () => {
        const s = ship({
            activeSkillText:
                'This Unit grants <unit-skill>Attack Up III</unit-skill> for 2 turns and <unit-damage>repairs 90%</unit-damage> of its Attack.',
        });

        const { slots } = buildShipAbilities(s);
        const active = slot(slots, 'active');
        expect(active).toBeDefined();

        const buff = abilityOfType(active!.abilities, 'buff');
        // CHANGED (verb-aware routing fix): Howler's "This Unit grants Attack Up III" is a
        // receiver-less BESTOWING grant → all-allies (the locked routing rule), not self. The
        // attacker still receives it (self folds into all-allies for the attacker's own sim); the
        // distinction only matters when the engine walks Howler as a team ship.
        expect(buff).toMatchObject({
            type: 'buff',
            target: 'all-allies',
            trigger: 'on-cast',
            config: { type: 'buff', buffName: 'Attack Up III' },
            autoFilled: true,
        });
    });

    it('Nayra active: secondary Defense damage with the % at the end of the tag', () => {
        const s = ship({
            activeSkillText:
                'This Unit inflicts <unit-skill>Defense Down II</unit-skill> and <unit-skill>Crit Rate Down III</unit-skill> for 2 turns, dealing <unit-damage>170% damage</unit-damage> and additional <unit-damage>damage equal to 30%</unit-damage> of its Defense.',
        });
        const active = slot(buildShipAbilities(s).slots, 'active')!;
        expect(abilityOfType(active.abilities, 'damage')!.config).toMatchObject({
            multiplier: 170,
        });
        expect(abilityOfType(active.abilities, 'additional-damage')!.config).toEqual({
            type: 'additional-damage',
            stat: 'defense',
            pct: 30,
        });
    });

    it('Nayra passive: Offensive Affinity Override gated on Isha being on the team; Defensive is unconditional', () => {
        const s = ship({
            // factory default refits + only secondPassiveSkillText → getShipSkillRows picks Passive R2
            secondPassiveSkillText:
                'At the start of the round, this Unit gains <unit-skill>Defensive Affinity Override</unit-skill>.<br />If Isha is on the same team, this Unit also gains <unit-skill>Offensive Affinity Override</unit-skill>.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const offensive = passive.abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Offensive Affinity Override'
        )!;
        expect(offensive.conditions).toEqual([
            { subject: 'ally-on-team', derivable: false, buffName: 'Isha' },
        ]);
        const defensive = passive.abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Defensive Affinity Override'
        )!;
        expect(defensive.conditions).toEqual([]);
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

    it('routes a crit-gated granted buff through the on-crit trigger (Lionheart-style)', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals 170% damage. If this critically hits, this Unit gains <unit-skill>Attack Up II</unit-skill> for 1 turn.',
        });
        const active = buildShipAbilities(s).slots.find((sl) => sl.slot === 'active');
        const buff = abilityOfType(active!.abilities, 'buff');
        expect(buff?.config).toMatchObject({ type: 'buff', buffName: 'Attack Up II' });
        // Crit phrasing now routes through the engine's on-crit trigger (the trigger is the
        // gate); the redundant self-crit condition is dropped.
        expect(buff?.trigger).toBe('on-crit');
        expect(buff?.conditions).toEqual([]);
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

    describe('text-order emission', () => {
        it('emits a dot BEFORE the damage ability when the DoT comes first in the skill text', () => {
            const s = ship({
                activeSkillText:
                    'Inflicts 2 <unit-skill>Corrosion II</unit-skill> for 2 turns, then deals <unit-damage>90%</unit-damage> damage.',
            });
            const skills = buildShipAbilities(s);
            const active = skills.slots.find((sl) => sl.slot === 'active')!;
            const types = active.abilities.map((a) => a.type);
            expect(types.indexOf('dot')).toBeGreaterThanOrEqual(0);
            expect(types.indexOf('damage')).toBeGreaterThanOrEqual(0);
            expect(types.indexOf('dot')).toBeLessThan(types.indexOf('damage'));
        });

        it('anchors damage at ITS tag, not an earlier non-damage <unit-damage> tag', () => {
            // A leading defense-penetration tag must not pull the damage ability's
            // position ahead of a DoT that the text places before the damage.
            const s = ship({
                activeSkillText:
                    'This Unit has <unit-damage>20% defense penetration</unit-damage>, inflicts 2 <unit-skill>Corrosion II</unit-skill> for 2 turns, then deals <unit-damage>90% damage</unit-damage>.',
            });
            const active = slot(buildShipAbilities(s).slots, 'active')!;
            const types = active.abilities.map((a) => a.type);
            expect(types.indexOf('dot')).toBeGreaterThanOrEqual(0);
            expect(types.indexOf('dot')).toBeLessThan(types.indexOf('damage'));
        });

        it('keeps damage first when it precedes the DoT in text', () => {
            const s = ship({
                activeSkillText:
                    'Deals <unit-damage>90%</unit-damage> damage and inflicts 2 <unit-skill>Corrosion II</unit-skill> for 2 turns.',
            });
            const skills = buildShipAbilities(s);
            const active = skills.slots.find((sl) => sl.slot === 'active')!;
            const types = active.abilities.map((a) => a.type);
            expect(types.indexOf('damage')).toBeLessThan(types.indexOf('dot'));
        });
    });

    describe('Meiying (enemy-type flat bonus as scaling, not gate)', () => {
        const meiying = ship({
            activeSkillText:
                "This Unit's attack ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill>, dealing <unit-damage>190% damage</unit-damage>, and when attacking a Supporter, it additionally deals <unit-damage>90%</unit-damage> damage.",
            chargeSkillText:
                "This Unit's attack ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill>, dealing <unit-damage>240% damage</unit-damage> and inflicting <unit-skill>Stasis</unit-skill> for 1 turn. When attacking a Supporter, it deals an additional <unit-damage>115% damage</unit-damage>.",
            chargeSkillCharge: 2,
        });

        it('active: damage 190 with a Supporter scaling condition (perUnit 90)', () => {
            const { slots } = buildShipAbilities(meiying);
            const dmg = abilityOfType(slot(slots, 'active')!.abilities, 'damage');
            expect(dmg).toMatchObject({
                config: { type: 'damage', multiplier: 190 },
                scaling: { conditionIndex: 0, perUnit: 90 },
            });
            expect(dmg!.conditions[0]).toMatchObject({
                subject: 'enemy-type',
                derivable: true,
                requiredEnemyType: 'Supporter',
            });
        });

        it('charged: damage 240 with a Supporter scaling condition (perUnit 115)', () => {
            const { slots } = buildShipAbilities(meiying);
            const dmg = abilityOfType(slot(slots, 'charged')!.abilities, 'damage');
            expect(dmg).toMatchObject({
                config: { type: 'damage', multiplier: 240 },
                scaling: { conditionIndex: 0, perUnit: 115 },
            });
            expect(dmg!.conditions[0]).toMatchObject({
                subject: 'enemy-type',
                requiredEnemyType: 'Supporter',
            });
        });
    });

    it('"% more damage for each debuff on the enemy" scales on a DERIVABLE enemy-debuff count', () => {
        // The sim derives enemy debuff counts per round (landed debuffs + DoT entries),
        // so this for-each modifier must track them live, not a manual count.
        const s = ship({
            firstPassiveSkillText:
                'This Unit deals <unit-damage>10% more direct damage</unit-damage> for each debuff on the enemy, up to a max of 50%.',
        });
        const mod = abilityOfType(
            slot(buildShipAbilities(s).slots, 'passive')!.abilities,
            'modifier'
        )!;
        expect(mod.conditions[0]).toMatchObject({ subject: 'enemy-debuff', derivable: true });
        expect(mod.scaling).toMatchObject({ conditionIndex: 0, perUnit: 10, cap: 50 });
    });

    describe('HP-proportional modifiers (Akula / Tithonus)', () => {
        it('Akula passive: outgoing damage scaling with CURRENT enemy HP% (up to 30%)', () => {
            const akula = ship({
                firstPassiveSkillText:
                    "This Unit's attacks don't break <unit-skill>Stasis</unit-skill>. Increases outgoing direct damage by up to 30% based on the target's current HP percentage; the higher the percentage, the more the damage.",
            });
            const { slots } = buildShipAbilities(akula);
            const mod = abilityOfType(slot(slots, 'passive')!.abilities, 'modifier');
            expect(mod).toMatchObject({
                config: { type: 'modifier', channel: 'outgoingDamage', value: 0 },
            });
            expect(mod!.conditions[0]).toMatchObject({
                subject: 'enemy-hp-pct',
                derivable: true,
            });
            expect(mod!.scaling!.conditionIndex).toBe(0);
            expect(mod!.scaling!.perUnit).toBeCloseTo(0.3); // 30 / 100 HP points
            expect(mod!.scaling!.cap).toBe(30);
        });

        it('Tithonus passive: more-damage scaling with MISSING enemy HP, max below 10%', () => {
            const tithonus = ship({
                firstPassiveSkillText:
                    "This Unit <unit-aid>gains 1 extra action</unit-aid> after it <unit-aid>purges</unit-aid> at least 4 <unit-aid>buffs</unit-aid> with a single skill.<br /><br />This Unit gains up to <unit-damage>40% more direct damage</unit-damage> based on the target's missing HP, with the maximum achieved when the target is below 10% HP.",
            });
            const { slots } = buildShipAbilities(tithonus);
            const mod = abilityOfType(slot(slots, 'passive')!.abilities, 'modifier');
            expect(mod).toMatchObject({
                config: { type: 'modifier', channel: 'outgoingDamage', value: 0 },
            });
            expect(mod!.conditions[0]).toMatchObject({
                subject: 'enemy-hp-missing-pct',
                derivable: true,
            });
            // max at 90 missing points → 40/90 per point, capped at 40
            expect(mod!.scaling!.perUnit).toBeCloseTo(40 / 90);
            expect(mod!.scaling!.cap).toBe(40);
            // the "below 10% HP" anchor must NOT also become an hp-threshold gate
            expect(mod!.conditions).toHaveLength(1);
        });
    });

    describe('Judge passive (hp-threshold-gated passive damage)', () => {
        it('passive: damage 60 gated below 50% HP + flat 20% defPen modifier', () => {
            const judge = ship({
                firstPassiveSkillText:
                    'This Unit ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects and has <unit-damage>20% defense penetration</unit-damage><br /><br />At the start of the round, this Unit deals <unit-damage>60% damage</unit-damage> to all enemies with less than 50% HP.',
            });
            const { slots } = buildShipAbilities(judge);
            const passive = slot(slots, 'passive');
            expect(passive).toBeDefined();

            const dmg = abilityOfType(passive!.abilities, 'damage');
            expect(dmg).toMatchObject({ config: { type: 'damage', multiplier: 60 } });
            expect(dmg!.conditions[0]).toMatchObject({
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: 'below',
                hpPercent: 50,
            });

            const mod = abilityOfType(passive!.abilities, 'modifier');
            expect(mod).toMatchObject({
                config: { type: 'modifier', channel: 'defensePenetration', value: 20 },
            });
        });
    });

    describe('reactive trigger reclassification', () => {
        const namedBuff = (abilities: Ability[], name: string): Ability | undefined =>
            abilities.find(
                (a) =>
                    (a.config.type === 'buff' || a.config.type === 'debuff') &&
                    a.config.buffName === name
            );

        it('Hemlock passive charge: on-debuff-inflicted, no condition', () => {
            const s = ship({
                firstPassiveSkillText:
                    'This Unit <unit-aid>gains 1 charge</unit-aid> to its charged skill after it inflicts a <unit-aid>debuff</unit-aid>.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;
            const charge = abilityOfType(passive.abilities, 'charge')!;
            expect(charge.trigger).toBe('on-debuff-inflicted');
            expect(charge.conditions).toEqual([]);
            expect(charge.config).toMatchObject({ type: 'charge', amount: 1 });
        });

        it('Oleander passive charge: on-ally-debuff-inflicted, no condition', () => {
            const s = ship({
                firstPassiveSkillText:
                    "When an ally inflicts a debuff, this Unit <unit-aid>adds 1 charge</unit-aid> to it's Charged Skill.",
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;
            const charge = abilityOfType(passive.abilities, 'charge')!;
            expect(charge.trigger).toBe('on-ally-debuff-inflicted');
            expect(charge.conditions).toEqual([]);
        });

        it('Enforcer passive debuff: on-crit, no self-crit condition', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When this Unit critically hits an enemy it inflicts <unit-skill>Defense Shred</unit-skill> for 3 turns.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;
            const debuff = namedBuff(passive.abilities, 'Defense Shred')!;
            expect(debuff.trigger).toBe('on-crit');
            expect(debuff.conditions).toEqual([]);
        });

        it('Wusheng passive buff: on-crit, no self-crit condition', () => {
            const s = ship({
                firstPassiveSkillText:
                    'This Unit gains <unit-skill>Stealth</unit-skill> for 1 turn after critically damaging an enemy.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;
            const buff = namedBuff(passive.abilities, 'Stealth')!;
            expect(buff.trigger).toBe('on-crit');
            expect(buff.conditions).toEqual([]);
        });

        it('Valkyrie passive buff: start-of-round, duration kept', () => {
            const s = ship({
                firstPassiveSkillText:
                    'This Unit gains <unit-skill>Speed Up II</unit-skill> for 1 turn at the start of the round.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;
            const buff = namedBuff(passive.abilities, 'Speed Up II')!;
            expect(buff.trigger).toBe('start-of-round');
            expect(buff.config).toMatchObject({ type: 'buff', duration: 1 });
        });

        it('Lingshe passive buff: on-bomb-detonated', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When this Unit detonates a <unit-skill>Bomb</unit-skill> it gains <unit-skill>Stealth</unit-skill> for 1 turn.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;
            const buff = namedBuff(passive.abilities, 'Stealth')!;
            expect(buff.trigger).toBe('on-bomb-detonated');
        });
    });

    describe('parser ally-scope (team walk)', () => {
        const namedBuff = (abilities: Ability[], name: string): Ability | undefined =>
            abilities.find((a) => a.config.type === 'buff' && a.config.buffName === name);

        it('all-allies grant produces a buff ability with target all-allies', () => {
            const s = ship({
                activeSkillText:
                    'all allies gain <unit-skill>Attack Up III</unit-skill> for 2 turns.',
            });
            const active = slot(buildShipAbilities(s).slots, 'active')!;
            const buff = namedBuff(active.abilities, 'Attack Up III')!;
            expect(buff.target).toBe('all-allies');
        });

        it('self gain produces a buff ability with target self', () => {
            const s = ship({
                activeSkillText:
                    'This Unit gains <unit-skill>Attack Up III</unit-skill> for 2 turns.',
            });
            const active = slot(buildShipAbilities(s).slots, 'active')!;
            const buff = namedBuff(active.abilities, 'Attack Up III')!;
            expect(buff.target).toBe('self');
        });

        it('single-ally grant produces a buff ability with target ally', () => {
            const s = ship({
                activeSkillText:
                    'This Unit grants the ally with the highest Attack <unit-skill>Attack Up III</unit-skill> for 2 turns.',
            });
            const active = slot(buildShipAbilities(s).slots, 'active')!;
            const buff = namedBuff(active.abilities, 'Attack Up III')!;
            expect(buff.target).toBe('ally');
        });
    });

    it('Chakara third passive: round-start damage proc parses as a passive damage ability', () => {
        const s = ship({
            thirdPassiveSkillText:
                'This Unit starts each round with <unit-skill>Attack Up II</unit-skill> and <unit-skill>Defense Up II</unit-skill> for 1 turn if it has the lowest speed among all Allies. Then, deals <unit-damage>60% damage</unit-damage> to the highest Speed Enemy.',
        });
        const skills = buildShipAbilities(s);
        const passive = skills.slots.find((sl) => sl.slot === 'passive');
        const dmg = passive?.abilities.find((a) => a.type === 'damage');
        expect(dmg).toMatchObject({ config: { type: 'damage', multiplier: 60 } });
    });

    describe('extra-action abilities from text', () => {
        it('Liberator third passive: once-per-round extra action on-enemy-destroyed in passive slot', () => {
            const s = ship({
                thirdPassiveSkillText:
                    'This Unit has 40% Shield Penetration. When an enemy dies, all allies <unit-aid>add 1 charge</unit-aid> to their Charged Skills, and once per round, this unit gains 1 extra action.',
                chargeSkillCharge: 4,
            });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive');
            expect(passive).toBeDefined();
            const extraAction = abilityOfType(passive!.abilities, 'extra-action');
            // Phase 4b Task 10: the sentence's "When an enemy dies" scopes the grant to the
            // on-enemy-destroyed death trigger (previously stamped on-cast pre-Task-10).
            expect(extraAction).toMatchObject({
                target: 'self',
                trigger: 'on-enemy-destroyed',
                conditions: [],
                config: { type: 'extra-action', oncePerRound: true },
            });
        });

        it('Nuqtu charged: extra action gated on enemy having 3+ buffs', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit deals <unit-damage>200% damage</unit-damage>, including additional Damage equal to <unit-damage>80%</unit-damage> of its Defense, and an extra 40% for each buff on the enemy. If the target has 3 or more buffs, this Unit grants itself 1 extra End Of Round Action.',
                chargeSkillCharge: 4,
            });
            const { slots } = buildShipAbilities(s);
            const charged = slot(slots, 'charged');
            expect(charged).toBeDefined();
            const extraAction = abilityOfType(charged!.abilities, 'extra-action');
            expect(extraAction).toMatchObject({
                target: 'self',
                trigger: 'on-cast',
                conditions: [
                    {
                        subject: 'enemy-buff',
                        derivable: true,
                        countComparator: 'gte',
                        countThreshold: 3,
                    },
                ],
                config: { type: 'extra-action', oncePerRound: false },
            });
        });
    });

    it('Crocus passive: TAGGED text variant parses the reactive trigger + default duration', () => {
        const s = ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            secondPassiveSkillText:
                'When another ally inflicts a Damage Over Time (DoT) effect with a critical hit, this Unit <unit-damage>repairs itself for 3%</unit-damage> of its Max HP and inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns on that enemy.',
        });
        const skills = buildShipAbilities(s);
        const passive = skills.slots.find((sl) => sl.slot === 'passive');
        const dot = passive?.abilities.find((a) => a.type === 'dot');
        expect(dot).toMatchObject({
            trigger: 'on-ally-crit-dot',
            conditions: [],
            config: { type: 'dot', dotType: 'corrosion', duration: 2 },
        });
    });

    describe('heal/shield/cleanse emission', () => {
        it('emits heal abilities with text-position ordering', () => {
            const s = ship({
                activeSkillText:
                    "This unit deals <unit-damage>120% damage</unit-damage> and <unit-damage>repairs the ally for 4%</unit-damage> of this Unit's Max HP.",
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const heal = active?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                target: 'ally',
                trigger: 'on-cast',
                config: { type: 'heal', pct: 4, basis: 'hp' },
                autoFilled: true,
            });
            expect(active!.abilities[0].type).toBe('damage'); // damage tag precedes the repair
        });

        it('emits shield abilities', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit gains a <unit-damage>Shield equal to 30%</unit-damage> of its Max HP.',
            });
            const charged = buildShipAbilities(s).slots.find((x) => x.slot === 'charged');
            const shield = charged?.abilities.find((a) => a.type === 'shield');
            expect(shield).toMatchObject({
                target: 'self',
                trigger: 'on-cast',
                config: { type: 'shield', pct: 30, basis: 'hp' },
                autoFilled: true,
            });
        });

        it('APEX refit-active passive: shield-on-debuff rides on-debuff-inflicted', () => {
            // APEX's active inflicts Speed Down II / Crit Power Down III — those own
            // inflictions supply the on-debuff-inflicted events that fire this shield grant.
            const s = ship({
                firstPassiveSkillText:
                    'This Unit gains a <unit-damage>Shield equal to 3%</unit-damage> of their Max HP when an enemy gets debuffed.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const shield = passive?.abilities.find((a) => a.type === 'shield');
            expect(shield).toMatchObject({
                type: 'shield',
                target: 'self',
                trigger: 'on-debuff-inflicted',
                config: { type: 'shield', pct: 3, basis: 'hp' },
            });
        });

        it('emits cleanse abilities', () => {
            const s = ship({
                activeSkillText:
                    'This Unit <unit-aid>cleanses 1</unit-aid> debuff from all allies.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const cleanse = active?.abilities.find((a) => a.type === 'cleanse');
            expect(cleanse).toMatchObject({
                target: 'all-allies',
                trigger: 'on-cast',
                config: { type: 'cleanse', count: 1 },
                autoFilled: true,
            });
        });

        it('heal noCrit flows from parseHealNoCrit', () => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>150% damage</unit-damage> and repairs itself for 5% of its Max HP. This repair cannot critically hit.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const heal = active?.abilities.find((a) => a.type === 'heal');
            expect(heal?.config).toMatchObject({ type: 'heal', noCrit: true });
            const damage = active?.abilities.find((a) => a.type === 'damage');
            // The repair no-crit must NOT bleed onto the attack damage.
            expect((damage?.config as { noCrit?: boolean }).noCrit).toBeUndefined();
        });

        it('damage-taken shield emits a leech shield (basis damage-taken)', () => {
            // Damage-leech shields/heals are now PARSED (basis 'damage-taken'/'damage-dealt');
            // they used to emit nothing. The leech-field threading (requiresHpDamage / leechScope)
            // lands in the buildShipAbilities task and is asserted there.
            const s = ship({
                activeSkillText:
                    'This Unit gains a Shield equal to 25% of the damage taken when taking HP damage.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const shield = active?.abilities.find((a) => a.type === 'shield');
            expect(shield?.config).toMatchObject({
                type: 'shield',
                pct: 25,
                basis: 'damage-taken',
            });
        });
    });

    // One-target-per-skill game rule (user-verified 2026-06-07, Hermes/Isha live-verification
    // bug): a bare repair/cleanse (no target phrase) on a PURE-SUPPORT active/charged skill
    // (no damage component) targets the ally, not the caster. The parser defaults bare to
    // 'self'; the flip lives in abilitiesFromText where the slot + damage component are known.
    describe('bare repair/cleanse flip to ally on pure-support active/charged skills', () => {
        it('Hermes active bare repair → heal target ally', () => {
            const s = ship({ activeSkillText: 'This Unit Repairs 27% of its Max HP.' });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const heal = active?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'ally',
                trigger: 'on-cast',
                config: { type: 'heal', pct: 27, basis: 'hp' },
            });
        });

        it('Hermes charged bare repair → heal target ally; charge still parses', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit repairs 37% of its Max HP and adds 1 charge to the Charged Skill. If the target has less than 40% HP, it grants Cheat Death.',
                chargeSkillCharge: 4,
            });
            const charged = buildShipAbilities(s).slots.find((x) => x.slot === 'charged');
            const heal = charged?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'ally',
                config: { type: 'heal', pct: 37, basis: 'hp' },
            });
            const charge = charged?.abilities.find((a) => a.type === 'charge');
            expect(charge).toMatchObject({ type: 'charge', config: { type: 'charge', amount: 1 } });
        });

        it('damage-rider bare repair stays self (skill has a damage component)', () => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>160% damage</unit-damage> and repairs 9% of its Max HP.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const heal = active?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({ type: 'heal', target: 'self' });
        });

        it('passive bare repair stays self', () => {
            const s = ship({
                firstPassiveSkillText: 'This unit repairs 5% of its Max HP every turn.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const heal = passive?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({ type: 'heal', target: 'self' });
        });

        it('explicit "repairs itself" on a pure-support active stays self (explicit wins)', () => {
            const s = ship({
                activeSkillText: 'This Unit repairs itself for 30% of its Max HP.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const heal = active?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({ type: 'heal', target: 'self' });
        });

        it('bare cleanse on a pure-support active → ally; cleanse on a damage skill → self', () => {
            const support = ship({
                activeSkillText: 'This Unit <unit-aid>cleanses 1</unit-aid> debuff.',
            });
            const supportActive = buildShipAbilities(support).slots.find(
                (x) => x.slot === 'active'
            );
            const supportCleanse = supportActive?.abilities.find((a) => a.type === 'cleanse');
            expect(supportCleanse).toMatchObject({ type: 'cleanse', target: 'ally' });

            const damage = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>150% damage</unit-damage> and <unit-aid>cleanses 1</unit-aid> debuff.',
            });
            const damageActive = buildShipAbilities(damage).slots.find((x) => x.slot === 'active');
            const damageCleanse = damageActive?.abilities.find((a) => a.type === 'cleanse');
            expect(damageCleanse).toMatchObject({ type: 'cleanse', target: 'self' });
        });

        it('bare shield on a pure-support active stays self (shields not flipped)', () => {
            const s = ship({
                activeSkillText: 'This Unit gains a Shield equal to 30% of its Max HP.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const shield = active?.abilities.find((a) => a.type === 'shield');
            expect(shield).toMatchObject({ type: 'shield', target: 'self' });
        });

        // User-verified 2026-06-07: a bare repair whose OWN sentence is gated on a self-damage
        // condition ("if this unit has been directly damaged this round") is a SELF-heal — the caster
        // tanks damage and heals itself. The flip to 'ally' must NOT apply even though the skill has
        // no damage component and no explicit target phrase.
        it('Meatshield active: self-damage-conditional bare repair stays self (real text)', () => {
            const s = ship({
                activeSkillText:
                    'This Unit gains <unit-skill>Inc. Repair Up III</unit-skill> for 2 turns.<br /><br /> If this Unit has been directly damaged this round, it <unit-damage>repairs 5%</unit-damage> of its max HP.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const heal = active?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'self',
                config: { type: 'heal', pct: 5, basis: 'hp' },
            });
        });

        // Regression lock: Oleander's active has no self-damage conditional in the repair sentence,
        // so the flip to 'ally' still applies (user-confirmed correct 2026-06-07).
        it('Oleander active: bare repair without self-damage condition → still flips to ally (regression)', () => {
            const s = ship({
                activeSkillText:
                    'This Unit grants <unit-skill>Hacking Up III</unit-skill> for 2 turns and <unit-damage>repairs 100%</unit-damage> of its Max HP, with an additional <unit-damage>8.5%</unit-damage> repair for each debuffed enemy.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const heal = active?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'ally',
                config: { type: 'heal', pct: 100, basis: 'hp' },
            });
        });
    });

    // Cleanse-triggered & ally-damage-triggered PASSIVE repairs resolve their real recipient
    // (user-verified 2026-06-07). A bare passive repair (no explicit recipient phrase) is normally
    // a self-heal, but two trigger shapes flip it to the ally: (A) an "when an ally … damaged"
    // trigger always heals that damaged ally; (B) a cleanse-trigger heals the cleansed ALLY only
    // when the caster is a SUPPORTER (supporters cleanse allies), staying SELF for other roles
    // (defenders cleanse themselves). Canonical cases: Cultivator (SUPPORTER) vs Morao (DEFENDER).
    // Role is read from `ship.type` (the ship-class field); fixtures set it explicitly per case.
    describe('cleanse/ally-damage-triggered passive repair recipient', () => {
        it('Cultivator clause 1: cleanse-trigger on a SUPPORTER passive → ally heal', () => {
            const s = ship({
                type: 'SUPPORTER',
                thirdPassiveSkillText:
                    "When this unit cleanses a debuff it also repairs 4% of this unit's max HP.",
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const heal = passive?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'ally',
                config: { type: 'heal', pct: 4, basis: 'hp' },
            });
        });

        it('Cultivator clause 2: on-ally-directly-damaged passive repair is an unmodeled reactive trigger → NOT emitted', () => {
            // The engine doesn't model an on-ally-damaged trigger, so emitting this heal would
            // make it fire EVERY round (phantom). It's disqualified in parseHealAbilities until a
            // live trigger exists (Phase 4b/4c). The HP basis (not leech) is what makes it a phantom.
            const s = ship({
                type: 'SUPPORTER',
                thirdPassiveSkillText:
                    "When an ally is directly damaged within the active pattern, this unit repairs 8% of this unit's max HP.",
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const heal = passive?.abilities.find((a) => a.type === 'heal');
            expect(heal).toBeUndefined();
        });

        it('Morao: cleanse-trigger on a DEFENDER passive → both repairs stay self', () => {
            const s = ship({
                type: 'DEFENDER',
                thirdPassiveSkillText:
                    'This Unit repairs 5% of its max HP every turn and, upon cleansing a debuff, repairs an additional 50% of its max HP while gaining Defense Up 2 for 2 turns.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const heals = passive?.abilities.filter((a) => a.type === 'heal') ?? [];
            expect(heals).toHaveLength(2);
            for (const heal of heals) {
                expect(heal.target).toBe('self');
            }
            expect(
                heals.map((h) => (h.config as { pct: number }).pct).sort((a, b) => a - b)
            ).toEqual([5, 50]);
        });

        it('Anemone: enemy-DoT-trigger passive repair stays self (not an ally trigger)', () => {
            const s = ship({
                type: 'DEBUFFER',
                thirdPassiveSkillText:
                    "When an enemy takes damage from a Damage over Time effect, repair 5% of this Unit's Max HP.",
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const heal = passive?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({ type: 'heal', target: 'self' });
        });
    });

    // Phase 4c PR 1 (Task 7): SELF-subject damage-reaction heals ride the on-attacked
    // reactive trigger. A "while below N% HP" gate becomes a DERIVABLE self hp-threshold
    // condition (evaluated against live tank HP at drain time); Isha's instead-on-crit
    // pair maps to triggerCritFilter 'non-crit' / 'crit'.
    describe('self-subject damage-reaction heals → on-attacked (Phase 4c)', () => {
        // Makoli and Guardian share this CSV first_passive_skill_text byte-identically.
        it('Makoli/Guardian first passive (identical CSV text): heal rides on-attacked with a derivable below-40% self hp-threshold', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When directly damaged while below 40% HP, this Unit <unit-damage>repairs 20%</unit-damage> of its Max HP.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const heal = passive?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'self',
                trigger: 'on-attacked',
                config: { type: 'heal', pct: 20, basis: 'hp' },
            });
            expect(heal!.triggerCritFilter).toBeUndefined();
            expect(heal!.conditions).toEqual([
                {
                    subject: 'hp-threshold',
                    derivable: true,
                    hpComparator: 'below',
                    hpPercent: 40,
                    hpSubject: 'self',
                },
            ]);
        });

        it('Isha second passive (CSV second_passive_skill_text): instead-on-crit pair maps to triggerCritFilter non-crit (3%) / crit (6%)', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When directly damaged, this Unit <unit-damage>repairs 3%</unit-damage> of its max HP, but when criticall hit, it instead <unit-damage>repairs 6%</unit-damage> of its max HP.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const heals = passive?.abilities.filter((a) => a.type === 'heal') ?? [];
            expect(heals).toHaveLength(2);
            const nonCrit = heals.find((h) => (h.config as { pct: number }).pct === 3);
            const crit = heals.find((h) => (h.config as { pct: number }).pct === 6);
            expect(nonCrit).toMatchObject({
                type: 'heal',
                target: 'self',
                trigger: 'on-attacked',
                triggerCritFilter: 'non-crit',
                conditions: [],
                config: { type: 'heal', pct: 3, basis: 'hp' },
            });
            expect(crit).toMatchObject({
                type: 'heal',
                target: 'self',
                trigger: 'on-attacked',
                triggerCritFilter: 'crit',
                conditions: [],
                config: { type: 'heal', pct: 6, basis: 'hp' },
            });
        });

        it('Heliodor first passive: ungated self repair rides on-attacked with no conditions', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When directly damaged, this Unit reduces the duration of all active <unit-aid>Debuffs</unit-aid> on itself by 1 turn and <unit-damage>repairs itself for 8%</unit-damage> of its Max HP.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const heal = passive?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'self',
                trigger: 'on-attacked',
                conditions: [],
                config: { type: 'heal', pct: 8, basis: 'hp' },
            });
            expect(heal!.triggerCritFilter).toBeUndefined();
        });

        it('Heliodor SECOND passive (ally recipient): still emits NO heal (PR 2 scope)', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When directly damaged, this Unit reduces the duration of all active <unit-aid>Debuffs</unit-aid> on all allies by 1 turn and repairs them for 8% of its Max HP.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const heal = passive?.abilities.find((a) => a.type === 'heal');
            expect(heal).toBeUndefined();
        });
    });

    // Phase 4c PR 1 (Task 8): non-heal damage reactions. Self-subject reaction sentences
    // route their buff grants / debuff inflictions through the LIVE on-attacked trigger
    // (+ triggerCritFilter for "is critically hit") instead of registering as unconditional
    // per-round auras. A damage-reaction DoT infliction (Warden/Shepherd Corrosion) becomes a
    // name-only DEBUFF — counter-DoT tick damage against the enemy attacker is deliberately
    // unsimulated (spec §3.5); the named status stays visible + condition-relevant.
    describe('non-heal damage reactions → on-attacked (Phase 4c Task 8)', () => {
        const passiveOf = (s: Ship): Skill | undefined =>
            buildShipAbilities(s).slots.find((x) => x.slot === 'passive');

        it('Warden passive: Corrosion I is a name-only on-attacked DEBUFF, not a dot', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns on that enemy and repairs itself 3% of its Max HP.',
            });
            const passive = passiveOf(s);
            const debuff = passive?.abilities.find((a) => a.type === 'debuff');
            expect(debuff).toMatchObject({
                type: 'debuff',
                target: 'enemy',
                trigger: 'on-attacked',
                conditions: [],
                config: {
                    type: 'debuff',
                    buffName: 'Corrosion I',
                    parsedEffects: {},
                    duration: 2,
                    application: 'inflict',
                },
            });
            expect(debuff!.triggerCritFilter).toBeUndefined();
            // NO dot ability anywhere (the counter-DoT tick is unsimulated), and the
            // repair still rides on-attacked (Task 7) — no on-cast/recurring phantom.
            const all = buildShipAbilities(s).slots.flatMap((x) => x.abilities);
            expect(all.filter((a) => a.type === 'dot')).toHaveLength(0);
            expect(all.filter((a) => a.trigger === 'on-cast')).toHaveLength(0);
            expect(passive?.abilities.find((a) => a.type === 'heal')).toMatchObject({
                trigger: 'on-attacked',
            });
        });

        it('Warden charged: on-cast Corrosion II still parses as a dot (no debuff card)', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit deals <unit-damage>200% damage</unit-damage> and inflicts <unit-skill>Corrosion II</unit-skill> for 3 turns.',
                chargeSkillCharge: 2,
            });
            const charged = buildShipAbilities(s).slots.find((x) => x.slot === 'charged');
            expect(charged?.abilities.find((a) => a.type === 'dot')).toMatchObject({
                trigger: 'on-cast',
                config: { type: 'dot', dotType: 'corrosion', tier: 6, duration: 3 },
            });
            expect(charged?.abilities.find((a) => a.type === 'debuff')).toBeUndefined();
        });

        it('Yarrow active (negative guard): plain on-cast Corrosion I stays a dot exactly as today', () => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>110% damage</unit-damage> and inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            expect(active?.abilities.find((a) => a.type === 'dot')).toMatchObject({
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'dot', dotType: 'corrosion', tier: 3, stacks: 1, duration: 2 },
            });
            const all = buildShipAbilities(s).slots.flatMap((x) => x.abilities);
            expect(all.filter((a) => a.type === 'debuff')).toHaveLength(0);
        });

        it('Guardian second passive: Binderburg grant rides on-attacked with crit filter; ally-Provoke sentence emits nothing new', () => {
            const s = ship({
                refits: [{}, {}] as Ship['refits'],
                secondPassiveSkillText:
                    'This Unit has 20% shield penetration. When this Unit is critically hit, it gains <unit-skill>Binderburg Resilience I</unit-skill> for 1 turn.<br /><br />When an ally is critically hit by an enemy, apply <unit-skill>Provoke</unit-skill> for 1 turn to that enemy.',
            });
            const passive = passiveOf(s);
            const buff = passive?.abilities.find((a) => a.type === 'buff');
            expect(buff).toMatchObject({
                type: 'buff',
                target: 'self',
                trigger: 'on-attacked',
                triggerCritFilter: 'crit',
                conditions: [],
                config: { type: 'buff', buffName: 'Binderburg Resilience I', duration: 1 },
            });
            // The ally-subject Provoke sentence is PR 2 scope: the debuff keeps its
            // pre-existing on-cast emission with the manual (off-by-default) self-debuff
            // Provoke condition — no on-attacked trigger, no crit filter, nothing new.
            const provoke = passive?.abilities.find(
                (a) =>
                    a.type === 'debuff' &&
                    (a.config as { buffName?: string }).buffName === 'Provoke'
            );
            expect(provoke).toMatchObject({
                trigger: 'on-cast',
                conditions: [{ subject: 'self-debuff', buffName: 'Provoke', derivable: false }],
            });
            expect(provoke!.triggerCritFilter).toBeUndefined();
        });

        it('Shepherd passive: Corrosion I name-only debuff AND Attack Down I both ride on-attacked', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> and <unit-skill>Attack Down I</unit-skill> on its attacker for 1 turn.',
            });
            const passive = passiveOf(s);
            const debuffs = passive?.abilities.filter((a) => a.type === 'debuff') ?? [];
            expect(
                debuffs.map((a) => [(a.config as { buffName: string }).buffName, a.trigger])
            ).toEqual(
                expect.arrayContaining([
                    ['Corrosion I', 'on-attacked'],
                    ['Attack Down I', 'on-attacked'],
                ])
            );
            expect(passive?.abilities.find((a) => a.type === 'dot')).toBeUndefined();
        });

        it('Opal second passive: counter-debuff AND self-buff in the reaction sentence both flip', () => {
            const s = ship({
                refits: [{}, {}] as Ship['refits'],
                secondPassiveSkillText:
                    'When directly damaged, this Unit Inflicts <unit-skill>Attack Down II</unit-skill> for 3 turns and Gains <unit-skill>Defense Up II</unit-skill> for 1 turn.',
            });
            const passive = passiveOf(s);
            expect(passive?.abilities.find((a) => a.type === 'debuff')).toMatchObject({
                trigger: 'on-attacked',
                config: { buffName: 'Attack Down II' },
            });
            expect(passive?.abilities.find((a) => a.type === 'buff')).toMatchObject({
                trigger: 'on-attacked',
                config: { buffName: 'Defense Up II' },
            });
        });

        it('Flamel first passive: trailing "when directly damaged" flips Speed Down I', () => {
            const s = ship({
                firstPassiveSkillText:
                    'This Unit inflicts <unit-skill>Speed Down I</unit-skill> for 2 turns when directly damaged.',
            });
            const debuff = passiveOf(s)?.abilities.find((a) => a.type === 'debuff');
            expect(debuff).toMatchObject({
                trigger: 'on-attacked',
                config: { buffName: 'Speed Down I', duration: 2 },
            });
        });

        it('Iridium first passive: Speed Down I flips; Panguan Stealth flips (aura phantom removed)', () => {
            const iridium = ship({
                firstPassiveSkillText:
                    'When directly damaged, This Unit <unit-aid>purges 1</unit-aid> buff from the enemy and inflicts <unit-skill>Speed Down I</unit-skill> for 1 turn.',
            });
            expect(passiveOf(iridium)?.abilities.find((a) => a.type === 'debuff')).toMatchObject({
                trigger: 'on-attacked',
                config: { buffName: 'Speed Down I' },
            });
            const panguan = ship({
                firstPassiveSkillText:
                    'This Unit Gains <unit-skill>Stealth</unit-skill> for 2 turns when directly damaged.',
            });
            expect(passiveOf(panguan)?.abilities.find((a) => a.type === 'buff')).toMatchObject({
                trigger: 'on-attacked',
                config: { buffName: 'Stealth' },
            });
        });

        it('Stalwart: Legion Discipline II grant in the reaction sentence flips to on-attacked', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When this Unit is directly damaged as a primary target, it deals <unit-damage>30% damage</unit-damage> to that enemy and gains <unit-skill>Legion Discipline II</unit-skill> for 3 turns.',
            });
            expect(passiveOf(s)?.abilities.find((a) => a.type === 'buff')).toMatchObject({
                trigger: 'on-attacked',
                config: { buffName: 'Legion Discipline II' },
            });
        });

        it('Makoli second passive: the Disable counter-infliction flips to on-attacked', () => {
            // NOTE: the "while below 40% HP" gate stays on the HEAL only (Task 7's
            // damageReaction.hpBelowPct); the detector deliberately carries no hp gate, so
            // Disable fires on every received attack. Still strictly better than the
            // previous unconditional per-round aura.
            const s = ship({
                refits: [{}, {}] as Ship['refits'],
                secondPassiveSkillText:
                    'When directly damaged while below 40% HP, this Unit <unit-damage>repairs 20%</unit-damage> of its Max HP and inflicts <unit-skill>Disable</unit-skill> for 1 turn.',
            });
            expect(passiveOf(s)?.abilities.find((a) => a.type === 'debuff')).toMatchObject({
                trigger: 'on-attacked',
                config: { buffName: 'Disable' },
            });
        });

        it('Provider (negative): ally-inflicts sentence with "cannont critically hit" is unchanged', () => {
            const s = ship({
                refits: [{}, {}] as Ship['refits'],
                secondPassiveSkillText:
                    'This Unit has 20% Shield Penetration. When another ally inflicts a debuff onto an enemy, this unit deals <unit-damage>50% damage</unit-damage> to that enemy that cannont critically hit and inflict <unit-skill>Crit Rate Down II</unit-skill> for 1 turn.',
            });
            const debuff = passiveOf(s)?.abilities.find((a) => a.type === 'debuff');
            expect(debuff?.trigger).toBe('on-cast');
            expect(debuff?.triggerCritFilter).toBeUndefined();
            expect(debuff?.conditions).toEqual([
                { subject: 'ally-inflicts-debuff', derivable: false },
            ]);
        });

        it('Refine (negative): ally-subject reaction grant stays unchanged (PR 2)', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When an ally is directly damaged, this Unit grants <unit-skill>Inc. Damage Down I</unit-skill> for 1 turn.',
            });
            const buff = passiveOf(s)?.abilities.find((a) => a.type === 'buff');
            expect(buff?.trigger).toBe('on-cast');
            expect(buff?.triggerCritFilter).toBeUndefined();
        });

        it('Wusheng (negative): active-voice self-crit Stealth keeps on-crit, not on-attacked', () => {
            const s = ship({
                refits: [{}, {}] as Ship['refits'],
                secondPassiveSkillText:
                    'This Unit gains <unit-skill>Stealth</unit-skill> for 1 turn after critically damaging an enemy.<br /><br />This Unit reduces direct damage by 25% while <unit-skill>Stealth</unit-skill> is active. If directly damaged while <unit-skill>Stealth</unit-skill> is active, remove <unit-skill>Stealth</unit-skill>.<br /><br />This Unit starts combat fully charged.',
            });
            const buff = passiveOf(s)?.abilities.find((a) => a.type === 'buff');
            expect(buff).toMatchObject({ trigger: 'on-crit', config: { buffName: 'Stealth' } });
        });
    });

    describe('Pallas-pattern ally-crit reactive triggers', () => {
        // Real Pallas passive shape: a defense buff, then "when an ally critically hits" (charge +
        // Everliving Regeneration buff), then "when this unit critically repairs an ally" (cleanse).
        const PALLAS_TEXT =
            "This Unit's Defense is increased by 20%. When an ally critically hits an enemy, this unit gains 1 charge to its charged skill and Everliving Regeneration 3 for 2 turns. Additionally, when this unit critically repairs an ally, it cleanses 1 debuff from itself.";

        it('cleanse rides on-ally-critically-repaired', () => {
            const s = ship({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                refits: [{}, {}] as any,
                firstPassiveSkillText: PALLAS_TEXT,
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const cleanse = passive?.abilities.find((a) => a.type === 'cleanse');
            expect(cleanse).toMatchObject({
                type: 'cleanse',
                target: 'self',
                trigger: 'on-ally-critically-repaired',
                conditions: [],
                config: { type: 'cleanse', count: 1 },
            });
        });

        it('charge rides on-ally-crit (trigger is the gate → no gating condition)', () => {
            const s = ship({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                refits: [{}, {}] as any,
                firstPassiveSkillText: PALLAS_TEXT,
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const charge = passive?.abilities.find((a) => a.type === 'charge');
            expect(charge).toMatchObject({
                type: 'charge',
                trigger: 'on-ally-crit',
                conditions: [],
                config: { type: 'charge', amount: 1 },
            });
        });

        // The conjoined grant "gains 1 charge … and Everliving Regeneration 3 for 2 turns" parses:
        // the buff name sits after "and" with no governing verb directly before it (the verb "gains"
        // is consumed by "gains 1 charge"), so the primary segment-loop emitter misses it. A
        // supplementary BUFFS-gated conjoined-grant scan in parseSkillEffects emits it (buffName
        // normalized "3" → "III" to match the BUFFS entry), and the buff-merge loop attaches the
        // on-ally-crit reactive trigger detected on the clause — no engine change needed.
        it('Everliving Regeneration buff parses and rides on-ally-crit (conjoined grant)', () => {
            const s = ship({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                refits: [{}, {}] as any,
                firstPassiveSkillText: PALLAS_TEXT,
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const buff = passive?.abilities.find((a) => a.type === 'buff');
            expect(buff).toMatchObject({
                type: 'buff',
                target: 'self',
                trigger: 'on-ally-crit',
                config: { buffName: 'Everliving Regeneration III', duration: 2 },
            });
        });

        // A heal in the crit-repair sentence rides on-ally-critically-repaired; an UNRELATED heal
        // elsewhere stays on-cast (sentence scoping).
        it('crit-repair heal rides the trigger; an unrelated heal stays on-cast (distinct anchors)', () => {
            // Each heal carries its own <unit-damage> tag at a distinct pct so the position anchors
            // land in the correct sentence (the position-scoped detector then stamps only the heal
            // inside the crit-repair sentence).
            const s = ship({
                activeSkillText:
                    'This Unit <unit-damage>repairs the ally for 4%</unit-damage> of its Max HP. When this unit critically repairs an ally, it <unit-damage>repairs itself for 7%</unit-damage> of its Max HP.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const heals = active?.abilities.filter((a) => a.type === 'heal') ?? [];
            const byPct = new Map(heals.map((h) => [(h.config as { pct: number }).pct, h.trigger]));
            expect(byPct.get(4)).toBe('on-cast');
            expect(byPct.get(7)).toBe('on-ally-critically-repaired');
        });
    });

    // Damage-leech: passive-slot damage-dealt heals carry a default leechScope 'all' (direct + DoT
    // ticks + detonations, per user decision); cast riders (active/charged) carry NO scope. Shields
    // never flip target; current in-scope ships have no passive-slot damage-dealt shields, so
    // leechScope doesn't appear on shield configs in practice (but the type permits it — the engine's
    // standing-leech hook reads scope for shields too). The damage-taken punch-through flag
    // (requiresHpDamage) only threads onto shields parsed from damage-taken text.
    describe('damage-leech ships', () => {
        it('Magnolia: passive standing leech → self heal, basis damage-dealt, scope all', () => {
            const s = ship({
                firstPassiveSkillText:
                    'This Unit <unit-damage>repairs itself for 20%</unit-damage> of the damage it deals to enemies.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const heal = passive?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'self',
                config: { type: 'heal', pct: 20, basis: 'damage-dealt', leechScope: 'all' },
            });
        });

        it('Valerian: DoT-inclusive passive text parses identically (scope all, damage-DEALT)', () => {
            const s = ship({
                firstPassiveSkillText:
                    'This Unit <unit-damage>repairs 15%</unit-damage> of Damage dealt to the enemy, including inflcted Damage over Time effects.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const heal = passive?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'self',
                config: { type: 'heal', pct: 15, basis: 'damage-dealt', leechScope: 'all' },
            });
        });

        it('Iridium: active rider → self heal damage-dealt, NO leechScope (active slot)', () => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>40% damage</unit-damage> with additional <unit-damage>damage equal to 9%</unit-damage> of its max HP and <unit-damage>repairs 15%</unit-damage> of the damage dealt.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const heal = active?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'self',
                config: { type: 'heal', pct: 15, basis: 'damage-dealt' },
            });
            expect((heal?.config as { leechScope?: string }).leechScope).toBeUndefined();
        });

        it('Tithonus: active all-allies leech + skill-wide noCrit', () => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-aid>purges 2 buffs</unit-aid> from the enemy and deals <unit-damage>170% damage</unit-damage>.<br /><br /> Then <unit-damage>repairs all allies 7%</unit-damage> of the damage dealt. This repair cannot critically hit.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const heal = active?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'all-allies',
                config: { type: 'heal', pct: 7, basis: 'damage-dealt', noCrit: true },
            });
        });

        it('Pallas: active "heals for" verb → ally leech + noCrit', () => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>200% damage</unit-damage>. The other ally with the lowest current health percentage heals for 20% of the damage dealt and this repair cannot critically hit.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const heal = active?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'ally',
                config: { type: 'heal', pct: 20, basis: 'damage-dealt', noCrit: true },
            });
        });

        it('Valkyrie: passive detonation dual-recipient → ally + self leech, scope detonation', () => {
            const s = ship({
                firstPassiveSkillText:
                    'This Unit gains <unit-skill>Speed Up II</unit-skill> for 1 turn at the start of the round.<br /><br />When an <unit-aid>Echoing Burst</unit-aid> explodes on an enemy, this Unit and the ally with the lowest current health percentage <unit-damage>repair 5%</unit-damage> of damage dealt.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const heals = passive?.abilities.filter((a) => a.type === 'heal') ?? [];
            expect(heals).toHaveLength(2);
            for (const heal of heals) {
                expect(heal.config).toMatchObject({
                    type: 'heal',
                    pct: 5,
                    basis: 'damage-dealt',
                    leechScope: 'detonation',
                });
            }
            expect(heals.map((h) => h.target).sort()).toEqual(['ally', 'self']);
        });

        it('Quixilver active: shield self, basis damage-dealt, no leechScope', () => {
            const s = ship({
                activeSkillText:
                    'This unit deals <unit-damage>100% damage</unit-damage> plus an additional damage equal to <unit-damage>14%</unit-damage> of its current Shield, and gains <unit-damage>Shield equal to 20%</unit-damage> of the damage dealt..',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const shield = active?.abilities.find((a) => a.type === 'shield');
            expect(shield).toMatchObject({
                type: 'shield',
                target: 'self',
                config: { type: 'shield', pct: 20, basis: 'damage-dealt' },
            });
            expect((shield?.config as { leechScope?: string }).leechScope).toBeUndefined();
        });

        it('Quixilver passive: damage-taken shield with requiresHpDamage, no leechScope', () => {
            const s = ship({
                firstPassiveSkillText:
                    'This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of the damage taken when taking HP damage and still having Shield.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const shield = passive?.abilities.find((a) => a.type === 'shield');
            expect(shield).toMatchObject({
                type: 'shield',
                target: 'self',
                config: {
                    type: 'shield',
                    pct: 25,
                    basis: 'damage-taken',
                    requiresHpDamage: true,
                },
            });
            expect((shield?.config as { leechScope?: string }).leechScope).toBeUndefined();
        });

        it('Malvex passive: damage-taken shield, no requiresHpDamage', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When directly damaged as a primary target, this Unit gains <unit-damage>Shield equal to 15%</unit-damage> of the Damage dealt to them.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const shield = passive?.abilities.find((a) => a.type === 'shield');
            expect(shield).toMatchObject({
                type: 'shield',
                target: 'self',
                config: { type: 'shield', pct: 15, basis: 'damage-taken' },
            });
            expect(
                (shield?.config as { requiresHpDamage?: boolean }).requiresHpDamage
            ).toBeUndefined();
        });

        it('FrontLine active: damage-dealt shield', () => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>80% damage</unit-damage> with additional damage equal to <unit-damage>60%</unit-damage> of their current Shield, and gains a <unit-damage>Shield equal to 30%</unit-damage> of the damage dealt.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const shield = active?.abilities.find((a) => a.type === 'shield');
            expect(shield).toMatchObject({
                type: 'shield',
                target: 'self',
                config: { type: 'shield', pct: 30, basis: 'damage-dealt' },
            });
        });

        it('FrontLine R4 passive: start-of-combat max-HP shield parses; no damage-dealt/taken shield', () => {
            const s = ship({
                thirdPassiveSkillText:
                    'This ship has 20% Shield Penetration.<br />While Shielded, it gains 2500 additional Defense.<br />This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.<br /><br />When an enemy uses their Charged skill, it deals <unit-damage>80%</unit-damage> and gains a Shield equal to <unit-damage>30%</unit-damage> of the damage dealt, once per round.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const shields = passive?.abilities.filter((a) => a.type === 'shield') ?? [];
            // The start-of-combat Max-HP shield (basis 'hp') still parses.
            expect(shields.some((sh) => (sh.config as { basis: string }).basis === 'hp')).toBe(
                true
            );
            // No damage-dealt / damage-taken shield is produced from this passive.
            expect(
                shields.some((sh) =>
                    ['damage-dealt', 'damage-taken'].includes(
                        (sh.config as { basis: string }).basis
                    )
                )
            ).toBe(false);
        });
    });

    describe('Defiant shield-on-Stasis (control ability + on-stasis-applied)', () => {
        it('charged "inflicts Stasis for 1 turn" parses a control ability with effect stasis', () => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>145% damage</unit-damage> and applies <unit-skill>Provoke</unit-skill> for 1 turn.',
                chargeSkillText:
                    'This Unit deals <unit-damage>195% damage</unit-damage> and inflicts <unit-skill>Stasis</unit-skill> for 1 turn.',
                chargeSkillCharge: 2,
            });
            const charged = buildShipAbilities(s).slots.find((sl) => sl.slot === 'charged');
            const control = charged?.abilities.find((a) => a.type === 'control');
            expect(control).toMatchObject({
                type: 'control',
                target: 'enemy',
                trigger: 'on-cast',
                config: { type: 'control', effect: 'stasis' },
            });
            // The charged damage is unaffected (control rider does not alter the damage ability).
            const dmg = abilityOfType(charged!.abilities, 'damage');
            expect(dmg).toMatchObject({ config: { type: 'damage', multiplier: 195 } });
        });

        it('active "applies Provoke" does NOT produce a stasis control ability', () => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>145% damage</unit-damage> and applies <unit-skill>Provoke</unit-skill> for 1 turn.',
            });
            const active = buildShipAbilities(s).slots.find((sl) => sl.slot === 'active');
            const control = active?.abilities.find(
                (a) => a.type === 'control' && a.config.type === 'control'
            );
            expect(control).toBeUndefined();
        });

        it('R0 passive "Shield equal to 30% of Max HP when applying Stasis" → shield on-stasis-applied', () => {
            const s = ship({
                refits: [],
                firstPassiveSkillText:
                    'This Unit gains <unit-damage>Shield equal to 30%</unit-damage> of its Max HP when applying Stasis.',
            });
            const passive = buildShipAbilities(s).slots.find((sl) => sl.slot === 'passive');
            const shield = passive?.abilities.find((a) => a.type === 'shield');
            expect(shield).toMatchObject({
                type: 'shield',
                target: 'self',
                trigger: 'on-stasis-applied',
                config: { type: 'shield', pct: 30, basis: 'hp' },
            });
        });

        it('R2 passive parses ONLY the shield-on-Stasis clause (adjacency HP grant left unparsed)', () => {
            const s = ship({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                refits: [{}, {}] as any,
                secondPassiveSkillText:
                    'When adjacent to a Supporter, this Unit gains 20% HP. This Unit gains <unit-damage>Shield equal to 30%</unit-damage> of its Max HP when applying Stasis.',
            });
            const passive = buildShipAbilities(s).slots.find((sl) => sl.slot === 'passive');
            const shield = passive?.abilities.find((a) => a.type === 'shield');
            expect(shield).toMatchObject({
                type: 'shield',
                target: 'self',
                trigger: 'on-stasis-applied',
                config: { type: 'shield', pct: 30, basis: 'hp' },
            });
        });
    });

    // Phase 4b Task 9: Salvation's on-destroyed ally-heal. The refit-active (R4 / 3rd) passive
    // "When this Unit is destroyed it repairs 80% of its max HP to all allies" parses as a heal
    // ability stamped with trigger 'on-destroyed' so it fires only on death (via the Task-5
    // listener), NOT every round. The conjoined "when a buff is purged … repairs that ally 5%"
    // on-buff-purged heal is NOT modeled this phase and must stay disqualified (not emitted).
    describe('Salvation 3rd passive: on-destroyed ally-heal (Task 9)', () => {
        const salvation = () =>
            ship({
                thirdPassiveSkillText:
                    "When this Unit is destroyed it <unit-damage>repairs 80%</unit-damage> of its max HP to all allies.<br /><br />When a <unit-aid>buff</unit-aid> is <unit-aid>purged</unit-aid> from an ally, this Unit <unit-damage>repairs that ally for 5%</unit-damage> of this Unit's max HP.",
            });

        it('emits an all-allies 80%-max-HP repair on trigger on-destroyed', () => {
            const passive = slot(buildShipAbilities(salvation()).slots, 'passive')!;
            const heals = passive.abilities.filter((a) => a.type === 'heal');
            // Only the on-destroyed 80% heal is emitted — the 5% on-buff-purged heal stays
            // disqualified (its trigger is not live this phase).
            expect(heals).toHaveLength(1);
            const heal = heals[0];
            expect(heal.target).toBe('all-allies');
            expect(heal.trigger).toBe('on-destroyed');
            if (heal.config.type === 'heal') {
                expect(heal.config.pct).toBe(80);
                expect(heal.config.basis).toBe('hp');
            }
        });

        it('does NOT emit the on-buff-purged 5% repair (trigger not live this phase)', () => {
            const passive = slot(buildShipAbilities(salvation()).slots, 'passive')!;
            const fivePct = passive.abilities.find(
                (a) => a.type === 'heal' && a.config.type === 'heal' && a.config.pct === 5
            );
            expect(fivePct).toBeUndefined();
        });
    });

    // Phase 4b Task 10: death-triggered extra-action abilities. The refit-active passive's
    // extra-action grant is stamped with the death trigger detected from its clause so it fires
    // only on the corresponding death (via the Task-5 listener + the engine's grantExtraAction
    // bridge), NOT on cast. Liberator additionally emits an all-allies on-enemy-destroyed charge.
    describe('death-triggered extra actions (Task 10)', () => {
        it('Sokol 3rd passive: extra-action on-enemy-destroyed, once per round', () => {
            const s = ship({
                thirdPassiveSkillText:
                    'This Unit gains 1 stack of <unit-skill>Blast</unit-skill> every turn and grants one extra end of round action upon a kill, once per round.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;
            const extra = passive.abilities.find((a) => a.type === 'extra-action')!;
            expect(extra).toBeDefined();
            expect(extra.target).toBe('self');
            expect(extra.trigger).toBe('on-enemy-destroyed');
            if (extra.config.type === 'extra-action') {
                expect(extra.config.oncePerRound).toBe(true);
            }
        });

        it('Harvester 3rd passive: extra-action on-ally-destroyed', () => {
            const s = ship({
                thirdPassiveSkillText:
                    'When an allied Unit is destroyed, this Unit gains 1 extra end of round action and <unit-skill>Speed Up I</unit-skill> for 6 turns.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;
            const extra = passive.abilities.find((a) => a.type === 'extra-action')!;
            expect(extra).toBeDefined();
            expect(extra.target).toBe('self');
            expect(extra.trigger).toBe('on-ally-destroyed');
        });

        it('Liberator 3rd passive: all-allies charge + self extra-action, both on-enemy-destroyed', () => {
            const s = ship({
                thirdPassiveSkillText:
                    'This Unit has 40% Shield Penetration. When an enemy dies, all allies <unit-aid>add 1 charge</unit-aid> to their Charged Skills, and once per round, this unit gains 1 extra action.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;

            const charge = passive.abilities.find((a) => a.type === 'charge')!;
            expect(charge).toBeDefined();
            expect(charge.target).toBe('all-allies');
            expect(charge.trigger).toBe('on-enemy-destroyed');
            if (charge.config.type === 'charge') {
                expect(charge.config.amount).toBe(1);
            }

            const extra = passive.abilities.find((a) => a.type === 'extra-action')!;
            expect(extra).toBeDefined();
            expect(extra.target).toBe('self');
            expect(extra.trigger).toBe('on-enemy-destroyed');
            if (extra.config.type === 'extra-action') {
                expect(extra.config.oncePerRound).toBe(true);
            }
        });

        it('Liberator (constants phrasing): "grants N charge to all allies" also emits the all-allies charge', () => {
            // The in-app ship text (constants/ships.ts) reads "this unit grants 1 charge to all
            // allies" (verb-first), distinct from the CSV's "all allies add 1 charge". Both must
            // emit the same all-allies on-enemy-destroyed charge ability.
            const s = ship({
                secondPassiveSkillText:
                    'When an enemy dies, this unit grants 1 charge to all allies, and once per round, it gains 1 extra action.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;
            const charge = passive.abilities.find((a) => a.type === 'charge')!;
            expect(charge).toBeDefined();
            expect(charge.target).toBe('all-allies');
            expect(charge.trigger).toBe('on-enemy-destroyed');
            if (charge.config.type === 'charge') {
                expect(charge.config.amount).toBe(1);
            }
            const extra = passive.abilities.find((a) => a.type === 'extra-action')!;
            expect(extra.trigger).toBe('on-enemy-destroyed');
        });
    });
});
