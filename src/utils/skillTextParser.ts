import { BUFFS } from '../constants/buffs';
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
import { AbilityTrigger, Condition, ConditionSubject, ControlEffect } from '../types/abilities';
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

/**
 * Returns the first <unit-damage>X% ...</unit-damage> value in skill text.
 * Skips values where the 20 characters after the tag start with " of its" or " of this"
 * (stat-based damage like "30% of its DEF" or "10% of this Unit's max HP" —
 * must be added manually as a buff).
 * Secondary damage tags (conditional/situational bonuses) are ignored.
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
        // <unit-damage> is also used for non-damage numbers (e.g. "7.5% defense
        // penetration", "repairs 20%"). Only treat it as a base multiplier when the
        // tag content or the following text actually mentions damage.
        const content = match[1].toLowerCase();
        if (!content.includes('damage') && !following.includes('damage')) continue;
        const numeric = parseInt(match[1], 10);
        if (!isNaN(numeric)) return numeric;
    }
    return 0;
}

/**
 * Returns the secondary stat-based damage from a skill, e.g.
 * "additional damage equal to <unit-damage>80%</unit-damage> of its Defense".
 * Captures only the BASE percentage — conditional extras
 * ("an extra 30% per enemy buff") are ignored. Supports Defense and max HP.
 * The percentage may be a decimal (e.g. Selenite's charged "17.5% of max HP").
 * Returns null if none found.
 */
