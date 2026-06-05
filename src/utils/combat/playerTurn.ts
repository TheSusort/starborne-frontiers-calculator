import { calculateDamageReduction } from '../autogear/priorityScore';
import { evaluateCondition, scaledBonus, conditionsMet } from '../abilities/evaluateConditions';
import { buildRoundContext } from '../abilities/roundContext';
import {
    Buff,
    DoTApplicationConfig,
    EnemyBaseClass,
    SelectedGameBuff,
} from '../../types/calculator';
import { Ability, ShipSkills, Skill } from '../../types/abilities';
import type { ConditionContext } from '../abilities/evaluateConditions';
import {
    selectFiringSkill,
    damageInputsFromSkill,
    secondaryFromSkill,
    dotsFromSkill,
    chargeAbilitiesFromSkill,
    detonationsFromSkill,
    accumulatorsFromSkill,
    modifierTotalsFromAbilities,
    gateFiringAbilities,
} from '../abilities/applyAbilities';
import {
    toSimBuffs,
    toEnemyModifiers,
    toEnemyDotModifier,
    toDotAndPenModifiers,
} from '../calculators/dpsBuffHelpers';
import { ActiveDoTStack, PendingAccumulator, PendingBomb, CombatActor } from './state';
import {
    ActiveBuff,
    AbilityStatusPayload,
    ActiveAbilityStatus,
    RegisteredAbilityStatus,
    createStatusEngine,
} from './statusEngine';
import { CombatEventBus } from './events';
import { synthesizeResisted } from './shared';
import type { ReactiveAbility } from './triggers';

type StatusEngine = ReturnType<typeof createStatusEngine>;

/** A deterministic event gate: maps a probability/rate to a fire/no-fire decision. */
export type RateGate = (rate: number) => boolean;

/** The timed variant of a registered ability status (duration guaranteed numeric). */
export type TimedStatus = Extract<RegisteredAbilityStatus, { kind: 'timed' }>;

// Round-scoped context the enemy's DoT processing needs from the focus player actor's
// turn. At default speeds the player acts first, so the enemy's tick uses THIS round's
// context (identical to the pre-restructure behaviour). For a FASTER enemy it is the
// PREVIOUS round's context; only in that case is round 1 undefined (the enemy acts
// before any player turn — containers necessarily empty, processing skipped).
export interface PlayerRoundCtx {
    effectiveAttack: number;
    dotMult: number;
    affinityMult: number;
    /** The player turn's directDamage — consumed by processAccumulators. With a
     *  FASTER enemy this is the PREVIOUS round's value (the accumulator gathers the
     *  last direct hit dealt before its countdown step) — a documented approximation
     *  in the fast-enemy KNOWN-DIFF; no golden fixture combines the two. */
    directDamage: number;
}

/** Everything one player actor's turn contributes to the round's RoundData row. */
export interface PlayerTurnResult {
    action: 'active' | 'charged';
    roundCrit: boolean;
    enemyHpPct: number;
    dotsConfig: DoTApplicationConfig;
    dotsLanded: boolean;
    activeSelfBuffs: ActiveBuff[];
    landedEnemyDebuffs: ActiveBuff[];
    resistedEnemyDebuffs: ActiveBuff[];
    directDamage: number;
    secondaryDamage: number;
    conditionalDamage: number;
    detonationDamage: number; // the player-turn detonate() portion
    attackerCtx: PlayerRoundCtx; // round-scoped context for the enemy's DoT tick
}

/** Everything one player actor's turns need. Built once at engine setup — the
 *  attacker's runtime comes from the top-level inputs; walked team runtimes (Task 4)
 *  from TeamActorInput. The engine core keys on runtime/actor ids, never 'attacker'. */
export interface PlayerActorRuntime {
    actor: CombatActor;
    /** actor.id === focusActorId — this runtime's turns feed the RoundData row. */
    focus: boolean;
    castSkills: ShipSkills; // reactive-partitioned (engine setup)
    reactiveAbilities: ReactiveAbility[];
    timedSelfBySlot: TimedStatus[];
    timedEnemyBySlot: TimedStatus[];
    hasChargedSkill: boolean;
    // Base stats
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    defence: number;
    hp: number;
    // Per-actor adapter-derived rates
    debuffLandingChance: number;
    selfDotModifier: number;
    defensePenetrationBuff: number;
    affinityDamageModifier: number;
    affinityCritCap: number;
    affinityCritPenalty: number;
    affinityDisadvantage: boolean;
    allyChargePerRound?: number; // attacker-only manual input
    // Per-actor deterministic gates (own instances — determinism isolation)
    activeCritGate: RateGate;
    chargedCritGate: RateGate;
    debuffLandingGate: RateGate;
    extendChanceGate: RateGate;
    landsTimedEnemyApplication: (application?: 'inflict' | 'apply') => boolean;
    // Lookups: attacker carries the global merged lookups; team runtimes get empty maps
    selfBuffLookup: Map<string, SelectedGameBuff[]>;
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>;
}

/** Everything one player actor's turn closes over. The per-actor configuration/gates/
 *  stats live on `runtime`; the rest are round-shared engine state (status engine,
 *  enemy actor + its DoT containers, the bus, and the per-call round number /
 *  cumulative damage). chargeCount/startCharged are NOT here — they live on
 *  `runtime.actor` (CombatActor carries chargeCount + seeded charges). */
export interface PlayerTurnArgs {
    runtime: PlayerActorRuntime;
    enemy: CombatActor;
    statusEngine: StatusEngine;
    // DoT containers (live on the enemy actor; passed through for clarity).
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    pendingBombs: PendingBomb[];
    pendingAccumulators: PendingAccumulator[];
    enemyDefense: number;
    enemyHp: number;
    enemyType?: EnemyBaseClass;
    // Required (Phase 3): the engine always passes its internal bus (wrapping the optional
    // external tap), so the player turn emits unconditionally.
    bus: CombatEventBus;
    // Per-call round state.
    round: number;
    cumulativeDamage: number;
}

// ---------------------------------------------------------------------------
// Module-private helpers used EXCLUSIVELY by the player turn.
// ---------------------------------------------------------------------------

// Mirror toSimBuffs/toEnemyModifiers semantics for an ability-status payload: wrap it as
// a SelectedGameBuff so the existing buff-fold helpers apply (effect × stacks). The payload's
// own stacks (current count for accumulating; configured stacks otherwise) become the buff stacks.
function payloadToSelectedBuff(payload: AbilityStatusPayload): SelectedGameBuff {
    // NOTE: the derived id `ability-${buffName}` is non-unique by design for duplicate buffNames
    // (only summed by stat downstream, never deduped by id).
    return {
        id: `ability-${payload.buffName}`,
        buffName: payload.buffName,
        stacks: payload.stacks,
        parsedEffects: payload.parsedEffects,
        isStackable: false,
        ...(payload.application ? { application: payload.application } : {}),
    };
}

