import { describe, it, expect } from 'vitest';
import {
    parseSkillDamage,
    parseSkillHeal,
    detectFullyCharged,
    parseSkillEffects,
    parseAllSkillEffects,
    parseSecondaryDamage,
    parseConditionalDamage,
    parseChargeGain,
    detectGrantConditions,
    parseHpThresholdCondition,
    parseExtendDoT,
    parseCritPowerExtend,
    parseAllyCritDot,
    parseNoCrit,
    parseDetonateDoT,
    parseAccumulateDetonate,
    isAccumulateDetonateEffect,
} from '../skillTextParser';
import type { Ship } from '../../types/ship';

describe('parseSkillDamage', () => {
    it('returns 0 for empty string', () => {
        expect(parseSkillDamage('')).toBe(0);
    });

    it('extracts a single damage value', () => {
        expect(parseSkillDamage('Deals <unit-damage>180% damage</unit-damage> to target')).toBe(
            180
        );
    });

    it('returns the first damage value and ignores subsequent tags', () => {
        const text =
            'Deals <unit-damage>120% damage</unit-damage> then <unit-damage>60% damage</unit-damage>';
        expect(parseSkillDamage(text)).toBe(120);
    });

    it('skips "% more direct damage" modifier phrasing (not a base multiplier)', () => {
        // Thresh passive — this is a passive output modifier, parsed by parseModifier.
        expect(
            parseSkillDamage('This Unit deals <unit-damage>25% more direct damage</unit-damage>')
        ).toBe(0);
    });

    it('skips stat-based damage ("of its" follows closing tag)', () => {
        const text = 'Deals additional damage based on <unit-damage>30%</unit-damage> of its DEF';
        expect(parseSkillDamage(text)).toBe(0);
    });

    it('skips stat-based damage ("of this" follows closing tag)', () => {
        const text =
            "This Unit deals <unit-damage>200% damage</unit-damage> with additional damage equal to <unit-damage>10%</unit-damage> of this Unit's max HP";
        expect(parseSkillDamage(text)).toBe(200);
    });

    it('keeps a normal damage tag that happens to follow a long sentence without "of its"', () => {
        const text = 'This unit attacks the enemy and deals <unit-damage>200% damage</unit-damage>';
        expect(parseSkillDamage(text)).toBe(200);
    });

    it('returns integer percentage, not a float', () => {
        const result = parseSkillDamage('<unit-damage>180% damage</unit-damage>');
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBe(180);
    });

    it('handles a mix of stat-based and normal damage in the same text', () => {
        const text =
            'Deals <unit-damage>100% damage</unit-damage> plus extra based on <unit-damage>50%</unit-damage> of its HP';
        expect(parseSkillDamage(text)).toBe(100);
    });
});

describe('parseSkillHeal', () => {
    it('returns 0 for empty string', () => {
        expect(parseSkillHeal('')).toBe(0);
    });

    it('extracts heal percentage from repairs tag', () => {
        expect(
            parseSkillHeal('This Unit <unit-damage>repairs 15%</unit-damage> of target HP')
        ).toBe(15);
    });

    it('handles decimal heal percentages', () => {
        expect(parseSkillHeal('<unit-damage>repairs 12.5%</unit-damage>')).toBe(12.5);
    });

    it('is case-insensitive', () => {
        expect(parseSkillHeal('<unit-damage>Repairs 20%</unit-damage>')).toBe(20);
    });

    it('returns 0 when tag content is not a repair', () => {
        expect(parseSkillHeal('<unit-damage>180% damage</unit-damage>')).toBe(0);
    });

    it('returns 0 for flat heal text without percent', () => {
        expect(parseSkillHeal('<unit-damage>repairs 1500 HP</unit-damage>')).toBe(0);
    });

    it('ignores damage tags and finds the repairs tag', () => {
        const text =
            'Deals <unit-damage>100% damage</unit-damage> and <unit-damage>repairs 15%</unit-damage>';
        expect(parseSkillHeal(text)).toBe(15);
    });
});

describe('detectFullyCharged', () => {
    it('returns false for empty array', () => {
        expect(detectFullyCharged([])).toBe(false);
    });

    it('returns false when no skill text contains "fully charged"', () => {
        expect(detectFullyCharged(['Deals 180% damage', 'Passive bonus'])).toBe(false);
    });

    it('returns true for "starts combat fully charged"', () => {
        expect(detectFullyCharged(['This unit starts combat fully charged.'])).toBe(true);
    });

    it('returns true for "starts combat with a fully charged charged skill" variant', () => {
        expect(
            detectFullyCharged(['This unit starts combat with a fully charged charged skill.'])
        ).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(detectFullyCharged(['This unit starts combat FULLY CHARGED.'])).toBe(true);
    });

    it('handles undefined entries in the array without throwing', () => {
        expect(detectFullyCharged([undefined, 'starts combat fully charged', undefined])).toBe(
            true
        );
    });

    it('returns true when match is in a passive skill (3rd entry)', () => {
        expect(
            detectFullyCharged([
                undefined,
                undefined,
                'This unit starts combat fully charged.',
                undefined,
                undefined,
            ])
        ).toBe(true);
    });

    it('returns false when all entries are undefined', () => {
        expect(detectFullyCharged([undefined, undefined])).toBe(false);
    });
});