export function parseSecondaryDamage(text: string | null | undefined): SecondaryDamage | null {
    if (!text) return null;
    // The percentage may sit at the start of the tag ("<unit-damage>80%…") or after a
    // "damage equal to" lead-in inside the tag ("<unit-damage>damage equal to 30%</unit-damage>
    // of its Defense", e.g. Nayra). The lead-in is restricted to "damage equal to" so unrelated
    // tagged values like "Shield equal to 25% of its Max HP" (FrontLine) are NOT misread as
    // secondary damage.
    const pattern =
        /<unit-damage>(?:damage\s+equal\s+to\s+)?(\d+(?:\.\d+)?)%[^<]*<\/unit-damage>\s*of\s+(?:its|this\s+unit'?s)\s+(defense|(?:max\s+)?hp)/i;
    const match = pattern.exec(text);
    if (!match) return null;
    // Clause guard: a match whose sentence is a heal ("repairs … an additional X% of
    // its Max HP") or a clearly-reactive Phase-4 proc ("When this Unit resists …",
    // "Upon being killed …") is NOT on-cast secondary damage. Sentence-scoped so an
    // earlier sentence's repair can't block a later legitimate secondary. NOTE: the
    // prefix keeps non-<br> tags inline (only sentence boundaries are normalized) —
    // sufficient for the known texts, where the guard words are plain prose.
    const plainBefore = text.slice(0, match.index).replace(/<br\s*\/?>/gi, '. ');
    const sentenceStart = Math.max(plainBefore.lastIndexOf('. '), plainBefore.lastIndexOf('; '));
    const sentencePrefix = plainBefore.slice(sentenceStart + 1).toLowerCase();
    if (/\brepair/.test(sentencePrefix)) return null;
    if (/\bresists?\b[^.]*\bdebuff|upon being killed|upon being destroyed/.test(sentencePrefix))
        return null;
    const pct = parseFloat(match[1]);
    if (isNaN(pct)) return null;
    const stat: SecondaryDamageStat = match[2].toLowerCase().includes('hp') ? 'hp' : 'defense';
    return { stat, pct };
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
    if (p.includes('buff on this unit')) return { condition: 'self-buff', derivable: true };
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
    return null;
}

// "if [this] critical[ly hits], … additional[ly] … N% damage" — extra damage dealt on a crit.
const CRIT_BONUS_RE =
    /\bif\s+(?:this\s+(?:unit\s+)?)?critical(?:ly\s+(?:hits?|damages?))?\b[^.]*?\badditional(?:ly)?\b[^.]*?(\d+(?:\.\d+)?)\s*%\s*damage/i;

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

// Phrases that disqualify a charge phrase from being a self-gain we model:
// ally-grant to others, on-kill (enemy never dies), enemy-repair (never repairs).
const CHARGE_DISQUALIFY_RE =
    /all allies|their charged skill|charged skill of all allies|upon killing|killing an enemy|when an enemy dies|when an enemy repairs|enemy performs a repair|enemy repairs/i;

// "adds/gains N charge(s)" (self-add). "removes" is excluded by the verb set, so
// Thresh's "removes 1 charge ... and adds 1 charge" matches only the add.
const SELF_CHARGE_ADD_RE = /\b(?:adds?|gains?)\s+(\d+|a|an)\s+charges?\b/i;

// Rhodium-style form: "adds charges to the Charged Skill equal to the number of
// buffs on the target" (amount is per-buff = 1). Runs on tag-stripped text.
const PER_BUFF_CHARGE_RE =
    /adds?\s+charges?\s+to\s+the\s+charged skill[^.]*equal to the number of/i;

// "when (an/another) ally inflicts|applies a debuff" — a teammate applies a debuff (Provider).
// A team-dependent trigger: manual (non-derivable) since the single-ship sim has no allies.
const ALLY_INFLICTS_DEBUFF_RE = /\ball(?:y|ies)\b[^.]*\b(?:appl|inflict)\w*\s+a\s+debuff\b/i;

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
    if (p.includes('stealth')) return { condition: 'enemy-buff', derivable: false };
    if (
        p.includes('buffs on the target') ||
        p.includes('buff on the target') ||
        p.includes('or more buffs') ||
        p.includes('buffs on the enemy') ||
        p.includes('number of buffs')
    )
        return { condition: 'enemy-buff', derivable: false };
    if (
        p.includes('2 or more enemies') ||
        p.includes('two or more enemies') ||
        p.includes('damages 2')
    )
        return { condition: 'enemy-adjacent', derivable: false };
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
 */
function splitSentences(text: string): string[] {
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
// splitting. Shared by resolveBuffClause and parseExtraAction.
const ABBR_MARK = '\u0001';
const maskAbbrev = (s: string) => s.replace(/\b(Inc|Out)\.\s/g, `$1.${ABBR_MARK}`);

function resolveBuffClause(skillText: string, buffName: string): string {
    const plain = maskAbbrev(stripUnitTags(skillText).replace(/<br\s*\/?>/gi, '. '));
    const maskedName = maskAbbrev(buffName).toLowerCase();
    const sentences = splitSentences(plain);
    const clauseMasked = sentences.find((s) => s.toLowerCase().includes(maskedName)) ?? plain;
    return clauseMasked.split(ABBR_MARK).join(' ');
}

export function detectGrantConditions(
    skillText: string | null | undefined,
    buffName: string
): Condition[] {
    if (!skillText || !buffName) return [];
    const clause = resolveBuffClause(skillText, buffName);
    const low = clause.toLowerCase();
    // "when/on/upon applying|inflicting a debuff" is a trigger gate (the unit applies a debuff).
    const appliesDebuffGate = /\b(?:appl|inflict)\w*\s+a\s+debuff\b/i.test(low);
    // "after an ally is critically repaired" — a team-dependent reactive trigger (manual).
    const allyCritRepairGate = /\ball(?:y|ies)\b[^.]*\bcritically\s+repaired\b/i.test(low);
    // Only conditional clauses produce conditions.
    if (
        !/\b(when|if|while|after)\b|affected by|targeting|damaging|against/.test(low) &&
        !appliesDebuffGate &&
        !allyCritRepairGate
    )
        return [];

    if (allyCritRepairGate) {
        return [{ subject: 'ally-critically-repaired', derivable: false }];
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

    // 2. self-crit (active voice: this unit critically hits/damages — NOT "is critically hit")
    if (/critically (?:hits|damag)/i.test(low)) {
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

    // 5. Taunt / Provoke targeting status (reactive → manual "assume active")
    const statuses: string[] = [];
    if (/\btaunt(ed)?\b/i.test(low)) statuses.push('Taunt');
    if (/\bprovoke[ds]?\b/i.test(low)) statuses.push('Provoke');
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
const START_OF_ROUND_RE = /at the start of (?:the|each|every) round/i;
const BOMB_DETONATE_RE = /(?:detonates? a bomb|bomb explodes)/i;

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
 *  - "detonates a Bomb" / "Bomb explodes" → 'on-bomb-detonated' (Lingshe).
 *
 * Other reactive phrasings (when-attacked, ally-crit, on-kill, enemy-cleanse, …) are NOT
 * derivable this phase and stay undefined (manual modelling). Reference data: docs/ship-skills.csv.
 */
export function detectReactiveTrigger(
    skillText: string | null | undefined,
    buffName: string
): AbilityTrigger | undefined {
    if (!skillText || !buffName) return undefined;
    const clause = resolveBuffClause(skillText, buffName);
    // "when an ally critically hits" → on-ally-crit (Pallas's Everliving Regeneration buff grant).
    // Checked BEFORE the self-crit rule: matchesActiveSelfCrit would also match "critically hits"
    // here, but the ally subject makes this an ally-scoped trigger, not a self-crit.
    if (ALLY_CRIT_HIT_RE.test(clause)) return 'on-ally-crit';
    if (matchesActiveSelfCrit(clause)) return 'on-crit';
    if (START_OF_ROUND_RE.test(clause)) return 'start-of-round';
    if (BOMB_DETONATE_RE.test(clause)) return 'on-bomb-detonated';
    // "when Cheat Death activates" → on-cheat-death-activated (Yazid's Barrier grant in the
    // repair sentence). Tycho's below-40%-HP Barrier is a different reactive (deferred), so this
    // only matches the literal activation phrasing.
    if (CHEAT_DEATH_ACTIVATES_RE.test(clause)) return 'on-cheat-death-activated';
    return undefined;
}

/**
 * Maps a targeting status to its model condition. Taunt is a buff on the ENEMY (it forces
 * targeting); Provoke is a debuff on THIS unit. Both are manual (the user assumes the situation).
 * Any other named status falls back to a manual self-buff.
 */
export function statusEffectCondition(name: string, anyOf = false): Condition {
    const lower = name.toLowerCase();
    const base =
        lower === 'taunt'
            ? { subject: 'enemy-buff' as const, buffName: 'Taunt' }
            : lower === 'provoke'
              ? { subject: 'self-debuff' as const, buffName: 'Provoke' }
              : { subject: 'self-buff' as const, buffName: name };
    return { ...base, derivable: false, ...(anyOf ? { anyOf: true } : {}) };
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

// Crocus: "when (an/another) ally inflicts a Damage Over Time (DoT) effect with a critical hit".
const ALLY_CRIT_DOT_RE =
    /\ball(?:y|ies)\b[^.]*\binflict\w*[^.]*\b(?:damage over time|dot)\b[^.]*\bcritical/i;

/** Whether a skill triggers "when an ally inflicts a DoT with a critical hit" (manual, team-gated). */
export function parseAllyCritDot(text: string | null | undefined): boolean {
    return !!text && ALLY_CRIT_DOT_RE.test(stripUnitTags(text));
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
const ALLY_CRIT_HIT_RE = /when an ally critically hits/i;

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

// "inflicts/applies Stasis" — a control infliction. Conservative: ONLY Stasis (the one control
// any ship reacts to today, via Defiant's shield-on-Stasis). Provoke/Taunt stay handled as
// targeting-status CONDITIONS (statusEffectCondition), NOT control abilities. The <unit-skill>
// tags don't bracket the verb, so matching on raw text is safe.
// "applying" deliberately omitted: the infliction verb is always "inflicts/applies"; "applying"
// only appears in the passive reactive clause ("when applying Stasis"), matched separately below.
const STASIS_INFLICT_RE = /\b(?:inflicts?|applies)\b[^.]*?<unit-skill>\s*Stasis\b/i;

/** Parses a Stasis control infliction → the control effect, or null when absent. Reference data:
 *  docs/ship-skills.csv (Defiant charged "inflicts Stasis for 1 turn"). */
export function parseControlInflict(text: string | null | undefined): ControlEffect | null {
    if (!text) return null;
    return STASIS_INFLICT_RE.test(text) ? 'stasis' : null;
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

// detectDamageReactionTrigger rules (Phase 4c PR 1, Task 8). Ally-subject guard covers BOTH
// "when an ally …" and "when another ally …" (Provider) — those reactions are PR 2 scope.
const DR_ALLY_SUBJECT_RE = /when\s+an(?:other)?\s+ally\b/i;
// Crit-suppression riders ("damage that cannot critically hit", incl. the live CSV typo
// "cannont") are NOT crit reactions — scrubbed before the crit-hit test so a when-sentence
// carrying such a rider (Provider, Grif) never reads as crit-gated.
const DR_CANNOT_CRIT_RE = /\bcann?on?t\s+criticall?y?\s+hit\b/i;
// Passive-voice "when … critically hit" (Guardian "When this Unit is critically hit"; the
// missing "y" in the live CSV's "criticall hit" is tolerated). DISTINCT from the ACTIVE-voice
// self-crit phrasing ("critically hits/damaging"), which matchesActiveSelfCrit handles and
// which "hit\b" deliberately does not match (no trailing "s").
const DR_CRIT_HIT_RE = /when\b[^.;]*\bcriticall?y?\s+hit\b/i;
// Self-subject direct-damage reaction: "when (this Unit is) directly damaged" (leading OR
// trailing clause) / "when attacked". "If directly damaged" (Panon) is deliberately NOT
// matched — only the "when" phrasing classifies this phase.
const DR_DIRECT_DAMAGE_RE =
    /when\s+(?:this\s+unit\s+is\s+)?directly\s+damaged\b|when\s+attacked\b/i;
// "while below N% HP" HP gate on a damage-reaction sentence (Makoli: "when directly damaged
// while below 40% HP, …"). The same regex form as Task 7's parseHealAbilities annotation
// (/while\s+below\s+(\d+)\s*%\s*hp/i) — kept here in the detector so ALL sentence-scoped
// extraction lives in skillTextParser. Extracted AFTER the damage-reaction shape is confirmed
// so an unrelated "while below X% HP" in a non-reaction sentence is never picked up.
const DR_HP_BELOW_RE = /while\s+below\s+(\d+)\s*%\s*hp/i;

/**
 * Self-subject damage-reaction trigger for non-heal clauses (Phase 4c PR 1). Matches the
 * sentence around `pos` (RAW-text position, same masked bounds as phrasePosTrigger).
 * Passive-voice "is critically hit" is the CRIT-FILTERED variant — distinct from the
 * ACTIVE-voice self-crit condition, which detectGrantConditions still rejects in passive
 * voice. Ally-subject sentences return undefined (PR 2). NO lookbehind (iOS Safari 15).
 * `hpBelowPct` is set when the reaction sentence also carries a "while below N% HP" self
 * HP gate (Makoli's Disable) — the caller attaches a derivable hp-threshold condition so the
 * executor evaluates the gate at drain time rather than firing on every received attack.
 * Reference data: docs/ship-skills.csv (Warden, Guardian, Shepherd, Opal, Flamel, Iridium,
 * Panguan, Stalwart, Makoli).
 */
export function detectDamageReactionTrigger(
    text: string,
    pos: number
): { trigger: 'on-attacked'; critFilter?: 'crit'; hpBelowPct?: number } | undefined {
    const sentence = rawSentenceAround(text, pos);
    if (sentence === undefined) return undefined;
    if (DR_ALLY_SUBJECT_RE.test(sentence)) return undefined;
    const scrubbed = sentence.replace(DR_CANNOT_CRIT_RE, '');
    if (DR_CRIT_HIT_RE.test(scrubbed)) {
        const hpM = DR_HP_BELOW_RE.exec(scrubbed);
        return {
            trigger: 'on-attacked',
            critFilter: 'crit',
            ...(hpM ? { hpBelowPct: parseInt(hpM[1], 10) } : {}),
        };
    }
    if (DR_DIRECT_DAMAGE_RE.test(scrubbed)) {
        const hpM = DR_HP_BELOW_RE.exec(scrubbed);
        return { trigger: 'on-attacked', ...(hpM ? { hpBelowPct: parseInt(hpM[1], 10) } : {}) };
    }
    return undefined;
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
// Tolerates the "cannont" misspelling in the source data (Provider).
const NO_CRIT_RE = /(\w+)\s+(?:cannot|cannont)\s+critically\s+hit\b/gi;
const NO_CRIT_HEAL_SUBJECTS = new Set(['repair', 'repairs', 'heal', 'heals']);

/** Whether a skill's attack/damage cannot critically hit. Reference data: docs/ship-skills.csv. */
export function parseNoCrit(text: string | null | undefined): boolean {
    if (!text) return false;
    for (const m of stripUnitTags(text).matchAll(NO_CRIT_RE)) {
        if (!NO_CRIT_HEAL_SUBJECTS.has(m[1].toLowerCase())) return true;
    }
    return false;
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
//   • constants/ships.ts:    "When an enemy dies, this unit grants N charge to all allies"
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
const EXTRA_ACTION_ENEMY_DESTROYED_RE = /upon a kill|when an enemy dies|killing an enemy/i;
const EXTRA_ACTION_ALLY_DESTROYED_RE = /allied unit is destroyed|ally is destroyed/i;

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
    /** Death trigger detected from the clause (Phase 4b Task 10): on-enemy-destroyed
     *  (Sokol/Liberator on-kill) or on-ally-destroyed (Harvester). Absent for the default
     *  on-cast grants (Nuqtu/Sustainer/Tormenter/Tygr) — the builder defaults those to on-cast. */
    trigger?: Extract<AbilityTrigger, 'on-enemy-destroyed' | 'on-ally-destroyed'>;
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
    const trigger: ExtraActionParse['trigger'] = EXTRA_ACTION_ENEMY_DESTROYED_RE.test(
        sentenceUnmasked
    )
        ? 'on-enemy-destroyed'
        : EXTRA_ACTION_ALLY_DESTROYED_RE.test(sentenceUnmasked)
          ? 'on-ally-destroyed'
          : undefined;
    return {
        oncePerRound: /once per round/i.test(clause),
        conditions,
        ...(trigger ? { trigger } : {}),
    };
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
    target: 'self' | 'ally' | 'all-allies';
    // True when a target phrase was actually matched ("itself", "the ally", "all allies");
    // false when target defaulted to 'self' because the text named no recipient. The
    // slot/damage-aware bare-repair→ally FLIP in buildShipAbilities keys off this flag.
    explicitTarget: boolean;
    /** Valkyrie: leech scoped to Echoing Burst explosions (detonation credits only). */
    leechScope?: 'all' | 'detonation';
    /** Quixilver: damage-taken proc gated on shield punch-through. */
    requiresHpDamage?: boolean;
    /** Present when the heal is a SELF-subject damage reaction ("when directly
     *  damaged", "when attacked", "when (critically) hit"). buildShipAbilities maps
     *  it to trigger 'on-attacked' (+ triggerCritFilter / derivable self
     *  hp-threshold). Ally-subject reactions never carry this — they stay
     *  disqualified until Phase 4c PR 2. May be present-but-empty: an empty object
     *  signals an ungated reaction (Heliodor first-listed passive, Warden). */
    damageReaction?: { critFilter?: 'crit' | 'non-crit'; hpBelowPct?: number };
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
//   (2) Damage-reaction (on-directly-damaged / attacked / takes-damage / is-hit) — disqualified
//       ONLY when the heal's basis is a plain HP/attack/defense stat, NOT a damage-leech basis.
//       Leech reactions (Cultivator/Malvex/Isha "repairs X% of the damage taken/dealt") ARE
//       modeled via the engine's per-attack proc and MUST still parse, even though their sentence
//       says "when … damaged". The caller gates this against `leechBasis` (see usage below).
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
        'when\\s+destroyed\\b|upon\\s+being\\s+destroyed\\b|\\bon\\s+death\\b|when\\s+it\\s+destroys\\b|when\\s+a\\s+buff\\s+is\\s+purged\\b|when\\b[^.;]*\\bis\\s+purged\\b|when\\b[^.;]*\\bis\\s+cleansed\\b',
    'i'
);
// Damage-reaction reactive triggers — only disqualifying when the heal is NOT a damage leech
// (the caller gates this against the resolved leech basis). Covers "when (an ally/this unit is)
// directly damaged", "when attacked", "when … is hit", "when … takes … damage". The match is
// captured (not just tested) so the caller can reject an ENEMY-subject trigger — "when an enemy
// takes damage from a DoT" (Anemone) is an on-DoT-tick trigger, NOT a self/ally damage reaction,
// so it must not be disqualified by this rule. No lookbehind (iOS Safari 15).
const HEAL_DAMAGE_REACTION_RE =
    /when\b[^.;]*\b(?:directly\s+)?damaged\b|when\s+attacked\b|when\b[^.;]*\bis\s+attacked\b|when\b[^.;]*\bis\s+hit\b|when\b[^.;]*\btakes\b[^.;]*\bdamage\b/i;

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
 * recipient → self; explicit plural phrases ("all allies", "allies") → all-allies; a
 * singular ally recipient ("the ally", "that ally", "them", "most missing health") → ally.
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
    // Singular ally detection takes priority over the bare "their" heuristic so that
    // "Repairs the ally for 8% of their Max HP" correctly routes to ally, not all-allies.
    if (
        /\bthe\s+ally\b|\bthat\s+ally\b|\ban\s+ally\b|\bthem\b|most\s+missing\s+health|\bthe\s+other\s+ally\b/.test(
            s
        )
    )
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
export function parseHealAbilities(text: string | null | undefined): ParsedHealAbility[] {
    if (!text) return [];
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
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
            // "when … is hit", "when … takes … damage") on PLAIN heals — Phase 4c PR 1:
            // SELF-subject reactions whose heal RECIPIENT is also self are now MODELED
            // (on-attacked is a live trigger) and parse with a `damageReaction` annotation.
            // Still disqualified (PR 2 routing scope, so they don't fire every round as
            // phantom on-cast heals): ALLY-subject triggers ("when an ally … damaged",
            // Cultivator/Refine/Graphite) and self triggers whose heal recipient is NOT
            // self (Heliodor's second passive "repairs them"). Leech reactions (basis
            // 'damage-taken'/'damage-dealt') ARE modeled via the engine's per-attack proc
            // and keep parsing WITHOUT the annotation (guard #1). An ENEMY-subject trigger
            // ("when an enemy takes damage from a DoT", Anemone) is an on-DoT-tick trigger,
            // not a self/ally damage reaction, so it is neither disqualified nor annotated.
            let damageReaction: ParsedHealAbility['damageReaction'];
            if (!leechBasis) {
                const dmgReaction = HEAL_DAMAGE_REACTION_RE.exec(sentence);
                if (dmgReaction && !/\benem(?:y|ies)\b/i.test(dmgReaction[0])) {
                    if (/when\s+an\s+ally\b/i.test(dmgReaction[0])) continue;
                    if (resolved.target !== 'self') continue;
                    const hpGate = /while\s+below\s+(\d+)\s*%\s*hp/i.exec(sentence);
                    // Instead-on-crit split (Isha): a sentence with "but when critical(ly)
                    // hit, it instead" carries TWO repair matches — the one INSIDE the
                    // instead-clause gets critFilter 'crit', the base match 'non-crit'
                    // (mutually exclusive pair; the missing "y" in the live CSV text —
                    // "criticall hit" — is tolerated).
                    const insteadClause =
                        /but\s+when\s+criticall?y?\s+hit\b[^.;]*\binstead\b/i.exec(sentence);
                    const inInstead =
                        insteadClause !== null && m.index - sentenceStart > insteadClause.index;
                    const critFilter = insteadClause
                        ? inInstead
                            ? ('crit' as const)
                            : ('non-crit' as const)
                        : undefined;
                    damageReaction = {
                        ...(critFilter ? { critFilter } : {}),
                        ...(hpGate ? { hpBelowPct: parseInt(hpGate[1], 10) } : {}),
                    };
                }
            }
            const rawBasis = leechBasis ?? resolveHealBasis(basisScope);
            // Damage-taken procs always shield/heal the damaged unit ITSELF — "them" in
            // "Damage dealt to them" refers back to this Unit, so the \bthem\b ally rule
            // must not apply (Malvex). (resolveHealTarget was hoisted above the
            // damage-reaction block so the recipient gate can read it — the gate MUST read
            // the SAME `resolved` object this target assignment uses, or the two could
            // disagree on who receives the heal.)
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
            results.push({
                kind,
                pct,
                basis,
                target,
                explicitTarget,
                ...(leechScope ? { leechScope } : {}),
                ...(requiresHpDamage ? { requiresHpDamage } : {}),
                ...(damageReaction ? { damageReaction } : {}),
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

// "cleanses N" — must NOT match "purges". Trailing clause names the recipient.
const CLEANSE_RE = /\bcleanses?\s+(\d+)/gi;

/**
 * Parses cleanse grants ("cleanses N debuffs from <recipient>"). Target from the trailing
 * clause: "from itself" → self, "from all allies" → all-allies, "from the/that ally" → ally;
 * default self. Does not match "purges". Reference data: docs/ship-skills.csv.
 */
export function parseCleanse(
    text: string | null | undefined
): { count: number; target: 'self' | 'ally' | 'all-allies'; explicitTarget: boolean }[] {
    if (!text) return [];
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    const results: {
        count: number;
        target: 'self' | 'ally' | 'all-allies';
        explicitTarget: boolean;
    }[] = [];
    CLEANSE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CLEANSE_RE.exec(plain)) !== null) {
        const count = parseInt(m[1], 10);
        if (!count || isNaN(count)) continue;
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
        results.push({ count, target, explicitTarget });
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

export type SkillSource = 'active' | 'charge' | 'passive1' | 'passive2' | 'passive3';

export interface SkillEffect {
    buffName: string;
    // Player-side granularity (team-walk ally-scope): 'self' = caster only, 'ally' = a single
    // chosen ally, 'all-allies' = every player actor. 'enemy' = enemy debuff. The combat engine
    // routes 'ally'/'all-allies' grants from a walked team ship onto the right actors; for the
    // attacker's own sim 'self' and 'all-allies' both fold onto its side (zero churn).
    target: 'self' | 'ally' | 'all-allies' | 'enemy';
    duration: number | 'recurring' | null;
    stacks?: number;
    source: SkillSource;
    stackTrigger?: StackTrigger;
    // Enemy debuffs only: 'inflict' verbs are resistible, 'apply' verbs are guaranteed.
    application?: 'inflict' | 'apply';
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
const DURATION_RE = /for\s+(\d+)\s+turns?/i;
const RECURRING_RE = /every\s+turn/i;
// Matches "N stacks of" at the END of a text segment (immediately before the tag)
const STACKS_RE = /(\d+)\s+stacks?\s+of\s*$/i;
// Matches text that is ONLY connectors between tags (e.g. " and ", ", ", " or ")
const CONNECTOR_RE = /^\s*(,\s*)?(and|or)?\s*$/i;
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
        if (!CONNECTOR_RE.test(s.text)) break;
    }
    return null;
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
            return words[i];
        }
        if (SKIP_VERBS.has(words[i])) return null;
    }
    return undefined;
}

/**
 * Maps a verb to a target side, cross-referencing BUFFS type for the ambiguous "apply" forms.
 * An "apply" verb with a buff-type effect → self; anything else → enemy.
 */
function verbToTarget(verb: string, buffName: string): 'self' | 'enemy' {
    if (SELF_VERBS.has(verb)) return 'self';
    if (ENEMY_VERBS.has(verb)) return 'enemy';
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
//  - trailing: "<receiver clause> when/after/while/if …"    → drop from the keyword onward
// The receiver phrasing ("this Unit grants the ally X" / "X allies gain Y") survives, so a
// genuine post-condition ally receiver (Provider: "…, this Unit grants the ally RoT III") is
// still classified ally. The clause is the same one `resolveBuffClause` already split on
// abbreviation-masked sentence boundaries, so "Inc."/"Out." periods never reach here as
// boundaries; condition keywords are matched on word boundaries only.
function stripConditionClauses(clause: string): string {
    let out = clause;
    // Leading "When/After/While/If … ," — only when it precedes the rest via a comma.
    out = out.replace(/^\s*(?:when|after|while|if)\b[^,]*,\s*/i, '');
    // Trailing " when/after/while/if …" condition (to end of clause).
    // LOSSY: a post-condition receiver clause is destroyed here; the default-self fallback covers
    // the live corpus. A future "if …, all allies gain X" phrasing would need receiver-aware stripping.
    out = out.replace(/\s+\b(?:when|after|while|if)\b.*$/i, '');
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
 *      · team receiver ("grants all allies X" / "grants X to all allies")    → 'all-allies'
 *      · single-ally receiver ("grants the/an/that ally X", "grants them X") → 'ally'
 *      · NO explicit receiver ("This Unit grants X")                         → 'all-allies'
 *
 * Subject/object are taken from the buff's own grant span (its verb, the text before it back to
 * the previous verb = subject, the text after it up to the next verb = object) so a sibling
 * grant's receiver in the same sentence doesn't bleed across.
 *
 * For the attacker's own sim 'self' and 'all-allies' are equivalent (both fold onto the
 * attacker's side); the distinction only matters when the engine walks a team ship's grants.
 */
function detectGrantScope(skillText: string, buffName: string): 'self' | 'ally' | 'all-allies' {
    const resolved = resolveBuffClause(skillText, buffName).toLowerCase();
    // Strip trigger/condition sub-clauses so an ally mentioned only as the TRIGGER ("after an
    // ally is critically repaired") doesn't leak ally-scope onto a buff the caster grants itself.
    const clause = stripConditionClauses(resolved);
    const buffStart = clause.indexOf(buffName.toLowerCase());
    const { verb, subject, object } = buffGrantSpan(
        clause,
        buffStart === -1 ? clause.length : buffStart
    );

    // Receiving verb (gains/has) → route by the SUBJECT (who receives onto itself).
    if (verb !== null && SELF_RECEIVE_VERB_RE.test(verb)) {
        if (ALL_ALLIES_RE.test(subject)) return 'all-allies';
        if (SINGLE_ALLY_RE.test(subject)) return 'ally';
        return 'self';
    }

    // Bestowing verb (grants) → route by the OBJECT (the receiver of the grant). Team and ally
    // receivers are tested BEFORE the self ("itself") receiver so a combined receiver like
    // "grants Out. Damage Up I to itself and all adjacent allies" (Tormenter) routes all-allies,
    // not self — "itself" only pins to self when it is the SOLE receiver (Nuqtu's "grants itself").
    if (verb !== null && GRANT_VERB_RE.test(verb)) {
        if (ALL_ALLIES_RE.test(object)) return 'all-allies';
        if (SINGLE_ALLY_RE.test(object)) return 'ally';
        if (SELF_RECEIVER_RE.test(object)) return 'self';
        // Receiver-less grant → all players (the locked routing rule).
        return 'all-allies';
    }

    // No identifiable verb (defensive): fall back to the prior phrasing-only heuristic.
    if (SINGLE_ALLY_RE.test(clause)) return 'ally';
    if (ALL_ALLIES_RE.test(clause)) return 'all-allies';
    return 'self';
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

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (seg.type !== 'unit-skill') continue;

        const buffName = seg.text;

        // Step 1: Find application verb
        const verb = findVerb(segments, i);
        if (verb === null || verb === undefined) continue; // skip verb or no verb

        // Step 2: Target + how the effect lands (inflict = resistible, apply = guaranteed).
        // Player-side grants get ally-scope granularity from the granting clause (team walk);
        // enemy debuffs stay 'enemy'.
        const side = verbToTarget(verb, buffName);
        const target: SkillEffect['target'] =
            side === 'self' ? detectGrantScope(skillText, buffName) : 'enemy';
        const application = side === 'enemy' ? verbToApplication(verb) : undefined;

        // Step 3: Duration from immediately following text segment
        const nextText = segments[i + 1]?.type === 'text' ? segments[i + 1].text : '';
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
        let stackTrigger: StackTrigger | undefined;
        if (stacks !== undefined && duration === 'recurring') {
            if (source === 'passive1' || source === 'passive2' || source === 'passive3') {
                stackTrigger = 'per-round';
            } else if (source === 'active') {
                stackTrigger = 'per-active';
            } else if (source === 'charge') {
                stackTrigger = 'per-charge';
            }
        }

        effects.push({
            buffName,
            target,
            duration,
            ...(stacks !== undefined ? { stacks } : {}),
            ...(stackTrigger !== undefined ? { stackTrigger } : {}),
            ...(application !== undefined ? { application } : {}),
            source,
        });
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
