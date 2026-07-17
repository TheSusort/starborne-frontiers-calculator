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
            derivable: true,
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
        // SP-C: "If all damaged enemies have more Speed than this Unit" is now modelled as a
        // real owner-vs-target stat-comparison gate (previously fell through to the
        // 'always'/derivable placeholder — see modelCompletenessTriage.test.ts SP-C).
        expect(charge!.conditions[0]).toMatchObject({
            subject: 'stat-vs-target',
            derivable: true,
            compareStat: 'speed',
            statComparator: 'lt',
        });
    });

    it('Cobalt passive: start-of-turn self-charge gated by full HP (Phase 3)', () => {
        // Build abilities from Cobalt's first-passive text; find the charge ability.
        // R0 passive (refits: []) so firstPassiveSkillText is the active row.
        const chargeAbilityFrom = (text: string): Ability | undefined => {
            const s = ship({ refits: [], firstPassiveSkillText: text, chargeSkillCharge: 4 });
            const passive = slot(buildShipAbilities(s).slots, 'passive');
            return abilityOfType(passive?.abilities ?? [], 'charge');
        };

        const charge = chargeAbilityFrom(
            'This Unit adds 1 charge to its charged skill at the start of the turn if it is at full HP.'
        );
        expect(charge).toMatchObject({
            type: 'charge',
            target: 'self',
            trigger: 'start-of-turn',
            conditions: [
                {
                    subject: 'hp-threshold',
                    hpComparator: 'above',
                    hpPercent: 99,
                    hpSubject: 'self',
                },
            ],
            config: { type: 'charge', amount: 1 },
        });
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

    it('a passive the ability parser models nothing from produces no passive slot — the UI surfaces the slot from skill text instead', () => {
        // Hypothetical: a passive with no recognized mechanic at all. buildShipAbilities
        // yields no passive slot, so ShipConfigCard derives `hasPassive` from the ship's skill
        // text (getSkillRowForSlot) to still show the Edit button. (Formerly documented via
        // Anemone's "takes 25% less direct damage from enemies debuffed with a DoT" passive —
        // epic PR12(C) wired that phrasing onto `incoming-reduction`, so it now DOES produce a
        // passive slot; see the epic PR12(C) describe block below for its coverage.)
        const s = ship({
            activeSkillText: 'This Unit deals <unit-damage>140% damage</unit-damage>.',
            thirdPassiveSkillText: 'This Unit has an aura visible only to its allies.',
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
        // SP-M M1 Task 7: the start-of-round hp-threshold damage re-targets to all-enemies (the
        // reactive executor re-checks the per-victim hp-threshold against each victim's own HP%).
        expect(dmg.trigger).toBe('start-of-round');
        expect(dmg.target).toBe('all-enemies');

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

    it('Provider charged: damage + extend-dot (charge removal now also emitted — see Phase 1 Task 3 block)', () => {
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
        // SP-M M1 Task 7: the end-of-round enemy-debuff damage re-targets to all-enemies (the
        // reactive executor re-checks the "with Inferno" gate against each victim's own debuffs).
        expect(dmg.trigger).toBe('end-of-round');
        expect(dmg.target).toBe('all-enemies');

        const mod = passive.abilities.find(
            (a) => a.config.type === 'modifier' && a.config.channel === 'outgoingDamage'
        )!;
        expect(mod.config).toMatchObject({ channel: 'outgoingDamage', value: 30 });
        expect(mod.conditions).toEqual([
            { subject: 'enemy-debuff', buffName: 'Inferno', derivable: true },
        ]);
        // The on-cast enemy-effect damage BONUS modifier is NOT re-targeted (it stays a same-target
        // bonus, not an all-enemies filter — only the round-boundary base damage re-targets).
        expect(mod.target).not.toBe('all-enemies');
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

    describe('extend-status (ship-kit wave 4, Task 5)', () => {
        it('Sokol charged: damage + extend-status(debuff) on the enemy', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit deals <unit-damage>150% damage</unit-damage> and extends active <unit-aid>Debuffs</unit-aid> by 1 turn.',
                chargeSkillCharge: 2,
            });
            const charged = slot(buildShipAbilities(s).slots, 'charged')!;
            expect(abilityOfType(charged.abilities, 'damage')!.config).toMatchObject({
                multiplier: 150,
            });
            const extend = abilityOfType(charged.abilities, 'extend-status')!;
            expect(extend.config).toEqual({
                type: 'extend-status',
                statusKind: 'debuff',
                turns: 1,
            });
            expect(extend.target).toBe('enemy');
            expect(extend.trigger).toBe('on-cast');
            expect(extend.conditions).toEqual([]);
        });

        it('Ripper passive R2: Marauder Rage II self-buff STILL present + extend-status(buff) on all-allies', () => {
            const s = ship({
                // factory default refits + only secondPassiveSkillText → getShipSkillRows picks Passive R2
                secondPassiveSkillText:
                    'This Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns after it inflicts a debuff.<br /><br />All allies extend their active <unit-aid>Buffs</unit-aid> by 1 turn.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;
            const rage = abilityOfType(passive.abilities, 'buff');
            expect(rage).toMatchObject({
                config: { type: 'buff', buffName: 'Marauder Rage II' },
            });
            const extend = abilityOfType(passive.abilities, 'extend-status')!;
            expect(extend.config).toEqual({
                type: 'extend-status',
                statusKind: 'buff',
                turns: 1,
            });
            expect(extend.target).toBe('all-allies');
            expect(extend.trigger).toBe('on-cast');
            expect(extend.conditions).toEqual([]);
        });

        it('Lev charged: extend-status(debuff) on all-enemies, gated on a self-crit condition', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit deals <unit-damage>230% damage</unit-damage> plus an additional <unit-damage>20%</unit-damage> for each debuff on the enemy. If a critical hit occurs, all hit enemies have their debuffs extended by 1 turn and all allies are granted <unit-skill>Crit Power Up II</unit-skill> for 2 turns.',
                chargeSkillCharge: 3,
            });
            const charged = slot(buildShipAbilities(s).slots, 'charged')!;
            const extend = abilityOfType(charged.abilities, 'extend-status')!;
            expect(extend.config).toEqual({
                type: 'extend-status',
                statusKind: 'debuff',
                turns: 1,
            });
            expect(extend.target).toBe('all-enemies');
            // Lev's on-crit shape (this task's judgment call): trigger stays 'on-cast', gated by
            // the live-derivable 'self-crit' condition — mirrors Valerian's crit-power-extend
            // condition above and reuses the on-cast all-enemies aoeVictimIds fan-out (Task 6),
            // rather than the reactive on-crit LIVE_TRIGGER (which has no AoE fan-out precedent).
            expect(extend.trigger).toBe('on-cast');
            expect(extend.conditions).toEqual([{ subject: 'self-crit', derivable: true }]);
        });
    });

    it('Crocus passive: ally-crit-DoT routes through the on-ally-crit-dot reactive trigger (conditions empty)', () => {
        const s = ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            secondPassiveSkillText:
                'When another ally inflicts a Damage Over Time (DoT) effect with a critical hit, this Unit repairs itself for 3% of its Max HP and inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns on that enemy.',
        });
        const abilities = slot(buildShipAbilities(s).slots, 'passive')!.abilities;
        const dot = abilityOfType(abilities, 'dot')!;
        expect(dot.config).toMatchObject({ type: 'dot', dotType: 'corrosion' });
        expect(dot.trigger).toBe('on-ally-crit-dot');
        expect(dot.conditions).toEqual([]);
        // FULL list pin: heal + dot and NOTHING else. "with a critical hit" here is the
        // ally's OUTGOING crit — if detectDamageReactionTrigger ever reads it as the ally
        // BEING crit-hit, the Task 8 name-only-debuff pass adds a phantom on-ally-attacked
        // Corrosion II debuff card on top of these two.
        // Phase 3 PR-C: the heal now also rides on-ally-crit-dot (detectAllyCritDotTrigger)
        // instead of the stale on-cast default — it repairs Crocus reactively, on an ALLY's
        // crit-DoT infliction, not on Crocus's own cast.
        expect(abilities.map((a) => [a.type, a.trigger])).toEqual([
            ['heal', 'on-ally-crit-dot'],
            ['dot', 'on-ally-crit-dot'],
        ]);
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

    it('Stealth-gated outgoing-damage modifier is derivable (item 11)', () => {
        // "X% more direct damage while Stealthed" on a self-scoped skill hits the stealth
        // branch in parseModifiers. derivable: true makes the condition read live selfBuffNames
        // (0 at combat start) instead of assuming the buff is active (count 1).
        const s = ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            secondPassiveSkillText:
                'This Unit deals <unit-damage>25% more direct damage</unit-damage> while <unit-skill>Stealthed</unit-skill>.',
        });

        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const mod = passive.abilities.find(
            (a) => a.config.type === 'modifier' && a.config.channel === 'outgoingDamage'
        )!;
        expect(mod).toBeDefined();
        expect(mod.config).toMatchObject({ channel: 'outgoingDamage', value: 25 });
        expect(mod.target).toBe('self');
        expect(mod.conditions[0]).toEqual({
            subject: 'self-buff',
            buffName: 'Stealth',
            derivable: true,
        });
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
        // Concentrate Fire is a debuff → derivable enemy-debuff; Stealth is a buff → derivable enemy-buff.
        expect(out.conditions).toEqual([
            { subject: 'enemy-debuff', buffName: 'Concentrate Fire', derivable: true, anyOf: true },
            { subject: 'enemy-buff', buffName: 'Stealth', derivable: true, anyOf: true },
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
        // Taunt = self buff, Provoke = self debuff (both statuses the caster checks on itself;
        // epic PR5 finding 1), anyOf.
        expect(outgoing.conditions).toEqual([
            { subject: 'self-buff', buffName: 'Taunt', derivable: true, anyOf: true },
            { subject: 'self-debuff', buffName: 'Provoke', derivable: true, anyOf: true },
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
            { subject: 'self-buff', buffName: 'Taunt', derivable: true, anyOf: true },
            { subject: 'self-debuff', buffName: 'Provoke', derivable: true, anyOf: true },
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

    it('IonScorp charged: 190 base damage carries Defender-gated +10 scaling (→200 vs Defender)', () => {
        const s = ship({
            chargeSkillText:
                'This Unit deals <unit-damage>190% damage</unit-damage>, but when attacking a Defender, it deals <unit-damage>200%</unit-damage> damage and inflicts <unit-skill>Disable</unit-skill> for 1 turn.',
            chargeSkillCharge: 1,
        });
        const charged = slot(buildShipAbilities(s).slots, 'charged')!;
        const dmg = abilityOfType(charged.abilities, 'damage')!;
        expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 190 });
        expect(dmg.conditions).toEqual([
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
        ]);
        expect(dmg.scaling).toMatchObject({ conditionIndex: 0, perUnit: 10 });
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

    it('Selenite passive: "for every enemy with Stealth" scales on the DERIVABLE stealthed-enemy count (sub-project I, PR I5)', () => {
        // Real CSV text (docs/ship-skills.csv, first/second_passive_skill_text) — "for every",
        // not "for each", and counting ENEMY UNITS with Stealth, not stacks on one target.
        // A plain enemy-buff gate (pre-I5) can only tell "at least one enemy Stealthed", not
        // how many — the dedicated count subject fixes that.
        const s = ship({
            firstPassiveSkillText:
                'This Unit deals 10% more direct damage for every enemy with <unit-skill>Stealth</unit-skill>.',
        });
        const mod = abilityOfType(
            slot(buildShipAbilities(s).slots, 'passive')!.abilities,
            'modifier'
        )!;
        expect(mod.conditions[0]).toMatchObject({
            subject: 'enemy-stealth-count',
            derivable: true,
        });
        expect(mod.scaling).toMatchObject({ conditionIndex: 0, perUnit: 10 });
        expect(mod.scaling?.cap).toBeUndefined(); // the text states no maximum
        expect(mod.config).toMatchObject({ channel: 'outgoingDamage', value: 0 });
        expect(mod.target).toBe('self'); // self-scoped — no team distribution, no per-victim
    });

    describe('Wildfire dotDamage crit-power scaling (sub-project I, PR I4a)', () => {
        // Real CSV text (docs/ship-skills.csv row 156, first/second_passive_skill_text).
        const baseText =
            'When an enemy has <unit-skill>Scorching Radiation</unit-skill>, this Unit deals <unit-damage>1% additional</unit-damage> <unit-skill>Inferno</unit-skill> <unit-damage>damage</unit-damage> to that unit for every 10% crit power.';
        const refitText =
            'When an enemy has <unit-skill>Scorching Radiation</unit-skill>, this Unit deals <unit-damage>2% additional</unit-damage> <unit-skill>Inferno</unit-skill> <unit-damage>damage</unit-damage> to that unit for every 10% crit power.';

        it('base passive (0 refits): dotDamage modifier scaling 1% per 10% crit power, gated on the NAMED enemy debuff', () => {
            const s = ship({
                refits: [],
                firstPassiveSkillText: baseText,
                secondPassiveSkillText: refitText,
            });
            const mod = abilityOfType(
                slot(buildShipAbilities(s).slots, 'passive')!.abilities,
                'modifier'
            )!;
            expect(mod.config).toMatchObject({
                type: 'modifier',
                channel: 'dotDamage',
                value: 0,
            });
            expect(mod.target).toBe('self');
            expect(mod.conditions).toHaveLength(2);
            // The Scorching-Radiation gate reuses the SAME enemyEffectConditions path as
            // Tygr/Incinerator (I1 name-specific `enemy-debuff` gating) — "Scorching
            // Radiation" is a real named debuff in src/constants/buffs.ts.
            expect(mod.conditions[0]).toMatchObject({
                subject: 'enemy-debuff',
                derivable: true,
                buffName: 'Scorching Radiation',
            });
            expect(mod.conditions[1]).toMatchObject({
                subject: 'self-crit-power',
                derivable: true,
            });
            expect(mod.scaling).toMatchObject({ conditionIndex: 1, perUnit: 0.1 });
        });

        it('refit passive (2+ refits): resolves to the SECOND passive row, scaling 2% per 10% crit power', () => {
            const s = ship({
                refits: [{}, {}] as Ship['refits'],
                firstPassiveSkillText: baseText,
                secondPassiveSkillText: refitText,
            });
            const mod = abilityOfType(
                slot(buildShipAbilities(s).slots, 'passive')!.abilities,
                'modifier'
            )!;
            expect(mod.conditions[0]).toMatchObject({
                subject: 'enemy-debuff',
                buffName: 'Scorching Radiation',
            });
            expect(mod.conditions[1]).toMatchObject({ subject: 'self-crit-power' });
            expect(mod.scaling).toMatchObject({ conditionIndex: 1, perUnit: 0.2 });
        });

        it('does not change an unrelated "% more damage to enemies with <debuff>" ship parse (no regression)', () => {
            // Tygr-shape clause — must keep parsing as a plain outgoingDamage modifier with
            // no scaling, proving the new "% additional <DoT> damage … crit power" branch
            // above is narrowly scoped and does not intercept this shape.
            const s = ship({
                firstPassiveSkillText:
                    'This Unit deals <unit-damage>30% more direct damage</unit-damage> to enemies with <unit-skill>Stasis</unit-skill>.',
            });
            const mod = abilityOfType(
                slot(buildShipAbilities(s).slots, 'passive')!.abilities,
                'modifier'
            )!;
            expect(mod.config).toMatchObject({ channel: 'outgoingDamage', value: 30 });
            expect(mod.scaling).toBeUndefined();
        });
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

    it('Chakara passive: round-start damage proc + both self-buffs gated on lowest-speed', () => {
        const s = ship({
            thirdPassiveSkillText:
                'This Unit starts each round with <unit-skill>Attack Up II</unit-skill> and <unit-skill>Defense Up II</unit-skill> for 1 turn if it has the lowest speed among all Allies. Then, deals <unit-damage>60% damage</unit-damage> to the highest Speed Enemy.',
        });
        const passive = buildShipAbilities(s).slots.find((sl) => sl.slot === 'passive');
        // 60% damage proc still parses.
        expect(passive?.abilities.find((a) => a.type === 'damage')).toMatchObject({
            config: { type: 'damage', multiplier: 60 },
        });
        // Both self-buffs now emit, with start-of-round trigger + lowest-speed-ally gate.
        const buffs = (passive?.abilities ?? []).filter((a) => a.type === 'buff');
        expect(
            buffs.map((b) => (b.config.type === 'buff' ? b.config.buffName : '')).sort()
        ).toEqual(['Attack Up II', 'Defense Up II']);
        for (const b of buffs) {
            expect(b.trigger).toBe('start-of-round');
            expect(b.target).toBe('self');
            expect(b.conditions).toEqual([{ subject: 'lowest-speed-ally', derivable: true }]);
        }
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

    // Bare repair/cleanse (no target phrase) on a PURE-SUPPORT active/charged skill (no damage
    // component) targets allies, not the caster. HEALS route to 'all-allies' — a support healer
    // repairs EVERYONE in its pattern footprint (AoE, "just like buffs"; the engine intersects
    // all-allies with the support pattern). CLEANSES stay single 'ally'. An EXPLICIT recipient
    // ("the ally with the most missing health" → Volk) sets explicitTarget and stays a single
    // 'ally'. The parser defaults bare to 'self'; the flip lives in abilitiesFromText where the
    // slot + damage component are known.
    describe('bare repair → all-allies (AoE) / cleanse → ally on pure-support active/charged skills', () => {
        it('Hermes active bare repair → AoE heal (all-allies)', () => {
            const s = ship({ activeSkillText: 'This Unit Repairs 27% of its Max HP.' });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const heal = active?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'all-allies',
                trigger: 'on-cast',
                config: { type: 'heal', pct: 27, basis: 'hp' },
            });
        });

        it('Hermes charged bare repair → AoE heal (all-allies); charge still parses', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit repairs 37% of its Max HP and adds 1 charge to the Charged Skill. If the target has less than 40% HP, it grants Cheat Death.',
                chargeSkillCharge: 4,
            });
            const charged = buildShipAbilities(s).slots.find((x) => x.slot === 'charged');
            const heal = charged?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'all-allies',
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

        it('bare shield on a pure-support active stays self (no co-cast grant)', () => {
            const s = ship({
                activeSkillText: 'This Unit gains a Shield equal to 30% of its Max HP.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const shield = active?.abilities.find((a) => a.type === 'shield');
            expect(shield).toMatchObject({ type: 'shield', target: 'self' });
        });

        it('Graphite active: co-cast Overclock buff and shield both target all-allies', () => {
            const s = ship({
                activeSkillText:
                    'This unit grants <unit-skill>Overclock III</unit-skill> for 2 turns and a <unit-damage>shield equal to 120%</unit-damage> of its attack.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const buff = active?.abilities.find(
                (a) =>
                    a.type === 'buff' &&
                    a.config.type === 'buff' &&
                    a.config.buffName === 'Overclock III'
            );
            const shield = active?.abilities.find((a) => a.type === 'shield');
            expect(buff).toMatchObject({ target: 'all-allies' });
            expect(shield).toMatchObject({
                type: 'shield',
                target: 'all-allies',
                config: { type: 'shield', pct: 120, basis: 'attack' },
            });
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
        // so the bare repair flips to the AoE all-allies scope (heals its pattern footprint).
        it('Oleander active: bare repair without self-damage condition → AoE heal (all-allies)', () => {
            const s = ship({
                activeSkillText:
                    'This Unit grants <unit-skill>Hacking Up III</unit-skill> for 2 turns and <unit-damage>repairs 100%</unit-damage> of its Max HP, with an additional <unit-damage>8.5%</unit-damage> repair for each debuffed enemy.',
            });
            const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
            const heal = active?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'all-allies',
                config: { type: 'heal', pct: 100, basis: 'hp' },
            });
        });
    });

    // Lionheart R4 refit-active passive (docs/ship-skills.csv, verbatim): the round-start
    // Protection grant is a consumable FIXED pool (a redirected hit clears it entirely), so it
    // must refresh to 10 each round rather than accumulate — maxStacks + clearAllOnRedirect are
    // threaded through to the buff config for the engine (Task 4) to consume.
    it('Lionheart: Protection buff ability carries maxStacks:10 + clearAllOnRedirect', () => {
        const s = ship({
            thirdPassiveSkillText:
                'At the start of combat, this Unit grants all adjacent allies 10% of its HP.<br /><br />At the start of the round, this Unit gains 10 stacks of <unit-skill>Protection</unit-skill>.<br />After taking damage redirected through <unit-skill>Protection</unit-skill>, all <unit-skill>Protection</unit-skill> is removed.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const prot = passive.abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Protection'
        );
        expect(prot).toBeDefined();
        expect(prot!.config.type === 'buff' && prot!.config.stackTrigger).toBe('per-round');
        expect(prot!.config.type === 'buff' && prot!.config.isStackable).toBe(true);
        expect(prot!.config.type === 'buff' && prot!.config.maxStacks).toBe(10);
        expect(prot!.config.type === 'buff' && prot!.config.clearAllOnRedirect).toBe(true);
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

        it('Cultivator clause 2: on-ally-directly-damaged passive repair IS emitted, healing the damaged ally', () => {
            // Phase 4c PR 2 (Tasks 8+9): parseHealAbilities parses ally-subject damage
            // reactions with damageReaction.allySubject (Task 8), the ally-damage trigger
            // shape flips the bare repair to the damaged ally, and buildShipAbilities
            // consumes allySubject to route the heal to on-ally-attacked (Task 9) — the
            // executor then resolves the recipient via eventCtx.damagedAllyId.
            const s = ship({
                type: 'SUPPORTER',
                thirdPassiveSkillText:
                    "When an ally is directly damaged within the active pattern, this unit repairs 8% of this unit's max HP.",
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const heal = passive?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'ally',
                trigger: 'on-ally-attacked',
                conditions: [],
                config: { type: 'heal', pct: 8, basis: 'hp' },
            });
            // Symmetry with the self-subject pins: a plain directly-damaged ally reaction
            // carries NO crit filter (only "is critically hit" phrasings set one).
            expect(heal!.triggerCritFilter).toBeUndefined();
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

        it('Heliodor SECOND passive (all-allies recipient): emits an on-attacked heal to all allies (Task 8)', () => {
            // Phase 4c PR 2 (Task 8): self-subject trigger with a NON-SELF recipient now
            // parses — "them" resolves to "all allies" (antecedent earlier in the sentence),
            // so the self-damage reaction heals the whole team. Correctly on-attacked (the
            // OWNER is the damaged unit); no Task 9 change expected here.
            const s = ship({
                firstPassiveSkillText:
                    'When directly damaged, this Unit reduces the duration of all active <unit-aid>Debuffs</unit-aid> on all allies by 1 turn and repairs them for 8% of its Max HP.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const heal = passive?.abilities.find((a) => a.type === 'heal');
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'all-allies',
                trigger: 'on-attacked',
                conditions: [],
                config: { type: 'heal', pct: 8, basis: 'hp' },
            });
            expect(heal!.triggerCritFilter).toBeUndefined();
        });
    });

    // PR11 (epic PR11): debuff-duration reduction — the inverse of extend-dot. The heal half of
    // Heliodor's sentence is covered above; these assert the CO-LOCATED reduction half, which
    // previously emitted nothing (see skillTextParser.test.ts's "the debuff-duration clause
    // emits nothing" note on parseHealAbilities — that note is about the HEAL parser only; the
    // reduction now lives in its own ability, added alongside, not folded into the heal).
    describe('debuff-duration reduction (PR11, inverse of extend-dot)', () => {
        it('Heliodor first passive: self damage-reaction reduces ALL active debuffs on itself by 1 turn', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When directly damaged, this Unit reduces the duration of all active <unit-aid>Debuffs</unit-aid> on itself by 1 turn and <unit-damage>repairs itself for 8%</unit-damage> of its Max HP.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const reduce = passive?.abilities.find((a) => a.type === 'cleanse');
            expect(reduce).toMatchObject({
                type: 'cleanse',
                target: 'self',
                trigger: 'on-attacked',
                conditions: [],
                config: {
                    type: 'cleanse',
                    count: 'all',
                    mode: 'reduce-duration',
                    durationTurns: 1,
                },
            });
            // Both halves of the sentence coexist — the heal ability is untouched.
            const heal = passive?.abilities.find((a) => a.type === 'heal');
            expect(heal).toBeDefined();
        });

        it('Heliodor SECOND passive: self damage-reaction reduces ALL active debuffs on all allies by 1 turn', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When directly damaged, this Unit reduces the duration of all active <unit-aid>Debuffs</unit-aid> on all allies by 1 turn and repairs them for 8% of its Max HP.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const reduce = passive?.abilities.find((a) => a.type === 'cleanse');
            expect(reduce).toMatchObject({
                type: 'cleanse',
                target: 'all-allies',
                trigger: 'on-attacked',
                conditions: [],
                config: {
                    type: 'cleanse',
                    count: 'all',
                    mode: 'reduce-duration',
                    durationTurns: 1,
                },
            });
        });

        it('Pestilence passive: on-debuff-inflicted reduces ALL active debuffs on all allies by 1 turn (verbatim first_passive_skill_text)', () => {
            const s = ship({
                firstPassiveSkillText:
                    'On debuff infliction this Unit reduces the duration of active Debuffs on all allies by 1 turn.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const reduce = passive?.abilities.find((a) => a.type === 'cleanse');
            expect(reduce).toMatchObject({
                type: 'cleanse',
                target: 'all-allies',
                trigger: 'on-debuff-inflicted',
                conditions: [],
                config: {
                    type: 'cleanse',
                    count: 'all',
                    mode: 'reduce-duration',
                    durationTurns: 1,
                },
            });
        });

        it('Lingshe charge skill (Bomb-countdown reduction): emits a bomb-countdown-reduce ability, NOT a debuff-duration-reduction cleanse (SP-F F3 — see auditSkills.allowlist.ts history)', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit reduces all <unit-skill>Bombs</unit-skill> on the enemy targets by 1 turn, <unit-skill>Bombs</unit-skill> reduced to 0 turns by this skill will detonate.<br />This reduction effect requires hacking.<br /><br />This Unit inflicts <unit-skill>Bomb III</unit-skill> for 3 turns.',
            });
            const charged = buildShipAbilities(s).slots.find((x) => x.slot === 'charged');
            // Still no generic duration-reduction cleanse — that primitive deliberately excludes
            // bombs (see REDUCE_DEBUFF_DURATION_RE's own comment).
            const reduce = charged?.abilities.find(
                (a) =>
                    a.type === 'cleanse' &&
                    a.config.type === 'cleanse' &&
                    a.config.mode === 'reduce-duration'
            );
            expect(reduce).toBeUndefined();
            // SP-F F3: the dedicated bomb-countdown-reduce ability now builds instead.
            const bombReduce = charged?.abilities.find((a) => a.type === 'bomb-countdown-reduce');
            expect(bombReduce).toMatchObject({
                type: 'bomb-countdown-reduce',
                target: 'all-enemies',
                trigger: 'on-cast',
                config: { type: 'bomb-countdown-reduce', turns: 1 },
            });
        });

        it('an un-gated reduction clause (no "when directly damaged"/"on debuff infliction") is DROPPED, not emitted as a phantom on-attacked ability', () => {
            // The clause parses (parseDebuffDurationReduction returns turns/target) but carries
            // neither reactive gate flag → buildShipAbilities must NOT emit it (a silent on-cast /
            // on-attacked default would fire an all-debuff reduction with no real trigger). No
            // corpus ship hits this branch; the test locks the drop behaviour of option (a).
            const s = ship({
                firstPassiveSkillText:
                    'This Unit reduces the duration of all active <unit-aid>Debuffs</unit-aid> on all allies by 1 turn.',
            });
            const passive = buildShipAbilities(s).slots.find((x) => x.slot === 'passive');
            const reduce = passive?.abilities.find(
                (a) =>
                    a.type === 'cleanse' &&
                    a.config.type === 'cleanse' &&
                    a.config.mode === 'reduce-duration'
            );
            expect(reduce).toBeUndefined();
        });
    });

    // Combat G PR1 (Task 5): Stalwart's counterattack passive — "When directly damaged as a
    // primary target, it deals X% damage to that enemy" — auto-produces a reactive `counter`
    // ability (on-attacked, requirePrimaryTarget) instead of a plain on-cast `damage`, while the
    // co-located buff grant ("gains Legion Discipline II for 3 turns") still parses.
    describe('counterattack passives → on-attacked counter (Combat G PR1)', () => {
        const passiveOf = (s: Ship): Skill | undefined =>
            buildShipAbilities(s).slots.find((x) => x.slot === 'passive');

        it('Stalwart first passive (30%): emits an on-attacked counter with requirePrimaryTarget and keeps the Legion Discipline II buff', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When this Unit is directly damaged as a primary target, it deals <unit-damage>30% damage</unit-damage> to that enemy and gains <unit-skill>Legion Discipline II</unit-skill> for 3 turns.',
            });
            const passive = passiveOf(s);
            const counterAb = passive?.abilities.find((a) => a.type === 'counter');
            expect(counterAb).toMatchObject({
                type: 'counter',
                target: 'enemy',
                trigger: 'on-attacked',
                config: { type: 'counter', multiplier: 30, requirePrimaryTarget: true },
            });
            // Non-regression: no phantom on-cast plain damage left behind.
            const all = buildShipAbilities(s).slots.flatMap((x) => x.abilities);
            expect(all.filter((a) => a.type === 'damage')).toHaveLength(0);
            // Co-located buff still parses.
            const buff = passive?.abilities.find((a) => a.type === 'buff');
            expect(buff).toMatchObject({
                type: 'buff',
                config: { type: 'buff', buffName: 'Legion Discipline II', duration: 3 },
            });
        });

        it('Stalwart second passive (70%): emits an on-attacked counter with requirePrimaryTarget and keeps the Legion Discipline II buff', () => {
            const s = ship({
                secondPassiveSkillText:
                    'When this Unit is directly damaged as a primary target, it deals <unit-damage>70% damage</unit-damage> to that enemy and gains <unit-skill>Legion Discipline II</unit-skill> for 3 turns.<br /><br />Additionally, when this Unit is adjacent to a Supporter, this Unit gains <unit-skill>20% Attack</unit-skill>.',
            });
            const passive = passiveOf(s);
            const counterAb = passive?.abilities.find((a) => a.type === 'counter');
            expect(counterAb).toMatchObject({
                type: 'counter',
                target: 'enemy',
                trigger: 'on-attacked',
                config: { type: 'counter', multiplier: 70, requirePrimaryTarget: true },
            });
            const all = buildShipAbilities(s).slots.flatMap((x) => x.abilities);
            expect(all.filter((a) => a.type === 'damage')).toHaveLength(0);
            const buff = passive?.abilities.find(
                (a) =>
                    a.type === 'buff' &&
                    (a.config as { buffName?: string }).buffName === 'Legion Discipline II'
            );
            expect(buff).toMatchObject({
                config: { type: 'buff', buffName: 'Legion Discipline II', duration: 3 },
            });
        });

        // Combat G PR2: Nyxen's shield-hit counterattack passive — "This Unit deals X% damage
        // when its Shield is directly damaged." — auto-produces a reactive `counter` ability
        // (on-attacked, requireShieldHit) with NO requirePrimaryTarget.
        it('Nyxen first passive (100%): emits an on-attacked counter with requireShieldHit and no primary-target requirement', () => {
            const s = ship({
                firstPassiveSkillText:
                    'This Unit deals <unit-damage>100% damage</unit-damage> when its Shield is directly damaged.',
            });
            const passive = passiveOf(s);
            const counterAb = passive?.abilities.find((a) => a.type === 'counter');
            expect(counterAb).toMatchObject({
                type: 'counter',
                target: 'enemy',
                trigger: 'on-attacked',
                config: { type: 'counter', multiplier: 100, requireShieldHit: true },
            });
            expect(
                (counterAb?.config as { requirePrimaryTarget?: boolean }).requirePrimaryTarget
            ).toBeUndefined();
            // Non-regression: no phantom on-cast plain damage left behind.
            const all = buildShipAbilities(s).slots.flatMap((x) => x.abilities);
            expect(all.filter((a) => a.type === 'damage')).toHaveLength(0);
        });

        it('Nyxen second passive (200%): emits an on-attacked counter with requireShieldHit', () => {
            const s = ship({
                secondPassiveSkillText:
                    'This Unit deals <unit-damage>200% damage</unit-damage> when its Shield is directly damaged.',
            });
            const passive = passiveOf(s);
            const counterAb = passive?.abilities.find((a) => a.type === 'counter');
            expect(counterAb).toMatchObject({
                type: 'counter',
                target: 'enemy',
                trigger: 'on-attacked',
                config: { type: 'counter', multiplier: 200, requireShieldHit: true },
            });
            expect(
                (counterAb?.config as { requirePrimaryTarget?: boolean }).requirePrimaryTarget
            ).toBeUndefined();
            const all = buildShipAbilities(s).slots.flatMap((x) => x.abilities);
            expect(all.filter((a) => a.type === 'damage')).toHaveLength(0);
        });

        // Combat G PR2: Centurion's self/adjacent-ally retaliate passive — "When this Unit OR
        // AN ADJACENT ALLY is directly damaged, this Unit retaliates dealing X%." Its retaliate
        // <unit-damage> tag carries no "damage" word → parseSkillDamage returns 0 → it does NOT
        // ride the re-type path; it is pushed as TWO counters (self on-attacked + adjacent-ally
        // on-ally-attacked with requireDamagedAllyAdjacent).
        it('Centurion second passive (50%): emits a self on-attacked counter and an adjacent-ally on-ally-attacked counter', () => {
            const s = ship({
                secondPassiveSkillText:
                    'At the start of combat, this Unit gains 750 attack per adjacent ally.<br /><br />When this Unit or an adjacent ally is directly damaged, this Unit retaliates dealing <unit-damage>50%</unit-damage>.',
            });
            const all = buildShipAbilities(s).slots.flatMap((x) => x.abilities);
            const counters = all.filter((a) => a.type === 'counter');
            expect(counters).toHaveLength(2);

            const self = counters.find((a) => a.trigger === 'on-attacked');
            expect(self).toMatchObject({
                type: 'counter',
                target: 'enemy',
                trigger: 'on-attacked',
                config: { type: 'counter', multiplier: 50 },
            });
            expect(
                (self?.config as { requirePrimaryTarget?: boolean }).requirePrimaryTarget
            ).toBeUndefined();
            expect(
                (self?.config as { requireShieldHit?: boolean }).requireShieldHit
            ).toBeUndefined();
            expect(self?.requireDamagedAllyAdjacent).toBeUndefined();

            const ally = counters.find((a) => a.trigger === 'on-ally-attacked');
            expect(ally).toMatchObject({
                type: 'counter',
                target: 'enemy',
                trigger: 'on-ally-attacked',
                config: { type: 'counter', multiplier: 50 },
                requireDamagedAllyAdjacent: true,
            });

            // Non-regression: the co-located "750 attack per adjacent ally" start-of-combat
            // clause produces NO spurious damage/buff ability — since PR F4 it parses as a
            // pre-combat-stat grant instead (flat 750 attack × adjacent-ally count, self).
            expect(all.filter((a) => a.type === 'damage')).toHaveLength(0);
            expect(all.filter((a) => a.type === 'buff')).toHaveLength(0);
            expect(all.filter((a) => a.type === 'pre-combat-stat')).toMatchObject([
                {
                    target: 'self',
                    trigger: 'pre-combat',
                    config: {
                        type: 'pre-combat-stat',
                        stat: 'attack',
                        value: 750,
                        valueKind: 'flat',
                        perAdjacentAlly: true,
                    },
                },
            ]);
        });

        it('Centurion third passive (100%): self/adjacent-ally counters at multiplier 100', () => {
            const s = ship({
                thirdPassiveSkillText:
                    'At the start of combat, this Unit gains 1000 attack per adjacent ally.<br /><br />When this Unit or an adjacent ally is directly damaged, this Unit retaliates dealing <unit-damage>100%</unit-damage>.',
            });
            const all = buildShipAbilities(s).slots.flatMap((x) => x.abilities);
            const counters = all.filter((a) => a.type === 'counter');
            expect(counters).toHaveLength(2);
            expect(counters.find((a) => a.trigger === 'on-attacked')).toMatchObject({
                config: { type: 'counter', multiplier: 100 },
            });
            expect(counters.find((a) => a.trigger === 'on-ally-attacked')).toMatchObject({
                config: { type: 'counter', multiplier: 100 },
                requireDamagedAllyAdjacent: true,
            });
            expect(all.filter((a) => a.type === 'damage')).toHaveLength(0);
            expect(all.filter((a) => a.type === 'buff')).toHaveLength(0);
            // PR F4: the start-of-combat clause parses as a flat 1000-attack per-adjacent grant.
            expect(all.filter((a) => a.type === 'pre-combat-stat')).toMatchObject([
                {
                    config: {
                        type: 'pre-combat-stat',
                        stat: 'attack',
                        value: 1000,
                        valueKind: 'flat',
                        perAdjacentAlly: true,
                    },
                },
            ]);
        });

        it('false-positive guard: a "directly damaged" passive that HEALS does not produce a counter', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When directly damaged while below 40% HP, this Unit <unit-damage>repairs 20%</unit-damage> of its Max HP.',
            });
            const all = buildShipAbilities(s).slots.flatMap((x) => x.abilities);
            expect(all.filter((a) => a.type === 'counter')).toHaveLength(0);
        });

        it('false-positive guard: a reflect ("reflects X% of the Damage taken") passive does not produce a counter', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When directly damaged, this Unit reflects <unit-damage>40%</unit-damage> of the Damage taken to the attacker.',
            });
            const all = buildShipAbilities(s).slots.flatMap((x) => x.abilities);
            expect(all.filter((a) => a.type === 'counter')).toHaveLength(0);
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

        it('Guardian second passive: Binderburg grant rides on-attacked with crit filter; ally-Provoke sentence rides on-ally-attacked', () => {
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
            // The Provoke counter-debuff rides on-ally-attacked (Task 7 detector) and KEEPS
            // its enemy-side target — counter-routing rides eventCtx.counterTargetId, only
            // BUFF grants get target-forced to 'ally' (Task 9). The pre-trigger-era manual
            // self-debuff Provoke condition was a detectGrantConditions rule-5 artifact (the
            // GRANTED buff's own name matched the Provoke-standing targeting rule, not a real
            // "while Provoked" gate) — Task 9 drops self-referential status conditions when a
            // damage-reaction trigger attaches, so conditions are now empty.
            const provoke = passive?.abilities.find(
                (a) =>
                    a.type === 'debuff' &&
                    (a.config as { buffName?: string }).buffName === 'Provoke'
            );
            expect(provoke).toMatchObject({
                type: 'debuff',
                target: 'enemy',
                trigger: 'on-ally-attacked',
                triggerCritFilter: 'crit',
                conditions: [],
                config: { type: 'debuff', buffName: 'Provoke', duration: 1 },
            });
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

        it('Makoli second passive: the Disable counter-infliction flips to on-attacked WITH the derivable below-40% self hp-threshold condition', () => {
            // The "while below 40% HP" gate appears in the reaction sentence, so the detector
            // now surfaces hpBelowPct: 40.  The builder attaches the same derivable hp-threshold
            // shape used for the heal (Task 7) so the executor gates the Disable infliction at
            // drain time against the live tank HP — Disable no longer fires on every hit.
            const s = ship({
                refits: [{}, {}] as Ship['refits'],
                secondPassiveSkillText:
                    'When directly damaged while below 40% HP, this Unit <unit-damage>repairs 20%</unit-damage> of its Max HP and inflicts <unit-skill>Disable</unit-skill> for 1 turn.',
            });
            const debuff = passiveOf(s)?.abilities.find((a) => a.type === 'debuff');
            expect(debuff).toMatchObject({
                trigger: 'on-attacked',
                config: { buffName: 'Disable' },
            });
            expect(debuff!.conditions).toEqual([
                {
                    subject: 'hp-threshold',
                    derivable: true,
                    hpComparator: 'below',
                    hpPercent: 40,
                    hpSubject: 'self',
                },
            ]);
        });

        it('Guardian Binderburg (negative): ungated crit reaction keeps empty conditions', () => {
            // No "while below N% HP" in the Guardian sentence → conditions stay [].
            const s = ship({
                refits: [{}, {}] as Ship['refits'],
                secondPassiveSkillText:
                    'This Unit has 20% shield penetration. When this Unit is critically hit, it gains <unit-skill>Binderburg Resilience I</unit-skill> for 1 turn.<br /><br />When an ally is critically hit by an enemy, apply <unit-skill>Provoke</unit-skill> for 1 turn to that enemy.',
            });
            const buff = passiveOf(s)?.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Binderburg Resilience I'
            );
            expect(buff?.trigger).toBe('on-attacked');
            expect(buff?.conditions).toEqual([]);
        });

        it('Warden Corrosion (negative): ungated reaction DoT keeps empty conditions', () => {
            // No HP gate in Warden's sentence → conditions stay [].
            const s = ship({
                firstPassiveSkillText:
                    'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns on that enemy and repairs itself 3% of its Max HP.',
            });
            const debuff = passiveOf(s)?.abilities.find((a) => a.type === 'debuff');
            expect(debuff?.trigger).toBe('on-attacked');
            expect(debuff?.conditions).toEqual([]);
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

        it('Refine first passive: ally-subject reaction grant rides on-ally-attacked, recipient forced to the damaged ALLY', () => {
            // Spec-locked (Task 9): Refine's recipient-less "grants Inc. Damage Down I"
            // lands on the DAMAGED ally via eventCtx.damagedAllyId, which the executor only
            // honors for 'ally'-target intents — so the builder forces target 'ally' on
            // ally-damage-reaction BUFF grants.
            const s = ship({
                firstPassiveSkillText:
                    'When an ally is directly damaged, this Unit grants <unit-skill>Inc. Damage Down I</unit-skill> for 1 turn.',
            });
            const buff = passiveOf(s)?.abilities.find((a) => a.type === 'buff');
            expect(buff).toMatchObject({
                type: 'buff',
                target: 'ally',
                trigger: 'on-ally-attacked',
                config: { type: 'buff', buffName: 'Inc. Damage Down I', duration: 1 },
            });
            expect(buff!.triggerCritFilter).toBeUndefined();
            expect(buff!.roleFilter).toBeUndefined();
        });

        it('Refine second passive: identical sentence at duration 2 parses the same way', () => {
            const s = ship({
                refits: [{}, {}] as Ship['refits'],
                secondPassiveSkillText:
                    'When an ally is directly damaged, this Unit grants <unit-skill>Inc. Damage Down I</unit-skill> for 2 turns.',
            });
            const buff = passiveOf(s)?.abilities.find((a) => a.type === 'buff');
            expect(buff).toMatchObject({
                type: 'buff',
                target: 'ally',
                trigger: 'on-ally-attacked',
                config: { type: 'buff', buffName: 'Inc. Damage Down I', duration: 2 },
            });
        });

        it('Graphite passive: ally-role words become roleFilter on the on-ally-attacked grant', () => {
            // "when an ally attacker or debuffer is directly damaged" → the detector's
            // DR_ALLY_ROLES_RE surfaces CATEGORY-semantic roleFilter values; the builder
            // threads them onto the ability so the engine listener only fires when the
            // damaged ally's role matches. Explicit "grants the ally" recipient + the
            // Task 9 forcing both resolve to target 'ally'.
            const s = ship({
                firstPassiveSkillText:
                    'When an ally attacker or debuffer is directly damaged, this Unit grants the ally <unit-skill>Repair Over Time III</unit-skill> for 2 turns.',
            });
            const buff = passiveOf(s)?.abilities.find((a) => a.type === 'buff');
            expect(buff).toMatchObject({
                type: 'buff',
                target: 'ally',
                trigger: 'on-ally-attacked',
                roleFilter: ['ATTACKER', 'DEBUFFER'],
                config: { type: 'buff', buffName: 'Repair Over Time III', duration: 2 },
            });
            expect(buff!.triggerCritFilter).toBeUndefined();
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

        it('FrontLine R4 passive: start-of-combat max-HP shield + the on-enemy-charged-cast damage-dealt shield, no duplicate/taken shield', () => {
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
            // SP-G G3: the on-enemy-charged-cast reaction shield is now basis 'damage-dealt' (it
            // scales off FrontLine's OWN mitigated/crit reactive hit, via reactiveDealtByOwner —
            // see triggers.ts/engine.ts) — exactly ONE such shield, on the correct trigger.
            const damageDealtShields = shields.filter(
                (sh) => (sh.config as { basis: string }).basis === 'damage-dealt'
            );
            expect(damageDealtShields).toHaveLength(1);
            expect(damageDealtShields[0].trigger).toBe('on-enemy-charged-cast');
            // No damage-taken shield is produced from this passive.
            expect(
                shields.some((sh) => (sh.config as { basis: string }).basis === 'damage-taken')
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

        // Task 3: control abilities are now emitted ADDITIVELY for EVERY recognized inflicted
        // effect (provoke/taunt/concentrate-fire/disable), not just Stasis. The parallel named
        // status (debuff/buff) ability MUST stay byte-identical alongside the new control ability.
        it('active "applies Provoke" emits a provoke control ability AND keeps the named Provoke debuff', () => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>145% damage</unit-damage> and applies <unit-skill>Provoke</unit-skill> for 1 turn.',
            });
            const active = buildShipAbilities(s).slots.find((sl) => sl.slot === 'active');
            const control = active?.abilities.find(
                (a) => a.type === 'control' && a.config.type === 'control'
            );
            expect(control).toMatchObject({
                type: 'control',
                target: 'enemy',
                trigger: 'on-cast',
                config: { type: 'control', effect: 'provoke' },
            });
            // The named-status debuff (the path that actually performs the targeting lockout) is
            // still produced unchanged.
            const debuff = active?.abilities.find(
                (a) =>
                    a.type === 'debuff' &&
                    a.config.type === 'debuff' &&
                    a.config.buffName === 'Provoke'
            );
            expect(debuff).toBeDefined();
        });

        it('active "This Unit gains Taunt" emits a self-targeted taunt control ability AND keeps the named Taunt buff', () => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>145% damage</unit-damage>. This Unit gains <unit-skill>Taunt</unit-skill> for 1 turn.',
            });
            const active = buildShipAbilities(s).slots.find((sl) => sl.slot === 'active');
            const control = active?.abilities.find(
                (a) => a.type === 'control' && a.config.type === 'control'
            );
            expect(control).toMatchObject({
                type: 'control',
                target: 'self',
                trigger: 'on-cast',
                config: { type: 'control', effect: 'taunt' },
            });
            // The named Taunt buff (self buff) is still produced.
            const buff = active?.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Taunt'
            );
            expect(buff).toBeDefined();
        });

        it('active "inflicts Disable for 2 turns" emits a disable control ability targeting enemy', () => {
            const s = ship({
                activeSkillText:
                    'This Unit deals <unit-damage>145% damage</unit-damage> and inflicts <unit-skill>Disable</unit-skill> for 2 turns.',
            });
            const active = buildShipAbilities(s).slots.find((sl) => sl.slot === 'active');
            const control = active?.abilities.find(
                (a) => a.type === 'control' && a.config.type === 'control'
            );
            expect(control).toMatchObject({
                type: 'control',
                target: 'enemy',
                trigger: 'on-cast',
                config: { type: 'control', effect: 'disable' },
            });
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

        it('R2 passive parses the shield-on-Stasis clause AND the adjacency HP grant (PR F4)', () => {
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
            // PR F4: "When adjacent to a Supporter, this Unit gains 20% HP" is now parsed as a
            // permanent pre-fight stat grant (percent-of-own, Supporter-gated), applied by the
            // battle sim's pre-fight layer in F5.
            const preCombat = passive?.abilities.find((a) => a.type === 'pre-combat-stat');
            expect(preCombat).toMatchObject({
                type: 'pre-combat-stat',
                target: 'self',
                trigger: 'pre-combat',
                conditions: [],
                config: {
                    type: 'pre-combat-stat',
                    stat: 'hp',
                    value: 20,
                    valueKind: 'percent-of-own',
                    requiresAdjacentRole: 'SUPPORTER',
                },
            });
        });
    });

    // Phase 4b Task 9: Salvation's on-destroyed ally-heal. The refit-active (R4 / 3rd) passive
    // "When this Unit is destroyed it repairs 80% of its max HP to all allies" parses as a heal
    // ability stamped with trigger 'on-destroyed' so it fires only on death (via the Task-5
    // listener), NOT every round.
    // C2b-1 T5 update: the conjoined "when a buff is purged … repairs that ally 5%"
    // on-ally-purged heal is NOW modeled (on-ally-purged is a live trigger). Both heals emit.
    describe('Salvation 3rd passive: on-destroyed ally-heal (Task 9)', () => {
        const salvation = () =>
            ship({
                thirdPassiveSkillText:
                    "When this Unit is destroyed it <unit-damage>repairs 80%</unit-damage> of its max HP to all allies.<br /><br />When a <unit-aid>buff</unit-aid> is <unit-aid>purged</unit-aid> from an ally, this Unit <unit-damage>repairs that ally for 5%</unit-damage> of this Unit's max HP.",
            });

        it('emits the all-allies 80%-max-HP repair on trigger on-destroyed', () => {
            const passive = slot(buildShipAbilities(salvation()).slots, 'passive')!;
            const heal = passive.abilities.find(
                (a) => a.type === 'heal' && a.config.type === 'heal' && a.config.pct === 80
            );
            expect(heal).toBeDefined();
            expect(heal!.target).toBe('all-allies');
            expect(heal!.trigger).toBe('on-destroyed');
            if (heal!.config.type === 'heal') {
                expect(heal!.config.basis).toBe('hp');
            }
        });

        it('emits the ally 5%-max-HP repair on trigger on-ally-purged (C2b-1 T5)', () => {
            // on-ally-purged is now a live trigger — the 5% heal emits alongside the 80% heal.
            const passive = slot(buildShipAbilities(salvation()).slots, 'passive')!;
            const fivePct = passive.abilities.find(
                (a) => a.type === 'heal' && a.config.type === 'heal' && a.config.pct === 5
            );
            expect(fivePct).toBeDefined();
            expect(fivePct!.trigger).toBe('on-ally-purged');
            expect(fivePct!.target).toBe('ally');
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
            // An older in-game phrasing reads "this unit grants 1 charge to all
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

    // Phase 4c PR 3 (Task 7): "when HP drops/falls below N%" buff-grant reactives ride the
    // on-hp-threshold-crossed trigger with a derivable self hp-threshold condition; "once per
    // battle" maps to config.oncePerCombat. Sentence-scoped at the buff's anchor, so the
    // start-of-combat Cheat Death / Everliving (Tycho) and the standing direct-damage modifier
    // (Los) — which sit in different sentences/paragraphs — are untouched. Hermes's charged
    // Cheat Death "if the target has less than N% HP" grant narrows to the heal target.
    describe('hp-crossing reactive buff grants → on-hp-threshold-crossed (Phase 4c PR 3)', () => {
        const selfHpBelow = (pct: number) => ({
            subject: 'hp-threshold',
            derivable: true,
            hpComparator: 'below',
            hpPercent: pct,
            hpSubject: 'self',
        });

        it('Tycho R4 passive: Barrier rides on-hp-threshold-crossed (below 40%, once per battle); Cheat Death / Everliving II untouched', () => {
            const s = ship({
                thirdPassiveSkillText:
                    'At the start of combat, this Unit gains <unit-skill>Cheat Death</unit-skill> and <unit-skill>Everliving Regeneration II</unit-skill> for 9 turns. Once per battle, when HP drops below 40% it gains <unit-skill>Barrier</unit-skill> for 1 turn.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;
            const barrier = passive.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Barrier'
            )!;
            expect(barrier).toMatchObject({
                type: 'buff',
                target: 'self',
                trigger: 'on-hp-threshold-crossed',
                conditions: [selfHpBelow(40)],
            });
            expect(barrier.config).toMatchObject({ duration: 1, oncePerCombat: true });
            // Epic PR4: the start-of-combat grants now ride 'pre-combat' (not the crossing
            // trigger / condition — they carry no HP gate of their own, just the annotation-only
            // one-time-grant relabel shared with Crucialis/Meatshield/FrontLine/Yazid).
            const cheatDeath = passive.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Cheat Death'
            )!;
            expect(cheatDeath).toMatchObject({ trigger: 'pre-combat', conditions: [] });
            expect(cheatDeath.config).toMatchObject({ duration: 'recurring' });
            const everliving = passive.abilities.find(
                (a) =>
                    a.config.type === 'buff' && a.config.buffName === 'Everliving Regeneration II'
            )!;
            expect(everliving).toMatchObject({ trigger: 'pre-combat', conditions: [] });
            expect(everliving.config).toMatchObject({ duration: 9 });
        });

        it('Shelter R4 passive: BOTH grants ride on-hp-threshold-crossed (below 20%, once per battle) at durations 1 and 3', () => {
            const s = ship({
                thirdPassiveSkillText:
                    'This Unit gains <unit-skill>Barrier</unit-skill> for 1 turn and <unit-skill>Inc. Damage Down II</unit-skill> for 3 turns when HP drops below 20%, once per battle.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;
            const barrier = passive.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Barrier'
            )!;
            expect(barrier).toMatchObject({
                type: 'buff',
                target: 'self',
                trigger: 'on-hp-threshold-crossed',
                conditions: [selfHpBelow(20)],
            });
            expect(barrier.config).toMatchObject({ duration: 1, oncePerCombat: true });
            const incDown = passive.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Inc. Damage Down II'
            )!;
            expect(incDown).toMatchObject({
                type: 'buff',
                target: 'self',
                trigger: 'on-hp-threshold-crossed',
                conditions: [selfHpBelow(20)],
            });
            expect(incDown.config).toMatchObject({ duration: 3, oncePerCombat: true });
        });

        it('Los R0 passive: Barrier wired (below 50%, once per battle); standing direct-damage modifier untouched', () => {
            const s = ship({
                firstPassiveSkillText:
                    'This Unit deals 30% more Direct damage when its HP is below 50%.<br />Once per battle when HP falls below 50%, it grants <unit-skill>Barrier</unit-skill> for 1 turn.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;
            const barrier = passive.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Barrier'
            )!;
            expect(barrier).toMatchObject({
                type: 'buff',
                target: 'self',
                trigger: 'on-hp-threshold-crossed',
                conditions: [selfHpBelow(50)],
            });
            expect(barrier.config).toMatchObject({ duration: 1, oncePerCombat: true });
            // The outgoing-damage modifier KEEPS its on-cast trigger + existing hp-threshold gate
            // (its own sentence carries no drops/falls verb → no crossing reclassification).
            const mod = passive.abilities.find(
                (a) => a.config.type === 'modifier' && a.config.channel === 'outgoingDamage'
            )!;
            expect(mod.trigger).toBe('on-cast');
            expect(mod.config).toMatchObject({ channel: 'outgoingDamage', value: 30 });
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

        it('Kafa R0 passive: Terran Tenacity I rides on-hp-threshold-crossed (below 50%, NO once per battle), duration 3', () => {
            const s = ship({
                firstPassiveSkillText:
                    'This Unit gains <unit-skill>Terran Tenacity I</unit-skill> for 3 turns when HP drops below 50%.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;
            const buff = passive.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Terran Tenacity I'
            )!;
            expect(buff).toMatchObject({
                type: 'buff',
                target: 'self',
                trigger: 'on-hp-threshold-crossed',
                conditions: [selfHpBelow(50)],
            });
            expect(buff.config).toMatchObject({ duration: 3 });
            // No "once per battle" in the sentence → flag absent (unbounded).
            expect(
                buff.config.type === 'buff' ? buff.config.oncePerCombat : undefined
            ).toBeUndefined();
        });

        it('Redeemer R0 passive: Defense Up II rides on-hp-threshold-crossed (below 60%); standing shield untouched', () => {
            const s = ship({
                firstPassiveSkillText:
                    'This Unit gains <unit-damage>Shield equal to 2.5%</unit-damage> of its Max HP every turn.<br />When HP drops below 60% it gains <unit-skill>Defense Up II</unit-skill> for 4 turns.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive')!;
            const buff = passive.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Defense Up II'
            )!;
            expect(buff).toMatchObject({
                type: 'buff',
                target: 'self',
                trigger: 'on-hp-threshold-crossed',
                conditions: [selfHpBelow(60)],
            });
            expect(buff.config).toMatchObject({ duration: 4 });
            // The every-turn shield sits in its own <br>-separated sentence → untouched.
            const shield = passive.abilities.find((a) => a.type === 'shield')!;
            expect(shield.trigger).not.toBe('on-hp-threshold-crossed');
        });

        it('Hermes charged: Cheat Death narrows to the heal target with a derivable below-40% target hp-threshold; heal + charge unchanged', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit <unit-damage>repairs 37%</unit-damage> of its Max HP and <unit-aid>adds 1 charge</unit-aid> to the Charged Skill.<br /><br />If the target has less than 40% HP, it grants <unit-skill>Cheat Death</unit-skill>.',
                chargeSkillCharge: 4,
            });
            const charged = slot(buildShipAbilities(s).slots, 'charged')!;
            const cheatDeath = charged.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Cheat Death'
            )!;
            expect(cheatDeath).toMatchObject({
                type: 'buff',
                target: 'ally',
                trigger: 'on-cast',
                conditions: [
                    {
                        subject: 'hp-threshold',
                        derivable: true,
                        hpComparator: 'below',
                        hpPercent: 40,
                        hpSubject: 'target',
                    },
                ],
            });
            expect(cheatDeath.config).toMatchObject({ duration: 'recurring' });
            // The 37% repair is an AoE all-allies heal (support footprint); the 1 charge is
            // unchanged. (Cheat Death above still narrows to the single low-HP ally.)
            const heal = charged.abilities.find((a) => a.type === 'heal')!;
            expect(heal).toMatchObject({
                type: 'heal',
                target: 'all-allies',
                config: { type: 'heal', pct: 37, basis: 'hp' },
            });
            const charge = charged.abilities.find((a) => a.type === 'charge')!;
            expect(charge.config).toMatchObject({ type: 'charge', amount: 1 });
        });

        it('Hayyan charged: Cheat Death stays an unconditional all-allies on-cast grant (byte-identical; only engine cadence changed in Task 5)', () => {
            const s = ship({
                chargeSkillText:
                    'This Unit <unit-damage>repairs 17%</unit-damage> of its Max HP, grants <unit-skill>Cheat Death</unit-skill> to all allies, and <unit-aid>adds 1 charge</unit-aid> to their Charged Skill.',
                chargeSkillCharge: 4,
            });
            const charged = slot(buildShipAbilities(s).slots, 'charged')!;
            const cheatDeath = charged.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Cheat Death'
            )!;
            expect(cheatDeath).toMatchObject({
                type: 'buff',
                target: 'all-allies',
                trigger: 'on-cast',
                conditions: [],
            });
        });
    });

    // Phase 4c PR 4 (Task 6): player ships react to an ENEMY's repair/cleanse. These triggers
    // are LIVE in healing mode (the DPS sim ignores enemy-action triggers, so the 22 DPS goldens
    // stay byte-identical). Per-ship lock tests mirror the PR3 hp-crossing reactive block.
    describe('enemy-action reactives → on-enemy-repaired / on-enemy-cleansed (Phase 4c PR 4)', () => {
        const passiveOf = (s: Ship): Skill | undefined =>
            buildShipAbilities(s).slots.find((x) => x.slot === 'passive');

        it('Zosimos passive: enemy-repair charge gain rides on-enemy-repaired (self, derivable)', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When an enemy repairs, this Unit <unit-aid>gains a charge</unit-aid> to its Charged Skill.',
            });
            const charge = passiveOf(s)?.abilities.find((a) => a.type === 'charge');
            expect(charge).toMatchObject({
                type: 'charge',
                target: 'self',
                trigger: 'on-enemy-repaired',
                conditions: [],
                config: { type: 'charge', amount: 1 },
            });
        });

        it('Arum first passive: Out. Damage Down I debuff rides on-enemy-cleansed (enemy, 1 turn)', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When an enemy <unit-aid>cleanses a debuff</unit-aid>, this Unit inflicts all cleansed enemies with <unit-skill>Out. Damage Down I</unit-skill> for 1 turn.',
            });
            const debuff = passiveOf(s)?.abilities.find(
                (a) => a.config.type === 'debuff' && a.config.buffName === 'Out. Damage Down I'
            );
            expect(debuff).toMatchObject({
                type: 'debuff',
                target: 'enemy',
                trigger: 'on-enemy-cleansed',
                config: { type: 'debuff', buffName: 'Out. Damage Down I', duration: 1 },
            });
        });

        it('Arum SECOND (refit) passive: debuff (enemy) AND all-allies Gelecek Contagion II buff, both on-enemy-cleansed', () => {
            const s = ship({
                // factory default refits + only secondPassiveSkillText → getShipSkillRows picks Passive R2
                secondPassiveSkillText:
                    'When an enemy <unit-aid>cleanses a debuff</unit-aid>, this Unit inflicts all cleansed enemies with <unit-skill>Out. Damage Down I</unit-skill> for 1 turn and this Unit grants all allies <unit-skill>Gelecek Contagion II</unit-skill> for 3 turns.',
            });
            const passive = passiveOf(s);
            const debuff = passive?.abilities.find(
                (a) => a.config.type === 'debuff' && a.config.buffName === 'Out. Damage Down I'
            );
            expect(debuff).toMatchObject({
                type: 'debuff',
                target: 'enemy',
                trigger: 'on-enemy-cleansed',
                config: { type: 'debuff', buffName: 'Out. Damage Down I', duration: 1 },
            });
            const buff = passive?.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Gelecek Contagion II'
            );
            expect(buff).toMatchObject({
                type: 'buff',
                target: 'all-allies',
                trigger: 'on-enemy-cleansed',
                config: { type: 'buff', buffName: 'Gelecek Contagion II', duration: 3 },
            });
        });

        it('Yarrow/Larkspur passive: self Gelecek Contagion I buff rides on-enemy-cleansed (self, 2 turns)', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When an enemy <unit-aid>cleanses a Debuff</unit-aid>, this Unit gains <unit-skill>Gelecek Contagion I</unit-skill> for 2 turns.',
            });
            const buff = passiveOf(s)?.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Gelecek Contagion I'
            );
            expect(buff).toMatchObject({
                type: 'buff',
                target: 'self',
                trigger: 'on-enemy-cleansed',
                config: { type: 'buff', buffName: 'Gelecek Contagion I', duration: 2 },
            });
        });

        it('Grif first (non-refit) passive: 75% noCrit damage proc ALONE rides on-enemy-cleansed (no defense modifier)', () => {
            const s = ship({
                firstPassiveSkillText:
                    'When an enemy <unit-aid>cleanses a Debuff</unit-aid>, this Unit deals <unit-damage>75% Damage</unit-damage> that cannot critically hit.',
            });
            const passive = passiveOf(s);
            const dmg = passive?.abilities.find((a) => a.type === 'damage');
            expect(dmg).toMatchObject({
                type: 'damage',
                target: 'enemy',
                trigger: 'on-enemy-cleansed',
                config: { type: 'damage', multiplier: 75, noCrit: true },
            });
            // No standing defense modifier on the non-refit passive.
            expect(passive?.abilities.find((a) => a.type === 'modifier')).toBeUndefined();
        });

        it('Grif SECOND (refit) passive: standing +20% self defense modifier AND on-enemy-cleansed 75% noCrit damage proc', () => {
            const s = ship({
                secondPassiveSkillText:
                    'This Unit increases its Defense by 20%. When an enemy <unit-aid>cleanses a Debuff</unit-aid>, this Unit deals <unit-damage>75% Damage</unit-damage> that cannot critically hit.',
            });
            const passive = passiveOf(s);
            const mod = passive?.abilities.find((a) => a.type === 'modifier');
            expect(mod).toMatchObject({
                type: 'modifier',
                target: 'self',
                trigger: 'on-cast',
                config: { type: 'modifier', channel: 'defense', value: 20, isMultiplicative: true },
            });
            const dmg = passive?.abilities.find((a) => a.type === 'damage');
            expect(dmg).toMatchObject({
                type: 'damage',
                target: 'enemy',
                trigger: 'on-enemy-cleansed',
                config: { type: 'damage', multiplier: 75, noCrit: true },
            });
        });

        // CodeRabbit #99 FIX #2: the standing "+N% Defense" modifier must only emit when its
        // containing sentence is a STANDALONE/standing clause — a finite-duration or
        // trigger-gated clause with the same wording must NOT be promoted to a permanent buff.
        it('does NOT emit a standing defense modifier for a finite-duration "for N turns" clause', () => {
            const s = ship({
                secondPassiveSkillText: 'This Unit increases its Defense by 20% for 2 turns.',
            });
            const passive = passiveOf(s);
            const mod = passive?.abilities.find(
                (a) =>
                    a.type === 'modifier' &&
                    a.config.type === 'modifier' &&
                    a.config.channel === 'defense'
            );
            expect(mod).toBeUndefined();
        });

        it('does NOT emit a standing defense modifier for a trigger-gated "When an enemy cleanses" clause', () => {
            const s = ship({
                secondPassiveSkillText:
                    'When an enemy <unit-aid>cleanses a Debuff</unit-aid>, this Unit increases its Defense by 20%.',
            });
            const passive = passiveOf(s);
            const mod = passive?.abilities.find(
                (a) =>
                    a.type === 'modifier' &&
                    a.config.type === 'modifier' &&
                    a.config.channel === 'defense'
            );
            expect(mod).toBeUndefined();
        });
    });
});

