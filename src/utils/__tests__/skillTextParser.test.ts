import { describe, it, expect } from 'vitest';
import {
    parseSkillDamage,
    detectFullyCharged,
    parseSkillEffects,
    parseAllSkillEffects,
    parseSecondaryDamage,
    parseConditionalDamage,
    parseChargeGain,
    parseAllyChargeGrant,
    detectGrantConditions,
    parseHpThresholdCondition,
    parseExtendDoT,
    parseCritPowerExtend,
    parseAllyCritDot,
    parseNoCrit,
    parseDetonateDoT,
    parseAccumulateDetonate,
    isAccumulateDetonateEffect,
    detectReactiveTrigger,
    detectDamageReactionTrigger,
    detectHpCrossingTrigger,
    detectTargetHpGate,
    detectCritRepairTrigger,
    detectAllyCritTrigger,
    detectDestroyedTrigger,
    detectEnemyCleanseTrigger,
    detectEnemyPurgedTrigger,
    detectAllyPurgedTrigger,
    detectEndOfRoundPurgeTrigger,
    detectKilledByDirectDamageTrigger,
    detectMostBuffsTarget,
    detectRepairedThisRoundCondition,
    parseExtraAction,
    parseHealAbilities,
    parseCleanse,
    parsePurge,
    parseHealNoCrit,
    statusEffectCondition,
    parseControlInflicts,
    detectIgnoresForcedTargeting,
    parseDoesntBreakStasis,
    parseChargeRemoval,
    parseEnemyChargedCastReaction,
    parseCounterAbilities,
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

    it('parses a receiver-less grant → all-allies (verb-aware routing rule)', () => {
        // CHANGED (live-verification fix): "This Unit grants X" with NO explicit receiver is a
        // BESTOWING verb that confers the buff on the team, not the caster. Previously misclassified
        // 'self' because of the "This Unit" subject anchor; under the locked routing rule a
        // receiver-less grant goes to all players. (Attacker-only sims fold self/all-allies, so the
        // attacker still benefits — this only changes how the engine walks a team ship's grants.)
        expect(
            parseSkillEffects(
                'This Unit grants <unit-skill>Hacking Up III</unit-skill> for 2 turns',
                'active'
            )
        ).toEqual([
            { buffName: 'Hacking Up III', target: 'all-allies', duration: 2, source: 'active' },
        ]);
    });

    it('routes Oleander charge form ("grants Hacking Up III … repairs its Max HP") to all-allies', () => {
        // Live regression: team Oleander's "This Unit grants Hacking Up III for 2 turns and
        // repairs 100% of its Max HP …" stayed on Oleander and never reached the attacker.
        // Receiver-less grant → all-allies. The repair clause carries no unit-skill so only the
        // buff is asserted here.
        expect(
            parseSkillEffects(
                'This Unit grants <unit-skill>Hacking Up III</unit-skill> for 2 turns and repairs 100% of its Max HP, with an additional 8.5% repair for each debuffed enemy.',
                'active'
            )
        ).toEqual([
            { buffName: 'Hacking Up III', target: 'all-allies', duration: 2, source: 'active' },
        ]);
    });

    it('routes a multi-buff second-clause grant to all-allies per buff (Oleander charge)', () => {
        // Oleander charge: "grants Repair Over Time II for 2 turns and, for 3 turns, grants both
        // Out. DoT Damage Up II and Hit Mitigation." Two separate "grants" verbs, none with a
        // receiver → every buff routes all-allies. The masked "Out." period must not split the
        // sentence (resolveBuffClause masking) and the second grant's buffs must not inherit a
        // (non-existent) receiver from the first.
        expect(
            parseSkillEffects(
                'This Unit grants <unit-skill>Repair Over Time II</unit-skill> for 2 turns and, for 3 turns, grants both <unit-skill>Out. DoT Damage Up II</unit-skill> and <unit-skill>Hit Mitigation</unit-skill>.',
                'charge'
            )
        ).toEqual([
            {
                buffName: 'Repair Over Time II',
                target: 'all-allies',
                duration: 2,
                source: 'charge',
            },
            {
                buffName: 'Out. DoT Damage Up II',
                target: 'all-allies',
                // NOTE: the "for 3 turns" sits BEFORE the second grant verb ("and, for 3 turns,
                // grants both …") so the forward-only duration scanner doesn't attach it — duration
                // is null here. That is an existing/orthogonal duration-parsing limitation; this
                // test asserts SCOPE (all-allies per buff), so it documents the actual duration.
                duration: null,
                source: 'charge',
            },
            { buffName: 'Hit Mitigation', target: 'all-allies', duration: null, source: 'charge' },
        ]);
    });

    it('routes a combined "itself and all adjacent allies" grant to all-allies (Tormenter)', () => {
        // Tormenter: "grants Out. Damage Up I to itself and all adjacent allies for 1 turn." The
        // receiver names BOTH itself and the team — team-wide wins, so "itself" must NOT short-circuit
        // to self. (Was already all-allies before the verb-aware change via the "allies" match;
        // this locks that the new self-receiver branch doesn't regress it.)
        expect(
            parseSkillEffects(
                'This Unit deals 160% damage with a guaranteed critical hit and grants <unit-skill>Out. Damage Up I</unit-skill> to itself and all adjacent allies for 1 turn.',
                'active'
            )
        ).toEqual([
            { buffName: 'Out. Damage Up I', target: 'all-allies', duration: 1, source: 'active' },
        ]);
    });

    it('classifies "grants itself X" as self (Nuqtu — explicit self receiver)', () => {
        // The one corpus "grants itself" form (Nuqtu's End Of Round Action). An explicit "itself"
        // receiver pins a bestowing grant back to the caster, overriding the receiver-less default.
        expect(
            parseSkillEffects(
                'This Unit grants itself <unit-skill>Overload III</unit-skill> for 2 turns',
                'charge'
            )
        ).toEqual([{ buffName: 'Overload III', target: 'self', duration: 2, source: 'charge' }]);
    });

    it('classifies "all allies gain Attack Up" as all-allies target', () => {
        expect(
            parseSkillEffects(
                'all allies gain <unit-skill>Attack Up III</unit-skill> for 2 turns',
                'active'
            )
        ).toEqual([
            { buffName: 'Attack Up III', target: 'all-allies', duration: 2, source: 'active' },
        ]);
    });

    it('classifies "allies gain X" (unscoped plural) as all-allies', () => {
        expect(
            parseSkillEffects(
                'This Unit grants allies <unit-skill>Defense Up II</unit-skill> for 1 turn',
                'active'
            )
        ).toEqual([
            { buffName: 'Defense Up II', target: 'all-allies', duration: 1, source: 'active' },
        ]);
    });

    it('classifies "friendly units gain X" as all-allies', () => {
        expect(
            parseSkillEffects(
                'Friendly units gain <unit-skill>Crit Power Up III</unit-skill> for 2 turns',
                'active'
            )
        ).toEqual([
            { buffName: 'Crit Power Up III', target: 'all-allies', duration: 2, source: 'active' },
        ]);
    });

    it('classifies "This Unit gains Attack Up" as self', () => {
        expect(
            parseSkillEffects(
                'This Unit gains <unit-skill>Attack Up III</unit-skill> for 2 turns',
                'active'
            )
        ).toEqual([{ buffName: 'Attack Up III', target: 'self', duration: 2, source: 'active' }]);
    });

    it('classifies "the ally with the highest Attack gains X" as ally', () => {
        expect(
            parseSkillEffects(
                'This Unit grants the ally with the highest Attack <unit-skill>Attack Up III</unit-skill> for 2 turns',
                'active'
            )
        ).toEqual([{ buffName: 'Attack Up III', target: 'ally', duration: 2, source: 'active' }]);
    });

    it('classifies "the other ally with …" as ally (forward-proofing "the other ally" heal/buff form)', () => {
        // Corpus uses "the other ally with the lowest current health percentage" for heals/triggers
        // (e.g. Yorn passive). This test locks the buff-grant variant so SINGLE_ALLY_RE's
        // "the (?:other )?ally" branch is covered and can't regress silently.
        expect(
            parseSkillEffects(
                'This Unit grants the other ally with the lowest HP <unit-skill>Defense Up II</unit-skill> for 2 turns',
                'passive1'
            )
        ).toEqual([{ buffName: 'Defense Up II', target: 'ally', duration: 2, source: 'passive1' }]);
    });

    it('classifies "grants them 1 stack" as ally (Howler — receiver from context)', () => {
        expect(
            parseSkillEffects(
                'This Unit <unit-aid>cleanses 1</unit-aid> debuff from an ally and grants them 1 stack of <unit-skill>Blast</unit-skill> when that ally crits an enemy',
                'passive1'
            )
        ).toEqual([
            {
                buffName: 'Blast',
                target: 'ally',
                duration: 'recurring',
                source: 'passive1',
                stacks: 1,
                stackTrigger: 'per-round',
            },
        ]);
    });

    it('classifies a trailing-condition self grant as self (Pallas — "an ally" is the trigger)', () => {
        expect(
            parseSkillEffects(
                'This Unit gains <unit-skill>Attack Up II</unit-skill> for 2 turns after an ally is critically repaired',
                'passive1'
            )
        ).toEqual([{ buffName: 'Attack Up II', target: 'self', duration: 2, source: 'passive1' }]);
    });

    it('routes a leading-condition receiver-less grant to all-allies (Refine — judgment call)', () => {
        // JUDGMENT CALL (verb-aware rule): the leading "When an ally is directly damaged," condition
        // is stripped, leaving "this Unit grants Inc. Damage Down I for 1 turn" — a BESTOWING grant
        // with NO explicit receiver → all-allies. The prior 'self' expectation was made under the
        // old verb-blind rule (where 'ally' would have routed the buff AWAY from the caster entirely,
        // hence the conservative self call). With grants→all-allies the caster ALSO receives it, which
        // is strictly more accurate for a damage-reaction protective buff (Inc. Damage Down = reduced
        // incoming damage) that plausibly shields the whole team. Per the locked routing rule.
        expect(
            parseSkillEffects(
                'When an ally is directly damaged, this Unit grants <unit-skill>Inc. Damage Down I</unit-skill> for 1 turn',
                'passive1'
            )
        ).toEqual([
            {
                buffName: 'Inc. Damage Down I',
                target: 'all-allies',
                duration: 1,
                source: 'passive1',
            },
        ]);
    });

    it('routes a trailing-when receiver-less grant to all-allies (AEGIS — judgment call)', () => {
        // JUDGMENT CALL (verb-aware rule): the trailing "when an ally … has their shield destroyed"
        // condition is stripped, leaving "this Unit grants Defense Up II for 1 turn" — a BESTOWING
        // grant with NO explicit receiver → all-allies. Same reasoning as Refine: a protective
        // Defense Up reacting to an ally event is strictly more accurately team-wide (caster
        // included) than self-only under the old conservative call.
        expect(
            parseSkillEffects(
                'This Unit grants <unit-skill>Defense Up II</unit-skill> for 1 turn when an ally within the Active pattern has their shield destroyed',
                'passive1'
            )
        ).toEqual([
            { buffName: 'Defense Up II', target: 'all-allies', duration: 1, source: 'passive1' },
        ]);
    });

    it('classifies a post-condition ally receiver as ally (condition strip preserves real receiver)', () => {
        expect(
            parseSkillEffects(
                'When an ally attacker or debuffer is directly damaged, this Unit grants the ally <unit-skill>Repair Over Time III</unit-skill> for 2 turns',
                'passive1'
            )
        ).toEqual([
            { buffName: 'Repair Over Time III', target: 'ally', duration: 2, source: 'passive1' },
        ]);
    });

    it('keeps enemy-targeted debuffs enemy', () => {
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

    it('parses "granted" (passive voice) as a player-side buff with all-allies scope', () => {
        const result = parseSkillEffects(
            '(All) allies are granted <unit-skill>Attack Up III</unit-skill> for 2 turns and <unit-skill>Speed Up III</unit-skill> for 2 turns.',
            'active'
        );
        expect(result).toHaveLength(2);
        // "(All) allies are granted …" is genuinely team-wide, so each grant carries all-allies
        // scope (previously collapsed to 'self' under the binary self/enemy parser).
        expect(result[0]).toMatchObject({
            buffName: 'Attack Up III',
            target: 'all-allies',
            duration: 2,
            source: 'active',
        });
        expect(result[1]).toMatchObject({
            buffName: 'Speed Up III',
            target: 'all-allies',
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

    it('does not treat a tagged "Shield equal to N% of its Max HP" as secondary damage (FrontLine)', () => {
        const text =
            'This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.';
        expect(parseSecondaryDamage(text)).toBeNull();
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

    it('Provider-style extend has no inflicted scope (parseCritPowerExtend returns active)', () => {
        // Provider's extend-all clause must NOT carry the 'inflicted' scope: it has no
        // crit-power chance, so parseCritPowerExtend returns null and the ability stays
        // scope 'active' via parseExtendDoT.
        const text =
            'This Unit deals <unit-damage>200% damage</unit-damage>, removes 1 charge from the enemy, and extends active Damage Over Time effects by 1 turn.';
        expect(parseCritPowerExtend(text)).toBeNull();
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
    it('parses Valerian self-crit extension with inflicted scope (chance = crit power)', () => {
        // Valerian's EXACT refit-active third passive text (docs/ship-skills.csv).
        const text =
            'This Unit <unit-damage>repairs 15%</unit-damage> of damage dealt to an enemy, including damage from damage over time effects. After inflicting <unit-skill>Corrosion</unit-skill> with a Critical hit, the duration of the newly applied <unit-skill>Corrosion</unit-skill> is extended by 1 turn, with the extension chance equal to the Critical Power.';
        expect(parseCritPowerExtend(text)).toEqual({
            turns: 1,
            condition: { subject: 'self-crit', derivable: true },
            scope: 'inflicted',
        });
    });

    it('parses Belladonna ally-triggered extension as ally-inflicts-debuff (inflicted scope)', () => {
        const text =
            'When an ally inflicts <unit-skill>Corrosion</unit-skill>, this Unit has a chance to convert it. Upon converting Corrosion, this Unit extends the newly applied Acidic Decay status for 1 turn, with the chance to equal to its crit power.';
        expect(parseCritPowerExtend(text)).toEqual({
            turns: 1,
            condition: { subject: 'ally-inflicts-debuff', derivable: false },
            scope: 'inflicted',
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

describe('parser false-positive guards', () => {
    it('heal "additional X% of Max HP" is not secondary damage (Morao p2)', () => {
        expect(
            parseSecondaryDamage(
                'This Unit <unit-damage>repairs 5%</unit-damage> of its Max HP every turn and, upon <unit-aid>Cleansing a</unit-aid> Debuff, repairs an additional <unit-damage>5%</unit-damage> of its Max HP while gaining <unit-skill>Defense Up II</unit-skill> for 2 turns.'
            )
        ).toBeNull();
    });

    it('on-resist proc is not secondary damage (Vindicator p2)', () => {
        expect(
            parseSecondaryDamage(
                "This Unit has 20% Shield Penetration. At the start of combat, this Unit gains <unit-skill>Magnetized Shielding</unit-skill>.<br /><br />When this Unit resists a debuff infliction from an enemy, it deals <unit-damage>damage equal to 30%</unit-damage> of this Unit's max HP to that enemy."
            )
        ).toBeNull();
    });

    it('on-death proc is not secondary damage (Paracelsus p1)', () => {
        expect(
            parseSecondaryDamage(
                'Upon being killed by direct Damage, this Unit deals <unit-damage>Damage equal to 50%</unit-damage> of its max HP.'
            )
        ).toBeNull();
    });

    it('burst-explosion reference is not an accumulate-detonate application (Valkyrie p1)', () => {
        expect(
            parseAccumulateDetonate(
                'This Unit gains <unit-skill>Speed Up II</unit-skill> for 1 turn at the start of the round.<br /><br />When an <unit-aid>Echoing Burst</unit-aid> explodes on an enemy, this Unit and the ally with the lowest current health percentage <unit-damage>repair 5%</unit-damage> of damage dealt.'
            )
        ).toBeNull();
    });

    // Regression locks:
    it('regression: defense secondary still parses (Chakara active)', () => {
        expect(
            parseSecondaryDamage(
                'This Unit deals <unit-damage>180% damage</unit-damage> with additional damage equal to <unit-damage>80%</unit-damage> of its Defense. If all damaged enemies have more Speed than this Unit, it <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.'
            )
        ).toEqual({ stat: 'defense', pct: 80 });
    });

    it('regression: Echoing Burst infliction still parses (Valkyrie charged)', () => {
        expect(
            parseAccumulateDetonate(
                "This Unit's attack ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill>, deals <unit-damage>240% damage</unit-damage>, and inflicts <unit-skill>Inc. Damage Up II</unit-skill> and <unit-skill>Echoing Burst</unit-skill> for 2 turns."
            )
        ).toEqual({ turns: 2, pct: 100 });
    });

    it('a CONDITIONAL infliction ("When X happens, inflicts Echoing Burst") still parses', () => {
        // No such ship text exists today — locks the guard's narrowness: only the full
        // when…<name>…explodes reference shape is skipped, not any "when" lead-in.
        expect(
            parseAccumulateDetonate(
                'When this Unit critically hits, it inflicts <unit-skill>Echoing Burst</unit-skill> for 2 turns.'
            )
        ).toEqual({ turns: 2, pct: 100 });
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

    it('parses start-of-turn full-HP self gain as start-of-turn + hp-threshold gate — Cobalt 1st passive', () => {
        const text =
            'This Unit <unit-aid>adds 1 charge</unit-aid> to its charged skill at the start of the turn if it is at full HP.';
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'always',
            derivable: true,
            trigger: 'start-of-turn',
            conditions: [
                {
                    subject: 'hp-threshold',
                    derivable: true,
                    hpComparator: 'above',
                    hpPercent: 99,
                    hpSubject: 'self',
                },
            ],
        });
    });

    it('parses start-of-turn full-HP self gain (with separate buff clause) — Cobalt 2nd passive', () => {
        const text =
            'This Unit <unit-aid>adds 1 charge</unit-aid> to its charged skill and gains <unit-aid>Out. Damage Up II</unit-aid> for 1 turn at the start of the turn if it is at full HP.';
        expect(parseChargeGain(text)).toMatchObject({
            amount: 1,
            trigger: 'start-of-turn',
            conditions: [{ subject: 'hp-threshold' }],
        });
    });

    it('parses "each turn" phrasing as start-of-turn trigger (widened regex)', () => {
        const text =
            'This Unit <unit-aid>adds 1 charge</unit-aid> to its charged skill at the start of each turn if it is at full HP.';
        expect(parseChargeGain(text)).toMatchObject({
            amount: 1,
            trigger: 'start-of-turn',
            conditions: [{ subject: 'hp-threshold' }],
        });
    });

    it('leaves a plain unconditional self-charge unchanged (no trigger) — regression', () => {
        const result = parseChargeGain(
            'This Unit <unit-aid>adds 1 charge</unit-aid> to its charged skill.'
        );
        expect(result?.trigger).toBeUndefined();
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

    it('parses self debuff-infliction as on-debuff-inflicted trigger (no enemy-debuff condition) — Hemlock', () => {
        const text =
            'This Unit <unit-aid>gains 1 charge</unit-aid> to its charged skill after it inflicts a <unit-aid>debuff</unit-aid>.';
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'always',
            derivable: true,
            trigger: 'on-debuff-inflicted',
        });
    });

    it('parses ally debuff-infliction as on-ally-debuff-inflicted trigger — Oleander', () => {
        const text =
            "When an ally inflicts a debuff, this Unit <unit-aid>adds 1 charge</unit-aid> to it's Charged Skill.";
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'always',
            derivable: true,
            trigger: 'on-ally-debuff-inflicted',
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

    it('parses enemy-repair self gain as on-enemy-repaired trigger — Zosimos', () => {
        const text =
            'When an enemy repairs, this Unit <unit-aid>gains a charge</unit-aid> to its Charged Skill.';
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'always',
            derivable: true,
            trigger: 'on-enemy-repaired',
        });
    });

    it('parses "performs a repairs" enemy-repair phrasing (refit, source typo) as on-enemy-repaired — Zosimos refit', () => {
        const text =
            "When an enemy performs a repairs, this Unit <unit-aid>gains a charge</unit-aid> to its Charged Skill.<br /><br />Additionally, this Unit decrease that enemy's charge by one for every second repair they perform.";
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'always',
            derivable: true,
            trigger: 'on-enemy-repaired',
        });
    });

    it('still returns null for "when an enemy dies" on-kill ally charge — Liberator (death routing unchanged)', () => {
        const text =
            'When an enemy dies, this unit <unit-aid>grants 1 charge</unit-aid> to all allies.';
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

describe('parseAllyChargeGrant', () => {
    it('parses Hayyan on-cast all-allies grant (no condition)', () => {
        const text =
            'This Unit <unit-damage>repairs 17%</unit-damage> of its Max HP, grants <unit-skill>Cheat Death</unit-skill> to all allies, and <unit-aid>adds 1 charge</unit-aid> to their Charged Skill.';
        expect(parseAllyChargeGrant(text)).toEqual({
            amount: 1,
            trigger: 'on-cast',
        });
    });

    it('parses Graphite start-of-round all-allies grant (amount 2) with enemy-Stealth condition', () => {
        const text =
            'At the start of the round, if an enemy Unit has <unit-skill>Stealth</unit-skill>, this Unit <unit-aid>adds 2 charges</unit-aid> to the charged skill of all allies within the active pattern.';
        expect(parseAllyChargeGrant(text)).toEqual({
            amount: 2,
            trigger: 'start-of-round',
            conditions: [{ subject: 'enemy-buff', buffName: 'Stealth', derivable: true }],
        });
    });

    it('tolerates the plural-with-1 CSV typo "adds 1 charges" — Graphite R-tier', () => {
        const text =
            'At the start of the round, if an enemy Unit has <unit-skill>Stealth</unit-skill>, this Unit <unit-aid>adds 1 charges</unit-aid> to the charged skill of all allies within the active pattern.';
        expect(parseAllyChargeGrant(text)).toEqual({
            amount: 1,
            trigger: 'start-of-round',
            conditions: [{ subject: 'enemy-buff', buffName: 'Stealth', derivable: true }],
        });
    });

    it('returns null for a self-charge add (self-charge lock — Hermes/Asphodel/Chakara/Cobalt)', () => {
        expect(parseAllyChargeGrant('adds 1 charge to its Charged Skill')).toBeNull();
    });

    it('returns null when there is no ally-charge phrase', () => {
        expect(
            parseAllyChargeGrant('This Unit deals <unit-damage>140% damage</unit-damage>.')
        ).toBeNull();
        expect(parseAllyChargeGrant('')).toBeNull();
        expect(parseAllyChargeGrant(null)).toBeNull();
    });
});

describe('detectReactiveTrigger', () => {
    it('classifies a crit-inflicted debuff as on-crit (no self-crit condition) — Enforcer', () => {
        const text =
            'When this Unit critically hits an enemy it inflicts <unit-skill>Defense Shred</unit-skill> for 3 turns.';
        expect(detectReactiveTrigger(text, 'Defense Shred')).toBe('on-crit');
    });

    it('classifies a crit-damaging self-buff as on-crit — Wusheng', () => {
        const text =
            'This Unit gains <unit-skill>Stealth</unit-skill> for 1 turn after critically damaging an enemy.';
        expect(detectReactiveTrigger(text, 'Stealth')).toBe('on-crit');
    });

    it('classifies a start-of-round self-buff as start-of-round — Valkyrie', () => {
        const text =
            'This Unit gains <unit-skill>Speed Up II</unit-skill> for 1 turn at the start of the round.';
        expect(detectReactiveTrigger(text, 'Speed Up II')).toBe('start-of-round');
    });

    it('classifies a bomb-detonate self-buff as on-bomb-detonated — Lingshe', () => {
        const text =
            'When this Unit detonates a <unit-skill>Bomb</unit-skill> it gains <unit-skill>Stealth</unit-skill> for 1 turn.';
        expect(detectReactiveTrigger(text, 'Stealth')).toBe('on-bomb-detonated');
    });

    it('does NOT classify passive-voice "is critically damaged" as on-crit', () => {
        const text =
            'When this Unit is critically damaged, it gains <unit-skill>Stealth</unit-skill>.';
        expect(detectReactiveTrigger(text, 'Stealth')).toBeUndefined();
    });

    it('does NOT classify passive-voice "is critically hit" as on-crit', () => {
        const text = 'When this Unit is critically hit, it gains <unit-skill>Stealth</unit-skill>.';
        expect(detectReactiveTrigger(text, 'Stealth')).toBeUndefined();
    });

    it('does NOT classify passive-voice "gets/was critically damaged" as on-crit (lookbehind verb set)', () => {
        expect(
            detectReactiveTrigger(
                'When this Unit gets critically damaged, it gains <unit-skill>Stealth</unit-skill>.',
                'Stealth'
            )
        ).toBeUndefined();
        expect(
            detectReactiveTrigger(
                'If this Unit was critically damaged, it gains <unit-skill>Stealth</unit-skill>.',
                'Stealth'
            )
        ).toBeUndefined();
    });

    it('classifies on-crit when a LATER active crit phrasing follows an earlier passive one in the same clause', () => {
        // The old single negative-lookbehind regex used `.test`, which stops at the FIRST
        // match — so an earlier passive ("is critically damaged") would shadow a later active
        // ("critically damages") and wrongly return undefined. The match-and-verify scan checks
        // every occurrence, so the later active phrasing still classifies as on-crit.
        const text =
            'If this Unit is critically damaged and then critically damages an enemy, it gains <unit-skill>Stealth</unit-skill>.';
        expect(detectReactiveTrigger(text, 'Stealth')).toBe('on-crit');
    });

    it('returns undefined for a non-reactive grant', () => {
        const text = 'This Unit gains <unit-skill>Attack Up II</unit-skill> for 2 turns.';
        expect(detectReactiveTrigger(text, 'Attack Up II')).toBeUndefined();
    });

    it('scopes to the buff clause (does not leak a sibling sentence trigger)', () => {
        const text =
            'This Unit gains <unit-skill>Attack Up II</unit-skill> for 2 turns. When this Unit critically hits an enemy it inflicts <unit-skill>Defense Shred</unit-skill> for 3 turns.';
        expect(detectReactiveTrigger(text, 'Attack Up II')).toBeUndefined();
        expect(detectReactiveTrigger(text, 'Defense Shred')).toBe('on-crit');
    });

    it('classifies an ally-critically-hits buff grant as on-ally-crit — Pallas Everliving Regeneration', () => {
        // If the buff parsed, its clause "when an ally critically hits ... Everliving Regeneration"
        // routes to on-ally-crit (ally subject overrides the bare "critically hits" self-crit rule).
        const text =
            'When an ally critically hits an enemy, this unit gains <unit-skill>Everliving Regeneration</unit-skill> for 2 turns.';
        expect(detectReactiveTrigger(text, 'Everliving Regeneration')).toBe('on-ally-crit');
    });

    it('classifies an enemy-cleanse debuff infliction as on-enemy-cleansed — Arum', () => {
        const text =
            'When an enemy <unit-aid>cleanses a debuff</unit-aid>, this Unit inflicts all cleansed enemies with <unit-skill>Out. Damage Down I</unit-skill> for 1 turn.';
        expect(detectReactiveTrigger(text, 'Out. Damage Down I')).toBe('on-enemy-cleansed');
    });

    it('classifies an enemy-cleanse self-buff grant as on-enemy-cleansed — Yarrow/Larkspur', () => {
        const text =
            'When an enemy <unit-aid>cleanses a Debuff</unit-aid>, this Unit gains <unit-skill>Gelecek Contagion I</unit-skill> for 2 turns.';
        expect(detectReactiveTrigger(text, 'Gelecek Contagion I')).toBe('on-enemy-cleansed');
    });

    it('scopes enemy-cleanse to the buff clause (Arum refit: debuff on cleanse-clause, all-allies buff in same sentence)', () => {
        const text =
            'When an enemy <unit-aid>cleanses a debuff</unit-aid>, this Unit inflicts all cleansed enemies with <unit-skill>Out. Damage Down I</unit-skill> for 1 turn and this Unit grants all allies <unit-skill>Gelecek Contagion II</unit-skill> for 3 turns.';
        expect(detectReactiveTrigger(text, 'Out. Damage Down I')).toBe('on-enemy-cleansed');
        expect(detectReactiveTrigger(text, 'Gelecek Contagion II')).toBe('on-enemy-cleansed');
    });

    it('detects on-enemy-destroyed from "on kill"', () =>
        expect(detectReactiveTrigger('loses Overload on kill', 'Overload')).toBe(
            'on-enemy-destroyed'
        ));
    it('detects on-enemy-destroyed from "killing an opponent"', () =>
        expect(
            detectReactiveTrigger(
                'it gains Marauder Rage I for 2 turns upon killing an opponent',
                'Marauder Rage I'
            )
        ).toBe('on-enemy-destroyed'));
    it('detects on-enemy-destroyed from "killing an enemy"', () =>
        expect(detectReactiveTrigger('upon killing an enemy, loses Overload', 'Overload')).toBe(
            'on-enemy-destroyed'
        ));
    it('detects on-enemy-repaired', () =>
        expect(
            detectReactiveTrigger('gains Overload when an enemy performs a repair', 'Overload')
        ).toBe('on-enemy-repaired'));
    it('detects on-debuff-inflicted from "On inflicting a debuff"', () =>
        expect(
            detectReactiveTrigger(
                'On inflicting a debuff, this Unit gains Marauder Rage II for 3 turns',
                'Marauder Rage II'
            )
        ).toBe('on-debuff-inflicted'));
    it('routes Ruiner Overload grant to on-enemy-repaired despite a kill clause in the same sentence', () =>
        expect(
            detectReactiveTrigger(
                'gains 1 stack of Overload when an enemy performs a repair, upon killing an enemy, this Unit removes Overload',
                'Overload'
            )
        ).toBe('on-enemy-repaired'));
});

describe('detectCritRepairTrigger', () => {
    it('returns on-ally-critically-repaired when the anchor is in the crit-repair sentence', () => {
        const text = 'When this unit critically repairs an ally, it cleanses 1 debuff from itself.';
        expect(detectCritRepairTrigger(text, text.indexOf('cleanses'))).toBe(
            'on-ally-critically-repaired'
        );
    });

    it('handles the "allies" plural form', () => {
        const text = 'When this unit critically repairs allies, it cleanses 1 debuff.';
        expect(detectCritRepairTrigger(text, text.indexOf('cleanses'))).toBe(
            'on-ally-critically-repaired'
        );
    });

    it('is position-scoped: an anchor in a DIFFERENT sentence is not stamped', () => {
        // The first sentence's cleanse anchor falls OUTSIDE the crit-repair sentence.
        const text =
            'This Unit cleanses 1 debuff from itself. When this unit critically repairs an ally, it gains a buff.';
        expect(detectCritRepairTrigger(text, text.indexOf('cleanses'))).toBeUndefined();
    });

    it('returns undefined when the crit-repair phrase is absent', () => {
        const text = 'This Unit repairs the ally and cleanses 1 debuff.';
        expect(detectCritRepairTrigger(text, text.indexOf('cleanses'))).toBeUndefined();
    });

    it('returns undefined for a negative anchor position', () => {
        const text = 'When this unit critically repairs an ally, it cleanses 1 debuff.';
        expect(detectCritRepairTrigger(text, -1)).toBeUndefined();
    });

    it('abbreviation period in buff name does not split the sentence — trigger still stamps', () => {
        // "Inc. Damage Up" contains a period after "Inc." that is followed by a space — the
        // same pattern phrasePosTrigger's boundary regex /[.;](?=\s|$)/ matches. When the
        // abbreviation sits INSIDE the crit-repair sentence, the unmasked period splits the
        // sentence there, so the crit-repair phrase ends up in one segment and the heal
        // anchor in the next — detectCritRepairTrigger would return undefined instead of the
        // trigger. Masking the abbreviation period before the boundary scan prevents the split.
        const text =
            'When this unit critically repairs an ally, it grants Inc. Damage Up and heals the ally for 5% of its Max HP.';
        const healAnchor = text.indexOf('heals');
        expect(detectCritRepairTrigger(text, healAnchor)).toBe('on-ally-critically-repaired');
    });

    it('treats <br> tags as sentence boundaries: an anchor in a later paragraph is NOT stamped', () => {
        // No period separates the paragraphs — only <br /><br />. Without treating <br> as a
        // boundary, the crit-repair phrase (paragraph 1) and the heal anchor (paragraph 2) would
        // be co-scoped in one segment and wrongly stamped.
        const text =
            'When this unit critically repairs an ally, it gains a buff<br /><br />This unit heals the ally for 5% of its Max HP';
        const healAnchor = text.indexOf('heals');
        expect(detectCritRepairTrigger(text, healAnchor)).toBeUndefined();
    });

    it('stamps when the anchor shares the <br>-delimited paragraph with the phrase', () => {
        // Same paragraph 1 carries both the crit-repair phrase and the heal anchor; paragraph 2
        // (after <br />) is unrelated. The anchor must still be stamped.
        const text =
            'When this unit critically repairs an ally, it heals the ally for 5% of its Max HP<br />This unit gains a buff';
        const healAnchor = text.indexOf('heals');
        expect(detectCritRepairTrigger(text, healAnchor)).toBe('on-ally-critically-repaired');
    });
});

describe('detectAllyCritTrigger', () => {
    it('returns on-ally-crit when the anchor is in the ally-critically-hits sentence', () => {
        const text = 'When an ally critically hits an enemy, this unit gains 1 charge.';
        expect(detectAllyCritTrigger(text, text.indexOf('charge'))).toBe('on-ally-crit');
    });

    it('is position-scoped: an anchor in a DIFFERENT sentence is not stamped', () => {
        // The charge anchor in the first sentence is OUTSIDE the ally-crit sentence.
        const text =
            'This unit gains 1 charge to its charged skill. When an ally critically hits, it gains a buff.';
        expect(detectAllyCritTrigger(text, text.indexOf('charge'))).toBeUndefined();
    });

    it('returns undefined when the ally-crit phrase is absent', () => {
        const text = 'When this unit critically hits, it gains 1 charge.';
        expect(detectAllyCritTrigger(text, text.indexOf('charge'))).toBeUndefined();
    });
});

describe('detectDestroyedTrigger', () => {
    it('returns on-destroyed when the anchor is in the "when this Unit is destroyed … repairs … to all allies" sentence', () => {
        const text = 'When this Unit is destroyed it repairs 80% of its max HP to all allies.';
        expect(detectDestroyedTrigger(text, text.indexOf('repairs'))).toBe('on-destroyed');
    });

    it('is position-scoped: an anchor in a DIFFERENT sentence is not stamped', () => {
        // The first sentence's repair anchor is OUTSIDE the on-destroyed sentence.
        const text =
            'This Unit repairs 30% of its Max HP. When this Unit is destroyed it repairs 80% of its max HP to all allies.';
        expect(detectDestroyedTrigger(text, text.indexOf('repairs'))).toBeUndefined();
    });

    it('returns undefined when the on-destroyed phrase is absent', () => {
        const text = 'This Unit repairs 30% of its Max HP.';
        expect(detectDestroyedTrigger(text, text.indexOf('repairs'))).toBeUndefined();
    });

    it('does NOT stamp on-destroyed for the on-ally-purged 5% repair (anchor is in a different sentence)', () => {
        const text =
            "When this Unit is destroyed it repairs 80% of its max HP to all allies. When a buff is purged from an ally, this Unit repairs that ally for 5% of this Unit's max HP.";
        expect(detectDestroyedTrigger(text, text.indexOf('that ally for 5%'))).toBeUndefined();
    });
});

describe('detectEnemyCleanseTrigger', () => {
    it('returns on-enemy-cleansed when the anchor is in the "when an enemy cleanses a Debuff … deals N% Damage" sentence — Grif', () => {
        const text =
            'When an enemy <unit-aid>cleanses a Debuff</unit-aid>, this Unit deals <unit-damage>75% Damage</unit-damage> that cannot critically hit.';
        expect(detectEnemyCleanseTrigger(text, text.search(/<unit-damage>/i))).toBe(
            'on-enemy-cleansed'
        );
    });

    it('is position-scoped: an anchor in a DIFFERENT sentence is not stamped (Grif refit: standing +20% defense precedes the proc)', () => {
        // The +20% defense modifier sits in its own leading sentence, OUTSIDE the cleanse proc.
        const text =
            'This Unit increases its Defense by 20%. When an enemy <unit-aid>cleanses a Debuff</unit-aid>, this Unit deals <unit-damage>75% Damage</unit-damage> that cannot critically hit.';
        expect(detectEnemyCleanseTrigger(text, text.indexOf('Defense by 20%'))).toBeUndefined();
        expect(detectEnemyCleanseTrigger(text, text.search(/<unit-damage>/i))).toBe(
            'on-enemy-cleansed'
        );
    });

    it('returns undefined when the enemy-cleanse phrase is absent', () => {
        const text = 'This Unit deals <unit-damage>75% damage</unit-damage>.';
        expect(detectEnemyCleanseTrigger(text, text.search(/<unit-damage>/i))).toBeUndefined();
    });

    it('returns undefined for a negative anchor (ability has no position in text)', () => {
        const text =
            'When an enemy <unit-aid>cleanses a Debuff</unit-aid>, this Unit deals <unit-damage>75% Damage</unit-damage> that cannot critically hit.';
        expect(detectEnemyCleanseTrigger(text, -1)).toBeUndefined();
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
            { subject: 'enemy-buff', buffName: 'Taunt', derivable: true, anyOf: true },
            { subject: 'self-debuff', buffName: 'Provoke', derivable: true, anyOf: true },
        ]);
    });

    describe('statusEffectCondition (item 11: Taunt/Provoke derivable)', () => {
        it('classifies Taunt as a derivable enemy-buff gate', () => {
            expect(statusEffectCondition('Taunt')).toEqual({
                subject: 'enemy-buff',
                buffName: 'Taunt',
                derivable: true,
            });
        });

        it('classifies Provoke as a derivable self-debuff gate', () => {
            expect(statusEffectCondition('Provoke')).toEqual({
                subject: 'self-debuff',
                buffName: 'Provoke',
                derivable: true,
            });
        });

        it('leaves an arbitrary named status as a non-derivable self-buff fallback', () => {
            expect(statusEffectCondition('Stealth')).toEqual({
                subject: 'self-buff',
                buffName: 'Stealth',
                derivable: false,
            });
        });

        it('preserves anyOf for Taunt/Provoke and the fallback', () => {
            expect(statusEffectCondition('Taunt', true)).toEqual({
                subject: 'enemy-buff',
                buffName: 'Taunt',
                derivable: true,
                anyOf: true,
            });
            expect(statusEffectCondition('Provoke', true)).toEqual({
                subject: 'self-debuff',
                buffName: 'Provoke',
                derivable: true,
                anyOf: true,
            });
            expect(statusEffectCondition('Stealth', true)).toEqual({
                subject: 'self-buff',
                buffName: 'Stealth',
                derivable: false,
                anyOf: true,
            });
        });
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

    it('classifies "when an enemy gets buffed" as a manual enemy-buff trigger — Nuqtu', () => {
        const text =
            'This Unit <unit-aid>Cleanses 1</unit-aid> debuff from itself (once per round) and gains <unit-skill>Terran Bolster III</unit-skill> for 1 turn when an enemy gets buffed.';
        expect(detectGrantConditions(text, 'Terran Bolster III')).toEqual([
            { subject: 'enemy-buff', derivable: false },
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

    it('classifies "lowest speed among all allies" as a derivable lowest-speed-ally gate', () => {
        const text =
            'This Unit starts each round with <unit-skill>Attack Up II</unit-skill> and <unit-skill>Defense Up II</unit-skill> for 1 turn if it has the lowest speed among all Allies. Then, deals <unit-damage>60% damage</unit-damage> to the highest Speed Enemy.';
        expect(detectGrantConditions(text, 'Attack Up II')).toEqual([
            { subject: 'lowest-speed-ally', derivable: true },
        ]);
    });
});

describe('parseChargeGain ally-crit trigger (Hermes)', () => {
    it('classifies "when an ally critically hits" as a manual condition, NOT self-crit', () => {
        const text =
            'When an ally critically hits an enemy, this Unit <unit-aid>gains 1 charge</unit-aid> to its Charged Skill.';
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'always',
            derivable: false,
        });
    });
});

describe('parseExtraAction', () => {
    // Real texts from docs/ship-skills.csv.
    it('Nuqtu: charged, gated on enemy having 3+ buffs', () => {
        const r = parseExtraAction(
            'This Unit deals <unit-damage>200% damage</unit-damage>, including additional Damage equal to <unit-damage>80%</unit-damage> of its Defense, and an extra 40% for each buff on the enemy. If the target has 3 or more buffs, this Unit grants itself 1 extra End Of Round Action.'
        );
        expect(r).toEqual({
            oncePerRound: false,
            // Nuqtu's grant is an "End Of Round Action" → drains after the speed pool.
            endOfRound: true,
            conditions: [
                {
                    subject: 'enemy-buff',
                    derivable: true,
                    countComparator: 'gte',
                    countThreshold: 3,
                },
            ],
        });
    });

    it('Sustainer: gated on self having no debuffs', () => {
        const r = parseExtraAction(
            'This Unit deals <unit-damage>205% damage</unit-damage> with an additional <unit-damage>30%</unit-damage> for each buff on it. If this Unit has no debuffs, it gains one extra action.'
        );
        expect(r).toEqual({
            oncePerRound: false,
            endOfRound: false,
            conditions: [
                {
                    subject: 'self-debuff',
                    derivable: true,
                    countComparator: 'eq',
                    countThreshold: 0,
                },
            ],
        });
    });

    it('Tormenter: gated on self HP below 50%', () => {
        const r = parseExtraAction(
            'This Unit deals <unit-damage>180% damage</unit-damage> with a guaranteed critical hit. If its HP is below 50%, it <unit-aid>gains 1 Extra Action</unit-aid>.'
        );
        expect(r).toEqual({
            oncePerRound: false,
            endOfRound: false,
            conditions: [
                {
                    subject: 'hp-threshold',
                    derivable: true,
                    hpComparator: 'below',
                    hpPercent: 50,
                    hpSubject: 'self',
                },
            ],
        });
    });

    it('Liberator: on-enemy-destroyed, once per round', () => {
        const r = parseExtraAction(
            'This Unit has 40% Shield Penetration. When an enemy dies, all allies <unit-aid>add 1 charge</unit-aid> to their Charged Skills, and once per round, this unit gains 1 extra action.'
        );
        expect(r).toEqual({
            oncePerRound: true,
            endOfRound: false,
            conditions: [],
            trigger: 'on-enemy-destroyed',
        });
    });

    it('Tygr: enemy-debuff presence approximation, once per round', () => {
        const r = parseExtraAction(
            "This Unit's attacks do not break <unit-skill>Stasis</unit-skill> and deal 30% more damage to enemies with <unit-skill>Stasis</unit-skill> or <unit-skill>Disable</unit-skill>. After damaging an enemy affected by <unit-skill>Stasis</unit-skill>, once per round, give one extra action."
        );
        expect(r).toEqual({
            oncePerRound: true,
            endOfRound: false,
            conditions: [
                {
                    subject: 'enemy-debuff',
                    derivable: true,
                    countComparator: 'gte',
                    countThreshold: 1,
                },
            ],
        });
    });

    it('Sokol: on-enemy-destroyed (upon a kill), once per round', () => {
        const r = parseExtraAction(
            'This Unit gains 1 stack of <unit-skill>Blast</unit-skill> every turn and grants one extra end of round action upon a kill, once per round.'
        );
        expect(r).toEqual({
            oncePerRound: true,
            // Sokol's "extra end of round action" → drains after the speed pool.
            endOfRound: true,
            conditions: [],
            trigger: 'on-enemy-destroyed',
        });
    });

    it('Harvester: on-ally-destroyed', () => {
        const r = parseExtraAction(
            'When an allied Unit is destroyed, this Unit gains 1 extra end of round action and <unit-skill>Speed Up I</unit-skill> for 6 turns.'
        );
        expect(r).toEqual({
            oncePerRound: false,
            // Harvester's "1 extra end of round action" → drains after the speed pool.
            endOfRound: true,
            conditions: [],
            trigger: 'on-ally-destroyed',
        });
    });

    it('disqualified: Tithonus purge-count', () => {
        expect(
            parseExtraAction(
                'This Unit <unit-aid>gains 1 extra action</unit-aid> after it <unit-aid>purges</unit-aid> at least 4 <unit-aid>buffs</unit-aid> with a single skill.'
            )
        ).toBeNull();
    });

    it('no false positive on unrelated text', () => {
        expect(parseExtraAction('This Unit deals 150% damage.')).toBeNull();
        expect(parseExtraAction(null)).toBeNull();
    });

    it('abbrev periods in the same sentence do not break clause scoping', () => {
        const r = parseExtraAction(
            'This Unit gains <unit-skill>Out. Damage Up I</unit-skill> for 1 turn and once per round, this unit gains 1 extra action.'
        );
        expect(r).toEqual({ oncePerRound: true, endOfRound: false, conditions: [] });
    });

    it('end-of-round flag: "1 extra end of round action" → endOfRound true (Task 4)', () => {
        const r = parseExtraAction('This Unit gains 1 extra end of round action.');
        expect(r).toEqual({ oncePerRound: false, endOfRound: true, conditions: [] });
    });

    it('end-of-round flag: Liberator-style "1 extra action" → endOfRound false (Task 4)', () => {
        const r = parseExtraAction(
            'When an enemy dies, once per round, this unit gains 1 extra action.'
        );
        expect(r).toEqual({
            oncePerRound: true,
            endOfRound: false,
            conditions: [],
            trigger: 'on-enemy-destroyed',
        });
    });
});

describe('parseHealAbilities', () => {
    it('caster-HP heal to an ally', () => {
        expect(
            parseHealAbilities(
                "This unit <unit-damage>repairs the ally for 4%</unit-damage> of this Unit's Max HP."
            )
        ).toEqual([{ kind: 'heal', pct: 4, basis: 'hp', target: 'ally', explicitTarget: true }]);
    });
    it('self repair', () => {
        expect(
            parseHealAbilities(
                'This unit <unit-damage>repairs itself for 30%</unit-damage> of its Max HP.'
            )
        ).toEqual([{ kind: 'heal', pct: 30, basis: 'hp', target: 'self', explicitTarget: true }]);
    });
    it('all-allies repair', () => {
        expect(
            parseHealAbilities(
                'This unit <unit-damage>repairs 80%</unit-damage> of its max HP to all allies.'
            )
        ).toEqual([
            { kind: 'heal', pct: 80, basis: 'hp', target: 'all-allies', explicitTarget: true },
        ]);
    });
    it('most-missing-health routes as ally', () => {
        expect(
            parseHealAbilities(
                'This unit <unit-damage>repairs 30%</unit-damage> of its Max HP to the ally with the most missing health.'
            )
        ).toEqual([{ kind: 'heal', pct: 30, basis: 'hp', target: 'ally', explicitTarget: true }]);
    });
    it('attack-based repair (bare → self, explicitTarget false)', () => {
        expect(parseHealAbilities('repairs <unit-damage>90%</unit-damage> of its Attack.')).toEqual(
            [{ kind: 'heal', pct: 90, basis: 'attack', target: 'self', explicitTarget: false }]
        );
    });
    it('multi-component heal: HP + Defense (bare → self, explicitTarget false)', () => {
        expect(
            parseHealAbilities(
                'repairs <unit-damage>5%</unit-damage> of its Max HP with an additional repair equal to 100% of its Defense.'
            )
        ).toEqual([
            { kind: 'heal', pct: 5, basis: 'hp', target: 'self', explicitTarget: false },
            { kind: 'heal', pct: 100, basis: 'defense', target: 'self', explicitTarget: false },
        ]);
    });
    it('recipient-HP heal (their Max HP)', () => {
        expect(
            parseHealAbilities(
                'Repairs all allies for <unit-damage>8%</unit-damage> of their Max HP.'
            )
        ).toEqual([
            {
                kind: 'heal',
                pct: 8,
                basis: 'target-hp',
                target: 'all-allies',
                explicitTarget: true,
            },
        ]);
    });
    it('shield from caster HP', () => {
        expect(
            parseHealAbilities(
                'This Unit gains a <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.'
            )
        ).toEqual([
            { kind: 'shield', pct: 25, basis: 'hp', target: 'self', explicitTarget: false },
        ]);
    });
    it('shield from attack', () => {
        expect(
            parseHealAbilities(
                'grants the ally a <unit-damage>shield equal to 180%</unit-damage> of its attack'
            )
        ).toEqual([
            { kind: 'shield', pct: 180, basis: 'attack', target: 'ally', explicitTarget: true },
        ]);
    });
    it('damage-taken shield IS parsed as a leech (basis damage-taken, requiresHpDamage)', () => {
        expect(
            parseHealAbilities(
                'gains a Shield equal to 25% of the damage taken when taking HP damage and still having Shield'
            )
        ).toEqual([
            {
                kind: 'shield',
                pct: 25,
                basis: 'damage-taken',
                target: 'self',
                explicitTarget: true,
                requiresHpDamage: true,
            },
        ]);
    });
    it('"damage dealt to them" shield IS parsed as damage-taken (Malvex)', () => {
        expect(
            parseHealAbilities('gains a Shield equal to 15% of the Damage dealt to them')
        ).toEqual([
            {
                kind: 'shield',
                pct: 15,
                basis: 'damage-taken',
                target: 'self',
                explicitTarget: true,
            },
        ]);
    });
    it('revive/Cheat Death text is NOT parsed', () => {
        expect(
            parseHealAbilities(
                'Once per battle, when this unit is destroyed, it revives with 50% of its max HP.'
            )
        ).toEqual([]);
    });
    it('"X% of damage dealt" repair IS parsed as a dual-recipient leech (Valkyrie burst reaction)', () => {
        expect(
            parseHealAbilities(
                'this Unit and the ally with the lowest current health percentage <unit-damage>repair 5%</unit-damage> of damage dealt.'
            )
        ).toEqual([
            {
                kind: 'heal',
                pct: 5,
                basis: 'damage-dealt',
                target: 'ally',
                explicitTarget: true,
            },
            {
                kind: 'heal',
                pct: 5,
                basis: 'damage-dealt',
                target: 'self',
                explicitTarget: true,
            },
        ]);
    });

    // Issue 1: basis resolution must NOT cross sentence boundaries
    it('basis stays hp when "of its Attack" is in a LATER sentence (cross-sentence basis)', () => {
        expect(
            parseHealAbilities(
                'This unit repairs 30%. This unit deals damage equal to 200% of its Attack.'
            )
        ).toEqual([{ kind: 'heal', pct: 30, basis: 'hp', target: 'self', explicitTarget: false }]);
    });

    // Issue 2: multi-component continuation must NOT span sentence boundaries
    it('HEAL_ADDITIONAL_RE does not pick up a continuation in a LATER sentence', () => {
        expect(
            parseHealAbilities(
                'This unit repairs 5% of its Max HP. An unrelated buff with an additional repair equal to 100% of its Defense exists.'
            )
        ).toEqual([{ kind: 'heal', pct: 5, basis: 'hp', target: 'self', explicitTarget: false }]);
    });

    // Issue 3: singular "the ally … their Max HP" → target ally, NOT all-allies
    it('singular "the ally … of their Max HP" → target ally, not all-allies', () => {
        expect(
            parseHealAbilities(
                'Repairs the ally for <unit-damage>8%</unit-damage> of their Max HP.'
            )
        ).toEqual([
            { kind: 'heal', pct: 8, basis: 'target-hp', target: 'ally', explicitTarget: true },
        ]);
    });

    // Regression guard: explicit plural phrase "all allies … their Max HP" must stay all-allies
    it('"Repairs all allies for 8% of their Max HP" remains all-allies (regression guard)', () => {
        expect(
            parseHealAbilities(
                'Repairs all allies for <unit-damage>8%</unit-damage> of their Max HP.'
            )
        ).toEqual([
            {
                kind: 'heal',
                pct: 8,
                basis: 'target-hp',
                target: 'all-allies',
                explicitTarget: true,
            },
        ]);
    });
});

describe('damage-leech parsing', () => {
    it('Iridium rider: repairs 15% of the damage dealt → damage-dealt basis', () => {
        const r = parseHealAbilities(
            'This Unit deals 40% damage with additional damage equal to 9% of its max HP and repairs 15% of the damage dealt.'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ kind: 'heal', pct: 15, basis: 'damage-dealt' });
        expect(r[0].leechScope).toBeUndefined();
    });

    it('Magnolia standing: repairs itself for 20% of the damage it deals to enemies', () => {
        const r = parseHealAbilities(
            'This Unit repairs itself for 20% of the damage it deals to enemies.'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            kind: 'heal',
            pct: 20,
            basis: 'damage-dealt',
            target: 'self',
            explicitTarget: true,
        });
    });

    it('Tithonus: repairs all allies 7% of the damage dealt → all-allies', () => {
        const r = parseHealAbilities(
            'This Unit deals purges 2 buffs from the enemy and deals 170% damage. Then repairs all allies 7% of the damage dealt. This repair cannot critically hit.'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            kind: 'heal',
            pct: 7,
            basis: 'damage-dealt',
            target: 'all-allies',
        });
    });

    it('Pallas: "heals for 20% of the damage dealt" leech verb → ally', () => {
        const r = parseHealAbilities(
            'This Unit deals 200% damage. The other ally with the lowest current health percentage heals for 20% of the damage dealt and this repair cannot critically hit.'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            kind: 'heal',
            pct: 20,
            basis: 'damage-dealt',
            target: 'ally',
        });
    });

    it('"heals" verb does NOT parse without a leech tail (no general heals-verb parsing)', () => {
        expect(parseHealAbilities('This Unit heals for 20% of its max HP.')).toHaveLength(0);
    });

    it('Valkyrie: dual recipient + Echoing Burst scope → two entries, detonation scope', () => {
        const r = parseHealAbilities(
            'When an Echoing Burst explodes on an enemy, this Unit and the ally with the lowest current health percentage repair 5% of damage dealt.'
        );
        expect(r).toHaveLength(2);
        expect(r[0]).toMatchObject({
            kind: 'heal',
            pct: 5,
            basis: 'damage-dealt',
            target: 'ally',
            leechScope: 'detonation',
        });
        expect(r[1]).toMatchObject({ target: 'self', leechScope: 'detonation' });
    });

    it('Quixilver active: gains Shield equal to 20% of the damage dealt', () => {
        const r = parseHealAbilities(
            'This unit deals 100% damage plus an additional damage equal to 14% of its current Shield, and gains Shield equal to 20% of the damage dealt..'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ kind: 'shield', pct: 20, basis: 'damage-dealt' });
    });

    it('Quixilver passive: Shield equal to 25% of the damage taken → damage-taken + requiresHpDamage', () => {
        const r = parseHealAbilities(
            'This Unit gains Shield equal to 25% of the damage taken when taking HP damage and still having Shield.'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            kind: 'shield',
            pct: 25,
            basis: 'damage-taken',
            target: 'self',
            requiresHpDamage: true,
        });
    });

    it('Malvex: "Damage dealt to them" is damage TAKEN, unconditional', () => {
        const r = parseHealAbilities(
            'When directly damaged as a primary target, this Unit gains Shield equal to 15% of the Damage dealt to them.'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            kind: 'shield',
            pct: 15,
            basis: 'damage-taken',
            target: 'self',
        });
        expect(r[0].requiresHpDamage).toBeUndefined();
    });

    it('FrontLine R4: enemy-action leech shield does NOT parse', () => {
        const r = parseHealAbilities(
            'When an enemy uses their Charged skill, it deals 80% and gains a Shield equal to 30% of the damage dealt, once per round.'
        );
        expect(r).toHaveLength(0);
    });

    it('revive/Cheat Death still disqualified', () => {
        expect(parseHealAbilities('This Unit revives with 50% HP.')).toHaveLength(0);
    });
});

// Unmodeled reactive triggers (on-destroyed/on-kill, on-buff-purged, reactive on-cleansed,
// on-directly-damaged/attacked/takes-damage) must NOT be emitted as on-cast heals — the engine
// doesn't model them yet, so emitting them makes the heal fire EVERY round (phantom healing).
// They become live later via Phase 4b/4c. Guards: leech heals, ACTIVE cleanse+repair, and
// modeled reactive heals (on-ally-critically-repaired) MUST still parse.
describe('parseHealAbilities — unmodeled reactive triggers are NOT emitted', () => {
    // Phase 4b Task 9: the "when this Unit is destroyed … repairs X% … to all allies"
    // on-destroyed ally-heal is now RE-ENABLED (on-destroyed is a live trigger). It parses
    // as a normal all-allies heal here; buildShipAbilities stamps trigger 'on-destroyed' so
    // it fires only on death (see detectDestroyedTrigger below + buildShipAbilities test).
    it('Salvation R0 passive: "when this Unit is destroyed … repairs 60% … to all allies" IS extracted', () => {
        expect(
            parseHealAbilities(
                'When this Unit is destroyed it repairs 60% of its max HP to all allies.'
            )
        ).toEqual([
            { kind: 'heal', pct: 60, basis: 'hp', target: 'all-allies', explicitTarget: true },
        ]);
    });

    it('Salvation R2 passive: both the 80% all-allies heal AND the 5% ally heal are extracted (C2b-1 T5: on-ally-purged is now live)', () => {
        // The "when a buff is purged from an ally" clause is now exempt from HEAL_DISQUALIFY_RE
        // (negative lookahead exempts the ally-recipient form). Both heals emit; buildShipAbilities
        // stamps the 5% with on-ally-purged and the 80% with on-destroyed.
        expect(
            parseHealAbilities(
                "When this Unit is destroyed it repairs 80% of its max HP to all allies. When a buff is purged from an ally, this Unit repairs that ally for 5% of this Unit's max HP."
            )
        ).toEqual([
            { kind: 'heal', pct: 80, basis: 'hp', target: 'all-allies', explicitTarget: true },
            { kind: 'heal', pct: 5, basis: 'hp', target: 'ally', explicitTarget: true },
        ]);
    });

    it('Salvation active heal (repairs 25%) still parses', () => {
        expect(
            parseHealAbilities(
                'This Unit repairs 25% of its Max HP and grants Binderburg Resilience II for 1 turn.'
            )
        ).toEqual([{ kind: 'heal', pct: 25, basis: 'hp', target: 'self', explicitTarget: false }]);
    });

    it('Salvation charged heal (repairs 30%) still parses', () => {
        expect(
            parseHealAbilities(
                'This Unit repairs 30% of its Max HP and grants Inc. Damage Down II for 2 turns.'
            )
        ).toEqual([{ kind: 'heal', pct: 30, basis: 'hp', target: 'self', explicitTarget: false }]);
    });

    // Phase 4c PR 1: SELF-subject damage reactions are now MODELED (on-attacked is a live
    // trigger) — Makoli's R2 passive parses with a damageReaction annotation instead of dropping.
    it('Makoli R2 passive: "when directly damaged while below 40% HP, repairs 20%" IS extracted with a damageReaction', () => {
        expect(
            parseHealAbilities(
                'When directly damaged while below 40% HP, this Unit repairs 20% of its Max HP and inflicts Disable for 1 turn.'
            )
        ).toEqual([
            {
                kind: 'heal',
                pct: 20,
                basis: 'hp',
                target: 'self',
                explicitTarget: false,
                damageReaction: { hpBelowPct: 40 },
            },
        ]);
    });

    it('Makoli ACTIVE cleanse+repair (cleanses 1 debuff, repairs 5% + 100% Defense) still parses', () => {
        expect(
            parseHealAbilities(
                'This Unit cleanses 1 debuff, repairs 5% of its Max HP with an additional repair equal to 100% of its Defense, and grants Inc. Damage Down II for 2 turns.'
            )
        ).toEqual([
            { kind: 'heal', pct: 5, basis: 'hp', target: 'self', explicitTarget: false },
            { kind: 'heal', pct: 100, basis: 'defense', target: 'self', explicitTarget: false },
        ]);
    });

    it('Cultivator p2: ally-damage clause → ally-target heal with allySubject damageReaction; 4% cleanse clause unchanged', () => {
        // Full CSV p2 text (tags stripped; <br /><br /> → '. ' via the plain pipeline).
        // The 4% cleanse-reaction clause is pinned to its pre-Task-8 shape (on-cast ally
        // heal, NO damageReaction — "cleanses" is not a damage-reaction shape); the 8%
        // ally-damaged clause was PR 1-disqualified and now parses with allySubject.
        expect(
            parseHealAbilities(
                "When this Unit cleanses a Debuff, it also repairs that ally for 4% of this Unit's Max HP. Additionally, when an ally is directly damaged within the active pattern, this Unit repairs that ally for 8% of this Unit's Max HP."
            )
        ).toEqual([
            { kind: 'heal', pct: 4, basis: 'hp', target: 'ally', explicitTarget: true },
            {
                kind: 'heal',
                pct: 8,
                basis: 'hp',
                target: 'ally',
                explicitTarget: true,
                damageReaction: { allySubject: true },
            },
        ]);
    });

    it('GUARD: leech heal "repairs X% of the damage it deals" still parses (basis damage-dealt)', () => {
        const r = parseHealAbilities(
            'This Unit repairs itself for 40% of the damage it deals to enemies.'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ kind: 'heal', pct: 40, basis: 'damage-dealt' });
    });

    it('GUARD: damage-taken leech reaction (Malvex "when directly damaged … shield … of damage dealt to them") still parses', () => {
        const r = parseHealAbilities(
            'When directly damaged as a primary target, this Unit gains a Shield equal to 15% of the Damage dealt to them.'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ kind: 'shield', pct: 15, basis: 'damage-taken' });
    });

    it('GUARD: modeled reactive heal "when this Unit critically repairs an ally" still parses', () => {
        const r = parseHealAbilities(
            "When this Unit critically repairs an ally, it also repairs that ally for 5% of this Unit's Max HP."
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ kind: 'heal', pct: 5, basis: 'hp' });
    });

    it('on-kill trigger ("when it destroys an enemy, repairs X%") is NOT extracted', () => {
        expect(
            parseHealAbilities('When it destroys an enemy, this Unit repairs 30% of its Max HP.')
        ).toEqual([]);
    });

    it('reactive on-cleansed ("when this Unit is cleansed, repairs X%") is NOT extracted', () => {
        expect(
            parseHealAbilities('When this Unit is cleansed, it repairs 10% of its Max HP.')
        ).toEqual([]);
    });
});

// Phase 4c damage-reaction heals. PR 1 (Task 7): SELF-subject reactions ("when directly
// damaged … this Unit repairs …") parse with a `damageReaction` annotation;
// buildShipAbilities maps it to trigger 'on-attacked' (+ triggerCritFilter / derivable
// self hp-threshold). PR 2 (Task 8): ALLY-subject reactions ("when an ally is directly
// damaged", Cultivator) parse with `damageReaction.allySubject: true`, and self triggers
// whose heal RECIPIENT is not self (Heliodor's second-listed passive "repairs them
// [all allies]") parse too. All texts below are real CSV rows.
describe('parseHealAbilities — damage-reaction heals (Phase 4c)', () => {
    // Makoli and Guardian share this CSV text BYTE-IDENTICALLY (both ships'
    // first_passive_skill_text column) — one test covers both.
    it('Makoli/Guardian first passive (identical CSV text): below-40% gate → ONE heal with damageReaction.hpBelowPct', () => {
        expect(
            parseHealAbilities(
                'When directly damaged while below 40% HP, this Unit <unit-damage>repairs 20%</unit-damage> of its Max HP.'
            )
        ).toEqual([
            {
                kind: 'heal',
                pct: 20,
                basis: 'hp',
                target: 'self',
                explicitTarget: false,
                damageReaction: { hpBelowPct: 40 },
            },
        ]);
    });

    it('Isha second passive (CSV second_passive_skill_text): instead-on-crit pair → 3% non-crit + 6% crit (tolerates the "criticall" typo)', () => {
        expect(
            parseHealAbilities(
                'When directly damaged, this Unit <unit-damage>repairs 3%</unit-damage> of its max HP, but when criticall hit, it instead <unit-damage>repairs 6%</unit-damage> of its max HP.'
            )
        ).toEqual([
            {
                kind: 'heal',
                pct: 3,
                basis: 'hp',
                target: 'self',
                explicitTarget: false,
                damageReaction: { critFilter: 'non-crit' },
            },
            {
                kind: 'heal',
                pct: 6,
                basis: 'hp',
                target: 'self',
                explicitTarget: false,
                damageReaction: { critFilter: 'crit' },
            },
        ]);
    });

    it('Heliodor FIRST passive: self repair parses with bare damageReaction; the debuff-duration clause emits nothing', () => {
        expect(
            parseHealAbilities(
                'When directly damaged, this Unit reduces the duration of all active <unit-aid>Debuffs</unit-aid> on itself by 1 turn and <unit-damage>repairs itself for 8%</unit-damage> of its Max HP.'
            )
        ).toEqual([
            {
                kind: 'heal',
                pct: 8,
                basis: 'hp',
                target: 'self',
                explicitTarget: true,
                damageReaction: {},
            },
        ]);
    });

    it('Warden passive: self repair parses with bare damageReaction ("that enemy" in the Corrosion clause is not the trigger subject)', () => {
        expect(
            parseHealAbilities(
                'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns on that enemy and repairs itself 3% of its Max HP.'
            )
        ).toEqual([
            {
                kind: 'heal',
                pct: 3,
                basis: 'hp',
                target: 'self',
                explicitTarget: true,
                damageReaction: {},
            },
        ]);
    });

    it('Heliodor p2: self-damage trigger with all-allies recipient parses (was PR 1-disqualified)', () => {
        // Self-subject trigger ("When directly damaged"), but the heal recipient is the
        // whole team: "them" refers back to "all allies" earlier in the sentence, so the
        // target is all-allies (NOT the singular-ally \bthem\b rule). damageReaction is
        // present-but-empty — ungated self reaction, no allySubject. The duration-
        // reduction half emits nothing (4e deferral).
        expect(
            parseHealAbilities(
                'When directly damaged, this Unit reduces the duration of all active <unit-aid>Debuffs</unit-aid> on all allies by 1 turn and repairs them for 8% of its Max HP.'
            )
        ).toEqual([
            {
                kind: 'heal',
                pct: 8,
                basis: 'hp',
                target: 'all-allies',
                explicitTarget: true,
                damageReaction: {},
            },
        ]);
    });

    it('Cultivator ally-damaged clause (isolated): ally-subject reaction parses with allySubject (was PR 1-disqualified)', () => {
        expect(
            parseHealAbilities(
                "when an ally is directly damaged within the active pattern, this Unit <unit-damage>repairs that ally for 8%</unit-damage> of this Unit's Max HP."
            )
        ).toEqual([
            {
                kind: 'heal',
                pct: 8,
                basis: 'hp',
                target: 'ally',
                explicitTarget: true,
                damageReaction: { allySubject: true },
            },
        ]);
    });

    // PIN (Task 8): Crocus p2 is ally-OUTGOING ("when another ally INFLICTS a DoT with a
    // critical hit" — active voice, on-ally-crit-dot territory), NOT an ally-damaged
    // reaction. HEAL_DAMAGE_REACTION_RE has no active-voice alternation, so the sentence
    // never reaches the annotation gate: the 3% repair keeps parsing as a plain on-cast
    // self heal with NO damageReaction (byte-identical to its pre-Task-8 shape).
    it('Crocus p2: 3% repair keeps its current shape (no allySubject annotation)', () => {
        expect(
            parseHealAbilities(
                'When another ally inflicts a Damage Over Time (DoT) effect with a critical hit, this Unit <unit-damage>repairs itself for 3%</unit-damage> of its Max HP and inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns on that enemy.'
            )
        ).toEqual([{ kind: 'heal', pct: 3, basis: 'hp', target: 'self', explicitTarget: true }]);
    });

    it('Refine: ally-damaged buff grant yields NO heal', () => {
        expect(
            parseHealAbilities(
                'When an ally is directly damaged, this Unit grants <unit-skill>Inc. Damage Down I</unit-skill> for 1 turn.'
            )
        ).toEqual([]);
    });

    it('Graphite: ally-damaged Repair-Over-Time grant yields NO heal', () => {
        expect(
            parseHealAbilities(
                'When an ally attacker or debuffer is directly damaged, this Unit grants the ally <unit-skill>Repair Over Time III</unit-skill> for 2 turns.'
            )
        ).toEqual([]);
    });

    it('Anemone: enemy-subject DoT-tick trigger still parses WITHOUT a damageReaction', () => {
        expect(
            parseHealAbilities(
                "When an enemy takes damage from a Damage over Time effect, repair 5% of this Unit's Max HP."
            )
        ).toEqual([{ kind: 'heal', pct: 5, basis: 'hp', target: 'self', explicitTarget: false }]);
    });

    it('GUARD: leech reactions stay leech (no damageReaction) — Malvex damage-taken shape', () => {
        const r = parseHealAbilities(
            'When directly damaged as a primary target, this Unit gains a Shield equal to 15% of the Damage dealt to them.'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ kind: 'shield', pct: 15, basis: 'damage-taken' });
        expect(r[0].damageReaction).toBeUndefined();
    });

    // LOCK: pure crit-only heal phrasing → ONE heal with damageReaction.critFilter 'crit'
    it('crit-only heal: "when this unit is critically hit, repairs 5%" → ONE heal with critFilter crit', () => {
        expect(
            parseHealAbilities(
                'When this unit is critically hit, this Unit repairs 5% of its Max HP.'
            )
        ).toEqual([
            {
                kind: 'heal',
                pct: 5,
                basis: 'hp',
                target: 'self',
                explicitTarget: false,
                damageReaction: { critFilter: 'crit' },
            },
        ]);
    });

    // LOCK: corpus typo "criticall hit" (no trailing 'y') is also matched
    it('crit-only heal: tolerated typo "criticall hit" → ONE heal with critFilter crit', () => {
        expect(
            parseHealAbilities(
                'When this unit is criticall hit, this Unit repairs 7% of its Max HP.'
            )
        ).toEqual([
            {
                kind: 'heal',
                pct: 7,
                basis: 'hp',
                target: 'self',
                explicitTarget: false,
                damageReaction: { critFilter: 'crit' },
            },
        ]);
    });

    // GUARD: Hermes-family active-voice "when an ally critically hits an enemy, repairs the ally"
    // must NOT carry damageReaction. The active-voice "hits" (trailing 's') does not match the
    // passive-voice "is critically hit" alternation. The ally-subject guard on dmgReaction[0]
    // would block annotation even if another alternation happened to match. The heal emits
    // normally (on-cast) without any damageReaction annotation.
    it('GUARD: Hermes-family "when an ally critically hits an enemy, repairs the ally" → heal WITHOUT damageReaction', () => {
        const r = parseHealAbilities(
            'When an ally critically hits an enemy, this Unit repairs the ally for 5% of its Max HP.'
        );
        expect(r).toHaveLength(1);
        expect(r[0].damageReaction).toBeUndefined();
    });

    // GUARD: Isha pair unchanged — instead-clause logic still runs first and the
    // "directly damaged" alternation precedes the crit-hit alternation in the regex,
    // so Isha's pair still produces 3% non-crit + 6% crit.
    it('GUARD: Isha pair unchanged after crit-hit alternation addition', () => {
        expect(
            parseHealAbilities(
                'When directly damaged, this Unit <unit-damage>repairs 3%</unit-damage> of its max HP, but when criticall hit, it instead <unit-damage>repairs 6%</unit-damage> of its max HP.'
            )
        ).toEqual([
            {
                kind: 'heal',
                pct: 3,
                basis: 'hp',
                target: 'self',
                explicitTarget: false,
                damageReaction: { critFilter: 'non-crit' },
            },
            {
                kind: 'heal',
                pct: 6,
                basis: 'hp',
                target: 'self',
                explicitTarget: false,
                damageReaction: { critFilter: 'crit' },
            },
        ]);
    });
});

// Phase 4c PR 1 (Task 8): self-subject damage-reaction trigger for NON-HEAL clauses
// (buff grants, debuff/DoT inflictions). Sentence-scoped around `pos` on the RAW text
// (same masked bounds as phrasePosTrigger). Passive-voice "is critically hit" is the
// crit-filtered variant; ally-subject sentences classify as on-ally-attacked (PR 2 Task 7,
// see the sibling describe below).
describe('detectDamageReactionTrigger', () => {
    const at = (text: string, needle: string) =>
        detectDamageReactionTrigger(text, text.indexOf(needle));

    it('Warden passive: Corrosion infliction sentence → bare on-attacked', () => {
        expect(
            at(
                'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns on that enemy and repairs itself 3% of its Max HP.',
                'Corrosion I'
            )
        ).toEqual({ trigger: 'on-attacked' });
    });

    it('Guardian second passive: "is critically hit" grant → on-attacked with crit filter', () => {
        expect(
            at(
                'This Unit has 20% shield penetration. When this Unit is critically hit, it gains <unit-skill>Binderburg Resilience I</unit-skill> for 1 turn.<br /><br />When an ally is critically hit by an enemy, apply <unit-skill>Provoke</unit-skill> for 1 turn to that enemy.',
                'Binderburg Resilience I'
            )
        ).toEqual({ trigger: 'on-attacked', critFilter: 'crit' });
    });

    it('Guardian second passive: ally-subject Provoke sentence → on-ally-attacked (PR 2 Task 7)', () => {
        // Was pinned undefined in PR 1; the full two-sentence row also locks sentence
        // scoping (the Provoke anchor must not pick up the self-subject crit sentence's
        // trigger — both classify, but each from its OWN sentence).
        expect(
            at(
                'This Unit has 20% shield penetration. When this Unit is critically hit, it gains <unit-skill>Binderburg Resilience I</unit-skill> for 1 turn.<br /><br />When an ally is critically hit by an enemy, apply <unit-skill>Provoke</unit-skill> for 1 turn to that enemy.',
                'Provoke'
            )
        ).toEqual({ trigger: 'on-ally-attacked', critFilter: 'crit' });
    });

    it('Yarrow active: plain on-cast Corrosion infliction → undefined', () => {
        expect(
            at(
                'This Unit deals <unit-damage>110% damage</unit-damage> and inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns.',
                'Corrosion I'
            )
        ).toBeUndefined();
    });

    it('Panguan: trailing "when directly damaged" → on-attacked', () => {
        expect(
            at(
                'This Unit Gains <unit-skill>Stealth</unit-skill> for 2 turns when directly damaged.',
                'Stealth'
            )
        ).toEqual({ trigger: 'on-attacked' });
    });

    it('Stalwart: "When this Unit is directly damaged as a primary target" → on-attacked', () => {
        expect(
            at(
                'When this Unit is directly damaged as a primary target, it deals <unit-damage>30% damage</unit-damage> to that enemy and gains <unit-skill>Legion Discipline II</unit-skill> for 3 turns.',
                'Legion Discipline II'
            )
        ).toEqual({ trigger: 'on-attacked' });
    });

    it('Provider: "another ally" subject with a "cannont critically hit" rider → undefined', () => {
        // BOTH guards matter here: "when ANOTHER ally inflicts …" is an ally-subject
        // sentence, and the typo'd crit-suppression rider ("cannont critically hit")
        // must not read as a crit reaction.
        expect(
            at(
                'This Unit has 20% Shield Penetration. When another ally inflicts a debuff onto an enemy, this unit deals <unit-damage>50% damage</unit-damage> to that enemy that cannont critically hit and inflict <unit-skill>Crit Rate Down II</unit-skill> for 1 turn.',
                'Crit Rate Down II'
            )
        ).toBeUndefined();
    });

    it('Grif-style "cannot critically hit" rider inside a when-sentence → undefined', () => {
        expect(
            at(
                'When an enemy <unit-aid>cleanses a Debuff</unit-aid>, this Unit deals <unit-damage>75% Damage</unit-damage> that cannot critically hit.',
                '75% Damage'
            )
        ).toBeUndefined();
    });

    it('Panon: "If this Unit is directly damaged" (if, not when) → undefined', () => {
        expect(
            at(
                'If this Unit is directly damaged and does not have <unit-skill>Barrier Recharging</unit-skill>, it gains <unit-skill>Barrier</unit-skill> for 1 turn and applies <unit-skill>Barrier Recharging</unit-skill> to itself for 3 turns.',
                'Barrier'
            )
        ).toBeUndefined();
    });

    it('sentence scoping: a grant in a DIFFERENT <br>-separated sentence is not co-triggered', () => {
        // Isha second passive: the start-of-round buffs precede the damage-reaction repair
        // sentence — their positions must not pick up the reaction trigger.
        expect(
            at(
                'At the start of the round this Unit gains <unit-skill>Offensive Affinity Override</unit-skill>.<br />If Nayra is on the same team, it also gains <unit-skill>Defensive Affinity Override</unit-skill>.<br /><br />When directly damaged, this Unit <unit-damage>repairs 3%</unit-damage> of its max HP.',
                'Offensive Affinity Override'
            )
        ).toBeUndefined();
    });

    it('negative pos → undefined', () => {
        expect(detectDamageReactionTrigger('When directly damaged, …', -1)).toBeUndefined();
    });

    // hpBelowPct: widened return (spec-review fix — gated reaction debuffs carry hp gate)
    it('Makoli: "when directly damaged while below 40% HP" → on-attacked with hpBelowPct 40', () => {
        const text =
            'When directly damaged while below 40% HP, this Unit <unit-damage>repairs 20%</unit-damage> of its Max HP and inflicts <unit-skill>Disable</unit-skill> for 1 turn.';
        expect(at(text, 'Disable')).toEqual({ trigger: 'on-attacked', hpBelowPct: 40 });
    });

    it('ungated Warden sentence → on-attacked with no hpBelowPct', () => {
        const text =
            'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns on that enemy and repairs itself 3% of its Max HP.';
        expect(at(text, 'Corrosion I')).toEqual({ trigger: 'on-attacked' });
    });

    it('Guardian crit-filtered sentence (ungated) → on-attacked + critFilter, no hpBelowPct', () => {
        const text =
            'This Unit has 20% shield penetration. When this Unit is critically hit, it gains <unit-skill>Binderburg Resilience I</unit-skill> for 1 turn.';
        expect(at(text, 'Binderburg Resilience I')).toEqual({
            trigger: 'on-attacked',
            critFilter: 'crit',
        });
    });
});

// Phase 4c PR 2 (Task 7): ALLY-subject damage reactions classify as on-ally-attacked
// (Guardian's Provoke counter, Refine, Graphite) instead of returning undefined. Role
// nouns right after "ally" (Graphite "ally attacker or debuffer") become a CATEGORY
// roleFilter; hpBelowPct stays self-subject-only (DR_HP_BELOW_RE reads the OWNER's HP —
// no corpus ally-reaction carries an HP gate).
describe('detectDamageReactionTrigger — ally-subject (on-ally-attacked)', () => {
    const at = (text: string, needle: string) =>
        detectDamageReactionTrigger(text, text.indexOf(needle));

    it('Guardian: "When an ally is critically hit by an enemy" → on-ally-attacked + crit filter', () => {
        expect(
            at(
                'When an ally is critically hit by an enemy, apply <unit-skill>Provoke</unit-skill> for 1 turn to that enemy.',
                'Provoke'
            )
        ).toEqual({ trigger: 'on-ally-attacked', critFilter: 'crit' });
    });

    it('Refine: "When an ally is directly damaged" → bare on-ally-attacked', () => {
        expect(
            at(
                'When an ally is directly damaged, this Unit grants <unit-skill>Inc. Damage Down I</unit-skill> for 1 turn.',
                'Inc. Damage Down I'
            )
        ).toEqual({ trigger: 'on-ally-attacked' });
    });

    it('Graphite: "ally attacker or debuffer is directly damaged" → on-ally-attacked + role filter', () => {
        expect(
            at(
                'When an ally attacker or debuffer is directly damaged, this Unit grants the ally <unit-skill>Repair Over Time III</unit-skill> for 2 turns.',
                'Repair Over Time III'
            )
        ).toEqual({ trigger: 'on-ally-attacked', roleFilter: ['ATTACKER', 'DEBUFFER'] });
    });

    it('Crocus: ACTIVE-voice ally crit ("inflicts … with a critical hit") → undefined', () => {
        // The ally lands the crit (outgoing, on-ally-crit-dot territory) — the ally is NOT
        // being damaged. Bare DR_CRIT_HIT_RE matches "…with a critical hit", so without the
        // passive-voice requirement this misclassified as on-ally-attacked + crit filter and
        // buildShipAbilities emitted a phantom name-only Corrosion II debuff into simulations.
        expect(
            at(
                'When another ally inflicts a Damage Over Time (DoT) effect with a critical hit, this Unit repairs itself for 3% of its Max HP and inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns on that enemy.',
                'Corrosion II'
            )
        ).toBeUndefined();
    });

    it('self-subject regression (Warden, byte-identical to the PR 1 pin): bare on-attacked', () => {
        expect(
            at(
                'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns on that enemy and repairs itself 3% of its Max HP.',
                'Corrosion I'
            )
        ).toEqual({ trigger: 'on-attacked' });
    });
});

// Phase 4c PR 3 (Task 6): "when HP drops/falls below N%" buff-grant reactives. The detector
// is sentence-scoped at the buff's anchor (same masked rawSentenceAround the damage-reaction
// path uses), so a buff in a DIFFERENT sentence (Tycho's Cheat Death, Los's damage modifier)
// does not pick up the crossing trigger. Texts are fed in the CANONICAL post-wiring shape:
// <br /> normalized to '. ' (buildShipAbilities does this before scoping), so <br>-separated
// clauses become distinct sentences. The (drops|falls) verb is REQUIRED — excludes the
// damage-reaction "while below N% HP", extra-action "If its HP is below", enemy-scaling "when
// the target is below N%", and ally-filter "allies below N% HP".
describe('detectHpCrossingTrigger', () => {
    const at = (text: string, needle: string) =>
        detectHpCrossingTrigger(text, text.indexOf(needle));

    it('Tycho p2: Barrier "when HP drops below 40%" once per battle → oncePerCombat true', () => {
        const text =
            'At the start of combat, this Unit gains <unit-skill>Cheat Death</unit-skill> and <unit-skill>Everliving Regeneration II</unit-skill> for 9 turns. Once per battle, when HP drops below 40% it gains <unit-skill>Barrier</unit-skill> for 1 turn.';
        expect(at(text, 'Barrier')).toEqual({
            trigger: 'on-hp-threshold-crossed',
            hpBelowPct: 40,
            oncePerCombat: true,
        });
    });

    it('Tycho p2: Cheat Death (different sentence, no crossing verb) → undefined', () => {
        const text =
            'At the start of combat, this Unit gains <unit-skill>Cheat Death</unit-skill> and <unit-skill>Everliving Regeneration II</unit-skill> for 9 turns. Once per battle, when HP drops below 40% it gains <unit-skill>Barrier</unit-skill> for 1 turn.';
        expect(at(text, 'Cheat Death')).toBeUndefined();
    });

    it('Tycho p2: Everliving Regeneration II (same start-of-combat sentence) → undefined', () => {
        const text =
            'At the start of combat, this Unit gains <unit-skill>Cheat Death</unit-skill> and <unit-skill>Everliving Regeneration II</unit-skill> for 9 turns. Once per battle, when HP drops below 40% it gains <unit-skill>Barrier</unit-skill> for 1 turn.';
        expect(at(text, 'Everliving Regeneration II')).toBeUndefined();
    });

    it('Shelter p2: BOTH Barrier + Inc. Damage Down II match (abbreviation masking)', () => {
        // The "Inc." period must NOT split the sentence mid buff-name, or the Inc. Damage Down
        // II anchor would fall in a phantom sentence missing the crossing clause.
        const text =
            'This Unit gains <unit-skill>Barrier</unit-skill> for 1 turn and <unit-skill>Inc. Damage Down II</unit-skill> for 3 turns when HP drops below 20%, once per battle.';
        const expected = {
            trigger: 'on-hp-threshold-crossed' as const,
            hpBelowPct: 20,
            oncePerCombat: true,
        };
        expect(at(text, 'Barrier')).toEqual(expected);
        expect(at(text, 'Inc. Damage Down II')).toEqual(expected);
    });

    it('Los p1: Barrier "when HP falls below 50%" (own br-sentence) → oncePerCombat true', () => {
        const text =
            'This Unit deals 30% more Direct damage when its HP is below 50%. Once per battle when HP falls below 50%, it grants <unit-skill>Barrier</unit-skill> for 1 turn.';
        expect(at(text, 'Barrier')).toEqual({
            trigger: 'on-hp-threshold-crossed',
            hpBelowPct: 50,
            oncePerCombat: true,
        });
    });

    it('Los p1: the "30% more Direct damage … when its HP is below 50%" clause → undefined', () => {
        // No drops/falls verb in that sentence; anchoring there must not match.
        const text =
            'This Unit deals 30% more Direct damage when its HP is below 50%. Once per battle when HP falls below 50%, it grants <unit-skill>Barrier</unit-skill> for 1 turn.';
        expect(at(text, '30% more Direct damage')).toBeUndefined();
    });

    it('Kafa p1: Terran Tenacity I "when HP drops below 50%" → oncePerCombat false', () => {
        const text =
            'This Unit gains <unit-skill>Terran Tenacity I</unit-skill> for 3 turns when HP drops below 50%.';
        expect(at(text, 'Terran Tenacity I')).toEqual({
            trigger: 'on-hp-threshold-crossed',
            hpBelowPct: 50,
            oncePerCombat: false,
        });
    });

    it('Redeemer p1: Defense Up II "When HP drops below 60%" (br-separated) → oncePerCombat false', () => {
        const text =
            'This Unit gains <unit-damage>Shield equal to 2.5%</unit-damage> of its Max HP every turn. When HP drops below 60% it gains <unit-skill>Defense Up II</unit-skill> for 4 turns.';
        expect(at(text, 'Defense Up II')).toEqual({
            trigger: 'on-hp-threshold-crossed',
            hpBelowPct: 60,
            oncePerCombat: false,
        });
    });

    it('Redeemer p1: per-turn Shield sentence (no crossing verb) → undefined', () => {
        const text =
            'This Unit gains <unit-damage>Shield equal to 2.5%</unit-damage> of its Max HP every turn. When HP drops below 60% it gains <unit-skill>Defense Up II</unit-skill> for 4 turns.';
        expect(at(text, 'Shield equal to 2.5%')).toBeUndefined();
    });

    // Negative guards — non-crossing HP phrasings must all return undefined.
    it('Makoli "while below 40% HP" (damage-reaction) → undefined', () => {
        const text =
            'When directly damaged while below 40% HP, this Unit <unit-damage>repairs 20%</unit-damage> of its Max HP and inflicts <unit-skill>Disable</unit-skill> for 1 turn.';
        expect(at(text, 'Disable')).toBeUndefined();
    });

    it('Tormenter "If its HP is below 50%" (extra-action) → undefined', () => {
        const text =
            'This Unit deals <unit-damage>180% damage</unit-damage> with a guaranteed critical hit. If its HP is below 50%, it <unit-aid>gains 1 Extra Action</unit-aid>.';
        expect(at(text, 'Extra Action')).toBeUndefined();
    });

    it('Tithonus "when the target is below 10% HP" (enemy-scaling) → undefined', () => {
        const text =
            'This Unit deals <unit-damage>200% damage</unit-damage>, increased to <unit-damage>300% damage</unit-damage> when the target is below 10% HP.';
        expect(at(text, '300% damage')).toBeUndefined();
    });

    it('Chimei "allies below 40% HP" (ally-filter) → undefined', () => {
        const text =
            'At the end of the round, this Unit <unit-damage>repairs 10%</unit-damage> of its Max HP to allies below 40% HP and grants them <unit-skill>Barrier</unit-skill> for 1 turn.';
        expect(at(text, 'Barrier')).toBeUndefined();
    });

    it('negative pos → undefined', () => {
        expect(
            detectHpCrossingTrigger('when HP drops below 40% it gains Barrier.', -1)
        ).toBeUndefined();
    });
});

// Phase 4c PR 3 (Task 6): Hermes charged-skill "If the target has less than N% HP" gate on a
// grant clause. Sentence-scoped at the grant's anchor; requires "the target".
describe('detectTargetHpGate', () => {
    const at = (text: string, needle: string) => detectTargetHpGate(text, text.indexOf(needle));

    it('Hermes charged: "If the target has less than 40% HP, it grants Cheat Death" → hpBelowPct 40', () => {
        const text =
            'This Unit <unit-damage>repairs 37%</unit-damage> of its Max HP and <unit-aid>adds 1 charge</unit-aid> to the Charged Skill. If the target has less than 40% HP, it grants <unit-skill>Cheat Death</unit-skill>.';
        expect(at(text, 'Cheat Death')).toEqual({ hpBelowPct: 40 });
    });

    it('Hermes charged: the repair sentence (no target gate) → undefined', () => {
        const text =
            'This Unit <unit-damage>repairs 37%</unit-damage> of its Max HP and <unit-aid>adds 1 charge</unit-aid> to the Charged Skill. If the target has less than 40% HP, it grants <unit-skill>Cheat Death</unit-skill>.';
        expect(at(text, 'repairs 37%')).toBeUndefined();
    });

    it('no "the target" in the gated text → undefined', () => {
        const text =
            'This Unit gains <unit-skill>Terran Tenacity I</unit-skill> for 3 turns when HP drops below 50%.';
        expect(at(text, 'Terran Tenacity I')).toBeUndefined();
    });

    it('negative pos → undefined', () => {
        expect(
            detectTargetHpGate('If the target has less than 40% HP, it grants Cheat Death.', -1)
        ).toBeUndefined();
    });
});

describe('parseHealAbilities explicitTarget', () => {
    // The parser keeps defaulting bare repairs to target 'self' (the slot/damage-aware FLIP to
    // 'ally' lives in buildShipAbilities, not here). explicitTarget records whether a target
    // phrase was actually matched, so the flip can tell a bare default from a real 'self'.
    it('bare repair: target self, explicitTarget false', () => {
        expect(parseHealAbilities('This Unit Repairs 27% of its Max HP.')).toEqual([
            { kind: 'heal', pct: 27, basis: 'hp', target: 'self', explicitTarget: false },
        ]);
    });
    it('explicit "repairs itself": target self, explicitTarget true', () => {
        expect(
            parseHealAbilities(
                'This unit <unit-damage>repairs itself for 30%</unit-damage> of its Max HP.'
            )
        ).toEqual([{ kind: 'heal', pct: 30, basis: 'hp', target: 'self', explicitTarget: true }]);
    });
    it('explicit "the ally": target ally, explicitTarget true', () => {
        expect(
            parseHealAbilities(
                "This unit <unit-damage>repairs the ally for 4%</unit-damage> of this Unit's Max HP."
            )
        ).toEqual([{ kind: 'heal', pct: 4, basis: 'hp', target: 'ally', explicitTarget: true }]);
    });
});

describe('parseCleanse', () => {
    it('parses cleanse count', () => {
        expect(parseCleanse('it <unit-aid>cleanses 1</unit-aid> debuff from itself')).toEqual([
            { count: 1, target: 'self', explicitTarget: true },
        ]);
    });
    it('ally cleanse', () => {
        expect(parseCleanse('<unit-aid>Cleanses 2</unit-aid> debuffs from all allies')).toEqual([
            { count: 2, target: 'all-allies', explicitTarget: true },
        ]);
    });
    it('bare cleanse: target self, explicitTarget false', () => {
        expect(parseCleanse('This Unit <unit-aid>cleanses 1</unit-aid> debuff.')).toEqual([
            { count: 1, target: 'self', explicitTarget: false },
        ]);
    });
    it('does not parse purge as cleanse', () => {
        expect(parseCleanse('<unit-aid>purges 1</unit-aid> buff from the enemy')).toEqual([]);
    });
    it('parses "cleanse all" debuffs from all allies', () => {
        expect(parseCleanse('cleanses all debuffs from all allies')).toEqual([
            { count: 'all', target: 'all-allies', explicitTarget: true },
        ]);
    });
});

describe('parsePurge', () => {
    it('parses single-count purge from enemy', () => {
        expect(parsePurge('This Unit purges 1 buff from the enemy.')).toEqual([
            { count: 1, target: 'enemy', explicitTarget: true },
        ]);
    });
    it('parses "purges all" buffs from the enemy', () => {
        expect(parsePurge('purges all buffs from the enemy')).toEqual([
            { count: 'all', target: 'enemy', explicitTarget: true },
        ]);
    });
    it('parses "purges 1 buff from all enemies" (Amartya)', () => {
        expect(parsePurge('purges 1 buff from all enemies for every 50% crit power')).toEqual([
            {
                count: 1,
                target: 'all-enemies',
                explicitTarget: true,
                countScaling: { stat: 'critDamage', per: 50 },
            },
        ]);
    });
    it('parses "purges a buff from an enemy" (Sefuba p2 / Lodolite p3)', () => {
        expect(parsePurge('purges a buff from an enemy')).toEqual([
            { count: 1, target: 'enemy', explicitTarget: true },
        ]);
    });
    it('does not parse cleanse as purge', () => {
        expect(parsePurge('This Unit cleanses 1 debuff.')).toEqual([]);
    });
    it('does not match passive-voice "is Purged of all buffs" (deferred to C2b)', () => {
        expect(parsePurge('is Purged of all buffs')).toEqual([]);
    });
    it('context-free double-match on Sefuba p2 reactive text (EXPECTED — slot-gate in Task 3 excludes passives)', () => {
        // parsePurge is context-free: both "purges an enemy buff" and "purges 1 more buff"
        // match. Task 3 gates emission to active/charged slots only, so Sefuba's passive text
        // is never emitted. This assertion pins the known double-match as deliberate.
        const result = parsePurge(
            'when this unit purges an enemy buff, it repairs itself for 12% and purges 1 more buff from the enemy'
        );
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ count: 1, target: 'enemy', explicitTarget: true });
        expect(result[1]).toEqual({ count: 1, target: 'enemy', explicitTarget: true });
    });
});

describe('parsePurge — E4 crit-power scaling', () => {
    it('extracts countScaling from "for every 50% crit power"', () => {
        const text =
            'This Unit deals 210% damage and purges 1 buff from all enemies for every 50% crit power this Unit has.';
        const [p] = parsePurge(text);
        expect(p).toMatchObject({
            count: 1,
            target: 'all-enemies',
            countScaling: { stat: 'critDamage', per: 50 },
        });
    });

    it('leaves countScaling undefined for a plain purge', () => {
        const [p] = parsePurge('This Unit purges 2 buffs from the enemy.');
        expect(p.count).toBe(2);
        expect(p.countScaling).toBeUndefined();
    });
});

describe('parseHealNoCrit', () => {
    it('Pallas repair-cannot-crit sets heal noCrit', () => {
        expect(parseHealNoCrit('This repair cannot critically hit.')).toBe(true);
        expect(parseHealNoCrit('This attack cannot critically hit.')).toBe(false);
    });
});

describe('Chakara "starts each round with" extraction (Gap A)', () => {
    const txt =
        'This Unit starts each round with <unit-skill>Attack Up II</unit-skill> and <unit-skill>Defense Up II</unit-skill> for 1 turn if it has the lowest speed among all Allies. Then, deals <unit-damage>60% damage</unit-damage> to the highest Speed Enemy.';

    it('extracts BOTH self-buffs with duration 1', () => {
        const effects = parseSkillEffects(txt, 'passive2');
        const buffs = effects
            .filter((e) => e.target === 'self')
            .map((e) => e.buffName)
            .sort();
        expect(buffs).toEqual(['Attack Up II', 'Defense Up II']);
        for (const e of effects.filter((e) => e.target === 'self')) {
            expect(e.duration).toBe(1);
        }
    });

    it('maps the phrasing to the start-of-round trigger', () => {
        expect(detectReactiveTrigger(txt, 'Attack Up II')).toBe('start-of-round');
    });
});

describe('detectIgnoresForcedTargeting', () => {
    it('returns true for "ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill>" (Akula)', () => {
        expect(
            detectIgnoresForcedTargeting(
                "This Unit's attack ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> and deals 160% damage."
            )
        ).toBe(true);
    });

    it('returns true for "ignoring Taunt and Provoke" without tags (Anjian)', () => {
        expect(
            detectIgnoresForcedTargeting('This Unit deals 130% damage, ignoring Taunt and Provoke.')
        ).toBe(true);
    });

    it('returns true for "ignores Taunt and Provoke effects" (Judge passive)', () => {
        expect(
            detectIgnoresForcedTargeting(
                'This Unit ignores Taunt and Provoke effects and has 20% defense penetration'
            )
        ).toBe(true);
    });

    it('returns true for "ignores Taunt and Provoke, deals 230% damage" (Judge active)', () => {
        expect(
            detectIgnoresForcedTargeting(
                "This Unit's attack ignores Taunt and Provoke, deals 230% damage, and applies Concentrate Fire for 1 turn."
            )
        ).toBe(true);
    });

    it('returns false for a Provoke APPLIER (not an ignorer)', () => {
        expect(
            detectIgnoresForcedTargeting(
                'This Unit deals 180% damage and applies Provoke for 1 turn.'
            )
        ).toBe(false);
    });

    it('returns false for a condition reader ("against Taunted or Provoked enemies")', () => {
        expect(
            detectIgnoresForcedTargeting(
                'deals 180% damage with additional 60% damage against Taunted or Provoked enemies.'
            )
        ).toBe(false);
    });

    it('returns false for null', () => {
        expect(detectIgnoresForcedTargeting(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(detectIgnoresForcedTargeting(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(detectIgnoresForcedTargeting('')).toBe(false);
    });

    it('returns true when any of the variadic args matches', () => {
        expect(
            detectIgnoresForcedTargeting(
                null,
                'This Unit deals 130% damage, ignoring Taunt and Provoke.'
            )
        ).toBe(true);
    });
});

describe('parseDoesntBreakStasis', () => {
    it('detects Akula curly-apostrophe "don\'t break Stasis"', () => {
        expect(
            parseDoesntBreakStasis(
                'This Unit’s attacks don’t break Stasis. Increases outgoing direct damage by up to 30% based on the target’s current HP percentage; the higher the percentage, the more the damage.'
            )
        ).toBe(true);
    });

    it('detects bare "do not break Stasis" (Tygr — regression guard)', () => {
        expect(
            parseDoesntBreakStasis(
                'This Unit’s attacks do not break Stasis and deal 30% more damage to enemies with Stasis or Disable.'
            )
        ).toBe(true);
    });

    it('detects straight-apostrophe "don\'t break Stasis"', () => {
        expect(parseDoesntBreakStasis("This Unit's attacks don't break Stasis.")).toBe(true);
    });

    it('returns false for "affected by Stasis" (parseExtraAction owns that)', () => {
        expect(
            parseDoesntBreakStasis(
                'After dealing damage to an enemy affected by Stasis, once per round, give one extra action.'
            )
        ).toBe(false);
    });

    it('returns false for "damage to enemies under Stasis"', () => {
        expect(parseDoesntBreakStasis('deal 20% more damage to enemies under Stasis')).toBe(false);
    });

    it('returns false for "inflicts Stasis for 2 turns"', () => {
        expect(parseDoesntBreakStasis('inflicts Stasis for 2 turns')).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(parseDoesntBreakStasis('')).toBe(false);
    });

    it('returns false for null', () => {
        expect(parseDoesntBreakStasis(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(parseDoesntBreakStasis(undefined)).toBe(false);
    });
});

// C2b-1 T5: on-enemy-purged and on-ally-purged heal trigger detectors.
// All three RAW strings below are taken verbatim from docs/ship-skills.csv.
// Regexes must match THROUGH <unit-aid>/<unit-damage> tags (loose [^.;]* gaps).
const SEFUBA_P1_RAW =
    'When this Unit <unit-aid>purges a buff</unit-aid> from an enemy, it <unit-damage>repairs itself for 8%</unit-damage> Max HP.';
const SEFUBA_P2_RAW =
    'When this Unit <unit-aid>purges an enemy buff</unit-aid>, it <unit-damage>repairs itself for 12%</unit-damage> Max HP and <unit-aid>purges 1</unit-aid> more buff from the enemy.';
const SALVATION_P3_RAW =
    "When this Unit is destroyed it <unit-damage>repairs 80%</unit-damage> of its max HP to all allies.<br /><br />When a <unit-aid>buff</unit-aid> is <unit-aid>purged</unit-aid> from an ally, this Unit <unit-damage>repairs that ally for 5%</unit-damage> of this Unit's max HP.";

describe('detectEnemyPurgedTrigger', () => {
    it('returns on-enemy-purged for Sefuba p1 (anchor inside the purge sentence)', () => {
        const pos = SEFUBA_P1_RAW.search(/repairs itself/i);
        expect(detectEnemyPurgedTrigger(SEFUBA_P1_RAW, pos)).toBe('on-enemy-purged');
    });

    it('returns on-enemy-purged for Sefuba p2 (anchor inside the purge sentence)', () => {
        const pos = SEFUBA_P2_RAW.search(/repairs itself/i);
        expect(detectEnemyPurgedTrigger(SEFUBA_P2_RAW, pos)).toBe('on-enemy-purged');
    });

    it('returns undefined for Salvation p3 (no "this unit purges … enemy" phrasing)', () => {
        const pos = SALVATION_P3_RAW.search(/repairs that ally/i);
        expect(detectEnemyPurgedTrigger(SALVATION_P3_RAW, pos)).toBeUndefined();
    });

    it('is position-scoped: returns undefined when anchor is in a different sentence', () => {
        // Fabricated two-sentence text; anchor is in the non-purge first sentence.
        const text =
            'This Unit repairs 10% Max HP. When this Unit purges a buff from an enemy, it repairs itself for 8% Max HP.';
        expect(detectEnemyPurgedTrigger(text, text.indexOf('10%'))).toBeUndefined();
        expect(detectEnemyPurgedTrigger(text, text.search(/repairs itself/i))).toBe(
            'on-enemy-purged'
        );
    });

    it('returns undefined for negative anchor', () => {
        expect(detectEnemyPurgedTrigger(SEFUBA_P1_RAW, -1)).toBeUndefined();
    });
});

describe('detectAllyPurgedTrigger', () => {
    it('returns on-ally-purged for Salvation p3 (anchor inside the ally-purge sentence)', () => {
        const pos = SALVATION_P3_RAW.search(/repairs that ally/i);
        expect(detectAllyPurgedTrigger(SALVATION_P3_RAW, pos)).toBe('on-ally-purged');
    });

    it('returns undefined for Sefuba p1 (no "buff is purged from an ally" phrasing)', () => {
        const pos = SEFUBA_P1_RAW.search(/repairs itself/i);
        expect(detectAllyPurgedTrigger(SEFUBA_P1_RAW, pos)).toBeUndefined();
    });

    it('returns undefined for Sefuba p2 (no "buff is purged from an ally" phrasing)', () => {
        const pos = SEFUBA_P2_RAW.search(/repairs itself/i);
        expect(detectAllyPurgedTrigger(SEFUBA_P2_RAW, pos)).toBeUndefined();
    });

    it('is position-scoped: an anchor in the on-destroyed sentence of Salvation p3 is not stamped', () => {
        // The on-destroyed sentence is before the <br /><br /> — its "repairs 80%" anchor
        // must NOT get on-ally-purged.
        const pos = SALVATION_P3_RAW.search(/repairs 80%/i);
        expect(detectAllyPurgedTrigger(SALVATION_P3_RAW, pos)).toBeUndefined();
    });

    it('returns undefined for negative anchor', () => {
        expect(detectAllyPurgedTrigger(SALVATION_P3_RAW, -1)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// C2b-2 T4: detectEndOfRoundPurgeTrigger + detectMostBuffsTarget (Rhodium)
// RAW strings from docs/ship-skills.csv (Rhodium row).
// Regexes must match THROUGH <unit-aid> tags (loose [^.;]* gaps).
// ---------------------------------------------------------------------------
const RHODIUM_P1_RAW =
    'At the end of the round, this Unit <unit-aid>purges 2</unit-aid> buffs from the enemy with the most buffs.';
const RHODIUM_P2_RAW =
    'At the end of the round, this Unit <unit-aid>purges 2</unit-aid> buffs from the enemy with the most buffs and deals <unit-damage>80% damage</unit-damage> that cannot critically hit.';
// Iridium p1 — plain "from the enemy", no "end of the round".
const IRIDIUM_P1_RAW =
    'When directly damaged, This Unit <unit-aid>purges 1</unit-aid> buff from the enemy and inflicts <unit-skill>Speed Down I</unit-skill> for 1 turn.';

describe('detectEndOfRoundPurgeTrigger', () => {
    it('returns end-of-round for Rhodium p1 (anchor inside the purge sentence)', () => {
        const pos = RHODIUM_P1_RAW.search(/purge/i);
        expect(detectEndOfRoundPurgeTrigger(RHODIUM_P1_RAW, pos)).toBe('end-of-round');
    });

    it('returns end-of-round for Rhodium p2 (anchor inside the purge sentence)', () => {
        const pos = RHODIUM_P2_RAW.search(/purge/i);
        expect(detectEndOfRoundPurgeTrigger(RHODIUM_P2_RAW, pos)).toBe('end-of-round');
    });

    it('returns undefined for Iridium p1 (no "at the end of the round" phrase)', () => {
        const pos = IRIDIUM_P1_RAW.search(/purge/i);
        expect(detectEndOfRoundPurgeTrigger(IRIDIUM_P1_RAW, pos)).toBeUndefined();
    });

    it('returns undefined for negative anchor', () => {
        expect(detectEndOfRoundPurgeTrigger(RHODIUM_P1_RAW, -1)).toBeUndefined();
    });
});

// C2b-2 T6: detectKilledByDirectDamageTrigger (Faust)
// RAW strings from docs/ship-skills.csv (Faust row, passive 1 & 2).
const FAUST_P1_RAW =
    'This Unit <unit-aid>purges 2</unit-aid> buffs from the enemy when killed by direct Damage.';
const FAUST_P2_RAW =
    'This Unit <unit-aid>purges 3</unit-aid> buffs from the enemy when killed by direct Damage.';

describe('detectKilledByDirectDamageTrigger', () => {
    it('returns on-destroyed for Faust p1 (anchor inside the purge sentence)', () => {
        const pos = FAUST_P1_RAW.search(/purge/i);
        expect(detectKilledByDirectDamageTrigger(FAUST_P1_RAW, pos)).toBe('on-destroyed');
    });

    it('returns on-destroyed for Faust p2 (anchor inside the purge sentence)', () => {
        const pos = FAUST_P2_RAW.search(/purge/i);
        expect(detectKilledByDirectDamageTrigger(FAUST_P2_RAW, pos)).toBe('on-destroyed');
    });

    it('returns undefined for Iridium p1 (no "killed by direct damage" phrase)', () => {
        const pos = IRIDIUM_P1_RAW.search(/purge/i);
        expect(detectKilledByDirectDamageTrigger(IRIDIUM_P1_RAW, pos)).toBeUndefined();
    });

    it('returns undefined for Rhodium p1 (no "killed by direct damage" phrase)', () => {
        const pos = RHODIUM_P1_RAW.search(/purge/i);
        expect(detectKilledByDirectDamageTrigger(RHODIUM_P1_RAW, pos)).toBeUndefined();
    });

    it('returns undefined for negative anchor', () => {
        expect(detectKilledByDirectDamageTrigger(FAUST_P1_RAW, -1)).toBeUndefined();
    });
});

describe('detectMostBuffsTarget', () => {
    it('returns true for Rhodium p1 (anchor inside the purge sentence)', () => {
        const pos = RHODIUM_P1_RAW.search(/purge/i);
        expect(detectMostBuffsTarget(RHODIUM_P1_RAW, pos)).toBe(true);
    });

    it('returns true for Rhodium p2 (anchor inside the purge sentence)', () => {
        const pos = RHODIUM_P2_RAW.search(/purge/i);
        expect(detectMostBuffsTarget(RHODIUM_P2_RAW, pos)).toBe(true);
    });

    it('returns false for Iridium p1 (plain "from the enemy", no "most buffs")', () => {
        const pos = IRIDIUM_P1_RAW.search(/purge/i);
        expect(detectMostBuffsTarget(IRIDIUM_P1_RAW, pos)).toBe(false);
    });

    it('returns false for null / undefined text', () => {
        expect(detectMostBuffsTarget(null, 0)).toBe(false);
        expect(detectMostBuffsTarget(undefined, 0)).toBe(false);
    });

    it('returns false for negative anchor', () => {
        expect(detectMostBuffsTarget(RHODIUM_P1_RAW, -1)).toBe(false);
    });
});

describe('target-repaired-this-round (Nayra)', () => {
    const activeText =
        'This Unit inflicts <unit-skill>Defense Down II</unit-skill> and <unit-skill>Crit Rate Down III</unit-skill> for 2 turns, dealing <unit-damage>170% damage</unit-damage> and additional <unit-damage>damage equal to 30%</unit-damage> of its Defense.<br />If the target was repaired this round, inflict <unit-skill>Stasis</unit-skill> for 1 turn.';
    const chargedText =
        'This Unit inflicts <unit-skill>Attack Down II</unit-skill> and <unit-skill>Crit Power Down III</unit-skill> for 2 turns, dealing <unit-damage>210% damage</unit-damage> and additional <unit-damage>damage equal to 30%</unit-damage> of its defense.<br />If the target was repaired this round, inflict <unit-skill>Exposed</unit-skill> for 1 turn and purge all buffs from the enemy.';

    it('gates Stasis (active) on target-repaired-this-round', () => {
        expect(detectGrantConditions(activeText, 'Stasis')).toEqual([
            { subject: 'target-repaired-this-round', derivable: true },
        ]);
    });
    it('gates Exposed (charged) on target-repaired-this-round', () => {
        expect(detectGrantConditions(chargedText, 'Exposed')).toEqual([
            { subject: 'target-repaired-this-round', derivable: true },
        ]);
    });
    it('does NOT gate first-sentence debuffs (no repaired phrase in their clause)', () => {
        expect(detectGrantConditions(activeText, 'Defense Down II')).toEqual([]);
        expect(detectGrantConditions(chargedText, 'Attack Down II')).toEqual([]);
    });
    it('detects the condition position-scoped at the purge anchor', () => {
        const purgePos = chargedText.search(/purge/i);
        expect(detectRepairedThisRoundCondition(chargedText, purgePos)).toEqual({
            subject: 'target-repaired-this-round',
            derivable: true,
        });
        expect(
            detectRepairedThisRoundCondition(activeText, activeText.search(/purge/i))
        ).toBeUndefined();
    });
});

describe('parseChargeRemoval', () => {
    it('on-cast removal — Opal (amount 2)', () => {
        expect(
            parseChargeRemoval(
                'This Unit deals 70% damage with an additional damage equal to 11% of its Max HP, and removes 2 charges from the enemy.'
            )
        ).toEqual({ amount: 2, trigger: 'on-cast' });
    });

    it('on-cast removal — Provider (amount 1)', () => {
        expect(
            parseChargeRemoval(
                'This Unit deals 200% damage, removes 1 charge from the enemy, and extends active Damage Over Time effects by 1 turn.'
            )
        ).toEqual({ amount: 1, trigger: 'on-cast' });
    });

    it('on-cast removal — Sefuba charged (amount 2)', () => {
        expect(
            parseChargeRemoval('This Unit deals 200% damage and removes 2 charges from the enemy.')
        ).toEqual({ amount: 2, trigger: 'on-cast' });
    });

    it('bomb-detonated removal — Demolisher passive (amount 2)', () => {
        expect(
            parseChargeRemoval(
                "When a bomb explodes on an enemy, this unit removes 2 charges from the enemy's charged skill."
            )
        ).toEqual({ amount: 2, trigger: 'on-bomb-detonated' });
    });

    it('bomb-detonated removal — Demolisher charged (ignores adjacent-damage clause)', () => {
        expect(
            parseChargeRemoval(
                "When a Bomb explodes on an enemy, this Unit removes 2 charges from the enemy's Charged Skill and deals 100% of the Bomb's damage to all adjacent enemies."
            )
        ).toEqual({ amount: 2, trigger: 'on-bomb-detonated' });
    });

    it('every-2nd-repair removal — Zosimos (amount 1, everyNthEvent 2)', () => {
        expect(
            parseChargeRemoval(
                "When an enemy repairs, this unit gains a charge to its charged skill. Additionally, this unit decreases that enemy's charge by one for every second repair they perform."
            )
        ).toEqual({ amount: 1, trigger: 'on-enemy-repaired', everyNthEvent: 2 });
    });

    it('coexists with a gain in the same text — Thresh-style', () => {
        const text =
            "If the target is a Defender, this Unit removes 1 charge from the enemy and adds 1 charge to this Unit's Charged Skill.";
        expect(parseChargeRemoval(text)).toEqual({ amount: 1, trigger: 'on-cast' });
    });

    it('returns null for a pure gain (no removal clause)', () => {
        expect(parseChargeRemoval('This Unit adds 1 charge to its Charged Skill.')).toBeNull();
    });

    it('returns null for charge-loss immunity text (not a removal)', () => {
        expect(parseChargeRemoval('This Unit is immune to charge loss effects.')).toBeNull();
    });

    it('tolerates a curly apostrophe in "enemy’s charge"', () => {
        expect(
            parseChargeRemoval(
                'When an enemy repairs, this unit gains a charge. Additionally, this unit decreases that enemy’s charge by one for every second repair they perform.'
            )
        ).toEqual({ amount: 1, trigger: 'on-enemy-repaired', everyNthEvent: 2 });
    });
});

describe('parseEnemyChargedCastReaction (Curator enemy-charged-cast reaction)', () => {
    // Curator R0 (firstPassiveSkillText): purge only.
    it('R0 → a single purge ability (count 1) on on-enemy-charged-cast / enemy', () => {
        const abilities = parseEnemyChargedCastReaction(
            'When an enemy uses their charged skill, this unit purges 1 buffs from that enemy.'
        );
        expect(abilities).not.toBeNull();
        expect(abilities).toHaveLength(1);
        const purge = abilities![0];
        expect(purge.type).toBe('purge');
        expect(purge.trigger).toBe('on-enemy-charged-cast');
        expect(purge.target).toBe('enemy');
        expect(purge.config).toMatchObject({ type: 'purge', count: 1 });
    });

    // Curator R2 (secondPassiveSkillText): purge 1 + Block Buff for 1 turn.
    it('R2 → purge (count 1) + Block Buff debuff (duration 1, inflict)', () => {
        const abilities = parseEnemyChargedCastReaction(
            'When an enemy uses their charged skill, this unit purges 1 buffs from that enemy, and inflicts Block Buff for 1 turns.'
        );
        expect(abilities).not.toBeNull();
        expect(abilities).toHaveLength(2);

        const purge = abilities!.find((a) => a.type === 'purge')!;
        expect(purge).toBeDefined();
        expect(purge.trigger).toBe('on-enemy-charged-cast');
        expect(purge.target).toBe('enemy');
        expect(purge.config).toMatchObject({ type: 'purge', count: 1 });

        const debuff = abilities!.find((a) => a.type === 'debuff')!;
        expect(debuff).toBeDefined();
        expect(debuff.trigger).toBe('on-enemy-charged-cast');
        expect(debuff.target).toBe('enemy');
        expect(debuff.config).toMatchObject({
            type: 'debuff',
            buffName: 'Block Buff',
            duration: 1,
            application: 'inflict',
        });
    });

    // Curator R4 (thirdPassiveSkillText): purge 2 + Block Buff for 2 turns.
    it('R4 → purge (count 2) + Block Buff debuff (duration 2, inflict)', () => {
        const abilities = parseEnemyChargedCastReaction(
            'When an enemy uses their charged skill, this unit purges 2 buffs from that enemy, and inflicts Block Buff for 2 turns.'
        );
        expect(abilities).not.toBeNull();
        expect(abilities).toHaveLength(2);

        const purge = abilities!.find((a) => a.type === 'purge')!;
        expect(purge.config).toMatchObject({ type: 'purge', count: 2 });

        const debuff = abilities!.find((a) => a.type === 'debuff')!;
        expect(debuff.config).toMatchObject({
            type: 'debuff',
            buffName: 'Block Buff',
            duration: 2,
            application: 'inflict',
        });
    });

    it('strips unit tags and a Shield-Penetration preamble (real game-data form)', () => {
        const abilities = parseEnemyChargedCastReaction(
            '<unit-aid>Shield Penetration</unit-aid> increased.<br /><br />When an enemy uses their <unit-skill>charged skill</unit-skill>, this unit purges 2 buffs from that enemy, and inflicts Block Buff for 2 turns.'
        );
        expect(abilities).not.toBeNull();
        expect(abilities).toHaveLength(2);
        expect(abilities!.find((a) => a.type === 'purge')!.config).toMatchObject({ count: 2 });
        expect(abilities!.find((a) => a.type === 'debuff')!.config).toMatchObject({
            buffName: 'Block Buff',
            duration: 2,
        });
    });

    it('returns null for text without the enemy-charged-cast trigger phrase', () => {
        expect(
            parseEnemyChargedCastReaction('This unit purges 1 buffs from that enemy.')
        ).toBeNull();
        expect(parseEnemyChargedCastReaction('')).toBeNull();
        expect(parseEnemyChargedCastReaction(null)).toBeNull();
    });

    // FrontLine R2 (Task 6): reactive damage + shield, once per round. The shield is modelled
    // as basis:'attack', pct:24 (= round(30 * 80 / 100)) -- see the parser comment for the
    // derivation (shield kept on the same un-mitigated basis as the 80% reactive damage).
    const FRONTLINE_R2 =
        'When an enemy uses their charged skill, it deals 80% and gains a Shield equal to 30% of the damage dealt, once per round.';

    it('FrontLine -> exactly TWO abilities (damage + shield), both once-per-round', () => {
        const abilities = parseEnemyChargedCastReaction(FRONTLINE_R2);
        expect(abilities).not.toBeNull();
        expect(abilities).toHaveLength(2);
        expect(abilities!.every((a) => a.trigger === 'on-enemy-charged-cast')).toBe(true);
        expect(abilities!.every((a) => a.oncePerRound === true)).toBe(true);
    });

    it('FrontLine damage ability: enemy target, multiplier 80, hits 1', () => {
        const abilities = parseEnemyChargedCastReaction(FRONTLINE_R2)!;
        const damage = abilities.find((a) => a.type === 'damage')!;
        expect(damage).toBeDefined();
        expect(damage.target).toBe('enemy');
        expect(damage.config).toMatchObject({ type: 'damage', multiplier: 80, hits: 1 });
    });

    it('FrontLine shield ability: self target, basis attack, pct 24', () => {
        const abilities = parseEnemyChargedCastReaction(FRONTLINE_R2)!;
        const shield = abilities.find((a) => a.type === 'shield')!;
        expect(shield).toBeDefined();
        expect(shield.target).toBe('self');
        expect(shield.config).toMatchObject({ type: 'shield', basis: 'attack', pct: 24 });
    });

    // Cross-ship isolation (Task 5 follow-up): FrontLine text yields NO purge, NO debuff.
    it('FrontLine text yields NO purge and NO Block Buff debuff', () => {
        const abilities = parseEnemyChargedCastReaction(FRONTLINE_R2)!;
        expect(abilities.some((a) => a.type === 'purge')).toBe(false);
        expect(abilities.some((a) => a.type === 'debuff')).toBe(false);
    });

    // Curator-style text (purge + Block Buff, NO deals/shield) yields NO damage, NO shield,
    // and the purge/debuff abilities are NOT once-per-round (Curator clauses are unbounded).
    it('Curator text yields NO damage/shield and NO oncePerRound on purge/debuff', () => {
        const abilities = parseEnemyChargedCastReaction(
            'When an enemy uses their charged skill, this unit purges 2 buffs from that enemy, and inflicts Block Buff for 2 turns.'
        )!;
        expect(abilities.some((a) => a.type === 'damage')).toBe(false);
        expect(abilities.some((a) => a.type === 'shield')).toBe(false);
        expect(abilities.every((a) => a.oncePerRound === undefined)).toBe(true);
    });

    // Boundary (Task 5 reviewer request): trigger gate passes but NEITHER Curator nor
    // FrontLine effect clauses are present -> null.
    it('returns null when the trigger fires but no effect clause matches', () => {
        expect(
            parseEnemyChargedCastReaction(
                'When an enemy uses their charged skill, nothing relevant happens here.'
            )
        ).toBeNull();
    });

    // Real-corpus lock (Task 7): FrontLine's VERBATIM second-passive text from docs/ship-skills.csv
    // — full <unit-damage> tags AND the "Shield equal to 25% of its Max HP at the start of combat"
    // preamble (which must NOT be mistaken for the reaction's shield). Mirrors the Curator real-data
    // test (Task 5): exercises tag stripping + preamble exclusion on the genuine game string.
    it('FrontLine VERBATIM CSV second-passive text → exactly the damage(80)+shield(attack,24) pair', () => {
        const FRONTLINE_R2_VERBATIM =
            'This ship has 20% Shield Penetration.<br />While Shielded, it gains 2500 additional Defense.<br />This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.<br /><br />When an enemy uses their Charged skill, it deals <unit-damage>80%</unit-damage> and gains a Shield equal to <unit-damage>30%</unit-damage> of the damage dealt, once per round.';
        const abilities = parseEnemyChargedCastReaction(FRONTLINE_R2_VERBATIM);
        expect(abilities).not.toBeNull();
        expect(abilities).toHaveLength(2);
        expect(abilities!.every((a) => a.trigger === 'on-enemy-charged-cast')).toBe(true);
        expect(abilities!.every((a) => a.oncePerRound === true)).toBe(true);

        const damage = abilities!.find((a) => a.type === 'damage')!;
        expect(damage.target).toBe('enemy');
        expect(damage.config).toMatchObject({ type: 'damage', multiplier: 80, hits: 1 });

        const shield = abilities!.find((a) => a.type === 'shield')!;
        // basis:'attack', pct:24 (= round(30 × 80 / 100)) — the reaction's 30%-of-damage shield,
        // NOT the 25%-of-Max-HP start-of-combat preamble (which the parser correctly excludes here).
        expect(shield.target).toBe('self');
        expect(shield.config).toMatchObject({ type: 'shield', basis: 'attack', pct: 24 });
    });
});

describe('parseCounterAbilities', () => {
    // Combat G PR1: Stalwart shape ("When this Unit is directly damaged as a primary target,
    // it deals X% damage to that enemy"). PR2: Nyxen shield-hit shape.
    it('Nyxen first passive (100%): shield-hit counter, no primary-target requirement', () => {
        expect(
            parseCounterAbilities(
                'This Unit deals <unit-damage>100% damage</unit-damage> when its Shield is directly damaged.'
            )
        ).toEqual({ multiplier: 100, requirePrimaryTarget: false, requireShieldHit: true });
    });

    it('Nyxen second passive (200%): shield-hit counter', () => {
        expect(
            parseCounterAbilities(
                'This Unit deals <unit-damage>200% damage</unit-damage> when its Shield is directly damaged.'
            )
        ).toMatchObject({ multiplier: 200, requireShieldHit: true });
    });

    it('Stalwart regression: still primary-target, no shield flag', () => {
        expect(
            parseCounterAbilities(
                'When this Unit is directly damaged as a primary target, it deals <unit-damage>30% damage</unit-damage> to that enemy and gains <unit-skill>Legion Discipline II</unit-skill> for 3 turns.'
            )
        ).toMatchObject({ multiplier: 30, requirePrimaryTarget: true });
    });

    it('Centurion second passive (50%): self/adjacent-ally retaliate → allySubject, no primary-target/shield', () => {
        expect(
            parseCounterAbilities(
                'At the start of combat, this Unit gains 750 attack per adjacent ally.<br /><br />When this Unit or an adjacent ally is directly damaged, this Unit retaliates dealing <unit-damage>50%</unit-damage>.'
            )
        ).toEqual({ multiplier: 50, requirePrimaryTarget: false, allySubject: true });
    });

    it('Centurion third passive (100%): allySubject retaliate', () => {
        expect(
            parseCounterAbilities(
                'At the start of combat, this Unit gains 1000 attack per adjacent ally.<br /><br />When this Unit or an adjacent ally is directly damaged, this Unit retaliates dealing <unit-damage>100%</unit-damage>.'
            )
        ).toEqual({ multiplier: 100, requirePrimaryTarget: false, allySubject: true });
    });

    it('Stalwart/Nyxen do NOT set allySubject', () => {
        const stalwart = parseCounterAbilities(
            'When this Unit is directly damaged as a primary target, it deals <unit-damage>30% damage</unit-damage> to that enemy.'
        );
        expect(stalwart?.allySubject).toBeUndefined();
        const nyxen = parseCounterAbilities(
            'This Unit deals <unit-damage>100% damage</unit-damage> when its Shield is directly damaged.'
        );
        expect(nyxen?.allySubject).toBeUndefined();
    });

    it('returns null for empty/unmatched text', () => {
        expect(parseCounterAbilities(null)).toBeNull();
        expect(parseCounterAbilities('This Unit gains a Shield when attacked.')).toBeNull();
    });
});

describe('parseControlInflicts', () => {
    it('recognizes each inflicted control effect', () => {
        expect(
            parseControlInflicts(
                'Deals damage and applies <unit-skill>Provoke</unit-skill> for 1 turn'
            )
        ).toEqual([{ effect: 'provoke', pos: expect.any(Number), side: 'enemy' }]);
        expect(
            parseControlInflicts('inflicts <unit-skill>Disable</unit-skill> for 2 turns')[0].effect
        ).toBe('disable');
        expect(
            parseControlInflicts('apply <unit-skill>Concentrate Fire</unit-skill> for 1 turn')[0]
                .effect
        ).toBe('concentrate-fire');
    });

    it('recognizes Taunt as a self-grant', () => {
        expect(
            parseControlInflicts('This Unit gains <unit-skill>Taunt</unit-skill> for 1 turn')
        ).toEqual([{ effect: 'taunt', pos: expect.any(Number), side: 'self' }]);
    });

    it('does NOT treat an enemy-gains-Taunt condition as a self Taunt grant', () => {
        expect(
            parseControlInflicts(
                'When an enemy defender gains <unit-skill>Taunt</unit-skill>, deal +20% damage'
            )
        ).toEqual([]);
    });

    it('still recognizes a self Taunt grant', () => {
        expect(
            parseControlInflicts('This Unit gains <unit-skill>Taunt</unit-skill> for 1 turn')[0]
                .effect
        ).toBe('taunt');
    });

    it('keeps Stasis byte-identical', () => {
        expect(
            parseControlInflicts('inflicts <unit-skill>Stasis</unit-skill> for 2 turns')
        ).toEqual([{ effect: 'stasis', pos: expect.any(Number), side: 'enemy' }]);
    });

    it('anchors pos to the application tag for the common single-clause case', () => {
        // 'inflicts ' is 9 chars → the <unit-skill>Stasis tag starts at index 9.
        const text = 'inflicts <unit-skill>Stasis</unit-skill> for 2 turns';
        expect(parseControlInflicts(text)[0].pos).toBe(text.indexOf('<unit-skill>Stasis'));
    });

    it('anchors pos to the APPLICATION clause when the status is named in a prior condition', () => {
        // Stasis is mentioned first in a condition clause, then APPLIED later. pos must point at
        // the application-clause tag (the 2nd occurrence), not the 1st (condition) occurrence.
        const text =
            'If the target has <unit-skill>Stasis</unit-skill>, this Unit inflicts <unit-skill>Stasis</unit-skill> for 2 turns';
        const applicationTagPos = text.lastIndexOf('<unit-skill>Stasis');
        expect(applicationTagPos).not.toBe(text.indexOf('<unit-skill>Stasis'));
        expect(parseControlInflicts(text)[0].pos).toBe(applicationTagPos);
    });

    it('recognizes a control effect applied via a shared verb in a coordinated list', () => {
        const text =
            'inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns, and <unit-skill>Provoke</unit-skill> for 1 turn';
        expect(parseControlInflicts(text).map((c) => c.effect)).toContain('provoke');
    });

    it('does NOT match a control word in a condition clause', () => {
        expect(
            parseControlInflicts(
                'If the target has <unit-skill>Provoke</unit-skill>, deal +20% damage'
            )
        ).toEqual([]);
    });

    it('returns [] for non-control text', () => {
        expect(parseControlInflicts('Deals 300% damage')).toEqual([]);
    });
});
