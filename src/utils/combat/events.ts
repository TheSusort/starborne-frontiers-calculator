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
 *    aggregate event for all consumed bombs. `actorId` = the bomb's ORIGINAL applier
 *    (`PendingBomb.sourceId`) for `processBombs` AND for SP-F F3/Lingshe's forced early
 *    detonation via `bomb-countdown-reduce`; the attacker-turn `detonate()` aggregate
 *    branch instead emits the casting `actor.id`. Either way — any actor, not always
 *    'attacker'. `actorId` feeds log/attribution; the VICTIM-scoped `on-bomb-detonated`
 *    listener is global over `actorId` (keys off `victimId` being opposing). The separate
 *    DETONATOR-scoped `on-self-bomb-detonated` listener (Ship-kit W7/Lingshe) keys off the
 *    additive `detonatorId` field (who actively caused the burst; undefined for natural expiry).
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
          /** The DISTINCT victims this cast critically hit, in first-crit order. Present only on
           *  the POSITIONAL deferred emit (where the per-victim apply resolves crits per victim)
           *  and only when non-empty; absent on the single-target inline emit, where `targetId`
           *  IS the only possible crit victim. Consumers must fall back to `targetId` when it is
           *  absent. Exists because `critHits` is a bare COUNT: for an AoE that crit two covered
           *  victims but not the selected anchor, `targetId` names a victim that never crit, so a
           *  "deals X to that enemy" reactive routed off `targetId` hits the wrong ship. */
          critVictimIds?: string[];
          /** PR7: what this sub-attack actually DELIVERED — post-crit, post-amplification,
           *  post-victim-defence, INCLUDING damage a Protection cascade diverted to protectors and
           *  EXCLUDING damage deferred into a DoT. The locked basis for damage-proportional outgoing
           *  effects (Bloodthirst).
           *
           *  A SEPARATE field from `damage` on purpose: `damage` is the cast's pre-funnel
           *  `directDamage` and drives the combat log's primary-target amount (buildCombatLog's
           *  `openAttackAbilityDamage`), so repurposing it would move every golden. Present only on
           *  the interleaved positional path — consumers MUST fall back to `damage` for the
           *  non-positional and DPS paths. */
          deliveredDamage?: number;
          /** The 0-based sub-attack this event belongs to (multi-hit full-walk epic, PR4). A
           *  multi-hit skill is N consecutive full-walk attacks and PR2 emits one event per
           *  sub-attack; this names which one. Since PR5 BOTH emitters stamp it — the positional
           *  interleaved emit and runPlayerTurn's non-positional inline loop — so it is present on
           *  every event a real cast produces. It is still optional because the two cast-scoped
           *  engine fallbacks (nothing-landed, enemy 0-damage) omit it; consumers must read absent
           *  as "the only sub-attack", and must NOT substitute 0 when comparing across DIFFERENT
           *  actors, since every actor's first sub-attack is also 0.
           *
           *  Exists so a reactive intent enqueued during sub-attack k can be gated at sub-attack
           *  scope: intents from all N sub-attacks drain together at end of turn (drainIntentsFor),
           *  long after the engine's ambient `currentSubAttackIndex` has been cleared, so the
           *  identity has to travel on the event. */
          subAttackIndex?: number;
          didHit?: boolean;
      } & ReactiveStamp)
    | ({
          type: 'buff-applied';
          /** The actor that RECEIVED the buff. */
          actorId: string;
          /** The actor that GRANTED it — `status.casterId` / `intent.ownerId` at the emission
           *  site. Optional only so statusEngine unit fixtures need not restate it; read sites
           *  fall back to `actorId` (self-grant), which is what every pre-2026-08 event meant.
           *  Log attribution reads this so a ship whose kit only buffs OTHERS is still
           *  attributable to itself — `buff` was the sole grant-style kind booked to its
           *  recipient while heal/shield/control/debuff/dot all book to the source. */
          granterId?: string;
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
     *  actor id). NOT emitted for recurring/aura per-round re-applications.
     *  `viaDebuffInflictedReaction` (Ship-kit W7): set when this debuff was applied BY an
     *  `on-debuff-inflicted`-triggered ability (Warden's Out. Damage Down II). The
     *  `on-debuff-inflicted` listener ignores such events so a debuff-inflicted reaction whose
     *  own follow-up is itself a debuff cannot re-trigger ITSELF (an unbounded self-chain that
     *  would otherwise hit MAX_INTENT_GENERATIONS). Debuffs from OTHER reactive triggers
     *  (on-crit/on-attacked) carry no flag and still feed on-debuff-inflicted as before. */
    | ({
          type: 'debuff-applied';
          sourceId: string;
          targetId: string;
          round: number;
          buffName: string;
          viaDebuffInflictedReaction?: true;
      } & ReactiveStamp)
    | ({
          type: 'debuff-resisted';
          /** The inflicting actor (Vindicator on-resist retaliation routes here). Optional: a
           *  display-only resist path may omit it; a source-requiring reaction no-ops when absent. */
          sourceId?: string;
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
          /** Tier MAGNITUDE of the applied DoT (corrosion 3/6/9, inferno 15/30/45, bomb
           *  100/200/300 — the value tickDoTs divides by 100). Combat-log fidelity: lets the
           *  applied line show the tier numeral (corrosion/inferno) via dotTierNumeral. Always set
           *  by the engine; optional so hand-crafted test emits may omit it (→ no numeral shown). */
          tier?: number;
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
    /** LOG-ONLY: a drain-time REACTIVE damage proc resolved (applyReactiveDamage → creditDamage).
     *  A reactive damage credits its total but emits NO `ability-performed` (chain guard — an
     *  ability-performed would re-trigger on-crit/on-attacked/on-ally-crit listeners and loop).
     *  This event exists SOLELY so buildCombatLog can surface the proc: NO combat listener
     *  subscribes to it, so it can never chain. `sourceId` = the reacting owner; `targetId` = the
     *  victim; `amount` = the mitigated/credited damage; `didCrit` when the proc crit. */
    | ({
          type: 'reactive-damage-performed';
          sourceId: string;
          targetId: string;
          round: number;
          amount: number;
          didCrit?: boolean;
      } & ReactiveStamp)
    /** A drain-time REACTIVE heal resolved (executeIntent heal branch). A reactive heal credits
     *  `directHeal` but emits NO `heal-performed` (chain guard — it must not re-trigger the
     *  REPAIRER'S OWN on-repair listeners, which would loop). `casterId` = the reacting owner;
     *  `perTarget` = per-recipient raw repair.
     *
     *  Primarily for buildCombatLog, but NOT log-only: `on-enemy-repaired` also subscribes, because
     *  a reactive repair is still "an enemy performing a repair" (Ruiner's Bomb) and reaction-healers
     *  repair almost exclusively through this event. That subscription is safe specifically because
     *  no on-enemy-repaired rider heals, so it cannot re-enter this emit — any NEW subscriber must
     *  re-establish that argument for itself rather than assume this event is inert.
     *
     *  NOT EMITTED FOR A ZERO-GROSS REPAIR (multi-hit full-walk epic, PR6). The executor gates this
     *  emit on `healSum > 0` (triggers.ts heal branch), so a reactive repair that resolved to
     *  nothing — a `damage-dealt` basis on a sub-attack that delivered nothing, a zero-count
     *  event-scaled repair — produces no event at all. A repair that lands and then fully
     *  OVERHEALS still emits: the gross was real, only the target was full. Any rider that counts
     *  repairs off this event (a metric, a proc-counter) therefore counts landed repairs, not
     *  attempted ones, and will under-count against an attempt-based expectation. */
    | ({
          type: 'reactive-heal-performed';
          casterId: string;
          round: number;
          amount: number;
          perTarget: { targetId: string; amount: number }[];
      } & ReactiveStamp)
    /** LOG-ONLY: a drain-time REACTIVE cleanse resolved (executeIntent cleanse branch — e.g.
     *  AEGIS's on-ally-shield-destroyed "cleanses all debuffs", Cultivator's on-ally-crit cleanse).
     *  The reactive cleanse credits `cleanseCount` but emits NO `cleanse-performed` (chain guard —
     *  that event drives on-enemy-cleansed / on-own-cleanse listeners). This event exists SOLELY so
     *  buildCombatLog can surface the reaction (previously the reactive cleanse was invisible in the
     *  log): NO combat listener subscribes to it, so it can never chain. `casterId` = the reacting
     *  owner; `perTarget` = per-recipient count of debuffs ACTUALLY removed (only recipients with
     *  >= 1 removal are listed). */
    | ({
          type: 'reactive-cleanse-performed';
          casterId: string;
          round: number;
          perTarget: { targetId: string; count: number }[];
          /** Present ONLY for a duration-SHRINK reaction (Heliodor/Pestilence/Warpstrike's
           *  "reduces the duration of all active Debuffs … by 1 turn"). Absent → the default
           *  `remove` mode, where `count` is debuffs actually removed. When present, `count` is
           *  instead the number of debuffs whose duration was SHRUNK, and `durationTurns` is by
           *  how much — the log renders the two differently ("cleansed 2" vs "-1 turn on 2"). */
          mode?: 'reduce-duration';
          durationTurns?: number;
      } & ReactiveStamp)
    /** A cleanse cast resolved. `casterId` is the cleansing actor; `count` is the number of
     *  debuffs ACTUALLY removed. Team-symmetric (the enemy-cleanse-lift, #166-era): BOTH the
     *  player path and the enemy (event-only) path perform REAL removal via the side-agnostic
     *  `statusEngine.cleanse` over `recipientsFor`'s side-aware recipients, and the event is
     *  suppressed on both sides when 0 debuffs were removed. The `on-enemy-cleansed` listener
     *  filters by `isOpposing(casterId)`; the `on-own-cleanse` listener (Phase 3 PR-H) filters by
     *  `casterId === ownerId`. */
    | ({
          type: 'cleanse-performed';
          casterId: string;
          count: number;
          round: number;
          /** Phase 3 PR-H: the recipient ids that ACTUALLY had >= 1 debuff removed (a subset of
           *  the cleanse ability's targeted recipients — e.g. an `all-allies` cleanse where only
           *  some allies carried a debuff), in application order. Read by the `on-own-cleanse`
           *  listener to stamp `eventCtx.cleansedAllyIds`, routing an `ally`-target reactive
           *  repair (Cultivator's "that ally") to exactly these ids instead of the default heal
           *  target. Mirrors `heal-performed.targets`/`shield-applied.recipientIds`. Always
           *  populated by the engine; absent only in hand-crafted test emits. */
          targets?: string[];
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
          // SP-E: widened to DoTType (was 'corrosion' | 'inferno') — a generic-DoT tick emits
          // this event too. 'bomb' never appears here (bombs burst via 'bomb-detonated').
          dotType: DoTType;
          damage: number;
          /** Combat-log fidelity: the per-dotType-and-TIER SUMMED TICKING stacks (see `tickDoTs`'s
           *  `emitTicked` jsdoc) — lets the log line show "{dotType} {numeral} ×{stacks}". */
          stacks: number;
          /** Tier MAGNITUDE of this tick group (corrosion 3/6/9, inferno 15/30/45). tickDoTs emits
           *  one event per (dotType, tier), so this is a single tier, not a mix. Feeds the numeral
           *  via dotTierNumeral. Always set by the engine; optional so hand-crafted test emits may
           *  omit it (→ no numeral shown). */
          tier?: number;
      }
    | { type: 'dot-detonated'; targetId: string; round: number; damage: number }
    /** Emitted on each bomb burst, but the two paths are asymmetric:
     *  - Enemy-turn `processBombs`: ONE event PER pending bomb entry that reaches
     *    countdown 0. `damage` = stacks × damagePerStack × affinityMult (no skill pct).
     *  - Attacker-turn `detonate()` bomb branch: ONE AGGREGATE event summing all
     *    consumed bomb entries. `damage` = (Σ stacks × damagePerStack) × affinityMult × pct,
     *    where pct is the detonation skill's power multiplier.
     *  In both cases `damage` is the realized payout under that path's scaling, not a
     *  normalized value. `actorId` = the bomb's ORIGINAL applier (`PendingBomb.sourceId`)
     *  for `processBombs` and for SP-F F3/Lingshe's forced early detonation via
     *  `bomb-countdown-reduce`; the attacker-turn `detonate()` aggregate branch emits the
     *  casting `actor.id` instead. Any actor, not always 'attacker'. `victimId` = the actor
     *  the bomb detonated ON (the bomb's holder) — distinct from `actorId`, which stays the
     *  applier/caster per the above. Added for Wave 5 C2 (Demolisher adjacent-enemy splash
     *  anchoring, consumed by C3); purely additive, no behaviour change.
     *  `detonatorId` (Ship-kit W7/Lingshe) = the actor who ACTIVELY caused this burst — the
     *  caster of the detonating skill (`detonate()`/positional detonate) or the
     *  `bomb-countdown-reduce` caster (Lingshe's charge). UNDEFINED for a natural countdown-0
     *  expiry (`processBombs`), which nobody "detonates". Distinct from `actorId` (the applier)
     *  and `victimId` (the holder); consumed only by the DETONATOR-scoped `on-self-bomb-detonated`
     *  trigger, so every existing listener that reads actorId/victimId is unaffected. */
    | {
          type: 'bomb-detonated';
          actorId: string;
          victimId: string;
          detonatorId?: string;
          round: number;
          stacks: number;
          damage: number;
      }
    /** #345: an accumulate-then-detonate container (`PendingAccumulator` — Echoing Burst, the
     *  only such effect in the corpus) reached the end of its countdown and burst on its holder.
     *  ONE event per detonating entry, emitted from `processAccumulators` beside the burst's
     *  `creditDetonation`, mirroring `processBombs`/`emitBombDetonated`.
     *
     *  Deliberately NOT a widening of `bomb-detonated`. An Echoing Burst is not a Bomb DoT (see
     *  `audit/classes.ts`), and both of that event's listeners are Bomb-specific by their own
     *  skill text — Demolisher's "when a Bomb explodes" splash + charge removal and Lingshe's
     *  "when this Unit detonates a Bomb" Stealth grant. A discriminant field on the shared event
     *  would have obliged every one of those listeners to filter it out correctly; a separate
     *  event reaches only the one listener written for it.
     *
     *  `actorId` = the accumulator's APPLIER (`PendingAccumulator.sourceId`), the actor whose
     *  Echoing Burst this is — the field the APPLIER-scoped `on-own-echoing-burst-detonated`
     *  listener keys off. `victimId` = the actor it detonated ON (the holder, which is who takes
     *  the damage). `damage` = the realized payout, `accumulated × pct/100`. There is no
     *  `detonatorId` counterpart: a timed expiry is nobody's action.
     *
     *  ⚠️ The emit carries no effect NAME (`PendingAccumulator` stores none), so if a second
     *  accumulate-detonate effect is ever modelled, an owner's `on-own-echoing-burst-detonated`
     *  rider would fire for that one too. Harmless today — `ACCUMULATE_DETONATE_EFFECTS`
     *  (skillTextParser) has exactly one entry, and Valkyrie's charged skill is its only
     *  applier. Give the container a name before adding a second effect. */
    | {
          type: 'accumulator-detonated';
          actorId: string;
          victimId: string;
          round: number;
          damage: number;
      }
    /** A `control` ability resolved on the cast path. `casterId` is the applying actor;
     *  `effect` is the control effect (e.g. 'stasis'). Present-only-when-fired; emitting it
     *  does NOT simulate the control's combat effect. */
    | ({
          type: 'control-applied';
          casterId: string;
          effect: ControlEffect;
          round: number;
      } & ReactiveStamp)
    /** Ship-kit Wave 3 (Task 7, Laika): a caster's ability actually reduced a victim's shield
     *  pool via `stripShieldPct` (playerTurn.ts) — EITHER the I6 (Lodolite) purge-coupled 100%
     *  strip, OR the standalone PR9(b) `type:'shield-strip'` ability (APEX/Laika/Malvex).
     *  Emitted ONLY when the pool was > 0 immediately before the strip (a strip attempt against
     *  an already-empty pool removes nothing and is suppressed) — mirrors `purge-performed`'s
     *  0-removed suppression. `casterId` = the stripping actor; `targetId` = the victim whose
     *  shield was reduced; `pct` = the percentage of the CURRENT pool removed (the same `pct`
     *  argument passed to `stripShieldPct` — 100 for the I6 branch, `ab.config.pct` for PR9(b)).
     *  The `on-own-shield-strip` listener (triggers.ts) filters `casterId === ownerId`. */
    | ({
          type: 'shield-stripped';
          casterId: string;
          targetId: string;
          round: number;
          pct: number;
      } & ReactiveStamp)
    /** Ship-kit Wave 3 (Task 9, Hemlock/ledger #49): Corrosion SPREAD at the end of a round. The
     *  engine's end-of-round Toxic Overflow mechanic (engine.ts) emits this for each unit that held
     *  Toxic Overflow AND ≥1 stack of Corrosion: it inflicted Corrosion I (3 turns) on that unit's
     *  adjacent allies and removed its Toxic Overflow. `sourceId` = the unit that held Toxic
     *  Overflow (the spread origin); `affectedIds` = the adjacent allies that RECEIVED Corrosion I
     *  (possibly empty if the holder had no living adjacent allies). Team-symmetric — emitted for
     *  holders on either side. Hemlock's `on-corrosion-spread` self-heal (triggers.ts) rides it,
     *  scaling by `affectedIds.length` ("per enemy affected"), scoped to spreads whose `sourceId`
     *  opposes the reactor. */
    | ({
          type: 'corrosion-spread';
          sourceId: string;
          affectedIds: string[];
          round: number;
      } & ReactiveStamp)
    /** A victim's shield pool was fully depleted by a DIRECT hit (SP-F F2, AEGIS). Emitted from
     *  the shared `applyVictimDamage` immediately after the shield-drain line, ONLY when the pool
     *  was > 0 immediately before this hit's absorb and reaches exactly 0 after it, AND the hit
     *  is direct (`byDirectDamage`) — a DoT TICK that zeroes a lingering shield (`byDirectDamage:
     *  false`) does NOT emit this. A bomb burst, by contrast, applies with `byDirectDamage: true`
     *  (both the natural `processBombs` payout and F3's forced early detonation), so a bomb that
     *  fully depletes an ally's shield DOES emit this and AEGIS reacts — behaviorally consistent
     *  with any other direct hit. A Barrier-blocked hit never reaches the shield at all (the
     *  Barrier early-return precedes this emit point), so it can never false-positive here. */
    | ({ type: 'shield-destroyed'; victimId: string; round: number } & ReactiveStamp)
    /** LOG-ONLY twin of `shield-destroyed`. The REAL `shield-destroyed` event carries the
     *  combat listeners (AEGIS on-ally-shield-destroyed) and is emitted INLINE; this twin
     *  exists SOLELY so buildCombatLog can surface (and nest) the shield break. NO combat
     *  listener subscribes to it, so it can never chain — same contract as
     *  `reactive-damage-performed`. Buffered on the positional path (defer-flush) to nest
     *  under the triggering attack. */
    | ({ type: 'shield-destroyed-log'; victimId: string; round: number } & ReactiveStamp)
    /** LOG-ONLY shield grant with no `shield-applied` counterpart. Emitted for the ONE shield
     *  source that lands inside `applyVictimDamage` instead of a cast (playerTurn.ts) or the
     *  reactive executor (triggers.ts) — Lifeline's `incoming-shield-grant`, a mid-hit threshold
     *  pool. Deliberately NOT the real `shield-applied`: that event carries `on-shield-applied`
     *  combat listeners (Resonating Fury), and firing them from a threshold grant would change
     *  combat behaviour rather than just the log. Without this twin the pool grew silently while
     *  its `shield-destroyed` twin still fired, which reads as "a shield was destroyed that the
     *  log never showed being granted". Same contract as `shield-destroyed-log`: no combat
     *  listener subscribes, so it can never chain, and it is buffered on the positional path
     *  (defer-flush) to nest under the triggering attack. */
    | ({
          type: 'shield-applied-log';
          /** The actor whose pool grew. Also the granter — the threshold shield is always a
           *  self-grant from the victim's own implant, so the log entry keys on this one id. */
          victimId: string;
          /** Post-cap pool growth (the same `granted` delta fed to the shield StatCard). */
          amount: number;
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
    /** LOG-ONLY twin of `cheat-death-activated`. The REAL event carries the combat listeners
     *  (Yazid on-cheat-death-activated) and is emitted INLINE; this twin exists SOLELY for
     *  buildCombatLog. NO combat listener subscribes to it (cannot chain). Buffered on the
     *  positional path (defer-flush) to nest under the triggering attack. */
    | ({ type: 'cheat-death-log'; actorId: string; round: number } & ReactiveStamp)
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
    /** LOG-ONLY: a per-turn snapshot of the ACTING actor's live modelled stats, emitted
     *  immediately after `turn-started`. This is an on-turn snapshot, never a reaction — it
     *  carries NO `ReactiveStamp` and NO combat listener subscribes to it (mirrors the
     *  `reactive-damage-performed`/`reactive-heal-performed` log-only contract). Two
     *  display-only consumers: `buildCombatLog` attaches it to the turn view-model, and
     *  `simulateDPS`'s emit-only collector turn-weights it into the DPS summary's buffed-stat
     *  average (SP-2). Aggregating it for DISPLAY is fine. What would be a bug is subscribing a
     *  combat listener to it, or letting a consumer feed anything back into combat state — the
     *  log-only contract is about influence, not about arithmetic. `stats` reflects the same
     *  `effectiveStatsOf(statusEngine, selfBuffLookup, actor)` fold every other live-stat read
     *  in the engine uses, plus the actor's current HP/shield pool. */
    | {
          type: 'stats-snapshot';
          actorId: string;
          round: number;
          stats: {
              attack: number;
              defence: number;
              crit: number;
              critDamage: number;
              defensePenetration: number;
              speed: number;
              hacking: number;
              security: number;
              currentHp: number;
              maxHp: number;
              shieldPool: number;
          };
      }
    /** LOG-ONLY: an end-of-round snapshot of the statuses one actor actually still carries,
     *  read live from the StatusEngine (`statusNames`). Emitted once per actor at the round
     *  tail, after every decrement and drain has settled. Carries NO `ReactiveStamp`; NO combat
     *  listener subscribes to it (same log-only contract as `stats-snapshot`).
     *
     *  Exists because the Simulator's per-round buff/debuff chips were assembled by ACCUMULATING
     *  `buff-applied`/`debuff-applied`/`dot-applied`. That has no removal path, so a cleansed,
     *  purged, stolen or expired status stayed listed for the rest of the battle. This snapshot is
     *  authoritative for the actors it names — the assembler prefers it over accumulation — so
     *  removal is reflected without needing a name-carrying event on every removal seam.
     *
     *  `simulateDPS` reads the same event for the DPS calculator's per-round chips (SP-2), filtered to
     *  the focus actor and the REAL enemy roster — the vestigial dummy also emits here, but it keys its
     *  debuffs under the `__enemy__` sentinel rather than its actor id, so its lists are always empty. */
    | {
          type: 'status-snapshot';
          actorId: string;
          round: number;
          buffNames: string[];
          debuffNames: string[];
      }
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
          /** D-PR16: direct damage this SUB-ATTACK dealt to this victim (multi-hit full-walk epic,
           *  PR2 — previously the per-TURN aggregate, repeated identically on every per-hit event).
           *  Present only when a damage aggregate is in scope. Tenacity's >25%-max-HP filter reads
           *  this, and it needs ONE hit's damage rather than the cast's. */
          damage?: number;
          /** G PR1: true when the victim was the directly-targeted (primary) target of the
           *  attack, false/absent for splash/covered AoE victims. Today the sole emit is the
           *  focus victim (`tgt`) → always true; positional per-victim emission (future) sets
           *  false for covered cells. Stalwart's counter gates on this. */
          isPrimaryTarget?: boolean;
          /** G PR2: true when this hit actually reduced the victim's shield pool
           *  (absorbed > 0). Sourced from the shield-first drain at the emit
           *  (shieldBefore > 0 && hpDamage < damage && !barriered && !converted). Nyxen's counter
           *  gates on this. False/absent when no shield was present, the hit fully
           *  penetrated to HP, a Barrier blocked it (shield untouched), or Shield Converter
           *  converted the hit (shield gained, not drained). */
          shieldWasHit?: boolean;
          /** The 0-based sub-attack of the ATTACKER's cast that produced this hit (multi-hit
           *  full-walk epic, PR4). PR2 already emits one `attacked` per (sub-attack, victim); this
           *  names which sub-attack, so a victim-side once-per-attack guard can reset between the
           *  attacker's consecutive attacks instead of collapsing all N into one. ALWAYS present
           *  on a real `attacked` event, positional or not: `emitAttacked` stamps
           *  `subAttackIndex ?? hitIndex` unconditionally on every path, falling back to the
           *  per-hit loop index when the caller supplies no sub-attack identity. Optional here
           *  only so hand-built fixture events can omit it. */
          subAttackIndex?: number;
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
