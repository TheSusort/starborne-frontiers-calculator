import { Ability, ShipSkills, AbilityTarget, SkillSlot } from '../../types/abilities';
import { SelectedGameBuff, EnemyBaseClass } from '../../types/calculator';
import { conditionsMet, ConditionContext } from './evaluateConditions';

// Sim-scheduling fields are RECONSTRUCTED here (not dropped): skillSource is derived from
// the ability's slot (active→'active', charged→'charge', passive→'passive1') and skillDuration
// from the buff/debuff config's `duration`. Without these, computeBuffTimeline's isAlwaysActive
// would treat every converted timed buff as permanent and over-count it.
// sourceChargeCount/sourceStartCharged are still NOT carried (they aren't on the config) — fine
// for single-attacker DPS, where the timeline falls back to the attacker's own charged set.
// The emitted id is derived from the (stable) source ability id so repeated calls on the
// same ShipSkills produce identical ids — avoids React remount churn when the page memoizes
// or uses the id as a list key (GameBuffPicker keys on SelectedGameBuff.id).
export function abilityToSelectedBuff(ability: Ability, slot: SkillSlot): SelectedGameBuff | null {
    const c = ability.config;
    if (c.type !== 'buff' && c.type !== 'debuff') return null;
    const skillSource: SelectedGameBuff['skillSource'] =
        slot === 'charged' ? 'charge' : slot === 'passive' ? 'passive1' : 'active';
    return {
        id: `buff-${ability.id}`,
        buffName: c.buffName,
        stacks: c.stacks,
        parsedEffects: c.parsedEffects,
        isStackable: c.isStackable,
        maxStacks: c.maxStacks,
        stackTrigger: c.stackTrigger,
        autoFilled: ability.autoFilled,
        skillSource,
        skillDuration: c.duration,
    };
}

export function selectedBuffToAbility(buff: SelectedGameBuff, target: AbilityTarget): Ability {
    const isEnemy = target === 'enemy' || target === 'all-enemies';
    const duration: number | 'recurring' | undefined =
        typeof buff.skillDuration === 'number' || buff.skillDuration === 'recurring'
            ? buff.skillDuration
            : undefined;
    return {
        id: `ab-${buff.id}`,
        type: isEnemy ? 'debuff' : 'buff',
        target,
        trigger: 'on-cast',
        conditions: [],
        autoFilled: buff.autoFilled,
        config: isEnemy
            ? {
                  type: 'debuff',
                  buffName: buff.buffName,
                  parsedEffects: buff.parsedEffects,
                  stacks: buff.stacks,
                  isStackable: buff.isStackable,
                  maxStacks: buff.maxStacks,
                  stackTrigger: buff.stackTrigger,
                  duration,
                  application: 'apply',
              }
            : {
                  type: 'buff',
                  buffName: buff.buffName,
                  parsedEffects: buff.parsedEffects,
                  stacks: buff.stacks,
                  isStackable: buff.isStackable,
                  maxStacks: buff.maxStacks,
                  stackTrigger: buff.stackTrigger,
                  duration,
              },
    };
}

// Static context for the include/exclude gate. Derivable-dynamic counts default to
// "satisfiable" so only enemy-type mismatch or a manual toggle (count 0) excludes a buff.
// (An enemy-buff-BY-NAME condition evaluates to 0 here, so mark such conditions
// non-derivable/manual in the editor to gate them — documented limitation.)
export function buildStaticBuffContext(opts: { enemyType?: EnemyBaseClass }): ConditionContext {
    return {
        selfBuffNames: [],
        selfDebuffNames: [],
        enemyBuffNames: [],
        enemyDebuffCount: 1,
        enemyType: opts.enemyType,
        effectiveCritRate: 100,
        adjacentAllyCount: 1,
        enemyAdjacentCount: 1,
        enemyDestroyedCount: 1,
        selfHpPct: 100,
        enemyHpPct: 100,
    };
}

export function buffAbilitiesToSelectedBuffs(
    shipSkills: ShipSkills,
    staticCtx: ConditionContext
): { selfBuffs: SelectedGameBuff[]; enemyDebuffs: SelectedGameBuff[] } {
    const selfBuffs: SelectedGameBuff[] = [];
    const enemyDebuffs: SelectedGameBuff[] = [];
    for (const slot of shipSkills.slots) {
        for (const ability of slot.abilities) {
            if (ability.config.type !== 'buff' && ability.config.type !== 'debuff') continue;
            if (!conditionsMet(ability.conditions, staticCtx)) continue;
            const sb = abilityToSelectedBuff(ability, slot.slot);
            if (!sb) continue;
            if (ability.target === 'enemy' || ability.target === 'all-enemies') {
                enemyDebuffs.push(sb);
            } else {
                selfBuffs.push(sb);
            }
        }
    }
    return { selfBuffs, enemyDebuffs };
}

export function selectedBuffsToBuffAbilities(
    selfBuffs: SelectedGameBuff[],
    enemyDebuffs: SelectedGameBuff[]
): Ability[] {
    return [
        ...selfBuffs.map((b) => selectedBuffToAbility(b, 'self')),
        ...enemyDebuffs.map((b) => selectedBuffToAbility(b, 'enemy')),
    ];
}
