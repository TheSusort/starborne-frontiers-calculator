import { EnemyBaseClass, DoTType, StackTrigger, ParsedBuffEffects } from './calculator';

export type SkillSlot = 'active' | 'charged' | 'passive';

export type AbilityType =
    | 'damage'
    | 'additional-damage'
    | 'modifier'
    | 'buff'
    | 'debuff'
    | 'dot'
    | 'extend-dot'
    | 'detonate-dot'
    | 'accumulate-detonate'
    | 'charge'
    | 'extra-action'
    | 'heal'
    | 'shield'
    | 'cleanse'
    | 'purge'
    | 'control';

export type AbilityTarget = 'self' | 'ally' | 'all-allies' | 'enemy' | 'all-enemies';

// NOTE on the live subset: `round-started` is the engine event key for the
// `start-of-round` trigger (a deviation from the Phase 1 contract's `turn-started`
// mapping — in a multi-actor round `turn-started` fires once per actor, so
// `round-started` is the canonical "start of round" signal). See LIVE_TRIGGERS
// below for which values the Phase 4b engine consumes via listeners; the rest are
// annotation-only (assume-active conditions, normal on-cast pipelines).
export type AbilityTrigger =
    | 'on-cast'
    | 'start-of-round'
    | 'on-crit'
    | 'on-debuff-inflicted'
    | 'on-ally-debuff-inflicted'
    | 'on-ally-crit-dot'
    | 'on-ally-critically-repaired'
    | 'on-ally-crit'
    | 'on-stasis-applied'
    | 'on-bomb-detonated'
    | 'on-attacked'
    | 'on-ally-destroyed'
    | 'on-destroyed'
    | 'on-enemy-destroyed'
    | 'on-cheat-death-activated';

/**
 * Triggers the combat engine consumes via listeners (the machinery lives in
 * src/utils/combat/triggers.ts). All four death/revive triggers are live as of
 * Phase 4b: on-destroyed, on-ally-destroyed, on-enemy-destroyed, and
 * on-cheat-death-activated. Defined here next to AbilityTrigger (not in the
 * engine module) so UI consumers — e.g. the editor's Trigger select note — don't
 * pull the combat engine's module graph in for one constant.
 */
export const LIVE_TRIGGERS = new Set<AbilityTrigger>([
    'start-of-round',
    'on-crit',
    'on-debuff-inflicted',
    'on-ally-debuff-inflicted',
    'on-ally-crit-dot',
    'on-ally-critically-repaired',
    'on-ally-crit',
    'on-stasis-applied',
    'on-bomb-detonated',
    'on-attacked',
    'on-destroyed',
    'on-ally-destroyed',
    'on-enemy-destroyed',
    'on-cheat-death-activated',
]);

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
    | 'hp-threshold'
    // HP-percentage COUNT subjects: the count IS the enemy's current (or missing)
    // HP percentage (0..100), for HP-proportional scaling — Akula ("up to 30% more,
    // the higher the target's HP") scales on enemy-hp-pct with perUnit 0.3; Tithonus
    // ("up to 40%, max below 10% HP") on enemy-hp-missing-pct with perUnit 40/90 +
    // cap 40. Distinct from 'hp-threshold', which is a binary above/below gate.
    | 'enemy-hp-pct'
    | 'enemy-hp-missing-pct'
    | 'ally-inflicts-debuff'
    | 'ally-critically-repaired'
    | 'ally-crit-dot'
    // A specific named ally is on the team (roster/team-composition gate; manual,
    // team-dependent). The ally's name is carried in `buffName` (e.g. "Isha").
    | 'ally-on-team';

export interface Condition {
    subject: ConditionSubject;
    derivable: boolean;
    manualCount?: number;
    anyOf?: boolean;
    requiredEnemyType?: EnemyBaseClass;
    // For 'enemy-type': when true, the gate means the enemy is NOT `requiredEnemyType`
    // (e.g. "when targeting non-Defenders").
    negate?: boolean;
    buffName?: string;
    hpComparator?: 'below' | 'above';
    hpPercent?: number;
    // For 'hp-threshold': whose HP the threshold applies to. Defaults to 'enemy' (offensive scaling).
    hpSubject?: 'self' | 'enemy';
    // Threshold gating for count subjects (buff/debuff/adjacency/destroyed counts).
    // When set, the condition is "met" only when the derived/manual count satisfies
    // the comparator against `countThreshold` (e.g. enemy has ≥3 debuffs, self has 0
    // debuffs). Absent → the default presence rule (count > 0) applies. This gates
    // (conditionsMet) only; per-count scaling (scaledBonus) always uses the raw count.
    countComparator?: 'gte' | 'lte' | 'eq';
    countThreshold?: number;
}