function calculateBuffTotals(buffs: Buff[]) {
    const attackBuff = buffs
        .filter((b) => b.stat === 'attack')
        .reduce((sum, b) => sum + b.value, 0);
    const critBuff = buffs.filter((b) => b.stat === 'crit').reduce((sum, b) => sum + b.value, 0);
    const critDamageBuff = buffs
        .filter((b) => b.stat === 'critDamage')
        .reduce((sum, b) => sum + b.value, 0);
    const outgoingDamageBuff = buffs
        .filter((b) => b.stat === 'outgoingDamage')
        .reduce((sum, b) => sum + b.value, 0);
    const defenceBuff = buffs
        .filter((b) => b.stat === 'defence')
        .reduce((sum, b) => sum + b.value, 0);
    const hpBuff = buffs.filter((b) => b.stat === 'hp').reduce((sum, b) => sum + b.value, 0);
    return { attackBuff, critBuff, critDamageBuff, outgoingDamageBuff, defenceBuff, hpBuff };
}

// Expand an active buff/debuff into its underlying SelectedGameBuff effects.
// Accumulating buffs override their static stacks with the per-round count and
// drop out entirely when at zero stacks; non-accumulating ones pass through.
function expandBuffs(ab: ActiveBuff, bufs: SelectedGameBuff[]): SelectedGameBuff[] {
    if (ab.stacks !== undefined) {
        return ab.stacks > 0 ? bufs.map((b) => ({ ...b, stacks: ab.stacks! })) : [];
    }
    return bufs;
}

// Per-round self-buff totals from the status engine's active list. Expands each
// active buff back into its SelectedGameBuff effects (stack override included) and
// folds them into the six tracked totals. The later active-passive modifier
// fold-in stays in the loop (it depends on modifierCtx); these totals are returned
// mutable so the loop can add the modifier deltas at the original sequence point.
function resolveSelfBuffTotals(args: {
    activeSelfBuffs: ActiveBuff[];
    selfBuffLookup: Map<string, SelectedGameBuff[]>;
}): ReturnType<typeof calculateBuffTotals> {
    const roundSelfBuffs = args.activeSelfBuffs.flatMap((ab) =>
        // Accumulating buff: override static stacks with per-round count; skip when 0
        expandBuffs(ab, args.selfBuffLookup.get(ab.buffName) ?? [])
    );
    return calculateBuffTotals(toSimBuffs(roundSelfBuffs));
}

// Per-round RECURRING/always enemy-debuff expansion with landing logic (Task 7).
// TIMED enemy applications are gated ONCE at application time (the status-engine hook
// and the ability loop below), so they are NOT re-rolled here — only the recurring/aura
// subset is, mirroring their conceptual per-round re-application. 'apply' (affinity-based)
// debuffs land unless the attacker is at an affinity disadvantage; everything else draws
// the hacking-vs-security landing roll. The roll is a LAZY getter (`roundDebuffLanded`)
// so the single per-round gate draw is taken only when a non-'apply' recurring debuff is
// present (and is memoized across all round consumers — recurring fold + DoT landing).
// NOTE: no `debuff-applied` is emitted here (Phase 3 retiming: recurring/aura per-round
// re-applications are NOT discrete inflictions — only `debuff-resisted` fires on miss,
// unchanged from Phase 1).
function resolveEnemyDebuffs(args: {
    activeEnemyDebuffs: ActiveBuff[];
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>;
    affinityDisadvantage: boolean;
    roundDebuffLanded: () => boolean;
    emitResisted: (buffName: string) => void;
}): {
    roundEnemyDebuffs: SelectedGameBuff[];
    landedEnemyDebuffs: ActiveBuff[];
    resistedEnemyDebuffs: ActiveBuff[];
} {
    const landedEnemyDebuffs: ActiveBuff[] = [];
    const resistedEnemyDebuffs: ActiveBuff[] = [];
    const roundEnemyDebuffs = args.activeEnemyDebuffs.flatMap((ab) => {
        const bufs = args.enemyDebuffLookup.get(ab.buffName) ?? [];
        // 'apply' = affinity-based: guaranteed unless the attacker is at an affinity
        // disadvantage. 'inflict' (and unmarked) = hacking-based: gated by the
        // hacking-vs-security landing roll. NOTE: application type is derived from
        // the lookup because ActiveBuff does not carry it — if ActiveBuff ever gains
        // an `application` field (e.g. team-sourced debuffs), prefer reading it there.
        const isApply = bufs.some((b) => b.application === 'apply');
        const lands = isApply ? !args.affinityDisadvantage : args.roundDebuffLanded();
        if (!lands) {
            resistedEnemyDebuffs.push(ab);
            args.emitResisted(ab.buffName);
            return [];
        }
        landedEnemyDebuffs.push(ab);
        return expandBuffs(ab, bufs);
    });
    return { roundEnemyDebuffs, landedEnemyDebuffs, resistedEnemyDebuffs };
}

// Per-round fold for TIMED scheduled enemy statuses currently in the status map. They
// drew their landing roll ONCE at application (status-engine hook) and persist their full
// window with no re-roll, so here they are unconditionally landed: expand their effects
// and report them as landed. No gate draw, no resist partition, NO `debuff-applied`
// emission (Phase 3 retiming: discrete-infliction-only; the emission moved to the
// sourceFired/applyTimedAbilityStatus application sites).
function foldTimedEnemyDebuffs(args: {
    timedEnemyDebuffs: ActiveBuff[];
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>;
}): { roundEnemyDebuffs: SelectedGameBuff[]; landedEnemyDebuffs: ActiveBuff[] } {
    const landedEnemyDebuffs: ActiveBuff[] = [];
    const roundEnemyDebuffs = args.timedEnemyDebuffs.flatMap((ab) => {
        const bufs = args.enemyDebuffLookup.get(ab.buffName) ?? [];
        landedEnemyDebuffs.push(ab);
        return expandBuffs(ab, bufs);
    });
    return { roundEnemyDebuffs, landedEnemyDebuffs };
}

