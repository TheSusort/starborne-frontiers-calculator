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

/** Ability types the executor knows how to follow up (see executeIntent). Only
 *  these four reactive types are routed through the trigger machinery; any other
 *  type carrying a live trigger stays on the on-cast path (not-simulated follow-up
 *  payloads — e.g. control/cleanse from a bomb-detonate reactive). */
export type ReactiveAbilityType = 'buff' | 'debuff' | 'dot' | 'charge';

/** Runtime mirror of ReactiveAbilityType for the partition check. */
const REACTIVE_ABILITY_TYPES: readonly ReactiveAbilityType[] = ['buff', 'debuff', 'dot', 'charge'];

/** A reactive ability registered as a listener, paired with its source slot
 *  (for parity with the timed-status sourceSlot bookkeeping). */
export interface ReactiveAbility {
    ability: Ability;
    sourceSlot: SkillSlot;
}

/** A queued follow-up execution. Listeners push these; the engine drains them. */
export interface Intent {
    ability: Ability;
    sourceSlot: SkillSlot;
}

/** Whether an ability is reactive (routed through the trigger machinery): a
 *  buff/debuff/dot/charge ability whose trigger is in the live set. Anything
 *  else stays on the on-cast path. */
function isReactiveAbility(ability: Ability): boolean {
    if (!LIVE_TRIGGERS.has(ability.trigger)) return false;
    return (REACTIVE_ABILITY_TYPES as readonly string[]).includes(ability.config.type);
}

/**
 * Partition the input ShipSkills ONCE at setup into:
 *  - `castSkills`: everything except live-trigger buff/debuff/dot/charge abilities.
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
 * Register each reactive ability as a bus listener, in slot/text order. Listener
 * bodies are PURE (Phase 1 contract): they only `enqueue` an intent — never mutate
 * combat state. Match guards per trigger:
 *  - on-crit → ability-performed with didCrit && actorId === 'attacker'
 *  - on-debuff-inflicted → debuff-applied | dot-applied with sourceId === 'attacker'
 *  - on-ally-debuff-inflicted → debuff-applied with sourceId not attacker/enemy
 *  - start-of-round → round-started
 *  - on-bomb-detonated → bomb-detonated
 */
export function registerReactiveListeners(args: {
    bus: CombatEventBus;
    reactiveAbilities: ReactiveAbility[];
    enqueue: (intent: Intent) => void;
}): void {
    const { bus, reactiveAbilities, enqueue } = args;
    for (const ra of reactiveAbilities) {
        const intent: Intent = { ability: ra.ability, sourceSlot: ra.sourceSlot };
        switch (ra.ability.trigger) {
            case 'on-crit':
                bus.on('ability-performed', (e) => {
                    if (e.didCrit && e.actorId === 'attacker') enqueue(intent);
                });
                break;
            case 'on-debuff-inflicted':
                bus.on('debuff-applied', (e) => {
                    if (e.sourceId === 'attacker') enqueue(intent);
                });
                bus.on('dot-applied', (e) => {
                    if (e.sourceId === 'attacker') enqueue(intent);
                });
                break;
            case 'on-ally-debuff-inflicted':
                bus.on('debuff-applied', (e) => {
                    // Ally = a team actor's infliction. Exclude the attacker AND the enemy
                    // defensively (the enemy never inflicts debuffs in-sim today).
                    if (e.sourceId !== 'attacker' && e.sourceId !== 'enemy') enqueue(intent);
                });
                // FUTURE: when team DoT lists ship (team-skill-walk spec), also subscribe to
                // 'dot-applied' here — today no dot-applied with a team sourceId is ever emitted
                // (both emission sites use 'attacker'), so an ally DoT infliction cannot occur.
                break;
            case 'start-of-round':
                bus.on('round-started', () => enqueue(intent));
                break;
            case 'on-bomb-detonated':
                bus.on('bomb-detonated', () => enqueue(intent));
                break;
            default:
                // Non-live triggers are never registered (filtered at partition time).
                break;
        }
    }
}

/** Drain-time engine context the executor reads + mutates. State mutation happens
 *  ONLY here (Phase 1 contract: listeners enqueue, the executor mutates). */
export interface IntentExecContext {
    round: number;
    attacker: CombatActor;
    enemy: CombatActor;
    statusEngine: StatusEngine;
    bus: CombatEventBus;
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    pendingBombs: PendingBomb[];
    debuffLandingGate: (rate: number) => boolean;
    debuffLandingChance: number;
    landsTimedEnemyApplication: (application?: 'inflict' | 'apply') => boolean;
    enemyType?: EnemyBaseClass;
    enemyHp: number;
    /** Damage dealt to the enemy so far (drives the drain-time enemyHpPct). */
    cumulativeDamage: number;
    /** Last attacker turn's effective attack — needed for bomb damagePerStack. Undefined
     *  before any attacker turn this run (a faster enemy, round 1) → bombs are skipped. */
    effectiveAttack?: number;
    /** Affinity multiplier of the inflicting actor (attacker today — the executor is
     *  attacker-only until Task 6), snapshotted onto a pushed bomb entry for its burst. */
    affinityMult: number;
    /** Record a resisted enemy application onto the round's resisted list (the engine
     *  routes it to pendingResisted or the last attacker turn, per Task-2 staging). */
    recordResisted: (resisted: ActiveBuff) => void;
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
 * `includeAbilitySelfNames` (Task 5) additionally pulls the owner's ABILITY-SOURCED self statuses
 * (timed + persistent, which snapshot() excludes because they carry payloads) into the gate's
 * selfBuffNames — mirroring the player-turn's local `priorAbilitySelfNames`. The player-turn
 * caster-ctx resolver sets it so a FOREIGN caster's ability self-buffs (e.g. a team ship's
 * self-granted gate buff) are visible to its own aura's gate. The drain path leaves it false
 * (the executor is attacker-only and the drain gate's snapshot-only behaviour is golden-locked).
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
    });
}

