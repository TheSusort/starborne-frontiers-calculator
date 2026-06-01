import { Ship } from '../../types/ship';
import { EnemyBaseClass, ConditionalCondition, DoTApplicationEntry } from '../../types/calculator';
import { getShipSkillRows } from '../ship/skillRows';
import {
    parseSkillDamage,
    parseSecondaryDamage,
    parseConditionalDamage,
    parseChargeGain,
} from '../skillTextParser';
import { buildDoTAutoFill } from '../calculators/skillBuffAutoFill';
import {
    Ability,
    ShipSkills,
    Skill,
    SkillSlot,
    Condition,
    AbilityTarget,
} from '../../types/abilities';

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
    channel: 'outgoingDamage';
    value: number;
    isMultiplicative: boolean;
    target: AbilityTarget;
    stealthGated: boolean;
}

/**
 * Detects a flat outgoing-damage modifier ("deal 40% more direct damage").
 * Targets all-allies when the clause references friendly/allies, otherwise self.
 * Flags a Stealth gate so the caller can attach a Stealth condition.
 */
function parseModifier(text: string): ParsedModifier | undefined {
    const plain = stripTags(text);
    const match = plain.match(/(\d+)%\s+more\s+(?:direct\s+)?damage/i);
    if (!match) return undefined;

    const value = parseInt(match[1], 10);
    // Inspect the clause preceding the match for the targeting cue.
    const clause = plain.slice(0, match.index! + match[0].length);
    const isAllyScoped = /friendly|all allies|allies/i.test(clause);
    const target: AbilityTarget = isAllyScoped ? 'all-allies' : 'self';
    const stealthGated = /stealth/i.test(clause);

    return { channel: 'outgoingDamage', value, isMultiplicative: true, target, stealthGated };
}

function slotFor(label: string): SkillSlot | null {
    if (label === 'Active') return 'active';
    if (label === 'Charge') return 'charged';
    if (label.startsWith('Passive')) return 'passive';
    return null;
}

/**
 * Maps an existing-detector ConditionalCondition into a model Condition. The
 * subject strings are identical between the two unions, so this is mostly a
 * passthrough carrying derivable / manualCount / requiredEnemyType. Neither
 * source type carries a buff name, so for buff-gated subjects we inspect the raw
 * skill text and tag the common "Stealth" gate so Phase 2 can resolve it.
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
        out.push({
            id: nextId(),
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: mult, ...(hits !== undefined ? { hits } : {}) },
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
            toCondition(cond.condition, cond.derivable, cond.manualCount, undefined, text),
        ];
        out[0].scaling = {
            conditionIndex: 0,
            perUnit: cond.pct,
            ...(cond.cap !== undefined ? { cap: cond.cap } : {}),
        };
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

    const modifier = parseModifier(text);
    if (modifier) {
        const conditions: Condition[] = modifier.stealthGated
            ? [
                  toCondition(
                      // Ally-scoped Stealth gates on a friendly/self buff; enemy-scoped on enemy buff.
                      modifier.target === 'self' || modifier.target === 'all-allies'
                          ? 'self-buff'
                          : 'enemy-buff',
                      false,
                      undefined,
                      undefined,
                      text
                  ),
              ]
            : [];
        out.push({
            id: nextId(),
            type: 'modifier',
            target: modifier.target,
            trigger: 'on-cast',
            conditions,
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
        const existing = bySlot.get(slot);
        if (existing) existing.push(...abilities);
        else bySlot.set(slot, abilities);
    }

    // Merge ship-level DoTs into their slots (creating the slot entry if needed).
    for (const slot of ['active', 'charged'] as const) {
        const dots = dotsForSlot(slot).map(dotAbility);
        if (!dots.length) continue;
        const existing = bySlot.get(slot);
        if (existing) existing.push(...dots);
        else bySlot.set(slot, dots);
    }

    const slots: Skill[] = [];
    for (const [slot, abilities] of bySlot) {
        if (abilities.length) slots.push({ slot, abilities });
    }
    return { slots };
}
