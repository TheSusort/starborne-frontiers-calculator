import {
    Ability,
    AbilityTrigger,
    LIVE_TRIGGERS,
    ShipSkills,
    SkillSlot,
} from '../../types/abilities';
import { matchesRoleCategory } from '../../constants/shipTypes';
import type { ShipTypeName, ShipRoleCategory } from '../../constants/shipTypes';
import {
    DoTType,
    EnemyBaseClass,
    ParsedBuffEffects,
    SelectedGameBuff,
} from '../../types/calculator';
import type { AffinityName } from '../../types/ship';
import { PERSISTENT_STACKING_BUFFS } from '../../constants/persistentStackingBuffs';
import { conditionsMet } from '../abilities/evaluateConditions';
import { buildRoundContext, dotFamilyCounts } from '../abilities/roundContext';
import { makeRateGate } from '../calculators/rateAccumulator';
import { computeAffinityModifiers } from '../calculators/affinityUtils';
import { expandEnemyDebuffs, payloadToSelectedBuff, expandBuffEntry } from './buffTotals';
// Call-time-safe cycle: debuffImmunity imports selfBuffNamesForOwners from this module and we
// import targetCarriesBlockDebuff back. Both are used only inside function bodies (never at
// top-level evaluation), so there is no initialization-order hazard.
// eslint-disable-next-line import/no-cycle
import { targetCarriesBlockDebuff, emitBlockDebuffResist, dotResistLabel } from './debuffImmunity';
// eslint-disable-next-line import/no-cycle
import { recipientCarriesBlockBuff } from './blockBuffBuffs';
// Call-time-safe cycle (same shape as blockBuffBuffs.ts above): barrierRecharging imports
// selfBuffNamesForOwners from this module and we import holdsBarrierRecharging back. Both are
// used only inside function bodies, so there is no initialization-order hazard.
// eslint-disable-next-line import/no-cycle
import { holdsBarrierRecharging, BARRIER_RECHARGING } from './barrierRecharging';
import { BARRIER_BUFFS } from './barrierBuffs';
import { resolveSupportRecipients } from './supportRecipients';
import { reduceBombsOnVictim } from './bombCountdown';
import { liveGateConditions } from './abilityStatusGating';
import { CombatEvent, CombatEventBus, CombatEventType } from './events';
import { CombatActor, ActiveDoTStack, PendingBomb } from './state';
import {
    ActiveBuff,
    AbilityStatusPayload,
    DEFAULT_ENEMY_TARGET,
    RegisteredAbilityStatus,
    StatusEngine,
} from './statusEngine';
// Type-only import (erased at runtime) → no circular-import cycle even though playerTurn.ts
// imports buildActorConditionContext/ReactiveAbility from this module.
import type { PlayerActorRuntime, PlayerRoundCtx, HealingRuntimeCtx, RateGate } from './playerTurn';
import type { ActorTargetingStatus } from './positionalBinding';

/** The trigger values the engine consumes — defined next to AbilityTrigger in
 *  types/abilities.ts (so UI consumers don't import the engine for one constant)
 *  and re-exported here for the machinery's callers. `start-of-round` maps onto
 *  the `round-started` event (one per round, before any turn — see the
 *  AbilityTrigger doc note). */
export { LIVE_TRIGGERS };

/** Safety backstop far above any real follow-up chain — not a tuned value. A
 *  drain that fans out more than this many generations is a pathological loop;
 *  the engine throws naming the constant rather than hanging. */
export const MAX_INTENT_GENERATIONS = 10;

/** Ability types the executor knows how to follow up (see executeIntent). These reactive
 *  types are routed through the trigger machinery; any other type carrying a live trigger
 *  stays on the on-cast path (not-simulated follow-up payloads — e.g. control from a
 *  bomb-detonate reactive). heal/shield/cleanse are routed too (Task 9) but only DO anything
 *  in healing mode — in DPS mode the executor's healing-ctx-off guard makes them inert.
 *  `damage` (Phase 4c PR 4 — Grif's on-enemy-cleansed "75% Damage that cannot critically hit")
 *  is reactive ONLY when its trigger is in LIVE_TRIGGERS. SAFETY: `on-cast` is NOT a live
 *  trigger, so every normal on-cast damage ability stays on the cast path — only damage
 *  abilities carrying a live trigger route reactively. */
export type ReactiveAbilityType =
    | 'buff'
    | 'debuff'
    | 'dot'
    | 'charge'
    | 'heal'
    | 'shield'
    | 'cleanse'
    | 'extra-action'
    | 'damage'
    | 'counter' // G PR1: counter-attack reactive (on-attacked) — no parser produces it until Task 5
    | 'purge' // C2b-1: purge can be reactive — Sefuba on-enemy-purged chain
    | 'remove-self-buff' // Overload lifecycle: reactive self-buff removal (on kill/repair/debuff)
    | 'convert-dot'; // SP-E, Task E4: Belladonna's ally-Corrosion→Acidic-Decay conversion

/** Runtime mirror of ReactiveAbilityType for the partition check. */
const REACTIVE_ABILITY_TYPES: readonly ReactiveAbilityType[] = [
    'buff',
    'debuff',
    'dot',
    'charge',
    'heal',
    'shield',
    'cleanse',
    'extra-action',
    'damage',
    'counter', // G PR1: counter reactive — byte-identical (no fixture carries a counter ability)
    'purge', // C2b-1: purge can be reactive — Sefuba on-enemy-purged chain
    'remove-self-buff', // Overload lifecycle: reactive self-buff removal
    'convert-dot', // SP-E, Task E4: Belladonna's ally-Corrosion→Acidic-Decay conversion
];

/** A reactive ability registered as a listener, paired with its source slot
 *  (for parity with the timed-status sourceSlot bookkeeping). */
export interface ReactiveAbility {
    ability: Ability;
    sourceSlot: SkillSlot;
}

/** A queued follow-up execution. Listeners push these; the engine drains them.
 *  `ownerId` (Task 6) is the actor (either side) whose reactive ability fired — the executor
 *  routes charge/buff/debuff/dot follow-ups against THIS owner's runtime (its charges,
 *  its landing gates, its sourceId, its last-turn ctx for bombs). For an attacker-only
 *  run every Intent carries ownerId 'attacker' → identical routing to pre-Task-6. */
export interface Intent {
    ability: Ability;
    sourceSlot: SkillSlot;
    ownerId: string;
    /** Event context captured by the listener at enqueue time (per-event intents).
     *  `counterTargetId`: the attacking enemy's actor id for "on that enemy"
     *  counter-inflictions (Warden, Guardian's ally-Provoke) — the executor's debuff
     *  branch routes the application to THIS enemy's per-target store. Phase 3 PR-F:
     *  on-enemy-repaired also stamps this with the REPAIRER's id (Ruiner's Bomb).
     *  `damagedAllyId`: the DAMAGED ally's actor id (on-ally-attacked) — the heal and
     *  buff branches route an 'ally'-target payload to exactly this recipient
     *  (Cultivator's repair, Refine/Graphite's grants) instead of the default. Generic
     *  "route reactive ally-support here" field: also carries the inflicting/victim ally
     *  for debuff-event reactions (Oleander's on-ally-debuff-inflicted RoT grant routes to
     *  the inflicting ally; Hayyan's on-ally-debuffed repair routes to the debuffed ally).
     *  `fromPurgeEvent`: depth-1 purge chain guard — a purge triggered by a
     *  purge-performed event does not re-emit purge-performed, preventing infinite chains. */
    eventCtx?: {
        counterTargetId?: string;
        damagedAllyId?: string;
        fromPurgeEvent?: boolean;
        /** The sub-attack that raised the triggering event (multi-hit full-walk epic, PR4).
         *  Stamped by the OUTGOING listeners (`on-crit`, `on-deal-damage`) from
         *  `ability-performed.subAttackIndex`. Undefined for triggers with no attack identity
         *  (start-of-round / end-of-round) — those keep per-turn gating, which is correct for them.
         *  Read by `passesProcChanceGate`'s memo key, so `procScope:'per-attack'` means per
         *  sub-attack rather than per turn. */
        subAttackIndex?: number;
        /** The damage of the triggering event, used by a reactive heal/shield to scale off
         *  that hit rather than the owner's max HP. Two consumers: `basis:'damage-dealt'`
         *  (ability-performed.damage — damage the owner DEALT, e.g. Bloodthirst) and
         *  `basis:'damage-taken'` (attacked.damage — damage the owner TOOK, e.g. Adaptive
         *  Plating). NOTE: attacked.damage is the per-attack aggregate and on-attacked fires
         *  once per hit, so a non-oncePerRound damage-taken reactive would grant N times for
         *  an N-hit attack; Adaptive Plating's oncePerRound gate caps it to one grant/round.
         *  PR7: for `basis:'damage-dealt'` the on-crit listener prefers the event's
         *  `deliveredDamage` — what the sub-attack actually delivered, including a Protection
         *  cascade's redirected chunk and excluding a DoT-transformed portion. `damage` remains the
         *  fallback for the non-positional and DPS paths (PR5). */
        triggerDamage?: number;
        /** The triggering hit's crit outcome (on-attacked -> attacked.didCrit), read by the
         *  reactive cleanse executor to pick `critCount` over `count` (Reactive Ward). */
        didCrit?: boolean;
        /** G PR1: true when the owner was the primary (directly-targeted) victim of the
         *  triggering attack (on-attacked -> attacked.isPrimaryTarget). Stalwart's counter
         *  gates on this so splash/covered victims do not counter. */
        isPrimaryTarget?: boolean;
        /** G PR2: true when the triggering hit reduced the owner's SHIELD pool (absorbed > 0).
         *  Sourced at the `attacked` emit and copied here by the on-attacked listener. Nyxen's
         *  counter gates on this (`requireShieldHit`). */
        shieldWasHit?: boolean;
        /** The actor ids of the allies repaired by an on-own-repair-to-ally event
         *  (excludes the caster). The buff branch fans an 'ally'-target grant out to
         *  exactly these recipients (Font of Power -> repaired allies). */
        repairedAllyIds?: string[];
        /** The repairing actor's id (heal-performed.casterId), captured by the on-enemy-repaired
         *  listener. Used by the charge branch as the per-source key for an `everyNthEvent` gate
         *  AND as the single-target for "decrease THAT enemy's charge" (Zosimos). Phase 3 PR-F:
         *  ALSO used to key the debuff branch's oncePerRoundPerEnemy cap (Ruiner). */
        repairerId?: string;
        /** Phase 3 PR-F: the recipients of an on-enemy-repaired heal-performed event
         *  (heal-performed.targets — every healed enemy, unfiltered). Read by a
         *  `repairedRecipientTargeted` debuff (Amartya's "on that defender" Defense Shred),
         *  which fans out to EACH of these instead of routing to the repairer. Mirrors
         *  repairedAllyIds/shieldRecipientIds but for the OPPOSING side. */
        repairedEnemyIds?: string[];
        /** The DISTINCT enemies an ally's crit-ing attack actually critically hit
         *  (ability-performed.critVictimIds), stamped by the on-ally-crit listener. Read by the
         *  reactive `damage` branch so a "deals X% damage to that enemy" rider (Sentinel) fans out
         *  to EVERY enemy the ally crit rather than routing the whole proc onto the cast's
         *  SELECTED anchor — which, in an AoE, is frequently a victim that never crit. Mirrors
         *  repairedEnemyIds' fan-out shape. Never empty when present. */
        critVictimIds?: string[];
        /** The clipped overheal (heal-performed.overheal) carried from an own-repair-to-ally
         *  event, read by an `overheal`-basis reactive shield to scale off the over-repaired
         *  amount rather than the owner's max HP (Abundant Renewal). Aggregate fallback used when
         *  no per-ally breakdown is present (legacy single-target callers). */
        overhealAmount?: number;
        /** Per-ally clipped over-repair (heal-performed.perTarget, non-self entries with
         *  overheal > 0), keyed by ally id. When present, an `overheal`-basis reactive shield
         *  (Abundant Renewal) grants EACH over-repaired ally a shield scaled off ITS OWN overheal
         *  and lands on that ally — the AoE-repair routing that supersedes the single-target
         *  overhealAmount + healing.targetId fallback. */
        overhealByAlly?: Record<string, number>;
        /** The recipients of an `on-shield-applied` event (shield-applied.recipientIds — the
         *  actors whose pool grew). The reaction's buff/effect targets EXACTLY these, mirroring
         *  repairedAllyIds: an `ally`/`all-allies`-target grant fans out to the shield recipients
         *  rather than the owner/whole team (Resonating Fury — buff every recipient of the cast). */
        shieldRecipientIds?: string[];
        /** True when this intent is the owner's OWN death reaction (a self-scoped
         *  `on-destroyed` enqueue — Martyrdom's killer-Disable, Salvation's self-destruct
         *  heal). The dead-owner drain gate skips every reactive whose owner is already
         *  destroyed EXCEPT these: a self-death reaction is born of the death itself and
         *  must still resolve, whereas a stale listener firing on some LATER event (e.g. a
         *  dead Curator reacting to an enemy charge rounds after dying) is suppressed. */
        fromOwnDeath?: boolean;
        /** Phase 3 PR-H: the recipient ids ACTUALLY cleansed by the owner's OWN cleanse-performed
         *  event (cleanse-performed.targets — a subset of the cleanse's targeted recipients,
         *  only those with a real removal). The `on-own-cleanse` listener stamps this so an
         *  `ally`-target reactive repair (Cultivator's "that ally") fans out to exactly these ids
         *  via `reactiveRecipients`, instead of the default heal target. Mirrors
         *  repairedAllyIds/shieldRecipientIds. A `self`-target reaction (Morao) ignores it. */
        cleansedAllyIds?: string[];
        /** Ship-kit W3 (Pestilence): the enemy ids ACTUALLY cleansed by an OPPOSING actor's
         *  cleanse-performed event (cleanse-performed.targets — the recipients whose debuffs were
         *  really removed). The `on-enemy-cleansed` listener stamps this so Pestilence's reactive
         *  `dot` ability (target 'all-enemies') fans Corrosion II out over EXACTLY those enemies
         *  ("on all cleansed enemies"), instead of the single-victim/dummy-sink fallback. Mirrors
         *  the own-side `cleansedAllyIds` above. Ignored by non-dot cleanse reactors (Grif's damage
         *  proc routes via counterTargetId). */
        cleansedEnemyIds?: string[];
        /** Ship-kit W3 (Hemlock, Task 9): the adjacent-ally ids a Corrosion SPREAD landed Corrosion
         *  I on (corrosion-spread.affectedIds), stamped by the on-corrosion-spread listener. Read
         *  ONLY for its `.length` by the reactive heal executor's `spread-affected-count` scaling
         *  ("repairs 5% per enemy affected"); Hemlock's heal is self-target so the ids themselves
         *  are never routed. Mirrors repairedEnemyIds' count-only use. */
        spreadAffectedIds?: string[];
        /** SP-E, Task E4: the ACTUAL victim id (dot-applied.targetId) of the ally's DoT
         *  application, captured by the on-ally-debuff-inflicted dot-applied listener. Read by
         *  the convert-dot executor to resolve the correct CombatActor (via ctx.actorById) whose
         *  entries to retag — NOT the fixed ctx.enemy/corrosionEntries, which are side-biased to
         *  the PLAYER's single opposing focus and would be wrong for an ENEMY owner's ally
         *  hitting a PLAYER actor. Absent for the debuff-applied branch of the same trigger
         *  (Oleander's buff grant doesn't need a victim — it routes via damagedAllyId only). */
        victimId?: string;
        /** The debuffed enemy's actor id (debuff-applied.targetId / dot-applied.targetId),
         *  stamped by the on-debuff-inflicted listener. Read ONLY by the reactive `damage`
         *  branch (Insidiousness) so the proc lands on the enemy that was actually debuffed
         *  instead of falling through to the first living opposing actor. A DEDICATED field
         *  rather than reusing `victimId`: that one is the `adjacent-enemies` splash anchor
         *  (on-bomb-detonated), and reusing it would newly re-anchor any adjacent-enemies
         *  damage ability reached via this trigger. Every OTHER on-debuff-inflicted consumer
         *  (Warden's debuff, APEX/Butcher/Torcher/Prospect/Yuyan self-riders, Hemlock's
         *  charge, Pestilence's cleanse) ignores this field → unchanged. */
        debuffVictimId?: string;
        /** SP-E, Task E4: the DoT type of the ally's application (dot-applied.dotType), captured
         *  alongside victimId. The convert-dot executor gates on this === cfg.fromDotType so an
         *  ally's Inferno (or any other DoT) never converts under a Corrosion-only ability. */
        dotType?: DoTType;
    };
}

/** Whether an ability is reactive (routed through the trigger machinery): a
 *  buff/debuff/dot/charge/heal/shield/cleanse/extra-action/damage ability whose trigger is
 *  in the live set. Anything else stays on the on-cast path. SAFETY: `on-cast` is not a live
 *  trigger, so a normal on-cast damage ability is NOT reactive and stays on the cast path —
 *  only a damage ability carrying a live trigger (e.g. Grif's on-enemy-cleansed) routes here. */
function isReactiveAbility(ability: Ability): boolean {
    if (!LIVE_TRIGGERS.has(ability.trigger)) return false;
    return (REACTIVE_ABILITY_TYPES as readonly string[]).includes(ability.config.type);
}

/**
 * Partition the input ShipSkills ONCE at setup into:
 *  - `castSkills`: everything except live-trigger buff/debuff/dot/charge/heal/shield/cleanse/
 *    extra-action/damage abilities. Feeds every on-cast pipeline (status registration loop +
 *    runPlayerTurn). SAFETY: a normal on-cast `damage` ability is NOT live-triggered, so it
 *    stays here — only a damage ability carrying a live trigger routes to reactiveAbilities.
 *  - `reactiveAbilities`: the excluded abilities, in slot/text order — fixed
 *    registration order = fixed execution order (determinism).
 */
export function partitionReactiveAbilities(shipSkills: ShipSkills): {
    castSkills: ShipSkills;
    reactiveAbilities: ReactiveAbility[];
} {
    const reactiveAbilities: ReactiveAbility[] = [];
    const castSkills: ShipSkills = {
        slots: shipSkills.slots.map((slot) => {
            const keptAbilities: Ability[] = [];
            for (const ability of slot.abilities) {
                if (isReactiveAbility(ability)) {
                    reactiveAbilities.push({ ability, sourceSlot: slot.slot });
                } else {
                    keptAbilities.push(ability);
                }
            }
            return { ...slot, abilities: keptAbilities };
        }),
    };
    return { castSkills, reactiveAbilities };
}

/**
 * Register each owner's reactive abilities as bus listeners. Listener bodies are
 * PURE (Phase 1 contract): they only `enqueue` an intent — never mutate combat state. Match
 * guards are now per OWNER (Task 6) so a team ship's reactive ability keys on ITS OWN events:
 *  - on-crit → ability-performed where actorId === ownerId; enqueues once PER ATTACK, never per
 *    target. Every emitter is per-sub-attack since PR5, so ONE enqueue per event implements this
 *    on every path: the POSITIONAL path's own sub-attack `deliveredDamage`, or (every other
 *    per-sub-attack emitter) that event's `damage`, which is already this sub-attack's own share.
 *    Exception: the two CAST-SCOPED fallback emits (engine.ts's nothing-landed and enemy
 *    0-damage sites) publish `e.damage` as the cast total (`dap.damage`), not a share — harmless
 *    today since both carry 0, but not "already a share" like the rest.
 *  - on-debuff-inflicted → debuff-applied | dot-applied with `sourceId === ownerId`
 *  - on-ally-debuff-inflicted → debuff-applied OR dot-applied where the source is a same-side
 *    ally (not opposing, not the owner itself). For the PLAYER registration this is any OTHER
 *    PLAYER's infliction; for the ENEMY registration this is any other enemy actor's infliction.
 *    The dot-applied subscription is now LIVE (the team dot-applied seam exists since Task 4).
 *  - on-ally-debuffed → debuff-applied where the TARGET is a same-side ally (not opposing, not
 *    the owner itself) — the ally counterpart of on-debuffed (Hayyan). Does NOT subscribe to
 *    dot-applied, matching on-debuffed's scoping.
 *  - on-ally-crit-dot → dot-applied with viaCrit from any same-side ally (opposing sources
 *    excluded, own casts excluded)
 *  - on-ally-critically-repaired → the OWNER's OWN heal-performed (casterId === ownerId) with
 *    >= 1 critting draw AND at least one non-self recipient (Pallas: "when THIS UNIT critically
 *    repairs an ally"). One enqueue per qualifying cast.
 *  - on-own-repair-to-ally → the OWNER's OWN heal-performed (casterId === ownerId) with at least
 *    one non-self recipient — the on-ally-critically-repaired twin WITHOUT the crit filter (Font
 *    of Power). Stamps eventCtx.repairedAllyIds (the non-self recipients) so the buff branch fans
 *    the grant out to exactly those allies. One enqueue per qualifying cast.
 *  - on-ally-crit → an ALLY's ability-performed with critting hits (mirrors on-crit ally-scoped):
 *    fires once per critting ability-performed — i.e. once per critting SUB-ATTACK, and ONCE for
 *    an AoE footprint however many victims it crit, never per (hit, victim) pair; the owner's own
 *    casts and every opposing actor are excluded (a walked enemy attacker now emits
 *    ability-performed, but its crit is NOT an ally crit).
 *  - start-of-round → round-started (global — every owner's start-of-round fires once per round)
 *  - end-of-round → round-ended (global — every owner's end-of-round fires once per round; C2b-2)
 *  - on-charged-cast → skill-fired where actorId === ownerId && slot === 'charged' (self-scoped;
 *    fires when THIS OWNER performs its CHARGED skill — Spearhead). One enqueue per cast.
 *  - on-bomb-detonated → bomb-detonated (global)
 *  - on-stasis-applied → control-applied where effect === 'stasis' && casterId === ownerId
 *    (Defiant: the OWNER's OWN Stasis application — own-cast scoped). One enqueue per application.
 *  - on-attacked → attacked where targetId === ownerId (target-scoped; fires when THIS OWNER is
 *    attacked). Per-HIT since Phase 4c PR 1 (the engine emits one event per hit). The ability's
 *    triggerCritFilter discriminates on the hit's own crit outcome: 'crit' → critting hits only,
 *    'non-crit' → non-critting only, absent → every hit. Each enqueued intent is per-event (not
 *    the shared const): eventCtx captures the attacker for "on that enemy" counter routing.
 *  - on-ally-attacked → attacked where the target is a same-side ally (not opposing, not self)
 *    (per hit; critFilter + roleFilter applied). Fires when ANY OTHER same-side actor is hit —
 *    own hits are on-attacked's job; an opposing-side target is never an ally.
 *    triggerCritFilter discriminates on the hit's own crit outcome (same contract as on-attacked);
 *    roleFilter (Graphite) matches the DAMAGED ally's role category via the optional roleOf lookup.
 *  - on-destroyed → ship-destroyed where actorId === ownerId (self-scoped; mirrors on-attacked's
 *    target-scoped guard). One enqueue per destruction event.
 *  - on-ally-destroyed → ship-destroyed where the actor is a same-side ally (not opposing, not self)
 *    (any OTHER same-side actor's destruction; mirrors on-ally-crit's ally scoping).
 *  - on-enemy-destroyed → ship-destroyed where isOpposing(actorId)
 *    (any opposing-side actor — for players: dummy wall + walked enemy attackers;
 *    for enemy owners: any player actor).
 *  - on-enemy-repaired → heal-performed where isOpposing(casterId)
 *    (any opposing-side actor's repair cast). One enqueue per cast. Stamps repairerId (the
 *    caster) AND repairedEnemyIds (e.targets, unfiltered) — Ruiner's Bomb routes to the
 *    former (counterTargetId), Amartya's Defense Shred fans out over the latter.
 *  - on-enemy-cleansed → cleanse-performed where isOpposing(casterId)
 *    (any opposing-side actor's cleanse cast). One enqueue per cast.
 *  - on-enemy-dot-damage → dot-ticked where isOpposing(targetId) (ship-kit W3, Task 6: Anemone's
 *    self-heal reacting to ANY opposing actor taking a DoT tick, any dotType). One enqueue per
 *    tick. Stamps eventCtx.victimId = the tick's target (dummy-sink convention) — inert for
 *    Anemone's self-target heal (reactiveRecipients never reads victimId for target==='self').
 *  - on-own-cleanse → cleanse-performed where casterId === ownerId (Phase 3 PR-H: Cultivator's
 *    ally-repair, Morao's self-repair + Defense Up II). Self-scoped — the OWN-cleanse counterpart
 *    of on-enemy-cleansed. Stamps eventCtx.cleansedAllyIds = e.targets (the actually-cleansed
 *    recipients) so an 'ally'-target reaction fans out to exactly those ids (reactiveRecipients);
 *    a 'self'-target reaction ignores it. One enqueue per qualifying (>= 1 real removal) cast.
 *  - on-enemy-buffed → buff-applied where isOpposing(actorId) (Phase 3 PR-I: Nuqtu's
 *    self-cleanse + Terran Bolster III grant, "when an enemy gets buffed"). actorId is the
 *    buff RECIPIENT (events.ts), so this fires once per opposing-side buff application. Both
 *    effects are self-target — no eventCtx capture needed.
 *  - on-hp-threshold-crossed → hp-changed where targetId === ownerId and the event is a
 *    DOWNWARD crossing of N (oldPct >= N > newPct), N read from the ability's self
 *    hp-threshold condition (trigger CONFIG — executeIntent scrubs it from the drain-time
 *    gate). No threshold configured → dormant. Self-scoped, per-event (no listener state);
 *    a heal-up re-arms naturally and oncePerCombat (buff/heal) caps re-fires.
 *
 * REGISTRATION ORDER (determinism): the FOCUS/attacker owner is registered FIRST, then team
 * owners in input order; within an owner, slot/text order (the per-owner reactiveAbilities are
 * already in slot/text order from partitionReactiveAbilities). Fixed registration order = fixed
 * listener-fire order = fixed intent-enqueue order. Attacker-first preserves the exact
 * intent-enqueue order an attacker-only fixture had before Task 6 (one owner registered first =
 * today's listener order). NOTE: the spec prose says "team order, then attacker"; we deliberately
 * register the FOCUS owner FIRST instead — that is the zero-churn choice for the attacker-only
 * goldens (attacker listeners must enqueue in their historical order), and the relative order
 * across DIFFERENT owners only affects multi-owner fixtures, where any fixed order is correct.
 */
