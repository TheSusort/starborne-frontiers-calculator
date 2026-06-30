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
/** Stamp added to events emitted while the engine resolves a REACTIVE intent
 *  (counterattacks, on-crit grants, reflects, reactive shields, etc.). A later
 *  pure log builder reads these to NEST the reaction under the turn during which
 *  it fired — NOT under the reactor's own turn (some reactions drain at round-end,
 *  far from their trigger in the stream, so stream position is insufficient).
 *  On-turn (non-reactive) emissions never carry these fields. */
export interface ReactiveStamp {
    /** Present (true) only on events emitted during reactive-intent resolution. */
    reactive?: true;
    /** The actorId whose turn was active when the reaction fired (the nesting key).
     *  Undefined when no turn was active (e.g. a round-1 start-of-round reactive or a
     *  post-round death-drain reaction). */
    duringTurnOf?: string;
    /** Who provoked the reaction — usually the active-turn actor. */
    triggerActorId?: string;
}

export type CombatEvent =
    | {
          type: 'round-started';
          round: number;
      } /** Fires once per round at the round TAIL, AFTER all turns + the post-round death drain.
     *  Mirror of `round-started`. Drains the end-of-round reactive queue (Rhodium's
     *  end-of-round purge). Carries only the round number. */
    | { type: 'round-ended'; round: number }
    | { type: 'turn-started'; actorId: string; round: number }
    | { type: 'turn-ended'; actorId: string; round: number }
    | {
          type: 'skill-fired';
          actorId: string;
          round: number;
          slot: 'active' | 'charged';
          skillName?: string;
      }
    | ({
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
      } & ReactiveStamp)
    | ({
          type: 'buff-applied';
          actorId: string;
          round: number;
          buffName: string;
          duration: number | 'recurring';
      } & ReactiveStamp)
    /** Emitted from each owner's Post Turn when a timed status decrements to 0
     *  (statusEngine.decrementPlayer/decrementEnemy); actorId is the status carrier
     *  (the player actor carrying the buff for self buffs, enemy for enemy debuffs). */
    | ({ type: 'buff-expired'; actorId: string; round: number; buffName: string } & ReactiveStamp)
    /** Discrete infliction events ONLY — emitted once at the round of application.
     *  `sourceId` is the actor that inflicted the debuff (e.g. 'attacker' or a team
     *  actor id). NOT emitted for recurring/aura per-round re-applications. */
    | ({
          type: 'debuff-applied';
          sourceId: string;
          targetId: string;
          round: number;
          buffName: string;
      } & ReactiveStamp)
    | ({
          type: 'debuff-resisted';
          targetId: string;
          round: number;
          buffName: string;
      } & ReactiveStamp)
    /** `sourceId` identifies the inflicting actor. */
    | ({
          type: 'dot-applied';
          sourceId: string;
          targetId: string;
          round: number;
          dotType: DoTType;
          stacks: number;
          /** The applying cast had >= 1 critting hit (per-hit crits). Present only when
           *  true. Executor-applied dots omit it (drain-time has no crit outcome). */
          viaCrit?: boolean;
      } & ReactiveStamp)
    /** A heal/shield cast resolved (healing mode only). `targets` lists recipient actor
     *  ids in application order; `amount` is the summed RAW amount across recipients.
     *  `critHits` present only when >= 1 (single-draw heals: 0 or 1 per heal ability;
     *  summed across the cast's heal abilities). `perTarget` carries the actually-applied
     *  amount per recipient (raw heal); `overheal` and `didCrit` are present when the
     *  engine tracks them for that recipient. */
    | ({
          type: 'heal-performed';
          casterId: string;
          targets: string[];
          round: number;
          amount: number;
          critHits?: number;
          /** Summed CLIPPED EXCESS of this cast's repair on the heal target (heal raw minus
           *  the HP actually consumed). Present only when > 0. Consumed by the
           *  on-own-repair-to-ally listener to scale an `overheal`-basis reactive shield
           *  (Abundant Renewal); ignored by every other heal-performed listener. */
          overheal?: number;
          /** Per-recipient breakdown: one entry per recipient in application order.
           *  `amount` is the raw heal applied to that recipient; `overheal` is the
           *  wasted portion (present only when > 0, player-side heal target only);
           *  `didCrit` is present when the ability crit (player/enemy-side heal).
           *  Always populated by the engine; absent only in hand-crafted test emits. */
          perTarget?: { targetId: string; amount: number; overheal?: number; didCrit?: boolean }[];
      } & ReactiveStamp)
    /** A shield-application cast resolved (one event per cast, not per recipient).
     *  `granterId` is the acting actor that applied the shield(s) — named granter (not
     *  caster) because Resonating Fury is granter-scoped and listens on this;
     *  `recipientIds` are the recipients whose pool actually grew (actualGranted > 0) —
     *  RF's buff targets; `amount` is the total shield actually granted this cast
     *  (post-cap). `perTarget` carries the actually-granted amount per recipient
     *  (post-cap, same filter as recipientIds: only entries where granted > 0). */
    | ({
          type: 'shield-applied';
          granterId: string;
          recipientIds: string[];
          round: number;
          amount: number;
          /** Per-recipient breakdown: one entry per recipient whose pool actually grew
           *  (mirrors `recipientIds`). `amount` is the post-cap pool growth for that
           *  recipient. Always populated by the engine; absent only in hand-crafted test emits. */
          perTarget?: { targetId: string; amount: number }[];
      } & ReactiveStamp)
    /** A cleanse cast resolved. `casterId` is the cleansing actor; `count` is the
     *  number of debuffs actually removed (player-side) or the nominal cfg.count
     *  (enemy-side, event-only path). Asymmetry: player-side performs REAL removal
     *  and suppresses the event when 0 debuffs were removed; enemy-side fires on
     *  every qualifying cast regardless of whether a debuff existed (removal is
     *  deferred — reactors such as Arum/Grif fire on the cast, not the removal).
     *  The `on-enemy-cleansed` listener filters by `isOpposing(casterId)`. */
    | ({
          type: 'cleanse-performed';
          casterId: string;
          count: number;
          round: number;
      } & ReactiveStamp)
    /** A purge resolved. `casterId` = the purging actor; `targetId` = the VICTIM whose
     *  buffs were removed (REQUIRED — `on-ally-purged` is victim-scoped, unlike the
     *  caster-scoped `on-enemy-cleansed`); `count` = the number actually removed.
     *  Suppressed when 0 removed and when the triggering intent carried
     *  `eventCtx.fromPurgeEvent` (depth-1 chain guard — a purge triggered by a purge
     *  does not re-emit). `on-enemy-purged` filters `casterId === ownerId`;
     *  `on-ally-purged` filters `isSameSideAlly(targetId, ownerId)`. */
    | ({
          type: 'purge-performed';
          casterId: string;
          targetId: string;
          count: number;
          round: number;
      } & ReactiveStamp)
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
    | ({
          type: 'control-applied';
          casterId: string;
          effect: ControlEffect;
          round: number;
      } & ReactiveStamp)
    /** A target's HP fraction changed. Emitted on TWO distinct paths with intended
     *  granularity asymmetry:
     *   - Tank-side (Phase 4c PR 3, LIVE): once per HP-INTAKE EVENT inside
     *     `applyIncomingToTarget` — i.e. per enemy attack (aggregate shield-first drain)
     *     AND per tank turn-start DoT batch (the emission covers both deliberately,
     *     since in-game "when HP drops below N%" includes DoT damage). `oldPct`/`newPct`
     *     are EXACT (non-rounded) percentages. Emitted after the Cheat-Death intercept,
     *     so a 100→1-HP save reads as a downward crossing; a killed tank emits
     *     ship-destroyed instead, never a posthumous hp-changed.
     *   - Enemy dummy (post-round): integer-granularity, emitted only when the rounded
     *     enemy HP% changes between rounds. The integer-vs-exact asymmetry is intended. */
    | { type: 'hp-changed'; targetId: string; round: number; oldPct: number; newPct: number }
    /** Emitted once per actor when its HP first reaches 0. `actorId` may be any
     *  participating actor: 'attacker', a team actor id, or 'enemy'. `killerId`/
     *  `byDirectDamage` (C2b-2 Faust): the lethal attacker and whether the kill was a
     *  DIRECT hit (vs a DoT-tick batch, which has no single killer → byDirectDamage:false,
     *  killerId undefined). Optional — only Faust's on-destroyed purge reads them; all other
     *  listeners ignore them (backward-compatible). */
    | ({
          type: 'ship-destroyed';
          actorId: string;
          round: number;
          killerId?: string;
          byDirectDamage?: boolean;
      } & ReactiveStamp)
    /** Emitted when a Cheat Death passive intercepts what would have been a lethal
     *  hit, keeping the actor alive at 1 HP. `actorId` is the surviving actor. */
    | ({ type: 'cheat-death-activated'; actorId: string; round: number } & ReactiveStamp)
    /** Emitted at every actor.charges mutation so the log can show charge state and
     *  manipulation. `oldCharge`/`newCharge` bracket the mutation; `reason` distinguishes
     *  the three mutation paths:
     *   - 'gen':        natural per-turn +1 increment (advanceChargeCadence, non-cap branch)
     *   - 'cast-reset': charge-cap fire that resets counter to 0 (advanceChargeCadence, cap branch)
     *   - 'manip':      ability-driven grant or removal (engine/triggers/playerTurn) */
    | ({
          type: 'charge-changed';
          actorId: string;
          round: number;
          oldCharge: number;
          newCharge: number;
          reason: 'gen' | 'cast-reset' | 'manip';
      } & ReactiveStamp)
    /** Emitted when a player actor is attacked. `targetId` is the attacked actor;
     *  `attackerId` is the attacker. `didCrit` is the individual hit's crit outcome
     *  (present only when that hit critted). Emitted once PER HIT of the enemy's
     *  fired damage ability (Phase 4c PR 1), after the aggregate shield-first drain
     *  so all events observe the same post-drain HP/shield state. A manual flat enemy
     *  or a noCrit damage ability falls back to one event per attack turn (the pre-4c
     *  contract). DoT ticks, bomb detonations, and accumulators never emit it — only
     *  direct weapon hits. The tank-side `hp-changed` event (PR 3) is per-HP-intake-event
     *  (attacks AND DoT batches), so a 3-hit attack emits 3 `attacked` but a single
     *  `hp-changed`; the granularity asymmetry is intended. */
    | {
          type: 'attacked';
          targetId: string;
          attackerId: string;
          round: number;
          didCrit?: boolean;
          /** D-PR16: per-ATTACK aggregate direct damage dealt this turn (identical across the
           *  turn's per-hit events — per-hit damage is not tracked, same approximation as
           *  Bloodthirst's triggerDamage). Present only when a damage aggregate is in scope.
           *  Tenacity's >25%-max-HP filter reads this. */
          damage?: number;
          /** G PR1: true when the victim was the directly-targeted (primary) target of the
           *  attack, false/absent for splash/covered AoE victims. Today the sole emit is the
           *  focus victim (`tgt`) → always true; positional per-victim emission (future) sets
           *  false for covered cells. Stalwart's counter gates on this. */
          isPrimaryTarget?: boolean;
          /** G PR2: true when this hit actually reduced the victim's shield pool
           *  (absorbed > 0). Sourced from the shield-first drain at the emit
           *  (shieldBefore > 0 && hpDamage < damage && !barriered). Nyxen's counter
           *  gates on this. False/absent when no shield was present, the hit fully
           *  penetrated to HP, or a Barrier blocked it (shield untouched). */
          shieldWasHit?: boolean;
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