// Step 2.9: Extend ACTIVE-scope ticking DoTs (Corrosion/Inferno) by extend-dot abilities —
// applied BEFORE this round's new DoTs so only pre-existing ones grow (Provider's
// "extends active Damage Over Time effects"). Bombs are excluded (delaying a one-shot
// detonation adds nothing). Each ability is gated by its conditions (using ctx with binary
// roundCrit); a `chanceFromCritPower` extension fires at exactly critPowerFactor frequency
// via the deterministic extendChanceGate schedule. Sourced from BOTH the firing skill and
// the always-active passive slot. The stateful gate is passed in and called at the same
// sequence point as the original inline loop. 'inflicted'-scope extensions are handled
// separately AFTER applyNewDoTs (see extendInflictedDoTs).
function extendDoTs(args: {
    abilities: Ability[];
    ctx: ConditionContext;
    effectiveCritDamage: number;
    extendChanceGate: (rate: number) => boolean;
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
}): void {
    for (const ab of args.abilities) {
        if (ab.config.type !== 'extend-dot') continue;
        if (ab.config.scope === 'inflicted') continue;
        if (!conditionsMet(ab.conditions, args.ctx)) continue;
        if (ab.config.chanceFromCritPower) {
            const critPowerFactor = Math.min(1, args.effectiveCritDamage / 100);
            if (!args.extendChanceGate(critPowerFactor)) continue;
        }
        for (const e of args.corrosionEntries) e.remainingRounds += ab.config.turns;
        for (const e of args.infernoEntries) e.remainingRounds += ab.config.turns;
    }
}

// Step 3a: Extend INFLICTED-scope DoTs — runs AFTER applyNewDoTs, extending ONLY the
// Corrosion/Inferno entries THIS cast just appended (Valerian's "the newly applied
// Corrosion ... extended by 1 turn"). `*EntriesBefore` are the container lengths captured
// before applyNewDoTs, so the slice from that index onward is exactly what landed this cast.
// Bombs are excluded (matching extendDoTs). Gating is identical to extendDoTs: ability
// conditions vs ctx (binary roundCrit), then extendChanceGate(critPowerFactor) for a
// chanceFromCritPower extension. If the landing roll failed, applyNewDoTs was skipped and
// the slice is empty — a natural no-op.
function extendInflictedDoTs(args: {
    abilities: Ability[];
    ctx: ConditionContext;
    effectiveCritDamage: number;
    extendChanceGate: (rate: number) => boolean;
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    corrosionEntriesBefore: number;
    infernoEntriesBefore: number;
}): void {
    for (const ab of args.abilities) {
        if (ab.config.type !== 'extend-dot') continue;
        if (ab.config.scope !== 'inflicted') continue;
        if (!conditionsMet(ab.conditions, args.ctx)) continue;
        if (ab.config.chanceFromCritPower) {
            const critPowerFactor = Math.min(1, args.effectiveCritDamage / 100);
            if (!args.extendChanceGate(critPowerFactor)) continue;
        }
        for (let i = args.corrosionEntriesBefore; i < args.corrosionEntries.length; i++) {
            args.corrosionEntries[i].remainingRounds += ab.config.turns;
        }
        for (let i = args.infernoEntriesBefore; i < args.infernoEntries.length; i++) {
            args.infernoEntries[i].remainingRounds += ab.config.turns;
        }
    }
}

// Charge gain from a GATED skill's charge abilities. Gating already happened in
// gateFiringAbilities (full AND/OR + thresholds) — for the firing skill via
// gatedSkill and for the passive slot via gatedPassive. A thresholded gate
// contributes the flat amount once; an unthresholded count/probability condition
// still SCALES it (binary self-crit, per-count subjects). No condition → flat amount.
function chargeGainFromSkill(args: {
    gatedSkill: Skill | undefined;
    ctxFor: Map<string, ConditionContext>;
    fallbackCtx: ConditionContext;
}): number {
    let gain = 0;
    for (const ability of chargeAbilitiesFromSkill(args.gatedSkill)) {
        if (ability.config.type !== 'charge') continue;
        const primary = ability.conditions[0];
        const scale =
            !primary || primary.countComparator != null
                ? 1
                : evaluateCondition(primary, args.ctxFor.get(ability.id) ?? args.fallbackCtx);
        gain += scale * ability.config.amount;
    }
    return gain;
}

// Step 2.95: Detonate active DoTs of a type — consume them and deal their full remaining
// damage at once, scaled by powerPct. Done BEFORE this round's new DoTs apply, so a skill
// that detonates and re-applies the same type (e.g. Incinerator) doesn't eat its own new
// stack. The payout is DETONATION damage (the game category that also covers Bomb bursts).
// `emitBombDetonated` is called for the bomb branch when the payout is non-zero, carrying
// total stacks and damage so Phase 3 reactive triggers can respond (Phase 3 Task 3).
function detonate(args: {
    gatedSkill: Skill | undefined;
    effectiveAttack: number;
    enemyHp: number;
    dotMult: number;
    affinityMult: number;
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    pendingBombs: PendingBomb[];
    emitBombDetonated?: (stacks: number, damage: number) => void;
}): number {
    let detonationDamage = 0;
    for (const det of detonationsFromSkill(args.gatedSkill)) {
        const pct = det.powerPct / 100;
        if (det.dotType === 'inferno') {
            detonationDamage +=
                args.infernoEntries.reduce(
                    (sum, e) =>
                        sum + e.stacks * (e.tier / 100) * args.effectiveAttack * e.remainingRounds,
                    0
                ) *
                args.dotMult *
                args.affinityMult *
                pct;
            args.infernoEntries.length = 0;
        } else if (det.dotType === 'corrosion') {
            const baseHp = Math.min(args.enemyHp, 500_000);
            detonationDamage +=
                args.corrosionEntries.reduce(
                    (sum, e) => sum + e.stacks * (e.tier / 100) * baseHp * e.remainingRounds,
                    0
                ) *
                args.dotMult *
                args.affinityMult *
                pct;
            args.corrosionEntries.length = 0;
        } else if (det.dotType === 'bomb') {
            const totalStacks = args.pendingBombs.reduce((sum, b) => sum + b.stacks, 0);
            const payout =
                args.pendingBombs.reduce((sum, b) => sum + b.stacks * b.damagePerStack, 0) *
                args.affinityMult *
                pct;
            if (payout > 0) {
                args.emitBombDetonated?.(totalStacks, payout);
            }
            detonationDamage += payout;
            args.pendingBombs.length = 0;
        }
    }
    return detonationDamage;
}