export function registerReactiveListeners(args: {
    bus: CombatEventBus;
    perOwner: { ownerId: string; reactiveAbilities: ReactiveAbility[] }[];
    enqueue: (intent: Intent) => void;
    /** True for any actor on the side OPPOSING this listener set's owners. The engine
     *  passes a per-call predicate: the PLAYER registration passes the enemy-side
     *  predicate (opposing = enemy-side); the ENEMY registration passes its negation
     *  (opposing = player-side). This per-call approach ensures an enemy owner's
     *  opposing/ally reactions route against the correct side (bySide PR2). */
    isOpposing: (actorId: string) => boolean;
    /** Damaged-ally role lookup for role-filtered ally-damage reactions (Graphite).
     *  Returns the actor's ShipTypeName or undefined (manual actor / no ship picked).
     *  Optional: DPS-mode runs and unit fixtures omit it. */
    roleOf?: (actorId: string) => ShipTypeName | undefined;
    /** D-PR14 Bulwark: same-side ids adjacent to an owner (living, owner excluded; non-positional
     *  → all living same-side allies). Used to gate requireDamagedAllyAdjacent reactions. Optional:
     *  DPS/unit fixtures omit it (→ treat any ally as adjacent). */
    adjacentAllyIdsFor?: (ownerId: string) => string[];
    /** D-PR16: owner effective max HP resolver — gates Tenacity's incoming-damage-fraction
     *  filter. Optional: absent → the filter is skipped (no Tenacity in scope). */
    maxHpOf?: (ownerId: string) => number;
}): void {
    const { bus, perOwner, enqueue, isOpposing, roleOf, adjacentAllyIdsFor, maxHpOf } = args;
    // Same-side ally = NOT opposing AND not the owner itself (own events route to the
    // self-scoped triggers). For the player registration (opposing = enemy-side) this
    // is byte-identical to the old pattern.
    const isSameSideAlly = (actorId: string, ownerId: string): boolean =>
        !isOpposing(actorId) && actorId !== ownerId;
    for (const { ownerId, reactiveAbilities } of perOwner) {
        for (const ra of reactiveAbilities) {
            const intent: Intent = { ability: ra.ability, sourceSlot: ra.sourceSlot, ownerId };
            switch (ra.ability.trigger) {
                case 'on-crit':
                    bus.on('ability-performed', (e) => {
                        if (e.actorId !== ownerId) return;
                        // PER ATTACK, NOT PER TARGET (locked game rule, user-verified in-game
                        // 2026-08-08): a multi-hit skill is N consecutive FULL-WALK attacks, so the
                        // reaction fires N times; an AoE footprint is ONE attack, so it fires ONCE
                        // however many victims crit and heals MORE through the AMOUNT, not the count.
                        //
                        // ONE enqueue per event implements both halves, because since PR5 EVERY
                        // emitter is per-sub-attack and `critHits` means the same thing on all of
                        // them: the critting VICTIMS within THIS ONE sub-attack. (Before PR5 the
                        // non-positional emitter folded the whole cast into one event where
                        // `critHits` counted critting HITS, and a LOOP over it was what implemented
                        // "per attack" on that path. Two meanings for one field was the epic's
                        // sharpest trap — it already caused one pre-merge defect in PR7 — and PR5
                        // removed it by making the DPS path emit like the engine.)
                        //
                        // The two remaining CAST-SCOPED emitters are the engine's fallbacks, and one
                        // enqueue is right for both: the nothing-landed site (engine.ts:6843) can
                        // only carry critPairs 0 (no sub-attack had a victim, and critPairs
                        // increments only inside the per-victim loop). The enemy 0-damage site
                        // (engine.ts:9307) is reached only when a damage ability actually fired
                        // (the deferred payload only exists when deferAbilityPerformedToEngine &&
                        // hasDamageAbility) AND the cast's total damage is 0. For a PARSED kit that
                        // means a multiplier-0 damage ability, and parseHitCount only assigns
                        // hits > 1 on an explicit "attacks N times" phrase — so critHits <= 1 holds
                        // for every ship in docs/ship-skills.csv today, but that is a CORPUS
                        // property, not a structural guarantee: the ability editor exposes
                        // multiplier and hits independently, so a hand-authored multiplier-0,
                        // hits:3 ability would carry critHits > 1 through this same fallback.
                        const critted = (e.critHits ?? 0) > 0 || e.didCrit === true;
                        if (!critted) return;
                        enqueue({
                            ...intent,
                            eventCtx: {
                                ...intent.eventCtx,
                                // What this sub-attack actually DELIVERED — post-crit,
                                // post-amplification, post-victim-defence, including a Protection
                                // cascade's redirected chunk and excluding a DoT-transformed
                                // portion. This is the locked `basis:'damage-dealt'` value
                                // (Bloodthirst). Present only on the interleaved positional path,
                                // which is the only path with a funnel to differ from; every other
                                // per-sub-attack emitter falls back to the pre-funnel `damage` it
                                // publishes, which since PR5 is already this sub-attack's own share.
                                // The two CAST-SCOPED fallback emits are the exception — there
                                // `damage` is the cast total, not a share — but harmlessly, since
                                // both carry 0.
                                triggerDamage: e.deliveredDamage ?? e.damage,
                                // PR4: carry this sub-attack's identity to the drain, which runs
                                // once per turn — after every sub-attack — so it cannot ask the
                                // engine which sub-attack it is in.
                                subAttackIndex: e.subAttackIndex,
                            },
                        });
                    });
                    break;
                case 'on-deal-damage':
                    bus.on('ability-performed', (e) => {
                        // Fires on the OWNER's own damage-dealing attack. runPlayerTurn emits one
                        // ability-performed per SUB-ATTACK (multi-hit full-walk, PR2): a multi-hit
                        // skill is N consecutive full-walk attacks, so this fires N times, once
                        // per sub-attack that dealt damage. An AoE footprint is ONE attack and
                        // fires once however many victims it hits. Riders: Burner's Inferno,
                        // Warpstrike's duration-reduction, Zeolite's purge. There is no
                        // once-per-turn guard, and adding one would be wrong — per-sub-attack IS
                        // the intended cardinality (pinned by
                        // perSubAttackEvents.integration.test.ts). The while-debuffed requirement
                        // is an ability condition (self-debuff), enforced at drain via
                        // gateConditions.
                        if (e.actorId !== ownerId) return;
                        if ((e.damage ?? 0) <= 0) return;
                        // Capture the owner's own attack target so a reactive DoT rider (Burner's
                        // on-deal-damage Inferno) lands on the enemy actually hit — the real
                        // positional victim — instead of falling back to the DPS dummy `enemy`
                        // sink. DPS mode: e.targetId is the dummy → byte-identical. Non-DoT riders
                        // (Warpstrike duration-reduction) ignore victimId, so this is inert there.
                        enqueue({
                            ...intent,
                            eventCtx: {
                                ...intent.eventCtx,
                                victimId: e.targetId,
                                // PR4: see the on-crit listener above.
                                subAttackIndex: e.subAttackIndex,
                            },
                        });
                    });
                    break;
                case 'on-charged-cast':
                    bus.on('skill-fired', (e) => {
                        // Self-scoped: THIS owner performed its CHARGED skill. The skill-fired
                        // event carries slot:'active'|'charged' (events.ts). Team-agnostic —
                        // enemy actors run the same turn path and emit skill-fired too; the
                        // ownerId guard self-scopes per registered owner. One enqueue per cast.
                        if (e.actorId === ownerId && e.slot === 'charged') enqueue(intent);
                    });
                    break;
                case 'on-enemy-charged-cast':
                    bus.on('skill-fired', (e) => {
                        // Opposing-scoped mirror of on-charged-cast. Team-agnostic: player
                        // registration's isOpposing = enemy side; enemy registration's = player
                        // side. Capture the casting enemy as the reaction target via the existing
                        // counterTargetId field so the purge/debuff executors route onto THAT
                        // enemy (zero executor change). Self-effects (FrontLine shield) ignore it.
                        if (isOpposing(e.actorId) && e.slot === 'charged')
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, counterTargetId: e.actorId },
                            });
                    });
                    break;
                case 'on-debuff-inflicted':
                    bus.on('debuff-applied', (e) => {
                        // Ship-kit W7 (Warden): `!e.viaDebuffInflictedReaction` breaks a SELF-chain.
                        // Warden's "when this Unit inflicts a Debuff → Out. Damage Down II" follow-up
                        // is ITSELF a debuff; without this guard its own debuff-applied would re-enter
                        // this listener and re-apply every generation until MAX_INTENT_GENERATIONS
                        // throws. The flag is set ONLY on debuffs applied by an on-debuff-inflicted-
                        // triggered ability, so debuffs from OTHER reactive triggers (on-crit's
                        // Crit Shred feeding an on-debuff-inflicted charge — triggers.test scenario 10)
                        // still chain here as before. Existing consumers (Butcher/Pestilence/APEX)
                        // inflict their gating debuffs from non-on-debuff-inflicted paths, unaffected.
                        // The debuffed enemy rides along as `debuffVictimId` so the reactive
                        // damage branch (Insidiousness) hits the enemy this infliction actually
                        // landed on rather than falling through to the first living opposing
                        // actor. Every other consumer of this trigger ignores the field.
                        if (e.sourceId === ownerId && !e.viaDebuffInflictedReaction)
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, debuffVictimId: e.targetId },
                            });
                    });
                    bus.on('dot-applied', (e) => {
                        if (e.sourceId === ownerId)
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, debuffVictimId: e.targetId },
                            });
                    });
                    break;
                case 'on-ally-debuff-inflicted':
                    bus.on('debuff-applied', (e) => {
                        // Ally = any OTHER same-side actor's infliction. Exclude this owner
                        // (own inflictions go to on-debuff-inflicted) AND every opposing actor
                        // (an opposing actor is never an ally).
                        if (isSameSideAlly(e.sourceId, ownerId))
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, damagedAllyId: e.sourceId },
                            });
                    });
                    bus.on('dot-applied', (e) => {
                        // Team DoT applications now emit dot-applied with the team sourceId
                        // (Task 4 seam, live since Task 6) — an ally DoT infliction triggers
                        // this listener exactly as an ally debuff does.
                        if (isSameSideAlly(e.sourceId, ownerId))
                            enqueue({
                                ...intent,
                                eventCtx: {
                                    ...intent.eventCtx,
                                    damagedAllyId: e.sourceId,
                                    // SP-E, Task E4: Belladonna's convert-dot executor needs the
                                    // actual victim + DoT type of THIS application.
                                    victimId: e.targetId,
                                    dotType: e.dotType,
                                },
                            });
                    });
                    break;
                case 'on-ally-crit-dot':
                    bus.on('dot-applied', (e) => {
                        // Ally DoT infliction whose cast crit (viaCrit): any OTHER
                        // same-side actor's crit-cast DoT. Own casts and every opposing actor
                        // are excluded (mirrors on-ally-debuff-inflicted's ally scoping). One
                        // enqueue per qualifying infliction EVENT (per-infliction-event rule).
                        if (e.viaCrit && isSameSideAlly(e.sourceId, ownerId)) {
                            enqueue({
                                ...intent,
                                eventCtx: {
                                    ...intent.eventCtx,
                                    // Capture the ally's ACTUAL victim so the reactive `dot`
                                    // executor lands "on that enemy" (the positional victim the
                                    // ally hit), not the fixed DPS dummy `enemy` sink.
                                    victimId: e.targetId,
                                    dotType: e.dotType,
                                },
                            });
                        }
                    });
                    break;
                case 'on-self-crit-dot':
                    bus.on('dot-applied', (e) => {
                        // Ship-kit W8 Task 10 (Wisteria): self-subject sibling of
                        // on-ally-crit-dot above — THIS unit's OWN crit-cast DoT infliction
                        // (sourceId === ownerId), not an ally's. One enqueue per qualifying
                        // infliction event.
                        if (e.viaCrit && e.sourceId === ownerId) {
                            enqueue({
                                ...intent,
                                eventCtx: {
                                    ...intent.eventCtx,
                                    // Land the injected DoT on the SAME enemy this cast just hit
                                    // (the reactive `dot` executor's victimId seam), not the DPS
                                    // dummy sink.
                                    victimId: e.targetId,
                                    dotType: e.dotType,
                                },
                            });
                        }
                    });
                    break;
                case 'on-ally-critically-repaired':
                    bus.on('heal-performed', (e) => {
                        // The OWNER's own crit repair of an ALLY (Pallas: "when this unit
                        // critically repairs an ally"): own cast, >= 1 critting draw, and
                        // at least one non-self recipient. One enqueue per qualifying cast.
                        if (
                            e.casterId === ownerId &&
                            (e.critHits ?? 0) >= 1 &&
                            e.targets.some((t) => t !== ownerId)
                        ) {
                            enqueue(intent);
                        }
                    });
                    break;
                case 'on-own-repair-to-ally':
                    bus.on('heal-performed', (e) => {
                        // The OWNER's own repair that reached >= 1 OTHER ally (Font of Power).
                        // One enqueue per qualifying cast -> one proc-gate roll; the grant fans
                        // out to all repaired non-self allies via eventCtx.repairedAllyIds.
                        if (e.casterId !== ownerId) return;
                        const repaired = e.targets.filter((t) => t !== ownerId);
                        if (repaired.length === 0) return;
                        // Per-ally clipped over-repair from the cast's per-target breakdown (non-self
                        // recipients that were actually over-repaired). Drives Abundant Renewal's
                        // per-ally shield; absent (legacy single-target emit with no perTarget) →
                        // the executor falls back to the aggregate overhealAmount + healing.targetId.
                        const overhealByAlly: Record<string, number> = {};
                        for (const pt of e.perTarget ?? []) {
                            if (pt.targetId !== ownerId && (pt.overheal ?? 0) > 0) {
                                overhealByAlly[pt.targetId] = pt.overheal as number;
                            }
                        }
                        enqueue({
                            ...intent,
                            eventCtx: {
                                ...intent.eventCtx,
                                repairedAllyIds: repaired,
                                overhealAmount: e.overheal ?? 0,
                                ...(Object.keys(overhealByAlly).length > 0
                                    ? { overhealByAlly }
                                    : {}),
                            },
                        });
                    });
                    break;
                case 'on-shield-applied':
                    bus.on('shield-applied', (e) => {
                        // Granter-scoped (H3.6 keys the event on the acting granter): THIS owner
                        // applied a shield (Resonating Fury). One enqueue per CAST -> one proc-gate
                        // roll; the grant fans out to every recipient whose pool grew via
                        // eventCtx.shieldRecipientIds (mirrors on-own-repair-to-ally/repairedAllyIds).
                        // An empty recipient list (no pool grew) emits no event by construction, but
                        // guard defensively so a 0-recipient event never enqueues a no-op intent.
                        if (e.granterId !== ownerId) return;
                        if (e.recipientIds.length === 0) return;
                        enqueue({
                            ...intent,
                            eventCtx: {
                                ...intent.eventCtx,
                                shieldRecipientIds: e.recipientIds,
                            },
                        });
                    });
                    break;
                case 'on-ally-crit':
                    bus.on('ability-performed', (e) => {
                        // An ALLY's critting attack (mirrors on-crit with ally scoping): own casts
                        // and every opposing actor excluded — an opposing crit is NOT an ally crit,
                        // even though a walked enemy now emits ability-performed.
                        if (!isSameSideAlly(e.actorId, ownerId)) return;
                        // ONE enqueue per ATTACK that crit, NOT one per critting (hit, victim)
                        // pair. The corpus clauses all read "when an ally critically hits an enemy,
                        // this Unit <does X>" — X is a single reaction to the attack: Hermes gains
                        // 1 charge, Howler cleanses 1 debuff from the ally, Sentinel repairs the
                        // ally once. A 3-victim AoE that crits twice is still ONE ally crit.
                        // (Charge was already collapsed this way by an explicit special-case; the
                        // per-critHits loop for every other rider was the over-fire bug — Sentinel
                        // healed Ruiner twice for one AoE.)
                        //
                        // "ATTACK" here means SUB-ATTACK (multi-hit full-walk, PR2): a `hits: N`
                        // skill is N consecutive full-walk attacks emitting N ability-performed
                        // events, so an ally critting on 2 of 3 sub-attacks fires this TWICE. The
                        // (hit, victim) collapse is what this one-enqueue-per-event shape guards,
                        // and it survives untouched — a single-hit 3-victim AoE that crits two
                        // victims still fires ONCE. Both halves are pinned by
                        // perSubAttackEvents.integration.test.ts. SELF-target riders (Hermes's
                        // charge + Everliving Regeneration) behave the SAME as ally-routed ones:
                        // `on-ally-crit` was removed from PER_HIT_REACTIVE_TRIGGERS, so
                        // oncePerAttackGuardKey no longer collapses them across sub-attacks. This
                        // one-enqueue-per-event shape is the whole collapse, and it is enough.
                        // Locked by hermesOncePerAttack.integration.test.ts.
                        if (!e.didCrit && (e.critHits ?? 0) === 0) return;
                        // The enemies actually crit. `critVictimIds` is present only on the
                        // POSITIONAL deferred emit; the single-target inline emit omits it, where
                        // `targetId` IS the sole possible crit victim — hence the fallback.
                        const critVictimIds =
                            e.critVictimIds && e.critVictimIds.length > 0
                                ? e.critVictimIds
                                : [e.targetId];
                        // Stamp the crit-ing ally via damagedAllyId (Phase 3 PR-G, Howler) so an
                        // 'ally'-target reactive (cleanse/buff/heal — Sentinel's repair) lands on
                        // THAT ally, mirroring the on-ally-debuffed/on-ally-purged siblings. ALSO
                        // stamp the crit VICTIMS so an 'enemy'-target reactive damage hits "that
                        // enemy" — every enemy the ally crit (Sentinel's 60% lands on each), NOT
                        // the cast's selected anchor, which in an AoE may never have crit at all.
                        // `counterTargetId` stays stamped (first crit victim) as the single-victim
                        // channel every other consumer already reads.
                        enqueue({
                            ...intent,
                            eventCtx: {
                                ...intent.eventCtx,
                                damagedAllyId: e.actorId,
                                counterTargetId: critVictimIds[0],
                                critVictimIds,
                            },
                        });
                    });
                    break;
                case 'start-of-round':
                    bus.on('round-started', () => enqueue(intent));
                    break;
                case 'start-of-turn':
                    bus.on('turn-started', (e) => {
                        // Self-scoped: THIS owner's own turn began. turn-started fires once per
                        // actor (both sides run the same turn path), so the ownerId guard scopes
                        // it per registered owner — team-agnostic, like on-charged-cast.
                        if (e.actorId === ownerId) enqueue(intent);
                    });
                    break;
                case 'end-of-turn':
                    bus.on('turn-ended', (e) => {
                        // Self-scoped: THIS owner's own turn ended. turn-ended fires once per
                        // actor (engine.ts), so the ownerId guard scopes it per owner — mirror
                        // of start-of-turn (which rides turn-started).
                        if (e.actorId === ownerId) enqueue(intent);
                    });
                    break;
                case 'end-of-round':
                    // Global, like start-of-round: every round-ended enqueues this owner's intent
                    // (Rhodium's end-of-round purge). Gating handled in the executor.
                    bus.on('round-ended', () => enqueue(intent));
                    break;
                case 'on-bomb-detonated':
                    // Ship-kit W5 Task C3 (Demolisher): stamp the bomb VICTIM's id + the burst's
                    // own damage into eventCtx so the reactive `damage` executor's `adjacent-
                    // enemies` branch can anchor its fan-out on the bombed enemy (NOT the owner)
                    // and scale the splash off the bomb's own payout rather than the owner's
                    // attack. Both fields are existing eventCtx channels (on-attacked already
                    // stamps them for the counter-routing / damage-taken-basis consumers) — this
                    // listener is just a second writer, gated by its own distinct event type.
                    bus.on('bomb-detonated', (e) => {
                        // Only react to a bomb that exploded on an ENEMY (opposing this owner) —
                        // the corpus clauses are "When a Bomb explodes on an enemy…". Without
                        // this, an own-side bomb burst (e.g. an enemy's Bomb on a player ally)
                        // would fire the splash and mis-resolve the anchor against the wrong
                        // roster (adjacentOpposingIdsFor falls back to the FULL opposing roster
                        // when the anchor isn't found there). Mirrors the isOpposing guard every
                        // sibling on-enemy-* case above uses.
                        if (!isOpposing(e.victimId)) return;
                        enqueue({
                            ...intent,
                            eventCtx: {
                                ...intent.eventCtx,
                                victimId: e.victimId,
                                triggerDamage: e.damage,
                            },
                        });
                    });
                    break;
                case 'on-self-bomb-detonated':
                    // Ship-kit W7 (Lingshe): DETONATOR-scoped — fires only when THIS owner ACTIVELY
                    // caused the burst ("When this Unit detonates a Bomb it gains Stealth"). The
                    // `detonatorId` field names the detonating caster (detonate()/positional
                    // detonate → the caster; reduceBombsOnVictim → the countdown-reduce caster) and
                    // is UNDEFINED for a natural countdown-0 expiry, which nobody detonates. Keys off
                    // `detonatorId`, NOT `actorId` (the bomb's original applier) — so a bomb Lingshe
                    // detonates that some OTHER ship applied still grants her Stealth, and a bomb
                    // SHE applied that expires naturally (or another ship detonates) does not.
                    // Team-symmetric: any owner registered on either side gates identically.
                    bus.on('bomb-detonated', (e) => {
                        if (e.detonatorId === ownerId) enqueue(intent);
                    });
                    break;
                case 'on-stasis-applied':
                    bus.on('control-applied', (e) => {
                        // Defiant: the OWNER's OWN Stasis application (own-cast scoped). The
                        // existing `shield` follow-up applies the grant — no new executor branch.
                        if (e.effect === 'stasis' && e.casterId === ownerId) enqueue(intent);
                    });
                    break;
                case 'on-attacked':
                    bus.on('attacked', (e) => {
                        // Target-scoped: fires when THIS OWNER is attacked. Per-HIT since
                        // Phase 4c PR 1 (the engine emits one event per hit). The ability's
                        // triggerCritFilter discriminates on the hit's own crit outcome:
                        // 'crit' → critting hits only, 'non-crit' → non-critting only,
                        // absent → every hit. The intent is per-EVENT (not the shared const):
                        // eventCtx captures the attacker for "on that enemy" counter routing.
                        if (e.targetId !== ownerId) return;
                        const filter = ra.ability.triggerCritFilter;
                        if (filter === 'crit' && !e.didCrit) return;
                        if (filter === 'non-crit' && e.didCrit) return;
                        const fracGate = ra.ability.requireIncomingDamageFracOfMaxHp;
                        if (fracGate !== undefined) {
                            const maxHp = maxHpOf?.(ownerId);
                            if (e.damage === undefined || !maxHp || e.damage <= fracGate * maxHp)
                                return;
                        }
                        enqueue({
                            ...intent,
                            eventCtx: {
                                counterTargetId: e.attackerId,
                                didCrit: e.didCrit,
                                triggerDamage: e.damage,
                                isPrimaryTarget: e.isPrimaryTarget,
                                shieldWasHit: e.shieldWasHit,
                                // PR4: which of the attacker's consecutive attacks this hit
                                // belonged to. Read ONLY by `oncePerAttackGuardKey` — the per-hit
                                // cardinality this trigger fans out at is unchanged (and correct:
                                // incoming effects resolve per hit, R2).
                                subAttackIndex: e.subAttackIndex,
                            },
                        });
                    });
                    break;
                case 'on-debuffed':
                    bus.on('debuff-applied', (e) => {
                        // Self-scoped: fires when THIS owner receives a timed debuff. Mirrors
                        // on-attacked's targetId === ownerId scoping. DoTs use dot-applied (not
                        // this event) → Firewall does not fire on DoT application, by design.
                        if (e.targetId === ownerId) enqueue(intent);
                    });
                    break;
                case 'on-ally-debuffed':
                    bus.on('debuff-applied', (e) => {
                        // Victim-scoped: a timed debuff landed on MY ally (Hayyan). The ally counterpart of
                        // on-debuffed (which is targetId === ownerId). Route the reactive repair to that ally
                        // via damagedAllyId. Excludes the owner (that is on-debuffed) and DoTs (dot-applied),
                        // matching on-debuffed's debuff-applied-only scoping.
                        if (isSameSideAlly(e.targetId, ownerId))
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, damagedAllyId: e.targetId },
                            });
                    });
                    break;
                case 'on-ally-shield-destroyed':
                    bus.on('shield-destroyed', (e) => {
                        // Victim-scoped: a same-side unit's shield pool was fully depleted (AEGIS).
                        // "an ally within the Active pattern" INCLUDES the owner itself — AEGIS's
                        // support pattern is centered on itself and its active shields itself, so a
                        // destroyed SELF shield must self-react (grant + cleanse on AEGIS). Hence
                        // same-side (self OR ally) via !isOpposing, NOT isSameSideAlly (which
                        // excludes the owner). Opposing victims never route here. The footprint
                        // filter (footprintFilteredRecipients) keeps it pattern-scoped, and the
                        // owner sits in its own pattern's origin cell. Route the grant/cleanse to
                        // that unit via damagedAllyId (reused from on-ally-debuffed/on-ally-crit).
                        if (!isOpposing(e.victimId))
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, damagedAllyId: e.victimId },
                            });
                    });
                    break;
                case 'on-debuff-resisted':
                    bus.on('debuff-resisted', (e) => {
                        // Self-scoped on the RESISTER. `debuff-resisted` carries targetId = the
                        // unit that resisted (either side: cast-side, reactive-side, and the
                        // D-PR15 Block-Debuff auto-resist all emit it). Route the inflictor
                        // (e.sourceId) as counterTargetId so a damage reaction (Vindicator's
                        // on-resist HP proc) retaliates against THAT enemy. When the resist carries
                        // no source, enqueue the bare intent — buff consumers (Lockdown) are
                        // source-agnostic and still fire; a source-requiring damage reaction no-ops
                        // downstream (triggers.ts damage branch). all-allies recipient routing
                        // happens in the buff executor.
                        if (e.targetId !== ownerId) return;
                        enqueue(
                            e.sourceId !== undefined
                                ? {
                                      ...intent,
                                      eventCtx: { ...intent.eventCtx, counterTargetId: e.sourceId },
                                  }
                                : intent
                        );
                    });
                    break;
                case 'on-own-debuff-resisted':
                    bus.on('debuff-resisted', (e) => {
                        // Inflictor-scoped mirror of on-debuff-resisted above: fires when a debuff
                        // THIS unit inflicted (e.sourceId === ownerId) is resisted by its target.
                        // Route the resister (e.targetId) as counterTargetId so a reaction could
                        // target them; Ravager's Hacking Module Overdrive grant is self-target and
                        // ignores this, but future inflictor-side reactions may need it.
                        if (e.sourceId !== ownerId) return; // inflictor-scoped (the mirror)
                        enqueue(
                            e.targetId !== undefined
                                ? {
                                      ...intent,
                                      eventCtx: { ...intent.eventCtx, counterTargetId: e.targetId },
                                  }
                                : intent
                        );
                    });
                    break;
                case 'on-ally-attacked':
                    bus.on('attacked', (e) => {
                        // Ally-scoped: fires when ANY OTHER same-side actor is hit — per HIT
                        // (the engine emits one event per hit, PR 1). Excludes this owner (own
                        // hits are on-attacked's job) and every opposing actor, mirroring
                        // on-ally-destroyed's scoping. triggerCritFilter discriminates on the
                        // hit's own crit outcome, same contract as on-attacked. roleFilter
                        // (Graphite) matches the DAMAGED ally's role category; an unknown role
                        // never matches (conservative — a manual actor with no ship picked keeps
                        // role-filtered reactions dormant rather than inflating numbers); an
                        // EMPTY filter array is treated as absent (any ally), not never-match.
                        if (!isSameSideAlly(e.targetId, ownerId)) return;
                        const filter = ra.ability.triggerCritFilter;
                        if (filter === 'crit' && !e.didCrit) return;
                        if (filter === 'non-crit' && e.didCrit) return;
                        const roles = ra.ability.roleFilter;
                        if (
                            roles &&
                            roles.length > 0 &&
                            !matchesRoleCategory(roleOf?.(e.targetId), roles)
                        ) {
                            return;
                        }
                        // D-PR14 Bulwark: fire only when the DAMAGED ally is adjacent to this
                        // owner. Pure read (listener stays enqueue-only). Helper absent → allow.
                        if (
                            ra.ability.requireDamagedAllyAdjacent &&
                            adjacentAllyIdsFor &&
                            !adjacentAllyIdsFor(ownerId).includes(e.targetId)
                        ) {
                            return;
                        }
                        // Per-event intent: counterTargetId routes counter-inflictions to the
                        // attacker (Guardian's Provoke); damagedAllyId routes 'ally'-target
                        // payloads to exactly the hit ally (Cultivator/Refine/Graphite).
                        enqueue({
                            ...intent,
                            eventCtx: {
                                counterTargetId: e.attackerId,
                                damagedAllyId: e.targetId,
                                // PR4: see the on-attacked listener — read only by
                                // `oncePerAttackGuardKey`.
                                subAttackIndex: e.subAttackIndex,
                            },
                        });
                    });
                    break;
                case 'on-destroyed':
                    bus.on('ship-destroyed', (e) => {
                        // Self-scoped: THIS owner was destroyed (mirrors on-crit's own-id scoping).
                        // Killer-targeted reactions (Faust's PURGE, Martyrdom's DEBUFF, Paracelsus's
                        // HP-scaled retaliation DAMAGE — PR-B1) fire only when killed by DIRECT damage
                        // and route to the killer (counterTargetId = e.killerId). Salvation's
                        // self-destruct HEAL (and any other on-destroyed reaction) fires on ANY
                        // death, unchanged.
                        if (e.actorId !== ownerId) return;
                        // fromOwnDeath: marks this as the owner's OWN death reaction so the
                        // dead-owner drain gate (executeIntent) lets it through even though the
                        // owner is now destroyed (Martyrdom's killer-Disable, Salvation's heal,
                        // Paracelsus's retaliation).
                        if (
                            ra.ability.config.type === 'purge' ||
                            ra.ability.config.type === 'debuff' ||
                            ra.ability.config.type === 'damage'
                        ) {
                            if (!e.byDirectDamage) return;
                            enqueue({
                                ...intent,
                                eventCtx: {
                                    ...intent.eventCtx,
                                    counterTargetId: e.killerId,
                                    fromOwnDeath: true,
                                },
                            });
                        } else {
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, fromOwnDeath: true },
                            });
                        }
                    });
                    break;
                case 'on-ally-destroyed':
                    bus.on('ship-destroyed', (e) => {
                        // Ally-scoped: any OTHER same-side actor's destruction. Exclude this
                        // owner (own death goes to on-destroyed) AND every opposing actor
                        // (an opposing actor is never an ally), mirroring on-ally-crit's scoping.
                        if (isSameSideAlly(e.actorId, ownerId)) enqueue(intent);
                    });
                    break;
                case 'on-enemy-destroyed':
                    bus.on('ship-destroyed', (e) => {
                        // Opposing-scoped: fires when any opposing-side actor is destroyed.
                        // For the player call: dummy wall + enemy attackers.
                        // For the enemy call: any player actor. One enqueue per destruction event.
                        // Ship-kit W8 Task 13 (Meiying): stamp victimId = the slain actor (mirrors
                        // every other Wave 5/7 reactive seam) so (a) an `adjacent-enemies`-target
                        // debuff twin (Stasis) can anchor its fan-out on the KILLED enemy's own
                        // neighbours (the debuff executor's adjacent-enemies branch below), and
                        // (b) the drain-time `killed-enemy-had-debuff` condition can read the
                        // slain unit's OWN debuff store (recordDestroyed runs before this event
                        // fires and never clears it) rather than the fight-wide enemy-debuff
                        // count. Inert for every OTHER on-enemy-destroyed ability (Sokol/
                        // Liberator's extra-action/charge branches never read eventCtx).
                        if (isOpposing(e.actorId))
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, victimId: e.actorId },
                            });
                    });
                    break;
                case 'on-enemy-repaired': {
                    // Opposing-scoped. Capture the repairer id so the charge branch can (a)
                    // count repairs per source for an everyNthEvent gate and (b) target THAT
                    // enemy. Harmless for Zosimos's self-gain intent (it ignores repairerId).
                    // Phase 3 PR-F: ALSO stamp counterTargetId = the repairer (Ruiner's Bomb
                    // routes here like every other "on that enemy" counter-infliction — the
                    // debuff branch's existing `counterTargetId ?? ctx.enemy.id` fallback picks
                    // this up for free) and repairedEnemyIds = the healed set (Amartya's "that
                    // defender" Defense Shred fans out to every healed enemy instead).
                    const onEnemyRepair = (casterId: string, targets: string[]) => {
                        if (!isOpposing(casterId)) return;
                        enqueue({
                            ...intent,
                            eventCtx: {
                                ...intent.eventCtx,
                                repairerId: casterId,
                                counterTargetId: casterId,
                                repairedEnemyIds: targets,
                            },
                        });
                    };
                    bus.on('heal-performed', (e) => onEnemyRepair(e.casterId, e.targets));
                    // A REACTIVE repair is still "an enemy performing a repair" (Ruiner's Bomb).
                    // Reactive heals deliberately emit NO `heal-performed` (chain guard — it would
                    // re-trigger the caster's own on-repair listeners and loop), only the log-only
                    // `reactive-heal-performed`; without this second subscription Ruiner was blind
                    // to exactly the ships his passive is meant to punish — the reaction-healers
                    // (Heliodor's on-damaged self-repair, Cultivator's on-ally-damaged repair),
                    // which repair many times a round and never once via heal-performed.
                    //
                    // CHAIN SAFETY: this is a listener on a type documented as having none, so it
                    // must not reopen the loop the chain guard closed. It cannot: the enqueued
                    // intents are the on-enemy-repaired riders (Ruiner's Bomb debuff + Overload
                    // self-buff, Zosimos's charge removal, Amartya's Defense Shred) — none of them
                    // heal, so none can emit another reactive-heal-performed. The generic
                    // MAX_INTENT_GENERATIONS backstop covers any future rider that could.
                    bus.on('reactive-heal-performed', (e) =>
                        onEnemyRepair(
                            e.casterId,
                            e.perTarget.map((pt) => pt.targetId)
                        )
                    );
                    break;
                }
                case 'on-enemy-dot-damage':
                    bus.on('dot-ticked', (e) => {
                        // Ship-kit W3 (Task 6, Anemone): opposing-scoped reaction to an ENEMY-side
                        // actor taking a DoT TICK (any dotType). Stamp victimId = the tick's real
                        // target (dummy-sink convention, investigation appendix §E) — Anemone's
                        // heal is SELF-target, so `reactiveRecipients` resolves it to
                        // [intent.ownerId] regardless (target==='self' branch never reads
                        // victimId); the stamp exists for parity with every other Wave 3 case and
                        // for any future non-self consumer of this trigger.
                        if (isOpposing(e.targetId))
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, victimId: e.targetId },
                            });
                    });
                    break;
                case 'on-enemy-cleansed':
                    bus.on('cleanse-performed', (e) => {
                        // Opposing-scoped: any opposing-side actor's cleanse. For the player
                        // call: enemy side. For the enemy call: player side.
                        // One enqueue per cast.
                        // SP-M M1: stamp the cleansing enemy as the reaction victim so Grif's 75%
                        // damage lands on the REAL cleanser in positional mode. In DPS/healing mode
                        // the only opposing actor IS the dummy `enemy`, so counterTargetId ===
                        // ctx.enemy.id and this is byte-identical there.
                        // Ship-kit W3 (Pestilence): ALSO stamp cleansedEnemyIds = e.targets (the
                        // enemies whose debuffs were actually removed) so a reactive `dot` ability
                        // (target 'all-enemies') fans Corrosion II out over ALL cleansed enemies —
                        // mirrors on-own-cleanse's cleansedAllyIds. counterTargetId (single cleanser)
                        // is kept for Grif's single-target damage proc; the two consumers read
                        // different fields, so both coexist.
                        if (isOpposing(e.casterId))
                            enqueue({
                                ...intent,
                                eventCtx: {
                                    ...intent.eventCtx,
                                    counterTargetId: e.casterId,
                                    cleansedEnemyIds: e.targets,
                                },
                            });
                    });
                    break;
                case 'on-enemy-buffed':
                    bus.on('buff-applied', (e) => {
                        // Opposing-scoped: any opposing-side actor RECEIVING a timed buff
                        // (e.actorId is the recipient — events.ts). For the player call: an
                        // enemy attacker gaining a self-buff. For the enemy call: a player actor
                        // gaining one. Nuqtu's self-cleanse + Terran Bolster III are both
                        // self-target — no eventCtx capture needed. One enqueue per application.
                        if (isOpposing(e.actorId)) enqueue(intent);
                    });
                    break;
                case 'on-enemy-taunt-gained':
                    bus.on('buff-applied', (e) => {
                        // Ship-kit Wave 3, Task 4: Opposing-scoped AND buff-name-filtered mirror
                        // of on-enemy-buffed — Amartya's "When an enemy defender gains Taunt, this
                        // Unit inflicts 2 stacks of Exposed on that defender" needs the Taunt-
                        // specific gate (on-enemy-buffed fires for ANY buff, unfiltered).
                        // Stamp counterTargetId = e.actorId (the defender that GAINED Taunt — the
                        // buff-applied recipient), NOT victimId: Exposed builds as a `type:'debuff'`
                        // ability (mirrors its sibling Defense Shred), and the debuff executor
                        // (executeIntent, cfg.type === 'debuff') routes single-target "on that
                        // enemy" reactions via eventCtx.counterTargetId — it never reads
                        // eventCtx.victimId (that field is consumed only by the dot/convert-dot
                        // branches). counterTargetId is exactly the field on-enemy-repaired/
                        // on-enemy-cleansed/on-enemy-charged-cast already use for this same
                        // single-recipient routing shape — without it, the debuff executor falls
                        // back to ctx.enemy.id (the DPS dummy sink) in positional/team battle.
                        if (isOpposing(e.actorId) && e.buffName === 'Taunt')
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, counterTargetId: e.actorId },
                            });
                    });
                    break;
                case 'on-own-cleanse':
                    bus.on('cleanse-performed', (e) => {
                        // Self-scoped: THIS owner performed the cleanse (Cultivator/Morao). Stamp
                        // cleansedAllyIds = e.targets (the actually-cleansed recipient ids,
                        // unfiltered) so an 'ally'-target repair (Cultivator's "that ally") fans
                        // out to exactly those recipients via reactiveRecipients; a 'self'-target
                        // repair/buff (Morao) routes to the owner regardless and ignores it. One
                        // enqueue per qualifying cast (cleanse-performed is already suppressed
                        // when 0 debuffs were removed on both sides — see events.ts).
                        if (e.casterId === ownerId)
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, cleansedAllyIds: e.targets },
                            });
                    });
                    break;
                case 'on-own-shield-strip':
                    bus.on('shield-stripped', (e) => {
                        // Ship-kit W3 (Task 7): Self-scoped: THIS owner stripped an enemy's
                        // shield (Laika). Laika's own reactive shield ability is target:'self'
                        // (reactiveRecipients routes self-target to [intent.ownerId] regardless
                        // of eventCtx — mirrors on-enemy-buffed/Nuqtu's bare enqueue), so no
                        // eventCtx stamp is needed to route the recipient; this case exists
                        // purely to GATE the fire to casts that ACTUALLY stripped shield (the
                        // charged skill only — the active skill's cleanse+damage never reaches
                        // stripShieldPct/emits shield-stripped, see events.ts's jsdoc).
                        if (e.casterId === ownerId) enqueue(intent);
                    });
                    break;
                case 'on-corrosion-spread':
                    bus.on('corrosion-spread', (e) => {
                        // Ship-kit W3 (Task 9, Hemlock): Corrosion spread at end of round (the Toxic
                        // Overflow mechanic, ledger #49). Opposing-scoped on the SOURCE: the spread
                        // originates from a unit OPPOSING this owner, so the affected units are the
                        // owner's enemies — "repairs 5% per ENEMY affected" (this is also what makes
                        // it team-symmetric: an enemy-side Hemlock heals off a player-side spread).
                        // Hemlock's heal is target:'self' (reactiveRecipients routes it to [ownerId]
                        // regardless), so the affected ids are stamped ONLY for the executor's
                        // spread-affected-count scaling to read `.length` — never for recipient
                        // routing. One enqueue per spread event. Skip when no allies were affected
                        // (empty spread) — a zero-count heal would fire and needlessly touch the
                        // reactive pipeline; "per enemy affected" of nothing is nothing.
                        if (isOpposing(e.sourceId) && e.affectedIds.length > 0)
                            enqueue({
                                ...intent,
                                eventCtx: {
                                    ...intent.eventCtx,
                                    spreadAffectedIds: e.affectedIds,
                                },
                            });
                    });
                    break;
                case 'on-enemy-purged':
                    bus.on('purge-performed', (e) => {
                        // Self-scoped on the caster: THIS owner purged an enemy (Sefuba).
                        // Route counterTargetId = e.targetId so Sefuba's chain "purge 1 more"
                        // re-purges the SAME victim (not ctx.enemyId — victim-routing).
                        // fromPurgeEvent guards the chain purge from re-emitting → depth-1.
                        if (e.casterId === ownerId)
                            enqueue({
                                ...intent,
                                eventCtx: {
                                    ...intent.eventCtx,
                                    counterTargetId: e.targetId,
                                    fromPurgeEvent: true,
                                },
                            });
                    });
                    break;
                case 'on-ally-purged':
                    bus.on('purge-performed', (e) => {
                        // Victim-scoped: a buff was purged from MY ally (Salvation). Route the
                        // heal to that ally via damagedAllyId; fromPurgeEvent guards any chained purge.
                        if (isSameSideAlly(e.targetId, ownerId))
                            enqueue({
                                ...intent,
                                eventCtx: {
                                    ...intent.eventCtx,
                                    damagedAllyId: e.targetId,
                                    fromPurgeEvent: true,
                                },
                            });
                    });
                    break;
                case 'on-cheat-death-activated':
                    bus.on('cheat-death-activated', (e) => {
                        // Self-scoped: fires when THIS OWNER's own Cheat Death intercept saves
                        // it (Yazid's "when Cheat Death activates" follow-on). Pure — enqueue
                        // only; the executor's once-per-combat cap (oncePerCombat config flag +
                        // oncePerCombatFired Set) keeps the repair to once per battle.
                        if (e.actorId === ownerId) enqueue(intent);
                    });
                    break;
                case 'on-hp-threshold-crossed':
                    bus.on('hp-changed', (e) => {
                        // Self-scoped downward crossing: fires when THIS OWNER's HP crosses below
                        // N (N from the ability's self hp-threshold condition — trigger CONFIG,
                        // not a drain-time gate; executeIntent scrubs it). Per-event check
                        // oldPct >= N > newPct: no listener state — a heal-up re-arms naturally,
                        // oncePerCombat caps re-fires. Other actors' crossings are ignored.
                        if (e.targetId !== ownerId) return;
                        const n = ra.ability.conditions.find(
                            (c) =>
                                c.subject === 'hp-threshold' &&
                                c.hpSubject === 'self' &&
                                c.hpComparator === 'below'
                        )?.hpPercent;
                        if (n === undefined) return; // no threshold configured → dormant
                        if (!(e.oldPct >= n && e.newPct < n)) return;
                        enqueue({ ...intent });
                    });
                    break;
                default:
                    // Non-live triggers are never registered (filtered at partition time).
                    break;
            }
        }
    }
}

