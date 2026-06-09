import { AbilityType, ControlEffect } from '../../types/abilities';
import { DoTType } from '../../types/calculator';

/**
 * Engine-emitted combat events. Phase 1 is emit-only (the DPS adapter is the sole
 * consumer); Phase 3 maps reactive Ability.trigger values onto these. Contract:
 * listeners are synchronous, run in registration order, and never mutate combat
 * state — they produce intents (e.g. enqueued follow-up executions) only.
 *
 * Phase 3 deviations from the Phase 1 contract:
 *  - `round-started`: the start-of-round trigger key. Fires once per round, before
 *    any `turn-started`. NOTE: `turn-started` fires multiple times per round in a
 *    multi-actor setup (once per actor), so `round-started` is the canonical
 *    "start of round" trigger, not `turn-started`.
 *  - `debuff-applied`: discrete infliction events ONLY — emitted once at the round
 *    of application (attacker timed ability applications, `sourceFired().appliedEnemy`
 *    for attacker and team turns). It is NOT emitted every round a standing timed
 *    debuff is active, nor for recurring/aura debuffs' per-round re-applications.
 *    `sourceId` identifies the actor that inflicted it.
 *  - `dot-applied`: carries `sourceId` identifying the inflicting actor.
 *  - `bomb-detonated`: asymmetric paths — `processBombs` (enemy turn) emits one event
 *    per pending bomb that detonates; `detonate()` bomb branch (attacker turn) emits one
 *    aggregate event for all consumed bombs. `actorId` is 'attacker' in both paths.
 *  - `control-applied`: emitted on the CAST path when the firing skill carries a `control`
 *    ability (e.g. Defiant's charged Stasis inflict). `casterId` is the applying actor;
 *    `effect` is the control effect. Present-only-when-fired. Emitting it does NOT make the
 *    engine simulate the control (Stasis/Taunt/etc. stay unmodelled) — it only exposes the
 *    application moment so reactions (Defiant's shield-on-Stasis, on-stasis-applied) can fire.
 */
export type CombatEvent =
    | { type: 'round-started'; round: number }
    | { type: 'turn-started'; actorId: string; round: number }
    | { type: 'turn-ended'; actorId: string; round: number }
    | {
          type: 'skill-fired';
          actorId: string;
          round: number;
          slot: 'active' | 'charged';
          skillName?: string;
      }
    | {
          type: 'ability-performed';
          actorId: string;
          targetId: string;
          round: number;
          abilityType: AbilityType;
          damage?: number;
          didCrit?: boolean;
          /** Number of individual hits that crit this cast (per-hit crit checks).
           *  Present only when > 0; `didCrit` stays the any-hit binary. */
          critHits?: number;
          didHit?: boolean;
      }
    | {
          type: 'buff-applied';
          actorId: string;
          round: number;
          buffName: string;
          duration: number | 'recurring';
      }
    /** Emitted from each owner's Post Turn when a timed status decrements to 0
     *  (statusEngine.decrementPlayer/decrementEnemy); actorId is the status carrier
     *  (the player actor carrying the buff for self buffs, enemy for enemy debuffs). */
    | { type: 'buff-expired'; actorId: string; round: number; buffName: string }
    /** Discrete infliction events ONLY — emitted once at the round of application.
     *  `sourceId` is the actor that inflicted the debuff (e.g. 'attacker' or a team
     *  actor id). NOT emitted for recurring/aura per-round re-applications. */
    | {
          type: 'debuff-applied';
          sourceId: string;
          targetId: string;
          round: number;
          buffName: string;
      }
    | { type: 'debuff-resisted'; targetId: string; round: number; buffName: string }
    /** `sourceId` identifies the inflicting actor. */
    | {
          type: 'dot-applied';
          sourceId: string;
          targetId: string;
          round: number;
          dotType: DoTType;
          stacks: number;
          /** The applying cast had >= 1 critting hit (per-hit crits). Present only when
           *  true. Executor-applied dots omit it (drain-time has no crit outcome). */
          viaCrit?: boolean;
      }
    /** A heal/shield cast resolved (healing mode only). `targets` lists recipient actor
     *  ids in application order; `amount` is the summed RAW amount across recipients.
     *  `critHits` present only when >= 1 (single-draw heals: 0 or 1 per heal ability;
     *  summed across the cast's heal abilities). */
    | {
          type: 'heal-performed';
          casterId: string;
          targets: string[];
          round: number;
          amount: number;
          critHits?: number;
      }
    | {
          type: 'dot-ticked';
          targetId: string;
          round: number;
          dotType: 'corrosion' | 'inferno';
          damage: number;
      }
    | { type: 'dot-detonated'; targetId: string; round: number; damage: number }
    /** Emitted on each bomb burst, but the two paths are asymmetric:
     *  - Enemy-turn `processBombs`: ONE event PER pending bomb entry that reaches
     *    countdown 0. `damage` = stacks × damagePerStack × affinityMult (no skill pct).
     *  - Attacker-turn `detonate()` bomb branch: ONE AGGREGATE event summing all
     *    consumed bomb entries. `damage` = (Σ stacks × damagePerStack) × affinityMult × pct,
     *    where pct is the detonation skill's power multiplier.
     *  In both cases `damage` is the realized payout under that path's scaling, not a
     *  normalized value. `actorId` is 'attacker' in both paths. */
    | { type: 'bomb-detonated'; actorId: string; round: number; stacks: number; damage: number }
    /** A `control` ability resolved on the cast path. `casterId` is the applying actor;
     *  `effect` is the control effect (e.g. 'stasis'). Present-only-when-fired; emitting it
     *  does NOT simulate the control's combat effect. */
    | { type: 'control-applied'; casterId: string; effect: ControlEffect; round: number }
    | { type: 'hp-changed'; targetId: string; round: number; oldPct: number; newPct: number }
    | { type: 'ship-destroyed'; actorId: string; round: number }
    /** Emitted when a player actor is attacked. `targetId` is the attacked actor;
     *  `attackerId` is the attacker. `didCrit` is present only when the attack
     *  critted. Emitted once per enemy attack TURN (aggregate — not per-hit) from
     *  the enemy intake in engine.ts, after the shield-first drain (Task 8). */
    | {
          type: 'attacked';
          targetId: string;
          attackerId: string;
          round: number;
          didCrit?: boolean;
      };

export type CombatEventType = CombatEvent['type'];

type Listener<T extends CombatEventType> = (event: Extract<CombatEvent, { type: T }>) => void;

export interface CombatEventBus {
    on<T extends CombatEventType>(type: T, listener: Listener<T>): void;
    emit(event: CombatEvent): void;
}

export function createEventBus(): CombatEventBus {
    const listeners = new Map<CombatEventType, Listener<CombatEventType>[]>();
    return {
        on(type, listener) {
            const existing = listeners.get(type) ?? [];
            listeners.set(type, [...existing, listener as unknown as Listener<CombatEventType>]);
        },
        emit(event) {
            for (const listener of listeners.get(event.type) ?? []) {
                listener(event as unknown as Extract<CombatEvent, { type: CombatEventType }>);
            }
        },
    };
}
