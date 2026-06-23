import { Ability, LIVE_TRIGGERS, ShipSkills, SkillSlot } from '../../types/abilities';
import { matchesRoleCategory } from '../../constants/shipTypes';
import type { ShipTypeName } from '../../constants/shipTypes';
import { EnemyBaseClass, ParsedBuffEffects, SelectedGameBuff } from '../../types/calculator';
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
import { liveGateConditions } from './abilityStatusGating';
import { CombatEventBus } from './events';
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
    | 'purge'; // C2b-1: purge can be reactive — Sefuba on-enemy-purged chain

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
    'purge', // C2b-1: purge can be reactive — Sefuba on-enemy-purged chain
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
        /** The damage dealt by the triggering event (ability-performed.damage), used by a
         *  reactive `basis:'damage-dealt'` heal/shield (e.g. Bloodthirst) to scale off the
         *  triggering hit's damage rather than the owner's max HP. */
        triggerDamage?: number;
        /** The triggering hit's crit outcome (on-attacked -> attacked.didCrit), read by the
         *  reactive cleanse executor to pick `critCount` over `count` (Reactive Ward). */
        didCrit?: boolean;
        /** The actor ids of the allies repaired by an on-own-repair-to-ally event
         *  (excludes the caster). The buff branch fans an 'ally'-target grant out to
         *  exactly these recipients (Font of Power -> repaired allies). */
        repairedAllyIds?: string[];
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
                        // turn (positional path emits none — engine.ts ~2887), so this is
                        // once-per-turn for single-hit, multi-hit, and AoE alike — no
                        // once-per-turn guard needed. The while-debuffed requirement is an
                        // ability condition (self-debuff), enforced at drain via gateConditions.
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
                            eventCtx: { ...intent.eventCtx, repairedAllyIds: repaired },
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
                            eventCtx: { counterTargetId: e.attackerId, didCrit: e.didCrit },
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
                        if (
                            ra.ability.config.type === 'purge' ||
                            ra.ability.config.type === 'debuff'
                        ) {
                            if (!e.byDirectDamage) return;
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, counterTargetId: e.killerId },
                            });
                        } else {
                            enqueue(intent);
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
                        // Opposing-scoped: any opposing-side actor's repair. For the player
                        // call: dummy wall + enemy attackers. For the enemy call: any player
                        // actor. One enqueue per qualifying cast — Zosimos banks a charge.
                        if (isOpposing(e.casterId)) enqueue(intent);
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
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    pendingBombs: PendingBomb[];
    /** Player actor runtimes keyed by owner id ('attacker' + every walked team id). The
     *  executor resolves the intent's owner from this map for per-owner landing gates,
     *  charge caps, etc. A missing owner is a bug (throws — see executeIntent). */
    runtimes: Map<string, PlayerActorRuntime>;
    /** Delegate for ally-charge grants — the engine's own `grantAllyCharges` closure, threaded
     *  here so the executor does not need to re-implement the per-actor cap loop. The closure
     *  already iterates `allPlayerActors` with the correct chargeCount guard. */
    grantAllyCharges: (amount: number) => void;
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
    /** Combat-lifetime per-ability proc-chance gates (e.g. Bloodthirst's 12% chance).
     *  Keyed `${ownerId}:${abilityId}`; the RateGate accumulates across all rounds and all
     *  reactive fires of the same ability so the proc lands at its true frequency. */
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
    /** Whether `ownerId` was hit by a direct attack this round, feeding the
     *  `not-hit-this-round` gate at drain time. Engine-populated from the combat-wide
     *  hitThisRound Set. Absent → buildDrainContext defaults the gate to false (DPS /
     *  not-yet-hit → "not hit" ⇒ met), keeping existing drain gating byte-identical. */
    wasHitThisRoundFor?: (ownerId: string) => boolean;
    /** Credit reactive direct damage to the owner's round damage map against the shared
     *  enemy pool (Phase 4c PR 4 — Grif's on-enemy-cleansed 75% damage proc). Wraps the
     *  engine's `creditDamage(ownerId, 'direct', amount)` so the standing-leech hook still
     *  sees it. Absent → the damage branch is inert (unit fixtures / DPS mode w/o delegate). */
    creditReactiveDamage?: (ownerId: string, amount: number) => void;
    /** Resolve the opposing actor carrying the most buffs (Rhodium's enemy-most-buffs purge).
     *  Per-side: a player owner scans the enemy roster, an enemy owner scans the player roster.
     *  Returns undefined when no opposing actor exists (DPS dummy) → executor falls back to
     *  ctx.enemyId. Optional — absent in unit-test ctxs that don't drive most-buffs purges. */
    enemyWithMostBuffs?: (ownerId: string) => string | undefined;
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
 * golden. Tracked as a backlog item in docs/skill-model-coverage.md §6.
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
    // satisfying the Ambush implant's Stealth gate). Verified golden-neutral: zero `.snap` drift
    // across the full suite, since no LIVE fixture pairs such a status with a drain-time self-buff
    // gate. (The enemy-debuff side stays snapshot-only — see buildActorConditionContext doc.)
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
        enemyBuffNames: selfBuffNamesForOwners(ctx.statusEngine, ctx.enemyAttackerIds ?? []),
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
    return intent.ability.target === 'ally'
        ? [intent.eventCtx?.damagedAllyId ?? fallbackTargetId]
        : intent.ability.target === 'all-allies'
          ? ctx.playerIds
          : [intent.ownerId];
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
export function executeIntent(intent: Intent, ctx: IntentExecContext): void {
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
        // Charge follow-up routes by the ability's target (Task 6): ally/all-allies bumps
        // EVERY same-side actor (per-actor cap, skip chargeCount 0); self bumps the owner only.
        if (intent.ability.target === 'ally' || intent.ability.target === 'all-allies') {
            ctx.grantAllyCharges(cfg.amount);
            return;
        }
        // Owner-only charge gain, capped as on the cast path; no-op when chargeCount 0.
        if (owner.actor.chargeCount === 0) return;
        owner.actor.charges = Math.min(owner.actor.charges + cfg.amount, owner.actor.chargeCount);
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
        const recipients: string[] =
            intent.ability.target === 'adjacent-allies'
                ? (ctx.adjacentAllyIdsFor?.(intent.ownerId) ?? ctx.playerIds)
                : intent.ability.target === 'ally' && intent.eventCtx?.repairedAllyIds?.length
                  ? intent.eventCtx.repairedAllyIds
                  : intent.ability.target === 'ally' && intent.eventCtx?.damagedAllyId
                    ? [intent.eventCtx.damagedAllyId]
                    : intent.ability.target === 'ally' || intent.ability.target === 'all-allies'
                      ? ctx.playerIds
                      : [intent.ownerId];
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
        if (!blockedByImmunity && owner.landsTimedEnemyApplication(cfg.application)) {
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
        // path's incomingPctFor (playerTurn.ts).
        const ownerOutgoing = ownerCtx?.outgoingHealPct ?? 0;
        const incomingPctFor = (rid: string): number =>
            rid === intent.ownerId
                ? (ownerCtx?.incomingHealPct ?? 0)
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
                  : cfg.basis === 'damage-dealt'
                    ? // Reactive damage-dealt (e.g. Bloodthirst on-crit): scale off the triggering
                      // hit's damage captured in eventCtx.triggerDamage. Falls back to 0 when no
                      // triggering damage is present (non-crit path or missing context) — a
                      // damage-dealt reactive heal with no damage context heals nothing.
                      (intent.eventCtx?.triggerDamage ?? 0)
                    : (ownerCtx?.effectiveMaxHp ?? owner.hp);
        // Recipients: an 'ally'-target heal prefers eventCtx.damagedAllyId (an ally-damage
        // reaction repairs THAT ally) over the healing target. Identical today — the engine
        // only ever attacks the heal target, so damagedAllyId === healing.targetId in every
        // healing-mode run — but the explicit routing locks the semantics for 4d multi-target.
        const recipients = reactiveRecipients(intent, ctx, healing.targetId);
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
                if (rid === ctx.healing.targetId) ctx.healing.grantShieldToTarget(raw);
            }
        }
        // Deliberately NO heal-performed emission from the executor (a reactive heal must
        // not re-trigger heal listeners — chain guard; mirrors the drain-time no-crit-outcome
        // conventions). heal/shield therefore never chain.
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

    if (cfg.type === 'damage') {
        if (!passesProcChanceGate(intent, ctx)) return;
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