/** Drain-time engine context the executor reads + mutates. State mutation happens
 *  ONLY here (Phase 1 contract: listeners enqueue, the executor mutates). OWNER-ROUTED
 *  (Task 6): per-intent owner-specific values (charges, landing gates, sourceId, bomb
 *  effective-attack/affinity) come from `runtimes.get(intent.ownerId)` and
 *  `lastTurnCtxByActor.get(intent.ownerId)` — NOT from a single attacker. */
export interface IntentExecContext {
    round: number;
    enemy: CombatActor;
    enemyId: string;
    statusEngine: StatusEngine;
    bus: CombatEventBus;
    /** Combat-log attribution (reactive stamping): the actorId whose turn was active when
     *  the engine began draining this reactive intent. Every event the executor emits is
     *  stamped `reactive:true` + `duringTurnOf` (this id) + `triggerActorId` (this id — the
     *  active-turn actor provoked the reaction) so a later log builder nests the reaction
     *  under the triggering turn, not the reactor's own turn. Undefined when no turn was
     *  active (round-1 start-of-round reactive, post-round death drain) → events carry
     *  `reactive:true` with an undefined `duringTurnOf`. */
    duringTurnOf?: string;
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    pendingBombs: PendingBomb[];
    /** SP-E — generic (absolute per-tick) DoT entries, for `enemyDotFamilyCounts`/`genericCount`
     *  drain-time derivation. Optional: absent test fixtures fall back to `[]` (byte-identical —
     *  no existing DoT carries a `family` tag, so the family map is always `{}` regardless). */
    genericDoTEntries?: ActiveDoTStack[];
    /** Player actor runtimes keyed by owner id ('attacker' + every walked team id). The
     *  executor resolves the intent's owner from this map for per-owner landing gates,
     *  charge caps, etc. A missing owner is a bug (throws — see executeIntent). */
    runtimes: Map<string, PlayerActorRuntime>;
    /** Delegate for ally-charge grants — the engine's own `grantAllyCharges` closure, threaded
     *  here so the executor does not need to re-implement the per-actor cap loop. The closure
     *  already iterates `allPlayerActors` with the correct chargeCount guard. The optional
     *  `emitBus` overrides the captured outer bus for the `charge-changed` emission — the executor
     *  passes `ctx.bus` (the reactive stamping wrapper) so the change brands `reactive`/`duringTurnOf`
     *  and the log nests it under the triggering turn. */
    grantAllyCharges: (
        amount: number,
        opts?: { recipientIds?: string[]; emitBus?: CombatEventBus }
    ) => void;
    /** Delegate for enemy-targeted charge removal — the engine's own `removeEnemyCharges`
     *  closure, threaded here so the executor does not re-implement the per-actor floor loop.
     *  Subtracts from every OPPOSING-side actor (floored at 0), skipping chargeLossImmune actors
     *  and chargeCount-0 actors. The closure flips to the opposing side internally. The optional
     *  `applierAffinity` enforces the Charge Manipulation affinity gate (skip targets with affinity
     *  advantage over the applier); omit it to disable the gate. The optional `emitBus` stamps the
     *  `charge-changed` when called during a reactive intent — see grantAllyCharges. */
    removeEnemyCharges: (
        amount: number,
        applierAffinity?: AffinityName,
        emitBus?: CombatEventBus
    ) => void;
    /** Delegate for single-target charge removal — the engine's own `removeChargesFrom` closure.
     *  Subtracts from ONE actor by id (floored at 0), skipping chargeLossImmune / chargeCount-0
     *  actors. Used for "decrease THAT enemy's charge" (Zosimos), routed by eventCtx.repairerId.
     *  Same optional `applierAffinity` charge-manip gate as removeEnemyCharges, and the same
     *  optional `emitBus`. */
    removeChargesFrom: (
        targetId: string,
        amount: number,
        applierAffinity?: AffinityName,
        emitBus?: CombatEventBus
    ) => void;
    /** Delegate for a reactive extra-action grant (Task 10). The executor passes the granter's
     *  id, the granting ability id, and oncePerRound; the engine decides Path A (splice into the
     *  current round's live queue via the round-scoped cursor) vs Path B (buffer for the next
     *  round when there is no live queue — the post-round enemy-death case). */
    grantExtraAction: (
        granterId: string,
        abilityId: string,
        oncePerRound: boolean,
        endOfRound: boolean
    ) => void;
    /** Same-side ally/recipient id order for the current drain side: player team ids when
     *  draining the player side; enemy attacker ids when draining the enemy side. Sourced from
     *  sideCtx.recipientIds — used for ally/all-allies buff recipients (deterministic application). */
    playerIds: string[];
    /** Enemy attacker ids (healing mode; Task 7). The opposing side for a PLAYER drain owner's
     *  `enemy-buff` gate is the enemy attacker(s) — drain sources their UNION self-buff names from
     *  here. Empty/omitted in DPS mode (no enemy attackers) → drain `enemyBuffNames` stays []. */
    enemyAttackerIds?: string[];
    /** When supplied, filters `enemyAttackerIds` to living opposing actors for the
     *  drain-time `enemy-buff` gate (Graphite start-of-round Stealth check). Absent →
     *  all ids pass through (byte-identical for callers that omit it). */
    isActorAlive?: (actorId: string) => boolean;
    /** SP-F F4: actor id → ship name, for the live `ally-on-team` roster check (Isha/Nayra's
     *  reciprocal Override gate). Present ONLY in the team-sim (battle sim). Absent (single-ship
     *  DPS / healing / any caller without ship names) → `ally-on-team` keeps its manual assume-met
     *  fallback, byte-identical to before. */
    nameByActorId?: Map<string, string>;
    /** Per-actor last-turn ctx (effectiveAttack/affinityMult for bombs). Undefined for an
     *  owner that has not acted this run (faster enemy, round 1) → bomb follow-ups skip. */
    lastTurnCtxByActor: Map<string, PlayerRoundCtx>;
    /** SP-G G3: last reactive-damage amount each owner dealt this drain cycle. A reactive shield
     *  on the same trigger with basis 'damage-dealt' but no eventCtx.triggerDamage (on-enemy-
     *  charged-cast stamps only counterTargetId) falls back to this owner-keyed amount. */
    reactiveDealtByOwner?: Map<string, number>;
    enemyType?: EnemyBaseClass;
    enemyHp: number;
    /** Damage dealt to the enemy so far (drives the drain-time enemyHpPct). */
    cumulativeDamage: number;
    /** Record a resisted enemy application onto the round's resisted list (the engine
     *  routes it to pendingResisted or the last attacker turn, per Task-2 staging). */
    recordResisted: (resisted: ActiveBuff) => void;
    /** Healing-mode runtime ctx (Task 9). Present ONLY in healing mode; the SAME shared
     *  instance the player turns use (credit/applyHealToTarget/grantShieldToTarget close
     *  over the live target). When undefined, the heal/shield/cleanse executor branches
     *  are inert (not-simulated follow-up) — DPS goldens stay byte-identical. */
    healing?: HealingRuntimeCtx;
    /** Combat-lifetime "once per battle" guard (Task 8). Owned by the engine OUTSIDE the
     *  round loop (alongside cheatDeathConsumed) so it persists across rounds. A heal whose
     *  config carries `oncePerCombat` records `${ownerId}:${abilityId}` here on its first
     *  fire and is skipped on every later fire — Yazid's on-cheat-death-activated 60% repair
     *  fires at most ONCE per combat. Absent in unit tests that exercise unbounded follow-ups. */
    oncePerCombatFired?: Set<string>;
    /** Per-(owner, ability, source) event counter for `everyNthEvent` gates. Combat-lifetime,
     *  keyed `${ownerId}:${abilityId}:${repairerId}`. Engine-populated; absent in DPS/unit mode
     *  → an everyNthEvent ability never fires (no counter to advance).
     *  Shared across both drain sides (like oncePerCombatFired); the per-(owner,ability,repairer)
     *  key makes cross-side collisions impossible by construction. */
    repairCountBySource?: Map<string, number>;
    /** Combat-lifetime per-ability proc-chance gates (e.g. Bloodthirst's 12% chance).
     *  Keyed `${ownerId}:${abilityId}`; the RateGate fires with the proc's probability on
     *  each reactive draw of the same ability so the proc lands at its true frequency. */
    procChanceGates?: Map<string, RateGate>;
    /** Live self-HP% per owner (0..100) for drain-time hp-threshold gates (Phase 4c
     *  PR 1). The engine closes over the heal target's current/max HP (healing mode);
     *  every other owner — and DPS mode entirely — reports 100 (the pre-4c default),
     *  keeping all existing drain gating byte-identical. */
    selfHpPctFor?: (ownerId: string) => number;
    /** Quixilver R2: owner's shield pool is at or above max HP. Optional — absent (every test
     *  fixture, DPS mode) → buildDrainContext leaves selfShieldFull false, so a drain gate on
     *  this subject is simply not met. Byte-identical for every ability that omits the subject. */
    selfShieldFullFor?: (ownerId: string) => boolean;
    /** Whether `ownerId` has the lowest Speed among the player team (ties → all qualify),
     *  feeding the `lowest-speed-ally` gate at drain time. Computed once by the engine (Speed
     *  is static turn-order in this sim). Absent → buildDrainContext defaults the gate to true
     *  (lone-actor DPS assumption). */
    isLowestSpeedAllyFor?: (ownerId: string) => boolean;
    /** Same-side ids adjacent to `ownerId` on the board (living, owner excluded), feeding the
     *  `adjacent-allies` buff target. Engine-populated per side. Absent / undefined → the
     *  recipient resolver falls back to ctx.playerIds (all same-side allies). */
    adjacentAllyIdsFor?: (ownerId: string) => string[];
    /** Ship-kit W5 Task C3 (Demolisher bomb-splash): OPPOSING-side ids adjacent to `anchorId` on
     *  the board (living, anchor excluded), feeding the `adjacent-enemies` reactive-damage
     *  target. Distinct from `adjacentAllyIdsFor` (which is bound to the DRAIN side, i.e. the
     *  owner's OWN side — correct for an 'adjacent-allies' buff, but wrong here: the anchor is
     *  the bombed enemy, on the side OPPOSITE the owner). Engine-populated per drain side as the
     *  OPPOSING side's `adjacentAllyIdsFor` (mirrors `livingOpposingActorIds`'s same-direction
     *  wiring). Absent / no anchor → the executor treats the fan-out as empty (never falls back
     *  to the dummy sink). */
    adjacentOpposingIdsFor?: (anchorId: string) => string[];
    /** Living ally ids on the owner's ACTIVE support pattern footprint (reactives). Absent when
     *  non-positional or the owner has no support pattern → legacy team-wide routing. */
    footprintAllyIdsFor?: (ownerId: string) => string[] | undefined;
    /** Whether `ownerId` was hit by a direct attack this round, feeding the
     *  `not-hit-this-round` gate at drain time. Engine-populated from the combat-wide
     *  hitThisRound Set. Absent → buildDrainContext defaults the gate to false (DPS /
     *  not-yet-hit → "not hit" ⇒ met), keeping existing drain gating byte-identical. */
    wasHitThisRoundFor?: (ownerId: string) => boolean;
    /** The owner's current own-turn counter (CombatActor.turnsTaken). Engine-populated;
     *  absent in DPS mode → defaults 0 (every-n-turns inert). */
    turnsTakenFor?: (ownerId: string) => number;
    /** SP-D: number of enemies damaged by `ownerId`'s most recent cast this round, feeding the
     *  `enemies-hit-this-cast` gate at drain time (Berserker's Marauder Rage, drained via the
     *  on-deal-damage reactive trigger). Engine-populated from the per-turn footprint size;
     *  absent → buildDrainContext defaults to 1 (no cast yet / DPS mode — a >=2/>=3 gate is
     *  inert, byte-identical). */
    enemiesHitThisCastFor?: (ownerId: string) => number;
    /** PR4b: apply a full mitigated/crit-eligible reactive damage hit from `ownerId` against
     *  `victimId` (Judge/Chakara/Incinerator/Rhodium start-of-round/end-of-round, Grif's
     *  on-enemy-cleansed, FrontLine's on-enemy-charged-cast). `abilityId` keys the dedicated
     *  reactive-damage crit gate; `noCrit` (Grif/Rhodium "cannot critically hit") skips the roll
     *  entirely. Mirrors `applyCounterAttack`'s mitigated/crit walk but credits the owner's round
     *  damage-dealt bucket (creditDamage) instead of applying real HP damage — this executor
     *  never mutated a specific victim's HP (was credit-only pre-fix). Absent → the damage
     *  branch is inert (unit fixtures / DPS mode w/o delegate). `allowDeadOwner` (PR-B1,
     *  Paracelsus) lets an on-destroyed retaliation fire even though its owner is already
     *  stamped destroyedRound — the reaction is BORN of that same death. Ship-kit W5 Task C3
     *  (Demolisher bomb-splash) adds `opts`: `flatBasis` (present) computes `raw` as a straight
     *  `flatBasis × multiplier/100` copy — no owner-attack basis, no defense mitigation, no crit
     *  roll (deliberately no affinity re-application either — see engine.ts's applyReactiveDamage
     *  doc for the full rationale). `ignoresDefense` (without `flatBasis`) is the non-flat
     *  generality path: the normal attack-basis/crit walk runs, but the victim's Defense term is
     *  bypassed (defence: 0). Both undefined (every pre-C3 caller) → byte-identical to before. */
    applyReactiveDamage?: (
        ownerId: string,
        victimId: string,
        abilityId: string,
        multiplier: number,
        hits: number,
        noCrit: boolean,
        hpBasisPct?: number,
        /** Ship-kit W8 (Xcellence on-resist): sibling of hpBasisPct — basis is the owner's
         *  CURRENT SHIELD instead of max HP. Mutually exclusive with hpBasisPct in the corpus. */
        shieldBasisPct?: number,
        allowDeadOwner?: boolean,
        opts?: { ignoresDefense?: boolean; flatBasis?: number }
        // Returns the mitigated/credited amount + crit flag so the caller can surface the proc in
        // the combat log (reactive-damage-performed); void/0 when the proc was guarded (dead
        // victim, non-positive) or the delegate is absent (unit fixtures).
    ) => { dealt: number; didCrit: boolean } | void;
    /** Emit the log-only consequence twins that `applyReactiveDamage`/`applyCounterAttack`
     *  buffered while applying their hit — a Lifeline `shield-applied-log`, a
     *  `shield-destroyed-log`, a `cheat-death-log`. Called right AFTER the proc's own
     *  `reactive-damage-performed` row so the consequences nest under the attack that caused them
     *  instead of printing above it. Absent on unit fixtures (the engine never buffers there), so
     *  the call is a no-op. */
    flushConsequenceLogs?: () => void;
    /** G PR1: apply a full mitigated/crit counter walk from `ownerId` to `attackerId`.
     *  `abilityId` keys the dedicated counter crit-gate. Reuses the engine's no-event
     *  apply path (no attacked event → no re-counter).
     *  Returns the mitigated/credited amount + crit flag so the caller can surface the proc in
     *  the combat log (reactive-damage-performed); void/0 when the counter was guarded (dead
     *  owner/attacker, self-hit, non-positive) or the delegate is absent (unit fixtures). */
    applyCounterAttack?: (
        ownerId: string,
        attackerId: string,
        abilityId: string,
        multiplier: number,
        hits: number
    ) => { dealt: number; didCrit: boolean } | void;
    /** G PR1: per-actor-turn once-per-attack guard. Keyed `ownerId:abilityId`. Cleared at each
     *  actor turn-start (engine) so the per-hit `attacked` events of ONE attack collapse to a
     *  single counter; a later attack (different turn) counters again. Absent → no guard (the
     *  counter branch is inert without the engine ctx). */
    counterFiredThisTurn?: Set<string>;
    /** Task 5: per-actor-turn once-per-attack guard for SELF-scoped reactive buff/charge
     *  riders. Keyed `ownerId:abilityId`, cleared at each actor turn-start (engine) — mirroring
     *  `counterFiredThisTurn`. The per-hit / per-victim reactive triggers (on-attacked,
     *  on-ally-attacked) enqueue one intent per hit per victim; a
     *  SELF-target buff/charge must land only ONCE for that whole attack. Ally/enemy-routed
     *  reactions (Sentinel damage, Howler/Cultivator/Graphite ally heal) are per-victim by design,
     *  and reactive HEALS/SHIELDS scale per hit (Isha/Adaptive Plating) — neither is keyed here
     *  (see oncePerAttackGuardKey + the heal branch). Absent → no guard (unit ctxs without the
     *  engine keep firing per intent, byte-identical). */
    reactionFiredThisAttack?: Set<string>;
    /** Per-SUB-ATTACK verdict cache for `procScope:'per-attack'` abilities (Insidiousness).
     *  Keyed `ownerId:abilityId:subAttackIndex` → the single roll's outcome; the map is cleared at
     *  each actor turn-start (engine) beside `reactionFiredThisAttack`.
     *
     *  Named `…ThisSubAttack` deliberately: the field this replaced was called
     *  `procDecisionThisAttack` while keying on `ownerId:abilityId` alone, which made it a
     *  per-TURN cache — so a `hits: N` skill replayed sub-attack #1's verdict for all N (multi-hit
     *  full-walk epic, spec §4.4). The misnomer is why that read as correct to every reviewer for
     *  months. `procScope` itself KEEPS the value name `'per-attack'`: with the index in the key it
     *  is now accurate, because a sub-attack IS an attack (R1).
     *
     *  Distinct from `reactionFiredThisAttack`: this is not a suppression guard but a memo, so
     *  EVERY qualifying event in the sub-attack still executes against its own victim under one
     *  shared pass/fail. Absent (unit ctxs) → per-event draws, byte-identical. */
    procDecisionThisSubAttack?: Map<string, boolean>;
    /** Resolve the opposing actor carrying the most buffs (Rhodium's enemy-most-buffs purge).
     *  Per-side: a player owner scans the enemy roster, an enemy owner scans the player roster.
     *  Returns undefined when no opposing actor exists (DPS dummy) → executor falls back to
     *  ctx.enemyId. Optional — absent in unit-test ctxs that don't drive most-buffs purges. */
    enemyWithMostBuffs?: (ownerId: string) => string | undefined;
    /** Task A: resolve any actor's RAW affinity by id (from the combat-wide allActorsById map).
     *  Used by the reactive `apply`-debuff branch to re-resolve landing vs the ACTUAL target's
     *  affinity instead of the applier's precomputed-vs-representative static disadvantage flag.
     *  Optional — absent in unit-test ctxs (→ landsTimedEnemyApplication falls back to the static
     *  flag, byte-identical for single-opponent fixtures). */
    affinityOf?: (actorId: string) => AffinityName | undefined;
    /** Any actor's CURRENT effective attack (base folded with its live buffs), for a reactive
     *  that must snapshot the owner's attack before the owner has taken a turn this run and so has
     *  no `lastTurnCtxByActor` entry. The reactive bomb applier is the only consumer: a faster
     *  enemy healing in round 1 wakes Ruiner's Bomb before Ruiner's first cast, and the bomb bakes
     *  its `damagePerStack` at application. Absent (unit-test ctxs) → that pre-first-turn bomb is
     *  skipped, the pre-2026-07-31 behaviour. */
    effectiveAttackFor?: (actorId: string) => number | undefined;
    /** SP-E, Task E4: resolve ANY actor (either side, from the combat-wide actor map) by id.
     *  Used by the convert-dot executor to locate the ACTUAL victim of an ally's DoT infliction
     *  (eventCtx.victimId) so it retags the right entries — team-symmetric (works whether the
     *  victim is the singular DPS/team `enemy` dummy or a real player actor hit by an enemy
     *  ally). Mirrors `affinityOf`'s allActorsById source. Optional — absent in unit-test ctxs
     *  that don't exercise convert-dot. */
    actorById?: (actorId: string) => CombatActor | undefined;
    /** Apply a forced bomb burst against `victim` through the engine's per-victim
     *  `applyVictimDamage` sink — the same funnel a natural countdown-0 detonation uses, so
     *  Barrier immunity, the Cheat-Death intercept, `recordDestroyed`/`ship-destroyed` and
     *  incoming-block/Lifeline all apply. `sourceId` is the bomb's ORIGINAL applier (attribution),
     *  never the actor that forced the burst. Consumed by the `reduce-duration` branch, which
     *  shrinks `PendingBomb.countdown` alongside the statusEngine debuffs (a Bomb is a Debuff).
     *  Absent (unit-test ctxs) → `reduceBombsOnVictim` falls back to a bare shield-then-HP debit. */
    forceDetonateBomb?: (victim: CombatActor, sourceId: string, damage: number) => void;
    /** Ship-kit W8 Task 12: resolve ANY actor's ship role (Ship.type) by id, either side — the
     *  SAME `roleByActorId` map (side-agnostic by key) Meatshield's defense-substitution and
     *  Graphite's `roleFilter` reaction-time check already consume. Used by the reactive `purge`
     *  branch to re-check an `enemy-type` gate (scrubbed from the generic drain gate above)
     *  against the REAL victim of an on-deal-damage purge (Zeolite: "… when dealing damage to a
     *  Defender"), team-symmetrically. Optional — absent in unit-test ctxs that don't drive it
     *  (an `enemy-type`-gated purge with no `roleOf` reads `undefined` → matchesRoleCategory
     *  always false → conservative no-op, byte-identical to before this task). */
    roleOf?: (actorId: string) => ShipTypeName | undefined;
    /** SP-E, Task E4: live (buff-folded) hacking/critDamage for `actorId`, either side. Used by
     *  the convert-dot executor to compute the conversion chance (hacking) and the paired
     *  crit-power extend chance (critDamage). Optional — absent in unit-test ctxs that don't
     *  exercise convert-dot. */
    effectiveStatsFor?: (actorId: string) => { hacking: number; critDamage: number } | undefined;
    /** D-PR14: id of the round's first real (non-Stasis/Disable-skipped) activator. */
    firstActivatorId?: string;
    /** D-PR16: id of the sole living actor on the drain owner's side (recomputed each drain),
     *  or undefined when !=1 actor is alive. Drives the `last-standing` gate (Last Stand). */
    lastStandingId?: string;
    /** D-PR14 Doomsayer: living opposing actor with the greatest live effective attack. */
    enemyWithHighestAttack?: (ownerId: string) => string | undefined;
    /** SP-M M1 Task 6 Chakara: living opposing actor with the greatest live effective speed.
     *  Resolved LIVE per owner (unlike enemyWithMostBuffs, no purge co-occurs with it, so no
     *  onceByOwner memo is needed). Optional — absent in unit-test ctxs that don't drive it. */
    enemyWithHighestSpeed?: (ownerId: string) => string | undefined;
    /** SP-M M1 Task 7 Judge/Incinerator: LIVING opposing-actor ids for an 'all-enemies' reactive
     *  DAMAGE proc. The executor enumerates these and re-checks the ability's per-victim enemy
     *  conditions (hp-threshold / enemy-debuff) against EACH victim's own live state. Optional —
     *  ABSENT in unit-test ctxs, where resolveAoEReactiveDamageVictims returns [] (no-op, never
     *  the vestigial dummy). Player owner → living enemy attackers; enemy owner → living players. */
    livingOpposingActorIds?: (ownerId: string) => string[];
    /** SP-M M1 Task 7: synthesized enemy debuff/DoT NAMES for a victim (the same
     *  enemyDebuffNamesForTarget synthesis buildTurnArgs uses — control/marker debuff names +
     *  base DoT-type names). Feeds the per-victim `enemy-debuff` name-gate (Incinerator's "with
     *  Inferno"). Optional — absent in unit-test ctxs (→ [] per victim). */
    enemyDebuffNamesFor?: (victimId: string) => string[];
    /** SP-M M1 Task 7: a victim's current effective max HP (engine's recipientMaxHp) — the
     *  denominator for the per-victim hp-threshold gate (Judge's "<50% HP"). Optional — absent
     *  in unit-test ctxs. */
    recipientMaxHpFor?: (victimId: string) => number;
    /** D-PR14 Bulwark: per-(owner,ability) once-per-round consume set (reset each round in engine). */
    oncePerRoundConsumed?: Set<string>;
    /** ship-kit W3 (Sansi): per-(owner,ability) fire COUNT this round — the numeric generalization
     *  of oncePerRoundConsumed, backing Ability.maxPerRound. Incremented on each successful reactive
     *  fire; the gate blocks once the count reaches the cap. Reset each round in the engine (shared
     *  across both sides, like oncePerRoundConsumed). Absent → no cap is ever enforced. */
    perRoundFireCounts?: Map<string, number>;
}