describe('buildShipAbilities — all-allies charge-bar grants (Hayyan / Graphite)', () => {
    it('Hayyan charged slot: emits a charge / all-allies / on-cast ability with no conditions', () => {
        const s = ship({
            chargeSkillText:
                'This Unit <unit-damage>repairs 17%</unit-damage> of its Max HP, grants <unit-skill>Cheat Death</unit-skill> to all allies, and <unit-aid>adds 1 charge</unit-aid> to their Charged Skill.',
            chargeSkillCharge: 4,
        });

        const { slots } = buildShipAbilities(s);
        const charged = slot(slots, 'charged');
        expect(charged).toBeDefined();

        const charge = abilityOfType(charged!.abilities, 'charge');
        expect(charge).toMatchObject({
            type: 'charge',
            target: 'all-allies',
            trigger: 'on-cast',
            config: { type: 'charge', amount: 1 },
            autoFilled: true,
        });
        expect(charge!.conditions).toEqual([]);
    });

    it('Graphite passive (R4): emits charge / all-allies / start-of-round + enemy-Stealth condition', () => {
        const s = ship({
            thirdPassiveSkillText:
                'When an ally attacker or debuffer is directly damaged, this Unit grants the ally <unit-skill>Repair Over Time III</unit-skill> for 2 turns.<br /><br />At the start of the round, if an enemy Unit has <unit-skill>Stealth</unit-skill>, this Unit <unit-aid>adds 2 charges</unit-aid> to the charged skill of all allies within the active pattern.',
        });

        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive');
        expect(passive).toBeDefined();

        const charge = abilityOfType(passive!.abilities, 'charge');
        expect(charge).toMatchObject({
            type: 'charge',
            target: 'all-allies',
            trigger: 'start-of-round',
            config: { type: 'charge', amount: 2 },
            autoFilled: true,
        });
        expect(charge!.conditions[0]).toMatchObject({
            subject: 'enemy-buff',
            buffName: 'Stealth',
            derivable: true,
        });
    });

    it('self-charge ship still emits charge / self and NOT an all-allies grant — Selenite', () => {
        const s = ship({
            activeSkillText:
                "If any target is <unit-aid>Stealthed</unit-aid>, it <unit-aid>adds 1 charge</unit-aid> to this Unit's Charged Skill.",
            chargeSkillCharge: 4,
        });

        const { slots } = buildShipAbilities(s);
        const active = slot(slots, 'active');
        const charges = active!.abilities.filter((a) => a.type === 'charge');
        expect(charges).toHaveLength(1);
        expect(charges[0].target).toBe('self');
    });

    // Regression: Liberator's real CSV text matches BOTH parseAllyChargeOnEnemyDeath (correct,
    // on-enemy-destroyed) AND ALLY_CHARGE_GRANT_RE (the Hayyan/Graphite on-cast parser). The
    // on-death exclusion guard in parseAllyChargeGrant must keep Liberator on the death path
    // ONLY — exactly one charge ability, never a spurious second on-cast one.
    it('Liberator real passive: emits EXACTLY ONE charge — on-enemy-destroyed / all-allies, no on-cast double', () => {
        const s = ship({
            firstPassiveSkillText:
                'This Unit has 40% Shield Penetration. When an enemy dies, all allies <unit-aid>add 1 charge</unit-aid> to their Charged Skills.',
        });

        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive');
        expect(passive).toBeDefined();

        const charges = passive!.abilities.filter((a) => a.type === 'charge');
        expect(charges).toHaveLength(1);
        expect(charges[0]).toMatchObject({
            type: 'charge',
            target: 'all-allies',
            trigger: 'on-enemy-destroyed',
            oncePerRound: true,
            config: { type: 'charge', amount: 1 },
        });
        // No spurious on-cast charge from parseAllyChargeGrant.
        expect(charges.some((c) => c.trigger === 'on-cast')).toBe(false);
    });
});

