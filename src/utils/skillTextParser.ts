import { BUFFS } from '../constants/buffs';
import { isFriendlySideStatus } from '../constants/friendlySideStatuses';
import { Ship } from '../types/ship';
import {
    SecondaryDamage,
    SecondaryDamageStat,
    StackTrigger,
    ConditionalDamage,
    ConditionalCondition,
    ChargeGain,
    EnemyBaseClass,
    DoTType,
} from '../types/calculator';
import {
    Ability,
    AbilityTrigger,
    Condition,
    ConditionSubject,
    ControlEffect,
    ReactiveScalingCountSource,
    RecipientFilter,
} from '../types/abilities';
import type { ShipRoleCategory } from '../constants/shipTypes';
import { FACTIONS, FACTION_KEYS, type FactionKey } from '../constants/factions';
import { getShipSkillRows } from './ship/skillRows';
import { CHEAT_DEATH_BUFFS } from './combat/cheatDeathBuffs';

/**
 * Represents a parsed segment of skill text
 */
export interface SkillTextSegment {
    text: string;
    type: 'unit-skill' | 'unit-damage' | 'unit-aid' | 'text';
    buffDescription?: string; // For unit-skill segments, contains buff description if found
}

/**
 * Parses skill text with custom HTML tags and extracts segments with semantic meaning
 *
 * Example input:
 * "This Unit <unit-aid>cleanses 1</unit-aid> debuff and deals <unit-damage>180% damage</unit-damage>"
 *
 * Example output:
 * [
 *   { text: "This Unit ", type: "text" },
 *   { text: "cleanses 1", type: "unit-aid" },
 *   { text: " debuff and deals ", type: "text" },
 *   { text: "180% damage", type: "unit-damage" }
 * ]
 */
export function parseSkillText(skillText: string | null | undefined): SkillTextSegment[] {
    if (!skillText) return [];

    const segments: SkillTextSegment[] = [];

    // Regular expression to match custom tags and their content
    // Matches: <unit-skill>text</unit-skill>, <unit-damage>text</unit-damage>, <unit-aid>text</unit-aid>
    const tagPattern = /<(unit-skill|unit-damage|unit-aid)>(.*?)<\/\1>/g;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tagPattern.exec(skillText)) !== null) {
        // Add text before the tag as a text segment
        if (match.index > lastIndex) {
            const textBefore = skillText.substring(lastIndex, match.index);
            segments.push({ text: textBefore, type: 'text' });
        }

        // Add the tagged content
        const tagType = match[1] as 'unit-skill' | 'unit-damage' | 'unit-aid';
        const tagContent = match[2];

        const segment: SkillTextSegment = {
            text: tagContent,
            type: tagType,
        };

        // For unit-skill tags, try to find the buff description
        if (tagType === 'unit-skill') {
            segment.buffDescription = findBuffDescription(tagContent);
        }

        segments.push(segment);
        lastIndex = tagPattern.lastIndex;
    }

    // Add remaining text after the last tag
    if (lastIndex < skillText.length) {
        const textAfter = skillText.substring(lastIndex);
        segments.push({ text: textAfter, type: 'text' });
    }

    return segments;
}

// DoT families are debuffs even when not listed in BUFFS as such.
const DOT_DEBUFF_PREFIXES = new Set(['corrosion', 'inferno', 'bomb', 'acidic']);

/**
 * Classifies an effect referenced on an enemy ("enemies with <effect>") as a buff or debuff,
 * using the BUFFS type and DoT families. Defaults to debuff when unknown — most "enemies with X"
 * gates reference a debuff the unit applies (Stealth is the notable buff exception, found in BUFFS).
 */
export function classifyEnemyEffect(name: string): 'buff' | 'debuff' {
    // Side override ahead of the DoT-prefix and BUFFS lookups: a friendly-side negative status is
    // held in the carrier's BUFF-name store, so a gate reading it off an enemy must build an
    // 'enemy-buff' condition. See FRIENDLY_SIDE_STATUSES for why valence and side differ.
    if (isFriendlySideStatus(name)) return 'buff';
    if (DOT_DEBUFF_PREFIXES.has(name.toLowerCase().split(' ')[0])) return 'debuff';
    const found = BUFFS.find((b) => b.name.toLowerCase() === name.toLowerCase());
    return found?.type === 'buff' ? 'buff' : 'debuff';
}

/**
 * Finds buff description from the BUFFS constant
 * Handles exact matches and partial matches (e.g., "Corrosion I" matches "Corrosion 1")
 */
export function findBuffDescription(buffName: string): string | undefined {
    // Try exact match first
    const exactMatch = BUFFS.find((buff) => buff.name === buffName);
    if (exactMatch) return exactMatch.description;

    // Try case-insensitive match
    const caseInsensitiveMatch = BUFFS.find(
        (buff) => buff.name.toLowerCase() === buffName.toLowerCase()
    );
    if (caseInsensitiveMatch) return caseInsensitiveMatch.description;

    // Handle Roman numeral to number conversion (e.g., "Corrosion I" -> "Corrosion 1")
    const romanToNumber: Record<string, string> = {
        I: '1',
        II: '2',
        III: '3',
        IV: '4',
        V: '5',
    };

    for (const [roman, number] of Object.entries(romanToNumber)) {
        if (buffName.includes(` ${roman}`)) {
            const convertedName = buffName.replace(` ${roman}`, ` ${number}`);
            const match = BUFFS.find((buff) => buff.name === convertedName);
            if (match) return match.description;
        }
    }

    return undefined;
}

/**
 * Extracts all buff/skill names from skill text (for backwards compatibility)
 */
export function extractSkillNames(skillText: string | null | undefined): string[] {
    if (!skillText) return [];

    const skillPattern = /<unit-skill>(.*?)<\/unit-skill>/g;
    const matches: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = skillPattern.exec(skillText)) !== null) {
        matches.push(match[1]);
    }

    return [...new Set(matches)]; // Remove duplicates
}

// Epic PR1 (skill-model gap, finding family 1): a <unit-damage> tag whose CONTENT says "X% less
// damage" is an INCOMING-damage reduction (Voron "takes 20% less damage from DoTs", Malvex "takes
// 10% less damage"), never an outgoing attack multiplier.
//
// A bare `\bless\b`, deliberately mirroring the `\bmore\b` guard in parseSkillDamage: the previous
// /\bless\s+damage\b/ required the two words ADJACENT, so Fuying's "30% less direct damage" slipped
// through and parseInt minted a phantom outgoing damage{30} from a damage-reduction aura (#363).
// Measured over all 149 corpus ships: every <unit-damage> tag whose content contains "less" is
// incoming reduction (Fuying x3, Malvex, Voron) — there is no legitimate attack tag for the wider
// pattern to suppress.
const LESS_DAMAGE_RE = /\bless\b/i;
// A tag reading "X% damage" immediately followed by " reduction …" (Tormenter "gains up to 30%
// damage reduction as its health decreases") is the same incoming-reduction family — the
// "reduction" noun sits just outside the tag, in the next ~15 chars.
const DAMAGE_REDUCTION_FOLLOWING_RE = /^\s*reduction\b/i;
// A bare percentage tag ("<unit-damage>30%</unit-damage>") preceded by "Shield equal to " is a
// shield-scaling clause ("gains a Shield equal to 30% of the damage dealt", FrontLine) — the
// nearby word "damage" describes what the SHIELD scales off of, not an attack the tag itself
// represents.
const SHIELD_EQUAL_TO_LEAD_IN_RE = /shield\s+equal\s+to\s*$/i;

/**
 * Returns the first <unit-damage>X% ...</unit-damage> value in skill text.
 * Skips values where the 20 characters after the tag start with " of its" or " of this"
 * (stat-based damage like "30% of its DEF" or "10% of this Unit's max HP" —
 * must be added manually as a buff).
 * Secondary damage tags (conditional/situational bonuses) are ignored.
 * Also skips incoming-damage-reduction clauses ("X% less damage", "X% damage reduction") and
 * shield-scaled-off-damage clauses ("Shield equal to X% of the damage dealt") — neither is an
 * outgoing attack, even though both sit near the word "damage" (PR1 phantom-ability suppression).
 * Returns an integer percentage (e.g. 190 for "190% damage"), or 0 if none found.
 */
export function parseSkillDamage(text: string): number {
    if (!text) return 0;
    const tagPattern = /<unit-damage>(.*?)<\/unit-damage>/g;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(text)) !== null) {
        const tagEndIndex = match.index + match[0].length;
        const following = text
            .slice(tagEndIndex, Math.min(text.length, tagEndIndex + 20))
            .toLowerCase();
        if (following.startsWith(' of its') || following.startsWith(' of this')) continue;
        // "X% more (direct) damage" is a passive output MODIFIER, not a base skill
        // multiplier — skip it (parseModifier handles it). e.g. Thresh's passive.
        if (/\bmore\b/i.test(match[1])) continue;
        // Incoming-damage reduction, either "X% less damage" inside the tag or "X% damage"
        // immediately followed by "reduction" outside it — not an outgoing attack.
        if (LESS_DAMAGE_RE.test(match[1])) continue;
        if (DAMAGE_REDUCTION_FOLLOWING_RE.test(following)) continue;
        // "Shield equal to X%" lead-in immediately before the tag — a shield scaled off damage
        // dealt, not the damage itself.
        const preceding = text.slice(Math.max(0, match.index - 30), match.index);
        if (SHIELD_EQUAL_TO_LEAD_IN_RE.test(preceding)) continue;
        // <unit-damage> is also used for non-damage numbers (e.g. "7.5% defense
        // penetration", "repairs 20%"). Only treat it as a base multiplier when the
        // tag content or the following text actually mentions damage.
        const content = match[1].toLowerCase();
        if (!content.includes('damage') && !following.includes('damage')) continue;
        let numeric = parseInt(match[1], 10);
        // Non-numeric-leading base-damage tag: "Damage equal to 70%" (Madax's active — the tag
        // itself carries the base multiplier, unlike the "damage equal to X% of its Defense/max
        // HP" additional-damage shape, which is always excluded above by the "of its"/"of this"
        // following-text check before reaching this line). Scoped narrowly to a LEADING
        // "damage equal to" so it can't pick up an unrelated "Shield equal to X%" tag (Malvex,
        // FrontLine) or an "increases damage by X%" conditional modifier tag (Zeolite, Obsidian)
        // elsewhere in the corpus, neither of which is base skill damage.
        if (isNaN(numeric)) {
            const damageEqualTo = /^damage\s+equal\s+to\s+(\d+(?:\.\d+)?)\s*%/i.exec(match[1]);
            if (damageEqualTo) numeric = parseFloat(damageEqualTo[1]);
        }
        if (!isNaN(numeric)) return numeric;
    }
    return 0;
}

/** A parsed counterattack consequence (Combat G PR1: Stalwart; PR2: Nyxen). */
export interface ParsedCounterAbility {
    /** raw percentage of the OWNER's effective attack, e.g. 30/70. */
    multiplier: number;
    /** true when the trigger clause says "as a primary target" (Stalwart). */
    requirePrimaryTarget: boolean;
    /** G PR2: true for "deals X% damage when its Shield is directly damaged" (Nyxen). */
    requireShieldHit?: boolean;
    /** G PR2: true for "when this Unit or an adjacent ally is directly damaged …
     *  retaliates dealing X%" (Centurion) — routes to self + adjacent-ally counters. */
    allySubject?: boolean;
}

/**
 * Parses a counterattack consequence from PASSIVE skill text (Combat G PR1: Stalwart ONLY).
 *
 * Recognizes the shape: "When this Unit is directly damaged [as a primary target], it deals
 * <unit-damage>X% damage</unit-damage> to that enemy …". The discriminator is the consequence
 * verb — "it deals X% damage to that enemy" inside a "directly damaged" trigger clause. Heal
 * ("repairs"), shield ("gains a Shield"), and reflect ("reflects X% of the Damage taken")
 * consequences are NOT counters and produce nothing here.
 *
 * PR2: Nyxen's shield-hit shape ("This Unit deals X% damage when its Shield is directly
 * damaged.") IS handled and returns requireShieldHit: true. Centurion's adjacent-ally
 * retaliate shape ("When this Unit or an adjacent ally is directly damaged, this Unit
 * retaliates dealing X%.") IS handled and returns allySubject: true.
 */
export function parseCounterAbilities(
    text: string | null | undefined
): ParsedCounterAbility | null {
    if (!text) return null;
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    // Trigger clause + counter consequence must co-occur in the same sentence.
    // Stalwart: "When this Unit is directly damaged as a primary target, it deals 30% damage
    // to that enemy …". Anchor the % on the "deals X% damage to that enemy" consequence.
    const stalwart =
        /when\s+this\s+unit\s+is\s+directly\s+damaged(?<primary>\s+as\s+a\s+primary\s+target)?[^.;]*?\bit\s+deals\s+(\d+(?:\.\d+)?)%\s+damage\s+to\s+that\s+enemy/i.exec(
            plain
        );
    if (stalwart) {
        const m = parseFloat(stalwart[2]);
        if (!isNaN(m))
            return { multiplier: m, requirePrimaryTarget: Boolean(stalwart.groups?.primary) };
    }

    // Nyxen: "This Unit deals X% damage when its Shield is directly damaged." (consequence
    // precedes the trigger; "its Shield … directly damaged" is the discriminator).
    const nyxen =
        /this\s+unit\s+deals\s+(\d+(?:\.\d+)?)%\s+damage\s+when\s+its\s+shield\s+is\s+directly\s+damaged/i.exec(
            plain
        );
    if (nyxen) {
        const m = parseFloat(nyxen[1]);
        if (!isNaN(m))
            return { multiplier: m, requirePrimaryTarget: false, requireShieldHit: true };
    }

    // Centurion: "When this Unit or an adjacent ally is directly damaged, this Unit retaliates
    // dealing X%." NOTE: the <unit-damage> tag wraps just "X%" — do NOT require the word "damage".
    const centurion =
        /when\s+this\s+unit\s+or\s+an\s+adjacent\s+ally\s+is\s+directly\s+damaged[^.;]*?\bretaliates\s+dealing\s+(\d+(?:\.\d+)?)%/i.exec(
            plain
        );
    if (centurion) {
        const m = parseFloat(centurion[1]);
        if (!isNaN(m)) return { multiplier: m, requirePrimaryTarget: false, allySubject: true };
    }

    return null;
}

/** A parsed damage-reflection consequence (epic PR12(A): Nosorog). Distinct from
 *  {@link ParsedCounterAbility} — reflect scales off the DAMAGE TAKEN, not the owner's own
 *  attack stat (the Reflect gear set's existing `damage-reflection` shape). */
export interface ParsedDamageReflection {
    /** Percentage of the incoming direct damage reflected back to the attacker. */
    pct: number;
    /** True when the trigger clause says "as a primary target" (Nosorog). */
    requirePrimaryTarget: boolean;
}

/**
 * Parses a "reflects X% of the Damage taken back to the enemy [when directly damaged as a
 * primary target]" passive clause (Nosorog — epic PR12(A)). Distinct from the counter shapes
 * above ("it deals X% damage to that enemy", scaled off the OWNER's attack) — this scales off
 * the damage the owner itself just took. Mirrors the Reflect gear set's `damage-reflection`
 * config shape (buildEquipmentAbilities.ts REFLECT), adding the optional primary-target gate
 * the gear set never carries.
 */
export function parseDamageReflection(
    text: string | null | undefined
): ParsedDamageReflection | null {
    if (!text) return null;
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    const m =
        /reflects\s+(\d+(?:\.\d+)?)%\s+of\s+the\s+damage\s+taken\s+back\s+to\s+the\s+enemy(?<primary>[^.;]*?\bas\s+a\s+primary\s+target)?/i.exec(
            plain
        );
    if (!m) return null;
    const pct = parseFloat(m[1]);
    if (isNaN(pct)) return null;
    return { pct, requirePrimaryTarget: Boolean(m.groups?.primary) };
}

/**
 * Returns the secondary stat-based damage from a skill, e.g.
 * "additional damage equal to <unit-damage>80%</unit-damage> of its Defense".
 * Captures only the BASE percentage — conditional extras
 * ("an extra 30% per enemy buff") are ignored. Supports Defense, max HP, and (PR9a)
 * current Shield ("additional damage equal to 60% of their current Shield" — Malvex,
 * Quixilver, FrontLine; pronoun varies "its"/"their"/"this Unit's").
 * The percentage may be a decimal (e.g. Selenite's charged "17.5% of max HP").
 * Returns null if none found.
 */
export function parseSecondaryDamage(text: string | null | undefined): SecondaryDamage | null {
    if (!text) return null;
    // The percentage may sit at the start of the tag ("<unit-damage>80%…") or after a
    // "damage equal to" lead-in inside the tag ("<unit-damage>damage equal to 30%</unit-damage>
    // of its Defense", e.g. Nayra). The lead-in is restricted to "damage equal to" so unrelated
    // tagged values like "Shield equal to 25% of its Max HP" (FrontLine) are NOT misread as
    // secondary damage. The Shield basis is always phrased "current Shield" (never bare
    // "Shield") — that word distinguishes it from a "Shield equal to X% of Max HP" GRANT tag,
    // which fails the tag-prefix requirement above regardless (its digit follows "Shield equal
    // to", not "damage equal to" / the tag open). "their" joins "its"/"this Unit's" as a
    // pronoun ONLY the Shield-basis corpus rows use (FrontLine) — verified no corpus
    // Defense/HP row uses "their", so this is a strict superset with no new false positives.
    // #361 — the stat MULTIPLE form, checked FIRST because it carries no '%' and so can never
    // collide with the percentage pattern below. "This Unit deals damage equal to 50x its
    // security" is 50 TIMES the stat, not 50% of attack, and is carried as pct = N * 100 so it
    // rides the existing SecondaryDamage machinery unchanged.
    //
    // Unlike the percentage form, the "damage equal to" lead-in sits OUTSIDE the tag here, so it is
    // required before the tag rather than optionally inside it — that lead-in is what makes the
    // clause damage at all, and without it a bare "50x" tag elsewhere would be picked up blind.
    //
    // The stat comes from an explicit alternation, never a catch-all: the executor resolves the
    // basis with a ternary chain that falls through to HP, so an unrecognised stat reaching it
    // would silently deal HP-scaled damage. Returning null leaves such a clause unmodelled (and
    // therefore still visible to audit:skills) rather than quietly wrong. Measured over all 149
    // corpus ships: exactly 2 rows use this form — Prophet's active (50x) and charged (120x),
    // both security.
    const multiplePattern =
        /damage\s+equal\s+to\s*<unit-damage>\s*(\d+(?:\.\d+)?)\s*x\s*<\/unit-damage>\s*(?:of\s+)?(?:its|their|this\s+unit'?s)?\s*(security)\b/i;
    const multipleMatch = multiplePattern.exec(text);
    if (multipleMatch) {
        const times = parseFloat(multipleMatch[1]);
        if (!isNaN(times)) return { stat: 'security', pct: times * 100 };
    }
    const pattern =
        /<unit-damage>(?:damage\s+equal\s+to\s+)?(\d+(?:\.\d+)?)%[^<]*<\/unit-damage>\s*of\s+(?:its|their|this\s+unit'?s)\s+(?:current\s+)?(defense|(?:max\s+)?hp|shield)/i;
    const match = pattern.exec(text);
    if (!match) return null;
    // Clause guard: a match whose sentence is a heal ("repairs … an additional X% of
    // its Max HP") or a clearly-reactive Phase-4 proc ("When this Unit resists …",
    // "Upon being killed …") is NOT on-cast secondary damage. Sentence-scoped so an
    // earlier sentence's repair can't block a later legitimate secondary. NOTE: the
    // prefix keeps non-<br> tags inline (only sentence boundaries are normalized) —
    // sufficient for the known texts, where the guard words are plain prose. This is the
    // SAME guard that keeps Xcellence's "when an enemy resists a debuff infliction, this
    // Unit deals damage equal to 115% of this Unit's current shield" reactive proc out of
    // this on-cast mechanic even though its stat is 'shield' too — it is modeled separately
    // by parseOnResistShieldDamage below (Ship-kit W8).
    const plainBefore = text.slice(0, match.index).replace(/<br\s*\/?>/gi, '. ');
    const sentenceStart = Math.max(plainBefore.lastIndexOf('. '), plainBefore.lastIndexOf('; '));
    const sentencePrefix = plainBefore.slice(sentenceStart + 1).toLowerCase();
    if (/\brepair/.test(sentencePrefix)) return null;
    if (/\bresists?\b[^.]*\bdebuff|upon being killed|upon being destroyed/.test(sentencePrefix))
        return null;
    const pct = parseFloat(match[1]);
    if (isNaN(pct)) return null;
    const statRaw = match[2].toLowerCase();
    const stat: SecondaryDamageStat = statRaw.includes('hp')
        ? 'hp'
        : statRaw.includes('shield')
          ? 'shield'
          : 'defense';
    // SP-C: a leading "If this Unit has more HP/Crit Power than the target/enemy, it
    // additionally deals …" gate on THIS rider (Cobalt). sentencePrefix is exactly the clause
    // text preceding the secondary-damage tag within the same sentence, so this is naturally
    // scoped to the rider's own gate and can't pick up an unrelated earlier-sentence comparison.
    const condition = statVsTargetConditionFromClause(sentencePrefix);
    return { stat, pct, ...(condition ? { condition } : {}) };
}

/**
 * SP-F F1 — Panon's self-scoped "instead"-branch damage replacement: "… deals <unit-damage>80%
 * damage</unit-damage> with an additional Damage equal to <unit-damage>70%</unit-damage> of its
 * Defense. If this Unit is Provoked or Taunted, this Unit instead gains … and deals
 * <unit-damage>120% damage</unit-damage> with an additional Damage equal to <unit-damage>90%
 * </unit-damage> of its Defense." (charged: 140/100 → 170/130, "affected by Provoke or Taunt"
 * phrasing). Returns the REPLACEMENT branch's multiplier + secondary only — the BASE 80%/70%
 * (140%/100%) is unchanged, still read by parseSkillDamage/parseSecondaryDamage on the full text
 * (both always return the FIRST tag, which precedes "instead"). Guarded to a SELF-scoped
 * Provoke/Taunt gate in the clause immediately preceding "instead" (no "target"/"enemy" subject)
 * so this can never fire on an unrelated enemy-conditional "instead" clause — the same self-vs-
 * enemy disambiguation ENEMY_AFFECTED_BONUS_RE's doc comment above already relies on. Returns
 * null when no such replacement clause is present (every other ship in the corpus today).
 */
export function parseInsteadDamageReplacement(
    text: string | null | undefined
): { mult: number; secondary: SecondaryDamage | null } | null {
    if (!text) return null;
    const insteadIdx = text.search(/\binstead\b/i);
    if (insteadIdx < 0) return null;
    const priorPeriod = text.lastIndexOf('.', insteadIdx);
    const clause = stripUnitTags(text.slice(priorPeriod + 1, insteadIdx));
    const selfGated =
        /\bthis\s+unit\b[^.]*?\b(?:provoke[ds]?|taunt(?:ed)?)\b/i.test(clause) &&
        !/\btarget\b|\benem(?:y|ies)\b/i.test(clause);
    if (!selfGated) return null;
    const after = text.slice(insteadIdx);
    const mult = parseSkillDamage(after);
    if (!mult) return null;
    const secondary = parseSecondaryDamage(after);
    return { mult, secondary };
}

/**
 * Vindicator p2 reactive proc: "When this Unit resists a debuff infliction from an enemy, it deals
 * <unit-damage>damage equal to X%</unit-damage> of this Unit's max HP to that enemy." Standalone
 * HP-scaled REACTIVE damage — NOT an on-cast rider (parseSecondaryDamage deliberately parks the
 * "resists … debuff" clause at its sentence guard). Returns { pct } or null.
 */
export function parseOnResistHpDamage(text: string | null | undefined): { pct: number } | null {
    if (!text) return null;
    const re =
        /when\s+this\s+unit\s+resists\s+a\s+debuff\b[^.]*?<unit-damage>(?:damage\s+equal\s+to\s+)?(\d+(?:\.\d+)?)%[^<]*<\/unit-damage>\s*of\s+(?:its|this\s+unit'?s)\s+max\s+hp/i;
    const m = re.exec(text);
    if (!m) return null;
    const pct = parseFloat(m[1]);
    return isNaN(pct) ? null : { pct };
}

/**
 * Ship-kit W8 — Xcellence p2 reactive proc: "When an enemy resists a debuff infliction, this
 * Unit deals damage equal to <unit-damage>115%</unit-damage> of this Unit's current shield.."
 * ENEMY-RESISTER-scoped and INFLICTOR-AGNOSTIC sibling of parseOnResistHpDamage: the subject is
 * "an enemy" (the resister), not "this Unit" (contrast Vindicator's "When THIS UNIT resists…"),
 * and the object is "a debuff infliction" with NO possessive (contrast Ravager's "if ITS debuff is
 * resisted"). It therefore fires whoever inflicted the debuff — an ally's included.
 *
 * ⚠️ #413: this comment used to gloss the clause as "when an enemy resists A DEBUFF [THIS UNIT
 * INFLICTED]" and route it onto `on-own-debuff-resisted` on that basis. The bracketed insertion is
 * not in the skill row, and it cost every ally-inflicted resist. It now routes on
 * `on-enemy-debuff-resisted`. Do not reintroduce a scope the text does not state.
 * The basis is the owner's CURRENT SHIELD rather than max HP. Standalone REACTIVE damage — NOT
 * an on-cast rider (parseSecondaryDamage's sentence guard deliberately excludes this same
 * clause, see its comment above). Returns { pct } or null.
 */
export function parseOnResistShieldDamage(text: string | null | undefined): { pct: number } | null {
    if (!text) return null;
    const re =
        /when\s+an\s+enemy\s+resists\s+a\s+debuff\b[^.]*?<unit-damage>(?:damage\s+equal\s+to\s+)?(\d+(?:\.\d+)?)%[^<]*<\/unit-damage>\s*of\s+(?:its|this\s+unit'?s)\s+current\s+shield/i;
    const m = re.exec(text);
    if (!m) return null;
    const pct = parseFloat(m[1]);
    return isNaN(pct) ? null : { pct };
}

/**
 * "Upon being killed by direct Damage, this Unit deals Damage equal to N% of its max HP"
 * — Paracelsus on-destroyed HP-scaled retaliation. Mirrors parseOnResistHpDamage; the amount
 * rides hpBasisPct (multiplier:0), executed by the reactive-damage executor on on-destroyed.
 */
export function parseKilledByDirectHpDamage(
    text: string | null | undefined
): { pct: number } | null {
    if (!text) return null;
    const re =
        /(?:when|upon\s+being)\s+killed\s+by\s+direct\s+damage\b[^.]*?<unit-damage>(?:damage\s+equal\s+to\s+)?(\d+(?:\.\d+)?)%[^<]*<\/unit-damage>\s*of\s+(?:its|this\s+unit'?s)\s+max\s+hp/i;
    const m = re.exec(text);
    if (!m) return null;
    const pct = parseFloat(m[1]);
    return isNaN(pct) ? null : { pct };
}

// Matches "X% ... for each <phrase>" where no other % sits between the number and
// "for each". Global so we can skip repair/heal contexts and unknown phrases.
const CONDITIONAL_RE = /(\d+(?:\.\d+)?)\s*%[^%]*?for each\s+([^.,;<]+)/gi;

// Flat conditional damage bonus gated by enemy class, e.g. Meiying's "when attacking a
// Supporter, it additionally deals 90% damage". Anchored at the enemy-type lead-in so the
// base multiplier (earlier in the sentence) is never captured; [^.] keeps it in-sentence.
const ENEMY_TYPE_BONUS_RE =
    /(?:attacking|targeting|damaging|against)\s+an?\s+(attacker|defender|debuffer|supporter)\b[^.]*?\badditional(?:ly)?\b[^.]*?(\d+(?:\.\d+)?)\s*%\s*damage/i;

function mapConditionPhrase(
    raw: string
): { condition: ConditionalCondition; derivable: boolean } | null {
    const p = raw.trim().toLowerCase();
    // Order matters: "debuff" contains "buff"; "buff on this unit" before "buff on the enemy".
    if (p.includes('debuff on the enemy') || p.includes('debuff on enemy'))
        return { condition: 'enemy-debuff', derivable: true };
    // Self buff-count: "buff on this unit" (Sustainer active), "buff on itself" (Valiant),
    // "buff on it" (Sustainer charged). The (?<!de) lookbehind keeps "debuff on itself"
    // (Meatshield's repair scaling) from mis-mapping to self-buff.
    if (/(?<!de)buff on (?:this unit|itself|it)\b/.test(p))
        return { condition: 'self-buff', derivable: true };
    if (p.includes('buff on the enemy') || p.includes('buff on enemy'))
        return { condition: 'enemy-buff', derivable: false };
    if (p.includes('adjacent to the enemy'))
        return { condition: 'enemy-adjacent', derivable: false };
    if (p.includes('adjacent all')) return { condition: 'adjacent-ally', derivable: false };
    if (p.includes('destroyed enem')) return { condition: 'enemy-destroyed', derivable: false };
    return null;
}

function parseConditionalCap(text: string): number | null {
    const m = /up to[^%]*?(\d+(?:\.\d+)?)\s*%/i.exec(text);
    return m ? parseFloat(m[1]) : null;
}

/**
 * Returns the conditional scaling bonus from a skill, e.g.
 * "an additional <unit-damage>20%</unit-damage> for each adjacent ally" or the
 * untagged "plus an extra 30% for each buff on the enemy" (Nuqtu). The bonus is
 * a per-unit % added to the skill multiplier; `derivable` is true when the sim
 * can count the condition itself (self buffs / enemy debuffs). Repair/heal
 * scaling ("repairs X% ... for each enemy destroyed") is ignored. Returns null
 * when no recognized "for each" conditional is present.
 */
export function parseConditionalDamage(text: string | null | undefined): ConditionalDamage | null {
    if (!text) return null;
    for (const m of text.matchAll(CONDITIONAL_RE)) {
        const pct = parseFloat(m[1]);
        if (isNaN(pct)) continue;
        // Skip repair/heal scaling — look just before the matched number.
        const idx = m.index ?? 0;
        const before = text.slice(Math.max(0, idx - 20), idx).toLowerCase();
        if (before.includes('repair')) continue;
        // "X% more (direct) damage for each Y" is an outgoing-damage MODIFIER (parseModifiers),
        // not a base-damage scaling — skip so it isn't double-counted on the damage ability.
        if (/\bmore\b/i.test(m[0].split(/for each/i)[0])) continue;
        const mapped = mapConditionPhrase(m[2]);
        if (!mapped) continue;
        // Scope the cap search to the conditional clause onward so an earlier,
        // unrelated "up to X%" elsewhere in the skill text isn't picked up.
        const cap = parseConditionalCap(text.slice(idx));
        return {
            pct,
            condition: mapped.condition,
            derivable: mapped.derivable,
            ...(cap !== null ? { cap } : {}),
        };
    }
    // "deals X% damage, increased to Y% … against <class>" — a replacement branch (the multiplier
    // BECOMES Y vs that class) modeled as base X plus a conditional (Y − X) bonus gated on the
    // enemy class (Gallant). Numerically identical to the game and reuses the enemy-type scaling
    // path. Placed before ENEMY_TYPE_BONUS_RE — this "increased to" phrasing has no "additional".
    const incTo = INCREASED_TO_ENEMY_TYPE_RE.exec(stripUnitTags(text));
    if (incTo) {
        const delta = parseFloat(incTo[2]) - parseFloat(incTo[1]);
        if (delta > 0) {
            return {
                pct: delta,
                condition: 'enemy-type',
                derivable: true,
                requiredEnemyType: capType(incTo[3]),
            };
        }
    }
    // "deals X% damage, but when attacking a <class>, it deals Y% damage" — the same replacement
    // shape as "increased to" above (IonScorp), just worded with "but … it deals Y%" instead of
    // "increased to Y%". Modeled identically: base X plus a conditional (Y − X) bonus gated on the
    // enemy class. Placed alongside incTo — this phrasing has no "additional" either.
    const butWhen = stripUnitTags(text).match(
        /(\d+(?:\.\d+)?)\s*%\s*damage,?\s*but\s+when\s+(?:attacking|targeting|damaging|against)\s+an?\s+(attacker|defender|debuffer|supporter)s?,?\s*(?:it\s+)?deals?\s+(\d+(?:\.\d+)?)\s*%/i
    );
    if (butWhen) {
        const delta = parseFloat(butWhen[3]) - parseFloat(butWhen[1]);
        if (delta > 0) {
            return {
                pct: delta,
                condition: 'enemy-type',
                derivable: true,
                requiredEnemyType: capType(butWhen[2]),
            };
        }
    }
    // Fallback: flat "additional N% damage when attacking a <enemy class>" bonus.
    const typed = ENEMY_TYPE_BONUS_RE.exec(stripUnitTags(text));
    if (typed) {
        return {
            pct: parseFloat(typed[2]),
            condition: 'enemy-type',
            derivable: true,
            requiredEnemyType: capType(typed[1]),
        };
    }
    // "if critical, additionally deals N% damage" → a self-crit conditional bonus on the base
    // multiplier (Crucialis). The base damage always applies; this N% is added only on a crit
    // (scaledBonus weights it by crit rate as an expected value).
    const critBonus = CRIT_BONUS_RE.exec(stripUnitTags(text));
    if (critBonus) {
        return { pct: parseFloat(critBonus[1]), condition: 'self-crit', derivable: true };
    }
    // "if Stealthed, additional deals N% damage" — a self-Stealth conditional bonus (Yin Jian's
    // word-order "additional deals" variant). toCondition tags buffName 'Stealth' from the raw
    // text, so the sim gates the bonus on the caster actually being Stealthed (0 in DPS mode).
    const stealthBonus = SELF_STEALTH_BONUS_RE.exec(stripUnitTags(text));
    if (stealthBonus) {
        return { pct: parseFloat(stealthBonus[1]), condition: 'self-buff', derivable: true };
    }
    return null;
}

// "if Stealthed, … additional … N% damage" — self-buff(Stealth) conditional bonus. Handles both
// "additionally deals" and the reversed "additional deals" (Yin Jian) word orders.
const SELF_STEALTH_BONUS_RE =
    /\bif\s+stealthed\b[^.]*?\badditional(?:ly)?\b[^.]*?(\d+(?:\.\d+)?)\s*%\s*damage/i;

// "additional N% damage against <status>[ or <status>] enemies" — status adjectives (Rikra).
const ENEMY_STATUS_BONUS_RE =
    /\badditional(?:ly)?\s*(?:deals?\s+)?(\d+(?:\.\d+)?)\s*%\s*damage\s+against\s+([^.]*?)\benem(?:y|ies)/i;
// "if the TARGET/ENEMY is affected by <Effect>[ or <Effect>], … additional N% damage" — tagged
// effect names (Wrecker's Inferno). Matched on RAW text so the <unit-skill> tags survive.
// The target/enemy subject is REQUIRED: it distinguishes Wrecker's enemy-state bonus from a
// SELF-state replacement branch ("If THIS UNIT is affected by Provoke or Taunt, it instead
// deals 170% …" — Panon's charged, a PR6b "instead"-branch case, NOT an additive enemy bonus).
const ENEMY_AFFECTED_BONUS_RE =
    /(?:target|enem(?:y|ies))\s+(?:is\s+|are\s+)?affected by\b([^.]*?),[^.]*?\badditional(?:ly)?\b[^.]*?(\d+(?:\.\d+)?)\s*%/i;

// "deals X% damage, increased to Y% … against <class>[s]" — Gallant's replacement branch. Matched
// on stripped text; the trailing [^.]* tolerates the charged "with additional Stasis…" clause.
const INCREASED_TO_ENEMY_TYPE_RE =
    /(\d+(?:\.\d+)?)\s*%\s*damage,?\s*increased to\s*(\d+(?:\.\d+)?)\s*%[^.]*?\bagainst\s+(?:an?\s+)?(attacker|defender|debuffer|supporter)s?\b/i;

// "additional <Stasis> applied for N turn(s) against <class>[s]" — Gallant's charged conditional
// control. Verb-after-tag phrasing ("Stasis applied") that STASIS_INFLICT_RE (verb-before)
// deliberately doesn't match; kept as its own narrow pattern so the byte-identity-critical
// STASIS_INFLICT_RE stays untouched.
const CONDITIONAL_STASIS_APPLIED_RE =
    /additional\s+<unit-skill>\s*Stasis\b[^.]*?\bapplied\b[^.]*?\bagainst\s+(?:an?\s+)?(attacker|defender|debuffer|supporter)s?\b/i;

/**
 * Returns the enemy class gating Gallant's charged "additional Stasis applied for 1 turn against
 * Defenders" control, or null. Model fidelity only — the DPS pipeline ignores control abilities;
 * the caller emits a control ability carrying the enemy-type condition.
 */
export function parseConditionalStasisApplied(
    text: string | null | undefined
): { requiredEnemyType: EnemyBaseClass } | null {
    if (!text) return null;
    const m = CONDITIONAL_STASIS_APPLIED_RE.exec(text);
    return m ? { requiredEnemyType: capType(m[1]) } : null;
}

/** Maps enemy-status ADJECTIVES ("Taunted", "Provoked") to their effect names. Scoped to the
 *  Taunt/Provoke targeting statuses that appear in the corpus's "against <status> enemies"
 *  bonus phrasing (Rikra); other statuses are not adjective-referenced there. */
function statusAdjectivesToNames(phrase: string): string[] {
    const low = phrase.toLowerCase();
    const names: string[] = [];
    if (/\btaunt(?:ed)?\b/.test(low)) names.push('Taunt');
    if (/\bprovoke[ds]?\b/.test(low)) names.push('Provoke');
    return names;
}

/**
 * A conditional damage BONUS gated on the ENEMY carrying an effect, distinct from the
 * self/enemy-class conditionals of {@link parseConditionalDamage}. Two corpus phrasings:
 *  - "additional N% damage against Taunted or Provoked enemies" (Rikra) — status adjectives.
 *  - "if the target is affected by <Inferno>, deals an additional N% damage" (Wrecker) — a
 *    tagged effect name. The base damage always fires; the bonus is added only when the enemy
 *    has the effect(s) (0 in single-ship DPS mode, live-derived per victim in the combat sim —
 *    same precedent as enemy-stealth-count scaling). Returns the bonus % and the effect names
 *    (caller builds enemy-buff/enemy-debuff conditions via classifyEnemyEffect). Null when neither
 *    phrasing is present.
 */
export function parseEnemyEffectDamageBonus(
    text: string | null | undefined
): { pct: number; effectNames: string[] } | null {
    if (!text) return null;
    const statusM = ENEMY_STATUS_BONUS_RE.exec(stripUnitTags(text));
    if (statusM) {
        const names = statusAdjectivesToNames(statusM[2]);
        if (names.length) return { pct: parseFloat(statusM[1]), effectNames: names };
    }
    const affectedM = ENEMY_AFFECTED_BONUS_RE.exec(text);
    if (affectedM) {
        const names = [...affectedM[1].matchAll(/<unit-skill>([^<]+)<\/unit-skill>/gi)].map((x) =>
            x[1].trim()
        );
        if (names.length) return { pct: parseFloat(affectedM[2]), effectNames: names };
    }
    return null;
}

// "deals X% damage for every N stacks/entries of damage over time inflicted on[to] a single
// enemy" (Snakeroot p1/p2: "100% damage for every 7 stacks…" / "120% damage for every 4
// stacks…") — an OPEN-ENDED per-DoT-entry SCALING multiplier, distinct from
// parseConditionalDamage's "for each" additive-bonus shape (CONDITIONAL_RE only matches
// "for each", never "for every" — no collision). Here the WHOLE X% IS the per-N-entries rate:
// with 0 tracked DoT entries on the target the ability deals 0% damage, so the base multiplier
// the caller parsed from the same <unit-damage> tag must be zeroed and replaced by a `scaling`
// rule against the (Task 3) `enemy-dot-count` condition, perUnit = X / N (matches the
// enemy-stealth-count/self-crit-power precedent: bare `enemy-dot-count` resolves to the raw
// integer DoT-entry count, so perUnit is expressed in full percentage points per entry, NOT a
// 0..1 fraction — that fractional form is reserved for the 0..100-scaled enemy-hp-pct/
// enemy-hp-missing-pct scaling sources).
const DOT_ENTRY_SCALING_RE =
    /(\d+(?:\.\d+)?)%\s*damage\s+for every\s+(\d+)\s+stacks?\s+of\s+damage over time\s+inflicted\s+on\s*to?\s+a\s+single\s+enemy/i;

export function parseDotEntryDamageScaling(
    text: string | null | undefined
): { perUnit: number } | null {
    if (!text) return null;
    const m = DOT_ENTRY_SCALING_RE.exec(stripUnitTags(text));
    if (!m) return null;
    const pct = parseFloat(m[1]);
    const n = parseInt(m[2], 10);
    if (!n) return null;
    return { perUnit: pct / n };
}

// "if/when [this unit|it is] critical[ly hits], … additional[ly] … N% damage" — extra damage
// dealt on a crit. Covers Crucialis active ("if critical, additionally deals 75%") and its
// charged "deals and additional" typo phrasing ("when it is critical, deals and additional 190%").
const CRIT_BONUS_RE =
    /\b(?:if|when)\s+(?:this\s+(?:unit\s+)?|it\s+is\s+)?critical(?:ly\s+(?:hits?|damages?))?\b[^.]*?\badditional(?:ly)?\b[^.]*?(\d+(?:\.\d+)?)\s*%\s*damage/i;

// "deals N% damage to <targets> with less/more than X% HP" — the damage itself is gated by an
// enemy-HP threshold (Judge's "deals 60% damage to all enemies with less than 50% HP"). Scoped
// to "deals … damage to …" so it ignores damage-BONUS phrasings ("increases Damage by 100% to
// enemies below 30% HP") and scaling caps ("max achieved when below 10% HP").
const DAMAGE_HP_GATE_RE =
    /deals?\s+\d+(?:\.\d+)?%\s+damage\s+to\b[^.]*?\b(less than|below|under|more than|above|over|greater than)\s+(\d+)%\s*(?:max\s+)?hp/i;

/**
 * Detects an enemy-HP threshold gating a "deals N% damage to …" clause, e.g. Judge's
 * "deals 60% damage to all enemies with less than 50% HP". Returns the comparator and
 * percentage so the caller can attach an hp-threshold Condition (no scaling). Null when
 * no HP-gated damage clause is present.
 */
export function parseHpThresholdCondition(
    text: string | null | undefined
): { hpComparator: 'below' | 'above'; hpPercent: number } | null {
    if (!text) return null;
    const m = DAMAGE_HP_GATE_RE.exec(stripUnitTags(text));
    if (!m) return null;
    const below = /less|below|under/i.test(m[1]);
    return { hpComparator: below ? 'below' : 'above', hpPercent: parseInt(m[2], 10) };
}

function stripUnitTags(text: string): string {
    return text.replace(/<\/?unit-(?:aid|skill|damage)>/gi, '');
}

// "ignores Taunt and Provoke" / "ignoring Taunt and Provoke" / "ignores Taunt and Provoke effects"
// Requires ignor… THEN taunt THEN provoke in order within a sentence so applier/reader texts don't match.
const IGNORES_FORCED_TARGETING_RE = /\bignor\w*\b[^.]*\btaunt\b[^.]*\bprovoke\b/i;

/** True if any of the given skill texts states the unit ignores Taunt/Provoke (forced
 *  targeting). Per-ship: every corpus ignore-ship ignores uniformly across active/charged/
 *  passive. Does NOT cover Concentrate Fire (no ship text ignores CF). */
export function detectIgnoresForcedTargeting(
    ...skillTexts: Array<string | null | undefined>
): boolean {
    return skillTexts.some((t) => !!t && IGNORES_FORCED_TARGETING_RE.test(stripUnitTags(t)));
}

// W6: "This Unit ignores Stealth effects" — a ship-wide stealth-ignoring passive (Lodolite).
// Requires ignor… THEN stealth THEN effect within a sentence so the per-attack "can target
// Stealthed enemies" clause and plain "gains Stealth" grants do NOT match.
const IGNORES_STEALTH_RE = /\bignor\w*\b[^.]*\bstealth\b[^.]*\beffects?\b/i;

/** True if any given skill text states the unit ignores Stealth effects (ship-wide targeting
 *  bypass). Per-ship: uniform across active/charged/passive. */
export function detectIgnoresStealth(...skillTexts: Array<string | null | undefined>): boolean {
    return skillTexts.some((t) => !!t && IGNORES_STEALTH_RE.test(stripUnitTags(t)));
}

// Phrases that disqualify a charge phrase from being a self-gain we model: ally-grant to
// others only. The enemy-REPAIR phrasings were lifted OUT (Phase 4c PR 4): a self charge
// gain "when an enemy repairs" now rides the LIVE on-enemy-repaired trigger (Zosimos) —
// handled in parseChargeGain below — instead of being dropped. Phase 3 PR-B (reactive-
// trigger promotion): the on-kill phrasings ("upon killing", "killing an enemy", "when an
// enemy dies") were ALSO lifted out — a self charge gain on killing an enemy now rides the
// LIVE on-enemy-destroyed trigger (Obsidian/Valiant), handled in parseChargeGain below,
// instead of being dropped. Liberator's all-allies death charge stays disqualified here via
// "all allies" (its own dedicated parser, parseAllyChargeOnEnemyDeath, handles it).
const CHARGE_DISQUALIFY_RE = /all allies|their charged skill|charged skill of all allies/i;

// "when an enemy repairs / performs a repair[s]" — a player reaction to an ENEMY repair
// (Zosimos's "gains a charge"). Tolerates the live CSV refit typo "performs a repairs".
// Routes the charge gain onto the LIVE on-enemy-repaired trigger (per-event, +amount each
// fire). Reference data: docs/ship-skills.csv.
const ENEMY_REPAIRS_RE = /\bwhen\s+an?\s+enemy\b[^.]*?\b(?:repairs?|performs?\s+a\s+repairs?)\b/i;

// "adds/gains N charge(s)" (self-add). "removes" is excluded by the verb set, so
// Thresh's "removes 1 charge ... and adds 1 charge" matches only the add.
const SELF_CHARGE_ADD_RE = /\b(?:adds?|gains?)\s+(\d+|a|an)\s+charges?\b/i;

// Rhodium-style form: "adds charges to the Charged Skill equal to the number of
// buffs on the target" (amount is per-buff = 1). Runs on tag-stripped text.
const PER_BUFF_CHARGE_RE =
    /adds?\s+charges?\s+to\s+the\s+charged skill[^.]*equal to the number of/i;

// "removes N charges from the enemy" (on-cast/bomb) OR Zosimos's "decreases that enemy's charge"
// (decreases by one, no captured number → default amount 1). Curly apostrophes (U+2018/U+2019)
// are normalised to straight (U+0027) by parseChargeRemoval before this regex runs, so only a
// plain straight apostrophe is needed here.
export const REMOVE_CHARGE_RE =
    /\bremoves?\s+(\d+|a|an)\s+charges?\s+from the enemy|\bdecreases?\s+that enemy's charge\b/i;

// "every second repair" — qualifies the Zosimos removal as an every-Nth-event gate.
const EVERY_SECOND_REPAIR_RE = /every second repair/i;

// "when (an/another) ally inflicts|applies a debuff" — a teammate applies a debuff (Provider).
// A team-dependent trigger: manual (non-derivable) since the single-ship sim has no allies.
const ALLY_INFLICTS_DEBUFF_RE = /\ball(?:y|ies)\b[^.]*\b(?:appl|inflict)\w*\s+a\s+debuff\b/i;

// Oleander's "once per ally per round" cap on the RoT-to-ally grant — distinct from the plain
// "once per round" cap (ECC_ONCE_PER_ROUND_RE) which caps once per round OVERALL, not per ally.
// Exported: buildShipAbilities.ts's mergeBuff path tests it directly against the buff's clause.
export const ONCE_PER_ALLY_PER_ROUND_RE = /\bonce per ally per round\b/i;

// Cobalt: "adds N charge ... at the start of the turn if it is at full HP" — a periodic
// self-charge gated on full HP. The two halves are detected together so the start-of-turn
// trigger and the hp-threshold gate ride as a pair. Epic PR4: ALSO reused (unmodified regex)
// by detectReactiveTrigger below for Cobalt's SIBLING buff grant in the same sentence ("…and
// gains Out. Damage Up II for 1 turn at the start of the turn if it is at full HP") — the
// charge and buff halves share one governing trailing phrase and must share one trigger.
const START_OF_TURN_CHARGE_RE = /\bat the start of (?:the|its|each|every)\s+turn\b/i;
const AT_FULL_HP_RE = /\bat full (?:hp|health)\b/i; // reused phrasing (cf. classifier ~line 647)

function classifyChargeCondition(
    text: string // already tag-stripped, any case
): { condition: ConditionalCondition; derivable: boolean; requiredEnemyType?: EnemyBaseClass } {
    const p = text.toLowerCase();
    if (p.includes('is a defender'))
        return { condition: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' };
    // "When an ALLY critically hits an enemy, this Unit gains 1 charge" (Hermes) — a
    // team-dependent trigger, NOT this unit's own crit; must not scale by own crit rate.
    // Manual assume-active, matching the other reactive team conditions.
    if (/\ball(?:y|ies)\b/.test(p) && p.includes('critical'))
        return { condition: 'always', derivable: false };
    if (p.includes('critically damag') || p.includes('critically hit'))
        return { condition: 'self-crit', derivable: true };
    // NOTE: the "inflict + debuff" charge phrasings (Hemlock self, Oleander ally) are handled
    // upstream in parseChargeGain as per-event reactive triggers (on-debuff-inflicted /
    // on-ally-debuff-inflicted), not as a per-standing enemy-debuff count condition. They never
    // reach classifyChargeCondition. Any other "inflict … debuff" charge text that slips through
    // falls to the always-true default below (a safe per-cast baseline).
    // Stealth-gated self charge (Selenite): live enemy-buff gate — derivable so the cast path
    // reads the opposing side's current Stealth holders, not a static manualCount.
    if (p.includes('stealth')) return { condition: 'enemy-buff', derivable: true };
    if (
        p.includes('buffs on the target') ||
        p.includes('buff on the target') ||
        p.includes('or more buffs') ||
        p.includes('buffs on the enemy') ||
        p.includes('number of buffs')
    )
        return { condition: 'enemy-buff', derivable: false };
    // NOTE: "N or more enemies" / "damages N" hit-count phrasings (Tygr) are handled upstream
    // in parseChargeGain via hitCountConditionFromClause + the `conditions` escape hatch (SP-D)
    // — they used to fall through to a coarse 'enemy-adjacent' presence proxy here, which never
    // modeled the actual ≥N threshold; that branch was removed rather than left dead/misleading.
    // speed / full-HP / lowest-speed and anything else → always-true under sim assumptions
    return { condition: 'always', derivable: true };
}

const ENEMY_TYPE_WORD = /defender|attacker|debuffer|supporter/i;
// Enemy-class lead-ins: "targeting a Defender", "damaging an Attacker",
// "target is a Supporter", "against a Debuffer". Followed by a type (optionally "X or Y").
const GRANT_ENEMY_TYPE_RE = new RegExp(
    `(?:targeting|damaging|attacking|against|target is|enemy is)\\s+an?\\s+(${ENEMY_TYPE_WORD.source})(?:\\s+or\\s+(?:an?\\s+)?(${ENEMY_TYPE_WORD.source}))?`,
    'i'
);

// Negated enemy class: "targeting non-Defenders", "against non-Attackers" → enemy is NOT
// that type. Scoped to enemy-targeting lead-ins so "non-defender ally" phrasings don't match.
const NON_ENEMY_TYPE_RE = new RegExp(
    `(?:targeting|damaging|against)\\s+non-?\\s*(${ENEMY_TYPE_WORD.source})`,
    'i'
);

const capType = (s: string): EnemyBaseClass =>
    (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()) as EnemyBaseClass;

/**
 * Classifies a buff/debuff COUNT-threshold gate from a clause into a count
 * condition with a comparator (e.g. "more than 3 Debuffs" → enemy-debuff gte 4,
 * "no debuffs" → self-debuff eq 0). Returns null when no count-threshold phrasing
 * is present. The count subjects are derivable — the sim derives self-buff and
 * enemy-debuff counts from the timeline; self-debuff/enemy-buff default to 0
 * (no enemy-buff/self-debuff modelling), a safe DPS baseline.
 */
function countGateCondition(clause: string): Condition | null {
    const low = clause.toLowerCase();

    // SP-D: DoT-stack-count gates. Generic "N or more Damage over Time effects" (Anemone) and
    // named families "N or more Acidic Decay" (Belladonna). Emit enemy-dot-count; carry the
    // family name as buffName when a specific DoT is named. Checked FIRST (before the buffs?/
    // debuffs? matches below) so DoT phrasings never fall through to the generic buff/debuff
    // classifier (which doesn't recognise "Damage over Time effects"/"Acidic Decay" as a kind)
    // or further down to the Taunt/Provoke self-status detector (rule 5 in detectGrantConditions,
    // which would otherwise match the bare word "Taunt" in "gains Taunt" and emit a spurious
    // self-buff condition instead of the real DoT-count gate).
    let dotMatch: RegExpMatchArray | null;
    if ((dotMatch = low.match(/(\d+)\s+or\s+more\s+(damage over time effects?|acidic decay)/))) {
        const dotFamily = /acidic decay/.test(dotMatch[2]) ? 'Acidic Decay' : undefined;
        return {
            subject: 'enemy-dot-count',
            derivable: true,
            countComparator: 'gte',
            countThreshold: parseInt(dotMatch[1], 10),
            ...(dotFamily ? { buffName: dotFamily } : {}),
        };
    }

    let comparator: 'gte' | 'lte' | 'eq' | null = null;
    let threshold = 0;
    let kind: string | null = null;
    let m: RegExpMatchArray | null;
    if ((m = low.match(/(?:more than|over)\s+(\d+)\s+(buffs?|debuffs?)/))) {
        comparator = 'gte';
        threshold = parseInt(m[1], 10) + 1;
        kind = m[2];
    } else if ((m = low.match(/(?:(\d+)\s+or\s+more|at least\s+(\d+))\s+(buffs?|debuffs?)/))) {
        comparator = 'gte';
        threshold = parseInt(m[1] ?? m[2], 10);
        kind = m[3];
    } else if ((m = low.match(/(?:fewer|less)\s+than\s+(\d+)\s+(buffs?|debuffs?)/))) {
        comparator = 'lte';
        threshold = Math.max(0, parseInt(m[1], 10) - 1);
        kind = m[2];
    } else if (
        (m = low.match(/(?:(\d+)\s+or\s+(?:fewer|less)|at most\s+(\d+))\s+(buffs?|debuffs?)/))
    ) {
        comparator = 'lte';
        threshold = parseInt(m[1] ?? m[2], 10);
        kind = m[3];
    } else if ((m = low.match(/(?:has\s+no|without(?:\s+any)?|\bno)\s+(buffs?|debuffs?)/))) {
        comparator = 'eq';
        threshold = 0;
        kind = m[1];
    }
    if (!comparator || !kind) return null;

    const isDebuff = /debuff/.test(kind);
    // Whose count: the nearest subject mentioned BEFORE the count phrase. "an enemy with 2 or
    // more debuffs" → enemy even when "this Unit" appears elsewhere (e.g. "this Unit gains X …
    // after dealing damage to an enemy with N debuffs").
    const before = low.slice(0, m?.index ?? 0);
    const lastEnemy = Math.max(
        before.lastIndexOf('enem'),
        before.lastIndexOf('target'),
        before.lastIndexOf('foe')
    );
    const lastSelf = before.lastIndexOf('this unit');
    const isEnemy = lastEnemy > lastSelf;
    const subject: ConditionSubject = isDebuff
        ? isEnemy
            ? 'enemy-debuff'
            : 'self-debuff'
        : isEnemy
          ? 'enemy-buff'
          : 'self-buff';
    return { subject, derivable: true, countComparator: comparator, countThreshold: threshold };
}

/**
 * Detects the condition(s) gating a granted/inflicted buff or debuff, scoped to the
 * sentence that mentions `buffName` (so an unconditional buff in the same skill isn't
 * wrongly gated). Returns model `Condition[]` (empty when no recognised condition).
 *
 * Recognised (the unambiguous, sim-meaningful cases):
 *  - enemy-type: "When damaging a Defender …", "if the target is an Attacker" (incl. "X or Y")
 *  - self-crit: "if this critically hits/damages …"
 *  - buff/debuff count threshold: "more than 3 Debuffs", "no debuffs"
 *  - enemy-debuff presence: "when Damaging a Debuffed enemy", "against a Debuffed target",
 *    "when/on/upon applying|inflicting a debuff" (this Unit applies one → enemy is debuffed)
 *  - Taunt/Provoke self-status: "if this Unit is Provoked or Taunted …"
 *  - manual team triggers: "when an ally inflicts a debuff", "after an ally is critically
 *    repaired" (non-derivable — toggled in the editor since the sim has no allies)
 *
 * Genuinely reactive conditions (when-attacked, below-X%-HP) are intentionally NOT
 * auto-classified — the user adds them in the editor. Reference data: docs/ship-skills.csv.
 */
/**
 * Resolves the sentence/clause of `skillText` that mentions `buffName`, applying the
 * "Inc."/"Out." abbreviation-period masking that keeps those buff-name periods from being
 * read as sentence boundaries (a documented project pitfall — see below). Shared by
 * `detectGrantConditions` and `detectReactiveTrigger` so the masking lives in ONE place.
 *
 * Game buff names use the abbreviations "Inc." (Incoming) and "Out." (Outgoing) — e.g.
 * "Inc. DoT Damage Up III". Their internal period would otherwise be read as a sentence
 * boundary, splitting the name in half so the clause lookup fails and falls back to the
 * whole skill text (leaking gates from unrelated sentences). Mask the space after the
 * abbreviation period with a non-whitespace marker so the split skips it, then restore.
 */
/**
 * Splits `text` into sentences at '.'/';' + whitespace boundaries, keeping the punctuation on
 * the preceding sentence and dropping the boundary whitespace. Lookbehind-free: Safari < 16.4
 * lacks RegExp lookbehind and the production browserslist (`>0.2%`) includes iOS Safari 15.x,
 * so the previous `split(/(?<=[.;])\s+/)` would throw at parse time on those browsers. This is
 * byte-equivalent to that split.
 *
 * Exported for `buffClauseSentenceSplit.test.ts` (#438), whose standing guard re-derives the
 * parse one sentence at a time and must split exactly where `resolveBuffClause` splits — a
 * copied splitter in the test could drift and silently weaken the guard.
 */
export function splitSentences(text: string): string[] {
    const out: string[] = [];
    const re = /[.;]\s+/g;
    let start = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        out.push(text.slice(start, m.index + 1));
        start = m.index + m[0].length;
    }
    if (start < text.length) out.push(text.slice(start));
    return out;
}

// Non-whitespace sentinel that replaces the space after an "Inc."/"Out." abbreviation period so
// splitSentences does not treat it as a sentence boundary. Restored to a plain space after
// splitting. Shared by resolveBuffClause, parseExtraAction, and buildShipAbilities' healPlain/
// shield-cocast sentence construction (Finding C1 -- the "Out. Damage Up III" abbreviation
// period otherwise splits the co-cast buff name out of the shield's detected sentence).
export const ABBR_MARK = '\u0001';
export const maskAbbrev = (s: string) => s.replace(/\b(Inc|Out)\.\s/g, `$1.${ABBR_MARK}`);

// Escapes literal regex-special characters for use inside a dynamically built pattern.
function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-boundary-aware search for a buff/debuff name within text. A bare substring test
 * (`text.includes(name)` / `text.indexOf(name)`) can match a SHORTER name INSIDE a longer word --
 * e.g. "Stealth" matches inside "Stealthed" (Panguan: "Friendly Stealthed units deal 40% more
 * direct damage." was picked as Stealth's clause instead of the sentence that actually GRANTS
 * it, "This Unit Gains Stealth ... when directly damaged"). Boundaries are enforced with explicit
 * `(^|\W)` / `(?:\W|$)` groups rather than `\b`, so a buffName that begins or ends with a non-word
 * character (e.g. "+10% HP") still boundary-matches correctly; both are zero-width-or-consumed
 * assertions, not lookbehinds, so they are safe under the iOS Safari 15 no-lookbehind constraint
 * used elsewhere in this file. The leading boundary is a real captured char, so the returned index
 * is offset past it. Shared by resolveBuffClause and buildShipAbilities' buff-name anchor (B4).
 */
export function findBuffNamePos(text: string, buffName: string): number {
    if (!text || !buffName) return -1;
    const re = new RegExp(`(^|\\W)(${escapeRegExp(buffName)})(?:\\W|$)`);
    const m = re.exec(text);
    return m ? m.index + m[1].length : -1;
}

/** Word-boundary occurrence count, the same matcher clause selection anchors on. */
function countBuffNameOccurrences(text: string, buffName: string): number {
    let n = 0;
    let rest = text;
    for (;;) {
        const i = findBuffNamePos(rest, buffName);
        if (i === -1) return n;
        n++;
        rest = rest.slice(i + buffName.length);
    }
}

/**
 * A buff name's granting clause, plus where in THAT clause the requested occurrence sits.
 *
 * `localIndex` is the occurrence's index WITHIN `clause`, which is what `findNthOccurrencePos`
 * needs — the caller counts occurrences across the whole row, so passing its global index into a
 * single-sentence clause would over-run it.
 */
interface ResolvedBuffClause {
    clause: string;
    localIndex: number;
}

/**
 * Resolves the sentence that OWNS the `occurrenceIndex`-th occurrence of `buffName` (#438).
 *
 * Before this took an index it was a plain first-match, so a second SENTENCE mentioning the same
 * name was unreachable: every occurrence resolved from sentence one and `findNthOccurrencePos`
 * degraded to its LAST match there rather than failing, so a second grant silently inherited the
 * first clause's receiver ("grants X to itself. grants X to all allies." emitted both as `self`).
 *
 * OCCURRENCE BASIS. The caller's index counts `<unit-skill>` TAGGED occurrences in the raw row;
 * this counts WORD-BOUNDARY matches over the tag-stripped text. Those are different countings, so
 * the mapping is only sound while they agree. Measured 2026-09-01 over docs/ship-skills.csv: of
 * the 33 name/row pairs with two or more tagged occurrences — the only ones that ever receive an
 * index above 0 — all 33 agree. (Seven pairs corpus-wide DISagree, all of them tagged exactly
 * once: untagged prose mentions, e.g. Panon's `Barrier`. Index 0 resolves to the first sentence
 * holding the name either way, so they are unaffected.) `buffClauseSentenceSplit.test.ts` asserts
 * the multi-tagged agreement so a ship-data refresh that breaks the basis reddens rather than
 * silently mis-ordering. Word boundaries also matter for the counting itself: plain `indexOf`
 * counts "Stealth" inside "Stealthed" (Panguan), inflating the ordinal.
 *
 * Out-of-range indices keep the old defensive behaviour — the LAST sentence holding the name, at
 * its last occurrence — rather than losing the clause entirely.
 */
function resolveBuffClauseAt(
    skillText: string,
    buffName: string,
    occurrenceIndex = 0
): ResolvedBuffClause {
    const plain = maskAbbrev(stripUnitTags(skillText).replace(/<br\s*\/?>/gi, '. '));
    const maskedName = maskAbbrev(buffName).toLowerCase();
    const unmask = (s: string) => s.split(ABBR_MARK).join(' ');
    const sentences = splitSentences(plain);

    let seen = 0;
    let lastHolder: ResolvedBuffClause | null = null;
    for (const sentence of sentences) {
        const here = countBuffNameOccurrences(sentence.toLowerCase(), maskedName);
        if (here === 0) continue;
        if (occurrenceIndex < seen + here) {
            return { clause: unmask(sentence), localIndex: occurrenceIndex - seen };
        }
        seen += here;
        lastHolder = { clause: unmask(sentence), localIndex: here - 1 };
    }
    // Index past the last occurrence → the last sentence that holds the name. No sentence holds
    // it at all → the whole text, as before (leaks sibling gates, but loses nothing).
    return lastHolder ?? { clause: unmask(plain), localIndex: 0 };
}

/** `resolveBuffClauseAt`'s clause alone, for the detectors that test the whole sentence. */
function resolveBuffClause(skillText: string, buffName: string, occurrenceIndex = 0): string {
    return resolveBuffClauseAt(skillText, buffName, occurrenceIndex).clause;
}

/**
 * SP-C: owner-vs-target stat comparison gate, matched against an already-lowercased clause/
 * sentence. "If this Unit has more Crit Power/HP than the target/enemy" (owner greater → gt);
 * "If all damaged enemies have more Speed than this Unit" (owner slower → speed lt). Shared by
 * `detectGrantConditions` (buff/debuff clauses, scoped via resolveBuffClause) and
 * `parseSecondaryDamage` (Cobalt's nameless 25%-max-HP additional-damage rider, which has no
 * buffName to drive that clause-scoping — it scopes to the SENTENCE preceding the secondary-
 * damage match instead). Returns null when no comparison phrasing is present.
 */
function statVsTargetConditionFromClause(low: string): Condition | null {
    if (/this unit has more crit power than the (?:target|enemy)/i.test(low))
        return {
            subject: 'stat-vs-target',
            derivable: true,
            compareStat: 'crit-power',
            statComparator: 'gt',
        };
    if (/this unit has more hp than the (?:target|enemy)/i.test(low))
        return {
            subject: 'stat-vs-target',
            derivable: true,
            compareStat: 'hp',
            statComparator: 'gt',
        };
    if (/(?:all\s+)?(?:damaged\s+)?enemies have more speed than this unit/i.test(low))
        return {
            subject: 'stat-vs-target',
            derivable: true,
            compareStat: 'speed',
            statComparator: 'lt',
        };
    return null;
}

// SP-D: "hitting N or more enemies" / "damages N or more enemies" — a real hit-count gate on
// THIS cast (Berserker's passive Marauder Rage grants; Tygr's self-charge-gain). Shared by
// `detectGrantConditions` (buff clauses) and `parseChargeGain` (Tygr's charge-gain, via the same
// `conditions` escape hatch statVsTargetConditionFromClause uses for Chakara) — CSV note:
// Berserker's text has a typo "N ore more" — the `or?e?` group matches both "or" and "ore".
function hitCountConditionFromClause(low: string): Condition | null {
    const m = low.match(/(?:hitting|damages?|damaging)\s+(\d+)\s+or?e?\s+more\s+enemies/);
    if (!m) return null;
    return {
        subject: 'enemies-hit-this-cast',
        derivable: true,
        countComparator: 'gte',
        countThreshold: parseInt(m[1], 10),
    };
}

export function detectGrantConditions(
    skillText: string | null | undefined,
    buffName: string,
    occurrenceIndex = 0
): Condition[] {
    if (!skillText || !buffName) return [];
    const clause = resolveBuffClause(skillText, buffName, occurrenceIndex);
    const low = clause.toLowerCase();
    // "when/on/upon applying|inflicting a debuff" is a trigger gate (the unit applies a debuff).
    const appliesDebuffGate = /\b(?:appl|inflict)\w*\s+a\s+debuff\b/i.test(low);
    // "after an ally is critically repaired" — a team-dependent reactive trigger (manual).
    const allyCritRepairGate = /\ball(?:y|ies)\b[^.]*\bcritically\s+repaired\b/i.test(low);
    // Ship-kit W8 Task 13: "killing an enemy WITH A DEBUFF" (Meiying) — the kill trigger's
    // qualifier. KILL_TRIGGER_RE resolves the TRIGGER (on-enemy-destroyed) elsewhere; this
    // separately gates the GRANTED debuff on the slain enemy having carried a debuff.
    const killedEnemyHadDebuffGate = KILL_WITH_DEBUFF_RE.test(low);
    // Only conditional clauses produce conditions.
    if (
        !/\b(when|if|while|after)\b|affected by|targeting|damaging|against/.test(low) &&
        !appliesDebuffGate &&
        !allyCritRepairGate &&
        !killedEnemyHadDebuffGate
    )
        return [];

    if (allyCritRepairGate) {
        return [{ subject: 'ally-critically-repaired', derivable: false }];
    }

    if (killedEnemyHadDebuffGate) {
        return [{ subject: 'killed-enemy-had-debuff', derivable: true }];
    }

    // Ship-kit Wave 4, Task 3: "If this Unit has Shield" — a self-shield-presence gate
    // (APEX's charged Disable). Live-derived from the caster's own shieldPool at cast time.
    // Checked before enemy-type/other rules — no overlap with those phrasings.
    if (/\bif\s+this\s+unit\s+has\s+shield\b/i.test(low)) {
        return [{ subject: 'self-shield', derivable: true }];
    }

    // Malvex: "If the target has a Shield, it gains Barrier for 1 hit" — the TARGET-side mirror of
    // the self-shield rule directly above, live-derived from the resolved victim's shieldPool at
    // cast time. Sits next to its sibling (both before rule 0) so the shield family reads in one
    // place; neither phrasing overlaps the other or any rule below.
    // derivable:true — a derivable:false condition is treated as always met
    // (evaluateConditions.ts:132), which would leave the Barrier ungated, i.e. the bug itself.
    if (TARGET_HAS_SHIELD_RE.test(low)) {
        return [{ subject: 'enemy-shield', derivable: true }];
    }

    // target-repaired-this-round (Nayra). Live-derived gate; derivable:true (a
    // derivable:false condition would always be met — evaluateConditions.ts:30).
    if (REPAIRED_THIS_ROUND_RE.test(low)) {
        return [{ subject: 'target-repaired-this-round', derivable: true }];
    }

    // Quixilver R2: "if it has shield equal to 100% of its max HP" → self-shield-full. Requires
    // the explicit 100%-of-max-HP wording — a bare "When Shielded" (Malvex) is the BROADER
    // existing `self-shielded` INCOMING-hit condition (evaluateConditions.ts's victim-side
    // shieldPool > 0 check, a different mechanism entirely) and must not match here.
    // `self-shield-full` is the narrower of the two (exactly 100%, not merely > 0).
    // derivable:true — a derivable:false condition is treated as always met
    // (evaluateConditions.ts:30), which would defeat the gate entirely.
    if (SHIELD_FULL_RE.test(low)) {
        return [{ subject: 'self-shield-full', derivable: true }];
    }

    // 0. Recurring grant: "gains X each/every turn|round" stacks unconditionally — a one-time gate
    // in the same sentence (e.g. Shashou's "Stealth after damaging a Debuffer … and gains Blast
    // each turn") applies to the other buff, not this one. Scope to this buff's own segment.
    const buffStart = low.indexOf(buffName.toLowerCase());
    if (buffStart !== -1) {
        const afterBuff = clause
            .slice(buffStart + buffName.length)
            .split(/\b(?:and\s+)?(?:gains?|grants?|inflicts?|applies)\b/i)[0];
        if (/\b(?:each|every)\s+(?:turn|round)\b/i.test(afterBuff)) return [];
    }

    // 1a. negated enemy-type ("targeting non-Defenders") — checked before the positive form.
    const notType = NON_ENEMY_TYPE_RE.exec(clause);
    if (notType) {
        return [
            {
                subject: 'enemy-type',
                derivable: true,
                requiredEnemyType: capType(notType[1]),
                negate: true,
            },
        ];
    }

    // 1. enemy-type (single or "X or Y")
    const et = GRANT_ENEMY_TYPE_RE.exec(clause);
    if (et) {
        const types = [...new Set([et[1], et[2]].filter(Boolean).map((t) => capType(t)))];
        return types.map((requiredEnemyType) => ({
            subject: 'enemy-type' as const,
            derivable: true,
            requiredEnemyType,
            ...(types.length > 1 ? { anyOf: true } : {}),
        }));
    }

    // 2. self-crit (active voice: this unit critically hits/damages — NOT "is critically hit").
    // Ship-kit Wave 8, Task 3: ALSO matches "if a critical hit occurs" (Lev's charged buff-grant
    // clause) — the same phrasing the co-located extend-status ability already gates on via
    // /critical hit occurs/i (buildShipAbilities.ts ~1657). Trigger stays on-cast; this only adds
    // the condition, mirroring that ability's shape exactly.
    if (/critically (?:hits|damag)|\bcritical\s+hit\s+occurs\b/i.test(low)) {
        return [{ subject: 'self-crit', derivable: true }];
    }

    // 2a. self "at full HP" → self HP-threshold (above 99% ≈ full, since the sim treats the
    // attacker as full HP). Reactive "below X% HP" gates stay manual (not auto-classified).
    if (/\bat full (?:hp|health)\b/i.test(low)) {
        return [
            {
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: 'above',
                hpPercent: 99,
                hpSubject: 'self',
            },
        ];
    }

    // Chakara: "if it has the lowest Speed among all allies" — a derivable team-speed gate.
    // Live-derived in the engine from the player team's static speeds (lone actor → true).
    if (/\blowest\s+speed\s+among\s+(?:all\s+)?allies\b/i.test(low)) {
        return [{ subject: 'lowest-speed-ally', derivable: true }];
    }

    // SP-C: owner-vs-target stat comparison (Bayah's Crit-Power-gated Stasis inflict). Shared
    // with parseSecondaryDamage below (Cobalt's nameless additional-damage rider has no buffName
    // to drive this function's clause-scoping, so it calls the extracted helper directly).
    const statVsTarget = statVsTargetConditionFromClause(low);
    if (statVsTarget) return [statVsTarget];

    // SP-D: hit-count gate (Berserker's "gains Marauder Rage ... when hitting 3 or more
    // enemies"). Shared with parseChargeGain below (Tygr's charge-gain analog).
    const hitCount = hitCountConditionFromClause(low);
    if (hitCount) return [hitCount];

    // 3. buff/debuff count threshold ("more than 3 Debuffs", "no debuffs")
    const countGate = countGateCondition(clause);
    if (countGate) return [countGate];

    // 3b. "if <Ally> is on the same team, … gains X" — a roster/team-composition gate (manual,
    // team-dependent, e.g. Nayra's Offensive Affinity Override needs Isha). Positionally scoped:
    // only applies to a buff mentioned AFTER the team clause, so an unconditional buff earlier in
    // the same sentence (Nayra's Defensive Affinity Override) isn't gated.
    const teamGate = /\b(?:if|while|when)\s+([A-Z][\w'-]+)\s+is\s+on\s+the\s+same\s+team\b/i.exec(
        clause
    );
    if (teamGate && (buffStart === -1 || buffStart > teamGate.index)) {
        return [{ subject: 'ally-on-team', derivable: false, buffName: teamGate[1] }];
    }

    // 4a. "when another ally inflicts a debuff" — a teammate's action (Provider). Checked
    // before the self enemy-debuff gate, since "ally inflicts a debuff" also matches that.
    if (ALLY_INFLICTS_DEBUFF_RE.test(clause)) {
        return [{ subject: 'ally-inflicts-debuff', derivable: false }];
    }

    // 4. Enemy-debuff presence gate. Two phrasings:
    //  - "Damaging a Debuffed enemy" / "against a Debuffed target" — enemy already has a debuff
    //    ("debuffed enemy/target" distinguishes this from "debuffed with a DoT" on a passive).
    //  - "when/on/upon applying|inflicting a debuff" — this Unit applies one, so the enemy is
    //    then debuffed (Yuyan, Marauder Rage). Both resolve to "the enemy has a debuff".
    if (/\bdebuffed\s+(?:enem(?:y|ies)|target|foe)\b/i.test(low) || appliesDebuffGate) {
        return [{ subject: 'enemy-debuff', derivable: true }];
    }

    // 4b. "when an enemy gets/is buffed" — a reactive enemy-buff trigger (Nuqtu's
    // Terran Bolster III). Manual, matching Amartya/Panon's Taunt-style enemy-buff
    // conditions: the single-ship sim derives no enemy buffs, so the user toggles it.
    // Fires before rule 5 deliberately: Taunt is also an enemy buff, but no ship text
    // combines "gets buffed" with a named buff — if one ever does, rule 5's named
    // condition is the better classification and this rule should move below it.
    if (/\benem(?:y|ies)\b[^.]*?\b(?:gets?|is|are|becomes?)\s+buffed\b/i.test(low)) {
        return [{ subject: 'enemy-buff', derivable: false }];
    }

    // 5. Taunt / Provoke targeting status (reactive → manual "assume active").
    // statusEffectCondition resolves these against the CASTER (Taunt = self-buff, Provoke =
    // self-debuff), so the rule must only fire for SELF-attributed phrasing ("if this Unit is
    // Provoked or Taunted"). Subject-aware guard: "against Taunted or Provoked enemies" (Rikra)
    // is an ENEMY state gating a damage bonus — handled by parseEnemyEffectDamageBonus, NOT a
    // self gate on this buff. Skip when the status adjective directly qualifies "enemies".
    // Ship-kit Wave 3, Task 4: ALSO skip Amartya's "When an enemy defender gains Taunt, this Unit
    // inflicts Exposed" — subject-first "an enemy ... gains Taunt" is the on-enemy-taunt-gained
    // REACTIVE TRIGGER phrasing (ENEMY_GAINS_TAUNT_RE), not a self-status gate; without this
    // exclusion the bare word "Taunt" here would wrongly spawn a `self-buff:'Taunt'` condition
    // that gates the whole Exposed grant behind Amartya herself having Taunt (never true) — a
    // regression this task's new phrasing would otherwise introduce into this pre-existing rule.
    const enemyStatusAttributed =
        /(?:taunt(?:ed)?|provoke[ds]?)(?:\s+or\s+(?:taunt(?:ed)?|provoke[ds]?))?\s+enem(?:y|ies)\b/i.test(
            low
        ) || ENEMY_GAINS_TAUNT_RE.test(clause);
    const statuses: string[] = [];
    if (!enemyStatusAttributed) {
        if (/\btaunt(ed)?\b/i.test(low)) statuses.push('Taunt');
        if (/\bprovoke[ds]?\b/i.test(low)) statuses.push('Provoke');
    }
    if (statuses.length) {
        return statuses.map((s) => statusEffectCondition(s, statuses.length > 1));
    }

    return [];
}

// Active-voice self-crit phrasing: "critically hits/hitting" or "critically damages/damaging".
// Deliberately excludes the passive participles "hit"/"damaged" (so "is critically hit" and
// "is critically damaged" do NOT match). A second guard rejects copular/auxiliary passives
// whose verb form WOULD otherwise match the alternation — e.g. "is/was/gets/getting critically
// damaging" style constructions; the verb set (is|was|are|were|been|be|being|gets?|getting)
// covers the linking verbs that introduce a passive clause. This is STRICTER than
// detectGrantConditions' self-crit rule (which uses /critically (?:hits|damag)/i and therefore
// misclassifies the passive "is critically damaged" — see detectReactiveTrigger docs).
//
// Lookbehind-free implementation (Safari < 16.4 lacks RegExp lookbehind and the production
// browserslist includes iOS Safari 15.x): a global core regex scans ALL occurrences and a
// prefix check verifies each is not preceded by a passive linking verb. This is actually more
// correct than the old single lookbehind regex, which — because `.test` only finds the first
// match — would have missed a later active occurrence when an earlier one was passive; here a
// later active phrasing still classifies even if an earlier phrasing was passive.
const ACTIVE_SELF_CRIT_CORE = /critically\s+(?:hits|hitting|damages|damaging)/gi;
const PASSIVE_LINKING_VERB_PREFIX = /\b(?:is|was|are|were|been|be|being|gets?|getting)\s+$/i;
function matchesActiveSelfCrit(text: string): boolean {
    ACTIVE_SELF_CRIT_CORE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ACTIVE_SELF_CRIT_CORE.exec(text)) !== null) {
        if (!PASSIVE_LINKING_VERB_PREFIX.test(text.slice(0, m.index))) return true;
    }
    return false;
}
const START_OF_ROUND_RE =
    /at the start of (?:the|each|every) round|starts? (?:the|each|every) round/i;
// Ship-kit W9, Task 5: "at the end of THIS UNIT'S turn" → end-of-turn (Quixilver R2's Barrier
// grant). Requires the possessive "this unit's turn" — the bare "end of the round" phrasing
// (END_OF_ROUND_RE, checked in detectReactiveTrigger below) is a DIFFERENT trigger, and matching
// "end of … turn" loosely would steal Rhodium's end-of-round grant. Apostrophe class accepts both
// the ASCII ' and the curly ’ the CSV uses inconsistently across rows (see maskAbbrev's sibling
// convention). Reference data: docs/ship-skills.csv (Quixilver's third-passive clause).
const END_OF_OWN_TURN_RE = /\bat\s+the\s+end\s+of\s+this\s+unit['’]s\s+turn\b/i;
// "every turn" / "each turn" — a per-own-turn recurring self-grant. Distinct from
// START_OF_TURN_CHARGE_RE ("at the start of the turn"): the trailing-phrase form Kinetik's
// per-turn shield and Cinya's per-turn heal use (docs/ship-skills.csv). SP-G G1a.
const EVERY_TURN_RE = /\b(?:each|every)\s+turn\b/i;
// "starts (each|every|the) round with <buff>" — a start-of-round self-grant whose governing
// phrase uses no application verb (Chakara's R2 passive; unique in the corpus). findVerb treats
// it as a self-receive ('gains') so the buff segments extract.
const STARTS_ROUND_WITH_RE = /\bstarts?\s+(?:each|every|the)\s+round\s+with\b/i;
// VICTIM-scoped bomb-burst phrasing → on-bomb-detonated. Fires whenever a Bomb bursts on an
// opposing actor, regardless of WHO caused it (the engine listener keys off the opposing victim).
// Verified against docs/ship-skills.csv (grep "explod"): Demolisher ("a/A bomb explodes on an
// enemy") and Valkyrie are the ONLY two rows using "explod" in the whole corpus.
// Ship-kit W7: the DETONATOR-scoped "detonates a bomb" alternate was SPLIT OUT into
// SELF_DETONATES_BOMB_RE below — it is a different trigger (on-self-bomb-detonated), fired only
// when THIS unit actively causes the burst, not on any bomb bursting on an enemy.
// #345: the effect-agnostic "explodes on (an|the) enemy" alternate was DROPPED. Phase 3 PR-D
// added it to make Valkyrie's "an Echoing Burst explodes on an enemy" ride this same trigger, on
// the premise that an Echoing Burst is a "named bomb-type effect". It is not one: it is an
// accumulate-then-detonate container (see audit/classes.ts), unrelated to the Bomb DoT, and
// sharing the trigger cost her the two properties her text asks for — her repair fired on any
// teammate's Bomb, and never on her own burst. It now rides ECHOING_BURST_DETONATE_RE below.
// Keep this alternate Bomb-specific: it is what Demolisher's splash and charge removal read.
const BOMB_DETONATE_RE = /bomb explodes/i;
// APPLIER-scoped Echoing Burst detonation → on-own-echoing-burst-detonated (Valkyrie's self +
// lowest-HP-ally repair; #345). The optional tag group absorbs the closing </unit-aid> in the raw
// CSV text ("an <unit-aid>Echoing Burst</unit-aid> explodes on an enemy") so the SAME regex
// matches raw and tag-stripped input — phrasePosTrigger scopes on RAW sentences, while
// detectReactiveTrigger's clause resolver and the leech-scope reader work on stripped text.
// Corpus-verified (docs/ship-skills.csv): Valkyrie's R1/R2 passives are the only rows naming an
// Echoing Burst explosion, and her charged skill (which APPLIES the effect) says "inflicts …
// Echoing Burst for 2 turns" — no "explodes" — so it cannot match here.
const ECHOING_BURST_DETONATE_RE = /echoing\s+burst\s*(?:<[^>]*>)?\s*explodes/i;
// DETONATOR-scoped "When this Unit detonates a Bomb …" → on-self-bomb-detonated (Lingshe's
// Stealth grant). Corpus-verified (docs/ship-skills.csv, grep "detonates a"): Lingshe is the ONLY
// ship whose reactive clause uses this phrasing (its OTHER passives use "inflicts a Bomb", a
// different trigger; the active/charge "detonates <Corrosion|Inferno|Bomb> effects" are cast-path
// detonation abilities, not reactive-trigger clauses). Distinct from BOMB_DETONATE_RE so a bomb
// bursting on an enemy from ANY source no longer wrongly grants Lingshe Stealth.
const SELF_DETONATES_BOMB_RE = /detonates?\s+a\s+bomb/i;
// "when an enemy cleanses a debuff" — a player reaction to an ENEMY cleanse (Phase 4c PR 4):
// Arum's Out. Damage Down debuff, Yarrow/Larkspur's Gelecek Contagion buff. Routes the
// buff/debuff grant onto the LIVE on-enemy-cleansed trigger. Reference data: docs/ship-skills.csv.
const ENEMY_CLEANSE_RE = /\bwhen\s+an?\s+enemy\b[^.]*?\bcleanses?\b[^.]*?\bdebuff/i;
// Phase 3 PR-H: "when this Unit cleanses a Debuff" (Cultivator) / "(when|upon) cleansing a
// Debuff" (Morao, Hayyan) — the reactive TRIGGER verb ("this unit"/implicit-self
// cleanses/CLEANSING), not a cleanse EFFECT riding a DIFFERENT reaction (Hermes'
// on-ally-critically-repaired "it Cleanses 1 debuff from itself" — numeral form, no "a") nor a
// plain cleanse ACTION on an active/charged cast (Nyxen/Makoli/Nosorog/Nuqtu's "Cleanses 1/2/all"
// numeral forms) nor an ENEMY-subject reaction ("when an enemy cleanses a Debuff" — Arum/Grif/
// Larkspur/Pestilence/Yarrow, verb form "cleanses" with subject "an enemy", never matched by this
// "this unit"/subjectless-gerund phrasing — see ENEMY_CLEANSE_RE above, checked first). Corpus-
// verified (docs/ship-skills.csv, grep "cleanses? a\b"/"cleansing a"): ONLY Cultivator, Hayyan,
// Morao match; every enemy-subject/numeral-cleanse row above does not. Task 1 (2026-07-06):
// Nosorog's "when this Unit removes a Debuff" phrasing is now also covered.
const OWN_CLEANSE_TRIGGER_RE =
    /\b(?:when\s+this\s+unit\s+cleanses\s+a\s+debuff|(?:when|upon)\s+cleansing\s+a\s+debuff|when\s+this\s+unit\s+removes\s+a\s+debuff)\b/i;
// Phase 3 PR-I: "when an enemy gets/is/becomes buffed" — Nuqtu's self-cleanse + Terran Bolster
// III grant. Promoted from a manual, non-derivable `enemy-buff` CONDITION (detectGrantConditions
// rule 4b below, which the single-ship DPS sim still consumes as a manual toggle — no enemy casts
// buffs there) to a LIVE reactive trigger for the team simulator. Requires a leading "when" (mirrors
// ENEMY_DEBUFFED_RE's sibling regex below) to disambiguate from an unrelated later "enemy buffed"
// mention in a longer sentence. Corpus-verified (docs/ship-skills.csv, grep this exact phrase
// family): ONLY Nuqtu's two passives (base + refit) match — no collateral on any other ship's
// "for each buff on the enemy" per-count scaling (Nuqtu's own active/charged text) or any other
// enemy-buff condition consumer (Amartya/Panon Taunt-style gates use a different phrasing).
const ENEMY_BUFFED_RE =
    /\bwhen\b[^.]*?\benem(?:y|ies)\b[^.]*?\b(?:gets?|is|are|becomes?)\s+buffed\b/i;
// Overload lifecycle (Task 4) — kill/apply-debuff reactive phrasings for buff grants/removals.
// Kept SEPARATE from the shared ENEMY_DEATH_PHRASING_RE used by parseExtraAction (do NOT broaden
// that one). "on kill" (Mangler/Butcher), "upon killing an enemy/opponent" (Mangler/Ravager/
// Asphyxiator/Butcher), "when an enemy dies". Reference data: docs/ship-skills.csv.
const KILL_TRIGGER_RE =
    /\bon\s+(?:a\s+)?kill\b|killing\s+an\s+(?:enemy|opponent)|when\s+an\s+enemy\s+dies/i;
// Ship-kit W8 Task 13 (Meiying): "killing an enemy WITH A DEBUFF" — the qualifier
// KILL_TRIGGER_RE's bare "killing an (enemy|opponent)" alternate drops (that shared regex also
// feeds the on-enemy-destroyed TRIGGER classification for every OTHER kill-reactive ship —
// Mangler/Ravager/Butcher/Obsidian/Valiant/Sokol have no such qualifier and must stay ungated).
// Kept as a SEPARATE regex, consumed only by detectGrantConditions below, so it attaches a
// gating CONDITION onto the debuff a kill-clause grants without touching trigger resolution any
// other kill clause shares. Verified corpus-unique to Meiying (docs/ship-skills.csv, grep "with a
// Debuff").
const KILL_WITH_DEBUFF_RE = /\bkilling\s+an\s+enemy\s+with\s+a\s+debuff\b/i;
// Quixilver R2: "if it has shield equal to 100% of its max HP" → self-shield-full (the caster's
// OWN shield pool, cast-time). Requires the explicit 100%-of-max-HP wording so a bare "When
// Shielded" (Malvex's reactive `self-shielded` INCOMING-hit condition — shieldPool > 0, a
// different mechanism) cannot co-match. Corpus-verified (docs/ship-skills.csv, grep "equal to
// 100%.*max"): Quixilver's third-passive Barrier grant is the only row with this phrasing.
const SHIELD_FULL_RE = /\bshield\s+equal\s+to\s+100%\s+of\s+(?:its|their)\s+max(?:imum)?\s*hp\b/i;
// Malvex charged Barrier: "If the target has a Shield" → enemy-shield (the TARGET's shield pool,
// cast-time). Subject-anchored on "the target|enemy" so it can never co-match the owner-side
// `if this unit has shield` rule (APEX) handled just above it in detectGrantConditions. The
// trailing `\b` after "shield" keeps the phrase from being swallowed by a longer noun — and the
// "a" is optional because the same ship writes it both with and without a comma before the
// consequent. Corpus-verified (docs/ship-skills.csv, grep "target has a Shield"): Malvex's active
// and charged rows are the only two occurrences in the game, and only the charged one grants a
// named buff — so only the charged one reaches detectGrantConditions. The active row's grant is a
// NAMELESS self-shield, gated through `detectTargetShieldGate` below (the heal/shield builder's
// entry point to this same rule); keep both consumers in step when editing the pattern.
const TARGET_HAS_SHIELD_RE = /\bif\s+the\s+(?:target|enemy)\s+has\s+(?:a\s+)?shield\b/i;

/**
 * Whether an ALREADY-SCOPED clause carries the "If the target has a Shield" gate — the
 * heal/shield-builder entry point to the same rule `detectGrantConditions` applies to named buffs
 * (which resolves its own clause off the buff name; a nameless shield grant has no name to resolve
 * on, so the CALLER must pass a sentence-scoped string, not the whole skill row).
 *
 * Corpus (docs/ship-skills.csv, grep "target has a Shield"): Malvex's active and charged rows are
 * the only two occurrences in the game. The charged one grants a named Barrier and goes through
 * detectGrantConditions; the active one grants a nameless self-shield and comes through here.
 */
export function detectTargetShieldGate(clause: string | null | undefined): boolean {
    return !!clause && TARGET_HAS_SHIELD_RE.test(clause);
}
// "On inflicting a debuff" / "upon applying a debuff" → on-debuff-inflicted (Butcher Marauder Rage II).
const APPLYING_DEBUFF_RE = /\b(?:upon|on|after|when)\s+(?:inflicting|applying)\s+(?:a\s+)?debuff/i;
// Ship-kit W7: present-tense SELF-subject "when this Unit inflicts a Debuff" → on-debuff-inflicted
// (Warden's Out. Damage Down II follow-up). APPLYING_DEBUFF_RE above only matches the gerund
// ("on inflicting"), so this present-tense form previously fell through to on-cast — landing a
// passive-slot enemy timed debuff in a dispatch path the engine never fires. SELF-scoped ("this
// Unit") so it never co-matches an ally/enemy-subject infliction (those are on-ally-debuff-
// inflicted / on-attacked, resolved elsewhere). Corpus-verified: Warden is the only ship with
// this exact phrasing.
const SELF_INFLICTS_DEBUFF_RE = /\bwhen\s+this\s+unit\s+inflicts\s+(?:a\s+)?debuff/i;
// "If its debuff is resisted" — Ravager's INFLICTOR-side reaction (the debuff THIS unit
// inflicted got resisted). Distinct from the resister-side "when this Unit resists a debuff"
// (parseOnResistHpDamage). Corpus-verified: Ravager is the only "its debuff is resisted" row.
const OWN_DEBUFF_RESISTED_RE = /\bits\s+debuff\s+is\s+resisted\b/i;
// SP-F F2: "when an ally [within the Active pattern] has their Shield destroyed" — AEGIS's sole
// corpus reaction (docs/ship-skills.csv). The loose [^.]*? gaps cross the "within the Active
// pattern" positional qualifier and any tag text between "ally" and "shield"/"destroyed".
const ALLY_SHIELD_DESTROYED_RE = /\bwhen\s+an\s+ally\b[^.]*?\bshield\b[^.]*?\bdestroyed\b/i;
// Ship-kit Wave 3, Task 4: "When an enemy defender gains Taunt" — Amartya's Exposed grant
// (docs/ship-skills.csv row 4, second/third passive: "When an enemy defender gains Taunt, this
// Unit inflicts N stacks of Exposed on that defender."). Distinct from ENEMY_BUFFED_RE (any-buff,
// "gets/is/are/becomes buffed") — this is name-specific to Taunt and requires the "gains" verb, so
// it does not co-match any self-gain "this Unit gains Taunt" phrasing elsewhere in the corpus
// (Sabertooth/Isha/Xarrow's own Taunt self-grants all use "this Unit gains", not "an enemy...
// gains"). Corpus-verified (docs/ship-skills.csv, grep "enemy[^.]*gains[^.]*taunt"): only
// Amartya's two passive rows match.
const ENEMY_GAINS_TAUNT_RE = /\bwhen\s+an?\s+enemy\b[^.]*?\bgains?\b[^.]*?\btaunt\b/i;

/**
 * Detects a reactive AbilityTrigger for the buff/debuff/DoT named `buffName`, scoped to the
 * buff's own clause (using the SAME shared clause resolution + abbreviation masking as
 * detectGrantConditions). Returns one of the derivable reactive triggers or undefined.
 *
 * Rules (on the buff's clause):
 *  - active-voice crit phrasing → 'on-crit' (Enforcer "critically hits", Wusheng
 *    "critically damaging"). Guarded against passive voice: "is critically hit" /
 *    "is critically damaged" do NOT classify. NOTE: detectGrantConditions' self-crit rule
 *    uses a looser regex and WOULD misclassify "is critically damaged" as a self-crit
 *    condition; that legacy behaviour is left untouched (no ship text relies on it), but this
 *    new trigger path is correct.
 *  - "at the start of (the|each|every) round" → 'start-of-round' (Valkyrie).
 *  - "at the start of (the|its|each|every) turn" → 'start-of-turn' (epic PR4: Cobalt's Out.
 *    Damage Up II buff, sharing its trailing gate with the sibling charge ability).
 *  - "detonates a Bomb" / "Bomb explodes" → 'on-bomb-detonated' (Lingshe).
 *  - "when an enemy cleanses a debuff" → 'on-enemy-cleansed' (Phase 4c PR 4: Arum Out. Damage
 *    Down I, Yarrow/Larkspur Gelecek Contagion). LIVE in healing mode (the DPS sim ignores
 *    enemy-action triggers); Grif's NAMELESS damage proc on the same phrasing is handled by
 *    detectEnemyCleanseTrigger (sentence-scoped) since it has no buffName to key on.
 *  - "when an enemy performs a repair" → 'on-enemy-repaired' (Overload lifecycle, Task 4).
 *    Checked BEFORE the kill rule so Ruiner's comma-joined grant resolves correctly.
 *  - "when this Unit cleanses a Debuff" / "upon Cleansing a Debuff" → 'on-own-cleanse'
 *    (Phase 3 PR-H: Morao's Defense Up II grant).
 *  - "on kill" / "upon killing an enemy" / "when an enemy dies" → 'on-enemy-destroyed'
 *    (Overload lifecycle, Task 4: Mangler/Ravager/Asphyxiator/Butcher).
 *  - "on inflicting a debuff" / "upon applying a debuff" → 'on-debuff-inflicted'
 *    (Overload lifecycle, Task 4: Butcher Marauder Rage II).
 *  - "if its debuff is resisted" → 'on-own-debuff-resisted' (PR-B2: Ravager's Hacking Module
 *    Overdrive grant; inflictor-scoped mirror of the resister-side on-debuff-resisted).
 *  - "when an enemy [defender] gains Taunt" → 'on-enemy-taunt-gained' (Ship-kit Wave 3, Task 4:
 *    Amartya's Exposed grant). Narrow and name-specific to Taunt — distinct from the broad,
 *    unfiltered on-enemy-buffed (ENEMY_BUFFED_RE).
 *
 * Other reactive phrasings (when-attacked, ally-crit, …) are NOT derivable this phase and stay
 * undefined (manual modelling). Reference data: docs/ship-skills.csv.
 */
export function detectReactiveTrigger(
    skillText: string | null | undefined,
    buffName: string,
    occurrenceIndex = 0
): AbilityTrigger | undefined {
    if (!skillText || !buffName) return undefined;
    const clause = resolveBuffClause(skillText, buffName, occurrenceIndex);
    // "when an ally critically hits" → on-ally-crit (Pallas's Everliving Regeneration buff grant).
    // Checked BEFORE the self-crit rule: matchesActiveSelfCrit would also match "critically hits"
    // here, but the ally subject makes this an ally-scoped trigger, not a self-crit.
    if (ALLY_CRIT_HIT_RE.test(clause)) return 'on-ally-crit';
    if (matchesActiveSelfCrit(clause)) return 'on-crit';
    // SP-D (Berserker): "gains <Buff> for N turns when hitting 3 ore more enemies" is a
    // reaction to THIS UNIT's own damage-dealing action (same family as the self-crit rule
    // above), not a combat-start-only fact — route it through on-deal-damage so the drain-time
    // enemies-hit-this-cast gate (still carried in `conditions`, untouched here) re-evaluates on
    // every damage-dealing cast instead of being seeded once at combat start (which can never
    // observe a real hit count before any turn has fired).
    if (hitCountConditionFromClause(clause.toLowerCase())) return 'on-deal-damage';
    if (START_OF_ROUND_RE.test(clause)) return 'start-of-round';
    // Ship-kit W8, Task 4: "at the end of the round" → end-of-round (Chimei's non-defender
    // below-40%-HP Stealth grant). Shares END_OF_ROUND_RE with detectEndOfRoundPurgeTrigger/
    // detectEndOfRoundDamageTrigger (Rhodium) — same phrase, buff-grant call site. Checked
    // AFTER start-of-round since resolveBuffClause is sentence-scoped (Chimei's grant sentence
    // only contains "end of the round"; the sibling "start of the round" repair sentence is a
    // separate clause keyed on the same buff name but matched first by resolveBuffClause, so it
    // never reaches here) — this ordering just mirrors the existing rule for readability.
    if (END_OF_ROUND_RE.test(clause)) return 'end-of-round';
    // Ship-kit W9, Task 5: "at the end of this Unit's turn" → end-of-turn (Quixilver R2's
    // Barrier grant). Checked AFTER end-of-round for the same reason START_OF_ROUND_RE is
    // checked first above — the two phrasings never co-occur in one clause, but this mirrors
    // the existing ordering for readability. Routing this OFF on-cast matters beyond the trigger
    // label: the ability is granted from a PASSIVE slot, and a passive-slot on-cast buff is only
    // ever seeded once at combat start (engine.ts's seedPassiveTimedStatuses, gated `r === 1`).
    // end-of-turn is a LIVE trigger (triggers.ts), so partitionReactiveAbilities routes it onto
    // the reactive path instead — it re-fires every one of the owner's turns, not just round 1.
    if (END_OF_OWN_TURN_RE.test(clause)) return 'end-of-turn';
    // Epic PR4: "at the start of (the|its|each|every) turn" — Cobalt's Out. Damage Up II buff
    // shares its governing trailing phrase with its sibling charge ability (already
    // start-of-turn via START_OF_TURN_CHARGE_RE in the charge-specific parser); this was the
    // only "at the start of the turn" BUFF grant in the corpus at write time (verified against
    // docs/ship-skills.csv — Volk/Xcellence's start-of-turn heal/shield use separate,
    // non-buff parse paths untouched by this branch).
    if (START_OF_TURN_CHARGE_RE.test(clause)) return 'start-of-turn';
    // Ship-kit W7: DETONATOR-scoped "this Unit detonates a Bomb" (Lingshe) is checked BEFORE the
    // victim-scoped "bomb explodes" family — the two are mutually exclusive by phrasing, but this
    // ordering makes the detonator reading win unambiguously.
    if (SELF_DETONATES_BOMB_RE.test(clause)) return 'on-self-bomb-detonated';
    // #345: the APPLIER-scoped Echoing Burst reading is checked BEFORE the Bomb one for the same
    // reason the detonator-scoped one is — the phrasings are mutually exclusive (an Echoing Burst
    // clause never says "bomb explodes"), and this ordering makes the narrower reading win
    // unambiguously. No corpus buff/debuff grant rides this clause today (Valkyrie's Echoing
    // Burst sentence grants only repairs, which reach the trigger via the heal builder's
    // detectEchoingBurstDetonatedTrigger); it is here so a future named grant in that sentence
    // cannot silently fall through to the Bomb trigger.
    if (ECHOING_BURST_DETONATE_RE.test(clause)) return 'on-own-echoing-burst-detonated';
    if (BOMB_DETONATE_RE.test(clause)) return 'on-bomb-detonated';
    // "when Cheat Death activates" → on-cheat-death-activated (Yazid's Barrier grant in the
    // repair sentence). Tycho's below-40%-HP Barrier is a different reactive (deferred), so this
    // only matches the literal activation phrasing.
    if (CHEAT_DEATH_ACTIVATES_RE.test(clause)) return 'on-cheat-death-activated';
    // "when an enemy cleanses a debuff" → on-enemy-cleansed (Phase 4c PR 4). Previously this
    // phrasing fell through to undefined (manual modelling); it is now a LIVE derivable trigger
    // for the named buff/debuff grant in its clause (Arum Out. Damage Down I, Yarrow/Larkspur
    // Gelecek Contagion, Arum-refit all-allies Gelecek Contagion II).
    if (ENEMY_CLEANSE_RE.test(clause)) return 'on-enemy-cleansed';
    // Phase 3 PR-H: "when this Unit cleanses a Debuff" / "upon Cleansing a Debuff" — Morao's
    // Defense Up II grant. Clause-scoped by buffName (resolveBuffClause) so no anchor-position
    // ambiguity — a buff name is unique per grant, unlike the heal-side same-pct collision (see
    // ParsedHealAbility.ownCleanseReaction in parseHealAbilities for that case).
    if (OWN_CLEANSE_TRIGGER_RE.test(clause)) return 'on-own-cleanse';
    // Phase 3 PR-I: "when an enemy gets buffed" → on-enemy-buffed (Nuqtu's Terran Bolster III
    // grant). See ENEMY_BUFFED_RE's doc comment for the corpus-verification that only Nuqtu's
    // clauses match.
    if (ENEMY_BUFFED_RE.test(clause)) return 'on-enemy-buffed';
    // Ship-kit Wave 3, Task 4: "when an enemy [defender] gains Taunt" → on-enemy-taunt-gained
    // (Amartya's Exposed grant). Checked AFTER the broad ENEMY_BUFFED_RE (harmless ordering here —
    // ENEMY_BUFFED_RE's own "gets/is/are/becomes buffed" phrasing never matches "gains Taunt", so
    // this branch is only ever reached via ENEMY_GAINS_TAUNT_RE's own distinct match).
    if (ENEMY_GAINS_TAUNT_RE.test(clause)) return 'on-enemy-taunt-gained';
    // Overload lifecycle (Task 4). REPAIR is checked BEFORE KILL: Ruiner's Overload grant and its
    // kill-removal share one comma-joined sentence ("gains Overload when an enemy performs a repair,
    // upon killing an enemy, this Unit removes Overload") — the grant must resolve to
    // on-enemy-repaired. Safe: no Marauder Rage clause contains "repair", and the Mangler/Ravager/
    // Butcher Overload grants use the accumulating "every turn" path (not detectReactiveTrigger).
    if (ENEMY_REPAIRS_RE.test(clause)) return 'on-enemy-repaired';
    if (KILL_TRIGGER_RE.test(clause)) return 'on-enemy-destroyed';
    if (APPLYING_DEBUFF_RE.test(clause)) return 'on-debuff-inflicted';
    // Ship-kit W7: present-tense self-subject "when this Unit inflicts a Debuff" (Warden).
    if (SELF_INFLICTS_DEBUFF_RE.test(clause)) return 'on-debuff-inflicted';
    // Paracelsus: "Upon being killed by direct Damage … grants allies <buff>" — the named-buff
    // half of an on-destroyed clause. Mirrors Faust's detectKilledByDirectDamageTrigger (which
    // routes the purge half); here the buffName-scoped clause carries the same phrase.
    if (KILLED_BY_DIRECT_RE.test(clause)) return 'on-destroyed';
    // Ravager: "If its debuff is resisted, it gains <buff>" — inflictor-side reaction.
    if (OWN_DEBUFF_RESISTED_RE.test(clause)) return 'on-own-debuff-resisted';
    // SP-F F2: "when an ally ... has their Shield destroyed" — AEGIS's Defense Up II grant.
    if (ALLY_SHIELD_DESTROYED_RE.test(clause)) return 'on-ally-shield-destroyed';
    return undefined;
}

/** Oleander: an ALLY-target buff granted in a "when an ally inflicts a debuff" clause rides
 *  on-ally-debuff-inflicted (routed to the inflicting ally via eventCtx.damagedAllyId). Scoped to
 *  the buff's OWN clause (resolveBuffClause). Distinct from detectReactiveTrigger because that
 *  function is target-blind: the caller gates this on target==='ally' so an enemy-target counter-
 *  debuff in the same "ally inflicts a debuff" phrasing family (Provider's Crit Rate Down II)
 *  stays on-cast. */
export function detectAllyInflictsGrantTrigger(
    text: string | null | undefined,
    buffName: string,
    occurrenceIndex = 0
): AbilityTrigger | undefined {
    if (!text || !buffName) return undefined;
    return ALLY_INFLICTS_DEBUFF_RE.test(resolveBuffClause(text, buffName, occurrenceIndex))
        ? 'on-ally-debuff-inflicted'
        : undefined;
}

// Epic PR4 (start-of-combat one-time grant family): "At the start of combat, this Unit gains
// <Buff> for N turns" — Crucialis's Atlas Coordination I/II, Tycho's Cheat Death + Everliving
// Regeneration I/II. Deliberately NOT folded into detectReactiveTrigger above: 'pre-combat' is
// annotation-only (excluded from LIVE_TRIGGERS — see types/abilities.ts), not a live reactive
// trigger, so it does not belong in a function documented as resolving REACTIVE triggers.
const START_OF_COMBAT_GRANT_RE = /\bat the start of combat\b/i;

/**
 * Returns 'pre-combat' when `buffName`'s own clause (same resolution as detectReactiveTrigger)
 * carries the "at the start of combat" phrase; otherwise undefined. Does NOT cover Meatshield's
 * "gains 3 stacks of Protection" (its stacking default still climbs per round — the trigger
 * relabel is held back with it so the two halves ship together; see the buildShipAbilities
 * caller's isAccumulatingBuff guard). The SHIELD components of the same family are covered by
 * detectPreCombatShieldTrigger below. Reference data: docs/ship-skills.csv.
 */
export function detectPreCombatBuffTrigger(
    text: string | null | undefined,
    buffName: string,
    occurrenceIndex = 0
): AbilityTrigger | undefined {
    if (!text || !buffName) return undefined;
    const clause = resolveBuffClause(text, buffName, occurrenceIndex);
    // Meiying p2 exclusion: "At the start of combat AND EVERY TURN, this Unit gains Stealth for
    // 2 turns" is a RECURRING grant, not a one-time one — the "every turn" rider disqualifies
    // the pre-combat relabel (the grant must keep its per-turn refresh semantics).
    if (/\bevery\s+turn\b/i.test(clause)) return undefined;
    return START_OF_COMBAT_GRANT_RE.test(clause) ? 'pre-combat' : undefined;
}

/**
 * Epic PR4: returns 'pre-combat' when `anchorPos` (a shield ability's raw-text anchor) falls
 * inside the sentence carrying the "at the start of combat" phrase; otherwise undefined.
 * Position-scoped counterpart to detectPreCombatBuffTrigger for the NAMELESS shield grants
 * (Crucialis "At the start of combat, this Unit gains a Shield equal to 20% of its Max HP …",
 * FrontLine "This Unit gains Shield equal to 25% of its Max HP at the start of combat") — no
 * buffName to resolve a clause on, so it scopes by sentence like detectEndOfRoundPurgeTrigger.
 * The engine consumes the tag via seedPreCombatShields (once, before round 1); the cast path
 * skips pre-combat abilities. Reference data: docs/ship-skills.csv.
 */
export function detectPreCombatShieldTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, START_OF_COMBAT_GRANT_RE, anchorPos, 'pre-combat');
}

// POSITION-scoped trigger resolver for a self-buff REMOVAL (Overload lifecycle, Task 5).
//
// Unlike detectReactiveTrigger (which scopes by the buff's NAME clause), the removal trigger must
// be resolved from text NEAR the removal verb: a buff like Overload often appears in BOTH an
// earlier GRANT sentence (start-of-round / on-repair) and a separate REMOVAL clause (on-kill).
// Keying off the buff name would pick the grant's trigger; the removal needs the kill trigger.
//
// WINDOW = the comma-or-sentence segment containing `idx` PLUS the immediately preceding segment
// (the leading trigger phrase often sits in the prior comma-clause, e.g. Ruiner/Asphyxiator's
// "upon killing an enemy, this Unit removes Overload"). For Ruiner the grant's "performs a repair"
// segment is TWO segments back, so it is excluded from the removal window and cannot mis-match.
//
// INDEX STABILITY: `idx` is a match position into the TAGGED text. We MUST NOT stripUnitTags here —
// stripUnitTags deletes characters and shifts every downstream position, so a tagged idx would no
// longer align (off-by-N window). We mirror rawSentenceAround: length-PRESERVING maskAbbrev only,
// segment on the un-stripped text. Comma/period boundaries never fall inside <unit-skill> tags, so
// segmentation is identical with or without tags; only the index mapping is fragile.
const REMOVAL_SEGMENT_BOUNDARY = /[,.;](?=\s|$)|<br\s*\/?>/gi;
// Ship-kit Wave 8 Task 11 (Wusheng): "If directly damaged while <buff> is active, remove <buff>."
// Unlike DR_DIRECT_DAMAGE_RE (the general reaction detector, which deliberately excludes "if" —
// Panon's "If this Unit is directly damaged" is a conditional GRANT, out of scope there), this
// window-scoped removal detector accepts BOTH "if" and "when": detectRemovalTriggerAt only ever
// runs on a window already anchored at a removal verb (parseSelfBuffRemovals' scan), so there is
// no risk of over-matching an unrelated conditional grant sentence — Panon never reaches this
// function at all (it has no "loses/removes/remove <unit-skill>" clause to scan for).
const REMOVAL_DIRECT_DAMAGE_RE = /\b(?:if|when)\s+directly\s+damaged\b|\bwhen\s+attacked\b/i;
function detectRemovalTriggerAt(text: string, idx: number): AbilityTrigger {
    const masked = maskAbbrev(text);
    // Collect segment boundary spans [start,end) keyed by their terminator position so we can find
    // the segment containing idx plus the one before it.
    const segments: { start: number; end: number }[] = [];
    let start = 0;
    let m: RegExpExecArray | null;
    REMOVAL_SEGMENT_BOUNDARY.lastIndex = 0;
    while ((m = REMOVAL_SEGMENT_BOUNDARY.exec(masked)) !== null) {
        const end = m.index + m[0].length;
        segments.push({ start, end });
        start = end;
    }
    segments.push({ start, end: masked.length });
    let containing = segments.length - 1;
    for (let i = 0; i < segments.length; i++) {
        if (idx < segments[i].end) {
            containing = i;
            break;
        }
    }
    const windowStart =
        containing > 0 ? segments[containing - 1].start : segments[containing].start;
    const window = masked.slice(windowStart, segments[containing].end);
    // Order mirrors detectReactiveTrigger's reactive tail. For a REMOVAL window kill-first is safe:
    // the window excludes the earlier repair-grant segment (Ruiner), so it cannot match repair.
    if (KILL_TRIGGER_RE.test(window)) return 'on-enemy-destroyed';
    if (ENEMY_REPAIRS_RE.test(window)) return 'on-enemy-repaired';
    if (APPLYING_DEBUFF_RE.test(window)) return 'on-debuff-inflicted';
    if (START_OF_ROUND_RE.test(window)) return 'start-of-round';
    // Wave 8 Task 11: "if/when directly damaged, remove <buff>" (Wusheng) — the self-scoped
    // direct-damage reaction, mirroring HEAL_DAMAGE_REACTION_RE's "when … directly damaged"
    // shape but scoped to this removal window only (see REMOVAL_DIRECT_DAMAGE_RE doc above).
    if (REMOVAL_DIRECT_DAMAGE_RE.test(window)) return 'on-attacked';
    return 'on-cast';
}

// Active removal: "loses/removes <unit-skill>NAME</unit-skill>" (Mangler/Ravager/Asphyxiator/
// Butcher-R1/Ruiner), plus the bare imperative "remove <unit-skill>NAME</unit-skill>" (Wusheng
// Wave 8 Task 11: "…remove Stealth."). Corpus-verified (docs/ship-skills.csv): the ONLY two
// "remove[s]? <unit-skill>" matches in the whole sheet are Ruiner's "removes Overload" (already
// covered by the `removes` alternative) and Wusheng's "remove Stealth" — no ship uses the bare
// imperative to describe removing a buff FROM AN ENEMY, so broadening to `remove` cannot mint a
// phantom removal anywhere else. Passive removal: "<unit-skill>NAME</unit-skill> is lost"
// (Butcher-R2).
const SELF_BUFF_REMOVAL_ACTIVE_RE =
    /\b(?:loses|removes|remove)\s+<unit-skill>([^<]+)<\/unit-skill>/gi;
const SELF_BUFF_REMOVAL_PASSIVE_RE = /<unit-skill>([^<]+)<\/unit-skill>\s+is\s+lost\b/gi;

/**
 * Parses "this Unit loses/removes <buff>" and the passive "<buff> is lost" into self-buff-removal
 * descriptors, resolving each removal's trigger from text NEAR the removal verb (NOT by buff-name
 * sentence — see detectRemovalTriggerAt). Unknown buffs are skipped (resolveBuffName gate) and
 * duplicate buff names are deduped. Operates on the TAGGED text. Reference data: docs/ship-skills.csv.
 */
export function parseSelfBuffRemovals(
    text: string
): { buffName: string; trigger: AbilityTrigger }[] {
    const out: { buffName: string; trigger: AbilityTrigger }[] = [];
    const seen = new Set<string>();
    const scan = (re: RegExp) => {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const name = resolveBuffName(m[1]);
            if (!name || seen.has(name)) continue;
            seen.add(name);
            out.push({ buffName: name, trigger: detectRemovalTriggerAt(text, m.index) });
        }
    };
    scan(SELF_BUFF_REMOVAL_ACTIVE_RE);
    scan(SELF_BUFF_REMOVAL_PASSIVE_RE);
    return out;
}

/**
 * Maps a targeting status to its model condition. Both call sites (detectGrantConditions'
 * "if this Unit is/affected by Taunt or Provoke" gate, and affectedByConditions' "when affected
 * by Taunt or Provoke" damage modifier gate) check the status on the CASTER, not an opponent.
 * Taunt is a buff the caster applies to ITSELF ("Forces enemies to target this unit" —
 * constants/buffs.ts) and Provoke is a debuff on THIS unit; both therefore resolve against the
 * caster's own buff/debuff set. Both are derivable (checked live from self's active
 * buffs/debuffs). Any other named status falls back to a manual (non-derivable) self-buff.
 * (Epic PR5 finding 1: Taunt previously resolved as an enemy-buff — subject inverted — because
 * Taunt CAN also be checked on an opponent in other phrasings, e.g. "ignoring Taunt and Provoke"
 * targeting bypass; but that phrasing is handled entirely by detectIgnoresForcedTargeting, not
 * this function, so every actual caller here is self-subject.)
 */
export function statusEffectCondition(name: string, anyOf = false): Condition {
    const lower = name.toLowerCase();
    if (lower === 'taunt')
        return {
            subject: 'self-buff',
            buffName: 'Taunt',
            derivable: true,
            ...(anyOf ? { anyOf: true } : {}),
        };
    if (lower === 'provoke')
        return {
            subject: 'self-debuff',
            buffName: 'Provoke',
            derivable: true,
            ...(anyOf ? { anyOf: true } : {}),
        };
    // Any other named status → manual self-buff (unchanged; out of item-11 scope).
    return {
        subject: 'self-buff',
        buffName: name,
        derivable: false,
        ...(anyOf ? { anyOf: true } : {}),
    };
}

// "extends [active/all] Damage Over Time [(DoT)] effects by N turn(s)" — prolongs existing
// ticking DoTs (Provider's charge). Requires "Damage Over Time" so it doesn't catch generic
// buff/debuff duration extensions.
const EXTEND_DOT_RE = /extends?\b[^.]*?\bdamage over time\b[^.]*?\bby\s+(\d+)\s+turns?/i;

/**
 * Returns the number of turns a skill extends active Damage Over Time effects by, or null
 * when the skill has no DoT-extension clause. Reference data: docs/ship-skills.csv.
 */
export function parseExtendDoT(text: string | null | undefined): number | null {
    if (!text) return null;
    const m = EXTEND_DOT_RE.exec(stripUnitTags(text));
    return m ? parseInt(m[1], 10) : null;
}

// Ship-kit Wave 4, Task 5: generic buff/debuff DURATION EXTENSION — the inverse of
// parseDebuffDurationReduction, and a sibling of EXTEND_DOT_RE (which is DoT-tick-store-only
// and requires the literal "Damage Over Time" phrase). Two surface forms in the corpus:
//   active voice:  "extends [their] active <Buffs|Debuffs> by N turn(s)"   (Sokol, Ripper)
//   passive voice: "<buffs|debuffs> [are] extended by N turn(s)"           (Lev)
// Both carry a negative lookahead for "damage over time" so a row that ALSO has a DoT-extend
// clause elsewhere in the same (period-scoped) segment never double-matches here — the
// corpus never combines them on one clause, but the guard is cheap insurance (mirrors the
// audit rule's own DoT exclusion, per the investigation doc).
const EXTEND_STATUS_ACTIVE_RE =
    /extends?\b(?![^.]*\bdamage over time\b)[^.]*?\bactive\s+(buffs|debuffs)\b[^.]*?\bby\s+(\d+)\s+turns?/i;
const EXTEND_STATUS_PASSIVE_RE =
    /\b(buffs|debuffs)\b(?![^.]*\bdamage over time\b)[^.]*?\bextended\b[^.]*?\bby\s+(\d+)\s+turns?/i;

// #363 (Fuying): "extends <unit-skill>Stealth</unit-skill> by 1 turn" — a NAMED status, where the
// two arms above require a literal 'buffs'/'debuffs' token. Matched against the TAGGED text so the
// <unit-skill> boundary identifies the status name exactly, rather than guessing where a bare
// capitalised phrase ends. (Same reasoning as maskStatusNameRepairs in #362: the tag boundary is
// information, and stripping tags first throws it away.)
const EXTEND_NAMED_STATUS_RE =
    /extends?\s+<unit-skill>([^<]+)<\/unit-skill>\s+by\s+(\d+)\s+turns?/i;

/**
 * Parses a generic buff/debuff duration-extension clause into its turns + statusKind, or null
 * when absent. Runs over stripUnitTags(text) so both the `<unit-aid>`-wrapped active-voice form
 * (Sokol/Ripper) and the plain passive-voice form (Lev) match. Reference: docs/ship-skills.csv.
 *
 * #363 (Fuying): a NAMED arm ("extends <unit-skill>Stealth</unit-skill> by 1 turn") is tried
 * FIRST, against the ORIGINAL (tagged) text — it is strictly more specific than the two generic
 * arms below, which require a literal 'buffs'/'debuffs' token and so can never match it.
 *
 * The named arm's captured phrase is resolved through `resolveBuffName`, so an UNRECOGNISED name
 * emits NO `buffName` at all rather than a literal one. That is not cosmetic. `buffName` is matched
 * by exact name against the target's live statuses in `extendAllBuffsDuration`, so a name that is
 * not in `BUFFS` can never match anything and the clause silently extends NOTHING — strictly worse
 * than the absent-`buffName` fallback, which extends every standing buff (Sokol/Ripper/Lev's
 * behaviour). Unreachable today (Fuying's "Stealth" resolves exactly), but it is the trap waiting
 * for the next named-extend ship, and it mirrors the precedent `DR_ALLY_STATUS_RE` already set for
 * `detectDamageReactionTrigger`'s `allyStatusName`.
 */
export function parseExtendStatus(
    text: string | null | undefined
): { turns: number; statusKind: 'buff' | 'debuff'; buffName?: string } | null {
    if (!text) return null;
    const named = EXTEND_NAMED_STATUS_RE.exec(text);
    if (named) {
        const canonical = resolveBuffName(named[1]);
        return {
            turns: parseInt(named[2], 10),
            statusKind: 'buff',
            // Unresolved → omit the field entirely, falling back to the safe extend-everything
            // behaviour instead of a name that can never match a real applied status.
            ...(canonical !== undefined ? { buffName: canonical } : {}),
        };
    }
    const plain = stripUnitTags(text);
    const m = EXTEND_STATUS_ACTIVE_RE.exec(plain) ?? EXTEND_STATUS_PASSIVE_RE.exec(plain);
    if (!m) return null;
    const kind: 'buff' | 'debuff' = m[1].toLowerCase().startsWith('debuff') ? 'debuff' : 'buff';
    return { turns: parseInt(m[2], 10), statusKind: kind };
}

// "extend(s/ed) … by/for N turn(s) … chance … crit power" — a duration extension whose chance is
// the crit-power stat (Valerian, Belladonna). The trigger gates it: an ally inflicting → the
// team-dependent ally-inflicts-debuff; otherwise a self crit ("with a Critical hit") → self-crit.
const CRIT_POWER_EXTEND_RE =
    /extend\w*\b[^.]*?\b(?:by|for)\s+(\d+)\s+turns?\b[^.]*?\bchance\b[^.]*?\bcrit(?:ical)?\s*power\b/i;

/**
 * Parses a crit-power-chance DoT extension: the turns and the gating condition. Returns null when
 * absent. The extension fires with probability min(1, critPower/100), gated by the condition.
 */
export function parseCritPowerExtend(
    text: string | null | undefined
): { turns: number; condition: Condition; scope: 'active' | 'inflicted' } | null {
    if (!text) return null;
    const plain = stripUnitTags(text);
    const m = CRIT_POWER_EXTEND_RE.exec(plain);
    if (!m) return null;
    const condition: Condition = /\ball(?:y|ies)\b[^.]*\binflict/i.test(plain)
        ? { subject: 'ally-inflicts-debuff', derivable: false }
        : { subject: 'self-crit', derivable: true };
    // "the newly applied <DoT> ... extended" → only THIS cast's freshly applied DoT
    // grows (Valerian/Belladonna), not every standing entry. Matched against the
    // extend clause text so it stays tight to the actual wording.
    const scope: 'active' | 'inflicted' = /newly\s+applied|inflicted\s+corrosion/i.test(plain)
        ? 'inflicted'
        : 'active';
    return { turns: parseInt(m[1], 10), condition, scope };
}

// SP-E, Task E4: "convert the Corrosion into Acidic Decay of the same level, ... 1% per 10
// Hacking" (Belladonna). Anchored on "of the same level" (not just a lazy `[^.]*?` scan) so the
// named-family capture group stops at the right boundary — the family name can be multi-word
// ("Acidic Decay") and a bare lazy match would otherwise capture only its first word.
const CONVERT_DOT_RE =
    /convert\s+the\s+(corrosion|inferno)\s+into\s+([\w\s]+?)\s+of\s+the\s+same\s+level[^.]*?(\d+(?:\.\d+)?)%\s+per\s+(\d+)\s+hacking/i;

/**
 * Parses a "convert the <DoT> into <family> of the same level ... N% per M Hacking" clause into
 * its conversion descriptor, or undefined when absent. `pctPerPoint` is the %-per-Hacking-point
 * rate (1% per 10 Hacking → 0.1). Reference data: docs/ship-skills.csv (Belladonna).
 */
export function detectConvertDot(
    text: string | null | undefined
): { fromDotType: DoTType; buffName: string; pctPerPoint: number } | undefined {
    if (!text) return undefined;
    const plain = stripUnitTags(text);
    const m = CONVERT_DOT_RE.exec(plain);
    if (!m) return undefined;
    return {
        fromDotType: m[1].toLowerCase() as DoTType,
        buffName: m[2].trim(),
        pctPerPoint: parseFloat(m[3]) / parseInt(m[4], 10),
    };
}

// Crocus: "when (an/another) ally inflicts a Damage Over Time (DoT) effect with a critical hit".
const ALLY_CRIT_DOT_RE =
    /\ball(?:y|ies)\b[^.]*\binflict\w*[^.]*\b(?:damage over time|dot)\b[^.]*\bcritical/i;

/** Whether a skill triggers "when an ally inflicts a DoT with a critical hit" (manual, team-gated). */
export function parseAllyCritDot(text: string | null | undefined): boolean {
    return !!text && ALLY_CRIT_DOT_RE.test(stripUnitTags(text));
}

/**
 * Returns 'on-ally-crit-dot' when `anchorPos` (the ability's raw-text anchor position) falls
 * inside the sentence carrying the "when (an/another) ally inflicts a DoT effect with a
 * critical hit" phrase; otherwise undefined. Position-scoped on the RAW text (mirrors
 * detectCritRepairTrigger). This is the HEAL-builder counterpart to parseAllyCritDot's
 * DoT-infliction reading of the same phrase (Crocus p1: self-repair; Crocus p3/refit-passive
 * additionally chains a DoT infliction on the same trigger, handled separately in
 * buildShipAbilities' dot-effects branch). Reference data: docs/ship-skills.csv (Crocus).
 */
export function detectAllyCritDotTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, ALLY_CRIT_DOT_RE, anchorPos, 'on-ally-crit-dot');
}

// Ship-kit W8 Task 10 (Wisteria): self-subject mirror of ALLY_CRIT_DOT_RE (Crocus's "when an
// ally inflicts a DoT with a critical hit"). Wisteria's own-cast phrasing instead uses
// "applying" (not "inflicts a DoT ... with a critical hit") and carries no "ally" subject
// (self-implied by "This Unit"):
//  - R0: "This Unit, after applying Corrosion with a Critical hit, inflicts Inferno II for 2
//    turns."
//  - R2 (refit-active): "This Unit inflicts Inferno II for 2 turns after applying Corrosion
//    with a Critical hit and extends the newly applied Corrosion by 1 turn ..."
// Verified zero-collision across docs/ship-skills.csv: of the 8 ships whose skill text contains
// "critical hit", Wisteria is the only one pairing "applying ... critical hit" with a
// same-sentence "inflicts ... for N turns" (Asphyxiator uses "applies" + no re-infliction
// clause; Valerian/Crocus use "inflicts/inflicting" for the TRIGGER verb, not "applying"). The
// generic `[^.]*` gap (not `[\w\s]+?`) so this works against BOTH the raw tagged text
// (phrasePosTrigger's sentence scan) and the stripped text (parseSelfCritDot/
// parseSelfCritDotEffect below).
const SELF_CRIT_DOT_RE = /\bafter\s+applying\b[^.]*\bwith\s+a\s+critical\s+hit\b/i;

/** Whether a skill triggers "after applying a DoT with a Critical hit" (self-scoped, manual). */
export function parseSelfCritDot(text: string | null | undefined): boolean {
    if (!text) return false;
    const plain = stripUnitTags(text);
    return !/\ball(?:y|ies)\b/i.test(plain) && SELF_CRIT_DOT_RE.test(plain);
}

/**
 * Returns 'on-self-crit-dot' when `anchorPos` (the ability's raw-text anchor position) falls
 * inside the sentence carrying the "after applying <DoT> with a Critical hit" phrase (self-
 * scoped — THIS unit's own crit-cast DoT infliction, not an ally's); otherwise undefined.
 * Position-scoped on the RAW text (mirrors detectAllyCritDotTrigger). This is the self-subject
 * sibling of on-ally-crit-dot — see buildShipAbilities' dot-effects branch for the consuming
 * side (Wisteria). Reference data: docs/ship-skills.csv.
 */
export function detectSelfCritDotTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    if (!text || /\ball(?:y|ies)\b/i.test(stripUnitTags(text))) return undefined;
    return phrasePosTrigger(text, SELF_CRIT_DOT_RE, anchorPos, 'on-self-crit-dot');
}

// Extracts the buffName + duration of the DoT actually INJECTED by the self-crit-dot trigger
// (e.g. "Inferno II" / 2), in EITHER clause ordering. Deliberately NOT a generic
// parseSkillEffects tag walk: the trigger clause itself names a DoT ("applying Corrosion with
// a Critical hit"), and DOT_TIER_MAP carries a bare 'Corrosion' entry — a naive per-tag loop
// (like the on-ally-crit-dot block above) would mint a phantom Corrosion dot from the TRIGGER'S
// OWN named DoT, which carries no "for N turns" of its own (buildShipAbilities.test.ts's "no
// phantom Corrosion dot" guard covers exactly this). Anchoring on the "inflicts X for N turns"
// clause specifically — in either ordering relative to the trigger clause — means only the
// genuinely injected DoT is ever extracted. Operates on the STRIPPED text only (buffName must
// come out clean for the DOT_TIER_MAP lookup).
const SELF_CRIT_DOT_EFFECT_ORDER_A_RE =
    /\binflicts\s+([\w\s]+?)\s+for\s+(\d+)\s+turns?\s+after\s+applying\s+[\w\s]+?\s+with\s+a\s+critical\s+hit/i;
const SELF_CRIT_DOT_EFFECT_ORDER_B_RE =
    /after\s+applying\s+[\w\s]+?\s+with\s+a\s+critical\s+hit[^.]*?\binflicts\s+([\w\s]+?)\s+for\s+(\d+)\s+turns?/i;

/**
 * Parses the DoT actually injected by a "after applying <DoT> with a Critical hit" self-crit
 * trigger (Wisteria: Inferno II / 2 turns), or undefined when absent. See the block comment
 * above for why this is a dedicated extraction rather than a parseSkillEffects tag walk.
 */
export function parseSelfCritDotEffect(
    text: string | null | undefined
): { buffName: string; turns: number } | undefined {
    if (!text || !parseSelfCritDot(text)) return undefined;
    const plain = stripUnitTags(text);
    const m =
        SELF_CRIT_DOT_EFFECT_ORDER_A_RE.exec(plain) ?? SELF_CRIT_DOT_EFFECT_ORDER_B_RE.exec(plain);
    if (!m) return undefined;
    return { buffName: m[1].trim(), turns: parseInt(m[2], 10) };
}

/**
 * Returns 'on-bomb-detonated' when `anchorPos` (the ability's raw-text anchor position) falls
 * inside the sentence carrying the VICTIM-scoped bomb-burst phrase (BOMB_DETONATE_RE — "bomb
 * explodes"); otherwise undefined. Position-scoped on the RAW text (mirrors
 * detectAllyCritDotTrigger). This is the damage/heal-builder counterpart to the charge-removal
 * (parseChargeRemoval, Demolisher) on-bomb-detonated reading of the same phrasing. The
 * DETONATOR-scoped "detonates a bomb" phrasing (Lingshe) is deliberately NOT matched here — it
 * rides the separate on-self-bomb-detonated trigger via detectReactiveTrigger (Ship-kit W7), and
 * neither is the Echoing Burst phrasing, which rides detectEchoingBurstDetonatedTrigger below
 * (#345). Reference data: docs/ship-skills.csv.
 */
export function detectBombDetonatedTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, BOMB_DETONATE_RE, anchorPos, 'on-bomb-detonated');
}

/**
 * Returns 'on-own-echoing-burst-detonated' when `anchorPos` falls inside the sentence carrying the
 * APPLIER-scoped Echoing Burst detonation phrase ("When an Echoing Burst explodes on an enemy" —
 * Valkyrie's self + lowest-HP-ally repair); otherwise undefined. Position-scoped on the RAW text,
 * exactly like its Bomb sibling above, so Valkyrie's OTHER passive sentence (the start-of-round
 * Speed Up II grant, a separate <br>-delimited paragraph) never picks the trigger up.
 *
 * #345: this used to be one alternate inside BOMB_DETONATE_RE, which put her repair on the Bomb
 * event — firing it on any Bomb bursting on an enemy and never on her own Echoing Burst, since
 * the accumulator path emitted nothing. Reference data: docs/ship-skills.csv.
 */
export function detectEchoingBurstDetonatedTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(
        text,
        ECHOING_BURST_DETONATE_RE,
        anchorPos,
        'on-own-echoing-burst-detonated'
    );
}

// Pallas's TWO ally-crit reactive phrasings (live triggers; see types/abilities.ts):
//  - "when this unit critically repairs an ally / allies" → on-ally-critically-repaired (the
//    OWNER's own crit-repair fires it; stamped onto heal/shield/cleanse abilities in that
//    sentence — Pallas's "it cleanses 1 debuff from itself").
//  - "when an ally critically hits" → on-ally-crit (an ally's crit fires it; stamped onto
//    charge/buff abilities in that sentence — Pallas's "+1 charge" and "Everliving Regeneration").
// Both are POSITION-SCOPED: the trigger only stamps an ability whose RAW-text anchor position
// (the same `text.search(...)` position abilitiesFromText computes) falls INSIDE the sentence
// carrying the phrase. So an unrelated heal/charge in a DIFFERENT sentence is never mis-triggered,
// even when it shares the anchor keyword. Reference data: docs/ship-skills.csv.
const CRIT_REPAIR_RE = /when this unit critically repairs (?:an ally|allies)/i;
// "when an ally critically hits" (Hermes/Sentinel) and "when that ally crits" (Howler) are the
// same reactive trigger under two phrasings — verified zero-collateral: across all 147 ships in
// docs/ship-skills.csv, "ally crit(ically hits/s)" appears ONLY on these three ships.
const ALLY_CRIT_HIT_RE = /when (?:an|that) ally (?:critically hits|crits)/i;

/**
 * Returns 'on-ally-critically-repaired' when `anchorPos` (the ability's raw-text anchor position)
 * falls inside the sentence carrying the crit-repair phrase; otherwise undefined. Position-scoped
 * on the RAW text (so the position aligns with abilitiesFromText's `text.search(...)` anchors).
 * Reference data: docs/ship-skills.csv.
 */
export function detectCritRepairTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, CRIT_REPAIR_RE, anchorPos, 'on-ally-critically-repaired');
}

/**
 * Returns 'on-ally-crit' when `anchorPos` falls inside the sentence carrying the
 * ally-critically-hits phrase; otherwise undefined. Position-scoped on the RAW text.
 * Reference data: docs/ship-skills.csv.
 */
export function detectAllyCritTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, ALLY_CRIT_HIT_RE, anchorPos, 'on-ally-crit');
}

/**
 * Returns 'on-enemy-buffed' when `anchorPos` falls inside the sentence carrying the "when an
 * enemy gets buffed" phrase; otherwise undefined. Position-scoped on the RAW text (mirrors
 * detectCritRepairTrigger) — used by the CLEANSE builder, which has no buff name to resolve a
 * clause on (unlike the buff-grant path, which reuses ENEMY_BUFFED_RE directly inside
 * detectReactiveTrigger). Reference data: docs/ship-skills.csv (Nuqtu only).
 */
export function detectEnemyBuffedTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, ENEMY_BUFFED_RE, anchorPos, 'on-enemy-buffed');
}

/**
 * Returns 'on-ally-shield-destroyed' when `anchorPos` falls inside the sentence carrying the
 * "when an ally ... has their Shield destroyed" phrase; otherwise undefined. Position-scoped on
 * the RAW text (mirrors detectEnemyBuffedTrigger) — used by the CLEANSE builder (AEGIS's "cleanses
 * all debuffs" half), which has no buff name to resolve a clause on (unlike the buff-grant path,
 * which reuses ALLY_SHIELD_DESTROYED_RE directly inside detectReactiveTrigger for the "grants
 * Defense Up II" half). Reference data: docs/ship-skills.csv (AEGIS only).
 */
export function detectAllyShieldDestroyedTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, ALLY_SHIELD_DESTROYED_RE, anchorPos, 'on-ally-shield-destroyed');
}

// Nuqtu's self-cleanse "(once per round)" cap — the plain self-scoped Ability.oncePerRound flag
// (no per-ally/per-enemy dimension; this is a self-target effect). Position-scoped to the
// cleanse's OWN sentence so an unrelated "once per round" phrase elsewhere in the same passive
// row could never leak onto this cleanse. Reference data: docs/ship-skills.csv — grep-verified
// the parenthesized "(once per round)" phrasing appears ONLY on Nuqtu's two passives.
const CLEANSE_ONCE_PER_ROUND_RE = /\(once per round\)/i;

/**
 * Returns true when `anchorPos` falls inside the sentence carrying the "(once per round)"
 * phrase; otherwise false. Position-scoped on the RAW text (mirrors detectEnemyBuffedTrigger).
 */
export function detectCleanseOncePerRound(
    text: string | null | undefined,
    anchorPos: number
): boolean {
    if (!text) return false;
    const sentence = rawSentenceAround(text, anchorPos);
    return sentence !== undefined && CLEANSE_ONCE_PER_ROUND_RE.test(sentence);
}

// "when an enemy gets/is/becomes debuffed" — a reactive own-infliction trigger (APEX's
// shield-on-debuff). Matches "debuff" specifically so it does NOT collide with the
// "when an enemy gets/is buffed" enemy-buff handling (debuffed ≠ buffed). No lookbehind:
// requiring "debuffed" (not "buffed") is sufficient disambiguation since "buffed" lacks
// the "de" prefix. Fires on this Unit's OWN inflictions (on-debuff-inflicted), not allies'.
const ENEMY_DEBUFFED_RE =
    /\bwhen\b[^.]*?\benem(?:y|ies)\b[^.]*?\b(?:gets?|is|are|becomes?)\s+debuffed\b/i;

/**
 * Returns 'on-debuff-inflicted' when `anchorPos` falls inside the sentence carrying the
 * "when an enemy gets debuffed" phrase; otherwise undefined. Position-scoped on the RAW text
 * (mirrors detectCritRepairTrigger). Reference data: docs/ship-skills.csv (APEX).
 */
export function detectDebuffInflictedTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, ENEMY_DEBUFFED_RE, anchorPos, 'on-debuff-inflicted');
}

// Control-infliction recognition for the control EVENT. A skill that inflicts/grants one of the
// five control statuses (Stasis/Provoke/Concentrate Fire/Disable enemy-side, Taunt self-side)
// produces a `type:'control'` event-only ability so reactions can listen for `control-applied`.
//
// This is recognition of the *application* for the control event — it is SEPARATE from:
//   - `statusEffectCondition` — the read/gate path ("If the target HAS <unit-skill>Provoke…").
//   - `parseSkillEffects` — the named-status *application* path that actually applies the debuff.
// The control ability is purely additive; nothing here suppresses those other paths.
//
// Stasis keeps its ORIGINAL loose regex, PLUS (ship-kit W8 Task 7) an untagged fallback for a
// bare "Stasis for N turn(s)" inflict (Xcellence's active: "Inflicts <Speed Down II> for 2 turns
// and Stasis for 2 turn." — Stasis itself carries no <unit-skill> wrapper, unlike Speed Down II).
// The fallback alternative requires the trailing "for N turn(s)" duration text so it stays
// anchored to a genuine inflict, not any other bare mention of "Stasis" in the same sentence as
// an inflict/applies verb (e.g. Defiant's "gains Shield ... when applying Stasis" has no trailing
// duration and uses "applying", which isn't in the verb set anyway — still excluded). Tagged
// ships are byte-identical: the tagged alternative is tried first and, being present, always wins.
// The three enemy-side effects (Provoke / Concentrate Fire / Disable) anchor on an application verb that is
// either immediately tag-adjacent OR governs a coordinated list ("inflicts <Defense Down II> for
// 2 turns, and <Provoke>" — Kafa): the verb, then zero-or-more "<unit-skill>…</unit-skill> [for N
// turns]" items joined by commas/"and", then the target tag. This still ignores a control word in
// a condition clause ("If the target has <unit-skill>Provoke…") — no application verb precedes it.
// Taunt stays TIGHT (verb-adjacent only): no corpus text grants Taunt via a shared-verb compound
// list, so the list-tolerant form would be unused surface area. It also carries a negative
// lookbehind rejecting an `enemy` subject within a short window before the verb, so Amartya's
// CONDITION clause "When an enemy defender gains <unit-skill>Taunt" (an enemy gaining Taunt, not a
// self-grant) does not emit a phantom self `taunt` ability, while "This Unit gains/grants Taunt"
// and "and grants Taunt" still match.
// "applying" is deliberately omitted: it only appears in the passive reactive clause ("when
// applying Stasis"), matched separately below.
//
// Shared list-prefix between the verb and the target tag (zero-or-more coordinated items).
const CONTROL_LIST_PREFIX =
    '(?:\\s+<unit-skill>[^<]*<\\/unit-skill>(?:\\s+for\\s+\\d+\\s+turns?)?,?\\s+and)*';
const ENEMY_INFLICT_VERB = '\\b(?:inflicts?|appl(?:ies|y)|(?:inflicted|applied) with)\\b';
const STASIS_INFLICT_RE =
    /\b(?:inflicts?|applies)\b[^.]*?(?:<unit-skill>\s*Stasis\b|Stasis\s+for\s+\d+\s*turns?)/i;

const CONTROL_INFLICTS: {
    effect: ControlEffect;
    tag: string;
    side: 'enemy' | 'self';
    re: RegExp;
}[] = [
    { effect: 'stasis', tag: 'Stasis', side: 'enemy', re: STASIS_INFLICT_RE },
    {
        effect: 'provoke',
        tag: 'Provoke',
        side: 'enemy',
        re: new RegExp(
            `${ENEMY_INFLICT_VERB}${CONTROL_LIST_PREFIX}\\s+<unit-skill>\\s*Provoke\\b`,
            'i'
        ),
    },
    {
        effect: 'concentrate-fire',
        tag: 'Concentrate Fire',
        side: 'enemy',
        re: new RegExp(
            `${ENEMY_INFLICT_VERB}${CONTROL_LIST_PREFIX}\\s+<unit-skill>\\s*Concentrate Fire\\b`,
            'i'
        ),
    },
    {
        effect: 'disable',
        tag: 'Disable',
        side: 'enemy',
        re: new RegExp(
            `${ENEMY_INFLICT_VERB}${CONTROL_LIST_PREFIX}\\s+<unit-skill>\\s*Disable\\b`,
            'i'
        ),
    },
    {
        effect: 'taunt',
        tag: 'Taunt',
        side: 'self',
        re: /(?<!\benemy\b[\s\w]{1,20})\b(?:gains?|grants?)\s+<unit-skill>\s*Taunt\b/i,
    },
];

/**
 * Parses ALL control inflictions in `text` → one entry per matched effect. Each entry carries the
 * control effect, its raw tag position (`text.search(<tag>)`, may be -1 — the builder maps -1 →
 * MAX_POS), and the side the status lands on (Taunt is a self-grant; the rest hit the enemy).
 * Recognizes the application for the control EVENT only; see CONTROL_INFLICTS comment above for
 * how this differs from `statusEffectCondition` (read/gate) and `parseSkillEffects` (apply).
 * Reference data: docs/ship-skills.csv.
 */
export function parseControlInflicts(
    text: string | null | undefined
): { effect: ControlEffect; pos: number; side: 'enemy' | 'self' }[] {
    if (!text) return [];
    const out: { effect: ControlEffect; pos: number; side: 'enemy' | 'self' }[] = [];
    for (const c of CONTROL_INFLICTS) {
        // Match the APPLICATION clause (c.re anchors on the application verb) and locate the
        // control tag WITHIN that match — not the first tag anywhere in the row. A status named
        // in an earlier CONDITION clause ("If the target has <unit-skill>Stasis…") would otherwise
        // pull `pos` back to the wrong clause, mis-ordering the emitted control ability (the
        // builder sorts emission order by `pos`).
        const match = c.re.exec(text);
        if (!match) continue;
        // Ship-kit W8 Task 7: the <unit-skill> tag is OPTIONAL here too (mirrors STASIS_INFLICT_RE
        // above) so a bare, untagged inflict (Xcellence's "and Stasis for 2 turn") still locates a
        // real position instead of falling back to MAX_POS. Only c.re matching at all determines
        // whether an untagged mention counts as a genuine inflict (Stasis' fallback alternative
        // requires trailing "for N turns"); this just finds WHERE within that already-confirmed
        // match the name sits. No effect on the other (still tag-only) control effects, since their
        // matched text always contains the tag.
        const tagRe = new RegExp(
            `(?:<unit-skill>\\s*)?${c.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
            'i'
        );
        const tagMatch = tagRe.exec(match[0]);
        out.push({
            effect: c.effect,
            pos: tagMatch ? match.index + tagMatch.index : -1,
            side: c.side,
        });
    }
    return out;
}

// "when applying Stasis" — the reactive trigger for a grant that procs when THIS unit applies
// Stasis (Defiant's "gains Shield equal to 30% of its Max HP when applying Stasis"). Position-
// scoped (mirrors detectDebuffInflictedTrigger); no lookbehind.
const APPLYING_STASIS_RE = /\bwhen\s+applying\s+stasis\b/i;

/**
 * Returns 'on-stasis-applied' when `anchorPos` (the ability's raw-text anchor position) falls
 * inside the sentence carrying the "when applying Stasis" phrase; otherwise undefined.
 * Position-scoped on the RAW text (mirrors detectDebuffInflictedTrigger). Reference data:
 * docs/ship-skills.csv (Defiant passive).
 */
export function detectStasisAppliedTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, APPLYING_STASIS_RE, anchorPos, 'on-stasis-applied');
}

// "when Cheat Death activates" — the reactive trigger for Yazid's follow-on ("Once per battle,
// when Cheat Death activates, this Unit repairs itself for 60% of its Max HP and gains Barrier
// for 1 turn"). Position-scoped (mirrors detectStasisAppliedTrigger); no lookbehind. ONLY the
// literal "when Cheat Death activates" — Tycho's "when HP drops below 40%" Barrier is a
// below-X%-HP reactive (deferred), NOT this trigger.
const CHEAT_DEATH_ACTIVATES_RE = /\bwhen\b[^.;]*\bcheat death\b[^.;]*\bactivates\b/i;

/**
 * Returns 'on-cheat-death-activated' when `anchorPos` (the ability's raw-text anchor position)
 * falls inside the sentence carrying the "when Cheat Death activates" phrase; otherwise
 * undefined. Position-scoped on the RAW text (mirrors detectStasisAppliedTrigger). Reference
 * data: docs/ship-skills.csv (Yazid 3rd passive).
 */
export function detectCheatDeathActivatedTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, CHEAT_DEATH_ACTIVATES_RE, anchorPos, 'on-cheat-death-activated');
}

// "when this Unit is destroyed it repairs X% … to all allies" — Salvation's on-destroyed ally
// heal (Phase 4b, Task 9). Position-scoped (mirrors detectCheatDeathActivatedTrigger); no
// lookbehind. Requires (a) a SELF reference ("this unit" / "it") BEFORE "is destroyed" so it
// routes ONLY a SELF-destruction heal to on-destroyed (a hypothetical "when an ALLY is destroyed,
// repairs all allies" must NOT mis-route to on-destroyed → it stays an on-ally-destroyed/
// disqualified reactive), and (b) the repair-to-all-allies shape so it never stamps the on-kill
// ("when it destroys an enemy") or on-buff-purged reactives in the same kit.
// Shared self-reference: "this unit" / bare "it" appearing BEFORE "is destroyed" (no lookbehind).
const SELF_REF_SRC = '\\b(?:this\\s+unit|it)\\b';
// SELF "is destroyed" tail (assumes a preceding `when`): self-ref then "is destroyed".
const SELF_DESTROYED_TAIL_SRC = `[^.;]*${SELF_REF_SRC}[^.;]*\\bis\\s+destroyed\\b`;
// The full SELF-destruction repair-to-all-allies shape (sans the leading `when`).
const SELF_DESTROYED_ALL_ALLIES_TAIL_SRC = `${SELF_DESTROYED_TAIL_SRC}[^.;]*\\brepairs?\\b[^.;]*\\ball\\s+allies\\b`;
const DESTROYED_ALLY_REPAIR_RE = new RegExp(`\\bwhen\\b${SELF_DESTROYED_ALL_ALLIES_TAIL_SRC}`, 'i');

/**
 * Returns 'on-destroyed' when `anchorPos` (the ability's raw-text anchor position) falls inside
 * the sentence carrying the "when this Unit is destroyed … repairs … to all allies" phrase;
 * otherwise undefined. Position-scoped on the RAW text (mirrors detectCheatDeathActivatedTrigger).
 * Reference data: docs/ship-skills.csv (Salvation 2nd/3rd passive).
 */
export function detectDestroyedTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, DESTROYED_ALLY_REPAIR_RE, anchorPos, 'on-destroyed');
}

// Rikra's per-kill self-heal phrasing: "for each enemy Unit destroyed by the attack upon
// killing them" — the object is "them", not "an enemy"/"an opponent", so it does NOT match
// KILL_TRIGGER_RE's "killing an (enemy|opponent)" alternate. Verified unique to Rikra in
// docs/ship-skills.csv (grep "killing them"). Kept as a separate, narrowly-scoped alternate
// rather than broadening the shared KILL_TRIGGER_RE (which also feeds buff-grant/removal
// trigger resolution elsewhere).
const ENEMY_DESTROYED_BY_ATTACK_RE = /\bdestroyed\b[^.;]*\bkilling\s+them\b/i;

/**
 * Returns 'on-enemy-destroyed' when `anchorPos` (the ability's raw-text anchor position)
 * falls inside the sentence carrying an enemy-kill phrasing (KILL_TRIGGER_RE's "on kill" /
 * "killing an enemy/opponent" / "when an enemy dies", OR Rikra's "destroyed … killing them"
 * shape); otherwise undefined. Position-scoped on the RAW text (mirrors detectDestroyedTrigger)
 * so an unrelated heal in another sentence isn't co-triggered. This is the SELF-heal-on-
 * ENEMY-death counterpart to detectDestroyedTrigger (self-heal on SELF-death). Reference data:
 * docs/ship-skills.csv (Madax, Rikra).
 */
export function detectEnemyDestroyedTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return (
        phrasePosTrigger(text, KILL_TRIGGER_RE, anchorPos, 'on-enemy-destroyed') ??
        phrasePosTrigger(text, ENEMY_DESTROYED_BY_ATTACK_RE, anchorPos, 'on-enemy-destroyed')
    );
}

/**
 * Returns 'on-enemy-cleansed' when `anchorPos` (the ability's raw-text anchor position) falls
 * inside the sentence carrying the "when an enemy cleanses a Debuff" phrase; otherwise undefined.
 * Position-scoped on the RAW text (mirrors detectDestroyedTrigger), reusing the SAME masked
 * rawSentenceAround so a leading non-reaction sentence (Grif's standing "increases its Defense by
 * 20%.") does NOT co-trigger the cleanse proc that follows it.
 *
 * This is the SENTENCE-SCOPED counterpart to detectReactiveTrigger's buff-name-scoped cleanse
 * branch: it serves the NAMELESS damage proc (Grif's "deals 75% Damage that cannot critically
 * hit") which has no buffName to resolve a clause on. ENEMY_CLEANSE_RE is shared with that branch
 * so the two paths recognize the same phrasing. Reference data: docs/ship-skills.csv (Grif).
 */
export function detectEnemyCleanseTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, ENEMY_CLEANSE_RE, anchorPos, 'on-enemy-cleansed');
}

// "When this Unit purges (a buff / an enemy buff) … [from] an enemy" — Sefuba p1 + p2.
// Loose [^.;]* gaps cross <unit-aid>/<unit-damage> tags. Verified against RAW CSV strings.
const ENEMY_PURGED_RE = /\bwhen\s+this\s+unit\b[^.;]*\bpurges?\b[^.;]*\benem/i;

/**
 * Returns 'on-enemy-purged' when `anchorPos` falls inside the sentence carrying the
 * "when this Unit purges … enemy" phrase (Sefuba p1 / p2); otherwise undefined.
 * Position-scoped on the RAW text (mirrors detectEnemyCleanseTrigger).
 * Reference data: docs/ship-skills.csv (Sefuba).
 */
export function detectEnemyPurgedTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, ENEMY_PURGED_RE, anchorPos, 'on-enemy-purged');
}

// "When a buff is purged from an ally" — Salvation p3.
// Loose [^.;]* gaps cross <unit-aid> tags around "buff" and "purged". Verified against RAW CSV.
const ALLY_PURGED_RE =
    /\bwhen\b[^.;]*\bbuff\b[^.;]*\bis\b[^.;]*\bpurged\b[^.;]*\bfrom\s+an?\s+ally/i;

// "purges N more buff" — Sefuba p2 chain-purge count extractor.
// Capture group 1 = digit string or 'a'/'an' (→ count 1). Crosses <unit-aid> tags.
// Verified: matches 'purges 1</unit-aid> more buff' with group 1 = '1'; no match on p1.
export const PURGE_MORE_RE = /\bpurges?\s+(\d+|an?)\s*(?:<\/?[^>]*>)?\s*more\b/i;

/**
 * Returns 'on-ally-purged' when `anchorPos` falls inside the sentence carrying the
 * "when a buff is purged from an ally" phrase (Salvation p3); otherwise undefined.
 * Position-scoped on the RAW text (mirrors detectDestroyedTrigger).
 * Reference data: docs/ship-skills.csv (Salvation).
 */
export function detectAllyPurgedTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, ALLY_PURGED_RE, anchorPos, 'on-ally-purged');
}

// "When a debuff is inflicted on an ally" — Hayyan p2's second sentence (victim-scoped repair).
// Corpus-verified: grep docs/ship-skills.csv for "debuff is inflicted on an ally" = Hayyan only.
const ALLY_DEBUFFED_RE = /\bdebuff\s+is\s+inflicted\s+on\s+an\s+ally\b/i;

/**
 * Returns 'on-ally-debuffed' when `anchorPos` falls inside the sentence carrying the
 * "when a debuff is inflicted on an ally" phrase (Hayyan p2); otherwise undefined.
 * Position-scoped on the RAW text (mirrors detectAllyPurgedTrigger) so Hayyan's SIBLING
 * "when cleansing a debuff from an ally" repair (a different sentence, PR-H) is untouched.
 * Reference data: docs/ship-skills.csv (Hayyan).
 */
export function detectAllyDebuffedTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, ALLY_DEBUFFED_RE, anchorPos, 'on-ally-debuffed');
}

// "at the end of the round, … purges …" — Rhodium end-of-round purge. Position-scoped.
// Verified against RAW CSV: 'At the end of the round, this Unit <unit-aid>purges 2</unit-aid> buffs …'
const END_OF_ROUND_RE = /\bat\s+the\s+end\s+of\s+the\s+round\b/i;

/**
 * Returns 'end-of-round' when `anchorPos` falls inside the sentence carrying the
 * "at the end of the round" phrase (Rhodium p1 / p2); otherwise undefined.
 * Position-scoped on the RAW text (mirrors detectEnemyPurgedTrigger).
 * Reference data: docs/ship-skills.csv (Rhodium).
 */
export function detectEndOfRoundPurgeTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, END_OF_ROUND_RE, anchorPos, 'end-of-round');
}

/**
 * Epic PR4 (round-boundary trigger consistency): returns 'start-of-round' when `anchorPos`
 * falls inside the sentence carrying the "at the start of (the|each|every) round" phrase;
 * otherwise undefined. Position-scoped on the RAW text (mirrors detectEndOfRoundPurgeTrigger).
 * Fixes Judge's passive AoE execute damage ("At the start of the round, this Unit deals 60%
 * damage to all enemies with less than 50% HP") and Chimei's passive heal ("At the start of the
 * round, all allies with Stealth repairs 10% of this unit's max HP"), both of which parsed
 * on-cast despite the identical phrase already resolving to start-of-round for buff grants
 * (Valkyrie's Speed Up II, Chakara's Attack/Defense Up II) via detectReactiveTrigger. Reference
 * data: docs/ship-skills.csv.
 */
export function detectStartOfRoundTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, START_OF_ROUND_RE, anchorPos, 'start-of-round');
}

/**
 * SP-G G1a: returns 'start-of-turn' when `anchorPos` (a shield/heal ability's raw-text anchor)
 * falls in a sentence carrying "every turn"/"each turn". Position-scoped (mirrors
 * phrasePosTrigger's sentence-scoping) so an unrelated heal/shield in another sentence is never
 * co-triggered. Reference data: docs/ship-skills.csv (Kinetik shield, Cinya heal).
 */
export function detectEveryTurnTrigger(
    text: string,
    anchorPos: number
): 'start-of-turn' | undefined {
    // phrasePosTrigger's return type is the broader AbilityTrigger (it's shared by every
    // detectX helper); passed the literal 'start-of-turn' trigger, it can only ever come back
    // as that literal or undefined, so the narrowing cast here is safe.
    return phrasePosTrigger(text, EVERY_TURN_RE, anchorPos, 'start-of-turn') as
        'start-of-turn' | undefined;
}

/**
 * Epic PR4: returns 'end-of-round' when `anchorPos` falls inside the sentence carrying the
 * "at the end of the round" phrase; otherwise undefined. Position-scoped on the RAW text
 * (shares END_OF_ROUND_RE with detectEndOfRoundPurgeTrigger — same phrase, DAMAGE-ability call
 * site instead of purge). Fixes Incinerator's recurring AoE damage to Inferno-afflicted enemies
 * and Rhodium p2's co-located 80%-no-crit damage (same sentence as Rhodium's ALREADY-correct
 * end-of-round purge), both of which parsed on-cast. Reference data: docs/ship-skills.csv.
 */
export function detectEndOfRoundDamageTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, END_OF_ROUND_RE, anchorPos, 'end-of-round');
}

// Epic PR4: a round-start CONTINUATION sentence with no round-start phrase of its own, whose
// governing trigger lives in the IMMEDIATELY PRECEDING sentence. Two corpus shapes:
//   - "Then, deals N% damage …" directly after a "starts each round with <buff> if …" sentence
//     (Chakara's R2 passive: the buff grant is already correctly start-of-round via
//     STARTS_ROUND_WITH_RE/findVerb; the trailing damage sentence was not). Lodolite's charged
//     "Then, the enemy with the most Buffs is Purged" is the ONLY other "Then," in the corpus —
//     its preceding sentence is a plain on-cast damage clause, so it correctly falls through.
//   - "… also gains <Buff>" directly after an "At the start of the round, this Unit gains
//     <Buff>." sentence (Isha p1/p2 "If Nayra is on the same team, it also gains Defensive
//     Affinity Override"; Nayra p2 "If Isha is on the same team, this Unit also gains Offensive
//     Affinity Override"). Nayra p1 and Isha's OWN grant already resolve via detectReactiveTrigger
//     because they share ONE sentence with the round-start phrase; only the split-sentence p2
//     form needs this fallback. Corpus-verified unique (no other "also gains" sentence in
//     docs/ship-skills.csv follows a round-start sentence).
const THEN_CONTINUATION_RE = /^\s*then,/i;
const ALSO_GAINS_CONTINUATION_RE = /\balso\s+gains?\b/i;

export function detectRoundStartContinuationTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    if (!text || anchorPos < 0) return undefined;
    const masked = maskAbbrev(text);
    // BOUNDARY NOTE (#210 review): each <br> is its own boundary, so a DOUBLE break
    // ("<br /><br />", the corpus's paragraph separator) produces an intervening EMPTY
    // segment between the two tags. The look-one-segment-back walk below then lands on
    // that empty segment (no round-start phrase) and returns undefined — i.e. a
    // continuation NEVER crosses a paragraph separator. That fail-safe is intentional:
    // the single-boundary crossing (Isha/Nayra p2 "also gains") is the only supported shape.
    const boundary = /[.;](?=\s|$)|<br\s*\/?>/gi;
    const segments: { start: number; end: number }[] = [];
    let start = 0;
    let m: RegExpExecArray | null;
    boundary.lastIndex = 0;
    while ((m = boundary.exec(masked)) !== null) {
        const end = m.index + m[0].length;
        segments.push({ start, end });
        start = end;
    }
    segments.push({ start, end: masked.length });
    let idx = -1;
    for (let i = 0; i < segments.length; i++) {
        if (anchorPos >= segments[i].start && anchorPos < segments[i].end) {
            idx = i;
            break;
        }
    }
    // No containing segment, or it's the FIRST segment (no preceding sentence to inherit from).
    if (idx <= 0) return undefined;
    const current = masked.slice(segments[idx].start, segments[idx].end);
    if (!THEN_CONTINUATION_RE.test(current) && !ALSO_GAINS_CONTINUATION_RE.test(current)) {
        return undefined;
    }
    const prev = masked.slice(segments[idx - 1].start, segments[idx - 1].end);
    return START_OF_ROUND_RE.test(prev) || STARTS_ROUND_WITH_RE.test(prev)
        ? 'start-of-round'
        : undefined;
}

// "… when killed by direct Damage" — Faust on-destroyed purge (killer-targeted, direct-only).
// Crosses tags; "direct" guards against a future DoT-kill phrasing. Widened (PR-B1) to also
// match "upon being killed by direct Damage" (Paracelsus's retaliation + ally-buff clause) —
// the alternation only ADDS a case, so Faust's "when killed by direct Damage" still matches.
const KILLED_BY_DIRECT_RE = /\b(?:when|upon\s+being)\s+killed\s+by\s+direct\b[^.;]*\bdamage\b/i;

/**
 * Returns 'on-destroyed' when `anchorPos` falls inside the sentence carrying the
 * "when killed by direct Damage" phrase (Faust p1 / p2); otherwise undefined.
 * Position-scoped on the RAW text (mirrors detectEndOfRoundPurgeTrigger).
 * Reference data: docs/ship-skills.csv (Faust).
 */
export function detectKilledByDirectDamageTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, KILLED_BY_DIRECT_RE, anchorPos, 'on-destroyed');
}

// Ship-kit W8 Task 12: "… purges 1 buff from the enemy when dealing damage to a Defender"
// (Zeolite passive). Verified against RAW CSV: 'This Unit purges 1 buff from the enemy when
// dealing damage to a Defender.' Position-scoped (mirrors detectKilledByDirectDamageTrigger).
const DEAL_DAMAGE_TO_ROLE_RE =
    /\bwhen\s+dealing\s+damage\s+to\s+(?:an?\s+)?(?:defender|attacker|debuffer|supporter)s?\b/i;

/**
 * Returns 'on-deal-damage' when `anchorPos` falls inside the sentence carrying the "when
 * dealing damage to a <Role>" phrase (Zeolite's passive purge reactive); otherwise undefined.
 * Reuses the SAME 'on-deal-damage' trigger Burner's on-deal-damage Inferno rider already
 * drives (triggers.ts) — the owner's own damage-dealing turn, victim-routed via eventCtx.victimId.
 */
export function detectDealDamageToRoleTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, DEAL_DAMAGE_TO_ROLE_RE, anchorPos, 'on-deal-damage');
}

// "to/against/targeting/damaging/attacking/hitting a <Role>" — the SAME enemy-class extraction
// buildShipAbilities.ts's outgoing-damage-modifier branch already uses for Zeolite's "+30%
// damage when hitting a Defender" gate (Wave 4). Reused here so both halves of Zeolite's
// passive ("+30%… Defender" / "purges… Defender") read the role from one shared pattern.
const ENEMY_ROLE_CLAUSE_RE =
    /\b(?:to|against|targeting|damaging|attacking|hitting)\s+(?:an?\s+)?(defender|attacker|debuffer|supporter)s?\b/i;

/**
 * Extracts the `enemy-type` Condition from the sentence containing `anchorPos` (Zeolite's
 * on-deal-damage purge, Task 12) — e.g. "when dealing damage to a Defender" → requiredEnemyType
 * 'Defender'. Sentence-scoped on RAW text (mirrors detectRepairedThisRoundCondition). Undefined
 * when no role phrase is present in that sentence.
 */
export function detectPurgeEnemyTypeCondition(
    text: string | null | undefined,
    anchorPos: number
): Condition | undefined {
    if (!text) return undefined;
    const sentence = rawSentenceAround(text, anchorPos);
    if (sentence === undefined) return undefined;
    const m = ENEMY_ROLE_CLAUSE_RE.exec(sentence);
    return m
        ? { subject: 'enemy-type', derivable: true, requiredEnemyType: capType(m[1]) }
        : undefined;
}

// "repaired this round" — Nayra's charged purge + its Stasis/Exposed inflicts. The
// gate word ("if"/"when") is already verified by detectGrantConditions' conditional
// guard / by rawSentenceAround's sentence scoping, so the phrase alone is enough.
// Corpus-unique to Nayra (verified: 1 row). No <unit-…> tags intervene in the phrase.
const REPAIRED_THIS_ROUND_RE = /\brepaired\s+this\s+round\b/i;

// "the enemy with the most buffs" — Rhodium most-buffs target axis. Crosses <unit-aid> tags.
// Verified against RAW CSV: '… buffs from the enemy with the most buffs.'
const MOST_BUFFS_RE = /\benemy\b[^.;]*\bwith\s+the\s+most\b[^.;]*\bbuffs?\b/i;

/**
 * Returns a target-repaired-this-round Condition when `anchorPos` falls inside the
 * sentence carrying "repaired this round" (Nayra's charged purge); else undefined.
 * Position-scoped on RAW text (mirrors detectMostBuffsTarget). The purge ability has
 * no buffName, so detectGrantConditions cannot drive it — this is its condition source.
 */
export function detectRepairedThisRoundCondition(
    text: string | null | undefined,
    anchorPos: number
): Condition | undefined {
    if (!text) return undefined;
    const sentence = rawSentenceAround(text, anchorPos);
    return sentence !== undefined && REPAIRED_THIS_ROUND_RE.test(sentence)
        ? { subject: 'target-repaired-this-round', derivable: true }
        : undefined;
}

/**
 * Returns true when `anchorPos` falls inside the sentence carrying the
 * "enemy with the most buffs" phrase (Rhodium p1 / p2); otherwise false.
 * Position-scoped on the RAW text (mirrors phrasePosTrigger's sentence-scoping).
 * Reference data: docs/ship-skills.csv (Rhodium).
 */
export function detectMostBuffsTarget(text: string | null | undefined, anchorPos: number): boolean {
    if (!text) return false;
    const sentence = rawSentenceAround(text, anchorPos);
    return sentence !== undefined && MOST_BUFFS_RE.test(sentence);
}

// "to the highest Speed Enemy" — Chakara's enemy-highest-speed target axis (SP-M M1 Task 6).
// Crosses <unit-damage> tags. Verified against RAW CSV: '…deals 60% damage to the highest Speed
// Enemy.'
const HIGHEST_SPEED_ENEMY_RE = /\bhighest\s+speed\s+enemy\b/i;

/**
 * Returns true when `anchorPos` falls inside the sentence carrying the "highest Speed Enemy"
 * phrase (Chakara p4's round-start-continuation damage clause); otherwise false.
 * Position-scoped on the RAW text (mirrors detectMostBuffsTarget's sentence-scoping).
 * Reference data: docs/ship-skills.csv (Chakara).
 */
export function parseHighestSpeedEnemyTarget(
    text: string | null | undefined,
    anchorPos: number
): boolean {
    if (!text) return false;
    const sentence = rawSentenceAround(text, anchorPos);
    return sentence !== undefined && HIGHEST_SPEED_ENEMY_RE.test(sentence);
}

// "the highest attack enemy" — Selenite's enemy-highest-attack target axis (Ship-kit W8 Task 5).
// Narrowly matched (hyphen-or-space between "highest" and "attack") so it doesn't retarget other
// ships' plain enemy debuffs that merely co-occur with "Attack" text elsewhere in the sentence.
// Verified against RAW CSV: '…the highest attack enemy is applied with Concentrate Fire for 1
// turn.'
const HIGHEST_ATTACK_ENEMY_RE = /\bhighest[- ]attack\s+enemy\b/i;

/**
 * Returns true when `anchorPos` falls inside the sentence carrying the "highest attack enemy"
 * phrase (Selenite p3's start-of-round Concentrate Fire debuff); otherwise false.
 * Position-scoped on the RAW text (mirrors parseHighestSpeedEnemyTarget's sentence-scoping).
 * Reference data: docs/ship-skills.csv (Selenite).
 */
export function parseHighestAttackEnemyTarget(
    text: string | null | undefined,
    anchorPos: number
): boolean {
    if (!text) return false;
    const sentence = rawSentenceAround(text, anchorPos);
    return sentence !== undefined && HIGHEST_ATTACK_ENEMY_RE.test(sentence);
}

// Shared: find the sentence (on RAW text, boundary = '.'/';' followed by whitespace/end — decimals
// and abbreviation periods are NOT split, mirroring sentenceBoundsAround) carrying `phrase`; if
// `anchorPos` falls within that sentence's [start,end) bounds, return `trigger`, else undefined.
// Raw text is used so the bounds align with abilitiesFromText's raw-text anchor positions; the
// phrase regexes don't span <unit-…> tags so matching on raw text is safe.
function phrasePosTrigger(
    text: string | null | undefined,
    phrase: RegExp,
    anchorPos: number,
    trigger: AbilityTrigger
): AbilityTrigger | undefined {
    if (!text) return undefined;
    const phraseRe = new RegExp(phrase.source, phrase.flags.replace('g', ''));
    // A negative anchorPos (ability has no position in text) is handled by rawSentenceAround,
    // which returns undefined for any out-of-range position, cleanly suppressing the trigger.
    const sentence = rawSentenceAround(text, anchorPos);
    return sentence !== undefined && phraseRe.test(sentence) ? trigger : undefined;
}

// The RAW-text sentence containing `anchorPos` (masked — see below), or undefined when the
// position is invalid. Shared by phrasePosTrigger and detectDamageReactionTrigger so the
// masking + boundary rules live in ONE place.
//
// Masking: "Inc."/"Out." abbreviation periods are masked (same sentinel as resolveBuffClause/
// parseExtraAction) before the boundary scan so a buff name like "Inc. Damage Up" does not
// split the sentence mid-name. The placeholder is the same byte length as the replaced space,
// so anchorPos (which points into the raw unmasked text) stays stable and needs no adjustment.
//
// Sentence boundaries: a terminal '.'/';' followed by whitespace/end, OR a <br>/<br /> tag.
// <br> tags separate paragraphs in skill texts, so a trigger phrase and an anchor in different
// <br>-separated paragraphs must NOT be co-scoped. Boundaries are MATCH POSITIONS in the same
// raw (masked) string — no replacement — so anchorPos stays valid. Variable-length matches
// (<br /> vs '.') use m[0].length for the boundary end. Lookbehind-free.
function rawSentenceAround(text: string, anchorPos: number): string | undefined {
    if (anchorPos < 0) return undefined;
    const masked = maskAbbrev(text);
    const boundary = /[.;](?=\s|$)|<br\s*\/?>/gi;
    let start = 0;
    let m: RegExpExecArray | null;
    while ((m = boundary.exec(masked)) !== null) {
        const end = m.index + m[0].length;
        if (anchorPos < end) {
            return anchorPos >= start ? masked.slice(start, end) : undefined;
        }
        start = end;
    }
    // Anchor is in the final (unterminated) sentence.
    return anchorPos >= start ? masked.slice(start) : undefined;
}

// detectDamageReactionTrigger rules (Phase 4c PR 1 Task 8 + PR 2 Task 7). Ally-subject
// detector covers BOTH "when an ally …" and "when another ally …" (Provider) — a matching
// sentence classifies as on-ally-attacked when it also carries a damage-reaction shape
// with the ally as the PASSIVE-voice subject — "is critically hit" / "is directly damaged"
// (Guardian's Provoke counter, Refine, Graphite). ACTIVE-voice ally sentences where the
// ally DEALS the hit (Crocus "When another ally inflicts a DoT effect with a critical
// hit", Provider's inflicts-a-debuff reaction) return undefined — those are outgoing
// reactions, not the ally being damaged.
const DR_ALLY_SUBJECT_RE = /when\s+an(?:other)?\s+ally\b/i;
// Role words inside an ally-subject phrase ("when an ally attacker or debuffer is
// directly damaged" — Graphite) → ShipRoleCategory filter, CATEGORY semantics
// ('debuffer' covers every DEBUFFER_* variant; matching happens in the engine).
// LIMITATION: only "or"-joined lists parse; a comma list ("an ally attacker,
// defender or supporter") would capture only the first role and silently
// UNDER-fire — widen the repetition group if such a CSV variant ever lands.
const DR_ALLY_ROLES_RE =
    /when\s+an(?:other)?\s+ally\s+((?:attacker|defender|debuffer|supporter)s?(?:\s+or\s+(?:attacker|defender|debuffer|supporter)s?)*)\b/i;
// #363 (Fuying R3/R4): a NAMED-STATUS precondition on the damaged ally — "When an ally IN
// <unit-skill>Stealth</unit-skill> … is directly damaged". Matched against the TAGGED sentence so
// the `<unit-skill>` boundary delimits the status name exactly, rather than guessing where a bare
// capitalised phrase ends (the same reasoning as `maskStatusNameRepairs` in #362 and
// EXTEND_NAMED_STATUS_RE above: the tag is information, and stripping it throws that away).
// "with" is accepted alongside "in" because the corpus uses both prepositions for the same
// standing-status idea ("allies with Stealth" in Fuying's own DR-aura sentence); no corpus
// ally-reaction sentence uses "with" today, so this arm is purely defensive.
const DR_ALLY_STATUS_RE =
    /when\s+an(?:other)?\s+ally\s+(?:in|with)\s+<unit-skill>([^<]+)<\/unit-skill>/i;
const ROLE_WORD_TO_CATEGORY: Record<string, ShipRoleCategory> = {
    attacker: 'ATTACKER',
    defender: 'DEFENDER',
    debuffer: 'DEBUFFER',
    supporter: 'SUPPORTER',
};
// Crit-suppression riders ("damage that cannot critically hit", incl. the live CSV typo
// "cannont") are NOT crit reactions — scrubbed before the crit-hit test so a when-sentence
// carrying such a rider (Provider, Grif) never reads as crit-gated.
const DR_CANNOT_CRIT_RE = /\bcann?on?t\s+criticall?y?\s+hit\b/i;
// Passive-voice "when … critically hit" (Guardian "When this Unit is critically hit"; the
// missing "y" in the live CSV's "criticall hit" is tolerated). DISTINCT from the ACTIVE-voice
// self-crit phrasing ("critically hits/damaging"), which matchesActiveSelfCrit handles and
// which "hit\b" deliberately does not match (no trailing "s").
const DR_CRIT_HIT_RE = /when\b[^.;]*\bcriticall?y?\s+hit\b/i;
// ALLY-subject crit reactions require the damaged ally as subject — "is critically hit"
// (Guardian "When an ally is critically hit by an enemy"; same "criticall hit" typo
// tolerance as DR_CRIT_HIT_RE). The bare DR_CRIT_HIT_RE also matches the ACTIVE-voice
// "…inflicts a DoT effect WITH a critical hit" (Crocus), where the ally LANDS the crit
// (outgoing — on-ally-crit-dot territory) rather than receiving it, so the ally branch
// must not reuse it.
const DR_ALLY_CRIT_HIT_RE = /\bis\s+criticall?y?\s+hit\b/i;
// Self-subject direct-damage reaction: "when (this Unit is) directly damaged" (leading OR
// trailing clause) / "when attacked" / bare "when hit" (Sansi) / "upon receiving direct
// damage" (Bizon — the one non-"when" phrasing; corpus-unique so no over-match).
//
// The "IF directly damaged" arm (Panon R1/R2, Wusheng R1/R2) used to be deliberately EXCLUDED as
// "out of scope for this reaction phase". That carve-out went stale: it left Panon's Barrier
// grant on the generic `on-cast` default, so it armed on PANON'S OWN TURN — every third turn,
// whether or not anything had touched him — instead of reactively at the moment he is hit. The
// game text draws no distinction between the two phrasings, and the sibling removal detector
// (REMOVAL_DIRECT_DAMAGE_RE, ~:1753) already accepts both for exactly that reason.
//
// The optional group admits ONLY "this unit is" between "if" and "directly", which is what keeps
// Meatshield's "If this Unit HAS BEEN directly damaged" out: that is a CAST-TIME condition on an
// active skill (the `wasHitThisRound` subject), not a reaction that fires on being hit, and
// promoting it to `on-attacked` would move the clause to the wrong path entirely. Corpus census
// (docs/ship-skills.csv, 2026-08-30): those 5 sites are every `if …directly damaged` in the file.
const DR_DIRECT_DAMAGE_RE =
    /when\s+(?:this\s+unit\s+is\s+)?directly\s+damaged\b|if\s+(?:this\s+unit\s+is\s+)?directly\s+damaged\b|when\s+attacked\b|when\s+hit\b|upon\s+receiving\s+direct\s+damage\b/i;
// "while below N% HP" HP gate on a damage-reaction sentence (Makoli: "when directly damaged
// while below 40% HP, …"). The same regex form as Task 7's parseHealAbilities annotation
// (/while\s+below\s+(\d+)\s*%\s*hp/i) — kept here in the detector so ALL sentence-scoped
// extraction lives in skillTextParser. Extracted AFTER the damage-reaction shape is confirmed
// so an unrelated "while below X% HP" in a non-reaction sentence is never picked up.
const DR_HP_BELOW_RE = /while\s+below\s+(\d+)\s*%\s*hp/i;

/**
 * Damage-reaction trigger for non-heal clauses (Phase 4c PR 1 + PR 2 Task 7). Matches the
 * sentence around `pos` (RAW-text position, same masked bounds as phrasePosTrigger).
 * Passive-voice "is critically hit" is the CRIT-FILTERED variant — distinct from the
 * ACTIVE-voice self-crit condition, which detectGrantConditions still rejects in passive
 * voice. NO lookbehind (iOS Safari 15).
 *
 * Subject decides the trigger: a self-subject reaction sentence → on-attacked; an
 * ALLY-subject one ("when an(other) ally … is critically hit / directly damaged") →
 * on-ally-attacked (Guardian's Provoke counter, Refine's Inc. Damage Down grant). The
 * ally branch's crit test demands PASSIVE voice (DR_ALLY_CRIT_HIT_RE, "IS critically
 * hit") because the bare DR_CRIT_HIT_RE also matches active-voice "…inflicts a DoT
 * effect WITH a critical hit" (Crocus) — an ally-OUTGOING crit handled by
 * on-ally-crit-dot, which must stay undefined here. Role
 * nouns right after "ally" (Graphite "when an ally attacker or debuffer is directly
 * damaged") become `roleFilter`, CATEGORY-semantic ShipRoleCategory values the engine's
 * listener matches against the damaged ally's role. The ally branch needs its own
 * direct-damage acceptance because DR_DIRECT_DAMAGE_RE only spans "when (this Unit is)
 * directly damaged" — the ally/role words between "when" and "directly" fall outside it.
 *
 * `hpBelowPct` is set when a SELF-subject reaction sentence also carries a "while below
 * N% HP" self HP gate (Makoli's Disable) — the caller attaches a derivable hp-threshold
 * condition so the executor evaluates the gate at drain time rather than firing on every
 * received attack. Ally-subject sentences never get it: DR_HP_BELOW_RE reads the OWNER's
 * HP, and no corpus ally-reaction carries an HP gate.
 *
 * `allyStatusName` (#363, Fuying R3/R4) is set when an ALLY-subject sentence names a standing
 * status the damaged ally must hold — "When an ally in <unit-skill>Stealth</unit-skill> … is
 * directly damaged". It is the canonical `BUFFS` name, resolved through `resolveBuffName` so an
 * unrecognised phrase yields NO gate (leaving the pre-#363 un-gated behaviour) rather than a gate
 * that can never match. Ally-subject only: a self-subject "while in Stealth" gate is
 * `detectGrantConditions`' job and already has its own channel.
 *
 * Reference data: docs/ship-skills.csv (Warden, Guardian, Shepherd, Opal, Flamel, Iridium,
 * Panguan, Stalwart, Makoli; ally-subject: Guardian, Refine, Graphite, Fuying).
 */
export function detectDamageReactionTrigger(
    text: string,
    pos: number
):
    | {
          trigger: 'on-attacked' | 'on-ally-attacked';
          critFilter?: 'crit';
          hpBelowPct?: number;
          roleFilter?: ShipRoleCategory[];
          allyStatusName?: string;
      }
    | undefined {
    const sentence = rawSentenceAround(text, pos);
    if (sentence === undefined) return undefined;
    const allySubject = DR_ALLY_SUBJECT_RE.test(sentence);
    const scrubbed = sentence.replace(DR_CANNOT_CRIT_RE, '');
    const roleM = allySubject ? DR_ALLY_ROLES_RE.exec(sentence) : null;
    const roleFilter = roleM
        ? roleM[1]
              .toLowerCase()
              .split(/\s+or\s+/)
              .map((w) => ROLE_WORD_TO_CATEGORY[w.replace(/s$/, '')])
        : undefined;
    // Read from the TAGGED sentence (tags are still present — rawSentenceAround only masks
    // abbreviation periods), so the `<unit-skill>` boundary delimits the name exactly.
    const statusM = allySubject ? DR_ALLY_STATUS_RE.exec(sentence) : null;
    const allyStatusName = statusM ? resolveBuffName(statusM[1]) : undefined;
    const trigger = allySubject ? ('on-ally-attacked' as const) : ('on-attacked' as const);
    if (allySubject ? DR_ALLY_CRIT_HIT_RE.test(scrubbed) : DR_CRIT_HIT_RE.test(scrubbed)) {
        const hpM = allySubject ? null : DR_HP_BELOW_RE.exec(scrubbed);
        return {
            trigger,
            critFilter: 'crit',
            ...(hpM ? { hpBelowPct: parseInt(hpM[1], 10) } : {}),
            ...(roleFilter ? { roleFilter } : {}),
            ...(allyStatusName ? { allyStatusName } : {}),
        };
    }
    if (
        DR_DIRECT_DAMAGE_RE.test(scrubbed) ||
        (allySubject && /\bdirectly\s+damaged\b/i.test(scrubbed))
    ) {
        const hpM = allySubject ? null : DR_HP_BELOW_RE.exec(scrubbed);
        return {
            trigger,
            ...(hpM ? { hpBelowPct: parseInt(hpM[1], 10) } : {}),
            ...(roleFilter ? { roleFilter } : {}),
            ...(allyStatusName ? { allyStatusName } : {}),
        };
    }
    return undefined;
}

// SP-E: Voron/Orel "transforms the [incoming direct] damage into a Damage over Time effect
// lasting for N turns". Deliberately requires the literal "the damage into a" phrase (NOT the
// looser "is transformed into a") so Meatshield's UNRELATED "damage taken from Protection is
// transformed into a Damage over Time effect" (a still-unmodelled SP-F-adjacent gap) never
// matches — corpus-verified: only Voron/Orel (both refit stages) match today.
const TRANSFORM_TO_DOT_RE =
    /transform\w*\s+the\s+damage\s+into\s+a\s+.*?damage\s+over\s+time\s+effect\b[^.]*?\b(?:lasting\s+for|for)\s+(\d+)\s+turns?\b/i;
// Orel's gate: "When directly damaged by an enemy affected/effected by Taunt or Provoke, …"
// (the live CSV spells it "effected", tolerated alongside the correct "affected").
const ATTACKER_TAUNT_PROVOKE_RE =
    /when\s+directly\s+damaged\s+by\s+an?\s+enemy\s+(?:affected|effected)\s+by\s+.*?\b(?:taunt|provoke)\b/i;

/**
 * Detects the "transforms the damage into a DoT lasting N turns" reactive self-conversion
 * (Voron unconditional; Orel gated on the attacker holding Taunt/Provoke). Operates on the
 * WHOLE row text (not sentence-scoped like detectDamageReactionTrigger) since the clause is
 * always its own self-contained sentence in the corpus. Reference data: docs/ship-skills.csv
 * (Voron, Orel — both refit stages).
 */
export function detectTransformToDot(
    text: string
): { turns: number; condition: 'always' | 'attacker-taunted-or-provoke' } | undefined {
    const plain = stripUnitTags(text);
    const m = TRANSFORM_TO_DOT_RE.exec(plain);
    if (!m) return undefined;
    const turns = parseInt(m[1], 10);
    // `\d+` also matches "0" — a malformed "for 0 turns" row would otherwise reach
    // convertHitToSelfDot as a live ability with rounds:0 (perTickAmount: damage/0 = Infinity).
    // Reject it at the source instead: no corpus row parses this way today (Voron/Orel are both
    // 2-3 turns), so this cannot change the result for anything that parses now.
    if (turns <= 0) return undefined;
    const condition = ATTACKER_TAUNT_PROVOKE_RE.test(plain)
        ? 'attacker-taunted-or-provoke'
        : 'always';
    return { turns, condition };
}

// Meatshield (refit-active passive) — "Any damage this Unit takes from Protection is transformed
// into a Damage over Time effect for N turns". DISJOINT from TRANSFORM_TO_DOT_RE (which requires
// the literal "transform the damage into a", so it never matches this clause, and this regex
// requires "takes from Protection is transformed", which never matches Voron/Orel). Corpus-
// verified: only Meatshield's refit-active passive matches (docs/ship-skills.csv).
const PROTECTION_TRANSFORM_TO_DOT_RE =
    /damage\s+this\s+unit\s+takes\s+from\s+protection\s+is\s+transformed\s+into\s+a\s+.*?damage\s+over\s+time\s+effect\b[^.]*?\bfor\s+(\d+)\s+turns?\b/i;

/**
 * Detects Meatshield's "damage taken from Protection is transformed into a DoT for N turns"
 * reactive self-conversion. Emitted as a 'transform-incoming-to-dot' ability gated to
 * `condition: 'self-protection-redirect'` so it fires ONLY on Protection-redirected chunks (never
 * on a normal direct hit to Meatshield). Reference data: docs/ship-skills.csv (Meatshield).
 */
export function detectProtectionTransformToDot(text: string): { turns: number } | undefined {
    const plain = stripUnitTags(text);
    const m = PROTECTION_TRANSFORM_TO_DOT_RE.exec(plain);
    if (!m) return undefined;
    return { turns: parseInt(m[1], 10) };
}

// Phase 3 PR-F: two DISTINCT "enemy repair" reaction phrasings that both ride the LIVE
// on-enemy-repaired trigger but route to DIFFERENT actors:
//  - Ruiner's Bomb infliction ("on any enemy performing a repair") has NO leading "when" (so
//    ENEMY_REPAIRS_RE in detectReactiveTrigger — which requires "when a[n] enemy … repairs" —
//    does not match it) and lands on the REPAIRER (eventCtx.repairerId), like every other
//    "on that enemy" counter-infliction.
//  - Amartya's Defense Shred ("when an enemy defender is directly repaired … on that
//    defender") uses the past-participle "repaired" (ENEMY_REPAIRS_RE's `repairs?\b` does not
//    match "repaired") and lands on the REPAIRED RECIPIENT ("that defender"), NOT the healer —
//    flagged `recipientTargeted` so the caller routes via eventCtx.repairedEnemyIds instead.
// Corpus-verified unique phrasings (docs/ship-skills.csv): grep for "performing a repair" and
// "defender is directly repaired" each return exactly one ship.
const ENEMY_PERFORMING_REPAIR_RE = /\bon\s+any\s+enemy\s+performing\s+an?\s+repairs?\b/i;
const ENEMY_DEFENDER_DIRECTLY_REPAIRED_RE =
    /\bwhen\s+an?\s+enemy\s+defender\s+is\s+directly\s+repaired\b/i;
// ship-kit W3 (Sansi): the GENERAL "when an enemy is directly repaired" phrasing (no
// "defender" role word) — a SELF-repair reaction, so it routes nowhere on the recipient
// (recipientTargeted stays unset; the heal targets self and only the SCALING count reads
// repairedEnemyIds). Distinct from Amartya's "enemy DEFENDER is directly repaired" above
// (which lands a debuff "on that defender"). Corpus-verified unique (docs/ship-skills.csv).
const ENEMY_DIRECTLY_REPAIRED_RE = /\bwhen\s+an?\s+enemy\s+is\s+directly\s+repaired\b/i;

/**
 * Sentence-scoped (mirrors detectDamageReactionTrigger/detectHpCrossingTrigger) detector for
 * the two "enemy repair" reaction phrasings above. Returns undefined outside their sentence.
 * Reference data: docs/ship-skills.csv (Ruiner, Amartya).
 */
export function detectEnemyRepairedTrigger(
    text: string,
    pos: number
): { trigger: 'on-enemy-repaired'; recipientTargeted?: boolean } | undefined {
    const sentence = rawSentenceAround(text, pos);
    if (sentence === undefined) return undefined;
    // Ruiner's "repair" is itself <unit-aid>-tagged ("performing a <unit-aid>repair</unit-aid>"),
    // which the RAW phrase regex below does not span — strip tags before testing (position
    // alignment is not needed here, only the boolean match, so this is safe unlike
    // phrasePosTrigger's raw-text scoping).
    const stripped = stripUnitTags(sentence);
    if (ENEMY_DEFENDER_DIRECTLY_REPAIRED_RE.test(stripped)) {
        return { trigger: 'on-enemy-repaired', recipientTargeted: true };
    }
    if (ENEMY_PERFORMING_REPAIR_RE.test(stripped)) {
        return { trigger: 'on-enemy-repaired' };
    }
    // ship-kit W3 (Sansi): general "when an enemy is directly repaired" — checked LAST so the
    // more-specific "defender" variant above wins its recipientTargeted flag. No recipient
    // routing (Sansi's heal is self-targeted).
    if (ENEMY_DIRECTLY_REPAIRED_RE.test(stripped)) {
        return { trigger: 'on-enemy-repaired' };
    }
    return undefined;
}

// ship-kit W3 (Anemone, Task 6): "When an enemy takes damage from a Damage over Time effect,
// repair 5% of this Unit's Max HP." Distinct from Anemone's own FIRST-passive sentence ("This
// Unit takes 25% less direct damage from enemies debuffed with a Damage over Time effect."),
// which shares the "Damage over Time effect" tail but never the leading "when an enemy takes
// damage from" phrase — sentence-scoped detection (below) keeps the two apart regardless.
// Corpus-verified unique phrasing (docs/ship-skills.csv).
const ENEMY_TAKES_DOT_DAMAGE_RE =
    /\bwhen\s+an?\s+enemy\s+takes\s+damage\s+from\s+an?\s+damage\s+over\s+time\s+effect\b/i;

/**
 * Sentence-scoped (mirrors detectEnemyRepairedTrigger's rawSentenceAround + stripUnitTags shape)
 * detector for Anemone's "when an enemy takes damage from a Damage over Time effect" reaction.
 * Returns undefined outside that sentence — so an anchor landing in a different sentence (e.g.
 * the co-located "takes 25% less direct damage from … Damage over Time" passive clause) is never
 * co-triggered. Reference data: docs/ship-skills.csv (Anemone).
 */
export function detectEnemyDotDamageTrigger(
    text: string,
    pos: number
): 'on-enemy-dot-damage' | undefined {
    const sentence = rawSentenceAround(text, pos);
    if (sentence === undefined) return undefined;
    const stripped = stripUnitTags(sentence);
    return ENEMY_TAKES_DOT_DAMAGE_RE.test(stripped) ? 'on-enemy-dot-damage' : undefined;
}

// ship-kit W3 (Hemlock, Task 9): "When Corrosion spreads this Unit repairs 5% …". Corpus-verified
// unique phrasing (docs/ship-skills.csv). "Spread" is the end-of-round Toxic Overflow mechanic
// (ledger #49): a unit with Toxic Overflow + Corrosion inflicts Corrosion I on its adjacent allies
// at end of round — the engine emits `corrosion-spread`, which this trigger rides.
const CORROSION_SPREADS_RE = /\bwhen\s+corrosion\s+spreads\b/i;

/**
 * Sentence-scoped (mirrors detectEnemyDotDamageTrigger's rawSentenceAround + stripUnitTags shape)
 * detector for Hemlock's "when Corrosion spreads" self-repair reaction. Returns undefined outside
 * that sentence so a heal anchor in a different clause (Hemlock's co-located "gains 1 charge …
 * after it inflicts a debuff") is never co-triggered. Reference data: docs/ship-skills.csv (Hemlock).
 */
export function detectCorrosionSpreadTrigger(
    text: string,
    pos: number
): 'on-corrosion-spread' | undefined {
    const sentence = rawSentenceAround(text, pos);
    if (sentence === undefined) return undefined;
    const stripped = stripUnitTags(sentence);
    return CORROSION_SPREADS_RE.test(stripped) ? 'on-corrosion-spread' : undefined;
}

// ship-kit W3 (Laika, Task 7): "… upon removing Shield from an enemy." Corpus-verified unique
// phrasing (grep docs/ship-skills.csv: Laika's two passive-tier variants — 20%/refit-inactive and
// 30%/refit-active — are the ONLY rows carrying "removing Shield from an enemy"). Laika's own
// "Shield" word here is NOT <unit-damage>-tagged (only the granted-shield pct earlier in the same
// sentence is), so a plain (untagged) regex suffices — kept sentence-scoped + stripUnitTags anyway
// to mirror detectEnemyDotDamageTrigger's shape and stay robust to a future tagged variant.
const SHIELD_STRIPPED_RE = /\bupon\s+removing\s+shield\s+from\s+an\s+enem/i;

/**
 * Sentence-scoped (mirrors detectEnemyDotDamageTrigger's rawSentenceAround + stripUnitTags shape)
 * detector for Laika's "upon removing Shield from an enemy" self-shield reaction. Returns
 * undefined outside that sentence. Wired onto the NEW `shield-stripped` bus event (combat/
 * events.ts); self-scoped in triggers.ts (mirrors on-own-cleanse) since it's the STRIPPING
 * actor's own reaction to its OWN action, not an opposing-side reaction. Reference data:
 * docs/ship-skills.csv (Laika).
 */
export function detectShieldStrippedTrigger(
    text: string,
    pos: number
): 'on-own-shield-strip' | undefined {
    const sentence = rawSentenceAround(text, pos);
    if (sentence === undefined) return undefined;
    const stripped = stripUnitTags(sentence);
    return SHIELD_STRIPPED_RE.test(stripped) ? 'on-own-shield-strip' : undefined;
}

// Once-per-round-per-ENEMY cap on a reactive debuff (Ruiner's Bomb: "once per round per
// enemy") — distinct from the plain "once per round" cap (which caps once per round OVERALL).
// Exported: buildShipAbilities.ts's passive DoT-reaction loop tests it directly.
export const ONCE_PER_ROUND_PER_ENEMY_RE = /\bonce per round per enemy\b/i;

// Phase 4c PR 3 (Task 6): "when HP drops/falls below N%" buff-grant reactives
// (Tycho/Shelter/Los/Kafa/Redeemer). The (drops|falls) VERB is what distinguishes a
// threshold-CROSSING reactive from the static "while/if below N% HP" gates handled
// elsewhere — see the negative guards in the docblock below.
const HP_CROSSING_RE =
    /\b(?:its\s+|this\s+unit'?s?\s+)?hp\s+(?:drops|falls)\s+below\s+(\d+(?:\.\d+)?)\s*%/i;
const ONCE_PER_BATTLE_RE = /\bonce per battle\b/i;

/**
 * "when HP drops/falls below N%" buff-grant reactives (Tycho/Shelter/Los/Kafa/Redeemer).
 * Sentence-scoped at the ability's anchor `pos` using the SAME masked rawSentenceAround the
 * damage-reaction path uses, so the "Inc."/"Out." abbreviation periods in a buff name
 * (Shelter's "Inc. Damage Down II") don't split the sentence mid-name, and a buff in a
 * DIFFERENT sentence does not co-trigger (Tycho's start-of-combat Cheat Death / Everliving
 * Regeneration II precede the crossing clause; Los's "30% more Direct damage … when its HP is
 * below 50%" modifier sits in its own <br>-separated sentence). Feed the CANONICAL post-wiring
 * text shape — <br /> normalized to '. ' — exactly as buildShipAbilities does before scoping.
 *
 * The (drops|falls) VERB is REQUIRED, which excludes the static-gate phrasings the corpus also
 * carries: the damage-reaction "while below N% HP" (Makoli), the extra-action "If its HP is
 * below N%" (Tormenter), the enemy-scaling "when the target is below N% HP" (Tithonus), and the
 * ally-filter "allies below N% HP" (Chimei) — none use drops/falls, so all return undefined.
 *
 * `oncePerCombat` is true when the SAME scoped sentence says "once per battle" — captured
 * whether it leads the sentence (Tycho "Once per battle, when HP drops below 40%…") or trails
 * it (Los "Once per battle when HP falls below 50%", Shelter "…below 20%, once per battle").
 * Reference data: docs/ship-skills.csv (Tycho, Shelter, Los, Kafa, Redeemer).
 */
export function detectHpCrossingTrigger(
    text: string,
    pos: number
): { trigger: 'on-hp-threshold-crossed'; hpBelowPct: number; oncePerCombat: boolean } | undefined {
    const sentence = rawSentenceAround(text, pos);
    if (sentence === undefined) return undefined;
    const m = HP_CROSSING_RE.exec(sentence);
    if (!m) return undefined;
    return {
        trigger: 'on-hp-threshold-crossed',
        hpBelowPct: parseFloat(m[1]),
        oncePerCombat: ONCE_PER_BATTLE_RE.test(sentence),
    };
}

// Hermes charged skill: "If the target has less than N% HP" gate on a grant clause. Distinct
// from the self-subject HP_CROSSING_RE — this reads the TARGET's HP and is a one-shot cast-time
// gate, not a reactive crossing.
const TARGET_HP_GATE_RE = /\bif the target has less than\s+(\d+(?:\.\d+)?)\s*%\s*hp\b/i;

/**
 * Hermes: "If the target has less than N% HP" gate on a grant clause. Sentence-scoped at the
 * grant's anchor `pos` (same masked rawSentenceAround as the crossing detector) so the
 * preceding repair/charge sentence — which has no target gate — never co-matches. Returns
 * undefined for any text without "the target". Reference data: docs/ship-skills.csv (Hermes).
 */
export function detectTargetHpGate(text: string, pos: number): { hpBelowPct: number } | undefined {
    const sentence = rawSentenceAround(text, pos);
    if (sentence === undefined) return undefined;
    const m = TARGET_HP_GATE_RE.exec(sentence);
    return m ? { hpBelowPct: parseFloat(m[1]) } : undefined;
}

// "for N hit(s)" grant window. Chars after the buff-name anchor that may still belong to that
// grant's own duration phrase — the longest corpus lead-in is "Barrier</unit-skill> for 1 hit"
// (30), so 60 leaves headroom for a longer name without reaching a later clause.
const HIT_COUNT_WINDOW = 60;
// The FIRST duration phrase after the anchor wins, whichever unit it names. Scanning for "hits"
// alone would let Sansi's Taunt — "grants Taunt for 1 turn and Barrier for 1 hit", one sentence —
// skip over its own "for 1 turn" and steal Barrier's hit count; requiring the first match to BE
// the hit form keeps every grant on the phrase that immediately follows it.
const GRANT_DURATION_RE = /\bfor\s+(\d+)\s+(hits?|turns?)\b/i;

/**
 * "… <unit-skill>Barrier</unit-skill> for 1 hit" → 1: a hit-counted lifecycle (the buff config's
 * `hits`) instead of, or alongside, a turn duration. Returns undefined when the grant states turns
 * or no duration at all, leaving the turn lifecycle in charge.
 *
 * INDEX BASIS: `pos` is the buff name's index in the RAW (tagged) row text, as produced by
 * findBuffNamePos at the buff-merge site. The window is therefore cut from a length-PRESERVING
 * maskAbbrev of that same text — the convention rawSentenceAround and detectRemovalTriggerAt use.
 * stripUnitTags would delete characters and shift every offset (the raw-pos/stripped-text trap).
 * The window is also clipped at the first sentence boundary so a following sentence's phrase
 * cannot be read as this grant's.
 *
 * Corpus sites (docs/ship-skills.csv), all "for 1 hit": Malvex (charge), Panon (charge),
 * Quixilver (passive), Sansi (charge). Distinct from buildShipAbilities' parseHitCount, which
 * counts a multi-hit ATTACK ("attacks three times").
 */
export function detectHitCount(text: string, pos: number): number | undefined {
    if (pos < 0) return undefined;
    const window = maskAbbrev(text).slice(pos, pos + HIT_COUNT_WINDOW);
    const boundary = window.search(/[.;](?=\s|$)|<br\s*\/?>/i);
    const m = GRANT_DURATION_RE.exec(boundary >= 0 ? window.slice(0, boundary) : window);
    if (!m || !/^hits?$/i.test(m[2])) return undefined;
    const n = parseInt(m[1], 10);
    return n > 0 ? n : undefined;
}

// "detonates <Corrosion|Inferno|Bomb> effects with N% of their power" / "… at N% power" —
// consume active DoTs of that type and deal their damage at once, scaled by N% (Incinerator,
// Crocus, Demolisher). Lingshe's countdown-reduction / crit-scaling detonation is not this form.
const DETONATE_DOT_RE =
    /detonat\w*\s+(corrosion|inferno|bomb)\s+effects\s+(?:with|at)\s+(\d+(?:\.\d+)?)%/i;

/**
 * Parses a DoT detonation: the DoT type consumed and the % of its power dealt. Returns null
 * when no detonation clause is present. Reference data: docs/ship-skills.csv.
 */
export function parseDetonateDoT(
    text: string | null | undefined
): { dotType: DoTType; powerPct: number } | null {
    if (!text) return null;
    const m = DETONATE_DOT_RE.exec(stripUnitTags(text));
    if (!m) return null;
    return { dotType: m[1].toLowerCase() as DoTType, powerPct: parseFloat(m[2]) };
}

// Named "accumulate-and-detonate" debuffs: while active they gather all direct damage
// dealt to the enemy, then detonate for a % of that accumulated total on expiry. The %
// is intrinsic to the named effect (from its buff definition, e.g. Echoing Burst "deals
// 100% of the damage upon expiration"); the duration comes from the skill text. Keyed by
// lowercase name so detection survives the <unit-*> tags and casing in the source data.
const ACCUMULATE_DETONATE_EFFECTS: Record<string, number> = { 'echoing burst': 100 };

/** Whether `name` is a known accumulate-and-detonate debuff (so its plain debuff card is suppressed). */
export function isAccumulateDetonateEffect(name: string | null | undefined): boolean {
    return !!name && name.toLowerCase() in ACCUMULATE_DETONATE_EFFECTS;
}

/**
 * Parses an Echoing Burst-style accumulate-and-detonate debuff inflicted by the skill:
 * the duration (turns) it gathers direct damage and the % of the accumulated total dealt
 * on expiry. Returns null when no such named effect is present. Reference: docs/ship-skills.csv.
 */
export function parseAccumulateDetonate(
    text: string | null | undefined
): { turns: number; pct: number } | null {
    if (!text) return null;
    // Normalize <br> to '. ' for sentence-boundary detection before stripping tags.
    const plain = stripUnitTags(text.replace(/<br\s*\/?>/gi, '. ')).toLowerCase();
    for (const [name, pct] of Object.entries(ACCUMULATE_DETONATE_EFFECTS)) {
        const idx = plain.indexOf(name);
        if (idx === -1) continue;
        // Reference guard: "When an Echoing Burst explodes …" describes an EXISTING
        // burst detonating (a heal-on-burst reaction), not a fresh infliction. Scoped
        // to the full when…<name>…explodes shape so a hypothetical CONDITIONAL
        // infliction ("When X happens, inflicts Echoing Burst for 2 turns") still
        // parses (CodeRabbit PR #86 narrowing).
        const sentenceStart = Math.max(0, plain.lastIndexOf('. ', idx) + 1);
        const sentenceEndRaw = plain.indexOf('. ', idx);
        const sentence = plain.slice(
            sentenceStart,
            sentenceEndRaw === -1 ? plain.length : sentenceEndRaw
        );
        if (new RegExp(`\\bwhen(?:ever)?\\b[^.]*\\b${name}\\b[^.]*\\bexplodes?\\b`).test(sentence))
            continue;
        // "for N turns" attaches to the named effect when present (default 2 turns).
        const m = /for\s+(\d+)\s+turns?/.exec(plain.slice(idx));
        return { turns: m ? parseInt(m[1], 10) : 2, pct };
    }
    return null;
}

// "<subject> cannot critically hit" — the no-crit attaches to whatever noun precedes it.
// We flag the ATTACK as no-crit unless that subject is a repair/heal (e.g. Pallas's "this
// repair cannot critically hit", which sits after an unrelated "the damage dealt").
// Tolerates the "cannont" misspelling in the source data (Provider). Ship-kit W5 (Demolisher
// passive): "cannot result in a critical hit" is an alternate phrasing of the same no-crit
// clause ("This damage ... cannot result in a critical hit"), added alongside the original
// "critically hit" form.
const NO_CRIT_RE =
    /(\w+)\s+(?:cannot|cannont)\s+(?:critically\s+hit|result\s+in\s+a\s+critical\s+hit)\b/gi;
const NO_CRIT_HEAL_SUBJECTS = new Set(['repair', 'repairs', 'heal', 'heals']);

/** Whether a skill's attack/damage cannot critically hit. Reference data: docs/ship-skills.csv. */
export function parseNoCrit(text: string | null | undefined): boolean {
    if (!text) return false;
    for (const m of stripUnitTags(text).matchAll(NO_CRIT_RE)) {
        if (!NO_CRIT_HEAL_SUBJECTS.has(m[1].toLowerCase())) return true;
    }
    return false;
}

// Ship-kit W5 (Demolisher bomb-splash): "This damage ignores Defense ..." — the splash damage
// bypasses the target's Defense mitigation term entirely. Boolean only; the flag rides the
// damage config (ignoresDefense) and is consumed by the REACTIVE damage executor (Task C3).
const IGNORES_DEFENSE_RE = /ignores?\s+defense/i;
/** Whether a skill's damage clause ignores the target's Defense (Demolisher bomb-splash).
 *  Reference data: docs/ship-skills.csv. */
export function parseIgnoresDefense(text: string | null | undefined): boolean {
    return !!text && IGNORES_DEFENSE_RE.test(stripUnitTags(text));
}

// W6: "This attack can target Stealthed enemies" — a per-attack stealth-targeting bypass.
// Requires the "can target … Stealthed … enem" ordering so the ship-wide "ignores Stealth
// effects" passive (no "can target") does NOT match here.
const CAN_TARGET_STEALTHED_RE = /\bcan target\b[^.]*\bstealthed\b[^.]*\benem/i;

/** True when the given attack text states it can target Stealthed enemies (per-ability bypass). */
export function parseIgnoresStealth(text: string | null | undefined): boolean {
    return !!text && CAN_TARGET_STEALTHED_RE.test(stripUnitTags(text));
}

// SP-F F4 (Wusheng): "deals 220% damage WITH AFFINITY ADVANTAGE …" — the charged hit is forced
// to affinity advantage regardless of the real matchup. Boolean only; the flag rides the damage
// config (forceAffinityAdvantage) and is consumed at the affinity seams in playerTurn.ts.
const FORCE_AFFINITY_ADVANTAGE_RE = /\bwith\s+affinity\s+advantage\b/i;
export function parseForceAffinityAdvantage(text: string | null | undefined): boolean {
    if (!text) return false;
    return FORCE_AFFINITY_ADVANTAGE_RE.test(stripUnitTags(text));
}

// MATCHES "don’t"/"doesn’t"/"does not"/bare "do not" + "break stasis" ONLY. NOT "affected by
// stasis" (parseExtraAction owns that), "damage to enemies under Stasis", or "inflicts Stasis".
// Input is normalised (curly/smart apostrophes → ASCII \x27) before matching so both game-data
// forms are detected with a simple ASCII-only regex.
const DOESNT_BREAK_STASIS_RE = /\b(?:do(?:es)?n\x27?t|does not|do not)\s+break\s+stasis\b/i;
/** True iff this skill text declares the unit’s attacks don’t break Stasis (Akula + Tygr).
 *  Boolean only — each ship’s other clauses (extra-action, +damage-vs-stasised) are parsed
 *  elsewhere, untouched. */
export function parseDoesntBreakStasis(text: string | null | undefined): boolean {
    if (!text) return false;
    // Normalise U+2018 (left) / U+2019 (right) single quotation marks to ASCII apostrophe
    // before testing so the simple \x27 in the regex matches both curly and straight forms.
    const normalised = stripUnitTags(text).replace(/[‘’]/g, '\x27');
    return DOESNT_BREAK_STASIS_RE.test(normalised);
}

/** True iff this skill text declares the unit is immune to charge loss effects (Lev). */
const CHARGE_LOSS_IMMUNE_RE = /\bimmune to charge[- ]?loss\b/i;
export function parseChargeLossImmune(text: string | null | undefined): boolean {
    // No apostrophe-normalisation (unlike parseDoesntBreakStasis): the matched phrase
    // "immune to charge loss" contains no apostrophe, so curly/straight quotes can't affect it.
    return !!text && CHARGE_LOSS_IMMUNE_RE.test(stripUnitTags(text));
}

// SP-F F5 (Meatshield, R4 refit-active passive) — "Any direct damage dealt to a non-defender
// ally that is not transferred by Protection is dealt as if that ally had this Unit's defense."
// APPROXIMATION (locked, see AbilityType's 'defense-substitution' doc comment): Protection-as-
// damage-transfer is a DEFERRED mechanic, so nothing is ever "transferred by Protection" in this
// model — the "not transferred" gate is vacuously satisfied, and this detector is deliberately
// gate-blind (it does not attempt to parse the Protection-transfer clause at all). Matches
// "non-defender ally" ... "dealt as if" ... "this Unit's defense" within the SAME sentence
// (`[^.]*` bounded on both sides) so an unrelated sentence elsewhere in the text can't false-hit.
const DEFENSE_SUBSTITUTION_RE =
    /non-defender\s+ally\b[^.]*\bdealt\s+as\s+if\b[^.]*\bthis\s+unit\x27?s\s+defen[cs]e\b/i;
/** True iff this skill text declares that direct damage to a non-defender ally is calculated
 *  against THIS unit's defense instead of the ally's own (Meatshield's R4 substitution clause).
 *  Boolean only — the sibling "damage taken from Protection transforms into a DoT" sentence is a
 *  SEPARATE, deliberately-unmodelled clause and is never matched here. */
export function parseDefenseSubstitution(text: string | null | undefined): boolean {
    if (!text) return false;
    const normalised = stripUnitTags(text).replace(/[‘’]/g, '\x27');
    return DEFENSE_SUBSTITUTION_RE.test(normalised);
}

// Wave 4 Task 8 (FrontLine passive): "While Shielded, it gains 2500 additional Defense." A flat-
// points DEFENSIVE stat grant, gated on the owner CURRENTLY holding a shield — distinct from
// every existing "additional <stat>" shape in the corpus, which is all percentage-of-a-stat
// DAMAGE ("additional damage equal to N% of its Defense/Shield", parseSecondaryDamage). Scoped
// to the "while shielded ... gains N additional defen[cs]e" phrase so it can't false-hit an
// unrelated "additional damage" sentence elsewhere in the same (<br />-separated) passive text —
// verified corpus-wide: exactly one ship (FrontLine, in both the R0 and R2 passive columns of the
// same clause) matches `grep -io "while shielded[^.]*"`/`"additional defen[cs]e[^.]*"` against
// docs/ship-skills.csv.
const WHILE_SHIELDED_FLAT_DEFENCE_RE =
    /while\s+shielded[,]?\s+(?:it\s+)?gains\s+(\d+)\s+additional\s+defen[cs]e/i;

/**
 * Returns the flat Defense points granted by a "While Shielded, it gains N additional Defense"
 * clause, or undefined if no such clause is present. The build layer (buildShipAbilities) turns
 * this into a `conditional-stat` ability (`condition:'self-shield'`) consumed directly by the
 * engine's `substitutedDefenceFor` defensive-read seam — never through the on-cast ability-fold/
 * executor pipeline (see AbilityType's 'conditional-stat' doc comment).
 */
export function parseWhileShieldedFlatDefence(text: string | null | undefined): number | undefined {
    if (!text) return undefined;
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    const match = WHILE_SHIELDED_FLAT_DEFENCE_RE.exec(plain);
    if (!match) return undefined;
    const flat = parseInt(match[1], 10);
    return isNaN(flat) ? undefined : flat;
}

/**
 * Parses an enemy-targeted charge removal from skill text. Returns
 * `{ amount, trigger, everyNthEvent?, requiredEnemyType? }` or null if no removal clause is
 * found.
 *
 * Triggers:
 *  - `'on-bomb-detonated'` — the removal fires when a bomb explodes (Demolisher).
 *  - `'on-enemy-repaired'` with `everyNthEvent: 2` — fires every 2nd enemy repair (Zosimos).
 *  - `'on-cast'` — default (Opal, Provider, Sefuba, Thresh).
 *
 * Does NOT modify `parseChargeGain`; the two coexist on texts that carry both a gain and a
 * removal (e.g. Thresh, Zosimos).
 *
 * Shared gate (epic PR3): when the removal's OWN sentence also carries an "if the target is a
 * <Type>" lead-in (Thresh: "If the target is a Defender, this Unit removes 1 charge from the
 * enemy and adds 1 charge to this Unit's Charged Skill."), that gate is shared across BOTH
 * halves of the sentence — the removal must be gated identically to its paired self-gain
 * (parseChargeGain/classifyChargeCondition already applies the gate to that half). Scoped to the
 * sentence containing the removal clause (reusing `GRANT_ENEMY_TYPE_RE`/`splitSentences`, the
 * same detectors `detectGrantConditions` uses) so an unrelated ship's "Defender" mention
 * elsewhere in the text never leaks a spurious gate onto an otherwise-unconditional removal
 * (Opal/Provider/Demolisher/Sefuba/Zosimos have no such lead-in and are unaffected).
 */
export function parseChargeRemoval(text: string | null | undefined): {
    amount: number;
    trigger: AbilityTrigger;
    everyNthEvent?: number;
    requiredEnemyType?: EnemyBaseClass;
} | null {
    if (!text) return null;
    // Normalise curly single quotes (U+2018 left, U+2019 right) to straight (U+0027) so that
    // ship-data using typographic apostrophes ("enemy’s") matches the regex reliably.
    // Using explicit unicode escapes so no editor can silently normalise the characters.
    const plain = stripUnitTags(text).replace(/[‘’]/g, '\x27');
    const m = REMOVE_CHARGE_RE.exec(plain);
    if (!m) return null;
    // m[1] is the captured count from the "removes N charges" alternation; the
    // "decreases that enemy's charge" alternation has no capture → amount 1 ("by one").
    const raw = (m[1] ?? '').toLowerCase();
    const amount = raw === '' || raw === 'a' || raw === 'an' ? 1 : parseInt(raw, 10);
    if (!amount || isNaN(amount)) return null;

    // The enemy-repair TRIGGER and the every-Nth CADENCE are independent facts about the clause.
    // They were conjoined, so Zosimos's R4 row — which phrases the cadence as plain "for every
    // repair they perform" rather than "every second repair" — matched no branch and fell through
    // to the on-cast default, firing the removal on Zosimos's own cast instead of on the enemy's
    // repair (#362). Measured over all 149 corpus ships: Zosimos passive3 is the only row whose
    // trigger this decoupling changes.
    if (ENEMY_REPAIRS_RE.test(plain)) {
        return {
            amount,
            trigger: 'on-enemy-repaired',
            ...(EVERY_SECOND_REPAIR_RE.test(plain) ? { everyNthEvent: 2 } : {}),
        };
    }
    if (BOMB_DETONATE_RE.test(plain)) {
        return { amount, trigger: 'on-bomb-detonated' };
    }
    // Shared "if the target is a <Type>" gate — ON-CAST ONLY (PR #209 review): the reactive
    // triggers above evaluate gates against the fight-wide/DPS-dropdown enemyType, never the
    // actual triggering actor, and bulk all-opposing removals have no coherent single-enemy
    // semantics — a reactive removal that ever gains a type lead-in in the CSV must extend the
    // reactive gate plumbing, not silently reuse this. Sentence-scoped with the SAME
    // abbreviation masking resolveBuffClause uses ("Inc."/"Out." buff-name periods would
    // otherwise split the sentence mid-name and could detach the gate from its clause).
    const removalSentence = splitSentences(maskAbbrev(plain)).find((s) => REMOVE_CHARGE_RE.test(s));
    const gateMatch = removalSentence ? GRANT_ENEMY_TYPE_RE.exec(removalSentence) : null;
    const requiredEnemyType = gateMatch ? capType(gateMatch[1]) : undefined;
    return { amount, trigger: 'on-cast', ...(requiredEnemyType ? { requiredEnemyType } : {}) };
}

// Phase 4 (Curator / FrontLine): reaction to an ENEMY casting its charged skill.
// "When an enemy uses their charged skill, this unit purges N buffs from that enemy[,
//  and inflicts Block Buff for M turns]." The trigger phrase gates the whole reaction;
// the purge + Block-Buff clauses are parsed independently so refits that add the
// Block-Buff clause (R2/R4) emit the extra debuff while R0 emits purge alone.
const ENEMY_USES_CHARGED_RE = /\bwhen\s+an?\s+enemy\s+uses\s+(?:its|their)\s+charged\s+skill\b/i;
const ECC_PURGE_RE = /\bpurges?\s+(\d+|a|an)\s+buffs?\b/i;
const ECC_BLOCK_BUFF_RE = /\binflicts?\s+block\s+buff\s+for\s+(\d+)\s+turns?\b/i;
// FrontLine (Task 6): a reactive damage + shield clause on the same enemy-charged-cast trigger.
//   "...it deals 80% and gains a Shield equal to 30% of the damage dealt, once per round."
// "deals N%" -> reactive damage multiplier; "Shield equal to M% of the damage dealt" -> a shield
// scaled off FrontLine's OWN reactive damage; "once per round" -> the per-round gate.
const ECC_DAMAGE_RE = /\bdeals?\s+(\d+(?:\.\d+)?)\s*%/i;
const ECC_SHIELD_OF_DAMAGE_RE =
    /\bshield\s+equal\s+to\s+(\d+(?:\.\d+)?)\s*%\s*of\s+(?:the\s+)?damage\s+dealt/i;
const ECC_ONCE_PER_ROUND_RE = /\bonce\s+per\s+round\b/i;

/**
 * Parses the "when an enemy uses their charged skill" reaction (Phase 4). Emits full
 * `Ability` objects on the `on-enemy-charged-cast` trigger, targeting `'enemy'` (the
 * engine routes them to the firing enemy via `eventCtx.counterTargetId`). Returns null
 * when the trigger phrase is absent.
 *
 * Curator clauses handled here:
 *  - purge N buffs (always present in the corpus) → `{ type:'purge', count }`.
 *  - optional "inflicts Block Buff for M turns" (R2/R4) → a full `debuff` ability
 *    (`buffName:'Block Buff'`, `application:'inflict'`).
 *
 * Returned abilities carry a placeholder `id` ('') — `buildShipAbilities` reassigns
 * stable, distinct ids via `nextId()` when it consumes them (mirroring how the other
 * reaction parsers' data gets built into `Ability` objects there).
 *
 * FrontLine's damage + shield once-per-round reaction (Task 6) extends this function.
 */
export function parseEnemyChargedCastReaction(text: string | null | undefined): Ability[] | null {
    if (!text) return null;
    // Mirror parseChargeRemoval: strip <unit-*> tags and normalise curly apostrophes
    // (U+2018/U+2019 → ASCII) so typographic game-data forms match the ASCII regexes.
    const plain = stripUnitTags(text).replace(/[‘’]/g, '\x27');
    if (!ENEMY_USES_CHARGED_RE.test(plain)) return null;

    // NOTE: the effect-clause regexes below assume the relevant clauses live within the
    // trigger sentence. The current corpus carries ONLY Curator (purge / Block Buff) and
    // FrontLine (deals / shield) with this trigger — neither ship has an unrelated
    // "purge"/"deals"/"shield" clause elsewhere — so unscoped matching is safe today.
    const out: Ability[] = [];

    const purge = ECC_PURGE_RE.exec(plain);
    if (purge) {
        const raw = purge[1].toLowerCase();
        const count = raw === 'a' || raw === 'an' ? 1 : parseInt(raw, 10);
        if (count && !isNaN(count)) {
            out.push({
                id: '',
                type: 'purge',
                target: 'enemy',
                trigger: 'on-enemy-charged-cast',
                conditions: [],
                config: { type: 'purge', count },
                autoFilled: true,
            });
        }
    }

    const block = ECC_BLOCK_BUFF_RE.exec(plain);
    if (block) {
        const duration = parseInt(block[1], 10);
        if (duration && !isNaN(duration)) {
            out.push({
                id: '',
                type: 'debuff',
                target: 'enemy',
                trigger: 'on-enemy-charged-cast',
                conditions: [],
                config: {
                    type: 'debuff',
                    buffName: 'Block Buff',
                    parsedEffects: {},
                    stacks: 1,
                    isStackable: false,
                    duration,
                    application: 'inflict',
                },
                autoFilled: true,
            });
        }
    }

    // FrontLine: reactive damage + a shield scaled off THAT damage, both once per round.
    const dmgM = ECC_DAMAGE_RE.exec(plain);
    const shieldM = ECC_SHIELD_OF_DAMAGE_RE.exec(plain);
    if (dmgM && shieldM) {
        const damagePct = parseFloat(dmgM[1]);
        const shieldPct = parseFloat(shieldM[1]);
        if (damagePct && !isNaN(damagePct) && shieldPct && !isNaN(shieldPct)) {
            const oncePerRound = ECC_ONCE_PER_ROUND_RE.test(plain);
            out.push({
                id: '',
                type: 'damage',
                target: 'enemy',
                trigger: 'on-enemy-charged-cast',
                conditions: [],
                config: { type: 'damage', multiplier: damagePct, hits: 1 },
                oncePerRound,
                autoFilled: true,
            });
            // SP-G G3: the shield is "30% of the damage dealt" — FrontLine's OWN 80% reactive
            // hit, which applyReactiveDamage computes defense-mitigated and crit-eligible. The
            // reactive-damage intent drains before this shield intent (enqueue order) and stamps
            // its dealt amount into reactiveDealtByOwner; basis:'damage-dealt' reads it via the
            // exec ctx (see triggers.ts). pct is the raw clause percentage (30) — no attack fold.
            out.push({
                id: '',
                type: 'shield',
                target: 'self',
                trigger: 'on-enemy-charged-cast',
                conditions: [],
                config: {
                    type: 'shield',
                    basis: 'damage-dealt',
                    pct: shieldPct,
                },
                oncePerRound,
                autoFilled: true,
            });
        }
    }

    return out.length ? out : null;
}

/** Chimei R2: "When over-repairing a damaged ally, the ally with the lowest current health
 *  percentage repairs an amount equivalent to the over-repair."
 *
 *  A STANDALONE ability rather than another `detectXTrigger(text, healPos)` arm in
 *  buildShipAbilities' heal chain: the clause carries NO percentage tag, so parseHealAbilities
 *  never produces a heal entry for a trigger detector to attach to. This is why the clause parsed
 *  to nothing at all before #435.
 *
 *  `pct: 100` — the redirect is the WHOLE wasted amount ("equivalent to the over-repair"); the
 *  executor's `overheal` basis sizes it from the SUM of the triggering repair's clipped excess
 *  (owner ruling R4, 2026-08-30). `target: 'lowest-hp-ally'` is what opts the executor out of
 *  Abundant Renewal's per-ally fan-out.
 *
 *  Exact-phrase anchored — "over-repair", "lowest", and "repairs an amount" each appear
 *  separately elsewhere in the corpus, and the HANDOFF calibration is that a looser rule in this
 *  area over-reports on its first run. Tolerates the hyphen being absent ("overrepairing") and
 *  arbitrary whitespace, nothing else.
 *
 *  ⚠️ The tail is "the OVER-REPAIR". #434/#435/HANDOFF all paraphrase it as "the overflow";
 *  docs/ship-skills.csv does not say that. Do not widen the rule to match the paraphrase.
 */
const OVER_REPAIR_REDIRECT_RE =
    /when\s+over-?repairing\s+a\s+damaged\s+ally\s*,\s*the\s+ally\s+with\s+the\s+lowest\s+current\s+health\s+percentage\s+repairs\s+an\s+amount\s+equivalent\s+to\s+the\s+over-?repair/i;

export function parseOverRepairRedirect(text: string | null | undefined): Ability | null {
    if (!text) return null;
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    if (!OVER_REPAIR_REDIRECT_RE.test(plain)) return null;
    return {
        id: '',
        type: 'heal',
        target: 'lowest-hp-ally',
        trigger: 'on-own-repair-to-ally',
        conditions: [],
        config: { type: 'heal', pct: 100, basis: 'overheal' },
    };
}

/** Whether a skill triggers "when an ally inflicts a debuff" (a manual, team-dependent gate). */
export function parseAllyInflictsDebuff(text: string | null | undefined): boolean {
    return !!text && ALLY_INFLICTS_DEBUFF_RE.test(stripUnitTags(text));
}

/**
 * Parses a self-targeted Charged-Skill charge gain from skill text. Returns null
 * for ally-grant, enemy-removal, on-kill, and enemy-repair phrasings (out of
 * scope or never-fire under the sim assumptions). Conditions are classified into
 * the (shared) ConditionalCondition set; `derivable` follows the same meaning as
 * ConditionalDamage. Reference data: docs/ship-skills.csv.
 */
export function parseChargeGain(text: string | null | undefined): ChargeGain | null {
    if (!text) return null;
    const plain = stripUnitTags(text);
    if (CHARGE_DISQUALIFY_RE.test(plain)) return null;

    // Rhodium "equal to the number of buffs" form (amount is per-buff = 1).
    if (PER_BUFF_CHARGE_RE.test(plain)) {
        return { amount: 1, condition: 'enemy-buff', derivable: false };
    }

    const m = SELF_CHARGE_ADD_RE.exec(plain);
    if (!m) return null;
    const raw = m[1].toLowerCase();
    const amount = raw === 'a' || raw === 'an' ? 1 : parseInt(raw, 10);
    if (!amount || isNaN(amount)) return null;

    // Inflict-driven charge gains fire per debuff infliction (+amount each event), not per
    // standing debuff. Ally-inflicts ("when an ally inflicts a debuff", Oleander) is checked
    // FIRST since its text also matches the self-inflict phrasing; then the self-inflict form
    // ("after it inflicts a debuff", Hemlock). Both emit 'always' + a reactive trigger so the
    // engine listens for the event rather than scaling by an enemy-debuff count.
    // Enemy-repair reactive (Zosimos): a self charge gain that fires per ENEMY repair. Checked
    // FIRST among the reactive branches — the on-enemy-repaired trigger IS the gate (per-event
    // +amount), so it pre-empts the always-true default and any debuff-inflict classification.
    if (ENEMY_REPAIRS_RE.test(plain)) {
        return { amount, condition: 'always', derivable: true, trigger: 'on-enemy-repaired' };
    }
    // On-kill reactive (Phase 3 PR-B: Obsidian/Valiant): a self charge gain that fires per
    // enemy kill. Checked alongside the enemy-repair branch, BEFORE the inflict-debuff
    // classification — the on-enemy-destroyed trigger IS the gate (per-event +amount), same
    // shape as on-enemy-repaired above. KILL_TRIGGER_RE covers "on kill" / "killing an
    // enemy/opponent" / "when an enemy dies"; no corpus self-charge ship's text also mentions
    // debuff-infliction, so ordering relative to that branch is inert.
    if (KILL_TRIGGER_RE.test(plain)) {
        return { amount, condition: 'always', derivable: true, trigger: 'on-enemy-destroyed' };
    }

    const low = plain.toLowerCase();
    if (ALLY_INFLICTS_DEBUFF_RE.test(plain)) {
        return {
            amount,
            condition: 'always',
            derivable: true,
            trigger: 'on-ally-debuff-inflicted',
        };
    }
    if (low.includes('inflict') && low.includes('debuff')) {
        return { amount, condition: 'always', derivable: true, trigger: 'on-debuff-inflicted' };
    }

    // Phase 3 (Cobalt): start-of-turn self-charge gated on full HP. Placed after the
    // inflict/repair reactive branches (those event triggers win if a text somehow carries
    // both; no corpus ship does). condition 'always' is a placeholder — the real gate is in
    // `conditions`.
    if (START_OF_TURN_CHARGE_RE.test(low) && AT_FULL_HP_RE.test(low)) {
        return {
            amount,
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
        };
    }

    // SP-C (Chakara): "If all damaged enemies have more Speed than this Unit, it adds 1 charge
    // to its Charged Skill" — an owner-vs-target stat-comparison gate on a self-charge-gain.
    // Same `conditions` escape hatch as the Cobalt start-of-turn branch above (condition:'always'
    // is a placeholder; the real gate rides `conditions`) — this avoids widening
    // `ConditionalCondition` (a closed union with no general stat-comparison member) for a gate
    // that already has a dedicated, richer `Condition` representation.
    const statVsTarget = statVsTargetConditionFromClause(low);
    if (statVsTarget) {
        return { amount, condition: 'always', derivable: true, conditions: [statVsTarget] };
    }

    // SP-D (Tygr): "If it damages 2 or more enemies, it adds 1 charge to its Charged Skill" —
    // a real hit-count gate on THIS cast's self-charge-gain. Same `conditions` escape hatch as
    // the Chakara branch above. Previously fell through to classifyChargeCondition's
    // 'enemy-adjacent' branch (a coarse presence-only proxy that never modeled the actual ≥N
    // threshold — removed there since this is now the sole route for that phrasing).
    const hitCount = hitCountConditionFromClause(low);
    if (hitCount) {
        return { amount, condition: 'always', derivable: true, conditions: [hitCount] };
    }

    const { condition, derivable, requiredEnemyType } = classifyChargeCondition(plain);
    return {
        amount,
        condition,
        derivable,
        ...(requiredEnemyType ? { requiredEnemyType } : {}),
    };
}

// Liberator (Phase 4b Task 10): an all-allies charge grant gated on the enemy's death —
// distinct from parseChargeGain's self-targeted contract (which disqualifies "all allies" /
// "when an enemy dies"). Two real phrasings:
//   • docs/ship-skills.csv: "When an enemy dies, all allies add N charge to their Charged Skills"
//   • an older in-game phrasing: "When an enemy dies, this unit grants N charge to all allies"
// Both forms appear within the same "when an enemy dies …" sentence (no '.' between). The two
// alternatives below cover "all allies add/gain N" and "grants N charge … all allies".
// Returns the per-ally charge amount, or null. Lookbehind-free.
const ALLY_CHARGE_ON_ENEMY_DEATH_RE =
    /when an enemy dies[^.]*?(?:all allies\s+(?:adds?|gains?)\s+(\d+|a|an)\s+charges?|(?:grants?|adds?|gives?)\s+(\d+|a|an)\s+charges?[^.]*?all allies)/i;

/** Parses Liberator's on-enemy-death "all allies add N charge" grant. Returns `{ amount }`
 *  (per-ally charge count) or null. The trigger is implicitly on-enemy-destroyed. */
export function parseAllyChargeOnEnemyDeath(
    text: string | null | undefined
): { amount: number } | null {
    if (!text) return null;
    const m = ALLY_CHARGE_ON_ENEMY_DEATH_RE.exec(stripUnitTags(text));
    if (!m) return null;
    const raw = (m[1] ?? m[2]).toLowerCase();
    const amount = raw === 'a' || raw === 'an' ? 1 : parseInt(raw, 10);
    if (!amount || isNaN(amount)) return null;
    return { amount };
}

// Hayyan / Graphite (enemy-team PR3): an all-allies charge-bar grant — distinct from
// parseChargeGain's self-targeted contract (which disqualifies "all allies" / "their
// charged skill" / "charged skill of all allies"). Two real phrasings:
//   • Hayyan (charged slot): "…and adds 1 charge to their Charged Skill." → on-cast, no condition.
//   • Graphite (third passive): "At the start of the round, if an enemy Unit has Stealth, this
//     Unit adds 1/2 charges to the charged skill of all allies within the active pattern."
//     → start-of-round, gated on enemy-has-Stealth.
// Tolerates the live CSV plural-with-1 typo ("adds 1 charges"). Reference: docs/ship-skills.csv.
// Lookbehind-free; matches both "to their Charged Skill" and "to the charged skill of all allies".
const ALLY_CHARGE_GRANT_RE =
    /(?:adds?|grants?|gives?)\s+(\d+|a|an)\s+charges?\s+to\s+(?:their\s+charged\s+skill|the\s+charged\s+skill\s+of\s+all\s+allies)/i;
// Graphite's gate: "if an enemy (Unit) has Stealth".
const ALLY_CHARGE_ENEMY_STEALTH_RE = /if\s+an\s+enemy\b[^.]*?\bhas\b[^.]*?\bStealth\b/i;
// Shared on-enemy-death phrasing. Used both to EXCLUDE Liberator's death-triggered grant
// from parseAllyChargeGrant (below) and to detect the on-enemy-destroyed extra-action trigger
// (EXTRA_ACTION_ENEMY_DESTROYED_RE, further down). Alternation order is irrelevant for .test().
const ENEMY_DEATH_PHRASING_RE = /when an enemy dies|upon a kill|killing an enemy/i;

// Death-triggered ally-charge grants are Liberator's domain (parseAllyChargeOnEnemyDeath +
// on-enemy-destroyed trigger). Liberator's text ("When an enemy dies, all allies add 1 charge
// to their Charged Skills") ALSO matches ALLY_CHARGE_GRANT_RE, so parseAllyChargeGrant must
// bail on the on-enemy-death phrasing to avoid a spurious second (on-cast) charge ability.

/**
 * Parses Hayyan's / Graphite's all-allies charge-bar grant. Returns the per-ally charge
 * amount, the trigger ('on-cast' for Hayyan, 'start-of-round' for Graphite — detected
 * directly via START_OF_ROUND_RE, NOT detectReactiveTrigger which is buff-name-scoped),
 * and a `conditions` array set when the grant is gated on an enemy having Stealth (Graphite) —
 * a derivable enemy-buff condition the emission site spreads directly (no re-hardcoded buffName).
 * Returns null when no ally-charge phrase matches — self-charge ships fall through to
 * parseChargeGain (whose CHARGE_DISQUALIFY_RE already rejects these ally phrasings).
 */
export function parseAllyChargeGrant(
    text: string | null | undefined
): { amount: number; trigger: 'on-cast' | 'start-of-round'; conditions?: Condition[] } | null {
    if (!text) return null;
    const plain = stripUnitTags(text);
    // Death-triggered grants (Liberator) belong to parseAllyChargeOnEnemyDeath /
    // on-enemy-destroyed — never claim them here, or we'd double-emit an on-cast grant.
    if (ENEMY_DEATH_PHRASING_RE.test(plain)) return null;
    const m = ALLY_CHARGE_GRANT_RE.exec(plain);
    if (!m) return null;
    const raw = m[1].toLowerCase();
    const amount = raw === 'a' || raw === 'an' ? 1 : parseInt(raw, 10);
    if (!amount || isNaN(amount)) return null;

    const trigger = START_OF_ROUND_RE.test(plain) ? 'start-of-round' : 'on-cast';
    const conditions: Condition[] = ALLY_CHARGE_ENEMY_STEALTH_RE.test(plain)
        ? [{ subject: 'enemy-buff', buffName: 'Stealth', derivable: true }]
        : [];
    return { amount, trigger, ...(conditions.length ? { conditions } : {}) };
}

// --- Extra actions ("extra End Of Round Action" / "extra action") --------------------

// Phrasings we deliberately DO NOT parse (annotation-only seams): purge-count (purges
// are not modeled — Tithonus stays disqualified). The on-kill / ally-destroyed phrasings
// are now MODELED as death-triggered extra actions (Phase 4b Task 10) — detected by
// EXTRA_ACTION_TRIGGER_RE below, NOT disqualified. The user can still add a disqualified
// ability manually in the editor. Reference: docs/ship-skills.csv (Sokol, Harvester, Tithonus).
const EXTRA_ACTION_DISQUALIFY_RE = /\bpurg/i;

// Death-trigger detection (Phase 4b Task 10) on the matched clause: an on-kill phrasing
// (Sokol "upon a kill", Liberator "when an enemy dies") → on-enemy-destroyed; an
// ally-destroyed phrasing (Harvester) → on-ally-destroyed. Default (no match) → on-cast.
const EXTRA_ACTION_ENEMY_DESTROYED_RE = ENEMY_DEATH_PHRASING_RE;
const EXTRA_ACTION_ALLY_DESTROYED_RE = /allied unit is destroyed|ally is destroyed/i;
// #361 (Prophet): "When this Unit resists a debuff infliction from an enemy, once per round, this
// Unit gains 1 extra action." Requires the SELF subject — an ally's resist grants Prophet shield
// penetration in a sibling clause and must not fire an action.
const EXTRA_ACTION_SELF_RESIST_RE = /\bwhen\s+this\s+unit\s+resists?\s+a\s+debuff\b/i;

// "gains/grants (itself) one|1|a|an extra (End Of Round) action" — incl. Tygr's
// imperative "give one extra action". Lookbehind-free.
const EXTRA_ACTION_RE =
    /\b(?:gains?|grants?|gives?)\s+(?:itself\s+)?(?:one|1|an?)\s+extra\s+(?:end\s+of\s+round\s+)?action\b/i;

// Tormenter: "If its HP is below 50%" — the unit's OWN HP (selfHpPct is fixed 100
// under DPS assumptions, so this correctly never fires until defense modeling lands).
const EXTRA_ACTION_SELF_HP_RE = /\b(?:its|this unit'?s?)\s+hp\s+is\s+below\s+(\d+)\s*%/i;

export interface ExtraActionParse {
    oncePerRound: boolean;
    conditions: Condition[];
    /** Reactive trigger detected from the clause. Death triggers (Phase 4b Task 10):
     *  on-enemy-destroyed (Sokol/Liberator on-kill) or on-ally-destroyed (Harvester).
     *  on-debuff-resisted (#361, Prophet): "when THIS UNIT resists a debuff infliction".
     *  Absent for the default on-cast grants (Nuqtu/Sustainer/Tormenter/Tygr) — the builder
     *  defaults those to on-cast. */
    trigger?: Extract<
        AbilityTrigger,
        'on-enemy-destroyed' | 'on-ally-destroyed' | 'on-debuff-resisted'
    >;
    /** "end of round" extra action (e.g. Harvester): the engine drains it AFTER all
     *  normal-pool actions for the round, regardless of speed-rank — not re-picked by
     *  speed. Default extra actions ("1 extra action", Liberator) stay speed-positioned. */
    endOfRound: boolean;
}

/**
 * Parses an extra-action grant from skill text (game rule: a full extra turn,
 * re-inserted into the round's turn queue by speed). Clause-scoped: condition and
 * once-per-round detection run on the ", and "-subclause containing the match, so a
 * disqualifying phrase in a DIFFERENT subclause (Liberator's "When an enemy dies, …,
 * and once per round, this unit gains 1 extra action") can't suppress the grant.
 * Returns null for the annotation-only phrasings (EXTRA_ACTION_DISQUALIFY_RE).
 * Reference data: docs/ship-skills.csv.
 */
export function parseExtraAction(text: string | null | undefined): ExtraActionParse | null {
    if (!text) return null;
    const rawPlain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    if (!EXTRA_ACTION_RE.test(rawPlain)) return null;
    const plain = maskAbbrev(rawPlain);
    const sentence = splitSentences(plain).find((s) => EXTRA_ACTION_RE.test(s)) ?? plain;
    const parts = sentence.split(/,\s+and\s+/i);
    // Assumes at most one subclause matches the grant pattern (true for all current texts);
    // if two matched, find() would take the first and oncePerRound could mis-scope.
    const clauseMasked = parts.find((p) => EXTRA_ACTION_RE.test(p)) ?? sentence;
    const clause = clauseMasked.split(ABBR_MARK).join(' ');
    if (EXTRA_ACTION_DISQUALIFY_RE.test(clause)) return null;

    const conditions: Condition[] = [];
    // Buff/debuff count gates: Nuqtu "If the target has 3 or more buffs" → enemy-buff
    // gte 3; Sustainer "If this Unit has no debuffs" → self-debuff eq 0.
    const countGate = countGateCondition(clause);
    if (countGate) conditions.push(countGate);
    const hpMatch = EXTRA_ACTION_SELF_HP_RE.exec(clause);
    if (hpMatch) {
        conditions.push({
            subject: 'hp-threshold',
            derivable: true,
            hpComparator: 'below',
            hpPercent: parseInt(hpMatch[1], 10),
            hpSubject: 'self',
        });
    }
    // Tygr: "After damaging an enemy affected by Stasis" — approximated as
    // enemy-has-any-debuff (enemy-debuff conditions are name-agnostic by design in
    // evaluateCondition — a buffName is not a filter there).
    if (/affected by stasis/i.test(clause)) {
        conditions.push({
            subject: 'enemy-debuff',
            derivable: true,
            countComparator: 'gte',
            countThreshold: 1,
        });
    }
    // Death trigger (Task 10): on-kill → on-enemy-destroyed; ally-destroyed → on-ally-destroyed;
    // no death phrasing → on-cast (trigger omitted; builder defaults). Detected on the FULL
    // SENTENCE, not the grant subclause: Liberator's death phrase ("When an enemy dies") sits in
    // a sibling subclause ("…, and once per round, this unit gains 1 extra action") and the
    // trigger scopes the whole sentence. (oncePerRound/conditions stay clause-scoped — they DO
    // belong to the grant subclause.) Sokol/Harvester carry the death phrase in the grant clause
    // itself, so sentence-level detection covers all three.
    const sentenceUnmasked = sentence.split(ABBR_MARK).join(' ');
    // #361: a grant gated on THIS UNIT resisting a debuff infliction (Prophet). Without this the
    // ternary fell through to the on-cast default and the ship took a free extra action every
    // round unconditionally — roughly doubling its output. Scoped to "this Unit resists" and NOT
    // the bare resist phrase: Prophet's own text carries a sibling "when an ALLY resists" clause
    // that grants shield penetration, and an ally's resist must never fire a self action. Only
    // Prophet's passive2/passive3 carry this phrasing in the corpus.
    const trigger: ExtraActionParse['trigger'] = EXTRA_ACTION_ENEMY_DESTROYED_RE.test(
        sentenceUnmasked
    )
        ? 'on-enemy-destroyed'
        : EXTRA_ACTION_ALLY_DESTROYED_RE.test(sentenceUnmasked)
          ? 'on-ally-destroyed'
          : EXTRA_ACTION_SELF_RESIST_RE.test(sentenceUnmasked)
            ? 'on-debuff-resisted'
            : undefined;
    return {
        oncePerRound: /once per round/i.test(clause),
        conditions,
        endOfRound: /end\s+of\s+round/i.test(clause),
        ...(trigger ? { trigger } : {}),
    };
}

/**
 * Harvester p2: "When an allied Unit is destroyed, this Unit gains 1 extra end of round action
 * AND Speed Up I for 6 turns" — parseExtraAction correctly resolves the extra-action grant to
 * on-ally-destroyed (sentence-level death-phrase detection), but the co-located Speed Up I buff
 * is a separate ability (a plain buff grant, not an extra-action) so it falls through to the
 * generic on-cast default. This detector lets a sibling buff sharing the SAME sentence as an
 * extra-action death phrase inherit that trigger.
 *
 * Deliberately gated on EXTRA_ACTION_RE (the "gains/grants/gives … extra … action" phrase)
 * FIRST, not just the bare death phrase: several unrelated ships (Butcher/Mangler/Ravager/
 * Asphyxiator's Overload — "gains 1 stack of Overload every turn and loses Overload upon
 * killing an enemy") share a sentence with a kill/death phrase but carry NO extra-action grant.
 * Without this gate, their co-located Overload buff would be wrongly co-triggered to
 * on-enemy-destroyed, breaking its every-turn accumulation (caught by overloadLifecycle.test.ts
 * during Wave 3 development). Requiring the extra-action phrase in the SAME sentence scopes this
 * to genuine extra-action-adjacent buffs (Harvester) only.
 *
 * Position/sentence-scoped via rawSentenceAround (same raw-text sentence bounds as
 * phrasePosTrigger) so an unrelated buff sitting in a DIFFERENT sentence is never co-triggered.
 * Reference data: docs/ship-skills.csv.
 */
export function detectExtraActionCoTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    if (!text) return undefined;
    const sentence = rawSentenceAround(text, anchorPos);
    if (!sentence || !EXTRA_ACTION_RE.test(sentence)) return undefined;
    return EXTRA_ACTION_ENEMY_DESTROYED_RE.test(sentence)
        ? 'on-enemy-destroyed'
        : EXTRA_ACTION_ALLY_DESTROYED_RE.test(sentence)
          ? 'on-ally-destroyed'
          : undefined;
}

// --- Healing-calculator parsers: heal / shield / cleanse -----------------------------
//
// These extract heal & shield grants (and cleanse counts) for the healing calculator.
// They are intentionally narrow: only on-cast, percentage-of-stat heals/shields are
// emitted. Damage-reactive amounts ("of the damage taken/dealt") and revive content
// ("revives with X%", "Cheat Death") are Phase-4 / reactive seams and emit nothing.
// Reference data: docs/ship-skills.csv.

export interface ParsedHealAbility {
    kind: 'heal' | 'shield';
    pct: number;
    basis: 'hp' | 'attack' | 'defense' | 'target-hp' | 'damage-dealt' | 'damage-taken';
    target: 'self' | 'ally' | 'all-allies' | 'lowest-hp-ally';
    // True when a target phrase was actually matched ("itself", "the ally", "all allies");
    // false when target defaulted to 'self' because the text named no recipient. The
    // slot/damage-aware bare-repair→ally FLIP in buildShipAbilities keys off this flag.
    explicitTarget: boolean;
    /** Valkyrie: leech scoped to Echoing Burst explosions (detonation credits only). */
    leechScope?: 'all' | 'detonation';
    /** Quixilver: damage-taken proc gated on shield punch-through. */
    requiresHpDamage?: boolean;
    /** Present when the heal is a damage reaction ("when directly damaged", "when
     *  attacked", "when (critically) hit"). buildShipAbilities maps it to trigger
     *  'on-attacked' — or 'on-ally-attacked' when `allySubject` is set — plus
     *  triggerCritFilter / a derivable self hp-threshold. May be present-but-empty:
     *  an empty object signals an ungated self reaction (Heliodor first-listed
     *  passive, Warden). */
    damageReaction?: {
        critFilter?: 'crit' | 'non-crit';
        hpBelowPct?: number;
        /** True when the damaged unit is an ALLY ("when an(other) ally is directly
         *  damaged", Cultivator's 8% repair) rather than this unit — routes to
         *  on-ally-attacked. Only PASSIVE-voice ally shapes set this; ally-OUTGOING
         *  sentences (Crocus "when another ally inflicts a DoT … with a critical
         *  hit") never match HEAL_DAMAGE_REACTION_RE and stay unannotated.
         *  NOTE: no roleFilter channel here (asymmetry vs the buff/debuff detector)
         *  — a role-filtered reaction HEAL would parse unfiltered and over-fire;
         *  no corpus ship needs it (Graphite's role-filtered payload is a buff).
         *  Add the channel if such a ship ever appears. */
        allySubject?: boolean;
    };
    /** Phase 3 PR-H: this specific repair match is the reactive component of an own-cleanse
     *  sentence ("when this Unit cleanses a Debuff, it ALSO repairs that ally" / "…every turn
     *  and, upon Cleansing a Debuff, repairs an ADDITIONAL 5%…"). buildShipAbilities maps it to
     *  trigger 'on-own-cleanse'. A PARSER-level (match-position-relative) annotation rather than
     *  a position-scoped detector call in buildShipAbilities — Morao's sentence carries TWO
     *  same-pct repair matches ("repairs 5% … every turn" AND "repairs an additional 5%
     *  … upon Cleansing"), and buildShipAbilities' shared healTagPos anchor (keyed only on pct)
     *  collapses both onto the FIRST occurrence, so a sentence-scoped phrasePosTrigger detector
     *  would incorrectly promote the "every turn" heal too. Set only when THIS match's own
     *  position (m.index, known precisely here) falls AFTER the cleanse-trigger phrase within the
     *  sentence — mirrors the instead-on-crit split's inInstead position comparison. */
    ownCleanseReaction?: true;
    /** PR6b: per-count repair scaling — the repair grows by `perUnit`% per matched `condition`
     *  count (Oleander "additional 8.5% repair for each debuffed enemy" → base kept + perUnit
     *  bonus; Meatshield "repairs 1.5% … for each debuff on itself" → pure per-count, `pct` is
     *  zeroed and the whole repair is the perUnit scaling). The `condition`-based (live-state)
     *  form is model fidelity only — no DPS/sim consumer. ship-kit W3 adds the `countSource`
     *  form (Sansi "repairs 5% for every enemy repaired"): the count comes from the reactive
     *  event, `pct` is KEPT, and the reactive heal executor multiplies it by that count. */
    scaling?: { perUnit: number; condition?: Condition; countSource?: ReactiveScalingCountSource };
    /** ship-kit W3 (Sansi "limited to 3 times per Round"): a numeric per-round cap on how many
     *  times the reactive heal may fire each round. buildShipAbilities threads it to
     *  Ability.maxPerRound (enforced executor-side). Absent → no per-round limit. */
    maxPerRound?: number;
}

// Clause-scoping helper mirroring buildShipAbilities.sentenceContaining: the sentence
// containing `index`, with boundaries at `.`/`;` followed by whitespace or end-of-string
// (so decimals like "7.5" and abbreviation periods are NOT split). NO lookbehind — the
// boundary lookahead `(?=\s|$)` is safe on iOS Safari 15.
function sentenceAround(plain: string, index: number): string {
    return sentenceBoundsAround(plain, index).text;
}

// Like sentenceAround but also returns the start offset within `plain`, so callers can
// compute a match's position within its sentence (needed to scope basis resolution and
// continuation scans to the sentence tail from the match onward).
function sentenceBoundsAround(
    plain: string,
    index: number
): { start: number; end: number; text: string } {
    const boundary = /[.;](?=\s|$)/g;
    let start = 0;
    let end = plain.length;
    let m: RegExpExecArray | null;
    while ((m = boundary.exec(plain)) !== null) {
        if (m.index < index) start = m.index + 1;
        else {
            end = m.index + 1;
            break;
        }
    }
    return { start, end, text: plain.slice(start, end) };
}

// Phase-4 / reactive disqualifiers — clause-scoped. Damage-leech phrases ("of the
// damage taken/dealt") are PARSED (basis 'damage-dealt'/'damage-taken'); revive content
// and enemy-action reactions ("when an enemy uses ...") stay out.
//
// UNMODELED reactive triggers (no live engine listener yet — they go live via Phase 4b/4c)
// are disqualified here so a gated heal is NOT emitted as an UNCONDITIONAL on-cast heal that
// would fire EVERY round (phantom healing). Two groups:
//   (1) Always-disqualify, regardless of heal basis:
//       - on-destroyed / death: "when … is destroyed" (EXCEPT the Salvation all-allies
//         repair shape — see the Task 9 lookahead + note below), "when destroyed", "upon
//         being destroyed", "on death"; on-kill: "when it destroys [an enemy]".
//       - on-buff-purged: "when a buff is purged", "when … is purged".
//       - reactive on-cleansed (PASSIVE form only): "when … is cleansed". The ACTIVE verb
//         "cleanses"/"repairs" (Makoli/Morao/Cultivator active cleanse+repair) is NOT matched.
//   (2) Damage-reaction (on-directly-damaged / attacked / takes-damage / is-hit) — no longer
//       disqualified at all (Phase 4c): plain-stat reaction heals parse with a `damageReaction`
//       annotation (self- AND ally-subject — see the annotation gate in parseHealAbilities),
//       while leech reactions (Cultivator/Malvex/Isha "repairs X% of the damage taken/dealt")
//       parse WITHOUT it (modeled via the engine's per-attack proc). The annotation gate is
//       gated against `leechBasis` (see usage below).
// NO lookbehind (iOS Safari 15) — all alternations use plain `\b`/word-boundary anchors.
// `\bcheat death\b(?!\s+activates)` (Task 8): a heal sentence merely MENTIONING Cheat Death
// stays disqualified (unmodeled revive/grant content), but Yazid's MODELED follow-on — "when
// Cheat Death activates, this Unit repairs itself for 60% …" — is exempt so its 60% repair
// parses (and rides the on-cheat-death-activated reactive trigger). Negative LOOKAHEAD only
// (lookbehind is banned for iOS Safari 15).
// `when\b(?!…SELF is destroyed…repairs…all allies)[^.;]*\bis\s+destroyed\b` (Task 9): an "is
// destroyed" sentence stays disqualified UNLESS it is Salvation's MODELED on-destroyed ally-heal —
// "when this Unit is destroyed it repairs X% … to all allies" — which now parses and rides the
// on-destroyed reactive trigger (a live trigger via Phase 4b). The negative lookahead exempts ONLY
// the SELF-destruction repair-to-all-allies shape (kept ALIGNED with DESTROYED_ALLY_REPAIR_RE via
// SELF_DESTROYED_RE_SRC), so a hypothetical ally-death heal ("when an ALLY is destroyed, repairs
// all allies") stays disqualified here (it never routes to on-destroyed), alongside the on-kill
// ("when it destroys an enemy"), on-buff-purged, and reactive-cleansed heals. Negative LOOKAHEAD
// only (no lookbehind — iOS Safari 15).
const HEAL_DISQUALIFY_RE = new RegExp(
    '\\brevives?\\b|\\bcheat death\\b(?!\\s+activates)|when an enemy uses|' +
        `when\\b(?!${SELF_DESTROYED_ALL_ALLIES_TAIL_SRC})[^.;]*\\bis\\s+destroyed\\b|` +
        // C2b-1 T5: exempt "when a buff is purged from an ally" (Salvation 5% ally-heal is now
        // live via on-ally-purged). Both the specific form ("when a buff is purged") and the
        // general "is purged" form carry a lookahead to allow through the ally-recipient shape.
        // detectAllyPurgedTrigger stamps the correct trigger. Other purge shapes stay disqualified.
        'when\\s+destroyed\\b|upon\\s+being\\s+destroyed\\b|\\bon\\s+death\\b|when\\s+it\\s+destroys\\b|when\\s+a\\s+buff\\s+is\\s+purged\\b(?![^.;]*\\bfrom\\s+an?\\s+ally\\b)|when\\b[^.;]*\\bis\\s+purged\\b(?![^.;]*\\bfrom\\s+an?\\s+ally\\b)|when\\b[^.;]*\\bis\\s+cleansed\\b',
    'i'
);
// Damage-reaction reactive triggers — only disqualifying when the heal is NOT a damage leech
// (the caller gates this against the resolved leech basis). Covers "when (an ally/this unit is)
// directly damaged", "when attacked", "when … is hit", "when … takes … damage", and the
// passive-voice pure crit-hit form "when (this unit) is critically hit" (tolerates the corpus
// typo "criticall"). The match is captured (not just tested) so the caller can reject an
// ENEMY-subject trigger — "when an enemy takes damage from a DoT" (Anemone) is an on-DoT-tick
// trigger, NOT a self/ally damage reaction, so it must not be disqualified by this rule.
// The crit-hit alternation uses `hit\b` (no trailing `s`) so it matches passive-voice "is
// critically hit" but NOT the active-voice ally form "when an ally critically hits an enemy"
// — every alternation here is a PASSIVE-voice damage shape, which is what makes the
// annotation gate's ally-subject test on dmgReaction[0] safe (ally-OUTGOING sentences like
// Crocus's "inflicts a DoT … with a critical hit" never match). No lookbehind (iOS Safari 15).
const HEAL_DAMAGE_REACTION_RE =
    /when\b[^.;]*\b(?:directly\s+)?damaged\b|when\s+attacked\b|when\b[^.;]*\bis\s+attacked\b|when\b[^.;]*\bis\s+criticall?y?\s+hit\b|when\b[^.;]*\bis\s+hit\b|when\b[^.;]*\btakes\b[^.;]*\bdamage\b/i;
// Detects the crit-hit alternation within a HEAL_DAMAGE_REACTION_RE match so the annotation
// gate can set critFilter:'crit' when the trigger itself (not an instead-clause) is the pure
// "when (this unit) is critically hit" phrasing.
const HEAL_CRIT_HIT_TRIGGER_RE = /\bis\s+criticall?y?\s+hit\b/i;

/**
 * Neutralises the word "repair" where it is part of a <unit-skill> STATUS NAME rather than a repair
 * verb, so HEAL_REPAIR_RE cannot anchor on it (#362).
 *
 * HEAL_REPAIR_RE is /\brepairs?\b[^%.;]*?(\d+(?:\.\d+)?)\s*%/gi. `parseHealAbilities` strips unit
 * tags BEFORE scanning, so by the time the regex runs a status name is indistinguishable from a
 * verb — and the lazy `[^%.;]*?` then walks across the (now-gone) tag boundary to whatever
 * percentage comes next in the sentence. Zosimos's charged skill ("inflicts Reversed Repairs for 1
 * turn and deals 300% damage") fabricated a heal for 300% of max HP that way.
 *
 * Masking is done on the ORIGINAL tagged text, which is the only place the boundary still exists.
 * The corpus has 9 distinct repair-bearing status names over 24 occurrences (Inc. Repair Down
 * I/II/III, Out. Repair Down II, Inc. Repair Up III, Repair Over Time I/II/III, Reversed Repairs),
 * so this closes a family rather than one row — only Zosimos happens to have a percentage inside
 * the no-'.'-no-';' window today.
 *
 * A status name can never BE the repair verb, so nothing legitimate is suppressed: a real repair
 * verb always sits outside the <unit-skill> tag and is left untouched. "Renewal" is chosen because
 * no other pattern in this file matches it.
 */
function maskStatusNameRepairs(text: string): string {
    return text.replace(/<unit-skill>(.*?)<\/unit-skill>/g, (whole, name: string) =>
        whole.replace(
            name,
            name.replace(/\brepair(s?)\b/gi, (_m, plural: string) => `Renewal${plural}`)
        )
    );
}

// Repair amount: "repairs ... N%" or "repair N%" (caster heal). The `[^%]*?` between
// the verb and the percentage tolerates interleaved recipients ("repairs the ally for 4%").
const HEAL_REPAIR_RE = /\brepairs?\b[^%.;]*?(\d+(?:\.\d+)?)\s*%/gi;
// Shield amount: "Shield equal to N%".
const HEAL_SHIELD_RE = /\bshield\s+equal\s+to\s+(\d+(?:\.\d+)?)\s*%/gi;
// Pallas: "heals for 20% of the damage dealt" — the 'heals' verb is parsed ONLY when
// followed by a leech tail (no general heals-verb support; avoids false positives).
const LEECH_HEAL_VERB_RE =
    /\bheals?\s+for\s+(\d+(?:\.\d+)?)\s*%\s*of\s+(?:the\s+)?damage\s+dealt/gi;
// A multi-component continuation: "with an additional repair/amount equal to N% of its Defense".
const HEAL_ADDITIONAL_RE =
    /an?\s+additional\s+(?:repair|amount)\s+equal\s+to\s+(\d+(?:\.\d+)?)\s*%\s*of\s+(?:its|this\s+unit'?s)\s+(hp|max\s*hp|attack|defense)/gi;

// Leech basis from the sentence tail after the match. ORDER MATTERS: "damage dealt
// to them/this unit" (Malvex) is damage TAKEN and must be tested before the generic
// damage-dealt phrasing. No lookbehind (iOS Safari 15).
function resolveLeechBasis(after: string): 'damage-dealt' | 'damage-taken' | undefined {
    if (/of\s+the\s+damage\s+taken|damage\s+dealt\s+to\s+(?:them|this\s+unit)/i.test(after)) {
        return 'damage-taken';
    }
    if (/of\s+(?:the\s+)?damage\s+(?:dealt|it\s+deals)/i.test(after)) return 'damage-dealt';
    return undefined;
}

/**
 * Resolves the stat basis from the prose of the match's own sentence. Looks for
 * "of <its|their> <stat>" within the sentence-scoped slice after the match position.
 * "their Max HP" → target-hp (the recipient's HP, not the caster's). Defaults to 'hp'.
 * The caller must pass the sentence-scoped tail (not the whole remaining text) so that
 * a stat phrase in a later sentence does not pollute the result.
 */
function resolveHealBasis(after: string): ParsedHealAbility['basis'] {
    const m = /of\s+(its|this\s+unit'?s|their|the\s+ally'?s)\s+(max\s*hp|hp|attack|defense)/i.exec(
        after
    );
    if (!m) return 'hp';
    const owner = m[1].toLowerCase();
    const stat = m[2].toLowerCase().replace(/\s+/g, '');
    const recipientOwned = owner === 'their' || owner.startsWith('the ally');
    if (stat === 'attack') return 'attack';
    if (stat === 'defense') return 'defense';
    // HP basis: recipient-owned HP ("their Max HP") is target-hp; caster HP is 'hp'.
    return recipientOwned ? 'target-hp' : 'hp';
}

/**
 * Resolves heal/shield target from the scoped sentence. "itself"/"its" with no other
 * recipient → self; explicit plural phrases ("all allies", "allies") → all-allies; a recipient
 * NAMED by live HP ("most missing health", "lowest current health percentage", "the other
 * ally") → lowest-hp-ally; any other singular ally recipient ("the ally", "that ally",
 * "them") → ally.
 * Note: "their" alone is NOT treated as all-allies — it may refer to a single named
 * ally's stat (e.g. "the ally … of their Max HP"). Only explicit plural noun phrases
 * trigger all-allies so that singular-ally phrasings aren't misrouted.
 * Defaults to self.
 */
function resolveHealTarget(sentence: string): {
    target: ParsedHealAbility['target'];
    explicit: boolean;
} {
    const s = sentence.toLowerCase();
    // "them" whose antecedent is an explicit "all allies" EARLIER in the sentence
    // (Heliodor second-listed passive: "Debuffs on all allies by 1 turn and repairs
    // them for 8%") → the pronoun is plural → all-allies. Checked first because the
    // singular rule below would otherwise capture the bare \bthem\b.
    if (/\ball\s+allies\b[^.;]*\bthem\b/.test(s)) return { target: 'all-allies', explicit: true };
    // Rikra: "... for each enemy Unit destroyed by the attack upon killing them" — this
    // "them" refers back to the slain ENEMY units (the heal is a bare self-repair keyed by
    // kill count), not a heal recipient. Strip that antecedent before testing the generic
    // \bthem\b ally signal below so it isn't misread as an ally recipient (Finding B2).
    const sWithoutKillAntecedent = s.replace(/\b(?:killing|destroying)\s+them\b/g, '');
    // SP-4e: the text NAMES its recipient by live HP — Pallas ("the other ally with the lowest
    // current health percentage"), Volk ("the ally with the most missing health"), Valkyrie ("the
    // ally with the lowest current health percentage"). One selector covers all three: "most
    // missing health" is loose phrasing for lowest HP PERCENTAGE, not absolute missing HP
    // (user-confirmed 2026-08-20) — do NOT model an absolute basis.
    // Tested BEFORE the generic singular arm below, because Pallas's sentence matches both.
    // Sentence-scoped by the caller, which is the only thing keeping Chimei's over-repair
    // sentence ("the ally with the lowest current health percentage repairs an amount equivalent
    // to the over-repair" — a different, unimplemented mechanic) out of this arm.
    // NOT load-bearing on today's corpus: the third alternative (`the other ally`) is redundant,
    // because Pallas — the only ship whose text says it — also carries "lowest current health",
    // which the second alternative already matches. It stays as the brief prescribed it, but a
    // future "the other ally" with NO HP phrase would route here rather than to an arbitrary ally,
    // which is a widening to weigh at that point (the inventory gate in
    // `abilities/__tests__/lowestHpAllySelector.test.ts` is what surfaces it).
    if (
        /most\s+missing\s+health|lowest\s+current\s+health(?:\s+percentage)?|\bthe\s+other\s+ally\b/.test(
            sWithoutKillAntecedent
        )
    )
        return { target: 'lowest-hp-ally', explicit: true };
    // Singular ally detection takes priority over the bare "their" heuristic so that
    // "Repairs the ally for 8% of their Max HP" correctly routes to ally, not all-allies.
    if (/\bthe\s+ally\b|\bthat\s+ally\b|\ban\s+ally\b|\bthem\b/.test(sWithoutKillAntecedent))
        return { target: 'ally', explicit: true };
    if (/\ball\s+allies\b|\ballies\b/.test(s)) return { target: 'all-allies', explicit: true };
    // "itself" (or "to/from this unit") is an explicit self RECIPIENT. A bare leading subject
    // ("This Unit repairs 27% …") names no recipient and is the bare default (explicit: false) —
    // the signal the buildShipAbilities flip keys off. Mirrors parseCleanse's self detection.
    if (/\bitself\b|(?:from|to)\s+this\s+unit\b/.test(s)) return { target: 'self', explicit: true };
    return { target: 'self', explicit: false };
}

/**
 * Parses on-cast heal and shield grants from skill text. Walks every repair/shield match,
 * emitting one entry per match (plus a continuation entry for multi-component heals). Each
 * match's target/basis/disqualify guards are scoped to the sentence around the match, so a
 * damage-reactive or revive clause elsewhere in the same skill doesn't suppress a real heal.
 * Reference data: docs/ship-skills.csv.
 */
// Maps a heal "for each <phrase>" count to a model Condition (derivable counts only).
function mapHealCountPhrase(phrase: string): Condition | null {
    const p = phrase.toLowerCase();
    // Order: "debuff" contains "buff"; enemy phrasings before self.
    if (/debuffed\s+enem|debuff on (?:the\s+)?enem/.test(p))
        return { subject: 'enemy-debuff', derivable: true };
    if (/debuff on (?:this unit|itself|it)\b/.test(p))
        return { subject: 'self-debuff', derivable: true };
    return null;
}

/**
 * Per-count repair scaling within a heal sentence. Two shapes:
 *  - "additional X% repair for each <count>" (Oleander) → a bonus ON TOP of the base repair
 *    (`zeroBase: false`).
 *  - base "repairs X% … for each <count>" with no "additional" (Meatshield) → the base repair
 *    is ITSELF per-count, so the caller zeroes `pct` and the whole repair is the scaling
 *    (`zeroBase: true`, perUnit = the base pct).
 * Returns null when no recognized per-count repair phrase is present.
 */
function parseHealCountScaling(
    sentence: string,
    basePct: number
): { perUnit: number; condition: Condition; zeroBase: boolean } | null {
    const add = /\badditional\s+(\d+(?:\.\d+)?)\s*%\s*repair[^.]*?\bfor each\s+([^.,;<]+)/i.exec(
        sentence
    );
    if (add) {
        const condition = mapHealCountPhrase(add[2]);
        if (condition) return { perUnit: parseFloat(add[1]), condition, zeroBase: false };
    }
    const each = /\bfor each\s+([^.,;<]+)/i.exec(sentence);
    if (each) {
        const condition = mapHealCountPhrase(each[1]);
        if (condition) return { perUnit: basePct, condition, zeroBase: true };
    }
    return null;
}

// ship-kit W3 (Sansi): reactive event-count repair scaling — "repairs 5% FOR EVERY enemy
// repaired". The count is the number of enemies repaired by the triggering event
// (eventCtx.repairedEnemyIds.length), NOT a live-state Condition, so this is distinct from
// parseHealCountScaling's "for each <live count>" form above. `pct` is KEPT (the per-unit rate);
// the reactive heal executor multiplies it by the event count.
const REPAIRED_ENEMY_COUNT_RE = /\bfor every enemy repaired\b/i;
// ship-kit W3 (Hemlock, Task 9): reactive event-count repair scaling — "repairs 5% … PER enemy
// affected". The count is the number of adjacent allies a Corrosion spread landed Corrosion I on
// (eventCtx.spreadAffectedIds.length), stamped by the on-corrosion-spread listener. Same primitive
// as Sansi's above; `pct` is KEPT (the per-unit rate) and the executor multiplies it by the count.
const SPREAD_AFFECTED_COUNT_RE = /\bper enemy affected\b/i;
// ship-kit W3 (Sansi): numeric per-round cap — "limited to 3 times per Round". Generalizes the
// boolean once-per-round caps. Threaded to Ability.maxPerRound and enforced executor-side.
const MAX_PER_ROUND_RE = /\blimited to\s+(\d+)\s+times?\s+per\s+round\b/i;

/** Reactive event-count repair scaling in a heal sentence (Sansi). Returns the countSource + the
 *  per-unit rate (== the base pct) when present, else null. Only plain on-cast repairs (no
 *  leech/damage-reaction) carry it — mirrors parseHealCountScaling's gating in the caller. */
function parseHealEventCountScaling(
    sentence: string,
    basePct: number
): { perUnit: number; countSource: ReactiveScalingCountSource } | null {
    if (REPAIRED_ENEMY_COUNT_RE.test(sentence))
        return { perUnit: basePct, countSource: 'repaired-enemy-count' };
    // ship-kit W3 (Hemlock): "per enemy affected" — the Corrosion-spread affected-count source.
    if (SPREAD_AFFECTED_COUNT_RE.test(sentence))
        return { perUnit: basePct, countSource: 'spread-affected-count' };
    return null;
}

export function parseHealAbilities(text: string | null | undefined): ParsedHealAbility[] {
    if (!text) return [];
    // Mask repair-bearing STATUS NAMES before the tags are stripped — see maskStatusNameRepairs
    // (#362). `plain` is local to this function, so the substitution cannot leak into buff-name
    // parsing, which reads the untouched text via parseSkillEffects.
    const plain = stripUnitTags(maskStatusNameRepairs(text)).replace(/<br\s*\/?>/gi, '. ');
    const results: ParsedHealAbility[] = [];

    const emit = (kind: ParsedHealAbility['kind'], re: RegExp): void => {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(plain)) !== null) {
            const pct = parseFloat(m[1]);
            if (isNaN(pct)) continue;
            // A "repair … equal to N%" match is a multi-component continuation handled
            // below by HEAL_ADDITIONAL_RE inheriting the primary's target — skip it here so
            // it isn't double-counted (and so it doesn't inherit the wrong target/basis).
            if (kind === 'heal' && /equal\s+to/i.test(m[0])) continue;
            // Madax (ship-kit W8 Task 9): "…receives 30% more Repairs and increases that
            // Supporter's Defense by 20% of this Unit's Defense" — HEAL_REPAIR_RE's lazy
            // `[^%.;]*?` walk matches the NOUN "Repairs" (not the repair verb) and, finding no
            // period/semicolon before the next '%', walks straight past the intervening
            // "increases <role>'s <stat> by" clause to that UNRELATED grant's own "20%",
            // fabricating a phantom self-heal (basis 'defense', pct 20). That clause is a
            // stat GRANT to the adjacent Supporter ally, not a repair amount — parsed
            // separately by PRE_COMBAT_ROLE_GATE_DONOR_STAT_RE below. Reject any repair match
            // whose captured percentage belongs to this "increases <owner>'s <stat> by N%"
            // shape rather than a genuine repair amount.
            if (/\bincreases\b[^%.;]*'s\b[^%.;]*\bby\b/i.test(m[0])) continue;
            // Quixilver: "if it has shield equal to 100% of its max HP" is a THRESHOLD
            // CONDITION gating a Barrier grant elsewhere in the sentence, not a shield GRANT
            // itself — every real shield grant in the corpus is phrased "gains/grants Shield
            // equal to N%" (verified against docs/ship-skills.csv), never "has Shield equal
            // to". Skip a match whose immediately preceding word is "has" so this condition
            // phrasing doesn't fabricate a phantom shield-grant ability (Finding B1).
            if (
                kind === 'shield' &&
                /\bhas\s*$/i.test(plain.slice(Math.max(0, m.index - 20), m.index))
            )
                continue;
            const { start: sentenceStart, text: sentence } = sentenceBoundsAround(plain, m.index);
            if (HEAL_DISQUALIFY_RE.test(sentence)) continue;
            // Scope both basis resolution and the continuation scan to the match's own
            // sentence so that a stat phrase or "additional repair" in a LATER sentence
            // cannot pollute this match's result (Issues 1 & 2). `basisScope` is the
            // portion of the sentence from the match's position onward so `resolveHealBasis`
            // finds the nearest stat phrase rather than one from a different sentence.
            const basisScope = sentence.slice(m.index - sentenceStart);
            const leechBasis = resolveLeechBasis(basisScope);
            const resolved = resolveHealTarget(sentence);
            // Damage-reaction reactive triggers ("when … directly damaged", "when attacked",
            // "when … is hit", "when … takes … damage") on PLAIN heals — Phase 4c: BOTH
            // subjects are now MODELED (on-attacked and on-ally-attacked are live triggers)
            // and parse with a `damageReaction` annotation. SELF-subject reactions (PR 1,
            // Makoli/Guardian/Isha/Warden/Heliodor) annotate as before; ALLY-subject
            // reactions ("when an(other) ally is directly damaged", Cultivator's 8% repair)
            // additionally set `allySubject: true` so buildShipAbilities routes them to
            // on-ally-attacked (Task 9). Non-self heal RECIPIENTS no longer disqualify
            // either — Heliodor's second-listed passive ("when directly damaged … repairs
            // them [all allies]") is a self trigger healing all-allies. The subject test
            // runs on the MATCHED reaction phrase (dmgReaction[0]), which is by construction
            // a PASSIVE-voice damage shape — HEAL_DAMAGE_REACTION_RE has no active-voice
            // alternation, so ally-OUTGOING sentences (Crocus "when another ally inflicts
            // a DoT … WITH a critical hit", Hermes-family "when an ally critically hits an
            // enemy") never reach this gate and keep parsing as plain on-cast heals — the
            // same passive-voice discipline as the detector's DR_ALLY_CRIT_HIT_RE. Leech
            // reactions (basis 'damage-taken'/'damage-dealt') ARE modeled via the engine's
            // per-attack proc and keep parsing WITHOUT the annotation (guard #1). An
            // ENEMY-subject trigger ("when an enemy takes damage from a DoT", Anemone) is
            // an on-DoT-tick trigger, not a self/ally damage reaction, so it is neither
            // disqualified nor annotated.
            let damageReaction: ParsedHealAbility['damageReaction'];
            if (!leechBasis) {
                const dmgReaction = HEAL_DAMAGE_REACTION_RE.exec(sentence);
                if (dmgReaction && !/\benem(?:y|ies)\b/i.test(dmgReaction[0])) {
                    const allySubject = DR_ALLY_SUBJECT_RE.test(dmgReaction[0]);
                    // "while below N% HP" reads the OWNER's HP — never applied to
                    // ally-subject reactions (same rule as the detector; no corpus
                    // ally-reaction carries an HP gate).
                    const hpGate = allySubject
                        ? null
                        : /while\s+below\s+(\d+)\s*%\s*hp/i.exec(sentence);
                    // Instead-on-crit split (Isha): a sentence with "but when critical(ly)
                    // hit, it instead" carries TWO repair matches — the one INSIDE the
                    // instead-clause gets critFilter 'crit', the base match 'non-crit'
                    // (mutually exclusive pair; the missing "y" in the live CSV text —
                    // "criticall hit" — is tolerated). Isha's sentence always matches the
                    // "directly damaged" alternation FIRST (it precedes the crit-hit
                    // alternation in HEAL_DAMAGE_REACTION_RE), so the instead-clause
                    // handling takes precedence and the crit-hit-trigger branch below is
                    // never reached for Isha.
                    const insteadClause =
                        /but\s+when\s+criticall?y?\s+hit\b[^.;]*\binstead\b/i.exec(sentence);
                    const inInstead =
                        insteadClause !== null && m.index - sentenceStart > insteadClause.index;
                    // Pure crit-hit trigger ("when this unit is critically hit, repairs N%"):
                    // the matched trigger phrase is the crit-hit alternation and there is no
                    // instead-clause — annotate critFilter:'crit' directly.
                    const isCritHitTrigger =
                        !insteadClause && HEAL_CRIT_HIT_TRIGGER_RE.test(dmgReaction[0]);
                    const critFilter = insteadClause
                        ? inInstead
                            ? ('crit' as const)
                            : ('non-crit' as const)
                        : isCritHitTrigger
                          ? ('crit' as const)
                          : undefined;
                    damageReaction = {
                        ...(allySubject ? { allySubject: true } : {}),
                        ...(critFilter ? { critFilter } : {}),
                        ...(hpGate ? { hpBelowPct: parseInt(hpGate[1], 10) } : {}),
                    };
                }
            }
            // Phase 3 PR-H: own-cleanse reactive annotation (Cultivator/Morao). Gated the same as
            // damageReaction (no leech, no damage-reaction) — no corpus row combines an own-cleanse
            // repair with either. Position-relative (not sentence-only) — see
            // ParsedHealAbility.ownCleanseReaction's doc comment for why Morao needs this instead
            // of a plain position-scoped detector: only the match whose OWN position (m.index)
            // falls AFTER the cleanse-trigger phrase's own position is the reactive one.
            let ownCleanseReaction: true | undefined;
            if (!leechBasis && !damageReaction) {
                const cleanseTriggerMatch = OWN_CLEANSE_TRIGGER_RE.exec(sentence);
                if (cleanseTriggerMatch && m.index - sentenceStart > cleanseTriggerMatch.index) {
                    ownCleanseReaction = true;
                }
            }
            const rawBasis = leechBasis ?? resolveHealBasis(basisScope);
            // Damage-taken procs always shield/heal the damaged unit ITSELF — "them" in
            // "Damage dealt to them" refers back to this Unit, so the \bthem\b ally rule
            // must not apply (Malvex).
            const target = leechBasis === 'damage-taken' ? 'self' : resolved.target;
            // "their Max HP" → target-hp, but on a SELF grant "their" is the singular-they
            // referring back to "This Unit" (APEX: "This Unit gains a Shield … of their Max
            // HP"). Recipient == caster, so normalize to the caster-owned 'hp' basis (the two
            // are behaviourally identical for self, and 'hp' is the canonical self basis).
            const basis = rawBasis === 'target-hp' && target === 'self' ? 'hp' : rawBasis;
            const explicitTarget = leechBasis === 'damage-taken' ? true : resolved.explicit;
            // Deliberately tested against the WHOLE sentence (not basisScope): trailing-clause
            // phrases like Quixilver's "when taking HP damage…" sit AFTER the match, so the
            // basisScope tail discipline that protects basis resolution doesn't apply here.
            const leechScope: ParsedHealAbility['leechScope'] =
                leechBasis === 'damage-dealt' && /echoing\s+burst\s+explodes/i.test(sentence)
                    ? 'detonation'
                    : undefined;
            const requiresHpDamage =
                leechBasis === 'damage-taken' &&
                /when\s+taking\s+hp\s+damage\s+and\s+still\s+having\s+shield/i.test(sentence)
                    ? true
                    : undefined;
            // PR6b: per-count repair scaling (Oleander/Meatshield). Only plain on-cast repairs
            // (no leech/damage-reaction) carry it. A "pure per-count" base (Meatshield) zeroes
            // pct so the whole repair is the scaling bonus (base + perUnit×count convention).
            const countScaling =
                kind === 'heal' && !leechBasis && !damageReaction
                    ? parseHealCountScaling(sentence, pct)
                    : null;
            // ship-kit W3 (Sansi): reactive event-count scaling ("for every enemy repaired") takes
            // precedence over the live-state "for each" form when both somehow matched — Sansi
            // carries only the former. Same gating (plain on-cast repairs only).
            const eventCountScaling =
                kind === 'heal' && !leechBasis && !damageReaction && !countScaling
                    ? parseHealEventCountScaling(sentence, pct)
                    : null;
            // ship-kit W3 (Sansi): numeric per-round cap ("limited to N times per Round").
            const maxPerRoundMatch = MAX_PER_ROUND_RE.exec(sentence);
            const maxPerRound = maxPerRoundMatch ? parseInt(maxPerRoundMatch[1], 10) : undefined;
            results.push({
                kind,
                pct: countScaling?.zeroBase ? 0 : pct,
                basis,
                target,
                explicitTarget,
                ...(leechScope ? { leechScope } : {}),
                ...(requiresHpDamage ? { requiresHpDamage } : {}),
                ...(damageReaction ? { damageReaction } : {}),
                ...(ownCleanseReaction ? { ownCleanseReaction } : {}),
                ...(countScaling
                    ? {
                          scaling: {
                              perUnit: countScaling.perUnit,
                              condition: countScaling.condition,
                          },
                      }
                    : eventCountScaling
                      ? {
                            scaling: {
                                perUnit: eventCountScaling.perUnit,
                                countSource: eventCountScaling.countSource,
                            },
                        }
                      : {}),
                ...(maxPerRound !== undefined ? { maxPerRound } : {}),
            });
            // Valkyrie: "this Unit and the ally with the lowest ..." — dual recipient → emit a
            // second SELF entry mirroring the first (5% each, same basis/scope).
            if (leechBasis && /\bthis\s+unit\s+and\s+the\s+ally\b/i.test(sentence)) {
                results.push({
                    kind,
                    pct,
                    basis,
                    target: 'self',
                    explicitTarget: true,
                    ...(leechScope ? { leechScope } : {}),
                });
            }

            // Multi-component continuation ("with an additional repair equal to N% of its
            // Defense") — emit a second entry inheriting this component's target.
            // Scoped to the match's sentence to prevent cross-sentence false positives
            // (Issue 2).
            if (kind === 'heal') {
                HEAL_ADDITIONAL_RE.lastIndex = 0;
                const addM = HEAL_ADDITIONAL_RE.exec(sentence);
                if (addM) {
                    const addPct = parseFloat(addM[1]);
                    const addStat = addM[2].toLowerCase().replace(/\s+/g, '');
                    if (!isNaN(addPct)) {
                        results.push({
                            kind: 'heal',
                            pct: addPct,
                            basis:
                                addStat === 'attack'
                                    ? 'attack'
                                    : addStat === 'defense'
                                      ? 'defense'
                                      : 'hp',
                            target,
                            explicitTarget,
                            // Same sentence → same trigger: a continuation component of a
                            // damage-reaction repair is reactive too (no CSV case mixes the
                            // continuation with the instead-on-crit split, so the inherited
                            // critFilter is always absent today).
                            ...(damageReaction ? { damageReaction } : {}),
                            ...(ownCleanseReaction ? { ownCleanseReaction } : {}),
                        });
                    }
                }
            }
        }
    };

    emit('heal', HEAL_REPAIR_RE);
    emit('heal', LEECH_HEAL_VERB_RE);
    emit('shield', HEAL_SHIELD_RE);
    return results;
}

// PR11 (epic PR11): "reduces the duration of [all] active Debuffs on <recipient> by N turn(s)"
// — the inverse of extend-dot: SHRINKS every standing debuff's remaining window rather than
// growing a DoT's. Distinct mechanism from extend-dot (which only touches the Corrosion/Inferno
// containers and only grows) — this touches the GENERIC debuff store (any timed debuff, not
// just DoTs) and only shrinks. Heliodor's two mutually-exclusive passives (only one is
// refit-active at a time — see getShipSkillRows) differ ONLY in recipient: "on itself" (self)
// vs "on all allies" (all-allies), both gated by the SAME "When directly damaged" self-subject
// reaction (Heliodor is never the ally-subject shape — the unit being damaged is always itself;
// only the healed/reduced RECIPIENT varies, mirroring parseHealAbilities' identical Heliodor
// treatment). Pestilence's passive is gated on "On debuff infliction" (this Unit inflicting a
// debuff), a DIFFERENT phrasing from APPLYING_DEBUFF_RE's "on inflicting a debuff" — the noun
// form ("debuff infliction") reverses the word order, so it needs its own check here rather than
// reusing that regex. Deliberately excludes "Bombs" (Lingshe's charge-skill "reduces all Bombs
// on the enemy targets by 1 turn" is a structurally different mechanic — a hacking-gated,
// enemy-targeted PendingBomb countdown shrink with a forced-detonation-at-zero rider — tracked
// as a documented, allowlisted gap; see scripts/auditSkills.allowlist.ts). Reference data:
// docs/ship-skills.csv.
const REDUCE_DEBUFF_DURATION_RE =
    /reduces?\s+the\s+duration\s+of\s+(?:all\s+)?active\s+debuffs\s+on\s+([^,.]+?)\s+by\s+(\d+)\s+turns?/gi;
// "On debuff infliction" (Pestilence) — noun-phrase form, distinct from APPLYING_DEBUFF_RE's
// verb-phrase form ("on inflicting a debuff"). Scoped to the reduction's own sentence.
const ON_DEBUFF_INFLICTION_RE = /\bon\s+debuff\s+infliction\b/i;

export interface ParsedDebuffDurationReduction {
    turns: number;
    target: 'self' | 'all-allies';
    /** Present when the reducing clause is itself a self-subject damage reaction ("when
     *  directly damaged …") — buildShipAbilities maps it to trigger 'on-attacked' (Heliodor).
     *  buildShipAbilities keys off this flag EXPLICITLY (not the absence of onDebuffInflicted):
     *  a clause matching NEITHER gate carries no recognized reactive trigger and is dropped
     *  rather than silently defaulting to on-attacked. Mutually exclusive with `onDebuffInflicted`
     *  — no corpus ship carries both. */
    isDamageReaction?: boolean;
    /** Present when the clause is gated on THIS unit inflicting a debuff ("on debuff
     *  infliction") — buildShipAbilities maps it to trigger 'on-debuff-inflicted' (Pestilence). */
    onDebuffInflicted?: boolean;
}

/**
 * Parses "reduces the duration of [all] active Debuffs on <recipient> by N turn(s)" clauses.
 * Returns one entry per match, each carrying the shrink amount, the RECIPIENT (self vs
 * all-allies — never a singular ally in the corpus today), and which reactive gate governs it
 * (a self damage-reaction, or this unit's own debuff infliction). Reference data:
 * docs/ship-skills.csv.
 */
export function parseDebuffDurationReduction(
    text: string | null | undefined
): ParsedDebuffDurationReduction[] {
    if (!text) return [];
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    const out: ParsedDebuffDurationReduction[] = [];
    REDUCE_DEBUFF_DURATION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REDUCE_DEBUFF_DURATION_RE.exec(plain)) !== null) {
        const turns = parseInt(m[2], 10);
        if (!Number.isFinite(turns) || turns <= 0) continue;
        const targetPhrase = m[1].toLowerCase();
        const target: 'self' | 'all-allies' = /all\s+allies|\bthem\b/.test(targetPhrase)
            ? 'all-allies'
            : 'self';
        const { text: sentence } = sentenceBoundsAround(plain, m.index);
        const entry: ParsedDebuffDurationReduction = { turns, target };
        if (ON_DEBUFF_INFLICTION_RE.test(sentence)) {
            entry.onDebuffInflicted = true;
        } else if (HEAL_DAMAGE_REACTION_RE.test(sentence)) {
            entry.isDamageReaction = true;
        }
        out.push(entry);
    }
    return out;
}

// SP-F F3 (Lingshe charged skill): "reduces all Bombs on the enemy targets by N turn(s), Bombs
// reduced to 0 turns by this skill will detonate. This reduction effect requires hacking." A
// STRUCTURALLY DIFFERENT mechanic from REDUCE_DEBUFF_DURATION_RE above (which explicitly
// excludes "Bombs" — see its own comment): that regex shrinks the GENERIC debuff store on
// self/allies; this one targets the ENEMY's separate PendingBomb.countdown container. The
// "requires hacking" / forced-detonate-at-zero riders are NOT parsed here — they are baked into
// the fixed runtime behavior of the `bomb-countdown-reduce` ability (always hacking-gated,
// always detonates a bomb that reaches <= 0 — see playerTurn.ts's reduceEnemyBombs). Deliberately
// its own regex/function — do NOT fold into REDUCE_DEBUFF_DURATION_RE.
const BOMB_COUNTDOWN_REDUCE_RE =
    /reduces?\s+all\s+bombs\s+on\s+the\s+enemy\s+targets?\s+by\s+(\d+)\s+turns?/i;

/**
 * Parses "reduces all Bombs on the enemy targets by N turn(s)" (Lingshe). Returns the turn
 * count, or null when the text carries no such clause. Reference data: docs/ship-skills.csv.
 */
export function parseBombCountdownReduce(text: string | null | undefined): number | null {
    if (!text) return null;
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    const m = BOMB_COUNTDOWN_REDUCE_RE.exec(plain);
    if (!m) return null;
    const turns = parseInt(m[1], 10);
    return Number.isFinite(turns) && turns > 0 ? turns : null;
}

// "purges N" / "purges a/an" — active-verb only; naturally excludes "is Purged of all buffs"
// (no "purges" token). Must NOT match "cleanses".
const PURGE_RE = /\bpurges?\s+(?:(\d+|all)|an?\b)/gi;

// E4: "for every N% crit power" — purge-count scaling on crit power (Amartya).
// Sentence-scoped (applied to the purge's own sentence). Matches "for every 50% crit power".
const CRIT_POWER_SCALING_RE = /for\s+every\s+(\d+)\s*%?\s*crit\s+power/i;

// "cleanses N" — must NOT match "purges". Trailing clause names the recipient. The trailing
// boundary is normally a plain \b, but stripUnitTags can concatenate a tag boundary directly
// onto the following word with no space (Cultivator's active: "<unit-aid>cleanses 1</unit-aid>
// debuff." → "cleanses 1debuff." after tag removal) — a digit run immediately followed by a
// letter is NOT a \b, so tolerate that case via the `[a-z]` lookahead alternative too. Scoped to
// ONLY the digit branch (Finding B5) — applying it to `all` too would let a future "cleanses
// allies of a debuff" false-match "cleanses all" as a count-all cleanse (no such text exists in
// the corpus today). A single capturing group is kept (rather than one per alternative) so
// `m[1]` below still reads the whole matched count-or-"all" token unchanged.
const CLEANSE_RE = /\bcleanses?\s+(\d+(?=\b|[a-z])|all\b)/gi;

/**
 * Parses purge grants ("purges N buffs from <recipient>"). Purge is enemy-targeting only.
 * Target from the sentence: "all enemies" → all-enemies, else "enemy".
 * explicitTarget is always true (purge has no support-flip, kept for shape parity with parseCleanse).
 * Does NOT match "cleanses". Passive-voice "is Purged of all buffs" has no "purges" token and is
 * excluded naturally — see detectPassiveVoicePurge (I6) for that shape, merged in by callers
 * (buildShipAbilities) only on the active/charged slots. Reference data: docs/ship-skills.csv.
 *
 * NOTE: parsePurge is context-free. Reactive/conditional purge text in passives (Sefuba p2,
 * Faust, Iridium, etc.) will produce matches here. The active/charged slot-gate in
 * buildShipAbilities (Task 3) is what prevents those from being emitted as abilities.
 */
export function parsePurge(text: string | null | undefined): {
    count: number | 'all';
    target: 'enemy' | 'all-enemies';
    explicitTarget: boolean;
    countScaling?: { stat: 'critDamage'; per: number };
}[] {
    if (!text) return [];
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    const results: {
        count: number | 'all';
        target: 'enemy' | 'all-enemies';
        explicitTarget: boolean;
        countScaling?: { stat: 'critDamage'; per: number };
    }[] = [];
    PURGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PURGE_RE.exec(plain)) !== null) {
        // Group 1 is the count token (digit/all). Undefined when "a"/"an" matched instead.
        const raw = m[1]?.toLowerCase();
        let count: number | 'all';
        if (raw === undefined) {
            // "purges a buff" / "purges an enemy buff" — article matched, count is 1
            count = 1;
        } else if (raw === 'all') {
            count = 'all';
        } else {
            count = parseInt(raw, 10);
            if (!count || isNaN(count)) continue;
        }
        const sentence = sentenceAround(plain, m.index).toLowerCase();
        const target: 'enemy' | 'all-enemies' = /all\s+enemies/.test(sentence)
            ? 'all-enemies'
            : 'enemy';
        const scaleMatch = CRIT_POWER_SCALING_RE.exec(sentence);
        const countScaling =
            scaleMatch && typeof count === 'number'
                ? { stat: 'critDamage' as const, per: parseInt(scaleMatch[1], 10) }
                : undefined;
        results.push({
            count,
            target,
            explicitTarget: true,
            ...(countScaling ? { countScaling } : {}),
        });
    }
    return results;
}

// PR10: "steals N buff(s)" / "steals a/an buff" — active-verb only, mirrors PURGE_RE's shape.
// Corpus (Pallas/Thresh/Tithonus charged skills) always carries count 1, but a digit is
// captured generically like purge's count for future-proofing. Deliberately requires the
// "buff(s)" token so Meatshield's NAMED-buff steal ("it steals Protection until this Unit has
// 3 stacks of Protection" — no "buff" token, no count) does NOT match: that clause is a
// distinct shape (steals a specific named buff up to a stack threshold, no explicit source),
// left unmodeled by this mechanic (see parseBuffSteal's doc comment).
const STEAL_RE = /\bsteals?\s+(\d+|an?)\s+buffs?\b/gi;

// "granting it to self and all adjacent allies" — Tithonus's charged skill: the stolen buff is
// also granted to every living adjacent ally of the caster (not a fan-out split — every
// recipient gets the SAME stolen buff). Sentence-scoped to the steal's own clause.
const STEAL_GRANT_ADJACENT_RE = /granting\s+it\s+to\s+self\s+and\s+all\s+adjacent\s+allies\b/i;

/**
 * Parses buff-steal grants ("steals N buff(s) from the primary target[, granting it to self and
 * all adjacent allies]"). Corpus: Pallas/Thresh/Tithonus charged skills — "This Unit steals 1
 * buff from the primary target, then/and deals N% damage." The stolen buff always comes from
 * "the primary target" (the caster's normal cast target) — no all-enemies variant exists in the
 * corpus, so unlike parsePurge there is no `target` field; callers route the steal against the
 * same `targetId` a purge/damage ability would use.
 *
 * Does NOT match Meatshield's "it steals Protection until this Unit has 3 stacks of Protection"
 * (a NAMED-buff, stack-threshold steal with no explicit source and no "buff(s)" token) — a
 * distinct shape deliberately left unmodeled by this mechanic (see the skill-model-gap-sweep
 * epic notes). Reference data: docs/ship-skills.csv.
 */
export function parseBuffSteal(
    text: string | null | undefined
): { count: number; grantAdjacentAllies: boolean }[] {
    if (!text) return [];
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    const results: { count: number; grantAdjacentAllies: boolean }[] = [];
    STEAL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = STEAL_RE.exec(plain)) !== null) {
        const raw = m[1].toLowerCase();
        const count = raw === 'a' || raw === 'an' ? 1 : parseInt(raw, 10);
        if (!count || isNaN(count)) continue;
        const sentence = sentenceAround(plain, m.index);
        const grantAdjacentAllies = STEAL_GRANT_ADJACENT_RE.test(sentence);
        results.push({ count, grantAdjacentAllies });
    }
    return results;
}

// I6: "<subject> is Purged of (N|all) buffs" — Lodolite's charged skill: "Then, the enemy with
// the most Buffs is Purged of all buffs." No "purges" verb token, so the active-verb-only
// PURGE_RE does not match it (by design — see PURGE_RE's comment). Kept as a SEPARATE detector
// (rather than folded into PURGE_RE/parsePurge) because parsePurge is context-free and consumed
// for every slot of every ship (including passive text scanned for REACTIVE purge triggers, e.g.
// Sefuba/Rhodium/Faust/Salvation/Nayra) — widening that shared, corpus-wide regex risks absorbing
// a future passive's self-referential "when this Unit is Purged of a buff…" (an INCOMING purge
// reaction, a different semantic than Lodolite's outgoing "the enemy … is Purged"). This detector
// is wired ONLY into the active/charged on-cast path (buildShipAbilities), never the passive-slot
// trigger-detection loop, so it cannot pick up a hypothetical passive-voice self-reaction even if
// the corpus grows one later. Corpus today has exactly ONE "is Purged" occurrence (Lodolite;
// verified via `grep -io "is purged[^.]*" docs/ship-skills.csv`).
const PASSIVE_VOICE_PURGE_RE = /\bis\s+purged\s+of\s+(\d+|all)\s+buffs?\b/gi;

/**
 * Parses the passive-voice purge shape ("<subject> is Purged of N/all buffs") — the counterpart
 * to parsePurge's active-verb form, restricted to on-cast (active/charged) callers. Same result
 * shape as parsePurge so callers can merge the two lists. Reference data: docs/ship-skills.csv
 * (Lodolite charged skill).
 */
export function detectPassiveVoicePurge(text: string | null | undefined): {
    count: number | 'all';
    target: 'enemy' | 'all-enemies';
    explicitTarget: boolean;
    countScaling?: { stat: 'critDamage'; per: number };
}[] {
    if (!text) return [];
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    const results: {
        count: number | 'all';
        target: 'enemy' | 'all-enemies';
        explicitTarget: boolean;
        countScaling?: { stat: 'critDamage'; per: number };
    }[] = [];
    PASSIVE_VOICE_PURGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PASSIVE_VOICE_PURGE_RE.exec(plain)) !== null) {
        const raw = m[1].toLowerCase();
        const count: number | 'all' = raw === 'all' ? 'all' : parseInt(raw, 10);
        if (count !== 'all' && (!count || isNaN(count))) continue;
        const sentence = sentenceAround(plain, m.index).toLowerCase();
        const target: 'enemy' | 'all-enemies' = /all\s+enemies/.test(sentence)
            ? 'all-enemies'
            : 'enemy';
        results.push({ count, target, explicitTarget: true });
    }
    return results;
}

// I6: "When this Unit Purges a buff from an enemy, it removes N% of the enemy's shield" —
// Lodolite's legendary-refit (R4) passive. Scoped to the SAME self-purge-reactive phrase shape as
// ENEMY_PURGED_RE ("when this unit … purges … enem[y]"), extended to require a shield-percentage
// removal clause in the same sentence. Verified against RAW CSV (Lodolite third_passive_skill_text
// is the only corpus row matching both a purge-self clause AND a "removes N% … shield" clause —
// the other 3 "removes N% … Shield" rows in the corpus carry no purge language at all).
const PURGE_STRIPS_SHIELD_RE =
    /\bwhen\s+this\s+unit\b[^.;]*\bpurges?\b[^.;]*\benem[^.;]*\bremoves\s+(\d+)\s*%[^.;]*\bshield/i;

/**
 * True when `text` declares "when this Unit purges a buff from an enemy, it removes 100% of the
 * enemy's shield" (Lodolite's legendary refit). Percentage is captured but only the 100% (full
 * strip) case is modeled per the locked game rule — anything else is left unflagged rather than
 * guessed at, since no corpus ship carries a partial-strip variant today.
 */
export function detectPurgeStripsShield(text: string | null | undefined): boolean {
    if (!text) return false;
    // Normalize before matching (strip unit tags + <br/> → '. ') so the RE's [^.;]* sentence
    // scoping can't span an un-punctuated <br/> into an unrelated clause — matches the
    // convention used by parsePurge/detectPassiveVoicePurge above.
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    const m = PURGE_STRIPS_SHIELD_RE.exec(plain);
    return m !== null && m[1] === '100';
}

// PR9(b): standalone "removes X% of the enemy Shield" — APEX ("removes 30% of the enemy
// Shield"), Laika ("removes 40% of the enemy Shield"), Malvex ("removes 30% of the enemy's
// Shield", curly apostrophe). These are the "other 3 corpus rows" referenced by
// PURGE_STRIPS_SHIELD_RE's comment above — no purge language in the same sentence, coordinate
// with the skill's own damage rather than gated on a purge landing. Apostrophe optional/either
// style (straight or curly) since Malvex's CSV cell uses the curly U+2019 form.
const SHIELD_STRIP_RE = /\bremoves\s+(\d+(?:\.\d+)?)\s*%\s*of\s+the\s+enemy(?:['’]s)?\s+shield/i;

/**
 * Returns the standalone shield-strip percentage from a skill, e.g. "removes 30% of the enemy
 * Shield" (APEX/Laika/Malvex). Excludes Lodolite's PURGE-COUPLED "when this Unit Purges a buff
 * from an enemy, it removes 100% of the enemy's shield" clause (sentence-scoped: null when the
 * same sentence carries "purge" language) — that stays modeled exclusively by
 * detectPurgeStripsShield's `stripsShield` flag on the purge ability, gated on the purge
 * landing. Returns null if no standalone strip clause is present.
 */
export function parseShieldStrip(text: string | null | undefined): { pct: number } | null {
    if (!text) return null;
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    const match = SHIELD_STRIP_RE.exec(plain);
    if (!match) return null;
    // Sentence-scoped purge exclusion, same convention as parseSecondaryDamage's guard above.
    const plainBefore = plain.slice(0, match.index);
    const sentenceStart = Math.max(plainBefore.lastIndexOf('. '), plainBefore.lastIndexOf('; '));
    const sentencePrefix = plainBefore.slice(sentenceStart + 1).toLowerCase();
    if (/\bpurge/.test(sentencePrefix)) return null;
    const pct = parseFloat(match[1]);
    if (isNaN(pct)) return null;
    return { pct };
}

/**
 * Parses cleanse grants ("cleanses N debuffs from <recipient>"). Target from the trailing
 * clause: "from itself" → self, "from all allies" → all-allies, "from the/that ally" → ally;
 * default self. Epic PR5 finding 3: a TYPED cleanse ("cleanses 2 bombs" / "cleanses 2 damage
 * over time debuffs", Nyxen) also carries `debuffType` so the removal is restricted to that
 * category rather than any debuff; untyped cleanses omit it. Does not match "purges". Reference
 * data: docs/ship-skills.csv.
 */
export function parseCleanse(text: string | null | undefined): {
    count: number | 'all';
    target: 'self' | 'ally' | 'all-allies';
    explicitTarget: boolean;
    debuffType?: 'bomb' | 'dot';
    countScaling?: { stat: 'critDamage'; per: number };
}[] {
    if (!text) return [];
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    const results: {
        count: number | 'all';
        target: 'self' | 'ally' | 'all-allies';
        explicitTarget: boolean;
        debuffType?: 'bomb' | 'dot';
        countScaling?: { stat: 'critDamage'; per: number };
    }[] = [];
    CLEANSE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CLEANSE_RE.exec(plain)) !== null) {
        const raw = m[1].toLowerCase();
        const count: number | 'all' = raw === 'all' ? 'all' : parseInt(raw, 10);
        if (count !== 'all' && (!count || isNaN(count))) continue;
        const sentence = sentenceAround(plain, m.index).toLowerCase();
        // explicitTarget mirrors parseHealAbilities: true when a recipient phrase was matched,
        // false when target defaulted to 'self' with no named recipient (the bare-cleanse case
        // the buildShipAbilities flip routes to the ally).
        let target: 'self' | 'ally' | 'all-allies' = 'self';
        let explicitTarget = true;
        if (/all\s+allies/.test(sentence)) target = 'all-allies';
        else if (/itself|from\s+this\s+unit/.test(sentence)) target = 'self';
        else if (/the\s+ally|that\s+ally|an\s+ally/.test(sentence)) target = 'ally';
        else explicitTarget = false;
        // Typed filter: read the noun immediately AFTER "cleanses N" (the phrase the count
        // governs) so an unrelated later mention in the sentence can't set the type. "bomb(s)"
        // → bomb; "damage over time" / "DoT" → dot. Absent → untyped.
        const afterCount = plain.slice(m.index + m[0].length);
        const filterSpan = afterCount.slice(0, afterCount.search(/[.;,]|<br|$/i));
        let debuffType: 'bomb' | 'dot' | undefined;
        if (/^\s*bombs?\b/i.test(filterSpan)) debuffType = 'bomb';
        else if (/^\s*damage\s+over\s+time\b|^\s*dots?\b/i.test(filterSpan)) debuffType = 'dot';
        // #363 (Fuying): "cleanses 1 debuff for every 50% crit power" — same crit-power scaling
        // shape as parsePurge's identically-worded Amartya clause. Mirrored verbatim.
        const scaleMatch = CRIT_POWER_SCALING_RE.exec(sentence);
        const countScaling =
            scaleMatch && typeof count === 'number'
                ? { stat: 'critDamage' as const, per: parseInt(scaleMatch[1], 10) }
                : undefined;
        results.push({
            count,
            target,
            explicitTarget,
            ...(debuffType ? { debuffType } : {}),
            ...(countScaling ? { countScaling } : {}),
        });
    }
    return results;
}

/**
 * Whether a skill's REPAIR/HEAL cannot critically hit (the exact complement of parseNoCrit,
 * which flags attack no-crit). Returns true only when a "cannot critically hit" subject IS a
 * repair/heal verb. Reference data: docs/ship-skills.csv.
 */
export function parseHealNoCrit(text: string | null | undefined): boolean {
    if (!text) return false;
    for (const m of stripUnitTags(text).matchAll(NO_CRIT_RE)) {
        if (NO_CRIT_HEAL_SUBJECTS.has(m[1].toLowerCase())) return true;
    }
    return false;
}

/**
 * Returns true if any of the provided skill texts contain "fully charged" (case-insensitive).
 * Checks all five skill text fields to cover all in-game phrasings including typos.
 */
export function detectFullyCharged(texts: (string | undefined)[]): boolean {
    return texts.some((t) => t?.toLowerCase().includes('fully charged') ?? false);
}

/**
 * PR F4: a permanent pre-fight base-stat grant parsed from a ship passive. Consumed by
 * buildShipAbilities into a `pre-combat-stat` ability (trigger 'pre-combat'); the battle
 * sim's pre-fight layer (F5) applies it to plan stats before round 1. Corpus (docs/
 * ship-skills.csv): Lionheart, Centurion, Enforcer, Defiant, Stalwart, Madax (Task 9 —
 * 'defence' donor grant to the adjacent Supporter, see PRE_COMBAT_ROLE_GATE_DONOR_STAT_RE).
 */
export interface PreCombatStatGrant {
    stat: 'hp' | 'attack' | 'crit' | 'hacking' | 'defence';
    value: number;
    /** 'flat': absolute points. 'percent-of-own': % of the RECIPIENT's pre-fight stat.
     *  'percent-of-donor': % of the GRANTING ship's pre-fight stat (Lionheart). */
    valueKind: 'flat' | 'percent-of-own' | 'percent-of-donor';
    target: 'self' | 'adjacent-allies';
    /** Multiply value by count of adjacent living allies (Centurion). */
    perAdjacentAlly?: boolean;
    /** Gate: at least one adjacent ally of this role category (Enforcer/Defiant/Stalwart). */
    requiresAdjacentRole?: ShipRoleCategory;
    /** Match index in the tag-stripped text — stable ability ordering in buildShipAbilities. */
    pos: number;
}

// Pattern A (Lionheart): "At the start of combat, this Unit grants all adjacent allies
// 10% of its HP." — donor-scaled HP grant to adjacent allies.
const PRE_COMBAT_DONOR_HP_RE =
    /at the start of combat,?\s*this unit grants all adjacent allies (\d+(?:\.\d+)?)%\s*of its (?:max\s*)?hp/gi;

// Pattern B (Centurion): "At the start of combat, this Unit gains 500 attack per adjacent
// ally." — flat attack × adjacent-ally count, self. Number may carry thousands commas.
const PRE_COMBAT_PER_ADJACENT_ATTACK_RE =
    /at the start of combat,?\s*this unit gains (\d[\d,]*)\s*attack per adjacent ally/gi;

// Pattern C: role-gated self grants, both orderings. The stat-list capture is bounded to its
// own sentence ([^.;]+?) so it can't swallow neighbouring clauses in multi-sentence passives.
//   C1 trailing gate (Enforcer): "… this Unit gains +15% crit rate and +10% hacking if
//   adjacent to a supporter."
//   C2 leading gate (Defiant/Stalwart): "When (this Unit is) adjacent to a Supporter, this
//   Unit gains 20% HP/Attack." — Madax's "receives 30% more Repairs…" has no "gains" verb, so
//   it never matches this pattern; its "increases that Supporter's Defense by 20%…" clause is
//   a DIFFERENT shape (a donor grant to the adjacent ally, not a self-gain) — see Pattern D
//   below (Task 9).
const PRE_COMBAT_ROLE_GATE_TRAILING_RE =
    /this unit gains ([^.;]+?)\s+(?:if|when|while)\s+adjacent to an?\s+(supporter|defender|attacker|debuffer)\b/gi;
const PRE_COMBAT_ROLE_GATE_LEADING_RE =
    /when (?:this unit is )?adjacent to an?\s+(supporter|defender|attacker|debuffer),\s*this unit gains ([^.;]+?)(?=[.;]|$)/gi;

// Pattern D (Madax, Task 9): "When adjacent to a Supporter, this Unit … increases that
// Supporter's Defense by 20% of this Unit's Defense." — a DONOR-scaled stat grant to the
// specific adjacent ally of the named role (not a self-gain, so Pattern C's "gains" verb
// doesn't apply). Reuses the existing 'adjacent-allies' target (Pattern A, Lionheart) plus
// the existing requiresAdjacentRole gate (Pattern C) rather than introducing a new target —
// buildShipAbilities/preCombatPassives already thread both through generically. The role
// backreference (\1) ties "that <role>'s" back to the same role named in the leading gate.
const PRE_COMBAT_ROLE_GATE_DONOR_STAT_RE =
    /when (?:this unit is )?adjacent to an?\s+(supporter|defender|attacker|debuffer),[^.;]*\bincreases\s+that\s+\1'?s\s+(defense|attack|hp|max\s*hp)\s+by\s+(\d+(?:\.\d+)?)\s*%\s*of\s+this\s+unit'?s\s+(?:defense|attack|hp|max\s*hp)/gi;

// Stat-list splitter for pattern C: "+15% crit rate and +10% hacking" / "20% HP" / "20% Attack".
// crit rate is a percentage-only stat, so "+15% crit rate" is a FLAT 15-point grant; hacking/
// hp/attack scale the recipient's own stat (percent-of-own).
const PRE_COMBAT_STAT_LIST_RE = /\+?(\d+(?:\.\d+)?)%\s*(crit(?:ical)?\s*rate|hacking|hp|attack)/gi;

// Stat-keyword mapping for pattern D's granted stat ("Defense"/"Attack"/"HP"/"Max HP") to the
// engine's PreFightStatBlock key. Distinct from preCombatStatFromKeyword (pattern C — self
// grants only support hp/attack/crit/hacking) because pattern D also supports 'defence',
// spelled to match PreFightStatBlock/DerivedCombatStats (British spelling), not
// ParsedHealAbility's American 'defense'.
function donorRoleGrantStatFromKeyword(keyword: string): 'defence' | 'attack' | 'hp' {
    const k = keyword.toLowerCase().replace(/\s+/g, '');
    if (k === 'defense' || k === 'defence') return 'defence';
    if (k === 'attack') return 'attack';
    return 'hp';
}

function preCombatStatFromKeyword(keyword: string): {
    stat: 'hp' | 'attack' | 'crit' | 'hacking';
    valueKind: 'flat' | 'percent-of-own';
} {
    const k = keyword.toLowerCase();
    if (k.startsWith('crit')) return { stat: 'crit', valueKind: 'flat' };
    if (k === 'hacking') return { stat: 'hacking', valueKind: 'percent-of-own' };
    if (k === 'hp') return { stat: 'hp', valueKind: 'percent-of-own' };
    return { stat: 'attack', valueKind: 'percent-of-own' };
}

/**
 * Parses permanent pre-fight base-stat passives ("At the start of combat, …" grants and
 * role-gated adjacency grants). Reference data: docs/ship-skills.csv — matches exactly
 * Lionheart (A), Centurion (B), Enforcer (C1), Defiant/Stalwart (C2). Timed start-of-combat
 * statuses ("gains N stacks of X", "gains a Shield/Taunt…") and Centurion's charged
 * Core-Charge grant have no matching shape here and stay with their existing parsers.
 */
export function parsePreCombatStatGrants(text: string | null | undefined): PreCombatStatGrant[] {
    if (!text) return [];
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    const results: PreCombatStatGrant[] = [];
    let m: RegExpExecArray | null;

    PRE_COMBAT_DONOR_HP_RE.lastIndex = 0;
    while ((m = PRE_COMBAT_DONOR_HP_RE.exec(plain)) !== null) {
        results.push({
            stat: 'hp',
            value: parseFloat(m[1]),
            valueKind: 'percent-of-donor',
            target: 'adjacent-allies',
            pos: m.index,
        });
    }

    PRE_COMBAT_PER_ADJACENT_ATTACK_RE.lastIndex = 0;
    while ((m = PRE_COMBAT_PER_ADJACENT_ATTACK_RE.exec(plain)) !== null) {
        results.push({
            stat: 'attack',
            value: parseInt(m[1].replace(/,/g, ''), 10),
            valueKind: 'flat',
            target: 'self',
            perAdjacentAlly: true,
            pos: m.index,
        });
    }

    const emitRoleGated = (list: string, listPos: number, role: string) => {
        const requiresAdjacentRole = role.toUpperCase() as ShipRoleCategory;
        PRE_COMBAT_STAT_LIST_RE.lastIndex = 0;
        let sm: RegExpExecArray | null;
        while ((sm = PRE_COMBAT_STAT_LIST_RE.exec(list)) !== null) {
            results.push({
                ...preCombatStatFromKeyword(sm[2]),
                value: parseFloat(sm[1]),
                target: 'self',
                requiresAdjacentRole,
                pos: listPos + sm.index,
            });
        }
    };

    PRE_COMBAT_ROLE_GATE_TRAILING_RE.lastIndex = 0;
    while ((m = PRE_COMBAT_ROLE_GATE_TRAILING_RE.exec(plain)) !== null) {
        emitRoleGated(m[1], m.index + m[0].indexOf(m[1]), m[2]);
    }

    PRE_COMBAT_ROLE_GATE_LEADING_RE.lastIndex = 0;
    while ((m = PRE_COMBAT_ROLE_GATE_LEADING_RE.exec(plain)) !== null) {
        emitRoleGated(m[2], m.index + m[0].indexOf(m[2]), m[1]);
    }

    // Pattern D (Madax, Task 9): donor-scaled stat grant to the adjacent ally of the named
    // role — target 'adjacent-allies' (Pattern A's shape) combined with requiresAdjacentRole
    // (Pattern C's gate), valueKind 'percent-of-donor' (this Unit's own stat, not the
    // recipient's).
    PRE_COMBAT_ROLE_GATE_DONOR_STAT_RE.lastIndex = 0;
    while ((m = PRE_COMBAT_ROLE_GATE_DONOR_STAT_RE.exec(plain)) !== null) {
        results.push({
            stat: donorRoleGrantStatFromKeyword(m[2]),
            value: parseFloat(m[3]),
            valueKind: 'percent-of-donor',
            target: 'adjacent-allies',
            requiresAdjacentRole: m[1].toUpperCase() as ShipRoleCategory,
            pos: m.index,
        });
    }

    return results;
}

export type SkillSource = 'active' | 'charge' | 'passive1' | 'passive2' | 'passive3';

export interface SkillEffect {
    buffName: string;
    // Player-side granularity (team-walk ally-scope): 'self' = caster only, 'ally' = a single
    // chosen ally, 'all-allies' = every player actor, 'adjacent-allies' = board-adjacent player
    // actors only (Lionheart's crit-buff grants — ship-kit W8 Task 1; see detectGrantScope).
    // 'enemy' = single-target enemy debuff, 'all-enemies' = enemy debuff scoped to the whole
    // opposing team (detectEnemyGrantScope). 'adjacent-enemies' / 'target-and-adjacent-enemies' =
    // enemy debuff scoped to the anchor's neighbours (excluded/included respectively) — see
    // detectAdjacentEnemyScope. Engine fan-out for these two is a later task; this file only
    // resolves the scope.
    // The combat engine routes 'ally'/'all-allies'/'adjacent-allies' grants from a walked team
    // ship onto the right actors, and fans an 'all-enemies' debuff over aoeVictimIds generically;
    // for the attacker's own sim 'self'/'all-allies'/'adjacent-allies' all fold onto its side
    // (zero churn).
    target:
        | 'self'
        | 'ally'
        | 'all-allies'
        | 'adjacent-allies'
        | 'enemy'
        | 'all-enemies'
        | 'adjacent-enemies'
        | 'target-and-adjacent-enemies';
    duration: number | 'recurring' | null;
    stacks?: number;
    source: SkillSource;
    /**
     * #438: which occurrence of `buffName` in the row this effect came from (0-based, counting
     * `<unit-skill>` tags). Carried so the ability builder's clause detectors — conditions,
     * faction scope, recipient filter, triggers — read THIS grant's sentence rather than the
     * first one mentioning the name. Absent on hand-built effects and on the untagged
     * supplementary passes below (conjoined self-grants, bare Stasis) — those have no ordinal to
     * count, and index 0 is the first sentence holding the name either way. Read as `?? 0`.
     */
    occurrenceIndex?: number;
    stackTrigger?: StackTrigger;
    // Enemy debuffs only: 'inflict' verbs are resistible, 'apply' verbs are guaranteed.
    application?: 'inflict' | 'apply';
    // Lionheart: a consumable Protection ("all Protection is removed" after a redirect) has a
    // FIXED pool — the round-start grant refreshes to `maxStacks`, it does not accumulate.
    maxStacks?: number;
    clearAllOnRedirect?: boolean;
}

// Application verbs grouped by the side they target, covering each verb's
// morphological forms (bare/3rd-person/gerund/past-participle) so phrasings like
// "inflict", "inflicting", "is inflicted with" all register, not just "inflicts".
const SELF_VERBS = new Set([
    'grant',
    'grants',
    'granting',
    'granted',
    'gain',
    'gains',
    'gaining',
    'gained',
]);
const ENEMY_VERBS = new Set(['inflict', 'inflicts', 'inflicting', 'inflicted']);
// "apply" forms are side-ambiguous (a buff is self, a debuff is enemy) — verbToTarget disambiguates via BUFFS.
const AMBIGUOUS_VERBS = new Set(['apply', 'applies', 'applying', 'applied']);
const APPLICATION_VERBS = new Set([...SELF_VERBS, ...ENEMY_VERBS, ...AMBIGUOUS_VERBS]);
// Past participles double as adjectives ("the newly applied Corrosion") — that's a
// reference to an existing effect being extended, not a fresh application.
const ADJECTIVAL_MARKER = 'newly';
const SKIP_VERBS = new Set(['ignoring', 'loses', 'removes', 'resists', 'when']);
// `\s*` (not `\s+`) between the number and "turn(s)" tolerates a CSV concatenation typo
// ("for 1turn." — Morao's active) where the tag-removal boundary leaves no space. `\s+` before
// the number is left mandatory since "for" is always followed by a real space in the corpus.
const DURATION_RE = /for\s+(\d+)\s*turns?/i;
const RECURRING_RE = /every\s+turn/i;
// Matches "N stacks of" at the END of a text segment (immediately before the tag)
const STACKS_RE = /(\d+)\s+stacks?\s+of\s*$/i;
// Lionheart refit passive: "After taking damage redirected through Protection, all Protection
// is removed." Marks the ship's Protection grant as consumable (clear-all-on-redirect) and,
// because such Protection is a fixed pool, caps its round-start accumulation at the grant count
// (refresh-to-N, not accumulate). Reference data: docs/ship-skills.csv. Tested against
// tag-stripped text (stripUnitTags) since "Protection" is <unit-skill>-wrapped in the raw string.
const CLEAR_PROTECTION_ON_REDIRECT_RE =
    /after taking damage redirected through protection,\s*all protection is removed/i;
// Matches text that is ONLY connectors between tags (e.g. " and ", ", ", " or "), optionally
// tolerating ONE bridging application verb between conjoined tags governed by different verbs —
// "gains X and inflicts Y ... for N turns" (Bayah) has "inflicts" sitting between the two buff
// tags, which a bare connector regex rejects, stopping the forward/backward duration scans before
// they ever reach the trailing/leading "for N turns" clause. Used by findSharedDuration (forward)
// and findLeadingDuration (backward). (Epic PR5 finding 2 widened the old connector-only form.)
const SHARED_DURATION_BRIDGE_RE =
    /^\s*(,\s*)?(and|or)?\s*(?:grants?|granting|granted|gains?|gaining|gained|inflicts?|inflicting|inflicted|applies|applying|applied|apply)?\s*$/i;
const MAX_SCAN_CHARS = 120;

// Conjoined self-grant: "gains/grants <something> and <BuffName> for N turns". The primary
// segment-loop emitter attaches a buff to the nearest preceding application verb, but in a
// conjoined grant the verb is consumed by the FIRST conjunct (Hermes: "gains 1 charge …") and
// the trailing buff name after "and" has no governing verb of its own (and may not even be
// <unit-skill>-tagged). This supplementary pass catches that trailing buff. It is deliberately
// narrow: a self-grant verb, then "and <BuffName> for N turns", and <BuffName> must resolve to a
// known BUFFS entry (resolveBuffName, incl. "3" → "III" normalization). Anything not in BUFFS is
// ignored, so it never invents buffs from arbitrary capitalized phrases. Matched on tag-stripped
// raw text so it works whether or not the trailing buff is tagged. Group 1 = buff name, group 2 =
// duration. Across the full ship corpus the ONLY net-new emission (i.e. not already produced by
// the segment loop) is Hermes's Everliving Regeneration III.
const CONJOINED_SELF_GRANT_RE =
    /\b(?:gains?|grants?)\b[^.;]*?\band\s+([A-Z][A-Za-z][A-Za-z. ]*?[A-Za-z0-9])\s+for\s+(\d+)\s+turns?/gi;

// Resolves a candidate buff name (possibly using arabic numerals where BUFFS uses roman numerals)
// to its canonical BUFFS entry name, or undefined if it isn't a known buff. Mirrors the number↔roman
// handling in findBuffDescription, but returns the canonical name rather than the description.
function resolveBuffName(candidate: string): string | undefined {
    const trimmed = candidate.trim();
    const exact = BUFFS.find((b) => b.name.toLowerCase() === trimmed.toLowerCase());
    if (exact) return exact.name;
    // Text may use arabic numerals ("Everliving Regeneration 3") where BUFFS uses roman ("III").
    const numberToRoman: Record<string, string> = {
        '1': 'I',
        '2': 'II',
        '3': 'III',
        '4': 'IV',
        '5': 'V',
    };
    const romanized = trimmed.replace(/\b([1-5])\b/g, (_, d: string) => numberToRoman[d]);
    if (romanized !== trimmed) {
        const match = BUFFS.find((b) => b.name.toLowerCase() === romanized.toLowerCase());
        if (match) return match.name;
    }
    return undefined;
}

/**
 * Scans forward from startIndex through connector-only text segments and non-text segments,
 * looking for a shared "for N turns" or "every turn" that applies to all preceding tags.
 * Stops at a sentence boundary or any non-connector, non-tag text.
 */
function findSharedDuration(
    segments: SkillTextSegment[],
    startIndex: number
): number | 'recurring' | null {
    for (let j = startIndex; j < segments.length; j++) {
        const s = segments[j];
        if (s.type === 'unit-skill' || s.type === 'unit-damage' || s.type === 'unit-aid') continue;
        if (s.type !== 'text') break;
        // Test duration patterns before the sentence-boundary check so "for 2 turns." is parsed.
        const m = DURATION_RE.exec(s.text);
        if (m) return parseInt(m[1], 10);
        if (RECURRING_RE.test(s.text)) return 'recurring';
        if (/[.;]|<br\s*\/?>/i.test(s.text)) break;
        // SHARED_DURATION_BRIDGE_RE (not the plain CONNECTOR_RE) — tolerates one bridging
        // application verb ("and inflicts") between two tags governed by different verbs that
        // still share a later trailing duration (Bayah: "gains X and inflicts Y ... for 2 turns").
        if (!SHARED_DURATION_BRIDGE_RE.test(s.text)) break;
    }
    return null;
}

// Tokens that may legitimately sit BETWEEN a leading "for N turns" clause and the buff tag it
// governs — commas, connectors, "both" (Oleander's "grants both X and Y"), and application verb
// forms. Used by findLeadingDuration to verify a candidate duration isn't separated from the tag
// by unrelated content (a trigger clause, another effect, etc.) via a strip-and-check-empty test,
// since the bridging text's word order/repetition varies more than a single fixed regex can
// anchor (e.g. ", grants both " vs ", grants both  and ").
const LEADING_DURATION_BRIDGE_TOKEN_RE =
    /,|\band\b|\bor\b|\bboth\b|\bgrants?\b|\bgranting\b|\bgranted\b|\bgains?\b|\bgaining\b|\bgained\b|\binflicts?\b|\binflicting\b|\binflicted\b|\bapplies\b|\bapplying\b|\bapplied\b|\bapply\b/gi;

/**
 * Scans backward from a buff tag for a LEADING "for N turns" clause stated BEFORE the governing
 * verb rather than after the buff — Oleander's charge skill states the duration once, ahead of a
 * verb governing multiple conjoined buffs: "…grants Repair Over Time II for 2 turns and, for 3
 * turns, grants both <BuffA> and <BuffB>." Used as the LAST fallback in parseSkillEffects'
 * duration step, after the buff's own immediate and forward-shared duration lookups both fail.
 *
 * Collects the contiguous backward text (stopping at a sentence boundary), then checks EACH
 * "for N turns" occurrence, closest to the tag first: a candidate only qualifies when everything
 * between its end and the tag is bridge-only (LEADING_DURATION_BRIDGE_TOKEN_RE strips it to
 * nothing) — i.e. connectors/verbs/"both", not an unrelated clause. This rejects an EARLIER
 * buff's own duration in the same sentence when it's separated from the current tag by a real
 * trigger/content clause: Shashou's "gains Stealth for 2 turns after damaging a Debuffer or
 * Supporter and gains 1 stack of Blast each turn" must NOT leak Stealth's "for 2 turns" onto the
 * unrelated per-turn-stacking Blast grant — "after damaging a Debuffer or Supporter" is real
 * content, not a bridge, so the candidate is disqualified and the scan correctly finds nothing.
 */
function findLeadingDuration(segments: SkillTextSegment[], tagIndex: number): number | null {
    let text = '';
    for (let j = tagIndex - 1; j >= 0; j--) {
        const s = segments[j];
        if (s.type === 'unit-skill' || s.type === 'unit-damage' || s.type === 'unit-aid') continue;
        if (s.type !== 'text') break;
        const boundaryMatches = [...s.text.matchAll(/[.;]|<br\s*\/?>/gi)];
        if (boundaryMatches.length) {
            const last = boundaryMatches[boundaryMatches.length - 1];
            text = s.text.slice((last.index ?? 0) + last[0].length) + text;
            break;
        }
        text = s.text + text;
        if (text.length > MAX_SCAN_CHARS) {
            text = text.slice(text.length - MAX_SCAN_CHARS);
            break;
        }
    }
    const matches = [...text.matchAll(/for\s+(\d+)\s+turns?/gi)];
    for (let k = matches.length - 1; k >= 0; k--) {
        const m = matches[k];
        const after = text.slice((m.index ?? 0) + m[0].length);
        LEADING_DURATION_BRIDGE_TOKEN_RE.lastIndex = 0;
        if (after.replace(LEADING_DURATION_BRIDGE_TOKEN_RE, '').trim() === '') {
            return parseInt(m[1], 10);
        }
    }
    return null;
}

// Words that pin a self-grant verb's subject to the caster once encountered while scanning
// backward from the verb — "this Unit gains X" / "it gains X" / "they gain X" (team subjects).
// Reaching one of these BEFORE an "enemy"/"enemies" word means the verb is a genuine self-grant.
const SELF_SUBJECT_STOP_WORDS = new Set(['this', 'unit', 'it', 'itself', 'they', 'their', 'ally']);
// Bound the backward subject scan to a short window — the known shape ("an enemy defender
// gains") is 1-2 words — so an unrelated, distant "enemy" earlier in a long sentence can never
// mis-flag an unrelated verb (mirrors the ~20-char window used by the analogous Taunt-only guard
// in CONTROL_INFLICTS).
const ENEMY_SUBJECT_SCAN_WINDOW = 6;

/**
 * True when the application verb at `words[verbIndex]` (a SELF_VERB, e.g. "gains"/"grants") has
 * "enemy"/"enemies" as its nearer grammatical subject rather than the caster — i.e. the verb sits
 * inside a trigger/condition clause ("When an enemy defender gains Taunt, …") rather than
 * describing something THIS Unit receives. Scans backward a short, bounded window and stops as
 * soon as it hits a caster/team subject word (SELF_SUBJECT_STOP_WORDS), a clause-boundary
 * keyword, OR any other application/skip verb — crossing a PRIOR verb's territory means an
 * "enemy" beyond it belongs to a different clause (Ravager: "upon killing an enemy, loses
 * Overload and gains Marauder Rage III" — "enemy" is killing's object, in an earlier clause than
 * this "gains"; the intervening "loses" stops the scan before reaching it). No lookbehind (iOS
 * Safari 15).
 */
function hasEnemySubject(words: string[], verbIndex: number): boolean {
    const limit = Math.max(0, verbIndex - ENEMY_SUBJECT_SCAN_WINDOW);
    for (let j = verbIndex - 1; j >= limit; j--) {
        const w = words[j];
        if (w === 'enemy' || w === 'enemies') return true;
        if (SELF_SUBJECT_STOP_WORDS.has(w)) return false;
        if (w === 'when' || w === 'after' || w === 'if' || w === 'while' || w === 'upon')
            return false;
        if (APPLICATION_VERBS.has(w) || SKIP_VERBS.has(w)) return false;
        // "… to that enemy AND gains …" / "loses Overload AND gains …" (Stalwart, Ravager) is a
        // COMPOUND predicate — "and" carries the subject over from an earlier, unrelated clause
        // (an elided "it"/"this Unit"), so an "enemy" beyond "and" is never this verb's subject.
        // The genuine bug shape ("an enemy defender gains X") never has "and" in between.
        if (w === 'and') return false;
    }
    return false;
}

/**
 * Scans backward through preceding text segments to find the nearest application verb,
 * stopping at sentence boundaries (. ; <br>) or MAX_SCAN_CHARS.
 * Returns the verb string, null if a skip verb was found first, or undefined if none found.
 */
function findVerb(segments: SkillTextSegment[], tagIndex: number): string | null | undefined {
    let accumulatedText = '';
    let charCount = 0;

    for (let i = tagIndex - 1; i >= 0; i--) {
        const seg = segments[i];
        if (seg.type !== 'text') continue; // non-text segments don't reset context

        const text = seg.text;
        // Find the last sentence boundary in this segment
        const boundaryMatches = [...text.matchAll(/[.;]|<br\s*\/?>/gi)];
        if (boundaryMatches.length > 0) {
            const last = boundaryMatches[boundaryMatches.length - 1];
            const afterBoundary = text.slice((last.index ?? 0) + last[0].length);
            accumulatedText = afterBoundary + accumulatedText;
            break;
        }

        charCount += text.length;
        if (charCount > MAX_SCAN_CHARS) {
            const take = text.length - (charCount - MAX_SCAN_CHARS);
            accumulatedText = text.slice(text.length - take) + accumulatedText;
            break;
        }
        accumulatedText = text + accumulatedText;
    }

    // Scan words right-to-left (closest to tag first)
    const words = accumulatedText.toLowerCase().match(/\b[a-z]+\b/g) ?? [];
    for (let i = words.length - 1; i >= 0; i--) {
        if (APPLICATION_VERBS.has(words[i])) {
            // "newly applied X" is adjectival (referencing an existing effect being
            // extended), not an application — keep scanning for a real verb instead.
            if (words[i - 1] === ADJECTIVAL_MARKER) continue;
            // Epic PR1 (skill-model gap, finding family 3): "when an enemy [defender] gains
            // <BuffName>, this Unit inflicts …" names the buff only as the TRIGGER condition —
            // the grammatical subject of "gains" is the ENEMY, not this Unit. Without this
            // check a self-grant verb (gains/grants) minted a phantom self-buff regardless of
            // subject (Amartya: "gains Taunt" read as This-Unit-gains-Taunt). Keep scanning past
            // it for an earlier governing verb (or none) instead of returning it.
            if (SELF_VERBS.has(words[i]) && hasEnemySubject(words, i)) continue;
            return words[i];
        }
        if (SKIP_VERBS.has(words[i])) return null;
    }
    // "starts each round with <buff>" carries no application verb in the scanned text — treat
    // the construct as a self-receive so the segment loop extracts the conjoined buffs.
    if (STARTS_ROUND_WITH_RE.test(accumulatedText)) return 'gains';
    return undefined;
}

/**
 * Maps a verb to a target side, cross-referencing BUFFS type for the ambiguous "apply" forms.
 * An "apply" verb with a buff-type effect → self; anything else → enemy.
 *
 * `followingText` (the text segment immediately after the buff-name tag) carries an explicit
 * self-referential object when present — "applies <Buff> TO ITSELF" (Panon's Barrier
 * Recharging, registered as a debuff-typed status even though Panon applies it to itself as a
 * self-buff gate). That explicit object overrides the BUFFS-type heuristic, which would
 * otherwise misroute it to 'enemy' purely because the named status happens to be registered
 * type:'debuff' (Finding B3). No corpus "applies" clause pairs an unrelated "itself" in the
 * immediately-following text with an actual enemy-targeted debuff (verified against
 * docs/ship-skills.csv), so this is safe to check unconditionally for apply forms.
 */
function verbToTarget(
    verb: string,
    buffName: string,
    followingText: string = ''
): 'self' | 'enemy' {
    if (SELF_VERBS.has(verb)) return 'self';
    if (ENEMY_VERBS.has(verb)) return 'enemy';
    if (/\bitself\b/i.test(followingText)) return 'self';
    // A friendly-side negative status is player-side whatever its BUFFS type says, so a
    // receiver-less "applies <status>" inherits the clause's ally receiver instead of falling
    // through to 'enemy' (Quixilver's Barrier Recharging). Panon's "to itself" is already handled
    // above, so this only ever widens the receiver-LESS phrasing.
    if (isFriendlySideStatus(buffName)) return 'self';
    // apply forms: use BUFFS type to disambiguate
    const found = BUFFS.find((b) => b.name === buffName);
    return found?.type === 'buff' ? 'self' : 'enemy';
}

// Single-ally phrasings: "the ally with/in …", "the other ally", "an ally", "an adjacent ally" (singular),
// and the pronoun forms a single-ally grant uses for its receiver ("grants them/it/that ally X").
// "all (adjacent) allies"/"allies" plural is handled by the all-allies branch first, so a
// bare "allies" never reaches this — only a singular "ally" does.
const SINGLE_ALLY_RE =
    /\bthe (?:other )?ally\b|\ban ally\b|\ban adjacent ally\b|\bthat ally\b|\bthem\b/i;
// Ally-scoped (team-wide) grant phrasings: bare plural "allies" (subsumes "all allies"), "friendly …".
// Note: bare "allies" subsumes "all allies", so the explicit "all allies" alternative is omitted.
const ALL_ALLIES_RE = /friendly|allies/i;
// Ship-kit W8 Task 1 (Lionheart): a receiver naming "(all) adjacent allies" bare — the crit-buff
// grant "grants Attack Up II to all adjacent allies for 1 turn." — is board-adjacency scoped, not
// team-wide. Tested BEFORE ALL_ALLIES_RE, which would otherwise match the "allies" substring and
// swallow it as all-allies.
//
// A receiver that names BOTH ("grants X to itself and all adjacent allies" — Tormenter, the only
// such clause corpus-wide) is the union of two DISJOINT sets, since `adjacentAllyIds` excludes the
// owner. It used to route all-allies, which reached every ally on the board; owner-ruled wrong
// 2026-08-30 (only the caster and its board neighbours take the buff), so it now resolves to the
// PAIR ['self', 'adjacent-allies'] — see detectGrantScopes.
const ADJACENT_ALLIES_RE = /\badjacent allies\b/i;
// A grant whose receiver is explicitly the caster ("grants itself X").
const SELF_RECEIVER_RE = /\bitself\b/i;
// Granting (bestowing) verbs — the caster confers the buff on a (possibly explicit) receiver.
const GRANT_VERB_RE = /\bgrants?\b|\bgranted\b|\bgranting\b/i;
// Receiving verbs — the subject (This Unit) takes the buff onto itself; no external receiver.
const SELF_RECEIVE_VERB_RE = /\bgains?\b|\bgaining\b|\bgained\b|\bhas\b|\bhave\b/i;
// Any verb that introduces a player-side buff (grant or self-receive); used to bound a buff's
// own grant span so a sibling grant's receiver doesn't leak across verbs.
const ANY_GRANT_VERB_RE =
    /\bgrants?\b|\bgranted\b|\bgranting\b|\bgains?\b|\bgaining\b|\bgained\b|\bhas\b|\bhave\b/gi;

// Strips trigger/condition sub-clauses from a resolved (single-sentence) grant clause so an
// ally reference INSIDE a condition ("after an ally is critically repaired", "when an ally is
// directly damaged, …") isn't mistaken for the buff's receiver. Two comma/clause-boundary
// anchored forms, lookbehind-free (iOS Safari 15):
//  - leading:  "When/After/While/If … , <receiver clause>"  → drop up to the first comma
//  - trailing: "<condition clause> when/after/while/if …"   → drop from the keyword onward,
//    UNLESS that trailing condition is itself followed by ", this Unit grants/applies/gives …"
//    (Quixilver), in which case the strip stops right before that comma so the receiver
//    clause survives (ship-kit W8 Task 6).
// The receiver phrasing ("this Unit grants the ally X" / "X allies gain Y") survives, so a
// genuine post-condition ally receiver (Provider: "…, this Unit grants the ally RoT III") is
// still classified ally. The clause is the same one `resolveBuffClause` already split on
// abbreviation-masked sentence boundaries, so "Inc."/"Out." periods never reach here as
// boundaries; condition keywords are matched on word boundaries only.
function stripConditionClauses(clause: string): string {
    let out = clause;
    // Leading "When/After/While/If … ," — only when it precedes the rest via a comma.
    out = out.replace(/^\s*(?:when|after|while|if)\b[^,]*,\s*/i, '');
    // Trailing " when/after/while/if …" condition (to end of clause) — receiver-aware
    // (ship-kit W8 Task 6): when the condition is itself followed by a comma and a
    // "this Unit grants/applies/gives …" receiver clause (Quixilver: "…if it has shield equal
    // to 100% of its max HP, this Unit grants all allies Barrier…"), the strip stops right
    // before that comma so the receiver clause survives instead of being deleted wholesale.
    // Scoped narrowly to the literal "this unit <verb>" receiver phrasing (matched on the
    // already-lowercased clause) so ships whose trailing condition has NO such receiver clause
    // after it still get the original full-strip-to-end-of-clause behavior via the fallback
    // alternative.
    out = out.replace(
        /\s+\b(?:when|after|while|if)\b(?:[\s\S]*?(?=,\s*this unit (?:grants|applies|gives)\b)|[\s\S]*)/i,
        ''
    );
    return out;
}

/**
 * Isolates the SPAN of a clause governed by the buff's own granting verb, so a sibling grant's
 * receiver in the same sentence doesn't leak onto this buff. The span runs from the verb that
 * governs this buff (the nearest player-side buff verb at or before the buff name) up to the next
 * such verb (or end of clause). Receivers can sit either between the verb and the buff
 * ("grants all allies X") or after the buff ("grants X to all allies"), so the whole span is kept.
 * Returns the verb-token and the span text. No lookbehind (iOS Safari 15).
 */
function buffGrantSpan(
    clause: string,
    buffStart: number
): { verb: string | null; subject: string; object: string } {
    // Collect every player-side buff verb position in the clause.
    ANY_GRANT_VERB_RE.lastIndex = 0;
    const verbs: { index: number; end: number; token: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = ANY_GRANT_VERB_RE.exec(clause)) !== null) {
        verbs.push({ index: m.index, end: m.index + m[0].length, token: m[0].toLowerCase() });
    }
    // Governing verb = the last verb that starts at or before the buff name.
    let govIdx = -1;
    for (let i = 0; i < verbs.length; i++) {
        if (verbs[i].index <= buffStart) govIdx = i;
        else break;
    }
    if (govIdx === -1) {
        // No verb precedes the buff (defensive): no subject/object split, whole clause as object.
        return { verb: null, subject: '', object: clause };
    }
    // Subject = text from the previous verb's clause boundary up to this verb (who acts).
    // Object  = text from this verb up to the next verb (what/whom the verb governs).
    const subjStart = govIdx > 0 ? verbs[govIdx - 1].end : 0;
    const subject = clause.slice(subjStart, verbs[govIdx].index);
    const objEnd = govIdx + 1 < verbs.length ? verbs[govIdx + 1].index : clause.length;
    const object = clause.slice(verbs[govIdx].end, objEnd);
    return { verb: verbs[govIdx].token, subject, object };
}

/**
 * Finds the character position of the (0-based) Nth occurrence of `name` inside `text` via
 * repeated plain substring search — a direct generalization of the single-occurrence
 * `text.indexOf(name)` `detectGrantScope` used before ship-kit W8 Task 2. Returns -1 only when
 * NO occurrence exists; if fewer than `occurrenceIndex + 1` occurrences exist, returns the LAST
 * occurrence actually found (defensive: an out-of-range index degrades to "closest available"
 * rather than losing position entirely).
 */
function findNthOccurrencePos(text: string, name: string, occurrenceIndex: number): number {
    let pos = -1;
    let searchFrom = 0;
    for (let n = 0; n <= occurrenceIndex; n++) {
        const idx = text.indexOf(name, searchFrom);
        if (idx === -1) return pos;
        pos = idx;
        searchFrom = idx + name.length;
    }
    return pos;
}

/**
 * Resolves the player-side ally-scope of a granted buff from its GRANTING CLAUSE, using the
 * same masking-aware clause resolver (`resolveBuffClause`) as condition detection so "Inc."/
 * "Out." abbreviation periods don't break sentence splitting.
 *
 * Verb-aware routing (the binding rule: a receiver-less GRANT goes to ALL players):
 *  - RECEIVING verb ("<subject> gains/has X") — the SUBJECT keeps the buff:
 *      · team subject ("all allies gain X" / "friendly units gain X")        → 'all-allies'
 *      · single-ally subject ("the ally with … gains X")                     → 'ally'
 *      · This-Unit / no subject ("This Unit gains X")                        → 'self'
 *  - BESTOWING verb ("grants") — the OBJECT (receiver) takes the buff:
 *      · explicit self receiver ("grants itself X")                          → 'self'
 *      · bare adjacency receiver ("grants X to all adjacent allies")         → 'adjacent-allies'
 *      · self + adjacency ("grants X to itself and all adjacent allies")     → BOTH of the above
 *      · team receiver ("grants all allies X" / "grants X to all allies")    → 'all-allies'
 *      · single-ally receiver ("grants the/an/that ally X", "grants them X") → 'ally'
 *      · NO explicit receiver ("This Unit grants X")                         → 'all-allies'
 *
 * Returns a LIST because of that one combined receiver: the caster and its board neighbours are
 * disjoint recipient sets (`adjacentAllyIds` excludes the owner) and no single scope spans them.
 * Every other phrasing returns exactly one entry, so the caller's fan-out is a no-op for them.
 *
 * Subject/object are taken from the buff's own grant span (its verb, the text before it back to
 * the previous verb = subject, the text after it up to the next verb = object) so a sibling
 * grant's receiver in the same sentence doesn't bleed across.
 *
 * For the attacker's own sim 'self' and 'all-allies' are equivalent (both fold onto the
 * attacker's side); the distinction only matters when the engine walks a team ship's grants.
 *
 * `occurrenceIndex` (0-based, ship-kit W8 Task 2): a SAME buff name can be granted to two
 * DIFFERENT scopes within one clause (Centurion's charge: "This Unit gains 4 stacks of Core
 * Charge I and grants all adjacent allies 2 stacks of Core Charge I …" — self, then
 * adjacent-allies). Resolving scope from the buff name's FIRST occurrence (plain `indexOf`)
 * would make every grant of that name in the clause resolve identically, silently collapsing
 * the second grant's scope onto the first. The caller (parseSkillEffects, which already walks
 * one <unit-skill> segment per occurrence) passes which occurrence this call is for so the
 * governing verb/receiver is read from THAT grant's own span. Defaults to 0 (first occurrence)
 * — byte-identical for every buff name granted only once in its clause.
 */
type AllyGrantScope = 'self' | 'ally' | 'all-allies' | 'adjacent-allies';

// The one combined receiver, as its two disjoint halves. Ordered self-first so the fan-out's
// first-emitted ability is the caster's own grant (matches Centurion's self-then-adjacent order).
const SELF_AND_ADJACENT: readonly AllyGrantScope[] = ['self', 'adjacent-allies'];

function detectGrantScopes(
    skillText: string,
    buffName: string,
    occurrenceIndex = 0
): readonly AllyGrantScope[] {
    const at = resolveBuffClauseAt(skillText, buffName, occurrenceIndex);
    const resolved = at.clause.toLowerCase();
    // Strip trigger/condition sub-clauses so an ally mentioned only as the TRIGGER ("after an
    // ally is critically repaired") doesn't leak ally-scope onto a buff the caster grants itself.
    const clause = stripConditionClauses(resolved);
    const buffStart = findNthOccurrencePos(clause, buffName.toLowerCase(), at.localIndex);
    const { verb, subject, object } = buffGrantSpan(
        clause,
        buffStart === -1 ? clause.length : buffStart
    );

    // Receiving verb (gains/has) → route by the SUBJECT (who receives onto itself).
    if (verb !== null && SELF_RECEIVE_VERB_RE.test(verb)) {
        if (ALL_ALLIES_RE.test(subject)) return ['all-allies'];
        if (SINGLE_ALLY_RE.test(subject)) return ['ally'];
        return ['self'];
    }

    // Bestowing verb (grants) → route by the OBJECT (the receiver of the grant). Adjacency is
    // tested BEFORE the team and self receivers: "all adjacent allies" contains the "allies"
    // substring ALL_ALLIES_RE matches, and the combined "itself and all adjacent allies" contains
    // both scope words, so either later branch would swallow it. "itself" alongside adjacency
    // WIDENS the recipient set by exactly the caster (Tormenter); "itself" alone pins to self
    // (Nuqtu's "grants itself").
    if (verb !== null && GRANT_VERB_RE.test(verb)) {
        if (ADJACENT_ALLIES_RE.test(object)) {
            return SELF_RECEIVER_RE.test(object) ? SELF_AND_ADJACENT : ['adjacent-allies'];
        }
        if (ALL_ALLIES_RE.test(object)) return ['all-allies'];
        if (SINGLE_ALLY_RE.test(object)) return ['ally'];
        if (SELF_RECEIVER_RE.test(object)) return ['self'];
        // Receiver-less grant → all players (the locked routing rule).
        return ['all-allies'];
    }

    // No identifiable verb (defensive): fall back to the prior phrasing-only heuristic.
    if (SINGLE_ALLY_RE.test(clause)) return ['ally'];
    if (ADJACENT_ALLIES_RE.test(clause)) {
        return SELF_RECEIVER_RE.test(clause) ? SELF_AND_ADJACENT : ['adjacent-allies'];
    }
    if (ALL_ALLIES_RE.test(clause)) return ['all-allies'];
    return ['self'];
}

// Recipient-STATE filters (`Ability.recipientFilter`). A clause can qualify WHICH of the allies it
// names actually receive the effect, on axes the roster-level scopes cannot express. Corpus-wide
// (docs/ship-skills.csv, 2026-08-30) exactly one ship does — Chimei's R2, which names both shapes:
//
//   "non-defender allies below 40% HP are granted <Stealth> for 1 turn"
//   "all allies with <Stealth> repairs 10% of this unit's max HP"
//
// Both regexes are anchored on the FULL phrase, not on a keyword. That is deliberate, and it is
// the calibration lesson the scope/trigger censuses already paid for: "below 40% HP" appears all
// over the corpus as a SELF gate ("if its HP is below 50%") and as an ENEMY gate ("when the target
// is below 30% HP"), and "with Stealth" appears as a SCALING source ("for every enemy with
// Stealth"). Requiring the literal "allies" noun between the qualifier and the effect is what
// keeps every one of those out. Widen only after reading what the current form misses.
const RECIPIENT_NON_ROLE_HP_RE =
    /\bnon-(defender|attacker|supporter|debuffer)s?\s+allies\s+below\s+(\d+)\s*%\s*hp\b/i;
// "all allies with <Status>". The status name reaches this detector TAGGED on the buff path
// (`resolveBuffClause` preserves the row's markup) and STRIPPED on the heal path
// (`healSentence` runs through `stripTags`), so both forms are accepted. In the stripped form the
// name's extent is bounded by capitalisation — a status name is Title Case ("Stealth", "Repair
// Over Time II") and the verb that follows it is not ("… with Stealth repairs 10%") — and then
// validated through `resolveBuffName`, so a phrase that merely reads "all allies with …"
// something that is not a status yields no filter at all rather than a silent mute.
const RECIPIENT_HAS_STATUS_RE =
    /\ball allies with\s+(?:<unit-skill>([^<]+)<\/unit-skill>|([A-Z][\w'’.]*(?:\s+[A-Z][\w'’.]*){0,3}))/;

/**
 * The recipient-state filter a clause names, or undefined when it names none.
 *
 * `clause` must be the TAGGED text of the sentence the ability was parsed from (the buff's own
 * resolved clause, or a heal's `healSentence`) — passing the whole multi-sentence row would let a
 * sibling sentence's qualifier leak onto an ability it does not describe, which is the same
 * clause-scoping rule `detectGrantFactionScope` already follows.
 */
export function detectRecipientFilter(clause: string): RecipientFilter | undefined {
    const filter: RecipientFilter = {};
    const roleHp = RECIPIENT_NON_ROLE_HP_RE.exec(clause);
    if (roleHp) {
        // Through the SAME word→category map `roleFilter` uses, never a bare `toUpperCase()` —
        // that is what keeps the recipient axis and the trigger axis naming roles identically.
        const category = ROLE_WORD_TO_CATEGORY[roleHp[1].toLowerCase()];
        if (category !== undefined) {
            filter.notRole = [category];
            filter.hpBelowPct = parseInt(roleHp[2], 10);
        }
    }
    const hasStatus = RECIPIENT_HAS_STATUS_RE.exec(clause);
    if (hasStatus) {
        const canonical = resolveBuffName((hasStatus[1] ?? hasStatus[2]).trim());
        // An unrecognised name is dropped rather than stored raw: `hasStatus` is matched against
        // the engine's own status names, so a name that is not one of them would filter out every
        // recipient forever — a silent mute, not a narrowing.
        if (canonical) filter.hasStatus = canonical;
    }
    return Object.keys(filter).length > 0 ? filter : undefined;
}

/**
 * The recipient-state filter on a BUFF GRANT's own clause, or undefined when it names none.
 *
 * Resolves the clause the same way `detectGrantScope`/`detectGrantFactionScope` do
 * (`resolveBuffClause`, so "Inc."/"Out." abbreviation periods don't break sentence splitting),
 * then applies {@link detectRecipientFilter}. Reading the whole row instead would let a sibling
 * sentence's qualifier attach to a grant it does not describe — Chimei's passive is exactly that
 * hazard, since its three sentences each carry a different recipient rule.
 */
export function detectGrantRecipientFilter(
    skillText: string,
    buffName: string,
    occurrenceIndex = 0
): RecipientFilter | undefined {
    return detectRecipientFilter(resolveBuffClause(skillText, buffName, occurrenceIndex));
}

// #363 (Fuying): faction words appear in the corpus in TWO roles, and only one is a recipient
// scope. Measured over all 149 ships (docs/ship-skills.csv, 2026-08-22): 4 recipient-scoped
// clauses (all Fuying — her active Stealth grant plus the three refit tiers of her damage-
// reduction aura) vs 31 where the faction is part of a BUFF NAME ("Tianchao Precision II",
// "XAOC Swiftness III", "Binderburg Resilience III", "Everliving Regeneration II",
// "Gelecek Contagion II").
//
// The discriminator is the following noun: a scope reads "<Faction> allies", a name reads
// "<Faction> <Something-else>". Requiring `all(y|ies)` IMMEDIATELY after the faction word keeps
// all 31 buff-name clauses out with no ship-name special-casing. Note that "allies" appearing
// anywhere later in the clause is NOT enough — Los's "grants XAOC Swiftness III to all allies"
// carries both the faction-named buff and a team receiver, and must not read as a faction scope.
const FACTION_SCOPE_RES: readonly (readonly [FactionKey, RegExp])[] = FACTION_KEYS.map(
    (key) =>
        [key, new RegExp(`\\b${escapeRegExp(FACTIONS[key].name)}\\s+all(?:y|ies)\\b`, 'i')] as const
);

/**
 * Faction scope on a buff GRANT's recipient phrase, or undefined when the clause names none.
 *
 * Reads the SAME span `detectGrantScope` routes on (`resolveBuffClause` → `buffGrantSpan`), so
 * the scope and its faction can never disagree about which clause they describe. Scanning the
 * whole skill text instead would let a sibling sentence's faction leak onto this grant.
 */
export function detectGrantFactionScope(
    skillText: string,
    buffName: string,
    occurrenceIndex = 0
): FactionKey[] | undefined {
    const at = resolveBuffClauseAt(skillText, buffName, occurrenceIndex);
    const clause = stripConditionClauses(at.clause.toLowerCase());
    const buffStart = findNthOccurrencePos(clause, buffName.toLowerCase(), at.localIndex);
    const { subject, object } = buffGrantSpan(clause, buffStart === -1 ? clause.length : buffStart);
    // A bestowing verb names its receiver in the OBJECT; a receiving verb ("gains") in the
    // SUBJECT. Scan both — which one carries it is the verb's business, not ours.
    const span = `${subject} ${object}`;
    const hits = FACTION_SCOPE_RES.filter(([, re]) => re.test(span)).map(([key]) => key);
    return hits.length > 0 ? hits : undefined;
}

// "all enemies adjacent to X" must NOT match the plain all-enemies widen. Two flavours:
//  - "the targeted enemy and all enemies adjacent to it/the enemy" → anchor INCLUDED
//  - "(to) all enemies adjacent to the (original) target"           → anchor EXCLUDED
//  - "all adjacent enemies" (bare, no "target"/"to" — Demolisher's passive bomb-splash:
//    "deals 100% of the Bomb's damage to all adjavent enemies") → anchor EXCLUDED, same
//    scope as the "to ... target" flavour above.
// Tolerates the docs/ship-skills.csv "adjavent" typo.
const TARGET_AND_ADJACENT_ENEMY_RE =
    /targeted\s+enemy\s+and\s+all\s+enem(?:y|ies)\s+adja[cv]ent\s+to\s+(?:it|the\s+enemy)/i;
const ADJACENT_ENEMY_ONLY_RE =
    /all\s+enem(?:y|ies)\s+adja[cv]ent\s+to\s+(?:the\s+)?(?:original\s+)?target|all\s+adja[cv]ent\s+enem(?:y|ies)/i;

/**
 * Detects whether a resolved (sentence/sub-clause scoped) buff clause carries one of the two
 * enemy-adjacency phrasings, returning the matching `AbilityTarget` scope or null when neither
 * applies. Exported so later tasks (DoT adjacency, engine fan-out) can reuse the same detection.
 */
export function detectAdjacentEnemyScope(
    clause: string
): 'adjacent-enemies' | 'target-and-adjacent-enemies' | null {
    if (TARGET_AND_ADJACENT_ENEMY_RE.test(clause)) return 'target-and-adjacent-enemies';
    if (ADJACENT_ENEMY_ONLY_RE.test(clause)) return 'adjacent-enemies';
    return null;
}

// Within an already sentence-scoped clause, isolate the sub-clause that OWNS `buffName` by
// splitting on the "then" connector (Asphyxiator joins Defense Down III + Inferno III with
// "then" in one sentence, so Defense Down III's clause would otherwise wrongly see the Inferno
// adjacency phrase). Returns the sub-clause containing the buff name, or the whole clause if not
// split (or if the buff name isn't found in any part — defensive fallback). Used only for
// adjacency/scope detection; deliberately does NOT touch `resolveBuffClause` itself, which is
// corpus-wide and used by many other detectors.
function narrowToBuffSubClause(clause: string, buffName: string): string {
    const parts = clause.split(/\bthen\b/i);
    const maskedName = maskAbbrev(buffName).toLowerCase();
    const owning = parts.find((p) => findBuffNamePos(maskAbbrev(p).toLowerCase(), maskedName) >= 0);
    return owning ?? clause;
}

/**
 * Resolve the enemy-adjacency scope for a named effect (DoT type name, buff name, control
 * effect) using the same clause resolution the debuff-scope path uses: sentence-scope via
 * resolveBuffClause, then narrow to the name's "then"-sub-clause, then adjacency-match.
 * Returns null when the effect's clause carries no enemy-adjacency phrasing.
 */
export function adjacentEnemyScopeForName(
    skillText: string,
    name: string
): 'adjacent-enemies' | 'target-and-adjacent-enemies' | null {
    const resolved = resolveBuffClause(skillText, name).toLowerCase();
    return detectAdjacentEnemyScope(narrowToBuffSubClause(resolved, name));
}

/**
 * Position-scoped enemy-adjacency resolver for a NAMELESS damage clause (a base-damage ability
 * has no buff name to anchor on, unlike adjacentEnemyScopeForName). Mirrors phrasePosTrigger's
 * raw-text sentence scoping (rawSentenceAround) so `anchorPos` — a position into the raw `text`,
 * same basis as the trigger detectors' `damagePos` — maps to the sentence actually carrying the
 * damage clause, and an unrelated adjacency phrase elsewhere in the text can't leak in.
 * Ship-kit W5 (Demolisher passive): "... deals 100% of the Bomb's damage to all adjavent
 * enemies" resolves to 'adjacent-enemies'.
 */
export function adjacentEnemyScopeAtPos(
    text: string,
    anchorPos: number
): 'adjacent-enemies' | 'target-and-adjacent-enemies' | null {
    const sentence = rawSentenceAround(text, anchorPos);
    return sentence === undefined ? null : detectAdjacentEnemyScope(sentence);
}

/**
 * Resolves the enemy-side scope of an inflicted/applied debuff from its granting clause, mirroring
 * `detectGrantScope`'s clause resolution (`resolveBuffClause`, so "Inc."/"Out." abbreviation
 * periods don't break sentence splitting) but testing for an "all enemies" receiver instead of an
 * ally one. Same broad, sentence-level phrasing check `parsePurge` uses for its own 'enemy' vs
 * 'all-enemies' split (`/all\s+enemies/`) — most debuffs are single-target ('enemy'); only an
 * explicit "on all enemies" grant widens to the whole opposing team.
 *
 * Enemy-adjacency phrasing ("all enemies adjacent to X") is checked FIRST, on the buff's own
 * sub-clause (narrowToBuffSubClause) rather than the whole sentence, so it both (a) doesn't get
 * mistaken for the plain all-enemies widen and (b) doesn't leak across a "then"-joined sibling
 * clause in the same sentence (Asphyxiator: Defense Down III + Inferno III adjacency).
 *
 * The plain all-enemies fallback deliberately runs on the UNNARROWED `resolved` sentence (minus
 * any adjacency phrasing, stripped below) rather than the narrowed sub-clause: Curator's charge
 * ("deals 125% damage to all enemies, then inflicts ... Crit Rate Down III") is a genuine
 * corpus idiom where a "then"-joined debuff inherits the ANTECEDENT clause's "all enemies"
 * receiver — narrowing to the debuff's own sub-clause would wrongly lose that and collapse it to
 * 'enemy'. Only the literal adjacency phrasing (already positively identified by
 * detectAdjacentEnemyScope's regexes) is stripped first, so a sibling "then"-joined ADJACENCY
 * clause (Asphyxiator: Defense Down III + Inferno III) still can't fool the plain /all\s+enemies/
 * substring test into widening a clause that was never enemy-adjacent.
 */
export function detectEnemyGrantScope(
    skillText: string,
    buffName: string,
    occurrenceIndex = 0
): 'enemy' | 'all-enemies' | 'adjacent-enemies' | 'target-and-adjacent-enemies' {
    const resolved = resolveBuffClause(skillText, buffName, occurrenceIndex).toLowerCase();
    const scoped = narrowToBuffSubClause(resolved, buffName);
    const adjacent = detectAdjacentEnemyScope(scoped);
    if (adjacent) return adjacent;
    const withoutAdjacencyPhrasing = resolved
        .replace(TARGET_AND_ADJACENT_ENEMY_RE, '')
        .replace(ADJACENT_ENEMY_ONLY_RE, '');
    return /all\s+enemies/.test(withoutAdjacencyPhrasing) ? 'all-enemies' : 'enemy';
}

/**
 * Maps a verb to how a debuff lands: "inflict" forms are resistible, "apply" forms are
 * guaranteed. Only meaningful for enemy debuffs; returns undefined for self-buff verbs.
 */
function verbToApplication(verb: string): 'inflict' | 'apply' | undefined {
    if (ENEMY_VERBS.has(verb)) return 'inflict';
    if (AMBIGUOUS_VERBS.has(verb)) return 'apply';
    return undefined;
}

export function parseSkillEffects(
    skillText: string | null | undefined,
    source: SkillSource
): SkillEffect[] {
    if (!skillText) return [];

    const segments = parseSkillText(skillText);
    const effects: SkillEffect[] = [];
    // Ship-kit W8 Task 2: counts how many <unit-skill> tags of THIS buff name have already been
    // walked, so a buff name granted twice in one clause (Centurion: self x4 + adjacent-allies
    // x2, same "Core Charge I") resolves each occurrence's scope independently instead of both
    // collapsing onto the first grant's scope. Incremented for every tagged occurrence (even one
    // later skipped for lacking a verb) so the count always matches this segment's true position
    // among the buff name's occurrences in the raw text.
    const buffNameOccurrence = new Map<string, number>();

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (seg.type !== 'unit-skill') continue;

        const buffName = seg.text;
        const occurrenceIndex = buffNameOccurrence.get(buffName) ?? 0;
        buffNameOccurrence.set(buffName, occurrenceIndex + 1);

        // Step 1: Find application verb
        const verb = findVerb(segments, i);
        if (verb === null || verb === undefined) continue; // skip verb or no verb

        // Text immediately following the buff-name tag — used both as verbToTarget's explicit-
        // object override (Step 2) and as the duration scan source (Step 3).
        const nextText = segments[i + 1]?.type === 'text' ? segments[i + 1].text : '';

        // Step 2: Target + how the effect lands (inflict = resistible, apply = guaranteed).
        // Player-side grants get ally-scope granularity from the granting clause (team walk);
        // enemy debuffs get enemy-scope granularity ('enemy' vs 'all-enemies') the same way.
        const side = verbToTarget(verb, buffName, nextText);
        // A player-side grant can name TWO disjoint recipient sets in one receiver ("to itself and
        // all adjacent allies"), so the scope resolver returns a list; every other phrasing —
        // and every enemy-side debuff — yields exactly one entry.
        const targets: readonly SkillEffect['target'][] =
            side === 'self'
                ? detectGrantScopes(skillText, buffName, occurrenceIndex)
                : [detectEnemyGrantScope(skillText, buffName, occurrenceIndex)];
        const application = side === 'enemy' ? verbToApplication(verb) : undefined;

        // Step 3: Duration from immediately following text segment
        let duration: number | 'recurring' | null = null;
        const durationMatch = DURATION_RE.exec(nextText);
        if (durationMatch) {
            duration = parseInt(durationMatch[1], 10);
        } else if (RECURRING_RE.test(nextText)) {
            duration = 'recurring';
        } else {
            // Shared duration: "inflicts X and Y for 2 turns" — X has no immediate duration,
            // but scanning forward finds the duration that applies to the whole group.
            duration = findSharedDuration(segments, i + 1);
            // Epic PR5 finding 2: a LEADING shared duration stated before the verb ("for 3
            // turns, grants both X and Y") — the forward scan can't find it since it's behind
            // the tag, not ahead of it.
            if (duration === null) {
                duration = findLeadingDuration(segments, i);
            }
        }

        // Step 4: Stack detection from immediately preceding text segment
        const prevText = segments[i - 1]?.type === 'text' ? segments[i - 1].text : '';
        const stackMatch = STACKS_RE.exec(prevText);
        const stacks = stackMatch ? parseInt(stackMatch[1], 10) : undefined;
        // Only use 'recurring' from stacks if no finite duration was found
        if (stacks !== undefined && duration === null) {
            duration = 'recurring';
        }

        // Cheat Death (and any CHEAT_DEATH_BUFFS member) is an until-triggered, no-payload
        // named buff: it is consumed only on a lethal hit, never by the StatusEngine's per-turn
        // decrement. Force a non-decrementing 'recurring' duration regardless of any nearby
        // "for N turns" text — e.g. Tycho's "gains Cheat Death and Everliving Regeneration I for
        // 6 turns" must NOT leak the 6-turn window onto Cheat Death via the shared-duration scan.
        if (CHEAT_DEATH_BUFFS.has(buffName)) {
            duration = 'recurring';
        }

        // Detect accumulating buffs: stacks gained per trigger with a recurring duration.
        // passive sources → per-round; active/charge → per-active/per-charge.
        // SP-G G1b EXCEPTION: a start-of-combat "N stacks" grant (Meatshield) is a ONE-TIME
        // grant, not a per-turn accumulator — leave stackTrigger undefined so buildShipAbilities'
        // isAccumulatingBuff gate is false and the pre-combat relabel fires. The N-stack count and
        // the persistent 'recurring' duration are preserved (seeded once at combat start).
        let stackTrigger: StackTrigger | undefined;
        // Scope the one-shot check to the CURRENT sentence only (text since the last sentence
        // boundary), not the whole prevText blob — a multi-sentence passive can carry an earlier,
        // unrelated "at the start of combat" clause (Lionheart's HP-grant sentence precedes its
        // round-start Protection grant with no intervening tag) that would otherwise false-positive
        // the later per-round grant as a one-shot. Verified corpus-wide unique to Lionheart.
        // NB: this raw `lastIndexOf('.')` sentence split does NOT mask buff-name abbreviation
        // periods ("Inc."/"Out."), unlike the sentence-split scoping in skillTextParser's clause
        // splitter and auditSkills. Safe today because such abbreviation periods live inside
        // `<unit-skill>` tags, not in the inter-tag text `prevText` reads here — but a future
        // untagged abbreviation clause could over-narrow this current-sentence slice.
        const lastSentenceBoundary = prevText.lastIndexOf('.');
        const currentClauseText =
            lastSentenceBoundary === -1 ? prevText : prevText.slice(lastSentenceBoundary + 1);
        const startOfCombatOneShot = START_OF_COMBAT_GRANT_RE.test(currentClauseText);
        if (stacks !== undefined && duration === 'recurring' && !startOfCombatOneShot) {
            if (source === 'passive1' || source === 'passive2' || source === 'passive3') {
                stackTrigger = 'per-round';
            } else if (source === 'active') {
                stackTrigger = 'per-active';
            } else if (source === 'charge') {
                stackTrigger = 'per-charge';
            }
        }

        // Lionheart: a Protection grant is consumable (a redirected hit clears the whole pool) —
        // cap the round-start accumulation at the grant count (refresh-to-N) and tag it so the
        // engine (Task 4) clears stacks post-redirect. Meatshield sets no such clause on its OWN
        // accumulating/one-shot Protection grants, so it is unaffected (byte-identical).
        const isConsumableProtection =
            buffName === 'Protection' &&
            CLEAR_PROTECTION_ON_REDIRECT_RE.test(stripUnitTags(skillText));

        // One effect per resolved recipient set — a single push for every clause but the combined
        // "itself and all adjacent allies" receiver, which emits the same payload twice.
        for (const target of targets) {
            effects.push({
                buffName,
                target,
                duration,
                ...(stacks !== undefined ? { stacks } : {}),
                ...(stackTrigger !== undefined ? { stackTrigger } : {}),
                ...(application !== undefined ? { application } : {}),
                ...(isConsumableProtection && stacks !== undefined ? { maxStacks: stacks } : {}),
                ...(isConsumableProtection ? { clearAllOnRedirect: true } : {}),
                // Omitted at 0 — the overwhelming majority — so every single-occurrence effect
                // object stays byte-identical, matching how every other optional field here is
                // spread. Consumers read `?? 0`.
                ...(occurrenceIndex > 0 ? { occurrenceIndex } : {}),
                source,
            });
        }
    }

    // Supplementary pass: conjoined self-grants ("gains 1 charge … and <BuffName> for N turns")
    // whose trailing buff the segment loop missed (no governing verb of its own). Gated by BUFFS
    // membership and deduped against what the segment loop already emitted, so it adds only genuine
    // self-buffs and never double-emits. Always 'self' (the construct's verb is a self-grant).
    const alreadyEmitted = new Set(effects.map((e) => e.buffName));
    const rawText = skillText.replace(/<[^>]+>/g, ' ');
    let conjoined: RegExpExecArray | null;
    CONJOINED_SELF_GRANT_RE.lastIndex = 0;
    while ((conjoined = CONJOINED_SELF_GRANT_RE.exec(rawText)) !== null) {
        const canonical = resolveBuffName(conjoined[1]);
        if (!canonical || alreadyEmitted.has(canonical)) continue;
        alreadyEmitted.add(canonical);
        effects.push({
            buffName: canonical,
            target: 'self',
            // Cheat Death never expires on a timer (see segment-loop note above); keep the
            // conjoined path consistent so a trailing "and Cheat Death for N turns" can't stamp
            // a finite window either.
            duration: CHEAT_DEATH_BUFFS.has(canonical) ? 'recurring' : parseInt(conjoined[2], 10),
            source,
        });
    }

    // Supplementary pass (ship-kit W8 Task 7): a BARE, untagged "Stasis" conjoined onto a tagged
    // enemy inflict ("Inflicts <Speed Down II> for 2 turns and Stasis for 2 turn." — Xcellence's
    // active). The segment loop above only walks tagged <unit-skill> occurrences, so this trailing
    // enemy-side Stasis has no governing verb/tag of its own and would otherwise be silently
    // dropped (mirrors CONJOINED_SELF_GRANT_RE's shape, but for the ENEMY side). Scoped narrowly to
    // Stasis specifically — it is the only untagged inflict found corpus-wide (docs/ship-skills.csv)
    // — and anchored on "and Stasis for N turn(s)" so it never matches a bare mention of Stasis in
    // an unrelated clause (e.g. Defiant's "gains Shield ... when applying Stasis" has no trailing
    // duration and uses "applying", excluded from the verb set below). `turns?` tolerates the CSV's
    // "for 2 turn" singular typo, same tolerance as DURATION_RE.
    const BARE_STASIS_INFLICT_RE =
        /\b(?:inflicts?|applies)\b[^.]*?\band\s+Stasis\s+for\s+(\d+)\s*turns?/i;
    const bareStasis = BARE_STASIS_INFLICT_RE.exec(rawText);
    if (bareStasis && !alreadyEmitted.has('Stasis')) {
        alreadyEmitted.add('Stasis');
        effects.push({
            buffName: 'Stasis',
            target: 'enemy',
            duration: parseInt(bareStasis[1], 10),
            application: 'inflict',
            source,
        });
    }

    return effects;
}

export function parseAllSkillEffects(ship: Ship): SkillEffect[] {
    // Scan only the REFIT-ACTIVE passive — the same one buildShipAbilities resolves via
    // getShipSkillRows. Scanning all three columns produced duplicate/tier-conflicting auto-fill
    // entries for tier-inclusive passives (R0/R2/R4 each naming a different tier of one buff).
    const passiveRow = getShipSkillRows(ship).find((r) => r.label.startsWith('Passive'));
    // Tag the active passive with its ORIGINAL column source so downstream behaviour is unchanged:
    // (a) per-round stackTrigger fires for passive1/2/3; (b) slotForBuffSource maps it to 'passive'.
    const passiveSource: SkillSource =
        passiveRow?.label === 'Passive R4'
            ? 'passive3'
            : passiveRow?.label === 'Passive R2'
              ? 'passive2'
              : 'passive1';
    return [
        ...parseSkillEffects(ship.activeSkillText, 'active'),
        ...parseSkillEffects(ship.chargeSkillText, 'charge'),
        ...(passiveRow ? parseSkillEffects(passiveRow.text, passiveSource) : []),
    ];
}
