import { calculateDamageReduction } from '../autogear/priorityScore';
import { evaluateCondition, scaledBonus, conditionsMet } from '../abilities/evaluateConditions';
import { buildRoundContext } from '../abilities/roundContext';
import {
    Buff,
    DoTApplicationConfig,
    EnemyBaseClass,
    SelectedGameBuff,
    TeamActorInput,
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
import { makeRateGate } from '../calculators/rateAccumulator';
import {
    toSimBuffs,
    toEnemyModifiers,
    toEnemyDotModifier,
    toDotAndPenModifiers,
} from '../calculators/dpsBuffHelpers';
import type { RoundData } from '../calculators/dpsSimulator';
import {
    ActiveDoTStack,
    PendingAccumulator,
    PendingBomb,
    createActor,
    buildTurnQueue,
} from './state';
import {
    ActiveBuff,
    AbilityStatusPayload,
    ActiveAbilityStatus,
    RegisteredAbilityStatus,
    createStatusEngine,
} from './statusEngine';
import { liveGateConditions } from './abilityStatusGating';
import { CombatEventBus } from './events';

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

// Synthesize resisted ActiveBuff rows from rejected TIMED enemy upsert names: each
// carries its would-be duration (the buff's numeric skillDuration) and emits a
// debuff-resisted tap. Shared by the attacker and team turns (both upsert timed enemy
// debuffs through the status engine's landing hook). The `: 1` fallback is unreachable
// today (only numeric-skillDuration buffs enter the timed resist path) — kept safe.
function synthesizeResisted(
    names: string[],
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>,
    emitResisted: (buffName: string) => void
): ActiveBuff[] {
    return names.map((buffName) => {
        emitResisted(buffName);
        const lookup = enemyDebuffLookup.get(buffName) ?? [];
        const dur = lookup.find((b) => typeof b.skillDuration === 'number')?.skillDuration;
        return { buffName, turnsRemaining: typeof dur === 'number' ? dur : 1 };
    });
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

function tickDoTStacks(entries: ActiveDoTStack[], baseValue: number): number {
    return entries.reduce((sum, e) => sum + e.stacks * (e.tier / 100) * baseValue, 0);
}

function totalStacks(entries: ActiveDoTStack[]): number {
    return entries.reduce((sum, e) => sum + e.stacks, 0);
}

function expireStacks(entries: ActiveDoTStack[]): void {
    for (let i = entries.length - 1; i >= 0; i--) {
        entries[i].remainingRounds -= 1;
        if (entries[i].remainingRounds <= 0) {
            entries.splice(i, 1);
        }
    }
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
function resolveEnemyDebuffs(args: {
    activeEnemyDebuffs: ActiveBuff[];
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>;
    affinityDisadvantage: boolean;
    roundDebuffLanded: () => boolean;
    emitResisted: (buffName: string) => void;
    emitApplied: (buffName: string) => void;
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
        args.emitApplied(ab.buffName);
        return expandBuffs(ab, bufs);
    });
    return { roundEnemyDebuffs, landedEnemyDebuffs, resistedEnemyDebuffs };
}

// Per-round fold for TIMED scheduled enemy statuses currently in the status map. They
// drew their landing roll ONCE at application (status-engine hook) and persist their full
// window with no re-roll, so here they are unconditionally landed: expand their effects
// and report them as landed. No gate draw, no resist partition. NOTE: emitApplied fires
// every round the status is ACTIVE (matching the pre-Phase-2 per-round semantics of
// `debuff-applied`), not just on the first-landing round — revisit if a listener ever
// needs first-application-only (e.g. a `debuff-persisted` distinction in Phase 3).
function foldTimedEnemyDebuffs(args: {
    timedEnemyDebuffs: ActiveBuff[];
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>;
    emitApplied: (buffName: string) => void;
}): { roundEnemyDebuffs: SelectedGameBuff[]; landedEnemyDebuffs: ActiveBuff[] } {
    const landedEnemyDebuffs: ActiveBuff[] = [];
    const roundEnemyDebuffs = args.timedEnemyDebuffs.flatMap((ab) => {
        const bufs = args.enemyDebuffLookup.get(ab.buffName) ?? [];
        landedEnemyDebuffs.push(ab);
        args.emitApplied(ab.buffName);
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
function detonate(args: {
    gatedSkill: Skill | undefined;
    effectiveAttack: number;
    enemyHp: number;
    dotMult: number;
    affinityMult: number;
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    pendingBombs: PendingBomb[];
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
            detonationDamage +=
                args.pendingBombs.reduce((sum, b) => sum + b.stacks * b.damagePerStack, 0) *
                args.affinityMult *
                pct;
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

// Step 6: Process bombs — their burst is detonation damage (same category as Step 2.95).
function processBombs(args: { pendingBombs: PendingBomb[]; affinityMult: number }): number {
    let bombBurst = 0;
    for (let i = args.pendingBombs.length - 1; i >= 0; i--) {
        args.pendingBombs[i].countdown -= 1;
        if (args.pendingBombs[i].countdown <= 0) {
            bombBurst += args.pendingBombs[i].stacks * args.pendingBombs[i].damagePerStack;
            args.pendingBombs.splice(i, 1);
        }
    }
    return bombBurst * args.affinityMult;
}

// Step 6b: Echoing Burst accumulators gather this round's direct damage, then detonate
// for pct% of the accumulated total on expiry (game-categorised as detonation damage).
// directDamage already includes affinity, so no extra affinity multiplier is applied.
function processAccumulators(args: {
    pendingAccumulators: PendingAccumulator[];
    directDamage: number;
}): number {
    let accumulatorBurst = 0;
    for (let i = args.pendingAccumulators.length - 1; i >= 0; i--) {
        args.pendingAccumulators[i].accumulated += args.directDamage;
        args.pendingAccumulators[i].roundsRemaining -= 1;
        if (args.pendingAccumulators[i].roundsRemaining <= 0) {
            accumulatorBurst +=
                args.pendingAccumulators[i].accumulated * (args.pendingAccumulators[i].pct / 100);
            args.pendingAccumulators.splice(i, 1);
        }
    }
    return accumulatorBurst;
}

// Steps 4 & 5: Tick corrosion (scales with enemy HP, capped at 5000 dmg per 1%) and
// inferno (scales with the attacker's effective attack, no outgoing buff), then expire
// both stack sets. Returns the two per-round tick totals.
function tickDoTs(args: {
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    enemyHp: number;
    effectiveAttack: number;
    dotMult: number;
    affinityMult: number;
    emitTicked: (dotType: 'corrosion' | 'inferno', damage: number) => void;
}): { corrosionDamage: number; infernoDamage: number } {
    // Step 4: Tick corrosion (scales with enemy HP, capped at 5000 dmg per 1%)
    const corrosionBaseHp = Math.min(args.enemyHp, 500_000);
    const corrosionDamage =
        tickDoTStacks(args.corrosionEntries, corrosionBaseHp) * args.dotMult * args.affinityMult;
    if (corrosionDamage > 0) {
        args.emitTicked('corrosion', corrosionDamage);
    }

    // Step 5: Tick inferno (scales with attacker's effective attack, no outgoing buff)
    const infernoDamage =
        tickDoTStacks(args.infernoEntries, args.effectiveAttack) * args.dotMult * args.affinityMult;
    if (infernoDamage > 0) {
        args.emitTicked('inferno', infernoDamage);
    }

    // Expire DoT stacks after ticking
    expireStacks(args.corrosionEntries);
    expireStacks(args.infernoEntries);

    return { corrosionDamage, infernoDamage };
}

// Round-scoped context the enemy's DoT processing needs from the attacker's turn.
// At default speeds the attacker acts first, so the enemy's tick uses THIS round's
// context (identical to the pre-restructure behaviour). For a FASTER enemy it is the
// PREVIOUS round's context; only in that case is round 1 undefined (the enemy acts
// before any attacker turn — containers necessarily empty, processing skipped).
interface AttackerRoundCtx {
    effectiveAttack: number;
    dotMult: number;
    affinityMult: number;
    /** The attacker turn's directDamage — consumed by processAccumulators. With a
     *  FASTER enemy this is the PREVIOUS round's value (the accumulator gathers the
     *  last direct hit dealt before its countdown step) — a documented approximation
     *  in the fast-enemy KNOWN-DIFF; no golden fixture combines the two. */
    directDamage: number;
}

export interface CombatEngineInput {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    chargeCount: number;
    shipSkills: ShipSkills;
    enemyDefense: number;
    enemyHp: number;
    numRounds: number;
    /** Scheduled (manual + team) buffs — statusEngine input. */
    selfBuffs: SelectedGameBuff[];
    enemyDebuffs: SelectedGameBuff[];
    /** Team ships as real speed-ordered actors (Phase 2). Their buff lists are keyed to
     *  their own turns via the status engine's teamSources, NOT merged into selfBuffs/
     *  enemyDebuffs (no-double-count). */
    teamActors?: TeamActorInput[];
    // Rate/fold fields below (debuffLandingChance, selfDotModifier, defensePenetrationBuff)
    // are pre-derived by the adapter (simulateDPS) — pass the resolved values, not raw hacking.
    debuffLandingChance: number;
    selfDotModifier: number;
    defensePenetrationBuff: number;
    hasChargedSkill: boolean;
    startCharged: boolean;
    affinityDamageModifier: number;
    affinityCritCap: number;
    affinityCritPenalty: number;
    defence: number;
    hp: number;
    allyChargePerRound?: number;
    enemyType?: EnemyBaseClass;
    /** Attacker turn-order speed. Default 100. */
    speed?: number;
    /** Enemy turn-order speed. Default 50 — the enemy acts last at default speeds. */
    enemySpeed?: number;
    /** Emit-only event tap. Listeners must not read or mutate combat state. */
    bus?: CombatEventBus;
}

/**
 * The combat-engine turn loop (combat-system.md §10). Each round builds a turn queue
 * (buildTurnQueue, speed-ordered) and every actor takes one turn: the attacker (default
 * speed 100) runs the full damage/buff/DoT-application pipeline; the enemy (default
 * speed 50) ticks the DoT containers it carries (DoTs tick at the start of the
 * afflicted ship's turn). When enemySpeed > speed the order inverts — the enemy acts
 * before the attacker, deferring round-1 DoT ticks to round 2. The round's RoundData
 * row is assembled after all turns. At default speeds the attacker always precedes the
 * enemy, making this a byte-identical relocation of the old single-block round —
 * events are write-only taps that never read or change a sim value.
 */
export function runCombat(input: CombatEngineInput): {
    rounds: RoundData[];
    rawTotals: {
        direct: number;
        corrosion: number;
        inferno: number;
        detonation: number;
        cumulative: number;
        totalSecondary: number;
        totalConditional: number;
    };
} {
    const {
        attack,
        crit,
        critDamage,
        defensePenetration,
        chargeCount,
        shipSkills,
        enemyDefense,
        enemyHp,
        numRounds,
        selfBuffs,
        enemyDebuffs,
        teamActors = [],
        debuffLandingChance,
        selfDotModifier,
        defensePenetrationBuff,
        hasChargedSkill,
        startCharged,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        defence,
        hp,
        allyChargePerRound,
        enemyType,
        speed,
        enemySpeed,
        bus,
    } = input;

    // Actors. The attacker (default speed 100) takes the first turn each round; the enemy
    // (default speed 50) takes the second turn and holds the DoT containers (previously
    // loop-locals) it ticks on its turn. Speeds are configurable via the speed/enemySpeed
    // inputs — a faster enemy (enemySpeed > attacker speed) inverts the turn order, which
    // delays the first DoT tick to round 2 (the enemy acts before the attacker's first
    // DoT application, so lastAttackerCtx is undefined on the enemy's round-1 turn).
    const attacker = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: { attack, crit, critDamage, defensePenetration, defence, hp, speed: speed ?? 100 },
    });
    const enemy = createActor({
        id: 'enemy',
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: enemyDefense,
            hp: enemyHp,
            speed: enemySpeed ?? 50,
        },
    });

    // Team actors (Phase 2). Real speed-ordered actors carrying their own charge cadence;
    // they deal no damage and hold no DoTs/statuses (their buff grants sit on the attacker/
    // enemy via the status engine's per-source timed sets). Dummy combat stats keep the
    // shared ActorStats shape; only `speed` (turn order) and chargeCount/startCharged matter.
    const teamCombatActors = teamActors.map((t) =>
        createActor({
            id: t.id,
            side: 'player',
            kind: 'team',
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                defence: 0,
                hp: 1,
                speed: t.speed,
            },
            chargeCount: t.chargeCount,
            startCharged: t.startCharged,
        })
    );

    // Deterministic event gates — replace Math.random / expected-value math so
    // identical inputs always produce identical output. Crit uses one gate PER
    // ACTION STREAM so the charged hit crits at exactly the crit rate regardless
    // of how the charge cadence aligns with the crit schedule (no aliasing).
    // Declared BEFORE the status engine so the landing hook can close over the
    // debuff-landing gate (Task 7 — timed enemy applications draw it once).
    const activeCritGate = makeRateGate();
    const chargedCritGate = makeRateGate();
    const debuffLandingGate = makeRateGate();
    const extendChanceGate = makeRateGate();

    // Affinity-based ('apply') debuffs always hit EXCEPT at an affinity disadvantage,
    // where they are resisted (combat-system.md hit-check). affinityDamageModifier is
    // -25 only on a disadvantage matchup. Constant for the whole run.
    const affinityDisadvantage = affinityDamageModifier < 0;

    // Landing decision for a TIMED enemy application (drawn ONCE at application time):
    // 'apply' (affinity-based) → lands unless at an affinity disadvantage, no gate draw;
    // 'inflict' (and unmarked) → draws the hacking-vs-security landing gate. Threaded
    // into the status engine for scheduled timed enemy upserts (sourceFired) and reused
    // by the engine for ability-sourced timed enemy applications below.
    const landsTimedEnemyApplication = (application?: 'inflict' | 'apply'): boolean =>
        application === 'apply' ? !affinityDisadvantage : debuffLandingGate(debuffLandingChance);

    // Incremental status machine — replaces the precomputed computeBuffTimeline array.
    const statusEngine = createStatusEngine({
        selfBuffs,
        enemyDebuffs,
        // Team actors' buff lists keyed to their own turns (per-source timed sets).
        teamSources: teamActors.map((t) => ({
            sourceId: t.id,
            selfBuffs: t.selfBuffs,
            enemyDebuffs: t.enemyDebuffs,
        })),
        landsTimedEnemyApplication: (buff) => landsTimedEnemyApplication(buff.application),
    });

    // Register the attacker's own buff/debuff abilities for in-loop application with
    // live condition gating (Task 6). These flow from ShipSkills directly — the page
    // no longer feeds the converted SelectedGameBuff arrays into the sim (no-double-count).
    // Classification (spec): accumulating (stackTrigger && isStackable) → accumulating
    // maps, effect inclusion aura-gated; aura (recurring/undefined duration OR passive
    // slot) → per-round effect gate; timed (finite duration) → gated at application.
    // Routing mirrors buffAbilitiesToSelectedBuffs: enemy/all-enemies → enemy side.
    const registeredAbilityStatuses: RegisteredAbilityStatus[] = [];
    // Timed ability statuses indexed by source slot, applied when that slot fires.
    // Narrowed to the timed variant — duration is guaranteed numeric on this type.
    const timedSelfBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[] = [];
    const timedEnemyBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[] = [];
    for (const slot of shipSkills.slots) {
        for (const ability of slot.abilities) {
            const cfg = ability.config;
            if (cfg.type !== 'buff' && cfg.type !== 'debuff') continue;
            const side: 'self' | 'enemy' =
                ability.target === 'enemy' || ability.target === 'all-enemies' ? 'enemy' : 'self';
            const accumulating = !!cfg.stackTrigger && cfg.isStackable;
            const isAura =
                !accumulating &&
                (cfg.duration === 'recurring' ||
                    cfg.duration === undefined ||
                    slot.slot === 'passive');
            const payload: AbilityStatusPayload = {
                buffName: cfg.buffName,
                stacks: cfg.stacks,
                parsedEffects: cfg.parsedEffects,
                ...(cfg.type === 'debuff' ? { application: cfg.application } : {}),
            };
            // `as const` keeps the literal types (side, sourceSlot) so the spread into
            // a union variant below doesn't widen them — runtime object is unchanged.
            const base = {
                payload,
                side,
                sourceSlot: slot.slot,
                conditions: liveGateConditions(ability.conditions),
            } as const;
            let status: RegisteredAbilityStatus;
            if (accumulating) {
                // accumulating: stackTrigger is required and non-optional on this variant.
                status = {
                    ...base,
                    kind: 'accumulating',
                    stackTrigger: cfg.stackTrigger!,
                    maxStacks: cfg.maxStacks,
                };
            } else if (isAura) {
                status = { ...base, kind: 'aura' };
            } else {
                // timed: cfg.duration is a number here (NOT accumulating, NOT aura — i.e.
                // not recurring/undefined duration and not a passive slot). The classification
                // branches above exhaustively exclude non-numeric durations from reaching this arm.
                status = { ...base, kind: 'timed', duration: cfg.duration as number };
                (side === 'self' ? timedSelfBySlot : timedEnemyBySlot).push(status);
            }
            registeredAbilityStatuses.push(status);
        }
    }
    statusEngine.registerAbilityStatuses(registeredAbilityStatuses);

    // Lookup maps (moved from simulateDPS) — expand the snapshot's buff names back
    // into the underlying SelectedGameBuff effects.
    // Include team-actor buffs: their snapshot entries (applied on team turns) must
    // expand back to their underlying effects exactly like attacker-scheduled ones.
    const selfBuffLookup = new Map<string, SelectedGameBuff[]>();
    for (const b of [...selfBuffs, ...teamActors.flatMap((t) => t.selfBuffs)]) {
        const existing = selfBuffLookup.get(b.buffName) ?? [];
        selfBuffLookup.set(b.buffName, [...existing, b]);
    }
    const enemyDebuffLookup = new Map<string, SelectedGameBuff[]>();
    for (const b of [...enemyDebuffs, ...teamActors.flatMap((t) => t.enemyDebuffs)]) {
        const existing = enemyDebuffLookup.get(b.buffName) ?? [];
        enemyDebuffLookup.set(b.buffName, [...existing, b]);
    }

    // All mutable state declared fresh on every call
    let charges = startCharged ? chargeCount : 0;
    let cumulativeDamage = 0;
    let totalDirectRaw = 0;
    let totalCorrosionRaw = 0;
    let totalInfernoRaw = 0;
    let totalDetonationRaw = 0;
    let totalSecondaryRaw = 0;
    let totalConditionalRaw = 0;
    // DoT containers live on the enemy actor (were loop-locals in runSinglePass).
    const corrosionEntries = enemy.corrosionEntries;
    const infernoEntries = enemy.infernoEntries;
    const pendingBombs = enemy.pendingBombs;
    const pendingAccumulators = enemy.pendingAccumulators;
    // hp-changed / ship-destroyed event tracking (emission-only, no sim effect).
    let lastEnemyHpPctInt = 100;
    let destroyedEmitted = false;

    const roundData: RoundData[] = [];

    // Round-scoped context the enemy's DoT processing reads from the attacker's turn.
    // Set at the end of every attacker turn (see AttackerRoundCtx). Only undefined
    // when the enemy acts before the attacker has EVER acted (faster-enemy round 1).
    let lastAttackerCtx: AttackerRoundCtx | undefined;

    for (let r = 1; r <= numRounds; r++) {
        // Advance the status engine's round counter (per-round accumulating stacks
        // tick here, before any turn fires). Sources notify via sourceFired in turn.
        statusEngine.beginRound(r);

        // Team actors listed BEFORE the attacker so the input-order tiebreak yields
        // team → attacker → enemy at equal speeds (buildTurnQueue requirement).
        const queue = buildTurnQueue([...teamCombatActors, attacker, enemy]);

        // --- Round-scoped accumulators / row fields, shared by the turn blocks and the
        // post-round assembly. Numeric damage accumulators reset to 0 each round; the
        // attacker-only row fields are definite-assigned in the attacker block (the
        // attacker acts every round). ---
        let corrosionDamage = 0;
        let infernoDamage = 0;
        let detonationDamage = 0;
        let directDamage = 0;
        let secondaryDamage = 0;
        let conditionalDamage = 0;
        // Attacker-only row fields (definite-assigned in the attacker block).
        let action!: 'active' | 'charged';
        let roundCrit!: boolean;
        let enemyHpPct!: number;
        let dotsConfig!: ReturnType<typeof dotsFromSkill>;
        let dotsLanded!: boolean;
        let activeSelfBuffsForRound!: ActiveBuff[];
        let landedEnemyDebuffs!: ActiveBuff[];
        let resistedEnemyDebuffs!: ActiveBuff[];
        // Explicit flag used to split team-turn resisted entries into two destinations:
        //  FASTER team actors (before the attacker) → teamResistedEnemyDebuffs, folded
        //  into the row by the attacker block once it runs.
        //  SLOWER team actors (after the attacker) → append directly to the live row
        //  list (resistedEnemyDebuffs already assigned by the attacker block).
        // Using a boolean flag instead of checking `resistedEnemyDebuffs !== undefined`
        // makes the invariant explicit and immune to accidental `= []` initializations.
        let attackerHasActed = false;
        // Team-turn resisted enemy applications recorded BEFORE the attacker (faster team
        // actors); folded into the row's resistedEnemyDebuffs by the attacker block.
        const teamResistedEnemyDebuffs: ActiveBuff[] = [];

        for (const actor of queue) {
            bus?.emit({ type: 'turn-started', actorId: actor.id, round: r });

            if (actor.kind === 'attacker') {
                // ====================================================================
                // ATTACKER TURN — the old attacker block, minus the DoT-processing
                // calls (tickDoTs / processBombs / processAccumulators), which move to
                // the enemy turn. Math is byte-identical; only the DoT block relocated.
                // ====================================================================

                // --- preTurn: action selection + charge consumption (old lines 263-273) ---
                if (hasChargedSkill && charges >= chargeCount) {
                    action = 'charged';
                    charges = 0;
                } else {
                    action = 'active';
                    if (hasChargedSkill) {
                        charges += 1;
                    }
                }

                bus?.emit({ type: 'skill-fired', actorId: actor.id, round: r, slot: action });

                // Enemy HP% entering this round, derived from damage dealt so far. Floors at 0
                // once cumulative damage exceeds the pool (the sim keeps hitting the "dead" dummy).
                enemyHpPct =
                    enemyHp > 0 ? Math.max(0, 100 * (1 - cumulativeDamage / enemyHp)) : 100;

                const firingSkill = selectFiringSkill(shipSkills, action);
                // noCrit is read from the UNGATED skill: the flag is a property of the attack
                // itself and must be known before the ctx (and therefore the gate) exists.
                // Assumes one base-damage ability per skill (true for all parser output); a
                // gated-off first damage ability with a differently-flagged second one would
                // read the wrong flag — not representable from skill text today.
                const damageNoCrit = damageInputsFromSkill(firingSkill).noCrit;

                // Per-round buff totals from the status engine. The attacker notifies the
                // engine of its REAL fired slot this round (action-fed: scheduled timed
                // buffs key off the actual cadence, not a predicted schedule), then we read
                // the snapshot. No decrement here — that lives in each owner's Post Turn
                // (statusEngine.decrementSide, called after this actor's turn block).
                // sourceFired returns the buffNames of any TIMED enemy applications the
                // landing hook rejected this round (drawn once at application — Task 7).
                const { resistedEnemy: resistedScheduledTimedNames } = statusEngine.sourceFired(
                    'attacker',
                    action === 'charged' ? 'charge' : 'active',
                    r
                );
                const entry = statusEngine.snapshot();

                // Effective crit rate from a given crit-buff total, clamped by affinity.
                const cappedCrit = (critBuffTotal: number) =>
                    Math.min(
                        affinityCritCap,
                        Math.max(0, crit + critBuffTotal - affinityCritPenalty)
                    );

                // --- Scheduled (manual + team) statuses: same path as before ---
                // Scheduled self-buff names + totals.
                const scheduledSelfBuffNames = entry.activeSelfBuffs
                    .filter((ab) => ab.stacks === undefined || ab.stacks > 0)
                    .map((ab) => ab.buffName);
                let {
                    attackBuff,
                    critBuff,
                    critDamageBuff,
                    outgoingDamageBuff,
                    defenceBuff,
                    hpBuff,
                } = resolveSelfBuffTotals({
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

                const emitDebuffResisted = (buffName: string) =>
                    bus?.emit({ type: 'debuff-resisted', targetId: enemy.id, round: r, buffName });
                const emitDebuffApplied = (buffName: string) =>
                    bus?.emit({ type: 'debuff-applied', targetId: enemy.id, round: r, buffName });

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
                    emitApplied: emitDebuffApplied,
                });
                const timedScheduledEnemy = foldTimedEnemyDebuffs({
                    timedEnemyDebuffs: timedEnemySnap,
                    enemyDebuffLookup,
                    emitApplied: emitDebuffApplied,
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
                    resistedEnemyDebuffs: [
                        ...recurringEnemy.resistedEnemyDebuffs,
                        ...resistedScheduledTimed,
                    ],
                };

                // --- In-loop ability statuses with live condition gating (Task 6) ---
                // Single forward pass (spec determinism rule): build a pre-application gate
                // context → gate+apply this round's TIMED enemy debuffs → recount → gate+apply
                // TIMED self buffs → collect effective ability statuses and fold their payloads
                // exactly where scheduled buffs fold.

                // "Already active" ability self statuses (window-persisting timed + accumulated)
                // are visible to the gate; auras are gated themselves, so they don't pre-seed names.
                const priorAbilitySelfNames = statusEngine
                    .timedAbilityStatuses('self')
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
                const resistedAbilityTimedEnemy: ActiveBuff[] = [];
                for (const status of timedEnemyBySlot) {
                    if (status.sourceSlot !== action) continue;
                    if (!conditionsMet(status.conditions, preDebuffGateCtx)) continue;
                    if (landsTimedEnemyApplication(status.payload.application)) {
                        statusEngine.applyTimedAbilityStatus(r, status);
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
                const timedAbilityEnemy = statusEngine.timedAbilityStatuses('enemy');
                const recurringAbilityEnemy = statusEngine.activeAbilityStatuses(
                    'enemy',
                    preDebuffGateCtx
                );
                const landedAbilityEnemy: ActiveBuff[] = [];
                const resistedAbilityEnemy: ActiveBuff[] = [...resistedAbilityTimedEnemy];
                const abilityEnemyEffects: SelectedGameBuff[] = [];
                // Timed ability statuses: unconditionally landed (gated at application).
                for (const s of timedAbilityEnemy) {
                    landedAbilityEnemy.push(s.active);
                    abilityEnemyEffects.push(payloadToSelectedBuff(s.payload));
                    emitDebuffApplied(s.payload.buffName);
                }
                // Aura/accumulating ability statuses: per-round landing re-roll.
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
                    emitDebuffApplied(s.payload.buffName);
                }

                // Combined landed enemy debuffs (scheduled + ability) drive modifiers and counts.
                // Ability entries appended AFTER scheduled (KNOWN-DIFF c ordering).
                const roundEnemyDebuffs = [
                    ...scheduledEnemy.roundEnemyDebuffs,
                    ...abilityEnemyEffects,
                ];
                landedEnemyDebuffs = [...scheduledEnemy.landedEnemyDebuffs, ...landedAbilityEnemy];
                resistedEnemyDebuffs = [
                    // Team-turn resisted applications recorded BEFORE this attacker turn
                    // (faster team actors) lead the row's resisted list.
                    ...teamResistedEnemyDebuffs,
                    ...scheduledEnemy.resistedEnemyDebuffs,
                    ...resistedAbilityEnemy,
                ];
                const { enemyDefenseModifier, incomingDamageModifier } =
                    toEnemyModifiers(roundEnemyDebuffs);

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
                    statusEngine.applyTimedAbilityStatus(r, status);
                    bus?.emit({
                        type: 'buff-applied',
                        actorId: 'attacker',
                        round: r,
                        buffName: status.payload.buffName,
                        duration: status.duration,
                    });
                }

                // (e) Effective self ability statuses this round (timed in-window + auras +
                // accumulating), gated vs postDebuffGateCtx. Fold their payloads into the self totals
                // exactly where scheduled buffs fold (toSimBuffs semantics).
                const selfAbilityStatuses: ActiveAbilityStatus[] = [
                    ...statusEngine.timedAbilityStatuses('self'),
                    ...statusEngine.activeAbilityStatuses('self', postDebuffGateCtx),
                ];
                const abilitySelfEffects = selfAbilityStatuses.map((s) =>
                    payloadToSelectedBuff(s.payload)
                );
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
                activeSelfBuffsForRound = [...entry.activeSelfBuffs, ...abilitySelfActive];
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
                roundCrit = damageNoCrit
                    ? false
                    : (action === 'charged' ? chargedCritGate : activeCritGate)(
                          effectiveCrit / 100
                      );
                const effectivePen =
                    defensePenetration +
                    defensePenetrationBuff +
                    modTotals.defensePenetration +
                    abilityDotPen.defensePenetrationBuff;
                const effectiveDefense =
                    enemyDefense * (1 + enemyDefenseModifier / 100) * (1 - effectivePen / 100);
                const damageReduction =
                    effectiveDefense > 0 ? calculateDamageReduction(effectiveDefense) : 0;

                // Step 1: Calculate direct damage
                const enemyDotMod = toEnemyDotModifier(roundEnemyDebuffs);
                // Ability-status self Out. DoT folds in per-round (KNOWN-DIFF b). Enemy Inc. DoT is
                // already inside enemyDotMod (roundEnemyDebuffs includes abilityEnemyEffects).
                const dotMult =
                    1 + (selfDotModifier + enemyDotMod + abilityDotPen.dotDamageModifier) / 100;
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
                const {
                    multiplier: rawMultiplier,
                    hits,
                    scalingAbility,
                } = damageInputsFromSkill(gatedSkill);
                const effectiveMultiplier = rawMultiplier * hits;
                const secondary = secondaryFromSkill(gatedSkill);
                dotsConfig = dotsFromSkill(gatedSkill);

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
                const passiveMultiplier =
                    passiveHit.multiplier * passiveHit.hits + passiveScalingBonus;

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
                    charges = Math.min(
                        charges + bonusCharges + (allyChargePerRound ?? 0),
                        chargeCount
                    );
                }

                const preCritDamage =
                    effectiveAttack * ((effectiveMultiplier + conditionalBonusPct) / 100) +
                    secondaryStatValue;
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
                    effectiveAttack *
                    (passiveMultiplier / 100) *
                    passiveCritMultiplier *
                    nonCritFactor;
                directDamage = preCritDamage * postDefenseFactor + passiveDamage;
                secondaryDamage = secondaryStatValue * postDefenseFactor;
                conditionalDamage =
                    effectiveAttack * (conditionalBonusPct / 100) * postDefenseFactor;

                // ability-performed: ONE event for the firing damage hit, full directDamage.
                bus?.emit({
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
                    abilities: [
                        ...(firingSkill?.abilities ?? []),
                        ...(passiveSkill?.abilities ?? []),
                    ],
                    ctx,
                    effectiveCritDamage,
                    extendChanceGate,
                    corrosionEntries,
                    infernoEntries,
                });

                // += (not =): with a FASTER enemy, the enemy's bomb/accumulator bursts
                // run earlier in the round — a plain assignment would clobber them.
                // Identical at default order (the accumulator resets to 0 each round).
                detonationDamage += detonate({
                    gatedSkill,
                    effectiveAttack,
                    enemyHp,
                    dotMult,
                    affinityMult,
                    corrosionEntries,
                    infernoEntries,
                    pendingBombs,
                });

                // Step 3: Apply new DoT stacks from this round's skill (subject to landing roll).
                // DoTs gate at application: draw the shared per-round roll only when there are
                // DoTs to apply this round (memoized — shares the recurring partition's single
                // draw). With nothing to apply, dotsLanded is vacuously true (no draw taken),
                // preserving the all-landing fixtures where no-DoT rounds report dotsLanded:true.
                dotsLanded = dotsConfig.length > 0 ? roundDebuffLanded() : true;
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
                            bus?.emit({
                                type: 'dot-applied',
                                targetId: enemy.id,
                                round: r,
                                dotType,
                                stacks,
                            }),
                    });
                }

                // Step 3a: 'inflicted'-scope extensions grow ONLY this cast's new DoTs
                // (Valerian). Sourced from the same firing+passive ability set as Step 2.9.
                // No-op when the landing roll failed (no new entries were appended).
                extendInflictedDoTs({
                    abilities: [
                        ...(firingSkill?.abilities ?? []),
                        ...(passiveSkill?.abilities ?? []),
                    ],
                    ctx,
                    effectiveCritDamage,
                    extendChanceGate,
                    corrosionEntries,
                    infernoEntries,
                    corrosionEntriesBefore,
                    infernoEntriesBefore,
                });

                if (dotsLanded) {
                    applyAccumulators({ gatedSkill, pendingAccumulators });
                }

                // Hand the enemy's DoT-processing turn the round-scoped context it needs. With a
                // faster enemy this is the PREVIOUS round's context, hence the carried
                // `lastAttackerCtx`; at default speeds the attacker always precedes the enemy.
                lastAttackerCtx = { effectiveAttack, dotMult, affinityMult, directDamage };
                // Signal that the attacker block has completed for this round. Any SLOWER team
                // actors that follow will append their resisted entries directly to the live
                // resistedEnemyDebuffs row list (see the team-turn block above).
                attackerHasActed = true;
            } else if (actor.kind === 'team') {
                // ====================================================================
                // TEAM TURN — a real speed-ordered ally. It deals no damage; its sole
                // job is to notify the status engine that ITS source fired this round so
                // its timed buffs (keyed by this actor's id) upsert onto the maps. preTurn
                // mirrors the attacker's charge cadence on the actor's OWN fields; bonus
                // charges do not apply (team actors have no charge abilities). A FASTER
                // team actor runs before the attacker's snapshot() → its buffs are visible
                // this round; a SLOWER one upserts after → visible from the next round.
                // ====================================================================
                const teamHasCharged = actor.chargeCount > 0;
                let teamAction: 'active' | 'charged';
                if (teamHasCharged && actor.charges >= actor.chargeCount) {
                    teamAction = 'charged';
                    actor.charges = 0;
                } else {
                    teamAction = 'active';
                    if (teamHasCharged) actor.charges += 1;
                }

                bus?.emit({ type: 'skill-fired', actorId: actor.id, round: r, slot: teamAction });

                const { resistedEnemy } = statusEngine.sourceFired(
                    actor.id,
                    teamAction === 'charged' ? 'charge' : 'active',
                    r
                );
                // Synthesize + record this team turn's resisted timed enemy applications
                // (mirror the attacker's resisted-synthesis). A FASTER team actor (before
                // the attacker) feeds teamResistedEnemyDebuffs, which the attacker block
                // folds into the row. A SLOWER team actor (after the attacker) appends
                // directly to the live row list.
                const teamResisted = synthesizeResisted(resistedEnemy, enemyDebuffLookup, (n) =>
                    bus?.emit({
                        type: 'debuff-resisted',
                        targetId: enemy.id,
                        round: r,
                        buffName: n,
                    })
                );
                if (teamResisted.length > 0) {
                    if (attackerHasActed) {
                        // Slower team turn: attacker block already set resistedEnemyDebuffs.
                        resistedEnemyDebuffs.push(...teamResisted);
                    } else {
                        // Faster team turn: attacker block hasn't run yet; stage here.
                        teamResistedEnemyDebuffs.push(...teamResisted);
                    }
                }
            } else if (actor.kind === 'enemy') {
                // ====================================================================
                // ENEMY TURN — ticks the DoT containers it carries. DoTs tick at the
                // start of the afflicted ship's turn. At default speeds the attacker
                // acted earlier THIS round (apply/detonate done, ctx set), so the enemy
                // ticks with this round's context — same totals as the pre-restructure
                // engine. lastAttackerCtx is undefined only when a faster enemy acts
                // before the attacker's first turn (containers empty — skip).
                // ====================================================================
                if (lastAttackerCtx) {
                    const {
                        effectiveAttack,
                        dotMult,
                        affinityMult,
                        directDamage: ctxDirect,
                    } = lastAttackerCtx;
                    const ticks = tickDoTs({
                        corrosionEntries,
                        infernoEntries,
                        enemyHp,
                        effectiveAttack,
                        dotMult,
                        affinityMult,
                        emitTicked: (dotType, damage) =>
                            bus?.emit({
                                type: 'dot-ticked',
                                targetId: enemy.id,
                                round: r,
                                dotType,
                                damage,
                            }),
                    });
                    corrosionDamage = ticks.corrosionDamage;
                    infernoDamage = ticks.infernoDamage;

                    detonationDamage += processBombs({ pendingBombs, affinityMult });
                    detonationDamage += processAccumulators({
                        pendingAccumulators,
                        directDamage: ctxDirect,
                    });
                }
            }

            // Post Turn (combat-system.md section 4): the status CARRIER decrements.
            // Self statuses live on the attacker; enemy debuffs on the enemy. Team
            // actors carry no statuses in Phase 2 (their grants sit on the attacker).
            if (actor.kind === 'attacker' || actor.kind === 'enemy') {
                const side = actor.kind === 'attacker' ? 'self' : 'enemy';
                for (const buffName of statusEngine.decrementSide(side).expired) {
                    bus?.emit({ type: 'buff-expired', actorId: actor.id, round: r, buffName });
                }
            }

            bus?.emit({ type: 'turn-ended', actorId: actor.id, round: r });
        }

        // --- Post-round assembly: total the round's damage (now including the enemy
        // turn's DoT ticks/bursts), update cumulative totals + enemy HP, emit hp-changed /
        // ship-destroyed, and push the RoundData row. Expressions unchanged — relocated. ---
        if (detonationDamage > 0) {
            bus?.emit({
                type: 'dot-detonated',
                targetId: enemy.id,
                round: r,
                damage: detonationDamage,
            });
        }

        const totalRoundDamage = directDamage + corrosionDamage + infernoDamage + detonationDamage;
        cumulativeDamage += totalRoundDamage;
        totalDirectRaw += directDamage;
        totalSecondaryRaw += secondaryDamage;
        totalConditionalRaw += conditionalDamage;
        totalCorrosionRaw += corrosionDamage;
        totalInfernoRaw += infernoDamage;
        totalDetonationRaw += detonationDamage;

        // Track the enemy's remaining HP and emit hp-changed / ship-destroyed taps
        // (emission-only; the sim keeps hitting the dead dummy regardless).
        enemy.currentHp = Math.max(0, enemyHp - cumulativeDamage);
        const newEnemyHpPctInt =
            enemyHp > 0 ? Math.round(Math.max(0, 100 * (1 - cumulativeDamage / enemyHp))) : 100;
        if (newEnemyHpPctInt !== lastEnemyHpPctInt) {
            bus?.emit({
                type: 'hp-changed',
                targetId: enemy.id,
                round: r,
                oldPct: lastEnemyHpPctInt,
                newPct: newEnemyHpPctInt,
            });
            lastEnemyHpPctInt = newEnemyHpPctInt;
        }
        if (!destroyedEmitted && enemy.currentHp <= 0) {
            bus?.emit({ type: 'ship-destroyed', actorId: enemy.id, round: r });
            destroyedEmitted = true;
        }

        // Report stacks after expiry (state going into next round)
        roundData.push({
            round: r,
            action,
            charges: Math.round(charges),
            chargeCount: hasChargedSkill ? chargeCount : 0,
            didCrit: roundCrit,
            enemyHpPct: Math.round(enemyHpPct),
            directDamage: Math.round(directDamage),
            corrosionDamage: Math.round(corrosionDamage),
            infernoDamage: Math.round(infernoDamage),
            detonationDamage: Math.round(detonationDamage),
            totalRoundDamage: Math.round(totalRoundDamage),
            cumulativeDamage: Math.round(cumulativeDamage),
            activeCorrosionStacks: totalStacks(corrosionEntries),
            activeInfernoStacks: totalStacks(infernoEntries),
            activeBombCount: pendingBombs.length,
            activeSelfBuffs: activeSelfBuffsForRound,
            activeEnemyDebuffs: landedEnemyDebuffs,
            resistedEnemyDebuffs,
            appliedDoTs: dotsConfig,
            dotsLanded,
            activeDoTStates: [
                ...corrosionEntries.map((e) => ({
                    type: 'corrosion' as const,
                    tier: e.tier,
                    stacks: e.stacks,
                    ticksRemaining: e.remainingRounds,
                })),
                ...infernoEntries.map((e) => ({
                    type: 'inferno' as const,
                    tier: e.tier,
                    stacks: e.stacks,
                    ticksRemaining: e.remainingRounds,
                })),
                ...pendingBombs.map((b) => ({
                    type: 'bomb' as const,
                    tier: b.tier,
                    stacks: b.stacks,
                    ticksRemaining: b.countdown,
                })),
            ],
        });
    }

    return {
        rounds: roundData,
        rawTotals: {
            direct: totalDirectRaw,
            corrosion: totalCorrosionRaw,
            inferno: totalInfernoRaw,
            detonation: totalDetonationRaw,
            cumulative: cumulativeDamage,
            totalSecondary: totalSecondaryRaw,
            totalConditional: totalConditionalRaw,
        },
    };
}
