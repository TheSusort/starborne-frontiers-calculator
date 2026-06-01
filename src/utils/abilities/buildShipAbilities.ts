import { Ship } from '../../types/ship';
import { EnemyBaseClass, ConditionalCondition } from '../../types/calculator';
import { getShipSkillRows } from '../ship/skillRows';
import {
    parseSkillDamage,
    parseSecondaryDamage,
    parseConditionalDamage,
    parseChargeGain,
} from '../skillTextParser';
import { Ability, ShipSkills, Skill, SkillSlot, Condition } from '../../types/abilities';

let counter = 0;
const nextId = () => `ab${counter++}`;

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
        out.push({
            id: nextId(),
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: mult },
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

    // buff/debuff/dot abilities are NOT emitted here (Task 3b / deferred).
    return out;
}

export function buildShipAbilities(ship: Ship): ShipSkills {
    counter = 0;
    const slots: Skill[] = [];
    for (const row of getShipSkillRows(ship)) {
        const slot = slotFor(row.label);
        if (!slot) continue;
        const abilities = abilitiesFromText(row.text);
        if (abilities.length) slots.push({ slot, abilities });
    }
    return { slots };
}
