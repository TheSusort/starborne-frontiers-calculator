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
    AbilityTrigger,
    ModifierChannel,
    ScalingRule,
    ControlEffect,
    IncomingCondition,
} from '../../types/abilities';
import { getShipSkillRows, getSkillRowForSlot } from '../ship/skillRows';
import {
    parseSkillDamage,
    parseCounterAbilities,
    parseDamageReflection,
    parseSecondaryDamage,
    parseOnResistHpDamage,
    parseOnResistShieldDamage,
    parseKilledByDirectHpDamage,
    parseShieldStrip,
    parseConditionalDamage,
    parseEnemyEffectDamageBonus,
    parseDotEntryDamageScaling,
    parseConditionalStasisApplied,
    parseChargeGain,
    parseAllyChargeOnEnemyDeath,
    parseAllyChargeGrant,
    parseExtraAction,
    detectGrantConditions,
    detectReactiveTrigger,
    detectAllyInflictsGrantTrigger,
    detectPreCombatBuffTrigger,
    detectPreCombatShieldTrigger,
    detectDamageReactionTrigger,
    detectHpCrossingTrigger,
    detectTargetHpGate,
    detectHitCount,
    parseHpThresholdCondition,
    parseExtendDoT,
    parseExtendStatus,
    parseCritPowerExtend,
    parseDebuffDurationReduction,
    parseBombCountdownReduce,
    parseAllyCritDot,
    detectAllyCritDotTrigger,
    parseSelfCritDotEffect,
    detectSelfCritDotTrigger,
    detectBombDetonatedTrigger,
    detectCritRepairTrigger,
    detectDebuffInflictedTrigger,
    detectStasisAppliedTrigger,
    detectCheatDeathActivatedTrigger,
    detectDestroyedTrigger,
    detectEnemyDestroyedTrigger,
    detectEnemyCleanseTrigger,
    detectEnemyPurgedTrigger,
    detectAllyPurgedTrigger,
    detectAllyDebuffedTrigger,
    detectEndOfRoundPurgeTrigger,
    detectStartOfRoundTrigger,
    detectEveryTurnTrigger,
    detectEndOfRoundDamageTrigger,
    detectRoundStartContinuationTrigger,
    detectKilledByDirectDamageTrigger,
    detectDealDamageToRoleTrigger,
    detectPurgeEnemyTypeCondition,
    detectMostBuffsTarget,
    parseHighestSpeedEnemyTarget,
    parseHighestAttackEnemyTarget,
    detectRepairedThisRoundCondition,
    detectEnemyRepairedTrigger,
    detectEnemyDotDamageTrigger,
    detectCorrosionSpreadTrigger,
    detectShieldStrippedTrigger,
    detectTargetShieldGate,
    ONCE_PER_ROUND_PER_ENEMY_RE,
    PURGE_MORE_RE,
    parseControlInflicts,
    detectAllyCritTrigger,
    detectEnemyBuffedTrigger,
    detectAllyShieldDestroyedTrigger,
    detectCleanseOncePerRound,
    parseNoCrit,
    parseIgnoresDefense,
    parseIgnoresStealth,
    parseForceAffinityAdvantage,
    parseDoesntBreakStasis,
    parseChargeLossImmune,
    detectIgnoresForcedTargeting,
    detectIgnoresStealth,
    parseChargeRemoval,
    parseSelfBuffRemovals,
    parseEnemyChargedCastReaction,
    REMOVE_CHARGE_RE,
    ONCE_PER_ALLY_PER_ROUND_RE,
    parseAllyInflictsDebuff,
    parseDetonateDoT,
    parseAccumulateDetonate,
    isAccumulateDetonateEffect,
    parseHealAbilities,
    parseCleanse,
    parsePurge,
    parseBuffSteal,
    detectPassiveVoicePurge,
    detectPurgeStripsShield,
    parseHealNoCrit,
    parseSkillEffects,
    classifyEnemyEffect,
    statusEffectCondition,
    parsePreCombatStatGrants,
    detectTransformToDot,
    detectProtectionTransformToDot,
    detectConvertDot,
    parseInsteadDamageReplacement,
    parseDefenseSubstitution,
    parseWhileShieldedFlatDefence,
    findBuffNamePos,
    maskAbbrev,
    detectExtraActionCoTrigger,
    detectEnemyGrantScope,
    adjacentEnemyScopeForName,
    adjacentEnemyScopeAtPos,
} from '../skillTextParser';
import {
    buildDoTAutoFill,
    buildSkillBuffAutoFill,
    DOT_TIER_MAP,
} from '../calculators/skillBuffAutoFill';
import { CHEAT_DEATH_BUFFS } from '../combat/cheatDeathBuffs';
import { TOXIC_OVERFLOW, TOXIC_OVERFLOW_DURATION } from '../../constants/toxicOverflow';
import { selectedBuffToAbility } from './buffAbilityConverters';

let counter = 0;
const nextId = () => `ab${counter++}`;

// Maps a parsed ControlEffect back to the display name used in the skill text's <unit-skill>
// tag (mirrors CONTROL_INFLICTS' `tag` field in skillTextParser.ts), so the control-ability
// target-scoping step (Wave 5, Task A2) can key `detectEnemyGrantScope` on the right buff name.
const CONTROL_EFFECT_DISPLAY_NAME: Record<ControlEffect, string> = {
    stasis: 'Stasis',
    provoke: 'Provoke',
    'concentrate-fire': 'Concentrate Fire',
    disable: 'Disable',
    taunt: 'Taunt',
};

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
 * SP-F F1 — Panon's "instead"-branch BASE gate: fires only when the acting Unit currently
 * carries NEITHER Taunt NOR Provoke — the negated complement of the replacement branch's
 * `statusEffectCondition(name, true)` anyOf pair. `Condition.negate` is a false friend here
 * (evaluateConditions.ts only honors it for the 'enemy-type' subject); `countComparator:'eq',
 * countThreshold:0` is the real negation idiom for self-buff/self-debuff subjects (both must
 * hold — AND, not anyOf — since the base branch is the "neither" case).
 */
