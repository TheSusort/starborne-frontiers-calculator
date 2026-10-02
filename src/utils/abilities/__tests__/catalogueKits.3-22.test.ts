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

    // User ruling (2026-10-02): "a control effect" is any of Stasis, Disable, Provoke, Taunt and
    // Concentrate Fire on the target. The base damage always fires; the additional damage is a
    // binary add-on (capped at its own amount) when the target carries any one of them.
    const CONTROL_EFFECT_CONDITIONS = [
        { subject: 'enemy-debuff', derivable: true, buffName: 'Stasis', anyOf: true },
        { subject: 'enemy-debuff', derivable: true, buffName: 'Disable', anyOf: true },
        { subject: 'enemy-debuff', derivable: true, buffName: 'Provoke', anyOf: true },
        { subject: 'enemy-buff', derivable: true, buffName: 'Taunt', anyOf: true },
        { subject: 'enemy-debuff', derivable: true, buffName: 'Concentrate Fire', anyOf: true },
    ];

    it.each([
        {
            slot: 'active' as const,
            text: 'This Unit deals <unit-damage>80% damage</unit-damage> and, if the target is affected by a <unit-skill>control</unit-skill> effect, deals an additional <unit-damage>130% damage</unit-damage>.',
            base: 80,
            bonus: 130,
        },
        {
            slot: 'charged' as const,
            text: 'This Unit deals <unit-damage>120% damage</unit-damage> and, if the target is affected by a <unit-skill>control</unit-skill> effect, deals an additional <unit-damage>150% damage</unit-damage>.',
            base: 120,
            bonus: 150,
        },
    ])(
        'Sokol $slot: the additional damage needs a control effect on the target',
        ({ slot, text, base, bonus }) => {
            const abilities = parseSlot(slot, text);
            expect(sigs(abilities)).toEqual(['damage|enemy|on-cast|damage']);
            const dmg = only(abilities, 'damage');
            expect(dmg.config).toEqual({ type: 'damage', multiplier: base });
            expect(dmg.conditions).toEqual(CONTROL_EFFECT_CONDITIONS);
            expect(dmg.scaling).toEqual({ conditionIndex: 0, perUnit: bonus, cap: bonus });
            // No status named "control" is minted or gated on.
            expect(JSON.stringify(abilities)).not.toMatch(/"buffName":"control"/i);
        }
    );
});

describe('3.22 kits — charge, purge and repair clauses', () => {
    it('Zosimos active: the charge gain is gated on the target having been repaired this round', () => {
        const text =
            'This Unit deals <unit-damage>170% damage</unit-damage> and inflicts <unit-skill>Inc. Damage Up II</unit-skill> for 2 turns. If the target was repaired this round, this Unit <unit-skill>adds 1 charge</unit-skill> to its charged skill.';
        const abilities = parseSlot('active', text);
        expect(sigs(abilities)).toEqual(
            sorted([
                'damage|enemy|on-cast|damage',
                'debuff|enemy|on-cast|Inc. Damage Up II',
                'charge|self|on-cast|charge',
            ])
        );
        expect(only(abilities, 'charge')).toMatchObject({
            config: { amount: 1 },
            conditions: [{ subject: 'target-repaired-this-round', derivable: true }],
        });
        // The repair gate belongs to the charge sentence only.
        expect(only(abilities, 'damage').conditions).toEqual([]);
        expect(only(abilities, 'debuff').conditions).toEqual([]);
    });

    // KNOWN GAP: the text repairs 8% per buff removed. The engine heals a flat 8% per purge
    // because the on-enemy-purged listener passes no count and no heal reads purge-performed's
    // count; whether the chained extra purge counts toward the heal is an open question.
    it('Sefuba passive R2: pins the current flat-8% heal parse (not the per-buff kit) and the 1 extra purge', () => {
        const text =
            'When this Unit <unit-skill>purges a buff</unit-skill> from an enemy, it <unit-damage>repairs 8%</unit-damage> of its max HP for each <unit-aid>buff</unit-aid> removed and also <unit-skill>purges 1 extra buff</unit-skill> from the enemy.';
        const abilities = parseSlot('passive', text);
        expect(sigs(abilities)).toEqual(
            sorted(['heal|self|on-enemy-purged|heal', 'purge|enemy|on-enemy-purged|purge'])
        );
        expect(only(abilities, 'heal').config).toMatchObject({ pct: 8, basis: 'hp' });
        expect(only(abilities, 'purge').config).toMatchObject({ count: 1 });
    });
});

