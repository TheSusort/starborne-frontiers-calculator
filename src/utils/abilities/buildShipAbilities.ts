import { Ship } from '../../types/ship';
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
    detectGrantConditions,
    parseHpThresholdCondition,
    parseExtendDoT,
    parseCritPowerExtend,
    parseAllyCritDot,
    parseNoCrit,
    parseAllyInflictsDebuff,
    parseDetonateDoT,
    parseAccumulateDetonate,
    isAccumulateDetonateEffect,
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
    if (/debuff/.test(what) && /enem|target/.test(what))
        return { subject: 'enemy-debuff', derivable: false };
    if (/buff/.test(what) && /enem|target/.test(what))
        return { subject: 'enemy-buff', derivable: false };
    if (/adjacent all/.test(what)) return { subject: 'adjacent-ally', derivable: false };
    if (/debuff/.test(what)) return { subject: 'self-debuff', derivable: true };
    if (/buff/.test(what)) return { subject: 'self-buff', derivable: true };
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
        if (/for each/i.test(sentence)) {
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
    // → an outgoing-damage bonus (Obsidian; Akula's HP-scaling "up to 30%" is modelled flat at its
    // max, since the sim treats the enemy as full HP).
    const incM = plain.match(
        /increases?\s+(?:outgoing\s+)?(?:direct\s+)?damage\s+by\s+(?:up\s+to\s+)?(\d+(?:\.\d+)?)%/i
    );
    if (incM) {
        const sentence = sentenceContaining(plain, incM.index!);
        const conditions: Condition[] = [];
        if (/\benem(?:y|ies)\b[^.]*\bwith\b/i.test(sentence)) {
            conditions.push(...enemyEffectConditions(enemyEffectNamesFromClause(text)));
        }
        const hpCond = hpThresholdFromSentence(sentence);
        if (hpCond) conditions.push(hpCond);
        out.push({
            channel: 'outgoingDamage',
            value: parseFloat(incM[1]),
            isMultiplicative: true,
            target: /friendly|all allies|allies/i.test(sentence) ? 'all-allies' : 'self',
            conditions,
        });
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
 * Helper to append abilities to a slot in the abilities map, creating the entry if needed.
 */
function pushToSlot(
    bySlot: Map<SkillSlot, Ability[]>,
    slot: SkillSlot,
    abilities: Ability[]
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

function abilitiesFromText(text: string): Ability[] {
    const out: Ability[] = [];

    const mult = parseSkillDamage(text);
    if (mult > 0) {
        const hits = parseHitCount(text);
        const noCrit = parseNoCrit(text);
        out.push({
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
        });
    }

    const sec = parseSecondaryDamage(text);
    if (sec) {
        out.push({
            id: nextId(),
            type: 'additional-damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'additional-damage', stat: sec.stat, pct: sec.pct },
            autoFilled: true,
        });
    }

    // Conditional scaling only attaches to a base-damage ability. An orphan
    // conditional (no base damage parsed) is intentionally dropped here — the
    // user adds it in the editor; auto-fill never crashes or mis-attaches it.
    const cond = parseConditionalDamage(text);
    if (cond && out[0]?.type === 'damage') {
        out[0].conditions = [
            toCondition(
                cond.condition,
                cond.derivable,
                cond.manualCount,
                cond.requiredEnemyType,
                text
            ),
        ];
        out[0].scaling = {
            conditionIndex: 0,
            perUnit: cond.pct,
            ...(cond.cap !== undefined ? { cap: cond.cap } : {}),
        };
    }

    // "deals N% damage to enemies with less than X% HP" gates the damage on an enemy-HP
    // threshold (no scaling). Only when no conditional scaling was attached above.
    const hpGate = parseHpThresholdCondition(text);
    if (hpGate && out[0]?.type === 'damage' && !out[0].scaling) {
        out[0].conditions = [
            ...out[0].conditions,
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
    if (parseAllyInflictsDebuff(text) && out[0]?.type === 'damage') {
        out[0].conditions = [
            ...out[0].conditions,
            { subject: 'ally-inflicts-debuff', derivable: false },
        ];
    }

    // "deals N% damage to enemies (with|afflicted with) <effect>" — gate the damage on the enemy
    // having that effect (Incinerator's "100% damage to all enemies with Inferno").
    const damageEffects = damageEnemyEffectNamesFromClause(text);
    if (damageEffects.length && out[0]?.type === 'damage') {
        out[0].conditions = [...out[0].conditions, ...enemyEffectConditions(damageEffects)];
    }

    const extendTurns = parseExtendDoT(text);
    if (extendTurns) {
        out.push({
            id: nextId(),
            type: 'extend-dot',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'extend-dot', turns: extendTurns },
            autoFilled: true,
        });
    }

    // Crit-power-chance extension (Valerian self-crit; Belladonna ally-inflicts → team).
    const critExtend = parseCritPowerExtend(text);
    if (critExtend) {
        out.push({
            id: nextId(),
            type: 'extend-dot',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [critExtend.condition],
            config: { type: 'extend-dot', turns: critExtend.turns, chanceFromCritPower: true },
            autoFilled: true,
        });
    }

    // Crocus: "when an ally crits with a DoT, inflict <DoT>" → a DoT gated by the manual,
    // team-dependent ally-crit-dot condition (passive — represented for the editor, not simulated).
    if (parseAllyCritDot(text)) {
        for (const eff of parseSkillEffects(text, 'active')) {
            const info = DOT_TIER_MAP[eff.buffName];
            if (!info) continue;
            out.push({
                id: nextId(),
                type: 'dot',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [{ subject: 'ally-crit-dot', derivable: false }],
                config: {
                    type: 'dot',
                    dotType: info.type,
                    tier: info.tier,
                    stacks: eff.stacks ?? 1,
                    duration: typeof eff.duration === 'number' ? eff.duration : 2,
                },
                autoFilled: true,
            });
        }
    }

    const detonate = parseDetonateDoT(text);
    if (detonate) {
        out.push({
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
        });
    }

    const accumulate = parseAccumulateDetonate(text);
    if (accumulate) {
        out.push({
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
        });
    }

    const charge = parseChargeGain(text);
    if (charge) {
        out.push({
            id: nextId(),
            type: 'charge',
            target: 'self',
            trigger: 'on-cast',
            conditions: [
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
        });
    }

    for (const modifier of parseModifiers(text)) {
        out.push({
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

    const bySlot = new Map<SkillSlot, Ability[]>();
    for (const row of getShipSkillRows(ship)) {
        const slot = slotFor(row.label);
        if (!slot) continue;
        const abilities = abilitiesFromText(row.text);
        pushToSlot(bySlot, slot, abilities);
    }

    // Merge ship-level DoTs into their slots (creating the slot entry if needed).
    for (const slot of ['active', 'charged'] as const) {
        const dots = dotsForSlot(slot).map(dotAbility);
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
        const rowText = getSkillRowForSlot(ship, slot)?.text;
        const conditions = rowText ? detectGrantConditions(rowText, buff.buffName) : [];
        if (conditions.length) {
            ability.conditions = conditions;
        }
        pushToSlot(bySlot, slot, [ability]);
    };
    for (const buff of selfBuffs) mergeBuff(buff, 'self');
    // Accumulate-and-detonate effects (e.g. Echoing Burst) are represented by their own
    // accumulate-detonate ability from abilitiesFromText — skip the inert debuff card so
    // the effect isn't double-listed in the editor.
    for (const buff of enemyDebuffs) {
        if (isAccumulateDetonateEffect(buff.buffName)) continue;
        mergeBuff(buff, 'enemy');
    }

    const slots: Skill[] = [];
    for (const [slot, abilities] of bySlot) {
        if (abilities.length) slots.push({ slot, abilities });
    }
    return { slots };
}
