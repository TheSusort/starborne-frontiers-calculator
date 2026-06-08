import { Ability, LIVE_TRIGGERS, ShipSkills, SkillSlot } from '../../types/abilities';
import { EnemyBaseClass, ParsedBuffEffects } from '../../types/calculator';
import { PERSISTENT_STACKING_BUFFS } from '../../constants/persistentStackingBuffs';
import { conditionsMet } from '../abilities/evaluateConditions';
import { buildRoundContext } from '../abilities/roundContext';
import { liveGateConditions } from './abilityStatusGating';
import { CombatEventBus } from './events';
import { CombatActor, ActiveDoTStack, PendingBomb } from './state';
import {
    ActiveBuff,
    AbilityStatusPayload,
    RegisteredAbilityStatus,
    StatusEngine,
} from './statusEngine';
// Type-only import (erased at runtime) → no circular-import cycle even though playerTurn.ts
// imports buildActorConditionContext/ReactiveAbility from this module.
import type { PlayerActorRuntime, PlayerRoundCtx, HealingRuntimeCtx } from './playerTurn';

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
 *  in healing mode — in DPS mode the executor's healing-ctx-off guard makes them inert. */
export type ReactiveAbilityType =
    | 'buff'
    | 'debuff'
    | 'dot'
    | 'charge'
    | 'heal'
    | 'shield'
    | 'cleanse';

/** Runtime mirror of ReactiveAbilityType for the partition check. */
const REACTIVE_ABILITY_TYPES: readonly ReactiveAbilityType[] = [
    'buff',
    'debuff',
    'dot',
    'charge',
    'heal',
    'shield',
    'cleanse',
];

/** A reactive ability registered as a listener, paired with its source slot
 *  (for parity with the timed-status sourceSlot bookkeeping). */
export interface ReactiveAbility {
    ability: Ability;
    sourceSlot: SkillSlot;
}

/** A queued follow-up execution. Listeners push these; the engine drains them.
 *  `ownerId` (Task 6) is the player actor whose reactive ability fired — the executor
 *  routes charge/buff/debuff/dot follow-ups against THIS owner's runtime (its charges,
 *  its landing gates, its sourceId, its last-turn ctx for bombs). For an attacker-only
 *  run every Intent carries ownerId 'attacker' → identical routing to pre-Task-6. */
export interface Intent {
    ability: Ability;
    sourceSlot: SkillSlot;
    ownerId: string;
}

/** Whether an ability is reactive (routed through the trigger machinery): a
 *  buff/debuff/dot/charge/heal/shield/cleanse ability whose trigger is in the live
 *  set. Anything else stays on the on-cast path. */
function isReactiveAbility(ability: Ability): boolean {
    if (!LIVE_TRIGGERS.has(ability.trigger)) return false;
    return (REACTIVE_ABILITY_TYPES as readonly string[]).includes(ability.config.type);
}

