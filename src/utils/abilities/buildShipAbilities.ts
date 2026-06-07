import { Ship } from '../../types/ship';
import { ShipTypeName } from '../../constants/shipTypes';
import {
    EnemyBaseClass,
    ConditionalCondition,
    DoTApplicationEntry,
    SelectedGameBuff,
} from '../../types/calculator';
import {
    Ability,
    ShipSkills,
    Skill,
    SkillSlot,
    Condition,
    AbilityTarget,
    ModifierChannel,
    ScalingRule,
} from '../../types/abilities';
import { getShipSkillRows, getSkillRowForSlot } from '../ship/skillRows';
import {
    parseSkillDamage,
    parseSecondaryDamage,
    parseConditionalDamage,
    parseChargeGain,
    parseExtraAction,
    detectGrantConditions,
    detectReactiveTrigger,
    parseHpThresholdCondition,
    parseExtendDoT,
    parseCritPowerExtend,
    parseAllyCritDot,
    detectCritRepairTrigger,
    detectAllyCritTrigger,
    detectAllyDamagedTrigger,
    parseNoCrit,
    parseAllyInflictsDebuff,
    parseDetonateDoT,
    parseAccumulateDetonate,
    isAccumulateDetonateEffect,
    parseHealAbilities,
    parseCleanse,
    parseHealNoCrit,
    parseSkillEffects,
    classifyEnemyEffect,
    statusEffectCondition,
} from '../skillTextParser';
import {
    buildDoTAutoFill,
    buildSkillBuffAutoFill,
    DOT_TIER_MAP,
} from '../calculators/skillBuffAutoFill';
import { selectedBuffToAbility } from './buffAbilityConverters';

let counter = 0;
const nextId = () => `ab${counter++}`;

/** Strips the inline game markup tags so plain-text regexes can match the row text. */
function stripTags(text: string): string {
    return text.replace(/<\/?unit-(?:aid|skill|damage)>/gi, '');
}

const WORD_HIT_COUNT: Record<string, number> = {
    once: 1,
    twice: 2,
    three: 3,
    four: 4,
    five: 5,
};

/**
 * Detects a multi-hit phrase ("attacks three times", "attacks twice", "attacks N times")
 * and returns the hit count. Returns undefined for single-hit (no phrase found).
 */
function parseHitCount(text: string): number | undefined {
    const plain = stripTags(text);
    // "attacks three times" / "attacks twice" / "attacks 3 times"
    const wordMatch = plain.match(/attacks?\s+(once|twice|three|four|five)(?:\s+times)?/i);
    if (wordMatch) {
        const count = WORD_HIT_COUNT[wordMatch[1].toLowerCase()];
        if (count > 1) return count;
    }
    const numMatch = plain.match(/attacks?\s+(\d+)\s+times/i);
    if (numMatch) {
        const n = parseInt(numMatch[1], 10);
        if (n > 1) return n;
    }
    return undefined;
}

interface ParsedModifier {
    channel: ModifierChannel;
    value: number;
    isMultiplicative: boolean;
    target: AbilityTarget;
    conditions: Condition[];
    scaling?: ScalingRule;
}

/**
 * The sentence containing the character at `index`. Boundaries are `.`/`;` followed
 * by whitespace or end-of-string, so decimals (e.g. "7.5") are not split.
 */
function sentenceContaining(plain: string, index: number): string {
    const boundary = /[.;](?=\s|$)/g;
    let start = 0;
    let end = plain.length;
    let m: RegExpExecArray | null;
    while ((m = boundary.exec(plain)) !== null) {
        if (m.index < index) {
            start = m.index + 1;
        } else {
            end = m.index + 1;
            break;
        }
    }
    return plain.slice(start, end);
}

/**
 * The clause containing the character at `index`, delimited by commas as well as `.`/`;`
 * (so comma-joined sub-clauses with different subjects — "This Unit deals X, all allies
 * deal Y" — are scoped separately). The sentence-boundary check uses a whitespace lookahead
 * so decimals (e.g. "7.5") aren't split.
 */
function clauseContaining(plain: string, index: number): string {
    const boundary = /,|[.;](?=\s|$)/g;
    let start = 0;
    let end = plain.length;
    let m: RegExpExecArray | null;
    while ((m = boundary.exec(plain)) !== null) {
        if (m.index < index) start = m.index + 1;
        else {
            end = m.index;
            break;
        }
    }
    return plain.slice(start, end);
}

/**
 * "when affected by Taunt or Provoke" → manual targeting-status conditions (anyOf). Taunt maps
 * to an enemy buff, Provoke to a self debuff (see statusEffectCondition).
 */
function affectedByConditions(sentence: string): Condition[] {
    const m = sentence.match(
        /affected by\s+([A-Za-z][A-Za-z' ]*?)(?:\s+or\s+([A-Za-z][A-Za-z' ]*?))?(?=\s*[.,]|\s*$)/i
    );
    if (!m) return [];
    return [m[1], m[2]]
        .filter((n): n is string => !!n)
        .map((name) => statusEffectCondition(name.trim(), true));
}

/**
 * Effect names in an "enemies (with|afflicted with) <effect> [or <effect>]" clause, read from
 * the raw <unit-skill> tags (so multi-word names like "Concentrate Fire" survive intact).
 */
function enemyEffectNamesFromClause(rawText: string): string[] {
    const m = rawText.match(/\benem(?:y|ies)\b[^.]*?\bwith\b([^.]*)/i);
    if (!m) return [];
    return [...m[1].matchAll(/<unit-skill>([^<]+)<\/unit-skill>/gi)].map((t) => t[1].trim());
}

/**
 * Effect names gating a "deals N% damage to enemies (with|afflicted with) <effect>" clause.
 * Scoped to the damage clause (no sentence break between) so it only gates that damage ability.
 */