function tauntProvokeAbsentConditions(): Condition[] {
    return ['Taunt', 'Provoke'].map((name) => ({
        ...statusEffectCondition(name),
        countComparator: 'eq' as const,
        countThreshold: 0,
    }));
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
 * Sub-project I, PR I4a — effect names in a "When an enemy has <status>," PREFIX clause,
 * read from the raw <unit-skill> tag. Distinct from `enemyEffectNamesFromClause`'s "enemies
 * with <effect>" phrasing (which scans to the END of the sentence): Wildfire's gate reads
 * "When an enemy has Scorching Radiation, this Unit deals 1% additional Inferno damage…" —
 * the status name sits in a COMMA-SEPARATED PREFIX, and the damage clause that follows ALSO
 * wraps its DoT name ("Inferno") in a <unit-skill> tag. Scanning to end-of-sentence (like
 * enemyEffectNamesFromClause) would incorrectly pick up "Inferno" as a second gate name, so
 * this helper stops at the first COMMA instead.
 */
function enemyHasNamesFromClause(rawText: string): string[] {
    const m = rawText.match(/\bwhen\s+an?\s+enem(?:y|ies)\s+has\b([^,]*)/i);
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
 * (the sim tracks enemy debuff/DoT counts), buffs → derivable `enemy-buff` (reads live
 * `enemyBuffNames` at eval time; 0 at combat start). Multiple → anyOf.
 */
function enemyEffectConditions(names: string[]): Condition[] {
    return names.map((buffName) => {
        const isDebuff = classifyEnemyEffect(buffName) === 'debuff';
        return {
            subject: isDebuff ? 'enemy-debuff' : 'enemy-buff',
            derivable: true,
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
 * Sub-project I, PR I5 — classifies Selenite's "…for every enemy with Stealth" into a
 * COUNT-SCALING condition on the number of DISTINCT stealthed enemy UNITS, distinct from
 * `forEachCondition`'s "for each <buff/debuff> on the enemy" (which counts effects present
 * ON A SINGLE target). `enemyBuffNames` is a deduped union of names across every opposing
 * actor, so it can answer "is at least one enemy Stealthed" but never "how many" — the sim
 * tracks a dedicated live count (`ConditionContext.stealthedEnemyCount`, populated by the
 * combat engine) for this shape instead. Scoped to the literal "for every enem(y|ies) with"
 * phrasing (distinct from "for each", already handled above) and to a single named BUFF
 * effect — only Stealth is engine-tracked this way today; any other named status (or a
 * debuff, or multiple named effects) returns null so the caller falls back to the flat
 * presence-gate modifier rather than silently mis-scaling on an untracked count.
 */
function forEveryEnemyStealthCondition(sentence: string, rawText: string): Condition | null {
    if (!/for every\s+enem(?:y|ies)\s+with\b/i.test(sentence)) return null;
    const names = enemyEffectNamesFromClause(rawText);
    if (names.length !== 1) return null;
    const [buffName] = names;
    if (buffName !== 'Stealth' || classifyEnemyEffect(buffName) !== 'buff') return null;
    return { subject: 'enemy-stealth-count', derivable: true };
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
            // Sub-project I, PR I5: "10% more direct damage for every enemy with Stealth"
            // (Selenite) — a COUNT-SCALING modifier on the number of stealthed enemy UNITS,
            // checked before the flat enemy-effect gate below (which would otherwise treat
            // this as a binary "at least one enemy Stealthed" presence gate).
            const stealthCountCond = forEveryEnemyStealthCondition(sentence, text);
            if (stealthCountCond) {
                out.push({
                    channel: 'outgoingDamage',
                    value: 0,
                    isMultiplicative: true,
                    target,
                    conditions: [stealthCountCond],
                    scaling: {
                        conditionIndex: 0,
                        perUnit: value,
                        ...(capFromSentence(sentence) !== undefined
                            ? { cap: capFromSentence(sentence) }
                            : {}),
                    },
                });
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
                    conditions.push({ subject, buffName: 'Stealth', derivable: true });
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

    // Sub-project I, PR I4a: "N% additional <DoT> damage … for every M% crit power"
    // (Wildfire: "When an enemy has Scorching Radiation, this Unit deals 1% additional
    // Inferno damage to that unit for every 10% crit power") → a dotDamage-channel modifier
    // whose bonus SCALES with the CASTER's own live crit power, gated on the named enemy
    // status via the existing enemyEffectConditions path (Scorching Radiation → name-specific
    // 'enemy-debuff', composing with I1). Narrow shape — requires the literal "additional
    // <word> damage" phrase together with "crit power" in the SAME sentence — this two-conjunct
    // guard is confirmed unique to Wildfire in docs/ship-skills.csv (other ships use "additional"
    // or "for every … crit power" separately — e.g. Bayah/Butcher, Amartya — but none combine
    // "N% additional <word> damage" WITH "for every % crit power"), so no other ship's
    // outgoingDamage/critDamage branches above are affected.
    //
    // I4a SCOPE (see the sub-project I design doc §9): single-target/cast-time only. The
    // enemy-status gate is baked ONCE per cast against the primary target's modifierCtx
    // (existing behavior — this ability folds through the same mod.dotDamage →
    // selfDotDamageModifier path as any other dotDamage modifier) and the resulting bonus
    // applies to ALL of the caster's Inferno/Corrosion ticks this turn.
    //   I4b: per-tick / per-victim(AoE) re-evaluation of the enemy-status gate is NOT done
    //        here — this is the documented cast-time approximation.
    //   I4c: the refit-3 "all allies deal…" team-aura text below ALSO matches this branch
    //        (isAllyScoped → target:'all-allies'), but the dotDamage channel has no
    //        distribution seam yet (I3 only wired outgoingDamage/critDamage) — today it only
    //        self-applies (same as target:'self', via the unconditional self-inclusion of an
    //        actor's own firing/passive abilities). Distributing it to OTHER allies is I4c.
    const dotCritPowerM = plain.match(/(\d+(?:\.\d+)?)%\s+additional\s+([A-Za-z]+)\s+damage\b/i);
    if (dotCritPowerM) {
        const sentence = sentenceContaining(plain, dotCritPowerM.index!);
        const critPowerM = sentence.match(/for\s+every\s+(\d+(?:\.\d+)?)%\s+crit\s+power/i);
        if (critPowerM) {
            const dotValue = parseFloat(dotCritPowerM[1]);
            const per = parseFloat(critPowerM[1]);
            const isAllyScoped = /friendly|all allies|allies/i.test(sentence);
            const statusConditions = enemyEffectConditions(enemyHasNamesFromClause(text));
            const conditions: Condition[] = [
                ...statusConditions,
                // I4b: evaluated once per cast against the primary target — see the scope note
                // above. Bare (no countComparator) → scales only, never gates (gateConditions
                // strips it; a 0-crit-power unit still passes the enemy-status gate, just with
                // a 0 bonus).
                { subject: 'self-crit-power', derivable: true },
            ];
            out.push({
                channel: 'dotDamage',
                value: 0,
                isMultiplicative: false,
                target: isAllyScoped ? 'all-allies' : 'self',
                conditions,
                scaling: { conditionIndex: conditions.length - 1, perUnit: dotValue / per },
            });
        }
    }

    // Wave 8, Task 14: "N% more detonation damage per M% crit power" (Lingshe refit-active:
    // "This Unit deals 1% more detonation damage per 10% crit power it has.") → a
    // detonationDamage-channel modifier scaling with the caster's own live crit power, modelled
    // EXACTLY on the Wildfire dotDamage crit-power modifier above (~563-613). The detonationDamage
    // channel is already fully consumed by the engine (applyAbilities.ts, effectiveStats.ts,
    // detonation.ts/engine.ts) and snapshotted onto each PendingBomb at cast time
    // (playerTurn.ts:822) — same snapshot-at-application approximation as Voidfire's affinity
    // snapshot: Lingshe's bonus applies to her own bombs (applier=detonator) but NOT to foreign
    // bombs she detonates via countdown-reduce.
    const detonationCritPowerM = plain.match(
        /(\d+(?:\.\d+)?)%\s+more\s+detonation\s+damage\s+per\s+(\d+(?:\.\d+)?)%\s+crit\s+power/i
    );
    if (detonationCritPowerM) {
        const detValue = parseFloat(detonationCritPowerM[1]);
        const per = parseFloat(detonationCritPowerM[2]);
        const conditions: Condition[] = [{ subject: 'self-crit-power', derivable: true }];
        out.push({
            channel: 'detonationDamage',
            value: 0,
            isMultiplicative: false,
            target: 'self',
            conditions,
            scaling: { conditionIndex: conditions.length - 1, perUnit: detValue / per },
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
            // Enemy-type gate (Zeolite's "increases damage by 30% when hitting a Defender").
            // Verb set differs from the crit-damage branch's template (adds hitting/attacking)
            // and tolerates an optional article ("hitting a Defender" vs Lodolite's "to defenders").
            const typeM = sentence.match(
                /\b(?:to|against|targeting|damaging|attacking|hitting)\s+(?:an?\s+)?(defender|attacker|debuffer|supporter)s?\b/i
            );
            if (typeM) {
                conditions.push({
                    subject: 'enemy-type',
                    derivable: true,
                    requiredEnemyType: (typeM[1].charAt(0).toUpperCase() +
                        typeM[1].slice(1).toLowerCase()) as EnemyBaseClass,
                });
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

    // "increases its Defense by N%" → a STANDING self defense modifier (Grif refit's "This Unit
    // increases its Defense by 20%"). Multiplicative (a % of base defense), self-scoped. Scoped
    // to "Defense" specifically so it never collides with the "defense penetration" branches
    // below (penetration carries the extra "penetration" word). Phase 4c PR 4 (Task 6).
    const defM = plain.match(/increases?\s+its\s+defense\s+by\s+(\d+(?:\.\d+)?)%/i);
    if (defM) {
        // Sentence-scope the standing modifier (CodeRabbit #99 FIX #2): a triggered ("when X,
        // increases its Defense by 20%") or finite-duration ("increases its Defense by 20% for 2
        // turns") clause with the same wording must NOT be promoted to a PERMANENT buff — that is
        // wrong combat math. Only emit when the containing sentence is a standalone/standing clause
        // (no trigger words, no finite duration). The gated/finite shapes are left for other
        // parsing (reactive buff-grant / timed buff) to handle, or left unparsed.
        const defSentence = sentenceContaining(plain, defM.index!);
        const hasTrigger = /\b(when|if|while|upon|after|each|every)\b|at the start of/i.test(
            defSentence
        );
        const hasFiniteDuration = /\bfor\s+\d+\s+turns?\b/i.test(defSentence);
        if (!hasTrigger && !hasFiniteDuration) {
            out.push({
                channel: 'defense',
                value: parseFloat(defM[1]),
                isMultiplicative: true,
                target: 'self',
                conditions: [],
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
        } else {
            // Epic PR12(B) — Chakara's charged: "…bypassing 20% of the enemy Defense…". Distinct
            // wording from "X% defense penetration" above; same defensePenetration modifier
            // shape. Because parseModifiers runs PER SKILL ROW (abilitiesFromText is called once
            // per Active/Charge/Passive text), this is inherently a PER-SKILL modifier — it only
            // folds into `dmgStats.effectivePen` on the turn THIS skill fires (playerTurn.ts's
            // `selfModifierAbilities = firingSkill.abilities + passiveSkill.abilities`), not a
            // permanent standing pen like the flat-text branch above (which corpus rows only ever
            // carry on a PASSIVE, so the distinction is inert there — passives fire every turn).
            const bypassM = plain.match(
                /bypassing\s+(\d+(?:\.\d+)?)%\s+of\s+the\s+enemy\s+defense/i
            );
            if (bypassM) {
                out.push({
                    channel: 'defensePenetration',
                    value: parseFloat(bypassM[1]),
                    isMultiplicative: false,
                    target: 'self',
                    conditions: [],
                });
            }
        }
    }

    return out;
}

/**
 * D-PR3 T5 — Detects Iridium's "takes N% less damage from Critical hits" clause and
 * returns the reduction percentage, or null when the phrase is absent.
 *
 * The match is intentionally narrow: only the `takes … less damage from Critical hits`
 * construction maps to the crit-family incoming-reduction ability. A generic "less
 * damage" clause (e.g. "takes 20% less damage from all sources") does NOT match and
 * returns null.
 *
 * Masking: `<br />` tags are normalised to `. ` before the regex so they never
 * break sentence detection; `stripTags` removes inline markup tags.
 */
function parseIncomingCritReduction(text: string): number | null {
    const plain = stripTags(text).replace(/<br\s*\/?>/gi, '. ');
    const m = plain.match(/takes\s+(\d+(?:\.\d+)?)%\s+less\s+damage\s+from\s+critical\s+hits/i);
    if (!m) return null;
    return parseFloat(m[1]);
}

/** One parsed incoming-damage-reduction directive (epic PR12(C)). `scopes` lists every
 *  incoming-reduction ability scope this phrasing should emit (most phrasings are
 *  scope:'direct' only; "all incoming damage"/unscoped phrasings emit BOTH 'direct' and
 *  'dot'). `pct` XOR `hpScaling` — never both. */
interface ParsedIncomingDamageReduction {
    scopes: ('direct' | 'dot')[];
    condition: IncomingCondition;
    pct?: number;
    hpScaling?: { perUnit: number; cap: number };
    matchIndex: number;
}

/**
 * Epic PR12(C) — wires four corpus phrasings onto the existing `incoming-reduction`
 * AbilityConfig / IncomingCondition (D-PR3: Iridium/Voidshade/Hyperion Gaze/Ironclad), which
 * previously only covered "takes N% less damage from Critical hits" (parseIncomingCritReduction
 * above):
 *  - Anemone: "takes N% less direct damage from enemies debuffed with a Damage over Time
 *    effect" — the ATTACKER carries a live DoT (new `attacker-has-dot` condition).
 *  - Panon: "reduces all incoming damage by N% when affected by Barrier Recharging" — the
 *    VICTIM carries its own named self-status (new `self-barrier-recharging` condition,
 *    mirroring the self-stealth/self-stasis literal-name precedent). "ALL incoming damage"
 *    (not "direct") → emits both scope:'direct' and scope:'dot'.
 *  - Wusheng: "reduces direct damage by N% while Stealth is active" — reuses the EXISTING
 *    `self-stealth` condition (previously only wired via the Voidshade implant, never a ship
 *    skill-text phrasing).
 *  - Tormenter: "gains up to N% damage reduction as its health decreases" — no status gate at
 *    all, just continuous HP-proportional scaling (new `hpScaling` field, condition 'always').
 *    perUnit = cap/100 so the reduction reaches exactly `cap`% at 0 HP (mirrors the Revenge
 *    gear set's self-hp-missing-pct formula, `hpProportionalScaling` above). No explicit scope
 *    word in the text → both 'direct' and 'dot', same as Panon.
 */
function parseIncomingDamageReductionPhrasings(text: string): ParsedIncomingDamageReduction[] {
    const plain = stripTags(text).replace(/<br\s*\/?>/gi, '. ');
    const out: ParsedIncomingDamageReduction[] = [];

    const anemoneM =
        /takes\s+(\d+(?:\.\d+)?)%\s+less\s+direct\s+damage\s+from\s+enemies\s+debuffed\s+with\s+a\s+damage\s+over\s+time\s+effect/i.exec(
            plain
        );
    if (anemoneM) {
        out.push({
            scopes: ['direct'],
            condition: 'attacker-has-dot',
            pct: parseFloat(anemoneM[1]),
            matchIndex: anemoneM.index,
        });
    }

    const panonM =
        /reduces\s+all\s+incoming\s+damage\s+by\s+(\d+(?:\.\d+)?)%\s+when\s+affected\s+by\s+barrier\s+recharging/i.exec(
            plain
        );
    if (panonM) {
        out.push({
            scopes: ['direct', 'dot'],
            condition: 'self-barrier-recharging',
            pct: parseFloat(panonM[1]),
            matchIndex: panonM.index,
        });
    }

    const wushengM =
        /reduces\s+direct\s+damage\s+by\s+(\d+(?:\.\d+)?)%\s+while\s+stealth\s+is\s+active/i.exec(
            plain
        );
    if (wushengM) {
        out.push({
            scopes: ['direct'],
            condition: 'self-stealth',
            pct: parseFloat(wushengM[1]),
            matchIndex: wushengM.index,
        });
    }

    const tormenterM =
        /gains\s+up\s+to\s+(\d+(?:\.\d+)?)%\s+damage\s+reduction\s+as\s+its\s+health\s+decreases/i.exec(
            plain
        );
    if (tormenterM) {
        const cap = parseFloat(tormenterM[1]);
        out.push({
            scopes: ['direct', 'dot'],
            condition: 'always',
            hpScaling: { perUnit: cap / 100, cap },
            matchIndex: tormenterM.index,
        });
    }

    // Voron: "This Unit takes N% less damage from Damage over Time effects" — a flat
    // reduction against the unit's OWN incoming DoT ticks. scope:'dot' + condition:'always'
    // are both existing type-valid values (Tormenter uses the same pair via hpScaling).
    const voronM =
        /takes\s+(\d+(?:\.\d+)?)%\s+less\s+damage\s+from\s+damage\s+over\s+time\s+effects/i.exec(
            plain
        );
    if (voronM) {
        out.push({
            scopes: ['dot'],
            condition: 'always',
            pct: parseFloat(voronM[1]),
            matchIndex: voronM.index,
        });
    }

    // Malvex: "When Shielded, this Ship takes N% less damage" — a self-shield-gated flat
    // reduction. New self-shielded IncomingCondition (evaluated per-hit against the victim's
    // live shieldPool). Anchored on "when shielded" so it never matches Voron's DoT phrasing
    // or a bare "takes N% less damage".
    const malvexM =
        /when\s+shielded,?\s+this\s+(?:ship|unit)\s+takes\s+(\d+(?:\.\d+)?)%\s+less\s+damage/i.exec(
            plain
        );
    if (malvexM) {
        out.push({
            scopes: ['direct'],
            condition: 'self-shielded',
            pct: parseFloat(malvexM[1]),
            matchIndex: malvexM.index,
        });
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
 * Length-preserving tag mask: every `<unit-…>` / `<br …>` tag becomes an equal run of spaces, so
 * raw-text offsets (every `pos` anchor in this file is a raw-text index) still address the same
 * characters in the masked string. `stripTags` cannot be used for this — it shortens the text and
 * therefore shifts every anchor.
 */
function maskTagsPreservingLength(text: string): string {
    return text.replace(/<[^>]*>/g, (tag) => ' '.repeat(tag.length));
}

/**
 * Marks every ability whose own sentence says its allies are scoped to the caster's targeting
 * pattern — the literal "within the active pattern". See `Ability.patternScoped`: passive-slot
 * support is otherwise NOT narrowed to the firing skill's support footprint, and this is the
 * opt-back-in for the four corpus ships that name the pattern (AEGIS, Cultivator, Graphite).
 *
 * Skips anchorless abilities (`pos === MAX_POS`, or any out-of-range index) rather than letting
 * `sentenceContaining` fall through to the row's LAST sentence and mis-flag them.
 */
const WITHIN_ACTIVE_PATTERN_RE = /within the active pattern/i;
function markPatternScoped(positioned: PositionedAbility[], text: string): PositionedAbility[] {
    if (!WITHIN_ACTIVE_PATTERN_RE.test(text)) return positioned;
    const masked = maskTagsPreservingLength(text);
    for (const p of positioned) {
        if (p.pos < 0 || p.pos >= masked.length) continue;
        if (WITHIN_ACTIVE_PATTERN_RE.test(sentenceContaining(masked, p.pos))) {
            p.ability.patternScoped = true;
        }
    }
    return positioned;
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
 * Damage-rider repairs (skill has a damage component → it targets an enemy, the
 * repair is a self rider), passive repairs, and explicit recipients are unaffected.
 *
 * Shields use {@link flipBareSupportShieldTarget} instead — a bare shield co-cast beside an
 * all-allies buff grant routes to `all-allies` (Graphite's Overclock + shield); standalone
 * self shields stay on the caster.
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
 */
function flipBareSupportTarget(
    target: 'self' | 'ally' | 'all-allies',
    explicitTarget: boolean,
    slot: SkillSlot,
    hasDamage: boolean,
    healSentence?: string,
    role?: ShipTypeName,
    // The recipient scope for a BARE active/charged pure-support cast (no named recipient).
    // Heals pass 'all-allies' — a support healer heals EVERYONE in its pattern footprint (AoE,
    // "just like buffs"; the engine intersects all-allies with the support pattern). Cleanses
    // (and the default) keep 'ally' — single-recipient, unchanged. An EXPLICIT recipient
    // ("the ally with the most missing health" → Volk) sets explicitTarget and never reaches
    // this branch, so it stays a single 'ally'.
    bareActiveScope: 'ally' | 'all-allies' = 'ally'
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
        return bareActiveScope;
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

/** Bare shield on a pure-support active/charged co-cast beside an all-allies buff grant routes
 *  to all allies (Graphite: Overclock + shield). Standalone self shields ("gains a shield…")
 *  stay self. Explicit recipients and damage-rider skills are unchanged. */
function flipBareSupportShieldTarget(
    target: 'self' | 'ally' | 'all-allies',
    explicitTarget: boolean,
    slot: SkillSlot,
    hasDamage: boolean,
    hasCoCastAllAlliesGrant: boolean
): 'self' | 'ally' | 'all-allies' {
    if (
        hasCoCastAllAlliesGrant &&
        !explicitTarget &&
        target === 'self' &&
        (slot === 'active' || slot === 'charged') &&
        !hasDamage
    ) {
        return 'all-allies';
    }
    return target;
}

function abilitiesFromText(
    text: string,
    slot: SkillSlot,
    role?: ShipTypeName,
    // I6: true when ANY of this ship's skill rows carries the "when this Unit Purges a buff
    // from an enemy, it removes 100% of the enemy's shield" clause (Lodolite legendary refit).
    // Computed ONCE by the caller (buildShipAbilities, which alone sees all rows via
    // getShipSkillRows) and threaded down so every 'purge'-type config built here — regardless
    // of WHICH slot's text produced it — carries the flag. Absent/false → byte-identical.
    purgeStripsShield?: boolean
): PositionedAbility[] {
    // Build the list in construction order first (so out[0]?.type === 'damage' checks work
    // for condition/scaling attachment). Positions are computed in parallel and applied
    // at the END via a single stable sort — so construction order never leaks into the result.
    const out: PositionedAbility[] = [];

    const mult = parseSkillDamage(text);
    // SP-F F1 — Panon's self-scoped "instead" replacement branch (active 80%/70% → 120%/90%,
    // charged 140%/100% → 170%/130% when Provoked/Taunted). Null for every other ship's text.
    const instead = parseInsteadDamageReplacement(text);
    // Anchor at the tag carrying THIS multiplier — the first <unit-damage> tag in the
    // row may be something else entirely (e.g. "20% defense penetration" before the
    // damage), which would wrongly sort the damage ahead of a dot the text puts first.
    const escNum = (n: number) => String(n).replace('.', '\\.');
    const damageTagPos = text.search(
        new RegExp(`<unit-damage>\\s*${escNum(mult)}%\\s*damage`, 'i')
    );
    const damagePos = damageTagPos >= 0 ? damageTagPos : text.search(/<unit-damage>/i);
    // Combat G PR1: on a PASSIVE, the "When this Unit is directly damaged as a primary target,
    // it deals X% damage to that enemy" shape (Stalwart) is a reactive COUNTERATTACK, not an
    // on-cast base damage. Re-type that component to a `counter` ability (on-attacked,
    // requirePrimaryTarget) when the parsed counter multiplier matches the base damage the tag
    // carries. Heal/shield/reflect "directly damaged" consequences are not matched by
    // parseCounterAbilities, so they keep their existing parse. PR2: Nyxen's shield-hit shape
    // also rides this path (requireShieldHit). Centurion (adjacent-ally) does NOT ride this path
    // (its retaliate tag carries no "damage" word → mult is 0) — it is pushed separately below.
    const counter = slot === 'passive' ? parseCounterAbilities(text) : null;
    if (mult > 0 && counter && counter.multiplier === mult) {
        const hits = parseHitCount(text);
        out.push({
            ability: {
                id: nextId(),
                type: 'counter',
                target: 'enemy',
                trigger: 'on-attacked',
                conditions: [],
                config: {
                    type: 'counter',
                    multiplier: mult,
                    ...(hits !== undefined ? { hits } : {}),
                    ...(counter.requirePrimaryTarget ? { requirePrimaryTarget: true } : {}),
                    ...(counter.requireShieldHit ? { requireShieldHit: true } : {}),
                },
                autoFilled: true,
            },
            pos: damagePos >= 0 ? damagePos : MAX_POS,
        });
    } else if (mult > 0) {
        const hits = parseHitCount(text);
        const noCrit = parseNoCrit(text);
        // Ship-kit W5 (Demolisher bomb-splash): "This damage ignores Defense" — bypasses the
        // target's Defense mitigation term at the reactive damage executor (Task C3).
        const ignoresDefense = parseIgnoresDefense(text);
        // Ship-kit W6 (Lodolite/Rhodium/Selenite): "This attack can target Stealthed enemies".
        const ignoresStealth = parseIgnoresStealth(text);
        // SP-F F4 (Wusheng): "deals 220% damage with affinity advantage" forces this on-cast hit
        // (and its paired Stasis 'apply' landing) to affinity advantage at the engine seams.
        const forceAffinityAdvantage = parseForceAffinityAdvantage(text);
        // Epic PR4 (round-boundary trigger consistency): a base damage ability whose OWN
        // sentence carries "at the start of the round" (Judge, Chakara's "Then," continuation)
        // or "at the end of the round" (Incinerator, Rhodium p2's co-located 80%-no-crit hit)
        // rides that LIVE trigger instead of the on-cast default — the reactive damage executor
        // (triggers.ts cfg.type==='damage' branch) and, for start-of-round specifically, the
        // partition machinery removing it from the old passive-payload-hit cast-time fold
        // (playerTurn.ts) both already exist; this ability just needs the correct label.
        // #2 (Sentinel): a passive damage clause anchored in a "when an ally critically hits an
        // enemy … deals X% damage to that enemy" sentence rides the on-ally-crit reactive trigger
        // (the crit-victim enemy is routed via eventCtx.counterTargetId — triggers.ts on-ally-crit
        // listener). Position-scoped like the round-boundary detectors above, so a co-located
        // on-cast hit in another sentence is never co-triggered. Corpus: Sentinel alone carries an
        // ally-crit DAMAGE clause (Hermes = charge, Howler = cleanse — both already wired).
        const damageTrigger: AbilityTrigger =
            detectStartOfRoundTrigger(text, damagePos) ??
            detectEndOfRoundDamageTrigger(text, damagePos) ??
            detectRoundStartContinuationTrigger(text, damagePos) ??
            detectAllyCritTrigger(text, damagePos) ??
            detectBombDetonatedTrigger(text, damagePos) ??
            'on-cast';
        // SP-F F1: emit the BASE branch FIRST (out[0]) so the ungated `.find`-first reads of
        // noCrit/hits below resolve sensibly, and so it stays out[0] for the conditional-scaling
        // attach points further down this function.
        out.push({
            ability: {
                id: nextId(),
                type: 'damage',
                target: 'enemy',
                trigger: damageTrigger,
                conditions: instead ? tauntProvokeAbsentConditions() : [],
                config: {
                    type: 'damage',
                    multiplier: mult,
                    ...(hits !== undefined ? { hits } : {}),
                    ...(noCrit ? { noCrit: true } : {}),
                    ...(forceAffinityAdvantage ? { forceAffinityAdvantage: true } : {}),
                    ...(ignoresDefense ? { ignoresDefense: true } : {}),
                    ...(ignoresStealth ? { ignoresStealth: true } : {}),
                },
                autoFilled: true,
            },
            pos: damagePos >= 0 ? damagePos : MAX_POS,
        });
        // SP-M M1 (Task 5): a round-boundary (end-of-round) damage clause co-located in the SAME
        // sentence as an "enemy with the most buffs" phrase (Rhodium p2: "...purges 2 buffs from
        // the enemy with the most buffs and deals 80% damage...") re-targets from the default
        // 'enemy' to 'enemy-most-buffs' — reuses the SAME detector (detectMostBuffsTarget) the
        // co-located purge below uses, sentence/position-scoped on damagePos so an unrelated
        // on-cast damage clause elsewhere in the text (or a start-of-round damage clause, which
        // never carries this phrase in the corpus) is unaffected. out[0] is safe to mutate here —
        // this is the ability just pushed (SP-F F1's out[0] invariant, see comment above).
        if (damageTrigger === 'end-of-round' && detectMostBuffsTarget(text, damagePos)) {
            out[0].ability.target = 'enemy-most-buffs';
        }
        // SP-M M1 (Task 6): a round-boundary (start-of-round, INCLUDING the "Then," continuation
        // sentence — Chakara p4: "starts each round with Attack Up II/Defense Up II … if it has
        // the lowest speed among all Allies. Then, deals 60% damage to the highest Speed Enemy.")
        // damage clause carrying "to the highest Speed Enemy" re-targets from the default 'enemy'
        // to 'enemy-highest-speed'. Sentence/position-scoped on damagePos (parseHighestSpeedEnemyTarget
        // mirrors detectMostBuffsTarget's scoping), so an unrelated damage clause elsewhere in the
        // text is unaffected. out[0] is safe to mutate here (SP-F F1's out[0] invariant).
        if (damageTrigger === 'start-of-round' && parseHighestSpeedEnemyTarget(text, damagePos)) {
            out[0].ability.target = 'enemy-highest-speed';
        }
        // Ship-kit W5 (Demolisher bomb-splash): the reactive bomb-detonated damage clause
        // ("... deals 100% of the Bomb's damage to all adjavent enemies") re-targets from the
        // default 'enemy' to the adjacency scope. GATED on damageTrigger === 'on-bomb-detonated'
        // (same pattern as the end-of-round/start-of-round retargets above) rather than a bare
        // sentence-position check: an on-cast damage clause can share its SENTENCE with an
        // unrelated debuff/control clause that owns its own adjacency phrase (Asphyxiator's
        // "...deals 175% damage, then inflicts Inferno III... on the targeted enemy and all
        // enemies adjacent to it" — the adjacency belongs to Inferno III, not the 175% hit;
        // Vindicator's "...deals 100% damage and applies Provoke... to all enemies adjacent to
        // the target" — the adjacency belongs to Provoke, not the 100% hit). Both are corpus
        // regressions caught by the Task C1 corpus-regression check and fixed by this gate,
        // which restricts the position-scoped adjacency read to the one trigger only Demolisher's
        // passive carries.
        if (damageTrigger === 'on-bomb-detonated') {
            const adjacentDamageScope = adjacentEnemyScopeAtPos(text, damagePos);
            if (adjacentDamageScope) {
                out[0].ability.target = adjacentDamageScope;
            }
        }
        if (instead) {
            // Replacement branch (Provoked/Taunted): reuses the base's hits/noCrit — both
            // Panon branches share the same values (neither text carries a multi-hit or
            // no-crit phrase), matching the existing anyOf Taunt/Provoke shape the self-target
            // Terran Guard III/Barrier grant already uses.
            const replPos = text.search(
                new RegExp(`<unit-damage>\\s*${escNum(instead.mult)}%\\s*damage`, 'i')
            );
            out.push({
                ability: {
                    id: nextId(),
                    type: 'damage',
                    target: 'enemy',
                    trigger: damageTrigger,
                    conditions: [
                        statusEffectCondition('Taunt', true),
                        statusEffectCondition('Provoke', true),
                    ],
                    config: {
                        type: 'damage',
                        multiplier: instead.mult,
                        ...(hits !== undefined ? { hits } : {}),
                        ...(noCrit ? { noCrit: true } : {}),
                    },
                    autoFilled: true,
                },
                pos: replPos >= 0 ? replPos : MAX_POS,
            });
        }
    }

    // Combat G PR2 (Centurion): "When this Unit OR AN ADJACENT ALLY is directly damaged, this
    // Unit retaliates dealing X%." The retaliate <unit-damage> tag omits "damage" → parseSkillDamage
    // returns 0 → NOT an on-cast base-damage component, so it cannot ride the re-type path above.
    // Push it directly as TWO counter abilities: a self counter (on-attacked, any direct hit) +
    // an adjacent-ally counter (on-ally-attacked, reusing the existing requireDamagedAllyAdjacent
    // gate). The per-ability guard collapses the per-HIT fan-out within one sub-attack; since the
    // multi-hit epic's PR6 it does NOT collapse across sub-attacks, so a `hits: N` cast draws N
    // retaliations — correct, since R1 makes that N separate attacks. Self/ally were also
    // mutually exclusive per attack back when the `attacked` emit was single-focus. Per-victim
    // `attacked` emission HAS since landed, so an AoE covering both this unit and an adjacent ally
    // wakes both abilities in one sub-attack — one incoming attack, two retaliations. Both now
    // carry the SAME `counterGroupId` so the executor guard collapses them back into one. Keying
    // the guard on `${ownerId}` instead would have worked here but would also collapse two
    // genuinely independent counters on some future ship; the group id says exactly what is true,
    // that these two abilities are one clause. This is a multi-VICTIM defect, not a multi-HIT one
    // (it reproduces at `hits: 1`), which is why PR6 neither caused nor fixed it. The co-located
    // "start of combat … attack per adjacent ally" buff parses independently and is unaffected.
    if (slot === 'passive' && counter && counter.allySubject) {
        const hits = parseHitCount(text);
        // The self ability's own id doubles as the group id — stable, unique, and no extra id
        // burned out of the shared sequence.
        const selfCounterId = nextId();
        const counterConfig = {
            type: 'counter' as const,
            multiplier: counter.multiplier,
            ...(hits !== undefined ? { hits } : {}),
            counterGroupId: selfCounterId,
        };
        const pos = damagePos >= 0 ? damagePos : MAX_POS;
        out.push({
            ability: {
                id: selfCounterId,
                type: 'counter',
                target: 'enemy',
                trigger: 'on-attacked',
                conditions: [],
                config: counterConfig,
                autoFilled: true,
            },
            pos,
        });
        out.push({
            ability: {
                id: nextId(),
                type: 'counter',
                target: 'enemy',
                trigger: 'on-ally-attacked',
                conditions: [],
                config: counterConfig,
                requireDamagedAllyAdjacent: true,
                autoFilled: true,
            },
            pos,
        });
    }

    // Epic PR12(A) — Nosorog: "reflects X% of the Damage taken back to the enemy [when
    // directly damaged as a primary target]." Self-scoped victim passive (mirrors the Reflect
    // gear set's damage-reflection shape — top-level type:'modifier' is a placeholder, the
    // engine keys on config.type:'damage-reflection', see buildEquipmentAbilities.ts REFLECT).
    // The reflect verb carries no "damage" word inside a <unit-damage> tag, so it never
    // collides with the base-damage `mult` parse above and is pushed independently, same
    // pattern as Centurion's allySubject counter.
    if (slot === 'passive') {
        const reflect = parseDamageReflection(text);
        if (reflect) {
            const reflectPos = text.search(/reflects/i);
            out.push({
                ability: {
                    id: nextId(),
                    type: 'modifier',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'damage-reflection',
                        pct: reflect.pct,
                        ...(reflect.requirePrimaryTarget ? { requirePrimaryTarget: true } : {}),
                    },
                    autoFilled: true,
                },
                pos: reflectPos >= 0 ? reflectPos : MAX_POS,
            });
        }
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
        // SP-F F1: base branch — emitted FIRST, same ordering rationale as the damage ability
        // above. Folds the negated Taunt/Provoke-absent gate in alongside any existing SP-C
        // owner-vs-target condition (Panon's own text never combines both).
        out.push({
            ability: {
                id: nextId(),
                type: 'additional-damage',
                target: 'enemy',
                trigger: 'on-cast',
                // SP-C: Cobalt's "If this Unit has more HP than the enemy, it additionally
                // deals …" owner-vs-target gate, detected clause-scoped by parseSecondaryDamage
                // (sec.condition). Unconditional riders (the common case) get [].
                conditions: [
                    ...(sec.condition ? [sec.condition] : []),
                    ...(instead ? tauntProvokeAbsentConditions() : []),
                ],
                config: { type: 'additional-damage', stat: sec.stat, pct: sec.pct },
                autoFilled: true,
            },
            pos: secondIdx >= 0 ? secondIdx : firstIdx >= 0 ? firstIdx : MAX_POS,
        });
        if (instead?.secondary) {
            const replSec = instead.secondary;
            const replSecTagIdx = text.search(
                new RegExp(`<unit-damage>(?:damage equal to\\s*)?${escNum(replSec.pct)}%`, 'i')
            );
            out.push({
                ability: {
                    id: nextId(),
                    type: 'additional-damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [
                        statusEffectCondition('Taunt', true),
                        statusEffectCondition('Provoke', true),
                    ],
                    config: { type: 'additional-damage', stat: replSec.stat, pct: replSec.pct },
                    autoFilled: true,
                },
                pos: replSecTagIdx >= 0 ? replSecTagIdx : MAX_POS,
            });
        }
    }

    // Vindicator p2: "When this Unit resists a debuff infliction from an enemy, it deals damage
    // equal to X% of this Unit's max HP to that enemy." A standalone HP-scaled REACTIVE damage
    // proc on the on-debuff-resisted trigger (passive slot only). multiplier:0 — the amount is
    // carried by hpBasisPct, read by the reactive-damage executor. Routes to the resisted debuff's
    // inflictor via eventCtx.counterTargetId (set by the on-debuff-resisted listener).
    if (slot === 'passive') {
        const onResist = parseOnResistHpDamage(text);
        if (onResist) {
            const onResistIdx = text.search(/<unit-damage>/i);
            out.push({
                ability: {
                    id: nextId(),
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-debuff-resisted',
                    conditions: [],
                    config: {
                        type: 'damage',
                        multiplier: 0,
                        hits: 1,
                        hpBasisPct: onResist.pct,
                    },
                    autoFilled: true,
                },
                pos: onResistIdx >= 0 ? onResistIdx : MAX_POS,
            });
        }

        // Paracelsus p2: "Upon being killed by direct Damage, this Unit deals Damage equal to
        // N% of its max HP." on-destroyed HP-scaled retaliation — composes the existing
        // on-destroyed trigger with hpBasisPct (multiplier:0), same executor shape as Vindicator.
        const onKilled = parseKilledByDirectHpDamage(text);
        if (onKilled) {
            const onKilledIdx = text.search(/<unit-damage>/i);
            out.push({
                ability: {
                    id: nextId(),
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-destroyed',
                    conditions: [],
                    config: {
                        type: 'damage',
                        multiplier: 0,
                        hits: 1,
                        hpBasisPct: onKilled.pct,
                    },
                    autoFilled: true,
                },
                pos: onKilledIdx >= 0 ? onKilledIdx : MAX_POS,
            });
        }

        // Xcellence p2: "When an enemy resists a debuff infliction, this Unit deals damage
        // equal to X% of this Unit's current shield." Ship-kit W8 — an INFLICTOR-scoped
        // sibling of the Vindicator proc above: THIS unit inflicted the debuff and the ENEMY
        // resisted it, so it routes on the on-own-debuff-resisted trigger (not
        // on-debuff-resisted) — that trigger stamps counterTargetId = the resister, exactly
        // the enemy this reaction should retaliate against. multiplier:0 — the amount rides
        // shieldBasisPct (owner's current shield), read by the same reactive-damage executor
        // that already reads hpBasisPct.
        const onResistShield = parseOnResistShieldDamage(text);
        if (onResistShield) {
            const onResistShieldIdx = text.search(/<unit-damage>/i);
            out.push({
                ability: {
                    id: nextId(),
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-own-debuff-resisted',
                    conditions: [],
                    config: {
                        type: 'damage',
                        multiplier: 0,
                        hits: 1,
                        shieldBasisPct: onResistShield.pct,
                    },
                    autoFilled: true,
                },
                pos: onResistShieldIdx >= 0 ? onResistShieldIdx : MAX_POS,
            });
        }
    }

    // PR9(b): standalone "removes X% of the enemy Shield" (APEX/Laika/Malvex) — coordinate
    // with this same row's own damage, NOT gated on a purge landing (that's the I6
    // `stripsShield` purge-config flag below, which parseShieldStrip's sentence-scoped purge
    // guard deliberately excludes — see its doc comment).
    const strip = parseShieldStrip(text);
    if (strip) {
        const stripPos = text.search(/removes/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'shield-strip',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'shield-strip', pct: strip.pct },
                autoFilled: true,
            },
            pos: stripPos >= 0 ? stripPos : MAX_POS,
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

    // Conditional damage BONUS gated on the ENEMY carrying an effect: Rikra "additional 60%
    // damage against Taunted or Provoked enemies", Wrecker "if affected by Inferno, additional
    // 50%". enemyEffectConditions classifies each name into an enemy-buff/enemy-debuff condition
    // (anyOf when >1); scaledBonus/gateConditions treat the group as one bare scaling source, so
    // the base damage always fires and the bonus adds only when the enemy has the effect(s).
    // Binary → cap at perUnit so multiple stacks can't inflate the one-time bonus. Only when no
    // scaling was attached above (parseConditionalDamage takes precedence).
    // ADJACENCY ASSUMPTION: no corpus ship pairs this enemy-effect bonus with a LATER same-ability
    // multi-name enemy gate (the `damageEnemyEffectNamesFromClause` block below). If one ever did,
    // anyOfGroupIndices would merge the two adjacent anyOf runs into one — folding that later gate's
    // count into this bonus's scaling. Non-constructible today; revisit if such a ship appears.
    if (out[0]?.ability.type === 'damage' && !out[0].ability.scaling) {
        const enemyBonus = parseEnemyEffectDamageBonus(text);
        if (enemyBonus) {
            const startIdx = out[0].ability.conditions.length;
            out[0].ability.conditions = [
                ...out[0].ability.conditions,
                ...enemyEffectConditions(enemyBonus.effectNames),
            ];
            out[0].ability.scaling = {
                conditionIndex: startIdx,
                perUnit: enemyBonus.pct,
                cap: enemyBonus.pct,
            };
        }
    }

    // SP-D (Task 4/PR-D3): "deals X% damage for every N stacks of damage over time inflicted
    // on[to] a single enemy" (Snakeroot p1/p2) — an OPEN-ENDED per-DoT-entry SCALING multiplier.
    // Unlike the enemy-effect BONUS above (a flat, capped add-on to a standing base), the WHOLE
    // X% here IS the per-N-entries rate, so the base multiplier this row's <unit-damage> tag
    // parsed into `mult` must be zeroed and replaced entirely by the scaling bonus (0 tracked
    // DoT entries → 0% damage). Attaches a bare `enemy-dot-count` condition (Task 3) as the
    // scaling source — bare so `evaluateCondition` returns the raw entry count, not a
    // threshold-gated 0/1 (see docs/model-completeness-triage… SP-D). Only when no scaling was
    // attached above (mirrors the other conditional-scaling attach points' precedence).
    if (
        out[0]?.ability.type === 'damage' &&
        out[0].ability.config.type === 'damage' &&
        !out[0].ability.scaling
    ) {
        const dotScaling = parseDotEntryDamageScaling(text);
        if (dotScaling) {
            const idx = out[0].ability.conditions.length;
            out[0].ability.conditions = [
                ...out[0].ability.conditions,
                { subject: 'enemy-dot-count', derivable: true },
            ];
            out[0].ability.config.multiplier = 0;
            out[0].ability.scaling = { conditionIndex: idx, perUnit: dotScaling.perUnit };
        }
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

    // SP-M M1 (Task 7): a round-boundary (start-of-round OR end-of-round) reactive DAMAGE ability
    // that now carries a PER-VICTIM enemy condition — Judge's start-of-round hp-threshold ("to all
    // enemies with less than 50% HP") or Incinerator's end-of-round enemy-debuff ("to all enemies
    // with Inferno") — hits ALL matching enemies, not one. Re-target from the default 'enemy' to
    // 'all-enemies'; the reactive damage executor (triggers.ts) then enumerates the living opposing
    // roster and re-checks the per-victim condition against each victim's own live HP%/debuff names.
    // DISJOINT from the on-cast enemy-effect damage BONUS (Rikra/Wrecker) — those ride the on-cast
    // trigger, not a round boundary — and from Rhodium/Chakara's selector re-targets above (which
    // carry no hp-threshold/enemy-debuff condition). Gated on the round-boundary trigger so an
    // on-cast damage-bonus gate with the same subject is never re-targeted. out[0] is safe to mutate
    // here (SP-F F1's out[0] invariant).
    // Task 7b review: hp-threshold must be narrowed to non-SELF (Judge's is hpSubject:'enemy' —
    // confirmed via hpThresholdFromSentence, which only sets 'self' absent an enemy/target
    // reference in the clause). A hypothetical round-boundary damage ability gated on the
    // caster's OWN hp ("when this unit is below 50%, deal to all enemies") is a self-condition,
    // not a per-victim one, and must NOT be re-targeted to 'all-enemies' + per-victim re-check.
    if (
        out[0]?.ability.type === 'damage' &&
        (out[0].ability.trigger === 'start-of-round' ||
            out[0].ability.trigger === 'end-of-round') &&
        out[0].ability.conditions.some(
            (c) =>
                (c.subject === 'hp-threshold' && c.hpSubject !== 'self') ||
                c.subject === 'enemy-debuff'
        )
    ) {
        out[0].ability.target = 'all-enemies';
    }

    // Phase 4c PR 4 (Task 6): Grif's NAMELESS damage proc — "When an enemy cleanses a Debuff,
    // this Unit deals 75% Damage that cannot critically hit" — rides the LIVE on-enemy-cleansed
    // trigger. Sentence-scoped at the damage anchor (`damagePos`), so Grif's standing "increases
    // its Defense by 20%." in a DIFFERENT leading sentence never co-triggers the proc. noCrit is
    // already attached above (parseNoCrit). The buff/debuff-grant cleanse cases (Arum/Yarrow/
    // Larkspur) are handled by detectReactiveTrigger in the buff-merge path (they have a buffName).
    if (out[0]?.ability.type === 'damage') {
        const cleanseTrigger = detectEnemyCleanseTrigger(text, damagePos);
        if (cleanseTrigger) out[0].ability.trigger = cleanseTrigger;
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

    // Ship-kit Wave 4, Task 5: generic buff/debuff DURATION EXTENSION — the inverse of the
    // debuff-duration-reduction mechanic above, riding the NEW extend-status ability type
    // (Task 4's StatusEngine primitives; executors are Task 6). Distinct from extend-dot
    // above (a different store — DoT tick stacks, not the StatusEngine buff/debuff maps).
    // Three corpus shapes, all sentence-scoped off the "extend"/"extended" match:
    //  - Sokol (charged): "extends active Debuffs by 1 turn" — no "all allies"/"all enemies"
    //    subject in the clause → default target 'enemy' (the primary/hit enemy, mirroring
    //    extend-dot's own 'enemy' default).
    //  - Ripper (passive R2): "All allies extend their active Buffs by 1 turn" — the "All
    //    allies" subject (checked in the PREFIX before the extend verb, so it can never
    //    false-match a later "all allies" clause in the same sentence — see Lev) → target
    //    'all-allies'. This is an ADDITIONAL ability alongside the co-located Marauder Rage
    //    II self-buff parsed elsewhere in this function — this block never touches out[0]/
    //    mutates any existing entry, so that self-buff keeps parsing unchanged.
    //  - Lev (charged): "If a critical hit occurs, all hit enemies have their debuffs
    //    extended by 1 turn and all allies are granted Crit Power Up II for 2 turns." — the
    //    "all hit enemies" subject precedes "extended" → target 'all-enemies'; the LATER
    //    "all allies are granted…" clause (a different, unrelated buff-grant subject) is
    //    excluded from the subject check by construction (prefix-only), so it can never
    //    flip Lev's target to 'all-allies'.
    //
    // Lev on-crit shape — THIS TASK'S JUDGMENT CALL (see task-5-report.md for the full
    // writeup): kept on trigger:'on-cast' with a live-derivable `self-crit` CONDITION
    // (abilityStatusGating.ts LIVE_SUBJECTS), gated the SAME way parseCritPowerExtend's
    // Valerian condition is above (conditions:[{subject:'self-crit', derivable:true}]) —
    // NOT the reactive 'on-crit' AbilityTrigger. Rationale: 'on-crit' carries no AoE fan-out
    // plumbing — reactiveRecipients has no 'all-enemies' branch, and the reactive on-crit listener
    // stamps no hit-enemy ids in eventCtx. (Measured 2026-08-08: the corpus has FOUR on-crit
    // abilities — Enforcer's Defense Shred, Lionheart's two Attack Up grants and Wusheng's Stealth —
    // plus Bloodthirst from equipment. An earlier version of this comment claimed Bloodthirst was
    // the only one; it was wrong.) Staying on-cast instead reuses the SAME aoeVictimIds fan-out
    // the on-cast purge/steal blocks already use for "all hit enemies" semantics (this cast's
    // actual hit set), which is the literal wording of Lev's clause — reusing existing on-cast
    // plumbing rather than adding new reactive machinery. Task 6's executor MUST honor this shape
    // (on-cast + condition).
    const extendStatus = parseExtendStatus(text);
    if (extendStatus) {
        const plainForExtend = stripTags(text);
        const extendVerbMatch = /\bextend(?:s|ed)?\b/i.exec(plainForExtend);
        const extendStatusIdx = extendVerbMatch ? extendVerbMatch.index : -1;
        const extendSentence =
            extendStatusIdx >= 0 ? sentenceContaining(plainForExtend, extendStatusIdx) : '';
        const localVerbIdx = extendSentence.search(/\bextend(?:s|ed)?\b/i);
        const extendSubjectPrefix =
            localVerbIdx >= 0 ? extendSentence.slice(0, localVerbIdx) : extendSentence;
        const extendTarget: AbilityTarget = /\ball\s+allies\b/i.test(extendSubjectPrefix)
            ? 'all-allies'
            : /\ball\s+(?:hit\s+)?enemies\b/i.test(extendSubjectPrefix)
              ? 'all-enemies'
              : 'enemy';
        const extendCritGated = /\bcritical\s+hit\s+occurs\b/i.test(extendSentence);
        const extendStatusPos = text.search(/extend/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'extend-status',
                target: extendTarget,
                trigger: 'on-cast',
                conditions: extendCritGated ? [{ subject: 'self-crit', derivable: true }] : [],
                config: {
                    type: 'extend-status',
                    statusKind: extendStatus.statusKind,
                    turns: extendStatus.turns,
                },
                autoFilled: true,
            },
            pos: extendStatusPos >= 0 ? extendStatusPos : MAX_POS,
        });
    }

    // SP-F F3 (Lingshe charged skill): "reduces all Bombs on the enemy targets by N turn(s),
    // Bombs reduced to 0 turns by this skill will detonate. This reduction effect requires
    // hacking." Builds a dedicated all-enemies ability; the hacking gate + forced-detonate-at-
    // zero rider are fixed runtime behavior (playerTurn.ts's reduceEnemyBombs), not parsed here.
    // Kept structurally separate from the "inflicts Bomb III" DoT-apply below (a different
    // sentence, unaffected).
    const bombCountdownReduceTurns = parseBombCountdownReduce(text);
    if (bombCountdownReduceTurns) {
        const bombReducePos = text.search(/reduces?\s+all\s+bombs/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'bomb-countdown-reduce',
                target: 'all-enemies',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'bomb-countdown-reduce', turns: bombCountdownReduceTurns },
                autoFilled: true,
            },
            pos: bombReducePos >= 0 ? bombReducePos : MAX_POS,
        });
    }

    // Crit-power-chance extension (Valerian self-crit; Belladonna ally-inflicts → team).
    // SP-E, Task E4: a row that ALSO carries a "convert the Corrosion into <family>" clause
    // (Belladonna) folds this SAME crit-power extension into the convert-dot ability's
    // extendTurns/extendChanceFromCritPower (see mergeBuff below) — emitting the standalone
    // extend-dot here too would double-apply the extension on every successful conversion.
    const critExtend = detectConvertDot(text) ? null : parseCritPowerExtend(text);
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
            const allyCritDotPos = findBuffNamePos(text, eff.buffName);
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

    // Ship-kit W8 Task 10 (Wisteria): self-subject sibling of the Crocus on-ally-crit-dot block
    // above — "This Unit ... after applying <DoT> with a Critical hit, inflicts <DoT> for N
    // turns" (R0) / "inflicts <DoT> for N turns after applying <DoT> with a Critical hit ..."
    // (R2, refit-active). Deliberately NOT reusing the parseSkillEffects tag walk the
    // on-ally-crit-dot block uses above: Wisteria's own TRIGGER clause names a DoT ("applying
    // Corrosion with a Critical hit"), and DOT_TIER_MAP carries a bare 'Corrosion' entry — that
    // walk would mint a phantom Corrosion dot from the trigger's own named DoT (see
    // parseSelfCritDotEffect's comment; buildShipAbilities.test.ts's "no phantom Corrosion dot"
    // guard covers exactly this). parseSelfCritDotEffect instead anchors on the "inflicts X for
    // N turns" clause specifically, in EITHER ordering, so only the genuinely injected DoT
    // (Inferno II) is ever extracted, landing on the SAME reactive on-self-crit-dot trigger
    // machinery (see triggers.ts/types/abilities.ts).
    const selfCritDotEffect = parseSelfCritDotEffect(text);
    if (selfCritDotEffect) {
        const info = DOT_TIER_MAP[selfCritDotEffect.buffName];
        if (info) {
            const selfCritDotPos = findBuffNamePos(text, selfCritDotEffect.buffName);
            const selfCritDotTrigger = detectSelfCritDotTrigger(
                text,
                selfCritDotPos >= 0 ? selfCritDotPos : 0
            );
            if (selfCritDotTrigger) {
                out.push({
                    ability: {
                        id: nextId(),
                        type: 'dot',
                        target: 'enemy',
                        trigger: selfCritDotTrigger, // 'on-self-crit-dot'
                        conditions: [],
                        config: {
                            type: 'dot',
                            dotType: info.type,
                            tier: info.tier,
                            stacks: 1,
                            duration: selfCritDotEffect.turns,
                        },
                        autoFilled: true,
                    },
                    pos: selfCritDotPos >= 0 ? selfCritDotPos : MAX_POS,
                });
            }
        }
    }

    // Ship-kit W3 (Pestilence): "When an enemy cleanses a Debuff this unit inflicts Corrosion II
    // for 2 turns on all cleansed enemies" — a reactive PASSIVE-slot DoT. No existing path can
    // produce this: buildDoTAutoFill scans ONLY active/charge sources (passive-slot DoTs are
    // categorically excluded) and dotAbility() hardcodes trigger:'on-cast'. Build it directly here,
    // mirroring the Crocus on-ally-crit-dot block above but gated on — and taking its trigger from —
    // detectEnemyCleanseTrigger, which sentence-scopes the DoT's anchor to the "when an enemy
    // cleanses a Debuff" clause (shares ENEMY_CLEANSE_RE with the named-buff grant path). A normal
    // active/charge DoT never matches (no cleanse clause) → the buildDoTAutoFill path stays the sole
    // producer for those; the named-buff cleanse grants (Arum/Yarrow/Larkspur) carry no DoT name
    // (DOT_TIER_MAP miss) so they never reach here either. target:'all-enemies' marks the
    // multi-recipient fan-out — the reactive dot executor lands it on eventCtx.cleansedEnemyIds
    // (the actual cleansed enemies), never the DPS dummy sink.
    for (const eff of parseSkillEffects(text, 'active')) {
        const dotInfo = DOT_TIER_MAP[eff.buffName];
        if (!dotInfo) continue;
        const dotPos = findBuffNamePos(text, eff.buffName);
        const cleanseDotTrigger = detectEnemyCleanseTrigger(text, dotPos >= 0 ? dotPos : 0);
        if (!cleanseDotTrigger) continue;
        out.push({
            ability: {
                id: nextId(),
                type: 'dot',
                target: 'all-enemies',
                trigger: cleanseDotTrigger, // 'on-enemy-cleansed'
                conditions: [],
                config: {
                    type: 'dot',
                    dotType: dotInfo.type,
                    tier: dotInfo.tier,
                    stacks: eff.stacks ?? 1,
                    duration: typeof eff.duration === 'number' ? eff.duration : 2,
                },
                autoFilled: true,
            },
            pos: dotPos >= 0 ? dotPos : MAX_POS,
        });
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

    // Control inflictions: emit a `type:'control'` ability per recognized effect (stasis,
    // provoke, taunt, concentrate-fire, disable). ADDITIVE — the parallel named status
    // (parseSkillEffects → applyTimedAbilityStatus) still performs the actual lockout/
    // forced-targeting; the control ability only sources the `control-applied` event
    // (reaction substrate, e.g. Defiant's shield-on-Stasis). Carries no conditions (see the
    // gated-control caveat below); no damage/modifier → DPS pipeline ignores it.
    // Wave 5 (Task A2): an enemy-side control's target is re-derived via detectEnemyGrantScope
    // (same clause-adjacency detection as the paired named-status SkillEffect, keyed on the
    // effect's display name) so an enemy-adjacency phrasing ("Stasis ... on the targeted enemy
    // and all enemies adjacent to the enemy") routes the control to the same adjacency scope as
    // its paired debuff, instead of always collapsing to plain 'enemy'.
    for (const ctrl of parseControlInflicts(text)) {
        const controlTargetName = CONTROL_EFFECT_DISPLAY_NAME[ctrl.effect];
        const controlTarget =
            ctrl.side === 'enemy' ? detectEnemyGrantScope(text, controlTargetName) : ctrl.side;
        out.push({
            ability: {
                id: nextId(),
                type: 'control',
                target: controlTarget, // 'enemy'/adjacency for inflicted, 'self' for Taunt
                trigger: 'on-cast',
                // Control abilities carry no conditions: a GATED control (e.g. Crocus's "if
                // target has >3 debuffs" Stasis) therefore emits control-applied unconditionally
                // on the cast path. Inert today (the only on-stasis-applied reactor, Defiant, has
                // an UNCONDITIONAL Stasis, and no ship both gates its own control and reacts to
                // it). If a future ship pairs a gated control with an own-control reaction, thread
                // the inflicting ability's conditions onto the control ability so a gated-off
                // control doesn't over-fire the reaction.
                conditions: [],
                config: { type: 'control', effect: ctrl.effect },
                autoFilled: true,
            },
            pos: ctrl.pos >= 0 ? ctrl.pos : MAX_POS,
        });
    }

    // Gallant's charged "additional Stasis applied for 1 turn against Defenders" — a control gated
    // on the enemy class. Emitted here (not via parseControlInflicts, whose verb-before regex
    // doesn't match "Stasis applied") carrying the enemy-type condition so the model records the
    // gate. DPS-inert (control abilities have no damage/modifier); the condition documents the
    // Defender restriction for the combat model.
    const condStasis = parseConditionalStasisApplied(text);
    if (condStasis) {
        const stasisPos = text.search(/<unit-skill>\s*Stasis\b/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'control',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [
                    {
                        subject: 'enemy-type',
                        derivable: true,
                        requiredEnemyType: condStasis.requiredEnemyType,
                    },
                ],
                config: { type: 'control', effect: 'stasis' },
                autoFilled: true,
            },
            pos: stasisPos >= 0 ? stasisPos : MAX_POS,
        });
    }

    // Heal / shield grants (and cleanse) — parsed narrowly (on-cast, percentage-of-stat only;
    // damage-reactive and revive shapes emit nothing, see parseHealAbilities). The combat engine
    // ignores these types for now (DPS unchanged); they carry the model for the healing calculator.
    const healNoCrit = parseHealNoCrit(text);
    const skillEffectsForSlot = parseSkillEffects(text, slot === 'charged' ? 'charge' : 'active');
    for (const h of parseHealAbilities(text)) {
        // Anchor at the tag carrying THIS pct (mirrors the damage anchor convention). If multiple
        // heal components share the same pct the regex may hit the wrong tag — acceptable, since
        // the position only drives cosmetic editor order (the engine ignores heal types).
        const healTagPos = text.search(new RegExp(`<unit-damage>(?:[^<]*?)${escNum(h.pct)}%`, 'i'));
        const fallbackPos = text.search(h.kind === 'shield' ? /shield/i : /repair/i);
        const healPos = healTagPos >= 0 ? healTagPos : fallbackPos;
        // Phase 4c PR 1+2: a damage-reaction heal (parser annotation `damageReaction`)
        // rides the live reactive trigger — SELF-subject sentences ("when directly
        // damaged") → on-attacked, ALLY-subject ones (allySubject, Cultivator's "when
        // an ally is directly damaged … repairs 8%") → on-ally-attacked, where the
        // executor heals the damaged ally via eventCtx.damagedAllyId. It takes PRECEDENCE
        // over the position-scoped detector chain below — the annotation is
        // SENTENCE-scoped by the parser (set only when the heal's own sentence carries
        // the trigger), where the detectors infer from an anchor position that can land
        // on the wrong tag when pcts repeat.
        //
        // Pallas: a heal/shield whose anchor falls in the "when this unit critically repairs an
        // ally" sentence rides the on-ally-critically-repaired reactive trigger (position-scoped;
        // undefined → on-cast). APEX: a SHIELD whose anchor falls in the "when an enemy gets
        // debuffed" sentence rides on-debuff-inflicted (own inflictions; position-scoped). Both
        // are position-scoped so an unrelated heal/shield in another sentence is never co-triggered.
        const reactiveTrigger = h.damageReaction
            ? h.damageReaction.allySubject
                ? ('on-ally-attacked' as const)
                : ('on-attacked' as const)
            : // Phase 3 PR-H: Cultivator ("when this Unit cleanses a Debuff, it also repairs that
              // ally") / Morao ("upon Cleansing a Debuff, repairs an additional 5%") — the
              // `ownCleanseReaction` parser annotation (match-position-relative, see its doc
              // comment for why a position-scoped detector can't disambiguate Morao's two
              // same-pct repairs) takes the SAME precedence as damageReaction above.
              h.ownCleanseReaction
              ? ('on-own-cleanse' as const)
              : // Epic PR4: Chimei's "At the start of the round, all allies with Stealth repairs
                // 10% of this unit's max HP" parsed on-cast — the SAME phrase already resolves to
                // start-of-round for buff grants (detectReactiveTrigger) and Judge's passive
                // damage (detectStartOfRoundTrigger, added alongside this call). Checked for
                // heals only (no corpus shield carries this phrase — Xcellence/Volk's start-of-
                // turn shield/heal use a DIFFERENT phrase and stay untouched).
                ((h.kind === 'heal' ? detectStartOfRoundTrigger(text, healPos) : undefined) ??
                // Epic PR4 (start-of-combat one-time grant family): Crucialis's "At the start of
                // combat, this Unit gains a Shield equal to 20% of its Max HP …" and FrontLine's
                // "This Unit gains Shield equal to 25% of its Max HP at the start of combat" parsed
                // on-cast — the shield would re-grant the pool on every skill use instead of once
                // at combat start. Position-scoped (no buff name to resolve a clause on), checked
                // for shields only (no corpus heal carries this phrase — verified ship-skills.csv;
                // Lionheart's start-of-combat "grants adjacent allies 10% of its HP" is a HEAL, not
                // a shield, and is out of this PR's named scope). The engine seeds the pool exactly
                // once via seedPreCombatShields (round 1, before any turn); the cast path
                // (runPlayerTurn) skips pre-combat abilities entirely.
                // basis GUARD (#210 review): the engine's seedPreCombatShields only seeds
                // hp-basis pools — tagging a non-hp pre-combat shield would strip it from the
                // cast path (notPreCombat filter) AND skip it at the seed = silently dropped
                // entirely. Gate here so a future non-hp phrasing keeps legacy on-cast behavior
                // instead. Corpus today (Crucialis/FrontLine/IonScorp) is 100% hp-basis.
                (h.kind === 'shield' && h.basis === 'hp'
                    ? detectPreCombatShieldTrigger(text, healPos)
                    : undefined) ??
                // SP-G G1a: a self shield/heal whose anchor falls in an "every turn"/"each turn"
                // sentence rides the start-of-turn LIVE trigger (Kinetik's per-turn Max-HP shield,
                // Cinya's per-turn Max-HP repair). Position-scoped; mutually exclusive with the
                // start-of-round / pre-combat phrases above (different phrasing). The healing
                // calculator consumes start-of-turn self shields/heals; DPS is unaffected.
                detectEveryTurnTrigger(text, healPos) ??
                detectCritRepairTrigger(text, healPos) ??
                // #2 (Sentinel): a repair anchored in a "when an ally critically hits an enemy …
                // repairs the ally" sentence rides on-ally-crit — the crit-ing ally is routed via
                // eventCtx.damagedAllyId (triggers.ts on-ally-crit listener; the same lane Howler's
                // cleanse uses). Distinct from detectCritRepairTrigger above, which matches "when
                // this Unit critically REPAIRS an ally" (Pallas). Position-scoped; corpus:
                // Sentinel alone carries an ally-crit HEAL clause (Hermes/Howler self-heal in
                // active/charge slots, no ally-crit phrase there).
                detectAllyCritTrigger(text, healPos) ??
                // Yazid: a repair anchored in the "when Cheat Death activates" sentence rides the
                // on-cheat-death-activated reactive trigger (self-scoped; position-scoped). Checked
                // for heals AND shields (the follow-on is a repair, but keep the path symmetric).
                detectCheatDeathActivatedTrigger(text, healPos) ??
                // Salvation: a repair anchored in the "when this Unit is destroyed … repairs … to
                // all allies" sentence rides the on-destroyed reactive trigger (self-death scoped;
                // position-scoped). The parser only emits this all-allies heal when that shape is
                // present (HEAL_DISQUALIFY_RE lookahead), so the trigger fires it ONLY on death.
                detectDestroyedTrigger(text, healPos) ??
                // Madax/Rikra (Phase 3 PR-B): a self-repair anchored in an enemy-kill sentence
                // ("when an enemy dies" / "destroyed … upon killing them") rides the
                // on-enemy-destroyed reactive trigger (position-scoped). The ENEMY-death
                // counterpart to detectDestroyedTrigger's SELF-death case above.
                detectEnemyDestroyedTrigger(text, healPos) ??
                // Crocus (Phase 3 PR-C): a self-repair anchored in the "when another ally
                // inflicts a Damage Over Time (DoT) effect with a critical hit" sentence rides
                // the on-ally-crit-dot reactive trigger (self-target heal; position-scoped).
                detectAllyCritDotTrigger(text, healPos) ??
                // Valkyrie (Phase 3 PR-D): a self+lowest-HP-ally repair anchored in the "when an
                // Echoing Burst explodes on an enemy" sentence rides the on-bomb-detonated
                // reactive trigger (position-scoped). The HEAL-builder counterpart to Demolisher's
                // charge removal (parseChargeRemoval) and Lingshe's buff grant (detectReactiveTrigger)
                // readings of the same bomb-detonation phrasing.
                detectBombDetonatedTrigger(text, healPos) ??
                // Sefuba p1/p2: a self-repair anchored in the "when this Unit purges … enemy"
                // sentence rides the on-enemy-purged reactive trigger (position-scoped).
                detectEnemyPurgedTrigger(text, healPos) ??
                // Salvation p3: a repair anchored in the "when a buff is purged from an ally"
                // sentence rides the on-ally-purged reactive trigger (position-scoped).
                detectAllyPurgedTrigger(text, healPos) ??
                // Hayyan p2: a repair anchored in the "when a debuff is inflicted on an ally"
                // sentence rides the on-ally-debuffed reactive trigger (victim-scoped; position-
                // scoped). Position-scoping keeps Hayyan's sibling on-own-cleanse repair (a
                // different sentence) untouched.
                detectAllyDebuffedTrigger(text, healPos) ??
                // Sansi p2 (ship-kit W3): a self-repair anchored in the "when an enemy is directly
                // repaired … repairs 5% for every enemy repaired" sentence rides the
                // on-enemy-repaired reactive trigger (position-scoped) — the SAME live trigger
                // Amartya's Defense Shred debuff rides (buildShipAbilities enemy-debuff path). The
                // heal targets SELF; only the SCALING count reads the repaired-enemy ids
                // (eventCtx.repairedEnemyIds.length) via the scaling wiring below. Enforced at most
                // maxPerRound times per round (also wired below).
                detectEnemyRepairedTrigger(text, healPos)?.trigger ??
                // Anemone p2 (ship-kit W3, Task 6): a self-repair anchored in the "when an enemy
                // takes damage from a Damage over Time effect" sentence rides the NEW
                // on-enemy-dot-damage reactive trigger (position-scoped) — wired onto the
                // already-existing dot-ticked bus event (triggers.ts). Heal-only (no corpus
                // shield carries this phrase).
                (h.kind === 'heal' ? detectEnemyDotDamageTrigger(text, healPos) : undefined) ??
                // Hemlock p2 (ship-kit W3, Task 9): a self-repair anchored in the "when Corrosion
                // spreads … repairs 5% … per enemy affected" sentence rides the NEW
                // on-corrosion-spread reactive trigger (position-scoped) — wired onto the NEW
                // corrosion-spread bus event (combat/events.ts), emitted by the engine's
                // end-of-round Toxic Overflow spread mechanic (ledger #49). Heal-only (no corpus
                // shield carries this phrase). The heal targets SELF; only the SCALING count reads
                // the affected-ally ids (eventCtx.spreadAffectedIds.length) via the scaling wiring.
                (h.kind === 'heal' ? detectCorrosionSpreadTrigger(text, healPos) : undefined) ??
                (h.kind === 'shield'
                    ? // Laika p1/p2 (ship-kit W3, Task 7): a self-shield anchored in the "upon
                      // removing Shield from an enemy" sentence rides the NEW on-own-shield-strip
                      // reactive trigger (position-scoped) — wired onto the NEW shield-stripped
                      // bus event (combat/events.ts), self-scoped in triggers.ts (mirrors
                      // on-own-cleanse). Shield-only (no corpus heal carries this phrase).
                      (detectShieldStrippedTrigger(text, healPos) ??
                      detectDebuffInflictedTrigger(text, healPos) ??
                      // Defiant: a SHIELD anchored in the "when applying Stasis" clause rides the
                      // on-stasis-applied reactive trigger (own-cast scoped; position-scoped).
                      detectStasisAppliedTrigger(text, healPos))
                    : undefined));
        // The "while below N% HP" gate is DERIVABLE: the executor evaluates the self
        // hp-threshold against live tank HP at drain time (Phase 4c Task 6).
        const damageReactionConditions: Condition[] =
            h.damageReaction?.hpBelowPct !== undefined
                ? [
                      {
                          subject: 'hp-threshold',
                          derivable: true,
                          hpComparator: 'below',
                          hpPercent: h.damageReaction.hpBelowPct,
                          hpSubject: 'self',
                      },
                  ]
                : [];
        // maskAbbrev (length-preserving) runs BEFORE the pct-position search/sentenceContaining so
        // an "Inc."/"Out." abbreviation period inside a co-cast buff name (Graphite's charged-slot
        // "Out. Damage Up III") is not treated as a sentence boundary — otherwise it splits the
        // buff name out of the shield's detected sentence and the all-allies flip below never
        // matches (Finding C1). eff.buffName is masked the same way so both sides of the
        // `.includes` check line up.
        const healPlain = maskAbbrev(stripTags(text).replace(/<br\s*\/?>/gi, '. '));
        const healPlainPos = healPlain.search(new RegExp(`${escNum(h.pct)}%`, 'i'));
        const healSentence = healPlainPos >= 0 ? sentenceContaining(healPlain, healPlainPos) : '';
        const shieldCoCastAllAlliesGrant =
            h.kind === 'shield' &&
            (slot === 'active' || slot === 'charged') &&
            mult === 0 &&
            healSentence !== '' &&
            skillEffectsForSlot.some(
                (eff) =>
                    eff.target === 'all-allies' &&
                    healSentence.toLowerCase().includes(maskAbbrev(eff.buffName).toLowerCase())
            );
        const oncePerCombat =
            reactiveTrigger === 'on-cheat-death-activated' && /once per battle/i.test(healSentence);
        // Bare support shields route to all-allies (Graphite co-cast); heals use flipBareSupportTarget.
        const healTarget =
            h.kind === 'heal'
                ? flipBareSupportTarget(
                      h.target,
                      h.explicitTarget,
                      slot,
                      mult > 0,
                      healSentence,
                      role,
                      // AoE: a bare support-cast heal repairs every ally in the pattern footprint
                      // (like all-allies buffs), not a single ally. Volk-style explicit "most
                      // missing health" sets explicitTarget and stays a single 'ally'.
                      'all-allies'
                  )
                : h.kind === 'shield'
                  ? flipBareSupportShieldTarget(
                        h.target,
                        h.explicitTarget,
                        slot,
                        mult > 0,
                        shieldCoCastAllAlliesGrant
                    )
                  : h.target;
        // PR6b: per-count repair scaling (Oleander/Meatshield). The count Condition is appended
        // after any damage-reaction conditions and referenced by an Ability-level scaling rule
        // (mirrors the damage-scaling convention). Model fidelity — no DPS/sim consumer today.
        const healConditions: Condition[] = [...damageReactionConditions];
        // Malvex active: "If the target has a Shield this Unit gains Shield equal to 15% of its Max
        // HP" — the NAMELESS-grant twin of the charged-slot Barrier gate. detectGrantConditions
        // resolves its clause off a buff name, so it can only ever gate a NAMED grant; a heal/shield
        // has no name, which is why this loop dropped the gate entirely and Malvex banked 15% of its
        // max HP on every active cast regardless of the target. Scoped to `healSentence` (this
        // grant's OWN sentence) so a co-cast repair/shield in another sentence never inherits it —
        // the positional equivalent of resolveBuffClause on the named path.
        //
        // The gate is honoured with NO executor change: gateFiringAbilities (applyAbilities.ts)
        // already hard-gates every firing-slot ability through conditionsMet, and the cast-time ctx
        // it gates against populates `enemyShielded` from the resolved victim's live shieldPool
        // (playerTurn.ts) — the same lever the charged Barrier's postDebuffGateCtx pulls. Read is
        // PRE-damage/PRE-strip, matching the game's cast-time reading of the clause.
        //
        // Kind-agnostic (heal or shield) because the clause means the same thing for either, and no
        // corpus heal carries it today. CAVEAT: healSentence is located by the grant's PCT, so two
        // same-pct grants in one row can resolve to each other's sentence (the pre-existing anchor
        // caveat at the top of this loop) — which now moves a real GATE, not just editor order.
        // Malvex's row has no such collision (100/5/15, one grant); a future one would need a
        // clause-index anchor instead.
        if (detectTargetShieldGate(healSentence)) {
            healConditions.push({ subject: 'enemy-shield', derivable: true });
        }
        let healScaling: ScalingRule | undefined;
        if (h.scaling?.countSource) {
            // ship-kit W3 (Sansi): reactive event-count scaling — the count comes from the
            // triggering event (repairedEnemyIds.length), NOT a live-state Condition, so no
            // condition is pushed and `conditionIndex` is omitted. The reactive heal executor
            // multiplies the base pct by that count.
            healScaling = { perUnit: h.scaling.perUnit, countSource: h.scaling.countSource };
        } else if (h.scaling?.condition) {
            healScaling = { conditionIndex: healConditions.length, perUnit: h.scaling.perUnit };
            healConditions.push(h.scaling.condition);
        }
        out.push({
            ability: {
                id: nextId(),
                type: h.kind,
                target: healTarget,
                trigger: reactiveTrigger ?? 'on-cast',
                // Isha's instead-on-crit pair: 'non-crit' fires only on non-critting hits,
                // 'crit' only on critting hits (omitted → fires on any hit).
                ...(h.damageReaction?.critFilter
                    ? { triggerCritFilter: h.damageReaction.critFilter }
                    : {}),
                conditions: healConditions,
                ...(healScaling ? { scaling: healScaling } : {}),
                // ship-kit W3 (Sansi): numeric per-round cap ("limited to 3 times per Round").
                ...(h.maxPerRound !== undefined ? { maxPerRound: h.maxPerRound } : {}),
                config: {
                    type: h.kind,
                    pct: h.pct,
                    basis: h.basis,
                    ...(h.kind === 'heal' && healNoCrit ? { noCrit: true } : {}),
                    // Standing leech (passive-slot damage-dealt): default scope 'all'
                    // (user decision: direct + DoT ticks + detonations). Cast riders
                    // (active/charged) carry no scope.
                    ...(h.basis === 'damage-dealt' && slot === 'passive'
                        ? { leechScope: h.leechScope ?? 'all' }
                        : {}),
                    ...(h.requiresHpDamage ? { requiresHpDamage: true } : {}),
                    ...(oncePerCombat ? { oncePerCombat: true } : {}),
                },
                autoFilled: true,
            },
            pos: healTagPos >= 0 ? healTagPos : fallbackPos >= 0 ? fallbackPos : MAX_POS,
        });
    }

    for (const c of parseCleanse(text)) {
        const cleansePos = text.search(/cleanse/i);
        // Pallas: "when this unit critically repairs an ally, it cleanses 1 debuff from itself" —
        // the cleanse rides the on-ally-critically-repaired reactive trigger (position-scoped).
        // Howler (Phase 3 PR-G): "cleanses 1 debuff from an ally when that ally crits an enemy" —
        // rides on-ally-crit instead (a DIFFERENT ally does the critting, not the owner) — routed
        // to the crit-er via eventCtx.damagedAllyId (triggers.ts on-ally-crit listener).
        // Purifier (Phase 3 PR-A): a PASSIVE-slot "cleanses N debuff when directly damaged" cleanse
        // rides on-attacked — the cleanse builder previously derived ONLY the crit-repair reaction,
        // so a direct-damage cleanse fell through to on-cast. Gated to passive (an active/charged
        // cleanse is on-cast) and position-scoped, so only a passive cleanse whose own sentence
        // carries the reaction phrase flips (corpus: Purifier alone — Makoli/Nosorog/Nyxen's
        // cleanses sit in active/charged slots or a different sentence; Cultivator's is on-own-cleanse).
        // Nuqtu (Phase 3 PR-I): "Cleanses 1 debuff from itself (once per round) ... when an enemy
        // gets buffed" rides on-enemy-buffed (position-scoped; opposing-scoped trigger).
        // AEGIS (SP-F F2): "cleanses all debuffs when an ally ... has their Shield destroyed"
        // rides on-ally-shield-destroyed — position-scoped like the siblings above (this loop has
        // no buff name to resolve a clause on).
        const reactiveTrigger =
            detectCritRepairTrigger(text, cleansePos) ??
            detectAllyCritTrigger(text, cleansePos) ??
            detectEnemyBuffedTrigger(text, cleansePos) ??
            detectAllyShieldDestroyedTrigger(text, cleansePos) ??
            (slot === 'passive' &&
            detectDamageReactionTrigger(text, cleansePos)?.trigger === 'on-attacked'
                ? ('on-attacked' as const)
                : undefined);
        // AEGIS's cleanse targets the ally whose shield was destroyed, NOT the bare-phrasing
        // self default flipBareSupportTarget would otherwise resolve to (the clause "cleanses all
        // debuffs" names no explicit receiver — the receiver is only named in the reactive
        // TRIGGER clause, which flipBareSupportTarget/parseCleanse's target detection cannot see).
        const cleanseTarget =
            reactiveTrigger === 'on-ally-shield-destroyed'
                ? 'ally'
                : flipBareSupportTarget(c.target, c.explicitTarget, slot, mult > 0);
        // Nuqtu's "(once per round)" cap — the plain self-scoped Ability.oncePerRound flag.
        const cleanseOncePerRound = detectCleanseOncePerRound(text, cleansePos);
        out.push({
            ability: {
                id: nextId(),
                type: 'cleanse',
                target: cleanseTarget,
                trigger: reactiveTrigger ?? 'on-cast',
                conditions: [],
                config: {
                    type: 'cleanse',
                    count: c.count,
                    ...(c.debuffType ? { debuffType: c.debuffType } : {}),
                },
                ...(cleanseOncePerRound ? { oncePerRound: true } : {}),
                autoFilled: true,
            },
            pos: cleansePos >= 0 ? cleansePos : MAX_POS,
        });
    }

    // PR10: buff steal — active/charged (on-cast) ONLY, mirroring purge's slot-gate below.
    // Corpus (Pallas/Thresh/Tithonus) always carries the steal on the charged skill, always
    // targeting "the primary target" (single enemy, no all-enemies variant). Independent of the
    // sibling purge/damage clauses in the same sentence (Tithonus) — parseBuffSteal's STEAL_RE
    // and parsePurge's PURGE_RE match distinct verbs and never cannibalize each other.
    if (slot === 'active' || slot === 'charged') {
        for (const st of parseBuffSteal(text)) {
            const stealPos = text.search(/steal/i);
            out.push({
                ability: {
                    id: nextId(),
                    type: 'buff-steal',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff-steal',
                        count: st.count,
                        ...(st.grantAdjacentAllies ? { grantAdjacentAllies: true } : {}),
                    },
                    autoFilled: true,
                },
                pos: stealPos >= 0 ? stealPos : MAX_POS,
            });
        }
    }

    // PR11 (epic PR11): debuff-duration reduction — the inverse of extend-dot. Modeled as a
    // 'cleanse' ability with mode:'reduce-duration' + count:'all' (shrinks EVERY eligible
    // debuff on the recipient by durationTurns, not just the newest — the Warpstrike implant's
    // count:0/mode:'reduce-duration' shape stays newest-only and is unaffected by count:'all'
    // being a new, distinct value). Two corpus shapes:
    //  - Heliodor: a self-subject damage reaction ("When directly damaged, this Unit reduces
    //    the duration of all active Debuffs on itself/all allies …") → trigger 'on-attacked'.
    //    The unit being damaged is always itself (never the ally-subject shape) — only the
    //    RECIPIENT (self vs all-allies) varies, mirroring parseHealAbilities' identical
    //    treatment of Heliodor's co-occurring repair clause in the same sentence.
    //  - Pestilence: gated on this unit's OWN debuff infliction ("On debuff infliction this
    //    Unit reduces …") → trigger 'on-debuff-inflicted', target all-allies.
    // Lingshe's charge-skill Bomb-countdown reduction is a structurally different mechanic
    // (enemy-targeted, hacking-gated, PendingBomb countdown with a forced-detonation-at-zero
    // rider — not the generic timed-debuff store this touches) and is deliberately NOT parsed
    // here; see scripts/auditSkills.allowlist.ts.
    for (const dr of parseDebuffDurationReduction(text)) {
        // Map the parsed gate to a reactive trigger EXPLICITLY (not by absence): Pestilence's
        // "on debuff infliction" → on-debuff-inflicted; Heliodor's "when directly damaged" self
        // reaction → on-attacked. A clause matching NEITHER gate carries no recognized reactive
        // trigger — it is NOT emitted (a silent on-cast default would fire an all-debuff reduction
        // every round, phantom behaviour). No corpus ship hits this branch today (both shapes are
        // reactive); the audit's debuff-duration-reduction rule would flag such a future ship so
        // its trigger can be modelled here.
        const trigger: AbilityTrigger | undefined = dr.onDebuffInflicted
            ? 'on-debuff-inflicted'
            : dr.isDamageReaction
              ? 'on-attacked'
              : undefined;
        if (!trigger) continue;
        const reducePos = text.search(/reduces?\s+the\s+duration/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'cleanse',
                target: dr.target,
                trigger,
                conditions: [],
                config: {
                    type: 'cleanse',
                    count: 'all',
                    mode: 'reduce-duration',
                    durationTurns: dr.turns,
                },
                autoFilled: true,
            },
            pos: reducePos >= 0 ? reducePos : MAX_POS,
        });
    }

    // Emit purge from active/charged (on-cast, C2a) AND from a PASSIVE slot WHEN a purge
    // trigger is detected in the purge's own sentence (C2b-2): Iridium "when directly damaged"
    // → on-attacked. Rhodium end-of-round + Faust killed-by-direct-damage detectors, plus
    // Zeolite's "when dealing damage to a Defender" (Wave 8 Task 12) → on-deal-damage, carrying
    // an `enemy-type` Defender condition (see detectPurgeEnemyTypeCondition below — same
    // extraction the outgoing-damage-modifier branch above uses for Zeolite's sibling "+30%
    // damage when hitting a Defender" gate). A passive purge with NO detected trigger is NOT
    // emitted (Sefuba's chain stays on PURGE_MORE_RE below). Purge is enemy-only (no support-flip).
    //
    // C2b-3 update: Nayra's "if the target was repaired this round, purge all buffs" now emits
    // with conditions:[{subject:'target-repaired-this-round', derivable:true}] (see
    // detectRepairedThisRoundCondition below). The engine cast path evaluates this condition;
    // Task 3 populates targetRepairedThisRound on ConditionContext. Until then the condition
    // always evaluates false, keeping production byte-identical (no Nayra fixture in any golden).
    //
    // I6: the passive-voice "is Purged of all buffs" form (Lodolite charged) is picked up by
    // detectPassiveVoicePurge, merged in ONLY for the on-cast (active/charged) slots — the
    // passive-slot trigger-detection loop below never sees it (see detectPassiveVoicePurge's
    // doc comment for why that separation matters). Amartya count-scaling under-counts to 1 —
    // SAFE under direction.
    const purgeMatches =
        slot === 'active' || slot === 'charged'
            ? [...parsePurge(text), ...detectPassiveVoicePurge(text)]
            : parsePurge(text);
    for (const p of purgeMatches) {
        const purgePos = text.search(/purge/i);
        const passiveTrigger: AbilityTrigger | undefined =
            // Iridium: self-subject "when directly damaged" → on-attacked. (Ignore the
            // on-ally-attacked branch — no corpus ally-purge exists.)
            detectDamageReactionTrigger(text, purgePos)?.trigger === 'on-attacked'
                ? ('on-attacked' as const)
                : (detectEndOfRoundPurgeTrigger(text, purgePos) ?? // Rhodium
                  detectKilledByDirectDamageTrigger(text, purgePos) ?? // Faust
                  detectDealDamageToRoleTrigger(text, purgePos)); // Zeolite (Task 12)
        const trigger: AbilityTrigger | undefined =
            slot === 'active' || slot === 'charged' ? 'on-cast' : passiveTrigger;
        if (!trigger) continue; // passive purge with no recognized trigger → not emitted
        // Most-buffs target override: applies regardless of slot (future-proofs active/charged
        // most-buffs purges; harmless for current corpus where only Rhodium passive carries it).
        const target: AbilityTarget = detectMostBuffsTarget(text, purgePos)
            ? 'enemy-most-buffs'
            : p.target;
        const repairedCond = detectRepairedThisRoundCondition(text, purgePos);
        // Task 12: an on-deal-damage purge (Zeolite) is gated on the DAMAGED enemy being the
        // named role (Defender) — reuses the enemy-type extraction shared with the +30%
        // damage-modifier branch above. Only computed for the on-deal-damage trigger so no
        // other purge (Iridium/Rhodium/Faust) picks up a spurious condition.
        const enemyTypeCond =
            trigger === 'on-deal-damage'
                ? detectPurgeEnemyTypeCondition(text, purgePos)
                : undefined;
        out.push({
            ability: {
                id: nextId(),
                type: 'purge',
                target,
                trigger,
                conditions: [
                    ...(repairedCond ? [repairedCond] : []),
                    ...(enemyTypeCond ? [enemyTypeCond] : []),
                ],
                config: {
                    type: 'purge',
                    count: p.count,
                    ...(p.countScaling ? { countScaling: p.countScaling } : {}),
                    ...(purgeStripsShield ? { stripsShield: true } : {}),
                },
                autoFilled: true,
            },
            pos: purgePos >= 0 ? purgePos : MAX_POS,
        });
    }

    // C2b-1 T5: Sefuba chain purge — "purges N more buff from the enemy" on on-enemy-purged.
    // Emitted here, separately from the generic loop above. Sefuba's passive sentences carry no
    // recognized purge trigger (on-attacked/end-of-round/killed-by-direct), so the generic loop's
    // trigger-detection `continue` skips both of Sefuba p2's parsePurge matches — there is no
    // double-emit risk. Count: PURGE_MORE_RE capture group 1 (digit or 'a'/'an' → 1).
    {
        const purgeMoreMatch = PURGE_MORE_RE.exec(text);
        if (purgeMoreMatch) {
            const purgeMorePos = purgeMoreMatch.index;
            if (detectEnemyPurgedTrigger(text, purgeMorePos)) {
                // PURGE_MORE_RE group 1 is (\d+|a|an) — never 'all' — so a digit → its value,
                // 'a'/'an' → 1. (Type stays number|'all' to match the purge config shape.)
                const rawCount = purgeMoreMatch[1];
                const count: number | 'all' = /^\d+$/.test(rawCount) ? parseInt(rawCount, 10) : 1;
                out.push({
                    ability: {
                        id: nextId(),
                        type: 'purge',
                        target: 'enemy',
                        trigger: 'on-enemy-purged',
                        conditions: [],
                        config: {
                            type: 'purge',
                            count,
                            ...(purgeStripsShield ? { stripsShield: true } : {}),
                        },
                        autoFilled: true,
                    },
                    pos: purgeMorePos,
                });
            }
        }
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
        // Phase 3: an explicit conditions array (start-of-turn + full-HP, Cobalt) carries BOTH a
        // trigger and a gate, overriding the "trigger ⇒ no condition" rule used by the inflict/repair
        // reactive gains (whose trigger IS the gate).
        const conditions = charge.conditions
            ? charge.conditions
            : reactiveTrigger
              ? []
              : [
                    toCondition(
                        charge.condition,
                        charge.derivable,
                        charge.manualCount,
                        charge.requiredEnemyType,
                        text
                    ),
                ];
        out.push({
            ability: {
                id: nextId(),
                type: 'charge',
                target: 'self',
                trigger: reactiveTrigger ?? 'on-cast',
                conditions,
                config: { type: 'charge', amount: charge.amount },
                autoFilled: true,
            },
            pos: chargePos >= 0 ? chargePos : MAX_POS,
        });
    }

    // Phase 1 Task 3: enemy-targeted charge removal (Opal, Provider, Sefuba, Demolisher, Zosimos,
    // Thresh). parseChargeRemoval returns the trigger and everyNthEvent when relevant; this block
    // coexists with the gain block above — texts carrying both (e.g. Zosimos) emit two charge
    // abilities. Reactive triggers (on-bomb-detonated / on-enemy-repaired) carry no conditions;
    // on-cast removal also has no condition gate (it fires with the skill) UNLESS the removal's
    // own sentence shares an "if the target is a <Type>" gate with a paired self-gain (Thresh,
    // epic PR3) — parseChargeRemoval surfaces that as `requiredEnemyType`, propagated here via
    // the same `toCondition` helper the self-gain path (above) uses, so both halves of the
    // sentence stay in sync. The every-Nth-event gate is NOT a condition — it lives on the
    // ability's everyNthEvent field.
    const chargeRemoval = parseChargeRemoval(text);
    if (chargeRemoval) {
        // Position-only heuristic for within-slot ordering; uses the canonical REMOVE_CHARGE_RE
        // from skillTextParser.ts so the sort point matches the exact clause the parser matched.
        const removalPos = text.search(REMOVE_CHARGE_RE);
        out.push({
            ability: {
                id: nextId(),
                type: 'charge',
                target: 'enemy',
                trigger: chargeRemoval.trigger,
                conditions: chargeRemoval.requiredEnemyType
                    ? [
                          toCondition(
                              'enemy-type',
                              true,
                              undefined,
                              chargeRemoval.requiredEnemyType,
                              text
                          ),
                      ]
                    : [],
                config: { type: 'charge', amount: chargeRemoval.amount },
                ...(chargeRemoval.everyNthEvent
                    ? { everyNthEvent: chargeRemoval.everyNthEvent }
                    : {}),
                autoFilled: true,
            },
            pos: removalPos >= 0 ? removalPos : MAX_POS,
        });
    }

    // Phase 4 (Curator / FrontLine): reaction to an ENEMY casting its charged skill. The
    // parser returns full Ability objects with placeholder ids on the on-enemy-charged-cast
    // trigger (purge + optional Block-Buff inflict); reassign each a fresh nextId() so the
    // purge and the Block-Buff debuff get DISTINCT, stable ids. Positioned at the reaction's
    // trigger phrase so within-slot text order is preserved.
    const enemyChargedCastReactions = parseEnemyChargedCastReaction(text);
    if (enemyChargedCastReactions) {
        const reactionPos = text.search(
            // Tolerate a <unit-skill>-wrapped "charged skill" (raw text is unstripped here) so a
            // tagged phrase still anchors the reaction at its trigger clause instead of MAX_POS.
            /when\s+an?\s+enemy\s+uses\s+(?:its|their)\s+(?:<unit-skill>\s*)?charged\s+skill(?:\s*<\/unit-skill>)?/i
        );
        for (const ability of enemyChargedCastReactions) {
            out.push({
                ability: { ...ability, id: nextId() },
                pos: reactionPos >= 0 ? reactionPos : MAX_POS,
            });
        }
    }

    // Liberator (Phase 4b Task 10): "When an enemy dies, all allies add 1 charge to their
    // Charged Skills" → an all-allies charge ability on the on-enemy-destroyed reactive trigger
    // (rides the existing charge executor's ally/all-allies path). Emitted BEFORE the extra-action
    // block so the slot keeps text-position order (the charge phrase precedes the extra-action one).
    const allyCharge = parseAllyChargeOnEnemyDeath(text);
    if (allyCharge) {
        const allyChargePos = text.search(/all allies/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'charge',
                target: 'all-allies',
                trigger: 'on-enemy-destroyed',
                conditions: [],
                config: { type: 'charge', amount: allyCharge.amount },
                // Once per round even when multiple enemies die in the same round (Liberator).
                oncePerRound: true,
                autoFilled: true,
            },
            pos: allyChargePos >= 0 ? allyChargePos : MAX_POS,
        });
    }

    // Hayyan / Graphite (enemy-team PR3): an all-allies charge-bar grant on cast (Hayyan)
    // or start-of-round (Graphite). Distinct from the self-charge block above (parseChargeGain
    // disqualifies these ally phrasings) and from Liberator's on-enemy-death block. Graphite's
    // grant is gated on an enemy having Stealth (a derivable enemy-buff condition).
    const allyChargeGrant = parseAllyChargeGrant(text);
    if (allyChargeGrant) {
        const grantPos = text.search(/charge/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'charge',
                target: 'all-allies',
                trigger: allyChargeGrant.trigger,
                conditions: allyChargeGrant.conditions ?? [],
                config: { type: 'charge', amount: allyChargeGrant.amount },
                autoFilled: true,
            },
            pos: grantPos >= 0 ? grantPos : MAX_POS,
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
                // Death-triggered grants (Task 10) carry the trigger detected from the clause
                // (Sokol/Liberator on-enemy-destroyed, Harvester on-ally-destroyed) so they fire
                // via the death listener + the engine's grantExtraAction bridge, NOT on cast.
                // Default on-cast grants (Nuqtu/Sustainer/Tormenter/Tygr) keep trigger on-cast.
                trigger: extra.trigger ?? 'on-cast',
                conditions: extra.conditions,
                config: {
                    type: 'extra-action',
                    oncePerRound: extra.oncePerRound,
                    endOfRound: extra.endOfRound,
                },
                autoFilled: true,
            },
            pos: extraPos >= 0 ? extraPos : MAX_POS,
        });
    }

    // Overload lose-on-kill (and "removes"/"is lost" phrasings): the 5 Marauder ships drop a
    // named self-buff on a reactive trigger. parseSelfBuffRemovals (Task 5) scopes the trigger to
    // the removal clause's position; the buff is cleared from ALL self stores (scope: 'all').
    //
    // Wave 8 Task 11 (Wusheng): an `on-attacked` removal ("if directly damaged … remove Stealth")
    // additionally gates on the named buff still being ACTIVE at drain time — unlike the Marauder
    // kill/repair/debuff triggers (which fire unconditionally; removeSelfBuffByName is a safe
    // no-op if the buff was never present, so those never needed a gate), Wusheng's text is
    // explicitly conditional ("if directly damaged WHILE Stealth is active"). The generic
    // `self-buff` ConditionSubject (evaluateConditions.ts) already reads a live buff-presence
    // count off the owner's snapshot, so this reuses existing machinery rather than adding a new
    // condition kind.
    for (const rem of parseSelfBuffRemovals(text)) {
        const removePos = findBuffNamePos(text, rem.buffName);
        out.push({
            ability: {
                id: nextId(),
                type: 'remove-self-buff',
                target: 'self',
                trigger: rem.trigger,
                conditions:
                    rem.trigger === 'on-attacked'
                        ? [{ subject: 'self-buff', buffName: rem.buffName, derivable: true }]
                        : [],
                config: { type: 'remove-self-buff', buffName: rem.buffName, scope: 'all' },
                autoFilled: true,
            },
            pos: removePos >= 0 ? removePos : MAX_POS,
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

    // D-PR3 T5: Iridium "takes N% less damage from Critical hits" → incoming-reduction.
    // Emitted as a separate block (approach b) rather than extending parseModifiers,
    // because ParsedModifier is typed for outgoing-damage channels and the incoming-
    // reduction config shape is orthogonal. The ability is INERT until a later task
    // wires up the engine consumer.
    const critReductionPct = parseIncomingCritReduction(text);
    if (critReductionPct !== null) {
        const critRedPos = text.search(/less\s+damage\s+from\s+critical\s+hits/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'incoming-reduction',
                target: 'self',
                trigger: 'on-cast',
                conditions: [],
                config: {
                    type: 'incoming-reduction',
                    scope: 'direct',
                    condition: 'incoming-crit',
                    pct: critReductionPct,
                    critFamily: true,
                },
                autoFilled: true,
            },
            pos: critRedPos >= 0 ? critRedPos : MAX_POS,
        });
    }

    // Epic PR12(C): the four incoming-damage-reduction phrasings (Anemone/Panon/Wusheng/
    // Tormenter). One or two abilities per directive (one per `scopes` entry — "all incoming
    // damage"/unscoped phrasings emit both 'direct' and 'dot').
    for (const dir of parseIncomingDamageReductionPhrasings(text)) {
        for (const scope of dir.scopes) {
            out.push({
                ability: {
                    id: nextId(),
                    type: 'incoming-reduction',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'incoming-reduction',
                        scope,
                        condition: dir.condition,
                        pct: dir.pct ?? 0,
                        critFamily: false,
                        ...(dir.hpScaling ? { hpScaling: dir.hpScaling } : {}),
                    },
                    autoFilled: true,
                },
                pos: dir.matchIndex >= 0 ? dir.matchIndex : MAX_POS,
            });
        }
    }

    // SP-F F5 (Meatshield, R4 refit-active passive — APPROXIMATION): "Any direct damage dealt
    // to a non-defender ally that is not transferred by Protection is dealt as if that ally
    // had this Unit's defense." Protection-as-damage-transfer is deferred (design doc §1), so
    // nothing is ever "transferred by Protection" in this model — the "not transferred" gate is
    // vacuously satisfied, and this substitutes for EVERY living non-defender ally,
    // unconditionally (`conditions: []`). No-op marker config (mirrors damage-reflection /
    // buff-duration-extension above) — the engine collects every carrier into a dedicated map
    // and substitutes at the defence-read sites; this ability is NEVER read by the on-cast
    // ability-fold/executor pipeline. Ally-scoped (`target: 'all-allies'`) — distinct from the
    // self-target "gains 3 stacks of Protection" buff this same text also carries.
    if (parseDefenseSubstitution(text)) {
        const substitutionPos = text.search(/dealt\s+as\s+if/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'defense-substitution',
                target: 'all-allies',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'defense-substitution' },
                autoFilled: true,
            },
            pos: substitutionPos >= 0 ? substitutionPos : MAX_POS,
        });
    }

    // Wave 4 Task 8 (FrontLine passive): "While Shielded, it gains 2500 additional Defense" — a
    // flat-points DEFENSIVE stat bonus gated on the owner currently holding a shield. No-op
    // marker config (mirrors defense-substitution above) — the engine collects every carrier
    // into a per-owner map and folds `flat` into `substitutedDefenceFor`'s defensive read, gated
    // live on hasShield(ownerId); this ability is NEVER read by the on-cast ability-fold/executor
    // pipeline. `trigger` is nominal ('on-cast' matches every other no-op marker in this file) —
    // the bonus is applied dynamically at the defensive read, never fired.
    const whileShieldedFlatDefence = parseWhileShieldedFlatDefence(text);
    if (whileShieldedFlatDefence !== undefined) {
        const whileShieldedPos = text.search(/while\s+shielded/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'conditional-stat',
                target: 'self',
                trigger: 'on-cast',
                conditions: [],
                config: {
                    type: 'conditional-stat',
                    stat: 'defence',
                    flat: whileShieldedFlatDefence,
                    condition: 'self-shield',
                },
                autoFilled: true,
            },
            pos: whileShieldedPos >= 0 ? whileShieldedPos : MAX_POS,
        });
    }

    // PR F4: permanent pre-fight base-stat passives ("At the start of combat, …" /
    // role-gated adjacency grants — Lionheart/Centurion/Enforcer/Defiant/Stalwart).
    // Annotation-only until the battle sim's pre-fight layer (F5) applies them to plan
    // stats; the DPS pipeline ignores the type by construction (modifierTotalsFromAbilities
    // type-filters, no firing-skill extractor / status registration / reactive listener
    // matches 'pre-combat-stat', and 'pre-combat' is not in LIVE_TRIGGERS). No slot gate —
    // passive-slot refit resolution is already handled by getSkillRowForSlot. The grant's
    // pos indexes the TAG-STRIPPED text (≤ raw index) — cosmetic editor order only.
    for (const grant of parsePreCombatStatGrants(text)) {
        out.push({
            ability: {
                id: nextId(),
                type: 'pre-combat-stat',
                target: grant.target,
                trigger: 'pre-combat',
                conditions: [],
                config: {
                    type: 'pre-combat-stat',
                    stat: grant.stat,
                    value: grant.value,
                    valueKind: grant.valueKind,
                    ...(grant.perAdjacentAlly ? { perAdjacentAlly: true } : {}),
                    ...(grant.requiresAdjacentRole
                        ? { requiresAdjacentRole: grant.requiresAdjacentRole }
                        : {}),
                },
                autoFilled: true,
            },
            pos: grant.pos,
        });
    }

    // SP-E: Voron/Orel "transforms the [incoming direct] damage into a Damage over Time effect
    // lasting for N turns" — a reactive self-conversion, distinct from the counter/incoming-*
    // families above (no damage tag, no buff/debuff name to merge). Voron's is unconditional
    // (condition:'always'); Orel's fires only vs a Taunted/Provoked attacker
    // (condition:'attacker-taunted-or-provoke', detected in the same clause).
    const transform = detectTransformToDot(text);
    if (transform) {
        const transformPos = text.search(/transform\w*\s+the\s+damage/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'transform-incoming-to-dot',
                target: 'self',
                trigger: 'on-attacked',
                conditions: [],
                config: {
                    type: 'transform-incoming-to-dot',
                    turns: transform.turns,
                    condition: transform.condition,
                },
                autoFilled: true,
            },
            pos: transformPos >= 0 ? transformPos : MAX_POS,
        });
    }

    // Meatshield refit-active passive: Protection-redirected damage → 2-turn self-DoT. Distinct
    // detector from the Voron/Orel transform above (disjoint regexes); gated to fire only on a
    // Protection redirect via condition 'self-protection-redirect'.
    const protTransform = detectProtectionTransformToDot(text);
    if (protTransform) {
        const protPos = text.search(/is\s+transformed\s+into/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'transform-incoming-to-dot',
                target: 'self',
                trigger: 'on-attacked',
                conditions: [],
                config: {
                    type: 'transform-incoming-to-dot',
                    turns: protTransform.turns,
                    condition: 'self-protection-redirect',
                },
                autoFilled: true,
            },
            pos: protPos >= 0 ? protPos : MAX_POS,
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
 * Phase 4c PR 3 (Task 7): a "when HP drops/falls below N%" buff-grant reactive. On a match,
 * mutates the ability onto the LIVE on-hp-threshold-crossed trigger with a derivable SELF
 * hp-threshold condition (evaluated against live tank HP at the crossing edge — Task 3 listener)
 * and, when the scoped sentence says "once per battle", sets config.oncePerCombat (reusing the
 * detector's \b-anchored flag rather than re-testing inline). Sentence-scoped at the buff's
 * anchor `pos`, so the start-of-combat Cheat Death / Everliving (Tycho) and the standing
 * direct-damage modifier (Los, its own <br>-separated sentence) are never co-triggered.
 * Returns true when it handled the buff. Reference data: docs/ship-skills.csv.
 */
function crossing(rowText: string, pos: number, ability: Ability): boolean {
    const detected = detectHpCrossingTrigger(rowText, pos);
    if (!detected) return false;
    ability.trigger = detected.trigger;
    // Safe overwrite: the crossing sentence carries no other parsed condition
    // (detectGrantConditions has no rule for "when HP drops below N%" — verified corpus-wide),
    // mirroring the damage-reaction below-X% gate attach below.
    ability.conditions = [
        {
            subject: 'hp-threshold',
            derivable: true,
            hpComparator: 'below',
            hpPercent: detected.hpBelowPct,
            hpSubject: 'self',
        },
    ];
    if (detected.oncePerCombat && ability.config.type === 'buff') {
        ability.config.oncePerCombat = true;
    }
    return true;
}

/**
 * Phase 4c PR 3 (Task 7): Hermes charged "If the target has less than N% HP, it grants Cheat
 * Death". On a match, attaches a derivable TARGET hp-threshold condition (evaluated against the
 * heal recipient's live HP) and narrows the parser's all-allies grant to the single heal target.
 * Caller gates this to the Cheat-Death family; sentence-scoped at the grant's anchor `pos`, so
 * the preceding repair/charge sentence (no target gate) never matches. Returns true when it
 * handled the buff. Reference data: docs/ship-skills.csv.
 */
function targetGate(rowText: string, pos: number, ability: Ability): boolean {
    const gate = detectTargetHpGate(rowText, pos);
    if (!gate) return false;
    // Safe overwrite: the Hermes Cheat-Death grant sentence ("If the target has less than N% HP,
    // it grants Cheat Death") carries no other parsed condition — detectGrantConditions has no
    // rule matching the "target has less than N% HP" phrasing, so ability.conditions is always
    // empty before this point — verified corpus-wide.
    ability.conditions = [
        {
            subject: 'hp-threshold',
            derivable: true,
            hpComparator: 'below',
            hpPercent: gate.hpBelowPct,
            hpSubject: 'target',
        },
    ];
    if (ability.target === 'all-allies') ability.target = 'ally';
    return true;
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

    // I6: computed once across ALL of the ship's (refit-resolved) skill rows so it applies to
    // every 'purge'-type ability this ship's kit emits, regardless of which slot's text produced
    // the purge (Lodolite's is on the charged slot; the declaring clause lives on the passive).
    const purgeStripsShield = getShipSkillRows(ship).some((row) =>
        detectPurgeStripsShield(row.text)
    );

    const bySlot = new Map<SkillSlot, PositionedAbility[]>();
    for (const row of getShipSkillRows(ship)) {
        const slot = slotFor(row.label);
        if (!slot) continue;
        const positioned = abilitiesFromText(row.text, slot, ship.type, purgeStripsShield);
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
            // Enemy-adjacency splash (Asphyxiator active Inferno III: "on the targeted enemy
            // and all enemies adjacent to it"). Charged Inferno's adjacency phrase belongs to a
            // separate Stasis sentence, so it resolves to null and the DoT stays 'enemy'.
            const adjacentScope = rowText ? adjacentEnemyScopeForName(rowText, entry.type) : null;
            if (adjacentScope) ability.target = adjacentScope;
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
        // ship-kit W3 (Hemlock, Task 9): Toxic Overflow's ENTIRE mechanic is the engine's
        // end-of-round Corrosion-spread (ledger #49) — the engine reads it off the per-victim TIMED
        // enemy-debuff store and REMOVES it on spread. That requires a NUMERIC duration (an undefined
        // duration classifies as an un-removable, always-active aura), but NOT a FINITE one: the game
        // rule is that Toxic Overflow lingers until it spreads, with no turn-based expiry. A finite
        // window would wrongly expire it before a late-arriving Corrosion could trigger the spread.
        // Stamp the non-expiring TOXIC_OVERFLOW_DURATION (Number.POSITIVE_INFINITY) here so it lands
        // as a REMOVABLE but non-expiring timed debuff. Targeted by name — Toxic Overflow is the sole
        // corpus status with this end-of-round conditional-removal behaviour.
        if (
            ability.config.type === 'debuff' &&
            ability.config.buffName === TOXIC_OVERFLOW &&
            ability.config.duration === undefined
        ) {
            ability.config.duration = TOXIC_OVERFLOW_DURATION;
        }
        const slot = slotForBuffSource(buff.skillSource);
        const rowText = getSkillRowForSlot(ship, slot)?.text ?? '';
        // SP-E, Task E4: Belladonna's "convert the Corrosion into Acidic Decay ... 1% per 10
        // Hacking" clause auto-fills a bare, ungated enemy-target 'debuff' named after the
        // conversion's TARGET family ("Acidic Decay") — the generic buff/debuff-name auto-fill
        // has no notion of "conversion", it just sees a named status in the clause. Recognise
        // that shape here (enemy-target + the row's own convert-dot clause names THIS buff) and
        // replace the auto-filled debuff with the real convert-dot ability, riding the live
        // on-ally-debuff-inflicted trigger — an EXPLICIT trigger assignment here, so it bypasses
        // (rather than widens) Oleander's target==='ally'-only gate a few lines below, which
        // stays untouched for its own buff-grant case. Folds in the paired crit-power duration
        // extension (parseCritPowerExtend; the standalone extend-dot for this row is suppressed
        // above in abilitiesFromText to avoid double-applying it).
        const convertDot = target === 'enemy' && rowText ? detectConvertDot(rowText) : undefined;
        if (convertDot && convertDot.buffName === buff.buffName) {
            ability.type = 'convert-dot';
            ability.config = {
                type: 'convert-dot',
                fromDotType: convertDot.fromDotType,
                buffName: convertDot.buffName,
                chanceFromStat: { stat: 'hacking', pctPerPoint: convertDot.pctPerPoint },
                extendTurns: 1,
                extendChanceFromCritPower: true,
            };
            ability.trigger = 'on-ally-debuff-inflicted';
            ability.target = 'enemy';
            const convertPos = findBuffNamePos(rowText, buff.buffName);
            pushToSlot(bySlot, slot, [{ ability, pos: convertPos >= 0 ? convertPos : MAX_POS }]);
            return;
        }
        // Attach a gating condition parsed from the buff's clause (e.g. Thresh's
        // "When targeting a Defender, … gains Crit Power Up II" → enemy-type Defender).
        const conditions = rowText ? detectGrantConditions(rowText, buff.buffName) : [];
        if (conditions.length) {
            ability.conditions = conditions;
        }
        // Reactive trigger (crit / start-of-round / bomb-detonate) detected on this buff's
        // clause: route through the engine's trigger machinery instead of a gating condition.
        // The trigger IS the gate, so drop the now-redundant self-crit condition (start-of-round
        // and bomb-detonate phrasings produce no condition from detectGrantConditions). Any other
        // conditions (e.g. an enemy-type co-gate) are preserved.
        let reactiveTrigger = rowText ? detectReactiveTrigger(rowText, buff.buffName) : undefined;
        // Overload lifecycle guard: a kill never GRANTS a recurring/accumulating buff — it only
        // REMOVES it (the kill phrasing belongs to the remove-self-buff path, parsed separately by
        // parseSelfBuffRemovals). The Marauder "gains <buff> every turn … loses it on kill" shape
        // makes Overload's name appear in BOTH the per-turn grant clause and the kill-removal
        // clause; resolveBuffClause can pick up the kill phrasing and mis-trigger the accumulating
        // GRANT on on-enemy-destroyed (Mangler/Ravager), which would gate the every-turn accrual
        // behind a kill. Strip a kill trigger from an accumulating (recurring) grant so it keeps its
        // per-round accumulation; the legitimate recurring-grant triggers (Asphyxiator
        // start-of-round, Ruiner on-enemy-repaired) are unaffected, and finite grants (Marauder Rage
        // on-kill) keep their kill trigger.
        const isAccumulatingGrant =
            ability.config.type === 'buff' && ability.config.duration === 'recurring';
        if (reactiveTrigger === 'on-enemy-destroyed' && isAccumulatingGrant) {
            reactiveTrigger = undefined;
        }
        // Position anchor: index of the buff name in the row text (order-irrelevant for
        // buff/debuff abilities, but placed consistently so ties resolve by insertion order).
        // Word-boundary-aware (Finding B4) so a short buff name isn't mistaken for a substring
        // of a longer word (Panguan's "Stealth" inside "Stealthed").
        const pos = rowText ? findBuffNamePos(rowText, buff.buffName) : -1;
        // "for N hit(s)" — a hit-counted lifecycle (see the buff config's `hits`). Position-
        // scoped on this buff's own name so a sibling clause's turn duration is unaffected, and
        // vice versa: Sansi's charge grants Taunt for 1 turn AND Barrier for 1 hit in one sentence.
        // Anchor imprecision: findBuffNamePos returns the FIRST word-boundary match of the name,
        // so a lookup for "Barrier" can land inside a later-appearing "Barrier Recharging" if that
        // longer name is MENTIONED before this buff is GRANTED (Panon: "does not have Barrier
        // Recharging, it gains Barrier for 1 turn…"). Harmless today — every such window (Panon's
        // included) contains no duration phrase before its own sentence boundary — but it is a
        // silent false-negative mechanism: a future row phrased that way with a real "for N hits"
        // grant would be denied its hit count. Not fixed here; the anchor itself would need to
        // change.
        if (ability.config.type === 'buff' && rowText && pos >= 0) {
            const hits = detectHitCount(rowText, pos);
            if (hits !== undefined) ability.config.hits = hits;
        }
        // Epic PR4: a split-sentence "… also gains <Buff>" continuing an IMMEDIATELY PRECEDING
        // "At the start of the round, this Unit gains …" sentence (Nayra p2's Offensive Affinity
        // Override, Isha p1/p2's Defensive Affinity Override) has no round-start phrase of its
        // OWN clause, so detectReactiveTrigger above misses it — fall back to the continuation
        // detector before falling through to the crossing/target-gate/damage-reaction chain.
        if (reactiveTrigger === undefined && rowText && pos >= 0) {
            reactiveTrigger = detectRoundStartContinuationTrigger(rowText, pos);
        }
        // Oleander: an ally-target buff granted "when an ally inflicts a debuff" rides
        // on-ally-debuff-inflicted, routed to the inflicting ally via eventCtx.damagedAllyId. Gated on
        // target==='ally' + type 'buff' so Provider's enemy-target Crit Rate Down II counter-debuff in the
        // same phrasing family stays on-cast (a deferred deep one-off).
        if (
            reactiveTrigger === undefined &&
            target === 'ally' &&
            ability.config.type === 'buff' &&
            rowText
        ) {
            reactiveTrigger = detectAllyInflictsGrantTrigger(rowText, buff.buffName);
        }
        // Harvester p2: "When an allied Unit is destroyed, this Unit gains 1 extra end of round
        // action and Speed Up I for 6 turns" — the extra-action grant resolves on-ally-destroyed
        // via parseExtraAction, but Speed Up I is a separate (plain) buff ability that otherwise
        // falls through to the on-cast default. Position-scoped on THIS buff's own sentence
        // (rather than buffName-scoped) so a co-located death-trigger phrase is only inherited
        // when it actually shares the sentence — an unrelated buff elsewhere in the row text is
        // unaffected.
        //
        // Reuse the same Overload-lifecycle guard as detectReactiveTrigger above
        // (isAccumulatingGrant): Sokol's "gains 1 stack of Blast every turn and grants one extra
        // end of round action upon a kill, once per round" shares ITS OWN sentence with both the
        // EXTRA_ACTION_RE phrase and the enemy-death phrase, so detectExtraActionCoTrigger alone
        // would co-trigger the recurring/accumulating Blast stack onto on-enemy-destroyed — gating
        // its every-turn accrual behind a kill, the exact regression class the guard above exists
        // to prevent. isAccumulatingGrant must gate this branch too, since it runs after (and was
        // never re-applied here).
        if (
            reactiveTrigger === undefined &&
            !isAccumulatingGrant &&
            ability.config.type === 'buff' &&
            rowText &&
            pos >= 0
        ) {
            reactiveTrigger = detectExtraActionCoTrigger(rowText, pos);
        }
        if (reactiveTrigger) {
            ability.trigger = reactiveTrigger;
            ability.conditions = ability.conditions.filter(
                (c) =>
                    c.subject !== 'self-crit' &&
                    // Phase 3 PR-I (COLLISION-SCOPE / "PR-E Provider lesson"): drop the now-
                    // redundant manual enemy-buff condition once the clause is promoted to the
                    // on-enemy-buffed trigger — the trigger IS the gate. Without this, Nuqtu's
                    // Terran Bolster III would carry BOTH the reactive trigger AND the stale
                    // manual condition (harmless today since a manual condition with no
                    // manualCount defaults to "met", but leaving it is misleading and the
                    // brief calls it out explicitly).
                    !(reactiveTrigger === 'on-enemy-buffed' && c.subject === 'enemy-buff') &&
                    // SP-G G4 (same COLLISION-SCOPE pattern): "On inflicting a debuff, gains X"
                    // is double-classified — detectReactiveTrigger promotes it to on-debuff-inflicted
                    // (APPLYING_DEBUFF_RE) AND detectGrantConditions' appliesDebuffGate emits a
                    // redundant enemy-debuff condition from the SAME phrase. The trigger already
                    // proves a debuff was inflicted, so drop the enemy-debuff condition. Leaving it
                    // is not harmless here: enemy-debuff is `derivable:true`, so at reactive drain it
                    // gates against the enemy's LIVE debuff store. That store is populated on the
                    // aggregate DPS path (the shared enemy dummy carries the inflicted DoT) but NOT
                    // on the positional path (DoTs live in per-victim stores), so the stale condition
                    // silently blocks Butcher's Marauder Rage II in real team battles — a team-symmetry
                    // violation. (overloadLifecycle.test.ts test 3b pins the positional path.)
                    !(reactiveTrigger === 'on-debuff-inflicted' && c.subject === 'enemy-debuff')
            );
            // Oleander's "once per ally per round" RoT grant: a DEDICATED cap (not the plain
            // oncePerRound flag) so a different ally inflicting a debuff still procs even if
            // another ally already consumed the cap this round.
            if (
                reactiveTrigger === 'on-ally-debuff-inflicted' &&
                rowText &&
                ONCE_PER_ALLY_PER_ROUND_RE.test(rowText)
            ) {
                ability.oncePerRoundPerAlly = true;
            }
            // AEGIS (SP-F F2): "grants Defense Up II ... when an ally ... has their Shield
            // destroyed" names no explicit receiver in its own object clause (detectGrantScope's
            // receiver-less-grant default resolves it to 'all-allies') — the real receiver is the
            // ally named only in the (stripped-for-scope-detection) reactive trigger clause.
            // Override to 'ally' so reactiveRecipients routes the grant to the ally whose shield
            // was destroyed (eventCtx.damagedAllyId), not the whole team.
            if (reactiveTrigger === 'on-ally-shield-destroyed') {
                ability.target = 'ally';
            }
        } else if (
            // Phase 4c PR 3 (Task 7): "when HP drops/falls below N%" buff-grant reactives
            // (Tycho/Shelter/Los/Kafa/Redeemer) ride the LIVE on-hp-threshold-crossed trigger.
            // Checked BEFORE the damage-reaction detector and short-circuiting: a crossing grant is
            // never also target-gated, and the (drops|falls) verb excludes the static "while below
            // N% HP" damage-reaction phrasing, so the two paths are mutually exclusive by corpus.
            rowText &&
            pos >= 0 &&
            crossing(rowText, pos, ability)
        ) {
            // crossing grant handled in the helper; nothing further to do for this buff.
        } else if (
            // Phase 4c PR 3 (Task 7): Hermes charged "If the target has less than N% HP, it grants
            // Cheat Death" — the clause names "the target", so spec PR 3 narrows the grant to the
            // heal target. Only the Cheat-Death family is target-gated; the preceding repair/charge
            // sentence has no target gate, so detectTargetHpGate returns undefined there.
            rowText &&
            pos >= 0 &&
            CHEAT_DEATH_BUFFS.has(buff.buffName) &&
            targetGate(rowText, pos, ability)
        ) {
            // target-gated Cheat Death handled in the helper; nothing further to do for this buff.
        } else {
            // Phase 4c PR 1 (Task 8): a SELF-subject damage-reaction grant/infliction ("When
            // directly damaged, … inflicts Speed Down I"; Guardian's "When this Unit is
            // critically hit, it gains …") rides the LIVE on-attacked trigger (+ crit filter)
            // instead of registering as an unconditional per-round aura (a phantom — the
            // reactive partition routes it OUT of registerActorAbilityStatuses and into the
            // executor, which lands enemy-target counter-debuffs on the attacking enemy via
            // eventCtx.counterTargetId). Sentence-scoped at the buff's own anchor, so grants
            // in other sentences of the same row are never co-triggered.
            const reaction =
                rowText && pos >= 0 ? detectDamageReactionTrigger(rowText, pos) : undefined;
            if (reaction) {
                ability.trigger = reaction.trigger;
                if (reaction.critFilter) ability.triggerCritFilter = reaction.critFilter;
                // Ally-role words in the trigger phrase (Graphite "when an ally attacker
                // or debuffer is directly damaged") → CATEGORY-semantic roleFilter; the
                // engine's on-ally-attacked listener fires only when the damaged ally's
                // role matches one of them.
                if (reaction.roleFilter) ability.roleFilter = reaction.roleFilter;
                // Ally-damage-reaction BUFF grants land on the DAMAGED ally (spec-locked):
                // Refine's recipient-less "grants Inc. Damage Down I" and Graphite's
                // "grants the ally Repair Over Time III" both resolve via
                // eventCtx.damagedAllyId, which the executor only honors for 'ally'-target
                // intents — so force the recipient here (the parser's recipient-less scope
                // resolution otherwise lands on 'all-allies'/'self'). DEBUFFS keep their
                // enemy-side target (Guardian's Provoke "to that enemy") — counter-routing
                // rides eventCtx.counterTargetId instead.
                if (reaction.trigger === 'on-ally-attacked' && ability.type === 'buff') {
                    ability.target = 'ally';
                }
                // Drop SELF-REFERENTIAL status conditions: detectGrantConditions' rule 5
                // (Taunt/Provoke targeting gates) matches the GRANTED buff's own name when
                // the reaction sentence applies that very status (Guardian "apply Provoke
                // … to that enemy" → a stale manual self-debuff-Provoke gate from the
                // pre-trigger era). The sentence carries no real Provoke-standing gate —
                // the reaction trigger IS the gate — so the artifact is removed. A genuine
                // status gate naming a DIFFERENT buff than the granted one would survive
                // (no corpus reaction sentence has one today).
                ability.conditions = ability.conditions.filter(
                    (c) =>
                        !(
                            (c.subject === 'self-debuff' || c.subject === 'enemy-buff') &&
                            c.buffName === buff.buffName
                        )
                );
                // "while below N% HP" gate on the reaction sentence (Makoli Disable): attach a
                // derivable self hp-threshold condition so the executor evaluates the gate at
                // drain time (live selfHpPct from Task 6) rather than firing on every hit.
                if (reaction.hpBelowPct !== undefined) {
                    // Safe overwrite: on a damage-reaction sentence the below-X% gate is the
                    // ONLY condition — detectGrantConditions has no rule matching these phrasings
                    // (verified corpus-wide), so this cannot clobber a real gate set earlier.
                    // If a future ship pairs a reaction sentence with another parsed condition,
                    // merge the arrays instead of overwriting.
                    ability.conditions = [
                        {
                            subject: 'hp-threshold',
                            derivable: true,
                            hpComparator: 'below',
                            hpPercent: reaction.hpBelowPct,
                            hpSubject: 'self',
                        },
                    ];
                }
            } else if (target === 'enemy' && rowText && pos >= 0) {
                // Phase 3 PR-F: Amartya's "when an enemy defender is directly repaired, …
                // inflicts 1 stack of Defense Shred on that defender" — NOT a damage reaction
                // (detectDamageReactionTrigger above returns undefined), so it falls through
                // here. Enemy-target-only: Ruiner's SAME-family "on any enemy performing a
                // repair" phrasing never reaches this branch because it names a DoT (Bomb),
                // which mergeBuff never sees (isDoTBuffName excludes it — handled separately by
                // the passive DoT-reaction loop below).
                const enemyRepairedReaction = detectEnemyRepairedTrigger(rowText, pos);
                if (enemyRepairedReaction) {
                    ability.trigger = enemyRepairedReaction.trigger;
                    // "That defender" = the REPAIRED RECIPIENT, not the repairer — route via
                    // eventCtx.repairedEnemyIds (fans out over every healed enemy) instead of
                    // the default single counterTargetId route.
                    if (enemyRepairedReaction.recipientTargeted) {
                        ability.repairedRecipientTargeted = true;
                    }
                }
            }
        }
        // Epic PR4 (start-of-combat one-time grant family): a still-on-cast, NON-STACKING buff
        // whose OWN clause reads "At the start of combat, this Unit gains …" (Crucialis's Atlas
        // Coordination I/II, Tycho's Cheat Death + Everliving Regeneration I/II) is relabeled
        // 'pre-combat' — a data-model/annotation correction only. 'pre-combat' is deliberately
        // excluded from LIVE_TRIGGERS, so this is INERT at the engine level: the ability stays on
        // the normal cast path, where registerActorAbilityStatuses' duration/slot-based
        // classification already seeds a finite-duration passive buff exactly once at round start
        // (seedPassiveTimedStatuses) and treats a 'recurring'-duration one (Cheat Death) as a
        // standing aura — see src/utils/combat/engine.ts. EXCLUDES Meatshield's "gains 3 stacks of
        // Protection" (stackTrigger:'per-round', isStackable): that ability still climbs every
        // round under the parser's generic "gains N stacks" default, so it is NOT actually a
        // one-time grant yet — relabeling only the trigger without fixing the stacking default
        // would be actively misleading (deferred to a follow-up PR; see the epic report).
        const isAccumulatingBuff =
            ability.config.type === 'buff' &&
            !!ability.config.stackTrigger &&
            !!ability.config.isStackable;
        if (ability.trigger === 'on-cast' && rowText && !isAccumulatingBuff) {
            const preCombatTrigger = detectPreCombatBuffTrigger(rowText, buff.buffName);
            if (preCombatTrigger) ability.trigger = preCombatTrigger;
            // Meiying p2: "At the start of combat and every turn, this Unit gains Stealth for 2
            // turns" — detectPreCombatBuffTrigger already excludes this clause from the one-time
            // 'pre-combat' relabel above (its own "every turn" exclusion), but nothing previously
            // promoted it to the recurring 'start-of-turn' trigger it actually needs, so it fell
            // through to the default 'on-cast'. Pure reuse of the already-exported, already
            // position-scoped detectEveryTurnTrigger (shares EVERY_TURN_RE with the heal/shield
            // cascade at line ~1790) — no new detector/regex/trigger-literal required. Guarded by
            // the same !isAccumulatingBuff check above, so per-round stacking auras
            // (Overload/Blast/Warding-Screen) are untouched.
            else {
                const everyTurnTrigger = detectEveryTurnTrigger(rowText, pos);
                if (everyTurnTrigger) ability.trigger = everyTurnTrigger;
            }
        }
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
        // Curator: "When an enemy uses their charged skill, … inflicts Block Buff" is already
        // emitted as an on-enemy-charged-cast debuff by parseEnemyChargedCastReaction (in
        // abilitiesFromText). The generic auto-fill would ALSO extract that name and emit a
        // SECOND, ungated on-cast debuff that fires on the reacting ship's OWN turn regardless of
        // any enemy charged cast — a double-application bug. Skip a debuff name already claimed by
        // the enemy-charged-cast reaction on its own slot's clause (same-name/same-slot scope: the
        // corpus carries only Curator with this trigger + a debuff, and it has no unrelated
        // Block-Buff clause). Mirrors the isAccumulateDetonateEffect skip above.
        const eccSlotText =
            getSkillRowForSlot(ship, slotForBuffSource(buff.skillSource))?.text ?? '';
        const eccReactions = parseEnemyChargedCastReaction(eccSlotText);
        if (
            eccReactions?.some(
                (a) =>
                    a.config.type === 'debuff' &&
                    'buffName' in a.config &&
                    a.config.buffName === buff.buffName
            )
        ) {
            continue;
        }
        // Player-side grants carry granular effectTarget (self/ally/all-allies, wired above);
        // enemy debuffs now do too ('enemy' vs 'all-enemies' — detectEnemyGrantScope). Defaults
        // to 'enemy' for round-trip debuffs that predate the effectTarget field.
        let enemyTarget: AbilityTarget = buff.effectTarget ?? 'enemy';
        // Ship-kit W8 (Task 5): Selenite p3's round-start "the highest attack enemy is applied
        // with Concentrate Fire" re-targets from the plain 'enemy' default to 'enemy-highest-
        // attack' (the selector already resolves live at applyAbilities.ts, used by gear procs —
        // this wires an existing selector, not a new one). Sentence/position-scoped on this buff's
        // own name anchor (mirrors parseHighestSpeedEnemyTarget's damagePos scoping above) and
        // gated on the plain 'enemy' scope only, so a co-located all-enemies/adjacent debuff in
        // the same row is unaffected. The other seven Concentrate Fire ships in the corpus
        // (Huanying, Judge, Lodolite, Stalwart, Valkyrie, Vanguard, Yuyan) carry no "highest
        // attack enemy" phrase, so the narrow regex leaves them at the plain 'enemy' target.
        if (enemyTarget === 'enemy') {
            const slotForThisBuff = slotForBuffSource(buff.skillSource);
            const rowTextForThisBuff = getSkillRowForSlot(ship, slotForThisBuff)?.text ?? '';
            const buffPos = rowTextForThisBuff
                ? findBuffNamePos(rowTextForThisBuff, buff.buffName)
                : -1;
            if (
                rowTextForThisBuff &&
                buffPos >= 0 &&
                parseHighestAttackEnemyTarget(rowTextForThisBuff, buffPos)
            ) {
                enemyTarget = 'enemy-highest-attack';
            }
        }
        mergeBuff(buff, enemyTarget);
    }

    // Reaction-inflicted DoTs on the PASSIVE row: Warden/Shepherd's "When directly damaged, this
    // Unit inflicts Corrosion I … on that enemy" (on-attacked) and Ruiner's "inflicts Bomb II for
    // 2 turns on any enemy performing a repair" (on-enemy-repaired). DoT-named effects are
    // excluded from BOTH buff auto-fill (isDoTBuffName) and the active/charge DoT merge above
    // (which skips passive sources), so without this pass they emit nothing at all.
    //
    // These build as REAL `dot` abilities. They used to be name-only `debuff` statuses (empty
    // parsedEffects) under a Phase 4c PR 1 §3.5 decision: back then only the singular focus-dummy
    // enemy carried DoT containers, so a dot here would have phantom-credited ticks against an
    // enemy ATTACKER the sim never resolved. That premise is gone — enemies are positioned actors
    // with their own corrosion/inferno/bomb containers which tick and burst on their own turns
    // (engine.ts `applyPositionedTimedBurst` / `tickDoTs`). Keeping them as statuses meant a
    // reaction-applied Bomb that never counted down, never exploded and never dealt damage
    // (user-reported 2026-07-31: Ruiner planting Bomb II on a self-repairing Heliodor).
    //
    // Routing: the reactive `dot` executor resolves its victim from `eventCtx.victimId`, falling
    // back to `counterTargetId` — which is what BOTH of these triggers stamp (the attacker /
    // the repairer). See triggers.ts's `dot` branch.
    const passiveRowText = getSkillRowForSlot(ship, 'passive')?.text ?? '';
    if (passiveRowText) {
        // Source tag is irrelevant here (it only drives stackTrigger classification, which a
        // reaction-sentence DoT infliction never carries) — 'passive1' is a neutral stand-in.
        for (const eff of parseSkillEffects(passiveRowText, 'passive1')) {
            if (eff.target !== 'enemy' || !DOT_TIER_MAP[eff.buffName]) continue;
            const pos = findBuffNamePos(passiveRowText, eff.buffName);
            const reaction =
                pos >= 0 ? detectDamageReactionTrigger(passiveRowText, pos) : undefined;
            // Phase 3 PR-F: Ruiner's "This Unit inflicts Bomb II … on any enemy performing a
            // repair, once per round per enemy" is the SAME name-only-DEBUFF shape as the
            // Warden/Shepherd damage-reaction case above, but the reaction is an on-enemy-repaired
            // one instead of on-attacked — checked only when the damage-reaction detector found
            // nothing, so the two phrasing families stay mutually exclusive.
            const enemyRepairedReaction =
                !reaction && pos >= 0 ? detectEnemyRepairedTrigger(passiveRowText, pos) : undefined;
            if (!reaction && !enemyRepairedReaction) continue;
            const dotReactionConditions: Condition[] =
                reaction?.hpBelowPct !== undefined
                    ? [
                          {
                              subject: 'hp-threshold',
                              derivable: true,
                              hpComparator: 'below',
                              hpPercent: reaction.hpBelowPct,
                              hpSubject: 'self',
                          },
                      ]
                    : [];
            const dotInfo = DOT_TIER_MAP[eff.buffName];
            const ability: Ability = {
                id: nextId(),
                type: 'dot',
                target: 'enemy',
                trigger: reaction?.trigger ?? enemyRepairedReaction!.trigger,
                ...(reaction?.critFilter ? { triggerCritFilter: reaction.critFilter } : {}),
                // "once per round per enemy" (Ruiner) — a DIFFERENT repairing enemy still procs.
                // Tested against the whole passive row rather than a sentence scope: the phrase
                // is corpus-unique to Ruiner (docs/ship-skills.csv), so there is no cross-talk
                // risk from a broader match.
                ...(enemyRepairedReaction && ONCE_PER_ROUND_PER_ENEMY_RE.test(passiveRowText)
                    ? { oncePerRoundPerEnemy: true }
                    : {}),
                conditions: dotReactionConditions,
                config: {
                    type: 'dot',
                    dotType: dotInfo.type,
                    tier: dotInfo.tier,
                    stacks: eff.stacks ?? 1,
                    // Same 2-turn default the other reactive-DoT builder blocks use (Crocus
                    // on-ally-crit-dot, Pestilence on-enemy-cleansed) when the clause omits one.
                    duration: typeof eff.duration === 'number' ? eff.duration : 2,
                },
                autoFilled: true,
            };
            pushToSlot(bySlot, 'passive', [{ ability, pos }]);
        }
    }

    // Control-twin gating parity (epic PR2): a `type:'control'` ability is emitted
    // ADDITIVELY alongside the named debuff/buff that actually performs the status
    // (parseControlInflicts, above) but is always constructed on-cast/ungated — it does
    // not see whatever trigger/conditions the named twin resolved to (a reactive trigger
    // from detectDamageReactionTrigger/detectReactiveTrigger, or a gating condition from
    // detectGrantConditions/a manual clause gate). Makoli: the Disable DEBUFF correctly
    // resolves to on-attacked + a below-40%-HP condition, but its control{disable} twin
    // stayed on-cast/[] — if the engine ever executed it as constructed, Disable's
    // control-applied event would fire on every cast regardless of the reaction gate.
    //
    // The engine's ONLY consumer of `type:'control'` is the on-cast loop in
    // controlAbilitiesFromSkill (src/utils/abilities/applyAbilities.ts), which filters
    // strictly to `trigger === 'on-cast'` — mirroring chargeAbilitiesFromSkill /
    // extraActionsFromSkill, there is no separate reactive-trigger execution path for
    // control abilities. So the twin's resolved trigger decides which fix applies:
    //   - twin trigger IS 'on-cast' (Crocus/Nayra: a static gating condition, e.g. an
    //     enemy-debuff count or "target repaired this round"): inherit the twin's
    //     conditions onto the control ability. It is STILL processed by the cast-path
    //     loop, and the shared gateFiringAbilities condition gate (which runs over every
    //     cast ability uniformly, control included) now suppresses control-applied on the
    //     same cast where the named status itself would not fire.
    //   - twin trigger is REACTIVE (Makoli/Flamel/Guardian/Meiying: on-attacked,
    //     on-ally-attacked, on-enemy-destroyed, …): inheriting that trigger would make the
    //     control ability permanently unconsumed (no reactive control-applied path
    //     exists), i.e. a dead, mislabeled entry forever. Drop the control ability outright
    //     instead — the named debuff/buff twin remains the sole model of the effect, and no
    //     spurious on-cast control-applied fires.
    for (const positioned of bySlot.values()) {
        for (let i = positioned.length - 1; i >= 0; i--) {
            const ability = positioned[i].ability;
            if (ability.type !== 'control' || ability.config.type !== 'control') continue;
            const tag = CONTROL_EFFECT_DISPLAY_NAME[ability.config.effect];
            const twinType = ability.config.effect === 'taunt' ? 'buff' : 'debuff';
            const twin = positioned.find(
                (p) =>
                    p.ability !== ability &&
                    p.ability.config.type === twinType &&
                    p.ability.config.buffName === tag
            );
            if (!twin) continue;
            if (twin.ability.trigger === 'on-cast') {
                ability.conditions = twin.ability.conditions;
            } else {
                positioned.splice(i, 1);
            }
        }
    }

    // Sort each slot's abilities by their text position (stable sort preserves insertion
    // order for ties). This is the ONLY sort — construction order inside abilitiesFromText
    // is preserved during condition/scaling attachment and only reordered here.
    const slots: Skill[] = [];
    for (const [slot, positioned] of bySlot) {
        if (!positioned.length) continue;
        // Runs over EVERY producer's output (abilitiesFromText, the DoT/buff auto-fill merges,
        // the passive damage-reaction pass) while the `pos` anchors are still available — each
        // slot's anchors index that slot's own row text.
        markPatternScoped(positioned, getSkillRowForSlot(ship, slot)?.text ?? '');
        positioned.sort((a, b) => a.pos - b.pos);
        slots.push({ slot, abilities: positioned.map((p) => p.ability) });
    }

    // §4.5 Akula exception: check ALL skill rows for the don't-break-Stasis clause and
    // fold the result onto the ShipSkills object. Only the refit-active passive applies in
    // game, but getShipSkillRows already resolves that — scan only the rows that were used
    // for ability building (the same rows iterated above, now re-queried via getShipSkillRows).
    const doesntBreakStasis = getShipSkillRows(ship).some((row) =>
        parseDoesntBreakStasis(row.text)
    );

    const chargeLossImmune = getShipSkillRows(ship).some((row) => parseChargeLossImmune(row.text));

    // Ship-kit correctness backlog: check ALL skill rows for the "ignores Taunt and Provoke"
    // clause (forced-targeting immunity), same refit-resolved row set as the flags above.
    const ignoresForcedTargeting = detectIgnoresForcedTargeting(
        ...getShipSkillRows(ship).map((row) => row.text)
    );

    // Ship-kit W6: "This Unit ignores Stealth effects" (Lodolite) — same refit-resolved rows.
    const ignoresStealth = detectIgnoresStealth(...getShipSkillRows(ship).map((row) => row.text));

    return {
        slots,
        ...(doesntBreakStasis ? { doesntBreakStasis: true } : {}),
        ...(chargeLossImmune ? { chargeLossImmune: true } : {}),
        ...(ignoresForcedTargeting ? { ignoresForcedTargeting: true } : {}),
        ...(ignoresStealth ? { ignoresStealth: true } : {}),
    };
}