describe('parseSkillEffects', () => {
    it('returns [] for null input', () => {
        expect(parseSkillEffects(null, 'active')).toEqual([]);
    });

    it('returns [] for empty string', () => {
        expect(parseSkillEffects('', 'active')).toEqual([]);
    });

    it('returns [] when no unit-skill tags present', () => {
        expect(
            parseSkillEffects('This Unit deals <unit-damage>180% damage</unit-damage>', 'active')
        ).toEqual([]);
    });

    it('parses inflicts → enemy with duration', () => {
        expect(
            parseSkillEffects(
                'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns',
                'active'
            )
        ).toEqual([
            {
                buffName: 'Defense Down II',
                target: 'enemy',
                duration: 2,
                source: 'active',
                application: 'inflict',
            },
        ]);
    });

    it('parses gains → self with duration', () => {
        expect(
            parseSkillEffects(
                'This Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn',
                'passive1'
            )
        ).toEqual([{ buffName: 'Attack Up III', target: 'self', duration: 1, source: 'passive1' }]);
    });

    it('parses grants → self with duration', () => {
        expect(
            parseSkillEffects(
                'This Unit grants <unit-skill>Hacking Up III</unit-skill> for 2 turns',
                'active'
            )
        ).toEqual([{ buffName: 'Hacking Up III', target: 'self', duration: 2, source: 'active' }]);
    });

    it('assigns source field from argument', () => {
        const result = parseSkillEffects(
            'This Unit gains <unit-skill>Defense Up II</unit-skill> for 1 turn',
            'passive2'
        );
        expect(result[0].source).toBe('passive2');
    });

    it('handles individual durations: inflicts X for 1 turn and Y for 2 turns', () => {
        expect(
            parseSkillEffects(
                'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 1 turn and <unit-skill>Speed Down II</unit-skill> for 2 turns',
                'active'
            )
        ).toEqual([
            {
                buffName: 'Defense Down II',
                target: 'enemy',
                duration: 1,
                source: 'active',
                application: 'inflict',
            },
            {
                buffName: 'Speed Down II',
                target: 'enemy',
                duration: 2,
                source: 'active',
                application: 'inflict',
            },
        ]);
    });

    it('handles shared duration: inflicts X and Y for 2 turns — both get 2', () => {
        const result = parseSkillEffects(
            'This Unit inflicts <unit-skill>Defense Down II</unit-skill> and <unit-skill>Speed Down II</unit-skill> for 2 turns',
            'active'
        );
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
            buffName: 'Defense Down II',
            target: 'enemy',
            duration: 2,
        });
        expect(result[1]).toMatchObject({
            buffName: 'Speed Down II',
            target: 'enemy',
            duration: 2,
        });
    });

    it('handles shared duration with trailing period: inflicts X and Y for 2 turns.', () => {
        const result = parseSkillEffects(
            'This Unit inflicts <unit-skill>Defense Down II</unit-skill> and <unit-skill>Speed Down II</unit-skill> for 2 turns.',
            'active'
        );
        expect(result).toHaveLength(2);
        expect(result[0].duration).toBe(2);
        expect(result[1].duration).toBe(2);
    });

    it('handles shared duration across three tags: inflicts X, Y, and Z for 2 turns', () => {
        const result = parseSkillEffects(
            'This Unit inflicts <unit-skill>Defense Down II</unit-skill>, <unit-skill>Speed Down II</unit-skill>, and <unit-skill>Attack Down II</unit-skill> for 2 turns',
            'active'
        );
        expect(result).toHaveLength(3);
        result.forEach((e) => expect(e.duration).toBe(2));
    });

    it('does not bleed shared duration across sentence boundaries', () => {
        const result = parseSkillEffects(
            'This Unit gains <unit-skill>Defense Up II</unit-skill>. This Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn',
            'passive1'
        );
        expect(result.find((e) => e.buffName === 'Defense Up II')?.duration).toBeNull();
        expect(result.find((e) => e.buffName === 'Attack Up III')?.duration).toBe(1);
    });

    it('skips tags preceded by ignoring', () => {
        expect(
            parseSkillEffects(
                "This Unit's attack ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill>",
                'active'
            )
        ).toEqual([]);
    });

    it('skips tags preceded by loses', () => {
        expect(
            parseSkillEffects(
                'Upon killing an enemy, this Unit loses <unit-skill>Overload</unit-skill>',
                'passive1'
            )
        ).toEqual([]);
    });

    it('parses stack-based recurring effect', () => {
        const result = parseSkillEffects(
            'This Unit gains 1 stack of <unit-skill>Blast</unit-skill> every turn',
            'passive1'
        );
        expect(result).toEqual([
            {
                buffName: 'Blast',
                target: 'self',
                duration: 'recurring',
                stacks: 1,
                source: 'passive1',
                stackTrigger: 'per-round',
            },
        ]);
    });

    it('parses "every turn" as recurring without stacks', () => {
        const result = parseSkillEffects(
            'This Unit gains <unit-skill>Attack Up II</unit-skill> every turn',
            'active'
        );
        expect(result[0]).toMatchObject({ duration: 'recurring' });
        expect(result[0].stacks).toBeUndefined();
    });

    it('does not override finite duration with recurring when stacks present', () => {
        const result = parseSkillEffects(
            'This Unit gains 3 stacks of <unit-skill>Blast</unit-skill> for 2 turns',
            'active'
        );
        expect(result[0]).toMatchObject({ stacks: 3, duration: 2 });
    });

    it('stops scanning backward at sentence boundary (.)', () => {
        const result = parseSkillEffects(
            'This Unit loses <unit-skill>Overload</unit-skill>. This Unit gains <unit-skill>Attack Up III</unit-skill> for 3 turns',
            'passive1'
        );
        expect(result).toEqual([
            { buffName: 'Attack Up III', target: 'self', duration: 3, source: 'passive1' },
        ]);
    });

    it('returns [] when no relevant verb is found before the tag', () => {
        expect(
            parseSkillEffects(
                'This Unit has <unit-skill>Defense Up II</unit-skill> at all times',
                'passive1'
            )
        ).toEqual([]);
    });

    it('skips tags preceded by when', () => {
        expect(
            parseSkillEffects('When this Unit has <unit-skill>Blast</unit-skill>', 'passive1')
        ).toEqual([]);
    });

    it('parses "granted" (passive voice) as a self-targeting buff', () => {
        const result = parseSkillEffects(
            '(All) allies are granted <unit-skill>Attack Up III</unit-skill> for 2 turns and <unit-skill>Speed Up III</unit-skill> for 2 turns.',
            'active'
        );
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
            buffName: 'Attack Up III',
            target: 'self',
            duration: 2,
            source: 'active',
        });
        expect(result[1]).toMatchObject({
            buffName: 'Speed Up III',
            target: 'self',
            duration: 2,
            source: 'active',
        });
    });

    it('parses "inflicting" (gerund) as an enemy debuff', () => {
        const result = parseSkillEffects(
            'This Unit attacks all enemies, dealing <unit-damage>240% damage</unit-damage> and inflicting <unit-skill>Stasis</unit-skill> for 2 turns.',
            'active'
        );
        expect(result).toEqual([
            {
                buffName: 'Stasis',
                target: 'enemy',
                duration: 2,
                source: 'active',
                application: 'inflict',
            },
        ]);
    });

    it('parses "inflict" (bare imperative) as an enemy debuff', () => {
        const result = parseSkillEffects(
            'When the target was repaired this round, inflict <unit-skill>Defense Down II</unit-skill> for 2 turns.',
            'active'
        );
        expect(result).toEqual([
            {
                buffName: 'Defense Down II',
                target: 'enemy',
                duration: 2,
                source: 'active',
                application: 'inflict',
            },
        ]);
    });

    it('parses "is inflicted with" (passive voice) as an enemy debuff', () => {
        const result = parseSkillEffects(
            'The primary target is inflicted with <unit-skill>Disable</unit-skill> for 2 turns.',
            'active'
        );
        expect(result).toEqual([
            {
                buffName: 'Disable',
                target: 'enemy',
                duration: 2,
                source: 'active',
                application: 'inflict',
            },
        ]);
    });

    it('parses "apply" (bare imperative) using BUFFS type to target', () => {
        const result = parseSkillEffects(
            'When targeting non-Defenders, apply <unit-skill>Concentrate Fire</unit-skill> for 2 turns.',
            'active'
        );
        expect(result).toEqual([
            {
                buffName: 'Concentrate Fire',
                target: 'enemy',
                duration: 2,
                source: 'active',
                application: 'apply',
            },
        ]);
    });

    it('parses "is applied with" (passive voice) using BUFFS type to target', () => {
        const result = parseSkillEffects(
            'The highest attack enemy is applied with <unit-skill>Concentrate Fire</unit-skill> for 2 turns.',
            'active'
        );
        expect(result).toEqual([
            {
                buffName: 'Concentrate Fire',
                target: 'enemy',
                duration: 2,
                source: 'active',
                application: 'apply',
            },
        ]);
    });

    it('parses "gaining" (gerund) as a self buff', () => {
        const result = parseSkillEffects(
            'This Unit repairs itself while gaining <unit-skill>Defense Up II</unit-skill> for 2 turns.',
            'active'
        );
        expect(result).toEqual([
            { buffName: 'Defense Up II', target: 'self', duration: 2, source: 'active' },
        ]);
    });

    it('does not treat an adjectival "newly applied" debuff as a fresh application', () => {
        expect(
            parseSkillEffects(
                'After a critical hit, this Unit extends the newly applied <unit-skill>Acidic Decay</unit-skill> by 1 turn.',
                'active'
            )
        ).toEqual([]);
    });
});