function damageEnemyEffectNamesFromClause(rawText: string): string[] {
    // Keep unit-skill tags but drop damage/aid tags so "deals N% damage to …" matches across them.
    const t = rawText.replace(/<\/?unit-(?:aid|damage)>/gi, '');
    const m = t.match(
        /deals?\s+\d+(?:\.\d+)?%\s+damage\s+to\b[^.]*?\benem(?:y|ies)\b[^.]*?\b(?:with|afflicted\s+with)\b([^.]*)/i
    );
    if (!m) return [];
    return [...m[1].matchAll(/<unit-skill>([^<]+)<\/unit-skill>/gi)].map((x) => x[1].trim());
}

/**
 * Builds enemy-effect gating conditions from effect names: debuffs/DoTs → derivable `enemy-debuff`
 * (the sim tracks enemy debuff/DoT counts), buffs → manual `enemy-buff`. Multiple → anyOf.
 */
function enemyEffectConditions(names: string[]): Condition[] {
    return names.map((buffName) => {
        const isDebuff = classifyEnemyEffect(buffName) === 'debuff';
        return {
            subject: isDebuff ? 'enemy-debuff' : 'enemy-buff',
            derivable: isDebuff,
            buffName,
            ...(names.length > 1 ? { anyOf: true } : {}),
        };
    });
}

/**
 * Self/enemy HP-threshold condition from a modifier clause: "when its HP is below 50%" (Los) →
 * self hp-threshold below 50. "below|above N% HP" / "HP is below|above N%" both match; the
 * subject is enemy only when the clause references an enemy/target, else self.
 */
function hpThresholdFromSentence(sentence: string): Condition | null {
    const cmp = '(below|under|less than|fewer than|above|over|more than|greater than)';
    const m =
        sentence.match(new RegExp(`\\bhp\\s+is\\s+${cmp}\\s+(\\d+)\\s*%`, 'i')) ??
        sentence.match(new RegExp(`\\b${cmp}\\s+(\\d+)\\s*%\\s*hp`, 'i'));
    if (!m) return null;
    const hpSubject = /\benem(?:y|ies)|target\b/i.test(sentence) ? 'enemy' : 'self';
    return {
        subject: 'hp-threshold',
        derivable: true,
        hpComparator: /below|under|less|fewer/i.test(m[1]) ? 'below' : 'above',
        hpPercent: parseInt(m[2], 10),
        hpSubject,
    };
}

/** Extracts a "up to (a max of) Y%" cap from a clause, if present. */
function capFromSentence(sentence: string): number | undefined {
    const m = sentence.match(/up to\s+(?:a\s+)?(?:max(?:imum)?\s+of\s+)?(\d+(?:\.\d+)?)%/i);
    return m ? parseFloat(m[1]) : undefined;
}

/**
 * Classifies a "for each <thing>" scaling count into a model Condition. Count
 * subjects that the sim can't derive on its own (destroyed enemies, adjacent
 * allies, enemy buff/debuff counts) are non-derivable so they default to 0 —
 * the user supplies the count in the editor. Returns null when unrecognised, so
 * the caller can skip rather than emit a wrong flat bonus.
 */
function forEachCondition(sentence: string): Condition | null {
    const m = sentence.match(/for each\s+([^.,;]*)/i);
    if (!m) return null;
    const what = m[1].toLowerCase();
    if (/destroy/.test(what)) return { subject: 'enemy-destroyed', derivable: false };
    // Enemy DEBUFF counts ARE sim-derivable (landed debuffs + DoT entries per round) —
    // matches mapConditionPhrase; enemy BUFF counts below are not (manual).
    if (/debuff/.test(what) && /enem|target/.test(what))
        return { subject: 'enemy-debuff', derivable: true };
    if (/buff/.test(what) && /enem|target/.test(what))
        return { subject: 'enemy-buff', derivable: false };
    if (/adjacent all/.test(what)) return { subject: 'adjacent-ally', derivable: false };
    if (/debuff/.test(what)) return { subject: 'self-debuff', derivable: true };
    if (/buff/.test(what)) return { subject: 'self-buff', derivable: true };
    return null;
}

/**
 * Detects an HP-proportional "up to X%" bonus: the value scales linearly with the
 * target's CURRENT HP% (Akula — "based on the target's current HP percentage; the
 * higher the percentage, the more") or MISSING HP% (Tithonus — "based on the
 * target's missing HP, with the maximum achieved when the target is below 10% HP").
 * Returns the count condition + scaling rule (perUnit per HP point, capped at the
 * full value), or null when the sentence has no HP-proportional phrasing. The
 * "below N% HP" anchor in the missing-HP form sets where the maximum is reached
 * (perUnit = value / (100 − N)); it is NOT an hp-threshold gate.
 */
function hpProportionalScaling(
    sentence: string,
    value: number
): { condition: Condition; scaling: ScalingRule } | null {
    if (/based on the target'?s?\s+current\s+hp/i.test(sentence)) {
        return {
            condition: { subject: 'enemy-hp-pct', derivable: true },
            scaling: { conditionIndex: 0, perUnit: value / 100, cap: value },
        };
    }
    if (/based on the target'?s?\s+missing\s+hp/i.test(sentence)) {
        const anchorM = sentence.match(/maximum[^.;]*below\s+(\d+(?:\.\d+)?)\s*%\s*hp/i);
        const anchor = anchorM ? parseFloat(anchorM[1]) : 0;
        const span = Math.max(1, 100 - anchor);
        return {
            condition: { subject: 'enemy-hp-missing-pct', derivable: true },
            scaling: { conditionIndex: 0, perUnit: value / span, cap: value },
        };
    }
    return null;
}

