import { Ability, LIVE_TRIGGERS, ShipSkills, SkillSlot } from '../../types/abilities';
import { matchesRoleCategory } from '../../constants/shipTypes';
import type { ShipTypeName } from '../../constants/shipTypes';
import { EnemyBaseClass, ParsedBuffEffects, SelectedGameBuff } from '../../types/calculator';
import type { AffinityName } from '../../types/ship';
import { PERSISTENT_STACKING_BUFFS } from '../../constants/persistentStackingBuffs';
import { conditionsMet } from '../abilities/evaluateConditions';
import { buildRoundContext } from '../abilities/roundContext';
import { makeRateGate } from '../calculators/rateAccumulator';
import { expandEnemyDebuffs, payloadToSelectedBuff, expandBuffEntry } from './buffTotals';
// Call-time-safe cycle: debuffImmunity imports selfBuffNamesForOwners from this module and we
// import targetCarriesBlockDebuff back. Both are used only inside function bodies (never at
// top-level evaluation), so there is no initialization-order hazard.
// eslint-disable-next-line import/no-cycle
import { targetCarriesBlockDebuff, emitBlockDebuffResist, dotResistLabel } from './debuffImmunity';
// eslint-disable-next-line import/no-cycle
import { recipientCarriesBlockBuff } from './blockBuffBuffs';
import { resolveSupportRecipients } from './supportRecipients';
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
    | 'remove-self-buff'; // Overload lifecycle: reactive self-buff removal (on kill/repair/debuff)

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
     *  branch routes the application to THIS enemy's per-target store.
     *  `damagedAllyId`: the DAMAGED ally's actor id (on-ally-attacked) — the heal and
     *  buff branches route an 'ally'-target payload to exactly this recipient
     *  (Cultivator's repair, Refine/Graphite's grants) instead of the default.
     *  `fromPurgeEvent`: depth-1 purge chain guard — a purge triggered by a
     *  purge-performed event does not re-emit purge-performed, preventing infinite chains. */
    eventCtx?: {
        counterTargetId?: string;
        damagedAllyId?: string;
        fromPurgeEvent?: boolean;
        /** The damage of the triggering event, used by a reactive heal/shield to scale off
         *  that hit rather than the owner's max HP. Two consumers: `basis:'damage-dealt'`
         *  (ability-performed.damage — damage the owner DEALT, e.g. Bloodthirst) and
         *  `basis:'damage-taken'` (attacked.damage — damage the owner TOOK, e.g. Adaptive
         *  Plating). NOTE: attacked.damage is the per-attack aggregate and on-attacked fires
         *  once per hit, so a non-oncePerRound damage-taken reactive would grant N times for
         *  an N-hit attack; Adaptive Plating's oncePerRound gate caps it to one grant/round. */
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
         *  AND as the single-target for "decrease THAT enemy's charge" (Zosimos). */
        repairerId?: string;
        /** The clipped overheal (heal-performed.overheal) carried from an own-repair-to-ally
         *  event, read by an `overheal`-basis reactive shield to scale off the over-repaired
         *  amount rather than the owner's max HP (Abundant Renewal). */
        overhealAmount?: number;
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
 *  - on-crit → ability-performed where actorId === ownerId; enqueues once per CRITTING HIT (critHits field; falls back to the didCrit binary for events without it)
 *  - on-debuff-inflicted → debuff-applied | dot-applied with `sourceId === ownerId`
 *  - on-ally-debuff-inflicted → debuff-applied OR dot-applied where the source is a same-side
 *    ally (not opposing, not the owner itself). For the PLAYER registration this is any OTHER
 *    PLAYER's infliction; for the ENEMY registration this is any other enemy actor's infliction.
 *    The dot-applied subscription is now LIVE (the team dot-applied seam exists since Task 4).
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
 *    fires once PER CRITTING HIT; the owner's own casts and every opposing actor are excluded
 *    (a walked enemy attacker now emits ability-performed, but its crit is NOT an ally crit).
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
 *    (any opposing-side actor's repair cast). One enqueue per cast.
 *  - on-enemy-cleansed → cleanse-performed where isOpposing(casterId)
 *    (any opposing-side actor's cleanse cast). One enqueue per cast.
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
                        // Per-critting-hit (game-verified): 2 of 3 hits crit → the
                        // follow-up fires twice. Events without critHits fall back
                        // to the didCrit binary (one enqueue).
                        const n = e.critHits ?? (e.didCrit ? 1 : 0);
                        // Per-event copy: carry e.damage (total damage for this ability-performed
                        // event) into eventCtx.triggerDamage so that a reactive basis:'damage-dealt'
                        // heal (e.g. Bloodthirst) scales off the triggering hit's damage.
                        // KNOWN APPROXIMATION: for a multi-hit ability, each critting hit enqueues
                        // with the same event-total damage (not per-hit damage), so the heal is
                        // proportionally over-counted per fire when critHits > 1. Per-hit attribution
                        // is not supported in the event model today; document and accept.
                        for (let i = 0; i < n; i++) {
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, triggerDamage: e.damage },
                            });
                        }
                    });
                    break;
                case 'on-deal-damage':
                    bus.on('ability-performed', (e) => {
                        // Warpstrike duration-reduction: fires on the OWNER's own damage-dealing
                        // turn. runPlayerTurn emits exactly ONE aggregate ability-performed per
                        // turn (positional path defers its emit; the engine emits exactly one
                        // ability-performed post-apply), so this is once-per-turn for single-hit,
                        // multi-hit, and AoE alike — no once-per-turn guard needed. The
                        // while-debuffed requirement is an ability condition (self-debuff),
                        // enforced at drain via gateConditions.
                        if (e.actorId !== ownerId) return;
                        if ((e.damage ?? 0) <= 0) return;
                        enqueue(intent);
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
                        if (e.sourceId === ownerId) enqueue(intent);
                    });
                    bus.on('dot-applied', (e) => {
                        if (e.sourceId === ownerId) enqueue(intent);
                    });
                    break;
                case 'on-ally-debuff-inflicted':
                    bus.on('debuff-applied', (e) => {
                        // Ally = any OTHER same-side actor's infliction. Exclude this owner
                        // (own inflictions go to on-debuff-inflicted) AND every opposing actor
                        // (an opposing actor is never an ally).
                        if (isSameSideAlly(e.sourceId, ownerId)) enqueue(intent);
                    });
                    bus.on('dot-applied', (e) => {
                        // Team DoT applications now emit dot-applied with the team sourceId
                        // (Task 4 seam, live since Task 6) — an ally DoT infliction triggers
                        // this listener exactly as an ally debuff does.
                        if (isSameSideAlly(e.sourceId, ownerId)) enqueue(intent);
                    });
                    break;
                case 'on-ally-crit-dot':
                    bus.on('dot-applied', (e) => {
                        // Ally DoT infliction whose cast crit (viaCrit): any OTHER
                        // same-side actor's crit-cast DoT. Own casts and every opposing actor
                        // are excluded (mirrors on-ally-debuff-inflicted's ally scoping). One
                        // enqueue per qualifying infliction EVENT (per-infliction-event rule).
                        if (e.viaCrit && isSameSideAlly(e.sourceId, ownerId)) {
                            enqueue(intent);
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
                        enqueue({
                            ...intent,
                            eventCtx: {
                                ...intent.eventCtx,
                                repairedAllyIds: repaired,
                                overhealAmount: e.overheal ?? 0,
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
                        // An ALLY's critting hits (mirrors on-crit with ally scoping):
                        // fires once PER CRITTING HIT, own casts and every opposing actor
                        // excluded — an opposing crit is NOT an ally crit, even though a
                        // walked enemy now emits ability-performed.
                        if (!isSameSideAlly(e.actorId, ownerId)) return;
                        const n = e.critHits ?? (e.didCrit ? 1 : 0);
                        for (let i = 0; i < n; i++) enqueue(intent);
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
                    bus.on('bomb-detonated', () => enqueue(intent));
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
                case 'on-debuff-resisted':
                    bus.on('debuff-resisted', (e) => {
                        // Self-scoped on the RESISTER. `debuff-resisted` carries targetId = the
                        // unit that resisted (either side: cast-side, reactive-side, and the
                        // D-PR15 Block-Debuff auto-resist all emit it). all-allies recipient
                        // routing happens in the buff executor.
                        if (e.targetId === ownerId) enqueue(intent);
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
                            eventCtx: { counterTargetId: e.attackerId, damagedAllyId: e.targetId },
                        });
                    });
                    break;
                case 'on-destroyed':
                    bus.on('ship-destroyed', (e) => {
                        // Self-scoped: THIS owner was destroyed (mirrors on-crit's own-id scoping).
                        // Killer-targeted reactions (Faust's PURGE, Martyrdom's DEBUFF) fire only when
                        // killed by DIRECT damage and route to the killer (counterTargetId = e.killerId).
                        // Salvation's self-destruct HEAL (and any other on-destroyed reaction) fires on ANY
                        // death, unchanged.
                        if (e.actorId !== ownerId) return;
                        // fromOwnDeath: marks this as the owner's OWN death reaction so the
                        // dead-owner drain gate (executeIntent) lets it through even though the
                        // owner is now destroyed (Martyrdom's killer-Disable, Salvation's heal).
                        if (
                            ra.ability.config.type === 'purge' ||
                            ra.ability.config.type === 'debuff'
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
                        if (isOpposing(e.actorId)) enqueue(intent);
                    });
                    break;
                case 'on-enemy-repaired':
                    bus.on('heal-performed', (e) => {
                        // Opposing-scoped. Capture the repairer id so the charge branch can (a)
                        // count repairs per source for an everyNthEvent gate and (b) target THAT
                        // enemy. Harmless for Zosimos's self-gain intent (it ignores repairerId).
                        if (isOpposing(e.casterId))
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, repairerId: e.casterId },
                            });
                    });
                    break;
                case 'on-enemy-cleansed':
                    bus.on('cleanse-performed', (e) => {
                        // Opposing-scoped: any opposing-side actor's cleanse. For the player
                        // call: enemy side. For the enemy call: player side.
                        // One enqueue per cast.
                        if (isOpposing(e.casterId)) enqueue(intent);
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
    /** Per-actor last-turn ctx (effectiveAttack/affinityMult for bombs). Undefined for an
     *  owner that has not acted this run (faster enemy, round 1) → bomb follow-ups skip. */
    lastTurnCtxByActor: Map<string, PlayerRoundCtx>;
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
    /** Whether `ownerId` has the lowest Speed among the player team (ties → all qualify),
     *  feeding the `lowest-speed-ally` gate at drain time. Computed once by the engine (Speed
     *  is static turn-order in this sim). Absent → buildDrainContext defaults the gate to true
     *  (lone-actor DPS assumption). */
    isLowestSpeedAllyFor?: (ownerId: string) => boolean;
    /** Same-side ids adjacent to `ownerId` on the board (living, owner excluded), feeding the
     *  `adjacent-allies` buff target. Engine-populated per side. Absent / undefined → the
     *  recipient resolver falls back to ctx.playerIds (all same-side allies). */
    adjacentAllyIdsFor?: (ownerId: string) => string[];
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
    /** Credit reactive direct damage to the owner's round damage map against the shared
     *  enemy pool (Phase 4c PR 4 — Grif's on-enemy-cleansed 75% damage proc). Wraps the
     *  engine's `creditDamage(ownerId, 'direct', amount)` so the standing-leech hook still
     *  sees it. Absent → the damage branch is inert (unit fixtures / DPS mode w/o delegate). */
    creditReactiveDamage?: (ownerId: string, amount: number) => void;
    /** G PR1: apply a full mitigated/crit counter walk from `ownerId` to `attackerId`.
     *  `abilityId` keys the dedicated counter crit-gate. Reuses the engine's no-event
     *  apply path (no attacked event → no re-counter). */
    applyCounterAttack?: (
        ownerId: string,
        attackerId: string,
        abilityId: string,
        multiplier: number,
        hits: number
    ) => void;
    /** G PR1: per-actor-turn once-per-attack guard. Keyed `ownerId:abilityId`. Cleared at each
     *  actor turn-start (engine) so the per-hit `attacked` events of ONE attack collapse to a
     *  single counter; a later attack (different turn) counters again. Absent → no guard (the
     *  counter branch is inert without the engine ctx). */
    counterFiredThisTurn?: Set<string>;
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
    /** D-PR14: id of the round's first real (non-Stasis/Disable-skipped) activator. */
    firstActivatorId?: string;
    /** D-PR16: id of the sole living actor on the drain owner's side (recomputed each drain),
     *  or undefined when !=1 actor is alive. Drives the `last-standing` gate (Last Stand). */
    lastStandingId?: string;
    /** D-PR14 Doomsayer: living opposing actor with the greatest live effective attack. */
    enemyWithHighestAttack?: (ownerId: string) => string | undefined;
    /** D-PR14 Bulwark: per-(owner,ability) once-per-round consume set (reset each round in engine). */
    oncePerRoundConsumed?: Set<string>;
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
        effectiveCritRate: shared.effectiveCritRate ?? 0,
        enemyType: shared.enemyType,
        enemyHpPct: shared.enemyHpPct,
        selfHpPct: shared.selfHpPct,
        enemyBuffNames: shared.enemyBuffNames,
        selfDebuffNames: shared.selfDebuffNames,
        isLowestSpeedAlly: shared.isLowestSpeedAlly,
        wasHitThisRound: shared.wasHitThisRound,
        firstActivator: shared.firstActivator,
        lastStanding: shared.lastStanding,
        turnsTaken: shared.turnsTaken,
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
 * 'ally'-target: prefers eventCtx.damagedAllyId (the ally that was hit), falls
 * back to fallbackTargetId (the heal target). 'all-allies': fans out to every
 * same-side id (ctx.playerIds). Anything else (self, enemy, …): the owner only.
 */
export function reactiveRecipients(
    intent: Intent,
    ctx: IntentExecContext,
    fallbackTargetId: string
): string[] {
    const base =
        intent.ability.target === 'ally'
            ? [intent.eventCtx?.damagedAllyId ?? fallbackTargetId]
            : intent.ability.target === 'all-allies'
              ? ctx.playerIds
              : intent.ability.target === 'adjacent-allies'
                ? (ctx.adjacentAllyIdsFor?.(intent.ownerId) ?? ctx.playerIds)
                : [intent.ownerId];
    return footprintFilteredRecipients(intent, ctx, base);
}

/** Intersect reactive support recipients with the owner's active support footprint. */
export function footprintFilteredRecipients(
    intent: Intent,
    ctx: IntentExecContext,
    baseRecipients: string[]
): string[] {
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
    let gate = ctx.procChanceGates?.get(gateKey);
    if (ctx.procChanceGates && !gate) {
        gate = makeRateGate();
        ctx.procChanceGates.set(gateKey, gate);
    }
    return !gate || gate(pc);
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
            : intent.ability.conditions;

    // Drain-time condition gate against CURRENT engine state — one gate for every branch,
    // built against the OWNER's snapshot (Task 6). liveGateConditions neutralizes
    // non-derivable-on-non-live subjects to 'always'; manual conditions keep literal gating
    // (manualCount). A failed gate is a silent skip (no resisted record).
    const gateConditions = liveGateConditions(scrubbedConditions);
    if (!conditionsMet(gateConditions, buildDrainContext(ctx, intent.ownerId))) return;

    if (cfg.type === 'charge') {
        if (!passesOncePerRoundGate(intent, ctx)) return;
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
        // "Once per battle" buff grant (Tycho/Shelter/Los Barrier): same combat-lifetime
        // Set as the heal executor's cap (heal branch below), keyed owner+ability. A key
        // present here means this owner+ability already granted this battle → silent skip.
        if (cfg.oncePerCombat) {
            const key = `${intent.ownerId}:${intent.ability.id}`;
            if (ctx.oncePerCombatFired?.has(key)) return;
            ctx.oncePerCombatFired?.add(key);
        }
        // D-PR8: procChance gate for reactive buff grants (Ambush 5-16%, Alacrity 12-20%).
        // De-Morgan pass-through — true when procChance is undefined/≤0/≥1, so every existing
        // (procChance-less) buff grant stays byte-identical. Mirrors the heal/shield + damage
        // branches. Keys on `${ownerId}:${ability.id}` via ctx.procChanceGates.
        if (!passesProcChanceGate(intent, ctx)) return;
        // Reactive buffs bypass the aura-by-passive-slot classification — their own
        // duration decides; a duration-less buff defaults to a 1-turn window.
        const duration = typeof cfg.duration === 'number' ? cfg.duration : 1;
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
        };
        for (const rid of recipients) {
            if (recipientCarriesBlockBuff(ctx.statusEngine, rid)) continue; // Block Buff: silent skip
            ctx.statusEngine.applyTimedAbilityStatus(ctx.round, status, rid);
            ctx.bus.emit({
                type: 'buff-applied',
                actorId: rid,
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
        const counterTargetId =
            intent.ability.target === 'enemy-highest-attack'
                ? ctx.enemyWithHighestAttack?.(intent.ownerId)
                : intent.eventCtx?.counterTargetId;
        // No living highest-attack enemy → no-op (don't fall back to the default enemy).
        if (intent.ability.target === 'enemy-highest-attack' && counterTargetId === undefined)
            return;
        // Block Debuff fold (D-PR15 Task 5): a target carrying Block Debuff auto-resists every
        // incoming timed debuff. Gate immunity into the landing condition so the EXISTING resist
        // `else` handles it (no duplicated resist code). `&&` short-circuits when not immune →
        // byte-identical to the original `landsTimedEnemyApplication`-only condition.
        const debuffTargetId = counterTargetId ?? ctx.enemy.id;
        const blockedByImmunity = targetCarriesBlockDebuff(ctx.statusEngine, debuffTargetId);
        // Draw the OWNER's landing gate (its hacking-vs-security / affinity disadvantage),
        // NOT a global one — a team ship's debuff lands at ITS landing chance.
        // Task A: re-resolve an 'apply' debuff's landing vs the ACTUAL target's affinity (not the
        // applier's precomputed-vs-representative static flag). affinityOf is absent in unit-test
        // ctxs → undefined target affinity → static fallback (byte-identical for single-opponent).
        if (
            !blockedByImmunity &&
            owner.landsTimedEnemyApplication(cfg.application, ctx.affinityOf?.(debuffTargetId))
        ) {
            ctx.statusEngine.applyTimedAbilityStatus(ctx.round, status, undefined, counterTargetId);
            // Discrete infliction event — sourceId = the owner so the application is chainable.
            ctx.bus.emit({
                type: 'debuff-applied',
                sourceId: intent.ownerId,
                targetId: counterTargetId ?? ctx.enemy.id,
                round: ctx.round,
                buffName: cfg.buffName,
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
                // debuff-resisted feeds the round display only — no per-target counter routing needed.
                targetId: ctx.enemy.id,
                round: ctx.round,
                buffName: cfg.buffName,
            });
        }
        return;
    }

    if (cfg.type === 'dot') {
        if (cfg.stacks <= 0 || cfg.tier <= 0) return;
        // Block Debuff (D-PR15 Task 7): an immune target auto-resists this reactive DoT — block
        // it AND emit a resist event (block path ONLY; a normal landing failure below stays
        // silent → byte-identical when not immune). Placed AFTER the inert-DoT guard above so a
        // zero-stack/tier DoT doesn't surface a spurious resist.
        if (targetCarriesBlockDebuff(ctx.statusEngine, ctx.enemy.id)) {
            emitBlockDebuffResist(
                ctx.bus,
                ctx.enemy.id,
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
        // Owner-routed (Task 6): DoT entries are stamped with the firing owner's id so the
        // enemy's per-entry tick attributes to (and scales with) the applier; bombs snapshot
        // the owner's last-turn effective attack + affinity.
        if (cfg.dotType === 'corrosion') {
            ctx.corrosionEntries.push({
                stacks: cfg.stacks,
                tier: cfg.tier,
                remainingRounds: cfg.duration,
                sourceId: intent.ownerId,
            });
        } else if (cfg.dotType === 'inferno') {
            ctx.infernoEntries.push({
                stacks: cfg.stacks,
                tier: cfg.tier,
                remainingRounds: cfg.duration,
                sourceId: intent.ownerId,
            });
        } else if (cfg.dotType === 'bomb') {
            // Bomb damagePerStack needs the OWNER's effective attack. Before the owner's first
            // turn this run (faster enemy, round 1) there is no ctx — skip (same guard as today,
            // now per owner). Affinity comes from the owner's last-turn ctx too.
            const ownerCtx = ctx.lastTurnCtxByActor.get(intent.ownerId);
            if (ownerCtx === undefined) return;
            ctx.pendingBombs.push({
                countdown: Math.max(1, cfg.duration),
                damagePerStack: ownerCtx.effectiveAttack * (cfg.tier / 100),
                stacks: cfg.stacks,
                tier: cfg.tier,
                sourceId: intent.ownerId,
                affinityMult: ownerCtx.affinityMult,
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
            targetId: ctx.enemy.id,
            round: ctx.round,
            dotType: cfg.dotType,
            stacks: cfg.stacks,
        });
        return;
    }

    if (cfg.type === 'heal' || cfg.type === 'shield') {
        if (!ctx.healing) return; // healing mode off → not-simulated follow-up
        const healing = ctx.healing; // local binding preserves narrowing inside the closure below
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
                      (intent.eventCtx?.triggerDamage ?? 0)
                    : cfg.basis === 'overheal'
                      ? // Reactive overheal (Abundant Renewal on-own-repair-to-ally): scale off the
                        // clipped over-repair captured in eventCtx.overhealAmount by the listener.
                        // Falls back to 0 when no overheal context is present — an overheal-scaled
                        // reactive with no over-repair grants nothing.
                        (intent.eventCtx?.overhealAmount ?? 0)
                      : (ownerCtx?.effectiveMaxHp ?? owner.hp);
        // Recipients: an 'ally'-target heal prefers eventCtx.damagedAllyId (an ally-damage
        // reaction repairs THAT ally) over the healing target. Identical today — the engine
        // only ever attacks the heal target, so damagedAllyId === healing.targetId in every
        // healing-mode run — but the explicit routing locks the semantics for 4d multi-target.
        // NOTE (Abundant Renewal / overheal shields): this heal/shield path does NOT consult
        // eventCtx.repairedAllyIds — it resolves to healing.targetId, which IS the over-repaired
        // ally because the engine repairs exactly one target today. If 4d multi-target repair
        // lands, route overheal shields to the repaired ally explicitly here.
        const recipients = reactiveRecipients(intent, ctx, healing.targetId);
        // H3.6: collect the per-recipient REAL pool growth so we emit ONE shield-applied per
        // reactive shield (NOT per recipient) listing only recipients that actually gained pool.
        const shieldRecipientIds: string[] = [];
        let shieldGrantedSum = 0;
        const shieldPerTarget: { targetId: string; amount: number }[] = [];
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
                cfg.basis === 'target-hp' ? ctx.healing.recipientMaxHp(rid) : nonTargetHpBasis;
            let raw =
                cfg.type === 'heal'
                    ? basisValue *
                      (cfg.pct / 100) *
                      (1 + owner.healModifier / 100) *
                      (1 + ownerOutgoing / 100) *
                      (1 + incomingPctFor(rid) / 100)
                    : basisValue * (cfg.pct / 100);
            // D-PR6: recipient-side incoming-heal amplification (Exuberance) — HEAL case ONLY (NOT
            // shields). Rolls the recipient's combat-lifetime gate ONCE per applied repair (0 → byte-identical).
            if (cfg.type === 'heal')
                raw *= 1 + (healing.recipientIncomingHealAmpPct?.(rid) ?? 0) / 100;
            if (cfg.type === 'heal') {
                ctx.healing.credit(intent.ownerId, 'directHeal', raw);
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
            let affected = 0;
            for (const rid of recipients)
                affected += ctx.statusEngine.reduceNewestDebuffDuration(
                    rid,
                    cfg.durationTurns ?? 1
                );
            ctx.healing?.credit(intent.ownerId, 'cleanseCount', affected);
            return;
        }
        // remove mode — keep the !ctx.healing return BEFORE the proc gate (gate-desync rule;
        // see passesProcChanceGate doc). If reordered, a healing-mode-off pass would consume a
        // gate tick the healing-on pass does not, desynchronizing the proc stream across sims.
        if (!ctx.healing) return; // healing mode off → not-simulated follow-up
        if (!passesProcChanceGate(intent, ctx)) return;
        // ctx.playerIds is the SAME-SIDE ally id order (sideCtx.recipientIds) — side-correct for
        // both player and enemy reactive drains. ctx.statusEngine is the live store. Mirrors the
        // reactive heal branch's recipient resolution: an 'ally'-target cleanse prefers the
        // eventCtx.damagedAllyId (an ally-damage reaction cleanses THAT ally) over the heal target;
        // 'all-allies' fans out to every same-side id; self → the owner.
        const recipients = reactiveRecipients(intent, ctx, ctx.healing.targetId);
        const count = intent.eventCtx?.didCrit && cfg.critCount != null ? cfg.critCount : cfg.count;
        let removed = 0;
        for (const rid of recipients) removed += ctx.statusEngine.cleanse(rid, count);
        // Credit the ACTUAL removed count (was the nominal cfg.count pre-T4).
        ctx.healing.credit(intent.ownerId, 'cleanseCount', removed);
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
        ctx.applyCounterAttack?.(
            intent.ownerId,
            attackerId,
            intent.ability.id,
            cfg.multiplier,
            cfg.hits ?? 1
        );
        return;
    }

    if (cfg.type === 'damage') {
        if (!passesProcChanceGate(intent, ctx)) return;
        if (!passesOncePerRoundGate(intent, ctx)) return;
        // Reactive direct-damage proc (Grif's on-enemy-cleansed "75% Damage that cannot
        // critically hit"). Bomb-style fold from the owner's last-turn ctx: effectiveAttack
        // × (multiplier/100) × hits × affinityMult, NO enemy-defense mitigation (documented
        // approximation, mirrors the bomb path) and NO crit. `multiplier` is a raw percentage
        // like the cast path (e.g. 75 for "75% damage"), so divide by 100. Folds `hits` like
        // the cast path (single-hit for Grif today, but multi-hit-correct). Before the owner's
        // first turn (faster enemy, round 1) there is no ctx → falls back to base runtime stats
        // like the reactive heal path; affinity defaults to 1 without a turn snapshot (no matchup
        // known — a small documented approximation, same spirit as the heal path which ignores
        // affinity entirely). Emits NO event → no chain.
        const ownerCtx = ctx.lastTurnCtxByActor.get(intent.ownerId);
        const effectiveAttack = ownerCtx?.effectiveAttack ?? owner.attack;
        const affinityMult = ownerCtx?.affinityMult ?? 1;
        const amount = effectiveAttack * (cfg.multiplier / 100) * (cfg.hits ?? 1) * affinityMult;
        // Guard: swallows zero/negative procs (defensive — a 0-attack or 0-multiplier proc credits nothing).
        if (amount > 0) ctx.creditReactiveDamage?.(intent.ownerId, amount);
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
        // else the routed attacker/killer (counterTargetId — Iridium/Faust) else the turn's enemy.
        const targetId =
            intent.ability.target === 'enemy-most-buffs'
                ? (ctx.enemyWithMostBuffs?.(intent.ownerId) ?? ctx.enemyId)
                : (intent.eventCtx?.counterTargetId ?? ctx.enemyId);
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