describe('parseSecondaryDamage', () => {
    const chakara =
        'This Unit deals <unit-damage>180% damage</unit-damage> with additional damage equal to <unit-damage>80%</unit-damage> of its Defense.';
    const lodolite =
        'This Unit deals <unit-damage>240% damage</unit-damage> with additional damage equal to <unit-damage>10%</unit-damage> of its max HP.';

    it('parses Defense-based secondary damage', () => {
        expect(parseSecondaryDamage(chakara)).toEqual({ stat: 'defense', pct: 80 });
    });
    it('parses max-HP-based secondary damage', () => {
        expect(parseSecondaryDamage(lodolite)).toEqual({ stat: 'hp', pct: 10 });
    });
    it('parses the "this Unit\'s max HP" phrasing', () => {
        const text =
            "deals <unit-damage>200% damage</unit-damage> with additional damage equal to <unit-damage>10%</unit-damage> of this Unit's max HP.";
        expect(parseSecondaryDamage(text)).toEqual({ stat: 'hp', pct: 10 });
    });
    it('returns null when there is no secondary damage', () => {
        expect(
            parseSecondaryDamage('This Unit deals <unit-damage>180% damage</unit-damage>.')
        ).toBeNull();
    });
    it('returns null for empty input', () => {
        expect(parseSecondaryDamage('')).toBeNull();
    });
    it('parses a decimal secondary percentage (Selenite charged: 17.5% of max HP)', () => {
        const seleniteCharged =
            "This Unit deals <unit-damage>300% damage</unit-damage> with additional damage equal to <unit-damage>17.5%</unit-damage> of this Unit's max HP. This attack can target <unit-aid>Stealthed</unit-aid> enemies.";
        expect(parseSecondaryDamage(seleniteCharged)).toEqual({ stat: 'hp', pct: 17.5 });
    });
    it('parses a decimal Defense secondary percentage', () => {
        const text =
            'deals <unit-damage>180% damage</unit-damage> with additional damage equal to <unit-damage>2.5%</unit-damage> of its Defense.';
        expect(parseSecondaryDamage(text)).toEqual({ stat: 'defense', pct: 2.5 });
    });
    it('parses "additional damage equal to N%" when the % is at the end of the tag (Nayra)', () => {
        const text =
            'dealing <unit-damage>170% damage</unit-damage> and additional <unit-damage>damage equal to 30%</unit-damage> of its Defense.';
        expect(parseSecondaryDamage(text)).toEqual({ stat: 'defense', pct: 30 });
        // The base damage is still the 170% multiplier, not the secondary tag.
        expect(parseSkillDamage(text)).toBe(170);
    });

    it('parses Nayra\'s charged "210% ... 30% of its defense" (lowercase defense)', () => {
        const text =
            'dealing <unit-damage>210%</unit-damage> and additional <unit-damage>damage equal to 30%</unit-damage> of its defense.';
        expect(parseSecondaryDamage(text)).toEqual({ stat: 'defense', pct: 30 });
    });

    it('parseSkillDamage still returns the primary multiplier for a secondary-damage skill', () => {
        expect(parseSkillDamage(chakara)).toBe(180);
        expect(parseSkillDamage(lodolite)).toBe(240);
    });
});