/**
 * Detects passive output/stat modifiers in a skill's text. Handles:
 *  - "X% more (direct) damage" → outgoing-damage modifier (self, or all-allies when
 *    "friendly/allies" scoped), gated by a Stealth or "affected by …" condition.
 *    When scoped "for each <thing>" (e.g. Judge "for each destroyed enemy") it becomes
 *    a capped scaling modifier instead of a flat bonus.
 *  - "X% defense penetration for each buff it has, up to a max of Y%" → a per-self-buff
 *    scaling defense-penetration modifier (capped).
 *  - flat "has X% defense penetration" → a flat defense-penetration modifier (Judge).
 */
function parseModifiers(text: string): ParsedModifier[] {
    const plain = stripTags(text).replace(/<br\s*\/?>/gi, '. ');
    const out: ParsedModifier[] = [];

    const moreM = plain.match(/(\d+(?:\.\d+)?)%\s+more\s+(?:direct\s+)?damage/i);
    if (moreM) {
        const sentence = sentenceContaining(plain, moreM.index!);
        const isAllyScoped = /friendly|all allies|allies/i.test(sentence);
        const target: AbilityTarget = isAllyScoped ? 'all-allies' : 'self';
        const value = parseFloat(moreM[1]);
        const hpScaling = hpProportionalScaling(sentence, value);
        if (hpScaling) {
            // "up to X% more damage based on the target's current/missing HP" —
            // Tithonus-style HP-proportional bonus (the "below N% HP" anchor in the
            // sentence is the scaling maximum, NOT an hp-threshold gate).
            out.push({
                channel: 'outgoingDamage',
                value: 0,
                isMultiplicative: true,
                target,
                conditions: [hpScaling.condition],
                scaling: hpScaling.scaling,
            });
        } else if (/for each/i.test(sentence)) {
            // "X% more damage for each <thing>" → scaling modifier (skip if uncountable).
            const countCond = forEachCondition(sentence);
            if (countCond) {
                out.push({
                    channel: 'outgoingDamage',
                    value: 0,
                    isMultiplicative: true,
                    target,
                    conditions: [countCond],
                    scaling: {
                        conditionIndex: 0,
                        perUnit: value,
                        ...(capFromSentence(sentence) !== undefined
                            ? { cap: capFromSentence(sentence) }
                            : {}),
                    },
                });
            }
        } else {
            const conditions: Condition[] = [];
            // "to enemies (with|afflicted with) <effect> [or <effect>]" → the ENEMY has one of
            // these effects, classified per effect type (debuff/DoT → enemy-debuff, buff → enemy-buff).
            const enemyEffects = /\benem(?:y|ies)\b[^.]*\bwith\b/i.test(sentence)
                ? enemyEffectNamesFromClause(text)
                : [];
            if (enemyEffects.length) {
                conditions.push(...enemyEffectConditions(enemyEffects));
            } else if (/stealth/i.test(sentence)) {
                // "while Stealthed" (self) — the acting unit's own Stealth.
                const subject =
                    target === 'self' || target === 'all-allies' ? 'self-buff' : 'enemy-buff';
                conditions.push({ subject, buffName: 'Stealth', derivable: false });
            }
            conditions.push(...affectedByConditions(sentence));
            const hpCond = hpThresholdFromSentence(sentence);
            if (hpCond) conditions.push(hpCond);
            out.push({
                channel: 'outgoingDamage',
                value,
                isMultiplicative: true,
                target,
                conditions,
            });
        }
    }

    // "X% more critical damage [to <enemy class>]" → crit-damage modifier (Lodolite).
    const critM = plain.match(/(\d+(?:\.\d+)?)%\s+more\s+critical\s+damage/i);
    if (critM) {
        // Comma-scoped: "This Unit deals X% more critical damage, all allies deal Y%…" are
        // separate subjects, so don't let the all-ally clause leak into this one.
        const clause = clauseContaining(plain, critM.index!);
        const isAllyScoped = /friendly|all allies|allies/i.test(clause);
        const conditions: Condition[] = [];
        const typeM = clause.match(
            /\b(?:to|against|targeting|damaging)\s+(defender|attacker|debuffer|supporter)s?\b/i
        );
        if (typeM) {
            conditions.push({
                subject: 'enemy-type',
                derivable: true,
                requiredEnemyType: (typeM[1].charAt(0).toUpperCase() +
                    typeM[1].slice(1).toLowerCase()) as EnemyBaseClass,
            });
        }
        const critHpCond = hpThresholdFromSentence(clause);
        if (critHpCond) conditions.push(critHpCond);
        out.push({
            channel: 'critDamage',
            value: parseFloat(critM[1]),
            isMultiplicative: true,
            target: isAllyScoped ? 'all-allies' : 'self',
            conditions,
        });
    }

    // "increases [outgoing] [direct] Damage by [up to] N% [to enemies with <effect> / below X% HP]"
    // → an outgoing-damage bonus (Obsidian). HP-proportional phrasings (Akula's "up to 30%
    // based on the target's current HP percentage") become a scaling modifier on the live
    // enemy-hp-pct count — the sim derives enemy HP from cumulative damage per round.
    const incM = plain.match(
        /increases?\s+(?:outgoing\s+)?(?:direct\s+)?damage\s+by\s+(?:up\s+to\s+)?(\d+(?:\.\d+)?)%/i
    );
    if (incM) {
        const sentence = sentenceContaining(plain, incM.index!);
        const incValue = parseFloat(incM[1]);
        const incTarget: AbilityTarget = /friendly|all allies|allies/i.test(sentence)
            ? 'all-allies'
            : 'self';
        const incHpScaling = hpProportionalScaling(sentence, incValue);
        if (incHpScaling) {
            out.push({
                channel: 'outgoingDamage',
                value: 0,
                isMultiplicative: true,
                target: incTarget,
                conditions: [incHpScaling.condition],
                scaling: incHpScaling.scaling,
            });
        } else {
            const conditions: Condition[] = [];
            if (/\benem(?:y|ies)\b[^.]*\bwith\b/i.test(sentence)) {
                conditions.push(...enemyEffectConditions(enemyEffectNamesFromClause(text)));
            }
            const hpCond = hpThresholdFromSentence(sentence);
            if (hpCond) conditions.push(hpCond);
            out.push({
                channel: 'outgoingDamage',
                value: incValue,
                isMultiplicative: true,
                target: incTarget,
                conditions,
            });
        }
    }

    const penM = plain.match(/(\d+(?:\.\d+)?)%\s+defense penetration\s+for each\s+buff/i);
    if (penM) {
        const sentence = sentenceContaining(plain, penM.index!);
        out.push({
            channel: 'defensePenetration',
            value: 0,
            isMultiplicative: false,
            target: 'self',
            conditions: [{ subject: 'self-buff', derivable: true }],
            scaling: {
                conditionIndex: 0,
                perUnit: parseFloat(penM[1]),
                ...(capFromSentence(sentence) !== undefined
                    ? { cap: capFromSentence(sentence) }
                    : {}),
            },
        });
    } else {
        // flat "has X% defense penetration" (no per-buff scaling) — e.g. Judge passives.
        const flatPenM = plain.match(/(\d+(?:\.\d+)?)%\s+defense penetration(?!\s+for each)/i);
        if (flatPenM) {
            out.push({
                channel: 'defensePenetration',
                value: parseFloat(flatPenM[1]),
                isMultiplicative: false,
                target: 'self',
                conditions: [],
            });
        }
    }

    return out;
}