// ── §4.5 Akula exception: doesntBreakStasis ───────────────────────────────────────────────

describe('buildShipAbilities doesntBreakStasis', () => {
    it("Akula: doesntBreakStasis=true (curly-apostrophe don't break Stasis in passive)", () => {
        // Akula's refit-active passive text uses curly apostrophe + "don't break Stasis".
        const s = ship({
            firstPassiveSkillText:
                "This Unit's attacks don’t break Stasis. Increases outgoing direct damage by up to 30% based on the target's current HP percentage; the higher the percentage, the more the damage.",
        });
        const result = buildShipAbilities(s);
        expect(result.doesntBreakStasis).toBe(true);
    });

    it('Tygr: doesntBreakStasis=true (bare "do not break Stasis" in passive)', () => {
        // Tygr's refit-active passive text uses "do not break Stasis".
        const s = ship({
            firstPassiveSkillText:
                "This Unit's attacks do not break Stasis and deal 30% more damage to enemies with Stasis or Disable.",
        });
        const result = buildShipAbilities(s);
        expect(result.doesntBreakStasis).toBe(true);
    });

    it('unrelated ship: doesntBreakStasis is absent (falsy) when no don-break clause', () => {
        const s = ship({
            firstPassiveSkillText:
                'This Unit deals 180% damage and inflicts Corrosion for 2 turns.',
        });
        const result = buildShipAbilities(s);
        expect(result.doesntBreakStasis).toBeFalsy();
    });
});

