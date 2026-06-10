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
    | 'cleanse'
    | 'extra-action';

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
    /** Event context captured by the listener at enqueue time (per-event intents).
     *  `counterTargetId`: the attacking enemy's actor id for "on that enemy"
     *  counter-inflictions (Warden, Guardian's ally-Provoke) — the executor's debuff
     *  branch routes the application to THIS enemy's per-target store.
     *  `damagedAllyId`: the DAMAGED ally's actor id (on-ally-attacked) — the heal and
     *  buff branches route an 'ally'-target payload to exactly this recipient
     *  (Cultivator's repair, Refine/Graphite's grants) instead of the default. */
    eventCtx?: { counterTargetId?: string; damagedAllyId?: string };
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
 *    !isEnemySide(sourceId)` (any OTHER PLAYER's infliction is an ally-infliction from this
 *    owner's perspective — the attacker's inflictions trigger a team Oleander, and vice versa).
 *    Every enemy-side actor (dummy wall + enemy attackers) is excluded — an enemy is never an
 *    ally. The dot-applied subscription is now LIVE (the team dot-applied seam exists since Task 4).
 *  - on-ally-crit-dot → dot-applied with viaCrit from any OTHER PLAYER actor (ally crit-cast DoT;
 *    enemy-side sources excluded)
 *  - on-ally-critically-repaired → the OWNER's OWN heal-performed (casterId === ownerId) with
 *    >= 1 critting draw AND at least one non-self recipient (Pallas: "when THIS UNIT critically
 *    repairs an ally"). One enqueue per qualifying cast.
 *  - on-ally-crit → an ALLY's ability-performed with critting hits (mirrors on-crit ally-scoped):
 *    fires once PER CRITTING HIT; the owner's own casts and every enemy-side actor are excluded
 *    (a walked enemy attacker now emits ability-performed, but its crit is NOT an ally crit).
 *  - start-of-round → round-started (global — every owner's start-of-round fires once per round)
 *  - on-bomb-detonated → bomb-detonated (global)
 *  - on-stasis-applied → control-applied where effect === 'stasis' && casterId === ownerId
 *    (Defiant: the OWNER's OWN Stasis application — own-cast scoped). One enqueue per application.
 *  - on-attacked → attacked where targetId === ownerId (target-scoped; fires when THIS OWNER is
 *    attacked). Per-HIT since Phase 4c PR 1 (the engine emits one event per hit). The ability's
 *    triggerCritFilter discriminates on the hit's own crit outcome: 'crit' → critting hits only,
 *    'non-crit' → non-critting only, absent → every hit. Each enqueued intent is per-event (not
 *    the shared const): eventCtx captures the attacker for "on that enemy" counter routing.
 *  - on-destroyed → ship-destroyed where actorId === ownerId (self-scoped; mirrors on-attacked's
 *    target-scoped guard). One enqueue per destruction event.
 *  - on-ally-destroyed → ship-destroyed where actorId !== ownerId && !isEnemySide(actorId)
 *    (any OTHER player actor's destruction; mirrors on-ally-crit's ally scoping).
 *  - on-enemy-destroyed → ship-destroyed where isEnemySide(actorId)
 *    (any enemy-side actor — dummy wall + walked enemy attackers).
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
    /** True for ANY enemy-side actor id: the singular dummy wall enemy AND every enemy
     *  ATTACKER (healing mode). Enemy attackers now walk runPlayerTurn (commit 6c456a14) and
     *  therefore emit the full reactive event suite (`ability-performed` with crits,
     *  `dot-applied`, `debuff-applied`, …) with `side === 'enemy'`. Ally-scoped player
     *  listeners treat "any OTHER player actor" as an ally, so they MUST exclude every
     *  enemy-side id — not just the dummy — or an enemy's crit/debuff wrongly fires a
     *  player's on-ally-* reaction. The engine passes a predicate closing over the dummy id
     *  + all enemy-attacker ids; for an attacker-only/DPS run only the dummy is enemy-side. */
    isEnemySide: (actorId: string) => boolean;
}): void {
    const { bus, perOwner, enqueue, isEnemySide } = args;
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
                        // inflictions go to on-debuff-inflicted) AND every enemy-side actor
                        // (dummy wall + enemy attackers — an enemy is never an ally).
                        if (e.sourceId !== ownerId && !isEnemySide(e.sourceId)) enqueue(intent);
                    });
                    bus.on('dot-applied', (e) => {
                        // Team DoT applications now emit dot-applied with the team sourceId
                        // (Task 4 seam, live since Task 6) — an ally DoT infliction triggers
                        // this listener exactly as an ally debuff does.
                        if (e.sourceId !== ownerId && !isEnemySide(e.sourceId)) enqueue(intent);
                    });
                    break;
                case 'on-ally-crit-dot':
                    bus.on('dot-applied', (e) => {
                        // Ally DoT infliction whose cast crit (viaCrit): any OTHER
                        // player's crit-cast DoT. Own casts and every enemy-side actor are
                        // excluded (mirrors on-ally-debuff-inflicted's ally scoping). One
                        // enqueue per qualifying infliction EVENT (per-infliction-event rule).
                        if (e.viaCrit && e.sourceId !== ownerId && !isEnemySide(e.sourceId)) {
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
                        // fires once PER CRITTING HIT, own casts and every enemy-side actor
                        // (dummy wall + enemy attackers) excluded — an enemy crit is NOT an
                        // ally crit, even though a walked enemy now emits ability-performed.
                        if (e.actorId === ownerId || isEnemySide(e.actorId)) return;
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
                        enqueue({ ...intent, eventCtx: { counterTargetId: e.attackerId } });
                    });
                    break;
                case 'on-destroyed':
                    bus.on('ship-destroyed', (e) => {
                        // Self-scoped: fires when THIS OWNER itself is destroyed (mirrors
                        // on-crit's own-id scoping). One enqueue per destruction event.
                        if (e.actorId === ownerId) enqueue(intent);
                    });
                    break;
                case 'on-ally-destroyed':
                    bus.on('ship-destroyed', (e) => {
                        // Ally-scoped: any OTHER player actor's destruction. Exclude this
                        // owner (own death goes to on-destroyed) AND every enemy-side actor
                        // (dummy wall + enemy attackers — an enemy is never an ally), mirroring
                        // on-ally-crit's scoping.
                        if (e.actorId !== ownerId && !isEnemySide(e.actorId)) enqueue(intent);
                    });
                    break;
                case 'on-enemy-destroyed':
                    bus.on('ship-destroyed', (e) => {
                        // Enemy-scoped: fires when any enemy-side actor (dummy wall + enemy
                        // attackers) is destroyed. One enqueue per destruction event.
                        if (isEnemySide(e.actorId)) enqueue(intent);
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
    grantExtraAction: (granterId: string, abilityId: string, oncePerRound: boolean) => void;
    /** The FIXED player-id source order ([focusActorId, ...team ids in input order]) — the
     *  same order Task 5 uses for ally/all-allies buff recipients (deterministic application). */
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
    /** Live self-HP% per owner (0..100) for drain-time hp-threshold gates (Phase 4c
     *  PR 1). The engine closes over the heal target's current/max HP (healing mode);
     *  every other owner — and DPS mode entirely — reports 100 (the pre-4c default),
     *  keeping all existing drain gating byte-identical. */
    selfHpPctFor?: (ownerId: string) => number;
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
 *  ability-status reads. Used to populate `enemyBuffNames` for a player actor's
 *  `enemy-buff` gates: the OPPOSING side from a player gate's view is the enemy
 *  attacker(s). Aggregation choice: UNION across all enemy owners (the condition is
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
 *  keyed by the same target. Used to populate `selfDebuffNames` for a player actor whose own
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
        // Counter-infliction routing (Phase 4c PR 1): an intent whose eventCtx names the
        // attacking enemy ("on that enemy" — Warden) lands on THAT enemy's per-target
        // store. Default (no eventCtx) → the singular default enemy store, byte-identical.
        const counterTargetId = intent.eventCtx?.counterTargetId;
        // Draw the OWNER's landing gate (its hacking-vs-security / affinity disadvantage),
        // NOT a global one — a team ship's debuff lands at ITS landing chance.
        if (owner.landsTimedEnemyApplication(cfg.application)) {
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
        const healing = ctx.healing; // local binding preserves narrowing inside the closure below
        // Once-per-combat cap (Task 8): a flagged repair (Yazid's on-cheat-death-activated 60%
        // repair) fires AT MOST ONCE per combat. The Set is engine-owned (combat lifetime), so
        // a key present here means this owner+ability already fired this battle → silent skip.
        if (cfg.oncePerCombat) {
            const key = `${intent.ownerId}:${intent.ability.id}`;
            if (ctx.oncePerCombatFired?.has(key)) return;
            ctx.oncePerCombatFired?.add(key);
        }
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
                    ? basisValue *
                      (cfg.pct / 100) *
                      (1 + owner.healModifier / 100) *
                      (1 + ownerOutgoing / 100) *
                      (1 + incomingPctFor(rid) / 100)
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

    if (cfg.type === 'extra-action') {
        // Reactive extra-action bridge (Task 10): hand the grant to the engine, which decides
        // Path A (splice into the live round queue — during-turn deaths) vs Path B (buffer for
        // the next round — post-round enemy death, no live queue). The owner is the GRANTER (the
        // ship whose death-triggered passive fired): Sokol/Liberator gain the extra turn, not the
        // dead enemy. The engine's processExtraActionGrants enforces oncePerRound + the backstop.
        ctx.grantExtraAction(intent.ownerId, intent.ability.id, cfg.oncePerRound);
        return;
    }

    // Any other type (purge/control/...) → not-simulated follow-up; skip.
}