function slotFor(label: string): SkillSlot | null {
    if (label === 'Active') return 'active';
    if (label === 'Charge') return 'charged';
    if (label.startsWith('Passive')) return 'passive';
    return null;
}

/**
 * Helper to append positioned abilities to a slot in the abilities map, creating the entry if needed.
 */
function pushToSlot(
    bySlot: Map<SkillSlot, PositionedAbility[]>,
    slot: SkillSlot,
    abilities: PositionedAbility[]
): void {
    const existing = bySlot.get(slot);
    if (existing) existing.push(...abilities);
    else bySlot.set(slot, [...abilities]);
}

/**
 * Maps an existing-detector ConditionalCondition into a model Condition. The
 * subject strings are identical between the two unions, so this is mostly a
 * passthrough carrying derivable / manualCount / requiredEnemyType. Neither
 * source type carries a buff name, so for buff-gated subjects we inspect the raw
 * skill text and tag the common "Stealth" gate so Phase 2 can resolve it.
 * NOTE: A deliberately-divergent 4-arg twin lives in flatInputToAbilities.ts (no rawText/Stealth-tagging).
 */
export function toCondition(
    condition: ConditionalCondition,
    derivable: boolean,
    manualCount: number | undefined,
    requiredEnemyType: EnemyBaseClass | undefined,
    rawText: string
): Condition {
    const out: Condition = {
        // ConditionalCondition is a subset of ConditionSubject.
        subject: condition,
        derivable,
        ...(manualCount !== undefined ? { manualCount } : {}),
        ...(requiredEnemyType ? { requiredEnemyType } : {}),
    };

    if ((condition === 'enemy-buff' || condition === 'self-buff') && /stealth/i.test(rawText)) {
        out.buffName = 'Stealth';
    }

    return out;
}

/** A parsed ability together with its position anchor in the raw skill text. */
interface PositionedAbility {
    ability: Ability;
    pos: number;
}

const MAX_POS = Number.MAX_SAFE_INTEGER;

// NOTE on anchor precision: only the relative order of `dot` vs later gated payload
// abilities is sim-meaningful (the gateFiringAbilities overlay). Keyword anchors for
// charge/extend/modifiers are heuristics that may land on an earlier mention of the
// word (e.g. "removes 1 charge ... adds 1 charge") — cosmetic editor-order only.

/**
 * One-target-per-skill game rule (user-verified 2026-06-07; Hermes/Isha live-verification bug).
 * A bare repair/cleanse (no recipient phrase, so the parser defaulted target to 'self') on an
 * ACTIVE or CHARGED skill with NO damage component is a pure support skill — it targets an ally,
 * so the heal/cleanse routes to the ally, not the caster. Example: Hermes' active "This Unit
 * Repairs 27% of its Max HP." with charged "If the target has less than 40% HP …" — the skill
 * targets an ally. Damage-rider repairs (skill has a damage component → it targets an enemy, the
 * repair is a self rider), passive repairs, and explicit recipients are unaffected. Shields are
 * deliberately NOT flipped ("gains a Shield" stays self).
 *
 * Exception (user-verified 2026-06-07): a bare repair whose own sentence is gated on a
 * SELF-DAMAGE condition ("if this unit has been directly damaged this round") is a SELF-heal —
 * the caster is the one absorbing hits and recovering. Meatshield's active is the canonical case:
 * "If this Unit has been directly damaged this round, it repairs 5% of its max HP." must stay
 * 'self'. `healSentence` carries the sentence containing the heal match so the guard is
 * scoped to that clause alone (not a skill-wide keyword scan).
 *
 * PASSIVE recipient rules (user-verified 2026-06-07 via Cultivator vs Morao). Bare passive
 * repairs default to self, but two trigger shapes in the heal's own sentence flip the recipient:
 *  (A) an ally-damage trigger ("when an ally … damaged") always heals THAT damaged ally —
 *      Cultivator passive 2 "when an ally is directly damaged … repairs 8% of this unit's HP".
 *  (B) a cleanse trigger ("when this unit cleanses" / "upon cleansing") heals the cleansed ALLY
 *      only when the caster is a SUPPORTER (supporters cleanse allies); it stays SELF for every
 *      other role (defenders cleanse themselves). Cultivator (SUPPORTER) passive 1 → ally; Morao
 *      (DEFENDER) "upon cleansing a debuff, repairs an additional 50%" → self. Basis stays caster HP.
 * `role` is threaded from the ship (`ship.type`, the ship-class field) so rule B can read the class.
 *
 * SHIELD verb rule (live-verification finding 2026-06-07; Aegis/Nyxen). Shields are NOT flipped
 * by default ("gains a Shield" stays self), but on a pure-support active/charged skill a shield
 * whose own clause uses a GRANT verb ("grants a/the shield …", no explicit receiver) targets the
 * ally — Aegis "grants a shield equal to 21% of its Max HP" routes the pool to the heal target.
 * "gains a shield" never flips. The caller passes `shieldGrantVerb` only when the shield's sentence
 * matches the grant-verb→shield shape; heals leave it false (their flip is unconditional above).
 */
