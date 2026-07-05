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
    parseShieldStrip,
    parseConditionalDamage,
    parseEnemyEffectDamageBonus,
    parseConditionalStasisApplied,
    parseChargeGain,
    parseAllyChargeOnEnemyDeath,
    parseAllyChargeGrant,
    parseExtraAction,
    detectGrantConditions,
    detectReactiveTrigger,
    detectPreCombatBuffTrigger,
    detectPreCombatShieldTrigger,
    detectDamageReactionTrigger,
    detectHpCrossingTrigger,
    detectTargetHpGate,
    parseHpThresholdCondition,
    parseExtendDoT,
    parseCritPowerExtend,
    parseDebuffDurationReduction,
    parseAllyCritDot,
    detectCritRepairTrigger,
    detectDebuffInflictedTrigger,
    detectStasisAppliedTrigger,
    detectCheatDeathActivatedTrigger,
    detectDestroyedTrigger,
    detectEnemyCleanseTrigger,
    detectEnemyPurgedTrigger,
    detectAllyPurgedTrigger,
    detectEndOfRoundPurgeTrigger,
    detectStartOfRoundTrigger,
    detectEndOfRoundDamageTrigger,
    detectRoundStartContinuationTrigger,
    detectKilledByDirectDamageTrigger,
    detectMostBuffsTarget,
    detectRepairedThisRoundCondition,
    PURGE_MORE_RE,
    parseControlInflicts,
    detectAllyCritTrigger,
    parseNoCrit,
    parseDoesntBreakStasis,
    parseChargeLossImmune,
    parseChargeRemoval,
    parseSelfBuffRemovals,
    parseEnemyChargedCastReaction,
    REMOVE_CHARGE_RE,
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
} from '../skillTextParser';
import {
    buildDoTAutoFill,
    buildSkillBuffAutoFill,
    DOT_TIER_MAP,
} from '../calculators/skillBuffAutoFill';
import { CHEAT_DEATH_BUFFS } from '../combat/cheatDeathBuffs';
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
        // Epic PR4 (round-boundary trigger consistency): a base damage ability whose OWN
        // sentence carries "at the start of the round" (Judge, Chakara's "Then," continuation)
        // or "at the end of the round" (Incinerator, Rhodium p2's co-located 80%-no-crit hit)
        // rides that LIVE trigger instead of the on-cast default — the reactive damage executor
        // (triggers.ts cfg.type==='damage' branch) and, for start-of-round specifically, the
        // partition machinery removing it from the old passive-payload-hit cast-time fold
        // (playerTurn.ts) both already exist; this ability just needs the correct label.
        const damageTrigger: AbilityTrigger =
            detectStartOfRoundTrigger(text, damagePos) ??
            detectEndOfRoundDamageTrigger(text, damagePos) ??
            detectRoundStartContinuationTrigger(text, damagePos) ??
            'on-cast';
        out.push({
            ability: {
                id: nextId(),
                type: 'damage',
                target: 'enemy',
                trigger: damageTrigger,
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

    // Combat G PR2 (Centurion): "When this Unit OR AN ADJACENT ALLY is directly damaged, this
    // Unit retaliates dealing X%." The retaliate <unit-damage> tag omits "damage" → parseSkillDamage
    // returns 0 → NOT an on-cast base-damage component, so it cannot ride the re-type path above.
    // Push it directly as TWO counter abilities: a self counter (on-attacked, any direct hit) +
    // an adjacent-ally counter (on-ally-attacked, reusing the existing requireDamagedAllyAdjacent
    // gate). The per-ability once-per-attack guard collapses multi-hit; self/ally are mutually
    // exclusive per attack (single-focus `attacked` emit), so exactly one retaliation fires. If
    // multi-victim `attacked` emission is ever added, switch the executor guard to `${ownerId}` to
    // dedupe across these two abilities. The co-located "start of combat … attack per adjacent
    // ally" buff parses independently and is unaffected.
    if (slot === 'passive' && counter && counter.allySubject) {
        const hits = parseHitCount(text);
        const counterConfig = {
            type: 'counter' as const,
            multiplier: counter.multiplier,
            ...(hits !== undefined ? { hits } : {}),
        };
        const pos = damagePos >= 0 ? damagePos : MAX_POS;
        out.push({
            ability: {
                id: nextId(),
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

    // Control inflictions: emit a `type:'control'` ability per recognized effect (stasis,
    // provoke, taunt, concentrate-fire, disable). ADDITIVE — the parallel named status
    // (parseSkillEffects → applyTimedAbilityStatus) still performs the actual lockout/
    // forced-targeting; the control ability only sources the `control-applied` event
    // (reaction substrate, e.g. Defiant's shield-on-Stasis). Carries no conditions (see the
    // gated-control caveat below); no damage/modifier → DPS pipeline ignores it.
    for (const ctrl of parseControlInflicts(text)) {
        out.push({
            ability: {
                id: nextId(),
                type: 'control',
                target: ctrl.side, // 'enemy' for inflicted, 'self' for Taunt
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
              detectCritRepairTrigger(text, healPos) ??
              // Yazid: a repair anchored in the "when Cheat Death activates" sentence rides the
              // on-cheat-death-activated reactive trigger (self-scoped; position-scoped). Checked
              // for heals AND shields (the follow-on is a repair, but keep the path symmetric).
              detectCheatDeathActivatedTrigger(text, healPos) ??
              // Salvation: a repair anchored in the "when this Unit is destroyed … repairs … to
              // all allies" sentence rides the on-destroyed reactive trigger (self-death scoped;
              // position-scoped). The parser only emits this all-allies heal when that shape is
              // present (HEAL_DISQUALIFY_RE lookahead), so the trigger fires it ONLY on death.
              detectDestroyedTrigger(text, healPos) ??
              // Sefuba p1/p2: a self-repair anchored in the "when this Unit purges … enemy"
              // sentence rides the on-enemy-purged reactive trigger (position-scoped).
              detectEnemyPurgedTrigger(text, healPos) ??
              // Salvation p3: a repair anchored in the "when a buff is purged from an ally"
              // sentence rides the on-ally-purged reactive trigger (position-scoped).
              detectAllyPurgedTrigger(text, healPos) ??
              (h.kind === 'shield'
                  ? (detectDebuffInflictedTrigger(text, healPos) ??
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
        const healPlain = stripTags(text).replace(/<br\s*\/?>/gi, '. ');
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
                    healSentence.toLowerCase().includes(eff.buffName.toLowerCase())
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
                      role
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
        let healScaling: { conditionIndex: number; perUnit: number } | undefined;
        if (h.scaling) {
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
        // Purifier (Phase 3 PR-A): a PASSIVE-slot "cleanses N debuff when directly damaged" cleanse
        // rides on-attacked — the cleanse builder previously derived ONLY the crit-repair reaction,
        // so a direct-damage cleanse fell through to on-cast. Gated to passive (an active/charged
        // cleanse is on-cast) and position-scoped, so only a passive cleanse whose own sentence
        // carries the reaction phrase flips (corpus: Purifier alone — Makoli/Nosorog/Nyxen's
        // cleanses sit in active/charged slots or a different sentence; Cultivator's is on-own-cleanse).
        const reactiveTrigger =
            detectCritRepairTrigger(text, cleansePos) ??
            (slot === 'passive' &&
            detectDamageReactionTrigger(text, cleansePos)?.trigger === 'on-attacked'
                ? ('on-attacked' as const)
                : undefined);
        const cleanseTarget = flipBareSupportTarget(c.target, c.explicitTarget, slot, mult > 0);
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
    // → on-attacked. Rhodium end-of-round + Faust killed-by-direct-damage detectors are added
    // in later tasks. A passive purge with NO detected trigger is NOT emitted (Sefuba's chain
    // stays on PURGE_MORE_RE below; Zeolite's "when dealing damage to a Defender" stays
    // deferred). Purge is enemy-only (no support-flip).
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
                  detectKilledByDirectDamageTrigger(text, purgePos)); // Faust
        const trigger: AbilityTrigger | undefined =
            slot === 'active' || slot === 'charged' ? 'on-cast' : passiveTrigger;
        if (!trigger) continue; // passive purge with no recognized trigger → not emitted
        // Most-buffs target override: applies regardless of slot (future-proofs active/charged
        // most-buffs purges; harmless for current corpus where only Rhodium passive carries it).
        const target: AbilityTarget = detectMostBuffsTarget(text, purgePos)
            ? 'enemy-most-buffs'
            : p.target;
        const repairedCond = detectRepairedThisRoundCondition(text, purgePos);
        out.push({
            ability: {
                id: nextId(),
                type: 'purge',
                target,
                trigger,
                conditions: repairedCond ? [repairedCond] : [],
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
    for (const rem of parseSelfBuffRemovals(text)) {
        const removePos = text.indexOf(rem.buffName);
        out.push({
            ability: {
                id: nextId(),
                type: 'remove-self-buff',
                target: 'self',
                trigger: rem.trigger,
                conditions: [],
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
        const pos = rowText ? rowText.indexOf(buff.buffName) : -1;
        // Epic PR4: a split-sentence "… also gains <Buff>" continuing an IMMEDIATELY PRECEDING
        // "At the start of the round, this Unit gains …" sentence (Nayra p2's Offensive Affinity
        // Override, Isha p1/p2's Defensive Affinity Override) has no round-start phrase of its
        // OWN clause, so detectReactiveTrigger above misses it — fall back to the continuation
        // detector before falling through to the crossing/target-gate/damage-reaction chain.
        if (reactiveTrigger === undefined && rowText && pos >= 0) {
            reactiveTrigger = detectRoundStartContinuationTrigger(rowText, pos);
        }
        if (reactiveTrigger) {
            ability.trigger = reactiveTrigger;
            ability.conditions = ability.conditions.filter((c) => c.subject !== 'self-crit');
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
        mergeBuff(buff, 'enemy');
    }

    // Phase 4c PR 1 (Task 8): damage-reaction DoT inflictions on the PASSIVE row (Warden
    // "When directly damaged, this Unit inflicts Corrosion I … on that enemy", Shepherd) are
    // NOT DoTs. Spec decision (§3.5): counter-DoT tick damage against an enemy ATTACKER is
    // deliberately unsimulated — only the focus enemy's incoming DoTs tick, so emitting a dot
    // here would phantom-credit tick damage the sim never resolves. The named status still
    // matters (visible in the editor, condition-relevant for enemy-debuff gates), so emit a
    // name-only DEBUFF (empty parsedEffects → no payload) riding the live on-attacked trigger;
    // the executor lands it on the attacking enemy via eventCtx.counterTargetId. DoT-named
    // effects are excluded from BOTH buff auto-fill (isDoTBuffName) and the active/charge DoT
    // merge above (passive sources skipped), so without this pass they emit nothing.
    const passiveRowText = getSkillRowForSlot(ship, 'passive')?.text ?? '';
    if (passiveRowText) {
        // Source tag is irrelevant here (it only drives stackTrigger classification, which a
        // reaction-sentence DoT infliction never carries) — 'passive1' is a neutral stand-in.
        for (const eff of parseSkillEffects(passiveRowText, 'passive1')) {
            if (eff.target !== 'enemy' || !DOT_TIER_MAP[eff.buffName]) continue;
            const pos = passiveRowText.indexOf(eff.buffName);
            const reaction =
                pos >= 0 ? detectDamageReactionTrigger(passiveRowText, pos) : undefined;
            if (!reaction) continue;
            const dotReactionConditions: Condition[] =
                reaction.hpBelowPct !== undefined
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
            const ability: Ability = {
                id: nextId(),
                type: 'debuff',
                target: 'enemy',
                trigger: reaction.trigger,
                ...(reaction.critFilter ? { triggerCritFilter: reaction.critFilter } : {}),
                conditions: dotReactionConditions,
                config: {
                    type: 'debuff',
                    buffName: eff.buffName,
                    parsedEffects: {},
                    stacks: eff.stacks ?? 1,
                    isStackable: false,
                    duration: typeof eff.duration === 'number' ? eff.duration : 2,
                    application: eff.application ?? 'inflict',
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
    const CONTROL_TWIN_TAG: Record<ControlEffect, string> = {
        stasis: 'Stasis',
        provoke: 'Provoke',
        'concentrate-fire': 'Concentrate Fire',
        disable: 'Disable',
        taunt: 'Taunt',
    };
    for (const positioned of bySlot.values()) {
        for (let i = positioned.length - 1; i >= 0; i--) {
            const ability = positioned[i].ability;
            if (ability.type !== 'control' || ability.config.type !== 'control') continue;
            const tag = CONTROL_TWIN_TAG[ability.config.effect];
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

    return {
        slots,
        ...(doesntBreakStasis ? { doesntBreakStasis: true } : {}),
        ...(chargeLossImmune ? { chargeLossImmune: true } : {}),
    };
}
