import { BUFFS } from '../constants/buffs';
import { Ship } from '../types/ship';
import {
    SecondaryDamage,
    SecondaryDamageStat,
    StackTrigger,
    ConditionalDamage,
    ConditionalCondition,
} from '../types/calculator';

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
        const mapped = mapConditionPhrase(m[2]);
        if (!mapped) continue;
        const cap = parseConditionalCap(text);
        return {
            pct,
            condition: mapped.condition,
            derivable: mapped.derivable,
            ...(cap !== null ? { cap } : {}),
        };
    }
    return null;
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
}

const APPLICATION_VERBS = new Set(['grants', 'granted', 'gains', 'inflicts', 'applies']);
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
        if (APPLICATION_VERBS.has(words[i])) return words[i];
        if (SKIP_VERBS.has(words[i])) return null;
    }
    return undefined;
}

/**
 * Maps a verb to a target side, cross-referencing BUFFS type for the ambiguous "applies" verb.
 * "applies" with a buff-type effect → self; anything else → enemy.
 */
function verbToTarget(verb: string, buffName: string): 'self' | 'enemy' {
    if (verb === 'gains' || verb === 'grants' || verb === 'granted') return 'self';
    if (verb === 'inflicts') return 'enemy';
    // applies: use BUFFS type to disambiguate
    const found = BUFFS.find((b) => b.name === buffName);
    return found?.type === 'buff' ? 'self' : 'enemy';
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

        // Step 2: Target
        const target = verbToTarget(verb, buffName);

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