function flipBareSupportTarget(
    target: 'self' | 'ally' | 'all-allies',
    explicitTarget: boolean,
    slot: SkillSlot,
    hasDamage: boolean,
    healSentence?: string,
    role?: ShipTypeName
): 'self' | 'ally' | 'all-allies' {
    if (
        !explicitTarget &&
        target === 'self' &&
        (slot === 'active' || slot === 'charged') &&
        !hasDamage
    ) {
        // Self-damage-conditional: the heal sentence conditions on "if this unit (has been|was|is|
        // gets|takes) … damag…" → the caster is the tank, so this is a self-heal, not an ally-heal.
        // No lookbehind needed — the sentence boundary is already scoped by sentenceContaining().
        if (
            healSentence &&
            /if this unit (?:has been|was|is|gets|takes)[^.;]*damag/i.test(healSentence)
        ) {
            return 'self';
        }
        return 'ally';
    }

    // PASSIVE recipient rules — see the jsdoc above. (A) ally-damage trigger → heal that ally;
    // (B) cleanse trigger → ally for SUPPORTERs, self otherwise (Cultivator vs Morao, user-verified).
    if (!explicitTarget && target === 'self' && slot === 'passive' && healSentence) {
        if (/when an ally [^.;]*(?:is |gets |was )?(?:directly )?damaged/i.test(healSentence)) {
            return 'ally';
        }
        if (
            /(?:when this unit cleanses|upon cleansing)/i.test(healSentence) &&
            role === 'SUPPORTER'
        ) {
            return 'ally';
        }
    }

    return target;
}

