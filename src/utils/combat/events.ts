import { AbilityType, ControlEffect, SkillSlot } from '../../types/abilities';
import { DoTType } from '../../types/calculator';

/**
 * Engine-emitted combat events. Reactive `Ability.trigger` values map onto these.
 * Contract: listeners are synchronous, run in registration order, and never mutate
 * combat state — they produce intents (e.g. enqueued follow-up executions) only.
 *
 * Per-event deviations from that contract:
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
 *    (`PendingBomb.sourceId`) for `processBombs` AND for Lingshe's forced early
 *    detonation via `bomb-countdown-reduce`; the attacker-turn `detonate()` aggregate
 *    branch instead emits the casting `actor.id`. Either way — any actor, not always
 *    'attacker'. `actorId` feeds log/attribution; the VICTIM-scoped `on-bomb-detonated`
 *    listener is global over `actorId` (keys off `victimId` being opposing). The separate
 *    DETONATOR-scoped `on-self-bomb-detonated` listener (Lingshe) keys off the
 *    additive `detonatorId` field (who actively caused the burst; undefined for natural expiry).
 *  - `control-applied`: emitted on the CAST path when the firing skill carries a `control`
 *    ability (e.g. Defiant's charged Stasis inflict), once per actor it landed on — see the
 *    event's own doc. It only exposes the application moment so reactions (Defiant's
 *    shield-on-Stasis, on-stasis-applied) can fire; the named status performs the control.
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
          /** Every victim THIS sub-attack struck, in footprint order (positionalApply's per-sub-attack
           *  `victimIds`). Present only on the POSITIONAL deferred emit; consumers fall back to
           *  `[targetId]` when absent, where `targetId` is the only victim. */
          victimIds?: string[];
          /** This sub-attack's primary targets (positionalApply's
           *  `SubAttackOutcome.primaryVictimIds`: every victim of a whole-battlefield pattern,
           *  else the anchor). Present only on the POSITIONAL deferred emit and only when
           *  non-empty; consumers fall back to `[targetId]`. */
          primaryVictimIds?: string[];
          /** What this sub-attack actually DELIVERED — post-crit, post-amplification,
           *  post-victim-defence, INCLUDING damage a Protection cascade diverted to protectors and
           *  EXCLUDING damage deferred into a DoT. The locked basis for damage-proportional outgoing
           *  effects (Bloodthirst).
           *
           *  A SEPARATE field from `damage` on purpose: `damage` is the cast's pre-funnel
           *  `directDamage`, a different number with its own consumers. Present only on
           *  the interleaved positional path — consumers MUST fall back to `damage` for the
           *  non-positional and DPS paths. */
          deliveredDamage?: number;
          /** The 0-based sub-attack this event belongs to. A multi-hit skill is N consecutive
           *  full-walk attacks and the engine emits one event per sub-attack; this names which
           *  one. BOTH emitters stamp it — the positional
           *  interleaved emit and runPlayerTurn's non-positional inline loop — so it is present on
           *  every event a real cast produces. It is still optional because the two cast-scoped
           *  engine fallbacks (nothing-landed, enemy 0-damage) omit it; consumers must read absent
           *  as "the only sub-attack", and must NOT substitute 0 when comparing across DIFFERENT
           *  actors, since every actor's first sub-attack is also 0.
           *
           *  Exists so a reactive intent enqueued during sub-attack k can be gated at sub-attack
           *  scope: intents from all N sub-attacks drain together at end of turn (drainReactions),
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
     *  `debuffInflictedReactionChain`: the ids of the `on-debuff-inflicted`-triggered
     *  abilities whose reactions produced this debuff, oldest first — set only when the debuff
     *  was applied BY such an ability (Warden's Out. Damage Down II, Ripper's catalogue Inferno
     *  II on the `dot-applied` twin). The `on-debuff-inflicted` listener skips an ability whose
     *  OWN id is in the chain, so a reaction whose follow-up is itself a debuff cannot
     *  re-trigger itself, directly or through another of the owner's reactions — a special case
     *  of the lineage rule (`reactionKey` in triggers.ts), which the enqueue wrapper applies to
     *  every trigger; this brand stays for listener-level fixtures. Every OTHER on-debuff-inflicted
     *  ability of the owner still sees the debuff: the Insidiousness implant reacts to Warden's
     *  reactive Out. Damage Down II as to a cast-inflicted one, and rolls for it separately
     *  from the cast (`Ability.procScope` `'per-cast'`). Each ability in a chain fires at most
     *  once, so chain LENGTH is bounded by the owner's count of such abilities.
     *  Debuffs from OTHER reactive triggers (on-crit/on-attacked) carry no chain, so the chain
     *  guard lets every on-debuff-inflicted ability see them.
     *  `viaAllyDebuffInflictedReaction`: the sibling brand for `on-ally-debuff-inflicted`
     *  reactions — set when this debuff was applied by an ability whose OWN trigger is
     *  `on-ally-debuff-inflicted`. A separate field from `debuffInflictedReactionChain`
     *  deliberately: the two triggers are gated by different owners (`on-debuff-inflicted` is
     *  self-scoped; `on-ally-debuff-inflicted` is same-side-scoped, owner included — see the
     *  ruling in triggers.ts's trigger doc block), so a shared flag would make one trigger's
     *  reaction silently suppress the OTHER trigger's listener on a ship that carries both — a
     *  real infliction each is entitled to see. The `on-ally-debuff-inflicted` listener ignores an
     *  event carrying this brand only when its OWN `sourceId === ownerId` (the self-chain case); a
     *  same-brand event from a DIFFERENT same-side source (the two-ship ping-pong shape) is NOT
     *  filtered by this flag — see that listener's guard for the scope this leaves open. The brand
     *  bounds only the owner's own `on-ally-debuff-inflicted` output: a ship carrying BOTH an
     *  `on-debuff-inflicted` and an `on-ally-debuff-inflicted` debuff-emitting reaction is bounded
     *  by neither brand against the other's chain — the lineage rule (`reactionKey`) still ends it.
     *  Keyed per (owner, trigger), this brand is stricter than that rule; kept pending a ruling. */
    | ({
          type: 'debuff-applied';
          sourceId: string;
          targetId: string;
          round: number;
          buffName: string;
          /** The verb this debuff's source text states, which is also its landing mechanic —
           *  `'apply'` lands unconditionally (no hacking-vs-security roll; Concentrate Fire,
           *  Provoke), `'inflict'` rolled for it. Undefined only for a corpus shape that predates
           *  this field (an inflict). Read by the debuff-inflicted trigger family's
           *  `triggerApplicationFilter` — `passesApplicationFilter`'s doc in triggers.ts. */
          application?: 'inflict' | 'apply';
          /** The slot of the ability that inflicted this debuff: the firing slot on the cast
           *  path, the reactive ability's own slot on a reaction (implants and gear ride the
           *  passive slot). Read by `on-debuff-inflicted`'s `triggerSourceSlotFilter` (Ripper's
           *  "with its active or charged skills"). Optional so hand-built fixture events may omit
           *  it; an unstamped event never satisfies a present filter. */
          sourceSlot?: SkillSlot;
          debuffInflictedReactionChain?: readonly string[];
          /** Set on every debuff a REACTION lands (any trigger): the id of that one reaction
           *  firing, shared by everything the firing lands and distinct from every other firing in
           *  the combat. One round's Toxic Overflow spreads share one id (`rootCastKey`). Absent
           *  on a cast's own inflictions. `procScope:'per-cast'` (Insidiousness) gives each firing
           *  its own roll. */
          reactionFiringId?: number;
          viaAllyDebuffInflictedReaction?: true;
      } & ReactiveStamp)
    | ({
          type: 'debuff-resisted';
          /** The inflicting actor (Vindicator on-resist retaliation routes here). Optional: a
           *  display-only resist path may omit it; a source-requiring reaction no-ops when absent. */
          sourceId?: string;
          targetId: string;
          round: number;
          buffName: string;
          /** #413: TRUE only when the hacking-vs-security landing gate was actually DRAWN and
           *  came back a failure. Three unrelated causes emit this one event — a Block-Debuff
           *  auto-resist, an affinity-disadvantage `apply`, and a failed roll — and by emit time
           *  they were indistinguishable, so no consumer could tell "the enemy rolled a resist"
           *  from "the debuff never had a chance". `on-enemy-debuff-resisted` (Xcellence),
           *  `on-ally-debuff-resisted` (Prophet — #591) and `on-debuff-resisted` (Prophet's extra
           *  action, Vindicator, the Lockdown implant — #591) all fire on the roll only: a
           *  Block-Debuff or affinity auto-resist is not a resist the RESISTER's own reactions
           *  see. `on-own-debuff-resisted` (Ravager, inflictor-scoped) remains cause-agnostic —
           *  this field describes what the RESISTER experienced, not the inflictor.
           *
           *  MUST be stamped at the point of decision and passed through — never re-derived at
           *  the emit site. The reactive path deliberately folds immunity INTO its landing
           *  condition, so at the `else` you cannot tell which arm short-circuited; and the
           *  reactive and cast paths feed `computeAffinityModifiers` DIFFERENT affinity inputs on
           *  purpose, so a re-test drifts from the decision that was actually made. */
          viaLandingRoll?: true;
          /** The 0-based sub-attack that raised this resist, so a consumer can be attack-scoped
           *  rather than round-scoped. Present on the positional/deferred cast path, where the
           *  engine buffers each sub-attack's enemy-application emitters under its own index and
           *  hands that index back to the emitter. ABSENT on the non-positional path, whose debuff
           *  loop resolves the whole cast in one call and so has no per-sub-attack identity to
           *  stamp, and on hand-built fixture events. Consumers must read absent as "the only
           *  sub-attack" — the same `?? 'x'` contract the sibling counter guard uses — and must
           *  NOT substitute 0 when comparing across DIFFERENT actors. */
          subAttackIndex?: number;
          /** The `debuff-applied` sibling's `reactionFiringId`: set when a reaction made the
           *  resisted attempt, absent for a cast's own. */
          reactionFiringId?: number;
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
          /** The verb the DoT's source text states, from its config's `application` — `'apply'`
           *  for the Burner gear set's "Applies Inferno", which landed on the affinity check alone
           *  (no hacking roll). Absent → an inflict. Read by the debuff-inflicted trigger family's
           *  `triggerApplicationFilter` (`passesApplicationFilter` in triggers.ts). */
          application?: 'inflict' | 'apply';
          /** The applying cast had >= 1 critting hit (per-hit crits). Present only when
           *  true. Executor-applied dots omit it (drain-time has no crit outcome). */
          viaCrit?: boolean;
          /** The landed entry's `ActiveDoTStack.appliedSeq` — which entry this landing put on
           *  the board, so a reaction to it (Belladonna's conversion) touches that entry only.
           *  Always set by the engine; optional so hand-crafted test emits may omit it. */
          appliedSeq?: number;
          /** The inflicting ability's slot — see the `debuff-applied` sibling's `sourceSlot`. */
          sourceSlot?: SkillSlot;
          /** The `debuff-applied` sibling's `on-debuff-inflicted` reaction chain — see that
           *  field's doc. Set when this DoT was applied by an ability whose OWN trigger is
           *  `on-debuff-inflicted`, so that listener's `dot-applied` arm skips a reaction already in
           *  the chain exactly as its `debuff-applied` arm does. */
          debuffInflictedReactionChain?: readonly string[];
          /** The `debuff-applied` sibling's `reactionFiringId` — see that field's doc. */
          reactionFiringId?: number;
          /** The `debuff-applied` sibling's self-chain brand — see that field's doc. Set when
           *  this DoT was applied by an ability whose OWN trigger is `on-ally-debuff-inflicted`,
           *  so the `on-ally-debuff-inflicted` listener's `dot-applied` arm can skip its own
           *  reaction's output the same way the `debuff-applied` arm does. */
          viaAllyDebuffInflictedReaction?: true;
      } & ReactiveStamp)
    /** A heal/shield cast resolved (healing mode only). `targets` lists recipient actor
     *  ids in application order; `amount` is the summed RAW amount across recipients.
     *  `critHits` present only when >= 1 (single-draw heals: 0 or 1 per heal ability;
     *  summed across the cast's heal abilities). `perTarget` carries the actually-applied
     *  amount per recipient (raw heal); `overheal` and `didCrit` are present when the
     *  engine tracks them for that recipient.
     *
     *  ⚠️ `amount` IS NOT "HEALING DONE" (#362). A recipient carrying `Reversed Repairs`
     *  takes the repair as raw HP damage instead, and R10′ books the healer NOTHING for it —
     *  yet the event still fires, because it is also the signal every on-repair TRIGGER keys
     *  off (R9, Zosimos's own charge passive: "when an enemy performs a repair"; Ruiner's
     *  Bomb; Overload; Amartya). The repair was cast; it simply did not repair. So the
     *  reversed portion is MARKED rather than removed: `reversedAmount` at the top level and
     *  `reversed: true` per entry. Any consumer computing HEALING must subtract it — see
     *  `battleSimulator.ts`'s healDone/healReceived fold. Any consumer asking "did a repair
     *  happen" must keep ignoring it. */
    | ({
          type: 'heal-performed';
          casterId: string;
          targets: string[];
          round: number;
          amount: number;
          critHits?: number;
          /** #362 R10′: the portion of `amount` that was REVERSED into damage on its recipient
           *  and therefore healed nobody. Present only when > 0. `amount − reversedAmount` is
           *  the healing this cast actually did; when they are equal the cast healed nothing at
           *  all and still legitimately emitted (the triggers above need it). */
          reversedAmount?: number;
          /** Summed CLIPPED EXCESS of this cast's repair on the heal target (heal raw minus
           *  the HP actually consumed). Present only when > 0. Consumed by the
           *  on-own-repair-to-ally listener to scale an `overheal`-basis reactive shield
           *  (Abundant Renewal); ignored by every other heal-performed listener. */
          overheal?: number;
          /** Per-recipient breakdown: one entry per recipient in application order.
           *  `amount` is the raw heal applied to that recipient; `overheal` is the
           *  wasted portion (present only when > 0, player-side heal target only);
           *  `didCrit` is present when the ability crit (player/enemy-side heal);
           *  `reversed` (#362) marks an entry whose `amount` was burned off that
           *  recipient's HP rather than restored to it — present only when true, and
           *  mutually exclusive with `overheal` (a reversed repair wastes nothing, it
           *  damages). Always populated by the engine; absent only in hand-crafted test emits. */
          perTarget?: {
              targetId: string;
              amount: number;
              overheal?: number;
              didCrit?: boolean;
              reversed?: true;
          }[];
      } & ReactiveStamp)
    /** A shield-application cast resolved (one event per cast, not per recipient).
     *  `granterId` is the acting actor that applied the shield(s) — named granter (not
     *  caster) because Resonating Fury is granter-scoped and listens on this;
     *  `recipientIds` are the recipients the grant RESOLVED onto — RF's buff targets;
     *  `amount` is the total shield actually granted this cast (POST-CAP pool growth).
     *
     *  ⚠️ #418 — the emit gate is the GROSS attempt, not the pool growth. A grant onto an
     *  already-saturated pool DID happen (the recipient was simply already full), so it emits
     *  with `amount: 0` and the clipped portion in `overshield`. This mirrors `heal-performed`,
     *  which gates on gross `healRawSum > 0` and carries the clip in `overheal`; before #418 the
     *  shield path gated on post-cap growth — the opposite rule — and a saturated recipient
     *  silently failed to fire `on-shield-applied` (Resonating Fury). Only a grant that applied
     *  NOTHING AT ALL — a dead recipient, or a zero-magnitude grant — is silenced.
     *
     *  `recipientIds` therefore lists every RESOLVED recipient, including one whose pool did not
     *  grow. Consumers wanting "actually gained pool" must read `perTarget[].amount > 0`. */
    | ({
          type: 'shield-applied';
          granterId: string;
          recipientIds: string[];
          round: number;
          amount: number;
          /** #418: the portion of the gross grant clipped by the max-HP cap, summed across
           *  recipients. The shield twin of `overheal`. Present only when > 0, so every cast that
           *  clips nothing emits the exact shape it emitted before #418. */
          overshield?: number;
          /** Per-recipient breakdown: one entry per RESOLVED recipient (mirrors `recipientIds`).
           *  `amount` is the post-cap pool growth for that recipient — 0 when its pool was already
           *  saturated — and `overshield` that recipient's clipped portion, present only when > 0.
           *  Always populated by the engine; absent only in hand-crafted test emits. */
          perTarget?: { targetId: string; amount: number; overshield?: number }[];
          /** #424: this application did NOT come from a cast. The two engine LEECH sites convert
           *  damage into shield off a passive, with no skill of their own — so `buildCombatLog`
           *  must NOT call `consumePendingSkill()` for them. That call is not cosmetic: the tag
           *  is a single-use token, so a leech row consuming it both mislabels ITSELF with an
           *  unrelated skill's slot AND steals the tag from the cast row that earned it. Measured:
           *  without this flag Malvex's fingerprint gained `shield:active` in the `plain` and
           *  `wounded` scenarios — the pinned #296/#297 regression, whose whole point is that
           *  Malvex's ACTIVE self-shield fires only against a shielded target, read as broken.
           *  Set only by the leech sites; a cast or reactive grant leaves it absent. */
          uncast?: true;
      } & ReactiveStamp)
    /** A drain-time REACTIVE damage proc or counter-attack resolved. It emits NO
     *  `ability-performed`, which would re-trigger the on-crit / on-deal-damage cast riders.
     *  buildCombatLog surfaces it, and `on-ally-crit` subscribes for a critting one ("When an ally
     *  critically hits" counts passive damage — ruling 53). `sourceId` = the reacting owner;
     *  `targetId` = the victim; `amount` = the mitigated/credited damage; `didCrit` when it crit. */
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
     *  NOT EMITTED FOR A ZERO-GROSS REPAIR. The executor gates this
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
          /** Per-recipient raw repair. `overheal` is that recipient's CLIPPED EXCESS (raw minus
           *  the HP actually consumed), present only when > 0 — mirroring
           *  `heal-performed.perTarget.overheal`, and read by the on-own-repair-to-ally listener
           *  so an `overheal`-basis reaction can scale off a REACTIVE repair (#434). Absent
           *  outside healing mode, where `applyHealToTarget` never runs. */
          perTarget: { targetId: string; amount: number; overheal?: number; didCrit?: boolean }[];
          /** >= 1 when a repair in this event crit (one draw per repair), absent otherwise —
           *  mirrors `heal-performed.critHits`, which the crit-repair listeners read. */
          critHits?: number;
          /** `Ability.id` of the intent that produced this repair. The re-entrancy key for the
           *  on-own-repair-to-ally guard (#434): a listener ignores an event its OWN ability
           *  emitted, so a redirect cannot redirect itself, while every other observer still
           *  sees the repair.
           *
           *  ⚠️ IN-MEMORY ROUTING KEY ONLY — never serialise it. `nextId()` runs off a
           *  module-level counter that is never reset (`let counter = 0` in buildShipAbilities),
           *  so an ability's id depends on how many kits were built before it in the process. Put
           *  this in a golden, a snapshot or a combat-log row and the artefact becomes
           *  order-dependent. */
          sourceAbilityId?: string;
      } & ReactiveStamp)
    /** A drain-time REACTIVE cleanse resolved (executeIntent cleanse branch — e.g. Nuqtu's
     *  start-of-turn self-cleanse, AEGIS's on-ally-shield-destroyed "cleanses all debuffs").
     *  The reactive cleanse credits `cleanseCount` but emits NO `cleanse-performed` (that event
     *  drives the owner's own on-own-cleanse listeners). buildCombatLog renders it, and the
     *  OPPOSING side's `on-enemy-cleansed` reactions (Pestilence, Larkspur, Grif …) hear a
     *  remove-mode one — never a `mode: 'reduce-duration'` one. `casterId` = the reacting owner;
     *  `perTarget` = per-recipient count of debuffs ACTUALLY removed (only recipients with >= 1
     *  removal are listed). */
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
    /** ASSEMBLER-ONLY: one `Repair Over Time` tick restored HP to its holder (playerTurn's
     *  `tickHot`). NOT a repair event and NOT a log event — it exists for exactly one consumer,
     *  `battleSimulator.ts`'s `healReceived` fold, and has NO subscriber anywhere in the engine.
     *
     *  ⚠️ THAT CONSUMER IS NOW THE FALLBACK ARM (#375). `healingReceived` is READ from
     *  `hp-snapshot.repairReceived` whenever the engine supplies it, which every real run does; the
     *  `healReceived` fold below survives for hand-built event streams alone. So on a real run this
     *  event feeds nothing — it is kept because that fallback arm is still reachable, and because
     *  it is still the only signal a tick produces at all. Everything the next paragraphs say about
     *  the derived path therefore describes the fallback, not what the Simulator shows. In
     *  particular the GROSS/consumed difference is now visible: the axis books the tick's gross,
     *  this event books what landed, so an over-repairing HoT reports differently on the two arms.
     *
     *  ⚠️ AND IT FEEDS THE RECEIVED AXIS ONLY — never `healingDone`. #383 gave that column its own
     *  per-source axis and deliberately left ticks off it (locked ruling R2, #367: a tick is not a
     *  repair PERFORMED). If you are ever tempted to credit a tick's holder with having done it,
     *  that is the ruling you would be breaking.
     *
     *  WHY IT EXISTS. `assembleBattleResult` does not read `currentHp`; it DERIVES each ship's
     *  `hpPct` as `maxHp − hpLost + healed`, and `healed` was accumulated exclusively from
     *  `heal-performed.perTarget`. A HoT tick emits no `heal-performed` (see R2 below) and
     *  `RoundData` carries no healing buckets, so before this event every HoT tick was HP the
     *  Simulator's bar, its low-HP colour, its `N% HP` aria-label, the round card's "HP"/
     *  "Healing received" figures — and its BOARD-CELL EFFECT MARKER — could not see.
     *  `boardOverlays.ts`'s `effect` is a 3-way priority — `damageTaken` → `healingReceived` →
     *  `shieldsAbsorbed` — so a holder that ticked and took NO damage that round now shows a HEAL
     *  marker on its cell, where before it showed a shield marker or none at all. (A holder that
     *  also took damage is unaffected: damage still wins.) Correct, and listed here because it is a
     *  consumer this doc's enumeration originally missed. #369 made that hole general: while the HoT block
     *  was wrapped in `if (!healEventOnly)` and `tickHot` returned early off-anchor, only the
     *  player-side ANCHOR holder ever gained HP from a tick, so the derived bar diverged for
     *  exactly one ship; once every holder on both sides ticks, it diverges for every one of them.
     *
     *  R2 IS WHY THIS IS NOT A `heal-performed`. A HoT tick is not a "performed repair": it fires
     *  no on-repaired trigger and emits no `heal-performed`, on either side (fenced on both arms in
     *  `enemySideHotTick.test.ts`). Reporting the tick must therefore not go through the repair
     *  event, and this event must stay inert: NOTHING may subscribe to it. Subscribing would arm a
     *  reaction off a tick and break R2 through the back door — the same reason the reversed-repair
     *  path deliberately withholds `hp-changed` (engine.ts, #362 M-2). This is also NOT a claim
     *  about `repairedThisRound`: a tick does arm the `'target-repaired-this-round'` CONDITION, a
     *  different channel, and conflating the two is a documented hazard on this file's history.
     *
     *  NO DOUBLE-COUNT: `tickHot` is the only emit site, and the HoT block is the one repair
     *  channel that emits no `heal-performed`, so the assembler's two inputs are disjoint by
     *  construction. It is deliberately NOT emitted from the shared `applyHealToTarget`, which
     *  every repair channel funnels through — a cast repair would then be counted twice.
     *
     *  `amount` is the HP ACTUALLY RESTORED (`applyHealToTarget`'s `consumed`), not the tick's
     *  gross: overheal never moved the bar, so crediting the gross would over-report it. A
     *  REVERSED tick (#362) emits nothing at all — it removed HP, and that loss is already on the
     *  victim's intake axis via `bookReversalDamage`. `holderId` is the ship whose HP moved;
     *  `applierId` names who granted the HoT (absent for a scheduled/self-attributed grant) and is
     *  carried for future display only — no consumer reads it today. */
    | {
          type: 'hot-ticked';
          holderId: string;
          applierId?: string;
          round: number;
          amount: number;
      }
    /** A cleanse cast resolved. `casterId` is the cleansing actor; `count` is the number of
     *  debuffs ACTUALLY removed. Team-symmetric (the enemy-cleanse-lift, #166-era): BOTH the
     *  player path and the enemy (event-only) path perform REAL removal via the side-agnostic
     *  `statusEngine.cleanse` over `recipientsFor`'s side-aware recipients, and the event is
     *  suppressed on both sides when 0 debuffs were removed. The `on-enemy-cleansed` listener
     *  filters by `isOpposing(casterId)`; the `on-own-cleanse` listener filters by
     *  `casterId === ownerId`. */
    | ({
          type: 'cleanse-performed';
          casterId: string;
          count: number;
          round: number;
          /** The recipient ids that ACTUALLY had >= 1 debuff removed (a subset of
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
     *  does not re-emit; stricter than the lineage rule `reactionKey`, see that field's doc).
     *  `on-enemy-purged` filters `casterId === ownerId`;
     *  `on-ally-purged` filters `!isOpposing(targetId)` — same-side, owner included (the
     *  2026-09-30 "an ally includes the caster" ruling — see triggers.ts's trigger doc block). */
    | ({
          type: 'purge-performed';
          casterId: string;
          targetId: string;
          count: number;
          round: number;
          /** The purge wave this event belongs to: one purge ability's removals across every enemy
           *  it struck, emitted together once all of them resolved. `waveTotal` is the buffs the
           *  whole wave removed; `waveLead` marks the wave's first event. A wave-wide reaction
           *  (Sefuba's one repair per cast, 12% per buff removed) fires on the lead and reads the
           *  total; a victim-scoped one (Salvation, Sefuba's extra purge) fires on every event.
           *  Absent (hand-built emits) → a wave of this event alone. */
          waveTotal?: number;
          waveLead?: boolean;
      } & ReactiveStamp)
    /** A buff STEAL moved something. Sibling of `purge-performed`, and like it, SUPPRESSED when
     *  nothing actually moved (an empty return from `statusEngine.steal` / `stealStacks` opens no
     *  log row).
     *
     *  WHY THIS EXISTS. Buff steal shipped in PR10 with no event at all, which cost two things
     *  that only became visible once Protection became stealable (#465): the combat log could not
     *  show a steal — a player watched a buff vanish with no row explaining it — and the kit
     *  FINGERPRINT suites, which record the set of combat-log entry KINDS per actor, were
     *  structurally blind to the whole mechanic. Pallas, Thresh and Tithonus had never had a
     *  golden observing their steals.
     *
     *  `casterId` = the thief. `targetId` = the SOURCE it took from — not necessarily the cast's
     *  own target, since a named top-up resolves its own source. `recipientIds` is who ended up
     *  holding the result: the caster alone for Pallas/Thresh, the caster PLUS its adjacent allies
     *  for Tithonus, whose clause DUPLICATES rather than splits (owner ruling 2026-09-03), so a
     *  reader must not infer "one buff moved per recipient".
     *
     *  `buffNames` is what actually moved, in the order it moved — repeated names are meaningful:
     *  two entries of 'Protection' means two STACKS, which is how a top-up reports its deficit.
     *
     *  NO REACTIVE TRIGGER SUBSCRIBES TO THIS, deliberately: no corpus ship reacts to a steal in
     *  either direction. Wiring an `on-buff-stolen` surface before a kit needs it would be a dead
     *  channel of the kind that has bitten this engine repeatedly. Carries `ReactiveStamp` anyway
     *  so a future reactive EMITTER nests correctly in the log. */
    | ({
          type: 'steal-performed';
          casterId: string;
          targetId: string;
          recipientIds: string[];
          buffNames: string[];
          round: number;
      } & ReactiveStamp)
    | {
          type: 'dot-ticked';
          targetId: string;
          round: number;
          // Widened to the full DoTType — a generic-DoT tick emits
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
     *  for `processBombs` and for Lingshe's forced early detonation via
     *  `bomb-countdown-reduce`; the attacker-turn `detonate()` aggregate branch emits the
     *  casting `actor.id` instead. Any actor, not always 'attacker'. `victimId` = the actor
     *  the bomb detonated ON (the bomb's holder) — distinct from `actorId`, which stays the
     *  applier/caster per the above. Anchors Demolisher's adjacent-enemy splash.
     *  `detonatorId` (Lingshe) = the actor who ACTIVELY caused this burst — the
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
     *  only such effect in the corpus) burst on its holder: its countdown ended, or a duration
     *  cut drove it to 0.
     *  ONE event per detonating entry, emitted from `processAccumulators` beside the burst's
     *  `creditDetonation`, mirroring `processBombs`/`emitBombDetonated` — and from
     *  `reduceAccumulatorsOnVictim` when a duration cut drives one to 0 (owner ruling R113).
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
     *  `detonatorId` counterpart: no listener asks who forced an Echoing Burst to burst.
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
     *  `effect` is the control effect (e.g. 'stasis'); `targetId` is the actor it landed on. One
     *  event per recipient its paired named status landed on (none for a recipient that resisted
     *  it); none when every recipient's condition gate turned the paired status away; a control
     *  whose paired status never reached the gate at cast time (or has none) emits once, naming
     *  the cast's bound target (the caster itself for a self control such as Taunt). Emitting it
     *  does NOT simulate the control's combat effect. */
    | ({
          type: 'control-applied';
          casterId: string;
          targetId: string;
          effect: ControlEffect;
          round: number;
      } & ReactiveStamp)
    /** A caster's ability actually reduced a victim's shield
     *  pool via `stripShieldPct` (playerTurn.ts) — EITHER the I6 (Lodolite) purge-coupled 100%
     *  strip, OR a standalone `type:'shield-strip'` ability (APEX/Laika/Malvex).
     *  Emitted ONLY when the pool was > 0 immediately before the strip (a strip attempt against
     *  an already-empty pool removes nothing and is suppressed) — mirrors `purge-performed`'s
     *  0-removed suppression. `casterId` = the stripping actor; `targetId` = the victim whose
     *  shield was reduced; `pct` = the percentage of the CURRENT pool removed (the same `pct`
     *  argument passed to `stripShieldPct` — 100 for the purge-coupled branch, `ab.config.pct` otherwise).
     *  The `on-own-shield-strip` listener (triggers.ts) filters `casterId === ownerId`. */
    | ({
          type: 'shield-stripped';
          casterId: string;
          targetId: string;
          round: number;
          pct: number;
      } & ReactiveStamp)
    /** Corrosion SPREAD (Hemlock) at the end of a round. The
     *  engine's end-of-round Toxic Overflow mechanic (engine.ts) emits this for each unit that held
     *  Toxic Overflow AND ≥1 stack of Corrosion, after inflicting Corrosion I (3 turns) on that
     *  unit's adjacent allies — each a real infliction by the Toxic Overflow's applier, with its own
     *  landing roll and `dot-applied` — and removing its Toxic Overflow. `sourceId` = the unit that
     *  held Toxic Overflow (the spread origin); `affectedIds` = the adjacent allies the Corrosion I
     *  LANDED on (possibly empty: none adjacent, or every one resisted). Team-symmetric — emitted
     *  for holders on either side. Hemlock's `on-corrosion-spread` self-heal (triggers.ts) rides it,
     *  scaling by `affectedIds.length` ("per enemy affected"), scoped to spreads whose `sourceId`
     *  opposes the reactor. */
    | ({
          type: 'corrosion-spread';
          sourceId: string;
          affectedIds: string[];
          round: number;
      } & ReactiveStamp)
    /** A victim's shield pool was fully depleted by a DIRECT hit (AEGIS). Emitted from
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
     *   - Tank-side: once per HP-INTAKE EVENT inside
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
     *  killerId undefined). Optional. Read by Faust's on-destroyed purge, and by an
     *  `on-enemy-destroyed` reaction scoped to its owner's kills (`Ability.triggerKillerScope`). */
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
    /** LOG-ONLY (#362 R11): a `Reversed Repairs` carrier took an incoming repair as raw HP damage.
     *  Emitted on EVERY reversal, lethal or not — a non-lethal one otherwise produces no event at
     *  all, leaving the player to watch a repair land, achieve nothing and HP drop with nothing
     *  connecting the three. NO combat listener subscribes (cannot chain); it exists solely for
     *  buildCombatLog. Buffered through `emitConsequenceLog` so a reversal inside a deferral window
     *  nests under the attack that raised it.
     *
     *  `applierId` is the actor that inflicted the status — the same actor the burn's damage and
     *  any resulting kill are credited to (R7′), NOT the healer whose repair was reversed. Absent
     *  when the status came from the calculator's hand-selected enemy-debuff picker, which carries
     *  no applier identity. `amount` is the full face value burned (pre-clamp, post-crit).
     *
     *  `healerId` (#362 fix-wave-1) is the actor whose repair got reversed — `repairSourceId` at
     *  the `applyHealToTarget` call site. It is carried SOLELY so the log line can name the repair
     *  that was undone ("Zosimos → Nova: Medic's repair reversed 10,000"); it is a DISPLAY field
     *  ONLY. `applierId` remains this entry's attribution — the sole id credited via `creditDealt`
     *  and the sole candidate for `killerId` — and nothing about R7′ changes: the healer's identity
     *  does not re-enter the damage/kill attribution through this field. Do not read `healerId` for
     *  anything but rendering. */
    | ({
          type: 'reversed-repair-log';
          victimId: string;
          applierId?: string;
          healerId?: string;
          amount: number;
          round: number;
      } & ReactiveStamp)
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
     *  average. Aggregating it for DISPLAY is fine. What would be a bug is subscribing a
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
    /** LOG-ONLY: an end-of-round snapshot of one actor's REAL HP and shield pool. Emitted once
     *  per actor at the round tail, in the same loop as
     *  `status-snapshot` and under the same log-only contract: no `ReactiveStamp`, and no combat
     *  listener subscribes to it.
     *
     *  WHY IT EXISTS (#372). `assembleBattleResult` used to DERIVE each ship's HP as
     *  `(maxHp − hpLost + healed) / maxHp`, accumulating `healed` from `heal-performed.perTarget`.
     *  `heal-performed` has exactly ONE production emit site (playerTurn.ts, the cast path), so
     *  every other channel that restores HP was invisible to the Simulator's HP bar, its low-HP
     *  colour, its aria-label and its "Healing received" figure — reactive repairs, every leech
     *  site, and Cheat Death survival at 1 HP (which rendered as 0%). `hot-ticked` was added to
     *  patch one instance of that hole; this event closes it for the BAR by reporting the engine's
     *  own `currentHp` instead of re-deriving it.
     *
     *  AUTHORITATIVE for the actors it names — the assembler PREFERS it over its accumulation, the
     *  same contract `status-snapshot` has. The derived path remains as a fallback purely for
     *  hand-built event streams (see `battleAssemble.test.ts`), which name no actor here.
     *
     *  `repairReceived` (#375) closes the SECOND axis the same way: the HP repaired ONTO this actor
     *  this round, READ off the engine's per-recipient healing axis
     *  (`currentRoundRecipientHealing`) instead of re-accumulated from events. That axis covers
     *  every repair channel — cast, HoT tick, both per-victim leeches, reactive — on both sides,
     *  once #375 lifted the two enemy-side credit arms that were missing from it.
     *
     *  GROSS, deliberately: `directHeal + hotHeal`, the repair that ARRIVED, before overheal
     *  clipping. A full-HP ally repaired for 10k reports 10,000 received and 10,000 wasted — the
     *  contract `healingReceived` has always been held to (pinned on BOTH sides in
     *  `reversedRepairs.engine.test.ts`). `effectiveHeal` would read 0 for every wasted repair.
     *
     *  `repairPerformed` (#383) closes the THIRD axis, the SOURCE counterpart of `repairReceived`:
     *  the HP this actor REPAIRED onto anyone this round, itself included. `healingDone` used to
     *  sum `heal-performed.casterId`, so it reached the cast channel only — a leecher reported 0
     *  done beside 800 received, and a reactive repairer credited nobody at all. Read off a
     *  side-agnostic per-source axis (`currentRoundSourceRepair`) credited at every site whose
     *  pool application succeeds: both per-victim leeches, the reactive executor, and BOTH cast
     *  arms. That last one matters — the cast channel already reported correctly on both sides
     *  (measured), so an axis that omitted it would have zeroed every medic while fixing the leech.
     *
     *  It is a SIBLING of the engine's `perActor` source axis, not a widening of it. `perActor` is
     *  PLAYER-ONLY by design (E5 §4.1 — an enemy heal must not enter the player healing buckets)
     *  and stays that way; this axis has no side, exactly like `repairReceived`.
     *
     *  A HoT TICK IS DELIBERATELY ABSENT from it (locked ruling R2, #367: a tick is not a repair
     *  PERFORMED — no `heal-performed`, no on-repaired trigger). `repairReceived` books ticks and
     *  `repairPerformed` does not; the asymmetry between the two fields is the contract, not a gap.
     *
     *  GROSS and reversal-suppressed on the same terms as `repairReceived`: the raw that arrived,
     *  pre-overheal-clipping, and nothing at all for a repair a `Reversed Repairs` recipient took
     *  as damage (#362 R10′ — a reversed repair heals for nothing and stays off BOTH axes).
     *
     *  ABSENT (not 0) when the run has per-recipient accounting off — a legacy single-target
     *  healing run, where the axis is empty by design. The assembler falls back to its event
     *  accumulation there, so absent means "not measured" while 0 means "measured, none landed". */
    | {
          type: 'hp-snapshot';
          actorId: string;
          round: number;
          currentHp: number;
          maxHp: number;
          shieldPool: number;
          repairReceived?: number;
          repairPerformed?: number;
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
     *  `simulateDPS` reads the same event for the DPS calculator's per-round chips, filtered to
     *  the focus actor and the REAL enemy roster — the vestigial dummy also emits here, but it keys its
     *  debuffs under the `__enemy__` sentinel rather than its actor id, so its lists are always empty. */
    | {
          /** LOG-ONLY. A cast's passive-slot damage instance (an on-cast `damage` ability on the
           *  passive slot) landing on one victim, right after the firing hit. It
           *  emits no `attacked` — it is not a separate attack — so the combat log adds `damage`
           *  to the open attack row's entry for `targetId`. `damage` is on the same basis as
           *  `attacked.damage`: post-victim-defence, pre-funnel. No combat listener subscribes. */
          type: 'passive-slot-damage';
          attackerId: string;
          targetId: string;
          round: number;
          damage: number;
      }
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
     *  fired damage ability, after the aggregate shield-first drain
     *  so all events observe the same post-drain HP/shield state. A manual flat enemy
     *  or a noCrit damage ability falls back to one event per attack turn (the pre-4c
     *  contract). DoT ticks, bomb detonations, and accumulators never emit it — only
     *  direct weapon hits. The tank-side `hp-changed` event is per-HP-intake-event
     *  (attacks AND DoT batches), so a 3-hit attack emits 3 `attacked` but a single
     *  `hp-changed`; the granularity asymmetry is intended. */
    | {
          type: 'attacked';
          targetId: string;
          attackerId: string;
          round: number;
          didCrit?: boolean;
          /** Direct damage this SUB-ATTACK dealt to this victim, AS THROWN — NOT the per-TURN
           *  aggregate, and NOT what the victim ended up taking. Pre-funnel: a Protection cascade
           *  may have moved a slice of it to a protector, an incoming-block proc may have shaved
           *  one. Present only when a damage aggregate is in scope. The combat log's row
           *  `amount` reads this, for the primary target and splash alike. Anything sized on what the victim TOOK reads `takenDamage`
           *  below. */
          damage?: number;
          /** What this victim actually TOOK from this sub-attack: the funnel's own recorded
           *  intake (`VictimDamageOutcome.incomingBooked`) — post-Protection-cascade,
           *  post-incoming-block, excluding a slice deferred into a DoT, and INCLUDING damage a
           *  shield absorbed.
           *
           *  Owner ruling 2026-09-03: this is the basis for `basis:'damage-taken'` reactives
           *  (Adaptive Plating) AND for the `requireIncomingDamageFracOfMaxHp` threshold gate
           *  (Tenacity) — one figure, both uses; the split was offered and declined. It matches
           *  the taken-leech basis ruled in PR #464.
           *
           *  A SEPARATE field from `damage` for the same reason `ability-performed` carries
           *  `deliveredDamage` beside its own `damage`: `damage` has its own consumers, the
           *  combat log among them. Legitimately 0 (a fully redirected hit), so consumers must
           *  test for `undefined`, never falsiness. Present only on the positional path — the
           *  non-positional emit has no funnel outcome in scope, so consumers fall back to
           *  `damage` there. */
          takenDamage?: number;
          /** True when this hit is a PRIMARY-TARGET hit (owner ruling R92): a cast's hit on its
           *  anchor, or a counter's / proc's hit that is the first aimed hit on this victim in
           *  its sub-attack's reaction chain (engine.ts `primaryHitsSpent`). False/absent for
           *  splash/covered AoE victims and for a later hit in the same chain. Every "directly
           *  damaged as a primary target" trigger gates on this. */
          isPrimaryTarget?: boolean;
          /** True when this hit actually reduced the victim's shield pool
           *  (absorbed > 0). Sourced from the shield-first drain at the emit
           *  (shieldBefore > 0 && hpDamage < damage && !barriered && !converted). Nyxen's counter
           *  gates on this. False/absent when no shield was present, the hit fully
           *  penetrated to HP, a Barrier blocked it (shield untouched), or Shield Converter
           *  converted the hit (shield gained, not drained). */
          shieldWasHit?: boolean;
          /** The 0-based sub-attack of the ATTACKER's cast that produced this hit. The engine emits
           *  one `attacked` per (sub-attack, victim); this names which sub-attack, so a victim-side once-per-attack guard can reset between the
           *  attacker's consecutive attacks instead of collapsing all N into one. ALWAYS present
           *  on a real `attacked` event, positional or not: `emitAttacked` stamps
           *  `subAttackIndex ?? hitIndex` unconditionally on every path, falling back to the
           *  per-hit loop index when the caller supplies no sub-attack identity. Optional here
           *  only so hand-built fixture events can omit it. */
          subAttackIndex?: number;
          /** Present on the `attacked` a counter-attack or reactive damage proc raises (every
           *  non-DoT, non-Bomb hit is direct damage — ruling 36): a fresh id per such hit, so the
           *  victim's once-per-attack guards treat each one as its own attack. Absent on a cast
           *  hit. The combat log renders these hits from `reactive-damage-performed` instead. */
          reactiveHitId?: number;
          /** The hit is a counter-attack. Every reaction hears it except a counter that
           *  `counterAnswersCounters` (triggers.ts) excludes. */
          fromCounter?: true;
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
                listener(event);
            }
        },
    };
}

/**
 * Accumulator for the THREE `shield-applied` emit sites — the cast path, the enemy (event-only)
 * cast path (both in `playerTurn.ts`) and the reactive executor (`triggers.ts`).
 *
 * It exists because #418 moved the emit gate from post-cap pool growth onto the GROSS attempt, and
 * that rule has to hold identically at all three. Before #418 the three sites carried three
 * hand-copied `if (granted > 0)` blocks and the shipped comment at one of them claimed it
 * "mirrors the heal-performed emit below" when it did the precise opposite. One accumulator, one
 * rule: `add()` per recipient, then `emit` only when `shouldEmit` — see the `shield-applied` doc
 * above for the ruling.
 */
export class ShieldApplyAccumulator {
    readonly recipientIds: string[] = [];
    readonly perTarget: { targetId: string; amount: number; overshield?: number }[] = [];
    private grantedSum = 0;
    private grossSum = 0;

    /** Book one recipient's grant outcome. A grant that applied nothing at all (`gross <= 0` — a
     *  dead recipient, or a zero-magnitude grant) is NOT booked: it never happened, so it must
     *  neither appear in `recipientIds` nor open the emit gate. */
    add(targetId: string, outcome: { granted: number; gross: number }): void {
        if (outcome.gross <= 0) return;
        const clipped = outcome.gross - outcome.granted;
        this.recipientIds.push(targetId);
        this.grantedSum += outcome.granted;
        this.grossSum += outcome.gross;
        this.perTarget.push({
            targetId,
            amount: outcome.granted,
            ...(clipped > 0 ? { overshield: clipped } : {}),
        });
    }

    /** True once ANY grant resolved onto a recipient — the shield twin of `healRawSum > 0`. Note
     *  this is deliberately NOT `grantedSum > 0`: a fully-clipped grant onto a saturated pool has
     *  `grantedSum === 0` and MUST emit. */
    get shouldEmit(): boolean {
        return this.grossSum > 0;
    }

    /** Total POST-CAP pool growth — the event's `amount`. 0 for an entirely-clipped cast. */
    get amount(): number {
        return this.grantedSum;
    }

    /** The `overshield` spread: present only when something was clipped, so a cast that clips
     *  nothing emits the exact shape it emitted before #418 and no existing fixture moves. */
    get overshieldFields(): { overshield?: number } {
        const clipped = this.grossSum - this.grantedSum;
        return clipped > 0 ? { overshield: clipped } : {};
    }
}
