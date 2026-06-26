import { calculateDamageReduction } from '../autogear/priorityScore';
import { evaluateCondition, scaledBonus, conditionsMet } from '../abilities/evaluateConditions';
import { buildRoundContext } from '../abilities/roundContext';
import { DoTApplicationConfig, EnemyBaseClass, SelectedGameBuff } from '../../types/calculator';
import { Ability, ShipSkills, Skill } from '../../types/abilities';
import type { AffinityName } from '../../types/ship';
import type { ConditionContext } from '../abilities/evaluateConditions';
import {
    selectFiringSkill,
    damageInputsFromSkill,
    secondaryFromSkill,
    dotsFromSkill,
    chargeAbilitiesFromSkill,
    controlAbilitiesFromSkill,
    detonationsFromSkill,
    accumulatorsFromSkill,
    gateFiringAbilities,
    extraActionsFromSkill,
    type ExtraActionGrant,
} from '../abilities/applyAbilities';
import { toSimBuffs, toEnemyModifiers, toEnemyDotModifier } from '../calculators/dpsBuffHelpers';
import {
    ActiveDoTStack,
    ActorHealing,
    PendingAccumulator,
    PendingBomb,
    CombatActor,
    advanceChargeCadence,
} from './state';
import {
    ActiveBuff,
    ActiveAbilityStatus,
    RegisteredAbilityStatus,
    createStatusEngine,
} from './statusEngine';
import { CombatEventBus } from './events';
import { synthesizeResisted } from './shared';
import { buildActorConditionContext, type ReactiveAbility } from './triggers';
import { recipientCarriesBlockBuff } from './blockBuffBuffs';
import type { AttackerDamageScalars } from './victimDamage';
import { effectiveDamageStatsOf, liveDebuffLandingChance } from './effectiveStats';
import {
    targetCarriesBlockDebuff,
    emitBlockDebuffResist,
    dotResistLabel,
    controlEffectLabel,
} from './debuffImmunity';
import { outgoingAmplificationForHit } from './outgoingEffects';
import { healAmplificationForCast } from './healAmplification';
// Buff-fold leaf helpers. Imported for in-file use and re-exported to preserve the
// historical public API (engine.ts + tests import these from playerTurn). Keeping the
// definitions in the leaf module breaks the playerTurn ⇄ effectiveStats import cycle.
import {
    calculateBuffTotals,
    expandBuffEntry,
    expandEnemyDebuffs,
    payloadToSelectedBuff,
} from './buffTotals';
export { calculateBuffTotals, expandEnemyDebuffs, payloadToSelectedBuff };

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
    /** Healing-calc seams (additive): the actor's current effective defence/max-HP, and its
     *  outgoing/incoming-heal % as of its last turn — read by enemy attacks (target defence),
     *  'target-hp' heals, outgoing-heal scaling, and incoming-heal amplification (corrosion
     *  applier-ctx rule). */
    effectiveDefence: number;
    effectiveMaxHp: number;
    outgoingHealPct: number;
    incomingHealPct: number;
}

/** Healing-mode context threaded into player turns (and later the executor). The ENGINE
 *  owns all mutation (applyHealToTarget/grantShieldToTarget close over the live target). */
export interface HealingRuntimeCtx {
    targetId: string;
    credit: (actorId: string, bucket: keyof ActorHealing, amount: number) => void;
    /** Recipient stats via lastTurnCtxByActor with base-stat fallback (pre-first-turn). */
    recipientMaxHp: (actorId: string) => number;
    recipientIncomingHealPct: (actorId: string) => number;
    /** D-PR6: summed incoming-heal amplification % for a repair landing on `rid` (Exuberance). Rolls the
     *  recipient's incoming-heal-amp procs ONCE (combat-lifetime gate keyed rid+ability). Absent → callers
     *  use 0 → byte-identical. */
    recipientIncomingHealAmpPct?: (rid: string) => number;
    /** A FOREIGN HoT applier's effective max HP at tick time (Task 7): reads
     *  lastTurnCtxByActor ONLY — NO base-stat fallback (the strict corrosion applier-ctx
     *  rule). Returns undefined when the applier has not acted this run yet, in which case
     *  the holder SKIPS the tick entirely. (The acting holder's self-granted HoTs use the
     *  local effectiveHp directly, never this accessor.) */
    applierMaxHp: (actorId: string) => number | undefined;
    /** Target-routed heal: consumed = min(raw, maxHp − currentHp); dead target → all overheal.
     *  Mutates the victim's currentHp. Returns the split. `victim` defaults to the heal target
     *  (E2 T1: optional per-victim override for positional AoE leech). */
    applyHealToTarget: (
        raw: number,
        victim?: CombatActor
    ) => { consumed: number; overheal: number };
    /** Additive pool capped at the victim's max HP; drains before HP (enemy attacks, Task 8).
     *  Dead victim → no-op (returns 0). `victim` defaults to the heal target (E2 T1: optional
     *  per-victim override for positional AoE leech). Returns the REAL pool growth (post-cap
     *  delta) so the caller can build a shield-applied event (H3.6). */
    grantShieldToTarget: (raw: number, victim?: CombatActor) => number;
    /** Fixed player-id order for all-allies recipient routing. */
    playerIds: string[];
    /** Fixed enemy-attacker-id order for an ENEMY caster's all-allies routing (E5). */
    enemyIds: string[];
    /** Resolve a recipient id to its CombatActor (E5 enemy-heal apply). undefined if absent. */
    recipientActor: (id: string) => CombatActor | undefined;
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
    /** Debuffs THIS actor discretely inflicted on the target THIS turn (source-accurate, unlike
     *  the shared-per-target landedEnemyDebuffs window). Used by the healing enemy-effects
     *  overview to attribute each debuff to the enemy that applied it (Task 10a). */
    inflictedEnemyDebuffs: ActiveBuff[];
    resistedEnemyDebuffs: ActiveBuff[];
    directDamage: number;
    secondaryDamage: number;
    conditionalDamage: number;
    detonationDamage: number; // the player-turn detonate() portion
    /** Per-hit crit outcomes of THIS turn's fired damage ability, in hit order
     *  (length = the ability's hit count; [] when the cast had no damage ability,
     *  or when it is noCrit — the hit loop doesn't run for noCrit abilities).
     *  Same draws that feed critHits/roundCrit — collected, not re-drawn. */
    hitCrits: boolean[];
    /** Extra-action grants this turn fired (pre-gated). The ENGINE owns queue
     *  re-insertion + the oncePerRound/backstop bookkeeping. */
    extraActionGrants: ExtraActionGrant[];
    /** Per-cast attacker-side damage scalars for the positional apply path (Task 7).
     *  Populated from the SAME locals that feed the aggregate `directDamage`, so feeding
     *  these + `hitCrits` through `victimHitDamage` for the bound victim's defense profile
     *  reproduces the firing hit exactly (Task-4 parity). Read ONLY by the future positional
     *  engine branch (Task 8); non-positional callers ignore it → goldens byte-identical.
     *  Present whenever a damage ability fired this cast (else undefined). */
    positionalScalars?: AttackerDamageScalars;
    turnCtx: PlayerRoundCtx; // round-scoped context for the enemy's DoT tick (this actor)
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
    /** Caster heal-modifier stat (healing calc). Default 0. */
    healModifier: number;
    // Per-actor adapter-derived rates
    /** LIVE per-target debuff-landing chance (0..1) for THIS actor, set at turn start by
     *  runPlayerTurn from current effective hacking-vs-target-security + affinity (A2 Task 4).
     *  Read by the REACTIVE (triggers.ts) landing path via the runtime's landing closure /
     *  debuffLandingGate so an owner's reactive inflictions draw against the live chance too.
     *  Undefined until the actor's first turn — callers use `?? 1` as a neutral default. */
    liveDebuffLandingChance?: number;
    selfDotModifier: number;
    defensePenetrationBuff: number;
    affinityDamageModifier: number;
    affinityCritCap: number;
    affinityCritPenalty: number;
    affinityDisadvantage: boolean;
    /** Raw attacker affinity (Task 7). The numeric modifiers above are PRE-RESOLVED
     *  (computeAffinityModifiers) against the bound enemy and cannot be inverted, so the
     *  positional apply path — which re-resolves per VICTIM — needs the raw affinity here.
     *  Optional: absent → `'antimatter'` (neutral vs anything, modifier 0), matching the
     *  default neutral matchup; surfaced only on positionalScalars. */
    attackerAffinity?: AffinityName;
    allyChargePerRound?: number; // attacker-only manual input
    // Per-actor deterministic gates (own instances — determinism isolation)
    activeCritGate: RateGate;
    chargedCritGate: RateGate;
    debuffLandingGate: RateGate;
    extendChanceGate: RateGate;
    /** Heal crit gates (healing calc): SEPARATE from the damage crit gates so drawing a
     *  heal crit never shifts a heal-carrying ship's damage-crit schedule. */
    activeHealCritGate: RateGate;
    chargedHealCritGate: RateGate;
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
    /** Grant `amount` charges to EVERY player actor (Task 5 ally-charge routing). Supplied by
     *  the engine, which loops all player actors (incl. this caster) bumping
     *  min(charges + amount, chargeCount) and skipping chargeCount 0 (no charge skill → no
     *  banking). Called from the CASTER's active-round charge step (mirrors own gains). Optional
     *  so statusEngine/standalone callers without a team need not supply it — when absent the
     *  caster's own gains still apply (a self-only run never has ally-targeted charge abilities). */
    grantAllyCharges?: (amount: number) => void;
    /** Remove `amount` charges from every OPPOSING-side actor (Task 7 enemy-target charge
     *  removal). Supplied by the engine, which loops the opposing side flooring each actor at 0
     *  and skipping chargeLossImmune / chargeCount-0 actors. Called from the caster's active/charged
     *  charge step for enemy/all-enemies-targeted charge abilities. Optional so standalone callers
     *  without an opposing roster need not supply it — when absent enemy-target removal is a no-op
     *  (a self-only run never has enemy-targeted charge abilities). */
    removeEnemyCharges?: (amount: number) => void;
    /** Healing mode (healing calc): present ONLY when the engine runs in healing mode.
     *  Absent for DPS-mode turns — the heal block is fully gated on this, keeping the DPS
     *  goldens byte-identical. */
    healing?: HealingRuntimeCtx;
    /** Event-only heal/cleanse emission (Phase 4c PR 4 Task 5; HP-restore lifted in E5 §4.1):
     *  when true (the enemy walk), the heal block EMITS `heal-performed`/`cleanse-performed`
     *  carrying THIS actor's id and (E5) restores each heal recipient's OWN currentHp via the
     *  per-victim pool — but credits NO player healing bucket and never mutates the player
     *  heal-target (the shared player `healing` ctx never sees an enemy-id BUCKET credit).
     *  Shields/cleanse still mutate nothing on this path. Scopes emission to the CAST skill
     *  (gatedSkill) only, never the passive. Defaults falsy (player/team turns credit + mutate
     *  as before). */
    healEventOnly?: boolean;
    /** Acting actor's live HP% (0..100) for self-HP-threshold gates. Defaults to 100 so
     *  callers that do not supply it (e.g. standalone tests, un-updated call sites) behave
     *  as if the actor is at full HP — gate never fires → byte-identical to prior behaviour. */
    selfHpPct?: number;
    /** Heal target's live HP% (0..100) at THIS acting actor's turn start (pre-this-cast-heal),
     *  for `hpSubject:'target'` condition gates — Hermes' "grants Cheat Death to an ally below
     *  40% HP" evaluated at cast time. Defaults to 100 so DPS-mode / un-updated callers behave
     *  as if the target is full HP → a "below N" gate fails → grant inert in DPS (correct).
     *  Threaded into the round contexts (postDebuffGateCtx gates the per-slot timed application). */
    targetHpPct?: number;
    /** The acting attacker's STRUCK target was repaired (HP-healed) this round (C2b-3). Default
     *  false. Threaded into the round contexts to gate target-repaired-this-round conditions. */
    targetRepairedThisRound?: boolean;
    /** Enemy-side debuff target key (Task 6). Passed as the `enemyTargetId` arg to the three
     *  enemy-side statusEngine calls (applyTimedAbilityStatus / timedAbilityStatuses /
     *  activeAbilityStatuses). When UNDEFINED the statusEngine resolves to DEFAULT_ENEMY_TARGET
     *  (pre-Task-6 path, byte-identical). The real tank id is supplied only by the enemy-dispatch
     *  branch (Task 6b); all player-side call sites in engine.ts leave this unset. */
    targetId?: string;
    /** Active buff names on the OPPOSING side (Task 7) for this actor's `enemy-buff` condition
     *  gates. For a player actor this is the UNION of the enemy attacker(s)' self-buff names;
     *  for the enemy-dispatch walk it is symmetric (the player team's buffs). NAMES ONLY — these
     *  feed condition gates, never effect folding (no double-fold). Defaults to [] (DPS-assumption,
     *  byte-identical). Sourced by the engine via triggers.selfBuffNamesForOwners. */
    enemyBuffNames?: string[];
    /** Active debuff names on THIS actor (Task 7) for its `self-debuff` condition gates. For a
     *  player heal target these are the enemy-applied debuffs in its per-target store (keyed by
     *  its own id). NAMES ONLY — never folded. Defaults to [] (DPS-assumption, byte-identical).
     *  Sourced by the engine via triggers.ownerDebuffNamesFor. */
    selfDebuffNames?: string[];
    /** §4.5 Stasis direct-damage break hook (B3 Task 2). When supplied, fires AFTER scheduled
     *  debuffs are applied (sourceFired) but BEFORE the ability timed-debuff loop, so the break
     *  correctly precedes any Stasis re-application from the same attack's debuff abilities.
     *  Receives the resolved enemy target id (`targetId`). The engine supplies this for DIRECT-
     *  channel apply boundaries (non-positional and positional via emitHit override); absent for
     *  DPS/standalone callers → inert (byte-identical). */
    onHitBreakStasis?: (targetId: string) => void;
    /**
     * E3 (AoE purge): the firing skill's footprint victim ids, supplied by the engine in
     * positional mode. The on-cast purge fans an 'all-enemies' purge over these instead of the
     * single `targetId`. Absent for non-positional callers → single-anchor (byte-identical).
     */
    aoeVictimIds?: string[];
    /** D-PR3: victim-side incoming %-reduction against the bound target.
     *  nonCrit = applies to ALL hits (Voidshade/Nebula); critFamily = take-max crit-family reduction
     *  applied to the crit fraction only (Iridium/Hardened/Hyperion). Both default 0 → byte-identical. */
    incomingReductionNonCritPct?: number;
    incomingReductionCritFamilyPct?: number;
    /** D-PR4: the bound target's live effective attack (for Giant Slayer's higher-attack gate).
     *  Absent → targetHigherAttack false → Giant Slayer inert. */
    targetEffectiveAttack?: number;
    /** D-PR4: engine-supplied deterministic proc gate for outgoing-amplification procs, keyed by
     *  ability id under this actor. Absent → no amplification rolled (byte-identical). */
    rollOutgoingProc?: (abilityId: string, chance: number) => boolean;
}