describe('parseConditionalDamage', () => {
    it('parses a tagged "additional X% ... for each adjacent ally" (Centurion)', () => {
        const text =
            'This Unit deals <unit-damage>100% damage</unit-damage> with an additional <unit-damage>20%</unit-damage> for each adjacent ally.';
        expect(parseConditionalDamage(text)).toEqual({
            pct: 20,
            condition: 'adjacent-ally',
            derivable: false,
        });
    });

    it('parses an untagged "plus an extra X% for each buff on the enemy" (Nuqtu)', () => {
        const text =
            'This Unit Deals <unit-damage>140% damage</unit-damage>, with additional damage equal to <unit-damage>80%</unit-damage> of its Defense plus an extra 30% for each buff on the enemy.';
        expect(parseConditionalDamage(text)).toEqual({
            pct: 30,
            condition: 'enemy-buff',
            derivable: false,
        });
        expect(parseSecondaryDamage(text)).toEqual({ stat: 'defense', pct: 80 });
    });

    it('marks "for each debuff on the enemy" as derivable', () => {
        const text =
            'This Unit deals <unit-damage>180% damage</unit-damage> with an additional <unit-damage>15%</unit-damage> for each debuff on the enemy.';
        expect(parseConditionalDamage(text)).toEqual({
            pct: 15,
            condition: 'enemy-debuff',
            derivable: true,
        });
    });

    it('marks "for each buff on this Unit" as derivable', () => {
        const text =
            'This Unit deals <unit-damage>100% damage</unit-damage>, increasing by an additional <unit-damage>25%</unit-damage> for each buff on this Unit.';
        expect(parseConditionalDamage(text)).toEqual({
            pct: 25,
            condition: 'self-buff',
            derivable: true,
        });
    });

    it('maps "Unit adjacent to the enemy" to enemy-adjacent', () => {
        const text =
            'This Unit deals <unit-damage>145% damage</unit-damage>, increasing by <unit-damage>30%</unit-damage> for each Unit adjacent to the enemy.';
        expect(parseConditionalDamage(text)).toEqual({
            pct: 30,
            condition: 'enemy-adjacent',
            derivable: false,
        });
    });

    it('captures a cap from "up to max of N%"', () => {
        // "additional damage" (not "more") is base-damage scaling; "more direct damage" is a modifier.
        const text =
            'This Unit deals an additional <unit-damage>20% damage</unit-damage> for each destroyed enemy, up to max of 100%.';
        expect(parseConditionalDamage(text)).toEqual({
            pct: 20,
            condition: 'enemy-destroyed',
            derivable: false,
            cap: 100,
        });
    });

    it('ignores repair/heal scaling ("repairs X% ... for each enemy destroyed")', () => {
        const text =
            'This Unit <unit-damage>repairs 60%</unit-damage> of its Max HP for each enemy Unit destroyed by the attack upon killing them.';
        expect(parseConditionalDamage(text)).toBeNull();
    });

    it('returns null when there is no "for each" conditional', () => {
        expect(
            parseConditionalDamage('This Unit deals <unit-damage>180% damage</unit-damage>.')
        ).toBeNull();
    });

    it('parses "when attacking a Supporter, it additionally deals X% damage" (Meiying active)', () => {
        const text =
            "This Unit's attack ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill>, dealing <unit-damage>190% damage</unit-damage>, and when attacking a Supporter, it additionally deals <unit-damage>90%</unit-damage> damage.";
        expect(parseConditionalDamage(text)).toEqual({
            pct: 90,
            condition: 'enemy-type',
            derivable: true,
            requiredEnemyType: 'Supporter',
        });
    });

    it('parses "when attacking a Supporter, it deals an additional X% damage" (Meiying charged)', () => {
        const text =
            'dealing <unit-damage>240% damage</unit-damage> and inflicting <unit-skill>Stasis</unit-skill> for 1 turn. When attacking a Supporter, it deals an additional <unit-damage>115%</unit-damage> damage.';
        expect(parseConditionalDamage(text)).toEqual({
            pct: 115,
            condition: 'enemy-type',
            derivable: true,
            requiredEnemyType: 'Supporter',
        });
    });

    it('does not capture the base multiplier as an enemy-type conditional', () => {
        // The 190% base is before the enemy-type clause and must not be picked up.
        const text =
            'This Unit deals <unit-damage>190% damage</unit-damage> when attacking a Defender, it additionally deals <unit-damage>40%</unit-damage> damage.';
        expect(parseConditionalDamage(text)).toEqual({
            pct: 40,
            condition: 'enemy-type',
            derivable: true,
            requiredEnemyType: 'Defender',
        });
    });

    it('returns null for empty input', () => {
        expect(parseConditionalDamage('')).toBeNull();
        expect(parseConditionalDamage(null)).toBeNull();
    });

    it('parses "if critical, additionally deals N% damage" as a self-crit bonus (Crucialis)', () => {
        const text =
            'This Unit deals <unit-damage>80% damage</unit-damage> and, if critical, additionally deals <unit-damage>75%</unit-damage> damage.';
        expect(parseConditionalDamage(text)).toEqual({
            pct: 75,
            condition: 'self-crit',
            derivable: true,
        });
    });

    it('does not treat "X% more direct damage for each Y" as base-damage scaling (Judge)', () => {
        // "more direct damage" is an outgoing-damage MODIFIER (parseModifiers), not base scaling.
        const text =
            'At the start of the round, this Unit deals <unit-damage>60% damage</unit-damage> to all enemies with less than 50% HP. This Unit deals <unit-damage>20% more direct damage</unit-damage> for each destroyed enemy, up to max of 100%.';
        expect(parseConditionalDamage(text)).toBeNull();
    });
});

describe('parseExtendDoT', () => {
    it('parses "extends active Damage Over Time effects by 1 turn" (Provider)', () => {
        const text =
            'This Unit deals <unit-damage>200% damage</unit-damage>, removes 1 charge from the enemy, and extends active Damage Over Time effects by 1 turn.';
        expect(parseExtendDoT(text)).toBe(1);
    });

    it('parses a multi-turn extension and the "(DoT)" abbreviation', () => {
        expect(parseExtendDoT('extends all Damage Over Time (DoT) effects by 2 turns.')).toBe(2);
    });

    it('returns null when there is no DoT extension', () => {
        expect(
            parseExtendDoT('This Unit deals <unit-damage>200% damage</unit-damage>.')
        ).toBeNull();
        expect(parseExtendDoT('')).toBeNull();
        expect(parseExtendDoT(null)).toBeNull();
    });

    it('does not match a debuff-duration extension that is not a DoT', () => {
        expect(parseExtendDoT('extends the duration of all buffs by 1 turn.')).toBeNull();
    });
});