function abilitiesFromText(
    text: string,
    slot: SkillSlot,
    role?: ShipTypeName
): PositionedAbility[] {
    // Build the list in construction order first (so out[0]?.type === 'damage' checks work
    // for condition/scaling attachment). Positions are computed in parallel and applied
    // at the END via a single stable sort — so construction order never leaks into the result.
    const out: PositionedAbility[] = [];

    const mult = parseSkillDamage(text);
    // Anchor at the tag carrying THIS multiplier — the first <unit-damage> tag in the
    // row may be something else entirely (e.g. "20% defense penetration" before the
    // damage), which would wrongly sort the damage ahead of a dot the text puts first.
    const escNum = (n: number) => String(n).replace('.', '\\.');
    const damageTagPos = text.search(
        new RegExp(`<unit-damage>\\s*${escNum(mult)}%\\s*damage`, 'i')
    );
    const damagePos = damageTagPos >= 0 ? damageTagPos : text.search(/<unit-damage>/i);
    if (mult > 0) {
        const hits = parseHitCount(text);
        const noCrit = parseNoCrit(text);
        out.push({
            ability: {
                id: nextId(),
                type: 'damage',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: {
                    type: 'damage',
                    multiplier: mult,
                    ...(hits !== undefined ? { hits } : {}),
                    ...(noCrit ? { noCrit: true } : {}),
                },
                autoFilled: true,
            },
            pos: damagePos >= 0 ? damagePos : MAX_POS,
        });
    }

    const sec = parseSecondaryDamage(text);
    if (sec) {
        // Anchor at the tag carrying the secondary % (value-targeted, like damage above);
        // fall back to the second <unit-damage> tag, then the first.
        const secTagIdx = text.search(
            new RegExp(`<unit-damage>(?:damage equal to\\s*)?${escNum(sec.pct)}%`, 'i')
        );
        const firstDmgTag = '<unit-damage>';
        const firstIdx = text.search(/<unit-damage>/i);
        const fallbackIdx =
            firstIdx >= 0 ? text.indexOf(firstDmgTag, firstIdx + firstDmgTag.length) : -1;
        const secondIdx = secTagIdx >= 0 ? secTagIdx : fallbackIdx;
        out.push({
            ability: {
                id: nextId(),
                type: 'additional-damage',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'additional-damage', stat: sec.stat, pct: sec.pct },
                autoFilled: true,
            },
            pos: secondIdx >= 0 ? secondIdx : firstIdx >= 0 ? firstIdx : MAX_POS,
        });
    }

    // Conditional scaling only attaches to a base-damage ability. An orphan
    // conditional (no base damage parsed) is intentionally dropped here — the
    // user adds it in the editor; auto-fill never crashes or mis-attaches it.
    const cond = parseConditionalDamage(text);
    if (cond && out[0]?.ability.type === 'damage') {
        out[0].ability.conditions = [
            toCondition(
                cond.condition,
                cond.derivable,
                cond.manualCount,
                cond.requiredEnemyType,
                text
            ),
        ];
        out[0].ability.scaling = {
            conditionIndex: 0,
            perUnit: cond.pct,
            ...(cond.cap !== undefined ? { cap: cond.cap } : {}),
        };
    }

    // "deals N% damage to enemies with less than X% HP" gates the damage on an enemy-HP
    // threshold (no scaling). Only when no conditional scaling was attached above.
    const hpGate = parseHpThresholdCondition(text);
    if (hpGate && out[0]?.ability.type === 'damage' && !out[0].ability.scaling) {
        out[0].ability.conditions = [
            ...out[0].ability.conditions,
            {
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: hpGate.hpComparator,
                hpPercent: hpGate.hpPercent,
            },
        ];
    }

    // "when an ally inflicts a debuff, this Unit deals N% damage" — gate the damage on the
    // manual, team-dependent ally-inflicts-debuff trigger (Provider).
    if (parseAllyInflictsDebuff(text) && out[0]?.ability.type === 'damage') {
        out[0].ability.conditions = [
            ...out[0].ability.conditions,
            { subject: 'ally-inflicts-debuff', derivable: false },
        ];
    }

    // "deals N% damage to enemies (with|afflicted with) <effect>" — gate the damage on the enemy
    // having that effect (Incinerator's "100% damage to all enemies with Inferno").
    const damageEffects = damageEnemyEffectNamesFromClause(text);
    if (damageEffects.length && out[0]?.ability.type === 'damage') {
        out[0].ability.conditions = [
            ...out[0].ability.conditions,
            ...enemyEffectConditions(damageEffects),
        ];
    }

    const extendTurns = parseExtendDoT(text);
    if (extendTurns) {
        const extendPos = text.search(/extend/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'extend-dot',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'extend-dot', turns: extendTurns },
                autoFilled: true,
            },
            pos: extendPos >= 0 ? extendPos : MAX_POS,
        });
    }

    // Crit-power-chance extension (Valerian self-crit; Belladonna ally-inflicts → team).
    const critExtend = parseCritPowerExtend(text);
    if (critExtend) {
        const critExtendPos = text.search(/extend/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'extend-dot',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [critExtend.condition],
                config: {
                    type: 'extend-dot',
                    turns: critExtend.turns,
                    chanceFromCritPower: true,
                    scope: critExtend.scope,
                },
                autoFilled: true,
            },
            pos: critExtendPos >= 0 ? critExtendPos : MAX_POS,
        });
    }

    // Crocus: "when an ally crits with a DoT, inflict <DoT>" → routes through the reactive
    // on-ally-crit-dot trigger machinery (live trigger; reactive partitioning is slot-agnostic
    // so the passive slot is fine). The manual 'ally-crit-dot' ConditionSubject survives in the
    // union for stored editor configs only (annotation-only, never simulated — no migration needed).
    if (parseAllyCritDot(text)) {
        for (const eff of parseSkillEffects(text, 'active')) {
            const info = DOT_TIER_MAP[eff.buffName];
            if (!info) continue;
            const allyCritDotPos = text.indexOf(eff.buffName);
            out.push({
                ability: {
                    id: nextId(),
                    type: 'dot',
                    target: 'enemy',
                    trigger: 'on-ally-crit-dot',
                    conditions: [],
                    config: {
                        type: 'dot',
                        dotType: info.type,
                        tier: info.tier,
                        stacks: eff.stacks ?? 1,
                        duration: typeof eff.duration === 'number' ? eff.duration : 2,
                    },
                    autoFilled: true,
                },
                pos: allyCritDotPos >= 0 ? allyCritDotPos : MAX_POS,
            });
        }
    }

    const detonate = parseDetonateDoT(text);
    if (detonate) {
        const detonatePos = text.search(/detonat/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'detonate-dot',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: {
                    type: 'detonate-dot',
                    dotType: detonate.dotType,
                    powerPct: detonate.powerPct,
                },
                autoFilled: true,
            },
            pos: detonatePos >= 0 ? detonatePos : MAX_POS,
        });
    }

    const accumulate = parseAccumulateDetonate(text);
    if (accumulate) {
        const accumulatePos = text.search(/echoing burst/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'accumulate-detonate',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: {
                    type: 'accumulate-detonate',
                    turns: accumulate.turns,
                    pct: accumulate.pct,
                },
                autoFilled: true,
            },
            pos: accumulatePos >= 0 ? accumulatePos : MAX_POS,
        });
    }

    // Heal / shield grants (and cleanse) — parsed narrowly (on-cast, percentage-of-stat only;
    // damage-reactive and revive shapes emit nothing, see parseHealAbilities). The combat engine
    // ignores these types for now (DPS unchanged); they carry the model for the healing calculator.
    const healNoCrit = parseHealNoCrit(text);
    for (const h of parseHealAbilities(text)) {
        // Anchor at the tag carrying THIS pct (mirrors the damage anchor convention). If multiple
        // heal components share the same pct the regex may hit the wrong tag — acceptable, since
        // the position only drives cosmetic editor order (the engine ignores heal types).
        const healTagPos = text.search(new RegExp(`<unit-damage>(?:[^<]*?)${escNum(h.pct)}%`, 'i'));
        const fallbackPos = text.search(h.kind === 'shield' ? /shield/i : /repair/i);
        const healPos = healTagPos >= 0 ? healTagPos : fallbackPos;
        // Pallas: a heal/shield whose anchor falls in the "when this unit critically repairs an
        // ally" sentence rides the on-ally-critically-repaired reactive trigger (position-scoped;
        // undefined → on-cast). Cultivator R2: a heal/shield anchored in the "when an ally is
        // directly damaged" sentence rides on-ally-damaged (fires per ally direct hit).
        const reactiveTrigger =
            detectCritRepairTrigger(text, healPos) ?? detectAllyDamagedTrigger(text, healPos);
        // Heals always run the bare-support flip (pass hasDamage so a damage-rider repair stays
        // self, and the heal sentence so the self-damage-conditional guard can scope to that clause
        // — Meatshield; see jsdoc). Shields flip ONLY when their own clause uses a GRANT verb
        // ("grants a/the shield …"); a "gains a shield" or damage-rider shield keeps its parse
        // (live-verification finding 2026-06-07; Aegis/Nyxen vs start-of-combat "gains a Shield").
        const healPlain = stripTags(text).replace(/<br\s*\/?>/gi, '. ');
        const healPlainPos = healPlain.search(new RegExp(`${escNum(h.pct)}%`, 'i'));
        const healSentence = healPlainPos >= 0 ? sentenceContaining(healPlain, healPlainPos) : '';
        const shieldFlips =
            h.kind === 'shield' && /\bgrants?\b[^.;]{0,40}shield/i.test(healSentence);
        const healTarget =
            h.kind === 'heal' || shieldFlips
                ? flipBareSupportTarget(
                      h.target,
                      h.explicitTarget,
                      slot,
                      mult > 0,
                      healSentence,
                      role
                  )
                : h.target;
        out.push({
            ability: {
                id: nextId(),
                type: h.kind,
                target: healTarget,
                trigger: reactiveTrigger ?? 'on-cast',
                conditions: [],
                config: {
                    type: h.kind,
                    pct: h.pct,
                    basis: h.basis,
                    ...(h.kind === 'heal' && healNoCrit ? { noCrit: true } : {}),
                },
                autoFilled: true,
            },
            pos: healTagPos >= 0 ? healTagPos : fallbackPos >= 0 ? fallbackPos : MAX_POS,
        });
    }

    for (const c of parseCleanse(text)) {
        const cleansePos = text.search(/cleanse/i);
        // Pallas: "when this unit critically repairs an ally, it cleanses 1 debuff from itself" —
        // the cleanse rides the on-ally-critically-repaired reactive trigger (position-scoped). A
        // cleanse anchored in a "when an ally is directly damaged" sentence rides on-ally-damaged.
        const reactiveTrigger =
            detectCritRepairTrigger(text, cleansePos) ?? detectAllyDamagedTrigger(text, cleansePos);
        const cleanseTarget = flipBareSupportTarget(c.target, c.explicitTarget, slot, mult > 0);
        out.push({
            ability: {
                id: nextId(),
                type: 'cleanse',
                target: cleanseTarget,
                trigger: reactiveTrigger ?? 'on-cast',
                conditions: [],
                config: { type: 'cleanse', count: c.count },
                autoFilled: true,
            },
            pos: cleansePos >= 0 ? cleansePos : MAX_POS,
        });
    }

    const charge = parseChargeGain(text);
    if (charge) {
        const chargePos = text.search(/charge/i);
        // Inflict-driven charge gains fire on a reactive event (+amount per infliction). Pallas's
        // "when an ally critically hits ... gains 1 charge" rides the on-ally-crit reactive trigger
        // (sentence-scoped). Either reactive source means the trigger IS the gate → no gating
        // condition. parseChargeGain's own trigger (inflict-driven) takes precedence when present.
        const allyCritChargeTrigger = detectAllyCritTrigger(text, chargePos);
        const reactiveTrigger = charge.trigger ?? allyCritChargeTrigger;
        out.push({
            ability: {
                id: nextId(),
                type: 'charge',
                target: 'self',
                trigger: reactiveTrigger ?? 'on-cast',
                conditions: reactiveTrigger
                    ? []
                    : [
                          toCondition(
                              charge.condition,
                              charge.derivable,
                              charge.manualCount,
                              charge.requiredEnemyType,
                              text
                          ),
                      ],
                config: { type: 'charge', amount: charge.amount },
                autoFilled: true,
            },
            pos: chargePos >= 0 ? chargePos : MAX_POS,
        });
    }

    const extra = parseExtraAction(text);
    if (extra) {
        // Raw-text anchor, matching the charge block's convention (text.search) —
        // stripUnitTags is module-local to skillTextParser and NOT exported.
        const extraPos = text.search(/extra\s+(?:end\s+of\s+round\s+)?action/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'extra-action',
                target: 'self',
                trigger: 'on-cast',
                conditions: extra.conditions,
                config: { type: 'extra-action', oncePerRound: extra.oncePerRound },
                autoFilled: true,
            },
            pos: extraPos >= 0 ? extraPos : MAX_POS,
        });
    }

    const modifierPos = text.search(/more|increase|penetration/i);
    for (const modifier of parseModifiers(text)) {
        out.push({
            ability: {
                id: nextId(),
                type: 'modifier',
                target: modifier.target,
                trigger: 'on-cast',
                conditions: modifier.conditions,
                ...(modifier.scaling ? { scaling: modifier.scaling } : {}),
                config: {
                    type: 'modifier',
                    channel: modifier.channel,
                    value: modifier.value,
                    isMultiplicative: modifier.isMultiplicative,
                },
                autoFilled: true,
            },
            pos: modifierPos >= 0 ? modifierPos : MAX_POS,
        });
    }

    // buff/debuff abilities are NOT emitted here (deferred). DoT abilities are
    // merged at the ship level in buildShipAbilities via buildDoTAutoFill.
    return out;
}