/**
 * Partition the input ShipSkills ONCE at setup into:
 *  - `castSkills`: everything except live-trigger buff/debuff/dot/charge/heal/shield/cleanse abilities.
 *    Feeds every on-cast pipeline (status registration loop + runPlayerTurn).
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
 * Register each player owner's reactive abilities as bus listeners. Listener bodies are
 * PURE (Phase 1 contract): they only `enqueue` an intent — never mutate combat state. Match
 * guards are now per OWNER (Task 6) so a team ship's reactive ability keys on ITS OWN events:
 *  - on-crit → ability-performed where actorId === ownerId; enqueues once per CRITTING HIT (critHits field; falls back to the didCrit binary for events without it)
 *  - on-debuff-inflicted → debuff-applied | dot-applied with `sourceId === ownerId`
 *  - on-ally-debuff-inflicted → debuff-applied OR dot-applied with `sourceId !== ownerId &&
 *    sourceId !== enemyId` (any OTHER player's infliction is an ally-infliction from this
 *    owner's perspective — the attacker's inflictions trigger a team Oleander, and vice versa).
 *    The dot-applied subscription is now LIVE (the team dot-applied seam exists since Task 4).
 *  - on-ally-crit-dot → dot-applied with viaCrit from any OTHER player actor (ally crit-cast DoT)
 *  - on-ally-critically-repaired → the OWNER's OWN heal-performed (casterId === ownerId) with
 *    >= 1 critting draw AND at least one non-self recipient (Pallas: "when THIS UNIT critically
 *    repairs an ally"). One enqueue per qualifying cast.
 *  - on-ally-crit → an ALLY's ability-performed with critting hits (mirrors on-crit ally-scoped):
 *    fires once PER CRITTING HIT; the owner's own casts and the enemy are excluded.
 *  - start-of-round → round-started (global — every owner's start-of-round fires once per round)
 *  - on-bomb-detonated → bomb-detonated (global)
 *  - on-stasis-applied → control-applied where effect === 'stasis' && casterId === ownerId
 *    (Defiant: the OWNER's OWN Stasis application — own-cast scoped). One enqueue per application.
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
    enemyId: string;
}): void {
    const { bus, perOwner, enqueue, enemyId } = args;
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
                        for (let i = 0; i < n; i++) enqueue(intent);
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
                        // Ally = ANY OTHER player's infliction. Exclude this owner (own
                        // inflictions go to on-debuff-inflicted) AND the enemy.
                        if (e.sourceId !== ownerId && e.sourceId !== enemyId) enqueue(intent);
                    });
                    bus.on('dot-applied', (e) => {
                        // Team DoT applications now emit dot-applied with the team sourceId
                        // (Task 4 seam, live since Task 6) — an ally DoT infliction triggers
                        // this listener exactly as an ally debuff does.
                        if (e.sourceId !== ownerId && e.sourceId !== enemyId) enqueue(intent);
                    });
                    break;
                case 'on-ally-crit-dot':
                    bus.on('dot-applied', (e) => {
                        // Ally DoT infliction whose cast crit (viaCrit): any OTHER
                        // player's crit-cast DoT. Own casts and the enemy are excluded
                        // (mirrors on-ally-debuff-inflicted's ally scoping). One enqueue
                        // per qualifying infliction EVENT (per-infliction-event rule).
                        if (e.viaCrit && e.sourceId !== ownerId && e.sourceId !== enemyId) {
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
                case 'on-ally-crit':
                    bus.on('ability-performed', (e) => {
                        // An ALLY's critting hits (mirrors on-crit with ally scoping):
                        // fires once PER CRITTING HIT, own casts and the enemy excluded.
                        if (e.actorId === ownerId || e.actorId === enemyId) return;
                        const n = e.critHits ?? (e.didCrit ? 1 : 0);
                        for (let i = 0; i < n; i++) enqueue(intent);
                    });
                    break;
                case 'start-of-round':
                    bus.on('round-started', () => enqueue(intent));
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
    /** The FIXED player-id source order ([focusActorId, ...team ids in input order]) — the
     *  same order Task 5 uses for ally/all-allies buff recipients (deterministic application). */
    playerIds: string[];
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
}

/** Build the drain-time condition context from CURRENT engine state. This is a
 *  drain-time snapshot (documented): self-buff names from the status engine, the
 *  current landed-debuff count approximation, DoT container lengths, enemyType, and
 *  the enemyHpPct derived from cumulative damage. Drain has no per-hit crit outcome,
 *  so crit-gated conditions are evaluated with effectiveCritRate 0 (treated as
 *  not-crit at drain time). */