describe('parseCritPowerExtend', () => {
    it('parses Valerian self-crit extension (chance = crit power)', () => {
        const text =
            'After inflicting <unit-skill>Corrosion</unit-skill> with a Critical hit, the duration of the newly applied Corrosion is extended by 1 turn, with the extension chance equal to the Critical Power.';
        expect(parseCritPowerExtend(text)).toEqual({
            turns: 1,
            condition: { subject: 'self-crit', derivable: true },
        });
    });

    it('parses Belladonna ally-triggered extension as ally-inflicts-debuff', () => {
        const text =
            'When an ally inflicts <unit-skill>Corrosion</unit-skill>, this Unit has a chance to convert it. Upon converting Corrosion, this Unit extends the newly applied Acidic Decay status for 1 turn, with the chance to equal to its crit power.';
        expect(parseCritPowerExtend(text)).toEqual({
            turns: 1,
            condition: { subject: 'ally-inflicts-debuff', derivable: false },
        });
    });

    it('returns null without a crit-power extension', () => {
        expect(
            parseCritPowerExtend('extends active Damage Over Time effects by 1 turn.')
        ).toBeNull();
        expect(parseCritPowerExtend('')).toBeNull();
    });
});

describe('parseAllyCritDot', () => {
    it('detects Crocus "ally inflicts a DoT with a critical hit"', () => {
        expect(
            parseAllyCritDot(
                'When another ally inflicts a Damage Over Time (DoT) effect with a critical hit, this Unit inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns.'
            )
        ).toBe(true);
    });

    it('returns false otherwise', () => {
        expect(parseAllyCritDot('When an ally inflicts a debuff, this Unit gains Stealth.')).toBe(
            false
        );
        expect(parseAllyCritDot('')).toBe(false);
    });
});

describe('parseDetonateDoT', () => {
    it('parses "detonates Inferno effects with 180% of their power" (Incinerator)', () => {
        const text =
            'This Unit deals <unit-damage>225% damage</unit-damage>, detonates Inferno effects with 180% of their power, and inflicts <unit-skill>Inferno III</unit-skill> for 3 turns.';
        expect(parseDetonateDoT(text)).toEqual({ dotType: 'inferno', powerPct: 180 });
    });

    it('parses "detonates Corrosion effects at 180% power" (Crocus)', () => {
        expect(
            parseDetonateDoT(
                'This Unit deals 250% damage and detonates Corrosion effects at 180% power.'
            )
        ).toEqual({ dotType: 'corrosion', powerPct: 180 });
    });

    it('parses "detonates Bomb effects with 150% of their power" (Demolisher)', () => {
        expect(
            parseDetonateDoT(
                'detonates Bomb effects with 150% of their power, and inflicts Bomb II.'
            )
        ).toEqual({ dotType: 'bomb', powerPct: 150 });
    });

    it('returns null when there is no detonation clause', () => {
        expect(parseDetonateDoT('This Unit deals 200% damage.')).toBeNull();
        expect(parseDetonateDoT('')).toBeNull();
        expect(parseDetonateDoT(null)).toBeNull();
    });
});

describe('parseAccumulateDetonate', () => {
    it('parses Echoing Burst with its duration (Valkyrie charged)', () => {
        const text =
            "This Unit's attack ignores Taunt and Provoke, deals <unit-damage>240% damage</unit-damage>, and inflicts <unit-skill>Inc. Damage Up II</unit-skill> and <unit-skill>Echoing Burst</unit-skill> for 2 turns.";
        expect(parseAccumulateDetonate(text)).toEqual({ turns: 2, pct: 100 });
    });

    it('defaults to 2 turns when no explicit duration follows the effect', () => {
        expect(parseAccumulateDetonate('This Unit applies Echoing Burst.')).toEqual({
            turns: 2,
            pct: 100,
        });
    });

    it('returns null when there is no accumulate-detonate effect', () => {
        expect(parseAccumulateDetonate('This Unit deals 200% damage.')).toBeNull();
        expect(parseAccumulateDetonate('')).toBeNull();
        expect(parseAccumulateDetonate(null)).toBeNull();
    });

    it('recognises known accumulate-detonate effect names', () => {
        expect(isAccumulateDetonateEffect('Echoing Burst')).toBe(true);
        expect(isAccumulateDetonateEffect('echoing burst')).toBe(true);
        expect(isAccumulateDetonateEffect('Inferno III')).toBe(false);
        expect(isAccumulateDetonateEffect(undefined)).toBe(false);
    });
});

describe('parseNoCrit', () => {
    it('detects "deals N% damage that cannot critically hit"', () => {
        expect(
            parseNoCrit('deals <unit-damage>200% damage</unit-damage> that cannot critically hit')
        ).toBe(true);
    });

    it('detects a separate "This attack cannot critically hit." sentence', () => {
        expect(
            parseNoCrit(
                'deals <unit-damage>40% damage</unit-damage> to that enemy. This attack cannot critically hit.'
            )
        ).toBe(true);
    });

    it('does not flag damage when only a repair cannot crit', () => {
        expect(
            parseNoCrit(
                'repairs allies for 7% of the damage dealt. This repair cannot critically hit.'
            )
        ).toBe(false);
    });

    it('does not flag damage when "the damage dealt" precedes a repair that cannot crit (Pallas)', () => {
        // "cannot critically hit" attaches to the repair, not the earlier "damage dealt".
        expect(
            parseNoCrit(
                'This Unit deals <unit-damage>200% damage</unit-damage>. The other ally with the lowest current health percentage heals for 20% of the damage dealt and this repair cannot critically hit.'
            )
        ).toBe(false);
    });

    it('returns false when there is no no-crit clause', () => {
        expect(parseNoCrit('This Unit deals <unit-damage>180% damage</unit-damage>.')).toBe(false);
        expect(parseNoCrit('')).toBe(false);
        expect(parseNoCrit(null)).toBe(false);
    });
});