describe('3.22 kits — passives', () => {
    // The shield-penetration sentence mints nothing: shield penetration is a ship stat carried by
    // the template data (see the `shield-penetration-innate` audit rule).
    it('Guardian passive R0: being critically hit grants Binderburg Resilience I', () => {
        const text =
            'This Unit has <unit-damage>20% shield penetration</unit-damage>.<br /><br />When this Unit is critically hit, it gains <unit-skill>Binderburg Resilience I</unit-skill> for 1 turn.';
        const abilities = parseSlot('passive', text);
        expect(sigs(abilities)).toEqual(['buff|self|on-attacked|Binderburg Resilience I']);
        expect(only(abilities, 'buff')).toMatchObject({
            triggerCritFilter: 'crit',
            config: { buffName: 'Binderburg Resilience I', duration: 1 },
        });
    });

    it('LUXX passive R0: a shield of 20% max HP every turn', () => {
        const text =
            'Every turn this Unit gains a <unit-damage>shield equal to 20%</unit-damage> of its max HP.';
        const abilities = parseSlot('passive', text);
        expect(sigs(abilities)).toEqual(['shield|self|start-of-turn|shield']);
        expect(only(abilities, 'shield').config).toMatchObject({ pct: 20, basis: 'hp' });
    });

    // "gains 1 stack of X every turn" is an on-cast buff that stacks per round — the same model
    // as Sokol's and Butcher's every-turn stacks.
    it('LUXX passive R2: the 20% shield every turn plus a Blast stack every turn', () => {
        const text =
            'Every turn this Unit gains a <unit-damage>shield equal to 20%</unit-damage> of its max HP and gains 1 stack of <unit-skill>Blast</unit-skill>.';
        const abilities = parseSlot('passive', text);
        expect(sigs(abilities)).toEqual(
            sorted(['shield|self|start-of-turn|shield', 'buff|self|on-cast|Blast'])
        );
        expect(only(abilities, 'shield').config).toMatchObject({ pct: 20, basis: 'hp' });
        expect(only(abilities, 'buff').config).toMatchObject({
            buffName: 'Blast',
            stackTrigger: 'per-round',
        });
    });

    // Ripper's Inferno reaction is not minted. It reacts only to debuffs his active or charged
    // casts inflict, and the debuff-inflicted trigger has no source-slot filter; minted on that
    // trigger it would also wake on the Inferno's own landing.
    it('Ripper passive R0: the Inferno-on-debuff reaction is not minted', () => {
        const text =
            'When this Unit inflicts a <unit-aid>debuff</unit-aid> with its active or charged skills, it also inflicts <unit-skill>Inferno II</unit-skill> for 2 turns.';
        expect(sigs(parseSlot('passive', text))).toEqual([]);
    });

    // KNOWN GAP: the extension fires on every cast, including a cast whose debuffs are all
    // resisted, because no trigger counts just the debuffs an active or charged cast inflicts
    // (the R0 note above). Whether the extension is per cast or per debuff is pending a user
    // ruling.
    it('Ripper passive R2: only the all-allies buff extension is minted', () => {
        const text =
            'When this Unit inflicts a <unit-aid>debuff</unit-aid> with its active or charged skills, it also inflicts <unit-skill>Inferno II</unit-skill> for 2 turns and all allies active <unit-skill>buffs are extended by 1 turn</unit-skill>.';
        const abilities = parseSlot('passive', text);
        expect(sigs(abilities)).toEqual(['extend-status|all-allies|on-cast|extend-status']);
        expect(only(abilities, 'extend-status').config).toMatchObject({
            statusKind: 'buff',
            turns: 1,
        });
    });
});

describe('3.22 kits — Akula', () => {
    // The ignore-Taunt/Provoke and don't-break-Stasis flags live in the passive sentence; the
    // active and charged texts no longer carry them.
    it('Akula: the passive alone grants both flags to the ship', () => {
        const ship = {
            refits: [],
            chargeSkillCharge: 4,
            activeSkillText: 'This Unit deals <unit-damage>160% damage</unit-damage>.',
            chargeSkillText: 'This Unit deals <unit-damage>220% damage</unit-damage>.',
            firstPassiveSkillText:
                "This Unit's attacks do not reduce <unit-skill>Stasis</unit-skill>, and also ignore <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects. <br /><br />This Unit <unit-damage>increases outgoing direct damage</unit-damage> based on the enemies current HP, up to <unit-damage>30%</unit-damage> when the enemy is at full HP.",
        } as unknown as Ship;
        const built = buildShipAbilities(ship);
        expect(built.ignoresForcedTargeting).toBe(true);
        expect(built.doesntBreakStasis).toBe(true);
    });
});
