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
import { Condition, ConditionSubject } from '../types/abilities';

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
    const pattern =
        /<unit-damage>(\d+(?:\.\d+)?)%[^<]*<\/unit-damage>\s*of\s+(?:its|this\s+unit'?s)\s+(defense|(?:max\s+)?hp)/i;
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
    return null;
}

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
    if (p.includes('critically damag') || p.includes('critically hit'))
        return { condition: 'self-crit', derivable: true };
    if (p.includes('inflict') && p.includes('debuff'))
        return { condition: 'enemy-debuff', derivable: true };
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
export function detectGrantConditions(
    skillText: string | null | undefined,
    buffName: string
): Condition[] {
    if (!skillText || !buffName) return [];
    const plain = stripUnitTags(skillText).replace(/<br\s*\/?>/gi, '. ');
    const sentences = plain.split(/(?<=[.;])\s+/);
    const clause = sentences.find((s) => s.toLowerCase().includes(buffName.toLowerCase())) ?? plain;
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

    // 5. Taunt / Provoke self-status (reactive → manual "assume active")
    const statuses: string[] = [];
    if (/\btaunt(ed)?\b/i.test(low)) statuses.push('Taunt');
    if (/\bprovoke[ds]?\b/i.test(low)) statuses.push('Provoke');
    if (statuses.length) {
        return statuses.map((s) => ({
            subject: 'self-buff' as const,
            buffName: s,
            derivable: false,
            ...(statuses.length > 1 ? { anyOf: true } : {}),
        }));
    }

    return [];
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
): { turns: number; condition: Condition } | null {
    if (!text) return null;
    const plain = stripUnitTags(text);
    const m = CRIT_POWER_EXTEND_RE.exec(plain);
    if (!m) return null;
    const condition: Condition = /\ball(?:y|ies)\b[^.]*\binflict/i.test(plain)
        ? { subject: 'ally-inflicts-debuff', derivable: false }
        : { subject: 'self-crit', derivable: true };
    return { turns: parseInt(m[1], 10), condition };
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
    target: 'self' | 'enemy';
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

        // Step 2: Target + how the effect lands (inflict = resistible, apply = guaranteed)
        const target = verbToTarget(verb, buffName);
        const application = target === 'enemy' ? verbToApplication(verb) : undefined;

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