// ── Phase 0 Task 6: chargeLossImmune ──────────────────────────────────────────────────────

describe('buildShipAbilities chargeLossImmune', () => {
    it('Lev: chargeLossImmune=true when passive text says "immune to charge loss effects"', () => {
        // Lev's refit-active passive text carries the immunity clause.
        const s = ship({
            firstPassiveSkillText:
                "This Unit is immune to charge loss effects. This Unit's crit rate and crit power are increased 20%.",
        });
        const result = buildShipAbilities(s);
        expect(result.chargeLossImmune).toBe(true);
    });

    it('chargeLossImmune=true for hyphenated form "charge-loss"', () => {
        const s = ship({ firstPassiveSkillText: 'This Unit is immune to charge-loss effects.' });
        const result = buildShipAbilities(s);
        expect(result.chargeLossImmune).toBe(true);
    });

    it('unrelated ship: chargeLossImmune is absent (falsy) when no immunity clause', () => {
        const s = ship({
            firstPassiveSkillText:
                'This Unit deals 180% damage and inflicts Corrosion for 2 turns.',
        });
        const result = buildShipAbilities(s);
        expect(result.chargeLossImmune).toBeFalsy();
    });
});

// ── ship-kit correctness backlog: ignoresForcedTargeting (ignore Taunt/Provoke) ────────────
// Judge/Stalwart/Yuyan/Huanying/Valkyrie/Vanguard's kit text states their attacks "ignore
// Taunt and Provoke". RAW active-skill strings from docs/ship-skills.csv (the Supabase-fetched
// master), fed through the production buildShipAbilities(ship) path. Skill data's master is
// Supabase ship_templates → docs/ship-skills.csv; tagged CSV text is what production actually
// parses, so fixtures use it verbatim rather than any hand-maintained constant.
describe('buildShipAbilities ignoresForcedTargeting', () => {
    it.each([
        [
            'Judge',
            "This Unit's attack ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill>, deals <unit-damage>230% damage</unit-damage>, and applies <unit-skill>Concentrate Fire</unit-skill> for 1 turn.",
        ],
        [
            'Stalwart',
            'This Unit deals <unit-damage>200% damage</unit-damage>, ignoring <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill>, and applies <unit-skill>Concentrate Fire</unit-skill> for 1 turn.',
        ],
        [
            'Yuyan',
            "This Unit's attack ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill>, deals <unit-damage>170% damage</unit-damage>, applies <unit-skill>Concentrate Fire</unit-skill> for 1 turn, and inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns.",
        ],
        [
            'Huanying',
            'This Unit ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill>, dealing <unit-damage>120% damage</unit-damage> and inflicting <unit-skill>Bomb I</unit-skill> for 2 turns.',
        ],
        [
            'Valkyrie',
            'This Unit deals <unit-damage>200% damage</unit-damage> and ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill>.<br />Inflict <unit-skill>Defense Down II</unit-skill> for 2 turns and apply <unit-skill>Concentrate Fire</unit-skill> for 1 turn.',
        ],
        [
            'Vanguard',
            "This Unit's attack ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> and deals <unit-damage>100% damage</unit-damage>.",
        ],
    ])('%s: ignoresForcedTargeting=true from CSV active-skill text', (_name, activeSkillText) => {
        const result = buildShipAbilities(ship({ activeSkillText }));
        expect(result.ignoresForcedTargeting).toBe(true);
    });

    it('unrelated ship (no ignore clause): ignoresForcedTargeting is absent (falsy)', () => {
        const activeSkillText =
            'This Unit deals <unit-damage>50% damage</unit-damage> plus an additional amount equal to <unit-damage>60%</unit-damage> of its Defense and inflicts <unit-skill>Defense Down I</unit-skill> for 1 turn.';
        const result = buildShipAbilities(ship({ activeSkillText }));
        expect(result.ignoresForcedTargeting).toBeFalsy();
    });
});

// C2b-1 T5: Sefuba and Salvation reactive heal triggers + Sefuba chain purge.
// RAW strings from docs/ship-skills.csv.
describe('buildShipAbilities — on-enemy-purged and on-ally-purged heal triggers (T5)', () => {
    describe('Sefuba p1: on-enemy-purged self-heal, no chain purge', () => {
        const sefubaP1 = () =>
            ship({
                firstPassiveSkillText:
                    'When this Unit <unit-aid>purges a buff</unit-aid> from an enemy, it <unit-damage>repairs itself for 8%</unit-damage> Max HP.',
            });

        it('emits a self heal with trigger on-enemy-purged', () => {
            const passive = slot(buildShipAbilities(sefubaP1()).slots, 'passive')!;
            const heal = passive.abilities.find((a) => a.type === 'heal');
            expect(heal).toBeDefined();
            expect(heal!.trigger).toBe('on-enemy-purged');
            expect(heal!.target).toBe('self');
            if (heal!.config.type === 'heal') {
                expect(heal!.config.pct).toBe(8);
            }
        });

        it('does NOT emit a chain purge ability', () => {
            const passive = slot(buildShipAbilities(sefubaP1()).slots, 'passive')!;
            expect(passive.abilities.filter((a) => a.type === 'purge')).toHaveLength(0);
        });
    });

    describe('Sefuba p2: on-enemy-purged self-heal + chain purge (count 1)', () => {
        // secondPassiveSkillText maps to the refit-active passive → slot 'passive'
        const sefubaP2 = () =>
            ship({
                secondPassiveSkillText:
                    'When this Unit <unit-aid>purges an enemy buff</unit-aid>, it <unit-damage>repairs itself for 12%</unit-damage> Max HP and <unit-aid>purges 1</unit-aid> more buff from the enemy.',
            });

        it('emits a self heal with trigger on-enemy-purged', () => {
            const passive = slot(buildShipAbilities(sefubaP2()).slots, 'passive')!;
            const heal = passive.abilities.find((a) => a.type === 'heal');
            expect(heal).toBeDefined();
            expect(heal!.trigger).toBe('on-enemy-purged');
            expect(heal!.target).toBe('self');
            if (heal!.config.type === 'heal') {
                expect(heal!.config.pct).toBe(12);
            }
        });

        it('emits exactly ONE chain purge with trigger on-enemy-purged and count 1', () => {
            const passive = slot(buildShipAbilities(sefubaP2()).slots, 'passive')!;
            const purges = passive.abilities.filter((a) => a.type === 'purge');
            expect(purges).toHaveLength(1);
            const purge = purges[0];
            expect(purge.trigger).toBe('on-enemy-purged');
            expect(purge.target).toBe('enemy');
            if (purge.config.type === 'purge') {
                expect(purge.config.count).toBe(1);
            }
        });
    });

    describe('Salvation p3: on-ally-purged 5% heal + on-destroyed 80% heal', () => {
        const salvation = () =>
            ship({
                thirdPassiveSkillText:
                    "When this Unit is destroyed it <unit-damage>repairs 80%</unit-damage> of its max HP to all allies.<br /><br />When a <unit-aid>buff</unit-aid> is <unit-aid>purged</unit-aid> from an ally, this Unit <unit-damage>repairs that ally for 5%</unit-damage> of this Unit's max HP.",
            });

        it('emits the 5% ally heal with trigger on-ally-purged', () => {
            const passive = slot(buildShipAbilities(salvation()).slots, 'passive')!;
            const fivePct = passive.abilities.find(
                (a) => a.type === 'heal' && a.config.type === 'heal' && a.config.pct === 5
            );
            expect(fivePct).toBeDefined();
            expect(fivePct!.trigger).toBe('on-ally-purged');
            expect(fivePct!.target).toBe('ally');
        });

        it('still emits the 80% all-allies heal with trigger on-destroyed', () => {
            const passive = slot(buildShipAbilities(salvation()).slots, 'passive')!;
            const eightyPct = passive.abilities.find(
                (a) => a.type === 'heal' && a.config.type === 'heal' && a.config.pct === 80
            );
            expect(eightyPct).toBeDefined();
            expect(eightyPct!.trigger).toBe('on-destroyed');
            expect(eightyPct!.target).toBe('all-allies');
        });

        it('emits exactly 2 heal abilities (80% on-destroyed + 5% on-ally-purged), no purge', () => {
            const passive = slot(buildShipAbilities(salvation()).slots, 'passive')!;
            expect(passive.abilities.filter((a) => a.type === 'heal')).toHaveLength(2);
            expect(passive.abilities.filter((a) => a.type === 'purge')).toHaveLength(0);
        });
    });
});

// C2b-2 T1: Iridium passive-slot purge emit (on-attacked trigger from "when directly damaged").
// RAW strings from docs/ship-skills.csv.
describe('buildShipAbilities — Iridium passive purge emit (C2b-2 T1)', () => {
    // Iridium p1: "When directly damaged, This Unit purges 1 buff from the enemy ..."
    // → exactly ONE purge ability with trigger:'on-attacked', count:1
    describe('Iridium p1: on-attacked purge count 1', () => {
        const iridiumP1 = () =>
            ship({
                firstPassiveSkillText:
                    'When directly damaged, This Unit <unit-aid>purges 1</unit-aid> buff from the enemy and inflicts <unit-skill>Speed Down I</unit-skill> for 1 turn.',
            });

        it('emits exactly ONE purge ability with trigger on-attacked and count 1', () => {
            const passive = slot(buildShipAbilities(iridiumP1()).slots, 'passive')!;
            const purges = passive.abilities.filter((a) => a.type === 'purge');
            expect(purges).toHaveLength(1);
            const purge = purges[0];
            expect(purge.trigger).toBe('on-attacked');
            expect(purge.target).toBe('enemy');
            if (purge.config.type === 'purge') {
                expect(purge.config.count).toBe(1);
            }
        });
    });

    // Iridium p2: "... When directly damaged, This Unit purges 2 buffs from the enemy ..."
    // → exactly ONE purge ability with trigger:'on-attacked', count:2
    describe('Iridium p2: on-attacked purge count 2', () => {
        const iridiumP2 = () =>
            ship({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                refits: [{}, {}] as any,
                secondPassiveSkillText:
                    'This Unit takes 35% less damage from Critical hits, and this effect does not stack with similar effects.<br /><br />When directly damaged, This Unit <unit-aid>purges 2</unit-aid> buffs from the enemy and inflicts <unit-skill>Speed Down II</unit-skill> for 1 turn.<br /><br />Start of combat, This Unit gains <unit-skill>Taunt</unit-skill> for 1 turn.',
            });

        it('emits exactly ONE purge ability with trigger on-attacked and count 2', () => {
            const passive = slot(buildShipAbilities(iridiumP2()).slots, 'passive')!;
            const purges = passive.abilities.filter((a) => a.type === 'purge');
            expect(purges).toHaveLength(1);
            const purge = purges[0];
            expect(purge.trigger).toBe('on-attacked');
            expect(purge.target).toBe('enemy');
            if (purge.config.type === 'purge') {
                expect(purge.config.count).toBe(2);
            }
        });
    });

    // Negative regressions: Sefuba, Zeolite, Cobalt must NOT be affected.
    describe('negative regressions: Sefuba / Zeolite / Cobalt', () => {
        it('Sefuba p1: passive emits ZERO purge abilities (only on-enemy-purged heal, no generic-loop purge)', () => {
            const sefubaP1 = ship({
                firstPassiveSkillText:
                    'When this Unit <unit-aid>purges a buff</unit-aid> from an enemy, it <unit-damage>repairs itself for 8%</unit-damage> Max HP.',
            });
            const passive = slot(buildShipAbilities(sefubaP1).slots, 'passive')!;
            expect(passive.abilities.filter((a) => a.type === 'purge')).toHaveLength(0);
        });

        it('Sefuba p2: passive emits exactly ONE purge (chain, on-enemy-purged via PURGE_MORE_RE — NOT a generic-loop purge)', () => {
            const sefubaP2 = ship({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                refits: [{}, {}] as any,
                secondPassiveSkillText:
                    'When this Unit <unit-aid>purges an enemy buff</unit-aid>, it <unit-damage>repairs itself for 12%</unit-damage> Max HP and <unit-aid>purges 1</unit-aid> more buff from the enemy.',
            });
            const passive = slot(buildShipAbilities(sefubaP2).slots, 'passive')!;
            const purges = passive.abilities.filter((a) => a.type === 'purge');
            expect(purges).toHaveLength(1);
            expect(purges[0].trigger).toBe('on-enemy-purged'); // PURGE_MORE_RE path, not generic loop
        });

        it('Zeolite p1: passive emits ZERO purge abilities ("when dealing damage to a Defender" has no detected damage-reaction trigger)', () => {
            const zeoliteP1 = ship({
                firstPassiveSkillText:
                    'This Unit <unit-aid>purges 1</unit-aid> buff from the enemy when dealing damage to a Defender.',
            });
            const passive = slot(buildShipAbilities(zeoliteP1).slots, 'passive');
            // Either no passive slot at all, or if a slot exists it has no purge abilities.
            if (passive) {
                expect(passive.abilities.filter((a) => a.type === 'purge')).toHaveLength(0);
            }
        });

        it('Zeolite p2 (R2 refit-active): "+30% damage when hitting a Defender" is gated on enemy-type Defender', () => {
            const zeoliteP2 = ship({
                secondPassiveSkillText:
                    'This Unit increases <unit-damage>damage by 30%</unit-damage> when hitting a Defender and <unit-aid>purges 1</unit-aid> buff from the enemy when dealing damage to a Defender.',
            });
            const passive = slot(buildShipAbilities(zeoliteP2).slots, 'passive')!;
            const mod = passive.abilities.find(
                (a) => a.config.type === 'modifier' && a.config.channel === 'outgoingDamage'
            )!;
            expect(mod).toBeDefined();
            expect(mod.conditions).toEqual([
                { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
            ]);
        });

        it('Cobalt active: emits exactly ONE purge with trigger on-cast (active slot unaffected)', () => {
            const cobalt = ship({
                activeSkillText:
                    "This Unit purges <unit-aid>1 buff</unit-aid> from the enemy and deals <unit-damage>200% damage</unit-damage>. If this Unit has more HP than the enemy, it additionally deals <unit-damage>damage equal to 25%</unit-damage> of this Unit's max HP.",
                chargeSkillCharge: 3,
            });
            const active = slot(buildShipAbilities(cobalt).slots, 'active')!;
            const purges = active.abilities.filter((a) => a.type === 'purge');
            expect(purges).toHaveLength(1);
            expect(purges[0].trigger).toBe('on-cast');
        });

        it('Cobalt charged: emits exactly ONE purge with trigger on-cast (charged slot unaffected)', () => {
            const cobalt = ship({
                activeSkillText:
                    'This Unit purges <unit-aid>1 buff</unit-aid> from the enemy and deals <unit-damage>200% damage</unit-damage>.',
                chargeSkillText:
                    'This Unit purges <unit-aid>1 buff</unit-aid> from the enemy and deals <unit-damage>230% damage</unit-damage>. If this Unit is at full HP, it deals additional <unit-damage>damage equal to 30%</unit-damage> of its max HP.',
                chargeSkillCharge: 3,
            });
            const charged = slot(buildShipAbilities(cobalt).slots, 'charged')!;
            const purges = charged.abilities.filter((a) => a.type === 'purge');
            expect(purges).toHaveLength(1);
            expect(purges[0].trigger).toBe('on-cast');
        });
    });
});

// ---------------------------------------------------------------------------
// C2b-2 T4: Rhodium end-of-round + enemy-most-buffs purge build tests.
// RAW strings from docs/ship-skills.csv (Rhodium row).
// ---------------------------------------------------------------------------
describe('buildShipAbilities — Rhodium end-of-round most-buffs purge (C2b-2 T4)', () => {
    // Rhodium p1 RAW: "At the end of the round, this Unit <unit-aid>purges 2</unit-aid> buffs
    // from the enemy with the most buffs."
    const rhodiumP1 = () =>
        ship({
            firstPassiveSkillText:
                'At the end of the round, this Unit <unit-aid>purges 2</unit-aid> buffs from the enemy with the most buffs.',
        });

    // Rhodium p2 RAW: same purge phrase + "deals <unit-damage>80% damage</unit-damage> that
    // cannot critically hit."
    const rhodiumP2 = () =>
        ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            secondPassiveSkillText:
                'At the end of the round, this Unit <unit-aid>purges 2</unit-aid> buffs from the enemy with the most buffs and deals <unit-damage>80% damage</unit-damage> that cannot critically hit.',
        });

    describe('Rhodium p1: end-of-round purge with target enemy-most-buffs', () => {
        it('emits exactly ONE purge ability with trigger end-of-round, target enemy-most-buffs, count 2', () => {
            const passive = slot(buildShipAbilities(rhodiumP1()).slots, 'passive')!;
            const purges = passive.abilities.filter((a) => a.type === 'purge');
            expect(purges).toHaveLength(1);
            const purge = purges[0];
            expect(purge.trigger).toBe('end-of-round');
            expect(purge.target).toBe('enemy-most-buffs');
            if (purge.config.type === 'purge') {
                expect(purge.config.count).toBe(2);
            }
        });
    });

    describe('Rhodium p2: purge ability present with correct shape (also has 80%-no-crit damage)', () => {
        it('contains a purge with trigger end-of-round, target enemy-most-buffs, count 2', () => {
            const passive = slot(buildShipAbilities(rhodiumP2()).slots, 'passive')!;
            const purges = passive.abilities.filter((a) => a.type === 'purge');
            expect(purges.length).toBeGreaterThanOrEqual(1);
            const purge = purges[0];
            expect(purge.trigger).toBe('end-of-round');
            expect(purge.target).toBe('enemy-most-buffs');
            if (purge.config.type === 'purge') {
                expect(purge.config.count).toBe(2);
            }
        });

        // SP-M M1 (Task 5): the co-located 80%-no-crit DAMAGE clause re-targets from the
        // default 'enemy' to the SAME enemy-most-buffs selector the purge above resolves — it
        // must land on the real most-buffed enemy in positional mode, not the vestigial dummy.
        it('the co-located 80%-no-crit damage ability also carries target enemy-most-buffs', () => {
            const passive = slot(buildShipAbilities(rhodiumP2()).slots, 'passive')!;
            const damages = passive.abilities.filter((a) => a.type === 'damage');
            expect(damages.length).toBeGreaterThanOrEqual(1);
            const dmg = damages[0];
            expect(dmg.trigger).toBe('end-of-round');
            expect(dmg.target).toBe('enemy-most-buffs');
            if (dmg.config.type === 'damage') {
                expect(dmg.config.multiplier).toBe(80);
                expect(dmg.config.noCrit).toBe(true);
            }
        });
    });

    describe('Iridium p1 regression: on-attacked + target:enemy UNCHANGED', () => {
        it('Iridium p1 still emits trigger on-attacked, target enemy (not end-of-round / most-buffs)', () => {
            const iridiumP1 = ship({
                firstPassiveSkillText:
                    'When directly damaged, This Unit <unit-aid>purges 1</unit-aid> buff from the enemy and inflicts <unit-skill>Speed Down I</unit-skill> for 1 turn.',
            });
            const passive = slot(buildShipAbilities(iridiumP1).slots, 'passive')!;
            const purges = passive.abilities.filter((a) => a.type === 'purge');
            expect(purges).toHaveLength(1);
            expect(purges[0].trigger).toBe('on-attacked');
            expect(purges[0].target).toBe('enemy');
            if (purges[0].config.type === 'purge') {
                expect(purges[0].config.count).toBe(1);
            }
        });
    });
});

