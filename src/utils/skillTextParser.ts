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
import { AbilityTrigger, Condition, ConditionSubject } from '../types/abilities';

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

function resolveBuffClause(skillText: string, buffName: string): string {
    const ABBR_MARK = '\u0001';
    const maskAbbrev = (s: string) => s.replace(/\b(Inc|Out)\.\s/g, `$1.${ABBR_MARK}`);
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
    if (matchesActiveSelfCrit(clause)) return 'on-crit';
    if (START_OF_ROUND_RE.test(clause)) return 'start-of-round';
    if (BOMB_DETONATE_RE.test(clause)) return 'on-bomb-detonated';
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
    const plain = stripUnitTags(text).toLowerCase();
    for (const [name, pct] of Object.entries(ACCUMULATE_DETONATE_EFFECTS)) {
        const idx = plain.indexOf(name);
        if (idx === -1) continue;
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

/**
 * Returns the heal percentage from the first <unit-damage>repairs X%</unit-damage> tag found.
 * Returns a float percentage (e.g. 15 for "repairs 15%"), or 0 if none found.
 */
export function parseSkillHeal(text: string): number {
    if (!text) return 0;
    const tagPattern = /<unit-damage>(.*?)<\/unit-damage>/g;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(text)) !== null) {
        const healMatch = /^\s*repairs\s+(\d+(?:\.\d+)?)\s*%/i.exec(match[1]);
        if (healMatch) return parseFloat(healMatch[1]);
    }
    return 0;
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

// Single-ally phrasings: "the ally with/in …", "an ally", "an adjacent ally" (singular).
// "all (adjacent) allies"/"allies" plural is handled by the all-allies branch first, so a
// bare "allies" never reaches this — only a singular "ally" does.
const SINGLE_ALLY_RE = /\bthe ally\b|\ban ally\b|\ban adjacent ally\b/i;
// Ally-scoped (team-wide) grant phrasings: "all allies", bare plural "allies", "friendly …".
const ALL_ALLIES_RE = /friendly|all allies|allies/i;

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
    out = out.replace(/\s+\b(?:when|after|while|if)\b.*$/i, '');
    return out;
}

/**
 * Resolves the player-side ally-scope of a granted buff from its GRANTING CLAUSE, using the
 * same masking-aware clause resolver (`resolveBuffClause`) as condition detection so "Inc."/
 * "Out." abbreviation periods don't break sentence splitting. Returns:
 *  - 'ally' for single-ally phrasings ("the ally with the highest Attack")
 *  - 'all-allies' for team-wide phrasings ("all allies"/"allies"/"friendly units")
 *  - 'self' otherwise ("This Unit gains/grants …", or a receiver-less self-anchored grant)
 *
 * For the attacker's own sim 'self' and 'all-allies' are equivalent (both fold onto the
 * attacker's side); the distinction only matters when the engine walks a team ship's grants.
 */
function detectGrantScope(skillText: string, buffName: string): 'self' | 'ally' | 'all-allies' {
    const resolved = resolveBuffClause(skillText, buffName).toLowerCase();
    // Strip trigger/condition sub-clauses so an ally mentioned only as the TRIGGER ("after an
    // ally is critically repaired") doesn't leak ally-scope onto a buff the caster grants itself.
    const clause = stripConditionClauses(resolved);
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

    return effects;
}

export function parseAllSkillEffects(ship: Ship): SkillEffect[] {
    return [
        ...parseSkillEffects(ship.activeSkillText, 'active'),
        ...parseSkillEffects(ship.chargeSkillText, 'charge'),
        ...parseSkillEffects(ship.firstPassiveSkillText, 'passive1'),
        ...parseSkillEffects(ship.secondPassiveSkillText, 'passive2'),
        ...parseSkillEffects(ship.thirdPassiveSkillText, 'passive3'),
    ];
}
