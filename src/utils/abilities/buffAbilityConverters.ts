import { Ability, ShipSkills, AbilityTarget } from '../../types/abilities';
import { SelectedGameBuff, EnemyBaseClass } from '../../types/calculator';
import { conditionsMet, ConditionContext } from './evaluateConditions';

let seq = 0;
const buffId = (name: string) => `buffability-${name}-${seq++}`;

// NOTE: intentionally does NOT carry skillSource/skillDuration/sourceChargeCount/
// sourceStartCharged — those sim-scheduling fields aren't on the buff/debuff config.
// The sim is unchanged; Phase 3b rebuilds any scheduling from auto-fill, not this round-trip.
export function abilityToSelectedBuff(ability: Ability): SelectedGameBuff | null {
    const c = ability.config;
    if (c.type !== 'buff' && c.type !== 'debuff') return null;
    return {
        id: buffId(c.buffName),
        buffName: c.buffName,
        stacks: c.stacks,
        parsedEffects: c.parsedEffects,
        isStackable: c.isStackable,
        maxStacks: c.maxStacks,
        stackTrigger: c.stackTrigger,
        autoFilled: ability.autoFilled,
    };
}

export function selectedBuffToAbility(buff: SelectedGameBuff, target: AbilityTarget): Ability {
    const isEnemy = target === 'enemy' || target === 'all-enemies';
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
            const sb = abilityToSelectedBuff(ability);
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