// ---------------------------------------------------------------------------
// SP-M M1 Task 6: Chakara start-of-round enemy-highest-speed damage re-target build test.
// RAW string from docs/ship-skills.csv (Chakara, third_passive_skill_text).
// ---------------------------------------------------------------------------
describe('buildShipAbilities — Chakara start-of-round highest-speed damage (SP-M M1 Task 6)', () => {
    // Chakara p4 RAW: "This Unit starts each round with Attack Up II and Defense Up II for 1 turn
    // if it has the lowest speed among all Allies. Then, deals 60% damage to the highest Speed
    // Enemy." Default `ship()` helper seeds refits: [{}, {}, {}, {}] (4 refits) → thirdPassiveSkillText
    // (R4, refit-active) is the active passive per getShipSkillRows.
    const chakaraP4 = () =>
        ship({
            thirdPassiveSkillText:
                'This Unit starts each round with <unit-skill>Attack Up II</unit-skill> and <unit-skill>Defense Up II</unit-skill> for 1 turn if it has the lowest speed among all Allies. Then, deals <unit-damage>60% damage</unit-damage> to the highest Speed Enemy.',
        });

    it('the round-boundary damage ability carries trigger start-of-round, target enemy-highest-speed, multiplier 60', () => {
        const passive = slot(buildShipAbilities(chakaraP4()).slots, 'passive')!;
        const damages = passive.abilities.filter((a) => a.type === 'damage');
        expect(damages.length).toBeGreaterThanOrEqual(1);
        const dmg = damages[0];
        expect(dmg.trigger).toBe('start-of-round');
        expect(dmg.target).toBe('enemy-highest-speed');
        if (dmg.config.type === 'damage') {
            expect(dmg.config.multiplier).toBe(60);
        }
    });
});

// ---------------------------------------------------------------------------
// I6: Lodolite charged purge (passive-voice "is Purged of all buffs") + legendary-refit
// shield strip. RAW strings verbatim from docs/ship-skills.csv (Lodolite row).
// ---------------------------------------------------------------------------
describe('buildShipAbilities — Lodolite charged purge + shield strip (I6)', () => {
    const LODOLITE_CHARGED_RAW =
        "This Unit deals <unit-damage>310% damage</unit-damage> and additional damage equal to <unit-damage>10%</unit-damage> of this Unit's max HP. Then, the enemy with the most <unit-aid>Buffs</unit-aid> is Purged of all buffs.<br />This attack can target <unit-aid>Stealthed</unit-aid> enemies.";
    const LODOLITE_R4_PASSIVE_RAW =
        "This Unit ignores <unit-skill>Stealth</unit-skill> effects.<br /><br />This Unit deals <unit-damage>10% more critical damage</unit-damage> to defenders, all allies deal <unit-damage>15% more direct damage</unit-damage> to enemies with <unit-skill>Concentrate Fire</unit-skill> or <unit-skill>Stealth</unit-skill>.<br /><br />When this Unit <unit-aid>Purges a buff</unit-aid> from an enemy, it <unit-damage>removes 100%</unit-damage> of the enemy's shield.";

    // Default `ship()` helper seeds refits: [{}, {}, {}, {}] (4 refits) → thirdPassiveSkillText
    // (R4, legendary refit) is the active passive per getShipSkillRows.
    const lodolite = () =>
        ship({
            chargeSkillText: LODOLITE_CHARGED_RAW,
            chargeSkillCharge: 3,
            thirdPassiveSkillText: LODOLITE_R4_PASSIVE_RAW,
        });

    it('charged skill emits a purge ability: target enemy-most-buffs, count all, trigger on-cast', () => {
        const charged = slot(buildShipAbilities(lodolite()).slots, 'charged')!;
        const purges = charged.abilities.filter((a) => a.type === 'purge');
        expect(purges).toHaveLength(1);
        const purge = purges[0];
        expect(purge.trigger).toBe('on-cast');
        expect(purge.target).toBe('enemy-most-buffs');
        expect(purge.config).toMatchObject({ type: 'purge', count: 'all' });
    });

    it('the charged purge config carries stripsShield (from the R4 legendary passive clause)', () => {
        const charged = slot(buildShipAbilities(lodolite()).slots, 'charged')!;
        const purge = charged.abilities.find((a) => a.type === 'purge')!;
        expect(purge.config).toMatchObject({ stripsShield: true });
    });

    it('the R4 passive itself does NOT ALSO emit a spurious purge ability', () => {
        const passive = slot(buildShipAbilities(lodolite()).slots, 'passive');
        const purges = (passive?.abilities ?? []).filter((a) => a.type === 'purge');
        expect(purges).toHaveLength(0);
    });

    it('WITHOUT the R4 legendary refit (2 refits, R2 passive without the shield clause) the charged purge has NO stripsShield', () => {
        const nonLegendary = ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            chargeSkillText: LODOLITE_CHARGED_RAW,
            chargeSkillCharge: 3,
            secondPassiveSkillText:
                'This Unit ignores <unit-skill>Stealth</unit-skill> effects.<br /><br />This Unit deals <unit-damage>10% more critical damage</unit-damage> to defenders, all allies deal <unit-damage>15% more direct damage</unit-damage> to enemies with <unit-skill>Concentrate Fire</unit-skill>.',
            thirdPassiveSkillText: LODOLITE_R4_PASSIVE_RAW,
        });
        const charged = slot(buildShipAbilities(nonLegendary).slots, 'charged')!;
        const purge = charged.abilities.find((a) => a.type === 'purge')!;
        expect(purge.config).toMatchObject({ type: 'purge', count: 'all' });
        expect((purge.config as { stripsShield?: boolean }).stripsShield).toBeUndefined();
    });

    describe('guard: a passive slot that merely MENTIONS being purged does NOT emit a spurious purge', () => {
        it('a hypothetical "When this Unit is Purged of a buff, it repairs 10% Max HP" passive yields NO purge ability', () => {
            const s = ship({
                firstPassiveSkillText: 'When this Unit is Purged of a buff, it repairs 10% Max HP.',
            });
            const { slots } = buildShipAbilities(s);
            const allAbilities = slots.flatMap((sk) => sk.abilities);
            expect(allAbilities.filter((a) => a.type === 'purge')).toHaveLength(0);
        });
    });
});

// ---------------------------------------------------------------------------
// C2b-2 T6: Faust on-destroyed killed-by-direct-damage purge build tests.
// RAW strings from docs/ship-skills.csv (Faust row, passive 1 & 2).
// ---------------------------------------------------------------------------
describe('buildShipAbilities — Faust on-destroyed killer-targeted purge (C2b-2 T6)', () => {
    // Faust p1 RAW: "This Unit <unit-aid>purges 2</unit-aid> buffs from the enemy when killed by
    // direct Damage."
    const faustP1 = () =>
        ship({
            firstPassiveSkillText:
                'This Unit <unit-aid>purges 2</unit-aid> buffs from the enemy when killed by direct Damage.',
        });

    // Faust p2 RAW (refit-active 2nd passive): purges 3.
    const faustP2 = () =>
        ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            secondPassiveSkillText:
                'This Unit <unit-aid>purges 3</unit-aid> buffs from the enemy when killed by direct Damage.',
        });

    describe('Faust p1: on-destroyed purge with target enemy, count 2', () => {
        it('emits exactly ONE purge ability with trigger on-destroyed, target enemy, count 2', () => {
            const passive = slot(buildShipAbilities(faustP1()).slots, 'passive')!;
            const purges = passive.abilities.filter((a) => a.type === 'purge');
            expect(purges).toHaveLength(1);
            const purge = purges[0];
            expect(purge.trigger).toBe('on-destroyed');
            expect(purge.target).toBe('enemy');
            if (purge.config.type === 'purge') {
                expect(purge.config.count).toBe(2);
            }
        });
    });

    describe('Faust p2: on-destroyed purge, count 3', () => {
        it('emits a purge with trigger on-destroyed, target enemy, count 3', () => {
            const passive = slot(buildShipAbilities(faustP2()).slots, 'passive')!;
            const purges = passive.abilities.filter((a) => a.type === 'purge');
            expect(purges).toHaveLength(1);
            const purge = purges[0];
            expect(purge.trigger).toBe('on-destroyed');
            expect(purge.target).toBe('enemy');
            if (purge.config.type === 'purge') {
                expect(purge.config.count).toBe(3);
            }
        });
    });

    describe('Salvation regression: on-destroyed HEAL still emitted as heal (not purge)', () => {
        it('Salvation p3 still emits an 80% all-allies heal on trigger on-destroyed', () => {
            const salvation = ship({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                refits: [{}, {}] as any,
                secondPassiveSkillText:
                    "When this Unit is destroyed it <unit-damage>repairs 80%</unit-damage> of its max HP to all allies.<br /><br />When a <unit-aid>buff</unit-aid> is <unit-aid>purged</unit-aid> from an ally, this Unit <unit-damage>repairs that ally for 5%</unit-damage> of this Unit's max HP.",
            });
            const passive = slot(buildShipAbilities(salvation).slots, 'passive')!;
            const heal = passive.abilities.find(
                (a) => a.type === 'heal' && a.trigger === 'on-destroyed'
            );
            expect(heal).toBeDefined();
            // No purge ability emitted from Salvation's passives (the "is purged from an ally"
            // phrasing is a heal trigger, not a purge action).
            const purges = passive.abilities.filter((a) => a.type === 'purge');
            expect(purges).toHaveLength(0);
        });
    });
});

// C2b-3: Nayra target-repaired-this-round purge condition build tests.
// ---------------------------------------------------------------------------
describe('buildShipAbilities — Nayra target-repaired-this-round purge (C2b-3)', () => {
    const nayraChargedText =
        'This Unit inflicts <unit-skill>Attack Down II</unit-skill> and <unit-skill>Crit Power Down III</unit-skill> for 2 turns, dealing <unit-damage>210% damage</unit-damage> and additional <unit-damage>damage equal to 30%</unit-damage> of its defense.<br />If the target was repaired this round, inflict <unit-skill>Exposed</unit-skill> for 1 turn and purge all buffs from the enemy.';
    const nayra = () =>
        ship({
            chargeSkillText: nayraChargedText,
            chargeSkillCharge: 4,
        });

    it('emits exactly ONE purge ability from the charged slot with trigger on-cast, count all, and target-repaired-this-round condition', () => {
        const charged = slot(buildShipAbilities(nayra()).slots, 'charged')!;
        const purges = charged.abilities.filter((a) => a.type === 'purge');
        expect(purges).toHaveLength(1);
        const purge = purges[0];
        expect(purge.trigger).toBe('on-cast');
        if (purge.config.type === 'purge') {
            expect(purge.config.count).toBe('all');
        }
        expect(purge.conditions).toEqual([
            { subject: 'target-repaired-this-round', derivable: true },
        ]);
    });
});

// E4: Amartya — crit-power-scaled purge count threaded through the built ability.
describe('buildShipAbilities — E4 Amartya crit-power-scaled purge (countScaling)', () => {
    const amartya = () =>
        ship({
            chargeSkillText:
                'This Unit deals 210% damage and purges 1 buff from all enemies for every 50% crit power this Unit has.',
            chargeSkillCharge: 4,
        });

    it('emits exactly ONE purge ability from the charged slot with countScaling { stat: critDamage, per: 50 }', () => {
        const charged = slot(buildShipAbilities(amartya()).slots, 'charged')!;
        const purges = charged.abilities.filter((a) => a.type === 'purge');
        expect(purges).toHaveLength(1);
        const purge = purges[0];
        expect(purge.trigger).toBe('on-cast');
        expect(purge.target).toBe('all-enemies');
        expect(purge.config).toMatchObject({
            type: 'purge',
            count: 1,
            countScaling: { stat: 'critDamage', per: 50 },
        });
    });
});

// ---------------------------------------------------------------------------
// D-PR3 T5: Iridium "takes N% less damage from Critical hits" parser rule.
// The ability is INERT (no engine consumer yet). Tests confirm the passive slot
// emits exactly one `incoming-reduction` ability with the correct config and
// that no other existing abilities on the slot are disturbed.
// ---------------------------------------------------------------------------
describe('buildShipAbilities — D-PR3 Iridium incoming-reduction parser (T5)', () => {
    // RAW string from docs/ship-skills.csv (Iridium 3rd passive / refit-active 2nd passive).
    const IRIDIUM_P2_RAW =
        'This Unit takes 35% less damage from Critical hits, and this effect does not stack with similar effects.<br /><br />When directly damaged, This Unit <unit-aid>purges 2</unit-aid> buffs from the enemy and inflicts <unit-skill>Speed Down II</unit-skill> for 1 turn.<br /><br />Start of combat, This Unit gains <unit-skill>Taunt</unit-skill> for 1 turn.';

    const iridiumWithCritReduction = () =>
        ship({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any,
            secondPassiveSkillText: IRIDIUM_P2_RAW,
        });

    describe('positive: crit-reduction clause emits incoming-reduction ability', () => {
        it('passive slot contains exactly ONE incoming-reduction ability', () => {
            const passive = slot(buildShipAbilities(iridiumWithCritReduction()).slots, 'passive')!;
            const reductions = passive.abilities.filter((a) => a.type === 'incoming-reduction');
            expect(reductions).toHaveLength(1);
        });

        it('incoming-reduction ability has correct config: scope=direct, condition=incoming-crit, pct=35, critFamily=true', () => {
            const passive = slot(buildShipAbilities(iridiumWithCritReduction()).slots, 'passive')!;
            const reduction = passive.abilities.find((a) => a.type === 'incoming-reduction');
            expect(reduction).toBeDefined();
            expect(reduction!.config).toEqual({
                type: 'incoming-reduction',
                scope: 'direct',
                condition: 'incoming-crit',
                pct: 35,
                critFamily: true,
            });
        });

        it('incoming-reduction ability is self-targeted, trigger on-cast, autoFilled true, conditions empty', () => {
            const passive = slot(buildShipAbilities(iridiumWithCritReduction()).slots, 'passive')!;
            const reduction = passive.abilities.find((a) => a.type === 'incoming-reduction');
            expect(reduction).toBeDefined();
            expect(reduction!.target).toBe('self');
            expect(reduction!.trigger).toBe('on-cast');
            expect(reduction!.autoFilled).toBe(true);
            expect(reduction!.conditions).toEqual([]);
        });

        it('purge ability (on-attacked, count 2) is still emitted alongside the new reduction', () => {
            const passive = slot(buildShipAbilities(iridiumWithCritReduction()).slots, 'passive')!;
            const purges = passive.abilities.filter((a) => a.type === 'purge');
            expect(purges).toHaveLength(1);
            expect(purges[0].trigger).toBe('on-attacked');
            if (purges[0].config.type === 'purge') {
                expect(purges[0].config.count).toBe(2);
            }
        });
    });

    describe('negative: ships without the crit-reduction phrase do NOT emit incoming-reduction', () => {
        it('Iridium p1 (purge-only, no crit-reduction clause) emits zero incoming-reduction abilities', () => {
            const iridiumP1 = ship({
                firstPassiveSkillText:
                    'When directly damaged, This Unit <unit-aid>purges 1</unit-aid> buff from the enemy and inflicts <unit-skill>Speed Down I</unit-skill> for 1 turn.',
            });
            const passive = slot(buildShipAbilities(iridiumP1).slots, 'passive')!;
            expect(passive.abilities.filter((a) => a.type === 'incoming-reduction')).toHaveLength(
                0
            );
        });

        it('a "takes less damage" clause WITHOUT "from Critical hits" does NOT emit incoming-reduction', () => {
            const s = ship({
                firstPassiveSkillText: 'This Unit takes 20% less damage from all sources.',
            });
            const passive = slot(buildShipAbilities(s).slots, 'passive');
            const reductions =
                passive?.abilities.filter((a) => a.type === 'incoming-reduction') ?? [];
            expect(reductions).toHaveLength(0);
        });
    });
});