// Step 3: Apply new DoT stacks from this round's skill (subject to landing roll).
function applyNewDoTs(args: {
    dotsConfig: DoTApplicationConfig;
    effectiveAttack: number;
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    pendingBombs: PendingBomb[];
    emitDotApplied: (dotType: 'corrosion' | 'inferno' | 'bomb', stacks: number) => void;
}): void {
    for (const dot of args.dotsConfig) {
        if (dot.stacks <= 0 || dot.tier <= 0) continue;
        if (dot.type === 'corrosion') {
            args.corrosionEntries.push({
                stacks: dot.stacks,
                tier: dot.tier,
                remainingRounds: dot.duration,
            });
            args.emitDotApplied('corrosion', dot.stacks);
        } else if (dot.type === 'inferno') {
            args.infernoEntries.push({
                stacks: dot.stacks,
                tier: dot.tier,
                remainingRounds: dot.duration,
            });
            args.emitDotApplied('inferno', dot.stacks);
        } else if (dot.type === 'bomb') {
            args.pendingBombs.push({
                countdown: Math.max(1, dot.duration),
                damagePerStack: args.effectiveAttack * (dot.tier / 100),
                stacks: dot.stacks,
                tier: dot.tier,
            });
            args.emitDotApplied('bomb', dot.stacks);
        }
    }
}

// Step 3b: Apply Echoing Burst-style accumulators inflicted by this round's skill
// (gated by the same landing roll as inflicted debuffs). Each starts gathering this
// round's direct damage in Step 6b below.
function applyAccumulators(args: {
    gatedSkill: Skill | undefined;
    pendingAccumulators: PendingAccumulator[];
}): void {
    for (const acc of accumulatorsFromSkill(args.gatedSkill)) {
        args.pendingAccumulators.push({
            roundsRemaining: Math.max(1, acc.turns),
            pct: acc.pct,
            accumulated: 0,
        });
    }
}

/**
 * One player actor's turn: the full damage/buff/DoT-application pipeline (combat-system.md
 * §10), minus the DoT-processing calls (tickDoTs / processBombs / processAccumulators) which
 * run on the enemy turn. Returns everything the round's RoundData row needs from this turn; the
 * caller folds the numeric damage fields into the round accumulator and drains any pending
 * resisted team-turn entries into `resistedEnemyDebuffs`. Math is byte-identical to the old
 * inline attacker block; only the structure (parameters + return) changed. Every per-actor
 * read comes from `runtime`, and every owner id is `runtime.actor.id` — only the attacker
 * uses this today (Task 3); Task 4 builds walked team runtimes.
 */