describe('parseHpThresholdCondition', () => {
    it('detects "deals N% damage to enemies with less than 50% HP" (Judge)', () => {
        const text =
            'At the start of the round, this Unit deals <unit-damage>60% damage</unit-damage> to all enemies with less than 50% HP.';
        expect(parseHpThresholdCondition(text)).toEqual({ hpComparator: 'below', hpPercent: 50 });
    });

    it('detects an "above" threshold', () => {
        const text =
            'This Unit deals <unit-damage>80% damage</unit-damage> to enemies above 70% HP.';
        expect(parseHpThresholdCondition(text)).toEqual({ hpComparator: 'above', hpPercent: 70 });
    });

    it('does not match a damage-bonus phrasing (base damage stays ungated)', () => {
        // "increases Damage by 100% to enemies with less than 30% HP" is a separate bonus on a
        // ship with its own base damage — not a "deals N% damage to …" gate.
        const text =
            'This Unit deals <unit-damage>250% Damage</unit-damage> and increases Damage by 100% to enemies with less than 30% HP.';
        expect(parseHpThresholdCondition(text)).toBeNull();
    });

    it('returns null when there is no HP-gated damage clause', () => {
        expect(
            parseHpThresholdCondition('This Unit deals <unit-damage>180% damage</unit-damage>.')
        ).toBeNull();
        expect(parseHpThresholdCondition('')).toBeNull();
    });
});

describe('parseChargeGain', () => {
    it('parses always-true (speed) self gain — Chakara', () => {
        const text =
            'This Unit deals <unit-damage>180% damage</unit-damage>. If all damaged enemies have more Speed than this Unit, it <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.';
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'always',
            derivable: true,
        });
    });

    it('parses full-HP self gain as always-true — Cobalt', () => {
        const text =
            'This Unit <unit-aid>adds 1 charge</unit-aid> to its charged skill at the start of the turn if it is at full HP.';
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'always',
            derivable: true,
        });
    });

    it('parses enemy-buff threshold gain (manual) — Nuqtu', () => {
        const text =
            'If the target has 3 or more buffs, the Unit <unit-aid>gains 2 charges</unit-aid> to its Charged Skill.';
        expect(parseChargeGain(text)).toEqual({
            amount: 2,
            condition: 'enemy-buff',
            derivable: false,
        });
    });

    it('parses "equal to the number of buffs" per-buff gain — Rhodium', () => {
        const text =
            'Unit adds charges to the <unit-aid>Charged Skill</unit-aid> equal to the number of <unit-aid>Buffs</unit-aid> on the target.';
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'enemy-buff',
            derivable: false,
        });
    });

    it('parses enemy-type (Defender) gain and ignores the removal clause — Thresh', () => {
        const text =
            "If the target is a Defender, this Unit <unit-aid>removes 1 charge</unit-aid> from the enemy and <unit-aid>adds 1 charge</unit-aid> to this Unit's Charged Skill.";
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'enemy-type',
            derivable: true,
            requiredEnemyType: 'Defender',
        });
    });

    it('parses stealth condition as enemy-buff (manual) — Selenite', () => {
        const text =
            "If any target is <unit-aid>Stealthed</unit-aid>, it <unit-aid>adds 1 charge</unit-aid> to this Unit's Charged Skill.";
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'enemy-buff',
            derivable: false,
        });
    });

    it('parses "2 or more enemies" as enemy-adjacent (manual) — Tygr', () => {
        const text =
            'If it damages 2 or more enemies, it adds <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.';
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'enemy-adjacent',
            derivable: false,
        });
    });

    it('parses debuff-infliction as enemy-debuff (derivable) — Hemlock', () => {
        const text =
            'This Unit <unit-aid>gains 1 charge</unit-aid> to its charged skill after it inflicts a <unit-aid>debuff</unit-aid>.';
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'enemy-debuff',
            derivable: true,
        });
    });

    it('parses crit-based self gain as self-crit (derivable) — Asphodel', () => {
        const text =
            "This Unit's attacks are always critical and <unit-aid>adds 1 charge</unit-aid> to its Charged Skill after critically damaging an enemy.";
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'self-crit',
            derivable: true,
        });
    });

    it('returns null for enemy charge removal — Demolisher', () => {
        const text =
            "When a bomb explodes on an enemy, this unit removes 2 charges from the enemy's charged skill.";
        expect(parseChargeGain(text)).toBeNull();
    });

    it('returns null for on-kill gain — Valiant', () => {
        const text =
            'This Unit <unit-aid>gains 1 charge</unit-aid> for its Charged Skill upon killing an enemy.';
        expect(parseChargeGain(text)).toBeNull();
    });

    it('returns null for ally-grant — Liberator', () => {
        const text =
            'When an enemy dies, all allies <unit-aid>add 1 charge</unit-aid> to their Charged Skills.';
        expect(parseChargeGain(text)).toBeNull();
    });

    it('returns null when there is no charge phrase', () => {
        expect(
            parseChargeGain('This Unit deals <unit-damage>140% damage</unit-damage>.')
        ).toBeNull();
        expect(parseChargeGain('')).toBeNull();
        expect(parseChargeGain(null)).toBeNull();
    });
});

describe('parseAllSkillEffects', () => {
    it('returns [] for a ship with no skill text', () => {
        const ship = { activeSkillText: undefined, chargeSkillText: undefined } as unknown as Ship;
        expect(parseAllSkillEffects(ship)).toEqual([]);
    });

    it('combines effects from all five skill fields with correct source labels', () => {
        const ship = {
            activeSkillText:
                'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns',
            chargeSkillText: 'This Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn',
            firstPassiveSkillText: undefined,
            secondPassiveSkillText: undefined,
            thirdPassiveSkillText: undefined,
        } as unknown as Ship;
        const result = parseAllSkillEffects(ship);
        expect(result).toHaveLength(2);
        expect(result.find((e) => e.source === 'active')?.buffName).toBe('Defense Down II');
        expect(result.find((e) => e.source === 'charge')?.buffName).toBe('Attack Up III');
    });
});