// D-PR13: 'inflicts Disable for N turns' in active skill text → named Disable DEBUFF (the path that
// performs the actual turn-block via isTurnBlocked recognising any active 'Disable' buff by name,
// so all five corpus ships — APEX, IonScorp, Makoli, Xcellence, Yuyan — light up for free).
// Task 3 update: Disable is now ALSO recognized by parseControlInflicts, so a `type:'control'`
// ability is emitted ADDITIVELY alongside the named debuff (it only sources the control-applied
// event; the named debuff still does the lockout). Both abilities must be present.
describe('buildShipAbilities — D-PR13 Disable active-skill: named debuff + additive control', () => {
    it('active skill "inflicts Disable for 1 turn" produces a named Disable DEBUFF and an additive control ability', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>Disable</unit-skill> for 1 turn.',
        });

        const { slots } = buildShipAbilities(s);
        const active = slot(slots, 'active');
        expect(active).toBeDefined();

        // Must produce a named debuff with buffName === 'Disable'.
        const debuff = active!.abilities.find((a) => a.type === 'debuff');
        expect(debuff).toMatchObject({
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-cast',
            config: {
                type: 'debuff',
                buffName: 'Disable',
                duration: 1,
            },
        });

        // Task 3: ADDITIVELY produces a control ability for Disable (sources control-applied).
        const control = active!.abilities.find((a) => a.type === 'control');
        expect(control).toMatchObject({
            type: 'control',
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'control', effect: 'disable' },
        });
    });
});

// ── Epic PR2: control-twin gating parity ───────────────────────────────────────────────────
// A `type:'control'` ability is emitted ADDITIVELY alongside the named debuff/buff twin that
// actually performs the status (parseControlInflicts is purely additive — see the comment
// above its call site). Before this PR the control twin was ALWAYS constructed on-cast/[],
// ignoring whatever trigger/conditions the named twin resolved to. Fix (buildShipAbilities.ts,
// right before the final per-slot sort): the control twin now inherits the named twin's
// resolved trigger + conditions —
//   - twin trigger 'on-cast' (a static gating condition): the control ability's conditions are
//     overwritten with the twin's conditions (trigger stays 'on-cast', so it is still processed
//     by the cast-path control-applied loop — gateFiringAbilities now honors the gate).
//   - twin trigger is REACTIVE (on-attacked / on-ally-attacked / on-enemy-destroyed / …): the
//     control ability is DROPPED outright. Consumption-side finding: the engine's only
//     `type:'control'` consumer (controlAbilitiesFromSkill, src/utils/abilities/
//     applyAbilities.ts) filters strictly to `trigger === 'on-cast'` — mirroring
//     chargeAbilitiesFromSkill/extraActionsFromSkill, there is no reactive execution path for
//     control abilities. Inheriting a reactive trigger would leave a permanently-unconsumed
//     (dead) ability in the model, so it is not emitted at all; the named debuff/buff twin
//     remains the sole model of the effect.
describe('buildShipAbilities — control-twin gating parity (epic PR2)', () => {
    it('Crocus active: control{stasis} inherits the enemy-debuff-gte-4 condition from its Stasis debuff twin (on-cast twin → condition copy)', () => {
        // docs/ship-skills.csv Crocus active_skill_text (exact clause, routed through the real
        // active slot): "...If the target has more than 3 Debuffs, it inflicts Stasis for 2
        // turns."
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>150% Damage</unit-damage> and inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns.<br />If the target has more than 3 Debuffs, it inflicts <unit-skill>Stasis</unit-skill> for 2 turns.',
        });
        const active = slot(buildShipAbilities(s).slots, 'active');
        const debuff = active?.abilities.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Stasis'
        );
        const control = active?.abilities.find(
            (a) =>
                a.type === 'control' && a.config.type === 'control' && a.config.effect === 'stasis'
        );
        expect(debuff).toBeDefined();
        expect(debuff!.trigger).toBe('on-cast');
        expect(debuff!.conditions).toEqual([
            { subject: 'enemy-debuff', derivable: true, countComparator: 'gte', countThreshold: 4 },
        ]);
        // The control twin must inherit the SAME trigger + conditions as its debuff twin.
        expect(control).toBeDefined();
        expect(control!.trigger).toBe(debuff!.trigger);
        expect(control!.conditions).toEqual(debuff!.conditions);
    });

    it('Nayra active: control{stasis} inherits the target-repaired-this-round condition from its Stasis debuff twin (on-cast twin → condition copy)', () => {
        // docs/ship-skills.csv Nayra active_skill_text (exact clause, routed through the real
        // active slot): "...If the target was repaired this round, inflict Stasis for 1 turn."
        const s = ship({
            activeSkillText:
                'This Unit inflicts <unit-skill>Defense Down II</unit-skill> and <unit-skill>Crit Rate Down III</unit-skill> for 2 turns, dealing <unit-damage>170% damage</unit-damage> and additional <unit-damage>damage equal to 30%</unit-damage> of its Defense.<br />If the target was repaired this round, inflict <unit-skill>Stasis</unit-skill> for 1 turn.',
        });
        const active = slot(buildShipAbilities(s).slots, 'active');
        const debuff = active?.abilities.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Stasis'
        );
        const control = active?.abilities.find(
            (a) =>
                a.type === 'control' && a.config.type === 'control' && a.config.effect === 'stasis'
        );
        expect(debuff).toBeDefined();
        expect(debuff!.trigger).toBe('on-cast');
        expect(debuff!.conditions).toEqual([
            { subject: 'target-repaired-this-round', derivable: true },
        ]);
        expect(control).toBeDefined();
        expect(control!.trigger).toBe(debuff!.trigger);
        expect(control!.conditions).toEqual(debuff!.conditions);
    });

    it('Makoli second passive: control{disable} is DROPPED — its Disable debuff twin resolves to a REACTIVE trigger (on-attacked + below-40%-HP), which the cast-path control-applied loop can never consume', () => {
        // docs/ship-skills.csv Makoli second_passive_skill_text (exact clause, routed through
        // the real passive slot via refits.length >= 2): "When directly damaged while below 40%
        // HP, this Unit repairs 20% of its Max HP and inflicts Disable for 1 turn."
        const s = ship({
            refits: [{}, {}] as Ship['refits'],
            secondPassiveSkillText:
                'When directly damaged while below 40% HP, this Unit <unit-damage>repairs 20%</unit-damage> of its Max HP and inflicts <unit-skill>Disable</unit-skill> for 1 turn.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive');
        const debuff = passive?.abilities.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Disable'
        );
        expect(debuff).toBeDefined();
        expect(debuff!.trigger).toBe('on-attacked');
        expect(debuff!.conditions).toEqual([
            {
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: 'below',
                hpPercent: 40,
                hpSubject: 'self',
            },
        ]);
        const control = passive?.abilities.find(
            (a) =>
                a.type === 'control' && a.config.type === 'control' && a.config.effect === 'disable'
        );
        expect(control).toBeUndefined();
    });

    it('Flamel second passive: control{stasis} is DROPPED — its Stasis debuff twin resolves to the REACTIVE on-attacked trigger', () => {
        // docs/ship-skills.csv Flamel second_passive_skill_text (exact clause, routed through
        // the real passive slot via refits.length >= 2): "When directly damaged, this Unit
        // inflicts Speed Down I for 2 turns and Stasis for 2 turn."
        const s = ship({
            refits: [{}, {}] as Ship['refits'],
            secondPassiveSkillText:
                'When directly damaged, this Unit inflicts <unit-skill>Speed Down I</unit-skill> for 2 turns and <unit-skill>Stasis</unit-skill> for 2 turn.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive');
        const debuff = passive?.abilities.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Stasis'
        );
        expect(debuff).toBeDefined();
        expect(debuff!.trigger).toBe('on-attacked');
        const control = passive?.abilities.find(
            (a) =>
                a.type === 'control' && a.config.type === 'control' && a.config.effect === 'stasis'
        );
        expect(control).toBeUndefined();
    });

    it('Guardian second passive: control{provoke} is DROPPED — its Provoke debuff twin resolves to the REACTIVE on-ally-attacked trigger', () => {
        // docs/ship-skills.csv Guardian second_passive_skill_text (exact clause, routed through
        // the real passive slot via refits.length >= 2): "...When an ally is critically hit by
        // an enemy, apply Provoke for 1 turn to that enemy."
        const s = ship({
            refits: [{}, {}] as Ship['refits'],
            secondPassiveSkillText:
                'This Unit has 20% shield penetration. When this Unit is critically hit, it gains <unit-skill>Binderburg Resilience I</unit-skill> for 1 turn.<br /><br />When an ally is critically hit by an enemy, apply <unit-skill>Provoke</unit-skill> for 1 turn to that enemy.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive');
        const debuff = passive?.abilities.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Provoke'
        );
        expect(debuff).toBeDefined();
        expect(debuff!.trigger).toBe('on-ally-attacked');
        const control = passive?.abilities.find(
            (a) =>
                a.type === 'control' && a.config.type === 'control' && a.config.effect === 'provoke'
        );
        expect(control).toBeUndefined();
    });

    it('Meiying first passive: control{stasis} is DROPPED — its Stasis debuff twin resolves to the REACTIVE on-enemy-destroyed trigger', () => {
        // docs/ship-skills.csv Meiying first_passive_skill_text (exact clause, routed through
        // the real passive slot): "Upon killing an enemy with a Debuff, this Unit inflicts
        // Stasis on all adjacent enemies for 1 turn."
        const s = ship({
            firstPassiveSkillText:
                'Upon killing an enemy with a Debuff, this Unit inflicts <unit-skill>Stasis</unit-skill> on all adjacent enemies for 1 turn.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive');
        const debuff = passive?.abilities.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Stasis'
        );
        expect(debuff).toBeDefined();
        expect(debuff!.trigger).toBe('on-enemy-destroyed');
        const control = passive?.abilities.find(
            (a) =>
                a.type === 'control' && a.config.type === 'control' && a.config.effect === 'stasis'
        );
        expect(control).toBeUndefined();
    });

    // Negative companion: a genuinely on-cast, UNCONDITIONAL control skill must stay ungated —
    // the inheritance logic must not spuriously attach conditions/drop the ability when the
    // named twin itself has no gate.
    it('negative: a plain "applies Provoke" active skill keeps its control{provoke} on-cast with EMPTY conditions (no twin gate to inherit)', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>145% damage</unit-damage> and applies <unit-skill>Provoke</unit-skill> for 1 turn.',
        });
        const active = slot(buildShipAbilities(s).slots, 'active');
        const debuff = active?.abilities.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Provoke'
        );
        const control = active?.abilities.find(
            (a) =>
                a.type === 'control' && a.config.type === 'control' && a.config.effect === 'provoke'
        );
        expect(debuff).toBeDefined();
        expect(debuff!.trigger).toBe('on-cast');
        expect(debuff!.conditions).toEqual([]);
        expect(control).toBeDefined();
        expect(control!.trigger).toBe('on-cast');
        expect(control!.conditions).toEqual([]);
    });
});

// ── Phase 1 Task 3: enemy-target charge-removal abilities ─────────────────────────────────
// parseChargeRemoval (Task 2) is already wired into skillTextParser.ts. This block verifies
// that buildShipAbilities orchestrates it and emits target:'enemy' charge abilities.

describe('buildShipAbilities — enemy-targeted charge removal (Phase 1 Task 3)', () => {
    it('Opal charged: on-cast removal of 2 charges from the enemy', () => {
        // Opal's real charge skill text (from docs/ship-skills.csv).
        const s = ship({
            chargeSkillText:
                'This Unit deals 70% damage with an additional damage equal to 11% of its Max HP, and removes 2 charges from the enemy.',
            chargeSkillCharge: 3,
        });

        const { slots } = buildShipAbilities(s);
        const charged = slot(slots, 'charged')!;
        expect(charged).toBeDefined();

        expect(charged.abilities).toContainEqual(
            expect.objectContaining({
                type: 'charge',
                target: 'enemy',
                trigger: 'on-cast',
                config: { type: 'charge', amount: 2 },
            })
        );
    });

    it('Demolisher passive: bomb-detonation removal of 2 charges from the enemy', () => {
        // Demolisher's real passive text (from docs/ship-skills.csv).
        const s = ship({
            firstPassiveSkillText:
                "When a bomb explodes on an enemy, this unit removes 2 charges from the enemy's charged skill.",
        });

        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive')!;
        expect(passive).toBeDefined();

        expect(passive.abilities).toContainEqual(
            expect.objectContaining({
                type: 'charge',
                target: 'enemy',
                trigger: 'on-bomb-detonated',
                config: { type: 'charge', amount: 2 },
            })
        );
    });

    it('Zosimos passive: BOTH self gain (on-enemy-repaired) AND enemy removal (every 2nd repair)', () => {
        // Zosimos's real passive text includes both a self charge gain and an enemy charge removal.
        const s = ship({
            firstPassiveSkillText:
                "When an enemy repairs, this unit gains a charge to its charged skill. Additionally, this unit decreases that enemy's charge by one for every second repair they perform.",
        });

        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive')!;
        expect(passive).toBeDefined();

        const chargeAbilities = passive.abilities.filter((a) => a.type === 'charge');
        // Must emit BOTH a self gain and an enemy removal.
        expect(chargeAbilities).toEqual(
            expect.arrayContaining([
                // self gain on-enemy-repaired (existing parseChargeGain path)
                expect.objectContaining({
                    target: 'self',
                    trigger: 'on-enemy-repaired',
                }),
                // enemy removal on-enemy-repaired every 2nd repair (new parseChargeRemoval path)
                expect.objectContaining({
                    target: 'enemy',
                    trigger: 'on-enemy-repaired',
                    everyNthEvent: 2,
                    config: { type: 'charge', amount: 1 },
                }),
            ])
        );
    });

    it('Provider charged: removal of 1 charge from the enemy on-cast (previously ignored)', () => {
        // Provider's charge skill text already existed in the test at line ~161 with a comment
        // saying "charge removal is ignored". Now that the orchestrator wires parseChargeRemoval,
        // the removal MUST be emitted. The existing test still passes (it only asserts damage +
        // extend-dot exist); this complementary test locks the removal contract.
        const s = ship({
            chargeSkillText:
                'This Unit deals <unit-damage>200% damage</unit-damage>, removes 1 charge from the enemy, and extends active Damage Over Time effects by 1 turn.',
            chargeSkillCharge: 3,
        });

        const { slots } = buildShipAbilities(s);
        const charged = slot(slots, 'charged')!;

        expect(charged.abilities).toContainEqual(
            expect.objectContaining({
                type: 'charge',
                target: 'enemy',
                trigger: 'on-cast',
                config: { type: 'charge', amount: 1 },
            })
        );
    });

    it('does not emit a removal ability for a pure charge-gain ship', () => {
        // Negative test: a ship whose only charge-related text is a self gain must not produce
        // any enemy-targeted charge ability.
        const s = ship({
            firstPassiveSkillText: 'This Unit adds 1 charge to its Charged Skill.',
        });

        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive')!;
        const enemyCharges = (passive?.abilities ?? []).filter(
            (a) => a.type === 'charge' && a.target === 'enemy'
        );
        expect(enemyCharges).toHaveLength(0);
    });

    // Epic PR3 (charge sign/target): Thresh's active text gates BOTH halves of "If the target
    // is a Defender, this Unit removes 1 charge from the enemy and adds 1 charge to this Unit's
    // Charged Skill" behind the same Defender check. The self-gain half already carried the gate
    // (parseChargeGain/classifyChargeCondition) — verified as a pre-existing FALSE POSITIVE for
    // that half of the sweep finding. The enemy-removal half did NOT (buildShipAbilities hardcoded
    // `conditions: []` for every removal ability) — this is the real, in-scope bug: the shared gate
    // must propagate to both abilities emitted from the sentence.
    it('Thresh active: BOTH the self-gain AND the enemy-removal charge abilities carry the shared Defender gate', () => {
        const s = ship({
            activeSkillText:
                "This Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn and deals <unit-damage>240% damage</unit-damage>. If the target is a Defender, this Unit <unit-aid>removes 1 charge</unit-aid> from the enemy and <unit-aid>adds 1 charge</unit-aid> to this Unit's Charged Skill.",
        });

        const { slots } = buildShipAbilities(s);
        const active = slot(slots, 'active')!;
        const chargeAbilities = active.abilities.filter((a) => a.type === 'charge');
        expect(chargeAbilities).toHaveLength(2);

        const defenderGate = expect.objectContaining({
            subject: 'enemy-type',
            requiredEnemyType: 'Defender',
        });

        const selfGain = chargeAbilities.find((a) => a.target === 'self')!;
        expect(selfGain).toBeDefined();
        expect(selfGain.conditions).toContainEqual(defenderGate);

        const enemyRemoval = chargeAbilities.find((a) => a.target === 'enemy')!;
        expect(enemyRemoval).toBeDefined();
        expect(enemyRemoval.conditions).toContainEqual(defenderGate);
        expect(enemyRemoval).toMatchObject({
            type: 'charge',
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'charge', amount: 1 },
        });
    });

    // Overload lose-on-kill: the 5 Marauder ships must emit a `remove-self-buff` ability
    // for Overload. Marauder Rage grants ride the existing buff-merge path (Task 4's
    // detectReactiveTrigger) — verified here, not separately wired.
    describe('Overload lose-on-kill (remove-self-buff)', () => {
        const removeSelfBuff = (abilities: Ability[]) =>
            abilities.find((a) => a.type === 'remove-self-buff');

        it('Mangler p2: remove Overload on kill + Marauder Rage II on kill', () => {
            const s = ship({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                refits: [{}, {}] as any,
                secondPassiveSkillText:
                    'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and loses <unit-skill>Overload</unit-skill> on kill. Additionally, it gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns upon killing an opponent.',
            });
            const abilities = slot(buildShipAbilities(s).slots, 'passive')!.abilities;

            const rem = removeSelfBuff(abilities)!;
            expect(rem.target).toBe('self');
            expect(rem.trigger).toBe('on-enemy-destroyed');
            expect(rem.config).toEqual({
                type: 'remove-self-buff',
                buffName: 'Overload',
                scope: 'all',
            });

            const rage = abilities.find(
                (a) =>
                    a.type === 'buff' &&
                    (a.config as { buffName?: string }).buffName === 'Marauder Rage II'
            )!;
            expect(rage).toBeDefined();
            expect(rage.trigger).toBe('on-enemy-destroyed');
        });

        it('Ravager p1: remove Overload on kill + Marauder Rage III on kill', () => {
            const s = ship({
                firstPassiveSkillText:
                    'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon killing an enemy, loses <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage III</unit-skill> for 3 turns.',
                refits: [],
            });
            const abilities = slot(buildShipAbilities(s).slots, 'passive')!.abilities;

            const rem = removeSelfBuff(abilities)!;
            expect(rem.target).toBe('self');
            expect(rem.trigger).toBe('on-enemy-destroyed');
            expect(rem.config).toEqual({
                type: 'remove-self-buff',
                buffName: 'Overload',
                scope: 'all',
            });

            const rage = abilities.find(
                (a) =>
                    a.type === 'buff' &&
                    (a.config as { buffName?: string }).buffName === 'Marauder Rage III'
            )!;
            expect(rage).toBeDefined();
            expect(rage.trigger).toBe('on-enemy-destroyed');
        });

        it('Butcher p2: remove Overload on kill + Marauder Rage II on debuff-inflicted', () => {
            const s = ship({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                refits: [{}, {}] as any,
                secondPassiveSkillText:
                    'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn. On kill, <unit-skill>Overload</unit-skill> is lost. On inflicting a debuff, this Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns.',
            });
            const abilities = slot(buildShipAbilities(s).slots, 'passive')!.abilities;

            const rem = removeSelfBuff(abilities)!;
            expect(rem.target).toBe('self');
            expect(rem.trigger).toBe('on-enemy-destroyed');
            expect(rem.config).toEqual({
                type: 'remove-self-buff',
                buffName: 'Overload',
                scope: 'all',
            });

            const rage = abilities.find(
                (a) =>
                    a.type === 'buff' &&
                    (a.config as { buffName?: string }).buffName === 'Marauder Rage II'
            )!;
            expect(rage).toBeDefined();
            expect(rage.trigger).toBe('on-debuff-inflicted');
        });

        it('Asphyxiator p1: remove Overload on kill (SoR grant verified e2e)', () => {
            const s = ship({
                firstPassiveSkillText:
                    'At the start of the round, if there are any enemies with 3 or more debuffs, this Unit gains 1 stack of <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns. Upon killing an enemy, this Unit loses <unit-skill>Overload</unit-skill>.',
                refits: [],
            });
            const abilities = slot(buildShipAbilities(s).slots, 'passive')!.abilities;

            const rem = removeSelfBuff(abilities)!;
            expect(rem.target).toBe('self');
            expect(rem.trigger).toBe('on-enemy-destroyed');
            expect(rem.config).toEqual({
                type: 'remove-self-buff',
                buffName: 'Overload',
                scope: 'all',
            });

            // Grant branch: the start-of-round conditional grants Marauder Rage II — assert it is
            // parsed onto the start-of-round trigger (locks the grant branch against a parser
            // regression, complementing the removal assertion above).
            const rage = abilities.find(
                (a) =>
                    a.type === 'buff' &&
                    (a.config as { buffName?: string }).buffName === 'Marauder Rage II'
            )!;
            expect(rage).toBeDefined();
            expect(rage.trigger).toBe('start-of-round');
        });

        it('Ruiner p2: remove Overload on kill + Overload gain on-enemy-repaired', () => {
            const s = ship({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                refits: [{}, {}] as any,
                secondPassiveSkillText:
                    'This Unit inflicts <unit-skill>Bomb II</unit-skill> for 2 turns on any enemy performing a <unit-aid>repair</unit-aid>, once per round per enemy.<br /><br />This Unit gains 1 stack of <unit-skill>Overload</unit-skill> when an enemy performs a <unit-aid>repair</unit-aid>, upon killing an enemy, this Unit removes <unit-skill>Overload</unit-skill>.',
            });
            const abilities = slot(buildShipAbilities(s).slots, 'passive')!.abilities;

            const rem = removeSelfBuff(abilities)!;
            expect(rem.target).toBe('self');
            expect(rem.trigger).toBe('on-enemy-destroyed');
            expect(rem.config).toEqual({
                type: 'remove-self-buff',
                buffName: 'Overload',
                scope: 'all',
            });

            const overloadGain = abilities.find(
                (a) =>
                    a.type === 'buff' && (a.config as { buffName?: string }).buffName === 'Overload'
            )!;
            expect(overloadGain).toBeDefined();
            expect(overloadGain.trigger).toBe('on-enemy-repaired');
        });
    });
});