// ---------------------------------------------------------------------------
// Module-private helpers used EXCLUSIVELY by the player turn.
// ---------------------------------------------------------------------------

// expandBuffs/expandEnemyDebuffs moved to buffTotals.ts (re-exported from lines 41-50 above).

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
        expandBuffEntry(ab, args.selfBuffLookup.get(ab.buffName) ?? [])
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
        return expandBuffEntry(ab, bufs);
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
        return expandBuffEntry(ab, bufs);
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
    /** Which charge abilities to sum (Task 5 ally routing; Task 7 enemy routing):
     *  - 'own'   → self-targeted (and anything not ally/all-allies/enemy/all-enemies) → bumps the
     *    caster only.
     *  - 'ally'  → ally/all-allies-targeted → bumps every player actor (via grantAllyCharges).
     *  - 'enemy' → enemy/all-enemies-targeted → REMOVES from every opposing actor (via
     *    removeEnemyCharges). Positive amount; the engine subtracts.
     *  For attacker-only runs the 'ally' total still routes through grantAllyCharges, which
     *  loops the sole attacker → identical net charge to the pre-Task-5 single 'own' sum. */
    targetFilter: 'own' | 'ally' | 'enemy';
}): number {
    let gain = 0;
    for (const ability of chargeAbilitiesFromSkill(args.gatedSkill)) {
        if (ability.config.type !== 'charge') continue;
        const isAlly = ability.target === 'ally' || ability.target === 'all-allies';
        const isEnemy = ability.target === 'enemy' || ability.target === 'all-enemies';
        // 'own' sums everything that is neither ally- nor enemy-targeted; the other filters
        // sum only their matching target class.
        // NOTE: only 'enemy'/'all-enemies' count as enemy here; the selector enemy-targets
        // ('enemy-most-buffs'/'enemy-highest-attack') fall into 'own'. Harmless today — the
        // skill parser never emits a selector target for type:'charge' — but if charge ever
        // uses one, add it to the enemy match (and to the reactive branch in triggers.ts).
        const matches =
            args.targetFilter === 'ally'
                ? isAlly
                : args.targetFilter === 'enemy'
                  ? isEnemy
                  : !isAlly && !isEnemy;
        if (!matches) continue;
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
            // Each bomb bursts with the APPLIER's affinity matchup, snapshotted at
            // application (PendingBomb.affinityMult) — NOT the detonating actor's. A
            // team-applied bomb detonated by the attacker's skill keeps the team's
            // modifier, mirroring processBombs' per-entry handling on the enemy turn.
            // Identical for attacker-only runs (every entry carries the attacker's mult).
            const payout =
                args.pendingBombs.reduce(
                    (sum, b) => sum + b.stacks * b.damagePerStack * b.affinityMult,
                    0
                ) * pct;
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
// `sourceId` (the applier) is stamped on every appended entry for per-actor attribution
// (Task 4); bombs also snapshot the applier's `affinityMult` at application (used at burst).
function applyNewDoTs(args: {
    dotsConfig: DoTApplicationConfig;
    effectiveAttack: number;
    affinityMult: number;
    detonationDamageModifier: number;
    sourceId: string;
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
                sourceId: args.sourceId,
            });
            args.emitDotApplied('corrosion', dot.stacks);
        } else if (dot.type === 'inferno') {
            args.infernoEntries.push({
                stacks: dot.stacks,
                tier: dot.tier,
                remainingRounds: dot.duration,
                sourceId: args.sourceId,
            });
            args.emitDotApplied('inferno', dot.stacks);
        } else if (dot.type === 'bomb') {
            args.pendingBombs.push({
                countdown: Math.max(1, dot.duration),
                damagePerStack: args.effectiveAttack * (dot.tier / 100),
                stacks: dot.stacks,
                tier: dot.tier,
                sourceId: args.sourceId,
                affinityMult: args.affinityMult,
                detonationDamageModifier: args.detonationDamageModifier,
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
    sourceId: string;
}): void {
    for (const acc of accumulatorsFromSkill(args.gatedSkill)) {
        args.pendingAccumulators.push({
            roundsRemaining: Math.max(1, acc.turns),
            pct: acc.pct,
            accumulated: 0,
            sourceId: args.sourceId,
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
        grantAllyCharges,
        removeEnemyCharges,
        selfHpPct: selfHpPctArg = 100,
        targetHpPct: targetHpPctArg = 100,
        targetRepairedThisRound: targetRepairedThisRoundArg = false,
        targetId,
        enemyBuffNames: enemyBuffNamesArg = [],
        selfDebuffNames: selfDebuffNamesArg = [],
        healEventOnly = false,
        onHitBreakStasis,
        aoeVictimIds,
    } = args;

    const {
        actor,
        timedEnemyBySlot,
        timedSelfBySlot,
        selfBuffLookup,
        enemyDebuffLookup,
        activeCritGate,
        chargedCritGate,
        activeHealCritGate,
        chargedHealCritGate,
        debuffLandingGate,
        extendChanceGate,
        healModifier,
        castSkills: shipSkills,
        hasChargedSkill,
        attack,
        crit,
        critDamage,
        defensePenetration,
        defensePenetrationBuff,
        selfDotModifier,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        affinityDisadvantage,
        attackerAffinity,
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
    } else {
        action = 'active';
    }
    advanceChargeCadence(actor, hasChargedSkill);

    bus.emit({ type: 'skill-fired', actorId: actor.id, round: r, slot: action });

    // Enemy HP% entering this round, derived from the struck victim's live HP decline (PR6b:
    // the engine no longer passes a precomputed scalar — `enemy` is the tgt actor, `enemyHp`
    // its max, so decline = how much HP the victim has lost). For the DPS dummy sink this equals
    // the old cumulativeDamage+cumulativeTeamDamage (the sink's currentHp tracks it post-round);
    // for a real positional victim it now reflects that victim's actual HP.
    // LOAD-BEARING TIMING: in DPS the dummy's currentHp updates POST-round (engine.ts ~3772),
    // not per-hit, so this derived value equals the entering-round scalar the old param carried.
    const enemyHpDecline = Math.max(0, enemyHp - enemy.currentHp);
    const enemyHpPct = enemyHp > 0 ? Math.max(0, 100 * (1 - enemyHpDecline / enemyHp)) : 100;

    const firingSkill = selectFiringSkill(shipSkills, action);
    // noCrit is read from the UNGATED skill: the flag is a property of the attack
    // itself and must be known before the ctx (and therefore the gate) exists.
    // Assumes one base-damage ability per skill (true for all parser output); a
    // gated-off first damage ability with a differently-flagged second one would
    // read the wrong flag — not representable from skill text today.
    const { noCrit: damageNoCrit, scalingAbility: damageAbility } =
        damageInputsFromSkill(firingSkill);
    const hasDamageAbility = damageAbility !== undefined;

    const emitDebuffResisted = (buffName: string) =>
        bus.emit({ type: 'debuff-resisted', targetId: enemy.id, round: r, buffName });
    // emitDebuffApplied: discrete-infliction-only (Phase 3 retiming). `sourceId` is the
    // actor that inflicted the debuff. NOT called for recurring/aura per-round re-applications
    // or for every round a standing timed status is active — only at the infliction site.
    const emitDebuffApplied = (sourceId: string, buffName: string) =>
        bus.emit({ type: 'debuff-applied', sourceId, targetId: enemy.id, round: r, buffName });

    // LIVE per-target debuff-landing chance (A2 Task 4 / A-closeout). The sole producer of
    // landing chance: recomputed each turn from the acting actor's effective hacking (× this
    // actor's affinity) vs the TURN TARGET's effective security. `liveDebuffLandingChance` is
    // self-sufficient — it defaults a missing attacker hacking → 200 and target security → 100,
    // reproducing the old static formula for base-less/neutral actors. The acting actor's
    // `selfBuffLookup` folds scheduled self-buffs; timed ability statuses (the hacking/security
    // buffs that move landing) fold lookup-free from the status engine. Cached once per turn here
    // — every landing consumer below reads this value.
    const liveLandingChance = liveDebuffLandingChance(
        statusEngine,
        selfBuffLookup,
        actor,
        enemy,
        affinityDamageModifier
    );
    // Block Debuff: an immune turn-target auto-resists every timed/persistent application.
    // Computed ONCE per turn (the turn target `enemy` is fixed for this turn) — the immune
    // short-circuit below is only reached when this is true, which no existing fixture triggers,
    // so the non-immune path stays byte-identical. Task 6 reuses this for the DoT path.
    const targetImmuneToDebuffs = targetCarriesBlockDebuff(statusEngine, enemy.id);
    // Turn-local landing decision: an immune target auto-resists (return false WITHOUT drawing
    // the gate, so the existing resist branches record it); otherwise 'apply' (affinity) lands
    // unless at an affinity disadvantage (UNCHANGED rule); 'inflict' (and unmarked) draws the
    // runtime's deterministic gate against the LIVE chance. Replaces the runtime's pre-baked
    // `landsTimedEnemyApplication` so every 'inflict' draw — the playerTurn timed loop, the
    // status-engine sourceFired hook, and the reactive (triggers.ts) path — uses the live value
    // uniformly.
    const landsTimedEnemyApplicationLive = (application?: 'inflict' | 'apply'): boolean =>
        targetImmuneToDebuffs
            ? false
            : application === 'apply'
              ? !affinityDisadvantage
              : debuffLandingGate(liveLandingChance);
    // Publish the live chance onto the runtime so the REACTIVE (triggers.ts) path — which draws
    // the OWNER's landing gate via owner.debuffLandingGate(owner.liveDebuffLandingChance ?? 1) —
    // uses the same live value. Always set now (the live path is unconditional).
    runtime.liveDebuffLandingChance = liveLandingChance;
    // Point the status engine's sourceFired landing hook at THIS actor's live closure for the
    // duration of this turn (it is invoked synchronously inside sourceFired below).
    statusEngine.setLandsTimedEnemyApplication((buff) =>
        landsTimedEnemyApplicationLive(buff.application)
    );

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
    // Layer 1 of the damage fold (scheduled manual + team self buffs). The accessor
    // (effectiveDamageStatsOf) recomputes ALL four layers from scheduledTotals +
    // abilitySelfEffects + modifiers, so the per-layer `+=` staging that used to live
    // here is gone — only critBuffForGates is staged, to feed the three mid-fold gate
    // estimates (cappedCrit) that read a partial crit total before the final fold.
    const scheduledTotals = resolveSelfBuffTotals({
        activeSelfBuffs: entry.activeSelfBuffs,
        selfBuffLookup,
    });
    // Partial crit-buff total for the gate estimates: starts at layer 1, then gains
    // layers 2+3 (abilityTotalsForGates) before the modifier gate at the modifierCtx.
    let critBuffForGates = scheduledTotals.critBuff;

    // Per-round landing roll, drawn ONCE and memoized across this round's
    // consumers (the RECURRING/aura partition + DoT landing). Lazy so the
    // single draw is taken only when something actually needs it — TIMED
    // applications gate at application time and do NOT re-draw here, so a
    // round with no recurring/aura enemy content and no DoTs takes no draw
    // (preserving the deterministic schedule for application-only fixtures).
    let roundDebuffLandedValue: boolean | undefined;
    const roundDebuffLanded = (): boolean => {
        if (roundDebuffLandedValue === undefined) {
            roundDebuffLandedValue = debuffLandingGate(liveLandingChance);
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
        effectiveCritRate: cappedCrit(critBuffForGates),
        enemyType,
        enemyHpPct,
        selfHpPct: selfHpPctArg,
        targetHpPct: targetHpPctArg,
        targetRepairedThisRound: targetRepairedThisRoundArg,
        enemyBuffNames: enemyBuffNamesArg,
        selfDebuffNames: selfDebuffNamesArg,
        turnsTaken: actor.turnsTaken,
    });

    // §4.5 Direct-damage Stasis break (B3 Task 2). Fires AFTER scheduled debuffs (sourceFired)
    // but BEFORE the ability timed-debuff loop, so a Stasis re-application from THIS attack's
    // debuff abilities is not inadvertently removed. The engine supplies `onHitBreakStasis` only
    // for direct-channel apply boundaries (non-positional and positional emitHit paths); DPS/
    // standalone callers leave it absent → no-op. Receives the resolved target id so the break
    // can key the statusEngine's per-actor enemy store correctly (side-symmetric: same key
    // regardless of whether the actor is a player or enemy).
    // Only fire when targetId is defined (the engine always supplies it for direct-channel
    // break-eligible turns; DPS/standalone callers without a real targetId are inert).
    if (targetId !== undefined) onHitBreakStasis?.(targetId);

    // (b) Gate + apply this round's firing-skill TIMED enemy debuff abilities.
    // Each application that passes its condition gate draws the landing decision
    // ONCE here (Task 7): 'apply' → lands unless affinity-disadvantaged (no draw);
    // otherwise draws the hacking-vs-security gate. Resisted → the apply is SKIPPED
    // (no status stored), recorded resisted with its would-be duration, and emitted.
    // Landed → emit debuff-applied ONCE at this infliction site (Phase 3 retiming).
    const resistedAbilityTimedEnemy: ActiveBuff[] = [];
    // Debuffs THIS actor discretely inflicted on the target this turn (source-accurate
    // attribution for the enemy-effects overview — Task 10a). Unlike landedEnemyDebuffs,
    // which reflects the whole per-target window (shared across all attackers of one target),
    // this captures only the applications THIS actor made at their own infliction sites.
    // Seed with the newly-applied SCHEDULED timed enemy debuffs (this actor's own manual
    // lists, owner-scoped): the intersection of the window snapshot with the names that fired
    // this turn (appliedScheduledTimedNames). Empty for enemy attackers (no manual debuffs).
    const appliedScheduledSet = new Set(appliedScheduledTimedNames);
    const inflictedEnemyDebuffs: ActiveBuff[] = scheduledEnemy.landedEnemyDebuffs.filter((ab) =>
        appliedScheduledSet.has(ab.buffName)
    );
    for (const status of timedEnemyBySlot) {
        if (status.sourceSlot !== action) continue;
        if (!conditionsMet(status.conditions, preDebuffGateCtx)) continue;
        if (landsTimedEnemyApplicationLive(status.payload.application)) {
            statusEngine.applyTimedAbilityStatus(r, status, actor.id, targetId);
            // Discrete infliction event — emit ONCE at this application site.
            emitDebuffApplied(actor.id, status.payload.buffName);
            inflictedEnemyDebuffs.push({
                buffName: status.payload.buffName,
                turnsRemaining: status.duration,
            });
        } else {
            // status.duration is guaranteed numeric by the timed variant.
            resistedAbilityTimedEnemy.push({
                buffName: status.payload.buffName,
                turnsRemaining: status.duration,
            });
            emitDebuffResisted(status.payload.buffName);
        }
    }

    // Caster-ctx resolver (Task 5): activeAbilityStatuses gates each aura/accum against ITS
    // CASTER's context. For the acting actor's OWN statuses (casterId === actor.id) the resolver
    // returns the local round ctx — byte-identical to the pre-Task-5 single-ctx call, so the
    // attacker-only path (where every casterId is the attacker) is zero-churn. For a FOREIGN
    // caster (an ally-cast aura sitting on this actor's side) it builds that caster's ctx from
    // its own snapshot + the shared enemy state, MEMOIZED per caster for this turn (cheap: one
    // snapshot read per distinct foreign caster). effectiveCritRate is 0 for foreign casters
    // (the per-round crit fold is local-only). The foreign ctx is independent of which local ctx
    // is passed, so one memo serves both the enemy-side (preDebuff) and self-side (postDebuff)
    // resolvers below.
    const foreignCtxMemo = new Map<string, ConditionContext>();
    const foreignCasterCtx = (casterId: string): ConditionContext => {
        let c = foreignCtxMemo.get(casterId);
        if (!c) {
            c = buildActorConditionContext(statusEngine, casterId, {
                corrosionEntryCount: corrosionEntries.length,
                infernoEntryCount: infernoEntries.length,
                bombCount: pendingBombs.length,
                enemyType,
                enemyHpPct,
                // Include the foreign caster's ability-sourced self statuses (e.g. its self-granted
                // gate buffs) so its own aura's gate sees them — matches the local priorAbilitySelfNames.
                includeAbilitySelfNames: true,
            });
            foreignCtxMemo.set(casterId, c);
        }
        return c;
    };
    const resolveCtx =
        (localCtx: ConditionContext) =>
        (casterId: string): ConditionContext =>
            casterId === actor.id ? localCtx : foreignCasterCtx(casterId);

    // Enemy-side ability statuses active this round, split by kind (Task 7):
    //  - TIMED (timedAbilityStatuses): already gated at application above; they
    //    persist their window unconditionally → folded WITHOUT a landing re-roll.
    //  - aura/accumulating (activeAbilityStatuses): conceptually re-applied each
    //    round → KEEP the per-round landing re-roll, with application respected.
    const timedAbilityEnemy = statusEngine.timedAbilityStatuses('enemy', actor.id, targetId);
    const recurringAbilityEnemy = statusEngine.activeAbilityStatuses(
        'enemy',
        resolveCtx(preDebuffGateCtx),
        actor.id,
        targetId
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
        effectiveCritRate: cappedCrit(critBuffForGates),
        enemyType,
        enemyHpPct,
        selfHpPct: selfHpPctArg,
        targetHpPct: targetHpPctArg,
        targetRepairedThisRound: targetRepairedThisRoundArg,
        enemyBuffNames: enemyBuffNamesArg,
        selfDebuffNames: selfDebuffNamesArg,
        turnsTaken: actor.turnsTaken,
    });
    for (const status of timedSelfBySlot) {
        if (status.sourceSlot !== action) continue;
        // The gate evaluates against THIS CASTER's post-debuff ctx (the status belongs to the
        // acting runtime — postDebuffGateCtx IS the caster's context). Once it passes, the status
        // is applied to EVERY recipient (Task 5): self → [caster]; ally/all-allies → all players.
        // The status lives on each recipient (decrements at the recipient's Post Turn; family +
        // persistent rules run per recipient side because applyTimedAbilityStatus threads
        // recipientId). buff-applied emits ONCE PER RECIPIENT with the recipient's actorId.
        if (!conditionsMet(status.conditions, postDebuffGateCtx)) continue;
        // recipients is set by the engine helper for every timed-by-slot status; default to
        // [actor.id] (self routing) for any caller that omitted it (statusEngine fixtures).
        for (const rid of status.recipients ?? [actor.id]) {
            // Block Buff: a recipient carrying it cannot receive new buffs. Covers self-buffs,
            // single-ally grants, and all-allies grants (each recipient guarded independently);
            // covers BOTH sides (enemies run this same path). Silent skip — no buff-applied emit.
            if (recipientCarriesBlockBuff(statusEngine, rid)) continue;
            statusEngine.applyTimedAbilityStatus(r, status, rid);
            bus.emit({
                type: 'buff-applied',
                actorId: rid,
                round: r,
                buffName: status.payload.buffName,
                duration: status.duration,
            });
        }
    }

    // (e) Effective self ability statuses this round (timed in-window + auras +
    // accumulating), gated vs postDebuffGateCtx. Fold their payloads into the self totals
    // exactly where scheduled buffs fold (toSimBuffs semantics).
    const selfAbilityStatuses: ActiveAbilityStatus[] = [
        ...statusEngine.timedAbilityStatuses('self', actor.id),
        ...statusEngine.activeAbilityStatuses('self', resolveCtx(postDebuffGateCtx), actor.id),
    ];
    const abilitySelfEffects = selfAbilityStatuses.map((s) => payloadToSelectedBuff(s.payload));
    // Stage layers 2+3 into the gate-only crit partial so the modifier gate (modifierCtx,
    // below) sees layers 1+2+3 — matching the pre-A1b staged critBuff at that point. The
    // full four-layer fold (and the other channels) is owned by effectiveDamageStatsOf.
    const abilityTotalsForGates = calculateBuffTotals(toSimBuffs(abilitySelfEffects));
    critBuffForGates += abilityTotalsForGates.critBuff;

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
    // the buff totals. The PRE-modifier crit estimate (cappedCrit(critBuffForGates), layers
    // 1+2+3) is used only for the rare self-crit-gated modifier condition, avoiding a
    // self-referential gate.
    const modifierCtx = buildRoundContext({
        selfBuffNames: activeSelfBuffNames,
        landedEnemyDebuffCount: landedEnemyDebuffs.length,
        corrosionEntryCount: corrosionEntries.length,
        infernoEntryCount: infernoEntries.length,
        bombCount: pendingBombs.length,
        effectiveCritRate: cappedCrit(critBuffForGates),
        enemyType,
        enemyHpPct,
        selfHpPct: selfHpPctArg,
        targetHpPct: targetHpPctArg,
        targetRepairedThisRound: targetRepairedThisRoundArg,
        enemyBuffNames: enemyBuffNamesArg,
        selfDebuffNames: selfDebuffNamesArg,
        selfShielded: actor.shieldPool > 0,
        turnsTaken: actor.turnsTaken,
    });
    const passiveSkill = shipSkills.slots.find((s) => s.slot === 'passive');
    const modifierAbilities = [
        ...(firingSkill?.abilities ?? []),
        ...(passiveSkill?.abilities ?? []),
    ];
    // Final four-layer effective-stat fold (layer 1 scheduledTotals + layers 2+3
    // abilitySelfEffects + layer 4 modifierAbilities gated by modifierCtx). The accessor
    // reproduces the prior inline fold byte-for-byte; the turn loop owns gating/side effects.
    const dmgStats = effectiveDamageStatsOf({
        base: { attack, defence, crit, critDamage, hp, defensePenetration, defensePenetrationBuff },
        scheduledTotals,
        abilitySelfEffects,
        modifierAbilities,
        modifierCtx,
    });
    const effectiveAttack = dmgStats.attack;
    // Full buff total at the final fold; equals the prior staged critBuff (layers 1+2+3+4).
    const effectiveCrit = cappedCrit(dmgStats.totals.critBuff);
    const effectiveCritDamage = dmgStats.critDamage;
    // Per-hit crit checks (game-verified 2026-06-06): each hit of a multi-hit skill
    // draws the deterministic crit gate INDIVIDUALLY. Draw count = the UNGATED firing
    // skill's hit count (schedule is cast-based like the old single draw — gating
    // never changes the number of draws; a skill with no damage ability keeps the
    // legacy hits=1 default → one draw, unchanged schedule). A noCrit attack draws
    // nothing (the gate does not advance — unchanged). Decided AFTER the modifier
    // fold-in so the draws use the final effective crit rate; modifierCtx above
    // deliberately keeps the probability-based estimate (see spec).
    // KNOWN LIMITATION (mirrors the noCrit caveat at the damageNoCrit read): the draw
    // count follows the UNGATED hit count — if the damage ability itself were
    // conditionally gated off, the gate would still advance. Not representable from
    // parser output today (gate conditions never land on active/charged damage).
    const drawHits = damageNoCrit ? 0 : damageInputsFromSkill(firingSkill).hits;
    const critGate = action === 'charged' ? chargedCritGate : activeCritGate;
    // D-PR4: per-hit outgoing amplification (Menace/Giant Slayer) on the firing hit only.
    // Sourced from the always-active passive slot. With no amplification ability OR no
    // engine-supplied proc gate, the loop never calls outgoingAmplificationForHit and the
    // weighted sums collapse to (nonCritHits, critHits) → byte-identical.
    const ampAbilities = (passiveSkill?.abilities ?? []).filter(
        (a) => a.config.type === 'outgoing-amplification'
    );
    const targetHigherAttack =
        args.targetEffectiveAttack !== undefined && args.targetEffectiveAttack > effectiveAttack;
    const rollOutgoingProc = args.rollOutgoingProc;
    let critHits = 0;
    const hitCrits: boolean[] = [];
    let ampNonCritWeight = 0;
    let ampCritWeight = 0;
    for (let h = 0; h < drawHits; h++) {
        const didCritHit = critGate(effectiveCrit / 100);
        if (didCritHit) critHits += 1;
        // Only collect per-hit outcomes when a damage ability actually exists.
        // The draw still advances the gate regardless (determinism preserved).
        if (hasDamageAbility) hitCrits.push(didCritHit);
        // Only call outgoingAmplificationForHit when amplification is actually present AND a
        // proc gate is supplied — keeps the critGate sequence and behaviour untouched otherwise.
        const amp =
            ampAbilities.length > 0 && rollOutgoingProc
                ? outgoingAmplificationForHit(
                      ampAbilities,
                      { didCrit: didCritHit, targetHigherAttack },
                      rollOutgoingProc
                  ) / 100
                : 0;
        if (didCritHit) ampCritWeight += 1 + amp;
        else ampNonCritWeight += 1 + amp;
    }
    // Any-hit binary: feeds ctx self-crit gates, the RoundData row, and didCrit.
    // on-crit triggers consume critHits (per-critting-hit), NOT this binary — see
    // registerReactiveListeners in triggers.ts.
    const roundCrit = critHits > 0;
    const effectivePen = dmgStats.effectivePen;
    const effectiveDefense =
        enemyDefense * (1 + enemyDefenseModifier / 100) * (1 - effectivePen / 100);
    const damageReduction = effectiveDefense > 0 ? calculateDamageReduction(effectiveDefense) : 0;

    // Step 1: Calculate direct damage
    const enemyDotMod = toEnemyDotModifier(roundEnemyDebuffs);
    // Ability-status self Out. DoT folds in per-round (KNOWN-DIFF b). Enemy Inc. DoT is
    // already inside enemyDotMod (roundEnemyDebuffs includes abilityEnemyEffects).
    const dotMult = 1 + (selfDotModifier + enemyDotMod + dmgStats.selfDotDamageModifier) / 100;
    const affinityMult = 1 + affinityDamageModifier / 100;
    const effectiveDefence = dmgStats.defence;
    const effectiveHp = dmgStats.hp;

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
        selfHpPct: selfHpPctArg,
        targetHpPct: targetHpPctArg,
        targetRepairedThisRound: targetRepairedThisRoundArg,
        enemyBuffNames: enemyBuffNamesArg,
        selfDebuffNames: selfDebuffNamesArg,
        // Thread the acting actor's live own-turn counter so cast-path `every-n-turns` gates
        // (on-cast/active/charged) evaluate against the real N — symmetric with the reactive
        // (end-of-turn) drain path, which already reads it via the turnsTakenFor delegate.
        turnsTaken: actor.turnsTaken,
    });

    // Hard gate: payload abilities whose conditions fail contribute nothing this
    // round. Walked in text order with a same-cast DoT overlay (see applyAbilities).
    const { gatedSkill, ctxFor } = gateFiringAbilities(firingSkill, ctx);

    // Control inflictions (e.g. Defiant's charged Stasis): emit `control-applied` so reactions
    // (on-stasis-applied) can fire. Emission ONLY — the engine does NOT simulate the control's
    // combat effect (Stasis/Taunt stay unmodelled). An emitted-but-unconsumed event changes
    // nothing, so DPS-mode goldens are unaffected.
    // Block Debuff (D-PR15): a control infliction is a debuff — when the target is immune, BLOCK
    // it (no `control-applied`, so on-stasis-applied reactions do NOT fire) and record a resist,
    // symmetric with the timed/persistent/DoT block paths.
    for (const ctrl of controlAbilitiesFromSkill(gatedSkill)) {
        if (ctrl.config.type === 'control') {
            if (targetImmuneToDebuffs) {
                emitBlockDebuffResist(bus, enemy.id, r, controlEffectLabel(ctrl.config.effect));
                continue;
            }
            bus.emit({
                type: 'control-applied',
                casterId: actor.id,
                effect: ctrl.config.effect,
                round: r,
            });
        }
    }

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
        // OWN charge gains: self-targeted (and unscoped) charge abilities from the firing skill
        // + the always-active passive slot. Bumps the caster only, capped at its own chargeCount.
        const bonusCharges =
            chargeGainFromSkill({ gatedSkill, ctxFor, fallbackCtx: ctx, targetFilter: 'own' }) +
            chargeGainFromSkill({
                gatedSkill: gatedPassive,
                ctxFor: passiveCtxFor,
                fallbackCtx: ctx,
                targetFilter: 'own',
            });
        actor.charges = Math.min(
            actor.charges + bonusCharges + (allyChargePerRound ?? 0),
            chargeCount
        );
    }
    // ALLY charge gains (Task 5): ally/all-allies-targeted charge abilities bump EVERY player
    // actor (incl. this caster), each capped at its OWN chargeCount. Sourced from the FIRING
    // skill (`gatedSkill`), active OR charged — a grant riding the charged skill (Hayyan) fires
    // on a charged turn just as an active-skill grant fires on an active turn; recipients receive
    // regardless of their own action state. Applied at the SAME sequence point as own gains.
    // Independent of hasChargedSkill: a caster with no charged skill of its own can still grant
    // charges to allies (Hermes pattern). The engine supplies grantAllyCharges, which performs
    // the per-actor cap-bump; absent (standalone callers) → no-op.
    if ((action === 'active' || action === 'charged') && grantAllyCharges) {
        const allyCharges =
            chargeGainFromSkill({ gatedSkill, ctxFor, fallbackCtx: ctx, targetFilter: 'ally' }) +
            chargeGainFromSkill({
                gatedSkill: gatedPassive,
                ctxFor: passiveCtxFor,
                fallbackCtx: ctx,
                targetFilter: 'ally',
            });
        if (allyCharges > 0) grantAllyCharges(allyCharges);
    }

    // ENEMY charge removal (Task 7): enemy/all-enemies-targeted charge abilities REMOVE charges
    // from every opposing actor (floored at 0, immune actors skipped). Sourced from the FIRING
    // skill + the always-active passive slot, both pre-gated; summed as a positive amount and
    // passed to removeEnemyCharges (the engine subtracts). Same active/charged sequence point as
    // own/ally gains. The engine supplies removeEnemyCharges (per-actor floor loop on the opposing
    // side); absent (standalone callers without an opposing roster) → no-op.
    if ((action === 'active' || action === 'charged') && removeEnemyCharges) {
        const enemyChargeRemoval =
            chargeGainFromSkill({ gatedSkill, ctxFor, fallbackCtx: ctx, targetFilter: 'enemy' }) +
            chargeGainFromSkill({
                gatedSkill: gatedPassive,
                ctxFor: passiveCtxFor,
                fallbackCtx: ctx,
                targetFilter: 'enemy',
            });
        if (enemyChargeRemoval > 0) removeEnemyCharges(enemyChargeRemoval);
    }

    // Extra-action grants (game-verified: a full extra turn; the engine re-inserts
    // this actor into the round's remaining queue by speed). Sourced from the FIRING
    // skill + the always-active passive slot, both pre-gated by gateFiringAbilities.
    const extraActionGrants = [
        ...extraActionsFromSkill(gatedSkill),
        ...extraActionsFromSkill(gatedPassive),
    ];

    const preCritDamage =
        effectiveAttack * ((effectiveMultiplier + conditionalBonusPct) / 100) + secondaryStatValue;
    // Blended per-hit crit multiplier: critHits of drawHits hits crit, each at the
    // full (1 + critDamage) multiplier. Algebraically identical to splitting the
    // skill multiplier + secondary + conditional bonus evenly across hits and
    // critting each hit individually — so totals match per-hit expectation without
    // restructuring the damage assembly. drawHits 0 (noCrit) → fraction 0 →
    // multiplier 1 (the "cannot critically hit" path, unchanged).
    const critFraction = drawHits > 0 ? critHits / drawHits : 0;
    // D-PR3 victim-side incoming %-reduction against the bound target (aggregate path).
    // Both default 0 → byte-identical to the prior fold.
    const equipNonCrit = args.incomingReductionNonCritPct ?? 0;
    const R = args.incomingReductionCritFamilyPct ?? 0;
    // D-PR3: crit-family reduction folds ADDITIVELY into the incoming channel for the CRIT
    // FRACTION only — consistent with the positional path (victimHitDamage). Expressed as a
    // ratio against the non-crit incoming factor so damageCritMultiplier * nonCritFactor stays
    // structurally valid and the passive-hit path is unaffected. R=0 → ratio 1 → byte-identical
    // to the prior expression. The crit fraction therefore sees incoming channel (incBase - R)
    // additively, exactly like positional victimHitDamage; the non-crit fraction sees incBase.
    // Redefining damageCritMultiplier (vs a separate factor) is correct: both downstream uses —
    // postDefenseFactor (firing hit) and passiveCritMultiplier (passive hit) — are the SAME enemy
    // attack against the SAME victim, so the victim's crit reduction applies to both.
    const incBase = incomingDamageModifier - equipNonCrit; // incoming channel for all hits
    const incDenom = 1 + incBase / 100;
    const critIncomingRatio = incDenom !== 0 ? (1 + (incBase - R) / 100) / incDenom : 1;
    const damageCritMultiplier =
        1 - critFraction + critFraction * (1 + effectiveCritDamage / 100) * critIncomingRatio;
    // Crit-independent damage pipeline (defense, outgoing/incoming, affinity) — shared
    // by the firing hit and the passive hit, which may differ in crit treatment (noCrit).
    // The incoming channel (incBase) folds the non-crit reduction additively; 0 → unchanged.
    const nonCritFactor =
        (1 - damageReduction / 100) *
        (1 + dmgStats.totals.outgoingDamageBuff / 100) *
        (1 + incBase / 100) *
        affinityMult;
    // D-PR4: per-hit outgoing amplification (Menace/Giant Slayer), firing hit only. Collapses to
    // damageCritMultiplier when no amplification fired (ampNonCritWeight=nonCritHits, ampCritWeight=critHits)
    // → byte-identical. critIncomingRatio carries D-PR3's crit-family incoming reduction.
    const amplifiedCritMultiplier =
        drawHits > 0
            ? (ampNonCritWeight +
                  ampCritWeight * (1 + effectiveCritDamage / 100) * critIncomingRatio) /
              drawHits
            : damageCritMultiplier;
    const postDefenseFactor = amplifiedCritMultiplier * nonCritFactor;
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
        ...(critHits > 0 ? { critHits } : {}),
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
    // Block Debuff (Task 6): when the turn target is immune, every cast-side DoT is
    // BLOCKED and recorded as a resist — and ONLY here. Normal DoT landing-roll
    // failures (the else branch) stay SILENT (no event), so the non-immune path is
    // byte-for-byte unchanged. `dotsLanded` is set false so the downstream display
    // surfaces the blocked DoTs as resisted (symmetric with timed/persistent resists).
    let dotsLanded: boolean;
    if (dotsConfig.length > 0 && targetImmuneToDebuffs) {
        dotsLanded = false;
        for (const dot of dotsConfig) {
            // NOTE: a blocked `bomb` DoT emits the resist event but has NO `resistedDots`
            // row — the engine's resistedDots derivation filters to corrosion/inferno only
            // (bombs are display-only elsewhere too). Event-yes/surface-no is intentional.
            emitBlockDebuffResist(bus, enemy.id, r, dotResistLabel(dot.type, dot.tier));
        }
    } else {
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
                affinityMult,
                detonationDamageModifier: dmgStats.detonationDamageModifier,
                sourceId: actor.id,
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
                        ...(critHits > 0 ? { viaCrit: true } : {}),
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
            applyAccumulators({ gatedSkill, pendingAccumulators, sourceId: actor.id });
        }
    }

    // On-cast purge (C2a/C2b-3): remove buffs from the acting actor's target. Keyed off targetId
    // (the opposing victim) → side-symmetric (works for player AND enemy casters; no
    // healEventOnly gate). gatedSkill holds the fired slot's abilities. DPS mode (dummy target,
    // no buffs) → no-op → byte-identical. NOT inside the args.healing gate.
    // conditionsMet() enforces any ability-level gates (e.g. Nayra's target-repaired-this-round
    // condition) so conditional purges only fire when their precondition holds.
    // E3: 'all-enemies' purge ability fans over the footprint victims (aoeVictimIds) instead of just targetId.
    if (targetId !== undefined) {
        for (const ab of gatedSkill?.abilities ?? []) {
            if (
                ab.config.type === 'purge' &&
                ab.trigger === 'on-cast' &&
                conditionsMet(ab.conditions, ctx)
            ) {
                // E3: an 'all-enemies' purge fans out to EVERY footprint victim (aoeVictimIds,
                // supplied by the engine in positional mode). Single-'enemy' purges — and any
                // caller without a footprint (non-positional) — stay on the single anchor
                // `targetId`. Each victim emits its own purge-performed (Salvation/Sefuba are
                // victim-scoped). (Amartya's per-victim COUNT scaling is E4; this ships at the
                // parsed count.)
                const recipients =
                    ab.target === 'all-enemies' && aoeVictimIds ? aoeVictimIds : [targetId];
                // E4: when the purge scales on crit power, total purged per victim =
                // count × floor(live effectiveCritDamage / per). effectiveCritDamage (~line 1104 =
                // dmgStats.critDamage) is the caster's LIVE crit power (buffs/debuffs folded),
                // integer percent (e.g. 150). Hoisted out of the victim loop — constant within a cast.
                const scaling = ab.config.countScaling;
                // Guard `per` (defensive: the parser only emits per≥1 from `\d+`, but a
                // hand-built config with per<=0/non-finite would make floor(x/per) Infinity/NaN).
                let purgeCount: number | 'all' = ab.config.count;
                if (
                    scaling &&
                    typeof ab.config.count === 'number' &&
                    Number.isFinite(scaling.per) &&
                    scaling.per > 0
                ) {
                    purgeCount =
                        ab.config.count *
                        Math.max(0, Math.floor(effectiveCritDamage / scaling.per));
                }
                for (const vid of recipients) {
                    const removed = statusEngine.purge(vid, purgeCount);
                    if (removed > 0) {
                        bus.emit({
                            type: 'purge-performed',
                            casterId: actor.id,
                            targetId: vid,
                            count: removed,
                            round: r,
                        });
                    }
                }
            }
        }
    }

    // ====================================================================
    // HEALING MODE — heal/shield/cleanse consumption against the live heal
    // target (healing-calc adoption). FULLY GATED on `args.healing`: DPS mode
    // never supplies it, so this block is inert there (goldens byte-identical).
    // Runs at a fixed sequence point AFTER all DoT-application steps and BEFORE
    // the turnCtx assembly. Processes gated firing + passive abilities in array
    // order; heals draw the SEPARATE per-actor heal crit gate (never the damage
    // crit gate). HoT (hotHeal) ticking is Task 7 — not produced here.
    // ====================================================================
    if (args.healing) {
        const healing = args.healing;
        const healCritGate = action === 'charged' ? chargedHealCritGate : activeHealCritGate;
        // Recipient's incoming-heal %: the acting actor reads its own LOCAL folded total;
        // any other recipient resolves through lastTurnCtxByActor (may be stale/base for a
        // non-target non-self recipient — an accepted approximation, see plan).
        const incomingPctFor = (rid: string): number =>
            rid === actor.id
                ? dmgStats.totals.incomingHealBuff
                : healing.recipientIncomingHealPct(rid);
        // D-PR5: caster-side heal-cast amplification (Nourishment/Vivacious), sourced from the
        // passive slot. Per recipient, fold (1 + ampPct/100) into the cast-heal raw. With no
        // heal-amplification ability OR no engine-supplied proc gate, the guard short-circuits to
        // 0 (and never rolls) → byte-identical for every fixture without one.
        const healAmpAbilities = (passiveSkill?.abilities ?? []).filter(
            (a) => a.config.type === 'heal-amplification'
        );
        // Recipient HP% at cast time: live ctx via recipientActor/recipientMaxHp; fall back to the
        // engine-threaded targetHpPct for the heal target before it has a ctx, else 100.
        const recipientHpPctFor = (rid: string): number => {
            const max = healing.recipientMaxHp(rid);
            const a = healing.recipientActor(rid);
            if (a && max > 0) return (100 * Math.max(0, a.currentHp)) / max;
            if (rid === healing.targetId) return targetHpPctArg;
            return 100;
        };
        // Summed amp % for ONE cast on recipient `rid`. Rolls each ability's proc gate exactly
        // once (call this ONCE per recipient per cast). selfHpPctArg = the caster's live HP%.
        const healAmpPctFor = (rid: string): number =>
            healAmpAbilities.length > 0 && rollOutgoingProc
                ? healAmplificationForCast(
                      healAmpAbilities,
                      { targetHpPct: recipientHpPctFor(rid), selfHpPct: selfHpPctArg },
                      rollOutgoingProc
                  )
                : 0;
        // Recipient routing (user-confirmed): self → caster; ally → the bombarded target;
        // all-allies → every player in fixed source order. Shared by the heal + shield branches.
        const isEnemyCaster = actor.side === 'enemy';
        // Lowest-HP-fraction living enemy ally for an enemy single-'ally' heal (E5).
        // Deterministic: ties broken by enemyIds source order. Falls back to the caster
        // when no other living ally exists. NEVER routes to the player heal target.
        const lowestHpEnemyAllyId = (): string | undefined => {
            let best: string | undefined;
            let bestFrac = Infinity;
            for (const id of healing.enemyIds) {
                if (id === actor.id) continue; // caster is the fallback only, never a primary candidate
                const a = healing.recipientActor(id);
                if (!a || a.currentHp <= 0) continue;
                const maxHp = healing.recipientMaxHp(id);
                const frac = maxHp > 0 ? a.currentHp / maxHp : 0;
                if (frac < bestFrac) {
                    bestFrac = frac;
                    best = id;
                }
            }
            return best ?? actor.id;
        };
        const recipientsFor = (target: Ability['target']): string[] => {
            if (target === 'self') return [actor.id];
            if (target === 'all-allies')
                return isEnemyCaster ? healing.enemyIds : healing.playerIds;
            if (isEnemyCaster) {
                const rid = lowestHpEnemyAllyId();
                return rid ? [rid] : [];
            }
            return [healing.targetId];
        };
        // Basis value for a heal/shield ability against recipient `rid`.
        const basisValue = (
            basis:
                | 'hp'
                | 'attack'
                | 'defense'
                | 'target-hp'
                | 'damage-dealt'
                | 'damage-taken'
                | 'overheal',
            rid: string
        ): number => {
            switch (basis) {
                case 'attack':
                    return effectiveAttack;
                case 'defense':
                    return effectiveDefence;
                case 'target-hp':
                    return healing.recipientMaxHp(rid);
                // Cast rider (active/charged 'damage-dealt'): this turn's own cast damage —
                // the local directDamage (incl. secondary/conditional sub-buckets and the
                // passive hit; detonation excluded by spec). The slot-partition guard below
                // keeps passive-slot 'damage-dealt' and all 'damage-taken' abilities off the
                // cast path, so basisValue only sees 'damage-dealt' for active/charged riders;
                // 'damage-taken' never reaches here.
                case 'damage-dealt':
                    return directDamage;
                case 'damage-taken':
                    throw new Error(
                        'basisValue: damage-taken must not reach the cast path (slot-partition guard owns it)'
                    );
                // 'overheal' is a reactive-only basis (on-own-repair-to-ally; Abundant Renewal):
                // the clipped over-repair is known only at drain time via eventCtx.overhealAmount,
                // so it never reaches the cast path.
                case 'overheal':
                    throw new Error(
                        'basisValue: overheal must not reach the cast path (reactive-only basis)'
                    );
                case 'hp':
                default:
                    return effectiveHp;
            }
        };

        // ── HoT (Repair Over Time) ticking ──────────────────────────────────────────
        // Ordering note (RECORDED APPROXIMATION, pending in-game verification — coverage doc §6):
        // these ticks fire here, BEFORE this turn's cast heals, but the HoT SOURCES are read
        // AFTER this turn's own status/buff applications. Consequence: a HoT a ship grants to
        // ITSELF this turn already appears in selfAbilityStatuses/activeSelfBuffs and therefore
        // ticks on its OWN cast turn (not only on subsequent turns). The healing goldens lock
        // this behaviour; do not change it without re-validating the in-game rule.
        // The HOLDER (this acting actor) heals each of its own turns for
        // applierEffectiveMaxHp × hotPct% × stacks, attributed to the APPLIER's hotHeal
        // bucket (mirrors DoT sourceId attribution). HoT heals NEVER crit and ignore
        // healModifier/outgoingHeal (they are the applier's standing effect, not a cast),
        // but DO get the HOLDER's incomingHeal amplification (dmgStats.totals.incomingHealBuff,
        // since the holder is the acting actor). Holder === target → the consumption split
        // (applyHealToTarget) is credited to the APPLIER's effectiveHeal/overheal.
        //
        // Applier max HP at tick time:
        //  - applier === this acting actor (self-granted HoT) → local effectiveHp.
        //  - foreign applier → healing.applierMaxHp(applierId); undefined → SKIP the tick
        //    (strict corrosion rule, NO base-stat fallback).
        //  - scheduled HoT (no caster identity) → applier = the holder itself (local effectiveHp).
        //
        // Sources are DISJOINT (no double-count): payload-carrying ability statuses
        // (selfAbilityStatuses = timed + active, payload.parsedEffects.hotPct × payload.stacks,
        // applier = status.casterId) and scheduled snapshot buffs (entry.activeSelfBuffs ×
        // selfBuffLookup, expanded SelectedGameBuff.parsedEffects.hotPct × stacks, applier = holder).
        const holderIncomingFactor = 1 + dmgStats.totals.incomingHealBuff / 100;
        // Resolve the applier's effective max HP for a HoT tick; undefined → caller skips.
        const hotApplierMaxHp = (applierId: string | undefined): number | undefined => {
            if (applierId === undefined || applierId === actor.id) return effectiveHp;
            return healing.applierMaxHp(applierId);
        };
        // Credit one HoT tick (raw = applierMaxHp × hotPct% × stacks × holderIncomingFactor)
        // to the applier's hotHeal bucket, and route consumption (holder === target) to the
        // applier's effectiveHeal/overheal.
        const tickHot = (applierId: string | undefined, hotPct: number, stacks: number): void => {
            if (hotPct <= 0 || stacks <= 0) return;
            const maxHp = hotApplierMaxHp(applierId);
            if (maxHp === undefined) return; // foreign applier with no ctx yet → skip the tick
            // Scheduled HoT (no caster) attributes to the holder; otherwise to the applier.
            const creditId = applierId ?? actor.id;
            let raw = maxHp * (hotPct / 100) * stacks * holderIncomingFactor;
            // D-PR6: recipient-side incoming-heal amplification (Exuberance) — the HoT recipient is
            // the holder (actor.id). Rolls its combat-lifetime gate ONCE per tick (0 → byte-identical).
            raw *= 1 + (healing.recipientIncomingHealAmpPct?.(actor.id) ?? 0) / 100;
            if (raw <= 0) return;
            healing.credit(creditId, 'hotHeal', raw);
            // Holder === target → the heal lands on the target; split consumption to the applier.
            if (actor.id === healing.targetId) {
                const { consumed, overheal } = healing.applyHealToTarget(raw);
                healing.credit(creditId, 'effectiveHeal', consumed);
                healing.credit(creditId, 'overheal', overheal);
            }
        };
        // Event-only (enemy) mode: HoT ticking must not credit or apply to the player healing map.
        if (!healEventOnly) {
            // (a) Payload-carrying ability HoT statuses on this holder (applier = status.casterId).
            // payload.stacks already folds accumulating per-round counts / timed configured stacks.
            for (const s of selfAbilityStatuses) {
                const hotPct = s.payload.parsedEffects.hotPct;
                if (!hotPct) continue;
                tickHot(s.casterId, hotPct, s.payload.stacks);
            }
            // (b) Scheduled snapshot HoTs (applier = the holder itself). Mirror resolveSelfBuffTotals'
            // lookup consumption: expandBuffs applies the per-round stack override, so the expanded
            // SelectedGameBuff carries the effective stacks already.
            for (const ab of entry.activeSelfBuffs) {
                for (const b of expandBuffEntry(ab, selfBuffLookup.get(ab.buffName) ?? [])) {
                    const hotPct = b.parsedEffects?.hotPct;
                    if (!hotPct) continue;
                    tickHot(undefined, hotPct, b.stacks ?? 1);
                }
            }
        }

        // Slot partition (damage-leech): passive-slot 'damage-dealt' abilities are standing
        // leeches owned by the ENGINE's credit hook (engine.ts) — processing them here would
        // double-count the cast's direct portion. 'damage-taken' abilities (any slot) are
        // owned by the enemy-attack block. Both are skipped on the cast path.
        // Only heal/shield abilities can be hook-owned; other ability types pass
        // through (the heal loop ignores them anyway).
        const isHookOwned = (a: Ability, fromPassive: boolean): boolean => {
            const c = a.config;
            if (c.type !== 'heal' && c.type !== 'shield') return false;
            if (c.basis === 'damage-taken') return true;
            return c.basis === 'damage-dealt' && fromPassive;
        };
        // Event-only mode (enemy walk, Task 5; HP-restore lifted in E5 §4.1): EMIT heal/cleanse
        // events and (E5) restore each heal recipient's OWN currentHp via the per-victim pool,
        // but credit NO player healing bucket and never mutate the player heal-target. Shields
        // and cleanse still mutate NOTHING on the enemy path (deferred to sub-projects H / enemy
        // cleanse). Scope to the CAST skill only (the spec: "the cast skill carries"), never the
        // passive. Normal (player/team) mode keeps both slots and credits/mutates as before.
        const healAbilities = healEventOnly
            ? (gatedSkill?.abilities ?? []).filter((a) => !isHookOwned(a, false))
            : [
                  ...(gatedSkill?.abilities ?? []).filter((a) => !isHookOwned(a, false)),
                  ...(gatedPassive?.abilities ?? []).filter((a) => !isHookOwned(a, true)),
              ];
        const healTargets: string[] = [];
        let healCritCount = 0;
        let healRawSum = 0;
        // H3.3: summed clipped excess (overheal) across this cast's repairs on the heal target.
        // Carried on heal-performed.overheal for an `overheal`-basis reactive shield (Abundant Renewal).
        let overhealSum = 0;
        let cleansePerformedCount = 0;

        for (const ability of healAbilities) {
            const cfg = ability.config;
            if (cfg.type === 'heal') {
                const recipients = recipientsFor(ability.target);
                if (healEventOnly) {
                    // E5 §4.1: enemy heals restore each recipient's OWN currentHp (via the
                    // per-victim pool), fire repairedThisRound, and emit heal-performed — but
                    // contribute NOTHING to the player healing buckets (no healing.credit).
                    const didCrit = cfg.noCrit ? false : healCritGate(effectiveCrit / 100);
                    if (didCrit) healCritCount += 1;
                    for (const rid of recipients) {
                        const basis = basisValue(cfg.basis, rid);
                        let raw =
                            basis *
                            (cfg.pct / 100) *
                            (didCrit ? 1 + effectiveCritDamage / 100 : 1) *
                            (1 + healModifier / 100) *
                            (1 + dmgStats.totals.outgoingHealBuff / 100) *
                            (1 + incomingPctFor(rid) / 100);
                        // D-PR5: caster heal-cast amplification (rolls the proc gate ONCE per recipient).
                        raw *= 1 + healAmpPctFor(rid) / 100;
                        // D-PR6: recipient-side incoming-heal amplification (Exuberance) — rolls the
                        // recipient's combat-lifetime gate ONCE per applied repair (0 → byte-identical).
                        raw *= 1 + (healing.recipientIncomingHealAmpPct?.(rid) ?? 0) / 100;
                        const recipientActor = healing.recipientActor(rid);
                        if (recipientActor) healing.applyHealToTarget(raw, recipientActor);
                        // overheal intentionally NOT accumulated here — enemy-side reactive
                        // overheal (overheal-basis shields) is a deferred gap; H3.3 surfaces
                        // overheal only on the player heal path above.
                        healTargets.push(rid);
                        healRawSum += raw;
                    }
                    continue;
                }
                // ONE crit draw per heal ability (not per recipient).
                const didCrit = cfg.noCrit ? false : healCritGate(effectiveCrit / 100);
                if (didCrit) healCritCount += 1;
                for (const rid of recipients) {
                    const basis = basisValue(cfg.basis, rid);
                    let raw =
                        basis *
                        (cfg.pct / 100) *
                        (didCrit ? 1 + effectiveCritDamage / 100 : 1) *
                        (1 + healModifier / 100) *
                        (1 + dmgStats.totals.outgoingHealBuff / 100) *
                        (1 + incomingPctFor(rid) / 100);
                    // D-PR5: caster heal-cast amplification (rolls the proc gate ONCE per recipient).
                    raw *= 1 + healAmpPctFor(rid) / 100;
                    // D-PR6: recipient-side incoming-heal amplification (Exuberance) — rolls the
                    // recipient's combat-lifetime gate ONCE per applied repair (0 → byte-identical).
                    raw *= 1 + (healing.recipientIncomingHealAmpPct?.(rid) ?? 0) / 100;
                    healing.credit(actor.id, 'directHeal', raw);
                    if (rid === healing.targetId) {
                        const { consumed, overheal } = healing.applyHealToTarget(raw);
                        healing.credit(actor.id, 'effectiveHeal', consumed);
                        healing.credit(actor.id, 'overheal', overheal);
                        overhealSum += overheal;
                    }
                    healTargets.push(rid);
                    healRawSum += raw;
                }
            } else if (cfg.type === 'shield') {
                // Event-only: shields are not repairs → no heal-performed recipient, no numeric.
                // Skip entirely (no credit/grant).
                if (healEventOnly) continue;
                // Shields aren't repairs (documented assumption): NO crit, NO healModifier/
                // outgoingHeal/incomingHeal channels — raw = basis × pct.
                const recipients = recipientsFor(ability.target);
                // H3.6: collect the per-recipient REAL pool growth so we emit ONE shield-applied
                // per cast (NOT per recipient) carrying only recipients that actually gained pool.
                const shieldRecipientIds: string[] = [];
                let shieldGrantedSum = 0;
                for (const rid of recipients) {
                    const raw = basisValue(cfg.basis, rid) * (cfg.pct / 100);
                    healing.credit(actor.id, 'shield', raw);
                    // H1 Task 5: route the pool to EACH targeted ally's own actor (mirrors the
                    // event-only heal branch's recipientActor routing) — not just the heal
                    // target. The absorb side already works per-actor, so an `all-allies`/`ally`
                    // shield must land a `shieldPool` on every targeted ally, not only the focus.
                    // A recipient with no resolvable runtime actor is credited but not pool-applied
                    // (mirrors the heal-recipient handling for an unwalked legacy team actor).
                    const recipientActor = healing.recipientActor(rid);
                    if (recipientActor) {
                        const granted = healing.grantShieldToTarget(raw, recipientActor);
                        if (granted > 0) {
                            shieldRecipientIds.push(rid);
                            shieldGrantedSum += granted;
                        }
                    }
                }
                // H3.6: emit ONE shield-applied per shield CAST, keyed on the caster, listing only
                // recipients whose pool actually grew (granted > 0). Drives Resonating Fury
                // (on-shield-applied). No recipient gained pool → no event. Mirrors the
                // heal-performed emit below. NOTE: enemy event-only shields `continue` above
                // (healEventOnly) before reaching here, so they never emit — consistent with the
                // engine not modeling enemy-side shield pools.
                if (shieldRecipientIds.length > 0) {
                    bus.emit({
                        type: 'shield-applied',
                        granterId: actor.id,
                        recipientIds: shieldRecipientIds,
                        round: r,
                        amount: shieldGrantedSum,
                    });
                }
            } else if (cfg.type === 'cleanse') {
                // Real removal is player-side only (recipientsFor returns player ids; enemy-side
                // actors run event-only and side-correct enemy routing is deferred). The metric
                // and the cleanse-performed event reflect the ACTUAL number removed.
                if (!healEventOnly) {
                    let removed = 0;
                    for (const rid of recipientsFor(ability.target)) {
                        removed += statusEngine.cleanse(rid, cfg.count);
                    }
                    cleansePerformedCount += removed;
                    healing.credit(actor.id, 'cleanseCount', removed);
                } else {
                    // Enemy-side event-only: no removal yet — preserve the cleanse-performed
                    // cadence so on-enemy-cleansed reactors (Arum/Grif) stay unaffected.
                    cleansePerformedCount += typeof cfg.count === 'number' ? cfg.count : 1;
                }
            }
        }

        // ONE heal-performed per cast that healed at least one recipient. critHits is the
        // number of heal abilities that crit (present-only-when-positive). In event-only
        // (enemy) mode E5 §4.1 now computes the numeric, so amount/critHits reflect the real
        // enemy heal (the player healing buckets stay uncredited — see the healEventOnly note above).
        if (healTargets.length > 0) {
            bus.emit({
                type: 'heal-performed',
                casterId: actor.id,
                targets: healTargets,
                round: r,
                amount: healRawSum,
                ...(healCritCount > 0 ? { critHits: healCritCount } : {}),
                ...(overhealSum > 0 ? { overheal: overhealSum } : {}),
            });
        }

        // ONE cleanse-performed per cast that cleansed (BOTH modes — the on-enemy-cleansed
        // listener filters by side, so the player-side emit is inert without an enemy reactor).
        if (cleansePerformedCount > 0) {
            bus.emit({
                type: 'cleanse-performed',
                casterId: actor.id,
                count: cleansePerformedCount,
                round: r,
            });
        }
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

    // Round-scoped context the enemy's DoT-processing turn needs (this actor's). With a
    // faster enemy the enemy reads the PREVIOUS round's context; at default speeds the
    // player always precedes the enemy. The caller stores it in lastTurnCtxByActor[actor.id].
    const turnCtx: PlayerRoundCtx = {
        effectiveAttack,
        dotMult,
        affinityMult,
        effectiveDefence,
        effectiveMaxHp: effectiveHp,
        outgoingHealPct: dmgStats.totals.outgoingHealBuff,
        incomingHealPct: dmgStats.totals.incomingHealBuff,
    };

    // Per-cast attacker-side scalars for the positional apply path (Task 7). Sourced from
    // the SAME locals that assemble the aggregate `directDamage` above (preCritDamage +
    // postDefenseFactor): effectiveMultiplier ALREADY folds the hit count, so multiplierPct
    // is `effectiveMultiplier + conditionalBonusPct` and `hits` re-splits it per hit inside
    // victimHitDamage. attackerAffinity is the RAW affinity (the runtime's numeric
    // affinityDamageModifier is pre-resolved vs the bound enemy and can't be inverted);
    // defaults to neutral 'antimatter' when unset → modifier 0, matching the default matchup.
    // Only present when a damage ability actually fired (else there is nothing to apply).
    const positionalScalars: AttackerDamageScalars | undefined = hasDamageAbility
        ? {
              effectiveAttack,
              multiplierPct: effectiveMultiplier + conditionalBonusPct,
              secondaryStatValue,
              hits,
              effectiveCritDamage,
              outgoingDamageBuffPct: dmgStats.totals.outgoingDamageBuff,
              incomingDamageModifierPct: incomingDamageModifier,
              defensePenetrationPct: effectivePen,
              attackerAffinity: attackerAffinity ?? actor.affinity ?? 'antimatter',
          }
        : undefined;

    return {
        action,
        roundCrit,
        hitCrits,
        enemyHpPct,
        dotsConfig,
        dotsLanded,
        activeSelfBuffs: activeSelfBuffsForRound,
        landedEnemyDebuffs,
        inflictedEnemyDebuffs,
        resistedEnemyDebuffs,
        directDamage,
        secondaryDamage,
        conditionalDamage,
        detonationDamage,
        extraActionGrants,
        positionalScalars,
        turnCtx,
    };
}
