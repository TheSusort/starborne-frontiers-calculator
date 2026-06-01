import { EnemyBaseClass, DoTType, StackTrigger } from './calculator';

export type SkillSlot = 'active' | 'charged' | 'passive';

export type AbilityType =
    | 'damage'
    | 'additional-damage'
    | 'modifier'
    | 'buff'
    | 'debuff'
    | 'dot'
    | 'charge'
    | 'heal'
    | 'shield'
    | 'cleanse'
    | 'purge'
    | 'control';

export type AbilityTarget = 'self' | 'ally' | 'all-allies' | 'enemy' | 'all-enemies';

export type AbilityTrigger =
    | 'on-cast'
    | 'start-of-round'
    | 'on-crit'
    | 'on-attacked'
    | 'on-ally-destroyed'
    | 'on-destroyed';

export type ConditionSubject =
    | 'always'
    | 'self-buff'
    | 'self-debuff'
    | 'enemy-buff'
    | 'enemy-debuff'
    | 'enemy-type'
    | 'self-crit'
    | 'adjacent-ally'
    | 'enemy-adjacent'
    | 'enemy-destroyed'
    | 'hp-threshold';

export interface Condition {
    subject: ConditionSubject;
    derivable: boolean;
    manualCount?: number;
    anyOf?: boolean;
    requiredEnemyType?: EnemyBaseClass;
    buffName?: string;
    hpComparator?: 'below' | 'above';
    hpPercent?: number;
}

export interface ScalingRule {
    conditionIndex: number;
    perUnit: number;
    cap?: number;
}

// NOTE: spelling mirrors the existing codebase intentionally — ModifierChannel /
// additional-damage.stat use American 'defense' (like SecondaryDamageStat), while
// BuffStat / Buff.stat use British 'defence'. Phase 2's applyAbility must map both
// to the same underlying defence stat.
export type ModifierChannel =
    | 'attack'
    | 'defense'
    | 'hp'
    | 'crit'
    | 'critDamage'
    | 'outgoingDamage'
    | 'outgoingHeal'
    | 'incomingDamage';

export type BuffStat = 'attack' | 'crit' | 'critDamage' | 'outgoingDamage' | 'defence' | 'hp';

export type AbilityConfig =
    | { type: 'damage'; multiplier: number; hits?: number }
    | { type: 'additional-damage'; stat: 'hp' | 'defense'; pct: number }
    | { type: 'modifier'; channel: ModifierChannel; value: number; isMultiplicative: boolean }
    | {
          type: 'buff';
          stat: BuffStat;
          value: number;
          isMultiplicative: boolean;
          duration: number | 'recurring';
          stackable: boolean;
          maxStacks?: number;
          stackTrigger?: StackTrigger;
      }
    | {
          type: 'debuff';
          stat: BuffStat;
          value: number;
          duration: number | 'recurring';
          application: 'inflict' | 'apply';
      }
    | { type: 'dot'; dotType: DoTType; tier: number; stacks: number; duration: number }
    | { type: 'charge'; amount: number }
    | { type: 'heal' | 'shield'; pct: number; basis: 'hp' | 'attack' }
    | { type: 'cleanse' | 'purge'; count: number }
    | {
          type: 'control';
          effect: 'provoke' | 'taunt' | 'stasis' | 'overload' | 'concentrate-fire';
      };

export interface Ability {
    id: string;
    type: AbilityType;
    target: AbilityTarget;
    trigger: AbilityTrigger;
    conditions: Condition[];
    scaling?: ScalingRule;
    config: AbilityConfig;
    autoFilled?: boolean;
}

export interface Skill {
    slot: SkillSlot;
    name?: string;
    abilities: Ability[];
}

export interface ShipSkills {
    slots: Skill[];
}
