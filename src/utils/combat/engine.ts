import {
    CombatStatBlock,
    EnemyBaseClass,
    SelectedGameBuff,
    TeamActorInput,
} from '../../types/calculator';
import type { ShipTypeName } from '../../constants/shipTypes';
import { Ability, AbilityTarget, ShipSkills } from '../../types/abilities';
import type { Position } from '../../types/encounters';
import type { AffinityName } from '../../types/ship';
import type { ParsedTarget, ParsedPattern } from '../targetingParser';
import { makeRateGate, rollRateGate } from '../calculators/rateAccumulator';
import type { RoundData } from '../calculators/dpsSimulator';
import { toEnemyModifiers, toSelfIncomingDamageModifier } from '../calculators/dpsBuffHelpers';
import {
    type ExtraActionGrant,
    selectFiringSkill,
    damageInputsFromSkill,
} from '../abilities/applyAbilities';
import { conditionsMet } from '../abilities/evaluateConditions';
import { foldActorBuffTotals, effectiveStatsOf } from './effectiveStats';
import {
    ActiveDoTStack,
    ActorDamage,
    ActorHealing,
    CombatActor,
    PendingAccumulator,
    PendingBomb,
    createActor,
    selectNextBySpeed,
    MAX_SELECTION_TICKS,
    emptyActorDamage,
    emptyActorHealing,
    advanceChargeCadence,
    recordDestroyed,
} from './state';
import {
    ActiveBuff,
    AbilityStatusPayload,
    RegisteredAbilityStatus,
    StatusEngine,
    createStatusEngine,
} from './statusEngine';
import { liveGateConditions } from './abilityStatusGating';
import { isPositional, resolvePositionalTarget } from './positionalBinding';
import {
    applyPositionalDamage,
    footprintVictims,
    type VictimDamageOutcome,
} from './positionalApply';
import type { AttackerDamageScalars } from './victimDamage';
import { incomingReductionForHit, incomingBlockForIntake } from './incomingEffects';
import { outgoingAmplificationForHit } from './outgoingEffects';
import { incomingHealAmpForRecipient } from './healAmplification';
import { CHEAT_DEATH_BUFFS } from './cheatDeathBuffs';
import { BARRIER_BUFFS } from './barrierBuffs';
import { isStasis, STASIS_BUFFS } from './stasisBuffs';
import { isDisable } from './disableBuffs';
import { highestAttackAmong } from './highestAttack';
import { CombatEventBus, createEventBus } from './events';
import { normalizeTeamActorsToWalked } from './teamActorWalk';
import {
    HealingRuntimeCtx,
    PlayerActorRuntime,
    PlayerRoundCtx,
    PlayerTurnResult,
    RateGate,
    runPlayerTurn,
} from './playerTurn';
import {
    Intent,
    MAX_INTENT_GENERATIONS,
    buildActorConditionContext,
    buildForcedTargetingStatus,
    executeIntent,
    ownerDebuffNamesFor,
    partitionReactiveAbilities,
    provokerOf,
    registerReactiveListeners,
    selfBuffNamesForOwners,
    victimEnemyBuffs,
    victimSelfBuffs,
} from './triggers';
import { adjacentAllyIds } from './adjacency';

/** Backstop for pathological extra-action loops (a non-once-per-round grant whose
 *  conditions stay true re-fires on the extra turn it granted). Real texts are
 *  self-limited (charged-skill grants consume charges; passive grants are once per
 *  round), so any round needing more than this is a config/parser bug. */
const MAX_EXTRA_TURNS_PER_ROUND = 8;

/**
 * Sum an actor's LIVE speed-buff percentage from the status engine (Task 2 authority for
 * effectiveSpeedOf; pure read, no mutation). Folds the same two sources the per-actor buff
 * fold uses, keyed by owner id so it is correct for any actor on either side:
 *   1. Scheduled self-buffs: snapshot(actorId).activeSelfBuffs, each expanded via selfBuffLookup
 *      (accumulating buffs override their static stacks with the per-round count; 0 → dropped).
 *   2. Timed ability statuses: timedAbilityStatuses('self', actorId), each payload wrapped via
 *      payloadToSelectedBuff.
 * Both fold through toSimBuffs → calculateBuffTotals, summing only `.speedBuff`.
 *
 * Task 0 corpus investigation: every corpus speed buff (Speed Up I/II/III, Speed Down I/II,
 * XAOC Swiftness I/II/III) is an UNCONDITIONAL timed status grant — there is NO conditional/
 * gated speed buff, NO always-active/aura speed buff, and NO standing speed modifier — so the
 * ctx-gated activeAbilityStatuses path and a ModifierChannel speed entry are intentionally
 * omitted. Returns a percentage (e.g. 30 for +30%); effective speed is uncapped.
 */
export function foldSpeedBuffPct(
    statusEngine: StatusEngine,
    selfBuffLookup: Map<string, SelectedGameBuff[]>,
    actorId: string
): number {
    return foldActorBuffTotals(statusEngine, selfBuffLookup, actorId).speedBuff;
}

// Classify ONE actor's cast buff/debuff abilities into timed/aura/accumulating statuses
// and register them under the correct status-engine recipients. Returns the timed-by-slot
// lists (applied when that caster's slot fires). Extracted from the attacker's inline loop
// (Task 4); Task 5 makes the routing real (see below).
//
// Classification (spec): accumulating (stackTrigger && isStackable) → accumulating maps,
// effect inclusion aura-gated; aura (recurring/undefined duration) → per-round effect gate;
// timed (finite duration) → gated at application. A finite-duration passive buff is timed (NOT
// an aura): it is a one-time combat-start window ("gains X for N turns"), seeded once in the
// round-1 loop and then decrementing on the owner's normal timed lifecycle.
//
// TARGET ROUTING (Task 5): the binary side computation becomes recipient routing —
//   enemy/all-enemies → 'enemy' side (recipients ignored, enemy maps are singular);
//   self              → recipients [casterId] (the owner only);
//   ally/all-allies   → recipients = ALL player ids (`playerIds`, a FIXED source order
//                       [focusActorId, ...team ids in input order] — independent of which
//                       actor cast, so application order is deterministic).
// `casterId` (== this caster's ownerId) is stamped on every status so its gate evaluates
// against the caster's ctx even when the status lives on another recipient.
//
// AURA/ACCUMULATING fan-out: the engine fans these out by calling
// statusEngine.registerAbilityStatuses(...) ONCE PER RECIPIENT (keeping the statusEngine API
// stable). Each recipient gets its own per-owner aura/accum store entry carrying the same
// casterId. Timed statuses are NOT registered here — they apply lazily per recipient via
// applyTimedAbilityStatus at the firing site (playerTurn loops `status.recipients`).
//
// KNOWN APPROXIMATION (documented, not fixed this task): a team-cast all-allies ACCUMULATING
// status registered onto the attacker's store ticks per-active/per-charge on the ATTACKER's
// cadence (sourceFired increments only the 'attacker' map for per-slot triggers). Per-caster
// cadence tracking is out of scope here; per-round increments tick every owner's map already.
//
// Zero-churn: for an attacker-only run playerIds = ['attacker'], so self and ally/all-allies
// both yield recipients ['attacker'] and casterId 'attacker' — identical to the pre-Task-5
// owner-routing (one registration onto the attacker's store).
function registerActorAbilityStatuses(
    castSkills: ShipSkills,
    statusEngine: ReturnType<typeof createStatusEngine>,
    ownerId: string,
    // Same-side ally-recipient order for `ally`/`all-allies` cast buffs: player ids for player
    // actors, enemy attacker ids for enemy actors. Named `playerIds` historically; for enemy
    // actors the engine passes the enemy team's ids so cross-enemy buffs land on the enemy side.
    playerIds: string[],
    // Heal target id (healing mode) — the recipient a single-`ally` Cheat-Death-family
    // firing-slot grant narrows to (Hermes shape). Absent (DPS mode / no heal target) →
    // the carve-out falls back to [ownerId]. Irrelevant for every non-carve-out status.
    healTargetId?: string
): {
    timedSelfBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[];
    timedEnemyBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[];
} {
    // Aura/accumulating statuses to register, grouped per RECIPIENT owner id (the engine fans
    // them out with one registerAbilityStatuses call per recipient). Timed statuses are applied
    // lazily and tracked via timedSelfBySlot/timedEnemyBySlot — they carry recipients on the
    // status object for the per-recipient application loop in playerTurn.
    const byRecipient = new Map<string, RegisteredAbilityStatus[]>();
    const pushFor = (rid: string, status: RegisteredAbilityStatus) => {
        let list = byRecipient.get(rid);
        if (!list) {
            list = [];
            byRecipient.set(rid, list);
        }
        list.push(status);
    };
    const timedSelfBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[] = [];
    const timedEnemyBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[] = [];
    for (const slot of castSkills.slots) {
        for (const ability of slot.abilities) {
            const cfg = ability.config;
            if (cfg.type !== 'buff' && cfg.type !== 'debuff') continue;
            const side: 'self' | 'enemy' =
                ability.target === 'enemy' || ability.target === 'all-enemies' ? 'enemy' : 'self';
            const accumulating = !!cfg.stackTrigger && cfg.isStackable;
            // Cheat-Death-family grants from a FIRING slot (Hermes/Hayyan charged skills) are
            // cast-path persistent grants, NOT always-on auras: they apply when the slot fires
            // (per-slot timed loop in playerTurn, gated by conditionsMet at cast time) and never
            // expire (duration Infinity; the intercept consumes them via cheatDeathConsumed).
            // Scoped to CHEAT_DEATH_BUFFS — other firing-slot recurring buffs (Panon, Sansi,
            // Sentinel, Oleander…) keep the aura model for now (documented in coverage §5).
            const castPathCheatDeath =
                !accumulating &&
                CHEAT_DEATH_BUFFS.has(cfg.buffName) &&
                (slot.slot === 'active' || slot.slot === 'charged');
            // Player-side recipients (self vs ally/all-allies). Enemy-side statuses ignore this
            // (recipients are only consulted on the self side). Self → caster only; ally/all-allies
            // → every player actor (fixed source order). `playerIds` already includes the caster.
            // CARVE-OUT (castPathCheatDeath only): a single-`ally` grant narrows to the heal target
            // (Hermes "grants Cheat Death to the lowest-HP ally"), fallback [ownerId] when no heal
            // target; `all-allies` (Hayyan) keeps every player. The global ally → all-players rule
            // for every OTHER cast-path buff is UNCHANGED.
            const recipients: string[] =
                side === 'enemy'
                    ? [] // enemy-side statuses have no player recipients; the timed-enemy application path never reads recipients
                    : castPathCheatDeath && ability.target === 'ally'
                      ? [healTargetId ?? ownerId]
                      : ability.target === 'ally' || ability.target === 'all-allies'
                        ? playerIds
                        : [ownerId];
            const isAura =
                !accumulating &&
                !castPathCheatDeath &&
                (cfg.duration === 'recurring' || cfg.duration === undefined);
            const payload: AbilityStatusPayload = {
                buffName: cfg.buffName,
                stacks: cfg.stacks,
                parsedEffects: cfg.parsedEffects,
                ...(cfg.type === 'debuff' ? { application: cfg.application } : {}),
            };
            // `as const` keeps the literal types (side, sourceSlot) so the spread into
            // a union variant below doesn't widen them — runtime object is unchanged.
            // casterId/recipients (Task 5) carry the ally-routing decision on the status.
            const base = {
                payload,
                side,
                sourceSlot: slot.slot,
                conditions: liveGateConditions(ability.conditions),
                casterId: ownerId,
                recipients,
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
                // NOTE: persistent-stacking names (PERSISTENT_STACKING_BUFFS) should never
                // reach the aura arm with current data — their cast applications either carry
                // a stackTrigger (accumulating, climbs + caps there) or a reactive trigger
                // (partitioned out before this loop; the executor routes them to the
                // persistent map). If one ever lands here it would become a per-round
                // re-rolled aura and silently lose persistence — see persistentStackingBuffs.ts.
                status = { ...base, kind: 'aura' };
            } else {
                // timed: cfg.duration is a number here (NOT accumulating, NOT aura — i.e.
                // not recurring/undefined duration). A finite-duration passive buff lands here
                // too (seeded at combat start by the round-1 loop). The classification branches
                // above exhaustively exclude non-numeric durations from reaching this arm.
                // Cheat-Death-family firing-slot grants take Infinity (never decrements to 0:
                // Infinity − 1 === Infinity; expiry compares <= 0) → persists like Cheat Death;
                // clearRemovable on the intercept still wipes it (it's consumed anyway).
                status = {
                    ...base,
                    kind: 'timed',
                    duration: castPathCheatDeath ? Infinity : (cfg.duration as number),
                };
                (side === 'self' ? timedSelfBySlot : timedEnemyBySlot).push(status);
            }
            // Enemy-side statuses register once (singular enemy maps); self-side aura/accum fan
            // out to every recipient store. Timed statuses are applied lazily (per recipient) at
            // the firing site, so we only group the NON-timed statuses for registration here —
            // but enemy timed statuses also flow through registerAbilityStatuses as before (it
            // ignores timed — they apply via applyTimedAbilityStatus). Keep the historical
            // behaviour by registering every status under each recipient (registerAbilityStatuses
            // only stores aura/accumulating internally; timed are no-ops there).
            if (side === 'enemy') {
                // Enemy side: single registration (recipientId irrelevant — enemy maps singular).
                pushFor('enemy', status);
            } else {
                // `recipients` is the locally-computed list (always defined) — use it directly
                // rather than status.recipients (typed optional through the union).
                for (const rid of recipients) pushFor(rid, status);
            }
        }
    }
    // Fan out: one registerAbilityStatuses call per recipient owner (statusEngine API stable).
    // Enemy-side statuses were grouped under the sentinel key 'enemy'; their ownerId argument is
    // irrelevant (registerAbilityStatuses routes enemy-side statuses to the singular enemy maps).
    for (const [rid, statuses] of byRecipient) {
        statusEngine.registerAbilityStatuses(statuses, rid === 'enemy' ? ownerId : rid);
    }
    return { timedSelfBySlot, timedEnemyBySlot };
}

// ─────────────────────────────────────────────────────────────────────────────
// Combat-start seeding for PASSIVE-sourced finite (timed) self-statuses.
//
// The passive slot never fires as an action, so these would otherwise never apply; they
// are a one-time window from combat start ("gains X for N turns"), NOT a per-turn refresh.
// Apply once at round start, then the normal timed lifecycle (timedAbilityStatuses fold +
// decrementPlayer + clearRemovable) expires them and wipes them on death. Gated by
// conditionsMet for parity with the cast path (executeIntent).
function seedPassiveTimedStatuses(
    runtimes: PlayerActorRuntime[],
    statusEngine: ReturnType<typeof createStatusEngine>,
    bus: CombatEventBus,
    enemyType: EnemyBaseClass | undefined,
    round: number
): void {
    for (const rt of runtimes) {
        const seedCtx = buildActorConditionContext(statusEngine, rt.actor.id, {
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            enemyHpPct: 100,
            enemyType, // `enemy-type` survives liveGateConditions, so omitting it would
            // wrongly skip an enemy-class-gated passive buff.
        });
        for (const status of rt.timedSelfBySlot) {
            if (status.sourceSlot !== 'passive') continue;
            if (!conditionsMet(status.conditions, seedCtx)) continue;
            // recipients is populated by registerActorAbilityStatuses for every timed-by-slot
            // status; the [rt.actor.id] fallback only guards test fixtures that omit it.
            for (const rid of status.recipients ?? [rt.actor.id]) {
                statusEngine.applyTimedAbilityStatus(round, status, rid);
                bus.emit({
                    type: 'buff-applied',
                    actorId: rid,
                    round,
                    buffName: status.payload.buffName,
                    duration: status.duration,
                });
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enemy PlayerActorRuntime builder (Task 5; consumed by the Task 6b dispatch)
//
// Constructs a FULL PlayerActorRuntime for a healing-mode enemy attacker, mirroring
// the walked-team construction. The enemy walks runPlayerTurn bound to the heal target
// (Task 6b dispatch): its damage drains into the target, self-buffs land in its own owner
// store, debuffs/DoTs on the target's per-target store.
//
// Design decisions:
//   manual enemy:  A flat-card enemy (no shipSkills) gets a synthesized single-slot basic
//                  attack (100% multiplier, 1 hit, crit-eligible) so the walk produces
//                  byte-identical damage to the retired runEnemyAttackerTurn manual path.
//   defence/hp:    The enemy's own stats (default 0 until Task 9 populates real values
//                  via the adapter).
//   affinity:      Neutral placeholder (modifier 0, cap 100, penalty 0, no disadvantage).
//                  Task 9 wires real matchup after the affinity selector lands.
//   selfBuffLookup: Empty map (walked-style: payload effects are self-contained).
//   enemyDebuffLookup: The engine's global map (same as walked-team actors).
//   status registration: registerActorAbilityStatuses registers any buff/debuff abilities
//                  the enemy's kit carries (no-op for damage-only shipSkills).
// ─────────────────────────────────────────────────────────────────────────────

/** Input shape for buildEnemyPlayerActorRuntime. Mirrors CombatEngineInput['enemyAttackers'][number]. */
export interface EnemyActorInput {
    id: string;
    stats: {
        attack: number;
        crit: number;
        critDamage: number;
        speed: number;
        defence?: number;
        hp?: number;
        /** Base hacking (A2 Task 2). Optional — flows onto the enemy CombatActor's stats.hacking
         *  (base for effectiveStatsOf.hacking). No production reader until landing lands (A2 Task 4). */
        hacking?: number;
        /** Base security (A2 Task 2). Optional — flows onto the enemy CombatActor's stats.security
         *  (base for effectiveStatsOf.security). No production reader until landing lands (A2 Task 4). */
        security?: number;
    };
    chargeCount: number;
    startCharged: boolean;
    shipSkills?: ShipSkills;
    /** Pre-resolved affinity damage modifier (from computeAffinityModifiers). Default 0 (neutral). */
    affinityDamageModifier?: number;
    /** Pre-resolved crit cap (from computeAffinityModifiers). Default 100 (neutral). */
    affinityCritCap?: number;
    /** Pre-resolved crit penalty (from computeAffinityModifiers). Default 0 (neutral). */
    affinityCritPenalty?: number;
    /** Board position of this enemy (positional plumbing — set but not yet consumed). */
    position?: Position;
    /** Attacker ignores Taunt/Provoke (positional plumbing — not yet populated by a production caller). */
    ignoresForcedTargeting?: boolean;
    /** Attacker's direct hits do NOT break Stasis (Akula / Tygr). Gated at the break-mark
     *  site (§4.5 Akula exception). Optional — undefined treated as false. */
    doesntBreakStasis?: boolean;
    /** Pre-parsed targeting preference for this enemy (positional plumbing — set but not yet consumed). */
    target?: ParsedTarget;
    /** Pre-parsed positional pattern for this enemy (positional plumbing — set but not yet consumed by apply). */
    pattern?: ParsedPattern;
    /** RAW affinity of this enemy attacker — the SAME affinity the adapter fed to
     *  computeAffinityModifiers to produce `affinityDamageModifier` above (positional plumbing —
     *  set but not yet consumed by apply). Threaded onto the runtime's attackerAffinity + the
     *  CombatActor.affinity. Absent → neutral default ('antimatter') downstream. */
    affinity?: AffinityName;
}

/** Build a full PlayerActorRuntime for a healing-mode enemy attacker.
 *  Exported for unit-testing; called inside runCombat. The enemy-dispatch branch
 *  walks runPlayerTurn with this runtime, bound to the heal target (Task 6b). */
export function buildEnemyPlayerActorRuntime(
    e: EnemyActorInput,
    ctx: {
        statusEngine: StatusEngine;
        // Enemy-team recipient order (mirror of playerIds for player actors): the enemy ATTACKER
        // ids in input order. An enemy supporter's `ally`/`all-allies` cast buffs route to THIS
        // list so they land on the enemy team (raising other enemies' damage to the tank) instead
        // of leaking onto the player team.
        enemyIds: string[];
        enemyDebuffLookup: Map<string, SelectedGameBuff[]>;
    }
): PlayerActorRuntime {
    const { statusEngine, enemyIds, enemyDebuffLookup } = ctx;

    // Manual flat-card enemy (no shipSkills): synthesize a single basic-attack active slot
    // (100% multiplier, 1 hit, crit-eligible) so the runPlayerTurn walk produces byte-identical
    // damage to the retired runEnemyAttackerTurn manual path. A ship-backed enemy uses its real
    // shipSkills. The synthesized ability is on-cast/target-enemy → survives reactive partition.
    const sourceSkills: ShipSkills = e.shipSkills ?? {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: `${e.id}-basic`,
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100, hits: 1 },
                    },
                ],
            },
        ],
    };

    // Partition reactive abilities out of castSkills (mirrors walked-team pattern).
    // Damage abilities are never reactive, so the synthesized basic stays in castSkills; a
    // ship-backed enemy's reactive abilities (if any) partition out as for a walked team actor.
    const { castSkills, reactiveAbilities } = partitionReactiveAbilities(sourceSkills);

    // Register this enemy actor's cast buff/debuff abilities (no-op for damage-only
    // shipSkills; safe to call defensively). Own ownerId = actor id. `enemyIds` is the
    // same-side ally-recipient order: an enemy supporter's `ally`/`all-allies` buff routes
    // onto the ENEMY team (aura/accum fan out per enemy store; timed carry `recipients` for
    // the per-recipient apply loop), so it folds into each enemy's own turn rather than
    // leaking onto the player team.
    const { timedSelfBySlot, timedEnemyBySlot } = registerActorAbilityStatuses(
        castSkills,
        statusEngine,
        e.id,
        enemyIds
    );

    // hasChargedSkill: true only when the enemy banks charges (chargeCount >= 1) AND its
    // charged slot actually carries a damage ability (multiplier > 0). A manual flat card
    // (no shipSkills) never has a charged slot → false.
    const hasChargedSkill = e.shipSkills
        ? e.chargeCount >= 1 &&
          damageInputsFromSkill(selectFiringSkill(e.shipSkills, 'charged')).multiplier > 0
        : false;

    const actor = createActor({
        id: e.id,
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: e.stats.attack,
            crit: e.stats.crit,
            critDamage: e.stats.critDamage,
            defensePenetration: 0,
            defence: e.stats.defence ?? 0,
            hp: e.stats.hp ?? 0,
            speed: e.stats.speed,
            // Base hacking/security (A2 Task 2) — base for effectiveStatsOf; unread until landing lands (A2 Task 4).
            hacking: e.stats.hacking,
            security: e.stats.security,
        },
        chargeCount: e.chargeCount,
        startCharged: e.startCharged,
        position: e.position,
        ignoresForcedTargeting: e.ignoresForcedTargeting,
        doesntBreakStasis: e.doesntBreakStasis,
        affinity: e.affinity,
    });

    // Resolved affinity fields — pre-computed by the adapter via computeAffinityModifiers
    // (enemy as attacker, heal target as defender). Absent → neutral defaults (damageMod 0,
    // cap 100, penalty 0), preserving byte-identical behaviour for fixtures without affinity.
    const resolvedDamageMod = e.affinityDamageModifier ?? 0;
    const resolvedCritCap = e.affinityCritCap ?? 100;
    const resolvedCritPenalty = e.affinityCritPenalty ?? 0;
    const affinityDisadvantage = resolvedDamageMod < 0;
    // Own gate instances — separate draw streams so this enemy's crit/heal-crit/debuff/extend
    // rolls are fully isolated from every other actor's deterministic schedule.
    const enemyActiveCritGate = makeRateGate();
    const enemyChargedCritGate = makeRateGate();
    const enemyActiveHealCritGate = makeRateGate();
    const enemyChargedHealCritGate = makeRateGate();
    const enemyDebuffLandingGate = makeRateGate();
    const enemyExtendChanceGate = makeRateGate();
    // The landing closure reads the runtime's LIVE per-target landing chance (A2 Task 4 — set
    // each turn by runPlayerTurn) and falls back to the threaded scalar. It references `runtime`
    // (defined in the same const initializer); the arrow BODY runs only at turn time, well after
    // construction, so the self-reference is safe.
    const runtime: PlayerActorRuntime = {
        actor,
        focus: false,
        castSkills,
        reactiveAbilities,
        timedSelfBySlot,
        timedEnemyBySlot,
        hasChargedSkill,
        attack: e.stats.attack,
        crit: e.stats.crit,
        critDamage: e.stats.critDamage,
        defensePenetration: 0,
        defence: e.stats.defence ?? 0,
        hp: e.stats.hp ?? 0,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: resolvedDamageMod,
        affinityCritCap: resolvedCritCap,
        affinityCritPenalty: resolvedCritPenalty,
        affinityDisadvantage,
        // RAW affinity — sourced from the SAME e.affinity the adapter fed to
        // computeAffinityModifiers for resolvedDamageMod, so the two never disagree. Positional
        // plumbing: read by victimHitDamage for per-victim re-resolution (Task 8b/9). Undefined →
        // neutral 'antimatter' default downstream.
        attackerAffinity: e.affinity,
        allyChargePerRound: undefined,
        activeCritGate: enemyActiveCritGate,
        chargedCritGate: enemyChargedCritGate,
        activeHealCritGate: enemyActiveHealCritGate,
        chargedHealCritGate: enemyChargedHealCritGate,
        debuffLandingGate: enemyDebuffLandingGate,
        extendChanceGate: enemyExtendChanceGate,
        landsTimedEnemyApplication: (application?: 'inflict' | 'apply'): boolean =>
            application === 'apply'
                ? !affinityDisadvantage
                : enemyDebuffLandingGate(runtime.liveDebuffLandingChance ?? 1), // fresh timed inflictions draw against this enemy's LIVE hacking-vs-security landing chance (?? 1 — neutral guard for a read before the owner's first turn)
        selfBuffLookup: new Map(),
        enemyDebuffLookup,
    };
    return runtime;
}

function totalStacks(entries: ActiveDoTStack[]): number {
    return entries.reduce((sum, e) => sum + e.stacks, 0);
}

/** De-dupe ActiveBuffs by buffName, keeping the first occurrence. Used to collapse the
 *  per-round enemy-effects union (multiple enemy attackers can carry the same status) so
 *  the UI shows each effect once per round (Task 10). */
function dedupeByBuffName(buffs: ActiveBuff[]): ActiveBuff[] {
    const seen = new Set<string>();
    const out: ActiveBuff[] = [];
    for (const b of buffs) {
        if (seen.has(b.buffName)) continue;
        seen.add(b.buffName);
        out.push(b);
    }
    return out;
}

/** Merge a pre-tick DoT snapshot with the live (post-tick) container for display purposes.
 *  Live entries take precedence (they reflect the current state after the tick). Snapshot
 *  entries whose (sourceId, tier) key is absent from live are appended — those are the DoTs
 *  that ticked AND expired within this round (the tick-and-expire case: CodeRabbit finding). */
function mergeDoTsForDisplay(
    snapshot: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[],
    live: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[]
): Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[] {
    if (snapshot.length === 0) return live;
    const liveKeys = new Set(live.map((e) => `${e.sourceId}-${e.tier}`));
    const expiredOnly = snapshot.filter((e) => !liveKeys.has(`${e.sourceId}-${e.tier}`));
    return expiredOnly.length === 0 ? live : [...live, ...expiredOnly];
}

/** Assemble the per-round `EnemyRoundEffects[]` for the healing UI (Task 4a). Each enemy that acted
 *  (in `roundEnemyEffects`, keyed by actor id) keeps its de-duped self-buffs/debuffs; on top, the
 *  DoTs ACTIVE on the heal target this round are attributed to their applier via the stack
 *  `sourceId`, summed per type+tier (mirroring the DPS active-DoT display). A DoT-only enemy (no
 *  self-buffs/debuffs, so absent from `roundEnemyEffects`) gets a fresh entry appended so its DoTs
 *  still surface. NAMES/COUNTS ONLY for display — never folded into a sim value. */
function buildEnemyRoundEffects(
    roundEnemyEffects: Map<
        string,
        {
            selfBuffs: ActiveBuff[];
            debuffs: ActiveBuff[];
            resistedDebuffs: ActiveBuff[];
            resistedDots: EnemyDoTState[];
        }
    >,
    corrosionEntries: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[],
    infernoEntries: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[]
): EnemyRoundEffects[] {
    // Sum active stacks per source → type → tier, preserving first-seen source order.
    const dotsBySource = new Map<string, Map<string, EnemyDoTState>>();
    const accumulate = (
        type: 'corrosion' | 'inferno',
        entries: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[]
    ): void => {
        for (const e of entries) {
            let byKey = dotsBySource.get(e.sourceId);
            if (!byKey) {
                byKey = new Map();
                dotsBySource.set(e.sourceId, byKey);
            }
            const key = `${type}-${e.tier}`;
            const existing = byKey.get(key);
            if (existing) existing.stacks += e.stacks;
            else byKey.set(key, { type, tier: e.tier, stacks: e.stacks });
        }
    };
    accumulate('corrosion', corrosionEntries);
    accumulate('inferno', infernoEntries);

    // Merge resisted DoTs by type+tier, summing stacks — consistent with the landed `dots`
    // accumulate-by-type+tier semantics above so repeats collapse to one row.
    const mergeResistedDots = (dots: EnemyDoTState[]): EnemyDoTState[] => {
        const byKey = new Map<string, EnemyDoTState>();
        for (const d of dots) {
            const key = `${d.type}-${d.tier}`;
            const existing = byKey.get(key);
            if (existing) existing.stacks += d.stacks;
            else byKey.set(key, { ...d });
        }
        return Array.from(byKey.values());
    };

    const out: EnemyRoundEffects[] = [];
    const emitted = new Set<string>();
    // Enemies that acted (self-buffs/debuffs) first, in their acting order — each gains its DoTs.
    for (const [enemyId, e] of roundEnemyEffects) {
        emitted.add(enemyId);
        out.push({
            enemyId,
            selfBuffs: dedupeByBuffName(e.selfBuffs),
            debuffs: dedupeByBuffName(e.debuffs),
            dots: Array.from(dotsBySource.get(enemyId)?.values() ?? []),
            resistedDebuffs: dedupeByBuffName(e.resistedDebuffs),
            resistedDots: mergeResistedDots(e.resistedDots),
        });
    }
    // DoT-only enemies (active DoTs but no self-buffs/debuffs) appended in container order.
    for (const [sourceId, byKey] of dotsBySource) {
        if (emitted.has(sourceId)) continue;
        emitted.add(sourceId);
        out.push({
            enemyId: sourceId,
            selfBuffs: [],
            debuffs: [],
            dots: Array.from(byKey.values()),
            resistedDebuffs: [],
            resistedDots: [],
        });
    }
    return out;
}

function expireStacks(entries: ActiveDoTStack[]): void {
    for (let i = entries.length - 1; i >= 0; i--) {
        entries[i].remainingRounds -= 1;
        if (entries[i].remainingRounds <= 0) {
            entries.splice(i, 1);
        }
    }
}