function dotAbility(entry: DoTApplicationEntry): Ability {
    return {
        // entry.id is intentionally discarded; abilities are rebuilt wholesale per ship (not carried from autofill dedup).
        id: nextId(),
        type: 'dot',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'dot',
            dotType: entry.type,
            tier: entry.tier,
            stacks: entry.stacks,
            duration: entry.duration,
        },
        autoFilled: true,
    };
}

/**
 * Maps a SelectedGameBuff's skillSource onto the editor slot that owns it.
 * Charge buffs land on 'charged'; any passive source collapses to the single
 * 'passive' slot. Undefined defaults to 'active' (the safest, most common slot).
 */
function slotForBuffSource(skillSource: SelectedGameBuff['skillSource']): SkillSlot {
    switch (skillSource) {
        case 'charge':
            return 'charged';
        case 'passive1':
        case 'passive2':
        case 'passive3':
            return 'passive';
        case 'active':
        default:
            return 'active';
    }
}

export function buildShipAbilities(ship: Ship): ShipSkills {
    counter = 0;

    // DoTs are derived at the ship level (active/charge only — no passive DoTs).
    const { activeDoTs, chargedDoTs } = buildDoTAutoFill(ship);
    const dotsForSlot = (slot: SkillSlot): DoTApplicationEntry[] =>
        slot === 'active' ? activeDoTs : slot === 'charged' ? chargedDoTs : [];

    const bySlot = new Map<SkillSlot, PositionedAbility[]>();
    for (const row of getShipSkillRows(ship)) {
        const slot = slotFor(row.label);
        if (!slot) continue;
        const positioned = abilitiesFromText(row.text, slot, ship.type);
        pushToSlot(bySlot, slot, positioned);
    }

    // Merge ship-level DoTs into their slots (creating the slot entry if needed).
    // Position anchor: index of the DoT type name (e.g. "Corrosion", "Inferno") in the row text.
    for (const slot of ['active', 'charged'] as const) {
        const rowText = getSkillRowForSlot(ship, slot)?.text ?? '';
        const dots = dotsForSlot(slot).map((entry) => {
            const pos = rowText.search(new RegExp(entry.type, 'i'));
            const ability = dotAbility(entry);
            // Crit-inflicted DoT form ("When this Unit critically hits an enemy it inflicts
            // Corrosion …"): route through the reactive machinery. Anchor on the DoT type name,
            // matching the position search above.
            const reactiveTrigger = rowText
                ? detectReactiveTrigger(rowText, entry.type)
                : undefined;
            if (reactiveTrigger) ability.trigger = reactiveTrigger;
            return { ability, pos: pos >= 0 ? pos : MAX_POS };
        });
        if (!dots.length) continue;
        pushToSlot(bySlot, slot, dots);
    }

    // Merge ship-level buffs/debuffs into their slots (DoTs are already excluded
    // by buildSkillBuffAutoFill). selfBuffs target 'self', enemyDebuffs 'enemy'.
    const { selfBuffs, enemyDebuffs } = buildSkillBuffAutoFill(ship);
    const mergeBuff = (buff: SelectedGameBuff, target: AbilityTarget) => {
        const ability = selectedBuffToAbility(buff, target);
        // defensive: round-trip buffs may lack the flag; parser buffs already set it
        if (ability.autoFilled === undefined) ability.autoFilled = true;
        const slot = slotForBuffSource(buff.skillSource);
        // Attach a gating condition parsed from the buff's clause (e.g. Thresh's
        // "When targeting a Defender, … gains Crit Power Up II" → enemy-type Defender).
        const rowText = getSkillRowForSlot(ship, slot)?.text ?? '';
        const conditions = rowText ? detectGrantConditions(rowText, buff.buffName) : [];
        if (conditions.length) {
            ability.conditions = conditions;
        }
        // Reactive trigger (crit / start-of-round / bomb-detonate) detected on this buff's
        // clause: route through the engine's trigger machinery instead of a gating condition.
        // The trigger IS the gate, so drop the now-redundant self-crit condition (start-of-round
        // and bomb-detonate phrasings produce no condition from detectGrantConditions). Any other
        // conditions (e.g. an enemy-type co-gate) are preserved.
        const reactiveTrigger = rowText ? detectReactiveTrigger(rowText, buff.buffName) : undefined;
        if (reactiveTrigger) {
            ability.trigger = reactiveTrigger;
            ability.conditions = ability.conditions.filter((c) => c.subject !== 'self-crit');
        }
        // Position anchor: index of the buff name in the row text (order-irrelevant for
        // buff/debuff abilities, but placed consistently so ties resolve by insertion order).
        const pos = rowText ? rowText.indexOf(buff.buffName) : -1;
        pushToSlot(bySlot, slot, [{ ability, pos: pos >= 0 ? pos : MAX_POS }]);
    };
    // Player-side grants carry their parser ally-scope (self/ally/all-allies) so the engine
    // routes a walked team ship's grants correctly. Defaults to 'self' for round-trip buffs
    // that predate the effectTarget field (e.g. manual picks converted via abilityToSelectedBuff).
    for (const buff of selfBuffs) mergeBuff(buff, buff.effectTarget ?? 'self');
    // Accumulate-and-detonate effects (e.g. Echoing Burst) are represented by their own
    // accumulate-detonate ability from abilitiesFromText — skip the inert debuff card so
    // the effect isn't double-listed in the editor.
    for (const buff of enemyDebuffs) {
        if (isAccumulateDetonateEffect(buff.buffName)) continue;
        mergeBuff(buff, 'enemy');
    }

    // Sort each slot's abilities by their text position (stable sort preserves insertion
    // order for ties). This is the ONLY sort — construction order inside abilitiesFromText
    // is preserved during condition/scaling attachment and only reordered here.
    const slots: Skill[] = [];
    for (const [slot, positioned] of bySlot) {
        if (!positioned.length) continue;
        positioned.sort((a, b) => a.pos - b.pos);
        slots.push({ slot, abilities: positioned.map((p) => p.ability) });
    }
    return { slots };
}