// Epic PR1 (skill-model gap, finding family 1): damage-reduction / shield-scaled-off-damage
// clauses were being minted as phantom on-cast attacks because parseSkillDamage's "does this
// tag mention 'damage'?" heuristic can't distinguish an outgoing hit from an incoming-reduction
// or shield-scaling clause. All texts below are exact CSV clauses (docs/ship-skills.csv),
// assigned to their REAL slot fields (matching how buildShipAbilities is actually invoked in
// production via getShipSkillRows) — not the audit script's "treat every slot as active"
// simplification.
describe('buildShipAbilities — PR1 phantom-ability suppression (reduction/conversion clauses)', () => {
    it('Tormenter passive2 (R2): no phantom damage ability from "30% damage reduction"', () => {
        const s = ship({
            refits: [{}, {}] as never,
            firstPassiveSkillText: 'This Unit always lands critical hits.',
            secondPassiveSkillText:
                'This Unit always lands critical hits and gains up to <unit-damage>30% damage</unit-damage> reduction as its health decreases.',
        });
        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive');
        expect(passive?.abilities.some((a) => a.type === 'damage') ?? false).toBe(false);
    });

    it('Tormenter active still parses its real 160% base damage (negative companion)', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>160% damage</unit-damage> with a guaranteed critical hit and grants <unit-skill>Out. Damage Up I</unit-skill> to itself and all adjacent allies for 1 turn.',
        });
        const { slots } = buildShipAbilities(s);
        const active = slot(slots, 'active')!;
        expect(abilityOfType(active.abilities, 'damage')).toMatchObject({
            config: { type: 'damage', multiplier: 160 },
        });
    });

    it('Voron passive2 (R2): no phantom damage ability from "takes 20% less damage from DoTs"', () => {
        const s = ship({
            refits: [{}, {}] as never,
            firstPassiveSkillText:
                'When directly damaged, this Unit transforms the damage into a <unit-skill>Damage over Time effect</unit-skill> effect lasting for 3 turns.',
            secondPassiveSkillText:
                'When directly damaged, this Unit transforms the damage into a <unit-skill>Damage over Time effect</unit-skill> lasting for 3 turns.<br /><br />This Unit takes <unit-damage>20% less damage</unit-damage> from <unit-skill>Damage over Time effects</unit-skill>.',
        });
        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive');
        expect(passive?.abilities.some((a) => a.type === 'damage') ?? false).toBe(false);
    });

    it('Malvex passive2 (R2): no phantom damage ability from "takes 10% less damage"', () => {
        const s = ship({
            refits: [{}, {}] as never,
            firstPassiveSkillText:
                'When directly damaged as a primary target, this Unit gains <unit-damage>Shield equal to 15%</unit-damage> of the Damage dealt to them.',
            secondPassiveSkillText:
                'When Shielded, this Ship takes <unit-damage>10% less damage</unit-damage>. When directly damaged as a primary target, this Unit gains <unit-damage>Shield equal to 15%</unit-damage> of the Damage dealt to them.',
        });
        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive');
        expect(passive?.abilities.some((a) => a.type === 'damage') ?? false).toBe(false);
        // The (separately-tracked, out-of-scope) on-attacked shield-gain clause is untouched.
        expect(passive?.abilities.some((a) => a.type === 'shield')).toBe(true);
    });

    it('FrontLine passive2 (R2): phantom on-cast damage(30) from the shield clause is gone, real on-enemy-charged-cast damage(80) survives', () => {
        const s = ship({
            refits: [{}, {}] as never,
            firstPassiveSkillText:
                'This ship has 20% Shield Penetration.<br />While Shielded, it gains 2500 additional Defense.<br />This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.',
            secondPassiveSkillText:
                'This ship has 20% Shield Penetration.<br />While Shielded, it gains 2500 additional Defense.<br />This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.<br /><br />When an enemy uses their Charged skill, it deals <unit-damage>80%</unit-damage> and gains a Shield equal to <unit-damage>30%</unit-damage> of the damage dealt, once per round.',
        });
        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive')!;
        const damageAbilities = passive.abilities.filter((a) => a.type === 'damage');
        // Exactly one damage ability — the real on-enemy-charged-cast reactive hit — no phantom
        // on-cast multiplier-30 sibling.
        expect(damageAbilities).toHaveLength(1);
        expect(damageAbilities[0]).toMatchObject({
            trigger: 'on-enemy-charged-cast',
            config: { type: 'damage', multiplier: 80 },
        });
        expect(damageAbilities.some((a) => a.trigger === 'on-cast')).toBe(false);
    });
});

// Epic PR1 (skill-model gap, finding family 2): the sweep report's "trigger-phrase DoT
// re-application" claim for Wisteria/Valerian/Lingshe/Belladonna was reproduced by the sweep's
// OWN methodology (docs/skill-model-gap-sweep-2026-07-03.md: "each slot parsed in isolation as
// the active slot"), which routes passive text through buildDoTAutoFill's active/charge-only DoT
// auto-fill. Under REAL usage — text assigned to its correct slot field, exactly how
// buildShipAbilities is invoked via getShipSkillRows in production — buildDoTAutoFill never sees
// passive text, so the phantom DoT does not reproduce for any of the four ships. These tests were
// RED-checked (asserted the phantom absent) BEFORE any parser change and already passed —
// confirmed FALSE POSITIVE; no parser change was made for this family. Kept as regression guards.
describe('buildShipAbilities — PR1 finding family 2 (confirmed FALSE POSITIVE under real usage)', () => {
    it('Wisteria passive1 (R0): no phantom Corrosion dot from the "after applying Corrosion" trigger phrase', () => {
        const s = ship({
            refits: [] as never,
            firstPassiveSkillText:
                'This Unit, after applying <unit-skill>Corrosion</unit-skill> with a Critical hit, inflicts <unit-skill>Inferno II</unit-skill> for 2 turns.',
        });
        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive');
        expect(passive?.abilities.some((a) => a.type === 'dot') ?? false).toBe(false);
    });

    it('Valerian passive2 (R2): no phantom Corrosion dot from "After inflicting Corrosion with a Critical hit"', () => {
        const s = ship({
            refits: [{}, {}] as never,
            firstPassiveSkillText:
                'This Unit <unit-damage>repairs 15%</unit-damage> of Damage dealt to the enemy, including inflcted Damage over Time effects.',
            secondPassiveSkillText:
                'This Unit <unit-damage>repairs 15%</unit-damage> of damage dealt to an enemy, including damage from damage over time effects. After inflicting <unit-skill>Corrosion</unit-skill> with a Critical hit, the duration of the newly applied <unit-skill>Corrosion</unit-skill> is extended by 1 turn, with the extension chance equal to the Critical Power.',
        });
        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive')!;
        expect(passive.abilities.some((a) => a.type === 'dot')).toBe(false);
        // The real extend-dot ability (self-crit gated) is still there, unaffected.
        expect(passive.abilities.some((a) => a.type === 'extend-dot')).toBe(true);
    });

    it('Lingshe passive1 (R0): no phantom Bomb dot from "When this Unit inflicts a Bomb"', () => {
        const s = ship({
            refits: [] as never,
            firstPassiveSkillText:
                'When this Unit inflicts a <unit-skill>Bomb</unit-skill> it gains <unit-skill>Stealth</unit-skill> for 1 turn.',
        });
        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive');
        expect(passive?.abilities.some((a) => a.type === 'dot') ?? false).toBe(false);
    });

    it('Belladonna passive1 (R0): no phantom Corrosion dot from "When an ally inflicts Corrosion"', () => {
        const s = ship({
            refits: [] as never,
            firstPassiveSkillText:
                'When an ally inflicts <unit-skill>Corrosion</unit-skill>, this Unit has a chance to convert the <unit-skill>Corrosion</unit-skill> into <unit-skill>Acidic Decay</unit-skill> of the same level, with the chance scaling at 1% per 10 Hacking.',
        });
        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive');
        expect(passive?.abilities.some((a) => a.type === 'dot') ?? false).toBe(false);
    });
});

// Epic PR1 (skill-model gap, finding family 3): Amartya's "When an enemy defender gains Taunt,
// this Unit inflicts N stacks of Exposed" minted a phantom self Taunt grant (the trigger clause's
// buff misread as a self-application) and force-collapsed the explicit "2 stacks" count to 1.
describe('buildShipAbilities — PR1 Amartya phantom Taunt + Exposed stack count', () => {
    it('passive2 (R2): no self Taunt buff ability; Exposed debuff carries 1 stack', () => {
        const s = ship({
            refits: [{}, {}] as never,
            firstPassiveSkillText:
                'When an enemy defender is directly repaired, this Unit inflicts 1 stack of <unit-skill>Defense Shred</unit-skill> on that defender.',
            secondPassiveSkillText:
                'When an enemy defender is directly repaired, this Unit inflicts 1 stack of <unit-skill>Defense Shred</unit-skill> on that defender.<br /><br />When an enemy defender gains <unit-skill>Taunt</unit-skill>, this Unit inflicts 1 stacks of <unit-skill>Exposed</unit-skill> on that defender.',
        });
        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive')!;
        const taunt = passive.abilities.find(
            (a) => a.type === 'buff' && (a.config as { buffName?: string }).buffName === 'Taunt'
        );
        expect(taunt).toBeUndefined();
        const exposed = passive.abilities.find(
            (a) => a.type === 'debuff' && (a.config as { buffName?: string }).buffName === 'Exposed'
        );
        expect(exposed).toBeDefined();
        expect((exposed!.config as { stacks?: number }).stacks).toBe(1);
    });

    it('passive3 (R4): Exposed debuff carries the explicit 2-stack count', () => {
        const s = ship({
            refits: [{}, {}, {}, {}] as never,
            firstPassiveSkillText:
                'When an enemy defender is directly repaired, this Unit inflicts 1 stack of <unit-skill>Defense Shred</unit-skill> on that defender.',
            secondPassiveSkillText:
                'When an enemy defender is directly repaired, this Unit inflicts 1 stack of <unit-skill>Defense Shred</unit-skill> on that defender.<br /><br />When an enemy defender gains <unit-skill>Taunt</unit-skill>, this Unit inflicts 1 stacks of <unit-skill>Exposed</unit-skill> on that defender.',
            thirdPassiveSkillText:
                'When an enemy defender is directly repaired, this Unit inflicts 2 stack of <unit-skill>Defense Shred</unit-skill> on that defender.<br /><br />When an enemy defender gains <unit-skill>Taunt</unit-skill>, this Unit inflicts 2 stacks of <unit-skill>Exposed</unit-skill> on that defender.',
        });
        const { slots } = buildShipAbilities(s);
        const passive = slot(slots, 'passive')!;
        const taunt = passive.abilities.find(
            (a) => a.type === 'buff' && (a.config as { buffName?: string }).buffName === 'Taunt'
        );
        expect(taunt).toBeUndefined();
        const exposed = passive.abilities.find(
            (a) => a.type === 'debuff' && (a.config as { buffName?: string }).buffName === 'Exposed'
        );
        expect(exposed).toBeDefined();
        expect((exposed!.config as { stacks?: number }).stacks).toBe(2);
    });
});

// ── PR5 Finding 1: Panon self-Provoke/Taunt condition subject ─────────────────────────────
// docs/ship-skills.csv Panon active_skill_text (exact clause, routed through the real active
// slot): "...If this Unit is Provoked or Taunted, this Unit instead gains Terran Guard III for
// 2 turns and deals 120% damage..." — the condition checks a status on THIS Unit (self), not the
// enemy. Taunt is a self-buff per constants/buffs.ts ("Forces enemies to target this unit"), so
// "this Unit is ... Taunted" must resolve as a self-buff gate, not an enemy-buff gate.
describe('buildShipAbilities — PR5 Finding 1 Panon self-Provoke/Taunt condition subject', () => {
    it('Panon active: "If this Unit is Provoked or Taunted" gates Terran Guard III with self-subject conditions (both self-debuff Provoke and self-buff Taunt)', () => {
        const s = ship({
            activeSkillText:
                'This Unit grants all allies <unit-skill>Terran Guard II</unit-skill> for 2 turns and deals <unit-damage>80% damage</unit-damage> with an additional Damage equal to <unit-damage>70%</unit-damage> of its Defense.<br /><br />If this Unit is Provoked or Taunted, this Unit instead gains <unit-skill>Terran Guard III</unit-skill> for 2 turns and deals <unit-damage>120% damage</unit-damage> with an additional Damage equal to <unit-damage>90%</unit-damage> of its Defense.',
        });
        const active = slot(buildShipAbilities(s).slots, 'active');
        const buff = active!.abilities.find(
            (a) =>
                a.type === 'buff' &&
                a.config.type === 'buff' &&
                a.config.buffName === 'Terran Guard III'
        );
        expect(buff).toBeDefined();
        expect(buff!.conditions).toEqual([
            { subject: 'self-buff', buffName: 'Taunt', derivable: true, anyOf: true },
            { subject: 'self-debuff', buffName: 'Provoke', derivable: true, anyOf: true },
        ]);
    });

    it('Panon charged: "If this Unit is affected by Provoke or Taunt" gates the Barrier grant + damage modifier with self-subject conditions', () => {
        // docs/ship-skills.csv Panon charge_skill_text (exact clause): "...If this Unit is
        // affected by Provoke or Taunt, it instead gains Barrier for 1 hit and deals 170%
        // damage..."
        const s = ship({
            activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
            chargeSkillCharge: 3,
            chargeSkillText:
                'This Unit deals <unit-damage>140% damage</unit-damage> plus an additional <unit-damage>100%</unit-damage> of its Defense.<br /><br />If this Unit is affected by <unit-skill>Provoke</unit-skill> or <unit-skill>Taunt</unit-skill>, it instead gains <unit-skill>Barrier</unit-skill> for 1 hit and deals <unit-damage>170% damage</unit-damage> with an additional Damage equal to <unit-damage>130%</unit-damage> of its Defense.',
        });
        const charged = slot(buildShipAbilities(s).slots, 'charged');
        const buff = charged!.abilities.find(
            (a) => a.type === 'buff' && a.config.type === 'buff' && a.config.buffName === 'Barrier'
        );
        expect(buff).toBeDefined();
        expect(buff!.conditions).toEqual([
            { subject: 'self-buff', buffName: 'Taunt', derivable: true, anyOf: true },
            { subject: 'self-debuff', buffName: 'Provoke', derivable: true, anyOf: true },
        ]);
    });
});

// ── PR5 Finding 2: duration misattachment across multi-buff sentences ─────────────────────
describe('buildShipAbilities — PR5 Finding 2 duration misattachment across multi-buff sentences', () => {
    it('Bayah first passive: "gains Terran Bolster II and inflicts Speed Down II on an enemy for 2 turns" — the trailing duration reaches BOTH buffs', () => {
        // docs/ship-skills.csv Bayah first_passive_skill_text (exact clause, routed through the
        // real passive slot).
        const s = ship({
            refits: [{}] as Ship['refits'],
            firstPassiveSkillText:
                'This Unit gains <unit-skill>Terran Bolster II</unit-skill> and inflicts <unit-skill>Speed Down II</unit-skill> on an enemy for 2 turns after dealing damage to an enemy with 2 or more debuffs.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const bolster = passive.abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Terran Bolster II'
        )!;
        expect(bolster).toBeDefined();
        expect(bolster.config).toMatchObject({ duration: 2 });
        const speedDown = passive.abilities.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Speed Down II'
        )!;
        expect(speedDown).toBeDefined();
        expect(speedDown.config).toMatchObject({ duration: 2 });
    });

    it('Bayah second passive: same shape with an added third buff (Out. Damage Down II) — all three share the trailing 2-turn duration', () => {
        // docs/ship-skills.csv Bayah second_passive_skill_text (exact clause, routed through the
        // real passive slot via refits.length >= 2).
        const s = ship({
            refits: [{}, {}] as Ship['refits'],
            secondPassiveSkillText:
                'This Unit gains <unit-skill>Terran Bolster II</unit-skill> and inflicts <unit-skill>Speed Down II</unit-skill> and <unit-skill>Out. Damage Down II</unit-skill> on an enemy for 2 turns after dealing damage to an enemy with 2 or more debuffs.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const bolster = passive.abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Terran Bolster II'
        )!;
        expect(bolster.config).toMatchObject({ duration: 2 });
        const speedDown = passive.abilities.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Speed Down II'
        )!;
        expect(speedDown.config).toMatchObject({ duration: 2 });
        const dmgDown = passive.abilities.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Out. Damage Down II'
        )!;
        expect(dmgDown.config).toMatchObject({ duration: 2 });
    });

    it('Oleander charged: "grants Repair Over Time II for 2 turns and, for 3 turns, grants both Out. DoT Damage Up II and Hit Mitigation" — the LEADING "for 3 turns" reaches both trailing buffs', () => {
        // docs/ship-skills.csv Oleander charge_skill_text (exact clause, routed through the real
        // charged slot).
        const s = ship({
            activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
            chargeSkillCharge: 6,
            chargeSkillText:
                'This Unit grants <unit-skill>Repair Over Time II</unit-skill> for 2 turns and, for 3 turns, grants both <unit-skill>Out. DoT Damage Up II</unit-skill> and <unit-skill>Hit Mitigation</unit-skill>.',
        });
        const charged = slot(buildShipAbilities(s).slots, 'charged')!;
        const rot = charged.abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Repair Over Time II'
        )!;
        expect(rot.config).toMatchObject({ duration: 2 });
        const dotDmgUp = charged.abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Out. DoT Damage Up II'
        )!;
        expect(dotDmgUp).toBeDefined();
        expect(dotDmgUp.config).toMatchObject({ duration: 3 });
        const hitMit = charged.abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Hit Mitigation'
        )!;
        expect(hitMit).toBeDefined();
        expect(hitMit.config).toMatchObject({ duration: 3 });
    });

    it('Tycho first passive: "gains Cheat Death and Everliving Regeneration I for 6 turns" — Everliving Regeneration I gets the 6-turn duration (Cheat Death stays untimed)', () => {
        // docs/ship-skills.csv Tycho first_passive_skill_text (exact clause, routed through the
        // real passive slot). Only the duration attachment is in question here — the
        // start-of-combat trigger itself was already fixed in epic PR4 (pre-combat seeding).
        const s = ship({
            refits: [{}] as Ship['refits'],
            firstPassiveSkillText:
                'At the start of combat, this Unit gains <unit-skill>Cheat Death</unit-skill> and <unit-skill>Everliving Regeneration I</unit-skill> for 6 turns.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const cheatDeath = passive.abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Cheat Death'
        )!;
        expect(cheatDeath).toBeDefined();
        expect(cheatDeath.config).toMatchObject({ duration: 'recurring' });
        const everliving = passive.abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Everliving Regeneration I'
        )!;
        expect(everliving).toBeDefined();
        expect(everliving.config).toMatchObject({ duration: 6 });
    });
});

// ── PR5 Finding 3: Nyxen typed cleanse filter ─────────────────────────────────────────────
describe('buildShipAbilities — PR5 Finding 3 Nyxen typed cleanse filter', () => {
    it('Nyxen active: "Cleanses 2 bombs" carries a debuffType: bomb filter', () => {
        // docs/ship-skills.csv Nyxen active_skill_text (exact clause, routed through the real
        // active slot).
        const s = ship({
            activeSkillText:
                'This Unit <unit-aid>Cleanses 2 bombs</unit-aid>, Grants a <unit-damage>Shield equal to 15%</unit-damage> of its Max HP, and Grants <unit-skill>Atlas Readiness II</unit-skill> for 1 turn.',
        });
        const active = slot(buildShipAbilities(s).slots, 'active')!;
        const cleanse = active.abilities.find((a) => a.type === 'cleanse')!;
        expect(cleanse).toBeDefined();
        expect(cleanse.config).toMatchObject({ type: 'cleanse', count: 2, debuffType: 'bomb' });
    });

    it('Nyxen charged: "Cleanses 2 damage over time debuffs" carries a debuffType: dot filter', () => {
        // docs/ship-skills.csv Nyxen charge_skill_text (exact clause, routed through the real
        // charged slot).
        const s = ship({
            activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
            chargeSkillCharge: 1,
            chargeSkillText:
                'This Unit <unit-aid>Cleanses 2</unit-aid> damage over time debuffs and Grants a <unit-damage>Shield equal to 19%</unit-damage> of its Max HP. It also Grants <unit-skill>Inc. Damage Down II</unit-skill> for 1 turn.',
        });
        const charged = slot(buildShipAbilities(s).slots, 'charged')!;
        const cleanse = charged.abilities.find((a) => a.type === 'cleanse')!;
        expect(cleanse).toBeDefined();
        expect(cleanse.config).toMatchObject({ type: 'cleanse', count: 2, debuffType: 'dot' });
    });

    it('negative: an untyped "cleanses 1 debuff from all allies" carries NO debuffType filter', () => {
        const s = ship({
            activeSkillText: 'This Unit <unit-aid>cleanses 1</unit-aid> debuff from all allies.',
        });
        const active = slot(buildShipAbilities(s).slots, 'active')!;
        const cleanse = active.abilities.find((a) => a.type === 'cleanse')!;
        expect(cleanse).toBeDefined();
        expect((cleanse.config as { debuffType?: string }).debuffType).toBeUndefined();
    });
});