/** Build the drain-time condition context from CURRENT engine state. This is a
 *  drain-time snapshot (documented): self-buff names from the status engine, the
 *  current landed-debuff count approximation, DoT container lengths, enemyType, and
 *  the enemyHpPct derived from cumulative damage. Drain has no per-hit crit outcome,
 *  so crit-gated conditions are evaluated with effectiveCritRate 0 (treated as
 *  not-crit at drain time). */
/**
 * Build a ConditionContext for ONE actor (`ownerId`, either side) from the status engine + the shared
 * enemy state. Reused by the drain-time gate (buildDrainContext) and by the player-turn aura/accum
 * resolver (Task 5: an ally-cast aura sitting on a recipient is gated by its CASTER's context —
 * the resolver maps casterId → this ctx). The `selfBuffNames` come from that owner's snapshot, so
 * each actor's gate reads ITS OWN active buffs + the shared enemy state. `effectiveCritRate`
 * defaults to 0 (drain-time has no per-round crit folding); callers with a per-round crit rate
 * pass it explicitly.
 *
 * `includeAbilitySelfNames` (Task 5) additionally pulls the owner's ABILITY-SOURCED timed self
 * statuses (snapshot() excludes these because they carry payloads) into the gate's selfBuffNames.
 * Timed-only is deliberate: it mirrors the local `priorAbilitySelfNames` in playerTurn.ts, which
 * also collects timed statuses and not persistent ones. The player-turn
 * caster-ctx resolver sets it so a FOREIGN caster's ability self-buffs (e.g. a team ship's
 * self-granted gate buff) are visible to its own aura's gate. The drain path now ALSO sets it,
 * so drain-time `self-buff` gates see ability-granted self-buffs (e.g. Cloaking's Stealth lighting
 * up the Ambush implant). This was empirically verified golden-neutral: zero `.snap` drift across
 * the full suite, because no LIVE golden fixture pairs an ability-sourced timed self-status with a
 * drain-time self-buff gate on the same actor.
 *
 * KNOWN UNDERCOUNT (golden-locked, do not "fix" casually): `landedEnemyDebuffCount` comes from
 * `snapshot().activeEnemyDebuffs`, which — UNLIKE the now-symmetric self-buff side above — still
 * EXCLUDES payload-carrying ABILITY-sourced enemy debuffs. So an `enemy-debuff gte N` threshold
 * gate (Asphyxiator etc.) undercounts at drain time and for foreign-caster auras: ability-applied
 * statuses don't increment the tally. This is intentional drain-time approximation that PRE-DATES
 * the team walk — buildDrainContext used this same snapshot count before the team-walk PR, and the
 * golden drain fixtures are hand-built around it. There is no `includeAbilityEnemyNames` analogue
 * to the self-side switch because turning it on would change drain gating and churn every locked
 * golden. Tracked as a backlog item in docs/skill-model-coverage.archived-2026-06-12.md §6.
 */
export function buildActorConditionContext(
    statusEngine: StatusEngine,
    ownerId: string,
    shared: {
        corrosionEntryCount: number;
        infernoEntryCount: number;
        bombCount: number;
        enemyType?: EnemyBaseClass;
        enemyHpPct: number;
        effectiveCritRate?: number;
        includeAbilitySelfNames?: boolean;
        /** Self HP% (0..100). Default 100 (DPS-assumption). Populated by live engine in Task 3+. */
        selfHpPct?: number;
        /** Active buff names on the enemy. Default [] (DPS-assumption). Populated in Task 7+. */
        enemyBuffNames?: string[];
        /** Active debuff names on self. Default [] (DPS-assumption). Populated in Task 7+. */
        selfDebuffNames?: string[];
        /** Owner has the lowest Speed among its player team. Default true (lone-actor /
         *  DPS assumption). Populated by buildDrainContext (Phase 4c PR 6). */
        isLowestSpeedAlly?: boolean;
        /** Quixilver R2: owner's shield pool is at or above max HP. Default false (DPS mode /
         *  no shield). Populated by buildDrainContext from the engine's selfShieldFullFor delegate. */
        selfShieldFull?: boolean;
        /** Malvex charged Barrier: the owner's TARGET has a shield. Default false. NOT populated
         *  by buildDrainContext — a reaction has no "the cast's primary target" (ctx.enemy is the
         *  legacy/dummy victim sink on the player side), and the only corpus consumer of
         *  `enemy-shield` is an on-cast charged-slot grant that never reaches executeIntent. The
         *  field is threaded here so a future reactive consumer only needs an IntentExecContext
         *  delegate, not another hand-enumerated layer. */
        enemyShielded?: boolean;
        /** Owner was hit by a direct attack this round. Default false. Populated by
         *  buildDrainContext (D-PR8). */
        wasHitThisRound?: boolean;
        /** Owner took the round's first real turn. Default false. Populated by
         *  buildDrainContext (D-PR14). */
        firstActivator?: boolean;
        /** Owner is the sole living actor on its side. Default false. Populated by
         *  buildDrainContext (D-PR16). */
        lastStanding?: boolean;
        /** Owner's own-turn counter (CombatActor.turnsTaken). Default 0 (DPS-assumption).
         *  Populated by buildDrainContext (Phase 0 Task 4). */
        turnsTaken?: number;
        /** SP-D: number of enemies damaged by the owner's most recent cast this round. Default 1
         *  (no cast yet / DPS mode). Populated by buildDrainContext from the engine's per-actor
         *  enemiesHitThisCastFor delegate — REQUIRED for a passive-sourced timed self-buff gated
         *  on this subject (Berserker's Marauder Rage) to actually re-evaluate on-cast instead of
         *  only at the one-time combat-start seed (see seedPassiveTimedStatuses). */
        enemiesHitThisCast?: number;
        /** SP-E: `genericDoTEntries.length` at drain time. Default 0 (no generic DoT tracked
         *  by this caller). Folded into `enemyDotCount` alongside corrosion/inferno/bomb. */
        genericCount?: number;
        /** SP-E: live per-family DoT entry counts (Belladonna's "3+ Acidic Decay" gate) at
         *  drain time. Default undefined — every family reads 0 via
         *  ConditionContext.enemyDotFamilyCounts' own fallback. */
        enemyDotFamilyCounts?: Record<string, number>;
        /** SP-F F4: living same-team ally ship names for `ally-on-team` (Isha/Nayra reciprocal
         *  Override gate). Default undefined → manual assume-met fallback (single-ship DPS / no
         *  roster). Populated by buildDrainContext when the engine has a name map (team-sim). */
        allyTeamNames?: string[];
    }
) {
    const snap = statusEngine.snapshot(ownerId);
    const selfBuffNames = snap.activeSelfBuffs
        .filter((ab) => ab.stacks === undefined || ab.stacks > 0)
        .map((ab) => ab.buffName);
    if (shared.includeAbilitySelfNames) {
        // Ability-sourced self statuses are payload-carrying → excluded from snapshot(); add their
        // names so a caster's self-granted gate buffs are visible to its own aura/accum gate.
        for (const s of statusEngine.timedAbilityStatuses('self', ownerId)) {
            selfBuffNames.push(s.active.buffName);
        }
    }
    return buildRoundContext({
        selfBuffNames,
        landedEnemyDebuffCount: snap.activeEnemyDebuffs.length,
        corrosionEntryCount: shared.corrosionEntryCount,
        infernoEntryCount: shared.infernoEntryCount,
        bombCount: shared.bombCount,
        genericCount: shared.genericCount,
        enemyDotFamilyCounts: shared.enemyDotFamilyCounts,
        effectiveCritRate: shared.effectiveCritRate ?? 0,
        enemyType: shared.enemyType,
        enemyHpPct: shared.enemyHpPct,
        selfHpPct: shared.selfHpPct,
        enemyBuffNames: shared.enemyBuffNames,
        selfDebuffNames: shared.selfDebuffNames,
        isLowestSpeedAlly: shared.isLowestSpeedAlly,
        selfShieldFull: shared.selfShieldFull,
        enemyShielded: shared.enemyShielded,
        wasHitThisRound: shared.wasHitThisRound,
        firstActivator: shared.firstActivator,
        lastStanding: shared.lastStanding,
        turnsTaken: shared.turnsTaken,
        enemiesHitThisCast: shared.enemiesHitThisCast,
        allyTeamNames: shared.allyTeamNames,
    });
}