export function runPlayerTurn(args: PlayerTurnArgs): PlayerTurnResult {
    const {
        runtime,
        enemy,
        statusEngine,
        corrosionEntries,
        infernoEntries,
        pendingBombs,
        pendingAccumulators,
        enemyDefense,
        enemyHp,
        enemyType,
        bus,
        round: r,
        cumulativeDamage,
    } = args;

    const {
        actor,
        timedEnemyBySlot,
        timedSelfBySlot,
        selfBuffLookup,
        enemyDebuffLookup,
        activeCritGate,
        chargedCritGate,
        debuffLandingGate,
        extendChanceGate,
        landsTimedEnemyApplication,
        castSkills: shipSkills,
        hasChargedSkill,
        attack,
        crit,
        critDamage,
        defensePenetration,
        defensePenetrationBuff,
        selfDotModifier,
        debuffLandingChance,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        affinityDisadvantage,
        defence,
        hp,
        allyChargePerRound,
    } = runtime;
    // chargeCount lives on the actor (CombatActor carries it); read from there.
    const chargeCount = actor.chargeCount;

    // ====================================================================
    // PLAYER TURN — the old attacker block, minus the DoT-processing
    // calls (tickDoTs / processBombs / processAccumulators), which move to
    // the enemy turn. Math is byte-identical; only the DoT block relocated.
    // ====================================================================

    // --- preTurn: action selection + charge consumption ---
    let action: 'active' | 'charged';
    if (hasChargedSkill && actor.charges >= chargeCount) {
        action = 'charged';
        actor.charges = 0;
    } else {
        action = 'active';
        if (hasChargedSkill) {
            actor.charges += 1;
        }
    }

    bus.emit({ type: 'skill-fired', actorId: actor.id, round: r, slot: action });

    // Enemy HP% entering this round, derived from damage dealt so far. Floors at 0
    // once cumulative damage exceeds the pool (the sim keeps hitting the "dead" dummy).
    const enemyHpPct = enemyHp > 0 ? Math.max(0, 100 * (1 - cumulativeDamage / enemyHp)) : 100;

    const firingSkill = selectFiringSkill(shipSkills, action);
    // noCrit is read from the UNGATED skill: the flag is a property of the attack
    // itself and must be known before the ctx (and therefore the gate) exists.
    // Assumes one base-damage ability per skill (true for all parser output); a
    // gated-off first damage ability with a differently-flagged second one would
    // read the wrong flag — not representable from skill text today.
    const damageNoCrit = damageInputsFromSkill(firingSkill).noCrit;

    const emitDebuffResisted = (buffName: string) =>
        bus.emit({ type: 'debuff-resisted', targetId: enemy.id, round: r, buffName });
    // emitDebuffApplied: discrete-infliction-only (Phase 3 retiming). `sourceId` is the
    // actor that inflicted the debuff. NOT called for recurring/aura per-round re-applications
    // or for every round a standing timed status is active — only at the infliction site.
    const emitDebuffApplied = (sourceId: string, buffName: string) =>
        bus.emit({ type: 'debuff-applied', sourceId, targetId: enemy.id, round: r, buffName });

    // Per-round buff totals from the status engine. This actor notifies the
    // engine of its REAL fired slot this round (action-fed: scheduled timed
    // buffs key off the actual cadence, not a predicted schedule), then we read
    // the snapshot. No decrement here — that lives in each owner's Post Turn
    // (statusEngine.decrementPlayer/decrementEnemy, called after this actor's turn block).
    // sourceFired returns the buffNames of any TIMED enemy applications the
    // landing hook rejected this round (drawn once at application — Task 7).
    // NOTE: sourceFired(runtime.actor.id, …) is already correct for future team ids —
    // it applies that source's own manual lists.
    const { resistedEnemy: resistedScheduledTimedNames, appliedEnemy: appliedScheduledTimedNames } =
        statusEngine.sourceFired(actor.id, action === 'charged' ? 'charge' : 'active', r);
    // Emit debuff-applied ONCE per landed timed enemy application (discrete-infliction event).
    // This is this actor's scheduled timed debuffs path. The ability timed path emits below.
    for (const buffName of appliedScheduledTimedNames) {
        emitDebuffApplied(actor.id, buffName);
    }
    const entry = statusEngine.snapshot(actor.id);

    // Effective crit rate from a given crit-buff total, clamped by affinity.
    const cappedCrit = (critBuffTotal: number) =>
        Math.min(affinityCritCap, Math.max(0, crit + critBuffTotal - affinityCritPenalty));

    // --- Scheduled (manual + team) statuses: same path as before ---
    // Scheduled self-buff names + totals.
    const scheduledSelfBuffNames = entry.activeSelfBuffs
        .filter((ab) => ab.stacks === undefined || ab.stacks > 0)
        .map((ab) => ab.buffName);
    let { attackBuff, critBuff, critDamageBuff, outgoingDamageBuff, defenceBuff, hpBuff } =
        resolveSelfBuffTotals({
            activeSelfBuffs: entry.activeSelfBuffs,
            selfBuffLookup,
        });

    // Per-round landing roll, drawn ONCE and memoized across this round's
    // consumers (the RECURRING/aura partition + DoT landing). Lazy so the
    // single draw is taken only when something actually needs it — TIMED
    // applications gate at application time and do NOT re-draw here, so a
    // round with no recurring/aura enemy content and no DoTs takes no draw
    // (preserving the deterministic schedule for application-only fixtures).
    let roundDebuffLandedValue: boolean | undefined;
    const roundDebuffLanded = (): boolean => {
        if (roundDebuffLandedValue === undefined) {
            roundDebuffLandedValue = debuffLandingGate(debuffLandingChance);
        }
        return roundDebuffLandedValue;
    };

    // Partition the scheduled-status snapshot. TIMED scheduled statuses (numeric
    // turnsRemaining) already drew their landing roll at application — fold them
    // unconditionally. RECURRING/always/accumulating statuses ('recurring') are
    // conceptually re-applied each round — re-roll them via resolveEnemyDebuffs.
    const recurringEnemySnap = entry.activeEnemyDebuffs.filter(
        (ab) => ab.turnsRemaining === 'recurring'
    );
    const timedEnemySnap = entry.activeEnemyDebuffs.filter(
        (ab) => ab.turnsRemaining !== 'recurring'
    );
    const recurringEnemy = resolveEnemyDebuffs({
        activeEnemyDebuffs: recurringEnemySnap,
        enemyDebuffLookup,
        affinityDisadvantage,
        roundDebuffLanded,
        emitResisted: emitDebuffResisted,
        // No emitApplied: recurring/aura per-round re-applications are NOT discrete inflictions.
    });
    const timedScheduledEnemy = foldTimedEnemyDebuffs({
        timedEnemyDebuffs: timedEnemySnap,
        enemyDebuffLookup,
        // No emitApplied: timed debuffs already emitted debuff-applied at application time
        // (sourceFired appliedEnemy path). Per-round re-emission removed (Phase 3 retiming).
    });
    // Scheduled timed applications the landing hook rejected this round: synthesize
    // a resisted ActiveBuff carrying the would-be duration (skillDuration) and emit.
    const resistedScheduledTimed: ActiveBuff[] = synthesizeResisted(
        resistedScheduledTimedNames,
        enemyDebuffLookup,
        emitDebuffResisted
    );
    // Combined scheduled enemy effect/landed/resisted lists. Recurring/always/
    // accum first, then timed — matching the original snapshot() iteration order
    // (alwaysSnap, accumSnap, timed map) so the all-landing golden fixtures keep
    // byte-identical list ordering.
    const scheduledEnemy = {
        roundEnemyDebuffs: [
            ...recurringEnemy.roundEnemyDebuffs,
            ...timedScheduledEnemy.roundEnemyDebuffs,
        ],
        landedEnemyDebuffs: [
            ...recurringEnemy.landedEnemyDebuffs,
            ...timedScheduledEnemy.landedEnemyDebuffs,
        ],
        resistedEnemyDebuffs: [...recurringEnemy.resistedEnemyDebuffs, ...resistedScheduledTimed],
    };

    // --- In-loop ability statuses with live condition gating (Task 6) ---
    // Single forward pass (spec determinism rule): build a pre-application gate
    // context → gate+apply this round's TIMED enemy debuffs → recount → gate+apply
    // TIMED self buffs → collect effective ability statuses and fold their payloads
    // exactly where scheduled buffs fold.

    // "Already active" ability self statuses (window-persisting timed + accumulated)
    // are visible to the gate; auras are gated themselves, so they don't pre-seed names.
    const priorAbilitySelfNames = statusEngine
        .timedAbilityStatuses('self', actor.id)
        .map((s) => s.active.buffName);

    // (a) Pre-application gate context (before ability debuffs land). effectiveCritRate uses
    // the scheduled crit buff only (modifiers/ability buffs not yet folded), and NO roundCrit
    // — buff gates use the probability tier like modifierCtx. NOTE: a self-crit-gated buff
    // therefore resolves effectiveCritRate/100 > 0, i.e. passes whenever the crit rate is
    // non-zero — intended "live-subject, satisfiable" behaviour, not a bug.
    const preDebuffGateCtx = buildRoundContext({
        selfBuffNames: [...scheduledSelfBuffNames, ...priorAbilitySelfNames],
        landedEnemyDebuffCount: scheduledEnemy.landedEnemyDebuffs.length,
        corrosionEntryCount: corrosionEntries.length,
        infernoEntryCount: infernoEntries.length,
        bombCount: pendingBombs.length,
        effectiveCritRate: cappedCrit(critBuff),
        enemyType,
        enemyHpPct,
    });

    // (b) Gate + apply this round's firing-skill TIMED enemy debuff abilities.
    // Each application that passes its condition gate draws the landing decision
    // ONCE here (Task 7): 'apply' → lands unless affinity-disadvantaged (no draw);
    // otherwise draws the hacking-vs-security gate. Resisted → the apply is SKIPPED
    // (no status stored), recorded resisted with its would-be duration, and emitted.
    // Landed → emit debuff-applied ONCE at this infliction site (Phase 3 retiming).
    const resistedAbilityTimedEnemy: ActiveBuff[] = [];
    for (const status of timedEnemyBySlot) {
        if (status.sourceSlot !== action) continue;
        if (!conditionsMet(status.conditions, preDebuffGateCtx)) continue;
        if (landsTimedEnemyApplication(status.payload.application)) {
            statusEngine.applyTimedAbilityStatus(r, status, actor.id);
            // Discrete infliction event — emit ONCE at this application site.
            emitDebuffApplied(actor.id, status.payload.buffName);
        } else {
            // status.duration is guaranteed numeric by the timed variant.
            resistedAbilityTimedEnemy.push({
                buffName: status.payload.buffName,
                turnsRemaining: status.duration,
            });
            emitDebuffResisted(status.payload.buffName);
        }
    }

    // Enemy-side ability statuses active this round, split by kind (Task 7):
    //  - TIMED (timedAbilityStatuses): already gated at application above; they
    //    persist their window unconditionally → folded WITHOUT a landing re-roll.
    //  - aura/accumulating (activeAbilityStatuses): conceptually re-applied each
    //    round → KEEP the per-round landing re-roll, with application respected.
    const timedAbilityEnemy = statusEngine.timedAbilityStatuses('enemy', actor.id);
    const recurringAbilityEnemy = statusEngine.activeAbilityStatuses(
        'enemy',
        preDebuffGateCtx,
        actor.id
    );
    const landedAbilityEnemy: ActiveBuff[] = [];
    const resistedAbilityEnemy: ActiveBuff[] = [...resistedAbilityTimedEnemy];
    const abilityEnemyEffects: SelectedGameBuff[] = [];
    // Timed ability statuses: unconditionally landed (gated at application in the timed
    // loop above). NO debuff-applied here — already emitted at the application site above
    // (Phase 3 retiming: discrete-infliction-only, not per-round while the window is active).
    for (const s of timedAbilityEnemy) {
        landedAbilityEnemy.push(s.active);
        abilityEnemyEffects.push(payloadToSelectedBuff(s.payload));
    }
    // Aura/accumulating ability statuses: per-round landing re-roll. No debuff-applied
    // (recurring/aura re-applications are NOT discrete inflictions — Phase 3 retiming).
    for (const s of recurringAbilityEnemy) {
        const sb = payloadToSelectedBuff(s.payload);
        const isApply = sb.application === 'apply';
        const lands = isApply ? !affinityDisadvantage : roundDebuffLanded();
        if (!lands) {
            resistedAbilityEnemy.push(s.active);
            emitDebuffResisted(s.payload.buffName);
            continue;
        }
        landedAbilityEnemy.push(s.active);
        abilityEnemyEffects.push(sb);
    }

    // Combined landed enemy debuffs (scheduled + ability) drive modifiers and counts.
    // Ability entries appended AFTER scheduled (KNOWN-DIFF c ordering).
    const roundEnemyDebuffs = [...scheduledEnemy.roundEnemyDebuffs, ...abilityEnemyEffects];
    const landedEnemyDebuffs = [...scheduledEnemy.landedEnemyDebuffs, ...landedAbilityEnemy];
    // Resisted enemy debuffs sourced from THIS player actor's turn (scheduled + ability).
    // The caller prepends any team-turn resisted entries staged before this turn.
    const resistedEnemyDebuffs = [...scheduledEnemy.resistedEnemyDebuffs, ...resistedAbilityEnemy];
    const { enemyDefenseModifier, incomingDamageModifier } = toEnemyModifiers(roundEnemyDebuffs);

    // (c) Recount with ability debuffs landed → postDebuffGateCtx.
    // (d) Gate + apply this round's firing-skill TIMED self buff abilities vs postDebuffGateCtx.
    const postDebuffGateCtx = buildRoundContext({
        selfBuffNames: [...scheduledSelfBuffNames, ...priorAbilitySelfNames],
        landedEnemyDebuffCount: landedEnemyDebuffs.length,
        corrosionEntryCount: corrosionEntries.length,
        infernoEntryCount: infernoEntries.length,
        bombCount: pendingBombs.length,
        effectiveCritRate: cappedCrit(critBuff),
        enemyType,
        enemyHpPct,
    });
    for (const status of timedSelfBySlot) {
        if (status.sourceSlot !== action) continue;
        if (!conditionsMet(status.conditions, postDebuffGateCtx)) continue;
        statusEngine.applyTimedAbilityStatus(r, status, actor.id);
        bus.emit({
            type: 'buff-applied',
            actorId: actor.id,
            round: r,
            buffName: status.payload.buffName,
            duration: status.duration,
        });
    }

    // (e) Effective self ability statuses this round (timed in-window + auras +
    // accumulating), gated vs postDebuffGateCtx. Fold their payloads into the self totals
    // exactly where scheduled buffs fold (toSimBuffs semantics).
    const selfAbilityStatuses: ActiveAbilityStatus[] = [
        ...statusEngine.timedAbilityStatuses('self', actor.id),
        ...statusEngine.activeAbilityStatuses('self', postDebuffGateCtx, actor.id),
    ];
    const abilitySelfEffects = selfAbilityStatuses.map((s) => payloadToSelectedBuff(s.payload));
    const abilitySelfTotals = calculateBuffTotals(toSimBuffs(abilitySelfEffects));
    attackBuff += abilitySelfTotals.attackBuff;
    critBuff += abilitySelfTotals.critBuff;
    critDamageBuff += abilitySelfTotals.critDamageBuff;
    outgoingDamageBuff += abilitySelfTotals.outgoingDamageBuff;
    defenceBuff += abilitySelfTotals.defenceBuff;
    hpBuff += abilitySelfTotals.hpBuff;

    // (f) Per-round defPen/dot fold from ability-status payloads (KNOWN-DIFF b): these
    // no longer ride the always-on static toDotAndPenModifiers path (the adapter feeds
    // only manual+team buffs there). Self defPen + self Out. DoT apply THIS round. The
    // enemy side ([]) is intentionally empty here — enemy Inc. DoT is already folded via
    // toEnemyDotModifier(roundEnemyDebuffs), which includes abilityEnemyEffects.
    const abilityDotPen = toDotAndPenModifiers(abilitySelfEffects, []);

    // Snapshot lists for this round / context: ability statuses appended AFTER
    // scheduled ones (KNOWN-DIFF c ordering).
    const abilitySelfActive = selfAbilityStatuses.map((s) => s.active);
    const activeSelfBuffsForRound = [...entry.activeSelfBuffs, ...abilitySelfActive];
    // Self-buff names visible to the condition engine (modifiers, payload abilities,
    // both buildRoundContext calls below). Includes ability self statuses now.
    const activeSelfBuffNames = activeSelfBuffsForRound
        .filter((ab) => ab.stacks === undefined || ab.stacks > 0)
        .map((ab) => ab.buffName);

    // Fold active passive modifiers (firing skill + passive slot) into the round's
    // buff totals so they affect damage exactly like an equivalent buff. Folded here,
    // after enemy modifiers are known but before the effective-stat computations consume
    // the buff totals. The PRE-modifier crit estimate (cappedCrit(critBuff)) is used only
    // for the rare self-crit-gated modifier condition, avoiding a self-referential gate.
    const modifierCtx = buildRoundContext({
        selfBuffNames: activeSelfBuffNames,
        landedEnemyDebuffCount: landedEnemyDebuffs.length,
        corrosionEntryCount: corrosionEntries.length,
        infernoEntryCount: infernoEntries.length,
        bombCount: pendingBombs.length,
        effectiveCritRate: cappedCrit(critBuff),
        enemyType,
        enemyHpPct,
    });
    const passiveSkill = shipSkills.slots.find((s) => s.slot === 'passive');
    const modifierAbilities = [
        ...(firingSkill?.abilities ?? []),
        ...(passiveSkill?.abilities ?? []),
    ];
    const modTotals = modifierTotalsFromAbilities(modifierAbilities, modifierCtx);
    attackBuff += modTotals.attack;
    critBuff += modTotals.crit;
    critDamageBuff += modTotals.critDamage;
    outgoingDamageBuff += modTotals.outgoingDamage;
    defenceBuff += modTotals.defence;
    hpBuff += modTotals.hp;

    const effectiveAttack = attack * (1 + attackBuff / 100);
    const effectiveCrit = cappedCrit(critBuff);
    const effectiveCritDamage = critDamage + critDamageBuff;
    // This round's binary crit outcome. A noCrit attack cannot crit and consumes
    // no crit chance (the gate does not advance). Decided AFTER the modifier
    // fold-in so the schedule uses the final effective crit rate; modifierCtx
    // above deliberately keeps the probability-based estimate (see spec).
    const roundCrit = damageNoCrit
        ? false
        : (action === 'charged' ? chargedCritGate : activeCritGate)(effectiveCrit / 100);
    const effectivePen =
        defensePenetration +
        defensePenetrationBuff +
        modTotals.defensePenetration +
        abilityDotPen.defensePenetrationBuff;
    const effectiveDefense =
        enemyDefense * (1 + enemyDefenseModifier / 100) * (1 - effectivePen / 100);
    const damageReduction = effectiveDefense > 0 ? calculateDamageReduction(effectiveDefense) : 0;

    // Step 1: Calculate direct damage
    const enemyDotMod = toEnemyDotModifier(roundEnemyDebuffs);
    // Ability-status self Out. DoT folds in per-round (KNOWN-DIFF b). Enemy Inc. DoT is
    // already inside enemyDotMod (roundEnemyDebuffs includes abilityEnemyEffects).
    const dotMult = 1 + (selfDotModifier + enemyDotMod + abilityDotPen.dotDamageModifier) / 100;
    const affinityMult = 1 + affinityDamageModifier / 100;
    const effectiveDefence = defence * (1 + defenceBuff / 100);
    const effectiveHp = hp * (1 + hpBuff / 100);

    // Per-round condition context for the Phase 1 condition engine. Built once
    // after landedEnemyDebuffs and effectiveCrit are known, but BEFORE Step 3
    // applies this round's fresh DoTs — so derivable counts read pre-Step-3 state,
    // matching the prior inline behaviour.
    const ctx = buildRoundContext({
        selfBuffNames: activeSelfBuffNames,
        landedEnemyDebuffCount: landedEnemyDebuffs.length,
        corrosionEntryCount: corrosionEntries.length,
        infernoEntryCount: infernoEntries.length,
        bombCount: pendingBombs.length,
        effectiveCritRate: effectiveCrit,
        enemyType,
        roundCrit,
        enemyHpPct,
    });

    // Hard gate: payload abilities whose conditions fail contribute nothing this
    // round. Walked in text order with a same-cast DoT overlay (see applyAbilities).
    const { gatedSkill, ctxFor } = gateFiringAbilities(firingSkill, ctx);
    const { multiplier: rawMultiplier, hits, scalingAbility } = damageInputsFromSkill(gatedSkill);
    const effectiveMultiplier = rawMultiplier * hits;
    const secondary = secondaryFromSkill(gatedSkill);
    const dotsConfig = dotsFromSkill(gatedSkill);

    let secondaryStatValue = 0;
    if (secondary) {
        const source = secondary.stat === 'defense' ? effectiveDefence : effectiveHp;
        secondaryStatValue = source * (secondary.pct / 100);
    }

    // Conditional scaling bonus, folded additively into the skill multiplier.
    // Read from the firing skill's damage ability's own scaling rule. Derivable
    // conditions read this round's sim state (pre-Step-3 DoT arrays, so this
    // round's freshly-applied DoTs are not yet counted); manual conditions use
    // a static count. Threads the POSITIONAL context (ctxFor) so a damage ability
    // AFTER a same-cast dot scales with the fresh dot counted.
    const conditionalBonusPct = scalingAbility
        ? scaledBonus(scalingAbility, ctxFor.get(scalingAbility.id) ?? ctx)
        : 0;

    // Passive payload hit (Judge: "At the start of the round, this Unit deals 60%
    // damage to all enemies with less than 50% HP"). The always-active passive slot
    // can carry a gated damage ability; gate it per round against the same ctx and
    // add the passing hit as an extra damage instance. "Start of the round" matches
    // the entering-round enemyHpPct the gate evaluates. Uses the round's crit
    // outcome and defense math like the firing hit; its own noCrit is respected.
    const { gatedSkill: gatedPassive, ctxFor: passiveCtxFor } = gateFiringAbilities(
        passiveSkill,
        ctx
    );
    const passiveHit = damageInputsFromSkill(gatedPassive);
    const passiveScalingBonus = passiveHit.scalingAbility
        ? scaledBonus(
              passiveHit.scalingAbility,
              passiveCtxFor.get(passiveHit.scalingAbility.id) ?? ctx
          )
        : 0;
    const passiveMultiplier = passiveHit.multiplier * passiveHit.hits + passiveScalingBonus;

    // Charge manipulation: charges only accumulate on ACTIVE rounds. A charged
    // round fires the charged skill, which consumes all charges (reset to 0 at
    // the top of the loop) — nothing banks toward the next charge on that round.
    // Sourced from the firing skill AND the always-active passive slot (charge
    // auras: Hermes/Asphodel/Hemlock/Oleander/Cobalt) — both pre-gated by
    // gateFiringAbilities with their positional contexts. Self + ally gains are
    // added here and the total is capped at chargeCount, since charges never
    // exceed what the charged skill requires.
    if (hasChargedSkill && action === 'active') {
        const bonusCharges =
            chargeGainFromSkill({ gatedSkill, ctxFor, fallbackCtx: ctx }) +
            chargeGainFromSkill({
                gatedSkill: gatedPassive,
                ctxFor: passiveCtxFor,
                fallbackCtx: ctx,
            });
        actor.charges = Math.min(
            actor.charges + bonusCharges + (allyChargePerRound ?? 0),
            chargeCount
        );
    }

    const preCritDamage =
        effectiveAttack * ((effectiveMultiplier + conditionalBonusPct) / 100) + secondaryStatValue;
    // A "cannot critically hit" attack forces roundCrit false (decided at the gate),
    // so this multiplier alone carries the crit effect.
    const damageCritMultiplier = roundCrit ? 1 + effectiveCritDamage / 100 : 1;
    // Crit-independent damage pipeline (defense, outgoing/incoming, affinity) — shared
    // by the firing hit and the passive hit, which may differ in crit treatment (noCrit).
    const nonCritFactor =
        (1 - damageReduction / 100) *
        (1 + outgoingDamageBuff / 100) *
        (1 + incomingDamageModifier / 100) *
        affinityMult;
    const postDefenseFactor = damageCritMultiplier * nonCritFactor;
    const passiveCritMultiplier = passiveHit.noCrit ? 1 : damageCritMultiplier;
    const passiveDamage =
        effectiveAttack * (passiveMultiplier / 100) * passiveCritMultiplier * nonCritFactor;
    const directDamage = preCritDamage * postDefenseFactor + passiveDamage;
    const secondaryDamage = secondaryStatValue * postDefenseFactor;
    const conditionalDamage = effectiveAttack * (conditionalBonusPct / 100) * postDefenseFactor;

    // ability-performed: ONE event for the firing damage hit, full directDamage.
    bus.emit({
        type: 'ability-performed',
        actorId: actor.id,
        targetId: enemy.id,
        round: r,
        abilityType: 'damage',
        damage: directDamage,
        didCrit: roundCrit,
        didHit: true,
    });

    extendDoTs({
        abilities: [...(firingSkill?.abilities ?? []), ...(passiveSkill?.abilities ?? [])],
        ctx,
        effectiveCritDamage,
        extendChanceGate,
        corrosionEntries,
        infernoEntries,
    });

    // += (not =): with a FASTER enemy, the enemy's bomb/accumulator bursts
    // run earlier in the round — a plain assignment would clobber them.
    // Identical at default order (the accumulator resets to 0 each round).
    // This is the player-turn portion; the caller folds it into the round
    // accumulator's detonationDamage with += (the enemy turn may have already
    // added bursts this round at a faster speed).
    const detonationDamage = detonate({
        gatedSkill,
        effectiveAttack,
        enemyHp,
        dotMult,
        affinityMult,
        corrosionEntries,
        infernoEntries,
        pendingBombs,
        emitBombDetonated: (stacks, damage) =>
            bus.emit({ type: 'bomb-detonated', actorId: actor.id, round: r, stacks, damage }),
    });

    // Step 3: Apply new DoT stacks from this round's skill (subject to landing roll).
    // DoTs gate at application: draw the shared per-round roll only when there are
    // DoTs to apply this round (memoized — shares the recurring partition's single
    // draw). With nothing to apply, dotsLanded is vacuously true (no draw taken),
    // preserving the all-landing fixtures where no-DoT rounds report dotsLanded:true.
    const dotsLanded = dotsConfig.length > 0 ? roundDebuffLanded() : true;
    // Capture pre-application lengths so 'inflicted'-scope extensions touch only
    // the entries this cast adds below (the slice from these indices onward).
    const corrosionEntriesBefore = corrosionEntries.length;
    const infernoEntriesBefore = infernoEntries.length;
    if (dotsLanded) {
        applyNewDoTs({
            dotsConfig,
            effectiveAttack,
            corrosionEntries,
            infernoEntries,
            pendingBombs,
            emitDotApplied: (dotType, stacks) =>
                bus.emit({
                    type: 'dot-applied',
                    sourceId: actor.id,
                    targetId: enemy.id,
                    round: r,
                    dotType,
                    stacks,
                }),
        });
    }

    // Step 3a: 'inflicted'-scope extensions grow ONLY this cast's new DoTs
    // (Valerian). Sourced from the same firing+passive ability set as Step 2.9.
    // Guarded by dotsLanded (like applyNewDoTs/applyAccumulators): when the
    // landing roll failed nothing was appended, and skipping the call keeps
    // the deterministic extendChanceGate schedule free of phantom draws.
    if (dotsLanded) {
        extendInflictedDoTs({
            abilities: [...(firingSkill?.abilities ?? []), ...(passiveSkill?.abilities ?? [])],
            ctx,
            effectiveCritDamage,
            extendChanceGate,
            corrosionEntries,
            infernoEntries,
            corrosionEntriesBefore,
            infernoEntriesBefore,
        });
    }

    if (dotsLanded) {
        applyAccumulators({ gatedSkill, pendingAccumulators });
    }

    // Display-only: surface pending accumulate-detonate effects (Echoing Burst — the only
    // such effect the parser emits; the ability config carries no name) in the round's
    // debuff list with their countdown. Appended AFTER the gate contexts are built and
    // after Step 3b, so they never feed enemy-debuff counts or any fold — the accumulator
    // mechanics are entirely separate (pendingAccumulators on the enemy actor).
    // Placement safety: all three buildRoundContext calls (preDebuffGateCtx, postDebuffGateCtx,
    // modifierCtx) consumed landedEnemyDebuffs.length BEFORE this point; no subsequent fold
    // reads the list after the return, so appending here is purely additive display data.
    for (const acc of pendingAccumulators) {
        landedEnemyDebuffs.push({ buffName: 'Echoing Burst', turnsRemaining: acc.roundsRemaining });
    }

    // Round-scoped context the enemy's DoT-processing turn needs. With a faster enemy
    // the enemy reads the PREVIOUS round's context; at default speeds the attacker
    // always precedes the enemy. The caller stores this as lastAttackerCtx.
    const attackerCtx: PlayerRoundCtx = { effectiveAttack, dotMult, affinityMult, directDamage };

    return {
        action,
        roundCrit,
        enemyHpPct,
        dotsConfig,
        dotsLanded,
        activeSelfBuffs: activeSelfBuffsForRound,
        landedEnemyDebuffs,
        resistedEnemyDebuffs,
        directDamage,
        secondaryDamage,
        conditionalDamage,
        detonationDamage,
        attackerCtx,
    };
}
