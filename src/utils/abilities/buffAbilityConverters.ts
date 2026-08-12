import { Ability, AbilityTarget } from '../../types/abilities';
import { SelectedGameBuff } from '../../types/calculator';

// Enemy-target classifier for selectedBuffToAbility: which AbilityTarget values are enemy-side, so
// a manual buff pick converted for an enemy-facing slot produces a debuff config (application verb,
// resistibility) instead of falling through to the 'buff' branch. Wave 5 (Task A2): the two
// enemy-adjacency scopes are enemy-side debuffs too (Vindicator's Provoke, Asphyxiator's Stasis) —
// without them a buff/debuff round-trip would fall through to the 'buff' branch and lose the debuff
// config (application verb, resistibility). Ship-kit W8 (Task 5): 'enemy-highest-attack' is likewise
// an enemy-side selector (Selenite's round-start Concentrate Fire) — same failure mode if omitted.
// Ship-kit W8 (CodeRabbit round): 'enemy-most-buffs' and 'enemy-highest-speed' are likewise
// enemy-side highest/most selectors (see AbilityTarget in src/types/abilities.ts) — same
// misclassification risk if a buff/debuff config is ever retargeted to them.
function isEnemyTarget(target: AbilityTarget): boolean {
    return (
        target === 'enemy' ||
        target === 'all-enemies' ||
        target === 'adjacent-enemies' ||
        target === 'target-and-adjacent-enemies' ||
        target === 'enemy-highest-attack' ||
        target === 'enemy-most-buffs' ||
        target === 'enemy-highest-speed'
    );
}

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