describe('detectGrantConditions', () => {
    it('detects an enemy-type condition on a granted buff (Thresh charged)', () => {
        const text =
            'When targeting a <unit-skill>Defender</unit-skill>, this Unit gains <unit-skill>Crit Power Up II</unit-skill> for 1 turn.';
        expect(detectGrantConditions(text, 'Crit Power Up II')).toEqual([
            {
                subject: 'enemy-type',
                derivable: true,
                requiredEnemyType: 'Defender',
            },
        ]);
    });

    it('recognises "target is an Attacker" phrasing', () => {
        const text = 'If the target is an Attacker, this Unit gains Attack Up II for 2 turns.';
        expect(detectGrantConditions(text, 'Attack Up II')).toEqual([
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Attacker' },
        ]);
    });

    it('recognises "when damaging a Debuffer or Supporter" as two anyOf enemy-types', () => {
        const text =
            'When damaging a Debuffer or Supporter, this Unit gains <unit-skill>Stealth</unit-skill>.';
        expect(detectGrantConditions(text, 'Stealth')).toEqual([
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Debuffer', anyOf: true },
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Supporter', anyOf: true },
        ]);
    });

    it('recognises a self-crit condition ("if this critically hits")', () => {
        const text = 'If this Unit critically hits, adjacent allies gain Attack Up II.';
        expect(detectGrantConditions(text, 'Attack Up II')).toEqual([
            { subject: 'self-crit', derivable: true },
        ]);
    });

    it('classifies Taunt as enemy-buff and Provoke as self-debuff (anyOf)', () => {
        // Taunt is a buff on the enemy (targeting); Provoke is a debuff on this Unit (targeting).
        const text =
            'If this Unit is Provoked or Taunted, this Unit gains <unit-skill>Terran Guard III</unit-skill>.';
        expect(detectGrantConditions(text, 'Terran Guard III')).toEqual([
            { subject: 'enemy-buff', buffName: 'Taunt', derivable: false, anyOf: true },
            { subject: 'self-debuff', buffName: 'Provoke', derivable: false, anyOf: true },
        ]);
    });

    it('classifies "more than 3 Debuffs" as enemy-debuff gte 4 (Crocus)', () => {
        const text =
            'This Unit deals 150% Damage. If the target has more than 3 Debuffs, it inflicts <unit-skill>Stasis</unit-skill> for 2 turns.';
        expect(detectGrantConditions(text, 'Stasis')).toEqual([
            { subject: 'enemy-debuff', derivable: true, countComparator: 'gte', countThreshold: 4 },
        ]);
    });

    it('scopes the count gate to its own sentence when an abbreviated buff name has an internal period (Asphyxiator)', () => {
        const text =
            'This Unit inflicts <unit-skill>Inc. DoT Damage Up III</unit-skill> for 2 turns, deals <unit-damage>215% damage</unit-damage>, and inflicts <unit-skill>Inferno III</unit-skill> for 3 turns. If the targeted enemy or adjacent enemies have 3 or more debuffs, it inflicts <unit-skill>Stasis</unit-skill> for 2 turns on the targeted enemy and all enemies adjacent to the enemy.';
        // "Inc. DoT Damage Up III" is inflicted unconditionally — the "3 or more debuffs"
        // gate belongs to the separate Stasis sentence and must not leak onto it.
        expect(detectGrantConditions(text, 'Inc. DoT Damage Up III')).toEqual([]);
        // Stasis keeps the count-threshold gate from its own sentence.
        expect(detectGrantConditions(text, 'Stasis')).toEqual([
            { subject: 'enemy-debuff', derivable: true, countComparator: 'gte', countThreshold: 3 },
        ]);
    });

    it('gates a buff on "if <Ally> is on the same team" as a roster condition (Nayra)', () => {
        // p2 form: Defensive (unconditional) and Offensive (Isha-gated) in separate sentences.
        const text =
            'At the start of the round, this Unit gains <unit-skill>Defensive Affinity Override</unit-skill>. If Isha is on the same team, this Unit also gains <unit-skill>Offensive Affinity Override</unit-skill>.';
        expect(detectGrantConditions(text, 'Offensive Affinity Override')).toEqual([
            { subject: 'ally-on-team', derivable: false, buffName: 'Isha' },
        ]);
        expect(detectGrantConditions(text, 'Defensive Affinity Override')).toEqual([]);
    });

    it('scopes the team gate to the buff after it within one sentence (Nayra p1)', () => {
        // p1 form: both buffs in ONE sentence — the gate must attach only to Offensive.
        const text =
            'This Unit gains <unit-skill>Defensive Affinity Override</unit-skill> at the start of the round, and if Isha is on the same team, it also gains <unit-skill>Offensive Affinity Override</unit-skill>.';
        expect(detectGrantConditions(text, 'Offensive Affinity Override')).toEqual([
            { subject: 'ally-on-team', derivable: false, buffName: 'Isha' },
        ]);
        expect(detectGrantConditions(text, 'Defensive Affinity Override')).toEqual([]);
    });

    it('classifies "3 or more buffs" on the target as enemy-buff gte 3 (Nuqtu)', () => {
        const text =
            'If the target has 3 or more buffs, the Unit gains <unit-skill>Core Charge I</unit-skill>.';
        expect(detectGrantConditions(text, 'Core Charge I')).toEqual([
            { subject: 'enemy-buff', derivable: true, countComparator: 'gte', countThreshold: 3 },
        ]);
    });

    it('classifies "this Unit has no debuffs" as self-debuff eq 0 (Sustainer)', () => {
        const text =
            'At the start of the round, if this Unit has no debuffs, it gains <unit-skill>Out</unit-skill>.';
        expect(detectGrantConditions(text, 'Out')).toEqual([
            { subject: 'self-debuff', derivable: true, countComparator: 'eq', countThreshold: 0 },
        ]);
    });

    it('returns [] for an unconditional grant', () => {
        const text = 'This Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn.';
        expect(detectGrantConditions(text, 'Attack Up III')).toEqual([]);
    });

    it('classifies "when Damaging a Debuffed enemy" as an enemy-debuff presence gate (Sha Xing)', () => {
        const text =
            'This Unit gains <unit-skill>Stealth</unit-skill> for 2 turns when damaging a Debuffer or Supporter. Additionally, when Damaging a Debuffed enemy, it gains <unit-skill>Tianchao Precision II</unit-skill> for 3 turns.';
        expect(detectGrantConditions(text, 'Tianchao Precision II')).toEqual([
            { subject: 'enemy-debuff', derivable: true },
        ]);
        // The other granted buff in the same skill keeps its own enemy-type gate.
        expect(detectGrantConditions(text, 'Stealth')).toEqual([
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Debuffer', anyOf: true },
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Supporter', anyOf: true },
        ]);
    });

    it('recognises "against a Debuffed target" phrasing', () => {
        const text = 'Against a Debuffed target, this Unit gains Crit Power Up II for 2 turns.';
        expect(detectGrantConditions(text, 'Crit Power Up II')).toEqual([
            { subject: 'enemy-debuff', derivable: true },
        ]);
    });

    it('classifies "When targeting non-Defenders" as a negated enemy-type gate (Lodolite)', () => {
        const text =
            'When targeting non-Defenders, apply <unit-skill>Concentrate Fire</unit-skill> for 2 turns.';
        expect(detectGrantConditions(text, 'Concentrate Fire')).toEqual([
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender', negate: true },
        ]);
    });

    it('classifies "if it is at full HP" as a self HP-threshold gate (Cobalt)', () => {
        const text =
            'This Unit gains <unit-skill>Out. Damage Up II</unit-skill> for 1 turn at the start of the turn if it is at full HP.';
        expect(detectGrantConditions(text, 'Out. Damage Up II')).toEqual([
            {
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: 'above',
                hpPercent: 99,
                hpSubject: 'self',
            },
        ]);
    });

    it('gates only the conditional buff, not a recurring per-turn grant in the same sentence (Shashou)', () => {
        const text =
            'This Unit gains <unit-skill>Stealth</unit-skill> for 3 turns after damaging a Debuffer or Supporter and gains 1 stack of <unit-skill>Blast</unit-skill> each turn.';
        expect(detectGrantConditions(text, 'Stealth')).toEqual([
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Debuffer', anyOf: true },
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Supporter', anyOf: true },
        ]);
        // "gains 1 stack of Blast each turn" is recurring/unconditional — no enemy-type gate.
        expect(detectGrantConditions(text, 'Blast')).toEqual([]);
    });

    it('recognises "when attacking a Defender" as an enemy-type gate (IonScorp)', () => {
        const text =
            'This Unit deals <unit-damage>190% damage</unit-damage>, but when attacking a Defender, it deals <unit-damage>200% damage</unit-damage> and inflicts <unit-skill>Disable</unit-skill> for 1 turn.';
        expect(detectGrantConditions(text, 'Disable')).toEqual([
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
        ]);
    });

    it('classifies "after dealing damage to an enemy with 2 or more debuffs" as enemy-debuff gte 2 (Bayah)', () => {
        const text =
            'This Unit gains <unit-skill>Terran Bolster II</unit-skill> and inflicts <unit-skill>Speed Down II</unit-skill> on an enemy for 2 turns after dealing damage to an enemy with 2 or more debuffs.';
        expect(detectGrantConditions(text, 'Terran Bolster II')).toEqual([
            { subject: 'enemy-debuff', derivable: true, countComparator: 'gte', countThreshold: 2 },
        ]);
    });

    it('classifies "After dealing Damage to an enemy with more than 2 Debuffs" as enemy-debuff gte 3 (Bizon)', () => {
        const text =
            'After dealing Damage to an enemy with more than 2 Debuffs, this Unit inflicts <unit-skill>Block Buff</unit-skill> for 1 turn.';
        expect(detectGrantConditions(text, 'Block Buff')).toEqual([
            { subject: 'enemy-debuff', derivable: true, countComparator: 'gte', countThreshold: 3 },
        ]);
    });

    it('classifies "when applying a debuff" as an enemy-debuff presence gate (Yuyan)', () => {
        const text =
            'This Unit gains <unit-skill>Stealth</unit-skill> for 2 turns and <unit-skill>Tianchao Precision II</unit-skill> for 3 turns when applying a debuff.';
        expect(detectGrantConditions(text, 'Stealth')).toEqual([
            { subject: 'enemy-debuff', derivable: true },
        ]);
        expect(detectGrantConditions(text, 'Tianchao Precision II')).toEqual([
            { subject: 'enemy-debuff', derivable: true },
        ]);
    });

    it('classifies "On inflicting a debuff" as an enemy-debuff presence gate (Marauder)', () => {
        const text =
            'On inflicting a debuff, this Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns.';
        expect(detectGrantConditions(text, 'Marauder Rage II')).toEqual([
            { subject: 'enemy-debuff', derivable: true },
        ]);
    });

    it('classifies "when another ally inflicts a debuff" as a manual ally-inflicts-debuff gate (Provider)', () => {
        const text =
            'When another ally inflicts a debuff onto an enemy, this unit deals 50% damage to that enemy that cannot critically hit and inflict <unit-skill>Crit Rate Down II</unit-skill> for 1 turn.';
        expect(detectGrantConditions(text, 'Crit Rate Down II')).toEqual([
            { subject: 'ally-inflicts-debuff', derivable: false },
        ]);
    });

    it('classifies "after an ally is critically repaired" as a manual gate (Pallas)', () => {
        const text =
            'This Unit gains <unit-skill>Attack Up II</unit-skill> and <unit-skill>Leech II</unit-skill> for 1 turn after an ally is critically repaired.';
        expect(detectGrantConditions(text, 'Attack Up II')).toEqual([
            { subject: 'ally-critically-repaired', derivable: false },
        ]);
        expect(detectGrantConditions(text, 'Leech II')).toEqual([
            { subject: 'ally-critically-repaired', derivable: false },
        ]);
    });

    it('does not classify a reactive "when critically hit" clause', () => {
        const text = 'When this Unit is critically hit, it gains Attack Up II.';
        expect(detectGrantConditions(text, 'Attack Up II')).toEqual([]);
    });

    it('is clause-scoped: only the conditional buff gets the condition', () => {
        const text =
            'This Unit gains Attack Up II for 2 turns. When targeting a Defender, this Unit gains Crit Power Up II for 1 turn.';
        expect(detectGrantConditions(text, 'Attack Up II')).toEqual([]);
        expect(detectGrantConditions(text, 'Crit Power Up II')).toEqual([
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
        ]);
    });
});