// Step 6: Process bombs — their burst is detonation damage (same category as Step 2.95).
// `emitBombDetonated` is called once per burst (per detonating bomb entry) so Phase 3
// reactive triggers can observe each burst's actorId, round, stacks, and damage.
// Per-actor attribution (Task 4): each burst uses the APPLIER's affinityMult (snapshotted at
// application) and is credited to that applier's detonation channel via `creditDetonation`.
// `actorIdFor` supplies the bomb-detonated event's actorId (the applier).
function processBombs(args: {
    pendingBombs: PendingBomb[];
    emitBombDetonated?: (actorId: string, stacks: number, damage: number) => void;
    creditDetonation: (sourceId: string, damage: number) => void;
}): void {
    for (let i = args.pendingBombs.length - 1; i >= 0; i--) {
        args.pendingBombs[i].countdown -= 1;
        if (args.pendingBombs[i].countdown <= 0) {
            const bomb = args.pendingBombs[i];
            const burstDamage = bomb.stacks * bomb.damagePerStack * bomb.affinityMult;
            args.emitBombDetonated?.(bomb.sourceId, bomb.stacks, burstDamage);
            args.creditDetonation(bomb.sourceId, burstDamage);
            args.pendingBombs.splice(i, 1);
        }
    }
}

// Step 6b: Echoing Burst accumulators gather this round's direct damage, then detonate
// for pct% of the accumulated total on expiry (game-categorised as detonation damage).
// directDamage already includes affinity, so no extra affinity multiplier is applied.
// Per-actor attribution (Task 4): the accumulation INPUT is the summed direct damage of ALL
// players this round (spec: Echoing Burst gathers all players' direct); the OUTPUT burst is
// credited to the accumulator's applier via `creditDetonation`.
function processAccumulators(args: {
    pendingAccumulators: PendingAccumulator[];
    allPlayersDirect: number;
    creditDetonation: (sourceId: string, damage: number) => void;
}): void {
    for (let i = args.pendingAccumulators.length - 1; i >= 0; i--) {
        const acc = args.pendingAccumulators[i];
        acc.accumulated += args.allPlayersDirect;
        acc.roundsRemaining -= 1;
        if (acc.roundsRemaining <= 0) {
            args.creditDetonation(acc.sourceId, acc.accumulated * (acc.pct / 100));
            args.pendingAccumulators.splice(i, 1);
        }
    }
}

// Steps 4 & 5: Tick corrosion (scales with enemy HP, capped at 5000 dmg per 1%) and
// inferno (scales with the APPLIER's effective attack, no outgoing buff), then expire both
// stack sets. Per-actor attribution (Task 4): each entry ticks with its applier's ctx (looked
// up via `ctxFor(entry.sourceId)`) — inferno uses the applier's effectiveAttack, both use the
// applier's dotMult/affinityMult; corrosion stays enemy-HP-based. An entry whose applier has
// no ctx yet (faster-enemy round 1) is skipped this tick (its applier acts later). Damage is
// credited per applier via `credit`; the `dot-ticked` event carries the per-dotType SUMMED
// damage (preserving the pre-Task-4 single-event-per-type emission). At attacker-only this
// produces byte-identical totals (exactly one applier → same sums).
function tickDoTs(args: {
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    enemyHp: number;
    ctxFor: (sourceId: string) => PlayerRoundCtx | undefined;
    emitTicked: (dotType: 'corrosion' | 'inferno', damage: number) => void;
    credit: (sourceId: string, dotType: 'corrosion' | 'inferno', damage: number) => void;
    /** D-PR3 (Vortex Veil): % reduction applied to this carrier's DoT ticks of the given type.
     *  Absent → 0 → byte-identical. */
    incomingDotReductionPct?: (dotType: 'corrosion' | 'inferno') => number;
}): void {
    // Step 4: Tick corrosion (scales with enemy HP, capped at 5000 dmg per 1%)
    const corrosionBaseHp = Math.min(args.enemyHp, 500_000);
    const corrosionCredits: Array<{ sourceId: string; d: number }> = [];
    let corrosionSum = 0;
    for (const e of args.corrosionEntries) {
        const ctx = args.ctxFor(e.sourceId);
        if (!ctx) continue; // applier has not acted yet this run (faster-enemy round 1)
        const d = e.stacks * (e.tier / 100) * corrosionBaseHp * ctx.dotMult * ctx.affinityMult;
        corrosionCredits.push({ sourceId: e.sourceId, d });
        corrosionSum += d;
    }
    if (corrosionSum > 0) {
        const reductionPct = args.incomingDotReductionPct?.('corrosion') ?? 0;
        const factor = 1 - reductionPct / 100;
        for (const { sourceId, d } of corrosionCredits)
            args.credit(sourceId, 'corrosion', d * factor);
        args.emitTicked('corrosion', corrosionSum * factor);
    }

    // Step 5: Tick inferno (scales with the applier's effective attack, no outgoing buff)
    const infernoCredits: Array<{ sourceId: string; d: number }> = [];
    let infernoSum = 0;
    for (const e of args.infernoEntries) {
        const ctx = args.ctxFor(e.sourceId);
        if (!ctx) continue;
        const d = e.stacks * (e.tier / 100) * ctx.effectiveAttack * ctx.dotMult * ctx.affinityMult;
        infernoCredits.push({ sourceId: e.sourceId, d });
        infernoSum += d;
    }
    if (infernoSum > 0) {
        const reductionPct = args.incomingDotReductionPct?.('inferno') ?? 0;
        const factor = 1 - reductionPct / 100;
        for (const { sourceId, d } of infernoCredits) args.credit(sourceId, 'inferno', d * factor);
        args.emitTicked('inferno', infernoSum * factor);
    }

    // Expire DoT stacks after ticking
    expireStacks(args.corrosionEntries);
    expireStacks(args.infernoEntries);
}

/** Damage-credit channels the standing-leech hook distinguishes (damage-leech spec §4). */
type LeechChannel = 'direct' | 'detonation' | 'corrosion' | 'inferno';

/** A team actor input as the ENGINE consumes it: the public TeamActorInput plus an
 *  optional `walk` bundle the adapter (simulateDPS) resolves when the actor carries
 *  shipSkills. With `walk` the actor runs the full runPlayerTurn pipeline; without it it
 *  stays the legacy scheduled-list source (byte-identical to pre-walk behaviour). The
 *  walk's per-actor rates are pre-derived by the adapter (same shape as the attacker's). */
export type TeamActorEngineInput = TeamActorInput & {
    walk?: {
        shipSkills: ShipSkills;
        stats: CombatStatBlock;
        selfDotModifier: number;
        defensePenetrationBuff: number;
        affinityDamageModifier: number;
        affinityCritCap: number;
        affinityCritPenalty: number;
        hasChargedSkill: boolean;
        /** Caster heal-modifier stat (healing calc). Default 0. */
        healModifier?: number;
        /** RAW affinity of this team actor — the SAME affinity (TeamActorInput.affinity) the
         *  adapter fed to computeAffinityModifiers to produce `affinityDamageModifier` in this
         *  bundle, so the two never disagree. Positional plumbing — set but not yet consumed by
         *  apply (threaded onto the runtime's attackerAffinity + the CombatActor.affinity).
         *  Absent → neutral default ('antimatter') downstream. */
        affinity?: AffinityName;
    };
    /** Board position of this team actor (positional plumbing — set but not yet consumed). */
    position?: Position;
    /** Attacker ignores Taunt/Provoke (positional plumbing — not yet populated by a production caller). */
    ignoresForcedTargeting?: boolean;
    /** Attacker's direct hits do NOT break Stasis (Akula / Tygr). Gated at the break-mark
     *  site (§4.5 Akula exception). Optional — undefined treated as false. */
    doesntBreakStasis?: boolean;
    /** Pre-parsed targeting preference for this team actor. Consumed by the walked-team
     *  positional target selection AND the Task 8b positional apply at the team damage site. */
    target?: ParsedTarget;
    /** Pre-parsed positional pattern for this team actor. Consumed by the Task 8b positional
     *  apply at the team damage site (origin/covered footprint expansion). */
    pattern?: ParsedPattern;
};

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
    teamActors?: TeamActorEngineInput[];
    // Rate/fold fields below (selfDotModifier, defensePenetrationBuff)
    // are pre-derived by the adapter (simulateDPS) — pass the resolved values, not raw hacking.
    selfDotModifier: number;
    defensePenetrationBuff: number;
    hasChargedSkill: boolean;
    startCharged: boolean;
    affinityDamageModifier: number;
    affinityCritCap: number;
    affinityCritPenalty: number;
    defence: number;
    hp: number;
    /** Focus attacker's base hacking (A2 Task 2). Optional — base for effectiveStatsOf.hacking on the
     *  attacker actor. The adapter passes `input.hacking ?? 200` (the OLD landing-formula default); no
     *  production reader until dynamic landing lands (A2 Task 4). */
    hacking?: number;
    /** DPS dummy enemy's base security (A2 Task 2). Optional — base for effectiveStatsOf.security on the
     *  dummy enemy actor. The adapter passes `input.enemySecurity ?? 100` (the OLD landing-formula default);
     *  no production reader until dynamic landing lands (A2 Task 4). */
    enemySecurity?: number;
    allyChargePerRound?: number;
    enemyType?: EnemyBaseClass;
    /** Attacker turn-order speed. Default 100. */
    speed?: number;
    /** Enemy turn-order speed. Default 50 — the enemy acts last at default speeds. */
    enemySpeed?: number;
    /** Caster heal-modifier stat (healing calc). Default 0. */
    healModifier?: number;
    /** FOCUS actor's ship role (Ship.type) for role-filtered ally-damage reactions
     *  (Graphite's "when a Defender or Debuffer ally takes damage"). Team actors carry
     *  their own `role` on TeamActorInput. Absent (manual stats / no ship picked) →
     *  the focus actor never matches a role filter — the reaction stays dormant for
     *  hits on it (conservative; mirrors TeamActorInput.role's contract). */
    role?: ShipTypeName;
    /** Healing mode switch (healing calc): the player actor id that heals/shields route to
     *  and consume against. Must be a player actor id (focus or a team actor). When set, the
     *  engine runs in healing mode — heals/shields/cleanses are consumed and a `healing`
     *  result block is returned. Absent → DPS mode (the heal pipeline is fully inert). */
    healTargetId?: string;
    /** Enemy attackers (healing mode): offense-only queue actors bombarding the heal
     *  target. The singular dummy `enemy` remains the player-offense target + DoT carrier.
     *  `defence` and `hp` are optional now (default 0 for bare-stat legacy path); Task 9
     *  populates them with real matchup values via the adapter. */
    enemyAttackers?: {
        id: string;
        stats: {
            attack: number;
            crit: number;
            critDamage: number;
            speed: number;
            /** Enemy's own defence stat. Default 0. Task 9 provides real value. */
            defence?: number;
            /** Enemy's own hp stat. Default 0. Task 9 provides real value. */
            hp?: number;
            /** Base hacking (A2 Task 2). Optional — base for effectiveStatsOf.hacking; unread until A2 Task 4. */
            hacking?: number;
            /** Base security (A2 Task 2). Optional — base for effectiveStatsOf.security; unread until A2 Task 4. */
            security?: number;
        };
        chargeCount: number;
        startCharged: boolean;
        shipSkills?: ShipSkills;
        /** Pre-resolved affinity damage modifier vs the heal target. Default 0 (neutral). */
        affinityDamageModifier?: number;
        /** Pre-resolved crit cap vs the heal target. Default 100 (neutral). */
        affinityCritCap?: number;
        /** Pre-resolved crit penalty vs the heal target. Default 0 (neutral). */
        affinityCritPenalty?: number;
        /** Board position of this enemy attacker (positional plumbing — set but not yet consumed). */
        position?: Position;
        /** Attacker ignores Taunt/Provoke (positional plumbing — not yet populated by a production caller). */
        ignoresForcedTargeting?: boolean;
        /** Attacker's direct hits do NOT break Stasis (Akula / Tygr). Gated at the break-mark
         *  site (§4.5 Akula exception). Optional — undefined treated as false. */
        doesntBreakStasis?: boolean;
        /** Pre-parsed targeting preference for this enemy attacker (positional plumbing — set but not yet consumed). */
        target?: ParsedTarget;
        /** Pre-parsed positional pattern for this enemy attacker (positional plumbing — set but not yet consumed by apply). */
        pattern?: ParsedPattern;
        /** RAW affinity of this enemy attacker — the SAME affinity the adapter fed to
         *  computeAffinityModifiers for `affinityDamageModifier` above (positional plumbing —
         *  set but not yet consumed by apply). Absent → neutral default ('antimatter') downstream. */
        affinity?: AffinityName;
    }[];
    /** Emit-only event tap. Listeners must not read or mutate combat state. */
    bus?: CombatEventBus;
    /** Board position of the focus attacker (positional plumbing — set but not yet consumed). */
    position?: Position;
    /** Attacker ignores Taunt/Provoke (positional plumbing — not yet populated by a production caller). */
    ignoresForcedTargeting?: boolean;
    /** Attacker's direct hits do NOT break Stasis (Akula / Tygr). Gated at the break-mark
     *  site (§4.5 Akula exception). Optional — undefined treated as false. */
    doesntBreakStasis?: boolean;
    /** Pre-parsed targeting preference for the focus attacker. Consumed by the focus positional
     *  target selection AND the Task 8b positional apply at the focus damage site. */
    target?: ParsedTarget;
    /** Pre-parsed positional pattern for the focus attacker. Consumed by the Task 8b positional
     *  apply at the focus damage site (origin/covered footprint expansion). */
    pattern?: ParsedPattern;
    /** RAW affinity of the focus attacker — the SAME affinity matchup the page resolved into the
     *  pre-resolved `affinityDamageModifier` above, so the two never disagree (positional plumbing
     *  — set but not yet consumed by apply). Threaded onto the attacker runtime's attackerAffinity
     *  + the CombatActor.affinity. Absent → neutral default ('antimatter') downstream. */
    affinity?: AffinityName;
    /** TEST-ONLY tap (Phase 4 PR1, Task 3): receives the genuine `applyOutgoingToEnemy` closure
     *  once on the first round it is built, so unit tests can exercise the player→enemy victim
     *  wrapper against a hand-built enemy actor. Never set by production code; the closure runs the
     *  real applyVictimDamage path (no mocks).
     *  KEPT (not removed once Task 8/9 wired production callers): `applyOutgoingToEnemy.test.ts`
     *  behaviour #6 — the enemy-side sink now records per-victim intake (incoming / shield-absorbed /
     *  barrier-absorbed into the victim's own bucket, since E1) — is unique coverage the
     *  positionalDamage integration test cannot observe (it only sees `ship-destroyed`). Inert
     *  (optional, never set in production). */
    __testTapApplyOutgoingToEnemy?: (
        fn: (damage: number, enemyVictim: CombatActor) => VictimDamageOutcome
    ) => void;
    /** TEST-ONLY tap (A2 Task 2): receives the full `allActors` roster once, right after actors
     *  are constructed, so unit tests can assert the plumbed base hacking/security on each actor
     *  (the bases have no production reader yet). Never set by production code; inert when absent.
     *  IMPORTANT: the passed array and its CombatActors are LIVE references mutated by the run
     *  (currentHp, currentShield, etc.) — test callbacks must read any mutable values immediately
     *  in the callback, not after runCombat returns. Base stats (hacking, security, etc.) are
     *  never mutated, so existing base-stat assertions are safe to read post-run. */
    __testTapActors?: (actors: CombatActor[]) => void;
    /** TEST-ONLY tap (B1 Task 2): receives the per-victim incoming-damage modifier reader
     *  (`victimIncomingModifiers`) once it is built in the round loop. Since D-PR12 the closure
     *  sums BOTH the enemy-debuff term AND the victim's own friendly self-buff term (field name
     *  kept as `__testTapVictimEnemyModifiers` to avoid churning the existing tap tests). Unit
     *  tests capture the closure and call it with a victim id to assert per-actor modifier reads.
     *  Never set by production code; inert when absent. The closure is per-round-identical
     *  in behaviour (only the live status-engine state changes), so capturing it once is sufficient
     *  for a single-round test. NOTE: the tap reads LIVE statusEngine state at call time, which
     *  is fine for single-round tests (the state is fully settled after runCombat returns). */
    __testTapVictimEnemyModifiers?: (
        fn: (victimId: string) => { enemyDefenseModifier: number; incomingDamageModifier: number }
    ) => void;
    /** TEST TAP (inert in production): exposes the engine-local isStasised(actorId) reader so a
     *  test can assert per-victim Stasis detection for both directions. Mirrors
     *  __testTapVictimEnemyModifiers. Never set by production callers. */
    __testTapIsStasised?: (fn: (actorId: string) => boolean) => void;
    /** TEST-ONLY tap (C2a Task 3): receives the live `statusEngine` once it is built so a test can
     *  read an actor's settled self-buff / debuff state AFTER `runCombat` returns (e.g. to assert a
     *  cast-path purge removed an enemy's self-buffs). Never set by production code; inert when
     *  absent. The engine reference is LIVE — read it after the run when state is fully settled. */
    __testTapStatusEngine?: (engine: StatusEngine) => void;
}

/** One round's healing accounting (healing mode only). `perActor` mirrors the round
 *  damage map. incomingDamage/shieldAbsorbed stay 0 until enemy attacks (Task 8).
 *  targetHpPctStart/targetShieldStart are captured at the ROUND TOP (raw floats — the
 *  adapter owns any rounding). */
/** One enemy attacker's effects for a single round, attributed to its actor id (Task 10a).
 *  selfBuffs = the self-buffs active on that enemy this round; debuffs = the debuffs/DoTs it
 *  landed on the heal target. Both are de-duped by buffName WITHIN this enemy (so the same
 *  status from two attackers stays distinct per source). The UI resolves enemyId → the enemy
 *  attacker's ship name (or its manual label) for the per-enemy round overview. */
export interface EnemyRoundEffects {
    enemyId: string;
    selfBuffs: ActiveBuff[];
    debuffs: ActiveBuff[];
    /** Enemy-applied DoTs (Corrosion/Inferno) ACTIVE on the heal target this round, attributed to
     *  this enemy via the stack's `sourceId` (the applier's actor id), summed per type+tier. Mirrors
     *  the DPS `ActiveDoTState` `{ type, tier, stacks }` shape so the UI reuses the DPS DoT-label
     *  helper. A DoT shows for every round it is active on the target (across its duration), so a
     *  DoT-based enemy (Torcher/Belladonna) surfaces in the panel even with no self-buffs/debuffs.
     *  NAMES ONLY for display — never folded into any sim value. Empty when no DoTs are active. */
    dots: EnemyDoTState[];
    /** TIMED debuffs this enemy attacker ATTEMPTED to inflict on the heal target this round but
     *  that were RESISTED by the live hacking-vs-security landing roll.
     *  De-duped by buffName WITHIN this enemy. NAMES ONLY for display — never folded into any sim
     *  value. Empty when every attempted debuff landed (or the enemy attempted none). */
    resistedDebuffs: ActiveBuff[];
    /** DoTs this enemy attacker ATTEMPTED to inflict on the heal target this round but that were
     *  RESISTED by the live hacking-vs-security landing roll (the whole turn's DoTs share one draw).
     *  Summed per type+tier like `dots`. NAMES/COUNTS ONLY for display — never folded into any sim
     *  value. Empty when the turn's DoTs landed (or the enemy attempted none). */
    resistedDots: EnemyDoTState[];
}

/** One enemy-applied DoT active on the heal target, attributed to its source enemy and summed per
 *  type+tier (mirrors the DPS `ActiveDoTState` shape, minus ticksRemaining which the panel omits). */
export interface EnemyDoTState {
    type: 'corrosion' | 'inferno';
    tier: number;
    stacks: number;
}

/** The four side-specific fields the reactive intent drain needs (enemy-team PR1). Everything
 *  else in the executor ctx is shared across sides; only these differ between the player drain
 *  and the enemy drain. `recipientIds` becomes the executor's `playerIds` (same-side recipients). */
interface ReactiveSideCtx {
    runtimes: Map<string, PlayerActorRuntime>;
    recipientIds: string[];
    isLowestSpeedAllyFor: (ownerId: string) => boolean;
    grantAllyCharges: (amount: number) => void;
    /** Live self-HP% for a same-side drain owner (drain-time hp-threshold gates). Optional —
     *  absent/undefined → buildDrainContext defaults the gate to 100 (DPS / pre-4c). Sourced from
     *  bySide(side).selfHpPctFor (bySide PR3): player = heal-target HP, enemy = 100 until PR5. */
    selfHpPctFor?: (ownerId: string) => number;
    /** Per-side most-buffs opposing-actor resolver (Rhodium). See IntentExecContext. */
    enemyWithMostBuffs?: (ownerId: string) => string | undefined;
    /** D-PR14 Doomsayer: per-side highest-attack opposing-actor resolver. See IntentExecContext. */
    enemyWithHighestAttack?: (ownerId: string) => string | undefined;
    /** D-PR14: id of the round's first real activator (live value at drain-build time). */
    firstActivatorId?: string;
    /** D-PR14 Bulwark: per-round once-per-(owner,ability) consume set (shared across both sides). */
    oncePerRoundConsumed?: Set<string>;
    /** Per-side adjacent-allies resolver (Fortifying Shroud). See IntentExecContext. */
    adjacentAllyIdsFor: (ownerId: string) => string[];
}

/** Per-victim incoming accounting bucket (PR5a foundation — written in parallel with the
 *  heal-target scalars; no reader until PR5b flips them). Keyed by victim actor id. */
interface ActorIntake {
    incoming: number;
    shieldAbsorbed: number;
    barrierAbsorbed: number;
}

export interface HealingRoundEngine {
    perActor: Map<string, ActorHealing>;
    targetHpPctStart: number;
    targetShieldStart: number;
    incomingDamage: number;
    shieldAbsorbed: number;
    /** Per-round total fully blocked by an active Barrier (full damage immunity). Tracked
     *  separately from shieldAbsorbed (Barrier does not drain the shield pool). Task 2 adds the
     *  UI display surface; this field exists now so the blocked total is observable. */
    barrierAbsorbed: number;
    /** Per-actor incoming accounting bucket. The heal target's `incomingDamage`/`shieldAbsorbed`/
     *  `barrierAbsorbed` row totals above are sourced from this map's `healTarget.id` entry (PR5b);
     *  the legacy per-round scalars it replaced were removed in the same change. Keyed by victim
     *  actor id. */
    perActorIncoming: Map<string, ActorIntake>;
    /** Per-enemy effects this round (Task 10a): one entry per enemy attacker that produced an
     *  effect, carrying its own self-buffs + the debuffs it landed on the heal target. Surfaced
     *  for the UI's enemy-effects round overview, grouped/attributed by the source enemy ship.
     *  Empty for a bare/manual enemy with no effects. NAMES ONLY — never folded into a sim value. */
    enemyEffects: EnemyRoundEffects[];
    /** The HEAL TARGET's OWN active self-buffs this round, captured from the target actor's turn
     *  (PlayerTurnResult.activeSelfBuffs — comprehensive, so recurring/always-active buffs like
     *  Cheat Death / Everliving Regeneration are included). Empty when there is no heal target,
     *  the target never acted this round, or the target is destroyed. NAMES ONLY for the UI's
     *  round overview — never folded into any sim value. */
    healTargetBuffs: ActiveBuff[];
}

/**
 * Side-specific accounting hooks for {@link applyVictimDamage}. Everything keyed off the
 * `victim` (Barrier/shield/HP/Cheat-Death/recordDestroyed/hp-changed) lives in the shared
 * core; the per-direction intake accounting is injected here so the core stays
 * caller-agnostic. Both directions now record into the per-actor `perActorIncoming` map keyed
 * by the victim's id — `playerSink` for enemy→player (tank intake) and `enemySink` for
 * player→enemy (E1 symmetric surface). The two bodies are identical today but kept separate so
 * E2 (per-victim leech) can diverge the enemy side without touching the player path.
 */