function buildDrainContext(ctx: IntentExecContext) {
    const enemyHpPct =
        ctx.enemyHp > 0 ? Math.max(0, 100 * (1 - ctx.cumulativeDamage / ctx.enemyHp)) : 100;
    // Drain-time gate reads the ATTACKER's snapshot (the executor is attacker-only until Task 6).
    return buildActorConditionContext(ctx.statusEngine, 'attacker', {
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
 *  - any other type → skipped silently (not-simulated follow-up payloads).
 * Intents that emit events (debuff/dot) chain through the listeners again.
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

    // Drain-time condition gate against CURRENT engine state — one gate for every
    // branch. liveGateConditions neutralizes non-derivable-on-non-live subjects to
    // 'always'; manual conditions keep literal gating (manualCount). A failed gate
    // is a silent skip (no resisted record).
    const gateConditions = liveGateConditions(intent.ability.conditions);
    if (!conditionsMet(gateConditions, buildDrainContext(ctx))) return;

    if (cfg.type === 'charge') {
        // Attacker-only charge gain, capped as on the cast path.
        if (ctx.attacker.chargeCount === 0) return;
        ctx.attacker.charges = Math.min(
            ctx.attacker.charges + cfg.amount,
            ctx.attacker.chargeCount
        );
        return;
    }

    if (cfg.type === 'buff') {
        // Reactive buffs bypass the aura-by-passive-slot classification — their own
        // duration decides; a duration-less buff defaults to a 1-turn window.
        const duration = typeof cfg.duration === 'number' ? cfg.duration : 1;
        const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
            payload: payloadFromConfig(cfg),
            side: 'self',
            sourceSlot: intent.sourceSlot,
            conditions: gateConditions,
            kind: 'timed',
            duration,
        };
        ctx.statusEngine.applyTimedAbilityStatus(ctx.round, status);
        ctx.bus.emit({
            type: 'buff-applied',
            actorId: 'attacker',
            round: ctx.round,
            buffName: cfg.buffName,
            duration,
        });
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
        if (ctx.landsTimedEnemyApplication(cfg.application)) {
            ctx.statusEngine.applyTimedAbilityStatus(ctx.round, status);
            // Discrete infliction event — sourceId 'attacker' so the application is chainable.
            ctx.bus.emit({
                type: 'debuff-applied',
                sourceId: 'attacker',
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
        // One landing draw at execution (deterministic queue order).
        if (!ctx.debuffLandingGate(ctx.debuffLandingChance)) return;
        // TODO(Task 6): the executor is attacker-only today, so reactive DoT applications are
        // stamped sourceId 'attacker'. Task 6 generalizes reactive abilities per owner — the
        // sourceId (and the affinity/effectiveAttack snapshot) must then come from the owner.
        if (cfg.dotType === 'corrosion') {
            ctx.corrosionEntries.push({
                stacks: cfg.stacks,
                tier: cfg.tier,
                remainingRounds: cfg.duration,
                sourceId: 'attacker',
            });
        } else if (cfg.dotType === 'inferno') {
            ctx.infernoEntries.push({
                stacks: cfg.stacks,
                tier: cfg.tier,
                remainingRounds: cfg.duration,
                sourceId: 'attacker',
            });
        } else if (cfg.dotType === 'bomb') {
            // Bomb damagePerStack needs the attacker's effective attack. Before any
            // attacker turn this run (faster enemy, round 1) there is no ctx — skip.
            if (ctx.effectiveAttack === undefined) return;
            ctx.pendingBombs.push({
                countdown: Math.max(1, cfg.duration),
                damagePerStack: ctx.effectiveAttack * (cfg.tier / 100),
                stacks: cfg.stacks,
                tier: cfg.tier,
                sourceId: 'attacker',
                affinityMult: ctx.affinityMult,
            });
        }
        // Discrete infliction event — sourceId 'attacker' so the application is chainable.
        ctx.bus.emit({
            type: 'dot-applied',
            sourceId: 'attacker',
            targetId: ctx.enemy.id,
            round: ctx.round,
            dotType: cfg.dotType,
            stacks: cfg.stacks,
        });
        return;
    }

    // Any other type (heal/shield/control/cleanse/...) → not-simulated follow-up; skip.
}
