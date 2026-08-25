import { Ability, AbilityTarget } from '../../types/abilities';
import { SelectedGameBuff } from '../../types/calculator';
import { isEnemyTarget } from './abilityTargetSide';

export function selectedBuffToAbility(buff: SelectedGameBuff, target: AbilityTarget): Ability {
    const isEnemy = isEnemyTarget(target);
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
                  ...(buff.clearAllOnRedirect ? { clearAllOnRedirect: true } : {}),
                  duration,
                  // Default to the resistible 'inflict' (the common case + matches makeDefaultAbility);
                  // only an explicitly-parsed 'apply' verb makes a debuff guaranteed.
                  application: buff.application ?? 'inflict',
              }
            : {
                  type: 'buff',
                  buffName: buff.buffName,
                  parsedEffects: buff.parsedEffects,
                  stacks: buff.stacks,
                  isStackable: buff.isStackable,
                  maxStacks: buff.maxStacks,
                  stackTrigger: buff.stackTrigger,
                  ...(buff.clearAllOnRedirect ? { clearAllOnRedirect: true } : {}),
                  duration,
              },
    };
}