function buildDrainContext(ctx: IntentExecContext, ownerId: string) {
    const enemyHpPct =
        ctx.enemyHp > 0 ? Math.max(0, 100 * (1 - ctx.cumulativeDamage / ctx.enemyHp)) : 100;
    // Owner-aware drain gate (Task 6): self-buff names come from the OWNER's snapshot so each
    // owner's reactive follow-up is gated against ITS OWN active buffs + the shared enemy state.
    // `includeAbilitySelfNames` is now TRUE at drain time so the gate ALSO sees ability-sourced
    // timed self statuses (which snapshot() excludes because they carry payloads) — this lets a
    // drain-time `self-buff` gate fire off an ability-granted self-buff (e.g. Cloaking's Stealth
    // satisfying the Ambush implant's Stealth gate). This is a GENERAL broadening — it applies to
    // ANY drain-path ability gated on a `self-buff` whose buff is ability-sourced (skill-parsed
    // self-buff gates too, not just the Ambush registry entry); Ambush is merely the first consumer.
    // Verified golden-neutral: zero `.snap` drift across the full suite, since no LIVE fixture pairs
    // such a status with a drain-time self-buff gate. (The enemy-debuff side stays snapshot-only —
    // see buildActorConditionContext doc.)
    return buildActorConditionContext(ctx.statusEngine, ownerId, {
        includeAbilitySelfNames: true,
        corrosionEntryCount: ctx.corrosionEntries.length,
        infernoEntryCount: ctx.infernoEntries.length,
        bombCount: ctx.pendingBombs.length,
        // SP-E: live generic-DoT count + per-family map (Belladonna's "3+ Acidic Decay" gate) at
        // drain time. `ctx.genericDoTEntries` is optional (test fixtures may omit it) → `[]`
        // fallback, matching every other optional IntentExecContext field's default pattern.
        genericCount: (ctx.genericDoTEntries ?? []).length,
        enemyDotFamilyCounts: dotFamilyCounts(
            ctx.corrosionEntries,
            ctx.infernoEntries,
            ctx.genericDoTEntries ?? []
        ),
        enemyType: ctx.enemyType,
        enemyHpPct,
        // Task 6 (Phase 4c PR 1): live self-HP% for drain-time hp-threshold gates. The engine
        // closes over the heal target's current/max HP; every non-tank id and DPS mode report 100
        // (the pre-4c default) → all existing drain gating stays byte-identical.
        selfHpPct: ctx.selfHpPctFor?.(ownerId) ?? 100,
        // Task 7 (names only — never folded, no double-fold): the drain owner's `enemy-buff` gate
        // reads the UNION of enemy attackers' self-buffs; its `self-debuff` gate reads its OWN
        // enemy-applied debuffs (per-target store keyed by ownerId). Both empty in DPS mode
        // (no enemy attackers, no debuffs on player actors) → drain gating byte-identical.
        enemyBuffNames: selfBuffNamesForOwners(
            ctx.statusEngine,
            (ctx.enemyAttackerIds ?? []).filter((id) => ctx.isActorAlive?.(id) ?? true)
        ),
        selfDebuffNames: ownerDebuffNamesFor(ctx.statusEngine, ownerId),
        // Phase 4c PR 6: live lowest-speed-ally gate (Chakara). Default true → DPS / no-delegate
        // paths keep the lone-actor assumption and stay byte-identical.
        isLowestSpeedAlly: ctx.isLowestSpeedAllyFor?.(ownerId) ?? true,
        selfShieldFull: ctx.selfShieldFullFor?.(ownerId) ?? false,
        // D-PR8: live not-hit-this-round gate (Alacrity). Default false → DPS / no-delegate
        // paths read "not hit" ⇒ met and stay byte-identical.
        wasHitThisRound: ctx.wasHitThisRoundFor?.(ownerId) ?? false,
        // D-PR14: live first-activator gate (Doomsayer). Default false → DPS / no-delegate
        // paths read "not first" ⇒ not met and stay byte-identical.
        firstActivator: ctx.firstActivatorId === ownerId,
        // D-PR16: live last-standing gate (Last Stand). lastStandingId is undefined unless EXACTLY
        // one same-side actor is alive → DPS / no-delegate paths read "not alone" ⇒ not met and
        // stay byte-identical.
        lastStanding: ctx.lastStandingId === ownerId,
        // Phase 0 Task 4: every-n-turns gate (Chrono Reaver). Default 0 → DPS / no-delegate
        // paths read 0 and stay byte-identical (the evaluator's t<=0 guard blocks ALL
        // periods at turn 0, so every-n-turns is never met).
        turnsTaken: ctx.turnsTakenFor?.(ownerId) ?? 0,
        // SP-D: live enemies-hit-this-cast gate (Berserker's Marauder Rage). Default 1 → DPS /
        // no-delegate paths keep the single-target assumption (a >=2/>=3 gate stays inert) and
        // stay byte-identical.
        enemiesHitThisCast: ctx.enemiesHitThisCastFor?.(ownerId) ?? 1,
        // SP-F F4: live same-team ally ship names (Isha/Nayra reciprocal Override gate). Only when
        // the engine supplied a name map (team-sim). `playerIds` is the drain owner's OWN side; we
        // exclude the owner itself (ALLY names, self-excluded — mirrors `isSameSideAlly`), keep only
        // living members, and map ids → names. Absent map → undefined → assume-met fallback.
        allyTeamNames: ctx.nameByActorId
            ? ctx.playerIds
                  .filter((id) => id !== ownerId && (ctx.isActorAlive?.(id) ?? true))
                  .map((id) => ctx.nameByActorId?.get(id))
                  .filter((n): n is string => n !== undefined)
            : undefined,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// NAMES-ONLY status exposure (Task 7) — for the player-side `enemy-buff` /
// `self-debuff` condition gates. These read buff/debuff NAMES from the status
// engine WITHOUT folding any effect. Effects are folded exactly once elsewhere
// (snapshot()'s active lists + activeAbilityStatuses/timedAbilityStatuses); these
// helpers add ONLY names to a condition context, so there is no double-fold.
//
// Payload-exclusion rule: ability-sourced statuses carry a payload and are
// excluded from snapshot() (the `!s.payload` guards). To surface their names we
// pull them from timedAbilityStatuses/activeAbilityStatuses (which DO return
// payload-carriers) — names only, never re-applying the payload effect.
// ─────────────────────────────────────────────────────────────────────────────

// Neutral resolver for the names-only aura/accum reads: a status's own conditions
// are evaluated against a default (full-HP, no-debuff) round context. This is a
// deliberate names-existence approximation — an "enemy has a buff" / "self has a
// debuff" gate only needs to know the status is present, not re-derive its full
// live gate. No fixture exercises a conditional enemy aura/accum, so this is inert
// for current goldens (YAGNI: the gated full-kit enemy lands in a later task).
const NEUTRAL_NAMES_CTX = buildRoundContext({
    selfBuffNames: [],
    landedEnemyDebuffCount: 0,
    corrosionEntryCount: 0,
    infernoEntryCount: 0,
    bombCount: 0,
    effectiveCritRate: 0,
});

/** Union of self-buff NAMES held by the given owners (e.g. all enemy attackers).
 *  Scheduled non-payload buffs come from snapshot().activeSelfBuffs; payload-carrying
 *  ability self statuses (timed window-persisting + aura/accum) come from the
 *  ability-status reads. Used to populate `enemyBuffNames` for any actor's
 *  `enemy-buff` gate: a player actor sees the enemy attackers, an enemy actor sees
 *  the player team — the engine passes the correct opposing owner ids; this function
 *  just unions self-buff names for whatever owner ids it's given. Aggregation choice:
 *  UNION across all the given owners (the condition is
 *  conceptually "does an enemy have a buff", not "does THIS enemy" — the simplest
 *  correct interpretation for multi-enemy healing mode). De-duplicated. */
export function selfBuffNamesForOwners(statusEngine: StatusEngine, ownerIds: string[]): string[] {
    const names = new Set<string>();
    for (const ownerId of ownerIds) {
        const snap = statusEngine.snapshot(ownerId);
        for (const ab of snap.activeSelfBuffs) {
            if (ab.stacks === undefined || ab.stacks > 0) names.add(ab.buffName);
        }
        for (const s of statusEngine.timedAbilityStatuses('self', ownerId)) {
            names.add(s.active.buffName);
        }
        for (const s of statusEngine.activeAbilityStatuses(
            'self',
            () => NEUTRAL_NAMES_CTX,
            ownerId
        )) {
            names.add(s.active.buffName);
        }
    }
    return [...names];
}

/** Sub-project I, PR I5 — count of DISTINCT owners (out of the given owner ids) currently
 *  holding the named self-buff. Reads the SAME three sources as {@link selfBuffNamesForOwners}
 *  (scheduled activeSelfBuffs + timed ability statuses + aura/accum ability statuses) but per
 *  OWNER rather than as a deduped name union — this is what lets Selenite's "10% more direct
 *  damage for every enemy with Stealth" tell 1 stealthed enemy from N, which a name union
 *  cannot. Each owner counts at most once even if the buff is present via multiple sources. */
export function countOwnersWithSelfBuff(
    statusEngine: StatusEngine,
    ownerIds: string[],
    buffName: string
): number {
    let count = 0;
    for (const ownerId of ownerIds) {
        const snap = statusEngine.snapshot(ownerId);
        const hasIt =
            snap.activeSelfBuffs.some(
                (ab) => ab.buffName === buffName && (ab.stacks === undefined || ab.stacks > 0)
            ) ||
            statusEngine
                .timedAbilityStatuses('self', ownerId)
                .some((s) => s.active.buffName === buffName) ||
            statusEngine
                .activeAbilityStatuses('self', () => NEUTRAL_NAMES_CTX, ownerId)
                .some((s) => s.active.buffName === buffName);
        if (hasIt) count += 1;
    }
    return count;
}

/** Total STACK count of a single named self-buff held by `ownerId`, aggregated across the SAME
 *  three sources as {@link selfBuffNamesForOwners} (scheduled snapshot self-buffs + timed ability
 *  statuses + aura/accum ability statuses). This is the stacks-aware sibling of the name-only
 *  reads: consumers that need the count (Protection damage-transfer's per-stack fraction) cannot
 *  use `snapshot().activeSelfBuffs` alone — that surfaces only SCHEDULED (non ability-sourced)
 *  buffs on the 'attacker' owner, so an aura-granted Protection (Meatshield / SP-G G1b) or any
 *  non-'attacker' owner's Protection would be invisible (the trap documented at the Cheat-Death
 *  detection site in engine.ts). A single status instance lands in EXACTLY ONE of the three
 *  sources (payload-carrying statuses are excluded from snapshot; timed and aura/accum live in
 *  disjoint maps), so summing across all three does not double-count. A stackless entry counts as
 *  1; a seeded-but-inert (stacks === 0) entry counts as 0. */
export function selfBuffStacksForOwner(
    statusEngine: StatusEngine,
    ownerId: string,
    buffName: string
): number {
    let total = 0;
    for (const ab of statusEngine.snapshot(ownerId).activeSelfBuffs) {
        if (ab.buffName === buffName && (ab.stacks === undefined || ab.stacks > 0))
            total += ab.stacks ?? 1;
    }
    for (const s of statusEngine.timedAbilityStatuses('self', ownerId)) {
        if (
            s.active.buffName === buffName &&
            (s.active.stacks === undefined || s.active.stacks > 0)
        )
            total += s.active.stacks ?? 1;
    }
    for (const s of statusEngine.activeAbilityStatuses('self', () => NEUTRAL_NAMES_CTX, ownerId)) {
        if (
            s.active.buffName === buffName &&
            (s.active.stacks === undefined || s.active.stacks > 0)
        )
            total += s.active.stacks ?? 1;
    }
    return total;
}

/** Enemy-debuff NAMES carried in the per-TARGET store keyed by `targetId` (an actor's
 *  OWN debuffs). Scheduled non-payload debuffs come from snapshot(_, targetId).activeEnemyDebuffs;
 *  payload-carrying ability debuffs (timed + aura/accum) come from the ability-status reads
 *  keyed by the same target. Used to populate `selfDebuffNames` for an actor (either side) whose own
 *  enemy-applied debuffs live under its id (the heal target / tank). De-duplicated. */
export function ownerDebuffNamesFor(statusEngine: StatusEngine, targetId: string): string[] {
    const names = new Set<string>();
    const snap = statusEngine.snapshot(undefined, targetId);
    for (const ab of snap.activeEnemyDebuffs) {
        if (ab.stacks === undefined || ab.stacks > 0) names.add(ab.buffName);
    }
    for (const s of statusEngine.timedAbilityStatuses('enemy', undefined, targetId)) {
        names.add(s.active.buffName);
    }
    for (const s of statusEngine.activeAbilityStatuses(
        'enemy',
        () => NEUTRAL_NAMES_CTX,
        undefined,
        targetId
    )) {
        names.add(s.active.buffName);
    }
    return [...names];
}

// DEFAULT_ENEMY_TARGET is imported from statusEngine.ts — single source of truth.

/** Returns the full per-victim enemy-debuff SET as SelectedGameBuff effects, folding BOTH
 *  channels:
 *  - scheduled (__enemy__ global auras/manual — upsertBuff is hardcoded to '__enemy__')
 *  - ability (payload, per-victim — timed + aura/accum keyed by targetId)
 *  Reads the same three sources as ownerDebuffNamesFor, with ONE deliberate difference: the
 *  scheduled source is keyed to the GLOBAL '__enemy__' store (because upsertBuff is hardcoded to
 *  write there) — NOT per-victim like ownerDebuffNamesFor's snapshot(undefined, targetId). The two
 *  ability sources ARE per-victim (keyed by targetId). If upsertBuff ever becomes per-victim aware,
 *  revisit the scheduled key here. Import-cycle safe: expandEnemyDebuffs + payloadToSelectedBuff
 *  come from ./buffTotals (leaf module), not from ./playerTurn (which imports triggers.ts).
 *
 *  APPROXIMATION NOTE (finding I1): the aura/accumulating branch — `activeAbilityStatuses('enemy',
 *  () => NEUTRAL_NAMES_CTX, ...)` — deliberately mirrors `ownerDebuffNamesFor`'s names read: it
 *  applies a NEUTRAL gating ctx (full HP, no debuffs, default context) and NO per-round landing
 *  re-roll. This differs from the aggregate `roundEnemyDebuffs` fold in `playerTurn.ts` (~925-963),
 *  which applies a per-round re-roll (`isApply ? !affinityDisadvantage : roundDebuffLanded()`,
 *  dropping resisted entries) and uses the real gating context. Consequently, for aura/accumulating
 *  enemy debuffs that carry stat effects (`defense`/`incomingDamage`), the per-victim modifier
 *  returned here is an APPROXIMATION that may diverge from what the aggregate would produce.
 *  This is an accepted approximation: it is internally consistent with the names reader (which
 *  B2/B3 Stasis relies on), and Stasis — the primary aura/accum enemy debuff in the current
 *  model — carries empty parsedEffects so no modifier divergence occurs in practice. The timed
 *  ability channel is NOT approximated (landing is gated at application time, before this read). */
export function victimEnemyBuffs(
    statusEngine: StatusEngine,
    targetId: string,
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>
): SelectedGameBuff[] {
    const scheduled = expandEnemyDebuffs(
        statusEngine.snapshot(undefined, DEFAULT_ENEMY_TARGET).activeEnemyDebuffs,
        enemyDebuffLookup
    );
    const timed = statusEngine
        .timedAbilityStatuses('enemy', undefined, targetId)
        .map((s) => payloadToSelectedBuff(s.payload));
    const active = statusEngine
        .activeAbilityStatuses('enemy', () => NEUTRAL_NAMES_CTX, undefined, targetId)
        .map((s) => payloadToSelectedBuff(s.payload));
    return [...scheduled, ...timed, ...active];
}

/** Friendly twin of victimEnemyBuffs: a victim's OWN self-/ally-granted buffs, across all
 *  three channels — scheduled self-buffs (snapshot(victimId).activeSelfBuffs, expanded via
 *  selfBuffLookup), timed ability statuses, and aura/accumulating ability statuses. Used by
 *  the engine's per-victim incoming fold (victimIncomingModifiers, D-PR12) to source friendly
 *  Inc. Damage Down/Up. Team-agnostic: 'self'-side statuses are keyed by the actor's own id
 *  (same read selfBuffNamesForOwners uses for either team). The aura/accumulating channel
 *  carries the same NEUTRAL-ctx approximation noted on victimEnemyBuffs; the live ship sources
 *  (Makoli/Salvation/Shelter/Refine/Battlecry) are TIMED and not approximated. */
export function victimSelfBuffs(
    statusEngine: StatusEngine,
    victimId: string,
    selfBuffLookup: Map<string, SelectedGameBuff[]>
): SelectedGameBuff[] {
    const scheduled = statusEngine
        .snapshot(victimId)
        .activeSelfBuffs.flatMap((ab) =>
            expandBuffEntry(ab, selfBuffLookup.get(ab.buffName) ?? [])
        );
    const timed = statusEngine
        .timedAbilityStatuses('self', victimId)
        .map((s) => payloadToSelectedBuff(s.payload));
    const active = statusEngine
        .activeAbilityStatuses('self', () => NEUTRAL_NAMES_CTX, victimId)
        .map((s) => payloadToSelectedBuff(s.payload));
    return [...scheduled, ...timed, ...active];
}

/** The id of the actor that applied an active 'Provoke' debuff to `actorId`, or undefined
 *  if `actorId` carries no Provoke or the Provoke was applied without a caster identity.
 *  Provoke is a debuff ON the provoked attacker, so it lives in that actor's own enemy-side
 *  per-target store. Single entry expected (family-overwrite keys on 'Provoke'); the casterId
 *  is the provoker, mapped to a living opposing actor by resolvePositionalTarget. */
export function provokerOf(statusEngine: StatusEngine, actorId: string): string | undefined {
    for (const s of statusEngine.timedAbilityStatuses('enemy', undefined, actorId)) {
        if (s.active.buffName === 'Provoke' && s.casterId !== undefined) return s.casterId;
    }
    for (const s of statusEngine.activeAbilityStatuses(
        'enemy',
        () => NEUTRAL_NAMES_CTX,
        undefined,
        actorId
    )) {
        if (s.active.buffName === 'Provoke' && s.casterId !== undefined) return s.casterId;
    }
    return undefined;
}

/** Per-actor forced-targeting/stealth status, read from the status engine for the given
 *  actor ids. Stealth/Taunt are self-buffs (selfBuffNamesForOwners); Concentrate Fire is a
 *  debuff on the focus target (ownerDebuffNamesFor). Read-half only — no applier wiring this
 *  phase. `tauntAppliedRound` is left unset (the query layer exposes no application round →
 *  callers degrade to front-most board order). */
export function buildForcedTargetingStatus(
    statusEngine: StatusEngine,
    actorIds: string[]
): Map<string, ActorTargetingStatus> {
    const map = new Map<string, ActorTargetingStatus>();
    for (const id of actorIds) {
        const selfNames = selfBuffNamesForOwners(statusEngine, [id]);
        const debuffNames = ownerDebuffNamesFor(statusEngine, id);
        map.set(id, {
            stealthed: selfNames.includes('Stealth'),
            taunting: selfNames.includes('Taunt'),
            concentrated: debuffNames.includes('Concentrate Fire'),
        });
    }
    return map;
}

function payloadFromConfig(cfg: {
    buffName: string;
    stacks: number;
    parsedEffects: ParsedBuffEffects;
    application?: 'inflict' | 'apply';
}): AbilityStatusPayload {
    return {
        buffName: cfg.buffName,
        stacks: cfg.stacks,
        parsedEffects: cfg.parsedEffects,
        ...(cfg.application ? { application: cfg.application } : {}),
    };
}

/**
 * Resolve the recipient id list for a reactive heal/cleanse/purge intent.
 * 'ally'-target: prefers eventCtx.cleansedAllyIds (Phase 3 PR-H: fans out over EVERY actually-
 * cleansed ally — Cultivator's "that ally"), then eventCtx.damagedAllyId (the ally that was hit),
 * falling back to fallbackTargetId (the heal target). 'all-allies': fans out to every same-side
 * id (ctx.playerIds). Anything else (self, enemy, …): the owner only.
 */
export function reactiveRecipients(
    intent: Intent,
    ctx: IntentExecContext,
    fallbackTargetId: string
): string[] {
    const base =
        intent.ability.target === 'ally'
            ? intent.eventCtx?.cleansedAllyIds?.length
                ? intent.eventCtx.cleansedAllyIds
                : [intent.eventCtx?.damagedAllyId ?? fallbackTargetId]
            : intent.ability.target === 'all-allies'
              ? ctx.playerIds
              : intent.ability.target === 'adjacent-allies'
                ? (ctx.adjacentAllyIdsFor?.(intent.ownerId) ?? ctx.playerIds)
                : [intent.ownerId];
    return footprintFilteredRecipients(intent, ctx, base);
}

/**
 * Intersect reactive support recipients with the owner's active support footprint.
 *
 * A reactive ability is passive-sourced, and a ship's targeting pattern governs its CAST, not its
 * passives (user-verified 2026-07-31 via Volk — see `Ability.patternScoped`). So the footprint
 * applies only to the abilities whose own clause names the pattern: Graphite's "adds N charges to
 * the charged skill of all allies within the active pattern", AEGIS's and Cultivator's ally-scoped
 * triggers. Everything else reaches any same-side ally.
 *
 * AEGIS/Cultivator caveat: in their wording the pattern scopes the TRIGGER ("when an ally within
 * the active pattern is …"), not the recipient. Filtering their recipients is an approximation —
 * but it is exactly the behaviour that shipped before this rule, so flagging them is status-quo,
 * not a new claim.
 */
export function footprintFilteredRecipients(
    intent: Intent,
    ctx: IntentExecContext,
    baseRecipients: string[]
): string[] {
    if (intent.ability.patternScoped !== true) return baseRecipients;
    const footprint = ctx.footprintAllyIdsFor?.(intent.ownerId);
    if (footprint === undefined) return baseRecipients;
    return resolveSupportRecipients({
        target: intent.ability.target,
        casterId: intent.ownerId,
        baseRecipients,
        footprintAllyIds: footprint,
    });
}

/**
 * Per-(owner,ability) proc-chance gate, shared by the heal/shield and damage reactive branches.
 * Pass-through when procChance is undefined / <=0 / >=1, or when the gate map is absent (unit-test
 * contexts). Do NOT hoist the call above the type-branch dispatch — the heal/shield branch must keep
 * its `!ctx.healing` early-return BEFORE consulting the gate (else the gate desyncs in non-healing
 * passes). Branch-local by design.
 */
function passesProcChanceGate(intent: Intent, ctx: IntentExecContext): boolean {
    const pc = intent.ability.procChance;
    if (pc === undefined || pc <= 0 || pc >= 1) return true;
    const gateKey = `${intent.ownerId}:${intent.ability.id}`;
    // procScope:'per-attack' (Insidiousness): one roll for the whole attack. The verdict is
    // memoized per (owner, ability) and replayed for every later event this attack, so an AoE
    // debuffer's four debuff applications share ONE 21% roll and all-or-none holds across every
    // debuffed enemy. Opt-in by design — this gate is shared with the heal/shield/buff/debuff
    // branches, and memoizing unconditionally would silently convert every other proc ability
    // (Adaptive Plating, Smokescreen, Ambush, Bloodthirst, Reactive Ward, Tenacity) to per-turn.
    const memo =
        intent.ability.procScope === 'per-attack' ? ctx.procDecisionThisSubAttack : undefined;
    // PR4: one verdict per SUB-ATTACK. The gate/stream key stays `${owner}:${ability}` — that is the
    // owner's shared "proc" sub-stream and fragmenting it would re-roll cross-actor locality — but
    // the MEMO key carries the sub-attack, so attacks #2..#N draw afresh instead of replaying #1's
    // verdict. An event with no sub-attack identity (start-of-round, on-attacked, or one of the two
    // cast-scoped engine fallbacks — nothing-landed / enemy 0-damage) keys 'x' and keeps exactly
    // today's per-turn behaviour. PR5: the non-positional inline emit now ALSO stamps a real index
    // on every real cast, so it no longer falls into this bucket.
    const memoKey = `${gateKey}:${intent.eventCtx?.subAttackIndex ?? 'x'}`;
    const cached = memo?.get(memoKey);
    if (cached !== undefined) return cached;
    let gate = ctx.procChanceGates?.get(gateKey);
    if (ctx.procChanceGates && !gate) {
        // Keyed by owner + purpose (SP-0 Task 3), NOT the finer-grained map key — every
        // proc-chance ability on this owner shares the owner's "proc" sub-stream, which is
        // enough for cross-actor locality (this task's invariant) without re-litigating
        // per-ability draw order within one actor.
        gate = makeRateGate(`${intent.ownerId}:proc`);
        ctx.procChanceGates.set(gateKey, gate);
    }
    const verdict = !gate || gate(pc);
    memo?.set(memoKey, verdict);
    return verdict;
}

/** D-PR14 once-per-round gate, shared by the damage/heal/shield executors (the debuff branch
 *  keeps its own inline split — its check must precede the stateful procChance gate to stay
 *  byte-identical for Bulwark). Returns false if this (owner, ability) already fired its
 *  once-per-round effect this round; otherwise marks it consumed and returns true. Pass-through
 *  (always true, no marking) when the ability is not oncePerRound. Call AFTER passesProcChanceGate
 *  in the damage/heal/shield branches (those have no procChance users today, so ordering is moot,
 *  but keep the proc gate first for consistency). */
function passesOncePerRoundGate(intent: Intent, ctx: IntentExecContext): boolean {
    if (!intent.ability.oncePerRound) return true;
    const onceKey = `${intent.ownerId}:${intent.ability.id}`;
    if (ctx.oncePerRoundConsumed?.has(onceKey)) return false;
    ctx.oncePerRoundConsumed?.add(onceKey);
    return true;
}

/** ship-kit W3 numeric per-round cap (Sansi's "limited to 3 times per Round") — the counting
 *  generalization of passesOncePerRoundGate. Returns false once this (owner, ability) has already
 *  fired `maxPerRound` times this round; otherwise increments the count and returns true.
 *  Pass-through (always true, no counting) when the ability has no maxPerRound. Call AFTER the
 *  proc/once-per-round gates so a blocked fire never advances the count. */
function passesMaxPerRoundGate(intent: Intent, ctx: IntentExecContext): boolean {
    const cap = intent.ability.maxPerRound;
    if (cap === undefined) return true;
    const key = `${intent.ownerId}:${intent.ability.id}`;
    const fired = ctx.perRoundFireCounts?.get(key) ?? 0;
    if (fired >= cap) return false;
    ctx.perRoundFireCounts?.set(key, fired + 1);
    return true;
}

/**
 * Execute one drained follow-up intent against the engine context. Dispatches on
 * the ability's config type (the ONLY state mutator in the trigger machinery):
 *  - charge → cap-bumped attacker charges (no-op when chargeCount === 0).
 *  - buff (self) → timed application (duration ?? 1; reactive buffs bypass aura
 *    classification — their duration decides) + buff-applied. NOTE: a persistent
 *    stacking buffName (see persistentStackingBuffs) is routed inside statusEngine to
 *    the persistent-stack map instead — it accumulates a stack and ignores duration.
 *  - debuff (enemy) → drain-time condition gate, then landing draw: landed →
 *    timed application + debuff-applied (chainable); resisted → resisted list +
 *    debuff-resisted. NOTE: a persistent stacking buffName lands as an accumulating
 *    stack (duration ?? 1 is irrelevant — statusEngine routes it persistent by name).
 *  - dot → landing draw, then append to the enemy DoT containers + dot-applied
 *    (chainable). Bombs need effectiveAttack; skipped with a note when undefined.
 *  - heal/shield (Task 9) → healing mode only (ctx.healing): credit the owner's bucket
 *    + route the consumption/pool to the target. Reactive heals NEVER crit (no draw at
 *    drain time — deterministic, documented approximation) and use a SIMPLIFIED fold
 *    (heal: healModifier only; shield: basis×pct). DELIBERATELY emits NO heal-performed
 *    (a reactive heal must not re-trigger heal listeners — chain guard). Off → silent skip.
 *  - cleanse (Task 9) → healing mode only: credit cleanseCount. Off → silent skip.
 *  - any other type → skipped silently (not-simulated follow-up payloads).
 * Intents that emit events (debuff/dot) chain through the listeners again. heal/shield/
 * cleanse emit nothing, so they never chain.
 *
 * Condition gating applies to ALL four branches, not just debuff: reclassified
 * start-of-round buffs carry real co-gates (Sustainer `self-debuff eq 0`,
 * Asphyxiator `enemy-debuff gte 3`, Nayra `ally-on-team`), and a gated charge/dot
 * follow-up must respect its gate too. The gate is built ONCE against the drain
 * context (CURRENT engine state) and evaluated up front. A failed gate is a silent
 * skip — NOT a resist (a condition-gated skip mirrors the cast path's "application
 * skipped" semantics; no resisted record is produced).
 */
/** The CombatEvent `type` tags whose variant intersects ReactiveStamp (events.ts). */
type StampedEventType =
    | 'ability-performed'
    | 'charge-changed'
    | 'heal-performed'
    | 'shield-applied'
    | 'reactive-damage-performed'
    | 'reactive-heal-performed'
    | 'reactive-cleanse-performed'
    | 'buff-applied'
    | 'buff-expired'
    | 'debuff-applied'
    | 'debuff-resisted'
    | 'dot-applied'
    | 'control-applied'
    | 'cleanse-performed'
    | 'purge-performed'
    | 'ship-destroyed'
    | 'cheat-death-activated';

const REACTIVE_STAMPED_EVENT_TYPES: ReadonlySet<CombatEventType> = new Set<StampedEventType>([
    'ability-performed',
    'heal-performed',
    'shield-applied',
    'buff-applied',
    'buff-expired',
    'debuff-applied',
    'debuff-resisted',
    'dot-applied',
    'control-applied',
    'cleanse-performed',
    'purge-performed',
    'ship-destroyed',
    'cheat-death-activated',
    // Reactive charge changes (Liberator's on-enemy-death "all allies add charge",
    // Zosimos's on-repair removal, etc.) flow through grantAllyCharges/removeEnemyCharges/
    // removeChargesFrom when those delegates are called with `ctx.bus` (the stamping wrapper)
    // during a reactive intent. Branding the emission `reactive` keeps the log builder from
    // treating the charge-changed as a NON-reactive turn entry (a trigger candidate) and nests
    // it under the triggering turn instead. On-turn charge emissions use the captured outer bus
    // (unstamped) → unchanged.
    'charge-changed',
    // #2 log visibility: drain-time reactive damage/heal procs emit these LOG-ONLY events so the
    // combat log can surface them (they deliberately emit no ability-performed/heal-performed —
    // chain guard). Emitted through ctx.bus during a reactive intent → stamped duringTurnOf so
    // they nest under the triggering turn. `-damage`/`-cleanse` have no combat subscriber at all;
    // `-heal` has exactly one (on-enemy-repaired — a reactive repair is still an enemy repairing),
    // which cannot chain because no on-enemy-repaired rider heals. See the events.ts note before
    // adding another subscriber to any of the three.
    'reactive-damage-performed',
    'reactive-heal-performed',
    'reactive-cleanse-performed',
]);

/** Wrap a bus so every reactive-capable event emitted through it is branded with
 *  `reactive:true` + `duringTurnOf` + `triggerActorId`. Used ONLY for the lifetime of a single
 *  reactive-intent resolution (executeIntent builds a fresh wrapper per call from the underlying
 *  bus, so nothing needs clearing and re-entrant drains are independent). On-turn (cast-path)
 *  emissions never pass through this wrapper, so they stay unstamped. An already-stamped event
 *  (re-entrant reaction emitting through a second wrapper) keeps its original stamp — the inner
 *  wrapper does not overwrite an existing `reactive` flag. */
function makeReactiveStampingBus(bus: CombatEventBus, duringTurnOf?: string): CombatEventBus {
    // The union members that carry a ReactiveStamp — selected by their `type` tags (the
    // ReactiveStamp fields are all-optional, so Extract<…, ReactiveStamp> matches the whole
    // union; selecting by tag picks exactly the stamp-carrying variants).
    type StampedEvent = Extract<CombatEvent, { type: StampedEventType }>;
    return {
        on: bus.on.bind(bus),
        emit(event: CombatEvent) {
            if (!REACTIVE_STAMPED_EVENT_TYPES.has(event.type) || 'reactive' in event) {
                bus.emit(event);
                return;
            }
            // The Set membership above guarantees `event` is a stamp-carrying member; narrow to
            // it so the spread + stamp fields type-check (the broad union includes members that
            // forbid `reactive`).
            const stamped: StampedEvent = {
                ...(event as StampedEvent),
                reactive: true,
                duringTurnOf,
                triggerActorId: duringTurnOf,
            };
            bus.emit(stamped);
        },
    };
}

/** Emit the LOG-ONLY `reactive-damage-performed` event for a proc that actually dealt damage.
 *  `ctx.bus` is the reactive stamping wrapper (when present) → the event is branded `duringTurnOf`
 *  so the combat log nests it under the triggering turn. NO combat listener subscribes to this
 *  type, so it can never chain. Inert when the proc was guarded (void / dealt <= 0) or no bus is
 *  wired (unit fixtures). */
function emitReactiveDamageLog(
    ctx: IntentExecContext,
    ownerId: string,
    victimId: string,
    outcome: { dealt: number; didCrit: boolean } | void
): void {
    if (ctx.bus && outcome && outcome.dealt > 0) {
        ctx.bus.emit({
            type: 'reactive-damage-performed',
            sourceId: ownerId,
            targetId: victimId,
            round: ctx.round,
            amount: outcome.dealt,
            didCrit: outcome.didCrit,
        });
    }
    // The attack row now exists (or the proc was guarded and buffered nothing) — release any
    // consequence twins the application above raised, so they nest UNDER this attack rather than
    // printing before it. Unconditional: a guarded proc has an empty buffer, making this a no-op.
    ctx.flushConsequenceLogs?.();
}

/** Task 5: reactive triggers that fan a single ATTACK into multiple `attacked` events — one per
 *  hit and per AoE victim. A SELF-scoped fixed-state rider (buff/charge) on one of these must
 *  apply only ONCE for the whole attack; per-victim ally / enemy routing legitimately fires per
 *  event, and reactive HEALS/SHIELDS scale per hit (see the heal branch's scope note) so they are
 *  excluded too.
 *
 *  `on-ally-crit` USED to be listed here and no longer is (multi-hit full-walk epic, PR2). Two
 *  independent facts make the guard both unnecessary and actively wrong for it:
 *   1. UNNECESSARY. Its listener was rewritten to enqueue AT MOST ONCE per `ability-performed`
 *      (the `critHits`-driven fan-out is gone), so the per-hit / per-AoE-victim over-fire this
 *      guard existed to stop — the user-reported "Everliving Regeneration III ×2-4 for one
 *      attack" — is already impossible. An AoE footprint is ONE attack, one event, one grant.
 *   2. WRONG. The guard is cleared per actor TURN, but a `hits: N` skill is N consecutive
 *      full-walk attacks emitting N events. Keeping it collapsed a 3-sub-attack ally crit into a
 *      single Hermes charge instead of three. Approved behaviour change: once per critting
 *      SUB-ATTACK. Dropping the trigger achieves exactly that — one fire per event — without
 *      threading a sub-attack index onto the guard key, which would have been strictly worse
 *      (two DIFFERENT allies critting in one turn both carry index 0 and would collapse).
 *  Both halves are locked by `hermesOncePerAttack.integration.test.ts`.
 *
 *  The two remaining triggers genuinely fan one attack into many events and keep the guard. */
const PER_HIT_REACTIVE_TRIGGERS: ReadonlySet<AbilityTrigger> = new Set<AbilityTrigger>([
    'on-attacked',
    'on-ally-attacked',
]);

/** Returns the once-per-attack guard key `ownerId:abilityId` when this intent is a SELF-target
 *  rider on a per-hit reactive trigger (an on-attacked / on-ally-attacked buff or charge), else
 *  undefined — meaning "not guarded". Only `target: 'self'` qualifies: ally-routed grants
 *  (damagedAllyId — Cultivator/Graphite/Howler/Sentinel repair) and enemy-routed damage (Sentinel)
 *  must stay per-victim, so they never key here. Cross-referenced by the charge and buff branches
 *  only. `on-ally-crit` is deliberately NOT in the set — see {@link PER_HIT_REACTIVE_TRIGGERS}.
 *
 *  PR4: the key carries the ATTACKER's sub-attack index. One attack fans into one `attacked` per
 *  hit per victim and the rider must collapse across those — but a `hits: N` attack is N
 *  consecutive attacks (R1) and must NOT collapse across those; `reactionFiredThisAttack` is
 *  cleared only at actor turn-start, so before PR4 all N collapsed into one grant.
 *
 *  Safe here in a way it was not for `on-ally-crit` (where two DIFFERENT critting allies both
 *  carrying index 0 ruled it out): adding a component to a key can only SPLIT keys, never merge
 *  them, so this can never collapse something the pre-PR4 guard kept separate. In practice the
 *  `?? 'x'` fallback below is dead for any real `attacked` event: `emitAttacked` always stamps a
 *  defined index (the caller's own sub-attack index, or — when the caller omits it — the per-hit
 *  loop index as a fallback), on every path, positional or not. It only matters for a hand-built
 *  fixture whose intent carries no `eventCtx` at all. */
function oncePerAttackGuardKey(intent: Intent): string | undefined {
    return intent.ability.target === 'self' && PER_HIT_REACTIVE_TRIGGERS.has(intent.ability.trigger)
        ? `${intent.ownerId}:${intent.ability.id}:${intent.eventCtx?.subAttackIndex ?? 'x'}`
        : undefined;
}

/** SP-M M1 Task 7: a per-VICTIM ConditionContext for an 'all-enemies' reactive damage proc. Clones
 *  the owner's drain-time context (so every non-per-victim field — self-buffs, enemy type, etc. —
 *  stays owner-scoped) and overrides ONLY the two per-victim reads the AoE conditions consult:
 *  `enemyHpPct` = the victim's own live HP% (Judge's "<50% HP"), and `enemyDebuffNames` = the
 *  victim's own synthesized debuff/DoT names (Incinerator's "with Inferno"). The name synthesis is
 *  the ENGINE's own `enemyDebuffNamesFor` (== buildTurnArgs's enemyDebuffNamesForTarget) so a
 *  per-victim name-gate reads exactly the names an on-cast gate would. */
function buildPerVictimConditionCtx(
    ctx: IntentExecContext,
    ownerId: string,
    victim: CombatActor
): ReturnType<typeof buildDrainContext> {
    const base = buildDrainContext(ctx, ownerId);
    // Per-victim HP% from the victim's own live currentHp/maxHp — but ONLY when the engine tracks
    // a real max HP for this victim (positional real enemies, registered in baseHpById). The DPS
    // dummy is NOT registered there (recipientMaxHp → 0); for it, `base.enemyHpPct` is already the
    // correct HP% (buildDrainContext derives it from ctx.cumulativeDamage/ctx.enemyHp), so fall
    // back to it rather than dividing by 0 (which would read a spurious 0% and always fire).
    const maxHp = ctx.recipientMaxHpFor?.(victim.id) ?? 0;
    const enemyHpPct =
        maxHp > 0 ? Math.max(0, Math.min(100, (100 * victim.currentHp) / maxHp)) : base.enemyHpPct;
    return {
        ...base,
        enemyHpPct,
        // Populate the OPT-IN name array so a `buffName`-carrying enemy-debuff condition matches by
        // name (see ConditionContext.enemyDebuffNames sentinel doc). Absent resolver → [] (a real
        // "no debuffs" signal — the name-gate correctly evaluates to 0).
        enemyDebuffNames: ctx.enemyDebuffNamesFor?.(victim.id) ?? [],
    };
}

/** SP-M M1 Task 7: the living opposing victims for an 'all-enemies' reactive DAMAGE proc, filtered
 *  by the ability's PER-VICTIM enemy conditions (Judge: hp-threshold <50%; Incinerator: enemy-debuff
 *  Inferno). Each surviving victim's own live HP% + synthesized debuff names are re-checked via
 *  conditionsMet against a per-victim ConditionContext. Falls back to [] (no-op) when the roster
 *  resolver is absent (unit-test ctx) — NEVER the vestigial dummy. */
function resolveAoEReactiveDamageVictims(intent: Intent, ctx: IntentExecContext): string[] {
    const roster = ctx.livingOpposingActorIds?.(intent.ownerId) ?? [];
    const perVictim = intent.ability.conditions.filter(
        (c) =>
            (c.subject === 'hp-threshold' && c.hpSubject !== 'self') || c.subject === 'enemy-debuff'
    );
    return roster.filter((victimId) => {
        if (perVictim.length === 0) return true;
        const victim = ctx.actorById?.(victimId);
        if (!victim) return false;
        return conditionsMet(perVictim, buildPerVictimConditionCtx(ctx, intent.ownerId, victim));
    });
}

export function executeIntent(intent: Intent, rawCtx: IntentExecContext): void {
    // Brand every reactive-capable event this resolution emits with duringTurnOf/triggerActorId
    // (combat-log attribution). The wrapped bus is local to THIS call — on-turn emissions never
    // route through it, so non-reactive events stay unstamped; nested/re-entrant drains each
    // build their own wrapper (no shared state to clear).
    // Some unit-test ctxs omit the bus entirely (they exercise non-emitting branches); only
    // wrap when a real bus is present so those calls keep working untouched.
    const ctx: IntentExecContext = rawCtx.bus
        ? { ...rawCtx, bus: makeReactiveStampingBus(rawCtx.bus, rawCtx.duringTurnOf) }
        : rawCtx;
    const cfg = intent.ability.config;

    // Resolve the firing owner's runtime (its charges, landing gates, sourceId, last-turn
    // ctx). A missing owner is impossible (the engine builds the map from the exact owner ids
    // it registered listeners for) — throw naming the bug rather than silently misrouting.
    const owner = ctx.runtimes.get(intent.ownerId);
    if (!owner) {
        throw new Error(
            `executeIntent: no runtime for intent ownerId '${intent.ownerId}' — the reactive ` +
                `listener registration and the runtimes map are out of sync`
        );
    }

    // Dead-owner gate (combat-sim finding #1): a DESTROYED owner's stale reactives are
    // suppressed — a listener that fired on a LATER event (e.g. a dead Curator reacting to an
    // enemy charge rounds after dying) must not resolve. `destroyedRound` is the canonical
    // aliveness signal (state.recordDestroyed). The owner's OWN death reaction is EXEMPT
    // (eventCtx.fromOwnDeath, stamped by the self-scoped on-destroyed listener) so Martyrdom's
    // killer-Disable and Salvation's self-destruct heal — born of the death itself — still fire.
    // Single, team-symmetric gate: the one drain feeds both sides, so this covers enemy-owner
    // reactives identically. Listeners only ENQUEUE (pure), so a skip leaves no partial state.
    if (owner.actor.destroyedRound !== undefined && !intent.eventCtx?.fromOwnDeath) return;

    // The self hp-threshold condition on an on-hp-threshold-crossed ability is TRIGGER
    // CONFIG (the listener read N from it), NOT a drain-time gate — scrub it before gating.
    // The crossing already proved the threshold; re-gating at drain time would WRONGLY BLOCK
    // the reaction when an earlier reactive heal in the intent queue lifted the owner back
    // above N before this intent drains. One filtered const feeds BOTH the gate AND the
    // status's conditions (the status-object exclusion is hygiene only — timed statuses never
    // re-evaluate conditions post-application).
    const scrubbedConditions =
        intent.ability.trigger === 'on-hp-threshold-crossed'
            ? intent.ability.conditions.filter(
                  (c) => !(c.subject === 'hp-threshold' && c.hpSubject === 'self')
              )
            : // SP-M M1 Task 7: an all-enemies reactive DAMAGE proc (Judge start-of-round
              // hp-threshold, Incinerator end-of-round enemy-debuff) re-evaluates its enemy
              // hp-threshold / enemy-effect conditions PER VICTIM in the damage branch below —
              // scrub them from the single global drain gate (which reads ONE
              // enemyHpPct/enemyDebuffNames, the vestigial dummy in positional mode) so it
              // neither blocks nor false-passes the whole AoE. Gated strictly on
              // type==='damage' && target==='all-enemies' so no other ability is touched.
              // Task 7b review: only an enemy/target-oriented hp-threshold is scrubbed here —
              // a hypothetical SELF hp-threshold co-located on an all-enemies damage ability
              // (buildShipAbilities.ts's re-target never attaches target:'all-enemies' for a
              // self-only hp-threshold — see that file's matching narrowing) must keep gating
              // normally at the global drain gate, not be scrubbed for a per-victim re-check
              // that triggers.ts's damage branch never performs for it.
              intent.ability.type === 'damage' && intent.ability.target === 'all-enemies'
              ? intent.ability.conditions.filter(
                    (c) =>
                        !(c.subject === 'hp-threshold' && c.hpSubject !== 'self') &&
                        c.subject !== 'enemy-debuff'
                )
              : // Ship-kit W8 Task 12 (Zeolite): an on-deal-damage purge's `enemy-type` gate
                // ("purges 1 buff … when dealing damage to a Defender") must check the ACTUAL
                // victim THIS event carries (eventCtx.victimId/counterTargetId), not the single
                // fight-wide `ctx.enemyType` the generic gate below reads — that field describes
                // only the DPS-mode dummy enemy's class and is hardcoded undefined for an
                // enemy-owned reaction (see engine.ts's seedPassiveTimedStatuses call site), so it
                // can never be team-symmetric. Scrubbed here, re-checked in the `purge` branch
                // below against `ctx.roleOf(targetId)` — `roleByActorId`/`roleOf` is side-agnostic
                // by key (Meatshield/Graphite precedent), so this works identically for a
                // player-owned or enemy-owned Zeolite. Gated strictly on
                // type==='purge' && trigger==='on-deal-damage' so no other purge is touched.
                intent.ability.type === 'purge' && intent.ability.trigger === 'on-deal-damage'
                ? intent.ability.conditions.filter((c) => c.subject !== 'enemy-type')
                : intent.ability.conditions;

    // Drain-time condition gate against CURRENT engine state — one gate for every branch,
    // built against the OWNER's snapshot (Task 6). liveGateConditions neutralizes
    // non-derivable-on-non-live subjects to 'always'; manual conditions keep literal gating
    // (manualCount). A failed gate is a silent skip (no resisted record).
    const gateConditions = liveGateConditions(scrubbedConditions);
    const baseDrainCtx = buildDrainContext(ctx, intent.ownerId);
    // Ship-kit W8 Task 13 (Meiying): the `killed-enemy-had-debuff` gate is keyed to the SPECIFIC
    // victim THIS on-enemy-destroyed intent carries (eventCtx.victimId, stamped by the listener
    // above), not the fight-wide owner-scoped context buildDrainContext returns — so it is folded
    // in here as a targeted override rather than threaded through buildDrainContext's owner-only
    // signature. Reads the slain actor's OWN per-target debuff store (ownerDebuffNamesFor is the
    // same reader `selfDebuffNames`/`buildActorConditionContext` already use for a target's
    // debuffs); no victimId (every other reactive trigger, or DPS mode) → false, byte-identical.
    // Ship-kit W8 (CodeRabbit round): explicitly gated on trigger==='on-enemy-destroyed' — other
    // triggers (on-deal-damage, on-bomb-detonated, on-ally-crit-dot, on-self-crit-dot,
    // on-enemy-dot-damage, on-ally-debuff-inflicted) also stamp eventCtx.victimId, but with
    // different semantics (the current cast's target, not a killed unit); without this guard
    // their victimId would be misread here as "the enemy this trigger just killed".
    const drainCtx =
        intent.ability.trigger === 'on-enemy-destroyed' && intent.eventCtx?.victimId !== undefined
            ? {
                  ...baseDrainCtx,
                  killedEnemyHadDebuff:
                      ownerDebuffNamesFor(ctx.statusEngine, intent.eventCtx.victimId).length > 0,
              }
            : baseDrainCtx;
    if (!conditionsMet(gateConditions, drainCtx)) return;

    if (cfg.type === 'charge') {
        if (!passesOncePerRoundGate(intent, ctx)) return;
        // Task 5: a SELF-target charge on a per-hit reactive trigger (on-attacked /
        // on-ally-attacked) collapses to +1 per attack. undefined key → not guarded (enemy/ally
        // charges, and every on-ally-crit rider — see PER_HIT_REACTIVE_TRIGGERS).
        const chargeGuardKey = oncePerAttackGuardKey(intent);
        if (chargeGuardKey && ctx.reactionFiredThisAttack?.has(chargeGuardKey)) return;
        if (intent.ability.target === 'enemy' || intent.ability.target === 'all-enemies') {
            // every-Nth-event gate (Zosimos "every second repair"): count per (owner, ability,
            // repairer); only act on the Nth event. Requires a repairer id and the counter map.
            if (intent.ability.everyNthEvent) {
                const repairerId = intent.eventCtx?.repairerId;
                if (!repairerId || !ctx.repairCountBySource) return;
                const key = `${intent.ownerId}:${intent.ability.id}:${repairerId}`;
                const n = (ctx.repairCountBySource.get(key) ?? 0) + 1;
                ctx.repairCountBySource.set(key, n);
                if (n % intent.ability.everyNthEvent !== 0) return; // not the Nth repair yet
                ctx.removeChargesFrom(repairerId, cfg.amount, owner.attackerAffinity, ctx.bus); // "that enemy" only
                return;
            }
            // On-cast / bomb removal: "the enemy" = bulk all-opposing (Phase 0 semantics).
            // Selector enemy-targets ('enemy-most-buffs'/'enemy-highest-attack') are NOT matched
            // here and fall through to the owner-only gain below. Unreachable for parsed charge
            // abilities today.
            ctx.removeEnemyCharges(cfg.amount, owner.attackerAffinity, ctx.bus);
            return;
        }
        // Charge follow-up routes by the ability's target (Task 6): ally/all-allies bumps
        // EVERY same-side actor (per-actor cap, skip chargeCount 0); self bumps the owner only.
        if (intent.ability.target === 'ally' || intent.ability.target === 'all-allies') {
            ctx.grantAllyCharges(cfg.amount, {
                recipientIds: footprintFilteredRecipients(intent, ctx, ctx.playerIds),
                emitBus: ctx.bus,
            });
            return;
        }
        // Owner-only charge gain, capped as on the cast path; no-op when chargeCount 0.
        if (owner.actor.chargeCount === 0) return;
        if (chargeGuardKey) ctx.reactionFiredThisAttack?.add(chargeGuardKey);
        const oldChargeManip = owner.actor.charges;
        owner.actor.charges = Math.min(owner.actor.charges + cfg.amount, owner.actor.chargeCount);
        if (owner.actor.charges !== oldChargeManip) {
            ctx.bus.emit({
                type: 'charge-changed',
                actorId: owner.actor.id,
                round: ctx.round,
                oldCharge: oldChargeManip,
                newCharge: owner.actor.charges,
                reason: 'manip',
            });
        }
        return;
    }

    if (cfg.type === 'buff') {
        // Task 5: a SELF-target reactive buff on a per-hit trigger (on-attacked /
        // on-ally-attacked) applies once per attack — one attack fans into one `attacked` per hit
        // per victim, but the self-buff must land only once. Checked FIRST (before the
        // once-per-combat/per-ally consumes below) so a collapsed duplicate burns no other cap;
        // the key is consumed only once the buff actually applies (after all gates). undefined key
        // → not guarded (ally/all-allies grants stay per-victim/per-hit, and on-ally-crit riders
        // are collapsed by their LISTENER instead — see PER_HIT_REACTIVE_TRIGGERS).
        const buffGuardKey = oncePerAttackGuardKey(intent);
        if (buffGuardKey && ctx.reactionFiredThisAttack?.has(buffGuardKey)) return;
        // "Once per battle" buff grant (Tycho/Shelter/Los Barrier): same combat-lifetime
        // Set as the heal executor's cap (heal branch below), keyed owner+ability. A key
        // present here means this owner+ability already granted this battle → silent skip.
        if (cfg.oncePerCombat) {
            const key = `${intent.ownerId}:${intent.ability.id}`;
            if (ctx.oncePerCombatFired?.has(key)) return;
            ctx.oncePerCombatFired?.add(key);
        }
        // Phase 3 PR-E: "once per ally per round" cap (Oleander's RoT-to-ally grant). A DEDICATED
        // flag — not the plain oncePerRound gate above, which has no gate in THIS branch today
        // (adding one there would newly cap every other reactive buff and drift goldens). Keyed
        // on (owner, ability, damagedAllyId) so a DIFFERENT ally still procs this round.
        // NOTE: consumes the cap BEFORE the procChance gate below. Inert today (Oleander's grant
        // has no procChance), but if a future oncePerRoundPerAlly ability ALSO carries a
        // procChance, move this below passesProcChanceGate so a failed proc does not burn the cap
        // (matching the plain oncePerRound "mark only on a successful proc" contract).
        if (intent.ability.oncePerRoundPerAlly) {
            const key = `${intent.ownerId}:${intent.ability.id}:${intent.eventCtx?.damagedAllyId ?? ''}`;
            if (ctx.oncePerRoundConsumed?.has(key)) return;
            ctx.oncePerRoundConsumed?.add(key);
        }
        // D-PR8: procChance gate for reactive buff grants (Ambush 5-16%, Alacrity 12-20%).
        // De-Morgan pass-through — true when procChance is undefined/≤0/≥1, so every existing
        // (procChance-less) buff grant stays byte-identical. Mirrors the heal/shield + damage
        // branches. Keys on `${ownerId}:${ability.id}` via ctx.procChanceGates.
        if (!passesProcChanceGate(intent, ctx)) return;
        // Task 5: consume the once-per-attack slot now that the self-buff WILL apply.
        if (buffGuardKey) ctx.reactionFiredThisAttack?.add(buffGuardKey);
        // Reactive buffs bypass the aura-by-passive-slot classification — their own
        // duration decides; a duration-less buff defaults to a 1-turn window. A HIT-COUNTED
        // duration-less buff instead takes Infinity: its hit count, not a turn window, is what
        // expires it (a 1-turn default would silently cap a multi-hit Barrier at one turn).
        const duration =
            typeof cfg.duration === 'number' ? cfg.duration : cfg.hits !== undefined ? Infinity : 1;
        // Recipients: an ally-damage reaction grant ('ally' target + eventCtx naming the
        // damaged ally — Graphite's "grants the ally Repair Over Time III") lands on EXACTLY
        // that ally; granting all playerIds would put the HoT on the whole team and inflate
        // healing numbers. Otherwise the Task-5 target rule holds: self → [ownerId];
        // ally/all-allies → every player id (the FIXED playerIds order). The status carries
        // casterId = ownerId so its gate evaluates against the caster's ctx even when it
        // lives on another recipient.
        const isAllyTarget =
            intent.ability.target === 'ally' || intent.ability.target === 'all-allies';
        const recipients = footprintFilteredRecipients(
            intent,
            ctx,
            intent.ability.target === 'adjacent-allies'
                ? (ctx.adjacentAllyIdsFor?.(intent.ownerId) ?? ctx.playerIds)
                : // H3.7: an on-shield-applied reaction (Resonating Fury) fans an ally/all-allies
                  // grant out to EXACTLY the recipients of the triggering shield cast — the same
                  // event-derived recipient routing as repairedAllyIds (Font of Power), keyed on
                  // eventCtx.shieldRecipientIds. The recipients are same-side by construction (a
                  // shield to oneself or an ally), so the granter itself appears here iff it
                  // self-shielded — no extra ally filtering needed.
                  isAllyTarget && intent.eventCtx?.shieldRecipientIds?.length
                  ? intent.eventCtx.shieldRecipientIds
                  : // NOTE: repairedAllyIds/damagedAllyId stay scoped to target === 'ally'
                    // (NOT isAllyTarget) on purpose — only shield routing accepts all-allies.
                    // Do not "harmonize" these to isAllyTarget; it would broaden Font of Power /
                    // on-ally-attacked recipients and drift goldens.
                    intent.ability.target === 'ally' && intent.eventCtx?.repairedAllyIds?.length
                    ? intent.eventCtx.repairedAllyIds
                    : intent.ability.target === 'ally' && intent.eventCtx?.damagedAllyId
                      ? [intent.eventCtx.damagedAllyId]
                      : isAllyTarget
                        ? ctx.playerIds
                        : [intent.ownerId]
        );
        // D-PR10: dynamic caster-attack snapshot. A buff carrying the `attackFlatPctOfCaster`
        // sentinel ("N% of the caster's attack") freezes a concrete `attackFlat` from the
        // CASTER's effective attack at grant time (the same last-turn ctx value that
        // bombs/reactive-damage snapshot). One value for all recipients → the shared hoisted
        // payload stays correct.
        const pinPct = cfg.parsedEffects.attackFlatPctOfCaster;
        let buffCfg = cfg;
        if (pinPct !== undefined) {
            const ownerCtx = ctx.lastTurnCtxByActor.get(intent.ownerId);
            const casterAttack = ownerCtx?.effectiveAttack ?? owner.attack;
            buffCfg = {
                ...cfg,
                parsedEffects: {
                    ...cfg.parsedEffects,
                    attackFlat: casterAttack * (pinPct / 100),
                },
            };
        }
        // The status object is identical for every recipient — hoist it above the loop.
        // Only the applyTimedAbilityStatus recipientId argument varies per iteration.
        const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
            payload: payloadFromConfig(buffCfg),
            side: 'self',
            sourceSlot: intent.sourceSlot,
            conditions: gateConditions,
            casterId: intent.ownerId,
            recipients,
            kind: 'timed',
            duration,
            ...(cfg.hits !== undefined ? { hits: cfg.hits } : {}),
        };
        for (const rid of recipients) {
            if (recipientCarriesBlockBuff(ctx.statusEngine, rid)) continue; // Block Buff: silent skip
            // Barrier Recharging gates TWO different grants for a recipient already under the
            // lockout, for two different reasons:
            //   - BARRIER_BUFFS arm: the status's own literal text, "Cannot be granted Barrier".
            //     Scoped to BARRIER_BUFFS names — it blocks Barrier specifically, not buffs in
            //     general (that is Block Buff's job, handled above).
            //   - BARRIER_RECHARGING arm: re-application of the lockout itself. This is NOT
            //     stated by the game text — "Cannot be reduced. Unremovable" says nothing about
            //     a fresh grant — but it is required to make the text's "Cannot be reduced" mean
            //     anything at all. Without this arm, Quixilver's every-turn re-fire would beat
            //     `familyApplicationWins` (a fresh duration of 3 always beats a decayed
            //     turnsRemaining of 1 or 2) and refresh the lockout back to 3 forever, so allies
            //     would receive exactly ONE Barrier for the whole shield-full streak instead of
            //     one every 3 turns. Owner-approved reading (2026-08-05): "cannot be reduced" ==
            //     "cannot be re-armed while still held" — a real 3-turn cooldown that decays to
            //     zero and then allows a fresh grant, not a permanent one-shot lock.
            // Either way the recipient is silently skipped — no status, no event, no log.
            if (
                (BARRIER_BUFFS.has(cfg.buffName) || cfg.buffName === BARRIER_RECHARGING) &&
                holdsBarrierRecharging(ctx.statusEngine, rid)
            ) {
                continue;
            }
            ctx.statusEngine.applyTimedAbilityStatus(ctx.round, status, rid);
            ctx.bus.emit({
                type: 'buff-applied',
                actorId: rid,
                granterId: intent.ownerId,
                round: ctx.round,
                buffName: cfg.buffName,
                duration,
            });
        }
        // D-PR16: co-granted buffs (Last Stand's Barrier + Block Debuff) — applied in the
        // SAME application as the primary (the single proc gate above already passed). Reuses
        // the SAME recipients/gate; each extra carries its own duration. Absent → no-op loop.
        // NOTE: extras use their raw parsedEffects and do NOT receive the `attackFlatPctOfCaster`
        // pin applied to the primary above — fine for the current attack-less control buffs
        // (Barrier/Block Debuff); a future attack-scaled co-buff would need pin handling here.
        //
        // INVARIANT — a co-granted buff CANNOT be hit-counted. The `additionalBuffs` element type
        // (types/abilities.ts) has no `hits` field, so there is nothing to thread and `extraStatus`
        // below is complete as written. If `hits` is ever added to that element type, it MUST be
        // threaded here in the same `...(x !== undefined ? { hits: x } : {})` shape the primary
        // status uses above — and `duration` must become Infinity when it is present, exactly as
        // the primary's does. Omitting either would put a one-shot into the timed store with no
        // charge (permanent, since a durationless co-grant defaults to a real turn window) or with
        // a charge the turn window silently outraces. Last Stand grants Barrier as its PRIMARY
        // (cfg.buffName, handled above) with Block Debuff as the co-grant
        // (alsoGrantBuffNames: ['Block Debuff']) — so today NO corpus co-grant is Barrier. This
        // invariant guards the day one is: Barrier is the one buff name a co-grant could plausibly
        // want hit-counted, so it is the first place a "for N hits" Barrier would try to land.
        for (const extra of cfg.additionalBuffs ?? []) {
            const extraStatus: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
                payload: payloadFromConfig({
                    buffName: extra.buffName,
                    stacks: extra.stacks,
                    parsedEffects: extra.parsedEffects,
                }),
                side: 'self',
                sourceSlot: intent.sourceSlot,
                conditions: gateConditions,
                casterId: intent.ownerId,
                recipients,
                kind: 'timed',
                duration: extra.duration,
            };
            for (const rid of recipients) {
                if (recipientCarriesBlockBuff(ctx.statusEngine, rid)) continue; // Block Buff: silent skip
                ctx.statusEngine.applyTimedAbilityStatus(ctx.round, extraStatus, rid);
                ctx.bus.emit({
                    type: 'buff-applied',
                    actorId: rid,
                    granterId: intent.ownerId,
                    round: ctx.round,
                    buffName: extra.buffName,
                    duration: extra.duration,
                });
            }
        }
        return;
    }

    if (cfg.type === 'debuff') {
        // D-PR14: once-per-round gate (Bulwark) — check consumed BEFORE drawing the proc gate,
        // so a failed roll never locks the round (mirrors D-PR3 incoming-block invariant).
        const onceKey = `${intent.ownerId}:${intent.ability.id}`;
        if (intent.ability.oncePerRound && ctx.oncePerRoundConsumed?.has(onceKey)) return;
        // D-PR14: proc-chance gate for reactive debuff appliers (Bulwark). Pass-through when
        // procChance is undefined → BYTE-IDENTICAL for every existing debuff applier (Martyrdom/Warden).
        if (!passesProcChanceGate(intent, ctx)) return;
        // Mark consumed ONLY after a successful proc (before the landing roll — "once per round"
        // is per attempt, matching the spec's read). NOTE: marked before the enemy-highest-attack
        // no-target no-op below; harmless today because no ability is both `oncePerRound` AND
        // `enemy-highest-attack` (Bulwark is oncePerRound+counterTarget; Doomsayer is neither). If
        // a future ability combines them, move this mark below the target-resolution guard so a
        // no-living-target round doesn't burn the charge.
        if (intent.ability.oncePerRound) ctx.oncePerRoundConsumed?.add(onceKey);
        // Phase 3 PR-F: "once per round per enemy" cap (Ruiner's Bomb-on-repair). A DEDICATED
        // flag — not the plain oncePerRound gate above, which caps once per round OVERALL — so a
        // DIFFERENT enemy repairing still procs even if one enemy already consumed the cap this
        // round. Keyed on (owner, ability, repairerId), mirroring the buff branch's
        // oncePerRoundPerAlly. Consumed BEFORE the procChance gate above already ran (Ruiner's
        // Bomb has no procChance today; see oncePerRoundPerAlly's NOTE for the ordering caveat).
        if (intent.ability.oncePerRoundPerEnemy) {
            const key = `${intent.ownerId}:${intent.ability.id}:${intent.eventCtx?.repairerId ?? ''}`;
            if (ctx.oncePerRoundConsumed?.has(key)) return;
            ctx.oncePerRoundConsumed?.add(key);
        }

        const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
            payload: payloadFromConfig(cfg),
            side: 'enemy',
            sourceSlot: intent.sourceSlot,
            conditions: gateConditions,
            casterId: intent.ownerId,
            kind: 'timed',
            duration: typeof cfg.duration === 'number' ? cfg.duration : 1,
            // #6b: an on-destroyed OWN-DEATH reaction (Martyrdom's killer-Disable) lands on the
            // killer DURING the killer's own turn, so the killer's same-turn Post-Turn would eat
            // the first tick (a legendary Disable(2) would block only one turn). Opt this debuff
            // into the enemy-side own-turn reprieve — decrementEnemy then skips the first tick when
            // the recipient is the current turn actor, so it runs its full window. Scoped to
            // own-death reactions (eventCtx.fromOwnDeath, stamped by the on-destroyed listener);
            // every other enemy debuff (on-attacked/Provoke, applied on the ATTACKER's turn) is
            // unaffected.
            reprieveOnRecipientTurn:
                intent.ability.trigger === 'on-destroyed' && intent.eventCtx?.fromOwnDeath === true,
        };
        // Counter-infliction routing (Phase 4c PR 1): an intent whose eventCtx names the
        // attacking enemy ("on that enemy" — Warden) lands on THAT enemy's per-target
        // store. Default (no eventCtx) → the singular default enemy store, byte-identical.
        // D-PR14: target resolution — enemy-highest-attack global selector (Doomsayer) else the
        // counter-infliction route (Bulwark/Warden). Existing appliers use counterTargetId → identical.
        //
        // `debuffVictimId` is the second half of that seam: `on-debuff-inflicted` stamps the enemy
        // the triggering infliction landed on under THAT field and never stamps counterTargetId, so
        // Warden's "when this Unit inflicts a Debuff, it inflicts Out. Damage Down II" used to fall
        // through to `ctx.enemy.id` — the vestigial DPS sink — and never reached the real enemy.
        // Same priority order the reactive `damage` branch already uses (counterTargetId first,
        // debuffVictimId second): every pre-existing applier stamps counterTargetId, so they are
        // byte-identical, and only an intent carrying debuffVictimId ALONE changes behaviour.
        const counterTargetId =
            intent.ability.target === 'enemy-highest-attack'
                ? ctx.enemyWithHighestAttack?.(intent.ownerId)
                : (intent.eventCtx?.counterTargetId ?? intent.eventCtx?.debuffVictimId);
        // No living highest-attack enemy → no-op (don't fall back to the default enemy).
        if (intent.ability.target === 'enemy-highest-attack' && counterTargetId === undefined)
            return;
        // Phase 3 PR-F: Amartya's recipient-targeted repair reaction fans the debuff out to
        // EVERY repaired enemy from the triggering heal-performed event ("that defender"
        // distributes across a multi-target heal) — mirrors the buff branch's repairedAllyIds
        // fan-out, but for enemy-side recipients. Distinct from Ruiner's REPAIRER-targeted Bomb
        // (same on-enemy-repaired trigger, same event), which stays on the singular
        // counterTargetId route below (an empty list falls back to it defensively).
        // Ship-kit W8 Task 13 (Meiying): `adjacent-enemies` fan-out for a REACTIVE debuff — no
        // prior reactive `debuff`-type ability used this target (Wave 5's adjacency work covered
        // the ON-CAST fan-out in playerTurn.ts and the reactive `damage` executor's bomb-splash
        // branch above; this is the first REACTIVE debuff consumer). Anchors on the SLAIN enemy
        // (eventCtx.victimId, stamped by the on-enemy-destroyed listener), mirrors the damage
        // branch's adjacent-enemies resolution exactly: `ctx.adjacentOpposingIdsFor` resolves the
        // anchor's own-side neighbours within the OPPOSING roster (team-symmetric), excluding the
        // anchor itself. No anchor → empty, never falls back to the default enemy.
        const applicationTargetIds: (string | undefined)[] =
            intent.ability.repairedRecipientTargeted && intent.eventCtx?.repairedEnemyIds?.length
                ? intent.eventCtx.repairedEnemyIds
                : intent.ability.target === 'adjacent-enemies'
                  ? intent.eventCtx?.victimId !== undefined
                      ? (ctx.adjacentOpposingIdsFor?.(intent.eventCtx.victimId) ?? [])
                      : []
                  : [counterTargetId];
        for (const applicationTargetId of applicationTargetIds) {
            // Block Debuff fold (D-PR15 Task 5): a target carrying Block Debuff auto-resists
            // every incoming timed debuff. Gate immunity into the landing condition so the
            // EXISTING resist `else` handles it (no duplicated resist code). `&&`
            // short-circuits when not immune → byte-identical to the original
            // `landsTimedEnemyApplication`-only condition.
            const debuffTargetId = applicationTargetId ?? ctx.enemy.id;
            const blockedByImmunity = targetCarriesBlockDebuff(ctx.statusEngine, debuffTargetId);
            // Draw the OWNER's landing gate (its hacking-vs-security / affinity disadvantage),
            // NOT a global one — a team ship's debuff lands at ITS landing chance. One draw PER
            // TARGET (per-victim landing, matching the established per-victim precedent) — for
            // every pre-existing single-target caller applicationTargetIds has exactly one
            // element, so this is still exactly one draw, byte-identical to before the loop.
            // Task A: re-resolve an 'apply' debuff's landing vs the ACTUAL target's affinity (not
            // the applier's precomputed-vs-representative static flag). affinityOf is absent in
            // unit-test ctxs → undefined target affinity → static fallback (byte-identical for
            // single-opponent).
            if (
                !blockedByImmunity &&
                owner.landsTimedEnemyApplication(cfg.application, ctx.affinityOf?.(debuffTargetId))
            ) {
                ctx.statusEngine.applyTimedAbilityStatus(
                    ctx.round,
                    status,
                    undefined,
                    applicationTargetId
                );
                // Discrete infliction event — sourceId = the owner so the application is chainable.
                // Ship-kit W7: brand the event when THIS reaction is itself an on-debuff-inflicted
                // follow-up (Warden's Out. Damage Down II), so the on-debuff-inflicted listener
                // skips it and the reaction cannot re-trigger itself (bounded, no generation-cap
                // throw). Other reactive debuffs (on-crit/on-attacked) stay unbranded → still chain.
                ctx.bus.emit({
                    type: 'debuff-applied',
                    sourceId: intent.ownerId,
                    targetId: debuffTargetId,
                    round: ctx.round,
                    buffName: cfg.buffName,
                    ...(intent.ability.trigger === 'on-debuff-inflicted'
                        ? { viaDebuffInflictedReaction: true as const }
                        : {}),
                });
            } else {
                // A persistent-stacking name (would have landed as a never-expiring stack)
                // surfaces its resisted display row as 'permanent', not its turn count.
                const turnsRemaining: ActiveBuff['turnsRemaining'] = PERSISTENT_STACKING_BUFFS.has(
                    cfg.buffName
                )
                    ? 'permanent'
                    : status.duration;
                ctx.recordResisted({ buffName: cfg.buffName, turnsRemaining });
                ctx.bus.emit({
                    type: 'debuff-resisted',
                    // sourceId = the inflictor (PR-J) so an on-debuff-resisted reaction (Vindicator)
                    // can route retaliation back at it.
                    sourceId: intent.ownerId,
                    // The RESOLVED target the debuff was aimed at (enemy-highest-attack /
                    // counter-infliction route), falling back to the default enemy only when no
                    // specific victim resolved — so the combat log names the ship that resisted
                    // ("src → <that ship>: X resisted") instead of the dummy sink id.
                    targetId: debuffTargetId,
                    round: ctx.round,
                    buffName: cfg.buffName,
                });
            }
        }
        return;
    }

    if (cfg.type === 'dot') {
        if (cfg.stacks <= 0 || cfg.tier <= 0) return;
        // "once per round per enemy" (Ruiner's Bomb-on-repair) — the same dedicated cap the
        // sibling `debuff` branch enforces, keyed identically on (owner, ability, repairerId) so
        // a DIFFERENT repairing enemy still procs. Needed here since 2026-07-31: Ruiner's Bomb
        // builds as a real dot now, and would otherwise re-plant on every repair the same enemy
        // performs in a round. No shipped reactive dot sets `oncePerRound`/`procChance`, so only
        // this flag is consulted (mirror the debuff branch's ordering if that changes).
        if (intent.ability.oncePerRoundPerEnemy) {
            const key = `${intent.ownerId}:${intent.ability.id}:${intent.eventCtx?.repairerId ?? ''}`;
            if (ctx.oncePerRoundConsumed?.has(key)) return;
            ctx.oncePerRoundConsumed?.add(key);
        }
        // Push the DoT stack onto ONE resolved victim's containers + emit the discrete
        // dot-applied. Owner-routed (Task 6): entries are stamped with the firing owner's id so
        // the per-entry tick attributes to (and scales with) the applier; bombs snapshot the
        // owner's last-turn effective attack + affinity. Shared by the single-victim path below
        // and the Pestilence multi-recipient fan-out above (identical per-victim landing).
        const landDotOn = (victim: CombatActor | undefined, victimId: string): void => {
            if (cfg.dotType === 'corrosion') {
                (victim?.corrosionEntries ?? ctx.corrosionEntries).push({
                    stacks: cfg.stacks,
                    tier: cfg.tier,
                    remainingRounds: cfg.duration,
                    sourceId: intent.ownerId,
                });
            } else if (cfg.dotType === 'inferno') {
                (victim?.infernoEntries ?? ctx.infernoEntries).push({
                    stacks: cfg.stacks,
                    tier: cfg.tier,
                    remainingRounds: cfg.duration,
                    sourceId: intent.ownerId,
                });
            } else if (cfg.dotType === 'bomb') {
                // A bomb SNAPSHOTS the owner's effective attack + affinity at application (unlike
                // corrosion/inferno, which resolve the applier's ctx at each tick), so it needs
                // both up front. The owner's last-turn ctx is the preferred source — it carries
                // the real per-cast affinity resolution, including forced-affinity overrides.
                //
                // Before the owner's FIRST turn of the run there is no such ctx (a faster enemy
                // healing in round 1 — the common case for enemy healers). This used to `return`,
                // dropping the bomb entirely: no entry, no dot-applied, no log line. Fall back to
                // the owner's LIVE effective attack plus the raw affinity matchup against this
                // victim. Documented approximation, same class as the `detonationDamageModifier`
                // note below: the matchup omits gear/buff affinity modifiers and any forced-
                // affinity override, both of which only a resolved cast can supply. A bomb at the
                // plain matchup beats no bomb at all.
                const ownerCtx = ctx.lastTurnCtxByActor.get(intent.ownerId);
                const effectiveAttack =
                    ownerCtx?.effectiveAttack ?? ctx.effectiveAttackFor?.(intent.ownerId);
                if (effectiveAttack === undefined) return;
                const affinityMult =
                    ownerCtx?.affinityMult ??
                    1 +
                        computeAffinityModifiers(
                            ctx.actorById?.(intent.ownerId)?.affinity,
                            victim?.affinity ?? ctx.affinityOf?.(victimId)
                        ).damageModifier /
                            100;
                (victim?.pendingBombs ?? ctx.pendingBombs).push({
                    countdown: Math.max(1, cfg.duration),
                    damagePerStack: effectiveAttack * (cfg.tier / 100),
                    stacks: cfg.stacks,
                    tier: cfg.tier,
                    sourceId: intent.ownerId,
                    affinityMult,
                    // Reactive-applied bombs default the detonation modifier to 0: the reactive ctx
                    // does not carry the owner's live detonation modifier; documented approximation —
                    // no shipped reactive bomb applier also wears Voidfire.
                    detonationDamageModifier: 0,
                    // Same approximation: reactive ctx does not carry the live splash modifier.
                    splashModifier: 0,
                });
            }
            // Discrete infliction event — sourceId = the owner so the application is chainable
            // and feeds OTHER owners' on-ally-debuff-inflicted dot-applied listeners (Task 6 seam).
            ctx.bus.emit({
                type: 'dot-applied',
                sourceId: intent.ownerId,
                targetId: victimId,
                round: ctx.round,
                dotType: cfg.dotType,
                stacks: cfg.stacks,
                tier: cfg.tier,
            });
        };

        // Ship-kit W3 (Pestilence): a reactive DoT whose ability targets 'all-enemies' and whose
        // triggering event stamped cleansedEnemyIds fans out over EVERY cleansed enemy ("inflicts
        // Corrosion II … on all cleansed enemies"), mirroring the all-enemies-over-aoeVictimIds
        // pattern but keyed off the reactive event's actual cleansed ids — NOT the single-victim /
        // dummy sink. ONE landing draw gates the whole fire (like the single-victim path below);
        // the per-victim Block-Debuff resist is checked inside the loop (no RNG → order-safe).
        const cleansedEnemyIds = intent.eventCtx?.cleansedEnemyIds;
        if (
            intent.ability.target === 'all-enemies' &&
            cleansedEnemyIds &&
            cleansedEnemyIds.length > 0
        ) {
            const liveLanding = owner.liveDebuffLandingChance ?? 1;
            if (!owner.debuffLandingGate(liveLanding)) return;
            for (const cid of cleansedEnemyIds) {
                const victim = ctx.actorById?.(cid);
                const victimId = victim?.id ?? cid;
                if (targetCarriesBlockDebuff(ctx.statusEngine, victimId)) {
                    emitBlockDebuffResist(
                        ctx.bus,
                        intent.ownerId,
                        victimId,
                        ctx.round,
                        dotResistLabel(cfg.dotType, cfg.tier)
                    );
                    continue;
                }
                landDotOn(victim, victimId);
            }
            return;
        }

        // Resolve the REAL victim (same seam the convert-dot branch uses): a reactive DoT must
        // land on the enemy the triggering event carries (e.g. on-ally-crit-dot → "on that
        // enemy", the ally's actual victim), NOT the fixed DPS dummy `enemy` sink. When no victim
        // is threaded — DPS mode (victimId resolves to the dummy anyway), an owner's own-target
        // reactive (Burner on-deal-damage: no victimId → the dummy IS the owner's target), or a
        // unit-test ctx without `actorById` — fall through to the ctx-level containers / ctx.enemy.id
        // exactly as before (byte-identical). Only a resolved victim swaps to its OWN containers.
        //
        // `counterTargetId` is the second half of that seam: the COUNTER-INFLICTION route ("on
        // that enemy" / "on its attacker" / "on any enemy performing a repair") that on-attacked
        // and on-enemy-repaired stamp instead of victimId — the same field the sibling `debuff`
        // branch already falls back to. Without it Warden/Shepherd's Corrosion and Ruiner's Bomb
        // land in the vestigial dummy's containers and never tick or burst on the real enemy.
        const routedVictimId = intent.eventCtx?.victimId ?? intent.eventCtx?.counterTargetId;
        const victim = routedVictimId ? ctx.actorById?.(routedVictimId) : undefined;
        const victimId = victim?.id ?? ctx.enemy.id;
        // Block Debuff (D-PR15 Task 7): an immune target auto-resists this reactive DoT — block
        // it AND emit a resist event (block path ONLY; a normal landing failure below stays
        // silent → byte-identical when not immune). Placed AFTER the inert-DoT guard above so a
        // zero-stack/tier DoT doesn't surface a spurious resist.
        if (targetCarriesBlockDebuff(ctx.statusEngine, victimId)) {
            emitBlockDebuffResist(
                ctx.bus,
                intent.ownerId,
                victimId,
                ctx.round,
                dotResistLabel(cfg.dotType, cfg.tier)
            );
            return;
        }
        // One landing draw at execution (deterministic queue order) — the OWNER's DoT landing
        // gate + chance (a team ship's DoT lands at ITS hacking-vs-security rate). Reads the
        // LIVE per-target chance (A2 Task 4, set each turn by runPlayerTurn); `?? 1` is a neutral
        // guard (the owner applied this DoT on its own turn → the field is set).
        const liveLanding = owner.liveDebuffLandingChance ?? 1;
        if (!owner.debuffLandingGate(liveLanding)) return;
        landDotOn(victim, victimId);
        return;
    }

    // SP-E, Task E4 (Belladonna): "When an ally inflicts Corrosion, chance (1%/10 Hacking) to
    // convert it into <buffName> of the same level; upon converting, extend the new entry N
    // turns at crit-power chance." Team-symmetric: `owner` is Belladonna (either side); the
    // victim is resolved via eventCtx.victimId (the ally's ACTUAL target), never the fixed
    // ctx.enemy — the same seam the `dot` branch above now uses so a reactive DoT lands on the
    // real positional victim (a Belladonna reacting on the OPPOSING side to her OWN ally's cast
    // must land on that ally's real victim, which can be a real player actor in the enemy-owner
    // case) — never the DPS/team `enemy` dummy.
    if (cfg.type === 'convert-dot') {
        // Gate 0: only the fromDotType this event carries (Corrosion) converts.
        if (intent.eventCtx?.dotType !== cfg.fromDotType) return;
        const allyId = intent.eventCtx?.damagedAllyId;
        const victim = intent.eventCtx?.victimId
            ? ctx.actorById?.(intent.eventCtx.victimId)
            : undefined;
        // No victim resolver / id (unit-test ctx without actorById, or a listener that somehow
        // fired without a captured victim) → not-simulated follow-up, byte-identical no-op.
        if (!allyId || !victim) return;
        // Gate 1: conversion chance — 1% per 10 Hacking (pctPerPoint 0.1) of the OWNER's
        // (Belladonna's) LIVE effective Hacking. Deterministic RateGate keyed by ability,
        // mirroring passesProcChanceGate's `${ownerId}:${abilityId}` convention (reused here
        // via ctx.procChanceGates so the accumulator persists combat-lifetime like every other
        // proc gate).
        const ownerStats = ctx.effectiveStatsFor?.(intent.ownerId);
        const hacking = ownerStats?.hacking ?? 0;
        const convertRate = Math.min(1, (cfg.chanceFromStat.pctPerPoint * hacking) / 100);
        const convertKey = `${intent.ownerId}:${intent.ability.id}`;
        let convertGate = ctx.procChanceGates?.get(convertKey);
        if (ctx.procChanceGates && !convertGate) {
            // Keyed by owner + purpose (SP-0 Task 3) — see passesProcChanceGate above.
            convertGate = makeRateGate(`${intent.ownerId}:convert`);
            ctx.procChanceGates.set(convertKey, convertGate);
        }
        const converts = convertGate ? convertGate(convertRate) : convertRate >= 1;
        if (!converts) return;
        // Retag the entries THIS ally just applied (not yet converted, same sourceId) — tier/
        // stacks/remainingRounds are left untouched ("of the same level"); only family +
        // unremovable change (E1/E2: family feeds enemyDotFamilyCounts/the SP-D charge gate,
        // unremovable survives Cheat-Death + DoT cleanse).
        const pool: ActiveDoTStack[] =
            cfg.fromDotType === 'corrosion'
                ? victim.corrosionEntries
                : cfg.fromDotType === 'inferno'
                  ? victim.infernoEntries
                  : victim.genericDoTEntries;
        const converted = pool.filter((e) => e.sourceId === allyId && e.family === undefined);
        if (!converted.length) return;
        for (const e of converted) {
            e.family = cfg.buffName;
            e.unremovable = true;
        }
        // Gate 2: the paired crit-power-chance duration extension (folded from
        // parseCritPowerExtend — the standalone extend-dot for this row is suppressed in
        // buildShipAbilities to avoid double-applying it). A SEPARATE keyed gate so its own
        // accumulator schedule doesn't share draws with the conversion gate above.
        if (cfg.extendTurns && cfg.extendChanceFromCritPower) {
            const critPowerFactor = Math.min(1, (ownerStats?.critDamage ?? 0) / 100);
            const extendKey = `${convertKey}:extend`;
            let extendGate = ctx.procChanceGates?.get(extendKey);
            if (ctx.procChanceGates && !extendGate) {
                // Keyed by owner + purpose (SP-0 Task 3) — see passesProcChanceGate above.
                extendGate = makeRateGate(`${intent.ownerId}:extend`);
                ctx.procChanceGates.set(extendKey, extendGate);
            }
            const extends_ = extendGate ? extendGate(critPowerFactor) : critPowerFactor >= 1;
            if (extends_) {
                for (const e of converted) e.remainingRounds += cfg.extendTurns;
            }
        }
        return;
    }

    if (cfg.type === 'heal' || cfg.type === 'shield') {
        if (!ctx.healing) return; // healing mode off → not-simulated follow-up
        const healing = ctx.healing; // local binding preserves narrowing inside the closure below
        // Task 5 SCOPE NOTE: reactive HEALS/SHIELDS are deliberately NOT collapsed to once per
        // attack. Unlike a fixed buff (Everliving Regeneration — discrete state), a reactive
        // repair/shield scales or crit-filters PER HIT (Isha's non-crit 3% / crit 6% on-attacked
        // heal; Adaptive Plating's shield off each hit's damage taken), so every hit legitimately
        // contributes its own share. Collapsing here would drop hits 2..N. The guard applies only
        // to the buff and charge branches.
        // Once-per-combat cap (Task 8): a flagged repair (Yazid's on-cheat-death-activated 60%
        // repair) fires AT MOST ONCE per combat. The Set is engine-owned (combat lifetime), so
        // a key present here means this owner+ability already fired this battle → silent skip.
        if (cfg.oncePerCombat) {
            const key = `${intent.ownerId}:${intent.ability.id}`;
            if (ctx.oncePerCombatFired?.has(key)) return;
            ctx.oncePerCombatFired?.add(key);
        }
        if (!passesProcChanceGate(intent, ctx)) return;
        if (!passesOncePerRoundGate(intent, ctx)) return;
        // ship-kit W3 (Sansi): numeric per-round cap ("limited to 3 times per Round"). Checked
        // AFTER the proc/once-per-round gates so a blocked fire never burns a charge; a
        // no-maxPerRound heal is byte-identical (pass-through).
        if (!passesMaxPerRoundGate(intent, ctx)) return;
        // ship-kit W3 (Sansi): reactive event-count scaling — "repairs 5% FOR EVERY enemy
        // repaired". The effective % is `scaling.perUnit × count`, where count is the number of
        // enemies repaired by the triggering heal-performed event (eventCtx.repairedEnemyIds —
        // stamped by the on-enemy-repaired listener from the REAL repaired-actor ids, so in a
        // positional team battle this counts the actual multi-enemy repair, not the DPS dummy).
        // Undefined countSource → 1× (byte-identical for every existing reactive heal/shield).
        // ship-kit W3 (Hemlock, Task 9): the sibling count-source — "repairs 5% PER enemy affected".
        // count = the number of adjacent allies the Corrosion spread landed Corrosion I on
        // (eventCtx.spreadAffectedIds, stamped by the on-corrosion-spread listener from the real
        // affected-actor ids), so a positional multi-ally spread heals proportionally.
        const eventCountMultiplier =
            intent.ability.scaling?.countSource === 'repaired-enemy-count'
                ? (intent.eventCtx?.repairedEnemyIds?.length ?? 0)
                : intent.ability.scaling?.countSource === 'spread-affected-count'
                  ? (intent.eventCtx?.spreadAffectedIds?.length ?? 0)
                  : undefined;
        // The per-unit rate for a count-scaled heal is scaling.perUnit (== the parsed base pct);
        // for a plain heal it is cfg.pct. A zero count (defensive — the trigger only fires on a
        // repair event, so count >= 1 in practice) grants nothing.
        const effectivePct =
            eventCountMultiplier !== undefined
                ? intent.ability.scaling!.perUnit * eventCountMultiplier
                : cfg.pct;
        // Reactive heals NEVER crit (no draw at drain time — deterministic, documented
        // approximation) and use the OWNER's last-turn ctx stats; before the owner's first
        // turn, fall back to runtime base stats. The heal fold otherwise MIRRORS the cast
        // path: owner healModifier × owner outgoingHeal × recipient incomingHeal — so a
        // reactive repair (e.g. Yazid's Cheat-Death 60%) scales with the recipient's Incoming
        // Repair (Everliving Regeneration) just like a cast repair. The ONLY deliberate
        // simplification vs the cast path is the no-crit approximation above. Shield stays
        // basis×pct (shields aren't repairs — no heal-modifier channels). The owner's standing
        // heal buffs are not re-derived at drain time (the last-turn ctx values are used).
        // If the cast-path fold in playerTurn.ts (heal block) changes, revisit this mirror.
        const ownerCtx = ctx.lastTurnCtxByActor.get(intent.ownerId);
        // Owner outgoing-repair %; and recipient incoming-repair % (self → owner's own ctx,
        // any other recipient → its last-turn ctx via the runtime accessor). Mirrors the cast
        // path's incomingPctFor (playerTurn.ts). F3: pre-first-turn (no ctx yet), fall back
        // to the owner's pre-fight heal baseline — FALLBACK ONLY, never added to a ctx value
        // (the ctx already folds preFight via playerTurn's scheduledTotals fold), so no
        // double-count. The non-self recipient path inherits the same fallback from the
        // engine's recipientIncomingHealPct.
        const ownerOutgoing = ownerCtx?.outgoingHealPct ?? owner.actor.preFight?.outgoingHeal ?? 0;
        const incomingPctFor = (rid: string): number =>
            rid === intent.ownerId
                ? (ownerCtx?.incomingHealPct ?? owner.actor.preFight?.incomingHeal ?? 0)
                : healing.recipientIncomingHealPct(rid);
        // Non-target-hp bases are owner-scoped → resolve ONCE. For 'target-hp' the basis is the
        // RECIPIENT's max HP, which differs per recipient for all-allies/self reactive heals, so
        // it must be resolved per recipient inside the loop (below). nonTargetHpBasis is unused
        // for the target-hp case.
        const nonTargetHpBasis =
            cfg.basis === 'attack'
                ? (ownerCtx?.effectiveAttack ?? owner.attack)
                : cfg.basis === 'defense'
                  ? (ownerCtx?.effectiveDefence ?? owner.defence)
                  : cfg.basis === 'damage-dealt' || cfg.basis === 'damage-taken'
                    ? // Reactive damage-dealt (e.g. Bloodthirst on-crit) / damage-taken (e.g.
                      // Adaptive Plating on-attacked): scale off the triggering hit's damage
                      // captured in eventCtx.triggerDamage — the damage DEALT for damage-dealt,
                      // the damage TAKEN (the on-attacked hit's e.damage) for damage-taken. Falls
                      // back to 0 when no triggering damage is present (non-crit path or missing
                      // context) — a damage-scaled reactive with no damage context grants nothing.
                      (intent.eventCtx?.triggerDamage ??
                      // SP-G G3: on-enemy-charged-cast doesn't stamp triggerDamage; a
                      // damage-dealt shield falls back to the sibling reactive-damage proc's
                      // actual dealt amount (stamped in applyReactiveDamage). damage-dealt
                      // ONLY — damage-taken has no sibling-proc dealt amount to fall back to.
                      (cfg.basis === 'damage-dealt'
                          ? ctx.reactiveDealtByOwner?.get(intent.ownerId)
                          : undefined) ??
                      0)
                    : cfg.basis === 'overheal'
                      ? // Reactive overheal (Abundant Renewal on-own-repair-to-ally): scale off the
                        // clipped over-repair captured in eventCtx.overhealAmount by the listener.
                        // Falls back to 0 when no overheal context is present — an overheal-scaled
                        // reactive with no over-repair grants nothing.
                        (intent.eventCtx?.overhealAmount ?? 0)
                      : (ownerCtx?.effectiveMaxHp ?? owner.hp);
        // Per-ally overheal routing (Abundant Renewal): when the triggering AoE repair supplied a
        // per-ally over-repair breakdown, an `overheal`-basis shield grants EACH over-repaired ally
        // a shield scaled off ITS OWN overheal and lands on that ally. Absent (legacy single-target
        // emit) → fall back to the aggregate overhealAmount routed to healing.targetId below.
        const overhealByAlly =
            cfg.basis === 'overheal' ? intent.eventCtx?.overhealByAlly : undefined;
        // Recipients: an 'ally'-target heal prefers eventCtx.damagedAllyId (an ally-damage
        // reaction repairs THAT ally) over the healing target. Identical today for single-target
        // healing-mode runs, but the per-ally overheal map (when present) supersedes it so an AoE
        // overheal shield fans out to every over-repaired ally.
        const recipients =
            overhealByAlly && Object.keys(overhealByAlly).length > 0
                ? Object.keys(overhealByAlly)
                : reactiveRecipients(intent, ctx, healing.targetId);
        // H3.6: collect the per-recipient REAL pool growth so we emit ONE shield-applied per
        // reactive shield (NOT per recipient) listing only recipients that actually gained pool.
        const shieldRecipientIds: string[] = [];
        let shieldGrantedSum = 0;
        const shieldPerTarget: { targetId: string; amount: number }[] = [];
        // #2 log visibility: accumulate the reactive HEAL's per-recipient raw repair so we can emit
        // ONE reactive-heal-performed after the loop (the executor emits no heal-performed).
        const healPerTarget: { targetId: string; amount: number }[] = [];
        let healSum = 0;
        for (const rid of recipients) {
            // Skip DEAD recipients from the gross credit (Phase 4b KNOWN LIMITATION 5):
            // an `all-allies` ON-DESTROYED heal (Salvation) fires when its OWN caster is
            // destroyed, but `recipients = ctx.playerIds` then still includes that dead
            // caster — inflating gross directHeal/shield by one phantom share. The live
            // heal target's effectiveHeal/overheal/shield are already isolated by the
            // `rid === ctx.healing.targetId` guard below and are unaffected.
            //
            // Determinism (byte-identical goldens): an `rid` may have NO runtime entry
            // (an unwalked legacy team actor). A MISSING runtime is treated as ALIVE —
            // credit it, preserving today's behavior. Only a runtime that EXISTS with
            // currentHp <= 0 is skipped. The live heal target is alive during a normal
            // heal, so no existing fixture's recipient is skipped.
            const recipientHp = ctx.runtimes.get(rid)?.actor.currentHp;
            if (recipientHp !== undefined && recipientHp <= 0) continue;
            const basisValue =
                cfg.basis === 'target-hp'
                    ? ctx.healing.recipientMaxHp(rid)
                    : overhealByAlly
                      ? // Per-ally over-repair (Abundant Renewal AoE routing): scale off THIS ally's
                        // own clipped excess, not the aggregate.
                        (overhealByAlly[rid] ?? 0)
                      : nonTargetHpBasis;
            let raw =
                cfg.type === 'heal'
                    ? basisValue *
                      (effectivePct / 100) *
                      (1 + owner.healModifier / 100) *
                      (1 + ownerOutgoing / 100) *
                      (1 + incomingPctFor(rid) / 100)
                    : basisValue * (effectivePct / 100);
            // D-PR6: recipient-side incoming-heal amplification (Exuberance) — HEAL case ONLY (NOT
            // shields). Rolls the recipient's combat-lifetime gate ONCE per applied repair (0 → byte-identical).
            if (cfg.type === 'heal')
                raw *= 1 + (healing.recipientIncomingHealAmpPct?.(rid) ?? 0) / 100;
            if (cfg.type === 'heal') {
                ctx.healing.credit(intent.ownerId, 'directHeal', raw);
                healPerTarget.push({ targetId: rid, amount: raw });
                healSum += raw;
                if (rid === ctx.healing.targetId) {
                    const { consumed, overheal } = ctx.healing.applyHealToTarget(raw);
                    ctx.healing.credit(intent.ownerId, 'effectiveHeal', consumed);
                    ctx.healing.credit(intent.ownerId, 'overheal', overheal);
                }
            } else {
                ctx.healing.credit(intent.ownerId, 'shield', raw);
                // H2/H3 foundation: route per-recipient (mirrors the cast path in
                // playerTurn.ts); an unresolvable recipient is credited but not pool-applied.
                const recipientActor = ctx.healing.recipientActor(rid);
                if (recipientActor) {
                    const granted = ctx.healing.grantShieldToTarget(raw, recipientActor);
                    if (granted > 0) {
                        shieldRecipientIds.push(rid);
                        shieldGrantedSum += granted;
                        shieldPerTarget.push({ targetId: rid, amount: granted });
                    }
                }
            }
        }
        // Deliberately NO heal-performed emission from the executor (a reactive heal must
        // not re-trigger heal listeners — chain guard; mirrors the drain-time no-crit-outcome
        // conventions). heal/shield therefore never chain.
        //
        // H3.6: shield IS the one exception — we DO emit shield-applied here (ONE per reactive
        // shield, keyed on the owner, listing only recipients whose pool grew). This is
        // intentional, NOT the deliberate no-heal-performed re-emit above: shield-applied drives
        // Resonating Fury, which grants a BUFF (not a shield), so it cannot chain back into
        // another shield-applied. No recipient gained pool → no event.
        if (cfg.type === 'shield' && shieldRecipientIds.length > 0) {
            ctx.bus.emit({
                type: 'shield-applied',
                granterId: intent.ownerId,
                recipientIds: shieldRecipientIds,
                round: ctx.round,
                amount: shieldGrantedSum,
                perTarget: shieldPerTarget,
            });
        }
        // #2 log visibility: a reactive HEAL emits reactive-heal-performed (NOT heal-performed —
        // that would re-trigger the REPAIRER'S OWN on-repair listeners and loop). Its only combat
        // subscriber is on-enemy-repaired, whose riders never heal → still no chain. Stamped
        // duringTurnOf via ctx.bus so it nests under the triggering turn.
        if (cfg.type === 'heal' && healPerTarget.length > 0 && ctx.bus) {
            ctx.bus.emit({
                type: 'reactive-heal-performed',
                casterId: intent.ownerId,
                round: ctx.round,
                amount: healSum,
                perTarget: healPerTarget,
            });
        }
        return;
    }

    if (cfg.type === 'cleanse') {
        const mode = cfg.mode ?? 'remove';
        if (mode === 'reduce-duration') {
            // No shipped duration-reduction ability sets procChance (deterministic), so the gate
            // is pass-through and never advances — safe to consult regardless of healing mode.
            if (!passesProcChanceGate(intent, ctx)) return;
            // Pure status mutation — does NOT require healing mode. self-target → [ownerId].
            // Falls back to ownerId when healing is absent (e.g. Warpstrike in non-healing sim).
            const fallback = ctx.healing?.targetId ?? intent.ownerId;
            const recipients = reactiveRecipients(intent, ctx, fallback);
            // PR11: count:'all' shrinks EVERY eligible debuff on each recipient (Heliodor/
            // Pestilence's "reduces the duration of all active Debuffs … by 1 turn"), instead of
            // Warpstrike's single newest-debuff shrink. Any other count value (today only the
            // implicit default) keeps the pre-PR11 newest-only behavior — byte-identical for
            // every existing reduce-duration ability.
            const reduceOne =
                cfg.count === 'all'
                    ? ctx.statusEngine.reduceAllDebuffsDuration
                    : ctx.statusEngine.reduceNewestDebuffDuration;
            let affected = 0;
            const reducePerTarget: { targetId: string; count: number }[] = [];
            const durationTurns = cfg.durationTurns ?? 1;
            for (const rid of recipients) {
                let n = reduceOne(rid, durationTurns);
                // A Bomb IS a Debuff, so a duration shrink reaches it too — and a bomb driven to
                // 0 turns EXPLODES (user-verified 2026-07-31: Heliodor's "-1 turn on all Debuffs"
                // detonating the Bomb II Ruiner planted on it). PendingBomb.countdown lives in its
                // own per-actor container, not the StatusEngine maps `reduceOne` walks, so it must
                // be shrunk separately — via the SAME reduce-and-detonate helper Lingshe's
                // bomb-countdown-reduce uses, so the burst credits the bomb's original applier and
                // routes through the per-victim damage sink. `count:'all'` only: a newest-debuff-
                // only shrink (Warpstrike) picks one status and must not also eat a bomb.
                const bombVictim = cfg.count === 'all' ? ctx.actorById?.(rid) : undefined;
                if (bombVictim) {
                    n += reduceBombsOnVictim(
                        bombVictim,
                        durationTurns,
                        ctx.round,
                        ctx.bus,
                        intent.ownerId,
                        ctx.forceDetonateBomb
                    );
                }
                if (n > 0) reducePerTarget.push({ targetId: rid, count: n });
                affected += n;
            }
            ctx.healing?.credit(intent.ownerId, 'cleanseCount', affected);
            // Log visibility: this branch previously emitted NOTHING, so Heliodor's "reduces the
            // duration of all active Debuffs … by 1 turn" was invisible in the combat log even
            // when it fired — indistinguishable from not being wired at all. Reuses the LOG-ONLY
            // reactive-cleanse-performed (no combat listener subscribes → cannot chain), flagged
            // `mode: 'reduce-duration'` so the renderer says "-N turn" rather than "cleansed N".
            // Silent when nothing was shrunk (no debuffs present), matching the remove twin.
            if (reducePerTarget.length > 0 && ctx.bus) {
                ctx.bus.emit({
                    type: 'reactive-cleanse-performed',
                    casterId: intent.ownerId,
                    round: ctx.round,
                    perTarget: reducePerTarget,
                    mode: 'reduce-duration',
                    durationTurns,
                });
            }
            return;
        }
        // remove mode — keep the !ctx.healing return BEFORE the proc gate (gate-desync rule;
        // see passesProcChanceGate doc). If reordered, a healing-mode-off pass would consume a
        // gate tick the healing-on pass does not, desynchronizing the proc stream across sims.
        if (!ctx.healing) return; // healing mode off → not-simulated follow-up
        if (!passesProcChanceGate(intent, ctx)) return;
        // Phase 3 PR-I: "(once per round)" cap (Nuqtu's self-cleanse). Mirrors the heal/shield
        // branch's ordering (procChance, THEN oncePerRound) — this branch previously had NO
        // oncePerRound consult at all (no shipped cleanse set the flag pre-PR-I), so this is
        // additive: every other cleanse ability leaves `oncePerRound` unset and passes through.
        if (!passesOncePerRoundGate(intent, ctx)) return;
        // ctx.playerIds is the SAME-SIDE ally id order (sideCtx.recipientIds) — side-correct for
        // both player and enemy reactive drains. ctx.statusEngine is the live store. Mirrors the
        // reactive heal branch's recipient resolution: an 'ally'-target cleanse prefers the
        // eventCtx.damagedAllyId (an ally-damage reaction cleanses THAT ally) over the heal target;
        // 'all-allies' fans out to every same-side id; self → the owner.
        const recipients = reactiveRecipients(intent, ctx, ctx.healing.targetId);
        const count = intent.eventCtx?.didCrit && cfg.critCount != null ? cfg.critCount : cfg.count;
        let removed = 0;
        const cleansePerTarget: { targetId: string; count: number }[] = [];
        for (const rid of recipients) {
            const n = ctx.statusEngine.cleanse(rid, count);
            if (n > 0) cleansePerTarget.push({ targetId: rid, count: n });
            removed += n;
        }
        // Credit the ACTUAL removed count (was the nominal cfg.count pre-T4).
        ctx.healing.credit(intent.ownerId, 'cleanseCount', removed);
        // #2 log visibility: surface the reaction via the LOG-ONLY reactive-cleanse-performed (NOT
        // cleanse-performed — that drives on-enemy-cleansed/on-own-cleanse listeners and would
        // chain). No combat listener subscribes to this type, so it can't chain; buildCombatLog
        // renders it, stamped duringTurnOf via ctx.bus so it nests under the triggering turn. Only
        // emitted when a debuff was actually removed (empty perTarget → silent, like the heal twin).
        if (cleansePerTarget.length > 0 && ctx.bus) {
            ctx.bus.emit({
                type: 'reactive-cleanse-performed',
                casterId: intent.ownerId,
                round: ctx.round,
                perTarget: cleansePerTarget,
            });
        }
        return;
    }

    if (cfg.type === 'remove-self-buff') {
        // NOTE: cfg.scope is presently descriptive metadata only — the engine always removes the
        // named family from ALL self stores via removeSelfBuffByName, so scope:'all' is the only
        // behavior today (a future editor must NOT assume narrower scopes are wired here).
        ctx.statusEngine.removeSelfBuffByName(intent.ownerId, cfg.buffName);
        return;
    }

    if (cfg.type === 'counter') {
        // G PR1: a live counter-attack — the owner hits its attacker back via the engine's full
        // mitigated/crit walk (applyCounterAttack), which emits NO `attacked` event → no re-counter.
        //
        // GATE ORDERING (intentional DEVIATION from the `damage` branch's proc→once-per-round
        // first): the CHEAP, NON-CONSUMING boolean gates run FIRST (primary-target, shield-hit,
        // attacker presence, once-per-attack), and the CONSUMING gates (proc-chance, once-per-round)
        // run LAST. `passesOncePerRoundGate` CONSUMES its slot only when it returns true; running it
        // before the cheap gates would let a counter that is then suppressed (wrong-target hit /
        // already-fired-this-attack) burn a once-per-round slot it never used. Putting it last means
        // it is only ever consulted for a counter that WILL fire on this event.
        if (cfg.requirePrimaryTarget && intent.eventCtx?.isPrimaryTarget !== true) return;
        if (cfg.requireShieldHit && intent.eventCtx?.shieldWasHit !== true) return; // PR2 plumbs shieldWasHit
        const attackerId = intent.eventCtx?.counterTargetId;
        if (!attackerId) return;
        // Once-per-ATTACK: all per-hit `attacked` events of ONE attack collapse to a single counter.
        // The guard set is cleared at every actor turn-start (engine), so a separate later attack
        // counters again. Absent (unit ctxs without the engine) → no guard.
        // SCOPE NOTE: today this turn-granularity IS per-attack — the `attacked` event is emitted
        // once per turn for the focus victim only (events.ts), and extra actions re-enter the turn
        // loop (re-clearing the guard), so one actor can't land two DISTINCT attacks on the same
        // victim inside one guard window. When positional per-victim emission or multi-attack-per-turn
        // lands (the same future work that makes isPrimaryTarget meaningful), this key must gain an
        // attack-instance token from the triggering `attacked` event to stay once-per-attack.
        const key = `${intent.ownerId}:${intent.ability.id}`;
        if (ctx.counterFiredThisTurn?.has(key)) return;
        // Consuming gates LAST (see ordering note above).
        if (!passesProcChanceGate(intent, ctx)) return;
        if (!passesOncePerRoundGate(intent, ctx)) return;
        ctx.counterFiredThisTurn?.add(key);
        const outcome = ctx.applyCounterAttack?.(
            intent.ownerId,
            attackerId,
            intent.ability.id,
            cfg.multiplier,
            cfg.hits ?? 1
        );
        emitReactiveDamageLog(ctx, intent.ownerId, attackerId, outcome);
        return;
    }

    if (cfg.type === 'damage') {
        if (!passesProcChanceGate(intent, ctx)) return;
        // HP/Shield-basis reactive (Vindicator on-resist HP / Xcellence on-resist Shield,
        // Ship-kit W8): REQUIRES a routed inflictor (counterTargetId) — no fallback to
        // ctx.enemy (you cannot retaliate against no-one). Frequency: one proc per
        // triggering enemy action, keyed (owner, ability, round, source) so multiple debuffs
        // resisted from ONE cast collapse to a single proc while two DIFFERENT enemies each proc.
        // (oncePerRoundConsumed is the per-round set; a 3-part key never collides with the 2-part
        // keys passesOncePerRoundGate uses.)
        if (cfg.hpBasisPct !== undefined || cfg.shieldBasisPct !== undefined) {
            const sourceId = intent.eventCtx?.counterTargetId;
            if (sourceId === undefined) return;
            const onceKey = `${intent.ownerId}:${intent.ability.id}:${sourceId}`;
            if (ctx.oncePerRoundConsumed?.has(onceKey)) return;
            ctx.oncePerRoundConsumed?.add(onceKey);
            const hpOutcome = ctx.applyReactiveDamage?.(
                intent.ownerId,
                sourceId,
                intent.ability.id,
                cfg.multiplier, // inert on this path — the engine reads hpBasisPct/shieldBasisPct, not multiplier, when set
                cfg.hits ?? 1,
                cfg.noCrit ?? false,
                cfg.hpBasisPct,
                // Ship-kit W8 (Xcellence): shieldBasisPct sibling of hpBasisPct — mutually
                // exclusive in the corpus (no row sets both).
                cfg.shieldBasisPct,
                // PR-B1 (Paracelsus): an on-destroyed retaliation's owner is already dead by the
                // time this drains — fromOwnDeath (stamped by the on-destroyed listener) lets the
                // executor's owner-alive gate stand aside for this one reaction, same exemption the
                // dead-owner drain gate above already grants.
                intent.eventCtx?.fromOwnDeath === true
            );
            emitReactiveDamageLog(ctx, intent.ownerId, sourceId, hpOutcome);
            return;
        }
        if (!passesOncePerRoundGate(intent, ctx)) return;
        // PR4b: reactive direct-damage proc (Grif's on-enemy-cleansed 75% no-crit, FrontLine's
        // on-enemy-charged-cast 80%, and epic PR4's re-tagged Judge/Chakara/Incinerator/Rhodium
        // start-of-round/end-of-round passives) now runs the SAME defense-mitigated,
        // crit-eligible pipeline as an on-cast hit (ctx.applyReactiveDamage, mirroring the
        // `counter` branch's applyCounterAttack) instead of a flat, unmitigated,
        // never-crits fold. `noCrit` (Grif/Rhodium "cannot critically hit") is honored BY THE
        // FLAG, not by executor limitation — a non-flagged ability (Judge/Chakara/Incinerator/
        // FrontLine) can now crit.
        //
        // SP-M M1 (Task 5): resolve the reactive damage victim SET. Single-selector targets
        // (enemy-most-buffs, Rhodium) resolve one living opposing actor via the ctx resolvers —
        // mirrors the debuff branch's enemy-highest-attack resolution (triggers.ts ~2207).
        // Everything else keeps the pre-existing eventCtx-routed counterparty (FrontLine's
        // charging enemy, Grif's cleansing enemy) else the ctx.enemy fallback (Judge/Chakara/
        // Incinerator's start-of-round/end-of-round triggers, which have no specific triggering
        // counterparty, and the DPS dummy). A selector that resolves nothing is a NO-OP — it
        // never falls back to the dummy. `multiplier` is a raw percentage like the cast path
        // (e.g. 75 for "75% damage"); `hits` folds into the mitigation call the same way
        // applyCounterAttack folds a counter's hit count. Emits NO event → no chain.
        const tgt = intent.ability.target;
        let victimIds: (string | undefined)[];
        if (tgt === 'enemy-most-buffs') {
            const id = ctx.enemyWithMostBuffs?.(intent.ownerId);
            if (id === undefined) return;
            victimIds = [id];
        } else if (tgt === 'enemy-highest-speed') {
            const id = ctx.enemyWithHighestSpeed?.(intent.ownerId);
            if (id === undefined) return;
            victimIds = [id];
        } else if (tgt === 'all-enemies') {
            // SP-M M1 Task 7 (Judge/Incinerator): a per-victim-CONDITIONAL AoE — enumerate the
            // living opposing roster and keep only the victims whose OWN live state satisfies the
            // ability's per-victim enemy conditions (hp-threshold <50% / enemy-debuff Inferno). The
            // once-per-round gate above already fired ONCE for the whole proc (all victims share it).
            victimIds = resolveAoEReactiveDamageVictims(intent, ctx);
        } else if (tgt === 'adjacent-enemies') {
            // Ship-kit W5 Task C3 (Demolisher bomb-splash): anchor on the BOMB VICTIM
            // (eventCtx.victimId, stamped by the on-bomb-detonated listener above) rather than
            // ctx.enemy/counterTargetId — the splash must land on the bombed enemy's own
            // adjacent enemies, not "an enemy of the owner". `ctx.adjacentOpposingIdsFor` (NOT
            // `adjacentAllyIdsFor`, which is bound to the OWNER's own drain side — wrong
            // direction here: the anchor is on the side OPPOSITE the owner) resolves the
            // anchor's OWN-side neighbours within the OPPOSING roster — team-symmetric (a player
            // owner reads the enemy roster and vice versa) and excludes the anchor itself. No
            // anchor (a damage-type ability reached via some OTHER trigger, or a fixture that
            // never stamped victimId) → empty, never falls back to the dummy sink.
            const anchorId = intent.eventCtx?.victimId;
            victimIds =
                anchorId !== undefined ? (ctx.adjacentOpposingIdsFor?.(anchorId) ?? []) : [];
        } else if (intent.eventCtx?.critVictimIds !== undefined) {
            // Sentinel's on-ally-crit "deals 60% damage to that enemy": "that enemy" is EVERY
            // enemy the ally critically hit, so fan out over the crit-victim set rather than
            // taking the single counterTargetId below (which is only the FIRST of them). Checked
            // before counterTargetId because the on-ally-crit listener stamps both — this clause
            // is the more specific of the two and only that listener ever sets it.
            victimIds = intent.eventCtx.critVictimIds;
        } else if (intent.eventCtx?.counterTargetId !== undefined) {
            // The trigger stamped the retaliation target (reflect/revenge, FrontLine's
            // on-enemy-charged-cast, …) — route there directly.
            victimIds = [intent.eventCtx.counterTargetId];
        } else if (intent.eventCtx?.debuffVictimId !== undefined) {
            // Insidiousness (on-debuff-inflicted): route to the enemy this infliction actually
            // landed on. Before this clause the trigger fell through to the fallback below and
            // always hit opposing[0], so an AoE debuffer dumped every proc onto enemy slot 1.
            victimIds = [intent.eventCtx.debuffVictimId];
        } else {
            // No specific triggering enemy (start/end-of-round, on-deal-damage). In a
            // POSITIONAL battle route to a real
            // living opposing actor — NEVER the vestigial DPS-dummy sink (ctx.enemy.id), which
            // stays alive whenever the team fields an ally-targeting ship (healer) and would
            // otherwise leak a phantom "→ enemy" line into the log (repeated once per fire).
            // `livingOpposingActorIds` is gated on hasPositionedEnemyRoster (returns [] in pure
            // DPS-calc mode), so DPS mode still falls back to the dummy sink — its intended role.
            const opposing = ctx.livingOpposingActorIds?.(intent.ownerId) ?? [];
            victimIds = [opposing.length > 0 ? opposing[0] : ctx.enemy.id];
        }
        // Wave 5 hardening: flatBasis (the flat bomb-damage basis) must apply ONLY to the
        // bomb-splash — gate it on the actual trigger, not merely on eventCtx.triggerDamage
        // being present. triggerDamage is also stamped by on-crit/on-attacked listeners for
        // OTHER mechanics (basis:'damage-dealt'/'damage-taken' reactive heals/shields), so an
        // adjacent-enemies damage ability reached via one of those triggers would otherwise
        // silently pick up a flat-copy basis it was never meant to have. Byte-identical today —
        // Demolisher's splash is the only adjacent-enemies damage ability and it fires from
        // on-bomb-detonated.
        const flatBasis =
            intent.ability.trigger === 'on-bomb-detonated'
                ? intent.eventCtx?.triggerDamage
                : undefined;
        for (const victimId of victimIds) {
            if (victimId === undefined) continue;
            // procScope:'per-attack' (Insidiousness): ONE hit per victim per attack. The trigger
            // fires once per debuff APPLICATION, so a cast inflicting two debuffs on the same
            // enemy (Curator's Attack Down III + Crit Power Down III) would otherwise hit that
            // enemy twice under the single shared verdict — 200% damage for a 100% implant.
            // Keyed with the victim so a DIFFERENT debuffed enemy still takes its own hit; rides
            // `reactionFiredThisAttack`, which the engine clears at each actor turn-start beside
            // the proc verdict cache. Absent set (unit ctxs) → no dedupe, byte-identical.
            if (intent.ability.procScope === 'per-attack') {
                // PR4: the key carries the SUB-ATTACK too. `reactionFiredThisAttack` is cleared
                // only at actor turn-start, so without the index this suppressed a victim for
                // sub-attacks #2..#N of a multi-hit cast — collapsing three attacks into one hit
                // even after the verdict memo above was re-keyed. Missing index → 'x', i.e. exactly
                // today's per-turn behaviour for every single-attack path.
                const firedKey = `${intent.ownerId}:${intent.ability.id}:${victimId}:${intent.eventCtx?.subAttackIndex ?? 'x'}`;
                if (ctx.reactionFiredThisAttack?.has(firedKey)) continue;
                ctx.reactionFiredThisAttack?.add(firedKey);
            }
            const outcome = ctx.applyReactiveDamage?.(
                intent.ownerId,
                victimId,
                intent.ability.id,
                cfg.multiplier,
                cfg.hits ?? 1,
                cfg.noCrit ?? false,
                undefined, // hpBasisPct — inert on this path (the hpBasisPct/shieldBasisPct branch above returns early)
                undefined, // shieldBasisPct — inert on this path, same reason
                false, // allowDeadOwner
                // Ship-kit W5 Task C3: flatBasis/ignoresDefense are ONLY ever non-inert for
                // Demolisher's splash (the sole ability carrying cfg.ignoresDefense===true AND
                // reachable via a trigger — on-bomb-detonated — that stamps eventCtx.triggerDamage;
                // every other reactive `damage` ability either has cfg.ignoresDefense undefined
                // OR fires from a trigger that never stamps triggerDamage, so this object is a
                // no-op passenger for them — byte-identical to the pre-C3 call with no 9th arg).
                {
                    ignoresDefense: cfg.ignoresDefense === true,
                    flatBasis,
                }
            );
            emitReactiveDamageLog(ctx, intent.ownerId, victimId, outcome);
        }
        return;
    }

    if (cfg.type === 'extra-action') {
        // Reactive extra-action bridge (Task 10): hand the grant to the engine, which decides
        // Path A (splice into the live round queue — during-turn deaths) vs Path B (buffer for
        // the next round — post-round enemy death, no live queue). The owner is the GRANTER (the
        // ship whose death-triggered passive fired): Sokol/Liberator gain the extra turn, not the
        // dead enemy. The engine's processExtraActionGrants enforces oncePerRound + the backstop.
        ctx.grantExtraAction(
            intent.ownerId,
            intent.ability.id,
            cfg.oncePerRound,
            cfg.endOfRound ?? false
        );
        return;
    }

    if (cfg.type === 'purge') {
        // Single-target BY DESIGN (counter-attacker / killer / most-buffs routing) — out of E3's
        // AoE scope: no 'all-enemies' reactive purge exists in the corpus and the firing skill's
        // footprint (pattern + opposing roster) is not reachable at drain time.
        // Reactive purge (C2b): remove buffs from the victim. Target = the routed
        // attacker/killer (counterTargetId — set by on-attacked/on-destroyed in C2b-2,
        // and by on-enemy-purged for Sefuba's chain victim-routing) else the turn's
        // enemy. statusEngine is in ctx scope — call it directly (mirrors cleanse). Emit
        // purge-performed UNLESS this purge was itself triggered by a purge (depth-1 guard).
        // Target: enemy-most-buffs (Rhodium) → the opposing actor with the most buffs;
        // else the routed attacker/killer (counterTargetId — Iridium/Faust) else the REAL
        // victim this event carries (eventCtx.victimId — Task 12's on-deal-damage purge,
        // Zeolite: "purges 1 buff from the enemy when dealing damage to a Defender" — the
        // owner's own damage target, mirrors the `dot`/`convert-dot` branches' victimId seam)
        // else the turn's enemy.
        const targetId =
            intent.ability.target === 'enemy-most-buffs'
                ? (ctx.enemyWithMostBuffs?.(intent.ownerId) ?? ctx.enemyId)
                : (intent.eventCtx?.counterTargetId ?? intent.eventCtx?.victimId ?? ctx.enemyId);
        // Task 12 (Zeolite): the `enemy-type` gate was scrubbed from the generic drain-time
        // condition check above (it only sees the single fight-wide dummy class) — re-check it
        // HERE against the ACTUAL victim's role via `ctx.roleOf` (side-agnostic —
        // roleByActorId is populated from BOTH TeamActorInput.role and EnemyActorInput.role, the
        // same source Meatshield's defense-substitution and Graphite's roleFilter already use).
        // An unknown role (`roleOf` undefined / no ship picked) never matches — conservative,
        // mirrors matchesRoleCategory's contract elsewhere.
        // Ship-kit W8 (CodeRabbit round): scoped to trigger==='on-deal-damage', symmetric with the
        // scrub above — a hypothetical purge with a genuinely PvE-class `enemy-type` condition on
        // a DIFFERENT trigger was never scrubbed from gateConditions, so re-deriving+re-evaluating
        // it here via ctx.roleOf would double-gate/misread it against the wrong target.
        const enemyTypeCond =
            intent.ability.trigger === 'on-deal-damage'
                ? intent.ability.conditions.find((c) => c.subject === 'enemy-type')
                : undefined;
        if (enemyTypeCond?.requiredEnemyType) {
            const matchesRole = matchesRoleCategory(ctx.roleOf?.(targetId), [
                enemyTypeCond.requiredEnemyType.toUpperCase() as ShipRoleCategory,
            ]);
            const gateMet = enemyTypeCond.negate ? !matchesRole : matchesRole;
            if (!gateMet) return;
        }
        const removed = ctx.statusEngine.purge(targetId, cfg.count);
        if (removed > 0 && !intent.eventCtx?.fromPurgeEvent) {
            ctx.bus.emit({
                type: 'purge-performed',
                casterId: intent.ownerId,
                targetId,
                count: removed,
                round: ctx.round,
            });
        }
        return;
    }

    // Any other type (control/...) → not-simulated follow-up; skip.
}