interface DamageAccountingSink {
    /** today: intakeFor(victimId).incoming += amount */
    addIncoming: (amount: number, victimId: string) => void;
    /** today: intakeFor(victimId).shieldAbsorbed += amount */
    addShieldAbsorbed: (amount: number, victimId: string) => void;
    /** today: intakeFor(victimId).barrierAbsorbed += amount */
    addBarrierAbsorbed: (amount: number, victimId: string) => void;
}
/**
 * The combat-engine turn loop (combat-system.md §10). Each round seeds a per-actor action
 * pool (one pending action each) and repeatedly selects the unacted actor with the highest
 * CURRENT effective speed (selectNextBySpeed) until the pool drains — every actor takes one
 * turn (plus any extra-action grants): the attacker (default
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
        /** Total non-focus player (team) damage across all rounds — adapter summary. */
        teamTotal: number;
    };
    /** Healing-mode accounting (additive — present ONLY when healTargetId is set). */
    healing?: { rounds: HealingRoundEngine[]; destroyedRound?: number };
} {
    const {
        attack,
        crit,
        critDamage,
        defensePenetration,
        chargeCount,
        // shipSkills is intentionally NOT destructured here — the cast/reactive split below
        // rebinds `shipSkills` to the cast-only subset (partitionReactiveAbilities).
        enemyDefense,
        enemyHp,
        numRounds,
        selfBuffs,
        enemyDebuffs,
        selfDotModifier,
        defensePenetrationBuff,
        hasChargedSkill,
        startCharged,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        defence,
        hp,
        hacking,
        enemySecurity,
        allyChargePerRound,
        enemyType,
        speed,
        enemySpeed,
        bus: externalBus,
    } = input;

    // A.3 migration: every team actor walks. Synthesize an empty-kit walk for any buff-only actor so the
    // legacy non-walked-team branch is unreachable (and deleted in Task 4). Single const → every downstream
    // teamActors read (teamCombatActors, teamRuntimeById, teamSources, lookups, hp/defence defaults) sees the
    // normalized roster unchanged.
    const teamActors = normalizeTeamActorsToWalked(input.teamActors ?? []);

    // Internal bus — always created (Phase 3). Reactive listeners attach here. When an
    // external bus is provided it is a pure WRITE-ONLY tap: each emit fans out to the
    // external bus FIRST (its listeners stay write-only, registered before the engine's
    // own reactive listeners), then to the internal bus. Everything that flowed through
    // `bus?` now flows through this unconditional `bus`.
    const internalBus = createEventBus();
    const bus: CombatEventBus = externalBus
        ? {
              on: internalBus.on,
              emit: (e) => {
                  externalBus.emit(e);
                  internalBus.emit(e);
              },
          }
        : internalBus;

    // Cast/reactive split (Phase 3). Live-trigger buff/debuff/dot/charge abilities are
    // EXCLUDED from every on-cast pipeline (the registration loop + runPlayerTurn) and
    // instead registered as reactive listeners in slot/text order. Everything else stays
    // on-cast — including any non-buff/debuff/dot/charge ability carrying a live trigger
    // value (the executor only supports those four types).
    const { castSkills: shipSkills, reactiveAbilities } = partitionReactiveAbilities(
        input.shipSkills
    );

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
        stats: {
            attack,
            crit,
            critDamage,
            defensePenetration,
            defence,
            hp,
            speed: speed ?? 100,
            // Base hacking (A2 Task 2) — base for effectiveStatsOf.hacking; unread until landing lands (A2 Task 4).
            hacking,
        },
        chargeCount,
        startCharged,
        position: input.position,
        ignoresForcedTargeting: input.ignoresForcedTargeting,
        doesntBreakStasis: input.doesntBreakStasis,
        affinity: input.affinity,
    });
    const enemy = createActor({
        id: 'enemy',
        side: 'enemy',
        kind: 'enemy',
        indestructible: true,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: enemyDefense,
            hp: enemyHp,
            speed: enemySpeed ?? 50,
            // Base security (A2 Task 2) — base for effectiveStatsOf.security; unread until landing lands (A2 Task 4).
            security: enemySecurity,
        },
    });

    // The reported actor. Internal for now — the DPS adapter's attacker. The engine core
    // keys on this, never on the literal 'attacker' (end-state rule, spec). A later phase
    // lifts this into CombatEngineInput once multi-actor damage rows are needed (YAGNI).
    const focusActorId = 'attacker';

    // The full player-id universe for ally-target routing (Task 5): the focus actor FIRST,
    // then every team actor in INPUT ORDER. This order is FIXED (independent of which actor
    // casts an ally buff) so per-recipient application order is deterministic across the run.
    // For an attacker-only run this is just ['attacker'] → ally/all-allies collapse to the
    // owner, exactly as before Task 5 (zero churn). NOTE: it lists EVERY team actor (walked or
    // legacy) — a legacy team actor carries no walked statuses, but it is still a valid ally
    // recipient of another actor's all-allies buff (status maps are lazy-created per owner).
    const playerIds = [focusActorId, ...teamActors.map((t) => t.id)];

    // Team actors (Phase 2). Real speed-ordered actors carrying their own charge cadence;
    // they deal no damage and hold no DoTs/statuses (their buff grants sit on the attacker/
    // enemy via the status engine's per-source timed sets). For a WALKED team actor the real
    // combat stats come from the walk bundle (so the heal target's `currentHp` starts at its
    // true max HP — healing mode needs it); the only combat-actor `stats` reads in the engine
    // are turn-order speed (already real) and `currentHp`'s seeding from `stats.hp` (the heal
    // target). runPlayerTurn reads every stat from the RUNTIME, not the actor — so populating
    // real stats here changes no DPS behaviour (goldens stay byte-identical; verified). A
    // LEGACY team actor (no walk) keeps the dummy stats it always had.
    const teamCombatActors = teamActors.map((t) =>
        createActor({
            id: t.id,
            side: 'player',
            kind: 'team',
            stats: t.walk
                ? {
                      attack: t.walk.stats.attack,
                      crit: t.walk.stats.crit,
                      critDamage: t.walk.stats.critDamage,
                      defensePenetration: t.walk.stats.defensePenetration,
                      defence: t.walk.stats.defence,
                      hp: t.walk.stats.hp,
                      speed: t.speed,
                      hacking: t.walk.stats.hacking,
                      security: t.walk.stats.security,
                  }
                : {
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
            position: t.position,
            ignoresForcedTargeting: t.ignoresForcedTargeting,
            doesntBreakStasis: t.doesntBreakStasis,
            // RAW affinity rides on the walk bundle (set by the adapter from TeamActorInput.affinity
            // — the SAME source as the walk's affinityDamageModifier). Legacy (no walk) → undefined.
            affinity: t.walk?.affinity,
        })
    );

    // Per-team-actor parsed positional target (Task C2). The team actor's `position`
    // already rides on its CombatActor (createActor above), but its parsed `target`
    // lives only on the TeamActorEngineInput — thread it to the team-turn call site by
    // id. Empty for every non-positional input (no team actor passes a target) → the
    // gated branch never fires and the legacy binding stays byte-identical.
    const teamTargetById = new Map<string, ParsedTarget>();
    for (const t of teamActors) {
        if (t.target) {
            teamTargetById.set(t.id, t.target);
        }
    }

    // Per-team-actor parsed positional pattern (Task 8a), mirroring teamTargetById. The pattern
    // lives only on the TeamActorEngineInput — thread it to the team-turn call site by id for the
    // Task 8b apply path. Empty for every non-positional input (no pattern set) → inert today.
    const teamPatternById = new Map<string, ParsedPattern>();
    for (const t of teamActors) {
        if (t.pattern) {
            teamPatternById.set(t.id, t.pattern);
        }
    }

    // Per-enemy-attacker parsed positional target (Task C3, side-symmetric). The enemy's
    // `position` already rides on its CombatActor (buildEnemyPlayerActorRuntime → createActor),
    // but its parsed `target` lives only on the EnemyActorInput — thread it to the enemy-turn
    // call site by id, mirroring teamTargetById. Empty for every non-positional input (no enemy
    // passes a target) → the gated branch never fires and the legacy heal-target binding stays
    // byte-identical.
    const enemyTargetById = new Map<string, ParsedTarget>();
    for (const e of input.enemyAttackers ?? []) {
        if (e.target) {
            enemyTargetById.set(e.id, e.target);
        }
    }

    // Per-enemy-attacker parsed positional pattern (Task 8a), mirroring enemyTargetById /
    // teamPatternById. The pattern lives only on the EnemyActorInput — thread it to the enemy-turn
    // call site by id for the Task 8b apply path. Empty for every non-positional input → inert today.
    const enemyPatternById = new Map<string, ParsedPattern>();
    for (const e of input.enemyAttackers ?? []) {
        if (e.pattern) {
            enemyPatternById.set(e.id, e.pattern);
        }
    }

    // Deterministic event gates — replace Math.random / expected-value math so
    // identical inputs always produce identical output. Crit uses one gate PER
    // ACTION STREAM so the charged hit crits at exactly the crit rate regardless
    // of how the charge cadence aligns with the crit schedule (no aliasing).
    // Declared BEFORE the status engine so the landing hook can close over the
    // debuff-landing gate (Task 7 — timed enemy applications draw it once).
    const activeCritGate = makeRateGate();
    const chargedCritGate = makeRateGate();
    // Heal crit gates: SEPARATE streams from the damage crit gates (drawing from those would
    // shift a heal-carrying ship's damage-crit schedule → golden churn). Per-actor isolation.
    const activeHealCritGate = makeRateGate();
    const chargedHealCritGate = makeRateGate();
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
    // Reads the attacker runtime's LIVE per-target landing chance (A2 Task 4 — set each turn by
    // runPlayerTurn). Only invoked at turn time (after attackerRuntime is defined below), so the
    // forward reference is safe. `?? 1` is a neutral guard for a read before the first turn.
    const landsTimedEnemyApplication = (application?: 'inflict' | 'apply'): boolean =>
        application === 'apply'
            ? !affinityDisadvantage
            : debuffLandingGate(attackerRuntime.liveDebuffLandingChance ?? 1);

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

    // TEST-ONLY: expose the live status engine so a test can read settled self/enemy state after
    // the run (e.g. cast-path purge removal). Inert in production (field never set).
    input.__testTapStatusEngine?.(statusEngine);

    // Register the attacker's own buff/debuff abilities for in-loop application with live
    // condition gating. These flow from ShipSkills directly — the page no longer feeds the
    // converted SelectedGameBuff arrays into the sim (no-double-count). The attacker registers
    // FIRST (zero-churn ordering gate); walked team actors register AFTER, in input order.
    const { timedSelfBySlot, timedEnemyBySlot } = registerActorAbilityStatuses(
        shipSkills,
        statusEngine,
        'attacker',
        playerIds,
        // Heal target (healing mode) — narrows a single-`ally` Cheat-Death-family firing-slot
        // grant to the tank (Hermes). Undefined in DPS mode → falls back to the caster.
        input.healTargetId
    );

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

    // Attacker runtime — everything the focus actor's turns close over, built once.
    // The attacker carries the top-level inputs, the global merged lookups, and the
    // shared gates. Walked team runtimes (Task 4) come from TeamActorInput with their
    // own gate instances and empty lookups. The engine core keys on runtime/actor ids.
    const attackerRuntime: PlayerActorRuntime = {
        actor: attacker,
        focus: attacker.id === focusActorId,
        castSkills: shipSkills,
        reactiveAbilities,
        timedSelfBySlot,
        timedEnemyBySlot,
        hasChargedSkill,
        attack,
        crit,
        critDamage,
        defensePenetration,
        defence,
        hp,
        healModifier: input.healModifier ?? 0,
        selfDotModifier,
        defensePenetrationBuff,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        affinityDisadvantage,
        // RAW focus affinity — sourced from the SAME input.affinity the page resolved into the
        // pre-resolved affinityDamageModifier above, so the two never disagree. Positional
        // plumbing: read by victimHitDamage for per-victim re-resolution (Task 8b/9). Undefined →
        // neutral 'antimatter' default downstream.
        attackerAffinity: input.affinity,
        allyChargePerRound,
        activeCritGate,
        chargedCritGate,
        activeHealCritGate,
        chargedHealCritGate,
        debuffLandingGate,
        extendChanceGate,
        landsTimedEnemyApplication,
        selfBuffLookup,
        enemyDebuffLookup,
    };

    // Walked team runtimes (Task 4). For each team input with a `walk` bundle, build a
    // PlayerActorRuntime so its real turns run the full runPlayerTurn pipeline. Each gets
    // its OWN gate instances (determinism isolation — its draws never interleave with the
    // attacker's or another team actor's), its own landing closure (its affinity disadvantage
    // + its landing gate + its chance), stats from the walk bundle, focus=false, and EMPTY
    // lookups (its walked statuses carry their effects in payloads — no scheduled-buff lookup
    // expansion). Registration order: attacker first (above), then team actors in input order
    // (the loop order here) — fixed order = determinism. The team combat actor (turn-order
    // carrier) is matched by index to its input.
    const teamRuntimeById = new Map<string, PlayerActorRuntime>();
    teamActors.forEach((t, i) => {
        if (!t.walk) return;
        const w = t.walk;
        const teamActor = teamCombatActors[i];
        // Cast/reactive split per walked actor. Reactive abilities are PARTITIONED here but
        // NOT registered as listeners this task — Task 6 registers them per owner. They are
        // stored on the runtime so Task 6 can pick them up without re-partitioning.
        const { castSkills: teamCastSkills, reactiveAbilities: teamReactive } =
            partitionReactiveAbilities(w.shipSkills);
        // Register this walked actor's cast buff/debuff abilities under its own owner id
        // (AFTER the attacker — zero-churn ordering for the attacker-only path).
        const teamTimed = registerActorAbilityStatuses(
            teamCastSkills,
            statusEngine,
            t.id,
            playerIds,
            // Same carve-out narrowing as the attacker — a walked healer's single-`ally`
            // Cheat-Death-family grant lands on the heal target.
            input.healTargetId
        );
        const teamAffinityDisadvantage = w.affinityDamageModifier < 0;
        // Own gate instances — separate draw streams so a team actor's crit/landing/extend
        // rolls are isolated from the attacker's deterministic schedule.
        const teamActiveCritGate = makeRateGate();
        const teamChargedCritGate = makeRateGate();
        const teamActiveHealCritGate = makeRateGate();
        const teamChargedHealCritGate = makeRateGate();
        const teamDebuffLandingGate = makeRateGate();
        const teamExtendChanceGate = makeRateGate();
        // Reads this team actor's runtime LIVE per-target landing chance (A2 Task 4 — set each
        // turn by runPlayerTurn). Invoked only at turn time (after `runtime` below is defined),
        // so the forward reference is safe. `?? 1` is a neutral guard for a pre-first-turn read.
        const teamLandsTimedEnemyApplication = (application?: 'inflict' | 'apply'): boolean =>
            application === 'apply'
                ? !teamAffinityDisadvantage
                : teamDebuffLandingGate(runtime.liveDebuffLandingChance ?? 1);
        const runtime: PlayerActorRuntime = {
            actor: teamActor,
            focus: teamActor.id === focusActorId, // always false today (focus = attacker)
            castSkills: teamCastSkills,
            reactiveAbilities: teamReactive, // stored, NOT registered (Task 6)
            timedSelfBySlot: teamTimed.timedSelfBySlot,
            timedEnemyBySlot: teamTimed.timedEnemyBySlot,
            hasChargedSkill: w.hasChargedSkill,
            attack: w.stats.attack,
            crit: w.stats.crit,
            critDamage: w.stats.critDamage,
            defensePenetration: w.stats.defensePenetration,
            defence: w.stats.defence,
            hp: w.stats.hp,
            healModifier: w.healModifier ?? 0,
            selfDotModifier: w.selfDotModifier,
            defensePenetrationBuff: w.defensePenetrationBuff,
            affinityDamageModifier: w.affinityDamageModifier,
            affinityCritCap: w.affinityCritCap,
            affinityCritPenalty: w.affinityCritPenalty,
            affinityDisadvantage: teamAffinityDisadvantage,
            // RAW affinity — sourced from the SAME w.affinity (TeamActorInput.affinity) the adapter
            // fed to computeAffinityModifiers for w.affinityDamageModifier, so the two never
            // disagree. Positional plumbing: read by victimHitDamage (Task 8b/9). Undefined →
            // neutral 'antimatter' default downstream.
            attackerAffinity: w.affinity,
            allyChargePerRound: undefined, // attacker-only manual input
            activeCritGate: teamActiveCritGate,
            chargedCritGate: teamChargedCritGate,
            activeHealCritGate: teamActiveHealCritGate,
            chargedHealCritGate: teamChargedHealCritGate,
            debuffLandingGate: teamDebuffLandingGate,
            extendChanceGate: teamExtendChanceGate,
            landsTimedEnemyApplication: teamLandsTimedEnemyApplication,
            // Lookup asymmetry by design:
            //  - selfBuffLookup empty: scheduled SELF lists are attacker-granted (the attacker
            //    runtime owns them). A walked actor's self snapshot carries only payload entries
            //    (timedAbilityStatuses / activeAbilityStatuses fold those directly) — there are no
            //    scheduled SelectedGameBuff self-names to expand for this actor.
            //  - enemyDebuffLookup = the engine's GLOBAL map (global enemy picker + every team's
            //    manual enemyDebuffs): the enemy-side scheduled debuffs are SHARED across all
            //    player turns, so the team actor's own damage fold must expand them too. An empty
            //    map here silently zeroes those stat effects on the team's own turn (the attacker
            //    runtime holds the same global map, so attacker turns were already correct).
            selfBuffLookup: new Map(),
            enemyDebuffLookup,
        };
        teamRuntimeById.set(t.id, runtime);
    });

    // Whether ANY walked team actor exists — controls whether RoundData.teamDamage is set
    // (undefined preserves the legacy/attacker-only RoundData shape; goldens stay locked).
    const hasWalkedTeam = teamRuntimeById.size > 0;

    // All player actors (attacker + team turn-order carriers) — the universe ally-charge grants
    // bump. Built once. Used by `actorsBySide`/`bySide` below.
    const allPlayerActors = [attacker, ...teamCombatActors];

    // Live effective speed for ANY actor on EITHER side (Task 2 authority; UNWIRED — Task 3
    // wires it into the turn loop via selectNextBySpeed). Effective speed =
    // baseSpeed × (1 + Σ speedBuff% / 100), where baseSpeed is the actor's construction-time
    // stats.speed and the speedBuff% is folded LIVE from the status engine so a Speed Up/Down
    // applied mid-combat is reflected. Two sources are summed (Task 0 corpus investigation:
    // every corpus speed buff — Speed Up I/II/III, Speed Down I/II, XAOC Swiftness I/II/III — is
    // an UNCONDITIONAL timed status grant; there is NO conditional/gated speed buff, NO
    // always-active/aura speed buff, and NO standing speed modifier, so the ctx-gated
    // activeAbilityStatuses path is intentionally omitted):
    //   1. Scheduled self-buffs: snapshot(id).activeSelfBuffs expanded via selfBuffLookup.
    //   2. Timed ability statuses: timedAbilityStatuses('self', id) payloads.
    // Both fold through toSimBuffs → calculateBuffTotals, taking only .speedBuff. snapshot(id)
    // and timedAbilityStatuses('self', id) are keyed by owner id, so this is correct for any
    // actor regardless of side. Effective speed is UNCAPPED (magnitude only orders turns).
    const effectiveSpeedOf = (actor: CombatActor): number =>
        effectiveStatsOf(statusEngine, selfBuffLookup, actor).speed;

    // All mutable state declared fresh on every call
    let cumulativeDamage = 0;
    // Non-focus (team) cumulative damage. Enemy HP decline everywhere uses
    // cumulativeDamage + cumulativeTeamDamage; the row/summary cumulativeDamage stays focus-only.
    let cumulativeTeamDamage = 0;
    let totalTeamRaw = 0;
    let totalDirectRaw = 0;
    let totalCorrosionRaw = 0;
    let totalInfernoRaw = 0;
    let totalDetonationRaw = 0;
    let totalSecondaryRaw = 0;
    let totalConditionalRaw = 0;
    // DoT containers live on the enemy actor (were loop-locals in the old single-pass loop).
    const corrosionEntries = enemy.corrosionEntries;
    const infernoEntries = enemy.infernoEntries;
    const pendingBombs = enemy.pendingBombs;
    const pendingAccumulators = enemy.pendingAccumulators;
    // hp-changed event tracking (emission-only, no sim effect). ship-destroyed is owned by
    // the shared recordDestroyed helper, keyed on the per-actor destroyedRound field.
    let lastEnemyHpPctInt = 100;

    const roundData: RoundData[] = [];

    // Per-actor round-scoped context the enemy's DoT processing reads. Keyed by actor id;
    // every player turn sets its entry after runPlayerTurn. A DoT entry's tick resolves the
    // APPLIER's ctx (effectiveAttack for inferno; dotMult/affinityMult for both) via this map.
    // The focus actor's ctx feeds the row exactly as the old single `lastAttackerCtx` did. An
    // entry whose applier has not yet acted this run (faster-enemy round 1) has no ctx → skip.
    const lastTurnCtxByActor = new Map<string, PlayerRoundCtx>();

    // --- Healing mode (healing calc) ---
    // Resolve the heal target up front (throw on an unknown id — the switch must name a
    // player actor). When set, the engine runs in healing mode: every runPlayerTurn call
    // gets the SHARED HealingRuntimeCtx, heals/shields consume against the live target, and
    // a per-round HealingRoundEngine is assembled. Absent → DPS mode (the ctx is never built
    // and `healing: undefined` flows into runPlayerTurn — the heal block is inert).
    const healTargetId = input.healTargetId;
    const allPlayerActorsById = new Map<string, CombatActor>([
        [attacker.id, attacker],
        ...teamCombatActors.map((a) => [a.id, a] as const),
    ]);
    const healTarget = healTargetId ? allPlayerActorsById.get(healTargetId) : undefined;
    if (healTargetId && !healTarget) {
        throw new Error(`runCombat: healTargetId '${healTargetId}' is not a player actor`);
    }
    const healingMode = !!healTarget;

    // Enemy attackers (healing mode). Offense-only queue actors that bombard the heal target.
    // They exist ONLY in healing mode — providing them without a heal target is a config bug.
    const enemyAttackerInputs = input.enemyAttackers ?? [];
    if (enemyAttackerInputs.length > 0 && !healTarget) {
        throw new Error('runCombat: enemyAttackers require healTargetId');
    }
    // Validate enemy attacker ids before building any actors: an id that duplicates another
    // enemy attacker, or collides with a reserved/player id (the singular enemy entity, the
    // focus actor, or any team actor), would silently clobber a map entry (runtime lookup,
    // heal recipient, ctx) and corrupt the simulation. Reserved ids = playerIds + enemy.id.
    const reservedActorIds = new Set<string>([enemy.id, ...playerIds]);
    const seenEnemyAttackerIds = new Set<string>();
    for (const e of enemyAttackerInputs) {
        if (reservedActorIds.has(e.id)) {
            throw new Error(
                `runCombat: enemyAttackers[].id '${e.id}' collides with a reserved or player actor id`
            );
        }
        if (seenEnemyAttackerIds.has(e.id)) {
            throw new Error(`runCombat: duplicate enemyAttackers[].id '${e.id}'`);
        }
        seenEnemyAttackerIds.add(e.id);
    }
    // Enemy-team recipient order (mirror of playerIds): enemy ATTACKER ids in input order —
    // NOT the dummy enemy.id (the victim stand-in). Equals enemyAttackerActorIds but computable
    // before the runtimes map.
    const enemyRecipientIds = enemyAttackerInputs.map((e) => e.id);
    // Build a full PlayerActorRuntime for each enemy attacker (Task 5), in input order.
    // Each enemy gets its OWN gate instances (determinism isolation), reactive-partitioned
    // abilities, neutral affinity placeholder, and real defence/hp. The enemy walks
    // runPlayerTurn bound to the heal target (Task 6b) — its damage drains into the target,
    // self-buffs land in its own owner store, debuffs/DoTs on the target's per-target store.
    // Manual flat-card enemies (no shipSkills) are handled inside the builder by synthesizing
    // a single 100%/1-hit basic-attack active slot (parity with the retired EnemyAttackerRuntime).
    const enemyPlayerRuntimes: PlayerActorRuntime[] = enemyAttackerInputs.map((e) =>
        buildEnemyPlayerActorRuntime(e, {
            statusEngine,
            enemyIds: enemyRecipientIds,
            enemyDebuffLookup,
        })
    );
    const enemyAttackerActors = enemyPlayerRuntimes.map((r) => r.actor);
    const enemyAttackerActorIds = enemyAttackerActors.map((a) => a.id);
    const enemyPlayerRuntimeByActorId = new Map<string, PlayerActorRuntime>(
        enemyPlayerRuntimes.map((r) => [r.actor.id, r])
    );

    // ── Unified roster seam (bySide unification PR1) ───────────────────────────
    // The canonical, side-agnostic actor set, named once. Order MATTERS: it drives
    // the per-round turn order — `roundActors` is assigned to it each round —
    // [team…, attacker, dummy enemy, enemy attackers…], identical to the array
    // `roundActors` used inline before PR1. The companion accessor `actorsBySide`
    // arrives in a later PR with its first consumer (deferred — unread now =
    // YAGNI/lint); `allActorsById` has now arrived in PR2 (defined just below).
    const allActors: CombatActor[] = [...teamCombatActors, attacker, enemy, ...enemyAttackerActors];

    // TEST-ONLY: hand the full roster out once at construction so unit tests can assert the
    // plumbed base hacking/security on each actor (A2 Task 2). Inert in production (field never set).
    input.__testTapActors?.(allActors);

    // Combined id→actor map over the unified roster (bySide unification PR2 — first
    // consumer). Unlike allPlayerActorsById (attacker + team only), this includes the
    // dummy enemy and every enemy attacker, so a reactive granter on EITHER side
    // resolves. Used by grantExtraAction; companion actorsBySide lands in PR3.
    const allActorsById = new Map<string, CombatActor>(allActors.map((a) => [a.id, a]));

    // Task 7 — NAMES-ONLY condition-context sources for `enemy-buff` / `self-debuff` gates.
    // These read buff/debuff NAMES from the status engine; they NEVER fold effects (effects
    // are folded exactly once via snapshot()/activeAbilityStatuses/timedAbilityStatuses), so
    // there is no double-fold. Recomputed per turn from CURRENT live state.
    //
    //  - PLAYER actor's `enemy-buff` gate → opposing side = the enemy attacker(s). Aggregation:
    //    UNION of every enemy attacker's self-buff names (the condition is "does an enemy have a
    //    buff", not "does THIS enemy"). Inert in DPS mode (no enemy attackers → empty list).
    //  - PLAYER actor's `self-debuff` gate → its OWN enemy-applied debuffs (per-target store keyed
    //    by its id — the tank carries the enemy attacker's debuffs).
    //  - ENEMY actor's `enemy-buff` gate → opposing side = the player team (union of player
    //    self-buff names). `self-debuff` → its own per-target debuff store keyed by its id.
    const playerEnemyBuffNames = (): string[] =>
        selfBuffNamesForOwners(statusEngine, enemyAttackerActorIds);
    const enemyEnemyBuffNames = (): string[] => selfBuffNamesForOwners(statusEngine, playerIds);
    const ownerDebuffNames = (ownerId: string): string[] =>
        ownerDebuffNamesFor(statusEngine, ownerId);
    const isStasised = (actorId: string): boolean => ownerDebuffNames(actorId).some(isStasis);
    const isDisabled = (actorId: string): boolean => ownerDebuffNames(actorId).some(isDisable);
    /** Turn-blocked = cannot take its scheduled action this turn (Stasis OR Disable). Used by the
     *  three turn-action gates AND the reactive drain filter (drainQueue). The Stasis-only break /
     *  immunity sites intentionally keep using isStasised — Disable never breaks. */
    const isTurnBlocked = (actorId: string): boolean => isStasised(actorId) || isDisabled(actorId);

    // Base-HP fallback for recipientMaxHp before an actor has taken its first turn (no ctx yet):
    // attacker → input.hp; walked team → walk stats hp; enemy attackers → their CombatActor hp
    // (E5: enemy ids ARE now queried as recipients once enemy heals restore HP).
    const baseHpById = new Map<string, number>([
        [attacker.id, hp],
        ...teamActors.map((t) => [t.id, t.walk!.stats.hp] as const),
        ...enemyAttackerActors.map((a) => [a.id, a.stats.hp] as const),
    ]);
    const baseHpFor = (id: string): number => baseHpById.get(id) ?? 0;

    // ── Side-context bundle (bySide unification PR3) ───────────────────────────
    // Collapses the four hand-paired side closures — the per-side ally-charge grant and the
    // per-side lowest-speed-ally set (plus the drain-time self-HP% lookup) — into ONE
    // side-parameterized SideContext. `actorsBySide(side)` is the primitive (its first
    // consumers are the closures below + the drain/turn call sites). Built once into cached
    // playerSide/enemySide objects so each field is a stable reference.
    //
    // BYTE-IDENTICAL: the player context reproduces the old player closures verbatim; the enemy
    // context reproduces the old enemy closures verbatim — lowestSpeedIds keeps the enemy
    // `length === 0 → ∅` guard (inert for the player side, which always has the attacker), grant
    // loops the side's own actors, and selfHpPctFor returns 100 for every enemy owner (exactly what
    // the old shared healTarget closure returned for a non-healTarget id; an enemy owner id can
    // never equal healTarget.id — reservedActorIds forbids it). The genuine per-actor enemy
    // self-HP% (real enemy currentHp) lands in PR5 with per-actor accounting.
    type Side = CombatActor['side'];

    const actorsBySide = (side: Side): CombatActor[] =>
        side === 'player' ? allPlayerActors : enemyAttackerActors;

    interface SideContext {
        /** Bump every same-side actor's charges by `amount` (capped at each actor's own
         *  chargeCount; chargeCount 0 skipped — no charge skill to bank). */
        grantAllyCharges: (amount: number) => void;
        /** Same-side ids sharing the minimum LIVE effective speed (ties → all). Empty side → ∅
         *  (DPS / no enemy attackers). Recomputed per gate eval (speed is dynamic). */
        lowestSpeedIds: () => Set<string>;
        /** Live self-HP% for a same-side drain owner (hp-threshold gates). Player side reads the
         *  heal target's live HP (every other id → 100), undefined in DPS mode (→ buildDrainContext
         *  defaults to 100). Enemy side returns 100 for every owner (no per-actor enemy HP until
         *  PR5). Consumed in Task 2. */
        selfHpPctFor?: (ownerId: string) => number;
        /** Same-side ids adjacent to `ownerId` on the board (living, owner excluded). Positional
         *  → board neighbours; non-positional (no positions wired) → all living same-side allies. */
        adjacentAllyIdsFor: (ownerId: string) => string[];
    }

    const buildSideContext = (side: Side): SideContext => {
        const actors = actorsBySide(side);
        return {
            grantAllyCharges: (amount: number): void => {
                for (const a of actors) {
                    if (a.chargeCount <= 0) continue;
                    a.charges = Math.min(a.charges + amount, a.chargeCount);
                }
            },
            lowestSpeedIds: (): Set<string> => {
                if (actors.length === 0) return new Set<string>();
                const speeds = actors.map((a) => effectiveSpeedOf(a));
                const min = Math.min(...speeds);
                return new Set(actors.filter((_, i) => speeds[i] === min).map((a) => a.id));
            },
            selfHpPctFor:
                side === 'player'
                    ? healTarget
                        ? (ownerId: string): number => {
                              if (ownerId !== healTarget.id) return 100;
                              // Same denominator as the cast-path selfHpPct (baseHpFor) so the gate
                              // flips at the same threshold at cast vs drain time.
                              const maxHp = baseHpFor(healTarget.id);
                              if (maxHp <= 0) return 100;
                              return Math.max(
                                  0,
                                  Math.min(100, (healTarget.currentHp / maxHp) * 100)
                              );
                          }
                        : undefined
                    : (): number => 100,
            adjacentAllyIdsFor: (ownerId: string): string[] => adjacentAllyIds(ownerId, actors),
        };
    };

    const playerSide = buildSideContext('player');
    const enemySide = buildSideContext('enemy');
    const bySide = (side: Side): SideContext => (side === 'player' ? playerSide : enemySide);

    // Base-DEFENCE fallback for an enemy attacker's target-defence read before the target has
    // taken its first turn (no ctx yet): attacker → input.defence; walked team → walk defence;
    // legacy team → 0. After the target's first turn the live ctx.effectiveDefence is preferred.
    const baseDefenceById = new Map<string, number>([
        [attacker.id, defence],
        ...teamActors.map((t) => [t.id, t.walk!.stats.defence] as const),
    ]);
    const baseDefenceFor = (id: string): number => baseDefenceById.get(id) ?? 0;

    // The per-round healing map. Rebound at the top of each round (in healing mode) so the
    // ctx's `credit` always writes into the CURRENT round's entries via this `let`.
    let currentRoundHealing = new Map<string, ActorHealing>();
    const healFor = (id: string): ActorHealing => {
        let h = currentRoundHealing.get(id);
        if (!h) {
            h = emptyActorHealing();
            currentRoundHealing.set(id, h);
        }
        return h;
    };

    // Recipient's CURRENT effective max HP: prefer the actor's last-turn ctx (live buffs),
    // else its base HP (pre-first-turn). Same pattern for incoming-heal % (ctx value ?? 0).
    const recipientMaxHp = (id: string): number =>
        lastTurnCtxByActor.get(id)?.effectiveMaxHp ?? baseHpFor(id);
    const recipientIncomingHealPct = (id: string): number =>
        lastTurnCtxByActor.get(id)?.incomingHealPct ?? 0;

    // Heal target's live HP% (0..100) for `hpSubject:'target'` cast-time gates (Task 5). Read at
    // the ACTING actor's turn start (pre-this-cast-heal): healTarget.currentHp already reflects
    // the turn-start DoT tick but not the cast's heal. DPS mode (no healTarget) → 100 → a "below
    // N" target gate fails → the grant is inert in DPS (correct). Defined here so every player
    // turn dispatch (attacker + walked team) reads the same denominator (recipientMaxHp).
    const healTargetHpPctNow = (): number => {
        if (!healTarget) return 100;
        const maxHp = recipientMaxHp(healTarget.id);
        return maxHp > 0 ? (100 * Math.max(0, healTarget.currentHp)) / maxHp : 100;
    };

    // The healing rounds + first-destroyed-round seam (target HP can only reach 0 via enemy
    // attacks, which land in Task 8 — the detection just never fires this task).
    const healingRounds: HealingRoundEngine[] = [];
    // Backstop-only local (PR5c): holds ONLY the post-round backstop's independent contribution
    // — the start-dead / no-`recordDestroyed` path where the heal target enters a round at
    // currentHp<=0 without ever being stamped by recordDestroyed (Task-1 OUTCOME B). The normal
    // death round now comes from the per-actor `healTarget.destroyedRound` field; this captures
    // only the case that field never sees.
    let backstopDestroyedRound: number | undefined;
    // Cheat Death consumption (Phase 4b). A 'recurring'/always-active Cheat Death buff is
    // re-derived every round and is NOT stored in the StatusEngine's timed maps, so it cannot
    // be consumed by deleting it from a store (it would regenerate next round). Consumption is
    // therefore a per-actor ENGINE FLAG with combat lifetime: once an actor's intercept fires,
    // its id lands here and a SECOND lethal hit destroys it normally even though the recurring
    // buff is still in the snapshot. Declared OUTSIDE the round loop → persists across rounds.
    const cheatDeathConsumed = new Set<string>();
    // Display-only (Phase 4c): a spent Cheat Death keeps reappearing in the displayed buff list
    // for two reasons, depending on how it was granted. (1) Passive/aura grants (Tycho) are
    // re-derived from the persistent aura store every round and clearRemovable leaves auras
    // intact by design. (2) Active/charged cast-path grants (timed, Infinity) ARE deleted by
    // clearRemovable on consumption, but a slot that re-fires each round re-applies them. Either
    // way the chip would keep showing even though no further save is possible (consumption is the
    // flag above, not a permanent store removal). `cheatDeathConsumed` is combat-lifetime and
    // never re-armed (only ever .add'd / .has'd — see the intercept), so an actor present here
    // can never be saved again.
    //
    // We track the round the intercept fired (set alongside the flag) and hide the chip only in
    // rounds STRICTLY AFTER consumption: the consuming round still shows it (that round's chip
    // reflects the protection that was live and actually saved the unit), and every subsequent
    // round drops it. Pure display filter — does NOT touch save logic.
    const cheatDeathConsumedRound = new Map<string, number>();
    const hideSpentCheatDeath = (
        buffs: ActiveBuff[],
        ownerId: string,
        round: number
    ): ActiveBuff[] => {
        const consumedRound = cheatDeathConsumedRound.get(ownerId);
        return consumedRound !== undefined && round > consumedRound
            ? buffs.filter((b) => !CHEAT_DEATH_BUFFS.has(b.buffName))
            : buffs;
    };
    // Once-per-combat reactive repairs (Phase 4b, Task 8). Keyed `${ownerId}:${abilityId}`.
    // Declared OUTSIDE the round loop (combat lifetime, like cheatDeathConsumed) so a flagged
    // repair — Yazid's on-cheat-death-activated 60% repair — fires at most once per battle even
    // across rounds. Threaded into executeIntent's ctx; the executor checks/sets it.
    const oncePerCombatFired = new Set<string>();
    // Combat-lifetime proc-chance gates for equipment reactive procs (D-PR1). Keyed
    // `${ownerId}:${abilityId}`; each gate is a RateGate accumulator that fires at the
    // ability's procChance rate across all rounds, deterministically (like crit/landing gates).
    const procChanceGates = new Map<string, RateGate>();

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // Reactive extra-action timing analysis (Phase 4b Task 10). Two death paths land an
    // extra-action grant in DIFFERENT rounds; the engine's grantExtraAction (below) dispatches
    // by whether the round-local turn queue is still being walked:
    //
    //  PATH A — during-turn deaths (on-destroyed self, on-ally-destroyed ally → Harvester).
    //    These fire from applyIncomingToTarget / the general death path, which run DURING an
    //    actor's turn. They are followed by the per-turn drainIntents() (drain point (b)) while
    //    the selection loop is still walking → the grant CAN bump the granter's pending count
    //    via processExtraActionGrants(granter, …), and the selection loop then re-picks the
    //    granter at its live speed-rank among the remaining actors (a same-round extra turn).
    //    `inTurnLoop` is true only while the loop body walks; the pre-loop / post-round drains
    //    see it false → Path B.
    //
    //  PATH B — post-round enemy death (cross-round buffered grant). Fires when an enemy death is
    //    reconciled AFTER the turn loop closed and after the round's last per-turn drainIntents(),
    //    with NO live queue. The post-round drain block then:
    //      1. runs drainIntents() right after the ship-destroyed emit — on-enemy-destroyed CHARGE
    //         reactives (Liberator's "all allies add 1 charge") apply immediately; charges carry
    //         into the next round → correct.
    //      2. buffers extra-action grants (inTurnLoop false → grantExtraAction pushes onto
    //         `pendingExtraActions`); at the START of the NEXT round's pool construction each
    //         buffered granter's pending count is bumped one extra (respecting once-per-round via
    //         the SAME round extraActionFired set) → the on-kill extra action lands the round AFTER
    //         the kill is registered.
    //    DORMANT TODAY (PR5d): the only actor that died post-round was the DPS dummy enemy, which
    //    is now `indestructible` and never dies (the death block at ~3834 is gated on
    //    `!enemy.indestructible`). Real enemy attackers die DURING a turn (positional
    //    applyOutgoingToEnemy → recordDestroyed in the live queue) → Path A, not B. So no current
    //    path produces a post-round death; the buffering machinery below is intact and correct,
    //    and re-activates once a destructible enemy has a genuinely post-round-reconciled death.
    //
    // pendingExtraActions is COMBAT-lifetime (outside the round loop) so a kill reconciled at the
    // end of round R survives into round R+1's pool build. Each entry is flushed (and removed)
    // exactly once at the next round's start.
    // ═══════════════════════════════════════════════════════════════════════════════════════
    const pendingExtraActions: {
        granterId: string;
        abilityId: string;
        oncePerRound: boolean;
        endOfRound: boolean;
    }[] = [];

    // Per-round set of actor ids that received a positive HP repair this round (C2b-3).
    // Cleared at each round top; read in buildTurnArgs for the target-repaired gate.
    const repairedThisRound = new Set<string>();

    // D-PR8: actors hit by a direct attack this round (damage landed on shield or HP).
    // Mirrors repairedThisRound. Feeds the not-hit-this-round gate (Alacrity). Cleared each
    // round alongside repairedThisRound.
    const hitThisRound = new Set<string>();

    // The SHARED healing ctx (built once; closures capture the live target + currentRoundHealing
    // through the `let`/the target reference). Only constructed in healing mode.
    const healingCtx: HealingRuntimeCtx | undefined = healTarget
        ? {
              targetId: healTarget.id,
              credit: (actorId, bucket, amount) => {
                  healFor(actorId)[bucket] += amount;
              },
              recipientMaxHp,
              recipientIncomingHealPct,
              recipientIncomingHealAmpPct: (rid) =>
                  incomingHealAmpForRecipient(
                      incomingHealAmpAbilitiesOf(rid),
                      (abilityId, chance) =>
                          rollRateGate(procChanceGates, `${rid}:${abilityId}`, chance)
                  ),
              // Foreign HoT applier max HP (Task 7): lastTurnCtxByActor ONLY, NO base-stat
              // fallback (strict corrosion applier-ctx rule — undefined → the holder skips the tick).
              applierMaxHp: (id) => lastTurnCtxByActor.get(id)?.effectiveMaxHp,
              applyHealToTarget: (raw, victim = healTarget) => {
                  // Dead target → all overheal. Otherwise consume up to the deficit against
                  // the target's CURRENT effective max HP (live ctx via recipientMaxHp).
                  if (victim.currentHp <= 0) {
                      return { consumed: 0, overheal: raw };
                  }
                  const targetMaxHp = recipientMaxHp(victim.id);
                  // Clamp the deficit at 0: a max-HP buff expiring can shrink effectiveMaxHp
                  // below currentHp, making (targetMaxHp - currentHp) negative — without the
                  // Math.max a heal would REDUCE the target's HP. Floor at 0 → consumed 0,
                  // overheal = raw (the whole heal is wasted, which is correct in that state).
                  const consumed = Math.max(0, Math.min(raw, targetMaxHp - victim.currentHp));
                  victim.currentHp += consumed;
                  if (consumed > 0) repairedThisRound.add(victim.id);
                  return { consumed, overheal: raw - consumed };
              },
              grantShieldToTarget: (raw, victim = healTarget) => {
                  if (victim.currentHp <= 0) return; // dead → no-op
                  const targetMaxHp = recipientMaxHp(victim.id);
                  // Capped at the CURRENT effective max HP. Note: if a max-HP buff later expires
                  // and shrinks targetMaxHp below an already-granted pool, the larger pool simply
                  // persists (we never shrink an existing shield) — acceptable, as the cap is only
                  // enforced at grant time and a shield is additive, never HP-reducing.
                  victim.shieldPool = Math.min(victim.shieldPool + raw, targetMaxHp);
              },
              playerIds,
              enemyIds: enemyRecipientIds,
              recipientActor: (id) => allActorsById.get(id),
          }
        : undefined;

    // --- Phase 3 reactive triggers ---
    // Intent queue (FIFO). Reactive listeners enqueue follow-up executions; the engine
    // drains them at the drain points. Pure listeners (enqueue only) keep the Phase 1
    // contract — the executor is the only state mutator.
    const intentQueue: Intent[] = [];
    // Per-owner reactive listeners (Task 6): the FOCUS/attacker owner FIRST (zero-churn —
    // its listeners enqueue in the historical order), then every walked team owner in input
    // order. Each owner's guards key on its OWN events; the executor routes the follow-up to
    // the owner's runtime. A legacy team actor (no walk) has no reactive abilities → omitted.
    const reactivePerOwner: { ownerId: string; reactiveAbilities: typeof reactiveAbilities }[] = [
        { ownerId: 'attacker', reactiveAbilities },
        ...teamActors
            .filter((t) => teamRuntimeById.has(t.id))
            .map((t) => ({
                ownerId: t.id,
                reactiveAbilities: teamRuntimeById.get(t.id)!.reactiveAbilities,
            })),
    ];
    // Enemy-side actor ids: the singular dummy wall enemy AND every enemy ATTACKER (healing
    // mode). Enemy attackers now walk runPlayerTurn (commit 6c456a14) and emit the full reactive
    // event suite with side === 'enemy'; ally-scoped player listeners MUST treat all of these as
    // non-allies, not just the dummy. seenEnemyAttackerIds holds the attacker ids (empty for a
    // DPS/attacker-only run → only the dummy is enemy-side).
    const isEnemySide = (actorId: string): boolean =>
        actorId === enemy.id || seenEnemyAttackerIds.has(actorId);
    // Damaged-ally role lookup for role-filtered reactions (Graphite). Roles come from
    // ship data on the healing page (TeamActorInput.role / the focus actor's input.role);
    // built for ALL player actors for uniformity even though in healing mode only the heal
    // target is ever attacked. An actor without a role stays OFF the map → roleOf returns
    // undefined → role-filtered reactions stay dormant for hits on it (conservative).
    const roleByActorId = new Map<string, ShipTypeName>();
    if (input.role) roleByActorId.set(focusActorId, input.role);
    for (const t of teamActors) if (t.role) roleByActorId.set(t.id, t.role);
    registerReactiveListeners({
        bus,
        perOwner: reactivePerOwner,
        enqueue: (intent) => intentQueue.push(intent),
        isOpposing: isEnemySide,
        roleOf: (id) => roleByActorId.get(id),
        adjacentAllyIdsFor: (ownerId: string) =>
            bySide(isEnemySide(ownerId) ? 'enemy' : 'player').adjacentAllyIdsFor(ownerId),
    });

    // Enemy-side reactive registration (enemy-team PR1). A SEPARATE intent queue + a second
    // registerReactiveListeners call so an enemy attacker's own reactive abilities (e.g.
    // Chakara's start-of-round self Attack Up) fire — before this they were partitioned onto
    // the enemy runtime but never listened for. registerReactiveListeners holds NO module-level
    // state: it only attaches per-call `bus.on(...)` subscriptions closing over its args, so a
    // second call adds an independent listener set without disturbing the player registration.
    // Gated on length>0 so DPS / bare-stat-enemy runs register nothing (goldens byte-identical).
    const enemyIntentQueue: Intent[] = [];
    const enemyReactivePerOwner = enemyPlayerRuntimes.map((rt) => ({
        ownerId: rt.actor.id,
        reactiveAbilities: rt.reactiveAbilities,
    }));
    if (enemyReactivePerOwner.length > 0) {
        registerReactiveListeners({
            bus,
            perOwner: enemyReactivePerOwner,
            enqueue: (intent) => enemyIntentQueue.push(intent),
            // Enemy owners: the PLAYER team is opposing. Negating the player-centric
            // isEnemySide flips on-enemy-* / on-ally-* to the enemy's own frame
            // (bySide PR2 — fixes the enemy reactive-routing bug).
            isOpposing: (id: string) => !isEnemySide(id),
            roleOf: (id) => roleByActorId.get(id),
            adjacentAllyIdsFor: (ownerId: string) =>
                bySide(isEnemySide(ownerId) ? 'enemy' : 'player').adjacentAllyIdsFor(ownerId),
        });
    }

    // Owner-routed executor context (Task 6): the executor resolves an intent's owner runtime
    // from this map for per-owner landing gates, charge caps, sourceId, bomb effective-attack.
    const runtimesById = new Map<string, PlayerActorRuntime>([
        ['attacker', attackerRuntime],
        ...teamRuntimeById,
    ]);

    // Passive-slot standing leeches per owner (damage-leech spec §4): X% of credited
    // damage repaired/shielded immediately at credit time. Scanned once at setup from each
    // runtime's reactive-partitioned castSkills (passive-slot heal/shield abilities are
    // on-cast, not reactive, so they remain here after partitioning). Healing mode only.
    interface StandingLeech {
        kind: 'heal' | 'shield';
        pct: number;
        target: AbilityTarget;
        noCrit: boolean;
        scope: 'all' | 'detonation';
    }
    const standingLeeches = new Map<string, StandingLeech[]>();
    if (healTarget) {
        for (const [ownerId, rt] of runtimesById) {
            const entries: StandingLeech[] = [];
            for (const slot of rt.castSkills.slots) {
                if (slot.slot !== 'passive') continue;
                for (const a of slot.abilities) {
                    const c = a.config;
                    if ((c.type === 'heal' || c.type === 'shield') && c.basis === 'damage-dealt') {
                        entries.push({
                            kind: c.type,
                            pct: c.pct,
                            target: a.target,
                            noCrit: c.type === 'heal' ? (c.noCrit ?? false) : true,
                            scope: c.leechScope ?? 'all',
                        });
                    }
                }
            }
            if (entries.length > 0) standingLeeches.set(ownerId, entries);
        }
    }

    // Passive damage-taken abilities per owner (damage-leech spec §5): each enemy ATTACK on a
    // victim procs that victim's own abilities AFTER the attack's shield-first drain. Sibling
    // shape to the standing leeches above — scanned once at setup from every runtime, keyed by
    // owner id. The non-positional consumption site reads only the heal target's list (enemy
    // attacks land on the heal target in that model), so its behavior is unchanged; the
    // per-owner map prepares the per-victim positional path (Phase-5 follow-up). Healing mode only.
    interface TakenLeech {
        kind: 'heal' | 'shield';
        pct: number;
        noCrit: boolean;
        requiresHpDamage: boolean;
    }
    const takenLeechesByOwner = new Map<string, TakenLeech[]>();
    if (healTarget) {
        for (const [ownerId, rt] of runtimesById) {
            const entries: TakenLeech[] = [];
            for (const slot of rt.castSkills.slots) {
                if (slot.slot !== 'passive') continue;
                for (const a of slot.abilities) {
                    const c = a.config;
                    if ((c.type === 'heal' || c.type === 'shield') && c.basis === 'damage-taken') {
                        entries.push({
                            kind: c.type,
                            pct: c.pct,
                            noCrit: c.type === 'heal' ? (c.noCrit ?? false) : true,
                            requiresHpDamage: c.requiresHpDamage ?? false,
                        });
                    }
                }
            }
            if (entries.length > 0) takenLeechesByOwner.set(ownerId, entries);
        }
    }

    // D-PR3: per-actor victim-side incoming-effect abilities (incoming-reduction + incoming-block),
    // side-agnostic (a ship defends on either team). Built once from BOTH runtime maps; empty for
    // actors without the relevant equipment. Consumed today only by the %-reduction fold in the
    // positional path; incoming-block is collected here too for the later block task.
    const incomingAbilitiesById = new Map<string, Ability[]>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        if (incomingAbilitiesById.has(rt.actor.id)) continue; // dedupe if an actor is in both maps
        const incoming: Ability[] = [];
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const a of slot.abilities) {
                if (a.config.type === 'incoming-reduction' || a.config.type === 'incoming-block') {
                    incoming.push(a);
                }
            }
        }
        if (incoming.length) incomingAbilitiesById.set(rt.actor.id, incoming);
    }
    const incomingAbilitiesOf = (id: string): Ability[] => incomingAbilitiesById.get(id) ?? [];

    // D-PR6: per-actor recipient-side incoming-heal-amplification abilities (Exuberance),
    // side-agnostic (a ship can be a heal recipient on either team). Built once from BOTH runtime
    // maps; empty for actors without the relevant equipment. Consumed by the heal-apply fold (a
    // later task) — nothing reads it yet, so this is byte-identical.
    const incomingHealAmpAbilitiesById = new Map<string, Ability[]>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        if (incomingHealAmpAbilitiesById.has(rt.actor.id)) continue; // dedupe if an actor is in both maps
        const heals: Ability[] = [];
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const a of slot.abilities) {
                if (a.config.type === 'incoming-heal-amplification') heals.push(a);
            }
        }
        if (heals.length) incomingHealAmpAbilitiesById.set(rt.actor.id, heals);
    }
    const incomingHealAmpAbilitiesOf = (id: string): Ability[] =>
        incomingHealAmpAbilitiesById.get(id) ?? [];

    // D-PR4: per-actor attacker-side outgoing-amplification abilities (Menace/Giant Slayer),
    // side-agnostic (a ship amplifies on either team). Built once from BOTH runtime maps; empty for
    // actors without the relevant equipment. Consumed by the per-victim amplification hook on the
    // positional path.
    const outgoingAbilitiesById = new Map<string, Ability[]>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        if (outgoingAbilitiesById.has(rt.actor.id)) continue; // dedupe if an actor is in both maps
        const outgoing: Ability[] = [];
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const a of slot.abilities) {
                if (a.config.type === 'outgoing-amplification') {
                    outgoing.push(a);
                }
            }
        }
        if (outgoing.length) outgoingAbilitiesById.set(rt.actor.id, outgoing);
    }
    const outgoingAbilitiesOf = (id: string): Ability[] => outgoingAbilitiesById.get(id) ?? [];

    // D-PR3: is this actor currently Stealthed? Sibling to isStasised — reads the actor's active
    // self-buff names (snapshot + timed + active ability statuses). 'Stealth' is the buff name the
    // positional targeting stealth-filter also queries (triggers.ts buildForcedTargetingStatus).
    const isStealthed = (actorId: string): boolean =>
        selfBuffNamesForOwners(statusEngine, [actorId]).includes('Stealth');

    // Proc an owner's standing leeches against a damage credit (heals immediately at
    // credit time — a DoT-tick leech lands during the enemy turn, which is the correct
    // survival timing). Simplified drain-style fold (spec §4): healModifier only + a
    // deterministic heal-crit draw on the owner's activeHealCritGate at the RUNTIME's
    // standing crit/critDamage (base+gear stats — the per-turn folded effectiveCrit only
    // exists mid-turn). NO heal-performed emission (chain guard: leech procs never feed
    // on-ally-critically-repaired). Healing mode only; inert when no leeches registered.
    const procStandingLeeches = (sourceId: string, channel: LeechChannel, amount: number): void => {
        if (!healingCtx || amount <= 0) return;
        const entries = standingLeeches.get(sourceId);
        if (!entries) return;
        const owner = runtimesById.get(sourceId);
        if (!owner) return;
        for (const e of entries) {
            if (e.scope === 'detonation' && channel !== 'detonation') continue;
            let raw = amount * (e.pct / 100);
            if (e.kind === 'heal') {
                raw *= 1 + owner.healModifier / 100;
                if (!e.noCrit && owner.activeHealCritGate(owner.crit / 100)) {
                    raw *= 1 + owner.critDamage / 100;
                }
            }
            const recipients =
                e.target === 'ally'
                    ? [healTarget!.id]
                    : e.target === 'all-allies'
                      ? healingCtx.playerIds
                      : [sourceId];
            for (const rid of recipients) {
                if (e.kind === 'heal') {
                    healingCtx.credit(sourceId, 'directHeal', raw);
                    if (rid === healTarget!.id) {
                        const { consumed, overheal } = healingCtx.applyHealToTarget(raw);
                        healingCtx.credit(sourceId, 'effectiveHeal', consumed);
                        healingCtx.credit(sourceId, 'overheal', overheal);
                    }
                } else {
                    healingCtx.credit(sourceId, 'shield', raw);
                    if (rid === healTarget!.id) healingCtx.grantShieldToTarget(raw);
                }
            }
        }
    };

    // E2 Task 3: PER-VICTIM standing-leech proc for the POSITIONAL apply path.
    //
    // The non-positional `procStandingLeeches` above rides the aggregate `creditDamage(...
    // 'direct' ...)` write — but that write is SUPPRESSED for the positional case (the firing-hit
    // damage lands per-victim via applyPositionalDamage, so crediting it again would double-count).
    // So on the positional path NO standing leech fired before E2. This proc restores it by
    // running once per FOOTPRINT VICTIM (wired via drivePositionalApply's `onVictimResolved`),
    // leeching off THAT victim's already-role-scaled dealt damage — so origin victims contribute
    // full damage and covered victims contribute half automatically (the caller passes the
    // per-victim `damage`).
    //
    // It REUSES procStandingLeeches's fold math (pct → raw, healModifier, heal-crit draw) but does
    // its OWN pool application via the Task-1 parametrized closures (applyHealToTarget(raw, actor) /
    // grantShieldToTarget(raw, actor)), resolving each recipient's actor — so a covered enemy's
    // leech can repair the right ally, not just the heal target. procStandingLeeches is left
    // UNTOUCHED (its `rid === healTarget.id` pool-gating is load-bearing for the non-positional
    // all-allies case, leech.test.ts:355-404).
    //
    // RECIPIENT RESOLUTION: via `runtimesById` (NOT allActorsById) — the focus attacker is keyed
    // 'attacker', not its real id. `self` → the acting owner; `ally` → the heal target; `all-allies`
    // → every player id. A recipient with no resolvable runtime actor is credited but not
    // pool-applied (mirrors procStandingLeeches's effect for the all-allies non-target case).
    //
    // HEAL-CRIT-GATE CADENCE: this fires once per victim, so a heal-kind leech draws the owner's
    // `activeHealCritGate` ONCE PER VICTIM (an N-victim AoE makes N draws, in footprint order).
    // The perVictimLeech test pins the exact numbers.
    //
    // NO `dmg()`/cumulative accumulator write here (the per-victim apply already landed the HP
    // damage; the aggregate direct credit stays suppressed) → no double-count. Honors `scope`:
    // a detonation-scoped leech is skipped on the per-victim `direct` channel.
    const procStandingLeechesPerVictim = (sourceId: string, amount: number): void => {
        if (!healingCtx || amount <= 0) return;
        const entries = standingLeeches.get(sourceId);
        if (!entries) return;
        const owner = runtimesById.get(sourceId);
        if (!owner) return;
        for (const e of entries) {
            // Per-victim damage rides the `direct` channel only; detonation-scoped leeches
            // never fire here (bombs credit through the aggregate detonation path instead).
            if (e.scope === 'detonation') continue;
            let raw = amount * (e.pct / 100);
            if (e.kind === 'heal') {
                raw *= 1 + owner.healModifier / 100;
                // One heal-crit draw PER VICTIM (this proc runs per footprint victim).
                if (!e.noCrit && owner.activeHealCritGate(owner.crit / 100)) {
                    raw *= 1 + owner.critDamage / 100;
                }
            }
            const recipients =
                e.target === 'ally'
                    ? [healTarget!.id]
                    : e.target === 'all-allies'
                      ? healingCtx.playerIds
                      : [sourceId];
            for (const rid of recipients) {
                // Resolve the recipient's live actor for the pool application (Task-1 closures
                // take an explicit victim). runtimesById, not allActorsById: the focus is 'attacker'.
                const recipientActor = runtimesById.get(rid)?.actor;
                if (e.kind === 'heal') {
                    healingCtx.credit(sourceId, 'directHeal', raw);
                    if (recipientActor) {
                        const { consumed, overheal } = healingCtx.applyHealToTarget(
                            raw,
                            recipientActor
                        );
                        healingCtx.credit(sourceId, 'effectiveHeal', consumed);
                        healingCtx.credit(sourceId, 'overheal', overheal);
                    }
                } else {
                    healingCtx.credit(sourceId, 'shield', raw);
                    if (recipientActor) healingCtx.grantShieldToTarget(raw, recipientActor);
                }
            }
        }
    };

    // E2 Task 5: PER-VICTIM damage-TAKEN leech proc for the POSITIONAL enemy branch
    // (enemy→player). The non-positional consumption block (~:4025) credits ONLY the heal
    // target off the aggregate `damage`, gated by `!enemyPositional` — so on the positional
    // path NO taken leech fired before E2 (each player victim took only its OWN per-victim AoE
    // share, and the heal-target-only single-row credit would have been wrong). This proc
    // restores it by running once per FOOTPRINT VICTIM (wired via drivePositionalApply's
    // `onVictimResolved` at the enemy site), procing THAT victim's OWN taken-leeches
    // (takenLeechesByOwner.get(victim.id)) off the per-victim `damage` it took, applying to the
    // victim's OWN pool via the Task-1 closures.
    //
    // SEMANTICS — mirror the non-positional block (~:4025-4060) PER VICTIM:
    //   - Barrier carve-out: skip entirely if the victim was `barriered` (its hit was fully
    //     blocked — no damage taken, nothing to leech). Per victim via `outcome.barriered`.
    //   - requiresHpDamage (Quixilver): only fire an entry with requiresHpDamage when the hit
    //     dealt HP damage PAST shield — per victim via `outcome.shieldBefore > 0 &&
    //     outcome.hpDamage > 0`.
    //   - The leech is off `damage` (the FULL per-victim damage taken — already covered-cell
    //     reduced), NOT the HP portion — matching the non-positional `damage * (e.pct/100)`.
    //   - Same heal/shield fold (pct → raw, healModifier, heal-crit gate/noCrit) and the same
    //     directHeal/effectiveHeal/overheal vs shield bucket split, credited to the victim.
    //
    // HEAL-CRIT-GATE CADENCE: this fires once per victim, so a heal-kind leech draws the
    // victim's `activeHealCritGate` ONCE PER VICTIM (matching procStandingLeechesPerVictim).
    const procTakenLeechesPerVictim = (
        victim: CombatActor,
        damage: number,
        outcome: VictimDamageOutcome
    ): void => {
        if (!healingCtx || damage <= 0) return;
        // Barrier carve-out (per victim): a fully-blocked hit deals no damage taken.
        if (outcome.barriered) return;
        const entries = takenLeechesByOwner.get(victim.id);
        if (!entries) return;
        const rt = runtimesById.get(victim.id);
        for (const e of entries) {
            // requiresHpDamage gate (per victim): shield present at hit start AND HP damage dealt.
            if (e.requiresHpDamage && !(outcome.shieldBefore > 0 && outcome.hpDamage > 0)) {
                continue;
            }
            let raw = damage * (e.pct / 100);
            if (e.kind === 'heal' && rt) {
                raw *= 1 + rt.healModifier / 100;
                // One heal-crit draw PER VICTIM (this proc runs per footprint victim).
                if (!e.noCrit && rt.activeHealCritGate(rt.crit / 100)) {
                    raw *= 1 + rt.critDamage / 100;
                }
            }
            if (e.kind === 'heal') {
                healingCtx.credit(victim.id, 'directHeal', raw);
                const { consumed, overheal } = healingCtx.applyHealToTarget(raw, victim);
                healingCtx.credit(victim.id, 'effectiveHeal', consumed);
                healingCtx.credit(victim.id, 'overheal', overheal);
            } else {
                healingCtx.credit(victim.id, 'shield', raw);
                healingCtx.grantShieldToTarget(raw, victim);
            }
        }
    };

    // C2b-2 T5: the id of the actor whose turn is CURRENTLY executing. Set once at the top of
    // each actor's turn (after the dead-actor skips, before any damage is applied), so the
    // DIRECT-damage wrappers can stamp the lethal attacker onto ship-destroyed (Faust reads it
    // in Task 6). NOT used by the DoT-tick batch path (no single killer → byDirectDamage:false).
    // Engine-scope (declared once) but rewritten every turn; the applyVictimDamage closures are
    // rebuilt per round and capture it by reference.
    let actingActorId: string | undefined;

    for (let r = 1; r <= numRounds; r++) {
        // Advance the status engine's round counter (per-round accumulating stacks
        // tick here, before any turn fires). Sources notify via sourceFired in turn.
        statusEngine.beginRound(r);
        // Clear the per-round repaired set HERE (not at the round-started emit) so start-of-round
        // reactive heals fired by that emit correctly count toward THIS round (C2b-3).
        repairedThisRound.clear();
        hitThisRound.clear();

        // Forced-targeting/stealth lookup for a roster (phase 3). Reads the status engine
        // for each actor's Concentrate Fire / Taunt / Stealth flags so resolvePositionalTarget
        // can redirect or stealth-filter. Identical to phase 2 when no such status is live.
        const statusLookupFor = (roster: CombatActor[]) => {
            const m = buildForcedTargetingStatus(
                statusEngine,
                roster.map((a) => a.id)
            );
            return (id: string) => m.get(id);
        };

        // Combat-start seeding (round 1) for PASSIVE-sourced finite (timed) self-statuses.
        // Player runtimes face the dummy enemy, so an `enemy-type` gate resolves against
        // `enemyType`. Enemy-attacker runtimes face the player heal target (which has no
        // EnemyBaseClass), so their `enemy-type` gate must resolve against undefined.
        if (r === 1) {
            seedPassiveTimedStatuses([...runtimesById.values()], statusEngine, bus, enemyType, r);
            seedPassiveTimedStatuses(enemyPlayerRuntimes, statusEngine, bus, undefined, r);
        }

        // Selection-based action pool (dynamic-speed turn order, Task 3). Each living actor
        // holds a count of PENDING actions for the round (seeded 1 each; an extra-action grant
        // pushes +1). Team actors listed BEFORE the attacker so the input-order tiebreak yields
        // team → attacker → enemy at equal speeds (selectNextBySpeed requirement — it feeds
        // orderByTurnPriority, whose final tiebreak is this input order). Enemy attackers
        // (healing mode) are appended after the dummy `enemy`; selection reads each actor's LIVE
        // effective speed every step, so a Speed Up/Down applied mid-round reorders the remaining
        // unacted actors automatically (no re-sort hook). Dead actors keep their seeded pending=1
        // — the death-skip below consumes it via a plain `continue` (identical to the old loop
        // visiting then continue-ing). The dummy `enemy` (no speed buffs) keeps its DoT-tick turn.
        const roundActors = allActors;
        const pending = new Map<string, number>(roundActors.map((a) => [a.id, 1]));
        const pendingOf = (id: string) => pending.get(id) ?? 0;

        // End-of-round action pool (Task 4): "1 extra end of round action" grants (Harvester)
        // land here instead of `pending`. The selection closure drains `pending` (speed-positioned)
        // FIRST and only consults this pool once the normal pool is empty — so end-of-round extra
        // turns fire AFTER every normal-pool action for the round, regardless of the granter's
        // speed-rank. Seeded empty each round (no actor starts with an end-of-round action).
        const endOfRoundPending = new Map<string, number>();
        const endOfRoundPendingOf = (id: string) => endOfRoundPending.get(id) ?? 0;

        // --- Round accumulator, shared by the turn blocks and the post-round assembly.
        // Declared fresh each round (like the old scalar locals). Each actor writes into
        // its own entry; the post-round assembly derives row fields from the focus entry.
        // The helper `dmg(id)` lazily creates entries on first write — actors that never
        // produce damage in a round simply have no entry, keeping the map sparse.
        //
        // E5 §4.5 — CREDIT vs INTAKE are COMPLEMENTARY, not redundant (closing the umbrella
        // spec's "collapse the dual paths" framing). This `roundDamage`/`creditDamage` path is
        // the CREDIT side: damage *dealt*, keyed by SOURCE id, feeding row totals + damage-dealt
        // leeches. The `perActorIncoming`/`intakeFor` path below (~2365) is the INTAKE side:
        // damage *taken*, keyed by VICTIM id, feeding healing-mode rows. They record different
        // facts about the same hit (who dealt it vs who took it); E5 does NOT merge them.
        const roundDamage = new Map<string, ActorDamage>();
        // Per-round per-victim positional damage accumulator (victim actor id → summed damage
        // dealt to it this round). Populated ONLY by the positional apply path's emitHit
        // callback (all three attack sites); stays EMPTY on non-positional rounds, so the
        // RoundData.perTargetDamage field is set only when non-empty → goldens byte-identical.
        const roundPerTargetDamage = new Map<string, number>();
        // D-PR3: per-victim direct-damage intake index (Ironclad nth-hit) + once-per-round block flags.
        const directIntakeIndex = new Map<string, number>();
        const blockOnceConsumed = new Set<string>(); // key `${victimId}:${abilityId}`
        const dmg = (id: string): ActorDamage => {
            let d = roundDamage.get(id);
            if (!d) {
                d = emptyActorDamage();
                roundDamage.set(id, d);
            }
            return d;
        };
        // Single damage-credit point: every channel write flows through here so standing
        // leeches (damage-leech spec) can proc at credit time. With no leeches registered
        // this is byte-identical to the bare dmg() writes (the goldens are the referee).
        const creditDamage = (sourceId: string, channel: LeechChannel, amount: number): void => {
            dmg(sourceId)[channel] += amount;
            procStandingLeeches(sourceId, channel, amount);
        };
        // Healing mode: rebind the per-round healing map (so `credit` writes into THIS round)
        // and snapshot the target's HP%/shield at the ROUND TOP — before any turn. Raw floats;
        // the adapter owns any rounding. No-op in DPS mode (currentRoundHealing stays unread).
        let targetHpPctStart = 0;
        let targetShieldStart = 0;
        // Per-round intake accounting (healing mode): per-actor incoming/shield/barrier buckets,
        // folded into this round's HealingRoundEngine entry at post-round assembly. Enemy attacker
        // turns add to these via the shield-first drain below (the playerSink writes intakeFor()).
        // The heal target's row totals (incomingDamage/shieldAbsorbed/barrierAbsorbed) are read off
        // intakeFor(healTarget.id); barrierAbsorbed tracks the total fully blocked by an active
        // Barrier (full damage immunity), kept SEPARATE from shieldAbsorbed (Barrier does NOT drain
        // the shield pool) so the UI can attribute the blocked total to the Barrier, not the shield.
        // Fresh map each round; intakeFor() get-or-creates on first write.
        //
        // E5 §4.5 — this is the INTAKE side (damage *taken*, keyed by VICTIM id); the
        // complementary CREDIT side is `roundDamage`/`creditDamage` (~2331, damage *dealt*,
        // keyed by SOURCE id). Complementary facts, not duplicates — see the note there.
        const perActorIncoming = new Map<string, ActorIntake>();
        const intakeFor = (id: string): ActorIntake => {
            let entry = perActorIncoming.get(id);
            if (!entry) {
                entry = { incoming: 0, shieldAbsorbed: 0, barrierAbsorbed: 0 };
                perActorIncoming.set(id, entry);
            }
            return entry;
        };
        // Enemy-effects accounting (healing mode, Task 10a): per-enemy self-buffs + the debuffs
        // each enemy lands on the heal target this round, surfaced for the UI's enemy-effects
        // round overview ATTRIBUTED to the source enemy ship. Keyed by the enemy actor id; an
        // entry is created the first time an enemy contributes an effect this round. De-duped by
        // buffName WITHIN each enemy at the post-round push. Empty for a bare/manual enemy → no UI rows.
        const roundEnemyEffects = new Map<
            string,
            {
                selfBuffs: ActiveBuff[];
                debuffs: ActiveBuff[];
                resistedDebuffs: ActiveBuff[];
                resistedDots: EnemyDoTState[];
            }
        >();
        // Display snapshot of the heal target's DoT containers, captured BEFORE the
        // tank's turn-start tickDoTs/expireStacks run.  Merged with the live containers
        // via mergeDoTsForDisplay at end-of-round so that short DoTs (e.g. duration 1)
        // that ticked AND expired in the same round (enemy faster than tank) still appear
        // in enemyEffects[].dots.  Only the display shape is snapshotted (sourceId, tier,
        // stacks); numeric ticking uses the live containers unchanged.  Starts empty
        // every round — mergeDoTsForDisplay's fast-path (snapshot.length === 0) means
        // rounds where the tank never acts (DPS mode, destroyed tank) fall back to live
        // containers automatically, preserving pre-fix behaviour.
        let tankDotSnapshot: {
            corrosion: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[];
            inferno: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[];
        } = { corrosion: [], inferno: [] };
        // The heal target's OWN active self-buffs this round, captured from ITS turn result
        // (whichever branch processes it — focus, walked-team, or the dead-target synthesized
        // focus turn). PlayerTurnResult.activeSelfBuffs is comprehensive for the acting actor, so
        // it includes the target's recurring buffs (Cheat Death / Everliving Regeneration). Take
        // the LAST such turn if the target acts more than once; a destroyed target → []. Surfaced
        // to the UI's Heal Target round overview. NAMES ONLY — never folded into any sim value.
        let healTargetBuffs: ActiveBuff[] = [];
        // Shared incoming-damage intake (healing mode): drains the heal target shield-first
        // (pool before HP), reduces HP, records the destroyed round + emits ship-destroyed once,
        // and folds the totals into the victim's per-actor intake bucket (incoming / shieldAbsorbed
        // via the sink's intakeFor). Returns the
        // shield-before + the post-shield hpDamage the caller needs for any per-attack rider (the
        // taken-leech punch-through gate; hpDamage is 0 under Barrier so the leech reads 0). Both
        // the per-attack enemy intake (below) and the tank DoT-tick intake (turn-start) route
        // through here so the bleed accounting is identical.
        // `victim` defaults to the heal target — the legacy (non-positional) caller passes no
        // arg, so every existing path reads/mutates `healTarget!` exactly as before (byte-
        // identical). The positional enemy-turn path (Task C3) passes the SELECTED player actor
        // so the enemy's incoming drains the actor its parsed target picked. The heal target's
        // death round is read back off its per-actor `destroyedRound` field (stamped by
        // recordDestroyed below) at the result site — no heal-target-gated scalar write here.
        // Shared damage-intake core (Phase 4 PR 1, Task 2): the byte-identical body of the
        // legacy applyIncomingToTarget closure with the four side-specific accounting bits
        // hoisted into `sink`. Everything keyed off `victim` (Barrier full-immunity, shield
        // drain, HP decrement, Cheat-Death intercept, recordDestroyed, hp-changed) is moved
        // verbatim. Kept inside runCombat — it captures statusEngine/bus/r/recipientMaxHp/
        // cheatDeathConsumed/cheatDeathConsumedRound/recordDestroyed/BARRIER_BUFFS/
        // CHEAT_DEATH_BUFFS/selfBuffNamesForOwners exactly as before.
        const applyVictimDamage = (
            rawDamage: number,
            victim: CombatActor,
            sink: DamageAccountingSink,
            // C2b-2 T5: optional kill attribution stamped onto ship-destroyed. Direct-damage
            // wrappers pass { killerId: actingActorId, byDirectDamage: true }; the DoT-tick batch
            // passes { byDirectDamage: false } (no single killer). No consumer reads these yet
            // (Faust, Task 6), so production stays byte-identical.
            cause?: { killerId?: string; byDirectDamage?: boolean }
        ): VictimDamageOutcome => {
            // D-PR3: a hit may be reduced by proc block BEFORE it is recorded/absorbed. `damage`
            // becomes mutable so the block step can shave it; everything downstream (addIncoming,
            // shield drain, hp damage) operates on the post-block value.
            let damage = rawDamage;
            // Barrier — FULL DAMAGE IMMUNITY (locked game rule). Hoisted ABOVE addIncoming (it's a
            // pure read of the victim's active self-buffs — moving it earlier is byte-identical) so
            // the block step below can gate on it: a fully-Barrier-immune intake must NOT roll
            // block nor advance the Ironclad nth-hit counter (Barrier already nullifies the hit).
            // While the victim carries an active BARRIER_BUFFS status, ALL incoming damage is fully
            // blocked: direct attacks, DoT ticks, AND bomb detonations (all three funnel here).
            // Precedence: Barrier sits strictly IN FRONT OF both the shield pool AND Cheat Death —
            // so a lethal-sized hit blocked by Barrier neither drains the shield nor triggers the
            // Cheat-Death intercept below. Duration-based (timed lifecycle), NOT consumed on first
            // hit. The damage still "arrives" (the victim's bucket .incoming increments below) but
            // its effect is nullified; the blocked amount is tracked SEPARATELY as the bucket's
            // .barrierAbsorbed (NOT .shieldAbsorbed — Barrier never touches the shield).
            // Detection mirrors the Cheat-Death check (selfBuffNamesForOwners aggregates snapshot +
            // timed + active ability self statuses).
            const carriesBarrier = selfBuffNamesForOwners(statusEngine, [victim.id]).some((n) =>
                BARRIER_BUFFS.has(n)
            );
            // D-PR3: proc block on DIRECT damage only, when not fully Barrier-immune. Reduces the
            // hit before it is recorded/absorbed (silent reduction — no separate surface this PR).
            // Fully inert (no counter touch, no roll) when the victim has no incoming-block ability
            // → byte-identical for every existing fixture.
            if (cause?.byDirectDamage && !carriesBarrier) {
                const blockAbilities = incomingAbilitiesOf(victim.id).filter(
                    (a) => a.config.type === 'incoming-block'
                );
                if (blockAbilities.length > 0) {
                    const idx = (directIntakeIndex.get(victim.id) ?? 0) + 1;
                    directIntakeIndex.set(victim.id, idx);
                    const blocked = incomingBlockForIntake(
                        blockAbilities,
                        {
                            didCrit: false,
                            attackerStealthed: false,
                            victimStealthed: isStealthed(victim.id),
                            victimStasised: isStasised(victim.id),
                            hitIndexThisRound: idx,
                        },
                        (abilityId, chance) => {
                            const cfg = blockAbilities.find((b) => b.id === abilityId)?.config;
                            const onceKey = `${victim.id}:${abilityId}`;
                            // INVARIANT (keep this order): consumed-check BEFORE drawing the gate,
                            // and set consumed ONLY on a successful proc — else a failed early draw
                            // would wrongly lock the round.
                            if (
                                cfg?.type === 'incoming-block' &&
                                cfg.oncePerRound &&
                                blockOnceConsumed.has(onceKey)
                            ) {
                                return false;
                            }
                            let gate = procChanceGates.get(onceKey);
                            if (!gate) {
                                gate = makeRateGate();
                                procChanceGates.set(onceKey, gate);
                            }
                            const proc = gate(chance);
                            if (proc && cfg?.type === 'incoming-block' && cfg.oncePerRound) {
                                blockOnceConsumed.add(onceKey);
                            }
                            return proc;
                        }
                    );
                    damage = damage * (1 - blocked);
                }
            }
            sink.addIncoming(damage, victim.id);
            // Capture the pre-drain HP + the target's current effective max HP for the
            // tank-side hp-changed emission below (Phase 4c PR 3). Read BEFORE the drain
            // so oldPct reflects the entering state and a Cheat-Death save's oldPct stays
            // the pre-hit value (not 1).
            const hpBefore = victim.currentHp;
            const maxHp = recipientMaxHp(victim.id);
            // Barrier branch (carriesBarrier computed above the block step). HP does not move → the
            // emit below is a no-op crossing (oldPct === newPct), still fired once for emission
            // consistency. The damage still "arrives" (the victim's .incoming already incremented)
            // but its effect is nullified; the blocked amount is tracked as .barrierAbsorbed (NOT
            // .shieldAbsorbed — Barrier never touches the shield).
            if (carriesBarrier) {
                sink.addBarrierAbsorbed(damage, victim.id);
                if (victim.currentHp > 0 && maxHp > 0) {
                    bus.emit({
                        type: 'hp-changed',
                        targetId: victim.id,
                        round: r,
                        oldPct: (100 * hpBefore) / maxHp,
                        newPct: (100 * victim.currentHp) / maxHp,
                    });
                }
                return { shieldBefore: victim.shieldPool, hpDamage: 0, barriered: true };
            }
            const shieldBefore = victim.shieldPool;
            const absorbed = Math.min(victim.shieldPool, damage);
            victim.shieldPool -= absorbed;
            sink.addShieldAbsorbed(absorbed, victim.id);
            const hpDamage = damage - absorbed;
            victim.currentHp = Math.max(0, victim.currentHp - hpDamage);
            // At the lethal moment, intercept once per combat: a carrier of a CHEAT_DEATH_BUFFS
            // buff survives at 1 HP instead of dying. The buff is 'recurring' (always-active), so
            // it is never stored/timed — consumption is the per-actor cheatDeathConsumed flag
            // (NOT a store mutation). On intercept we floor HP at 1 (overriding the Math.max(0, …)
            // above), mark consumed, wipe the actor's REMOVABLE timed statuses (DoTs/timed
            // self-buffs; persistent-stack + unremovable preserved), emit cheat-death-activated,
            // and DO NOT record a destroy.
            //
            // Detection MUST go through selfBuffNamesForOwners, NOT snapshot().activeSelfBuffs:
            // a real (Yazid/Tycho/Hayyan-granted) Cheat Death is an ability-sourced recurring
            // self-buff that surfaces via activeAbilityStatuses('self', …, ownerId) — snapshot's
            // activeSelfBuffs only carries SCHEDULED always-active buffs, and only for the
            // 'attacker' owner (empty for any other owner). Since the heal target's owner id is
            // often a team-actor id (not 'attacker'), snapshot alone misses both the
            // ability-sourced case AND the non-attacker-owner case. selfBuffNamesForOwners
            // aggregates snapshot + timed + active ability self statuses keyed by the actor's
            // own id, covering every Cheat Death source.
            if (victim.currentHp <= 0) {
                const targetId = victim.id;
                const carriesCheatDeath = selfBuffNamesForOwners(statusEngine, [targetId]).some(
                    (n) => CHEAT_DEATH_BUFFS.has(n)
                );
                if (carriesCheatDeath && !cheatDeathConsumed.has(targetId)) {
                    victim.currentHp = 1;
                    cheatDeathConsumed.add(targetId);
                    // Display-only: remember the round it was spent so the chip is dropped
                    // from rounds AFTER this one (see hideSpentCheatDeath). First write wins —
                    // the flag above already blocks any second intercept, so this set-once.
                    if (!cheatDeathConsumedRound.has(targetId)) {
                        cheatDeathConsumedRound.set(targetId, r);
                    }
                    statusEngine.clearRemovable(targetId);
                    // The tank's enemy-applied Corrosion/Inferno DoTs are actor-state stacks
                    // (NOT StatusEngine entries), so clearRemovable doesn't touch them — empty
                    // them here so the survivor takes no further ticks. These are the SAME arrays
                    // the turn-start DoT-tick intake reads (healTarget.corrosion/infernoEntries).
                    // Both DoT types are removable; bombs (Blast, treated as persistent here) and
                    // accumulators are intentionally left untouched.
                    victim.corrosionEntries.length = 0;
                    victim.infernoEntries.length = 0;
                    bus.emit({ type: 'cheat-death-activated', actorId: targetId, round: r });
                } else {
                    // First reach 0 (no intercept) → record the destroyed round + emit
                    // ship-destroyed once (shared helper; idempotent via the per-actor
                    // destroyedRound field). The healing result reads the destroyed round back
                    // off the heal target's runtime `destroyedRound` field at the result site —
                    // no side-specific scalar write is needed here.
                    recordDestroyed(victim, r, bus, cause?.killerId, cause?.byDirectDamage);
                }
            }
            // Tank-side hp-changed (Phase 4c PR 3): ONCE per HP-intake event — this closure
            // is called per enemy attack (aggregate drain) AND per turn-start DoT batch, and
            // the emission covers both deliberately ("when HP drops below N%" includes DoT
            // damage in-game). Emitted after the Cheat-Death intercept (a 100→1-HP save
            // counts as a downward crossing — spec §5). Exact percentages (the enemy dummy's
            // post-round emission stays integer-granularity — asymmetry intended, events.ts).
            // A killed tank emits ship-destroyed above, never a posthumous crossing.
            if (victim.currentHp > 0 && maxHp > 0) {
                bus.emit({
                    type: 'hp-changed',
                    targetId: victim.id,
                    round: r,
                    oldPct: (100 * hpBefore) / maxHp,
                    newPct: (100 * victim.currentHp) / maxHp,
                });
            }
            // D-PR8: record a direct hit for the not-hit-this-round gate. A hit = a direct
            // attack that landed damage on shield or HP (absorbed > 0 || hpDamage > 0). The
            // byDirectDamage guard excludes DoT-tick batches (they pass byDirectDamage:false);
            // fully-Barrier-blocked hits return earlier (barriered:true) and are not recorded.
            // TODO(verify): whether a fully-Barrier-blocked direct attack should count as a hit
            // for Alacrity is unconfirmed in-game; current default is "not a hit".
            if (cause?.byDirectDamage && (absorbed > 0 || hpDamage > 0)) {
                hitThisRound.add(victim.id);
            }
            return { shieldBefore, hpDamage, barriered: false };
        };
        // Legacy healing-mode player intake — a THIN wrapper over applyVictimDamage. The sink
        // accumulates the victim's incoming / shield-absorbed / barrier-absorbed into its per-actor
        // bucket (intakeFor). The heal target's death round is no longer tracked via the sink —
        // it is read back off `healTarget.destroyedRound` (stamped by recordDestroyed) at the
        // result site. Signature, default `victim = healTarget!`, and return value are unchanged,
        // so every existing call site stays byte-identical.
        const playerSink: DamageAccountingSink = {
            addIncoming: (amount, victimId) => {
                intakeFor(victimId).incoming += amount;
            },
            addShieldAbsorbed: (amount, victimId) => {
                intakeFor(victimId).shieldAbsorbed += amount;
            },
            addBarrierAbsorbed: (amount, victimId) => {
                intakeFor(victimId).barrierAbsorbed += amount;
            },
        };
        const applyIncomingToTarget = (
            damage: number,
            victim: CombatActor = healTarget!,
            // C2b-2 T5: defaults to the DIRECT-damage attribution (the acting actor landed this
            // hit). The DoT-tick batch caller overrides with { byDirectDamage: false } — a DoT
            // batch is an aggregate of multiple appliers with NO single killer.
            cause: { killerId?: string; byDirectDamage?: boolean } = {
                killerId: actingActorId,
                byDirectDamage: true,
            }
        ): VictimDamageOutcome => applyVictimDamage(damage, victim, playerSink, cause);
        // Player→enemy intake (E1 — symmetric incoming surface). The symmetric THIN wrapper over
        // applyVictimDamage for the direction where a PLAYER attacks an ENEMY victim. The enemy
        // victim runs the FULL HP/shield/Barrier/Cheat-Death/recordDestroyed path AND now records
        // its incoming / shield-absorbed / barrier-absorbed into the same per-actor `intakeFor`
        // bucket the playerSink uses — keyed by the ENEMY victim's id (ids are globally unique
        // across sides, so one map serves both directions). `applyOutgoingToEnemy` is only invoked
        // on the positional apply path (drivePositionalApply), so non-positional fixtures never add
        // an enemy key → byte-identical. The enemy victim is never the heal target, so no
        // heal-target death-round bookkeeping applies. E2 (per-victim leech) reads this surface.
        const enemySink: DamageAccountingSink = {
            addIncoming: (amount, victimId) => {
                intakeFor(victimId).incoming += amount;
            },
            addShieldAbsorbed: (amount, victimId) => {
                intakeFor(victimId).shieldAbsorbed += amount;
            },
            addBarrierAbsorbed: (amount, victimId) => {
                intakeFor(victimId).barrierAbsorbed += amount;
            },
        };
        const applyOutgoingToEnemy = (
            damage: number,
            enemyVictim: CombatActor
        ): VictimDamageOutcome =>
            // C2b-2 T5: a player→enemy hit is always DIRECT damage from the acting attacker.
            applyVictimDamage(damage, enemyVictim, enemySink, {
                killerId: actingActorId,
                byDirectDamage: true,
            });
        // TEST-ONLY: hand the genuine wrapper out once (no production caller until Task 8). The
        // closure is per-round-identical in behaviour (only `r` differs), so capturing it on the
        // first round it is built is sufficient. Inert in production (the field is never set).
        input.__testTapApplyOutgoingToEnemy?.(applyOutgoingToEnemy);

        // §4.5 STASIS direct-damage break (B3 Task 2). Fires via the `onHitBreakStasis` hook
        // injected into `runPlayerTurn` (playerTurn.ts), which calls it AFTER the scheduled
        // debuffs (sourceFired) but BEFORE the ability timed-debuff loop. This ordering ensures:
        //  - A pre-existing Stasis IS broken when the hit lands (victim was stasised at mark time).
        //  - A Stasis RE-APPLIED by the SAME attack's debuff ability (e.g. stasisInflictAttack)
        //    is NOT broken — detected via the turn's inflictedEnemyDebuffs at resolution time.
        //  - DoT ticks NEVER call this (they never enter runPlayerTurn's break hook path).
        //
        // DEFERRED-BREAK DESIGN: the hook does NOT immediately remove Stasis. Instead it marks
        // the victim id into a per-turn `stasisHitVictims` Set. Removal happens RIGHT AFTER the
        // attacker's own `drainIntents`/`drainEnemyIntents` in the same turn-loop iteration.
        // This satisfies two invariants:
        //  (i)  The on-attacked reactive's drainQueue check (Counter Shield suppression — test iii)
        //       sees `isStasised(victim) = true` because drainIntents runs BEFORE the removal.
        //  (ii) The victim is freed BEFORE its own next turn, so it acts in the next round.
        //
        // RE-APPLY CHECK: at resolution time, if the SAME turn's `inflictedEnemyDebuffs` contain
        // a Stasis name for the target, the re-application wins → skip the break for that victim.
        // This is LOCAL to the same turn (no cross-turn casterId state needed), making the check
        // immune to the "same attacker later fires pure-damage hits" bug.
        //
        // (Task 3 adds the Akula doesntBreakStasis exception — placeholder left below.)

        // Per-victim enemy-debuff-derived modifiers (B1/PR7b). Reads the victim's OWN per-actor
        // enemy-debuff store — BOTH channels: scheduled (__enemy__ global) + ability (per-victim
        // payload timed+aura). Delegates to victimEnemyBuffs (triggers.ts) which mirrors
        // ownerDebuffNamesFor's three-source read, ensuring modifier-read and name-read stay in
        // lockstep. Attacker-sourced modifiers (outgoing buff, pen) stay attacker-sourced.
        // NOTE: the aura/accumulating ability channel is an approximation (NEUTRAL ctx, no re-roll)
        // — see the victimEnemyBuffs jsdoc (finding I1) for details and acceptance rationale.
        const victimIncomingModifiers = (
            victimId: string
        ): { enemyDefenseModifier: number; incomingDamageModifier: number } => {
            const enemy = toEnemyModifiers(
                victimEnemyBuffs(statusEngine, victimId, enemyDebuffLookup)
            );
            // D-PR12: friendly-side incoming-DIRECT-damage buffs on the victim's OWN 'self' store
            // (Inc. Damage Down/Up — Makoli/Salvation/Shelter/Refine/Battlecry). Summed into the SAME
            // per-victim incomingDamageModifier as enemy debuffs. Team-agnostic for the TIMED + AURA
            // ability channels (victimId keys the actor's own self store regardless of side). The
            // SCHEDULED channel reads selfBuffLookup, which today is populated only for player/team
            // actors (enemy runtimes pass an empty map) — a pre-existing gap, irrelevant until an
            // enemy carries a scheduled self-buff. Direct channel only; incoming-DoT deferred.
            const selfIncoming = toSelfIncomingDamageModifier(
                victimSelfBuffs(statusEngine, victimId, selfBuffLookup)
            );
            return {
                enemyDefenseModifier: enemy.enemyDefenseModifier,
                incomingDamageModifier: enemy.incomingDamageModifier + selfIncoming,
            };
        };
        // TEST-ONLY: expose victimIncomingModifiers (enemy-debuff + friendly self-buff term,
        // D-PR12) to unit tests that assert per-victim modifier reads. Inert in production (never set).
        input.__testTapVictimEnemyModifiers?.(victimIncomingModifiers);
        input.__testTapIsStasised?.(isStasised);

        // Shared positional-apply driver (Task 9, Step A) — the ONE place the three attack
        // sites (focus / walked-team / enemy) drive `applyPositionalDamage`. Each site has
        // already GATED (isPositional + non-null target/pattern/positionalScalars) and computed
        // its own `positional` flag (also used for credit suppression); this helper just runs the
        // per-victim apply against the resolved inputs. What differs per site is parameterized:
        //  - `scalars`/`hitCrits` — sourced from that site's turn result,
        //  - `pattern`/`target` — that actor's parsed pattern + parsed target,
        //  - `opposingLiving` — focus/team → enemyAttackerActors; enemy → allPlayerActors,
        //  - `applyToVictim` — focus/team → applyOutgoingToEnemy; enemy → applyIncomingToTarget,
        //  - `acting` — the firing actor's position / ignoresForcedTargeting / id (for provokerOf).
        // `defenseProfileOf` is identical across all three sites (B1/PR7b + D-PR12: wired to
        // victimIncomingModifiers — reads the victim's OWN per-actor enemy-debuff store AND
        // the victim's own self-buff store (both channels: scheduled + ability payload).
        // Direction-agnostic: victimIncomingModifiers(v.id) works for ENEMY victims
        // (focus/team site) and PLAYER victims (enemy site) alike.
        // No emitHit: runPlayerTurn already emits ONE aggregate ability-performed per turn;
        // per-hit/per-victim event fidelity is a documented Phase-5 follow-up.
        const drivePositionalApply = (args: {
            scalars: AttackerDamageScalars;
            // hitCrits is co-populated with positionalScalars by Task 7 (both are set iff a damage
            // ability fired), so the `?? []` below is DEFENSIVE only — never empty when scalars != null.
            hitCrits?: boolean[];
            pattern: ParsedPattern;
            target: ParsedTarget;
            actingPosition: Position;
            ignoresForcedTargeting?: boolean;
            actingId: string;
            opposingLiving: CombatActor[];
            applyToVictim: (victim: CombatActor, damage: number) => VictimDamageOutcome;
            // E2 (per-victim leech): OPTIONAL per-direction hook. drivePositionalApply is ONE
            // helper shared by all three sites (focus / team / enemy); since standing (player→
            // enemy) and taken (enemy→player) leech need opposite logic, each site supplies its
            // own callback (Tasks 3/5) rather than branching inside the shared inline path.
            // Unsupplied by every current caller → fully inert.
            onVictimResolved?: (
                victim: CombatActor,
                damage: number,
                outcome: VictimDamageOutcome,
                didCrit: boolean
            ) => void;
        }): void => {
            applyPositionalDamage({
                hitCrits: args.hitCrits ?? [],
                scalars: args.scalars,
                pattern: args.pattern,
                actorPosition: args.actingPosition,
                target: args.target,
                opposingLiving: args.opposingLiving,
                statusOf: statusLookupFor(args.opposingLiving),
                acting: {
                    ignoresForcedTargeting: args.ignoresForcedTargeting,
                    provokedBy: provokerOf(statusEngine, args.actingId),
                },
                defenseProfileOf: (v) => {
                    const m = victimIncomingModifiers(v.id);
                    return {
                        defence: v.stats.defence,
                        // B1/PR7b: per-victim defense-debuff sourcing (was hardcoded 0).
                        // Direction-agnostic — v.id keys the victim's own enemy-debuff store
                        // regardless of side.
                        defenceModifierPct: m.enemyDefenseModifier,
                        // B1/PR7b + D-PR12: per-victim incoming-damage modifier; combines
                        // enemy-debuff (Out. Damage Up) AND victim's own self-buffs (Inc. Damage
                        // Down/Up). Attacker-sourced scalars (outgoing buff, pen) stay attacker-fixed.
                        incomingDamageModifierPct: m.incomingDamageModifier,
                        affinity: v.affinity ?? 'antimatter',
                    };
                },
                applyToVictim: args.applyToVictim,
                // Pure ACCUMULATOR (not a bus emit): record per-victim damage into the
                // per-round map so the RoundData row can expose perTargetDamage. Identical
                // across all three sites (focus / team / enemy), so it lives here.
                // §4.5 NOTE: the Stasis break is NOT wired here. It fires via `onHitBreakStasis`
                // inside runPlayerTurn (BEFORE the ability timed-debuff loop) so a Stasis
                // re-application from the same attack's debuff ability is not inadvertently
                // removed. The break fires for the resolved `targetId` (the selected victim);
                // AoE footprint victims are a future Task-3 follow-up.
                emitHit: (victim, damage) => {
                    roundPerTargetDamage.set(
                        victim.id,
                        (roundPerTargetDamage.get(victim.id) ?? 0) + damage
                    );
                },
                // E2: forward the per-direction leech hook (unsupplied by all current callers).
                onVictimResolved: args.onVictimResolved,
                // D-PR3: victim-side incoming %-reduction, per footprint victim per sub-hit. Shared
                // across all three sites (focus / walked-team / enemy) since drivePositionalApply
                // makes ONE applyPositionalDamage call. incomingReductionForHit returns 0 for actors
                // with no incoming-reduction ability → byte-identical when no such equipment exists.
                incomingReductionFor: (victim, didCrit) =>
                    incomingReductionForHit(incomingAbilitiesOf(victim.id), {
                        didCrit,
                        attackerStealthed: isStealthed(args.actingId),
                        victimStealthed: isStealthed(victim.id),
                        victimStasised: isStasised(victim.id),
                        hitIndexThisRound: 0, // unused by reduction (only block reads it)
                    }),
                // D-PR4: attacker-side outgoing amplification (Menace/Giant Slayer), per footprint
                // victim per sub-hit. outgoingAmplificationForHit returns 0 for attackers with no
                // outgoing-amplification ability → byte-identical when no such equipment exists.
                outgoingAmplificationFor: (victim, didCrit) => {
                    // Fast path: skip the per-victim effectiveStatsOf folds when the attacker has no
                    // outgoing-amplification ability (the overwhelmingly common case) — matches the
                    // aggregate path's `ampAbilities.length > 0` guard. Byte-identical (returns 0).
                    const outs = outgoingAbilitiesOf(args.actingId);
                    if (outs.length === 0) return 0;
                    const attacker = allActorsById.get(args.actingId);
                    if (!attacker) return 0;
                    return outgoingAmplificationForHit(
                        outs,
                        {
                            didCrit,
                            targetHigherAttack:
                                effectiveStatsOf(statusEngine, selfBuffLookup, victim).attack >
                                effectiveStatsOf(statusEngine, selfBuffLookup, attacker).attack,
                        },
                        (abilityId, chance) =>
                            rollRateGate(procChanceGates, `${args.actingId}:${abilityId}`, chance)
                    );
                },
            });
        };

        // ── Unified per-actor turn resolvers (bySide unification PR6a) ──────────────
        // Resolve the per-actor runtime / parsed target / parsed pattern uniformly so the
        // three runPlayerTurn sites stop hard-coding their own lookups. Each reproduces the
        // exact value its site used before — byte-identical.
        const runtimeFor = (a: CombatActor): PlayerActorRuntime => {
            if (a.side === 'enemy') return enemyPlayerRuntimeByActorId.get(a.id)!;
            if (a.kind === 'attacker') return attackerRuntime;
            return teamRuntimeById.get(a.id)!;
        };
        const parsedTargetFor = (a: CombatActor): ParsedTarget | undefined => {
            if (a.side === 'enemy') return enemyTargetById.get(a.id);
            if (a.kind === 'attacker') return input.target;
            return teamTargetById.get(a.id);
        };
        const parsedPatternFor = (a: CombatActor): ParsedPattern | undefined => {
            if (a.side === 'enemy') return enemyPatternById.get(a.id);
            if (a.kind === 'attacker') return input.pattern;
            return teamPatternById.get(a.id);
        };

        // ── Unified per-side turn bindings (bySide unification PR6a) ────────────────
        // Per-side values the three runPlayerTurn sites diverge on. Each reproduces the
        // exact value its site used before → byte-identical. PR6b (DONE): decline is now
        // derived inside runPlayerTurn from the struck victim's currentHp — declineFor has
        // been removed from this interface; the credit/intake & emit TAILS stay per-kind (→ PR7).
        interface TurnBindings {
            opposingRoster: CombatActor[];
            legacyVictim: CombatActor;
            victimDefenceFor: (tgt: CombatActor) => number;
            victimMaxHpFor: (tgt: CombatActor) => number;
            enemyTypeArg: EnemyBaseClass | undefined;
            enemyBuffNamesUnion: () => string[];
            healEventOnly: boolean;
            // Matches drivePositionalApply's applyToVictim param type exactly. E2: returns the
            // resolved VictimDamageOutcome (both impls wrap applyOutgoingToEnemy /
            // applyIncomingToTarget, which already surface it from E1).
            applyToVictim: (victim: CombatActor, damage: number) => VictimDamageOutcome;
        }
        const playerTurnBindings: TurnBindings = {
            opposingRoster: enemyAttackerActors,
            legacyVictim: enemy,
            victimDefenceFor: (tgt) => tgt.stats.defence,
            victimMaxHpFor: (tgt) => tgt.stats.hp,
            enemyTypeArg: enemyType,
            enemyBuffNamesUnion: playerEnemyBuffNames,
            healEventOnly: false,
            applyToVictim: (victim, damage) => applyOutgoingToEnemy(damage, victim),
        };
        const enemyTurnBindings: TurnBindings = {
            opposingRoster: allPlayerActors,
            legacyVictim: healTarget!,
            victimDefenceFor: (tgt) =>
                lastTurnCtxByActor.get(tgt.id)?.effectiveDefence ?? baseDefenceFor(tgt.id),
            victimMaxHpFor: (tgt) => recipientMaxHp(tgt.id),
            enemyTypeArg: undefined,
            // Opposing side from the ENEMY's view = the player team, so `enemyBuffNames` here is the
            // UNION of PLAYER self-buff names (fed to the enemy's own `enemy-buff` gates). A bare
            // enemy has no such gate → inert today; computed for the full-kit enemy.
            enemyBuffNamesUnion: enemyEnemyBuffNames,
            healEventOnly: true,
            // An enemy supporter running runPlayerTurn grants charges to its OWN (enemy) team via
            // bySide('enemy').grantAllyCharges (resolved in buildTurnArgs by side), NEVER the player
            // team. Likewise applyToVictim routes the firing hit as INCOMING damage to the struck
            // player actor (applyIncomingToTarget), not as a player damage row.
            applyToVictim: (victim, damage) => applyIncomingToTarget(damage, victim),
        };
        const turnBindings = (side: Side): TurnBindings =>
            side === 'player' ? playerTurnBindings : enemyTurnBindings;

        // Unified positional target selection (bySide unification PR6a). Reproduces the
        // focus(C1)/team(C2)/enemy(C3) selection: resolve the actor's parsed target against
        // its opposing roster, else fall back to the side's legacy victim (dummy / heal target).
        const selectTurnTarget = (a: CombatActor): { tgt: CombatActor } => {
            const tb = turnBindings(a.side);
            const target = parsedTargetFor(a);
            const selected =
                isPositional(a.position, tb.opposingRoster) && target
                    ? resolvePositionalTarget(
                          a.position!,
                          target,
                          tb.opposingRoster,
                          statusLookupFor(tb.opposingRoster),
                          {
                              ignoresForcedTargeting: a.ignoresForcedTargeting,
                              provokedBy: provokerOf(statusEngine, a.id),
                          }
                      )
                    : null;
            return { tgt: selected ?? tb.legacyVictim };
        };

        // Unified runPlayerTurn argument builder (bySide unification PR6a). Produces the
        // full arg object for any side, folding the per-side divergence through
        // turnBindings(side) + runtimeFor(actor). targetId / healEventOnly are present
        // ONLY for the enemy side (player sites omit both → byte-identical). The selfHpPct
        // denom is unified to runtimeFor(actor).hp (proven equal to baseHpFor(id) by
        // construction). The per-kind bookkeeping TAILS after each call stay inline.
        const buildTurnArgs = (a: CombatActor, tgt: CombatActor) => {
            const tb = turnBindings(a.side);
            const rt = runtimeFor(a);
            const maxHp = rt.hp; // unified denom (baseHpFor(id) === runtimeFor(id).hp)
            // E3 (AoE purge): footprint victim ids for an 'all-enemies' on-cast purge.
            // Computed ONLY when positional — `tgt.position != null` is the positional
            // discriminator (selectTurnTarget returns the position-less dummy/heal-target sink
            // in DPS/healing-single mode). footprintVictims is the same pure resolver the AoE
            // damage path uses; covered cells are included (status removal is uniform across the
            // footprint). Non-positional → undefined → the playerTurn purge loop falls back to
            // the single anchor → byte-identical. The purge ability gates on
            // target === 'all-enemies', so single-'enemy' purges ignore this regardless.
            const aoePattern = parsedPatternFor(a);
            const aoeTarget = parsedTargetFor(a); // parse-completeness guard only (not a footprint arg)
            const aoeVictimIds =
                aoePattern != null && aoeTarget != null && tgt.position != null
                    ? footprintVictims(aoePattern, tgt.position, tb.opposingRoster).map(
                          (h) => h.victim.id
                      )
                    : undefined;
            return {
                runtime: rt,
                enemy: tgt,
                // B1/PR7b: thread targetId for BOTH directions so player-applied ABILITY debuffs route
                // to the resolved victim's per-actor store (applyTimedAbilityStatus keys off targetId;
                // the aggregate ability-read timedAbilityStatuses('enemy',actor.id,targetId) follows
                // automatically). GUARDED for the player side: when selectTurnTarget fell back to the
                // dummy `enemy` sink (tgt.id === enemy.id), leave targetId unset so the __enemy__ path
                // (DPS/healing) is byte-identical. Scheduled channel stays global __enemy__ (upsertBuff
                // hardcoded). Enemy side unchanged (victim always a real actor).
                ...(a.side === 'enemy' || tgt.id !== enemy.id ? { targetId: tgt.id } : {}),
                statusEngine,
                corrosionEntries: tgt.corrosionEntries,
                infernoEntries: tgt.infernoEntries,
                pendingBombs: tgt.pendingBombs,
                pendingAccumulators: tgt.pendingAccumulators,
                enemyDefense: tb.victimDefenceFor(tgt),
                enemyHp: tb.victimMaxHpFor(tgt),
                enemyType: tb.enemyTypeArg,
                bus,
                round: r,
                grantAllyCharges: bySide(a.side).grantAllyCharges,
                healing: healingCtx,
                ...(tb.healEventOnly ? { healEventOnly: true } : {}),
                selfHpPct: maxHp > 0 ? (100 * Math.max(0, a.currentHp)) / maxHp : 100,
                // targetHpPct reports the HEAL TARGET's HP% (healTargetHpPctNow()), NOT the struck
                // `tgt`'s — even on the enemy positional path where `tgt` may be a different player
                // actor, this still tracks the heal target. Per-actor target-HP% is deferred to a
                // later phase; inert today (bare enemies have no `hpSubject:'target'` gate).
                targetHpPct: healTargetHpPctNow(),
                // C2b-3: was the STRUCK victim (tgt) repaired this round? Per-actor-correct
                // (unlike targetHpPct, which always reports the heal target). DPS dummy / un-
                // repaired enemy → false → byte-identical (the purge block guards on targetId).
                targetRepairedThisRound: repairedThisRound.has(tgt.id),
                enemyBuffNames: tb.enemyBuffNamesUnion(),
                selfDebuffNames: ownerDebuffNames(a.id),
                ...(aoeVictimIds ? { aoeVictimIds } : {}),
                // D-PR4: target's effective attack (for 'amplify-vs-higher-attack' eligibility) and
                // a per-(owner,ability) deterministic proc closure. Both are READ only when the
                // actor's passive slot carries an outgoing-amplification ability → byte-identical
                // for every fixture without one (rollOutgoingProc never invoked).
                targetEffectiveAttack: effectiveStatsOf(statusEngine, selfBuffLookup, tgt).attack,
                rollOutgoingProc: (abilityId: string, chance: number) =>
                    rollRateGate(procChanceGates, `${a.id}:${abilityId}`, chance),
            };
        };

        if (healTarget) {
            currentRoundHealing = new Map<string, ActorHealing>();
            const targetMaxHp = recipientMaxHp(healTarget.id);
            // Clamp to [0, 100]: a shrunk effectiveMaxHp (expired max-HP buff) can leave
            // currentHp > targetMaxHp, pushing the ratio above 100 — cap it so the reported
            // start % never exceeds full.
            targetHpPctStart =
                targetMaxHp > 0
                    ? Math.min(100, Math.max(0, 100 * (healTarget.currentHp / targetMaxHp)))
                    : 0;
            targetShieldStart = healTarget.shieldPool;
        }

        // Per-focus-turn results; the post-round assembly reads the LAST one for the
        // row's attacker fields. Numeric damage totals are summed across all turns.
        const focusTurns: PlayerTurnResult[] = [];
        // Team-turn resisted enemy applications recorded BEFORE any attacker turn this
        // round (faster team actors). Drained into the FIRST subsequent attacker turn's
        // resistedEnemyDebuffs head; team turns AFTER an attacker turn append to the LAST
        // attacker turn's list (same observable order as the old attackerHasActed +
        // teamResistedEnemyDebuffs staging).
        const pendingResisted: ActiveBuff[] = [];

        // Dead-target turn skip (healing mode): a destroyed heal target does not act. We skip
        // the ENTIRE turn body for that actor — including turn-started/turn-ended emissions and
        // the post-turn status decrement (a dead ship has no live status to tick). Enemy attacker
        // turns are NOT skipped (they keep banking charges and the dead-target damage path returns
        // 0). When the dead actor IS the focus actor a round would otherwise produce ZERO focus
        // turns and the focusTurns.length throw below would fire — so we synthesize a minimal dead
        // focus-turn result (no sourceFired: it did not act) carrying the entering-round
        // enemyHpPct and a zeroed/last-known ctx, just enough for row assembly.
        //
        // Called at TWO sites with identical behavior: (a) the top-of-turn guard (target already
        // dead entering its turn), and (b) immediately after the heal target's OWN turn-start DoT
        // tick (a lethal Corrosion/Inferno tick kills it mid-turn → it must not fall through and
        // act). Returns true when the actor is the dead heal target and the caller must `continue`.
        const handleDeadTargetSkip = (actor: CombatActor): boolean => {
            if (!(healTarget && actor.id === healTarget.id && healTarget.currentHp <= 0)) {
                return false;
            }
            // A destroyed heal target shows no buffs this round.
            healTargetBuffs = [];
            if (actor.id === focusActorId) {
                // PR6b: read the dummy sink's live currentHp instead of the scalar (identical
                // value — the sink update at ~3771 keeps enemy.currentHp == enemyHp - cumulative).
                pushSynthesizedFocusSkipTurn();
            }
            return true;
        };

        // E5 §4.4: the synthesized no-action focus turn pushed when the focus skips its
        // turn (dead heal-target OR stasised). Extracted from the two byte-identical sites
        // (handleDeadTargetSkip + the stasis gate) so the shape cannot drift.
        const pushSynthesizedFocusSkipTurn = (): void => {
            const enemyHpDecline = Math.max(0, enemyHp - enemy.currentHp);
            const enemyHpPct =
                enemyHp > 0 ? Math.max(0, 100 * (1 - enemyHpDecline / enemyHp)) : 100;
            const lastKnownCtx = lastTurnCtxByActor.get(focusActorId);
            focusTurns.push({
                action: 'active',
                roundCrit: false,
                hitCrits: [],
                enemyHpPct,
                dotsConfig: [],
                dotsLanded: true,
                activeSelfBuffs: [],
                landedEnemyDebuffs: [],
                inflictedEnemyDebuffs: [],
                resistedEnemyDebuffs: [],
                directDamage: 0,
                secondaryDamage: 0,
                conditionalDamage: 0,
                detonationDamage: 0,
                extraActionGrants: [],
                turnCtx: lastKnownCtx ?? {
                    effectiveAttack: 0,
                    dotMult: 1,
                    affinityMult: 1,
                    effectiveDefence: 0,
                    effectiveMaxHp: 0,
                    outgoingHealPct: 0,
                    incomingHealPct: 0,
                },
            });
        };

        // Per-round extra-action bookkeeping: oncePerRound abilities fire at most once
        // per actor per round (key `${actorId}:${abilityId}`); total insertions are
        // backstopped. A grant bumps the granter's PENDING count by 1 — the selection
        // loop then re-picks it at its LIVE speed-rank among the remaining unacted actors
        // (game-verified: re-added to the turn order; acts immediately only when fastest
        // remaining). The selection comparator (orderByTurnPriority via selectNextBySpeed)
        // owns the speed-position + equal-speed tiebreak, so there is no splice to position.
        const extraActionFired = new Set<string>();
        let extraTurnInsertions = 0;
        const processExtraActionGrants = (
            granter: CombatActor,
            grants: ExtraActionGrant[]
        ): void => {
            for (const g of grants) {
                const key = `${granter.id}:${g.abilityId}`;
                if (g.oncePerRound && extraActionFired.has(key)) continue;
                if (g.oncePerRound) extraActionFired.add(key);
                extraTurnInsertions += 1;
                if (extraTurnInsertions > MAX_EXTRA_TURNS_PER_ROUND) {
                    throw new Error(
                        `combat round ${r}: extra-action insertions exceeded ` +
                            `MAX_EXTRA_TURNS_PER_ROUND (${MAX_EXTRA_TURNS_PER_ROUND}) — ` +
                            `an extra-action grant is re-firing without bound`
                    );
                }
                // Route by pool (Task 4): end-of-round grants (Harvester) bump the end-of-round
                // pool, drained after the normal speed pool; default grants stay speed-positioned
                // in the normal pool. The oncePerRound gate + MAX_EXTRA_TURNS_PER_ROUND backstop
                // above apply to BOTH pools.
                if (g.endOfRound) {
                    endOfRoundPending.set(granter.id, endOfRoundPendingOf(granter.id) + 1);
                } else {
                    pending.set(granter.id, pendingOf(granter.id) + 1);
                }
            }
        };

        // `inTurnLoop` is true only while the selection loop body walks. The pre-loop and
        // post-round drains see inTurnLoop=false → Path B (buffer).
        let inTurnLoop = false;

        // Reactive extra-action bridge (Task 10). PATH A (inTurnLoop): bump the granter's pending
        // count so the selection loop re-picks it at its live speed-rank among the remaining
        // actors (same machinery the attacker/team turn branches use), so a during-turn death
        // grants a SAME-round extra turn. PATH B (no live loop — post-round enemy death): buffer
        // onto pendingExtraActions; the next round's pool build flushes it. Since bySide PR2 the
        // granter may be a PLAYER or ENEMY actor (the ship whose death-passive fired), resolved
        // from the combined allActorsById roster; a missing id is impossible (every reactive owner
        // id is in allActors) → skip defensively rather than throw mid-drain.
        const grantExtraAction = (
            granterId: string,
            abilityId: string,
            oncePerRound: boolean,
            endOfRound: boolean
        ): void => {
            const granter = allActorsById.get(granterId);
            if (!granter) return;
            if (inTurnLoop) {
                processExtraActionGrants(granter, [{ abilityId, oncePerRound, endOfRound }]);
            } else {
                pendingExtraActions.push({ granterId, abilityId, oncePerRound, endOfRound });
            }
        };

        // Drain the intent queue FIFO. Listeners may have enqueued during the emission
        // that triggered this drain; executed intents may emit events (chaining) that
        // enqueue MORE — those form the next generation. A generation is the batch
        // present when a drain pass starts; the loop processes one generation per pass
        // and stops when the queue is empty. MAX_INTENT_GENERATIONS converts a
        // pathological self-feeding loop into a thrown error rather than a hang.
        // Side-parameterized drain (enemy-team PR1). The four side-specific fields are
        // `runtimes`, `recipientIds` (→ executeIntent ctx.playerIds), `isLowestSpeedAllyFor`,
        // and `grantAllyCharges`; everything else is shared and moved verbatim. The player
        // drain (drainIntents) and the enemy drain (drainEnemyIntents) below each bind their
        // own queue + sideCtx, so the player path is behaviourally unchanged.
        const drainQueue = (queue: Intent[], sideCtx: ReactiveSideCtx): void => {
            let generation = 0;
            while (queue.length > 0) {
                if (++generation > MAX_INTENT_GENERATIONS) {
                    throw new Error(
                        `combat round ${r}: intent queue exceeded MAX_INTENT_GENERATIONS ` +
                            `(${MAX_INTENT_GENERATIONS}) — a reactive trigger is self-amplifying without bound`
                    );
                }
                // Snapshot this generation's batch; new enqueues during execution run next pass.
                const batch = queue.splice(0, queue.length);
                for (const intent of batch) {
                    // §4.4 TURN-BLOCK reactive suppression (B3 / D-PR13): a turn-blocked unit's reactives are
                    // FULLY locked out. Drop every queued intent whose OWNER is currently turn-blocked (Stasis OR
                    // Disable) — on-attacked, on-ally-attacked, on-crit, on-enemy-destroyed, AND start-of-round
                    // self-buffs (Chakara via round-started) all carry intent.ownerId, so this ONE filter covers
                    // every reactive type for BOTH sides (drainIntents and drainEnemyIntents share this drainQueue).
                    // Filtered at the DRAIN, before executeIntent. Listeners only ENQUEUE (pure), so dropping an
                    // intent leaves NO partial state. Incoming effects (damage/heals/ally buffs/DoT ticks) are
                    // UNTOUCHED — only the turn-blocked unit's OWN outgoing intents drop.
                    // NOTE: Stasis-only sites (break-on-hit, damage-immunity) intentionally keep using isStasised
                    // directly — Disable never breaks and does not grant immunity.
                    if (isTurnBlocked(intent.ownerId)) continue;
                    executeIntent(intent, {
                        round: r,
                        enemy,
                        enemyId: enemy.id,
                        statusEngine,
                        bus,
                        corrosionEntries,
                        infernoEntries,
                        pendingBombs,
                        runtimes: sideCtx.runtimes,
                        grantAllyCharges: sideCtx.grantAllyCharges,
                        grantExtraAction,
                        playerIds: sideCtx.recipientIds,
                        // Task 7: drain `enemy-buff` gates read the union of enemy attackers'
                        // self-buffs (names only). Empty in DPS mode → byte-identical.
                        enemyAttackerIds: enemyAttackerActorIds,
                        lastTurnCtxByActor,
                        enemyType,
                        enemyHp,
                        // Drain-time HP% includes this round's damage SO FAR (the round
                        // accumulators below are folded into cumulativeDamage only at
                        // post-round assembly): a follow-up reacts to the state its trigger
                        // created — e.g. an on-crit follow-up gated on enemy HP% sees the
                        // enemy's HP AFTER the attacker's hit that just crit. This differs
                        // from the attacker turn's own gates, which deliberately use the
                        // entering-round HP (pre-existing convention, unchanged).
                        // Map-sum: enemy-HP decline is focus + team cumulative + this round's
                        // map totals across ALL actors (the drain reacts to the enemy's true
                        // remaining HP, not just the focus actor's contribution).
                        cumulativeDamage:
                            cumulativeDamage +
                            cumulativeTeamDamage +
                            [...roundDamage.values()].reduce(
                                (s, d) => s + d.direct + d.corrosion + d.inferno + d.detonation,
                                0
                            ),
                        // Bomb damagePerStack/affinity now resolve per OWNER inside the executor
                        // (lastTurnCtxByActor.get(intent.ownerId)) — no global effectiveAttack/
                        // affinityMult here. The focus actor's entry resolves identically to the
                        // pre-Task-6 path (its lastTurnCtx feeds the same value).
                        recordResisted: (resisted) => {
                            const lastTurn = focusTurns[focusTurns.length - 1];
                            // After an attacker turn this round → append to its resisted list;
                            // before any → stage into pendingResisted (drained into the next
                            // attacker turn's head), mirroring the Task-2 team-resist staging.
                            if (lastTurn) lastTurn.resistedEnemyDebuffs.push(resisted);
                            else pendingResisted.push(resisted);
                        },
                        // Phase 4c PR 4: reactive direct damage (Grif) credits the owner's
                        // round map via the single credit point so leeches still see it.
                        creditReactiveDamage: (ownerId: string, amount: number): void => {
                            creditDamage(ownerId, 'direct', amount);
                        },
                        // Healing mode only — the SAME shared ctx the player turns use, so a
                        // reactive heal/shield/cleanse credits the same per-round buckets and
                        // mutates the same live target. Undefined in DPS mode → the executor's
                        // heal/shield/cleanse branches stay inert (goldens byte-identical).
                        healing: healingCtx,
                        // Combat-lifetime once-per-battle guard (Task 8): a flagged reactive
                        // repair (Yazid) fires at most once across the whole combat.
                        oncePerCombatFired,
                        // Combat-lifetime proc-chance gates (D-PR1): equipment reactive procs
                        // that carry a procChance fire at their stated rate via this accumulator.
                        procChanceGates,
                        // Phase 4c PR 6: live lowest-speed-ally gate. UNCONDITIONAL (unlike the
                        // healing-only selfHpPctFor spread) — in DPS mode the set is {attacker}, so
                        // the lone attacker resolves true and DPS gating stays byte-identical.
                        isLowestSpeedAllyFor: sideCtx.isLowestSpeedAllyFor,
                        // Phase 4c PR 1 Task 6 / bySide PR3 Task 2: live self-HP% for drain-time
                        // hp-threshold gates, now sourced per-side from sideCtx.selfHpPctFor.
                        // Player side: heal-target current/max HP (every other id → 100); DPS mode
                        // has no closure (undefined → buildDrainContext defaults to 100). Enemy
                        // side: 100 for every owner until PR5. byte-identical to the old inline spread.
                        selfHpPctFor: sideCtx.selfHpPctFor,
                        enemyWithMostBuffs: sideCtx.enemyWithMostBuffs,
                        // D-PR14: Doomsayer enemy-highest-attack resolver, the round's first
                        // real activator id, and the shared once-per-round consume set. All
                        // inert today — only consumed by the next task's executor branch.
                        enemyWithHighestAttack: sideCtx.enemyWithHighestAttack,
                        firstActivatorId: sideCtx.firstActivatorId,
                        oncePerRoundConsumed: sideCtx.oncePerRoundConsumed,
                        // D-PR8: live not-hit-this-round gate (Alacrity). hitThisRound is a single
                        // combat-wide Set, so the SAME closure serves both sides (team-agnostic) —
                        // no per-side sideCtx field needed (unlike isLowestSpeedAllyFor).
                        wasHitThisRoundFor: (ownerId) => hitThisRound.has(ownerId),
                        // D-PR11: live adjacent-allies resolver (Fortifying Shroud). Sourced
                        // per-side from sideCtx; positional neighbours, else all same-side allies.
                        adjacentAllyIdsFor: sideCtx.adjacentAllyIdsFor,
                    });
                }
            }
        };

        // D-PR14: per-round state — reset each round (declared inside the round loop).
        let firstActivatorId: string | undefined;
        const oncePerRoundConsumed = new Set<string>();

        // C2b-2: opposing actor with the most buffs (Rhodium's enemy-most-buffs purge). Buff
        // count via selfBuffNamesForOwners (incl. unremovable — fine for SELECTION; removal still
        // respects the unremovable set). Ties → first by roster order (deterministic for goldens).
        // Returns undefined for an empty roster (DPS dummy) → executor falls back to ctx.enemyId.
        const mostBuffsAmong = (roster: CombatActor[]): string | undefined => {
            let best: string | undefined;
            let bestCount = -1;
            for (const a of roster) {
                const n = selfBuffNamesForOwners(statusEngine, [a.id]).length;
                if (n > bestCount) {
                    bestCount = n;
                    best = a.id;
                }
            }
            return bestCount > 0 ? best : undefined; // no buffs anywhere → no most-buffs target
        };

        // D-PR14: living opposing actor with the greatest LIVE effective attack
        // (Doomsayer's enemy-highest-attack target). Ties → roster order.
        const highestAttackInRoster = (roster: CombatActor[]): string | undefined =>
            highestAttackAmong(
                roster.map((a) => a.id),
                (id) => {
                    const a = roster.find((x) => x.id === id);
                    return a ? effectiveStatsOf(statusEngine, selfBuffLookup, a).attack : 0;
                },
                (id) => roster.find((a) => a.id === id)?.destroyedRound === undefined
            );

        // Player drain — binds the player queue + player-side ctx. Behaviourally identical to
        // the pre-refactor drainIntents (same runtimes/playerIds/lowest-speed/grantAllyCharges).
        const drainIntents = (): void =>
            drainQueue(intentQueue, {
                runtimes: runtimesById,
                recipientIds: playerIds,
                isLowestSpeedAllyFor: (ownerId) => bySide('player').lowestSpeedIds().has(ownerId),
                grantAllyCharges: bySide('player').grantAllyCharges,
                selfHpPctFor: bySide('player').selfHpPctFor,
                enemyWithMostBuffs: () => mostBuffsAmong(enemyAttackerActors),
                enemyWithHighestAttack: () => highestAttackInRoster(enemyAttackerActors),
                firstActivatorId,
                oncePerRoundConsumed,
                adjacentAllyIdsFor: bySide('player').adjacentAllyIdsFor,
            });

        // Enemy drain (enemy-team PR1) — binds the SEPARATE enemy queue + enemy-side ctx.
        // recipientIds is the enemy-attacker ids (PR1 exercises self-target only; this
        // future-proofs PR2 enemy→enemy reactions). grantAllyCharges is bySide('enemy').grantAllyCharges
        // (Gap F — enemy ally-charge grants, done in enemy-team PR3): a reactive enemy
        // ally-charge grant now bumps the enemy attackers' charges, not the player team.
        // Skips entirely when the enemy queue is empty (DPS / no enemy reactives) so the
        // player path is untouched.
        const drainEnemyIntents = (): void => {
            if (enemyIntentQueue.length === 0) return;
            // Use the enemy executor's own runtime map (NOT runtimesById, which drives
            // leech scan / seeding / credit and must stay player-only). This reuses the
            // existing enemyPlayerRuntimeByActorId — same source, key, and values.
            drainQueue(enemyIntentQueue, {
                runtimes: enemyPlayerRuntimeByActorId,
                recipientIds: enemyAttackerActorIds,
                isLowestSpeedAllyFor: (ownerId) => bySide('enemy').lowestSpeedIds().has(ownerId),
                grantAllyCharges: bySide('enemy').grantAllyCharges,
                selfHpPctFor: bySide('enemy').selfHpPctFor,
                enemyWithMostBuffs: () => mostBuffsAmong(allPlayerActors),
                enemyWithHighestAttack: () => highestAttackInRoster(allPlayerActors),
                firstActivatorId,
                oncePerRoundConsumed,
                adjacentAllyIdsFor: bySide('enemy').adjacentAllyIdsFor,
            });
        };

        // Path-B flush (Task 10): grants buffered from a PRIOR round's post-round enemy death
        // (on-enemy-destroyed → Sokol/Liberator) bump the granter's pending count for THIS round,
        // so the selection loop picks it up at its live speed-rank among all actors.
        // The round's extraActionFired set + MAX_EXTRA_TURNS_PER_ROUND backstop still bound them.
        // The buffer is drained (cleared) here — each pending grant lands exactly one round after
        // its kill was registered. The bump happens BEFORE the pre-loop drain/turn loop so the
        // granter takes its extra turn in selection order. Empty in normal DPS/healing runs → no-op.
        if (pendingExtraActions.length > 0) {
            const flush = pendingExtraActions.splice(0, pendingExtraActions.length);
            for (const g of flush) {
                const granter = allActorsById.get(g.granterId);
                if (!granter) continue;
                processExtraActionGrants(granter, [
                    {
                        abilityId: g.abilityId,
                        oncePerRound: g.oncePerRound,
                        endOfRound: g.endOfRound,
                    },
                ]);
            }
        }

        // round-started: the canonical start-of-round trigger (Phase 3). Fires once per
        // round, before any turn-started of that round. Documented deviation from the
        // Phase 1 contract's turn-started mapping: in a multi-actor round turn-started fires
        // once per actor, so round-started is the reliable "start of round" signal. Emitted
        // here (after the accumulator + drainIntents are in scope) so its start-of-round
        // intents execute BEFORE any turn — no observable ordering change vs the old emit
        // site (nothing between beginRound and here emits an event).
        bus.emit({ type: 'round-started', round: r });
        // Drain point (a): start-of-round intents execute before the first turn.
        drainIntents();
        drainEnemyIntents();

        // §4.5 Stasis-break pending map (B3 Task 2). Reset fresh each round (new Map here).
        // Keys: victimIds whose Stasis should be removed when their skip branch runs.
        // Values: always true (present = break approved; absent = no break queued).
        // An entry is added by the ATTACKER's turn block AFTER runPlayerTurn returns:
        //   - the onHitBreakStasis hook fires DURING runPlayerTurn, marks a local Set;
        //   - AFTER the turn, if the victim was stasised at hit time AND the turn did NOT
        //     re-inflict Stasis (inflictedEnemyDebuffs check), the victim id is stored here.
        // Consumed inside each actor's own skip branch (focus / team / real-enemy): if the
        // victim id is present, remove Stasis after the turn-skip logic. This ensures the
        // victim STILL skips its current-round turn (invariant preserved), and is freed for
        // its next turn (Stasis gone). The same-round drain guard (drainIntents / drainEnemyIntents)
        // runs BEFORE the break resolution → on-attacked reactive sees isStasised=true (test iii).
        // Re-apply check is performed at the ATTACKER's turn, not at consume time, so there is
        // NO casterId lookup: the per-turn inflictedEnemyDebuffs signal is sufficient and correct
        // regardless of which attacker fires on later turns (fixes the casterId-identity bug).
        const stasisBreakPending = new Map<string, true>();
        inTurnLoop = true;
        try {
            let selectionGuard = 0;
            // Pick the next actor to act, OWNING the pending decrement (Task 4). Drain the NORMAL
            // pool first — the unacted actor with the highest CURRENT effective speed (reads live
            // speed buffs → mid-round Speed Up/Down reorders the remainder). Only once the normal
            // pool is fully drained do we consult the END-OF-ROUND pool (Harvester-style grants),
            // again picked by speed AMONG end-of-round actors but unconditionally after every normal
            // action. Returns undefined once both pools are empty → the round ends.
            const selectNext = (): CombatActor | undefined => {
                const normal = selectNextBySpeed(roundActors, pendingOf, effectiveSpeedOf);
                if (normal) {
                    pending.set(normal.id, pendingOf(normal.id) - 1);
                    return normal;
                }
                const eor = selectNextBySpeed(roundActors, endOfRoundPendingOf, effectiveSpeedOf);
                if (eor) {
                    endOfRoundPending.set(eor.id, endOfRoundPendingOf(eor.id) - 1);
                    return eor;
                }
                return undefined;
            };
            for (let actor = selectNext(); actor; actor = selectNext()) {
                if (++selectionGuard > MAX_SELECTION_TICKS) {
                    throw new Error(
                        `combat round ${r}: turn selection did not terminate (pending actions not draining)`
                    );
                }

                // Dead-target turn skip (top-of-turn): the heal target is already destroyed
                // entering its turn → skip the turn body (see handleDeadTargetSkip above).
                if (handleDeadTargetSkip(actor)) {
                    continue;
                }

                // General dead-actor turn skip (correctness): an actor DESTROYED earlier this
                // round (e.g. a player AoE killed an enemy attacker scheduled later in the turn
                // order, or a walked team ship that died) must NOT act when its turn comes up —
                // no turn-started/turn-ended emit, no runPlayerTurn, no damage. A plain `continue`
                // is correct: every per-iteration step below (turn-started emit, the kind-branch
                // turn body, drainIntents/drainEnemyIntents, turn-ended) is THIS actor's own turn
                // work, which a dead actor does none of. The pending decrement already happened in
                // selectNext (Task 4) BEFORE the body runs, so the dead actor's pending is consumed
                // and termination is preserved. Extra-action grants only fire from inside a live
                // turn body, so a skipped actor produces none.
                //
                // The signal is `destroyedRound !== undefined` (set by recordDestroyed when the
                // actor's HP first reaches 0) — NOT `currentHp <= 0`: a manual/flat enemy attacker
                // is constructed with stats.hp 0 (HP not modelled) → currentHp starts at 0 yet it
                // was never destroyed and MUST keep acting. Only an actor that ACTUALLY died is
                // skipped.
                //
                // TWO actors are deliberately exempt (they keep flowing through their EXISTING
                // special handling even after destruction):
                //  - the dead HEAL TARGET → handleDeadTargetSkip above (healTargetBuffs=[] + the
                //    synthesized dead-focus turn). It already `continue`d if dead, so reaching here
                //    means it's alive; the exemption is belt-and-suspenders.
                //  - the dummy `enemy` sink → the DPS/healing legacy enemy. The post-round block
                //    stamps its destroyedRound once its HP decline crosses enemyHp (~line 3674),
                //    yet "the sim keeps hitting the dead dummy regardless": its turn banks enemy
                //    charges and runs the enemy-side DoT/decrement bookkeeping that MUST still tick.
                //    Skipping it would drop a turn-started/ended pair and break every DPS golden.
                const isDummyEnemy = actor.kind === 'enemy' && actor.id === enemy.id;
                if (
                    actor.destroyedRound !== undefined &&
                    !(healTarget && actor.id === healTarget.id) &&
                    !isDummyEnemy
                ) {
                    continue;
                }

                // C2b-2 T5: stamp the acting actor as the prospective lethal attacker BEFORE its
                // damage is applied. Every DIRECT-damage path this turn (focus/team→enemy via
                // applyOutgoingToEnemy, enemy→player via applyIncomingToTarget, positional apply,
                // the non-positional firing hit) routes through the wrappers that read this, so a
                // kill they cause is attributed here. The DoT-tick batch (heal-target turn-start)
                // is the one intake that runs in this same turn yet passes byDirectDamage:false,
                // so it never uses this value as a killer.
                actingActorId = actor.id;

                bus.emit({ type: 'turn-started', actorId: actor.id, round: r });

                // Task 11b: tick the HEAL TARGET's own enemy-applied DoTs at ITS turn-start
                // (mirroring the dummy enemy's DoT-tick timing — DoTs tick at the afflicted ship's
                // turn-start). An enemy attacker lands inferno/corrosion in the tank's containers
                // (Task 6b); without this tick they would never deal damage. Routes the ticked
                // damage into the INCOMING-damage accounting (shield-first → HP → ship-destroyed →
                // the victim's per-actor intake bucket) — NOT the player→enemy damage path. Reuses tickDoTs:
                // the applier's effectiveAttack/dotMult/affinityMult come from the entry's sourceId
                // (the enemy) via lastTurnCtxByActor; corrosion scales with the AFFLICTED ship's
                // (the tank's) max HP. The dead-target guard above already skipped a destroyed tank,
                // so the tank is alive here. DPS mode / no enemy-applied DoTs → empty containers →
                // a no-op (goldens byte-identical).
                if (healTarget && actor.id === healTarget.id) {
                    // Snapshot BEFORE tickDoTs so expiring entries still appear in the
                    // display panel (mergeDoTsForDisplay + buildEnemyRoundEffects read it).
                    tankDotSnapshot = {
                        corrosion: healTarget.corrosionEntries.map((e) => ({
                            sourceId: e.sourceId,
                            tier: e.tier,
                            stacks: e.stacks,
                        })),
                        inferno: healTarget.infernoEntries.map((e) => ({
                            sourceId: e.sourceId,
                            tier: e.tier,
                            stacks: e.stacks,
                        })),
                    };
                    let tankDotDamage = 0;
                    tickDoTs({
                        corrosionEntries: healTarget.corrosionEntries,
                        infernoEntries: healTarget.infernoEntries,
                        // Corrosion scales with the afflicted ship's HP — the tank's own max HP.
                        enemyHp: recipientMaxHp(healTarget.id),
                        ctxFor: (sourceId) => lastTurnCtxByActor.get(sourceId),
                        emitTicked: (dotType, damage) =>
                            bus.emit({
                                type: 'dot-ticked',
                                targetId: healTarget.id,
                                round: r,
                                dotType,
                                damage,
                            }),
                        // Sum the ticked damage across all appliers; route it as INCOMING to the tank
                        // (NOT into a player damage row). expireStacks inside tickDoTs ages the entries.
                        credit: (_sourceId, _dotType, damage) => {
                            tankDotDamage += damage;
                        },
                        // D-PR3 (Vortex Veil): reduce the carrier's incoming DoT ticks when
                        // the tank equips Vortex Veil. The condition 'dot-inferno-corrosion'
                        // gates on dotType being set, so querying with either dotType returns
                        // the same %. Absent → 0 → byte-identical for all existing tests.
                        incomingDotReductionPct: (dotType) =>
                            incomingReductionForHit(incomingAbilitiesOf(healTarget.id), {
                                didCrit: false,
                                attackerStealthed: false,
                                victimStealthed: false,
                                victimStasised: false,
                                hitIndexThisRound: 0,
                                dotType,
                            }),
                    });
                    if (tankDotDamage > 0) {
                        // C2b-2 T5: a DoT-tick batch is an AGGREGATE of multiple appliers with no
                        // single killer → byDirectDamage:false, killerId undefined (overrides the
                        // wrapper's direct-damage default). A defaulted true would wrongly tag a
                        // DoT kill as a direct hit (Faust, Task 6, distinguishes them).
                        applyIncomingToTarget(tankDotDamage, healTarget, { byDirectDamage: false });
                    }
                    // Dead-is-dead: if the turn-start DoT tick was LETHAL the tank just died
                    // (recordDestroyed fired inside applyIncomingToTarget). It must NOT fall through
                    // and take a full turn — re-run the SAME dead-target skip as the top-of-turn
                    // guard. (With Cheat Death the intercept floored HP at 1 → not dead → false → it
                    // acts normally.)
                    if (handleDeadTargetSkip(actor)) {
                        continue;
                    }
                }

                if (actor.kind === 'attacker') {
                    // ====================================================================
                    // ATTACKER TURN — the full damage/buff/DoT-application pipeline lives
                    // in runPlayerTurn (playerTurn.ts), minus the DoT-processing calls
                    // (tickDoTs / processBombs / processAccumulators) which run on the enemy
                    // turn. It returns everything the round's RoundData row needs from this
                    // turn; the numeric damage fields fold into the round accumulator below.
                    // The attacker's per-actor config/gates/stats are bundled in
                    // attackerRuntime (built once at setup); Task 4 adds team runtimes.
                    // ====================================================================
                    // §4.3 STASIS GATE (B2 Task 3): a stasised actor SKIPS its action body
                    // (active/charged skill + attack + status applications). The DoT-tick
                    // prologue (healTarget branch above) and the Post-Turn decrements (below)
                    // STILL run — the guard wraps ONLY this action body. Duration N therefore
                    // skips exactly N scheduled actions (each skipped turn decrements Stasis).
                    // A stasised FOCUS actor must push a synthesized focus turn so the
                    // post-round `focusTurns.length` guard does not throw.
                    if (!isTurnBlocked(actor.id)) {
                        // D-PR14: first REAL activation of the round (Stasis/Disable-skipped
                        // actors never enter these blocks). ??= writes once.
                        firstActivatorId ??= actor.id;
                        const target = parsedTargetFor(actor);
                        const pattern = parsedPatternFor(actor);
                        // Positional target selection (Task C1, GATED). When the focus attacker
                        // (`actor`) carries a board position AND the positioned enemy roster
                        // (`enemyAttackerActors`) has positioned actors, resolve the focus's parsed
                        // target (`input.target`) to a single living enemy and bind THIS turn to it.
                        // When the selection is null — not positional, OR positional but no living
                        // positioned enemy target — we diverge NOTHING from the legacy dummy `enemy`
                        // binding (keeps every existing path byte-identical; the null-target sub-case
                        // is treated as a no-op fallthrough to legacy). No existing test passes
                        // positions, so this branch never fires for them.
                        // Positional target (phase 2): the selected enemy actor, else the dummy sink.
                        // Both are full CombatActors, so all per-target bindings derive from `tgt`
                        // uniformly. For the legacy (non-positional) path tgt === enemy, whose
                        // stats.defence/stats.hp and DoT/bomb containers ARE the legacy module vars
                        // (see ~line 1297) — so deriving every binding from `tgt` is byte-identical.
                        // HP decline is no longer passed in (PR6b): runPlayerTurn derives it from the
                        // struck victim's currentHp (max − currentHp), so the dummy-sink and real-victim
                        // cases both read `tgt` uniformly — no separate decline ternary here.
                        const { tgt } = selectTurnTarget(actor);
                        // §4.5: inject break hook into runPlayerTurn. The hook marks stasisHitVictims
                        // only when the victim was stasised at hit time. The actual statusEngine
                        // removal happens AFTER drainIntents/drainEnemyIntents (below).
                        // §4.5 Akula exception: if the ACTING ATTACKER has doesntBreakStasis, the
                        // victim is never recorded → no break-mark, no stasisBreakPending entry.
                        const tgtWasStasised = !actor.doesntBreakStasis && isStasised(tgt.id);
                        // §4.5: `stasisHitVictims` collects ids of victims stasised at hit time.
                        // Resolved AFTER runPlayerTurn returns (when inflictedEnemyDebuffs is available)
                        // to compute the re-apply check, then stored in `stasisBreakPending` for the
                        // victim's skip branch to consume.
                        const turnStasisHitVictims = new Set<string>();
                        const turn = runPlayerTurn({
                            ...buildTurnArgs(actor, tgt),
                            onHitBreakStasis: tgtWasStasised
                                ? (targetId: string) => {
                                      turnStasisHitVictims.add(targetId);
                                  }
                                : undefined,
                        });
                        if (turnStasisHitVictims.size > 0) {
                            const reInflictedStasis = turn.inflictedEnemyDebuffs.some((ab) =>
                                isStasis(ab.buffName)
                            );
                            if (!reInflictedStasis) {
                                for (const victimId of turnStasisHitVictims) {
                                    stasisBreakPending.set(victimId, true);
                                }
                            }
                            // else: same-turn re-apply wins → break discarded, no pending mark.
                        }

                        // Drain any team-turn resisted entries staged BEFORE this attacker turn
                        // (faster team actors) into the HEAD of this turn's resisted list — same
                        // observable order as the old teamResistedEnemyDebuffs fold-in.
                        if (pendingResisted.length > 0) {
                            turn.resistedEnemyDebuffs.unshift(...pendingResisted);
                            pendingResisted.length = 0;
                        }

                        // Positional APPLY (Task 8b, GATED). When the focus attacker is positional,
                        // carries a parsed target, AND its firing hit produced scalars (a damage
                        // ability fired → turn.positionalScalars is set), drive the per-victim apply
                        // loop against the LIVE enemy roster. Re-resolves anchor + footprint per hit;
                        // origin cells take full damage, covered cells half. Each victim's HP/shield/
                        // Barrier/Cheat-Death/death is mutated through the real applyOutgoingToEnemy.
                        // No production caller threads position+target+pattern yet, so this is false
                        // for every existing test/golden → byte-identical.
                        // The pattern is REQUIRED for footprint expansion — without it there is no
                        // apply to perform (the existing positionalSelection tests set position+target
                        // to exercise target binding only, never a pattern, so they keep the legacy
                        // single-sink credit and never enter this branch).
                        //
                        // DELIBERATELY no `selectedEnemy != null` precondition (CodeRabbit raised this):
                        // in positional/simulator mode there is NO dummy enemy sink to fall back to.
                        // When per-hit resolution inside applyPositionalDamage finds no living opposing
                        // actor, the correct behaviour is for the attacker to WHIFF (deal 0) — see the
                        // death-fallback all-dead-whiff test. Gating `positional` on a pre-resolved
                        // living target would instead route the firing hit back to the legacy dummy
                        // sink, recording PHANTOM damage against a target that no longer exists. So we
                        // enter the positional branch on pattern/target/scalars alone and let the
                        // per-hit live re-resolution own the whiff. (Credit suppression below pairs with
                        // this: the per-victim apply is the ONLY damage path here.)
                        const positional =
                            isPositional(actor.position, enemyAttackerActors) &&
                            target != null &&
                            pattern != null &&
                            turn.positionalScalars != null;
                        if (positional) {
                            // Opposing roster + victim wrapper come from the per-side bindings
                            // (player→enemy here). pattern/target are non-null via the `positional` gate.
                            const tb = turnBindings(actor.side);
                            drivePositionalApply({
                                scalars: turn.positionalScalars!,
                                hitCrits: turn.hitCrits,
                                pattern: pattern,
                                target: target,
                                actingPosition: actor.position!,
                                ignoresForcedTargeting: actor.ignoresForcedTargeting,
                                actingId: actor.id,
                                opposingLiving: tb.opposingRoster,
                                applyToVictim: tb.applyToVictim,
                                // E2 Task 3: per-victim standing leech (player→enemy). The ACTING
                                // attacker's standing leeches proc off EACH footprint victim's
                                // role-scaled dealt damage (origin full, covered half) → restoring
                                // the leech the positional credit-suppression had silenced.
                                onVictimResolved: (_victim, damage) =>
                                    procStandingLeechesPerVictim(actor.id, damage),
                            });
                        }

                        // Fold the focus turn's numeric damage into the round accumulator.
                        // += (not =) on detonation: with a FASTER enemy, the enemy's bomb/
                        // accumulator bursts ran earlier this round — a plain assignment would
                        // clobber them. direct/secondary/conditional are single-focus-turn
                        // today; += keeps the 0..N-turn seam additive.
                        const d = dmg(actor.id);
                        // secondary/conditional are display sub-buckets already rolled into
                        // turn.directDamage — they must NOT be routed through creditDamage or the
                        // standing-leech hook would double-count them.
                        //
                        // Credit SUPPRESSION for the positional case (Task 8b): the firing-hit damage
                        // now lands per-victim via applyPositionalDamage above, so it must NOT also be
                        // folded into cumulativeDamage here (that would double-count it). Skip the
                        // direct/secondary/conditional credits; KEEP detonation (bombs are a separate
                        // mechanic, out of scope). The single-sink decline that used to be zeroed for
                        // the positional path is now derived from the victim's own currentHp inside
                        // runPlayerTurn (PR6b), so no separate decline suppression is needed here.
                        if (!positional) {
                            d.secondary += turn.secondaryDamage;
                            d.conditional += turn.conditionalDamage;
                            creditDamage(actor.id, 'direct', turn.directDamage);
                        }
                        creditDamage(actor.id, 'detonation', turn.detonationDamage);
                        focusTurns.push(turn);

                        // Heal-target buffs: if this focus actor IS the heal target (self-heal case),
                        // its comprehensive activeSelfBuffs are the target's own buffs for the round.
                        if (healTarget && actor.id === healTarget.id) {
                            healTargetBuffs = turn.activeSelfBuffs;
                        }

                        // Record this actor's round-scoped ctx for the enemy's DoT-tick attribution.
                        lastTurnCtxByActor.set(actor.id, turn.turnCtx);

                        // Extra-action grants from this turn bump the attacker's pending-action
                        // count, so selectNextBySpeed re-picks it at its live speed-rank (full extra
                        // turn — charge cadence, post-turn decrement, and triggers all run again on
                        // the re-picked iteration).
                        // The extra turn intentionally re-fires statusEngine.sourceFired too:
                        // re-applying timed buffs, adding persistent stacks, and ticking
                        // accumulators are all correct for a real second turn.
                        processExtraActionGrants(actor, turn.extraActionGrants);
                    } else {
                        // Stasised focus/attacker turn: skip the action body.
                        // §4.3 STASIS GATE (B2 Task 3).
                        // §4.5 Deferred break: consume any pending Stasis break so this actor
                        // acts on their NEXT scheduled turn. The break was pre-approved by a
                        // direct hit in an earlier turn this round (stored in stasisBreakPending
                        // after verifying the attacker did NOT re-inflict Stasis that same turn).
                        // Consuming here (in the skip body) ensures the CURRENT skip still runs —
                        // the victim misses this turn, then is free from the next round onward.
                        if (stasisBreakPending.has(actor.id)) {
                            stasisBreakPending.delete(actor.id);
                            for (const name of STASIS_BUFFS)
                                statusEngine.removeTimedEnemyStatus(actor.id, name);
                        }
                        // Synthesize a minimal no-action result so the post-round
                        // `focusTurns.length` guard does not throw (the focus actor
                        // was stasised — it did not act, but the round must still assemble).
                        // Delegated to pushSynthesizedFocusSkipTurn (E5 §4.4 DRY helper).
                        if (actor.id === focusActorId) {
                            pushSynthesizedFocusSkipTurn();
                        }
                    } // end stasis gate (attacker branch)
                } else if (actor.kind === 'team' && teamRuntimeById.has(actor.id)) {
                    // ====================================================================
                    // WALKED TEAM TURN — a real speed-ordered ally that runs the FULL
                    // runPlayerTurn pipeline (its own gates/stats/skills). Its damage reduces
                    // enemy HP but is reported separately (teamDamage); runPlayerTurn also calls
                    // statusEngine.sourceFired(actor.id, …) internally, so this actor's manual
                    // extras (TeamActorInput.selfBuffs/enemyDebuffs) still apply on its turns —
                    // the legacy sourceFired block below is fully superseded for walked actors.
                    // ====================================================================
                    // §4.3 STASIS GATE (B2 Task 3): a stasised walked-team actor skips its action
                    // body. The DoT-tick prologue (healTarget branch above) and Post-Turn decrements
                    // (below) still run. A walked team actor is never the focus → no focusTurns
                    // synthesis needed (no-else). §4.3 deviation: skip action, decrement preserved.
                    if (!isTurnBlocked(actor.id)) {
                        // D-PR14: first REAL activation of the round (Stasis/Disable-skipped
                        // actors never enter these blocks). ??= writes once.
                        firstActivatorId ??= actor.id;
                        // Positional target selection (Task C2, GATED). Mirrors the focus-turn
                        // branch (C1) but keyed to THIS team actor's own board position
                        // (`actor.position`) and parsed target (`teamTargetById` lookup), not the
                        // focus attacker's. When `selectedTeamEnemy` is null — not positional, no
                        // parsed target, or no living positioned enemy — we diverge NOTHING from the
                        // legacy dummy `enemy` binding. No existing test threads a team target →
                        // this branch never fires for them (goldens byte-identical).
                        const teamTarget = parsedTargetFor(actor);
                        // Same `tgt` consolidation as the focus turn: both branches are full
                        // CombatActors, so every per-target binding derives from `tgt` uniformly.
                        // Legacy path tgt === enemy, whose stats/containers ARE the legacy module
                        // vars (enemyDefense/enemyHp/corrosionEntries/…) → byte-identical.
                        const { tgt } = selectTurnTarget(actor);
                        const teamPattern = parsedPatternFor(actor);
                        // §4.5: inject break hook into runPlayerTurn (mirrors focus site).
                        // §4.5 Akula exception: if the ACTING ATTACKER has doesntBreakStasis,
                        // the victim is never recorded → no break-mark, no stasisBreakPending.
                        const teamTgtWasStasised = !actor.doesntBreakStasis && isStasised(tgt.id);
                        const teamTurnStasisHitVictims = new Set<string>();
                        const teamTurn = runPlayerTurn({
                            ...buildTurnArgs(actor, tgt),
                            onHitBreakStasis: teamTgtWasStasised
                                ? (targetId: string) => {
                                      teamTurnStasisHitVictims.add(targetId);
                                  }
                                : undefined,
                        });
                        if (teamTurnStasisHitVictims.size > 0) {
                            const reInflictedStasis = teamTurn.inflictedEnemyDebuffs.some((ab) =>
                                isStasis(ab.buffName)
                            );
                            if (!reInflictedStasis) {
                                for (const victimId of teamTurnStasisHitVictims) {
                                    stasisBreakPending.set(victimId, true);
                                }
                            }
                        }

                        // Positional APPLY (Task 8b, GATED) — mirror of the focus site, keyed to THIS
                        // team actor's own position / parsed target (teamTargetById) / parsed pattern
                        // (teamPatternById). Drives the per-victim apply loop against the LIVE enemy
                        // roster when this walked team actor is positional, has a parsed target, AND its
                        // firing hit produced scalars. No production caller threads these yet → false for
                        // every existing test/golden → byte-identical.
                        // The pattern (teamPatternById) is REQUIRED for footprint expansion — without
                        // it there is no apply to perform (the positionalSelection C2 test sets
                        // position+target only, never a pattern, so it keeps the legacy single-sink
                        // credit and never enters this branch).
                        const teamPositional =
                            isPositional(actor.position, enemyAttackerActors) &&
                            teamTarget != null &&
                            teamPattern != null &&
                            teamTurn.positionalScalars != null;
                        if (teamPositional) {
                            // Same direction as the focus site (player→enemy); keyed to THIS team
                            // actor's position / parsed target / parsed pattern. Non-null via the gate.
                            const tb = turnBindings(actor.side);
                            drivePositionalApply({
                                scalars: teamTurn.positionalScalars!,
                                hitCrits: teamTurn.hitCrits,
                                pattern: teamPattern,
                                target: teamTarget,
                                actingPosition: actor.position!,
                                ignoresForcedTargeting: actor.ignoresForcedTargeting,
                                actingId: actor.id,
                                opposingLiving: tb.opposingRoster,
                                applyToVictim: tb.applyToVictim,
                                // E2 Task 3: per-victim standing leech (player→enemy), keyed to
                                // THIS walked team actor as the acting attacker. Same per-victim
                                // proc as the focus site.
                                onVictimResolved: (_victim, damage) =>
                                    procStandingLeechesPerVictim(actor.id, damage),
                            });
                        }

                        // Fold the team turn's damage into ITS OWN map entry (post-round assembly
                        // sums all non-focus entries into teamDamage). secondary/conditional are
                        // sub-buckets of direct (do NOT double-add) but kept distinct for the
                        // simulator-page seam.
                        //
                        // Credit SUPPRESSION for the positional case (Task 8b): same as the focus site —
                        // the firing-hit damage already landed per-victim via applyPositionalDamage, so
                        // skip the direct/secondary/conditional credit; KEEP detonation (bombs are out
                        // of scope). The single-sink decline that used to be zeroed for the positional
                        // path is now derived from the victim's own currentHp inside runPlayerTurn
                        // (PR6b), so no separate decline suppression is needed here.
                        const td = dmg(actor.id);
                        if (!teamPositional) {
                            td.secondary += teamTurn.secondaryDamage;
                            td.conditional += teamTurn.conditionalDamage;
                            creditDamage(actor.id, 'direct', teamTurn.directDamage);
                        }
                        creditDamage(actor.id, 'detonation', teamTurn.detonationDamage);

                        // The team turn's result row fields (action/roundCrit/etc.) are NOT consumed
                        // beyond damage + resisted routing + ctx. Stage its resisted enemy applications
                        // EXACTLY like the legacy team block: before any focus turn → pendingResisted;
                        // after → the last focus turn's list.
                        if (teamTurn.resistedEnemyDebuffs.length > 0) {
                            const lastTurn = focusTurns[focusTurns.length - 1];
                            if (lastTurn) {
                                lastTurn.resistedEnemyDebuffs.push(
                                    ...teamTurn.resistedEnemyDebuffs
                                );
                            } else {
                                pendingResisted.push(...teamTurn.resistedEnemyDebuffs);
                            }
                        }

                        // Record this team actor's ctx for the enemy's per-entry DoT-tick attribution
                        // (its inferno entries tick with ITS effectiveAttack/dotMult/affinityMult).
                        lastTurnCtxByActor.set(actor.id, teamTurn.turnCtx);

                        // Heal-target buffs: a walked team actor that IS the heal target surfaces its
                        // own comprehensive activeSelfBuffs (incl. recurring Cheat Death/Everliving Regen).
                        if (healTarget && actor.id === healTarget.id) {
                            healTargetBuffs = teamTurn.activeSelfBuffs;
                        }

                        processExtraActionGrants(actor, teamTurn.extraActionGrants);
                    } else {
                        // §4.5 Deferred break: consume any pending Stasis break (team skip).
                        if (stasisBreakPending.has(actor.id)) {
                            stasisBreakPending.delete(actor.id);
                            for (const name of STASIS_BUFFS)
                                statusEngine.removeTimedEnemyStatus(actor.id, name);
                        }
                    } // end stasis gate (walked-team branch)
                } else if (actor.kind === 'enemy' && actor.id === enemy.id) {
                    // ====================================================================
                    // ENEMY TURN — ticks the DoT containers it carries, per-entry attributed
                    // to the entry's APPLIER. DoTs tick at the start of the afflicted ship's
                    // turn. At default speeds every player acted earlier THIS round (apply/
                    // detonate done, ctx set), so the enemy ticks with this round's contexts.
                    // An entry whose applier has no ctx yet (faster-enemy round 1) is skipped.
                    // Per-entry `+=` into dmg(sourceId): at attacker-only there is exactly one
                    // applier per round → identical totals to the old single-writer assignment.
                    // ====================================================================
                    tickDoTs({
                        corrosionEntries,
                        infernoEntries,
                        enemyHp,
                        ctxFor: (sourceId) => lastTurnCtxByActor.get(sourceId),
                        emitTicked: (dotType, damage) =>
                            bus.emit({
                                type: 'dot-ticked',
                                targetId: enemy.id,
                                round: r,
                                dotType,
                                damage,
                            }),
                        credit: (sourceId, dotType, damage) =>
                            creditDamage(sourceId, dotType, damage),
                    });

                    // Bombs: per-entry burst credited to the applier's detonation channel,
                    // using the applier's snapshotted affinityMult. bomb-detonated actorId is
                    // the applier (per-actor attribution).
                    processBombs({
                        pendingBombs,
                        emitBombDetonated: (actorId, stacks, damage) =>
                            bus.emit({
                                type: 'bomb-detonated',
                                actorId,
                                round: r,
                                stacks,
                                damage,
                            }),
                        creditDetonation: (sourceId, damage) =>
                            creditDamage(sourceId, 'detonation', damage),
                    });

                    // Accumulators: the gather INPUT is the summed direct damage of ALL players
                    // this round (spec: Echoing Burst gathers all players' direct); each burst is
                    // credited to its applier's detonation channel.
                    const allPlayersDirect = [...roundDamage.values()].reduce(
                        (s, d) => s + d.direct,
                        0
                    );
                    processAccumulators({
                        pendingAccumulators,
                        allPlayersDirect,
                        creditDetonation: (sourceId, damage) =>
                            creditDamage(sourceId, 'detonation', damage),
                    });
                } else if (actor.kind === 'enemy') {
                    // ====================================================================
                    // ENEMY ATTACKER TURN (healing mode) — a bare-stat offense actor that
                    // bombards the heal target by walking the FULL runPlayerTurn pipeline with
                    // the TARGET bound as the `enemy` arg (Task 6b). Its damage drains shield-first
                    // into the live target via the intake below; self-buffs land in its OWN owner
                    // store; debuffs/DoTs land on the target's per-target store (targetId).
                    // Healing mode is guaranteed here (enemyAttackers require healTargetId), so
                    // healTarget is defined whenever this branch runs.
                    //
                    // DEAD-TARGET GUARD (restores the retired runEnemyAttackerTurn semantic): vs a
                    // dead heal target the enemy must NOT apply debuffs/DoTs or emit application
                    // events to it — but the charge cadence must STILL advance (charges keep banking,
                    // so a revived/re-spawned target would face a correctly-charged attacker). We
                    // therefore SKIP runPlayerTurn entirely when the target is dead (runPlayerTurn is
                    // the sole site that resolves the attack + applies the kit + emits events) and
                    // advance the cadence manually here, mirroring runPlayerTurn's preTurn step
                    // (consume-at-cap-and-reset, else +1) under the old `chargeCount > 0` guard.
                    // ====================================================================
                    // §4.3 STASIS GATE (B2 Task 3): a stasised real-enemy actor skips its
                    // action body. The Post-Turn decrements (below) still run — duration N
                    // therefore skips exactly N actions (decrement fires on the skipped turn).
                    // A stasised enemy banks NO charge (advanceChargeCadence is INSIDE the
                    // action body and is correctly skipped — matches in-game "charges do not
                    // generate while stasised"). §4.3 deviation: skip action, decrement
                    // preserved. No cadence-advance in the skip path.
                    if (!isTurnBlocked(actor.id)) {
                        // D-PR14: first REAL activation of the round (Stasis/Disable-skipped
                        // actors never enter these blocks). ??= writes once.
                        firstActivatorId ??= actor.id;
                        const enemyRuntime = runtimeFor(actor);
                        // Positional target selection (Task C3, side-symmetric, GATED). Mirrors the
                        // focus-turn (C1) and team-turn (C2) branches, but the OPPOSING roster from the
                        // enemy's view is the PLAYER TEAM (`allPlayerActors` = focus + walked team), the
                        // acting position is THIS enemy's board position (`actor.position`), and its
                        // parsed target rides on `enemyTargetById` (keyed by enemy actor id). When
                        // the selection is null — not positional, no parsed target, or no living
                        // positioned player — we diverge NOTHING from the legacy `healTarget` victim
                        // binding: the enemy's whole turn (defence/hp/decline lookup, the runPlayerTurn
                        // bind, AND the applyIncomingToTarget intake) reads `tgt === healTarget!`, so
                        // every existing path stays byte-identical. No existing test threads an enemy
                        // target → this branch never fires for them.
                        const enemyTarget = parsedTargetFor(actor);
                        // The enemy's victim THIS turn: the positionally-selected player actor, else the
                        // legacy heal target. A full CombatActor in both cases, so every per-victim
                        // binding below derives from `tgt` uniformly (defence/maxHp/decline, the
                        // runPlayerTurn `enemy`+containers, and the applyIncomingToTarget intake).
                        const { tgt } = selectTurnTarget(actor);
                        const targetDead = tgt.currentHp <= 0;
                        // This enemy attacker's parsed pattern (Task 9) — REQUIRED for the enemy-site
                        // positional apply (footprint expansion). An enemy with a target but NO pattern
                        // stays on the legacy single-apply path (same `pattern != null` guard as the
                        // focus/team sites). Undefined for every current fixture → enemyPositional false.
                        const enemyPattern = parsedPatternFor(actor);
                        let damage = 0;
                        // Hoisted for use in the post-else `attacked` emit (Task 8): enemyTurn is
                        // scoped inside the else block below; this flag carries its roundCrit out.
                        let enemyTurnDidCrit = false;
                        // Hoisted for per-hit `attacked` emission (Phase 4c Task 3): populated from
                        // enemyTurn.hitCrits in the ship-backed branch; stays [] on the dead-target
                        // path and on the manual flat-enemy path (which has no hitCrits to surface).
                        let enemyHitCrits: boolean[] = [];
                        // Hoisted positional-apply state (Task 9): the enemy-site mirror of the focus/team
                        // sites. enemyPositional gates BOTH the drivePositionalApply call AND the single-
                        // apply suppression below; enemyScalars carries this turn's firing-hit scalars out
                        // of the else block (enemyTurn is scoped inside it). Both stay false/null on the
                        // dead-target path and whenever the enemy is non-positional → legacy single-apply.
                        let enemyPositional = false;
                        let enemyScalars: AttackerDamageScalars | undefined;
                        // §4.5: inject break hook into runPlayerTurn for the enemy turn (mirrors
                        // focus/team sites). Captured BEFORE runPlayerTurn so Stasis re-applied
                        // by the same attack's debuff ability is not inadvertently broken.
                        // §4.5 Akula exception: if the ACTING ATTACKER has doesntBreakStasis,
                        // the victim is never recorded → no break-mark, no stasisBreakPending.
                        const enemyTgtWasStasised = !actor.doesntBreakStasis && isStasised(tgt.id);
                        const enemyTurnStasisHitVictims = new Set<string>();
                        const enemyBreakHook = enemyTgtWasStasised
                            ? (targetId: string) => {
                                  enemyTurnStasisHitVictims.add(targetId);
                              }
                            : undefined;
                        if (targetDead) {
                            // Cadence-only: bank a charge (or fire+reset at cap) without resolving the
                            // attack. Mirrors runPlayerTurn's preTurn charge step. No skill-fired/
                            // application events — a dead target is untouched (old short-circuit).
                            // The `&& actor.chargeCount > 0` term is redundant (hasChargedSkill already
                            // implies chargeCount >= 1); the helper's internal guard handles it.
                            advanceChargeCadence(actor, enemyRuntime.hasChargedSkill);
                            // No enemyTurn → no lastTurnCtxByActor update (parity: the old dead path
                            // produced no ctx either; this actor has no live DoTs to attribute).
                        } else {
                            // D-PR3 Task 9: victim-side incoming %-reduction against the bound
                            // target on the AGGREGATE (non-positional) damage path — Iridium-as-tank.
                            // `tgt` is the victim (healTarget on the legacy path); `actor` is the
                            // acting enemy attacker. The non-crit baseline is the reduction with
                            // didCrit:false; the crit-family DELTA is the extra reduction a crit adds.
                            // Guarded by length so a victim with no incoming abilities passes 0/0 →
                            // byte-identical. (The positional enemy path applies its own per-sub-hit
                            // reduction via drivePositionalApply; this fold serves the legacy single-apply.)
                            const tgtIncoming = incomingAbilitiesOf(tgt.id);
                            const incomingReductionNonCritPct = tgtIncoming.length
                                ? incomingReductionForHit(tgtIncoming, {
                                      didCrit: false,
                                      attackerStealthed: isStealthed(actor.id),
                                      victimStealthed: isStealthed(tgt.id),
                                      victimStasised: isStasised(tgt.id),
                                      hitIndexThisRound: 0,
                                  })
                                : 0;
                            const incomingReductionCritAll = tgtIncoming.length
                                ? incomingReductionForHit(tgtIncoming, {
                                      didCrit: true,
                                      attackerStealthed: isStealthed(actor.id),
                                      victimStealthed: isStealthed(tgt.id),
                                      victimStasised: isStasised(tgt.id),
                                      hitIndexThisRound: 0,
                                  })
                                : 0;
                            const incomingReductionCritFamilyPct =
                                incomingReductionCritAll - incomingReductionNonCritPct;
                            const enemyTurn = runPlayerTurn({
                                ...buildTurnArgs(actor, tgt),
                                onHitBreakStasis: enemyBreakHook,
                                incomingReductionNonCritPct,
                                incomingReductionCritFamilyPct,
                            });
                            // §4.5: resolve Stasis break for player victims hit by this enemy.
                            if (enemyTurnStasisHitVictims.size > 0) {
                                const reInflictedStasis = enemyTurn.inflictedEnemyDebuffs.some(
                                    (ab) => isStasis(ab.buffName)
                                );
                                if (!reInflictedStasis) {
                                    for (const victimId of enemyTurnStasisHitVictims) {
                                        stasisBreakPending.set(victimId, true);
                                    }
                                }
                            }
                            // Total damage the enemy dealt to the bound target this turn. secondary/
                            // conditional are display sub-buckets ALREADY inside directDamage (do NOT
                            // re-add). detonationDamage is the player-turn detonate() portion (0 for a bare
                            // enemy). Credit it as INCOMING damage to the tank — NOT a player damage row.
                            damage = enemyTurn.directDamage + enemyTurn.detonationDamage;
                            // Hoist roundCrit into the outer scope for the `attacked` emit (Task 8).
                            enemyTurnDidCrit = enemyTurn.roundCrit;
                            // Hoist per-hit crit array for the per-hit `attacked` emit (Phase 4c Task 3).
                            enemyHitCrits = enemyTurn.hitCrits;
                            // Positional gate (Task 9, enemy site): mirror of the focus/team gates, but
                            // the OPPOSING roster from the enemy's view is the PLAYER team
                            // (allPlayerActors), the parsed target rides on enemyTargetById, and the
                            // parsed pattern on enemyPatternById. When true, the firing-hit damage lands
                            // per-victim via drivePositionalApply (below) against the live player roster
                            // and the legacy single-apply is SUPPRESSED. No production caller threads
                            // position+target+pattern for an enemy yet → false for every golden.
                            enemyPositional =
                                isPositional(actor.position, allPlayerActors) &&
                                enemyTarget != null &&
                                enemyPattern != null &&
                                enemyTurn.positionalScalars != null;
                            enemyScalars = enemyTurn.positionalScalars;
                            // Record the enemy actor's round-scoped ctx (parity with player/team branches;
                            // its own future DoT entries would tick with this ctx).
                            lastTurnCtxByActor.set(actor.id, enemyTurn.turnCtx);
                            // Surface this enemy attacker's effects for the UI's round overview (Task 10a):
                            // its own active self-buffs and the debuffs it landed on the heal target,
                            // ATTRIBUTED to this enemy's actor id. NAMES ONLY for display — never folded
                            // into any sim value. Empty for a bare enemy → no entry recorded for it.
                            // Debuffs use inflictedEnemyDebuffs (source-accurate: only what THIS enemy
                            // applied this turn) rather than landedEnemyDebuffs (the shared per-target
                            // window, which would leak other attackers' debuffs into this enemy's group).
                            // resistedEnemyDebuffs = the TIMED debuffs THIS enemy attempted but were
                            // resisted by its hacking-vs-security landing roll (display-only — Task R1).
                            // resistedEnemyDots = the DoTs THIS enemy attempted this turn that were
                            // resisted by the SAME landing roll (the whole turn's DoTs share one
                            // dotsLanded draw — all land or all miss together). Only corrosion/inferno
                            // are modelled by EnemyDoTState; any bomb entry is skipped (display-only —
                            // Task R3).
                            // The guard also fires on resists alone so a fully-resisted enemy (nothing
                            // landed) still gets an entry and surfaces its resisted debuffs/DoTs.
                            const resistedEnemyDots: EnemyDoTState[] =
                                !enemyTurn.dotsLanded && enemyTurn.dotsConfig.length > 0
                                    ? enemyTurn.dotsConfig
                                          .filter(
                                              (d) => d.type === 'corrosion' || d.type === 'inferno'
                                          )
                                          .map((d) => ({
                                              type: d.type as 'corrosion' | 'inferno',
                                              tier: d.tier,
                                              stacks: d.stacks,
                                          }))
                                    : [];
                            if (
                                enemyTurn.activeSelfBuffs.length > 0 ||
                                enemyTurn.inflictedEnemyDebuffs.length > 0 ||
                                enemyTurn.resistedEnemyDebuffs.length > 0 ||
                                resistedEnemyDots.length > 0
                            ) {
                                let entry = roundEnemyEffects.get(actor.id);
                                if (!entry) {
                                    entry = {
                                        selfBuffs: [],
                                        debuffs: [],
                                        resistedDebuffs: [],
                                        resistedDots: [],
                                    };
                                    roundEnemyEffects.set(actor.id, entry);
                                }
                                entry.selfBuffs.push(...enemyTurn.activeSelfBuffs);
                                entry.debuffs.push(...enemyTurn.inflictedEnemyDebuffs);
                                entry.resistedDebuffs.push(...enemyTurn.resistedEnemyDebuffs);
                                entry.resistedDots.push(...resistedEnemyDots);
                            }
                            // Extra-action grants: bump this enemy's pending-action count so it is re-picked
                            // for an extra turn (full-actor completeness — mirrors the attacker and walked-team branches).
                            // The oncePerRound / MAX_EXTRA_TURNS_PER_ROUND backstops inside
                            // processExtraActionGrants absorb any runaway grants. grantAllyCharges stays
                            // undefined (enemy's "allies" are enemy-side, not the player team).
                            processExtraActionGrants(actor, enemyTurn.extraActionGrants);
                        }
                        if (damage > 0) {
                            // Phase-5 per-victim accounting notes (see detailed notes below): (1) the
                            // damage-taken leech now fires PER VICTIM on the positional path too (E2 T5,
                            // procTakenLeechesPerVictim at the enemy site); the non-positional block below
                            // stays gated to `!enemyPositional` and heal-target-only; (2) since PR5b
                            // playerSink.addIncoming keys each victim's AoE share into ITS OWN per-actor
                            // bucket (the heal-target row is no longer inflated) — surfacing those other
                            // per-actor buckets as result rows is the still-deferred symmetric-accounting
                            // surface.
                            //
                            // Shield-first drain → HP → ship-destroyed → the victim's per-actor bucket. The
                            // shieldBefore/hpDamage are captured for the punch-through gate (Quixilver) below.
                            // hpDamage comes straight from the closure (0 under Barrier — damage fully
                            // blocked, not shield-absorbed — otherwise damage - absorbed). barriered = the
                            // attack was fully blocked by an active Barrier (decision #7, below).
                            // Route the enemy's incoming damage. Two mutually-exclusive paths:
                            //
                            //  - NON-positional (legacy): a SINGLE applyIncomingToTarget(damage, tgt)
                            //    drains the bound victim (tgt === healTarget! on the legacy path → the
                            //    no-arg-equivalent call, byte-identical). Returns the shield/HP/Barrier
                            //    outcome consumed by the damage-taken leech block below.
                            //
                            //  - POSITIONAL (Task 9): drivePositionalApply lands the firing hit per-victim
                            //    across the LIVE PLAYER roster (origin full / covered half) via the
                            //    PLAYER-side applyIncomingToTarget wrapper — each player victim takes REAL
                            //    HP/shield/death damage. The single apply is SUPPRESSED (else the anchor
                            //    victim would be double-hit: once by the AoE loop, once by the single
                            //    apply). enemyPattern is non-null via the enemyPositional gate.
                            //
                            // These aggregate locals feed ONLY the non-positional damage-taken leech
                            // block below; on the positional path they stay at neutral defaults. Per-victim
                            // taken leech on the positional path is now handled by procTakenLeechesPerVictim
                            // (E2 T5), which reads each player victim's OWN {shieldBefore,hpDamage,barriered}
                            // outcome via the onVictimResolved hook — not these heal-target aggregates. The
                            // non-positional path keeps the exact legacy single-target leech values.
                            let shieldBefore = 0;
                            let hpDamage = 0;
                            let barriered = false;
                            if (enemyPositional) {
                                // Opposing roster + victim wrapper from the per-side bindings
                                // (enemy→player here). PLAYER-side wrapper: each player victim takes
                                // real incoming damage. Every victim's OWN currentHp/shield is mutated
                                // and recordDestroyed fires for it (its targetHpPct/death derive from the
                                // victim itself — applyVictimDamage reads recipientMaxHp(victim.id)). Since
                                // PR5b the playerSink keys intake by victim.id, so each covered victim's
                                // AoE share lands in ITS OWN per-actor bucket — the heal target's row reads
                                // only intakeFor(healTarget.id) and is no longer inflated by other victims.
                                // SURFACING those other per-actor buckets as result rows is the deferred
                                // Phase-5 symmetric-accounting surface (the result still exposes a single
                                // heal-target row today). Inert here regardless (no production caller
                                // threads enemy position+pattern).
                                // DETONATION CAVEAT (E5 §4.3 — PEELED to a dedicated follow-up): only the
                                // firing hit (enemyScalars, the DIRECT channel) lands per-victim here. The
                                // aggregate `damage` also folds enemyTurn.detonationDamage, which the
                                // NON-positional branch already drains per-victim via
                                // applyIncomingToTarget(damage, tgt) → perActorIncoming (so non-positional
                                // detonation intake is ALREADY recorded). Only the POSITIONAL path leaves it
                                // unrouted — and routing it per-victim needs per-victim bomb attribution the
                                // engine does not track yet (detonation is a single turn-scalar, not
                                // per-target). E5 PEELED this per the spec's §5 pressure valve: it requires
                                // NEW tracking and has zero observable cost to defer (perActorIncoming is
                                // internal/unread by the UI, and no fixture threads enemy position+pattern
                                // WITH detonation → byte-identical today). A positional enemy-detonation
                                // model lands in the follow-up.
                                const tb = turnBindings(actor.side);
                                drivePositionalApply({
                                    scalars: enemyScalars!,
                                    hitCrits: enemyHitCrits,
                                    pattern: enemyPattern!,
                                    target: enemyTarget!,
                                    actingPosition: actor.position!,
                                    ignoresForcedTargeting: actor.ignoresForcedTargeting,
                                    actingId: actor.id,
                                    opposingLiving: tb.opposingRoster,
                                    applyToVictim: tb.applyToVictim,
                                    // E2 Task 5: per-victim taken leech (enemy→player). Each
                                    // player victim procs its OWN damage-taken heal/shield leech
                                    // off the damage IT took, with the per-victim Barrier /
                                    // requiresHpDamage gates — mirroring the non-positional block
                                    // below, per victim.
                                    onVictimResolved: (victim, dmg, outcome) =>
                                        procTakenLeechesPerVictim(victim, dmg, outcome),
                                });
                            } else {
                                ({ shieldBefore, hpDamage, barriered } = applyIncomingToTarget(
                                    damage,
                                    tgt
                                ));
                                // §4.5: the non-positional firing hit is DIRECT-channel. The Stasis
                                // break already fired via onHitBreakStasis inside runPlayerTurn
                                // (before the ability debuffs), so no additional break call needed here.
                            }

                            // Damage-taken procs (per ATTACK, on the aggregate — spec §5): applied
                            // AFTER this attack's drain so the proc never absorbs its own trigger.
                            // raw scales from the FULL attack damage, not the HP portion. Quixilver's
                            // punch-through gate (requiresHpDamage): shield present at attack start
                            // AND HP damage dealt; Malvex is unconditional.
                            // Per-attack (not per-hit): per-hit application would restructure the
                            // shield-drain arithmetic and risk float-float golden churn; the accuracy
                            // delta is below the fidelity of the flat enemy model — on the in-game
                            // verify list (spec §5).
                            // Same heal/shield fold as procStandingLeeches, but the recipient is fixed
                            // to the heal target — the healing-accounting model is single-target. With
                            // positional selection (Task C3) the enemy's HP/shield drain re-routes to the
                            // selected player (`tgt`, above), but these damage-taken HEAL/SHIELD leech
                            // procs still credit the heal target's accounting. Inert unless a player runs
                            // a "when damaged, heal/shield" reactive (the heal target's takenLeechesByOwner
                            // slice non-empty) — no current fixture does — so the legacy path stays
                            // byte-identical. Retargeting the
                            // single-target healing accounting to an arbitrary victim is out of scope for
                            // Phase 2 (incoming-damage routing).
                            // Barrier carve-out (decision #7): an attack FULLY BLOCKED by Barrier deals no
                            // damage taken at all, so its damage-taken procs are skipped entirely — there is
                            // nothing to leech from. (Distinct from a shield absorb, where the convention
                            // still leeches off the full attack: a shield takes the hit, Barrier nullifies it.)
                            //
                            // POSITIONAL SPLIT (E2 T4/T5): taken-leeches are now collected PER OWNER
                            // (takenLeechesByOwner, keyed by each owner's id), but the NON-positional
                            // consumption HERE reads only the heal target's slice — the legacy single-row
                            // healing-accounting model lands every enemy attack on the heal target, so its
                            // values stay byte-identical. The POSITIONAL path no longer defers: each player
                            // victim procs its OWN taken-leech off the damage IT took via
                            // procTakenLeechesPerVictim (wired at the enemy drivePositionalApply site, with
                            // the per-victim Barrier carve-out + requiresHpDamage gate). This block is
                            // gated to `!enemyPositional` so the two paths never double-count. Inert on the
                            // non-positional path unless a player runs a damage-taken reactive in healing
                            // mode (no current fixture does → the heal target's slice is empty).
                            const healTargetTakenLeeches =
                                takenLeechesByOwner.get(healTarget!.id) ?? [];
                            if (
                                !enemyPositional &&
                                healTargetTakenLeeches.length > 0 &&
                                healingCtx &&
                                !barriered
                            ) {
                                const rt = runtimesById.get(healTarget!.id);
                                for (const e of healTargetTakenLeeches) {
                                    if (e.requiresHpDamage && !(shieldBefore > 0 && hpDamage > 0)) {
                                        continue;
                                    }
                                    let raw = damage * (e.pct / 100);
                                    if (e.kind === 'heal' && rt) {
                                        raw *= 1 + rt.healModifier / 100;
                                        if (!e.noCrit && rt.activeHealCritGate(rt.crit / 100)) {
                                            raw *= 1 + rt.critDamage / 100;
                                        }
                                    }
                                    if (e.kind === 'heal') {
                                        healingCtx.credit(healTarget!.id, 'directHeal', raw);
                                        const { consumed, overheal } =
                                            healingCtx.applyHealToTarget(raw);
                                        healingCtx.credit(
                                            healTarget!.id,
                                            'effectiveHeal',
                                            consumed
                                        );
                                        healingCtx.credit(healTarget!.id, 'overheal', overheal);
                                    } else {
                                        healingCtx.credit(healTarget!.id, 'shield', raw);
                                        healingCtx.grantShieldToTarget(raw);
                                    }
                                }
                            }

                            // Per-hit `attacked` (Phase 4c PR 1): one event per hit of the enemy's fired
                            // damage ability, each carrying ITS OWN hit's crit outcome. Emitted after the
                            // aggregate shield-first drain (damage application stays per-attack — spec §3.1),
                            // so every event observes the same post-drain HP/shield state. A turn with
                            // damage > 0 but an empty enemyHitCrits (manual flat enemy, a noCrit damage
                            // ability, or a cast with no damage ability) falls back to one event with the
                            // roundCrit binary — the pre-4c contract.
                            const hitOutcomes =
                                enemyHitCrits.length > 0 ? enemyHitCrits : [enemyTurnDidCrit];
                            for (const hitCrit of hitOutcomes) {
                                bus.emit({
                                    type: 'attacked',
                                    // The actor actually hit this turn (`tgt`). Legacy path:
                                    // tgt === healTarget! → byte-identical. Positional path: the
                                    // selected player actor.
                                    targetId: tgt.id,
                                    attackerId: actor.id,
                                    round: r,
                                    ...(hitCrit ? { didCrit: true } : {}),
                                });
                            }
                        }
                    } else {
                        // §4.5 Deferred break: consume any pending Stasis break (real-enemy skip).
                        if (stasisBreakPending.has(actor.id)) {
                            stasisBreakPending.delete(actor.id);
                            for (const name of STASIS_BUFFS)
                                statusEngine.removeTimedEnemyStatus(actor.id, name);
                        }
                    } // end stasis gate (real-enemy branch)
                }

                // Drain point (b): follow-ups triggered by this actor's turn body run as
                // "consecutive actions" within the turn — BEFORE the owner Post Turn, so any
                // status they apply obeys the same-turn decrement rule (the carrier's Post Turn
                // below decrements it). A triggered effect therefore never boosts the hit that
                // triggered it (the hit's damage was already computed in the turn body).
                drainIntents();
                drainEnemyIntents();

                // Post Turn (combat-system.md section 4): the status CARRIER decrements ALL its
                // timed statuses by one turn — both its self-buff store and the debuff store of
                // effects landed ON it. (Side-agnostic: PR4 unification of the former 4-branch
                // player/enemy/heal-target split.) Empty stores are a safe no-op.
                //
                // The DPS dummy's debuffs live under the sentinel key, not its actor id — the
                // dummy/real-actor duality is removed in PR5; until then every real actor keys
                // its debuff store by actor.id and the dummy keeps the sentinel.
                // (isDummyEnemy is already declared above for the dead-actor skip guard.)
                for (const buffName of statusEngine.decrementPlayer(actor.id).expired) {
                    bus.emit({ type: 'buff-expired', actorId: actor.id, round: r, buffName });
                }
                // debuffs landed on this actor — closes the decrement gap: every non-dummy actor
                // now decrements its own debuff store. Reachable today for a non-heal-target team
                // actor an enemy debuffs in positional mode (decrementUnification Case 5); the
                // player→enemy-attacker variant is fixed by this same line but stays latent (no
                // firing site threads a player→enemy targetId yet — a future per-victim-accounting
                // PR lights it up).
                const debuffResult = isDummyEnemy
                    ? statusEngine.decrementEnemy() // sentinel '__enemy__' store
                    : statusEngine.decrementEnemy(actor.id); // per-actor debuff store
                for (const buffName of debuffResult.expired) {
                    bus.emit({ type: 'buff-expired', actorId: actor.id, round: r, buffName });
                }

                bus.emit({ type: 'turn-ended', actorId: actor.id, round: r });
            }
        } finally {
            // The turn loop is closed: no live queue remains. The reset lives in `finally` so it
            // is structurally guaranteed on ANY loop exit (normal, break, return, throw) — a future
            // early exit added to the round loop can no longer leave `inTurnLoop` stuck true and
            // mis-dispatch the post-round drain as Path A. Any extra-action grant from here on (the
            // post-round enemy-death drain below) sees inTurnLoop=false → Path B (buffered for next round).
            inTurnLoop = false;
        }

        // The row's attacker fields come from the LAST focus turn this round. Rounds
        // always have exactly one focus turn today (the attacker is in every queue),
        // so this reproduces the old definite-assignment provenance. The throw replaces
        // the implicit definite-assignment crash with an explicit one naming the Phase-3+
        // seam: reactive triggers may APPEND extra focus turns (read the last), but a
        // round with ZERO focus turns is impossible while the focus actor is always queued.
        if (!focusTurns.length) {
            throw new Error(
                `combat round ${r} produced no focus actor turn (Phase-3+ seam: extra turns append, zero turns impossible while the focus actor is always queued)`
            );
        }
        const lastAttackerTurn = focusTurns[focusTurns.length - 1];
        const action = lastAttackerTurn.action;
        const roundCrit = lastAttackerTurn.roundCrit;
        const enemyHpPct = lastAttackerTurn.enemyHpPct;
        const dotsConfig = lastAttackerTurn.dotsConfig;
        const dotsLanded = lastAttackerTurn.dotsLanded;
        // Display-only: hide a spent Cheat Death (the focus actor owns activeSelfBuffs).
        const activeSelfBuffsForRound = hideSpentCheatDeath(
            lastAttackerTurn.activeSelfBuffs,
            focusActorId,
            r
        );
        const landedEnemyDebuffs = lastAttackerTurn.landedEnemyDebuffs;
        const resistedEnemyDebuffs = lastAttackerTurn.resistedEnemyDebuffs;

        // --- Post-round assembly: derive row fields from the FOCUS entry, total the
        // round's damage (now including the enemy turn's DoT ticks/bursts), update
        // cumulative totals + enemy HP, emit hp-changed / ship-destroyed, and push
        // the RoundData row. Only the attacker entry exists today — semantically identical
        // to the old scalar locals.
        const focus = dmg(focusActorId);
        // Row fields sourced from the focus entry. secondary/conditional go only to
        // rawTotals (RoundData has no sub-bucket columns) so they're read inline below.
        const directDamage = focus.direct;
        const corrosionDamage = focus.corrosion;
        const infernoDamage = focus.inferno;
        const detonationDamage = focus.detonation;

        if (detonationDamage > 0) {
            bus.emit({
                type: 'dot-detonated',
                targetId: enemy.id,
                round: r,
                damage: detonationDamage,
            });
        }

        const totalRoundDamage = focus.direct + focus.corrosion + focus.inferno + focus.detonation;
        cumulativeDamage += totalRoundDamage;
        // Row/summary rawTotals stay FOCUS-only — only the focus actor reaches summary DPS
        // and the damage-type breakdown (config comparison stays meaningful).
        totalDirectRaw += focus.direct;
        totalSecondaryRaw += focus.secondary;
        totalConditionalRaw += focus.conditional;
        totalCorrosionRaw += focus.corrosion;
        totalInfernoRaw += focus.inferno;
        totalDetonationRaw += focus.detonation;

        // Team damage = Σ over all NON-focus actor entries of every channel (direct already
        // includes its secondary/conditional sub-buckets, so they are NOT added separately).
        // By construction totalRoundDamage + teamRoundDamage = the round's enemy-HP delta.
        let teamRoundDamage = 0;
        for (const [id, d] of roundDamage) {
            if (id === focusActorId) continue;
            teamRoundDamage += d.direct + d.corrosion + d.inferno + d.detonation;
        }
        cumulativeTeamDamage += teamRoundDamage;
        totalTeamRaw += teamRoundDamage;

        // Track the enemy's remaining HP and emit hp-changed / ship-destroyed taps
        // (emission-only; the sim keeps hitting the dead dummy regardless). Enemy HP decline
        // uses focus + team cumulative — team damage reduces enemy HP for gates/HP%/destruction.
        const enemyHpDecline = cumulativeDamage + cumulativeTeamDamage;
        enemy.currentHp = Math.max(0, enemyHp - enemyHpDecline);
        const newEnemyHpPctInt =
            enemyHp > 0 ? Math.round(Math.max(0, 100 * (1 - enemyHpDecline / enemyHp))) : 100;
        if (newEnemyHpPctInt !== lastEnemyHpPctInt) {
            bus.emit({
                type: 'hp-changed',
                targetId: enemy.id,
                round: r,
                oldPct: lastEnemyHpPctInt,
                newPct: newEnemyHpPctInt,
            });
            lastEnemyHpPctInt = newEnemyHpPctInt;
        }
        if (enemy.currentHp <= 0 && !enemy.indestructible) {
            // An indestructible sink (the DPS dummy) NEVER dies. It keeps accumulating damage as
            // currentHp decline so HP%-gates still resolve against it, but it is never
            // recordDestroyed, emits no ship-destroyed, and fires no post-round
            // on-enemy-destroyed drain. Its turn bookkeeping is unaffected: the turn-skip guard
            // (~2791) is gated on isDummyEnemy, not destroyedRound, so DoT/decrement ticking
            // continues exactly as before — this is the byte-identical invariant (suppressing
            // recordDestroyed moves nothing because there is no observer of the dummy's death in
            // the golden corpus).
            //
            // For a (hypothetical) destructible enemy this still applies:
            // Shared helper: stamps enemy.destroyedRound + emits ship-destroyed exactly once
            // (idempotent), replacing the old destroyedEmitted boolean.
            recordDestroyed(enemy, r, bus);
            // Path-B drain (Task 10): the enemy died POST-round — the turn loop is closed and no
            // per-turn drain follows. Drain the on-enemy-destroyed intents now: CHARGE reactives
            // (Liberator's "all allies add 1 charge") apply immediately (charges carry into the
            // next round → correct); EXTRA-ACTION grants see inTurnLoop=false → buffer for next
            // round (cross-round pending grant). recordDestroyed is idempotent so this drains at
            // most once per combat. With NO on-enemy-destroyed listener registered the intent
            // queue is empty → this is a NO-OP (goldens byte-identical).
            drainIntents();
            drainEnemyIntents();
        }

        // round-ended (C2b-2): end-of-round reactive purge (Rhodium). Emitted at the round TAIL,
        // after the post-round death drain so the purge sees post-death state, before roundData
        // assembly. Drain BOTH queues (player + enemy), mirroring the round-started emit+drain.
        // Drains the single-target reactive executor (most-buffs) — single-target by design, out of E3 scope.
        bus.emit({ type: 'round-ended', round: r });
        drainIntents();
        drainEnemyIntents();

        // Report stacks after expiry (state going into next round)
        roundData.push({
            round: r,
            action,
            // END-OF-ROUND charge state: with extra turns (extraTurns >= 1) the cadence
            // ran more than once this round, so this is NOT "charges going into the
            // turn that produced `action`" — it's the live counter after all turns.
            charges: Math.round(attacker.charges),
            chargeCount: hasChargedSkill ? chargeCount : 0,
            didCrit: roundCrit,
            enemyHpPct: Math.round(enemyHpPct),
            directDamage: Math.round(directDamage),
            corrosionDamage: Math.round(corrosionDamage),
            infernoDamage: Math.round(infernoDamage),
            detonationDamage: Math.round(detonationDamage),
            totalRoundDamage: Math.round(totalRoundDamage),
            cumulativeDamage: Math.round(cumulativeDamage),
            // teamDamage set ONLY when walked team actors exist (undefined preserves the
            // legacy/attacker-only RoundData shape — goldens stay byte-identical).
            ...(hasWalkedTeam ? { teamDamage: Math.round(teamRoundDamage) } : {}),
            // extraTurns set ONLY when ≥ 1 (undefined preserves legacy RoundData shape).
            ...(focusTurns.length > 1 ? { extraTurns: focusTurns.length - 1 } : {}),
            // perTargetDamage set ONLY when the positional path recorded victim damage this
            // round (map non-empty). Non-positional rounds leave it absent → goldens byte-identical.
            ...(roundPerTargetDamage.size > 0
                ? { perTargetDamage: Object.fromEntries(roundPerTargetDamage) }
                : {}),
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

        // Healing mode: push this round's healing accounting. incomingDamage/shieldAbsorbed
        // are the per-round intake totals folded from this round's enemy attacker turns.
        // The destroyed-round seam is set the moment the target's HP first reaches 0 (in the
        // enemy attacker turn); this post-round guard is a backstop for any other 0-HP path.
        if (healTarget) {
            // PR5b: the heal target's intake totals are sourced from its per-actor bucket
            // (written by playerSink, PR5a). In the single-target path this is byte-identical to
            // the legacy per-round scalars this replaced (the heal target is the only recorded
            // victim); in positional AoE it is the correct per-victim share rather than the old
            // tank-sums-everything scalar. The replaced scalars were removed in this same change.
            const healTargetIntake = perActorIncoming.get(healTarget.id);
            healingRounds.push({
                perActor: currentRoundHealing,
                targetHpPctStart,
                targetShieldStart,
                incomingDamage: healTargetIntake?.incoming ?? 0,
                shieldAbsorbed: healTargetIntake?.shieldAbsorbed ?? 0,
                barrierAbsorbed: healTargetIntake?.barrierAbsorbed ?? 0,
                perActorIncoming,
                // Per-enemy effects: de-dupe each enemy's own self-buffs/debuffs by buffName
                // (keep the first occurrence so the UI shows each effect once per enemy per round),
                // preserving the order enemies first acted this round. Active enemy-applied DoTs on
                // the target are attributed by stack `sourceId` and merged in below — a DoT-only
                // enemy that produced no self-buffs/debuffs still gets an entry so its DoTs show.
                // mergeDoTsForDisplay combines the pre-tick snapshot with the live containers:
                // live entries (post-tick/newly-applied) take precedence; snapshot entries absent
                // from live (tick-and-expire case) are appended so the display panel always shows
                // DoTs that were active this round even if they expired before this call.
                // When the tank never acted (DPS mode or destroyed tank) the snapshot is empty
                // and mergeDoTsForDisplay returns the live containers unchanged.
                enemyEffects: buildEnemyRoundEffects(
                    roundEnemyEffects,
                    mergeDoTsForDisplay(tankDotSnapshot.corrosion, healTarget.corrosionEntries),
                    mergeDoTsForDisplay(tankDotSnapshot.inferno, healTarget.infernoEntries)
                ),
                // Display-only: hide a spent Cheat Death (the heal target owns these buffs).
                // The destroyed-tank branch already set this to [] (filtering [] is a no-op).
                healTargetBuffs: hideSpentCheatDeath(healTargetBuffs, healTarget.id, r),
            });
            // Post-round backstop (Task-1 OUTCOME B): captures ONLY the start-dead /
            // no-`recordDestroyed` path — a heal target that ENTERS a round already at
            // currentHp<=0 (e.g. seeded hp:0) takes no damage, so recordDestroyed never stamps
            // its destroyedRound. The `healTarget.destroyedRound === undefined` clause makes that
            // intent explicit (on any recordDestroyed path the field is already set). This must
            // NOT call recordDestroyed (would emit a spurious ship-destroyed the old code never
            // produced) nor stamp the actor field (would leak into the turn-skip dead-actor reader
            // and the combat-end readers, changing subsequent-round behavior). First such round
            // wins (`backstopDestroyedRound === undefined`), matching the old first-wins behavior.
            if (
                backstopDestroyedRound === undefined &&
                healTarget.destroyedRound === undefined &&
                healTarget.currentHp <= 0
            ) {
                backstopDestroyedRound = r;
            }
        }
    }

    // The heal target's death round comes from its per-actor `destroyedRound` field (stamped by
    // recordDestroyed), falling back to the post-round backstop's start-dead capture for the
    // no-`recordDestroyed` path (Task-1 OUTCOME B). Computed unconditionally — in non-healing mode
    // healTarget is undefined → undefined, never read (the healing shape is omitted below).
    const healTargetDestroyedRound = healTarget?.destroyedRound ?? backstopDestroyedRound;

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
            teamTotal: totalTeamRaw,
        },
        // Additive — present ONLY in healing mode (DPS callers see the legacy shape).
        ...(healingMode
            ? {
                  healing: {
                      rounds: healingRounds,
                      ...(healTargetDestroyedRound !== undefined
                          ? { destroyedRound: healTargetDestroyedRound }
                          : {}),
                  },
              }
            : {}),
    };
}