/**
 * Build a ConditionContext for ONE player actor (`ownerId`) from the status engine + the shared
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
 * self-granted gate buff) are visible to its own aura's gate. The drain path leaves it false
 * (the executor is attacker-only and the drain gate's snapshot-only behaviour is golden-locked).
 *
 * KNOWN UNDERCOUNT (golden-locked, do not "fix" casually): `landedEnemyDebuffCount` comes from
 * `snapshot().activeEnemyDebuffs`, which — symmetrically with the self-buff side above — EXCLUDES
 * payload-carrying ABILITY-sourced enemy debuffs. So an `enemy-debuff gte N` threshold gate
 * (Asphyxiator etc.) undercounts at drain time and for foreign-caster auras: ability-applied
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
    });
}

function buildDrainContext(ctx: IntentExecContext, ownerId: string) {
    const enemyHpPct =
        ctx.enemyHp > 0 ? Math.max(0, 100 * (1 - ctx.cumulativeDamage / ctx.enemyHp)) : 100;
    // Owner-aware drain gate (Task 6): self-buff names come from the OWNER's snapshot so each
    // owner's reactive follow-up is gated against ITS OWN active buffs + the shared enemy state.
    // `includeAbilitySelfNames` stays FALSE for ALL owners at drain time — the drain path is
    // snapshot-only (golden-locked behaviour for the attacker; the cast-path/drain-path
    // self-buff-visibility asymmetry now applies uniformly per owner, by design). For an
    // attacker-only run ownerId is 'attacker' → byte-identical to the pre-Task-6 drain gate.
    return buildActorConditionContext(ctx.statusEngine, ownerId, {
        corrosionEntryCount: ctx.corrosionEntries.length,
        infernoEntryCount: ctx.infernoEntries.length,
        bombCount: ctx.pendingBombs.length,
        enemyType: ctx.enemyType,
        enemyHpPct,
    });
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

    // Drain-time condition gate against CURRENT engine state — one gate for every branch,
    // built against the OWNER's snapshot (Task 6). liveGateConditions neutralizes
    // non-derivable-on-non-live subjects to 'always'; manual conditions keep literal gating
    // (manualCount). A failed gate is a silent skip (no resisted record).
    const gateConditions = liveGateConditions(intent.ability.conditions);
    if (!conditionsMet(gateConditions, buildDrainContext(ctx, intent.ownerId))) return;

    if (cfg.type === 'charge') {
        // Charge follow-up routes by the ability's target (Task 6): ally/all-allies bumps
        // EVERY player actor (per-actor cap, skip chargeCount 0); self bumps the owner only.
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
        // Reactive buffs bypass the aura-by-passive-slot classification — their own
        // duration decides; a duration-less buff defaults to a 1-turn window.
        const duration = typeof cfg.duration === 'number' ? cfg.duration : 1;
        // Recipients per the Task-5 target rule: self → [ownerId]; ally/all-allies → every
        // player id (the FIXED playerIds order). The status carries casterId = ownerId so its
        // gate evaluates against the caster's ctx even when it lives on another recipient.
        const recipients: string[] =
            intent.ability.target === 'ally' || intent.ability.target === 'all-allies'
                ? ctx.playerIds
                : [intent.ownerId];
        // The status object is identical for every recipient — hoist it above the loop.
        // Only the applyTimedAbilityStatus recipientId argument varies per iteration.
        const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
            payload: payloadFromConfig(cfg),
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
        return;
    }

    if (cfg.type === 'debuff') {
        const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
            payload: payloadFromConfig(cfg),
            side: 'enemy',
            sourceSlot: intent.sourceSlot,
            conditions: gateConditions,
            kind: 'timed',
            duration: typeof cfg.duration === 'number' ? cfg.duration : 1,
        };
        // Draw the OWNER's landing gate (its hacking-vs-security / affinity disadvantage),
        // NOT a global one — a team ship's debuff lands at ITS landing chance.
        if (owner.landsTimedEnemyApplication(cfg.application)) {
            ctx.statusEngine.applyTimedAbilityStatus(ctx.round, status);
            // Discrete infliction event — sourceId = the owner so the application is chainable.
            ctx.bus.emit({
                type: 'debuff-applied',
                sourceId: intent.ownerId,
                targetId: ctx.enemy.id,
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
                targetId: ctx.enemy.id,
                round: ctx.round,
                buffName: cfg.buffName,
            });
        }
        return;
    }

    if (cfg.type === 'dot') {
        if (cfg.stacks <= 0 || cfg.tier <= 0) return;
        // One landing draw at execution (deterministic queue order) — the OWNER's DoT landing
        // gate + chance (a team ship's DoT lands at ITS hacking-vs-security rate).
        if (!owner.debuffLandingGate(owner.debuffLandingChance)) return;
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
        // Reactive heals NEVER crit (no draw at drain time — deterministic, documented
        // approximation) and use the OWNER's last-turn ctx stats; before the owner's first
        // turn, fall back to runtime base stats. The fold is DELIBERATELY simplified vs the
        // cast path (which folds outgoingHeal + recipient incomingHeal): heal applies the
        // owner's healModifier only; shield is basis×pct (shields aren't repairs). The
        // owner's standing heal buffs are not re-derived at drain time.
        // If the cast-path fold in playerTurn.ts (heal block) changes, revisit this simplified mirror.
        const ownerCtx = ctx.lastTurnCtxByActor.get(intent.ownerId);
        // Non-target-hp bases are owner-scoped → resolve ONCE. For 'target-hp' the basis is the
        // RECIPIENT's max HP, which differs per recipient for all-allies/self reactive heals, so
        // it must be resolved per recipient inside the loop (below). nonTargetHpBasis is unused
        // for the target-hp case.
        const nonTargetHpBasis =
            cfg.basis === 'attack'
                ? (ownerCtx?.effectiveAttack ?? owner.attack)
                : cfg.basis === 'defense'
                  ? (ownerCtx?.effectiveDefence ?? owner.defence)
                  : (ownerCtx?.effectiveMaxHp ?? owner.hp);
        const recipients =
            intent.ability.target === 'ally'
                ? [ctx.healing.targetId]
                : intent.ability.target === 'all-allies'
                  ? ctx.playerIds
                  : [intent.ownerId];
        for (const rid of recipients) {
            const basisValue =
                cfg.basis === 'target-hp' ? ctx.healing.recipientMaxHp(rid) : nonTargetHpBasis;
            const raw =
                cfg.type === 'heal'
                    ? basisValue * (cfg.pct / 100) * (1 + owner.healModifier / 100)
                    : basisValue * (cfg.pct / 100);
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
        if (!ctx.healing) return; // healing mode off → not-simulated follow-up
        ctx.healing.credit(intent.ownerId, 'cleanseCount', cfg.count);
        return;
    }

    // Any other type (purge/control/...) → not-simulated follow-up; skip.
}