// ── PR5 Finding 4: Isha/Guardian reactive-heal gates — CONFIRMED FALSE POSITIVE ───────────
// The sweep flagged Isha's crit/non-crit repairs as additively double-emitting (9% instead of
// 6%) and Guardian's <40%-HP gate as dropped. Both are ALREADY correctly modeled (Phase 4c PR1):
// Isha's "instead"-clause split produces a mutually-exclusive triggerCritFilter pair, and
// Guardian's on-attacked heal keeps a derivable below-40% self hp-threshold condition. These
// tests reproduce the exact CSV text through production slot routing and PASS with no code
// change — kept as regression locks documenting the false positive.
describe('buildShipAbilities — PR5 Finding 4 Isha/Guardian reactive-heal gates (confirmed FALSE POSITIVE)', () => {
    it('Isha second passive: the two damage-reaction repairs are MUTUALLY EXCLUSIVE (non-crit 3% / crit 6% instead), not additive', () => {
        // docs/ship-skills.csv Isha second_passive_skill_text (exact clause, routed through the
        // real passive slot via refits.length >= 2): "...When directly damaged, this Unit repairs
        // 3% of its max HP, but when criticall hit, it instead repairs 6% of its max HP."
        const s = ship({
            refits: [{}, {}] as Ship['refits'],
            secondPassiveSkillText:
                'At the start of the round this Unit gains <unit-skill>Offensive Affinity Override</unit-skill>.<br />If Nayra is on the same team, it also gains <unit-skill>Defensive Affinity Override</unit-skill>.<br /><br />When directly damaged, this Unit <unit-damage>repairs 3%</unit-damage> of its max HP, but when criticall hit, it instead <unit-damage>repairs 6%</unit-damage> of its max HP.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const heals = passive.abilities.filter((a) => a.type === 'heal');
        const nonCrit = heals.find((a) => a.config.type === 'heal' && a.config.pct === 3);
        const crit = heals.find((a) => a.config.type === 'heal' && a.config.pct === 6);
        expect(nonCrit).toBeDefined();
        expect(crit).toBeDefined();
        // Both ride on-attacked, but the crit branch REPLACES the non-crit branch via the
        // mutually-exclusive triggerCritFilter pair (crit hit → only the 6% fires, not 3%+6%).
        expect(nonCrit!.trigger).toBe('on-attacked');
        expect(nonCrit!.triggerCritFilter).toBe('non-crit');
        expect(crit!.trigger).toBe('on-attacked');
        expect(crit!.triggerCritFilter).toBe('crit');
    });

    it('Guardian first passive: the reactive repair keeps its below-40%-HP gate (fires only below threshold, not on every hit)', () => {
        // docs/ship-skills.csv Guardian first_passive_skill_text (exact clause, routed through the
        // real passive slot as R0): "When directly damaged while below 40% HP, this Unit repairs
        // 20% of its Max HP."
        const s = ship({
            refits: [{}] as Ship['refits'],
            firstPassiveSkillText:
                'When directly damaged while below 40% HP, this Unit <unit-damage>repairs 20%</unit-damage> of its Max HP.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const heal = passive.abilities.find(
            (a) => a.config.type === 'heal' && a.config.pct === 20
        )!;
        expect(heal).toBeDefined();
        expect(heal.trigger).toBe('on-attacked');
        expect(heal.conditions).toEqual([
            {
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: 'below',
                hpPercent: 40,
                hpSubject: 'self',
            },
        ]);
    });
});

// ---------------------------------------------------------------------------
// PR9(a): shield-basis "additional damage equal to X% of its/their current Shield" —
// Malvex, Quixilver, FrontLine. RAW CSV rows (docs/ship-skills.csv), verbatim.
// ---------------------------------------------------------------------------
describe('buildShipAbilities — PR9a shield-basis additional-damage', () => {
    it('FrontLine active: additional-damage stat "shield", pct 60 (pronoun "their")', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>80% damage</unit-damage> with additional damage equal to <unit-damage>60%</unit-damage> of their current Shield, and gains a <unit-damage>Shield equal to 30%</unit-damage> of the damage dealt.',
        });
        const active = slot(buildShipAbilities(s).slots, 'active')!;
        const add = abilityOfType(active.abilities, 'additional-damage');
        expect(add).toMatchObject({
            type: 'additional-damage',
            target: 'enemy',
            config: { type: 'additional-damage', stat: 'shield', pct: 60 },
            autoFilled: true,
        });
    });

    it('Malvex active: additional-damage stat "shield", pct 5', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>100% damage</unit-damage> with an additional damage equal to <unit-damage>5%</unit-damage> of its current Shield. If the target has a Shield this Unit gains <unit-damage>Shield equal to 15%</unit-damage> of its Max HP.',
        });
        const active = slot(buildShipAbilities(s).slots, 'active')!;
        const add = abilityOfType(active.abilities, 'additional-damage');
        expect(add).toMatchObject({
            config: { type: 'additional-damage', stat: 'shield', pct: 5 },
        });
    });

    it('Quixilver active: additional-damage stat "shield", pct 14', () => {
        const s = ship({
            activeSkillText:
                'This unit deals <unit-damage>100% damage</unit-damage> plus an additional damage equal to <unit-damage>14%</unit-damage> of its current Shield, and gains <unit-damage>Shield equal to 20%</unit-damage> of the damage dealt..',
        });
        const active = slot(buildShipAbilities(s).slots, 'active')!;
        const add = abilityOfType(active.abilities, 'additional-damage');
        expect(add).toMatchObject({
            config: { type: 'additional-damage', stat: 'shield', pct: 14 },
        });
    });
});

// ---------------------------------------------------------------------------
// PR9(b): standalone "removes X% of the enemy Shield" — APEX, Laika, Malvex. NOT gated on a
// purge landing (distinct from the I6 Lodolite `stripsShield` purge flag above).
// ---------------------------------------------------------------------------
describe('buildShipAbilities — PR9b standalone shield-strip', () => {
    it('APEX active: a shield-strip ability, pct 30, target enemy, trigger on-cast (alongside the primary damage)', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>100% damage</unit-damage>, removes <unit-damage>30%</unit-damage> of the enemy Shield, and inflicts <unit-skill>Speed Down II</unit-skill> and <unit-skill>Crit Power Down III</unit-skill> for 2 turns.',
        });
        const active = slot(buildShipAbilities(s).slots, 'active')!;
        const strip = abilityOfType(active.abilities, 'shield-strip');
        expect(strip).toMatchObject({
            type: 'shield-strip',
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'shield-strip', pct: 30 },
            autoFilled: true,
        });
        // The primary damage ability still builds independently (not displaced by the strip).
        const dmg = abilityOfType(active.abilities, 'damage');
        expect(dmg).toMatchObject({ config: { type: 'damage', multiplier: 100 } });
    });

    it('Laika charged: a shield-strip ability, pct 40', () => {
        const s = ship({
            chargeSkillText:
                'This Unit removes 40% of the enemy Shield and deals <unit-damage>150% damage</unit-damage>.',
            chargeSkillCharge: 2,
        });
        const charged = slot(buildShipAbilities(s).slots, 'charged')!;
        const strip = abilityOfType(charged.abilities, 'shield-strip');
        expect(strip).toMatchObject({ config: { type: 'shield-strip', pct: 40 } });
    });

    it('Malvex charged: a shield-strip ability (pct 30) co-existing with the shield-basis additional-damage ability (pct 12) in the SAME skill', () => {
        const s = ship({
            chargeSkillText:
                'This Unit deals <unit-damage>220% damage</unit-damage> with additional damage equal to <unit-damage>12%</unit-damage> of its current Shield and removes 30% of the enemy’s Shield. If the target has a Shield, it gains <unit-skill>Barrier</unit-skill> for 1 hit.',
            chargeSkillCharge: 3,
        });
        const charged = slot(buildShipAbilities(s).slots, 'charged')!;
        const strip = abilityOfType(charged.abilities, 'shield-strip');
        expect(strip).toMatchObject({ config: { type: 'shield-strip', pct: 30 } });
        const add = abilityOfType(charged.abilities, 'additional-damage');
        expect(add).toMatchObject({
            config: { type: 'additional-damage', stat: 'shield', pct: 12 },
        });
    });

    it('does NOT emit a shield-strip ability for the Lodolite I6 purge-coupled clause (guard against double-modeling)', () => {
        const LODOLITE_CHARGED_RAW =
            "This Unit deals <unit-damage>310% damage</unit-damage> and additional damage equal to <unit-damage>10%</unit-damage> of this Unit's max HP. Then, the enemy with the most <unit-aid>Buffs</unit-aid> is Purged of all buffs.<br />This attack can target <unit-aid>Stealthed</unit-aid> enemies.";
        const LODOLITE_R4_PASSIVE_RAW =
            "This Unit ignores <unit-skill>Stealth</unit-skill> effects.<br /><br />This Unit deals <unit-damage>10% more critical damage</unit-damage> to defenders, all allies deal <unit-damage>15% more direct damage</unit-damage> to enemies with <unit-skill>Concentrate Fire</unit-skill> or <unit-skill>Stealth</unit-skill>.<br /><br />When this Unit <unit-aid>Purges a buff</unit-aid> from an enemy, it <unit-damage>removes 100%</unit-damage> of the enemy's shield.";
        const s = ship({
            chargeSkillText: LODOLITE_CHARGED_RAW,
            chargeSkillCharge: 3,
            thirdPassiveSkillText: LODOLITE_R4_PASSIVE_RAW,
        });
        const { slots } = buildShipAbilities(s);
        const allAbilities = slots.flatMap((sk) => sk.abilities);
        expect(allAbilities.filter((a) => a.type === 'shield-strip')).toHaveLength(0);
        // The purge ability still carries stripsShield (I6, unaffected by this PR).
        const purge = allAbilities.find((a) => a.type === 'purge')!;
        expect(purge.config).toMatchObject({ stripsShield: true });
    });
});

// ---------------------------------------------------------------------------
// Epic PR12(A): damage-reflection phrasing — Nosorog "reflects 40% of the Damage taken back to
// the enemy when directly damaged as a primary target." The `damage-reflection` type already
// exists (Reflect gear set thorns); this wires the SKILL-TEXT phrasing, including the
// primary-target gate the gear set never carries.
// ---------------------------------------------------------------------------
describe('buildShipAbilities — epic PR12(A) Nosorog damage-reflection phrasing', () => {
    it('Nosorog second passive (40%): a damage-reflection ability with requirePrimaryTarget', () => {
        const s = ship({
            secondPassiveSkillText:
                'This Unit reflects 40% of the Damage taken back to the enemy when directly damaged as a primary target.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const reflect = passive.abilities.find((a) => a.config.type === 'damage-reflection');
        expect(reflect).toMatchObject({
            type: 'modifier',
            target: 'self',
            config: { type: 'damage-reflection', pct: 40, requirePrimaryTarget: true },
        });
    });

    it('Nosorog third passive (40%, verbatim CSV text with trailing Defense-Up clause): still emits the reflect ability', () => {
        const s = ship({
            thirdPassiveSkillText:
                'This Unit reflects 40% of the Damage taken back to the enemy when directly damaged as a primary target. Additionally, when this Unit removes a Debuff, it gains <unit-skill>Defense Up II</unit-skill> for 1 turn.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const reflect = passive.abilities.find((a) => a.config.type === 'damage-reflection');
        expect(reflect).toMatchObject({
            config: { type: 'damage-reflection', pct: 40, requirePrimaryTarget: true },
        });
    });

    it('does NOT set requirePrimaryTarget for an unrelated reflect-shaped phrasing without the primary-target clause (regression guard)', () => {
        // Hypothetical: same reflect verb, no "as a primary target" qualifier — should stay
        // unconditional (mirrors the Reflect gear set's unconditional shape).
        const s = ship({
            secondPassiveSkillText: 'This Unit reflects 25% of the Damage taken back to the enemy.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const reflect = passive.abilities.find((a) => a.config.type === 'damage-reflection');
        expect(reflect).toMatchObject({
            config: { type: 'damage-reflection', pct: 25 },
        });
        expect(
            (reflect!.config as { requirePrimaryTarget?: boolean }).requirePrimaryTarget
        ).toBeFalsy();
    });
});

// ---------------------------------------------------------------------------
// Epic PR12(B): Chakara's charged "bypassing 20% of the enemy Defense" → a per-skill
// defensePenetration modifier (the `defensePenetration` ModifierChannel already exists;
// this wires the "bypassing X% of the enemy Defense" phrasing distinct from the existing
// "X% defense penetration" wording). Because `abilitiesFromText` runs per skill ROW, the
// resulting modifier ability is scoped to the CHARGED skill's own cast (folded via
// `firingSkill.abilities` in playerTurn.ts) — not a standing self-buff.
// ---------------------------------------------------------------------------
describe('buildShipAbilities — epic PR12(B) Chakara "bypassing N% of the enemy Defense"', () => {
    it('Chakara charged: a self defensePenetration modifier (value 20) alongside the damage + additional-damage + purge abilities', () => {
        const s = ship({
            chargeSkillText:
                'This Unit deals <unit-damage>220% damage</unit-damage> with an additional amount equal to <unit-damage>100%</unit-damage> of its Defense, bypassing 20% of the enemy Defense, and <unit-aid>purges 1</unit-aid> buff from the enemy.',
            chargeSkillCharge: 2,
        });
        const charged = slot(buildShipAbilities(s).slots, 'charged')!;
        const pen = charged.abilities.find(
            (a) => a.config.type === 'modifier' && a.config.channel === 'defensePenetration'
        );
        expect(pen).toMatchObject({
            type: 'modifier',
            target: 'self',
            config: {
                type: 'modifier',
                channel: 'defensePenetration',
                value: 20,
                isMultiplicative: false,
            },
        });
        // The damage/additional-damage/purge abilities from the SAME text still build.
        expect(abilityOfType(charged.abilities, 'damage')).toMatchObject({
            config: { type: 'damage', multiplier: 220 },
        });
        expect(abilityOfType(charged.abilities, 'additional-damage')).toMatchObject({
            config: { type: 'additional-damage', stat: 'defense', pct: 100 },
        });
        expect(abilityOfType(charged.abilities, 'purge')).toMatchObject({
            config: { type: 'purge', count: 1 },
        });
    });

    it('the defensePenetration modifier is scoped to the CHARGED row only (not duplicated onto an unrelated active-slot text)', () => {
        const s = ship({
            activeSkillText: 'This Unit deals <unit-damage>160% damage</unit-damage>.',
            chargeSkillText:
                'This Unit deals <unit-damage>220% damage</unit-damage>, bypassing 20% of the enemy Defense.',
            chargeSkillCharge: 2,
        });
        const active = slot(buildShipAbilities(s).slots, 'active')!;
        expect(
            active.abilities.some(
                (a) => a.config.type === 'modifier' && a.config.channel === 'defensePenetration'
            )
        ).toBe(false);
        const charged = slot(buildShipAbilities(s).slots, 'charged')!;
        expect(
            charged.abilities.some(
                (a) => a.config.type === 'modifier' && a.config.channel === 'defensePenetration'
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Epic PR12(C): incoming-damage-reduction phrasings — Anemone, Panon, Wusheng, Tormenter.
// The `incoming-reduction` AbilityConfig + IncomingCondition already exist (D-PR3, Iridium/
// Voidshade/Hyperion Gaze/Ironclad); this wires four new corpus phrasings onto them.
// ---------------------------------------------------------------------------
describe('buildShipAbilities — epic PR12(C) incoming-damage-reduction phrasings', () => {
    it('Anemone second passive: 25% direct-scope reduction gated on attacker-has-dot', () => {
        const s = ship({
            secondPassiveSkillText:
                'This Unit takes 25% less direct damage from enemies debuffed with a Damage over Time effect.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const reduction = passive.abilities.find((a) => a.config.type === 'incoming-reduction');
        expect(reduction).toMatchObject({
            type: 'incoming-reduction',
            target: 'self',
            config: {
                type: 'incoming-reduction',
                scope: 'direct',
                condition: 'attacker-has-dot',
                pct: 25,
                critFamily: false,
            },
        });
    });

    it('Panon third passive: 20% reduction (both direct + dot scope) gated on self-barrier-recharging', () => {
        const s = ship({
            thirdPassiveSkillText:
                'If this Unit is directly damaged and does not have <unit-skill>Barrier Recharging</unit-skill>, it gains <unit-skill>Barrier</unit-skill> for 1 turn and applies <unit-skill>Barrier Recharging</unit-skill> to itself for 3 turns.<br /><br />This Unit reduces all incoming damage by 20% when affected by <unit-skill>Barrier Recharging</unit-skill>.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const reductions = passive.abilities.filter((a) => a.config.type === 'incoming-reduction');
        expect(reductions).toHaveLength(2);
        const scopes = reductions.map((a) =>
            a.config.type === 'incoming-reduction' ? a.config.scope : undefined
        );
        expect(scopes.sort()).toEqual(['direct', 'dot']);
        for (const r of reductions) {
            expect(r.config).toMatchObject({
                condition: 'self-barrier-recharging',
                pct: 20,
                critFamily: false,
            });
        }
    });

    it('Wusheng third passive: 25% direct-scope reduction gated on self-stealth (reuses the existing Voidshade condition)', () => {
        const s = ship({
            thirdPassiveSkillText:
                'This Unit gains <unit-skill>Stealth</unit-skill> for 1 turn after critically damaging an enemy.<br /><br />This Unit reduces direct damage by 25% while <unit-skill>Stealth</unit-skill> is active. If directly damaged while <unit-skill>Stealth</unit-skill> is active, remove <unit-skill>Stealth</unit-skill>.<br /><br />This Unit starts combat fully charged.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const reduction = passive.abilities.find((a) => a.config.type === 'incoming-reduction');
        expect(reduction).toMatchObject({
            config: {
                type: 'incoming-reduction',
                scope: 'direct',
                condition: 'self-stealth',
                pct: 25,
                critFamily: false,
            },
        });
    });

    it('Tormenter third passive: HP-proportional reduction (up to 30%) on BOTH scopes, condition always, no phantom base-damage ability', () => {
        const s = ship({
            thirdPassiveSkillText:
                'This Unit always lands critical hits and gains up to <unit-damage>30% damage</unit-damage> reduction as its health decreases.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        // PR1 regression guard: no phantom on-cast damage ability from this clause.
        expect(abilityOfType(passive.abilities, 'damage')).toBeUndefined();
        const reductions = passive.abilities.filter((a) => a.config.type === 'incoming-reduction');
        expect(reductions).toHaveLength(2);
        for (const r of reductions) {
            expect(r.config).toMatchObject({
                condition: 'always',
                critFamily: false,
                hpScaling: { perUnit: 0.3, cap: 30 },
            });
        }
        const scopes = reductions.map((a) =>
            a.config.type === 'incoming-reduction' ? a.config.scope : undefined
        );
        expect(scopes.sort()).toEqual(['direct', 'dot']);
    });

    it('Curator passive: the enemy-charged-cast Block Buff builds EXACTLY ONCE (on on-enemy-charged-cast), with no duplicate on-cast sibling', () => {
        // parseEnemyChargedCastReaction emits the Block Buff on on-enemy-charged-cast; the generic
        // enemyDebuffs auto-fill would ALSO extract "Block Buff" and emit a second, ungated on-cast
        // debuff that fires on Curator's OWN turn regardless of any enemy charged cast. Guard against
        // that double-emission.
        const s = ship({
            thirdPassiveSkillText:
                'This Unit has 20% Shield Penetration. <br /><br />\nWhen an enemy uses their charged skill, this unit <unit-aid>purges 1 buffs</unit-aid> from that enemy, and inflicts <unit-skill>Block Buff</unit-skill> for 1 turns.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const blockBuffs = passive.abilities.filter(
            (a) => 'buffName' in a.config && a.config.buffName === 'Block Buff'
        );
        expect(blockBuffs).toHaveLength(1);
        expect(blockBuffs[0].trigger).toBe('on-enemy-charged-cast');
        // No on-cast Block Buff sibling that would fire on Curator's own turn.
        expect(blockBuffs.some((a) => a.trigger === 'on-cast')).toBe(false);
    });
});