export interface ScalingRule {
    conditionIndex: number;
    perUnit: number;
    cap?: number;
}

// NOTE: spelling mirrors the existing codebase intentionally — ModifierChannel /
// additional-damage.stat use American 'defense' (like SecondaryDamageStat), while
// ParsedBuffEffects use British 'defence'. Phase 2's applyAbility must map both
// to the same underlying defence stat.
export type ModifierChannel =
    | 'attack'
    | 'defense'
    | 'defensePenetration'
    | 'hp'
    | 'crit'
    | 'critDamage'
    | 'outgoingDamage'
    | 'outgoingHeal'
    | 'incomingDamage';

export type AbilityConfig =
    | { type: 'damage'; multiplier: number; hits?: number; noCrit?: boolean }
    | { type: 'additional-damage'; stat: 'hp' | 'defense'; pct: number }
    | { type: 'modifier'; channel: ModifierChannel; value: number; isMultiplicative: boolean }
    | {
          type: 'buff';
          buffName: string;
          parsedEffects: ParsedBuffEffects;
          stacks: number;
          isStackable: boolean;
          maxStacks?: number;
          stackTrigger?: StackTrigger;
          duration?: number | 'recurring';
      }
    | {
          type: 'debuff';
          buffName: string;
          parsedEffects: ParsedBuffEffects;
          stacks: number;
          isStackable: boolean;
          maxStacks?: number;
          stackTrigger?: StackTrigger;
          application: 'inflict' | 'apply';
          duration?: number | 'recurring';
      }
    | { type: 'dot'; dotType: DoTType; tier: number; stacks: number; duration: number }
    // `scope`: 'active'/undefined extends ALL standing DoT entries (Provider's
    // "extends active Damage Over Time effects"; default + back-compat for stored
    // configs). 'inflicted' extends ONLY the DoT entries this cast just applied
    // (Valerian's "the newly applied Corrosion ... extended by 1 turn").
    | {
          type: 'extend-dot';
          turns: number;
          chanceFromCritPower?: boolean;
          scope?: 'active' | 'inflicted';
      }
    | { type: 'detonate-dot'; dotType: DoTType; powerPct: number }
    // Echoing Burst-style debuff: gathers the direct damage dealt to the enemy while
    // active (`turns`), then detonates for `pct`% of the accumulated total on expiry.
    | { type: 'accumulate-detonate'; turns: number; pct: number }
    | { type: 'charge'; amount: number }
    // A full extra turn: the engine re-inserts the granting actor into the round's
    // remaining turn queue at its speed position (game-verified 2026-06-06).
    | { type: 'extra-action'; oncePerRound: boolean }
    | {
          type: 'heal' | 'shield';
          pct: number;
          /** Stat the amount scales from: caster max HP / attack / defence, the
           *  RECIPIENT's max HP ('target-hp' — "of their Max HP"), or a damage-leech
           *  basis: 'damage-dealt' (X% of damage this actor deals — cast rider on
           *  active/charged slots, standing leech on the passive slot) /
           *  'damage-taken' (X% of an enemy attack's damage on this actor; passive
           *  slot, procs only while the actor is the heal target). */
          basis: 'hp' | 'attack' | 'defense' | 'target-hp' | 'damage-dealt' | 'damage-taken';
          /** Pallas/Tithonus: "repair cannot critically hit". Shields never crit regardless. */
          noCrit?: boolean;
          /** Passive-slot 'damage-dealt' only: which credited damage procs the leech.
           *  'all' (default — direct + DoT ticks + detonations, user decision 2026-06-07)
           *  or 'detonation' (Valkyrie: Echoing Burst explosions only). */
          leechScope?: 'all' | 'detonation';
          /** 'damage-taken' only (Quixilver "when taking HP damage and still having
           *  Shield"): proc only when the attack started with shield > 0 AND dealt HP
           *  damage (punched through the pool). Absent → unconditional (Malvex). */
          requiresHpDamage?: boolean;
          /** "Once per battle" reactive repair (Yazid's on-cheat-death-activated 60%
           *  repair): the executor fires its consumption AT MOST ONCE per combat, tracked
           *  by a combat-lifetime Set keyed `${ownerId}:${abilityId}` in IntentExecContext.
           *  Absent → unbounded (fires on every qualifying trigger). */
          oncePerCombat?: boolean;
      }
    | { type: 'cleanse' | 'purge'; count: number }
    | {
          type: 'control';
          effect: ControlEffect;
      };

/** Crowd-control effects a `control` ability can apply. The engine does not simulate
 *  these combat effects; the `control-applied` event (events.ts) only exposes the
 *  application moment so reactions (e.g. Defiant's shield-on-Stasis) can fire. */
export type ControlEffect = 'provoke' | 'taunt' | 'stasis' | 'overload' | 'concentrate-fire';

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
